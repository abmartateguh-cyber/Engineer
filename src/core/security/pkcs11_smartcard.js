/**
 * PKCS#11 smartcard/token surface for OmniEng.
 *
 * Hardware posture: no PKCS#11 provider, hardware token, or validated
 * cryptographic module is bundled. Signing and token operations therefore
 * fail closed with CKR_FUNCTION_NOT_SUPPORTED unless a native .node bridge is
 * explicitly configured AND present (expected absent), or the pure-JS
 * software token emulator is explicitly requested via
 * { emulateSoftwareToken: true }.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CKR = {
  CKR_OK: 0x00000000,
  CKR_CRYPTOKI_NOT_INITIALIZED: 0x00000190,
  CKR_CRYPTOKI_ALREADY_INITIALIZED: 0x00000191,
  CKR_SLOT_ID_INVALID: 0x00000003,
  CKR_TOKEN_NOT_PRESENT: 0x000000e0,
  CKR_PIN_INCORRECT: 0x000000a0,
  CKR_PIN_LOCKED: 0x000000a4,
  CKR_SESSION_HANDLE_INVALID: 0x000000b3,
  CKR_USER_NOT_LOGGED_IN: 0x00000101,
  CKR_SIGNATURE_INVALID: 0x000000c0,
  CKR_KEY_HANDLE_INVALID: 0x000000a6,
  CKR_DEVICE_ERROR: 0x00000030,
  CKR_FUNCTION_NOT_SUPPORTED: 0x00000054
};

const CKU = {
  CKU_SO: 0,
  CKU_USER: 1
};

const CKM = {
  CKM_ECDSA_SHA384: 0x00001042,
  CKM_SHA384_RSA_PKCS: 0x00000040
};

const SOFTWARE_TOKEN_LABEL = 'FIPS-style software token emulator';
const SOFTWARE_TOKEN_SERIAL = 'omnieng-software-token';
const DEFAULT_USER_PIN = 'omnieng-dev-pin';
const DEFAULT_MAX_PIN_ATTEMPTS = 3;
const ROOT_KEY_ID = 'ROOT_SIGNING_KEY';

const MECHANISM_ECDSA = new Set(['ECDSA-SHA384', 'ECDSA-P384-SHA384', 'ECDSA']);
const MECHANISM_RSA = new Set(['RSA4096-SHA384', 'RSA-SHA384', 'RSA']);
const MECHANISM_TO_ALG = {
  'ECDSA-SHA384': 'ECDSA-P384-SHA384',
  'ECDSA-P384-SHA384': 'ECDSA-P384-SHA384',
  ECDSA: 'ECDSA-P384-SHA384',
  'RSA4096-SHA384': 'RSA4096-SHA384',
  'RSA-SHA384': 'RSA4096-SHA384',
  RSA: 'RSA4096-SHA384'
};

class PKCS11DriverUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PKCS11DriverUnavailableError';
    this.code = 'ERR_PKCS11_DRIVER_UNAVAILABLE';
    this.cause = cause;
  }
}

function normalizeMechanism(mechanism) {
  if (typeof mechanism === 'number') {
    if (mechanism === CKM.CKM_ECDSA_SHA384) return 'ECDSA-P384-SHA384';
    if (mechanism === CKM.CKM_SHA384_RSA_PKCS) return 'RSA4096-SHA384';
    return null;
  }
  if (typeof mechanism !== 'string') return null;
  const normalized = mechanism.toUpperCase();
  if (MECHANISM_TO_ALG[normalized]) return MECHANISM_TO_ALG[normalized];
  if (MECHANISM_TO_ALG[mechanism]) return MECHANISM_TO_ALG[mechanism];
  return null;
}

function resolveDriverCandidate(options) {
  const explicit = options && options.driverPath;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const fromEnv = process.env.OMNIENG_PKCS11_DRIVER || process.env.PKCS11_MODULE_PATH;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}

function probeNativeDriver(driverPath) {
  if (!driverPath) {
    return { kind: 'unavailable', code: 'NO_DRIVER_CONFIGURED', error: null };
  }
  const absolute = path.resolve(String(driverPath));
  if (!fs.existsSync(absolute)) {
    const err = new PKCS11DriverUnavailableError(`Configured PKCS#11 driver path does not exist: ${absolute}`);
    return { kind: 'unavailable', code: 'DRIVER_PATH_MISSING', error: err };
  }
  if (!absolute.endsWith('.node')) {
    const err = new PKCS11DriverUnavailableError(
      `Configured PKCS#11 driver is not a prebuilt .node bridge: ${absolute}`
    );
    return { kind: 'unavailable', code: 'DRIVER_NOT_NODE_BRIDGE', error: err };
  }
  let bridge;
  try {
    bridge = { exports: {} };
    process.dlopen(bridge, absolute);
  } catch (err) {
    return { kind: 'unavailable', code: 'DLOPEN_FAILED', error: err };
  }
  const surface = bridge.exports && bridge.exports.surface;
  if (
    surface !== 'pkcs11-native' ||
    typeof bridge.exports.C_Initialize !== 'function' ||
    typeof bridge.exports.C_Sign !== 'function'
  ) {
    const err = new PKCS11DriverUnavailableError(
      'Prebuilt .node bridge loaded but does not expose the expected pkcs11-native JS surface'
    );
    return { kind: 'unavailable', code: 'BRIDGE_SURFACE_MISSING', error: err };
  }
  return { kind: 'native-bridge', module: bridge.exports, driverPath: absolute };
}

class SoftwareTokenEmulator {
  constructor(options = {}) {
    this.label = options.label || SOFTWARE_TOKEN_LABEL;
    this.manufacturer = options.manufacturer || 'OmniEng';
    this.model = options.model || 'software-token-emulator';
    this.serialNumber = options.serialNumber || SOFTWARE_TOKEN_SERIAL;
    this.userPin = typeof options.userPin === 'string' ? options.userPin : DEFAULT_USER_PIN;
    this.maxPinAttempts = Number.isInteger(options.maxPinAttempts) ? options.maxPinAttempts : DEFAULT_MAX_PIN_ATTEMPTS;
    this.failedAttempts = 0;
    this.isLocked = false;
    this.isZeroized = false;
    this.initialized = false;
    this.sessions = new Map();
    this.keyStore = new Map();
    this.nextSessionId = 1000;
    this.nextKeyId = 5000;
    this.validationLevel = 'software-token-emulator (not hardware-certified)';
    this.status = 'available';
  }

  _requireInitialized() {
    return this.initialized ? CKR.CKR_OK : CKR.CKR_CRYPTOKI_NOT_INITIALIZED;
  }

  _generateKeyPair(algorithm) {
    const alg = normalizeMechanism(algorithm) || String(algorithm).toUpperCase();
    if (MECHANISM_ECDSA.has(alg) || alg.includes('ECDSA')) {
      const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' });
      return {
        algorithm: 'ECDSA-P384-SHA384',
        curve: 'P-384',
        keyPair: pair,
        publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
        privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
      };
    }
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
    return {
      algorithm: 'RSA4096-SHA384',
      modulusLength: 4096,
      keyPair: pair,
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
    };
  }

  C_Initialize() {
    if (this.initialized) return CKR.CKR_CRYPTOKI_ALREADY_INITIALIZED;
    this.initialized = true;
    if (!this.keyStore.has(ROOT_KEY_ID)) {
      this.generateKeyPair({ algorithm: 'ECDSA-P384-SHA384', keyId: ROOT_KEY_ID });
    }
    return CKR.CKR_OK;
  }

  C_Finalize() {
    this.initialized = false;
    this.sessions.clear();
    return CKR.CKR_OK;
  }

  C_GetSlotList() {
    const rv = this._requireInitialized();
    if (rv !== CKR.CKR_OK) return { rv, slots: [] };
    return { rv: CKR.CKR_OK, slots: [0] };
  }

  C_GetTokenInfo(slotId) {
    const rv = this._requireInitialized();
    if (rv !== CKR.CKR_OK) return { rv };
    if (slotId !== 0) return { rv: CKR.CKR_SLOT_ID_INVALID };
    return {
      rv: CKR.CKR_OK,
      info: {
        label: this.label,
        manufacturerID: this.manufacturer,
        model: this.model,
        serialNumber: this.serialNumber,
        flags: {
          CKF_RNG: true,
          CKF_WRITE_PROTECTED: false,
          CKF_LOGIN_REQUIRED: true,
          CKF_USER_PIN_INITIALIZED: true,
          CKF_USER_PIN_LOCKED: this.isLocked
        },
        validationStatus: 'software-token-emulator (not hardware-certified)',
        note:
          'Pure-JS token emulator backed by node:crypto. Not a hardware HSM; ' +
          'keys live in process memory only and are not protected outside the process.'
      }
    };
  }

  C_OpenSession(slotId, flags = 0) {
    const rv = this._requireInitialized();
    if (rv !== CKR.CKR_OK) return { rv };
    if (slotId !== 0) return { rv: CKR.CKR_SLOT_ID_INVALID };
    const hSession = ++this.nextSessionId;
    this.sessions.set(hSession, {
      slotId,
      loggedIn: false,
      userType: null,
      activeSigningContext: null
    });
    return { rv: CKR.CKR_OK, hSession };
  }

  C_CloseSession(hSession) {
    if (!this.sessions.has(hSession)) return CKR.CKR_SESSION_HANDLE_INVALID;
    this.sessions.delete(hSession);
    return CKR.CKR_OK;
  }

  C_Login(hSession, userType, pin) {
    const rv = this._requireInitialized();
    if (rv !== CKR.CKR_OK) return rv;
    const session = this.sessions.get(hSession);
    if (!session) return CKR.CKR_SESSION_HANDLE_INVALID;
    if (this.isLocked) return CKR.CKR_PIN_LOCKED;
    if (pin !== this.userPin) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= this.maxPinAttempts) {
        this.isLocked = true;
        this.isZeroized = true;
        this.keyStore.clear();
        return CKR.CKR_PIN_LOCKED;
      }
      return CKR.CKR_PIN_INCORRECT;
    }
    this.failedAttempts = 0;
    session.loggedIn = true;
    session.userType = userType;
    return CKR.CKR_OK;
  }

  C_Logout(hSession) {
    const session = this.sessions.get(hSession);
    if (!session) return CKR.CKR_SESSION_HANDLE_INVALID;
    session.loggedIn = false;
    session.userType = null;
    session.activeSigningContext = null;
    return CKR.CKR_OK;
  }

  C_SignInit(hSession, mechanism, keyId) {
    const session = this.sessions.get(hSession);
    if (!session) return CKR.CKR_SESSION_HANDLE_INVALID;
    if (!session.loggedIn) return CKR.CKR_USER_NOT_LOGGED_IN;
    const alg = normalizeMechanism(mechanism);
    if (!alg) return CKR.CKR_FUNCTION_NOT_SUPPORTED;
    let keyObj = null;
    if (keyId !== undefined && keyId !== null) {
      keyObj = this.keyStore.get(String(keyId));
      if (!keyObj) return CKR.CKR_KEY_HANDLE_INVALID;
    } else {
      keyObj = this.keyStore.get(ROOT_KEY_ID);
      if (!keyObj) return CKR.CKR_KEY_HANDLE_INVALID;
    }
    if (alg !== keyObj.algorithm) {
      const requestedRsa = MECHANISM_RSA.has(alg);
      const keyIsRsa = MECHANISM_RSA.has(keyObj.algorithm);
      const requestedEcdsa = MECHANISM_ECDSA.has(alg);
      const keyIsEcdsa = MECHANISM_ECDSA.has(keyObj.algorithm);
      if (!(requestedRsa && keyIsRsa) && !(requestedEcdsa && keyIsEcdsa)) {
        return CKR.CKR_FUNCTION_NOT_SUPPORTED;
      }
    }
    session.activeSigningContext = { mechanism: alg, keyObj };
    return CKR.CKR_OK;
  }

  C_Sign(hSession, dataBuffer) {
    const session = this.sessions.get(hSession);
    if (!session) return { rv: CKR.CKR_SESSION_HANDLE_INVALID };
    if (!session.activeSigningContext) return { rv: CKR.CKR_CRYPTOKI_NOT_INITIALIZED };
    if (!session.loggedIn) return { rv: CKR.CKR_USER_NOT_LOGGED_IN };
    const { keyObj } = session.activeSigningContext;
    const data = Buffer.isBuffer(dataBuffer) ? dataBuffer : Buffer.from(String(dataBuffer));
    const signer = crypto.createSign('SHA384');
    signer.update(data);
    signer.end();
    const signature = signer.sign(keyObj.privateKey);
    session.activeSigningContext = null;
    const rsa = MECHANISM_RSA.has(keyObj.algorithm);
    return {
      rv: CKR.CKR_OK,
      signatureHex: signature.toString('hex'),
      signatureBuffer: signature,
      algorithm: rsa ? 'RSA4096-SHA384' : 'ECDSA-P384-SHA384',
      keyId: keyObj.keyId
    };
  }

  C_Verify(keyId, dataBuffer, signatureBuffer) {
    const keyObj = this.keyStore.get(String(keyId));
    if (!keyObj) return { rv: CKR.CKR_KEY_HANDLE_INVALID, valid: false };
    const data = Buffer.isBuffer(dataBuffer) ? dataBuffer : Buffer.from(String(dataBuffer));
    const signature = Buffer.isBuffer(signatureBuffer) ? signatureBuffer : Buffer.from(String(signatureBuffer), 'hex');
    const verifier = crypto.createVerify('SHA384');
    verifier.update(data);
    verifier.end();
    let isValid = false;
    try {
      isValid = verifier.verify(keyObj.publicKey, signature);
    } catch (err) {
      isValid = false;
    }
    return {
      rv: isValid ? CKR.CKR_OK : CKR.CKR_SIGNATURE_INVALID,
      valid: isValid
    };
  }

  generateKeyPair(options = {}) {
    const algorithm = options.algorithm || 'ECDSA-P384-SHA384';
    const generated = this._generateKeyPair(algorithm);
    const keyId = options.keyId || `KEY_${++this.nextKeyId}`;
    const record = {
      keyId: String(keyId),
      algorithm: generated.algorithm,
      curve: generated.curve || null,
      modulusLength: generated.modulusLength || null,
      privateKey: generated.keyPair.privateKey,
      publicKey: generated.keyPair.publicKey,
      privateKeyPem: generated.privateKeyPem,
      publicKeyPem: generated.publicKeyPem,
      label: options.label || `${generated.algorithm} emulator key`
    };
    this.keyStore.set(record.keyId, record);
    return {
      rv: CKR.CKR_OK,
      keyId: record.keyId,
      algorithm: record.algorithm,
      privateKeyPem: record.privateKeyPem,
      publicKeyPem: record.publicKeyPem
    };
  }

  getPublicKeyPem(keyId) {
    const keyObj = this.keyStore.get(String(keyId));
    return keyObj ? keyObj.publicKeyPem : null;
  }

  signBytes(dataBuffer, options = {}) {
    const initRv = this.C_Initialize();
    if (initRv !== CKR.CKR_OK && initRv !== CKR.CKR_CRYPTOKI_ALREADY_INITIALIZED) {
      return { rv: initRv, success: false };
    }
    const { hSession } = this.C_OpenSession(0);
    const pin = options.pin !== undefined ? options.pin : this.userPin;
    const loginRv = this.C_Login(hSession, CKU.CKU_USER, pin);
    if (loginRv !== CKR.CKR_OK) {
      this.C_CloseSession(hSession);
      return { rv: loginRv, success: false };
    }
    const mechanism = options.mechanism || 'ECDSA-SHA384';
    const keyId = options.keyId;
    const initSignRv =
      keyId === undefined ? this.C_SignInit(hSession, mechanism) : this.C_SignInit(hSession, mechanism, keyId);
    if (initSignRv !== CKR.CKR_OK) {
      this.C_CloseSession(hSession);
      return { rv: initSignRv, success: false };
    }
    const result = this.C_Sign(hSession, dataBuffer);
    this.C_CloseSession(hSession);
    return { ...result, success: result.rv === CKR.CKR_OK };
  }

  signEngineeringArtifact(ecoDoc, pin) {
    this.C_Initialize();
    const { hSession } = this.C_OpenSession(0);
    const loginPin = pin !== undefined ? pin : this.userPin;
    const loginRv = this.C_Login(hSession, CKU.CKU_USER, loginPin);
    if (loginRv !== CKR.CKR_OK) {
      this.C_CloseSession(hSession);
      throw new Error(`PKCS#11 software token login failed: code 0x${loginRv.toString(16)}`);
    }
    const payload = Buffer.from(JSON.stringify(ecoDoc));
    const initSignRv = this.C_SignInit(hSession, 'ECDSA-SHA384');
    if (initSignRv !== CKR.CKR_OK) {
      this.C_CloseSession(hSession);
      throw new Error(`PKCS#11 software token sign init failed: code 0x${initSignRv.toString(16)}`);
    }
    const { signatureHex, algorithm } = this.C_Sign(hSession, payload);
    this.C_CloseSession(hSession);
    const docHash = crypto.createHash('sha384').update(payload).digest('hex');
    return {
      artifact: ecoDoc,
      artifactSha384: docHash,
      hsmSignature: signatureHex,
      cryptoAlgorithm: algorithm,
      testFixtureInfo: {
        tokenLabel: this.label,
        serialNumber: this.serialNumber,
        moduleStatus: 'software-token-emulator (not hardware-certified)'
      },
      signedAt: new Date().toISOString()
    };
  }

  describe() {
    return {
      type: 'software-token-emulator',
      label: this.label,
      status: this.status,
      hardwareBacked: false,
      validationLevel: this.validationLevel,
      driver: 'none',
      note:
        'FIPS-style software token emulator backed by node:crypto ' +
        '(ECDSA P-384 / RSA-4096 with SHA-384). Not hardware-certified and ' +
        'not validated; the private key lives in process memory only.'
    };
  }
}

class PKCS11HardwareToken {
  constructor(options = {}) {
    this.options = options;
    this.validationLevel = 'experimental';
    this.emulateSoftwareToken = options.emulateSoftwareToken === true;
    this.driverCandidate = resolveDriverCandidate(options);
    this.driver = null;
    this.driverError = null;
    if (this.emulateSoftwareToken) {
      this.status = 'available';
      this.provider = new SoftwareTokenEmulator(options);
    } else {
      const probe = probeNativeDriver(this.driverCandidate);
      this.driverError = probe.error;
      if (probe.kind === 'native-bridge') {
        this.status = 'available';
        this.provider = probe.module;
        this.driver = { type: 'native-bridge', driverPath: probe.driverPath };
      } else {
        this.status = 'unavailable';
        this.provider = null;
        this.driverUnavailableCode = probe.code;
      }
    }
  }

  _unavailable(operation) {
    const error =
      this.driverError && this.driverError.message
        ? this.driverError.message
        : 'No hardware signing provider is configured.';
    return {
      rv: CKR.CKR_FUNCTION_NOT_SUPPORTED,
      success: false,
      status: 'unavailable',
      validationLevel: this.validationLevel,
      operation,
      error
    };
  }

  _notInitialized(operation) {
    const error =
      this.driverError && this.driverError.message
        ? this.driverError.message
        : 'No hardware signing provider is configured.';
    return {
      rv: CKR.CKR_FUNCTION_NOT_SUPPORTED,
      success: false,
      status: 'unavailable',
      validationLevel: this.validationLevel,
      operation,
      error
    };
  }

  C_Initialize() {
    if (this.provider) return this.provider.C_Initialize();
    return CKR.CKR_FUNCTION_NOT_SUPPORTED;
  }

  C_Finalize() {
    if (this.provider) return this.provider.C_Finalize();
    return CKR.CKR_FUNCTION_NOT_SUPPORTED;
  }

  C_GetSlotList(tokenPresent) {
    if (this.provider) return this.provider.C_GetSlotList(tokenPresent);
    return { ...this._unavailable('C_GetSlotList'), slots: [] };
  }

  C_GetTokenInfo(slotId) {
    if (this.provider) return this.provider.C_GetTokenInfo(slotId);
    return this._unavailable('C_GetTokenInfo');
  }

  C_OpenSession(slotId, flags) {
    if (this.provider) return this.provider.C_OpenSession(slotId, flags);
    return this._unavailable('C_OpenSession');
  }

  C_CloseSession(hSession) {
    if (this.provider) return this.provider.C_CloseSession(hSession);
    return CKR.CKR_FUNCTION_NOT_SUPPORTED;
  }

  C_Login(hSession, userType, pin) {
    if (this.provider) return this.provider.C_Login(hSession, userType, pin);
    return CKR.CKR_FUNCTION_NOT_SUPPORTED;
  }

  C_Logout(hSession) {
    if (this.provider) return this.provider.C_Logout(hSession);
    return CKR.CKR_FUNCTION_NOT_SUPPORTED;
  }

  C_SignInit(hSession, mechanism, keyId) {
    if (this.provider) return this.provider.C_SignInit(hSession, mechanism, keyId);
    return CKR.CKR_FUNCTION_NOT_SUPPORTED;
  }

  C_Sign(hSession, dataBuffer) {
    if (this.provider) return this.provider.C_Sign(hSession, dataBuffer);
    return this._unavailable('C_Sign');
  }

  C_Verify(keyId, dataBuffer, signatureBuffer) {
    if (this.provider) return this.provider.C_Verify(keyId, dataBuffer, signatureBuffer);
    return { ...this._unavailable('C_Verify'), valid: false };
  }

  generateKeyPair(options) {
    if (this.provider && typeof this.provider.generateKeyPair === 'function') {
      return this.provider.generateKeyPair(options);
    }
    return this._unavailable('generateKeyPair');
  }

  getPublicKeyPem(keyId) {
    if (this.provider && typeof this.provider.getPublicKeyPem === 'function') {
      return this.provider.getPublicKeyPem(keyId);
    }
    return null;
  }

  signBytes(dataBuffer, options) {
    if (this.provider && typeof this.provider.signBytes === 'function') {
      return this.provider.signBytes(dataBuffer, options);
    }
    return this._unavailable('signBytes');
  }

  signEngineeringArtifact(ecoDoc, pin) {
    if (this.provider) return this.provider.signEngineeringArtifact(ecoDoc, pin);
    return this._unavailable('signEngineeringArtifact');
  }

  describe() {
    if (this.provider && typeof this.provider.describe === 'function') {
      return this.provider.describe();
    }
    return {
      type: 'hardware-token-unavailable',
      status: this.status,
      validationLevel: this.validationLevel,
      driver: 'none',
      driverUnavailableCode: this.driverUnavailableCode || null,
      note:
        'No PKCS#11 driver is configured or present; hardware signing fails ' +
        'closed with CKR_FUNCTION_NOT_SUPPORTED. Pass { emulateSoftwareToken: true } ' +
        'to activate the FIPS-style software token emulator (not hardware-certified).'
    };
  }
}

module.exports = {
  PKCS11HardwareToken,
  SoftwareTokenEmulator,
  PKCS11DriverUnavailableError,
  CKR,
  CKU,
  CKM,
  SOFTWARE_TOKEN_LABEL
};
