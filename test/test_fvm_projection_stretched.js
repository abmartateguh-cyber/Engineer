'use strict';

const assert = require('assert');
const { FVMNavierStokes3D } = require('../src/core/cae/fvm_navier_stokes_3d');

/**
 * Projection-mode stretched-mesh regression tests.
 *
 * Exercises the optional incompressible pressure-projection path
 * (options.projection === true) with the convective CFL basis on wall-stretched
 * box meshes (stretch 1.05–1.22). The hardened projection is expected to keep
 * the explicit solve finite, the pressure strictly positive and the velocity
 * bounded on meshes where the legacy compressible relaxation fails closed.
 *
 * Residual diagnostics (observed min pressure / max velocity / any sum
 * velocity-limit hits) are printed for documentation; they are not pass/fail
 * gates.
 */
function runFvmProjectionStretchedTests() {
  let total = 0;
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  const U_INF = 70;
  const STRETCHES = [1.05, 1.12, 1.18, 1.22];
  const STEPS = 10;
  const VELOCITY_BOUND = 4.0 * U_INF + 1e-9;

  const finite = (c) =>
    Number.isFinite(c.u) &&
    Number.isFinite(c.v) &&
    Number.isFinite(c.w) &&
    Number.isFinite(c.p) &&
    Number.isFinite(c.k) &&
    Number.isFinite(c.omega) &&
    Number.isFinite(c.rho) &&
    Number.isFinite(c.nut);

  for (const stretch of STRETCHES) {
    test(`Projection mode survives stretch ${stretch}: finite state, positive pressure, bounded velocity`, () => {
      const fvm = new FVMNavierStokes3D({ mu_lam: 1.81e-5, projection: true, cflBasis: 'convective' });
      fvm.createBoxDomain(15, 10, 2, 2.0, 0.2, 0.08, stretch);
      for (const c of fvm.cells) c.u = U_INF;

      let minP = Infinity;
      let maxU = 0;
      let capHits = 0;
      for (let s = 0; s < STEPS; s++) {
        fvm.step(U_INF, 1);
        assert.ok(fvm.cells.every(finite), `non-finite state appeared at step ${s + 1}`);
        for (const c of fvm.cells) {
          assert.ok(c.p > 0, `non-positive pressure at step ${s + 1}: cell ${c.id} p=${c.p}`);
          const speed = Math.hypot(c.u, c.v, c.w);
          assert.ok(speed <= VELOCITY_BOUND, `velocity bound exceeded at step ${s + 1}: cell ${c.id} |u|=${speed}`);
          minP = Math.min(minP, c.p);
          maxU = Math.max(maxU, speed);
          if (speed > VELOCITY_BOUND - 1e-9) capHits++;
        }
      }
      console.log(
        `    [residual] stretch ${stretch}: minP=${minP.toFixed(1)} Pa, max|u|=${maxU.toFixed(2)} m/s, capHits=${capHits}`
      );
    });
  }

  return { total, passed, failed };
}

module.exports = { runFvmProjectionStretchedTests };

if (require.main === module) {
  const stats = runFvmProjectionStretchedTests();
  console.log(`FVM projection stretched: ${stats.passed}/${stats.total} passed; ${stats.failed} failed`);
  if (stats.failed > 0) process.exitCode = 1;
}
