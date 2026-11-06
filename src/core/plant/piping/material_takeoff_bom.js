/**
 * Material Takeoff (MTO) & Bill of Materials (BOM) Aggregation Engine.
 * Industrial piping fabrication and bulk materials estimator for LNG, Petrochemical & Offsite Utilities.
 *
 * Implements:
 * 1. Bulk materials grouping and aggregation:
 *    - Pipe spools (length by class, NPS, schedule, material, steel weight).
 *    - Butt-weld & socket-weld fittings (Elbows, Tees, Reducers, Caps, Weldolets per ASME B16.9 / MSS-SP-97).
 *    - Flanges (Weld Neck WN, Slip-On SO, Blind, RTJ/RF per ASME B16.5 / B16.47).
 *    - Stud bolts & heavy hex nuts (bolt diameter, length, set count per ASME B16.5 Table 1B).
 *    - Gaskets (Spiral wound, Kammprofile, RTJ rings per ASME B16.20).
 *    - Inline valves (Gate, Globe, Check, Ball, Butterfly, Control, PSV).
 * 2. Fabrication & Field Weld Count + Diameter-Inch (Dia-Inch) Calculation:
 *    - Butt welds (1.0 x NPS dia-inch).
 *    - Socket welds (1.5 x NPS dia-inch).
 *    - Branch outlets / Olets (1.25 x branch NPS dia-inch).
 *    - Shop vs Field weld breakdown for construction man-hour estimation.
 * 3. Total steel tonnage estimation and export to structured JSON & CSV formats.
 */

'use strict';

// claims:evidence:ASME-B16.5-ASME-B36.10M-CII-Piping-Dia-Inch

/**
 * ASME B16.5 Table 1B Standard Flange Stud Bolt Sizing & Quantities
 */
