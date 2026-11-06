'use strict';

/**
 * Master Piping Line List Generator (Multi-Discipline FEED Deliverable).
 *
 * Generates comprehensive line schedule rows across all 11 LNG process and utility units:
 * - Line Number: NPS-Fluid-Seq-PipingClass-Insulation
 * - From Tag/Nozzle, To Tag/Nozzle
 * - P&ID Drawing Number
 * - Fluid Phase & Service Description
 * - Operating & Design Pressure/Temperature
 * - Piping Material Class & Pipe Material Grade
 * - Schedule, Wall Thickness, Flange Rating
 * - Insulation Type & Thickness
 * - ASME B31.3 §345 Hydrostatic / Pneumatic Test Pressure
 * - NDE Radiography Requirements (ASME B31.3 Table 341.3.2)
 * - PED 2014/68/EU Category Assignment
 */

const { LngPlantEngine } = require('../lng/lng_plant_engine');

// Standard ASME B36.10M / B36.19M nominal dimensions (NPS -> { OD mm, schedules: { sch: wallThicknessMm } })
const PIPE_SCHEDULE_DATABASE = {
  0.5: { odMm: 21.3, schedules: { 'Sch 10S': 2.11, 'Sch 40S': 2.77, 'Sch 80S': 3.73, 'Sch 160': 4.78 } },
  0.75: { odMm: 26.7, schedules: { 'Sch 10S': 2.11, 'Sch 40S': 2.87, 'Sch 80S': 3.91, 'Sch 160': 5.56 } },
  1: { odMm: 33.4, schedules: { 'Sch 10S': 2.77, 'Sch 40S': 3.38, 'Sch 80S': 4.55, 'Sch 160': 6.35 } },
  1.5: { odMm: 48.3, schedules: { 'Sch 10S': 2.77, 'Sch 40S': 3.68, 'Sch 80S': 5.08, 'Sch 160': 7.14 } },
  2: { odMm: 60.3, schedules: { 'Sch 10S': 2.77, 'Sch 40S': 3.91, 'Sch 80S': 5.54, 'Sch 160': 8.74 } },
  3: { odMm: 88.9, schedules: { 'Sch 10S': 3.05, 'Sch 40S': 5.49, 'Sch 80S': 7.62, 'Sch 160': 11.13 } },
  4: { odMm: 114.3, schedules: { 'Sch 10S': 3.05, 'Sch 40S': 6.02, 'Sch 80S': 8.56, 'Sch 120': 11.13, 'Sch 160': 13.49 } },
  6: { odMm: 168.3, schedules: { 'Sch 10S': 3.40, 'Sch 40S': 7.11, 'Sch 80S': 10.97, 'Sch 120': 14.27, 'Sch 160': 18.26 } },
  8: { odMm: 219.1, schedules: { 'Sch 10S': 3.76, 'Sch 20': 6.35, 'Sch 40S': 8.18, 'Sch 80S': 12.70, 'Sch 160': 23.01 } },
  10: { odMm: 273.0, schedules: { 'Sch 10S': 4.19, 'Sch 20': 6.35, 'Sch 40S': 9.27, 'Sch 80S': 15.09, 'Sch 160': 28.58 } },
  12: { odMm: 323.8, schedules: { 'Sch 10S': 4.57, 'Sch 20': 6.35, 'Sch 40S': 10.31, 'Sch 80S': 17.48, 'Sch 160': 33.32 } },
  14: { odMm: 355.6, schedules: { 'Sch 10S': 4.78, 'Sch 20': 7.92, 'Sch 40': 11.13, 'Sch 80': 19.05, 'Sch 160': 35.71 } },
  16: { odMm: 406.4, schedules: { 'Sch 10S': 4.78, 'Sch 20': 7.92, 'Sch 40': 12.70, 'Sch 80': 21.44, 'Sch 160': 40.49 } },
  18: { odMm: 457.0, schedules: { 'Sch 10S': 4.78, 'Sch 20': 7.92, 'Sch 40': 14.27, 'Sch 80': 23.83, 'Sch 160': 45.24 } },
  20: { odMm: 508.0, schedules: { 'Sch 10S': 5.54, 'Sch 20': 9.53, 'Sch 40': 15.09, 'Sch 80': 26.19, 'Sch 160': 50.01 } },
  24: { odMm: 610.0, schedules: { 'Sch 10S': 6.35, 'Sch 20': 9.53, 'Sch 40': 17.48, 'Sch 80': 30.96, 'Sch 160': 59.54 } },
  28: { odMm: 711.2, schedules: { 'Sch 10S': 6.35, 'Sch 20': 9.53, 'Sch 30': 12.70, 'Sch 40': 19.05, 'Sch 80': 34.93 } },
  30: { odMm: 762.0, schedules: { 'Sch 10S': 6.35, 'Sch 20': 9.53, 'Sch 30': 12.70, 'Sch 40': 19.05, 'Sch 80': 38.10 } },
  36: { odMm: 914.4, schedules: { 'Sch 10S': 6.35, 'Sch 20': 9.53, 'Sch 30': 12.70, 'Sch 40': 19.05, 'Sch 80': 44.45 } },
  42: { odMm: 1067.0, schedules: { 'Sch 10S': 7.92, 'Sch 20': 12.70, 'Sch 40': 22.23, 'Sch 80': 50.80 } },
  48: { odMm: 1219.0, schedules: { 'Sch 10S': 7.92, 'Sch 20': 12.70, 'Sch 40': 25.40, 'Sch 80': 57.15 } }
};

