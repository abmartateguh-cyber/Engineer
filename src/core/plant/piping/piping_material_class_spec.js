/**
 * Piping Material Class Specification (PMS) & Branch Table Engine.
 * Industrial plant piping class generator for LNG, Gas Processing, Cryogenics & Utilities.
 *
 * Implements:
 * 1. Standard EPC Piping Classes:
 *    - A1A: Carbon Steel ASME 150# (Utility Water, Fuel Gas, Air, Drain; CA 3.0 mm)
 *    - A1B: Carbon Steel ASME 300# (Process Gas, Hydrocarbons; CA 3.0 mm)
 *    - B2L: Low-Temp Carbon Steel (LTCS) ASME 300# (-46 °C Refrigeration; CA 1.5 mm)
 *    - B3L: LTCS ASME 600# (High-Pressure Refrigeration / Feed Gas; CA 1.5 mm)
 *    - C9S: Cryogenic Austenitic SS 316L ASME 600# (-196 °C LNG, BOG, Liquid N2; CA 0 mm)
 *    - C1S: Austenitic SS 316L ASME 150# (Chemical / Amine / Demin Water; CA 0 mm)
 *    - D6N: Duplex 2205 (UNS S31803) ASME 600# (Sour Gas Treating, High CO2/H2S; CA 0 mm)
 *    - E8S: Super Duplex 2507 (UNS S32750) ASME 900# (Seawater / Produced Water; CA 0 mm)
 *    - N4M: Monel 400 ASME 150# (Hydrofluoric Acid, Wet Halogens, Marine Splash; CA 0 mm)
 *    - P1H: HDPE PE100 SDR 11 150# (Cooling Water Intake, Underground Firewater; CA 0 mm)
 * 2. Automated Branch Connection Tables (Equal Tee, Reducing Tee, Weldolet, Sockolet, Threadolet).
 * 3. NACE MR0175 / ISO 15156 Sour Service Compliance & Material Limits Check.
 * 4. ASME B16.5 Flange Pressure-Temperature Ratings.
 */

'use strict';

// claims:evidence:ASME-B16.5-NACE-MR0175-ISO-15156

/**
 * Standard Piping Material Specifications Catalog
 */
