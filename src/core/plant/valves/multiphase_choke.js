/**
 * Multiphase Choke Valve Flow Dynamics & Sizing Engine.
 *
 * Implements:
 * 1. Sachdeva Two-Phase Critical & Subcritical Choke Flow Model (Sachdeva et al., 1986):
 *    - Analytic critical pressure ratio (eta_c) for gas-liquid mixtures
 *    - Gas-liquid mixture density and vena contracta expansion
 *    - Choke mass flux (G in kg/(s*m2))
 *    - Choke bean size in 64ths of an inch (S64) and metric bore (mm)
 * 2. Gilbert Empirical Correlation and Variants (Baxendell, Ros, Achong):
 *    - P_wh = (A * q_L * R_p^B) / S64^C
 *    - Direct solutions for wellhead pressure, liquid rate, and required choke bean size.
 */

'use strict';

const CHOKE_EMPIRICAL_COEFFICIENTS = {
  gilbert: { name: 'Gilbert (1954)', A: 10.0, B: 0.546, C: 1.89 },
  baxendell: { name: 'Baxendell (1958)', A: 9.56, B: 0.546, C: 1.93 },
  ros: { name: 'Ros (1960)', A: 17.4, B: 0.500, C: 2.00 },
  achong: { name: 'Achong (1961)', A: 3.82, B: 0.650, C: 1.88 }
};

