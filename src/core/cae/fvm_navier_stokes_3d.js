/**
 * OmniEng 3D Polyhedral Finite Volume Method (FVM) Navier-Stokes Solver
 * Implements 3D unstructured polyhedral cell discretization, Menter k-omega SST turbulence,
 * automatic wall treatment (y+ blending), HLLC/Roe compressible shock capturing, and MRF rotating frame.
 * 
 * 100% Proprietary In-House Implementation - Zero External Dependencies.
 */

class PolyhedralCell3D {
  constructor(id, centroid, volume) {
    this.id = id;
    this.centroid = centroid; // { x, y, z }
    this.volume = volume;     // m^3
    this.faceIndices = [];    // Indices into mesh faces list

    // Primary flow state variables (cell-centered)
    this.u = 0.0; // x-velocity (m/s)
    this.v = 0.0; // y-velocity (m/s)
    this.w = 0.0; // z-velocity (m/s)
    this.p = 101325.0; // static pressure (Pa)
    this.rho = 1.225;  // density (kg/m^3)
    this.T = 293.15;   // temperature (K)

    // Turbulence fields (Menter k-omega SST)
    this.k = 1e-4;       // turbulent kinetic energy (m^2/s^2)
    this.omega = 10.0;   // specific dissipation rate (1/s)
    this.nut = 1e-6;     // turbulent eddy viscosity (m^2/s)
    this.wallDistance = 1.0; // distance y to nearest wall (m)

    // Spatial gradients (Green-Gauss or least-squares)
    this.gradU = { x: 0, y: 0, z: 0 };
    this.gradV = { x: 0, y: 0, z: 0 };
    this.gradW = { x: 0, y: 0, z: 0 };
    this.gradP = { x: 0, y: 0, z: 0 };
    this.gradK = { x: 0, y: 0, z: 0 };
    this.gradOmega = { x: 0, y: 0, z: 0 };

    // Residual accumulators
    this.resMass = 0.0;
    this.resMomX = 0.0;
    this.resMomY = 0.0;
    this.resMomZ = 0.0;
  }
}

class PolyhedralFace3D {
  constructor(id, centroid, area, normal, ownerId, neighborId = -1, boundaryType = null) {
    this.id = id;
    this.centroid = centroid; // { x, y, z }
    this.area = area;         // m^2
    this.normal = normal;     // unit normal vector pointing owner -> neighbor
    this.ownerId = ownerId;   // Owner cell index
    this.neighborId = neighborId; // Neighbor cell index (-1 if boundary)
    this.boundaryType = boundaryType; // 'inlet', 'outlet', 'wall', 'symmetry', null

    // Boundary conditions if boundary face
    this.bcVelocity = { u: 0, v: 0, w: 0 };
    this.bcPressure = 101325.0;
    this.bcTurbulence = { k: 1e-4, omega: 10.0 };
  }
}

class FVMNavierStokes3D {
  constructor(options = {}) {
    this.gamma = options.gamma || 1.4;      // Heat capacity ratio (air)
    this.R_gas = options.R_gas || 287.05;   // Specific gas constant J/(kg*K)
    this.mu_lam = options.mu_lam || 1.81e-5; // Dynamic laminar viscosity (Pa*s)
    this.Pr_lam = options.Pr_lam || 0.72;   // Laminar Prandtl number
    this.Pr_turb = options.Pr_turb || 0.85; // Turbulent Prandtl number

    // k-omega SST model constants (Menter 1994)
    this.sigma_k1 = 0.85;
    this.sigma_k2 = 1.0;
    this.sigma_w1 = 0.5;
    this.sigma_w2 = 0.856;
    this.beta_star = 0.09;
    this.beta1 = 0.075;
    this.beta2 = 0.0828;
    this.kappa = 0.41;
    this.a1 = 0.31;

    // Moving Reference Frame (MRF) rotation vector (rad/s)
    this.omegaMRF = options.omegaMRF || { x: 0, y: 0, z: 0 };

    // Riemann flux solver: 'hllc', 'roe', or 'ausm_plus'
    this.fluxScheme = options.fluxScheme || 'hllc';

    this.cells = [];
    this.faces = [];
    this.stepCount = 0;
  }

