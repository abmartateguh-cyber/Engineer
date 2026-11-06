/**
 * API 520 Part II PSV Installation Hydraulics & Rupture Disc Combination Engine.
 * Standards: API 520 Part II (Installation), API 520 Part I (Sizing), ASME Section VIII Div 1 (UG-127).
 *
 * Implements:
 * 1. PSV Inlet Piping Hydraulics & 3% Pressure Loss Rule:
 *    - Non-recoverable pressure drop (friction, fittings, entrance, rupture disc)
 *    - Chatter and flutter risk assessment
 *    - Mitigation recommendations (pipe expansion, rounded entrance, remote sensing pilot)
 * 2. Discharge Piping Hydraulics & Built-Up Backpressure:
 *    - Conventional PSV limit: 10% of set pressure
 *    - Balanced bellows PSV limit: 30% to 50% of set pressure
 *    - Pilot-operated PSV limit: up to 70% to 80% of set pressure
 * 3. Reaction Force at Atmospheric Vent Stack (API 520 Part II §5.7):
 *    - Momentum force + pressure thrust for subsonic and sonic choked discharge
 *    - Dynamic Load Factor (DLF = 2.0) for rapid opening transient shock
 * 4. Combination Rupture Disc + PSV Device (ASME Sec VIII UG-127):
 *    - Combination capacity derating factor (Kv / CMC = 0.90)
 *    - Interspace pressure monitoring and tell-tale venting requirements
 *    - Non-fragmenting disc type selection.
 */

'use strict';

