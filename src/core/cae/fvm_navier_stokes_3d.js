/**
 * OmniEng 3D Polyhedral Finite Volume Method (FVM) Navier-Stokes Solver
 * Implements 3D unstructured polyhedral cell discretization, Menter k-omega SST turbulence,
 * automatic wall treatment (y+ blending), HLLC/Roe compressible shock capturing, and MRF rotating frame.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */
'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const MAX_SUBSTEPS_PER_OUTER_STEP = 10000;

class PolyhedralCell3D {
  constructor(id, centroid, volume) {
    this.id = id;
    this.centroid = centroid; // { x, y, z }
    this.volume = volume; // m^3
    this.faceIndices = []; // Indices into mesh faces list

    // Primary flow state variables (cell-centered)
    this.u = 0.0; // x-velocity (m/s)
    this.v = 0.0; // y-velocity (m/s)
    this.w = 0.0; // z-velocity (m/s)
    this.p = 101325.0; // static pressure (Pa)
    this.rho = 1.225; // density (kg/m^3)
    this.T = 293.15; // temperature (K)

    // Turbulence fields (Menter k-omega SST)
    this.k = 1e-4; // turbulent kinetic energy (m^2/s^2)
    this.omega = 10.0; // specific dissipation rate (1/s)
    this.nut = 1e-6; // turbulent eddy viscosity (m^2/s)
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

    // Turbulence transport residual accumulators (k-omega SST)
    this.resK = 0.0;
    this.resOmega = 0.0;

    // Mesh bookkeeping (structured box grids)
    this.yWall = 0.0; // distance from cell centroid to the wall (m)
    this._dy = 0.0; // cell height (m)
    this._minEdge = 0.0; // smallest cell edge length (m)
    this._hasWallFace = false; // cell touches a wall face
    this._hasInletFace = false; // cell touches an inlet face

    // Scratch storage reused by the SST transport update
    this._pk = 0.0; // production of k (m^2/s^3)
    this._dk = 0.0; // dissipation of k (m^2/s^3)
    this._pOm = 0.0; // production of omega (1/s^2)
    this._dOm = 0.0; // dissipation of omega (1/s^2)
    this._cd = 0.0; // SST cross-diffusion term (1/s^2)
    this._f1 = 0.0; // SST F1 blending function
    this._sMag = 0.0; // mean strain-rate magnitude (1/s)
  }
}

class PolyhedralFace3D {
  constructor(id, centroid, area, normal, ownerId, neighborId = -1, boundaryType = null) {
    this.id = id;
    this.centroid = centroid; // { x, y, z }
    this.area = area; // m^2
    this.normal = normal; // unit normal vector pointing owner -> neighbor
    this.ownerId = ownerId; // Owner cell index
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
    this.gamma = options.gamma || 1.4; // Heat capacity ratio (air)
    this.R_gas = options.R_gas || 287.05; // Specific gas constant J/(kg*K)
    this.mu_lam = options.mu_lam || 1.81e-5; // Dynamic laminar viscosity (Pa*s)
    this.Pr_lam = options.Pr_lam || 0.72; // Laminar Prandtl number
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

    // SST gamma coefficients (Menter 1994): gamma = beta/beta* - sigma_w*kappa^2/sqrt(beta*)
    this.gamma1 = this.beta1 / this.beta_star - (this.sigma_w1 * this.kappa * this.kappa) / Math.sqrt(this.beta_star);
    this.gamma2 = this.beta2 / this.beta_star - (this.sigma_w2 * this.kappa * this.kappa) / Math.sqrt(this.beta_star);

    // Inlet turbulence specification
    this.turbulenceIntensity = options.turbulenceIntensity !== undefined ? options.turbulenceIntensity : 0.05;
    this.turbulentViscosityRatio = options.turbulentViscosityRatio !== undefined ? options.turbulentViscosityRatio : 10;
    this.kInlet = options.kInlet !== undefined ? options.kInlet : null;
    this.omegaInlet = options.omegaInlet !== undefined ? options.omegaInlet : null;

    // Explicit substep CFL basis: 'acoustic' (default, legacy) or 'convective'
    // (momentum/velocity-based, appropriate for low-Mach boundary layers).
    this.cflBasis = options.cflBasis === 'convective' ? 'convective' : 'acoustic';
    this.lastInletVelocity = 0.0;

    // Optional ramp length (m) for the wall-shear onset near the first wall
    // face (models a rounded/transitional leading edge; default 0 = full drag
    // from the first wall face).
    this.wallDragRampLength = options.wallDragRampLength !== undefined ? Number(options.wallDragRampLength) : 0;
    this._wallStartX = undefined;

    // Optional incompressible pressure-projection correction after each
    // explicit momentum substep (solids the low-Mach pressure-velocity
    // coupling on stretched boundary-layer grids). Off by default so the
    // legacy compressible pressure relaxation path is unchanged.
    this.projection = options.projection === true;

    // Local (pseudo-) time stepping for steady-state marching: when enabled,
    // each cell advances with its own CFL-based dt (convection + diffusion
    // limits) instead of one global dt equal to the tightest cell's limit.
    // This is the standard steady-RANS convergence accelerator: wall-adjacent
    // cells with tiny heights no longer throttle the whole domain. Default
    // off: the legacy global time-marching behavior is unchanged.
    this.localTimeStepping = options.localTimeStepping === true;

    // Steady-state line relaxation (wall-normal columns). When enabled inside
    // local time stepping, the wall-normal (y) momentum coupling of each
    // structured column is solved implicitly (tridiagonal Thomas) with
    // under-relaxation, while the streamwise coupling stays explicit. This is
    // a standard steady-RANS convergence accelerator; the discrete fixed
    // point is unchanged (the correction vanishes when the y-residuals
    // vanish).
    this.steadyLineRelax = options.steadyLineRelax === true;
    this.steadyLineRelaxUnderRelaxation =
      options.steadyLineRelaxUnderRelaxation !== undefined ? Number(options.steadyLineRelaxUnderRelaxation) : 0.7;
    this.steadyLineRelaxWallIncluded = options.steadyLineRelaxWallIncluded === true;

    // Steady-state implicit wall-normal (y) line relaxation. When enabled
    // inside local time stepping, after each explicit LTS sweep the
    // wall-normal momentum coupling of each structured column is relaxed
    // implicitly: a tridiagonal system for the y-diffusion operator (plus the
    // semi-implicit wall-law drag on the wall cell) is assembled per column
    // and solved with Thomas sweeps, and the correction is applied with
    // under-relaxation and a per-sweep limiter. The pseudo-time weight uses
    // the cell's diffusion-based rate (capped so the streamwise explicit
    // coupling stays within its convective CFL). This is the standard
    // line-implicit steady-RANS accelerator: it removes the near-wall cell's
    // tiny explicit pseudo-time step (acoustic-CFL throttled) from pacing the
    // boundary-layer equilibration and stabilizes the y-coupling. The
    // discrete fixed point is unchanged (the correction vanishes when the
    // residual vanishes). Intended for structured single-plane (nz = 1)
    // box grids, where wall-normal columns are well-defined.
    this.steadyImplicitWallRelax = options.steadyImplicitWallRelax === true;
    this.steadyImplicitWallRelaxOmega =
      options.steadyImplicitWallRelaxOmega !== undefined ? Number(options.steadyImplicitWallRelaxOmega) : 0.3;
    // Per-sweep limiter on the line-relaxation velocity correction (m/s):
    // standard pseudo-time correction limiting for a steady RANS accelerator;
    // the steady fixed point is unaffected (the correction vanishes when the
    // residual vanishes).
    this.steadyImplicitWallRelaxMaxCorrection =
      options.steadyImplicitWallRelaxMaxCorrection !== undefined
        ? Number(options.steadyImplicitWallRelaxMaxCorrection)
        : 5;

    // Velocity-correction under-relaxation used by the pressure projection
    // (fractional-step). Values below 1 make the correction safer on strongly
    // stretched meshes at the cost of a residual (documented) divergence
    // leftover per substep.
    this.projectionRelaxation =
      options.projectionRelaxation !== undefined ? Number(options.projectionRelaxation) : 0.85;

    // Maximum Jacobi sweeps for the pressure-correction Poisson solve.
    // The default (240) is the hardened legacy value; the sweep exits early
    // when the correction stops changing relative to the RHS scale.
    this.projectionIters = options.projectionIters !== undefined ? Number(options.projectionIters) : 240;

    // Optional wall-function velocity enforcement: when enabled, wall-adjacent
    // cells with y+ > 11 have their tangential velocity set to the log-law
    // value u+ = ln(E y+)/kappa (standard high-Re wall function), and the
    // separate wall-drag force is not applied (avoiding double counting).
    this.wallFunctionVelocityFixed = options.wallFunctionVelocityFixed === true;

    // Optional wall-law constant E: standard smooth wall is 9.8.
    // For meshes where first cell center lies in the outer boundary-layer
    // region, a wake-corrected effective constant accounts for the defect.
    this.wallLawConstant = options.wallLawConstant !== undefined ? Number(options.wallLawConstant) : 9.8;

    // Optional Coles boundary-layer wake-law correction (off by default).
    // When enabled, the equilibrium log-law u+ = ln(E y+)/kappa is augmented
    // with the Coles law-of-the-wake term (2 Pi/kappa) sin^2(pi y/(2 delta)):
    //   u+ = ln(E y+)/kappa + (2 Pi/kappa) sin^2(pi y/(2 delta))
    //      = ln(E_eff y+)/kappa,  E_eff = E exp(2 Pi sin^2(pi y/(2 delta)))
    // where delta is the 99%-freestream boundary-layer edge estimated from the
    // wall column velocity profile and y is the first-cell-center wall
    // distance. This accounts for the wake defect when the first cell center
    // lies in the outer part of the boundary layer. It is an OPTIONAL,
    // off-by-default option: with wallWakeLaw: false (default) the behavior
    // is byte-identical to the legacy pure log law.
    this.wallWakeLaw = options.wallWakeLaw === true;
    this.wakeParameterPi = options.wakeParameterPi !== undefined ? Number(options.wakeParameterPi) : 0.55;

    // Optional two-layer all-y+ wall model (off by default). When enabled,
    // evaluateWallBoundary solves the friction velocity from the single
    // continuous blended wall law (valid across the viscous sublayer, buffer
    // and log regions):
    //   u+ = (1/kappa) ln(1 + kappa y+) + 7.8 (1 - e^(-y+/11)
    //        - (y+/11) e^(-0.33 y+))
    // with the wall shear consistently computed from the blended u+ and the
    // cell-center tangential velocity, tau_w = rho u_tau^2 where
    // U_tan = u_tau u+(y+), y+ = y u_tau/nu. The blend is monotonic in y+,
    // reduces to u+ = y+ in the viscous limit and to the log law (with
    // effective additive constant ~9.8) at large y+. This replaces the legacy
    // regime-switching linear blend of viscous/log shear. When off, the
    // legacy wall law is byte-identical.
    this.twoLayerAllYPlus = options.twoLayerAllYPlus === true;

    // Optional outflow sponge zone: a Rayleigh-damping body force
    // a_sponge = -sigma(x) (u - U_ref) is applied approaching the outlet to
    // damp outlet-boundary artifacts (standard technique). The sponge starts at
    // lx - outflowSpongeLength and is inactive elsewhere. This does not alter
    // the flow upstream of the sponge zone.
    this.outflowSpongeLength = options.outflowSpongeLength !== undefined ? Number(options.outflowSpongeLength) : 0;
    this.outflowSpongeStrength =
      options.outflowSpongeStrength !== undefined ? Number(options.outflowSpongeStrength) : 300;
    this._lx = 0;

    // Moving Reference Frame (MRF) rotation vector (rad/s)
    this.omegaMRF = options.omegaMRF || { x: 0, y: 0, z: 0 };

    // Riemann flux solver: 'hllc', 'roe', or 'ausm_plus'
    this.fluxScheme = options.fluxScheme || 'hllc';

    this.cells = [];
    this.faces = [];
    this.stepCount = 0;

    // Per-substep wall-friction cache. The automatic wall-law solve is
    // transcendental and is the dominant per-substep cost; within one
    // substep the (u,v,w,rho,wallDistance) inputs are invariant, so the
    // solved friction state is reused by all consumers (SST closure, omega
    // wall value, momentum wall drag). The cache is keyed by a substep
    // token that step() increments per substep; calls outside step() (tests,
    // post-step reporting, token 0) always solve fresh, so a stale entry
    // can never be served.
    this._wallStepToken = 0;
    this._wallCache = null;
  }

