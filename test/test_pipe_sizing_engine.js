/**
 * Unit and Verification Tests for PipeSizingEngine.
 *
 * Verifies:
 * 1. Colebrook-White friction factor against standard Moody chart / Haaland reference.
 * 2. Darcy-Weisbach pressure drop and velocity for water pumping lines.
 * 3. Beggs-Brill multiphase holdup and pressure gradient calculation.
 * 4. ASME B31.3 Section 304.1.2 pipe wall thickness and MAWP for A106-B carbon steel.
 * 5. Automated line sizing matching standard industrial practice (e.g. 100 m3/h water pump line sizing to NPS 4 or 6).
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PipeSizingEngine,
  PIPE_SCHEDULE_DATABASE,
  SERVICE_VELOCITY_BOUNDS
} = require('../src/core/plant/pipe_sizing_engine');

describe('PipeSizingEngine: Industrial Hydraulic & Mechanical Line Sizing', () => {
  const engine = new PipeSizingEngine();

  it('calculates Colebrook-White friction factor accurately across flow regimes', () => {
    // 1. Laminar flow at Re = 1000: f = 64 / 1000 = 0.064
    const fLam = engine.calculateFrictionFactor(1000, 0.0000457, 0.1);
    assert.ok(Math.abs(fLam - 0.064) < 1e-4, `Laminar f=${fLam} expected 0.064`);

    // 2. Turbulent flow in smooth/commercial pipe at Re = 100,000, eps/D = 0.000457
    const fTurb = engine.calculateFrictionFactor(100000, 0.0000457, 0.1);
    // Typical Moody chart f is ~0.0195 to 0.0205
    assert.ok(fTurb > 0.018 && fTurb < 0.022, `Turbulent f=${fTurb} within expected range [0.018, 0.022]`);
  });

  it('computes Darcy-Weisbach single-phase liquid pressure drop correctly', () => {
    // 50 kg/s of water (density = 1000 kg/m^3, mu = 0.001 Pa*s) in 150 mm (NPS 6) line, L = 100 m
    const hydro = engine.calculateHydraulics({
      massFlowKgS: 50.0,
      densityKgM3: 1000.0,
      viscosityPaS: 0.001,
      innerDiameterM: 0.154, // Sch 40 ID
      lengthM: 100.0
    });

    // Velocity = Q / A = (0.05 m3/s) / (pi * 0.154^2 / 4) = 2.68 m/s
    assert.ok(Math.abs(hydro.velocityMS - 2.68) < 0.1, `Velocity ${hydro.velocityMS} m/s expected ~2.68 m/s`);
    assert.ok(hydro.reynoldsNumber > 300000, `Re ${hydro.reynoldsNumber} must be turbulent`);
    assert.ok(hydro.pressureDropBarPer100m > 0.05 && hydro.pressureDropBarPer100m < 0.6, `dP/100m = ${hydro.pressureDropBarPer100m} bar`);
  });

  it('evaluates API RP 14E erosional velocity limit', () => {
    // For gas with density 25 kg/m^3, C=122 -> ve = 122 / sqrt(25) = 24.4 m/s
    const veGas = engine.calculateErosionalVelocity(25.0, 122);
    assert.ok(Math.abs(veGas - 24.4) < 0.1, `ve = ${veGas} expected 24.4 m/s`);

    // For liquid with density 1000 kg/m^3, C=122 -> ve = 122 / sqrt(1000) = 3.85 m/s
    const veLiq = engine.calculateErosionalVelocity(1000.0, 122);
    assert.ok(Math.abs(veLiq - 3.86) < 0.1, `ve = ${veLiq} expected 3.86 m/s`);
  });

  it('calculates Beggs-Brill two-phase flow regime and liquid holdup', () => {
    const twoPhase = engine.calculateBeggsBrillTwoPhase({
      liquidMassFlowKgS: 10.0,
      gasMassFlowKgS: 1.0,
      liquidDensityKgM3: 850.0,
      gasDensityKgM3: 20.0,
      liquidViscosityPaS: 0.002,
      gasViscosityPaS: 0.000015,
      innerDiameterM: 0.1,
      lengthM: 100.0,
      inclinationAngleRad: 0
    });

    assert.ok(['segregated', 'transition', 'intermittent', 'distributed'].includes(twoPhase.flowPattern));
    assert.ok(twoPhase.liquidHoldup >= 0 && twoPhase.liquidHoldup <= 1.0, 'Liquid holdup must be in [0, 1]');
    assert.ok(twoPhase.mixtureVelocityMS > 0, 'Mixture velocity must be positive');
    assert.ok(twoPhase.pressureDropTotalBar > 0, 'Pressure drop must be positive');
  });

  it('performs ASME B31.3 Section 304.1.2 mechanical pipe wall thickness verification', () => {
    // NPS 6 (Do = 168.3 mm) at 50 bar design pressure (5.0 MPa), A106-B (S = 137.9 MPa), E=1.0, W=1.0, Y=0.4, ca = 1.5 mm
    const mech = engine.calculateASMEB313WallThickness({
      designPressurePa: 50e5,
      outerDiameterM: 0.1683,
      material: 'A106-B',
      corrosionAllowanceM: 0.0015,
      millTolerance: 0.125
    });

    // t_p = (5e6 * 0.1683) / (2 * (137.9e6 * 1.0 * 1.0 + 5e6 * 0.4))
    // Denom = 2 * (137.9e6 + 2.0e6) = 279.8e6 Pa
    // Numer = 841,500 Pa*m -> t_p = 841500 / 279.8e6 = 3.007e-3 m = 3.01 mm
    assert.ok(Math.abs(mech.pressureDesignThicknessMm - 3.01) < 0.1, `t_p = ${mech.pressureDesignThicknessMm} expected ~3.01 mm`);

    // t_min = 3.01 + 1.5 = 4.51 mm
    assert.ok(Math.abs(mech.minimumRequiredThicknessMm - 4.51) < 0.1, `t_min = ${mech.minimumRequiredThicknessMm}`);

    // t_nom_req = 4.51 / (1 - 0.125) = 5.15 mm
    assert.ok(Math.abs(mech.requiredNominalThicknessMm - 5.15) < 0.1, `t_nom_req = ${mech.requiredNominalThicknessMm}`);

    // Sch 40 wall is 7.11 mm (> 5.15 mm) -> MAWP of Sch 40 should be > 50 bar
    const mawpSch40 = mech.calculateMAWP(0.00711);
    assert.ok(mawpSch40 > 50e5, `MAWP ${mawpSch40 / 1e5} bar must exceed design pressure 50 bar`);
  });

  it('automatically sizes a process line satisfying hydraulic and mechanical limits', () => {
    // 35 kg/s water pump discharge (vol flow ~ 126 m3/h), design pressure 25 bar
    const sizing = engine.sizeLine({
      service: 'pump_discharge',
      massFlowKgS: 35.0,
      densityKgM3: 1000.0,
      viscosityPaS: 0.001,
      designPressureBar: 25.0,
      lengthM: 80.0
    });

    assert.ok(sizing.recommended, 'Must recommend a pipe size');
    assert.ok(sizing.recommended.compliant, 'Selected pipe must be fully compliant');
    // Typical sizing for 126 m3/h pump discharge is NPS 4 or NPS 6
    assert.ok(['4', '6'].includes(sizing.recommended.nps), `Recommended NPS ${sizing.recommended.nps} should be 4 or 6`);
    assert.ok(sizing.recommended.velocityMS <= 3.0, `Velocity ${sizing.recommended.velocityMS} m/s <= 3.0 m/s`);
    assert.ok(sizing.recommended.mawpBar >= 25.0, `MAWP ${sizing.recommended.mawpBar} bar >= 25.0 bar`);
  });
});
