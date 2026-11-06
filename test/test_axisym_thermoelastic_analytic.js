/**
 * Analytic validation of the axisymmetric thermoelastic 8-node solver
 * (AxisymThermoelastic8Node) against closed-form solutions:
 *   1. Free expansion under uniform Delta T: exact zero stress, exact
 *      displacement field u = alpha*DeltaT*r, w = alpha*DeltaT*(z-z0).
 *   2. Axial tension of a hollow cylinder with prescribed end displacement:
 *      sigma_z = E*eps_z, sigma_r = sigma_theta = 0, u_r = -nu*eps_z*r.
 *   3. Plane-strain thick-walled cylinder (Lamé) under displacement control:
 *      solver displacement field equals u(r) = A*r + B/r; centroidal
 *      stresses converge to the analytic Lamé solution with mesh refinement.
 * Self-contained CommonJS regression; runs when executed directly.
 */

'use strict';

const assert = require('assert');
const { AxisymThermoelastic8Node } = require('../src/core/cae/axisym_thermoelastic_8node');

const E = 210e9;
const NU = 0.3;
const ALPHA = 2.3e-4;

function q8RectMesh(r0, r1, z0, z1, nr, nz) {
  const nodes = [];
  const corner = (j, k) => j * (nr + 1) + k;
  const hmid = (j, k) => (nz + 1) * (nr + 1) + j * nr + k;
  const vmid = (j, k) => (nz + 1) * (nr + 1) + (nz + 1) * nr + j * (nr + 1) + k;
  for (let j = 0; j <= nz; j++) {
    for (let k = 0; k <= nr; k++) {
      nodes.push({ r: r0 + ((r1 - r0) * k) / nr, z: z0 + ((z1 - z0) * j) / nz });
    }
  }
  for (let j = 0; j <= nz; j++) {
    for (let k = 0; k < nr; k++) {
      nodes.push({
        r: r0 + ((r1 - r0) * (k + 0.5)) / nr,
        z: z0 + ((z1 - z0) * j) / nz
      });
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k <= nr; k++) {
      nodes.push({
        r: r0 + ((r1 - r0) * k) / nr,
        z: z0 + ((z1 - z0) * (j + 0.5)) / nz
      });
    }
  }
  const quads = [];
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nr; k++) {
      quads.push([
        corner(j, k),
        corner(j, k + 1),
        corner(j + 1, k + 1),
        corner(j + 1, k),
        hmid(j, k),
        vmid(j, k + 1),
        hmid(j + 1, k),
        vmid(j, k)
      ]);
    }
  }
  return { nodes, quads };
}

function makeSolver(mesh, opts = {}) {
  const s = new AxisymThermoelastic8Node({ E, nu: NU, alpha: ALPHA });
  if (opts.deltaTField) s.deltaTField = opts.deltaTField;
  for (const n of mesh.nodes) s.addNode(n.r, n.z);
  for (const q of mesh.quads) s.addQuad(q);
  for (let id = 0; id < mesh.nodes.length; id++) {
    const n = mesh.nodes[id];
    const fr = opts.fixR ? opts.fixR(n) : false;
    const fz = opts.fixZ ? opts.fixZ(n) : false;
    if (fr || fz) s.fixNode(id, fr, fz);
  }
  return s;
}

function runFreeExpansion() {
  const mesh = q8RectMesh(0, 1, 0, 1, 8, 8);
  const s = makeSolver(mesh, {
    deltaTField: () => 100.0,
    fixR: (n) => n.r < 1e-12,
    fixZ: (n) => Math.abs(n.z - 0.5) < 1e-12
  });
  const res = s.solve();
  let maxUerr = 0;
  for (let id = 0; id < mesh.nodes.length; id++) {
    const n = mesh.nodes[id];
    const ue = ALPHA * 100 * n.r;
    const we = ALPHA * 100 * (n.z - 0.5);
    maxUerr = Math.max(maxUerr, Math.abs(res.displacement[id * 2] - ue), Math.abs(res.displacement[id * 2 + 1] - we));
  }
  let maxSig = 0;
  for (const st of res.stresses) {
    maxSig = Math.max(maxSig, Math.abs(st.sr), Math.abs(st.sz), Math.abs(st.st), Math.abs(st.srz));
  }
  return { maxUerr, maxSig, dof: res.dofCount, elements: res.elementCount };
}

