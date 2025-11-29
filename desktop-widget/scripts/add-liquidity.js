/**
 * MMT Add Liquidity Script
 * 
 * 自動重新平衡流動性倉位：
 * 1. 讀取 Pool 當前價格 (sqrtPrice)
 * 2. 計算 ±0.01% 價格範圍對應的 tick
 * 3. 贖回舊倉位流動性
 * 4. 開新倉位並加入流動性
 * 
 * 使用方式:
 *   node add-liquidity.js                    # 執行
 *   node add-liquidity.js --dry-run          # 模擬執行（不送交易）
 *   node add-liquidity.js --range 0.02       # 使用 ±0.02% 範圍
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { SuiClient } = require('@mysten/sui.js/client');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const { MmtSDK, TickMath } = require('@mmt-finance/clmm-sdk');
const BN = require('bn.js');
const Decimal = require('decimal.js');

// ============ Configuration ============
const CONFIG = {
  // 從 .env 讀取
  privateKey: process.env.SUI_PRIVATE_KEY,
  address: process.env.SUI_ADDRESS,
  poolId: process.env.MMT_POOL_ID || '0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
  
  // 預設價格範圍 ±0.01%
  defaultRangePercent: 0.0001,
  
  // Sui RPC
  rpcUrl: 'https://fullnode.mainnet.sui.io',
};

// ============ Logging ============
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
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
    rangePercent: CONFIG.defaultRangePercent,
  };
  
  const rangeIdx = args.indexOf('--range');
  if (rangeIdx !== -1 && args[rangeIdx + 1]) {
    options.rangePercent = parseFloat(args[rangeIdx + 1]) / 100;
  }
  
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
  if (!requirePrivateKey || !CONFIG.privateKey) {
    if (requirePrivateKey && !CONFIG.privateKey) {
      throw new Error('SUI_PRIVATE_KEY not set in .env');
    }
    return { suiClient, mmtSdk, keypair: null, address: CONFIG.address || null };
  }
  
  // 解析私鑰 (支援 hex 或 base64)
  let keypair;
  try {
    // 嘗試 hex 格式
    const privateKeyBytes = Buffer.from(CONFIG.privateKey.replace('0x', ''), 'hex');
    keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
  } catch (e) {
    try {
      // 嘗試 base64 格式
      const privateKeyBytes = Buffer.from(CONFIG.privateKey, 'base64');
      keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
    } catch (e2) {
      throw new Error(`Failed to parse private key: ${e2.message}`);
    }
  }
  
  const address = keypair.getPublicKey().toSuiAddress();
  if (CONFIG.address && address !== CONFIG.address) {
    log(`Warning: Derived address ${address} differs from SUI_ADDRESS ${CONFIG.address}`, 'WARN');
  }
  
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
async function findUserPositions(mmtSdk, address, poolId) {
  log(`Finding positions for ${address} in pool ${poolId}...`);
  
  try {
    const pools = await mmtSdk.Pool.getAllPools();
    const pool = pools.find(p => p.poolId === poolId);
    
    if (!pool) {
      log('Pool not found in pools list');
      return [];
    }
    
    const positions = await mmtSdk.Position.getAllUserPositions(address, pools);
    const poolPositions = positions.filter(p => p.poolId === poolId);
    
    log(`Found ${poolPositions.length} position(s) in target pool`);
    
    return poolPositions;
  } catch (e) {
    logError(`Failed to find positions: ${e.message}`);
    return [];
  }
}

// ============ Build Rebalance Transaction ============
async function buildRebalanceTransaction(mmtSdk, suiClient, address, pool, tickRange, existingPositions) {
  const txb = new TransactionBlock();
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
  
  for (const pos of existingPositions) {
    if (pos.liquidity && !pos.liquidity.isZero()) {
      log(`Removing liquidity from position ${pos.objectId}...`);
      
      // Collect fees first
      const { feeCoinA, feeCoinB } = mmtSdk.Pool.collectFee(
        txb,
        poolParams,
        pos.objectId,
        undefined
      );
      
      // Remove all liquidity
      const { removeLpCoinA, removeLpCoinB } = mmtSdk.Pool.removeLiquidity(
        txb,
        poolParams,
        pos.objectId,
        pos.liquidity.toString(),
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
  
  // 3. 如果有幣，加入流動性
  if (coinX && coinY) {
    log('Adding liquidity to new position...');
    
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
  
  // 導入 RawSigner
  const { RawSigner } = require('@mysten/sui.js/dist/cjs/signers/raw-signer.js');
  const signer = new RawSigner(keypair, suiClient);
  
  const result = await signer.signAndExecuteTransactionBlock({
    transactionBlock: txb,
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
  log(`Range: ±${(options.rangePercent * 100).toFixed(4)}%`);
  log(`Pool ID: ${CONFIG.poolId}`);
  log('');
  
  try {
    // 1. 初始化 (dry-run 模式不需要私鑰來獲取 pool 資料)
    const requirePrivateKey = !options.dryRun;
    const { suiClient, mmtSdk, keypair, address } = initializeSDK(requirePrivateKey);
    
    if (address) {
      log(`Wallet address: ${address}`);
    } else {
      log('No wallet configured (read-only mode)');
    }
    
    // 2. 獲取 Pool 資料
    const pool = await fetchPoolData(mmtSdk, CONFIG.poolId);
    
    // 3. 計算 tick 範圍
    const tickRange = calculateTickRange(pool, options.rangePercent);
    
    // 如果是 dry-run 且沒有私鑰，到這裡就結束
    if (options.dryRun && !keypair) {
      log('');
      log('========================================');
      logSuccess('Dry run completed (read-only mode)');
      log('Pool data and tick range calculated successfully.');
      log('To execute transactions, set SUI_PRIVATE_KEY in .env');
      log('========================================');
      
      console.log(JSON.stringify({
        success: true,
        dryRun: true,
        tickRange,
        poolId: CONFIG.poolId,
        readOnlyMode: true,
      }));
      
      process.exit(0);
    }
    
    // 4. 查找現有倉位
    const existingPositions = await findUserPositions(mmtSdk, address, CONFIG.poolId);
    
    // 5. 建構交易
    const txb = await buildRebalanceTransaction(
      mmtSdk,
      suiClient,
      address,
      pool,
      tickRange,
      existingPositions
    );
    
    // 6. 執行交易
    const result = await executeTransaction(suiClient, keypair, txb, options.dryRun);
    
    // 7. 輸出結果
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

// 導出供其他模組使用
module.exports = {
  initializeSDK,
  fetchPoolData,
  calculateTickRange,
  findUserPositions,
  buildRebalanceTransaction,
  executeTransaction,
};
