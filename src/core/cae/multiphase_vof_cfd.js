'use strict';

/**
 * MultiphaseVOF: kinematic Volume-of-Fluid interface tracking with geometric
 * PLIC reconstruction, operator-split advection, and Continuum Surface Force
 * (CSF) surface-tension force evaluation on a 2D Cartesian grid.
 *
 * Scope (documented): passive interface advection with a prescribed,
 * divergence-free velocity field (± geometric PLIC reconstruction ± CSF
 * surface-tension force density. It is NOT a flow-coupled pressure-projection
 * solver; the momentum coupling is outside this module.
 *
 * Conventions:
 *   - Grid: Nx x Ny cells, cell-centered volume fraction c[i][j] in [0,1],
 *     face-centered velocities uEast[i][j] (x-face between cell i and i+1)
 *     and vNorth[i][j] (y-face between cell j and j+1).
 *   - PLIC: interface line n·x = alpha, n from Youngs normal estimate,
 *     alpha found by exact area matching (analytic polygon area).
 */

function centroidCenteredNormal(c, i, j) {
  // Youngs' method with central differences on a 3x3 stencil (clamped edges)
  const Nx = c.length;
  const Ny = c[0].length;
  const im = Math.max(i - 1, 0);
  const ip = Math.min(i + 1, Nx - 1);
  const jm = Math.max(j - 1, 0);
  const jp = Math.min(j + 1, Ny - 1);
  const gx = 0.5 * (c[ip][jp] + 2 * c[ip][j] + c[ip][jm]) - 0.5 * (c[im][jp] + 2 * c[im][j] + c[im][jm]);
  const gy = 0.5 * (c[ip][jp] + 2 * c[i][jp] + c[im][jp]) - 0.5 * (c[ip][jm] + 2 * c[i][jm] + c[im][jm]);
  const n = Math.hypot(gx, gy);
  if (n < 1e-12) return [0, 0];
  return [gx / n, gy / n];
}

// Area of a convex polygon (shoelace)
function polygonArea(pts) {
  let a = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x1, y1] = pts[k];
    const [x2, y2] = pts[(k + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return 0.5 * Math.abs(a);
}

// Cut a unit square [0,1]^2 by the line n·x = alpha, returning the polygon
// of the region with n·x <= alpha (signed normal pointing into fluid 1).
function clipSquare(nx, ny, alpha) {
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ];
  const value = (p) => nx * p[0] + ny * p[1];
  const inside = (p) => value(p) <= alpha + 1e-14;
  const poly = [];
  for (let k = 0; k < 4; k++) {
    const p0 = corners[k];
    const p1 = corners[(k + 1) % 4];
    const in0 = inside(p0);
    const in1 = inside(p1);
    if (in0) poly.push(p0);
    if (in0 !== in1) {
      const v0 = value(p0);
      const t = (alpha - v0) / (value(p1) - v0);
      poly.push([p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])]);
    }
  }
  return poly;
}

/**
 * Reconstruct the PLIC line for a cell.
 * @returns {null|{nx,ny,alpha,area}} line or null for empty/full cells
 */
function reconstructCell(nx, ny, c) {
  if (c <= 1e-12) return null;
  if (c >= 1 - 1e-12) return null;
  const unit = Math.hypot(nx, ny);
  const ux = nx / unit;
  const uy = ny / unit;
  // binary search on alpha in [-|n|, +|n|] for area match
  let lo = -unit;
  let hi = unit;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    const poly = clipSquare(ux, uy, mid);
    const area = polygonArea(poly);
    if (area > c) hi = mid;
    else lo = mid;
  }
  const alpha = 0.5 * (lo + hi);
  const poly = clipSquare(ux, uy, alpha);
  return { nx: ux, ny: uy, alpha, area: polygonArea(poly) };
}

/**
 * Compute the fluxed area across the east face of cell (i,j) given the
 * reconstructed line and a donor-acceptor direction. Velocity sign decides
 * donor cell; we use the simple geometric flux: for a donor cell with line
 * (n, alpha), the swept region in a time step is the portion of the cell
 * crossing the face. Exact polygon sweep is complex; we use the standard
 * (Kachanov) approximation: shift the cell by (u dt, 0) and clip.
 */
function eastFlux(line, uDt) {
  if (!line || uDt <= 0) return 0;
  // polygon of fluid in the strip [1-uDt, 1] x [0,1] inside the cut region
  const strip = [
    [1 - uDt, 0],
    [1, 0],
    [1, 1],
    [1 - uDt, 1]
  ];
  const inside = (p) => line.nx * p[0] + line.ny * p[1] <= line.alpha + 1e-14;
  const poly = [];
  for (let k = 0; k < 4; k++) {
    const p0 = strip[k];
    const p1 = strip[(k + 1) % 4];
    if (inside(p0)) poly.push(p0);
    const v0 = line.nx * p0[0] + line.ny * p0[1];
    const v1 = line.nx * p1[0] + line.ny * p1[1];
    if (v0 < line.alpha !== v1 < line.alpha) {
      const t = (line.alpha - v0) / (v1 - v0);
      poly.push([p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])]);
    }
  }
  return polygonArea(poly);
}

function northFlux(line, vDt) {
  if (!line || vDt <= 0) return 0;
  const strip = [
    [0, 1 - vDt],
    [1, 1 - vDt],
    [1, 1],
    [0, 1]
  ];
  const inside = (p) => line.nx * p[0] + line.ny * p[1] <= line.alpha + 1e-14;
  const poly = [];
  for (let k = 0; k < 4; k++) {
    const p0 = strip[k];
    const p1 = strip[(k + 1) % 4];
    if (inside(p0)) poly.push(p0);
    const v0 = line.nx * p0[0] + line.ny * p0[1];
    const v1 = line.nx * p1[0] + line.ny * p1[1];
    if (v0 < line.alpha !== v1 < line.alpha) {
      const t = (line.alpha - v0) / (v1 - v0);
      poly.push([p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])]);
    }
  }
  return polygonArea(poly);
}

