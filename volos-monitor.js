/**
 * Volos UI Vault APR 查詢工具
 * 目標: 提取 Stable Vault #1 (32.45%) 和 Stable Vault #2 (12.68%) 的 APR
 * 注意: APR 會隨時間動態變化，現有值已更新為最新
 * 
 * 使用方式:
 *   node volos-monitor.js              # 查詢 Vault #1 和 #2
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const historyManager = require('./history-manager');

const CONFIG = {
  webUrl: 'https://www.volosui.com/vaults',
  timeout: 30000
};

/**
 * 查詢 Vault APR
 */
async function queryVaults() {
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

    // 等待頁面渲染
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 多次滾動頁面，加載所有 Vault
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 2);
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 最後滾回頂部
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 提取所有 Vault 信息
    const vaults = await page.evaluate(() => {
      const results = {};
      const pageText = document.body.innerText;
      const lines = pageText.split('\n');
      
      // 查找 Stable Vault #1
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 精確查找 "Stable Vault #1"（但不是 #12, #13 等）
        if (line.match(/Stable\s+Vault\s+#1\b/) && !line.includes('#12') && !line.includes('#13')) {
          // 在後續 10 行查找 APR
          for (let j = 1; j <= 10 && i + j < lines.length; j++) {
            const percentMatch = lines[i + j].match(/(\d+\.\d+)%/);
            if (percentMatch) {
              results.vault_1 = parseFloat(percentMatch[1]);
              break;
            }
          }
        }
        
        // 精確查找 "Stable Vault #2"（但不是 #12, #20 等）
        if (line.match(/Stable\s+Vault\s+#2\b/) && !line.includes('#12') && !line.includes('#20') && !line.includes('#21') && !line.includes('#22')) {
          // 在後續 10 行查找 APR
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

    return vaults;

  } catch (error) {
    console.error(`❌ 查詢失敗: ${error.message}`);
    return {};
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 保存數據
 */
function saveData(vaults) {
  try {
    historyManager.addEntry('volos', {
      vault_1: vaults.vault_1 || null,
      vault_2: vaults.vault_2 || null,
      success: vaults.vault_1 !== undefined && vaults.vault_2 !== undefined
    });
    return true;
  } catch (error) {
    console.error(`❌ 保存失敗: ${error.message}`);
    return false;
  }
}

/**
 * 主程序
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           Volos UI Vault APR 查詢工具                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('🔍 查詢 Volos UI Vaults...\n');
  const vaults = await queryVaults();

  // 顯示結果
  console.log('═'.repeat(60));
  console.log('📊 查詢結果:\n');

  if (vaults.vault_1 !== undefined) {
    console.log(`✅ Stable Vault #1:  ${vaults.vault_1}%`);
  } else {
    console.log(`❌ Stable Vault #1:  查詢失敗`);
  }

  if (vaults.vault_2 !== undefined) {
    console.log(`✅ Stable Vault #2: ${vaults.vault_2}%`);
  } else {
    console.log(`❌ Stable Vault #2: 查詢失敗`);
  }

  console.log('\n' + '═'.repeat(60));

  // 保存數據
  saveData(vaults);
}

main().catch(console.error);
