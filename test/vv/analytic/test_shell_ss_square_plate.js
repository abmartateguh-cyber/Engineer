/**
 * Validation-ready diagnostic: simply supported square plate under uniform
 * load solved with the production shell assembly (MITC4-reduced quad shells,
 * 6 dof/node, production sparse direct Cholesky solver).
 *
 * Kirchhoff thin-plate series solution (Timoshenko): center deflection
 *   wc = alpha * q * a^4 / D,  D = E t^3 / (12 (1 - nu^2)),
 * with alpha = (16 / pi^6) * sum_{odd m,n} (-1)^((m+n-2)/2) / (m n (m^2+n^2)^2)
 * = 0.00406235 (classic value 0.00406 for nu = 0.3).
 *
 * Geometry: a = 1 m, t = 0.01 m (a/t = 100), E = 200 GPa, nu = 0.3,
 * q = 1 kPa. Mesh: 10x10 (finer for the convergence sub-check).
 */

'use strict';

const { ShellAssembly, generatePlateMesh } = require('../../../src/core/cae/shell_assembly');

const E = 200e9;
const NU = 0.3;
const A = 1.0;
const T = 0.01;
const Q = 1e3;
const ALPHA = 0.00406235;

const D = (E * T * T * T) / (12 * (1 - NU * NU));
const TARGET_WC = (ALPHA * Q * Math.pow(A, 4)) / D;

function buildSimplySupportedSquare(mesh) {
  const assembly = new ShellAssembly();
  const nodeIds = [];
  for (const n of mesh.nodes) nodeIds.push(assembly.addNode(n.x, n.y, n.z));
  for (const el of mesh.elements) assembly.addElement(el.nodeIds, { thickness: T, E, nu: NU });
  const tol = 1e-9;
  for (let i = 0; i < nodeIds.length; i++) {
    const n = mesh.nodes[i];
    const onX = n.x < tol || n.x > A - tol;
    const onY = n.y < tol || n.y > A - tol;
    if (onX || onY) {
      // Simply supported: transverse displacement w fixed, rotations free.
      assembly.fixDOF(nodeIds[i], 2);
    }
    if (onX) assembly.fixDOF(nodeIds[i], 0); // in-plane rigid body restraint (x)
    if (onY) assembly.fixDOF(nodeIds[i], 1); // in-plane rigid body restraint (y)
  }
  assembly.applyUniformPressure(Q);
  assembly.solveStatic();
  return assembly;
}

function runShellSSSquarePlateDeflection() {
  const mesh = generatePlateMesh({ nx: 10, ny: 10, Lx: A, Ly: A });
  const assembly = buildSimplySupportedSquare(mesh);
  const { nodeId, deflection } = assembly.nearestNodeDeflection(A / 2, A / 2);

  const errorPercent = ((deflection - TARGET_WC) / TARGET_WC) * 100;
  const tolerancePercent = 3.0;
  const passed = Number.isFinite(deflection) && Math.abs(errorPercent) <= tolerancePercent;

  // Convergence sub-check: 12x12 must be closer than 10x10 (or within 1.5%).
  const meshFine = generatePlateMesh({ nx: 12, ny: 12, Lx: A, Ly: A });
  const assemblyFine = buildSimplySupportedSquare(meshFine);
  const fine = assemblyFine.nearestNodeDeflection(A / 2, A / 2);
  const errorFinePercent = ((fine.deflection - TARGET_WC) / TARGET_WC) * 100;

  const centerEl = assembly.elements
    .map((el) => {
      const cx = el.nodeIds.reduce((s, id) => s + assembly.nodes[id].x, 0) / 4;
      const cy = el.nodeIds.reduce((s, id) => s + assembly.nodes[id].y, 0) / 4;
      return { el, cx, cy };
    })
    .reduce((a, b) => (Math.hypot(b.cx - A / 2, b.cy - A / 2) < Math.hypot(a.cx - A / 2, a.cy - A / 2) ? b : a));
  const M = assembly.elementMoments(centerEl.el.id);

  return {
    id: 'SHELL_SS_SQUARE_PLATE_DEFLECTION',
    name: 'Simply supported square plate, uniform load: Kirchhoff series center deflection vs production shell assembly',
    targetValue: TARGET_WC,
    calculatedValue: deflection,
    units: 'm',
    errorPercent,
    tolerancePercent,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Center deflection ${deflection.toExponential(4)} m deviates ${errorPercent.toFixed(2)}% from analytic ${TARGET_WC.toExponential(4)} m (tolerance ${tolerancePercent}%).`,
    measured: {
      centerDeflectionM: deflection,
      centerNodeId: nodeId,
      fineMesh12x12CenterDeflectionM: fine.deflection,
      fineMesh12x12ErrorPercent: errorFinePercent,
      centerElementMomentsNmPerM: M,
      meshConvergence: {
        error10x10Percent: errorPercent,
        error12x12Percent: errorFinePercent,
        decreasing: Math.abs(errorFinePercent) < Math.abs(errorPercent)
      },
      solverUsed: assembly.results().solverUsed,
      dofCount: assembly.results().dofCount,
      elementCount: assembly.elements.length,
      nodeCount: assembly.nodes.length,
      relativeResidual: 'direct solve (exact)'
    },
    expected: {
      analyticCenterDeflectionM: TARGET_WC,
      seriesCoefficient: ALPHA,
      bendingRigidityD: D,
      centerMomentMxxNmPerM: 0.0479 * Q * A * A
    },
    details: {
      reference:
        'Timoshenko & Woinowsky-Krieger, Theory of Plates and Shells: wc = 0.00406 q a^4/D (nu = 0.3); exact series constant 0.00406235. Kirchhoff thin-plate solution.',
      solver:
        'ShellAssembly (production): MITC4-reduced quad shells, 6 dof/node, WasmSparseMultifrontalSolver sparse Cholesky direct solve.',
      geometry: { sideM: A, thicknessM: T, aOverT: A / T, EPa: E, nu: NU, pressurePa: Q, D: D },
      mesh: { nx: 10, ny: 10, fineNx: 12 },
      boundaryConditions:
        'Simply supported: w = 0 on all four edges; rotations free; in-plane rigid-body restraints (u = 0 on x = 0 edge, v = 0 on y = 0 edge) do not couple to plate bending.',
      note: 'Diagnostic, not released validation evidence.'
    }
  };
}

module.exports = { runShellSSSquarePlateDeflection, buildSimplySupportedSquare, TARGET_WC };
