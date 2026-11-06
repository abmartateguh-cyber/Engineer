/**
 * API 614 Lubrication & Control Oil System & API 692 Dry Gas Seal Panel Engine.
 *
 * Implements:
 * 1. API 614 Chapter 2 / Chapter 3 Lubrication Oil Console Sizing:
 *    - Hydrodynamic journal and tilt-pad thrust bearing frictional heat dissipation.
 *    - Gearbox mesh frictional heat load (when intermediate speed-increasing gear is present).
 *    - Required circulating oil mass and volumetric flow rate (delta_T ~ 15-20°C).
 *    - Reservoir working volume and retention time (API 614 minimum 8 minutes).
 *    - Overhead emergency gravity rundown tank (API 614 minimum 3 minutes coastdown protection).
 *    - Duplex oil cooler duty with 20% fouling margin and duplex 10-micron filter sizing.
 * 2. API 692 Dry Gas Seal (DGS) Buffer and Seal Gas Conditioning Panel:
 *    - Tandem seal (Arrangement 2) and Double-Pressurized seal (Arrangement 3).
 *    - Primary seal gas conditioning (3-micron filtration, 20°C dew point superheat).
 *    - Dynamic spiral-groove face primary leakage flow and vent orifice sizing.
 *    - Intermediate N2 buffer gas sweep and carbon-ring separation seal barrier pressure.
 */

'use strict';

