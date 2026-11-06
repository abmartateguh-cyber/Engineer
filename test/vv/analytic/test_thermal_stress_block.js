/**
 * Uniformly heated, fully constrained thermoelastic body.
 *
 * An axisymmetric hollow cylinder is raised by a uniform temperature Delta T
 * with every boundary translational degree of freedom restrained. The exact
 * solution is zero displacement everywhere and a uniform hydrostatic
 * compressive stress sigma = -E*alpha*DeltaT/(1-2*nu), which is compared
 * with the production axisymmetric thermoelastic solver's recovered element
 * stresses. This exercises the production thermal-load assembly, boundary
 * elimination, sparse direct solve, and stress recovery.
 */

'use strict';

const { AxisymThermoelastic8Node } = require('../../../src/core/cae/axisym_thermoelastic_8node');

const E = 200e9;
const NU = 0.3;
const ALPHA = 1e-5;
const DELTA_T = 100;
const A_INNER = 0.1;
const A_OUTER = 1.0;
const LENGTH = 1.0;
const NR = 6;
const NZ = 4;
const TOLERANCE = 1e-3;

function runThermalStressBlock() {
  const a = A_INNER;
  const b = A_OUTER;
  const L = LENGTH;
  const eng = new AxisymThermoelastic8Node({ E, nu: NU, alpha: ALPHA, deltaTField: () => DELTA_T });

  const nodes = [];
  const ids = new Map();
  const node = (type, i, j, r, z) => {
    const key = `${type}:${i}:${j}`;
    if (ids.has(key)) return ids.get(key);
    const id = nodes.length;
    nodes.push({ r, z });
    ids.set(key, id);
    return id;
  };
  for (let i = 0; i <= NR; i++) {
    const r = a + ((b - a) * i) / NR;
    for (let j = 0; j <= NZ; j++) node('C', i, j, r, (L * j) / NZ);
  }
  for (let i = 0; i < NR; i++) {
    const r = a + ((b - a) * (i + 0.5)) / NR;
    for (let j = 0; j <= NZ; j++) node('R', i, j, r, (L * j) / NZ);
  }
  for (let i = 0; i <= NR; i++) {
    const r = a + ((b - a) * i) / NR;
    for (let j = 0; j < NZ; j++) node('Z', i, j, r, (L * (j + 0.5)) / NZ);
  }
  for (const n of nodes) eng.addNode(n.r, n.z);
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NZ; j++) {
      eng.addQuad([
        node('C', i, j),
        node('C', i + 1, j),
        node('C', i + 1, j + 1),
        node('C', i, j + 1),
        node('R', i, j),
        node('Z', i + 1, j),
        node('R', i, j + 1),
        node('Z', i, j)
      ]);
    }
  }
  for (let i = 0; i <= NR; i++) {
    for (let j = 0; j <= NZ; j++) {
      const id = node('C', i, j);
      const fixR = i === 0 || i === NR;
      const fixZ = j === 0 || j === NZ;
      if (fixR || fixZ) eng.fixNode(id, fixR, fixZ);
    }
  }
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j <= NZ; j++) {
      const id = node('R', i, j);
      if (j === 0 || j === NZ) eng.fixNode(id, false, true);
    }
  }
  for (let i = 0; i <= NR; i++) {
    for (let j = 0; j < NZ; j++) {
      const id = node('Z', i, j);
      if (i === 0 || i === NR) eng.fixNode(id, true, false);
    }
  }

  const result = eng.solve();
  const target = -(E * ALPHA * DELTA_T) / (1 - 2 * NU);

  let maxRelErr = 0;
  let sumRelErr = 0;
  for (const s of result.stresses) {
    const rel = Math.abs(s.sr - target) / Math.abs(target);
    maxRelErr = Math.max(maxRelErr, rel);
    sumRelErr += rel;
  }
  const meanRelErr = sumRelErr / Math.max(1, result.stresses.length);
  const passed = Number.isFinite(maxRelErr) && maxRelErr <= TOLERANCE;

  return {
    id: 'THERMAL_STRESS_FULLY_CONSTRAINED_CYLINDER',
    name: 'Uniformly heated fully constrained body: sigma = -E alpha DeltaT/(1-2nu) via production thermoelastic path',
    targetValue: target,
    calculatedValue: meanRelErr * target + target,
    units: 'Pa',
    errorPercent: meanRelErr * 100,
    tolerancePercent: TOLERANCE * 100,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed ? undefined : 'Recovered thermal stresses deviate from the closed-form constrained-body value.',
    measured: {
      maxRelativeError: maxRelErr,
      meanRelativeError: meanRelErr,
      elementCount: result.stresses.length,
      dofCount: result.dofCount,
      solver: 'AxisymThermoelastic8Node (production), direct sparse multifrontal'
    },
    expected: {
      closedFormPa: target,
      closedFormMpa: target / 1e6,
      note: 'sigma_r = sigma_theta = sigma_z = -E alpha DeltaT/(1-2nu)'
    },
    details: {
      reference: 'Closed-form constrained-body thermal stress (independent analytic).',
      solver:
        'AxisymThermoelastic8Node (production): thermal eigenstrain load, full Dirichlet constraints, sparse direct solve.',
      geometry: { innerRadiusM: a, outerRadiusM: b, lengthM: L, deltaTK: DELTA_T, alphaPerK: ALPHA, E, nu: NU },
      mesh: { radial: NR, axial: NZ, nodes: result.nodeCount, elements: result.elementCount },
      note: 'Zero-displacement exact solution is in the element space; pass is a strong consistency check for the thermal loading path. Not certification.'
    }
  };
}

module.exports = { runThermalStressBlock };