/**
 * Advect the volume fraction by one time step using operator splitting
 * (x-sweep then y-sweep), with PLIC reconstruction of donor cells and
 * geometric fluxes. Periodic boundary conditions are applied.
 */
function advectVOF(c, uEast, vNorth, dt, dx = 1, dy = 1) {
  const Nx = c.length;
  const Ny = c[0].length;
  // x-sweep
  const cX = Array.from({ length: Nx }, (_, i) => Array.from({ length: Ny }, (_, j) => c[i][j]));
  const fluxEast = new Float64Array(Nx * Ny);
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const u = uEast[i][j];
      const uDt = (u * dt) / dx;
      if (uDt > 0) {
        const line = reconstructCell(0, 0, cX[i][j]);
        fluxEast[i * Ny + j] = eastFlux(rcLineAt(cX, i, j), uDt);
      }
    }
  }
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const u = uEast[i][j];
      const uDt = (u * dt) / dx;
      let fIn = 0;
      let fOut = 0;
      if (uDt > 0) fOut = fluxEast[i * Ny + j];
      else fIn = fluxEast[((i - 1 + Nx) % Nx) * Ny + j];
      cX[i][j] += (fIn - fOut) / (dx * dy);
    }
  }
  // y-sweep
  const cY = Array.from({ length: Nx }, (_, i) => Array.from({ length: Ny }, (_, j) => cX[i][j]));
  const fluxNorth = new Float64Array(Nx * Ny);
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const v = vNorth[i][j];
      const vDt = (v * dt) / dy;
      if (vDt > 0) {
        fluxNorth[i * Ny + j] = northFlux(rcLineAt(cY, i, j), vDt);
      }
    }
  }
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const v = vNorth[i][j];
      const vDt = (v * dt) / dy;
      let fIn = 0;
      let fOut = 0;
      if (vDt > 0) fOut = fluxNorth[i * Ny + j];
      else fIn = fluxNorth[i * Ny + ((j - 1 + Ny) % Ny)];
      cY[i][j] += (fIn - fOut) / (dx * dy);
    }
  }
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      cY[i][j] = Math.min(1, Math.max(0, cY[i][j]));
    }
  }
  return cY;
}

function rcLineAt(c, i, j) {
  const Nx = c.length;
  const Ny = c[0].length;
  const [nx, ny] = centroidCenteredNormal(c, i, j);
  const line = reconstructCell(nx, ny, c[i][j]);
  if (!line) return null;
  return line;
}

/**
 * CSF surface tension force density at cell (i,j):
 * F = sigma * kappa * grad(c) with kappa = -div(n_hat).
 */
function surfaceTensionForce(c, sigma, dx = 1, dy = 1) {
  const Nx = c.length;
  const Ny = c[0].length;
  const Fx = Array.from({ length: Nx }, () => new Float64Array(Ny));
  const Fy = Array.from({ length: Nx }, () => new Float64Array(Ny));
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const [nx, ny] = centroidCenteredNormal(c, i, j);
      const mag = Math.hypot(nx, ny);
      if (mag < 1e-12) continue;
      const ux = nx / mag;
      const uy = ny / mag;
      // curvature via central differences of the normalized normal
      const [nxE] = centroidCenteredNormal(c, Math.min(i + 1, Nx - 1), j);
      const [nxW] = centroidCenteredNormal(c, Math.max(i - 1, 0), j);
      const [, nyN] = centroidCenteredNormal(c, i, Math.min(j + 1, Ny - 1));
      const [, nyS] = centroidCenteredNormal(c, i, Math.max(j - 1, 0));
      const divN = (nxE - nxW) / (2 * dx) + (nyN - nyS) / (2 * dy);
      const kappa = -divN;
      // grad(c)
      const gcx = (c[Math.min(i + 1, Nx - 1)][j] - c[Math.max(i - 1, 0)][j]) / (2 * dx);
      const gcy = (c[i][Math.min(j + 1, Ny - 1)] - c[i][Math.max(j - 1, 0)]) / (2 * dy);
      Fx[i][j] = sigma * kappa * gcx;
      Fy[i][j] = sigma * kappa * gcy;
    }
  }
  return { Fx, Fy };
}

function circularDroplet(Nx, Ny, radius, cx, cy) {
  const c = Array.from({ length: Nx }, (_, i) =>
    Array.from({ length: Ny }, (_, j) => {
      const dx = i + 0.5 - cx;
      const dy = j + 0.5 - cy;
      return Math.hypot(dx, dy) <= radius ? 1 : 0;
    })
  );
  return c;
}

function slottedCircle(N, radius, cx, cy, slotWidth = 0.12 * 64, slotDepth = 0.32 * 64) {
  const c = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => {
      const dx = i + 0.5 - cx;
      const dy = j + 0.5 - cy;
      const inCircle = Math.hypot(dx, dy) <= radius;
      if (!inCircle) return 0;
      // slot: vertical indentation from the top of the disk
      const topEdge = cy + radius;
      const inSlot = Math.abs(dx) <= slotWidth / 2 && cy + 0.5 >= topEdge - slotDepth;
      return inSlot ? 0 : 1;
    })
  );
  return c;
}

module.exports = {
  advectVOF,
  surfaceTensionForce,
  reconstructCell,
  clipSquare,
  polygonArea,
  centroidCenteredNormal,
  circularDroplet,
  slottedCircle,
  eastFlux,
  northFlux
};
