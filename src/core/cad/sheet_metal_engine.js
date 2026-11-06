'use strict';

const DIN6935_K_FACTORS = Object.freeze([
  Object.freeze({ rOverT: 0.5, k: 0.38 }),
  Object.freeze({ rOverT: 1.0, k: 0.33 }),
  Object.freeze({ rOverT: 2.0, k: 0.3 })
]);

const RELIEF_TYPES = Object.freeze(['none', 'rectangular', 'tear', 'round']);

function degToRad(deg) {
  return (deg * Math.PI) / 180.0;
}

function kFactorFromRatio(rOverT) {
  const ratio = Math.max(0, rOverT);
  const first = DIN6935_K_FACTORS[0];
  const last = DIN6935_K_FACTORS[DIN6935_K_FACTORS.length - 1];
  if (ratio <= first.rOverT) {
    return first.k;
  }
  if (ratio >= last.rOverT) {
    return last.k;
  }
  for (let i = 1; i < DIN6935_K_FACTORS.length; i++) {
    const hi = DIN6935_K_FACTORS[i];
    const lo = DIN6935_K_FACTORS[i - 1];
    if (ratio <= hi.rOverT) {
      const f = (ratio - lo.rOverT) / (hi.rOverT - lo.rOverT);
      return lo.k + f * (hi.k - lo.k);
    }
  }
  return last.k;
}

class SheetMetalBend {
  constructor(spec = {}) {
    this.angleDeg = spec.angleDeg !== undefined ? spec.angleDeg : 90.0;
    this.innerRadiusMm = spec.innerRadiusMm !== undefined ? spec.innerRadiusMm : 2.0;
    this.thicknessMm = spec.thicknessMm !== undefined ? spec.thicknessMm : 2.0;
    this.direction = spec.direction || 'UP';
    this.calculateBendParameters();
  }

  calculateBendParameters() {
    const theta = degToRad(this.angleDeg);
    const R = this.innerRadiusMm;
    const T = this.thicknessMm;
    this.bendAngleRad = theta;
    this.rOverT = T > 0 ? R / T : Infinity;
    this.kFactor = kFactorFromRatio(this.rOverT);
    this.bendAllowanceMm = theta * (R + this.kFactor * T);
    this.outsideSetbackMm = (R + T) * Math.tan(theta / 2.0);
    this.bendDeductionMm = 2.0 * this.outsideSetbackMm - this.bendAllowanceMm;
  }
}

function segmentIntersects(a, b, c, d) {
  const cross = (o, p, q) => {
    return (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  };
  const eps = 1e-9;
  const o1 = cross(a, b, c);
  const o2 = cross(a, b, d);
  const o3 = cross(c, d, a);
  const o4 = cross(c, d, b);
  if (Math.sign(o1) !== Math.sign(o2) && Math.sign(o3) !== Math.sign(o4)) {
    return true;
  }
  const onSeg = (o, p, q) => {
    const minX = Math.min(p.x, q.x) - eps;
    const maxX = Math.max(p.x, q.x) + eps;
    const minY = Math.min(p.y, q.y) - eps;
    const maxY = Math.max(p.y, q.y) + eps;
    return o.x >= minX && o.x <= maxX && o.y >= minY && o.y <= maxY;
  };
  if (Math.abs(o1) <= eps && onSeg(c, a, b)) return true;
  if (Math.abs(o2) <= eps && onSeg(d, a, b)) return true;
  if (Math.abs(o3) <= eps && onSeg(a, c, d)) return true;
  if (Math.abs(o4) <= eps && onSeg(b, c, d)) return true;
  return false;
}

function outlineIsSimple(points) {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = points[j];
      const d = points[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentIntersects(a, b, c, d)) return false;
    }
  }
  return true;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2.0;
}

class SheetMetalEngine {
  static bendFromSpec(partSpec, bendSpec) {
    const thicknessMm = partSpec.thicknessMm !== undefined ? partSpec.thicknessMm : 2.0;
    return new SheetMetalBend({ ...bendSpec, thicknessMm });
  }

