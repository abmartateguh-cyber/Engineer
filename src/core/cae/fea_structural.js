/**
 * Experimental structural finite element analysis (FEA) routines.
 * Implements 3D solid element stiffness assembly, boundary conditions, and von Mises stress computation.
 * No independent solver validation or production-use evidence is established.
 */

const { LinearSolver } = require('../math/linear_algebra');
const { WasmSparseMultifrontalSolver } = require('../math/wasm_sparse_multifrontal');
const { ElementTET10 } = require('./element_tet10');
const { ElementHEX20 } = require('./element_hex20');
const { MaterialManager, interpolateProperty, REFERENCE_TEMPERATURE_K } = require('../materials/material_database');

function materialFromRecord(record) {
  const E = Array.isArray(record.E) ? interpolateProperty(record, 'E', REFERENCE_TEMPERATURE_K) : record.E;
  const yieldStress = Array.isArray(record.Sy) ? interpolateProperty(record, 'Sy', REFERENCE_TEMPERATURE_K) : record.Sy;
  return {
    E,
    nu: record.nu,
    yieldStress,
    name: record.name,
    materialId: record.id,
    materialSource: record.source && record.source.url ? record.source.url : null
  };
}

function resolveMaterialProperties(material) {
  if (typeof material === 'string') {
    const record = MaterialManager.getMaterial(material);
    if (!record) {
      throw new Error(`FEA material id "${material}" is not present in the certified material database.`);
    }
    return materialFromRecord(record);
  }
  if (material && typeof material === 'object' && typeof material.materialId === 'string') {
    const record = MaterialManager.getMaterial(material.materialId);
    if (!record) {
      throw new Error(`FEA material id "${material.materialId}" is not present in the certified material database.`);
    }
    const base = materialFromRecord(record);
    return {
      ...base,
      ...material,
      E: Number.isFinite(material.E) ? material.E : base.E,
      nu: Number.isFinite(material.nu) ? material.nu : base.nu,
      yieldStress: Number.isFinite(material.yieldStress) ? material.yieldStress : base.yieldStress
    };
  }
  return material;
}

class FEANode {
  constructor(id, x, y, z) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.z = z;
    this.dof = [3 * id, 3 * id + 1, 3 * id + 2]; // u, v, w displacement degrees of freedom
    this.displacement = [0, 0, 0];
    this.prescribedDisplacement = [0, 0, 0];
    this.isFixed = [false, false, false];
    this.force = [0, 0, 0];
  }
}

class FEAElement {
  constructor(id, nodeIds, material) {
    const resolved = resolveMaterialProperties(material);
    if (!resolved || typeof resolved !== 'object') {
      throw new TypeError('Explicit material properties are required for each FEA element.');
    }
    if (
      ![resolved.E, resolved.nu, resolved.yieldStress].every(Number.isFinite) ||
      resolved.E <= 0 ||
      resolved.nu <= -1 ||
      resolved.nu >= 0.5 ||
      resolved.yieldStress <= 0
    ) {
      throw new RangeError('Provide finite E > 0, -1 < nu < 0.5, and yieldStress > 0 in consistent SI units.');
    }
    this.id = id;
    this.nodeIds = nodeIds; // 4 nodes for 4-node linear tetrahedral (TET4)
    this.material = { ...resolved };
    this.stress = { xx: 0, yy: 0, zz: 0, xy: 0, yz: 0, zx: 0, vonMises: 0 };
    this.strain = { xx: 0, yy: 0, zz: 0, xy: 0, yz: 0, zx: 0 };
  }
}

class FEASolver {
  constructor() {
    this.nodes = [];
    this.elements = [];
    this.results = null;
  }

  addNode(x, y, z) {
    const id = this.nodes.length;
    const node = new FEANode(id, x, y, z);
    this.nodes.push(node);
    return node;
  }

  addElement(nodeIds, material) {
    const id = this.elements.length;
    const elem = new FEAElement(id, nodeIds, material);
    this.elements.push(elem);
    return elem;
  }

  fixNode(nodeId, fixX = true, fixY = true, fixZ = true, prescribed = [0, 0, 0]) {
    const n = this.nodes[nodeId];
    if (n) {
      n.isFixed = [fixX, fixY, fixZ];
      if (Array.isArray(prescribed)) {
        n.prescribedDisplacement = [Number(prescribed[0]) || 0, Number(prescribed[1]) || 0, Number(prescribed[2]) || 0];
      }
    }
  }

