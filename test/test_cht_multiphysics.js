'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConjugateHeatTransferSolver } = require('../src/core/cae/conjugate_heat_transfer_radiation');

test('CHT: two-slab conduction benchmark reproduces weighted harmonic-mean interface temperature', () => {
  const k1 = 0.2;
  const k2 = 0.1;
  const L1 = 0.1;
  const L2 = 0.1;
  const T0 = 300;
  const T2 = 400;

  const analytic = ConjugateHeatTransferSolver.twoSlabInterfaceTemperature(k1, k2, L1, L2, T0, T2);
  const result = ConjugateHeatTransferSolver.solveTwoSlab({
    k1,
    k2,
    L1,
    L2,
    T0,
    T2,
    relaxation: 0.5,
    toleranceK: 1e-14
  });

  assert.ok(result.converged, `two-slab coupling must converge (iterations=${result.iterations})`);
  assert.ok(
    Math.abs(result.interfaceTempK - analytic) < 1e-6,
    `interface temperature ${result.interfaceTempK.toFixed(9)} must match analytic ${analytic.toFixed(9)} to 1e-6`
  );
  assert.ok(
    result.interfaceFluxErrorWm2 < 1e-12,
    `interface flux continuity error ${result.interfaceFluxErrorWm2.toExponential(3)} W/m2 must be below 1e-12`
  );

  const q1 = (k1 * (result.interfaceTempK - T0)) / L1;
  const q2 = (k2 * (T2 - result.interfaceTempK)) / L2;
  assert.ok(
    Math.abs(q1 - q2) < 1e-12,
    `flux continuity k1(Ti-T0)/L1 = k2(T2-Ti)/L2 exact to 1e-12 (diff=${Math.abs(q1 - q2).toExponential(3)})`
  );

  console.log(
    `[two-slab] converged in ${result.iterations} iterations; Ti=${result.interfaceTempK.toFixed(9)} K ` +
      `(analytic ${analytic.toFixed(9)} K, err=${result.interfaceTempErrorK.toExponential(3)} K); ` +
      `flux continuity error=${result.interfaceFluxErrorWm2.toExponential(3)} W/m2`
  );
});

test('CHT: fluid-solid steady state wall temperature and interface flux matching', () => {
  const result = ConjugateHeatTransferSolver.solveFluidSolidWall({
    solid: { conductivity: 0.2, thickness: 0.01, baseTemperature: 400 },
    fluid: {
      conductivity: 0.026,
      density: 1.2,
      specificHeat: 1005,
      channelHeight: 0.02,
      meanVelocity: 1,
      length: 0.5,
      inletTemperature: 300,
      segments: 40
    },
    relaxation: 0.3,
    toleranceK: 1e-8,
    maxIterations: 600
  });

  assert.ok(result.converged, 'fluid-solid coupling must converge');

  const [wallMin, wallMax] = result.wallTempRangeK;
  assert.ok(
    wallMin > 300 && wallMax < 400,
    `wall temperature profile ${wallMin.toFixed(3)}..${wallMax.toFixed(3)} K must lie between 300 and 400 K`
  );

  assert.ok(
    result.relativeFluxResidual < 0.01,
    `interface flux mismatch ${(100 * result.relativeFluxResidual).toFixed(4)}% must be below 1% (residual=${result.maxFluxResidualWm2.toExponential(3)} W/m2)`
  );

  console.log(
    `[fluid-solid] converged in ${result.iterations} iterations; wall ${wallMin.toFixed(2)}..${wallMax.toFixed(2)} K; ` +
      `relative flux residual=${(100 * result.relativeFluxResidual).toFixed(6)}% ` +
      `(abs=${result.maxFluxResidualWm2.toExponential(3)} W/m2, h=${result.convectiveCoefficientWm2K.toFixed(3)} W/m2K)`
  );
});

