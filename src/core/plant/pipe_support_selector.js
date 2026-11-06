/**
 * src/core/plant/pipe_support_selector.js
 *
 * Pipe support / spring hanger selection for pumped and gravity piping runs:
 *   1. Variable-effort spring hanger selection: given hot load F_hot (kN),
 *      cold load F_cold (kN) and thermal vertical travel Δ (mm), select from a
 *      representative standard catalog (12 sizes) a hanger whose working load
 *      range brackets both loads and whose travel capacity ≥ Δ. The load
 *      variation ratio (load fluctuation) is (F_cold − F_hot)/F_hot and is
 *      flagged when it exceeds the typical 25% limit.
 *   2. Constant-effort hanger selection: for high variation ratios (>25%),
 *      select a constant-support hanger size rated for F_hot within its range.
 *   3. Support spacing check: for a pipe size (NPS, schedule, material) compute
 *      the maximum support spacing per simple-span beam bending:
 *            L_max = sqrt(8·Z·S / w)
 *      where Z = section modulus, S = allowable bending stress, w = weight per
 *      unit length including pipe metal + insulation + fluid.
 *
 * Dependency-free, deterministic (pure functions, fixed catalogs).
 */

'use strict';

/**
 * Representative variable-effort spring hanger catalog (12 standard sizes,
 * modelled on typical industrial variable spring hanger series, e.g.
 * Grinnell / Carpenter & Paterson style units). Load range in kN, travel
 * capacity in mm.
 */
const VARIABLE_SPRING_HANGER_CATALOG = [
  { size: 'VS-01', loadMin_kN: 0.3, loadMax_kN: 1.6, travelCapacity_mm: 32 },
  { size: 'VS-02', loadMin_kN: 1.4, loadMax_kN: 3.2, travelCapacity_mm: 45 },
  { size: 'VS-03', loadMin_kN: 3.0, loadMax_kN: 5.4, travelCapacity_mm: 60 },
  { size: 'VS-04', loadMin_kN: 5.2, loadMax_kN: 8.6, travelCapacity_mm: 75 },
  { size: 'VS-05', loadMin_kN: 7.8, loadMax_kN: 11.8, travelCapacity_mm: 90 },
  { size: 'VS-06', loadMin_kN: 11.6, loadMax_kN: 17.0, travelCapacity_mm: 110 },
  { size: 'VS-07', loadMin_kN: 16.8, loadMax_kN: 23.6, travelCapacity_mm: 130 },
  { size: 'VS-08', loadMin_kN: 23.4, loadMax_kN: 31.8, travelCapacity_mm: 150 },
  { size: 'VS-09', loadMin_kN: 31.6, loadMax_kN: 44.2, travelCapacity_mm: 180 },
  { size: 'VS-10', loadMin_kN: 44.0, loadMax_kN: 60.6, travelCapacity_mm: 210 },
  { size: 'VS-11', loadMin_kN: 60.4, loadMax_kN: 83.2, travelCapacity_mm: 250 },
  { size: 'VS-12', loadMin_kN: 83.0, loadMax_kN: 118.0, travelCapacity_mm: 300 }
];

/**
 * Representative constant-effort (constant support) hanger catalog, 10 sizes.
 */
const CONSTANT_EFFORT_HANGER_CATALOG = [
  { size: 'CS-01', loadMin_kN: 0.5, loadMax_kN: 1.6, travelCapacity_mm: 51 },
  { size: 'CS-02', loadMin_kN: 1.5, loadMax_kN: 3.2, travelCapacity_mm: 51 },
  { size: 'CS-03', loadMin_kN: 3.1, loadMax_kN: 5.2, travelCapacity_mm: 76 },
  { size: 'CS-04', loadMin_kN: 5.1, loadMax_kN: 8.0, travelCapacity_mm: 76 },
  { size: 'CS-05', loadMin_kN: 7.9, loadMax_kN: 12.0, travelCapacity_mm: 102 },
  { size: 'CS-06', loadMin_kN: 11.9, loadMax_kN: 18.2, travelCapacity_mm: 127 },
  { size: 'CS-07', loadMin_kN: 18.1, loadMax_kN: 26.4, travelCapacity_mm: 152 },
  { size: 'CS-08', loadMin_kN: 26.3, loadMax_kN: 38.4, travelCapacity_mm: 203 },
  { size: 'CS-09', loadMin_kN: 38.3, loadMax_kN: 55.6, travelCapacity_mm: 254 },
  { size: 'CS-10', loadMin_kN: 55.5, loadMax_kN: 80.8, travelCapacity_mm: 305 }
];

