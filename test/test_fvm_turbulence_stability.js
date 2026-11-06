'use strict';

const assert = require('assert');
const { FVMNavierStokes3D } = require('../src/core/cae/fvm_navier_stokes_3d');

function runFvmTurbulenceStabilityTests() {
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
  const finite = (c) =>
    Number.isFinite(c.u) &&
    Number.isFinite(c.v) &&
    Number.isFinite(c.w) &&
    Number.isFinite(c.p) &&
    Number.isFinite(c.k) &&
    Number.isFinite(c.omega) &&
    Number.isFinite(c.rho);

  test('Uniform low-Mach box survives 240 steps with finite bounded fields', () => {
    const fvm = new FVMNavierStokes3D({ mu_lam: 1.81e-5 });
    fvm.createBoxDomain(30, 20, 2, 2.0, 0.2, 0.08);
    for (const c of fvm.cells) c.u = U_INF;
    for (let s = 0; s < 240; s++) {
      fvm.step(U_INF, 1);
      assert.ok(fvm.cells.every(finite), `non-finite state appeared at step ${s + 1}`);
    }
    let maxOmega = 0;
    let minK = Infinity;
    let maxU = 0;
    for (const c of fvm.cells) {
      maxOmega = Math.max(maxOmega, c.omega);
      minK = Math.min(minK, c.k);
      maxU = Math.max(maxU, Math.hypot(c.u, c.v, c.w));
    }
    assert.ok(Number.isFinite(maxOmega) && maxOmega < 1e8, `omega runaway: ${maxOmega}`);
    assert.ok(minK > 0, `k collapsed to non-positive: ${minK}`);
    assert.ok(maxU < 5 * U_INF, `velocity runaway: ${maxU}`);
  });

  test('Turbulence fields stay bounded when the substep obeys the viscous CFL limit', () => {
    const fvm = new FVMNavierStokes3D({ mu_lam: 1.81e-5 });
    fvm.createBoxDomain(30, 20, 2, 2.0, 0.2, 0.08, 1.12);
    for (const c of fvm.cells) c.u = U_INF;
    for (let s = 0; s < 40; s++) {
      fvm.step(U_INF, 1);
      assert.ok(fvm.cells.every(finite), `non-finite state appeared at step ${s + 1} on stretched mesh`);
    }
    let maxOmega = 0;
    for (const c of fvm.cells) maxOmega = Math.max(maxOmega, c.omega);
    assert.ok(Number.isFinite(maxOmega) && maxOmega < 1e12, `omega runaway on stretched mesh: ${maxOmega}`);
  });

  test('Single substep preserves finite state on a coarse box', () => {
    const fvm = new FVMNavierStokes3D();
    fvm.createBoxDomain(6, 6, 4, 1.0, 0.5, 0.5);
    const res = fvm.step(0.0005, 1);
    assert.ok(res.maxVelocity > 0);
    assert.ok(fvm.cells.every(finite));
  });

  test('Non-finite turbulence input and invalid time step fail with typed errors', () => {
    const fvm = new FVMNavierStokes3D();
    fvm.createBoxDomain(4, 4, 2, 1.0, 0.5, 0.25);
    fvm.cells[0].omega = Number.NaN;
    assert.throws(
      () => fvm.updateSSTTurbulence(),
      (error) => error.code === 'NUMERICAL_FAILURE'
    );
    fvm.cells[0].omega = 10;
    assert.throws(
      () => fvm.updateSSTTurbulence(0),
      (error) => error.code === 'INVALID_INPUT'
    );
  });

  test('Wall friction solves consistent y-plus and log/buffer wall-law relations', () => {
    const fvm = new FVMNavierStokes3D({ mu_lam: 1.81e-5 });
    fvm.createBoxDomain(2, 20, 1, 1.0, 0.2, 0.1);
    const cell = fvm.cells[0];
    const wallFace = fvm.faces.find((face) => face.boundaryType === 'wall' && face.ownerId === cell.id);
    cell.u = 64.276;
    cell.v = 15.0;

    const logWall = fvm.evaluateWallBoundary(cell, wallFace);
    const nu = fvm.mu_lam / cell.rho;
    const tangentialSpeed = Math.hypot(cell.u, cell.w);
    assert.strictEqual(logWall.regime, 'log_law');
    assert.ok(Math.abs(logWall.yPlus - (cell.wallDistance * logWall.uTau) / nu) < 1e-10);
    assert.ok(Math.abs(logWall.tauW - cell.rho * logWall.uTau * logWall.uTau) < 1e-10);
    const logLawUPlus = Math.log(9.8 * logWall.yPlus) / fvm.kappa;
    assert.ok(Math.abs(tangentialSpeed / logWall.uTau - logLawUPlus) < 1e-10);
    assert.ok(Math.abs(fvm.estimateUTau(cell) - logWall.uTau) < 1e-10);

    cell.wallDistance = 1e-4;
    cell.u = 10.0;
    cell.v = 0.0;
    const bufferWall = fvm.evaluateWallBoundary(cell, wallFace);
    assert.strictEqual(bufferWall.regime, 'buffer_layer');
    const blend = (bufferWall.yPlus - 5.0) / 25.0;
    const tauVisc = fvm.mu_lam * (cell.u / cell.wallDistance);
    const tauLog = cell.rho * Math.pow((fvm.kappa * cell.u) / Math.log(9.8 * bufferWall.yPlus), 2);
    const expectedTau = (1.0 - blend) * tauVisc + blend * tauLog;
    assert.ok(Math.abs(bufferWall.tauW - expectedTau) / expectedTau < 1e-10);
  });

  test('Strong stretching fails closed with a typed numerical error rather than hidden state floors', () => {
    const fvm = new FVMNavierStokes3D({ mu_lam: 1.81e-5 });
    fvm.createBoxDomain(30, 20, 2, 2.0, 0.2, 0.08, 1.18);
    for (const c of fvm.cells) c.u = U_INF;
    assert.throws(
      () => fvm.step(U_INF, 1),
      (error) => error.code === 'NUMERICAL_FAILURE' && /inadmissible cell state/.test(error.message)
    );
  });

  return { total, passed, failed };
}

module.exports = { runFvmTurbulenceStabilityTests };

if (require.main === module) {
  const stats = runFvmTurbulenceStabilityTests();
  console.log(`FVM turbulence stability: ${stats.passed}/${stats.total} passed; ${stats.failed} failed`);
  if (stats.failed > 0) process.exitCode = 1;
}
