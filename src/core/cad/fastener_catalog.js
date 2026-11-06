/**
 * Fastener catalog: standard threaded fastener / hole data.
 *
 * Numeric tables only, no external dependencies.
 *
 * Sources:
 *  - ISO 261 / ISO 262 coarse pitch series (M3..M24).
 *  - ISO 68 basic profile: pitch diameter d2 = d - 0.6495*P;
 *    internal (tapped hole) minor diameter D1 = d - 1.0825*P;
 *    external (screw) minor diameter d3 = d - 1.226869*P.
 *  - ISO 273 clearance holes (fine / medium / coarse).
 *  - ISO 4762 socket head cap screws (head dk, height k, socket s) and
 *    the matching counterbore table (Ø = dk + clearance, depth = k + ~0.5P).
 *  - ANSI/ASME B18.2 / B1.1 inch threads (UNC/UNF) with standard tap drills.
 *  - Thread engagement: recommended minimum engagement length d for steel into
 *    steel, 1.5*d for aluminum, 2*d for cast iron (Machinery's Handbook rule).
 */

'use strict';

const METRIC_COARSE_THREADS = {
  M3: { designation: 'M3', nominalDiameterMm: 3, pitchMm: 0.5 },
  M4: { designation: 'M4', nominalDiameterMm: 4, pitchMm: 0.7 },
  M5: { designation: 'M5', nominalDiameterMm: 5, pitchMm: 0.8 },
  M6: { designation: 'M6', nominalDiameterMm: 6, pitchMm: 1.0 },
  M8: { designation: 'M8', nominalDiameterMm: 8, pitchMm: 1.25 },
  M10: { designation: 'M10', nominalDiameterMm: 10, pitchMm: 1.5 },
  M12: { designation: 'M12', nominalDiameterMm: 12, pitchMm: 1.75 },
  M16: { designation: 'M16', nominalDiameterMm: 16, pitchMm: 2.0 },
  M20: { designation: 'M20', nominalDiameterMm: 20, pitchMm: 2.5 },
  M24: { designation: 'M24', nominalDiameterMm: 24, pitchMm: 3.0 }
};

const SHCS_ISO_4762 = {
  M3: { designation: 'M3', headDiameterMm: 5.5, headHeightMm: 3, socketSizeMm: 2.5 },
  M4: { designation: 'M4', headDiameterMm: 7.0, headHeightMm: 4, socketSizeMm: 3.0 },
  M5: { designation: 'M5', headDiameterMm: 8.5, headHeightMm: 5, socketSizeMm: 4.0 },
  M6: { designation: 'M6', headDiameterMm: 10.0, headHeightMm: 6, socketSizeMm: 5.0 },
  M8: { designation: 'M8', headDiameterMm: 13.0, headHeightMm: 8, socketSizeMm: 6.0 },
  M10: { designation: 'M10', headDiameterMm: 16.0, headHeightMm: 10, socketSizeMm: 8.0 },
  M12: { designation: 'M12', headDiameterMm: 18.0, headHeightMm: 12, socketSizeMm: 10.0 },
  M16: { designation: 'M16', headDiameterMm: 24.0, headHeightMm: 16, socketSizeMm: 14.0 },
  M20: { designation: 'M20', headDiameterMm: 30.0, headHeightMm: 20, socketSizeMm: 17.0 },
  M24: { designation: 'M24', headDiameterMm: 36.0, headHeightMm: 24, socketSizeMm: 19.0 }
};

