/**
 * Two-Phase Gas-Liquid Flow & Flow Assurance Sizing Engine.
 * Evaluates pressure drop, liquid holdup, flow regimes, API RP 14E erosional limits,
 * and slug catcher capacity for gas-condensate and LNG multiphase systems.
 *
 * Implements:
 * 1. Beggs and Brill (1973) Multiphase Pipe Flow Correlation:
 *    - Flow regime identification (Segregated, Intermittent, Distributed, Transition).
 *    - Incline angle correction (-90° downward to +90° upward).
 *    - Slip liquid holdup H_L(theta) and two-phase friction factor f_tp.
 *    - Total frictional and hydrostatic elevation pressure gradients.
 * 2. Lockhart and Martinelli (1949) Correlation:
 *    - Martinelli parameter X for turbulent/laminar phase combinations (tt, vt, tv, vv).
 *    - Chisholm two-phase friction multiplier phi_L^2.
 *    - Independent liquid holdup comparison.
 * 3. API RP 14E Erosional Velocity Limits:
 *    - Maximum allowable velocity v_e = C / sqrt(rho_m).
 *    - Carbon steel vs corrosion resistant alloy (SS316L, Duplex) empirical C-factors.
 * 4. Slug Catcher Capacity & Hydrodynamic Slug Sizing:
 *    - Equilibrium slug volume and finger manifold sizing.
 */

'use strict';

// claims:evidence:Beggs-Brill-1973-Lockhart-Martinelli-1949-API-RP-14E

const GRAVITY = 9.80665; // m/s^2

