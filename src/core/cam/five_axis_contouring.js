/**
 * 5-Axis Point/Contour Finish Toolpath Generator (Constant Scallop).
 *
 * Generates a constant-scallop-height finishing toolpath for a ball-end tool
 * over a sculptured surface. The reference test surface is a spherical dome
 * S(u,v) = (R sin v cos u, R sin v sin u, R cos v), u in [0, 2pi),
 * v in [0, pi/2], with parallel passes along u at constant latitude v.
 *
 * Scallop control (inverted from h = R - sqrt(R^2 - (delta/2)^2), with
 * normal-curvature compensation):
 *   delta = sqrt(8 R h / (1 + kappa_n R))
 * where kappa_n > 0 is convex. On a sphere kappa_n = 1/R_dome.
 *
 * Tool axis: normal-following (axis along surface normal) with optional
 * lead (rotation about feed tangent T_u) and tilt (rotation about
 * cross-feed tangent T_v) angles.
 *
 * Gouge check: for every tool position the ball-end tool center must stay
 * outside/above the surface, i.e. signed distance from tool center to the
 * surface >= 0. Centers are placed at +R along the normal (tangent contact),
 * so clearance is exactly R for the dome.
 */

'use strict';

const TWO_PI = 2.0 * Math.PI;
const HALF_PI = Math.PI / 2.0;

/**
 * Invert the flat-surface scallop relation h = R - sqrt(R^2 - (delta/2)^2)
 * for the stepover delta.
 *
 * @param {Object} params
 * @param {number} params.toolRadiusMm Ball-end tool radius R (mm)
 * @param {number} params.scallopHeightMm Target scallop height h (mm)
 * @returns {number} Exact flat-surface stepover delta (mm)
 */
function invertBallEndScallopStepover({ toolRadiusMm, scallopHeightMm }) {
  const R = toolRadiusMm;
  const h = scallopHeightMm;
  return 2.0 * Math.sqrt(2.0 * R * h - h * h);
}

/**
 * Constant-scallop stepover with normal-curvature adjustment:
 *   delta = sqrt(8 R h / (1 + kappa_n R))
 *
 * @param {Object} params
 * @param {number} params.toolRadiusMm Ball-end tool radius R (mm)
 * @param {number} params.scallopHeightMm Target scallop height h (mm)
 * @param {number} [params.normalCurvature=0] Normal curvature kappa_n (1/mm)
 * @returns {Object} Stepover details
 */
function constantScallopStepover({ toolRadiusMm, scallopHeightMm, normalCurvature = 0.0 }) {
  const R = toolRadiusMm;
  const h = scallopHeightMm;
  const kappa = normalCurvature;

  const denom = 1.0 + kappa * R;
  if (denom <= 0.01) {
    throw new Error('Tool radius exceeds concave surface curvature radius; gouging condition.');
  }

  const flatStepoverMm = Math.sqrt(8.0 * R * h);
  const stepoverMm = Math.sqrt((8.0 * R * h) / denom);

  return {
    stepoverMm,
    flatStepoverMm,
    toolRadiusMm: R,
    scallopHeightMm: h,
    normalCurvature: kappa,
    stepoverRatioToFlat: stepoverMm / flatStepoverMm,
    surfaceType: kappa > 0.0001 ? 'convex' : kappa < -0.0001 ? 'concave' : 'flat'
  };
}

/**
 * Spherical dome test surface: S(u,v) = (R sin v cos u, R sin v sin u, R cos v).
 */
class SphericalDomeSurface {
  constructor({ radiusMm = 50.0 } = {}) {
    this.radiusMm = radiusMm;
  }

  pointUv(u, v) {
    const R = this.radiusMm;
    const sv = Math.sin(v);
    const cv = Math.cos(v);
    return [R * sv * Math.cos(u), R * sv * Math.sin(u), R * cv];
  }

  normalUv(u, v) {
    const sv = Math.sin(v);
    const cv = Math.cos(v);
    return [sv * Math.cos(u), sv * Math.sin(u), cv];
  }

  normalCurvature() {
    return 1.0 / this.radiusMm;
  }

  signedDistance(point) {
    return Math.hypot(point[0], point[1], point[2]) - this.radiusMm;
  }

  uRange() {
    return [0.0, TWO_PI];
  }

  vRange() {
    return [0.0, HALF_PI];
  }
}

