/**
 * Compatibility and explicit-input checks for experimental optical adapters.
 * This file does not benchmark optical performance.
 */

'use strict';

const assert = require('assert');
const { CameraLensMaster } = require('../src/core/optics/camera_lens_master');

function runCameraLensMasterTests() {
  const operations = [
    ['prescription', () => CameraLensMaster.getPrescription()],
    ['paraxial-trace', () => CameraLensMaster.traceParaxialSystem()],
    ['chromatic-aberration', () => CameraLensMaster.evaluateChromaticAberration()],
    ['seidel-aberrations', () => CameraLensMaster.evaluateSeidelAberrations()],
    ['mtf', () => CameraLensMaster.evaluateMTFPerformance()],
    ['autofocus', () => CameraLensMaster.evaluateAutofocusMechatronics()],
    ['ois', () => CameraLensMaster.evaluateOISPerformance()],
    ['athermalization', () => CameraLensMaster.evaluateAthermalization()],
    ['coating', () => CameraLensMaster.evaluateAntiReflectiveCoating()],
    ['internal-components', () => CameraLensMaster.getDetailedInternalComponents()],
    ['competitor-comparison', () => CameraLensMaster.getCompetitorComparison()]
  ];

  for (const [operation, run] of operations) {
    const result = run();
    assert.strictEqual(result.success, false, `${operation} remains unavailable without sourced evidence`);
    assert.strictEqual(result.status, 'unavailable');
    assert.strictEqual(result.validationLevel, 'experimental');
  }

  const paraxial = CameraLensMaster.traceParaxialSystem(
    {
      initialRefractiveIndex: 1.0,
      surfaces: [
        { radius: 50, refractiveIndex: 1.5, thickness: 5 },
        { radius: -50, refractiveIndex: 1.0, thickness: 0 }
      ]
    },
    {
      rayHeightMm: 1,
      rayAngleRad: 0
    }
  );
  assert.strictEqual(paraxial.success, true, 'explicit surface system and ray inputs retain the paraxial tracer');
  assert.strictEqual(paraxial.rayHistory.length, 3);
  assert.ok(Number.isFinite(paraxial.finalY));
  assert.ok(paraxial.finalAngle < 0);

  const missingRayInputs = CameraLensMaster.traceParaxialSystem({
    initialRefractiveIndex: 1.0,
    surfaces: [
      { radius: 50, refractiveIndex: 1.5, thickness: 5 },
      { radius: -50, refractiveIndex: 1.0, thickness: 0 }
    ]
  });
  assert.strictEqual(missingRayInputs.success, false);
  assert.strictEqual(missingRayInputs.error.code, 'INVALID_INPUT');

  const missingInitialIndex = CameraLensMaster.traceParaxialSystem(
    {
      surfaces: [
        { radius: 50, refractiveIndex: 1.5, thickness: 5 },
        { radius: -50, refractiveIndex: 1.0, thickness: 0 }
      ]
    },
    {
      rayHeightMm: 1,
      rayAngleRad: 0
    }
  );
  assert.strictEqual(missingInitialIndex.success, false);
  assert.strictEqual(missingInitialIndex.error.code, 'INVALID_INPUT');

  const invalidSystem = CameraLensMaster.traceParaxialSystem({ surfaces: [{}] });
  assert.strictEqual(invalidSystem.success, false);
  assert.strictEqual(invalidSystem.error.code, 'INVALID_INPUT');

  const callerPrescription = {
    focalLengthMm: 50,
    objectSpaceMaterial: 1,
    gapMaterial: 1,
    imageSpaceMaterial: 1,
    elements: [
      {
        id: 'caller-element',
        radiusFrontMm: 50,
        radiusRearMm: -50,
        centerThicknessMm: 5,
        clearApertureMm: 10,
        zPosMm: 0,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        opticalMaterial: { nd: 1.5, nF: 1.51, nC: 1.49 }
      }
    ]
  };
  const prescriptionResult = CameraLensMaster.getPrescription(callerPrescription);
  assert.strictEqual(prescriptionResult.success, true);
  assert.strictEqual(prescriptionResult.prescription, callerPrescription);

  const opticalOptions = { entrancePupilRadiusMm: 2, fieldAngleDeg: 3 };
  const seidel = CameraLensMaster.evaluateSeidelAberrations(callerPrescription, opticalOptions);
  assert.strictEqual(seidel.success, true);
  assert.ok(Number.isFinite(seidel.seidelSums.SI_Spherical));

  const chromatic = CameraLensMaster.evaluateChromaticAberration(callerPrescription, opticalOptions);
  assert.strictEqual(chromatic.success, true);
  assert.ok(Number.isFinite(chromatic.longitudinalChromaticMm));
  assert.ok(Number.isFinite(chromatic.transverseChromaticMm));

  const mtf = CameraLensMaster.evaluateMTFPerformance(callerPrescription, {
    fStop: 8,
    fieldAngleDeg: 0,
    numRings: 2,
    raysPerRing: 4,
    wavelengthUm: 0.55,
    pupilPlaneZMm: -10,
    sensorZMm: 54.4,
    maxFrequencyLpMm: 100
  });
  assert.strictEqual(mtf.success, true);
  assert.ok(mtf.spotDiagram.count > 0);
  assert.ok(mtf.mtf.tangentialMTF.length > 0);

  const invalidMtf = CameraLensMaster.evaluateMTFPerformance(callerPrescription, {});
  assert.strictEqual(invalidMtf.success, false);
  assert.strictEqual(invalidMtf.error.code, 'INVALID_INPUT');

  const total = operations.length + 9;
  console.log(`[Experimental lens example] ${total}/${total} compatibility and explicit-input checks passed.`);
  return { total, passed: total };
}

if (require.main === module) runCameraLensMasterTests();

module.exports = { runCameraLensMasterTests };