// Material Class Specifications Database
const MATERIAL_CLASS_SPECS = {
  '600S': {
    name: 'Sour Gas Carbon Steel 600#',
    rating: 'Class 600',
    grade: 'ASTM A106 Gr B / A333 Gr 6',
    defaultSch: 'Sch 40',
    corrosionAllowanceMm: 3.0,
    tempRangeC: [-29, 120],
    defaultNde: '100% RT',
    nace: true
  },
  '600L': {
    name: 'Cryogenic High-Pressure Stainless Steel 600#',
    rating: 'Class 600',
    grade: 'ASTM A312 TP316L',
    defaultSch: 'Sch 80S',
    corrosionAllowanceMm: 0.0,
    tempRangeC: [-162, 65],
    defaultNde: '100% RT',
    nace: false
  },
  '300L': {
    name: 'Cryogenic Precooled Stainless Steel 300#',
    rating: 'Class 300',
    grade: 'ASTM A312 TP316L',
    defaultSch: 'Sch 40S',
    corrosionAllowanceMm: 0.0,
    tempRangeC: [-105, 65],
    defaultNde: '20% RT',
    nace: false
  },
  '150L': {
    name: 'Cryogenic LNG Stainless Steel 150#',
    rating: 'Class 150',
    grade: 'ASTM A312 TP304L / TP316L',
    defaultSch: 'Sch 10S',
    corrosionAllowanceMm: 0.0,
    tempRangeC: [-196, 65],
    defaultNde: '100% RT',
    nace: false
  },
  '150A': {
    name: 'Amine Service Carbon Steel 150#',
    rating: 'Class 150',
    grade: 'ASTM A106 Gr B (PWHT)',
    defaultSch: 'Sch 40',
    corrosionAllowanceMm: 3.0,
    tempRangeC: [0, 150],
    defaultNde: '10% RT',
    nace: true
  },
  '150SJ': {
    name: 'Steam-Jacketed Molten Sulfur Carbon Steel 150#',
    rating: 'Class 150',
    grade: 'ASTM A106 Gr B',
    defaultSch: 'Sch 40',
    corrosionAllowanceMm: 1.5,
    tempRangeC: [120, 160],
    defaultNde: '20% RT',
    nace: false
  },
  '150SW': {
    name: 'Seawater Cooling Copper-Nickel / GRE 150#',
    rating: 'Class 150',
    grade: 'Cu-Ni 90/10 (UNS C70600)',
    defaultSch: 'STD',
    corrosionAllowanceMm: 0.5,
    tempRangeC: [5, 45],
    defaultNde: '0% RT (Visual 100%)',
    nace: false
  },
  '600H': {
    name: 'High-Pressure Steam Alloy Steel 600#',
    rating: 'Class 600',
    grade: 'ASTM A335 Gr P11',
    defaultSch: 'Sch 80',
    corrosionAllowanceMm: 1.5,
    tempRangeC: [0, 420],
    defaultNde: '100% RT',
    nace: false
  },
  '300S': {
    name: 'General Process Carbon Steel 300#',
    rating: 'Class 300',
    grade: 'ASTM A106 Gr B',
    defaultSch: 'Sch 40',
    corrosionAllowanceMm: 1.5,
    tempRangeC: [-29, 200],
    defaultNde: '10% RT',
    nace: false
  },
  '150S': {
    name: 'Low Pressure Process Carbon Steel 150#',
    rating: 'Class 150',
    grade: 'ASTM A106 Gr B',
    defaultSch: 'Sch 40',
    corrosionAllowanceMm: 1.5,
    tempRangeC: [-29, 150],
    defaultNde: '10% RT',
    nace: false
  }
};

