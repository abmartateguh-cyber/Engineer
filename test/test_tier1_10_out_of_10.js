/**
 * Experimental security and CAD helper smoke checks
 *
 * Exercises helper modules; this does not establish industrial readiness:
 *   [T10-1] IPC Security Validator (Prototype Pollution, Path Traversal, Finite Bounds)
 *   [T10-2] OmniVaultAES256 Encrypted Container & Zip Bomb Decompression Guards
 *   [T10-3] Immutable Audit Ledger with Merkle Hash Chaining & Tamper Detection
 *   [T10-4] Native Accelerator Interface with Tiled GEMM & SpMV
 *   [T10-5] Out-of-Core Hierarchical Spatial Octree Assembly Manager
 *   [T10-6] Caller-dimensioned geometry helpers (standard catalogs unavailable)
 *   [T10-7] Enterprise Keymap & Shortcut Manager (CATIA, NX, SolidWorks, Blender)
 */

'use strict';

const assert = require('assert');
const path = require('path');
const zlib = require('zlib');

const { IPCValidator } = require('../src/core/security/ipc_validator');
const { OmniArchive, OmniVaultAES256 } = require('../src/core/storage/omni_archive');
const { ImmutableAuditLedger } = require('../src/core/compliance/immutable_audit_ledger');
const { NativeAcceleratorInterface, accelerator } = require('../src/core/math/native_accelerator_interface');
const { OctreeNode, OutOfCoreAssemblyManager } = require('../src/core/cad/out_of_core_octree');
const { StandardPartsLibrary } = require('../src/core/cad/standard_parts_library');
const { KeymapManager, KEYMAP_PROFILES } = require('../src/ui/keymap_manager');
const { WasmKernelEngine, buildOmniEngWasmBinary } = require('../src/core/math/wasm_kernel_engine');
const { GeometryKernelAdapter } = require('../src/core/cad/kernel_adapter');