const PIPING_MATERIAL_CLASSES = {
  'A1A': {
    classCode: 'A1A',
    description: 'Carbon Steel ASME Class 150 General Process & Utilities',
    ratingClass: 150,
    materialGroup: 'Carbon Steel',
    pipeMaterial: 'A106-B',
    fittingMaterial: 'A234-WPB',
    flangeMaterial: 'A105',
    corrosionAllowanceMm: 3.0,
    minTempC: -29.0,
    maxTempC: 400.0,
    flangeFacing: 'Raised Face (RF 125-250 AARH)',
    gasket: 'Spiral Wound 304/Flexible Graphite with CS outer ring (4.5 mm thick)',
    bolting: 'ASTM A193 Gr B7 stud bolts with ASTM A194 Gr 2H heavy hex nuts',
    valveTrims: 'API 600 Trim 8 (13Cr / Stellite)',
    isSourService: false,
    npsRange: { min: '0.5', max: '60' },
    scheduleMap: {
      '0.5': 'Sch 80', '0.75': 'Sch 80', '1': 'Sch 80', '1.5': 'Sch 80',
      '2': 'Sch 40', '3': 'Sch 40', '4': 'Sch 40', '6': 'Sch 40',
      '8': 'Sch 40', '10': 'Sch 40', '12': 'Sch STD', '14': 'Sch STD',
      '16': 'Sch STD', '18': 'Sch STD', '20': 'Sch STD', '24': 'Sch STD',
      '30': 'Sch STD', '36': 'Sch STD'
    }
  },
  'A1B': {
    classCode: 'A1B',
    description: 'Carbon Steel ASME Class 300 Medium Pressure Process',
    ratingClass: 300,
    materialGroup: 'Carbon Steel',
    pipeMaterial: 'A106-B',
    fittingMaterial: 'A234-WPB',
    flangeMaterial: 'A105',
    corrosionAllowanceMm: 3.0,
    minTempC: -29.0,
    maxTempC: 400.0,
    flangeFacing: 'Raised Face (RF 125-250 AARH)',
    gasket: 'Spiral Wound 304/Flexible Graphite with CS outer ring (4.5 mm thick)',
    bolting: 'ASTM A193 Gr B7 stud bolts with ASTM A194 Gr 2H heavy hex nuts',
    valveTrims: 'API 600 Trim 8 (13Cr / Stellite)',
    isSourService: false,
    npsRange: { min: '0.5', max: '48' },
    scheduleMap: {
      '0.5': 'Sch 80', '0.75': 'Sch 80', '1': 'Sch 80', '1.5': 'Sch 80',
      '2': 'Sch 40', '3': 'Sch 40', '4': 'Sch 40', '6': 'Sch 40',
      '8': 'Sch 40', '10': 'Sch 40', '12': 'Sch STD', '16': 'Sch 40',
      '20': 'Sch 40', '24': 'Sch 40'
    }
  },
  'B2L': {
    classCode: 'B2L',
    description: 'Low Temperature Carbon Steel (LTCS) ASME Class 300 Refrigeration',
    ratingClass: 300,
    materialGroup: 'LTCS',
    pipeMaterial: 'A333-6',
    fittingMaterial: 'A420-WPL6',
    flangeMaterial: 'A350-LF2',
    corrosionAllowanceMm: 1.5,
    minTempC: -46.0,
    maxTempC: 150.0,
    flangeFacing: 'Raised Face (RF) or RTJ for high pressure',
    gasket: 'Spiral Wound 316L/Graphite with 316L inner ring and CS outer ring',
    bolting: 'ASTM A320 Gr L7 (impact tested) with ASTM A194 Gr 4/7 nuts',
    valveTrims: 'API 600 Trim 12 (316 / Stellite)',
    isSourService: false,
    npsRange: { min: '0.5', max: '48' },
    scheduleMap: {
      '0.5': 'Sch 80', '0.75': 'Sch 80', '1': 'Sch 80', '1.5': 'Sch 80',
      '2': 'Sch 80', '3': 'Sch 40', '4': 'Sch 40', '6': 'Sch 40',
      '8': 'Sch 40', '10': 'Sch 40', '12': 'Sch 40', '16': 'Sch 40',
      '20': 'Sch 40', '24': 'Sch 40'
    }
  },
  'B3L': {
    classCode: 'B3L',
    description: 'Low Temperature Carbon Steel (LTCS) ASME Class 600 High Pressure Chilldown',
    ratingClass: 600,
    materialGroup: 'LTCS',
    pipeMaterial: 'A333-6',
    fittingMaterial: 'A420-WPL6',
    flangeMaterial: 'A350-LF2',
    corrosionAllowanceMm: 1.5,
    minTempC: -46.0,
    maxTempC: 150.0,
    flangeFacing: 'Ring Type Joint (RTJ)',
    gasket: 'Octagonal Soft Iron Ring Joint ASME B16.20',
    bolting: 'ASTM A320 Gr L7 with ASTM A194 Gr 4/7 nuts',
    valveTrims: 'API 600 Trim 12 (316 / Stellite)',
    isSourService: false,
    npsRange: { min: '0.5', max: '36' },
    scheduleMap: {
      '0.5': 'Sch 160', '0.75': 'Sch 160', '1': 'Sch 160', '1.5': 'Sch 160',
      '2': 'Sch 80', '3': 'Sch 80', '4': 'Sch 80', '6': 'Sch 80',
      '8': 'Sch 80', '10': 'Sch 80', '12': 'Sch 80', '16': 'Sch 80',
      '20': 'Sch 80', '24': 'Sch 80'
    }
  },
  'C9S': {
    classCode: 'C9S',
    description: 'Cryogenic Austenitic Stainless Steel 316L ASME Class 600 LNG & BOG',
    ratingClass: 600,
    materialGroup: 'Austenitic SS 316L',
    pipeMaterial: 'A312-TP316L',
    fittingMaterial: 'A403-WP316L',
    flangeMaterial: 'A182-F316L',
    corrosionAllowanceMm: 0.0,
    minTempC: -196.0,
    maxTempC: 80.0,
    flangeFacing: 'Raised Face (RF 125-250 AARH) or RTJ',
    gasket: 'Spiral Wound 316L/Expanded Graphite with 316L inner & outer rings',
    bolting: 'ASTM A193 Gr B8M Class 2 (strain-hardened) with ASTM A194 Gr 8M nuts',
    valveTrims: 'Full 316L with Stellite hard-facing, extended cryogenic bonnet per BS 6364',
    isSourService: false,
    npsRange: { min: '0.5', max: '36' },
    scheduleMap: {
      '0.5': 'Sch 40S', '0.75': 'Sch 40S', '1': 'Sch 40S', '1.5': 'Sch 40S',
      '2': 'Sch 40S', '3': 'Sch 40S', '4': 'Sch 40S', '6': 'Sch 40S',
      '8': 'Sch 40S', '10': 'Sch 40S', '12': 'Sch 40S', '16': 'Sch 40S',
      '20': 'Sch 40S', '24': 'Sch 40S'
    }
  },
  'C1S': {
    classCode: 'C1S',
    description: 'Austenitic Stainless Steel 316L ASME Class 150 Chemical & Amine Service',
    ratingClass: 150,
    materialGroup: 'Austenitic SS 316L',
    pipeMaterial: 'A312-TP316L',
    fittingMaterial: 'A403-WP316L',
    flangeMaterial: 'A182-F316L',
    corrosionAllowanceMm: 0.0,
    minTempC: -29.0,
    maxTempC: 200.0,
    flangeFacing: 'Raised Face (RF 125-250 AARH)',
    gasket: 'Spiral Wound 316L/PTFE with 316L inner ring',
    bolting: 'ASTM A193 Gr B8M Class 1 with ASTM A194 Gr 8M nuts',
    valveTrims: 'Trim 10 (Full 316)',
    isSourService: false,
    npsRange: { min: '0.5', max: '36' },
    scheduleMap: {
      '0.5': 'Sch 40S', '0.75': 'Sch 40S', '1': 'Sch 40S', '1.5': 'Sch 40S',
      '2': 'Sch 10S', '3': 'Sch 10S', '4': 'Sch 10S', '6': 'Sch 10S',
      '8': 'Sch 10S', '10': 'Sch 10S', '12': 'Sch 10S', '16': 'Sch 10S'
    }
  },
  'D6N': {
    classCode: 'D6N',
    description: 'Duplex 2205 (UNS S31803) ASME Class 600 Severe Sour Wet Gas & Treating',
    ratingClass: 600,
    materialGroup: 'Duplex 2205',
    pipeMaterial: 'A790-UNS-S31803',
    fittingMaterial: 'A182-F51',
    flangeMaterial: 'A182-F51',
    corrosionAllowanceMm: 0.0,
    minTempC: -50.0,
    maxTempC: 250.0,
    flangeFacing: 'Raised Face (RF) or RTJ',
    gasket: 'Spiral Wound UNS S31803/Graphite with S31803 inner & outer rings',
    bolting: 'ASTM A193 Gr B7M with ASTM A194 Gr 2HM nuts (Sour Service HRC <= 22)',
    valveTrims: 'Duplex 2205 Trim with Stellite seats',
    isSourService: true,
    npsRange: { min: '0.5', max: '30' },
    scheduleMap: {
      '0.5': 'Sch 80S', '0.75': 'Sch 80S', '1': 'Sch 80S', '1.5': 'Sch 80S',
      '2': 'Sch 40S', '3': 'Sch 40S', '4': 'Sch 40S', '6': 'Sch 40S',
      '8': 'Sch 40S', '10': 'Sch 40S', '12': 'Sch 40S', '16': 'Sch 40S'
    }
  },
  'E8S': {
    classCode: 'E8S',
    description: 'Super Duplex 2507 (UNS S32750) ASME Class 900 High Chloride / Seawater',
    ratingClass: 900,
    materialGroup: 'Super Duplex 2507',
    pipeMaterial: 'A790-UNS-S32750',
    fittingMaterial: 'A182-F53',
    flangeMaterial: 'A182-F53',
    corrosionAllowanceMm: 0.0,
    minTempC: -50.0,
    maxTempC: 250.0,
    flangeFacing: 'Ring Type Joint (RTJ)',
    gasket: 'Octagonal UNS S32750 Ring Joint',
    bolting: 'Inconel 718 (UNS N07718) or A193 B7M (HRC <= 22)',
    valveTrims: 'Super Duplex 2507 (PREN >= 42)',
    isSourService: true,
    npsRange: { min: '0.5', max: '24' },
    scheduleMap: {
      '0.5': 'Sch 80S', '0.75': 'Sch 80S', '1': 'Sch 80S', '1.5': 'Sch 80S',
      '2': 'Sch 80S', '3': 'Sch 80S', '4': 'Sch 80S', '6': 'Sch 80S',
      '8': 'Sch 80S', '10': 'Sch 80S', '12': 'Sch 80S'
    }
  },
  'N4M': {
    classCode: 'N4M',
    description: 'Monel 400 (UNS N04400) ASME Class 150 Hydrofluoric Acid & Wet Halogens',
    ratingClass: 150,
    materialGroup: 'Monel 400',
    pipeMaterial: 'B165-N04400',
    fittingMaterial: 'B165-N04400',
    flangeMaterial: 'B165-N04400',
    corrosionAllowanceMm: 0.0,
    minTempC: -196.0,
    maxTempC: 400.0,
    flangeFacing: 'Raised Face (RF)',
    gasket: 'PTFE or Monel 400 spiral wound',
    bolting: 'Monel 400 (ASTM B164) or A193 B8M',
    valveTrims: 'Monel Trim',
    isSourService: false,
    npsRange: { min: '0.5', max: '20' },
    scheduleMap: {
      '0.5': 'Sch 40S', '1': 'Sch 40S', '2': 'Sch 40S', '3': 'Sch 40S',
      '4': 'Sch 40S', '6': 'Sch 40S', '8': 'Sch 40S', '10': 'Sch 40S'
    }
  },
  'P1H': {
    classCode: 'P1H',
    description: 'HDPE PE100 SDR 11 Class 150 Cooling Water & Seawater Intake',
    ratingClass: 150,
    materialGroup: 'HDPE PE100',
    pipeMaterial: 'HDPE-PE100',
    fittingMaterial: 'HDPE Electrofusion / Butt-Fusion',
    flangeMaterial: 'Ductile Iron Backing Ring over PE Stub End',
    corrosionAllowanceMm: 0.0,
    minTempC: -40.0,
    maxTempC: 45.0,
    flangeFacing: 'Flat Face (FF) with stub end',
    gasket: 'EPDM or Neoprene Full Face Gasket (3.0 mm)',
    bolting: 'ASTM A307 Gr B or Galvanized A193 B7 with 2H nuts',
    valveTrims: 'Rubber Lined Butterfly / Diaphragm Valve',
    isSourService: false,
    npsRange: { min: '2', max: '48' },
    scheduleMap: {
      '2': 'SDR 11', '3': 'SDR 11', '4': 'SDR 11', '6': 'SDR 11',
      '8': 'SDR 11', '10': 'SDR 11', '12': 'SDR 11', '16': 'SDR 11',
      '20': 'SDR 11', '24': 'SDR 11'
    }
  }
};