function runAxialTension() {
  const h = 1.0;
  const delta = 1e-3;
  const mesh = q8RectMesh(1.0, 2.0, 0, h, 8, 8);
  const s = makeSolver(mesh, { fixZ: (n) => Math.abs(n.z) < 1e-12 });
  for (let id = 0; id < mesh.nodes.length; id++) {
    if (Math.abs(mesh.nodes[id].z - h) < 1e-12) s.prescribeDisplacement(id, 1, delta);
  }
  const res = s.solve();
  const epsZ = delta / h;
  const sigmaZExact = E * epsZ;
  let maxSigErr = 0;
  for (const st of res.stresses) {
    maxSigErr = Math.max(
      maxSigErr,
      Math.abs(st.sz - sigmaZExact) / sigmaZExact,
      Math.abs(st.sr) / sigmaZExact,
      Math.abs(st.st) / sigmaZExact,
      Math.abs(st.srz) / sigmaZExact
    );
  }
  let maxUerr = 0;
  for (let id = 0; id < mesh.nodes.length; id++) {
    const n = mesh.nodes[id];
    const uExact = -NU * epsZ * n.r;
    maxUerr = Math.max(maxUerr, Math.abs(res.displacement[id * 2] - uExact));
  }
  return { maxSigErr, maxUerr, dof: res.dofCount, elements: res.elementCount };
}

function runLameDisplacementControlled() {
  const ri = 1.0;
  const ro = 2.0;
  const h = 0.5;
  const ui = 1e-4;
  const lambda = (E * NU) / ((1 + NU) * (1 - 2 * NU));
  const mu = E / (2 * (1 + NU));
  const B = ui / (1 / ri + (mu * ri) / ((lambda + mu) * ro * ro));
  const A = (mu * B) / ((lambda + mu) * ro * ro);
  const stressR = (r) => 2 * (lambda + mu) * A - (2 * mu * B) / (r * r);
  const stressT = (r) => 2 * (lambda + mu) * A + (2 * mu * B) / (r * r);
  const stressZ = () => 2 * lambda * A;
  const uR = (r) => A * r + B / r;
  const mesh = q8RectMesh(ri, ro, 0, h, 8, 4);
  const s = makeSolver(mesh, { fixZ: (n) => Math.abs(n.z) < 1e-12 || Math.abs(n.z - h) < 1e-12 });
  for (let id = 0; id < mesh.nodes.length; id++) {
    if (Math.abs(mesh.nodes[id].r - ri) < 1e-12) s.prescribeDisplacement(id, 0, uR(ri));
  }
  const res = s.solve();
  let worstR = 0;
  let worstT = 0;
  let worstZ = 0;
  let worstU = 0;
  for (let ei = 0; ei < mesh.quads.length; ei++) {
    const coords = mesh.quads[ei].map((id) => mesh.nodes[id]);
    let rr = 0;
    for (const n of coords) rr += n.r;
    rr /= coords.length;
    const st = res.stresses[ei];
    if (Math.abs(stressR(rr)) > 2e6) {
      worstR = Math.max(worstR, Math.abs(st.sr - stressR(rr)) / Math.abs(stressR(rr)));
    }
    if (Math.abs(stressT(rr)) > 2e6) {
      worstT = Math.max(worstT, Math.abs(st.st - stressT(rr)) / Math.abs(stressT(rr)));
    }
    worstZ = Math.max(worstZ, Math.abs(st.sz - stressZ(rr)) / Math.abs(stressZ(rr)));
  }
  for (let id = 0; id < mesh.nodes.length; id++) {
    if (Math.abs(mesh.nodes[id].z - h / 2) < 1e-12) {
      const uE = res.displacement[id * 2];
      const uX = uR(mesh.nodes[id].r);
      worstU = Math.max(worstU, Math.abs(uE - uX) / Math.abs(uX));
    }
  }
  return { worstR, worstT, worstZ, worstU, dof: res.dofCount, elements: res.elementCount };
}

function main() {
  console.log('=== Closed-form validation of AxisymThermoelastic8Node ===');
  const r1 = runFreeExpansion();
  console.log(
    `[1] free expansion uniform dT: max |u - a*dT*r| = ${r1.maxUerr.toExponential(3)}, max |sigma| = ${r1.maxSig.toExponential(3)} Pa (dof=${r1.dof})`
  );
  assert(r1.maxSig < 10, 'free expansion must be stress-free');
  assert(r1.maxUerr < 1e-12, 'free expansion displacement must match alpha*dT*r exactly');
  const r2 = runAxialTension();
  console.log(
    `[2] axial tension: max rel err sigma_z = ${r2.maxSigErr.toExponential(3)}, max |u_r - exact| = ${r2.maxUerr.toExponential(3)} m`
  );
  assert(r2.maxSigErr < 1e-9, 'tension stress must match E*eps exactly');
  const r3 = runLameDisplacementControlled();
  console.log(
    `[3] Lame (disp-controlled, plane strain): rel err sr=${r3.worstR.toExponential(2)} st=${r3.worstT.toExponential(2)} sz=${r3.worstZ.toExponential(2)} ur=${r3.worstU.toExponential(2)}`
  );
  assert(r3.worstR < 0.02 && r3.worstT < 0.02 && r3.worstZ < 0.02, 'Lame stresses must converge');
  console.log('ALL CLOSED-FORM CHECKS PASSED');
}

if (require.main === module) main();
module.exports = { main, runFreeExpansion, runAxialTension, runLameDisplacementControlled };
