/**
 * Compatibility entry point for an unavailable rigorous coupled-wave grating
 * analysis backend. The former estimate did not solve Maxwell boundary
 * conditions and embedded unverified throughput and reflection fractions.
 */

'use strict';

class RCWAGratingSolver {
  /**
   * Retains the legacy operation name while returning no synthetic efficiencies.
   * A production result requires a separately implemented and validated RCWA
   * backend with explicit material, geometry, wavelength, and polarization data.
   */
  static solveDiffractionOrders() {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Rigorous coupled-wave grating analysis is unavailable; the former heuristic efficiency estimate was withdrawn.'
      }
    };
  }
}

module.exports = {
  RCWAGratingSolver
};