class TwoPhaseFlowEngine {
  /**
   * Beggs and Brill (1973) Multiphase Flow Analysis.
   *
   * @param {Object} params
   * @param {number} params.pipeInsideDiameterMm - Internal pipe diameter (mm)
   * @param {number} params.pipeLengthM - Pipe segment length (m)
   * @param {number} [params.inclinationAngleDeg=0.0] - Angle of inclination (-90 to +90 deg; 0 = horizontal)
   * @param {number} params.gasMassFlowKgS - Gas mass flow rate (kg/s)
   * @param {number} params.liquidMassFlowKgS - Liquid mass flow rate (kg/s)
   * @param {number} params.gasDensityKgM3 - In-situ gas density (kg/m3)
   * @param {number} params.liquidDensityKgM3 - In-situ liquid density (kg/m3)
   * @param {number} params.gasViscosityPaS - Gas dynamic viscosity (Pa*s)
   * @param {number} params.liquidViscosityPaS - Liquid dynamic viscosity (Pa*s)
   * @param {number} [params.surfaceTensionNM=0.025] - Liquid surface tension (N/m)
   * @param {number} [params.pipeRoughnessMm=0.045] - Absolute roughness (mm)
   * @returns {Object} Pressure drop, liquid holdup, flow pattern, and velocities
   */
  static calculateBeggsBrill(params) {
    const {
      pipeInsideDiameterMm,
      pipeLengthM,
      inclinationAngleDeg = 0.0,
      gasMassFlowKgS,
      liquidMassFlowKgS,
      gasDensityKgM3,
      liquidDensityKgM3,
      gasViscosityPaS,
      liquidViscosityPaS,
      surfaceTensionNM = 0.025,
      pipeRoughnessMm = 0.045
    } = params;

    const dM = pipeInsideDiameterMm / 1000.0;
    const pipeAreaM2 = (Math.PI * Math.pow(dM, 2)) / 4.0;

    // Volumetric flow rates [m3/s]
    const qGas = gasMassFlowKgS / gasDensityKgM3;
    const qLiquid = liquidMassFlowKgS / liquidDensityKgM3;
    const qTotal = qGas + qLiquid;

    // Superficial velocities [m/s]
    const vSg = qGas / pipeAreaM2;
    const vSl = qLiquid / pipeAreaM2;
    const vMixture = vSg + vSl;

    // No-slip liquid volume fraction lambda_L
    const lambdaL = qLiquid / qTotal;

    // Froude number Fr = v_m^2 / (g * D)
    const froude = Math.pow(vMixture, 2) / (GRAVITY * dM);

    // Beggs and Brill flow pattern boundary limits L1, L2, L3, L4
    const l1 = 316.0 * Math.pow(lambdaL, 0.302);
    const l2 = 0.0009252 * Math.pow(lambdaL, -2.4684);
    const l3 = 0.10 * Math.pow(lambdaL, -1.4516);
    const l4 = 0.50 * Math.pow(lambdaL, -6.738);

    let flowRegime = 'Segregated';
    let aCoeff = 0.98;
    let bCoeff = 0.4846;
    let cCoeff = 0.0868;

    if ((lambdaL < 0.01 && froude < l1) || (lambdaL >= 0.01 && froude < l2)) {
      flowRegime = 'Segregated';
      aCoeff = 0.98;
      bCoeff = 0.4846;
      cCoeff = 0.0868;
    } else if (lambdaL >= 0.01 && froude >= l2 && froude <= l3) {
      flowRegime = 'Transition';
    } else if ((lambdaL >= 0.01 && lambdaL < 0.4 && froude > l1 && froude <= l3) ||
               (lambdaL >= 0.4 && froude > l3 && froude <= l4)) {
      flowRegime = 'Intermittent';
      aCoeff = 0.845;
      bCoeff = 0.5351;
      cCoeff = 0.0173;
    } else {
      flowRegime = 'Distributed';
      aCoeff = 1.065;
      bCoeff = 0.5824;
      cCoeff = 0.0609;
    }

    // Horizontal liquid holdup H_L(0)
    let hl0 = 0.0;
    if (flowRegime === 'Transition') {
      const aFactor = (l3 - froude) / (l3 - l2);
      const hlSeg = (0.98 * Math.pow(lambdaL, 0.4846)) / Math.pow(froude, 0.0868);
      const hlInt = (0.845 * Math.pow(lambdaL, 0.5351)) / Math.pow(froude, 0.0173);
      hl0 = aFactor * hlSeg + (1.0 - aFactor) * hlInt;
    } else {
      hl0 = (aCoeff * Math.pow(lambdaL, bCoeff)) / Math.pow(froude, cCoeff);
    }
    // Physical constraint: H_L(0) >= lambda_L and <= 1.0
    hl0 = Math.min(1.0, Math.max(lambdaL, hl0));

    // Inclination factor psi(theta)
    const thetaRad = (inclinationAngleDeg * Math.PI) / 180.0;
    let psi = 1.0;

    if (Math.abs(inclinationAngleDeg) > 1e-4) {
      // Liquid velocity number N_lv
      const nLv = 1.938 * vSl * Math.pow(liquidDensityKgM3 / surfaceTensionNM, 0.25);
      let d = 1.0;
      let e = 0.0;
      let f = 0.0;
      let g = 0.0;

      if (inclinationAngleDeg > 0) {
        // Uphill flow
        if (flowRegime === 'Segregated') {
          d = 0.011; e = -3.768; f = 3.539; g = -1.614;
        } else if (flowRegime === 'Intermittent') {
          d = 2.96; e = 0.305; f = -0.4473; g = 0.0978;
        } else {
          // Distributed: no inclination correction
          d = 1.0; e = 0.0; f = 0.0; g = 0.0;
        }
      } else {
        // Downhill flow
        d = 4.70; e = -0.3692; f = 0.1244; g = -0.5056;
      }

      if (flowRegime !== 'Distributed') {
        const cVal = (1.0 - lambdaL) * Math.log(Math.max(1e-6, d * Math.pow(lambdaL, e) * Math.pow(nLv, f) * Math.pow(froude, g)));
        const sinTerm = Math.sin(1.8 * thetaRad) - 0.333 * Math.pow(Math.sin(1.8 * thetaRad), 3);
        psi = Math.max(0.01, 1.0 + cVal * sinTerm);
      }
    }

    const hlActual = Math.min(1.0, Math.max(lambdaL, hl0 * psi));

    // Multiphase mixture and no-slip densities
    const rhoMixture = liquidDensityKgM3 * hlActual + gasDensityKgM3 * (1.0 - hlActual);
    const rhoNoSlip = liquidDensityKgM3 * lambdaL + gasDensityKgM3 * (1.0 - lambdaL);
    const muNoSlip = liquidViscosityPaS * lambdaL + gasViscosityPaS * (1.0 - lambdaL);

    // No-slip Reynolds number
    const reNoSlip = (rhoNoSlip * vMixture * dM) / muNoSlip;

    // No-slip friction factor f_n (Churchill)
    const relRoughness = (pipeRoughnessMm / 1000.0) / dM;
    const aTerm = Math.pow(-2.457 * Math.log(Math.pow(7.0 / reNoSlip, 0.9) + 0.27 * relRoughness), 16);
    const bTerm = Math.pow(37530.0 / reNoSlip, 16);
    const fn = 8.0 * Math.pow(Math.pow(8.0 / reNoSlip, 12) + (1.0 / Math.pow(aTerm + bTerm, 1.5)), 1.0 / 12.0);

    // Two-phase friction factor f_tp / f_n = exp(S)
    const yRatio = lambdaL / Math.pow(hlActual, 2);
    let sExponent = 0.0;
    if (yRatio > 1.0 && yRatio < 1.2) {
      sExponent = Math.log(2.2 * yRatio - 1.2);
    } else if (yRatio > 0.0) {
      const lnY = Math.log(yRatio);
      sExponent = lnY / (-0.0523 + 3.182 * lnY - 0.8725 * Math.pow(lnY, 2) + 0.01853 * Math.pow(lnY, 4));
    }
    const ftp = fn * Math.exp(Math.max(-5.0, Math.min(5.0, sExponent)));

    // Frictional pressure gradient [Pa/m]
    const dpFricPaM = (ftp * rhoNoSlip * Math.pow(vMixture, 2)) / (2.0 * dM);

    // Elevation (hydrostatic) pressure gradient [Pa/m]
    const dpElevPaM = rhoMixture * GRAVITY * Math.sin(thetaRad);

    // Total pressure drop [bar]
    const totalDpPa = (dpFricPaM + dpElevPaM) * pipeLengthM;
    const totalDpBar = totalDpPa / 1.0e5;

    return {
      method: 'Beggs and Brill (1973)',
      flowRegime,
      noSlipLiquidFraction: Number(lambdaL.toFixed(4)),
      liquidHoldup: Number(hlActual.toFixed(4)),
      mixtureVelocityMS: Number(vMixture.toFixed(2)),
      superficialGasVelocityMS: Number(vSg.toFixed(2)),
      superficialLiquidVelocityMS: Number(vSl.toFixed(2)),
      mixtureDensityKgM3: Number(rhoMixture.toFixed(2)),
      reynoldsNumber: Number(reNoSlip.toFixed(0)),
      frictionFactorTwoPhase: Number(ftp.toFixed(5)),
      dpFrictionalBar: Number(((dpFricPaM * pipeLengthM) / 1.0e5).toFixed(3)),
      dpElevationBar: Number(((dpElevPaM * pipeLengthM) / 1.0e5).toFixed(3)),
      totalPressureDropBar: Number(totalDpBar.toFixed(3))
    };
  }

