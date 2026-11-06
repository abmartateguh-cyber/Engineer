/**
 * LNG Regasification Terminal Send-Out Vaporizers Engineering Engine.
 *
 * Implements:
 * 1. Thermodynamic regasification heat duty:
 *    Q = m_dot_lng * Delta_h_vaporization_superheat (MW)
 *    LNG at -160 °C, 85 barg warmed to +5 °C pipeline gas.
 * 2. Open Rack Vaporizer (ORV):
 *    - Seawater falling film heat transfer on extruded aluminum alloy tubes with internal star fins
 *    - Strict environmental seawater thermal discharge verification (Delta T_sw <= 5.0 °C)
 *    - Seawater freezing avoidance check (T_sw_inlet >= 5.0 °C)
 * 3. Submerged Combustion Vaporizer (SCV):
 *    - Burner firing fuel gas into agitated turbulent water bath
 *    - High thermal efficiency (~ 98% LHV due to latent condensation recovery)
 *    - Fuel gas consumption rate (~ 1.2 to 1.5% of send-out throughput)
 *    - Water bath pH neutralizing caustic soda (NaOH) injection sizing
 * 4. Intermediate Fluid Vaporizer (IFV):
 *    - Closed-loop intermediate fluid (Propane / Glycol) eliminating seawater freezing risk
 *    - Two-stage condensing/vaporizing exchanger system with titanium seawater tubes.
 */

'use strict';

class LngRegasVaporizers {
  /**
   * Calculates overall LNG regasification thermal duty.
   *
   * @param {number} sendOutRateTonnesPerH - Supercritical LNG send-out flow (t/h)
   * @param {number} [inletTempC=-160] - Suction temperature (C)
   * @param {number} [outletTempC=5] - Delivery send-out temperature (C)
   * @param {number} [sendOutPressureBarg=85] - Pipeline transmission pressure (barg)
   * @returns {Object} Mass flow, enthalpy difference, and total thermal duty
   */
  static calculateRegasDuty(sendOutRateTonnesPerH, inletTempC = -160, outletTempC = 5, sendOutPressureBarg = 85) {
    if (!sendOutRateTonnesPerH || sendOutRateTonnesPerH <= 0) {
      throw new Error('sendOutRateTonnesPerH must be positive');
    }

    // Mass flow in kg/s
    const mDotKgS = (sendOutRateTonnesPerH * 1000.0) / 3600.0;

    // Enthalpy difference for supercritical methane between -160 C and +5 C at 85 barg:
    // h(-160 C, 85 bar) ~ -270 kJ/kg, h(+5 C, 85 bar) ~ 550 kJ/kg => Delta h ~ 820 kJ/kg
    const deltaHKJkg = 820.0 + (outletTempC - 5.0) * 2.3;
    const dutyMW = (mDotKgS * deltaHKJkg) * 1e-3;

    // Volumetric throughput in MMSCFD: 1 t/h LNG ~ 1.18 MMSCFD gas
    const mmscfd = sendOutRateTonnesPerH * 1.18;

    return {
      sendOutRateTonnesPerH,
      sendOutRateKgS: Math.round(mDotKgS * 10) / 10,
      sendOutRateMmscfd: Math.round(mmscfd * 10) / 10,
      inletTempC,
      outletTempC,
      sendOutPressureBarg,
      enthalpyDeltaKJkg: Math.round(deltaHKJkg * 10) / 10,
      thermalDutyMW: Math.round(dutyMW * 100) / 100
    };
  }