/**
 * ASME B16.5 Flange Pressure-Temperature Ratings [barg] by Material Group & Class
 */
const ASME_B16_5_RATINGS = {
  // Group 1.1: Carbon Steel (A105, A106-B, A516-70)
  'CS_150': [
    { tempC: -29, maxPressureBarg: 19.6 },
    { tempC: 38, maxPressureBarg: 19.6 },
    { tempC: 100, maxPressureBarg: 17.7 },
    { tempC: 200, maxPressureBarg: 13.8 },
    { tempC: 300, maxPressureBarg: 10.2 },
    { tempC: 400, maxPressureBarg: 6.5 }
  ],
  'CS_300': [
    { tempC: -29, maxPressureBarg: 51.1 },
    { tempC: 38, maxPressureBarg: 51.1 },
    { tempC: 100, maxPressureBarg: 46.6 },
    { tempC: 200, maxPressureBarg: 43.8 },
    { tempC: 300, maxPressureBarg: 39.8 },
    { tempC: 400, maxPressureBarg: 34.7 }
  ],
  'CS_600': [
    { tempC: -29, maxPressureBarg: 102.1 },
    { tempC: 38, maxPressureBarg: 102.1 },
    { tempC: 100, maxPressureBarg: 93.2 },
    { tempC: 200, maxPressureBarg: 87.6 },
    { tempC: 300, maxPressureBarg: 79.7 },
    { tempC: 400, maxPressureBarg: 69.4 }
  ],
  // Group 2.2: 316L Stainless Steel
  'SS316L_150': [
    { tempC: -196, maxPressureBarg: 15.9 },
    { tempC: 38, maxPressureBarg: 15.9 },
    { tempC: 100, maxPressureBarg: 13.3 },
    { tempC: 200, maxPressureBarg: 11.2 },
    { tempC: 300, maxPressureBarg: 10.0 }
  ],
  'SS316L_600': [
    { tempC: -196, maxPressureBarg: 82.7 },
    { tempC: 38, maxPressureBarg: 82.7 },
    { tempC: 100, maxPressureBarg: 69.6 },
    { tempC: 200, maxPressureBarg: 58.3 },
    { tempC: 300, maxPressureBarg: 52.1 }
  ],
  // Group 2.8: Duplex 2205 (UNS S31803)
  'DUPLEX_600': [
    { tempC: -50, maxPressureBarg: 153.2 },
    { tempC: 38, maxPressureBarg: 153.2 },
    { tempC: 100, maxPressureBarg: 136.6 },
    { tempC: 200, maxPressureBarg: 119.4 },
    { tempC: 250, maxPressureBarg: 114.7 }
  ],
  // Group 2.8: Super Duplex 2507 (UNS S32750)
  'SUPER_DUPLEX_900': [
    { tempC: -50, maxPressureBarg: 229.8 },
    { tempC: 38, maxPressureBarg: 229.8 },
    { tempC: 100, maxPressureBarg: 204.9 },
    { tempC: 200, maxPressureBarg: 179.1 },
    { tempC: 250, maxPressureBarg: 172.0 }
  ],
  // Group 3.4: Monel 400 (UNS N04400)
  'MONEL_150': [
    { tempC: -196, maxPressureBarg: 15.9 },
    { tempC: 38, maxPressureBarg: 15.9 },
    { tempC: 100, maxPressureBarg: 13.4 },
    { tempC: 200, maxPressureBarg: 11.7 },
    { tempC: 300, maxPressureBarg: 11.0 },
    { tempC: 400, maxPressureBarg: 9.8 }
  ],
  // HDPE PE100 SDR 11 Stub End with Backing Flange
  'HDPE_150': [
    { tempC: -40, maxPressureBarg: 16.0 },
    { tempC: 20, maxPressureBarg: 16.0 },
    { tempC: 30, maxPressureBarg: 13.9 },
    { tempC: 40, maxPressureBarg: 11.8 },
    { tempC: 45, maxPressureBarg: 9.9 }
  ]
};

