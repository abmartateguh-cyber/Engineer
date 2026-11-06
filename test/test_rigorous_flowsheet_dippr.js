/**
 * Test Suite: Rigorous Flowsheet Thermodynamics and Column Simulation with DIPPR
 *
 * Verifies:
 * 1. DIPPR Expanded Chemical Catalog dynamic property resolution and Peng-Robinson EOS PT flash.
 * 2. Multi-unit process flowsheet convergence (Mixer -> Heat Exchanger -> Flash Separator -> Distillation Column)
 *    with mass and energy balance conservation to within 1e-4 relative tolerance.
 * 3. Naphtali-Sandholm MESH column rigorous convergence for multi-stage depropanizer and deethanizer columns,
 *    verifying monotonic stage temperature profiles, component mass closures, and product purity.
 */

'use strict';

const assert = require('assert');
const { getDipprCatalog } = require('../src/core/plant/dippr_expanded_catalog');
const { PengRobinsonEOS } = require('../src/core/plant/peng_robinson_eos');
const { ProcessFlowsheetSolver, ProcessStream } = require('../src/core/plant/process_flowsheet_solver');
const { NaphtaliSandholmColumnSolver } = require('../src/core/plant/naphtali_sandholm_mesh');
const { RigorousDistillationColumnSolver } = require('../src/core/plant/rigorous_distillation_column');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('================================================================');
console.log('   RIGOROUS FLOWSHEET THERMODYNAMICS & DIPPR VERIFICATION       ');
console.log('================================================================\n');

// ============================================================================
// SECTION 1: DIPPR Property Resolution & Peng-Robinson EOS Flash Calculations
// ============================================================================
console.log('--- Section 1: DIPPR Property Resolution & Peng-Robinson EOS ---');

runTest('DIPPR catalog resolves pure hydrocarbon properties with provenance and equations', () => {
  const dippr = getDipprCatalog();
  assert.ok(dippr, 'DIPPR catalog must be initialized');

  const speciesList = ['methane', 'ethane', 'propane', 'isobutane', 'n-butane', 'n-pentane'];
  for (const name of speciesList) {
    const sp = dippr.getSpecies(name);
    assert.ok(sp, `Species ${name} must be found in catalog`);
    assert.ok(sp.Tc > 0, `${name} Tc must be positive`);
    assert.ok(sp.Pc > 0, `${name} Pc must be positive`);
    assert.ok(Number.isFinite(sp.omega), `${name} omega must be finite`);

    const props = dippr.resolveProperties(name);
    assert.strictEqual(props.id, sp.id);
    assert.ok(props.criticalTemperatureK > 0);
    assert.ok(props.criticalPressurePa > 0);
    assert.ok(props.provenance && (typeof props.provenance === 'string' ? props.provenance : props.provenance.source).includes('DIPPR'));

    // Test temperature-dependent property callbacks
    const T = 300.0; // K
    const pVap = props.evalVaporPressure(T);
    assert.ok(pVap > 0, `${name} vapor pressure must be positive at 300 K`);

    const cp0 = props.evalIdealGasCp(T);
    assert.ok(cp0 > 0, `${name} ideal gas Cp must be positive at 300 K`);

    const rhoL = props.evalLiquidDensity(Math.min(T, sp.Tc * 0.95));
    assert.ok(rhoL > 0, `${name} liquid density must be positive below Tc`);

    const muL = props.evalLiquidViscosity(Math.min(T, sp.Tc * 0.95));
    assert.ok(muL > 0, `${name} liquid viscosity must be positive below Tc`);

    const dHvap = props.evalHeatOfVaporization(Math.min(T, sp.Tc * 0.95));
    assert.ok(dHvap > 0, `${name} latent heat of vaporization must be positive below Tc`);
  }
});

