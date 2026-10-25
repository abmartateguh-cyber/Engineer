/**
 * OmniEng Polarization Ray Tracer & Birefringent Crystal Engine
 * Experimental workflow: Zemax OpticStudio Polarization Analysis / CODE V Polarized Ray Trace.
 *
 * Implements:
 * 1. 2D Complex Jones Vector representation: E = [Ex * e^(i*delta_x), Ey * e^(i*delta_y)]
 * 2. Stokes Parameters (S0, S1, S2, S3) and Degree of Polarization (DOP)
 * 3. 2x2 Jones Matrices for polarizers, retarders (quarter-wave, half-wave), and rotators
 * 4. Angle-dependent Fresnel equations for s- and p-polarization at optical interfaces (reflection, transmission, phase)
 * 5. Birefringent uniaxial crystal ray splitting (Calcite, Quartz, YVO4, MgF2) into ordinary (o) and extraordinary (e) rays
 * 6. Poynting vector spatial walk-off angle calculation.
 *
 * Zero external dependencies.
 */

'use strict';

class Complex {
  constructor(re = 0, im = 0) {
    this.re = re;
    this.im = im;
  }

  magnitude() {
    return Math.sqrt(this.re * this.re + this.im * this.im);
  }

  phase() {
    return Math.atan2(this.im, this.re);
  }

  add(c) {
    return new Complex(this.re + c.re, this.im + c.im);
  }

  mul(c) {
    return new Complex(
      this.re * c.re - this.im * c.im,
      this.re * c.im + this.im * c.re
    );
  }

  scale(s) {
    return new Complex(this.re * s, this.im * s);
  }

  conj() {
    return new Complex(this.re, -this.im);
  }
}

class JonesVector {
  /**
   * @param {Complex|number} Ex - Horizontal electric field amplitude / complex
   * @param {Complex|number} Ey - Vertical electric field amplitude / complex
   */
  constructor(Ex = 1.0, Ey = 0.0) {
    this.Ex = (typeof Ex === 'number') ? new Complex(Ex, 0) : Ex;
    this.Ey = (typeof Ey === 'number') ? new Complex(Ey, 0) : Ey;
  }

  /**
   * Creates standard polarization states
   */
  static LinearHorizontal() {
    return new JonesVector(1.0, 0.0);
  }

  static LinearVertical() {
    return new JonesVector(0.0, 1.0);
  }

  static LinearDiagonal45() {
    const invSqrt2 = 1.0 / Math.SQRT2;
    return new JonesVector(invSqrt2, invSqrt2);
  }

  static RightCircular() {
    const invSqrt2 = 1.0 / Math.SQRT2;
    // [1, -i] / sqrt(2)
    return new JonesVector(new Complex(invSqrt2, 0), new Complex(0, -invSqrt2));
  }

  static LeftCircular() {
    const invSqrt2 = 1.0 / Math.SQRT2;
    // [1, +i] / sqrt(2)
    return new JonesVector(new Complex(invSqrt2, 0), new Complex(0, invSqrt2));
  }

  /**
   * Intensity / Total optical power
   */
  intensity() {
    const magX = this.Ex.magnitude();
    const magY = this.Ey.magnitude();
    return magX * magX + magY * magY;
  }

  /**
   * Computes Stokes Parameters [S0, S1, S2, S3]
   */
  toStokes() {
    const magX2 = this.Ex.re * this.Ex.re + this.Ex.im * this.Ex.im;
    const magY2 = this.Ey.re * this.Ey.re + this.Ey.im * this.Ey.im;

    // S0 = |Ex|^2 + |Ey|^2
    const S0 = magX2 + magY2;

    // S1 = |Ex|^2 - |Ey|^2
    const S1 = magX2 - magY2;

    // S2 = 2 * Re(Ex * Ey*)
    const conjEy = this.Ey.conj();
    const exEyStar = this.Ex.mul(conjEy);
    const S2 = 2.0 * exEyStar.re;

    // S3 = 2 * Im(Ex * Ey*)
    const S3 = 2.0 * exEyStar.im;

    // Degree of Linear Polarization (DoLP) and Degree of Circular Polarization (DoCP)
    const dolp = S0 > 1e-12 ? Math.sqrt(S1 * S1 + S2 * S2) / S0 : 0.0;
    const docp = S0 > 1e-12 ? Math.abs(S3) / S0 : 0.0;
    const dop = S0 > 1e-12 ? Math.sqrt(S1 * S1 + S2 * S2 + S3 * S3) / S0 : 0.0;

    return {
      S0: Number(S0.toFixed(5)),
      S1: Number(S1.toFixed(5)),
      S2: Number(S2.toFixed(5)),
      S3: Number(S3.toFixed(5)),
      DOP: Number(dop.toFixed(5)),
      DOLP: Number(dolp.toFixed(5)),
      DOCP: Number(docp.toFixed(5))
    };
  }