const ASME_B16_5_BOLTING_CATALOG = {
  // Class 150
  '150': {
    '0.5': { count: 4, boltDiaInch: '1/2', boltLengthMm: 65 },
    '0.75': { count: 4, boltDiaInch: '1/2', boltLengthMm: 70 },
    '1': { count: 4, boltDiaInch: '1/2', boltLengthMm: 70 },
    '1.5': { count: 4, boltDiaInch: '1/2', boltLengthMm: 75 },
    '2': { count: 4, boltDiaInch: '5/8', boltLengthMm: 85 },
    '3': { count: 4, boltDiaInch: '5/8', boltLengthMm: 90 },
    '4': { count: 8, boltDiaInch: '5/8', boltLengthMm: 90 },
    '6': { count: 8, boltDiaInch: '3/4', boltLengthMm: 100 },
    '8': { count: 8, boltDiaInch: '3/4', boltLengthMm: 110 },
    '10': { count: 12, boltDiaInch: '7/8', boltLengthMm: 115 },
    '12': { count: 12, boltDiaInch: '7/8', boltLengthMm: 120 },
    '14': { count: 12, boltDiaInch: '1', boltLengthMm: 135 },
    '16': { count: 16, boltDiaInch: '1', boltLengthMm: 135 },
    '18': { count: 16, boltDiaInch: '1-1/8', boltLengthMm: 145 },
    '20': { count: 20, boltDiaInch: '1-1/8', boltLengthMm: 160 },
    '24': { count: 20, boltDiaInch: '1-1/4', boltLengthMm: 175 }
  },
  // Class 300
  '300': {
    '0.5': { count: 4, boltDiaInch: '1/2', boltLengthMm: 70 },
    '0.75': { count: 4, boltDiaInch: '5/8', boltLengthMm: 75 },
    '1': { count: 4, boltDiaInch: '5/8', boltLengthMm: 75 },
    '1.5': { count: 4, boltDiaInch: '3/4', boltLengthMm: 90 },
    '2': { count: 8, boltDiaInch: '5/8', boltLengthMm: 90 },
    '3': { count: 8, boltDiaInch: '3/4', boltLengthMm: 110 },
    '4': { count: 8, boltDiaInch: '3/4', boltLengthMm: 115 },
    '6': { count: 12, boltDiaInch: '3/4', boltLengthMm: 125 },
    '8': { count: 12, boltDiaInch: '7/8', boltLengthMm: 145 },
    '10': { count: 16, boltDiaInch: '1', boltLengthMm: 165 },
    '12': { count: 16, boltDiaInch: '1-1/8', boltLengthMm: 175 },
    '14': { count: 20, boltDiaInch: '1-1/8', boltLengthMm: 190 },
    '16': { count: 20, boltDiaInch: '1-1/4', boltLengthMm: 205 },
    '20': { count: 24, boltDiaInch: '1-1/4', boltLengthMm: 220 },
    '24': { count: 24, boltDiaInch: '1-1/2', boltLengthMm: 255 }
  },
  // Class 600
  '600': {
    '0.5': { count: 4, boltDiaInch: '1/2', boltLengthMm: 75 },
    '0.75': { count: 4, boltDiaInch: '5/8', boltLengthMm: 90 },
    '1': { count: 4, boltDiaInch: '5/8', boltLengthMm: 90 },
    '1.5': { count: 4, boltDiaInch: '3/4', boltLengthMm: 110 },
    '2': { count: 8, boltDiaInch: '5/8', boltLengthMm: 110 },
    '3': { count: 8, boltDiaInch: '3/4', boltLengthMm: 125 },
    '4': { count: 8, boltDiaInch: '7/8', boltLengthMm: 145 },
    '6': { count: 12, boltDiaInch: '1', boltLengthMm: 170 },
    '8': { count: 12, boltDiaInch: '1-1/8', boltLengthMm: 200 },
    '10': { count: 16, boltDiaInch: '1-1/4', boltLengthMm: 215 },
    '12': { count: 20, boltDiaInch: '1-1/4', boltLengthMm: 225 },
    '16': { count: 20, boltDiaInch: '1-1/2', boltLengthMm: 260 },
    '20': { count: 24, boltDiaInch: '1-5/8', boltLengthMm: 290 },
    '24': { count: 24, boltDiaInch: '1-7/8', boltLengthMm: 335 }
  },
  // Class 900
  '900': {
    '0.5': { count: 4, boltDiaInch: '3/4', boltLengthMm: 110 },
    '0.75': { count: 4, boltDiaInch: '3/4', boltLengthMm: 115 },
    '1': { count: 4, boltDiaInch: '7/8', boltLengthMm: 125 },
    '1.5': { count: 4, boltDiaInch: '1', boltLengthMm: 140 },
    '2': { count: 8, boltDiaInch: '7/8', boltLengthMm: 145 },
    '3': { count: 8, boltDiaInch: '7/8', boltLengthMm: 145 },
    '4': { count: 8, boltDiaInch: '1-1/8', boltLengthMm: 170 },
    '6': { count: 12, boltDiaInch: '1-1/8', boltLengthMm: 190 },
    '8': { count: 12, boltDiaInch: '1-3/8', boltLengthMm: 220 },
    '10': { count: 16, boltDiaInch: '1-3/8', boltLengthMm: 235 },
    '12': { count: 20, boltDiaInch: '1-3/8', boltLengthMm: 255 },
    '14': { count: 20, boltDiaInch: '1-1/2', boltLengthMm: 275 },
    '16': { count: 20, boltDiaInch: '1-5/8', boltLengthMm: 290 },
    '18': { count: 20, boltDiaInch: '1-7/8', boltLengthMm: 335 },
    '20': { count: 20, boltDiaInch: '2', boltLengthMm: 350 },
    '24': { count: 20, boltDiaInch: '2-1/2', boltLengthMm: 440 }
  },
  // Class 1500
  '1500': {
    '0.5': { count: 4, boltDiaInch: '3/4', boltLengthMm: 110 },
    '0.75': { count: 4, boltDiaInch: '3/4', boltLengthMm: 115 },
    '1': { count: 4, boltDiaInch: '7/8', boltLengthMm: 125 },
    '1.5': { count: 4, boltDiaInch: '1', boltLengthMm: 140 },
    '2': { count: 8, boltDiaInch: '7/8', boltLengthMm: 145 },
    '3': { count: 8, boltDiaInch: '1-1/8', boltLengthMm: 175 },
    '4': { count: 8, boltDiaInch: '1-1/4', boltLengthMm: 195 },
    '6': { count: 12, boltDiaInch: '1-3/8', boltLengthMm: 260 },
    '8': { count: 12, boltDiaInch: '1-5/8', boltLengthMm: 295 },
    '10': { count: 12, boltDiaInch: '1-7/8', boltLengthMm: 340 },
    '12': { count: 16, boltDiaInch: '2', boltLengthMm: 375 },
    '14': { count: 16, boltDiaInch: '2-1/4', boltLengthMm: 405 },
    '16': { count: 16, boltDiaInch: '2-1/2', boltLengthMm: 450 },
    '20': { count: 16, boltDiaInch: '3', boltLengthMm: 540 },
    '24': { count: 16, boltDiaInch: '3-1/2', boltLengthMm: 615 }
  },
  // Class 2500
  '2500': {
    '0.5': { count: 4, boltDiaInch: '3/4', boltLengthMm: 120 },
    '0.75': { count: 4, boltDiaInch: '3/4', boltLengthMm: 125 },
    '1': { count: 4, boltDiaInch: '7/8', boltLengthMm: 140 },
    '1.5': { count: 4, boltDiaInch: '1-1/8', boltLengthMm: 170 },
    '2': { count: 8, boltDiaInch: '1', boltLengthMm: 175 },
    '3': { count: 8, boltDiaInch: '1-1/4', boltLengthMm: 225 },
    '4': { count: 8, boltDiaInch: '1-1/2', boltLengthMm: 255 },
    '6': { count: 8, boltDiaInch: '2', boltLengthMm: 345 },
    '8': { count: 12, boltDiaInch: '2', boltLengthMm: 380 },
    '10': { count: 12, boltDiaInch: '2-1/2', boltLengthMm: 490 },
    '12': { count: 12, boltDiaInch: '2-3/4', boltLengthMm: 540 }
  }
};

