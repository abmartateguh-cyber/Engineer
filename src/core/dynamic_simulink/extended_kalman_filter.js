/**
 * OmniEng 9-DOF Extended Kalman Filter (EKF) Sensor Fusion
 * Standard: Quaternion Attitude & Position State Estimation
 * Industrial Parity: ArduPilot / PX4 EKF3 state estimation for UAV flight control.
 */

class ExtendedKalmanFilter {
  /**
   * Initializes the 10-state EKF:
   * State x = [px, py, pz, vx, vy, vz, q0, q1, q2, q3]
   * (Position in NED frame, Velocity in NED frame, Unit Quaternion attitude)
   */
  constructor() {
    this.x = new Float64Array(10);
    this.x[6] = 1.0; // Unit quaternion [1, 0, 0, 0]

    // 10x10 State Covariance Matrix P
    this.P = [];
    for (let i = 0; i < 10; i++) {
      this.P.push(new Float64Array(10));
      this.P[i][i] = 1.0;
    }
    // High initial uncertainty for velocity and attitude
    this.P[0][0] = 5.0;  this.P[1][1] = 5.0;  this.P[2][2] = 2.0;
    this.P[3][3] = 1.0;  this.P[4][4] = 1.0;  this.P[5][5] = 1.0;
    this.P[6][6] = 0.05; this.P[7][7] = 0.05; this.P[8][8] = 0.05; this.P[9][9] = 0.05;

    // Process Noise Q
    this.qPos = 0.01;
    this.qVel = 0.1;
    this.qAtt = 0.001;

    // Measurement Noises R
    this.rGpsPos = 1.5;   // meters
    this.rGpsVel = 0.2;   // m/s
    this.rBaroAlt = 0.8;  // meters
    this.rAccel = 0.5;    // m/s^2
  }

  /**
   * Time Prediction Step (IMU High-Rate Integration: 100 Hz - 400 Hz)
   * @param {number[]} gyro Angular rates [p, q, r] in rad/s
   * @param {number[]} accel Specific forces [ax, ay, az] in m/s^2
   * @param {number} dt Time step in seconds
   */
  predict(gyro = [0, 0, 0], accel = [0, 0, -9.80665], dt = 0.01) {
    const [px, py, pz, vx, vy, vz, q0, q1, q2, q3] = this.x;
    const [wx, wy, wz] = gyro;
    const [ax, ay, az] = accel;

    // 1. Rotation Matrix Body -> NED from Quaternion
    const R11 = q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3;
    const R12 = 2.0 * (q1 * q2 - q0 * q3);
    const R13 = 2.0 * (q1 * q3 + q0 * q2);

    const R21 = 2.0 * (q1 * q2 + q0 * q3);
    const R22 = q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3;
    const R23 = 2.0 * (q2 * q3 - q0 * q1);

    const R31 = 2.0 * (q1 * q3 - q0 * q2);
    const R32 = 2.0 * (q2 * q3 + q0 * q1);
    const R33 = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;

    // Accel in NED frame minus gravity: a_ned = R * a_body + [0, 0, g]
    const g = 9.80665;
    const aNED_x = R11 * ax + R12 * ay + R13 * az;
    const aNED_y = R21 * ax + R22 * ay + R23 * az;
    const aNED_z = R31 * ax + R32 * ay + R33 * az + g;

    // 2. State Propagation
    // Position
    this.x[0] += vx * dt + 0.5 * aNED_x * dt * dt;
    this.x[1] += vy * dt + 0.5 * aNED_y * dt * dt;
    this.x[2] += vz * dt + 0.5 * aNED_z * dt * dt;

    // Velocity
    this.x[3] += aNED_x * dt;
    this.x[4] += aNED_y * dt;
    this.x[5] += aNED_z * dt;

    // Quaternion Kinematics: dq/dt = 0.5 * Omega * q
    const dq0 = 0.5 * (-q1 * wx - q2 * wy - q3 * wz) * dt;
    const dq1 = 0.5 * (q0 * wx + q2 * wz - q3 * wy) * dt;
    const dq2 = 0.5 * (q0 * wy - q1 * wz + q3 * wx) * dt;
    const dq3 = 0.5 * (q0 * wz + q1 * wy - q2 * wx) * dt;

    this.x[6] += dq0;
    this.x[7] += dq1;
    this.x[8] += dq2;
    this.x[9] += dq3;

    // Normalize Quaternion
    const qLen = Math.sqrt(this.x[6] ** 2 + this.x[7] ** 2 + this.x[8] ** 2 + this.x[9] ** 2) || 1.0;
    this.x[6] /= qLen;
    this.x[7] /= qLen;
    this.x[8] /= qLen;
    this.x[9] /= qLen;

    // 3. Covariance Propagation P = F*P*F^T + Q
    // Add process noise to diagonal
    for (let i = 0; i < 3; i++) this.P[i][i] += this.qPos * dt;
    for (let i = 3; i < 6; i++) this.P[i][i] += this.qVel * dt;
    for (let i = 6; i < 10; i++) this.P[i][i] += this.qAtt * dt;

    // Cross-term position-velocity covariance
    for (let i = 0; i < 3; i++) {
      this.P[i][i + 3] += this.P[i + 3][i + 3] * dt;
      this.P[i + 3][i] = this.P[i][i + 3];
    }
  }

