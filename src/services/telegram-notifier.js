const https = require('https');

// ============ Load .env File ============
// 優先順序：1. ENV_PATH 環境變數 2. 預設位置
function loadDotenv() {
  let envPath;
  
  if (process.env.ENV_PATH) {
    // 從環境變數讀取
    envPath = process.env.ENV_PATH;
    console.log(`📝 TelegramNotifier using ENV_PATH: ${envPath}`);
  } else {
    // 使用預設位置
    envPath = require('path').join(__dirname, '..', '..', '..', '.env');
    console.log(`📝 TelegramNotifier using default path: ${envPath}`);
  }
  
  try {
    require('dotenv').config({ path: envPath });
  } catch (error) {
    // dotenv not available
  }
}

loadDotenv();

class TelegramNotifier {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
    }

    /**
     * Sends a message to the configured Telegram chat.
     * @param {string} message - The message text to send (supports HTML).
     * @returns {Promise<object>} - The Telegram API response.
     */
    async sendMessage(message) {
        if (!this.botToken || !this.chatId) {
            console.warn('⚠️ Telegram credentials (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) are missing. Notification skipped.');
            return;
        }

        const postData = JSON.stringify({
            chat_id: this.chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${this.botToken}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsedData = JSON.parse(data);
                            if (parsedData.ok) {
                                resolve(parsedData);
                            } else {
                                reject(new Error(`Telegram API Error: ${parsedData.description}`));
                            }
                        } catch (e) {
                            reject(new Error('Failed to parse Telegram response'));
                        }
                    } else {
                        reject(new Error(`HTTP Error: ${res.statusCode} ${res.statusMessage}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            req.write(postData);
            req.end();
        });
    }
}

module.exports = TelegramNotifier;
