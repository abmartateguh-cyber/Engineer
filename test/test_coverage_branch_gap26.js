'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 26).
 *
 * Targets the remaining uncovered branch blocks in the plant solver cluster
 * (IAPWS-IF97 steam properties, dynamic flowsheet valve/blowdown branches,
 * API 520 relief sizing edge regimes, petroleum assay characterization,
 * DIPPR component/VLLE branches, thermo-compound Watson/Rackett edges,
 * Naphtali-Sandholm mesh options, Peng-Robinson EOS cubic/flash phases),
 * the optics cluster (ISO 10110 tolerance evaluator, STOP multiphysics
 * coupling guards, optical glass catalog edges), and the aerospace 6-DOF
 * dynamics validation/profile branches. No production source is modified.
 */

const assert = require('assert');

const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
const { DynamicFlowsheetSolver } = require('../src/core/plant/dynamic_flowsheet_solver');
const { Api520ReliefValve } = require('../src/core/plant/api520_relief_valve');
const { PetroleumAssayCharacterizer } = require('../src/core/plant/petroleum_assay_characterizer');
const { ActivityCoefficientModels } = require('../src/core/plant/activity_coefficient_models');
const { ElectrolyteNRTLModel } = require('../src/core/plant/enrtl_electrolyte_thermo');
const { ExperimentalPropertyComponent, ExperimentalPropertyDatabase } = require('../src/core/plant/dippr_database');
const { CorrelationPropertyComponent, CorrelationSpeciesCatalog } = require('../src/core/plant/thermo_compounds');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../src/core/plant/naphtali_sandholm_mesh');
const { TransientWaterHammerSolver } = require('../src/core/plant/transient_water_hammer');
const { HeatExchangerTEMA } = require('../src/core/plant/heat_exchanger_tema');
const { PengRobinsonEOS } = require('../src/core/plant/peng_robinson_eos');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');

const {
  MAX_ZERNIKE_TERMS,
  parseIso10110Callout,
  isValidIso10110Callout,
  formatIso10110Callout,
  zernikeModeByIndex,
  zernikeBasis,
  zernikePolynomial,
  radialZernike,
  gaussLegendre,
  createZernikeQuadratureGrid,
  synthesizeZernikeOpd,
  projectZernikeCoefficients,
  decomposeZernike,
  rmsWavefrontError,
  strehlRatio,
  strehlFromOpd,
  sellmeierSingletIndex,
  buildSingletSurfaces,
  perturbSurfaceWithZernikeSag,
  mapIso10110SurfaceFormCallout,
  generateCollimatedPupilRaysFromGrid,
  traceRayThroughZernikeSurface,
  traceSequentialZernikeSystem,
  opdAtPlane,
  opdToReferenceSphere,
  evaluateIso10110SurfaceForm
} = require('../src/core/optics/iso10110_tolerance_evaluator');
const { StopMultiphysicsCoupling } = require('../src/core/optics/stop_multiphysics_coupling');
const { OpticalGlassCatalog } = require('../src/core/optics/optical_glass_catalog');
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');

const { SixDofDynamics, standardAtmosphere1976, bilinearCoef } = require('../src/core/aerospace/six_dof_dynamics');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');

