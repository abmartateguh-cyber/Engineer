/**
 * Verification Gate: NonlinearSolvers (nonlinear equation solvers)
 *
 * Exercises, deterministically:
 *   - Newton with analytic Jacobian  -> 2x2 system from multiple seeds,
 *   - Broyden quasi-Newton (secant update, no supplied Jacobian),
 *   - dogleg trust-region (bounded-step Newton) on a system where plain
 *     Newton overshoots/diverges from a poor seed,
 *   - Armijo-Goldstein sufficient-decrease line search,
 *   - binary isothermal flash with non-ideal (Wilson) activity coefficients.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NonlinearSolvers } = require('../src/core/math/nonlinear_solvers');

// ---------------------------------------------------------------------------
// Reference systems
// ---------------------------------------------------------------------------

// System A: 2x2 circle + parabola (two mirrored real solutions).
function systemAF(xy) {
  const x = xy[0];
  const y = xy[1];
  return [x * x + y * y - 4, x * x - y - 1];
}

function systemAJ(xy) {
  const x = xy[0];
  const y = xy[1];
  return [
    [2 * x, 2 * y],
    [2 * x, -1]
  ];
}

// System B: translated circle + parabola. Lacks system A's mirror symmetry,
// so plain Newton from a poor seed far from the solution overshoots
// (blows up to ~1e3 residuals) and fails; the dogleg trust-region method
// converges with every step bounded by the trust radius.
function systemBF(xy) {
  const x = xy[0];
  const y = xy[1];
  return [Math.pow(x - 0.3, 2) + y * y - 4, x * x - y - 1];
}

function systemBJ(xy) {
  const x = xy[0];
  const y = xy[1];
  return [
    [2 * (x - 0.3), 2 * y],
    [2 * x, -1]
  ];
}

function worstIntermediateResidual(F, x0, iterations) {
  let worst = 0;
  let x = [...x0];
  for (let k = 0; k < iterations; k++) {
    const f = F(x);
    const r = Math.hypot(f[0], f[1]);
    worst = Math.max(worst, r);
    const s = NonlinearSolvers.solveLinear(
      NonlinearSolvers.numericalJacobian(F, x),
      f.map((v) => -v)
    );
    if (s === null) break;
    x = [x[0] + s[0], x[1] + s[1]];
  }
  return worst;
}

// ---------------------------------------------------------------------------
// 1. Newton with analytic Jacobian
// ---------------------------------------------------------------------------

test('Newton with analytic Jacobian solves 2x2 system from multiple seeds to < 1e-12', () => {
  const seeds = [
    [1.5, 1.5],
    [0.5, 1.8],
    [2.5, 0.5],
    [-0.5, 1.5],
    [3, 3]
  ];
  for (const seed of seeds) {
    const sol = NonlinearSolvers.newtonSolve(systemAF, systemAJ, seed, { tol: 1e-12 });
    assert.ok(sol.converged, `Newton did not converge from ${JSON.stringify(seed)}`);
    assert.ok(sol.residual < 1e-12, `Newton residual ${sol.residual} from ${JSON.stringify(seed)}`);
    assert.ok(sol.iterations <= 20, `Newton iterations ${sol.iterations} from ${JSON.stringify(seed)}`);
    const f = systemAF(sol.x);
    assert.ok(Math.hypot(f[0], f[1]) < 1e-12, `residual re-check failed for ${JSON.stringify(seed)}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Broyden quasi-Newton (secant Jacobian update, no supplied Jacobian)
// ---------------------------------------------------------------------------

test('Broyden (secant update, FD-initialized) solves same system to < 1e-10', () => {
  const seeds = [
    [1.5, 1.5],
    [0.5, 1.8],
    [2.5, 0.5]
  ];
  for (const seed of seeds) {
    const sol = NonlinearSolvers.broydenSolve(systemAF, seed, { tol: 1e-10 });
    assert.ok(sol.converged, `Broyden did not converge from ${JSON.stringify(seed)}`);
    assert.ok(sol.residual < 1e-10, `Broyden residual ${sol.residual} from ${JSON.stringify(seed)}`);
  }
});

test('Broyden with identity B0 (purely secant updates) still converges to < 1e-10', () => {
  const sol = NonlinearSolvers.broydenSolve(systemAF, [0.5, 1.8], {
    tol: 1e-10,
    B0: 'identity'
  });
  assert.ok(sol.converged, 'Broyden (identity B0) did not converge');
  assert.ok(sol.residual < 1e-10, `Broyden identity residual ${sol.residual}`);
});

// ---------------------------------------------------------------------------
// 3. Dogleg / trust-region
// ---------------------------------------------------------------------------

test('plain Newton overshoots and diverges on system B from poor seeds', () => {
  for (const seed of [
    [0.1, 0.1],
    [1e-4, 1e-4]
  ]) {
    const sol = NonlinearSolvers.newtonSolve(systemBF, systemBJ, seed, {
      tol: 1e-10,
      maxIter: 60
    });
    assert.ok(!sol.converged, `plain Newton unexpectedly converged from ${JSON.stringify(seed)}`);
    assert.ok(sol.residual > 1, `plain Newton residual ${sol.residual} from ${JSON.stringify(seed)}`);
    const worst = worstIntermediateResidual(systemBF, seed, 60);
    assert.ok(worst > 100, `plain Newton worst intermediate residual ${worst} from ${JSON.stringify(seed)}`);
  }
});

test('dogleg trust-region converges on system B where plain Newton diverges, steps bounded', () => {
  for (const seed of [
    [0.1, 0.1],
    [1e-4, 1e-4]
  ]) {
    const sol = NonlinearSolvers.trustRegionDogleg(systemBF, systemBJ, seed, {
      tol: 1e-10,
      delta0: 1,
      maxIter: 400
    });
    assert.ok(sol.converged, `dogleg did not converge from ${JSON.stringify(seed)}`);
    assert.ok(sol.residual < 1e-10, `dogleg residual ${sol.residual} from ${JSON.stringify(seed)}`);
    assert.ok(sol.maxStepNorm <= 8, `dogleg step norm ${sol.maxStepNorm} from ${JSON.stringify(seed)}`);
  }
});

test('dogleg trust-region also solves standard system A from moderate seeds to < 1e-10', () => {
  for (const seed of [
    [3, 3],
    [0.1, 0.1]
  ]) {
    const sol = NonlinearSolvers.trustRegionDogleg(systemAF, systemAJ, seed, { tol: 1e-10 });
    assert.ok(sol.converged, `dogleg did not converge on system A from ${JSON.stringify(seed)}`);
    assert.ok(sol.residual < 1e-10, `dogleg system A residual ${sol.residual} from ${JSON.stringify(seed)}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Armijo-Goldstein line search
// ---------------------------------------------------------------------------

test('Armijo-Goldstein line search enforces sufficient decrease (exact step)', () => {
  const f = (x) => (x[0] - 1) * (x[0] - 1);
  const ls = NonlinearSolvers.armijoGoldsteinLineSearch(f, [0], [1]);
  assert.ok(ls.sufficientDecrease, 'sufficient-decrease condition not satisfied');
  assert.equal(ls.alpha, 1);
  assert.ok(ls.phi < 1e-12, `line search did not reach minimum, phi=${ls.phi}`);
  assert.ok(ls.phi <= ls.phi0 + 1e-4 * ls.alpha * ls.slope0, 'Armijo inequality violated');
});

test('Armijo-Goldstein backtracks when the initial step violates sufficient decrease', () => {
  const f = (x) => x[0] * x[0];
  const ls = NonlinearSolvers.armijoGoldsteinLineSearch(f, [2], [-1], { alpha0: 10 });
  assert.ok(ls.iterations > 0, 'expected backtracking to occur');
  assert.ok(ls.alpha >= 2.4 && ls.alpha <= 2.6, `backtracked alpha ${ls.alpha} out of range`);
  assert.ok(ls.sufficientDecrease, 'sufficient-decrease condition not satisfied after backtracking');
  assert.ok(ls.phi <= ls.phi0 + 1e-4 * ls.alpha * ls.slope0, 'Armijo inequality violated');
});

// ---------------------------------------------------------------------------
// 5. VLE flash (non-ideal Wilson activity coefficients)
// ---------------------------------------------------------------------------

test('isothermal flash (2 variables, non-ideal Wilson) closes material balances to < 1e-8', () => {
  const z = [0.5, 0.5];
  const T = 338.0;
  const P = 1.0;
  for (const seed of [
    [0.4, 0.6],
    [0.6, 0.3]
  ]) {
    const fl = NonlinearSolvers.isothermalFlashWilson(z, T, P, { tol: 1e-12, x0: seed });
    assert.ok(fl.converged, `flash did not converge from ${JSON.stringify(seed)}`);
    assert.ok(fl.beta > 0 && fl.beta < 1, `vapor fraction beta=${fl.beta} out of (0,1)`);
    for (let i = 0; i < 2; i++) {
      assert.ok(fl.x[i] > 0 && fl.x[i] < 1, `x${i + 1}=${fl.x[i]} out of (0,1)`);
      assert.ok(fl.y[i] > 0 && fl.y[i] < 1, `y${i + 1}=${fl.y[i]} out of (0,1)`);
      assert.ok(fl.K[i] > 0, `K${i + 1}=${fl.K[i]} not positive`);
    }
    // Independent recomputation from the returned state:
    const den1 = 1 + fl.beta * (fl.K[0] - 1);
    const den2 = 1 + fl.beta * (fl.K[1] - 1);
    const xb1 = z[0] / den1;
    const xb2 = z[1] / den2;
    const yb1 = fl.K[0] * xb1;
    const yb2 = fl.K[1] * xb2;
    assert.ok(Math.abs(xb1 + xb2 - 1) < 1e-8, 'liquid composition closure violated');
    assert.ok(Math.abs(yb1 + yb2 - 1) < 1e-8, 'vapor composition closure violated');
    assert.ok(
      Math.abs(yb1 - fl.K[0] * xb1) < 1e-8 && Math.abs(yb2 - fl.K[1] * xb2) < 1e-8,
      'equilibrium ratios inconsistent'
    );
    assert.ok(Math.abs(fl.beta * yb1 + (1 - fl.beta) * xb1 - z[0]) < 1e-8, 'component 1 material balance violated');
    assert.ok(Math.abs(fl.beta * yb2 + (1 - fl.beta) * xb2 - z[1]) < 1e-8, 'component 2 material balance violated');
  }
});