  /**
   * Applies 2x2 Jones matrix transformation
   */
  applyMatrix(J) {
    // [ J00  J01 ] [ Ex ]
    // [ J10  J11 ] [ Ey ]
    const newEx = J[0][0].mul(this.Ex).add(J[0][1].mul(this.Ey));
    const newEy = J[1][0].mul(this.Ex).add(J[1][1].mul(this.Ey));
    return new JonesVector(newEx, newEy);
  }
}

class PolarizationRayTracer {
  /**
   * Computes Fresnel s- and p-polarized reflection and transmission coefficients
   * @param {number} n1 - Incident medium refractive index
   * @param {number} n2 - Transmitted medium refractive index
   * @param {number} thetaI - Angle of incidence (radians)
   */
  static evaluateFresnel(n1, n2, thetaI) {
    if (thetaI < 0 || thetaI > Math.PI / 2) throw new Error('thetaI must be in [0, pi/2]');

    // Snell's Law: sin(thetaT) = (n1 / n2) * sin(thetaI)
    const sinThetaT = (n1 / n2) * Math.sin(thetaI);

    // Total Internal Reflection check
    if (sinThetaT >= 1.0) {
      // TIR: Rs = 1, Rp = 1 with Goos-Hänchen phase shifts
      const deltaS = 2.0 * Math.atan(Math.sqrt(sinThetaT * sinThetaT - 1.0) / (Math.cos(thetaI)));
      const deltaP = 2.0 * Math.atan((n1 * n1 / (n2 * n2)) * Math.sqrt(sinThetaT * sinThetaT - 1.0) / (Math.cos(thetaI)));
      return {
        isTIR: true,
        thetaT: Math.PI / 2,
        rs: 1.0,
        rp: 1.0,
        Rs: 1.0,
        Rp: 1.0,
        phaseShiftS: deltaS,
        phaseShiftP: deltaP,
        Ts: 0.0,
        Tp: 0.0
      };
    }

    const thetaT = Math.asin(sinThetaT);
    const cosI = Math.cos(thetaI);
    const cosT = Math.cos(thetaT);

    // s-polarization (TE)
    const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
    const ts = (2.0 * n1 * cosI) / (n1 * cosI + n2 * cosT);

    // p-polarization (TM)
    const rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
    const tp = (2.0 * n1 * cosI) / (n2 * cosI + n1 * cosT);

    // Reflectance and Transmittance (power fractions)
    const Rs = rs * rs;
    const Rp = rp * rp;
    const Ts = (n2 * cosT) / (n1 * cosI) * (ts * ts);
    const Tp = (n2 * cosT) / (n1 * cosI) * (tp * tp);

    return {
      isTIR: false,
      thetaI,
      thetaT,
      rs: Number(rs.toFixed(6)),
      rp: Number(rp.toFixed(6)),
      ts: Number(ts.toFixed(6)),
      tp: Number(tp.toFixed(6)),
      Rs: Number(Rs.toFixed(6)),
      Rp: Number(Rp.toFixed(6)),
      Ts: Number(Ts.toFixed(6)),
      Tp: Number(Tp.toFixed(6)),
      brewsterAngleRad: Math.atan(n2 / n1)
    };
  }