/** ASME B36.10M pipe dimensions (mm) for common NPS, schedule 40. */
const PIPE_DIMENSIONS_MM = {
  2: { outsideDiameter_mm: 60.3, schedule40Wall_mm: 3.91 },
  3: { outsideDiameter_mm: 88.9, schedule40Wall_mm: 5.49 },
  4: { outsideDiameter_mm: 114.3, schedule40Wall_mm: 6.02 },
  6: { outsideDiameter_mm: 168.3, schedule40Wall_mm: 7.11 },
  8: { outsideDiameter_mm: 219.1, schedule40Wall_mm: 8.18 },
  10: { outsideDiameter_mm: 273.1, schedule40Wall_mm: 9.27 },
  12: { outsideDiameter_mm: 323.9, schedule40Wall_mm: 10.31 },
  16: { outsideDiameter_mm: 406.4, schedule40Wall_mm: 12.7 },
  20: { outsideDiameter_mm: 508.0, schedule40Wall_mm: 15.09 },
  24: { outsideDiameter_mm: 609.6, schedule40Wall_mm: 17.48 }
};

/** Material densities (kg/m³). */
const MATERIAL_DENSITY_KG_M3 = {
  carbonSteel: 7850,
  stainlessSteel: 7950
};

const DEFAULT_LOAD_VARIATION_LIMIT = 0.25;

