# DeFi APR Tracking Tool

這是一個綜合性的 DeFi APR 監控工具，支援多個協議的收益率查詢與追蹤。

## 🚀 支援協議

| 協議 | 監控項目 | 說明 |
|------|----------|------|
| **TakaraLend** | USDT / USDC Supply APR | 穩定幣存款收益 |
| **MMT Finance** | USDC-USDT LP Estimated APR | 流動性挖礦預估收益 |
| **Volos UI** | Stable Vault #1 & #2 APR | 穩定幣機槍池收益 |

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
└── package.json                 # 專案配置
```

