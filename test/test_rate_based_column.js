/**
 * OmniEng verification gate for the rate-based packed-column model
 * (src/core/plant/rate_based_distillation.js).
 *
 * Deterministic, dependency-free checks:
 *   - Binary absorption: CO2 absorption into water in a packed column (given
 *     inlet gas flow, liquid flow, packing, and Henry k-value).  The required
 *     packing height for 90% absorption from the model must match an
 *     independent fine-step numerical integration of the same rate equation
 *     performed in this test to within 2%.
 *   - Onda correlations: a_w, k_L, k_G are positive, finite, and scale
 *     sensibly (k_L increases with liquid flow; k_G increases with gas flow;
 *     a_w increases with liquid flow and never exceeds the dry area a_c).
 *   - Maxwell-Stefan correction: for a ternary diffusion case
 *     (H2/N2/CO2), the effective diffusivity matrix is positive definite and
 *     flux directions are physically consistent (each retained species moves
 *     down its own gradient; the retained species with the steepest gradient
 *     transfers fastest).
 *   - Height consistency: for a constant-flux simplification,
 *     H = N_OG x H_OG reproduces the integrated height to 1e-6 relative.
 *   - Determinism: identical repeated computations give identical results.
 *
 * Run standalone:  node --test test/test_rate_based_column.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RateBasedPackedColumn,
  OndaCorrelations,
  maxwellStefanEffectiveDiffusivity,
  isSymmetricPositiveDefinite
} = require('../src/core/plant/rate_based_distillation');

// ---------------------------------------------------------------------------
// Shared physical configuration: CO2 absorption into water
// ---------------------------------------------------------------------------

const CO2_WATER = {
  packing: { ac: 190, dp: 0.025, sigmaC: 0.061 }, // 25 mm ceramic Raschig rings
  flows: { G: 0.005, L: 10.0 }, // kmol / (m^2 * s)
  liq: {
    rhoL: 997.0,
    muL: 8.9e-4,
    sigmaL: 0.072,
    DL: 1.92e-9, // CO2 in water, m^2 / s
    MwL: 18.015
  },
  gas: {
    rhoG: 1.185,
    muG: 1.8e-5,
    DG: 1.6e-5, // CO2 in N2 at 1 atm, m^2 / s
    MwG: 28.014
  },
  P: 101325.0, // Pa
  T: 298.15 // K
};

// Henry's constant for CO2 in water at 25 C is ~ 29.4 atm (mole-fraction
// basis); at 1 atm total pressure the equilibrium slope is m = y*/x = H/P.
const M_CO2_WATER = 29.4;

const Y_IN = 0.01; // 1 mol% CO2 in the feed gas
const Y_OUT = 0.001; // 90% absorption

// ---------------------------------------------------------------------------
// Independent reference: fixed-step trapezoidal integration of the rate
// equation over the column, using the model's flux coefficients but with its
// own grid (200,000 steps).  This deliberately does NOT call the model's
// quadrature, so any integrator bug in the model is caught.
// ---------------------------------------------------------------------------

function independentIntegratedHeight(model, yIn, yOut, m) {
  const hOG = model.heightOfTransferUnit(m);
  const aw = model.wettedArea();
  const ky = model.overallGasCoefficient(m);
  assert.ok(hOG > 0 && aw > 0 && ky > 0, 'flux coefficients must be positive');
  const alpha = (m * model.G) / model.L;
  const integrand = (y) => 1 / (y - alpha * (y - yOut));
  const steps = 200000;
  const dy = (yIn - yOut) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const y0 = yOut + i * dy;
    const y1 = y0 + dy;
    sum += ((integrand(y0) + integrand(y1)) / 2) * dy;
  }
  return hOG * sum;
}

test('binary absorption: CO2 into water packing height matches independent integral', () => {
  const column = new RateBasedPackedColumn(CO2_WATER);
  const res = column.binaryAbsorptionHeight(Y_IN, Y_OUT, M_CO2_WATER);
  const independent = independentIntegratedHeight(column, Y_IN, Y_OUT, M_CO2_WATER);

  assert.ok(res.height > 0, 'packing height must be positive');
  assert.ok(Number.isFinite(res.height), 'packing height must be finite');
  assert.ok(res.ntu > 0, 'N_OG must be positive');
  assert.ok(res.hOG > 0, 'H_OG must be positive');
  assert.ok(res.ky > 0, 'K_y must be positive');
  assert.ok(res.aw > 0 && res.aw <= 190, 'a_w must be in (0, a_c]');

  const rel = Math.abs(independent - res.height) / res.height;
  assert.ok(
    rel <= 0.02,
    `model height ${res.height.toFixed(6)} m must match independent integration ` +
      `${independent.toFixed(6)} m (relative ${rel.toExponential(3)} > 2%)`
  );
});

