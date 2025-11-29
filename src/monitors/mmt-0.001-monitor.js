/**
 * MMT Finance 0.001% 池 Estimated APR 爬蟲
 * 使用方式:
 *   node mmt-0.001-monitor.js --once    # 單次查詢
 *   node mmt-0.001-monitor.js            # 持續監控
 *   node mmt-0.001-monitor.js --stats    # 查看統計
 */

const puppeteer = require('puppeteer');
const historyManager = require('../services/history-manager');

const POOL = {
  name: 'MMT 0.001%',
  url: 'https://app.mmt.finance/liquidity/0x737ec6a4d3ed0c7e6cc18d8ba04e7ffd4806b726c97efd89867597368c4d06a9',
  poolKey: 'mmt-0.001',
  targetAPR: 0
};

const DEFAULT_CONFIG = {
  timeout: 30000,
  updateInterval: 30 * 60 * 1000 // 30 minutes
};

/**
 * 記錄日誌
 */
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * 提取 Estimated APR 和 Set Price Range USDC 價格
 * @param {string} url 目標 URL
 */
async function scrapeEstimatedAPR(url) {
  let browser;
  try {
    console.log(`[DEBUG] Launching browser for URL: ${url}`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    console.log(`[DEBUG] Navigating to ${url}...`);
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: DEFAULT_CONFIG.timeout 
    });

    console.log(`[DEBUG] Waiting for page to settle...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    const result = await page.evaluate(() => {
      const pageText = document.body.innerText;
      
      // 尋找 "Estimated APR:" 後面的百分比數值
      // 匹配模式: Estimated APR: [換行或空白] 數值%
      const aprMatch = pageText.match(/Estimated APR:\s*[\n\r\s]*([0-9.]+)%/i);
      const apr = aprMatch && aprMatch[1] ? parseFloat(aprMatch[1]) : null;
      
      // 尋找 "Set Price Range" 段落，然後從該段落提取 USDC 價格
      // 確保只抓取當前池子的價格範圍，不會抓到其他地方的價格
      let usdcPrice = null;
      const priceRangeMatch = pageText.match(/Set Price Range[\s\S]*?([0-9]+\.[0-9]+)\s*USDC/i);
      if (priceRangeMatch && priceRangeMatch[1]) {
        usdcPrice = parseFloat(priceRangeMatch[1]);
      }
      
      return { apr, usdcPrice };
    });

    console.log(`[DEBUG] Scrape result:`, result);
    return result;

  } catch (error) {
    log(`❌ 爬蟲錯誤 (${url}): ${error.message}`);
    return { apr: null, usdcPrice: null };
  } finally {
    if (browser) {
      console.log(`[DEBUG] Closing browser for ${url}`);
      await browser.close();
    }
  }
}

/**
 * 保存數據
 * @param {number} apr APR 數值
 * @param {number} usdcPrice USDC 價格
 */
function saveData(apr, usdcPrice = null) {
  try {
    historyManager.addEntry(POOL.poolKey, {
      estimatedAPR: apr,
      usdcPrice: usdcPrice,
      success: apr !== null
    });
    return true;
  } catch (error) {
    log(`❌ 保存失敗: ${error.message}`);
    return false;
  }
}

/**
 * 獲取 APR
 */
async function getAPR() {
  return await scrapeEstimatedAPR(POOL.url);
}

/**
 * 顯示統計信息
 */
function showStatistics() {
  try {
    const history = historyManager.getStats(POOL.poolKey);
    if (history.length === 0) {
      log(`⚠️  還沒有數據 (今日) - ${POOL.poolKey}`);
      return;
    }

    const successData = history.filter(d => d.success && d.estimatedAPR);
    const values = successData.map(d => d.estimatedAPR);

    const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
    const min = Math.min(...values).toFixed(2);
    const max = Math.max(...values).toFixed(2);
    const current = values[values.length - 1].toFixed(2);

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log(`║              ${POOL.name} APR 統計信息                     ║`);
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    console.log(`📊 數據點: ${successData.length} (今日)`);
    console.log(`📈 當前值: ${current}%`);
    console.log(`📊 平均值: ${avg}%`);
    console.log(`⬇️  最小值: ${min}%`);
    console.log(`⬆️  最大值: ${max}%`);
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
    console.log(`🔍 Testing ${POOL.name}...\n`);
    console.log(`⏳ Checking ${POOL.name}...`);
    console.log(`   URL: ${POOL.url}`);
    const result = await scrapeEstimatedAPR(POOL.url);
    if (result.apr !== null) {
      console.log(`✅ ${POOL.name} APR: ${result.apr}%`);
      if (result.usdcPrice !== null) {
        console.log(`💰 USDC Price: ${result.usdcPrice} USDC`);
      }
      saveData(result.apr, result.usdcPrice);
    } else {
      console.log('❌ Failed to extract data');
      saveData(null);
    }
    console.log('\n✅ Test complete');
    process.exit(0);
  }

  // 統計模式
  if (args.includes('--stats')) {
    showStatistics();
    process.exit(0);
  }

  // 持續監控模式
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log(`║    MMT Finance 0.001% APR 持續監控器                     ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  log('🚀 啟動持續監控模式');
  log(`⏱️  更新間隔: ${DEFAULT_CONFIG.updateInterval / 1000 / 60} 分鐘\n`);

  let iterationCount = 0;

  async function monitor() {
    iterationCount++;
    
    const result = await scrapeEstimatedAPR(POOL.url);
    
    if (result.apr !== null) {
      let output = `✅ [第 ${iterationCount} 次] ${POOL.name} APR: ${result.apr}%`;
      if (result.usdcPrice !== null) {
        output += ` | USDC: ${result.usdcPrice}`;
      }
      console.log(output);
      saveData(result.apr, result.usdcPrice);
    } else {
      console.log(`❌ [第 ${iterationCount} 次] ${POOL.name} 無法提取數據`);
      saveData(null);
    }

    if (iterationCount % 6 === 0) {
      showStatistics();
    }
  }

  await monitor();
  setInterval(monitor, DEFAULT_CONFIG.updateInterval);

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
  scrapeEstimatedAPR,
  getAPR,
  POOL
};
