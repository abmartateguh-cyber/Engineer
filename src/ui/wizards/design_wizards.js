/**
 * Bundled experimental design examples for guided UI workflows.
 * These examples do not establish design compliance, validation, or production readiness.
 */

'use strict';

const { SymbolicReasoner } = require('../../core/ai/symbolic_reasoner');
const { DropTestSimulator } = require('../../core/cae/drop_test');
const { OpticalEngine } = require('../../core/optics/optical_engine');

/**
 * Plain-English summary for diagnostic context only.
 */
class PlainEnglishErrorTranslator {
  static translate(diagnosticEvent = {}) {
    const { domain = 'universal', code = 'UNSPECIFIED', rawError } = diagnosticEvent;
    const suppliedText = rawError ? String(rawError) : `Diagnostic code: ${String(code)}.`;
    return {
      severity: 'INFO',
      domain,
      title: 'Diagnostic context only',
      plainEnglishAdvice: suppliedText,
      suggestedFix:
        'No automated engineering recommendation is available. Review the inputs, assumptions, and applicable requirements independently.',
      oneClickAction: null,
      validationLevel: 'experimental'
    };
  }
}

/**
 * 1. Consumer Device Drop Test Wizard
 */
class DropTestWizard {
  runWizard(inputs = {}) {
    const { phoneMassKg, dropHeightM, impactAngle } = inputs;
    if (
      !Number.isFinite(phoneMassKg) ||
      phoneMassKg <= 0 ||
      !Number.isFinite(dropHeightM) ||
      dropHeightM <= 0 ||
      !['corner', 'edge', 'face'].includes(impactAngle)
    ) {
      throw new TypeError('DropTestWizard requires phoneMassKg, dropHeightM, and impactAngle (corner, edge, or face).');
    }

    const dropSimResult = DropTestSimulator.runSimulation({
      dropHeight: dropHeightM,
      phoneMass: phoneMassKg,
      impactAngle
    });

    return {
      wizard: 'DropTestWizard',
      validationLevel: 'experimental',
      screeningStatus: 'EXPERIMENTAL_ESTIMATE_ONLY',
      status: 'EXPERIMENTAL_ESTIMATE_ONLY',
      model: dropSimResult.model,
      inputs: { phoneMassKg, dropHeightM, impactAngle },
      modelAssumptions: dropSimResult.modelAssumptions,
      physics: {
        impactVelocityEstimateMs: dropSimResult.impactVelocity,
        peakForceEstimateN: dropSimResult.peakForce_N,
        peakDecelerationEstimateG: dropSimResult.peakDeceleration_G,
        peakChassisStressEstimateMPa: dropSimResult.peakChassisStress_MPa,
        peakScreenStressEstimateMPa: dropSimResult.peakScreenStress_MPa
      },
      plainSummary: `Experimental impact estimate for a ${dropHeightM} m drop of a ${phoneMassKg} kg device: impact velocity ${dropSimResult.impactVelocity} m/s and peak force ${dropSimResult.peakForce_N} N under bundled assumptions. This is not a pass/fail test or material failure assessment.`
    };
  }
}

/**
 * 2. Drone & UAV Airframe & Flight Wizard
 */
class DroneDesignWizard {
  constructor() {
    this.reasoner = new SymbolicReasoner();
  }

  runWizard(inputs = {}) {
    const {
      payloadKg,
      frameMassKg,
      batteryMassKg,
      propellerDiameterInches,
      rotorCount,
      figureOfMerit,
      airDensityKgM3,
      gravityMPerS2
    } = inputs;
    const numericInputs = {
      payloadKg,
      frameMassKg,
      batteryMassKg,
      propellerDiameterInches,
      figureOfMerit,
      airDensityKgM3,
      gravityMPerS2
    };
    const invalid = Object.entries(numericInputs)
      .filter(([, value]) => !Number.isFinite(value) || value <= 0)
      .map(([name]) => name);
    if (invalid.length > 0 || !Number.isInteger(rotorCount) || rotorCount < 1 || figureOfMerit > 1) {
      const missing = invalid.length > 0 ? invalid : [];
      if (!Number.isInteger(rotorCount) || rotorCount < 1) missing.push('rotorCount (positive integer)');
      if (Number.isFinite(figureOfMerit) && figureOfMerit > 1) missing.push('figureOfMerit (at most 1)');
      throw new TypeError(
        `Drone hover estimate requires explicit valid inputs: ${[
          ...missing,
          ...(missing.length
            ? []
            : [
                'payloadKg, frameMassKg, batteryMassKg, propellerDiameterInches, rotorCount, figureOfMerit, airDensityKgM3, gravityMPerS2'
              ])
        ].join(', ')}.`
      );
    }

    const allUpMassKg = payloadKg + frameMassKg + batteryMassKg;
    const aero = this.reasoner.knowledgeGraph.calculateDroneHoverAerodynamics(
      allUpMassKg,
      rotorCount,
      propellerDiameterInches,
      figureOfMerit,
      airDensityKgM3,
      gravityMPerS2
    );

    return {
      wizard: 'DroneDesignWizard',
      validationLevel: 'experimental',
      screeningStatus: 'EXPERIMENTAL_ESTIMATE_ONLY',
      status: 'EXPERIMENTAL_ESTIMATE_ONLY',
      model: 'actuator-disk momentum-theory hover-power estimate',
      inputs: {
        payloadKg,
        frameMassKg,
        batteryMassKg,
        allUpMassKg,
        propellerDiameterInches,
        rotorCount,
        figureOfMerit,
        airDensityKgM3,
        gravityMPerS2
      },
      flightSpecs: {
        rotorCount,
        allUpMassKg,
        requiredTotalThrustN: aero.totalWeightN,
        requiredThrustPerRotorN: aero.thrustPerRotorN,
        totalDiskAreaM2: aero.totalDiskAreaM2,
        inducedVelocityMs: aero.inducedVelocityMs,
        idealHoverPowerWatts: aero.idealHoverPowerWatts,
        hoverPowerWatts: aero.actualHoverPowerWatts
      },
      plainSummary: `Experimental actuator-disk hover-power estimate for ${rotorCount} rotors and ${allUpMassKg} kg supplied all-up mass: ${aero.actualHoverPowerWatts.toFixed(2)} W and ${aero.thrustPerRotorN.toFixed(2)} N required per rotor. Endurance and thrust margin were not calculated because usable battery energy and available motor/propeller thrust were not supplied. This is not a flight-readiness assessment.`
    };
  }
}

