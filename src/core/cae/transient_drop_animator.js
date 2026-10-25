/**
 * Simplified experimental impact history for interactive scrubbing and playback.
 * This bundled model is not a validated product drop test or material failure analysis.
 */

const MAX_TRANSIENT_STEPS = 10000;

class TransientDropAnimator {
  /** Generates an illustrative time history using bundled contact assumptions. */
  static solveTransientHistory(params = {}) {
    const { dropHeightM, phoneMassKg, impactAngle, totalDurationMs, stepCount } = params;

    if (
      !Number.isFinite(dropHeightM) ||
      dropHeightM <= 0 ||
      !Number.isFinite(phoneMassKg) ||
      phoneMassKg <= 0 ||
      !['corner', 'edge', 'face'].includes(impactAngle)
    ) {
      throw new TypeError(
        'TransientDropAnimator requires dropHeightM in meters, phoneMassKg in kilograms, and impactAngle (corner, edge, or face).'
      );
    }
    if (
      !Number.isFinite(totalDurationMs) ||
      totalDurationMs <= 0 ||
      !Number.isSafeInteger(stepCount) ||
      stepCount < 1 ||
      stepCount > MAX_TRANSIENT_STEPS
    ) {
      throw new TypeError(
        `TransientDropAnimator requires positive totalDurationMs and an integer stepCount between 1 and ${MAX_TRANSIENT_STEPS}.`
      );
    }

    const g = 9.80665;
    // Impact velocity at touch down: v_impact = sqrt(2 * g * h)
    const vImpact = Math.sqrt(2 * g * dropHeightM); // ~5.42 m/s for 1.5m

    // Illustrative contact stiffness and damping selected by orientation.
    const contactPropertiesByAngle = {
      corner: { stiffnessNPerM: 1.2e6, dampingNsPerM: 320.0 },
      edge: { stiffnessNPerM: 2.4e6, dampingNsPerM: 550.0 },
      face: { stiffnessNPerM: 5.5e6, dampingNsPerM: 950.0 }
    };
    const { stiffnessNPerM: kEff, dampingNsPerM: cDamp } = contactPropertiesByAngle[impactAngle];
    const restitutionCoefficient = 0.35;
    const preImpactClearanceM = 0.003;
    const contactOnsetMs = 0.6;
    const dampingDecayFactor = 0.25;
    const referenceDecelerationG = 450;

    const modelAssumptions = {
      gravityMPerS2: g,
      contactStiffnessNPerM: kEff,
      contactDampingNsPerM: cDamp,
      restitutionCoefficient,
      preImpactClearanceM,
      contactOnsetMs,
      dampingDecayFactor,
      referenceDecelerationG,
      totalDurationMs,
      stepCount,
      integrationTimeStepS: (totalDurationMs * 1e-3) / stepCount
    };

    const dt = (totalDurationMs * 1e-3) / stepCount; // seconds per frame
    const dtMs = totalDurationMs / stepCount;

    const tContactMs = modelAssumptions.contactOnsetMs;
    const frames = [];
    let currentZ = modelAssumptions.preImpactClearanceM;
    let currentV = -vImpact;
    let currentContactResponseIndex = 0.0;
    let peakContactResponseIndex = 0.0;
    let peakDecelG = 0.0;
    let cumulativeDissipated = 0.0;

    for (let step = 0; step <= stepCount; step++) {
      const timeMs = step * dtMs;
      let accel = -g;
      let inContact = false;
      let contactPenetration = 0.0;

      if (timeMs >= tContactMs) {
        // Impact phase
        const deltaTContact = (timeMs - tContactMs) * 1e-3;
        // Damped harmonic half-sine response during impact
        const omega = Math.sqrt(kEff / phoneMassKg);
        const contactDuration = Math.PI / omega; // approx duration of impact impulse

        if (deltaTContact <= contactDuration * 1.8) {
          inContact = true;
          // Compression depth
          contactPenetration =
            (vImpact / omega) *
            Math.sin(omega * deltaTContact) *
            Math.exp(-modelAssumptions.dampingDecayFactor * omega * deltaTContact);
          currentZ = Math.min(0, -Math.max(0, contactPenetration));

          // Impact force & deceleration
          const fSpring = kEff * Math.max(0, contactPenetration);
          const fDamp = cDamp * Math.abs(currentV);
          const fContact = fSpring + fDamp;
          accel = fContact / phoneMassKg - g;

          currentV =
            -vImpact *
            Math.cos(omega * deltaTContact) *
            Math.exp(-modelAssumptions.dampingDecayFactor * omega * deltaTContact);

          // Dimensionless contact response for visualization only.
          currentContactResponseIndex = Math.min(
            1.0,
            fContact / (phoneMassKg * modelAssumptions.referenceDecelerationG * g)
          );

          cumulativeDissipated += fDamp * Math.abs(currentV) * dt;
        } else {
          // Rebound phase
          const reboundV = vImpact * modelAssumptions.restitutionCoefficient;
          currentV = reboundV - g * (deltaTContact - contactDuration);
          currentZ = Math.max(0, currentV * (deltaTContact - contactDuration));
          accel = -g;
          currentContactResponseIndex *= 0.85;
        }
      } else {
        // Pre-impact free fall
        currentZ = modelAssumptions.preImpactClearanceM * (1.0 - timeMs / tContactMs);
        currentV = -vImpact;
        accel = -g;
        currentContactResponseIndex = 0.0;
      }

      const currentDecelG = Math.abs(accel / g);
      if (currentDecelG > peakDecelG) peakDecelG = currentDecelG;
      if (currentContactResponseIndex > peakContactResponseIndex)
        peakContactResponseIndex = currentContactResponseIndex;

      // Energy balance calculation
      const kineticEnergy = 0.5 * phoneMassKg * currentV * currentV;
      const strainEnergy = 0.5 * kEff * Math.pow(Math.max(0, contactPenetration), 2);
      const totalEnergy = kineticEnergy + strainEnergy + cumulativeDissipated;

      frames.push({
        frameIndex: step,
        timeMs: Number(timeMs.toFixed(2)),
        inContact,
        positionZ_mm: Number((currentZ * 1000).toFixed(2)),
        velocity_m_s: Number(currentV.toFixed(2)),
        acceleration_G: Number(currentDecelG.toFixed(1)),
        contactResponseIndex: Number(currentContactResponseIndex.toFixed(3)),
        kineticEnergy_J: Number(kineticEnergy.toFixed(3)),
        strainEnergy_J: Number(strainEnergy.toFixed(3)),
        dissipatedEnergy_J: Number(cumulativeDissipated.toFixed(3)),
        totalEnergy_J: Number(totalEnergy.toFixed(3))
      });
    }

    return {
      validationLevel: 'experimental',
      screeningStatus: 'EXPERIMENTAL_ESTIMATE_ONLY',
      status: 'EXPERIMENTAL_ESTIMATE_ONLY',
      model: 'simplified-single-degree-of-freedom-impact-example',
      inputs: { dropHeightM, phoneMassKg, impactAngle },
      modelAssumptions,
      dropHeightM,
      impactVelocity_m_s: Number(vImpact.toFixed(2)),
      peakDeceleration_G: Number(peakDecelG.toFixed(1)),
      peakContactResponseIndex: Number(peakContactResponseIndex.toFixed(3)),
      frameCount: frames.length,
      frames
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TransientDropAnimator };
}
