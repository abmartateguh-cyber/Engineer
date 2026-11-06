/**
 * API 619 Rotary Screw Compressor Thermodynamic & Performance Engine.
 *
 * Implements:
 * 1. Oil-flooded and dry twin-screw compressor thermodynamics per API 619.
 * 2. Built-in volume ratio (Vi) vs system pressure ratio (rc):
 *    - Internal pressure ratio pi_i = Vi^k.
 *    - Over-compression and under-compression indicator loss analysis.
 * 3. Axial slide-valve turndown modeling:
 *    - Variable displacement from 10% to 100% capacity.
 *    - Part-load power vs capacity characteristic curves.
 * 4. Economizer port intermediate injection calculation:
 *    - Subcooler / flash gas injection at port pressure P_eco.
 *    - Dual-suction cycle efficiency and power calculation.
 * 5. Oil injection cooling and discharge temperature control for flooded units.
 */

'use strict';

const R_UNIVERSAL = 8.314472; // J/(mol*K)

class CompressorScrewApi619 {
  /**
   * Evaluates oil-flooded or dry rotary screw compressor performance per API 619.
   *
   * @param {Object} params
   * @param {number} params.massFlowKgH - Suction mass flow rate (kg/h)
   * @param {number} params.suctionPressureBarg - Inlet pressure P1 (barg)
   * @param {number} params.dischargePressureBarg - Discharge pressure P2 (barg)
   * @param {number} params.suctionTempC - Suction temperature T1 (°C)
   * @param {number} params.molecularWeight - Gas molecular weight M (kg/kmol)
   * @param {number} [params.specificHeatRatioGamma=1.30] - Isentropic exponent k = Cp/Cv
   * @param {number} [params.builtInVolumeRatioVi=3.6] - Built-in volume ratio Vi = V1 / V2_internal (typically 2.2 to 5.0)
   * @param {boolean} [params.isOilFlooded=true] - True for oil-injected screw, false for dry screw with timing gears
   * @param {number} [params.oilInletTempC=45.0] - Injected lube/seal oil temperature (°C)
   * @param {number} [params.oilToGasMassRatio=2.5] - Oil injection mass ratio (kg oil / kg gas, flooded: 2.0-4.0)
   * @param {number} [params.compressorSpeedRpm=3000] - Male rotor speed (rpm)
   * @returns {Object} Screw compressor performance and compression regime analysis
   */
  static evaluateScrewCompressor(params) {
    const {
      massFlowKgH,
      suctionPressureBarg,
      dischargePressureBarg,
      suctionTempC,
      molecularWeight,
      specificHeatRatioGamma = 1.30,
      builtInVolumeRatioVi = 3.6,
      isOilFlooded = true,
      oilInletTempC = 45.0,
      oilToGasMassRatio = 2.5,
      compressorSpeedRpm = 3000
    } = params;

    if (massFlowKgH <= 0) throw new Error('Mass flow must be positive');
    if (builtInVolumeRatioVi <= 1.0) throw new Error('Built-in volume ratio Vi must exceed 1.0');
    if (specificHeatRatioGamma <= 1.0) throw new Error('Specific heat ratio gamma must exceed 1.0');
    if (molecularWeight <= 0) throw new Error('Molecular weight must be positive');
    if (compressorSpeedRpm <= 0) throw new Error('Compressor speed must be positive');

    const P1_bar = suctionPressureBarg + 1.01325;
    const P2_bar = dischargePressureBarg + 1.01325;
    if (P2_bar <= P1_bar) throw new Error('Discharge pressure must exceed suction pressure');

    const k = specificHeatRatioGamma;
    const T1_K = suctionTempC + 273.15;
    const R_spec = (R_UNIVERSAL * 1000.0) / molecularWeight; // J/(kg*K)
    const systemPressureRatio = P2_bar / P1_bar;

    // 1. Built-in internal pressure ratio and internal pressure before port opens
    // pi_i = Vi^k
    const builtInPressureRatio = Math.pow(builtInVolumeRatioVi, k);
    const internalDischargePressureBar = P1_bar * builtInPressureRatio;

    // 2. Indicator Card Analysis: Over-compression vs Under-compression
    // Ratio mismatch: deltaP_port = P_discharge - P_internal
    const pressureMismatchBar = P2_bar - internalDischargePressureBar;
    let compressionRegime = 'matched';
    let indicatorLossFraction = 0.0;

    // Relative loss factor based on pressure difference across discharge port
    // Theoretical indicator work with over/under-compression:
    // W_ind / (P1*V1) = [ Vi^(k-1) - 1 ] / (k-1) + rc / Vi - 1
    const factorIdealIsentropic = (k / (k - 1.0)) * (Math.pow(systemPressureRatio, (k - 1.0) / k) - 1.0);
    const factorBuiltIn = (Math.pow(builtInVolumeRatioVi, k - 1.0) - 1.0) / (k - 1.0) + (systemPressureRatio / builtInVolumeRatioVi) - 1.0;

    if (factorIdealIsentropic > 0) {
      indicatorLossFraction = Math.max(0.0, (factorBuiltIn - factorIdealIsentropic) / factorIdealIsentropic);
    }

    if (Math.abs(pressureMismatchBar) < 0.1) {
      compressionRegime = 'matched';
    } else if (pressureMismatchBar > 0) {
      compressionRegime = 'under_compression'; // line pressure > internal pressure, backflow into cavity
    } else {
      compressionRegime = 'over_compression'; // internal pressure > line pressure, over-compressed gas expands into port
    }

    // 3. Volumetric and Adiabatic Efficiencies
    // Dry screw: higher clearance leakage; Flooded screw: oil seals rotor gaps
    const baseAdiabaticEff = isOilFlooded ? 0.82 : 0.74;
    const effectiveAdiabaticEfficiency = Math.max(0.45, baseAdiabaticEff - 0.4 * indicatorLossFraction);
    const volumetricEfficiency = isOilFlooded
      ? Math.max(0.70, 0.93 - 0.015 * systemPressureRatio)
      : Math.max(0.55, 0.84 - 0.030 * systemPressureRatio);

    // Gas mass flow in kg/s
    const m_dot_gas = massFlowKgH / 3600.0;

    // 4. Ideal Isentropic Head (kJ/kg)
    const isentropicHeadKJkg = (R_spec * T1_K * (k / (k - 1.0)) * (Math.pow(systemPressureRatio, (k - 1.0) / k) - 1.0)) * 1e-3;

    // 5. Gas Compression Power (kW)
    const gasPowerKW = (m_dot_gas * isentropicHeadKJkg) / effectiveAdiabaticEfficiency;

    // Mechanical losses (bearings, mechanical seal, timing gear friction)
    const mechanicalLossKW = Math.max(15.0, 0.03 * gasPowerKW);
    const totalShaftPowerKW = gasPowerKW + mechanicalLossKW;

    // 6. Discharge Temperature Calculation
    let dischargeTempC;
    let oilCirculationKgH = 0;
    let oilHeatDutyKW = 0;

    if (!isOilFlooded) {
      // Dry screw: pure adiabatic gas heating
      const T2_K = T1_K * (1.0 + (Math.pow(systemPressureRatio, (k - 1.0) / k) - 1.0) / effectiveAdiabaticEfficiency);
      dischargeTempC = T2_K - 273.15;
    } else {
      // Oil-flooded screw: oil absorbs the bulk of the heat of compression
      oilCirculationKgH = massFlowKgH * oilToGasMassRatio;
      const m_dot_oil = oilCirculationKgH / 3600.0;
      const cp_gas = (k * R_spec) / (k - 1.0); // J/(kg*K)
      const cp_oil = 2100.0; // J/(kg*K), typical ISO VG 46/68 compressor oil

      // Energy balance: m_gas * cp_gas * (T2 - T1) + m_oil * cp_oil * (T2 - T_oil_in) = gasPower * 1000
      const numerator = gasPowerKW * 1000.0 + (m_dot_gas * cp_gas * T1_K) + (m_dot_oil * cp_oil * (oilInletTempC + 273.15));
      const denominator = (m_dot_gas * cp_gas) + (m_dot_oil * cp_oil);
      const T2_mix_K = numerator / denominator;
      dischargeTempC = T2_mix_K - 273.15;
      oilHeatDutyKW = (m_dot_oil * cp_oil * (dischargeTempC - oilInletTempC)) * 1e-3;
    }

    // 7. Volumetric displacement requirements
    const rho1 = (P1_bar * 1e5) / (R_spec * T1_K);
    const actualSuctionFlowM3H = massFlowKgH / rho1;
    const requiredSweptVolumeM3H = actualSuctionFlowM3H / volumetricEfficiency;
    const displacementPerRevLiters = (requiredSweptVolumeM3H / (compressorSpeedRpm * 60.0)) * 1000.0;

    // Assessment flags
    const highDischargeTempRisk = dischargeTempC > (isOilFlooded ? 110.0 : 230.0);

    return {
      compressorType: isOilFlooded ? 'API 619 Oil-Flooded Rotary Screw' : 'API 619 Dry Rotary Screw',
      operatingSpeedRpm: compressorSpeedRpm,
      massFlowKgH,
      systemPressureRatio: Math.round(systemPressureRatio * 100) / 100,
      builtInVolumeRatioVi,
      builtInPressureRatio: Math.round(builtInPressureRatio * 100) / 100,
      internalDischargePressureBar: Math.round(internalDischargePressureBar * 100) / 100,
      actualDischargePressureBar: Math.round(P2_bar * 100) / 100,
      compressionRegime,
      indicatorLossPercent: Math.round(indicatorLossFraction * 1000) / 10,
      adiabaticEfficiencyPct: Math.round(effectiveAdiabaticEfficiency * 1000) / 10,
      volumetricEfficiencyPct: Math.round(volumetricEfficiency * 1000) / 10,
      gasPowerKW: Math.round(gasPowerKW * 10) / 10,
      shaftPowerKW: Math.round(totalShaftPowerKW * 10) / 10,
      suctionFlowM3H: Math.round(actualSuctionFlowM3H * 10) / 10,
      sweptDisplacementM3H: Math.round(requiredSweptVolumeM3H * 10) / 10,
      displacementLitersPerRev: Math.round(displacementPerRevLiters * 100) / 100,
      dischargeTempC: Math.round(dischargeTempC * 10) / 10,
      oilCirculationKgH: Math.round(oilCirculationKgH),
      oilHeatDutyKW: Math.round(oilHeatDutyKW * 10) / 10,
      highDischargeTempRisk,
      isThermallyAcceptable: !highDischargeTempRisk
    };
  }

