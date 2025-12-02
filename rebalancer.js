/**
 * MMT Add Liquidity Script
 * 
 * 自動重新平衡流動性倉位：
 * 1. 讀取 Pool 當前價格 (sqrtPrice)
 * 2. 查找現有倉位，檢查是否已離開價格區間
 * 3. 如果倉位已離開區間，才執行重新平衡：
 *    - 贖回舊倉位流動性
 *    - 計算新的 ±0.01% 價格範圍
 *    - 開新倉位並加入流動性
 * 
 * 使用方式:
 *   node rebalancer.js                           # 執行 (只在需要時)
 *   node rebalancer.js --dry-run                 # 模擬執行（不送交易）
 *   node rebalancer.js --range 0.02              # 使用 ±0.01% 範圍
 *   node rebalancer.js --force                   # 強制執行（不檢查是否在範圍內）
 *   node rebalancer.js --env-path /path/to/.env  # 指定 .env 檔案位置
 * 
 * 環境變數:
 *   ENV_PATH=/path/to/.env node rebalancer.js    # 透過環境變數指定 .env 位置
 */


const envLoader = require('./env-loader');
envLoader.load();
const { SuiClient } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { MmtSDK, TickMath } = require('@mmt-finance/clmm-sdk');
const BN = require('bn.js');
const Decimal = require('decimal.js');
const { initializeKmsSigner, createSuiKmsSigner } = require('./gcp-kms-signer');

// ============ Configuration ============
const CONFIG = {
  // 從 .env 讀取 GCP KMS 金鑰路徑
  kmsKeyPath: process.env.GCP_KMS_KEY_PATH,
  // poolId 可從環境變數或調用時傳入
  rpcUrl: 'https://fullnode.mainnet.sui.io',
  defaultRangePercent: parseFloat(process.env.DEFAULT_RANGE_PERCENT || '0.0001'),
};

// ============ Logging ============
// 支援外部注入 logger（供 main.js 使用）
let externalLogger = null;

function setLogger(logger) {
  externalLogger = logger;
}

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(formattedMessage);
  if (externalLogger) {
    externalLogger(formattedMessage, level);
  }
}

function logError(message) {
  log(message, 'ERROR');
}

function logSuccess(message) {
  log(message, 'SUCCESS');
}

// ============ Parse CLI Args ============
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    rangePercent: CONFIG.defaultRangePercent,
    poolId: process.env.MMT_POOL_ID || '0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
  };
  
  const rangeIdx = args.indexOf('--range');
  if (rangeIdx !== -1 && args[rangeIdx + 1]) {
    options.rangePercent = parseFloat(args[rangeIdx + 1]) / 100;
  }
  
  const poolIdIdx = args.indexOf('--pool-id');
  if (poolIdIdx !== -1 && args[poolIdIdx + 1]) {
    options.poolId = args[poolIdIdx + 1];
  }
  
  // --env-path 已在 envLoader.load() 中處理，這裡只需過濾掉它
  // 防止它被當作未知參數
  
  return options;
}

// ============ Initialize SDK & KMS Signer ============
async function initializeSDK(requireSigner = true) {
  // 建立 Sui Client
  const suiClient = new SuiClient({ url: CONFIG.rpcUrl });
  
  // 建立 MMT SDK
  const mmtSdk = MmtSDK.NEW({
    network: 'mainnet',
    client: suiClient,
  });
  
  // 如果不需要簽署（例如只讀操作）
  if (!requireSigner) {
    return { suiClient, mmtSdk, signer: null, address: null };
  }
  
  if (!CONFIG.kmsKeyPath) {
    throw new Error('GCP_KMS_KEY_PATH not set in .env');
  }
  
  // 初始化 GCP KMS 簽署器
  const kmsConfig = await initializeKmsSigner(CONFIG.kmsKeyPath);
  const signer = createSuiKmsSigner(kmsConfig);
  const address = kmsConfig.address;
  
  return { suiClient, mmtSdk, signer, address };
}

// ============ Fetch Pool Data ============
async function fetchPoolData(mmtSdk, poolId) {
  log(`Fetching pool data for ${poolId}...`);
  
  const pool = await mmtSdk.Pool.getPool(poolId);
  
  if (!pool) {
    throw new Error(`Pool ${poolId} not found`);
  }
  
  log(`Pool: ${pool.tokenX?.symbol || 'TokenX'} / ${pool.tokenY?.symbol || 'TokenY'}`);
  log(`Current sqrtPrice: ${pool.currentSqrtPrice}`);
  log(`Current tick: ${pool.currentTickIndex}`);
  log(`Tick spacing: ${pool.tickSpacing}`);
  log(`Rewarders: ${pool.rewarders ? pool.rewarders.length : 0}`);
  
  return pool;
}