class PipingMaterialClassSpec {
  /**
   * Retrieve a piping material specification by class code.
   * @param {string} classCode - e.g. 'A1A', 'B2L', 'C9S', 'D6N'
   * @returns {Object} Complete piping class specification
   */
  static getClassSpec(classCode) {
    const code = (classCode || '').trim().toUpperCase();
    const spec = PIPING_MATERIAL_CLASSES[code];
    if (!spec) {
      throw new Error(`Piping class "${classCode}" not found in PMS catalog. Available: ${Object.keys(PIPING_MATERIAL_CLASSES).join(', ')}`);
    }
    return spec;
  }

  /**
   * Determine the appropriate branch connection fitting type per standard piping class branch table.
   *
   * @param {number|string} headerNps - Nominal pipe size of header in inches (e.g. 24, 12, 6, 2)
   * @param {number|string} branchNps - Nominal pipe size of branch in inches (e.g. 24, 6, 2, 0.75)
   * @param {string} [classCode='A1A'] - Piping class code
   * @returns {{fittingCode: string, fittingType: string, description: string}}
   */
  static getBranchConnection(headerNps, branchNps, classCode = 'A1A') {
    const hNum = parseFloat(headerNps);
    const bNum = parseFloat(branchNps);
    if (isNaN(hNum) || isNaN(bNum) || hNum <= 0 || bNum <= 0) {
      throw new Error('Header and branch NPS must be positive numbers.');
    }
    if (bNum > hNum) {
      throw new Error(`Branch NPS (${branchNps}") cannot exceed header NPS (${headerNps}").`);
    }

    const spec = this.getClassSpec(classCode);
    const isSocketWeldClass = bNum <= 1.5 && (spec.ratingClass >= 600 || spec.materialGroup.includes('CS'));

    // Rule 1: Header == Branch -> Equal Tee
    if (Math.abs(hNum - bNum) < 1e-4) {
      return {
        fittingCode: 'TE',
        fittingType: 'Equal Tee',
        description: `Straight Equal Tee per ASME B16.9 (${headerNps}" x ${branchNps}")`
      };
    }

    // Rule 2: Large branch on medium/large header -> Reducing Tee
    // Generally reducing tee is standard when branch is within 1 to 3 sizes below header
    const sizeRatio = bNum / hNum;
    if (hNum <= 24.0 && sizeRatio >= 0.5 && bNum >= 2.0) {
      return {
        fittingCode: 'TR',
        fittingType: 'Reducing Tee',
        description: `Factory Reducing Tee per ASME B16.9 (${headerNps}" x ${branchNps}")`
      };
    }

    // Rule 3: Small bore branch (NPS <= 2") on larger header (NPS >= 3")
    if (bNum <= 2.0 && hNum >= 3.0) {
      if (isSocketWeldClass && bNum <= 1.5) {
        return {
          fittingCode: 'SOL',
          fittingType: 'Sockolet',
          description: `Integrally Reinforced Socket-Weld Branch Outlet 3000#/6000# per MSS-SP-97 (${headerNps}" x ${branchNps}")`
        };
      }
      return {
        fittingCode: 'WOL',
        fittingType: 'Weldolet',
        description: `Integrally Reinforced Butt-Weld Branch Outlet per MSS-SP-97 (${headerNps}" x ${branchNps}")`
      };
    }

    // Rule 4: Very large header with intermediate branch (e.g. 36" x 12") -> Weldolet or Tee+Reducer
    if (hNum >= 16.0 && sizeRatio < 0.5) {
      return {
        fittingCode: 'WOL',
        fittingType: 'Weldolet',
        description: `MSS-SP-97 Weldolet Outlet on Run Pipe (${headerNps}" x ${branchNps}")`
      };
    }

    // Default: Reducing Tee or Tee + Reducer
    return {
      fittingCode: 'TR',
      fittingType: 'Reducing Tee',
      description: `Reducing Tee per ASME B16.9 (${headerNps}" x ${branchNps}")`
    };
  }

