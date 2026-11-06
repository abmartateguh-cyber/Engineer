/**
 * OmniEng Hybrid RANS-LES (DDES / SAS) Turbulence Closure
 *
 * Implementation scope (Battalion 6, Agent 56):
 *   1. Spalart-Allmaras (SA) RANS closure for the transported modified viscosity
 *      nu_tilde (production, destruction, cross-diffusion, wall destruction).
 *      SA is chosen over SST k-omega because it is a single-transport-equation
 *      model: the DES machinery plugs directly into the destruction term, which
 *      keeps the coarse 2D verification solver cheap and deterministic.
 *   2. DDES shielding (Menter-Kuntz): fd(rd) with CDES = 0.65 and Cw = 0.15,
 *      and the DES length scale  L_DDES = L_RANS - fd*max(0, L_RANS - L_LES)
 *      with L_LES = CDES * delta (delta = max cell size).
 *   3. A modest, fast 2D incompressible vortex-shedding solver around a circular
 *      cylinder at Re = 10,000 (uniform inflow, no-slip cylinder, zero-gradient
 *      outflow, free-slip lateral walls) built on a coarse staggered Cartesian
 *      grid with MAC projection, upwind/central-blended advection, an immersed
 *      boundary mask for the obstacle, and the SA-DDES eddy viscosity feeding
 *      the momentum diffusion.
 *
 * The solver is a demonstration harness, not a production 3D unstructured CFD
 * code. All results are deterministic (seeded LCG perturbations, fixed loop
 * order, no Math.random).
 */

'use strict';

const SA_DES_CONSTANTS = Object.freeze({
  kappa: 0.41,
  cb1: 0.1355,
  cb2: 0.622,
  sigma: 2 / 3,
  cv1: 7.1,
  cw2: 0.3,
  cw3: 2.0,
  cdes: 0.65,
  cw1: 0.1355 / (0.41 * 0.41) + (1 + 0.622) / (2 / 3)
});

function saFv1(chi) {
  const c3 = chi * chi * chi;
  return c3 / (c3 + SA_DES_CONSTANTS.cv1 ** 3);
}

function saFv2(chi, fv1Val) {
  return 1 - chi / (1 + chi * fv1Val);
}

function saSMod(omega, nuTilde, nu, d) {
  const k2d2 = SA_DES_CONSTANTS.kappa * SA_DES_CONSTANTS.kappa * d * d;
  const chi = nuTilde / nu;
  const fv1Val = saFv1(chi);
  const fv2Val = saFv2(chi, fv1Val);
  const s = omega + (nuTilde * fv2Val) / k2d2;
  return s > 0 ? s : 0;
}

function saFw(r) {
  const g = r + SA_DES_CONSTANTS.cw2 * (r ** 6 - r);
  const g6 = g ** 6;
  const cw36 = SA_DES_CONSTANTS.cw3 ** 6;
  return g * Math.pow((1 + cw36) / (g6 + cw36), 1 / 6);
}

/**
 * Menter-Kuntz DDES shielding function.
 * fd -> 0 inside the attached boundary layer (rd -> 1), fd -> 1 in separated /
 * LES regions (rd -> 0).
 * @param {number} rd wall-distance ratio (nu_t + nu) / sqrt(U_i,j U_i,j) k^2 d^2
 * @returns {number} fd in [0, 1]
 */
function fdShielding(rd) {
  return 1 - Math.tanh(Math.pow(8 * rd, 3));
}

/**
 * Wall-distance ratio used by the DDES shielding.
 * @param {number} nuTPlusNu  kinematic (turbulent + molecular) viscosity
 * @param {number} d          distance to the nearest wall
 * @param {number} shearMag    velocity-gradient magnitude (e.g. |omega|)
 * @param {number} kappa       von Karman constant
 * @returns {number} rd (large when the denominator vanishes -> fd -> 0)
 */
function rdRatio(nuTPlusNu, d, shearMag, kappa = SA_DES_CONSTANTS.kappa) {
  const denom = shearMag * kappa * kappa * d * d;
  if (!(denom > 1e-300)) {
    return 1e10;
  }
  return nuTPlusNu / denom;
}

/**
 * DES length scale. L_DDES = L_RANS - fd*max(0, L_RANS - L_LES).
 * @param {number} lRans RANS length scale (SA: wall distance d)
 * @param {number} lLes  LES length scale CDES * delta
 * @param {number} fd    shielding function
 * @returns {number} DDES length scale
 */
function desLengthScale(lRans, lLes, fd) {
  return lRans - fd * Math.max(0, lRans - lLes);
}

/**
 * LES grid scale with the standard DDES constant.
 * @param {number} cellSize max cell size delta
 * @param {number} [cdes]   DDES constant (default 0.65)
 * @returns {number} CDES * delta
 */
function lesDelta(cellSize, cdes = SA_DES_CONSTANTS.cdes) {
  return cdes * cellSize;
}

/**
 * Complete SA-DDES algebraic closure for one location.
 * @param {Object} a
 * @param {number} a.nuTilde  modified viscosity
 * @param {number} a.nu       molecular viscosity
 * @param {number} a.d        wall distance
 * @param {number} a.omega    vorticity magnitude |curl u|
 * @param {number} a.delta    max cell size (LES grid scale input)
 * @returns {Object} { chi, fv1, fv2, s, omega, rd, fd, lLes, lDes, r, g,
 *                     fw, production, destruction, nuEddy }
 */
