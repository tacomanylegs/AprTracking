const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Import monitors
const mmtMonitor = require('./monitors/mmt-monitor');
const takaralendMonitor = require('./monitors/takaralend-monitor');
const volosMonitor = require('./monitors/volos-monitor');

let tray = null;
let mainWindow = null;
let updateInterval = null;

// Configuration
const UPDATE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const HISTORY_FILE = path.join(__dirname, 'history', 'apr-history.json');

// Ensure history directory exists
if (!fs.existsSync(path.dirname(HISTORY_FILE))) {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 350,
        height: 370,
        show: false, // Don't show until requested
        autoHideMenuBar: true, // Hide the menu bar
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // For simple IPC
        },
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    tray = new Tray(createCanvasIcon('...')); // Initial placeholder

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open History', click: () => mainWindow.show() },
        { label: 'Refresh Now', click: () => fetchAndDisplayData() },
        { type: 'separator' },
        {
            label: 'Quit', click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('DeFi APR Monitor');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
}

// Helper to create a tray icon with text
function createCanvasIcon(text) {
    return path.join(__dirname, 'assets', 'icon.png'); // Fallback
}

async function updateTrayIcon(text) {
    if (mainWindow) {
        mainWindow.webContents.send('generate-icon', text);
    }
}


// Receive generated icon from renderer
ipcMain.on('icon-generated', (event, dataUrl) => {
    try {
        const img = require('electron').nativeImage.createFromDataURL(dataUrl);
        if (tray) tray.setImage(img);
    } catch (e) {
        console.error('Failed to set tray icon', e);
    }
});

ipcMain.on('refresh-request', () => {
    fetchAndDisplayData();
});

ipcMain.on('maximize-window', (event) => {
    if (mainWindow) {
        mainWindow.maximize();
    }
});

ipcMain.on('restore-window', (event) => {
    if (mainWindow) {
        mainWindow.unmaximize();
        mainWindow.setSize(350, 370, true);
    }
});

async function fetchAndDisplayData() {
    console.log('Fetching APR data...');
    if (tray) tray.setToolTip('Updating...');

    try {
        // Parallel fetch
        const [takaraUsdt, takaraUsdc, volos] = await Promise.all([
            takaralendMonitor.getAPR('USDT').catch(e => null),
            takaralendMonitor.getAPR('USDC').catch(e => null),
            volosMonitor.queryVaults().catch(e => ({ vault_1: null, vault_2: null }))
        ]);

        const results = [
            { name: 'Takara USDT', apr: takaraUsdt, url: 'https://app.takaralend.com/market/USD%E2%82%AE0' },
            { name: 'Takara USDC', apr: takaraUsdc, url: 'https://app.takaralend.com/market/USDC' },
            { name: 'Volos V2', apr: volos.vault_2, url: 'https://www.volosui.com/vaults' }
        ];

        // Filter nulls and find max
        const validResults = results.filter(r => r.apr !== null && r.apr !== undefined);
        validResults.sort((a, b) => b.apr - a.apr);


        const best = validResults.length > 0 ? validResults[0] : null;
        const bestAprStr = best ? `${best.apr}%` : 'N/A';
        const iconText = best ? `${Math.round(best.apr)}` : '?';

        console.log('Best APR:', bestAprStr);

        // Update Tray
        updateTrayIcon(iconText);
        tray.setToolTip(`Best: ${bestAprStr} (${best ? best.name : ''})`);

        // Save History
        saveHistory(results);

        // Notify renderer to update chart if open
        mainWindow.webContents.send('data-updated', readHistory());

    } catch (error) {
        console.error('Error fetching data:', error);
        if (tray) tray.setToolTip('Error fetching data');
    }
}

function saveHistory(data) {
    const now = new Date().toISOString();
    const entry = { timestamp: now, data };

    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        } catch (e) { console.error('Read history failed', e); }
    }

    history.push(entry);
    if (history.length > 3000) history = history.slice(-3000);

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function readHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        } catch (e) { return []; }
    }
    return [];
}

ipcMain.handle('get-history', () => {
    return readHistory();
});

process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

app.whenReady().then(() => {
    console.log('App Ready');
    createWindow();
    createTray();

    // Initial fetch
    fetchAndDisplayData();

    // Schedule updates
    updateInterval = setInterval(fetchAndDisplayData, UPDATE_INTERVAL_MS);
});

app.on('window-all-closed', () => {
    // Do nothing, keep running in tray
});
