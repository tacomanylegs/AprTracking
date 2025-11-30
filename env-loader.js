/**
 * Unified Environment Loader
 * 
 * 統一管理 .env 文件加載邏輯
 * 優先順序：
 *   1. 命令行參數 --env-path
 *   2. 環境變數 ENV_PATH
 *   3. 預設位置 <project-root>/.env
 */

const path = require('path');
const fs = require('fs');

let envPathCache = null;
let isLoaded = false;

/**
 * 確定 .env 文件路徑
 * @returns {string} .env 文件的絕對路徑
 */
function resolveEnvPath() {
  // 返回緩存的路徑
  if (envPathCache) {
    return envPathCache;
  }

  let envPath;

  // 優先順序 1: 命令行參數 --env-path
  const args = process.argv.slice(2);
  const envPathIdx = args.indexOf('--env-path');
  
  if (envPathIdx !== -1 && args[envPathIdx + 1]) {
    envPath = args[envPathIdx + 1];
    console.log(`📝 ENV_PATH from --env-path argument: ${envPath}`);
  }
  // 優先順序 2: 環境變數 ENV_PATH
  else if (process.env.ENV_PATH) {
    envPath = process.env.ENV_PATH;
    console.log(`📝 ENV_PATH from environment variable: ${envPath}`);
  }
  // 優先順序 3: 預設位置 (項目根目錄的 .env)
  else {
    // 向上遍歷找到項目根目錄 (查找 package.json)
    let currentDir = __dirname;
    let foundRoot = null;
    
    for (let i = 0; i < 5; i++) { // 最多向上 5 層
      if (fs.existsSync(path.join(currentDir, 'package.json'))) {
        foundRoot = currentDir;
        break;
      }
      currentDir = path.dirname(currentDir);
    }

    envPath = foundRoot 
      ? path.join(foundRoot, '.env')
      : path.join(__dirname, '.env');
    
    console.log(`📝 ENV_PATH from default location: ${envPath}`);
  }

  // 緩存路徑
  envPathCache = path.resolve(envPath);
  
  // 設定全局環境變數，供子進程使用
  process.env.ENV_PATH = envPathCache;
  
  return envPathCache;
}

/**
 * 加載 .env 文件
 * @returns {object} { path: string, success: boolean, error?: Error }
 */
function load() {
  if (isLoaded) {
    return { 
      path: envPathCache, 
      success: true,
      message: '✅ .env already loaded'
    };
  }

  try {
    const envPath = resolveEnvPath();

    // 嘗試加載 dotenv
    try {
      require('dotenv').config({ path: envPath });
    } catch (error) {
      console.warn('⚠️  dotenv not available, loading .env manually');
      // 手動加載 .env (如果 dotenv 不可用)
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').trim();
            // 移除引號 (如果有)
            const cleanValue = value.replace(/^["']|["']$/g, '');
            process.env[key.trim()] = cleanValue;
          }
        });
      }
    }

    isLoaded = true;
    console.log(`✅ Environment loaded from: ${envPath}`);
    
    return { 
      path: envPath, 
      success: true 
    };

  } catch (error) {
    console.error(`❌ Failed to load environment: ${error.message}`);
    return { 
      path: null, 
      success: false, 
      error 
    };
  }
}

/**
 * 獲取已加載的 .env 路徑
 * @returns {string|null}
 */
function getEnvPath() {
  return envPathCache || resolveEnvPath();
}

/**
 * 驗證環境變數是否已加載
 * @returns {boolean}
 */
function isEnvironmentReady() {
  return isLoaded;
}

/**
 * 強制重新加載 (測試用)
 */
function reload() {
  isLoaded = false;
  envPathCache = null;
  return load();
}

module.exports = {
  load,
  getEnvPath,
  isEnvironmentReady,
  reload,
  resolveEnvPath
};
