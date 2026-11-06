/**
 * RiemannSolvers: Compressible Approximate Riemann Solvers & 1D Shock-Tube FVM
 *
 * Implements three shock-capturing numerical flux schemes for the Euler
 * equations of inviscid compressible flow (2D conservative states
 * U = [rho, rho*u, rho*v, E_total]^T, ideal gas p = (gamma-1)*(E - 0.5*rho*q^2)):
 *   1. Roe's approximate Riemann solver with Harten-Hyman entropy fix.
 *   2. HLLC (Harten-Lax-van Leer-Contact) approximate Riemann solver.
 *   3. AUSM+ (Advection Upstream Splitting Method) flux splitting.
 *
 * Also provides a deterministic 1D finite-volume integrator for the classic
 * Sod shock-tube benchmark that can be run with any of the three fluxes.
 */

'use strict';

class RiemannSolvers {
  /**
   * Primitive variables from a conservative state (2D slice).
   * @param {[number, number, number, number]} U [rho, rho*u, rho*v, E]
   * @param {number} [gamma=1.4]
   * @returns {{rho: number, u: number, v: number, p: number, a: number, H: number}}
   */
  static primitive(U, gamma = 1.4) {
    const rho = U[0];
    const u = U[1] / rho;
    const v = U[2] / rho;
    const q2 = u * u + v * v;
    const E = U[3];
    const p = (gamma - 1.0) * (E - 0.5 * rho * q2);
    const a = Math.sqrt(Math.max(1e-10, (gamma * p) / rho));
    const H = (E + p) / rho;
    return { rho, u, v, p, a, H };
  }

  /**
   * Roe flux with Harten-Hyman entropy fix.
   * @param {[number, number, number, number]} UL left conservative state
   * @param {[number, number, number, number]} UR right conservative state
   * @param {[number, number]} [normal=[1,0]] unit face normal
   * @param {number} [gamma=1.4]
   * @returns {[number, number, number, number]} flux vector [F_rho, F_u, F_v, F_E]
   */
  static roeFlux(UL, UR, normal = [1.0, 0.0], gamma = 1.4) {
    const nx = normal[0];
    const ny = normal[1];
    const L = this.primitive(UL, gamma);
    const R = this.primitive(UR, gamma);

    const unL = L.u * nx + L.v * ny;
    const unR = R.u * nx + R.v * ny;

    const HL = L.H;
    const HR = R.H;

    const FL = [
      L.rho * unL,
      L.rho * L.u * unL + L.p * nx,
      L.rho * L.v * unL + L.p * ny,
      (UL[3] + L.p) * unL
    ];
    const FR = [
      R.rho * unR,
      R.rho * R.u * unR + R.p * nx,
      R.rho * R.v * unR + R.p * ny,
      (UR[3] + R.p) * unR
    ];

    const sL = Math.sqrt(L.rho);
    const sR = Math.sqrt(R.rho);
    const s = sL + sR;
    const rhoRoe = sL * sR;

    const u = (sL * L.u + sR * R.u) / s;
    const v = (sL * L.v + sR * R.v) / s;
    const h = (sL * HL + sR * HR) / s;
    const q2 = u * u + v * v;
    const a2 = (gamma - 1.0) * (h - 0.5 * q2);
    const a = Math.sqrt(Math.max(1e-10, a2));
    const un = u * nx + v * ny;

    const drho = R.rho - L.rho;
    const dp = R.p - L.p;
    const dun = unR - unL;

    const alpha1 = (dp - rhoRoe * a * dun) / (2.0 * a2);
    const alpha2 = drho - dp / a2;
    const alpha3 = (dp + rhoRoe * a * dun) / (2.0 * a2);

    const lam1 = un - a;
    const lam2 = un;
    const lam3 = un + a;

    // Harten-Hyman entropy fix
    const eps = 0.1 * a;
    const fix = (lam) => {
      const absLam = Math.abs(lam);
      return absLam >= eps ? absLam : (lam * lam + eps * eps) / (2.0 * eps);
    };
    const absL1 = fix(lam1);
    const absL2 = fix(lam2);
    const absL3 = fix(lam3);

    const dissMass = 0.5 * (alpha1 * absL1 + alpha2 * absL2 + alpha3 * absL3);
    const dissMomX = 0.5 * (
      alpha1 * absL1 * (u - a * nx) +
      alpha2 * absL2 * u +
      alpha3 * absL3 * (u + a * nx)
    );
    const dissMomY = 0.5 * (
      alpha1 * absL1 * (v - a * ny) +
      alpha2 * absL2 * v +
      alpha3 * absL3 * (v + a * ny)
    );
    const dissEnergy = 0.5 * (
      alpha1 * absL1 * (h - a * un) +
      alpha2 * absL2 * (0.5 * q2) +
      alpha3 * absL3 * (h + a * un)
    );

    return [
      0.5 * (FL[0] + FR[0]) - dissMass,
      0.5 * (FL[1] + FR[1]) - dissMomX,
      0.5 * (FL[2] + FR[2]) - dissMomY,
      0.5 * (FL[3] + FR[3]) - dissEnergy
    ];
  }