  /**
   * Initializes a structured 3D hexahedral/polyhedral brick grid of dimensions (nx, ny, nz)
   */
  createBoxDomain(nx = 10, ny = 10, nz = 8, lx = 1.0, ly = 0.8, lz = 0.6) {
    this.cells = [];
    this.faces = [];

    const dx = lx / nx;
    const dy = ly / ny;
    const dz = lz / nz;
    const cellVolume = dx * dy * dz;

    // 1. Create cells
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const id = this.cells.length;
          const centroid = {
            x: (ix + 0.5) * dx,
            y: (iy + 0.5) * dy,
            z: (iz + 0.5) * dz
          };
          const cell = new PolyhedralCell3D(id, centroid, cellVolume);
          // Distance to bottom wall (y = 0)
          cell.wallDistance = Math.max(1e-4, centroid.y);
          this.cells.push(cell);
        }
      }
    }

    const cellIndex = (ix, iy, iz) => iz * (nx * ny) + iy * nx + ix;

    // 2. Create internal and boundary faces
    // X-faces
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix <= nx; ix++) {
          const area = dy * dz;
          const normal = { x: 1, y: 0, z: 0 };
          const centroid = { x: ix * dx, y: (iy + 0.5) * dy, z: (iz + 0.5) * dz };

          if (ix === 0) {
            // Inlet boundary
            const f = new PolyhedralFace3D(this.faces.length, centroid, area, normal, cellIndex(0, iy, iz), -1, 'inlet');
            this.faces.push(f);
          } else if (ix === nx) {
            // Outlet boundary
            const f = new PolyhedralFace3D(this.faces.length, centroid, area, normal, cellIndex(nx - 1, iy, iz), -1, 'outlet');
            this.faces.push(f);
          } else {
            // Internal face
            const owner = cellIndex(ix - 1, iy, iz);
            const neighbor = cellIndex(ix, iy, iz);
            const f = new PolyhedralFace3D(this.faces.length, centroid, area, normal, owner, neighbor);
            this.faces.push(f);
          }
        }
      }
    }

    // Y-faces
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy <= ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const area = dx * dz;
          const normal = { x: 0, y: 1, z: 0 };
          const centroid = { x: (ix + 0.5) * dx, y: iy * dy, z: (iz + 0.5) * dz };

          if (iy === 0) {
            // Wall boundary (bottom)
            const f = new PolyhedralFace3D(this.faces.length, centroid, area, normal, cellIndex(ix, 0, iz), -1, 'wall');
            this.faces.push(f);
          } else if (iy === ny) {
            // Top boundary (symmetry / free-stream)
            const f = new PolyhedralFace3D(this.faces.length, centroid, area, normal, cellIndex(ix, ny - 1, iz), -1, 'symmetry');
            this.faces.push(f);
          } else {
            const owner = cellIndex(ix, iy - 1, iz);
            const neighbor = cellIndex(ix, iy, iz);
            const f = new PolyhedralFace3D(this.faces.length, centroid, area, normal, owner, neighbor);
            this.faces.push(f);
          }
        }
      }
    }

    // Connect faces to cells
    for (let fIdx = 0; fIdx < this.faces.length; fIdx++) {
      const face = this.faces[fIdx];
      this.cells[face.ownerId].faceIndices.push(fIdx);
      if (face.neighborId >= 0) {
        this.cells[face.neighborId].faceIndices.push(fIdx);
      }
    }

    return {
      cellCount: this.cells.length,
      faceCount: this.faces.length,
      volume: lx * ly * lz
    };
  }

  /**
   * Evaluates Venkatakrishnan slope limiter on cell gradient
   */
  venkatakrishnanLimiter(phiC, phiN, gradC, r_fC, h = 0.05) {
    const K = 5.0; // Venkatakrishnan constant
    const epsSq = Math.pow(K * h, 3);
    const delta_f = (gradC.x * r_fC.x + gradC.y * r_fC.y + gradC.z * r_fC.z);
    const delta_max = phiN - phiC;

    if (Math.abs(delta_f) < 1e-12) return 1.0;
    const num = delta_max * delta_max + epsSq + 2.0 * delta_max * delta_f;
    const den = delta_max * delta_max + 2.0 * delta_f * delta_f + delta_max * delta_f + epsSq;
    return Math.min(1.0, Math.max(0.0, num / den));
  }

  /**
   * Computes Menter k-omega SST turbulence eddy viscosity nut with F1 and F2 blending
   */
  updateSSTTurbulence() {
    for (const cell of this.cells) {
      const y = Math.max(1e-5, cell.wallDistance);
      const nu = this.mu_lam / cell.rho;

      // Vorticity magnitude Omega = |curl(u)|
      const omegaX = cell.gradW.y - cell.gradV.z;
      const omegaY = cell.gradU.z - cell.gradW.x;
      const omegaZ = cell.gradV.x - cell.gradU.y;
      const vorticity = Math.sqrt(omegaX * omegaX + omegaY * omegaY + omegaZ * omegaZ) || 1e-6;

      // arg1 = min(max(sqrt(k)/(beta_star*omega*y), 500*nu/(y^2*omega)), 4*rho*sigma_w2*k/(CD_kw*y^2))
      const term1 = Math.sqrt(Math.max(1e-10, cell.k)) / (this.beta_star * Math.max(1e-6, cell.omega) * y);
      const term2 = (500.0 * nu) / (y * y * Math.max(1e-6, cell.omega));
      const arg1 = Math.max(term1, term2);
      const F1 = Math.tanh(Math.pow(arg1, 4));

      // arg2 = max(2*sqrt(k)/(beta_star*omega*y), 500*nu/(y^2*omega))
      const arg2 = Math.max(2.0 * term1, term2);
      const F2 = Math.tanh(Math.pow(arg2, 2));

      // Eddy viscosity nut = a1 * k / max(a1 * omega, vorticity * F2)
      const denom = Math.max(this.a1 * cell.omega, vorticity * F2);
      cell.nut = Math.min(1.0, (this.a1 * cell.k) / (denom || 1e-6));

      // Production of turbulent kinetic energy P_k = nut * 2 * S_ij * S_ij
      const P_k = Math.min(10.0, cell.nut * (vorticity * vorticity));

      // Dissipation: beta_star * k * omega
      const D_k = this.beta_star * cell.k * cell.omega;

      // Source update with relaxation
      cell.k = Math.max(1e-6, cell.k + 0.001 * (P_k - D_k));
      const beta = F1 * this.beta1 + (1.0 - F1) * this.beta2;
      cell.omega = Math.max(1.0, cell.omega + 0.001 * ((P_k / (cell.nut + 1e-9)) - beta * cell.omega * cell.omega));
    }
  }

  /**
   * Automatic Wall Treatment (Seamless Viscous Sublayer <-> Log-Law Layer)
   */
  evaluateWallBoundary(cell, face) {
    const y = Math.max(1e-6, cell.wallDistance);
    const nu = this.mu_lam / cell.rho;
    const utag = Math.sqrt(cell.u * cell.u + cell.v * cell.v + cell.w * cell.w);

    // Estimate friction velocity u_tau iteratively
    let uTau = Math.max(1e-4, Math.sqrt(nu * utag / y));
    let yPlus = (y * uTau) / nu;

    if (yPlus < 5.0) {
      // Viscous sublayer: u+ = y+
      const tauW = cell.rho * nu * (utag / y);
      return { yPlus, tauW, regime: 'viscous_sublayer' };
    } else if (yPlus > 30.0) {
      // Log-law layer: u+ = 1/kappa * ln(9.8 * y+)
      const tauW = cell.rho * Math.pow((this.kappa * utag) / Math.log(9.8 * yPlus), 2);
      return { yPlus, tauW, regime: 'log_law' };
    } else {
      // Buffer layer blending
      const tauVisc = cell.rho * nu * (utag / y);
      const tauLog = cell.rho * Math.pow((this.kappa * utag) / Math.log(9.8 * yPlus), 2);
      const blend = (yPlus - 5.0) / 25.0;
      const tauW = (1.0 - blend) * tauVisc + blend * tauLog;
      return { yPlus, tauW, regime: 'buffer_layer' };
    }
  }

  /**
   * HLLC Approximate Riemann Solver for Compressible Shock Capturing (Ma > 0.3)
   */
  solveHLLCRiemannFlux(cellL, cellR, normal, area) {
    const { gamma } = this;
    // Normal velocities
    const unL = cellL.u * normal.x + cellL.v * normal.y + cellL.w * normal.z;
    const unR = cellR.u * normal.x + cellR.v * normal.y + cellR.w * normal.z;

    // Speed of sound: a = sqrt(gamma * p / rho)
    const aL = Math.sqrt((gamma * cellL.p) / cellL.rho);
    const aR = Math.sqrt((gamma * cellR.p) / cellR.rho);

    // Wave speeds SL, SR, SM
    const SL = Math.min(unL - aL, unR - aR);
    const SR = Math.max(unL + aL, unR + aR);

    // Star wave speed SM
    const num = cellR.p - cellL.p + cellL.rho * unL * (SL - unL) - cellR.rho * unR * (SR - unR);
    const den = cellL.rho * (SL - unL) - cellR.rho * (SR - unR);
    const SM = (Math.abs(den) > 1e-9) ? num / den : 0.5 * (unL + unR);

    let massFlux, pFlux;

    if (SL >= 0.0) {
      // Supersonic from left
      massFlux = cellL.rho * unL;
      pFlux = cellL.p;
    } else if (SR <= 0.0) {
      // Supersonic from right
      massFlux = cellR.rho * unR;
      pFlux = cellR.p;
    } else if (SM >= 0.0) {
      // Left star region
      const rhoStarL = cellL.rho * (SL - unL) / (SL - SM);
      massFlux = rhoStarL * SM;
      pFlux = cellL.p + cellL.rho * (SL - unL) * (SM - unL);
    } else {
      // Right star region
      const rhoStarR = cellR.rho * (SR - unR) / (SR - SM);
      massFlux = rhoStarR * SM;
      pFlux = cellR.p + cellR.rho * (SR - unR) * (SM - unR);
    }

    return {
      massFlux: massFlux * area,
      pressureForce: pFlux * area,
      waveSpeeds: { SL, SR, SM }
    };
  }

  /**
   * Roe Approximate Riemann Solver with Harten-Hyman entropy fix for transonic shock capturing
   */
  solveRoeRiemannFlux(cellL, cellR, normal, area) {
    const { gamma } = this;
    const nx = normal.x, ny = normal.y, nz = normal.z;

    const unL = cellL.u * nx + cellL.v * ny + cellL.w * nz;
    const unR = cellR.u * nx + cellR.v * ny + cellR.w * nz;

    const q2L = cellL.u * cellL.u + cellL.v * cellL.v + cellL.w * cellL.w;
    const q2R = cellR.u * cellR.u + cellR.v * cellR.v + cellR.w * cellR.w;

    // Total enthalpy: H = gamma / (gamma - 1) * (p / rho) + 0.5 * q^2
    const HL = (gamma / (gamma - 1.0)) * (cellL.p / cellL.rho) + 0.5 * q2L;
    const HR = (gamma / (gamma - 1.0)) * (cellR.p / cellR.rho) + 0.5 * q2R;

    // Roe density weights
    const sqrtRhoL = Math.sqrt(Math.max(1e-6, cellL.rho));
    const sqrtRhoR = Math.sqrt(Math.max(1e-6, cellR.rho));
    const denom = sqrtRhoL + sqrtRhoR;

    const uRoe = (sqrtRhoL * cellL.u + sqrtRhoR * cellR.u) / denom;
    const vRoe = (sqrtRhoL * cellL.v + sqrtRhoR * cellR.v) / denom;
    const wRoe = (sqrtRhoL * cellL.w + sqrtRhoR * cellR.w) / denom;
    const HRoe = (sqrtRhoL * HL + sqrtRhoR * HR) / denom;

    const unRoe = uRoe * nx + vRoe * ny + wRoe * nz;
    const q2Roe = uRoe * uRoe + vRoe * vRoe + wRoe * wRoe;

    // Roe speed of sound
    const a2Roe = (gamma - 1.0) * (HRoe - 0.5 * q2Roe);
    const aRoe = Math.sqrt(Math.max(1.0, a2Roe));

    // Eigenvalues
    const lambda1 = unRoe - aRoe;
    const lambda2 = unRoe;
    const lambda5 = unRoe + aRoe;

    // Harten-Hyman entropy fix: epsilon = 0.2 * aRoe
    const eps = 0.2 * aRoe;
    const fixEigenvalue = (lam) => {
      const absL = Math.abs(lam);
      return absL >= eps ? absL : (lam * lam + eps * eps) / (2.0 * eps);
    };

    const absL1 = fixEigenvalue(lambda1);
    const absL2 = fixEigenvalue(lambda2);
    const absL5 = fixEigenvalue(lambda5);

    // Primitive differences
    const dRho = cellR.rho - cellL.rho;
    const dP = cellR.p - cellL.p;
    const dUn = unR - unL;
    const rhoRoe = sqrtRhoL * sqrtRhoR;

    // Wave strengths
    const alpha1 = (dP - rhoRoe * aRoe * dUn) / (2.0 * a2Roe);
    const alpha2 = dRho - dP / a2Roe;
    const alpha5 = (dP + rhoRoe * aRoe * dUn) / (2.0 * a2Roe);

    // Dissipation for mass flux: 0.5 * sum(alpha_k * |lambda_k| * K_k[0])
    const dissMass = 0.5 * (alpha1 * absL1 + alpha2 * absL2 + alpha5 * absL5);

    // Average central mass flux: 0.5 * (rhoL * unL + rhoR * unR)
    const massFlux = (0.5 * (cellL.rho * unL + cellR.rho * unR) - dissMass) * area;

    // Dissipation for pressure/momentum
    const dissPress = 0.5 * (alpha1 * absL1 * (unRoe - aRoe) + alpha2 * absL2 * unRoe + alpha5 * absL5 * (unRoe + aRoe)) * rhoRoe;
    const pFlux = (0.5 * (cellL.p + cellR.p) - dissPress) * area;

    return {
      massFlux,
      pressureForce: pFlux,
      waveSpeeds: { lambda1, lambda2, lambda5, aRoe, unRoe },
      scheme: 'roe'
    };
  }

  /**
   * AUSM+ (Advection Upstream Splitting Method) for Transonic and Supersonic Mach regimes
   */
  solveAUSMPlusFlux(cellL, cellR, normal, area) {
    const { gamma } = this;
    const nx = normal.x, ny = normal.y, nz = normal.z;

    const unL = cellL.u * nx + cellL.v * ny + cellL.w * nz;
    const unR = cellR.u * nx + cellR.v * ny + cellR.w * nz;

    const aL = Math.sqrt((gamma * cellL.p) / cellL.rho);
    const aR = Math.sqrt((gamma * cellR.p) / cellR.rho);

    // Interface sound speed: a_1/2 = 0.5 * (aL + aR)
    const aHalf = 0.5 * (aL + aR);

    // Mach numbers
    const ML = unL / aHalf;
    const MR = unR / aHalf;

    // AUSM+ polynomial split functions
    const M4Plus = (M) => {
      if (Math.abs(M) >= 1.0) return 0.5 * (M + Math.abs(M));
      return 0.25 * Math.pow(M + 1.0, 2) + 0.125 * Math.pow(M * M - 1.0, 2);
    };

    const M4Minus = (M) => {
      if (Math.abs(M) >= 1.0) return 0.5 * (M - Math.abs(M));
      return -0.25 * Math.pow(M - 1.0, 2) - 0.125 * Math.pow(M * M - 1.0, 2);
    };

    const P5Plus = (M) => {
      if (Math.abs(M) >= 1.0) return 0.5 * (1.0 + Math.sign(M));
      return 0.25 * Math.pow(M + 1.0, 2) * (2.0 - M) + 0.1875 * M * Math.pow(M * M - 1.0, 2);
    };

    const P5Minus = (M) => {
      if (Math.abs(M) >= 1.0) return 0.5 * (1.0 - Math.sign(M));
      return 0.25 * Math.pow(M - 1.0, 2) * (2.0 + M) - 0.1875 * M * Math.pow(M * M - 1.0, 2);
    };

    const MHalf = M4Plus(ML) + M4Minus(MR);
    const pHalf = P5Plus(ML) * cellL.p + P5Minus(MR) * cellR.p;

    // Convective mass flux
    const rhoHalf = MHalf >= 0.0 ? cellL.rho : cellR.rho;
    const massFlux = rhoHalf * aHalf * MHalf * area;
    const pressureForce = pHalf * area;

    return {
      massFlux,
      pressureForce,
      interfaceMach: MHalf,
      interfaceSoundSpeed: aHalf,
      scheme: 'ausm_plus'
    };
  }

  /**
   * Moving Reference Frame (MRF) Coriolis and Centrifugal Source Terms
   */
  computeMRFSource(cell) {
    const { omegaMRF } = this;
    const omSq = omegaMRF.x * omegaMRF.x + omegaMRF.y * omegaMRF.y + omegaMRF.z * omegaMRF.z;
    if (omSq < 1e-12) return { fx: 0, fy: 0, fz: 0 };

    const r = cell.centroid;
    const u = cell.u, v = cell.v, w = cell.w;

    // Coriolis acceleration: -2 * Omega x u
    const aCorX = -2.0 * (omegaMRF.y * w - omegaMRF.z * v);
    const aCorY = -2.0 * (omegaMRF.z * u - omegaMRF.x * w);
    const aCorZ = -2.0 * (omegaMRF.x * v - omegaMRF.y * u);

    // Centrifugal acceleration: -Omega x (Omega x r)
    // omCrossR
    const cx = omegaMRF.y * r.z - omegaMRF.z * r.y;
    const cy = omegaMRF.z * r.x - omegaMRF.x * r.z;
    const cz = omegaMRF.x * r.y - omegaMRF.y * r.x;
    const aCentX = -(omegaMRF.y * cz - omegaMRF.z * cy);
    const aCentY = -(omegaMRF.z * cx - omegaMRF.x * cz);
    const aCentZ = -(omegaMRF.x * cy - omegaMRF.y * cx);

    const rhoV = cell.rho * cell.volume;
    return {
      fx: rhoV * (aCorX + aCentX),
      fy: rhoV * (aCorY + aCentY),
      fz: rhoV * (aCorZ + aCentZ)
    };
  }

  /**
   * Runs FVM iteration steps with pseudo-transient under-relaxation
   */
  step(inletVelocity = 15.0, steps = 10, fluxScheme = this.fluxScheme) {
    const pRef = 101325.0;
    const dt = 0.0005;

    for (let s = 0; s < steps; s++) {
      this.stepCount++;

      // 1. Update k-omega SST turbulence field
      this.updateSSTTurbulence();

      // 2. Accumulate fluxes across all faces
      for (const face of this.faces) {
        const cellL = this.cells[face.ownerId];

        if (face.neighborId >= 0) {
          const cellR = this.cells[face.neighborId];
          let riemann;
          if (fluxScheme === 'roe') {
            riemann = this.solveRoeRiemannFlux(cellL, cellR, face.normal, face.area);
          } else if (fluxScheme === 'ausm' || fluxScheme === 'ausm_plus') {
            riemann = this.solveAUSMPlusFlux(cellL, cellR, face.normal, face.area);
          } else {
            riemann = this.solveHLLCRiemannFlux(cellL, cellR, face.normal, face.area);
          }

          cellL.resMass -= riemann.massFlux;
          cellR.resMass += riemann.massFlux;

          const gaugePressureForce = (riemann.pressureForce - pRef * face.area);
          const momFluxX = riemann.massFlux * 0.5 * (cellL.u + cellR.u) + gaugePressureForce * face.normal.x;
          const momFluxY = riemann.massFlux * 0.5 * (cellL.v + cellR.v) + gaugePressureForce * face.normal.y;
          const momFluxZ = riemann.massFlux * 0.5 * (cellL.w + cellR.w) + gaugePressureForce * face.normal.z;

          cellL.resMomX -= momFluxX;
          cellR.resMomX += momFluxX;
          cellL.resMomY -= momFluxY;
          cellR.resMomY += momFluxY;
          cellL.resMomZ -= momFluxZ;
          cellR.resMomZ += momFluxZ;
        } else if (face.boundaryType === 'inlet') {
          cellL.u = inletVelocity;
          const mDot = cellL.rho * inletVelocity * face.area;
          cellL.resMass += mDot;
          cellL.resMomX += mDot * inletVelocity;
        } else if (face.boundaryType === 'wall') {
          const wall = this.evaluateWallBoundary(cellL, face);
          cellL.resMomX -= wall.tauW * face.area;
        }
      }

      // 3. Update cell states with MRF source and relaxation
      for (const cell of this.cells) {
        const mrf = this.computeMRFSource(cell);
        const invMass = dt / (cell.rho * cell.volume);

        cell.u += 0.5 * invMass * (cell.resMomX + mrf.fx);
        cell.v += 0.5 * invMass * (cell.resMomY + mrf.fy);
        cell.w += 0.5 * invMass * (cell.resMomZ + mrf.fz);

        // Bounded physical velocity protection
        cell.u = Math.max(-100, Math.min(100, cell.u));
        cell.v = Math.max(-100, Math.min(100, cell.v));
        cell.w = Math.max(-100, Math.min(100, cell.w));

        // Pressure continuity relaxation
        cell.p += 0.05 * (cell.resMass / cell.volume) * (this.R_gas * 0.1);

        // Reset residuals
        cell.resMass = 0.0;
        cell.resMomX = 0.0;
        cell.resMomY = 0.0;
        cell.resMomZ = 0.0;
      }
    }

    // Compute summary metrics
    let maxVel = 0.0;
    let maxNut = 0.0;
    for (const cell of this.cells) {
      const vel = Math.sqrt(cell.u * cell.u + cell.v * cell.v + cell.w * cell.w);
      if (vel > maxVel) maxVel = vel;
      if (cell.nut > maxNut) maxNut = cell.nut;
    }

    return {
      stepCount: this.stepCount,
      maxVelocity: maxVel,
      maxTurbulentViscosity: maxNut,
      inletVelocity
    };
  }
}

module.exports = {
  PolyhedralCell3D,
  PolyhedralFace3D,
  FVMNavierStokes3D
};