// ============ Calculate Tick Range ============
/**
 * 計算 tick 範圍（模仿 MMT Finance 前端的預設值邏輯）
 * @param {Object} pool - Pool 資訊
 * @param {number} rangePercent - 價格範圍百分比 (例如: 0.0001 = 0.01%)
 * @returns {Object} { lowerPrice, upperPrice, lowerSqrtPrice, upperSqrtPrice, lowerTick, upperTick }
 */
function calculateTickRange(pool, rangePercent) {
  const currentSqrtPrice = new BN(pool.currentSqrtPrice);
  const currentPrice = TickMath.sqrtPriceX64ToPrice(
    currentSqrtPrice,
    pool.tokenX?.decimals || 6,
    pool.tokenY?.decimals || 6
  );
  
  log(`Current price: ${currentPrice.toString()}`);
  
  // 獲取當前 tick 和 tick spacing
  const currentTick = parseInt(pool.currentTickIndex);
  const tickSpacing = pool.tickSpacing || 1;
  
  // 計算對應於所需百分比範圍的 tick 偏移量
  // 原理: 
  // - 下界: lowerPrice = currentPrice / (1 + rangePercent)
  // - 上界: upperPrice = currentPrice * (1 + rangePercent)
  // 因為 price = 1.0001^tick，所以:
  // tick_offset = log(1 + rangePercent) / log(1.0001)
  const tickOffset = Math.log(1 + rangePercent) / Math.log(1.0001);
  
  // 將 tick offset 對齊到最近的 tickSpacing 倍數（向上取整）
  // 這確保邊界 tick 是有效的
  const alignedOffset = Math.ceil(Math.abs(tickOffset) / tickSpacing) * tickSpacing;
  
  // 以當前 tick 為中心，計算上下邊界
  const alignedLowerTick = currentTick - alignedOffset;
  const alignedUpperTick = currentTick + alignedOffset;
  
  // 計算邊界價格
  const lowerSqrtPrice = TickMath.tickIndexToSqrtPriceX64(alignedLowerTick);
  const upperSqrtPrice = TickMath.tickIndexToSqrtPriceX64(alignedUpperTick);
  
  const lowerPrice = TickMath.sqrtPriceX64ToPrice(
    lowerSqrtPrice,
    pool.tokenX?.decimals || 6,
    pool.tokenY?.decimals || 6
  );
  const upperPrice = TickMath.sqrtPriceX64ToPrice(
    upperSqrtPrice,
    pool.tokenX?.decimals || 6,
    pool.tokenY?.decimals || 6
  );
  
  // 計算實際百分比範圍（用於驗證）
  const actualLowerPercent = ((currentPrice - lowerPrice) / currentPrice * 100).toFixed(4);
  const actualUpperPercent = ((upperPrice - currentPrice) / currentPrice * 100).toFixed(4);
  
  log(`Target tick range: [${alignedLowerTick}, ${alignedUpperTick}] (width: ±${alignedOffset} ticks, spacing: ${tickSpacing})`);
  log(`Target price range: ${lowerPrice.toFixed(10)} - ${upperPrice.toFixed(10)}`);
  log(`Actual range: -${actualLowerPercent}% to +${actualUpperPercent}% (requested: ±${(rangePercent * 100).toFixed(4)}%)`);
  
  return {
    lowerPrice: lowerPrice.toString(),
    upperPrice: upperPrice.toString(),
    lowerSqrtPrice: lowerSqrtPrice.toString(),
    upperSqrtPrice: upperSqrtPrice.toString(),
    lowerTick: alignedLowerTick,
    upperTick: alignedUpperTick,
  };
}

// ============ Find User Positions ============
async function findUserPositions(mmtSdk, address, poolId, pool = null) {
  log(`Finding positions for ${address} in pool ${poolId}...`);
  
  try {
    // 如果沒有傳入 pool，才獲取所有 pools
    const pools = pool ? [pool] : await mmtSdk.Pool.getAllPools();
    
    const positions = await mmtSdk.Position.getAllUserPositions(address, pools);
    const poolPositions = positions.filter(p => p.poolId === poolId);
    
    log(`Found ${poolPositions.length} position(s) in target pool`);
    
    return poolPositions;
  } catch (e) {
    logError(`Failed to find positions: ${e.message}`);
    return [];
  }
}

