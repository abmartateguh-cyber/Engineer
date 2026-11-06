'use strict';

const assert = require('assert');
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');

(async () => {
  console.log('================================================================');
  console.log('       TESTING OPTICS & RAY TRACING ENGINE ADAPTER              ');
  console.log('================================================================\n');

  const adapter = new OpticsEngineAdapter();
  const caps = adapter.describeCapabilities();
  assert.strictEqual(caps.domain, 'optics');
  assert(caps.supportedOperations.includes('trace_skew_rays'));
  assert(caps.supportedOperations.includes('calculate_refractive_index'));
  assert(caps.supportedOperations.includes('trace_polarization'));

  // 1. 3D Skew Ray Tracing through a Plano-Convex Singlet Lens
  console.log('[1] Testing 3D Skew Ray Tracing through Singlet Lens...');
  const traceReq = new JobRequest({
    domain: 'optics',
    operation: 'trace_skew_rays',
    parameters: {
      surfaces: [
        // S1: Convex front surface (R = 50mm, thickness = 5mm, n = 1.5168 N-BK7)
        {
          radius: 50.0,
          zVertex: 10.0,
          clearRadius: 20.0,
          nIncident: 1.0,
          nTransmitted: 1.5168,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        },
        // S2: Flat rear surface
        {
          radius: 0.0,
          zVertex: 15.0,
          clearRadius: 20.0,
          nIncident: 1.5168,
          nTransmitted: 1.0,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        }
      ],
      pupilRadiusMm: 8.0,
      pupilPlaneZMm: -10.0,
      numRings: 3,
      raysPerRing: 6,
      fieldAngleDeg: 0.0,
      wavelengthUm: 0.58756,
      sensorZ: 105.0 // Approximate focal plane: f ~ R/(n-1) = 50/0.5168 ~ 96.7mm from rear
    }
  });

  const traceEvents = [];
  const traceRes = await adapter.execute(traceReq, (e) => traceEvents.push(e));
  assert.strictEqual(traceRes.status, JobStatus.SUCCEEDED);
  assert(traceRes.outputData.totalRays > 10, 'Must generate and trace rays');
  assert(traceRes.outputData.activeRays > 0, 'Active rays must reach sensor');
  assert(traceRes.outputData.spotDiagram.length === traceRes.outputData.activeRays);
  assert.strictEqual(traceRes.outputData.rayGeneration.pupilPlaneZMm, -10.0);
  console.log(
    `  ✓ PASSED: Traced ${traceRes.outputData.activeRays}/${traceRes.outputData.totalRays} rays to sensor. Spot size: ${traceRes.outputData.spotDiagram.length} points\n`
  );

  const missingPupilPlaneParameters = { ...traceReq.parameters };
  delete missingPupilPlaneParameters.pupilPlaneZMm;
  const missingPupilPlaneReq = new JobRequest({
    domain: 'optics',
    operation: 'trace_skew_rays',
    parameters: missingPupilPlaneParameters
  });
  await assert.rejects(
    adapter.execute(missingPupilPlaneReq),
    (error) => error.code === 'INVALID_INPUT',
    'Pupil ray generation must not assume an entrance plane position'
  );

  const missingSensorParameters = { ...traceReq.parameters };
  delete missingSensorParameters.sensorZ;
  const missingSensorReq = new JobRequest({
    domain: 'optics',
    operation: 'trace_skew_rays',
    parameters: missingSensorParameters
  });
  await assert.rejects(
    adapter.execute(missingSensorReq),
    (error) => error.code === 'INVALID_INPUT',
    'Ray tracing must not omit the image plane'
  );

  const zeroPupilPlaneReq = new JobRequest({
    domain: 'optics',
    operation: 'generate_pupil_rays',
    parameters: {
      pupilRadiusMm: 5.0,
      pupilPlaneZMm: 0.0,
      numRings: 1,
      raysPerRing: 2,
      fieldAngleDeg: 0.0,
      wavelengthUm: 0.55
    }
  });
  const zeroPupilPlaneResult = await adapter.execute(zeroPupilPlaneReq);
  assert.strictEqual(zeroPupilPlaneResult.outputData.rays[0].z, 0.0);

  const missingWavelengthParameters = { ...zeroPupilPlaneReq.parameters };
  delete missingWavelengthParameters.wavelengthUm;
  const missingWavelengthReq = new JobRequest({
    domain: 'optics',
    operation: 'generate_pupil_rays',
    parameters: missingWavelengthParameters
  });
  await assert.rejects(
    adapter.execute(missingWavelengthReq),
    (error) => error.code === 'INVALID_INPUT',
    'Pupil ray generation must not select an implicit wavelength'
  );

  // 2. Sellmeier Dispersion & Refractive Index Calculation
  console.log('[2] Testing Sellmeier Dispersion Equation...');
  // Standard N-BK7 Schott Sellmeier coefficients:
  // B = [1.03961212, 0.231792344, 1.01046945]
  // C = [0.00600069867, 0.0200179144, 103.560653]
  const customGlassRecord = {
    name: 'N-BK7',
    formula: 'sellmeier1',
    referenceTemperatureC: 20.0,
    B: [1.03961212, 0.231792344, 1.01046945],
    C: [0.00600069867, 0.0200179144, 103.560653],
    dndTPerK: 0.000003
  };
  const { dndTPerK: _omittedDndTPerK, ...customGlassWithoutThermoOptic } = customGlassRecord;
  const indexReq = new JobRequest({
    domain: 'optics',
    operation: 'calculate_refractive_index',
    parameters: {
      customGlassRecord,
      wavelengthUm: 0.58756, // Helium d-line
      temperatureC: 20.0
    }
  });

  const indexRes = await adapter.execute(indexReq);
  assert.strictEqual(indexRes.status, JobStatus.SUCCEEDED);
  // N-BK7 refractive index at d-line is ~1.51680
  const nd = indexRes.outputData.refractiveIndex;
  assert(Math.abs(nd - 1.5168) < 0.001, `N-BK7 index expected ~1.5168, got ${nd}`);
  const vd = indexRes.outputData.properties.Abbe_Vd;
  assert(vd > 60 && vd < 70, `N-BK7 Abbe number vd should be ~64.17, got ${vd}`);
  assert.strictEqual(indexRes.outputData.properties.temperatureC, 20.0);
  assert.strictEqual(indexRes.outputData.properties.dataReferenceTemperatureC, 20.0);
  console.log(`  ✓ PASSED: Sellmeier evaluated: nd = ${nd}, Abbe number vd = ${vd.toFixed(2)}\n`);

  const missingTemperatureReq = new JobRequest({
    domain: 'optics',
    operation: 'calculate_refractive_index',
    parameters: { customGlassRecord, wavelengthUm: 0.58756 }
  });
  await assert.rejects(
    adapter.execute(missingTemperatureReq),
    (error) => error.code === 'INVALID_INPUT',
    'The dispersion adapter must reject a missing temperature instead of supplying 20 C'
  );

  const zeroTemperatureReq = new JobRequest({
    domain: 'optics',
    operation: 'calculate_refractive_index',
    parameters: { customGlassRecord, wavelengthUm: 0.58756, temperatureC: 0.0 }
  });
  const zeroTemperatureResult = await adapter.execute(zeroTemperatureReq);
  assert.strictEqual(zeroTemperatureResult.outputData.temperatureC, 0.0);
  assert.strictEqual(zeroTemperatureResult.outputData.properties.temperatureC, 0.0);
  assert.strictEqual(zeroTemperatureResult.outputData.properties.dataReferenceTemperatureC, 20.0);
  assert.notStrictEqual(zeroTemperatureResult.outputData.refractiveIndex, nd);

  const zeroWavelengthReq = new JobRequest({
    domain: 'optics',
    operation: 'calculate_refractive_index',
    parameters: { customGlassRecord, wavelengthUm: 0.0, temperatureC: 20.0 }
  });
  await assert.rejects(
    adapter.execute(zeroWavelengthReq),
    (error) => error.code === 'INVALID_INPUT',
    'A zero wavelength must be rejected instead of replaced by the Fraunhofer d-line'
  );

  const missingThermoOpticReq = new JobRequest({
    domain: 'optics',
    operation: 'calculate_refractive_index',
    parameters: {
      customGlassRecord: customGlassWithoutThermoOptic,
      wavelengthUm: 0.58756,
      temperatureC: 60.0
    }
  });
  await assert.rejects(
    adapter.execute(missingThermoOpticReq),
    (error) => error.code === 'UNSUPPORTED',
    'A non-reference temperature must not use a fabricated thermo-optic correction'
  );

  const nonDefaultReferenceReq = new JobRequest({
    domain: 'optics',
    operation: 'calculate_refractive_index',
    parameters: {
      customGlassRecord: { ...customGlassWithoutThermoOptic, referenceTemperatureC: 25.0 },
      wavelengthUm: 0.58756,
      temperatureC: 25.0
    }
  });
  const nonDefaultReferenceResult = await adapter.execute(nonDefaultReferenceReq);
  assert.strictEqual(nonDefaultReferenceResult.outputData.temperatureC, 25.0);
  assert.strictEqual(nonDefaultReferenceResult.outputData.properties.dataReferenceTemperatureC, 25.0);
  assert(Math.abs(nonDefaultReferenceResult.outputData.refractiveIndex - nd) < 1e-12);

  // 3. Polarization Optics & Malus' Law
  console.log('[3] Testing Polarization Optics (Malus Law at 45°)...');
  const polReq = new JobRequest({
    domain: 'optics',
    operation: 'trace_polarization',
    parameters: {
      Ex: 1.0,
      Ey: 0.0, // Horizontal linearly polarized light (Intensity = 1.0)
      ExImag: 0.0,
      EyImag: 0.0,
      elements: [
        { type: 'linear_polarizer', angleDeg: 45.0 } // Linear polarizer oriented at 45°
      ]
    }
  });

  const polRes = await adapter.execute(polReq);
  assert.strictEqual(polRes.status, JobStatus.SUCCEEDED);
  // Malus' law: I = I0 * cos^2(45°) = 1.0 * 0.5 = 0.5
  const finalIntensity = polRes.outputData.intensity;
  assert(Math.abs(finalIntensity - 0.5) < 1e-4, `Expected intensity 0.5 by Malus Law, got ${finalIntensity}`);
  console.log(`  ✓ PASSED: Polarization verified: I_in=1.0 -> Polarizer(45°) -> I_out=${finalIntensity.toFixed(4)}\n`);

  const missingJonesInput = new JobRequest({
    domain: 'optics',
    operation: 'trace_polarization',
    parameters: { elements: [] }
  });
  await assert.rejects(
    adapter.execute(missingJonesInput),
    (error) => error.code === 'INVALID_INPUT',
    'Jones propagation must not invent an input field'
  );

  const missingJonesQuadrature = new JobRequest({
    domain: 'optics',
    operation: 'trace_polarization',
    parameters: { Ex: 1, Ey: 0, elements: [] }
  });
  await assert.rejects(
    adapter.execute(missingJonesQuadrature),
    (error) => error.code === 'INVALID_INPUT',
    'Jones propagation must not assume omitted quadrature components are zero'
  );

  const zeroJonesInput = new JobRequest({
    domain: 'optics',
    operation: 'trace_polarization',
    parameters: { Ex: 0, Ey: 0, ExImag: 0, EyImag: 0, elements: [] }
  });
  const zeroJonesResult = await adapter.execute(zeroJonesInput);
  assert.strictEqual(zeroJonesResult.outputData.intensity, 0);

  const zeroIndexFresnelInput = new JobRequest({
    domain: 'optics',
    operation: 'trace_polarization',
    parameters: { fresnel: { n1: 0, n2: 1.5, thetaI: 0 } }
  });
  await assert.rejects(
    adapter.execute(zeroIndexFresnelInput),
    (error) => error.code === 'INVALID_INPUT',
    'A zero refractive index must not be replaced by air'
  );

  const missingCrystalDirection = new JobRequest({
    domain: 'optics',
    operation: 'trace_polarization',
    parameters: { crystal: { no: 1.5, ne: 1.6, opticAxis: [0, 0, 1] } }
  });
  await assert.rejects(
    adapter.execute(missingCrystalDirection),
    (error) => error.code === 'INVALID_INPUT',
    'Crystal splitting must require explicit incident direction and interface normal'
  );

  console.log('================================================================');
  console.log('   ALL OPTICS ENGINE ADAPTER TESTS PASSED!                      ');
  console.log('================================================================\n');
})();
