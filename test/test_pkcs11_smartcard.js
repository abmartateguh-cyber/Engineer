/**
 * PKCS#11 smartcard surface: fail-closed and software-token-emulator tests.
 *
 * Verifies that (1) without a configured native bridge every signing path
 * fails closed with CKR_FUNCTION_NOT_SUPPORTED and never yields a signature,
 * (2) misconfigured driver paths are reported with typed codes, and (3) the
 * explicitly requested software token emulator produces real ECDSA P-384 /
 * RSA-4096 SHA-384 signatures that verify, reject tampering, and zeroize on
 * PIN lockout.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  PKCS11HardwareToken,
  SoftwareTokenEmulator,
  PKCS11DriverUnavailableError,
  CKR,
  CKU,
  CKM
} = require('../src/core/security/pkcs11_smartcard');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

const savedEnv = { a: process.env.OMNIENG_PKCS11_DRIVER, b: process.env.PKCS11_MODULE_PATH };
delete process.env.OMNIENG_PKCS11_DRIVER;
delete process.env.PKCS11_MODULE_PATH;

console.log('\nPKCS#11 smartcard surface tests');

check('no driver configured: fails closed, no signature produced', () => {
  const tok = new PKCS11HardwareToken();
  assert.strictEqual(tok.status, 'unavailable');
  assert.strictEqual(tok.driverUnavailableCode, 'NO_DRIVER_CONFIGURED');
  assert.strictEqual(tok.C_Initialize(), CKR.CKR_FUNCTION_NOT_SUPPORTED);
  const s = tok.signBytes(Buffer.from('payload'));
  assert.strictEqual(s.rv, CKR.CKR_FUNCTION_NOT_SUPPORTED);
  assert.strictEqual(s.success, false);
  assert.strictEqual(s.signatureHex, undefined);
  const art = tok.signEngineeringArtifact({ eco: 1 });
  assert.strictEqual(art.success, false);
  assert.strictEqual(art.hsmSignature, undefined);
  assert.strictEqual(tok.C_Verify('ROOT_SIGNING_KEY', 'x', '00').valid, false);
  assert.strictEqual(tok.getPublicKeyPem('ROOT_SIGNING_KEY'), null);
  assert.strictEqual(tok.describe().type, 'hardware-token-unavailable');
});

check('missing driver path: typed DRIVER_PATH_MISSING error', () => {
  const tok = new PKCS11HardwareToken({ driverPath: path.join(os.tmpdir(), 'does-not-exist-omnieng.node') });
  assert.strictEqual(tok.status, 'unavailable');
  assert.strictEqual(tok.driverUnavailableCode, 'DRIVER_PATH_MISSING');
  assert(tok.driverError instanceof PKCS11DriverUnavailableError);
  assert.strictEqual(tok.driverError.code, 'ERR_PKCS11_DRIVER_UNAVAILABLE');
  assert.match(tok.signBytes(Buffer.from('x')).error, /does not exist/);
});

check('non-.node driver file: rejected as DRIVER_NOT_NODE_BRIDGE (never dlopened)', () => {
  const fake = path.join(os.tmpdir(), `omnieng-fake-pkcs11-${process.pid}.dylib`);
  fs.writeFileSync(fake, 'not a library');
  try {
    const tok = new PKCS11HardwareToken({ driverPath: fake });
    assert.strictEqual(tok.driverUnavailableCode, 'DRIVER_NOT_NODE_BRIDGE');
    assert.strictEqual(tok.C_Sign(1, 'x').rv, CKR.CKR_FUNCTION_NOT_SUPPORTED);
  } finally {
    fs.unlinkSync(fake);
  }
});

check('corrupt .node bridge: DLOPEN_FAILED, still fails closed', () => {
  const fake = path.join(os.tmpdir(), `omnieng-fake-pkcs11-${process.pid}.node`);
  fs.writeFileSync(fake, 'garbage');
  try {
    const tok = new PKCS11HardwareToken({ driverPath: fake });
    assert.strictEqual(tok.driverUnavailableCode, 'DLOPEN_FAILED');
    assert.strictEqual(tok.status, 'unavailable');
    assert.strictEqual(tok.signBytes(Buffer.from('x')).success, false);
  } finally {
    fs.unlinkSync(fake);
  }
});

check('env var driver path is honoured (and fails closed when absent)', () => {
  process.env.OMNIENG_PKCS11_DRIVER = path.join(os.tmpdir(), 'omnieng-env-missing.node');
  try {
    const tok = new PKCS11HardwareToken();
    assert.strictEqual(tok.driverUnavailableCode, 'DRIVER_PATH_MISSING');
  } finally {
    delete process.env.OMNIENG_PKCS11_DRIVER;
  }
});

check('emulator ECDSA P-384: sign/verify round trip and tamper rejection', () => {
  const tok = new PKCS11HardwareToken({ emulateSoftwareToken: true });
  assert.strictEqual(tok.status, 'available');
  assert.strictEqual(tok.describe().hardwareBacked, false);
  const data = Buffer.from('ECO-1234 rev B');
  const s = tok.signBytes(data);
  assert.strictEqual(s.success, true);
  assert.strictEqual(s.algorithm, 'ECDSA-P384-SHA384');
  assert.strictEqual(tok.C_Verify(s.keyId, data, s.signatureBuffer).valid, true);
  assert.strictEqual(tok.C_Verify(s.keyId, Buffer.from('ECO-1234 rev C'), s.signatureBuffer).valid, false);
  const pem = tok.getPublicKeyPem(s.keyId);
  const v = crypto.createVerify('SHA384');
  v.update(data);
  assert.strictEqual(v.verify(pem, s.signatureBuffer), true, 'independent node:crypto verification');
});

check('emulator RSA-4096: numeric CKM mechanism and key/mechanism mismatch', () => {
  const emu = new SoftwareTokenEmulator();
  assert.strictEqual(emu.C_Initialize(), CKR.CKR_OK);
  const k = emu.generateKeyPair({ algorithm: 'RSA4096-SHA384', keyId: 'RSA_K' });
  assert.strictEqual(k.algorithm, 'RSA4096-SHA384');
  const s = emu.signBytes(Buffer.from('doc'), { mechanism: CKM.CKM_SHA384_RSA_PKCS, keyId: 'RSA_K' });
  assert.strictEqual(s.success, true);
  assert.strictEqual(s.algorithm, 'RSA4096-SHA384');
  assert.strictEqual(emu.C_Verify('RSA_K', Buffer.from('doc'), s.signatureBuffer).valid, true);
  const mismatch = emu.signBytes(Buffer.from('doc'), { mechanism: 'ECDSA-SHA384', keyId: 'RSA_K' });
  assert.strictEqual(mismatch.rv, CKR.CKR_FUNCTION_NOT_SUPPORTED);
  const unknown = emu.signBytes(Buffer.from('doc'), { mechanism: 'MD5' });
  assert.strictEqual(unknown.rv, CKR.CKR_FUNCTION_NOT_SUPPORTED);
});

check('emulator session/login state machine', () => {
  const emu = new SoftwareTokenEmulator();
  assert.strictEqual(emu.C_GetSlotList().rv, CKR.CKR_CRYPTOKI_NOT_INITIALIZED);
  emu.C_Initialize();
  assert.strictEqual(emu.C_Initialize(), CKR.CKR_CRYPTOKI_ALREADY_INITIALIZED);
  assert.strictEqual(emu.C_OpenSession(7).rv, CKR.CKR_SLOT_ID_INVALID);
  const { hSession } = emu.C_OpenSession(0);
  assert.strictEqual(emu.C_SignInit(hSession, 'ECDSA'), CKR.CKR_USER_NOT_LOGGED_IN);
  assert.strictEqual(emu.C_Login(hSession, CKU.CKU_USER, emu.userPin), CKR.CKR_OK);
  assert.strictEqual(emu.C_Sign(hSession, 'x').rv, CKR.CKR_CRYPTOKI_NOT_INITIALIZED, 'sign without SignInit');
  assert.strictEqual(emu.C_SignInit(hSession, 'ECDSA', 'NO_SUCH_KEY'), CKR.CKR_KEY_HANDLE_INVALID);
  assert.strictEqual(emu.C_Logout(hSession), CKR.CKR_OK);
  assert.strictEqual(emu.C_CloseSession(hSession), CKR.CKR_OK);
  assert.strictEqual(emu.C_CloseSession(hSession), CKR.CKR_SESSION_HANDLE_INVALID);
});

check('emulator PIN lockout zeroizes key store', () => {
  const emu = new SoftwareTokenEmulator({ userPin: 'right', maxPinAttempts: 3 });
  emu.C_Initialize();
  const { hSession } = emu.C_OpenSession(0);
  assert.strictEqual(emu.C_Login(hSession, CKU.CKU_USER, 'w1'), CKR.CKR_PIN_INCORRECT);
  assert.strictEqual(emu.C_Login(hSession, CKU.CKU_USER, 'w2'), CKR.CKR_PIN_INCORRECT);
  assert.strictEqual(emu.C_Login(hSession, CKU.CKU_USER, 'w3'), CKR.CKR_PIN_LOCKED);
  assert.strictEqual(emu.isZeroized, true);
  assert.strictEqual(emu.keyStore.size, 0);
  assert.strictEqual(emu.C_Login(hSession, CKU.CKU_USER, 'right'), CKR.CKR_PIN_LOCKED, 'correct PIN after lock');
  assert.strictEqual(emu.C_GetTokenInfo(0).info.flags.CKF_USER_PIN_LOCKED, true);
});

check('emulator signEngineeringArtifact: wrong PIN throws, correct PIN signs', () => {
  const emu = new SoftwareTokenEmulator({ userPin: 'p' });
  assert.throws(() => emu.signEngineeringArtifact({ eco: 'A' }, 'bad'), /login failed/);
  const r = emu.signEngineeringArtifact({ eco: 'A' }, 'p');
  assert.strictEqual(r.cryptoAlgorithm, 'ECDSA-P384-SHA384');
  assert.strictEqual(r.artifactSha384.length, 96);
  assert.match(r.testFixtureInfo.moduleStatus, /not hardware-certified/);
});

if (savedEnv.a !== undefined) process.env.OMNIENG_PKCS11_DRIVER = savedEnv.a;
if (savedEnv.b !== undefined) process.env.PKCS11_MODULE_PATH = savedEnv.b;

console.log(`\n  Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
