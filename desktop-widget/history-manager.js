const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class HistoryManager {
  constructor(baseDir = 'history', retentionDays = 7) {
    this.baseDir = path.join(__dirname, baseDir);
    this.retentionDays = retentionDays;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getFilePath(market, dateStr) {
    return path.join(this.baseDir, `${market}-${dateStr}.json`);
  }

  /**
   * 添加一筆紀錄
   * @param {string} market 市場名稱 (usdt, usdc, mmt, volos-vault1, etc)
   * @param {object} data 數據對象
   */
  addEntry(market, data) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const filePath = this.getFilePath(market, dateStr);
    
    let entries = [];
    
    // 讀取當天的現有數據
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        entries = JSON.parse(content);
      } catch (e) {
        console.error(`Error reading history file ${filePath}:`, e);
      }
    }
    
    // 添加新數據
    entries.push({
      timestamp: now.toISOString(),
      ...data
    });
    
    // 寫回文件
    try {
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    } catch (e) {
      console.error(`Error writing history file ${filePath}:`, e);
    }
    
    // 執行維護（壓縮與清理）
    this.performMaintenance(market);
  }

  /**
   * 執行維護：壓縮舊檔案，刪除過期檔案
   */
  performMaintenance(market) {
    try {
      const files = fs.readdirSync(this.baseDir).filter(f => f.startsWith(market + '-'));
      const today = new Date().toISOString().split('T')[0];
      
      files.forEach(file => {
        // 解析日期: market-YYYY-MM-DD.json 或 .json.gz
        const match = file.match(/(\d{4}-\d{2}-\d{2})/);
        if (!match) return;
        
        const fileDateStr = match[1];
        const fileDate = new Date(fileDateStr);
        const now = new Date();
        // 計算天數差 (毫秒 -> 天)
        const diffTime = now - fileDate;
        const diffDays = diffTime / (1000 * 60 * 60 * 24); 

        const filePath = path.join(this.baseDir, file);

        // 1. 刪除超過保留天數的檔案
        if (diffDays > this.retentionDays) {
          fs.unlinkSync(filePath);
          // console.log(`Deleted old history: ${file}`);
          return;
        }

        // 2. 壓縮非今天的 .json 檔案
        if (fileDateStr !== today && file.endsWith('.json') && !file.endsWith('.gz')) {
          try {
            const content = fs.readFileSync(filePath);
            const compressed = zlib.gzipSync(content);
            fs.writeFileSync(filePath + '.gz', compressed);
            fs.unlinkSync(filePath); // 刪除原始檔
            // console.log(`Compressed history: ${file}`);
          } catch (e) {
            console.error(`Error compressing file ${file}:`, e);
          }
        }
      });
    } catch (e) {
      console.error('Error during maintenance:', e);
    }
  }
  
  /**
   * 獲取最近的統計數據 (預設讀取當天)
   */
  getStats(market) {
    const dateStr = new Date().toISOString().split('T')[0];
    const filePath = this.getFilePath(market, dateStr);
    
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.error(`Error reading stats from ${filePath}:`, e);
      }
    }
    return [];
  }
}

module.exports = new HistoryManager();