/**
 * Standard ASME B36.10M / B36.19M Nominal Pipe Unit Weight [kg/m]
 */
const NOMINAL_PIPE_WEIGHT_KGM = {
  '0.5_Sch 40': 1.27, '0.5_Sch 80': 1.62, '0.5_Sch 40S': 1.27,
  '0.75_Sch 40': 1.69, '0.75_Sch 80': 2.20, '0.75_Sch 40S': 1.69,
  '1_Sch 40': 2.50, '1_Sch 80': 3.24, '1_Sch 40S': 2.50,
  '1.5_Sch 40': 4.05, '1.5_Sch 80': 5.41, '1.5_Sch 40S': 4.05,
  '2_Sch 40': 5.44, '2_Sch 80': 7.48, '2_Sch 40S': 5.44, '2_Sch 10S': 2.50,
  '3_Sch 40': 11.29, '3_Sch 80': 15.27, '3_Sch 40S': 11.29, '3_Sch 10S': 5.30,
  '4_Sch 40': 16.07, '4_Sch 80': 22.32, '4_Sch 40S': 16.07, '4_Sch 10S': 7.53,
  '6_Sch 40': 28.26, '6_Sch 80': 42.56, '6_Sch 40S': 28.26, '6_Sch 10S': 13.40,
  '8_Sch 40': 42.53, '8_Sch 80': 64.64, '8_Sch 40S': 42.53, '8_Sch 10S': 21.35,
  '10_Sch 40': 60.31, '10_Sch 80': 95.98, '10_Sch 40S': 60.31, '10_Sch STD': 60.31,
  '12_Sch 40': 73.84, '12_Sch 80': 132.08, '12_Sch STD': 73.84,
  '14_Sch 40': 94.55, '14_Sch 80': 160.27, '14_Sch STD': 81.33,
  '16_Sch 40': 123.30, '16_Sch 80': 207.22, '16_Sch STD': 93.27,
  '18_Sch 40': 155.80, '18_Sch 80': 262.59, '18_Sch STD': 105.16,
  '20_Sch 40': 191.81, '20_Sch 80': 324.79, '20_Sch STD': 117.15,
  '24_Sch 40': 270.21, '24_Sch 80': 466.82, '24_Sch STD': 141.12
};

