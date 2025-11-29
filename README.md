# DeFi APR Tracking Tool

這是一個綜合性的 DeFi APR 監控工具，支援多個協議的收益率查詢與追蹤，並提供 **MMT Finance 自動調倉** 功能。

## 🚀 支援協議

| 協議 | 監控項目 | 說明 |
|------|----------|------|
| **TakaraLend** | USDT / USDC Supply APR | 穩定幣存款收益 |
| **MMT Finance** | USDC-USDT LP Estimated APR | 流動性挖礦預估收益 |
| **Volos UI** | Stable Vault #1 & #2 APR | 穩定幣機槍池收益 |

## 🆕 自動調倉功能

當 MMT USDC 價格超出設定範圍時，系統可自動：
1. 贖回現有流動性倉位
2. 根據當前價格計算新的 ±0.01% tick 範圍
3. 開新倉位並重新加入流動性
4. 發送 Telegram 通知

### 設定方式

1. 複製 `.env.example` 到 `.env`（放在專案外層或任意位置）
2. 填入 Sui 錢包私鑰：

```bash
SUI_PRIVATE_KEY=your_hex_or_base64_private_key
MMT_POOL_ID=0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b
```

3. 手動測試（.env 在預設位置時）：

```bash
cd desktop-widget
run-add-liquidity.bat --dry-run              # 模擬執行
run-add-liquidity.bat                        # 實際執行
run-add-liquidity.bat --range 0.02           # 使用 ±0.02% 範圍
```

4. 如果 .env 不在預設位置，使用 `--env-path` 參數指定：

```bash
run-add-liquidity.bat --env-path "D:\config\.env" --dry-run
run-add-liquidity.bat --env-path "C:\Users\User\.env"
```

5. 或透過環境變數指定：

```powershell
$env:ENV_PATH = "D:\custom\path\.env"
node add-liquidity.js --dry-run

# 或使用 set 命令
set ENV_PATH=D:\custom\path\.env
node add-liquidity.js
```

### 工作原理

- 桌面小工具每 30 分鐘檢查價格
- 當價格超出範圍時觸發通知
- 如果 `.env` 設定了 `SUI_PRIVATE_KEY`，會自動執行調倉
- 調倉完成後更新價格範圍並發送 Telegram 通知

#### .env 檔案位置搜尋順序

1. **命令行參數** `--env-path` - 最高優先級
2. **環境變數** `ENV_PATH` - 次優先級  
3. **預設位置** `../../../.env` (相對於 add-liquidity.js) - 最低優先級

## 🛠️ 安裝

確保已安裝 Node.js (v16+)，然後安裝依賴：

```bash
npm install
```

## 📖 使用說明

### 1. 統一查詢工具 (推薦)

使用 `monitors/apr-monitor.js` 可以一次查詢所有或特定協議的 APR，支援平行處理，速度最快。

```bash
# 查詢所有協議 (TakaraLend, MMT, Volos)
node monitors/apr-monitor.js

# 只查詢 MMT Finance
node monitors/apr-monitor.js --mmt

# 只查詢 TakaraLend (USDT & USDC)
node monitors/apr-monitor.js --takaralend

# 只查詢 Volos UI
node monitors/apr-monitor.js --volos
```

### 2. 獨立監控工具

如果您需要針對特定協議進行持續監控或查看歷史統計，可以使用以下獨立腳本。

#### TakaraLend 監控 (`monitors/takaralend-monitor.js`)

```bash
# 單次查詢
node monitors/takaralend-monitor.js --once

# 持續監控 (每 5 分鐘更新)
node monitors/takaralend-monitor.js

# 查看歷史統計
node monitors/takaralend-monitor.js --stats
```

#### MMT Finance 監控 (`monitors/mmt-monitor.js`)

```bash
# 單次查詢
node monitors/mmt-monitor.js --once

# 持續監控
node monitors/mmt-monitor.js

# 查看歷史統計
node monitors/mmt-monitor.js --stats
```

#### Volos UI 查詢 (`monitors/volos-monitor.js`)

```bash
# 單次查詢 Vault #1 和 #2
node monitors/volos-monitor.js
```

## 📊 數據存儲

各協議的歷史數據會自動保存在 JSON 文件中（預設保留最近 1000 筆）：

- `usdt-apr-history.json`: TakaraLend USDT
- `usdc-apr-history.json`: TakaraLend USDC
- `mmt-apr-history.json`: MMT Finance
- `volos-apr-history.json`: Volos UI Vaults

## ⚙️ 技術細節

- **核心技術**: Puppeteer (Headless Chrome)
- **並行處理**: 使用 `Promise.all` 同時查詢多個目標，大幅縮短等待時間。
- **動態提取**: 針對 SPA (Single Page Application) 網頁，使用 DOM 解析與正則表達式提取動態渲染的數值。
- **自動重試**: 內建錯誤處理與超時機制。

## 📝 專案結構

```
D:\Code\AprTracking
├── monitors/                    # 監控腳本資料夾
│   ├── apr-monitor.js           # 統一查詢入口 (Main)
│   ├── takaralend-monitor.js    # TakaraLend 專用監控
│   ├── mmt-monitor.js           # MMT Finance 專用監控
│   └── volos-monitor.js         # Volos UI 專用查詢
├── history/                     # 歷史數據資料夾
├── history-manager.js           # 歷史數據管理器
├── .env.example                 # 環境變數範本
├── package.json                 # 專案配置
└── desktop-widget/              # Electron 桌面小工具
    ├── main.js                  # Electron 主程序
    ├── scripts/
    │   └── add-liquidity.js     # 自動調倉腳本
    ├── run-add-liquidity.bat    # 手動調倉執行檔
    └── .env                     # 環境變數 (不納入版控)
```

## 🔐 安全注意事項

- **永遠不要**將 `.env` 檔案提交到版本控制
- 私鑰僅存放在本機 `.env` 中
- 建議使用專用錢包進行自動化操作
- 首次使用請先用 `--dry-run` 模式測試