function round(x, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/**
 * Load variation ratio (load fluctuation) as a fraction:
 * (F_cold − F_hot)/F_hot.
 */
function loadVariationRatio(hotLoadKN, coldLoadKN) {
  if (!Number.isFinite(hotLoadKN) || hotLoadKN <= 0) {
    throw new Error(`Invalid hot load: ${hotLoadKN}`);
  }
  if (!Number.isFinite(coldLoadKN) || coldLoadKN <= 0) {
    throw new Error(`Invalid cold load: ${coldLoadKN}`);
  }
  return (coldLoadKN - hotLoadKN) / hotLoadKN;
}

function validateTravel(travelMm) {
  if (!Number.isFinite(travelMm) || travelMm < 0) {
    throw new Error(`Invalid travel: ${travelMm}`);
  }
}

/** Catalog entries whose working range brackets both hot and cold loads. */
function bracketingVariableCandidates(hotLoadKN, coldLoadKN) {
  const lo = Math.min(hotLoadKN, coldLoadKN);
  const hi = Math.max(hotLoadKN, coldLoadKN);
  return VARIABLE_SPRING_HANGER_CATALOG.filter((h) => h.loadMin_kN <= lo && h.loadMax_kN >= hi);
}

/**
 * Select a variable-effort spring hanger:
 *   - working range brackets both hot and cold loads
 *   - travel capacity ≥ required travel
 * Among candidates the most economical (smallest loadMax, then earliest) is
 * chosen. Returns the selection plus load variation metrics.
 */
function selectVariableSpringHanger(hotLoadKN, coldLoadKN, travelMm) {
  const variation = loadVariationRatio(hotLoadKN, coldLoadKN);
  validateTravel(travelMm);
  const candidates = bracketingVariableCandidates(hotLoadKN, coldLoadKN).filter((h) => h.travelCapacity_mm >= travelMm);

  if (candidates.length === 0) {
    throw new Error(
      'No variable spring hanger brackets the load range with adequate travel ' +
        `capacity (hot=${hotLoadKN} kN, cold=${coldLoadKN} kN, travel=${travelMm} mm).`
    );
  }

  candidates.sort((a, b) => a.loadMax_kN - b.loadMax_kN || a.size.localeCompare(b.size));
  const hanger = candidates[0];
  const flagged = variation > DEFAULT_LOAD_VARIATION_LIMIT;

  return {
    type: 'variable',
    flagged,
    hanger,
    loadVariationRatio: variation,
    loadVariationPct: round(variation * 100, 2),
    loadVariationLimit: DEFAULT_LOAD_VARIATION_LIMIT,
    variationLimitPct: DEFAULT_LOAD_VARIATION_LIMIT * 100,
    hotLoadKN,
    coldLoadKN,
    travelMm,
    candidatesConsidered: candidates.length,
    rationale: flagged
      ? `Load variation ${round(variation * 100, 2)}% exceeds 25% limit; use constant-effort hanger`
      : `Load variation ${round(variation * 100, 2)}% within 25% limit`
  };
}

/**
 * Select a constant-effort hanger rated for F_hot (hot load) within its range,
 * with travel capacity covering Δ. Deterministic: smallest loadMax that covers
 * F_hot.
 */
function selectConstantEffortHanger(hotLoadKN, coldLoadKN, travelMm) {
  const variation = loadVariationRatio(hotLoadKN, coldLoadKN);
  validateTravel(travelMm);
  const candidates = CONSTANT_EFFORT_HANGER_CATALOG.filter(
    (h) => h.loadMin_kN <= hotLoadKN && h.loadMax_kN >= hotLoadKN && h.travelCapacity_mm >= travelMm
  );

  if (candidates.length === 0) {
    throw new Error(
      'No constant-effort hanger rated for hot load ' + `${hotLoadKN} kN with travel capacity ≥ ${travelMm} mm.`
    );
  }

  candidates.sort((a, b) => a.loadMax_kN - b.loadMax_kN || a.size.localeCompare(b.size));
  const hanger = candidates[0];

  return {
    type: 'constant',
    flagged: variation > DEFAULT_LOAD_VARIATION_LIMIT,
    hanger,
    loadVariationRatio: variation,
    loadVariationPct: round(variation * 100, 2),
    hotLoadKN,
    travelMm,
    candidatesConsidered: candidates.length
  };
}

/**
 * End-to-end selection: variable hanger when load variation ≤ 25%; otherwise
 * falls back to a constant-effort hanger (and reports the variable result for
 * diagnosis).
 */
function selectPipeSupport(hotLoadKN, coldLoadKN, travelMm) {
  const variable = selectVariableSpringHanger(hotLoadKN, coldLoadKN, travelMm);
  if (!variable.flagged) {
    return variable;
  }
  const constant = selectConstantEffortHanger(hotLoadKN, coldLoadKN, travelMm);
  return { ...constant, variableSelection: variable, fallback: true };
}

/**
 * Weight per unit length of pipe, N/mm: pipe metal + fluid + insulation.
 * All masses converted with g = 9.81 m/s².
 */
function weightPerLength_N_per_mm(opts) {
  const nps = String(opts.nps);
  const schedule = opts.schedule || '40';
  const dim = PIPE_DIMENSIONS_MM[nps];
  if (!dim) {
    throw new Error(`Pipe NPS ${nps} not in dimension table.`);
  }
  const wall = schedule === '40' ? dim.schedule40Wall_mm : opts.wallThickness_mm;
  if (!Number.isFinite(wall) || wall <= 0) {
    throw new Error(`Unknown schedule ${schedule} for NPS ${nps}.`);
  }

  const od = dim.outsideDiameter_mm;
  const id = od - 2 * wall;
  const materialDensity = opts.materialDensity || MATERIAL_DENSITY_KG_M3.carbonSteel;
  const fluidDensity = opts.fluidDensity !== undefined ? opts.fluidDensity : 1000;
  const insulationDensity = opts.insulationDensity !== undefined ? opts.insulationDensity : 150;
  const insulationThickness = opts.insulationThickness !== undefined ? opts.insulationThickness : 50;
  const g = opts.gravity !== undefined ? opts.gravity : 9.81;

  const pipeArea_mm2 = (Math.PI / 4) * (od * od - id * id);
  const fluidArea_mm2 = (Math.PI / 4) * id * id;
  const insulationArea_mm2 =
    insulationThickness > 0
      ? (Math.PI / 4) * ((od + 2 * insulationThickness) * (od + 2 * insulationThickness) - od * od)
      : 0;

  const massPerMeter_kg_m = {
    pipe: (pipeArea_mm2 / 1e6) * materialDensity,
    fluid: (fluidArea_mm2 / 1e6) * fluidDensity,
    insulation: (insulationArea_mm2 / 1e6) * insulationDensity
  };

  const totalKgM = massPerMeter_kg_m.pipe + massPerMeter_kg_m.fluid + massPerMeter_kg_m.insulation;
  return {
    total_N_per_mm: (totalKgM * g) / 1000,
    total_kg_per_m: totalKgM,
    breakdown_kg_per_m: massPerMeter_kg_m,
    pipeArea_mm2,
    fluidArea_mm2,
    insulationArea_mm2,
    insideDiameter_mm: id,
    wallThickness_mm: wall
  };
}

/** Section modulus Z (mm³) for a hollow cylinder: Z = π/32·(DO⁴−DI⁴)/DO. */
function sectionModulus_mm3(outsideDiameter_mm, insideDiameter_mm) {
  const do4 = Math.pow(outsideDiameter_mm, 4);
  const di4 = Math.pow(insideDiameter_mm, 4);
  return ((Math.PI / 32) * (do4 - di4)) / outsideDiameter_mm;
}

/**
 * Maximum support spacing (mm) per simple-span beam bending:
 * L_max = sqrt(8·Z·S/w), with Z in mm³, S in N/mm² (MPa), w in N/mm.
 */
function maximumSupportSpacing(opts) {
  const nps = String(opts.nps);
  const schedule = opts.schedule || '40';
  const dim = PIPE_DIMENSIONS_MM[nps];
  if (!dim) {
    throw new Error(`Pipe NPS ${nps} not in dimension table.`);
  }
  const wall = schedule === '40' ? dim.schedule40Wall_mm : opts.wallThickness_mm;
  if (!Number.isFinite(wall) || wall <= 0) {
    throw new Error(`Unknown schedule ${schedule} for NPS ${nps}.`);
  }
  const od = dim.outsideDiameter_mm;
  const id = od - 2 * wall;
  const z = sectionModulus_mm3(od, id);
  const s = opts.allowableBendingStress_MPa !== undefined ? opts.allowableBendingStress_MPa : 120;

  const wResult = weightPerLength_N_per_mm({
    nps,
    schedule,
    wallThickness_mm: wall,
    materialDensity: opts.materialDensity,
    fluidDensity: opts.fluidDensity,
    insulationDensity: opts.insulationDensity,
    insulationThickness: opts.insulationThickness,
    gravity: opts.gravity
  });

  const w = wResult.total_N_per_mm;
  const lMax_mm = Math.sqrt((8 * z * s) / w);

  return {
    nps,
    schedule,
    lMax_mm,
    lMax_m: lMax_mm / 1000,
    sectionModulus_mm3: z,
    allowableBendingStress_MPa: s,
    weightPerLength_N_per_mm: w,
    weight: wResult
  };
}

module.exports = {
  selectPipeSupport,
  selectVariableSpringHanger,
  selectConstantEffortHanger,
  maximumSupportSpacing,
  weightPerLength_N_per_mm,
  sectionModulus_mm3,
  loadVariationRatio,
  DEFAULT_LOAD_VARIATION_LIMIT,
  VARIABLE_SPRING_HANGER_CATALOG,
  CONSTANT_EFFORT_HANGER_CATALOG,
  PIPE_DIMENSIONS_MM,
  MATERIAL_DENSITY_KG_M3
};