  /**
   * Lockhart and Martinelli (1949) Multi-Phase Pressure Drop Correlation.
   *
   * @param {Object} params
   * @param {number} params.pipeInsideDiameterMm
   * @param {number} params.pipeLengthM
   * @param {number} params.gasMassFlowKgS
   * @param {number} params.liquidMassFlowKgS
   * @param {number} params.gasDensityKgM3
   * @param {number} params.liquidDensityKgM3
   * @param {number} params.gasViscosityPaS
   * @param {number} params.liquidViscosityPaS
   * @param {number} [params.pipeRoughnessMm=0.045]
   * @returns {Object} Pressure drop, Lockhart-Martinelli X parameter, and multiplier
   */
  static calculateLockhartMartinelli(params) {
    const {
      pipeInsideDiameterMm,
      pipeLengthM,
      gasMassFlowKgS,
      liquidMassFlowKgS,
      gasDensityKgM3,
      liquidDensityKgM3,
      gasViscosityPaS,
      liquidViscosityPaS,
      pipeRoughnessMm = 0.045
    } = params;

    if (pipeInsideDiameterMm <= 0 || pipeLengthM <= 0) {
      throw new Error('pipeInsideDiameterMm and pipeLengthM must be positive.');
    }
    if (gasDensityKgM3 <= 0 || liquidDensityKgM3 <= 0) {
      throw new Error('Fluid densities must be positive.');
    }

    const dM = pipeInsideDiameterMm / 1000.0;
    const areaM2 = (Math.PI * Math.pow(dM, 2)) / 4.0;

    // Single phase edge case: Zero liquid flow (100% dry gas)
    if (!liquidMassFlowKgS || liquidMassFlowKgS <= 0) {
      const vSg = (gasMassFlowKgS / gasDensityKgM3) / areaM2;
      const reG = (gasDensityKgM3 * vSg * dM) / gasViscosityPaS;
      const relE = (pipeRoughnessMm / 1000.0) / dM;
      const fG = reG < 2000
        ? (reG > 0 ? 64.0 / reG : 0)
        : 0.25 / Math.pow(Math.log10(relE / 3.7 + 5.74 / Math.pow(reG, 0.9)), 2);
      const dpG = fG * (pipeLengthM / dM) * (0.5 * gasDensityKgM3 * Math.pow(vSg, 2));
      const dpGBar = dpG / 1.0e5;

      return {
        method: 'Lockhart and Martinelli (1949)',
        flowState: 'single-phase-gas',
        xMartinelli: 0.0,
        chisholmC: 0.0,
        multiplierPhiL2: 1.0,
        liquidHoldup: 0.0,
        dpLiquidSinglePhaseBar: 0.0,
        dpGasSinglePhaseBar: Number(dpGBar.toFixed(3)),
        totalPressureDropBar: Number(dpGBar.toFixed(3))
      };
    }

    // Single phase edge case: Zero gas flow (100% liquid)
    if (!gasMassFlowKgS || gasMassFlowKgS <= 0) {
      const vSl = (liquidMassFlowKgS / liquidDensityKgM3) / areaM2;
      const reL = (liquidDensityKgM3 * vSl * dM) / liquidViscosityPaS;
      const relE = (pipeRoughnessMm / 1000.0) / dM;
      const fL = reL < 2000
        ? (reL > 0 ? 64.0 / reL : 0)
        : 0.25 / Math.pow(Math.log10(relE / 3.7 + 5.74 / Math.pow(reL, 0.9)), 2);
      const dpL = fL * (pipeLengthM / dM) * (0.5 * liquidDensityKgM3 * Math.pow(vSl, 2));
      const dpLBar = dpL / 1.0e5;

      return {
        method: 'Lockhart and Martinelli (1949)',
        flowState: 'single-phase-liquid',
        xMartinelli: 9999.0,
        chisholmC: 0.0,
        multiplierPhiL2: 1.0,
        liquidHoldup: 1.0,
        dpLiquidSinglePhaseBar: Number(dpLBar.toFixed(3)),
        dpGasSinglePhaseBar: 0.0,
        totalPressureDropBar: Number(dpLBar.toFixed(3))
      };
    }

    const vSg = (gasMassFlowKgS / gasDensityKgM3) / areaM2;
    const vSl = (liquidMassFlowKgS / liquidDensityKgM3) / areaM2;

    // Reynolds numbers for each phase flowing alone
    const reL = (liquidDensityKgM3 * vSl * dM) / liquidViscosityPaS;
    const reG = (gasDensityKgM3 * vSg * dM) / gasViscosityPaS;

    // Friction factor for each phase (Churchill)
    const calcF = (re) => {
      if (re <= 0) return 0.0;
      if (re < 2000) return 64.0 / re;
      const relE = (pipeRoughnessMm / 1000.0) / dM;
      return 0.25 / Math.pow(Math.log10(relE / 3.7 + 5.74 / Math.pow(re, 0.9)), 2);
    };

    const fL = calcF(reL);
    const fG = calcF(reG);

    // Single phase pressure drops (Pa)
    const dpL = fL * (pipeLengthM / dM) * (0.5 * liquidDensityKgM3 * Math.pow(vSl, 2));
    const dpG = fG * (pipeLengthM / dM) * (0.5 * gasDensityKgM3 * Math.pow(vSg, 2));

    // Martinelli parameter X = sqrt(dpL / dpG)
    const xMartinelli = Math.sqrt(Math.max(1e-6, dpL / Math.max(1e-6, dpG)));

    // Chisholm parameter C based on turbulent / viscous combinations
    let cChisholm = 20.0; // tt
    let flowState = 'turbulent-turbulent (tt)';
    if (reL >= 2000 && reG >= 2000) {
      cChisholm = 20.0;
      flowState = 'turbulent-turbulent (tt)';
    } else if (reL < 2000 && reG >= 2000) {
      cChisholm = 12.0;
      flowState = 'viscous-turbulent (vt)';
    } else if (reL >= 2000 && reG < 2000) {
      cChisholm = 10.0;
      flowState = 'turbulent-viscous (tv)';
    } else {
      cChisholm = 5.0;
      flowState = 'viscous-viscous (vv)';
    }

    // Two-phase liquid multiplier phi_L^2 = 1 + C / X + 1 / X^2
    const phiL2 = 1.0 + (cChisholm / xMartinelli) + (1.0 / Math.pow(xMartinelli, 2));
    const dpTwoPhasePa = phiL2 * dpL;
    const dpTwoPhaseBar = dpTwoPhasePa / 1.0e5;

    // Estimated liquid holdup (Chisholm / Butterworth model)
    const liquidHoldup = 1.0 - (1.0 / Math.sqrt(1.0 + cChisholm * xMartinelli + Math.pow(xMartinelli, 2)));

    return {
      method: 'Lockhart and Martinelli (1949)',
      flowState,
      xMartinelli: Number(xMartinelli.toFixed(3)),
      chisholmC: cChisholm,
      multiplierPhiL2: Number(phiL2.toFixed(2)),
      liquidHoldup: Number(liquidHoldup.toFixed(4)),
      dpLiquidSinglePhaseBar: Number((dpL / 1.0e5).toFixed(3)),
      dpGasSinglePhaseBar: Number((dpG / 1.0e5).toFixed(3)),
      totalPressureDropBar: Number(dpTwoPhaseBar.toFixed(3))
    };
  }

