/**
 * GCP KMS 金鑰封裝工具
 * 
 * 將 Sui 錢包的 ED25519 私鑰封裝成可匯入 GCP KMS 的格式
 * 使用 RSA-OAEP (4096-bit, SHA-256) 封裝方式
 * 
 * 使用方式:
 *   node wrap-key-for-kms.js --pem <封裝公鑰.pem> --output <輸出檔案.bin>
 *   node wrap-key-for-kms.js --pem <封裝公鑰.pem> --dry-run    # 預覽模式
 *   node wrap-key-for-kms.js --pem <封裝公鑰.pem> --env-path /path/to/.env
 * 
 * 環境變數:
 *   SUI_PRIVATE_KEY - Sui 私鑰（suiprivkey... 格式）
 * 
 * GCP KMS 匯入步驟:
 *   1. 在 GCP Console 建立金鑰環和金鑰（用途: 非對稱簽署, 演算法: EC_SIGN_ED25519）
 *   2. 建立匯入工作（匯入方式: RSA_OAEP_4096_SHA256）
 *   3. 下載封裝公鑰 (.pem)
 *   4. 執行此腳本產生封裝後的金鑰
 *   5. 上傳封裝後的金鑰到 GCP
 */

// 載入環境設定（必須最先執行）
require('./env-config');
const envLoader = require('./env-loader');
envLoader.load();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');


const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');

// ============ 日誌輸出 ============
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function logError(message) {
  log(message, 'ERROR');
}

function logSuccess(message) {
  log(message, 'SUCCESS');
}

// ============ 解析命令列參數 ============
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    pemPath: null,
    outputPath: 'wrapped-key.bin',
  };
  
  const pemIdx = args.indexOf('--pem');
  if (pemIdx !== -1 && args[pemIdx + 1]) {
    options.pemPath = args[pemIdx + 1];
  }
  
  const outputIdx = args.indexOf('--output');
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    options.outputPath = args[outputIdx + 1];
  }
  
  return options;
}

// ============ 將 ED25519 種子轉換為 PKCS#8 DER 格式 ============
/**
 * 將 32 位元組的 ED25519 種子轉換為 PKCS#8 DER 格式
 * 
 * PKCS#8 結構 (RFC 5208):
 * PrivateKeyInfo ::= SEQUENCE {
 *   version                   INTEGER (0),
 *   privateKeyAlgorithm       AlgorithmIdentifier,
 *   privateKey                OCTET STRING
 * }
 * 
 * 對於 ED25519，privateKey 內部還包含一層 OCTET STRING
 * 
 * @param {Uint8Array} seed - 32 位元組的 ED25519 種子
 * @returns {Buffer} PKCS#8 DER 編碼的私鑰
 */
function ed25519SeedToPkcs8Der(seed) {
  if (seed.length !== 32) {
    throw new Error(`ED25519 種子必須是 32 位元組，但收到 ${seed.length} 位元組`);
  }

  // ED25519 OID: 1.3.101.112
  const ed25519Oid = Buffer.from([
    0x06, 0x03,       // OBJECT IDENTIFIER, 長度 3
    0x2b, 0x65, 0x70  // 1.3.101.112
  ]);

  // 內層 OCTET STRING（包含種子）
  const innerOctetString = Buffer.concat([
    Buffer.from([0x04, 0x20]), // OCTET STRING, 長度 32
    Buffer.from(seed)
  ]);

  // 外層 OCTET STRING（包含內層 OCTET STRING）
  const outerOctetString = Buffer.concat([
    Buffer.from([0x04, innerOctetString.length]),
    innerOctetString
  ]);

  // AlgorithmIdentifier SEQUENCE
  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, ed25519Oid.length]), // SEQUENCE, 長度
    ed25519Oid
  ]);

  // 版本號 INTEGER (0)
  const version = Buffer.from([0x02, 0x01, 0x00]);

  // PrivateKeyInfo 內容
  const privateKeyInfoContent = Buffer.concat([
    version,
    algorithmIdentifier,
    outerOctetString
  ]);

  // 完整的 PrivateKeyInfo SEQUENCE
  const pkcs8Der = Buffer.concat([
    Buffer.from([0x30, privateKeyInfoContent.length]),
    privateKeyInfoContent
  ]);

  return pkcs8Der;
}

// ============ 使用 RSA-OAEP 封裝金鑰 ============
/**
 * 使用 RSA-OAEP (SHA-256) 封裝金鑰
 * 適用於 GCP KMS 匯入方式: RSA_OAEP_4096_SHA256
 * 
 * @param {string} publicKeyPem - RSA 公鑰（PEM 格式）
 * @param {Buffer} keyMaterial - 要封裝的金鑰材料（PKCS#8 DER 格式）
 * @returns {Buffer} 封裝後的金鑰
 */
function wrapKeyWithRsaOaep(publicKeyPem, keyMaterial) {
  const wrappedKey = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    keyMaterial
  );
  return wrappedKey;
}

// ============ 解碼 Sui 私鑰 ============
/**
 * 從 .env 讀取並解碼 Sui 私鑰
 * 
 * @returns {{ secretKey: Uint8Array, address: string, schema: string }}
 */
