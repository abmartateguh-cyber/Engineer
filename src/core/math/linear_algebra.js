/**
 * OmniEng Core Mathematics: Linear Algebra, Vector, Matrix, Quaternion & Linear Solvers
 * Provides deterministic, high-precision mathematical operations for CAD, CAE, and GNC.
 */

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v) {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return new Vector3(x, y, z);
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  normalize() {
    const len = this.length();
    if (len > 1e-12) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  distanceTo(v) {
    return Math.sqrt(
      (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2
    );
  }

  toArray() {
    return [this.x, this.y, this.z];
  }

  static fromArray(arr) {
    return new Vector3(arr[0] || 0, arr[1] || 0, arr[2] || 0);
  }
}

class Quaternion {
  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = Number(w);
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
  }

  clone() {
    return new Quaternion(this.w, this.x, this.y, this.z);
  }

  set(w, x, y, z) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setFromAxisAngle(axis, angle) {
    const halfAngle = angle * 0.5;
    const s = Math.sin(halfAngle);
    const norm = axis.clone().normalize();
    this.w = Math.cos(halfAngle);
    this.x = norm.x * s;
    this.y = norm.y * s;
    this.z = norm.z * s;
    return this.normalize();
  }

  multiply(q) {
    const w = this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z;
    const x = this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y;
    const y = this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x;
    const z = this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w;
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  normalize() {
    const len = Math.sqrt(
      this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z
    );
    if (len > 1e-12) {
      this.w /= len;
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  rotateVector(v) {
    // q * (0, v) * q_conjugate
    const qx = this.x, qy = this.y, qz = this.z, qw = this.w;
    const vx = v.x, vy = v.y, vz = v.z;

    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;

    const x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    const y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    const z = iz * qw + iw * -qz + ix * -qy - iy * -qx;

    return new Vector3(x, y, z);
  }

  static fromEuler(roll, pitch, yaw) {
    // roll (x), pitch (y), yaw (z) in radians
    const cr = Math.cos(roll * 0.5);
    const sr = Math.sin(roll * 0.5);
    const cp = Math.cos(pitch * 0.5);
    const sp = Math.sin(pitch * 0.5);
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);

    const w = cr * cp * cy + sr * sp * sy;
    const x = sr * cp * cy - cr * sp * sy;
    const y = cr * sp * cy + sr * cp * sy;
    const z = cr * cp * sy - sr * sp * cy;

    return new Quaternion(w, x, y, z).normalize();
  }

  toEuler() {
    // roll (x), pitch (y), yaw (z)
    const sinr_cosp = 2 * (this.w * this.x + this.y * this.z);
    const cosr_cosp = 1 - 2 * (this.x * this.x + this.y * this.y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    const sinp = 2 * (this.w * this.y - this.z * this.x);
    let pitch;
    if (Math.abs(sinp) >= 1) {
      pitch = Math.sign(sinp) * (Math.PI / 2);
    } else {
      pitch = Math.asin(sinp);
    }

    const siny_cosp = 2 * (this.w * this.z + this.x * this.y);
    const cosy_cosp = 1 - 2 * (this.y * this.y + this.z * this.z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return { roll, pitch, yaw };
  }

  toEulerAngles() {
    return this.toEuler();
  }
}

/**
 * Dense & Linear System Matrix Solver
 */
class LinearSolver {
  /**
   * Solve Ax = b via Gaussian Elimination with Partial Pivoting
   * @param {Array<Array<number>>} A square matrix [n x n]
   * @param {Array<number>} b RHS vector [n]
   * @returns {Array<number>} solution vector x
   */
  static solveGaussian(A, b) {
    const n = A.length;
    // Deep clone augmented matrix
    const M = [];
    for (let i = 0; i < n; i++) {
      M[i] = [...A[i], b[i]];
    }

    // Forward elimination
    for (let p = 0; p < n; p++) {
      // Find pivot row
      let maxRow = p;
      for (let r = p + 1; r < n; r++) {
        if (Math.abs(M[r][p]) > Math.abs(M[maxRow][p])) {
          maxRow = r;
        }
      }
      if (maxRow !== p) {
        const temp = M[p];
        M[p] = M[maxRow];
        M[maxRow] = temp;
      }

      if (Math.abs(M[p][p]) < 1e-14) {
        throw new Error(`Matrix is singular or near-singular at pivot ${p}`);
      }

      for (let r = p + 1; r < n; r++) {
        const factor = M[r][p] / M[p][p];
        for (let c = p; c <= n; c++) {
          M[r][c] -= factor * M[p][c];
        }
      }
    }

    // Back substitution
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let sum = M[r][n];
      for (let c = r + 1; c < n; c++) {
        sum -= M[r][c] * x[c];
      }
      x[r] = sum / M[r][r];
    }

    return x;
  }

  /**
   * Solve positive-definite symmetric system Ax = b using Conjugate Gradient
   */
  static solveConjugateGradient(A, b, arg3 = 1000, arg4 = 1e-8, arg5 = 1e-8) {
    const n = b.length;
    let x;
    let maxIter;
    let tol;

    if (Array.isArray(arg3)) {
      x = [...arg3];
      maxIter = typeof arg4 === 'number' ? arg4 : 1000;
      tol = typeof arg5 === 'number' ? arg5 : 1e-8;
    } else {
      x = new Array(n).fill(0);
      maxIter = typeof arg3 === 'number' ? arg3 : 1000;
      tol = typeof arg4 === 'number' ? arg4 : 1e-8;
    }
    
    // r = b - A*x
    const Ax = LinearSolver.matVecMul(A, x);
    let r = b.map((val, i) => val - Ax[i]);
    let p = [...r];
    let rsold = LinearSolver.dot(r, r);

    if (Math.sqrt(rsold) < tol) return x;

    for (let iter = 0; iter < maxIter; iter++) {
      const Ap = LinearSolver.matVecMul(A, p);
      const pAp = LinearSolver.dot(p, Ap);
      if (Math.abs(pAp) < 1e-15) break;

      const alpha = rsold / pAp;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
      }

      const rsnew = LinearSolver.dot(r, r);
      if (Math.sqrt(rsnew) < tol) break;

      const beta = rsnew / rsold;
      for (let i = 0; i < n; i++) {
        p[i] = r[i] + beta * p[i];
      }
      rsold = rsnew;
    }

    return x;
  }

  static matVecMul(A, x) {
    const n = A.length;
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const row = A[i];
      for (let j = 0; j < row.length; j++) {
        sum += row[j] * x[j];
      }
      y[i] = sum;
    }
    return y;
  }

  static dot(u, v) {
    let s = 0;
    for (let i = 0; i < u.length; i++) s += u[i] * v[i];
    return s;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vector3, Quaternion, LinearSolver };
}
