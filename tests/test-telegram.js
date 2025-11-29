const TelegramNotifier = require('../src/services/telegram-notifier');

async function runTest() {
    console.log('🚀 Testing Telegram Notification...');
    const notifier = new TelegramNotifier();

    try {
        await notifier.sendMessage('🔔 <b>Test Message</b>\nThis is a test notification from your APR Monitor Widget.\n\n<a href="https://app.mmt.finance">🔗 MMT Finance</a>');
        console.log('✅ Message sent successfully! Please check your Telegram.');
    } catch (error) {
        console.error('❌ Failed to send message:', error.message);
        console.log('💡 Please check if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set correctly in .env file.');
    }
}

runTest();
