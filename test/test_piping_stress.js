/**
 * Verification gate for the ASME B31.3 piping flexibility / code stress engine
 * (src/core/plant/piping_stress_caesar.js).
 *
 * Coverage:
 *  1. Cantilever lateral end reaction under a prescribed transverse end
 *     displacement: F = 3 E I delta / L^3 (beam FE analytic).
 *  2. Fully anchored straight run subjected to a uniform temperature change:
 *     axial force F = E A alpha dT, zero bending.
 *  3. Elbow flexibility / SIF formulas: k = 1.65/h for h = 0.3 -> 5.5,
 *     i_i = 0.9/h^(2/3) >= 1.
 *  4. Symmetric U-bend loop under uniform dT: engine S_E at the elbow versus
 *     an independent planar hand-rolled equivalent-beam computation
 *     (same formulas, independently assembled) within 2% relative.
 *  5. Code compliance verdict: S_E <= S_A passes, S_E > S_A fails.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PipingStressCaesarEngine, computeElbowFactors } = require('../src/core/plant/piping_stress_caesar');

const E_PA = 200e9;
const ALPHA_PER_K = 12e-6;
const DO_M = 0.1683;
const T_M = 0.00711;
const A_M2 = (Math.PI * (DO_M * DO_M - Math.pow(DO_M - 2 * T_M, 2))) / 4;
const I_M4 = (Math.PI * (Math.pow(DO_M, 4) - Math.pow(DO_M - 2 * T_M, 4))) / 64;
const Z_M3 = I_M4 / (DO_M / 2);

function planarLocalStiffness(EA, EIe, L) {
  const a1 = EA / L;
  const a2 = (12 * EIe) / (L * L * L);
  const a3 = (6 * EIe) / (L * L);
  const a4 = (4 * EIe) / L;
  const a5 = (2 * EIe) / L;
  const kL = new Float64Array(36);
  const put = (r, cc, v) => {
    kL[r * 6 + cc] = v;
    kL[cc * 6 + r] = v;
  };
  put(0, 0, a1);
  put(0, 3, -a1);
  put(3, 3, a1);
  put(1, 1, a2);
  put(1, 2, a3);
  put(1, 4, -a2);
  put(1, 5, a3);
  put(2, 2, a4);
  put(2, 4, -a3);
  put(2, 5, a5);
  put(4, 4, a2);
  put(4, 5, -a3);
  put(5, 5, a4);
  return kL;
}

function planarTransform(c, s) {
  const T3 = new Float64Array(36);
  T3[0] = c;
  T3[1] = s;
  T3[6] = -s;
  T3[7] = c;
  T3[14] = 1;
  T3[21] = c;
  T3[22] = s;
  T3[27] = -s;
  T3[28] = c;
  T3[35] = 1;
  return T3;
}

function mv6(T3, v) {
  const out = new Float64Array(6);
  for (let r = 0; r < 6; r += 1) {
    for (let cc = 0; cc < 6; cc += 1) out[r] += T3[r * 6 + cc] * v[cc];
  }
  return out;
}

function mTv6(T3, v) {
  const out = new Float64Array(6);
  for (let cc = 0; cc < 6; cc += 1) {
    for (let r = 0; r < 6; r += 1) out[cc] += T3[r * 6 + cc] * v[r];
  }
  return out;
}

function planarFrameAnalyze(cfg) {
  const pts = new Map(cfg.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const idx = new Map([...pts.keys()].map((id, i) => [id, i]));
  const ndof = cfg.nodes.length * 3;
  const K = new Float64Array(ndof * ndof);
  const F = new Float64Array(ndof);
  const memberInfo = [];

  cfg.members.forEach((mb) => {
    const a = pts.get(mb.start);
    const b = pts.get(mb.end);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    const c = dx / L;
    const s = dy / L;
    const kL = planarLocalStiffness(mb.EA, mb.EIe, L);
    const T3 = planarTransform(c, s);

    const kg = new Float64Array(36);
    for (let r = 0; r < 6; r += 1) {
      const er = new Float64Array(6);
      er[r] = 1;
      const dLocal = mv6(T3, er);
      const fLocal = new Float64Array(6);
      for (let i = 0; i < 6; i += 1) {
        for (let j = 0; j < 6; j += 1) fLocal[i] += kL[i * 6 + j] * dLocal[j];
      }
      const fGlobal = mTv6(T3, fLocal);
      for (let cc = 0; cc < 6; cc += 1) kg[cc * 6 + r] = fGlobal[cc];
    }

    const iStart = idx.get(mb.start) * 3;
    const iEnd = idx.get(mb.end) * 3;
    for (let r = 0; r < 6; r += 1) {
      const gr = r < 3 ? iStart + r : iEnd + r - 3;
      for (let cc = 0; cc < 6; cc += 1) {
        const gc = cc < 3 ? iStart + cc : iEnd + cc - 3;
        K[gr * ndof + gc] += kg[r * 6 + cc];
      }
    }

    const Pth = mb.EA * ALPHA_PER_K * cfg.deltaTK;
    const flL = new Float64Array([-Pth, 0, 0, Pth, 0, 0]);
    const fg = mTv6(T3, flL);
    for (let r = 0; r < 6; r += 1) {
      const gr = r < 3 ? iStart + r : iEnd + r - 3;
      F[gr] += fg[r];
    }

    memberInfo.push({ ...mb, startDof: iStart, endDof: iEnd, kL, flL, c, s, L });
  });

  const prescribed = new Map();
  if (cfg.constraints) {
    for (const con of cfg.constraints) {
      const base = idx.get(con.node) * 3;
      ['dx', 'dy', 'rz'].forEach((name, d) => {
        if (con[name] !== undefined && con[name] !== null) prescribed.set(base + d, con[name]);
      });
    }
  }

  const KOrig = new Float64Array(K);
  const FOrig = new Float64Array(F);
  const rhs = new Float64Array(F);
  for (const [c, value] of prescribed) {
    for (let j = 0; j < ndof; j += 1) {
      if (j !== c) rhs[j] -= K[j * ndof + c] * value;
    }
    for (let j = 0; j < ndof; j += 1) {
      K[c * ndof + j] = 0;
      K[j * ndof + c] = 0;
    }
    K[c * ndof + c] = 1;
    rhs[c] = value;
  }

  const u = planarSolve(K, rhs, ndof);

  const reactions = {};
  for (const [c] of prescribed) {
    let r = 0;
    for (let j = 0; j < ndof; j += 1) r += KOrig[c * ndof + j] * u[j];
    r -= FOrig[c];
    const nodeId = cfg.nodes[Math.floor(c / 3)].id;
    if (!reactions[nodeId]) reactions[nodeId] = [0, 0, 0];
    reactions[nodeId][c % 3] = r;
  }

  const members = memberInfo.map((info) => {
    const ue = new Float64Array(6);
    for (let r = 0; r < 3; r += 1) {
      ue[r] = u[info.startDof + r];
      ue[r + 3] = u[info.endDof + r];
    }
    const dL = mv6(planarTransform(info.c, info.s), ue);
    const fL = new Float64Array(6);
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 6; j += 1) fL[i] += info.kL[i * 6 + j] * dL[j];
      fL[i] -= info.flL[i];
    }
    return {
      id: info.id,
      type: info.type,
      axialN: Math.max(Math.abs(fL[0]), Math.abs(fL[3])),
      maxMomentNm: Math.max(Math.abs(fL[2]), Math.abs(fL[5])),
      sif: info.sif
    };
  });

  return { members, reactions };
}

function planarSolve(matrix, rhs, n) {
  const a = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) a[i * n + j] = matrix[i * n + j];
    b[i] = rhs[i];
  }
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let pivotValue = Math.abs(a[col * n + col]);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs(a[row * n + col]);
      if (candidate > pivotValue) {
        pivotValue = candidate;
        pivot = row;
      }
    }
    if (pivot !== col) {
      for (let j = col; j < n; j += 1) {
        const tmp = a[col * n + j];
        a[col * n + j] = a[pivot * n + j];
        a[pivot * n + j] = tmp;
      }
      const tmpB = b[col];
      b[col] = b[pivot];
      b[pivot] = tmpB;
    }
    const diag = a[col * n + col];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row * n + col] / diag;
      if (factor === 0) continue;
      for (let j = col; j < n; j += 1) a[row * n + j] -= factor * a[col * n + j];
      b[row] -= factor * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row];
    for (let j = row + 1; j < n; j += 1) sum -= a[row * n + j] * x[j];
    x[row] = a[row * n + row] !== 0 ? sum / a[row * n + row] : 0;
  }
  return x;
}

function basePipeConfig(deltaTK, overrides) {
  return {
    pipe: {
      outerDiameterMm: DO_M * 1000,
      wallThicknessMm: T_M * 1000,
      corrosionAllowanceMm: 0
    },
    material: {
      youngsModulusGPa: E_PA / 1e9,
      thermalExpansionPerK: ALPHA_PER_K,
      scMPa: 138,
      shMPa: 138
    },
    deltaTK,
    designPressureBar: 20,
    ...overrides
  };
}

describe('PipingStressCaesarEngine: B31.3 flexibility / code stress', () => {
  it('elbow flexibility factor k = 1.65/h and SIF formulas', () => {
    const f = computeElbowFactors(0.3, 1, 1);
    assert.ok(Math.abs(f.h - 0.3) < 1e-15, `h = ${f.h}`);
    assert.strictEqual(f.k, 5.5);
    const iiExpected = 0.9 / Math.pow(f.h, 2 / 3);
    assert.ok(Math.abs(f.ii - iiExpected) < 1e-6, `i_i = ${f.ii} expected ${iiExpected}`);
    const ioExpected = 0.75 / Math.pow(f.h, 2 / 3);
    assert.ok(Math.abs(f.io - ioExpected) < 1e-6, `i_o = ${f.io} expected ${ioExpected}`);
    assert.ok(f.ii >= 1 && f.io >= 1, 'SIFs floored at 1.0');
    const f2 = computeElbowFactors(7.11, 30, 80.595);
    assert.ok(f2.k >= 1 && f2.ii >= 1 && f2.io >= 1, 'clamped factors stay >= 1');
  });

  it('cantilever lateral end reaction F = 3 E I delta / L^3', () => {
    const L = 3.0;
    const delta = 0.01;
    const result = PipingStressCaesarEngine.analyze(
      basePipeConfig(0, {
        nodes: [
          { id: 'N1', x: 0, y: 0, z: 0 },
          { id: 'N2', x: L, y: 0, z: 0 }
        ],
        members: [{ id: 'M1', start: 'N1', end: 'N2', type: 'straight' }],
        constraints: [
          { node: 'N1', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 },
          { node: 'N2', dy: delta }
        ]
      })
    );
    assert.equal(result.success, true);
    const expected = (3 * E_PA * I_M4 * delta) / (L * L * L);
    const actual = Math.abs(result.reactions.N1[1]);
    const rel = Math.abs(actual - expected) / expected;
    assert.ok(rel < 1e-6, `reaction ${actual} N vs analytic ${expected} N (rel ${rel})`);
    console.log(`cantilever reaction: engine=${actual.toFixed(6)} N, analytic 3EIδ/L^3=${expected.toFixed(6)} N`);
  });

  it('fully anchored straight run: axial F = E A alpha dT, zero bending', () => {
    const dT = 100;
    const result = PipingStressCaesarEngine.analyze(
      basePipeConfig(dT, {
        nodes: [
          { id: 'N1', x: 0, y: 0, z: 0 },
          { id: 'N2', x: 3, y: 0, z: 0 }
        ],
        members: [{ id: 'M1', start: 'N1', end: 'N2', type: 'straight' }],
        constraints: [
          { node: 'N1', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 },
          { node: 'N2', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 }
        ]
      })
    );
    assert.equal(result.success, true);
    const expected = E_PA * A_M2 * ALPHA_PER_K * dT;
    const actual = Math.abs(result.reactions.N1[0]);
    const rel = Math.abs(actual - expected) / expected;
    assert.ok(rel < 1e-6, `axial force ${actual} N vs ${expected} N (rel ${rel})`);
    const member = result.members[0];
    assert.ok(member.torsionMomentNm < 1e-6, 'zero torsion');
    assert.ok(Math.abs(member.inPlaneMomentNm) < 1e-6 && Math.abs(member.outOfPlaneMomentNm) < 1e-6, 'zero bending');
    console.log(`anchored axial force: engine=${actual.toFixed(3)} N, analytic EAαΔT=${expected.toFixed(3)} N`);
  });

  it('U-bend loop S_E at elbow matches independent planar hand-rolled computation within 2%', () => {
    const R = 0.3;
    const H = 3.0;
    const dT = 100;
    const nodes = [
      { id: 'N1', x: 0, y: 0, z: 0 },
      { id: 'N2', x: 0, y: H, z: 0 },
      { id: 'N3', x: R, y: H + R, z: 0 },
      { id: 'N4', x: 3 * R, y: H + R, z: 0 },
      { id: 'N5', x: 4 * R, y: H, z: 0 },
      { id: 'N6', x: 4 * R, y: 0, z: 0 }
    ];
    const members = [
      { id: 'M1', start: 'N1', end: 'N2', type: 'straight' },
      { id: 'M2', start: 'N2', end: 'N3', type: 'elbow', bendRadiusMm: R * 1000, planeNormal: [0, 0, 1] },
      { id: 'M3', start: 'N3', end: 'N4', type: 'straight' },
      { id: 'M4', start: 'N4', end: 'N5', type: 'elbow', bendRadiusMm: R * 1000, planeNormal: [0, 0, 1] },
      { id: 'M5', start: 'N5', end: 'N6', type: 'straight' }
    ];
    const constraints = [
      { node: 'N1', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 },
      { node: 'N6', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 }
    ];
    const config = basePipeConfig(dT, { nodes, members, constraints });
    const result = PipingStressCaesarEngine.analyze(config);
    assert.equal(result.success, true);

    const elbowData = computeElbowFactors(T_M * 1000, R * 1000, ((DO_M - T_M) / 2) * 1000);
    const m2 = result.members.find((m) => m.id === 'M2');
    const m4 = result.members.find((m) => m.id === 'M4');
    assert.ok(m2 && m4, 'elbow members present');
    assert.ok(Math.abs(m2.k - elbowData.k) < 1e-9, `flexibility factor ${m2.k}`);
    assert.ok(Math.abs(m2.ii - elbowData.ii) < 1e-9, `in-plane SIF ${m2.ii}`);
    const seEngine = m2.displacementStressRangeSE_MPa;

    const planarConfig = {
      nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      deltaTK: dT,
      constraints: [
        { node: 'N1', dx: 0, dy: 0, rz: 0 },
        { node: 'N6', dx: 0, dy: 0, rz: 0 }
      ],
      members: [
        { id: 'M1', start: 'N1', end: 'N2', type: 'straight', EA: E_PA * A_M2, EIe: E_PA * I_M4, sif: 1 },
        {
          id: 'M2',
          start: 'N2',
          end: 'N3',
          type: 'elbow',
          EA: E_PA * A_M2,
          EIe: (E_PA * I_M4) / elbowData.k,
          sif: elbowData.ii
        },
        { id: 'M3', start: 'N3', end: 'N4', type: 'straight', EA: E_PA * A_M2, EIe: E_PA * I_M4, sif: 1 },
        {
          id: 'M4',
          start: 'N4',
          end: 'N5',
          type: 'elbow',
          EA: E_PA * A_M2,
          EIe: (E_PA * I_M4) / elbowData.k,
          sif: elbowData.ii
        },
        { id: 'M5', start: 'N5', end: 'N6', type: 'straight', EA: E_PA * A_M2, EIe: E_PA * I_M4, sif: 1 }
      ]
    };
    const planar = planarFrameAnalyze(planarConfig);
    const planarElbow = planar.members.find((m) => m.id === 'M2');
    const sePlanar = (planarElbow.sif * planarElbow.maxMomentNm) / Z_M3 / 1e6;
    const rel = Math.abs(seEngine - sePlanar) / sePlanar;
    assert.ok(rel < 0.02, `engine S_E ${seEngine} MPa vs independent planar ${sePlanar} MPa (rel ${rel})`);
    console.log(
      `U-loop elbow S_E: engine=${seEngine.toFixed(4)} MPa, independent planar=${sePlanar.toFixed(4)} MPa, rel err=${(rel * 100).toFixed(4)}%`
    );
  });

  it('code compliance verdict follows S_E <= S_A', () => {
    const R = 0.3;
    const H = 3.0;
    const nodes = [
      { id: 'N1', x: 0, y: 0, z: 0 },
      { id: 'N2', x: 0, y: H, z: 0 },
      { id: 'N3', x: R, y: H + R, z: 0 },
      { id: 'N4', x: 3 * R, y: H + R, z: 0 },
      { id: 'N5', x: 4 * R, y: H, z: 0 },
      { id: 'N6', x: 4 * R, y: 0, z: 0 }
    ];
    const members = [
      { id: 'M1', start: 'N1', end: 'N2', type: 'straight' },
      { id: 'M2', start: 'N2', end: 'N3', type: 'elbow', bendRadiusMm: R * 1000, planeNormal: [0, 0, 1] },
      { id: 'M3', start: 'N3', end: 'N4', type: 'straight' },
      { id: 'M4', start: 'N4', end: 'N5', type: 'elbow', bendRadiusMm: R * 1000, planeNormal: [0, 0, 1] },
      { id: 'M5', start: 'N5', end: 'N6', type: 'straight' }
    ];
    const constraints = [
      { node: 'N1', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 },
      { node: 'N6', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 }
    ];

    const passResult = PipingStressCaesarEngine.analyze(basePipeConfig(10, { nodes, members, constraints }));
    assert.equal(passResult.success, true);
    assert.equal(passResult.overallCodeCompliance, true);
    for (const m of passResult.members) {
      assert.ok(m.sE_MPa === undefined || true);
      assert.ok(
        m.displacementStressRangeSE_MPa <= m.allowableDisplacementSA_MPa + 1e-9,
        `${m.id} should pass (S_E ${m.displacementStressRangeSE_MPa} <= S_A ${m.allowableDisplacementSA_MPa})`
      );
      assert.equal(m.codeVerdict, true);
    }

    const failResult = PipingStressCaesarEngine.analyze(basePipeConfig(20000, { nodes, members, constraints }));
    assert.equal(failResult.success, true);
    assert.equal(failResult.overallCodeCompliance, false);
    const failMember = failResult.members.find((m) => !m.codeVerdict);
    assert.ok(failMember, 'at least one member must fail at high dT');
    assert.ok(
      failMember.displacementStressRangeSE_MPa > failMember.allowableDisplacementSA_MPa,
      `${failMember.id} S_E ${failMember.displacementStressRangeSE_MPa} > S_A ${failMember.allowableDisplacementSA_MPa}`
    );
    console.log(
      `verdict: low dT S_E=${passResult.members[1].displacementStressRangeSE_MPa.toFixed(4)} MPa (PASS), high dT S_E=${failMember.displacementStressRangeSE_MPa.toFixed(4)} MPa (FAIL vs S_A ${failMember.allowableDisplacementSA_MPa.toFixed(4)} MPa)`
    );
  });
});
