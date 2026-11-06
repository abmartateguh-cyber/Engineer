/**
 * STRUCTURAL_EIGENSOLVER verification gate (Battalion 1, Agent 06).
 *
 * Verifies the generalized eigenproblem solver in
 * src/core/cae/structural_dynamics_eigensolver.js (K x = lambda M x):
 *
 *  1. 2-DOF mass-spring system with closed-form eigenvalues (1, 3) and
 *     M-orthonormal eigenvectors: solver matches to 1e-9, first mode is
 *     in-phase, second out-of-phase.
 *  2. Simply supported Euler-Bernoulli beam, rotated with the production
 *     beam modal assembly (src/core/cae/beam_dynamic_response.js +
 *     Timoshenko elements): first 3 frequencies converge to
 *     f_n = n^2*pi/2*sqrt(EI/(rho*A*L^4)) within 0.5%.
 *  3. Fixed-fixed axial rod assembled from the axial block of the
 *     3D Timoshenko beam element (src/core/cae/beam_timoshenko_3d.js) with
 *     lumped mass: f_n = n/(2L)*sqrt(E/rho) within 0.5%.
 *  4. 3D cantilever plate (300 x 200 x 5 mm steel) modeled with the
 *     production MITC4/SRI shell bending assembly (src/core/cae/shell_assembly.js)
 *     plus a consistent Q4 mass matrix computed in this test. First 5
 *     flexural frequencies measured; f1 asserted against a Rayleigh-Ritz
 *     cantilever-plate estimate (computed in-test, Kirchhoff plate energy
 *     with a clamped-free/free-free polynomial basis) within 5%.
 *  5. Shifted inverse iteration: the solver itself has no shift option, so
 *     the shift is applied to the pencil in-test: (K - sigma M) with
 *     sigma = 0.9*lambda1. Shifted and unshifted inverse iteration start
 *     from the same seeded vector and must reach the lowest mode in
 *     strictly fewer iterations with the shift; the recovered eigenvalue
 *     lambda + sigma matches.
 *  6. Determinism: identical inputs give bitwise identical frequencies on
 *     rerun.
 *
 * Run standalone:  node --test test/test_eigensolver.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { solveGeneralizedEigen } = require('../src/core/cae/structural_dynamics_eigensolver');
const { TimoshenkoBeam3D } = require('../src/core/cae/beam_timoshenko_3d');
const { assembleBeamSystem } = require('../src/core/cae/beam_dynamic_response');
const { buildShellStiffnessLocal, generatePlateMesh } = require('../src/core/cae/shell_assembly');

const SEED = 0x5eed1234;

const Q4_CONSISTENT = [4, 2, 1, 2, 2, 4, 2, 1, 1, 2, 4, 2, 2, 1, 2, 4];

function denseFromRows(rows, n) {
  const A = new Array(n);
  for (let i = 0; i < n; i++) {
    A[i] = new Float64Array(n);
    const r = rows[i];
    for (let k = 0; k < r.length; k += 2) A[i][r[k]] = r[k + 1];
  }
  return A;
}

test('2-DOF analytic system: closed-form eigenvalues, M-orthonormal shapes, in/out-of-phase modes', () => {
  const K = [
    [2, -1],
    [-1, 2]
  ];
  const M = [
    [1, 0],
    [0, 1]
  ];
  const res = solveGeneralizedEigen(K, M, { count: 2, tol: 1e-14, seed: SEED });
  assert.ok(res.converged, 'solver must converge');

  const lambdaRef = [1, 3];
  for (let i = 0; i < 2; i++) {
    assert.ok(
      Math.abs(res.modes[i].lambda - lambdaRef[i]) < 1e-9,
      `lambda${i + 1} = ${res.modes[i].lambda} vs closed form ${lambdaRef[i]}`
    );
  }

  const phi0 = res.modes[0].shape;
  const phi1 = res.modes[1].shape;
  const mOrth = (p, q) => p[0] * q[0] + p[1] * q[1];
  assert.ok(Math.abs(mOrth(phi0, phi0) - 1) < 1e-9, `phi0^T M phi0 = ${mOrth(phi0, phi0)}`);
  assert.ok(Math.abs(mOrth(phi1, phi1) - 1) < 1e-9, `phi1^T M phi1 = ${mOrth(phi1, phi1)}`);
  assert.ok(Math.abs(mOrth(phi0, phi1)) < 1e-9, `phi0^T M phi1 = ${mOrth(phi0, phi1)}`);
  assert.ok(phi0[0] * phi0[1] > 0, 'first mode (lambda=1) must be in-phase');
  assert.ok(phi1[0] * phi1[1] < 0, 'second mode (lambda=3) must be out-of-phase');
  console.log(`  2-dof lambdas = [${res.modes.map((m) => m.lambda.toFixed(12)).join(', ')}] (closed form 1, 3)`);
});

test('simply supported Euler-Bernoulli beam f_n = n^2*pi/2*sqrt(EI/(rho*A*L^4)) within 0.5%', () => {
  const L = 1.0;
  const width = 0.02;
  const depth = 0.01;
  const nEl = 40;
  const nodesY = Array.from({ length: nEl + 1 }, (_, i) => (i * L) / nEl);
  const elements = Array.from({ length: nEl }, (_, i) => ({ a: i, b: i + 1, width, depth }));
  const fixedDofs = new Set([0, 2 * nEl]);
  const sys = assembleBeamSystem({ nodesY, elements, E: 210e9, nu: 0.3, rho: 7850, fixedDofs });
  const res = solveGeneralizedEigen(denseFromRows(sys.Kred, sys.nr), denseFromRows(sys.Mred, sys.nr), {
    count: 3,
    tol: 1e-10,
    maxIter: 1500,
    seed: SEED
  });
  assert.ok(res.converged, 'beam solve must converge');

  const EI = 210e9 * ((width * depth * depth * depth) / 12);
  const rhoA = 7850 * width * depth;
  const refs = [];
  for (let n = 1; n <= 3; n++) {
    refs.push(((n * n * Math.PI) / 2) * Math.sqrt(EI / (rhoA * L * L * L * L)));
  }
  for (let n = 1; n <= 3; n++) {
    const f = res.modes[n - 1].fHz;
    const rel = Math.abs(f - refs[n - 1]) / refs[n - 1];
    assert.ok(
      rel < 0.005,
      `SS beam mode ${n}: measured ${f.toFixed(5)} Hz vs ${refs[n - 1].toFixed(5)} Hz (rel ${(rel * 100).toFixed(3)}%)`
    );
  }
  console.log(
    `  SS beam (${nEl} el, Timoshenko modal assembly) measured f1-f3 = [${res.modes.map((m) => m.fHz.toFixed(4)).join(', ')}] Hz`
  );
  console.log(`  SS beam closed form f1-f3 = [${refs.map((f) => f.toFixed(4)).join(', ')}] Hz`);
});

function buildRodSystem(nEl) {
  const E = 210e9;
  const rho = 7850;
  const A = 4e-4;
  const L = 1.0;
  const h = L / nEl;
  const section = {
    E,
    nu: 0.3,
    A,
    Iy: (0.02 * 0.02 * 0.02 * 0.02) / 12,
    Iz: (0.02 * 0.02 * 0.02 * 0.02) / 12,
    J: (0.02 * 0.02 * 0.02 * 0.02) / 3,
    ky: 5 / 6,
    kz: 5 / 6
  };
  const n = nEl - 1;
  const K = Array.from({ length: n }, () => new Float64Array(n));
  const M = Array.from({ length: n }, () => new Float64Array(n));
  for (let e = 0; e < nEl; e++) {
    const a = e;
    const b = e + 1;
    const beam = new TimoshenkoBeam3D(
      e,
      [a, b],
      [
        { x: a * h, y: 0, z: 0 },
        { x: b * h, y: 0, z: 0 }
      ],
      section
    );
    const Ke = beam.computeLocalStiffnessMatrix();
    const ka = Ke[0];
    const kb = Ke[6];
    for (let r = 0; r < 2; r++) {
      const gr = (r === 0 ? a : b) - 1;
      if (gr < 0 || gr >= n) continue;
      for (let c = 0; c < 2; c++) {
        const gc = (c === 0 ? a : b) - 1;
        if (gc < 0 || gc >= n) continue;
        K[gr][gc] += r === 0 ? (c === 0 ? ka : -kb) : c === 0 ? -kb : ka;
      }
    }
  }
  for (let i = 0; i < n; i++) M[i][i] = rho * A * h;
  return { K, M };
}

test('fixed-fixed axial rod f_n = n/(2L)*sqrt(E/rho) within 0.5%', () => {
  const E = 210e9;
  const rho = 7850;
  const L = 1.0;
  const { K, M } = buildRodSystem(40);
  const res = solveGeneralizedEigen(K, M, { count: 3, tol: 1e-12, seed: SEED });
  assert.ok(res.converged, 'rod solve must converge');
  const c = Math.sqrt(E / rho);
  for (let n = 1; n <= 3; n++) {
    const fRef = (n / (2 * L)) * c;
    const f = res.modes[n - 1].fHz;
    const rel = Math.abs(f - fRef) / fRef;
    assert.ok(
      rel < 0.005,
      `rod mode ${n}: measured ${f.toFixed(4)} Hz vs ${fRef.toFixed(4)} Hz (rel ${(rel * 100).toFixed(3)}%)`
    );
  }
  console.log(
    `  axial rod (40 el, Timoshenko axial block) measured f1-f3 = [${res.modes.map((m) => m.fHz.toFixed(4)).join(', ')}] Hz`
  );
  console.log(
    `  axial rod closed form f1-f3 = [${[1, 2, 3].map((n) => ((n / (2 * L)) * c).toFixed(4)).join(', ')}] Hz`
  );
});

function buildPlateSystem(nx, ny, Lx, Ly, props) {
  const mesh = generatePlateMesh({ nx, ny, Lx, Ly });
  const nodeCount = mesh.nodes.length;
  const dim = nodeCount * 6;
  const K = Array.from({ length: dim }, () => new Float64Array(dim));
  const M = Array.from({ length: dim }, () => new Float64Array(dim));
  const hx = Lx / nx;
  const hy = Ly / ny;
  const area = hx * hy;
  const mt = (props.rho * props.thickness * area) / 36;
  const mr = ((props.rho * props.thickness * props.thickness * props.thickness) / 12) * (area / 36);
  for (const el of mesh.elements) {
    const coords = el.nodeIds.map((id) => mesh.nodes[id]);
    const Ke = buildShellStiffnessLocal(coords, { thickness: props.thickness, E: props.E, nu: props.nu });
    for (let a = 0; a < 4; a++) {
      const ra = el.nodeIds[a] * 6;
      for (let b = 0; b < 4; b++) {
        const cb = el.nodeIds[b] * 6;
        const pat = Q4_CONSISTENT[a * 4 + b];
        for (let d = 0; d < 6; d++) {
          M[ra + d][cb + d] += (d < 3 ? mt : mr) * pat;
          for (let e = 0; e < 6; e++) {
            const ke = Ke[(a * 6 + d) * 24 + b * 6 + e];
            if (ke !== 0) K[ra + d][cb + e] += ke;
          }
        }
      }
    }
  }
  const keep = [];
  const types = [];
  for (let i = 0; i < nodeCount; i++) {
    if (Math.abs(mesh.nodes[i].x) < 1e-12) continue;
    for (let d = 0; d < 6; d++) {
      keep.push(i * 6 + d);
      types.push(d);
    }
  }
  const nr = keep.length;
  const Kr = new Array(nr);
  const Mr = new Array(nr);
  for (let i = 0; i < nr; i++) {
    Kr[i] = new Float64Array(nr);
    Mr[i] = new Float64Array(nr);
    const gi = keep[i];
    for (let j = 0; j < nr; j++) {
      const gj = keep[j];
      Kr[i][j] = K[gi][gj];
      Mr[i][j] = M[gi][gj];
    }
  }
  return { K: Kr, M: Mr, nr, types };
}

function flexuralParticipation(modes, M, types) {
  const n = M.length;
  return modes.map((m) => {
    const phi = m.shape;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      if (types[i] !== 2) continue;
      let s = 0;
      for (let j = 0; j < n; j++) if (types[j] === 2) s += M[i][j] * phi[j];
      num += phi[i] * s;
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += M[i][j] * phi[j];
      den += phi[i] * s;
    }
    return num / den;
  });
}

function rayleighRitzCantileverPlate(Lx, Ly, E, nu, rho, t) {
  const D = (E * t * t * t) / (12 * (1 - nu * nu));
  const P = 6;
  const Q = 6;
  const nb = P * Q;
  const Krr = Array.from({ length: nb }, () => new Float64Array(nb));
  const Mrr = Array.from({ length: nb }, () => new Float64Array(nb));
  const I = (p, q) => (p >= 0 && q >= 0 ? 1 / ((p + 1) * (q + 1)) : 0);
  for (let i = 0; i < P; i++) {
    for (let j = 0; j < Q; j++) {
      const aij = ((i + 2) * (i + 1)) / (Lx * Lx);
      const bij = (j * (j - 1)) / (Ly * Ly);
      const cij = ((i + 2) * j) / (Lx * Ly);
      for (let k = 0; k < P; k++) {
        for (let l = 0; l < Q; l++) {
          const akl = ((k + 2) * (k + 1)) / (Lx * Lx);
          const bkl = (l * (l - 1)) / (Ly * Ly);
          const ckl = ((k + 2) * l) / (Lx * Ly);
          Krr[i * Q + j][k * Q + l] =
            D *
            Lx *
            Ly *
            (aij * akl * I(i + k, j + l) +
              bij * bkl * I(i + k + 4, j + l - 4) +
              nu * (aij * bkl + bij * akl) * I(i + k + 2, j + l - 2) +
              2 * (1 - nu) * cij * ckl * I(i + k + 2, j + l - 2));
          Mrr[i * Q + j][k * Q + l] = rho * t * Lx * Ly * I(i + k + 4, j + l);
        }
      }
    }
  }
  const res = solveGeneralizedEigen(Krr, Mrr, { count: 8, tol: 1e-12, seed: SEED });
  return res.modes.map((m) => m.fHz);
}

test('3D cantilever plate: first 5 flexural frequencies, f1 vs Rayleigh-Ritz estimate within 5%', () => {
  const Lx = 0.3;
  const Ly = 0.2;
  const t = 0.005;
  const E = 210e9;
  const nu = 0.3;
  const rho = 7850;
  const nx = 8;
  const ny = 5;

  const plate = buildPlateSystem(nx, ny, Lx, Ly, { thickness: t, E, nu, rho });
  const res = solveGeneralizedEigen(plate.K, plate.M, { count: 5, tol: 1e-8, seed: SEED });
  assert.ok(res.converged, `plate solve must converge (iterations ${res.iterations})`);

  const part = flexuralParticipation(res.modes, plate.M, plate.types);
  for (let i = 0; i < 5; i++) {
    assert.ok(part[i] > 0.5, `mode ${i + 1} is not flexural (w-participation ${part[i].toFixed(4)})`);
  }

  const refs = rayleighRitzCantileverPlate(Lx, Ly, E, nu, rho, t);
  const measured = res.modes.slice(0, 5).map((m) => m.fHz);
  const f1Rel = Math.abs(measured[0] - refs[0]) / refs[0];
  assert.ok(
    f1Rel < 0.05,
    `plate f1 = ${measured[0].toFixed(3)} Hz vs Rayleigh-Ritz ${refs[0].toFixed(3)} Hz (rel ${(f1Rel * 100).toFixed(2)}%)`
  );

  console.log(
    `  plate mesh ${nx}x${ny} (${plate.nr} free dofs), ${res.iterations} iterations, converged=${res.converged}`
  );
  console.log(`  plate measured f1-f5 = [${measured.map((f) => f.toFixed(3)).join(', ')}] Hz`);
  console.log(
    `  Rayleigh-Ritz refs f1-f5 = [${refs
      .slice(0, 5)
      .map((f) => f.toFixed(3))
      .join(', ')}] Hz`
  );
  console.log(
    `  rel err = [${measured.map((f, i) => ((Math.abs(f - refs[i]) / refs[i]) * 100).toFixed(2) + '%').join(', ')}]`
  );
  console.log(
    `  w-participation = [${part
      .slice(0, 5)
      .map((p) => p.toFixed(3))
      .join(', ')}]`
  );
});

function denseCholeskyFactor(A) {
  const n = A.length;
  const L = new Array(n);
  for (let i = 0; i < n; i++) L[i] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) throw new Error('inverse iteration matrix not positive definite');
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

function denseMatVec(A, x) {
  const n = A.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = A[i];
    let s = 0;
    for (let j = 0; j < n; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}

function inverseIteration(K, M, sigma, tol, seed) {
  const n = K.length;
  const A = new Array(n);
  for (let i = 0; i < n; i++) {
    A[i] = new Float64Array(n);
    for (let j = 0; j < n; j++) A[i][j] = K[i][j] - sigma * M[i][j];
  }
  const L = denseCholeskyFactor(A);
  let a = seed >>> 0;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    v[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  let lambda = 0;
  let iterations = 0;
  for (let it = 0; it < 2000; it++) {
    const y = denseMatVec(M, v);
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = y[i];
      for (let k = 0; k < i; k++) s -= L[i][k] * z[k];
      z[i] = s / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = z[i];
      for (let k = i + 1; k < n; k++) s -= L[k][i] * z[k];
      z[i] = s / L[i][i];
    }
    const Kz = denseMatVec(K, z);
    const Mz = denseMatVec(M, z);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += z[i] * Kz[i];
      den += z[i] * Mz[i];
    }
    const lambdaNew = num / den;
    const nn = Math.sqrt(Math.max(den, 1e-30));
    for (let i = 0; i < n; i++) v[i] = z[i] / nn;
    iterations = it + 1;
    if (Math.abs(lambdaNew - lambda) < tol * Math.max(Math.abs(lambdaNew), 1e-30)) {
      lambda = lambdaNew;
      break;
    }
    lambda = lambdaNew;
  }
  return { lambda, iterations };
}

test('shifted inverse iteration (sigma = 0.9*lambda1) reaches the lowest mode in strictly fewer iterations', () => {
  const { K, M } = buildRodSystem(30);
  const tol = 1e-14;
  const plain = inverseIteration(K, M, 0, tol, SEED);
  const sigma = 0.9 * plain.lambda;
  const shifted = inverseIteration(K, M, sigma, tol, SEED);
  assert.ok(
    shifted.iterations < plain.iterations,
    `shifted ${shifted.iterations} iterations vs plain ${plain.iterations}`
  );
  assert.ok(
    Math.abs(shifted.lambda - plain.lambda) / plain.lambda < 1e-8,
    `recovered lambda = ${shifted.lambda} vs lambda1 = ${plain.lambda}`
  );
  console.log(
    `  shifted: plain ${plain.iterations} iterations, shifted ${shifted.iterations} iterations (sigma = ${sigma.toExponential(4)})`
  );
});

test('determinism: rerun with identical inputs gives bitwise identical frequencies', () => {
  const { K, M } = buildRodSystem(30);
  const opts = { count: 3, tol: 1e-12, seed: SEED };
  const a = solveGeneralizedEigen(K, M, opts);
  const b = solveGeneralizedEigen(K, M, opts);
  for (let i = 0; i < 3; i++) {
    assert.ok(a.modes[i].fHz === b.modes[i].fHz, `mode ${i + 1} frequency differs on rerun`);
  }
});