// ============ Convert Tick to Price ============
function tickToPrice(tick, pool) {
  try {
    const sqrtPrice = TickMath.tickIndexToSqrtPriceX64(tick);
    const price = TickMath.sqrtPriceX64ToPrice(
      sqrtPrice,
      pool.tokenX?.decimals || 6,
      pool.tokenY?.decimals || 6
    );
    return new Decimal(price);
  } catch (e) {
    return null;
  }
}

// ============ Get Current Price ============
function getCurrentPrice(pool) {
  try {
    const currentSqrtPrice = new BN(pool.currentSqrtPrice);
    const price = TickMath.sqrtPriceX64ToPrice(
      currentSqrtPrice,
      pool.tokenX?.decimals || 6,
      pool.tokenY?.decimals || 6
    );
    return new Decimal(price);
  } catch (e) {
    return null;
  }
}

// ============ Check if Position is Out of Range ============
function checkPositionOutOfRange(position, pool) {
  // 獲取當前價格
  const currentPrice = getCurrentPrice(pool);
  if (!currentPrice) {
    log(`Position ${position.objectId}: Failed to get current price`);
    return true;
  }
  
  // 獲取倉位的價格範圍
  const lowerPrice = tickToPrice(position.lowerTick, pool);
  const upperPrice = tickToPrice(position.upperTick, pool);
  
  if (!lowerPrice || !upperPrice) {
    log(`Position ${position.objectId}: Failed to get position price range`);
    return true;
  }
  
  // 檢查當前價格是否在倉位範圍內
  const isInRange = currentPrice.greaterThanOrEqualTo(lowerPrice) && currentPrice.lessThanOrEqualTo(upperPrice);
  
  log(`Position ${position.objectId}: price range [${lowerPrice.toFixed(10)}, ${upperPrice.toFixed(10)}], current price: ${currentPrice.toFixed(10)}`);
  log(`Position status: ${isInRange ? '✅ IN RANGE' : '❌ OUT OF RANGE'}`);
  
  return !isInRange;
}

