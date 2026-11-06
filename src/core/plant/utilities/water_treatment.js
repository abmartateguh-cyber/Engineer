/**
 * Industrial Water Treatment, Wastewater Stripping & NFPA 20 Firewater Package.
 *
 * Implements:
 * 1. Demineralized Water / Seawater Reverse Osmosis (SWRO) Desalination:
 *    - Feed, permeate, and concentrate brine mass balances
 *    - High-pressure pump pressure & Energy Recovery Device (ERD Isobaric PX) power savings
 *    - Specific Energy Consumption (SEC, kWh/m3) and permeate quality
 *    - Electrodeionization (EDI) / Mixed-bed polisher for high-pressure BFW (< 0.1 uS/cm, < 10 ppb SiO2)
 * 2. Sour Water Stripping (SWS) & Oily Wastewater Treatment:
 *    - Sour water stripping steam ratio (0.12 - 0.16 kg/kg feed) for H2S and NH3 removal
 *    - API Gravity Oil-Water Separator sizing based on Stokes' Law globule rise velocity
 *    - Dissolved Air Flotation (DAF) effluent polish
 * 3. NFPA 20 Dedicated Firewater Ring-Main & Pumping Station:
 *    - Worst-case single risk fire demand (LNG tank deluge, process unit monitors, hose streams)
 *    - Dedicated firewater reservoir storage volume (minimum 4 to 6 hours continuous supply)
 *    - Pump package: Main Electric Pump, 100% Diesel Backup Pump, and Pressure Jockey Pump.
 */

'use strict';

class WaterTreatmentSystems {
  /**
   * Sizes a Seawater Reverse Osmosis (SWRO) desalination and demineralization unit.
   *
   * @param {Object} params
   * @param {number} params.permeateFlowM3H - Required pure water production rate (m3/h)
   * @param {number} [params.seawaterSalinityTdsMgL=38000] - Seawater Total Dissolved Solids (mg/L)
   * @param {number} [params.recoveryRatio=0.42] - Membrane water recovery fraction (typically 0.40 - 0.45)
   * @param {number} [params.feedPressureBarg=65.0] - High pressure pump discharge pressure (barg)
   * @param {number} [params.erdEfficiency=0.96] - Energy Recovery Device pressure transfer efficiency
   * @returns {Object} SWRO flows, power consumption, and water quality metrics
   */
  static sizeSwroDesalination(params) {
    const {
      permeateFlowM3H,
      seawaterSalinityTdsMgL = 38000,
      recoveryRatio = 0.42,
      feedPressureBarg = 65.0,
      erdEfficiency = 0.96
    } = params;

    if (!permeateFlowM3H || permeateFlowM3H <= 0) {
      throw new Error('permeateFlowM3H must be positive');
    }
    if (recoveryRatio <= 0 || recoveryRatio >= 1.0) {
      throw new Error('recoveryRatio must be between 0 and 1.0');
    }

    // Mass balance:
    // Q_feed = Q_permeate / recovery
    const feedFlowM3H = permeateFlowM3H / recoveryRatio;
    const brineFlowM3H = feedFlowM3H - permeateFlowM3H;

    // Brine TDS: C_brine = C_feed / (1 - recovery)
    const brineSalinityTdsMgL = seawaterSalinityTdsMgL / (1.0 - recoveryRatio);

    // Permeate TDS (assuming 99.7% salt rejection)
    const permeateTdsMgL = seawaterSalinityTdsMgL * (1.0 - 0.997);

    // Hydraulic Power of High Pressure Pump without ERD:
    // P_gross = (Q_feed * deltaP) / (36 * eta_pump)
    const etaPump = 0.85;
    const grossPumpPowerKW = (feedFlowM3H * feedPressureBarg * 100.0) / (3600.0 * etaPump);

    // Energy recovered by isobaric pressure exchanger (PX) from high-pressure reject brine:
    // P_recovered = (Q_brine * (feedPressure - 2.0) * erdEfficiency) / (36 * eta_pump)
    const recoveredPowerKW = (brineFlowM3H * (feedPressureBarg - 2.0) * 100.0 * erdEfficiency) / (3600.0 * etaPump);

    const netHpPumpPowerKW = Math.max(0, grossPumpPowerKW - recoveredPowerKW);
    // Add booster pump and auxiliary power (~ 0.4 kWh/m3)
    const totalPowerKW = netHpPumpPowerKW + permeateFlowM3H * 0.45;

    // Specific Energy Consumption (SEC) in kWh / m3 of permeate
    const secKWhM3 = totalPowerKW / permeateFlowM3H;

    return {
      permeateFlowM3H: Math.round(permeateFlowM3H * 10) / 10,
      feedFlowM3H: Math.round(feedFlowM3H * 10) / 10,
      brineConcentrateFlowM3H: Math.round(brineFlowM3H * 10) / 10,
      recoveryPercent: Math.round(recoveryRatio * 1000) / 10,
      waterQuality: {
        feedTdsMgL: seawaterSalinityTdsMgL,
        brineTdsMgL: Math.round(brineSalinityTdsMgL),
        permeateTdsMgL: Math.round(permeateTdsMgL * 10) / 10,
        deminBfwConductivityUSCm: '< 0.08 µS/cm (after Mixed-Bed / EDI polishing)',
        deminSilicaPpb: '< 10 ppb SiO₂'
      },
      energyBalance: {
        feedPressureBarg,
        grossHpPumpPowerKW: Math.round(grossPumpPowerKW * 10) / 10,
        erdPowerSavingsKW: Math.round(recoveredPowerKW * 10) / 10,
        netOperatingPowerKW: Math.round(totalPowerKW * 10) / 10,
        specificEnergyConsumptionKWhM3: Math.round(secKWhM3 * 100) / 100
      }
    };
  }

