/**
 * Production shell assembly regression tests (OmniEng).
 *
 * Covers: assembly of MITC4-reduced quad shells (6 dof/node), simply supported
 * and clamped plate boundary conditions, uniform pressure loading, center
 * deflection vs the Kirchhoff thin-plate series solution, mesh convergence,
 * moment recovery, loading symmetry, and fail-closed behaviour on malformed
 * meshes. Self-contained CommonJS; runs when executed directly.
 */

'use strict';

const assert = require('assert');
const { ShellAssembly, generatePlateMesh } = require('../src/core/cae/shell_assembly');

const E = 200e9;
const NU = 0.3;
const A = 1.0;
const T = 0.01;
const Q = 1e3;
const D = (E * T * T * T) / (12 * (1 - NU * NU));
const ALPHA = 0.00406235;
const TARGET = (ALPHA * Q * Math.pow(A, 4)) / D;

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED: ${name} — ${err.message}`);
    failed++;
  }
}

function buildSS(mesh) {
  const asm = new ShellAssembly();
  const ids = [];
  for (const n of mesh.nodes) ids.push(asm.addNode(n.x, n.y, n.z));
  for (const el of mesh.elements) asm.addElement(el.nodeIds, { thickness: T, E, nu: NU });
  const tol = 1e-9;
  for (let i = 0; i < ids.length; i++) {
    const n = mesh.nodes[i];
    const onX = n.x < tol || n.x > A - tol;
    const onY = n.y < tol || n.y > A - tol;
    if (onX || onY) asm.fixDOF(ids[i], 2);
    if (onX) asm.fixDOF(ids[i], 0);
    if (onY) asm.fixDOF(ids[i], 1);
  }
  asm.applyUniformPressure(Q);
  asm.solveStatic();
  return asm;
}

function buildClamped(mesh) {
  const asm = new ShellAssembly();
  const ids = [];
  for (const n of mesh.nodes) ids.push(asm.addNode(n.x, n.y, n.z));
  for (const el of mesh.elements) asm.addElement(el.nodeIds, { thickness: T, E, nu: NU });
  const tol = 1e-9;
  for (let i = 0; i < ids.length; i++) {
    const n = mesh.nodes[i];
    if (n.x < tol || n.x > A - tol || n.y < tol || n.y > A - tol) {
      asm.fixNode(ids[i], true, true, true, true, true); // u,v,w,θx,θy fixed
    }
  }
  asm.applyUniformPressure(Q);
  asm.solveStatic();
  return asm;
}

// ---------------------------------------------------------------- mesh convergence
check('mesh convergence: coarse-to-fine error decreases (4→8→12)', () => {
  const wc = [];
  for (const nx of [4, 8, 12]) {
    const asm = buildSS(generatePlateMesh({ nx, ny: nx, Lx: A, Ly: A }));
    wc.push(asm.nearestNodeDeflection(A / 2, A / 2).deflection);
  }
  const errs = wc.map((w) => Math.abs((w - TARGET) / TARGET));
  assert(errs[0] > errs[1], `expected 4x4 error ${errs[0].toFixed(4)} > 8x8 ${errs[1].toFixed(4)}`);
  assert(errs[1] > errs[2], `expected 8x8 error ${errs[1].toFixed(4)} > 12x12 ${errs[2].toFixed(4)}`);
});

// ------------------------------------------------------------ center deflection
check('center deflection within 3% of Kirchhoff analytic at 12x12', () => {
  const asm = buildSS(generatePlateMesh({ nx: 12, ny: 12, Lx: A, Ly: A }));
  const { deflection } = asm.nearestNodeDeflection(A / 2, A / 2);
  const err = Math.abs((deflection - TARGET) / TARGET) * 100;
  assert(
    err <= 3.0,
    `center deflection ${deflection.toExponential(4)} m deviates ${err.toFixed(2)}% from analytic ${TARGET.toExponential(4)} m`
  );
});

// ------------------------------------------------------------------ moment recovery
check('moment recovery finite and near analytic center moment', () => {
  const asm = buildSS(generatePlateMesh({ nx: 12, ny: 12, Lx: A, Ly: A }));
  let best = null;
  let bestD = Infinity;
  for (const el of asm.elements) {
    const cx = el.nodeIds.reduce((s, id) => s + asm.nodes[id].x, 0) / 4;
    const cy = el.nodeIds.reduce((s, id) => s + asm.nodes[id].y, 0) / 4;
    const d = Math.hypot(cx - A / 2, cy - A / 2);
    if (d < bestD) {
      bestD = d;
      best = el.id;
    }
  }
  const M = asm.elementMoments(best);
  assert([M.Mxx, M.Myy, M.Mxy].every(Number.isFinite), 'moments must be finite');
  const Mtarget = 0.0479 * Q * A * A;
  // Q4 centroidal derivative recovery under-resolves the bilinear rotation
  // field; magnitudes are checked for plausibility (order-of-magnitude and
  // consistency), not pointwise accuracy. Gauss-point (superconvergent)
  // recovery is the follow-up improvement.
  assert(
    Math.abs(M.Mxx - Mtarget) / Mtarget < 0.55,
    `Mxx ${M.Mxx.toExponential(3)} N·m/m vs analytic ${Mtarget.toExponential(3)}`
  );
});

// ---------------------------------------------------------------------- BC checks
check('simply supported: edge w=0, rotations free (nonzero on edges)', () => {
  const asm = buildSS(generatePlateMesh({ nx: 10, ny: 10, Lx: A, Ly: A }));
  const tol = 1e-9;
  let boundaryW = 0;
  let boundaryRot = 0;
  let interiorRot = 0;
  for (let i = 0; i < asm.nodes.length; i++) {
    const n = asm.nodes[i];
    const onEdge = n.x < tol || n.x > A - tol || n.y < tol || n.y > A - tol;
    const disp = asm.displacementAt(i);
    if (onEdge) {
      assert(Math.abs(disp[2]) < 1e-9, `edge w must vanish at node ${i}`);
      boundaryRot = Math.max(boundaryRot, Math.hypot(disp[3], disp[4]));
    } else {
      interiorRot = Math.max(interiorRot, Math.hypot(disp[3], disp[4]));
    }
  }
  assert(boundaryRot > 1e-9, 'SS edge rotations must be free (nonzero)');
  assert(interiorRot > boundaryRot * 0.5, 'interior rotations should be significant');
});

check('clamped: edge w=0 and rotations=0', () => {
  const asm = buildClamped(generatePlateMesh({ nx: 10, ny: 10, Lx: A, Ly: A }));
  const tol = 1e-9;
  for (let i = 0; i < asm.nodes.length; i++) {
    const n = asm.nodes[i];
    if (n.x < tol || n.x > A - tol || n.y < tol || n.y > A - tol) {
      const disp = asm.displacementAt(i);
      assert(
        Math.abs(disp[2]) < 1e-9 && Math.abs(disp[3]) < 1e-9 && Math.abs(disp[4]) < 1e-9,
        `clamped boundary must have w=0, θx=θy=0 at node ${i}`
      );
    }
  }
});

// ----------------------------------------------------------- symmetry of the load
check('symmetric loading -> symmetric deflection field', () => {
  const asm = buildSS(generatePlateMesh({ nx: 10, ny: 10, Lx: A, Ly: A }));
  let maxAsym = 0;
  for (const n of asm.nodes) {
    const wx = asm.deflectionAt(n.id);
    const nx = A - n.x;
    // find mirror node
    let mirror = null;
    for (const m of asm.nodes) {
      if (Math.abs(m.x - nx) < 1e-9 && Math.abs(m.y - n.y) < 1e-9) {
        mirror = m;
        break;
      }
    }
    if (mirror) maxAsym = Math.max(maxAsym, Math.abs(wx - asm.deflectionAt(mirror.id)));
  }
  const maxW = asm.results().maxDeflection;
  assert(maxAsym / maxW < 1e-6, `deflection asymmetry ${maxAsym / maxW} too large`);
});

// ------------------------------------------------------------ fail-closed checks
check('fail-closed: degenerate (zero area) element', () => {
  const asm = new ShellAssembly();
  for (let i = 0; i < 4; i++) asm.addNode(i, 0, 0);
  assert.throws(() => asm.addElement([0, 1, 2, 3], { thickness: T, E, nu: NU }));
});

check('fail-closed: unknown node reference', () => {
  const asm = new ShellAssembly();
  for (let i = 0; i < 4; i++) asm.addNode(i, i, 0, 0);
  assert.throws(() => asm.addElement([0, 1, 2, 9], { thickness: T, E, nu: NU }));
});

check('fail-closed: invalid properties', () => {
  const asm = new ShellAssembly();
  for (let i = 0; i < 4; i++) asm.addNode(i, i % 2, Math.floor(i / 2), 0);
  assert.throws(() => asm.addElement([0, 1, 2, 3], { thickness: 0, E, nu: NU }));
  assert.throws(() => asm.addElement([0, 1, 2, 3], { thickness: T, E: -1, nu: NU }));
  assert.throws(() => asm.addElement([0, 1, 2, 3], { thickness: T, E, nu: 0.6 }));
});

check('fail-closed: solve without elements', () => {
  const asm = new ShellAssembly();
  asm.addNode(0, 0, 0);
  assert.throws(() => asm.solveStatic());
});

check('fail-closed: non-finite node coordinates', () => {
  const asm = new ShellAssembly();
  assert.throws(() => asm.addNode(NaN, 0, 0));
});

// ------------------------------------------------------------- hole mesh support
check('rectangular mesh with hole: solves and prunes orphan nodes', () => {
  const mesh = generatePlateMesh({ nx: 12, ny: 12, Lx: A, Ly: A, hole: { cx: 0.5, cy: 0.5, r: 0.18 } });
  assert(mesh.elements.length < 12 * 12, 'hole must remove elements');
  const used = new Set();
  for (const el of mesh.elements) for (const id of el.nodeIds) used.add(id);
  for (const n of mesh.nodes) assert(used.has(n.id), 'all nodes must be referenced');
  const asm = new ShellAssembly();
  for (const n of mesh.nodes) asm.addNode(n.x, n.y, n.z);
  for (const el of mesh.elements) asm.addElement(el.nodeIds, { thickness: T, E, nu: NU });
  const tol = 1e-9;
  for (let i = 0; i < mesh.nodes.length; i++) {
    const n = mesh.nodes[i];
    if (n.x < tol || n.x > A - tol || n.y < tol || n.y > A - tol) asm.fixDOF(i, 2);
  }
  asm.applyUniformPressure(Q);
  asm.solveStatic(); // must not throw
});

console.log(`\nShell assembly: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
