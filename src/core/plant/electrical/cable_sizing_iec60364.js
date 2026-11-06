/**
 * Industrial Cable Sizing Engine per IEC 60364-5-52 & IEC 60502.
 *
 * Implements:
 * 1. Continuous current carrying capacity (ampacity) with multiple derating factors:
 *    - Ambient temperature correction (k1)
 *    - Soil thermal resistivity correction (k2)
 *    - Grouping / bunching derating (k3)
 *    - Burial depth factor (k4)
 *    Iz = I0 * k1 * k2 * k3 * k4 * n_parallel >= Ib
 * 2. Steady-state operating voltage drop (Delta U %):
 *    Delta U = sqrt(3) * Ib * L * (R*cos(phi) + X*sin(phi)) / 1000
 * 3. Motor starting transient voltage drop check (<= 15% during direct online start).
 * 4. Adiabatic short-circuit thermal withstand:
 *    S >= (Isc * sqrt(t)) / k
 */

'use strict';

// Standard metric copper conductor cross-sections (mm2) and parameters
// Resistance R (ohm/km at 90C for XLPE / 70C for PVC), Reactance X (ohm/km), Base Ampacity I0 (A in air at 30C, Method E/F)
const COPPER_CABLE_SPECS = [
  { sizeMm2: 1.5, rAc90: 15.4, rAc70: 14.5, x: 0.115, iAirXlpe: 23, iGroundXlpe: 29 },
  { sizeMm2: 2.5, rAc90: 9.45, rAc70: 8.87, x: 0.106, iAirXlpe: 31, iGroundXlpe: 39 },
  { sizeMm2: 4.0, rAc90: 5.88, rAc70: 5.52, x: 0.100, iAirXlpe: 42, iGroundXlpe: 52 },
  { sizeMm2: 6.0, rAc90: 3.93, rAc70: 3.69, x: 0.095, iAirXlpe: 54, iGroundXlpe: 66 },
  { sizeMm2: 10, rAc90: 2.33, rAc70: 2.19, x: 0.090, iAirXlpe: 75, iGroundXlpe: 90 },
  { sizeMm2: 16, rAc90: 1.47, rAc70: 1.38, x: 0.086, iAirXlpe: 100, iGroundXlpe: 115 },
  { sizeMm2: 25, rAc90: 0.927, rAc70: 0.870, x: 0.083, iAirXlpe: 135, iGroundXlpe: 150 },
  { sizeMm2: 35, rAc90: 0.669, rAc70: 0.627, x: 0.081, iAirXlpe: 169, iGroundXlpe: 180 },
  { sizeMm2: 50, rAc90: 0.494, rAc70: 0.463, x: 0.080, iAirXlpe: 207, iGroundXlpe: 215 },
  { sizeMm2: 70, rAc90: 0.342, rAc70: 0.321, x: 0.078, iAirXlpe: 268, iGroundXlpe: 265 },
  { sizeMm2: 95, rAc90: 0.247, rAc70: 0.232, x: 0.076, iAirXlpe: 328, iGroundXlpe: 315 },
  { sizeMm2: 120, rAc90: 0.196, rAc70: 0.184, x: 0.075, iAirXlpe: 383, iGroundXlpe: 360 },
  { sizeMm2: 150, rAc90: 0.159, rAc70: 0.149, x: 0.075, iAirXlpe: 444, iGroundXlpe: 405 },
  { sizeMm2: 185, rAc90: 0.128, rAc70: 0.120, x: 0.074, iAirXlpe: 510, iGroundXlpe: 460 },
  { sizeMm2: 240, rAc90: 0.098, rAc70: 0.092, x: 0.073, iAirXlpe: 607, iGroundXlpe: 530 },
  { sizeMm2: 300, rAc90: 0.080, rAc70: 0.075, x: 0.072, iAirXlpe: 703, iGroundXlpe: 590 },
  { sizeMm2: 400, rAc90: 0.063, rAc70: 0.059, x: 0.071, iAirXlpe: 823, iGroundXlpe: 660 },
  { sizeMm2: 500, rAc90: 0.050, rAc70: 0.047, x: 0.070, iAirXlpe: 946, iGroundXlpe: 730 },
  { sizeMm2: 630, rAc90: 0.040, rAc70: 0.038, x: 0.069, iAirXlpe: 1088, iGroundXlpe: 810 }
];