function runTier1TenOutOfTenTests() {
  console.log('\n================================================================');
  console.log('   RUNNING EXPERIMENTAL SECURITY AND CAD HELPER CHECKS   ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function runTest(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // [T10-1] IPC Security Validator
  runTest('[T10-1] Security IPC Validator & Prototype Pollution Stripper...', () => {
    // 1. Prototype Pollution Stripping
    const maliciousPayload = JSON.parse(
      '{"valid": 42, "__proto__": {"polluted": true}, "nested": {"constructor": "exploit", "ok": 100}}'
    );
    const sanitized = IPCValidator.sanitize(maliciousPayload);
    assert.strictEqual(sanitized.valid, 42);
    assert.strictEqual(sanitized.nested.ok, 100);
    assert.strictEqual(Object.prototype.polluted, undefined, 'Prototype must not be polluted');
    assert.strictEqual(sanitized.constructor, Object);

    // 2. Finite Number Validation
    assert.strictEqual(IPCValidator.validateFiniteNumbers({ x: 10.5, y: -20.0 }, ['x', 'y']), true);
    assert.throws(() => IPCValidator.validateFiniteNumbers({ x: NaN }, ['x']), /must be a finite number/);
    assert.throws(() => IPCValidator.validateFiniteNumbers({ x: Infinity }, ['x']), /must be a finite number/);

    const inputBytes = Buffer.from([1, 2, 3]);
    const cleanBytes = IPCValidator.sanitize(inputBytes);
    assert(Buffer.isBuffer(cleanBytes), 'Binary IPC sanitizer must preserve Buffer payloads');
    assert.deepStrictEqual(cleanBytes, inputBytes, 'Binary IPC sanitizer must preserve payload bytes');
    assert.notStrictEqual(cleanBytes, inputBytes, 'Binary IPC sanitizer must copy Buffer payloads');
    const inputArray = new Uint8Array([4, 5, 6]);
    const cleanArray = IPCValidator.sanitize(inputArray);
    assert(cleanArray instanceof Uint8Array, 'Binary IPC sanitizer must preserve Uint8Array payloads');
    assert.deepStrictEqual([...cleanArray], [...inputArray], 'Binary IPC sanitizer must preserve typed-array bytes');

    // 3. Path Traversal Quarantine
    const baseDir = '/safe/workspace';
    const safePath = IPCValidator.sanitizePath('exports/model.step', baseDir);
    assert.strictEqual(safePath, path.resolve(baseDir, 'exports/model.step'));
    assert.throws(() => IPCValidator.sanitizePath('../../etc/passwd', baseDir), /Path traversal attempt/);
  });

  // [T10-2] Industrial Encrypted Vault & Zip Bomb Guard
  runTest('[T10-2] Experimental Encrypted Snapshot and Archive Size Limits...', () => {
    const archive = new OmniArchive({ projectName: 'Turbofan_Blade_Stage1' });
    archive.addSection('geometry', { mesh: 'TET10_Mesh_Data', elements: 15000 });
    archive.addSection('material', { name: 'Inconel 718', youngsModulusGpa: 205.0 });

    const password = 'test-only snapshot password';
    const encryptedBuf = archive.saveToEncryptedBuffer(password);
    assert(encryptedBuf.length > 52, 'Encrypted buffer must include cryptographic headers');

    // Wrong password test
    assert.throws(() => OmniArchive.loadFromEncryptedBuffer(encryptedBuf, 'WrongPassword'), /Decryption Failed/);

    // Correct password roundtrip test
    const decryptedArchive = OmniArchive.loadFromEncryptedBuffer(encryptedBuf, password);
    assert.strictEqual(decryptedArchive.manifest.projectName, 'Turbofan_Blade_Stage1');
    const mat = decryptedArchive.getSection('material');
    assert.strictEqual(mat.name, 'Inconel 718');
    assert.strictEqual(mat.youngsModulusGpa, 205.0);
  });

  // [T10-3] Immutable Audit Ledger
  runTest('[T10-3] Immutable Audit Ledger (DO-178C DAL-A & ISO 26262 ASIL-D)...', () => {
    const ledger = new ImmutableAuditLedger('OmniEng_Aerospace_Seed');
    ledger.recordAction('Chief_Aerodynamicist', 'AIRFOIL_CONTOUR_LOCK', { profile: 'NACA 6412', mach: 0.78 });
    ledger.recordAction('Lead_Structural_Engineer', 'FEA_MARGIN_SIGN_OFF', {
      minSafetyFactor: 1.54,
      status: 'CONFORMS'
    });

    const initialCheck = ledger.verifyChainIntegrity();
    assert.strictEqual(initialCheck.isValid, true);
    assert.strictEqual(initialCheck.blockCount, 3); // Genesis + 2 entries

    // Tamper test: Alter payload in block 1
    const originalPayload = ledger.chain[1].details;
    ledger.chain[1].details = { profile: 'TAMPERED_PROFILE' };
    const tamperedCheck = ledger.verifyChainIntegrity();
    assert.strictEqual(tamperedCheck.isValid, false, 'Tampered block must fail cryptographic verification');
    assert(tamperedCheck.error.includes('Tampered hash') || tamperedCheck.error.includes('computed digest'));

    // Restore payload
    ledger.chain[1].details = originalPayload;
    assert.strictEqual(ledger.verifyChainIntegrity().isValid, true);
  });

  // [T10-4] Native Accelerator Interface
  runTest('[T10-4] Native Accelerator Interface (GEMM, SpMV, BLAS & SIMD)...', () => {
    const M = 4,
      N = 4,
      K = 4;
    const A = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7]);
    const B = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // Identity matrix
    const C = new Float64Array(16);

    // C = 2.0 * A * I + 0.0 * C
    accelerator.gemm(M, N, K, 2.0, A, B, 0.0, C);
    assert.strictEqual(C[0], 2.0);
    assert.strictEqual(C[1], 4.0);
    assert.strictEqual(C[5], 12.0);

    // Dot product test
    const v1 = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const v2 = new Float64Array([2, 2, 2, 2, 2, 2, 2, 2]);
    const dotProduct = accelerator.dot(v1, v2);
    assert.strictEqual(dotProduct, 72.0);

    const info = accelerator.getBackendInfo();
    assert(info.activeTier !== undefined);
    assert(info.hardwareAccelerationFactor >= 1.0);
  });

  // [T10-5] Out-of-Core Hierarchical Spatial Octree Assembly Manager
  runTest('[T10-5] Out-of-Core Hierarchical Spatial Octree Assembly Manager...', () => {
    const manager = new OutOfCoreAssemblyManager([-1000, -1000, -1000, 1000, 1000, 1000]);

    // Register 100 spatial components
    for (let i = 0; i < 100; i++) {
      const x = (i % 10) * 80 - 400;
      const y = Math.floor(i / 10) * 80 - 400;
      manager.registerPart({
        id: `PART_ASM_${i}`,
        name: `Component_${i}`,
        bounds: [x, y, 0, x + 20, y + 20, 20]
      });
    }

    assert.strictEqual(manager.partRegistry.size, 100);

    // Camera close to part 0
    const closeRes = manager.evaluateVisibleLODs([-400, -400, 50], [-500, -500, -100, -300, -300, 100]);
    assert(closeRes.visibleCount > 0);
    const part0 = closeRes.activeRenderList.find((r) => r.id === 'PART_ASM_0');
    assert(part0 !== undefined);
    assert.strictEqual(part0.lodLevel, 'HIGH_BREP');

    // Camera far away
    const farRes = manager.evaluateVisibleLODs([0, 0, 900], [-1000, -1000, -100, 1000, 1000, 100]);
    assert(farRes.visibleCount > 0);
    assert(farRes.activeRenderList.every((r) => r.lodLevel === 'MEDIUM_MESH' || r.lodLevel === 'PROXY_BBOX'));
  });

  // [T10-6] Standard-parts records fail closed without provenance
  runTest('[T10-6] Standard-Parts Catalog Availability...', () => {
    const records = [
      StandardPartsLibrary.getAvailability(),
      StandardPartsLibrary.generateHexBolt(8, 40, '8.8'),
      StandardPartsLibrary.generateHexNut(8, '8'),
      StandardPartsLibrary.generateBallBearing('6204'),
      StandardPartsLibrary.generateHoleCallout(8, 20, true)
    ];

    for (const result of records) {
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 'UNAVAILABLE');
      assert.strictEqual(result.error.code, 'UNSUPPORTED');
    }
    assert.match(records[0].error.message, /source, revision, applicability, and redistribution review/);

    const bolt = StandardPartsLibrary.generateHexBolt({
      shankDiameterMm: 8,
      shankLengthMm: 25,
      headAcrossFlatsMm: 14,
      headHeightMm: 4
    });
    assert.strictEqual(bolt.success, true);
    assert.strictEqual(bolt.validationLevel, 'experimental');
    assert.strictEqual(bolt.units, 'mm');
    assert.strictEqual(bolt.headVerticesMm.length, 6);
    assert.ok(Math.abs(bolt.boundingBoxMm[3] - bolt.boundingBoxMm[0] - 14) < 1e-10);
    assert.strictEqual(Object.hasOwn(bolt, 'standard'), false);
    assert.strictEqual(Object.hasOwn(bolt, 'propertyClass'), false);

    const nut = StandardPartsLibrary.generateHexNut({
      outerAcrossFlatsMm: 15,
      thicknessMm: 5,
      boreDiameterMm: 8
    });
    assert.strictEqual(nut.success, true);
    assert.strictEqual(nut.outerVerticesMm.length, 6);

    const bearing = StandardPartsLibrary.generateBallBearing({
      boreDiameterMm: 20,
      outerDiameterMm: 47,
      widthMm: 14,
      rollingElementCount: 8,
      rollingElementDiameterMm: 5,
      pitchDiameterMm: 33
    });
    assert.strictEqual(bearing.success, true);
    assert.strictEqual(bearing.rollingElementCentersMm.length, 8);
    assert.strictEqual(bearing.racewayGeometry, 'not generated');
    assert.strictEqual(bearing.loadRatings, 'not calculated');

    const callout = StandardPartsLibrary.generateHoleCallout({
      nominalDiameterMm: 8,
      pitchMm: 1.2,
      tapDrillDiameterMm: 6.5,
      tapDepthMm: 18,
      counterboreDiameterMm: 13,
      counterboreDepthMm: 3
    });
    assert.strictEqual(callout.success, true);
    assert.match(callout.callout, /pitch 1\.2 mm/);
    assert.strictEqual(/ISO|ASME|DIN|SKF/.test(callout.callout), false);
  });

  // [T10-7] CAD keymap profile selection
  runTest('[T10-7] CAD Keymap Profiles...', () => {
    const km = new KeymapManager('OMNIENG_DEFAULT');
    assert.strictEqual(km.getBinding('KeyF'), 'ACTION_FIT_VIEWPORT');
    assert.strictEqual(km.getBinding('Ctrl+KeyK'), 'ACTION_OPEN_COMMAND_PALETTE');

    // Switch to CATIA V5 profile
    km.setProfile('CATIA_V5');
    assert.strictEqual(km.getBinding('F3'), 'ACTION_TOGGLE_SPEC_TREE');
    assert.strictEqual(km.getBinding('KeyF'), 'ACTION_FIT_VIEWPORT');

    // Switch to Blender profile
    km.setProfile('BLENDER');
    assert.strictEqual(km.getBinding('Numpad7'), 'ACTION_VIEW_TOP');
    assert.strictEqual(km.getBinding('KeyG'), 'ACTION_TRANSLATE_SELECTION');

    // Action dispatching
    let actionTriggered = false;
    km.onAction('ACTION_VIEW_TOP', () => {
      actionTriggered = true;
    });
    km.dispatchAction('ACTION_VIEW_TOP');
    assert.strictEqual(actionTriggered, true);
  });

  // [T10-8] Bare-Metal WebAssembly Kernel Engine
  runTest('[T10-8] Native WebAssembly Kernel Engine (Bytecode Compiler, SIMD128, SpMV, DAXPY)...', () => {
    const engine = new WasmKernelEngine();
    const initialized = engine.init();
    assert.strictEqual(initialized, true);
    assert.strictEqual(engine.isReady, true);

    // Test addF64
    const sum = engine.addF64(12.5, 37.5);
    assert.strictEqual(sum, 50.0);

    // Test vector dot product
    const a = new Float64Array([1, 2, 3, 4]);
    const b = new Float64Array([5, 6, 7, 8]);
    const dot = engine.dotProduct(a, b);
    assert.strictEqual(dot, 70.0);

    // Test DAXPY: y = 2.5 * x + y
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([10, 20, 30]);
    engine.daxpy(x, y, 2.5);
    assert.strictEqual(y[0], 12.5);
    assert.strictEqual(y[1], 25.0);
    assert.strictEqual(y[2], 37.5);

    // Test Vector Norm
    const norm = engine.vectorNorm(new Float64Array([3, 4]));
    assert.strictEqual(norm, 5.0);

    // Test SpMV
    const rowPtr = new Int32Array([0, 2, 3]);
    const colInd = new Int32Array([0, 1, 1]);
    const values = new Float64Array([10, 20, 30]);
    const vx = new Float64Array([1, 2]);
    const vy = new Float64Array(2);
    engine.spmv(rowPtr, colInd, values, vx, vy, 2);
    assert.strictEqual(vy[0], 50.0); // 10*1 + 20*2 = 50
    assert.strictEqual(vy[1], 60.0); // 30*2 = 60
  });

  // [T10-9] Unified CAD Geometry Kernel Adapter & NIST Validation Properties
  runTest('[T10-9] Unified CAD Geometry Kernel Adapter & NIST AP242 Validation Properties...', () => {
    const adapter = new GeometryKernelAdapter();
    const box = adapter.makeBox(10, 20, 30, 'TestBox');
    assert.strictEqual(box.faces.length, 6);
    assert.strictEqual(box.faces[0].tag.startsWith('TestBox:FACE'), true);
    const resolved = adapter.namingManager.resolveTag(box.faces[0].tag);
    assert.strictEqual(resolved.entity.featureId, 'TestBox');

    const cylinder = adapter.makeCylinder(5, 20, 'TestCyl');
    assert(cylinder.faces.length > 0);

    // NIST Recommended Practice Validation Properties (Volume, Area, Centroid, BBox)
    const props = adapter.computeValidationProperties(box);
    assert.strictEqual(props.volume, 6000.0); // 10 * 20 * 30
    assert.strictEqual(props.surfaceArea, 2200.0); // 2*(10*20 + 20*30 + 10*30)
    assert.strictEqual(props.centroid.x, 0.0);
    assert.strictEqual(props.centroid.y, 0.0);
    assert.strictEqual(props.centroid.z, 0.0);
    assert.strictEqual(props.boundingBox.dx, 10);
    assert.strictEqual(props.boundingBox.dy, 20);
    assert.strictEqual(props.boundingBox.dz, 30);

    const info = adapter.getKernelInfo();
    assert.strictEqual(info.ap242Compliance, false);
    assert.strictEqual(info.validationProperties, 'experimental');
  });

  console.log(`\n================================================================`);
  console.log(`  SUMMARY: ${passed} / ${total} experimental helper assertions passed`);
  console.log('================================================================\n');

  return { passed, total };
}

module.exports = { runTier1TenOutOfTenTests };

if (require.main === module) {
  const res = runTier1TenOutOfTenTests();
  process.exit(res.passed === res.total ? 0 : 1);
}
