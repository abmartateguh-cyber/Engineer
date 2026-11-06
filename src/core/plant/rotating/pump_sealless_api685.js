/**
 * API 685 Sealless Magnetic-Drive and Canned-Motor Centrifugal Pump Engine.
 *
 * Implements:
 * 1. API 685 Sealless Pump Architecture (Magnetic Drive MDP and Canned Motor CMP).
 * 2. Containment shell eddy-current heat loss modeling:
 *    - Metallic shells (Hastelloy C-276, Titanium Gr 5, 316L).
 *    - Zero-loss non-metallic shells (Zirconia Ceramic, PEEK / Carbon Fiber composite).
 *    - Electromagnetic dissipation as a function of flux density, speed, radius, and resistivity.
 * 3. API 685 Internal Circulation Flush Schemes:
 *    - Plan 11-SE: Discharge through containment shell to suction.
 *    - Plan 13-SE: Shell directly to suction header.
 *    - Plan 23-SE: Closed internal loop with auxiliary impeller and heat exchanger.
 * 4. Thermal equilibrium and boiling margin verification:
 *    - Liquid temperature rise across containment can.
 *    - Local vapor pressure vs internal shell pressure.
 *    - Vapor lock and silicon carbide (SiC) bearing dry-run prevention.
 */

'use strict';

const CONTAINMENT_SHELL_MATERIALS = {
  HASTELLOY_C276: {
    name: 'Hastelloy C-276',
    resistivityOhmM: 1.30e-6,
    isConductive: true,
    maxPressureBar: 100.0,
    maxTempC: 350.0
  },
  TITANIUM_GR5: {
    name: 'Titanium Grade 5 (Ti-6Al-4V)',
    resistivityOhmM: 1.78e-6,
    isConductive: true,
    maxPressureBar: 60.0,
    maxTempC: 250.0
  },
  SS316L: {
    name: 'Austenitic Stainless Steel 316L',
    resistivityOhmM: 0.74e-6,
    isConductive: true,
    maxPressureBar: 50.0,
    maxTempC: 300.0
  },
  CERAMIC_ZIRCONIA: {
    name: 'Transformation Toughened Zirconia (TTZ)',
    resistivityOhmM: Infinity,
    isConductive: false,
    maxPressureBar: 40.0,
    maxTempC: 250.0
  },
  PEEK_COMPOSITE: {
    name: 'Carbon-Fiber Reinforced PEEK',
    resistivityOhmM: 1.0e12,
    isConductive: false,
    maxPressureBar: 25.0,
    maxTempC: 150.0
  }
};

class PumpSeallessApi685 {
  /**
   * Calculates containment shell eddy-current dissipation per electromagnetic induction principles.
   *
   * @param {Object} params
   * @param {string} [params.shellMaterial='HASTELLOY_C276'] - Key from CONTAINMENT_SHELL_MATERIALS
   * @param {number} params.speedRpm - Operating speed (rpm)
   * @param {number} [params.shellDiameterMm=140.0] - Outer diameter of containment shell (mm)
   * @param {number} [params.shellLengthMm=180.0] - Active length of shell within magnetic field (mm)
   * @param {number} [params.shellWallThicknessMm=1.5] - Wall thickness (mm)
   * @param {number} [params.magneticFluxDensityTesla=0.75] - Peak air-gap magnetic flux density B_max (Tesla)
   * @param {number} [params.polePairs=4] - Number of magnetic pole pairs (typically 3 to 6)
   * @returns {Object} Eddy current power loss and thermal dissipation
   */
  static evaluateContainmentShellLoss(params) {
    const {
      shellMaterial = 'HASTELLOY_C276',
      speedRpm,
      shellDiameterMm = 140.0,
      shellLengthMm = 180.0,
      shellWallThicknessMm = 1.5,
      magneticFluxDensityTesla = 0.75,
      polePairs = 4
    } = params;

    const matKey = shellMaterial.toUpperCase().replace(/-/g, '_');
    const mat = CONTAINMENT_SHELL_MATERIALS[matKey] || CONTAINMENT_SHELL_MATERIALS.HASTELLOY_C276;

    if (!mat.isConductive || !isFinite(mat.resistivityOhmM)) {
      return {
        material: mat.name,
        isNonConductive: true,
        eddyCurrentLossKW: 0.0,
        thermalDissipationWatts: 0.0,
        explanation: 'Non-conductive containment shell eliminates electromagnetic eddy-current losses entirely.'
      };
    }

    const omega = (2.0 * Math.PI * speedRpm) / 60.0; // rad/s
    const R_m = (shellDiameterMm * 1e-3) / 2.0;
    const L_m = shellLengthMm * 1e-3;
    const t_m = shellWallThicknessMm * 1e-3;
    const B = magneticFluxDensityTesla;
    const p = polePairs;
    const rho_e = mat.resistivityOhmM;

    // Eddy-current power dissipation in cylindrical conducting shell:
    // P_eddy = (pi / 4) * (B^2 * omega^2 * p^2 * R^3 * L * t) / rho_e * formFactor
    const formFactor = 0.082; // dimensionless empirical factor calibrated to API 685 test stands
    const P_eddy_watts = (Math.PI / 4.0) * (Math.pow(B, 2) * Math.pow(omega, 2) * Math.pow(p, 1.2) * Math.pow(R_m, 3) * L_m * t_m * formFactor) / rho_e;
    const P_eddy_kw = P_eddy_watts * 1e-3;

    return {
      material: mat.name,
      isNonConductive: false,
      eddyCurrentLossKW: Math.round(P_eddy_kw * 100) / 100,
      thermalDissipationWatts: Math.round(P_eddy_watts),
      magneticFluxDensityTesla: B,
      speedRpm
    };
  }

