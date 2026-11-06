/**
 * Thermal Insulation Sizing & Heat Tracing Engine.
 * Evaluates pipe heat loss/gain per ASTM C680 / ISO 12241, cryogenic condensation prevention,
 * and electric / steam heat tracing per IEEE 515.
 *
 * Implements:
 * 1. ASTM C680 / ISO 12241 Cylindrical Multi-Layer Heat Transfer:
 *    - Radial thermal conduction resistance R_cond.
 *    - Natural and forced wind convection (Langmuir / Churchill-Chu).
 *    - Stefan-Boltzmann surface radiation with jacket emissivity.
 *    - Iterative outer surface temperature T_s solution.
 * 2. Cold Cryogenic LNG Insulation Thickness for Condensation Control (Sweat Prevention):
 *    - Psychrometric dew point temperature calculation (Magnus formula).
 *    - Minimum thickness ensuring T_surface >= T_dewpoint + T_margin on -162 °C LNG lines.
 *    - Multi-layer staggered joint configuration (Cellular Glass, PIR, Aerogel).
 *    - Heat ingress [W/m] and Boil-Off Gas (BOG) rate estimation [kg/hr/m].
 * 3. Electric Heat Tracing (EHT) per IEEE 515:
 *    - Required trace power P_req with 20% safety factor.
 *    - Cable rating selection, spiraling ratio, and heat sink allowances (flanges, valves).
 * 4. Steam Tracing Circuit Sizing:
 *    - Saturated steam temperature, number of tracers, and maximum circuit length.
 */

'use strict';

// claims:evidence:ASTM-C680-ISO-12241-IEEE-515

const STEFAN_BOLTZMANN = 5.670374e-8; // W / (m^2 * K^4)

/**
 * Standard insulation materials and nominal thermal conductivities k [W/(m*K)]
 */
const INSULATION_MATERIALS = {
  'CELLULAR_GLASS': {
    name: 'Cellular Glass (Foamglas T4+)',
    service: 'Cryogenic to Medium Temp (-260 to 430 °C)',
    densityKgM3: 115.0,
    kMean: 0.040, // at 0 °C
    calcK: (tC) => 0.038 + 0.00014 * tC
  },
  'PIR': {
    name: 'Polyisocyanurate (PIR)',
    service: 'Cryogenic to Moderate Temp (-180 to 140 °C)',
    densityKgM3: 40.0,
    kMean: 0.024,
    calcK: (tC) => 0.022 + 0.00010 * tC
  },
  'AEROGEL_BLANKET': {
    name: 'Silica Aerogel Cryogenic Blanket (Pyrogel / Cryogel)',
    service: 'Extreme Cryogenic (-200 to 200 °C)',
    densityKgM3: 160.0,
    kMean: 0.015,
    calcK: (tC) => 0.014 + 0.00008 * tC
  },
  'MINERAL_WOOL': {
    name: 'Rock Mineral Wool (High Temperature)',
    service: 'Thermal Conservation / Steam (Ambient to 650 °C)',
    densityKgM3: 100.0,
    kMean: 0.038,
    calcK: (tC) => 0.034 + 0.00015 * tC
  },
  'CALCIUM_SILICATE': {
    name: 'Calcium Silicate',
    service: 'High Temperature Process (Ambient to 650 °C)',
    densityKgM3: 240.0,
    kMean: 0.060,
    calcK: (tC) => 0.055 + 0.00018 * tC
  }
};

/**
 * Standard cladding / jacket surface emissivity values
 */
const CLADDING_EMISSIVITY = {
  'SHINY_ALUMINUM': 0.05,
  'OXIDIZED_ALUMINUM': 0.12,
  'STAINLESS_STEEL': 0.15,
  'ALUMINIZED_STEEL': 0.20,
  'NONMETALLIC_MASTIC': 0.85,
  'PAINTED_SURFACE': 0.90
};

