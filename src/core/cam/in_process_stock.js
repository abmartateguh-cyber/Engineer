/**
 * InProcessStock: Dexel (depth-element) stock model + ball-end tool-sweep
 * removal and rest-finishing path generation.
 *
 * Model
 * -----
 * The stock is a set of vertical dexel columns on a regular X-Y grid. Each
 * column stores the z of the top surface of the remaining material (and
 * optionally the bottom of the stock). Material is removed by lowering the
 * top z of a column when the swept tool volume intersects that column.
 *
 * Tool-sweep removal (ball-end mill):
 *   A ball-end tool of radius r moving along a straight path segment sweeps a
 *   capsule (sphere of radius r swept along the segment). For each column
 *   whose center (x, y) comes within distance r of the segment axis, the cut
 *   surface z at that column is the lowest z of the swept volume along the
 *   column's vertical line:
 *       zCut = min over t in [0,1] of  cz(t) - sqrt(r^2 - d(t)^2)
 *   where cz(t) is the ball-center z along the segment and d(t) is the
 *   horizontal distance of (x, y) from the segment point at parameter t.
 *   Path points are tip positions; the ball center sits r above the tip.
 *
 * Rest-finishing:
 *   Columns whose remaining top z exceeds a target depth are flagged as
 *   un-machined. A deterministic zig-zag path is generated over exactly the
 *   flagged columns, at the target depth.
 *
 * Determinism: no randomness; iteration order is fixed by grid indices.
 */

'use strict';

const IN_PROCESS_STOCK_VERSION = '1.0.0';

const EPS = 1e-9;