  /**
   * Evaluates complete API 685 sealless pump hydraulics, circulation flush, and boiling margin.
   *
   * @param {Object} params
   * @param {number} params.flowRateM3H - Process flow rate (m3/h)
   * @param {number} params.differentialHeadM - Total dynamic head (m)
   * @param {number} params.suctionPressureBarg - Suction pressure (barg)
   * @param {number} params.dischargePressureBarg - Discharge pressure (barg)
   * @param {number} params.suctionTempC - Pumping temperature (°C)
   * @param {number} params.liquidDensityKgM3 - Liquid density (kg/m3)
   * @param {number} [params.specificHeatCapacityJKgK=2200.0] - Fluid Cp (J/kg*K)
   * @param {number} params.vaporPressureAtSuctionTempBara - Vapor pressure at suction temperature (bara)
   * @param {number} params.vaporPressureSlopeBarPerC - dPvap/dT at operating point (bar/°C)
   * @param {number} params.speedRpm - Operating speed (rpm)
   * @param {number} [params.hydraulicEfficiency=0.75] - Pump impeller efficiency
   * @param {string} [params.shellMaterial='HASTELLOY_C276'] - Containment shell material
   * @param {string} [params.circulationPlan='PLAN_11SE'] - 'PLAN_11SE', 'PLAN_13SE', or 'PLAN_23SE'
   * @param {number} [params.circulationFlowRateM3H] - Flush flow rate (auto-sized if omitted)
   * @returns {Object} Complete API 685 thermal and hydraulic audit
   */
  static evaluateSeallessPump(params) {
    const {
      flowRateM3H,
      differentialHeadM,
      suctionPressureBarg,
      dischargePressureBarg,
      suctionTempC,
      liquidDensityKgM3,
      specificHeatCapacityJKgK = 2200.0,
      vaporPressureAtSuctionTempBara,
      vaporPressureSlopeBarPerC,
      speedRpm,
      hydraulicEfficiency = 0.75,
      shellMaterial = 'HASTELLOY_C276',
      circulationPlan = 'PLAN_11SE',
      circulationFlowRateM3H
    } = params;

    if (flowRateM3H <= 0) throw new Error('Process flow rate must be positive');
    if (differentialHeadM <= 0) throw new Error('Differential head must be positive');
    if (liquidDensityKgM3 <= 0) throw new Error('Liquid density must be positive');
    if (speedRpm <= 0) throw new Error('Operating speed must be positive');
    if (hydraulicEfficiency <= 0 || hydraulicEfficiency > 1.0) {
      throw new Error('Hydraulic efficiency must be between 0 and 1.0');
    }
    if (circulationFlowRateM3H !== undefined && circulationFlowRateM3H <= 0) {
      throw new Error('Circulation flow rate must be positive');
    }

    const g = 9.80665;
    const rho = liquidDensityKgM3;
    const Cp = specificHeatCapacityJKgK;

    // 1. Hydraulic & Impeller Shaft Work
    const Q_m3_s = flowRateM3H / 3600.0;
    const hydraulicPowerKW = (rho * g * Q_m3_s * differentialHeadM) * 1e-3;
    const impellerPowerKW = hydraulicPowerKW / hydraulicEfficiency;

    // 2. Containment Shell Losses & Silicon Carbide Bearing Friction
    const eddyResult = this.evaluateContainmentShellLoss({
      shellMaterial,
      speedRpm
    });
    const eddyLossKW = eddyResult.eddyCurrentLossKW;
    const bearingFrictionKW = Math.max(0.5, 0.012 * impellerPowerKW);
    const totalInternalHeatLoadKW = eddyLossKW + bearingFrictionKW;

    // Total Driver Brake Power
    const totalBrakePowerKW = impellerPowerKW + totalInternalHeatLoadKW;

    // 3. Circulation Flush Flow Rate
    // If not supplied, size circulation flush to keep temperature rise <= 6.0 °C
    const targetDeltaTC = 5.0;
    const minRequiredCircFlowKgS = (totalInternalHeatLoadKW * 1000.0) / (Cp * targetDeltaTC);
    const minRequiredCircFlowM3H = (minRequiredCircFlowKgS / rho) * 3600.0;

    const actualCircFlowM3H = circulationFlowRateM3H !== undefined
      ? circulationFlowRateM3H
      : Math.max(1.5, minRequiredCircFlowM3H);

    const actualCircFlowKgS = (actualCircFlowM3H * rho) / 3600.0;

    // 4. Actual Temperature Rise in Containment Shell
    const deltaTRiseC = (totalInternalHeatLoadKW * 1000.0) / (actualCircFlowKgS * Cp);
    const shellInternalTempC = suctionTempC + deltaTRiseC;

    // 5. Local Pressure in Containment Shell based on Plan
    const P_suct_bara = suctionPressureBarg + 1.01325;
    const P_disch_bara = dischargePressureBarg + 1.01325;
    const deltaP_pump_bar = P_disch_bara - P_suct_bara;

    let shellPressureBara;
    if (circulationPlan.toUpperCase() === 'PLAN_11SE') {
      // Plan 11-SE: from discharge through orifice into shell, returning to suction
      shellPressureBara = P_suct_bara + 0.35 * deltaP_pump_bar;
    } else if (circulationPlan.toUpperCase() === 'PLAN_13SE') {
      // Plan 13-SE: shell returns directly to suction
      shellPressureBara = P_suct_bara + 0.12 * deltaP_pump_bar;
    } else {
      // Plan 23-SE (Reverse / High Pressure loop): shell kept near full discharge pressure
      shellPressureBara = P_suct_bara + 0.80 * deltaP_pump_bar;
    }

    // 6. Local Vapor Pressure & Boiling Margin
    // Estimated local vapor pressure at elevated shell temperature
    const vpSlope = (vaporPressureSlopeBarPerC && vaporPressureSlopeBarPerC > 0)
      ? vaporPressureSlopeBarPerC
      : 0.05;
    const dPvap = deltaTRiseC * vpSlope;
    const localVaporPressureBara = vaporPressureAtSuctionTempBara + dPvap;

    // API 685 Boiling Margin
    const pressureMarginBar = shellPressureBara - localVaporPressureBara;
    const tempMarginC = pressureMarginBar / vpSlope;

    // API 685 Criteria: Boiling margin must exceed 1.0 bar (or 10°C) to prevent flashing at bearings
    const meetsBoilingMargin = pressureMarginBar >= 1.0 && tempMarginC >= 10.0;

    return {
      standard: 'API 685 (Sealless Centrifugal Pumps)',
      flowRateM3H,
      differentialHeadM,
      hydraulicPowerKW: Math.round(hydraulicPowerKW * 10) / 10,
      impellerShaftPowerKW: Math.round(impellerPowerKW * 10) / 10,
      containmentShell: {
        material: eddyResult.material,
        eddyCurrentLossKW: eddyLossKW,
        bearingFrictionLossKW: Math.round(bearingFrictionKW * 100) / 100,
        totalHeatLoadToFluidKW: Math.round(totalInternalHeatLoadKW * 100) / 100
      },
      totalPumpInputPowerKW: Math.round(totalBrakePowerKW * 10) / 10,
      circulationFlush: {
        plan: circulationPlan,
        circulationFlowM3H: Math.round(actualCircFlowM3H * 100) / 100,
        temperatureRiseC: Math.round(deltaTRiseC * 10) / 10,
        shellInternalTempC: Math.round(shellInternalTempC * 10) / 10,
        localShellPressureBara: Math.round(shellPressureBara * 100) / 100,
        localVaporPressureBara: Math.round(localVaporPressureBara * 100) / 100,
        boilingPressureMarginBar: Math.round(pressureMarginBar * 100) / 100,
        boilingTemperatureMarginC: Math.round(tempMarginC * 10) / 10,
        meetsBoilingMargin,
        dryRunVaporLockRisk: !meetsBoilingMargin
      }
    };
  }
}

module.exports = { PumpSeallessApi685, CONTAINMENT_SHELL_MATERIALS };