// ============ Build Rebalance Transaction ============
async function buildRebalanceTransaction(mmtSdk, suiClient, address, pool, tickRange, existingPositions) {
  const txb = new Transaction();
  txb.setSender(address);
  
  const poolParams = {
    objectId: pool.poolId,
    tokenXType: pool.tokenXType,
    tokenYType: pool.tokenYType,
    tickSpacing: pool.tickSpacing,
  };
  
  // 1. 如果有舊倉位，先贖回流動性
  let coinX = null;
  let coinY = null;
  let hasOnlyCoinX = false;
  let hasOnlyCoinY = false;
  
  // 檢查當前價格相對於舊倉位的位置，判斷會取回哪種幣
  const currentPrice = getCurrentPrice(pool);
  
  for (const pos of existingPositions) {
    if (pos.liquidity && !pos.liquidity.isZero()) {
      log(`Removing liquidity from position ${pos.objectId}...`);
      
      // 獲取倉位的價格範圍
      const lowerPrice = tickToPrice(pos.lowerTick, pool);
      const upperPrice = tickToPrice(pos.upperTick, pool);
      
      // 判斷倉位狀態：價格在區間下方只會取回 coinX，在區間上方只會取回 coinY
      if (currentPrice && lowerPrice && upperPrice) {
        if (currentPrice.lessThan(lowerPrice)) {
          hasOnlyCoinX = true;
          log(`Position is BELOW range (current: ${currentPrice.toFixed(10)}, lower: ${lowerPrice.toFixed(10)}) - will receive only TokenX`);
        } else if (currentPrice.greaterThan(upperPrice)) {
          hasOnlyCoinY = true;
          log(`Position is ABOVE range (current: ${currentPrice.toFixed(10)}, upper: ${upperPrice.toFixed(10)}) - will receive only TokenY`);
        }
      }
      
      // Collect fees first
      const { feeCoinA, feeCoinB } = mmtSdk.Pool.collectFee(
        txb,
        poolParams,
        pos.objectId,
        undefined
      );

      // Collect rewards if any
      if (pool.rewarders && pool.rewarders.length > 0) {
        log(`Collecting rewards from position ${pos.objectId}...`);
        const rewardCoins = mmtSdk.Pool.collectAllRewards(
          txb,
          poolParams,
          pool.rewarders,
          pos.objectId,
          undefined
        );
        
        if (rewardCoins && rewardCoins.length > 0) {
          txb.transferObjects(rewardCoins, txb.pure.address(address));
        }
      }
      
      // Remove all liquidity
      const { removeLpCoinA, removeLpCoinB } = mmtSdk.Pool.removeLiquidity(
        txb,
        poolParams,
        pos.objectId,
        BigInt(pos.liquidity.toString()),
        BigInt(0), // min_amount_x
        BigInt(0), // min_amount_y
        undefined
      );
      
      // Merge coins
      if (coinX) {
        txb.mergeCoins(coinX, [removeLpCoinA, feeCoinA]);
      } else {
        txb.mergeCoins(removeLpCoinA, [feeCoinA]);
        coinX = removeLpCoinA;
      }
      
      if (coinY) {
        txb.mergeCoins(coinY, [removeLpCoinB, feeCoinB]);
      } else {
        txb.mergeCoins(removeLpCoinB, [feeCoinB]);
        coinY = removeLpCoinB;
      }
      
      // Close old position
      mmtSdk.Position.closePosition(txb, pos.objectId);
    }
  }
  
  // 2. 開新倉位
  log(`Opening new position at tick range ${tickRange.lowerTick} - ${tickRange.upperTick}...`);
  
  const newPosition = mmtSdk.Position.openPosition(
    txb,
    poolParams,
    tickRange.lowerSqrtPrice,
    tickRange.upperSqrtPrice,
    undefined // 不直接轉移，稍後加流動性
  );
  
  // 3. 根據情況選擇添加流動性的方式
  if (coinX && coinY) {
    // 判斷是否只有單一代幣（離開區間的情況）
    if (hasOnlyCoinX) {
      // 只有 coinX，使用單邊添加流動性（會自動 swap 部分成 coinY）
      log(`Using single-sided liquidity (${pool.tokenX?.symbol || 'TokenX'} only, will auto-swap to balance)...`);
      
      await mmtSdk.Pool.addLiquiditySingleSidedV2({
        txb,
        pool: poolParams,
        position: newPosition,
        inputCoin: coinX,
        isXtoY: true, // 輸入的是 tokenX
        transferToAddress: address, // 讓 SDK 處理剩餘代幣的 transfer
        limitSqrtPrice: undefined, // 使用默認限價
        slippagePercentage: 1, // 1% 滑點
        useMvr: true,
      });
      
      // 轉移 coinY（應該是空的）和新倉位給用戶
      txb.transferObjects([coinY, newPosition], txb.pure.address(address));
      
    } else if (hasOnlyCoinY) {
      // 只有 coinY，使用單邊添加流動性（會自動 swap 部分成 coinX）
      log(`Using single-sided liquidity (${pool.tokenY?.symbol || 'TokenY'} only, will auto-swap to balance)...`);
      
      await mmtSdk.Pool.addLiquiditySingleSidedV2({
        txb,
        pool: poolParams,
        position: newPosition,
        inputCoin: coinY,
        isXtoY: false, // 輸入的是 tokenY
        transferToAddress: address, // 讓 SDK 處理剩餘代幣的 transfer
        limitSqrtPrice: undefined, // 使用默認限價
        slippagePercentage: 1, // 1% 滑點
        useMvr: true,
      });
      
      // 轉移 coinX（應該是空的）和新倉位給用戶
      txb.transferObjects([coinX, newPosition], txb.pure.address(address));
      
    } else {
      // 正常情況：有兩種代幣，使用雙邊添加流動性
      log('Adding liquidity with both tokens...');
      
      const { coinA: leftoverA, coinB: leftoverB } = await mmtSdk.Pool.addLiquidity(
        txb,
        poolParams,
        newPosition,
        coinX,
        coinY,
        BigInt(0), // min_amount_x
        BigInt(0), // min_amount_y
        undefined
      );
      
      // 轉移剩餘幣和新倉位給用戶
      txb.transferObjects([leftoverA, leftoverB, newPosition], txb.pure.address(address));
    }
  } else {
    // 沒有舊幣，只轉移空倉位
    txb.transferObjects([newPosition], txb.pure.address(address));
    log('No existing liquidity found, created empty position');
  }
  
  return txb;
}

