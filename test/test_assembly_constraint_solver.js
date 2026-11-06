/**
 * Test Suite: AssemblyConstraintSolver (Mobility, Concentric Mates, Gear Ratio, Interference)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AssemblyConstraintSolver } = require('../src/core/cad/assembly_constraint_solver');

test('AssemblyConstraintSolver: Evaluates Grübler-Kutzbach spatial mobility accurately', () => {
  const asm = new AssemblyConstraintSolver();

  // Fixed housing
  asm.addBody('housing', { isFixed: true });
  // Rotating shaft
  asm.addBody('shaft', { isFixed: false });

  // 1 free body has 6 DOFs
  let mob = asm.calculateMobility();
  assert.equal(mob.mobility, 6, 'Unconstrained body must have 6 DOFs');

  // Add concentric mate (allows 1 translation along axis, 1 rotation around axis = 2 DOFs remaining)
  asm.addConstraint('concentric', 'housing', 'shaft');
  mob = asm.calculateMobility();
  assert.equal(mob.mobility, 2, 'Concentric mate must leave 2 DOFs');

  // Add distance mate (locks axial slide = 1 DOF remaining: pure rotation)
  asm.addConstraint('distance', 'housing', 'shaft', { distance: 0 });
  mob = asm.calculateMobility();
  assert.equal(mob.mobility, 1, 'Revolute joint equivalent must have 1 DOF');
});

test('AssemblyConstraintSolver: Enforces gear kinematic rotation coupling', () => {
  const asm = new AssemblyConstraintSolver();
  asm.addBody('pinion', { isFixed: false });
  asm.addBody('gear', { isFixed: false });

  const teethPinion = 20;
  const teethGear = 60;
  const ratio = teethPinion / teethGear; // 1/3

  // Rotate pinion by 3.0 radians
  asm.updateGearCoupling('pinion', 'gear', 3.0, ratio);

  const bPinion = asm.bodies.get('pinion');
  const bGear = asm.bodies.get('gear');

  assert.equal(bPinion.rotation[2], 3.0, 'Pinion angle must be 3.0 rad');
  assert.equal(bGear.rotation[2], -1.0, 'Gear angle must be -1.0 rad (counter-rotating at 1/3 speed)');
});

test('AssemblyConstraintSolver: Detects physical component collision interference', () => {
  const asm = new AssemblyConstraintSolver();
  // Body 1 at (0, 0, 0) with radius 10
  asm.addBody('partA', { position: [0, 0, 0], boundingRadius: 10 });
  // Body 2 at (15, 0, 0) with radius 10 (total sum = 20 > distance 15 -> 5 mm interference)
  asm.addBody('partB', { position: [15, 0, 0], boundingRadius: 10 });

  const collisions = asm.checkInterferences();
  assert.equal(collisions.length, 1, 'Must detect 1 interference pair');
  assert.equal(collisions[0].bodyA, 'partA');
  assert.equal(collisions[0].bodyB, 'partB');
  assert.ok(Math.abs(collisions[0].penetrationDepth - 5.0) < 1e-12, 'Penetration depth must be 5 mm');
});
