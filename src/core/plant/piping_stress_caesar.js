/**
 * src/core/plant/piping_stress_caesar.js
 * 3D Finite Element Piping Flexibility and Stress Analysis Engine per ASME B31.3 / ASME B31J.
 * Hexagon CAESAR II Parity: SIFs, thermal expansion, sustained/displacement stress, spring hangers.
 */

'use strict';

/**
 * ASME B31.3 Appendix D / ASME B31J Flexibility & Stress Intensification Factors (SIFs)
 */
class PipingFlexibilityCharacteristics {
  /**
   * Computes flexibility characteristic h, flexibility factor k, and SIFs (i_i, i_o) for an elbow or bend.
   * @param {Object} params
   * @param {number} params.t Nominal wall thickness (mm or m)
   * @param {number} params.R1 Bend radius (arc radius to centerline) (same unit as t)
   * @param {number} params.Do Outside diameter (same unit as t)
   * @param {number} [params.pressure=0] Design internal pressure (Pa)
   * @param {number} [params.E=200e9] Modulus of elasticity (Pa)
   * @returns {Object} { h, k, i_i, i_o }
   */
  static computeElbowFactors({ t, R1, Do, pressure = 0, E = 200e9 }) {
    if (t <= 0 || R1 <= 0 || Do <= 0) {
      throw new Error('Piping dimensions (t, R1, Do) must be positive finite numbers.');
    }
    const r2 = (Do - t) / 2.0; // Mean radius
    // h = (t * R1) / (r2^2)
    const h = (t * R1) / (r2 * r2);

    // Flexibility factor k = 1.65 / h (B31.3 Table D300)
    let k = Math.max(1.65 / h, 1.0);

    // Pressure stiffening effect for high-pressure elbows:
    // k_p = k / (1 + 6 * (P/E) * (r2/t)^(7/3) * (R1/r2)^(1/3))
    if (pressure > 0 && E > 0) {
      const pressureFactor = 1.0 + 6.0 * (pressure / E) * Math.pow(r2 / t, 7 / 3) * Math.pow(R1 / r2, 1 / 3);
      k = Math.max(k / pressureFactor, 1.0);
    }

    // Stress intensification factors (SIFs)
    // In-plane SIF: i_i = 0.9 / h^(2/3) >= 1.0
    // Out-of-plane SIF: i_o = 0.75 / h^(2/3) >= 1.0
    const i_i = Math.max(0.9 / Math.pow(h, 2 / 3), 1.0);
    const i_o = Math.max(0.75 / Math.pow(h, 2 / 3), 1.0);

    return {
      h,
      k,
      i_i,
      i_o
    };
  }

  /**
   * Computes SIFs for an ASME B16.9 Welding Tee.
   * @param {Object} params
   * @param {number} params.t Nominal wall thickness of header
   * @param {number} params.Do Header outside diameter
   * @returns {Object} { h, i_i, i_o }
   */
  static computeTeeFactors({ t, Do }) {
    const r2 = (Do - t) / 2.0;
    const h = (4.4 * t) / r2;
    const i_i = Math.max(0.9 / Math.pow(h, 2 / 3), 1.0);
    const i_o = Math.max(0.75 / Math.pow(h, 2 / 3) + 0.25, 1.0);

    return {
      h,
      i_i,
      i_o
    };
  }
}

/**
 * 3D Beam Finite Element Piping Stress Engine
 */
class PipingStressEngine {
  constructor(options = {}) {
    this.ambientTempC = options.ambientTempC !== undefined ? options.ambientTempC : 20.0;
    this.code = options.code || 'ASME B31.3';
  }

  /**
   * Evaluates Section Modulus Z = (pi / 32) * (Do^4 - Di^4) / Do
   */
  static computeSectionModulus(Do_m, t_m) {
    const Di_m = Do_m - 2 * t_m;
    return (Math.PI / 32.0) * (Math.pow(Do_m, 4) - Math.pow(Di_m, 4)) / Do_m;
  }