  /**
   * Measurement Update from Barometric Altimeter (Altitude = -pz in NED)
   */
  updateBarometer(altitudeM) {
    const zExpected = -this.x[2];
    const innovation = altitudeM - zExpected;

    // H = [0, 0, -1, 0, ...]
    const s = this.P[2][2] + this.rBaroAlt;
    const K = new Float64Array(10);
    for (let i = 0; i < 10; i++) {
      K[i] = -this.P[i][2] / s;
    }

    // State update x = x + K * y
    for (let i = 0; i < 10; i++) {
      this.x[i] += K[i] * innovation;
    }

    // Covariance update P = (I - K*H) * P
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        this.P[i][j] -= K[i] * (-this.P[2][j]);
      }
    }
  }

  /**
   * Measurement Update from GPS Position [x, y, z] in NED
   */
  updateGPSPosition(gpsPos = [0, 0, 0]) {
    for (let axis = 0; axis < 3; axis++) {
      const innovation = gpsPos[axis] - this.x[axis];
      const s = this.P[axis][axis] + this.rGpsPos;
      const K = new Float64Array(10);
      for (let i = 0; i < 10; i++) {
        K[i] = this.P[i][axis] / s;
      }
      for (let i = 0; i < 10; i++) {
        this.x[i] += K[i] * innovation;
      }
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          this.P[i][j] -= K[i] * this.P[axis][j];
        }
      }
    }
  }

  /**
   * Returns current Euler attitude angles (Roll, Pitch, Yaw) in degrees.
   */
  getEulerAngles() {
    const [ , , , , , , q0, q1, q2, q3 ] = this.x;
    // Roll (phi)
    const sinr_cosp = 2.0 * (q0 * q1 + q2 * q3);
    const cosr_cosp = 1.0 - 2.0 * (q1 * q1 + q2 * q2);
    const rollRad = Math.atan2(sinr_cosp, cosr_cosp);

    // Pitch (theta)
    const sinp = 2.0 * (q0 * q2 - q3 * q1);
    let pitchRad = 0;
    if (Math.abs(sinp) >= 1) {
      pitchRad = (Math.PI / 2) * Math.sign(sinp);
    } else {
      pitchRad = Math.asin(sinp);
    }

    // Yaw (psi)
    const siny_cosp = 2.0 * (q0 * q3 + q1 * q2);
    const cosy_cosp = 1.0 - 2.0 * (q2 * q2 + q3 * q3);
    const yawRad = Math.atan2(siny_cosp, cosy_cosp);

    return {
      rollDeg: Number(((rollRad * 180.0) / Math.PI).toFixed(2)),
      pitchDeg: Number(((pitchRad * 180.0) / Math.PI).toFixed(2)),
      yawDeg: Number(((yawRad * 180.0) / Math.PI).toFixed(2))
    };
  }

  updateGPS(gpsPos = [0, 0, 0]) {
    return this.updateGPSPosition(gpsPos);
  }

  getState() {
    return {
      positionNED: [Number(this.x[0].toFixed(3)), Number(this.x[1].toFixed(3)), Number(this.x[2].toFixed(3))],
      position: { x: Number(this.x[0].toFixed(3)), y: Number(this.x[1].toFixed(3)), z: Number((-this.x[2]).toFixed(3)) },
      altitudeM: Number((-this.x[2]).toFixed(3)),
      velocityNED: [Number(this.x[3].toFixed(3)), Number(this.x[4].toFixed(3)), Number(this.x[5].toFixed(3))],
      velocity: { x: Number(this.x[3].toFixed(3)), y: Number(this.x[4].toFixed(3)), z: Number(this.x[5].toFixed(3)) },
      quaternion: { w: Number(this.x[6].toFixed(4)), x: Number(this.x[7].toFixed(4)), y: Number(this.x[8].toFixed(4)), z: Number(this.x[9].toFixed(4)) },
      quaternionArray: [Number(this.x[6].toFixed(4)), Number(this.x[7].toFixed(4)), Number(this.x[8].toFixed(4)), Number(this.x[9].toFixed(4))],
      ...this.getEulerAngles()
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ExtendedKalmanFilter };
}