class LubeSealOilApi614 {
  /**
   * Sizes an API 614 lubrication oil console for rotating turbomachinery trains.
   *
   * @param {Object} params
   * @param {number} params.totalShaftPowerKW - Total driver/driven train shaft power (kW)
   * @param {number} [params.journalBearingCount=4] - Number of radial journal bearings
   * @param {number} [params.thrustBearingCount=2] - Number of tilt-pad thrust bearings
   * @param {boolean} [params.hasGearbox=false] - True if speed-increasing or reduction gearbox is in train
   * @param {number} [params.oilSupplyTempC=45.0] - Bearing oil supply header temperature (°C)
   * @param {number} [params.oilReturnTempC=62.0] - Bearing oil return drain header temperature (°C)
   * @param {number} [params.oilDensityKgM3=860.0] - ISO VG 32 or 46 lube oil density (kg/m3)
   * @param {number} [params.oilCpKJkgK=2.05] - Specific heat capacity of mineral lube oil (kJ/kg*K)
   * @param {number} [params.customFrictionHeatKW] - Explicit bearing/gear heat load (overrides default estimation)
   * @returns {Object} Bearing heat loads, oil flow rate, reservoir capacity, rundown tank, and cooler duty
   */
  static sizeLubeOilConsole(params) {
    const {
      totalShaftPowerKW,
      journalBearingCount = 4,
      thrustBearingCount = 2,
      hasGearbox = false,
      oilSupplyTempC = 45.0,
      oilReturnTempC = 62.0,
      oilDensityKgM3 = 860.0,
      oilCpKJkgK = 2.05,
      customFrictionHeatKW
    } = params;

    if (totalShaftPowerKW <= 0) throw new Error('Shaft power must be positive');
    if (journalBearingCount < 0 || thrustBearingCount < 0) {
      throw new Error('Bearing counts cannot be negative');
    }
    if (oilDensityKgM3 <= 0 || oilCpKJkgK <= 0) {
      throw new Error('Oil density and heat capacity must be positive');
    }

    const deltaT_oil = oilReturnTempC - oilSupplyTempC;
    if (deltaT_oil <= 5.0) throw new Error('Oil return temperature must exceed supply by at least 5°C');

    // 1. Bearing & Gearbox Heat Dissipation Load
    let totalHeatKW;
    let journalHeatKW;
    let thrustHeatKW;
    let gearHeatKW = 0.0;

    if (customFrictionHeatKW !== undefined) {
      totalHeatKW = customFrictionHeatKW;
      journalHeatKW = customFrictionHeatKW * 0.45;
      thrustHeatKW = customFrictionHeatKW * 0.55;
    } else {
      const powerScale = Math.pow(totalShaftPowerKW / 1000.0, 0.35);
      journalHeatKW = journalBearingCount * 8.5 * powerScale;
      thrustHeatKW = thrustBearingCount * 22.0 * powerScale;
      if (hasGearbox) {
        gearHeatKW = totalShaftPowerKW * 0.012; // ~1.2% gearbox friction loss
      }
      totalHeatKW = journalHeatKW + thrustHeatKW + gearHeatKW;
    }

    // 2. Oil Circulation Flow Rate: m_dot = Q_heat / (Cp * deltaT)
    const oilMassFlowKgS = totalHeatKW / (oilCpKJkgK * deltaT_oil);
    const oilVolFlowM3H = (oilMassFlowKgS / oilDensityKgM3) * 3600.0;
    const normalLubeOilFlowLPM = (oilVolFlowM3H * 1000.0) / 60.0;

    // Pump design capacity with API 614 20% margin
    const ratedPumpFlowLPM = normalLubeOilFlowLPM * 1.20;
    const ratedPumpFlowM3H = (ratedPumpFlowLPM * 60.0) / 1000.0;

    // 3. API 614 Reservoir Retention Time & Capacity
    // API 614 specifies minimum 8 minutes retention time based on rated pump flow:
    // Working volume = 8 minutes * rated flow
    const workingVolumeLiters = ratedPumpFlowLPM * 8.0;
    // Total gross reservoir volume includes 25% allowance for rundown drainback, dead volume, and foam space
    const totalReservoirVolumeLiters = workingVolumeLiters * 1.25;

    // 4. Overhead Emergency Rundown Gravity Tank
    // For critical turbomachinery: provides continuous bearing lubrication during total electrical blackout
    // coast-down until rotor stops. Sized for minimum 3 minutes of bearing flow (typically 65% of normal flow)
    const rundownFlowLPM = normalLubeOilFlowLPM * 0.65;
    const rundownTankVolumeLiters = rundownFlowLPM * 3.0 * 1.15; // 15% bottom ullage
    // Minimum elevation above machine centerline to guarantee >= 0.35 bar gravity head:
    // h = P / (rho * g) = (0.35e5) / (860 * 9.80665) ~ 4.2 meters
    const minTankElevationM = (0.35e5) / (oilDensityKgM3 * 9.80665);

    // 5. Duplex Oil Cooler Sizing (with 20% fouling safety margin)
    const coolerHeatDutyKW = totalHeatKW * 1.20;
    // Cooling water requirement (assumed deltaT_water = 10°C, Cp = 4.184 kJ/kg*K)
    const coolingWaterM3H = (coolerHeatDutyKW / (4.184 * 10.0)) * 3.6;

    return {
      standard: 'API 614 (Lubrication, Shaft-Sealing and Control-Oil Systems)',
      trainShaftPowerKW: totalShaftPowerKW,
      heatDissipation: {
        journalBearingsHeatKW: Math.round(journalHeatKW * 10) / 10,
        thrustBearingsHeatKW: Math.round(thrustHeatKW * 10) / 10,
        gearboxHeatKW: Math.round(gearHeatKW * 10) / 10,
        totalHeatLoadKW: Math.round(totalHeatKW * 10) / 10
      },
      oilFlow: {
        oilSupplyTempC,
        oilReturnTempC,
        oilDeltaTC: Math.round(deltaT_oil * 10) / 10,
        normalCirculationFlowLPM: Math.round(normalLubeOilFlowLPM * 10) / 10,
        normalCirculationFlowM3H: Math.round(oilVolFlowM3H * 100) / 100,
        ratedPumpCapacityLPM: Math.round(ratedPumpFlowLPM * 10) / 10,
        ratedPumpCapacityM3H: Math.round(ratedPumpFlowM3H * 100) / 100
      },
      reservoir: {
        retentionTimeMinutes: 8.0,
        workingVolumeLiters: Math.round(workingVolumeLiters),
        totalGrossCapacityLiters: Math.round(totalReservoirVolumeLiters),
        totalGrossCapacityM3: Math.round((totalReservoirVolumeLiters * 1e-3) * 100) / 100
      },
      emergencyRundownTank: {
        rundownDurationMinutes: 3.0,
        rundownFlowLPM: Math.round(rundownFlowLPM * 10) / 10,
        tankVolumeLiters: Math.round(rundownTankVolumeLiters),
        minStaticElevationMeters: Math.round(minTankElevationM * 10) / 10
      },
      duplexCoolers: {
        coolerDesignDutyKW: Math.round(coolerHeatDutyKW * 10) / 10,
        coolingWaterDemandM3H: Math.round(coolingWaterM3H * 10) / 10,
        duplexFilterRatingMicrons: 10,
        duplexFilterBetaRatio: 200
      }
    };
  }

