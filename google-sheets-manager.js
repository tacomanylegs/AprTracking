const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Google Sheets API configuration
const SPREADSHEET_ID = '1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0';
const REBALANCE_SHEET_NAME = 'Rebalance';
const envLoader = require('./env-loader');
envLoader.load();
const SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;

let authClient = null;

/**
 * Load Service Account and create auth client
 */
async function getAuthClient() {
    if (authClient) {
        return authClient;
    }

    try {
        console.log("SERVICE_ACCOUNT_FILE:", SERVICE_ACCOUNT_FILE);
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
 * Append rebalance results to Google Sheet "Rebalance" tab
 * 欄位: 時間戳記, Pool 名稱, 執行結果
 * 
 * @param {Array<Object>} results - 換倉結果陣列
 * @param {string} results[].timestamp - 時間戳記
 * @param {string} results[].poolName - Pool 名稱
 * @param {string} results[].status - 執行結果
 * @returns {Promise<boolean>}
 */
async function appendRebalanceResults(results) {
    try {
        const auth = await getAuthClient();
        if (!auth) {
            console.warn('⚠️  Google Sheets Service Account not configured, skipping upload');
            return false;
        }

        const sheets = google.sheets({ version: 'v4', auth });

        // 建立行數據
        const rows = results.map(result => [
            result.timestamp,
            result.poolName,
            result.status
        ]);

        if (rows.length === 0) {
            console.log('⚠️  No rows to append');
            return true;
        }

        // Append to Rebalance sheet
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${REBALANCE_SHEET_NAME}!A:C`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: rows
            }
        });

        console.log(`✅ Uploaded ${rows.length} rows to Google Sheets (Rebalance tab)`);
        return true;

    } catch (error) {
        console.error('❌ Failed to upload to Google Sheets:', error.message);
        return false;
    }
}

module.exports = {
    appendRebalanceResults,
    getAuthClient
};