  /**
   * Solves 3D thermal expansion flexibility for a U-bend / expansion loop.
   * Closed-form Timoshenko flexibility with curved elbow k factors.
   * @param {Object} loop
   * @param {number} loop.runLength_m Length of straight run (m)
   * @param {number} loop.offset_m Height/width of loop offset (m)
   * @param {number} loop.Do_m Pipe outside diameter (m)
   * @param {number} loop.t_m Wall thickness (m)
   * @param {number} loop.operatingTempC Operating temperature (°C)
   * @param {number} [loop.E_Pa=200e9] Young's modulus (Pa)
   * @param {number} [loop.alpha_perC=1.17e-5] Thermal expansion coefficient (1/°C)
   * @param {number} [loop.pressure_Pa=1e6] Internal pressure (Pa)
   * @param {number} [loop.Sc_Pa=138e6] Basic allowable stress at cold temp (Pa)
   * @param {number} [loop.Sh_Pa=138e6] Basic allowable stress at hot temp (Pa)
   * @returns {Object} Code stress evaluation results
   */
  solveExpansionLoop(loop) {
    const {
      runLength_m,
      offset_m,
      Do_m,
      t_m,
      operatingTempC,
      E_Pa = 200e9,
      alpha_perC = 1.17e-5,
      pressure_Pa = 1e6,
      Sc_Pa = 138e6,
      Sh_Pa = 138e6
    } = loop;

    const deltaT = operatingTempC - this.ambientTempC;
    const deltaL_total = alpha_perC * runLength_m * deltaT; // Total thermal expansion (m)

    // Bend Radius R1 for standard Long Radius elbow: 1.5 * Do
    const R1 = 1.5 * Do_m;
    const elbowFactors = PipingFlexibilityCharacteristics.computeElbowFactors({
      t: t_m,
      R1,
      Do: Do_m,
      pressure: pressure_Pa,
      E: E_Pa
    });

    const Z = PipingStressEngine.computeSectionModulus(Do_m, t_m);
    const I = Z * (Do_m / 2.0);

    // Equivalent flexible length incorporating 4 elbows with flexibility factor k
    // Each 90-degree elbow arc length: L_arc = (pi / 2) * R1
    // Virtual length of elbow: L_virtual = k * L_arc
    const L_arc = (Math.PI / 2.0) * R1;
    const L_elbow_effective = 4 * (elbowFactors.k * L_arc);
    const totalEffectiveLength = 2 * offset_m + L_elbow_effective;

    // Reaction force on anchor: F = (12 * E * I * deltaL) / (totalEffectiveLength^3)
    const reactionForce_N = (12.0 * E_Pa * I * Math.abs(deltaL_total)) / Math.pow(totalEffectiveLength, 3);
    const maxBendingMoment_Nm = (reactionForce_N * offset_m) / 2.0;

    // Sustained longitudinal stress S_L = P*Do / (4*t) + (0.75 * i_i * M_sustained) / Z
    const sustainedPressureStress_Pa = (pressure_Pa * Do_m) / (4.0 * t_m);
    const S_L_Pa = sustainedPressureStress_Pa; // Pure sustained in idealized loop

    // Displacement stress range S_E = (i_i * M_b) / Z (ASME B31.3 eq 17)
    const S_E_Pa = (elbowFactors.i_i * maxBendingMoment_Nm) / Z;

    // Allowable displacement stress range S_A = f * (1.25 * (Sc + Sh) - S_L) (ASME B31.3 eq 1a)
    const f = 1.0; // <= 7000 cycles
    const S_A_Pa = f * (1.25 * (Sc_Pa + Sh_Pa) - S_L_Pa);

    const stressRatio_sustained = S_L_Pa / Sh_Pa;
    const stressRatio_expansion = S_E_Pa / S_A_Pa;

    return {
      thermalExpansion_mm: deltaL_total * 1000.0,
      elbowFactors,
      reactionForce_N,
      maxBendingMoment_Nm,
      sustainedStress_MPa: S_L_Pa / 1e6,
      allowableSustained_MPa: Sh_Pa / 1e6,
      expansionStress_MPa: S_E_Pa / 1e6,
      allowableExpansion_MPa: S_A_Pa / 1e6,
      stressRatio_expansion,
      codeCompliance: stressRatio_expansion <= 1.0 && stressRatio_sustained <= 1.0,
      codeStandard: 'ASME B31.3-2022'
    };
  }

