/**
 * MMT Finance Estimated APR 爬蟲
 * 使用方式:
 *   node mmt-monitor.js --once    # 單次查詢
 *   node mmt-monitor.js            # 持續監控
 *   node mmt-monitor.js --stats    # 查看統計
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const historyManager = require('../history-manager');

const CONFIG = {
  poolId: '0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
  webUrl: 'https://app.mmt.finance/liquidity/0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
  targetAPR: 23.26,
  updateInterval: 5 * 60 * 1000, // 5 分鐘
  timeout: 30000
};

/**
 * 記錄日誌
 */
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * 提取 Estimated APR
 */
async function scrapeEstimatedAPR() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    await page.goto(CONFIG.webUrl, { 
      waitUntil: 'networkidle2', 
      timeout: CONFIG.timeout 
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const apr = await page.evaluate(() => {
      const pageText = document.body.innerText;
      // 尋找 "Estimated APR:" 後面的百分比數值
      // 匹配模式: Estimated APR: [換行或空白] 數值%
      const match = pageText.match(/Estimated APR:\s*[\n\r\s]*([0-9.]+)%/i);
      
      if (match && match[1]) {
        return parseFloat(match[1]);
      }
      return null;
    });

    if (apr !== null) {
      return apr;
    }

    return null;

  } catch (error) {
    log(`❌ 爬蟲錯誤: ${error.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 保存數據
 */
function saveData(apr) {
  try {
    historyManager.addEntry('mmt', {
      estimatedAPR: apr,
      success: apr !== null
    });
    return true;
  } catch (error) {
    log(`❌ 保存失敗: ${error.message}`);
    return false;
  }
}

/**
 * 顯示統計信息
 */
function showStatistics() {
  try {
    const history = historyManager.getStats('mmt');
    if (history.length === 0) {
      log('⚠️  還沒有數據 (今日)');
      return;
    }

    const successData = history.filter(d => d.success && d.estimatedAPR);
    const values = successData.map(d => d.estimatedAPR);

    const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
    const min = Math.min(...values).toFixed(2);
    const max = Math.max(...values).toFixed(2);
    const current = values[values.length - 1].toFixed(2);

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║              MMT Finance APR 統計信息                    ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    console.log(`📊 數據點: ${successData.length} (今日)`);
    console.log(`📈 當前值: ${current}%`);
    console.log(`📊 平均值: ${avg}%`);
    console.log(`⬇️  最小值: ${min}%`);
    console.log(`⬆️  最大值: ${max}%`);
    console.log(`🎯 目標值: ${CONFIG.targetAPR}%`);
    console.log(`📍 差異值: ${(current - CONFIG.targetAPR).toFixed(2)}%`);
    console.log('\n');

  } catch (error) {
    log(`❌ 統計失敗: ${error.message}`);
  }
}

/**
 * 主程序
 */
async function main() {
  const args = process.argv.slice(2);

  // 單次運行模式
  if (args.includes('--once')) {
    const apr = await scrapeEstimatedAPR();
    if (apr !== null) {
      console.log(`✅ MMT: ${apr}%`);
      saveData(apr);
    } else {
      console.log('❌ 無法提取數據');
      saveData(null);
    }
    process.exit(0);
  }

  // 統計模式
  if (args.includes('--stats')) {
    showStatistics();
    process.exit(0);
  }

  // 持續監控模式
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║    MMT Finance Estimated APR 持續監控器                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  log('🚀 啟動持續監控模式');
  log(`⏱️  更新間隔: ${CONFIG.updateInterval / 1000 / 60} 分鐘\n`);

  let iterationCount = 0;

  async function monitor() {
    iterationCount++;
    const apr = await scrapeEstimatedAPR();
    
    if (apr !== null) {
      console.log(`✅ [第 ${iterationCount} 次] MMT: ${apr}%`);
      saveData(apr);
    } else {
      console.log(`❌ [第 ${iterationCount} 次] 無法提取數據`);
      saveData(null);
    }

    if (iterationCount % 6 === 0) {
      showStatistics();
    }
  }

  await monitor();
  setInterval(monitor, CONFIG.updateInterval);

  process.on('SIGINT', () => {
    console.log('\n\n───────────────────────────────────────────────────────────');
    log('收到關閉信號，顯示最終統計...');
    showStatistics();
    log('監控已停止');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  scrapeEstimatedAPR
};