  /**
   * Evaluates Sour Water Stripper (SWS) and API oil-water separator.
   *
   * @param {Object} params
   * @param {number} params.sourWaterFlowM3H - Sour water effluent feed (m3/h)
   * @param {number} params.inletH2sPpmw - Feed dissolved H2S (ppmw)
   * @param {number} params.inletNh3Ppmw - Feed dissolved NH3 (ppmw)
   * @param {number} params.oilyWaterFlowM3H - Oily wastewater runoff (m3/h)
   * @returns {Object} SWS steam consumption and API separator dimensions
   */
  static evaluateWastewaterTreatment(params) {
    const {
      sourWaterFlowM3H,
      inletH2sPpmw,
      inletNh3Ppmw,
      oilyWaterFlowM3H
    } = params;

    // 1. Sour Water Stripper (SWS):
    // Standard stripping steam ratio: 0.14 kg LP steam per kg sour water feed
    const rho_water = 1000.0;
    const sourWaterMassFlowKgH = sourWaterFlowM3H * rho_water;
    const strippingSteamDemandKgH = sourWaterMassFlowKgH * 0.14;

    // Off-gas generation
    const h2sMassKgH = sourWaterMassFlowKgH * (inletH2sPpmw * 1e-6);
    const nh3MassKgH = sourWaterMassFlowKgH * (inletNh3Ppmw * 1e-6);

    // 2. API Oil-Water Separator (Stokes' Law rising velocity):
    // v_r = g * (rho_w - rho_o) * d_p^2 / (18 * mu_w)
    // Water density = 998 kg/m3, Oil density = 850 kg/m3, Droplet diameter = 150 microns (150e-6 m)
    // Dynamic viscosity mu_w = 0.001 Pa*s
    const g = 9.81;
    const deltaRho = 998.0 - 850.0;
    const dp = 150e-6; // 150 micrometers
    const mu_w = 0.001; // Pa*s
    const v_r_m_s = (g * deltaRho * dp * dp) / (18.0 * mu_w); // ~ 0.0020 m/s = 0.12 m/min

    // Basin surface area A_H = Q / v_r
    const oilyFlowM3S = oilyWaterFlowM3H / 3600.0;
    const requiredSurfaceAreaM2 = oilyFlowM3S / v_r_m_s;

    // Standard width to depth ratio (W/D = 2 to 3, length L/W = 3 to 5 per API 421)
    const basinWidthM = Math.max(1.5, Math.round(Math.sqrt(requiredSurfaceAreaM2 / 4.0) * 10) / 10);
    const basinLengthM = Math.max(Math.round(basinWidthM * 3.0 * 10) / 10, Math.round((requiredSurfaceAreaM2 / basinWidthM) * 10) / 10);
    const basinDepthM = 1.8; // Standard 1.8m water depth

    return {
      sourWaterStripper: {
        feedFlowM3H: sourWaterFlowM3H,
        strippingSteamDemandKgH: Math.round(strippingSteamDemandKgH * 10) / 10,
        strippingSteamRatioKgKg: 0.14,
        acidGasToClausKgH: Math.round((h2sMassKgH + nh3MassKgH) * 10) / 10,
        treatedWaterH2sPpmw: '< 5 ppmw',
        treatedWaterNh3Ppmw: '< 15 ppmw'
      },
      apiOilWaterSeparator: {
        designFlowRateM3H: oilyWaterFlowM3H,
        oilGlobuleRiseVelocityMmS: Math.round(v_r_m_s * 1000.0 * 100) / 100,
        minimumBasinSurfaceAreaM2: Math.round(requiredSurfaceAreaM2 * 10) / 10,
        recommendedBasinDimensions: {
          lengthM: basinLengthM,
          widthM: basinWidthM,
          depthM: basinDepthM,
          numberOfChannels: 2
        },
        effluentFreeOilPpm: '< 30 ppm (ready for DAF polishing to < 10 ppm)'
      }
    };
  }

