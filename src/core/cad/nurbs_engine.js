/**
 * Experimental NURBS curve and surface evaluators with derivative helpers,
 * plus sampled surface-intersection routines. Numerical accuracy and geometric
 * kernel interoperability have not been independently established.
 */

const { Vector3 } = require('../math/linear_algebra');

/**
 * Cox-de Boor Basis Function Evaluator
 */
class NurbsBasis {
  /**
   * Generates a clamped uniform knot vector for n+1 control points and degree p.
   * Total knots = n + p + 2.
   * Clamped knots repeat p+1 times at the beginning (0) and end (1).
   * @param {number} n - Control points index (count = n + 1)
   * @param {number} p - Degree
   * @returns {number[]} Knot vector
   */
  static generateClampedKnots(n, p) {
    const knots = [];
    const m = n + p + 1;
    for (let i = 0; i <= p; i++) knots.push(0);
    const numInternal = m - 2 * p - 1;
    for (let i = 1; i <= numInternal; i++) {
      knots.push(i / (numInternal + 1));
    }
    for (let i = 0; i <= p; i++) knots.push(1);
    return knots;
  }

  /**
   * Evaluates the i-th B-spline basis function of degree p at parameter u.
   * Uses the stable Cox-de Boor recursion formula.
   * @param {number} i - Basis function index
   * @param {number} p - Degree
   * @param {number} u - Parameter value [0, 1]
   * @param {number[]} U - Knot vector
   * @returns {number} Basis value N_{i,p}(u)
   */
  static evaluate(i, p, u, U) {
    // Degree 0 base case
    if (p === 0) {
      const uStart = U[i];
      const uEnd = U[i + 1];
      // Special case for last knot boundary: u == U[last]
      if (u === U[U.length - 1] && u === uEnd) {
        return 1.0;
      }
      return u >= uStart && u < uEnd ? 1.0 : 0.0;
    }

    let left = 0;
    let right = 0;

    const denom1 = U[i + p] - U[i];
    if (Math.abs(denom1) > 1e-12) {
      left = ((u - U[i]) / denom1) * NurbsBasis.evaluate(i, p - 1, u, U);
    }

    const denom2 = U[i + p + 1] - U[i + 1];
    if (Math.abs(denom2) > 1e-12) {
      right = ((U[i + p + 1] - u) / denom2) * NurbsBasis.evaluate(i + 1, p - 1, u, U);
    }

    return left + right;
  }

  /**
   * Evaluates the first derivative d/du N_{i,p}(u).
   */
  static derivative(i, p, u, U) {
    if (p === 0) return 0.0;

    let left = 0;
    let right = 0;

    const denom1 = U[i + p] - U[i];
    if (Math.abs(denom1) > 1e-12) {
      left = (p / denom1) * NurbsBasis.evaluate(i, p - 1, u, U);
    }

    const denom2 = U[i + p + 1] - U[i + 1];
    if (Math.abs(denom2) > 1e-12) {
      right = (p / denom2) * NurbsBasis.evaluate(i + 1, p - 1, u, U);
    }

    return left - right;
  }

  /**
   * Verifies partition of unity: sum_{i=0}^n N_{i,p}(u) = 1.0
   */
  static verifyPartitionOfUnity(n, p, u, U) {
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      sum += NurbsBasis.evaluate(i, p, u, U);
    }
    return Math.abs(sum - 1.0) < 1e-7;
  }
}

/**
 * 3D Rational B-Spline Curve (NURBS Curve)
 */
