/**
 * OmniEng 3rd-Order Seidel Aberration Solver
 * Standard: Classical Conrady / Hopkins Primary Aberration Sums
 * Industrial Parity: Zemax OpticStudio / SYNOPSYS CODE V Seidel coefficients.
 */

const { OpticalMaterials } = require('./optical_materials');

class SeidelAberrations {
  /**
   * Evaluates the 3rd-order Seidel aberration coefficients for a coaxial optical system.
   * @param {Object[]} surfaces Array of surfaces with:
   *   radius: Curvature radius (mm)
   *   thickness: Center distance to next surface (mm)
   *   glassKey: Material name (e.g. 'Schott_NBK7', 'Air')
   *   conic: Conic constant k (optional)
   *   asphericA4: 4th-order aspheric coefficient (optional)
   * @param {number} entrancePupilRadiusMm Clear semi-diameter of entrance pupil (y1)
   * @param {number} fieldAngleDeg Maximum semi-field angle (degrees)
   */
  static computeSeidelCoefficients(surfaces, entrancePupilRadiusMm = 17.85, fieldAngleDeg = 23.4) {
    const K = surfaces.length;
    if (K === 0) return null;

    const y = new Float64Array(K);
    const u = new Float64Array(K + 1);
    const yBar = new Float64Array(K);
    const uBar = new Float64Array(K + 1);

    const n = new Float64Array(K + 1);
    const deltaN = new Float64Array(K + 1);

    // Populate refractive indices across surfaces
    for (let i = 0; i < K; i++) {
      const glass = surfaces[i].glassKey || 'Air';
      const props = OpticalMaterials.getFraunhoferProperties(glass);
      n[i] = props.nd;
      deltaN[i] = props.nF - props.nC;
    }
    n[K] = 1.0; // Image space air
    deltaN[K] = 0.000007;

    // 1. Initial marginal and chief ray launch parameters
    const semiFieldRad = (fieldAngleDeg * Math.PI) / 180.0;
    y[0] = entrancePupilRadiusMm;
    u[0] = 0.0; // Infinite conjugate object (collimated light)

    yBar[0] = 0.0; // Chief ray passes through entrance pupil center
    uBar[0] = Math.tan(semiFieldRad);

    // 2. Paraxial Ray Trace for Marginal and Chief Rays
    for (let i = 0; i < K; i++) {
      const R = surfaces[i].radius;
      const c = (R && Math.abs(R) < 1e8) ? 1.0 / R : 0.0;
      const nIn = (i === 0) ? 1.0 : n[i - 1];
      const nOut = n[i];

      // Marginal ray refraction: n' u' = n u - y * c * (n' - n)
      const phiMarginal = c * (nOut - nIn);
      const nuMarginal = nIn * u[i] - y[i] * phiMarginal;
      u[i + 1] = nuMarginal / nOut;

      // Chief ray refraction: n' uBar' = n uBar - yBar * c * (n' - n)
      const nuChief = nIn * uBar[i] - yBar[i] * phiMarginal;
      uBar[i + 1] = nuChief / nOut;

      // Transfer to next surface
      if (i < K - 1) {
        const d = surfaces[i].thickness || 0.0;
        y[i + 1] = y[i] + d * u[i + 1];
        yBar[i + 1] = yBar[i] + d * uBar[i + 1];
      }
    }

    // 3. Lagrange Optical Invariant H = n * (y * uBar - yBar * u)
    const H = 1.0 * (y[0] * uBar[0] - yBar[0] * u[0]);

    // 4. Seidel Aberration Sums per surface
    let SI = 0.0;    // Spherical Aberration (W040)
    let SII = 0.0;   // Coma (W131)
    let SIII = 0.0;  // Astigmatism (W222)
    let SIV = 0.0;   // Field Curvature / Petzval Sum (W220)
    let SV = 0.0;    // Distortion (W311)
    let CL = 0.0;    // Longitudinal Chromatic Aberration
    let CT = 0.0;    // Transverse Chromatic Aberration

    const surfaceBreakdown = [];

    for (let i = 0; i < K; i++) {
      const R = surfaces[i].radius;
      const c = (R && Math.abs(R) < 1e8) ? 1.0 / R : 0.0;
      const nIn = (i === 0) ? 1.0 : n[i - 1];
      const nOut = n[i];

      if (c === 0.0 && nIn === nOut) {
        continue;
      }

      // Refraction invariants
      const A = nIn * (y[i] * c + u[i]);
      const ABar = nIn * (y[i] * c + uBar[i]);

      const delta_u_over_n = (u[i + 1] / nOut) - (u[i] / nIn);
      const delta_inv_n = (1.0 / nOut) - (1.0 / nIn);

      // Primary Monochromatic Seidel Sums
      let surfSI = (A * A * y[i] * delta_u_over_n);
      // Aspheric contribution if present: 8 * A4 * y^4 * (n' - n)
      if (surfaces[i].asphericA4) {
        surfSI += 8.0 * surfaces[i].asphericA4 * Math.pow(y[i], 4) * (nOut - nIn);
      }

      const surfSII = (A !== 0) ? (ABar / A) * surfSI : 0.0;
      const surfSIII = (A !== 0) ? (ABar * ABar / (A * A)) * surfSI : 0.0;
      const surfSIV = H * H * c * delta_inv_n;
      const surfSV = (A !== 0) ? (ABar / A) * (surfSIII + surfSIV) : 0.0;

      // Primary Chromatic Sums
      const dnIn = (i === 0) ? 0.000007 : deltaN[i - 1];
      const dnOut = deltaN[i];
      const delta_dispersion = (dnOut / nOut) - (dnIn / nIn);

      const surfCL = y[i] * A * delta_dispersion;
      const surfCT = yBar[i] * ABar * delta_dispersion;

      SI += surfSI;
      SII += surfSII;
      SIII += surfSIII;
      SIV += surfSIV;
      SV += surfSV;
      CL += surfCL;
      CT += surfCT;

      surfaceBreakdown.push({
        surfaceIndex: i + 1,
        radiusMm: R,
        SI: Number(surfSI.toFixed(6)),
        SII: Number(surfSII.toFixed(6)),
        SIII: Number(surfSIII.toFixed(6)),
        SIV: Number(surfSIV.toFixed(6)),
        SV: Number(surfSV.toFixed(6)),
        CL: Number(surfCL.toFixed(6)),
        CT: Number(surfCT.toFixed(6))
      });
    }

    // Convert to Wavefront Aberration Coefficients (in micrometers / waves)
    return {
      lagrangeInvariantH: Number(H.toFixed(4)),
      seidelSums: {
        SI_Spherical: Number(SI.toFixed(5)),
        SII_Coma: Number(SII.toFixed(5)),
        SIII_Astigmatism: Number(SIII.toFixed(5)),
        SIV_PetzvalFieldCurvature: Number(SIV.toFixed(5)),
        SV_Distortion: Number(SV.toFixed(5)),
        CL_LongitudinalChromatic: Number(CL.toFixed(5)),
        CT_TransverseChromatic: Number(CT.toFixed(5))
      },
      wavefrontCoefficientsUm: {
        W040_Spherical: Number((SI / 8.0).toFixed(4)),
        W131_Coma: Number((SII / 2.0).toFixed(4)),
        W222_Astigmatism: Number((SIII / 2.0).toFixed(4)),
        W220_FieldCurvature: Number(((SIII + SIV) / 4.0).toFixed(4)),
        W311_Distortion: Number((SV / 2.0).toFixed(4))
      },
      W040_Spherical: Number((SI / 8.0).toFixed(4)),
      W131_Coma: Number((SII / 2.0).toFixed(4)),
      W222_Astigmatism: Number((SIII / 2.0).toFixed(4)),
      W220_Petzval: Number((SIV / 4.0).toFixed(4)),
      W311_Distortion: Number((SV / 2.0).toFixed(4)),
      CL_AxialColor: Number(CL.toFixed(5)),
      CT_LateralColor: Number(CT.toFixed(5)),
      petzvalRadiusMm: (SIV !== 0) ? Number((-H * H / SIV).toFixed(2)) : Infinity,
      surfaceBreakdown,
      surfaceContributions: surfaceBreakdown
    };
  }

  static computeSeidelAberrations(surfaces, entrancePupilRadiusMm, fieldAngleDeg) {
    return this.computeSeidelCoefficients(surfaces, entrancePupilRadiusMm, fieldAngleDeg);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SeidelAberrations };
}