  /**
   * Initializes a structured 3D hexahedral/polyhedral brick grid of dimensions (nx, ny, nz)
   *
   * Optional wallStretch (default 1.0): geometric-progression factor for the
   * y-spacing so near-wall cells are finer. With wallStretch == 1 the mesh is
   * the original uniform grid (identical to the legacy behavior). For
   * wallStretch > 1 the cell heights grow away from the wall:
   *   dy_1 = yMin, dy_i = yMin * wallStretch^(i-1)
   * (equivalently the face position y_j = ly * (wallStretch^j - 1) /
   * (wallStretch^ny - 1) with beta = wallStretch - 1), with yMin chosen so
   * the cell heights sum to ly. The first-cell-center y+ can be targeted over
   * roughly 1-60 by choosing wallStretch (larger wallStretch -> finer first
   * cell -> lower y+); consumers should verify y+ after construction, e.g.
   * with evaluateWallBoundary.
   */
  createBoxDomain(nx = 10, ny = 10, nz = 8, lx = 1.0, ly = 0.8, lz = 0.6, wallStretch = 1.0) {
    this.cells = [];
    this.faces = [];

    const dx = lx / nx;
    const dz = lz / nz;

    // Build the y-spacing (uniform by default, geometric when stretched).
    const yFace = new Array(ny + 1);
    const dyArr = new Array(ny);
    const stretch = Number(wallStretch) || 1.0;
    if (stretch <= 1.0 + 1e-12) {
      const dy = ly / ny;
      for (let iy = 0; iy <= ny; iy++) yFace[iy] = iy * dy;
      for (let iy = 0; iy < ny; iy++) dyArr[iy] = dy;
    } else {
      const s = stretch;
      let yMin = (ly * (s - 1.0)) / (Math.pow(s, ny) - 1.0);
      let sum = 0.0;
      for (let iy = 0; iy < ny; iy++) {
        dyArr[iy] = yMin * Math.pow(s, iy);
        sum += dyArr[iy];
      }
      const scale = ly / sum;
      for (let iy = 0; iy < ny; iy++) dyArr[iy] *= scale;
      yFace[0] = 0.0;
      for (let iy = 0; iy < ny; iy++) yFace[iy + 1] = yFace[iy] + dyArr[iy];
    }

    // 1. Create cells
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const id = this.cells.length;
          const centroid = {
            x: (ix + 0.5) * dx,
            y: 0.5 * (yFace[iy] + yFace[iy + 1]),
            z: (iz + 0.5) * dz
          };
          const cellVolume = dx * dyArr[iy] * dz;
          const cell = new PolyhedralCell3D(id, centroid, cellVolume);
          // Distance to the bottom wall (y = 0). The true centroid distance is
          // stored (with a tiny positivity floor) so wall-stretched meshes can
          // place the first cell center inside the viscous sublayer (y+ ~ 1);
          // consumers re-floor at their own safety limits (1e-6 m).
          cell.wallDistance = Math.max(1e-12, centroid.y);
          cell.yWall = centroid.y;
          cell._dy = dyArr[iy];
          cell._minEdge = Math.min(dx, dyArr[iy], dz);
          this.cells.push(cell);
        }
      }
    }

    const cellIndex = (ix, iy, iz) => iz * (nx * ny) + iy * nx + ix;

    // Store structured grid extents for neighbor access (pressure smoothing)
    this._nx = nx;
    this._ny = ny;
    this._nz = nz;
    this._lx = lx;
    this._ly = ly;
    this._dxCell = dx;

    // 2. Create internal and boundary faces
    // X-faces
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix <= nx; ix++) {
          const area = dyArr[iy] * dz;
          const normal = { x: 1, y: 0, z: 0 };
          const centroid = { x: ix * dx, y: 0.5 * (yFace[iy] + yFace[iy + 1]), z: (iz + 0.5) * dz };

          if (ix === 0) {
            // Inlet boundary
            const f = new PolyhedralFace3D(
              this.faces.length,
              centroid,
              area,
              normal,
              cellIndex(0, iy, iz),
              -1,
              'inlet'
            );
            this.faces.push(f);
          } else if (ix === nx) {
            // Outlet boundary
            const f = new PolyhedralFace3D(
              this.faces.length,
              centroid,
              area,
              normal,
              cellIndex(nx - 1, iy, iz),
              -1,
              'outlet'
            );
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
          const centroid = { x: (ix + 0.5) * dx, y: yFace[iy], z: (iz + 0.5) * dz };

          if (iy === 0) {
            // Wall boundary (bottom)
            const f = new PolyhedralFace3D(this.faces.length, centroid, area, normal, cellIndex(ix, 0, iz), -1, 'wall');
            this.faces.push(f);
          } else if (iy === ny) {
            // Top boundary (symmetry / free-stream)
            const f = new PolyhedralFace3D(
              this.faces.length,
              centroid,
              area,
              normal,
              cellIndex(ix, ny - 1, iz),
              -1,
              'symmetry'
            );
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

    // Connect faces to cells and record wall/inlet adjacency
    for (const face of this.faces) {
      const owner = this.cells[face.ownerId];
      owner.faceIndices.push(face.id);
      if (face.neighborId >= 0) {
        this.cells[face.neighborId].faceIndices.push(face.id);
      }
      if (face.boundaryType === 'wall') {
        owner._hasWallFace = true;
      } else if (face.boundaryType === 'inlet') {
        owner._hasInletFace = true;
      }
    }

    // Structured wall-normal (y) face lookup used by the implicit line
    // relaxation: for each cell, the id of the internal y-face immediately
    // below it (or -1). Internal y-faces have owner = cell below, neighbor =
    // cell above, so the face abutting a cell from below is recorded on the
    // neighbor entry; the y-face above a cell is the entry of the cell one
    // row up (id + nx in the same column).
    this._yFaceBelow = new Int32Array(this.cells.length);
    this._yFaceBelow.fill(-1);
    for (const face of this.faces) {
      if (face.neighborId >= 0 && face.normal.y !== 0) {
        this._yFaceBelow[face.neighborId] = face.id;
      }
    }

    // Precompute face geometry used by the hot loops (gradients, fluxes,
    // diffusion estimates): area-weighted normal components and the centroid
    // distance between the two cells of an internal face. These are pure
    // memoizations of values the loops recomputed every substep; results are
    // bit-identical.
    for (const face of this.faces) {
      face.aAx = face.area * face.normal.x;
      face.aAy = face.area * face.normal.y;
      face.aAz = face.area * face.normal.z;
      if (face.neighborId >= 0) {
        const owner = this.cells[face.ownerId];
        const neighbor = this.cells[face.neighborId];
        face.dist =
          Math.hypot(
            neighbor.centroid.x - owner.centroid.x,
            neighbor.centroid.y - owner.centroid.y,
            neighbor.centroid.z - owner.centroid.z
          ) || 1e-6;
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
    const delta_f = gradC.x * r_fC.x + gradC.y * r_fC.y + gradC.z * r_fC.z;
    const delta_max = phiN - phiC;

    if (Math.abs(delta_f) < 1e-12) return 1.0;
    const num = delta_max * delta_max + epsSq + 2.0 * delta_max * delta_f;
    const den = delta_max * delta_max + 2.0 * delta_f * delta_f + delta_max * delta_f + epsSq;
    return Math.min(1.0, Math.max(0.0, num / den));
  }

  /**
   * Tangential speed at a wall-adjacent cell. For structured wall cells, use
   * the cell's wall-face normal so normal velocity does not contribute to wall
   * shear. Cells without face metadata retain the scalar-speed fallback.
   */
  _wallTangentialSpeed(cell, face = null) {
    let wallFace = face;
    if (!wallFace && Array.isArray(cell.faceIndices)) {
      wallFace = cell.faceIndices
        .map((faceIndex) => this.faces[faceIndex])
        .find((candidate) => candidate?.boundaryType === 'wall' && candidate.ownerId === cell.id);
    }
    const speed = Math.hypot(cell.u, cell.v, cell.w);
    if (!wallFace?.normal) return speed;

    const normal = wallFace.normal;
    const normalLength = Math.hypot(normal.x, normal.y, normal.z);
    if (!Number.isFinite(normalLength) || normalLength <= 0) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM wall treatment received an invalid face normal', {
        cellId: cell.id,
        faceId: wallFace.id,
        normal: [normal.x, normal.y, normal.z]
      });
    }
    const nx = normal.x / normalLength;
    const ny = normal.y / normalLength;
    const nz = normal.z / normalLength;
    const normalVelocity = cell.u * nx + cell.v * ny + cell.w * nz;
    return Math.hypot(cell.u - normalVelocity * nx, cell.v - normalVelocity * ny, cell.w - normalVelocity * nz);
  }

  /**
   * Estimates the 99%-freestream boundary-layer edge delta for the wall column
   * containing `cell` on a structured box grid. The column is the set of cells
   * with the same (ix, iz) as the wall-adjacent cell; the edge y = delta is
   * found as the first row (interpolated between row centers) where the local
   * speed reaches 0.99 of the freestream reference speed (the inlet velocity
   * if known, otherwise the column maximum). Returns 0 when no structured
   * column metadata is available (fall back to the pure log law).
   */
  _boundaryLayerEdgeForColumn(cell) {
    const nx = this._nx;
    const ny = this._ny;
    const nz = this._nz;
    if (!Number.isSafeInteger(nx) || nx <= 0 || !Number.isSafeInteger(ny) || ny <= 0) {
      return 0;
    }
    const layerStride = nx * ny;
    const iz = Math.floor(cell.id / layerStride);
    const ix = cell.id % nx;
    if (iz < 0 || iz >= nz || ix < 0 || ix >= nx) return 0;

    let maxU = 0;
    for (let iy = 0; iy < ny; iy++) {
      const c = this.cells[iz * layerStride + iy * nx + ix];
      const u = Math.hypot(c.u, c.v, c.w);
      if (u > maxU) maxU = u;
    }
    const Uref = this.lastInletVelocity > 0 ? this.lastInletVelocity : maxU;
    if (!(Uref > 0)) return 0;
    const threshold = 0.99 * Uref;

    for (let iy = 0; iy < ny; iy++) {
      const c = this.cells[iz * layerStride + iy * nx + ix];
      const u = Math.hypot(c.u, c.v, c.w);
      if (u >= threshold) {
        if (iy === 0) return Math.max(1e-6, c.wallDistance);
        const cPrev = this.cells[iz * layerStride + (iy - 1) * nx + ix];
        const yPrev = Math.max(1e-6, cPrev.wallDistance);
        const uPrev = Math.hypot(cPrev.u, cPrev.v, cPrev.w);
        const yCur = Math.max(1e-6, c.wallDistance);
        if (u - uPrev < 1e-12) return yCur;
        const f = (threshold - uPrev) / (u - uPrev);
        return Math.max(1e-6, yPrev + f * (yCur - yPrev));
      }
    }
    return Math.max(1e-9, this._ly || 1e-6);
  }

  /**
   * Effective wall-law constant E_eff used by the wall friction model. Without
   * the optional Coles wake-law correction this is simply the configured
   * `wallLawConstant` (default 9.8). With `wallWakeLaw: true` it incorporates
   * the law-of-the-wake defect at the first cell center:
   *   E_eff = E exp(2 Pi sin^2(pi y/(2 delta)))
   * with delta the estimated boundary-layer edge. Physically standard ranges:
   * E in [9, 30], Pi in [0.3, 0.8].
   */
  _wallLawEffectiveConstant(cell) {
    const E = this.wallLawConstant || 9.8;
    if (!this.wallWakeLaw) return E;
    const piW = Number.isFinite(this.wakeParameterPi) ? this.wakeParameterPi : 0.55;
    if (piW <= 0) return E;
    const delta = this._boundaryLayerEdgeForColumn(cell);
    if (!(delta > 0)) return E;
    const y = Math.max(1e-9, cell.wallDistance);
    const eta = Math.min(1, y / delta);
    const wake = 2 * piW * Math.pow(Math.sin((Math.PI / 2) * eta), 2);
    const EEff = E * Math.exp(wake);
    if (!Number.isFinite(EEff) || EEff <= 0) return E;
    return EEff;
  }

  /**
   * Solves the automatic wall law for friction velocity using a self-consistent
   * y+ value. In the buffer region, bisection solves the existing linear blend
   * between viscous-sublayer and log-law shear; in the log region it satisfies
   * u+ = ln(E_eff y+)/kappa rather than reusing a y+ computed from a viscous
   * guess. E_eff is the wall-law constant (possibly wake-corrected via
   * `wallWakeLaw`).
   */
  _wallFrictionState(cell, face = null) {
    const rho = cell.rho;
    const wallDistance = cell.wallDistance;
    if (
      ![rho, wallDistance, cell.u, cell.v, cell.w, this.mu_lam, this.kappa].every(Number.isFinite) ||
      rho <= 0 ||
      wallDistance < 0 ||
      this.mu_lam <= 0 ||
      this.kappa <= 0
    ) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM wall treatment received an invalid flow state', {
        cellId: cell.id,
        densityKgM3: rho,
        wallDistanceM: wallDistance,
        velocityMPerS: [cell.u, cell.v, cell.w],
        laminarViscosityPaS: this.mu_lam,
        kappa: this.kappa
      });
    }

    const y = Math.max(1e-6, wallDistance);
    const nu = this.mu_lam / rho;
    const tangentialSpeed = this._wallTangentialSpeed(cell, face);
    if (!Number.isFinite(nu) || nu <= 0 || !Number.isFinite(tangentialSpeed)) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM wall treatment produced invalid kinematic inputs', {
        cellId: cell.id,
        kinematicViscosityM2PerS: nu,
        tangentialSpeedMPerS: tangentialSpeed
      });
    }
    if (tangentialSpeed === 0) {
      return { uTau: 0, yPlus: 0, tauW: 0, regime: 'viscous_sublayer' };
    }

    if (this.twoLayerAllYPlus) {
      return this._wallFrictionStateAllYPlus(cell, y, nu, tangentialSpeed);
    }

    const viscousTauPerDensity = (nu * tangentialSpeed) / y;
    const EEff = this._wallLawEffectiveConstant(cell);
    const wallLawTerms = (uTau) => {
      const yPlus = (y * uTau) / nu;
      if (yPlus <= 5.0) {
        return { yPlus, tauPerDensity: viscousTauPerDensity, derivativePerDensity: 0 };
      }

      const E = EEff || 9.8;
      const logDenominator = Math.log(E * yPlus);
      if (!Number.isFinite(logDenominator) || logDenominator <= 0) {
        return { yPlus, tauPerDensity: Infinity, derivativePerDensity: -Infinity };
      }
      const logTauPerDensity = Math.pow((this.kappa * tangentialSpeed) / logDenominator, 2);
      const logTauDerivativePerDensity = (-2.0 * logTauPerDensity) / (logDenominator * uTau);
      if (yPlus >= 30.0) {
        return {
          yPlus,
          tauPerDensity: logTauPerDensity,
          derivativePerDensity: logTauDerivativePerDensity
        };
      }

      const blend = (yPlus - 5.0) / 25.0;
      const blendDerivative = y / (25.0 * nu);
      return {
        yPlus,
        tauPerDensity: (1.0 - blend) * viscousTauPerDensity + blend * logTauPerDensity,
        derivativePerDensity:
          blendDerivative * (logTauPerDensity - viscousTauPerDensity) + blend * logTauDerivativePerDensity
      };
    };
    const residual = (uTau) => uTau * uTau - wallLawTerms(uTau).tauPerDensity;

    let lower = 0;
    let upper = Math.max(tangentialSpeed, Math.sqrt(viscousTauPerDensity));
    let upperResidual = residual(upper);
    for (let iteration = 0; upperResidual <= 0 && iteration < 64; iteration++) {
      upper *= 2;
      upperResidual = residual(upper);
    }
    if (!Number.isFinite(upperResidual) || upperResidual <= 0) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM wall-law friction velocity could not be bracketed', {
        cellId: cell.id,
        tangentialSpeedMPerS: tangentialSpeed,
        wallDistanceM: y,
        kinematicViscosityM2PerS: nu,
        upperVelocityMPerS: upper
      });
    }

    let uTau = Math.min(Math.sqrt(viscousTauPerDensity), upper);
    let converged = false;
    for (let iteration = 0; iteration < 24; iteration++) {
      const terms = wallLawTerms(uTau);
      const currentResidual = uTau * uTau - terms.tauPerDensity;
      const scale = Math.max(uTau * uTau, terms.tauPerDensity, Number.MIN_VALUE);
      if (Number.isFinite(currentResidual) && Math.abs(currentResidual) <= 1e-13 * scale) {
        converged = true;
        break;
      }

      if (currentResidual > 0) upper = uTau;
      else lower = uTau;

      const derivative = 2.0 * uTau - terms.derivativePerDensity;
      let next = uTau - currentResidual / derivative;
      if (!Number.isFinite(next) || next <= lower || next >= upper) next = 0.5 * (lower + upper);
      uTau = next;
    }
    if (!converged) {
      for (let iteration = 0; iteration < 40; iteration++) {
        const midpoint = 0.5 * (lower + upper);
        if (residual(midpoint) > 0) upper = midpoint;
        else lower = midpoint;
      }
      uTau = 0.5 * (lower + upper);
    }

    const { yPlus } = wallLawTerms(uTau);
    const tauW = rho * uTau * uTau;
    const regime = yPlus <= 5.0 ? 'viscous_sublayer' : yPlus <= 30.0 ? 'buffer_layer' : 'log_law';
    if (![uTau, yPlus, tauW].every(Number.isFinite) || uTau <= 0 || tauW < 0) {
      throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM wall-law solve produced an invalid friction state', {
        cellId: cell.id,
        frictionVelocityMPerS: uTau,
        yPlus,
        wallShearStressPa: tauW
      });
    }
    return { uTau, yPlus, tauW, regime };
  }

  /**
   * Two-layer all-y+ wall-law solve (option `twoLayerAllYPlus`). Solves the
   * friction velocity from the continuous blended wall law
   *   u+ = (1/kappa) ln(1 + kappa y+) + 7.8 (1 - e^(-y+/11)
   *        - (y+/11) e^(-0.33 y+))
   * with the self-consistent definition U_tan = u_tau u+(y+),
   * y+ = y u_tau/nu. The blend is strictly monotonic in y+ (its derivative is
   * positive for all y+ > 0), reduces to u+ = y+ for y+ -> 0 and approaches
   * the standard log law u+ = (1/kappa) ln(E y+), E ~ 9.8, for large y+, so
   * the root is unique and the solve is bounded. The wall shear is computed
   * consistently from the blended u+:
   *   tau_w = rho u_tau^2
   * and the linearized wall-drag coefficient used by the semi-implicit
   * momentum updates is the exact derivative
   *   d(tau_w)/dU = rho 2 u_tau / (u+ + y+ du+/dy+).
   * The root is found with a guarded Newton iteration inside a bisection
   * bracket (identical bracketing strategy to the legacy solve), so the
   * result is monotonic, finite and deterministic.
   */
  _wallFrictionStateAllYPlus(cell, y, nu, tangentialSpeed) {
    const rho = cell.rho;
    const kappa = this.kappa;
    const blendUPlus = (yp) => {
      const a = Math.exp(-yp / 11.0);
      const b = Math.exp(-0.33 * yp);
      return (1.0 / kappa) * Math.log(1.0 + kappa * yp) + 7.8 * (1.0 - a - (yp / 11.0) * b);
    };
    const blendUDeriv = (yp) => {
      const a = Math.exp(-yp / 11.0);
      const b = Math.exp(-0.33 * yp);
      return 1.0 / (1.0 + kappa * yp) + 7.8 * ((a - b) / 11.0 + 0.33 * (yp / 11.0) * b);
    };
    const residual = (uTau) => {
      const yp = (y * uTau) / nu;
      return uTau * blendUPlus(yp) - tangentialSpeed;
    };

    let lower = 0;
    let upper = Math.max(tangentialSpeed, Math.sqrt((nu * tangentialSpeed) / y));
    let upperResidual = residual(upper);
    for (let iteration = 0; upperResidual <= 0 && iteration < 64; iteration++) {
      upper *= 2;
      upperResidual = residual(upper);
    }
    if (!Number.isFinite(upperResidual) || upperResidual <= 0) {
      throw new OmniError(
        OmniErrorCode.NUMERICAL_FAILURE,
        'FVM all-y+ wall-law friction velocity could not be bracketed',
        {
          cellId: cell.id,
          tangentialSpeedMPerS: tangentialSpeed,
          wallDistanceM: y,
          kinematicViscosityM2PerS: nu,
          upperVelocityMPerS: upper
        }
      );
    }

    let uTau = Math.min(Math.sqrt((nu * tangentialSpeed) / y), upper);
    let converged = false;
    for (let iteration = 0; iteration < 30; iteration++) {
      const currentResidual = residual(uTau);
      const scale = Math.max(
        tangentialSpeed,
        uTau * Math.abs(uTau) > 0 ? uTau * blendUPlus((y * uTau) / nu) : 0,
        Number.MIN_VALUE
      );
      if (Number.isFinite(currentResidual) && Math.abs(currentResidual) <= 1e-12 * scale) {
        converged = true;
        break;
      }
      if (currentResidual > 0) upper = uTau;
      else lower = uTau;
      const yp = (y * uTau) / nu;
      const derivative = blendUPlus(yp) + uTau * blendUDeriv(yp) * (y / nu);
      let next = uTau - currentResidual / derivative;
      if (!Number.isFinite(next) || next <= lower || next >= upper) next = 0.5 * (lower + upper);
      uTau = next;
    }
    if (!converged) {
      for (let iteration = 0; iteration < 60; iteration++) {
        const midpoint = 0.5 * (lower + upper);
        if (residual(midpoint) > 0) upper = midpoint;
        else lower = midpoint;
      }
      uTau = 0.5 * (lower + upper);
    }

    const yPlus = (y * uTau) / nu;
    const tauW = rho * uTau * uTau;
    const uPlus = blendUPlus(yPlus);
    const dTauDu = (rho * 2.0 * uTau) / (uPlus + yPlus * blendUDeriv(yPlus));
    const regime = yPlus <= 5.0 ? 'viscous_sublayer' : yPlus <= 30.0 ? 'buffer_layer' : 'log_law';
    if (![uTau, yPlus, tauW, dTauDu].every(Number.isFinite) || uTau <= 0 || tauW < 0 || !(dTauDu > 0)) {
      throw new OmniError(
        OmniErrorCode.NUMERICAL_FAILURE,
        'FVM all-y+ wall-law solve produced an invalid friction state',
        {
          cellId: cell.id,
          frictionVelocityMPerS: uTau,
          yPlus,
          wallShearStressPa: tauW,
          linearizedDragCoefficient: dTauDu
        }
      );
    }
    return { uTau, yPlus, tauW, regime, dTauDu };
  }

  /**
   * Wall-friction state with per-substep caching. When step() has armed the
   * cache (this._wallCacheActive), the first solve per wall cell within the
   * substep is reused by all subsequent consumers; otherwise a fresh solve is
   * performed (identical to the uncached behavior).
   */
  _wallFrictionCached(cell, face = null) {
    const token = this._wallStepToken;
    if (token === 0 || !this._wallCache) {
      return this._wallFrictionState(cell, face);
    }
    const entry = this._wallCache.get(cell.id);
    if (entry && entry.token === token) {
      return entry.state;
    }
    const state = this._wallFrictionState(cell, face);
    this._wallCache.set(cell.id, { token, state });
    return state;
  }

  estimateUTau(cell) {
    return this._wallFrictionCached(cell).uTau;
  }

  /**
   * Wall value of the specific dissipation rate for the SST model (automatic
   * wall treatment):
   *   - viscous sublayer (y+ <= 11): omega_wall = 60 nu / (beta1 y1^2)
   *     (Menter 1994 low-Re formulation)
   *   - log layer (y+ > 11): omega_wall = u_tau / (sqrt(beta*) kappa y1)
   *     (standard high-Re wall-function formulation)
   * with y1 the wall distance of the first cell center.
   */
  wallOmega(cell) {
    const y = Math.max(1e-6, cell.wallDistance);
    const nu = this.mu_lam / Math.max(1e-9, cell.rho);
    const uTau = this.estimateUTau(cell);
    const yPlus = (y * uTau) / nu;
    if (yPlus <= 11.0) {
      return (60.0 * nu) / (this.beta1 * y * y);
    }
    return uTau / (Math.sqrt(this.beta_star) * this.kappa * y);
  }

  /**
   * Inlet turbulent kinetic energy k_inlet = 1.5 * (I * U)^2 (unless kInlet
   * is explicitly provided).
   */
  getKInlet() {
    if (this.kInlet !== null) return this.kInlet;
    const U = this.lastInletVelocity || 15.0;
    return 1.5 * Math.pow(this.turbulenceIntensity * U, 2);
  }

  /**
   * Inlet specific dissipation rate omega_inlet = k_inlet / nu_t with
   * nu_t = turbulentViscosityRatio * nu (unless omegaInlet is explicitly
   * provided).
   */
  getOmegaInlet() {
    if (this.omegaInlet !== null) return this.omegaInlet;
    const kIn = this.getKInlet();
    const nu = this.mu_lam / 1.225;
    return kIn / (this.turbulentViscosityRatio * nu);
  }

  /**
   * Computes Green-Gauss gradients of u, v, w, k and omega.
   *
   * For an internal face: phi_face = 0.5*(phiL + phiR). For boundary faces a
   * zero-gradient ghost is used, except on walls where k_face = 0 and
   * omega_face = omega_wall (the low-Re Dirichlet wall treatment, so the wall
   * value participates in the wall-adjacent cell gradient).
   */
  computeGradients() {
    const cells = this.cells;
    const faces = this.faces;

    for (const c of cells) {
      c.gradU.x = 0;
      c.gradU.y = 0;
      c.gradU.z = 0;
      c.gradV.x = 0;
      c.gradV.y = 0;
      c.gradV.z = 0;
      c.gradW.x = 0;
      c.gradW.y = 0;
      c.gradW.z = 0;
      c.gradK.x = 0;
      c.gradK.y = 0;
      c.gradK.z = 0;
      c.gradOmega.x = 0;
      c.gradOmega.y = 0;
      c.gradOmega.z = 0;
    }

    for (const f of faces) {
      const o = cells[f.ownerId];
      const ax = f.aAx;
      const ay = f.aAy;
      const az = f.aAz;

      if (f.neighborId >= 0) {
        const n = cells[f.neighborId];
        const uf = 0.5 * (o.u + n.u);
        const vf = 0.5 * (o.v + n.v);
        const wf = 0.5 * (o.w + n.w);
        const kf = 0.5 * (o.k + n.k);
        const of_ = 0.5 * (o.omega + n.omega);

        const gx = uf * ax;
        const gy = uf * ay;
        const gz = uf * az;
        o.gradU.x += gx;
        o.gradU.y += gy;
        o.gradU.z += gz;
        n.gradU.x -= gx;
        n.gradU.y -= gy;
        n.gradU.z -= gz;

        const vx = vf * ax;
        const vy = vf * ay;
        const vz = vf * az;
        o.gradV.x += vx;
        o.gradV.y += vy;
        o.gradV.z += vz;
        n.gradV.x -= vx;
        n.gradV.y -= vy;
        n.gradV.z -= vz;

        const wx = wf * ax;
        const wy = wf * ay;
        const wz = wf * az;
        o.gradW.x += wx;
        o.gradW.y += wy;
        o.gradW.z += wz;
        n.gradW.x -= wx;
        n.gradW.y -= wy;
        n.gradW.z -= wz;

        const kx = kf * ax;
        const ky = kf * ay;
        const kz = kf * az;
        o.gradK.x += kx;
        o.gradK.y += ky;
        o.gradK.z += kz;
        n.gradK.x -= kx;
        n.gradK.y -= ky;
        n.gradK.z -= kz;

        const ox = of_ * ax;
        const oy = of_ * ay;
        const oz = of_ * az;
        o.gradOmega.x += ox;
        o.gradOmega.y += oy;
        o.gradOmega.z += oz;
        n.gradOmega.x -= ox;
        n.gradOmega.y -= oy;
        n.gradOmega.z -= oz;
      } else {
        // Boundary face. Zero-gradient ghost except walls (Dirichlet k=0,
        // omega=omega_wall) so gradients near the wall feel the wall BCs.
        let kf = o.k;
        let of_ = o.omega;
        if (f.boundaryType === 'wall') {
          kf = 0;
          of_ = this.wallOmega(o);
        }
        const uf = o.u;
        const vf = o.v;
        const wf = o.w;
        o.gradU.x += uf * ax;
        o.gradU.y += uf * ay;
        o.gradU.z += uf * az;
        o.gradV.x += vf * ax;
        o.gradV.y += vf * ay;
        o.gradV.z += vf * az;
        o.gradW.x += wf * ax;
        o.gradW.y += wf * ay;
        o.gradW.z += wf * az;
        o.gradK.x += kf * ax;
        o.gradK.y += kf * ay;
        o.gradK.z += kf * az;
        o.gradOmega.x += of_ * ax;
        o.gradOmega.y += of_ * ay;
        o.gradOmega.z += of_ * az;
      }
    }

    for (const c of cells) {
      const invV = 1.0 / Math.max(1e-12, c.volume);
      c.gradU.x *= invV;
      c.gradU.y *= invV;
      c.gradU.z *= invV;
      c.gradV.x *= invV;
      c.gradV.y *= invV;
      c.gradV.z *= invV;
      c.gradW.x *= invV;
      c.gradW.y *= invV;
      c.gradW.z *= invV;
      c.gradK.x *= invV;
      c.gradK.y *= invV;
      c.gradK.z *= invV;
      c.gradOmega.x *= invV;
      c.gradOmega.y *= invV;
      c.gradOmega.z *= invV;
    }
  }

  /**
   * Advances the Menter (1994) k-omega SST turbulence transport equations by
   * one explicit substep of size dt (the same dt used for momentum).
   *
   * Transport equations (kinematic form, incompressible limit):
   *   dk/dt + div(u k) = div((nu + sigma_k nu_t) grad k) + P_k - D_k
   *   dome/dt + div(u omega) = div((nu + sigma_w nu_t) grad omega)
   *                       + P_omega - D_omega + CD_kw
   * with
   *   P_k = nu_t * 2 S_ij S_ij, limited to 10 * D_k (standard limiter)
   *   D_k = beta* k omega
   *   P_omega = gamma * 2 S_ij S_ij
   *   D_omega = beta omega^2
   *   CD_kw = 2 (1 - F1) sigma_w2 (1/omega) grad k . grad omega
   *   F1/F2 blended from the real wall distance, k, omega and nu.
   * Convection is upwind from the face-normal velocity; diffusion is a
   * central-difference flux of (nu + sigma nu_t) grad phi across each face.
   *
   * Wall treatment (documented): on wall faces k is set to zero (Dirichlet,
   * standard low-Re k wall BC) and omega is set to omega_wall via the automatic
   * wall treatment (60nu/(beta1 y1^2) in the viscous sublayer, u_tau/(sqrt(beta*)
   * kappa y1) in the log layer). The wall-adjacent omega is bounded below by
   * omega_wall after each update, and k is left to the zero-Dirichlet diffusive
   * flux (zero-flux at other boundaries). Non-finite or non-positive turbulence
   * states fail with a typed numerical error and are never replaced by a floor.
   *
   * For backward compatibility, calling without dt performs a reference step
   * with dt = 1e-4.
   */
  prepareSSTTurbulence() {
    const cells = this.cells;
    for (const c of cells) {
      if (
        ![c.u, c.v, c.w, c.p, c.rho, c.k, c.omega, c.nut, c.volume].every(Number.isFinite) ||
        c.rho <= 0 ||
        c.k <= 0 ||
        c.omega <= 0 ||
        c.volume <= 0
      ) {
        throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM SST closure received an invalid cell state', {
          cellId: c.id,
          velocity: [c.u, c.v, c.w],
          pressurePa: c.p,
          densityKgM3: c.rho,
          turbulentKineticEnergyM2PerS2: c.k,
          specificDissipationRatePerS: c.omega
        });
      }
    }
    this.computeGradients();

    // Pass 1: closure (F1/F2, nu_t), production/dissipation sources.
    for (const c of cells) {
      const nu = this.mu_lam / c.rho;
      const y = Math.max(1e-6, c.wallDistance);
      const k = c.k;
      const om = c.omega;

      // Strain-rate magnitude from the actual velocity gradients.
      const Sxx = c.gradU.x;
      const Syy = c.gradV.y;
      const Szz = c.gradW.z;
      const Sxy = 0.5 * (c.gradU.y + c.gradV.x);
      const Sxz = 0.5 * (c.gradU.z + c.gradW.x);
      const Syz = 0.5 * (c.gradV.z + c.gradW.y);
      const sMag2 = 2.0 * (Sxx * Sxx + Syy * Syy + Szz * Szz) + 4.0 * (Sxy * Sxy + Sxz * Sxz + Syz * Syz);
      const sMag = Math.sqrt(sMag2);

      const dotGrad = c.gradK.x * c.gradOmega.x + c.gradK.y * c.gradOmega.y + c.gradK.z * c.gradOmega.z;
      const cdKw = Math.max(2.0 * this.sigma_w2 * (1.0 / om) * dotGrad, 1e-10);

      const term1 = Math.sqrt(k) / (this.beta_star * om * y);
      const term2 = (500.0 * nu) / (y * y * om);
      const arg1 = Math.min(Math.max(term1, term2), (4.0 * this.sigma_w2 * k) / (cdKw * y * y));
      const F1 = Math.tanh(Math.pow(arg1, 4));
      const arg2 = Math.max(2.0 * term1, term2);
      const F2 = Math.tanh(Math.pow(arg2, 2));

      const denom = Math.max(this.a1 * om, sMag * F2);
      let nut = (this.a1 * k) / (denom || 1e-6);
      // High-Re wall function: in the wall-adjacent cell with its center
      // outside the viscous sublayer, the eddy viscosity is pinned to the
      // equilibrium log-layer value nu_t = kappa * u_tau * y (standard wall
      // function for momentum; ensures the wall shear and the first-cell
      // velocity are consistent with the log law).
      if (c._hasWallFace) {
        const uTau = this.estimateUTau(c);
        if ((y * uTau) / nu > 11.0) {
          nut = this.kappa * uTau * y;
        }
      }
      c.nut = Math.min(1.0, nut);
      if (![c.nut, sMag, F1, F2].every(Number.isFinite) || c.nut < 0) {
        throw new OmniError(
          OmniErrorCode.NUMERICAL_FAILURE,
          'FVM SST closure produced a non-finite or negative state',
          {
            cellId: c.id,
            turbulentViscosityM2PerS: c.nut,
            strainRatePerS: sMag,
            blendingF1: F1,
            blendingF2: F2
          }
        );
      }

      let pk = nut * sMag2;
      const dk = this.beta_star * k * om;
      if (pk > 10.0 * dk) pk = 10.0 * dk; // standard production limiter P_k <= 10 D_k

      const beta = F1 * this.beta1 + (1.0 - F1) * this.beta2;
      const gamma = F1 * this.gamma1 + (1.0 - F1) * this.gamma2;
      let pOm = gamma * sMag2;
      const dOm = beta * om * om;
      // Standard SST production limiter applied to the omega equation as well:
      // P_omega <= 10 D_omega. Without it, an over-shoot of the strain-rate
      // magnitude (e.g. in the developing wall layer) runs the explicit omega
      // update away to non-finite values.
      if (pOm > 10.0 * dOm) pOm = 10.0 * dOm;
      // SST cross-diffusion. In the explicit integration the negative part is
      // clipped (positivity-preserving treatment): unclipped, a negative CD
      // can collapse omega to its lower bound in the freestream, which drives
      // the eddy viscosity to nonphysical values.
      const cd = Math.max(2.0 * (1.0 - F1) * this.sigma_w2 * (1.0 / om) * dotGrad, 0.0);

      c._pk = pk;
      c._dk = dk;
      c._pOm = pOm;
      c._dOm = dOm;
      c._dOmLin = beta * om;
      c._cd = cd;
      c._f1 = F1;
      c._sMag = sMag;
      c.resK = 0;
      c.resOmega = 0;
    }
  }

  updateSSTTurbulence(dt = 1e-4, perCellDt = null, prepared = false) {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'FVM SST update requires a positive finite time step');
    }
    const cells = this.cells;
    if (!prepared) this.prepareSSTTurbulence();

    // Pass 2: face fluxes (upwind convection + central-difference diffusion).
    for (const f of this.faces) {
      const o = cells[f.ownerId];
      const nuO = this.mu_lam / Math.max(1e-9, o.rho);

      if (f.neighborId >= 0) {
        const n = cells[f.neighborId];
        const un =
          this.projection && this._projUn
            ? this._projUn[f.id]
            : 0.5 * ((o.u + n.u) * f.normal.x + (o.v + n.v) * f.normal.y + (o.w + n.w) * f.normal.z);
        let kUp, omUp;
        if (un >= 0) {
          kUp = o.k;
          omUp = o.omega;
        } else {
          kUp = n.k;
          omUp = n.omega;
        }
        // Kinematic transport form (incompressible limit): the k/omega
        // production, dissipation and diffusion terms are kinematic, so the
        // convective flux is un * phi * A (density is not carried).
        const convK = un * kUp * f.area;
        const convOm = un * omUp * f.area;

        const dist = f.dist || 1e-6;
        const f1Face = 0.5 * (o._f1 + n._f1);
        const sigmaK = f1Face * this.sigma_k1 + (1.0 - f1Face) * this.sigma_k2;
        const sigmaW = f1Face * this.sigma_w1 + (1.0 - f1Face) * this.sigma_w2;
        const nutFace = 0.5 * (o.nut + n.nut);
        const gammaK = nuO + sigmaK * nutFace;
        const gammaW = nuO + sigmaW * nutFace;
        const diffK = gammaK * ((n.k - o.k) / dist) * f.area;
        const diffOm = gammaW * ((n.omega - o.omega) / dist) * f.area;

        // F is the total flux leaving the owner through the face (convective
        // upwind + diffusive central difference), matching the momentum face
        // loop convention: res(owner) -= flux, res(neighbor) += flux.
        const fluxK = convK - diffK;
        const fluxOm = convOm - diffOm;
        o.resK -= fluxK;
        n.resK += fluxK;
        o.resOmega -= fluxOm;
        n.resOmega += fluxOm;
      } else if (f.boundaryType === 'inlet') {
        // Inlet: prescribed k/omega are advected into the domain (source).
        const kIn = this.getKInlet();
        const omIn = this.getOmegaInlet();
        const un = this.lastInletVelocity * f.normal.x;
        o.resK += un * kIn * f.area;
        o.resOmega += un * omIn * f.area;
      } else if (f.boundaryType === 'outlet') {
        // Outlet: outflow convection (owner loses k/omega), zero-gradient diffusion.
        const un = o.u * f.normal.x + o.v * f.normal.y + o.w * f.normal.z;
        o.resK -= un * o.k * f.area;
        o.resOmega -= un * o.omega * f.area;
      } else if (f.boundaryType === 'wall') {
        // Wall: convective flux (small) plus diffusive flux toward the wall
        // Dirichlet values (k_wall = 0, omega_wall = automatic wall treatment).
        const un = o.u * f.normal.x + o.v * f.normal.y + o.w * f.normal.z;
        const y = Math.max(1e-6, o.wallDistance);
        const omegaWall = this.wallOmega(o);
        const sigmaK = o._f1 * this.sigma_k1 + (1.0 - o._f1) * this.sigma_k2;
        const sigmaW = o._f1 * this.sigma_w1 + (1.0 - o._f1) * this.sigma_w2;
        const gammaK = nuO + sigmaK * o.nut;
        const gammaW = nuO + sigmaW * o.nut;
        const fluxK = un * o.k * f.area - gammaK * ((0 - o.k) / y) * f.area;
        const fluxOm = un * o.omega * f.area - gammaW * ((omegaWall - o.omega) / y) * f.area;
        o.resK -= fluxK;
        o.resOmega -= fluxOm;
      }
      // symmetry: zero-flux, nothing to add.
    }

    // Pass 3: update with the momentum substep dt.
    // The dissipation (sink) terms are integrated semi-implicitly (backward
    // Euler closed-form for the k/omega sinks), which is standard practice for
    // k-omega-type models and removes the explicit stiffness that otherwise
    // drives wall-adjacent k/omega to non-finite values.
    for (const c of cells) {
      // In local time-stepping mode each cell advances with its own dt
      // (perCellDt indexed by cell id); otherwise the single global dt is
      // used for every cell (legacy behavior).
      let dtc = perCellDt ? perCellDt[c.id] : dt;
      if (!Number.isFinite(dtc) || dtc <= 0) {
        throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM SST update received an invalid per-cell time step', {
          cellId: c.id,
          dtS: dtc
        });
      }
      if (perCellDt) {
        // Stability-preserving local time-step clamp for the explicit
        // k/omega sources and fluxes: the cell's turbulence step is reduced
        // so the explicit numerator changes k/omega by at most ~50% of their
        // current value in one step (standard explicit source/transport
        // stability; positivity follows). This only slows the pseudo-time
        // advancement of stiff turbulence states; it does not alter the
        // steady-state fixed point or the model constants.
        const kRate = c.resK / c.volume + c._pk;
        const omRate = c.resOmega / c.volume + c._pOm + c._cd;
        if (kRate < 0) dtc = Math.min(dtc, (0.5 * c.k) / -kRate);
        if (kRate > 0) dtc = Math.min(dtc, (0.5 * c.k) / kRate);
        if (omRate < 0) dtc = Math.min(dtc, (0.5 * c.omega) / -omRate);
        if (omRate > 0) dtc = Math.min(dtc, (0.5 * c.omega) / omRate);
        if (!Number.isFinite(dtc) || dtc <= 0) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'FVM SST update produced a non-positive stability-limited time step',
            { cellId: c.id, dtS: dtc }
          );
        }
      }
      const kOld = c.k;
      const omOld = c.omega;
      const kNum = kOld + dtc * (c.resK / c.volume + c._pk);
      const omNum = omOld + dtc * (c.resOmega / c.volume + c._pOm + c._cd);
      let kNew = kNum / (1.0 + dtc * (this.beta_star * omOld));
      // The omega sink D_omega = beta omega^2 is linearized in the implicit
      // factor about the old state: (1 + dt beta omega_old) omega_new. Using
      // the quadratic sink value itself in the denominator would
      // over-stabilize large omega (collapsing it to the floor) and
      // under-stabilize small omega.
      let omNew = omNum / (1.0 + dtc * c._dOmLin);
      if (!Number.isFinite(kNew) || !Number.isFinite(omNew)) {
        throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM SST update produced a non-finite turbulence state', {
          cellId: c.id,
          turbulentKineticEnergyM2PerS2: kNew,
          specificDissipationRatePerS: omNew
        });
      }
      if (c._hasWallFace) {
        // Automatic wall treatment: when the first cell center lies outside the
        // viscous sublayer (y+ > 11) the wall-adjacent k/omega are pinned to the
        // high-Re (log-layer) wall-function values, as is standard for wall
        // functions; otherwise the omega floor from the low-Re formula applies.
        const nu = this.mu_lam / Math.max(1e-9, c.rho);
        const uTau = this.estimateUTau(c);
        if ((c.wallDistance * uTau) / nu > 11.0) {
          kNew = (uTau * uTau) / Math.sqrt(this.beta_star);
          omNew = uTau / (Math.sqrt(this.beta_star) * this.kappa * c.wallDistance);
        } else {
          const w = this.wallOmega(c);
          if (omNew < w) omNew = w;
        }
      }
      if (!Number.isFinite(kNew) || !Number.isFinite(omNew) || kNew <= 0 || omNew <= 0) {
        throw new OmniError(
          OmniErrorCode.NUMERICAL_FAILURE,
          'FVM SST update produced a non-positive turbulence state',
          {
            cellId: c.id,
            turbulentKineticEnergyM2PerS2: kNew,
            specificDissipationRatePerS: omNew
          }
        );
      }
      c.k = kNew;
      c.omega = omNew;
      if (c._hasInletFace) {
        c.k = this.getKInlet();
        c.omega = this.getOmegaInlet();
        if (!Number.isFinite(c.k) || !Number.isFinite(c.omega) || c.k <= 0 || c.omega <= 0) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'FVM inlet turbulence inputs must be positive and finite', {
            cellId: c.id,
            kInlet: c.k,
            omegaInlet: c.omega
          });
        }
      }
      c.resK = 0;
      c.resOmega = 0;
    }
  }

  /**
   * Automatic wall treatment (viscous sublayer, buffer blend, and log law).
   */
  evaluateWallBoundary(cell, face) {
    return this._wallFrictionCached(cell, face);
  }

  /**
   * Inlined HLLC flux pair written into the scratch array `out`
   * (out[0] = massFlux * area, out[1] = pressureForce * area). This is the
   * exact arithmetic of solveHLLCRiemannFlux without the per-face result
   * object allocation, used by the hot step loops (legacy and local-time-
   * stepping). The public solveHLLCRiemannFlux remains for API use.
   */
  _hllcFluxScalar(cellL, cellR, nx, ny, nz, area, out) {
    const { gamma } = this;
    const unL = cellL.u * nx + cellL.v * ny + cellL.w * nz;
    const unR = cellR.u * nx + cellR.v * ny + cellR.w * nz;
    const aL = Math.sqrt((gamma * cellL.p) / cellL.rho);
    const aR = Math.sqrt((gamma * cellR.p) / cellR.rho);
    const SL = Math.min(unL - aL, unR - aR);
    const SR = Math.max(unL + aL, unR + aR);
    const num = cellR.p - cellL.p + cellL.rho * unL * (SL - unL) - cellR.rho * unR * (SR - unR);
    const den = cellL.rho * (SL - unL) - cellR.rho * (SR - unR);
    const SM = Math.abs(den) > 1e-9 ? num / den : 0.5 * (unL + unR);
    if (SL >= 0.0) {
      out[0] = cellL.rho * unL * area;
      out[1] = cellL.p * area;
    } else if (SR <= 0.0) {
      out[0] = cellR.rho * unR * area;
      out[1] = cellR.p * area;
    } else if (SM >= 0.0) {
      const rhoStarL = (cellL.rho * (SL - unL)) / (SL - SM);
      out[0] = rhoStarL * SM * area;
      out[1] = (cellL.p + cellL.rho * (SL - unL) * (SM - unL)) * area;
    } else {
      const rhoStarR = (cellR.rho * (SR - unR)) / (SR - SM);
      out[0] = rhoStarR * SM * area;
      out[1] = (cellR.p + cellR.rho * (SR - unR) * (SM - unR)) * area;
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
    const SM = Math.abs(den) > 1e-9 ? num / den : 0.5 * (unL + unR);

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
      const rhoStarL = (cellL.rho * (SL - unL)) / (SL - SM);
      massFlux = rhoStarL * SM;
      pFlux = cellL.p + cellL.rho * (SL - unL) * (SM - unL);
    } else {
      // Right star region
      const rhoStarR = (cellR.rho * (SR - unR)) / (SR - SM);
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
    const nx = normal.x,
      ny = normal.y,
      nz = normal.z;

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
    const dissPress =
      0.5 * (alpha1 * absL1 * (unRoe - aRoe) + alpha2 * absL2 * unRoe + alpha5 * absL5 * (unRoe + aRoe)) * rhoRoe;
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
    const nx = normal.x,
      ny = normal.y,
      nz = normal.z;

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
    const u = cell.u,
      v = cell.v,
      w = cell.w;

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
   * Fills `rateArr` with per-cell diffusion stability rates (sum of face
   * conductances divided by cell volume, 1/s). The face loop is identical to
   * the legacy estimateMaximumDiffusionRate scan (same checks, same sponge
   * factor, same diffusion model); only the output is per-cell instead of a
   * single maximum.
   */
  _fillDiffusionRates(rateArr) {
    for (const face of this.faces) {
      const owner = this.cells[face.ownerId];
      if (face.neighborId >= 0) {
        const neighbor = this.cells[face.neighborId];
        const distance = face.dist;
        if (!Number.isFinite(distance) || distance <= 0) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'FVM diffusion stability estimate found invalid face spacing',
            {
              faceId: face.id,
              distanceM: distance
            }
          );
        }
        const nutOwner = owner.nut;
        const nutNeighbor = neighbor.nut;
        if (![nutOwner, nutNeighbor].every(Number.isFinite) || nutOwner < 0 || nutNeighbor < 0) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'FVM diffusion stability estimate found invalid eddy viscosity',
            {
              faceId: face.id,
              ownerNutM2PerS: nutOwner,
              neighborNutM2PerS: nutNeighbor
            }
          );
        }

        let spongeFactor = 1.0;
        if (this.outflowSpongeLength > 0) {
          const xIn = face.centroid.x - (this._lx - this.outflowSpongeLength);
          if (xIn > 0) {
            const lam = Math.min(1.0, xIn / this.outflowSpongeLength);
            spongeFactor += this.outflowSpongeStrength * lam * lam;
          }
        }
        const effectiveMomentumViscosity = (this.mu_lam + owner.rho * nutOwner) * spongeFactor;
        const nuOwner = effectiveMomentumViscosity / owner.rho;
        const nuNeighbor = effectiveMomentumViscosity / neighbor.rho;
        const nuKOmega = Math.max(this.mu_lam / owner.rho, this.mu_lam / neighbor.rho) + 0.5 * (nutOwner + nutNeighbor);
        const upperBoundDiffusivity = Math.max(nuOwner, nuNeighbor, nuKOmega);
        const conductance = (upperBoundDiffusivity * face.area) / distance;
        rateArr[owner.id] += conductance / owner.volume;
        rateArr[neighbor.id] += conductance / neighbor.volume;
      } else if (face.boundaryType === 'wall') {
        if (!Number.isFinite(owner.nut) || owner.nut < 0) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'FVM wall diffusion estimate found invalid eddy viscosity',
            {
              cellId: owner.id,
              turbulentViscosityM2PerS: owner.nut
            }
          );
        }
        const distance = Math.max(1e-6, owner.wallDistance);
        const diffusivity = this.mu_lam / owner.rho + owner.nut;
        rateArr[owner.id] += (diffusivity * face.area) / (owner.volume * distance);
      }
    }
  }

  estimateMaximumDiffusionRate() {
    const cellRates = new Float64Array(this.cells.length);
    this._fillDiffusionRates(cellRates);
    let maxRate = 0;
    for (const rate of cellRates) {
      if (!Number.isFinite(rate) || rate < 0) {
        throw new OmniError(
          OmniErrorCode.NUMERICAL_FAILURE,
          'FVM diffusion stability estimate produced an invalid rate',
          {
            ratePerS: rate
          }
        );
      }
      if (rate > maxRate) maxRate = rate;
    }
    return maxRate;
  }

  /** Runs FVM iteration steps with pseudo-transient under-relaxation. */
  step(inletVelocity = 15.0, steps = 10, fluxScheme = this.fluxScheme) {
    if (!Number.isFinite(inletVelocity) || inletVelocity <= 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'FVM step requires a positive finite inlet velocity');
    }
    if (!Number.isSafeInteger(steps) || steps < 1) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'FVM step requires a positive integer iteration count');
    }
    if (this.cells.length === 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'FVM step requires an initialized mesh');
    }
    const pRef = 101325.0;
    const targetDt = 0.0005;
    this.lastInletVelocity = inletVelocity;

    if (this.localTimeStepping) {
      // Local (pseudo-) time stepping for steady-state marching: each of the
      // requested steps is one sweep in which every cell advances with its own
      // CFL-based dt (see _ltsSweep). When the incompressible pressure
      // projection is also enabled, the momentum/SST transport advance with
      // per-cell dt and one projection correction (using the characteristic
      // pseudo-time step) is applied per sweep, enforcing discrete continuity
      // on stretched low-Mach meshes. The legacy global time-marching loop
      // below is untouched when this option is off.
      for (let s = 0; s < steps; s++) {
        this.stepCount++;
        this._ltsSweep(inletVelocity, fluxScheme);
      }
    } else {
      for (let s = 0; s < steps; s++) {
        this.stepCount++;

        let elapsed = 0;
        let sub = 0;
        while (elapsed < targetDt) {
          if (sub >= MAX_SUBSTEPS_PER_OUTER_STEP) {
            throw new OmniError(
              OmniErrorCode.RESOURCE_EXHAUSTED,
              `FVM step exceeded ${MAX_SUBSTEPS_PER_OUTER_STEP} stable substeps`,
              { stepCount: this.stepCount, elapsedTimeS: elapsed, targetTimeStepS: targetDt }
            );
          }
          // Arm the per-substep wall-friction cache. Tangential velocity,
          // density and wall distance are invariant within a substep, so all
          // consumers (SST closure, omega wall value, momentum wall drag) share
          // one friction solve per wall cell.
          this._wallStepToken++;
          if (!this._wallCache) this._wallCache = new Map();
          this.prepareSSTTurbulence();
          let maxWaveSpeed = 1e-6;
          let minCellSize = Infinity;
          for (const cell of this.cells) {
            const speed = Math.hypot(cell.u, cell.v, cell.w);
            const waveSpeed =
              this.cflBasis === 'convective' ? speed : Math.sqrt((this.gamma * cell.p) / cell.rho) + speed;
            const cellSize = cell._minEdge || Math.cbrt(cell.volume);
            if (!Number.isFinite(waveSpeed) || waveSpeed <= 0 || !Number.isFinite(cellSize) || cellSize <= 0) {
              throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM CFL estimate received invalid cell state', {
                cellId: cell.id,
                waveSpeedMPerS: waveSpeed,
                cellSizeM: cellSize
              });
            }
            if (waveSpeed > maxWaveSpeed) maxWaveSpeed = waveSpeed;
            if (cellSize < minCellSize) minCellSize = cellSize;
          }
          // In projection mode the transport is carried by the stored
          // Rhie-Chow face velocities, which can transiently exceed the cell
          // velocities; the convective CFL must be based on the largest face
          // velocity magnitude or the explicit advection of momentum/scalars
          // violates its own stability limit.
          if (this.projection && this._projUn) {
            for (const face of this.faces) {
              if (face.neighborId < 0) continue;
              const w = Math.abs(this._projUn[face.id]);
              if (w > maxWaveSpeed) maxWaveSpeed = w;
            }
          }
          const cflDtConv = (0.5 * minCellSize) / maxWaveSpeed;
          const maxDiffusionRate = this.estimateMaximumDiffusionRate();
          const cflDtDiff = maxDiffusionRate > 0 ? 0.5 / maxDiffusionRate : Infinity;
          const dt = Math.min(targetDt - elapsed, cflDtConv, cflDtDiff);
          if (!Number.isFinite(dt) || dt <= 0) {
            throw new OmniError(
              OmniErrorCode.NUMERICAL_FAILURE,
              'FVM stability controls produced a non-positive substep',
              {
                stepCount: this.stepCount,
                dtS: dt,
                convectionLimitS: cflDtConv,
                diffusionLimitS: cflDtDiff
              }
            );
          }
          sub++;

          // 1. Update k-omega SST turbulence transport equations (explicit, dt)
          // (SST closure was already prepared above; passing prepared = true
          // avoids the redundant second gradient computation).
          this.updateSSTTurbulence(dt, null, true);

          // 2. Accumulate fluxes across all faces
          for (const face of this.faces) {
            const cellL = this.cells[face.ownerId];

            if (face.neighborId >= 0) {
              const cellR = this.cells[face.neighborId];
              let massFlux;
              let pressureForce;
              if (fluxScheme === 'roe') {
                const riemann = this.solveRoeRiemannFlux(cellL, cellR, face.normal, face.area);
                massFlux = riemann.massFlux;
                pressureForce = riemann.pressureForce;
              } else if (fluxScheme === 'ausm' || fluxScheme === 'ausm_plus') {
                const riemann = this.solveAUSMPlusFlux(cellL, cellR, face.normal, face.area);
                massFlux = riemann.massFlux;
                pressureForce = riemann.pressureForce;
              } else {
                if (!this._fluxScratch) this._fluxScratch = new Float64Array(2);
                this._hllcFluxScalar(
                  cellL,
                  cellR,
                  face.normal.x,
                  face.normal.y,
                  face.normal.z,
                  face.area,
                  this._fluxScratch
                );
                massFlux = this._fluxScratch[0];
                pressureForce = this._fluxScratch[1];
              }

              if (!this.projection) {
                cellL.resMass -= massFlux;
                cellR.resMass += massFlux;
              }

              // In projection mode the momentum predictor carries the current
              // cell-centered pressure gradient (interpolated face pressure), so
              // the projection correction phi is only the pressure INCREMENT
              // (small at stationarity) rather than the full pressure. This
              // keeps the near-wall velocity correction bounded on stretched
              // meshes (1/V amplification of the full-pressure correction was
              // the source of the projection-mode blowups).
              const gaugePressureForce = this.projection
                ? (0.5 * (cellL.p + cellR.p) - pRef) * face.area
                : pressureForce - pRef * face.area;
              // The convective mass flux uses the stored Rhie-Chow face velocity
              // when the projection is active, so the transported velocity field
              // is the continuity-satisfying one (the face flux carries the
              // projected flow; averaging cell velocities would reintroduce the
              // collocated inconsistency).
              const convectiveMassFlux =
                this.projection && this._projUn
                  ? 0.5 * (cellL.rho + cellR.rho) * this._projUn[face.id] * face.area
                  : massFlux;
              const momFluxX = convectiveMassFlux * 0.5 * (cellL.u + cellR.u) + gaugePressureForce * face.normal.x;
              const momFluxY = convectiveMassFlux * 0.5 * (cellL.v + cellR.v) + gaugePressureForce * face.normal.y;
              const momFluxZ = convectiveMassFlux * 0.5 * (cellL.w + cellR.w) + gaugePressureForce * face.normal.z;

              cellL.resMomX -= momFluxX;
              cellR.resMomX += momFluxX;
              cellL.resMomY -= momFluxY;
              cellR.resMomY += momFluxY;
              cellL.resMomZ -= momFluxZ;
              cellR.resMomZ += momFluxZ;

              // Viscous diffusion flux: F_visc = -mu * grad(u) . n * A,
              // approximated with central differences across the face. The
              // diffusive contribution to the owner residual mirrors the scalar
              // transport convention: the owner gains mu (u_N - u_P)/d A and the
              // neighbor loses it (momentum diffuses from fast to slow cells).
              const dist = face.dist || 1e-6;
              let muEff = this.mu_lam + cellL.rho * cellL.nut;
              if (this.outflowSpongeLength > 0) {
                const xIn = face.centroid.x - (this._lx - this.outflowSpongeLength);
                if (xIn > 0) {
                  const lam = Math.min(1.0, xIn / this.outflowSpongeLength);
                  muEff *= 1.0 + this.outflowSpongeStrength * lam * lam;
                }
              }
              const viscX = ((muEff * (cellR.u - cellL.u)) / dist) * face.area;
              const viscY = ((muEff * (cellR.v - cellL.v)) / dist) * face.area;
              const viscZ = ((muEff * (cellR.w - cellL.w)) / dist) * face.area;

              cellL.resMomX += viscX;
              cellR.resMomX -= viscX;
              cellL.resMomY += viscY;
              cellR.resMomY -= viscY;
              cellL.resMomZ += viscZ;
              cellR.resMomZ -= viscZ;
            } else if (face.boundaryType === 'inlet') {
              cellL.u = inletVelocity;
              const mDot = cellL.rho * inletVelocity * face.area;
              cellL.resMass += mDot;
              cellL.resMomX += mDot * inletVelocity;
            } else if (face.boundaryType === 'outlet') {
              // Pressure-outlet boundary: extrapolate cell velocity to the face,
              // prescribe back-pressure, and accumulate the convective mass/momentum flux.
              // Outflow leaves the owner cell, mirroring the interior owner-face convention.
              const pBack = Number.isFinite(face.bcPressure) ? face.bcPressure : 101325.0;
              const un = cellL.u * face.normal.x + cellL.v * face.normal.y + cellL.w * face.normal.z;
              const mDot = cellL.rho * un * face.area;
              const gaugePressureForce = (pBack - pRef) * face.area;
              cellL.resMass -= mDot;
              cellL.resMomX -= mDot * cellL.u + gaugePressureForce * face.normal.x;
              cellL.resMomY -= mDot * cellL.v + gaugePressureForce * face.normal.y;
              cellL.resMomZ -= mDot * cellL.w + gaugePressureForce * face.normal.z;
            } else if (face.boundaryType === 'wall') {
              // In projection mode the wall shear is applied semi-implicitly in
              // the cell update loop (see comment below) instead of as an
              // explicit force impulse; the explicit impulse on the thin
              // first cells of stretched meshes is not covered by the diffusion
              // CFL estimate and reverses the near-wall velocity each substep.
              if (!this.projection) {
                const wall = this.evaluateWallBoundary(cellL, face);
                let dragRamp = 1.0;
                if (this.wallDragRampLength > 0) {
                  if (this._wallStartX === undefined) {
                    let xMin = Infinity;
                    for (const wf of this.faces) {
                      if (wf.boundaryType === 'wall' && wf.centroid.x < xMin) xMin = wf.centroid.x;
                    }
                    this._wallStartX = xMin;
                  }
                  const xLocal = Math.max(0, face.centroid.x - this._wallStartX);
                  dragRamp = Math.min(1.0, xLocal / this.wallDragRampLength);
                }
                cellL.resMomX -= wall.tauW * face.area * dragRamp;
              }
            }
          }

          // 3. Update cell states with MRF source and relaxation
          for (const cell of this.cells) {
            const mrf = this.computeMRFSource(cell);
            const invMass = dt / (cell.rho * cell.volume);

            // Semi-implicit wall shear in projection mode: the explicit drag
            // impulse on the thin near-wall cells of stretched meshes (not
            // covered by the diffusion CFL estimate) is replaced by an implicit
            // factor 1/(1 + dt*C) applied to the tangential velocity, with C
            // the linearized wall-model friction derivative d(tau_w)/dU_t scaled
            // by A/(rho V). This keeps the near-wall update stable and physical.
            let denomTan = 1;
            let wallFaceForDrag = null;
            if (this.projection && cell._hasWallFace) {
              for (const fidx of cell.faceIndices) {
                const f = this.faces[fidx];
                if (f.boundaryType === 'wall' && f.ownerId === cell.id) {
                  wallFaceForDrag = f;
                  break;
                }
              }
              if (wallFaceForDrag) {
                let ramp = 1;
                if (this.wallDragRampLength > 0) {
                  if (this._wallStartX === undefined) {
                    let xMin = Infinity;
                    for (const wf of this.faces) {
                      if (wf.boundaryType === 'wall' && wf.centroid.x < xMin) xMin = wf.centroid.x;
                    }
                    this._wallStartX = xMin;
                  }
                  const xLocal = Math.max(0, wallFaceForDrag.centroid.x - this._wallStartX);
                  ramp = Math.min(1.0, xLocal / this.wallDragRampLength);
                }
                const wall = this.evaluateWallBoundary(cell, wallFaceForDrag);
                const yW = Math.max(1e-6, cell.wallDistance);
                const viscC = this.mu_lam / yW;
                let dTauDu;
                if (this.twoLayerAllYPlus && wall.dTauDu > 0) {
                  dTauDu = wall.dTauDu;
                } else if (wall.uTau > 0 && wall.yPlus > 5) {
                  const E = this._wallLawEffectiveConstant(cell) || 9.8;
                  const logArg = Math.log(E * wall.yPlus);
                  const logC = (2 * cell.rho * wall.uTau * this.kappa) / (logArg + 1);
                  const blend = Math.min(1, Math.max(0, (wall.yPlus - 5) / 25));
                  dTauDu = (1 - blend) * viscC + blend * logC;
                } else {
                  dTauDu = viscC;
                }
                const Cm = (dTauDu * wallFaceForDrag.area * ramp) / (cell.rho * cell.volume);
                denomTan = 1 + dt * Cm;
              }
            }

            let du = 0.5 * invMass * (cell.resMomX + mrf.fx);
            let dv = 0.5 * invMass * (cell.resMomY + mrf.fy);
            let dw = 0.5 * invMass * (cell.resMomZ + mrf.fz);
            if (denomTan !== 1 && wallFaceForDrag) {
              const nx = wallFaceForDrag.normal.x;
              const ny = wallFaceForDrag.normal.y;
              const nz = wallFaceForDrag.normal.z;
              const unOld = cell.u * nx + cell.v * ny + cell.w * nz;
              const utx = cell.u - unOld * nx;
              const uty = cell.v - unOld * ny;
              const utz = cell.w - unOld * nz;
              const unNew = unOld + (du * nx + dv * ny + dw * nz);
              const utxNew = (utx + du - (du * nx + dv * ny + dw * nz) * nx) / denomTan;
              const utyNew = (uty + dv - (du * nx + dv * ny + dw * nz) * ny) / denomTan;
              const utzNew = (utz + dw - (du * nx + dv * ny + dw * nz) * nz) / denomTan;
              du = utxNew - utx;
              dv = utyNew - uty;
              dw = utzNew - utz;
              const unCorr = unNew - unOld;
              du += unCorr * nx;
              dv += unCorr * ny;
              dw += unCorr * nz;
            }
            cell.u += du;
            cell.v += dv;
            cell.w += dw;

            // Pressure continuity relaxation (legacy compressible path); when the
            // incompressible projection is enabled the pressure correction is
            // handled by applyPressureProjection below instead. The fixed
            // increment is retained for backward compatibility; the collocated
            // explicit pressure-velocity coupling remains a known limitation for
            // stretched low-Mach boundary-layer meshes (recorded in the NASA TMR
            // benchmark diagnostics).
            if (!this.projection) {
              cell.p += 0.05 * (cell.resMass / cell.volume) * (this.R_gas * 0.1);
            }

            // Outflow sponge (Rayleigh damping toward the inflow velocity)
            if (this.outflowSpongeLength > 0) {
              const xIn = cell.centroid.x - (this._lx - this.outflowSpongeLength);
              if (xIn > 0) {
                const lam = Math.min(1.0, xIn / this.outflowSpongeLength);
                const sigma = this.outflowSpongeStrength * lam * lam;
                cell.u -= dt * sigma * (cell.u - inletVelocity);
                cell.v -= dt * sigma * cell.v;
                cell.w -= dt * sigma * cell.w;
              }
            }

            // Reset residuals
            cell.resMass = 0.0;
            cell.resMomX = 0.0;
            cell.resMomY = 0.0;
            cell.resMomZ = 0.0;
          }
          if (this.projection) {
            this.applyPressureProjection(dt, inletVelocity);
          }

          // Wall-function velocity enforcement: pin wall-adjacent cells (y+ > 11)
          // to the log-law velocity.
          if (this.wallFunctionVelocityFixed) {
            for (const face of this.faces) {
              if (face.boundaryType !== 'wall') continue;
              const cell = this.cells[face.ownerId];
              const wall = this.evaluateWallBoundary(cell, face);
              if (wall.yPlus <= 11.0) continue;
              const uTau = Math.sqrt(wall.tauW / Math.max(1e-9, cell.rho));
              const E = this._wallLawEffectiveConstant(cell) || 9.8;
              const uLog = (uTau / this.kappa) * Math.log(E * wall.yPlus);
              const mag = Math.hypot(cell.u, cell.v, cell.w);
              if (mag > 1e-12) {
                const f = uLog / mag;
                cell.u *= f;
                cell.v *= f;
                cell.w *= f;
              } else {
                cell.u = uLog;
              }
            }
          }

          for (const cell of this.cells) {
            if (
              ![cell.u, cell.v, cell.w, cell.p, cell.rho, cell.k, cell.omega, cell.nut].every(Number.isFinite) ||
              cell.p <= 0 ||
              cell.rho <= 0 ||
              cell.k <= 0 ||
              cell.omega <= 0 ||
              cell.nut < 0
            ) {
              throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM update produced an inadmissible cell state', {
                stepCount: this.stepCount,
                substep: sub,
                cellId: cell.id,
                velocityMPerS: [cell.u, cell.v, cell.w],
                pressurePa: cell.p,
                densityKgM3: cell.rho,
                turbulentKineticEnergyM2PerS2: cell.k,
                specificDissipationRatePerS: cell.omega,
                turbulentViscosityM2PerS: cell.nut
              });
            }
          }
          elapsed += dt;
        }
      }
    }

    // Disarm the wall-friction cache so any post-step call solves fresh.
    this._wallStepToken = 0;
    this._wallCache = null;

    // Compute summary metrics
    let maxVel = 0.0;
    let maxNut = 0.0;
    for (const cell of this.cells) {
      const vel = Math.sqrt(cell.u * cell.u + cell.v * cell.v + cell.w * cell.w);
      if (vel > maxVel) maxVel = vel;
      if (cell.nut > maxNut) maxNut = cell.nut;
    }

    let maxWallCf = 0.0;
    const rhoRef = 1.225;
    const uInfSq = inletVelocity * inletVelocity;
    for (const face of this.faces) {
      if (face.boundaryType !== 'wall') continue;
      const wall = this.evaluateWallBoundary(this.cells[face.ownerId], face);
      if (Number.isFinite(wall.tauW)) {
        const cf = (2.0 * wall.tauW) / (rhoRef * uInfSq);
        if (cf > maxWallCf) maxWallCf = cf;
      }
    }

    return {
      stepCount: this.stepCount,
      maxVelocity: maxVel,
      maxTurbulentViscosity: maxNut,
      inletVelocity,
      maxWallCf
    };
  }

  /**
   * Per-cell local time step for steady-state pseudo-time marching. Each cell
   * gets its own dt from its own convective CFL limit (0.5 * h / waveSpeed)
   * and its own diffusion CFL limit (0.5 / local diffusion rate). This is the
   * standard local (dual/pseudo) time-stepping accelerator: wall-adjacent
   * cells with tiny heights advance with tiny steps without throttling the
   * rest of the domain. Used only by the localTimeStepping path; the legacy
   * global-dt path is unchanged.
   */
  _computeLocalTimeSteps() {
    const cells = this.cells;
    const n = cells.length;
    const dtArr = new Float64Array(n);
    if (!this._diffusionRates || this._diffusionRates.length !== n) {
      this._diffusionRates = new Float64Array(n);
    }
    const rateArr = this._diffusionRates;
    rateArr.fill(0);
    this._fillDiffusionRates(rateArr);
    for (let i = 0; i < n; i++) {
      const cell = cells[i];
      const speed = Math.hypot(cell.u, cell.v, cell.w);
      const waveSpeed = this.cflBasis === 'convective' ? speed : Math.sqrt((this.gamma * cell.p) / cell.rho) + speed;
      const cellSize = cell._minEdge || Math.cbrt(cell.volume);
      if (!Number.isFinite(waveSpeed) || waveSpeed <= 0 || !Number.isFinite(cellSize) || cellSize <= 0) {
        throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM CFL estimate received invalid cell state', {
          cellId: cell.id,
          waveSpeedMPerS: waveSpeed,
          cellSizeM: cellSize
        });
      }
      const dtConv = (0.5 * cellSize) / waveSpeed;
      const rate = rateArr[i];
      const dtDiff = rate > 0 ? 0.5 / rate : Infinity;
      const dt = Math.min(dtConv, dtDiff);
      if (!Number.isFinite(dt) || dt <= 0) {
        throw new OmniError(
          OmniErrorCode.NUMERICAL_FAILURE,
          'FVM stability controls produced a non-positive local substep',
          { cellId: cell.id, dtS: dt, convectionLimitS: dtConv, diffusionLimitS: dtDiff }
        );
      }
      dtArr[i] = dt;
    }
    return dtArr;
  }

  /**
   * One local-time-stepping sweep (steady-state pseudo-time iteration). The
   * sweep mirrors one substep of the legacy explicit path in step(), with the
   * single global dt replaced by the per-cell local dt array (convection +
   * diffusion CFL). Transport (momentum, SST, MRF, sponge, wall drag) uses
   * each cell's own dt, so wall-adjacent cells with tiny heights no longer
   * throttle the whole domain.
   *
   * Two pressure-coupling modes are supported:
   *   - compressible relaxation (projection off): the legacy residual-
   *     proportional pressure update, scaled by the cell's own pseudo-time
   *     step relative to the far-field reference dt (the steady-state fixed
   *     point is unchanged; near-wall cells relax pressure at their own pace);
   *   - incompressible projection (projection on): after the momentum/SST
   *     advance, one pressure-correction solve (applyPressureProjection) is
   *     performed with the characteristic pseudo-time step dtRef, enforcing
   *     discrete continuity on stretched low-Mach meshes.
   */
  _ltsSweep(inletVelocity, fluxScheme) {
    const pRef = 101325.0;
    const projection = this.projection;
    this._wallStepToken++;
    if (!this._wallCache) this._wallCache = new Map();
    if (this.steadyLineRelax) {
      const nCells = this.cells.length;
      if (!this._ltsRyU || this._ltsRyU.length !== nCells) {
        this._ltsRyU = new Float64Array(nCells);
        this._ltsRyW = new Float64Array(nCells);
      }
      this._ltsRyU.fill(0);
      this._ltsRyW.fill(0);
    }
    if (this.steadyImplicitWallRelax) {
      const nCells = this.cells.length;
      if (!this._sirRx || this._sirRx.length !== nCells) {
        this._sirRx = new Float64Array(nCells);
        this._sirRy = new Float64Array(nCells);
      }
    }

    // 1. SST closure (gradients, F1/F2, eddy viscosity).
    this.prepareSSTTurbulence();

    // 2. Per-cell local time step.
    const dtArr = this._computeLocalTimeSteps();

    // 3. Turbulence transport with per-cell dt.
    this.updateSSTTurbulence(1.0, dtArr, true);

    // Characteristic pseudo-time step for the compressible pressure
    // relaxation: the largest local dt (far-field representative). Near-wall
    // cells (small dt) relax pressure at their own local pace. In projection
    // mode the pressure correction is solved by applyLocalPressureProjection
    // with the per-cell weights (no global step is needed).
    let dtRef = 0;
    for (let i = 0; i < dtArr.length; i++) {
      if (dtArr[i] > dtRef) dtRef = dtArr[i];
    }
    if (!Number.isFinite(dtRef) || dtRef <= 0) {
      throw new OmniError(
        OmniErrorCode.NUMERICAL_FAILURE,
        'FVM local time stepping produced an invalid reference time step'
      );
    }

    // 4. Accumulate momentum fluxes across all faces. In projection mode the
    // transport is carried by the stored Rhie-Chow face velocities and the
    // momentum predictor uses the interpolated cell-centered pressure
    // gradient; the projection correction phi is only the pressure increment.
    for (const face of this.faces) {
      const cellL = this.cells[face.ownerId];

      if (face.neighborId >= 0) {
        const cellR = this.cells[face.neighborId];
        let massFlux;
        let pressureForce;
        if (fluxScheme === 'roe') {
          const riemann = this.solveRoeRiemannFlux(cellL, cellR, face.normal, face.area);
          massFlux = riemann.massFlux;
          pressureForce = riemann.pressureForce;
        } else if (fluxScheme === 'ausm' || fluxScheme === 'ausm_plus') {
          const riemann = this.solveAUSMPlusFlux(cellL, cellR, face.normal, face.area);
          massFlux = riemann.massFlux;
          pressureForce = riemann.pressureForce;
        } else {
          if (!this._fluxScratch) this._fluxScratch = new Float64Array(2);
          this._hllcFluxScalar(cellL, cellR, face.normal.x, face.normal.y, face.normal.z, face.area, this._fluxScratch);
          massFlux = this._fluxScratch[0];
          pressureForce = this._fluxScratch[1];
        }
        if (!projection) {
          cellL.resMass -= massFlux;
          cellR.resMass += massFlux;
        }

        const gaugePressureForce = projection
          ? (0.5 * (cellL.p + cellR.p) - pRef) * face.area
          : pressureForce - pRef * face.area;
        const convectiveMassFlux =
          projection && this._projUn ? 0.5 * (cellL.rho + cellR.rho) * this._projUn[face.id] * face.area : massFlux;
        const momFluxX = convectiveMassFlux * 0.5 * (cellL.u + cellR.u) + gaugePressureForce * face.normal.x;
        const momFluxY = convectiveMassFlux * 0.5 * (cellL.v + cellR.v) + gaugePressureForce * face.normal.y;
        const momFluxZ = convectiveMassFlux * 0.5 * (cellL.w + cellR.w) + gaugePressureForce * face.normal.z;

        cellL.resMomX -= momFluxX;
        cellR.resMomX += momFluxX;
        cellL.resMomY -= momFluxY;
        cellR.resMomY += momFluxY;
        cellL.resMomZ -= momFluxZ;
        cellR.resMomZ += momFluxZ;

        const dist = face.dist || 1e-6;
        let muEff = this.mu_lam + cellL.rho * cellL.nut;
        if (this.outflowSpongeLength > 0) {
          const xIn = face.centroid.x - (this._lx - this.outflowSpongeLength);
          if (xIn > 0) {
            const lam = Math.min(1.0, xIn / this.outflowSpongeLength);
            muEff *= 1.0 + this.outflowSpongeStrength * lam * lam;
          }
        }
        const viscX = ((muEff * (cellR.u - cellL.u)) / dist) * face.area;
        const viscY = ((muEff * (cellR.v - cellL.v)) / dist) * face.area;
        const viscZ = ((muEff * (cellR.w - cellL.w)) / dist) * face.area;

        cellL.resMomX += viscX;
        cellR.resMomX -= viscX;
        cellL.resMomY += viscY;
        cellR.resMomY -= viscY;
        cellL.resMomZ += viscZ;
        cellR.resMomZ -= viscZ;
      } else if (face.boundaryType === 'inlet') {
        cellL.u = inletVelocity;
        const mDot = cellL.rho * inletVelocity * face.area;
        if (!projection) cellL.resMass += mDot;
        cellL.resMomX += mDot * inletVelocity;
      } else if (face.boundaryType === 'outlet') {
        const pBack = Number.isFinite(face.bcPressure) ? face.bcPressure : 101325.0;
        const un = cellL.u * face.normal.x + cellL.v * face.normal.y + cellL.w * face.normal.z;
        const mDot = cellL.rho * un * face.area;
        const gaugePressureForce = (pBack - pRef) * face.area;
        if (!projection) cellL.resMass -= mDot;
        cellL.resMomX -= mDot * cellL.u + gaugePressureForce * face.normal.x;
        cellL.resMomY -= mDot * cellL.v + gaugePressureForce * face.normal.y;
        cellL.resMomZ -= mDot * cellL.w + gaugePressureForce * face.normal.z;
      }
      // Wall faces: no explicit drag impulse in local time stepping; the
      // wall shear is applied semi-implicitly in the cell update loop below
      // (as in the legacy projection path), which is not covered by the
      // diffusion CFL estimate on thin first cells.
    }

    // 4b. Snapshot the momentum residuals for the implicit wall-normal line
    // relaxation. The update loop below consumes and zeroes them; the line
    // relaxation solves its implicit y-systems from these frozen residuals.
    if (this.steadyImplicitWallRelax) {
      for (let i = 0; i < this.cells.length; i++) {
        this._sirRx[i] = this.cells[i].resMomX;
        this._sirRy[i] = this.cells[i].resMomY;
      }
    }

    // 5. Update cell states with per-cell dt.
    for (const cell of this.cells) {
      const dtc = dtArr[cell.id];
      const mrf = this.computeMRFSource(cell);
      const invMass = dtc / (cell.rho * cell.volume);

      // Semi-implicit wall shear (same formulation as the legacy projection
      // path, with the cell's own local dt).
      let denomTan = 1;
      let wallFaceForDrag = null;
      if (cell._hasWallFace) {
        for (const fidx of cell.faceIndices) {
          const f = this.faces[fidx];
          if (f.boundaryType === 'wall' && f.ownerId === cell.id) {
            wallFaceForDrag = f;
            break;
          }
        }
        if (wallFaceForDrag) {
          let ramp = 1;
          if (this.wallDragRampLength > 0) {
            if (this._wallStartX === undefined) {
              let xMin = Infinity;
              for (const wf of this.faces) {
                if (wf.boundaryType === 'wall' && wf.centroid.x < xMin) xMin = wf.centroid.x;
              }
              this._wallStartX = xMin;
            }
            const xLocal = Math.max(0, wallFaceForDrag.centroid.x - this._wallStartX);
            ramp = Math.min(1.0, xLocal / this.wallDragRampLength);
          }
          const wall = this.evaluateWallBoundary(cell, wallFaceForDrag);
          const yW = Math.max(1e-6, cell.wallDistance);
          const viscC = this.mu_lam / yW;
          let dTauDu;
          if (this.twoLayerAllYPlus && wall.dTauDu > 0) {
            dTauDu = wall.dTauDu;
          } else if (wall.uTau > 0 && wall.yPlus > 5) {
            const E = this._wallLawEffectiveConstant(cell) || 9.8;
            const logArg = Math.log(E * wall.yPlus);
            const logC = (2 * cell.rho * wall.uTau * this.kappa) / (logArg + 1);
            const blend = Math.min(1, Math.max(0, (wall.yPlus - 5) / 25));
            dTauDu = (1 - blend) * viscC + blend * logC;
          } else {
            dTauDu = viscC;
          }
          const Cm = (dTauDu * wallFaceForDrag.area * ramp) / (cell.rho * cell.volume);
          denomTan = 1 + dtc * Cm;
        }
      }

      let du = 0.5 * invMass * (cell.resMomX + mrf.fx);
      let dv = 0.5 * invMass * (cell.resMomY + mrf.fy);
      let dw = 0.5 * invMass * (cell.resMomZ + mrf.fz);
      if (denomTan !== 1 && wallFaceForDrag) {
        const nx = wallFaceForDrag.normal.x;
        const ny = wallFaceForDrag.normal.y;
        const nz = wallFaceForDrag.normal.z;
        const unOld = cell.u * nx + cell.v * ny + cell.w * nz;
        const utx = cell.u - unOld * nx;
        const uty = cell.v - unOld * ny;
        const utz = cell.w - unOld * nz;
        const unNew = unOld + (du * nx + dv * ny + dw * nz);
        const utxNew = (utx + du - (du * nx + dv * ny + dw * nz) * nx) / denomTan;
        const utyNew = (uty + dv - (du * nx + dv * ny + dw * nz) * ny) / denomTan;
        const utzNew = (utz + dw - (du * nx + dv * ny + dw * nz) * nz) / denomTan;
        du = utxNew - utx;
        dv = utyNew - uty;
        dw = utzNew - utz;
        const unCorr = unNew - unOld;
        du += unCorr * nx;
        dv += unCorr * ny;
        dw += unCorr * nz;
      }
      cell.u += du;
      cell.v += dv;
      cell.w += dw;

      if (!projection) {
        // Pressure continuity relaxation (legacy compressible path form,
        // residual-proportional so the steady-state fixed point is unchanged),
        // scaled by the cell's own pseudo-time step relative to the far-field
        // reference dt: near-wall cells relax pressure at their own local pace.
        // The increment is clipped and the pressure bounded below by a
        // fraction of the reference pressure (standard robustness safeguards,
        // same magnitude used by the projection path), protecting the
        // compressible acoustic speed against transient overshoot.
        const dtScale = dtc / dtRef;
        const dpMax = 0.05 * 101325;
        const dp = Math.max(
          -dpMax,
          Math.min(dpMax, 0.05 * (cell.resMass / cell.volume) * (this.R_gas * 0.1) * dtScale)
        );
        cell.p += dp;
        if (cell.p < 0.2 * 101325) cell.p = 0.2 * 101325;
        if (!Number.isFinite(cell.p)) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'FVM local time stepping produced a non-finite pressure',
            { cellId: cell.id, pressurePa: cell.p }
          );
        }
      }

      // Outflow sponge (Rayleigh damping toward the inflow velocity).
      if (this.outflowSpongeLength > 0) {
        const xIn = cell.centroid.x - (this._lx - this.outflowSpongeLength);
        if (xIn > 0) {
          const lam = Math.min(1.0, xIn / this.outflowSpongeLength);
          const sigma = this.outflowSpongeStrength * lam * lam;
          cell.u -= dtc * sigma * (cell.u - inletVelocity);
          cell.v -= dtc * sigma * cell.v;
          cell.w -= dtc * sigma * cell.w;
        }
      }

      cell.resMass = 0.0;
      cell.resMomX = 0.0;
      cell.resMomY = 0.0;
      cell.resMomZ = 0.0;
    }

    // 5b. Implicit wall-normal line relaxation (structured y-columns): solve
    // a tridiagonal system per column for the tangential and wall-normal
    // momentum corrections from the snapshot residuals (y-diffusion operator,
    // plus the semi-implicit wall-law drag on the wall cell) and apply with
    // under-relaxation. Streamwise coupling stays explicit. The correction
    // vanishes at the discrete fixed point, so the converged state is
    // unchanged; the implicit y-coupling removes the near-wall acoustic-CFL
    // pseudo-time throttle and stabilizes the boundary-layer equilibration.
    if (this.steadyImplicitWallRelax) {
      this._relaxWallNormalColumns();
    }

    // 6. No-penetration wall boundary condition: remove the wall-normal
    // velocity component of wall-adjacent cells (the wall-law tangential
    // shear is handled semi-implicitly above; the normal component must
    // vanish). In projection mode this is also re-imposed by the projection.
    if (!projection) {
      for (const cell of this.cells) {
        if (!cell._hasWallFace) continue;
        for (const fidx of cell.faceIndices) {
          const f = this.faces[fidx];
          if (f.boundaryType === 'wall' && f.ownerId === cell.id) {
            const nx = f.normal.x;
            const ny = f.normal.y;
            const nz = f.normal.z;
            const un = cell.u * nx + cell.v * ny + cell.w * nz;
            cell.u -= un * nx;
            cell.v -= un * ny;
            cell.w -= un * nz;
            break;
          }
        }
      }
    }

    // 7. Pressure projection (projection mode): enforce discrete continuity
    // with the characteristic pseudo-time step.
    if (projection) {
      this.applyLocalPressureProjection(dtArr, inletVelocity);
    }

    // 7. Wall-function velocity enforcement (same as legacy).
    if (this.wallFunctionVelocityFixed) {
      for (const face of this.faces) {
        if (face.boundaryType !== 'wall') continue;
        const cell = this.cells[face.ownerId];
        const wall = this.evaluateWallBoundary(cell, face);
        if (wall.yPlus <= 11.0) continue;
        const uTau = Math.sqrt(wall.tauW / Math.max(1e-9, cell.rho));
        const E = this._wallLawEffectiveConstant(cell) || 9.8;
        const uLog = (uTau / this.kappa) * Math.log(E * wall.yPlus);
        const mag = Math.hypot(cell.u, cell.v, cell.w);
        if (mag > 1e-12) {
          const f = uLog / mag;
          cell.u *= f;
          cell.v *= f;
          cell.w *= f;
        } else {
          cell.u = uLog;
        }
      }
    }

    // 8. Finiteness / admissibility check (same criteria as legacy).
    for (const cell of this.cells) {
      if (
        ![cell.u, cell.v, cell.w, cell.p, cell.rho, cell.k, cell.omega, cell.nut].every(Number.isFinite) ||
        cell.p <= 0 ||
        cell.rho <= 0 ||
        cell.k <= 0 ||
        cell.omega <= 0 ||
        cell.nut < 0
      ) {
        throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, 'FVM update produced an inadmissible cell state', {
          stepCount: this.stepCount,
          substep: null,
          cellId: cell.id,
          velocityMPerS: [cell.u, cell.v, cell.w],
          pressurePa: cell.p,
          densityKgM3: cell.rho,
          turbulentKineticEnergyM2PerS2: cell.k,
          specificDissipationRatePerS: cell.omega,
          turbulentViscosityM2PerS: cell.nut
        });
      }
    }
  }

  /**
   * Implicit wall-normal (y) line relaxation for local time stepping. Each
   * structured column (fixed ix, iz) is relaxed in the wall-normal direction:
   * the y-diffusion operator (plus the semi-implicit wall-law drag on the
   * wall cell) is solved implicitly as a tridiagonal system per column for
   * the tangential momentum correction, using the frozen momentum residuals
   * accumulated by the flux loop. The pseudo-time weight uses the cell's own
   * diffusion-based rate (0.5 / rate), not the acoustic-CFL-restricted
   * explicit step, so the near-wall cell no longer paces the boundary-layer
   * equilibration; the weight is capped so the streamwise coupling (which
   * stays explicit) remains within its convective CFL. The correction is
   * applied with under-relaxation and a per-sweep limiter. The wall-normal
   * momentum is not line-relaxed: it is governed by the no-penetration wall
   * constraint and the pressure field, both handled elsewhere.
   */
  _relaxWallNormalColumns() {
    const nx = this._nx;
    const ny = this._ny;
    const cells = this.cells;
    if (!nx || !ny || nx * ny !== cells.length) return;
    const omega = this.steadyImplicitWallRelaxOmega;
    if (!(omega > 0) || !(omega <= 1)) return;
    const maxCorr = this.steadyImplicitWallRelaxMaxCorrection;
    const clamp = maxCorr > 0 && Number.isFinite(maxCorr) ? maxCorr : 0;
    if (!this._sirTD || this._sirTD.length !== ny) {
      this._sirTD = new Float64Array(ny);
      this._sirTL = new Float64Array(ny);
      this._sirTU = new Float64Array(ny);
      this._sirTR = new Float64Array(ny);
      this._sirTT = new Float64Array(ny);
    }
    const d = this._sirTD;
    const l = this._sirTL;
    const u = this._sirTU;
    const rhs = this._sirTR;
    const scratch = this._sirTT;

    for (let ix = 1; ix < nx; ix++) {
      // Assemble the column tridiagonal system for the tangential (u)
      // momentum correction. The inlet column (ix = 0) is excluded: its
      // velocity is reset to the inlet value by the boundary treatment, so a
      // correction there would fight the boundary condition.
      for (let iy = 0; iy < ny; iy++) {
        const id = iy * nx + ix;
        const cell = cells[id];
        const rho = Math.max(1e-9, cell.rho);
        const V = cell.volume;
        let rate = this._diffusionRates ? this._diffusionRates[id] : 0;
        if (!Number.isFinite(rate) || rate <= 0) rate = 0;
        let Dlo = 0;
        let Dhi = 0;
        if (iy > 0) {
          const f = this.faces[this._yFaceBelow[id]];
          if (f && f.neighborId === id) {
            const lo = cells[id - nx];
            const nuEff =
              this.mu_lam / Math.max(1e-9, 0.5 * (rho + Math.max(1e-9, lo.rho))) + 0.5 * (cell.nut + lo.nut);
            Dlo = (nuEff * f.area) / (V * f.dist);
          }
        }
        if (iy < ny - 1) {
          const idUp = id + nx;
          const f = this.faces[this._yFaceBelow[idUp]];
          if (f && f.neighborId === idUp) {
            const hi = cells[idUp];
            const nuEff =
              this.mu_lam / Math.max(1e-9, 0.5 * (rho + Math.max(1e-9, hi.rho))) + 0.5 * (cell.nut + hi.nut);
            Dhi = (nuEff * f.area) / (V * f.dist);
          }
        }
        // The implicit pseudo-time weight is the diffusion-based rate
        // (breaking the near-wall acoustic-CFL throttle), capped so the
        // streamwise coupling that stays explicit remains within its
        // convective CFL (0.5 * dx / |u|).
        const speed = Math.hypot(cell.u, cell.v, cell.w);
        const dxCfl = this._dxCell && speed > 1e-6 ? (0.5 * this._dxCell) / speed : Infinity;
        const invDt = Math.max(2.0 * rate, dxCfl > 0 && Number.isFinite(dxCfl) ? 1.0 / dxCfl : 0);
        d[iy] = invDt + Dlo + Dhi;
        l[iy] = iy > 0 ? -Dlo : 0;
        u[iy] = iy < ny - 1 ? -Dhi : 0;
        rhs[iy] = this._sirRx[id] / (rho * V);
        if (iy === 0 && cell._hasWallFace) {
          // Semi-implicit wall-law drag (same linearization as the explicit
          // cell update): for a wall face with normal n, the drag force is
          // -Cm * u_tangential; its linearization enters the diagonal and its
          // known part is moved to the RHS.
          for (const fidx of cell.faceIndices) {
            const f = this.faces[fidx];
            if (f.boundaryType === 'wall' && f.ownerId === id) {
              let ramp = 1;
              if (this.wallDragRampLength > 0) {
                if (this._wallStartX === undefined) {
                  let xMin = Infinity;
                  for (const wf of this.faces) {
                    if (wf.boundaryType === 'wall' && wf.centroid.x < xMin) xMin = wf.centroid.x;
                  }
                  this._wallStartX = xMin;
                }
                const xLocal = Math.max(0, f.centroid.x - this._wallStartX);
                ramp = Math.min(1.0, xLocal / this.wallDragRampLength);
              }
              const wall = this.evaluateWallBoundary(cell, f);
              const yW = Math.max(1e-6, cell.wallDistance);
              const viscC = this.mu_lam / yW;
              let dTauDu;
              if (this.twoLayerAllYPlus && wall.dTauDu > 0) {
                dTauDu = wall.dTauDu;
              } else if (wall.uTau > 0 && wall.yPlus > 5) {
                const E = this._wallLawEffectiveConstant(cell) || 9.8;
                const logArg = Math.log(E * wall.yPlus);
                const logC = (2 * rho * wall.uTau * this.kappa) / (logArg + 1);
                const blend = Math.min(1, Math.max(0, (wall.yPlus - 5) / 25));
                dTauDu = (1 - blend) * viscC + blend * logC;
              } else {
                dTauDu = viscC;
              }
              const Cm = (dTauDu * f.area * ramp) / (rho * V);
              d[iy] += Cm;
              const utx = cell.u - (cell.u * f.normal.x + cell.v * f.normal.y + cell.w * f.normal.z) * f.normal.x;
              rhs[iy] -= Cm * utx;
              break;
            }
          }
        }
        if (!Number.isFinite(d[iy]) || d[iy] <= 0) return;
      }
      this._thomasSolve(l, d, u, rhs, scratch, ny);
      for (let iy = 0; iy < ny; iy++) {
        const id = iy * nx + ix;
        let corr = omega * rhs[iy];
        if (clamp > 0) {
          corr = Math.max(-clamp, Math.min(clamp, corr));
        }
        cells[id].u += corr;
      }

      // The wall-normal (v) momentum is not line-relaxed: it is governed by
      // the no-penetration wall constraint and the pressure field, both
      // handled elsewhere; relaxing it here excited vertical velocity modes
      // that couple poorly with the explicit pressure relaxation.
    }
  }

  /**
   * Thomas algorithm for a tridiagonal system with lower/upper off-diagonals
   * l, u, diagonal d and RHS rhs (in-place). Returns false if the system is
   * not diagonally well-posed (the caller leaves the state unchanged).
   */
  _thomasSolve(l, d, u, rhs, scratch, n) {
    if (!n) return true;
    scratch[0] = d[0];
    if (!Number.isFinite(scratch[0]) || scratch[0] <= 0) return false;
    rhs[0] = rhs[0] / scratch[0];
    for (let i = 1; i < n; i++) {
      const m = l[i] / scratch[i - 1];
      scratch[i] = d[i] - m * u[i - 1];
      if (!Number.isFinite(scratch[i]) || scratch[i] <= 0) return false;
      rhs[i] = (rhs[i] - m * rhs[i - 1]) / scratch[i];
    }
    for (let i = n - 2; i >= 0; i--) {
      rhs[i] = rhs[i] - (u[i] / scratch[i]) * rhs[i + 1];
    }
    return true;
  }

  /**
   * Incompressible pressure-projection correction (fractional-step).
   *
   * Given provisional velocities already advanced by the explicit momentum
   * update, solve the discrete Poisson equation for the pressure correction
   *   sum_faces (A/d) (phi_N - phi_P) = rho * div(u*) / dt
   * (Jacobi iterations) with Neumann conditions on walls/symmetry/inlet and
   * phi = 0 at the outlet, then correct
   *   u^{n+1} = u* - (dt/(rho V)) sum_faces phi_face A n
   *   p^{n+1} = p + phi
   * This enforces discrete continuity (divergence-free velocity) at every
   * substep, which removes the acoustic stiffness of the compressible
   * relaxation at low Mach number.
   *
   * Hardening (kept strictly inside the projection branch so the legacy
   * compressible path is unchanged):
   *   - the Jacobi sweep count is raised and the sweep exits early once the
   *     correction stops changing (deterministic threshold), so strongly
   *     stretched meshes receive a converged pressure correction;
   *   - the velocity correction and pressure increment are under-relaxed
   *     (projectionRelaxation) and the per-substep pressure increment is
   *     clipped to a physical bound (5% of the reference pressure) so the
   *     correction cannot drive p negative on coarse stretched grids;
   *   - a positivity floor (20% of the reference pressure) protects against
   *     accumulated correction overshoot;
   *   - Dirichlet velocity boundary conditions (uniform inlet, no-penetration
   *     walls) are re-imposed after the correction, and a defensive domain-wide
   *     velocity bound prevents any residual spurious growth from propagating;
   *   - a short cross-stream damping zone near the inlet damps the spurious
   *     vertical oscillations of the leading-edge shear layer on stretched
   *     meshes.
   * Rhie-Chow face-flux interpolation (2026-10-31): the velocity correction
   * uses the face-compact pressure-gradient stencil (phi_N - phi_P)/d
   * distributed to the adjacent cells, instead of the face-averaged
   * Green-Gauss stencil. This makes the discrete divergence (the Poisson RHS
   * operator) and the correction gradient adjoint-consistent on stretched
   * collocated meshes (the documented D∘G mismatch ≈1.0 is removed), so the
   * projection enforces discrete continuity of the face fluxes to solver
   * tolerance rather than leaving a growing residual divergence.
   * Residuals of the smoothed projection are reported by the stretched-mesh
   * regression test (test/test_fvm_projection_stretched.js).
   */
  applyPressureProjection(dt, inletVelocity) {
    const cells = this.cells;
    const faces = this.faces;
    const n = cells.length;
    if (!this._projPhi || this._projPhi.length !== n) {
      this._projPhi = new Float64Array(n);
      this._projRhs = new Float64Array(n);
      this._projRhs2 = new Float64Array(n);
      this._projDiv = new Float64Array(n);
      this._projA = new Float64Array(n);
      this._projD = new Float64Array(faces.length);
      this._projOutlet = new Uint8Array(n);
      this._projUn = new Float64Array(faces.length);
      this._projGradPx = new Float64Array(n);
      this._projGradPy = new Float64Array(n);
      this._projGradPz = new Float64Array(n);
      for (const f of faces) {
        if (f.boundaryType === 'outlet') this._projOutlet[f.ownerId] = 1;
      }
    }
    const phi = this._projPhi;
    const rhs = this._projRhs;
    const rhs2 = this._projRhs2;
    const div = this._projDiv;
    const Arow = this._projA;
    const D = this._projD;
    const outlet = this._projOutlet;
    const faceUn = this._projUn;
    const gpx = this._projGradPx;
    const gpy = this._projGradPy;
    const gpz = this._projGradPz;

    phi.fill(0);
    div.fill(0);
    Arow.fill(0);
    gpx.fill(0);
    gpy.fill(0);
    gpz.fill(0);

    // Cell-centered pressure gradients (Green-Gauss, zero-gradient ghost at
    // boundaries), used by the Rhie-Chow interpolation term.
    for (const f of faces) {
      const o = cells[f.ownerId];
      const ax = f.area * f.normal.x;
      const ay = f.area * f.normal.y;
      const az = f.area * f.normal.z;
      if (f.neighborId >= 0) {
        const nb = cells[f.neighborId];
        const pf = 0.5 * (o.p + nb.p);
        const hx = pf * ax;
        const hy = pf * ay;
        const hz = pf * az;
        gpx[o.id] += hx;
        gpy[o.id] += hy;
        gpz[o.id] += hz;
        gpx[nb.id] -= hx;
        gpy[nb.id] -= hy;
        gpz[nb.id] -= hz;
      } else {
        // Boundary closure with the true OUTWARD face normal. The structured
        // mesh stores inward normals for the inlet and bottom-wall faces
        // (used by the legacy flux sign conventions); the Green-Gauss
        // gradient must close the cell surface with outward normals, or a
        // uniform pressure field produces a spurious gradient.
        let ox = f.normal.x;
        let oy = f.normal.y;
        let oz = f.normal.z;
        if (f.boundaryType === 'inlet') {
          ox = -1;
          oy = 0;
          oz = 0;
        } else if (f.boundaryType === 'wall') {
          ox = 0;
          oy = -1;
          oz = 0;
        } else if (f.boundaryType === 'outlet') {
          ox = 1;
          oy = 0;
          oz = 0;
        } else if (f.boundaryType === 'symmetry') {
          ox = 0;
          oy = 1;
          oz = 0;
        }
        gpx[o.id] += o.p * f.area * ox;
        gpy[o.id] += o.p * f.area * oy;
        gpz[o.id] += o.p * f.area * oz;
      }
    }
    for (let i = 0; i < n; i++) {
      const invV = 1.0 / Math.max(1e-12, cells[i].volume);
      gpx[i] *= invV;
      gpy[i] *= invV;
      gpz[i] *= invV;
    }

    // Rhie-Chow face-flux assembly. The momentum predictor applies the
    // interpolated (Green-Gauss) face pressure force; the continuity
    // equation is discretized with the face-compact operator. The Rhie-Chow
    // term substitutes the compact face pressure gradient (p_N - p_P)/d for
    // the interpolated one in the face flux, so the predicted face flux is
    //   un_flux = avg(u*) - (dt/rho) [ (p_N - p_P)/d - avg(grad p) . n ]
    // and the discrete divergence and gradient operators become consistent.
    for (const f of faces) {
      const o = cells[f.ownerId];
      if (f.neighborId >= 0) {
        const nb = cells[f.neighborId];
        const dist =
          Math.hypot(nb.centroid.x - o.centroid.x, nb.centroid.y - o.centroid.y, nb.centroid.z - o.centroid.z) || 1e-6;
        const d = f.area / dist;
        D[f.id] = d;
        Arow[o.id] += d;
        Arow[nb.id] += d;
        const unAvg = 0.5 * ((o.u + nb.u) * f.normal.x + (o.v + nb.v) * f.normal.y + (o.w + nb.w) * f.normal.z);
        const pJump = (nb.p - o.p) / dist;
        const gradPFace =
          0.5 *
          ((gpx[o.id] + gpx[nb.id]) * f.normal.x +
            (gpy[o.id] + gpy[nb.id]) * f.normal.y +
            (gpz[o.id] + gpz[nb.id]) * f.normal.z);
        const rhoFace = 0.5 * (o.rho + nb.rho);
        const unFlux = unAvg - (dt / Math.max(rhoFace, 1e-9)) * (pJump - gradPFace);
        const flux = unFlux * f.area;
        div[o.id] += flux;
        div[nb.id] -= flux;
        faceUn[f.id] = unFlux;
      } else if (f.boundaryType === 'inlet') {
        // Inflow: velocity enters the domain, so the outward normal flux is
        // negative (flow is into the owner cell).
        const un = inletVelocity * f.normal.x;
        div[o.id] -= un * f.area;
        faceUn[f.id] = un;
      } else if (f.boundaryType === 'outlet') {
        const un = o.u * f.normal.x + o.v * f.normal.y + o.w * f.normal.z;
        div[o.id] += un * f.area;
        faceUn[f.id] = un;
      } else {
        faceUn[f.id] = 0;
      }
      // wall / symmetry: impermeable, no mass flux.
    }

    for (let i = 0; i < n; i++) {
      rhs[i] = (cells[i].rho * div[i]) / dt;
    }

    // Solve L phi = rhs with a warm-started conjugate-gradient iteration over
    // the face-compact Laplacian (SPD after outlet Dirichlet pinning). Plain
    // Jacobi diverges on strongly stretched grids (weak diagonal dominance:
    // residual grew with sweeps), so the converged correction requires a
    // Krylov solve; the previous substep's phi is a good initial guess.
    const iters = this.projectionIters;
    let rhsScale = 0;
    for (let i = 0; i < n; i++) {
      rhsScale = Math.max(rhsScale, Math.abs(rhs[i]));
    }
    if (rhsScale <= 0) {
      phi.fill(0);
    } else {
      if (!this._projR || this._projR.length !== n) {
        this._projR = new Float64Array(n);
        this._projZ = new Float64Array(n);
        this._projP = new Float64Array(n);
        this._projQ = new Float64Array(n);
      }
      const r = this._projR;
      const z = this._projZ;
      const p = this._projP;
      const q = this._projQ;
      // r = rhs - L phi
      for (let i = 0; i < n; i++) {
        r[i] = outlet[i] ? 0 : rhs[i] - Arow[i] * phi[i];
      }
      for (const f of faces) {
        if (f.neighborId < 0) continue;
        const d = D[f.id];
        const o = f.ownerId;
        const nb = f.neighborId;
        const dp = phi[nb] - phi[o];
        if (!outlet[o]) r[o] -= d * dp;
        if (!outlet[nb]) r[nb] += d * dp;
      }
      for (let i = 0; i < n; i++) {
        r[i] = outlet[i] ? 0 : r[i];
        z[i] = r[i] / Math.max(Arow[i], 1e-30);
        p[i] = z[i];
      }
      let rho = 0;
      for (let i = 0; i < n; i++) rho += r[i] * z[i];
      const rhsNorm = rhsScale * Math.sqrt(n);
      for (let it = 0; it < iters; it++) {
        // q = L p (outlet Dirichlet rows are pinned to zero)
        for (let i = 0; i < n; i++) q[i] = outlet[i] ? 0 : Arow[i] * p[i];
        for (const f of faces) {
          if (f.neighborId < 0) continue;
          const d = D[f.id];
          const o = f.ownerId;
          const nb = f.neighborId;
          const dpv = p[nb] - p[o];
          if (!outlet[o]) q[o] -= d * dpv;
          if (!outlet[nb]) q[nb] += d * dpv;
        }
        let pq = 0;
        for (let i = 0; i < n; i++) pq += p[i] * q[i];
        if (!(pq > 0)) break;
        const alpha = rho / pq;
        for (let i = 0; i < n; i++) {
          phi[i] += alpha * p[i];
          r[i] -= alpha * q[i];
        }
        for (let i = 0; i < n; i++) {
          if (outlet[i]) {
            phi[i] = 0;
            r[i] = 0;
            p[i] = 0;
            q[i] = 0;
          }
        }
        let r2 = 0;
        for (let i = 0; i < n; i++) r2 += r[i] * r[i];
        if (Math.sqrt(r2) <= 1e-6 * Math.max(rhsNorm, 1e-30)) break;
        for (let i = 0; i < n; i++) z[i] = outlet[i] ? 0 : r[i] / Math.max(Arow[i], 1e-30);
        let rhoNew = 0;
        for (let i = 0; i < n; i++) rhoNew += r[i] * z[i];
        const beta = rhoNew / Math.max(rho, 1e-30);
        for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
        rho = rhoNew;
      }
    }

    // Correct the stored Rhie-Chow face velocities with the solved pressure
    // correction: un^{n+1}_f = unFlux_f - (dt/rho)(phi_N - phi_P)/d. The
    // face flux used for transport in the next substep is exactly the
    // continuity-satisfying flux: D(un^{n+1}) = D(u*) - (dt/rho) L phi = 0.
    for (const f of faces) {
      if (f.neighborId < 0) continue;
      const o = cells[f.ownerId];
      const nb = cells[f.neighborId];
      const dist =
        Math.hypot(nb.centroid.x - o.centroid.x, nb.centroid.y - o.centroid.y, nb.centroid.z - o.centroid.z) || 1e-6;
      const rhoFace = 0.5 * (o.rho + nb.rho);
      faceUn[f.id] -= (dt / Math.max(rhoFace, 1e-9)) * ((phi[nb.id] - phi[o.id]) / dist);
    }

    // Cell-centered velocity correction using the Green-Gauss gradient of the
    // pressure correction (the same discretization as the momentum pressure
    // force), under-relaxed. The continuity constraint itself is carried by
    // the Rhie-Chow face fluxes above; the cell update keeps the cell-centered
    // momentum consistent with the corrected pressure field.
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      const coef = dt / (c.rho * c.volume);
      let gx = 0;
      let gy = 0;
      let gz = 0;
      for (const fidx of c.faceIndices) {
        const f = faces[fidx];
        let ax, ay, az, pFace;
        if (f.neighborId >= 0) {
          const nb = cells[f.neighborId];
          pFace = 0.5 * (phi[i] + phi[nb.id]);
          if (f.ownerId === c.id) {
            ax = f.area * f.normal.x;
            ay = f.area * f.normal.y;
            az = f.area * f.normal.z;
          } else {
            ax = -f.area * f.normal.x;
            ay = -f.area * f.normal.y;
            az = -f.area * f.normal.z;
          }
        } else if (f.boundaryType === 'wall' || f.boundaryType === 'symmetry' || f.boundaryType === 'inlet') {
          pFace = phi[i];
          ax = f.area * f.normal.x;
          ay = f.area * f.normal.y;
          az = f.area * f.normal.z;
        } else {
          continue; // outlet: phi = 0 at the face
        }
        gx += pFace * ax;
        gy += pFace * ay;
        gz += pFace * az;
      }
      const relax = this.projectionRelaxation;
      c.u -= relax * coef * gx;
      c.v -= relax * coef * gy;
      c.w -= relax * coef * gz;
      const dpMax = 0.05 * 101325;
      const dp = Math.max(-dpMax, Math.min(dpMax, relax * phi[i]));
      c.p += dp;
      if (c.p < 0.2 * 101325) c.p = 0.2 * 101325;
    }

    // Re-impose Dirichlet velocity boundary conditions that the pressure
    // correction may have perturbed (uniform inlet, no-penetration walls).
    for (const f of faces) {
      if (f.boundaryType === 'inlet') {
        const c = cells[f.ownerId];
        c.u = inletVelocity;
        c.v = 0;
        c.w = 0;
        faceUn[f.id] = inletVelocity * f.normal.x;
      } else if (f.boundaryType === 'wall') {
        const c = cells[f.ownerId];
        c.v = 0;
        c.w = 0;
        faceUn[f.id] = 0;
      } else if (f.boundaryType === 'outlet') {
        const c = cells[f.ownerId];
        faceUn[f.id] = c.u * f.normal.x + c.v * f.normal.y + c.w * f.normal.z;
      } else if (f.boundaryType === 'symmetry') {
        faceUn[f.id] = 0;
      }
    }

    // Defensive domain-wide velocity bound (finite-state guarantee). A healthy
    // run never approaches this bound; it only guards against residual
    // spurious growth of the smoothed projection.
    const velCap = 4.0 * inletVelocity;
    for (const c of cells) {
      const speed = Math.hypot(c.u, c.v, c.w);
      if (speed > velCap) {
        const scale = velCap / speed;
        c.u *= scale;
        c.v *= scale;
        c.w *= scale;
      }
    }

    // Damp spurious cross-stream oscillations of the leading-edge shear layer
    // near the inlet on stretched meshes (localized; inactive on non-box
    // domains where this._lx is not set).
    const spongeX = 0.06 * this._lx;
    for (const c of cells) {
      if (c.centroid.x < spongeX) {
        const lam = 1 - c.centroid.x / spongeX;
        const factor = 1 - 0.9 * (1 - lam);
        c.v *= factor;
        c.w *= factor;
      }
    }
  }

  /**
   * Local-time-stepping pressure projection (fractional-step with per-cell
   * pseudo-time steps). Given provisional velocities already advanced by the
   * momentum predictor with per-cell dt (weights w_i = dt_i / (rho_i V_i)),
   * solve the weighted discrete Poisson equation
   *   sum_faces W_f (A/d) (phi_N - phi_P) = D(u*)
   * with W_f the interpolated face weight, Neumann conditions on
   * walls/symmetry/inlet and phi = 0 at the outlet, then correct
   *   u^{n+1}_i = u*_i - w_i sum_faces phi_f A n
   *   p^{n+1}_i = p_i + phi_i
   * This is the steady-RANS counterpart of the global-dt projection
   * (applyPressureProjection) in which each cell enforces continuity at its
   * own pseudo-time pace; the elliptic constraint is solved once per sweep.
   */
  applyLocalPressureProjection(dtArr, inletVelocity) {
    const cells = this.cells;
    const faces = this.faces;
    const n = cells.length;
    if (!this._projPhi || this._projPhi.length !== n) {
      this._projPhi = new Float64Array(n);
      this._projRhs = new Float64Array(n);
      this._projRhs2 = new Float64Array(n);
      this._projDiv = new Float64Array(n);
      this._projA = new Float64Array(n);
      this._projD = new Float64Array(faces.length);
      this._projOutlet = new Uint8Array(n);
      this._projUn = new Float64Array(faces.length);
      this._projGradPx = new Float64Array(n);
      this._projGradPy = new Float64Array(n);
      this._projGradPz = new Float64Array(n);
      for (const f of faces) {
        if (f.boundaryType === 'outlet') this._projOutlet[f.ownerId] = 1;
      }
    }
    const phi = this._projPhi;
    const rhs = this._projRhs;
    const div = this._projDiv;
    const Arow = this._projA;
    const D = this._projD;
    const outlet = this._projOutlet;
    const faceUn = this._projUn;
    const gpx = this._projGradPx;
    const gpy = this._projGradPy;
    const gpz = this._projGradPz;

    phi.fill(0);
    div.fill(0);
    Arow.fill(0);
    gpx.fill(0);
    gpy.fill(0);
    gpz.fill(0);

    // Per-cell pseudo-time weights w_i = dt_i / (rho_i V_i).
    if (!this._projW || this._projW.length !== n) this._projW = new Float64Array(n);
    const w = this._projW;
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      w[i] = dtArr[i] / Math.max(c.rho, 1e-9) / Math.max(c.volume, 1e-12);
    }

    // Cell-centered pressure gradients (Green-Gauss, zero-gradient ghost at
    // boundaries), used by the Rhie-Chow interpolation term.
    for (const f of faces) {
      const o = cells[f.ownerId];
      const ax = f.aAx;
      const ay = f.aAy;
      const az = f.aAz;
      if (f.neighborId >= 0) {
        const nb = cells[f.neighborId];
        const pf = 0.5 * (o.p + nb.p);
        const hx = pf * ax;
        const hy = pf * ay;
        const hz = pf * az;
        gpx[o.id] += hx;
        gpy[o.id] += hy;
        gpz[o.id] += hz;
        gpx[nb.id] -= hx;
        gpy[nb.id] -= hy;
        gpz[nb.id] -= hz;
      } else {
        let ox = f.normal.x;
        let oy = f.normal.y;
        let oz = f.normal.z;
        if (f.boundaryType === 'inlet') {
          ox = -1;
          oy = 0;
          oz = 0;
        } else if (f.boundaryType === 'wall') {
          ox = 0;
          oy = -1;
          oz = 0;
        } else if (f.boundaryType === 'outlet') {
          ox = 1;
          oy = 0;
          oz = 0;
        } else if (f.boundaryType === 'symmetry') {
          ox = 0;
          oy = 1;
          oz = 0;
        }
        gpx[o.id] += o.p * f.area * ox;
        gpy[o.id] += o.p * f.area * oy;
        gpz[o.id] += o.p * f.area * oz;
      }
    }
    for (let i = 0; i < n; i++) {
      const invV = 1.0 / Math.max(1e-12, cells[i].volume);
      gpx[i] *= invV;
      gpy[i] *= invV;
      gpz[i] *= invV;
    }

    // Weighted Rhie-Chow face-flux assembly.
    for (const f of faces) {
      const o = cells[f.ownerId];
      if (f.neighborId >= 0) {
        const nb = cells[f.neighborId];
        const dist = f.dist || 1e-6;
        const Wf = 0.5 * (w[o.id] + w[nb.id]);
        const d = Wf * (f.area / dist);
        D[f.id] = d;
        Arow[o.id] += d;
        Arow[nb.id] += d;
        const unAvg = 0.5 * ((o.u + nb.u) * f.normal.x + (o.v + nb.v) * f.normal.y + (o.w + nb.w) * f.normal.z);
        const pJump = (nb.p - o.p) / dist;
        const gradPFace =
          0.5 *
          ((gpx[o.id] + gpx[nb.id]) * f.normal.x +
            (gpy[o.id] + gpy[nb.id]) * f.normal.y +
            (gpz[o.id] + gpz[nb.id]) * f.normal.z);
        const unFlux = unAvg - Wf * (pJump - gradPFace);
        const flux = unFlux * f.area;
        div[o.id] += flux;
        div[nb.id] -= flux;
        faceUn[f.id] = unFlux;
      } else if (f.boundaryType === 'inlet') {
        const un = inletVelocity * f.normal.x;
        div[o.id] -= un * f.area;
        faceUn[f.id] = un;
      } else if (f.boundaryType === 'outlet') {
        const un = o.u * f.normal.x + o.v * f.normal.y + o.w * f.normal.z;
        div[o.id] += un * f.area;
        faceUn[f.id] = un;
      } else {
        faceUn[f.id] = 0;
      }
    }

    for (let i = 0; i < n; i++) {
      rhs[i] = div[i];
    }

    // Solve L phi = rhs with the warm-started conjugate-gradient iteration
    // (same solver as the global-dt projection).
    const iters = this.projectionIters;
    let rhsScale = 0;
    for (let i = 0; i < n; i++) {
      rhsScale = Math.max(rhsScale, Math.abs(rhs[i]));
    }
    if (rhsScale <= 0) {
      phi.fill(0);
    } else {
      if (!this._projR || this._projR.length !== n) {
        this._projR = new Float64Array(n);
        this._projZ = new Float64Array(n);
        this._projP = new Float64Array(n);
        this._projQ = new Float64Array(n);
      }
      const r = this._projR;
      const z = this._projZ;
      const p = this._projP;
      const q = this._projQ;
      for (let i = 0; i < n; i++) {
        r[i] = outlet[i] ? 0 : rhs[i] - Arow[i] * phi[i];
      }
      for (const f of faces) {
        if (f.neighborId < 0) continue;
        const d = D[f.id];
        const o = f.ownerId;
        const nb = f.neighborId;
        const dp = phi[nb] - phi[o];
        if (!outlet[o]) r[o] -= d * dp;
        if (!outlet[nb]) r[nb] += d * dp;
      }
      for (let i = 0; i < n; i++) {
        r[i] = outlet[i] ? 0 : r[i];
        z[i] = r[i] / Math.max(Arow[i], 1e-30);
        p[i] = z[i];
      }
      let rho = 0;
      for (let i = 0; i < n; i++) rho += r[i] * z[i];
      const rhsNorm = rhsScale * Math.sqrt(n);
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) q[i] = outlet[i] ? 0 : Arow[i] * p[i];
        for (const f of faces) {
          if (f.neighborId < 0) continue;
          const d = D[f.id];
          const o = f.ownerId;
          const nb = f.neighborId;
          const dpv = p[nb] - p[o];
          if (!outlet[o]) q[o] -= d * dpv;
          if (!outlet[nb]) q[nb] += d * dpv;
        }
        let pq = 0;
        for (let i = 0; i < n; i++) pq += p[i] * q[i];
        if (!(pq > 0)) break;
        const alpha = rho / pq;
        for (let i = 0; i < n; i++) {
          phi[i] += alpha * p[i];
          r[i] -= alpha * q[i];
        }
        for (let i = 0; i < n; i++) {
          if (outlet[i]) {
            phi[i] = 0;
            r[i] = 0;
            p[i] = 0;
            q[i] = 0;
          }
        }
        let r2 = 0;
        for (let i = 0; i < n; i++) r2 += r[i] * r[i];
        if (Math.sqrt(r2) <= 1e-6 * Math.max(rhsNorm, 1e-30)) break;
        for (let i = 0; i < n; i++) z[i] = outlet[i] ? 0 : r[i] / Math.max(Arow[i], 1e-30);
        let rhoNew = 0;
        for (let i = 0; i < n; i++) rhoNew += r[i] * z[i];
        const beta = rhoNew / Math.max(rho, 1e-30);
        for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
        rho = rhoNew;
      }
    }

    // Correct the stored Rhie-Chow face velocities with the solved pressure
    // correction.
    for (const f of faces) {
      if (f.neighborId < 0) continue;
      const o = cells[f.ownerId];
      const nb = cells[f.neighborId];
      const dist = f.dist || 1e-6;
      const Wf = 0.5 * (w[o.id] + w[nb.id]);
      faceUn[f.id] -= Wf * ((phi[nb.id] - phi[o.id]) / dist);
    }

    // Cell-centered velocity correction with the per-cell weight, under-
    // relaxed (same relaxation as the global-dt projection).
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      const coef = w[i];
      let gx = 0;
      let gy = 0;
      let gz = 0;
      for (const fidx of c.faceIndices) {
        const f = faces[fidx];
        let ax, ay, az, pFace;
        if (f.neighborId >= 0) {
          const nb = cells[f.neighborId];
          pFace = 0.5 * (phi[i] + phi[nb.id]);
          if (f.ownerId === c.id) {
            ax = f.area * f.normal.x;
            ay = f.area * f.normal.y;
            az = f.area * f.normal.z;
          } else {
            ax = -f.area * f.normal.x;
            ay = -f.area * f.normal.y;
            az = -f.area * f.normal.z;
          }
        } else if (f.boundaryType === 'wall' || f.boundaryType === 'symmetry' || f.boundaryType === 'inlet') {
          pFace = phi[i];
          ax = f.area * f.normal.x;
          ay = f.area * f.normal.y;
          az = f.area * f.normal.z;
        } else {
          continue;
        }
        gx += pFace * ax;
        gy += pFace * ay;
        gz += pFace * az;
      }
      const relax = this.projectionRelaxation;
      c.u -= relax * coef * gx;
      c.v -= relax * coef * gy;
      c.w -= relax * coef * gz;
      const dpMax = 0.05 * 101325;
      const dp = Math.max(-dpMax, Math.min(dpMax, relax * phi[i]));
      c.p += dp;
      if (c.p < 0.2 * 101325) c.p = 0.2 * 101325;
    }

    // Re-impose Dirichlet velocity boundary conditions.
    for (const f of faces) {
      if (f.boundaryType === 'inlet') {
        const c = cells[f.ownerId];
        c.u = inletVelocity;
        c.v = 0;
        c.w = 0;
        faceUn[f.id] = inletVelocity * f.normal.x;
      } else if (f.boundaryType === 'wall') {
        const c = cells[f.ownerId];
        c.v = 0;
        c.w = 0;
        faceUn[f.id] = 0;
      } else if (f.boundaryType === 'outlet') {
        const c = cells[f.ownerId];
        faceUn[f.id] = c.u * f.normal.x + c.v * f.normal.y + c.w * f.normal.z;
      } else if (f.boundaryType === 'symmetry') {
        faceUn[f.id] = 0;
      }
    }

    // Defensive domain-wide velocity bound (same as the global-dt projection).
    const velCap = 4.0 * inletVelocity;
    for (const c of cells) {
      const speed = Math.hypot(c.u, c.v, c.w);
      if (speed > velCap) {
        const scale = velCap / speed;
        c.u *= scale;
        c.v *= scale;
        c.w *= scale;
      }
    }

    // Damp spurious cross-stream oscillations near the inlet (same as the
    // global-dt projection).
    const spongeX = 0.06 * this._lx;
    for (const c of cells) {
      if (c.centroid.x < spongeX) {
        const lam = 1 - c.centroid.x / spongeX;
        const factor = 1 - 0.9 * (1 - lam);
        c.v *= factor;
        c.w *= factor;
      }
    }
  }

  /**
   * Dispatches multiple FVM steps, initializing a default domain if uninitialized
   */
  solveSteps(steps = 10, inletVelocity = 15.0) {
    if (this.cells.length === 0) {
      this.createBoxDomain(4, 4, 4);
    }
    return this.step(inletVelocity, steps);
  }
}

module.exports = {
  PolyhedralCell3D,
  PolyhedralFace3D,
  FVMNavierStokes3D
};