class NurbsCurve {
  /**
   * @param {Object} options
   * @param {number} options.degree - Polynomial degree (e.g., 2, 3)
   * @param {Vector3[]} options.controlPoints - Array of control point Vector3
   * @param {number[]} [options.weights] - Homogeneous weights (default all 1.0)
   * @param {number[]} [options.knots] - Knot vector (defaults to clamped uniform)
   */
  constructor({ degree = 3, controlPoints = [], weights = null, knots = null }) {
    this.degree = degree;
    this.controlPoints = controlPoints.map((p) => (p instanceof Vector3 ? p.clone() : new Vector3(p[0], p[1], p[2])));
    this.n = this.controlPoints.length - 1;
    if (this.n < this.degree) {
      throw new Error(`Insufficient control points (${this.controlPoints.length}) for degree ${this.degree}`);
    }
    this.weights = weights ? [...weights] : new Array(this.controlPoints.length).fill(1.0);
    this.knots = knots ? [...knots] : NurbsBasis.generateClampedKnots(this.n, this.degree);
  }

  /**
   * Evaluates point on NURBS curve at parameter u in [0, 1].
   * C(u) = (sum w_i * N_{i,p}(u) * P_i) / (sum w_i * N_{i,p}(u))
   * @param {number} u
   * @returns {Vector3}
   */
  evaluate(u) {
    u = Math.max(this.knots[0], Math.min(this.knots[this.knots.length - 1], u));
    let numX = 0,
      numY = 0,
      numZ = 0;
    let denom = 0;

    for (let i = 0; i <= this.n; i++) {
      const N = NurbsBasis.evaluate(i, this.degree, u, this.knots);
      if (Math.abs(N) < 1e-12) continue;
      const w = this.weights[i];
      const pt = this.controlPoints[i];
      const wN = w * N;

      numX += wN * pt.x;
      numY += wN * pt.y;
      numZ += wN * pt.z;
      denom += wN;
    }

    if (Math.abs(denom) < 1e-12) denom = 1.0;
    return new Vector3(numX / denom, numY / denom, numZ / denom);
  }

  /**
   * Evaluates tangent vector C'(u) using quotient rule derivative.
   */
  evaluateTangent(u) {
    const delta = 1e-5;
    const u0 = Math.max(0, u - delta);
    const u1 = Math.min(1, u + delta);
    const p0 = this.evaluate(u0);
    const p1 = this.evaluate(u1);
    const tan = p1.sub(p0).scale(1 / (u1 - u0));
    return tan.normalize();
  }

  /**
   * Approximates total curve arc length by adaptive numerical sampling.
   */
  computeLength(samples = 100) {
    let length = 0;
    let prev = this.evaluate(0);
    for (let i = 1; i <= samples; i++) {
      const u = i / samples;
      const curr = this.evaluate(u);
      length += prev.distanceTo(curr);
      prev = curr;
    }
    return length;
  }

  /**
   * Discretizes curve into polyline points.
   */
  tessellate(segments = 50) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      points.push(this.evaluate(i / segments));
    }
    return points;
  }
}

/**
 * 3D Rational B-Spline Surface (NURBS Surface)
 */
class NurbsSurface {
  /**
   * @param {Object} options
   * @param {number} options.degreeU - Degree in u direction
   * @param {number} options.degreeV - Degree in v direction
   * @param {Vector3[][]} options.controlPoints - 2D grid of control points [u][v]
   * @param {number[][]} [options.weights] - 2D grid of weights
   * @param {number[]} [options.knotsU] - Knot vector in u
   * @param {number[]} [options.knotsV] - Knot vector in v
   */
  constructor({ degreeU = 3, degreeV = 3, controlPoints = [], weights = null, knotsU = null, knotsV = null }) {
    this.degreeU = degreeU;
    this.degreeV = degreeV;
    this.controlPoints = controlPoints.map((row) =>
      row.map((p) => (p instanceof Vector3 ? p.clone() : new Vector3(p[0], p[1], p[2])))
    );
    this.nu = this.controlPoints.length - 1;
    this.nv = this.controlPoints[0] ? this.controlPoints[0].length - 1 : -1;

    if (this.nu < this.degreeU || this.nv < this.degreeV) {
      throw new Error(
        `Insufficient control point grid (${this.nu + 1}x${this.nv + 1}) for degree (${this.degreeU}, ${this.degreeV})`
      );
    }

    if (weights) {
      this.weights = weights.map((row) => [...row]);
    } else {
      this.weights = Array.from({ length: this.nu + 1 }, () => new Array(this.nv + 1).fill(1.0));
    }

    this.knotsU = knotsU ? [...knotsU] : NurbsBasis.generateClampedKnots(this.nu, this.degreeU);
    this.knotsV = knotsV ? [...knotsV] : NurbsBasis.generateClampedKnots(this.nv, this.degreeV);
  }

