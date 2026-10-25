/**
 * OmniEng Exact 3D Skew Ray Tracing Engine
 * Standard: Vector Snell's Law & Conic/Polynomial Aspherical Surfaces
 * Experimental implementation: Zemax OpticStudio / SYNOPSYS CODE V exact ray tracing.
 */

class SkewRayTracer {
  /**
   * Creates a 3D ray.
   * @param {number[]} origin [x, y, z]
   * @param {number[]} direction [L, M, N]
   * @param {number} wavelengthUm Wavelength in microns (default 0.5876 d-line)
   * @param {number} intensity Ray relative intensity
   */
  static createRay(origin = [0, 0, 0], direction = [0, 0, 1], wavelengthUm = 0.5875618, intensity = 1.0) {
    const dirNorm = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]) || 1.0;
    return {
      x: origin[0],
      y: origin[1],
      z: origin[2],
      L: direction[0] / dirNorm,
      M: direction[1] / dirNorm,
      N: direction[2] / dirNorm,
      wavelengthUm,
      intensity,
      opl: 0.0, // Optical Path Length
      isTerminated: false,
      isTIR: false,
      path: [[origin[0], origin[1], origin[2]]]
    };
  }

  /**
   * Intersects a ray with a spherical surface and refracts/reflects.
   * @param {Object} ray 
   * @param {Object} surface Surface definition:
   *   radius: Curvature radius (mm). + for center to the right (+z), - for left. 0 or Infinity for flat.
   *   zVertex: z-coordinate of surface vertex (mm).
   *   clearRadius: Maximum radial aperture (mm).
   *   nIncident: Refractive index before surface.
   *   nTransmitted: Refractive index after surface.
   *   conic: Conic constant k (default 0 for sphere).
   *   asphericCoeffs: Array [A4, A6, A8, A10] for polynomial deformation.
   */
  static traceRayThroughSurface(ray, surface) {
    if (ray.isTerminated) return ray;

    const R = surface.radius;
    const zV = surface.zVertex;
    const conic = surface.conic || 0.0;
    const A = surface.asphericCoeffs || [0, 0, 0, 0];
    const n1 = surface.nIncident || 1.0;
    const n2 = surface.nTransmitted || 1.0;
    const clearRad = surface.clearRadius || 1e6;

    let t = 0;
    let hitX = 0, hitY = 0, hitZ = 0;
    let normX = 0, normY = 0, normZ = 1;

    // 1. Plane Surface (R === 0 or Infinity)
    if (!R || Math.abs(R) > 1e8) {
      if (Math.abs(ray.N) < 1e-12) {
        ray.isTerminated = true;
        return ray;
      }
      t = (zV - ray.z) / ray.N;
      if (t < 1e-9) {
        // Target is behind ray
        ray.isTerminated = true;
        return ray;
      }
      hitX = ray.x + t * ray.L;
      hitY = ray.y + t * ray.M;
      hitZ = zV;
      normX = 0;
      normY = 0;
      normZ = (ray.N > 0) ? -1 : 1;
    } else {
      // 2. Spherical / Conic / Aspheric Surface
      // Sphere center: (0, 0, zC) where zC = zV + R
      const zC = zV + R;
      const dx = ray.x;
      const dy = ray.y;
      const dz = ray.z - zC;

      // Ray: P(t) = P0 + t*S -> (dx + t*L)^2 + (dy + t*M)^2 + (dz + t*N)^2 = R^2
      // a*t^2 + 2*b*t + c = 0
      const a = ray.L * ray.L + ray.M * ray.M + ray.N * ray.N; // 1.0
      const b = dx * ray.L + dy * ray.M + dz * ray.N;
      const c = dx * dx + dy * dy + dz * dz - R * R;

      const disc = b * b - a * c;
      if (disc < 0) {
        // Ray misses the sphere entirely
        ray.isTerminated = true;
        return ray;
      }

      // Root selection: surface curvature determines which sphere intersection is physical
      const sqrtDisc = Math.sqrt(disc);
      let t1 = (-b - sqrtDisc) / a;
      let t2 = (-b + sqrtDisc) / a;

      if (R > 0) {
        t = (t1 > 1e-9) ? t1 : t2;
      } else {
        t = (t2 > 1e-9) ? t2 : t1;
      }

      if (t <= 1e-9) {
        ray.isTerminated = true;
        return ray;
      }

      hitX = ray.x + t * ray.L;
      hitY = ray.y + t * ray.M;
      hitZ = ray.z + t * ray.N;

      // If aspheric deformation exists, refine using Newton-Raphson
      const isAspheric = conic !== 0 || (A[0] !== 0 || A[1] !== 0 || A[2] !== 0);
      if (isAspheric) {
        const cur = 1.0 / R;
        for (let iter = 0; iter < 4; iter++) {
          const r2 = hitX * hitX + hitY * hitY;
          const denom = 1.0 + Math.sqrt(Math.max(0, 1.0 - (1.0 + conic) * cur * cur * r2));
          let zSag = zV + (cur * r2) / (denom || 1.0);
          zSag += A[0] * Math.pow(r2, 2) + A[1] * Math.pow(r2, 3) + A[2] * Math.pow(r2, 4);

          const fVal = hitZ - zSag;
          if (Math.abs(fVal) < 1e-8) break;

          // Derivative dz/dr
          const dzdr = (cur * 2 * Math.sqrt(r2)) / (denom || 1.0);
          const fPrime = ray.N - dzdr * (hitX * ray.L + hitY * ray.M) / (Math.sqrt(r2) || 1.0);
          if (Math.abs(fPrime) > 1e-8) {
            t -= fVal / fPrime;
            hitX = ray.x + t * ray.L;
            hitY = ray.y + t * ray.M;
            hitZ = ray.z + t * ray.N;
          }
        }
      }

      // Compute normal vector at hit point pointing outwards from surface center
      normX = (hitX - 0) / R;
      normY = (hitY - 0) / R;
      normZ = (hitZ - zC) / R;
      const nLen = Math.sqrt(normX * normX + normY * normY + normZ * normZ) || 1.0;
      normX /= nLen;
      normY /= nLen;
      normZ /= nLen;

      // Orient normal to face opposite to the incident ray
      const dotRN = ray.L * normX + ray.M * normY + ray.N * normZ;
      if (dotRN > 0) {
        normX = -normX;
        normY = -normY;
        normZ = -normZ;
      }
    }

    // Check clear aperture clipping
    const rHit = Math.sqrt(hitX * hitX + hitY * hitY);
    if (rHit > clearRad) {
      ray.isTerminated = true;
      return ray;
    }

    // Update ray position and optical path length
    ray.opl += t * n1;
    ray.x = hitX;
    ray.y = hitY;
    ray.z = hitZ;
    ray.path.push([hitX, hitY, hitZ]);

    // 3. Vector Snell's Law Refraction
    // cos(theta1) = -(S . N)
    const cosI = -(ray.L * normX + ray.M * normY + ray.N * normZ);
    const mu = n1 / n2;
    const sinT2 = mu * mu * (1.0 - cosI * cosI);

    if (sinT2 > 1.0) {
      // Total Internal Reflection (TIR)
      ray.isTIR = true;
      // Reflection: S' = S + 2*cosI*N
      ray.L = ray.L + 2.0 * cosI * normX;
      ray.M = ray.M + 2.0 * cosI * normY;
      ray.N = ray.N + 2.0 * cosI * normZ;
      return ray;
    }

    const cosT = Math.sqrt(Math.max(0, 1.0 - sinT2));
    const gamma = mu * cosI - cosT;

    ray.L = mu * ray.L + gamma * normX;
    ray.M = mu * ray.M + gamma * normY;
    ray.N = mu * ray.N + gamma * normZ;

    // Normalize direction vector
    const sLen = Math.sqrt(ray.L * ray.L + ray.M * ray.M + ray.N * ray.N) || 1.0;
    ray.L /= sLen;
    ray.M /= sLen;
    ray.N /= sLen;

    return ray;
  }

  /**
   * Traces a bundle of rays through an optical system description.
   * @param {Object[]} surfaces Array of sequential optical surfaces
   * @param {Object[]} rays Array of initial rays
   * @param {number} sensorZ z-plane position of sensor/image plane
   */
  static traceOpticalSystem(surfaces, rays, sensorZ) {
    const results = [];

    for (let i = 0; i < rays.length; i++) {
      const ray = {
        ...rays[i],
        path: [...rays[i].path]
      };

      for (let s = 0; s < surfaces.length; s++) {
        this.traceRayThroughSurface(ray, surfaces[s]);
        if (ray.isTerminated) break;
      }

      // Propagate remaining active ray to sensor plane
      if (!ray.isTerminated && sensorZ !== undefined) {
        const sensorSurface = {
          radius: 0,
          zVertex: sensorZ,
          nIncident: 1.0,
          nTransmitted: 1.0,
          clearRadius: 1e6
        };
        this.traceRayThroughSurface(ray, sensorSurface);
      }

      results.push(ray);
    }

    return results;
  }

  /**
   * Generates a circular/annular grid of skew rays entering the entrance pupil.
   * @param {number} pupilRadiusMm Clear entrance pupil radius (mm)
   * @param {number} numRings Number of radial pupil zones
   * @param {number} raysPerRing Number of angular rays per ring
   * @param {number} fieldAngleDeg Field angle (0 for on-axis, e.g. 10 deg for off-axis)
   * @param {number} wavelengthUm Wavelength in microns
   */
  static generatePupilRayGrid(pupilRadiusMm = 15.0, numRings = 5, raysPerRing = 12, fieldAngleDeg = 0.0, wavelengthUm = 0.5875618) {
    const rays = [];
    const radAngle = (fieldAngleDeg * Math.PI) / 180.0;
    const sinField = Math.sin(radAngle);
    const cosField = Math.cos(radAngle);

    // Chief ray (center of pupil)
    rays.push(this.createRay([0, 0, -10.0], [0, sinField, cosField], wavelengthUm, 1.0));

    // Marginal and zonal rings
    for (let r = 1; r <= numRings; r++) {
      const rho = (r / numRings) * pupilRadiusMm;
      const count = r * raysPerRing;

      for (let a = 0; a < count; a++) {
        const theta = (2 * Math.PI * a) / count;
        const xPupil = rho * Math.cos(theta);
        const yPupil = rho * Math.sin(theta);

        // Ray starts at z = -10mm pointing towards pupil with field angle tilt
        rays.push(this.createRay([xPupil, yPupil, -10.0], [0, sinField, cosField], wavelengthUm, 1.0));
      }
    }

    return rays;
  }

  /**
   * Computes Spot Diagram statistics on the image sensor plane.
   * @param {Object[]} tracedRays Resulting traced rays
   */
  static computeSpotDiagram(tracedRays) {
    const validPoints = [];

    for (let i = 0; i < tracedRays.length; i++) {
      const r = tracedRays[i];
      if (!r.isTerminated && r.path.length > 0) {
        const lastPt = r.path[r.path.length - 1];
        validPoints.push({ x: lastPt[0], y: lastPt[1], z: lastPt[2] });
      }
    }

    if (validPoints.length === 0) {
      return {
        count: 0,
        centroidX: 0,
        centroidY: 0,
        rmsSpotRadiusMm: 0,
        geometricRadiusMm: 0,
        points: []
      };
    }

    // 1. Centroid
    let sumX = 0, sumY = 0;
    for (let i = 0; i < validPoints.length; i++) {
      sumX += validPoints[i].x;
      sumY += validPoints[i].y;
    }
    const cX = sumX / validPoints.length;
    const cY = sumY / validPoints.length;

    // 2. RMS and Geo radii
    let sumSq = 0;
    let maxDist = 0;

    for (let i = 0; i < validPoints.length; i++) {
      const dx = validPoints[i].x - cX;
      const dy = validPoints[i].y - cY;
      const d2 = dx * dx + dy * dy;
      sumSq += d2;
      const d = Math.sqrt(d2);
      if (d > maxDist) maxDist = d;
    }

    const rmsRadius = Math.sqrt(sumSq / validPoints.length);

    return {
      count: validPoints.length,
      centroidX: Number(cX.toFixed(5)),
      centroidY: Number(cY.toFixed(5)),
      rmsSpotRadiusMm: Number(rmsRadius.toFixed(5)),
      rmsRadiusMm: Number(rmsRadius.toFixed(5)),
      geometricRadiusMm: Number(maxDist.toFixed(5)),
      geoRadiusMm: Number(maxDist.toFixed(5)),
      points: validPoints,
      spots: validPoints
    };
  }

  /**
   * Computes Tangential and Sagittal Modulation Transfer Function (MTF)
   * up to spatial frequency maxLpMm (e.g. 120 lines/mm).
   * @param {number} rmsSpotRadiusMm RMS Spot Radius from ray trace
   * @param {number} fStop Lens numerical aperture f-number
   * @param {number} maxLpMm Max spatial frequency (lp/mm)
   */
  static computeMTFCurve(rmsSpotRadiusMm = 0.015, fStop = 1.4, maxLpMm = 120, wavelengthNm = 550) {
    const lambdaMm = wavelengthNm * 1e-6;
    const cutoffFreqLpMm = 1.0 / (lambdaMm * fStop); // Diffraction cutoff = 1 / (λ * N)

    const frequencies = [];
    const tangentialMTF = [];
    const sagittalMTF = [];
    const diffractionLimitMTF = [];

    const steps = 30;
    const deltaNu = maxLpMm / steps;

    // Transverse ray aberration variance approximation:
    // MTF_geom(nu) ≈ exp(-2 * pi^2 * sigma^2 * nu^2)
    const sigmaT = Math.max(0.001, rmsSpotRadiusMm * 1.15); // Tangential has higher coma/astigmatism
    const sigmaS = Math.max(0.001, rmsSpotRadiusMm * 0.85); // Sagittal

    for (let i = 0; i <= steps; i++) {
      const nu = i * deltaNu;
      frequencies.push(Number(nu.toFixed(1)));

      // 1. Diffraction limit: 2/pi * (arccos(nu/nu0) - nu/nu0 * sqrt(1 - (nu/nu0)^2))
      let mtfDiff = 1.0;
      if (nu >= cutoffFreqLpMm) {
        mtfDiff = 0.0;
      } else {
        const u = nu / cutoffFreqLpMm;
        mtfDiff = (2.0 / Math.PI) * (Math.acos(u) - u * Math.sqrt(1.0 - u * u));
      }
      diffractionLimitMTF.push(Number(Math.max(0, mtfDiff).toFixed(4)));

      // 2. Geometric MTF roll-off due to optical aberrations
      const mtfGeomT = Math.exp(-2.0 * Math.PI * Math.PI * sigmaT * sigmaT * nu * nu);
      const mtfGeomS = Math.exp(-2.0 * Math.PI * Math.PI * sigmaS * sigmaS * nu * nu);

      tangentialMTF.push(Number(Math.max(0, Math.min(mtfDiff, mtfDiff * mtfGeomT)).toFixed(4)));
      sagittalMTF.push(Number(Math.max(0, Math.min(mtfDiff, mtfDiff * mtfGeomS)).toFixed(4)));
    }

    return {
      cutoffFreqLpMm: Math.round(cutoffFreqLpMm),
      frequencies,
      tangentialMTF,
      sagittalMTF,
      diffractionLimitMTF,
      mtf50TangentialLpMm: this._findMTFFrequency(frequencies, tangentialMTF, 0.5),
      mtf50SagittalLpMm: this._findMTFFrequency(frequencies, sagittalMTF, 0.5)
    };
  }

  static _findMTFFrequency(freqs, mtfVals, target = 0.5) {
    for (let i = 0; i < mtfVals.length - 1; i++) {
      if (mtfVals[i] >= target && mtfVals[i + 1] <= target) {
        const frac = (target - mtfVals[i]) / (mtfVals[i + 1] - mtfVals[i]);
        return Number((freqs[i] + frac * (freqs[i + 1] - freqs[i])).toFixed(1));
      }
    }
    return mtfVals[mtfVals.length - 1] >= target ? freqs[freqs.length - 1] : 0.0;
  }

  /**
   * Traces a single ray and returns point segments.
   */
  static traceRay(surfaces, rayInput) {
    const o = rayInput.origin ? [rayInput.origin.x, rayInput.origin.y, rayInput.origin.z] : [rayInput.x || 0, rayInput.y || 0, rayInput.z || 0];
    const d = rayInput.dir ? [rayInput.dir.x, rayInput.dir.y, rayInput.dir.z] : [rayInput.L || 0, rayInput.M || 0, rayInput.N || 1];
    const wl = rayInput.wavelength || rayInput.wavelengthUm || 0.5875618;
    const ray = this.createRay(o, d, wl, 1.0);

    let currentZ = 0;
    const normSurfaces = surfaces.map((s, idx) => {
      const radius = s.radius !== undefined ? s.radius : (s.radiusMm || 0);
      const thickness = s.thickness !== undefined ? s.thickness : (s.thicknessMm || 0);
      const zVertex = s.zVertex !== undefined ? s.zVertex : currentZ;
      currentZ += thickness;
      const { nIncident, nTransmitted } = s;
      if (![nIncident, nTransmitted].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
        throw new TypeError(`Surface ${idx} requires explicit positive incident and transmitted refractive indices.`);
      }
      return {
        radius,
        zVertex,
        clearRadius: s.clearRadius || (s.clearAperture ? s.clearAperture / 2 : 100),
        nIncident,
        nTransmitted,
        conic: s.conic || 0,
        asphericCoeffs: s.asphericCoeffs || [0, 0, 0, 0]
      };
    });

    const segments = [{ p: { x: ray.x, y: ray.y, z: ray.z }, d: { x: ray.L, y: ray.M, z: ray.N } }];
    for (const s of normSurfaces) {
      this.traceRayThroughSurface(ray, s);
      segments.push({ p: { x: ray.x, y: ray.y, z: ray.z }, d: { x: ray.L, y: ray.M, z: ray.N } });
      if (ray.isTerminated) break;
    }
    return segments;
  }

  static traceRayBundle(surfaces, rays, sensorZ = 75.0) {
    return this.traceOpticalSystem(surfaces, rays, sensorZ);
  }

  static generateEntrancePupilRayGrid(epRadius = 15.0, wavelength = 0.5875618, numRings = 3, numArms = 8) {
    return this.generatePupilRayGrid(epRadius, numRings, numArms, 0.0, wavelength);
  }

  static computeMTF(spotData, maxSpatialFreqLpMm = 100.0, steps = 10) {
    const rms = spotData.rmsSpotRadiusMm !== undefined ? spotData.rmsSpotRadiusMm : (spotData.rmsRadiusMm || 0.015);
    const mtfRes = this.computeMTFCurve(rms, 1.4, maxSpatialFreqLpMm);
    const mtfArray = [];
    const delta = Math.floor(mtfRes.frequencies.length / steps) || 1;
    for (let i = 0; i < mtfRes.frequencies.length; i += delta) {
      mtfArray.push({
        freq: mtfRes.frequencies[i],
        tangential: mtfRes.tangentialMTF[i],
        sagittal: mtfRes.sagittalMTF[i]
      });
      if (mtfArray.length > steps) break;
    }
    return mtfArray;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SkewRayTracer };
}
