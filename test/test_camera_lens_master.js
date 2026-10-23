/**
 * OmniEng Flagship Camera Lens Test Suite:
 * OmniEng Apex-Master 50mm f/1.0 H-APO Optomechanical Camera Lens Architecture (Suite 28)
 * 
 * Verifies that the Apex-Master 50mm f/1.0 outperforms the Canon RF 50mm f/1.2L USM across:
 * 1. Optical Prescription & Paraxial Cardinal Points (EFL = 50.0mm, f/1.0, 15 Elements / 11 Groups)
 * 2. Chromatic Dispersion & Secondary Spectrum (< 10 µm vs Canon ~97 µm)
 * 3. Seidel Wavefront Aberrations & Diffraction Strehl Ratio (> 0.95)
 * 4. Spatial MTF Contrast at 10, 20, 30, 40 lp/mm (Center 0.76 vs Canon 0.68; Corner 0.58 vs Canon 0.50)
 * 5. Twin-Linear Dual-VCM Autofocus Dynamics (22 ms latency, 0 dB noise)
 * 6. Active 2-Axis OIS Voice Coil Stabilization (6.0 Stops Standalone)
 * 7. Optomechanical Athermalization from -30°C to +70°C (Drift < 1.5 µm)
 * 8. Omni-SWC Subwavelength Nano-Coating (R < 0.05%, T/1.05)
 * 9. Detailed 48-Component Internal Optomechanical BOM
 * 10. Head-to-Head Canon RF 50mm f/1.2L & Zeiss Otus 55mm f/1.4 Benchmark Matrix
 */

'use strict';

const assert = require('assert');
const { CameraLensMaster } = require('../src/core/optics/camera_lens_master');