const CLEARANCE_HOLES_ISO_273 = {
  M3: { fineMm: 3.2, mediumMm: 3.4, coarseMm: 3.6 },
  M4: { fineMm: 4.3, mediumMm: 4.5, coarseMm: 4.8 },
  M5: { fineMm: 5.3, mediumMm: 5.5, coarseMm: 5.8 },
  M6: { fineMm: 6.4, mediumMm: 6.6, coarseMm: 7.0 },
  M8: { fineMm: 8.4, mediumMm: 9.0, coarseMm: 10.0 },
  M10: { fineMm: 10.5, mediumMm: 11.0, coarseMm: 12.0 },
  M12: { fineMm: 13.0, mediumMm: 14.0, coarseMm: 14.5 },
  M16: { fineMm: 17.0, mediumMm: 18.0, coarseMm: 19.0 },
  M20: { fineMm: 21.0, mediumMm: 22.0, coarseMm: 24.0 },
  M24: { fineMm: 25.0, mediumMm: 26.0, coarseMm: 28.0 }
};

const COUNTERBORE_ISO_4762 = {
  M3: { diameterMm: 6.0, depthMm: 3.4 },
  M4: { diameterMm: 7.5, depthMm: 4.6 },
  M5: { diameterMm: 9.0, depthMm: 5.7 },
  M6: { diameterMm: 10.5, depthMm: 6.8 },
  M8: { diameterMm: 13.5, depthMm: 9.0 },
  M10: { diameterMm: 17.0, depthMm: 11.0 },
  M12: { diameterMm: 19.5, depthMm: 13.0 },
  M16: { diameterMm: 25.5, depthMm: 17.0 },
  M20: { diameterMm: 32.0, depthMm: 21.0 },
  M24: { diameterMm: 38.0, depthMm: 25.0 }
};

const ANSI_B18_2_INCH_THREADS = {
  '1/4-20 UNC': {
    designation: '1/4-20 UNC',
    family: 'UNC',
    nominalDiameterInch: 0.25,
    majorDiameterMm: 6.35,
    threadsPerInch: 20,
    pitchMm: 1.27,
    tapDrill: { number: '#7', inch: 0.201, mm: 5.1054 }
  },
  '3/8-16 UNC': {
    designation: '3/8-16 UNC',
    family: 'UNC',
    nominalDiameterInch: 0.375,
    majorDiameterMm: 9.525,
    threadsPerInch: 16,
    pitchMm: 1.5875,
    tapDrill: { number: 'U', inch: 0.368, mm: 9.3472 }
  },
  '1/2-13 UNC': {
    designation: '1/2-13 UNC',
    family: 'UNC',
    nominalDiameterInch: 0.5,
    majorDiameterMm: 12.7,
    threadsPerInch: 13,
    pitchMm: 1.9538461538461538,
    tapDrill: { number: '27/64', inch: 0.421875, mm: 10.715625 }
  },
  '1/4-28 UNF': {
    designation: '1/4-28 UNF',
    family: 'UNF',
    nominalDiameterInch: 0.25,
    majorDiameterMm: 6.35,
    threadsPerInch: 28,
    pitchMm: 0.9071428571428571,
    tapDrill: { number: '#3', inch: 0.213, mm: 5.4102 }
  }
};

const MIN_ENGAGEMENT_FACTORS = {
  steel: 1.0,
  aluminum: 1.5,
  castIron: 2.0
};

const THREAD_PROFILE = {
  pitchDiameterFactor: 0.6495,
  internalMinorDiameterFactor: 1.0825,
  externalMinorDiameterFactor: 1.226869,
  tensileStressAreaFactor: 0.9382
};

function requirePositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
}

function requireMetricSize(size) {
  if (!Object.prototype.hasOwnProperty.call(METRIC_COARSE_THREADS, size)) {
    throw new RangeError(`Unknown metric thread size: ${size}`);
  }
  return size;
}

function requireMaterial(material) {
  if (!Object.prototype.hasOwnProperty.call(MIN_ENGAGEMENT_FACTORS, material)) {
    throw new RangeError(`Unknown material for engagement rule: ${material} (use steel | aluminum | castIron)`);
  }
  return material;
}