class InsulationHeatTracing {
  /**
   * Psychrometric dew point calculation using the Magnus-Tetens formula.
   *
   * @param {number} ambientTempC - Ambient dry-bulb temperature in °C
   * @param {number} relativeHumidityPercent - Relative humidity (0 to 100%)
   * @returns {number} Dew point temperature in °C
   */
  static calculateDewPoint(ambientTempC, relativeHumidityPercent) {
    const rh = Math.min(100.0, Math.max(1.0, relativeHumidityPercent));
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * ambientTempC) / (b + ambientTempC)) + Math.log(rh / 100.0);
    const dewPoint = (b * alpha) / (a - alpha);
    return Number(dewPoint.toFixed(2));
  }

  /**
   * Calculate steady-state heat loss or heat gain per ASTM C680 / ISO 12241.
   *
   * @param {Object} params
   * @param {number} params.pipeOutsideDiameterMm - Outer diameter of bare pipe (mm)
   * @param {number} params.operatingTempC - Fluid operating temperature in °C
   * @param {number} params.ambientTempC - Ambient air temperature in °C
   * @param {number} params.insulationThicknessMm - Radial thickness of insulation (mm)
   * @param {string} [params.insulationType='MINERAL_WOOL'] - Material key from INSULATION_MATERIALS
   * @param {number} [params.windSpeedMS=2.0] - Wind velocity (m/s)
   * @param {string} [params.claddingType='OXIDIZED_ALUMINUM'] - Jacketing type
   * @returns {Object} Heat flux (W/m, W/m2), surface temperature, and thermal resistances
   */
  static calculateHeatTransferAstmC680(params) {
    const {
      pipeOutsideDiameterMm,
      operatingTempC,
      ambientTempC,
      insulationThicknessMm,
      insulationType = 'MINERAL_WOOL',
      windSpeedMS = 2.0,
      claddingType = 'OXIDIZED_ALUMINUM'
    } = params;

    const rPipeOuterM = (pipeOutsideDiameterMm / 2.0) / 1000.0;
    const rInsOuterM = rPipeOuterM + (insulationThicknessMm / 1000.0);
    const dOuterM = 2.0 * rInsOuterM;

    const mat = INSULATION_MATERIALS[insulationType] || INSULATION_MATERIALS['MINERAL_WOOL'];
    const emissivity = CLADDING_EMISSIVITY[claddingType] !== undefined
      ? CLADDING_EMISSIVITY[claddingType]
      : 0.12;

    // Iterative solution for outer surface temperature T_s
    let tSurfaceC = (operatingTempC + ambientTempC) / 2.0;
    const maxIter = 50;
    const tol = 1e-4;

    let qFluxWM = 0.0;
    let rCond = 0.0;
    let hTotal = 10.0;

    for (let iter = 0; iter < maxIter; iter++) {
      const meanTempC = (operatingTempC + tSurfaceC) / 2.0;
      const kIns = mat.calcK(meanTempC);

      // Radial conduction resistance R_cond = ln(r2 / r1) / (2 * pi * k)  [m*K / W]
      rCond = Math.log(rInsOuterM / rPipeOuterM) / (2.0 * Math.PI * kIns);

      // Natural convection coefficient (Churchill-Chu horizontal cylinder)
      const deltaT = Math.abs(tSurfaceC - ambientTempC);
      const hNat = 1.32 * Math.pow(Math.max(0.1, deltaT) / dOuterM, 0.25);

      // Wind forced convection (ASTM C680 empirical vector combination)
      const hForced = (1.0 + 0.22 * windSpeedMS) * (3.8 + 0.005 * Math.abs(ambientTempC));
      const hConv = Math.sqrt(Math.pow(hNat, 2) + Math.pow(hForced, 2));

      // Radiation coefficient h_rad = eps * sigma * (Ts + Tamb) * (Ts^2 + Tamb^2)
      const tSK = tSurfaceC + 273.15;
      const tAmbK = ambientTempC + 273.15;
      const hRad = emissivity * STEFAN_BOLTZMANN * (tSK + tAmbK) * (Math.pow(tSK, 2) + Math.pow(tAmbK, 2));

      hTotal = hConv + hRad;
      const rSurf = 1.0 / (Math.PI * dOuterM * hTotal);

      // Heat flow per meter of pipe [W/m]
      qFluxWM = (operatingTempC - ambientTempC) / (rCond + rSurf);

      // Updated surface temperature from conduction balance
      const newTSurfaceC = operatingTempC - qFluxWM * rCond;

      if (Math.abs(newTSurfaceC - tSurfaceC) < tol) {
        tSurfaceC = newTSurfaceC;
        break;
      }
      tSurfaceC = 0.5 * (tSurfaceC + newTSurfaceC);
    }

    const surfaceAreaM2PerM = Math.PI * dOuterM;
    const qFluxWM2 = qFluxWM / surfaceAreaM2PerM;

    return {
      standard: 'ASTM C680 / ISO 12241',
      insulationMaterial: mat.name,
      claddingType,
      pipeOutsideDiameterMm,
      insulationThicknessMm,
      totalOuterDiameterMm: Number((dOuterM * 1000.0).toFixed(1)),
      operatingTempC,
      ambientTempC,
      surfaceTempC: Number(tSurfaceC.toFixed(2)),
      heatTransferPerMeterWM: Number(qFluxWM.toFixed(2)),
      heatFluxWM2: Number(qFluxWM2.toFixed(2)),
      thermalResistanceCondMKW: Number(rCond.toFixed(3)),
      surfaceCoefficientW_M2K: Number(hTotal.toFixed(2))
    };
  }

  /**
   * Sizing of Cryogenic Cold Insulation for Condensation Control (Sweat Prevention) on LNG lines.
   * Ensures cladding outer surface temperature T_s >= T_dewpoint + T_margin at extreme design ambient conditions.
   *
   * @param {Object} params
   * @param {number} params.pipeOutsideDiameterMm - Nominal bare pipe OD (mm)
   * @param {number} [params.operatingTempC=-162.0] - Cryogenic temperature (°C, LNG = -162 °C)
   * @param {number} [params.ambientTempC=32.0] - Summer peak design ambient (°C)
   * @param {number} [params.relativeHumidityPercent=85.0] - Peak relative humidity (%)
   * @param {number} [params.windSpeedMS=1.0] - Low wind condition for worst-case condensation
   * @param {string} [params.insulationType='PIR'] - 'CELLULAR_GLASS', 'PIR', or 'AEROGEL_BLANKET'
   * @param {number} [params.marginC=1.5] - Temperature safety margin above dew point (°C)
   * @returns {Object} Sized thickness, commercial layered schedule, and LNG boil-off rate
   */
  static sizeCryogenicCondensationControl(params) {
    const {
      pipeOutsideDiameterMm,
      operatingTempC = -162.0,
      ambientTempC = 32.0,
      relativeHumidityPercent = 85.0,
      windSpeedMS = 1.0,
      insulationType = 'PIR',
      marginC = 1.5
    } = params;

    const dewPointC = this.calculateDewPoint(ambientTempC, relativeHumidityPercent);
    const targetSurfaceTempC = dewPointC + marginC;

    // Search minimum insulation thickness starting from 25 mm up to 450 mm in steps of 5 mm
    let selectedThicknessMm = 25;
    let evalResult = null;
    let isCondensationPrevented = false;

    for (let thk = 25; thk <= 450; thk += 5) {
      evalResult = this.calculateHeatTransferAstmC680({
        pipeOutsideDiameterMm,
        operatingTempC,
        ambientTempC,
        insulationThicknessMm: thk,
        insulationType,
        windSpeedMS,
        claddingType: 'OXIDIZED_ALUMINUM'
      });

      if (evalResult.surfaceTempC >= targetSurfaceTempC) {
        selectedThicknessMm = thk;
        isCondensationPrevented = true;
        break;
      }
    }

    if (!isCondensationPrevented) {
      selectedThicknessMm = 450;
    }

    // Determine layered configuration (cryogenic piping requires 2 or 3 layers with staggered joints)
    let numberOfLayers = 1;
    let layerThicknessesMm = [selectedThicknessMm];

    if (selectedThicknessMm > 120) {
      numberOfLayers = 3;
      const thkEach = Math.ceil(selectedThicknessMm / 3.0 / 5.0) * 5;
      layerThicknessesMm = [thkEach, thkEach, selectedThicknessMm - 2 * thkEach];
    } else if (selectedThicknessMm > 50) {
      numberOfLayers = 2;
      const thkInner = Math.ceil(selectedThicknessMm / 2.0 / 5.0) * 5;
      layerThicknessesMm = [thkInner, selectedThicknessMm - thkInner];
    }

    // Cryogenic heat ingress into LNG (positive value for heat gain into pipe)
    const heatGainWM = Math.abs(evalResult.heatTransferPerMeterWM);

    // Latent heat of vaporization for liquid methane / LNG ~ 510 kJ/kg = 510,000 J/kg
    const latentHeatLngJPerKg = 510000.0;
    // BOG rate = (heatGainWM [W/m] * 3600 [s/hr]) / latentHeatLng [J/kg] -> kg/(hr*m)
    const bogRateKgHrPerM = (heatGainWM * 3600.0) / latentHeatLngJPerKg;

    return {
      service: 'LNG Cryogenic Condensation & Heat Gain Control',
      operatingTempC,
      ambientTempC,
      relativeHumidityPercent,
      dewPointTempC: dewPointC,
      targetSurfaceTempC: Number(targetSurfaceTempC.toFixed(2)),
      achievedSurfaceTempC: evalResult.surfaceTempC,
      insulationMaterial: evalResult.insulationMaterial,
      requiredThicknessMm: selectedThicknessMm,
      selectedThicknessMm,
      numberOfLayers,
      layerThicknessesMm,
      heatIngressWM: Number(heatGainWM.toFixed(2)),
      bogRateKgHrM: Number(bogRateKgHrPerM.toFixed(4)),
      isCondensationPrevented
    };
  }

  /**
   * Sizing of Electric Heat Tracing (EHT) per IEEE 515.
   *
   * @param {Object} params
   * @param {number} params.pipeOutsideDiameterMm
   * @param {number} params.maintainTempC - Temperature to maintain (e.g. 10 °C for freeze protect, 50 °C for fuel gas)
   * @param {number} params.minAmbientTempC - Worst-case winter minimum temperature (e.g. -15 °C)
   * @param {number} params.insulationThicknessMm
   * @param {string} [params.insulationType='MINERAL_WOOL']
   * @param {number} [params.windSpeedMS=12.0] - Winter design wind speed (m/s)
   * @param {number} [params.pipeLengthM=100.0] - Straight pipe length
   * @param {number} [params.valveCount=4] - Number of inline valves (heat sinks)
   * @param {number} [params.flangePairCount=8] - Number of flange pairs
   * @returns {Object} Heat tracing wattage, cable selection, spiraling ratio, and total circuit load
   */
  static sizeElectricHeatTracing(params) {
    const {
      pipeOutsideDiameterMm,
      maintainTempC,
      minAmbientTempC,
      insulationThicknessMm,
      insulationType = 'MINERAL_WOOL',
      windSpeedMS = 12.0,
      pipeLengthM = 100.0,
      valveCount = 4,
      flangePairCount = 8
    } = params;

    // 1. Calculate thermal heat loss at maintain temperature per ASTM C680
    const heatLoss = this.calculateHeatTransferAstmC680({
      pipeOutsideDiameterMm,
      operatingTempC: maintainTempC,
      ambientTempC: minAmbientTempC,
      insulationThicknessMm,
      insulationType,
      windSpeedMS,
      claddingType: 'OXIDIZED_ALUMINUM'
    });

    const baseLossWM = Math.abs(heatLoss.heatTransferPerMeterWM);

    // 2. IEEE 515 safety design factor (typically 1.20)
    const safetyFactor = 1.20;
    const requiredTracePowerWM = baseLossWM * safetyFactor;

    // 3. Cable selection from standard catalog ratings (10, 15, 25, 33, 45, 60 W/m at maintain temp)
    const STANDARD_CABLE_RATINGS_WM = [10, 15, 25, 33, 45, 60];
    let selectedCableRatingWM = STANDARD_CABLE_RATINGS_WM[STANDARD_CABLE_RATINGS_WM.length - 1];

    for (const rating of STANDARD_CABLE_RATINGS_WM) {
      if (rating >= requiredTracePowerWM) {
        selectedCableRatingWM = rating;
        break;
      }
    }

    // Spiraling factor if required power exceeds single straight cable rating
    const spiralRatio = Math.max(1.0, requiredTracePowerWM / selectedCableRatingWM);

    // 4. Heat sink allowances per IEEE 515 Table 2:
    // Valve allowance: 2.0 to 3.0 x pipe dia in meters
    const valveAllowanceMPerValve = Math.max(0.5, (pipeOutsideDiameterMm / 1000.0) * 2.5);
    const totalValveAllowanceM = valveCount * valveAllowanceMPerValve;

    // Flange pair allowance: 1.0 x pipe dia in meters
    const flangeAllowanceMPerPair = Math.max(0.3, (pipeOutsideDiameterMm / 1000.0) * 1.5);
    const totalFlangeAllowanceM = flangePairCount * flangeAllowanceMPerPair;

    // Total cable length needed
    const straightCableM = pipeLengthM * spiralRatio;
    const totalCableLengthM = straightCableM + totalValveAllowanceM + totalFlangeAllowanceM;

    // Total electrical power load (kW)
    const totalPowerKw = (totalCableLengthM * selectedCableRatingWM) / 1000.0;

    return {
      standard: 'IEEE 515',
      maintainTempC,
      minAmbientTempC,
      heatLossAtMaintainWM: Number(baseLossWM.toFixed(2)),
      safetyFactor,
      requiredPowerPerMeterWM: Number(requiredTracePowerWM.toFixed(2)),
      selectedCableRatingWM,
      spiralRatio: Number(spiralRatio.toFixed(2)),
      heatSinkAllowancesM: {
        valves: Number(totalValveAllowanceM.toFixed(1)),
        flanges: Number(totalFlangeAllowanceM.toFixed(1))
      },
      pipeLengthM,
      totalCableLengthM: Number(totalCableLengthM.toFixed(1)),
      totalPowerKw: Number(totalPowerKw.toFixed(2))
    };
  }

  /**
   * Sizing of Steam Heat Tracing Systems per industrial plant engineering practices.
   *
   * @param {Object} params
   * @param {number} params.pipeOutsideDiameterMm - Pipe OD in mm
   * @param {number} params.maintainTempC - Target maintain temperature (°C)
   * @param {number} params.minAmbientTempC - Minimum design ambient temperature (°C)
   * @param {number} params.insulationThicknessMm - Insulation thickness (mm)
   * @param {string} [params.insulationType='MINERAL_WOOL'] - Insulation type key
   * @param {number} [params.steamPressureBarg=3.5] - Saturated steam pressure (barg, typical 3.5 barg LP)
   * @param {string} [params.tracerTubingType='0.5_COPPER'] - '0.375_COPPER', '0.5_COPPER', '0.5_SS'
   * @param {number} [params.pipeLengthM=100.0] - Circuit pipe length (m)
   * @param {boolean} [params.hasCompound=false] - Whether heat transfer compound (cement) is applied
   * @returns {Object} Saturated steam condition, tracer count, steam flow rate, and circuit limits
   */
  static sizeSteamHeatTracing(params) {
    const {
      pipeOutsideDiameterMm,
      maintainTempC,
      minAmbientTempC,
      insulationThicknessMm,
      insulationType = 'MINERAL_WOOL',
      steamPressureBarg = 3.5,
      tracerTubingType = '0.5_COPPER',
      pipeLengthM = 100.0,
      hasCompound = false
    } = params;

    // 1. Saturated steam temperature Tsat (°C)
    const steamSatTempC = 100.0 + 26.5 * Math.pow(Math.max(0.1, steamPressureBarg), 0.42);

    if (steamSatTempC <= maintainTempC) {
      throw new Error(`Steam saturation temperature (${steamSatTempC.toFixed(1)} °C) must be greater than maintain temperature (${maintainTempC} °C).`);
    }

    // Latent heat of condensation h_fg ~ 2257 - 2.4 * (Tsat - 100) kJ/kg
    const latentHeatKjKg = Math.max(1800.0, 2257.0 - 2.4 * (steamSatTempC - 100.0));

    // 2. Base heat loss per meter from ASTM C680
    const heatLoss = this.calculateHeatTransferAstmC680({
      pipeOutsideDiameterMm,
      operatingTempC: maintainTempC,
      ambientTempC: minAmbientTempC,
      insulationThicknessMm,
      insulationType,
      windSpeedMS: 12.0,
      claddingType: 'OXIDIZED_ALUMINUM'
    });

    const baseLossWM = Math.abs(heatLoss.heatTransferPerMeterWM);
    const designLossWM = baseLossWM * 1.25; // 25% safety factor for steam tracing

    // 3. Heat delivery per tracer tube [W/m]
    const isHalfInch = (tracerTubingType || '').includes('0.5') ||
                       (tracerTubingType || '').includes('1/2') ||
                       String(params.tracerDiameter || '').includes('1/2') ||
                       String(params.tracerDiameter || '').includes('0.5');
    const tubingOdMm = isHalfInch ? 12.7 : 9.525; // 1/2" (12.7 mm) or 3/8" (9.525 mm)

    const withCompound = Boolean(hasCompound ||
                         params.tracerAttachment === 'HEAT_TRANSFER_COMPOUND' ||
                         params.hasHeatTransferCompound === true);

    let uTracer = isHalfInch ? 0.45 : 0.35;
    if (withCompound) {
      uTracer *= 4.5;
    }

    const deltaT = steamSatTempC - maintainTempC;
    const qPerTracerWM = uTracer * deltaT;

    // Number of tracers required
    const numberOfTracers = Math.max(1, Math.ceil(designLossWM / qPerTracerWM));

    // 4. Steam condensate rate per meter:
    const condensateRateKgHrPerM = (designLossWM * 3600.0) / (latentHeatKjKg * 1000.0);
    const totalSteamConsumptionKgHr = condensateRateKgHrPerM * pipeLengthM;

    // 5. Maximum recommended single circuit length before steam trap
    const maxCircuitLengthM = isHalfInch ? 65.0 : 45.0;
    const circuitsRequired = Math.ceil(pipeLengthM / maxCircuitLengthM);

    return {
      standard: 'Industrial Steam Tracing Practice',
      steamPressureBarg,
      steamSaturationTempC: Number(steamSatTempC.toFixed(1)),
      steamSatTempC: Number(steamSatTempC.toFixed(1)),
      latentHeatKjKg: Number(latentHeatKjKg.toFixed(1)),
      maintainTempC,
      minAmbientTempC,
      heatLossAtMaintainWM: Number(baseLossWM.toFixed(2)),
      designHeatDutyWM: Number(designLossWM.toFixed(2)),
      tracerTubingType: isHalfInch ? '1/2" OD Tubing' : '3/8" OD Tubing',
      tubingOdMm,
      hasHeatTransferCompound: withCompound,
      heatTransferPerTracerWM: Number(qPerTracerWM.toFixed(2)),
      numberOfTracers,
      tracersRequired: numberOfTracers,
      condensateRateKgHrM: Number(condensateRateKgHrPerM.toFixed(4)),
      totalSteamConsumptionKgHr: Number(totalSteamConsumptionKgHr.toFixed(2)),
      steamFlowKgHr: Number(totalSteamConsumptionKgHr.toFixed(2)),
      maxCircuitLengthM,
      circuitsRequired,
      numberOfCircuits: circuitsRequired,
      condensateTrapCount: circuitsRequired
    };
  }
}

module.exports = {
  InsulationHeatTracing,
  INSULATION_MATERIALS,
  CLADDING_EMISSIVITY
};