class CableSizingIec60364 {
  /**
   * Temperature derating factor k1 per IEC 60364-5-52 Table B.52.14 / B.52.15.
   */
  static getTemperatureFactor(ambientTempC, insulation = 'XLPE', inGround = false) {
    const ins = (insulation || 'XLPE').toUpperCase();
    if (inGround) {
      // Base reference 20C in ground
      if (ins === 'XLPE') {
        return Math.sqrt(Math.max(0, (90 - ambientTempC) / (90 - 20)));
      }
      return Math.sqrt(Math.max(0, (70 - ambientTempC) / (70 - 20)));
    }
    // Base reference 30C in air
    if (ins === 'XLPE') {
      return Math.sqrt(Math.max(0, (90 - ambientTempC) / (90 - 30)));
    }
    return Math.sqrt(Math.max(0, (70 - ambientTempC) / (70 - 30)));
  }

  /**
   * Soil thermal resistivity factor k2 per IEC 60364-5-52 Table B.52.16.
   * Reference = 2.5 K*m/W.
   */
  static getSoilResistivityFactor(soilResistivityKmW) {
    if (!soilResistivityKmW || soilResistivityKmW <= 0) return 1.0;
    if (soilResistivityKmW <= 1.0) return 1.18;
    if (soilResistivityKmW <= 1.5) return 1.10;
    if (soilResistivityKmW <= 2.0) return 1.05;
    if (soilResistivityKmW <= 2.5) return 1.00;
    if (soilResistivityKmW <= 3.0) return 0.96;
    return 0.90;
  }

  /**
   * Grouping factor k3 per IEC 60364-5-52 Table B.52.17.
   */
  static getGroupingFactor(numberOfCircuits, installationMethod = 'cable_ladder') {
    const n = Math.max(1, Math.min(numberOfCircuits, 20));
    if (n === 1) return 1.0;
    if (installationMethod === 'underground_direct' || installationMethod === 'underground_duct') {
      const factors = [1.0, 0.85, 0.75, 0.70, 0.65, 0.60];
      return factors[Math.min(n - 1, factors.length - 1)];
    }
    // Tray / ladder in air
    const airFactors = [1.0, 0.88, 0.82, 0.77, 0.75, 0.72, 0.70, 0.68, 0.66];
    return airFactors[Math.min(n - 1, airFactors.length - 1)];
  }

  /**
   * Burial depth factor k4.
   */
  static getDepthFactor(depthM, inGround = false) {
    if (!inGround) return 1.0;
    if (depthM <= 0.7) return 1.0;
    if (depthM <= 1.0) return 0.98;
    if (depthM <= 1.2) return 0.96;
    return 0.93;
  }

  /**
   * Adiabatic short circuit withstand factor k.
   */
  static getAdiabaticK(conductor = 'Cu', insulation = 'XLPE') {
    const cond = (conductor || 'Cu').toUpperCase();
    const ins = (insulation || 'XLPE').toUpperCase();
    if (cond === 'CU') {
      return ins === 'XLPE' ? 143 : 115;
    }
    return ins === 'XLPE' ? 94 : 76; // Aluminum
  }