class DexelStock {
  /**
   * @param {object} opts
   * @param {number[]} opts.origin - [x0, y0] of the first column center
   * @param {number[]} opts.spacing - [dx, dy] column spacing
   * @param {number} opts.nx - column count along X
   * @param {number} opts.ny - column count along Y
   * @param {number} [opts.topZ=0] - initial top z for every column
   * @param {number} [opts.bottomZ=0] - initial bottom z for every column
   */
  constructor(opts) {
    this.version = IN_PROCESS_STOCK_VERSION;
    this.x0 = opts.origin[0];
    this.y0 = opts.origin[1];
    this.dx = opts.spacing[0];
    this.dy = opts.spacing[1];
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.topZ = opts.topZ || 0;
    this.bottomZ = opts.bottomZ || 0;
    const n = this.nx * this.ny;
    this.top = new Float64Array(n);
    this.bottom = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      this.top[k] = this.topZ;
      this.bottom[k] = this.bottomZ;
    }
  }

  /** Clone (independent buffers). */
  clone() {
    const c = new DexelStock({
      origin: [this.x0, this.y0],
      spacing: [this.dx, this.dy],
      nx: this.nx,
      ny: this.ny,
      topZ: this.topZ,
      bottomZ: this.bottomZ
    });
    c.top.set(this.top);
    c.bottom.set(this.bottom);
    return c;
  }

  _idx(i, j) {
    return j * this.nx + i;
  }

  centerX(i) {
    return this.x0 + i * this.dx;
  }

  centerY(j) {
    return this.y0 + j * this.dy;
  }

  /** Top z of column (i, j). */
  getTop(i, j) {
    return this.top[this._idx(i, j)];
  }

  /** Set top z of column (i, j) (clamped to bottom). */
  setTop(i, j, z) {
    const k = this._idx(i, j);
    const b = this.bottom[k];
    this.top[k] = z < b ? b : z;
  }

  /**
   * Create from a rectangular stock block.
   * @param {object} block {min:[x,y,z], max:[x,y,z]}
   * @param {object} grid {origin, spacing, nx, ny}
   */
  static fromBlock(block, grid) {
    const s = new DexelStock({
      origin: grid.origin,
      spacing: grid.spacing,
      nx: grid.nx,
      ny: grid.ny,
      topZ: block.max[2],
      bottomZ: block.min[2]
    });
    return s;
  }

  /**
   * Create from a triangle mesh by ray casting. For each column center, a
   * ray is cast downward from +infinity; the top surface is the highest
   * intersection of the ray with the mesh. Columns the ray misses (open
   * mesh) are left at the block top z.
   * @param {object} mesh {vertices:[[x,y,z],...], faces:[[i,j,k],...]}
   * @param {object} grid {origin, spacing, nx, ny}
   * @param {object} [fallback] {topZ, bottomZ} used for missed columns
   */
  static fromMesh(mesh, grid, fallback) {
    const s = new DexelStock({
      origin: grid.origin,
      spacing: grid.spacing,
      nx: grid.nx,
      ny: grid.ny,
      topZ: fallback ? fallback.topZ : 0,
      bottomZ: fallback ? fallback.bottomZ : 0
    });
    const verts = mesh.vertices;
    const faces = mesh.faces;
    for (let j = 0; j < s.ny; j++) {
      for (let i = 0; i < s.nx; i++) {
        const x = s.centerX(i);
        const y = s.centerY(j);
        let zTop = -Infinity;
        for (let f = 0; f < faces.length; f++) {
          const tri = faces[f];
          const zHit = rayTriangleTopZ(x, y, verts[tri[0]], verts[tri[1]], verts[tri[2]]);
          if (zHit > zTop) zTop = zHit;
        }
        if (isFinite(zTop)) s.top[s._idx(i, j)] = zTop;
      }
    }
    return s;
  }

  /**
   * Apply a ball-end tool sweep along a path segment (or an array of
   * segments). Each segment is {start:[x,y,z], end:[x,y,z]} tip positions.
   * Columns intersected by the swept capsule have their top lowered to the
   * local cut surface z (monotonic: never raised).
   * @param {number} toolR - tool radius (mm)
   * @param {object|object[]} segment
   */
  sweep(toolR, segment) {
    const segs = Array.isArray(segment) ? segment : [segment];
    for (const seg of segs) {
      for (let j = 0; j < this.ny; j++) {
        const y = this.centerY(j);
        for (let i = 0; i < this.nx; i++) {
          const x = this.centerX(i);
          const zCut = sweepCutZ(x, y, toolR, seg);
          if (zCut >= Infinity) continue;
          const k = this._idx(i, j);
          if (zCut < this.top[k]) this.top[k] = zCut;
        }
      }
    }
    return this;
  }

  /**
   * Columns with material remaining above a target depth.
   * @param {number} targetDepth
   * @returns {Array<{i,j,x,y,z}>}
   */
  remaining(targetDepth) {
    const out = [];
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const z = this.top[this._idx(i, j)];
        if (z > targetDepth + EPS) {
          out.push({ i, j, x: this.centerX(i), y: this.centerY(j), z });
        }
      }
    }
    return out;
  }

  /**
   * Deterministic zig-zag rest-finishing path covering exactly the remaining
   * material columns (top z > targetDepth), at the target depth.
   * Rows are visited top-to-bottom; within each row columns are visited in
   * alternating left-right / right-left order. Columns already at the target
   * depth are never visited.
   * @param {number} targetDepth
   * @returns {Array<{x,y,z,i,j}>}
   */
  restPath(targetDepth) {
    const flags = new Set();
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        if (this.top[this._idx(i, j)] > targetDepth + EPS) {
          flags.add(j * this.nx + i);
        }
      }
    }
    const pts = [];
    let dir = 1;
    for (let j = 0; j < this.ny; j++) {
      const row = [];
      for (let i = 0; i < this.nx; i++) {
        if (flags.has(j * this.nx + i)) row.push(i);
      }
      if (row.length === 0) continue;
      if (dir === 1) row.sort((a, b) => a - b);
      else row.sort((a, b) => b - a);
      for (const i of row) {
        pts.push({ x: this.centerX(i), y: this.centerY(j), z: targetDepth, i, j });
      }
      dir *= -1;
    }
    return pts;
  }

  /** Internal grid state for determinism comparisons. */
  state() {
    return { top: this.top.slice(), bottom: this.bottom.slice() };
  }
}