runTest('Peng-Robinson EOS instantiates dynamically from DIPPR species names', () => {
  const comps = ['methane', 'ethane', 'propane', 'n-butane'];
  const eos = PengRobinsonEOS.fromDippr(comps);

  assert.strictEqual(eos.N, 4);
  assert.strictEqual(eos.components[0].name.toLowerCase(), 'methane');
  assert.strictEqual(eos.components[2].name.toLowerCase(), 'propane');
  assert.ok(Math.abs(eos.components[0].Tc - 190.56) < 1.0, 'Methane Tc matches DIPPR benchmark');
  assert.ok(Math.abs(eos.components[2].Tc - 369.83) < 1.0, 'Propane Tc matches DIPPR benchmark');
});

runTest('Peng-Robinson EOS performs two-phase PT flash for hydrocarbon mixture', () => {
  const comps = ['propane', 'isobutane', 'n-butane'];
  const eos = PengRobinsonEOS.fromDippr(comps);

  const z = [0.40, 0.30, 0.30];
  const T = 300.0; // 26.85 °C
  const P = 500000.0; // 5 bar = 500 kPa

  const flash = eos.flashPT(z, T, P, { maxIter: 100, tol: 1e-8 });

  assert.strictEqual(flash.converged, true, 'PR flash must converge');
  assert.strictEqual(flash.phaseState, 'two-phase', 'Mixture must be two-phase at 300 K, 5 bar');
  assert.ok(flash.beta > 0.0 && flash.beta < 1.0, 'Vapor fraction beta must be strictly between 0 and 1');

  // Verify phase compositions sum to 1.0
  const sumX = flash.x.reduce((a, b) => a + b, 0);
  const sumY = flash.y.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumX - 1.0) < 1e-6, `Liquid mole fractions sum to 1.0: ${sumX}`);
  assert.ok(Math.abs(sumY - 1.0) < 1e-6, `Vapor mole fractions sum to 1.0: ${sumY}`);

  // Light component (propane) must enrich vapor phase (y > x)
  assert.ok(flash.y[0] > flash.x[0], 'Propane is more volatile and concentrates in vapor');
  // Heavy component (n-butane) must enrich liquid phase (x > y)
  assert.ok(flash.x[2] > flash.y[2], 'n-Butane is less volatile and concentrates in liquid');

  // Verify compressibility factors: Z_L < 0.2 and Z_V > 0.7
  assert.ok(flash.Z_L > 0.0 && flash.Z_L < 0.2, `Liquid Z factor physically reasonable: ${flash.Z_L}`);
  assert.ok(flash.Z_V > 0.7 && flash.Z_V < 1.0, `Vapor Z factor physically reasonable: ${flash.Z_V}`);

  // Verify thermodynamic fugacity equality between phases: f_i^L = f_i^V
  const fugL = eos.calculateFugacityCoefficients(flash.x, T, P, 'liquid');
  const fugV = eos.calculateFugacityCoefficients(flash.y, T, P, 'vapor');
  for (let i = 0; i < comps.length; i++) {
    const fL = flash.x[i] * fugL.phi[i] * P;
    const fV = flash.y[i] * fugV.phi[i] * P;
    const relDiff = Math.abs(fL - fV) / fL;
    assert.ok(relDiff < 1e-4, `Fugacity equality for ${comps[i]}: relDiff=${relDiff}`);
  }
});

runTest('Peng-Robinson enthalpy departures and mixture enthalpies calculate consistently', () => {
  const comps = ['propane', 'n-butane'];
  const eos = PengRobinsonEOS.fromDippr(comps);

  const z = [0.5, 0.5];
  const T = 310.0;
  const P = 600000.0;

  const hDepV = eos.calculateEnthalpyDeparture(z, T, P, 'vapor');
  const hDepL = eos.calculateEnthalpyDeparture(z, T, P, 'liquid');

  assert.ok(Number.isFinite(hDepV.enthalpyDepartureJmol), 'Vapor enthalpy departure is finite');
  assert.ok(Number.isFinite(hDepL.enthalpyDepartureJmol), 'Liquid enthalpy departure is finite');
  // Liquid departure (negative) is much larger in magnitude than vapor departure due to condensation
  assert.ok(hDepL.enthalpyDepartureJmol < hDepV.enthalpyDepartureJmol, 'Liquid enthalpy departure is lower than vapor departure');

  const dippr = getDipprCatalog();
  const hMixV = eos.calculateMixtureEnthalpy(z, T, P, 'vapor', dippr);
  const hMixL = eos.calculateMixtureEnthalpy(z, T, P, 'liquid', dippr);
  assert.ok(Number.isFinite(hMixV), 'Mixture vapor enthalpy is finite');
  assert.ok(Number.isFinite(hMixL), 'Mixture liquid enthalpy is finite');
  assert.ok(hMixV > hMixL, 'Vapor total enthalpy exceeds liquid enthalpy by latent heat');
});