class RuptureDiscAndPsvHydraulics {
  /**
   * Evaluates PSV inlet piping hydraulics per API 520 Part II Section 5.4.
   * Total non-recoverable pressure loss shall not exceed 3% of valve set pressure.
   *
   * @param {Object} params
   * @param {number} params.setPressureBarg - PSV set pressure P_set (barg)
   * @param {number} params.reliefRateKgH - Rated relief mass flow rate W (kg/h)
   * @param {number} params.fluidDensityKgM3 - Fluid relieving density rho (kg/m3)
   * @param {number} params.inletPipeDiameterMm - Inlet pipe internal bore D (mm)
   * @param {number} params.inletPipeLengthM - Total equivalent or straight length L (m)
   * @param {number} [params.darcyFrictionFactor=0.018] - Darcy-Weisbach friction factor f
   * @param {number} [params.fittingsResistanceK=0.5] - Sum of fitting resistance coefficients sum(K)
   * @param {'sharp_square'|'rounded'|'flush'|'inward_projecting'} [params.entranceType='sharp_square'] - Vessel nozzle entrance type
   * @param {boolean} [params.hasUpstreamRuptureDisc=false] - True if rupture disc installed at PSV inlet
   * @param {number} [params.ruptureDiscKr=0.80] - Rated velocity head loss factor Kr of rupture disc
   * @returns {Object} Complete API 520 Part II inlet hydraulics and 3% rule check
   */
  static checkInletPressureLoss(params) {
    const {
      setPressureBarg,
      reliefRateKgH,
      fluidDensityKgM3,
      inletPipeDiameterMm,
      inletPipeLengthM,
      darcyFrictionFactor = 0.018,
      fittingsResistanceK = 0.5,
      entranceType = 'sharp_square',
      hasUpstreamRuptureDisc = false,
      ruptureDiscKr = 0.80
    } = params;

    const D_m = Math.max(0.005, inletPipeDiameterMm / 1000.0);
    const pipeAreaM2 = (Math.PI / 4.0) * D_m * D_m;
    const W_kgs = Math.max(0.0, reliefRateKgH) / 3600.0;
    const rho = Math.max(0.1, fluidDensityKgM3);

    // Flow velocity in inlet pipe
    const velocityMs = W_kgs / (rho * pipeAreaM2);
    const dynamicHeadPa = 0.5 * rho * velocityMs * velocityMs;

    // Entrance loss coefficient K_ent
    let kEntrance = 0.50; // default sharp square
    if (entranceType === 'rounded') {
      kEntrance = 0.10;
    } else if (entranceType === 'flush') {
      kEntrance = 0.25;
    } else if (entranceType === 'inward_projecting') {
      kEntrance = 0.78; // Borda re-entrant nozzle
    }

    // Pipe friction loss K_friction = f * (L / D)
    const kFriction = darcyFrictionFactor * (Math.max(0.0, inletPipeLengthM) / D_m);

    // Rupture disc resistance K_rd
    const kRuptureDisc = hasUpstreamRuptureDisc ? Math.max(0.0, ruptureDiscKr) : 0.0;

    // Total non-recoverable K factor
    const totalKFactor = kEntrance + kFriction + Math.max(0.0, fittingsResistanceK) + kRuptureDisc;

    // Total non-recoverable pressure loss in Pa and bar
    const totalLossPa = totalKFactor * dynamicHeadPa;
    const totalLossBar = totalLossPa / 1e5;

    // Percentage of set pressure
    const isSetPressureValid = typeof setPressureBarg === 'number' && setPressureBarg > 0.0;
    const lossPercentageOfSet = isSetPressureValid ? (totalLossBar / setPressureBarg) * 100.0 : 100.0;
    const meets3PercentRule = isSetPressureValid && lossPercentageOfSet <= 3.0;

    const recommendations = [];
    if (!isSetPressureValid) {
      recommendations.push('Invalid set pressure: set pressure must be positive.');
    } else if (!meets3PercentRule) {
      recommendations.push('Inlet loss exceeds API 520 Part II 3% limit. High risk of acoustic chatter, rapid seat hammering, and reduced relieving capacity.');
      if (kEntrance > 0.15) {
        recommendations.push('Replace square vessel nozzle entry with rounded contoured inlet (reduces K from 0.5 to 0.1).');
      }
      recommendations.push('Increase inlet pipe size to reduce flow velocity and dynamic head.');
      recommendations.push('Shorten inlet piping spool and locate PSV as close to vessel nozzle as feasible.');
      recommendations.push('For pilot-operated PSVs, provide remote pressure sensing line routed directly to the protected vessel to eliminate inlet piping chatter effects.');
    } else {
      recommendations.push('Meets API 520 Part II 3% inlet piping pressure loss limit. Stable valve lift without chatter anticipated.');
    }

    return {
      standard: 'API 520 Part II Section 5.4 Inlet Piping Hydraulics',
      setPressureBarg,
      inletVelocityMs: Number(velocityMs.toFixed(2)),
      dynamicHeadKPa: Number((dynamicHeadPa / 1000.0).toFixed(2)),
      kLossBreakdown: {
        entranceK: Number(kEntrance.toFixed(2)),
        pipeFrictionK: Number(kFriction.toFixed(3)),
        fittingsK: Number(fittingsResistanceK.toFixed(2)),
        ruptureDiscK: Number(kRuptureDisc.toFixed(2)),
        totalK: Number(totalKFactor.toFixed(3))
      },
      totalInletLossBar: Number(totalLossBar.toFixed(4)),
      totalInletLossPsi: Number((totalLossBar * 14.5038).toFixed(3)),
      lossPercentageOfSetPressure: Number(lossPercentageOfSet.toFixed(2)),
      meets3PercentRule,
      chatterRisk: !meets3PercentRule,
      recommendations
    };
  }

