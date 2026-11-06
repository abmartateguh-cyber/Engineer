/**
 * Plant Electrical Load List & Power Demand Summary.
 *
 * Implements:
 * 1. Multi-voltage hierarchy: HV 33kV/11kV, MV 6.6kV/3.3kV, LV 400V, Essential/Emergency 400V, UPS 230V.
 * 2. Operating duty classifications: Continuous ('C'), Intermittent ('I'), Standby ('S').
 * 3. Individual load electrical parameters:
 *    - Consumed active power P (kW) = Shaft kW / efficiency (eta)
 *    - Reactive power Q (kVAR) = P * tan(acos(pf))
 *    - Apparent power S (kVA) = sqrt(P^2 + Q^2) = P / pf
 *    - Full load current I (A) = P / (sqrt(3) * V_kV * pf)
 * 4. Demand factors:
 *    - Continuous: default 1.0 (or user-specified operating factor)
 *    - Intermittent: default 0.3 - 0.5
 *    - Standby: 0.0 in normal mode, 1.0 in emergency/changeover
 * 5. Bus-by-bus aggregation, bus diversity factor, and design growth margins (10-20%).
 */

'use strict';

class ElectricalLoadList {
  constructor(plantName = 'World-Scale LNG Complex') {
    this.plantName = plantName;
    this.loads = [];
    this.buses = {
      'HV-33KV': { name: 'Main Power Distribution 33 kV', nominalVoltageKV: 33.0, phase: 3 },
      'HV-11KV': { name: 'Generation & High-Power MV 11 kV', nominalVoltageKV: 11.0, phase: 3 },
      'MV-6.6KV': { name: 'Process Drivers & Large Pumps 6.6 kV', nominalVoltageKV: 6.6, phase: 3 },
      'MV-3.3KV': { name: 'Utility Drivers 3.3 kV', nominalVoltageKV: 3.3, phase: 3 },
      'LV-400V': { name: 'Low Voltage MCC 400 V', nominalVoltageKV: 0.40, phase: 3 },
      'EMERG-400V': { name: 'Emergency Diesel Switchboard 400 V', nominalVoltageKV: 0.40, phase: 3 },
      'UPS-230V': { name: 'Vital Instrumentation & DCS UPS 230 V', nominalVoltageKV: 0.23, phase: 1 }
    };
  }

  /**
   * Adds or registers a custom switchboard or bus.
   *
   * @param {Object} busConfig
   * @param {string} busConfig.key - Bus identifier key (e.g., 'MV-13.8KV')
   * @param {string} [busConfig.name] - Human-readable bus name
   * @param {number} busConfig.nominalVoltageKV - Line-to-line nominal voltage in kV
   * @param {number} [busConfig.phase=3] - Number of phases (1 or 3)
   * @returns {Object} Configured bus metadata
   */
  addBus(busConfig) {
    if (!busConfig || !busConfig.key) {
      throw new Error('Bus key is required');
    }
    const nominalVoltageKV = Number(busConfig.nominalVoltageKV);
    if (!nominalVoltageKV || nominalVoltageKV <= 0) {
      throw new Error('Bus nominalVoltageKV must be positive');
    }
    const phase = busConfig.phase === 1 ? 1 : 3;
    this.buses[busConfig.key] = {
      name: busConfig.name || `Switchgear Bus ${busConfig.key}`,
      nominalVoltageKV,
      phase
    };
    return this.buses[busConfig.key];
  }