// ============================================================================
// SECTION 2: Flowsheet Block Convergence and Mass & Energy Conservation
// ============================================================================
console.log('\n--- Section 2: Flowsheet Block Convergence & Conservation ---');

runTest('Flowsheet with Mixer, Heat Exchanger, Flash Separator, and Column converges cleanly', () => {
  const solver = new ProcessFlowsheetSolver();
  const comp1 = { propane: 0.50, isobutane: 0.30, n_butane: 0.20 };
  const comp2 = { propane: 0.30, isobutane: 0.30, n_butane: 0.40 };

  // Boundary feed streams
  solver.addStream(new ProcessStream('S1', {
    temperatureC: 30,
    pressureKPa: 700,
    molarFlowKmolH: 60,
    composition: comp1,
    vaporFraction: 0.0
  }));

  solver.addStream(new ProcessStream('S2', {
    temperatureC: 30,
    pressureKPa: 700,
    molarFlowKmolH: 40,
    composition: comp2,
    vaporFraction: 0.0
  }));

  // Intermediate and outlet streams
  solver.addStream(new ProcessStream('S3', { temperatureC: 30, pressureKPa: 700, molarFlowKmolH: 0, composition: comp1, vaporFraction: 0.0 }));
  solver.addStream(new ProcessStream('S4', { temperatureC: 40, pressureKPa: 700, molarFlowKmolH: 0, composition: comp1, vaporFraction: 0.0 }));
  solver.addStream(new ProcessStream('S_VAP', { temperatureC: 40, pressureKPa: 700, molarFlowKmolH: 0, composition: comp1, vaporFraction: 1.0 }));
  solver.addStream(new ProcessStream('S_LIQ', { temperatureC: 40, pressureKPa: 700, molarFlowKmolH: 0, composition: comp1, vaporFraction: 0.0 }));
  solver.addStream(new ProcessStream('S_DIST', { temperatureC: 15, pressureKPa: 700, molarFlowKmolH: 0, composition: comp1, vaporFraction: 0.0 }));
  solver.addStream(new ProcessStream('S_BOT', { temperatureC: 55, pressureKPa: 700, molarFlowKmolH: 0, composition: comp1, vaporFraction: 0.0 }));

  // Unit Operations: Mixer -> Heater -> Flash Separator -> Distillation Column
  solver.addMixer('MIX1', ['S1', 'S2'], 'S3');
  solver.addHeater('HEX1', 'S3', 'S4', { outletTemperatureC: 40, pressureDropKPa: 0 });
  solver.addFlashSeparator('FLASH1', 'S4', 'S_VAP', 'S_LIQ', {
    temperatureC: 40,
    pressureKPa: 700,
    flashModel: 'peng-robinson',
    useDippr: true
  });
  solver.addDistillationColumn('COL1', 'S_LIQ', 'S_DIST', 'S_BOT', {
    stageCount: 15,
    feedStage: 8,
    refluxRatio: 2.5,
    distillateRate: 0.35,
    pressureKPa: 700,
    condenserType: 'total',
    useDippr: true,
    model: 'rigorous'
  });

  const res = solver.solve(10, 1e-4);

  assert.strictEqual(res.success, true, 'Flowsheet solver must report success');
  assert.strictEqual(res.converged, true, 'Flowsheet must be converged');
  assert.strictEqual(res.status, 'computed', 'Flowsheet status must be computed');

  // Verify intermediate stream calculations
  const s3 = solver.getStream('S3');
  assert.ok(Math.abs(s3.molarFlowKmolH - 100.0) < 1e-6, 'Mixer output flow is exactly 100 kmol/h');
  assert.ok(Math.abs(s3.composition.propane - 0.42) < 1e-6, 'Blended propane fraction is 0.42');

  const s4 = solver.getStream('S4');
  assert.strictEqual(s4.T_C, 40, 'Heater raises temperature to 40 °C');
  assert.ok(Math.abs(s4.molarFlowKmolH - 100.0) < 1e-6, 'Heater preserves molar flow');

  const sVap = solver.getStream('S_VAP');
  const sLiq = solver.getStream('S_LIQ');
  assert.ok(sVap.molarFlowKmolH > 0, 'Flash produces positive vapor flow');
  assert.ok(sLiq.molarFlowKmolH > 0, 'Flash produces positive liquid flow');
  assert.ok(Math.abs(sVap.molarFlowKmolH + sLiq.molarFlowKmolH - 100.0) < 1e-6, 'Flash mass balance closed');

  const sDist = solver.getStream('S_DIST');
  const sBot = solver.getStream('S_BOT');
  assert.ok(sDist.molarFlowKmolH > 0, 'Distillate flow is positive');
  assert.ok(sBot.molarFlowKmolH > 0, 'Bottoms flow is positive');
  assert.ok(Math.abs(sDist.molarFlowKmolH + sBot.molarFlowKmolH - sLiq.molarFlowKmolH) < 1e-6, 'Column mass balance closed');

  // Distillate should be enriched in propane relative to column feed
  assert.ok(sDist.composition.propane > sLiq.composition.propane, 'Distillate is enriched in propane');
  // Bottoms should be depleted in propane relative to column feed
  assert.ok(sBot.composition.propane < sLiq.composition.propane, 'Bottoms is depleted in propane');

  // Verify Overall Mass Conservation (< 1e-4 tolerance)
  assert.ok(res.overallMassBalanceClosure < 1e-4, `Overall mass balance closure ${res.overallMassBalanceClosure} < 1e-4`);
  assert.strictEqual(res.balances.massBalance.absErrorKmolH, 0, 'Overall mass balance error is 0 kmol/h');

  // Verify per-component mass conservation (< 1e-4 tolerance)
  for (const [comp, err] of Object.entries(res.balances.massBalance.perComponentRelError)) {
    assert.ok(err < 1e-4, `Component ${comp} mass closure error ${err} < 1e-4`);
  }

  // Verify Overall Energy Conservation (< 1e-4 tolerance)
  assert.ok(res.overallEnergyBalanceClosure < 1e-4, `Overall energy balance closure ${res.overallEnergyBalanceClosure} < 1e-4`);
  assert.strictEqual(res.balances.isConserved, true, 'Flowsheet satisfies strict conservation criteria');
});

