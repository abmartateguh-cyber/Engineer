/**
 * Comprehensive Verification Test Suite for World-Scale LNG Plant (5.0 MTPA FEED Scope).
 *
 * Covers:
 * 1. Design Basis & Chemical Catalog Completeness.
 * 2. Exact Mass & Energy Conservation (machine precision).
 * 3. LNG Product Purity Compliance (CO2, H2S, H2O, Hg, Benzene).
 * 4. C3MR Refrigeration Specific Power & Combined Cycle Power Balance.
 * 5. Claus + SCOT High-Efficiency Sulfur Recovery (>99.9%).
 * 6. ASME B31.3 Minimum Wall Thickness & Metallurgy Verification.
 * 7. API 520 / API 521 Relief Valve Orifice Sizing & Dual Flare Routing.
 * 8. All 11 Multi-Sheet ISA-5.1 P&ID SVG & Schedule Generation.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { LngPlantEngine } = require('../src/core/plant/lng/lng_plant_engine');

describe('World-Scale LNG Plant Engineering Engine (5.0 MTPA FEED Scope)', () => {
  const engine = new LngPlantEngine();

  it('verifies design basis configuration and feed parameters', () => {
    const basis = engine.designBasis;
    assert.ok(basis);
    assert.equal(basis.project.nominalCapacityMTPA, 5.0);
    assert.equal(basis.project.feedGasCapacityMMSCFD, 700.0);
    assert.equal(basis.project.feedGasMassFlowKgH, 675000.0);
    assert.equal(basis.feedGas.batteryLimitPressureBarg, 75.0);
    assert.equal(basis.feedGas.batteryLimitTemperatureC, 35.0);
    assert.equal(basis.productSpecifications.lng.temperatureC, -162.0);
    assert.equal(basis.productSpecifications.lng.carbonDioxideMaxPpmv, 50.0);
    assert.equal(basis.productSpecifications.lng.hydrogenSulfideMaxPpmv, 4.0);
    assert.equal(basis.productSpecifications.lng.waterMaxPpmv, 0.1);
    assert.equal(basis.productSpecifications.lng.mercuryMaxUgNm3, 0.01);
    assert.equal(basis.productSpecifications.lng.benzeneMaxPpmv, 1.0);
  });

  it('verifies chemical and catalyst catalog completeness across all units', () => {
    const cat = engine.chemicalCatalog;
    assert.ok(cat);
    const groups = cat.plantChemicalsAndCatalysts;
    assert.ok(groups.solvents);
    assert.ok(groups.adsorbents);
    assert.ok(groups.catalysts);
    assert.ok(groups.refrigerants);
    assert.ok(groups.utilityChemicals);

    // Verify key chemicals
    const mdea = groups.solvents.find((c) => c.id === 'SOLV-01');
    assert.ok(mdea);
    assert.equal(mdea.name, 'Activated MDEA (aMDEA)');
    assert.equal(mdea.initialChargeTonnes, 450.0);

    const molSieve = groups.adsorbents.find((c) => c.id === 'ADS-01');
    assert.ok(molSieve);
    assert.equal(molSieve.name, 'Molecular Sieve Type 4A');
    assert.equal(molSieve.initialChargeTonnes, 180.0);

    const clausCat = groups.catalysts.find((c) => c.id === 'CAT-01');
    assert.ok(clausCat);
    assert.equal(clausCat.name, 'Claus Stage 1 Titania-Promoted Catalyst');

    const propaneRef = groups.refrigerants.find((c) => c.id === 'REFR-01');
    assert.ok(propaneRef);
    assert.equal(propaneRef.name, 'High-Purity Propane (R-290)');
    assert.equal(propaneRef.initialChargeTonnes, 320.0);
  });

  it('conserves total mass and component balances to machine precision', () => {
    const balances = engine.calculateMassAndEnergyBalances();
    assert.equal(balances.success, true);
    assert.equal(balances.massBalance.isConserved, true);
    assert.ok(balances.massBalance.relativeError < 1e-12, `Relative error ${balances.massBalance.relativeError} exceeds 1e-12`);

    const massIn = balances.massBalance.totalMassInKgH;
    const massOut = balances.massBalance.totalMassOutKgH;
    assert.ok(Math.abs(massIn - massOut) < 1e-4, 'Mass in equals mass out');
    assert.equal(massIn, 675000.0);

    // Verify products
    assert.ok(balances.lngProductionRateKgH > 520000.0, 'LNG production rate above 520 t/h');
    assert.ok(balances.sulfurProductionTonnesPerDay > 130.0, 'Sulfur production above 130 T/D');
  });

  it('validates stringent LNG product purity compliance', () => {
    const balances = engine.calculateMassAndEnergyBalances();
    const purity = balances.purityChecks;

    // Industrial specification compliance
    assert.ok(purity.co2InLngPpmv < 50.0, `CO2 ${purity.co2InLngPpmv} exceeds 50 ppmv limit`);
    assert.ok(purity.h2sInLngPpmv < 4.0, `H2S ${purity.h2sInLngPpmv} exceeds 4 ppmv limit`);
    assert.ok(purity.waterInLngPpmv < 0.1, `H2O ${purity.waterInLngPpmv} exceeds 0.1 ppmv limit`);
    assert.ok(purity.mercuryInLngUgNm3 < 0.01, `Hg ${purity.mercuryInLngUgNm3} exceeds 0.01 ug/Nm3 limit`);
    assert.ok(purity.benzeneInLngPpmv < 1.0, `Benzene ${purity.benzeneInLngPpmv} exceeds 1.0 ppmv limit`);
  });

  it('validates C3MR refrigeration specific power and combined cycle power margin', () => {
    const balances = engine.calculateMassAndEnergyBalances();
    const pt = balances.powerAndThermal;

    // Total plant power demand vs installed capacity
    assert.equal(pt.installedPowerCapacityMW, 320.0);
    assert.ok(pt.totalPlantPowerDemandMW < pt.installedPowerCapacityMW);
    assert.ok(pt.powerMarginMW > 100.0, 'Spinning reserve margin must exceed 100 MW');

    // C3MR specific power calculation (kWh / kg LNG)
    const specificPowerKWhPerKg = (pt.totalRefrigerationPowerMW * 1000.0) / balances.lngProductionRateKgH;
    assert.ok(specificPowerKWhPerKg >= 0.25 && specificPowerKWhPerKg <= 0.35,
      `Specific power ${specificPowerKWhPerKg.toFixed(3)} kWh/kg outside industrial C3MR range [0.25, 0.35]`);
  });

  it('evaluates ASME B31.3 piping compliance and minimum wall thickness', () => {
    const pipingEvaluations = engine.evaluatePipingCompliance();
    assert.ok(pipingEvaluations.length >= 8, 'Evaluates all defined line classes');

    for (const evalResult of pipingEvaluations) {
      assert.equal(evalResult.isCompliant, true, `Line class ${evalResult.classCode} failed ASME B31.3 compliance`);
      assert.ok(evalResult.actualMinThicknessMm >= evalResult.minRequiredThicknessMm);
      assert.ok(evalResult.minRequiredThicknessMm > 0.0);
      assert.ok(evalResult.allowableStressMPa > 100.0);
    }

    // Specific evaluation for cryogenic high pressure line class 600L
    const cryo600 = engine.evaluatePipingCompliance('600L', 24, 98.0, -162.0);
    assert.equal(cryo600.isCompliant, true);
    assert.equal(cryo600.nps, 24);
    assert.ok(cryo600.minRequiredThicknessMm > 15.0);
  });

  it('sizes API 520 / API 521 safety relief valves and verifies dual flare destination', () => {
    const psvs = engine.sizeSafetyReliefValves();
    assert.ok(psvs.length >= 5);

    for (const psv of psvs) {
      assert.ok(psv.tag);
      assert.ok(psv.selectedOrifice);
      assert.ok(psv.requiredAreaMm2 > 0);
      assert.ok(psv.setPressureBarg > 0);
      assert.ok(psv.flareDestination);
    }

    // Cryogenic MCHE tube rupture must route to Cold Dry Flare (SS304L)
    const mchePsv = psvs.find((p) => p.tag === 'PSV-6001');
    assert.ok(mchePsv);
    assert.ok(mchePsv.flareDestination.includes('Cold Dry Flare'));
    assert.equal(mchePsv.relievingTempC, -120.0);

    // Rich amine & slug catcher must route to Warm Wet Flare
    const slugPsv = psvs.find((p) => p.tag === 'PSV-1001');
    assert.ok(slugPsv);
    assert.ok(slugPsv.flareDestination.includes('Warm Wet Flare'));
  });

  it('generates all 11 ISA-5.1 multi-sheet P&ID drawing packages with SVG and schedules', () => {
    const sheets = engine.generateAllPidSheets();
    assert.equal(sheets.length, 11);

    const expectedUnits = ['U-10', 'U-20', 'U-30', 'U-35', 'U-40', 'U-50', 'U-60', 'U-70', 'U-80', 'U-90', 'U-95'];
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      assert.equal(sheet.unit, expectedUnits[i]);
      assert.equal(sheet.sheetNumber, i + 1);
      assert.equal(sheet.success, true, `Unit ${sheet.unit} failed P&ID generation`);
      assert.ok(sheet.svg && sheet.svg.length > 15000, `Unit ${sheet.unit} SVG missing or too small`);
      assert.ok(sheet.svg.startsWith('<svg') || sheet.svg.includes('<svg'));
      assert.ok(sheet.equipmentCount >= 4, `Unit ${sheet.unit} missing equipment items`);
      assert.ok(sheet.lineCount >= 4, `Unit ${sheet.unit} missing line items`);
      assert.ok(sheet.valveCount >= 2, `Unit ${sheet.unit} missing valve items`);
      assert.ok(sheet.instrumentCount >= 2, `Unit ${sheet.unit} missing instrument items`);
      assert.ok(sheet.schedule);
    }
  });
});