  /**
   * Evaluates slide-valve axial positioning turndown from 10% to 100% capacity.
   *
   * @param {Object} params
   * @param {number} params.fullLoadShaftPowerKW - Shaft power at 100% slide valve position (kW)
   * @param {number} params.fullLoadCapacityM3H - Capacity at 100% slide valve position (m3/h)
   * @param {number} params.slideValvePositionPercent - Slide valve position (10 to 100%)
   * @param {string} [params.controlCurveType='standard'] - 'standard' or 'high_efficiency_variable_vi'
   * @returns {Object} Part-load capacity, power, and specific power degradation
   */
  static evaluateSlideValveTurndown(params) {
    const {
      fullLoadShaftPowerKW,
      fullLoadCapacityM3H,
      slideValvePositionPercent,
      controlCurveType = 'standard'
    } = params;

    if (fullLoadShaftPowerKW <= 0 || fullLoadCapacityM3H <= 0) {
      throw new Error('Full load power and capacity must be positive');
    }

    const pos = Math.max(10.0, Math.min(100.0, slideValvePositionPercent));
    const posFraction = pos / 100.0;

    // Capacity is directly proportional to active rotor length exposed before bypass port
    const partLoadCapacityM3H = fullLoadCapacityM3H * posFraction;

    // Power curve vs capacity: Screw compressors consume ~30-40% power even at minimum capacity
    // due to constant mechanical losses, rotor end clearance drag, and throttling across bypass
    let powerFraction;
    if (controlCurveType === 'high_efficiency_variable_vi') {
      // Modern slide valve with coordinated variable Vi port adjustment
      powerFraction = 0.22 + 0.78 * Math.pow(posFraction, 1.15);
    } else {
      // Standard fixed-Vi axial slide valve
      powerFraction = 0.35 + 0.65 * Math.pow(posFraction, 1.25);
    }

    const partLoadShaftPowerKW = fullLoadShaftPowerKW * powerFraction;
    const fullLoadSpecificPower = fullLoadShaftPowerKW / fullLoadCapacityM3H; // kW/(m3/h)
    const partLoadSpecificPower = partLoadShaftPowerKW / partLoadCapacityM3H;
    const specificPowerIncreasePct = ((partLoadSpecificPower - fullLoadSpecificPower) / fullLoadSpecificPower) * 100.0;

    return {
      slideValvePositionPercent: pos,
      capacityPercent: Math.round(posFraction * 1000) / 10,
      actualCapacityM3H: Math.round(partLoadCapacityM3H * 10) / 10,
      shaftPowerPercent: Math.round(powerFraction * 1000) / 10,
      partLoadShaftPowerKW: Math.round(partLoadShaftPowerKW * 10) / 10,
      fullLoadSpecificPowerKWPerM3H: Math.round(fullLoadSpecificPower * 1000) / 1000,
      partLoadSpecificPowerKWPerM3H: Math.round(partLoadSpecificPower * 1000) / 1000,
      specificPowerPenaltyPercent: Math.round(specificPowerIncreasePct * 10) / 10,
      economizerPortAvailable: pos >= 75.0 // Slide valve closing past 75% uncovers/disables economizer port
    };
  }

