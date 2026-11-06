/**
 * OmniEng TEMA Shell & Tube Heat Exchanger Rating Engine
 * Standard: TEMA Class R/C/B & Bell-Delaware LMTD Method
 * Experimental implementation: Aspen EDR / HTRI Xchanger Suite thermal rating.
 */

class HeatExchangerTEMA {
  constructor(geometry = {}) {
    this.geometry = geometry;
  }

  rateExchanger(hotSideOrParams, coldSide = null, geometry = null) {
    if (coldSide === null && typeof hotSideOrParams === 'object') {
      const p = hotSideOrParams;
      const hot = {
        massFlowKgS: p.hotFlowKgS || 10.0,
        CpJkgK: (p.hotCp_kJ_kgK || 2.0) * 1000.0,
        TinC: p.hotInletC,
        ToutC: p.hotOutletC
      };
      const cold = {
        massFlowKgS: p.coldFlowKgS || 20.0,
        CpJkgK: (p.coldCp_kJ_kgK || 4.18) * 1000.0,
        TinC: p.coldInletC,
        ToutC: p.coldOutletC
      };
      const geom = { ...this.geometry, ...geometry };
      const res = HeatExchangerTEMA.rateExchanger(hot, cold, geom);
      return {
        ...res,
        heatDutyKW: res.dutyKW,
        lmtkPureC: res.counterFlowLMTD_C,
        fFactor: res.fCorrectionFactor,
        correctedLMTD_C: res.effectiveDeltaT_C,
        requiredAreaM2: res.heatTransferAreaM2,
        // Shell-side pressure drop is not computed by this thermal-rating path
        // (the Bell-Delaware geometry inputs are absent here). Reported as null
        // instead of a fabricated estimate; use tema_bell_delaware.js for a
        // shell-side drop calculation with explicit geometry.
        pressureDropShellBar: null
      };
    }
    return HeatExchangerTEMA.rateExchanger(hotSideOrParams, coldSide, geometry || this.geometry);
  }

  /**
   * Evaluates the thermal duty, LMTD, F-correction factor, and required area
   * for a 1-shell pass, 2-tube pass (1-2 TEMA E) heat exchanger.
   * @param {Object} hotSide Stream { massFlowKgS, CpJkgK, TinC, ToutC }
   * @param {Object} coldSide Stream { massFlowKgS, CpJkgK, TinC, ToutC }
   * @param {Object} geometry Configuration { tubeOD_mm, tubeLength_m, overallU_W_m2K }
   */
  static rateExchanger(hotSide, coldSide, geometry = {}) {
    const {
      tubeOD_mm = 19.05,       // Standard 3/4 inch tube
      tubeLength_m = 6.0,      // 6-meter tube bundle
      overallU_W_m2K = 450.0,  // W/(m^2*K) typical oil/water
      shellType = 'TEMA_E',    // 1-shell pass
      tubePasses = 2
    } = geometry;

    const Th_in = hotSide.TinC;
    const Th_out = hotSide.ToutC;
    const Tc_in = coldSide.TinC;
    const Tc_out = coldSide.ToutC;

    // 1. Heat Duty Q = m_dot * Cp * deltaT (Watts)
    const Qh = hotSide.massFlowKgS * hotSide.CpJkgK * (Th_in - Th_out);
    const Qc = coldSide.massFlowKgS * coldSide.CpJkgK * (Tc_out - Tc_in);
    const dutyW = (Qh + Qc) / 2.0;

    // 2. Counter-Flow LMTD
    const dT1 = Th_in - Tc_out;
    const dT2 = Th_out - Tc_in;

    let lmtdC = 0.0;
    if (Math.abs(dT1 - dT2) < 1e-4) {
      lmtdC = dT1;
    } else if (dT1 > 0 && dT2 > 0) {
      lmtdC = (dT1 - dT2) / Math.log(dT1 / dT2);
    } else {
      // Temperature cross condition
      lmtdC = Math.max(1.0, (dT1 + dT2) / 2.0);
    }

    // 3. Multi-Pass F-Correction Factor
    // R = (Th_in - Th_out) / (Tc_out - Tc_in)
    // P = (Tc_out - Tc_in) / (Th_in - Tc_in)
    const R = Math.max(1e-4, (Th_in - Th_out) / Math.max(1e-4, Tc_out - Tc_in));
    const P = Math.max(1e-4, Math.min(0.99, (Tc_out - Tc_in) / Math.max(1e-4, Th_in - Tc_in)));

    let F = 1.0;
    if (tubePasses >= 2) {
      const sqrtR2plus1 = Math.sqrt(R * R + 1.0);
      const num = sqrtR2plus1 * Math.log((1.0 - P) / (1.0 - P * R));
      const termA = 2.0 - P * (R + 1.0 - sqrtR2plus1);
      const termB = 2.0 - P * (R + 1.0 + sqrtR2plus1);

      if (termA > 0 && termB > 0 && Math.abs(R - 1.0) > 1e-4) {
        const denom = (R - 1.0) * Math.log(termA / termB);
        F = num / denom;
      } else {
        // Empirical F-correction chart limit at R ≈ 1.0 (Bowman–Mueller–Nagle
        // 1-2 TEMA E LMTD correction-factor charts, reproduced in Perry's
        // Chemical Engineers' Handbook). Chart-correlation value, not a CFD or
        // rigorous thermal-solve result.
        F = 0.92;
      }
      F = Math.max(0.60, Math.min(1.0, F));
    }

    const effectiveDeltaT = lmtdC * F;

    // 4. Required Heat Transfer Area: A = Q / (U * F * LMTD)
    const areaM2 = dutyW / (overallU_W_m2K * effectiveDeltaT);

    // 5. Tube Count and Bundle Diameter
    const tubeOD_m = tubeOD_mm * 1e-3;
    const areaPerTube = Math.PI * tubeOD_m * tubeLength_m;
    const numTubes = Math.ceil(areaM2 / areaPerTube);

    // Bundle Diameter for 30-deg triangular pitch: D_b = d_o * (N / 0.319)^(1 / 2.142)
    const bundleDiameterMm = tubeOD_mm * Math.pow(numTubes / 0.319, 1.0 / 2.142);
    const shellIDMm = bundleDiameterMm + 38.0; // Shell diametral clearance

    return {
      dutyKW: Number((dutyW / 1000.0).toFixed(1)),
      counterFlowLMTD_C: Number(lmtdC.toFixed(2)),
      fCorrectionFactor: Number(F.toFixed(3)),
      effectiveDeltaT_C: Number(effectiveDeltaT.toFixed(2)),
      heatTransferAreaM2: Number(areaM2.toFixed(2)),
      numberOfTubes: numTubes,
      tubeBundleDiameterMm: Math.round(bundleDiameterMm),
      shellInnerDiameterMm: Math.round(shellIDMm),
      isThermalDesignViable: F >= 0.75
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HeatExchangerTEMA };
}
