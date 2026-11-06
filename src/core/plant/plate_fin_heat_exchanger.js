/**
 * OmniEng Brazed-Aluminum Plate-Fin Heat Exchanger (LNG Cold Box) Rating Engine
 *
 * Model scope:
 *  - Multi-stream (N hot/cold) plate-fin core rating. Geometry inputs: core
 *    width / height / length, fin type (serrated or plain), fin density,
 *    fin thickness, plate gap, and layer count per stream.
 *  - Per-stream free-flow areas, hydraulic diameters, wetted surface areas,
 *    heat-transfer coefficients (j-factor correlations), friction factors and
 *    pressure drops.
 *  - Two operating modes:
 *      1. "verification" (t-point rating): every stream outlet temperature is
 *         specified; the engine checks enthalpy closure, computes the balanced
 *         duty distribution, and runs the composite-curve gate
 *         (minimum approach temperature, no-cross check).
 *      2. "rating-solved-ntu": outlet temperatures are solved from geometry
 *         and inlet conditions via the counter-flow epsilon-NTU method
 *         (two-stream case).
 *  - Composite-curve engine (Linnhoff-style problem-table construction):
 *    builds the composite hot/cold temperature-enthalpy curves and returns the
 *    minimum approach temperature, a temperature-cross flag, and the balanced
 *    heat duty.
 *
 * Correlations (engineering standard, deterministic, no external state):
 *  - Serrated (offset-strip) fins:
 *        j = 0.163 * Re^-0.482 ;  f = 0.136 * Re^-0.198
 *  - Plain rectangular fins:
 *        j = 0.664 * Re^-0.5 (laminar),  j = 0.037 * Re^-0.2 (turbulent)
 *        f = 16/Re (laminar),  f = 0.079 * Re^-0.25 (Blasius)
 *  - Heat transfer:  h = j * G * cp * Pr^(-2/3)
 *  - Pressure drop:  dP = f * (L/Dh) * G^2 / (2*rho)
 */

'use strict';

const EPS = 1e-12;

const GAUSS_LEGENDRE_8 = [
  { x: -0.9602898564975363, w: 0.1012285362903763 },
  { x: -0.7966664774136267, w: 0.2223810344533745 },
  { x: -0.525532409916329, w: 0.3137066458778873 },
  { x: -0.1834346424956498, w: 0.362683783378362 },
  { x: 0.1834346424956498, w: 0.362683783378362 },
  { x: 0.525532409916329, w: 0.3137066458778873 },
  { x: 0.7966664774136267, w: 0.2223810344533745 },
  { x: 0.9602898564975363, w: 0.1012285362903763 }
];

const SERRATED_J_A = 0.163;
const SERRATED_J_B = -0.482;
const SERRATED_F_A = 0.136;
const SERRATED_F_B = -0.198;
const PLAIN_J_LAM = 0.664;
const PLAIN_J_TURB_A = 0.037;
const PLAIN_J_TURB_B = -0.2;
const PLAIN_F_LAM = 16;
const PLAIN_F_TURB_A = 0.079;
const PLAIN_F_TURB_B = -0.25;

const DEFAULT_FLUID_PROPS = {
  methaneGas: {
    cp: { a: 2050, b: 2.8, Tref: 200 },
    viscosity: { a: 8e-6, b: 4e-8, Tref: 200 },
    conductivity: { a: 0.026, b: 1.2e-4, Tref: 200 },
    densityModel: 'idealGas',
    molecularWeight: 0.01604,
    pressurePa: 5e6
  },
  lng: {
    cp: { a: 3100, b: 4.0, Tref: 120 },
    viscosity: { a: 1.5e-4, b: -3e-7, Tref: 120 },
    conductivity: { a: 0.185, b: 0, Tref: 120 },
    densityKgM3: 425
  }
};

function linearPropertyValue(model, T) {
  return model.a + model.b * (T - model.Tref);
}

function propertyValue(stream, key, T, fluidDef) {
  const p = stream.props ? stream.props[key] : undefined;
  if (typeof p === 'function') return p(T);
  if (p && typeof p === 'object' && typeof p.a === 'number') return linearPropertyValue(p, T);
  if (typeof p === 'number') return p;
  if (fluidDef && fluidDef[key] !== undefined) {
    if (typeof fluidDef[key] === 'function') return fluidDef[key](T);
    if (typeof fluidDef[key] === 'object') return linearPropertyValue(fluidDef[key], T);
    return fluidDef[key];
  }
  throw new Error(`PlateFin: property "${key}" missing for stream "${stream.name}"`);
}

