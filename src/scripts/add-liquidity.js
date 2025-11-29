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
 *   node add-liquidity.js                           # 執行 (只在需要時)
 *   node add-liquidity.js --dry-run                 # 模擬執行（不送交易）
 *   node add-liquidity.js --range 0.02              # 使用 ±0.01% 範圍
 *   node add-liquidity.js --force                   # 強制執行（不檢查是否在範圍內）
 *   node add-liquidity.js --env-path /path/to/.env  # 指定 .env 檔案位置
 * 
 * 環境變數:
 *   ENV_PATH=/path/to/.env node add-liquidity.js    # 透過環境變數指定 .env 位置
 */


const envLoader = require('../utils/env-loader');
envLoader.load();
const { SuiClient } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { Transaction } = require('@mysten/sui/transactions');
const { MmtSDK, TickMath } = require('@mmt-finance/clmm-sdk');
const BN = require('bn.js');
const Decimal = require('decimal.js');

// ============ Configuration ============
const CONFIG = {
  // 從 .env 讀取
  privateKey: process.env.SUI_PRIVATE_KEY,
  poolId: process.env.MMT_POOL_ID || '0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
  defaultRangePercent: parseFloat(process.env.DEFAULT_RANGE_PERCENT || '0.0001'),
  
  // Sui RPC
  rpcUrl: 'https://fullnode.mainnet.sui.io',
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
  };
  
  const rangeIdx = args.indexOf('--range');
  if (rangeIdx !== -1 && args[rangeIdx + 1]) {
    options.rangePercent = parseFloat(args[rangeIdx + 1]) / 100;
  }
  
  // --env-path 已在 envLoader.load() 中處理，這裡只需過濾掉它
  // 防止它被當作未知參數
  
  return options;
}

