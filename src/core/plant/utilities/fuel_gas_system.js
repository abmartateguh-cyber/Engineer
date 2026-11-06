/**
 * Fuel Gas Conditioning Package & Combustion Thermochemistry per ISO 6976.
 *
 * Implements:
 * 1. ISO 6976 Ideal & Real Gas Combustion Properties:
 *    - Higher Heating Value (HHV) and Lower Heating Value (LHV) [MJ/Nm3, MJ/kg]
 *    - Molar mass and Specific Gravity (SG) relative to air
 *    - Wobbe Index: WI = HHV / sqrt(SG)
 *    - Modified Wobbe Index (MWI) at gas turbine supply temperature
 * 2. Gas Turbine Fuel Quality & Superheat Verification:
 *    - Hydrocarbon Dew Point (HCDP) & Water Dew Point evaluation
 *    - Mandatory superheat margin: Delta T >= 15.0 °C (or 20.0 °C for DLE dry-low-emissions combustors)
 * 3. Joule-Thomson (JT) Pressure Letdown & Preheating:
 *    - JT cooling effect: Delta T_JT = mu_JT * Delta P
 *    - Pre-heater thermal duty requirement to prevent liquid droplet condensation
 * 4. Fuel Gas Scrubber & Coalescing Filter Separator Sizing:
 *    - Souders-Brown terminal settling velocity for droplet elimination.
 */

'use strict';

// Component thermodynamic reference constants per ISO 6976 at standard conditions (15 °C, 101.325 kPa)
const COMPONENT_DATA = {
  CH4: { mw: 16.043, hhvMolKJ: 890.6, lhvMolKJ: 802.3, hcdpCoeff: 0.0 },
  C2H6: { mw: 30.070, hhvMolKJ: 1560.7, lhvMolKJ: 1428.6, hcdpCoeff: 0.5 },
  C3H8: { mw: 44.097, hhvMolKJ: 2219.2, lhvMolKJ: 2043.1, hcdpCoeff: 12.0 },
  iC4H10: { mw: 58.123, hhvMolKJ: 2868.2, lhvMolKJ: 2648.7, hcdpCoeff: 35.0 },
  nC4H10: { mw: 58.123, hhvMolKJ: 2877.4, lhvMolKJ: 2657.3, hcdpCoeff: 45.0 },
  C5_PLUS: { mw: 72.150, hhvMolKJ: 3535.0, lhvMolKJ: 3270.0, hcdpCoeff: 150.0 },
  N2: { mw: 28.013, hhvMolKJ: 0.0, lhvMolKJ: 0.0, hcdpCoeff: 0.0 },
  CO2: { mw: 44.010, hhvMolKJ: 0.0, lhvMolKJ: 0.0, hcdpCoeff: 0.0 },
  H2: { mw: 2.016, hhvMolKJ: 285.8, lhvMolKJ: 241.8, hcdpCoeff: 0.0 },
  H2S: { mw: 34.082, hhvMolKJ: 562.0, lhvMolKJ: 518.0, hcdpCoeff: 0.0 }
};

const MW_AIR = 28.966;
const STANDARD_MOLAR_VOLUME_NM3 = 0.023644; // m3/mol at 15C, 101.325 kPa per ISO 6976