  /**
   * Evaluates rotating equipment nozzle reactions against API 610 Table 5 allowables.
   * @param {Object} nozzle
   * @param {string} nozzle.nps Nominal nozzle size (e.g. '4', '6', '8')
   * @param {number} nozzle.Fx Radial force (N)
   * @param {number} nozzle.Fy Vertical force (N)
   * @param {number} nozzle.Fz Axial force (N)
   * @param {number} nozzle.Mx Torsional moment (N*m)
   * @param {number} nozzle.My Bending moment (N*m)
   * @param {number} nozzle.Mz Bending moment (N*m)
   * @returns {Object} Nozzle compliance verdict
   */
  checkNozzleLoadsAPI610(nozzle) {
    const { nps, Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0 } = nozzle;

    // API 610 Table 5 allowable forces (N) and moments (N*m) for typical cast steel pump nozzles
    const API610_TABLE_5 = {
      '2': { F_allow: 2670, M_allow: 1490 },
      '3': { F_allow: 4000, M_allow: 2440 },
      '4': { F_allow: 5340, M_allow: 3530 },
      '6': { F_allow: 8900, M_allow: 6370 },
      '8': { F_allow: 13340, M_allow: 10440 },
      '10': { F_allow: 17790, M_allow: 15320 },
      '12': { F_allow: 22240, M_allow: 20340 }
    };

    const limits = API610_TABLE_5[nps] || { F_allow: 5000, M_allow: 3000 };
    const resultantForce = Math.sqrt(Fx * Fx + Fy * Fy + Fz * Fz);
    const resultantMoment = Math.sqrt(Mx * Mx + My * My + Mz * Mz);

    const forceRatio = resultantForce / limits.F_allow;
    const momentRatio = resultantMoment / limits.M_allow;

    return {
      nps,
      resultantForce_N: Math.round(resultantForce),
      allowableForce_N: limits.F_allow,
      forceRatio: Math.round(forceRatio * 1000) / 1000,
      resultantMoment_Nm: Math.round(resultantMoment),
      allowableMoment_Nm: limits.M_allow,
      momentRatio: Math.round(momentRatio * 1000) / 1000,
      pass: forceRatio <= 1.0 && momentRatio <= 1.0,
      standard: 'API 610 Table 5'
    };
  }

  /**
   * Selects standard variable or constant effort spring hanger based on vertical thermal movement.
   * @param {Object} support
   * @param {number} support.operatingLoad_N Operating hot load (N)
   * @param {number} support.verticalTravel_mm Vertical thermal displacement (mm) (+ is up, - is down)
   * @returns {Object} Spring hanger specification
   */
  selectSpringHanger(support) {
    const { operatingLoad_N, verticalTravel_mm } = support;
    const absTravel = Math.abs(verticalTravel_mm);

    // If travel <= 50mm, variable spring is suitable (max 25% load variability).
    // If travel > 50mm, constant effort support is required per MSS SP-58.
    const type = absTravel <= 50.0 ? 'Variable Effort Spring Hanger' : 'Constant Effort Support';
    const variability = absTravel <= 50.0 ? Math.min((absTravel / 50.0) * 0.25, 0.25) : 0.0;
    const coldLoad_N = operatingLoad_N * (1.0 + (verticalTravel_mm > 0 ? -variability : variability));

    return {
      type,
      operatingLoad_N,
      coldLoad_N: Math.round(coldLoad_N),
      verticalTravel_mm,
      travelDirection: verticalTravel_mm >= 0 ? 'UP' : 'DOWN',
      variabilityPercent: Math.round(variability * 1000) / 10,
      standard: 'MSS SP-58 / ASME B31.3'
    };
  }
}

/**
 * ASME B31.3 Table D300 elbow characteristics in positional form.
 * @param {number} t Nominal wall thickness (any length unit)
 * @param {number} R1 Bend radius (same unit)
 * @param {number} r2 Mean cross-section radius (same unit)
 * @returns {{h:number,k:number,ii:number,io:number,i_i:number,i_o:number}}
 */
function computeElbowFactors(t, R1, r2) {
  if (!(t > 0) || !(R1 > 0) || !(r2 > 0)) {
    throw new Error('computeElbowFactors: t, R1 and r2 must be positive finite numbers.');
  }
  const h = (t * R1) / (r2 * r2);
  const k = Math.max(1.65 / h, 1.0);
  const ii = Math.max(0.9 / Math.pow(h, 2 / 3), 1.0);
  const io = Math.max(0.75 / Math.pow(h, 2 / 3), 1.0);
  return { h, k, ii, io, i_i: ii, i_o: io };
}

// ---------------------------------------------------------------------------
// Small dense linear-algebra helpers for the frame solver
// ---------------------------------------------------------------------------
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(a) {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
}

