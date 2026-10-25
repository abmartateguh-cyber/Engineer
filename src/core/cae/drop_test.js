/**
 * Simplified experimental handset impact example.
 *
 * Contact and stress assumptions are illustrative. This is not a validated
 * product drop test, material failure assessment, or commercial solver result.
 */

class DropTestSimulator {
  /**
   * Run a simplified impact estimate with bundled contact assumptions
   * @param {Object} options Configuration parameters
  */
  static runSimulation(options = {}) {
    const { dropHeight, phoneMass, impactAngle } = options;
    if (!Number.isFinite(dropHeight) || dropHeight <= 0 ||
        !Number.isFinite(phoneMass) || phoneMass <= 0 ||
        !['corner', 'edge', 'face'].includes(impactAngle)) {
      throw new TypeError('DropTestSimulator requires dropHeight in meters, phoneMass in kilograms, and impactAngle (corner, edge, or face).');
    }

    const totalTime = 0.003;
    const dt = 1e-6;

    const g = 9.80665;
    // Impact velocity v = sqrt(2 * g * h)
    const impactVelocity = Math.sqrt(2 * g * dropHeight); // ~5.42 m/s for 1.5m

    // Illustrative contact-force coefficient and area selected by orientation.
    const contactPropertiesByAngle = {
      corner: { contactStiffness: 2.5e7, contactArea: 0.00002 },
      edge: { contactStiffness: 8.0e7, contactArea: 0.0002 },
      face: { contactStiffness: 2.5e8, contactArea: 0.012 }
    };
    const { contactStiffness, contactArea } = contactPropertiesByAngle[impactAngle];

    const dampingCoeff = 2 * 0.08 * Math.sqrt(contactStiffness * phoneMass);
    const modelAssumptions = {
      contactForceCoefficientNPerMPow1_2: contactStiffness,
      contactAreaM2: contactArea,
      dampingCoefficientNsPerM: dampingCoeff,
      dampingRatio: 0.08,
      contactForceExponent: 1.2,
      chassisAreaScaleFactor: 1.5,
      chassisStressScaleFactor: 0.45,
      screenAreaScaleFactor: 2.0,
      screenStressScaleFactor: 0.28,
      gravityMPerS2: g,
      integrationMethod: 'explicit-central-difference',
      integrationDurationS: totalTime,
      integrationStepS: dt
    };

    // Initial conditions at impact (t = 0)
    let z = 0; // penetration into contact plane
    let vz = impactVelocity; // downward velocity
    let az = 0;

    const timeSteps = Math.ceil(totalTime / dt);
    const timeHistory = [];
    let peakForce = 0;
    let peakDeceleration = 0;
    let peakChassisStress = 0;
    let peakScreenStress = 0;

    for (let step = 0; step < timeSteps; step++) {
      const t = step * dt;

      // Contact force calculation
      let fContact = 0;
      if (z > 0) {
        // Illustrative nonlinear contact force with damping
        fContact = contactStiffness * Math.pow(z, 1.2) + dampingCoeff * vz;
        if (fContact < 0) fContact = 0;
      }

      // Equation of motion: m * az = -fContact - m * g
      az = (-fContact / phoneMass) - g;

      // Explicit integration (Velocity Verlet / Central Difference)
      z += vz * dt + 0.5 * az * dt * dt;
      const az_next = (-fContact / phoneMass) - g;
      vz += 0.5 * (az + az_next) * dt;

      const decelerationG = Math.abs(az) / g;
      if (decelerationG > peakDeceleration) peakDeceleration = decelerationG;
      if (fContact > peakForce) peakForce = fContact;

      // Illustrative stress-like scalars from assumed contact areas and scale factors.
      const dynamicForce = fContact;
      const chassisStress = (dynamicForce / (contactArea * modelAssumptions.chassisAreaScaleFactor)) * modelAssumptions.chassisStressScaleFactor;
      const screenStress = (dynamicForce / (contactArea * modelAssumptions.screenAreaScaleFactor)) * modelAssumptions.screenStressScaleFactor;

      if (chassisStress > peakChassisStress) peakChassisStress = chassisStress;
      if (screenStress > peakScreenStress) peakScreenStress = screenStress;

      // Record sample points (every 20 steps to avoid memory explosion)
      if (step % 20 === 0) {
        timeHistory.push({
          time_ms: +(t * 1000).toFixed(3),
          penetration_mm: +(Math.max(0, z) * 1000).toFixed(4),
          impactForce_N: +fContact.toFixed(1),
          deceleration_G: +decelerationG.toFixed(1),
          chassisStress_MPa: +(chassisStress / 1e6).toFixed(1),
          screenStress_MPa: +(screenStress / 1e6).toFixed(1)
        });
      }

      // Stop once bounced back above ground
      if (t > 0.0005 && z <= 0 && vz < 0) {
        break;
      }
    }

    return {
      validationLevel: 'experimental',
      screeningStatus: 'EXPERIMENTAL_ESTIMATE_ONLY',
      model: 'simplified-single-degree-of-freedom-impact-example',
      status: 'EXPERIMENTAL_ESTIMATE_ONLY',
      inputs: {
        dropHeightM: dropHeight,
        phoneMassKg: phoneMass,
        impactAngle
      },
      modelAssumptions,
      dropHeight,
      impactVelocity: +impactVelocity.toFixed(2),
      peakForce_N: +peakForce.toFixed(1),
      peakDeceleration_G: +peakDeceleration.toFixed(1),
      peakChassisStress_MPa: +(peakChassisStress / 1e6).toFixed(1),
      peakScreenStress_MPa: +(peakScreenStress / 1e6).toFixed(1),
      timeHistory
    };
  }
}

const { J2Plasticity } = require('./nonlinear_plasticity');
const { JohnsonCookFracture } = require('./johnson_cook_fracture');
const { PenaltyContact } = require('./penalty_contact');

DropTestSimulator.J2Plasticity = J2Plasticity;
DropTestSimulator.JohnsonCook = JohnsonCookFracture;
DropTestSimulator.PenaltyContact = PenaltyContact;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    DropTestSimulator,
    J2Plasticity,
    JohnsonCookFracture,
    PenaltyContact
  };
}
