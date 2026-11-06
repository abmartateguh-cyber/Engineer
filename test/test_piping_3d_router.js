'use strict';

/**
 * 3D piping autorouter verification gate.
 *
 * Verifies obstacle avoidance, axis-aligned 90°-only elbows, drain-slope
 * enforcement, rack-elevation preference, nozzle vertical stub, and
 * determinism.
 */

const assert = require('assert');
const { routePipe3D } = require('../src/core/plant/piping_network_3d_router');

let passed = 0;
let total = 0;

function check(name, condition, detail) {
  total++;
  try {
    assert(condition, detail);
    passed++;
    console.log(`  PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } catch (err) {
    console.log(`  FAIL ${name} [${detail}]`);
    throw err;
  }
}

const axisAlignedSegments = (path) => {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const nz = (a[0] !== b[0] ? 1 : 0) + (a[1] !== b[1] ? 1 : 0) + (a[2] !== b[2] ? 1 : 0);
    if (nz !== 1) return false;
  }
  return true;
};

const elbowCount = (path) => {
  let e = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const d1 = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]];
    const d2 = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1], path[i + 1][2] - path[i][2]];
    if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) > 1e-12) e++;
  }
  return e;
};

// --- 1. straight open route ---
{
  const r = routePipe3D({ start: [0, 0, 0], end: [10, 0, 0], grid: 1 });
  check('straight: route found', r.success === true, r.reason || '');
  check('straight: length 10', Math.abs(r.length - 10) < 1e-9, `${r.length}`);
  check('straight: zero elbows', r.elbows === 0, `${r.elbows}`);
}

// --- 2. obstacle detour ---
{
  const r = routePipe3D({
    start: [0, 0, 0],
    end: [10, 0, 0],
    grid: 1,
    clearance: 0.5,
    obstacles: [{ x0: 3, x1: 7, y0: -5, y1: 5, z0: -5, z1: 5 }]
  });
  check('detour: route found', r.success === true, r.reason || '');
  check('detour: length > direct 10', r.length > 10.5, `${r.length}`);
  check('detour: min clearance >= 0.5', r.minClearance >= 0.5 - 1e-9, `${r.minClearance}`);
  check('detour: axis-aligned segments', axisAlignedSegments(r.path));
  check('detour: has at least 2 elbows', r.elbows >= 2, `${r.elbows}`);
}

// --- 3. drain slope ---
{
  const r = routePipe3D({
    start: [0, 0, 5],
    end: [10, 0, 1],
    grid: 1,
    minSlope: 0.01 // 1:100
  });
  check('drain: route found', r.success === true, r.reason || '');
  check(
    'drain: z monotonic non-increasing',
    r.path.every((p, i) => i === 0 || p[2] <= r.path[i - 1][2] + 1e-12)
  );
  const drop = r.path[0][2] - r.path[r.path.length - 1][2];
  check('drain: total drop 4 m', Math.abs(drop - 4) < 1e-6, `${drop}`);
  check(
    'drain: slope satisfied (drop >= length/100)',
    drop >= r.length * 0.01 - 1e-9,
    `drop=${drop}, length=${r.length}`
  );
}

// --- 4. rack preference ---
{
  // obstacle forces a detour; a rack corridor at z=3 should be preferred
  const noRack = routePipe3D({
    start: [0, 0, 3],
    end: [10, 0, 3],
    grid: 1,
    obstacles: [{ x0: 4, x1: 6, y0: -10, y1: 10, z0: -10, z1: 10 }]
  });
  const withRack = routePipe3D({
    start: [0, 0, 3],
    end: [10, 0, 3],
    grid: 1,
    obstacles: [{ x0: 4, x1: 6, y0: -10, y1: 10, z0: -10, z1: 10 }],
    rackZ: 3,
    rackBonus: 0.5
  });
  check('rack: both routes found', noRack.success === true && withRack.success === true);
  // with rack bonus, the route should stay at z=3 and be shorter or equal
  const staysOnRack = withRack.path.every((p) => Math.abs(p[2] - 3) < 1e-9);
  check('rack: with bonus route stays at rack elevation', staysOnRack, JSON.stringify(withRack.path));
}

// --- 5. nozzle stub ---
{
  const r = routePipe3D({
    start: [0, 0, 0],
    end: [10, 0, 2],
    grid: 1,
    nozzleStub: 1
  });
  check('stub: route found', r.success === true, r.reason || '');
  const p0 = r.path[0];
  const p1 = r.path[1];
  check(
    'stub: first segment vertical',
    p0[0] === p1[0] && p0[1] === p1[1],
    `${JSON.stringify(p0)} -> ${JSON.stringify(p1)}`
  );
  check('stub: vertical stub length >= 1', Math.abs(p0[2] - p1[2]) >= 1 - 1e-9, `${Math.abs(p0[2] - p1[2])}`);
}

// --- 6. determinism ---
{
  const spec = {
    start: [0, 0, 0],
    end: [8, 4, 2],
    grid: 1,
    obstacles: [{ x0: 2, x1: 4, y0: 0, y1: 6, z0: -2, z1: 6 }]
  };
  const r1 = routePipe3D(spec);
  const r2 = routePipe3D(spec);
  check('determinism: identical paths', JSON.stringify(r1.path) === JSON.stringify(r2.path));
}

// --- 7. invalid inputs fail closed ---
{
  let threw = false;
  try {
    routePipe3D({ start: [0, 0], end: [1, 0, 0] });
  } catch (_) {
    threw = true;
  }
  check('invalid input throws', threw);
}

console.log(`\npiping_3d_router: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
