  /**
 * 統一 APR 查詢工具
 * 同時查詢 MMT Finance、TakaraLend 和 Volos UI 的 APR
 * 
 * 使用方式:
 *   node apr-monitor.js              # 查詢所有 APR
 *   node apr-monitor.js --mmt        # 只查詢 MMT
 *   node apr-monitor.js --takaralend # 只查詢 TakaraLend
 *   node apr-monitor.js --volos      # 只查詢 Volos UI
 */

const puppeteer = require('puppeteer');
const mmtMonitor = require('./mmt-monitor');
const takaralendMonitor = require('./takaralend-monitor');
const volosMonitor = require('./volos-monitor');

const CONFIG = {
  // Config is now handled in individual monitors
};

/**
 * 查詢 MMT Finance APR
 */
async function queryMMT() {
  try {
    return await mmtMonitor.scrapeEstimatedAPR();
  } catch (error) {
    console.error(`❌ MMT 查詢失敗: ${error.message}`);
    return null;
  }
}

/**
 * 查詢 TakaraLend APR
 */
async function queryTakaraLend(market) {
  try {
    return await takaralendMonitor.getAPR(market);
  } catch (error) {
    console.error(`❌ TakaraLend ${market.toUpperCase()} 查詢失敗: ${error.message}`);
    return null;
  }
}

/**
 * 查詢 Volos UI Vaults APR
 */
async function queryVolosVaults() {
  try {
    return await volosMonitor.queryVaults();
  } catch (error) {
    console.error(`❌ Volos UI 查詢失敗: ${error.message}`);
    return { vault_1: null, vault_2: null };
  }
}

/**
 * 主程序
 */
async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              DeFi APR 統一查詢工具                        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const results = {};
  const promises = [];

  // 平行查詢 MMT
  if (!args.includes('--takaralend')) {
    console.log('🔍 查詢 MMT Finance...');
    promises.push(
      queryMMT().then(apr => {
        results.mmt = apr;
        if (apr !== null) {
          console.log(`✅ MMT USDC-USDT(0.01): ${apr}%`);
        } else {
          console.log('❌ MMT: 查詢失敗');
        }
      })
    );
  }

  // 平行查詢 TakaraLend USDT
  if (!args.includes('--mmt')) {
    console.log('🔍 查詢 TakaraLend USDT...');
    promises.push(
      queryTakaraLend('usdt').then(apr => {
        results.usdt = apr;
        if (apr !== null) {
          console.log(`✅ USDT: ${apr}%`);
        } else {
          console.log('❌ USDT: 查詢失敗');
        }
      })
    );
  }

  // 平行查詢 TakaraLend USDC
  if (!args.includes('--mmt')) {
    console.log('🔍 查詢 TakaraLend USDC...');
    promises.push(
      queryTakaraLend('usdc').then(apr => {
        results.usdc = apr;
        if (apr !== null) {
          console.log(`✅ USDC: ${apr}%`);
        } else {
          console.log('❌ USDC: 查詢失敗');
        }
      })
    );
  }

  // 平行查詢 Volos UI Vaults
  if (!args.includes('--mmt') && !args.includes('--takaralend')) {
    console.log('🔍 查詢 Volos UI Vaults...');
    promises.push(
      queryVolosVaults().then(vaults => {
        results.vault_1 = vaults.vault_1;
        results.vault_2 = vaults.vault_2;
        if (vaults.vault_1 !== null && vaults.vault_1 !== undefined) {
          console.log(`✅ Stable Vault #1: ${vaults.vault_1}%`);
        } else {
          console.log('❌ Stable Vault #1: 查詢失敗');
        }
        if (vaults.vault_2 !== null && vaults.vault_2 !== undefined) {
          console.log(`✅ Stable Vault #2: ${vaults.vault_2}%`);
        } else {
          console.log('❌ Stable Vault #2: 查詢失敗');
        }
      })
    );
  }

  // 等待所有查詢完成
  await Promise.all(promises);

  // 整理結果並排序
  const summaryList = [];

  if (results.mmt !== undefined) {
    summaryList.push({ name: 'MMT Finance', apr: results.mmt });
  }
  if (results.usdt !== undefined) {
    summaryList.push({ name: 'TakaraLend USDT', apr: results.usdt });
  }
  if (results.usdc !== undefined) {
    summaryList.push({ name: 'TakaraLend USDC', apr: results.usdc });
  }
  if (results.vault_1 !== undefined) {
    summaryList.push({ name: 'Volos Vault #1', apr: results.vault_1 });
  }
  if (results.vault_2 !== undefined) {
    summaryList.push({ name: 'Volos Vault #2', apr: results.vault_2 });
  }

  // 排序: APR 高到低，null 排最後
  summaryList.sort((a, b) => {
    if (a.apr === null && b.apr === null) return 0;
    if (a.apr === null) return 1;
    if (b.apr === null) return -1;
    return b.apr - a.apr;
  });

  // 顯示摘要
  console.log('\n' + '═'.repeat(60));
  console.log('📊 查詢結果摘要 (APR 高至低):\n');

  summaryList.forEach((item, index) => {
    let prefix = '   ';
    if (index === 0 && item.apr !== null) {
      prefix = '🏆 ';
    }
    
    const nameStr = item.name.padEnd(16);
    const aprStr = item.apr !== null ? `${item.apr}%` : '❌ 查詢失敗';
    
    console.log(`${prefix}${nameStr}: ${aprStr}`);
  });
  
  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