// ============ Initialize SDK & Keypair ============
function initializeSDK(requirePrivateKey = true) {
  // 建立 Sui Client
  const suiClient = new SuiClient({ url: CONFIG.rpcUrl });
  
  // 建立 MMT SDK
  const mmtSdk = MmtSDK.NEW({
    network: 'mainnet',
    client: suiClient,
  });
  
  // 如果不需要私鑰（例如只讀操作）
  if (!requirePrivateKey) {
    return { suiClient, mmtSdk, keypair: null, address: null };
  }
  
  if (!CONFIG.privateKey) {
    throw new Error('SUI_PRIVATE_KEY not set in .env');
  }
  
  // 解析私鑰 (支援 suiprivkey、hex 或 base64)
  let keypair;
  let privateKeyStr = CONFIG.privateKey.trim();
  
  try {
    // 如果是 suiprivkey 格式，使用標準解碼
    if (privateKeyStr.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(privateKeyStr);
      keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } 
    else {
      throw new Error('Failed to parse private key: invalid format (expected suiprivkey)');
    }
  } catch (e) {
    throw new Error('Failed to parse private key: invalid format (expected suiprivkey)');
  }
  
  const address = keypair.getPublicKey().toSuiAddress();
  
  return { suiClient, mmtSdk, keypair, address };
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
function calculateTickRange(pool, rangePercent) {
  const currentSqrtPrice = new BN(pool.currentSqrtPrice);
  const currentPrice = TickMath.sqrtPriceX64ToPrice(
    currentSqrtPrice,
    pool.tokenX?.decimals || 6,
    pool.tokenY?.decimals || 6
  );
  
  log(`Current price: ${currentPrice.toString()}`);
  
  // 計算 ±rangePercent 價格範圍
  const lowerPrice = currentPrice.mul(new Decimal(1 - rangePercent));
  const upperPrice = currentPrice.mul(new Decimal(1 + rangePercent));
  
  log(`Target price range: ${lowerPrice.toString()} - ${upperPrice.toString()}`);
  
  // 轉換為 sqrtPriceX64
  const lowerSqrtPrice = TickMath.priceToSqrtPriceX64(
    lowerPrice,
    pool.tokenX?.decimals || 6,
    pool.tokenY?.decimals || 6
  );
  const upperSqrtPrice = TickMath.priceToSqrtPriceX64(
    upperPrice,
    pool.tokenX?.decimals || 6,
    pool.tokenY?.decimals || 6
  );
  
  // 轉換為 tick index（對齊 tick spacing）
  const lowerTick = TickMath.sqrtPriceX64ToTickIndex(lowerSqrtPrice);
  const upperTick = TickMath.sqrtPriceX64ToTickIndex(upperSqrtPrice);
  
  // 對齊 tick spacing
  const tickSpacing = pool.tickSpacing || 1;
  const alignedLowerTick = Math.floor(lowerTick / tickSpacing) * tickSpacing;
  const alignedUpperTick = Math.ceil(upperTick / tickSpacing) * tickSpacing;
  
  log(`Tick range: ${alignedLowerTick} - ${alignedUpperTick} (spacing: ${tickSpacing})`);
  
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

// ============ Check if Position is Out of Range ============
function checkPositionOutOfRange(position, pool) {
  // 獲取當前 tick
  const currentTick = parseInt(pool.currentTickIndex);
  
  // 獲取倉位的 tick 範圍
  const lowerTick = position.lowerTick;
  const upperTick = position.upperTick;
  
  // 檢查當前價格是否在倉位範圍內
  const isInRange = currentTick >= lowerTick && currentTick <= upperTick;
  
  log(`Position ${position.objectId}: tick range [${lowerTick}, ${upperTick}], current tick: ${currentTick}`);
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
  const currentTick = parseInt(pool.currentTickIndex);
  
  for (const pos of existingPositions) {
    if (pos.liquidity && !pos.liquidity.isZero()) {
      log(`Removing liquidity from position ${pos.objectId}...`);
      
      // 判斷倉位狀態：價格在區間下方只會取回 coinX，在區間上方只會取回 coinY
      if (currentTick < pos.lowerTick) {
        hasOnlyCoinX = true;
        log(`Position is BELOW range - will receive only TokenX`);
      } else if (currentTick > pos.upperTick) {
        hasOnlyCoinY = true;
        log(`Position is ABOVE range - will receive only TokenY`);
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
async function executeTransaction(suiClient, keypair, txb, dryRun = false) {
  if (dryRun) {
    log('DRY RUN - Simulating transaction...');
    
    const dryRunResult = await suiClient.dryRunTransactionBlock({
      transactionBlock: await txb.build({ client: suiClient }),
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
  
  // 使用 Ed25519Keypair 簽署交易
  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: txb,
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
  log(`Pool ID: ${CONFIG.poolId}`);
  log('');
  
  try {
    // 1. 初始化
    const { suiClient, mmtSdk, keypair, address } = initializeSDK(true);
    log(`Wallet address: ${address}`);
    
    // 2. 獲取 Pool 資料
    const pool = await fetchPoolData(mmtSdk, CONFIG.poolId);
    
    // 3. 查找現有倉位 (先檢查倉位狀態，傳入已獲取的 pool 避免重複請求)
    const existingPositions = await findUserPositions(mmtSdk, address, CONFIG.poolId, pool);
    
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
          poolId: CONFIG.poolId,
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
    const result = await executeTransaction(suiClient, keypair, txb, options.dryRun);
    
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
      poolId: CONFIG.poolId,
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
 * 執行自動換倉檢查
 * @param {Object} options - 選項
 * @param {boolean} options.dryRun - 是否模擬執行
 * @param {boolean} options.force - 是否強制執行
 * @param {number} options.rangePercent - 價格範圍百分比
 * @returns {Promise<Object>} 執行結果
 */
async function runAutoRebalance(options = {}) {
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
  log(`Pool ID: ${CONFIG.poolId}`);
  log('');
  
  try {
    // 1. 初始化
    const { suiClient, mmtSdk, keypair, address } = initializeSDK(true);
    log(`Wallet address: ${address}`);
    
    // 2. 獲取 Pool 資料
    const pool = await fetchPoolData(mmtSdk, CONFIG.poolId);
    
    // 3. 查找現有倉位
    const existingPositions = await findUserPositions(mmtSdk, address, CONFIG.poolId, pool);
    
    // 4. 檢查倉位是否已離開價格區間
    if (existingPositions.length === 0) {
      log('⚠️  No existing positions found in this pool.');
      return {
        success: true,
        rebalanceNeeded: false,
        rebalanceExecuted: false,
        message: 'No positions found',
        poolId: CONFIG.poolId,
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
        poolId: CONFIG.poolId,
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
    const result = await executeTransaction(suiClient, keypair, txb, opts.dryRun);
    
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
      poolId: CONFIG.poolId,
      error: result.error || null,
    };
    
  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    return {
      success: false,
      rebalanceNeeded: null,
      rebalanceExecuted: false,
      error: error.message,
      poolId: CONFIG.poolId,
    };
  }
}

// 導出供其他模組使用
module.exports = {
  initializeSDK,
  fetchPoolData,
  calculateTickRange,
  findUserPositions,
  checkPositionOutOfRange,
  buildRebalanceTransaction,
  executeTransaction,
  runAutoRebalance,
  setLogger,
  CONFIG,
};
