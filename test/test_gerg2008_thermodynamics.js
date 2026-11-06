'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Gerg2008Eos,
  GERG_COMPONENTS,
  MultiEosEngine,
  HydrateWaxFlowAssurance,
  PetroleumAssayBlender
} = require('../src/core/plant/plant_engineering_master_api');

test('GERG-2008 Natural Gas & Subcooled LNG Equation of State', () => {
  // 1. Natural gas mixture: 90% CH4, 6% C2H6, 2% C3H8, 2% N2 at 60 barg, 25 °C
  const naturalGas = {
    methane: 0.90,
    ethane: 0.06,
    propane: 0.02,
    nitrogen: 0.02
  };
  const gasState = Gerg2008Eos.evaluateState(60.0, 25.0, naturalGas, 'vapor');

  assert.equal(gasState.pressureBarg, 60.0);
  assert.equal(gasState.temperatureC, 25.0);
  assert.ok(gasState.compressibilityZ > 0.80 && gasState.compressibilityZ < 0.95, 'Gas Z factor in expected range');
  assert.ok(gasState.massDensityKgM3 > 45.0 && gasState.massDensityKgM3 < 65.0, 'Dense gas density');
  assert.equal(gasState.phaseDetermined, 'Vapor (Gas Phase)');

  // 2. Subcooled LNG: 94% CH4, 5% C2H6, 1% N2 at 1.15 barg, -162 °C
  const lng = {
    methane: 0.94,
    ethane: 0.05,
    nitrogen: 0.01
  };
  const lngState = Gerg2008Eos.evaluateState(1.15, -162.0, lng, 'liquid');

  assert.equal(lngState.temperatureC, -162.0);
  assert.ok(lngState.massDensityKgM3 > 420.0 && lngState.massDensityKgM3 < 460.0, 'LNG liquid density matches ~440 kg/m3');
  assert.equal(lngState.phaseDetermined, 'Liquid (Dense / Subcooled LNG)');
  assert.ok(lngState.speedOfSoundMS > 1000.0, 'Liquid sonic velocity > 1000 m/s');
});

test('Multi-EOS Cubic Engine & Rachford-Rice VLE Flash', () => {
  // Binary Methane (1) + Ethane (2)
  const components = [
    { id: 'CH4', Tc: 190.56, Pc: 4599.0, omega: 0.011 },
    { id: 'C2H6', Tc: 305.32, Pc: 4872.0, omega: 0.099 }
  ];
  const feed = [0.60, 0.40];

  // Perform flash at 30 barg, -30 °C
  const flashResult = MultiEosEngine.flashPT({
    components,
    feedMoleFractions: feed,
    pressureBarg: 30.0,
    temperatureC: -30.0,
    model: 'PR'
  });

  assert.ok(flashResult.vaporFractionPsi >= 0.0 && flashResult.vaporFractionPsi <= 1.0);
  assert.ok(flashResult.liquidCompressibilityZ_L > 0 && flashResult.liquidCompressibilityZ_L < 0.25);
  assert.ok(flashResult.vaporCompressibilityZ_V > 0.65 && flashResult.vaporCompressibilityZ_V < 0.95);
  // Methane enriches in vapor, ethane enriches in liquid
  assert.ok(flashResult.vaporMoleFractions[0] > flashResult.liquidMoleFractions[0], 'Vapor enriched in lighter component');
});

test('Flow Assurance: Hydrate Formation Prediction & MEG Dosing', () => {
  // Gas at 75 barg, SG = 0.65
  const Thyd = HydrateWaxFlowAssurance.predictHydrateFormationTempC(75.0, 0.65);
  assert.ok(Thyd > 12.0 && Thyd < 22.0, 'Hydrate formation temperature around 15-18 °C');

  // Inhibit for subsea pipeline at 4 °C
  const dosing = HydrateWaxFlowAssurance.calculateInhibitorDosing({
    operatingTempC: 4.0,
    pressureBarg: 75.0,
    gasSpecificGravity: 0.65,
    waterProductionKgH: 100.0,
    inhibitorType: 'MEG',
    safetyMarginC: 3.0
  });

  assert.equal(dosing.isHydrateRisk, true);
  assert.ok(dosing.requiredSuppressionDeltaTC > 10.0);
  assert.ok(dosing.requiredAqueousWeightPercent > 20.0 && dosing.requiredAqueousWeightPercent < 65.0);
  assert.ok(dosing.pureInhibitorRateKgH > 0);
});

test('Petroleum Assay Characterization & Pseudo-Components', () => {
  // ASTM D86 curve for light gas condensate
  const astmD86 = [
    { volumePercent: 0, tempC: 35.0 },
    { volumePercent: 10, tempC: 65.0 },
    { volumePercent: 30, tempC: 110.0 },
    { volumePercent: 50, tempC: 155.0 },
    { volumePercent: 70, tempC: 210.0 },
    { volumePercent: 90, tempC: 280.0 },
    { volumePercent: 100, tempC: 340.0 }
  ];

  const tbp = PetroleumAssayBlender.convertAstmD86ToTbp(astmD86);
  assert.equal(tbp.length, 7);

  const cuts = PetroleumAssayBlender.sliceAssayIntoCuts(tbp, 0.74, 4);
  assert.equal(cuts.length, 4);
  assert.ok(cuts[0].molecularWeight < cuts[3].molecularWeight, 'Higher cuts have larger molecular weight');
  assert.ok(cuts[0].Tc < cuts[3].Tc, 'Higher cuts have higher critical temperature');
});