  /**
   * HLLC approximate Riemann solver (full conservative flux).
   * @returns {[number, number, number, number]} flux vector
   */
  static hllcFlux(UL, UR, normal = [1.0, 0.0], gamma = 1.4) {
    const nx = normal[0];
    const ny = normal[1];
    const L = this.primitive(UL, gamma);
    const R = this.primitive(UR, gamma);

    const unL = L.u * nx + L.v * ny;
    const unR = R.u * nx + R.v * ny;

    const FL = [
      L.rho * unL,
      L.rho * L.u * unL + L.p * nx,
      L.rho * L.v * unL + L.p * ny,
      (UL[3] + L.p) * unL
    ];
    const FR = [
      R.rho * unR,
      R.rho * R.u * unR + R.p * nx,
      R.rho * R.v * unR + R.p * ny,
      (UR[3] + R.p) * unR
    ];

    const SL = Math.min(unL - L.a, unR - R.a);
    const SR = Math.max(unL + L.a, unR + R.a);

    if (SL >= 0.0) return FL;
    if (SR <= 0.0) return FR;

    const num = R.p - L.p + L.rho * unL * (SL - unL) - R.rho * unR * (SR - unR);
    const den = L.rho * (SL - unL) - R.rho * (SR - unR);
    const SM = Math.abs(den) > 1e-12 ? num / den : 0.5 * (unL + unR);

    // Unit tangent vector t = (-ny, nx)
    const tx = -ny;
    const ty = nx;

    const starFlux = (K, U, F) => {
      const rhoK = K.rho;
      const SK = K === L ? SL : SR;
      const uK = K.u;
      const vK = K.v;
      const pK = K.p;
      const EK = U[3];
      const unK = uK * nx + vK * ny;
      const utK = uK * tx + vK * ty;
      const factor = rhoK * (SK - unK) / (SK - SM);
      // Star-state velocity: normal component SM, tangential component preserved
      const uStar = SM * nx + utK * tx;
      const vStar = SM * ny + utK * ty;
      const Ustar = [
        factor,
        factor * uStar,
        factor * vStar,
        factor * (EK / rhoK + (SM - unK) * (SM + pK / (rhoK * (SK - unK))))
      ];
      return [
        F[0] + SK * (Ustar[0] - U[0]),
        F[1] + SK * (Ustar[1] - U[1]),
        F[2] + SK * (Ustar[2] - U[2]),
        F[3] + SK * (Ustar[3] - U[3])
      ];
    };

    if (SM >= 0.0) {
      return starFlux(L, UL, FL);
    }
    return starFlux(R, UR, FR);
  }

  /**
   * AUSM+ flux splitting (M4/P5 polynomials, donor-cell upwinding).
   * @returns {[number, number, number, number]} flux vector
   */
  static ausmPlusFlux(UL, UR, normal = [1.0, 0.0], gamma = 1.4) {
    const nx = normal[0];
    const ny = normal[1];
    const L = this.primitive(UL, gamma);
    const R = this.primitive(UR, gamma);

    const unL = L.u * nx + L.v * ny;
    const unR = R.u * nx + R.v * ny;

    const aHalf = 0.5 * (L.a + R.a);
    const ML = unL / aHalf;
    const MR = unR / aHalf;

    const beta = 0.125; // 1/8 (M4)
    const alpha = 0.1875; // 3/16 (P5)

    const mPlus = (m) => {
      if (m >= 1.0) return m;
      if (m <= -1.0) return 0.0;
      return 0.25 * (m + 1.0) * (m + 1.0) + beta * (m * m - 1.0) * (m * m - 1.0);
    };
    const mMinus = (m) => {
      if (m >= 1.0) return 0.0;
      if (m <= -1.0) return m;
      return -0.25 * (m - 1.0) * (m - 1.0) - beta * (m * m - 1.0) * (m * m - 1.0);
    };
    const pPlus = (m) => {
      if (m >= 1.0) return 1.0;
      if (m <= -1.0) return 0.0;
      return 0.25 * (m + 1.0) * (m + 1.0) * (2.0 - m) + alpha * m * (m * m - 1.0) * (m * m - 1.0);
    };
    const pMinus = (m) => {
      if (m >= 1.0) return 0.0;
      if (m <= -1.0) return 1.0;
      return 0.25 * (m - 1.0) * (m - 1.0) * (2.0 + m) - alpha * m * (m * m - 1.0) * (m * m - 1.0);
    };

    const mHalf = mPlus(ML) + mMinus(MR);
    const pHalf = pPlus(ML) * L.p + pMinus(MR) * R.p;

    const upwind = mHalf >= 0.0 ? L : R;
    const mdot = mHalf * aHalf * upwind.rho;

    return [
      mdot,
      mdot * upwind.u + pHalf * nx,
      mdot * upwind.v + pHalf * ny,
      mdot * upwind.H
    ];
  }