function getMetricThread(size) {
  const key = requireMetricSize(size);
  const base = METRIC_COARSE_THREADS[key];
  const { nominalDiameterMm: d, pitchMm: p } = base;
  return {
    ...base,
    pitchDiameterMm: d - THREAD_PROFILE.pitchDiameterFactor * p,
    minorDiameterMm: d - THREAD_PROFILE.internalMinorDiameterFactor * p,
    externalMinorDiameterMm: d - THREAD_PROFILE.externalMinorDiameterFactor * p,
    tapDrillMm: d - p,
    tensileStressAreaMm2: (Math.PI / 4) * (d - THREAD_PROFILE.tensileStressAreaFactor * p) ** 2
  };
}

function getShcs(size) {
  const key = requireMetricSize(size);
  const record = SHCS_ISO_4762[key];
  if (!record) {
    throw new RangeError(`No ISO 4762 SHCS record for size: ${size}`);
  }
  return { ...record, size: key };
}

function clearanceHole(size, series) {
  const key = requireMetricSize(size);
  const record = CLEARANCE_HOLES_ISO_273[key];
  if (!record) {
    throw new RangeError(`No ISO 273 clearance hole for size: ${size}`);
  }
  const seriesKey = series ?? 'medium';
  const diameterField = `${seriesKey}Mm`;
  const diameterMm = record[diameterField];
  if (diameterMm === undefined) {
    throw new RangeError(`Unknown ISO 273 clearance series: ${series}`);
  }
  return { size: key, series: seriesKey, diameterMm };
}

function tapDrillHole(size) {
  const key = requireMetricSize(size);
  const thread = getMetricThread(key);
  return {
    size: key,
    diameterMm: thread.tapDrillMm,
    minorDiameterMm: thread.minorDiameterMm,
    source: 'ISO standard tap drill (d - P, ~75% thread)'
  };
}

function counterboreHole(size) {
  const key = requireMetricSize(size);
  const shcs = getShcs(key);
  const record = COUNTERBORE_ISO_4762[key];
  if (!record) {
    throw new RangeError(`No ISO 4762 counterbore for size: ${size}`);
  }
  return {
    size: key,
    diameterMm: record.diameterMm,
    depthMm: record.depthMm,
    headDiameterMm: shcs.headDiameterMm,
    source: 'ISO 4762 counterbore table (Ø = head + clearance, depth = head + ~0.5P)'
  };
}

function countersinkHole(size) {
  const key = requireMetricSize(size);
  const shcs = getShcs(key);
  const clearance = clearanceHole(key, 'medium');
  const clearanceIncrementMm = clearance.diameterMm - METRIC_COARSE_THREADS[key].nominalDiameterMm;
  const diameterMm = shcs.headDiameterMm + clearanceIncrementMm;
  return {
    size: key,
    diameterMm,
    includedAngleDeg: 90,
    coneDepthMm: diameterMm / 2,
    headDiameterMm: shcs.headDiameterMm,
    source: '90° included angle countersink; Ø = head + medium clearance'
  };
}

function getAnsiInchThread(designation) {
  const record = ANSI_B18_2_INCH_THREADS[designation];
  if (!record) {
    throw new RangeError(`Unknown ANSI inch thread designation: ${designation}`);
  }
  return { ...record };
}

function minimumEngagementMm(sizeOrDiameterMm, material) {
  requireMaterial(material);
  const factor = MIN_ENGAGEMENT_FACTORS[material];
  if (typeof sizeOrDiameterMm === 'number') {
    requirePositiveFinite(sizeOrDiameterMm, 'diameter');
    return { engagementMm: sizeOrDiameterMm * factor, factor, material };
  }
  const thread = getMetricThread(sizeOrDiameterMm);
  return {
    engagementMm: thread.nominalDiameterMm * factor,
    factor,
    material,
    size: thread.designation
  };
}

function geometricMinimumEngagementMm(size) {
  const thread = getMetricThread(size);
  const { nominalDiameterMm: d, tensileStressAreaMm2: at } = thread;
  const leMinMm = (2 * at) / (Math.PI * d * 0.5);
  return { size: thread.designation, leMinMm, tensileStressAreaMm2: at };
}