class MasterLineListGenerator {
  /**
   * @param {object} [engineInstance] Optional LngPlantEngine instance.
   */
  constructor(engineInstance) {
    this.engine = engineInstance || new LngPlantEngine();
  }

  /**
   * Generates master line list schedule rows across all 11 plant units.
   * @param {object} [options] Filter or configuration options.
   * @returns {Array<object>} Formatted line list rows.
   */
  generateMasterLineList(options = {}) {
    const rawPids = this.engine.generateAllPidSheets();
    const rows = [];

    for (const sheet of rawPids) {
      const unitId = sheet.unit;
      const unitName = sheet.title || sheet.area;
      const pidDwgNo = `PID-${unitId.replace('U-', '')}01`;

      // Extract lines from unit configuration
      const unitConfigFn = this.engine[`_buildUnit${unitId.replace('U-', '')}Config`];
      if (!unitConfigFn) continue;

      const unitConfig = unitConfigFn.call(this.engine);
      const lines = unitConfig.lines || [];

      for (let idx = 0; idx < lines.length; idx++) {
        const rawLine = lines[idx];
        const row = this._processLineRecord(rawLine, unitId, unitName, pidDwgNo, idx + 1);
        if (!options.unitId || options.unitId === unitId) {
          rows.push(row);
        }
      }
    }

    return rows;
  }