test('CHT: global energy balance between solid conduction and fluid extraction', () => {
  const result = ConjugateHeatTransferSolver.solveFluidSolidWall({
    solid: { conductivity: 0.2, thickness: 0.01, baseTemperature: 400 },
    fluid: {
      conductivity: 0.026,
      density: 1.2,
      specificHeat: 1005,
      channelHeight: 0.02,
      meanVelocity: 1,
      length: 0.5,
      inletTemperature: 300,
      segments: 40
    },
    relaxation: 0.3,
    toleranceK: 1e-8,
    maxIterations: 600
  });

  assert.ok(
    result.energyBalanceErrorPercent < 1,
    `solid/fluid heat balance mismatch ${result.energyBalanceErrorPercent.toFixed(6)}% must be within 1%`
  );

  const outlet = result.bulkTemperatureProfile[result.bulkTemperatureProfile.length - 1];
  const fluidGain = 1.2 * 1 * 0.02 * 1005 * (outlet - 300);
  assert.ok(
    Math.abs(fluidGain - result.heatThroughSolidWm) / Math.abs(fluidGain) < 0.01,
    `fluid enthalpy gain ${fluidGain.toFixed(4)} W/m must match solid-conducted heat ${result.heatThroughSolidWm.toFixed(4)} W/m`
  );

  console.log(
    `[energy-balance] solid-conducted=${result.heatThroughSolidWm.toFixed(4)} W/m, ` +
      `fluid-extracted=${result.heatExtractedFluidWm.toFixed(4)} W/m, ` +
      `outlet bulk=${outlet.toFixed(3)} K, mismatch=${result.energyBalanceErrorPercent.toFixed(6)}%`
  );
});

test('CHT: coupling iteration converges monotonically below 1e-8', () => {
  const result = ConjugateHeatTransferSolver.solveFluidSolidWall({
    solid: { conductivity: 0.2, thickness: 0.01, baseTemperature: 400 },
    fluid: {
      conductivity: 0.026,
      density: 1.2,
      specificHeat: 1005,
      channelHeight: 0.02,
      meanVelocity: 1,
      length: 0.5,
      inletTemperature: 300,
      segments: 40
    },
    relaxation: 0.3,
    toleranceK: 1e-8,
    maxIterations: 600
  });

  const history = result.residualHistory;
  assert.ok(history.length > 2, 'must have a residual history');
  assert.ok(Array.isArray(history));
  assert.ok(
    history[history.length - 1] < 1e-8,
    `final residual ${history[history.length - 1].toExponential(3)} must be below 1e-8`
  );

  const tail = history.slice(1);
  for (let i = 1; i < tail.length; i += 1) {
    assert.ok(
      tail[i] <= tail[i - 1] * (1 + 1e-12),
      `residual history must be monotonically decreasing (index ${i + 1}: ${tail[i].toExponential(3)} > ${tail[i - 1].toExponential(3)})`
    );
  }

  console.log(
    `[convergence] iterations=${result.iterations}; residual sequence: ` +
      history
        .slice(0, 5)
        .map((value) => value.toExponential(2))
        .join(', ') +
      ' ... ' +
      history[history.length - 1].toExponential(2)
  );
});

test('CHT: pin-fin analogue matches analytic fin formula within 2%', () => {
  const result = ConjugateHeatTransferSolver.solveFin({
    conductivity: 200,
    convectionCoefficient: 25,
    perimeter: 0.04,
    area: 1e-4,
    length: 0.06,
    baseTemperature: 360,
    ambientTemperature: 300,
    cells: 200
  });

  assert.ok(
    result.errorPercent < 2,
    `fin base heat flow error ${result.errorPercent.toFixed(4)}% must be within 2% of analytic`
  );
  assert.ok(
    Math.abs(result.efficiency - result.analyticEfficiency) < 0.02,
    `fin efficiency ${result.efficiency.toFixed(5)} must match analytic ${result.analyticEfficiency.toFixed(5)}`
  );

  console.log(
    `[pin-fin] base heat flow=${result.baseHeatFlowW.toFixed(5)} W (analytic ${result.analyticBaseHeatFlowW.toFixed(5)} W, ` +
      `err=${result.errorPercent.toFixed(4)}%); efficiency=${result.efficiency.toFixed(5)} (analytic ${result.analyticEfficiency.toFixed(5)}); mL=${result.mL.toFixed(4)}`
  );
});
