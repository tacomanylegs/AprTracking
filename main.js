const { app, BrowserWindow, Tray, Menu, ipcMain, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

// ============ Load Environment Config ============
// 首先加載用户配置中的 ENV_PATH (如有設定)
require("./env-config");

// ============ Load Environment ============
// 使用統一的 env-loader，優先順序：
// 1. env-config.js 中的設定 (最高優先)
// 2. --env-path 命令行參數
// 3. ENV_PATH 環境變數
// 4. 預設位置
const envLoader = require("./src/utils/env-loader");
envLoader.load();

// Import monitors
const mmtMonitor = require("./src/monitors/mmt-monitor");
const takaralendMonitor = require("./src/monitors/takaralend-monitor");
const volosMonitor = require("./src/monitors/volos-monitor");
const sheetsManager = require("./src/services/google-sheets-manager");
const TelegramNotifier = require("./src/services/telegram-notifier");
const rebalancer = require("./src/scripts/add-liquidity");

let tray = null;
let mainWindow = null;
let updateInterval = null;
let rebalanceInterval = null;
let lastAlertedPrice = null; // Track last price that triggered alert
let currentPriceRange = { min: 0.9, max: 1.1 }; // Current buy price range
let isAlertState = false; // Current alert state for badge color
let autoRebalanceEnabled = true; // 自動換倉開關
let lastRebalanceResult = null; // 最近一次換倉結果
const telegramNotifier = new TelegramNotifier();

// Configuration
const WINDOW_WIDTH = 350;
const WINDOW_HEIGHT = 645;
const UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const REBALANCE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const HISTORY_FILE = path.join(__dirname, "history", "apr-history.json");

// Ensure history directory exists
if (!fs.existsSync(path.dirname(HISTORY_FILE))) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false, // Don't show until requested
    autoHideMenuBar: true, // Hide the menu bar
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simple IPC
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Handle user manually restoring/unmaximizing the window
  mainWindow.on("unmaximize", () => {
    mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT, true);
    mainWindow.webContents.send("window-restored");
  });

  // Handle user manually maximizing the window
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window-maximized");
  });

  // Set initial loading icon
  mainWindow.webContents.on("did-finish-load", () => {
    updateTrayIcon("?");
  });
}

