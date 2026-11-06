/**
 * Unit and Verification Tests for PSVSizingEngine per API 520 / API 526.
 *
 * Verifies:
 * 1. Critical sonic gas relief area matching API 520 Part I Example sizing.
 * 2. Liquid relief sizing with specific gravity and differential pressure.
 * 3. API 521 fire case wetted surface heat absorption (Q = 43,200 * F * Aws^0.82).
 * 4. API 526 orifice selection matching standard letter designations (D to T).
 * 5. Leung omega two-phase flashing relief calculation.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PSVSizingEngine,
  API_526_ORIFICES
} = require('../src/core/plant/psv_sizing_api520');

describe('PSVSizingEngine: API 520 / API 526 Pressure Relief Sizing', () => {
  const engine = new PSVSizingEngine();

  it('calculates gas constant C and critical pressure ratio accurately', () => {
    // For ideal air/diatomic gas k = 1.4: C = 0.03948 * sqrt(1.4 * (2/2.4)^6) = 0.027033 (SI)
    const C = engine.calculateGasConstantC(1.4);
    assert.ok(Math.abs(C - 0.027033) < 1e-4, `C = ${C} expected ~0.027033`);

    // Critical pressure ratio for k = 1.4: (2 / 2.4)^(1.4 / 0.4) = 0.52828
    const rCrit = engine.calculateCriticalPressureRatio(1.4);
    assert.ok(Math.abs(rCrit - 0.5283) < 1e-3, `rCrit = ${rCrit} expected ~0.5283`);
  });

  it('sizes sonic gas relief valve matching API 520 Part I sample case', () => {
    // 25,000 kg/h hydrocarbon gas (M = 44 kg/kmol, k = 1.25, Z = 0.90, T = 350 K)
    // Set pressure 1500 kPa(g), 10% overpressure -> P1 = 1650 + 101.325 = 1751.3 kPa(a)
    const gasRelief = engine.sizeGasRelief({
      massReliefRateKgH: 25000.0,
      setPressureKPaG: 1500.0,
      overpressurePercent: 10,
      temperatureK: 350.0,
      molecularWeight: 44.0,
      compressibilityZ: 0.90,
      specificHeatRatio: 1.25
    });

    assert.equal(gasRelief.flowRegime, 'critical');
    assert.ok(gasRelief.requiredAreaMm2 > 1000 && gasRelief.requiredAreaMm2 < 2500, `Required area ${gasRelief.requiredAreaMm2} mm^2`);
    assert.ok(['L', 'M', 'N'].includes(gasRelief.selectedOrifice.letter), `Selected orifice ${gasRelief.selectedOrifice.letter}`);
    assert.ok(gasRelief.selectedOrifice.areaMm2 >= gasRelief.requiredAreaMm2, 'Selected orifice must exceed required area');
    assert.ok(gasRelief.marginPercent >= 0, 'Margin must be positive');
  });

  it('sizes liquid relief valve accurately per API 520 Section 5.8', () => {
    // 60 m3/h water relief (density 1000 kg/m^3, G = 1.0)
    // Set pressure 800 kPa(g), backpressure 0 kPa(g), 10% overpressure
    const liqRelief = engine.sizeLiquidRelief({
      volumetricFlowM3H: 60.0,
      setPressureKPaG: 800.0,
      overpressurePercent: 10,
      densityKgM3: 1000.0,
      viscosityCP: 1.0
    });

    assert.equal(liqRelief.service, 'liquid');
    assert.ok(liqRelief.requiredAreaMm2 > 500 && liqRelief.requiredAreaMm2 < 1500, `Required area ${liqRelief.requiredAreaMm2} mm^2`);
    assert.ok(['H', 'J', 'K'].includes(liqRelief.selectedOrifice.letter), `Selected orifice ${liqRelief.selectedOrifice.letter}`);
  });

  it('calculates API 521 fire case wetted surface heat input and required relief rate', () => {
    // Vertical vessel with 85 m^2 wetted surface area, bare vessel F=1.0, prompt firefighting
    // Latent heat delta H_vap = 350,000 J/kg
    const fire = engine.calculateFireCaseRelief({
      wettedSurfaceAreaM2: 85.0,
      environmentalFactorF: 1.0,
      hasPromptFirefighting: true,
      latentHeatOfVaporizationJ_Kg: 350000.0
    });

    // Q = 43200 * 1.0 * (85)^0.82
    // 85^0.82 ~ 38.28 -> Q ~ 1,653,800 W = 1.65 MW
    assert.ok(fire.heatAbsorptionKW > 1500 && fire.heatAbsorptionKW < 1800, `Heat absorption ${fire.heatAbsorptionKW} kW`);
    // W = (1.65e6 / 350000) * 3600 ~ 17,000 kg/h
    assert.ok(fire.requiredMassReliefRateKgH > 15000 && fire.requiredMassReliefRateKgH < 19000, `Mass flow ${fire.requiredMassReliefRateKgH} kg/h`);
  });

  it('selects multiple T orifices when required relief area exceeds single T orifice', () => {
    // Required area 30,000 mm^2 (T orifice is 16,774 mm^2 -> needs 2x T valves)
    const ori = engine.selectAPI526Orifice(30000.0);
    assert.ok(ori.letter.includes('Multiple'), `Must indicate multiple valves: ${ori.letter}`);
    assert.equal(ori.valvesRequired, 2, 'Must require 2 valves');
    assert.ok(ori.areaMm2 >= 30000.0, 'Total area must exceed 30,000 mm^2');
  });

  it('evaluates Leung omega two-phase flashing relief sizing', () => {
    const twoPhase = engine.sizeTwoPhaseLeung({
      massReliefRateKgH: 15000.0,
      setPressureKPaG: 1200.0,
      vaporMassFraction0: 0.15,
      liquidDensityKgM3: 750.0,
      vaporDensityKgM3: 25.0,
      latentHeatJ_Kg: 320000.0,
      temperatureK: 340.0
    });

    assert.equal(twoPhase.service, 'two_phase_flashing');
    assert.ok(twoPhase.omegaParameter > 0, 'Omega parameter must be positive');
    assert.ok(twoPhase.criticalPressureRatio > 0 && twoPhase.criticalPressureRatio < 1.0, 'Critical pressure ratio in (0, 1)');
    assert.ok(twoPhase.requiredAreaMm2 > 0, 'Required area must be positive');
    assert.ok(twoPhase.selectedOrifice, 'Must select API 526 orifice');
  });
});