function densityAt(stream, T, fluidDef) {
  if (stream.props && typeof stream.props.densityKgM3 === 'number') return stream.props.densityKgM3;
  if (stream.props && typeof stream.props.densityKgM3 === 'function') return stream.props.densityKgM3(T);
  if (fluidDef) {
    if (typeof fluidDef.densityKgM3 === 'number') return fluidDef.densityKgM3;
    if (fluidDef.densityModel === 'idealGas') {
      return (fluidDef.pressurePa * fluidDef.molecularWeight) / (8.314462618 * T);
    }
  }
  throw new Error(`PlateFin: density missing for stream "${stream.name}"`);
}

function makeCpFn(stream, fluidDef) {
  const p = stream.props ? stream.props.cp : undefined;
  if (typeof p === 'function') return p;
  if (p && typeof p === 'object' && typeof p.a === 'number') return (T) => linearPropertyValue(p, T);
  if (typeof p === 'number') return () => p;
  if (fluidDef && fluidDef.cp !== undefined) {
    if (typeof fluidDef.cp === 'function') return fluidDef.cp;
    return (T) => linearPropertyValue(fluidDef.cp, T);
  }
  throw new Error(`PlateFin: cp missing for stream "${stream.name}"`);
}

function quadrature(fn, a, b) {
  const mid = 0.5 * (a + b);
  const half = 0.5 * (b - a);
  let sum = 0;
  for (let i = 0; i < GAUSS_LEGENDRE_8.length; i++) {
    sum += GAUSS_LEGENDRE_8[i].w * fn(mid + half * GAUSS_LEGENDRE_8[i].x);
  }
  return half * sum;
}

function enthalpyIntegral(stream, T1, T2, fluidDef) {
  if (Math.abs(T2 - T1) <= EPS) return 0;
  const cp = makeCpFn(stream, fluidDef);
  if (T2 > T1) return quadrature(cp, T1, T2);
  return -quadrature(cp, T2, T1);
}

function fluidDefFor(stream) {
  return stream.fluid ? DEFAULT_FLUID_PROPS[stream.fluid] || null : null;
}

class PlateFinHeatExchanger {
  static buildGeometry(geometry, layersTotal) {
    const W = Number(geometry.coreWidthM);
    const L = Number(geometry.coreLengthM);
    const bIn = Number(geometry.plateGapM);
    const beta = Number(geometry.finDensityPerM);
    const tf = Number(geometry.finThicknessM !== undefined ? geometry.finThicknessM : 0.0002);
    const finType = String(geometry.finType || 'serrated').toLowerCase();
    if (!(finType === 'serrated' || finType === 'plain')) {
      throw new Error(`PlateFin: unknown finType "${finType}"`);
    }
    let b = bIn;
    if (layersTotal > 0 && geometry.coreHeightM && Number(geometry.coreHeightM) > 0) {
      const bFit = Number(geometry.coreHeightM) / layersTotal;
      if (Math.abs(bFit - b) > 1e-4 * Math.max(b, 1e-9)) {
        b = bFit;
      }
    }
    const s = 1 / beta;
    const ts = Math.max(s - tf, 1e-9);
    const dh = (2 * b * ts) / (b + ts);
    const fracOpen = Math.max(1 - tf * beta, 0.05);
    const gamma = 1 + b * beta;
    return { W, L, b, beta, tf, finType, s, ts, dh, fracOpen, gamma, layersTotal };
  }

  static streamLayerCount(stream, index, geometry, nStreams) {
    if (stream.layers) return Math.max(1, Math.floor(Number(stream.layers)));
    if (geometry.layerCountPerStream && geometry.layerCountPerStream[stream.name] !== undefined) {
      return Math.max(1, Math.floor(Number(geometry.layerCountPerStream[stream.name])));
    }
    return 10;
  }