  /**
   * Adds an electrical load consumer to the register.
   *
   * @param {Object} load
   * @param {string} load.tag - Unique equipment identifier (e.g., 'P-2101A')
   * @param {string} load.description - Service description
   * @param {string} load.bus - Target bus key ('HV-33KV', 'HV-11KV', 'MV-6.6KV', 'LV-400V', etc.)
   * @param {number} load.shaftPowerKW - Mechanical shaft brake power (kW)
   * @param {number} [load.efficiency=0.94] - Motor / consumer efficiency (0.0 < eta <= 1.0)
   * @param {number} [load.powerFactor=0.85] - Operating power factor cos(phi)
   * @param {string} [load.duty='C'] - 'C' (Continuous), 'I' (Intermittent), 'S' (Standby)
   * @param {number} [load.continuousFactor=1.0] - Operating demand factor for continuous
   * @param {number} [load.intermittentFactor=0.4] - Operating demand factor for intermittent
   * @param {boolean} [load.isEssential=false] - True if backed by EDG / Essential power
   * @returns {Object} Added load record
   */
  addLoad(load) {
    if (!load.tag) throw new Error('Load tag is required');
    if (!load.bus || !this.buses[load.bus]) {
      throw new Error(`Invalid or unconfigured bus key: ${load.bus}`);
    }
    const duty = (load.duty || 'C').toUpperCase();
    if (!['C', 'I', 'S'].includes(duty)) {
      throw new Error(`Invalid duty: ${load.duty}. Must be C, I, or S.`);
    }

    const efficiency = load.efficiency !== undefined ? load.efficiency : 0.94;
    const powerFactor = load.powerFactor !== undefined ? load.powerFactor : 0.85;
    if (efficiency <= 0 || efficiency > 1.0) throw new Error('Efficiency must be between 0 and 1.0');
    if (powerFactor <= 0 || powerFactor > 1.0) throw new Error('Power factor must be between 0 and 1.0');

    const shaftPowerKW = Number(load.shaftPowerKW) || 0;
    const activePowerKW = shaftPowerKW / efficiency;
    const apparentPowerKVA = activePowerKW / powerFactor;
    const sinPhi = Math.sqrt(Math.max(0, 1.0 - powerFactor * powerFactor));
    const reactivePowerKVAR = apparentPowerKVA * sinPhi;

    const busInfo = this.buses[load.bus];
    let fullLoadAmps = 0;
    if (busInfo.phase === 3) {
      fullLoadAmps = apparentPowerKVA / (Math.sqrt(3) * busInfo.nominalVoltageKV);
    } else {
      fullLoadAmps = apparentPowerKVA / busInfo.nominalVoltageKV;
    }

    const item = {
      tag: load.tag,
      description: load.description || '',
      bus: load.bus,
      voltageKV: busInfo.nominalVoltageKV,
      phase: busInfo.phase,
      duty,
      shaftPowerKW: Math.round(shaftPowerKW * 10) / 10,
      efficiency,
      powerFactor,
      activePowerKW: Math.round(activePowerKW * 10) / 10,
      reactivePowerKVAR: Math.round(reactivePowerKVAR * 10) / 10,
      apparentPowerKVA: Math.round(apparentPowerKVA * 10) / 10,
      fullLoadAmps: Math.round(fullLoadAmps * 10) / 10,
      continuousFactor: load.continuousFactor !== undefined ? load.continuousFactor : 1.0,
      intermittentFactor: load.intermittentFactor !== undefined ? load.intermittentFactor : 0.4,
      isEssential: Boolean(load.isEssential)
    };

    this.loads.push(item);
    return item;
  }

