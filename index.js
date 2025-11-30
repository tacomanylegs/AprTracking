/**
 * MMT Rebalancer 主程式
 * 
 * 自動檢查並執行 MMT Finance 流動性倉位換倉
 * - 讀取 Pool 設定
 * - 執行自動換倉檢查
 * - 將結果儲存至 Google Sheets「Rebalance」分頁
 * - 發送 Telegram 通知
 * 
 * 使用方式:
 *   node index.js              # 執行換倉
 *   node index.js --dry-run    # 模擬執行（不送交易）
 */

// 載入環境設定（必須最先執行）
require('./env-config');
const envLoader = require('./env-loader');
envLoader.load();

const { runAutoRebalanceForMultiplePools } = require('./rebalancer');
const { appendRebalanceResults } = require('./google-sheets-manager');
const TelegramNotifier = require('./telegram-notifier');

// ============ Pool 設定 ============
const POOLS = [
  {
    id: '0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
    name: 'MMT 0.01%',
    symbol: 'USDC-USDT',
    enabled: true,
    defaultRangePercent: 0.0001,
    tickSpacing: 1
  },
  {
    id: '0x737ec6a4d3ed0c7e6cc18d8ba04e7ffd4806b726c97efd89867597368c4d06a9',
    name: 'MMT 0.001%',
    symbol: 'USDC-USDT',
    enabled: true,
    defaultRangePercent: 0.0001,
    tickSpacing: 1
  }
];

// ============ 解析命令行參數 ============
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force')
  };
}

// ============ 格式化 Telegram 訊息 ============
function formatTelegramMessage(results, timestamp) {
  const lines = ['🔄 <b>MMT Rebalancer 執行結果</b>', ''];
  lines.push(`⏰ ${timestamp}`);
  lines.push('');

  for (const poolId in results.resultsByPool) {
    const result = results.resultsByPool[poolId];
    const pool = POOLS.find(p => p.id === poolId);
    const poolName = pool?.name || 'Unknown';

    let statusEmoji = '❓';
    let statusText = '未知';

    if (result.error) {
      statusEmoji = '❌';
      statusText = `失敗: ${result.error.substring(0, 30)}`;
    } else if (result.rebalanceExecuted && result.success) {
      statusEmoji = '✅';
      const digestShort = result.digest ? result.digest.substring(0, 12) : 'N/A';
      statusText = `換倉成功 (${digestShort}...)`;
    } else if (result.rebalanceNeeded === false) {
      statusEmoji = '⏸';
      statusText = '無需換倉（倉位在範圍內）';
    } else if (result.dryRun && result.success) {
      statusEmoji = '🧪';
      statusText = '模擬執行成功';
    }

    lines.push(`${statusEmoji} <b>${poolName}</b>`);
    lines.push(`   ${statusText}`);
    lines.push('');
  }

  // 統計摘要
  const { summary } = results;
  lines.push('📊 <b>摘要</b>');
  lines.push(`   成功: ${summary.successCount}/${summary.totalPools}`);
  lines.push(`   已執行換倉: ${summary.rebalanceExecutedCount}`);
  if (summary.failureCount > 0) {
    lines.push(`   失敗: ${summary.failureCount}`);
  }

  return lines.join('\n');
}

// ============ 主程式 ============
async function main() {
  const options = parseArgs();
  const timestamp = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  console.log('========================================');
  console.log('MMT Rebalancer');
  console.log('========================================');
  console.log(`時間: ${timestamp}`);
  console.log(`模式: ${options.dryRun ? '模擬執行 (DRY RUN)' : '正式執行'}`);
  console.log('');

  try {
    // 1. 篩選啟用的 Pool
    const enabledPools = POOLS.filter(p => p.enabled);
    const poolIds = enabledPools.map(p => p.id);

    if (poolIds.length === 0) {
      console.log('⚠️  沒有啟用的 Pool，程式結束');
      return;
    }

    console.log(`📋 啟用的 Pool: ${enabledPools.map(p => p.name).join(', ')}`);
    console.log('');

    // 2. 執行自動換倉
    const results = await runAutoRebalanceForMultiplePools(poolIds, {
      dryRun: options.dryRun,
      force: options.force
    });

    // 3. 儲存結果至 Google Sheets
    console.log('');
    console.log('📊 儲存結果至 Google Sheets...');
    
    const sheetsData = [];
    for (const poolId in results.resultsByPool) {
      const result = results.resultsByPool[poolId];
      const pool = POOLS.find(p => p.id === poolId);
      
      let statusText = '未知';
      if (result.error) {
        statusText = `❌ 失敗: ${result.error.substring(0, 50)}`;
      } else if (result.rebalanceExecuted && result.success) {
        statusText = `✅ 換倉成功 (${result.digest || 'N/A'})`;
      } else if (result.rebalanceNeeded === false) {
        statusText = '⏸ 無需換倉';
      } else if (result.dryRun && result.success) {
        statusText = '🧪 模擬執行成功';
      }

      sheetsData.push({
        timestamp: timestamp,
        poolName: pool?.name || 'Unknown',
        status: statusText
      });
    }

    await appendRebalanceResults(sheetsData);

    // 4. 發送 Telegram 通知（僅在有換倉或錯誤時發送）
    const shouldSendTelegram = results.summary.rebalanceExecutedCount > 0 || results.summary.failureCount > 0;
    
    if (shouldSendTelegram) {
      console.log('');
      console.log('📱 發送 Telegram 通知...');
      
      const telegram = new TelegramNotifier();
      const message = formatTelegramMessage(results, timestamp);
      
      try {
        await telegram.sendMessage(message);
        console.log('✅ Telegram 通知已發送');
      } catch (error) {
        console.warn(`⚠️  Telegram 通知失敗: ${error.message}`);
      }
    } else {
      console.log('');
      console.log('📱 無需發送 Telegram 通知（無換倉且無錯誤）');
    }

    // 5. 輸出最終結果
    console.log('');
    console.log('========================================');
    console.log('執行完成');
    console.log('========================================');
    console.log(`成功: ${results.summary.successCount}/${results.summary.totalPools}`);
    console.log(`已執行換倉: ${results.summary.rebalanceExecutedCount}`);
    if (results.summary.failureCount > 0) {
      console.log(`失敗: ${results.summary.failureCount}`);
    }

    process.exit(results.summary.failureCount > 0 ? 1 : 0);

  } catch (error) {
    console.error('');
    console.error('❌ 執行失敗:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 執行主程式
main();