function checkThreadEngagement(sizeOrDiameterMm, engagementMm, material) {
  const rule = minimumEngagementMm(sizeOrDiameterMm, material ?? 'steel');
  requirePositiveFinite(engagementMm, 'engagement length');
  return {
    ok: engagementMm >= rule.engagementMm,
    engagementMm,
    recommendedMm: rule.engagementMm,
    factor: rule.factor,
    material: rule.material,
    size: rule.size ?? null,
    rule: `minimum engagement = d * ${rule.factor} (${rule.material}: steel 1.0d, ` + 'aluminum 1.5d, cast iron 2.0d)'
  };
}

function threadCatalogSnapshot() {
  const snapshots = [];
  for (const size of Object.keys(METRIC_COARSE_THREADS)) {
    snapshots.push(getMetricThread(size));
  }
  return snapshots;
}

function verifyCatalogIntegrity() {
  let previousNominalMm = 0;
  let previousHeadMm = 0;
  let previousTapDrillMm = 0;
  let previousPitchMm = 0;
  for (const thread of threadCatalogSnapshot()) {
    for (const value of [
      thread.nominalDiameterMm,
      thread.pitchMm,
      thread.pitchDiameterMm,
      thread.minorDiameterMm,
      thread.externalMinorDiameterMm,
      thread.tapDrillMm,
      thread.tensileStressAreaMm2
    ]) {
      if (!Number.isFinite(value) || value <= 0) {
        return { ok: false, reason: `non-finite value in ${thread.designation}` };
      }
    }
    const shcs = getShcs(thread.designation);
    for (const value of [shcs.headDiameterMm, shcs.headHeightMm, shcs.socketSizeMm]) {
      if (!Number.isFinite(value) || value <= 0) {
        return { ok: false, reason: `non-finite SHCS value in ${thread.designation}` };
      }
    }
    const counterbore = counterboreHole(thread.designation);
    if (
      counterbore.diameterMm <= shcs.headDiameterMm ||
      !Number.isFinite(counterbore.depthMm) ||
      counterbore.depthMm <= 0
    ) {
      return { ok: false, reason: `bad counterbore for ${thread.designation}` };
    }
    if (thread.nominalDiameterMm <= previousNominalMm || thread.pitchMm <= previousPitchMm) {
      return { ok: false, reason: `non-monotonic thread data for ${thread.designation}` };
    }
    if (shcs.headDiameterMm <= previousHeadMm || thread.tapDrillMm <= previousTapDrillMm) {
      return { ok: false, reason: `non-monotonic head/tap-drill for ${thread.designation}` };
    }
    previousNominalMm = thread.nominalDiameterMm;
    previousHeadMm = shcs.headDiameterMm;
    previousTapDrillMm = thread.tapDrillMm;
    previousPitchMm = thread.pitchMm;
  }
  for (const designation of Object.keys(ANSI_B18_2_INCH_THREADS)) {
    const inch = getAnsiInchThread(designation);
    if (
      !Number.isFinite(inch.majorDiameterMm) ||
      !Number.isFinite(inch.threadsPerInch) ||
      !Number.isFinite(inch.tapDrill.inch) ||
      !Number.isFinite(inch.tapDrill.mm)
    ) {
      return { ok: false, reason: `non-finite ANSI data for ${designation}` };
    }
  }
  return { ok: true };
}

module.exports = {
  METRIC_COARSE_THREADS,
  SHCS_ISO_4762,
  CLEARANCE_HOLES_ISO_273,
  COUNTERBORE_ISO_4762,
  ANSI_B18_2_INCH_THREADS,
  MIN_ENGAGEMENT_FACTORS,
  THREAD_PROFILE,
  getMetricThread,
  getShcs,
  getAnsiInchThread,
  clearanceHole,
  tapDrillHole,
  counterboreHole,
  countersinkHole,
  minimumEngagementMm,
  geometricMinimumEngagementMm,
  checkThreadEngagement,
  threadCatalogSnapshot,
  verifyCatalogIntegrity
};