  /**
   * Process individual line definition into FEED schedule row.
   * @private
   */
  _processLineRecord(line, unitId, unitName, pidDwgNo, sequence) {
    const sizeIn = line.sizeIn || 4;
    const nps = sizeIn;
    const dnMm = Math.round(nps * 25.4);
    const service = line.service || 'Process Fluid';

    // Map fluid abbreviation code
    const fluidCode = this._deriveFluidCode(service, line.material, unitId);

    // Map material class
    const pipingClass = this._resolvePipingClass(line, unitId);
    const classMeta = MATERIAL_CLASS_SPECS[pipingClass] || MATERIAL_CLASS_SPECS['150S'];

    // Map fluid phase
    const fluidPhase = this._resolveFluidPhase(service, line.vaporFraction);

    // Operating and design pressures
    const operatingPBarg = Number((line.operatingPressureBarg !== undefined ? line.operatingPressureBarg : line.designPressureBarg || 10.0).toFixed(1));
    const operatingTempC = Number((line.operatingTemperatureC !== undefined ? line.operatingTemperatureC : line.designTempC || 25.0).toFixed(1));

    // Design parameters with FEED engineering safety margins
    let designPBarg;
    if (line.designPressureBarg !== undefined && line.designPressureBarg > 0) {
      designPBarg = Number(line.designPressureBarg.toFixed(1));
      if (operatingPBarg > designPBarg) {
        designPBarg = Number((operatingPBarg * 1.1).toFixed(1));
      }
    } else {
      designPBarg = Number((operatingPBarg > 1.0 ? operatingPBarg * 1.1 + 1.0 : operatingPBarg + 1.5).toFixed(1));
      if (pipingClass.includes('600') && designPBarg < 60.0) designPBarg = 85.0;
      if (pipingClass.includes('300') && designPBarg < 25.0) designPBarg = 35.0;
      if (pipingClass.includes('150') && designPBarg < 10.0) designPBarg = 14.0;
    }

    let designTempMinC = line.designTempMinC !== undefined
      ? Number(line.designTempMinC.toFixed(1))
      : Math.min(classMeta.tempRangeC[0], operatingTempC < 0 ? operatingTempC - 5.0 : classMeta.tempRangeC[0]);
    let designTempMaxC = line.designTempMaxC !== undefined
      ? Number(line.designTempMaxC.toFixed(1))
      : Math.max(classMeta.tempRangeC[1], operatingTempC + 25.0);

    // Pipe schedule and wall thickness
    const schedule = this._resolveSchedule(nps, pipingClass, classMeta.defaultSch);
    const wallThicknessMm = this._resolveWallThickness(nps, schedule);

    // Insulation specification
    const insulation = this._resolveInsulation(line.insulation, operatingTempC, nps);

    // ASME B31.3 §345 Test Pressure Calculation
    const testCalc = this.calculateTestPressure(designPBarg, pipingClass, service, operatingTempC);

    // NDE requirement
    const nde = this.determineNdeRequirement(pipingClass, service, operatingTempC, designPBarg);

    // PED 2014/68/EU classification
    const ped = this.determinePedCategory(service, fluidPhase, designPBarg, dnMm);

    // Format standardized Line Number: NPS"-Fluid-Seq-PipingClass-Insulation
    const seqStr = String(sequence).padStart(2, '0');
    const unitNum = unitId.replace('U-', '');
    const standardLineNumber = `${nps}"-${fluidCode}-${unitNum}${seqStr}-${pipingClass}-${insulation.code}`;

    const formatEndpoint = (ep) => {
      if (!ep) return 'Battery Limit';
      if (typeof ep === 'string') return ep.includes('/') ? ep : `${ep} / N1`;
      return `${ep.tag || 'BL'} / ${ep.nozzle || 'N1'}`;
    };
    const fromTagStr = formatEndpoint(line.from);
    const toTagStr = formatEndpoint(line.to);

    return {
      lineTag: line.lineNumber || standardLineNumber,
      lineNumber: standardLineNumber,
      unitId,
      unitName,
      fromTag: fromTagStr,
      toTag: toTagStr,
      pidDwgNo,
      streamNumber: line.streamNumber || null,
      fluidService: service,
      fluidCode,
      fluidPhase,
      operatingPressureBarg: operatingPBarg,
      operatingTempC,
      designPressureBarg: designPBarg,
      designTempMinC,
      designTempMaxC,
      pipingClass,
      pipeMaterialGrade: classMeta.grade,
      nps,
      dnMm,
      schedule,
      wallThicknessMm,
      flangeRating: classMeta.rating,
      insulationType: insulation.type,
      insulationCode: insulation.code,
      insulationThicknessMm: insulation.thicknessMm,
      testType: testCalc.testType,
      testMedium: testCalc.testMedium,
      testPressureBarg: testCalc.testPressureBarg,
      testStandard: 'ASME B31.3 §345',
      ndeRadiography: nde,
      pedCategory: ped.category,
      pedFluidGroup: ped.fluidGroup,
      corrosionAllowanceMm: classMeta.corrosionAllowanceMm,
      massFlowTph: line.massFlowTph || line.flowRateTH || 0.0
    };
  }

  /**
   * Calculates hydrotest or pneumatic test pressure per ASME B31.3 §345.
   *
   * ASME B31.3 §345.4.2 Hydrostatic Leak Test:
   *   P_T = 1.5 * P_design * (S_T / S_design)
   * ASME B31.3 §345.5.4 Pneumatic Leak Test:
   *   P_T = 1.1 * P_design
   *
   * @param {number} designPressureBarg Internal design gauge pressure.
   * @param {string} [pipingClass] Material class code.
   * @param {string} [service] Fluid service name.
   * @param {number} [operatingTempC] Operating temperature in °C.
   * @returns {object} Test parameters.
   */
  calculateTestPressure(designPressureBarg, pipingClass = '150S', service = '', operatingTempC = 25.0) {
    const pDes = Number(designPressureBarg) || 0;
    const pClass = String(pipingClass || '150S');
    const srv = String(service || '');
    const temp = Number(operatingTempC) || 25.0;

    const isCryogenic = temp <= -40.0 || pClass.includes('L') || pClass.includes('SS');
    const isDryGas = /bone dry|dehyd|regen gas|mol sieve|acid gas overhead/i.test(srv);

    // Lines that cannot tolerate residual water (moisture freeze-up risk or catalyst poisoning) use Pneumatic test with dry N2
    const usePneumatic = isCryogenic || isDryGas;

    if (usePneumatic) {
      // ASME B31.3 §345.5.4 Pneumatic Test: 1.10 x Design Pressure
      const pt = Number((1.1 * pDes).toFixed(1));
      return {
        testType: 'Pneumatic',
        testMedium: 'Dry Nitrogen (N2) / Oil-Free Air',
        testPressureBarg: Math.max(pt, 1.5),
        multiplier: 1.1,
        codeClause: 'ASME B31.3 §345.5'
      };
    }

    // ASME B31.3 §345.4.2 Hydrostatic Test: 1.50 x Design Pressure * Stress Ratio
    // Stress ratio St/S is typically 1.0 for ambient up to 100 °C, and up to 1.15 for elevated temp
    let stressRatio = 1.0;
    if (temp > 200.0) {
      stressRatio = 1.12;
    } else if (temp > 100.0) {
      stressRatio = 1.05;
    }

    const pt = Number((1.5 * pDes * stressRatio).toFixed(1));
    const testMedium = pClass.includes('L') || pClass.includes('SS')
      ? 'Inhibited Demin Water (Cl- < 30 ppm)'
      : 'Potable Fresh Water';

    return {
      testType: 'Hydrostatic',
      testMedium,
      testPressureBarg: Math.max(pt, 2.0),
      multiplier: Number((1.5 * stressRatio).toFixed(2)),
      codeClause: 'ASME B31.3 §345.4'
    };
  }