/**
 * Top-most intersection z of a vertical ray through (x, y) traveling downward
 * with a triangle (highest crossing of the mesh top surface). The ray hits
 * the triangle plane at z = az + (n·(p - A)) / nz; the intersection is kept
 * only when (x, y) lies inside the triangle's XY projection. A triangle whose
 * normal is perpendicular to Z (vertical face) contributes no top surface.
 * Returns -Infinity when the ray misses.
 */
function rayTriangleTopZ(x, y, A, B, C) {
  const ax = A[0],
    ay = A[1],
    az = A[2];
  const bx = B[0],
    by = B[1],
    bz = B[2];
  const cx = C[0],
    cy = C[1],
    cz = C[2];
  const ex = bx - ax,
    ey = by - ay,
    ez = bz - az;
  const fx = cx - ax,
    fy = cy - ay,
    fz = cz - az;
  const nz = ex * fy - ey * fx;
  if (Math.abs(nz) < 1e-12) return -Infinity;
  const nx = ey * fz - ez * fy;
  const ny = ez * fx - ex * fz;
  const z = az - (nx * (x - ax) + ny * (y - ay)) / nz;
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  if (hasNeg && hasPos) return -Infinity;
  return z;
}

/**
 * Lowest cut-surface z of a ball-end tool (radius r, tip-path segment seg)
 * along the vertical line through (x, y). Returns Infinity when the column
 * is not intersected by the swept capsule.
 */
function sweepCutZ(x, y, r, seg) {
  const ax = seg.start[0];
  const ay = seg.start[1];
  const az = seg.start[2] + r;
  const bx = seg.end[0];
  const by = seg.end[1];
  const bz = seg.end[2] + r;
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const L2 = ux * ux + uy * uy;
  const px = x - ax;
  const py = y - ay;
  if (L2 === 0) {
    const d2 = px * px + py * py;
    if (d2 >= r * r - 1e-9) return Infinity;
    const s = Math.sqrt(r * r - d2);
    return Math.min(az, bz) - s;
  }
  let tc = (px * ux + py * uy) / L2;
  tc = Math.max(0, Math.min(1, tc));
  const d2c = (px - tc * ux) * (px - tc * ux) + (py - tc * uy) * (py - tc * uy);
  if (d2c >= r * r - 1e-9) return Infinity;
  const cand = [0, 1, tc];
  if (uz !== 0) {
    const a = px * ux + py * uy;
    const b = L2;
    const A = b * b + uz * uz * b;
    const B = 2 * a * b + 2 * uz * uz * a;
    const C = a * a - uz * uz * (r * r - (px * px + py * py));
    const disc = B * B - 4 * A * C;
    if (A !== 0 && disc >= 0) {
      const sq = Math.sqrt(Math.max(0, disc));
      const r1 = (-B - sq) / (2 * A);
      const r2 = (-B + sq) / (2 * A);
      if (r1 > 0 && r1 < 1) cand.push(r1);
      if (r2 > 0 && r2 < 1) cand.push(r2);
    }
  }
  let best = Infinity;
  for (let k = 0; k < cand.length; k++) {
    const t = cand[k];
    const cx2 = ax + t * ux;
    const cy2 = ay + t * uy;
    const cz2 = az + t * uz;
    const dx = x - cx2;
    const dy = y - cy2;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r - 1e-9) continue;
    const val = cz2 - Math.sqrt(r * r - d2);
    if (val < best) best = val;
  }
  return best;
}

module.exports = { DexelStock, sweepCutZ, rayTriangleTopZ, IN_PROCESS_STOCK_VERSION };
