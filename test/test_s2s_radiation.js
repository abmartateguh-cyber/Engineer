/**
 * Test Suite: RadiationS2SViewFactors (surface-to-surface view factors and
 * diffuse-gray radiosity). Deterministic; uses only node:test/assert.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RadiationS2SViewFactors, SIGMA } = require('../src/core/cae/radiation_s2s_view_factors');

function unitCubeFaces() {
  return [
    {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0]
      ],
      normal: [0, 0, 1]
    },
    {
      vertices: [
        [0, 0, 1],
        [0, 1, 1],
        [1, 1, 1],
        [1, 0, 1]
      ],
      normal: [0, 0, -1]
    },
    {
      vertices: [
        [0, 0, 0],
        [0, 1, 0],
        [0, 1, 1],
        [0, 0, 1]
      ],
      normal: [-1, 0, 0]
    },
    {
      vertices: [
        [1, 0, 0],
        [1, 0, 1],
        [1, 1, 1],
        [1, 1, 0]
      ],
      normal: [1, 0, 0]
    },
    {
      vertices: [
        [0, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 0, 0]
      ],
      normal: [0, -1, 0]
    },
    {
      vertices: [
        [0, 1, 0],
        [1, 1, 0],
        [1, 1, 1],
        [0, 1, 1]
      ],
      normal: [0, 1, 0]
    }
  ];
}

test('RadiationS2SViewFactors: coaxial parallel disks F12 (R1=R2=1 m, L=1 m)', () => {
  const r1 = 1;
  const r2 = 1;
  const L = 1;
  const F12 = RadiationS2SViewFactors.viewFactorCoaxialDisks(r1, r2, L);
  // closed form: 0.5*[X - sqrt(X^2 - 4*(R2/R1)^2)], X = 1 + (1+R2^2)/R1^2
  const R1 = r1 / L;
  const R2 = r2 / L;
  const X = 1 + (1 + R2 * R2) / (R1 * R1);
  const analytic = 0.5 * (X - Math.sqrt(X * X - 4 * (R2 / R1) * (R2 / R1)));
  assert.ok(Math.abs(F12 - analytic) < 1e-12, `F12=${F12} must match closed form ${analytic}`);
  assert.ok(Math.abs(F12 - 0.382) < 1e-3, `F12=${F12} must be ~0.3820`);
});

test('RadiationS2SViewFactors: perpendicular 1x1 plates sharing an edge (F12 ~ 0.2000)', () => {
  const p1 = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1]
  ];
  const p2 = [
    [0, 0, 0],
    [0, 1, 0],
    [0, 1, 1],
    [0, 0, 1]
  ];
  const F12 = RadiationS2SViewFactors.viewFactorPolygons(p1, p2, {
    normal1: [0, 1, 0],
    normal2: [-1, 0, 0]
  });
  assert.ok(F12 > 0, `F12 must be positive, got ${F12}`);
  assert.ok(Math.abs(F12 - 0.2) < 1e-3, `F12=${F12} must be ~0.2000`);
});

test('RadiationS2SViewFactors: closed 6-face cube rows sum to 1 (1e-9)', () => {
  const F = RadiationS2SViewFactors.viewFactorMatrix(unitCubeFaces());
  let maxRowError = 0;
  for (let i = 0; i < 6; i++) {
    const rowSum = F[i].reduce((a, b) => a + b, 0);
    const err = Math.abs(rowSum - 1);
    maxRowError = Math.max(maxRowError, err);
    assert.ok(err < 1e-9, `row ${i} sum ${rowSum} must equal 1 (err ${err})`);
  }
  assert.ok(maxRowError < 1e-9, `max row-sum error ${maxRowError}`);
});

test('RadiationS2SViewFactors: reciprocity A_i F_ij = A_j F_ji (1e-6 relative)', () => {
  const faces = unitCubeFaces();
  const F = RadiationS2SViewFactors.viewFactorMatrix(faces);
  const A = faces.map((f) => (f.vertices.length ? 1 : f.area));
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const lhs = A[i] * F[i][j];
      const rhs = A[j] * F[j][i];
      const rel = Math.abs(lhs - rhs) / Math.max(Math.abs(lhs), Math.abs(rhs), 1e-30);
      assert.ok(rel < 1e-6, `A${i}F${i}${j}=${lhs} vs A${j}F${j}${i}=${rhs} rel ${rel}`);
    }
  }
});

function blackCubePatches(hotTemp, hotEmissivity) {
  const faces = unitCubeFaces();
  return faces.map((f, i) => ({
    vertices: f.vertices,
    normal: f.normal,
    area: 1,
    temperature: i === 0 ? hotTemp : 500,
    emissivity: i === 0 ? hotEmissivity : 1
  }));
}

test('RadiationS2SViewFactors: black uniform-T enclosure has zero net flux', () => {
  const patches = blackCubePatches(300, 1).map((p) => ({ ...p, temperature: 300 }));
  const res = RadiationS2SViewFactors.solveRadiosity(patches);
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(res.q[i]) < 1e-9, `q[${i}]=${res.q[i]} must be ~0`);
    assert.ok(Math.abs(res.netPower[i]) < 1e-9, `netPower[${i}] must be ~0`);
  }
});

test('RadiationS2SViewFactors: two-temperature black enclosure conserves energy', () => {
  const patches = blackCubePatches(1000, 1);
  const res = RadiationS2SViewFactors.solveRadiosity(patches);
  const hot = 0;
  const hotPower = res.netPower[hot];
  assert.ok(hotPower > 0, `hot wall net power ${hotPower} must be positive`);
  let coldSink = 0;
  for (let i = 1; i < 6; i++) coldSink += -res.netPower[i];
  assert.ok(Math.abs(coldSink - hotPower) < 1e-6 * hotPower, `hot ${hotPower} must equal cold sink ${coldSink}`);
  assert.ok(res.energyBalanceResidual < 1e-6 * hotPower, `energy balance residual ${res.energyBalanceResidual}`);
});

test('RadiationS2SViewFactors: gray hot wall reduces radiosity but keeps positive flux', () => {
  const patches = blackCubePatches(1000, 0.5);
  const res = RadiationS2SViewFactors.solveRadiosity(patches);
  const eb = SIGMA * Math.pow(1000, 4);
  assert.ok(res.J[0] < eb, `J_hot=${res.J[0]} must be < sigma T^4 = ${eb}`);
  assert.ok(res.J[0] > 0, `J_hot must be positive`);
  assert.ok(res.q[0] > 0, `q_hot=${res.q[0]} must be positive`);
  assert.ok(res.netPower[0] > 0, `hot wall net power must be positive`);
});

test('RadiationS2SViewFactors: linear system solve is deterministic and exact for identity', () => {
  const A = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  const b = [1, 2, 3];
  const x = RadiationS2SViewFactors._solveLinearSystem(A, b);
  assert.deepEqual(
    x.map((v) => Math.round(v * 1e12) / 1e12),
    [1, 2, 3]
  );
});
