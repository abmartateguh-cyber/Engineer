/**
 * OmniEng Experimental Engine Smoke Suite (Suite 27)
 * Focused smoke checks for domain examples; these do not establish release evidence:
 * 1. 100% SVG Vector Icon Resolution & Zero Missing Icon Badges
 * 2. 3D Parametric B-Rep Feature Operations (Extrude with draft, 360° Revolve, Thin-Wall Shell, Linear Pattern)
 * 3. 3-Axis CNC Planar Roughing Toolpaths & ISO 6983 G-Code Post-Processor
 * 4. Reduced-order cantilever response estimate; no FEA solver or convergence evidence
 * 5. Analytical Global Placement & Multi-Layer Grid A* Maze Routing
 * 6. Non-Ideal Phase Thermodynamics (NRTL Polar Azeotrope VLE Model)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const OmniIcons = require('../src/ui/icons');
const { FeatureOperations } = require('../src/core/cad/feature_operations');
const { TimoshenkoBeam3D } = require('../src/core/cae/beam_timoshenko_3d');
const { NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA } = require('../src/main/ipc/cae_schemas');
const { validateSchema } = require('../src/main/ipc/define_handler');
const {
  CAD_EXTRUDE_PROFILE_SCHEMA,
  CAD_REVOLVE_PROFILE_SCHEMA,
  CAD_SHELL_BODY_SCHEMA
} = require('../src/main/ipc/cad_schemas');
const { CNCToolpathEngine } = require('../src/core/cam/cnc_toolpath_engine');
const {
  CantileverResponseEstimator,
  NonlinearLargeDeflectionSolver
} = require('../src/core/cae/nonlinear_large_deflection');
const { PlaceAndRouteEngine } = require('../src/core/eda/place_and_route_engine');
const { EngineeringBOMManager } = require('../src/core/pdm/engineering_bom_manager');
const { ActivityCoefficientModels } = require('../src/core/plant/activity_coefficient_models');
const { OpticalThermalSoakEngine } = require('../src/core/optics/thermal_soak');
const { RCWAGratingSolver } = require('../src/core/optics/rcwa_grating');
const {
  CAD_PRIMITIVE_SCHEMA,
  CAD_EXPORT_OBJ_SCHEMA,
  CAD_EXPORT_STEP_SCHEMA,
  runCadPrimitive,
  runCadExportOBJ,
  runCadExportSTEP,
  runEngineeringBOMRollup,
  CAD_DRAFTING_SHEET_SCHEMA,
  runDraftingSheet,
  runVisualDiffCAD
} = require('../src/main/ipc/cad_ipc');
const {
  getOpticalGlassCatalogUnavailableResult,
  getOpticalTolerancingUnavailableResult,
  runSkewRayTrace,
  runSkewOptics,
  runAsphericOptics,
  runThinFilmCoating,
  runOpticalThermalSoak,
  runWavefrontPSF,
  runPolarizationTrace
} = require('../src/main/ipc/optics_ipc');
const {
  getPlantPropertyCatalogUnavailableResult,
  getVlleFlashUnavailableResult
} = require('../src/main/ipc/plant_ipc');
const {
  getCompositeAnalysisUnavailableResult,
  getPenaltyContactUnavailableResult,
  runTimoshenkoBeam,
  runShellMITC4,
  runContinuumPlasticity,
  runTransonicRiemann,
  runCfd2D,
  runDelaunayMesh3D,
  runFvmCfd3D,
  runSimpleCfdStep,
  runSparseCholesky,
  runWasmSparse,
  runGpuPcg,
  runWebGpuPressurePoisson,
  runHybridPrismTetMesh,
  runHex20Analysis
} = require('../src/main/ipc/cae_ipc');
const { SYNTHETIC_CONTINUUM_MATERIAL } = require('./support/synthetic_cae_materials');

function runIndustrialGapClosureTests() {
  console.log('\n================================================================');
  console.log('   RUNNING EXPERIMENTAL ENGINE SMOKE CHECKS (SUITE 27) ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function runTest(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ [GAP-${total}] ${name}`);
    } catch (err) {
      console.error(`  ✗ [GAP-${total}] FAIL: ${name}`);
      console.error(`    ${err.stack || err.message}`);
    }
  }

  runTest('Drafting requests require explicit millimeter inputs and escape text included in SVG', () => {
    const request = {
      partName: '<script>alert(1)</script>',
      partNumber: 'OE-<img onerror=alert(2)>',
      width: 50,
      height: 30,
      depth: 20,
      scale: '</text><script>',
      units: 'mm'
    };
    const result = runDraftingSheet(request);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.units, 'mm');
    assert.match(result.svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(result.svg, /&lt;\/text&gt;&lt;script&gt;/);
    assert.doesNotMatch(result.svg, /<script|<img onerror/i);
    assert.strictEqual(runDraftingSheet({ ...request, depth: undefined }).error.code, 'INVALID_INPUT');
    assert.strictEqual(runDraftingSheet({ ...request, units: undefined }).error.code, 'INVALID_INPUT');
    assert.strictEqual(runDraftingSheet({ ...request, gdtSpecs: [] }).error.code, 'INVALID_INPUT');
    assert.deepStrictEqual(CAD_DRAFTING_SHEET_SCHEMA.required, [
      'partName',
      'partNumber',
      'width',
      'height',
      'depth',
      'scale',
      'units'
    ]);
  });

  runTest('CAD primitive and file exports require explicit bounded millimetre inputs', () => {
    assert.throws(() => validateSchema({}, CAD_PRIMITIVE_SCHEMA), /Missing required object property/);
    assert.throws(() => runCadPrimitive({ type: 'box', params: { width: 30, height: 20, depth: 10 } }), /units/);
    const primitive = runCadPrimitive({
      type: 'box',
      params: { width: 30, height: 20, depth: 10, units: 'mm' }
    });
    assert.strictEqual(primitive.success, true);
    assert.strictEqual(primitive.units, 'mm');
    assert.strictEqual(primitive.volumeMm3, 6000);
    assert.throws(
      () => runCadPrimitive({ type: 'box', params: { width: 30, height: 20, depth: 10, units: 'mm', name: 'x' } }),
      /exactly/
    );
    assert.throws(
      () => runCadPrimitive({ type: 'sphere', params: { radius: 0, units: 'mm' } }),
      /finite millimeter value/
    );

    const exportParams = { width: 30, height: 20, depth: 10, units: 'mm' };
    assert.throws(() => validateSchema({ width: 30, height: 20, depth: 10 }, CAD_EXPORT_OBJ_SCHEMA), /units/);
    assert.throws(
      () => validateSchema({ ...exportParams, tolerance: 0.1 }, CAD_EXPORT_OBJ_SCHEMA),
      /Unexpected object properties/
    );
    const obj = runCadExportOBJ(exportParams);
    assert.match(obj, /^# OmniEng Parametric B-Rep OBJ Export/);
    assert.throws(() => runCadExportOBJ({ ...exportParams, units: 'in' }), /must be one of mm/);

    assert.throws(() => runCadExportSTEP({ ...exportParams }), /name/);
    const step = runCadExportSTEP({ ...exportParams, name: 'Test_Bracket' });
    assert.strictEqual(step.success, true);
    assert.strictEqual(step.units, 'mm');
    assert.strictEqual(step.filename, 'Test_Bracket.step');
    assert.match(step.stepText, /ISO-10303-21/);
    assert.throws(() => runCadExportSTEP({ ...exportParams, name: '../unsafe' }), /must start with a letter/);
    assert.throws(
      () => runCadExportSTEP({ ...exportParams, hiddenDefault: true, name: 'Model' }),
      /Unexpected object properties/
    );
    assert.strictEqual(CAD_EXPORT_STEP_SCHEMA.additionalProperties, false);
  });

  runTest('eBOM roll-up preserves the caller-supplied hierarchy and rejects missing mass/cost/quantity inputs', () => {
    const assembly = {
      partNumber: 'ASM-EXAMPLE',
      name: 'Example assembly',
      quantity: 1,
      unitMassKg: 0,
      unitCostUsd: 0,
      children: [
        {
          partNumber: 'PRT-EXAMPLE',
          name: 'Example component',
          quantity: 2,
          unitMassKg: 0.1,
          unitCostUsd: 3,
          children: []
        }
      ]
    };
    const bom = new EngineeringBOMManager().setRootAssembly(assembly);
    const rolled = bom.computeRollUp();
    assert.strictEqual(rolled.rolledUpMassKg, 0.2);
    assert.strictEqual(rolled.rolledUpCostUsd, 6);
    assert.strictEqual(bom.generateFlattenedBOM()[0].totalQuantity, 2);
    assert.strictEqual(bom.rootAssembly.revision, null);
    const route = runEngineeringBOMRollup({ rootAssembly: assembly });
    assert.strictEqual(route.success, true);
    assert.strictEqual(route.rolledUp.rolledUpMassKg, 0.2);
    assert.strictEqual(route.requestedTotals.rootAssemblyQuantity, 1);
    assert.strictEqual(route.requestedTotals.rolledUpMassKg, 0.2);
    assert.strictEqual(route.validationLevel, 'experimental');
    const legacyRoute = runEngineeringBOMRollup({
      partNumber: assembly.partNumber,
      name: assembly.name,
      quantity: assembly.quantity,
      unitMassKg: assembly.unitMassKg,
      unitCostUsd: assembly.unitCostUsd,
      items: assembly.children
    });
    assert.strictEqual(legacyRoute.success, true);
    assert.strictEqual(legacyRoute.rolledUp.rolledUpCostUsd, 6);
    assert.strictEqual(runEngineeringBOMRollup({ items: [] }).error.code, 'INVALID_INPUT');
    assert.strictEqual(
      runEngineeringBOMRollup({ rootAssembly: assembly, unexpected: true }).error.code,
      'INVALID_INPUT'
    );
    assert.throws(() => new EngineeringBOMManager().setRootAssembly({ ...assembly, quantity: undefined }), /quantity/);
    assert.throws(
      () => new EngineeringBOMManager().setRootAssembly({ ...assembly, unitMassKg: undefined }),
      /unitMassKg/
    );
    assert.throws(
      () => new EngineeringBOMManager().setRootAssembly({ ...assembly, unitCostUsd: undefined }),
      /unitCostUsd/
    );
    const csv = new EngineeringBOMManager()
      .setRootAssembly({
        partNumber: '=2+2',
        name: 'Part "quoted"',
        quantity: 1,
        unitMassKg: 0,
        unitCostUsd: 0,
        children: []
      })
      .exportToCSV();
    assert(csv.includes('"\'=2+2"'));
    assert(csv.includes('"Part ""quoted"""'));

    const orderRoute = runEngineeringBOMRollup({
      rootAssembly: {
        partNumber: 'ASM-ORDER',
        name: 'Requested order',
        quantity: 3,
        unitMassKg: 0,
        unitCostUsd: 0,
        children: [
          {
            partNumber: 'PRT-CONNECTOR',
            name: 'Connector',
            revision: 'A',
            quantity: 2,
            unitMassKg: 0.1,
            unitCostUsd: 3,
            material: 'Alloy A',
            supplier: 'Supplier 1'
          },
          {
            partNumber: 'PRT-CONNECTOR',
            name: 'Connector',
            revision: 'B',
            quantity: 1,
            unitMassKg: 0.2,
            unitCostUsd: 4,
            material: 'Alloy A',
            supplier: 'Supplier 1'
          },
          {
            partNumber: 'PRT-CONNECTOR',
            name: 'Connector',
            revision: 'A',
            quantity: 1,
            unitMassKg: 0.1,
            unitCostUsd: 3,
            material: 'Alloy A',
            supplier: 'Supplier 2'
          }
        ]
      }
    });
    assert.strictEqual(orderRoute.success, true);
    assert.strictEqual(orderRoute.rolledUp.totalPartCount, 4);
    assert.strictEqual(orderRoute.requestedTotals.rootAssemblyQuantity, 3);
    assert.strictEqual(orderRoute.requestedTotals.totalPartCount, 12);
    assert(Math.abs(orderRoute.requestedTotals.rolledUpMassKg - 1.5) < 1e-12);
    assert.strictEqual(orderRoute.requestedTotals.rolledUpCostUsd, 39);
    assert.strictEqual(orderRoute.flattened.length, 3);
    assert.deepStrictEqual(
      orderRoute.flattened.map(({ revision, supplier, totalQuantity }) => ({ revision, supplier, totalQuantity })),
      [
        { revision: 'A', supplier: 'Supplier 1', totalQuantity: 6 },
        { revision: 'B', supplier: 'Supplier 1', totalQuantity: 3 },
        { revision: 'A', supplier: 'Supplier 2', totalQuantity: 3 }
      ]
    );
    assert.strictEqual(
      orderRoute.csv.split('\n')[0],
      'Part Number,Description,Material,Supplier,Qty,Unit Cost ($),Ext Cost ($),Unit Mass (kg),Ext Mass (kg),Revision'
    );
    assert(
      orderRoute.csv.includes('"PRT-CONNECTOR","Connector","Alloy A","Supplier 1",3,4.00,12.00,0.2000,0.6000,"B"')
    );

    const overflowingOrder = runEngineeringBOMRollup({
      rootAssembly: {
        partNumber: 'ASM-OVERFLOW',
        name: 'Overflow check',
        quantity: Number.MAX_VALUE,
        unitMassKg: 2,
        unitCostUsd: 0,
        children: []
      }
    });
    assert.strictEqual(overflowingOrder.success, false);
    assert.strictEqual(overflowingOrder.status, 'numerical-failure');
    assert.strictEqual(overflowingOrder.error.code, 'NUMERICAL_FAILURE');
  });

  runTest('CAD visual comparison requires explicit units and thresholds and reports centroid displacement only', () => {
    const revisionA = {
      commitId: 'base-revision',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 100,
      faces: [{ id: 'base-face', persistentId: 'stable-face-1', centroidMm: { x: 0, y: 0, z: 0 } }]
    };
    const revisionB = {
      commitId: 'target-revision',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 95,
      faces: [{ id: 'target-face', persistentId: 'stable-face-1', centroidMm: { x: 0.5, y: 0, z: 0 } }]
    };
    const result = runVisualDiffCAD({
      modelA: revisionA,
      modelB: revisionB,
      options: { toleranceMm: 0.1, modificationThresholdMm: 1 }
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.summary.modifiedCount, 1);
    assert.strictEqual(result.maxCentroidDisplacementMm, 0.5);
    assert.strictEqual(result.maxThicknessReductionMm, null);
    assert.strictEqual(result.volumetric.volumeDeltaMm3, -5);
    assert.strictEqual(result.volumetric.volumeDeltaPercent, -5);

    const identityFirst = runVisualDiffCAD({
      modelA: {
        commitId: 'identity-a',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1,
        faces: [
          { id: 'near-face', centroidMm: { x: 0, y: 0, z: 0 } },
          { id: 'stable-face', persistentId: 'stable-id', centroidMm: { x: 10, y: 0, z: 0 } }
        ]
      },
      modelB: {
        commitId: 'identity-b',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1,
        faces: [
          { id: 'stable-face-target', persistentId: 'stable-id', centroidMm: { x: 0.1, y: 0, z: 0 } },
          { id: 'distant-face', centroidMm: { x: 100, y: 0, z: 0 } }
        ]
      },
      options: { toleranceMm: 0.2, modificationThresholdMm: 100 }
    });
    assert.strictEqual(identityFirst.success, true);
    assert.strictEqual(
      identityFirst.entities.modified.find((face) => face.faceIdA === 'stable-face').faceIdB,
      'stable-face-target'
    );

    const outsideThreshold = runVisualDiffCAD({
      modelA: {
        commitId: 'outside-a',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1,
        faces: [{ id: 'stable-old', persistentId: 'stable-id', centroidMm: { x: 0, y: 0, z: 0 } }]
      },
      modelB: {
        commitId: 'outside-b',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1,
        faces: [{ id: 'stable-new', persistentId: 'stable-id', centroidMm: { x: 101, y: 0, z: 0 } }]
      },
      options: { toleranceMm: 0.1, modificationThresholdMm: 100 }
    });
    assert.strictEqual(outsideThreshold.success, true);
    assert.strictEqual(outsideThreshold.summary.removedCount, 1);
    assert.strictEqual(outsideThreshold.summary.addedCount, 1);

    const legacyShape = runVisualDiffCAD({
      revA: {
        commitId: 'legacy-a',
        units: { length: 'mm', volume: 'mm3' },
        volume: 100,
        faces: [{ id: 'a', centroid: { x: 0, y: 0, z: 0 } }]
      },
      revB: {
        commitId: 'legacy-b',
        units: { length: 'mm', volume: 'mm3' },
        volume: 100,
        faces: [{ id: 'b', centroid: { x: 0, y: 0, z: 0 } }]
      },
      options: { toleranceMm: 0, modificationThresholdMm: 0.1 }
    });
    assert.strictEqual(legacyShape.success, true);
    assert.strictEqual(legacyShape.summary.unchangedCount, 1);

    assert.strictEqual(runVisualDiffCAD({ modelA: revisionA, modelB: revisionB }).error.code, 'INVALID_INPUT');
    assert.strictEqual(
      runVisualDiffCAD({
        modelA: { ...revisionA, units: undefined },
        modelB: revisionB,
        options: { toleranceMm: 0.1, modificationThresholdMm: 1 }
      }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      runVisualDiffCAD({
        modelA: revisionA,
        modelB: revisionB,
        options: { toleranceMm: 1, modificationThresholdMm: 1 }
      }).error.code,
      'INVALID_INPUT'
    );

    const overflow = runVisualDiffCAD({
      modelA: {
        ...revisionA,
        faces: [{ id: 'far-left', centroidMm: { x: -Number.MAX_VALUE, y: 0, z: 0 } }]
      },
      modelB: {
        ...revisionB,
        faces: [{ id: 'far-right', centroidMm: { x: Number.MAX_VALUE, y: 0, z: 0 } }]
      },
      options: { toleranceMm: 0.1, modificationThresholdMm: 1 }
    });
    assert.strictEqual(overflow.status, 'numerical-failure');
    assert.strictEqual(overflow.error.code, 'NUMERICAL_FAILURE');
  });

  runTest('Unreviewed optics, composite, and plant data routes fail closed', () => {
    const opticalResult = getOpticalGlassCatalogUnavailableResult();
    assert.strictEqual(opticalResult.success, false);
    assert.strictEqual(opticalResult.status, 'unavailable');
    assert.strictEqual(opticalResult.error.code, 'UNSUPPORTED');

    const toleranceResult = getOpticalTolerancingUnavailableResult();
    assert.strictEqual(toleranceResult.success, false);
    assert.strictEqual(toleranceResult.status, 'unavailable');
    assert.strictEqual(toleranceResult.error.code, 'UNSUPPORTED');

    const compositeResult = getCompositeAnalysisUnavailableResult();
    assert.strictEqual(compositeResult.success, false);
    assert.strictEqual(compositeResult.status, 'unavailable');
    assert.strictEqual(compositeResult.error.code, 'UNSUPPORTED');

    const propertyResult = getPlantPropertyCatalogUnavailableResult();
    assert.strictEqual(propertyResult.success, false);
    assert.strictEqual(propertyResult.status, 'unavailable');
    assert.strictEqual(propertyResult.error.code, 'UNSUPPORTED');

    const vlleResult = getVlleFlashUnavailableResult();
    assert.strictEqual(vlleResult.success, false);
    assert.strictEqual(vlleResult.status, 'unavailable');
    assert.strictEqual(vlleResult.error.code, 'UNSUPPORTED');
  });

  runTest('Optical asphere, coating, thermal, wavefront, and polarization routes require explicit inputs', () => {
    assert.strictEqual(runSkewRayTrace({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runSkewOptics({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runAsphericOptics({}).error.code, 'INVALID_INPUT');
    const asphereInputs = {
      curvaturePerMm: 1 / 50,
      conic: 0,
      semiDiameterMm: 10,
      coefficients: { alpha4: 0, alpha6: 0, alpha8: 0, alpha10: 0, alpha12: 0 },
      evaluationRadiusMm: 5,
      normalPointMm: { x: 0, y: 0 },
      vertexZMm: 0,
      rayOriginMm: { x: 0, y: 0, z: -10 },
      rayDirection: { x: 0, y: 0, z: 1 },
      maxIterations: 25,
      toleranceMm: 1e-9
    };
    const asphere = runAsphericOptics(asphereInputs);
    assert.strictEqual(asphere.success, true);
    assert(asphere.sagMm > 0);
    assert.strictEqual(asphere.hit.hit, true);
    assert.strictEqual(asphere.hit.tMm, 10);
    assert.strictEqual(runAsphericOptics({ ...asphereInputs, curvaturePerMm: 1 }).error.code, 'INVALID_INPUT');

    assert.strictEqual(runThinFilmCoating({}).error.code, 'INVALID_INPUT');
    const coating = runThinFilmCoating({
      substrateIndex: 1.5,
      incidentIndex: 1,
      layers: [{ refractiveIndex: 1.38, thicknessNm: 100 }],
      wavelengthNm: 550,
      thetaDeg: 0
    });
    assert.strictEqual(coating.success, true);
    assert.strictEqual(coating.result.layersCount, 1);
    assert(Number.isFinite(coating.result.reflectance));

    assert.strictEqual(runOpticalThermalSoak({}).error.code, 'INVALID_INPUT');
    const thermalInputs = {
      housingCtePerK: 0,
      housingCteSource: 'explicit test input',
      elements: [
        {
          radius1Mm: 50,
          radius2Mm: -100,
          thicknessMm: 8,
          airGapMm: 2,
          refractiveIndexAtReferenceTemperature: 1.5,
          thermalProperties: {
            D0PerK: 0,
            D1PerK2: 0,
            D2PerK3: 0,
            E0Um2PerK: 0,
            E1Um2PerK2: 0,
            lambdaTkUm: 0.17,
            glassCtePerK: 0,
            source: 'explicit test input'
          }
        }
      ],
      targetTempC: 40,
      referenceTempC: 20,
      wavelengthUm: 0.55,
      pressurePa: 101325
    };
    const thermal = runOpticalThermalSoak(thermalInputs);
    assert.strictEqual(thermal.success, true);
    assert.strictEqual(thermal.result.focalShiftMm, 0);
    assert.strictEqual(Object.hasOwn(thermal.result, 'athermalized'), false);
    assert.strictEqual(runOpticalThermalSoak({ ...thermalInputs, wavelengthUm: 0.17 }).error.code, 'INVALID_INPUT');
    const directThermal = OpticalThermalSoakEngine.evaluateThermalSoakFromProperties(
      {
        housingCtePerK: thermalInputs.housingCtePerK,
        housingCteSource: thermalInputs.housingCteSource,
        elements: thermalInputs.elements
      },
      thermalInputs.targetTempC,
      thermalInputs.referenceTempC,
      thermalInputs.wavelengthUm,
      thermalInputs.pressurePa
    );
    assert.strictEqual(directThermal.focalShiftMm, 0);
    assert.strictEqual(
      OpticalThermalSoakEngine.evaluateThermalSoakFromProperties(
        { housingCtePerK: 0, housingCteSource: 'test', elements: thermalInputs.elements },
        thermalInputs.targetTempC,
        thermalInputs.referenceTempC,
        0.17,
        thermalInputs.pressurePa
      ).error.code,
      'INVALID_INPUT'
    );

    assert.strictEqual(runWavefrontPSF({}).error.code, 'INVALID_INPUT');
    const psf = runWavefrontPSF({
      gridSize: 16,
      wavelengthUm: 0.55,
      fNumber: 2.8,
      defocusWaves: 0,
      sphericalWaves: 0
    });
    assert.strictEqual(psf.success, true);
    assert(Number.isFinite(psf.result.airyRadiusUm));
    assert.strictEqual(Object.hasOwn(psf.result, 'isDiffractionLimited'), false);
    assert.strictEqual(
      runWavefrontPSF({
        gridSize: 16,
        wavelengthUm: Number.MIN_VALUE,
        fNumber: 2.8,
        defocusWaves: 0,
        sphericalWaves: 0
      }).error.code,
      'NUMERICAL_FAILURE'
    );

    assert.strictEqual(runPolarizationTrace({}).error.code, 'INVALID_INPUT');
    const fresnel = runPolarizationTrace({ action: 'fresnel', n1: 1, n2: 1.5, thetaRad: 0 });
    assert.strictEqual(fresnel.success, true);
    assert(Math.abs(fresnel.Rs - 0.04) < 1e-6);
    assert.strictEqual(runPolarizationTrace({ action: 'birefringent-split' }).error.code, 'INVALID_INPUT');
    assert.strictEqual(
      runPolarizationTrace({
        action: 'birefringent-split',
        crystalProps: { opticAxis: [0, 0, 1] },
        rayDir: [0, 0, -1],
        surfaceNorm: [0, 0, 1]
      }).error.code,
      'INVALID_INPUT'
    );
    const stokes = runPolarizationTrace({ action: 'stokes', Ex: 1, Ey: 0, ExImag: 0, EyImag: 0 });
    assert.strictEqual(stokes.success, true);
    assert.strictEqual(stokes.stokes.DOP, 1);
  });

  runTest('Unvalidated RCWA estimates fail closed instead of returning synthetic efficiencies', () => {
    const result = RCWAGratingSolver.solveDiffractionOrders({
      periodUm: 0.8,
      grooveDepthUm: 0.3,
      dutyCycle: 0.5,
      nSubstrate: 1.5,
      nIncident: 1,
      wavelengthUm: 0.55,
      incidentAngleDeg: 0
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'unavailable');
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.error.code, 'UNSUPPORTED');
    assert.strictEqual(Object.hasOwn(result, 'transmittedOrders'), false);
  });

  runTest('3D beam route rejects implicit geometry and material defaults', () => {
    const missing = runTimoshenkoBeam({});
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    ];
    const section = {
      E: 210e9,
      nu: 0.3,
      A: 0.005,
      Iy: 8.33e-6,
      Iz: 8.33e-6,
      J: 1.4e-5,
      ky: 0.85,
      kz: 0.85
    };

    assert.strictEqual(
      runTimoshenkoBeam({ coords, section: { ...section, ky: undefined }, K: 2 }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(runTimoshenkoBeam({ coords, section: { ...section, E: 0 }, K: 2 }).error.code, 'INVALID_INPUT');
    assert.strictEqual(runTimoshenkoBeam({ coords, section, K: 0 }).error.code, 'INVALID_INPUT');
    assert.throws(
      () => new TimoshenkoBeam3D(1, [0, 1], coords, { ...section, kz: undefined }),
      /finite explicit values/
    );

    const beam = new TimoshenkoBeam3D(1, [0, 1], coords, section);
    assert.throws(() => beam.calculateEulerBucklingLoad(), /explicit positive finite/);
    assert.throws(() => beam.computeGeometricStiffnessMatrix(), /explicit finite axial load/);

    const explicit = runTimoshenkoBeam({ coords, section, K: 2 });
    assert.strictEqual(explicit.success, true);
    assert.strictEqual(explicit.validationLevel, 'experimental');
    assert.strictEqual(explicit.stiffnessSize, 144);
  });

  runTest('Shell, plasticity, and transonic routes require explicit model inputs', () => {
    assert.strictEqual(runShellMITC4({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runContinuumPlasticity({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(
      runContinuumPlasticity({
        material: { E: 210e9, nu: 0.3, yieldStress: 250e6 },
        strainIncrement: [0, 0, 0, 0, 0, 0],
        strainRate: 1,
        temperature: 300
      }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(runTransonicRiemann({}).error.code, 'INVALID_INPUT');

    const shell = runShellMITC4({
      coords: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 }
      ],
      properties: { thickness: 0.001, E: 210e9, nu: 0.3, density: 7850 }
    });
    assert.strictEqual(shell.success, true);
    assert.strictEqual(shell.matrixSize, 576);

    const plasticity = runContinuumPlasticity({
      material: SYNTHETIC_CONTINUUM_MATERIAL,
      strainIncrement: [1e-4, 0, 0, 0, 0, 0],
      strainRate: 1,
      temperature: 293.15
    });
    assert.strictEqual(plasticity.success, true);
    assert.strictEqual(plasticity.validationLevel, 'experimental');

    const flux = runTransonicRiemann({
      method: 'roe',
      leftState: { rho: 1, u: 0, v: 0, w: 0, p: 101325 },
      rightState: { rho: 0.125, u: 0, v: 0, w: 0, p: 10132.5 },
      normal: { x: 1, y: 0, z: 0 }
    });
    assert.strictEqual(flux.success, true);
    assert.strictEqual(flux.validationLevel, 'experimental');
  });

  runTest('CFD, meshing, and sparse routes reject generated default problems', () => {
    assert.strictEqual(runCfd2D({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runDelaunayMesh3D({}).error.code, 'INVALID_INPUT');
    const vertices = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 }
    ];
    assert.strictEqual(
      runDelaunayMesh3D({ vertices, faces: [[0, 1, 2]], targetEdgeLength: 0.1 }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(
      runDelaunayMesh3D({ vertices, faces: [[0, 1, 9]], targetEdgeLength: 0.1, quadratic: true }).error.code,
      'INVALID_INPUT'
    );
    assert.strictEqual(runFvmCfd3D({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runSimpleCfdStep({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runSparseCholesky({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runWasmSparse({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runGpuPcg({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runWebGpuPressurePoisson({}).error.code, 'INVALID_INPUT');

    const sparse = runSparseCholesky({
      N: 2,
      triplets: [
        [0, 0, 2],
        [0, 1, -1],
        [1, 0, -1],
        [1, 1, 2]
      ],
      b: [1, 1]
    });
    assert.strictEqual(sparse.success, true);
    assert.strictEqual(sparse.validationLevel, 'experimental');

    const wasmSparse = runWasmSparse({
      N: 2,
      triplets: [
        [0, 0, 2],
        [0, 1, -1],
        [1, 0, -1],
        [1, 1, 2]
      ],
      b: [1, 1]
    });
    assert.strictEqual(wasmSparse.success, true);
    assert.strictEqual(wasmSparse.validationLevel, 'experimental');
  });

  runTest('Hybrid meshing and HEX20 require explicit inputs; unreviewed penalty contact fails closed', () => {
    assert.strictEqual(runHybridPrismTetMesh({}).error.code, 'INVALID_INPUT');
    assert.strictEqual(runHex20Analysis({}).error.code, 'INVALID_INPUT');

    const contact = getPenaltyContactUnavailableResult();
    assert.strictEqual(contact.success, false);
    assert.strictEqual(contact.status, 'unavailable');
    assert.strictEqual(contact.error.code, 'UNSUPPORTED');
  });

  // ----------------------------------------------------
  // Test 1: Vector Icon Catalog Resolution
  // ----------------------------------------------------
  runTest('OmniIcons: Complete catalog resolution with zero undefined icon slots in HTML & JS', () => {
    const keys = OmniIcons.getAllKeys();
    assert(keys.length >= 70, `Expected >= 70 icons, found ${keys.length}`);
    assert(Object.isFrozen(OmniIcons), 'The public icon API must not be replaceable at runtime');
    assert(Object.isFrozen(OmniIcons.getAll()), 'The SVG catalog must be immutable');
    assert.strictEqual(OmniIcons.get('__proto__'), '');
    assert.strictEqual(OmniIcons.get('constructor'), '');
    assert.strictEqual(OmniIcons.has('toString'), false);

    // Verify critical new engineering icons
    const requiredIcons = [
      'checkCircle',
      'solidExtrude',
      'circuit',
      'cfdStreamlines',
      'flowChart',
      'link',
      'cadExtrude',
      'cadRevolve',
      'cadSweep',
      'cadLoft',
      'cadShell',
      'cadPattern',
      'cadMirror',
      'cadHole',
      'camGcode',
      'gizmo3d',
      'contextMenu',
      'historyStack'
    ];

    for (const key of requiredIcons) {
      assert(OmniIcons.has(key), `Missing required icon: ${key}`);
      const svg = OmniIcons.get(key);
      assert(
        typeof svg === 'string' && svg.startsWith('<svg') && svg.endsWith('</svg>'),
        `Icon ${key} has invalid SVG payload`
      );
      assert(svg.includes('stroke-width="1.75"'), `Icon ${key} does not meet 1.75px optical stroke requirement`);
    }

    const catalogKey = requiredIcons[0];
    const trustedSvg = OmniIcons.get(catalogKey);
    assert.throws(() => Object.assign(OmniIcons.getAll(), { [catalogKey]: '<img src=x onerror=alert(1)>' }), TypeError);
    const knownSlot = { getAttribute: () => catalogKey };
    const inheritedKeySlot = { getAttribute: () => 'constructor' };
    OmniIcons.hydrateAll({ querySelectorAll: () => [knownSlot, inheritedKeySlot] });
    assert.strictEqual(knownSlot.innerHTML, trustedSvg);
    assert.strictEqual(inheritedKeySlot.innerHTML, undefined);

    // Verify all data-omni-icon attributes in index.html resolve cleanly
    const indexHtml = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    const attrRegex = /data-omni-icon="([a-zA-Z0-9_-]+)"/g;
    let match;
    const missingInHtml = [];
    while ((match = attrRegex.exec(indexHtml)) !== null) {
      const iconKey = match[1];
      if (!OmniIcons.has(iconKey)) {
        missingInHtml.push(iconKey);
      }
    }
    assert.strictEqual(missingInHtml.length, 0, `Found unresolvable icons in index.html: ${missingInHtml.join(', ')}`);
  });

  // ----------------------------------------------------
  // Test 2: 3D Parametric Extrusion (Draft & Euler Formula)
  // ----------------------------------------------------
  runTest('FeatureOperations.extrude: Euler characteristic V - E + F = 2 and positive solid volume', () => {
    // Extrude a rectangular sketch profile 40 x 30 by depth 50 with 2 deg draft
    const profile = [
      { x: -20, y: -15 },
      { x: 20, y: -15 },
      { x: 20, y: 15 },
      { x: -20, y: 15 }
    ];
    const solid = FeatureOperations.extrude(profile, 50.0, { draftAngleDeg: 2.0 });

    assert(solid !== null, 'Extrusion must return a valid SolidBody');
    assert.strictEqual(solid.faces.length, 6, 'Prismatic box extrusion must have exactly 6 B-Rep faces');

    // Euler-Poincaré formula for genus-0 polyhedron: V - E + F = 2
    const V = solid.vertices.length;
    const E = solid.edges.length;
    const F = solid.faces.length;
    const euler = V - E + F;
    assert.strictEqual(euler, 2, `Euler characteristic must be 2, got V=${V}, E=${E}, F=${F} -> ${euler}`);

    // Verify metadata
    assert.strictEqual(solid.metadata.feature, 'Extrude');
    assert.strictEqual(solid.metadata.depth, 50.0);
  });

  runTest('CAD IPC feature routes require explicit millimetre inputs and operation settings', () => {
    const profile = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 }
    ];
    assert.throws(() => validateSchema({}, CAD_EXTRUDE_PROFILE_SCHEMA), /Missing required object property/);
    assert.throws(
      () => validateSchema({ profile, depth: 20, draftAngleDeg: 0 }, CAD_EXTRUDE_PROFILE_SCHEMA),
      /lengthUnit/
    );
    assert.doesNotThrow(() =>
      validateSchema({ profile, depth: 20, draftAngleDeg: 0, lengthUnit: 'mm' }, CAD_EXTRUDE_PROFILE_SCHEMA)
    );
    assert.throws(
      () => validateSchema({ profile, depth: 20, draftAngleDeg: 0, lengthUnit: 'in' }, CAD_EXTRUDE_PROFILE_SCHEMA),
      /must be one of mm/
    );
    assert.throws(
      () =>
        validateSchema(
          { profile, depth: 20, draftAngleDeg: 0, lengthUnit: 'mm', hiddenDefault: 40 },
          CAD_EXTRUDE_PROFILE_SCHEMA
        ),
      /Unexpected object properties/
    );
    assert.throws(
      () =>
        validateSchema(
          { profile: [{ x: 0, y: 0, z: 5 }, ...profile.slice(1)], depth: 20, draftAngleDeg: 0, lengthUnit: 'mm' },
          CAD_EXTRUDE_PROFILE_SCHEMA
        ),
      /Unexpected object properties/
    );

    assert.throws(() => validateSchema({}, CAD_REVOLVE_PROFILE_SCHEMA), /Missing required object property/);
    assert.doesNotThrow(() =>
      validateSchema({ profile, angleDeg: 360, axis: 'Y', segments: 32, lengthUnit: 'mm' }, CAD_REVOLVE_PROFILE_SCHEMA)
    );
    assert.throws(
      () =>
        validateSchema(
          { profile, angleDeg: 360, axis: 'X', segments: 32, lengthUnit: 'mm' },
          CAD_REVOLVE_PROFILE_SCHEMA
        ),
      /must be one of Y, Z/
    );
    assert.throws(
      () =>
        validateSchema(
          { profile, angleDeg: 360, axis: 'Y', segments: 3.5, lengthUnit: 'mm' },
          CAD_REVOLVE_PROFILE_SCHEMA
        ),
      /must be an integer/
    );

    const shell = { width: 60, height: 40, depth: 80, wallThickness: 2, openFaceIndex: 5, lengthUnit: 'mm' };
    assert.throws(() => validateSchema({}, CAD_SHELL_BODY_SCHEMA), /Missing required object property/);
    assert.doesNotThrow(() => validateSchema(shell, CAD_SHELL_BODY_SCHEMA));
    assert.throws(() => validateSchema({ ...shell, openFaceIndex: 1.5 }, CAD_SHELL_BODY_SCHEMA), /must be an integer/);
  });

  // ----------------------------------------------------
  // Test 3: 3D Revolve Feature (Quad Tessellation)
  // ----------------------------------------------------
  runTest('FeatureOperations.revolve: 360° rotational solid feature generation around Y axis', () => {
    // Profile of a cylinder radius 20, height 40: [[20, 0], [20, 40]]
    const profile = [
      { x: 20, y: 0 },
      { x: 20, y: 40 }
    ];
    const solid = FeatureOperations.revolve(profile, 360, 'Y', 24);

    assert(solid !== null, 'Revolve must return a valid SolidBody');
    assert(solid.faces.length >= 24, `Expected at least 24 revolution faces, got ${solid.faces.length}`);
    assert.strictEqual(solid.metadata.feature, 'Revolve');
    assert.strictEqual(solid.metadata.angleDeg, 360);
    assert.strictEqual(solid.metadata.axis, 'Y');
  });

  // ----------------------------------------------------
  // Test 4: Thin-Wall Shell & Linear Patterning
  // ----------------------------------------------------
  runTest('FeatureOperations.shell & linearPattern: Constant-thickness shell and feature replication', () => {
    const profile = [
      { x: -25, y: -25 },
      { x: 25, y: -25 },
      { x: 25, y: 25 },
      { x: -25, y: 25 }
    ];
    const baseSolid = FeatureOperations.extrude(profile, 30.0, { draftAngleDeg: 0 });

    const shellResult = FeatureOperations.shell(baseSolid, 2.5, 1); // 2.5mm wall, face 1 open
    assert(shellResult.solid !== null, 'Shell operation must return a solid body');
    assert.strictEqual(shellResult.wallThickness, 2.5);
    assert.strictEqual(shellResult.openFaceIndex, 1);

    // Linear pattern: 4 copies along X-axis with 60mm pitch
    const patternResult = FeatureOperations.linearPattern(baseSolid, [1, 0, 0], 4, 60.0);
    assert.strictEqual(patternResult.instances.length, 4, 'Linear pattern must produce exactly 4 instances');
    assert.strictEqual(patternResult.instances[3].translation[0], 180.0, 'Instance 4 offset must be 3 * 60 = 180mm');
  });

  runTest('FeatureOperations requires explicit depth, draft, revolution, and shell parameters', () => {
    const profile = [
      { x: -25, y: -25 },
      { x: 25, y: -25 },
      { x: 25, y: 25 },
      { x: -25, y: 25 }
    ];
    assert.throws(() => FeatureOperations.extrude(profile), /explicit positive depth/);
    assert.throws(() => FeatureOperations.extrude(profile, 30), /explicit finite draftAngleDeg/);
    assert.doesNotThrow(() => FeatureOperations.extrude(profile, 30, { draftAngleDeg: 0 }));

    const revolveProfile = [
      { x: 0, y: 0 },
      { x: 20, y: 10 }
    ];
    assert.throws(() => FeatureOperations.revolve(revolveProfile), /explicit angle/);
    assert.doesNotThrow(() => FeatureOperations.revolve(revolveProfile, 180, 'Y', 24));

    const solid = FeatureOperations.extrude(profile, 30, { draftAngleDeg: 0 });
    assert.throws(() => FeatureOperations.shell(solid), /explicit positive wall thickness/);
    assert.throws(() => FeatureOperations.shell(solid, 2), /explicit valid open face index/);
    assert.doesNotThrow(() => FeatureOperations.shell(solid, 2, 1));
  });

  // ----------------------------------------------------
  // Test 5: 3-Axis CAM Planar Roughing & ISO G-Code
  // ----------------------------------------------------
  runTest('CNCToolpathEngine: 3-Axis planar roughing and illustrative G-code text', () => {
    const cam = new CNCToolpathEngine({
      toolDiameter: 8.0,
      toolType: 'flat_endmill',
      stepdownMm: 4.0,
      stepoverMm: 4.8,
      feedRateMmMin: 1000,
      plungeRateMmMin: 250,
      spindleRpm: 8000,
      safeZ: 25
    });

    const bounds = { minX: -30, maxX: 30, minY: -20, maxY: 20, minZ: 0, maxZ: 20 };
    const toolpath = cam.planRoughingToolpath(bounds);

    assert(
      toolpath.layers.length >= 5,
      `Expected at least 5 Z-layers for 20mm depth / 4mm stepdown, got ${toolpath.layers.length}`
    );
    assert(toolpath.telemetry.totalPathLengthMm > 0, 'Total cutting path length must be positive');
    assert(toolpath.telemetry.estimatedTimeMin > 0, 'Estimated machining time must be positive');

    // Post-processor to Fanuc/Haas ISO G-Code
    const gcode = cam.generateGCode(toolpath, 'O1001');

    assert(gcode.includes('O1001'), 'G-code must have program header O1001');
    assert(gcode.includes('G21') && gcode.includes('G90'), 'G-code must declare metric G21 and absolute G90');
    assert(gcode.includes('S8000 M03'), 'G-code must command spindle clockwise M03 at 8000 RPM');
    assert(gcode.includes('M30'), 'G-code must terminate with M30 program end');
    assert(gcode.includes('G01 Z'), 'G-code must have feed linear plunge moves');
  });

  // ----------------------------------------------------
  // Test 6: Reduced-order beam response estimate
  // ----------------------------------------------------
  runTest('CantileverResponseEstimator: formula estimate without solver diagnostics', () => {
    const inputs = {
      length: 1000.0,
      width: 20.0,
      height: 5.0,
      E: 200000.0,
      P: 25.0,
      lengthUnit: 'mm',
      modulusUnit: 'MPa',
      forceUnit: 'N'
    };
    assert.throws(() => validateSchema({}, NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA), /Missing required object property/);
    assert.throws(
      () => validateSchema({ ...inputs, lengthUnit: 'in' }, NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA),
      /must be one of mm/
    );
    assert.doesNotThrow(() => validateSchema(inputs, NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA));

    const solver = new CantileverResponseEstimator({ sampleCount: 10 });
    const res = solver.solveLargeDeflectionCantilever(inputs);

    assert.strictEqual(res.validationLevel, 'experimental');
    assert.strictEqual(res.summary.status, 'ESTIMATE_ONLY');
    assert.deepStrictEqual(res.units, { length: 'mm', force: 'N', modulus: 'MPa' });
    assert.deepStrictEqual(res.inputs, inputs);
    assert.strictEqual(res.loadSamples.length, 10, 'Must record 10 sampled load fractions');
    assert.strictEqual(res.loadSteps.length, 10, 'Legacy load-step result shape remains available');

    const finalSample = res.loadSamples[res.loadSamples.length - 1];
    const finalCompatibilityStep = res.loadSteps[res.loadSteps.length - 1];
    assert(res.linearTipDeflectionMm > res.formulaAdjustedTipDeflectionMm);
    assert.strictEqual(res.formulaAdjustedTipDeflectionMm, res.nonlinearTipDeflectionMm);
    assert(res.formulaAdjustmentPercent > 0);
    assert.strictEqual(res.geometricStiffeningPercent, res.formulaAdjustmentPercent);
    assert(finalSample.estimatedAxialShorteningMm > 0);
    assert.strictEqual(finalCompatibilityStep.tipDeflectionMm, finalSample.estimatedDeflectionMm);
    assert.strictEqual(finalCompatibilityStep.axialShorteningMm, finalSample.estimatedAxialShorteningMm);
    assert.strictEqual(Object.hasOwn(finalSample, 'iterations'), false);
    assert.strictEqual(Object.hasOwn(finalSample, 'converged'), false);
    assert.strictEqual(Object.hasOwn(res, 'residualNorm'), false);

    const legacyApiResult = new NonlinearLargeDeflectionSolver({ numLoadSteps: 4 }).solveLargeDeflectionCantilever(
      inputs
    );
    assert.strictEqual(legacyApiResult.loadSteps.length, 4);
    assert.strictEqual(legacyApiResult.summary.totalSteps, 4);
    assert.strictEqual(legacyApiResult.validationLevel, 'experimental');

    assert.throws(() => solver.solveLargeDeflectionCantilever({}), /length, width, height, E, P, and units/i);
    assert.throws(
      () => solver.solveLargeDeflectionCantilever({ ...inputs, lengthUnit: 'in' }),
      /units must be mm, MPa, and N/i
    );
    assert.throws(
      () => solver.solveLargeDeflectionCantilever({ ...inputs, numElements: 10 }),
      /Unexpected cantilever estimate inputs/
    );
  });

  // ----------------------------------------------------
  // Test 7: Analytical Placement & Multi-Layer Grid Routing
  // ----------------------------------------------------
  runTest('PlaceAndRouteEngine: caller-supplied experimental placement and simple routing', () => {
    const pnr = new PlaceAndRouteEngine({
      coreWidth: 200.0,
      coreHeight: 200.0,
      stdCellHeight: 10.0
    });

    const circuitData = {
      cells: [
        { id: 'u_inv1', width: 4.0, height: 10.0 },
        { id: 'u_nand2', width: 6.0, height: 10.0 },
        { id: 'u_dff1', width: 12.0, height: 10.0 }
      ],
      nets: [
        { name: 'net_clk', pins: ['u_inv1', 'u_dff1'] },
        { name: 'net_data', pins: ['u_nand2', 'u_dff1'] }
      ]
    };

    const pnrResult = pnr.runPlaceAndRoute(circuitData);

    assert.strictEqual(pnrResult.status, 'EXPERIMENTAL_LAYOUT_ESTIMATE');
    assert.strictEqual(pnrResult.cellsPlacedCount, 3);
    assert.strictEqual(pnrResult.netsRoutedCount, 2);
    assert(pnrResult.telemetry.totalHpwlMicrons > 0, 'Total HPWL wirelength must be > 0');
    assert.strictEqual(pnrResult.validationLevel, 'experimental');
    assert.strictEqual(pnrResult.designRuleCheck, 'not-run');
  });

  runTest('PlaceAndRouteEngine: missing cells, nets, or core dimensions fail closed', () => {
    assert.throws(() => new PlaceAndRouteEngine(), /Explicit positive coreWidth, coreHeight, and stdCellHeight/);
    const pnr = new PlaceAndRouteEngine({ coreWidth: 100, coreHeight: 100, stdCellHeight: 10 });
    const result = pnr.runPlaceAndRoute({});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'INVALID_INPUT');
  });

  // ----------------------------------------------------
  // Test 8: Non-Ideal Phase Thermodynamics (NRTL Azeotrope)
  // ----------------------------------------------------
  runTest('ActivityCoefficientModels: NRTL Ethanol-Water azeotropic composition & activity coefficients', () => {
    // Ethanol (1) + Water (2) at 78.15 °C
    const nrtl = ActivityCoefficientModels.evaluateNRTLBinary(0.894, 78.15);

    // Non-ideal positive deviation: gamma1 > 1.0, gamma2 > 1.0
    assert(nrtl.gamma1 > 1.0, `Ethanol activity coefficient gamma1 must be > 1.0, got ${nrtl.gamma1}`);
    assert(
      nrtl.gamma2 > 1.5,
      `Water activity coefficient gamma2 must be > 1.5 in ethanol-rich mixture, got ${nrtl.gamma2}`
    );

    // Bubble point pressure at 78.15 °C should be near 1 atm (within 0.20 bar of 1.013 bar)
    assert(
      Math.abs(nrtl.P_bubble_bar - 1.013) < 0.25,
      `Bubble point pressure ${nrtl.P_bubble_bar} bar should be near 1 atm`
    );

    // Azeotrope search
    const azeo = ActivityCoefficientModels.findAzeotrope('ethanol', 'water', 78.15);
    assert(azeo.hasAzeotrope, 'NRTL solver must identify ethanol-water minimum boiling azeotrope');
    assert(
      Math.abs(azeo.azeotropeX1 - 0.894) < 0.05,
      `Azeotropic composition ${azeo.azeotropeX1} deviates from literature 0.894`
    );
  });

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passed} / ${total} EXPERIMENTAL ENGINE SMOKE CHECKS PASSED`);
  console.log('================================================================\n');

  return { total, passed };
}

if (require.main === module) {
  const result = runIndustrialGapClosureTests();
  if (result.passed !== result.total) {
    process.exit(1);
  }
}

module.exports = { runIndustrialGapClosureTests };
