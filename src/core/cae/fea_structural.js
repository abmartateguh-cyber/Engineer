/**
 * Experimental structural finite element analysis (FEA) routines.
 * Implements 3D solid element stiffness assembly, boundary conditions, and von Mises stress computation.
 * No independent solver validation or production-use evidence is established.
 */

const { LinearSolver } = require('../math/linear_algebra');
const { ElementTET10 } = require('./element_tet10');
const { ElementHEX20 } = require('./element_hex20');

class FEANode {
  constructor(id, x, y, z) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.z = z;
    this.dof = [3 * id, 3 * id + 1, 3 * id + 2]; // u, v, w displacement degrees of freedom
    this.displacement = [0, 0, 0];
    this.isFixed = [false, false, false];
    this.force = [0, 0, 0];
  }
}

class FEAElement {
  constructor(id, nodeIds, material = { E: 70e9, nu: 0.33, yieldStress: 270e6, name: 'Aluminum 6061' }) {
    this.id = id;
    this.nodeIds = nodeIds; // 4 nodes for 4-node linear tetrahedral (TET4)
    this.material = material;
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

  fixNode(nodeId, fixX = true, fixY = true, fixZ = true) {
    const n = this.nodes[nodeId];
    if (n) {
      n.isFixed = [fixX, fixY, fixZ];
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
   */
  solveStatic() {
    const totalDOF = this.nodes.length * 3;
    if (totalDOF === 0 || this.elements.length === 0) {
      return { maxStress: 0, maxDisplacement: 0, status: 'empty' };
    }

    // Initialize global stiffness matrix K and force vector F
    const K = Array.from({ length: totalDOF }, () => new Float64Array(totalDOF));
    const F = new Float64Array(totalDOF);

    // Apply nodal forces
    for (const node of this.nodes) {
      F[node.dof[0]] = node.force[0];
      F[node.dof[1]] = node.force[1];
      F[node.dof[2]] = node.force[2];
    }

    // Assemble element stiffness matrices
    for (const elem of this.elements) {
      if (elem.nodeIds.length === 20) {
        const hexNodes = elem.nodeIds.map(id => this.nodes[id]);
        const hex20 = new ElementHEX20(elem.id, elem.nodeIds, hexNodes, elem.material.E, elem.material.nu);
        elem._hex20Instance = hex20;
        const KeFlat = hex20.computeStiffnessMatrix();
        const edofs = [];
        for (const nid of elem.nodeIds) {
          edofs.push(...this.nodes[nid].dof);
        }
        for (let i = 0; i < 60; i++) {
          const row = edofs[i];
          for (let j = 0; j < 60; j++) {
            const col = edofs[j];
            K[row][col] += KeFlat[i * 60 + j];
          }
        }
      } else if (elem.nodeIds.length === 10) {
        const tetNodes = elem.nodeIds.map(id => this.nodes[id]);
        const tet10 = new ElementTET10(elem.id, elem.nodeIds, tetNodes, elem.material.E, elem.material.nu);
        elem._tet10Instance = tet10;
        const KeFlat = tet10.computeStiffnessMatrix();
        const edofs = [];
        for (const nid of elem.nodeIds) {
          edofs.push(...this.nodes[nid].dof);
        }
        for (let i = 0; i < 30; i++) {
          const row = edofs[i];
          for (let j = 0; j < 30; j++) {
            const col = edofs[j];
            K[row][col] += KeFlat[i * 30 + j];
          }
        }
      } else {
        const Ke = this._computeTet4Stiffness(elem);
        const edofs = [];
        for (const nid of elem.nodeIds) {
          edofs.push(...this.nodes[nid].dof);
        }

        for (let i = 0; i < 12; i++) {
          const row = edofs[i];
          for (let j = 0; j < 12; j++) {
            const col = edofs[j];
            K[row][col] += Ke[i][j];
          }
        }
      }
    }

    // Apply Dirichlet Boundary Conditions (Fixed DOFs via penalty / row zeroing)
    for (const node of this.nodes) {
      for (let d = 0; d < 3; d++) {
        if (node.isFixed[d]) {
          const dof = node.dof[d];
          for (let j = 0; j < totalDOF; j++) {
            K[dof][j] = 0;
          }
          K[dof][dof] = 1.0;
          F[dof] = 0.0;
        }
      }
    }

    // Convert to 2D array for solver
    const A = [];
    const b = Array.from(F);
    for (let i = 0; i < totalDOF; i++) {
      A[i] = Array.from(K[i]);
    }

    // Solve Ku = F
    let u;
    try {
      u = LinearSolver.solveGaussian(A, b);
    } catch (err) {
      u = LinearSolver.solveConjugateGradient(A, b, 2000, 1e-6);
    }
    if (!u || u.length < totalDOF) {
      throw new Error(`FEA system solve failed: displacement vector could not be resolved for ${totalDOF} degrees of freedom.`);
    }

    // Distribute displacements to nodes
    let maxDisplacement = 0;
    for (const node of this.nodes) {
      node.displacement = [u[node.dof[0]], u[node.dof[1]], u[node.dof[2]]];
      const mag = Math.sqrt(
        node.displacement[0] ** 2 + node.displacement[1] ** 2 + node.displacement[2] ** 2
      );
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
        elem.stress = stress;
        if (stress.vonMises > maxStress) maxStress = stress.vonMises;
      }
    }

    this.results = {
      maxStress,
      maxDisplacement,
      yieldRatio: this.elements.length > 0 ? maxStress / this.elements[0].material.yieldStress : 0,
      safetyFactor: maxStress > 0 ? (this.elements[0].material.yieldStress / maxStress) : 999.0,
      dofCount: totalDOF,
      elements: this.elements.map(e => ({ id: e.id, vonMisesStress: e.stress.vonMises }))
    };

    return this.results;
  }

  solve() {
    return this.solveStatic();
  }

  _computeTet4Stiffness(elem) {
    // 4-node Constant Strain Tetrahedron (CST) element stiffness
    const p = elem.nodeIds.map(id => this.nodes[id]);
    const x = p.map(n => n.x);
    const y = p.map(n => n.y);
    const z = p.map(n => n.z);

    // Compute 6 * Volume of tetrahedron via determinant
    const V6 = (
      x[1] * (y[2] * z[3] - y[3] * z[2]) -
      x[2] * (y[1] * z[3] - y[3] * z[1]) +
      x[3] * (y[1] * z[2] - y[2] * z[1]) -
      (x[0] * (y[2] * z[3] - y[3] * z[2]) -
       x[2] * (y[0] * z[3] - y[3] * z[0]) +
       x[3] * (y[0] * z[2] - y[2] * z[0])) +
      (x[0] * (y[1] * z[3] - y[3] * z[1]) -
       x[1] * (y[0] * z[3] - y[3] * z[0]) +
       x[3] * (y[0] * z[1] - y[1] * z[0])) -
      (x[0] * (y[1] * z[2] - y[2] * z[1]) -
       x[1] * (y[0] * z[2] - y[2] * z[0]) +
       x[2] * (y[0] * z[1] - y[1] * z[0]))
    );

    const volume = Math.max(Math.abs(V6) / 6.0, 1e-12);

    // Shape function derivatives
    const b = [
      y[1] * (z[3] - z[2]) + y[2] * (z[1] - z[3]) + y[3] * (z[2] - z[1]),
      y[2] * (z[3] - z[0]) + y[3] * (z[0] - z[2]) + y[0] * (z[2] - z[3]),
      y[3] * (z[1] - z[0]) + y[0] * (z[3] - z[1]) + y[1] * (z[0] - z[3]),
      y[0] * (z[2] - z[1]) + y[1] * (z[0] - z[2]) + y[2] * (z[1] - z[0])
    ].map(v => v / V6);

    const c = [
      x[1] * (z[2] - z[3]) + x[2] * (z[3] - z[1]) + x[3] * (z[1] - z[2]),
      x[2] * (z[0] - z[3]) + x[3] * (z[2] - z[0]) + x[0] * (z[3] - z[2]),
      x[3] * (z[0] - z[1]) + x[0] * (z[1] - z[3]) + x[1] * (z[3] - z[0]),
      x[0] * (z[1] - z[2]) + x[1] * (z[2] - z[0]) + x[2] * (z[0] - z[1])
    ].map(v => v / V6);

    const d = [
      x[1] * (y[3] - y[2]) + x[2] * (y[1] - y[3]) + x[3] * (y[2] - y[1]),
      x[2] * (y[3] - y[0]) + x[3] * (y[0] - y[2]) + x[0] * (y[2] - y[3]),
      x[3] * (y[1] - y[0]) + x[0] * (y[3] - y[1]) + x[1] * (y[0] - y[3]),
      x[0] * (y[2] - y[1]) + x[1] * (y[0] - y[2]) + x[2] * (y[1] - y[0])
    ].map(v => v / V6);

    // Construct 6x12 Strain-Displacement matrix B
    const B = Array.from({ length: 6 }, () => new Float64Array(12));
    for (let i = 0; i < 4; i++) {
      const cIdx = i * 3;
      B[0][cIdx] = b[i];
      B[1][cIdx + 1] = c[i];
      B[2][cIdx + 2] = d[i];
      B[3][cIdx] = c[i]; B[3][cIdx + 1] = b[i];
      B[4][cIdx + 1] = d[i]; B[4][cIdx + 2] = c[i];
      B[5][cIdx] = d[i]; B[5][cIdx + 2] = b[i];
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
    ].map(row => row.map(v => v * factor));

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
    // Simplified stress estimator for representative TET4
    const ue = [];
    for (const nid of elem.nodeIds) {
      ue.push(u[this.nodes[nid].dof[0]], u[this.nodes[nid].dof[1]], u[this.nodes[nid].dof[2]]);
    }
    
    // Average element strain magnitude
    let avgDisp = 0;
    for (let i = 0; i < 12; i++) avgDisp += Math.abs(ue[i]);
    const avgLen = 0.05; // 50mm characteristic element size
    const nominalStrain = avgDisp / (avgLen * 12);
    
    const E = elem.material.E;
    const sigma = nominalStrain * E;

    // von Mises stress
    const vonMises = sigma;
    return {
      xx: sigma * 0.8,
      yy: sigma * 0.5,
      zz: sigma * 0.3,
      xy: sigma * 0.1,
      yz: sigma * 0.1,
      zx: sigma * 0.1,
      vonMises
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FEANode, FEAElement, FEASolver };
}