class MultiphaseChoke {
  /**
   * Calculates multiphase flow through a choke using the Sachdeva (1986) mechanistic model.
   *
   * @param {Object} params
   * @param {number} params.upstreamPressureBarg - Upstream static pressure P1 (barg)
   * @param {number} params.downstreamPressureBarg - Downstream static pressure P2 (barg)
   * @param {number} params.gasMassFraction - Gas mass quality x = mg / (mg + mL), (0.0 to 1.0)
   * @param {number} [params.beanSize64th] - Choke orifice bean size in 64ths of an inch (1 to 128)
   * @param {number} [params.chokeDiameterMm] - Choke orifice diameter in mm (used if beanSize64th not provided)
   * @param {number} [params.temperatureC=40.0] - Upstream temperature (°C)
   * @param {number} [params.liquidDensityKgM3=850.0] - Liquid density rho_L (kg/m3)
   * @param {number} [params.gasMolecularWeight=20.0] - Gas molecular weight M (kg/kmol)
   * @param {number} [params.specificHeatRatioGamma=1.28] - Gas specific heat ratio k = Cp/Cv
   * @param {number} [params.dischargeCoefficient=0.82] - Choke discharge coefficient Cd
   * @returns {Object} Complete Sachdeva multiphase flow analysis
   */
  static calculateSachdevaFlow(params) {
    const {
      upstreamPressureBarg,
      downstreamPressureBarg,
      gasMassFraction,
      beanSize64th,
      chokeDiameterMm,
      temperatureC = 40.0,
      liquidDensityKgM3 = 850.0,
      gasMolecularWeight = 20.0,
      specificHeatRatioGamma = 1.28,
      dischargeCoefficient = 0.82
    } = params;

    const P1_bar = upstreamPressureBarg + 1.01325;
    const P2_bar = Math.max(0.01, downstreamPressureBarg + 1.01325);
    const P1_Pa = P1_bar * 1e5;
    const P2_Pa = P2_bar * 1e5;

    // Determine choke diameter and area
    let dChokeMm = 0.0;
    let bean64 = 0.0;
    if (beanSize64th !== undefined) {
      bean64 = beanSize64th;
      dChokeMm = (beanSize64th / 64.0) * 25.4;
    } else if (chokeDiameterMm !== undefined) {
      dChokeMm = chokeDiameterMm;
      bean64 = (chokeDiameterMm / 25.4) * 64.0;
    } else {
      bean64 = 32.0; // Default 1/2" bean
      dChokeMm = 12.7;
    }

    const dChokeM = dChokeMm / 1000.0;
    const chokeAreaM2 = (Math.PI / 4.0) * dChokeM * dChokeM;

    const x = Math.max(0.0, Math.min(1.0, gasMassFraction));
    const k = specificHeatRatioGamma;
    const T1_K = temperatureC + 273.15;
    const R_spec = 8314.46 / gasMolecularWeight;

    // Upstream specific volumes (m3/kg)
    const vL = 1.0 / Math.max(100.0, liquidDensityKgM3);
    const vg1 = (R_spec * T1_K) / P1_Pa;

    // Sachdeva critical pressure ratio eta_c:
    let eta_c;
    if (x <= 1e-5) {
      eta_c = 0.999; // Pure liquid limit
    } else if (x >= 0.9999) {
      // Pure gas isentropic critical ratio
      eta_c = Math.pow(2.0 / (k + 1.0), k / (k - 1.0));
    } else {
      // Mechanistic two-phase critical pressure ratio:
      // Analytical initial guess refined to the peak of the Sachdeva mass flux function (dG/d_eta = 0)
      const r = ((1.0 - x) / x) * (vL / vg1);
      const termNum = (k / (k - 1.0)) + r;
      const termDen = (k / (k - 1.0)) + (k / 2.0) + r;
      const eta_initial = Math.pow(termNum / termDen, k / (k - 1.0));

      const calcGInternal = (pRatio) => {
        const pr = Math.max(0.05, Math.min(0.995, pRatio));
        const tL = (1.0 - x) * vL * (1.0 - pr);
        const tG = x * (k / (k - 1.0)) * vg1 * (1.0 - Math.pow(pr, (k - 1.0) / k));
        const num = Math.sqrt(Math.max(0.0, 2.0 * P1_Pa * (tL + tG)));
        const den = (1.0 - x) * vL + x * vg1 * Math.pow(pr, -1.0 / k);
        return num / den;
      };

      // Golden section search around peak (20 iterations guarantees 0.0001 precision)
      let a = Math.max(0.10, eta_initial - 0.20);
      let b = Math.min(0.95, eta_initial + 0.20);
      const phi = (Math.sqrt(5.0) - 1.0) / 2.0;
      let c = b - phi * (b - a);
      let d = a + phi * (b - a);
      for (let iter = 0; iter < 20; iter++) {
        if (calcGInternal(c) > calcGInternal(d)) {
          b = d;
        } else {
          a = c;
        }
        c = b - phi * (b - a);
        d = a + phi * (b - a);
      }
      eta_c = (a + b) / 2.0;
    }

    // Upstream and throat mixture densities
    const rhoMixtureUpstream = 1.0 / ((1.0 - x) * vL + x * vg1);

    // Guard for adverse or zero pressure gradient (P1 <= P2)
    if (P1_bar <= P2_bar) {
      return {
        model: 'Sachdeva Mechanistic Multiphase Choke Model (1986)',
        beanSize64th: Number(bean64.toFixed(1)),
        chokeDiameterMm: Number(dChokeMm.toFixed(2)),
        chokeAreaMm2: Number((chokeAreaM2 * 1e6).toFixed(2)),
        isChoked: false,
        criticalPressureRatioEtaC: Number(eta_c.toFixed(4)),
        actualPressureRatio: Number((P2_bar / P1_bar).toFixed(4)),
        effectivePressureRatioEta: 1.0,
        massFluxKgSM2: 0.0,
        totalMassFlowKgH: 0.0,
        liquidMassFlowKgH: 0.0,
        gasMassFlowKgH: 0.0,
        liquidFlowRateM3H: 0.0,
        liquidFlowRateBPD: 0.0,
        gasFlowRateSm3D: 0.0,
        mixtureDensityUpstreamKgM3: Number(rhoMixtureUpstream.toFixed(2)),
        mixtureDensityThroatKgM3: Number(rhoMixtureUpstream.toFixed(2))
      };
    }

    const actualRatio = P2_bar / P1_bar;
    const isChoked = actualRatio <= eta_c;
    const eta = isChoked ? eta_c : Math.min(0.999, actualRatio);

    // Mass flux G (kg/(s*m2)) per Sachdeva Eq. 18
    let G = 0.0;
    if (x <= 1e-5) {
      // Liquid orifice limit
      const deltaP_Pa = Math.max(0.0, P1_Pa - P2_Pa);
      G = dischargeCoefficient * Math.sqrt(2.0 * liquidDensityKgM3 * deltaP_Pa);
    } else if (x >= 0.9999) {
      // Single-phase gas orifice limit
      const term1 = (2.0 * P1_Pa / vg1) * (k / (k - 1.0));
      const term2 = Math.pow(eta, 2.0 / k) - Math.pow(eta, (k + 1.0) / k);
      G = dischargeCoefficient * Math.sqrt(Math.max(0.0, term1 * term2));
    } else {
      const termL = (1.0 - x) * vL * (1.0 - eta);
      const termG = x * (k / (k - 1.0)) * vg1 * (1.0 - Math.pow(eta, (k - 1.0) / k));
      const numerator = Math.sqrt(Math.max(0.0, 2.0 * P1_Pa * (termL + termG)));
      const denominator = (1.0 - x) * vL + x * vg1 * Math.pow(eta, -1.0 / k);
      G = dischargeCoefficient * (numerator / denominator);
    }

    // Mass and volumetric flow rates
    const totalMassFlowKgS = G * chokeAreaM2;
    const totalMassFlowKgH = totalMassFlowKgS * 3600.0;
    const liquidMassFlowKgH = (1.0 - x) * totalMassFlowKgH;
    const gasMassFlowKgH = x * totalMassFlowKgH;

    const liquidVolumeFlowM3H = liquidMassFlowKgH / liquidDensityKgM3;
    const liquidVolumeFlowBPD = liquidVolumeFlowM3H * 6.28981 * 24.0; // Barrels per day
    const gasVolumeFlowSm3D = (gasMassFlowKgH * 24.0) / ((101325.0 * gasMolecularWeight) / (8314.46 * 288.15));

    // Throat mixture density (rhoMixtureUpstream already computed above)
    const rhoMixtureThroat = 1.0 / ((1.0 - x) * vL + x * vg1 * Math.pow(eta, -1.0 / k));

    return {
      model: 'Sachdeva Mechanistic Multiphase Choke Model (1986)',
      beanSize64th: Number(bean64.toFixed(1)),
      chokeDiameterMm: Number(dChokeMm.toFixed(2)),
      chokeAreaMm2: Number((chokeAreaM2 * 1e6).toFixed(2)),
      isChoked,
      criticalPressureRatioEtaC: Number(eta_c.toFixed(4)),
      actualPressureRatio: Number(actualRatio.toFixed(4)),
      effectivePressureRatioEta: Number(eta.toFixed(4)),
      massFluxKgSM2: Number(G.toFixed(1)),
      totalMassFlowKgH: Number(totalMassFlowKgH.toFixed(1)),
      liquidMassFlowKgH: Number(liquidMassFlowKgH.toFixed(1)),
      gasMassFlowKgH: Number(gasMassFlowKgH.toFixed(1)),
      liquidFlowRateM3H: Number(liquidVolumeFlowM3H.toFixed(2)),
      liquidFlowRateBPD: Number(liquidVolumeFlowBPD.toFixed(1)),
      gasFlowRateSm3D: Number(gasVolumeFlowSm3D.toFixed(1)),
      mixtureDensityUpstreamKgM3: Number(rhoMixtureUpstream.toFixed(2)),
      mixtureDensityThroatKgM3: Number(rhoMixtureThroat.toFixed(2))
    };
  }