  static reliefCutPath(type, band, side, width, depth) {
    const centerX = band.centerX;
    const halfW = width / 2.0;
    const xL = centerX - halfW;
    const xR = centerX + halfW;
    const points = [];
    if (type === 'rectangular') {
      points.push({ x: xL, y: 0 });
      points.push({ x: xL, y: depth });
      points.push({ x: xR, y: depth });
      points.push({ x: xR, y: 0 });
    } else if (type === 'tear') {
      points.push({ x: xL, y: 0 });
      points.push({ x: centerX, y: depth });
      points.push({ x: xR, y: 0 });
    } else if (type === 'round') {
      const r = Math.min(halfW, depth);
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const phi = Math.PI - (Math.PI * i) / steps;
        points.push({ x: centerX + r * Math.cos(phi), y: r * Math.sin(phi) });
      }
    } else {
      return [];
    }
    if (side === 'top') {
      for (const p of points) {
        p.y = -p.y;
      }
      points.reverse();
    }
    return points;
  }

  static unfoldPart(partSpec = {}) {
    const flanges = partSpec.flanges || [];
    const bends = partSpec.bends || [];
    const thicknessMm = partSpec.thicknessMm !== undefined ? partSpec.thicknessMm : 2.0;
    const reliefType = partSpec.reliefType || 'none';
    const reliefWidthRequested = partSpec.reliefWidthMm !== undefined ? partSpec.reliefWidthMm : 2.5;
    const reliefDepthRequested = partSpec.reliefDepthMm !== undefined ? partSpec.reliefDepthMm : 3.0;

    if (flanges.length !== bends.length + 1) {
      throw new Error(
        `SheetMetalEngine: expected flanges.length === bends.length + 1 (got ${flanges.length} flanges, ${bends.length} bends)`
      );
    }
    if (!RELIEF_TYPES.includes(reliefType)) {
      throw new Error(`SheetMetalEngine: unknown relief type "${reliefType}"`);
    }
    const widthMm = flanges[0].widthMm;
    for (const f of flanges) {
      if (Math.abs(f.widthMm - widthMm) > 1e-9) {
        throw new Error('SheetMetalEngine: all flanges must share the same width for flat-pattern outline generation');
      }
    }

    const flatFlanges = [];
    const bendLines = [];
    let x = 0;
    for (let i = 0; i < flanges.length; i++) {
      const f = flanges[i];
      flatFlanges.push({
        name: f.name !== undefined ? f.name : `F${i + 1}`,
        startX: x,
        lengthMm: f.lengthMm,
        endX: x + f.lengthMm,
        widthMm: f.widthMm
      });
      x += f.lengthMm;
      if (i < bends.length) {
        const bend = SheetMetalEngine.bendFromSpec(partSpec, bends[i]);
        const band = {
          startX: x,
          endX: x + bend.bendAllowanceMm,
          centerX: x + bend.bendAllowanceMm / 2.0,
          widthMm: bend.bendAllowanceMm
        };
        bendLines.push({
          bendIndex: i + 1,
          band,
          angleDeg: bend.angleDeg,
          direction: bend.direction,
          innerRadiusMm: bend.innerRadiusMm,
          thicknessMm,
          rOverT: bend.rOverT,
          kFactor: bend.kFactor,
          bendAllowanceMm: bend.bendAllowanceMm,
          outsideSetbackMm: bend.outsideSetbackMm,
          bendDeductionMm: bend.bendDeductionMm,
          bendAngleRad: bend.bendAngleRad
        });
        x += bend.bendAllowanceMm;
      }
    }
    const totalDevelopedLengthMm = x;
    const perimeterAnalyticMm = 2.0 * (totalDevelopedLengthMm + widthMm);

    const outline = [];
    const reliefs = [];
    if (reliefType === 'none') {
      outline.push({ x: 0, y: 0 });
      outline.push({ x: totalDevelopedLengthMm, y: 0 });
      outline.push({ x: totalDevelopedLengthMm, y: widthMm });
      outline.push({ x: 0, y: widthMm });
    } else {
      const bands = bendLines.map((b) => ({ band: b.band, index: b.bendIndex }));
      outline.push({ x: 0, y: 0 });
      for (const { band } of bands) {
        const w = Math.min(reliefWidthRequested, band.widthMm * 0.7);
        const d = Math.min(reliefDepthRequested, widthMm * 0.25);
        const cut = SheetMetalEngine.reliefCutPath(reliefType, band, 'bottom', w, d);
        outline.push({ x: band.startX, y: 0 });
        for (const p of cut) outline.push({ x: p.x, y: p.y });
        reliefs.push({
          type: reliefType,
          bendIndex: band.index,
          side: 'bottom',
          widthMm: w,
          depthMm: d,
          band: { ...band },
          polygon: cut.map((p) => ({ x: p.x, y: p.y }))
        });
      }
      outline.push({ x: totalDevelopedLengthMm, y: 0 });
      outline.push({ x: totalDevelopedLengthMm, y: widthMm });
      for (let i = bands.length - 1; i >= 0; i--) {
        const { band } = bands[i];
        const w = Math.min(reliefWidthRequested, band.widthMm * 0.7);
        const d = Math.min(reliefDepthRequested, widthMm * 0.25);
        const cut = SheetMetalEngine.reliefCutPath(reliefType, band, 'top', w, d);
        outline.push({ x: band.endX, y: widthMm });
        for (const p of cut) outline.push({ x: p.x, y: widthMm + p.y });
        reliefs.push({
          type: reliefType,
          bendIndex: band.index,
          side: 'top',
          widthMm: w,
          depthMm: d,
          band: { ...band },
          polygon: cut.map((p) => ({ x: p.x, y: widthMm + p.y }))
        });
      }
      outline.push({ x: 0, y: widthMm });
    }

    const edges = [];
    let perimeterMm = 0;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      perimeterMm += Math.sqrt(dx * dx + dy * dy);
      edges.push([
        { x: p.x, y: p.y },
        { x: q.x, y: q.y }
      ]);
    }

    return {
      success: true,
      totalDevelopedLengthMm,
      perimeterAnalyticMm,
      perimeterMm,
      flangesCount: flanges.length,
      bendsCount: bends.length,
      widthMm,
      thicknessMm,
      reliefType,
      flatFlanges,
      bendLines,
      reliefs,
      outline,
      edges,
      outlineIsSimple: outlineIsSimple(outline),
      outlineSignedAreaMm2: polygonArea(outline)
    };
  }

  static dxfExport(flat, options = {}) {
    const outline = flat.outline;
    const layer = options.layer !== undefined ? options.layer : '0';
    const lines = [];
    lines.push('0', 'SECTION', '2', 'HEADER');
    lines.push('9', '$ACADVER', '1', 'AC1015');
    lines.push('0', 'ENDSEC');
    lines.push('0', 'SECTION', '2', 'ENTITIES');
    for (const edge of flat.edges) {
      lines.push('0', 'LINE', '8', layer);
      lines.push('10', String(edge[0].x), '20', String(edge[0].y));
      lines.push('11', String(edge[1].x), '21', String(edge[1].y));
    }
    lines.push('0', 'LWPOLYLINE', '8', layer);
    lines.push('90', String(outline.length));
    lines.push('70', '1');
    for (const p of outline) {
      lines.push('10', String(p.x), '20', String(p.y));
    }
    lines.push('0', 'ENDSEC');
    lines.push('0', 'EOF');
    return lines.join('\n') + '\n';
  }
}

module.exports = {
  SheetMetalEngine,
  SheetMetalBend,
  kFactorFromRatio,
  DIN6935_K_FACTORS,
  RELIEF_TYPES,
  outlineIsSimple,
  polygonArea
};