  /**
   * Sizing of dedicated industrial firewater ring-main and pumping station per NFPA 20.
   *
   * @param {Object} params
   * @param {number} params.maxSingleRiskDemandM3H - Peak firewater demand in worst-case fire area (m3/h)
   * @param {number} [params.autonomyHours=4.0] - Dedicated storage supply duration (hours)
   * @param {number} [params.ringMainPressureBarg=10.5] - Operating pressure at pump discharge (barg)
   * @returns {Object} Firewater storage, pump sizing, and NFPA 20 architecture
   */
  static sizeFirewaterPackage(params) {
    const {
      maxSingleRiskDemandM3H,
      autonomyHours = 4.0,
      ringMainPressureBarg = 10.5
    } = params;

    if (!maxSingleRiskDemandM3H || maxSingleRiskDemandM3H <= 0) {
      throw new Error('maxSingleRiskDemandM3H must be positive');
    }

    // Required storage reservoir capacity (m3) per NFPA 20 / 22
    const totalStorageVolumeM3 = maxSingleRiskDemandM3H * autonomyHours;

    // Sizing 2 identical storage tanks (50% each for tank cleaning/maintenance redundancy)
    const tankVolumeEachM3 = totalStorageVolumeM3 / 2.0;

    // Pump station sizing per NFPA 20:
    // - Jockey pump: maintains ring main pressure at 11.5 barg (typically 1-2% of main pump flow)
    const jockeyFlowM3H = Math.max(15.0, Math.round(maxSingleRiskDemandM3H * 0.015));
    const jockeyPowerKW = (jockeyFlowM3H * (ringMainPressureBarg + 1.0) * 100.0) / (3600.0 * 0.70);

    // - Main pumps: 2 x 100% capacity (1 Electric Motor Driven + 1 Diesel Engine Driven)
    // Sized for total demand at rated head
    const mainPumpFlowM3H = maxSingleRiskDemandM3H;
    const mainPumpHydraulicPowerKW = (mainPumpFlowM3H * ringMainPressureBarg * 100.0) / (3600.0 * 0.78);
    const mainPumpDriverKW = Math.ceil((mainPumpHydraulicPowerKW * 1.15) / 10) * 10;

    return {
      designBasis: {
        worstCaseFireArea: 'LNG Process Refrigeration & Fractionation Deluge + Monitor Grid',
        peakFirewaterDemandM3H: maxSingleRiskDemandM3H,
        autonomyDurationHours: autonomyHours,
        ringMainDesignPressureBarg: ringMainPressureBarg
      },
      reservoirStorage: {
        totalDedicatedVolumeM3: Math.round(totalStorageVolumeM3),
        tanksConfiguration: `2 x Dedicated Carbon Steel / Glass-Fused Tanks (${Math.round(tankVolumeEachM3)} m³ each)`,
        replenishmentSource: 'SWRO desalinated water & clean seawater backup'
      },
      pumpStationConfiguration: {
        mainElectricFirePump: {
          tag: 'P-9101A',
          flowM3H: mainPumpFlowM3H,
          dischargePressureBarg: ringMainPressureBarg,
          motorRatingKW: mainPumpDriverKW,
          driverType: 'Electric Motor (Fed from Essential HV Switchboard)'
        },
        backupDieselFirePump: {
          tag: 'P-9101B',
          flowM3H: mainPumpFlowM3H,
          dischargePressureBarg: ringMainPressureBarg,
          engineRatingKW: mainPumpDriverKW,
          driverType: 'NFPA 20 Industrial Diesel Engine with Dual Starting Batteries & 8h Day Tank'
        },
        jockeyPressureMaintenancePump: {
          tag: 'P-9102',
          flowM3H: jockeyFlowM3H,
          dischargePressureBarg: ringMainPressureBarg + 1.0,
          motorRatingKW: Math.round(jockeyPowerKW * 10) / 10,
          service: 'Continuous ring-main leakage makeup & pressure maintenance'
        }
      }
    };
  }
}

module.exports = {
  WaterTreatmentSystems
};