/**
 * Rotate vector `vector` about unit axis `axis` by `angleRad` (Rodrigues).
 */
function rotateVectorAboutAxis(vector, axis, angleRad) {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const dot = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
  const cross = [
    axis[1] * vector[2] - axis[2] * vector[1],
    axis[2] * vector[0] - axis[0] * vector[2],
    axis[0] * vector[1] - axis[1] * vector[0]
  ];
  const oneMinusCos = 1.0 - cosA;
  return [
    vector[0] * cosA + cross[0] * sinA + axis[0] * dot * oneMinusCos,
    vector[1] * cosA + cross[1] * sinA + axis[1] * dot * oneMinusCos,
    vector[2] * cosA + cross[2] * sinA + axis[2] * dot * oneMinusCos
  ];
}

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-15) return [0.0, 0.0, 1.0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function angleBetweenAxes(a, b) {
  const dot = Math.max(-1.0, Math.min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot);
}

/**
 * Build a single 5-axis tool pose on the dome at parameter (u, v).
 *
 * Tool center is placed at P + R*n (tangent contact, no gouge). Tool axis is
 * the surface normal n, optionally rotated by lead about T_u and tilt about
 * T_v.
 *
 * @returns {Object} Pose { u, v, point, normal, axis, center, clearance }
 */
function buildDomePose(surface, u, v, toolRadiusMm, leadAngleDeg, tiltAngleDeg) {
  const point = surface.pointUv(u, v);
  const normal = surface.normalUv(u, v);

  const rho = Math.hypot(point[0], point[1]);
  let tu;
  if (rho > 1e-12) {
    tu = [-point[1] / rho, point[0] / rho, 0.0];
  } else {
    tu = [0.0, 1.0, 0.0];
  }
  const tv = [
    tu[1] * normal[2] - tu[2] * normal[1],
    tu[2] * normal[0] - tu[0] * normal[2],
    tu[0] * normal[1] - tu[1] * normal[0]
  ];

  let axis = normalize3(normal);
  const leadRad = (leadAngleDeg * Math.PI) / 180.0;
  const tiltRad = (tiltAngleDeg * Math.PI) / 180.0;
  if (Math.abs(leadRad) > 1e-12) {
    axis = normalize3(rotateVectorAboutAxis(axis, tu, leadRad));
  }
  if (Math.abs(tiltRad) > 1e-12) {
    axis = normalize3(rotateVectorAboutAxis(axis, tv, tiltRad));
  }

  const center = [
    point[0] + toolRadiusMm * axis[0],
    point[1] + toolRadiusMm * axis[1],
    point[2] + toolRadiusMm * axis[2]
  ];
  const clearance = surface.signedDistance(center);

  return { u, v, point, normal, axis, center, clearance };
}

/**
 * Generate constant-scallop 5-axis contour passes on the spherical dome.
 *
 * Passes are parallel circles of constant latitude v, spaced by the
 * curvature-adjusted stepover delta = sqrt(8 R h / (1 + kappa_n R)) along the
 * meridian (v direction). The first pass is the pole (v = 0) and the last
 * pass is the equator (v = pi/2), so both u and v ranges are fully covered.
 *
 * @param {Object} options
 * @param {number} [options.domeRadiusMm=50] Dome radius (mm)
 * @param {number} [options.toolRadiusMm=3] Ball-end tool radius (mm)
 * @param {number} [options.scallopHeightMm=0.002] Target scallop height (mm)
 * @param {number} [options.leadAngleDeg=0] Lead angle about feed tangent (deg)
 * @param {number} [options.tiltAngleDeg=0] Tilt angle about cross-feed tangent (deg)
 * @param {number} [options.uStepCount=180] Steps per full u sweep
 * @param {boolean} [options.performGougeCheck=true] Throw on gouge violation
 * @returns {Object} { surface, scallop, passes, passCount, pointCount, minClearance, maxAxisDeltaDeg }
 */
function generateFiveAxisConstantScallopContouring({
  domeRadiusMm = 50.0,
  toolRadiusMm = 3.0,
  scallopHeightMm = 0.002,
  leadAngleDeg = 0.0,
  tiltAngleDeg = 0.0,
  uStepCount = 180,
  performGougeCheck = true
} = {}) {
  const surface = new SphericalDomeSurface({ radiusMm: domeRadiusMm });
  const scallop = constantScallopStepover({
    toolRadiusMm,
    scallopHeightMm,
    normalCurvature: surface.normalCurvature()
  });

  const dv = scallop.stepoverMm / domeRadiusMm;
  const vs = [];
  for (let v = 0.0; v < HALF_PI - 1e-12; v += dv) {
    vs.push(v);
  }
  vs.push(HALF_PI);

  const du = TWO_PI / uStepCount;
  let minClearance = Infinity;
  let maxAxisDelta = 0.0;
  let prevAxis = null;
  let pointCount = 0;

  const passes = vs.map((v, index) => {
    const points = [];
    for (let k = 0; k <= uStepCount; k++) {
      const u = k * du;
      const pose = buildDomePose(surface, u, v, toolRadiusMm, leadAngleDeg, tiltAngleDeg);

      if (pose.clearance < minClearance) {
        minClearance = pose.clearance;
      }
      if (performGougeCheck && pose.clearance < -1e-9) {
        throw new Error(`Gouge violation at u=${u}, v=${v}: clearance=${pose.clearance}`);
      }
      if (prevAxis !== null) {
        const delta = angleBetweenAxes(prevAxis, pose.axis);
        if (delta > maxAxisDelta) {
          maxAxisDelta = delta;
        }
      }
      prevAxis = pose.axis;

      points.push({
        u,
        v,
        point: pose.point,
        normal: pose.normal,
        axis: pose.axis,
        center: pose.center,
        clearance: pose.clearance
      });
    }
    pointCount += points.length;
    return { index, vArc: v, vDeg: (v * 180.0) / Math.PI, points };
  });

  return {
    surface,
    scallop,
    passes,
    passCount: passes.length,
    pointCount,
    minClearance,
    maxAxisDeltaDeg: (maxAxisDelta * 180.0) / Math.PI
  };
}

/**
 * Exact distance from a point M to the center-circle swept by a pass (the set
 * of tool centers along the pass). The sphere's surface is at distance R
 * inside this center set, so leftover material above the swept surface at M is
 * min(distance to center sets of adjacent passes) - R.
 */
function distanceToPassCenterSet(point, pass, domeRadiusMm, toolRadiusMm) {
  const D = domeRadiusMm + toolRadiusMm;
  if (pass.vArc === 0.0) {
    return Math.hypot(point[0], point[1], point[2] - D);
  }
  const rho = D * Math.sin(pass.vArc);
  const zc = D * Math.cos(pass.vArc);
  const rM = Math.hypot(point[0], point[1]);
  return Math.hypot(rM - rho, point[2] - zc);
}

/**
 * Measure the actual scallop height between adjacent passes: for each pair,
 * sample the midpoint curve on the surface and take the remaining material
 * above the swept tool surfaces (min over the two adjacent sweeps).
 *
 * @returns {number} Measured maximum scallop height (mm)
 */
function measureActualScallopHeight({ passes, domeRadiusMm = 50.0, toolRadiusMm = 3.0, midUSampleCount = 24 }) {
  const surface = new SphericalDomeSurface({ radiusMm: domeRadiusMm });
  let maxScallop = 0.0;

  for (let i = 0; i < passes.length - 1; i++) {
    const p1 = passes[i];
    const p2 = passes[i + 1];
    const vMid = (p1.vArc + p2.vArc) / 2.0;

    for (let s = 0; s < midUSampleCount; s++) {
      const u = (s / midUSampleCount) * TWO_PI;
      const M = surface.pointUv(u, vMid);
      const d1 = distanceToPassCenterSet(M, p1, domeRadiusMm, toolRadiusMm);
      const d2 = distanceToPassCenterSet(M, p2, domeRadiusMm, toolRadiusMm);
      const leftover = Math.min(d1, d2) - toolRadiusMm;
      if (leftover > maxScallop) {
        maxScallop = leftover;
      }
    }
  }

  return maxScallop;
}

module.exports = {
  TWO_PI,
  HALF_PI,
  invertBallEndScallopStepover,
  constantScallopStepover,
  SphericalDomeSurface,
  rotateVectorAboutAxis,
  angleBetweenAxes,
  buildDomePose,
  generateFiveAxisConstantScallopContouring,
  distanceToPassCenterSet,
  measureActualScallopHeight
};