  /**
   * NACE MR0175 / ISO 15156 Sour Service Compliance & Materials Evaluation.
   *
   * @param {Object} conditions
   * @param {string} conditions.classCode - e.g. 'A1A', 'D6N', 'E8S', 'C1S'
   * @param {number} conditions.h2sPartialPressureKPa - H2S partial pressure in kPa
   * @param {number} conditions.totalPressureBarg - Total process pressure in barg
   * @param {number} conditions.operatingTempC - Operating temperature in °C
   * @param {number} conditions.ph - In-situ water phase pH
   * @param {number} [conditions.chloridePpm=500] - Dissolved chloride concentration (ppm)
   * @returns {Object} Sour service evaluation verdict, regions, hardness limits, and notes
   */
  static evaluateNaceMr0175(conditions) {
    const {
      classCode,
      h2sPartialPressureKPa,
      totalPressureBarg,
      operatingTempC,
      ph,
      chloridePpm = 500
    } = conditions;

    const spec = this.getClassSpec(classCode);
    const warnings = [];
    let isAcceptable = true;

    // Check if sour service threshold is triggered per NACE MR0175 / ISO 15156 Part 2 Fig 1:
    // Sour service applies if H2S partial pressure >= 0.3 kPa (approx 0.05 psia).
    const isSourProcess = h2sPartialPressureKPa >= 0.3;

    let sourRegion = '0 (Non-Sour)';
    if (isSourProcess) {
      if (h2sPartialPressureKPa < 1.0 || (ph >= 6.5 && h2sPartialPressureKPa < 10.0)) {
        sourRegion = 'Region 1 (Slightly Sour)';
      } else if (ph >= 5.5 || h2sPartialPressureKPa < 10.0) {
        sourRegion = 'Region 2 (Moderately Sour)';
      } else {
        sourRegion = 'Region 3 (Severely Sour)';
      }
    }

    // Material-specific evaluations under NACE MR0175
    let maxHardnessHrc = 22;
    let pwhtRequired = false;

    if (isSourProcess) {
      if (spec.materialGroup === 'Carbon Steel' || spec.materialGroup === 'LTCS') {
        if (!spec.isSourService) {
          isAcceptable = false;
          warnings.push(`Piping class ${spec.classCode} is not designated for sour service. Carbon steel requires HRC <= 22 (250 HV) and HIC testing.`);
        }
        maxHardnessHrc = 22;
        pwhtRequired = true;
      } else if (spec.materialGroup.includes('Austenitic SS')) {
        // NACE MR0175 Part 3: 316L in sour service is prone to stress corrosion cracking (SCC) if T > 60 °C with chlorides
        maxHardnessHrc = 22;
        if (operatingTempC > 60.0 && chloridePpm > 1000) {
          isAcceptable = false;
          warnings.push(`Austenitic SS 316L exceeds NACE MR0175 limit for sour service (T > 60 °C with chlorides > 1000 ppm). Risk of chloride stress cracking.`);
        }
        if (h2sPartialPressureKPa > 100.0) {
          warnings.push('High H2S partial pressure exceeds common 316L environmental limits; duplex or nickel alloy recommended.');
        }
      } else if (spec.materialGroup.includes('Duplex 2205')) {
        // NACE MR0175 Part 3 Table A.24
        maxHardnessHrc = 28;
        if (h2sPartialPressureKPa > 20.0 && operatingTempC > 232.0) {
          isAcceptable = false;
          warnings.push('Duplex 2205 exceeds NACE MR0175 temperature limit (232 °C) or H2S partial pressure limit (20 kPa).');
        }
      } else if (spec.materialGroup.includes('Super Duplex 2507')) {
        maxHardnessHrc = 32;
        if (h2sPartialPressureKPa > 30.0 && operatingTempC > 232.0) {
          warnings.push('Super Duplex near upper NACE threshold.');
        }
      } else if (spec.materialGroup.includes('Monel')) {
        maxHardnessHrc = 35;
      }

      // Bolting check
      if (spec.bolting.includes('B7 ') && !spec.bolting.includes('B7M')) {
        isAcceptable = false;
        warnings.push(`Standard B7 bolting has hardness up to 35 HRC, violating NACE MR0175. B7M bolting (HRC <= 22) is required.`);
      }
    }

    return {
      classCode: spec.classCode,
      materialGroup: spec.materialGroup,
      isSourProcess,
      sourRegion,
      h2sPartialPressureKPa,
      operatingTempC,
      ph,
      maxHardnessHrc,
      pwhtRequired,
      boltingSpecified: spec.bolting,
      isAcceptable,
      warnings
    };
  }

