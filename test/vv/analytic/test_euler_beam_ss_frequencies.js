/**
 * Simply supported Bernoulli beam: first three bending natural frequencies.
 *
 * The production beam modal engine (beam_dynamic_response.js, Timoshenko
 * beam elements with consistent mass) is driven by a slender, simply
 * supported beam with the ends' transverse deflection constrained. The
 * computed frequencies are compared with the Euler-Bernoulli closed form
 * omega_n = (n*pi/L)^2 * sqrt(E*I/(rho*A)), and monotonic ordering of the
 * modes is checked. The beam is slender enough (L/h = 200) that shear
 * flexibility shifts the frequencies by well under the declared tolerance.
 */

'use strict';

const { assembleBeamSystem, solveModalSubspace } = require('../../../src/core/cae/beam_dynamic_response');

const E = 200e9;
const NU = 0.3;
const RHO = 7850;
const L = 10;
const WIDTH = 0.05;
const DEPTH = 0.05;
const N_EL = 24;
const N_MODES = 3;
const TOLERANCE = 0.02;

function runEulerBeamSSFrequencies() {
  const nodesY = Array.from({ length: N_EL + 1 }, (_, i) => (L * i) / N_EL);
  const elements = nodesY.slice(0, -1).map((a, i) => ({ a: i, b: i + 1, width: WIDTH, depth: DEPTH }));
  const fixedDofs = new Set([0, 2 * N_EL]);
  const system = assembleBeamSystem({ nodesY, elements, E, nu: NU, rho: RHO, fixedDofs });
  const modal = solveModalSubspace(system, { count: N_MODES + 1 });

  const I = (WIDTH * DEPTH * DEPTH * DEPTH) / 12;
  const A = WIDTH * DEPTH;
  const analyticHz = (n) => (((n * Math.PI) / L) ** 2 * Math.sqrt((E * I) / (RHO * A))) / (2 * Math.PI);

  let maxRelErr = 0;
  const frequencies = [];
  for (let n = 1; n <= N_MODES; n++) {
    const fFe = modal.modes[n - 1].fHz;
    const fAnalytic = analyticHz(n);
    frequencies.push({ mode: n, feHz: fFe, analyticHz: fAnalytic });
    maxRelErr = Math.max(maxRelErr, Math.abs(fFe - fAnalytic) / fAnalytic);
  }

  let ordered = true;
  for (let n = 1; n < N_MODES; n++) {
    if (frequencies[n].feHz <= frequencies[n - 1].feHz) ordered = false;
  }

  const passed = modal.converged && ordered && Number.isFinite(maxRelErr) && maxRelErr <= TOLERANCE;
  return {
    id: 'BEAM_EULER_BERNOULLI_SS_FREQUENCIES',
    name: 'Simply supported Bernoulli beam: first 3 bending frequencies vs Euler-Bernoulli closed form',
    targetValue: TOLERANCE,
    calculatedValue: maxRelErr,
    units: 'max relative frequency error',
    errorPercent: maxRelErr * 100,
    tolerancePercent: TOLERANCE * 100,
    passed,
    status: passed ? 'passed' : 'failed',
    reason: passed
      ? undefined
      : 'Modal frequencies deviate from the Euler-Bernoulli closed form or ordering is violated.',
    measured: {
      frequenciesHz: frequencies.map((f) => ({ mode: f.mode, feHz: f.feHz, analyticHz: f.analyticHz })),
      converged: modal.converged,
      subspaceIterations: modal.iterations,
      solverPath: 'production beam dynamic modal solver (Wasm sparse multifrontal + subspace iteration)'
    },
    expected: {
      analyticHz: [1, 2, 3].map((n) => analyticHz(n)),
      skew: 'Euler-Bernoulli f_n = (n*pi/L)^2 sqrt(EI/(rho A)); Timoshenko FE on a slender beam (L/h=200)'
    },
    details: {
      reference: 'Closed-form Euler-Bernoulli natural frequencies (independent analytic).',
      solver:
        'beam_dynamic_response.js (production): 2-node Timoshenko beam elements, consistent mass, block subspace iteration.',
      geometry: { lengthM: L, widthM: WIDTH, depthM: DEPTH, spanToDepth: L / DEPTH, E, nu: NU, rho: RHO },
      mesh: { elements: N_EL, nodes: N_EL + 1, constraints: 'w=0 at both supports' },
      note: 'Shear/rotary-inertia effects are small (<0.05%) at this slenderness; declared tolerance includes them. Not certification.'
    }
  };
}

module.exports = { runEulerBeamSSFrequencies };