// ============ Execute Transaction ============
async function executeTransaction(suiClient, signer, txb, dryRun = false) {
  // 建構交易 bytes
  const txBytes = await txb.build({ client: suiClient });
  
  if (dryRun) {
    log('DRY RUN - Simulating transaction...');
    
    const dryRunResult = await suiClient.dryRunTransactionBlock({
      transactionBlock: txBytes,
    });
    
    if (dryRunResult.effects?.status?.status === 'success') {
      logSuccess('Dry run successful!');
      log(`Gas used: ${dryRunResult.effects?.gasUsed?.computationCost || 'unknown'}`);
    } else {
      logError(`Dry run failed: ${dryRunResult.effects?.status?.error || 'Unknown error'}`);
    }
    
    return { success: dryRunResult.effects?.status?.status === 'success', dryRun: true };
  }
  
  log('Executing transaction...');
  
  // 使用 KMS 簽署交易
  const signature = await signer.signTransaction(txBytes);
  
  // 執行已簽署的交易
  const result = await suiClient.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: signature,
    options: {
      showEffects: true,
      showEvents: true,
    },
  });
  
  if (result.effects?.status?.status === 'success') {
    logSuccess(`Transaction successful! Digest: ${result.digest}`);
    return { success: true, digest: result.digest };
  } else {
    logError(`Transaction failed: ${result.effects?.status?.error || 'Unknown error'}`);
    return { success: false, error: result.effects?.status?.error };
  }
}

// ============ Main ============
async function main() {
  const options = parseArgs();
  
  log('========================================');
  log('MMT Add Liquidity Script');
  log('========================================');
  log(`Mode: ${options.dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  log(`Force: ${options.force ? 'YES' : 'NO'}`);
  log(`Range: ±${(options.rangePercent * 100).toFixed(4)}%`);
  log(`Pool ID: ${options.poolId}`);
  log('');
  
  try {
    // 1. 初始化
    const { suiClient, mmtSdk, signer, address } = await initializeSDK(true);
    log(`Wallet address: ${address}`);
    
    // 2. 獲取 Pool 資料
    const pool = await fetchPoolData(mmtSdk, options.poolId);
    
    // 3. 查找現有倉位 (先檢查倉位狀態，傳入已獲取的 pool 避免重複請求)
    const existingPositions = await findUserPositions(mmtSdk, address, options.poolId, pool);
    
    // 4. 檢查倉位是否已離開價格區間
    if (existingPositions.length === 0) {
      log('');
      log('⚠️  No existing positions found in this pool.');
      log('Creating a new position...');
    } else {
      // 檢查所有倉位是否都在範圍內
      let anyOutOfRange = false;
      for (const pos of existingPositions) {
        if (checkPositionOutOfRange(pos, pool)) {
          anyOutOfRange = true;
        }
      }
      
      if (!anyOutOfRange && !options.force) {
        log('');
        log('========================================');
        logSuccess('All positions are still IN RANGE');
        log('No rebalance needed. Use --force to rebalance anyway.');
        log('========================================');
        
        console.log(JSON.stringify({
          success: true,
          rebalanceNeeded: false,
          message: 'All positions are in range',
          poolId: options.poolId,
        }));
        
        process.exit(0);
      }
      
      if (options.force && !anyOutOfRange) {
        log('');
        log('⚠️  Positions are in range, but --force flag is set. Proceeding with rebalance...');
      }
    }
    
    // 5. 計算新的 tick 範圍
    const tickRange = calculateTickRange(pool, options.rangePercent);
    
    // 6. 建構交易
    const txb = await buildRebalanceTransaction(
      mmtSdk,
      suiClient,
      address,
      pool,
      tickRange,
      existingPositions
    );
    
    // 7. 執行交易
    const result = await executeTransaction(suiClient, signer, txb, options.dryRun);
    
    // 8. 輸出結果
    log('');
    log('========================================');
    if (result.success) {
      logSuccess('Rebalance completed successfully!');
      if (result.digest) {
        log(`Transaction: https://suiscan.xyz/mainnet/tx/${result.digest}`);
      }
    } else {
      logError('Rebalance failed');
    }
    log('========================================');
    
    // 輸出 JSON 結果供其他程式讀取
    console.log(JSON.stringify({
      success: result.success,
      dryRun: options.dryRun,
      rebalanceNeeded: true,
      digest: result.digest || null,
      tickRange,
      poolId: options.poolId,
    }));
    
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    console.error(error.stack);
    
    console.log(JSON.stringify({
      success: false,
      error: error.message,
    }));
    
    process.exit(1);
  }
}