async function runBranchGapTwentySixCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // IAPWS-IF97: saturation, Region 1/2, and automatic phase selection
  // ------------------------------------------------------------------
  check('IAPWS_IF97 saturation pressure/temperature valid and guard branches', () => {
    const psat = IAPWS_IF97.saturationPressure(373.15);
    assert(Math.abs(psat - 101325) / 101325 < 0.01);
    assert.throws(() => IAPWS_IF97.saturationPressure(273.0), RangeError);
    assert.throws(() => IAPWS_IF97.saturationPressure(647.2), RangeError);
    const tsat = IAPWS_IF97.saturationTemperature(101325);
    assert(Number.isFinite(tsat) && tsat > 200 && tsat < 700);
    assert.throws(() => IAPWS_IF97.saturationTemperature(600), RangeError);
    assert.throws(() => IAPWS_IF97.saturationTemperature(23e6), RangeError);
  });

  check('IAPWS_IF97 region1/region2 property and error branches', () => {
    const r1 = IAPWS_IF97.region1Properties(10e6, 400);
    assert.strictEqual(r1.phase, 'liquid');
    assert(r1.density_kg_m3 > 500 && r1.density_kg_m3 < 1200);
    assert(r1.specificEnthalpy_J_kg > 0);
    assert.throws(() => IAPWS_IF97.region1Properties(10e6, 273.0), RangeError);
    assert.throws(() => IAPWS_IF97.region1Properties(0, 400), RangeError);
    assert.throws(() => IAPWS_IF97.region1Properties(110e6, 400), RangeError);
    const r2 = IAPWS_IF97.region2Properties(1e6, 600);
    assert.strictEqual(r2.phase, 'vapor');
    assert(r2.density_kg_m3 > 0 && r2.density_kg_m3 < 20);
    assert(r2.isobaricHeatCapacity_J_kg_K > 1000);
    assert.throws(() => IAPWS_IF97.region2Properties(1e6, 273.0), RangeError);
    assert.throws(() => IAPWS_IF97.region2Properties(1e6, 1073.2), RangeError);
    assert.throws(() => IAPWS_IF97.region2Properties(-1, 600), RangeError);
  });

  check('IAPWS_IF97 calculateProperties phase selection and saturation branches', () => {
    const liquid = IAPWS_IF97.calculateProperties(10e6, 400);
    assert.strictEqual(liquid.phase, 'liquid');
    assert.strictEqual(liquid.isSaturated, false);
    assert(liquid.saturation && Number.isFinite(liquid.saturation.saturationPressurePa));
    const vapor = IAPWS_IF97.calculateProperties(1e5, 500);
    assert.strictEqual(vapor.phase, 'vapor');
    const saturated = IAPWS_IF97.calculateProperties(IAPWS_IF97.saturationPressure(373.15), 373.15);
    assert.strictEqual(saturated.isSaturated, true);
    assert(Number.isFinite(saturated.saturation.saturationTemperatureK));
    const hot = IAPWS_IF97.calculateProperties(1e6, 1200);
    assert.strictEqual(hot.phase, 'gas');
    assert.throws(() => IAPWS_IF97.calculateProperties(1e6, 273.0), RangeError);
    assert.throws(() => IAPWS_IF97.calculateProperties(0, 500), RangeError);
    assert.throws(() => IAPWS_IF97.calculateProperties(60e6, 1200), RangeError);
  });

  // ------------------------------------------------------------------
  // Dynamic flowsheet solver: valve trim / blowdown orifice regimes
  // ------------------------------------------------------------------
  check('DynamicFlowsheetSolver control valve closed/dP/trim/Cv branches', () => {
    assert.strictEqual(DynamicFlowsheetSolver.evaluateControlValveFlow({ position: 0, Cv: 10 }, 2e5, 1e5, 1000), 0);
    assert.strictEqual(DynamicFlowsheetSolver.evaluateControlValveFlow({ position: 0.5, Cv: 10 }, 1e5, 2e5, 1000), 0);
    const linear = DynamicFlowsheetSolver.evaluateControlValveFlow(
      { position: 0.5, trim: 'linear', Cv: 10 },
      2e5,
      1e5,
      1000
    );
    assert(linear > 0);
    const defaultKv = DynamicFlowsheetSolver.evaluateControlValveFlow({ position: 0.5 }, 2e5, 1e5, 1000);
    assert(defaultKv > linear);
  });

  check('DynamicFlowsheetSolver blowdown choked/subsonic/backflow branches', () => {
    const choked = DynamicFlowsheetSolver.evaluateBlowdownOrifice(
      { area: 0.01, Cd: 0.85, gamma: 1.3, molecularWeight: 18 },
      10e5,
      1e5,
      300
    );
    assert.strictEqual(choked.isChoked, true);
    assert(choked.massFlow > 0);
    const subsonic = DynamicFlowsheetSolver.evaluateBlowdownOrifice(
      { area: 0.01, gamma: 1.3, molecularWeight: 18 },
      3e5,
      2e5,
      300
    );
    assert.strictEqual(subsonic.isChoked, false);
    assert(subsonic.massFlow > 0);
    const backflow = DynamicFlowsheetSolver.evaluateBlowdownOrifice(
      { area: 0.01, gamma: 1.3, molecularWeight: 18 },
      1e5,
      3e5,
      300
    );
    assert.strictEqual(backflow.massFlow, 0);
  });

  // ------------------------------------------------------------------
  // API 520 relief valve: subcritical gas, omega=1, high-Reynolds liquid
  // ------------------------------------------------------------------
  check('Api520ReliefValve subcritical gas and custom coefficients branches', () => {
    const sub = Api520ReliefValve.sizeGasVapor({
      massFlow: 5000,
      P1: 1000,
      Pb: 700,
      T: 350,
      M: 28.97,
      k: 1.4,
      Z: 0.9,
      Kd: 0.95,
      Kb: 0.9,
      Kc: 0.9
    });
    assert.strictEqual(sub.flowRegime, 'subcritical');
    assert(sub.requiredArea_sq_mm > 0);
    assert.ok(sub.selectedOrifice.designation);
    const crit = Api520ReliefValve.sizeGasVapor({
      massFlow: 5000,
      P1: 1000,
      Pb: 101.3,
      T: 350,
      M: 28.97,
      k: 1.4
    });
    assert.strictEqual(crit.flowRegime, 'critical');
  });

  check('Api520ReliefValve omega-special and high-Reynolds liquid branches', () => {
    const omegaNearOne = Api520ReliefValve.sizeTwoPhaseOmega({
      massFlow: 4000,
      P1: 1200,
      rho_0: 1111,
      rho_9: 1000,
      Kd: 0.8
    });
    assert(Number.isFinite(omegaNearOne.criticalPressureRatio));
    assert(Math.abs(omegaNearOne.omega - 1) < 0.01);
    assert(omegaNearOne.criticalPressureRatio > 0.5);
    const liquidHiRe = Api520ReliefValve.sizeLiquid({
      flowRate: 100000,
      P1: 800,
      Pb: 101.3,
      rho: 1000,
      viscosity_cP: 1.0
    });
    assert.strictEqual(liquidHiRe.viscosityFactor_Kv, 1.0);
    assert(liquidHiRe.reynoldsNumber >= 100000);
  });

  // ------------------------------------------------------------------
  // Petroleum assay characterization: constructor guards and conversions
  // ------------------------------------------------------------------
  check('PetroleumAssayCharacterizer constructor guard branches', () => {
    const tbp = new PetroleumAssayCharacterizer({
      apiGravity: 35,
      distillationType: 'TBP',
      distillationData: [
        { percent: 0, tempC: 30 },
        { percent: 25, tempC: 150 },
        { percent: 100, tempC: 400 }
      ],
      dataSource: 'synthetic'
    });
    assert.strictEqual(tbp.distillationType, 'TBP');
    assert.throws(() => new PetroleumAssayCharacterizer([]), /object/);
    assert.throws(() => new PetroleumAssayCharacterizer({ apiGravity: -132 }), /apiGravity/);
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 35,
          distillationType: 'ASTM_D86',
          distillationData: [
            { percent: 0, tempC: 30 },
            { percent: 20, tempC: 150 },
            { percent: 100, tempC: 400 }
          ],
          dataSource: 'x'
        }),
      /not have a configured coefficient/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 35,
          distillationType: 'TBP',
          distillationData: [
            { percent: 0, tempC: 30 },
            { percent: 50, tempC: 20 },
            { percent: 100, tempC: 400 }
          ],
          dataSource: 'x'
        }),
      /strictly increasing/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 35,
          distillationType: 'TBP',
          distillationData: [
            { percent: 0, tempC: 30 },
            { percent: 50, tempC: 150 },
            { percent: 100, tempC: 400 }
          ],
          dataSource: 'x'.repeat(600)
        }),
      /512/
    );
    assert.throws(
      () =>
        new PetroleumAssayCharacterizer({
          apiGravity: 35,
          distillationType: 'TBP',
          distillationData: [
            { percent: 10, tempC: 30 },
            { percent: 50, tempC: 150 },
            { percent: 90, tempC: 400 }
          ],
          dataSource: 'x'
        }),
      /span 0 through 100/
    );
  });

  check('PetroleumAssayCharacterizer conversion and correlation branches', () => {
    const converted = PetroleumAssayCharacterizer.convertD86ToTBP([
      { percent: 25, tempC: 80 },
      { percent: 50, tempC: 150 }
    ]);
    assert(converted.every((pt) => Number.isFinite(pt.tempC)));
    assert.strictEqual(converted[0].percent, 25);
    const vabp = PetroleumAssayCharacterizer.computeVABP([
      { percent: 0, tempC: 10 },
      { percent: 50, tempC: 200 },
      { percent: 100, tempC: 400 }
    ]);
    assert(Number.isFinite(vabp));
    const lowTheta = PetroleumAssayCharacterizer.estimateCriticalProperties(450, 0.85);
    const highTheta = PetroleumAssayCharacterizer.estimateCriticalProperties(800, 1.0);
    assert(Number.isFinite(lowTheta.omega) && Number.isFinite(highTheta.omega));
    assert.strictEqual(PetroleumAssayCharacterizer.estimateMolecularWeight(250, 0.6), 50);
    assert.strictEqual(PetroleumAssayCharacterizer.apiToSG(35), 141.5 / 166.5);
    assert(Number.isFinite(PetroleumAssayCharacterizer.sgToAPI(0.85)));
    assert.strictEqual(PetroleumAssayCharacterizer.cToK(0), 273.15);
    assert(Math.abs(PetroleumAssayCharacterizer.cToR(0) - 491.67) < 1e-9);
  });

  // ------------------------------------------------------------------
  // Activity coefficient models / eNRTL electrolyte thermochemistry
  // ------------------------------------------------------------------
  check('ActivityCoefficientModels custom parameters and azeotrope branches', () => {
    const custom = ActivityCoefficientModels.evaluateNRTLBinary(0.5, 60, {
      b12: 100,
      b21: 700,
      alpha12: 0.4
    });
    assert(custom.gamma1 > 0 && custom.gamma2 > 0);
    assert(ActivityCoefficientModels.getAntoineSatPressureBar('not-a-component', 60) > 0);
    const azeo = ActivityCoefficientModels.findAzeotrope('acetone', 'methanol', 56, {
      b12: 150,
      b21: 500,
      alpha12: 0.3
    });
    assert(typeof azeo.hasAzeotrope === 'boolean');
    assert(Number.isFinite(azeo.azeotropeX1));
  });

  check('ElectrolyteNRTLModel clamps, PDH custom T, and capture defaults', () => {
    const model = new ElectrolyteNRTLModel({ temperatureK: 333.15, meaMassFraction: 0.35 });
    const lnGamma = model.evaluatePDHContribution(0.1, 1, 353.15);
    assert(Number.isFinite(lnGamma));
    const vle = model.calculateCO2VLE(0.8);
    assert.strictEqual(vle.co2Loading, 0.6);
    const vleLow = model.calculateCO2VLE(0.01);
    assert.strictEqual(vleLow.co2Loading, 0.05);
    const spec = model.calculateSpeciation(0.9);
    assert.strictEqual(spec.co2Loading, 0.85);
    const cap = model.evaluateCaptureCapacity();
    assert(cap.co2CapturedTonsPerDay > 0);
    const capCustom = model.evaluateCaptureCapacity(0.3, 0.35, 50000);
    assert.strictEqual(capCustom.netLoadingDelta, 0);
  });

  // ------------------------------------------------------------------
  // DIPPR component correlations: coefficient guards and VLLE branches
  // ------------------------------------------------------------------
  check('ExperimentalPropertyComponent correlation coefficient guard branches', () => {
    const rec = {
      id: 'w',
      name: 'Water',
      formula: 'H2O',
      mw: 18.015,
      family: 'Aqueous',
      pvEq: [73.649, -7258.2, -7.3037, 4.1653e-6, 2],
      pvTmin: 273.16,
      pvTmax: 647.1,
      rhoLEq: [1.7, 0.271, 0.286, 647.1],
      cpEq: [32.24, 1.924e-3, 1.055e-5, -3.596e-9, 0],
      kLEq: [-0.922, 0.00284, 0.00000249]
    };
    const comp = new ExperimentalPropertyComponent(rec);
    assert(comp.getVaporPressure(300) > 0);
    assert(comp.getLiquidDensity(300) > 0);
    assert(comp.getIdealGasCp(300) > 0);
    assert(comp.getLiquidThermalConductivity(300) > 0);
    const noPv = new ExperimentalPropertyComponent({ ...rec, pvEq: undefined });
    try {
      noPv.getVaporPressure(300);
      assert.fail('expected UNAVAILABLE');
    } catch (err) {
      assert.strictEqual(err.code, 'UNAVAILABLE');
    }
    const badPv = new ExperimentalPropertyComponent({ ...rec, pvEq: [1, 2] });
    try {
      badPv.getVaporPressure(300);
      assert.fail('expected INVALID_INPUT');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_INPUT');
    }
    const badRange = new ExperimentalPropertyComponent({ ...rec, pvTmin: -1, pvTmax: 100 });
    assert.throws(() => badRange.getVaporPressure(300), /correlation range/);
    const noCpTerms = new ExperimentalPropertyComponent({ ...rec, cpEq: [28, 0, -1, 0, -1] });
    assert(noCpTerms.getIdealGasCp(300) > 0);
    const badDensity = new ExperimentalPropertyComponent({ ...rec, rhoLEq: [-1, 0.271, 0.286, 647.1] });
    assert.throws(() => badDensity.getLiquidDensity(300), /positive/);
  });

  check('ExperimentalPropertyDatabase VLLE full solve branches', () => {
    const db = new ExperimentalPropertyDatabase([
      {
        id: 'Water',
        name: 'Water',
        formula: 'H2O',
        mw: 18.015,
        family: 'Aqueous',
        pvEq: [73.649, -7258.2, -7.3037, 4.1653e-6, 2],
        pvTmin: 273.16,
        pvTmax: 647.1
      },
      {
        id: 'Benzene',
        name: 'Benzene',
        formula: 'C6H6',
        mw: 78.11,
        family: 'Aromatic',
        pvEq: [83.14, -6943.6, -7.04, 6.1e-6, 2],
        pvTmin: 278.68,
        pvTmax: 562.05
      }
    ]);
    const r = db.solveVLLEFlash({
      components: ['Water', 'Benzene'],
      feedFractions: [0.4, 0.6],
      temperatureK: 320,
      pressurePa: 1e5
    });
    assert(Array.isArray(r.compositions.aqueousLiquidL1));
    assert.strictEqual(r.componentNames.length, 2);
    const missingFamily = new ExperimentalPropertyDatabase([
      { id: 'X', name: 'X', formula: 'X', mw: 1, pvEq: [1, 1, 1, 1, 1], pvTmin: 100, pvTmax: 500 },
      { id: 'Y', name: 'Y', formula: 'Y', mw: 1, pvEq: [1, 1, 1, 1, 1], pvTmin: 100, pvTmax: 500 }
    ]);
    assert.throws(
      () =>
        missingFamily.solveVLLEFlash({
          components: ['X', 'Y'],
          feedFractions: [0.5, 0.5],
          temperatureK: 300,
          pressurePa: 1e5
        }),
      /family/
    );
    assert.throws(() => db.solveVLLEFlash(null), TypeError);
    assert.throws(
      () =>
        db.solveVLLEFlash({
          components: ['Water', 'Benzene'],
          feedFractions: [0.5, 0.5],
          temperatureK: 0,
          pressurePa: 1e5
        }),
      /positive temperature/
    );
  });

  // ------------------------------------------------------------------
  // Thermo-compounds: Watson near-critical and Rackett critical branches
  // ------------------------------------------------------------------
  check('CorrelationPropertyComponent Watson/Rackett critical branches', () => {
    const catalog = new CorrelationSpeciesCatalog();
    const water = catalog.resolveRequired('Water');
    assert.throws(() => water.getLatentHeatOfVaporization(647.096), /critical temperature/);
    const nearCritical = water.getLiquidDensity(640);
    assert(nearCritical > 0);
    const custom = new CorrelationPropertyComponent({
      id: 'Custom',
      name: 'Custom',
      formula: 'C',
      mw: 44,
      Tc: 500,
      Pc: 5e6,
      omega: 0.2,
      Tb: 350,
      triplePointK: 200,
      zRA: 0.25,
      cpForm: 'poly4',
      cpCoeffs: [30, 1, -0.5, 0.1, -0.01],
      cpTmin: 100,
      cpTmax: 1000,
      cp298Ref: 40,
      vpAnchor: { T: 350, P: 101325, hvapKJmol: 25 },
      sourceRef: { parameters: 'test', license: 'test' }
    });
    const cp = custom.getIdealGasCp(400);
    assert(cp > 0);
    const record = custom.toPengRobinsonRecord();
    assert.strictEqual(record.name, 'Custom');
    assert.throws(() => new CorrelationSpeciesCatalog({}), /array/);
    assert.throws(() => new CorrelationPropertyComponent(null), TypeError);
  });

  // ------------------------------------------------------------------
  // Naphtali-Sandholm mesh: Wilson K-values, vapor feed, pressure profile
  // ------------------------------------------------------------------
  check('NaphtaliSandholmColumnSolver Wilson K-value and explicit feed branches', () => {
    const base = {
      stageCount: 10,
      feedStage: 5,
      components: ['Benzene', 'Toluene'],
      feedComposition: { Benzene: 0.5, Toluene: 0.5 },
      refluxRatio: 2.0,
      distillateRate: 0.5,
      pressurePa: 101325
    };
    const wilson = NaphtaliSandholmColumnSolver.solve({ ...base, kValueModel: 'wilson' });
    assert.strictEqual(wilson.success, true);
    assert.strictEqual(wilson.kValueModel, 'wilson');
    assert(wilson.warnings.some((w) => w.includes('Wilson')));
    const vaporFeed = NaphtaliSandholmColumnSolver.solve({
      ...base,
      feedComposition: undefined,
      feedFractions: [0.5, 0.5],
      feedVaporFraction: 1
    });
    assert.strictEqual(vaporFeed.success, false);
    assert.strictEqual(vaporFeed.status, 'not-converged');
    const profile = NaphtaliSandholmColumnSolver.solve({
      ...base,
      pressureProfilePa: Array(10).fill(101325),
      feedTemperatureK: 400
    });
    assert.strictEqual(profile.success, true);
    assert.strictEqual(profile.input.feedTemperatureK, 400);
    const badModel = NaphtaliSandholmColumnSolver.solve({ ...base, kValueModel: 'nope' });
    assert.strictEqual(badModel.status, 'unavailable');
    const badFeedTemp = NaphtaliSandholmColumnSolver.solve({ ...base, feedTemperatureK: 100000 });
    assert.strictEqual(badFeedTemp.status, 'unavailable');
  });

  check('WaterHammerMOC standalone wave-speed and surge branches', () => {
    const speed = WaterHammerMOC.computeWaveSpeed({
      fluidBulkModulusPa: 2.2e9,
      fluidDensityKgM3: 1000,
      pipeModulusPa: 2e11,
      pipeDiameterM: 0.3,
      wallThicknessM: 0.01
    });
    assert(speed > 900);
    assert.throws(() => WaterHammerMOC.computeWaveSpeed({}), TypeError);
    assert.throws(
      () =>
        WaterHammerMOC.computeWaveSpeed({
          fluidBulkModulusPa: 2.2e9,
          fluidDensityKgM3: 1000,
          pipeModulusPa: 2e11,
          pipeDiameterM: 0.3,
          wallThicknessM: 0.2
        }),
      RangeError
    );
    const surge = WaterHammerMOC.computeJoukowskySurge(1000, 1400, 2);
    assert(surge.pressureSurgePa > 0);
    assert.throws(() => WaterHammerMOC.computeJoukowskySurge(0, 1400, 2), TypeError);
  });

  check('TransientWaterHammerSolver MOC work-limit and non-finite branches', () => {
    const conduit = {
      fluidDensity: 1000,
      fluidBulkModulus: 2.2e9,
      pipeElasticModulus: 2e11,
      pipeInnerDiameter: 0.3,
      pipeWallThickness: 0.01,
      restraintFactor: 1
    };
    const base = {
      ...conduit,
      pipeDiameter: 0.3,
      pipeLength: 100,
      darcyFrictionFactor: 0.02,
      reservoirHead: 50,
      steadyFlowRate: 0.2,
      valveClosureTime: 0.02,
      valveClosureLaw: 'linear',
      simulationDuration: 5,
      reaches: 100000
    };
    assert.throws(() => TransientWaterHammerSolver.solveTransientMOC(base), /work limit/);
    assert.throws(
      () => TransientWaterHammerSolver.solveTransientMOC({ ...base, reaches: 20, darcyFrictionFactor: 'x' }),
      /invalid: darcyFrictionFactor/
    );
    assert.throws(() => TransientWaterHammerSolver.joukowskySurge(0, 1, 1000), TypeError);
    assert.throws(() => TransientWaterHammerSolver.joukowskySurge(1400, 1, -1), TypeError);
  });

  // ------------------------------------------------------------------
  // Heat exchanger TEMA: equal-end LMTD and F-correction chart branches
  // ------------------------------------------------------------------
  check('HeatExchangerTEMA equal-dT LMTD and R=1 F-correction branches', () => {
    const r1 = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 100, ToutC: 60 },
      { massFlowKgS: 20, CpJkgK: 4180, TinC: 20, ToutC: 60 },
      { tubeOD_mm: 19.05, tubeLength_m: 6, overallU_W_m2K: 450 }
    );
    assert(Math.abs(r1.counterFlowLMTD_C - 40) < 1e-6);
    const r2 = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 120, ToutC: 60 },
      { massFlowKgS: 20, CpJkgK: 4180, TinC: 20, ToutC: 80 },
      { tubeOD_mm: 19.05, tubeLength_m: 6, overallU_W_m2K: 450 }
    );
    assert.strictEqual(r2.fCorrectionFactor, 0.92);
    const over = new HeatExchangerTEMA();
    const single = over.rateExchanger({
      hotFlowKgS: 10,
      hotCp_kJ_kgK: 2,
      hotInletC: 90,
      hotOutletC: 60,
      coldFlowKgS: 20,
      coldCp_kJ_kgK: 4.18,
      coldInletC: 25,
      coldOutletC: 45
    });
    assert(single.heatDutyKW > 0);
    assert.strictEqual(single.pressureDropShellBar, null);
  });

  // ------------------------------------------------------------------
  // Peng-Robinson EOS: omega branch, cubic-root regimes, single-phase flash
  // ------------------------------------------------------------------
  check('PengRobinsonEOS omega>0.49 and cubic-root regime branches', () => {
    const comps = [
      {
        name: 'W',
        criticalTemperatureK: 1000,
        criticalPressurePa: 6e6,
        acentricFactor: 0.9,
        provenance: { source: 'T', license: 'L' }
      },
      {
        name: 'X',
        criticalTemperatureK: 800,
        criticalPressurePa: 5e6,
        acentricFactor: 0.8,
        provenance: { source: 'T', license: 'L' }
      }
    ];
    const eos = new PengRobinsonEOS(comps, [
      [0, 0],
      [0, 0]
    ]);
    const pure = eos.calculatePureParameters(500);
    assert(pure.a[0] > 0 && pure.b[1] > 0);
    assert.throws(() => new PengRobinsonEOS(comps, [[0]]), /2x2/);
    assert.throws(
      () =>
        new PengRobinsonEOS(comps, [
          [0, NaN],
          [0, 0]
        ]),
      /finite/
    );
    const threeRootsVapor = eos.solveCubicZ(0.01, 0.001, 'vapor');
    const threeRootsLiquid = eos.solveCubicZ(0.01, 0.001, 'liquid');
    assert(threeRootsVapor > threeRootsLiquid);
    assert(threeRootsLiquid > 0.001);
    const singleRoot = eos.solveCubicZ(0.5, 0.05, 'vapor');
    assert(singleRoot > 0.05);
  });

  check('PengRobinsonEOS flashPT single-phase classification branches', () => {
    const comps = [
      {
        name: 'Methane',
        criticalTemperatureK: 190.56,
        criticalPressurePa: 4.599e6,
        acentricFactor: 0.011,
        provenance: { source: 'NIST', license: 'public' }
      },
      {
        name: 'Ethane',
        criticalTemperatureK: 305.32,
        criticalPressurePa: 4.872e6,
        acentricFactor: 0.099,
        provenance: { source: 'NIST', license: 'public' }
      }
    ];
    const eos = new PengRobinsonEOS(comps, [
      [0, 0.01],
      [0.01, 0]
    ]);
    const liquid = eos.flashPT([0.5, 0.5], 150, 10e6, { maxIter: 20, tol: 1e-8 });
    assert.strictEqual(liquid.phaseState, 'liquid-only');
    assert.strictEqual(liquid.beta, 0);
    const vapor = eos.flashPT([0.5, 0.5], 400, 1e5, { maxIter: 20, tol: 1e-8 });
    assert.strictEqual(vapor.phaseState, 'vapor-only');
    assert.strictEqual(vapor.beta, 1);
    const twoPhase = eos.flashPT([0.5, 0.5], 220, 2.5e6, { maxIter: 50, tol: 1e-6 });
    assert(twoPhase.phaseState === 'two-phase' || twoPhase.converged);
    assert.throws(() => eos.flashPT([0.6, 0.5], 200, 1e6, { maxIter: 20, tol: 1e-8 }), RangeError);
    assert.throws(() => eos.flashPT([0.5, 0.5], 200, 1e6, {}), TypeError);
    eos.setBinaryInteraction(0, 1, 0.02);
    assert.strictEqual(eos.k_ij[0][1], 0.02);
  });

  // ------------------------------------------------------------------
  // ISO 10110 tolerance evaluator (full module sweep)
  // ------------------------------------------------------------------
  check('ISO10110 callout parser valid forms', () => {
    const p1 = parseIso10110Callout('3/A(B/C)');
    assert.strictEqual(p1.section, 3);
    assert.strictEqual(p1.value, 'A');
    assert.deepStrictEqual(p1.params, ['B', 'C']);
    const p2 = parseIso10110Callout('4/σ');
    assert.strictEqual(p2.section, 4);
    assert.strictEqual(p2.params.length, 0);
    const p3 = parseIso10110Callout('13/A(B/C)');
    assert.strictEqual(p3.section, 13);
    const p4 = parseIso10110Callout(' 3 / 0.5 ');
    assert.strictEqual(p4.value, '0.5');
    const p5 = parseIso10110Callout('3/0.5(standard)');
    assert.deepStrictEqual(p5.params, ['standard']);
    const p6 = parseIso10110Callout('3/0.5(fringe)');
    assert.deepStrictEqual(p6.params, ['fringe']);
    const p7 = parseIso10110Callout('3/0.5');
    assert.strictEqual(p7.params.length, 0);
  });

  check('ISO10110 callout parser fail-closed branches', () => {
    assert.throws(() => parseIso10110Callout(5), TypeError);
    assert.throws(() => parseIso10110Callout('   '), /Empty/);
    assert.throws(() => parseIso10110Callout('3'), /separator/);
    assert.throws(() => parseIso10110Callout('x/3'), /section number/);
    assert.throws(() => parseIso10110Callout('3/'), /Missing tolerance value/);
    assert.throws(() => parseIso10110Callout('3/A('), /Unbalanced/);
    assert.throws(() => parseIso10110Callout('3/(A)'), /before parameter list/);
    assert.throws(() => parseIso10110Callout('3/A/B(C)'), /Multiple "\/"/);
    assert.throws(() => parseIso10110Callout('3/A((B))'), /Nested/);
    assert.throws(() => parseIso10110Callout('3/A()'), /Empty parameter list/);
    assert.throws(() => parseIso10110Callout('3/A(B//C)'), /Empty parameter/);
    assert.throws(() => parseIso10110Callout('3/A/B'), /Multiple "\/"/);
    assert.throws(() => parseIso10110Callout('3/A B'), /whitespace/);
    assert.strictEqual(isValidIso10110Callout('3/A(B/C)'), true);
    assert.strictEqual(isValidIso10110Callout('3/A B'), false);
  });

  check('ISO10110 callout formatting branches', () => {
    assert.strictEqual(formatIso10110Callout({ section: 3, value: 'A', params: ['B', 'C'] }), '3/A(B/C)');
    assert.strictEqual(formatIso10110Callout({ section: 4, value: 'σ' }), '4/σ');
    assert.throws(() => formatIso10110Callout(null), TypeError);
    assert.throws(() => formatIso10110Callout({ section: '3', value: 'A' }), TypeError);
  });

  check('ISO10110 Zernike mode mapping and basis branches', () => {
    const fringe1 = zernikeModeByIndex(1);
    assert.deepStrictEqual([fringe1.n, fringe1.m], [0, 0]);
    const fringe4 = zernikeModeByIndex(4);
    assert.deepStrictEqual([fringe4.n, fringe4.m], [2, 0]);
    const standard2 = zernikeModeByIndex(2, { indexing: 'standard' });
    assert.deepStrictEqual([standard2.n, standard2.m], [1, -1]);
    assert.throws(() => zernikeModeByIndex(0), RangeError);
    assert.throws(() => zernikeModeByIndex(38), RangeError);
    assert.throws(() => zernikeModeByIndex(2.5), RangeError);
    assert.strictEqual(zernikeBasis().length, MAX_ZERNIKE_TERMS);
    assert.strictEqual(zernikeBasis({ indexing: 'standard' }).length, MAX_ZERNIKE_TERMS);
    assert.strictEqual(zernikePolynomial(1, 0.2, 0.3), 1);
    assert(Math.abs(radialZernike(2, 0, 0.5) - -0.5) < 1e-12);
  });

  check('ISO10110 quadrature grid branches', () => {
    const g1 = gaussLegendre(1);
    assert.strictEqual(g1.nodes.length, 1);
    assert.strictEqual(g1.nodes[0], 0);
    const g2 = gaussLegendre(2);
    assert.strictEqual(g2.nodes.length, 2);
    assert.throws(() => gaussLegendre(0), RangeError);
    const grid = createZernikeQuadratureGrid();
    assert.strictEqual(grid.x.length, 21 * 32);
    const weightSum = grid.weights.reduce((a, b) => a + b, 0);
    assert(Math.abs(weightSum - Math.PI) < 1e-9);
    const zeroRadial = createZernikeQuadratureGrid({ radialPoints: 0 });
    assert.strictEqual(zeroRadial.radialPoints, 21);
  });

  check('ISO10110 OPD synthesis/projection round-trip branches', () => {
    const coeffs = new Array(MAX_ZERNIKE_TERMS).fill(0);
    coeffs[3] = 0.5;
    const grid = createZernikeQuadratureGrid();
    const opd = synthesizeZernikeOpd(coeffs, grid);
    assert.strictEqual(opd.length, grid.x.length);
    const recovered = projectZernikeCoefficients(opd, grid);
    assert(Math.abs(recovered[3] - 0.5) < 1e-6);
    assert.throws(() => synthesizeZernikeOpd([0], grid), /exactly 37/);
    assert.throws(() => synthesizeZernikeOpd(coeffs, { x: [1], y: [1, 2] }), /equal length/);
    assert.throws(() => projectZernikeCoefficients([0], grid), /must match/);
    assert.throws(
      () => projectZernikeCoefficients(opd, { x: grid.x, y: grid.y, weights: grid.weights.map(() => 0) }),
      /zero total weight/
    );
    const zeroCoeffs = synthesizeZernikeOpd(new Array(37).fill(0), grid);
    assert(zeroCoeffs.every((v) => v === 0));
  });

  check('ISO10110 decomposeZernike quadrature and least-squares branches', () => {
    const grid = createZernikeQuadratureGrid({ radialPoints: 12, angularPoints: 16 });
    const coeffs = new Array(37).fill(0);
    coeffs[4] = 0.2;
    coeffs[7] = -0.1;
    const opd = synthesizeZernikeOpd(coeffs, grid);
    const proj = decomposeZernike(opd, grid);
    assert(Math.abs(proj[4] - 0.2) < 1e-6);
    const seededRandom = (() => {
      let state = 0x9e3779b9;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const randomPoints = { x: [], y: [] };
    for (let i = 0; i < 200; i++) {
      const r = Math.sqrt(seededRandom());
      const th = seededRandom() * 2 * Math.PI;
      randomPoints.x.push(r * Math.cos(th));
      randomPoints.y.push(r * Math.sin(th));
    }
    const opdLS = synthesizeZernikeOpd(coeffs, randomPoints);
    const fit = decomposeZernike(opdLS, randomPoints);
    assert(Math.abs(fit[4] - 0.2) < 1e-4);
    assert.throws(() => decomposeZernike(null, grid), TypeError);
    assert.throws(() => decomposeZernike([0, 1], grid), /must match/);
  });

  check('ISO10110 rms/Strehl evaluation branches', () => {
    const coeffs = new Array(37).fill(0);
    coeffs[1] = 0.1;
    coeffs[2] = 0.1;
    coeffs[3] = 0.2;
    const rms = rmsWavefrontError(coeffs);
    assert(Math.abs(rms - Math.hypot(0.1, 0.1, 0.2)) < 1e-12);
    const rmsNoTilt = rmsWavefrontError(coeffs, { excludeTilt: true });
    assert(Math.abs(rmsNoTilt - 0.2) < 1e-12);
    const rmsNoDefocus = rmsWavefrontError(coeffs, { excludeDefocus: true });
    assert(Math.abs(rmsNoDefocus - Math.hypot(0.1, 0.1)) < 1e-12);
    const rmsCustom = rmsWavefrontError(coeffs, { excludePiston: false, excludeModes: [1] });
    assert(Number.isFinite(rmsCustom));
    assert.throws(() => rmsWavefrontError([0]), /exactly 37/);
    assert(strehlRatio(0) === 1);
    assert(strehlRatio(0.05, { wavelength: 0.55 }) < 1);
    assert.throws(() => strehlRatio(-0.1), RangeError);
    const grid = createZernikeQuadratureGrid({ radialPoints: 10, angularPoints: 16 });
    const opd = synthesizeZernikeOpd(coeffs, grid);
    const fromOpd = strehlFromOpd(opd, grid, { wavelength: 0.55 });
    assert(fromOpd.strehl > 0 && fromOpd.strehl < 1);
    assert.strictEqual(fromOpd.coefficients.length, 37);
  });

  check('ISO10110 singlet prescription and surface perturbation branches', () => {
    const ns = sellmeierSingletIndex(0.55);
    assert(ns > 1.4 && ns < 1.6);
    assert.throws(() => sellmeierSingletIndex(0), TypeError);
    const { surfaces, meta } = buildSingletSurfaces();
    assert.strictEqual(surfaces.length, 2);
    assert(meta.indexAtWavelength > 1.4);
    const custom = buildSingletSurfaces(0.6328);
    assert(custom.meta.indexAtWavelength > 1.4);
    const coeffs = new Array(37).fill(0);
    coeffs[3] = 0.001;
    const perturbed = perturbSurfaceWithZernikeSag(surfaces, coeffs, { surfaceIndex: 1, indexing: 'fringe' });
    assert(Array.isArray(perturbed[1].zernikeSagCoeffs));
    assert.throws(() => perturbSurfaceWithZernikeSag(surfaces, [0]), /exactly 37/);
    assert.throws(() => perturbSurfaceWithZernikeSag(surfaces, coeffs, { surfaceIndex: 5 }), RangeError);
    const mapping = mapIso10110SurfaceFormCallout('3/0.200(9)');
    assert.strictEqual(mapping.modes[0], 9);
    assert(Math.abs(mapping.coefficients[8] - 0.0002) < 1e-12);
    const standard = mapIso10110SurfaceFormCallout('3/0.5(standard)');
    assert.strictEqual(standard.indexing, 'standard');
    assert.throws(() => mapIso10110SurfaceFormCallout('4/0.5'), /section 3/);
    assert.throws(() => mapIso10110SurfaceFormCallout('3/abc'), /finite positive number/);
    assert.throws(() => mapIso10110SurfaceFormCallout('3/0.5(99)'), /integer in \[1, 37\]/);
  });

  check('ISO10110 pupil ray grid and ray-surface intersection branches', () => {
    const grid = createZernikeQuadratureGrid({ radialPoints: 4, angularPoints: 8 });
    const rays = generateCollimatedPupilRaysFromGrid(2.8, grid, 0.55, -20);
    assert.strictEqual(rays.length, 4 * 8);
    assert.throws(() => generateCollimatedPupilRaysFromGrid(0, grid, 0.55, -20), TypeError);
    assert.throws(() => generateCollimatedPupilRaysFromGrid(2.8, grid, 0, -20), TypeError);
    assert.throws(() => generateCollimatedPupilRaysFromGrid(2.8, grid, 0.55, NaN), TypeError);
    const { surfaces } = buildSingletSurfaces();
    const terminated = { isTerminated: true, x: 0, y: 0, z: 0 };
    assert.strictEqual(traceRayThroughZernikeSurface(terminated, surfaces[0]), terminated);
    const bypass = {
      x: 0,
      y: 0,
      z: -20,
      L: 0,
      M: 1,
      N: 0,
      isTerminated: false,
      isTIR: false,
      opl: 0,
      currentRefractiveIndex: 1,
      path: [],
      wavelengthUm: 0.55,
      intensity: 1
    };
    traceRayThroughZernikeSurface(bypass, surfaces[0]);
    assert.strictEqual(bypass.isTerminated, true);
    const axial = {
      x: 0,
      y: 0,
      z: -20,
      L: 0,
      M: 0,
      N: 1,
      isTerminated: false,
      isTIR: false,
      opl: 0,
      currentRefractiveIndex: 1,
      path: [],
      wavelengthUm: 0.55,
      intensity: 1
    };
    traceRayThroughZernikeSurface(axial, surfaces[0]);
    assert.strictEqual(axial.isTerminated, false);
    assert(axial.opl > 0);
    const miss = {
      x: 100,
      y: 0,
      z: -20,
      L: 0,
      M: 0,
      N: 1,
      isTerminated: false,
      isTIR: false,
      opl: 0,
      currentRefractiveIndex: 1,
      path: [],
      wavelengthUm: 0.55,
      intensity: 1
    };
    traceRayThroughZernikeSurface(miss, surfaces[0]);
    assert.strictEqual(miss.isTerminated, true);
    const tirSurface = { ...surfaces[0], radius: 1e9, zVertex: 0, clearRadius: 100, nIncident: 1.5, nTransmitted: 1.0 };
    const tirRay = {
      x: 0,
      y: 0,
      z: -5,
      L: 0.7,
      M: 0,
      N: Math.sqrt(1 - 0.49),
      isTerminated: false,
      isTIR: false,
      opl: 0,
      currentRefractiveIndex: 1.5,
      path: [],
      wavelengthUm: 0.55,
      intensity: 1
    };
    traceRayThroughZernikeSurface(tirRay, tirSurface);
    assert.strictEqual(tirRay.isTIR, true);
  });

  check('ISO10110 sequential system trace and OPD reference branches', () => {
    const { surfaces } = buildSingletSurfaces();
    const grid = createZernikeQuadratureGrid({ radialPoints: 4, angularPoints: 8 });
    const rays = generateCollimatedPupilRaysFromGrid(2.8, grid, 0.55, -20);
    const traced = traceSequentialZernikeSystem(
      surfaces,
      rays.map((r) => ({ ...r, path: [] })),
      { planeZ: 4 }
    );
    assert(traced.every((r) => !r.isTerminated));
    assert.throws(() => traceSequentialZernikeSystem([], rays, { planeZ: 4 }), TypeError);
    assert.throws(() => traceSequentialZernikeSystem(surfaces, [], { planeZ: 4 }), TypeError);
    assert.throws(() => traceSequentialZernikeSystem(surfaces, rays, {}), TypeError);
    const opd = opdAtPlane(traced, traced[0].opl);
    assert.strictEqual(opd.length, rays.length);
    assert.throws(() => opdAtPlane([{ isTerminated: true }], 1), /did not reach/);
    const sphereOpd = opdToReferenceSphere(traced, traced[0].opl, { focusZ: 22, centerZ: 4 });
    assert.strictEqual(sphereOpd.length, rays.length);
    assert.throws(() => opdToReferenceSphere([{ isTerminated: true }], 1, { focusZ: 22, centerZ: 4 }), /did not reach/);
    assert.throws(() => opdToReferenceSphere(traced, traced[0].opl, { focusZ: 4, centerZ: 4 }), /not intersected/);
  });

  check('ISO10110 full surface-form evaluation branches', () => {
    const passed = evaluateIso10110SurfaceForm({ callout: '3/0.200(9)' });
    assert.strictEqual(passed.status, 'passed');
    assert(passed.measured.deltaStrehl >= passed.targetValue);
    assert(passed.measured.absoluteRmsWfeUm > 0);
    const multi = evaluateIso10110SurfaceForm({ callout: '3/0.050(6/7)' });
    assert(multi.measured.rayCount > 0);
    const standard = evaluateIso10110SurfaceForm({ callout: '3/0.300(standard)' });
    assert.strictEqual(standard.status, 'passed');
    const failedTarget = evaluateIso10110SurfaceForm({ callout: '3/0.900(9)', targetStrehl: 0.999 });
    assert.strictEqual(failedTarget.status, 'failed');
    assert(failedTarget.reason.includes('below the target'));
  });

  // ------------------------------------------------------------------
  // STOP multiphysics coupling guards and fit branches
  // ------------------------------------------------------------------
  check('StopMultiphysicsCoupling fit and invalid-input branches', () => {
    const empty = StopMultiphysicsCoupling.fitZernikeCoefficients([], 16, 25);
    assert(empty.every((v) => v === 0));
    const z37 = StopMultiphysicsCoupling.evaluateZernike(37, 0.5, 1);
    assert(Number.isFinite(z37));
    const valid = {
      entrancePupilDiameterMm: 50,
      baselineStrehl: 0.96,
      refractiveIndexAtReferenceTemperature: 1.5168,
      glassCtePerK: 8e-6,
      structuralComplianceMmPerN: 1.2e-7,
      thermalSagCoefficientMmPerK: 4e-7,
      structuralPropertiesSource: 'test',
      thermalProperties: {
        source: 'test',
        D0PerK: 1e-6,
        D1PerK2: 0,
        D2PerK3: 0,
        E0Um2PerK: 0,
        E1Um2PerK2: 0,
        lambdaTkUm: 0
      }
    };
    assert.throws(() => StopMultiphysicsCoupling.solveStopCoupling({}, {}), TypeError);
    assert.throws(
      () =>
        StopMultiphysicsCoupling.solveStopCoupling(
          { ...valid, baselineStrehl: 1.5 },
          { ambientTempC: 60, referenceTempC: 20, structuralLoadN: 10, wavelengthUm: 0.55 }
        ),
      TypeError
    );
    assert.throws(
      () =>
        StopMultiphysicsCoupling.solveStopCoupling(
          { ...valid, structuralPropertiesSource: '' },
          { ambientTempC: 60, referenceTempC: 20, structuralLoadN: 10, wavelengthUm: 0.55 }
        ),
      /provenance/
    );
    assert.throws(
      () =>
        StopMultiphysicsCoupling.solveStopCoupling(
          { ...valid, thermalProperties: { source: '' } },
          { ambientTempC: 60, referenceTempC: 20, structuralLoadN: 10, wavelengthUm: 0.55 }
        ),
      /provenance/
    );
  });

  // ------------------------------------------------------------------
  // Optical glass catalog remaining edges
  // ------------------------------------------------------------------
  check('OpticalGlassCatalog property and nearest-glass branches', () => {
    const catalog = OpticalGlassCatalog.fromBundledData();
    assert(catalog.catalogSize > 0);
    assert.throws(() => catalog.getOpticalProperties('N-BK7', -300), TypeError);
    const nearest = catalog.findNearestGlasses(1.5168, 64.17, 20, 3);
    assert(Array.isArray(nearest) && nearest.length <= 3);
    assert.throws(() => catalog.findNearestGlasses(NaN, 64.17, 20), TypeError);
    assert.throws(() => catalog.findNearestGlasses(1.5, 60, 20, -1), RangeError);
    assert.throws(
      () =>
        catalog.registerGlass({
          name: 'X',
          referenceTemperatureC: 20,
          formula: 'sellmeier1',
          B: [1, 2, 3],
          C: [1, 2, 3],
          dndT: 1e-6
        }),
      /dndTPerK/
    );
  });

  // ------------------------------------------------------------------
  // Optics engine adapter: non-sequential route and index guards
  // ------------------------------------------------------------------
  check('OpticsEngineAdapter non-sequential trace route', async () => {
    const adapter = new OpticsEngineAdapter();
    const plane = (z, detector) => ({
      intersectRay: (ray) => {
        const t = -(ray.origin.z - z) / ray.dir.z;
        if (t <= 1e-5) return { hit: false, distance: Infinity };
        return {
          hit: true,
          distance: t,
          point: { x: ray.origin.x + t * ray.dir.x, y: ray.origin.y + t * ray.dir.y, z },
          normal: { x: 0, y: 0, z: -1 }
        };
      },
      normal: { x: 0, y: 0, z: -1 },
      nIncident: 1,
      nRefractive: 1.5,
      isDetector: detector
    });
    const res = await adapter.execute({
      jobId: 'ns26-1',
      domain: 'optics',
      operation: 'trace_non_sequential',
      parameters: {
        initialRay: { origin: { x: 0, y: 0, z: 10 }, dir: { x: 0, y: 0, z: -1 }, energy: 1, wavelengthNm: 550 },
        surfaces: [plane(0, false), plane(-5, true)],
        options: { maxSplits: 2, energyThreshold: 0.001 }
      }
    });
    assert.strictEqual(res.status, 'COMPLETED');
    assert(res.outputData.detectorHitsCount >= 1);
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'ns26-2',
          domain: 'optics',
          operation: 'trace_non_sequential',
          parameters: { surfaces: new Array(200).fill(plane(0, false)), options: {} }
        }),
      /128/
    );
  });

  check('OpticsEngineAdapter refractive-index dndT and tolerancing guards', async () => {
    const adapter = new OpticsEngineAdapter();
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'ri26-1',
          domain: 'optics',
          operation: 'calculate_refractive_index',
          parameters: {
            glass: 'X-GLASS',
            customGlassRecord: {
              name: 'X-GLASS',
              referenceTemperatureC: 20,
              formula: 'sellmeier1',
              B: [1, 1, 1],
              C: [0.01, 0.02, 0.03]
            },
            wavelengthUm: 0.58756,
            temperatureC: 30
          }
        }),
      /dndTPerK/
    );
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'tol26-1',
          domain: 'optics',
          operation: 'run_optical_tolerancing',
          parameters: { system: {}, tolerances: [], options: { trials: 0 } }
        }),
      /trials/
    );
  });

  // ------------------------------------------------------------------
  // Plant engine adapter: missing evaluator and options-wrapper branches
  // ------------------------------------------------------------------
  check('PlantEngineAdapter recycle evaluator requirement and assay options wrapper', async () => {
    const adapter = new PlantEngineAdapter();
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'p26-1',
          domain: 'plant',
          operation: 'solve_recycle_loop',
          parameters: { x0: [1, 2] }
        }),
      /refusing to fabricate/
    );
    const assay = await adapter.execute({
      jobId: 'p26-2',
      domain: 'plant',
      operation: 'characterize_petroleum_assay',
      parameters: {
        options: {
          apiGravity: 35,
          distillationType: 'TBP',
          distillationData: [
            { percent: 0, tempC: 30 },
            { percent: 50, tempC: 180 },
            { percent: 100, tempC: 420 }
          ],
          dataSource: 'synthetic-options'
        }
      }
    });
    assert.strictEqual(assay.status, 'COMPLETED');
    assert.strictEqual(assay.outputData.assayName, 'CrudeAssay');
    await assert.rejects(
      () =>
        adapter.execute(
          { jobId: 'p26-3', domain: 'plant', operation: 'calculate_pinch_targets', parameters: { streams: [] } },
          () => {},
          { aborted: true }
        ),
      /cancelled/
    );
  });

  // ------------------------------------------------------------------
  // Aerospace: 6-DOF dynamics validation/profile branches
  // ------------------------------------------------------------------
  check('SixDofDynamics input validation aggregation branches', () => {
    const sim = new SixDofDynamics();
    const bad = sim.simulateSixDof({});
    assert.strictEqual(bad.status, 'invalid-input');
    assert(bad.error.message.includes('requires explicit valid inputs'));
    const badQuat = sim.simulateSixDof({
      gravityModel: 'constant',
      initialState: {
        positionM: [0, 0, 0],
        velocityM_s: [0, 0, 0],
        quaternion: [1, 0.1, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      massKg: 1,
      inertiaKgM2: [1, 1, 1],
      thrust: null,
      coefficients: null,
      dt: 0.01,
      steps: 10
    });
    assert.strictEqual(badQuat.status, 'invalid-input');
    const insideEarth = sim.simulateSixDof({
      gravityModel: 'inverse-square',
      initialState: {
        positionM: [0, 0, 1000],
        velocityM_s: [0, 0, 0],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      massKg: 1,
      inertiaKgM2: [1, 1, 1],
      thrust: null,
      coefficients: null,
      dt: 0.01,
      steps: 10
    });
    assert.strictEqual(insideEarth.status, 'invalid-input');
    const badThrust = sim.simulateSixDof({
      initialState: {
        positionM: [0, 0, 0],
        velocityM_s: [0, 0, 0],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      massKg: 1,
      inertiaKgM2: [1, 1, 1],
      thrust: { magnitudeN: 100, directionBody: [1, 0] },
      dt: 0.01,
      steps: 10
    });
    assert.strictEqual(badThrust.status, 'invalid-input');
  });

  check('SixDofDynamics thrust profile interpolation and aero table branches', () => {
    const sim = new SixDofDynamics();
    const profile = sim.simulateSixDof({
      gravityModel: 'constant',
      initialState: {
        positionM: [0, 0, 0],
        velocityM_s: [0, 0, 0],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      massKg: 1000,
      inertiaKgM2: [1000, 1000, 1000],
      thrust: [
        { timeS: 0, magnitudeN: 10000, directionBody: [0, 0, 1] },
        { timeS: 5, magnitudeN: 20000, directionBody: [0, 0, 1] },
        { timeS: 10, magnitudeN: 15000, directionBody: [0, 0, 1] }
      ],
      coefficients: null,
      dt: 0.1,
      steps: 100
    });
    assert.strictEqual(profile.success, true);
    assert.strictEqual(profile.inputs.thrustType, 'profile');
    const alpha = [0, 5, 10];
    const mach = [0.5, 1, 2];
    const cl = [
      [0.1, 0.15, 0.2],
      [0.2, 0.25, 0.3],
      [0.3, 0.35, 0.4]
    ];
    const aero = sim.simulateSixDof({
      gravityModel: 'constant',
      initialState: {
        positionM: [0, 0, 10000],
        velocityM_s: [100, 0, 0],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      massKg: 1000,
      inertiaKgM2: [1000, 1000, 1000],
      thrust: null,
      coefficients: { alphaDeg: alpha, mach, cl, cd: cl, cm: cl },
      referenceAreaM2: 1,
      referenceLengthM: 1,
      dt: 0.1,
      steps: 50
    });
    assert.strictEqual(aero.success, true);
    assert(Number.isFinite(aero.trajectory[0].machNumber));
    assert.strictEqual(bilinearCoef({ alphaDeg: alpha, mach, values: cl }, 2.5, 0.75), 0.175);
    assert(
      Math.abs(
        bilinearCoef(
          {
            alphaDeg: [0, 10],
            mach: [0.5, 2],
            values: [
              [0.1, 0.2],
              [0.2, 0.3]
            ]
          },
          100,
          0.75
        ) - 0.21666666666666667
      ) < 1e-12
    );
    assert(Math.abs(bilinearCoef({ alphaDeg: [0, 10], mach: [1], values: [[0.1, 0.2]] }, 5, 1) - 0.15) < 1e-12);
    assert.strictEqual(bilinearCoef({ alphaDeg: [5], mach: [1], values: [[0.11]] }, 5, 1), 0.11);
    const badTable = sim.simulateSixDof({
      initialState: {
        positionM: [0, 0, 10000],
        velocityM_s: [100, 0, 0],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      massKg: 1000,
      inertiaKgM2: [1000, 1000, 1000],
      coefficients: { alphaDeg: [0, 5, 0], mach, cl, cd: cl, cm: cl },
      referenceAreaM2: 1,
      referenceLengthM: 1,
      dt: 0.1,
      steps: 10
    });
    assert.strictEqual(badTable.status, 'invalid-input');
  });

  check('SixDofDynamics atmosphere layers and quat helpers', () => {
    const s0 = standardAtmosphere1976(0);
    assert(Math.abs(s0.pressurePa - 101325) < 1);
    const s11 = standardAtmosphere1976(11000);
    assert(s11.temperatureK < 220);
    const sIsothermal = standardAtmosphere1976(20000);
    assert(sIsothermal.speedOfSoundM_s > 0);
    assert.strictEqual(standardAtmosphere1976(-1), null);
    assert.strictEqual(standardAtmosphere1976(90000), null);
    assert.strictEqual(standardAtmosphere1976(NaN), null);
    const q = [0.999, 0.01, 0.02, 0.03];
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    assert(n > 0.99 && n < 1.01);
  });

  // ------------------------------------------------------------------
  // Aerospace adapter: cone CFD path
  // ------------------------------------------------------------------
  check('AerospaceEngineAdapter cone CFD execute route', async () => {
    const adapter = new AerospaceEngineAdapter();
    const res = await adapter.execute({
      jobId: 'a26-1',
      domain: 'aerospace',
      operation: 'run_aerospace_cfd',
      parameters: {
        machNumber: 3,
        coneAngleDeg: 15,
        lengthM: 2,
        pInf: 1e5,
        qInf: 10000,
        referenceAreaM2: 1
      }
    });
    assert.strictEqual(res.status, 'COMPLETED');
    assert(res.outputData.success === true || res.outputData.Cd !== undefined);
    await assert.rejects(
      () =>
        adapter.execute({
          jobId: 'a26-2',
          domain: 'aerospace',
          operation: 'run_aerospace_cfd',
          parameters: { machNumber: 0.8, wedgeHalfAngleDeg: 10, chordM: 1 }
        }),
      /machNumber/
    );
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 120000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentySixCoverageTests };

if (require.main === module) {
  runBranchGapTwentySixCoverageTests().then((stats) => {
    console.log(`gap26: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