  static streamRatingConstants(stream, geom, Tmean) {
    const fluidDef = fluidDefFor(stream);
    const cp = makeCpFn(stream, fluidDef);
    const cpMean = cp(Tmean);
    const mu = propertyValue(stream, 'viscosity', Tmean, fluidDef);
    const k = propertyValue(stream, 'conductivity', Tmean, fluidDef);
    const rho = densityAt(stream, Tmean, fluidDef);
    const aff = stream.layers * geom.W * geom.b * geom.fracOpen;
    const G = stream.massFlowKgS / Math.max(aff, EPS);
    const Re = (G * geom.dh) / Math.max(mu, EPS);
    const Pr = (mu * cpMean) / Math.max(k, EPS);
    let j;
    let f;
    if (geom.finType === 'serrated') {
      j = SERRATED_J_A * Math.pow(Re, SERRATED_J_B);
      f = SERRATED_F_A * Math.pow(Re, SERRATED_F_B);
    } else if (Re < 2300) {
      j = PLAIN_J_LAM * Math.pow(Re, -0.5);
      f = PLAIN_F_LAM / Math.max(Re, EPS);
    } else {
      j = PLAIN_J_TURB_A * Math.pow(Re, PLAIN_J_TURB_B);
      f = PLAIN_F_TURB_A * Math.pow(Re, PLAIN_F_TURB_B);
    }
    const h = j * G * cpMean * Math.pow(Math.max(Pr, EPS), -2 / 3);
    const dP = (f * (geom.L / geom.dh) * (G * G)) / (2 * Math.max(rho, EPS));
    const A_s = stream.layers * 2 * geom.W * geom.L * geom.gamma;
    const V = G / Math.max(rho, EPS);
    return { cp, cpMean, mu, k, rho, A_ff: aff, G, Re, Pr, j, f, h, dP, A_s, V };
  }

  static buildLayerSequence(streams) {
    const remain = streams.map((s) => s.layers);
    const seq = [];
    let active = streams.length;
    while (active > 0) {
      active = 0;
      for (let i = 0; i < streams.length; i++) {
        if (remain[i] > 0) {
          seq.push(i);
          remain[i]--;
          if (remain[i] > 0) active++;
        }
      }
    }
    return seq;
  }

  static enumerateInterfaces(seq) {
    const faces = [];
    for (let i = 1; i < seq.length; i++) {
      if (seq[i - 1] !== seq[i]) faces.push([seq[i - 1], seq[i]]);
    }
    return faces;
  }

  static totalUA(streams, geom, constants) {
    const seq = PlateFinHeatExchanger.buildLayerSequence(streams);
    const faces = PlateFinHeatExchanger.enumerateInterfaces(seq);
    const A_face = geom.W * geom.L * geom.gamma;
    let UA = 0;
    for (let i = 0; i < faces.length; i++) {
      const a = faces[i][0];
      const b = faces[i][1];
      UA += A_face / (1 / Math.max(constants[a].h, EPS) + 1 / Math.max(constants[b].h, EPS));
    }
    return { UA, faces, A_face };
  }