// 如果直接執行此腳本
if (require.main === module) {
  main();
}

// ============ Auto Rebalance Function (for main.js) ============
/**
 * 執行自動換倉檢查（單一 Pool）
 * @param {string} poolId - Pool 合約地址
 * @param {Object} options - 選項
 * @param {boolean} options.dryRun - 是否模擬執行
 * @param {boolean} options.force - 是否強制執行
 * @param {number} options.rangePercent - 價格範圍百分比
 * @returns {Promise<Object>} 執行結果
 */
async function runAutoRebalance(poolId, options = {}) {
  const opts = {
    dryRun: options.dryRun ?? false,
    force: options.force ?? false,
    rangePercent: options.rangePercent ?? CONFIG.defaultRangePercent,
  };
  
  log('========================================');
  log('MMT Auto Rebalance Check');
  log('========================================');
  log(`Mode: ${opts.dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  log(`Force: ${opts.force ? 'YES' : 'NO'}`);
  log(`Range: ±${(opts.rangePercent * 100).toFixed(4)}%`);
  log(`Pool ID: ${poolId}`);
  log('');
  
  try {
    // 1. 初始化
    const { suiClient, mmtSdk, signer, address } = await initializeSDK(true);
    log(`Wallet address: ${address}`);
    
    // 2. 獲取 Pool 資料
    const pool = await fetchPoolData(mmtSdk, poolId);
    
    // 3. 查找現有倉位
    const existingPositions = await findUserPositions(mmtSdk, address, poolId, pool);
    
    // 4. 檢查倉位是否已離開價格區間
    if (existingPositions.length === 0) {
      log('⚠️  No existing positions found in this pool.');
      return {
        success: true,
        rebalanceNeeded: false,
        rebalanceExecuted: false,
        message: 'No positions found',
        poolId: poolId,
      };
    }
    
    // 檢查所有倉位是否都在範圍內
    let anyOutOfRange = false;
    for (const pos of existingPositions) {
      if (checkPositionOutOfRange(pos, pool)) {
        anyOutOfRange = true;
      }
    }
    
    if (!anyOutOfRange && !opts.force) {
      log('');
      log('========================================');
      logSuccess('All positions are still IN RANGE');
      log('No rebalance needed.');
      log('========================================');
      
      return {
        success: true,
        rebalanceNeeded: false,
        rebalanceExecuted: false,
        message: 'All positions are in range',
        poolId: poolId,
      };
    }
    
    if (opts.force && !anyOutOfRange) {
      log('⚠️  Positions are in range, but force flag is set. Proceeding with rebalance...');
    }
    
    // 5. 計算新的 tick 範圍
    const tickRange = calculateTickRange(pool, opts.rangePercent);
    
    // 6. 建構交易
    const txb = await buildRebalanceTransaction(
      mmtSdk,
      suiClient,
      address,
      pool,
      tickRange,
      existingPositions
    );
    
    // 7. 執行交易
    const result = await executeTransaction(suiClient, signer, txb, opts.dryRun);
    
    // 8. 輸出結果
    log('');
    log('========================================');
    if (result.success) {
      logSuccess('Rebalance completed successfully!');
      if (result.digest) {
        log(`Transaction: https://suiscan.xyz/mainnet/tx/${result.digest}`);
      }
    } else {
      logError('Rebalance failed');
    }
    log('========================================');
    
    return {
      success: result.success,
      dryRun: opts.dryRun,
      rebalanceNeeded: true,
      rebalanceExecuted: result.success,
      digest: result.digest || null,
      tickRange,
      poolId: poolId,
      error: result.error || null,
    };
    
  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    return {
      success: false,
      rebalanceNeeded: null,
      rebalanceExecuted: false,
      error: error.message,
      poolId: poolId,
    };
  }
}

/**
 * 並行執行多個 Pool 的自動換倉檢查
 * @param {Array<string>} poolIds - Pool 合約地址陣列
 * @param {Object} options - 選項
 * @param {boolean} options.dryRun - 是否模擬執行
 * @param {boolean} options.force - 是否強制執行
 * @returns {Promise<Object>} { [poolId]: result } 結果字典
 */