  /**
   * Evaluates economizer side-port intermediate injection (refrigeration subcooler / process flash).
   *
   * @param {Object} params
   * @param {number} params.suctionMassFlowKgH - Suction mass flow rate (kg/h)
   * @param {number} params.economizerMassFlowKgH - Intermediate vapor injected at economizer port (kg/h)
   * @param {number} params.suctionPressureBarg - Suction pressure P1 (barg)
   * @param {number} params.dischargePressureBarg - Discharge pressure P2 (barg)
   * @param {number} [params.economizerPressureBarg] - Economizer port pressure P_eco (barg). Defaults to geometric mean.
   * @param {number} params.suctionTempC - Suction gas temperature (°C)
   * @param {number} params.economizerGasTempC - Economizer injection temperature (°C)
   * @param {number} params.molecularWeight - Gas molecular weight
   * @param {number} [params.specificHeatRatioGamma=1.30] - k
   * @param {number} [params.adiabaticEfficiency=0.80] - eta_ad
   * @returns {Object} Economizer cycle work, capacity boost, and COP improvement
   */
  static evaluateEconomizerPort(params) {
    const {
      suctionMassFlowKgH,
      economizerMassFlowKgH,
      suctionPressureBarg,
      dischargePressureBarg,
      suctionTempC,
      economizerGasTempC,
      molecularWeight,
      specificHeatRatioGamma = 1.30,
      adiabaticEfficiency = 0.80
    } = params;

    if (suctionMassFlowKgH <= 0 || economizerMassFlowKgH <= 0) {
      throw new Error('Suction and economizer mass flow rates must be positive');
    }
    if (molecularWeight <= 0) throw new Error('Molecular weight must be positive');
    if (specificHeatRatioGamma <= 1.0) throw new Error('Specific heat ratio gamma must exceed 1.0');
    if (adiabaticEfficiency <= 0 || adiabaticEfficiency > 1.0) {
      throw new Error('Adiabatic efficiency must be between 0 and 1.0');
    }

    const P1_bar = suctionPressureBarg + 1.01325;
    const P2_bar = dischargePressureBarg + 1.01325;
    const defaultPecoBar = Math.sqrt(P1_bar * P2_bar);
    const Peco_bar = params.economizerPressureBarg !== undefined
      ? params.economizerPressureBarg + 1.01325
      : defaultPecoBar;

    if (Peco_bar <= P1_bar || Peco_bar >= P2_bar) {
      throw new Error('Economizer port pressure must lie between suction and discharge pressure');
    }

    const k = specificHeatRatioGamma;
    const R_spec = (R_UNIVERSAL * 1000.0) / molecularWeight;
    const T1_K = suctionTempC + 273.15;
    const T_eco_K = economizerGasTempC + 273.15;

    // Stage 1 compression: P1 -> P_eco (suction flow only)
    const m_suct = suctionMassFlowKgH / 3600.0;
    const rc1 = Peco_bar / P1_bar;
    const head1_KJkg = (R_spec * T1_K * (k / (k - 1.0)) * (Math.pow(rc1, (k - 1.0) / k) - 1.0)) * 1e-3;
    const power1_KW = (m_suct * head1_KJkg) / adiabaticEfficiency;

    // Gas temperature exiting stage 1 before mixing
    const T_stage1_disch_K = T1_K * Math.pow(rc1, (k - 1.0) / (k * adiabaticEfficiency));

    // Mixing at economizer port
    const m_eco = economizerMassFlowKgH / 3600.0;
    const m_total = m_suct + m_eco;
    const T_mix_K = (m_suct * T_stage1_disch_K + m_eco * T_eco_K) / m_total;

    // Stage 2 compression: P_eco -> P2 (total flow = suction + economizer)
    const rc2 = P2_bar / Peco_bar;
    const head2_KJkg = (R_spec * T_mix_K * (k / (k - 1.0)) * (Math.pow(rc2, (k - 1.0) / k) - 1.0)) * 1e-3;
    const power2_KW = (m_total * head2_KJkg) / adiabaticEfficiency;

    const totalEconomizerPowerKW = power1_KW + power2_KW;

    // Non-economized baseline power (entire flow compressed across full ratio P1 -> P2)
    const fullRc = P2_bar / P1_bar;
    const baselineHead_KJkg = (R_spec * T1_K * (k / (k - 1.0)) * (Math.pow(fullRc, (k - 1.0) / k) - 1.0)) * 1e-3;
    const baselinePowerForSuctionFlowKW = (m_suct * baselineHead_KJkg) / adiabaticEfficiency;

    // Equivalent single-stage power if economizer vapor had to be compressed from suction
    const equivalentNonEcoPowerKW = ((m_suct + m_eco) * baselineHead_KJkg) / adiabaticEfficiency;
    const powerSavingsVsSuctionCompressionKW = equivalentNonEcoPowerKW - totalEconomizerPowerKW;
    const energySavingsPercent = (powerSavingsVsSuctionCompressionKW / equivalentNonEcoPowerKW) * 100.0;

    return {
      suctionMassFlowKgH,
      economizerMassFlowKgH,
      totalDischargeMassFlowKgH: suctionMassFlowKgH + economizerMassFlowKgH,
      economizerPortPressureBarg: Math.round((Peco_bar - 1.01325) * 100) / 100,
      stage1PowerKW: Math.round(power1_KW * 10) / 10,
      stage2PowerKW: Math.round(power2_KW * 10) / 10,
      totalEconomizerPowerKW: Math.round(totalEconomizerPowerKW * 10) / 10,
      baselineSuctionPowerKW: Math.round(baselinePowerForSuctionFlowKW * 10) / 10,
      powerSavingsPercent: Math.round(energySavingsPercent * 10) / 10,
      capacityBoostPercent: Math.round((economizerMassFlowKgH / suctionMassFlowKgH) * 1000) / 10
    };
  }
}

module.exports = { CompressorScrewApi619 };