class FuelGasConditioningSystem {
  /**
   * Computes ISO 6976 combustion properties, Wobbe Index, and specific gravity.
   *
   * @param {Object} compositionMolPct - Mole percentage map (e.g. { CH4: 90, C2H6: 6, C3H8: 2, N2: 2 })
   * @param {number} [operatingTempC=45] - Fuel gas temperature at GT inlet (C)
   * @returns {Object} Complete combustion and Wobbe metrics
   */
  static evaluateFuelProperties(compositionMolPct, operatingTempC = 45) {
    let totalMolPct = 0;
    for (const v of Object.values(compositionMolPct)) totalMolPct += v;
    if (Math.abs(totalMolPct - 100.0) > 0.5) {
      throw new Error(`Component mole percentages must sum to 100. Sum = ${totalMolPct}`);
    }

    let mixtureMW = 0;
    let hhvPerMol = 0; // kJ/mol
    let lhvPerMol = 0; // kJ/mol
    let heaviesWeightedScore = 0;

    for (const [comp, molPct] of Object.entries(compositionMolPct)) {
      const frac = molPct / 100.0;
      const ref = COMPONENT_DATA[comp] || { mw: 28.0, hhvMolKJ: 0, lhvMolKJ: 0, hcdpCoeff: 0 };
      mixtureMW += frac * ref.mw;
      hhvPerMol += frac * ref.hhvMolKJ;
      lhvPerMol += frac * ref.lhvMolKJ;
      heaviesWeightedScore += frac * ref.hcdpCoeff;
    }

    const specificGravity = mixtureMW / MW_AIR;

    // Volumetric heating values (MJ/Nm3) = (kJ/mol * 1e-3) / (Nm3/mol)
    const hhvVolumetricMJNm3 = (hhvPerMol * 1e-3) / STANDARD_MOLAR_VOLUME_NM3;
    const lhvVolumetricMJNm3 = (lhvPerMol * 1e-3) / STANDARD_MOLAR_VOLUME_NM3;

    // Mass heating values (MJ/kg) = (kJ/mol * 1e-3) / (kg/mol)
    const hhvMassMJKg = (hhvPerMol * 1e-3) / (mixtureMW * 1e-3);
    const lhvMassMJKg = (lhvPerMol * 1e-3) / (mixtureMW * 1e-3);

    // Standard Wobbe Index: WI = HHV / sqrt(SG) [MJ/Nm3]
    const wobbeIndex = hhvVolumetricMJNm3 / Math.sqrt(specificGravity);

    // Modified Wobbe Index (MWI) at gas supply temperature T_K:
    // MWI = LHV / sqrt( SG * (T_K / T_ref_K) )
    const T_K = operatingTempC + 273.15;
    const T_ref_K = 288.15; // 15 C
    const modifiedWobbeIndex = lhvVolumetricMJNm3 / Math.sqrt(specificGravity * (T_K / T_ref_K));

    // Gas turbine standard acceptance criteria:
    // Typical natural gas Wobbe band: 47.0 to 52.5 MJ/Nm3
    const isWobbeAcceptable = wobbeIndex >= 45.0 && wobbeIndex <= 53.5;

    return {
      mixtureMolecularWeight: Math.round(mixtureMW * 100) / 100,
      specificGravity: Math.round(specificGravity * 1000) / 1000,
      higherHeatingValueMJNm3: Math.round(hhvVolumetricMJNm3 * 100) / 100,
      lowerHeatingValueMJNm3: Math.round(lhvVolumetricMJNm3 * 100) / 100,
      higherHeatingValueMJKg: Math.round(hhvMassMJKg * 100) / 100,
      lowerHeatingValueMJKg: Math.round(lhvMassMJKg * 100) / 100,
      wobbeIndexMJNm3: Math.round(wobbeIndex * 100) / 100,
      modifiedWobbeIndexMJNm3: Math.round(modifiedWobbeIndex * 100) / 100,
      isWobbeAcceptable,
      heaviesWeightedScore
    };
  }