  /**
   * Sizes an Open Rack Vaporizer (ORV) seawater unit.
   *
   * @param {Object} params
   * @param {number} params.sendOutRateTonnesPerH - LNG flow (t/h)
   * @param {number} params.seawaterInletTempC - Seawater temperature (C)
   * @param {number} [params.maxSeawaterDeltaTC=5.0] - Permissible seawater Delta T (C)
   * @returns {Object} ORV engineering rating and seawater requirements
   */
  static sizeOpenRackVaporizer(params) {
    const {
      sendOutRateTonnesPerH,
      seawaterInletTempC,
      maxSeawaterDeltaTC = 5.0
    } = params;

    const duty = this.calculateRegasDuty(sendOutRateTonnesPerH);

    // Seawater freezing protection: ORV requires seawater >= 5C to prevent icing
    const isSeawaterTempFeasible = seawaterInletTempC >= 5.0;

    // Seawater flow: Q = m_sw * Cp_sw * DeltaT_sw
    const Cp_sw = 3.99; // kJ/(kg*K)
    const rho_sw = 1025.0; // kg/m3
    const deltaT_sw = maxSeawaterDeltaTC;

    const mDotSwKgS = (duty.thermalDutyMW * 1e3) / (Cp_sw * deltaT_sw);
    const flowSwM3H = (mDotSwKgS * 3600.0) / rho_sw;
    const seawaterDischargeTempC = seawaterInletTempC - deltaT_sw;

    // Typical heat transfer surface area (U ~ 950 W/m2*K, LMTD ~ 35 K)
    const overallUM2K = 950.0;
    const lmtdK = 38.0;
    const requiredAreaM2 = (duty.thermalDutyMW * 1e6) / (overallUM2K * lmtdK);

    return {
      technology: 'Open Rack Vaporizer (ORV)',
      thermalDutyMW: duty.thermalDutyMW,
      sendOutCapacityTonnesPerH: sendOutRateTonnesPerH,
      isSeawaterTempFeasible,
      seawaterOperating: {
        inletTempC: seawaterInletTempC,
        dischargeTempC: Math.round(seawaterDischargeTempC * 10) / 10,
        deltaTC: deltaT_sw,
        flowRateM3H: Math.round(flowSwM3H * 10) / 10,
        seawaterToLngRatioTonnesTonnes: Math.round(((flowSwM3H * rho_sw * 1e-3) / sendOutRateTonnesPerH) * 10) / 10
      },
      equipmentSizing: {
        tubeMaterial: 'Extruded Aluminum Alloy (A3003 with Al-Zn sacrificial cladding)',
        tubeProfile: 'Dual-Chamber External Extruded Panel with Star Internal Heat-Transfer Fins',
        totalExternalAreaM2: Math.round(requiredAreaM2),
        estimatedPanelsCount: Math.ceil(requiredAreaM2 / 320.0),
        pumpingPowerKW: Math.round((flowSwM3H * 0.035 * 10) / 10)
      },
      environmentalVerdict: {
        thermalDischargeCompliant: deltaT_sw <= 5.0,
        co2EmissionsKgH: 0.0, // Zero direct combustion emissions
        operatingExpenseRating: 'Very Low (Seawater pumping electricity only)'
      }
    };
  }

  /**
   * Sizes a Submerged Combustion Vaporizer (SCV) fuel-fired unit.
   *
   * @param {Object} params
   * @param {number} params.sendOutRateTonnesPerH - LNG flow (t/h)
   * @param {number} [params.fuelGasLhvMJNm3=36.5] - Fuel gas lower heating value (MJ/Nm3)
   * @param {number} [params.scvThermalEfficiencyPercent=98.0] - Thermal efficiency (LHV based)
   * @returns {Object} SCV engineering sizing and fuel gas consumption
   */
  static sizeSubmergedCombustionVaporizer(params) {
    const {
      sendOutRateTonnesPerH,
      fuelGasLhvMJNm3 = 36.5,
      scvThermalEfficiencyPercent = 98.0
    } = params;

    const duty = this.calculateRegasDuty(sendOutRateTonnesPerH);

    // Fuel gas heat input required: Q_fuel = Q_duty / eta_thermal
    const eta = scvThermalEfficiencyPercent / 100.0;
    const fuelHeatInputMW = duty.thermalDutyMW / eta;

    // Fuel gas flow rate:
    // Fuel (Nm3/h) = (fuelHeatInputMW * 3600) / fuelGasLhvMJNm3
    const fuelGasNm3H = (fuelHeatInputMW * 3600.0) / fuelGasLhvMJNm3;
    const fuelGasTonnesPerH = (fuelGasNm3H * 0.72) * 1e-3; // Natural gas density ~ 0.72 kg/Nm3

    // Fuel gas consumption as % of LNG regasified
    const fuelConsumptionPercent = (fuelGasTonnesPerH / sendOutRateTonnesPerH) * 100.0;

    // CO2 emissions generation: ~ 1.95 kg CO2 per Nm3 natural gas combusted
    const co2EmissionsKgH = fuelGasNm3H * 1.95;

    // Water bath pH control:
    // CO2 absorption into water bath produces carbonic acid; requires 20% NaOH solution dosing
    // Typical NaOH demand ~ 0.15 kg pure NaOH per tonne LNG vaporized
    const naohDosingKgH = sendOutRateTonnesPerH * 0.15;

    // Immersion tube bundle area (high U ~ 1700 W/m2*K)
    const lmtdBathK = 45.0; // Bath maintained at 40 C
    const overallUM2K = 1700.0;
    const tubeBundleAreaM2 = (duty.thermalDutyMW * 1e6) / (overallUM2K * lmtdBathK);

    return {
      technology: 'Submerged Combustion Vaporizer (SCV)',
      thermalDutyMW: duty.thermalDutyMW,
      sendOutCapacityTonnesPerH: sendOutRateTonnesPerH,
      combustionPerformance: {
        thermalEfficiencyPercent: scvThermalEfficiencyPercent,
        fuelGasConsumptionNm3H: Math.round(fuelGasNm3H * 10) / 10,
        fuelGasConsumptionTonnesH: Math.round(fuelGasTonnesPerH * 100) / 100,
        fuelConsumptionPercentageOfSendout: Math.round(fuelConsumptionPercent * 100) / 100,
        hourlyCo2EmissionsTonnesH: Math.round((co2EmissionsKgH * 1e-3) * 100) / 100
      },
      bathOperation: {
        waterBathTempC: 40.0,
        burnerType: 'Low-NOx Down-Fired Submerged Sparger Burner',
        bathNeutralizationNaohDemandKgH: Math.round(naohDosingKgH * 10) / 10,
        tubeBundleAreaM2: Math.round(tubeBundleAreaM2),
        tubeMaterial: 'AISI 316L / 304L Austenitic Stainless Steel'
      },
      applicationSuitability: 'Ideal for peak-shaving, cold climates where seawater < 5°C, or rapid cold start (< 10 min).'
    };
  }