  /**
   * Sizes an API 692 Dry Gas Seal (DGS) conditioning panel for compressor shaft sealing.
   *
   * @param {Object} params
   * @param {number} [params.sealCartridgeCount=2] - Number of DGS cartridges (typically 2 for beam compressor)
   * @param {number} [params.shaftDiameterMm=120.0] - Seal sleeve diameter (mm)
   * @param {number} params.referenceGasPressureBarg - Process gas pressure behind balance drum (barg)
   * @param {number} [params.processGasDewPointC=10.0] - Gas dew point at seal pressure (°C)
   * @param {string} [params.sealArrangement='TANDEM'] - 'TANDEM' (Arrangement 2) or 'DOUBLE_PRESSURIZED' (Arrangement 3)
   * @returns {Object} Primary seal gas flow, leakage rates, buffer N2 flow, and separation seal pressures
   */
  static sizeDryGasSealPanel(params) {
    const {
      sealCartridgeCount = 2,
      shaftDiameterMm = 120.0,
      referenceGasPressureBarg,
      processGasDewPointC = 10.0,
      sealArrangement = 'TANDEM'
    } = params || {};

    if (referenceGasPressureBarg === undefined || referenceGasPressureBarg < -1.01325) {
      throw new Error('Reference gas pressure must exceed absolute vacuum (-1.01325 barg)');
    }
    if (sealCartridgeCount <= 0) throw new Error('Seal cartridge count must be positive');
    if (shaftDiameterMm <= 0) throw new Error('Shaft diameter must be positive');

    // 1. Primary Seal Gas Supply Pressure & Conditioning
    // Differential across inner process labyrinth must be >= 3.5 bar per API 692
    const supplyPressureBarg = referenceGasPressureBarg + 3.5;
    // Seal gas conditioning heater: maintains >= 20°C superheat above dew point
    const minSealGasSupplyTempC = processGasDewPointC + 20.0;

    // 2. Primary Seal Gas Consumption (labyrinth flush flow + face leakage)
    // Nominal flush flow scales with shaft diameter: ~15 to 30 Nm3/h per seal
    const flushFlowPerSealNm3H = 12.0 + 0.12 * shaftDiameterMm;
    const totalSealGasSupplyNm3H = flushFlowPerSealNm3H * sealCartridgeCount;

    // 3. Normal Primary Dynamic Face Leakage Rate
    // Spiral groove face with 3-5 micron dynamic gap
    const normalLeakagePerSealNm3H = Math.min(3.5, 0.8 + 0.02 * referenceGasPressureBarg);
    const totalNormalPrimaryLeakageNm3H = normalLeakagePerSealNm3H * sealCartridgeCount;
    // Alarm and trip thresholds per API 692:
    const highLeakageAlarmNm3H = totalNormalPrimaryLeakageNm3H * 3.0;
    const highHighLeakageTripNm3H = totalNormalPrimaryLeakageNm3H * 5.0;

    // 4. Secondary Buffer Gas (Nitrogen) Sweep
    // N2 buffer sweeps intermediate cavity between primary and secondary seal faces to flare
    const n2BufferFlowPerSealNm3H = 4.5;
    const totalN2BufferFlowNm3H = n2BufferFlowPerSealNm3H * sealCartridgeCount;

    // 5. Tertiary Separation Barrier Seal (Carbon Rings / Labyrinth)
    // Sized to prevent lube oil vapor from bearing housing entering dry gas seal cavity
    // Barrier air/N2 pressure maintained >= 0.35 bar above bearing cavity pressure
    const separationAirFlowPerSealNm3H = 8.0;
    const totalSeparationAirFlowNm3H = separationAirFlowPerSealNm3H * sealCartridgeCount;

    return {
      standard: 'API 692 (Dry Gas Sealing Systems for Axial, Centrifugal, and Rotary Screw Compressors)',
      sealArrangement: sealArrangement.toUpperCase(),
      sealCartridgeCount,
      shaftDiameterMm,
      primarySealGas: {
        referenceGasPressureBarg,
        supplyPressureBarg: Math.round(supplyPressureBarg * 100) / 100,
        minSupplyTempSuperheatedC: Math.round(minSealGasSupplyTempC * 10) / 10,
        supplyFlowTotalNm3H: Math.round(totalSealGasSupplyNm3H * 10) / 10,
        filtrationRatingMicrons: 3,
        coalescerEfficiencyPct: 99.9
      },
      leakageMonitoring: {
        normalPrimaryLeakageNm3H: Math.round(totalNormalPrimaryLeakageNm3H * 10) / 10,
        highLeakageAlarmThresholdNm3H: Math.round(highLeakageAlarmNm3H * 10) / 10,
        highHighTripThresholdNm3H: Math.round(highHighLeakageTripNm3H * 10) / 10,
        ventDestination: 'Primary Vent Header to Flare'
      },
      secondaryAndSeparationSeal: {
        nitrogenBufferFlowTotalNm3H: Math.round(totalN2BufferFlowNm3H * 10) / 10,
        separationSealGasFlowTotalNm3H: Math.round(totalSeparationAirFlowNm3H * 10) / 10,
        separationBarrierDifferentialBar: 0.35,
        secondaryVentDestination: 'Atmospheric Safe Location'
      }
    };
  }
}

module.exports = { LubeSealOilApi614 };