class MaterialTakeoffBom {
  /**
   * Aggregate a list of raw piping components into a structured Material Takeoff (MTO) and BOM.
   *
   * @param {Array<Object>} components - Array of raw piping component objects
   * @param {Object} [options]
   * @param {number} [options.shopWeldRatio=0.65] - Expected ratio of shop-fabricated welds (0.0 to 1.0)
   * @returns {Object} Grouped MTO summary, dia-inch counts, fasteners, and steel weights
   */
  static generateMto(components, options = {}) {
    const shopWeldRatio = options.shopWeldRatio !== undefined ? options.shopWeldRatio : 0.65;

    const pipeGroups = new Map();
    const fittingGroups = new Map();
    const flangeGroups = new Map();
    const valveGroups = new Map();
    const fastenerGroups = new Map();
    const gasketGroups = new Map();

    let totalButtWeldDiaInch = 0.0;
    let totalSocketWeldDiaInch = 0.0;
    let totalWeldCount = 0;
    let totalPipeLengthM = 0.0;
    let totalSteelWeightKg = 0.0;

    for (const comp of components) {
      const type = (comp.type || 'PIPE').toUpperCase();
      const nps = String(comp.nps || '2');
      const npsNum = parseFloat(nps) || 2.0;
      const pipingClass = comp.pipingClass || 'A1A';
      const material = comp.material || 'A106-B';
      const schedule = comp.schedule || 'Sch 40';
      const rating = String(comp.rating || comp.ratingClass || '150');

      if (type === 'PIPE') {
        const lengthM = parseFloat(comp.lengthM || comp.length || 0);
        const key = `${pipingClass}__${nps}__${schedule}__${material}`;
        totalPipeLengthM += lengthM;

        const weightKey = `${nps}_${schedule}`;
        const unitWeight = NOMINAL_PIPE_WEIGHT_KGM[weightKey] || (npsNum * 2.5);
        const segmentWeightKg = lengthM * unitWeight;
        totalSteelWeightKg += segmentWeightKg;

        if (!pipeGroups.has(key)) {
          pipeGroups.set(key, {
            itemType: 'PIPE',
            pipingClass,
            nps,
            schedule,
            material,
            totalLengthM: 0,
            unitWeightKgM: Number(unitWeight.toFixed(2)),
            totalWeightKg: 0
          });
        }
        const record = pipeGroups.get(key);
        record.totalLengthM += lengthM;
        record.totalWeightKg += segmentWeightKg;
      } else if (type.includes('ELBOW') || type.includes('TEE') || type.includes('REDUCER') || type.includes('CAP') || type.includes('OLET')) {
        const subType = comp.subType || type;
        const count = parseInt(comp.count || comp.qty || 1, 10);
        const key = `${subType}__${nps}__${schedule}__${material}`;

        // Weight estimation based on equivalent pipe length
        const equivLengthM = (type.includes('TEE') ? 2.5 : 1.5) * (npsNum * 0.0254);
        const weightKey = `${nps}_${schedule}`;
        const unitWeight = NOMINAL_PIPE_WEIGHT_KGM[weightKey] || (npsNum * 2.5);
        const estFittingWeightKg = equivLengthM * unitWeight * count;
        totalSteelWeightKg += estFittingWeightKg;

        if (!fittingGroups.has(key)) {
          fittingGroups.set(key, {
            itemType: 'FITTING',
            fittingType: subType,
            nps,
            schedule,
            material,
            quantity: 0,
            totalWeightKg: 0
          });
        }
        const record = fittingGroups.get(key);
        record.quantity += count;
        record.totalWeightKg += estFittingWeightKg;

        // Butt welds for fittings: elbows have 2 ends, tees have 3 ends, reducers have 2 ends
        let ends = 2;
        if (subType.includes('TEE')) ends = 3;
        else if (subType.includes('CAP') || subType.includes('OLET')) ends = 1;

        if (npsNum > 2.0) {
          totalButtWeldDiaInch += ends * count * npsNum * 1.0;
        } else {
          totalSocketWeldDiaInch += ends * count * npsNum * 1.5;
        }
        totalWeldCount += ends * count;
      } else if (type.includes('FLANGE')) {
        const flangeType = comp.flangeType || comp.subType || 'Weld Neck (WN)';
        const count = parseInt(comp.count || comp.qty || 1, 10);
        const facing = comp.facing || 'RF';
        const key = `${flangeType}__${nps}__${rating}#_${facing}__${material}`;

        const estFlangeWeightKg = npsNum * 2.2 * (parseInt(rating, 10) / 150) * count;
        totalSteelWeightKg += estFlangeWeightKg;

        if (!flangeGroups.has(key)) {
          flangeGroups.set(key, {
            itemType: 'FLANGE',
            flangeType,
            nps,
            ratingClass: `${rating}#`,
            facing,
            material,
            quantity: 0,
            totalWeightKg: 0
          });
        }
        flangeGroups.get(key).quantity += count;
        flangeGroups.get(key).totalWeightKg += estFlangeWeightKg;

        // Welds for flanges:
        if (flangeType.includes('WN') || flangeType.includes('Weld Neck')) {
          totalButtWeldDiaInch += count * npsNum * 1.0;
          totalWeldCount += count;
        } else if (flangeType.includes('SO') || flangeType.includes('Slip-On') || flangeType.includes('Slip On')) {
          totalSocketWeldDiaInch += count * npsNum * 2.0;
          totalWeldCount += count * 2;
        } else if (flangeType.includes('SW') || flangeType.includes('Socket Weld')) {
          totalSocketWeldDiaInch += count * npsNum * 1.5;
          totalWeldCount += count;
        }

        // Automatic generation of mating bolting & gaskets
        const boltTable = ASME_B16_5_BOLTING_CATALOG[rating] || ASME_B16_5_BOLTING_CATALOG['150'];
        const boltInfo = boltTable[nps] || { count: 4, boltDiaInch: '5/8', boltLengthMm: 90 };
        const boltKey = `${boltInfo.boltDiaInch}"x${boltInfo.boltLengthMm}mm__${comp.boltMaterial || 'A193-B7'}`;

        if (!fastenerGroups.has(boltKey)) {
          fastenerGroups.set(boltKey, {
            itemType: 'BOLTING',
            ratingClass: `${rating}#`,
            diameterInch: boltInfo.boltDiaInch,
            lengthMm: boltInfo.boltLengthMm,
            material: comp.boltMaterial || 'A193-B7 / A194-2H',
            totalSets: 0
          });
        }
        fastenerGroups.get(boltKey).totalSets += boltInfo.count * count;

        const gasketKey = `${nps}__${rating}#_${comp.gasketType || 'Spiral Wound 316L/Graphite'}`;
        if (!gasketGroups.has(gasketKey)) {
          gasketGroups.set(gasketKey, {
            itemType: 'GASKET',
            nps,
            ratingClass: `${rating}#`,
            gasketType: comp.gasketType || 'Spiral Wound 316L/Graphite',
            thicknessMm: 4.5,
            quantity: 0
          });
        }
        gasketGroups.get(gasketKey).quantity += count;
      } else if (type.includes('VALVE')) {
        const valveType = comp.valveType || comp.subType || 'Ball Valve';
        const tag = comp.tag || `V-${valveGroups.size + 1}`;
        const count = parseInt(comp.count || comp.qty || 1, 10);
        const key = `${valveType}__${nps}__${rating}#_${material}`;

        const estValveWeightKg = comp.weightKg
          ? parseFloat(comp.weightKg) * count
          : npsNum * 4.5 * (parseInt(rating, 10) / 150) * count;
        totalSteelWeightKg += estValveWeightKg;

        if (!valveGroups.has(key)) {
          valveGroups.set(key, {
            itemType: 'VALVE',
            valveType,
            nps,
            ratingClass: `${rating}#`,
            bodyMaterial: material,
            trim: comp.trim || 'Standard',
            quantity: 0,
            totalWeightKg: 0,
            tags: []
          });
        }
        const vRecord = valveGroups.get(key);
        vRecord.quantity += count;
        vRecord.totalWeightKg += estValveWeightKg;
        vRecord.tags.push(tag);
      }
    }

    // Diameter-inch summary
    const totalDiaInch = totalButtWeldDiaInch + totalSocketWeldDiaInch;
    const shopDiaInch = totalDiaInch * shopWeldRatio;
    const fieldDiaInch = totalDiaInch * (1.0 - shopWeldRatio);

    // Convert groups to plain arrays and round numeric figures
    const pipeList = Array.from(pipeGroups.values()).map(p => ({
      ...p,
      totalLengthM: Number(p.totalLengthM.toFixed(2)),
      totalWeightKg: Number(p.totalWeightKg.toFixed(1))
    }));

    const fittingList = Array.from(fittingGroups.values()).map(f => ({
      ...f,
      totalWeightKg: Number(f.totalWeightKg.toFixed(1))
    }));

    const flangeList = Array.from(flangeGroups.values()).map(fl => ({
      ...fl,
      totalWeightKg: Number(fl.totalWeightKg.toFixed(1))
    }));

    const valveList = Array.from(valveGroups.values());
    const fastenerList = Array.from(fastenerGroups.values());
    const gasketList = Array.from(gasketGroups.values());

    return {
      summary: {
        totalPipeLengthM: Number(totalPipeLengthM.toFixed(2)),
        totalSteelWeightKg: Number(totalSteelWeightKg.toFixed(1)),
        totalSteelTonnageMT: Number((totalSteelWeightKg / 1000.0).toFixed(2)),
        totalWeldCount,
        buttWeldDiaInch: Number(totalButtWeldDiaInch.toFixed(1)),
        socketWeldDiaInch: Number(totalSocketWeldDiaInch.toFixed(1)),
        totalDiaInch: Number(totalDiaInch.toFixed(1)),
        shopDiaInch: Number(shopDiaInch.toFixed(1)),
        fieldDiaInch: Number(fieldDiaInch.toFixed(1)),
        pipeItemCount: pipeList.length,
        fittingCount: fittingList.reduce((acc, x) => acc + x.quantity, 0),
        flangeCount: flangeList.reduce((acc, x) => acc + x.quantity, 0),
        valveCount: valveList.reduce((acc, x) => acc + x.quantity, 0),
        boltSetsTotal: fastenerList.reduce((acc, x) => acc + x.totalSets, 0),
        gasketCount: gasketList.reduce((acc, x) => acc + x.quantity, 0)
      },
      pipes: pipeList,
      fittings: fittingList,
      flanges: flangeList,
      valves: valveList,
      fasteners: fastenerList,
      gaskets: gasketList
    };
  }

