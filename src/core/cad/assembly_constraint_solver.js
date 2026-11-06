'use strict';

const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const EPS = 1e-14;
const TWO_PI = 2 * Math.PI;

const quat = {
  fromAxisAngle(axis, angle) {
    const h = angle / 2;
    const s = Math.sin(h);
    const ax = axis[0];
    const ay = axis[1];
    const az = axis[2];
    const len = Math.hypot(ax, ay, az) || 1;
    return [Math.cos(h), (ax / len) * s, (ay / len) * s, (az / len) * s];
  },
  multiply(a, b) {
    const aw = a[0];
    const ax = a[1];
    const ay = a[2];
    const az = a[3];
    const bw = b[0];
    const bx = b[1];
    const by = b[2];
    const bz = b[3];
    return [
      aw * bw - ax * bx - ay * by - az * bz,
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw
    ];
  },
  conjugate(q) {
    return [q[0], -q[1], -q[2], -q[3]];
  },
  rotateVec(q, v) {
    const qw = q[0];
    const qx = q[1];
    const qy = q[2];
    const qz = q[3];
    const vx = v[0];
    const vy = v[1];
    const vz = v[2];
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    return [vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx];
  },
  normalize(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    if (n < EPS) return [1, 0, 0, 0];
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  },
  eulerZYX(euler) {
    const qx = quat.fromAxisAngle([1, 0, 0], euler[0]);
    const qy = quat.fromAxisAngle([0, 1, 0], euler[1]);
    const qz = quat.fromAxisAngle([0, 0, 1], euler[2]);
    return quat.normalize(quat.multiply(quat.multiply(qz, qy), qx));
  },
  expOmega(omega) {
    const t = Math.hypot(omega[0], omega[1], omega[2]);
    if (t < EPS) return [1, 0, 0, 0];
    const s = Math.sin(t / 2) / t;
    return [Math.cos(t / 2), omega[0] * s, omega[1] * s, omega[2] * s];
  }
};

function angleAboutAxisFromQuat(q, refQ, axis) {
  const d = quat.multiply(q, quat.conjugate(refQ));
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const proj = (d[1] * axis[0] + d[2] * axis[1] + d[3] * axis[2]) / axisLen;
  return 2 * Math.atan2(proj, d[0]);
}

function normalized(axis) {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < EPS) return [0, 0, 1];
  return [axis[0] / len, axis[1] / len, axis[2] / len];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function orthoBasis(u) {
  const t = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const n1raw = [t[0] - dot(t, u) * u[0], t[1] - dot(t, u) * u[1], t[2] - dot(t, u) * u[2]];
  const n1 = normalized(n1raw);
  const n2 = normalized(cross(u, n1));
  return [n1, n2];
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const pv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= f * M[col][c];
      }
    }
  }
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

class AssemblyBody {
  constructor(id, props = {}) {
    this.id = id;
    this.isFixed = !!props.isFixed;
    this.position = props.position ? [...props.position] : [0, 0, 0];
    this.rotation = props.rotation ? [...props.rotation] : [0, 0, 0];
    this.q = quat.eulerZYX(this.rotation);
    this.datumQ = [...this.q];
    this.boundingRadius = props.boundingRadius || 10.0;
    this.tracks = new Map();
  }
}

class AssemblySolver {
  constructor() {
    this.bodies = new Map();
    this.legacyConstraints = [];
    this.constraints = [];
  }