  /**
   * Complete IEC 60364 / IEC 60502 cable sizing calculation.
   *
   * @param {Object} params
   * @param {number} params.designCurrentAmps - Continuous operating load current Ib (A)
   * @param {number} params.nominalVoltageV - System line-to-line voltage Un (V)
   * @param {number} params.routeLengthM - One-way cable route distance (m)
   * @param {number} [params.phase=3] - System phases (3 or 1)
   * @param {string} [params.conductor='Cu'] - 'Cu' or 'Al'
   * @param {number} [params.powerFactor=0.85] - Operating power factor
   * @param {string} [params.insulation='XLPE'] - 'XLPE' (90C) or 'PVC' (70C)
   * @param {string} [params.installationMethod='cable_ladder'] - 'cable_ladder', 'tray_perforated', 'underground_direct', 'underground_duct'
   * @param {number} [params.ambientTempC=40] - Ambient air or ground temperature (C)
   * @param {number} [params.soilThermalResistivityKmW=2.5] - Soil thermal resistivity (K*m/W)
   * @param {number} [params.numberOfCircuitsGrouped=3] - Grouped parallel circuits
   * @param {number} [params.burialDepthM=1.0] - Depth if buried (m)
   * @param {number} [params.maxVoltageDropPct=5.0] - Permissible steady-state voltage drop %
   * @param {number} [params.shortCircuitCurrentKA=25.0] - Prospective fault current (kA)
   * @param {number} [params.faultClearingTimeSec=0.20] - Fault clearing time (seconds)
   * @param {boolean} [params.isMotorLoad=false] - True if circuit supplies a motor
   * @param {number} [params.motorStartingCurrentRatio=6.0] - Starting current ratio (Istart / In)
   * @param {number} [params.maxStartingVoltageDropPct=15.0] - Maximum allowed motor start dip %
   * @returns {Object} Comprehensive cable sizing and engineering verdict
   */
  static sizeCable(params) {
    const {
      designCurrentAmps,
      nominalVoltageV,
      routeLengthM,
      phase = 3,
      conductor = 'Cu',
      powerFactor = 0.85,
      insulation = 'XLPE',
      installationMethod = 'cable_ladder',
      ambientTempC = 40,
      soilThermalResistivityKmW = 2.5,
      numberOfCircuitsGrouped = 3,
      burialDepthM = 1.0,
      maxVoltageDropPct = 5.0,
      shortCircuitCurrentKA = 25.0,
      faultClearingTimeSec = 0.20,
      isMotorLoad = false,
      motorStartingCurrentRatio = 6.0,
      maxStartingVoltageDropPct = 15.0
    } = params;

    if (!designCurrentAmps || designCurrentAmps <= 0) {
      throw new Error('Design current must be greater than zero');
    }

    const condNorm = (conductor || 'Cu').toUpperCase();
    const insNorm = (insulation || 'XLPE').toUpperCase();
    const isAluminum = condNorm === 'AL';

    const inGround = installationMethod.startsWith('underground');
    const k1 = this.getTemperatureFactor(ambientTempC, insNorm, inGround);
    const k2 = inGround ? this.getSoilResistivityFactor(soilThermalResistivityKmW) : 1.0;
    const k3 = this.getGroupingFactor(numberOfCircuitsGrouped, installationMethod);
    const k4 = this.getDepthFactor(burialDepthM, inGround);
    const totalDerating = k1 * k2 * k3 * k4;

    const k_adiabatic = this.getAdiabaticK(condNorm, insNorm);
    const minShortCircuitAreaMm2 = (shortCircuitCurrentKA * 1000.0 * Math.sqrt(faultClearingTimeSec)) / k_adiabatic;

    const sinPhi = Math.sqrt(Math.max(0, 1.0 - powerFactor * powerFactor));
    const startPF = 0.25;
    const sinPhiStart = Math.sqrt(1.0 - startPF * startPF);

    // Voltage drop coefficient: 2.0 for single-phase, sqrt(3) for three-phase
    const vDropCoeff = phase === 1 ? 2.0 : Math.sqrt(3);

    let selectedOption = null;

    // Search through candidate conductor cross sections and parallel runs (1 to 4 runs)
    for (let runs = 1; runs <= 4; runs += 1) {
      for (const spec of COPPER_CABLE_SPECS) {
        // Base ampacity per run (Aluminum cables carry ~ 78% ampacity of Cu)
        const i0_base = inGround ? spec.iGroundXlpe : spec.iAirXlpe;
        const i0 = isAluminum ? i0_base * 0.78 : i0_base;
        const izPerRun = i0 * totalDerating;
        const izTotal = izPerRun * runs;

        // Condition 1: Ampacity withstand
        if (izTotal < designCurrentAmps) continue;

        // Condition 2: Adiabatic short-circuit withstand per cable conductor
        const totalAreaMm2 = spec.sizeMm2 * runs;
        if (totalAreaMm2 < minShortCircuitAreaMm2) continue;

        // Condition 3: Steady-state voltage drop
        // Aluminum AC resistance is ~ 1.61x that of Copper
        const rBase = (insNorm === 'XLPE' ? spec.rAc90 : spec.rAc70);
        const rConductor = isAluminum ? rBase * 1.61 : rBase;
        const rEffective = rConductor / runs;
        const xEffective = spec.x / runs;

        // Delta U in Volts
        const deltaUVolts = vDropCoeff * designCurrentAmps * (routeLengthM / 1000.0) * (rEffective * powerFactor + xEffective * sinPhi);
        const deltaUPct = (deltaUVolts / nominalVoltageV) * 100.0;

        if (deltaUPct > maxVoltageDropPct) continue;

        // Condition 4: Motor starting transient voltage drop check
        let startDipPct = 0;
        let startDipPassed = true;
        if (isMotorLoad) {
          const startingAmps = designCurrentAmps * motorStartingCurrentRatio;
          const deltaUStartVolts = vDropCoeff * startingAmps * (routeLengthM / 1000.0) * (rEffective * startPF + xEffective * sinPhiStart);
          startDipPct = (deltaUStartVolts / nominalVoltageV) * 100.0;
          if (startDipPct > maxStartingVoltageDropPct) {
            startDipPassed = false;
            continue;
          }
        }

        const conductorLabel = isAluminum ? 'Al' : 'Cu';
        const cableDesignation = phase === 1
          ? `${runs} x (2C x ${spec.sizeMm2} mm² ${conductorLabel}/${insNorm})`
          : `${runs} x (3C x ${spec.sizeMm2} mm² ${conductorLabel}/${insNorm})`;

        selectedOption = {
          sizeMm2: spec.sizeMm2,
          runs,
          conductor: conductorLabel,
          phase,
          cableDesignation,
          baseAmpacityPerRunA: Math.round(i0 * 10) / 10,
          deratedAmpacityTotalA: Math.round(izTotal * 10) / 10,
          operatingCurrentIbA: Math.round(designCurrentAmps * 10) / 10,
          ampacityMarginPct: Math.round(((izTotal - designCurrentAmps) / designCurrentAmps) * 1000) / 10,
          voltageDropVolts: Math.round(deltaUVolts * 100) / 100,
          voltageDropPercent: Math.round(deltaUPct * 100) / 100,
          voltageDropAllowablePercent: maxVoltageDropPct,
          isMotorLoad: Boolean(isMotorLoad),
          motorStartingDipPercent: Math.round(startDipPct * 100) / 100,
          motorStartingDipAllowablePercent: maxStartingVoltageDropPct,
          motorStartingCheckPassed: startDipPassed,
          minShortCircuitAreaRequiredMm2: Math.round(minShortCircuitAreaMm2 * 10) / 10,
          actualCrossSectionMm2: totalAreaMm2,
          deratingFactors: {
            temperatureK1: Math.round(k1 * 1000) / 1000,
            soilResistivityK2: Math.round(k2 * 1000) / 1000,
            groupingK3: Math.round(k3 * 1000) / 1000,
            depthK4: Math.round(k4 * 1000) / 1000,
            totalDeratingFactor: Math.round(totalDerating * 1000) / 1000
          },
          resistanceOhmKm: Math.round(rEffective * 1000) / 1000,
          reactanceOhmKm: Math.round(xEffective * 1000) / 1000,
          status: 'Adequate for specified operational and fault conditions'
        };
        break;
      }
      if (selectedOption) break;
    }

    if (!selectedOption) {
      throw new Error(`Unable to size cable within 4 parallel runs of 630 mm² for Ib=${designCurrentAmps}A, L=${routeLengthM}m, Isc=${shortCircuitCurrentKA}kA`);
    }

    return selectedOption;
  }
}

module.exports = {
  CableSizingIec60364,
  COPPER_CABLE_SPECS
};