  /**
   * 1D finite-volume Sod shock-tube integrator (deterministic).
   *
   * Classic Sod problem: rhoL=1, pL=1, rhoR=0.125, pR=0.1, u=v=0,
   * diaphragm at x=0.5, gamma=1.4, domain [0,1].
   *
   * @param {Object} [opts]
   * @param {number} [opts.nCells=350]
   * @param {number} [opts.tEnd=0.2]
   * @param {number} [opts.cfl=0.4]
   * @param {string} [opts.scheme='roe'] one of 'roe' | 'hllc' | 'ausm_plus'
   * @param {number} [opts.gamma=1.4]
   * @returns {{x: number[], rho: number[], u: number[], p: number[], t: number, steps: number, scheme: string}}
   */
  static sodShockTube(opts = {}) {
    const nCells = opts.nCells || 350;
    const tEnd = opts.tEnd || 0.2;
    const cfl = opts.cfl || 0.4;
    const scheme = opts.scheme || 'roe';
    const gamma = opts.gamma || 1.4;

    const L = 1.0;
    const dx = L / nCells;
    const fluxFn = scheme === 'hllc'
      ? (UL, UR) => this.hllcFlux(UL, UR, [1.0, 0.0], gamma)
      : scheme === 'ausm_plus'
        ? (UL, UR) => this.ausmPlusFlux(UL, UR, [1.0, 0.0], gamma)
        : (UL, UR) => this.roeFlux(UL, UR, [1.0, 0.0], gamma);

    // Conservative cells: U = [rho, rho*u, rho*v, E]
    const U = new Array(nCells);
    const rhoArr = new Array(nCells);
    const uArr = new Array(nCells);
    const pArr = new Array(nCells);

    for (let i = 0; i < nCells; i++) {
      const x = (i + 0.5) * dx;
      const left = x < 0.5;
      const rho = left ? 1.0 : 0.125;
      const p = left ? 1.0 : 0.1;
      rhoArr[i] = rho;
      uArr[i] = 0.0;
      pArr[i] = p;
      U[i] = [rho, 0.0, 0.0, p / (gamma - 1.0)];
    }

    let t = 0.0;
    let steps = 0;
    const fluxes = new Array(nCells + 1);

    while (t < tEnd) {
      let maxSpeed = 1e-12;
      for (let i = 0; i < nCells; i++) {
        const a = Math.sqrt((gamma * pArr[i]) / rhoArr[i]);
        const s = Math.abs(uArr[i]) + a;
        if (s > maxSpeed) maxSpeed = s;
      }

      let dt = cfl * dx / maxSpeed;
      if (t + dt > tEnd) dt = tEnd - t;
      if (dt <= 0.0) break;

      // Interface fluxes with transmissive boundary conditions (copy neighbors)
      for (let f = 0; f <= nCells; f++) {
        const iL = f === 0 ? 0 : f - 1;
        const iR = f === nCells ? nCells - 1 : f;
        fluxes[f] = fluxFn(U[iL], U[iR]);
      }

      const dtDx = dt / dx;
      for (let i = 0; i < nCells; i++) {
        const Fm = fluxes[i];
        const Fp = fluxes[i + 1];
        U[i][0] -= dtDx * (Fp[0] - Fm[0]);
        U[i][1] -= dtDx * (Fp[1] - Fm[1]);
        U[i][2] -= dtDx * (Fp[2] - Fm[2]);
        U[i][3] -= dtDx * (Fp[3] - Fm[3]);
      }

      for (let i = 0; i < nCells; i++) {
        const rho = Math.max(1e-10, U[i][0]);
        const u = U[i][1] / rho;
        const E = U[i][3];
        const p = Math.max(1e-10, (gamma - 1.0) * (E - 0.5 * rho * u * u));
        rhoArr[i] = rho;
        uArr[i] = u;
        pArr[i] = p;
      }

      t += dt;
      steps++;
      if (steps > 2000000) throw new Error('Sod tube did not finish within step budget');
    }

    const x = new Array(nCells);
    for (let i = 0; i < nCells; i++) x[i] = (i + 0.5) * dx;

    return { x, rho: rhoArr, u: uArr, p: pArr, t, steps, scheme };
  }
}

module.exports = { RiemannSolvers };
