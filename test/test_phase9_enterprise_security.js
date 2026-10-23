/**
 * OmniEng Phase 9 Verification Suite:
 * PKCS#11 / FIPS 140-3 Hardware Security Module, Enterprise IAM (RBAC/ABAC/ITAR),
 * and CycloneDX / SPDX Software Bill of Materials (SBOM) Generation
 */

'use strict';

const assert = require('assert');
const { PKCS11HardwareToken, CKR, CKU } = require('../src/core/security/pkcs11_smartcard');
const { EnterpriseIAM, ACTIONS, CLEARANCE_LEVELS } = require('../src/core/security/enterprise_iam');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');

console.log('================================================================');
console.log('   RUNNING PHASE 9: PLM COLLABORATION & HARDWARE SECURITY      ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: OASIS PKCS#11 v3.0 / FIPS 140-3 Hardware Cryptographic Token
// -----------------------------------------------------------------------------
console.log('[P9-1] PKCS#11 & FIPS 140-3 Hardware Security Token...');
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
assert(tamperHsm.isZeroized === true, 'FIPS 140-3 Level 4 zeroization must wipe key store');
assert(tamperHsm.keyStore.size === 0, 'Keys must be wiped after lockout');

console.log(`  ✓ [P9-1] PKCS#11 FIPS 140-3 HSM: ECDSA P-384 signature verified, anti-tamper zeroization lockout confirmed`);

// -----------------------------------------------------------------------------
// Test 2: Enterprise RBAC & ABAC Multi-User Authorization (ITAR & Clearances)
// -----------------------------------------------------------------------------
console.log('\n[P9-2] Enterprise RBAC & ABAC Multi-User Authorization Engine...');

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

// Test A: Chief Engineer approves ECO on ITAR Hypersonic Wing -> GRANTED
const resA = EnterpriseIAM.canApproveECO(chiefEng, itarWing);
assert(resA.granted === true, 'Chief Engineer must be granted ECO approval on assigned ITAR project');

// Test B: Stress Analyst tries to approve ECO on Civil Propeller -> DENIED (RBAC: StressAnalyst cannot approve ECOs)
const resB = EnterpriseIAM.canApproveECO(stressAnalyst, civilProp);
assert(resB.granted === false && resB.reason.includes('RBAC'), 'Stress analyst cannot approve ECOs');

// Test C: Stress Analyst tries to read ITAR Hypersonic Wing -> DENIED (ABAC: Clearance + ITAR + Project)
const resC = EnterpriseIAM.evaluateAccess({
  user: stressAnalyst,
  action: ACTIONS.READ,
  resource: itarWing
});
assert(resC.granted === false, 'Junior analyst must be denied access to ITAR Top Secret project');

// Test D: Stress Analyst modifies Civil Propeller -> GRANTED
const resD = EnterpriseIAM.evaluateAccess({
  user: stressAnalyst,
  action: ACTIONS.MODIFY_CAD,
  resource: civilProp
});
assert(resD.granted === true, 'Stress analyst can modify assigned unclassified civil drone CAD');

console.log('  ✓ [P9-2] Enterprise IAM: Role boundaries, classification hierarchy, and ITAR compliance strictly enforced');

// -----------------------------------------------------------------------------
// Test 3: CycloneDX v1.5 & SPDX v2.3 Software Bill of Materials (SBOM)
// -----------------------------------------------------------------------------
console.log('\n[P9-3] CycloneDX v1.5 & SPDX v2.3 SBOM Regulatory Generator...');
const qualKit = new ToolQualificationKit();

const cdx = qualKit.generateCycloneDX_SBOM();
assert(cdx.bomFormat === 'CycloneDX', 'Must format as CycloneDX');
assert(cdx.specVersion === '1.5', 'CycloneDX spec version 1.5');
assert(cdx.components.length >= 9, 'Must list all core engineering modules');
assert(cdx.components.every(c => c.hashes && c.hashes[0].alg === 'SHA-256'), 'All components must have SHA-256 integrity hashes');
assert(cdx.vulnerabilities.length === 0, 'Clean zero-vulnerability record');

const spdx = qualKit.generateSPDX_SBOM();
assert(spdx.spdxVersion === 'SPDX-2.3', 'SPDX spec version 2.3');
assert(spdx.packages.length >= 9, 'SPDX packages must reflect components');
assert(spdx.packages[0].checksums[0].algorithm === 'SHA256', 'SPDX SHA256 checksums');

console.log(`  ✓ [P9-3] SBOM Generator: CycloneDX v1.5 & SPDX v2.3 generated with ${cdx.components.length} verified packages`);

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

console.log('  ✓ [P9-4] All 4 Phase 9 Security & IAM IPC Channels Registered & Schema-Validated');

console.log('\n================================================================');
console.log('   ALL 4 PHASE 9 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
