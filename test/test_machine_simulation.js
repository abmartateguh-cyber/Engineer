/**
 * Verification tests for the 5-Axis Machine Kinematic Digital Twin Simulator.
 *
 * Verifies:
 * 1. Forward/inverse kinematics round-trip for 1000 random tool poses:
 *    position error < 1e-6 mm and orientation error < 1e-9 rad.
 * 2. Over-travel detection: a path driving the C-axis to +370° (outside its
 *    360° range) is flagged at the exact command index before G-code emission.
 * 3. Over-velocity detection on the offending axis.
 * 4. Over-acceleration detection on the offending axis.
 * 5. A valid path passes all checks.
 * 6. Determinism: identical inputs produce bit-identical results.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MachineSimulationDigitalTwin } = require('../src/core/cam/machine_simulation_digital_twin');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnitVector(rng) {
  const z = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

describe('MachineSimulationDigitalTwin: 5-axis kinematics & trajectory gate', () => {
  it('round-trips 1000 random tool poses within 1e-6 mm / 1e-9 rad', () => {
    const twin = new MachineSimulationDigitalTwin();
    const rng = mulberry32(0xc0ffee);
    let maxPosErr = 0;
    let maxAngErr = 0;

    for (let n = 0; n < 1000; n++) {
      const P = [200 * (2 * rng() - 1), 200 * (2 * rng() - 1), 200 * (2 * rng() - 1)];
      const u = randomUnitVector(rng);
      const rt = twin.roundTrip(P, u);
      maxPosErr = Math.max(maxPosErr, rt.error.pos);
      maxAngErr = Math.max(maxAngErr, rt.error.ang);
    }

    assert.ok(maxPosErr < 1e-6, `max position error ${maxPosErr} mm >= 1e-6`);
    assert.ok(maxAngErr < 1e-9, `max orientation error ${maxAngErr} rad >= 1e-9`);
  });

  it('matches a hand-computed forward kinematics case', () => {
    const twin = new MachineSimulationDigitalTwin();
    const fk = twin.forwardKinematics({ x: 10, y: 20, z: 30, a: 90, c: 0 }, [0, 1, 0], [0, 0, 1]);
    assert.ok(Math.abs(fk.point[0] - 10) < 1e-12);
    assert.ok(Math.abs(fk.point[1] - 20) < 1e-12);
    assert.ok(Math.abs(fk.point[2] - 31) < 1e-12);
    assert.ok(Math.abs(fk.axis[0] - 0) < 1e-12);
    assert.ok(Math.abs(fk.axis[1] - -1) < 1e-12);
    assert.ok(Math.abs(fk.axis[2] - 0) < 1e-12);
  });

  it('flags C-axis over-travel at the exact command index', () => {
    const twin = new MachineSimulationDigitalTwin();
    const path = [
      { x: 0, y: 0, z: 0, a: 0, c: 0, feed: 3000 },
      { x: 10, y: 0, z: 0, a: 0, c: 370, feed: 3000 }
    ];
    const result = twin.simulatePath(path);
    assert.equal(result.valid, false);
    const travel = result.violations.filter((v) => v.type === 'over_travel' && v.axis === 'c');
    assert.equal(travel.length, 1);
    assert.equal(travel[0].commandIndex, 2);
    assert.ok(Math.abs(travel[0].value - 370) < 1e-9);
    assert.ok(travel[0].max <= 360);
    assert.deepEqual(result.diagnostics.c.overTravel, [2]);
  });

  it('flags over-velocity on the offending axis', () => {
    const twin = new MachineSimulationDigitalTwin({
      axes: { x: { min: -1000, max: 1000, vMax: 333.3333, aMax: 50000 } }
    });
    const path = [
      { x: 0, y: 0, z: 0, a: 0, c: 0, feed: 3000 },
      { x: 400, y: 0, z: 0, a: 0, c: 0, feed: 60000 }
    ];
    const result = twin.simulatePath(path);
    const vel = result.violations.filter((v) => v.type === 'over_velocity');
    assert.ok(vel.length >= 1);
    assert.equal(vel[0].axis, 'x');
    assert.equal(vel[0].commandIndex, 2);
    assert.ok(vel[0].value > 333.3333);
    assert.equal(result.diagnostics.x.overVelocity.length, 1);
  });

  it('flags over-acceleration on the offending axis', () => {
    const twin = new MachineSimulationDigitalTwin({
      axes: { x: { min: -1000, max: 1000, vMax: 1e6, aMax: 1000 } }
    });
    const path = [
      { x: 0, y: 0, z: 0, a: 0, c: 0, feed: 3000 },
      { x: 10, y: 0, z: 0, a: 0, c: 0, feed: 6000 }
    ];
    const result = twin.simulatePath(path);
    const accel = result.violations.filter((v) => v.type === 'over_acceleration');
    assert.ok(accel.length >= 1);
    assert.equal(accel[0].axis, 'x');
    assert.equal(accel[0].commandIndex, 2);
    assert.ok(accel[0].value > 1000);
    const vel = result.violations.filter((v) => v.type === 'over_velocity');
    assert.equal(vel.length, 0);
  });

  it('passes a valid RTCP path with no violations', () => {
    const twin = new MachineSimulationDigitalTwin();
    const path = [
      { px: 0, py: 0, pz: 0, i: 0, j: 0, k: 1, feed: 2000 },
      { px: 25, py: 15, pz: -3, i: 0.02, j: 0.2, k: 0.9796, feed: 2000 },
      { px: 50, py: 20, pz: -6, i: 0.04, j: 0.18, k: 0.9829, feed: 2000 },
      { px: 80, py: 10, pz: -9, i: 0.01, j: 0.15, k: 0.9886, feed: 2000 }
    ];
    const result = twin.simulatePath(path, { useRtcp: true });
    assert.equal(result.valid, true);
    assert.equal(result.violations.length, 0);
    assert.deepEqual(result.summary, { overTravel: 0, overVelocity: 0, overAcceleration: 0 });
  });

  it('is deterministic: identical inputs produce identical results', () => {
    const twin1 = new MachineSimulationDigitalTwin();
    const twin2 = new MachineSimulationDigitalTwin();
    const path = [
      { px: 0, py: 0, pz: 0, i: 0, j: 0, k: 1, feed: 2000 },
      { px: 25, py: 15, pz: -3, i: 0.02, j: 0.2, k: 0.9796, feed: 2000 },
      { px: -20, py: 10, pz: -5, i: 0.01, j: 0.25, k: 0.9682, feed: 2500 },
      { px: 60, py: -5, pz: -8, i: 0.03, j: 0.1, k: 0.9945, feed: 1800 }
    ];
    const r1 = twin1.simulatePath(path, { useRtcp: true, sampleCount: 32 });
    const r2 = twin2.simulatePath(path, { useRtcp: true, sampleCount: 32 });
    assert.deepEqual(r1, r2);
  });
});
