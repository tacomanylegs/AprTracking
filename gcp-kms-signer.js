/**
 * GCP KMS Signer Module
 *
 * 使用 GCP KMS 進行 ED25519 簽署，取代本地私鑰
 * 
 * 使用方式:
 *   const { initializeKmsSigner, createSuiKmsSigner } = require('./gcp-kms-signer');
 *   const kmsConfig = await initializeKmsSigner(process.env.GCP_KMS_KEY_PATH);
 *   const signer = createSuiKmsSigner(kmsConfig);
 *
 * 環境變數:
 *   GCP_KMS_KEY_PATH - 完整的 KMS 金鑰版本路徑
 *     例如: projects/web3tool-479814/locations/global/keyRings/sui-wallet-key-test/cryptoKeys/sui-wallet-test-key/cryptoKeyVersions/1
 * 
 * 認證方式:
 *   使用 Application Default Credentials (ADC)
 *   執行: gcloud auth application-default login
 */

const envLoader = require('./env-loader');
envLoader.load();
const { KeyManagementServiceClient } = require('@google-cloud/kms');
const { Ed25519PublicKey } = require('@mysten/sui/keypairs/ed25519');
const { blake2b } = require('@noble/hashes/blake2.js');

// ============ Logging ============
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [KMS] [${level}] ${message}`);
}

function logError(message) {
  log(message, 'ERROR');
}

function logSuccess(message) {
  log(message, 'SUCCESS');
}

// ============ Parse PEM to Raw Public Key ============
/**
 * 從 PEM 格式的公鑰提取 32 bytes 的 ED25519 原始公鑰
 * @param {string} pem - PEM 格式的公鑰
 * @returns {Uint8Array} 32 bytes 的原始公鑰
 */
function extractRawPublicKeyFromPem(pem) {
  // 移除 PEM header/footer 和空白
  const pemContent = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');
  
  // Base64 解碼得到 DER 格式
  const der = Buffer.from(pemContent, 'base64');
  
  // ED25519 公鑰的 DER 結構：
  // SEQUENCE {
  //   SEQUENCE { OID 1.3.101.112 }  -- ED25519 algorithm identifier
  //   BIT STRING (32 bytes)          -- 實際公鑰
  // }
  // DER 總長度通常是 44 bytes，最後 32 bytes 是原始公鑰
  if (der.length < 32) {
    throw new Error(`Invalid public key DER length: ${der.length}`);
  }
  
  // 取最後 32 bytes 作為原始公鑰
  const rawPublicKey = der.slice(-32);
  
  return new Uint8Array(rawPublicKey);
}

// ============ Initialize KMS Signer ============
/**
 * 初始化 GCP KMS 簽署器
 * @param {string} keyPath - 完整的 KMS 金鑰版本路徑
 * @returns {Promise<Object>} { client, keyPath, publicKey, publicKeyBytes, address }
 */
async function initializeKmsSigner(keyPath) {
  if (!keyPath) {
    throw new Error('GCP_KMS_KEY_PATH is required');
  }

  log(`Initializing GCP KMS Signer...`);
  log(`Key path: ${keyPath}`);

  // 建立 KMS 客戶端（使用 ADC 認證）
  const client = new KeyManagementServiceClient();

  // 獲取公鑰
  log('Fetching public key from KMS...');
  const [publicKeyResponse] = await client.getPublicKey({ name: keyPath });

  // 驗證演算法
  const algorithm = publicKeyResponse.algorithm;
  log(`Public key algorithm: ${algorithm}`);

  if (algorithm !== 'EC_SIGN_ED25519') {
    throw new Error(`Invalid key algorithm: expected EC_SIGN_ED25519, got ${algorithm}`);
  }

  // 從 PEM 提取原始公鑰
  const publicKeyPem = publicKeyResponse.pem;
  const publicKeyBytes = extractRawPublicKeyFromPem(publicKeyPem);
  
  log(`Public key (hex): ${Buffer.from(publicKeyBytes).toString('hex')}`);

  // 建立 Sui ED25519 公鑰物件並推導地址
  const publicKey = new Ed25519PublicKey(publicKeyBytes);
  const address = publicKey.toSuiAddress();

  log(`Sui address: ${address}`);
  logSuccess('GCP KMS Signer initialized successfully!');

  return {
    client,
    keyPath,
    publicKey,
    publicKeyBytes,
    address,
  };
}

// ============ Sign with KMS ============
/**
 * 使用 GCP KMS 簽署資料
 * @param {KeyManagementServiceClient} client - KMS 客戶端
 * @param {string} keyPath - 金鑰路徑
 * @param {Uint8Array|Buffer} data - 要簽署的資料
 * @returns {Promise<Uint8Array>} 64 bytes 的 ED25519 簽名
 */
async function signWithKms(client, keyPath, data) {
  log(`Signing data with KMS (${data.length} bytes)...`);

  // 呼叫 KMS asymmetricSign API
  const [signResponse] = await client.asymmetricSign({
    name: keyPath,
    data: Buffer.from(data),
  });

  const signature = signResponse.signature;

  if (!signature || signature.length !== 64) {
    throw new Error(`Invalid signature length: expected 64, got ${signature?.length}`);
  }

  logSuccess(`Signature created successfully (${signature.length} bytes)`);

  return new Uint8Array(signature);
}

// ============ Create Sui KMS Signer ============
/**
 * 建立 Sui 相容的 KMS 簽署器
 * @param {Object} kmsConfig - 來自 initializeKmsSigner 的配置
 * @returns {Object} 包含 signTransaction 方法的 signer 物件
 */
function createSuiKmsSigner(kmsConfig) {
  const { client, keyPath, publicKey, publicKeyBytes, address } = kmsConfig;

  return {
    // 獲取公鑰
    getPublicKey: () => publicKey,
    
    // 獲取地址
    getAddress: () => address,

    /**
     * 簽署交易
     * @param {Uint8Array} txBytes - 交易 bytes
     * @returns {Promise<string>} Base64 編碼的 Sui signature
     */
    signTransaction: async (txBytes) => {
      log('Signing transaction with KMS...');
      
      // 1. 建立 intent message: [intent_scope, intent_version, intent_app_id, ...data]
      // TransactionData intent: scope=0, version=0, app_id=0
      const intentMessage = new Uint8Array(3 + txBytes.length);
      intentMessage[0] = 0; // intent scope: TransactionData
      intentMessage[1] = 0; // intent version
      intentMessage[2] = 0; // intent app id: Sui
      intentMessage.set(txBytes, 3);

      // 2. 計算 Blake2b-256 hash（使用 @noble/hashes）
      const digest = blake2b(intentMessage, { dkLen: 32 });

      // 3. 使用 KMS 簽署 hash
      const signature = await signWithKms(client, keyPath, digest);

      // 4. 組合 Sui signature 格式: [scheme_flag, ...signature, ...public_key]
      // ED25519 scheme flag = 0x00
      const suiSignature = new Uint8Array(1 + 64 + 32);
      suiSignature[0] = 0x00; // ED25519 flag
      suiSignature.set(signature, 1);
      suiSignature.set(publicKeyBytes, 65);

      // 5. 返回 Base64 編碼
      const signatureBase64 = Buffer.from(suiSignature).toString('base64');
      
      logSuccess('Transaction signed successfully');
      
      return signatureBase64;
    },
  };
}

// ============ Export ============
module.exports = {
  initializeKmsSigner,
  signWithKms,
  createSuiKmsSigner,
  extractRawPublicKeyFromPem,
};
