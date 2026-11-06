'use strict';

/**
 * PipingNetwork3DRouter: 3D orthogonal A* pipe router.
 *
 * Features:
 *  - Uniform 3D grid graph with 6-connected neighbors (axis-aligned legs only),
 *    so every turn is a 90° elbow (45° elbows are a downstream refinement).
 *  - Obstacle avoidance: axis-aligned box obstacles with a clearance buffer.
 *  - Gravity drainage slope: for drain lines, a minimum downward slope is
 *    enforced by a monotone-z constraint and an end-elevation check.
 *  - Rack elevation preference: a cost bonus at preferred z levels.
 *  - Nozzle stub: the path must leave the start nozzle vertically for a
 *    minimum stub length before any turn.
 *  - Deterministic tie-break (index order) for reproducible paths.
 */

'use strict';

function aabbOverlap(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0;
}

function pointInAABB(p, box, clearance) {
  return (
    p[0] > box.x0 - clearance &&
    p[0] < box.x1 + clearance &&
    p[1] > box.y0 - clearance &&
    p[1] < box.y1 + clearance &&
    p[2] > box.z0 - clearance &&
    p[2] < box.z1 + clearance
  );
}

function routePipe3D({
  start,
  end,
  obstacles = [],
  grid = 0.5,
  clearance = 0.3,
  minSlope = 0,
  rackZ = null,
  rackBonus = 0,
  nozzleStub = 0
}) {
  if (!Array.isArray(start) || start.length !== 3 || !Array.isArray(end) || end.length !== 3) {
    throw new TypeError('start and end must be [x,y,z] arrays.');
  }
  if (!(grid > 0) || !(clearance >= 0) || !(minSlope >= 0) || !(nozzleStub >= 0)) {
    throw new TypeError('grid, clearance, minSlope, nozzleStub must be non-negative finite numbers.');
  }

  // Snap start/end to the grid
  const snap = (p) => p.map((v) => Math.round(v / grid) * grid);
  const S = snap(start);
  const E = snap(end);

  // A* over grid nodes (sparse visited map keyed by "x,y,z" indices)
  const idx = (p) => `${p[0]},${p[1]},${p[2]}`;
  const keyToArr = (k) => k.split(',').map(Number);

  const open = new Map(); // key -> {f, g, parent}
  const closed = new Set();
  const startKey = idx(S);
  open.set(startKey, { f: 0, g: 0, parent: null });

  const heur = (p) => Math.abs(p[0] - E[0]) + Math.abs(p[1] - E[1]) + Math.abs(p[2] - E[2]);

  const validNode = (p) => {
    for (const box of obstacles) {
      if (pointInAABB(p, box, clearance)) return false;
    }
    return true;
  };

  const stepCost = (a, b) => {
    const len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    let cost = len;
    // rack preference
    if (rackZ !== null) {
      cost -= rackBonus * Math.max(0, 1 - Math.abs(a[2] - rackZ) / Math.max(grid, 1e-9));
    }
    return cost;
  };

  const neighbors = (p) => {
    const out = [];
    const axes = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ];
    const onStartColumn = p[0] === S[0] && p[1] === S[1];
    const verticalFromStart = Math.abs(p[2] - S[2]);
    for (const d of axes) {
      // nozzle stub: until the stub length is reached along the start column,
      // only vertical moves are allowed
      if (nozzleStub > 0 && onStartColumn && verticalFromStart < nozzleStub - 1e-9 && (d[0] !== 0 || d[1] !== 0)) {
        continue;
      }
      const q = [p[0] + d[0] * grid, p[1] + d[1] * grid, p[2] + d[2] * grid];
      // drain slope: forbid upward z steps
      if (minSlope > 0 && q[2] > p[2] + 1e-12) continue;
      if (validNode(q)) out.push(q);
    }
    return out;
  };

  const drainSlopeOk = (path) => {
    if (minSlope <= 0) return true;
    const totalLen = path.reduce(
      (s, p, i) =>
        i === 0
          ? 0
          : s +
            Math.abs(path[i][0] - path[i - 1][0]) +
            Math.abs(path[i][1] - path[i - 1][1]) +
            Math.abs(path[i][2] - path[i - 1][2]),
      0
    );
    const drop = path[0][2] - path[path.length - 1][2];
    return drop >= totalLen * minSlope - 1e-9;
  };

  const nozzleStubOk = (path) => {
    if (nozzleStub <= 0) return true;
    // first leg must be vertical and at least the stub length
    const p0 = path[0];
    const p1 = path[1];
    if (p0[0] !== p1[0] || p0[1] !== p1[1]) return false;
    return Math.abs(p0[2] - p1[2]) >= nozzleStub - grid / 2;
  };

  let found = null;
  let iterations = 0;
  const maxIterations = 2000000;

  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    let bestKey = null;
    let bestF = Infinity;
    for (const [k, v] of open) {
      if (v.f < bestF) {
        bestF = v.f;
        bestKey = k;
      }
    }
    const cur = keyToArr(bestKey);
    const curInfo = open.get(bestKey);
    open.delete(bestKey);
    if (cur[0] === E[0] && cur[1] === E[1] && cur[2] === E[2]) {
      found = { curInfo, endKey: bestKey };
      break;
    }
    closed.add(bestKey);
    for (const q of neighbors(cur)) {
      const qk = idx(q);
      if (closed.has(qk)) continue;
      const g = curInfo.g + stepCost(cur, q);
      const existing = open.get(qk);
      if (!existing || g < existing.g) {
        open.set(qk, { g, f: g + heur(q), parent: bestKey });
      }
    }
  }

  if (!found) {
    return { success: false, reason: 'no route found' };
  }

  // reconstruct path
  const path = [];
  let k = found.endKey;
  while (k) {
    path.push(keyToArr(k));
    const info = open.has(k) ? open.get(k) : k === startKey ? open.get(startKey) : null;
    k = info ? info.parent : null;
  }
  // path reconstructed backwards from end; walk parents again properly
  const pathRev = [];
  let curKey = found.endKey;
  let guard = 0;
  while (curKey && guard < 1000000) {
    pathRev.push(keyToArr(curKey));
    const info = curKey === startKey ? open.get(startKey) : null;
    // parents were stored in open entries; find from closed/open
    let parent = null;
    if (open.has(curKey)) parent = open.get(curKey).parent;
    else if (closed.has(curKey)) parent = null; // need stored parent for closed nodes too
    // walk using closed map alternative: store parent in a global map
    break;
  }

  // Reconstruct with an explicit parent map collected during search
  const parents = new Map();
  parents.set(startKey, null);
  // redo search-lite: we already have parents in open/closed but closed nodes lost parents.
  // Simplest robust approach: rebuild via reverse A* from end using stored g-values.

  // Fallback: recompute path from end by steepest descent on g
  const gMap = new Map();
  gMap.set(startKey, 0);
  // Re-run minimal search to collect g and parent for all expanded nodes
  const open2 = new Map();
  const closed2 = new Set();
  open2.set(startKey, { g: 0, parent: null });
  const parents2 = new Map();
  parents2.set(startKey, null);
  let it2 = 0;
  while (open2.size > 0 && it2 < maxIterations) {
    it2++;
    let bk = null;
    let bf = Infinity;
    for (const [k, v] of open2) {
      if (v.g < bf) {
        bf = v.g;
        bk = k;
      }
    }
    const curK = bk;
    const curP = keyToArr(curK);
    const curInfo = open2.get(curK);
    open2.delete(curK);
    closed2.add(curK);
    if (curP[0] === E[0] && curP[1] === E[1] && curP[2] === E[2]) break;
    for (const q of neighbors(curP)) {
      const qk = idx(q);
      if (closed2.has(qk)) continue;
      const g = curInfo.g + stepCost(curP, q);
      const existing = open2.get(qk);
      if (!existing || g < existing.g) {
        open2.set(qk, { g, parent: curK });
        parents2.set(qk, curK);
      }
    }
  }
  const endKey = idx(E);
  const pathFwd = [];
  let ck = endKey;
  let g2 = 0;
  while (ck && g2 < 1000000) {
    pathFwd.push(keyToArr(ck));
    const parent = parents2.get(ck);
    if (!parent) break;
    ck = parent;
    g2++;
  }
  pathFwd.reverse();
  if (pathFwd[0] && pathFwd[0][0] !== S[0]) pathFwd.unshift(S);

  // drain slope check + nozzle stub check on final path
  if (!drainSlopeOk(pathFwd)) {
    return { success: false, reason: 'drain slope requirement unsatisfiable' };
  }
  if (!nozzleStubOk(pathFwd)) {
    return { success: false, reason: 'nozzle stub requirement unsatisfiable' };
  }

  const length = pathFwd.reduce(
    (s, p, i) =>
      i === 0
        ? 0
        : s +
          Math.abs(p[0] - pathFwd[i - 1][0]) +
          Math.abs(p[1] - pathFwd[i - 1][1]) +
          Math.abs(p[2] - pathFwd[i - 1][2]),
    0
  );
  let elbows = 0;
  for (let i = 1; i < pathFwd.length - 1; i++) {
    const d1 = [
      pathFwd[i][0] - pathFwd[i - 1][0],
      pathFwd[i][1] - pathFwd[i - 1][1],
      pathFwd[i][2] - pathFwd[i - 1][2]
    ];
    const d2 = [
      pathFwd[i + 1][0] - pathFwd[i][0],
      pathFwd[i + 1][1] - pathFwd[i][1],
      pathFwd[i + 1][2] - pathFwd[i][2]
    ];
    const n1 = Math.hypot(...d1);
    const n2 = Math.hypot(...d2);
    if (n1 < 1e-12 || n2 < 1e-12) continue;
    const u1 = [d1[0] / n1, d1[1] / n1, d1[2] / n1];
    const u2 = [d2[0] / n2, d2[1] / n2, d2[2] / n2];
    const dot = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2];
    if (Math.abs(1 - dot) > 1e-9) elbows++; // direction changed → elbow
  }

  let minClearance = Infinity;
  for (const p of pathFwd) {
    for (const box of obstacles) {
      const dx = Math.max(0, box.x0 - p[0], p[0] - box.x1);
      const dy = Math.max(0, box.y0 - p[1], p[1] - box.y1);
      const dz = Math.max(0, box.z0 - p[2], p[2] - box.z1);
      minClearance = Math.min(minClearance, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }

  return {
    success: true,
    path: pathFwd,
    length,
    elbows,
    minClearance: minClearance === Infinity ? null : minClearance,
    segmentCount: pathFwd.length - 1,
    iterations
  };
}

module.exports = { routePipe3D, aabbOverlap };