  /**
   * Determines NDE Radiography inspection requirements per ASME B31.3 Table 341.3.2.
   * @param {string} [pipingClass] Material class code.
   * @param {string} [service] Service description.
   * @param {number} [operatingTempC] Temperature.
   * @param {number} [designPressureBarg] Pressure.
   * @returns {string} NDE percentage and technique.
   */
  determineNdeRequirement(pipingClass = '150S', service = '', operatingTempC = 25.0, designPressureBarg = 10.0) {
    const pClass = String(pipingClass || '150S');
    const srv = String(service || '');
    const temp = Number(operatingTempC) || 25.0;
    const pDes = Number(designPressureBarg) || 0;

    if (pClass === '150SW' || /cooling water|potable|demin/i.test(srv)) {
      return '0% RT (100% Visual per ASME B31.3 Cat D)';
    }
    if (pClass === '600L' || pClass === '150L' || pClass === '300L' || temp <= -40.0) {
      return '100% RT (Cryogenic Service)';
    }
    if (pClass === '600S' || /sour|h2s|acid gas|claus/i.test(srv)) {
      return '100% RT (NACE MR0175 Sour Service)';
    }
    if (pClass === '600H' || temp > 300.0) {
      return '100% RT (High-Energy Steam)';
    }
    if (pClass.includes('300') || pDes > 20.0) {
      return '20% RT (Normal Fluid Service Class 300)';
    }
    return '10% RT (Normal Fluid Service Class 150)';
  }

  /**
   * Determines EU Pressure Equipment Directive (PED 2014/68/EU) Category.
   * Piping annex classification based on Fluid Group (1: dangerous vs 2: other),
   * fluid state (gas/vapor vs liquid), Design Pressure PS (bar), and Diameter DN (mm).
   *
   * @param {string} [service] Fluid service name.
   * @param {string} [fluidPhase] Gas/Liquid/Two-Phase.
   * @param {number} [psBarg] Design pressure in barg.
   * @param {number} [dnMm] Nominal diameter in mm.
   * @returns {object} PED classification.
   */
  determinePedCategory(service = '', fluidPhase = 'Gas', psBarg = 10.0, dnMm = 100) {
    const srv = String(service || '');
    const phase = String(fluidPhase || '');
    const isGroup1 = !/water|cooling|utility air|nitrogen/i.test(srv);
    const isGas = phase.includes('Gas') || phase.includes('Vapor') || phase.includes('Two-Phase') || /steam/i.test(srv);

    const ps = Math.max(Number(psBarg) || 0.5, 0.5);
    const psDn = ps * (Number(dnMm) || 50);

    if (isGroup1) {
      if (isGas) {
        // Table 6: Piping for Group 1 gases
        if (dnMm <= 25) return { category: 'SEP', fluidGroup: 'Group 1 (Flammable/Toxic)', basis: 'Table 6 DN <= 25' };
        if (psDn <= 1000 && dnMm <= 100) return { category: 'Category I', fluidGroup: 'Group 1', basis: 'Table 6' };
        if (psDn <= 3500 && ps <= 100) return { category: 'Category II', fluidGroup: 'Group 1', basis: 'Table 6' };
        return { category: 'Category III', fluidGroup: 'Group 1', basis: 'Table 6 PS*DN > 3500' };
      } else {
        // Table 8: Piping for Group 1 liquids
        if (dnMm <= 25) return { category: 'SEP', fluidGroup: 'Group 1', basis: 'Table 8 DN <= 25' };
        if (psDn <= 2000) return { category: 'Category I', fluidGroup: 'Group 1', basis: 'Table 8' };
        return { category: 'Category II', fluidGroup: 'Group 1', basis: 'Table 8 PS*DN > 2000' };
      }
    } else {
      if (isGas) {
        // Table 7: Piping for Group 2 gases (e.g. steam, N2)
        if (dnMm <= 32 || psDn <= 1000) return { category: 'SEP', fluidGroup: 'Group 2', basis: 'Table 7 DN <= 32' };
        if (psDn <= 3500) return { category: 'Category I', fluidGroup: 'Group 2', basis: 'Table 7' };
        if (psDn <= 5000 && ps <= 30) return { category: 'Category II', fluidGroup: 'Group 2', basis: 'Table 7' };
        return { category: 'Category III', fluidGroup: 'Group 2', basis: 'Table 7' };
      } else {
        // Table 9: Piping for Group 2 liquids (water)
        if (psDn <= 10000 && ps <= 10) return { category: 'SEP', fluidGroup: 'Group 2', basis: 'Table 9' };
        if (psDn <= 20000) return { category: 'Category I', fluidGroup: 'Group 2', basis: 'Table 9' };
        return { category: 'Category II', fluidGroup: 'Group 2', basis: 'Table 9' };
      }
    }
  }