  /**
   * Evaluates discharge piping built-up and superimposed backpressure per API 520 Part I & II.
   *
   * @param {Object} params
   * @param {'conventional'|'balanced_bellows'|'pilot_operated'} params.psvType - Relief valve construction type
   * @param {number} params.setPressureBarg - PSV set pressure (barg)
   * @param {number} [params.superimposedBackpressureBarg=0.0] - Constant or variable superimposed backpressure (barg)
   * @param {number} params.builtUpBackpressureBarg - Calculated built-up backpressure in discharge line (barg)
   * @param {boolean} [params.isVariableSuperimposed=false] - True if superimposed backpressure is variable (causes set pressure shift in conventional valves)
   * @param {number} [params.allowableOverpressurePercent=10.0] - Allowable overpressure percentage (10% standard, 16% multiple valves, 21% fire per API 520 / ASME VIII)
   * @returns {Object} Backpressure suitability and allowable limit evaluation
   */
  static checkDischargeBackpressure(params) {
    const {
      psvType,
      setPressureBarg,
      superimposedBackpressureBarg = 0.0,
      builtUpBackpressureBarg,
      isVariableSuperimposed = false,
      allowableOverpressurePercent = 10.0
    } = params;

    const P_set = Math.max(0.01, setPressureBarg);
    const P_builtUp = Math.max(0.0, builtUpBackpressureBarg);
    const P_super = Math.max(0.0, superimposedBackpressureBarg);
    const totalBackpressureBarg = P_super + P_builtUp;

    const builtUpPercentOfSet = (P_builtUp / P_set) * 100.0;
    const totalBackpressurePercentOfSet = (totalBackpressureBarg / P_set) * 100.0;

    let allowableBuiltUpPercent = 10.0;
    let allowableTotalPercent = 10.0;
    let kbFactor = 1.0;
    let isAcceptable = false;
    const recommendations = [];

    if (psvType === 'conventional') {
      // Per API 520 Part I §5.3.3.1.3: allowable built-up backpressure may match allowable overpressure (up to 21% for fire)
      allowableBuiltUpPercent = Math.max(10.0, allowableOverpressurePercent);
      allowableTotalPercent = allowableBuiltUpPercent;

      if (isVariableSuperimposed) {
        isAcceptable = false;
        recommendations.push('Variable superimposed backpressure violates conventional relief valve design rules (API 520 Part I §5.3.3.1.2). Set pressure wanders directly with header pressure. Upgrade to balanced bellows or pilot-operated PSV.');
      } else {
        isAcceptable = builtUpPercentOfSet <= allowableBuiltUpPercent && totalBackpressurePercentOfSet <= allowableTotalPercent;
      }
      kbFactor = isAcceptable ? 1.0 : 0.70;
    } else if (psvType === 'balanced_bellows') {
      allowableBuiltUpPercent = 40.0; // Standard 30% to 50%
      allowableTotalPercent = 50.0;
      isAcceptable = totalBackpressurePercentOfSet <= 50.0;
      if (totalBackpressurePercentOfSet <= 30.0) {
        kbFactor = 1.0;
      } else if (totalBackpressurePercentOfSet <= 50.0) {
        kbFactor = 1.0 - (totalBackpressurePercentOfSet - 30.0) * 0.0075;
      } else {
        kbFactor = 0.80;
      }
    } else if (psvType === 'pilot_operated') {
      allowableBuiltUpPercent = 70.0;
      allowableTotalPercent = 80.0;
      isAcceptable = totalBackpressurePercentOfSet <= 80.0;
      kbFactor = 1.0;
    }

    if (!isAcceptable) {
      if (psvType === 'conventional' && !isVariableSuperimposed) {
        recommendations.push(`Built-up backpressure exceeds ${allowableBuiltUpPercent.toFixed(0)}% limit for conventional spring PSV. Valve may flutter and lose relieving capacity.`);
        recommendations.push('Upgrade to a balanced bellows PSV (permits up to 40-50% backpressure) or pilot-operated PSV.');
        recommendations.push('Increase discharge pipe diameter to reduce backpressure generation.');
      } else if (psvType === 'balanced_bellows') {
        recommendations.push('Total backpressure exceeds 50% limit for balanced bellows. Bellows fatigue rupture risk and capacity reduction.');
        recommendations.push('Upgrade to high-pressure balanced bellows or pilot-operated relief valve with piped pilot discharge.');
      }
    } else {
      recommendations.push('Discharge backpressure is within allowable design limits for the selected valve type.');
    }

    return {
      standard: 'API 520 Part I & II Backpressure Verification',
      psvType,
      setPressureBarg: P_set,
      superimposedBackpressureBarg: P_super,
      builtUpBackpressureBarg: P_builtUp,
      totalBackpressureBarg: Number(totalBackpressureBarg.toFixed(3)),
      builtUpPercentOfSet: Number(builtUpPercentOfSet.toFixed(2)),
      totalPercentOfSet: Number(totalBackpressurePercentOfSet.toFixed(2)),
      allowableBuiltUpPercent,
      allowableTotalPercent,
      isVariableSuperimposed,
      backpressureCorrectionFactorKb: Number(kbFactor.toFixed(3)),
      isAcceptable,
      recommendations
    };
  }