function decodeSuiKey() {
  const privateKeyStr = process.env.SUI_PRIVATE_KEY;
  console.log("SUI_PRIVATE_KEY:", process.env);
  if (!privateKeyStr) {
    throw new Error('SUI_PRIVATE_KEY 未設定於 .env 檔案中');
  }
  
  const trimmedKey = privateKeyStr.trim();
  
  if (!trimmedKey.startsWith('suiprivkey')) {
    throw new Error('私鑰格式錯誤：必須是 suiprivkey... 格式');
  }
  
  // 解碼私鑰
  const { schema, secretKey } = decodeSuiPrivateKey(trimmedKey);
  
  if (schema !== 'ED25519') {
    throw new Error(`不支援的金鑰類型: ${schema}，僅支援 ED25519`);
  }
  
  // 取得錢包地址
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const address = keypair.getPublicKey().toSuiAddress();
  
  return { secretKey, address, schema };
}

// ============ 主程式 ============
async function main() {
  const options = parseArgs();
  
  console.log('');
  console.log('========================================');
  console.log('GCP KMS 金鑰封裝工具');
  console.log('========================================');
  console.log(`模式: ${options.dryRun ? '🔍 DRY RUN（預覽，不寫入檔案）' : '🚀 執行'}`);
  console.log('');
  
  // 檢查必要參數
  if (!options.pemPath) {
    logError('缺少必要參數: --pem <封裝公鑰.pem>');
    console.log('');
    console.log('使用方式:');
    console.log('  node wrap-key-for-kms.js --pem <封裝公鑰.pem> [--output <輸出檔案.bin>] [--dry-run]');
    console.log('');
    console.log('範例:');
    console.log('  node wrap-key-for-kms.js --pem ./4096_RSA-OAEP_SHA256.pem --dry-run');
    console.log('  node wrap-key-for-kms.js --pem ./4096_RSA-OAEP_SHA256.pem --output ./wrapped-key.bin');
    process.exit(1);
  }
  
  try {
    // 1. 解碼 Sui 私鑰
    log('正在解碼 Sui 私鑰...');
    const { secretKey, address, schema } = decodeSuiKey();
    
    console.log('');
    console.log('📋 金鑰資訊:');
    console.log(`   金鑰類型: ${schema}`);
    console.log(`   Sui 錢包地址: ${address}`);
    console.log(`   私鑰長度: ${secretKey.length} 位元組`);
    
    // 2. 轉換為 PKCS#8 DER 格式
    log('正在轉換為 PKCS#8 DER 格式...');
    const pkcs8Der = ed25519SeedToPkcs8Der(secretKey);
    console.log(`   PKCS#8 DER 長度: ${pkcs8Der.length} 位元組`);
    
    // 3. 讀取封裝公鑰
    log(`正在讀取封裝公鑰: ${options.pemPath}`);
    
    if (!fs.existsSync(options.pemPath)) {
      throw new Error(`找不到封裝公鑰檔案: ${options.pemPath}`);
    }
    
    const wrappingKeyPem = fs.readFileSync(options.pemPath, 'utf8');
    
    console.log('');
    console.log('📋 封裝設定:');
    console.log(`   封裝公鑰: ${path.resolve(options.pemPath)}`);
    console.log(`   輸出檔案: ${path.resolve(options.outputPath)}`);
    console.log(`   演算法: RSA-OAEP (SHA-256)`);
    console.log(`   匯入方式: RSA_OAEP_4096_SHA256`);
    
    // 如果是 dry-run 模式，到此結束
    if (options.dryRun) {
      console.log('');
      console.log('========================================');
      logSuccess('預覽完成！');
      console.log('');
      console.log('⚠️  請確認上述錢包地址是否正確');
      console.log('✅ 確認無誤後，移除 --dry-run 參數執行實際封裝');
      console.log('========================================');
      process.exit(0);
    }
    
    // 4. 封裝金鑰
    log('正在使用 RSA-OAEP 封裝金鑰...');
    const wrappedKey = wrapKeyWithRsaOaep(wrappingKeyPem, pkcs8Der);
    console.log(`   封裝後長度: ${wrappedKey.length} 位元組`);
    
    // 5. 寫入檔案
    log(`正在寫入封裝後的金鑰到: ${options.outputPath}`);
    fs.writeFileSync(options.outputPath, wrappedKey);
    
    console.log('');
    console.log('========================================');
    logSuccess('金鑰封裝完成！');
    console.log('========================================');
    console.log('');
    console.log('📋 輸出資訊:');
    console.log(`   檔案路徑: ${path.resolve(options.outputPath)}`);
    console.log(`   檔案大小: ${wrappedKey.length} 位元組`);
    console.log('');
    console.log('📋 下一步 - 上傳到 GCP KMS:');
    console.log('');
    console.log('方法一: 使用 gcloud CLI');
    console.log('  gcloud kms keys versions import \\');
    console.log('    --import-job <匯入工作名稱> \\');
    console.log('    --location <位置> \\');
    console.log('    --keyring <金鑰環> \\');
    console.log('    --key <金鑰名稱> \\');
    console.log('    --algorithm ec-sign-ed25519 \\');
    console.log(`    --wrapped-key-file ${options.outputPath}`);
    console.log('');
    console.log('方法二: 使用 GCP Console');
    console.log('  1. 前往 Security > Key Management');
    console.log('  2. 選擇你的金鑰環和金鑰');
    console.log('  3. 點擊「匯入金鑰版本」');
    console.log('  4. 選擇匯入工作');
    console.log(`  5. 上傳 ${options.outputPath}`);
    console.log('  6. 選擇演算法: 橢圓曲線 ED25519');
    console.log('');
    
    process.exit(0);
    
  } catch (error) {
    console.log('');
    logError(`執行失敗: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// 執行主程式
main();