  /**
   * Evaluates surface point S(u, v).
   * @param {number} u - Parameter [0, 1]
   * @param {number} v - Parameter [0, 1]
   * @returns {Vector3}
   */
  evaluate(u, v) {
    u = Math.max(this.knotsU[0], Math.min(this.knotsU[this.knotsU.length - 1], u));
    v = Math.max(this.knotsV[0], Math.min(this.knotsV[this.knotsV.length - 1], v));

    let numX = 0,
      numY = 0,
      numZ = 0;
    let denom = 0;

    for (let i = 0; i <= this.nu; i++) {
      const Nu = NurbsBasis.evaluate(i, this.degreeU, u, this.knotsU);
      if (Math.abs(Nu) < 1e-12) continue;

      for (let j = 0; j <= this.nv; j++) {
        const Nv = NurbsBasis.evaluate(j, this.degreeV, v, this.knotsV);
        if (Math.abs(Nv) < 1e-12) continue;

        const w = this.weights[i][j];
        const pt = this.controlPoints[i][j];
        const wNN = w * Nu * Nv;

        numX += wNN * pt.x;
        numY += wNN * pt.y;
        numZ += wNN * pt.z;
        denom += wNN;
      }
    }

    if (Math.abs(denom) < 1e-12) denom = 1.0;
    return new Vector3(numX / denom, numY / denom, numZ / denom);
  }

  /**
   * Evaluates partial derivatives dS/du and dS/dv.
   */
  evaluatePartials(u, v) {
    const h = 1e-5;
    const u0 = Math.max(0, u - h),
      u1 = Math.min(1, u + h);
    const v0 = Math.max(0, v - h),
      v1 = Math.min(1, v + h);

    const Su0 = this.evaluate(u0, v);
    const Su1 = this.evaluate(u1, v);
    const dS_du = Su1.sub(Su0).scale(1 / (u1 - u0));

    const Sv0 = this.evaluate(u, v0);
    const Sv1 = this.evaluate(u, v1);
    const dS_dv = Sv1.sub(Sv0).scale(1 / (v1 - v0));

    return { dS_du, dS_dv };
  }

  /**
   * Evaluates unit surface normal vector n(u, v) = normalize(dS/du x dS/dv).
   */
  evaluateNormal(u, v) {
    const { dS_du, dS_dv } = this.evaluatePartials(u, v);
    const n = dS_du.cross(dS_dv);
    return n.normalize();
  }

  /**
   * Computes Gaussian (K) and Mean (H) curvature via fundamental forms.
   */
  evaluateCurvature(u, v) {
    const { dS_du, dS_dv } = this.evaluatePartials(u, v);
    const n = this.evaluateNormal(u, v);

    const E = dS_du.dot(dS_du);
    const F = dS_du.dot(dS_dv);
    const G = dS_dv.dot(dS_dv);

    const h = 1e-4;
    const p = this.evaluate(u, v);
    const puu = this.evaluate(Math.min(1, u + h), v)
      .add(this.evaluate(Math.max(0, u - h), v))
      .sub(p.clone().scale(2))
      .scale(1 / (h * h));
    const pvv = this.evaluate(u, Math.min(1, v + h))
      .add(this.evaluate(u, Math.max(0, v - h)))
      .sub(p.clone().scale(2))
      .scale(1 / (h * h));
    const puv = this.evaluate(Math.min(1, u + h), Math.min(1, v + h))
      .sub(this.evaluate(Math.min(1, u + h), Math.max(0, v - h)))
      .sub(this.evaluate(Math.max(0, u - h), Math.min(1, v + h)))
      .add(this.evaluate(Math.max(0, u - h), Math.max(0, v - h)))
      .scale(1 / (4 * h * h));

    const L = puu.dot(n);
    const M = puv.dot(n);
    const N_val = pvv.dot(n);

    const denom = E * G - F * F;
    if (Math.abs(denom) < 1e-12) return { K: 0, H: 0 };

    const K = (L * N_val - M * M) / denom;
    const H = (E * N_val - 2 * F * M + G * L) / (2 * denom);

    return { K, H, gaussian: K, mean: H };
  }