  /**
   * Calculate maximum allowable working pressure (MAWP) for the piping class at operating temperature.
   *
   * @param {string} classCode
   * @param {number} tempC
   * @returns {{classCode: string, ratingClass: number, tempC: number, mawpBarg: number}}
   */
  static getFlangePressureRating(classCode, tempC) {
    const spec = this.getClassSpec(classCode);
    let ratingKey = 'CS_150';

    if (spec.materialGroup === 'Carbon Steel' || spec.materialGroup === 'LTCS') {
      if (spec.ratingClass === 150) ratingKey = 'CS_150';
      else if (spec.ratingClass === 300) ratingKey = 'CS_300';
      else if (spec.ratingClass === 600) ratingKey = 'CS_600';
    } else if (spec.materialGroup.includes('Austenitic SS')) {
      ratingKey = spec.ratingClass === 150 ? 'SS316L_150' : 'SS316L_600';
    } else if (spec.materialGroup.includes('Duplex 2205')) {
      ratingKey = 'DUPLEX_600';
    } else if (spec.materialGroup.includes('Super Duplex')) {
      ratingKey = 'SUPER_DUPLEX_900';
    } else if (spec.materialGroup.includes('Monel')) {
      ratingKey = 'MONEL_150';
    } else if (spec.materialGroup.includes('HDPE')) {
      ratingKey = 'HDPE_150';
    }

    const table = ASME_B16_5_RATINGS[ratingKey] || ASME_B16_5_RATINGS['CS_150'];
    let p = table[0].maxPressureBarg;

    if (tempC <= table[0].tempC) {
      p = table[0].maxPressureBarg;
    } else if (tempC >= table[table.length - 1].tempC) {
      p = table[table.length - 1].maxPressureBarg;
    } else {
      for (let i = 0; i < table.length - 1; i++) {
        if (tempC >= table[i].tempC && tempC <= table[i + 1].tempC) {
          const frac = (tempC - table[i].tempC) / (table[i + 1].tempC - table[i].tempC);
          p = table[i].maxPressureBarg + frac * (table[i + 1].maxPressureBarg - table[i].maxPressureBarg);
          break;
        }
      }
    }

    return {
      classCode: spec.classCode,
      ratingClass: spec.ratingClass,
      tempC,
      mawpBarg: Number(p.toFixed(2))
    };
  }
}

module.exports = {
  PipingMaterialClassSpec,
  PIPING_MATERIAL_CLASSES,
  ASME_B16_5_RATINGS
};