  /**
   * API RP 14E Erosional Velocity Evaluation for Gas-Liquid Multiphase Flow.
   *
   * @param {Object} params
   * @param {number} params.mixtureVelocityMS - Actual fluid mixture velocity (m/s)
   * @param {number} params.mixtureDensityKgM3 - Homogeneous multiphase density (kg/m3)
   * @param {string} [params.pipingMaterial='CARBON_STEEL'] - 'CARBON_STEEL', 'SS316L', or 'DUPLEX'
   * @param {boolean} [params.hasSolids=false] - Whether sand / particulates are present
   * @param {boolean} [params.isContinuousService=true] - Continuous vs intermittent duty
   * @returns {Object} Erosional velocity limit, velocity ratio, and compliance status
   */
  static evaluateErosionalVelocityApi14E(params) {
    const {
      mixtureVelocityMS,
      mixtureDensityKgM3,
      pipingMaterial = 'CARBON_STEEL',
      hasSolids = false,
      isContinuousService = true
    } = params;

    // API RP 14E empirical C-factor:
    // v_e = C / sqrt(rho_m) where v_e is in ft/s, rho_m is in lb/ft3.
    // In SI units: C_SI = C_US * 1.22 for v in m/s and rho in kg/m3.
    let cUs = 100.0;

    const mat = (pipingMaterial || 'CARBON_STEEL').toUpperCase();
    if (mat.includes('DUPLEX') || mat.includes('SUPER_DUPLEX') || mat.includes('2205') || mat.includes('2507')) {
      cUs = isContinuousService ? 175.0 : 200.0;
    } else if (mat.includes('SS') || mat.includes('316') || mat.includes('304') ||
               mat.includes('MONEL') || mat.includes('INCOLOY') || mat.includes('INCONEL') ||
               mat.includes('TITANIUM') || mat.includes('ALLOY') || mat.includes('CRA')) {
      cUs = isContinuousService ? 150.0 : 175.0;
    } else {
      // Carbon steel
      cUs = isContinuousService ? 100.0 : 125.0;
    }

    if (hasSolids) {
      cUs = Math.min(cUs, 65.0); // Severe penalty for erosive sand/solids
    }

    const cSi = cUs * 1.22;
    const erosionalVelocityLimitMS = cSi / Math.sqrt(Math.max(0.1, mixtureDensityKgM3));
    const velocityRatio = mixtureVelocityMS / erosionalVelocityLimitMS;
    const isErosionSafe = velocityRatio <= 1.0;

    return {
      standard: 'API RP 14E Section 2.5',
      cEmpirical: cUs,
      cFactorUS: cUs,
      cFactorSI: Number(cSi.toFixed(1)),
      mixtureDensityKgM3,
      actualVelocityMS: mixtureVelocityMS,
      erosionalVelocityLimitMS: Number(erosionalVelocityLimitMS.toFixed(2)),
      velocityRatio: Number(velocityRatio.toFixed(3)),
      isErosionSafe,
      verdict: isErosionSafe
        ? 'ACCEPTABLE: Fluid velocity is below API RP 14E erosional threshold.'
        : 'EXCEEDED: Fluid velocity exceeds erosional limit. Increase pipe diameter or select corrosion-resistant alloy.'
    };
  }

