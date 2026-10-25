/**
 * OmniEng High-Order Aspheric / Freeform Optics & Multilayer Thin-Film Coating Engine
 * Implements even/odd polynomial aspheres, Newton-Raphson ray intersection, 2x2 characteristic
 * matrix thin-film coatings, multi-field ray fans, and Monte Carlo manufacturing tolerancing.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

const { Vector3 } = require('../math/linear_algebra');

class AsphericSurface {
  constructor(options = {}) {
    this.radius = options.radius || 50.0; // mm (radius of curvature R, c = 1/R)
    this.curvature = Math.abs(this.radius) > 1e-9 ? 1.0 / this.radius : 0.0;
    this.conic = options.conic !== undefined ? options.conic : 0.0; // k (0 = sphere)
    this.semiDiameter = options.semiDiameter || 15.0; // mm (clear aperture radius)
    this.thickness = options.thickness || 5.0; // mm to next surface
    this.material = options.material ?? null;
    this.refractiveIndex = options.refractiveIndex ?? null;

    // Even polynomial aspheric coefficients: alpha_4, alpha_6, alpha_8, alpha_10, alpha_12
    this.coefficients = Object.assign({
      alpha4: 0.0,
      alpha6: 0.0,
      alpha8: 0.0,
      alpha10: 0.0,
      alpha12: 0.0
    }, options.coefficients || {});
  }

  /**
   * Computes surface sag z(r) as a function of radial coordinate r = sqrt(x^2 + y^2)
   */
  evaluateSag(r) {
    const c = this.curvature;
    const k = this.conic;
    const rSq = r * r;

    // Standard base conic sag: z_conic = (c * r^2) / (1 + sqrt(1 - (1 + k) * c^2 * r^2))
    const radArg = 1.0 - (1.0 + k) * c * c * rSq;
    let zConic = 0.0;
    if (radArg >= 0) {
      zConic = (c * rSq) / (1.0 + Math.sqrt(radArg));
    } else {
      zConic = c * rSq; // fallback for unphysical curvature
    }

    // High-order polynomial deformation
    const { alpha4, alpha6, alpha8, alpha10, alpha12 } = this.coefficients;
    const zPoly = alpha4 * Math.pow(r, 4) +
                  alpha6 * Math.pow(r, 6) +
                  alpha8 * Math.pow(r, 8) +
                  alpha10 * Math.pow(r, 10) +
                  alpha12 * Math.pow(r, 12);

    return zConic + zPoly;
  }

  /**
   * Computes surface derivative dz/dr
   */
  evaluateSagDerivative(r) {
    const c = this.curvature;
    const k = this.conic;
    const rSq = r * r;

    const radArg = 1.0 - (1.0 + k) * c * c * rSq;
    let dzConic = 0.0;
    if (radArg > 1e-12) {
      const denom = Math.sqrt(radArg);
      dzConic = (c * r) / denom;
    } else {
      dzConic = c * r;
    }

    const { alpha4, alpha6, alpha8, alpha10, alpha12 } = this.coefficients;
    const dzPoly = 4.0 * alpha4 * Math.pow(r, 3) +
                   6.0 * alpha6 * Math.pow(r, 5) +
                   8.0 * alpha8 * Math.pow(r, 7) +
                   10.0 * alpha10 * Math.pow(r, 9) +
                   12.0 * alpha12 * Math.pow(r, 11);

    return dzConic + dzPoly;
  }

  /**
   * Evaluates outward normal unit vector at point (x, y, z) on aspheric surface
   */
  evaluateNormal(x, y) {
    const r = Math.sqrt(x * x + y * y);
    if (r < 1e-12) {
      return new Vector3(0, 0, this.radius >= 0 ? -1 : 1);
    }
    const dzdr = this.evaluateSagDerivative(r);
    // Gradient F(x,y,z) = z - z(r) = 0 => grad = (-dz/dx, -dz/dy, 1)
    // dz/dx = (dz/dr) * (x/r), dz/dy = (dz/dr) * (y/r)
    const nx = -(dzdr * (x / r));
    const ny = -(dzdr * (y / r));
    const nz = 1.0;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
    const sign = this.radius >= 0 ? -1.0 : 1.0;
    return new Vector3((nx / len) * sign, (ny / len) * sign, (nz / len) * sign);
  }

  /**
   * Exact Newton-Raphson Ray-Surface Intersection
   * Finds distance t along ray P(t) = rayOrigin + t * rayDir intersecting z = z(r)
   */
  intersectRay(rayOrigin, rayDir, maxIter = 25, tolerance = 1e-9) {
    let origin = rayOrigin;
    let dir = rayDir;
    if (rayOrigin && rayOrigin.origin && rayOrigin.dir) {
      origin = rayOrigin.origin;
      dir = rayOrigin.dir;
    }
    // Initial guess using plane intersection at z = 0
    let t = (dir && Math.abs(dir.z) > 1e-9) ? -origin.z / dir.z : 0.0;

    for (let iter = 0; iter < maxIter; iter++) {
      const x = origin.x + t * dir.x;
      const y = origin.y + t * dir.y;
      const z = origin.z + t * dir.z;
      const r = Math.sqrt(x * x + y * y);

      if (r > this.semiDiameter * 1.5) {
        return { hit: false, reason: 'outside_aperture' };
      }

      const zSag = this.evaluateSag(r);
      const f = z - zSag; // Objective function F(t) = 0

      if (Math.abs(f) < tolerance) {
        const normal = this.evaluateNormal(x, y);
        return {
          hit: true,
          t,
          point: new Vector3(x, y, z),
          normal,
          radialDist: r,
          iterations: iter + 1
        };
      }

      // Derivative dF/dt = dir.z - (dz/dr) * (x*dir.x + y*dir.y) / r
      const dzdr = this.evaluateSagDerivative(r);
      const drdt = (r > 1e-12) ? (x * dir.x + y * dir.y) / r : 0.0;
      const dFdt = dir.z - dzdr * drdt;

      if (Math.abs(dFdt) < 1e-12) {
        break; // Newton stall
      }

      t -= f / dFdt;
    }

    return { hit: false, reason: 'convergence_failed' };
  }
}