function solveDense(A, b, n) {
  const a = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    let best = Math.abs(a[col * n + col]);
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs(a[r * n + col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-300) throw new Error('PipingStressCaesarEngine: singular stiffness matrix (insufficient restraint).');
    if (piv !== col) {
      for (let j = 0; j < n; j += 1) {
        const tmp = a[col * n + j]; a[col * n + j] = a[piv * n + j]; a[piv * n + j] = tmp;
      }
      const tb = x[col]; x[col] = x[piv]; x[piv] = tb;
    }
    const d = a[col * n + col];
    for (let r = col + 1; r < n; r += 1) {
      const f = a[r * n + col] / d;
      if (f === 0) continue;
      for (let j = col; j < n; j += 1) a[r * n + j] -= f * a[col * n + j];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = x[r];
    for (let j = r + 1; j < n; j += 1) s -= a[r * n + j] * x[j];
    x[r] = s / a[r * n + r];
  }
  return x;
}

/** Local 12x12 Euler-Bernoulli space-frame stiffness (local x = member axis). */
function localFrameStiffness(EA, GJ, EIy, EIz, L) {
  const k = new Float64Array(144);
  const put = (r, c, v) => { k[r * 12 + c] += v; if (r !== c) k[c * 12 + r] += v; };
  const L2 = L * L;
  const L3 = L2 * L;
  // axial
  put(0, 0, EA / L); put(0, 6, -EA / L); put(6, 6, EA / L);
  // torsion
  put(3, 3, GJ / L); put(3, 9, -GJ / L); put(9, 9, GJ / L);
  // bending in local x-y plane (about local z): dofs v=1,7  rz=5,11
  put(1, 1, 12 * EIz / L3); put(1, 5, 6 * EIz / L2); put(1, 7, -12 * EIz / L3); put(1, 11, 6 * EIz / L2);
  put(5, 5, 4 * EIz / L); put(5, 7, -6 * EIz / L2); put(5, 11, 2 * EIz / L);
  put(7, 7, 12 * EIz / L3); put(7, 11, -6 * EIz / L2); put(11, 11, 4 * EIz / L);
  // bending in local x-z plane (about local y): dofs w=2,8  ry=4,10
  put(2, 2, 12 * EIy / L3); put(2, 4, -6 * EIy / L2); put(2, 8, -12 * EIy / L3); put(2, 10, -6 * EIy / L2);
  put(4, 4, 4 * EIy / L); put(4, 8, 6 * EIy / L2); put(4, 10, 2 * EIy / L);
  put(8, 8, 12 * EIy / L3); put(8, 10, 6 * EIy / L2); put(10, 10, 4 * EIy / L);
  return k;
}

/**
 * General 3D beam finite-element piping flexibility and B31.3 code stress engine.
 *
 * Model assumptions (stated, not hidden):
 *  - Euler-Bernoulli 12-DOF space-frame elements, linear elastic, small displacement.
 *  - Elbows are modelled as chord elements whose bending stiffness is reduced by the
 *    B31.3 Table D300 flexibility factor k (EI/k); in-plane SIF i_i and out-of-plane
 *    SIF i_o are applied in the stress recovery.
 *  - Load case: displacement range (thermal dT plus prescribed displacements).
 *  - S_L uses the longitudinal pressure stress P*Do/(4t) only (no deadweight case).
 *  - S_E = sqrt((i_i M_i)^2 + (i_o M_o)^2 + M_t^2) / Z  (B31.3 eq. 17 with S_t = M_t/2Z).
 *  - S_A = f [1.25 (S_c + S_h) - S_L]  (B31.3 eq. 1b), f = 1.0 unless supplied.
 */
class PipingStressCaesarEngine {
  /**
   * @param {Object} cfg
   * @param {{outerDiameterMm:number, wallThicknessMm:number, corrosionAllowanceMm?:number}} cfg.pipe
   * @param {{youngsModulusGPa:number, thermalExpansionPerK:number, scMPa:number, shMPa:number, poissonRatio?:number}} cfg.material
   * @param {number} [cfg.deltaTK=0] Uniform temperature change (K)
   * @param {number} [cfg.designPressureBar=0]
   * @param {number} [cfg.cyclicFactorF=1.0]
   * @param {Array<{id:string,x:number,y:number,z:number}>} cfg.nodes Coordinates in metres
   * @param {Array<{id:string,start:string,end:string,type:'straight'|'elbow',bendRadiusMm?:number,planeNormal?:number[]}>} cfg.members
   * @param {Array<{node:string,dx?:number,dy?:number,dz?:number,rx?:number,ry?:number,rz?:number}>} cfg.constraints
   */
  static analyze(cfg) {
    const { pipe, material } = cfg;
    const deltaT = cfg.deltaTK || 0;
    const E = material.youngsModulusGPa * 1e9;
    const nu = material.poissonRatio !== undefined ? material.poissonRatio : 0.3;
    const G = E / (2 * (1 + nu));
    const alpha = material.thermalExpansionPerK;
    const Do = pipe.outerDiameterMm / 1000;
    const t = pipe.wallThicknessMm / 1000;
    const Di = Do - 2 * t;
    const A = (Math.PI * (Do * Do - Di * Di)) / 4;
    const I = (Math.PI * (Math.pow(Do, 4) - Math.pow(Di, 4))) / 64;
    const J = 2 * I;
    const Z = I / (Do / 2);
    const r2Mm = (pipe.outerDiameterMm - pipe.wallThicknessMm) / 2;

    const P = (cfg.designPressureBar || 0) * 1e5;
    const SL = (P * Do) / (4 * t);
    const f = cfg.cyclicFactorF !== undefined ? cfg.cyclicFactorF : 1.0;
    const SA = f * (1.25 * (material.scMPa + material.shMPa) * 1e6 - SL);

    const nodeIndex = new Map();
    cfg.nodes.forEach((n, i) => nodeIndex.set(n.id, i));
    const nDof = cfg.nodes.length * 6;
    const K = new Float64Array(nDof * nDof);
    const F = new Float64Array(nDof);

    const elems = cfg.members.map((m) => {
      const a = cfg.nodes[nodeIndex.get(m.start)];
      const b = cfg.nodes[nodeIndex.get(m.end)];
      if (!a || !b) throw new Error(`Member ${m.id} references unknown node.`);
      const d = [b.x - a.x, b.y - a.y, b.z - a.z];
      const L = Math.hypot(d[0], d[1], d[2]);
      if (!(L > 0)) throw new Error(`Member ${m.id} has zero length.`);
      const ex = [d[0] / L, d[1] / L, d[2] / L];
      let ref = m.planeNormal ? m.planeNormal.slice() : [0, 0, 1];
      const dot = ref[0] * ex[0] + ref[1] * ex[1] + ref[2] * ex[2];
      let ez = [ref[0] - dot * ex[0], ref[1] - dot * ex[1], ref[2] - dot * ex[2]];
      if (Math.hypot(ez[0], ez[1], ez[2]) < 1e-9) {
        ref = [0, 1, 0];
        const d2 = ex[1];
        ez = [-d2 * ex[0], 1 - d2 * ex[1], -d2 * ex[2]];
      }
      ez = norm3(ez);
      const ey = cross3(ez, ex);
      const R = [ex, ey, ez]; // rows: local axes in global

      let factors = { k: 1, ii: 1, io: 1, h: null };
      if (m.type === 'elbow') {
        const Rmm = m.bendRadiusMm !== undefined ? m.bendRadiusMm : 1.5 * pipe.outerDiameterMm;
        factors = computeElbowFactors(pipe.wallThicknessMm, Rmm, r2Mm);
      }
      const EIb = (E * I) / factors.k;
      const kL = localFrameStiffness(E * A, G * J, EIb, EIb, L);

      // T (12x12) block diagonal of R
      const T = new Float64Array(144);
      for (let blk = 0; blk < 4; blk += 1) {
        for (let r = 0; r < 3; r += 1) {
          for (let c = 0; c < 3; c += 1) T[(blk * 3 + r) * 12 + blk * 3 + c] = R[r][c];
        }
      }
      // kG = T^T kL T
      const tmp = new Float64Array(144);
      for (let r = 0; r < 12; r += 1) {
        for (let c = 0; c < 12; c += 1) {
          let s = 0;
          for (let q = 0; q < 12; q += 1) s += kL[r * 12 + q] * T[q * 12 + c];
          tmp[r * 12 + c] = s;
        }
      }
      const kG = new Float64Array(144);
      for (let r = 0; r < 12; r += 1) {
        for (let c = 0; c < 12; c += 1) {
          let s = 0;
          for (let q = 0; q < 12; q += 1) s += T[q * 12 + r] * tmp[q * 12 + c];
          kG[r * 12 + c] = s;
        }
      }
      const i0 = nodeIndex.get(m.start) * 6;
      const j0 = nodeIndex.get(m.end) * 6;
      const map = (q) => (q < 6 ? i0 + q : j0 + q - 6);
      for (let r = 0; r < 12; r += 1) {
        for (let c = 0; c < 12; c += 1) K[map(r) * nDof + map(c)] += kG[r * 12 + c];
      }
      // Thermal equivalent nodal load (free expansion restrained)
      const Pth = E * A * alpha * deltaT;
      const fL = new Float64Array(12);
      fL[0] = -Pth; fL[6] = Pth;
      for (let r = 0; r < 12; r += 1) {
        let s = 0;
        for (let q = 0; q < 12; q += 1) s += T[q * 12 + r] * fL[q];
        F[map(r)] += s;
      }
      return { m, L, T, kL, fL, map, factors };
    });

    // Prescribed DOFs
    const names = ['dx', 'dy', 'dz', 'rx', 'ry', 'rz'];
    const prescribed = new Map();
    (cfg.constraints || []).forEach((c) => {
      const base = nodeIndex.get(c.node) * 6;
      names.forEach((nm, d) => {
        if (c[nm] !== undefined && c[nm] !== null) prescribed.set(base + d, c[nm]);
      });
    });

    const Kmod = Float64Array.from(K);
    const rhs = Float64Array.from(F);
    for (const [dof, val] of prescribed) {
      for (let j = 0; j < nDof; j += 1) if (j !== dof) rhs[j] -= Kmod[j * nDof + dof] * val;
      for (let j = 0; j < nDof; j += 1) { Kmod[dof * nDof + j] = 0; Kmod[j * nDof + dof] = 0; }
      Kmod[dof * nDof + dof] = 1;
      rhs[dof] = val;
    }
    const u = solveDense(Kmod, rhs, nDof);

    const reactions = {};
    for (const [dof] of prescribed) {
      let r = -F[dof];
      for (let j = 0; j < nDof; j += 1) r += K[dof * nDof + j] * u[j];
      const id = cfg.nodes[Math.floor(dof / 6)].id;
      if (!reactions[id]) reactions[id] = [0, 0, 0, 0, 0, 0];
      reactions[id][dof % 6] = r;
    }

    let overall = true;
    const members = elems.map((e) => {
      const ug = new Float64Array(12);
      for (let q = 0; q < 12; q += 1) ug[q] = u[e.map(q)];
      const ul = new Float64Array(12);
      for (let r = 0; r < 12; r += 1) {
        let s = 0;
        for (let q = 0; q < 12; q += 1) s += e.T[r * 12 + q] * ug[q];
        ul[r] = s;
      }
      const fl = new Float64Array(12);
      for (let r = 0; r < 12; r += 1) {
        let s = 0;
        for (let q = 0; q < 12; q += 1) s += e.kL[r * 12 + q] * ul[q];
        fl[r] = s - e.fL[r];
      }
      // End moments: torsion (3,9), out-of-plane about local y (4,10), in-plane about local z (5,11)
      let worst = { se: -1, mi: 0, mo: 0, mt: 0 };
      [0, 6].forEach((o) => {
        const mt = Math.abs(fl[o + 3]);
        const mo = Math.abs(fl[o + 4]);
        const mi = Math.abs(fl[o + 5]);
        const se = Math.sqrt(Math.pow(e.factors.ii * mi, 2) + Math.pow(e.factors.io * mo, 2) + mt * mt) / Z;
        if (se > worst.se) worst = { se, mi, mo, mt };
      });
      const verdict = worst.se <= SA;
      if (!verdict) overall = false;
      return {
        id: e.m.id,
        type: e.m.type,
        lengthM: e.L,
        axialForceN: Math.max(Math.abs(fl[0]), Math.abs(fl[6])),
        torsionMomentNm: worst.mt,
        inPlaneMomentNm: worst.mi,
        outOfPlaneMomentNm: worst.mo,
        h: e.factors.h,
        k: e.factors.k,
        ii: e.factors.ii,
        io: e.factors.io,
        displacementStressRangeSE_MPa: worst.se / 1e6,
        allowableDisplacementSA_MPa: SA / 1e6,
        sustainedPressureSL_MPa: SL / 1e6,
        codeVerdict: verdict
      };
    });

    const displacements = {};
    cfg.nodes.forEach((n, i) => { displacements[n.id] = Array.from(u.slice(i * 6, i * 6 + 6)); });

    return {
      success: true,
      code: 'ASME B31.3 (displacement range, eq. 17 / 1b)',
      section: { areaM2: A, inertiaM4: I, sectionModulusM3: Z },
      displacements,
      reactions,
      members,
      overallCodeCompliance: overall
    };
  }
}

module.exports = {
  PipingFlexibilityCharacteristics,
  PipingStressEngine,
  PipingStressCaesarEngine,
  computeElbowFactors
};
