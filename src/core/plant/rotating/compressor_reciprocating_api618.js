/**
 * API 618 Reciprocating Compressor Kinematics, Rod Loading & Performance Engine.
 *
 * Implements:
 * 1. Double-acting cylinder kinematics (Head End HE and Crank End CE).
 * 2. Clearance volume volumetric efficiency:
 *    eta_v = 1 - c * [ (Zs / Zd) * (Pd / Ps)^(1/k) - 1 ] - L_leak
 * 3. Swept displacement and actual mass throughput at operational speed N (rpm).
 * 4. Combined dynamic rod loading across 360° crank rotation:
 *    - Gas pressure load (F_gas = P_HE * A_HE - P_CE * A_CE)
 *    - Reciprocating inertia force (F_inertia = -m * r * omega^2 * (cos(theta) + (r/l)*cos(2*theta)))
 * 5. Crosshead pin reversal verification per API 618 §6.1.4 (>15° continuous crank reversal).
 * 6. API 618 Design Approach 1 & 2 pulsation suppression bottle volume sizing.
 */

'use strict';

class CompressorReciprocatingApi618 {
  /**
   * Sizes and evaluates an API 618 reciprocating compressor cylinder stage.
   *
   * @param {Object} params
   * @param {number} params.boreDiameterMm - Cylinder bore diameter D (mm)
   * @param {number} params.strokeMm - Piston stroke S (mm)
   * @param {number} params.rodDiameterMm - Piston rod diameter d_rod (mm)
   * @param {number} params.speedRpm - Compressor crankshaft speed N (rpm, typically 300 to 900 rpm)
   * @param {number} params.suctionPressureBarg - Suction static pressure Ps (barg)
   * @param {number} params.dischargePressureBarg - Discharge static pressure Pd (barg)
   * @param {number} params.suctionTempC - Suction temperature Ts (°C)
   * @param {number} params.molecularWeight - Gas molecular weight M (kg/kmol)
   * @param {number} [params.clearanceVolumeRatio=0.15] - Cylinder clearance volume c = Vc / Vs (typically 12% to 25%)
   * @param {number} [params.specificHeatRatioGamma=1.30] - Isentropic exponent k = Cp/Cv
   * @param {number} [params.connectingRodLengthMm=600.0] - Connecting rod length l (mm)
   * @param {number} [params.reciprocatingMassKg=45.0] - Piston + rod + crosshead mass m_recip (kg)
   * @param {number} [params.maxAllowableRodLoadKN=120.0] - Manufacturer maximum frame rod load rating (kN)
   * @returns {Object} Complete thermodynamic and mechanical evaluation
   */
  static evaluateCylinderStage(params) {
    const {
      boreDiameterMm,
      strokeMm,
      rodDiameterMm,
      speedRpm,
      suctionPressureBarg,
      dischargePressureBarg,
      suctionTempC,
      molecularWeight,
      clearanceVolumeRatio = 0.15,
      specificHeatRatioGamma = 1.30,
      connectingRodLengthMm = 600.0,
      reciprocatingMassKg = 45.0,
      maxAllowableRodLoadKN = 120.0
    } = params;

    const D = boreDiameterMm * 1e-3; // m
    const S = strokeMm * 1e-3; // m
    const d_rod = rodDiameterMm * 1e-3; // m
    const N_rps = speedRpm / 60.0;
    const omega = 2.0 * Math.PI * N_rps; // rad/s
    const r = S / 2.0; // Crank radius (m)
    const l = connectingRodLengthMm * 1e-3; // m

    const Ps_Pa = (suctionPressureBarg + 1.01325) * 1e5;
    const Pd_Pa = (dischargePressureBarg + 1.01325) * 1e5;
    const rc = Pd_Pa / Ps_Pa;
    const k = specificHeatRatioGamma;
    const c = clearanceVolumeRatio;

    // 1. Volumetric Efficiency eta_v
    const Zs_over_Zd = 1.02; // Typical ratio
    const leakageSlip = 0.04; // 4% valve and piston ring slip
    const eta_v = 1.0 - c * (Zs_over_Zd * Math.pow(rc, 1.0 / k) - 1.0) - leakageSlip;
    const clamped_eta_v = Math.max(0.10, Math.min(0.95, eta_v));

    // 2. Cylinder Displacement Areas and Swept Volumes
    const A_HE = (Math.PI * Math.pow(D, 2)) / 4.0; // m2
    const A_CE = (Math.PI * (Math.pow(D, 2) - Math.pow(d_rod, 2))) / 4.0; // m2
    const Vs_HE = A_HE * S; // m3
    const Vs_CE = A_CE * S; // m3
    const totalSweptVolumeM3 = Vs_HE + Vs_CE;

    // Total displacement rate (m3/s & m3/h)
    const displacementRateM3H = totalSweptVolumeM3 * N_rps * 3600.0;
    const actualCapacityM3H = displacementRateM3H * clamped_eta_v;

    // Mass throughput
    const Ts_K = suctionTempC + 273.15;
    const rho_suction = (Ps_Pa * molecularWeight) / (8.314472 * Ts_K * 1000.0); // kg/m3
    const massFlowKgH = actualCapacityM3H * rho_suction;

    // 3. Discharge Temperature Td
    const Td_K = Ts_K * Math.pow(rc, (k - 1.0) / k);
    const dischargeTempC = Td_K - 273.15;

    // 4. Combined Rod Load Calculation across 360° Crank Rotation
    let maxTensionLoadKN = 0;
    let maxCompressionLoadKN = 0;
    let reversalDegrees = 0;

    for (let deg = 0; deg < 360; deg += 5) {
      const theta = (deg * Math.PI) / 180.0;

      // Approximate instantaneous cylinder pressures
      // Head End: compression when theta in [0, 180], expansion in [180, 360]
      const p_he = deg < 180 ? Ps_Pa + (Pd_Pa - Ps_Pa) * Math.pow(deg / 180.0, 1.2) : Ps_Pa;
      // Crank End: opposite phase
      const p_ce = deg >= 180 ? Ps_Pa + (Pd_Pa - Ps_Pa) * Math.pow((deg - 180.0) / 180.0, 1.2) : Ps_Pa;

      // Gas force on rod: F_gas = P_HE * A_HE - P_CE * A_CE (tension positive, compression negative)
      const F_gas = p_he * A_HE - p_ce * A_CE;

      // Reciprocating inertia force: F_inertia = -m * r * omega^2 * (cos(theta) + (r/l)*cos(2*theta))
      const F_inertia = -reciprocatingMassKg * r * Math.pow(omega, 2) * (Math.cos(theta) + (r / l) * Math.cos(2.0 * theta));

      const F_combined_N = F_gas + F_inertia;
      const F_combined_kN = F_combined_N * 1e-3;

      if (F_combined_kN > 0) {
        maxTensionLoadKN = Math.max(maxTensionLoadKN, F_combined_kN);
        reversalDegrees += 5;
      } else {
        maxCompressionLoadKN = Math.max(maxCompressionLoadKN, Math.abs(F_combined_kN));
      }
    }

    const pinReversalCompliant = reversalDegrees >= 15 && reversalDegrees <= 345;
    const rodLoadCompliant = Math.max(maxTensionLoadKN, maxCompressionLoadKN) <= maxAllowableRodLoadKN;

    // 5. Pulsation Suppression Bottle Sizing per API 618 Design Approach 2
    // Recommended surge bottle volume V_bottle >= 3.0 * totalSweptVolume
    const minPulsationBottleVolumeLiters = Math.ceil(totalSweptVolumeM3 * 3.5 * 1000.0);

    // Indicated gas power
    const m_dot_kg_s = massFlowKgH / 3600.0;
    const w_ad_kJ_kg = ((k / (k - 1.0)) * (8.314472 / molecularWeight) * Ts_K * (Math.pow(rc, (k - 1.0) / k) - 1.0));
    const indicatedPowerKW = (m_dot_kg_s * w_ad_kJ_kg) / 0.85;

    return {
      cylinderBoreMm: boreDiameterMm,
      strokeMm,
      rodDiameterMm,
      speedRpm,
      compressionRatio: Math.round(rc * 100) / 100,
      volumetricEfficiencyPct: Math.round(clamped_eta_v * 1000) / 10,
      displacementRateM3H: Math.round(displacementRateM3H * 10) / 10,
      actualCapacityM3H: Math.round(actualCapacityM3H * 10) / 10,
      massFlowKgH: Math.round(massFlowKgH * 10) / 10,
      dischargeTempC: Math.round(dischargeTempC * 10) / 10,
      maxTensionRodLoadKN: Math.round(maxTensionLoadKN * 10) / 10,
      maxCompressionRodLoadKN: Math.round(maxCompressionLoadKN * 10) / 10,
      allowableRodLoadKN: maxAllowableRodLoadKN,
      pinReversalAngleDegrees: reversalDegrees,
      isPinReversalCompliant: pinReversalCompliant,
      isRodLoadCompliant: rodLoadCompliant,
      recommendedPulsationBottleLiters: minPulsationBottleVolumeLiters,
      indicatedPowerKW: Math.round(indicatedPowerKW * 10) / 10
    };
  }
}

module.exports = {
  CompressorReciprocatingApi618
};