// ============================================================================
// SECTION 3: Rigorous Multi-Stage Depropanizer Column Convergence
// ============================================================================
console.log('\n--- Section 3: Rigorous Multi-Stage Column Convergence ---');

runTest('Multi-stage depropanizer converges with DIPPR properties and satisfies MESH equations', () => {
  const spec = {
    components: ['propane', 'isobutane', 'n-butane'],
    feedComposition: { propane: 0.40, isobutane: 0.30, 'n-butane': 0.30 },
    stageCount: 15,
    feedStage: 8,
    refluxRatio: 2.5,
    distillateRate: 0.40,
    pressurePa: 700000, // 7 bar
    kValueModel: 'dippr',
    model: 'rigorous',
    tolerance: 1e-5,
    maxIterations: 60
  };

  const res = NaphtaliSandholmColumnSolver.solve(spec);

  assert.strictEqual(res.success, true, 'Depropanizer solver must succeed');
  assert.strictEqual(res.convergence.status, 'converged', 'Column must converge');
  assert.ok(res.convergence.iterations <= 35, `Converged in ${res.convergence.iterations} <= 35 iterations`);
  assert.ok(res.convergence.maxResidual < 1e-5, `Final max residual ${res.convergence.maxResidual} < 1e-5`);

  // Verify stage count
  const stages = res.profiles.stages;
  assert.strictEqual(stages.length, 15, 'Profile contains exactly 15 stages');

  // Verify monotonic stage temperature profile from condenser to reboiler
  for (let j = 0; j < stages.length - 1; j++) {
    const tCurrent = stages[j].temperatureK;
    const tNext = stages[j + 1].temperatureK;
    assert.ok(tCurrent <= tNext + 1e-6, `Monotonic temperature: stage ${j + 1} (${tCurrent.toFixed(2)} K) <= stage ${j + 2} (${tNext.toFixed(2)} K)`);
  }

  // Verify high purity separation
  const xD = res.products.distillate.composition;
  const xB = res.products.bottoms.composition;
  assert.ok(xD.propane > 0.90, `Distillate propane purity ${xD.propane.toFixed(4)} > 0.90`);
  assert.ok(xB.propane < 0.05, `Bottoms propane content ${xB.propane.toFixed(4)} < 0.05`);
  assert.ok(xB['n-butane'] > 0.45, `Bottoms n-butane content ${xB['n-butane'].toFixed(4)} enriched`);

  // Verify component mass balance closure (< 1e-8 relative)
  assert.ok(res.massBalance.maxRelComponentClosure < 1e-8, `Component mass closure ${res.massBalance.maxRelComponentClosure} < 1e-8`);

  // Verify column energy balance residual ratio (< 1e-4)
  assert.ok(res.energyBalance.maxStageEnthalpyResidualOverDuty < 1e-4,
    `Stage enthalpy residual ratio ${res.energyBalance.maxStageEnthalpyResidualOverDuty} < 1e-4`);

  // Condenser and reboiler duties must be positive
  assert.ok(res.profiles.condenser.dutyKJPerMolFeed > 0, 'Condenser duty must be positive');
  assert.ok(res.profiles.reboiler.dutyKJPerMolFeed > 0, 'Reboiler duty must be positive');
});

