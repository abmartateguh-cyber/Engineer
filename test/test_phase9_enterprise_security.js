/**
 * Legacy security helper smoke checks:
 * test-only signing fixture, unenforced policy examples, and runtime SBOM unavailability.
 */

'use strict';

const assert = require('assert');
const { PKCS11HardwareToken, CKR, CKU } = require('./support/pkcs11_smartcard_simulator');
const { EnterpriseIAM, ACTIONS, CLEARANCE_LEVELS } = require('../src/core/security/enterprise_iam');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');

console.log('================================================================');
console.log('   LEGACY SECURITY FIXTURE AND POLICY EXAMPLE CHECKS            ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: In-process signing fixture (not a PKCS#11 provider or validated module)
// -----------------------------------------------------------------------------
console.log('[P9-1] In-process software signing test fixture...');
const hsm = new PKCS11HardwareToken({ userPin: '789123', maxPinAttempts: 3 });

assert(hsm.C_Initialize() === CKR.CKR_OK, 'HSM C_Initialize must succeed');
const { slots } = hsm.C_GetSlotList();
assert(slots.length > 0, 'Slot list must contain active slot');

const { info } = hsm.C_GetTokenInfo(slots[0]);
assert(info.manufacturerID.includes('OmniEng'), 'Token manufacturer');
assert(info.flags.CKF_LOGIN_REQUIRED === true, 'Token requires PIN authentication');

// Session & Login
const { hSession } = hsm.C_OpenSession(slots[0]);
assert(hsm.C_Login(hSession, CKU.CKU_USER, 'WRONG_PIN') === CKR.CKR_PIN_INCORRECT, 'Wrong PIN must fail');
assert(hsm.C_Login(hSession, CKU.CKU_USER, '789123') === CKR.CKR_OK, 'Correct PIN must succeed');

// Sign data
const testPayload = Buffer.from('ENGINEERING_CHANGE_ORDER_ECO_99401_APPROVED');
assert(hsm.C_SignInit(hSession, 'ECDSA-SHA384') === CKR.CKR_OK, 'SignInit');
const { signatureHex, signatureBuffer } = hsm.C_Sign(hSession, testPayload);
assert(signatureHex && signatureHex.length > 64, 'ECDSA signature must be generated');

// Verify signature
const verifyRes = hsm.C_Verify('ROOT_SIGNING_KEY', testPayload, signatureBuffer);
assert(verifyRes.valid === true, 'Signature must be valid');

// Test Anti-tamper zeroization lockout
const tamperHsm = new PKCS11HardwareToken({ userPin: 'SECURE_PIN', maxPinAttempts: 2 });
tamperHsm.C_Initialize();
const sTamper = tamperHsm.C_OpenSession(0).hSession;
tamperHsm.C_Login(sTamper, CKU.CKU_USER, 'BAD1');
const lockRes = tamperHsm.C_Login(sTamper, CKU.CKU_USER, 'BAD2');
assert(lockRes === CKR.CKR_PIN_LOCKED, 'Second bad attempt must trigger lockout');
assert(tamperHsm.isZeroized === true, 'Test fixture clears its ephemeral in-memory key store after lockout');
assert(tamperHsm.keyStore.size === 0, 'Keys must be wiped after lockout');

console.log('  ✓ [P9-1] Ephemeral software test signature verified and test key store cleared after lockout');

// -----------------------------------------------------------------------------
// Test 2: Caller-supplied local policy examples; no identity or access is enforced.
// -----------------------------------------------------------------------------
console.log('\n[P9-2] Unenforced caller-supplied role and attribute examples...');

function assertNotAuthorizationExample(result) {
  assert.strictEqual(result.status, 'example-only');
  assert.strictEqual(result.validationLevel, 'experimental');
  assert.strictEqual(result.identityVerified, false);
  assert.strictEqual(result.enforced, false);
  assert.strictEqual(result.auditRecordPersisted, false);
}

// User 1: Chief Engineer, Top Secret, ITAR Certified
const chiefEng = {
  username: 'chief_mercer',
  role: 'ChiefEngineer',
  clearance: 'TOP_SECRET',
  itarCertified: true,
  assignedProjects: ['PROJECT_HYPERSONIC']
};

// User 2: Junior Stress Analyst, Confidential, Not ITAR
const stressAnalyst = {
  username: 'analyst_bob',
  role: 'StressAnalyst',
  clearance: 'CONFIDENTIAL',
  itarCertified: false,
  assignedProjects: ['PROJECT_CIVIL_DRONE']
};

// Resource 1: ITAR Hypersonic Wing Solid CAD (Top Secret)
const itarWing = {
  id: 'CAD_WING_AERO_001',
  projectId: 'PROJECT_HYPERSONIC',
  classification: 'TOP_SECRET',
  isITAR: true
};

// Resource 2: Civil Drone Propeller (Unclassified)
const civilProp = {
  id: 'CAD_PROP_001',
  projectId: 'PROJECT_CIVIL_DRONE',
  classification: 'UNCLASSIFIED',
  isITAR: false
};

// Test A: Local example rule accepts the supplied attribute values.
const resA = EnterpriseIAM.canApproveECO(chiefEng, itarWing);
assert(resA.granted === true, 'Local example rule accepts the supplied ECO attributes');
assertNotAuthorizationExample(resA);

// Test B: The local role example returns false for this supplied combination.
const resB = EnterpriseIAM.canApproveECO(stressAnalyst, civilProp);
assert(resB.granted === false && resB.reason.includes('RBAC'), 'Local role example returns its configured result');
assertNotAuthorizationExample(resB);

// Test C: The local classification example returns false for these supplied attributes.
const resC = EnterpriseIAM.evaluateAccess({
  user: stressAnalyst,
  action: ACTIONS.READ,
  resource: itarWing
});
assert(resC.granted === false, 'Local example rule returns false for the supplied classification attributes');
assertNotAuthorizationExample(resC);

// Test D: Local example rule accepts the supplied project and action attributes.
const resD = EnterpriseIAM.evaluateAccess({
  user: stressAnalyst,
  action: ACTIONS.MODIFY_CAD,
  resource: civilProp
});
assert(resD.granted === true, 'Local example rule accepts the supplied modification attributes');
assertNotAuthorizationExample(resD);

console.log('  ✓ [P9-2] Local policy examples returned decisions marked unverified and unenforced');

// -----------------------------------------------------------------------------
// Test 3: Runtime SBOM generation remains unsupported.
// -----------------------------------------------------------------------------
console.log('\n[P9-3] Runtime SBOM generation availability...');
const qualKit = new ToolQualificationKit();
assert.throws(() => qualKit.generateCycloneDX_SBOM(), /Runtime SBOM generation is unavailable/);
assert.throws(() => qualKit.generateSPDX_SBOM(), /Runtime SBOM generation is unavailable/);

console.log('  ✓ [P9-3] Runtime SBOM reports fail closed; reviewed build SBOMs are generated separately');

// -----------------------------------------------------------------------------
// Test 4: Phase 9 Security, PKCS#11 & IAM IPC Channel Registration & Integration
// -----------------------------------------------------------------------------
console.log('\n[P9-4] Phase 9 Security, PKCS#11 & IAM IPC Channel Integration...');
const { registerSystemIpc } = require('../src/main/ipc/system_ipc');
const { isChannelRegistered } = require('../src/main/ipc/define_handler');
registerSystemIpc();
assert(isChannelRegistered('omni:pkcs11-sign-payload'), 'Must register omni:pkcs11-sign-payload');
assert(isChannelRegistered('omni:pkcs11-verify-signature'), 'Must register omni:pkcs11-verify-signature');
assert(isChannelRegistered('omni:iam-evaluate-access'), 'Must register omni:iam-evaluate-access');
assert(isChannelRegistered('omni:generate-sbom'), 'Must register omni:generate-sbom');

console.log('  ✓ [P9-4] All 4 Phase 9 Security & IAM IPC Channels Registered');

console.log('\n================================================================');
console.log('   ALL 4 PHASE 9 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
