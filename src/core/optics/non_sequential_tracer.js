/**
 * OmniEng Non-Sequential Optical Ray Tracer with Fresnel Splitting & Ghost Analysis
 * 
 * Experimental non-sequential ray interaction example:
 * 1. Non-sequential ray-object interactions (rays can hit surfaces in any arbitrary physical order).
 * 2. Energy conservation via Fresnel power splitting:
 *    - Transmitted ray energy T = 1 - R.
 *    - Reflected daughter ray energy R with recursive branch tracing.
 * 3. Total Internal Reflection (TIR) detection.
 * 4. Ghost reflection and stray light irradiance accumulation on detector planes.
 * 
 * No independent optical validation or comparison to a production ray tracer is established.
 */

'use strict';

class OpticalRay {
  constructor(origin = { x: 0, y: 0, z: 0 }, dir = { x: 0, y: 0, z: 1 }, energy = 1.0, wavelengthNm = 550.0) {
    this.origin = { ...origin };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1.0;
    this.dir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    this.energy = energy; // Normalized flux (1.0 = 100%)
    this.wavelengthNm = wavelengthNm;
    this.generation = 0; // Tree depth for split daughter rays
  }
}

class NonSequentialTracer {
  /**
   * Single-interface vector Snell/Fresnel computation.
   *
   * @param {Object} incidentDir - unit direction of the incident ray
   * @param {Object} normal - surface normal (any orientation; it is flipped so it
   *   points opposite the incident ray when needed)
   * @param {number} n1 - refractive index of the incident (initial) medium
   * @param {number} n2 - refractive index of the transmitting medium
   * @returns {Object} { incidentDir, normalUsed, cosI, sinTheta2, tir,
   *   reflectedDir, refractedDir (null when TIR), reflectanceR, transmittanceT }
   */
  static traceInterface(incidentDir, normal, n1, n2) {
    if (!incidentDir || !normal) {
      throw new TypeError('traceInterface requires incidentDir and normal vectors');
    }
    for (const v of [incidentDir, normal]) {
      for (const k of ['x', 'y', 'z']) {
        if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) {
          throw new TypeError('traceInterface vectors must have finite x, y, z components');
        }
      }
    }
    if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 <= 0 || n2 <= 0) {
      throw new RangeError('traceInterface requires positive finite refractive indices');
    }

    const dirLen = Math.hypot(incidentDir.x, incidentDir.y, incidentDir.z);
    const normLen = Math.hypot(normal.x, normal.y, normal.z);
    if (dirLen === 0 || normLen === 0) {
      throw new RangeError('traceInterface requires non-zero incident and normal vectors');
    }
    const d = { x: incidentDir.x / dirLen, y: incidentDir.y / dirLen, z: incidentDir.z / dirLen };
    let n = { x: normal.x / normLen, y: normal.y / normLen, z: normal.z / normLen };

    let cosI = -(d.x * n.x + d.y * n.y + d.z * n.z);
    let nInc = n1;
    let nTrans = n2;
    if (cosI < 0) {
      cosI = -cosI;
      n = { x: -n.x, y: -n.y, z: -n.z };
      const tmp = nInc;
      nInc = nTrans;
      nTrans = tmp;
    }

    const reflectedDir = {
      x: d.x + 2.0 * cosI * n.x,
      y: d.y + 2.0 * cosI * n.y,
      z: d.z + 2.0 * cosI * n.z
    };

    if (nInc === nTrans) {
      return {
        incidentDir: d,
        normalUsed: n,
        cosI,
        sinTheta2: 0,
        tir: false,
        reflectedDir,
        refractedDir: { ...d },
        reflectanceR: 0,
        transmittanceT: 1
      };
    }

    const eta = nInc / nTrans;
    const sinT2 = eta * eta * (1.0 - cosI * cosI);
    if (sinT2 > 1.0) {
      return {
        incidentDir: d,
        normalUsed: n,
        cosI,
        sinTheta2: sinT2,
        tir: true,
        reflectedDir,
        refractedDir: null,
        reflectanceR: 1,
        transmittanceT: 0
      };
    }

    const cosT = Math.sqrt(1.0 - sinT2);
    const rs = (nInc * cosI - nTrans * cosT) / (nInc * cosI + nTrans * cosT);
    const rp = (nTrans * cosI - nInc * cosT) / (nTrans * cosI + nInc * cosT);
    const R = 0.5 * (rs * rs + rp * rp);
    const T = 1.0 - R;

    const refractedDir = {
      x: eta * d.x + (eta * cosI - cosT) * n.x,
      y: eta * d.y + (eta * cosI - cosT) * n.y,
      z: eta * d.z + (eta * cosI - cosT) * n.z
    };

    return {
      incidentDir: d,
      normalUsed: n,
      cosI,
      sinTheta2: sinT2,
      tir: false,
      reflectedDir,
      refractedDir,
      reflectanceR: R,
      transmittanceT: T
    };
  }

  /**
   * Traces an optical beam through a non-sequential collection of optical surfaces
   * @param {OpticalRay} initialRay
   * @param {Array<Object>} surfaces Array of optical elements with intersectRay(ray) and getNormal(point)
   * @param {Object} options
   * @param {number} [options.maxSplits=4] - Maximum ray splitting generation depth
   * @param {number} [options.energyThreshold=0.005] - Ray termination energy cutoff (0.5%)
   * @returns {{rayPaths: Array<Object>, totalRaysTraced: number, detectorHits: Array<Object>}}
   */
  static traceBeam(initialRay, surfaces = [], options = {}) {
    const maxSplits = options.maxSplits !== undefined ? options.maxSplits : 4;
    const energyThreshold = options.energyThreshold || 0.005;

    const activeRays = [initialRay];
    const completedPaths = [];
    const detectorHits = [];
    const tirEvents = [];
    let totalRaysTraced = 0;

    while (activeRays.length > 0) {
      const ray = activeRays.pop();
      totalRaysTraced++;

      // Find earliest forward intersection across all non-sequential surfaces
      let closestHit = null;
      let minDistance = Infinity;

      for (const surf of surfaces) {
        const hit = surf.intersectRay ? surf.intersectRay(ray) : null;
        if (hit && hit.hit && hit.distance > 1e-5 && hit.distance < minDistance) {
          minDistance = hit.distance;
          closestHit = { ...hit, surface: surf };
        }
      }

      if (!closestHit) {
        // Ray escapes into free space
        completedPaths.push({
          start: ray.origin,
          end: {
            x: ray.origin.x + 200.0 * ray.dir.x,
            y: ray.origin.y + 200.0 * ray.dir.y,
            z: ray.origin.z + 200.0 * ray.dir.z
          },
          energy: ray.energy
        });
        continue;
      }

      completedPaths.push({
        start: ray.origin,
        end: closestHit.point,
        energy: ray.energy
      });

      if (closestHit.surface.isDetector) {
        detectorHits.push({
          point: closestHit.point,
          energy: ray.energy,
          wavelengthNm: ray.wavelengthNm
        });
        continue; // Absorbed by detector
      }

      if (ray.generation >= maxSplits || ray.energy < energyThreshold) {
        continue; // Reached recursion limit
      }

      // Compute Fresnel reflection and refraction
      const normal = closestHit.normal;
      let cosI = -(ray.dir.x * normal.x + ray.dir.y * normal.y + ray.dir.z * normal.z);
      let n1 = closestHit.surface.nIncident || 1.0;
      let n2 = closestHit.surface.nRefractive || 1.52;

      let normX = normal.x, normY = normal.y, normZ = normal.z;
      if (cosI < 0) {
        // Ray is hitting from inside the medium
        cosI = -cosI;
        normX = -normX; normY = -normY; normZ = -normZ;
        const tmp = n1; n1 = n2; n2 = tmp;
      }

      const eta = n1 / n2;
      const sinT2 = eta * eta * (1.0 - cosI * cosI);

      if (sinT2 > 1.0) {
        // Total Internal Reflection (TIR): 100% reflected
        const reflDir = {
          x: ray.dir.x + 2.0 * cosI * normX,
          y: ray.dir.y + 2.0 * cosI * normY,
          z: ray.dir.z + 2.0 * cosI * normZ
        };
        tirEvents.push({
          point: closestHit.point,
          direction: reflDir,
          energy: ray.energy,
          wavelengthNm: ray.wavelengthNm,
          nIncident: n1,
          nRefractive: n2,
          cosI
        });
        const tirRay = new OpticalRay(closestHit.point, reflDir, ray.energy, ray.wavelengthNm);
        tirRay.generation = ray.generation + 1;
        activeRays.push(tirRay);
        continue;
      }

      const cosT = Math.sqrt(1.0 - sinT2);

      // Fresnel reflection coefficient (unpolarized)
      const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
      const rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
      const R = 0.5 * (rs * rs + rp * rp);
      const T = 1.0 - R;

      // 1. Reflected daughter ray
      if (R * ray.energy >= energyThreshold) {
        const reflDir = {
          x: ray.dir.x + 2.0 * cosI * normX,
          y: ray.dir.y + 2.0 * cosI * normY,
          z: ray.dir.z + 2.0 * cosI * normZ
        };
        const reflRay = new OpticalRay(closestHit.point, reflDir, R * ray.energy, ray.wavelengthNm);
        reflRay.generation = ray.generation + 1;
        activeRays.push(reflRay);
      }

      // 2. Transmitted daughter ray
      if (T * ray.energy >= energyThreshold) {
        const transDir = {
          x: eta * ray.dir.x + (eta * cosI - cosT) * normX,
          y: eta * ray.dir.y + (eta * cosI - cosT) * normY,
          z: eta * ray.dir.z + (eta * cosI - cosT) * normZ
        };
        const transRay = new OpticalRay(closestHit.point, transDir, T * ray.energy, ray.wavelengthNm);
        transRay.generation = ray.generation + 1;
        activeRays.push(transRay);
      }
    }

    return {
      totalRaysTraced,
      pathsCount: completedPaths.length,
      detectorHitsCount: detectorHits.length,
      tirEventsCount: tirEvents.length,
      paths: completedPaths,
      detectorHits,
      tirEvents
    };
  }
}

module.exports = {
  OpticalRay,
  NonSequentialTracer
};