  applyForce(nodeId, fx, fy, fz) {
    const n = this.nodes[nodeId];
    if (n) {
      n.force = [fx, fy, fz];
    }
  }

  /**
   * Assemble global stiffness matrix and solve static equilibrium K * u = F
   *
   * The global matrix is assembled directly into sparse triplets (never as a
   * dense n x n array). Only the upper triangle of the symmetric matrix is
   * stored. Dirichlet boundary conditions are applied by strictly symmetric
   * row/column elimination on the sparse structure, lifting prescribed
   * displacement terms onto the right-hand side. A dense fallback is used only
   * for very small systems (totalDOF < 500).
   */
  solveStatic() {
    const totalDOF = this.nodes.length * 3;
    if (totalDOF === 0 || this.elements.length === 0) {
      return { maxStress: 0, maxDisplacement: 0, status: 'empty' };
    }

    // Apply nodal forces
    const F = new Float64Array(totalDOF);
    for (const node of this.nodes) {
      F[node.dof[0]] = node.force[0];
      F[node.dof[1]] = node.force[1];
      F[node.dof[2]] = node.force[2];
    }

    // ---- Sparse upper-triangle triplet assembly (no dense K allocation) ----
    // Triplets (i, j, v) with i <= j are kept in growable typed arrays with
    // per-row and per-column linked lists so symmetric BC elimination can
    // remove row and column entries without building a dense matrix.
    // Duplicate contributions are merged later by
    // WasmSparseMultifrontalSolver.finalizeCSR.
    let cap = Math.max(1024, this.elements.length * 45);
    let cnt = 0;
    let ti = new Int32Array(cap);
    let tj = new Int32Array(cap);
    let tv = new Float64Array(cap);
    let nxtR = new Int32Array(cap);
    let nxtC = new Int32Array(cap);
    let del = new Uint8Array(cap);
    const headR = new Int32Array(totalDOF).fill(-1);
    const headC = new Int32Array(totalDOF).fill(-1);

    const grow = () => {
      const cap2 = cap * 2;
      const ti2 = new Int32Array(cap2);
      ti2.set(ti);
      const tj2 = new Int32Array(cap2);
      tj2.set(tj);
      const tv2 = new Float64Array(cap2);
      tv2.set(tv);
      const nxtR2 = new Int32Array(cap2);
      nxtR2.set(nxtR);
      const nxtC2 = new Int32Array(cap2);
      nxtC2.set(nxtC);
      const del2 = new Uint8Array(cap2);
      del2.set(del);
      ti = ti2;
      tj = tj2;
      tv = tv2;
      nxtR = nxtR2;
      nxtC = nxtC2;
      del = del2;
      cap = cap2;
    };

    const addTriplet = (i, j, v) => {
      if (cnt === cap) grow();
      ti[cnt] = i;
      tj[cnt] = j;
      tv[cnt] = v;
      nxtR[cnt] = headR[i];
      headR[i] = cnt;
      nxtC[cnt] = headC[j];
      headC[j] = cnt;
      cnt++;
    };

    // Assemble element stiffness matrices directly into triplets (upper triangle only)
    for (const elem of this.elements) {
      let KeFlat = null;
      let Ke2D = null;
      let nel = 0;
      if (elem.nodeIds.length === 20) {
        const hexNodes = elem.nodeIds.map((id) => this.nodes[id]);
        const hex20 = new ElementHEX20(elem.id, elem.nodeIds, hexNodes, elem.material.E, elem.material.nu);
        elem._hex20Instance = hex20;
        KeFlat = hex20.computeStiffnessMatrix();
        nel = 60;
      } else if (elem.nodeIds.length === 10) {
        const tetNodes = elem.nodeIds.map((id) => this.nodes[id]);
        const tet10 = new ElementTET10(elem.id, elem.nodeIds, tetNodes, elem.material.E, elem.material.nu);
        elem._tet10Instance = tet10;
        KeFlat = tet10.computeStiffnessMatrix();
        nel = 30;
      } else {
        Ke2D = this._computeTet4Stiffness(elem);
        nel = 12;
      }
      const edofs = [];
      for (const nid of elem.nodeIds) {
        edofs.push(...this.nodes[nid].dof);
      }
      if (KeFlat) {
        for (let i = 0; i < nel; i++) {
          const row = edofs[i];
          const base = i * nel;
          for (let j = i; j < nel; j++) {
            const col = edofs[j];
            const v = i === j ? KeFlat[base + j] : KeFlat[j * nel + i];
            if (row <= col) addTriplet(row, col, v);
            else addTriplet(col, row, v);
          }
        }
      } else {
        for (let i = 0; i < nel; i++) {
          const row = edofs[i];
          const KeRow = Ke2D[i];
          for (let j = i; j < nel; j++) {
            const col = edofs[j];
            const v = i === j ? KeRow[j] : Ke2D[j][i];
            if (row <= col) addTriplet(row, col, v);
            else addTriplet(col, row, v);
          }
        }
      }
    }

    // Compute average positive diagonal magnitude for well-conditioned symmetric BC elimination
    let diagSum = 0.0;
    let diagCount = 0;
    for (let i = 0; i < totalDOF; i++) {
      let d = 0.0;
      for (let e = headR[i]; e !== -1; e = nxtR[e]) {
        if (!del[e] && tj[e] === i) d += tv[e];
      }
      if (d > 0) {
        diagSum += d;
        diagCount++;
      }
    }
    const diagScale = diagCount > 0 ? diagSum / diagCount : 1.0;

    // Apply Dirichlet Boundary Conditions (Strictly Symmetric Row & Column Elimination
    // on the sparse upper-triangle structure). Processing order matches the legacy
    // dense path. In upper-triangle storage the unordered pair {dof, j} is stored
    // exactly once: for j > dof it lives in row dof, for j < dof it lives in
    // column dof. Walking both the row and column lists of dof therefore removes
    // the entire row and column and yields the exact same lifted RHS as the
    // legacy dense symmetric elimination.
    for (const node of this.nodes) {
      for (let d = 0; d < 3; d++) {
        if (!node.isFixed[d]) continue;
        const dof = node.dof[d];
        const ud =
          Array.isArray(node.prescribedDisplacement) && Number.isFinite(node.prescribedDisplacement[d])
            ? node.prescribedDisplacement[d]
            : 0.0;
        let e = headR[dof];
        while (e !== -1) {
          const nextE = nxtR[e];
          if (!del[e]) {
            const j = tj[e];
            if (j !== dof && ud !== 0.0) {
              // Lift prescribed displacement onto the RHS: F[j] -= K[j][dof] * ud
              F[j] -= tv[e] * ud;
            }
            del[e] = 1;
          }
          e = nextE;
        }
        e = headC[dof];
        while (e !== -1) {
          const nextE = nxtC[e];
          if (!del[e]) {
            const i = ti[e];
            if (i !== dof && ud !== 0.0) {
              F[i] -= tv[e] * ud;
            }
            del[e] = 1;
          }
          e = nextE;
        }
        // Restore diagonal and set the fixed displacement
        addTriplet(dof, dof, diagScale);
        F[dof] = diagScale * ud;
      }
    }

    // Build the merged sparse CSR via WasmSparseMultifrontalSolver triplet API
    const sparseSolver = new WasmSparseMultifrontalSolver(totalDOF, totalDOF);
    for (let e = 0; e < cnt; e++) {
      if (!del[e]) sparseSolver.addEntry(ti[e], tj[e], tv[e]);
    }
    sparseSolver.finalizeCSR();

    let u = null;
    let solverUsed = 'none';
    if (totalDOF < 500) {
      // Dense fallback for very small systems
      const A = [];
      const b = Array.from(F);
      const rowPtr = sparseSolver.rowPtr;
      const colIdx = sparseSolver.colIdx;
      const vals = sparseSolver.values;
      for (let i = 0; i < totalDOF; i++) {
        A[i] = new Array(totalDOF).fill(0);
      }
      for (let i = 0; i < totalDOF; i++) {
        for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
          const j = colIdx[p];
          const v = vals[p];
          A[i][j] = v;
          if (j !== i) A[j][i] = v;
        }
      }
      try {
        u = LinearSolver.solveGaussian(A, b);
        solverUsed = 'LinearSolver.solveGaussian';
      } catch (err) {
        u = LinearSolver.solveConjugateGradient(A, b, 2000, 1e-6);
        solverUsed = 'LinearSolver.solveConjugateGradient';
      }
    } else {
      // Primary path: Jacobi-preconditioned conjugate gradients on the sparse
      // upper-triangle CSR matrix (no dense fill and no Cholesky factor fill).
      try {
        u = this._solveJacobiPCG(sparseSolver.rowPtr, sparseSolver.colIdx, sparseSolver.values, F, totalDOF);
        if (u) solverUsed = 'FEASolver.JacobiPCG';
      } catch {
        u = null;
      }
      if (!u) {
        // Escalation: exact sparse Cholesky direct solve (full symmetric rebuild).
        try {
          const directSolver = new WasmSparseMultifrontalSolver(totalDOF, totalDOF);
          const rowPtr = sparseSolver.rowPtr;
          const colIdx = sparseSolver.colIdx;
          const vals = sparseSolver.values;
          for (let i = 0; i < totalDOF; i++) {
            for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
              const j = colIdx[p];
              const v = vals[p];
              directSolver.addEntry(i, j, v);
              if (j !== i) directSolver.addEntry(j, i, v);
            }
          }
          directSolver.finalizeCSR();
          directSolver.factorize();
          const res = directSolver.solve(F);
          u = Array.from(res.solution);
          solverUsed = 'WasmSparseMultifrontalSolver';
        } catch {
          u = null;
        }
      }
    }

    // Fail closed unless the displacement field is complete, finite, and the
    // equilibrium residual of the reduced system is acceptable.
    const relResidual = this._computeSparseRelativeResidual(
      sparseSolver.rowPtr,
      sparseSolver.colIdx,
      sparseSolver.values,
      F,
      u
    );
    if (!u || u.length < totalDOF || u.some((v) => !Number.isFinite(v)) || relResidual >= 1e-4) {
      throw new Error(
        `FEA system solve failed: displacement vector could not be resolved, contains non-finite values, or leaves residual ${relResidual} for ${totalDOF} degrees of freedom.`
      );
    }

    this._lastSystem = {
      K: { rowPtr: sparseSolver.rowPtr, colIdx: sparseSolver.colIdx, values: sparseSolver.values },
      F: Array.from(F),
      u
    };

    // Distribute displacements to nodes
    let maxDisplacement = 0;
    for (const node of this.nodes) {
      node.displacement = [u[node.dof[0]], u[node.dof[1]], u[node.dof[2]]];
      const mag = Math.sqrt(node.displacement[0] ** 2 + node.displacement[1] ** 2 + node.displacement[2] ** 2);
      if (mag > maxDisplacement) maxDisplacement = mag;
    }

    // Compute element strains and von Mises stresses
    let maxStress = 0;
    for (const elem of this.elements) {
      if (elem.nodeIds.length === 20 && elem._hex20Instance) {
        const edofs = [];
        for (const nid of elem.nodeIds) {
          edofs.push(...this.nodes[nid].dof);
        }
        const uElem = new Float64Array(60);
        for (let i = 0; i < 60; i++) uElem[i] = u[edofs[i]];
        const stress = elem._hex20Instance.computeStress(uElem);
        elem.stress = { ...elem.stress, ...stress, vonMises: stress.vonMises };
        if (stress.vonMises > maxStress) maxStress = stress.vonMises;
      } else if (elem.nodeIds.length === 10 && elem._tet10Instance) {
        const edofs = [];
        for (const nid of elem.nodeIds) {
          edofs.push(...this.nodes[nid].dof);
        }
        const uElem = new Float64Array(30);
        for (let i = 0; i < 30; i++) uElem[i] = u[edofs[i]];
        const stress = elem._tet10Instance.computeStress(uElem);
        elem.stress = { ...elem.stress, ...stress, vonMises: stress.vonMises };
        if (stress.vonMises > maxStress) maxStress = stress.vonMises;
      } else {
        const stress = this._computeTet4Stress(elem, u);
        if (!Number.isFinite(stress.vonMises)) {
          throw new Error(
            `FEA solve failed: element #${elem.id} stress calculation produced non-finite von Mises stress.`
          );
        }
        elem.stress = stress;
        if (stress.vonMises > maxStress) maxStress = stress.vonMises;
      }
    }

    this.results = {
      maxStress,
      maxDisplacement,
      yieldRatio: this.elements.length > 0 ? maxStress / this.elements[0].material.yieldStress : 0,
      safetyFactor: maxStress > 0 ? this.elements[0].material.yieldStress / maxStress : 999.0,
      dofCount: totalDOF,
      solverUsed,
      elements: this.elements.map((e) => ({ id: e.id, vonMisesStress: e.stress.vonMises }))
    };

    return this.results;
  }

  /**
   * Sparse residual of the symmetric upper-triangle system: ||F - K u|| / ||F||.
   * @param {Int32Array} rowPtr CSR row pointers (upper triangle)
   * @param {Int32Array} colIdx CSR column indices (upper triangle)
   * @param {Float64Array} values CSR values (upper triangle)
   * @param {Float64Array|Array<number>} F right-hand side
   * @param {Float64Array|Array<number>|null} u candidate solution
   * @returns {number} relative residual (Infinity when u is unusable)
   */
  _computeSparseRelativeResidual(rowPtr, colIdx, values, F, u) {
    const n = F.length;
    if (!u || u.length < n) return Infinity;
    const Au = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
        const j = colIdx[p];
        const v = values[p];
        Au[i] += v * u[j];
        if (j !== i) Au[j] += v * u[i];
      }
    }
    let numeratorSq = 0.0;
    let denominatorSq = 0.0;
    for (let i = 0; i < n; i++) {
      const ri = Au[i] - F[i];
      numeratorSq += ri * ri;
      denominatorSq += F[i] * F[i];
    }
    return Math.sqrt(numeratorSq) / Math.max(1.0, Math.sqrt(denominatorSq));
  }

  /**
   * Jacobi-preconditioned conjugate gradients on a symmetric upper-triangle CSR
   * matrix (rowPtr/colIdx/values store only entries with row <= col). Returns the
   * solution vector or null if the iteration does not converge within maxIterations.
   */
  _solveJacobiPCG(rowPtr, colIdx, values, F, n, maxIterations = 4000, tolerance = 1e-6) {
    const x = new Float64Array(n);
    const r = new Float64Array(F);
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);
    const invD = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // In upper-triangle CSR the diagonal entry is the first column of each row.
      const d = values[rowPtr[i]];
      invD[i] = d > 0 ? 1.0 / d : 1.0;
    }
    for (let i = 0; i < n; i++) {
      z[i] = invD[i] * r[i];
      p[i] = z[i];
    }
    let rz = 0.0;
    for (let i = 0; i < n; i++) rz += r[i] * z[i];
    let bSq = 0.0;
    for (let i = 0; i < n; i++) bSq += F[i] * F[i];
    const r0Norm = Math.sqrt(bSq);
    const r0 = r0Norm > 0 ? r0Norm : 1.0;

    for (let iter = 0; iter < maxIterations; iter++) {
      for (let i = 0; i < n; i++) Ap[i] = 0.0;
      for (let i = 0; i < n; i++) {
        let s = 0.0;
        for (let q = rowPtr[i]; q < rowPtr[i + 1]; q++) {
          const j = colIdx[q];
          const v = values[q];
          s += v * p[j];
          if (j !== i) Ap[j] += v * p[i];
        }
        Ap[i] += s;
      }
      let pAp = 0.0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      if (!(Math.abs(pAp) > 1e-30)) return null;
      const alpha = rz / pAp;
      let resSq = 0.0;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        resSq += r[i] * r[i];
      }
      const resNorm = Math.sqrt(resSq);
      if (resNorm / r0 < tolerance) return x;
      for (let i = 0; i < n; i++) z[i] = invD[i] * r[i];
      let rzNew = 0.0;
      for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
      const beta = rzNew / (rz + 1e-30);
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rz = rzNew;
    }
    return null;
  }

  computeRelativeEquilibriumResidual() {
    const system = this._lastSystem;
    if (!system) {
      return null;
    }
    return this._computeSparseRelativeResidual(system.K.rowPtr, system.K.colIdx, system.K.values, system.F, system.u);
  }

  solve() {
    return this.solveStatic();
  }

  _invert4x4(A) {
    // Gaussian elimination with partial pivoting on a 4x4 matrix copy.
    const n = 4;
    const M = A.map((row) => [...row]);
    const inv = Array.from({ length: n }, (_, i) => {
      const row = new Array(n).fill(0);
      row[i] = 1;
      return row;
    });

    let detSign = 1;
    let detProd = 1;
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      if (Math.abs(M[pivot][col]) < 1e-14) {
        throw new Error('Degenerate tetrahedral element: nodes are coplanar or coincident.');
      }
      if (pivot !== col) {
        [M[col], M[pivot]] = [M[pivot], M[col]];
        [inv[col], inv[pivot]] = [inv[pivot], inv[col]];
        detSign = -detSign;
      }
      detProd *= M[col][col];
      const diag = M[col][col];
      for (let j = 0; j < n; j++) {
        M[col][j] /= diag;
        inv[col][j] /= diag;
      }
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        if (factor === 0) continue;
        for (let j = 0; j < n; j++) {
          M[r][j] -= factor * M[col][j];
          inv[r][j] -= factor * inv[col][j];
        }
      }
    }
    const det = detSign * detProd;
    return { inv, det };
  }

  _tet4ConstantStrain(elem) {
    // 4-node Constant Strain Tetrahedron (CST) element geometry.
    // Compute the linear shape functions N_i(x,y,z) = alpha_i + beta_i x + gamma_i y + delta_i z
    // by inverting the nodal interpolation matrix, then build B and D.
    const p = elem.nodeIds.map((id) => this.nodes[id]);
    const X = p.map((n) => [1, n.x, n.y, n.z]);

    const { inv, det } = this._invert4x4(X);
    const V6 = det;
    if (Math.abs(V6) < 1e-14) {
      throw new Error(
        `Degenerate tetrahedral element #${elem.id}: volume is zero or near zero (nodes are coplanar or coincident).`
      );
    }
    const volume = Math.abs(V6) / 6.0;

    // Column i of inv holds [alpha, beta, gamma, delta] for shape function N_i.
    const grads = [];
    for (let i = 0; i < 4; i++) {
      grads.push({ b: inv[1][i], c: inv[2][i], d: inv[3][i] });
    }

    // Construct 6x12 Strain-Displacement matrix B
    const B = Array.from({ length: 6 }, () => new Float64Array(12));
    for (let i = 0; i < 4; i++) {
      const cIdx = i * 3;
      const { b, c, d } = grads[i];
      B[0][cIdx] = b;
      B[1][cIdx + 1] = c;
      B[2][cIdx + 2] = d;
      B[3][cIdx] = c;
      B[3][cIdx + 1] = b;
      B[4][cIdx + 1] = d;
      B[4][cIdx + 2] = c;
      B[5][cIdx] = d;
      B[5][cIdx + 2] = b;
    }

    // Construct 6x6 Elasticity matrix D
    const E = elem.material.E;
    const nu = elem.material.nu;
    const factor = E / ((1 + nu) * (1 - 2 * nu));
    const D = [
      [1 - nu, nu, nu, 0, 0, 0],
      [nu, 1 - nu, nu, 0, 0, 0],
      [nu, nu, 1 - nu, 0, 0, 0],
      [0, 0, 0, (1 - 2 * nu) / 2, 0, 0],
      [0, 0, 0, 0, (1 - 2 * nu) / 2, 0],
      [0, 0, 0, 0, 0, (1 - 2 * nu) / 2]
    ].map((row) => row.map((v) => v * factor));

    return { B, D, volume };
  }

  _computeTet4Stiffness(elem) {
    // 4-node Constant Strain Tetrahedron (CST) element stiffness
    const { B, D, volume } = this._tet4ConstantStrain(elem);

    // Ke = volume * (B^T * D * B)
    const DB = Array.from({ length: 6 }, () => new Float64Array(12));
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 12; j++) {
        let sum = 0;
        for (let k = 0; k < 6; k++) sum += D[i][k] * B[k][j];
        DB[i][j] = sum;
      }
    }

    const Ke = Array.from({ length: 12 }, () => new Float64Array(12));
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        let sum = 0;
        for (let k = 0; k < 6; k++) sum += B[k][i] * DB[k][j];
        Ke[i][j] = sum * volume;
      }
    }

    return Ke;
  }

  _computeTet4Stress(elem, u) {
    // Authentic constant-strain TET4 stress recovery: sigma = D * B * u_e
    const { B, D } = this._tet4ConstantStrain(elem);

    const ue = [];
    for (const nid of elem.nodeIds) {
      ue.push(u[this.nodes[nid].dof[0]], u[this.nodes[nid].dof[1]], u[this.nodes[nid].dof[2]]);
    }

    const strain = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      let sum = 0;
      for (let j = 0; j < 12; j++) sum += B[i][j] * ue[j];
      strain[i] = sum;
    }

    const sigma = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      let sum = 0;
      for (let k = 0; k < 6; k++) sum += D[i][k] * strain[k];
      sigma[i] = sum;
    }

    const [xx, yy, zz, xy, yz, zx] = sigma;
    const vonMises = Math.sqrt(
      0.5 * ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) + 3 * (xy * xy + yz * yz + zx * zx)
    );
    return { xx, yy, zz, xy, yz, zx, vonMises };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FEANode, FEAElement, FEASolver };
}