function saDessClosure({ nuTilde, nu, d, omega, delta }) {
  const C = SA_DES_CONSTANTS;
  const chi = nuTilde / nu;
  const fv1Val = saFv1(chi);
  const fv2Val = saFv2(chi, fv1Val);
  const k2d2 = C.kappa * C.kappa * d * d;
  const s = saSMod(omega, nuTilde, nu, d);
  const rd = rdRatio(nuTilde + nu, d, omega);
  const fd = fdShielding(rd);
  const lLes = lesDelta(delta, C.cdes);
  const lDes = desLengthScale(d, lLes, fd);
  const r = nuTilde / (s * k2d2 + 1e-30);
  const g = r + C.cw2 * (r ** 6 - r);
  const fw = saFw(r);
  const production = C.cb1 * s * nuTilde;
  const destruction = C.cw1 * fw * (nuTilde / Math.max(lDes, 1e-30)) ** 2;
  return {
    chi,
    fv1: fv1Val,
    fv2: fv2Val,
    s,
    omega,
    rd,
    fd,
    lLes,
    lDes,
    r,
    g,
    fw,
    production,
    destruction,
    nuEddy: nuTilde * fv1Val
  };
}

/* ------------------------------------------------------------------ *
 * 2D incompressible MAC projection solver with SA-DDES viscosity      *
 * ------------------------------------------------------------------ */

/**
 * Deterministic LCG (Park-Miller) for reproducible perturbations.
 */
class Lcg {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }
}