  /**
   * Hydrodynamic Slug Catcher Capacity Sizing for Slug Flow.
   *
   * @param {Object} params
   * @param {number} params.pipeInsideDiameterMm - Upstream trunkline ID (mm)
   * @param {number} params.liquidHoldup - Liquid holdup in slug regime (e.g. 0.35)
   * @param {number} [params.slugLengthInDiameters=35.0] - Statistical slug length (typically 20 to 50 D)
   * @param {number} [params.numberOfFingers=4] - Number of parallel bottle pipes in slug catcher
   * @param {number} [params.fingerInsideDiameterMm=914.4] - Diameter of catcher bottles (e.g. 36" = 914.4 mm)
   * @returns {Object} Slug volume, required finger length, and total retention capacity
   */
  static sizeSlugCatcher(params) {
    const {
      pipeInsideDiameterMm,
      liquidHoldup,
      slugLengthInDiameters = 35.0,
      numberOfFingers = 4,
      fingerInsideDiameterMm = 914.4
    } = params;

    if (pipeInsideDiameterMm <= 0 || fingerInsideDiameterMm <= 0 || numberOfFingers < 1) {
      throw new Error('Piping dimensions and numberOfFingers must be positive.');
    }

    const dM = pipeInsideDiameterMm / 1000.0;
    const pipeAreaM2 = (Math.PI * Math.pow(dM, 2)) / 4.0;
    const slugLengthM = slugLengthInDiameters * dM;

    // Single hydrodynamic slug liquid volume [m3]
    const slugVolumeM3 = pipeAreaM2 * slugLengthM * liquidHoldup;

    // Finger manifold cross section [m2]
    const dFingerM = fingerInsideDiameterMm / 1000.0;
    const fingerAreaM2 = (Math.PI * Math.pow(dFingerM, 2)) / 4.0;
    const totalFingerAreaM2 = fingerAreaM2 * numberOfFingers;

    // Design slug volume with 1.5 surge safety buffer
    const designSlugVolumeM3 = slugVolumeM3 * 1.5;

    // Required length of each finger bottle [m]
    const requiredFingerLengthM = designSlugVolumeM3 / totalFingerAreaM2;

    return {
      equilibriumSlugLengthM: Number(slugLengthM.toFixed(2)),
      singleSlugVolumeM3: Number(slugVolumeM3.toFixed(2)),
      designSurgeVolumeM3: Number(designSlugVolumeM3.toFixed(2)),
      numberOfFingers,
      fingerDiameterMm: fingerInsideDiameterMm,
      requiredFingerLengthM: Number(Math.max(5.0, requiredFingerLengthM).toFixed(2)),
      recommendation: `Provide ${numberOfFingers} x ${fingerInsideDiameterMm} mm fingers, min length ${Math.max(5.0, requiredFingerLengthM).toFixed(1)} m sloped at 1.5% towards drain.`
    };
  }
}

module.exports = {
  TwoPhaseFlowEngine
};