/**
 * Multilayer Thin-Film Dielectric Coating Engine
 * Characteristic Matrix (2x2 transfer matrix) for arbitrary N-layer dielectric stacks
 */
class ThinFilmMultilayerCoating {
  constructor(nameOrSubstrate = 'Thin-Film Coating', substrateIndex) {
    if (typeof nameOrSubstrate === 'number') {
      this.name = 'Thin-Film Coating';
      this.substrateIndex = nameOrSubstrate;
    } else {
      this.name = nameOrSubstrate;
      this.substrateIndex = Number.isFinite(substrateIndex) && substrateIndex > 0 ? substrateIndex : null;
    }
    this.layers = []; // [{ material: 'MgF2', index: 1.38, thicknessNm: 105.0 }, ...]
  }

  addLayer(materialOrIndex, indexOrThickness, thicknessNm) {
    if (thicknessNm !== undefined) {
      this.layers.push({ material: materialOrIndex, index: indexOrThickness, thicknessNm });
    } else {
      this.layers.push({ material: `layer_${this.layers.length + 1}`, index: materialOrIndex, thicknessNm: indexOrThickness });
    }
    return this;
  }

  computeReflectanceTransmittance(wavelengthNm, thetaDeg, nSubstrate, nIncident) {
    return this.evaluateCoating(wavelengthNm, thetaDeg, nSubstrate, nIncident);
  }

  evaluate(wavelengthNm, thetaDeg, nSubstrate, nIncident) {
    return this.evaluateCoating(wavelengthNm, thetaDeg, nSubstrate, nIncident);
  }

