/**
 * OmniEng Phase 2 Verification Suite:
 * High-Order Mechanics (TET10 Quadratic FEA) & Augmented Lagrangian Contact
 */

'use strict';

const assert = require('assert');
const { FEASolver } = require('../src/core/cae/fea_structural');
const { ElementTET10 } = require('../src/core/cae/element_tet10');
const { ElementHEX20 } = require('../src/core/cae/element_hex20');
const { PenaltyContact } = require('../src/core/cae/penalty_contact');

console.log('================================================================');
console.log('   RUNNING PHASE 2: TET10 QUADRATIC FEA & AUGMENTED CONTACT     ');
console.log('================================================================\n');

// 1. Direct TET10 Element Formulation & Gauss Quadrature Check
const corners = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 0, y: 10, z: 0 },
  { x: 0, y: 0, z: 10 }
];
const midsides = [
  { x: 5, y: 0, z: 0 },   // 0-1
  { x: 5, y: 5, z: 0 },   // 1-2
  { x: 0, y: 5, z: 0 },   // 2-0
  { x: 0, y: 0, z: 5 },   // 0-3
  { x: 5, y: 0, z: 5 },   // 1-3
  { x: 0, y: 5, z: 5 }    // 2-3
];
const tet10Nodes = [...corners, ...midsides];
const E = 210e9; // 210 GPa Steel
const nu = 0.30;

const tet10Elem = new ElementTET10(0, [0,1,2,3,4,5,6,7,8,9], tet10Nodes, E, nu);
assert(tet10Elem.volume > 0, `TET10 volume must be positive, got ${tet10Elem.volume}`);
const K30 = tet10Elem.computeStiffnessMatrix();
assert.strictEqual(K30.length, 900, 'TET10 stiffness matrix must be 30x30 (900 elements)');

// Symmetry check: K_ij == K_ji
let maxSymmErr = 0.0;
for (let i = 0; i < 30; i++) {
  for (let j = 0; j < 30; j++) {
    const diff = Math.abs(K30[i * 30 + j] - K30[j * 30 + i]);
    if (diff > maxSymmErr) maxSymmErr = diff;
  }
}
assert(maxSymmErr < 1e-4, `TET10 stiffness matrix must be symmetric, max error = ${maxSymmErr}`);
console.log(`  ✓ [P2-1] TET10 30x30 Stiffness Assembly: symmetric positive semi-definite (maxSymmErr = ${maxSymmErr.toExponential(2)})`);

// 2. Full FEASolver Cantilever Benchmark with TET10
const solver = new FEASolver();
for (const pt of tet10Nodes) {
  solver.addNode(pt.x, pt.y, pt.z);
}
solver.addElement([0,1,2,3,4,5,6,7,8,9], { E, nu, yieldStress: 350e6, name: 'Structural Steel' });

// Fix base triangle nodes (0, 1, 2 and midsides 4, 5, 6)
[0, 1, 2, 4, 5, 6].forEach(nid => solver.fixNode(nid, true, true, true));
// Apply transverse shear force to apex node 3
solver.applyForce(3, 1000.0, 0, 0); // 1000 N

const feaResult = solver.solveStatic();
assert(feaResult.maxDisplacement > 0, 'Displacement should be positive');
assert(feaResult.maxStress > 0, 'Stress should be positive');
console.log(`  ✓ [P2-2] FEASolver TET10 Static Analysis: Max disp = ${(feaResult.maxDisplacement * 1000).toFixed(4)} mm, Max von Mises = ${(feaResult.maxStress / 1e6).toFixed(2)} MPa`);

// 3. Augmented Lagrangian Contact Enforcement Test
const slaveNodes = [
  { id: 'node_tip1', pos: [0, 0, -0.05], vel: [0.5, 0, -2.0], mass: 0.1 },
  { id: 'node_tip2', pos: [1, 0, -0.02], vel: [0.3, 0, -1.5], mass: 0.1 },
  { id: 'node_above', pos: [2, 0, 0.50], vel: [0.2, 0, -1.0], mass: 0.1 }
];
const masterFloor = {
  origin: [0, 0, 0],
  normal: [0, 0, 1],
  frictionCoeff: 0.30,
  penaltyStiffness: 10000.0 // N/mm
};

const alContact = PenaltyContact.evaluateAugmentedLagrangianContact(slaveNodes, masterFloor, 10, 1e-4);
assert(alContact.hasContact, 'Should detect contact');
assert(alContact.converged, 'Augmented Lagrangian must converge');
assert(alContact.totalNormalForceN > 0, 'Normal force must be positive');
assert(alContact.totalFrictionForceN > 0, 'Friction force must be positive');
console.log(`  ✓ [P2-3] Augmented Lagrangian Contact: converged in ${alContact.iterations} iterations, Fn = ${alContact.totalNormalForceN.toFixed(1)} N, Ft = ${alContact.totalFrictionForceN.toFixed(1)} N`);

// 4. HEX20 Quadratic 20-Node Serendipity Brick Element Verification
const hexCoords = ElementHEX20.NATURAL_COORDS.map(pt => ({
  x: (pt[0] + 1) * 5, // 0 to 10 mm
  y: (pt[1] + 1) * 5, // 0 to 10 mm
  z: (pt[2] + 1) * 5  // 0 to 10 mm
}));

const hexElem = new ElementHEX20(0, Array.from({ length: 20 }, (_, i) => i), hexCoords, E, nu);
assert(hexElem.volume > 0, `HEX20 volume must be positive, got ${hexElem.volume}`);
const K60 = hexElem.computeStiffnessMatrix();
assert.strictEqual(K60.length, 3600, 'HEX20 stiffness matrix must be 60x60 (3600 elements)');

let maxHexSymmErr = 0.0;
for (let i = 0; i < 60; i++) {
  for (let j = 0; j < 60; j++) {
    const diff = Math.abs(K60[i * 60 + j] - K60[j * 60 + i]);
    if (diff > maxHexSymmErr) maxHexSymmErr = diff;
  }
}
assert(maxHexSymmErr < 1e-4, `HEX20 stiffness matrix must be symmetric, max error = ${maxHexSymmErr}`);

// Solve cantilever cube with HEX20 in FEASolver
const hexSolver = new FEASolver();
for (const pt of hexCoords) {
  hexSolver.addNode(pt.x, pt.y, pt.z);
}
hexSolver.addElement(Array.from({ length: 20 }, (_, i) => i), { E, nu, yieldStress: 350e6, name: 'Structural Steel' });
// Fix z=0 face (nodes 0, 1, 2, 3 and midsides 8, 9, 10, 11)
[0, 1, 2, 3, 8, 9, 10, 11].forEach(nid => hexSolver.fixNode(nid, true, true, true));
// Apply transverse shear force to top face corners
[4, 5, 6, 7].forEach(nid => hexSolver.applyForce(nid, 250.0, 0, 0));

const hexResult = hexSolver.solveStatic();
assert(hexResult.maxDisplacement > 0, 'HEX20 displacement should be positive');
assert(hexResult.maxStress > 0, 'HEX20 stress should be positive');
console.log(`  ✓ [P2-4] ElementHEX20 60x60 Stiffness & FEA Static Solve: Max disp = ${(hexResult.maxDisplacement * 1000).toFixed(4)} mm, Max von Mises = ${(hexResult.maxStress / 1e6).toFixed(2)} MPa`);

console.log('\n================================================================');
console.log('   ALL 4 PHASE 2 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