  /**
   * Helper to derive standard fluid code abbreviation.
   * @private
   */
  _deriveFluidCode(service, material, unitId) {
    const s = String(service || '').toLowerCase();
    if (s.includes('sour') || s.includes('acid gas')) return 'SG';
    if (s.includes('lng')) return 'LNG';
    if (s.includes('bog') || s.includes('boil-off')) return 'BOG';
    if (s.includes('propane') || s.includes('c3')) return 'C3';
    if (s.includes('mixed ref') || s.includes('mr')) return 'MR';
    if (s.includes('condensate') || s.includes('ngl') || s.includes('scrub')) return 'HC';
    if (s.includes('sulfur') || s.includes('claus')) return 'SR';
    if (s.includes('amine')) return 'AMN';
    if (s.includes('steam')) return 'STM';
    if (s.includes('quench') || s.includes('water')) return 'CW';
    if (s.includes('offgas') || s.includes('tail gas')) return 'TG';
    if (s.includes('fuel gas')) return 'FG';
    if (s.includes('flare')) return 'FLR';
    if (s.includes('nitrogen')) return 'N2';
    return 'NG';
  }

  /**
   * Helper to resolve piping class code.
   * @private
   */
  _resolvePipingClass(line, unitId) {
    const s = String((line && line.service) || '').toLowerCase();
    const mat = String((line && line.material) || '').toUpperCase();
    const cls = String((line && line.class) || '');

    if (s.includes('seawater') || s.includes('cooling water') || mat === 'CU-NI') return '150SW';
    if (s.includes('sulfur') || s.includes('jacket')) return '150SJ';
    if (s.includes('steam') || (line && line.designTempC && line.designTempC > 250)) return '600H';
    if (s.includes('amine')) return '150A';
    if (s.includes('lng') || (line && line.designTempC && line.designTempC < -120)) {
      return cls.includes('600') ? '600L' : '150L';
    }
    if (line && line.designTempC && line.designTempC < -20) {
      return '300L';
    }
    if (s.includes('sour') || unitId === 'U-10' || unitId === 'U-20') {
      return cls.includes('300') ? '300S' : '600S';
    }
    if (cls.includes('600')) return mat === 'SS' ? '600L' : '600S';
    if (cls.includes('300')) return '300S';
    return '150S';
  }

  /**
   * Helper to resolve fluid phase.
   * @private
   */
  _resolveFluidPhase(service, vaporFraction) {
    const s = String(service || '').toLowerCase();
    if (s.includes('lng')) return 'Cryogenic Liquid';
    if (s.includes('bog') || s.includes('boil-off')) return 'Cryogenic Vapor';
    if (s.includes('steam')) return 'Superheated Vapor';
    if (vaporFraction >= 0.99 || /gas|vapor|flare/i.test(s)) return 'Gas';
    if (vaporFraction <= 0.01 || /liquid|amine|water|condensate|bottoms/i.test(s)) return 'Liquid';
    return 'Two-Phase (Gas/Liquid)';
  }