  /**
   * Evaluates demand power for a given operating case.
   *
   * @param {Object} [options]
   * @param {string} [options.operatingCase='normal'] - 'normal', 'peak', 'emergency'
   * @param {number} [options.diversityFactor=0.90] - General plant diversity factor
   * @param {number} [options.designMarginPct=15.0] - Recommended engineering margin %
   * @returns {Object} Comprehensive plant electrical load analysis
   */
  evaluatePlantDemand(options = {}) {
    const {
      operatingCase = 'normal',
      diversityFactor = 0.90,
      designMarginPct = 15.0
    } = options;

    const busResults = {};
    for (const [busKey, busMeta] of Object.entries(this.buses)) {
      busResults[busKey] = {
        busKey,
        name: busMeta.name,
        nominalVoltageKV: busMeta.nominalVoltageKV,
        phase: busMeta.phase,
        connectedLoadsCount: 0,
        connectedActiveKW: 0,
        connectedReactiveKVAR: 0,
        connectedApparentKVA: 0,
        operatingActiveKW: 0,
        operatingReactiveKVAR: 0,
        operatingApparentKVA: 0,
        operatingPowerFactor: 0.85,
        operatingCurrentAmps: 0
      };
    }

    let plantConnectedActiveKW = 0;
    let plantConnectedReactiveKVAR = 0;

    let plantOperatingActiveKW = 0;
    let plantOperatingReactiveKVAR = 0;

    for (const load of this.loads) {
      const b = busResults[load.bus];
      b.connectedLoadsCount += 1;
      b.connectedActiveKW += load.activePowerKW;
      b.connectedReactiveKVAR += load.reactivePowerKVAR;
      plantConnectedActiveKW += load.activePowerKW;
      plantConnectedReactiveKVAR += load.reactivePowerKVAR;

      // Determine operating weight based on case and duty
      let weight = 0;
      if (operatingCase === 'normal') {
        if (load.duty === 'C') weight = load.continuousFactor;
        else if (load.duty === 'I') weight = load.intermittentFactor;
        else if (load.duty === 'S') weight = 0.0; // Standby idle
      } else if (operatingCase === 'peak') {
        if (load.duty === 'C') weight = 1.0;
        else if (load.duty === 'I') weight = Math.min(1.0, load.intermittentFactor * 1.5);
        else if (load.duty === 'S') weight = 0.1; // Space heaters / preheat
      } else if (operatingCase === 'emergency') {
        if (load.isEssential) {
          weight = load.duty === 'S' ? 1.0 : load.continuousFactor;
        } else {
          weight = 0.0; // Shed non-essential loads
        }
      }

      const opKW = load.activePowerKW * weight;
      const opKVAR = load.reactivePowerKVAR * weight;

      b.operatingActiveKW += opKW;
      b.operatingReactiveKVAR += opKVAR;
      plantOperatingActiveKW += opKW;
      plantOperatingReactiveKVAR += opKVAR;
    }

    // Apply bus diversity factor & compute S and current
    for (const b of Object.values(busResults)) {
      b.connectedApparentKVA = Math.sqrt(
        b.connectedActiveKW * b.connectedActiveKW +
        b.connectedReactiveKVAR * b.connectedReactiveKVAR
      );
      b.operatingActiveKW = b.operatingActiveKW * diversityFactor;
      b.operatingReactiveKVAR = b.operatingReactiveKVAR * diversityFactor;

      const S_op = Math.sqrt(
        b.operatingActiveKW * b.operatingActiveKW +
        b.operatingReactiveKVAR * b.operatingReactiveKVAR
      );
      b.operatingApparentKVA = S_op;
      b.operatingPowerFactor = S_op > 0 ? b.operatingActiveKW / S_op : 0.85;

      if (b.phase === 3 && b.nominalVoltageKV > 0) {
        b.operatingCurrentAmps = b.operatingApparentKVA / (Math.sqrt(3) * b.nominalVoltageKV);
      } else if (b.phase === 1 && b.nominalVoltageKV > 0) {
        b.operatingCurrentAmps = b.operatingApparentKVA / b.nominalVoltageKV;
      }

      // Round values
      b.connectedActiveKW = Math.round(b.connectedActiveKW * 10) / 10;
      b.connectedReactiveKVAR = Math.round(b.connectedReactiveKVAR * 10) / 10;
      b.connectedApparentKVA = Math.round(b.connectedApparentKVA * 10) / 10;
      b.operatingActiveKW = Math.round(b.operatingActiveKW * 10) / 10;
      b.operatingReactiveKVAR = Math.round(b.operatingReactiveKVAR * 10) / 10;
      b.operatingApparentKVA = Math.round(b.operatingApparentKVA * 10) / 10;
      b.operatingPowerFactor = Math.round(b.operatingPowerFactor * 1000) / 1000;
      b.operatingCurrentAmps = Math.round(b.operatingCurrentAmps * 10) / 10;
    }

    plantOperatingActiveKW = plantOperatingActiveKW * diversityFactor;
    plantOperatingReactiveKVAR = plantOperatingReactiveKVAR * diversityFactor;
    const plantOperatingApparentKVA = Math.sqrt(
      plantOperatingActiveKW * plantOperatingActiveKW +
      plantOperatingReactiveKVAR * plantOperatingReactiveKVAR
    );
    const plantOperatingPF = plantOperatingApparentKVA > 0
      ? plantOperatingActiveKW / plantOperatingApparentKVA
      : 0.85;

    const plantDemandWithMarginMVA = (plantOperatingApparentKVA * (1.0 + designMarginPct / 100.0)) / 1000.0;

    return {
      plantName: this.plantName,
      totalConsumers: this.loads.length,
      operatingCase,
      diversityFactorApplied: diversityFactor,
      designMarginPercent: designMarginPct,
      plantConnectedActiveMW: Math.round((plantConnectedActiveKW / 1000.0) * 100) / 100,
      plantConnectedApparentMVA: Math.round((Math.sqrt(plantConnectedActiveKW ** 2 + plantConnectedReactiveKVAR ** 2) / 1000.0) * 100) / 100,
      plantOperatingActiveMW: Math.round((plantOperatingActiveKW / 1000.0) * 100) / 100,
      plantOperatingReactiveMVAR: Math.round((plantOperatingReactiveKVAR / 1000.0) * 100) / 100,
      plantOperatingApparentMVA: Math.round((plantOperatingApparentKVA / 1000.0) * 100) / 100,
      plantOperatingPowerFactor: Math.round(plantOperatingPF * 1000) / 1000,
      recommendedSubstationCapacityMVA: Math.round(plantDemandWithMarginMVA * 10) / 10,
      buses: busResults,
      loads: this.loads
    };
  }
}

module.exports = {
  ElectricalLoadList
};
