'use strict';

/**
 * Experimental serial manipulator kinematics, dynamics and trajectory engine
 *
 * Implements:
 * 1. Standard & Modified Denavit-Hartenberg (DH) and Product of Exponentials (PoE) Forward Kinematics
 *    with 4x4 SE(3) link transforms, quaternion & ZYX Euler orientation, 6xn Space/Body Geometric
 *    Jacobians, and Yoshikawa manipulability index w(q) = sqrt(max(0, det(J * J^T))).
 * 2. Damped Least-Squares (Levenberg-Marquardt) Numerical Inverse Kinematics for 6-DOF / 7-DOF
 *    manipulators with SO(3) quaternion logarithm orientation error, joint-limit clamping, and
 *    singularity robustness.
 * 3. Recursive Newton-Euler Algorithm (RNEA) Inverse Dynamics (outward velocity/acceleration
 *    propagation + inward wrench recursion) for exact joint torques tau = M(q)qdd + C(q,qd)qd + g(q).
 * 4. Minimum-Jerk Quintic Polynomial Trajectory Planner generating C^2-continuous [q, qd, qdd, qddd]
 *    profiles with peak velocity, acceleration, and torque limit verification.
 * 5. Deterministic URDF XML/JSON Kinematic Chain Parser (<robot>, <link>, <joint>, <origin>, <axis>,
 *    <limit>, <inertial>).
 * 6. Reference manipulator presets: PUMA_560_DH, UR5E_DH, KUKA_IIWA_7DOF_DH.
 */

// ============================================================================
// Linear Algebra & Lie Group SE(3) / SO(3) Helpers
// ============================================================================

function mat4Identity() {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ];
}

function mat4Mul(A, B) {
  const C = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < 4; j++) {
        C[i][j] += aik * B[k][j];
      }
    }
  }
  return C;
}

function mat3Transpose(R) {
  return [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]]
  ];
}

function mat3Mul(A, B) {
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) {
      const aik = A[i][k];
      for (let j = 0; j < 3; j++) {
        C[i][j] += aik * B[k][j];
      }
    }
  }
  return C;
}

function mat3VecMul(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]
  ];
}

function vec3Add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vec3Sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vec3Scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vec3Cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vec3Norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function skew3(w) {
  return [
    [0, -w[2], w[1]],
    [w[2], 0, -w[0]],
    [-w[1], w[0], 0]
  ];
}

/**
 * Rodrigues' rotation formula: exp([axis]_x * theta)
 */
function axisAngleToRot3(axis, theta) {
  const norm = vec3Norm(axis);
  if (norm < 1e-12 || Math.abs(theta) < 1e-15) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
  }
  const ux = axis[0] / norm;
  const uy = axis[1] / norm;
  const uz = axis[2] / norm;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const v = 1 - c;
  return [
    [ux * ux * v + c, ux * uy * v - uz * s, ux * uz * v + uy * s],
    [uy * ux * v + uz * s, uy * uy * v + c, uy * uz * v - ux * s],
    [uz * ux * v - uy * s, uz * uy * v + ux * s, uz * uz * v + c]
  ];
}

/**
 * RPY (roll about X, pitch about Y, yaw about Z: R = Rz(yaw) * Ry(pitch) * Rx(roll))
 */
function rpyToRot3(roll, pitch, yaw) {
  const cr = Math.cos(roll),
    sr = Math.sin(roll);
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr]
  ];
}

function rot3ToEulerZYX(R) {
  const r20 = Math.max(-1.0, Math.min(1.0, -R[2][0]));
  const pitch = Math.asin(r20);
  let yaw, roll;
  if (Math.abs(Math.cos(pitch)) > 1e-7) {
    yaw = Math.atan2(R[1][0], R[0][0]);
    roll = Math.atan2(R[2][1], R[2][2]);
  } else {
    yaw = Math.atan2(-R[0][1], R[1][1]);
    roll = 0.0;
  }
  return [yaw, pitch, roll];
}

function rot3ToQuaternion(R) {
  const tr = R[0][0] + R[1][1] + R[2][2];
  let qw, qx, qy, qz;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1.0) * 2.0;
    qw = 0.25 * S;
    qx = (R[2][1] - R[1][2]) / S;
    qy = (R[0][2] - R[2][0]) / S;
    qz = (R[1][0] - R[0][1]) / S;
  } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const S = Math.sqrt(1.0 + R[0][0] - R[1][1] - R[2][2]) * 2.0;
    qw = (R[2][1] - R[1][2]) / S;
    qx = 0.25 * S;
    qy = (R[0][1] + R[1][0]) / S;
    qz = (R[0][2] + R[2][0]) / S;
  } else if (R[1][1] > R[2][2]) {
    const S = Math.sqrt(1.0 + R[1][1] - R[0][0] - R[2][2]) * 2.0;
    qw = (R[0][2] - R[2][0]) / S;
    qx = (R[0][1] + R[1][0]) / S;
    qy = 0.25 * S;
    qz = (R[1][2] + R[2][1]) / S;
  } else {
    const S = Math.sqrt(1.0 + R[2][2] - R[0][0] - R[1][1]) * 2.0;
    qw = (R[1][0] - R[0][1]) / S;
    qx = (R[0][2] + R[2][0]) / S;
    qy = (R[1][2] + R[2][1]) / S;
    qz = 0.25 * S;
  }
  const norm = Math.hypot(qw, qx, qy, qz) || 1.0;
  qw /= norm;
  qx /= norm;
  qy /= norm;
  qz /= norm;
  if (qw < 0) {
    qw = -qw;
    qx = -qx;
    qy = -qy;
    qz = -qz;
  }
  return [qw, qx, qy, qz];
}

function quaternionToRot3(q) {
  const norm = Math.hypot(q[0], q[1], q[2], q[3]) || 1.0;
  const qw = q[0] / norm;
  const qx = q[1] / norm;
  const qy = q[2] / norm;
  const qz = q[3] / norm;
  return [
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]
  ];
}

/**
 * Matrix exponential on se(3): exp([S] * theta) where S = [wx, wy, wz, vx, vy, vz]
 */
function se3Exp(screwAxis, theta) {
  const w = [screwAxis[0], screwAxis[1], screwAxis[2]];
  const v = [screwAxis[3], screwAxis[4], screwAxis[5]];
  const wNorm = vec3Norm(w);

  if (wNorm < 1e-12) {
    return [
      [1, 0, 0, v[0] * theta],
      [0, 1, 0, v[1] * theta],
      [0, 0, 1, v[2] * theta],
      [0, 0, 0, 1]
    ];
  }

  const R = axisAngleToRot3(w, theta * wNorm);
  const wn = vec3Scale(w, 1.0 / wNorm);
  const vn = vec3Scale(v, 1.0 / wNorm);
  const th = theta * wNorm;
  const W = skew3(wn);
  const W2 = mat3Mul(W, W);
  const c1 = 1.0 - Math.cos(th);
  const c2 = th - Math.sin(th);

  const Gv = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let sum = wn[i] * vec3Dot(wn, vn) * th;
    sum += c1 * (W[i][0] * vn[0] + W[i][1] * vn[1] + W[i][2] * vn[2]);
    // Wait: G(th) = I*th + (1-cos(th))*W + (th-sin(th))*W^2
    // Notice (I + W^2)*v = wn*(wn^T*v)
    Gv[i] =
      vn[i] * th +
      c1 * (W[i][0] * vn[0] + W[i][1] * vn[1] + W[i][2] * vn[2]) +
      c2 * (W2[i][0] * vn[0] + W2[i][1] * vn[1] + W2[i][2] * vn[2]);
  }

  return [
    [R[0][0], R[0][1], R[0][2], Gv[0]],
    [R[1][0], R[1][1], R[1][2], Gv[1]],
    [R[2][0], R[2][1], R[2][2], Gv[2]],
    [0, 0, 0, 1]
  ];
}

/**
 * Exact determinant of an m x m square matrix via Gaussian elimination with partial pivoting
 */
function matrixDeterminant(M) {
  const n = M.length;
  if (n === 0) return 0;
  const A = M.map((row) => Float64Array.from(row));
  let det = 1.0;

  for (let i = 0; i < n; i++) {
    let pivotRow = i;
    let maxVal = Math.abs(A[i][i]);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(A[r][i]);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-15) return 0.0;
    if (pivotRow !== i) {
      const tmp = A[i];
      A[i] = A[pivotRow];
      A[pivotRow] = tmp;
      det = -det;
    }
    const pivot = A[i][i];
    det *= pivot;
    for (let r = i + 1; r < n; r++) {
      const factor = A[r][i] / pivot;
      for (let c = i + 1; c < n; c++) {
        A[r][c] -= factor * A[i][c];
      }
    }
  }
  return det;
}

/**
 * Solve linear system A * x = b using Gaussian elimination with partial pivoting
 */
function solveLinearSystem(AInput, bInput) {
  const n = AInput.length;
  const A = AInput.map((row) => Float64Array.from(row));
  const b = Float64Array.from(bInput);

  for (let i = 0; i < n; i++) {
    let pivotRow = i;
    let maxVal = Math.abs(A[i][i]);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(A[r][i]);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (pivotRow !== i) {
      const tmp = A[i];
      A[i] = A[pivotRow];
      A[pivotRow] = tmp;
      const tb = b[i];
      b[i] = b[pivotRow];
      b[pivotRow] = tb;
    }
    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-14) {
      A[i][i] = pivot >= 0 ? 1e-14 : -1e-14;
    }
    for (let r = i + 1; r < n; r++) {
      const factor = A[r][i] / A[i][i];
      b[r] -= factor * b[i];
      for (let c = i; c < n; c++) {
        A[r][c] -= factor * A[i][c];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let c = i + 1; c < n; c++) {
      sum -= A[i][c] * x[c];
    }
    x[i] = sum / A[i][i];
  }
  return x;
}

// ============================================================================
// Standard Verified Reference Manipulator Presets
// ============================================================================

function createPresetTable(rows, metadata) {
  const clonedRows = rows.map((r) => Object.freeze({ ...r }));
  Object.defineProperties(clonedRows, {
    name: { value: metadata.name, enumerable: false },
    dof: { value: rows.length, enumerable: false },
    convention: { value: metadata.convention || 'standard', enumerable: false },
    description: { value: metadata.description || '', enumerable: false },
    dhTable: { value: clonedRows, enumerable: false },
    jointLimits: { value: Object.freeze(metadata.jointLimits.map((l) => Object.freeze({ ...l }))), enumerable: false },
    linkInertias: { value: Object.freeze(metadata.linkInertias.map((l) => Object.freeze({ ...l }))), enumerable: false }
  });
  return Object.freeze(clonedRows);
}