  /**
   * Sizes an Intermediate Fluid Vaporizer (IFV) propane loop unit.
   *
   * @param {Object} params
   * @param {number} params.sendOutRateTonnesPerH - LNG flow (t/h)
   * @param {number} params.seawaterInletTempC - Seawater temperature (C)
   * @returns {Object} IFV two-stage rating and intermediate loop parameters
   */
  static sizeIntermediateFluidVaporizer(params) {
    const {
      sendOutRateTonnesPerH,
      seawaterInletTempC
    } = params;

    const duty = this.calculateRegasDuty(sendOutRateTonnesPerH);

    // Two stages:
    // Stage 1 (E-01): Seawater warms & evaporates propane at 0 C (latent heat ~ 375 kJ/kg)
    // Stage 2 (E-02): Propane vapor condenses at 0 C on titanium LNG tubes
    const propaneCirculationKgS = (duty.thermalDutyMW * 1e3) / 375.0;
    const propaneCirculationM3H = (propaneCirculationKgS * 3600.0) / 580.0; // Propane liquid density ~ 580 kg/m3

    // Seawater flow (Delta T = 5 C)
    const mDotSwKgS = (duty.thermalDutyMW * 1e3) / (3.99 * 5.0);
    const seawaterFlowM3H = (mDotSwKgS * 3600.0) / 1025.0;

    return {
      technology: 'Intermediate Fluid Vaporizer (IFV)',
      thermalDutyMW: duty.thermalDutyMW,
      intermediateFluid: 'High-Purity Commercial Propane (C3H8)',
      intermediateLoop: {
        propaneEvaporationTempC: 0.0,
        propaneSaturationPressureBarg: 3.75,
        propaneCirculationKgS: Math.round(propaneCirculationKgS * 10) / 10,
        propaneCirculationM3H: Math.round(propaneCirculationM3H * 10) / 10,
        seawaterFreezingRisk: 'Completely eliminated (Seawater never contacts sub-zero surfaces)'
      },
      seawaterConsumption: {
        inletTempC: seawaterInletTempC,
        outletTempC: Math.round((seawaterInletTempC - 5.0) * 10) / 10,
        flowRateM3H: Math.round(seawaterFlowM3H * 10) / 10
      },
      materialsOfConstruction: {
        seawaterEvaporator: 'Titanium Grade 2 Plate-Fin or Shell & Tube (100% seawater erosion/corrosion immune)',
        lngCondenser: 'AISI 304L Stainless Steel'
      }
    };
  }
}

module.exports = {
  LngRegasVaporizers
};