function createTray() {
  tray = new Tray(createCanvasIcon("...")); // Initial placeholder

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open History", click: () => mainWindow.show() },
    { label: "Refresh Now", click: () => fetchAndDisplayData() },
    { type: "separator" },
    { 
      label: "Auto Rebalance", 
      type: "checkbox",
      checked: autoRebalanceEnabled,
      click: (menuItem) => {
        autoRebalanceEnabled = menuItem.checked;
        console.log(`🔄 Auto rebalance ${autoRebalanceEnabled ? 'enabled' : 'disabled'}`);
        if (mainWindow) {
          mainWindow.webContents.send('rebalance-status-changed', { enabled: autoRebalanceEnabled });
        }
      }
    },
    { label: "Rebalance Now", click: () => runRebalanceCheck() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("DeFi APR Monitor");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Helper to create a tray icon with text
function createCanvasIcon(text) {
  return path.join(__dirname, "assets", "icon.png"); // Fallback
}

async function updateTrayIcon(text) {
  if (mainWindow) {
    // If text is an array (data), extract the best APR
    if (Array.isArray(text)) {
      const bestItem = text.reduce((prev, current) =>
        (prev.apr ?? 0) > (current.apr ?? 0) ? prev : current
      );
      const iconText = bestItem?.apr ? `${Math.round(bestItem.apr)}` : "?";
      mainWindow.webContents.send("generate-icon", { text: iconText, isAlert: isAlertState });
    } else {
      mainWindow.webContents.send("generate-icon", { text, isAlert: isAlertState });
    }
  }
}

// Receive generated icon from renderer
ipcMain.on("icon-generated", (event, dataUrl) => {
  try {
    const img = require("electron").nativeImage.createFromDataURL(dataUrl);
    if (tray) tray.setImage(img);
  } catch (e) {
    console.error("Failed to set tray icon", e);
  }
});

ipcMain.on("refresh-request", () => {
  fetchAndDisplayData();
});

ipcMain.on("maximize-window", (event) => {
  if (mainWindow) {
    mainWindow.maximize();
  }
});

ipcMain.on("restore-window", (event) => {
  if (mainWindow) {
    mainWindow.unmaximize();
    mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT, true);
  }
});

async function fetchAndDisplayData() {
  console.log("Fetching APR data...");
  if (tray) tray.setToolTip("Updating...");

  try {
    // Update buy price range from Google Sheets before checking
    const newRange = await sheetsManager.getBuyPriceRange();
    if (newRange) {
        currentPriceRange = newRange;
        console.log(`🔄 Updated buy price range from Sheets: ${currentPriceRange.min} - ${currentPriceRange.max}`);
        
        // Update UI with new price range
        if (mainWindow) {
            mainWindow.webContents.send('initial-buy-price', currentPriceRange);
        }
    }

    // // Parallel fetch
    // const [takaraUsdt, takaraUsdc, volos] = await Promise.all([
    //   takaralendMonitor.getAPR("USDT").catch((e) => null),
    //   takaralendMonitor.getAPR("USDC").catch((e) => null),
    //   volosMonitor
    //     .queryVaults()
    //     .catch((e) => ({ vault_1: null, vault_2: null })),
    // ]);

    // Parallel fetch
    const [takaraUsdt, takaraUsdc, mmtResult] = await Promise.all([
      takaralendMonitor.getAPR("USDT").catch((e) => null),
      takaralendMonitor.getAPR("USDC").catch((e) => null),
      mmtMonitor.getAPR().catch((e) => ({ apr: null, usdcPrice: null }))
    ]);

    // Handle MMT result (now returns object with apr and usdcPrice)
    const mmtApr = mmtResult?.apr ?? null;
    const mmtUsdcPrice = mmtResult?.usdcPrice ?? null;

    const results = [
      {
        name: "Takara USDT",
        apr: takaraUsdt ?? null,
      },
      {
        name: "Takara USDC",
        apr: takaraUsdc ?? null,
      },
      {
        name: "MMT",
        apr: mmtApr,
        usdcPrice: mmtUsdcPrice,
      },
      // {
      //   name: "Volos V1",
      //   apr: volos?.vault_1 ?? null,
      // },
      // {
      //   name: "Volos V2",
      //   apr: volos?.vault_2 ?? null,
      // },
    ];

    // Check price alert for MMT
    if (mmtUsdcPrice !== null) {
      const isPriceAlert = mmtUsdcPrice < currentPriceRange.min || mmtUsdcPrice > currentPriceRange.max;
      
      // Only trigger notification if:
      // 1. Price is outside range
      // 2. Current price is different from last alerted price (new price change)
      if (isPriceAlert && mmtUsdcPrice !== lastAlertedPrice) {
        showPriceAlert(mmtUsdcPrice, currentPriceRange);
        lastAlertedPrice = mmtUsdcPrice;
        isAlertState = true;
      } else if (!isPriceAlert) {
        isAlertState = false;
      }
    }

    // Filter nulls and find max
    const validResults = results.filter(
      (r) => r.apr !== null && r.apr !== undefined
    );
    validResults.sort((a, b) => b.apr - a.apr);

    const best = validResults.length > 0 ? validResults[0] : null;
    const bestAprStr = best ? `${best.apr}%` : "N/A";
    const iconText = best ? `${Math.round(best.apr)}` : "?";

    console.log("Best APR:", bestAprStr);

    // Update Tray
    updateTrayIcon(iconText);
    tray.setToolTip(`Best: ${bestAprStr} (${best ? best.name : ""})`);

    // Save History
    saveHistory(results);

    // Notify renderer to update chart if open
    mainWindow.webContents.send("data-updated", readHistory());
  } catch (error) {
    console.error("Error fetching data:", error);
    if (tray) tray.setToolTip("Error fetching data");
  }
}

function saveHistory(data) {
  const now = new Date().toISOString();
  // Remove URL fields before saving
  const cleanData = data.map(({ url, ...rest }) => rest);
  const entry = { timestamp: now, data: cleanData };

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    } catch (e) {
      console.error("Read history failed", e);
    }
  }

  history.push(entry);
  if (history.length > 3000) history = history.slice(-3000);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  // Also save to Google Sheets
  sheetsManager.appendHistory([entry]).catch((e) => {
    console.warn("Failed to save to Google Sheets:", e.message);
  });
}

function readHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Sync history from Google Sheets to local, skip duplicates
 */
async function syncHistoryFromSheets() {
  try {
    const remoteHistory = await sheetsManager.fetchAllHistory();
    if (!remoteHistory || remoteHistory.length === 0) {
      console.log("📭 No remote history to sync");
      return;
    }

    let localHistory = readHistory();

    // Create a Set of existing timestamps for quick lookup
    const existingTimestamps = new Set(
      localHistory.map((entry) => new Date(entry.timestamp).getTime())
    );

    // Add new entries from remote
    let newEntries = 0;
    for (const entry of remoteHistory) {
      const entryTime = new Date(entry.timestamp).getTime();
      if (!existingTimestamps.has(entryTime)) {
        localHistory.push(entry);
        existingTimestamps.add(entryTime);
        newEntries++;
      }
    }

    if (newEntries > 0) {
      // Sort by timestamp
      localHistory.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // Keep only last 3000 entries
      if (localHistory.length > 3000) {
        localHistory = localHistory.slice(-3000);
      }

      // Save to local file
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(localHistory, null, 2));
      console.log(`✅ Synced ${newEntries} new entries from Google Sheets`);
    } else {
      console.log("✅ Local history is up to date");
    }
  } catch (error) {
    console.error("❌ Failed to sync history:", error.message);
  }
}

ipcMain.handle("get-history", () => {
  return readHistory();
});

// Get buy price range from Google Sheets
ipcMain.handle("get-buy-price", async () => {
  return currentPriceRange;
});

// Set buy price range and save to Google Sheets
ipcMain.handle("set-buy-price", async (event, range) => {
  const min = parseFloat(range.min);
  const max = parseFloat(range.max);
  
  if (isNaN(min) || isNaN(max)) return false;
  
  currentPriceRange = { min, max };
  lastAlertedPrice = null; // Reset alert when buy price changes
  isAlertState = false;
  
  // Save to Google Sheets
  const success = await sheetsManager.setBuyPriceRange(min, max);
  console.log(`💰 Buy price range updated: ${min} - ${max}`);
  
  // Update icon to remove alert state
  const history = readHistory();
  if (history.length > 0) {
    updateTrayIcon(history[history.length - 1].data);
  }
  
  return success;
});

// Get current alert state
ipcMain.handle("get-alert-state", () => {
  return { isAlert: isAlertState, priceRange: currentPriceRange };
});

// Get rebalance status
ipcMain.handle("get-rebalance-status", () => {
  return { 
    enabled: autoRebalanceEnabled, 
    lastResult: lastRebalanceResult,
    intervalMs: REBALANCE_INTERVAL_MS,
  };
});

// Toggle auto rebalance
ipcMain.handle("set-rebalance-enabled", (event, enabled) => {
  autoRebalanceEnabled = enabled;
  console.log(`🔄 Auto rebalance ${autoRebalanceEnabled ? 'enabled' : 'disabled'}`);
  return autoRebalanceEnabled;
});

// Manually trigger rebalance
ipcMain.handle("trigger-rebalance", async () => {
  return await runRebalanceCheck();
});

/**
 * Show Windows notification for price alert
 */
