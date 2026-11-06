'use strict';

const assert = require('assert');

const { ConjugateHeatTransferEngine } = require('../src/core/cae/conjugate_heat_transfer');
const { RadiationDOMEngine, SIGMA_STEFAN_BOLTZMANN } = require('../src/core/cae/radiation_dom');
const { RandomVibrationPSDEngine } = require('../src/core/cae/random_vibration_psd');
const { VenkatakrishnanLimiter } = require('../src/core/cae/venkatakrishnan_limiter');
const { Polygon2D, PolygonBooleanEngine } = require('../src/core/eda/polygon_boolean_engine');
const { PKCS11HardwareToken, CKR } = require('../src/core/security/pkcs11_smartcard');
const { Poisson2DDirichletDirectSolver } = require('../src/core/math/poisson_2d_direct');

function runRemainingModulesCoverageTests() {
  console.log('================================================================');
  console.log('   TESTING REMAINING PRODUCTION MODULES (COVERAGE)            ');
  console.log('================================================================');

  let passedTests = 0;
  let failedTests = 0;

  function check(name, fn) {
    try {
      fn();
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (error) {
      failedTests++;
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${error.message}`);
    }
  }

  check('ConjugateHeatTransferEngine interface flux arithmetic', () => {
    const fluidCell = { T: 300, k: 0.6, wallDistance: 0.001 };
    const solidCell = { T: 400, k: 15, wallDistance: 0.002 };
    const face = { area: 0.01 };
    const result = ConjugateHeatTransferEngine.evaluateInterfaceHeatFlux(fluidCell, solidCell, face);
    assert(Number.isFinite(result.heatFluxWm2) && result.heatFluxWm2 > 0);
    assert(Number.isFinite(result.interfaceTempK));
    assert(result.interfaceTempK > 300 && result.interfaceTempK < 400);
    assert.strictEqual(result.totalHeatPowerW, Number((result.heatFluxWm2 * face.area).toFixed(4)));
  });

  check('ConjugateHeatTransferEngine coupled energy step conserves direction', () => {
    const fluidCell = { T: 300, k: 0.6, wallDistance: 0.001, rho: 1000, Cp: 4186, volume: 1e-5 };
    const solidCell = { T: 400, k: 15, wallDistance: 0.002, rho: 7800, Cp: 500, volume: 1e-5 };
    const status = ConjugateHeatTransferEngine.solveCoupledEnergyStep(
      [{ fluidCell, solidCell, face: { area: 0.01 } }],
      0.1
    );
    assert.strictEqual(status.pairsCount, 1);
    assert(status.totalHeatExchangeWatts > 0);
    assert(fluidCell.T > 300);
    assert(solidCell.T < 400);
  });

  check('ConjugateHeatTransferEngine fail-closed validation', () => {
    assert.throws(() => ConjugateHeatTransferEngine.evaluateInterfaceHeatFlux({}, {}, { area: 1 }), TypeError);
    assert.throws(
      () =>
        ConjugateHeatTransferEngine.evaluateInterfaceHeatFlux(
          { T: 300, k: 0.6, wallDistance: -0.001 },
          { T: 301, k: 0.6, wallDistance: 0.001 },
          { area: 1 }
        ),
      RangeError
    );
    assert.throws(() => ConjugateHeatTransferEngine.solveCoupledEnergyStep([], 0), TypeError);
  });

  check('RadiationDOMEngine radiative exchange is finite and sign-correct', () => {
    const result = RadiationDOMEngine.evaluateRadiativeFlux({ T: 500, emissivity: 0.9 }, { T: 300, emissivity: 0.9 });
    assert(result.qRadWm2 > 0);
    assert(result.radiativeConductanceHr > 0);
    assert(result.equivalentEmissivity > 0 && result.equivalentEmissivity <= 1);
  });

  check('RadiationDOMEngine equal-temperature limit uses linearized conductance', () => {
    const result = RadiationDOMEngine.evaluateRadiativeFlux({ T: 400, emissivity: 0.8 }, { T: 400, emissivity: 0.8 });
    assert.strictEqual(result.qRadWm2, 0);
    const epsEquiv = 1 / (1 / 0.8 + 1 / 0.8 - 1);
    const hRadExpected = 4 * SIGMA_STEFAN_BOLTZMANN * epsEquiv * Math.pow(400, 3);
    assert(Math.abs(result.radiativeConductanceHr - hRadExpected) / hRadExpected < 1e-3);
  });

  check('RadiationDOMEngine S4 quadrature has 24 finite unit directions', () => {
    const directions = RadiationDOMEngine.getS4QuadratureDirections();
    assert.strictEqual(directions.length, 24);
    for (const direction of directions) {
      const norm = Math.hypot(direction.dx, direction.dy, direction.dz);
      assert(Math.abs(norm - 1) < 1e-4);
      assert(direction.weight > 0);
    }
  });

  check('RandomVibrationPSDEngine Miles equation 3-sigma result', () => {
    const result = RandomVibrationPSDEngine.evaluateMilesVibration({
      naturalFrequencyHz: 150,
      dampingRatio: 0.05,
      psdLevelG2Hz: 0.04,
      staticStressPerG: 1.5e6
    });
    const gRms = Math.sqrt((Math.PI / 2) * 150 * 10 * 0.04);
    assert(Math.abs(result.gRms - gRms) < 0.01);
    assert(Math.abs(result.acceleration3SigmaG - 3 * gRms) < 0.02);
    assert(Math.abs(result.stress3SigmaPeakMPa - (3 * gRms * 1.5e6) / 1e6) < 0.02);
  });

  check('RandomVibrationPSDEngine flat PSD integration matches sqrt(PSD*df)', () => {
    const points = [];
    for (let f = 20; f <= 2000; f += 20) points.push({ f, psd: 0.04 });
    const result = RandomVibrationPSDEngine.integratePSDCurve(points);
    assert(Math.abs(result.overallGrms - Math.sqrt(0.04 * 1980)) < 5e-4);
    assert.strictEqual(result.fMin, 20);
    assert.strictEqual(result.fMax, 2000);
  });

  check('VenkatakrishnanLimiter smooth gradient returns unity limiter', () => {
    const cell = { value: 1, volume: 1, centroid: { x: 0, y: 0, z: 0 } };
    const neighbors = [
      { value: 1.0001, centroid: { x: 1, y: 0, z: 0 } },
      { value: 0.9999, centroid: { x: -1, y: 0, z: 0 } }
    ];
    const phi = VenkatakrishnanLimiter.computeCellLimiter(cell, neighbors, { x: 0, y: 0, z: 0 });
    assert(Math.abs(phi - 1) < 1e-9);
    assert.strictEqual(VenkatakrishnanLimiter.computeCellLimiter(cell), 1);
  });

  check('VenkatakrishnanLimiter steep gradients are bounded to [0,1]', () => {
    const cell = { value: 0, volume: 1, centroid: { x: 0, y: 0, z: 0 } };
    const neighbors = [{ value: 100, centroid: { x: 1, y: 0, z: 0 } }];
    const phi = VenkatakrishnanLimiter.computeCellLimiter(cell, neighbors, { x: 1000, y: 0, z: 0 });
    assert(phi >= 0 && phi <= 1);
  });

  check('Polygon2D area and point containment', () => {
    const square = new Polygon2D([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]);
    assert.strictEqual(square.area(), 100);
    assert.strictEqual(square.isPointInside(5, 5), true);
    assert.strictEqual(square.isPointInside(15, 15), false);
  });

  check('PolygonBooleanEngine intersection area is consistent', () => {
    const a = new Polygon2D([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]);
    const b = new Polygon2D([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 }
    ]);
    const intersection = PolygonBooleanEngine.intersect(a, b);
    assert.strictEqual(intersection.length, 1);
    assert(Math.abs(intersection[0].area() - 25) < 1e-9);
  });

  check('PolygonBooleanEngine sizePolygon grows clockwise polygons with positive delta', () => {
    const square = new Polygon2D([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 }
    ]);
    const grown = PolygonBooleanEngine.sizePolygon(square, 2);
    assert(grown.area() > square.area());
    const shrunk = PolygonBooleanEngine.sizePolygon(square, -2);
    assert(shrunk.area() < square.area());
  });

  check('PKCS11HardwareToken fails closed without hardware', () => {
    const token = new PKCS11HardwareToken();
    assert.strictEqual(token.status, 'unavailable');
    assert.strictEqual(token.C_Initialize(), CKR.CKR_FUNCTION_NOT_SUPPORTED);
    assert.strictEqual(token.signEngineeringArtifact().status, 'unavailable');
    assert.strictEqual(token.C_Sign().rv, CKR.CKR_FUNCTION_NOT_SUPPORTED);
    assert.strictEqual(token.C_Verify().valid, false);
    assert.deepStrictEqual(token.C_GetSlotList().slots, []);
  });

  check('Poisson2DDirichletDirectSolver inverts the five-point operator', () => {
    const n = 7;
    const solver = new Poisson2DDirichletDirectSolver(n);
    const center = Math.floor(n / 2);
    const rhs = new Float64Array(n * n);
    rhs[center * n + center] = 1;
    const result = solver.solve(rhs);
    assert.strictEqual(result.converged, true);
    let maxOperatorError = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        let value = 4 * result.solution[idx];
        if (i > 0) value -= result.solution[idx - 1];
        if (i + 1 < n) value -= result.solution[idx + 1];
        if (j > 0) value -= result.solution[idx - n];
        if (j + 1 < n) value -= result.solution[idx + n];
        maxOperatorError = Math.max(maxOperatorError, Math.abs(value - (idx === center * n + center ? 1 : 0)));
      }
    }
    assert(maxOperatorError < 1e-12, `max operator error ${maxOperatorError}`);
    assert(result.solution[center * n + center] > 0);
  });

  check('Poisson2DDirichletDirectSolver preserves positivity and finiteness for smooth rhs', () => {
    const n = 15;
    const solver = new Poisson2DDirichletDirectSolver(n);
    const rhs = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        rhs[j * n + i] = Math.sin((Math.PI * (i + 1)) / (n + 1)) * Math.sin((Math.PI * (j + 1)) / (n + 1));
      }
    }
    const result = solver.solve(rhs);
    assert.strictEqual(result.converged, true);
    let allFinitePositive = true;
    for (const value of result.solution) {
      if (!Number.isFinite(value) || value <= 0) allFinitePositive = false;
    }
    assert.strictEqual(allFinitePositive, true);
  });

  check('Poisson2DDirichletDirectSolver input validation', () => {
    assert.throws(() => new Poisson2DDirichletDirectSolver(0), RangeError);
    const solver = new Poisson2DDirichletDirectSolver(3);
    assert.throws(() => solver.solve(new Array(8)), RangeError);
    const rhs = new Float64Array(9);
    rhs[0] = Number.NaN;
    assert.throws(() => solver.solve(rhs), TypeError);
  });

  return { total: passedTests + failedTests, passed: passedTests, failed: failedTests };
}

module.exports = { runRemainingModulesCoverageTests };

if (require.main === module) {
  const stats = runRemainingModulesCoverageTests();
  console.log(`Remaining-module coverage: ${stats.passed}/${stats.total} passed; ${stats.failed} failed`);
  if (stats.failed > 0) process.exitCode = 1;
}