  static buildCompositeCurves(streams, opts) {
    const deltaTMinK = opts && opts.deltaTMinK !== undefined ? opts.deltaTMinK : 1.5;
    let Tmin = Infinity;
    let Tmax = -Infinity;
    for (const s of streams) {
      Tmin = Math.min(Tmin, s.TinK, s.ToutK);
      Tmax = Math.max(Tmax, s.TinK, s.ToutK);
    }
    const step = 0.25;
    const steps = Math.ceil((Tmax - Tmin) / step);
    const grid = [];
    for (let i = 0; i <= steps; i++) grid.push(Tmin + i * step);
    const Hhot = new Array(grid.length).fill(0);
    const Hcold = new Array(grid.length).fill(0);
    let hotLoad = 0;
    let coldLoad = 0;
    for (const s of streams) {
      const fd = fluidDefFor(s);
      const lo = Math.min(s.TinK, s.ToutK);
      const hi = Math.max(s.TinK, s.ToutK);
      const Htot = Math.abs(enthalpyIntegral(s, lo, hi, fd));
      const m = Math.abs(s.massFlowKgS);
      if (Htot <= EPS) continue;
      let prevT = lo;
      let H = 0;
      const arr = s.type === 'hot' ? Hhot : Hcold;
      for (let i = 0; i < grid.length; i++) {
        const T = grid[i];
        if (T > lo + EPS && T <= hi + 1e-9) {
          H += enthalpyIntegral(s, prevT, T, fd);
          prevT = T;
        }
        arr[i] += m * H;
      }
      if (s.type === 'hot') hotLoad += m * Htot;
      else coldLoad += m * Htot;
    }
    const fracHot = [];
    const THot = [];
    const fracCold = [];
    const TCold = [];
    for (let i = grid.length - 1; i >= 0; i--) {
      if (Hhot[i] > EPS) {
        fracHot.push((hotLoad - Hhot[i]) / hotLoad);
        THot.push(grid[i]);
      }
    }
    for (let i = 0; i < grid.length; i++) {
      if (Hcold[i] > EPS) {
        fracCold.push(Hcold[i] / coldLoad);
        TCold.push(grid[i]);
      }
    }
    const interp = (fracArr, TArr, f) => {
      let lo = 0;
      let hi = fracArr.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (fracArr[mid] <= f) lo = mid;
        else hi = mid;
      }
      const f0 = fracArr[lo];
      const f1 = fracArr[hi];
      const t0 = TArr[lo];
      const t1 = TArr[hi];
      if (f1 - f0 <= EPS) return t0;
      return t0 + ((f - f0) * (t1 - t0)) / (f1 - f0);
    };
    let minDeltaT = Infinity;
    const N = 400;
    for (let i = 1; i < N; i++) {
      const f = i / N;
      const th = interp(fracHot, THot, f);
      const tc = interp(fracCold, TCold, f);
      minDeltaT = Math.min(minDeltaT, th - tc);
    }
    const crossed = minDeltaT < -1e-6;
    const constraintMet = minDeltaT >= deltaTMinK - 1e-9;
    return {
      hot: { frac: fracHot, TK: THot, loadW: hotLoad },
      cold: { frac: fracCold, TK: TCold, loadW: coldLoad },
      minDeltaT_K: minDeltaT,
      crossed,
      constraintMet,
      deltaTMinK
    };
  }

  rate(streams, geometry, options) {
    const opts = options || {};
    const deltaTMinK = opts.deltaTMinK !== undefined ? Number(opts.deltaTMinK) : 1.5;
    const strict = opts.strictDeltaTMin !== false;
    if (!Array.isArray(streams) || streams.length < 2) {
      throw new Error('PlateFin: at least two streams required');
    }
    const resolved = streams.map((s, i) => {
      const type = String(s.type || '').toLowerCase();
      if (type !== 'hot' && type !== 'cold') throw new Error(`PlateFin: stream type must be hot/cold (stream ${i})`);
      const layers = PlateFinHeatExchanger.streamLayerCount(s, i, geometry, streams.length);
      return {
        name: s.name || `stream${i + 1}`,
        type,
        massFlowKgS: Number(s.massFlowKgS),
        TinK: Number(s.TinK),
        ToutK: s.ToutK !== undefined ? Number(s.ToutK) : null,
        layers,
        fluid: s.fluid || null,
        props: s.props || null
      };
    });
    const layersTotal = resolved.reduce((a, s) => a + s.layers, 0);
    const geom = PlateFinHeatExchanger.buildGeometry(geometry, layersTotal);
    const allSpecified = resolved.every((s) => s.ToutK !== null);
    const nhot = resolved.filter((s) => s.type === 'hot').length;
    const ncold = resolved.filter((s) => s.type === 'cold').length;

    let mode;
    let dutyW;
    let closureRelative = 0;
    let solved = null;

    if (allSpecified) {
      mode = 'verification';
      let Qh = 0;
      let Qc = 0;
      for (const s of resolved) {
        const fd = fluidDefFor(s);
        s.dutyW = Math.abs(s.massFlowKgS) * Math.abs(enthalpyIntegral(s, s.TinK, s.ToutK, fd));
        if (s.type === 'hot') Qh += s.dutyW;
        else Qc += s.dutyW;
      }
      closureRelative = Math.abs(Qh - Qc) / Math.max(Qh, Qc, EPS);
      dutyW = Math.min(Qh, Qc);
    } else if (nhot === 1 && ncold === 1) {
      mode = 'rating-solved-ntu';
      const hot = resolved.find((s) => s.type === 'hot');
      const cold = resolved.find((s) => s.type === 'cold');
      let ThOut = hot.TinK;
      let TcOut = cold.TinK;
      let Q = 0;
      let UA = 0;
      let eps = 0;
      let NTU = 0;
      let Cr = 0;
      for (let iter = 0; iter < 8; iter++) {
        const Tmh = 0.5 * (hot.TinK + ThOut);
        const Tmc = 0.5 * (cold.TinK + TcOut);
        const ch = PlateFinHeatExchanger.streamRatingConstants(hot, geom, Tmh);
        const cc = PlateFinHeatExchanger.streamRatingConstants(cold, geom, Tmc);
        const uaRes = PlateFinHeatExchanger.totalUA([hot, cold], geom, [ch, cc]);
        UA = uaRes.UA;
        const Ch = hot.massFlowKgS * ch.cpMean;
        const Cc = cold.massFlowKgS * cc.cpMean;
        const Cmin = Math.min(Ch, Cc);
        const Cmax = Math.max(Ch, Cc);
        Cr = Cmin / Math.max(Cmax, EPS);
        NTU = UA / Math.max(Cmin, EPS);
        if (Math.abs(Cr - 1) < 1e-9) {
          eps = NTU / (1 + NTU);
        } else {
          const expTerm = Math.exp(-NTU * (1 - Cr));
          eps = (1 - expTerm) / (1 - Cr * expTerm);
        }
        const Qmax = Cmin * (hot.TinK - cold.TinK);
        Q = eps * Qmax;
        ThOut = hot.TinK - Q / Math.max(Ch, EPS);
        TcOut = cold.TinK + Q / Math.max(Cc, EPS);
      }
      hot.ToutK = ThOut;
      cold.ToutK = TcOut;
      dutyW = Q;
      closureRelative = 0;
      solved = { ntU: NTU, effectiveness: eps, capacityRatio: Cr };
    } else {
      throw new Error(
        'PlateFin: multi-stream solved-outlet rating not supported; specify ToutK for every stream (verification mode).'
      );
    }

    const constants = resolved.map((s) => {
      const Tm = 0.5 * (s.TinK + s.ToutK);
      return PlateFinHeatExchanger.streamRatingConstants(s, geom, Tm);
    });
    const uaTotal = PlateFinHeatExchanger.totalUA(resolved, geom, constants);

    const composite = PlateFinHeatExchanger.buildCompositeCurves(resolved, { deltaTMinK });
    composite.balancedDutyW = dutyW;
    composite.hotLoadW = composite.hot.loadW;
    composite.coldLoadW = composite.cold.loadW;

    const hotList = resolved.filter((s) => s.type === 'hot');
    const coldList = resolved.filter((s) => s.type === 'cold');
    let physMin = Infinity;
    for (let i = 0; i < hotList.length; i++) {
      for (let j = 0; j < coldList.length; j++) {
        physMin = Math.min(physMin, hotList[i].ToutK - coldList[j].TinK, hotList[i].TinK - coldList[j].ToutK);
      }
    }
    composite.minDeltaTPhysicalK = physMin;

    if (strict) {
      if (!(physMin >= deltaTMinK - 1e-9)) {
        throw new Error(`PlateFin gate: physical min approach ${physMin.toFixed(3)} K < specified ${deltaTMinK} K`);
      }
    }

    const streamResults = resolved.map((s, i) => {
      const fd = fluidDefFor(s);
      const duty =
        s.dutyW !== undefined ? s.dutyW : Math.abs(s.massFlowKgS) * Math.abs(enthalpyIntegral(s, s.TinK, s.ToutK, fd));
      return {
        name: s.name,
        type: s.type,
        TinK: s.TinK,
        ToutK: s.ToutK,
        massFlowKgS: s.massFlowKgS,
        layers: s.layers,
        dutyW: duty,
        h_Wm2K: constants[i].h,
        jFactor: constants[i].j,
        reynoldsNumber: constants[i].Re,
        prandtl: constants[i].Pr,
        pressureDropPa: constants[i].dP,
        velocityMS: constants[i].V,
        freeFlowAreaM2: constants[i].A_ff,
        hydraulicDiameterM: geom.dh,
        surfaceAreaM2: constants[i].A_s
      };
    });

    return {
      mode,
      balancedDutyW: dutyW,
      closureRelative,
      totalUAK: uaTotal.UA,
      interfaceCount: uaTotal.faces.length,
      geometry: geom,
      composite,
      solved,
      streams: streamResults
    };
  }
}

module.exports = {
  PlateFinHeatExchanger,
  DEFAULT_FLUID_PROPS,
  enthalpyIntegral,
  quadrature
};
