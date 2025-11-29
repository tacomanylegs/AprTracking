const sheetsManager = require('../src/services/google-sheets-manager');

/**
 * Test uploading fake data to Google Sheets
 */
async function testSheetsUpload() {
    console.log('🧪 Starting Google Sheets API test...\n');

    // Check if Service Account is loaded
    const auth = await sheetsManager.getAuthClient();
    if (!auth) {
        console.error('❌ Service Account not found.');
        console.error('   Expected file: d:\\Code\\AprTracking\\desktop-widget\\service-account.json');
        console.error('\n📖 How to set up Service Account:');
        console.error('   1. Go to https://console.cloud.google.com/');
        console.error('   2. Create a new project (or use existing)');
        console.error('   3. Enable "Google Sheets API"');
        console.error('   4. Go to "IAM & Admin" > "Service Accounts"');
        console.error('   5. Create a new Service Account');
        console.error('   6. Click on the Service Account > "Keys" tab');
        console.error('   7. Add Key > Create new key > JSON');
        console.error('   8. Save the downloaded file as "service-account.json"');
        console.error('\n❗ IMPORTANT: Share your Google Sheet with the Service Account email!');
        console.error('   (The email looks like: xxx@project-id.iam.gserviceaccount.com)');
        process.exit(1);
    }

    console.log('✅ Service Account loaded successfully\n');

    // Create fake data
    const testData = [
        {
            timestamp: new Date().toISOString(),
            data: [
                { name: 'Test Takara USDT', apr: 12.50 },
                { name: 'Test Takara USDC', apr: 13.75 },
                { name: 'Test Volos V1', apr: 11.20 },
                { name: 'Test Volos V2', apr: 18.90 }
            ]
        }
    ];

    console.log('📝 Test data to upload:');
    console.log(JSON.stringify(testData, null, 2));
    console.log('\n');

    try {
        console.log('📤 Uploading to Google Sheets...');
        const result = await sheetsManager.appendHistory(testData);
        
        if (result) {
            console.log('\n✅ Test passed! Data uploaded successfully.');
            console.log('🎉 Check your Google Sheet to verify the data.\n');
            console.log('Sheet ID: 1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0');
            console.log('URL: https://docs.google.com/spreadsheets/d/1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0/edit');
        } else {
            console.log('\n❌ Test failed! Could not upload data.');
            console.log('Please check:');
            console.log('  1. service-account.json is valid');
            console.log('  2. Sheet ID is correct');
            console.log('  3. Service Account email has edit access to the Sheet');
        }

    } catch (error) {
        console.error('\n❌ Test failed with error:');
        console.error(error);
        console.error('\nTroubleshooting:');
        console.error('  1. Verify service-account.json exists and is valid');
        console.error('  2. Check Google Sheets API is enabled in Google Cloud Console');
        console.error('  3. Share the Google Sheet with the Service Account email (as Editor)');
    }
}

// Run test
testSheetsUpload();
