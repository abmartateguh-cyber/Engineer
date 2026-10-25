/**
 * OmniEng Hertz Contact Analytical Estimate and Legacy Quadrature
 *
 * Provides closed-form Hertz contact estimates and a legacy midpoint
 * quadrature of the analytical pressure profile. It does not assemble a
 * discrete contact model or execute an augmented-Lagrangian/penalty solve.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class ContactMechanics3D {
  /**
   * @param {Object} [options]
   * Legacy options are retained for compatibility. The current estimate path
   * does not use penalty, friction, iteration, or gap-tolerance settings.
   */
  constructor(options = {}) {
    this.penaltyStiffness = options.penaltyStiffness || 1.0e10;
    this.frictionCoefficient = options.frictionCoefficient || 0.0;
    this.maxIterations = options.maxIterations || 20;
    this.tolerance = options.tolerance || 1.0e-4;
  }

  /**
   * Computes analytical Hertz contact solution for sphere on elastic half-space (or two spheres).
   *
   * @param {Object} params
   * @param {number} params.radius1 - Radius of sphere 1 (m)
   * @param {number} [params.radius2=Infinity] - Radius of sphere 2 / half-space (m)
   * @param {number} params.load - Total normal contact force (N)
   * @param {number} params.E1 - Young's modulus body 1 (Pa)
   * @param {number} params.nu1 - Poisson's ratio body 1
   * @param {number} params.E2 - Young's modulus body 2 (Pa)
   * @param {number} params.nu2 - Poisson's ratio body 2
   * @returns {Object} Analytical Hertz contact metrics (a, p0, delta, E_star, R_star)
   */
  computeAnalyticalHertz(params) {
    const { radius1, radius2 = Infinity, load, E1, nu1, E2, nu2 } = params;

    // 1. Effective Young's Modulus E*
    // 1 / E* = (1 - nu1^2)/E1 + (1 - nu2^2)/E2
    const invEStar = (1 - nu1 * nu1) / E1 + (1 - nu2 * nu2) / E2;
    const EStar = 1.0 / invEStar;

    // 2. Relative Radius of Curvature R*
    // 1 / R* = 1 / R1 + 1 / R2
    const invRStar = 1.0 / radius1 + (isFinite(radius2) ? 1.0 / radius2 : 0.0);
    const RStar = 1.0 / invRStar;

    // 3. Contact Patch Radius a = ((3 * F * R*) / (4 * E*))^(1/3)
    const contactRadius = Math.cbrt((3.0 * load * RStar) / (4.0 * EStar));

    // 4. Maximum Contact Pressure p0 = (3 * F) / (2 * pi * a^2)
    const maxPressure = (3.0 * load) / (2.0 * Math.PI * contactRadius * contactRadius);

    // 5. Total Normal Indentation delta = a^2 / R*
    const indentationDepth = (contactRadius * contactRadius) / RStar;

    return {
      EStar,
      RStar,
      contactRadiusMeters: contactRadius,
      contactRadiusMm: contactRadius * 1000.0,
      maxPressurePa: maxPressure,
      maxPressureMpa: maxPressure / 1.0e6,
      meanPressureMpa: (2.0 / 3.0) * (maxPressure / 1.0e6),
      indentationDepthMeters: indentationDepth,
      indentationDepthMm: indentationDepth * 1000.0
    };
  }

  /**
   * Integrates the closed-form Hertz pressure profile at radial midpoints.
   * This legacy method does not execute a discrete contact mechanics solve.
   *
   * @param {Object} params - Contact problem definition
   * @returns {Object} Experimental analytical estimate and quadrature diagnostics
   */
  solveSphereOnFlatContact(params) {
    const analytical = this.computeAnalyticalHertz(params);
    const { load } = params;

    // Discretize contact zone into concentric annular integration elements
    const numRings = 50;
    const a = analytical.contactRadiusMeters;
    const dr = a / numRings;

    // Numerical quadrature of discrete contact pressure profile
    let computedTotalForce = 0.0;
    let computedMaxPressure = 0.0;

    for (let i = 0; i < numRings; i++) {
      const r = (i + 0.5) * dr;
      // Normal contact pressure profile p_n(r) = p0 * sqrt(1 - (r/a)^2)
      const p_n = analytical.maxPressurePa * Math.sqrt(Math.max(0.0, 1.0 - Math.pow(r / a, 2)));
      const dA = 2.0 * Math.PI * r * dr;
      computedTotalForce += p_n * dA;

      if (i === 0) {
        // Center apex pressure (extrapolated to r=0)
        computedMaxPressure = p_n / Math.sqrt(1.0 - Math.pow(0.5 / numRings, 2));
      }
    }

    const profileMaxPressureErrorPercent =
      Math.abs((computedMaxPressure - analytical.maxPressurePa) / analytical.maxPressurePa) * 100.0;
    const integratedForceErrorPercent = Math.abs((computedTotalForce - load) / load) * 100.0;
    const profileQuadrature = {
      indentationDepthMm: analytical.indentationDepthMm,
      maxPressurePa: computedMaxPressure,
      maxPressureMpa: computedMaxPressure / 1.0e6,
      totalForceNewtons: computedTotalForce
    };

    return {
      status: 'estimate-only',
      validationLevel: 'experimental',
      solverExecuted: false,
      solverMethod: 'closed-form-hertz-profile-midpoint-quadrature',
      warning: 'No discrete contact solver ran; reported values are an analytical profile quadrature estimate.',
      converged: false,
      iterations: null,
      analytical,
      profileQuadrature,
      // Legacy field names remain for callers that consume the old response.
      // These values are quadrature diagnostics, not a solver result.
      numerical: profileQuadrature,
      profileMaxPressureErrorPercent,
      integratedForceErrorPercent,
      pressureErrorPercent: profileMaxPressureErrorPercent,
      isHertzCompliant: null
    };
  }
}

// Support CommonJS and browser window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ContactMechanics3D };
}
if (typeof window !== 'undefined') {
  window.ContactMechanics3D = ContactMechanics3D;
}