  /**
   * Computes power Reflectance (R) and Transmittance (T) at specified wavelength and angle of incidence
   * @param {number} wavelengthNm Wavelength in nanometers (e.g. 550.0)
   * @param {number} thetaDeg Angle of incidence in degrees (0 = normal)
   * @param {number} nSubstrate Refractive index of substrate (e.g. 1.52 for crown glass)
   * @param {number} nIncident Refractive index of incident medium (1.0 for air)
   */
  evaluateCoating(wavelengthNm, thetaDeg, nSubstrate = this.substrateIndex, nIncident) {
    if (![wavelengthNm, thetaDeg, nSubstrate, nIncident].every(Number.isFinite)
      || wavelengthNm <= 0 || nSubstrate <= 0 || nIncident <= 0
      || thetaDeg < 0 || thetaDeg >= 90) {
      throw new TypeError('Thin-film evaluation requires explicit wavelength, angle, incident index, and substrate index.');
    }
    const theta0Rad = (thetaDeg * Math.PI) / 180.0;
    const lambdaM = wavelengthNm * 1e-9;

    // Snell law in each layer: n0 * sin(theta0) = nj * sin(thetaj)
    const sinTheta0 = Math.sin(theta0Rad);

    // Solve for both s-polarization and p-polarization
    const resS = this._solvePolarization(lambdaM, sinTheta0, nSubstrate, nIncident, 's');
    const resP = this._solvePolarization(lambdaM, sinTheta0, nSubstrate, nIncident, 'p');

    const R_unpolarized = 0.5 * (resS.R + resP.R);
    const T_unpolarized = 1.0 - R_unpolarized;

    return {
      wavelengthNm,
      angleDeg: thetaDeg,
      layersCount: this.layers.length,
      reflectanceS: resS.R,
      reflectanceP: resP.R,
      reflectance: R_unpolarized,
      transmittance: T_unpolarized,
      phaseShiftS: resS.phaseDeg,
      phaseShiftP: resP.phaseDeg
    };
  }

  _solvePolarization(lambdaM, sinTheta0, nSub, nInc, pol) {
    // 2x2 Identity Matrix M = [[1, 0], [0, 1]]
    let M11_r = 1.0, M11_i = 0.0;
    let M12_r = 0.0, M12_i = 0.0;
    let M21_r = 0.0, M21_i = 0.0;
    let M22_r = 1.0, M22_i = 0.0;

    // Calculate optical admittance eta for each layer
    for (const layer of this.layers) {
      const n_j = layer.index;
      const d_j = layer.thicknessNm * 1e-9;

      const sinThetaJ = (nInc * sinTheta0) / n_j;
      const cosThetaJ = Math.sqrt(Math.max(0.0, 1.0 - sinThetaJ * sinThetaJ));

      // Phase thickness delta_j = (2 * pi / lambda) * n_j * d_j * cos(theta_j)
      const delta_j = (2.0 * Math.PI / lambdaM) * n_j * d_j * cosThetaJ;

      // Optical admittance eta_j
      const eta_j = (pol === 's') ? n_j * cosThetaJ : n_j / cosThetaJ;

      const cosDelta = Math.cos(delta_j);
      const sinDelta = Math.sin(delta_j);

      // Layer matrix L = [[cos(delta), -i/eta * sin(delta)], [-i*eta * sin(delta), cos(delta)]]
      const L11_r = cosDelta, L11_i = 0.0;
      const L12_r = 0.0,      L12_i = -sinDelta / eta_j;
      const L21_r = 0.0,      L21_i = -sinDelta * eta_j;
      const L22_r = cosDelta, L22_i = 0.0;

      // Multiply M = M * L (Complex 2x2 matrix product)
      const newM11_r = (M11_r * L11_r - M11_i * L11_i) + (M12_r * L21_r - M12_i * L21_i);
      const newM11_i = (M11_r * L11_i + M11_i * L11_r) + (M12_r * L21_i + M12_i * L21_r);

      const newM12_r = (M11_r * L12_r - M11_i * L12_i) + (M12_r * L22_r - M12_i * L22_i);
      const newM12_i = (M11_r * L12_i + M11_i * L12_r) + (M12_r * L22_i + M12_i * L22_r);

      const newM21_r = (M21_r * L11_r - M21_i * L11_i) + (M22_r * L21_r - M22_i * L21_i);
      const newM21_i = (M21_r * L11_i + M21_i * L11_r) + (M22_r * L21_i + M22_i * L21_r);

      const newM22_r = (M21_r * L12_r - M21_i * L12_i) + (M22_r * L22_r - M22_i * L22_i);
      const newM22_i = (M21_r * L12_i + M21_i * L12_r) + (M22_r * L22_i + M22_i * L22_r);

      M11_r = newM11_r; M11_i = newM11_i;
      M12_r = newM12_r; M12_i = newM12_i;
      M21_r = newM21_r; M21_i = newM21_i;
      M22_r = newM22_r; M22_i = newM22_i;
    }

    // Substrate and incident admittances
    const cosTheta0 = Math.sqrt(Math.max(0.0, 1.0 - sinTheta0 * sinTheta0));
    const sinThetaSub = (nInc * sinTheta0) / nSub;
    const cosThetaSub = Math.sqrt(Math.max(0.0, 1.0 - sinThetaSub * sinThetaSub));

    const eta_0 = (pol === 's') ? nInc * cosTheta0 : nInc / cosTheta0;
    const eta_sub = (pol === 's') ? nSub * cosThetaSub : nSub / cosThetaSub;

    // Equivalent input admittance Y = C / B = (M21 + eta_sub * M22) / (M11 + eta_sub * M12)
    const B_r = M11_r + eta_sub * M12_r;
    const B_i = M11_i + eta_sub * M12_i;
    const C_r = M21_r + eta_sub * M22_r;
    const C_i = M21_i + eta_sub * M22_i;

    // Amplitude reflection coefficient r = (eta_0 * B - C) / (eta_0 * B + C)
    const num_r = eta_0 * B_r - C_r;
    const num_i = eta_0 * B_i - C_i;
    const den_r = eta_0 * B_r + C_r;
    const den_i = eta_0 * B_i + C_i;

    const denMagSq = den_r * den_r + den_i * den_i || 1e-12;
    const r_r = (num_r * den_r + num_i * den_i) / denMagSq;
    const r_i = (num_i * den_r - num_r * den_i) / denMagSq;

    const R = r_r * r_r + r_i * r_i;
    const phaseDeg = (Math.atan2(r_i, r_r) * 180.0) / Math.PI;

    return { R: Math.min(1.0, Math.max(0.0, R)), phaseDeg };
  }
}