test('Onda correlations: positive, finite, and monotonic scaling', () => {
  const liquidFluxes = [5, 10, 20, 40]; // kg / (m^2 * s)
  const kL = [];
  const aw = [];
  for (const flux of liquidFluxes) {
    const cfg = structuredClone(CO2_WATER);
    cfg.flows.L = flux / CO2_WATER.liq.MwL; // kmol / (m^2 * s)
    const column = new RateBasedPackedColumn(cfg);
    const k = column.liquidCoefficient();
    const a = column.wettedArea();
    assert.ok(k > 0 && Number.isFinite(k), 'k_L must be positive and finite');
    assert.ok(a > 0 && Number.isFinite(a) && a <= 190, 'a_w must be in (0, a_c]');
    kL.push(k);
    aw.push(a);
  }
  for (let i = 1; i < kL.length; i++) {
    assert.ok(kL[i] > kL[i - 1], 'k_L must increase with liquid flow');
    assert.ok(aw[i] > aw[i - 1], 'a_w must increase with liquid flow');
  }

  const vaporFluxes = [0.1, 0.2, 0.4, 0.8]; // kg / (m^2 * s)
  const kG = [];
  for (const flux of vaporFluxes) {
    const cfg = structuredClone(CO2_WATER);
    cfg.flows.G = flux / CO2_WATER.gas.MwG;
    const column = new RateBasedPackedColumn(cfg);
    const k = column.vaporCoefficient();
    assert.ok(k > 0 && Number.isFinite(k), 'k_G must be positive and finite');
    kG.push(k);
  }
  for (let i = 1; i < kG.length; i++) {
    assert.ok(kG[i] > kG[i - 1], 'k_G must increase with gas flow');
  }

  const raw = new OndaCorrelations(CO2_WATER.packing);
  assert.ok(raw.wettedArea({ L: 10, rhoL: 997, muL: 8.9e-4, sigmaL: 0.072 }) > 0);
  assert.ok(raw.liquidCoefficient({ L: 10, rhoL: 997, muL: 8.9e-4, sigmaL: 0.072, DL: 1.92e-9 }) > 0);
  assert.ok(raw.vaporCoefficient({ G: 0.1, rhoG: 1.185, muG: 1.8e-5, DG: 1.6e-5, P: 101325, T: 298.15 }) > 0);
});

test('Maxwell-Stefan: effective diffusivity matrix positive definite, flux directions consistent', () => {
  // Ternary H2/N2/CO2 at x = [0.5, 0.3, 0.2]; binary-pair diffusivities
  // (m^2/s at 25 C, 1 atm, physical values).
  const x = [0.5, 0.3, 0.2];
  const Dij = [
    [7.7e-5, 6.5e-5, 1.6e-5],
    [6.5e-5, 7.7e-5, 1.6e-5],
    [1.6e-5, 1.6e-5, 6.5e-5]
  ];
  const ms = maxwellStefanEffectiveDiffusivity(x, Dij);
  assert.ok(ms.positiveDefinite, 'symmetric part of the effective diffusivity matrix must be positive definite');
  assert.ok(isSymmetricPositiveDefinite(ms.deffSymmetric), 'Sylvester check must pass');
  for (const d of ms.diagonal) {
    assert.ok(d > 0 && Number.isFinite(d), 'effective diffusivity diagonal entries must be positive');
  }

  // Thin-film linear gradient g (per meter).  Retained species are H2 (0)
  // and N2 (1); CO2 (2) is the frame reference.  The steepest retained
  // gradient is H2, so H2 must transfer fastest among the retained species,
  // and every retained species must move down its own gradient.
  const g = [0.8, 0.1, 0.05];
  const Nred = [-(ms.deff[0][0] * g[0] + ms.deff[0][1] * g[1]), -(ms.deff[1][0] * g[0] + ms.deff[1][1] * g[1])];
  for (let i = 0; i < 2; i++) {
    assert.ok(Nred[i] * g[i] < 0, `species ${i} must move down its own gradient`);
  }
  const steepestRetained = Math.abs(g[0]) > Math.abs(g[1]) ? 0 : 1;
  const fastestRetained = Math.abs(Nred[0]) > Math.abs(Nred[1]) ? 0 : 1;
  assert.strictEqual(
    fastestRetained,
    steepestRetained,
    'retained component with the steepest gradient must transfer fastest'
  );
  assert.ok(Number.isFinite(Nred[0]) && Number.isFinite(Nred[1]), 'fluxes must be finite');
});

test('height consistency: H = N_OG x H_OG reproduces integrated constant-flux height to 1e-6', () => {
  const column = new RateBasedPackedColumn(CO2_WATER);
  const analytic = column.constantFluxHeight(Y_IN, Y_OUT, M_CO2_WATER);
  const integrated = column.integratedConstantFluxHeight(Y_IN, Y_OUT, M_CO2_WATER);
  const rel = Math.abs(integrated.height - analytic.height) / analytic.height;
  assert.ok(
    rel <= 1e-6,
    `integrated height ${integrated.height.toFixed(10)} vs H_OG*N_OG ` +
      `${analytic.height.toFixed(10)} (relative ${rel.toExponential(3)})`
  );
  assert.ok(analytic.ntu > 0, 'analytic N_OG must be positive');
});

test('determinism: repeated computation returns identical results', () => {
  const a = new RateBasedPackedColumn(CO2_WATER);
  const b = new RateBasedPackedColumn(CO2_WATER);
  assert.deepStrictEqual(
    a.binaryAbsorptionHeight(Y_IN, Y_OUT, M_CO2_WATER),
    b.binaryAbsorptionHeight(Y_IN, Y_OUT, M_CO2_WATER)
  );
  const x = [0.5, 0.3, 0.2];
  const Dij = [
    [7.7e-5, 6.5e-5, 1.6e-5],
    [6.5e-5, 7.7e-5, 1.6e-5],
    [1.6e-5, 1.6e-5, 6.5e-5]
  ];
  assert.deepStrictEqual(maxwellStefanEffectiveDiffusivity(x, Dij), maxwellStefanEffectiveDiffusivity(x, Dij));
});