/**
 * Unimate PUMA 560 6-DOF Industrial Manipulator (Corke / Armstrong Standard DH parameters)
 */
const PUMA_560_DH = createPresetTable(
  [
    { joint: 1, a: 0.0, alpha: Math.PI / 2, d: 0.6718, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 2, a: 0.4318, alpha: 0.0, d: 0.0, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 3, a: 0.0203, alpha: -Math.PI / 2, d: 0.15005, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 4, a: 0.0, alpha: Math.PI / 2, d: 0.4318, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 5, a: 0.0, alpha: -Math.PI / 2, d: 0.0, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 6, a: 0.0, alpha: 0.0, d: 0.0565, theta: 0.0, type: 'revolute', convention: 'standard' }
  ],
  {
    name: 'PUMA_560',
    convention: 'standard',
    description: 'Unimate PUMA 560 6-DOF industrial manipulator (Armstrong, Khatib & Burdick 1986)',
    jointLimits: [
      { min: (-160 * Math.PI) / 180, max: (160 * Math.PI) / 180, maxVelocity: 2.0, maxTorque: 97.6 },
      { min: (-110 * Math.PI) / 180, max: (110 * Math.PI) / 180, maxVelocity: 2.0, maxTorque: 186.4 },
      { min: (-135 * Math.PI) / 180, max: (135 * Math.PI) / 180, maxVelocity: 2.5, maxTorque: 89.4 },
      { min: (-266 * Math.PI) / 180, max: (266 * Math.PI) / 180, maxVelocity: 3.5, maxTorque: 24.2 },
      { min: (-100 * Math.PI) / 180, max: (100 * Math.PI) / 180, maxVelocity: 3.5, maxTorque: 20.1 },
      { min: (-266 * Math.PI) / 180, max: (266 * Math.PI) / 180, maxVelocity: 4.5, maxTorque: 21.3 }
    ],
    linkInertias: [
      { mass: 12.95, com: [0.0, -0.3, 0.0], inertia: [2.35, 0.2, 2.35] },
      { mass: 17.4, com: [-0.3638, 0.006, 0.2275], inertia: [0.13, 0.524, 0.539] },
      { mass: 4.8, com: [-0.0203, -0.0141, 0.07], inertia: [0.066, 0.086, 0.0125] },
      { mass: 0.82, com: [0.0, 0.019, 0.0], inertia: [0.0018, 0.0013, 0.0018] },
      { mass: 0.34, com: [0.0, 0.0, 0.0], inertia: [0.0003, 0.0004, 0.0003] },
      { mass: 0.09, com: [0.0, 0.0, 0.032], inertia: [0.00015, 0.00015, 0.00004] }
    ]
  }
);

/**
 * Universal Robots UR5e 6-DOF Collaborative Industrial Manipulator (Official UR5e Standard DH)
 */
const UR5E_DH = createPresetTable(
  [
    { joint: 1, a: 0.0, alpha: Math.PI / 2, d: 0.1625, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 2, a: -0.425, alpha: 0.0, d: 0.0, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 3, a: -0.3922, alpha: 0.0, d: 0.0, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 4, a: 0.0, alpha: Math.PI / 2, d: 0.1333, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 5, a: 0.0, alpha: -Math.PI / 2, d: 0.0997, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 6, a: 0.0, alpha: 0.0, d: 0.0996, theta: 0.0, type: 'revolute', convention: 'standard' }
  ],
  {
    name: 'UR5E',
    convention: 'standard',
    description: 'Universal Robots UR5e 6-DOF collaborative robot manipulator',
    jointLimits: [
      { min: -2 * Math.PI, max: 2 * Math.PI, maxVelocity: Math.PI, maxTorque: 150.0 },
      { min: -2 * Math.PI, max: 2 * Math.PI, maxVelocity: Math.PI, maxTorque: 150.0 },
      { min: -Math.PI, max: Math.PI, maxVelocity: Math.PI, maxTorque: 150.0 },
      { min: -2 * Math.PI, max: 2 * Math.PI, maxVelocity: Math.PI, maxTorque: 28.0 },
      { min: -2 * Math.PI, max: 2 * Math.PI, maxVelocity: Math.PI, maxTorque: 28.0 },
      { min: -2 * Math.PI, max: 2 * Math.PI, maxVelocity: Math.PI, maxTorque: 28.0 }
    ],
    linkInertias: [
      { mass: 3.761, com: [0.0, -0.02561, 0.00193], inertia: [0.0084, 0.0064, 0.0084] },
      { mass: 8.058, com: [0.2125, 0.0, 0.11336], inertia: [0.015, 0.33, 0.33] },
      { mass: 2.846, com: [0.15, 0.0, 0.0265], inertia: [0.005, 0.068, 0.068] },
      { mass: 1.37, com: [0.0, -0.0018, 0.01634], inertia: [0.0016, 0.0016, 0.0012] },
      { mass: 1.3, com: [0.0, 0.0018, 0.01634], inertia: [0.0015, 0.0015, 0.0011] },
      { mass: 0.365, com: [0.0, 0.0, -0.001159], inertia: [0.0002, 0.0002, 0.00025] }
    ]
  }
);

/**
 * KUKA LBR iiwa 14 R820 7-DOF Redundant Torque-Controlled Manipulator
 */
const KUKA_IIWA_7DOF_DH = createPresetTable(
  [
    { joint: 1, a: 0.0, alpha: -Math.PI / 2, d: 0.36, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 2, a: 0.0, alpha: Math.PI / 2, d: 0.0, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 3, a: 0.0, alpha: Math.PI / 2, d: 0.42, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 4, a: 0.0, alpha: -Math.PI / 2, d: 0.0, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 5, a: 0.0, alpha: -Math.PI / 2, d: 0.4, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 6, a: 0.0, alpha: Math.PI / 2, d: 0.0, theta: 0.0, type: 'revolute', convention: 'standard' },
    { joint: 7, a: 0.0, alpha: 0.0, d: 0.126, theta: 0.0, type: 'revolute', convention: 'standard' }
  ],
  {
    name: 'KUKA_IIWA_7DOF',
    convention: 'standard',
    description: 'KUKA LBR iiwa 14 R820 7-DOF redundant serial manipulator',
    jointLimits: [
      { min: (-170 * Math.PI) / 180, max: (170 * Math.PI) / 180, maxVelocity: 1.48, maxTorque: 320.0 },
      { min: (-120 * Math.PI) / 180, max: (120 * Math.PI) / 180, maxVelocity: 1.48, maxTorque: 320.0 },
      { min: (-170 * Math.PI) / 180, max: (170 * Math.PI) / 180, maxVelocity: 1.74, maxTorque: 176.0 },
      { min: (-120 * Math.PI) / 180, max: (120 * Math.PI) / 180, maxVelocity: 1.3, maxTorque: 176.0 },
      { min: (-170 * Math.PI) / 180, max: (170 * Math.PI) / 180, maxVelocity: 2.26, maxTorque: 110.0 },
      { min: (-120 * Math.PI) / 180, max: (120 * Math.PI) / 180, maxVelocity: 2.35, maxTorque: 40.0 },
      { min: (-175 * Math.PI) / 180, max: (175 * Math.PI) / 180, maxVelocity: 2.35, maxTorque: 40.0 }
    ],
    linkInertias: [
      { mass: 5.76, com: [0.0, -0.03, 0.12], inertia: [0.033, 0.033, 0.012] },
      { mass: 6.35, com: [0.0003, 0.059, 0.042], inertia: [0.0305, 0.011, 0.0304] },
      { mass: 3.5, com: [0.0, 0.03, 0.13], inertia: [0.025, 0.0238, 0.0076] },
      { mass: 3.5, com: [0.0, 0.067, 0.034], inertia: [0.017, 0.006, 0.0164] },
      { mass: 3.5, com: [0.0001, 0.021, 0.076], inertia: [0.01, 0.0087, 0.0045] },
      { mass: 1.8, com: [0.0, 0.0006, 0.0004], inertia: [0.0049, 0.0047, 0.0036] },
      { mass: 1.2, com: [0.0, 0.0, 0.02], inertia: [0.001, 0.001, 0.001] }
    ]
  }
);

const PRESET_MAP = Object.freeze({
  PUMA_560: PUMA_560_DH,
  PUMA_560_DH: PUMA_560_DH,
  UR5E: UR5E_DH,
  UR5E_DH: UR5E_DH,
  KUKA_IIWA_7DOF: KUKA_IIWA_7DOF_DH,
  KUKA_IIWA_7DOF_DH: KUKA_IIWA_7DOF_DH
});

// ============================================================================
// SerialManipulatorEngine Implementation
// ============================================================================

class SerialManipulatorEngine {
  /**
   * Resolves a DH table or kinematic chain from preset name, URDF chain, or raw DH array
   */
  static resolveKinematicChain(dhTableInput) {
    if (typeof dhTableInput === 'string') {
      const preset = PRESET_MAP[dhTableInput.toUpperCase()];
      if (!preset) {
        throw new Error(`Unknown manipulator preset "${dhTableInput}"`);
      }
      return preset;
    }
    if (Array.isArray(dhTableInput)) {
      if (dhTableInput.length === 0) {
        throw new Error('DH table array cannot be empty');
      }
      return dhTableInput;
    }
    if (dhTableInput && typeof dhTableInput === 'object') {
      if (Array.isArray(dhTableInput.dhTable) && dhTableInput.dhTable.length > 0) {
        return dhTableInput.dhTable;
      }
      if (Array.isArray(dhTableInput.joints) && dhTableInput.joints.length > 0) {
        return dhTableInput;
      }
      if (Array.isArray(dhTableInput.screwAxes) && dhTableInput.screwAxes.length > 0) {
        return dhTableInput;
      }
    }
    throw new Error('Invalid kinematic chain: provide a non-empty dhTable array, URDF chain, or PoE specification');
  }

  /**
   * Computes single link homogeneous transform (Standard DH or Modified Craig DH)
   */
  static computeDHTransform(row, qVal, defaultConvention = 'standard') {
    const type = String(row.type || 'revolute').toLowerCase();
    const isPrismatic = type === 'prismatic' || type === 'p';
    const isFixed = type === 'fixed';
    const a = Number(row.a || 0);
    const alpha = Number(row.alpha || 0);
    const offset = Number(row.offset !== undefined ? row.offset : row.thetaOffset || 0);
    const theta0 = Number(row.theta || 0) + offset;
    const d0 = Number(row.d || 0);

    const theta = isPrismatic || isFixed ? theta0 : theta0 + Number(qVal || 0);
    const d = isPrismatic ? d0 + Number(qVal || 0) : d0;

    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);