  /**
   * Calculates dynamic reaction force at discharge vent elbow per API 520 Part II Section 5.7.
   *
   * @param {Object} params
   * @param {number} params.reliefRateKgH - Rated gas relieving mass rate (kg/h)
   * @param {number} params.molecularWeight - Gas molecular weight M (kg/kmol)
   * @param {number} params.relievingTemperatureC - Relieving temperature (°C)
   * @param {number} [params.specificHeatRatioGamma=1.30] - Isentropic exponent k = Cp/Cv
   * @param {number} params.dischargeExitDiameterMm - Vent pipe exit bore De (mm)
   * @param {number} [params.ambientPressureBarg=0.0] - Ambient atmospheric pressure (barg)
   * @param {number} [params.dynamicLoadFactor=2.0] - DLF for sudden opening shock (default 2.0 per API 520)
   * @returns {Object} Complete API 520 reaction force evaluation
   */
  static calculateReactionForce(params) {
    const {
      reliefRateKgH,
      molecularWeight,
      relievingTemperatureC,
      specificHeatRatioGamma = 1.30,
      dischargeExitDiameterMm,
      ambientPressureBarg = 0.0,
      dynamicLoadFactor = 2.0
    } = params;

    const W_kgs = reliefRateKgH / 3600.0;
    const k = specificHeatRatioGamma;
    const M = molecularWeight;
    const T_K = relievingTemperatureC + 273.15;
    const R_spec = 8314.46 / M;
    const P_atm_Pa = (ambientPressureBarg + 1.01325) * 1e5;

    const De_m = Math.max(0.005, dischargeExitDiameterMm / 1000.0);
    const exitAreaM2 = (Math.PI / 4.0) * De_m * De_m;

    // Critical sonic velocity at exit plane:
    // Critical temperature Te = T_K * (2 / (k + 1))
    const Te_K = T_K * (2.0 / (k + 1.0));
    // Sonic velocity c_sonic = sqrt(k * R_spec * Te) = sqrt((2*k / (k+1)) * R_spec * T_K)
    const sonicSpeedMs = Math.sqrt(k * R_spec * Te_K);

    // Maximum unchoked mass flow through exit area at atmospheric pressure Patm:
    // W_choke_limit = rho_sonic_atm * sonicSpeedMs * exitAreaM2
    // rho_sonic_atm = P_atm / (R_spec * Te)
    const rhoSonicAtm = P_atm_Pa / (R_spec * Te_K);
    const chokeMassFlowLimitKgS = rhoSonicAtm * sonicSpeedMs * exitAreaM2;

    let exitVelocityMs = 0.0;
    let exitPressurePa = P_atm_Pa;
    let isSonicChokedAtExit = false;

    if (W_kgs >= chokeMassFlowLimitKgS && exitAreaM2 > 0) {
      // Sonic choked flow at open pipe tip (Pe > Patm)
      isSonicChokedAtExit = true;
      exitVelocityMs = sonicSpeedMs;
      // Static exit pressure: Pe = (W / (Ae * sonicSpeed)) * R_spec * Te = (W * sonicSpeed) / (k * Ae)
      const rhoExit = W_kgs / (exitAreaM2 * exitVelocityMs);
      exitPressurePa = Math.max(P_atm_Pa, rhoExit * R_spec * Te_K);
    } else {
      // Subsonic unchoked flow at atmospheric discharge (Pe = Patm)
      isSonicChokedAtExit = false;
      const rhoAtm = P_atm_Pa / (R_spec * T_K);
      exitVelocityMs = W_kgs / Math.max(1e-6, rhoAtm * exitAreaM2);
      exitPressurePa = P_atm_Pa;
    }

    // Momentum force Fm = W * ve (Newtons)
    const momentumForceN = W_kgs * exitVelocityMs;

    // Pressure thrust force Fp = (Pe - Patm) * Ae (Newtons)
    const pressureThrustForceN = Math.max(0.0, exitPressurePa - P_atm_Pa) * exitAreaM2;

    // Total steady-state reaction force
    const totalSteadyForceN = momentumForceN + pressureThrustForceN;

    // Design reaction force with Dynamic Load Factor (DLF = 2.0 default)
    const designRestraintForceN = totalSteadyForceN * dynamicLoadFactor;

    // Conversions to lbf
    const N_TO_LBF = 0.224809;
    const totalSteadyForceLbf = totalSteadyForceN * N_TO_LBF;
    const designRestraintForceLbf = designRestraintForceN * N_TO_LBF;

    return {
      standard: 'API 520 Part II Section 5.7 Reaction Force at Vent Stack',
      isSonicChokedAtExit,
      exitVelocityMs: Number(exitVelocityMs.toFixed(1)),
      exitStaticPressureBarg: Number(((exitPressurePa / 1e5) - 1.01325).toFixed(3)),
      momentumForceN: Number(momentumForceN.toFixed(1)),
      pressureThrustForceN: Number(pressureThrustForceN.toFixed(1)),
      totalSteadyStateForceN: Number(totalSteadyForceN.toFixed(1)),
      totalSteadyStateForceLbf: Number(totalSteadyForceLbf.toFixed(1)),
      dynamicLoadFactor,
      designStructuralRestraintForceN: Number(designRestraintForceN.toFixed(1)),
      designStructuralRestraintForceLbf: Number(designRestraintForceLbf.toFixed(1)),
      engineeringRecommendation: 'Install robust axial/lateral pipe bracing to anchor reaction thrust at discharge elbow and prevent nozzle moment overload.'
    };
  }