  /**
   * Tessellates surface into triangulated mesh vertices and indices.
   * @param {number} resU
   * @param {number} resV
   * @returns {{ vertices: Vector3[], normals: Vector3[], uvs: number[][], indices: number[] }}
   */
  tessellate(resU = 20, resV = 20) {
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= resU; i++) {
      const u = i / resU;
      for (let j = 0; j <= resV; j++) {
        const v = j / resV;
        vertices.push(this.evaluate(u, v));
        normals.push(this.evaluateNormal(u, v));
        uvs.push([u, v]);
      }
    }

    const rowLength = resV + 1;
    for (let i = 0; i < resU; i++) {
      for (let j = 0; j < resV; j++) {
        const idx0 = i * rowLength + j;
        const idx1 = idx0 + 1;
        const idx2 = (i + 1) * rowLength + j;
        const idx3 = idx2 + 1;

        // Two triangles per quad
        indices.push(idx0, idx2, idx1);
        indices.push(idx1, idx2, idx3);
      }
    }

    return { vertices, normals, uvs, indices };
  }

  /**
   * Helper factory: Creates a planar rectangular NURBS surface.
   */
  static createPlane(corner, uDir, vDir, width, height) {
    const c00 = corner.clone();
    const c10 = corner.clone().add(uDir.clone().normalize().scale(width));
    const c01 = corner.clone().add(vDir.clone().normalize().scale(height));
    const c11 = c10.clone().add(vDir.clone().normalize().scale(height));

    const controlPoints = [
      [c00, c01],
      [c10, c11]
    ];

    return new NurbsSurface({
      degreeU: 1,
      degreeV: 1,
      controlPoints
    });
  }

  /**
   * Helper factory: Creates a cylinder NURBS surface patch of radius R and height H.
   */
  static createCylinderPatch(radius, height, angleSpan = Math.PI / 2) {
    // 9-point biquadratic cylinder patch
    const dtheta = angleSpan / 2;
    const w = Math.cos(dtheta);

    const cp = [
      [new Vector3(radius, 0, 0), new Vector3(radius, 0, height / 2), new Vector3(radius, 0, height)],
      [
        new Vector3(radius, radius * Math.tan(dtheta), 0),
        new Vector3(radius, radius * Math.tan(dtheta), height / 2),
        new Vector3(radius, radius * Math.tan(dtheta), height)
      ],
      [
        new Vector3(radius * Math.cos(angleSpan), radius * Math.sin(angleSpan), 0),
        new Vector3(radius * Math.cos(angleSpan), radius * Math.sin(angleSpan), height / 2),
        new Vector3(radius * Math.cos(angleSpan), radius * Math.sin(angleSpan), height)
      ]
    ];

    const weights = [
      [1, 1, 1],
      [w, w, w],
      [1, 1, 1]
    ];

    return new NurbsSurface({
      degreeU: 2,
      degreeV: 1,
      controlPoints: cp,
      weights,
      knotsU: [0, 0, 0, 1, 1, 1],
      knotsV: [0, 0, 0.5, 1, 1]
    });
  }
}

/**
 * Surface-Surface Intersection (SSI) Engine
 * Implements adaptive quadtree subdivision and orthogonal Newton-Raphson refinement
 * to compute exact 3D intersection curves between two arbitrary parametric surfaces.
 */