function showPriceAlert(currentPrice, range) {
  const message = `⚠️ MMT 價格警報: ${currentPrice} USDC\n(設定範圍: ${range.min} - ${range.max})`;
  
  // 1. Windows Notification
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: '⚠️ MMT 通知',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      silent: false
    });

    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.show();
  } else {
    console.warn('⚠️  Notifications not supported');
  }

  // 2. Telegram Notification
  const mmtUrl = 'https://app.mmt.finance/liquidity/0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b';
  const tgMessage = `
<b>⚠️ MMT 價格警報</b>

💰 <b>當前價格:</b> ${currentPrice} USDC
🎯 <b>設定範圍:</b> ${range.min} - ${range.max}

<a href="${mmtUrl}">🔗 前往 MMT Finance</a>

<i>請檢查您的倉位，若需調整通知範圍，請至桌面小工具設定。</i>
`;

  telegramNotifier.sendMessage(tgMessage).catch(err => {
    console.error('❌ Telegram notification failed:', err.message);
  });

  console.log(`🚨 Price alert triggered: ${currentPrice} (Range: ${range.min}-${range.max})`);
}

/**
 * 執行自動換倉檢查
 */
async function runRebalanceCheck() {
  if (!autoRebalanceEnabled) {
    console.log('⏸️  Auto rebalance is disabled, skipping...');
    return;
  }

  console.log('🔄 Running auto rebalance check...');
  
  // 通知 UI 開始換倉檢查
  if (mainWindow) {
    mainWindow.webContents.send('rebalance-started');
  }

  try {
    const result = await rebalancer.runAutoRebalance({
      dryRun: false,
      force: false,
    });

    lastRebalanceResult = {
      ...result,
      timestamp: new Date().toISOString(),
    };

    // 通知 UI 換倉結果
    if (mainWindow) {
      mainWindow.webContents.send('rebalance-completed', lastRebalanceResult);
    }

    // 如果執行了換倉，發送 Telegram 通知
    if (result.rebalanceExecuted) {
      const txUrl = result.digest 
        ? `https://suiscan.xyz/mainnet/tx/${result.digest}`
        : null;
      
      const tgMessage = `
<b>🔄 MMT 自動換倉完成</b>

✅ <b>狀態:</b> ${result.success ? '成功' : '失敗'}
📊 <b>Pool ID:</b> <code>${result.poolId}</code>
${result.tickRange ? `📈 <b>新價格範圍:</b> ${parseFloat(result.tickRange.lowerPrice).toFixed(6)} - ${parseFloat(result.tickRange.upperPrice).toFixed(6)}` : ''}
${txUrl ? `\n<a href="${txUrl}">🔗 查看交易</a>` : ''}

<i>自動換倉已於 ${new Date().toLocaleString('zh-TW')} 執行</i>
`;

      telegramNotifier.sendMessage(tgMessage).catch(err => {
        console.error('❌ Telegram notification failed:', err.message);
      });

      console.log(`✅ Rebalance executed successfully: ${result.digest || 'N/A'}`);
    } else if (result.rebalanceNeeded === false) {
      console.log('✅ No rebalance needed - positions are in range');
    } else if (result.error) {
      console.error(`❌ Rebalance error: ${result.error}`);
      
      // 發送錯誤通知
      const tgMessage = `
<b>❌ MMT 自動換倉失敗</b>

🚫 <b>錯誤:</b> ${result.error}
📊 <b>Pool ID:</b> <code>${result.poolId}</code>

<i>請檢查錢包餘額和私鑰設定</i>
`;

      telegramNotifier.sendMessage(tgMessage).catch(err => {
        console.error('❌ Telegram notification failed:', err.message);
      });
    }

    return result;

  } catch (error) {
    console.error('❌ Rebalance check failed:', error.message);
    
    lastRebalanceResult = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };

    if (mainWindow) {
      mainWindow.webContents.send('rebalance-completed', lastRebalanceResult);
    }

    return lastRebalanceResult;
  }
}

process.on("unhandledRejection", (reason, p) => {
  console.error("Unhandled Rejection at:", p, "reason:", reason);
});