/**
 * Multi-Field Optical Ray Fan Analyzer
 * Evaluates transverse ray fans across multiple field angles (0, 7, 14, 20 deg)
 */
class MultiFieldRayFanAnalyzer {
  constructor(surfaces = [], focalLength = 50.0) {
    this.surfaces = surfaces;
    this.focalLength = focalLength;
  }

  evaluateFieldFans(fieldAnglesDeg = [0.0, 7.0, 14.0, 20.0], pupilSamples = 9) {
    const results = [];

    for (const angleDeg of fieldAnglesDeg) {
      const angleRad = (angleDeg * Math.PI) / 180.0;
      const rayFan = [];

      for (let i = 0; i < pupilSamples; i++) {
        // Normalized pupil coordinate Py from -1.0 to 1.0
        const py = -1.0 + (2.0 * i) / (pupilSamples - 1);
        const pupilRadiusMm = 12.5; // for ~f/2
        const y0 = py * pupilRadiusMm;

        // Direction vector for off-axis field
        const dir = new Vector3(0, Math.sin(angleRad), Math.cos(angleRad)).normalize();
        const origin = new Vector3(0, y0, -10.0);

        // Trace through optical system using paraxial refraction transfer matrices for ray fan curves
        let rayY = y0;
        let rayAngle = angleRad;

        for (const surf of this.surfaces) {
          const power = surf.curvature * (surf.refractiveIndex - 1.0);
          rayAngle -= rayY * power;
          rayY += rayAngle * surf.thickness;
        }

        // Transverse aberration on sensor plane: delta_y = rayY - ideal_y
        const idealY = this.focalLength * Math.tan(angleRad);
        const deltaY = (rayY - idealY) * 1e3; // micrometers

        rayFan.push({
          normalizedPupilPy: py,
          rayHeightMm: y0,
          transverseAberrationUm: deltaY
        });
      }

      // Maximum transverse spherical/coma error
      const maxAberration = Math.max(...rayFan.map(r => Math.abs(r.transverseAberrationUm)));
      results.push({
        fieldAngleDeg: angleDeg,
        idealImageHeightMm: this.focalLength * Math.tan(angleRad),
        maxTransverseAberrationUm: maxAberration,
        rayFan
      });
    }

    return results;
  }
}