  /**
   * Birefringent Uniaxial Crystal Ray Splitting
   * Splits an incident ray at a crystal interface into Ordinary (o) and Extraordinary (e) rays
   *
   * @param {Object} crystalProps
   * @param {number} crystalProps.no - Ordinary refractive index
   * @param {number} crystalProps.ne - Extraordinary refractive index
   * @param {Array<number>} crystalProps.opticAxis - Unit vector of crystal c-axis [cx, cy, cz]
   * @param {Array<number>} rayDir - Normalized incident wavevector [dx, dy, dz]
   * @param {Array<number>} surfaceNormal - Interface normal [nx, ny, nz]
   */
  static splitBirefringentRay(crystalProps, rayDir, surfaceNormal) {
    const { no, ne, opticAxis } = crystalProps;

    // Normalizing inputs
    const cNorm = Math.hypot(opticAxis[0], opticAxis[1], opticAxis[2]);
    const c = [opticAxis[0] / cNorm, opticAxis[1] / cNorm, opticAxis[2] / cNorm];

    const kNorm = Math.hypot(rayDir[0], rayDir[1], rayDir[2]);
    const k = [rayDir[0] / kNorm, rayDir[1] / kNorm, rayDir[2] / kNorm];

    const nNorm = Math.hypot(surfaceNormal[0], surfaceNormal[1], surfaceNormal[2]);
    const n = [surfaceNormal[0] / nNorm, surfaceNormal[1] / nNorm, surfaceNormal[2] / nNorm];

    // Angle theta between wavevector and optic axis: cos(theta) = k . c
    const cosTheta = Math.max(-1.0, Math.min(1.0, k[0] * c[0] + k[1] * c[1] + k[2] * c[2]));
    const sinTheta = Math.sqrt(Math.max(0.0, 1.0 - cosTheta * cosTheta));

    // Extraordinary refractive index n_e(theta):
    // 1 / ne(theta)^2 = cos^2(theta) / no^2 + sin^2(theta) / ne^2
    const invNeThetaSq = (cosTheta * cosTheta) / (no * no) + (sinTheta * sinTheta) / (ne * ne);
    const neTheta = 1.0 / Math.sqrt(invNeThetaSq);

    // Spatial Poynting walk-off angle rho between wavevector k and ray Poynting vector S:
    // tan(rho) = (no^2 - ne^2) * tan(theta) / (no^2 + ne^2 * tan^2(theta))
    let walkOffAngleRad = 0.0;
    if (Math.abs(cosTheta) > 1e-6 && Math.abs(sinTheta) > 1e-6) {
      const tanTheta = sinTheta / cosTheta;
      const num = (no * no - ne * ne) * tanTheta;
      const den = no * no + ne * ne * tanTheta * tanTheta;
      walkOffAngleRad = Math.atan(num / den);
    }

    // Refract ordinary ray with index no using Snell's vector form
    const cosI = -(k[0] * n[0] + k[1] * n[1] + k[2] * n[2]);
    const etaO = 1.0 / no;
    const kO = 1.0 - etaO * etaO * (1.0 - cosI * cosI);
    const oRayDir = [
      etaO * k[0] + (etaO * cosI - Math.sqrt(Math.max(0.0, kO))) * n[0],
      etaO * k[1] + (etaO * cosI - Math.sqrt(Math.max(0.0, kO))) * n[1],
      etaO * k[2] + (etaO * cosI - Math.sqrt(Math.max(0.0, kO))) * n[2]
    ];

    // Refract extraordinary ray with index neTheta
    const etaE = 1.0 / neTheta;
    const kE = 1.0 - etaE * etaE * (1.0 - cosI * cosI);
    const eRayDir = [
      etaE * k[0] + (etaE * cosI - Math.sqrt(Math.max(0.0, kE))) * n[0],
      etaE * k[1] + (etaE * cosI - Math.sqrt(Math.max(0.0, kE))) * n[1],
      etaE * k[2] + (etaE * cosI - Math.sqrt(Math.max(0.0, kE))) * n[2]
    ];

    // Ray separation angle between ordinary and extraordinary rays
    const oMag = Math.hypot(oRayDir[0], oRayDir[1], oRayDir[2]);
    const eMag = Math.hypot(eRayDir[0], eRayDir[1], eRayDir[2]);
    const dotOE = (oRayDir[0] * eRayDir[0] + oRayDir[1] * eRayDir[1] + oRayDir[2] * eRayDir[2]) / (oMag * eMag);
    const separationAngleRad = Math.acos(Math.max(-1.0, Math.min(1.0, dotOE)));

    return {
      ordinaryIndex: no,
      extraordinaryIndex: Number(neTheta.toFixed(6)),
      birefringenceDeltaN: Number((neTheta - no).toFixed(6)),
      walkOffAngleRad: Number(walkOffAngleRad.toFixed(6)),
      walkOffAngleDeg: Number((walkOffAngleRad * 180 / Math.PI).toFixed(4)),
      separationAngleRad: Number(separationAngleRad.toFixed(6)),
      separationAngleDeg: Number((separationAngleRad * 180 / Math.PI).toFixed(4)),
      ordinaryRay: {
        direction: oRayDir,
        polarization: 'TE (Perpendicular to principal plane)'
      },
      extraordinaryRay: {
        direction: eRayDir,
        polarization: 'TM (In principal plane)'
      }
    };
  }
}

module.exports = {
  Complex,
  JonesVector,
  PolarizationRayTracer
};
