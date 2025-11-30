const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Google Sheets API configuration
const SPREADSHEET_ID = '1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0';
const SHEET_NAME = 'APR';
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'service-account.json');

let authClient = null;

/**
 * Get buy price range from Google Sheet A1:B1
 * A1: Min Price
 * B1: Max Price
 */
async function getBuyPriceRange() {
    try {
        const auth = await getAuthClient();
        if (!auth) {
            return { min: 0.9, max: 1.1 }; // Default
        }

        const sheets = google.sheets({ version: 'v4', auth });

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:B1`
        });

        const values = result.data.values?.[0];
        if (values && values.length >= 2) {
            const min = parseFloat(values[0]);
            const max = parseFloat(values[1]);
            
            if (!isNaN(min) && !isNaN(max)) {
                console.log(`✅ Loaded buy price range from Google Sheets: ${min} - ${max}`);
                return { min, max };
            }
        }
        
        return { min: 0.9, max: 1.1 }; // Default

    } catch (error) {
        console.error('❌ Failed to get buy price range:', error.message);
        return { min: 0.9, max: 1.1 };
    }
}

/**
 * Set buy price range to Google Sheet A1:B1
 */
async function setBuyPriceRange(min, max) {
    try {
        const auth = await getAuthClient();
        if (!auth) {
            console.warn('⚠️  Google Sheets not configured, cannot save buy price range');
            return false;
        }

        const sheets = google.sheets({ version: 'v4', auth });

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:B1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[min, max]]
            }
        });

        console.log(`✅ Saved buy price range to Google Sheets: ${min} - ${max}`);
        return true;

    } catch (error) {
        console.error('❌ Failed to save buy price range:', error.message);
        return false;
    }
}

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
                    item.apr ? item.apr.toFixed(2) : 'N/A',
                    item.usdcPrice ? item.usdcPrice.toString() : ''
                ]);
            });
        });

        if (rows.length === 0) {
            return true;
        }

        // Append to sheet (starting from row 2, A1 is reserved for buy price)
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:D`,
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
            range: `${SHEET_NAME}!A2:D`
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

            const usdcPriceStr = row[3];
            const usdcPrice = usdcPriceStr ? parseFloat(usdcPriceStr) : null;

            historyMap.get(timestamp).data.push({ 
                name, 
                apr,
                usdcPrice
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

/**
 * Append history entries with rebalance status to Google Sheet
 * 同時寫入 APR 數據 (A-D 欄) 和再平衡狀態 (E 欄)
 * 
 * @param {Object} historyData - { aprResults: [...], rebalanceResults: {...}, timestamp: "..." }
 * @returns {Promise<boolean>}
 */
async function appendHistoryWithRebalance(historyData) {
    try {
        const auth = await getAuthClient();
        if (!auth) {
            console.warn('⚠️  Google Sheets Service Account not configured, skipping upload');
            return false;
        }

        const sheets = google.sheets({ version: 'v4', auth });

        const { aprResults, rebalanceResults, timestamp } = historyData;

        // 格式化時間戳
        const formattedTimestamp = new Date(timestamp).toLocaleString('zh-TW', { 
            timeZone: 'Asia/Taipei',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // 建立行數據，結合 APR 和再平衡狀態
        const rows = [];

        // 如果沒有 APR 結果但有再平衡結果，只寫再平衡狀態
        if (!aprResults || aprResults.length === 0) {
            if (rebalanceResults && Object.keys(rebalanceResults).length > 0) {
                for (const poolId in rebalanceResults) {
                    const result = rebalanceResults[poolId];
                    const rebalanceStatus = formatRebalanceStatus(result);
                    rows.push([
                        formattedTimestamp,
                        result.poolName || 'Unknown',
                        '',  // APR
                        result.poolUsdcPrice || '',  // USDC Price
                        rebalanceStatus  // E 欄：再平衡狀態
                    ]);
                }
            }
        } else {
            // 正常情況：有 APR 結果
            aprResults.forEach(item => {
                // 查找該 Pool 對應的再平衡結果
                let rebalanceStatus = '';
                let poolId = null;

                // 嘗試從 rebalanceResults 中找到對應的 Pool
                if (rebalanceResults) {
                    for (const id in rebalanceResults) {
                        if (rebalanceResults[id].poolName === item.name) {
                            rebalanceStatus = formatRebalanceStatus(rebalanceResults[id]);
                            poolId = id;
                            break;
                        }
                    }
                }

                rows.push([
                    formattedTimestamp,
                    item.name,
                    item.apr ? item.apr.toFixed(2) : 'N/A',
                    item.usdcPrice ? item.usdcPrice.toString() : '',
                    rebalanceStatus  // E 欄：再平衡狀態
                ]);
            });

            // 如果有只在再平衡結果中出現的 Pool（APR 失敗但再平衡成功）
            if (rebalanceResults) {
                for (const poolId in rebalanceResults) {
                    const result = rebalanceResults[poolId];
                    const aprFound = aprResults.some(item => item.name === result.poolName);
                    if (!aprFound) {
                        const rebalanceStatus = formatRebalanceStatus(result);
                        rows.push([
                            formattedTimestamp,
                            result.poolName || 'Unknown',
                            '',  // APR 缺失
                            result.poolUsdcPrice || '',  // USDC Price
                            rebalanceStatus  // E 欄：再平衡狀態
                        ]);
                    }
                }
            }
        }

        if (rows.length === 0) {
            console.log('⚠️  No rows to append');
            return true;
        }

        // Append to sheet (starting from row 2, A1 is reserved for buy price)
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:E`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: rows
            }
        });

        console.log(`✅ Uploaded ${rows.length} rows to Google Sheets (with rebalance status)`);
        return true;

    } catch (error) {
        console.error('❌ Failed to upload to Google Sheets:', error.message);
        return false;
    }
}

/**
 * 格式化再平衡狀態為顯示字符串
 */
function formatRebalanceStatus(result) {
    if (!result) return '';

    if (result.error) {
        return `❌ 失敗 (${result.error.substring(0, 20)})`;
    }

    if (result.rebalanceExecuted && result.success) {
        const digestShort = result.digest ? result.digest.substring(0, 10) : 'N/A';
        return `✅ 成功 (${digestShort}...)`;
    }

    if (result.rebalanceNeeded === false) {
        return '⏸ 無需操作';
    }

    if (result.rebalanceNeeded === true && !result.rebalanceExecuted) {
        return '⏳ 待執行';
    }

    return '❓ 未知';
}

module.exports = {
    appendHistory,
    appendHistoryWithRebalance,
    getLastTimestamp,
    getAuthClient,
    fetchAllHistory,
    getBuyPriceRange,
    setBuyPriceRange
};