  addBody(id, props = {}) {
    if (this.bodies.has(id)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Body with ID '${id}' already exists.`);
    }
    const body = new AssemblyBody(id, props);
    this.bodies.set(id, body);
    return body;
  }

  body(id) {
    const b = this.bodies.get(id);
    if (!b) throw new OmniError(OmniErrorCode.INVALID_INPUT, `Unknown body '${id}'.`);
    return b;
  }

  _worldPoint(body, local) {
    const r = quat.rotateVec(body.q, local);
    return [body.position[0] + r[0], body.position[1] + r[1], body.position[2] + r[2]];
  }

  _worldAxis(body, local) {
    return normalized(quat.rotateVec(body.q, local));
  }

  _angleBody(body, axis, unwrapped) {
    const raw = angleAboutAxisFromQuat(body.q, body.datumQ, axis);
    const key = body.id + '|' + (axis[0] + 3.1) + ',' + (axis[1] + 3.1) + ',' + (axis[2] + 3.1);
    if (!unwrapped) {
      body.tracks.delete(key);
      return raw;
    }
    if (!body.tracks.has(key)) {
      body.tracks.set(key, { raw, cum: raw });
      return raw;
    }
    const t = body.tracks.get(key);
    let d = raw - t.raw;
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    t.cum += d;
    t.raw = raw;
    return t.cum;
  }

  _register(c) {
    this.constraints.push(c);
    return c;
  }

  _bodies(c) {
    return { a: this.body(c.a), b: this.body(c.b) };
  }

  coincident(idA, pointA, idB, pointB) {
    return this._register({
      type: 'coincident',
      a: idA,
      b: idB,
      pointA: [...pointA],
      pointB: [...pointB],
      residual: function (self) {
        const { a, b } = self._bodies(this);
        const wa = self._worldPoint(a, this.pointA);
        const wb = self._worldPoint(b, this.pointB);
        return [wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]];
      }
    });
  }

  concentric(idA, axisA, idB, axisB) {
    return this._register({
      type: 'concentric',
      a: idA,
      b: idB,
      axisA: normalized(axisA),
      axisB: normalized(axisB),
      residual: function (self) {
        const { a, b } = self._bodies(this);
        const u = self._worldAxis(a, this.axisA);
        const v = self._worldAxis(b, this.axisB);
        const [n1, n2] = orthoBasis(u);
        return [dot(n1, v), dot(n2, v)];
      }
    });
  }

  parallel(idA, axisA, idB, axisB) {
    return this.concentric(idA, axisA, idB, axisB);
  }

  distance(idA, pointA, idB, pointB, value) {
    return this._register({
      type: 'distance',
      a: idA,
      b: idB,
      pointA: [...pointA],
      pointB: [...pointB],
      value,
      residual: function (self) {
        const { a, b } = self._bodies(this);
        const wa = self._worldPoint(a, this.pointA);
        const wb = self._worldPoint(b, this.pointB);
        return [Math.hypot(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]) - this.value];
      }
    });
  }

  angle(idA, axisA, idB, axisB, value) {
    return this._register({
      type: 'angle',
      a: idA,
      b: idB,
      axisA: normalized(axisA),
      axisB: normalized(axisB),
      value,
      residual: function (self) {
        const { a, b } = self._bodies(this);
        const u = self._worldAxis(a, this.axisA);
        const v = self._worldAxis(b, this.axisB);
        return [Math.acos(clamp(dot(u, v), -1, 1)) - this.value];
      }
    });
  }

  tangentSpherePlane(idA, centerA, radius, idB, planePointB, normalB) {
    return this._register({
      type: 'tangent',
      a: idA,
      b: idB,
      centerA: [...centerA],
      radius,
      planePointB: [...planePointB],
      normalB: normalized(normalB),
      residual: function (self) {
        const { a, b } = self._bodies(this);
        const wa = self._worldPoint(a, this.centerA);
        const wb = self._worldPoint(b, this.planePointB);
        const n = self._worldAxis(b, this.normalB);
        return [dot(n, [wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]]) - this.radius];
      }
    });
  }

  gear(idA, idB, ratio) {
    return this._register({
      type: 'gear',
      a: idA,
      b: idB,
      ratio,
      axis: [0, 0, 1],
      residual: function (self) {
        const { a, b } = self._bodies(this);
        const ta = self._angleBody(a, this.axis, true);
        const tb = self._angleBody(b, this.axis, true);
        return [tb - this.ratio * ta];
      }
    });
  }

  rackPinion(pinionId, rackId, radius) {
    return this._register({
      type: 'rack_pinion',
      a: pinionId,
      b: rackId,
      radius,
      axis: [0, 0, 1],
      residual: function (self) {
        const { b } = self._bodies(this);
        const ta = self._angleBody(self.body(this.a), this.axis, true);
        return [b.position[0] - this.radius * ta];
      }
    });
  }

  camFollower(camId, followerId, eccentricity, constant) {
    return this._register({
      type: 'cam_follower',
      a: camId,
      b: followerId,
      eccentricity,
      constant,
      axis: [0, 0, 1],
      residual: function (self) {
        const cam = self.body(this.a);
        const follower = self.body(this.b);
        const th = self._angleBody(cam, this.axis, true);
        return [follower.position[1] - (this.eccentricity * (1 - Math.cos(th)) + this.constant)];
      }
    });
  }

  orbital(planetId, carrierId, orbitRadius) {
    return this._register({
      type: 'orbital',
      a: planetId,
      b: carrierId,
      orbitRadius,
      axis: [0, 0, 1],
      residual: function (self) {
        const planet = self.body(this.a);
        const carrier = self.body(this.b);
        const th = self._angleBody(carrier, this.axis, true);
        const cx = this.orbitRadius * Math.cos(th);
        const cy = this.orbitRadius * Math.sin(th);
        return [planet.position[0] - cx, planet.position[1] - cy, planet.position[2]];
      }
    });
  }

  orientationBias(bodyId, localAxis, worldDir, weight) {
    const wdir = normalized(worldDir);
    return this._register({
      type: 'orientation_bias',
      a: bodyId,
      localAxis: normalized(localAxis),
      worldDir: wdir,
      weight,
      residual: function (self) {
        const body = self.body(this.a);
        const u = self._worldAxis(body, this.localAxis);
        return [this.weight * Math.min(0, dot(u, this.worldDir))];
      }
    });
  }

  drive(bodyId, axis, target) {
    const c = this._register({
      type: 'driver',
      a: bodyId,
      axis: normalized(axis),
      target,
      setTarget(t) {
        this.target = t;
      },
      residual: function (self) {
        const body = self.body(this.a);
        return [self._angleBody(body, this.axis, true) - this.target];
      }
    });
    return c;
  }

  addConstraint(type, bodyAId, bodyBId, params = {}) {
    if (!this.bodies.has(bodyAId) || !this.bodies.has(bodyBId)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Both constrained bodies must exist in the assembly.');
    }
    this.legacyConstraints.push({ type, bodyAId, bodyBId, params: { ...params } });
    switch (type) {
      case 'coincident':
        this.coincident(bodyAId, [0, 0, 0], bodyBId, [0, 0, 0]);
        break;
      case 'concentric':
        this.concentric(bodyAId, [0, 0, 1], bodyBId, [0, 0, 1]);
        break;
      case 'distance':
        this.distance(bodyAId, [0, 0, 0], bodyBId, [0, 0, 0], params.distance || 0);
        break;
      case 'parallel':
        this.parallel(bodyAId, [0, 0, 1], bodyBId, [0, 0, 1]);
        break;
      case 'gear':
        this.gear(bodyAId, bodyBId, params.ratio || 1);
        break;
      default:
        break;
    }
  }

  calculateMobility() {
    const N = this.bodies.size;
    if (N <= 1) {
      return { mobility: 0, bodyCount: N, constraintCount: 0, isOverconstrained: false };
    }
    let fixedCount = 0;
    for (const b of this.bodies.values()) {
      if (b.isFixed) fixedCount++;
    }
    let totalDof = (N - fixedCount) * 6;
    for (const c of this.legacyConstraints) {
      switch (c.type) {
        case 'coincident':
          totalDof -= 3;
          break;
        case 'concentric':
          totalDof -= 4;
          break;
        case 'distance':
          totalDof -= 1;
          break;
        case 'parallel':
          totalDof -= 2;
          break;
        case 'gear':
          totalDof -= 1;
          break;
        default:
          totalDof -= 1;
      }
    }
    return {
      mobility: Math.max(0, totalDof),
      bodyCount: N,
      constraintCount: this.legacyConstraints.length,
      isOverconstrained: totalDof < 0
    };
  }

  updateGearCoupling(bodyAId, bodyBId, thetaA, gearRatio) {
    const bodyA = this.bodies.get(bodyAId);
    const bodyB = this.bodies.get(bodyBId);
    if (!bodyA || !bodyB) return;
    bodyA.rotation[2] = thetaA;
    bodyB.rotation[2] = -thetaA * gearRatio;
    bodyA.q = quat.eulerZYX(bodyA.rotation);
    bodyB.q = quat.eulerZYX(bodyB.rotation);
  }

  checkInterferences() {
    const interferences = [];
    const bodyList = Array.from(this.bodies.values());
    for (let i = 0; i < bodyList.length; i++) {
      for (let j = i + 1; j < bodyList.length; j++) {
        const bA = bodyList[i];
        const bB = bodyList[j];
        const dist = Math.hypot(
          bA.position[0] - bB.position[0],
          bA.position[1] - bB.position[1],
          bA.position[2] - bB.position[2]
        );
        const minDist = bA.boundingRadius + bB.boundingRadius;
        if (dist < minDist) {
          interferences.push({
            bodyA: bA.id,
            bodyB: bB.id,
            penetrationDepth: minDist - dist
          });
        }
      }
    }
    return interferences;
  }

  computeResiduals() {
    const out = [];
    for (const c of this.constraints) {
      const r = c.residual(this);
      for (let i = 0; i < r.length; i++) out.push(r[i]);
    }
    return out;
  }

  _movingBodies() {
    return Array.from(this.bodies.values()).filter((b) => !b.isFixed);
  }

  _snapshot(moving) {
    return moving.map((b) => ({ pos: [...b.position], q: [...b.q] }));
  }

  _restore(moving, snap) {
    for (let i = 0; i < moving.length; i++) {
      moving[i].position = snap[i].pos.slice();
      moving[i].q = snap[i].q.slice();
    }
  }

  _applyStep(moving, delta) {
    for (let i = 0; i < moving.length; i++) {
      const b = moving[i];
      const o = i * 6;
      b.position[0] += delta[o];
      b.position[1] += delta[o + 1];
      b.position[2] += delta[o + 2];
      b.q = quat.normalize(quat.multiply(b.q, quat.expOmega([delta[o + 3], delta[o + 4], delta[o + 5]])));
    }
  }

  solve(opts = {}) {
    const tol = opts.tol === undefined ? 1e-10 : opts.tol;
    const maxIter = opts.maxIter === undefined ? 200 : opts.maxIter;
    const lm0 = opts.lm0 === undefined ? 1e-3 : opts.lm0;
    const maxStep = opts.maxStep === undefined ? 0.4 : opts.maxStep;
    const moving = this._movingBodies();
    const n = moving.length * 6;
    if (n === 0) {
      const r0 = this.computeResiduals();
      const rm = r0.length ? Math.max(...r0.map(Math.abs)) : 0;
      return { converged: rm <= tol, iterations: 0, residualMax: rm };
    }

    const fdH = 1e-7;
    let residual = this.computeResiduals();
    const m = residual.length;
    if (m === 0) return { converged: true, iterations: 0, residualMax: 0 };

    let lambda = lm0;

    for (let iter = 0; iter < maxIter; iter++) {
      let rmax = 0;
      for (let i = 0; i < m; i++) rmax = Math.max(rmax, Math.abs(residual[i]));
      if (rmax <= tol) {
        return { converged: true, iterations: iter, residualMax: rmax };
      }

      const JtJ = new Array(n);
      const JtR = new Array(n).fill(0);
      const J = new Array(m);
      for (let i = 0; i < m; i++) J[i] = new Array(n).fill(0);

      const snap = this._snapshot(moving);
      for (let v = 0; v < n; v++) {
        const bi = Math.floor(v / 6);
        const comp = v % 6;
        for (let s = 0; s < 2; s++) {
          const sgn = s === 0 ? 1 : -1;
          const b = moving[bi];
          if (comp < 3) {
            b.position[comp] += sgn * fdH;
          } else {
            const e = [0, 0, 0];
            e[comp - 3] = sgn * fdH;
            b.q = quat.normalize(quat.multiply(b.q, quat.expOmega(e)));
          }
          const rr = this.computeResiduals();
          for (let i = 0; i < m; i++) {
            J[i][v] += (s === 0 ? 1 : -1) * rr[i];
          }
          this._restore(moving, snap);
        }
        for (let i = 0; i < m; i++) J[i][v] /= 2 * fdH;
      }

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let k = 0; k < m; k++) s += J[k][i] * J[k][j];
          JtJ[i * n + j] = s;
        }
        let s = 0;
        for (let k = 0; k < m; k++) s += J[k][i] * residual[k];
        JtR[i] = -s;
      }

      let accepted = false;
      for (let tries = 0; tries < 12 && !accepted; tries++) {
        let maxDiag = 0;
        for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, JtJ[i * n + i]);
        const active = [];
        const floor = Math.max(1e-12, maxDiag * 1e-10);
        for (let i = 0; i < n; i++) {
          if (JtJ[i * n + i] > floor) active.push(i);
        }
        if (active.length === 0) break;
        const k = active.length;
        const A = new Array(k);
        const rhs = new Array(k);
        for (let i = 0; i < k; i++) {
          A[i] = new Array(k);
          const ai = active[i];
          const diag = Math.max(JtJ[ai * n + ai], floor);
          for (let j = 0; j < k; j++) {
            A[i][j] = JtJ[ai * n + active[j]] + (i === j ? lambda * diag : 0);
          }
          rhs[i] = JtR[ai];
        }
        const sol = solveLinear(A, rhs);
        if (!sol) {
          lambda *= 10;
          continue;
        }
        const delta = new Array(n).fill(0);
        for (let i = 0; i < k; i++) delta[active[i]] = sol[i];
        let deltaMax = 0;
        for (let i = 0; i < n; i++) deltaMax = Math.max(deltaMax, Math.abs(delta[i]));
        if (deltaMax > maxStep) {
          const scale = maxStep / deltaMax;
          for (let i = 0; i < n; i++) delta[i] *= scale;
        }
        this._applyStep(moving, delta);
        const rr = this.computeResiduals();
        let newMax = 0;
        for (let i = 0; i < m; i++) newMax = Math.max(newMax, Math.abs(rr[i]));
        if (newMax < rmax) {
          residual = rr;
          accepted = true;
          lambda = Math.max(lambda / 3, 1e-12);
        } else {
          this._restore(moving, snap);
          lambda *= 10;
        }
      }

      if (!accepted) {
        return { converged: false, iterations: iter + 1, residualMax: rmax };
      }
    }

    let rmax = 0;
    for (let i = 0; i < m; i++) rmax = Math.max(rmax, Math.abs(residual[i]));
    return { converged: rmax <= tol, iterations: maxIter, residualMax: rmax };
  }

  angleAboutAxis(bodyId, axis, unwrapped = false) {
    return this._angleBody(this.body(bodyId), normalized(axis), unwrapped);
  }
}

module.exports = { AssemblySolver, AssemblyBody, AssemblyConstraintSolver: AssemblySolver };
