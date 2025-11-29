#!/usr/bin/env node

/**
 * 快速測試：.env 路徑配置功能
 * 
 * 用法：
 *   node test-env-path.js                           # 使用預設位置
 *   node test-env-path.js --env-path "/path/.env"   # 指定路徑
 *   ENV_PATH="/path/.env" node test-env-path.js     # 環境變數
 */

const path = require('path');

console.log('\n🧪 .env 路徑配置測試\n');

// 模擬 loadDotenv 函數（與 add-liquidity.js 相同的邏輯）
function loadDotenv() {
  const args = process.argv.slice(2);
  const envPathIdx = args.indexOf('--env-path');
  let envPath;
  let source;
  
  if (envPathIdx !== -1 && args[envPathIdx + 1]) {
    // 從命令行參數讀取
    envPath = args[envPathIdx + 1];
    source = '命令行參數 (--env-path)';
  } else if (process.env.ENV_PATH) {
    // 從環境變數讀取
    envPath = process.env.ENV_PATH;
    source = '環境變數 (ENV_PATH)';
  } else {
    // 使用預設位置
    envPath = path.join(__dirname, '..', '..', '.env');
    source = '預設位置';
  }
  
  return { envPath, source };
}

// 執行測試
const { envPath, source } = loadDotenv();

console.log('📝 .env 檔案位置資訊:');
console.log(`  來源: ${source}`);
console.log(`  路徑: ${envPath}`);
console.log();

// 檢查檔案是否存在
const fs = require('fs');
if (fs.existsSync(envPath)) {
  console.log(`✅ 檔案存在`);
  const stats = fs.statSync(envPath);
  console.log(`  大小: ${stats.size} bytes`);
  console.log(`  修改時間: ${stats.mtime.toLocaleString('zh-TW')}`);
  
  // 讀取前幾行（不顯示敏感資訊）
  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n').filter(line => !line.includes('=') || !line.match(/KEY|TOKEN|SECRET|PASSWORD/i));
  console.log(`  行數: ${content.split('\n').length}`);
} else {
  console.log(`⚠️  檔案不存在`);
}

console.log();

// 提示使用方式
console.log('💡 使用提示:');
console.log('  預設位置: node test-env-path.js');
console.log('  自訂路徑: node test-env-path.js --env-path "D:\\config\\.env"');
console.log('  環境變數: ENV_PATH="C:\\secrets\\.env" node test-env-path.js');
console.log();