  /**
   * Helper to resolve pipe schedule with alias normalization (e.g. Sch 40 <-> Sch 40S).
   * @private
   */
  _resolveSchedule(nps, pipingClass, defaultSch) {
    const entry = PIPE_SCHEDULE_DATABASE[nps];
    if (!entry) return defaultSch;

    const findMatch = (cand) => {
      if (entry.schedules[cand] !== undefined) return cand;
      if (cand.endsWith('S') && entry.schedules[cand.slice(0, -1)] !== undefined) return cand.slice(0, -1);
      if (!cand.endsWith('S') && entry.schedules[cand + 'S'] !== undefined) return cand + 'S';
      return null;
    };

    const direct = findMatch(defaultSch);
    if (direct) return direct;

    const pClass = String(pipingClass || '');
    if (pClass.includes('600')) {
      const sch80 = findMatch('Sch 80') || findMatch('Sch 80S');
      if (sch80) return sch80;
      const sch40 = findMatch('Sch 40') || findMatch('Sch 40S');
      if (sch40) return sch40;
    }
    if (pClass.includes('300')) {
      const sch40 = findMatch('Sch 40') || findMatch('Sch 40S');
      if (sch40) return sch40;
    }
    if (pClass.includes('150')) {
      const sch10 = findMatch('Sch 10S');
      if (sch10) return sch10;
      const sch40 = findMatch('Sch 40') || findMatch('Sch 40S');
      if (sch40) return sch40;
    }

    return Object.keys(entry.schedules)[0] || 'STD';
  }

  /**
   * Helper to resolve nominal wall thickness in mm with alias normalization.
   * @private
   */
  _resolveWallThickness(nps, schedule) {
    const entry = PIPE_SCHEDULE_DATABASE[nps];
    if (entry) {
      if (entry.schedules[schedule] !== undefined) return entry.schedules[schedule];
      if (schedule.endsWith('S') && entry.schedules[schedule.slice(0, -1)] !== undefined) {
        return entry.schedules[schedule.slice(0, -1)];
      }
      if (!schedule.endsWith('S') && entry.schedules[schedule + 'S'] !== undefined) {
        return entry.schedules[schedule + 'S'];
      }
    }
    return Math.round((nps * 25.4 * 0.05 + 2.0) * 10) / 10;
  }

  /**
   * Helper to resolve insulation parameters.
   * @private
   */
  _resolveInsulation(rawCode, operatingTempC, nps) {
    if (operatingTempC <= -40.0) {
      // Cryogenic insulation: PIR foam or Aerogel blanket
      const thk = operatingTempC <= -120.0 ? 120 : 80;
      return { code: 'C', type: 'Cryogenic PIR / Aerogel Multi-Layer', thicknessMm: thk };
    }
    if (operatingTempC >= 60.0) {
      // Hot heat conservation / personnel protection
      const thk = operatingTempC >= 200.0 ? 100 : operatingTempC >= 100.0 ? 60 : 40;
      return { code: 'H', type: 'Mineral Wool / Calcium Silicate', thicknessMm: thk };
    }
    if (rawCode === 'IH' || rawCode === 'H') {
      return { code: 'H', type: 'Mineral Wool Personnel Protection', thicknessMm: 40 };
    }
    return { code: 'N', type: 'Uninsulated (Bare Pipe)', thicknessMm: 0 };
  }

  /**
   * Lookup line row by tag or line number.
   * @param {string} tagOrNumber Line tag or standardized number.
   * @returns {object|null} Matching line row.
   */
  getLineByTag(tagOrNumber) {
    const rows = this.generateMasterLineList();
    return rows.find((r) => r.lineTag === tagOrNumber || r.lineNumber === tagOrNumber) || null;
  }

