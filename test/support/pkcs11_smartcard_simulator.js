/**
 * Experimental in-process signing-token simulator for tests.
 * This software fixture is not a PKCS#11 provider, hardware token, or FIPS-validated module.
 */

'use strict';

const crypto = require('crypto');

// Standard PKCS#11 Return Values
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
  CKR_SIGNATURE_INVALID: 0x000000c0
};

// User Types
const CKU = {
  CKU_SO: 0, // Security Officer
  CKU_USER: 1 // Normal User
};

class SoftwareSigningTestFixture {
  /**
   * @param {Object} options
   * @param {string} [options.label='OmniEng software test token']
   * @param {string} [options.manufacturer='OmniEng test fixture']
   * @param {string} [options.model='software-test-token']
   * @param {string} [options.serialNumber='test-token']
   * @param {string} options.userPin Test-only PIN; there is no default credential.
   * @param {number} [options.maxPinAttempts=3]
   */
  constructor(options = {}) {
    if (typeof options.userPin !== 'string' || options.userPin.length === 0) {
      throw new TypeError('A test-only PIN must be provided explicitly.');
    }
    this.label = options.label || 'OmniEng software test token';
    this.manufacturer = options.manufacturer || 'OmniEng test fixture';
    this.model = options.model || 'software-test-token';
    this.serialNumber = options.serialNumber || 'test-token';
    this.userPin = options.userPin;
    this.maxPinAttempts = options.maxPinAttempts || 3;
    this.failedAttempts = 0;
    this.isLocked = false;
    this.isZeroized = false;

    this.initialized = false;
    this.sessions = new Map();
    this.keyStore = new Map(); // keyId -> { privateKey, publicKey, algorithm, label }
    this.nextSessionId = 1000;
    this.nextKeyId = 5000;

    // Seed default ECDSA NIST P-384 engineering root signing key
    this._initializeDefaultKey();
  }

  _initializeDefaultKey() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'secp384r1'
    });
    this.keyStore.set('ROOT_SIGNING_KEY', {
      keyId: 'ROOT_SIGNING_KEY',
      algorithm: 'ECDSA-SHA384',
      curve: 'secp384r1',
      privateKey,
      publicKey,
      label: 'Ephemeral software test key'
    });
  }

  C_Initialize() {
    if (this.initialized) return CKR.CKR_CRYPTOKI_ALREADY_INITIALIZED;
    this.initialized = true;
    return CKR.CKR_OK;
  }

  C_Finalize() {
    this.initialized = false;
    this.sessions.clear();
    return CKR.CKR_OK;
  }

  C_GetSlotList(tokenPresent = true) {
    if (!this.initialized) return { rv: CKR.CKR_CRYPTOKI_NOT_INITIALIZED, slots: [] };
    return {
      rv: CKR.CKR_OK,
      slots: [0] // Slot 0 is primary cryptographic slot
    };
  }

  C_GetTokenInfo(slotId) {
    if (!this.initialized) return { rv: CKR.CKR_CRYPTOKI_NOT_INITIALIZED };
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
        validationStatus: 'unvalidated software test fixture'
      }
    };
  }

  C_OpenSession(slotId, flags = 0) {
    if (!this.initialized) return { rv: CKR.CKR_CRYPTOKI_NOT_INITIALIZED };
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
    if (!this.initialized) return CKR.CKR_CRYPTOKI_NOT_INITIALIZED;
    const session = this.sessions.get(hSession);
    if (!session) return CKR.CKR_SESSION_HANDLE_INVALID;

    if (this.isLocked) return CKR.CKR_PIN_LOCKED;

    if (pin !== this.userPin) {
      this.failedAttempts++;
      if (this.failedAttempts >= this.maxPinAttempts) {
        this.isLocked = true;
        this.isZeroized = true;
        this.keyStore.clear(); // Clear the in-memory test keys after repeated failed logins.
        return CKR.CKR_PIN_LOCKED;
      }
      return CKR.CKR_PIN_INCORRECT;
    }

    // Success
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
    return CKR.CKR_OK;
  }

  C_SignInit(hSession, mechanism, keyId = 'ROOT_SIGNING_KEY') {
    const session = this.sessions.get(hSession);
    if (!session) return CKR.CKR_SESSION_HANDLE_INVALID;
    if (!session.loggedIn) return CKR.CKR_USER_NOT_LOGGED_IN;

    const keyObj = this.keyStore.get(keyId);
    if (!keyObj) return CKR.CKR_CRYPTOKI_NOT_INITIALIZED;

    session.activeSigningContext = {
      mechanism: mechanism || 'ECDSA-SHA384',
      keyObj
    };

    return CKR.CKR_OK;
  }

  C_Sign(hSession, dataBuffer) {
    const session = this.sessions.get(hSession);
    if (!session) return { rv: CKR.CKR_SESSION_HANDLE_INVALID };
    if (!session.loggedIn) return { rv: CKR.CKR_USER_NOT_LOGGED_IN };
    if (!session.activeSigningContext) return { rv: CKR.CKR_CRYPTOKI_NOT_INITIALIZED };

    const { keyObj } = session.activeSigningContext;
    const signer = crypto.createSign('SHA384');
    signer.update(dataBuffer);
    signer.end();

    const signature = signer.sign(keyObj.privateKey);
    session.activeSigningContext = null;

    return {
      rv: CKR.CKR_OK,
      signatureHex: signature.toString('hex'),
      signatureBuffer: signature,
      algorithm: 'ECDSA-SHA384-secp384r1-test-fixture'
    };
  }

  C_Verify(keyId, dataBuffer, signatureBuffer) {
    const keyObj = this.keyStore.get(keyId);
    if (!keyObj) return { rv: CKR.CKR_CRYPTOKI_NOT_INITIALIZED, valid: false };

    const verifier = crypto.createVerify('SHA384');
    verifier.update(dataBuffer);
    verifier.end();

    const isValid = verifier.verify(keyObj.publicKey, signatureBuffer);
    return {
      rv: isValid ? CKR.CKR_OK : CKR.CKR_SIGNATURE_INVALID,
      valid: isValid
    };
  }

  /**
   * High-level helper: Cryptographically signs an Engineering Change Order (ECO) release artifact.
   * @param {Object} ecoDoc
   * @param {string} pin
   * @returns {Object} Signed ECO with tamper-evident digital seal
   */
  signEngineeringArtifact(ecoDoc, pin) {
    this.C_Initialize();
    const { hSession } = this.C_OpenSession(0);
    const loginRv = this.C_Login(hSession, CKU.CKU_USER, pin);
    if (loginRv !== CKR.CKR_OK) {
      this.C_CloseSession(hSession);
      throw new Error(`PKCS#11 HSM Login Failed: error code 0x${loginRv.toString(16)}`);
    }

    const payload = Buffer.from(JSON.stringify(ecoDoc));
    this.C_SignInit(hSession, 'ECDSA-SHA384');
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
        moduleStatus: 'test-only-unvalidated'
      },
      signedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  SoftwareSigningTestFixture,
  PKCS11HardwareToken: SoftwareSigningTestFixture,
  CKR,
  CKU
};