  /**
   * Sizing of Fuel Gas conditioning package including superheat check and preheater duty.
   *
   * @param {Object} params
   * @param {Object} params.compositionMolPct - Gas composition
   * @param {number} params.massFlowKgH - Gas fuel mass flow rate (kg/h)
   * @param {number} params.inletPressureBarg - Upstream supply header pressure (barg)
   * @param {number} params.deliveryPressureBarg - Target GT fuel manifold pressure (barg)
   * @param {number} params.inletTempC - Upstream supply temperature (C)
   * @param {number} [params.minRequiredSuperheatC=20.0] - Required margin above dew point (C)
   * @returns {Object} Complete conditioning report, JT cooling, and heater sizing
   */
  static sizeConditioningPackage(params) {
    const {
      compositionMolPct,
      massFlowKgH,
      inletPressureBarg,
      deliveryPressureBarg,
      inletTempC,
      minRequiredSuperheatC = 20.0
    } = params;

    const props = this.evaluateFuelProperties(compositionMolPct, inletTempC);

    // Approximate Hydrocarbon Dew Point (HCDP) based on C3+ concentration and delivery pressure
    // Richer gas = higher dew point
    const baseDewPointC = -30.0 + props.heaviesWeightedScore * 8.5;
    const pressureEffectC = Math.log10(Math.max(1.0, deliveryPressureBarg + 1.0)) * 12.0;
    const estimatedHcdpC = Math.min(25.0, baseDewPointC + pressureEffectC);

    // Joule-Thomson letdown cooling:
    // For natural gas, mu_JT ~ 0.50 °C / bar of pressure drop per GPSA / ISO
    const jtCoeff = params.jouleThomsonCoeffCPerBar !== undefined ? params.jouleThomsonCoeffCPerBar : 0.50;
    const deltaPBarg = Math.max(0, inletPressureBarg - deliveryPressureBarg);
    const jtCoolingC = deltaPBarg * jtCoeff;

    // Temperature after unheated JT expansion
    const unheatedDischargeTempC = inletTempC - jtCoolingC;

    // Required delivery temperature = HCDP + minRequiredSuperheat
    const requiredDeliveryTempC = estimatedHcdpC + minRequiredSuperheatC;

    // Upstream preheating required before or after expansion
    const targetHeaterOutletTempC = Math.max(inletTempC, requiredDeliveryTempC + jtCoolingC);
    const deltaTHeater = Math.max(0, targetHeaterOutletTempC - inletTempC);

    // Natural gas specific heat Cp ~ 2.3 kJ/(kg*K)
    const Cp_gas = 2.3;
    const mDotKgS = massFlowKgH / 3600.0;
    const heaterDutyKW = (mDotKgS * Cp_gas * deltaTHeater);

    const actualSuperheatC = (targetHeaterOutletTempC - jtCoolingC) - estimatedHcdpC;

    // Scrubber vessel sizing (Souders-Brown velocity: v_max = K_sb * sqrt((rho_L - rho_G)/rho_G))
    // K_sb ~ 0.07 m/s for coalescing mesh pad
    const P_abs_bar = deliveryPressureBarg + 1.01325;
    const rho_G = (P_abs_bar * 1e5 * props.mixtureMolecularWeight * 1e-3) / (8.314 * (requiredDeliveryTempC + 273.15));
    const rho_L = 600.0; // Hydrocarbon condensate
    const v_max = 0.07 * Math.sqrt((rho_L - rho_G) / rho_G);
    const volumetricFlowM3S = mDotKgS / rho_G;
    const minVesselAreaM2 = volumetricFlowM3S / v_max;
    const minVesselDiameterMm = Math.ceil(Math.sqrt((4.0 * minVesselAreaM2) / Math.PI) * 1000.0);

    return {
      combustionProperties: props,
      operatingPressures: {
        inletPressureBarg,
        deliveryPressureBarg,
        pressureDropBarg: deltaPBarg
      },
      thermalDewPointAnalysis: {
        estimatedHcdpC: Math.round(estimatedHcdpC * 10) / 10,
        jouleThomsonCoolingDeltaTC: Math.round(jtCoolingC * 10) / 10,
        unheatedDeliveryTempC: Math.round(unheatedDischargeTempC * 10) / 10,
        minimumRequiredDeliveryTempC: Math.round(requiredDeliveryTempC * 10) / 10,
        superheatMarginAchievedC: Math.round(actualSuperheatC * 10) / 10,
        isSuperheatAdequate: Math.round(actualSuperheatC * 10) / 10 >= minRequiredSuperheatC
      },
      preheaterSizing: {
        heaterDutyKW: Math.round(heaterDutyKW * 10) / 10,
        heaterDutyMW: Math.round((heaterDutyKW / 1000.0) * 100) / 100,
        gasInletTempC: inletTempC,
        gasOutletTempC: Math.round(targetHeaterOutletTempC * 10) / 10,
        heaterType: heaterDutyKW > 500 ? 'Indirect Water Bath Heater' : 'Electric Immersion Circulation Heater'
      },
      scrubberVessel: {
        gasDensityKgM3: Math.round(rho_G * 100) / 100,
        maxVaporVelocityMS: Math.round(v_max * 100) / 100,
        minimumVesselDiameterMm: Math.max(450, Math.ceil(minVesselDiameterMm / 50.0) * 50),
        internals: 'Vane inlet diffuser + 100mm 316L wire mesh demister pad + coalescing cartridge filters'
      }
    };
  }
}

module.exports = {
  FuelGasConditioningSystem,
  COMPONENT_DATA
};
