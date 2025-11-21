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

const CONFIG = {
  mmt: {
    name: 'MMT Finance',
    webUrl: 'https://app.mmt.finance/liquidity/0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
    timeout: 30000
  },
  takaralend: {
    usdt: {
      name: 'TakaraLend USDT',
      webUrl: 'https://app.takaralend.com/market/USD%E2%82%AE0',
      timeout: 30000
    },
    usdc: {
      name: 'TakaraLend USDC',
      webUrl: 'https://app.takaralend.com/market/USDC',
      timeout: 30000
    }
  },
  volos: {
    name: 'Volos UI Vaults',
    webUrl: 'https://www.volosui.com/vaults',
    timeout: 30000
  }
};

/**
 * 查詢 MMT Finance APR
 */
async function queryMMT() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    await page.goto(CONFIG.mmt.webUrl, { 
      waitUntil: 'networkidle2', 
      timeout: CONFIG.mmt.timeout 
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
    console.error(`❌ MMT 查詢失敗: ${error.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 查詢 TakaraLend APR
 */
async function queryTakaraLend(market) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    const config = market === 'usdt' ? CONFIG.takaralend.usdt : CONFIG.takaralend.usdc;
    
    await page.goto(config.webUrl, { 
      waitUntil: 'networkidle2', 
      timeout: config.timeout 
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 通過 evaluate 在頁面上執行 JavaScript 提取數據
    const apr = await page.evaluate(() => {
      const pageText = document.body.innerText;
      
      // 多種提取模式
      const patterns = [
        /Supply\s+info[\s\S]*?APR[\s\n]*([0-9.]+)%/i,
        /Total[\s\S]*?Supply[\s\S]*?APR[\s\n]*([0-9.]+)%/i,
        /Supply[\s\S]*?APR[\s\n]*([0-9.]+)%/i
      ];

      for (const pattern of patterns) {
        const match = pageText.match(pattern);
        if (match && match[1]) {
          return parseFloat(match[1]);
        }
      }

      return null;
    });

    return apr;

  } catch (error) {
    console.error(`❌ TakaraLend ${market.toUpperCase()} 查詢失敗: ${error.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 查詢 Volos UI Vaults APR
 */
async function queryVolosVaults() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    await page.goto(CONFIG.volos.webUrl, { 
      waitUntil: 'networkidle2', 
      timeout: CONFIG.volos.timeout 
    });

    // 滾動頁面以加載所有 vault
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    // 提取頁面文本並解析 vault APR
    const results = await page.evaluate(() => {
      const pageText = document.body.innerText;
      const lines = pageText.split('\n');
      const results = {};

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Vault #1 檢測
        if (line.match(/Stable\s+Vault\s+#1\b/)) {
          for (let j = 1; j <= 10 && i + j < lines.length; j++) {
            const percentMatch = lines[i + j].match(/(\d+\.\d+)%/);
            if (percentMatch) {
              results.vault_1 = parseFloat(percentMatch[1]);
              break;
            }
          }
        }

        // Vault #2 檢測（排除 #12, #20, #21, #22）
        if (line.match(/Stable\s+Vault\s+#2\b/) && !line.includes('#12') && !line.includes('#20') && !line.includes('#21') && !line.includes('#22')) {
          for (let j = 1; j <= 10 && i + j < lines.length; j++) {
            const percentMatch = lines[i + j].match(/(\d+\.\d+)%/);
            if (percentMatch) {
              results.vault_2 = parseFloat(percentMatch[1]);
              break;
            }
          }
        }
      }

      return results;
    });

    return results;

  } catch (error) {
    console.error(`❌ Volos UI 查詢失敗: ${error.message}`);
    return { vault_1: null, vault_2: null };
  } finally {
    if (browser) {
      await browser.close();
    }
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

  // 顯示摘要
  console.log('\n' + '═'.repeat(60));
  console.log('📊 查詢結果摘要:\n');
  
  if (results.mmt !== undefined) {
    console.log(`MMT Finance:     ${results.mmt !== null ? results.mmt + '%' : '❌ 查詢失敗'}`);
  }
  
  if (results.usdt !== undefined) {
    console.log(`TakaraLend USDT: ${results.usdt !== null ? results.usdt + '%' : '❌ 查詢失敗'}`);
  }
  
  if (results.usdc !== undefined) {
    console.log(`TakaraLend USDC: ${results.usdc !== null ? results.usdc + '%' : '❌ 查詢失敗'}`);
  }

  if (results.vault_1 !== undefined) {
    console.log(`Volos Vault #1:  ${results.vault_1 !== null ? results.vault_1 + '%' : '❌ 查詢失敗'}`);
  }

  if (results.vault_2 !== undefined) {
    console.log(`Volos Vault #2:  ${results.vault_2 !== null ? results.vault_2 + '%' : '❌ 查詢失敗'}`);
  }
  
  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