  /**
   * Exports line list to clean Markdown table.
   * @param {object} [options]
   * @returns {string} Markdown document.
   */
  toMarkdown(options = {}) {
    const rows = this.generateMasterLineList(options);
    let md = `# Master Piping Line List Schedule (FEED Deliverable)\n\n`;
    md += `**Project**: 5.0 MTPA World-Scale LNG Plant Complex\n`;
    md += `**Document No**: LNG-00-PI-LST-001 | **Rev**: 0 | **Total Lines**: ${rows.length}\n`;
    md += `**Governing Standard**: ASME B31.3 Process Piping & PED 2014/68/EU\n\n`;

    md += `| Line Number | From / To | Service | Phase | Oper P/T | Design P/T | Class / Grade | Sch / W.T. (mm) | Flange | Test Press (barg) | NDE % | PED |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

    for (const r of rows) {
      const fromTo = `${r.fromTag} -> ${r.toTag}`;
      const operPt = `${r.operatingPressureBarg} b / ${r.operatingTempC}°C`;
      const desPt = `${r.designPressureBarg} b / [${r.designTempMinC}°C..${r.designTempMaxC}°C]`;
      const schWt = `${r.schedule} (${r.wallThicknessMm})`;
      md += `| **${r.lineNumber}** | ${fromTo} | ${r.fluidService} | ${r.fluidPhase} | ${operPt} | ${desPt} | ${r.pipingClass} <br> ${r.pipeMaterialGrade} | ${schWt} | ${r.flangeRating} | ${r.testType}: **${r.testPressureBarg}** | ${r.ndeRadiography} | ${r.pedCategory} |\n`;
    }

    return md;
  }

  /**
   * Exports line list to RFC 4180 CSV string.
   * @param {object} [options]
   * @returns {string} CSV content.
   */
  toCsv(options = {}) {
    const rows = this.generateMasterLineList(options);
    const headers = [
      'Line Number',
      'P&ID Tag',
      'Unit ID',
      'From Equipment',
      'To Equipment',
      'P&ID DWG',
      'Fluid Service',
      'Fluid Phase',
      'Operating Press (barg)',
      'Operating Temp (°C)',
      'Design Press (barg)',
      'Design Temp Min (°C)',
      'Design Temp Max (°C)',
      'Piping Class',
      'Material Grade',
      'NPS (in)',
      'DN (mm)',
      'Schedule',
      'Wall Thickness (mm)',
      'Flange Rating',
      'Insulation Type',
      'Insulation Thk (mm)',
      'Test Type',
      'Test Medium',
      'Test Press (barg)',
      'NDE Radiography',
      'PED Category'
    ];

    const escapeCsv = (str) => {
      const s = String(str !== undefined && str !== null ? str : '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csvLines = [headers.join(',')];
    for (const r of rows) {
      csvLines.push([
        escapeCsv(r.lineNumber),
        escapeCsv(r.lineTag),
        escapeCsv(r.unitId),
        escapeCsv(r.fromTag),
        escapeCsv(r.toTag),
        escapeCsv(r.pidDwgNo),
        escapeCsv(r.fluidService),
        escapeCsv(r.fluidPhase),
        r.operatingPressureBarg,
        r.operatingTempC,
        r.designPressureBarg,
        r.designTempMinC,
        r.designTempMaxC,
        escapeCsv(r.pipingClass),
        escapeCsv(r.pipeMaterialGrade),
        r.nps,
        r.dnMm,
        escapeCsv(r.schedule),
        r.wallThicknessMm,
        escapeCsv(r.flangeRating),
        escapeCsv(r.insulationType),
        r.insulationThicknessMm,
        escapeCsv(r.testType),
        escapeCsv(r.testMedium),
        r.testPressureBarg,
        escapeCsv(r.ndeRadiography),
        escapeCsv(r.pedCategory)
      ].join(','));
    }

    return csvLines.join('\n');
  }

  /**
   * Generates summary statistics grouped by unit.
   * @returns {object} Summary aggregation.
   */
  getSummary() {
    const rows = this.generateMasterLineList();
    const byUnit = {};
    const byClass = {};
    let totalPneumatic = 0;
    let totalHydro = 0;

    for (const r of rows) {
      byUnit[r.unitId] = (byUnit[r.unitId] || 0) + 1;
      byClass[r.pipingClass] = (byClass[r.pipingClass] || 0) + 1;
      if (r.testType === 'Pneumatic') totalPneumatic++;
      else totalHydro++;
    }

    return {
      totalLineCount: rows.length,
      linesByUnit: byUnit,
      linesByPipingClass: byClass,
      testMethods: {
        hydrostatic: totalHydro,
        pneumatic: totalPneumatic
      }
    };
  }
}

module.exports = {
  MasterLineListGenerator,
  PIPE_SCHEDULE_DATABASE,
  MATERIAL_CLASS_SPECS
};
