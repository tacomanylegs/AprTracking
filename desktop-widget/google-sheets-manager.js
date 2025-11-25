const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Google Sheets API configuration
const SPREADSHEET_ID = '1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0';
const SHEET_NAME = 'APR';
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'service-account.json');

// URL mapping for each protocol
const URL_MAP = {
    'Takara USDT': 'https://app.takaralend.com/market/USD%E2%82%AE0',
    'Takara USDC': 'https://app.takaralend.com/market/USDC',
    'Volos V1': 'https://www.volosui.com/vaults',
    'Volos V2': 'https://www.volosui.com/vaults'
};

/**
 * Get URL for a protocol name
 */
function getUrlForName(name) {
    return URL_MAP[name] || null;
}

let authClient = null;

/**
 * Load Service Account and create auth client
 */
async function getAuthClient() {
    if (authClient) {
        return authClient;
    }

    try {
        if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
            console.error('❌ service-account.json not found');
            return null;
        }

        const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
        
        authClient = new google.auth.GoogleAuth({
            credentials: serviceAccount,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        console.log('✅ Google Sheets Service Account loaded');
        return authClient;

    } catch (error) {
        console.error('❌ Failed to load service account:', error.message);
        return null;
    }
}

/**
 * Append history entries to Google Sheet
 */
async function appendHistory(historyEntries) {
    try {
        const auth = await getAuthClient();
        if (!auth) {
            console.warn('⚠️  Google Sheets Service Account not configured, skipping upload');
            return false;
        }

        const sheets = google.sheets({ version: 'v4', auth });

        // Format data for Google Sheets
        const rows = [];
        
        historyEntries.forEach(entry => {
            const timestamp = new Date(entry.timestamp).toLocaleString('zh-TW', { 
                timeZone: 'Asia/Taipei',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            entry.data.forEach(item => {
                rows.push([
                    timestamp,
                    item.name,
                    item.apr ? item.apr.toFixed(2) : 'N/A'
                ]);
            });
        });

        if (rows.length === 0) {
            return true;
        }

        // Append to sheet
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:C`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: rows
            }
        });

        console.log(`✅ Uploaded ${rows.length} rows to Google Sheets`);
        return true;

    } catch (error) {
        console.error('❌ Failed to upload to Google Sheets:', error.message);
        return false;
    }
}

/**
 * Get last timestamp from Google Sheet
 */
async function getLastTimestamp() {
    try {
        const auth = await getAuthClient();
        if (!auth) {
            return null;
        }

        const sheets = google.sheets({ version: 'v4', auth });

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`
        });

        const values = result.data.values;
        if (!values || values.length < 2) {
            return null;
        }

        // Get last timestamp (skip header)
        const lastRow = values[values.length - 1];
        return lastRow[0] ? new Date(lastRow[0]) : null;

    } catch (error) {
        console.warn('⚠️  Could not get last timestamp from Google Sheets');
        return null;
    }
}

/**
 * Fetch all history from Google Sheet and convert to local format
 */
async function fetchAllHistory() {
    try {
        const auth = await getAuthClient();
        if (!auth) {
            console.warn('⚠️  Google Sheets Service Account not configured, skipping sync');
            return null;
        }

        const sheets = google.sheets({ version: 'v4', auth });

        console.log('📥 Fetching history from Google Sheets...');

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:C`
        });

        const values = result.data.values;
        if (!values || values.length === 0) {
            console.log('📭 No history found in Google Sheets');
            return [];
        }

        // Check if first row is header (contains text like "Timestamp", "Name", etc.)
        const firstRow = values[0];
        const hasHeader = firstRow && firstRow[0] && 
            (firstRow[0].toLowerCase().includes('timestamp') || 
             firstRow[0].toLowerCase().includes('時間') ||
             firstRow[1]?.toLowerCase().includes('name') ||
             firstRow[1]?.toLowerCase().includes('名稱'));
        
        const startIndex = hasHeader ? 1 : 0;

        // Group by timestamp
        const historyMap = new Map();
        
        for (let i = startIndex; i < values.length; i++) {
            const row = values[i];
            if (!row[0]) continue;

            const timestamp = row[0];
            const name = row[1] || '';
            const aprStr = row[2];
            const apr = aprStr === 'N/A' ? null : parseFloat(aprStr);

            if (!historyMap.has(timestamp)) {
                historyMap.set(timestamp, {
                    timestamp: parseTimestamp(timestamp),
                    data: []
                });
            }

            historyMap.get(timestamp).data.push({ 
                name, 
                apr,
                url: getUrlForName(name)
            });
        }

        const history = Array.from(historyMap.values());
        console.log(`✅ Fetched ${history.length} entries from Google Sheets`);
        return history;

    } catch (error) {
        console.error('❌ Failed to fetch history from Google Sheets:', error.message);
        return null;
    }
}

/**
 * Parse timestamp string back to ISO format
 */
function parseTimestamp(timestampStr) {
    try {
        // Format: "2025/11/25 下午 10:43:28" or similar zh-TW format
        // Manual parsing for zh-TW format
        const match = timestampStr.match(/(\d{4})\/(\d{2})\/(\d{2})\s*(上午|下午)?\s*(\d{1,2}):(\d{2}):(\d{2})/);
        if (match) {
            let [, year, month, day, period, hour, minute, second] = match;
            hour = parseInt(hour);
            if (period === '下午' && hour !== 12) hour += 12;
            if (period === '上午' && hour === 12) hour = 0;
            
            const d = new Date(year, parseInt(month) - 1, day, hour, minute, second);
            return d.toISOString();
        }

        // Try standard parsing
        const date = new Date(timestampStr);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }

        return timestampStr;
    } catch (e) {
        return timestampStr;
    }
}

module.exports = {
    appendHistory,
    getLastTimestamp,
    getAuthClient,
    fetchAllHistory
};