    const conv = String(row.convention || defaultConvention || 'standard').toLowerCase();
    if (conv === 'modified' || conv === 'modified_dh' || conv === 'mdh' || conv === 'craig') {
      // Modified DH (Craig): Rot_x(alpha_{i-1}) * Trans_x(a_{i-1}) * Rot_z(theta_i) * Trans_z(d_i)
      return [
        [ct, -st, 0, a],
        [st * ca, ct * ca, -sa, -d * sa],
        [st * sa, ct * sa, ca, d * ca],
        [0, 0, 0, 1]
      ];
    }

    // Standard DH: Rot_z(theta_i) * Trans_z(d_i) * Trans_x(a_i) * Rot_x(alpha_i)
    return [
      [ct, -st * ca, st * sa, a * ct],
      [st, ct * ca, -ct * sa, a * st],
      [0, sa, ca, d],
      [0, 0, 0, 1]
    ];
  }

  /**
   * Product of Exponentials (PoE) Forward Kinematics in Space Frame:
   * T(q) = exp([S_1]*q_1) * ... * exp([S_n]*q_n) * M
   */
  static forwardKinematicsPoE(screwAxes, homeTransform, jointAngles) {
    if (!Array.isArray(screwAxes) || screwAxes.length === 0) {
      throw new Error('PoE forward kinematics requires a non-empty screwAxes array');
    }
    const n = screwAxes.length;
    if (!Array.isArray(jointAngles) || jointAngles.length !== n) {
      throw new Error(
        `PoE forward kinematics requires ${n} joint angles, received ${jointAngles ? jointAngles.length : 0}`
      );
    }
    const M = Array.isArray(homeTransform) && homeTransform.length === 4 ? homeTransform : mat4Identity();

    const localTransforms = [];
    const linkTransforms = [];
    let T = mat4Identity();

    // Space Jacobian columns: J_s[:, i] = Ad_{T_{i-1}}(S_i)
    const Jv = Array.from({ length: 3 }, () => new Array(n).fill(0));
    const Jw = Array.from({ length: 3 }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      const S = screwAxes[i];
      const Rprev = [
        [T[0][0], T[0][1], T[0][2]],
        [T[1][0], T[1][1], T[1][2]],
        [T[2][0], T[2][1], T[2][2]]
      ];
      const pPrev = [T[0][3], T[1][3], T[2][3]];

      const w_s = mat3VecMul(Rprev, [S[0], S[1], S[2]]);
      const v_s = vec3Add(vec3Cross(pPrev, w_s), mat3VecMul(Rprev, [S[3], S[4], S[5]]));

      const expT = se3Exp(S, Number(jointAngles[i]));
      localTransforms.push(expT);
      T = mat4Mul(T, expT);
      linkTransforms.push(T);

      Jw[0][i] = w_s[0];
      Jw[1][i] = w_s[1];
      Jw[2][i] = w_s[2];
      // Store spatial linear twist; we convert to end-effector point velocity below
      Jv[0][i] = v_s[0];
      Jv[1][i] = v_s[1];
      Jv[2][i] = v_s[2];
    }

    const Tee = mat4Mul(T, M);
    const pEnd = [Tee[0][3], Tee[1][3], Tee[2][3]];
    const REnd = [
      [Tee[0][0], Tee[0][1], Tee[0][2]],
      [Tee[1][0], Tee[1][1], Tee[1][2]],
      [Tee[2][0], Tee[2][1], Tee[2][2]]
    ];

    // Convert spatial twist Jacobian to geometric Jacobian at end-effector origin pEnd:
    // v_ee = v_s + w_s x pEnd = v_s - pEnd x w_s
    const jacobian = Array.from({ length: 6 }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      const ws = [Jw[0][i], Jw[1][i], Jw[2][i]];
      const vs = [Jv[0][i], Jv[1][i], Jv[2][i]];
      const vee = vec3Add(vs, vec3Cross(ws, pEnd));
      jacobian[0][i] = vee[0];
      jacobian[1][i] = vee[1];
      jacobian[2][i] = vee[2];
      jacobian[3][i] = ws[0];
      jacobian[4][i] = ws[1];
      jacobian[5][i] = ws[2];
    }

    return SerialManipulatorEngine._packageFKResult(Tee, linkTransforms, localTransforms, jacobian, REnd, pEnd, 'poe');
  }

  /**
   * Standard / Modified DH & PoE Forward Kinematics
   * @param {Array|Object|string} dhTableOrSpec
   * @param {Array<number>} [jointAngles]
   * @param {Object|string} [options]
   */
  static forwardKinematics(dhTableOrSpec, jointAngles, options = {}) {
    let dhSpec = dhTableOrSpec;
    let q = jointAngles;
    let opts = typeof options === 'string' ? { convention: options } : options || {};

    if (
      dhTableOrSpec &&
      typeof dhTableOrSpec === 'object' &&
      !Array.isArray(dhTableOrSpec) &&
      (dhTableOrSpec.dhTable || dhTableOrSpec.screwAxes || dhTableOrSpec.jointAngles || dhTableOrSpec.q)
    ) {
      q = dhTableOrSpec.jointAngles || dhTableOrSpec.q || jointAngles;
      opts = { ...dhTableOrSpec, ...opts };
      if (dhTableOrSpec.screwAxes && (!dhTableOrSpec.dhTable || opts.convention === 'poe')) {
        return SerialManipulatorEngine.forwardKinematicsPoE(
          dhTableOrSpec.screwAxes,
          dhTableOrSpec.homeTransform || dhTableOrSpec.M,
          q
        );
      }
      dhSpec = dhTableOrSpec.dhTable || dhTableOrSpec;
    }

    const chain = SerialManipulatorEngine.resolveKinematicChain(dhSpec);
    if (!Array.isArray(chain) && chain.screwAxes && (opts.convention === 'poe' || !chain.dhTable)) {
      return SerialManipulatorEngine.forwardKinematicsPoE(chain.screwAxes, chain.homeTransform || chain.M, q);
    }

    const dhRows = Array.isArray(chain) ? chain : chain.dhTable;
    if (!Array.isArray(dhRows) || dhRows.length === 0) {
      throw new Error('forwardKinematics requires a non-empty dhTable');
    }

    const n = dhRows.length;
    if (!Array.isArray(q) || q.length !== n || q.some((val) => typeof val !== 'number' || !Number.isFinite(val))) {
      throw new Error(`forwardKinematics requires an array of ${n} finite joint angles (rad or m)`);
    }

    const convention = opts.convention || (chain && chain.convention) || 'standard_dh';
    const localTransforms = [];
    const linkTransforms = [];

    // Frame 0 is world/base identity
    const frameOrigins = [[0, 0, 0]];
    const frameZAxes = [[0, 0, 1]];
    let T = mat4Identity();

    for (let i = 0; i < n; i++) {
      const row = dhRows[i];
      let Ti;
      if (row.urdfOrigin || row.urdfAxis) {
        // Exact URDF joint transform: T_origin(xyz, rpy) * T_joint(axis, q_i)
        const xyz = row.urdfOrigin?.xyz || [0, 0, 0];
        const rpy = row.urdfOrigin?.rpy || [0, 0, 0];
        const Rorig = rpyToRot3(rpy[0], rpy[1], rpy[2]);
        const Torig = [
          [Rorig[0][0], Rorig[0][1], Rorig[0][2], xyz[0]],
          [Rorig[1][0], Rorig[1][1], Rorig[1][2], xyz[1]],
          [Rorig[2][0], Rorig[2][1], Rorig[2][2], xyz[2]],
          [0, 0, 0, 1]
        ];
        const axis = row.urdfAxis || [0, 0, 1];
        const type = String(row.type || 'revolute').toLowerCase();
        let Tmotion;
        if (type === 'prismatic' || type === 'p') {
          Tmotion = [
            [1, 0, 0, axis[0] * q[i]],
            [0, 1, 0, axis[1] * q[i]],
            [0, 0, 1, axis[2] * q[i]],
            [0, 0, 0, 1]
          ];
        } else if (type === 'fixed') {
          Tmotion = mat4Identity();
        } else {
          const Rmot = axisAngleToRot3(axis, q[i]);
          Tmotion = [
            [Rmot[0][0], Rmot[0][1], Rmot[0][2], 0],
            [Rmot[1][0], Rmot[1][1], Rmot[1][2], 0],
            [Rmot[2][0], Rmot[2][1], Rmot[2][2], 0],
            [0, 0, 0, 1]
          ];
        }
        // Record joint axis and origin in base frame BEFORE motion
        const TjointFrame = mat4Mul(T, Torig);
        const Rjf = [
          [TjointFrame[0][0], TjointFrame[0][1], TjointFrame[0][2]],
          [TjointFrame[1][0], TjointFrame[1][1], TjointFrame[1][2]],
          [TjointFrame[2][0], TjointFrame[2][1], TjointFrame[2][2]]
        ];
        frameOrigins[i] = [TjointFrame[0][3], TjointFrame[1][3], TjointFrame[2][3]];
        frameZAxes[i] = mat3VecMul(Rjf, axis);

        Ti = mat4Mul(Torig, Tmotion);
        localTransforms.push(Ti);
        T = mat4Mul(T, Ti);
        linkTransforms.push(T);
      } else {
        Ti = SerialManipulatorEngine.computeDHTransform(row, q[i], convention);
        localTransforms.push(Ti);
        const prevT = T;
        T = mat4Mul(T, Ti);
        linkTransforms.push(T);

        const rowConv = String(row.convention || convention).toLowerCase();
        if (rowConv === 'modified' || rowConv === 'modified_dh' || rowConv === 'mdh' || rowConv === 'craig') {
          // In Modified DH, joint i acts along z_i at origin o_i
          frameOrigins[i] = [T[0][3], T[1][3], T[2][3]];
          frameZAxes[i] = [T[0][2], T[1][2], T[2][2]];
        } else {
          // In Standard DH, joint i acts along z_{i-1} at origin o_{i-1}
          frameOrigins[i] = [prevT[0][3], prevT[1][3], prevT[2][3]];
          frameZAxes[i] = [prevT[0][2], prevT[1][2], prevT[2][2]];
        }
      }
    }

    const pEnd = [T[0][3], T[1][3], T[2][3]];
    const REnd = [
      [T[0][0], T[0][1], T[0][2]],
      [T[1][0], T[1][1], T[1][2]],
      [T[2][0], T[2][1], T[2][2]]
    ];

    // Geometric Jacobian J(q) in R^{6 x n}: top 3 rows linear velocity, bottom 3 rows angular velocity
    const jacobian = Array.from({ length: 6 }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      const type = String(dhRows[i].type || 'revolute').toLowerCase();
      const zi = frameZAxes[i];
      const oi = frameOrigins[i];
      if (type === 'prismatic' || type === 'p') {
        jacobian[0][i] = zi[0];
        jacobian[1][i] = zi[1];
        jacobian[2][i] = zi[2];
        jacobian[3][i] = 0.0;
        jacobian[4][i] = 0.0;
        jacobian[5][i] = 0.0;
      } else if (type === 'fixed') {
        // Fixed joint contributes zero column
      } else {
        const r = vec3Sub(pEnd, oi);
        const jv = vec3Cross(zi, r);
        jacobian[0][i] = jv[0];
        jacobian[1][i] = jv[1];
        jacobian[2][i] = jv[2];
        jacobian[3][i] = zi[0];
        jacobian[4][i] = zi[1];
        jacobian[5][i] = zi[2];
      }
    }

    const normConv =
      String(convention).toLowerCase() === 'modified' ||
      String(convention).toLowerCase() === 'modified_dh' ||
      String(convention).toLowerCase() === 'mdh' ||
      String(convention).toLowerCase() === 'craig'
        ? 'modified_dh'
        : 'standard_dh';
    return SerialManipulatorEngine._packageFKResult(T, linkTransforms, localTransforms, jacobian, REnd, pEnd, normConv);
  }

  static _packageFKResult(T, linkTransforms, localTransforms, jacobian, REnd, pEnd, convention = 'standard_dh') {
    const n = jacobian[0].length;
    const RT = mat3Transpose(REnd);

    // Body Jacobian J_b = diag(R^T, R^T) * J
    const bodyJacobian = Array.from({ length: 6 }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const vCol = [jacobian[0][j], jacobian[1][j], jacobian[2][j]];
      const wCol = [jacobian[3][j], jacobian[4][j], jacobian[5][j]];
      const vb = mat3VecMul(RT, vCol);
      const wb = mat3VecMul(RT, wCol);
      bodyJacobian[0][j] = vb[0];
      bodyJacobian[1][j] = vb[1];
      bodyJacobian[2][j] = vb[2];
      bodyJacobian[3][j] = wb[0];
      bodyJacobian[4][j] = wb[1];
      bodyJacobian[5][j] = wb[2];
    }

    // Yoshikawa manipulability index w(q) = sqrt(max(0, det(J * J^T)))
    const JJT = Array.from({ length: 6 }, () => new Array(6).fill(0));
    let traceJJT = 0;
    for (let r = 0; r < 6; r++) {
      for (let c = r; c < 6; c++) {
        let sum = 0.0;
        for (let k = 0; k < n; k++) {
          sum += jacobian[r][k] * jacobian[c][k];
        }
        JJT[r][c] = sum;
        JJT[c][r] = sum;
      }
      traceJJT += JJT[r][r];
    }
    const detJJT = matrixDeterminant(JJT);
    const manipulabilityIndex = Math.sqrt(Math.max(0.0, detJJT));
    const conditionNumber =
      manipulabilityIndex > 1e-12 ? Math.max(1.0, traceJJT / (6.0 * Math.pow(manipulabilityIndex, 1 / 3))) : 1e12;

    const quaternion = rot3ToQuaternion(REnd);
    const eulerZYX = rot3ToEulerZYX(REnd);
    const eulerRPY = {
      roll: eulerZYX[2],
      pitch: eulerZYX[1],
      yaw: eulerZYX[0]
    };

    return {
      convention,
      endEffectorTransform: T,
      endEffectorPose: T,
      T,
      transform: T,
      linkTransforms,
      jointFrames: [mat4Identity(), ...linkTransforms],
      localTransforms,
      position: pEnd,
      quaternion,
      eulerZYX,
      eulerRPY,
      rotationMatrix: REnd,
      orientation: {
        quaternion,
        eulerZYX,
        eulerRPY,
        rotationMatrix: REnd
      },
      jacobian,
      spaceJacobian: jacobian,
      bodyJacobian,
      manipulabilityIndex,
      manipulability: manipulabilityIndex,
      yoshikawaIndex: manipulabilityIndex,
      conditionNumber
    };
  }

  /**
   * Compute 6xn Geometric Jacobian and manipulability metrics
   */
  static computeGeometricJacobian(dhTable, q, convention = 'standard_dh') {
    const fk = SerialManipulatorEngine.forwardKinematics(dhTable, q, { convention });
    return {
      jacobian: fk.jacobian,
      spaceJacobian: fk.spaceJacobian,
      bodyJacobian: fk.bodyJacobian,
      manipulability: fk.manipulabilityIndex,
      manipulabilityIndex: fk.manipulabilityIndex,
      conditionNumber: fk.conditionNumber,
      endEffectorPose: fk.endEffectorPose,
      jointFrames: fk.jointFrames
    };
  }

  /**
   * Parses targetOrientation into a 3x3 rotation matrix
   */
  static _parseTargetOrientation(targetOrientation) {
    if (!targetOrientation) return null;
    if (Array.isArray(targetOrientation)) {
      if (targetOrientation.length === 3 && Array.isArray(targetOrientation[0])) {
        return targetOrientation;
      }
      if (targetOrientation.length === 4 && targetOrientation.every(Number.isFinite)) {
        return quaternionToRot3(targetOrientation);
      }
      if (targetOrientation.length === 3 && targetOrientation.every(Number.isFinite)) {
        // [yaw, pitch, roll] ZYX Euler angles (rad)
        const [yaw, pitch, roll] = targetOrientation;
        return rpyToRot3(roll, pitch, yaw);
      }
    }
    if (typeof targetOrientation === 'object') {
      if (Array.isArray(targetOrientation.rotationMatrix)) {
        return targetOrientation.rotationMatrix;
      }
      if (Array.isArray(targetOrientation.rotation)) {
        return targetOrientation.rotation;
      }
      if (Array.isArray(targetOrientation.quaternion)) {
        return quaternionToRot3(targetOrientation.quaternion);
      }
      if (Array.isArray(targetOrientation.eulerZYX)) {
        const [yaw, pitch, roll] = targetOrientation.eulerZYX;
        return rpyToRot3(roll, pitch, yaw);
      }
      if (Array.isArray(targetOrientation.rpy)) {
        const [roll, pitch, yaw] = targetOrientation.rpy;
        return rpyToRot3(roll, pitch, yaw);
      }
      if (targetOrientation.rpy && typeof targetOrientation.rpy === 'object') {
        const { roll = 0, pitch = 0, yaw = 0 } = targetOrientation.rpy;
        return rpyToRot3(roll, pitch, yaw);
      }
    }
    throw new Error(
      'Invalid targetOrientation: provide quaternion [qw,qx,qy,qz], ZYX Euler [yaw,pitch,roll], or 3x3 matrix'
    );
  }

  /**
   * Computes 3D axis-angle orientation error vector e_w in base frame from R_cur to R_des
   * using SO(3) quaternion logarithm map: R_err = R_des * R_cur^T
   */
  static computeOrientationError(Rcur, Rdes) {
    const Rerr = mat3Mul(Rdes, mat3Transpose(Rcur));
    const q = rot3ToQuaternion(Rerr); // qw >= 0 guaranteed
    const qw = Math.max(-1.0, Math.min(1.0, q[0]));
    const qv = [q[1], q[2], q[3]];
    const vNorm = vec3Norm(qv);
    if (vNorm < 1e-12) {
      return [2.0 * qv[0], 2.0 * qv[1], 2.0 * qv[2]];
    }
    const angle = 2.0 * Math.atan2(vNorm, qw);
    const scale = angle / vNorm;
    return [qv[0] * scale, qv[1] * scale, qv[2] * scale];
  }

  /**
   * Damped Least-Squares (Levenberg-Marquardt) Numerical Inverse Kinematics
   * Supports both config object `inverseKinematics({ dhTable, targetPosition, targetOrientation, ... })`
   * and positional call `inverseKinematics(dhTable, targetPose, initialGuess, options)`.
   */
  static inverseKinematics(arg1 = {}, arg2 = undefined, arg3 = undefined, arg4 = {}) {
    let params = arg1;
    if (arg2 !== undefined || Array.isArray(arg1) || typeof arg1 === 'string') {
      const opts = arg4 && typeof arg4 === 'object' ? arg4 : {};
      params = {
        ...opts,
        dhTable: arg1,
        targetPose: arg2,
        initialGuess: arg3 !== undefined ? arg3 : opts.initialGuess || opts.q0
      };
    }
    if (!params || typeof params !== 'object') {
      throw new Error('inverseKinematics requires a configuration object or (dhTable, targetPose, q0, options)');
    }

    let targetPosition = params.targetPosition;
    let targetOrientation = params.targetOrientation !== undefined ? params.targetOrientation : null;

    if (params.targetPose !== undefined) {
      const tp = params.targetPose;
      if (Array.isArray(tp) && tp.length === 4 && Array.isArray(tp[0]) && tp[0].length === 4) {
        targetPosition = [tp[0][3], tp[1][3], tp[2][3]];
        targetOrientation = [
          [tp[0][0], tp[0][1], tp[0][2]],
          [tp[1][0], tp[1][1], tp[1][2]],
          [tp[2][0], tp[2][1], tp[2][2]]
        ];
      } else if (Array.isArray(tp) && tp.length === 3 && tp.every(Number.isFinite)) {
        targetPosition = tp;
      } else if (tp && typeof tp === 'object') {
        if (Array.isArray(tp.position)) targetPosition = tp.position;
        if (tp.rotation || tp.rotationMatrix || tp.quaternion || tp.eulerZYX || tp.rpy) {
          targetOrientation = tp;
        }
      }
    }

    const {
      dhTable: dhInput,
      initialGuess = params.q0 || null,
      jointLimits = null,
      maxIterations = 200,
      tolerance = params.positionTolerance || 1e-6,
      damping = 0.05
    } = params;

    const chain = SerialManipulatorEngine.resolveKinematicChain(dhInput);
    const dhRows = Array.isArray(chain) ? chain : chain.dhTable;
    const n = dhRows.length;

    if (
      !Array.isArray(targetPosition) ||
      targetPosition.length !== 3 ||
      targetPosition.some((v) => typeof v !== 'number' || !Number.isFinite(v))
    ) {
      throw new Error('inverseKinematics requires a 3-element finite targetPosition [x, y, z] (m)');
    }

    const Rdes = SerialManipulatorEngine._parseTargetOrientation(targetOrientation);
    const limits = jointLimits || (chain && chain.jointLimits) || null;

    const clampJoints = (qVec) => {
      if (!Array.isArray(limits)) return qVec;
      return qVec.map((val, idx) => {
        const lim = limits[idx];
        if (!lim) return val;
        const lo = Number.isFinite(lim.min) ? lim.min : Number.isFinite(lim.lower) ? lim.lower : -Infinity;
        const hi = Number.isFinite(lim.max) ? lim.max : Number.isFinite(lim.upper) ? lim.upper : Infinity;
        return Math.max(lo, Math.min(hi, val));
      });
    };

    const qInit =
      Array.isArray(initialGuess) && initialGuess.length === n ? initialGuess.map(Number) : new Array(n).fill(0.1);

    let q = clampJoints(qInit);
    const residualHistory = [];
    const taskDim = Rdes ? 6 : 3;
    const baseLambda = Math.max(1e-4, Number(damping) || 0.05);

    let fk = SerialManipulatorEngine.forwardKinematics(chain, q);
    let posErrVec = vec3Sub(targetPosition, fk.position);
    let oriErrVec = Rdes ? SerialManipulatorEngine.computeOrientationError(fk.rotationMatrix, Rdes) : [0, 0, 0];
    let errNorm = Math.hypot(...posErrVec, ...oriErrVec);

    let bestQ = q.slice();
    let bestErr = errNorm;
    let bestFk = fk;
    let iterations = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      residualHistory.push({
        iteration: iter,
        residual: errNorm,
        positionError: vec3Norm(posErrVec),
        orientationError: vec3Norm(oriErrVec),
        manipulability: fk.manipulabilityIndex
      });

      if (errNorm <= tolerance) {
        break;
      }
      iterations = iter + 1;

      const J = fk.jacobian;
      // Adaptive Levenberg-Marquardt damping: scale with error and singularity proximity
      const manip = fk.manipulabilityIndex;
      const singBoost = manip < 1e-3 ? 0.05 * (1.0 - manip / 1e-3) : 0.0;
      const lambda = Math.min(0.5, baseLambda * Math.min(1.0, Math.max(0.05, errNorm)) + singBoost);
      const lambdaSq = lambda * lambda;

      // Form (J_task * J_task^T + lambda^2 * I) of size taskDim x taskDim
      const A = Array.from({ length: taskDim }, () => new Array(taskDim).fill(0));
      for (let r = 0; r < taskDim; r++) {
        for (let c = r; c < taskDim; c++) {
          let sum = 0.0;
          for (let k = 0; k < n; k++) {
            sum += J[r][k] * J[c][k];
          }
          A[r][c] = sum;
          A[c][r] = sum;
        }
        A[r][r] += lambdaSq;
      }

      const errVec = Rdes ? [...posErrVec, ...oriErrVec] : [...posErrVec];
      const y = solveLinearSystem(A, errVec);

      // dq = J_task^T * y + null-space joint-center attraction for redundant manipulators
      const dq = new Array(n).fill(0);
      for (let k = 0; k < n; k++) {
        let sum = 0.0;
        for (let r = 0; r < taskDim; r++) {
          sum += J[r][k] * y[r];
        }
        dq[k] = sum;
      }

      // Max step clamping for stability
      const maxStep = 0.35;
      let maxAbsDq = 0;
      for (let k = 0; k < n; k++) {
        if (Math.abs(dq[k]) > maxAbsDq) maxAbsDq = Math.abs(dq[k]);
      }
      const stepScale = maxAbsDq > maxStep ? maxStep / maxAbsDq : 1.0;

      // Backtracking line search
      let alpha = stepScale;
      let accepted = false;
      for (let ls = 0; ls < 5; ls++) {
        const qCand = clampJoints(q.map((val, idx) => val + alpha * dq[idx]));
        const fkCand = SerialManipulatorEngine.forwardKinematics(chain, qCand);
        const pErrCand = vec3Sub(targetPosition, fkCand.position);
        const oErrCand = Rdes
          ? SerialManipulatorEngine.computeOrientationError(fkCand.rotationMatrix, Rdes)
          : [0, 0, 0];
        const errCand = Math.hypot(...pErrCand, ...oErrCand);

        if (errCand < errNorm || ls === 4) {
          q = qCand;
          fk = fkCand;
          posErrVec = pErrCand;
          oriErrVec = oErrCand;
          errNorm = errCand;
          if (errCand < bestErr) {
            bestErr = errCand;
            bestQ = qCand.slice();
            bestFk = fkCand;
          }
          accepted = true;
          break;
        }
        alpha *= 0.5;
      }

      if (!accepted) break;
    }

    q = bestQ;
    fk = bestFk;
    posErrVec = vec3Sub(targetPosition, fk.position);
    oriErrVec = Rdes ? SerialManipulatorEngine.computeOrientationError(fk.rotationMatrix, Rdes) : [0, 0, 0];
    errNorm = bestErr;

    if (residualHistory.length === 0 || residualHistory[residualHistory.length - 1].residual !== errNorm) {
      residualHistory.push({
        iteration: iterations,
        residual: errNorm,
        residualNorm: errNorm,
        positionError: vec3Norm(posErrVec),
        orientationError: vec3Norm(oriErrVec),
        manipulability: fk.manipulabilityIndex
      });
    }
    for (const h of residualHistory) {
      if (h.residualNorm === undefined) h.residualNorm = h.residual;
    }

    const posTol = params.positionTolerance !== undefined ? Number(params.positionTolerance) : tolerance;
    const oriTol =
      params.orientationTolerance !== undefined ? Number(params.orientationTolerance) : Math.max(tolerance, 1e-5);
    const posErrFinal = vec3Norm(posErrVec);
    const oriErrFinal = vec3Norm(oriErrVec);
    const isConverged =
      params.positionTolerance !== undefined || params.orientationTolerance !== undefined
        ? posErrFinal <= posTol && oriErrFinal <= oriTol
        : errNorm <= tolerance;

    return {
      converged: isConverged,
      jointAngles: q,
      q,
      iterations,
      finalError: errNorm,
      residualNorm: errNorm,
      positionError: posErrFinal,
      orientationError: oriErrFinal,
      manipulability: fk.manipulabilityIndex,
      manipulabilityIndex: fk.manipulabilityIndex,
      residualHistory,
      endEffectorPose: fk,
      achievedPose: fk
    };
  }

  /**
   * Normalizes inertia specification into a 3x3 symmetric tensor
   */
  static _parseInertiaTensor(inertiaSpec) {
    if (!inertiaSpec) {
      return [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ];
    }
    if (Array.isArray(inertiaSpec)) {
      if (inertiaSpec.length === 3 && Array.isArray(inertiaSpec[0])) {
        return inertiaSpec;
      }
      if (inertiaSpec.length === 3 && inertiaSpec.every(Number.isFinite)) {
        return [
          [inertiaSpec[0], 0, 0],
          [0, inertiaSpec[1], 0],
          [0, 0, inertiaSpec[2]]
        ];
      }
      if (inertiaSpec.length === 6 && inertiaSpec.every(Number.isFinite)) {
        const [ixx, iyy, izz, ixy, ixz, iyz] = inertiaSpec;
        return [
          [ixx, ixy, ixz],
          [ixy, iyy, iyz],
          [ixz, iyz, izz]
        ];
      }
    }
    if (typeof inertiaSpec === 'object') {
      const ixx = Number(inertiaSpec.ixx || 0);
      const iyy = Number(inertiaSpec.iyy || 0);
      const izz = Number(inertiaSpec.izz || 0);
      const ixy = Number(inertiaSpec.ixy || 0);
      const ixz = Number(inertiaSpec.ixz || 0);
      const iyz = Number(inertiaSpec.iyz || 0);
      return [
        [ixx, ixy, ixz],
        [ixy, iyy, iyz],
        [ixz, iyz, izz]
      ];
    }
    return [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
  }

  /**
   * Recursive Newton-Euler Algorithm (RNEA) Inverse Dynamics
   * Computes exact joint torques tau = M(q)*qdd + C(q,qd)*qd + g(q) + J^T*f_ext
   * Supports both config object `inverseDynamics({ dhTable, linkInertias, q, qd, qdd, gravity, externalWrench })`
   * and positional call `inverseDynamics(dhTable, q, qd, qdd, linkDynamics, gravity, fTip)`.
   */
  static inverseDynamics(arg1 = {}, arg2, arg3, arg4, arg5, arg6, arg7) {
    let params = arg1;
    if (arg2 !== undefined || Array.isArray(arg1) || typeof arg1 === 'string') {
      params = {
        dhTable: arg1,
        q: arg2,
        qd: arg3,
        qdd: arg4,
        linkInertias: arg5,
        gravity: arg6,
        externalWrench: arg7
      };
    }
    if (!params || typeof params !== 'object') {
      throw new Error(
        'inverseDynamics requires a configuration object or (dhTable, q, qd, qdd, linkDynamics, gravity, fTip)'
      );
    }
    const {
      dhTable: dhInput,
      linkInertias: inertiasInput = params.linkDynamics || params.links,
      q = params.jointAngles,
      qd = params.jointVelocities,
      qdd = params.jointAccelerations,
      gravity,
      externalWrench = params.fTip
    } = params;

    const chain = SerialManipulatorEngine.resolveKinematicChain(dhInput);
    const dhRows = Array.isArray(chain) ? chain : chain.dhTable;
    const n = dhRows.length;

    const linkInertias = inertiasInput || (chain && chain.linkInertias);
    if (!Array.isArray(linkInertias) || linkInertias.length < n) {
      throw new Error(`inverseDynamics requires linkInertias for all ${n} links`);
    }
    if (!Array.isArray(q) || q.length !== n || q.some((v) => !Number.isFinite(v))) {
      throw new Error(`inverseDynamics requires finite joint positions q of length ${n}`);
    }
    if (!Array.isArray(qd) || qd.length !== n || qd.some((v) => !Number.isFinite(v))) {
      throw new Error(`inverseDynamics requires finite joint velocities qd of length ${n}`);
    }
    if (!Array.isArray(qdd) || qdd.length !== n || qdd.some((v) => !Number.isFinite(v))) {
      throw new Error(`inverseDynamics requires finite joint accelerations qdd of length ${n}`);
    }
    if (!Array.isArray(gravity) || gravity.length !== 3 || gravity.some((v) => !Number.isFinite(v))) {
      throw new Error('inverseDynamics requires a 3-element finite gravity vector [gx, gy, gz] (m/s^2)');
    }

    if (
      !Array.isArray(externalWrench) ||
      externalWrench.length !== 6 ||
      externalWrench.some((v) => !Number.isFinite(v))
    ) {
      throw new Error('inverseDynamics requires an explicit finite six-component externalWrench');
    }
    const extWrench = externalWrench;

    // Base frame {0} kinematic boundary conditions
    // Proper acceleration of base frame to account for gravity: a_0 = -g
    const omega = new Array(n + 1);
    const omegaDot = new Array(n + 1);
    const aOrigin = new Array(n + 1);
    omega[0] = [0, 0, 0];
    omegaDot[0] = [0, 0, 0];
    aOrigin[0] = [-gravity[0], -gravity[1], -gravity[2]];

    const R_prev_i = new Array(n + 1); // ^{i-1}R_i
    const RT_prev_i = new Array(n + 1); // ^i R_{i-1}
    const r_prev_i_in_i = new Array(n + 1); // vector from O_{i-1} to O_i expressed in frame i
    const r_prev_com_in_i = new Array(n + 1); // vector from O_{i-1} to COM_i expressed in frame i
    const zAxis_in_prev = new Array(n + 1); // joint axis expressed in frame i-1
    const F_inertial = new Array(n + 1);
    const N_inertial = new Array(n + 1);
    const linkVelocities = [];
    const linkAccelerations = [];

    // ------------------------------------------------------------------------
    // 1. Outward Pass: i = 1 ... n (velocities, accelerations, inertial wrenches)
    // ------------------------------------------------------------------------
    for (let i = 1; i <= n; i++) {
      const idx = i - 1;
      const row = dhRows[idx];
      const inertiaObj = linkInertias[idx];
      const mass = Number(inertiaObj.mass);
      if (!Number.isFinite(mass) || mass < 0) {
        throw new Error(`Link ${i} mass must be a non-negative finite number`);
      }
      const I_tensor = SerialManipulatorEngine._parseInertiaTensor(inertiaObj.inertia || inertiaObj.I);
      const com = Array.isArray(inertiaObj.com) ? inertiaObj.com : [0, 0, 0];

      let Ti;
      let z_prev = [0, 0, 1];
      if (row.urdfOrigin || row.urdfAxis) {
        const xyz = row.urdfOrigin?.xyz || [0, 0, 0];
        const rpy = row.urdfOrigin?.rpy || [0, 0, 0];
        const Rorig = rpyToRot3(rpy[0], rpy[1], rpy[2]);
        const axis = row.urdfAxis || [0, 0, 1];
        z_prev = mat3VecMul(Rorig, axis);
        const type = String(row.type || 'revolute').toLowerCase();
        const Rmot =
          type === 'prismatic' || type === 'p' || type === 'fixed'
            ? [
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1]
              ]
            : axisAngleToRot3(axis, q[idx]);
        const Rtot = mat3Mul(Rorig, Rmot);
        const pMot = type === 'prismatic' || type === 'p' ? mat3VecMul(Rorig, vec3Scale(axis, q[idx])) : [0, 0, 0];
        const ptot = vec3Add(xyz, pMot);
        Ti = [
          [Rtot[0][0], Rtot[0][1], Rtot[0][2], ptot[0]],
          [Rtot[1][0], Rtot[1][1], Rtot[1][2], ptot[1]],
          [Rtot[2][0], Rtot[2][1], Rtot[2][2], ptot[2]],
          [0, 0, 0, 1]
        ];
      } else {
        Ti = SerialManipulatorEngine.computeDHTransform(row, q[idx]);
      }

      const R = [
        [Ti[0][0], Ti[0][1], Ti[0][2]],
        [Ti[1][0], Ti[1][1], Ti[1][2]],
        [Ti[2][0], Ti[2][1], Ti[2][2]]
      ];
      const RT = mat3Transpose(R);
      const p_prev = [Ti[0][3], Ti[1][3], Ti[2][3]]; // O_{i-1} to O_i in frame i-1
      const r_i = mat3VecMul(RT, p_prev); // O_{i-1} to O_i in frame i

      R_prev_i[i] = R;
      RT_prev_i[i] = RT;
      r_prev_i_in_i[i] = r_i;
      zAxis_in_prev[i] = z_prev;

      // Vector from O_{i-1} (joint i) to COM_i in frame i
      if (inertiaObj.comFromJoint) {
        r_prev_com_in_i[i] = com.slice();
      } else {
        r_prev_com_in_i[i] = vec3Add(r_i, com);
      }

      const type = String(row.type || 'revolute').toLowerCase();
      const qi_d = qd[idx];
      const qi_dd = qdd[idx];

      if (type === 'prismatic' || type === 'p') {
        omega[i] = mat3VecMul(RT, omega[i - 1]);
        omegaDot[i] = mat3VecMul(RT, omegaDot[i - 1]);
        const z_in_i = mat3VecMul(RT, z_prev);
        const coriolis = vec3Scale(vec3Cross(omega[i], vec3Scale(z_in_i, qi_d)), 2.0);
        const baseAcc = mat3VecMul(RT, vec3Add(aOrigin[i - 1], vec3Scale(z_prev, qi_dd)));
        const tangAcc = vec3Cross(omegaDot[i], r_i);
        const centrAcc = vec3Cross(omega[i], vec3Cross(omega[i], r_i));
        aOrigin[i] = vec3Add(vec3Add(baseAcc, coriolis), vec3Add(tangAcc, centrAcc));
      } else if (type === 'fixed') {
        omega[i] = mat3VecMul(RT, omega[i - 1]);
        omegaDot[i] = mat3VecMul(RT, omegaDot[i - 1]);
        const baseAcc = mat3VecMul(RT, aOrigin[i - 1]);
        const tangAcc = vec3Cross(omegaDot[i], r_i);
        const centrAcc = vec3Cross(omega[i], vec3Cross(omega[i], r_i));
        aOrigin[i] = vec3Add(baseAcc, vec3Add(tangAcc, centrAcc));
      } else {
        // Revolute joint
        const z_qd = vec3Scale(z_prev, qi_d);
        const z_qdd = vec3Scale(z_prev, qi_dd);
        omega[i] = mat3VecMul(RT, vec3Add(omega[i - 1], z_qd));
        omegaDot[i] = mat3VecMul(RT, vec3Add(vec3Add(omegaDot[i - 1], z_qdd), vec3Cross(omega[i - 1], z_qd)));
        const baseAcc = mat3VecMul(RT, aOrigin[i - 1]);
        const tangAcc = vec3Cross(omegaDot[i], r_i);
        const centrAcc = vec3Cross(omega[i], vec3Cross(omega[i], r_i));
        aOrigin[i] = vec3Add(baseAcc, vec3Add(tangAcc, centrAcc));
      }

      // Linear acceleration of COM_i in frame i (computed from O_{i-1} acceleration in frame i)
      const a_prev_in_i = mat3VecMul(
        RT,
        type === 'prismatic' || type === 'p' ? vec3Add(aOrigin[i - 1], vec3Scale(z_prev, qi_dd)) : aOrigin[i - 1]
      );
      const r_com = r_prev_com_in_i[i];
      const a_com = vec3Add(
        a_prev_in_i,
        vec3Add(vec3Cross(omegaDot[i], r_com), vec3Cross(omega[i], vec3Cross(omega[i], r_com)))
      );

      F_inertial[i] = vec3Scale(a_com, mass);
      const I_omega = mat3VecMul(I_tensor, omega[i]);
      const I_omegaDot = mat3VecMul(I_tensor, omegaDot[i]);
      N_inertial[i] = vec3Add(I_omegaDot, vec3Cross(omega[i], I_omega));

      linkVelocities.push(omega[i]);
      linkAccelerations.push(a_com);
    }

    // ------------------------------------------------------------------------
    // 2. Inward Pass: i = n ... 1 (joint reaction wrenches & generalized torques)
    // ------------------------------------------------------------------------
    const torques = new Array(n).fill(0);
    const jointWrenches = new Array(n);

    // External wrench at end-effector frame {n}
    let f_next = [extWrench[0], extWrench[1], extWrench[2]];
    let n_next = [extWrench[3], extWrench[4], extWrench[5]];

    for (let i = n; i >= 1; i--) {
      const idx = i - 1;
      const row = dhRows[idx];
      const inertiaObj = linkInertias[idx];
      const r_i = r_prev_i_in_i[i];
      const r_com = r_prev_com_in_i[i];

      // f_i and n_i in frame i about origin O_{i-1}
      const f_i = vec3Add(F_inertial[i], f_next);
      const n_i = vec3Add(
        vec3Add(N_inertial[i], n_next),
        vec3Add(vec3Cross(r_com, F_inertial[i]), vec3Cross(r_i, f_next))
      );

      // Transform f_i and n_i to frame i-1 (where joint i axis zAxis_in_prev[i] resides)
      const f_in_prev = mat3VecMul(R_prev_i[i], f_i);
      const n_in_prev = mat3VecMul(R_prev_i[i], n_i);

      const type = String(row.type || 'revolute').toLowerCase();
      const viscous = Number(inertiaObj.viscousFriction || row.viscousFriction || 0);
      const coulomb = Number(inertiaObj.coulombFriction || row.coulombFriction || 0);
      const friction = viscous * qd[idx] + (qd[idx] === 0 ? 0 : coulomb * Math.sign(qd[idx]));

      if (type === 'prismatic' || type === 'p') {
        torques[idx] = vec3Dot(f_in_prev, zAxis_in_prev[i]) + friction;
      } else if (type === 'fixed') {
        torques[idx] = 0.0;
      } else {
        torques[idx] = vec3Dot(n_in_prev, zAxis_in_prev[i]) + friction;
      }

      jointWrenches[idx] = {
        joint: i,
        force: f_in_prev,
        moment: n_in_prev,
        wrench: [...f_in_prev, ...n_in_prev]
      };

      f_next = f_in_prev;
      n_next = n_in_prev;
    }

    return {
      torques,
      tau: torques,
      jointWrenches,
      linkAngularVelocities: linkVelocities,
      linkComAccelerations: linkAccelerations,
      linkAccelerations
    };
  }

  /**
   * Computes joint-space Mass/Inertia Matrix M(q) in R^{n x n} via RNEA unit accelerations
   */
  static computeMassMatrix(dhTable, linkInertias, q) {
    const chain = SerialManipulatorEngine.resolveKinematicChain(dhTable);
    const dhRows = Array.isArray(chain) ? chain : chain.dhTable;
    const n = dhRows.length;
    const zeroVec = new Array(n).fill(0);
    const M = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let j = 0; j < n; j++) {
      const e_j = new Array(n).fill(0);
      e_j[j] = 1.0;
      const res = SerialManipulatorEngine.inverseDynamics({
        dhTable: chain,
        linkInertias,
        q,
        qd: zeroVec,
        qdd: e_j,
        gravity: [0, 0, 0],
        externalWrench: [0, 0, 0, 0, 0, 0]
      });
      for (let i = 0; i < n; i++) {
        M[i][j] = res.torques[i];
      }
    }
    return M;
  }

  /**
   * Minimum-Jerk Quintic Polynomial Trajectory Planner
   * Generates C^2-continuous [q(t), qd(t), qdd(t), qddd(t)] profiles
   */
  static planQuinticTrajectory(params = {}) {
    if (!params || typeof params !== 'object') {
      throw new Error('planQuinticTrajectory requires a configuration object');
    }
    const qStart = params.qStart || params.q0 || params.startPositions || params.startAngles;
    const qEnd = params.qEnd || params.qf || params.endPositions || params.goalAngles;
    const vStart = params.vStart || params.v0 || params.qd0 || null;
    const vEnd = params.vEnd || params.vf || params.qdf || null;
    const aStart = params.aStart || params.a0 || params.qdd0 || null;
    const aEnd = params.aEnd || params.af || params.qddf || null;
    const duration = params.duration !== undefined ? params.duration : params.T;
    const { velocityLimits = null, accelerationLimits = null, torqueLimits = null } = params;

    if (!Array.isArray(qStart) || qStart.length === 0 || qStart.some((v) => !Number.isFinite(v))) {
      throw new Error('planQuinticTrajectory requires a non-empty finite qStart (or q0) array');
    }
    const n = qStart.length;
    if (!Array.isArray(qEnd) || qEnd.length !== n || qEnd.some((v) => !Number.isFinite(v))) {
      throw new Error(`planQuinticTrajectory requires finite qEnd (or qf) array of length ${n}`);
    }
    const T = Number(duration);
    if (!Number.isFinite(T) || T <= 0) {
      throw new Error('planQuinticTrajectory requires positive finite duration (s)');
    }
    let stepDt = params.dt !== undefined ? Number(params.dt) : undefined;
    if (stepDt === undefined) {
      const requestedSteps = Number(params.numSteps || params.steps);
      if (Number.isFinite(requestedSteps) && requestedSteps > 1) {
        stepDt = T / (requestedSteps - 1);
      } else {
        stepDt = Math.min(0.01, T / 10);
      }
    }
    if (!Number.isFinite(stepDt) || stepDt <= 0 || stepDt > T) {
      throw new Error('planQuinticTrajectory requires positive finite dt <= duration');
    }

    const v0 = Array.isArray(vStart) && vStart.length === n ? vStart.map(Number) : new Array(n).fill(0);
    const vf = Array.isArray(vEnd) && vEnd.length === n ? vEnd.map(Number) : new Array(n).fill(0);
    const a0 = Array.isArray(aStart) && aStart.length === n ? aStart.map(Number) : new Array(n).fill(0);
    const af = Array.isArray(aEnd) && aEnd.length === n ? aEnd.map(Number) : new Array(n).fill(0);

    const T2 = T * T;
    const T3 = T2 * T;
    const T4 = T3 * T;
    const T5 = T4 * T;

    // Quintic polynomial coefficients per joint: q(t) = c0 + c1*t + c2*t^2 + c3*t^3 + c4*t^4 + c5*t^5
    const coefficients = [];
    for (let j = 0; j < n; j++) {
      const dq = qEnd[j] - qStart[j];
      const c0 = qStart[j];
      const c1 = v0[j];
      const c2 = 0.5 * a0[j];
      const c3 = (20.0 * dq - (8.0 * vf[j] + 12.0 * v0[j]) * T - (3.0 * a0[j] - af[j]) * T2) / (2.0 * T3);
      const c4 = (-30.0 * dq + (14.0 * vf[j] + 16.0 * v0[j]) * T + (3.0 * a0[j] - 2.0 * af[j]) * T2) / (2.0 * T4);
      const c5 = (12.0 * dq - 6.0 * (vf[j] + v0[j]) * T - (a0[j] - af[j]) * T2) / (2.0 * T5);
      coefficients.push([c0, c1, c2, c3, c4, c5]);
    }

    const numSteps = Math.max(1, Math.round(T / stepDt));
    const time = [];
    const positions = [];
    const velocities = [];
    const accelerations = [];
    const jerks = [];
    const waypoints = [];

    const peakPositions = new Array(n).fill(0);
    const peakVelocities = new Array(n).fill(0);
    const peakAccelerations = new Array(n).fill(0);
    const peakJerks = new Array(n).fill(0);

    for (let s = 0; s <= numSteps; s++) {
      const t = s === numSteps ? T : Math.min(T, s * stepDt);
      const t2 = t * t;
      const t3 = t2 * t;
      const t4 = t3 * t;
      const t5 = t4 * t;

      const qStep = new Array(n);
      const qdStep = new Array(n);
      const qddStep = new Array(n);
      const qdddStep = new Array(n);

      for (let j = 0; j < n; j++) {
        const [c0, c1, c2, c3, c4, c5] = coefficients[j];
        qStep[j] = c0 + c1 * t + c2 * t2 + c3 * t3 + c4 * t4 + c5 * t5;
        qdStep[j] = c1 + 2 * c2 * t + 3 * c3 * t2 + 4 * c4 * t3 + 5 * c5 * t4;
        qddStep[j] = 2 * c2 + 6 * c3 * t + 12 * c4 * t2 + 20 * c5 * t3;
        qdddStep[j] = 6 * c3 + 24 * c4 * t + 60 * c5 * t2;

        if (Math.abs(qStep[j]) > peakPositions[j]) peakPositions[j] = Math.abs(qStep[j]);
        if (Math.abs(qdStep[j]) > peakVelocities[j]) peakVelocities[j] = Math.abs(qdStep[j]);
        if (Math.abs(qddStep[j]) > peakAccelerations[j]) peakAccelerations[j] = Math.abs(qddStep[j]);
        if (Math.abs(qdddStep[j]) > peakJerks[j]) peakJerks[j] = Math.abs(qdddStep[j]);
      }

      time.push(t);
      positions.push(qStep);
      velocities.push(qdStep);
      accelerations.push(qddStep);
      jerks.push(qdddStep);
      waypoints.push({
        t,
        q: qStep,
        qd: qdStep,
        qdd: qddStep,
        qddd: qdddStep,
        position: qStep,
        velocity: qdStep,
        acceleration: qddStep,
        jerk: qdddStep
      });
    }

    const limitViolations = [];
    let withinVelocityLimits = true;
    let withinAccelerationLimits = true;
    let withinTorqueLimits = true;

    if (Array.isArray(velocityLimits)) {
      for (let j = 0; j < Math.min(n, velocityLimits.length); j++) {
        const lim = Number(velocityLimits[j]);
        if (Number.isFinite(lim) && lim > 0 && peakVelocities[j] > lim) {
          withinVelocityLimits = false;
          limitViolations.push({
            joint: j + 1,
            type: 'velocity',
            peak: peakVelocities[j],
            limit: lim
          });
        }
      }
    }

    if (Array.isArray(accelerationLimits)) {
      for (let j = 0; j < Math.min(n, accelerationLimits.length); j++) {
        const lim = Number(accelerationLimits[j]);
        if (Number.isFinite(lim) && lim > 0 && peakAccelerations[j] > lim) {
          withinAccelerationLimits = false;
          limitViolations.push({
            joint: j + 1,
            type: 'acceleration',
            peak: peakAccelerations[j],
            limit: lim
          });
        }
      }
    }

    if (Array.isArray(torqueLimits)) {
      for (let j = 0; j < Math.min(n, torqueLimits.length); j++) {
        const lim = Number(torqueLimits[j]);
        if (Number.isFinite(lim) && lim > 0 && peakAccelerations[j] > lim) {
          withinTorqueLimits = false;
        }
      }
    }

    return {
      duration: T,
      dt: stepDt,
      dof: n,
      stepCount: waypoints.length,
      time,
      q: positions,
      qd: velocities,
      qdd: accelerations,
      qddd: jerks,
      positions,
      velocities,
      accelerations,
      jerks,
      trajectory: waypoints,
      waypoints,
      samples: waypoints,
      coefficients,
      peakPositions,
      peakVelocities,
      peakAccelerations,
      peakJerks,
      maxPosition: peakPositions,
      maxVelocity: peakVelocities,
      maxAcceleration: peakAccelerations,
      maxJerk: peakJerks,
      withinVelocityLimits,
      withinAccelerationLimits,
      withinTorqueLimits,
      withinLimits: withinVelocityLimits && withinAccelerationLimits && withinTorqueLimits,
      limitViolations
    };
  }

  /**
   * Deterministic URDF XML / JSON Kinematic Chain Parser
   * Parses <robot>, <link>, <joint> (revolute, prismatic, fixed, continuous),
   * <origin xyz rpy>, <axis xyz>, <limit lower upper effort velocity>, and <inertial>.
   */
  static parseURDF(urdfContent) {
    if (!urdfContent) {
      throw new Error('parseURDF requires non-empty URDF XML string or JSON object');
    }

    if (typeof urdfContent === 'object') {
      return SerialManipulatorEngine._buildChainFromURDFData(urdfContent);
    }

    if (typeof urdfContent !== 'string' || urdfContent.trim() === '') {
      throw new Error('parseURDF requires a non-empty string or object');
    }

    const trimmed = urdfContent.trim();
    if (trimmed.startsWith('{')) {
      const parsedJson = JSON.parse(trimmed);
      return SerialManipulatorEngine._buildChainFromURDFData(parsedJson);
    }

    // Parse XML URDF
    const robotMatch = trimmed.match(/<robot\b([^>]*)>([\s\S]*?)<\/robot>/i);
    if (!robotMatch) {
      throw new Error('Invalid URDF XML: missing <robot>...</robot> root element');
    }

    const parseAttr = (attrStr, name) => {
      const m = attrStr.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
      return m ? m[1] : null;
    };

    const parseVec3 = (str, fallback = [0, 0, 0]) => {
      if (!str || typeof str !== 'string') return fallback.slice();
      const parts = str.trim().split(/\s+/).map(Number);
      if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) {
        throw new Error(`Invalid URDF three-component vector: ${str}`);
      }
      return parts;
    };

    const robotName = parseAttr(robotMatch[1], 'name') || 'URDF_Robot';
    const bodyXml = robotMatch[2];

    // Extract <link ...>...</link> or self-closing <link .../>
    const links = [];
    const linkRegex = /<link\b([^>]*)(?:\/>|>([\s\S]*?)<\/link>)/gi;
    let lm;
    while ((lm = linkRegex.exec(bodyXml)) !== null) {
      const linkAttrs = lm[1];
      const linkInner = lm[2] || '';
      const name = parseAttr(linkAttrs, 'name');
      if (!name) continue;

      let inertial = null;

      const inertialMatch = linkInner.match(/<inertial\b[^>]*>([\s\S]*?)<\/inertial>/i);
      if (inertialMatch) {
        const inXml = inertialMatch[1];
        const origMatch = inXml.match(/<origin\b([^>]*)\/?>/i);
        const massMatch = inXml.match(/<mass\b([^>]*)\/?>/i);
        const inertMatch = inXml.match(/<inertia\b([^>]*)\/?>/i);

        const com = origMatch ? parseVec3(parseAttr(origMatch[1], 'xyz'), [0, 0, 0]) : [0, 0, 0];
        const rpy = origMatch ? parseVec3(parseAttr(origMatch[1], 'rpy'), [0, 0, 0]) : [0, 0, 0];
        const massText = massMatch ? parseAttr(massMatch[1], 'value') : null;
        const massVal = massText === null ? NaN : Number(massText);
        if (!Number.isFinite(massVal) || massVal < 0 || !inertMatch) {
          throw new Error(`URDF link ${name} has incomplete inertial properties`);
        }
        const inertia = {};
        for (const key of ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz']) {
          const valueText = parseAttr(inertMatch[1], key);
          const value = valueText === null ? NaN : Number(valueText);
          if (!Number.isFinite(value)) throw new Error(`URDF link ${name} has invalid inertia ${key}`);
          inertia[key] = value;
        }
        inertial = { mass: massVal, com, rpy, inertia };
      }

      links.push({ name, inertial });
    }

    // Extract <joint ...>...</joint>
    const joints = [];
    const jointRegex = /<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi;
    let jm;
    while ((jm = jointRegex.exec(bodyXml)) !== null) {
      const jointAttrs = jm[1];
      const jointInner = jm[2] || '';
      const name = parseAttr(jointAttrs, 'name') || `joint_${joints.length + 1}`;
      const type = (parseAttr(jointAttrs, 'type') || 'revolute').toLowerCase();

      const parentMatch = jointInner.match(/<parent\b([^>]*)\/?>/i);
      const childMatch = jointInner.match(/<child\b([^>]*)\/?>/i);
      const originMatch = jointInner.match(/<origin\b([^>]*)\/?>/i);
      const axisMatch = jointInner.match(/<axis\b([^>]*)\/?>/i);
      const limitMatch = jointInner.match(/<limit\b([^>]*)\/?>/i);

      const parent = parentMatch ? parseAttr(parentMatch[1], 'link') : null;
      const child = childMatch ? parseAttr(childMatch[1], 'link') : null;
      const xyz = originMatch ? parseVec3(parseAttr(originMatch[1], 'xyz'), [0, 0, 0]) : [0, 0, 0];
      const rpy = originMatch ? parseVec3(parseAttr(originMatch[1], 'rpy'), [0, 0, 0]) : [0, 0, 0];
      const axisRaw = axisMatch ? parseVec3(parseAttr(axisMatch[1], 'xyz'), [0, 0, 1]) : [0, 0, 1];
      const axisNorm = vec3Norm(axisRaw) || 1.0;
      const axis = [axisRaw[0] / axisNorm, axisRaw[1] / axisNorm, axisRaw[2] / axisNorm];

      const limit = {};
      for (const key of ['lower', 'upper', 'effort', 'velocity']) {
        const valueText = limitMatch ? parseAttr(limitMatch[1], key) : null;
        if (valueText === null) continue;
        const value = Number(valueText);
        if (!Number.isFinite(value)) throw new Error(`URDF joint ${name} has invalid limit ${key}`);
        limit[key] = value;
      }

      joints.push({
        name,
        type,
        parent,
        child,
        origin: { xyz, rpy },
        axis,
        limit
      });
    }

    return SerialManipulatorEngine._buildChainFromURDFData({
      name: robotName,
      links,
      joints
    });
  }

  static _buildChainFromURDFData(data) {
    const robotName = data.name || 'URDF_Robot';
    const links = Array.isArray(data.links) ? data.links : [];
    const joints = Array.isArray(data.joints) ? data.joints : [];

    if (joints.length === 0) {
      throw new Error('URDF kinematic chain must contain at least one <joint>');
    }

    const linkMap = new Map();
    for (const l of links) {
      linkMap.set(l.name, l);
    }

    // Order kinematic chain from root parent link to tip child link
    const childSet = new Set(joints.map((j) => j.child));
    const byParent = new Map();
    for (const j of joints) {
      if (!byParent.has(j.parent)) byParent.set(j.parent, []);
      byParent.get(j.parent).push(j);
    }

    let rootLink = null;
    for (const j of joints) {
      if (j.parent && !childSet.has(j.parent)) {
        rootLink = j.parent;
        break;
      }
    }

    const orderedJoints = [];
    if (rootLink) {
      const queue = [rootLink];
      const visited = new Set();
      while (queue.length > 0) {
        const curr = queue.shift();
        if (visited.has(curr)) continue;
        visited.add(curr);
        const outgoing = byParent.get(curr) || [];
        for (const j of outgoing) {
          orderedJoints.push(j);
          if (j.child) queue.push(j.child);
        }
      }
    }
    if (orderedJoints.length < joints.length) {
      for (const j of joints) {
        if (!orderedJoints.includes(j)) orderedJoints.push(j);
      }
    }

    const activeJoints = orderedJoints.filter((j) => j.type !== 'fixed');
    const jointsToUse = activeJoints.length > 0 ? activeJoints : orderedJoints;

    const dhTable = [];
    const jointLimits = [];
    const linkInertias = [];
    const kinematicChain = [];

    for (let i = 0; i < jointsToUse.length; i++) {
      const j = jointsToUse[i];
      const xyz = j.origin?.xyz || [0, 0, 0];
      const rpy = j.origin?.rpy || [0, 0, 0];
      const axis = j.axis || [0, 0, 1];
      const type = j.type === 'continuous' ? 'revolute' : j.type || 'revolute';

      dhTable.push({
        joint: i + 1,
        name: j.name,
        type,
        a: xyz[0],
        alpha: rpy[0],
        d: xyz[2],
        theta: rpy[2],
        urdfOrigin: { xyz: [...xyz], rpy: [...rpy] },
        urdfAxis: [...axis],
        convention: 'standard'
      });

      const lim = j.limit || {};
      const limObj = {
        min: Number.isFinite(lim.lower) ? lim.lower : Number.isFinite(lim.min) ? lim.min : null,
        max: Number.isFinite(lim.upper) ? lim.upper : Number.isFinite(lim.max) ? lim.max : null,
        lower: Number.isFinite(lim.lower) ? lim.lower : null,
        upper: Number.isFinite(lim.upper) ? lim.upper : null,
        effort: Number.isFinite(lim.effort) ? lim.effort : null,
        velocity: Number.isFinite(lim.velocity) ? lim.velocity : null
      };
      jointLimits.push(limObj);
      kinematicChain.push({
        ...j,
        type,
        limits: limObj
      });

      const childLink = linkMap.get(j.child);
      const inData = childLink?.inertial;
      linkInertias.push(
        inData
          ? {
              linkName: j.child,
              mass: inData.mass,
              com: inData.com || [0, 0, 0],
              inertia: inData.inertia,
              comFromJoint: true
            }
          : null
      );
    }

    return {
      name: robotName,
      rootLink: rootLink || (links[0] ? links[0].name : 'base_link'),
      dof: dhTable.length,
      links,
      joints: orderedJoints,
      activeJoints: jointsToUse,
      kinematicChain,
      dhTable,
      jointLimits,
      linkInertias,
      linkDynamics: linkInertias
    };
  }

  // Instance method delegates for convenience when instantiated via `new SerialManipulatorEngine()`
  forwardKinematics(dhTable, jointAngles, options) {
    return SerialManipulatorEngine.forwardKinematics(dhTable, jointAngles, options);
  }

  forwardKinematicsPoE(screwAxes, homeTransform, jointAngles) {
    return SerialManipulatorEngine.forwardKinematicsPoE(screwAxes, homeTransform, jointAngles);
  }

  computeGeometricJacobian(dhTable, q, convention) {
    return SerialManipulatorEngine.computeGeometricJacobian(dhTable, q, convention);
  }

  inverseKinematics(arg1, arg2, arg3, arg4) {
    return SerialManipulatorEngine.inverseKinematics(arg1, arg2, arg3, arg4);
  }

  inverseDynamics(arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
    return SerialManipulatorEngine.inverseDynamics(arg1, arg2, arg3, arg4, arg5, arg6, arg7);
  }

  planQuinticTrajectory(params) {
    return SerialManipulatorEngine.planQuinticTrajectory(params);
  }

  parseURDF(urdfContent) {
    return SerialManipulatorEngine.parseURDF(urdfContent);
  }
}

SerialManipulatorEngine.rpyToRot3 = rpyToRot3;
SerialManipulatorEngine.quaternionToRot3 = quaternionToRot3;

module.exports = {
  SerialManipulatorEngine,
  forwardKinematics: SerialManipulatorEngine.forwardKinematics,
  forwardKinematicsPoE: SerialManipulatorEngine.forwardKinematicsPoE,
  computeGeometricJacobian: SerialManipulatorEngine.computeGeometricJacobian,
  inverseKinematics: SerialManipulatorEngine.inverseKinematics,
  inverseDynamics: SerialManipulatorEngine.inverseDynamics,
  planQuinticTrajectory: SerialManipulatorEngine.planQuinticTrajectory,
  parseURDF: SerialManipulatorEngine.parseURDF,
  rpyToRot3,
  quaternionToRot3,
  PUMA_560_DH,
  UR5E_DH,
  KUKA_IIWA_7DOF_DH
};