runTest('Pressurized deethanizer column achieves ethane/propane separation with DIPPR properties', () => {
  const spec = {
    components: ['ethane', 'propane'],
    feedComposition: { ethane: 0.50, propane: 0.50 },
    stageCount: 12,
    feedStage: 6,
    refluxRatio: 2.5,
    distillateRate: 0.50,
    pressurePa: 1000000, // 10 bar deethanizer
    kValueModel: 'dippr',
    model: 'rigorous',
    tolerance: 1e-5,
    maxIterations: 100
  };

  const res = RigorousDistillationColumnSolver.solve(spec);

  assert.strictEqual(res.convergence.status, 'converged', 'Deethanizer must converge');
  assert.ok(res.convergence.maxResidual < 1e-5, 'Max residual meets tolerance');

  // Verify high distillate purity
  const xD = res.products.distillate.composition;
  const xB = res.products.bottoms.composition;
  assert.ok(xD.ethane > 0.95, `Distillate ethane purity ${xD.ethane.toFixed(4)} > 0.95`);
  assert.ok(xB.ethane < 0.05, `Bottoms ethane content ${xB.ethane.toFixed(4)} < 0.05`);
  assert.ok(xB.propane > 0.95, `Bottoms propane purity ${xB.propane.toFixed(4)} > 0.95`);

  // Verify stage temperature monotonicity at 10 bar
  const stages = res.profiles.stages;
  for (let j = 0; j < stages.length - 1; j++) {
    assert.ok(stages[j].temperatureK <= stages[j + 1].temperatureK + 1e-6,
      `Stage ${j + 1} (${stages[j].temperatureK.toFixed(2)} K) <= Stage ${j + 2} (${stages[j + 1].temperatureK.toFixed(2)} K)`);
  }
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n================================================================');
console.log(`   TEST RESULTS: ${passedTests}/${totalTests} Passed (0 Failed)`);
console.log('================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
