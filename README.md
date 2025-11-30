# MMT Rebalancer

MMT Finance 自動換倉工具 - 自動檢查並重新平衡流動性倉位。

## 功能

- 自動檢查倉位是否離開價格區間
- 自動執行換倉操作（贖回舊倉位、開新倉位）
- 將執行結果儲存至 Google Sheets「Rebalance」分頁
- 透過 Telegram 發送通知

## 環境變數

在 `.env` 檔案中設定以下變數：

```env
# 必要
SUI_PRIVATE_KEY=suiprivkey...          # Sui 錢包私鑰
GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json

# 選用
DEFAULT_RANGE_PERCENT=0.0001           # 預設價格範圍 ±0.01%

# Telegram 通知（選用）
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## 安裝

```bash
npm install
```

## 使用方式

### 正式執行
```bash
node index.js
```

### 模擬執行（不送交易）
```bash
node index.js --dry-run
```

### 強制執行（即使倉位在範圍內）
```bash
node index.js --force
```

### 使用批次檔測試
```bash
run-rebalancer.bat
```

## 專案結構

```
AprTracking/
├── index.js                  # 主程式入口
├── rebalancer.js             # 換倉核心邏輯
├── google-sheets-manager.js  # Google Sheets API
├── telegram-notifier.js      # Telegram 通知
├── env-loader.js             # 環境變數載入
├── env-config.js             # .env 路徑設定
├── package.json              # 依賴設定
└── run-rebalancer.bat        # 測試用批次檔
```

## Pool 設定

Pool 設定直接寫在 `index.js` 的 `POOLS` 陣列中：

- `0xb0a...543b` - MMT 0.01% (USDC-USDT) - 已啟用
- `0x737...06a9` - MMT 0.001% (USDC-USDT) - 已停用

如需新增或修改 Pool，請直接編輯 `index.js` 中的 `POOLS` 陣列。

## Google Sheets 輸出

換倉結果會寫入「Rebalance」分頁，欄位包含：
- 時間戳記
- Pool ID
- Pool 名稱
- 執行結果

## License

ISC