async function runAutoRebalanceForMultiplePools(poolIds, options = {}) {
  log('========================================');
  log('Auto Rebalance Check for Multiple Pools');
  log('========================================');
  log(`Total Pools: ${poolIds.length}`);
  log(`Mode: ${options.dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  log('');
  
  try {
    // 使用 Promise.all 並行執行所有 Pool 的換倉檢查
    // 確保各 Pool 互不影響（使用 catch 進行隔離）
    const results = await Promise.all(
      poolIds.map(poolId =>
        runAutoRebalance(poolId, options).catch(error => ({
          success: false,
          rebalanceNeeded: null,
          rebalanceExecuted: false,
          error: error.message || 'Unknown error',
          poolId: poolId,
        }))
      )
    );
    
    // 將結果轉換為 { [poolId]: result } 格式
    const resultsByPool = {};
    results.forEach(result => {
      resultsByPool[result.poolId] = result;
    });
    
    // 統計摘要
    const summary = {
      totalPools: poolIds.length,
      successCount: results.filter(r => r.success).length,
      rebalanceExecutedCount: results.filter(r => r.rebalanceExecuted).length,
      failureCount: results.filter(r => !r.success).length,
    };
    
    log('');
    log('========================================');
    log('Multi-Pool Rebalance Summary');
    log('========================================');
    log(`✅ Success: ${summary.successCount}/${summary.totalPools}`);
    log(`🔄 Executed: ${summary.rebalanceExecutedCount}`);
    log(`❌ Failures: ${summary.failureCount}`);
    log('========================================');
    
    return {
      resultsByPool,
      summary,
      timestamp: new Date().toISOString(),
    };
    
  } catch (error) {
    logError(`Fatal error in multi-pool rebalance: ${error.message}`);
    return {
      resultsByPool: {},
      summary: {
        totalPools: poolIds.length,
        successCount: 0,
        rebalanceExecutedCount: 0,
        failureCount: poolIds.length,
      },
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============ Close All Positions Function ============
/**
 * 關閉所有 Pool 中的所有倉位
 * @param {Array<string>} poolIds - Pool 合約地址陣列
 * @param {Object} options - 選項
 * @param {boolean} options.dryRun - 是否模擬執行
 * @returns {Promise<Object>} 執行結果
 */
async function closeAllPositions(poolIds, options = {}) {
  const dryRun = options.dryRun ?? false;
  
  log('========================================');
  log('Close All Positions');
  log('========================================');
  log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  log(`Total Pools: ${poolIds.length}`);
  log('');
  
  try {
    // 1. 初始化
    const { suiClient, mmtSdk, signer, address } = await initializeSDK(true);
    log(`Wallet address: ${address}`);
    log('');
    
    const allResults = [];
    
    // 2. 遍歷每個 Pool
    for (const poolId of poolIds) {
      try {
        log(`Processing pool: ${poolId}`);
        
        // 獲取 Pool 資料
        const pool = await fetchPoolData(mmtSdk, poolId);
        
        // 查找現有倉位
        const existingPositions = await findUserPositions(mmtSdk, address, poolId, pool);
        
        if (existingPositions.length === 0) {
          log(`⚠️  No positions found in pool ${poolId}`);
          allResults.push({
            poolId,
            success: true,
            positionsClosedCount: 0,
            message: 'No positions to close'
          });
          continue;
        }
        
        log(`Found ${existingPositions.length} position(s) to close`);
        
        // 3. 建構關閉交易
        const txb = new Transaction();
        txb.setSender(address);
        
        const poolParams = {
          objectId: pool.poolId,
          tokenXType: pool.tokenXType,
          tokenYType: pool.tokenYType,
          tickSpacing: pool.tickSpacing,
        };
        
        let closedCount = 0;
        const coinsList = [];
        
        for (const pos of existingPositions) {
          if (pos.liquidity && !pos.liquidity.isZero()) {
            log(`Removing liquidity from position ${pos.objectId}...`);
            
            // Collect fees
            const { feeCoinA, feeCoinB } = mmtSdk.Pool.collectFee(
              txb,
              poolParams,
              pos.objectId,
              undefined
            );
            coinsList.push(feeCoinA, feeCoinB);
            
            // Collect rewards if any
            if (pool.rewarders && pool.rewarders.length > 0) {
              log(`Collecting rewards from position ${pos.objectId}...`);
              const rewardCoins = mmtSdk.Pool.collectAllRewards(
                txb,
                poolParams,
                pool.rewarders,
                pos.objectId,
                undefined
              );
              
              if (rewardCoins && rewardCoins.length > 0) {
                coinsList.push(...rewardCoins);
              }
            }
            
            // Remove all liquidity
            // 最後一個參數是 recipientAddress，設為 undefined 讓我們手動處理 coin transfer
            const { removeLpCoinA, removeLpCoinB } = mmtSdk.Pool.removeLiquidity(
              txb,
              poolParams,
              pos.objectId,
              BigInt(pos.liquidity.toString()),
              BigInt(0), // min_amount_x
              BigInt(0), // min_amount_y
              undefined  // recipientAddress - 不自動轉移，稍後統一處理
            );
            coinsList.push(removeLpCoinA, removeLpCoinB);
            
            // Close position
            mmtSdk.Position.closePosition(txb, pos.objectId);
            closedCount++;
          } else {
            // 零流動性倉位 - 仍需收取可能累積的費用，然後關閉
            log(`Position ${pos.objectId} has zero liquidity, collecting fees and closing...`);
            
            // 嘗試收取費用（即使流動性為零，可能還有累積的交易費用）
            const { feeCoinA, feeCoinB } = mmtSdk.Pool.collectFee(
              txb,
              poolParams,
              pos.objectId,
              undefined
            );
            coinsList.push(feeCoinA, feeCoinB);
            
            // 收取獎勵
            if (pool.rewarders && pool.rewarders.length > 0) {
              const rewardCoins = mmtSdk.Pool.collectAllRewards(
                txb,
                poolParams,
                pool.rewarders,
                pos.objectId,
                undefined
              );
              
              if (rewardCoins && rewardCoins.length > 0) {
                coinsList.push(...rewardCoins);
              }
            }
            
            // 直接關閉倉位
            mmtSdk.Position.closePosition(txb, pos.objectId);
            closedCount++;
          }
        }
        
        // 轉移所有收集的幣給用戶
        if (coinsList.length > 0) {
          txb.transferObjects(coinsList, txb.pure.address(address));
        }
        
        // 4. 執行交易
        const result = await executeTransaction(suiClient, signer, txb, dryRun);
        
        if (result.success) {
          logSuccess(`Successfully closed ${closedCount} position(s) in pool ${poolId}`);
          if (result.digest) {
            log(`Transaction: https://suiscan.xyz/mainnet/tx/${result.digest}`);
          }
        } else {
          logError(`Failed to close positions in pool ${poolId}`);
        }
        
        allResults.push({
          poolId,
          success: result.success,
          positionsClosedCount: closedCount,
          digest: result.digest || null,
          error: result.error || null
        });
        
      } catch (error) {
        logError(`Error processing pool ${poolId}: ${error.message}`);
        allResults.push({
          poolId,
          success: false,
          positionsClosedCount: 0,
          error: error.message
        });
      }
      
      log('');
    }
    
    // 5. 統計摘要
    const summary = {
      totalPools: poolIds.length,
      successCount: allResults.filter(r => r.success).length,
      totalPositionsClosed: allResults.reduce((sum, r) => sum + r.positionsClosedCount, 0),
      failureCount: allResults.filter(r => !r.success).length,
    };
    
    log('========================================');
    log('Close All Positions Summary');
    log('========================================');
    log(`✅ Success: ${summary.successCount}/${summary.totalPools}`);
    log(`🔒 Positions Closed: ${summary.totalPositionsClosed}`);
    if (summary.failureCount > 0) {
      log(`❌ Failures: ${summary.failureCount}`);
    }
    log('========================================');
    
    return {
      allResults,
      summary,
      timestamp: new Date().toISOString(),
    };
    
  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    return {
      allResults: [],
      summary: {
        totalPools: poolIds.length,
        successCount: 0,
        totalPositionsClosed: 0,
        failureCount: poolIds.length,
      },
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// 導出供其他模組使用
module.exports = {
  initializeSDK,
  fetchPoolData,
  calculateTickRange,
  findUserPositions,
  tickToPrice,
  getCurrentPrice,
  checkPositionOutOfRange,
  buildRebalanceTransaction,
  executeTransaction,
  runAutoRebalance,
  runAutoRebalanceForMultiplePools,
  closeAllPositions,
  setLogger,
  CONFIG,
};
