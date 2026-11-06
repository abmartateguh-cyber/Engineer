/**
 * NAFEMS 2D steady heat conduction with mixed Dirichlet and convection boundary conditions.
 *
 * Benchmark Specification (NAFEMS Standard Benchmark T4 / 2D Mixed Conduction):
 *   - Plate dimensions: Width = 0.6 m, Height = 1.0 m.
 *   - Thermal conductivity: k = 52.0 W/(m K).
 *   - Boundary conditions:
 *       * Bottom edge (y = 0): Prescribed Dirichlet temperature T = 100.0 C.
 *       * Left edge (x = 0): Insulated (homogeneous Neumann, zero flux).
 *       * Right edge (x = 0.6 m): Convection h = 750 W/(m^2 K), T_inf = 0.0 C.
 *       * Top edge (y = 1.0 m): Convection h = 750 W/(m^2 K), T_inf = 0.0 C.
 *   - Evaluation point: Point E at (x = 0.6 m, y = 0.2 m).
 *   - Reference target: T(0.6, 0.2) = 18.3 C (+-0.5 C tolerance).
 *
 * Solver: Poisson2DMixed (Q4 bilinear finite element formulation).
 */

'use strict';

const { Poisson2DMixed } = require('../../../src/core/cae/poisson_2d_mixed');

const K = 52.0;
const W = 0.6;
const H = 1.0;
const NX = 19;
const NY = 31;
const TARGET_T = 18.3;
const TOLERANCE_C = 0.5;

function runNafemsT1() {
  const solver = new Poisson2DMixed({ conductivity: K });
  const id = (j, i) => j * NX + i;

  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      solver.addNode((i * W) / (NX - 1), (j * H) / (NY - 1));
    }
  }

  for (let j = 0; j < NY - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      solver.addQuad([id(j, i), id(j, i + 1), id(j + 1, i + 1), id(j + 1, i)]);
    }
  }

  // Bottom edge (y = 0): T = 100 C (Dirichlet)
  for (let i = 0; i < NX; i++) {
    solver.setTemperature(id(0, i), 100.0);
  }

  // Right edge (x = 0.6 m): Convection h = 750 W/(m^2 K), T_inf = 0 C
  for (let j = 0; j < NY - 1; j++) {
    solver.addConvectionEdge([id(j, NX - 1), id(j + 1, NX - 1)], 750, 0);
  }

  // Top edge (y = 1.0 m): Convection h = 750 W/(m^2 K), T_inf = 0 C
  for (let i = 0; i < NX - 1; i++) {
    solver.addConvectionEdge([id(NY - 1, i), id(NY - 1, i + 1)], 750, 0);
  }

  // Left edge (x = 0): Insulated (zero flux natural boundary condition)

  let result;
  try {
    result = solver.solve();
  } catch (err) {
    return {
      id: 'NAFEMS_T1',
      name: 'NAFEMS T1: 2D steady conduction with mixed BCs, T(0.6, 0.2)',
      targetValue: TARGET_T,
      calculatedValue: null,
      units: 'C',
      errorPercent: null,
      tolerancePercent: TOLERANCE_C,
      passed: false,
      status: 'failed',
      reason: `Conduction solve failed: ${err.message}`
    };
  }

  // Probe at (x = 0.6 m, y = 0.2 m)
  const jProbe = Math.round((0.2 / H) * (NY - 1));
  const probeId = id(jProbe, NX - 1);
  const measuredT = result.temperature[probeId];
  const error = Math.abs(measuredT - TARGET_T);
  const passed = error <= TOLERANCE_C;

  return {
    id: 'NAFEMS_T1',
    name: 'NAFEMS T1: 2D steady conduction with mixed BCs, T(0.6, 0.2)',
    targetValue: TARGET_T,
    calculatedValue: measuredT,
    units: 'C',
    errorPercent: (error / Math.abs(TARGET_T)) * 100,
    tolerancePercent: TOLERANCE_C,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : `Measured T(0.6, 0.2) deviates from reference (18.3 C) by ${error.toFixed(3)} C (tolerance +-0.5 C).`,
    measured: {
      probeTemperatureC: measuredT,
      targetC: TARGET_T,
      absoluteErrorC: error,
      probeX: 0.6,
      probeY: 0.2,
      dofCount: result.nodeCount,
      elementCount: result.elementCount
    },
    expected: { TAtProbeC: TARGET_T },
    details: {
      reference: 'NAFEMS Standard Benchmark: 2D steady conduction with convection, T(0.6, 0.2) = 18.3 C (+-0.5 C).',
      dimensions: { widthM: W, heightM: H },
      conductivityWPerMK: K,
      boundaryConditions: {
        bottomEdge: 'T = 100 C (Dirichlet)',
        leftEdge: 'insulated (homogeneous Neumann)',
        rightEdge: 'convection h = 750 W/m^2K, T_inf = 0 C',
        topEdge: 'convection h = 750 W/m^2K, T_inf = 0 C'
      },
      solver: 'Poisson2DMixed Q4 (self-contained)',
      mesh: { nx: NX, ny: NY, elements: solver.elements.length }
    }
  };
}

module.exports = { runNafemsT1 };
