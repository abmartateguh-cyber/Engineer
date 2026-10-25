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
      paths: completedPaths,
      detectorHits
    };
  }
}

module.exports = {
  OpticalRay,
  NonSequentialTracer
};