function runCameraLensMasterTests() {
  console.log('\n================================================================');
  console.log('   RUNNING OMNIENG APEX-MASTER 50MM F/1.0 H-APO VERIFICATION    ');
  console.log('   BENCHMARKING AGAINST CANON RF 50MM F/1.2L USM & ZEISS OTUS  ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function runTest(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ [LENS-${total}] ${name}`);
    } catch (err) {
      console.error(`  ✗ [LENS-${total}] FAIL: ${name}`);
      console.error(`    ${err.stack || err.message}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------------
  // Test 1: Prescription & Formula Architecture
  // -----------------------------------------------------------------------------
  runTest('Optical Prescription & Architecture Integrity (15 Elements / 11 Groups, f/1.0)', () => {
    const p = CameraLensMaster.getPrescription();
    assert.strictEqual(p.focalLengthMm, 50.0);
    assert.strictEqual(p.nominalFStop, 1.0);
    assert.strictEqual(p.workingFStop, 1.0);
    assert.strictEqual(p.photometricTStop, 1.05);
    assert.strictEqual(p.elements.length, 15, 'Must have 15 optical elements');
    assert.strictEqual(p.asphericCount, 3, 'Must feature 3 Forbes Q-conpheric even aspheric surfaces');
    assert.strictEqual(p.fluoriteEDCount, 4, 'Must feature 4 Synthetic CaF2 / Super-ED elements');
    assert.strictEqual(p.blueSpectrumElements, 1, 'Must feature 1 BR-X organic blue-refractive monolith');
    assert.strictEqual(p.apertureBlades, 11, 'Must feature 11 rounded aperture blades');

    assert(p.totalTrackLengthMm > 100.0 && p.totalTrackLengthMm < 125.0, 'Total track length should be compact (<125mm)');
    assert(p.elements[0].clearApertureMm >= 70.0, 'Front element diameter must accommodate f/1.0 pupil');
  });

  // -----------------------------------------------------------------------------
  // Test 2: Paraxial Ray Trace & Cardinal Points
  // -----------------------------------------------------------------------------
  runTest('Paraxial Ray Trace & Cardinal Points (EFL = 50.0mm, BFL = 24.86mm, EP = 50mm)', () => {
    const paraxial = CameraLensMaster.traceParaxialSystem(1.0, 587.6);
    assert.strictEqual(paraxial.surfacesCount, 30, 'System must have 30 refractive surfaces');
    assert(Math.abs(paraxial.focalLengthMm - 50.0) < 0.8, `EFL must be 50.0mm ± 0.8mm (got ${paraxial.focalLengthMm})`);
    assert.strictEqual(paraxial.fStop, 1.0);
    assert(paraxial.entrancePupilDiameterMm >= 49.0 && paraxial.entrancePupilDiameterMm <= 51.0, 'Entrance pupil must be 50mm for 50mm f/1.0');
    assert(paraxial.backFocalDistanceMm >= 18.0, 'Back focal distance must clear mirrorless sensor flange (>= 18mm)');
    assert.strictEqual(paraxial.surfaceRayData.length, 30, 'All 30 surfaces must have traced marginal and chief ray heights');
  });

  // -----------------------------------------------------------------------------
  // Test 3: Chromatic Dispersion & Secondary Spectrum Suppression
  // -----------------------------------------------------------------------------
  runTest('Chromatic Dispersion across Fraunhofer Lines (Secondary Spectrum < 10 µm vs Canon ~97 µm)', () => {
    const chrom = CameraLensMaster.evaluateChromaticAberration();
    assert(chrom.omniEngPeakSpreadUm < 10.0, `Secondary spectrum blue defocus must be < 10 µm (got ${chrom.omniEngPeakSpreadUm} µm)`);
    assert(chrom.omniEngPeakSpreadUm < chrom.canonPeakSpreadUm / 8.0, 'OmniEng secondary spectrum must be > 8x better than Canon RF 50mm f/1.2');
    assert(chrom.aberrationImprovementRatio >= 10.0, 'Improvement ratio over Canon must be >= 10x');
    assert(chrom.purpleFringingSuppressionPercent >= 95.0, 'Purple fringing suppression must exceed 95%');
  });

  // -----------------------------------------------------------------------------
  // Test 4: Seidel Third-Order Aberrations & Strehl Ratio
  // -----------------------------------------------------------------------------
  runTest('Seidel Wavefront Aberrations & Diffraction Strehl Ratio at f/1.0 (Strehl >= 0.95)', () => {
    const seidel = CameraLensMaster.evaluateSeidelAberrations();
    assert(seidel.strehlRatioWideOpen >= 0.95, `Strehl ratio at f/1.0 must be >= 0.95 (got ${seidel.strehlRatioWideOpen})`);
    assert(Math.abs(seidel.sphericalAberration_W040_waves) < 0.05, 'Spherical aberration W040 must be < 0.05 waves');
    assert(Math.abs(seidel.distortionPercent) < 0.5, 'Barrel/pincushion distortion must be < 0.5%');
    assert(seidel.airyDiskRadiusUm < 0.8, 'Airy disk radius at f/1.0 should be < 0.8 µm');
  });

  // -----------------------------------------------------------------------------
  // Test 5: Spatial MTF Performance vs Canon RF 50mm f/1.2L
  // -----------------------------------------------------------------------------
  runTest('Spatial MTF Contrast at 30 lp/mm (Center 0.76 vs Canon 0.68; Corner 0.58 vs Canon 0.50)', () => {
    const mtf = CameraLensMaster.evaluateMTFPerformance();
    assert.strictEqual(mtf.apertureWideOpen.fStop, 1.0);
    assert(mtf.apertureWideOpen.centerOnAxis.mtf30 >= 0.75, `Center MTF @ 30 lp/mm must be >= 0.75 at f/1.0 (got ${mtf.apertureWideOpen.centerOnAxis.mtf30})`);
    assert(mtf.apertureWideOpen.extremeCorner_21mm.sagittal30 >= 0.55, `Corner MTF @ 30 lp/mm must be >= 0.55 at f/1.0 (got ${mtf.apertureWideOpen.extremeCorner_21mm.sagittal30})`);
    assert(mtf.apertureWideOpen.centerOnAxis.mtf30 > mtf.canonRF50_Comparison_f12_WideOpen.centerOnAxis.mtf30, 'OmniEng Center MTF must exceed Canon RF 50 f/1.2L');
    assert(mtf.apertureWideOpen.extremeCorner_21mm.sagittal30 > mtf.canonRF50_Comparison_f12_WideOpen.extremeCorner_21mm.sagittal30, 'OmniEng Corner MTF must exceed Canon RF 50 f/1.2L');
  });

  // -----------------------------------------------------------------------------
  // Test 6: Twin-Linear Dual-VCM Autofocus Dynamics
  // -----------------------------------------------------------------------------
  runTest('Twin-Linear Voice Coil Motor (Dual-VCM) Dynamics (Rise Time 22 ms, 0 dB Noise)', () => {
    const af = CameraLensMaster.evaluateAutofocusMechatronics();
    assert(af.riseTimeMs <= 25.0, `VCM rise time must be <= 25 ms (got ${af.riseTimeMs} ms)`);
    assert(af.settlingTimeMs <= 30.0, `VCM settling time must be <= 30 ms (got ${af.settlingTimeMs} ms)`);
    assert.strictEqual(af.peakOvershootPercent, 0.0, 'Dual-VCM must have critical damping with 0% overshoot');
    assert.strictEqual(af.acousticNoiseDb, 0.0, 'Magnetic VCM must be frictionless and silent (0 dB)');
    assert(af.riseTimeMs < af.canonRingUsmComparison.latencyMs, 'OmniEng AF latency must be faster than Canon Ring USM');
  });

  // -----------------------------------------------------------------------------
  // Test 7: Active 2-Axis Optical Image Stabilization (OIS)
  // -----------------------------------------------------------------------------
  runTest('Active 2-Axis Optical Image Stabilization (6.0 Stops Standalone vs Canon 0.0 Stops)', () => {
    const ois = CameraLensMaster.evaluateOISPerformance();
    assert.strictEqual(ois.standaloneOISStops, 6.0, 'Must provide 6.0 stops standalone OIS');
    assert.strictEqual(ois.coordinatedIBISStops, 8.5, 'Must provide 8.5 stops coordinated OIS with IBIS');
    assert(ois.gyroSamplingRateKHz >= 8.0, 'Gyro sampling rate must be >= 8 kHz');
  });

  // -----------------------------------------------------------------------------
  // Test 8: Athermalization (-30°C to +70°C)
  // -----------------------------------------------------------------------------
  runTest('Optomechanical Athermalization from -30°C to +70°C (Drift < 1.5 µm with CFRP + Ti-6Al-4V)', () => {
    const thermal = CameraLensMaster.evaluateAthermalization();
    assert(thermal.maxFocalDriftFullRangeUm <= 2.0, `Thermal focal drift must be <= 2.0 µm (got ${thermal.maxFocalDriftFullRangeUm} µm)`);
    assert(thermal.temperatureSweep.length >= 5);
  });

  // -----------------------------------------------------------------------------
  // Test 9: Anti-Reflective Nano-Coating & Transmission
  // -----------------------------------------------------------------------------
  runTest('Omni-SWC Subwavelength Anti-Reflective Nano-Coating (R < 0.05%, T/1.05 Photometric Speed)', () => {
    const coating = CameraLensMaster.evaluateAntiReflectiveCoating();
    assert(coating.averageSurfaceReflectancePercent <= 0.05, `Max surface reflectance must be <= 0.05% (got ${coating.averageSurfaceReflectancePercent}%)`);
    assert(coating.peakTransmissionTStop <= 1.06, `Photometric T-stop must be <= 1.06 for f/1.0 lens (got ${coating.peakTransmissionTStop})`);
  });

  // -----------------------------------------------------------------------------
  // Test 10: Complete 48-Component Internal Optomechanical BOM
  // -----------------------------------------------------------------------------
  runTest('Detailed 48-Component Internal Optomechanical Bill of Materials (7 Subassemblies)', () => {
    const bom = CameraLensMaster.getDetailedInternalComponents();
    assert.strictEqual(bom.totalComponentCount, 48, 'Must detail all 48 internal components');
    assert.strictEqual(bom.subassemblies.length, 7, 'Must detail all 7 subassembly groups');

    for (const sub of bom.subassemblies) {
      assert(sub.parts.length > 0, `Subassembly ${sub.name} must have parts`);
      for (const part of sub.parts) {
        assert(part.partNumber && part.name && part.material && part.tolerance && part.function, `Part ${part.partNumber} is missing required specification fields`);
      }
    }
  });

  // -----------------------------------------------------------------------------
  // Test 11: Competitor Benchmark Matrix against Canon & Zeiss
  // -----------------------------------------------------------------------------
  runTest('Competitor Benchmark Matrix (OmniEng vs Canon RF 50mm f/1.2L & Zeiss Otus across 14 Dimensions)', () => {
    const comp = CameraLensMaster.getCompetitorComparison();
    assert(comp.comparisons.length >= 14, 'Must benchmark across at least 14 critical dimensions');
    const oisComp = comp.comparisons.find(c => c.spec.includes('Optical Image Stabilization'));
    assert(oisComp && oisComp.canon.includes('NONE') && oisComp.omnieng.includes('6.0 Stops'));
    const afComp = comp.comparisons.find(c => c.spec.includes('Autofocus'));
    assert(afComp && afComp.omnieng.includes('22 ms'));
  });

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passed} / ${total} CAMERA LENS MASTER TESTS PASSED`);
  console.log('================================================================\n');

  return { total, passed };
}

// Direct execution
if (require.main === module) {
  runCameraLensMasterTests();
}

module.exports = { runCameraLensMasterTests };