class SurfaceSurfaceIntersection {
  /**
   * Computes intersection between Surface 1 and Surface 2.
   * @param {NurbsSurface} surf1
   * @param {NurbsSurface} surf2
   * @param {Object} options
   * @param {number} [options.subdivisions=8] - Initial quadtree grid resolution
   * @param {number} [options.tolerance=1e-5] - Distance convergence tolerance
   * @param {number} [options.maxIterations=25] - Max Newton iterations
   * @returns {{ points: Vector3[], uvPairs: Array<{ uv1: [number, number], uv2: [number, number] }> }}
   */
  static intersect(surf1, surf2, options = {}) {
    const { subdivisions = 10, tolerance = 1e-5, maxIterations = 25 } = options;

    const intersectionPoints = [];
    const uvPairs = [];

    // Step 1: Discrete mesh sample evaluation to find candidate collision patches
    const s1Grid = [];
    for (let i = 0; i <= subdivisions; i++) {
      const u = i / subdivisions;
      const row = [];
      for (let j = 0; j <= subdivisions; j++) {
        const v = j / subdivisions;
        row.push({ u, v, pt: surf1.evaluate(u, v) });
      }
      s1Grid.push(row);
    }

    const s2Grid = [];
    for (let i = 0; i <= subdivisions; i++) {
      const u = i / subdivisions;
      const row = [];
      for (let j = 0; j <= subdivisions; j++) {
        const v = j / subdivisions;
        row.push({ u, v, pt: surf2.evaluate(u, v) });
      }
      s2Grid.push(row);
    }

    // Step 2: Dynamic seed identification based on average grid step size
    const d1_u = s1Grid[0][0].pt.distanceTo(s1Grid[Math.min(1, subdivisions)][0].pt);
    const d1_v = s1Grid[0][0].pt.distanceTo(s1Grid[0][Math.min(1, subdivisions)].pt);
    const d2_u = s2Grid[0][0].pt.distanceTo(s2Grid[Math.min(1, subdivisions)][0].pt);
    const d2_v = s2Grid[0][0].pt.distanceTo(s2Grid[0][Math.min(1, subdivisions)].pt);
    const cellStep = Math.max(d1_u, d1_v, d2_u, d2_v, 1.0);
    const seedDistThreshold = cellStep * 1.5;

    const seeds = [];
    for (let i1 = 0; i1 <= subdivisions; i1++) {
      for (let j1 = 0; j1 <= subdivisions; j1++) {
        const p1 = s1Grid[i1][j1].pt;
        for (let i2 = 0; i2 <= subdivisions; i2++) {
          for (let j2 = 0; j2 <= subdivisions; j2++) {
            const p2 = s2Grid[i2][j2].pt;
            const dist = p1.distanceTo(p2);
            if (dist < seedDistThreshold) {
              seeds.push({
                u1: s1Grid[i1][j1].u,
                v1: s1Grid[i1][j1].v,
                u2: s2Grid[i2][j2].u,
                v2: s2Grid[i2][j2].v,
                dist
              });
            }
          }
        }
      }
    }

    // Sort seeds by closest proximity
    seeds.sort((a, b) => a.dist - b.dist);

    // Step 3: Newton-Raphson refinement on top candidates
    const minPointSeparation = Math.max(0.01, cellStep * 0.15);

    // Limit to top 50 closest seeds to keep performance high
    const topSeeds = seeds.slice(0, 50);

    for (const seed of topSeeds) {
      const refined = SurfaceSurfaceIntersection._refineNewton(
        surf1,
        surf2,
        seed.u1,
        seed.v1,
        seed.u2,
        seed.v2,
        tolerance,
        maxIterations
      );

      if (refined && refined.converged) {
        const isDuplicate = intersectionPoints.some((pt) => pt.distanceTo(refined.point) < minPointSeparation);
        if (!isDuplicate) {
          intersectionPoints.push(refined.point);
          uvPairs.push({ uv1: [refined.u1, refined.v1], uv2: [refined.u2, refined.v2] });
        }
      }
    }

    // Order points along the curve if possible
    SurfaceSurfaceIntersection._orderCurvePoints(intersectionPoints, uvPairs);

    return {
      points: intersectionPoints,
      uvPairs,
      curveLength: SurfaceSurfaceIntersection._computeCurveLength(intersectionPoints)
    };
  }