  /**
   * Export MTO to formatted CSV string for EPC procurement.
   *
   * @param {Object} mtoResult - Output from generateMto()
   * @returns {string} Formatted CSV text
   */
  static exportToCsv(mtoResult) {
    const lines = [];
    lines.push('Category,Description,Size/NPS,Rating/Schedule,Material,Quantity,Unit,Est_Weight_kg');

    // Pipes
    for (const p of mtoResult.pipes) {
      lines.push(`PIPE,Seamless/Welded Pipe,${p.nps}",${p.schedule},${p.material},${p.totalLengthM},M,${p.totalWeightKg}`);
    }

    // Fittings
    for (const f of mtoResult.fittings) {
      lines.push(`FITTING,${f.fittingType},${f.nps}",${f.schedule},${f.material},${f.quantity},EA,${f.totalWeightKg}`);
    }

    // Flanges
    for (const fl of mtoResult.flanges) {
      lines.push(`FLANGE,${fl.flangeType} ${fl.facing},${fl.nps}",${fl.ratingClass},${fl.material},${fl.quantity},EA,${fl.totalWeightKg}`);
    }

    // Valves
    for (const v of mtoResult.valves) {
      lines.push(`VALVE,${v.valveType} (Trim: ${v.trim}),${v.nps}",${v.ratingClass},${v.bodyMaterial},${v.quantity},EA,N/A`);
    }

    // Bolting
    for (const b of mtoResult.fasteners) {
      lines.push(`FASTENER,Stud Bolt with 2 Heavy Hex Nuts,${b.diameterInch}" x ${b.lengthMm}mm,ASME B18.2.1/2,${b.material},${b.totalSets},SETS,N/A`);
    }

    // Gaskets
    for (const g of mtoResult.gaskets) {
      lines.push(`GASKET,${g.gasketType},${g.nps}",${g.ratingClass},ASME B16.20,${g.quantity},EA,N/A`);
    }

    return lines.join('\n');
  }
}

module.exports = {
  MaterialTakeoffBom,
  ASME_B16_5_BOLTING_CATALOG,
  NOMINAL_PIPE_WEIGHT_KGM
};