app.whenReady().then(async () => {
  console.log("App Ready");
  
  // ========== Startup Flow ==========

  // Step 0: Load buy price from Google Sheets (BEFORE creating window)
  console.log("💰 Step 0: Loading buy price range from Google Sheets...");
  currentPriceRange = await sheetsManager.getBuyPriceRange();
  console.log(`✅ Buy price range loaded: ${currentPriceRange.min} - ${currentPriceRange.max}`);
  
  // Now create window and tray
  createWindow();
  createTray();
  
  // Send initial buy price to renderer once window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('initial-buy-price', currentPriceRange);
  });

  // Step 1: Fetch online history from Google Sheets
  console.log("📥 Step 1: Fetching online history from Google Sheets...");
  const auth = await sheetsManager.getAuthClient();
  if (auth) {
    console.log("✅ Google Sheets Service Account ready");

    // Step 2: Sync online history with local file
    console.log("🔄 Step 2: Syncing online history to local file...");
    await syncHistoryFromSheets();
  } else {
    console.warn(
      "⚠️  Google Sheets Service Account not found, using local data only"
    );
  }

  // Step 3: Load complete local history into memory
  console.log("📂 Step 3: Loading local history into memory...");
  const history = readHistory();
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;

  if (lastEntry) {
    console.log(
      `✅ Loaded ${history.length} history entries, latest: ${new Date(
        lastEntry.timestamp
      ).toLocaleString()}`
    );
  } else {
    console.log("📭 No history found");
  }

  // Step 4: Update system badge with APR number
  console.log("🔢 Step 4: Updating system badge APR...");

  if (lastEntry) {
    // Send data to renderer to update UI
    mainWindow.webContents.send("data-updated", history);

    // Update tray icon number
    updateTrayIcon(lastEntry.data);

    // Update tray tooltip
    const validResults = lastEntry.data.filter(
      (r) => r.apr !== null && r.apr !== undefined
    );
    if (validResults.length > 0) {
      const best = validResults.reduce((prev, current) =>
        (prev.apr ?? 0) > (current.apr ?? 0) ? prev : current
      );
      tray.setToolTip(`Best: ${best.apr}% (${best.name})`);
      console.log(`✅ Badge updated: ${Math.round(best.apr)}% (${best.name})`);
    }
  }

  // Check if new data fetch is needed
  const lastUpdateTime = lastEntry
    ? new Date(lastEntry.timestamp).getTime()
    : 0;
  const now = new Date().getTime();
  const timeSinceLastUpdate = now - lastUpdateTime;

  if (!lastEntry || timeSinceLastUpdate >= UPDATE_INTERVAL_MS) {
    console.log("⏰ Data expired, fetching new data...");
    fetchAndDisplayData();
  } else {
    console.log(
      `✅ Data still valid (${Math.round(timeSinceLastUpdate / 1000)}s ago)`
    );
    
    // Check MMT price alert even if data is still valid
    if (lastEntry) {
      const mmtEntry = lastEntry.data.find(d => d.name === 'MMT');
      if (mmtEntry && mmtEntry.usdcPrice !== null) {
        const isPriceAlert = mmtEntry.usdcPrice < currentPriceRange.min || mmtEntry.usdcPrice > currentPriceRange.max;
        
        if (isPriceAlert && mmtEntry.usdcPrice !== lastAlertedPrice) {
          console.log("🚨 Checking initial price alert on startup...");
          showPriceAlert(mmtEntry.usdcPrice, currentPriceRange);
          lastAlertedPrice = mmtEntry.usdcPrice;
          isAlertState = true;
          
          // Update tray icon with alert color
          updateTrayIcon(lastEntry.data);
        } else if (!isPriceAlert) {
          isAlertState = false;
        }
      }
    }
  }

  // Schedule periodic updates
  updateInterval = setInterval(fetchAndDisplayData, UPDATE_INTERVAL_MS);
  console.log(
    `⏱️  Scheduled auto-update every ${UPDATE_INTERVAL_MS / 60000} minutes`
  );

  // Schedule periodic rebalance checks
  rebalanceInterval = setInterval(runRebalanceCheck, REBALANCE_INTERVAL_MS);
  console.log(
    `🔄 Scheduled auto-rebalance check every ${REBALANCE_INTERVAL_MS / 60000} minutes`
  );

  // Run initial rebalance check (after a short delay to let UI load)
  setTimeout(() => {
    console.log('🔄 Running initial rebalance check...');
    runRebalanceCheck();
  }, 5000);
});

app.on("window-all-closed", () => {
  // Do nothing, keep running in tray
});