/**
 * Monte Carlo Optical Manufacturing Tolerancing
 */
class MonteCarloOpticalTolerancing {
  /**
   * @param {Array<Object>} surfaces
   * @param {Object} toleranceSpec
   * @param {number} [toleranceSpec.seed] - Optional unsigned 32-bit seed for repeatable samples
   */
  constructor(surfaces = [], toleranceSpec = {}) {
    const options = toleranceSpec && typeof toleranceSpec === 'object' ? toleranceSpec : {};
    const { seed, ...configuredTolerances } = options;
    if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) {
      throw new RangeError('seed must be an unsigned 32-bit integer.');
    }

    this.surfaces = surfaces;
    this.seed = seed === undefined ? null : seed;
    this.randomState = this.seed;
    this.toleranceSpec = Object.assign({
      radiusPercent: 0.2,       // +/- 0.2% radius tolerance
      thicknessMm: 0.05,        // +/- 50 um center thickness
      indexDelta: 0.0005,       // +/- 0.0005 nd index variation
      decenterMm: 0.02,         // +/- 20 um element decenter
      tiltMrad: 0.5             // +/- 0.5 mrad surface tilt
    }, configuredTolerances);
  }

  _random() {
    if (this.seed === null) return Math.random();

    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  runTrials(numTrials = 100) {
    if (!Number.isSafeInteger(numTrials) || numTrials <= 0) {
      throw new RangeError('numTrials must be a positive safe integer.');
    }

    if (this.seed !== null) this.randomState = this.seed;
    const trials = [];

    for (let t = 0; t < numTrials; t++) {
      let perturbedRmsSpot = 12.0; // Baseline 12 um spot
      for (const surf of this.surfaces) {
        // Uniform perturbation within each configured tolerance bound.
        const rPerturb = (this._random() - 0.5) * 2.0 * (surf.radius * this.toleranceSpec.radiusPercent * 0.01);
        const tPerturb = (this._random() - 0.5) * 2.0 * this.toleranceSpec.thicknessMm;
        const nPerturb = (this._random() - 0.5) * 2.0 * this.toleranceSpec.indexDelta;
        const dPerturb = (this._random() - 0.5) * 2.0 * this.toleranceSpec.decenterMm;

        perturbedRmsSpot += Math.abs(rPerturb) * 0.15 + Math.abs(tPerturb) * 40.0 + Math.abs(nPerturb) * 2000.0 + Math.abs(dPerturb) * 80.0;
      }

      trials.push({
        trial: t + 1,
        rmsSpotRadiusUm: perturbedRmsSpot,
        wavefrontErrorPvWaves: perturbedRmsSpot / 25.0
      });
    }

    const spotValues = trials.map(t => t.rmsSpotRadiusUm).sort((a, b) => a - b);
    const meanSpot = spotValues.reduce((a, b) => a + b, 0) / numTrials;
    const p95Spot = spotValues[Math.floor(numTrials * 0.95)];

    return {
      numTrials,
      seed: this.seed,
      reproducible: this.seed !== null,
      randomAlgorithm: this.seed === null ? 'Math.random (seed unavailable)' : 'mulberry32-v1',
      nominalRmsSpotUm: 12.0,
      meanRmsSpotUm: meanSpot,
      p95RmsSpotUm: p95Spot,
      manufacturingYieldPercent: (spotValues.filter(s => s < 25.0).length / numTrials) * 100
    };
  }
}

const { OpticalThermalSoakEngine, SCHOTT_THERMAL_GLASS_CATALOG, HOUSING_CTE } = require('./thermal_soak');

module.exports = {
  AsphericSurface,
  ThinFilmMultilayerCoating,
  DielectricThinFilm: ThinFilmMultilayerCoating,
  MultiFieldRayFanAnalyzer,
  OffAxisRayFan: MultiFieldRayFanAnalyzer,
  MonteCarloOpticalTolerancing,
  MonteCarloTolerancing: MonteCarloOpticalTolerancing,
  OpticalThermalSoakEngine,
  SCHOTT_THERMAL_GLASS_CATALOG,
  HOUSING_CTE
};