  /**
   * Evaluates combination Rupture Disc + PSV device per ASME Section VIII UG-127 and API 520.
   *
   * @param {Object} params
   * @param {number} params.psvSetPressureBarg - PSV set pressure (barg)
   * @param {number} params.discMarkedBurstPressureBarg - Rupture disc stamped burst pressure at coincident temp (barg)
   * @param {number} params.requiredReliefAreaMm2 - Uncorrected required relief area from API 520 sizing (mm2)
   * @param {'reverse_buckling'|'forward_acting_scored'|'standard_flat'} [params.discType='reverse_buckling'] - Disc technology
   * @param {boolean} [params.hasInterspacePressureTelltale=true] - Gauge / excess flow valve between disc and PSV
   * @param {number} [params.combinationFactorKc=0.90] - Combination capacity factor (default 0.90 per ASME UG-127 unless test data available)
   * @param {number} [params.operatingPressureBarg] - Normal vessel operating pressure (barg)
   * @returns {Object} Complete combination rupture disc + PSV evaluation
   */
  static evaluateCombinationDevice(params) {
    const {
      psvSetPressureBarg,
      discMarkedBurstPressureBarg,
      requiredReliefAreaMm2,
      discType = 'reverse_buckling',
      hasInterspacePressureTelltale = true,
      combinationFactorKc = 0.90,
      operatingPressureBarg
    } = params;

    const Kc = Math.max(0.50, Math.min(1.0, combinationFactorKc));

    // Required area derating: A_comb = A_req / Kc
    const combinationRequiredAreaMm2 = requiredReliefAreaMm2 / Kc;

    // Burst pressure tolerance (+/- 5% standard per ASME Section VIII UG-127)
    const minBurstPressureBarg = discMarkedBurstPressureBarg * 0.95;
    const maxBurstPressureBarg = discMarkedBurstPressureBarg * 1.05;

    // Burst pressure matching check: disc burst pressure must not exceed PSV set pressure
    const isBurstPressureCompatible = discMarkedBurstPressureBarg <= psvSetPressureBarg * 1.0;

    // Non-fragmenting disc check (mandatory upstream of PSV per ASME UG-127)
    const isNonFragmenting = discType === 'reverse_buckling' || discType === 'forward_acting_scored';

    // Operating ratio check (operating pressure vs burst pressure)
    let maxOperatingRatio = 0.90;
    if (discType === 'reverse_buckling') {
      maxOperatingRatio = 0.95;
    } else if (discType === 'forward_acting_scored') {
      maxOperatingRatio = 0.85;
    } else {
      maxOperatingRatio = 0.70;
    }

    let isOperatingRatioAcceptable = true;
    let operatingRatio = null;
    if (typeof operatingPressureBarg === 'number') {
      operatingRatio = operatingPressureBarg / Math.max(0.01, discMarkedBurstPressureBarg);
      isOperatingRatioAcceptable = operatingRatio <= maxOperatingRatio;
    }

    const checklist = [
      {
        item: `Combination Margin Factor (Kc = ${Kc.toFixed(2)})`,
        satisfied: true,
        detail: `Relieving capacity derated by ${((1.0 - Kc) * 100).toFixed(0)}% (required area divided by ${Kc.toFixed(2)}) per ASME UG-127.`
      },
      {
        item: 'Burst Pressure Compatibility',
        satisfied: isBurstPressureCompatible,
        detail: `Rupture disc marked burst (${discMarkedBurstPressureBarg} barg) <= PSV set (${psvSetPressureBarg} barg).`
      },
      {
        item: 'Non-Fragmenting Disc Design',
        satisfied: isNonFragmenting,
        detail: isNonFragmenting
          ? 'Selected disc is non-fragmenting; petals remain attached to rim and cannot obstruct PSV orifice.'
          : 'Warning: Fragmenting disc selected! Metal fragments can sever PSV nozzle or wedge open valve seat.'
      },
      {
        item: 'Interspace Pressure Tell-Tale / Vent',
        satisfied: hasInterspacePressureTelltale,
        detail: hasInterspacePressureTelltale
          ? 'Mandatory ASME UG-127 interspace monitoring (pressure gauge, excess flow valve, or transmitter) provided to detect pinhole leaks and prevent backpressure buildup.'
          : 'Severe Violation: ASME Section VIII UG-127 strictly requires tell-tale pressure indicator between disc and PSV.'
      },
      {
        item: 'Operating Pressure Ratio Margin',
        satisfied: isOperatingRatioAcceptable,
        detail: operatingRatio !== null
          ? (isOperatingRatioAcceptable
              ? `Operating ratio ${(operatingRatio * 100).toFixed(1)}% <= allowable ${(maxOperatingRatio * 100).toFixed(0)}% for ${discType}. Low fatigue burst risk.`
              : `Operating ratio ${(operatingRatio * 100).toFixed(1)}% exceeds allowable ${(maxOperatingRatio * 100).toFixed(0)}% for ${discType}. High fatigue burst risk.`)
          : 'Operating pressure not specified; verify operating ratio against disc technology limit.'
      }
    ];

    const isFullyApproved = checklist.every(c => c.satisfied);

    return {
      standard: 'ASME Section VIII Div 1 (UG-127) & API 520 Combination Device',
      combinationFactorKc,
      uncorrectedRequiredAreaMm2: Number(requiredReliefAreaMm2.toFixed(2)),
      correctedRequiredAreaMm2: Number(combinationRequiredAreaMm2.toFixed(2)),
      discMarkedBurstPressureBarg,
      toleranceRangeBarg: {
        min: Number(minBurstPressureBarg.toFixed(3)),
        max: Number(maxBurstPressureBarg.toFixed(3))
      },
      discType,
      isNonFragmenting,
      isFullyApproved,
      checklist
    };
  }
}

module.exports = {
  RuptureDiscAndPsvHydraulics
};