class VortexSheddingSolver {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.nx=120]     grid cells in x
   * @param {number} [opts.ny=80]      grid cells in y
   * @param {number} [opts.lx=12]      domain length (D)
   * @param {number} [opts.ly=8]       domain height (D)
   * @param {number} [opts.d=1]        cylinder diameter
   * @param {number} [opts.cx=4]       cylinder center x
   * @param {number} [opts.cy=4]       cylinder center y
   * @param {number} [opts.re=10000]   Reynolds number U D / nu
   * @param {number} [opts.uInf=1]     inflow speed
   * @param {number} [opts.dt]         time step (auto from CFL if omitted)
   * @param {number} [opts.endTime]    total simulated time (auto if omitted)
   * @param {number} [opts.advectionAlpha=0.35] central-blend fraction for advection
   * @param {number} [opts.sorSweeps=140]       pressure SOR sweeps per projection
   * @param {number} [opts.sorOmega=1.7]        SOR relaxation factor
   * @param {number} [opts.perturbAmp=0.05]     initial perturbation amplitude
   * @param {number} [opts.seed=20261105]       RNG seed
   * @param {number} [opts.spongeLen=1.5]       outlet sponge length (D)
   * @param {number} [opts.settleTime=10]       transient time excluded from stats (D/U)
   * @param {number} [opts.historyEvery=2]      store lift every N steps
   */
  constructor(opts = {}) {
    this.nx = opts.nx || 120;
    this.ny = opts.ny || 80;
    this.lx = opts.lx || 12;
    this.ly = opts.ly || 8;
    this.d = opts.d || 1;
    this.cx = opts.cx || 4;
    this.cy = opts.cy || 4;
    this.uInf = opts.uInf || 1;
    this.re = opts.re || 10000;
    this.nu = (this.d * this.uInf) / this.re;
    this.dx = this.lx / this.nx;
    this.dy = this.ly / this.ny;
    this.delta = Math.max(this.dx, this.dy);
    this.dt = opts.dt || (0.5 * Math.min(this.dx, this.dy)) / this.uInf;
    this.endTime = opts.endTime || 32;
    this.advectionAlpha = opts.advectionAlpha === undefined ? 0.35 : opts.advectionAlpha;
    this.sorSweeps = opts.sorSweeps || 90;
    this.sorOmega = opts.sorOmega || 1.7;
    this.perturbAmp = opts.perturbAmp === undefined ? 0.05 : opts.perturbAmp;
    this.filterBeta = opts.filterBeta === undefined ? 0.22 : opts.filterBeta;
    this.saSFloor = opts.saSFloor === undefined ? 0.5 : opts.saSFloor;
    this.seed = opts.seed === undefined ? 20261105 : opts.seed;
    this.spongeLen = opts.spongeLen === undefined ? 1.5 : opts.spongeLen;
    this.settleTime = opts.settleTime || 10;
    this.historyEvery = opts.historyEvery || 2;

    this.nCells = this.nx * this.ny;
    this.nU = (this.nx + 1) * this.ny;
    this.nV = this.nx * (this.ny + 1);

    const rng = new Lcg(this.seed);

    this.solid = new Uint8Array(this.nCells);
    this.dist = new Float64Array(this.nCells);
    this.nuFloor = new Float64Array(this.nCells);
    this.nuFloorAmp = opts.nuFloorAmp === undefined ? 0.03 : opts.nuFloorAmp;
    const rOuter = this.d / 2;
    const dFloor = 0.25 * Math.min(this.dx, this.dy);
    for (let j = 0; j < this.ny; j++) {
      const y = (j + 0.5) * this.dy;
      for (let i = 0; i < this.nx; i++) {
        const idx = j * this.nx + i;
        const x = (i + 0.5) * this.dx;
        const r = Math.hypot(x - this.cx, y - this.cy);
        this.solid[idx] = r < rOuter ? 1 : 0;
        this.dist[idx] = Math.max(r - rOuter, dFloor);
        const dWall = Math.max(r - rOuter, 0);
        const floorScale = Math.max(0, 1 - dWall / (1.5 * this.d));
        this.nuFloor[idx] = this.nuFloorAmp * this.uInf * this.d * this.geomSmooth(floorScale);
      }
    }

    this.u = new Float64Array(this.nU);
    this.v = new Float64Array(this.nV);
    this.p = new Float64Array(this.nCells);
    this.nuT = new Float64Array(this.nCells);

    const nuSeed = 3 * this.nu + 2e-3 * this.uInf * this.d;
    for (let idx = 0; idx < this.nCells; idx++) {
      this.nuT[idx] = nuSeed;
    }

    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i <= this.nx; i++) {
        this.u[j * (this.nx + 1) + i] = this.uInf;
      }
    }
    for (let j = 0; j <= this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.v[j * this.nx + i] = 0;
      }
    }
    for (let idx = 0; idx < this.nCells; idx++) {
      if (this.solid[idx]) {
        const j = (idx / this.nx) | 0;
        const i = idx - j * this.nx;
        this.u[j * (this.nx + 1) + i] = 0;
        this.u[j * (this.nx + 1) + i + 1] = 0;
        this.v[j * this.nx + i] = 0;
        this.v[(j + 1) * this.nx + i] = 0;
      }
    }

    this.applyPerturbation(rng);
    this.applyBoundaryConditions();

    this.t = 0;
    this.stepCount = 0;
    this.clHistory = [];
    this.tHistory = [];
    this.nanCount = 0;
  }

  geomSmooth(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  applyPerturbation(rng) {
    const sigma = this.d;
    const maxR = 3 * this.d;
    const modes = 3;
    const phases = [];
    const amps = [];
    for (let m = 0; m < modes; m++) {
      phases.push(rng.range(0, 2 * Math.PI));
      amps.push(rng.range(0.5, 1.5));
    }
    for (let j = 0; j < this.ny; j++) {
      const y = (j + 0.5) * this.dy;
      for (let i = 0; i < this.nx; i++) {
        const idx = j * this.nx + i;
        if (this.solid[idx]) continue;
        const x = (i + 0.5) * this.dx;
        const rr = Math.hypot(x - this.cx, y - this.cy);
        if (rr > maxR) continue;
        const envelope = this.perturbAmp * Math.exp(-(rr * rr) / (2 * sigma * sigma));
        let kick = 0;
        for (let m = 0; m < modes; m++) {
          kick += amps[m] * Math.sin(((m + 1) * Math.PI * (x - this.cx)) / (2 * this.d) + phases[m]);
        }
        const jx = j * this.nx + i;
        this.v[jx] += envelope * kick;
        this.v[(j + 1) * this.nx + i] += envelope * kick;
      }
    }
  }

  applyBoundaryConditions() {
    const nx = this.nx;
    const ny = this.ny;
    for (let j = 0; j < ny; j++) {
      const row = j * (nx + 1);
      this.u[row] = this.uInf;
      this.u[row + nx] = this.u[row + nx - 1];
    }
    for (let j = 0; j <= ny; j++) {
      const row = j * nx;
      this.v[row] = this.v[row + 1] || 0;
      this.v[row + nx - 1] = this.v[row + nx - 2] || 0;
    }
    for (let i = 0; i < nx; i++) {
      this.v[i] = 0;
      this.v[ny * nx + i] = 0;
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const idx = j * (nx + 1) + i;
        if (i > 0 && i < nx) {
          const cL = j * nx + (i - 1);
          const cR = j * nx + i;
          if (this.solid[cL] || this.solid[cR]) {
            this.u[idx] = 0;
          }
        }
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (j > 0 && j < ny) {
          const cB = (j - 1) * nx + i;
          const cT = j * nx + i;
          if (this.solid[cB] || this.solid[cT]) {
            this.v[idx] = 0;
          }
        }
      }
    }
  }

  buildPoissonData() {
    const nx = this.nx;
    const ny = this.ny;
    const wX = 1 / (this.dx * this.dx);
    const wY = 1 / (this.dy * this.dy);
    this.pCount = new Int32Array(this.nCells);
    this.pL = new Int32Array(this.nCells);
    this.pR = new Int32Array(this.nCells);
    this.pB = new Int32Array(this.nCells);
    this.pT = new Int32Array(this.nCells);
    this.pWL = new Float64Array(this.nCells);
    this.pWR = new Float64Array(this.nCells);
    this.pWB = new Float64Array(this.nCells);
    this.pWT = new Float64Array(this.nCells);

    const nFluidTmp = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (this.solid[idx]) continue;
        nFluidTmp.push(idx);
        let cnt = 0;
        let L = -1;
        let R = -1;
        let B = -1;
        let T = -1;
        let wL = 0;
        let wR = 0;
        let wB = 0;
        let wT = 0;
        if (i > 0 && !this.solid[idx - 1]) {
          L = idx - 1;
          wL = wX;
          cnt++;
        }
        if (i < nx - 1 && !this.solid[idx + 1]) {
          R = idx + 1;
          wR = wX;
          cnt++;
        }
        if (j > 0 && !this.solid[idx - nx]) {
          B = idx - nx;
          wB = wY;
          cnt++;
        }
        if (j < ny - 1 && !this.solid[idx + nx]) {
          T = idx + nx;
          wT = wY;
          cnt++;
        }
        this.pCount[idx] = cnt;
        this.pL[idx] = L;
        this.pR[idx] = R;
        this.pB[idx] = B;
        this.pT[idx] = T;
        this.pWL[idx] = wL;
        this.pWR[idx] = wR;
        this.pWB[idx] = wB;
        this.pWT[idx] = wT;
      }
    }

    this.nFluid = nFluidTmp.length;
    this.rowOf = new Int32Array(this.nCells);
    this.rowOf.fill(-1);
    this.fluidIdx = new Int32Array(this.nFluid);
    for (let k = 0; k < this.nFluid; k++) {
      this.rowOf[nFluidTmp[k]] = k;
      this.fluidIdx[k] = nFluidTmp[k];
    }
    this.fNb = new Int32Array(this.nFluid * 4);
    this.fW = new Float64Array(this.nFluid * 4);
    this.fDiag = new Float64Array(this.nFluid);
    for (let k = 0; k < this.nFluid; k++) {
      const idx = nFluidTmp[k];
      const L = this.pL[idx];
      const R = this.pR[idx];
      const B = this.pB[idx];
      const T = this.pT[idx];
      const nb = this.fNb;
      const w = this.fW;
      let cnt = 0;
      if (L >= 0) {
        nb[k * 4 + cnt] = this.rowOf[L];
        w[k * 4 + cnt] = this.pWL[idx];
        cnt++;
      }
      if (R >= 0) {
        nb[k * 4 + cnt] = this.rowOf[R];
        w[k * 4 + cnt] = this.pWR[idx];
        cnt++;
      }
      if (B >= 0) {
        nb[k * 4 + cnt] = this.rowOf[B];
        w[k * 4 + cnt] = this.pWB[idx];
        cnt++;
      }
      if (T >= 0) {
        nb[k * 4 + cnt] = this.rowOf[T];
        w[k * 4 + cnt] = this.pWT[idx];
        cnt++;
      }
      for (let q = cnt; q < 4; q++) {
        nb[k * 4 + q] = -1;
        w[k * 4 + q] = 0;
      }
      this.fDiag[k] = this.pWL[idx] + this.pWR[idx] + this.pWB[idx] + this.pWT[idx];
    }
  }

  computeDivergence() {
    const nx = this.nx;
    const ny = this.ny;
    const div = new Float64Array(this.nCells);
    const invDx = 1 / this.dx;
    const invDy = 1 / this.dy;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (this.solid[idx]) continue;
        const ue = this.u[j * (nx + 1) + i + 1];
        const uw = this.u[j * (nx + 1) + i];
        const vn = this.v[(j + 1) * nx + i];
        const vs = this.v[j * nx + i];
        div[idx] = (ue - uw) * invDx + (vn - vs) * invDy;
      }
    }
    return div;
  }

  /**
   * Jacobi-preconditioned CG for the pressure Poisson system over the reduced
   * fluid-unknown set. The operator B = -A with
   *   (B p)[k] = sum_nb w_nb * p[nb] - diag[k] * p[k]
   * is symmetric positive definite (Diag = sum of neighbor weights, zero rows
   * for solid cells are excluded). The RHS is -div/dt, so B p = -div/dt
   * solves the discrete Laplacian system. Deterministic, no RNG.
   */
  solvePressure(div) {
    const nf = this.nFluid;
    if (nf === 0) return;
    const nb = this.fNb;
    const w = this.fW;
    const diag = this.fDiag;
    const p = this.p;
    const fluid = this.fluidIdx;

    const x = new Float64Array(nf);
    const b = new Float64Array(nf);
    const r = new Float64Array(nf);
    const z = new Float64Array(nf);
    const d = new Float64Array(nf);
    const q = new Float64Array(nf);

    const invDt = 1 / this.dt;
    let bNorm2 = 0;
    for (let k = 0; k < nf; k++) {
      x[k] = p[fluid[k]];
      b[k] = -invDt * div[fluid[k]];
      bNorm2 += b[k] * b[k];
    }
    if (!(bNorm2 > 0)) {
      return;
    }
    const tol2 = bNorm2 * 1e-18;

    const matvec = (inVec, outVec) => {
      for (let k = 0; k < nf; k++) {
        const base = k * 4;
        let acc = diag[k] * inVec[k];
        for (let qq = 0; qq < 4; qq++) {
          const nk = nb[base + qq];
          if (nk >= 0) {
            acc -= w[base + qq] * inVec[nk];
          }
        }
        outVec[k] = acc;
      }
    };

    matvec(x, q);
    let rz = 0;
    for (let k = 0; k < nf; k++) {
      r[k] = b[k] - q[k];
      z[k] = r[k] / diag[k];
      d[k] = z[k];
      rz += r[k] * z[k];
    }

    const maxIter = 400;
    for (let iter = 0; iter < maxIter; iter++) {
      matvec(d, q);
      let dq = 0;
      for (let k = 0; k < nf; k++) {
        dq += d[k] * q[k];
      }
      const alpha = rz / dq;

      for (let k = 0; k < nf; k++) {
        x[k] += alpha * d[k];
        r[k] -= alpha * q[k];
        z[k] = r[k] / diag[k];
      }

      let rNorm2 = 0;
      let rzNew = 0;
      for (let k = 0; k < nf; k++) {
        rNorm2 += r[k] * r[k];
        rzNew += r[k] * z[k];
      }
      if (rNorm2 < tol2) break;

      const beta = rzNew / rz;
      rz = rzNew;
      for (let k = 0; k < nf; k++) {
        d[k] = z[k] + beta * d[k];
      }
    }

    for (let k = 0; k < nf; k++) {
      p[fluid[k]] = x[k];
    }
  }

  project(div) {
    const nx = this.nx;
    const ny = this.ny;
    const dt = this.dt;
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const uIdx = j * (nx + 1) + i;
        const cL = j * nx + (i - 1);
        const cR = j * nx + i;
        if (this.solid[cL] || this.solid[cR]) continue;
        this.u[uIdx] -= (dt * (this.p[cR] - this.p[cL])) / this.dx;
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const vIdx = j * nx + i;
        const cB = (j - 1) * nx + i;
        const cT = j * nx + i;
        if (this.solid[cB] || this.solid[cT]) continue;
        this.v[vIdx] -= (dt * (this.p[cT] - this.p[cB])) / this.dy;
      }
    }
  }

  momPredictor() {
    const nx = this.nx;
    const ny = this.ny;
    const dx = this.dx;
    const dy = this.dy;
    const invDx2 = 1 / (dx * dx);
    const invDy2 = 1 / (dy * dy);
    const nu = this.nu;
    const alpha = this.advectionAlpha;
    const u = this.u;
    const v = this.v;
    const nuT = this.nuT;
    const du = new Float64Array(this.nU);
    const dv = new Float64Array(this.nV);

    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const uIdx = j * (nx + 1) + i;
        const cL = j * nx + (i - 1);
        const cR = j * nx + i;
        if (this.solid[cL] || this.solid[cR]) continue;
        const uHere = u[uIdx];
        const uW = u[j * (nx + 1) + i - 1];
        const uE = u[j * (nx + 1) + i + 1];
        const uN = j < ny - 1 ? u[(j + 1) * (nx + 1) + i] : uHere;
        const uS = j > 0 ? u[(j - 1) * (nx + 1) + i] : uHere;

        const vN = 0.5 * (v[(j + 1) * nx + i - 1] + v[(j + 1) * nx + i]);
        const vS = 0.5 * (v[j * nx + i - 1] + v[j * nx + i]);

        const dUdxUp = uHere >= 0 ? (uHere - uW) / dx : (uHere - uE) / dx;
        const dUdyUp = vN >= 0 ? (uN - uHere) / dy : (uHere - uS) / dy;
        const convX = (1 - alpha) * uHere * dUdxUp + (alpha * uHere * (uE - uW)) / (2 * dx);
        const convY = (1 - alpha) * vN * dUdyUp + (alpha * vN * (uN - uS)) / (2 * dy);

        const nuEffL = nu + nuT[cL] * this.fv1At(cL) + this.nuFloor[cL];
        const nuEffR = nu + nuT[cR] * this.fv1At(cR) + this.nuFloor[cR];

        const pGrad = (this.p[cR] - this.p[cL]) / dx;

        let sponge = 0;
        if (this.spongeLen > 0) {
          const x = i * dx;
          const xStart = this.lx - this.spongeLen;
          if (x > xStart) {
            const f = Math.min(1, (x - xStart) / this.spongeLen);
            sponge = this.dt * f * f * (uHere - this.uInf) * 4;
          }
        }

        du[uIdx] = -(convX + convY) - pGrad - sponge;
      }
    }

    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const vIdx = j * nx + i;
        const cB = (j - 1) * nx + i;
        const cT = j * nx + i;
        if (this.solid[cB] || this.solid[cT]) continue;
        const vHere = v[vIdx];
        const vB = v[(j - 1) * nx + i];
        const vT = v[(j + 1) * nx + i];
        const vW = i > 0 ? v[j * nx + i - 1] : vHere;
        const vE = i < nx - 1 ? v[j * nx + i + 1] : vHere;

        const uW = 0.5 * (u[j * (nx + 1) + i] + u[(j - 1) * (nx + 1) + i]);
        const uE = 0.5 * (u[j * (nx + 1) + i + 1] + u[(j - 1) * (nx + 1) + i + 1]);

        const dVdyUp = vHere >= 0 ? (vHere - vB) / dy : (vHere - vT) / dy;
        const dVdxUp = uE >= 0 ? (vE - vHere) / dx : (vHere - vW) / dx;
        const convY = (1 - alpha) * vHere * dVdyUp + (alpha * vHere * (vT - vB)) / (2 * dy);
        const convX = (1 - alpha) * uE * dVdxUp + (alpha * uE * (vE - vW)) / (2 * dx);

        const nuEffB = nu + this.nuT[cB] * this.fv1At(cB) + this.nuFloor[cB];
        const nuEffT = nu + this.nuT[cT] * this.fv1At(cT) + this.nuFloor[cT];

        const pGrad = (this.p[cT] - this.p[cB]) / dy;

        let sponge = 0;
        if (this.spongeLen > 0) {
          const x = (i + 0.5) * dx;
          const xStart = this.lx - this.spongeLen;
          if (x > xStart) {
            const f = Math.min(1, (x - xStart) / this.spongeLen);
            sponge = this.dt * f * f * vHere * 4;
          }
        }

        dv[vIdx] = -(convX + convY) - pGrad - sponge;
      }
    }

    for (let k = 0; k < this.nU; k++) {
      this.u[k] += this.dt * du[k];
    }
    for (let k = 0; k < this.nV; k++) {
      this.v[k] += this.dt * dv[k];
    }
    this.implicitViscousUpdate();
  }

  implicitViscousUpdate() {
    const nx = this.nx;
    const ny = this.ny;
    const dx = this.dx;
    const dy = this.dy;
    const dt = this.dt;
    const invSigma = 1.5;
    const u = this.u;
    const v = this.v;
    const nuT = this.nuT;

    for (let sweep = 0; sweep < 5; sweep++) {
      if (sweep % 2 === 0) {
        for (let j = 0; j < ny; j++) {
          for (let i = 1; i < nx; i++) {
            const idx = j * (nx + 1) + i;
            if (this.solid[j * nx + i - 1] || this.solid[j * nx + i]) continue;
            let nb = u[idx];
            let w = 1;
            if (i > 1 && !this.solid[j * nx + i - 2]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] +
                      nuT[j * nx + i - 2] +
                      this.nuFloor[j * nx + i - 1] +
                      this.nuFloor[j * nx + i - 2])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * u[idx - 1];
              w += dt * k;
            }
            if (i < nx - 1 && !this.solid[j * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] + nuT[j * nx + i] + this.nuFloor[j * nx + i - 1] + this.nuFloor[j * nx + i])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * u[idx + 1];
              w += dt * k;
            }
            if (j > 0 && !this.solid[(j - 1) * nx + i - 1] && !this.solid[(j - 1) * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] +
                      nuT[(j - 1) * nx + i - 1] +
                      this.nuFloor[j * nx + i - 1] +
                      this.nuFloor[(j - 1) * nx + i - 1])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * u[(j - 1) * (nx + 1) + i];
              w += dt * k;
            }
            if (j < ny - 1 && !this.solid[(j + 1) * nx + i - 1] && !this.solid[(j + 1) * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] +
                      nuT[(j + 1) * nx + i - 1] +
                      this.nuFloor[j * nx + i - 1] +
                      this.nuFloor[(j + 1) * nx + i - 1])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * u[(j + 1) * (nx + 1) + i];
              w += dt * k;
            }
            u[idx] = nb / w;
          }
        }
      } else {
        for (let j = ny - 1; j >= 0; j--) {
          for (let i = nx - 1; i >= 1; i--) {
            const idx = j * (nx + 1) + i;
            if (this.solid[j * nx + i - 1] || this.solid[j * nx + i]) continue;
            let nb = u[idx];
            let w = 1;
            if (i > 1 && !this.solid[j * nx + i - 2]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] +
                      nuT[j * nx + i - 2] +
                      this.nuFloor[j * nx + i - 1] +
                      this.nuFloor[j * nx + i - 2])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * u[idx - 1];
              w += dt * k;
            }
            if (i < nx - 1 && !this.solid[j * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] + nuT[j * nx + i] + this.nuFloor[j * nx + i - 1] + this.nuFloor[j * nx + i])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * u[idx + 1];
              w += dt * k;
            }
            if (j > 0 && !this.solid[(j - 1) * nx + i - 1] && !this.solid[(j - 1) * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] +
                      nuT[(j - 1) * nx + i - 1] +
                      this.nuFloor[j * nx + i - 1] +
                      this.nuFloor[(j - 1) * nx + i - 1])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * u[(j - 1) * (nx + 1) + i];
              w += dt * k;
            }
            if (j < ny - 1 && !this.solid[(j + 1) * nx + i - 1] && !this.solid[(j + 1) * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[j * nx + i - 1] +
                      nuT[(j + 1) * nx + i - 1] +
                      this.nuFloor[j * nx + i - 1] +
                      this.nuFloor[(j + 1) * nx + i - 1])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * u[(j + 1) * (nx + 1) + i];
              w += dt * k;
            }
            u[idx] = nb / w;
          }
        }
      }
    }

    for (let sweep = 0; sweep < 5; sweep++) {
      if (sweep % 2 === 0) {
        for (let j = 1; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const idx = j * nx + i;
            if (this.solid[(j - 1) * nx + i] || this.solid[j * nx + i]) continue;
            let nb = v[idx];
            let w = 1;
            if (j > 1 && !this.solid[(j - 2) * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[(j - 2) * nx + i] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[(j - 2) * nx + i])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * v[(j - 1) * nx + i];
              w += dt * k;
            }
            if (j < ny - 1 && !this.solid[j * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[j * nx + i] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[j * nx + i])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * v[(j + 1) * nx + i];
              w += dt * k;
            }
            if (i > 0 && !this.solid[(j - 1) * nx + i - 1] && !this.solid[j * nx + i - 1]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[(j - 1) * nx + i - 1] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[(j - 1) * nx + i - 1])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * v[idx - 1];
              w += dt * k;
            }
            if (i < nx - 1 && !this.solid[(j - 1) * nx + i + 1] && !this.solid[j * nx + i + 1]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[(j - 1) * nx + i + 1] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[(j - 1) * nx + i + 1])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * v[idx + 1];
              w += dt * k;
            }
            v[idx] = nb / w;
          }
        }
      } else {
        for (let j = ny - 1; j >= 1; j--) {
          for (let i = nx - 1; i >= 0; i--) {
            const idx = j * nx + i;
            if (this.solid[(j - 1) * nx + i] || this.solid[j * nx + i]) continue;
            let nb = v[idx];
            let w = 1;
            if (j > 1 && !this.solid[(j - 2) * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[(j - 2) * nx + i] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[(j - 2) * nx + i])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * v[(j - 1) * nx + i];
              w += dt * k;
            }
            if (j < ny - 1 && !this.solid[j * nx + i]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[j * nx + i] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[j * nx + i])) *
                  invSigma) /
                (dy * dy);
              nb += dt * k * v[(j + 1) * nx + i];
              w += dt * k;
            }
            if (i > 0 && !this.solid[(j - 1) * nx + i - 1] && !this.solid[j * nx + i - 1]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[(j - 1) * nx + i - 1] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[(j - 1) * nx + i - 1])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * v[idx - 1];
              w += dt * k;
            }
            if (i < nx - 1 && !this.solid[(j - 1) * nx + i + 1] && !this.solid[j * nx + i + 1]) {
              const k =
                ((this.nu +
                  0.5 *
                    (nuT[(j - 1) * nx + i] +
                      nuT[(j - 1) * nx + i + 1] +
                      this.nuFloor[(j - 1) * nx + i] +
                      this.nuFloor[(j - 1) * nx + i + 1])) *
                  invSigma) /
                (dx * dx);
              nb += dt * k * v[idx + 1];
              w += dt * k;
            }
            v[idx] = nb / w;
          }
        }
      }
    }
  }

  fv1At(idx) {
    const nuT = this.nuT[idx];
    const nu = this.nu;
    if (nuT <= 0) return 0;
    const chi = nuT / nu;
    return saFv1(chi);
  }

  advanceSADess() {
    const nx = this.nx;
    const ny = this.ny;
    const dx = this.dx;
    const dy = this.dy;
    const C = SA_DES_CONSTANTS;
    const nu = this.nu;
    const dt = this.dt;
    const u = this.u;
    const v = this.v;
    const nuT = this.nuT;
    const dist = this.dist;
    const solid = this.solid;
    const nuCap = Math.max(nu * 100, 0.05 * this.uInf * this.d);

    const invSigma = 1 / C.sigma;
    const cb2OverSigma = C.cb2 / C.sigma;

    const rhs = new Float64Array(this.nCells);
    const diag = new Float64Array(this.nCells);
    const val = new Float64Array(this.nCells);
    for (let k = 0; k < this.nCells; k++) {
      val[k] = nuT[k];
    }

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (solid[idx]) {
          rhs[idx] = 0;
          diag[idx] = 1;
          continue;
        }

        const uCell = 0.5 * (u[j * (nx + 1) + i] + u[j * (nx + 1) + i + 1]);
        const vCell = 0.5 * (v[j * nx + i] + v[(j + 1) * nx + i]);

        const omega = (v[(j + 1) * nx + i] - v[j * nx + i]) / dy - (u[j * (nx + 1) + i + 1] - u[j * (nx + 1) + i]) / dx;
        const omegaAbs = Math.abs(omega);

        const d = dist[idx];
        const nuTilde = nuT[idx];
        const chi = nuTilde / nu;
        const fv1Val = saFv1(chi);
        const fv2Val = saFv2(chi, fv1Val);
        const k2d2 = C.kappa * C.kappa * d * d;
        const s = Math.max(saSMod(omegaAbs, nuTilde, nu, d), this.saSFloor);

        const rd = rdRatio(nuTilde + nu, d, omegaAbs);
        const fd = fdShielding(rd);
        const lLes = lesDelta(this.delta, C.cdes);
        const lDes = desLengthScale(d, lLes, fd);

        const r = nuTilde / (s * k2d2 + 1e-30);
        const fw = saFw(r);

        const nuTildeN = i < nx - 1 ? nuT[idx + 1] : nuTilde;
        const nuTildeS = i > 0 ? nuT[idx - 1] : nuTilde;
        const nuTildeE = j < ny - 1 ? nuT[idx + nx] : nuTilde;
        const nuTildeW = j > 0 ? nuT[idx - nx] : nuTilde;

        const gradX = (nuTildeN - nuTildeS) / (2 * dx);
        const gradY = (nuTildeE - nuTildeW) / (2 * dy);
        const crossDiff = cb2OverSigma * (gradX * gradX + gradY * gradY);

        let advX;
        if (uCell >= 0) {
          advX = (uCell * (nuTilde - (i > 0 ? nuT[idx - 1] : nuTilde))) / dx;
        } else {
          advX = (uCell * ((i < nx - 1 ? nuT[idx + 1] : nuTilde) - nuTilde)) / dx;
        }
        let advY;
        if (vCell >= 0) {
          advY = (vCell * (nuTilde - (j > 0 ? nuT[idx - nx] : nuTilde))) / dy;
        } else {
          advY = (vCell * ((j < ny - 1 ? nuT[idx + nx] : nuTilde) - nuTilde)) / dy;
        }

        const destructionCoef = (C.cw1 * fw * nuTilde) / Math.max(lDes * lDes, 1e-30);
        const productionCoef = C.cb1 * s;

        rhs[idx] = nuTilde + dt * (productionCoef * nuTilde + crossDiff - advX - advY);
        diag[idx] = 1 + dt * destructionCoef;
      }
    }

    for (let sweep = 0; sweep < 5; sweep++) {
      if (sweep % 2 === 0) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const idx = j * nx + i;
            if (solid[idx]) continue;
            let sum = rhs[idx];
            let wSum = diag[idx];
            if (i > 0 && !solid[idx - 1]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx - 1])) * invSigma) / (dx * dx);
              sum += nuEff * dt * val[idx - 1];
              wSum += nuEff * dt;
            }
            if (i < nx - 1 && !solid[idx + 1]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx + 1])) * invSigma) / (dx * dx);
              sum += nuEff * dt * val[idx + 1];
              wSum += nuEff * dt;
            }
            if (j > 0 && !solid[idx - nx]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx - nx])) * invSigma) / (dy * dy);
              sum += nuEff * dt * val[idx - nx];
              wSum += nuEff * dt;
            }
            if (j < ny - 1 && !solid[idx + nx]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx + nx])) * invSigma) / (dy * dy);
              sum += nuEff * dt * val[idx + nx];
              wSum += nuEff * dt;
            }
            let out = sum / wSum;
            if (!(out >= 0)) out = 0;
            if (out > nuCap) out = nuCap;
            val[idx] = out;
          }
        }
      } else {
        for (let j = ny - 1; j >= 0; j--) {
          for (let i = nx - 1; i >= 0; i--) {
            const idx = j * nx + i;
            if (solid[idx]) continue;
            let sum = rhs[idx];
            let wSum = diag[idx];
            if (i > 0 && !solid[idx - 1]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx - 1])) * invSigma) / (dx * dx);
              sum += nuEff * dt * val[idx - 1];
              wSum += nuEff * dt;
            }
            if (i < nx - 1 && !solid[idx + 1]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx + 1])) * invSigma) / (dx * dx);
              sum += nuEff * dt * val[idx + 1];
              wSum += nuEff * dt;
            }
            if (j > 0 && !solid[idx - nx]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx - nx])) * invSigma) / (dy * dy);
              sum += nuEff * dt * val[idx - nx];
              wSum += nuEff * dt;
            }
            if (j < ny - 1 && !solid[idx + nx]) {
              const nuEff = ((nu + 0.5 * (nuT[idx] + nuT[idx + nx])) * invSigma) / (dy * dy);
              sum += nuEff * dt * val[idx + nx];
              wSum += nuEff * dt;
            }
            let out = sum / wSum;
            if (!(out >= 0)) out = 0;
            if (out > nuCap) out = nuCap;
            val[idx] = out;
          }
        }
      }
    }

    let productionTotal = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (solid[idx]) {
          this.nuT[idx] = 0;
          continue;
        }
        const nuTilde = val[idx];
        const d = dist[idx];
        const omegaAbs = Math.abs(
          (v[(j + 1) * nx + i] - v[j * nx + i]) / dy - (u[j * (nx + 1) + i + 1] - u[j * (nx + 1) + i]) / dx
        );
        const s = saSMod(omegaAbs, nuTilde, nu, d);
        productionTotal += C.cb1 * s * nuTilde;
        this.nuT[idx] = nuTilde;
      }
    }
    this.lastProductionTotal = productionTotal;
  }

  computeLift() {
    const nx = this.nx;
    const ny = this.ny;
    let fy = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (this.solid[idx]) continue;
        if (j < ny - 1 && this.solid[idx + nx]) {
          fy += this.p[idx] * this.dx;
        }
        if (j > 0 && this.solid[idx - nx]) {
          fy -= this.p[idx] * this.dx;
        }
      }
    }
    return fy / (0.5 * this.uInf * this.uInf * this.d);
  }

  checkFinite() {
    let bad = 0;
    for (let k = 0; k < this.nU; k++) {
      if (!Number.isFinite(this.u[k])) bad++;
    }
    for (let k = 0; k < this.nV; k++) {
      if (!Number.isFinite(this.v[k])) bad++;
    }
    for (let k = 0; k < this.nCells; k++) {
      if (!Number.isFinite(this.p[k]) || !Number.isFinite(this.nuT[k])) bad++;
    }
    return bad === 0;
  }

  applyVelocityFilter() {
    const beta = this.filterBeta;
    if (beta <= 0) return;
    const nx = this.nx;
    const ny = this.ny;
    const u = this.u;
    const v = this.v;
    const uF = new Float64Array(this.nU);
    const vF = new Float64Array(this.nV);
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const idx = j * (nx + 1) + i;
        const cL = j * nx + (i - 1);
        const cR = j * nx + i;
        if (this.solid[cL] || this.solid[cR]) {
          uF[idx] = u[idx];
          continue;
        }
        const uW = u[idx - 1];
        const uE = u[idx + 1];
        uF[idx] = u[idx] + beta * (uW - 2 * u[idx] + uE) * 0.5;
      }
      uF[j * (nx + 1)] = u[j * (nx + 1)];
      uF[j * (nx + 1) + nx] = u[j * (nx + 1) + nx];
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        const cB = (j - 1) * nx + i;
        const cT = j * nx + i;
        if (this.solid[cB] || this.solid[cT]) {
          vF[idx] = v[idx];
          continue;
        }
        const vB = v[idx - nx];
        const vT = v[idx + nx];
        vF[idx] = v[idx] + beta * (vB - 2 * v[idx] + vT) * 0.5;
      }
    }
    for (let i = 0; i < nx; i++) {
      vF[i] = v[i];
      vF[ny * nx + i] = v[ny * nx + i];
    }
    for (let k = 0; k < this.nU; k++) {
      this.u[k] = uF[k];
    }
    for (let k = 0; k < this.nV; k++) {
      this.v[k] = vF[k];
    }
  }

  step() {
    this.momPredictor();
    const div = this.computeDivergence();
    this.solvePressure(div);
    this.project(div);
    this.applyVelocityFilter();
    this.advanceSADess();
    if (this.stepCount % this.historyEvery === 0) {
      const cl = this.computeLift();
      this.clHistory.push(cl);
      this.tHistory.push(this.t);
    }
    if (!this.checkFinite()) {
      this.nanCount++;
    }
    this.applyBoundaryConditions();
    this.t += this.dt;
    this.stepCount++;
  }

  run() {
    this.buildPoissonData();
    const t0 = Date.now();
    while (this.t < this.endTime - 1e-12) {
      this.step();
    }
    this.runtimeMs = Date.now() - t0;
    return this;
  }

  minNuTilde() {
    let m = Infinity;
    for (let k = 0; k < this.nCells; k++) {
      if (this.nuT[k] < m) m = this.nuT[k];
    }
    return m;
  }

  maxNuTilde() {
    let m = -Infinity;
    for (let k = 0; k < this.nCells; k++) {
      if (this.nuT[k] > m) m = this.nuT[k];
    }
    return m;
  }

  /**
   * Strouhal number from the lift history via FFT and zero crossings.
   * @returns {Object} { stFft, stZeroCross, meanCl, fftPeakFreq }
   */
  computeStrouhal() {
    const cl = this.clHistory;
    const t = this.tHistory;
    const n = cl.length;
    if (n < 16) {
      return { stFft: NaN, stZeroCross: NaN, meanCl: NaN, fftPeakFreq: NaN };
    }

    let start = 0;
    for (let k = 0; k < n; k++) {
      if (t[k] >= this.settleTime) {
        start = k;
        break;
      }
    }
    const segLen = n - start;
    const m = Math.min(segLen, 4096);

    let mean = 0;
    for (let k = start; k < start + m; k++) mean += cl[k];
    mean /= m;

    const dtSample = (t[start + m - 1] - t[start]) / (m - 1);

    const crossings = [];
    let prev = cl[start] - mean;
    for (let k = start + 1; k < start + m; k++) {
      const cur = cl[k] - mean;
      if ((prev <= 0 && cur > 0) || (prev >= 0 && cur < 0)) {
        const frac = prev / (prev - cur);
        crossings.push(t[k - 1] + frac * dtSample);
      }
      prev = cur;
    }
    let stZeroCross = NaN;
    if (crossings.length >= 4) {
      let sum = 0;
      let cnt = 0;
      for (let k = 1; k < crossings.length; k++) {
        sum += crossings[k] - crossings[k - 1];
        cnt++;
      }
      const halfPeriod = sum / cnt;
      stZeroCross = 1 / (2 * halfPeriod);
    }

    let stFft = NaN;
    let fftPeakFreq = NaN;
    const fftN = 1 << Math.ceil(Math.log2(m));
    const re = new Float64Array(fftN);
    const im = new Float64Array(fftN);
    for (let k = 0; k < m; k++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * k) / (m - 1)));
      re[k] = (cl[start + k] - mean) * w;
    }
    for (let k = m; k < fftN; k++) {
      re[k] = 0;
    }
    this.fft(re, im);
    let peak = 0;
    let peakBin = -1;
    const bins = fftN / 2;
    for (let b = 1; b < bins; b++) {
      const mag = Math.hypot(re[b], im[b]);
      if (mag > peak) {
        peak = mag;
        peakBin = b;
      }
    }
    if (peakBin > 0) {
      const freqD = peakBin / (fftN * dtSample);
      const freq = (freqD / this.uInf) * this.d;
      if (freq > 0.05 && freq < 0.6) {
        stFft = freq;
        fftPeakFreq = freq;
      }
    }

    return { stFft, stZeroCross, meanCl: mean, fftPeakFreq };
  }

  fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }
      j ^= bit;
      if (i < j) {
        let tmp = re[i];
        re[i] = re[j];
        re[j] = tmp;
        tmp = im[i];
        im[i] = im[j];
        im[j] = tmp;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wRe = Math.cos(ang);
      const wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1;
        let curIm = 0;
        for (let k = 0; k < len / 2; k++) {
          const aRe = re[i + k];
          const aIm = im[i + k];
          const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
          const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
          re[i + k] = aRe + bRe;
          im[i + k] = aIm + bIm;
          re[i + k + len / 2] = aRe - bRe;
          im[i + k + len / 2] = aIm - bIm;
          const nRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nRe;
        }
      }
    }
  }
}

module.exports = {
  SA_DES_CONSTANTS,
  saFv1,
  saFv2,
  saSMod,
  saFw,
  fdShielding,
  rdRatio,
  desLengthScale,
  lesDelta,
  saDessClosure,
  Lcg,
  VortexSheddingSolver
};
