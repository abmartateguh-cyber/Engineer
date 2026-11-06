'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ControlValveSizingIsa75,
  PsvApi520Api526Full,
  API_526_ORIFICES,
  ActuatorSizingDynamics,
  VALVE_TAXONOMY_CATALOG
} = require('../src/core/plant/plant_engineering_master_api');

test('Valve Taxonomy Catalog Completeness', () => {
  const keys = Object.keys(VALVE_TAXONOMY_CATALOG);
  assert.ok(keys.includes('ball_trunnion_api6d'));
  assert.ok(keys.includes('ball_cryogenic_extended'));
  assert.ok(keys.includes('butterfly_triple_offset'));
  assert.ok(keys.includes('check_dual_plate_wafer'));
  assert.ok(keys.includes('check_axial_nozzle_nonslam'));
  assert.ok(keys.includes('globe_control_cage_guided'));
  assert.ok(keys.includes('psv_spring_loaded_api526'));
  assert.ok(keys.includes('psv_pilot_operated_api526'));

  // Verify ISO/API ratings
  const tov = VALVE_TAXONOMY_CATALOG.butterfly_triple_offset;
  assert.equal(tov.category, 'Isolation & Throttling');
  assert.ok(tov.recoveryFactorFL >= 0.70);
});

test('ISA-75.01 / IEC 60534 Liquid Sizing (Subcritical & Choked Cavitation)', () => {
  // Subcritical flow
  const subcritical = ControlValveSizingIsa75.sizeLiquid({
    flowRateM3H: 250.0,
    inletPressureBarg: 15.0,
    outletPressureBarg: 10.0,
    vaporPressureBarg: 0.1,
    criticalPressureBarg: 220.0,
    densityKgM3: 1000.0,
    valveRecoveryFactorFL: 0.90
  });

  assert.equal(subcritical.isChoked, false);
  assert.ok(subcritical.calculatedCv > 100.0);
  assert.ok(subcritical.cavitationIndexSigma > 2.5);

  // Severe pressure drop -> Choked cavitation
  const choked = ControlValveSizingIsa75.sizeLiquid({
    flowRateM3H: 250.0,
    inletPressureBarg: 100.0,
    outletPressureBarg: 5.0,
    vaporPressureBarg: 1.0,
    criticalPressureBarg: 220.0,
    densityKgM3: 1000.0,
    valveRecoveryFactorFL: 0.85
  });

  assert.equal(choked.isChoked, true);
  assert.ok(choked.effectiveDeltaPBar < choked.actualDeltaPBar);
  assert.match(choked.flowRegime, /Cavitation/i);
});

test('ISA-75.01 Compressible Gas Sizing (Choked Flow & Expansion Factor Y)', () => {
  const gas = ControlValveSizingIsa75.sizeGas({
    massFlowKgH: 150000.0,
    inletPressureBarg: 60.0,
    outletPressureBarg: 10.0,
    inletTempC: 30.0,
    molecularWeight: 18.0,
    compressibilityZ: 0.88,
    specificHeatRatioGamma: 1.30,
    pressureDropRatioFactorXT: 0.72
  });

  assert.ok(gas.calculatedCv > 0);
  assert.ok(gas.expansionFactorY >= 0.66 && gas.expansionFactorY <= 1.0);
  assert.equal(gas.isChoked, true, 'High pressure drop ratio x > xT results in sonic choke');
});

test('API 520 & API 526 Relief Valve Sizing (Standard Orifice Selection)', () => {
  // Gas overpressure relief
  const gasPsv = PsvApi520Api526Full.sizeGasVapor({
    reliefRateKgH: 120000.0,
    setPressureBarg: 50.0,
    overpressurePercent: 10.0,
    backpressureBarg: 2.0,
    relievingTempC: 45.0,
    molecularWeight: 19.5,
    compressibilityZ: 0.90,
    specificHeatRatioGamma: 1.28
  });

  assert.ok(gasPsv.requiredAreaMm2 > 0);
  assert.ok(['L', 'M', 'N', 'P', 'Q', 'R', 'T'].includes(gasPsv.selectedOrifice));
  assert.ok(gasPsv.selectedOrificeAreaMm2 >= gasPsv.requiredAreaMm2);

  // Liquid relief
  const liqPsv = PsvApi520Api526Full.sizeLiquid({
    reliefRateM3H: 80.0,
    setPressureBarg: 25.0,
    liquidDensityKgM3: 850.0
  });

  assert.ok(liqPsv.requiredAreaMm2 > 0);
  assert.ok(liqPsv.selectedOrificeAreaMm2 >= liqPsv.requiredAreaMm2);
});

test('Actuator Torque & Thrust Sizing Dynamics', () => {
  // 12" Trunnion Ball Valve at 100 bar delta-P
  const rotary = ActuatorSizingDynamics.sizeRotaryActuator({
    valveType: 'ball',
    valveSizeIn: 12.0,
    maxShutoffDeltaPBar: 100.0,
    safetyFactor: 1.50
  });

  assert.ok(rotary.breakawayTorqueBTONm > 5000.0);
  assert.ok(rotary.minimumActuatorTorqueNm >= rotary.breakawayTorqueBTONm * 1.5);
  assert.equal(rotary.recommendedIso5211Mount, 'F35');

  // Linear Globe Valve 4" seat at 60 bar delta-P
  const linear = ActuatorSizingDynamics.sizeLinearActuator({
    seatBoreDiameterMm: 100.0,
    stemDiameterMm: 25.0,
    maxShutoffDeltaPBar: 60.0,
    internalOperatingPressureBarg: 60.0,
    isBalancedPlug: false
  });

  assert.ok(linear.governingDesignThrustN > 50000.0); // > 50 kN thrust
  assert.ok(linear.recommendedPneumaticDiaphragmAreaCm2 > 1000.0);
});
