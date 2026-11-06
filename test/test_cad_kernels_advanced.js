/**
 * test_cad_kernels_advanced.js
 * Verification of OpenCASCADE Technology B-Rep Kernel and SolveSpace SLVS Variational Solver.
 */

const assert = require('assert');
const { getOpenCascadeKernel } = require('../src/core/cad/opencascade_kernel');
const { SlvsSolver } = require('../src/core/cad/slvs_solver');

console.log('[TEST] Running Advanced CAD Kernels (OpenCASCADE & SolveSpace SLVS)...');

// ==========================================
// 1. OpenCASCADE B-Rep Modeling & Invariants
// ==========================================
const occt = getOpenCascadeKernel();

// Create Box: 100 x 50 x 20 mm
const box = occt.makeBox(100, 50, 20);
assert.strictEqual(box.faces.length, 6, 'Box must have 6 faces');
const epBox = box.verifyEulerPoincare();
assert.strictEqual(epBox.valid, true, 'Euler-Poincare formula V - E + F = 2(S - G) must hold');
assert.strictEqual(epBox.V, 8, 'Box must have 8 vertices');
assert.strictEqual(epBox.E, 12, 'Box must have 12 edges');
assert.strictEqual(epBox.F, 6, 'Box must have 6 faces');
assert.strictEqual(epBox.lhs, 2, 'V - E + F must equal 2 for simply connected solid');
console.log(`  ✓ PASS: OpenCASCADE B-Rep Box created: V=${epBox.V}, E=${epBox.E}, F=${epBox.F}, Euler invariant verified`);

// Create Cylinder: R = 10, H = 30 mm
const cyl = occt.makeCylinder(10, 30);
assert.strictEqual(cyl.faces.length, 3, 'Cylinder must have 3 faces (2 disks + lateral)');
assert.ok(cyl.properties.volume > 9000, 'Cylinder volume calculation');
console.log(`  ✓ PASS: OpenCASCADE B-Rep Cylinder created: R=${cyl.properties.radius} mm, H=${cyl.properties.height} mm`);

// Boolean Cut: Box minus Cylinder (creates through-hole)
const cutSolid = occt.booleanCut(box, cyl);
assert.strictEqual(cutSolid.genus, 1, 'Through-hole cut must increment genus to 1');
assert.ok(cutSolid.properties.volume < box.properties.volume, 'Cut volume must be less than original box');
console.log(`  ✓ PASS: OpenCASCADE Boolean Cut executed: Net volume = ${cutSolid.properties.volume} mm^3, Genus = ${cutSolid.genus}`);

// Shape Fix
const fixReport = occt.shapeFix(box);
assert.strictEqual(fixReport.fixed, true);
console.log('  ✓ PASS: OpenCASCADE ShapeFix verified');

// ==========================================
// 2. SolveSpace SLVS Variational Solver
// ==========================================
const solver = new SlvsSolver();

// Formulate 3-4-5 right triangle:
// Point A: Fixed at (0, 0, 0)
solver.addPoint('ptA', 0, 0, 0, true);

// Point B: Free, constrained horizontal to A, distance = 100 mm -> Expected (100, 0, 0)
solver.addPoint('ptB', 80, 10, 0, false);
solver.addHorizontalConstraint('ptA', 'ptB');
solver.addDistanceConstraint('ptA', 'ptB', 100);

// Point C: Free, distance from A = 60 mm, distance from B = 80 mm -> Expected (36, 48, 0)
// Because 36^2 + 48^2 = 1296 + 2304 = 3600 = 60^2
// (100 - 36)^2 + 48^2 = 64^2 + 48^2 = 4096 + 2304 = 6400 = 80^2
solver.addPoint('ptC', 30, 40, 0, false);
solver.addDistanceConstraint('ptA', 'ptC', 60);
solver.addDistanceConstraint('ptB', 'ptC', 80);

const sol = solver.solve();
assert.strictEqual(sol.converged, true, 'SolveSpace constraint solver failed to converge');
assert.ok(sol.residualNorm < 1e-6, `Residual norm too high: ${sol.residualNorm}`);

const ptB = sol.points['ptB'];
const ptC = sol.points['ptC'];

assert.ok(Math.abs(ptB[0] - 100) < 1e-4, `ptB.x expected 100, got ${ptB[0]}`);
assert.ok(Math.abs(ptB[1] - 0) < 1e-4, `ptB.y expected 0, got ${ptB[1]}`);

assert.ok(Math.abs(ptC[0] - 36) < 1e-4, `ptC.x expected 36, got ${ptC[0]}`);
assert.ok(Math.abs(ptC[1] - 48) < 1e-4, `ptC.y expected 48, got ${ptC[1]}`);
console.log(`  ✓ PASS: SolveSpace SLVS converged in ${sol.iterations} iterations to residual ${sol.residualNorm.toExponential(3)}`);
console.log(`  ✓ PASS: 3-4-5 Triangle exact closure: ptA=(0,0), ptB=(${ptB[0].toFixed(2)}, ${ptB[1].toFixed(2)}), ptC=(${ptC[0].toFixed(2)}, ${ptC[1].toFixed(2)})`);

console.log('[TEST] Advanced CAD Kernels: ALL CHECKS PASSED CLEANLY.\n');
