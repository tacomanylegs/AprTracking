/**
 * TakaraLend 雙市場監控器
 * 監控 USDT (15.57%) 和 USDC (12.88%) 的 Supply APR
 * 
 * 用法:
 *   node takaralend-monitor.js              # 持續監控 (每 N 秒更新)
 *   node takaralend-monitor.js --once       # 單次運行
 *   node takaralend-monitor.js --stats      # 查看統計
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const historyManager = require('../history-manager');

const CONFIG = {
  markets: ['USDT', 'USDC'],
  urls: {
    'USDT': 'https://app.takaralend.com/market/USD%E2%82%AE0',
    'USDC': 'https://app.takaralend.com/market/USDC'
  },
  updateInterval: 5 * 60 * 1000, // 5 分鐘
  timeout: 30000
};

/**
 * 記錄日誌
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
}

/**
 * 保存市場數據
 */
function saveMarketData(market, aprData) {
  try {
    historyManager.addEntry(market.toLowerCase(), aprData);
    return true;
  } catch (e) {
    log(`❌ 保存 ${market} 數據失敗: ${e.message}`);
    return false;
  }
}

/**
 * 爬取單個市場的 APR
 */
async function scrapeMarket(market, browser) {
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const url = CONFIG.urls[market];
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: CONFIG.timeout
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    // 提取 APR 數據
    const aprData = await page.evaluate(() => {
      const pageText = document.body.innerText;
      
      // 提取 Supply APR
      const supplyMatch = pageText.match(/Supply info[\s\S]*?APR[\s\n]*([0-9.]+)%/i) ||
                         pageText.match(/Total[\s\S]*?Supply[\s\S]*?APR[\s\n]*([0-9.]+)%/i);
      
      return {
        timestamp: new Date().toISOString(),
        supplyAPR: supplyMatch ? supplyMatch[1] : null,
        success: supplyMatch !== null
      };
    });

    await page.close();
    return aprData;

  } catch (error) {
    log(`❌ 爬取 ${market} 失敗: ${error.message}`);
    return null;
  }
}

/**
 * 同時爬取兩個市場
 */
async function scrapeAllMarkets() {
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    log('⏳ 爬取市場...');

    // 並行爬取兩個市場
    const results = await Promise.all(
      CONFIG.markets.map(market => scrapeMarket(market, browser))
    );

    await browser.close();

    // 顯示結果
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║         爬蟲結果                          ║');
    console.log('╚════════════════════════════════════════════╝\n');

    CONFIG.markets.forEach((market, idx) => {
      const data = results[idx];
      
      if (data && data.success) {
        console.log(`✅ ${market}: ${data.supplyAPR}%`);
        saveMarketData(market, data);
      } else {
        console.log(`❌ ${market}: 無法提取數據`);
      }
    });
    console.log();

    return results;

  } catch (error) {
    log(`❌ 爬蟲錯誤: ${error.message}`);
    if (browser) {
      await browser.close();
    }
    return null;
  }
}

/**
 * 顯示統計信息
 */
function showStatistics() {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║   USDT & USDC 統計信息                   ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);

  CONFIG.markets.forEach(market => {
    try {
      const allData = historyManager.getStats(market.toLowerCase());

      if (allData.length === 0) {
        console.log(`📊 ${market}: 暫無數據 (今日)\n`);
        return;
      }

      const supplies = allData
        .filter(d => d.success && d.supplyAPR)
        .map(d => parseFloat(d.supplyAPR));

      if (supplies.length > 0) {
        const avg = (supplies.reduce((a, b) => a + b) / supplies.length).toFixed(2);
        const min = Math.min(...supplies).toFixed(2);
        const max = Math.max(...supplies).toFixed(2);
        const latest = supplies[supplies.length - 1].toFixed(2);
        
        console.log(`📈 ${market}:`);
        console.log(`   當前: ${latest}%`);
        console.log(`   平均: ${avg}%`);
        console.log(`   最小: ${min}%`);
        console.log(`   最大: ${max}%`);
        console.log(`   數據點: ${supplies.length} (今日)\n`);
      }

    } catch (e) {
      console.error(`❌ ${market} 統計錯誤:`, e.message);
    }
  });
}

/**
 * 定期監控
 */
async function startMonitoring() {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║   TakaraLend 雙市場監控器                ║`);
  console.log(`║   USDT (15.57%) + USDC (12.88%)        ║`);
  console.log(`║   Supply APR 監控                      ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);

  console.log(`📝 配置:`);
  console.log(`   監控市場: USDT, USDC`);
  console.log(`   更新間隔: ${CONFIG.updateInterval / 1000} 秒鐘`);
  console.log(`   數據目錄: history/\n`);

  console.log('🚀 監控已啟動，按 Ctrl+C 停止\n');

  log('🚀 開始監控');

  // 立即執行一次
  await scrapeAllMarkets();

  // 定期執行
  setInterval(async () => {
    log('---');
    await scrapeAllMarkets();
  }, CONFIG.updateInterval);

  // 每 30 分鐘顯示統計
  setInterval(() => {
    showStatistics();
  }, 30 * 60 * 1000);

  // 處理終止信號
  process.on('SIGINT', () => {
    log('🛑 監控已停止');
    console.log('\n再見！');
    process.exit(0);
  });
}

/**
 * 主函數
 */
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--once') {
    // 單次運行
    await scrapeAllMarkets();
  } else if (args[0] === '--stats') {
    // 只顯示統計
    showStatistics();
  } else {
    // 定期監控
    await startMonitoring();
  }
}

main().catch(console.error);