  /**
   * Sizes a choke bean size (in 64ths of an inch) to deliver a target mass flow rate.
   *
   * @param {Object} params
   * @param {number} params.targetTotalMassFlowKgH - Required total mass flow rate (kg/h)
   * @param {number} params.upstreamPressureBarg - Upstream static pressure P1 (barg)
   * @param {number} params.downstreamPressureBarg - Downstream static pressure P2 (barg)
   * @param {number} params.gasMassFraction - Gas mass quality x (0.0 to 1.0)
   * @param {number} [params.temperatureC=40.0] - Temperature (°C)
   * @param {number} [params.liquidDensityKgM3=850.0] - Liquid density (kg/m3)
   * @param {number} [params.gasMolecularWeight=20.0] - Gas molecular weight
   * @param {number} [params.specificHeatRatioGamma=1.28] - Specific heat ratio k
   * @param {number} [params.dischargeCoefficient=0.82] - Discharge coefficient Cd
   * @returns {Object} Sized choke dimensions and bean size
   */
  static sizeSachdevaBean(params) {
    const {
      targetTotalMassFlowKgH,
      upstreamPressureBarg,
      downstreamPressureBarg,
      gasMassFraction,
      temperatureC = 40.0,
      liquidDensityKgM3 = 850.0,
      gasMolecularWeight = 20.0,
      specificHeatRatioGamma = 1.28,
      dischargeCoefficient = 0.82
    } = params;

    // Run unit choke area test to determine mass flux G
    const testChoke = this.calculateSachdevaFlow({
      upstreamPressureBarg,
      downstreamPressureBarg,
      gasMassFraction,
      beanSize64th: 64.0, // 1 inch bore = 25.4 mm
      temperatureC,
      liquidDensityKgM3,
      gasMolecularWeight,
      specificHeatRatioGamma,
      dischargeCoefficient
    });

    const G = testChoke.massFluxKgSM2;
    const requiredMassFlowKgS = targetTotalMassFlowKgH / 3600.0;
    const requiredAreaM2 = requiredMassFlowKgS / Math.max(0.1, G);
    const requiredDiameterM = Math.sqrt((4.0 * requiredAreaM2) / Math.PI);
    const requiredDiameterMm = requiredDiameterM * 1000.0;
    const exactBean64 = (requiredDiameterMm / 25.4) * 64.0;
    const selectedBean64 = Math.ceil(exactBean64);
    const selectedDiameterMm = (selectedBean64 / 64.0) * 25.4;

    // Recompute actual flow at selected bean
    const ratedFlow = this.calculateSachdevaFlow({
      upstreamPressureBarg,
      downstreamPressureBarg,
      gasMassFraction,
      beanSize64th: selectedBean64,
      temperatureC,
      liquidDensityKgM3,
      gasMolecularWeight,
      specificHeatRatioGamma,
      dischargeCoefficient
    });

    return {
      sizingMethod: 'Sachdeva Mechanistic Sizing',
      targetMassFlowKgH: targetTotalMassFlowKgH,
      requiredAreaMm2: Number((requiredAreaM2 * 1e6).toFixed(2)),
      exactDiameterMm: Number(requiredDiameterMm.toFixed(2)),
      exactBeanSize64th: Number(exactBean64.toFixed(2)),
      selectedBeanSize64th: selectedBean64,
      selectedDiameterMm: Number(selectedDiameterMm.toFixed(2)),
      isChoked: ratedFlow.isChoked,
      criticalPressureRatioEtaC: ratedFlow.criticalPressureRatioEtaC,
      ratedMassFlowKgH: ratedFlow.totalMassFlowKgH,
      ratedLiquidFlowBPD: ratedFlow.liquidFlowRateBPD,
      ratedGasFlowSm3D: ratedFlow.gasFlowRateSm3D
    };
  }