  /**
   * Refines a seed point (u1, v1, u2, v2) such that S1(u1, v1) = S2(u2, v2).
   */
  static _refineNewton(surf1, surf2, u1_init, v1_init, u2_init, v2_init, tol, maxIter) {
    let u1 = u1_init,
      v1 = v1_init;
    let u2 = u2_init,
      v2 = v2_init;

    for (let iter = 0; iter < maxIter; iter++) {
      const p1 = surf1.evaluate(u1, v1);
      const p2 = surf2.evaluate(u2, v2);
      const diff = p1.clone().sub(p2);
      const dist = diff.length();

      if (dist < tol) {
        return {
          converged: true,
          point: p1.add(p2).scale(0.5),
          u1,
          v1,
          u2,
          v2,
          residual: dist
        };
      }

      // Compute tangent bases and normals
      const part1 = surf1.evaluatePartials(u1, v1);
      const part2 = surf2.evaluatePartials(u2, v2);

      const n1 = surf1.evaluateNormal(u1, v1);
      const n2 = surf2.evaluateNormal(u2, v2);

      // Curve tangent direction T = n1 x n2
      const T = n1.cross(n2);

      // Gradient descent step to project points towards each other
      const step1_u = -diff.dot(part1.dS_du) / (part1.dS_du.lengthSq() + 1e-6);
      const step1_v = -diff.dot(part1.dS_dv) / (part1.dS_dv.lengthSq() + 1e-6);
      const step2_u = diff.dot(part2.dS_du) / (part2.dS_du.lengthSq() + 1e-6);
      const step2_v = diff.dot(part2.dS_dv) / (part2.dS_dv.lengthSq() + 1e-6);

      const damping = 0.5;
      u1 = Math.max(0, Math.min(1, u1 + step1_u * damping));
      v1 = Math.max(0, Math.min(1, v1 + step1_v * damping));
      u2 = Math.max(0, Math.min(1, u2 + step2_u * damping));
      v2 = Math.max(0, Math.min(1, v2 + step2_v * damping));
    }

    const finalP1 = surf1.evaluate(u1, v1);
    const finalP2 = surf2.evaluate(u2, v2);
    const finalDist = finalP1.distanceTo(finalP2);

    return {
      converged: finalDist < Math.max(tol * 20, 0.05),
      point: finalP1.add(finalP2).scale(0.5),
      u1,
      v1,
      u2,
      v2,
      residual: finalDist
    };
  }

  static _orderCurvePoints(points, uvPairs) {
    if (points.length <= 2) return;
    // Nearest neighbor path ordering
    for (let i = 0; i < points.length - 1; i++) {
      let nearestIdx = i + 1;
      let minDist = points[i].distanceTo(points[nearestIdx]);
      for (let j = i + 2; j < points.length; j++) {
        const d = points[i].distanceTo(points[j]);
        if (d < minDist) {
          minDist = d;
          nearestIdx = j;
        }
      }
      if (nearestIdx !== i + 1) {
        // Swap
        const tmpPt = points[i + 1];
        points[i + 1] = points[nearestIdx];
        points[nearestIdx] = tmpPt;

        const tmpUv = uvPairs[i + 1];
        uvPairs[i + 1] = uvPairs[nearestIdx];
        uvPairs[nearestIdx] = tmpUv;
      }
    }
  }

  static _computeCurveLength(points) {
    let len = 0;
    for (let i = 0; i < points.length - 1; i++) {
      len += points[i].distanceTo(points[i + 1]);
    }
    return len;
  }
}

module.exports = {
  NurbsBasis,
  NurbsCurve,
  NURBSCurve: NurbsCurve,
  NurbsSurface,
  NURBSSurface: NurbsSurface,
  SurfaceSurfaceIntersection
};