/**
 * 3. Camera Lens Optical Design Wizard
 */
class CameraLensWizard {
  runWizard(inputs = {}) {
    const { focalLengthMm, fStop, subjectDistM, wavelengthNm, circleOfConfusionMm } = inputs;
    if (
      !Number.isFinite(focalLengthMm) ||
      focalLengthMm <= 0 ||
      !Number.isFinite(fStop) ||
      fStop <= 0 ||
      !Number.isFinite(subjectDistM) ||
      subjectDistM <= 0 ||
      !Number.isFinite(wavelengthNm) ||
      wavelengthNm <= 0 ||
      !Number.isFinite(circleOfConfusionMm) ||
      circleOfConfusionMm <= 0
    ) {
      throw new TypeError(
        'CameraLensWizard requires positive focalLengthMm, fStop, subjectDistM, wavelengthNm, and circleOfConfusionMm inputs.'
      );
    }

    const metrics = OpticalEngine.solveOpticalMetrics(
      focalLengthMm,
      fStop,
      subjectDistM,
      wavelengthNm,
      circleOfConfusionMm
    );

    return {
      wizard: 'CameraLensWizard',
      validationLevel: 'experimental',
      screeningStatus: 'EXPERIMENTAL_ESTIMATE_ONLY',
      status: 'EXPERIMENTAL_ESTIMATE_ONLY',
      model: 'experimental-scalar-optics-estimates',
      opticalSpecs: {
        focalLengthMm,
        fStop,
        subjectDistM,
        wavelengthNm,
        circleOfConfusionMm,
        apertureDiameterMm: Math.round((focalLengthMm / fStop) * 10) / 10,
        airyDiskDiameterUm: Math.round(metrics.airyDiskDiameterUm * 10) / 10,
        hyperfocalDistanceM: metrics.hyperfocalDistanceM,
        depthOfFieldM: metrics.depthOfFieldM,
        mtf50ResolutionLpMm: metrics.mtf50ResolutionLpMm
      },
      plainSummary: `Experimental scalar optics estimates use ${focalLengthMm} mm, f/${fStop}, a ${subjectDistM} m subject distance, ${wavelengthNm} nm wavelength, and ${circleOfConfusionMm} mm circle of confusion. No prescription ray trace or independently validated image-quality result was calculated.`
    };
  }
}

/**
 * 4. High-Speed PCB & EDA Wizard
 */
class PCBDesignWizard {
  runWizard(inputs = {}) {
    const { layerCount, dielectricHeightMm: hMm, targetImpedanceOhm: targetZ0, er, copperThicknessMm: tMm } = inputs;
    if (
      !Number.isInteger(layerCount) ||
      layerCount < 1 ||
      !Number.isFinite(hMm) ||
      hMm <= 0 ||
      !Number.isFinite(targetZ0) ||
      targetZ0 <= 0 ||
      !Number.isFinite(er) ||
      er <= 0 ||
      !Number.isFinite(tMm) ||
      tMm <= 0
    ) {
      throw new TypeError(
        'PCBDesignWizard requires positive layerCount, dielectricHeightMm, targetImpedanceOhm, er, and copperThicknessMm inputs.'
      );
    }

    // Bundled illustrative microstrip approximation; not a standards assessment.
    const factor = (targetZ0 * Math.sqrt(er + 1.41)) / 87.0;
    const ratio = Math.exp(factor);
    const traceWidthMm = ((5.98 * hMm) / ratio - tMm) / 0.8;
    if (!Number.isFinite(traceWidthMm) || traceWidthMm <= 0) {
      throw new TypeError('PCBDesignWizard inputs produce a nonpositive or non-finite trace-width estimate.');
    }

    return {
      wizard: 'PCBDesignWizard',
      validationLevel: 'experimental',
      screeningStatus: 'EXPERIMENTAL_ESTIMATE_ONLY',
      status: 'EXPERIMENTAL_ESTIMATE_ONLY',
      model: 'experimental-microstrip-formula-estimate',
      stackup: {
        layerCount,
        dielectricHeightMm: hMm,
        dielectricConstant: er,
        copperThicknessMm: tMm,
        targetImpedanceOhm: targetZ0,
        estimatedTraceWidthMm: Math.round(traceWidthMm * 1000) / 1000,
        estimatedTraceWidthMil: Math.round((traceWidthMm / 0.0254) * 10) / 10
      },
      plainSummary: `Experimental ${layerCount}-layer board estimate: the selected microstrip approximation returns ${Math.round(traceWidthMm * 100) / 100} mm trace width for a ${targetZ0} Ω target. No board layout or manufacturing files were generated; this is not impedance verification, DRC, or manufacturing release.`
    };
  }
}

module.exports = {
  PlainEnglishErrorTranslator,
  DropTestWizard,
  DroneDesignWizard,
  CameraLensWizard,
  PCBDesignWizard
};