  /**
   * Evaluates choke flow using the Gilbert empirical correlation and variants.
   * Standard formula: Pwh (psia) = (A * qL (STB/d) * GLR (SCF/STB)^B) / S64^C
   *
   * @param {Object} params
   * @param {'gilbert'|'baxendell'|'ros'|'achong'} [params.correlation='gilbert'] - Correlation model
   * @param {number} [params.wellheadPressureBarg] - Wellhead pressure in barg
   * @param {number} [params.wellheadPressurePsia] - Wellhead pressure in psia directly
   * @param {number} [params.liquidRateBPD] - Gross liquid rate in STB/day
   * @param {number} [params.gasLiquidRatioScfBbl] - Gas-liquid ratio in SCF/STB
   * @param {number} [params.gasLiquidRatioMscfBbl] - Gas-liquid ratio in MSCF/STB (1 MSCF = 1000 SCF)
   * @param {number} [params.beanSize64th] - Choke bean size in 64ths of an inch
   * @returns {Object} Empirical choke evaluation results
   */
  static calculateGilbert(params) {
    const {
      correlation = 'gilbert',
      wellheadPressureBarg,
      wellheadPressurePsia,
      liquidRateBPD,
      gasLiquidRatioScfBbl,
      gasLiquidRatioMscfBbl,
      beanSize64th
    } = params;

    const coeff = CHOKE_EMPIRICAL_COEFFICIENTS[correlation] || CHOKE_EMPIRICAL_COEFFICIENTS.gilbert;
    const { A, B, C } = coeff;

    let Pwh_psia = wellheadPressurePsia !== undefined
      ? wellheadPressurePsia
      : (wellheadPressureBarg !== undefined ? (wellheadPressureBarg + 1.01325) * 14.5038 : null);

    let qL = liquidRateBPD;
    let R_scf = gasLiquidRatioScfBbl !== undefined
      ? gasLiquidRatioScfBbl
      : (gasLiquidRatioMscfBbl !== undefined ? gasLiquidRatioMscfBbl * 1000.0 : undefined);
    let S64 = beanSize64th;

    let solvedVariable = '';

    if (Pwh_psia === null && qL && R_scf && S64) {
      // Solve for wellhead pressure: P = A * qL * R^B / S64^C
      Pwh_psia = (A * qL * Math.pow(R_scf, B)) / Math.pow(S64, C);
      solvedVariable = 'wellheadPressure';
    } else if (qL === undefined && Pwh_psia && R_scf && S64) {
      // Solve for liquid production rate
      qL = (Pwh_psia * Math.pow(S64, C)) / (A * Math.pow(R_scf, B));
      solvedVariable = 'liquidRateBPD';
    } else if (S64 === undefined && Pwh_psia && qL && R_scf) {
      // Solve for bean size
      const S64_pow = (A * qL * Math.pow(R_scf, B)) / Pwh_psia;
      S64 = Math.pow(S64_pow, 1.0 / C);
      solvedVariable = 'beanSize64th';
    } else if (R_scf === undefined && Pwh_psia && qL && S64) {
      // Solve for GLR
      const R_pow = (Pwh_psia * Math.pow(S64, C)) / (A * qL);
      R_scf = Math.pow(R_pow, 1.0 / B);
      solvedVariable = 'gasLiquidRatioScfBbl';
    }

    const Pwh_barg = (Pwh_psia / 14.5038) - 1.01325;
    const liquidRateM3D = qL / 6.28981;
    const Rp_mscf = R_scf / 1000.0;

    return {
      correlation: coeff.name,
      solvedVariable,
      wellheadPressureBarg: Number(Pwh_barg.toFixed(2)),
      wellheadPressurePsia: Number(Pwh_psia.toFixed(1)),
      liquidRateBPD: Number(qL.toFixed(1)),
      liquidRateM3D: Number(liquidRateM3D.toFixed(1)),
      gasLiquidRatioScfBbl: Number(R_scf.toFixed(1)),
      gasLiquidRatioMscfBbl: Number(Rp_mscf.toFixed(3)),
      beanSize64th: Number(S64.toFixed(1)),
      equivalentDiameterMm: Number(((S64 / 64.0) * 25.4).toFixed(2))
    };
  }
}

module.exports = {
  MultiphaseChoke,
  CHOKE_EMPIRICAL_COEFFICIENTS
};
