'use strict';

const assert = require('assert');
const { BRepPrimitives } = require('../src/core/cad/brep_topology');
const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { trianglesIntersect, meshCollision, checkRobotPath } = require('../src/core/robotics/collision_checks');

function translateSolid(solid, t) {
  for (const v of solid.vertices) {
    v.point.x += t[0];
    v.point.y += t[1];
    v.point.z += t[2];
  }
  return solid;
}

function assertApproxArray(actual, expected, tol, label) {
  assert.strictEqual(actual.length, expected.length, `${label}: length mismatch`);
  for (let i = 0; i < expected.length; i++) {
    assert(Math.abs(actual[i] - expected[i]) <= tol, `${label}[${i}]: ${actual[i]} differs from ${expected[i]}`);
  }
}

async function runRoboticsCollisionTests() {
  let passed = 0;

  // (a) two intersecting unit cubes -> collision true with point inside overlap
  const cubeA = BRepPrimitives.createBox(1, 1, 1, 'CubeA');
  const cubeB = translateSolid(BRepPrimitives.createBox(1, 1, 1, 'CubeB'), [0.75, 0, 0]);
  const hitA = meshCollision(cubeA, cubeB, { returnDetails: true });
  assert.strictEqual(hitA.collided, true, '(a) intersecting cubes must collide');
  assert.strictEqual(hitA.phase, 'narrowphase', '(a) hit must be narrow-phase');
  assert(hitA.point[0] >= 0.25 - 1e-6 && hitA.point[0] <= 0.5 + 1e-6, `(a) point.x ${hitA.point[0]} inside overlap`);
  assert(hitA.point[1] >= -0.5 - 1e-6 && hitA.point[1] <= 0.5 + 1e-6, '(a) point.y inside overlap');
  assert(hitA.point[2] >= -0.5 - 1e-6 && hitA.point[2] <= 0.5 + 1e-6, '(a) point.z inside overlap');
  passed++;

  // (b) separated cubes -> false
  const cubeC = translateSolid(BRepPrimitives.createBox(1, 1, 1, 'CubeC'), [2.1, 0, 0]);
  assert.strictEqual(meshCollision(cubeA, cubeC), false, '(b) separated cubes must not collide');
  passed++;

  // (c) PUMA path passing through a wall mesh -> detects collision at known q
  const wall = BRepPrimitives.createBox(0.2, 0.2, 1.0, 'Wall');
  translateSolid(wall, [0.32, 0.32, 0.4]);
  const qStart = [0, 0, 0, 0, 0, 0];
  const qEnd = [Math.PI / 2, 0, 0, 0, 0, 0];
  const pathHit = checkRobotPath(PUMA_560_DH, qStart, qEnd, [{ solid: wall }], { numSamples: 3 });
  assert(pathHit !== null, '(c) wall-crossing path must collide');
  assert.strictEqual(pathHit.mode, 'static', '(c) expected static sample collision');
  assert.strictEqual(pathHit.sampleIndex, 1, '(c) collision at middle sample');
  assertApproxArray(pathHit.config, [Math.PI / 4, 0, 0, 0, 0, 0], 1e-9, '(c) known q');
  assert(pathHit.linkIndex >= 1 && pathHit.linkIndex <= 6, '(c) valid link index');
  assert(
    pathHit.point[0] >= 0.22 - 1e-6 &&
      pathHit.point[0] <= 0.42 + 1e-6 &&
      pathHit.point[1] >= 0.22 - 1e-6 &&
      pathHit.point[1] <= 0.42 + 1e-6 &&
      pathHit.point[2] >= -0.1 - 1e-6 &&
      pathHit.point[2] <= 0.9 + 1e-6,
    `(c) contact point ${pathHit.point} inside wall`
  );
  const fkMid = SerialManipulatorEngine.forwardKinematics(PUMA_560_DH, pathHit.config);
  assert(Number.isFinite(fkMid.position[0]), '(c) FK finite at collision config');

  const adapter = new RoboticsEngineAdapter();
  const adapterHit = await adapter.execute({
    jobId: 'robotics-collision-wall',
    domain: 'robotics',
    operation: 'collision_check',
    parameters: {
      dhTable: PUMA_560_DH,
      qStart,
      qEnd,
      obstacles: [{ solid: wall }],
      numSamples: 3,
      linkRadius: 0.04
    }
  });
  assert.strictEqual(adapterHit.outputData.collided, true, '(c/adapter) collision detected');
  assert.strictEqual(adapterHit.outputData.collision.sampleIndex, 1, '(c/adapter) middle sample hit');
  assertApproxArray(adapterHit.outputData.collision.config, [Math.PI / 4, 0, 0, 0, 0, 0], 1e-9, '(c/adapter) known q');
  assert.deepStrictEqual(adapterHit.outputData.residualHistory, [1], '(c/adapter) residual 1 on collision');
  passed++;

  // (d) same path in free space -> null
  const farWall = translateSolid(BRepPrimitives.createBox(0.2, 0.2, 1.0, 'FarWall'), [10, 10, 10]);
  assert.strictEqual(
    checkRobotPath(PUMA_560_DH, qStart, qEnd, [{ solid: farWall }], { numSamples: 3 }),
    null,
    '(d) free-space path must be clear'
  );
  const adapterFree = await adapter.execute({
    jobId: 'robotics-collision-free',
    domain: 'robotics',
    operation: 'collision_check',
    parameters: {
      dhTable: PUMA_560_DH,
      qStart,
      qEnd,
      obstacles: [{ solid: farWall }],
      numSamples: 3
    }
  });
  assert.strictEqual(adapterFree.outputData.collided, false, '(d/adapter) no collision');
  assert.strictEqual(adapterFree.outputData.collision, null, '(d/adapter) collision field null');
  assert.deepStrictEqual(adapterFree.outputData.residualHistory, [0], '(d/adapter) residual 0 when clear');
  passed++;

  // (e) degenerate triangles never throw and are handled honestly
  const degenerate = [
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 2]
  ];
  const degenerate2 = [
    [0, 0, 0],
    [0, 0, 0],
    [3, 0, 0]
  ];
  const hitDeg = trianglesIntersect(
    degenerate[0],
    degenerate[1],
    degenerate[2],
    degenerate2[0],
    degenerate2[1],
    degenerate2[2]
  );
  assert.strictEqual(hitDeg.collided, false, '(e) degenerate pair never intersects');
  assert.strictEqual(hitDeg.degenerate, true, '(e) degenerate flagged');
  const meshDeg = { triangles: [degenerate, degenerate2, ...cubeA.toTriangles()] };
  const hitDegMesh = meshCollision(meshDeg, cubeB, { returnDetails: true });
  assert.strictEqual(hitDegMesh.collided, true, '(e) mesh with degenerate triangles still works');
  passed++;

  // Coplanar branch: overlapping coplanar triangles -> true, disjoint -> false
  const coA = [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0]
  ];
  const coB = [
    [0.5, 0.5, 0],
    [1.5, 0.5, 0],
    [1, 1.25, 0]
  ];
  const coC = [
    [5, 5, 0],
    [6, 5, 0],
    [5, 6, 0]
  ];
  const hitCo = trianglesIntersect(coA[0], coA[1], coA[2], coB[0], coB[1], coB[2]);
  assert.strictEqual(hitCo.collided, true, 'coplanar overlap intersects');
  assert.strictEqual(hitCo.coplanar, true, 'coplanar branch flagged');
  const missCo = trianglesIntersect(coA[0], coA[1], coA[2], coC[0], coC[1], coC[2]);
  assert.strictEqual(missCo.collided, false, 'coplanar disjoint does not intersect');
  passed++;

  console.log(`  ✓ Robotics collision checks: ${passed}/${passed} checks passed`);
  return { total: passed, passed };
}

if (require.main === module) {
  runRoboticsCollisionTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runRoboticsCollisionTests };
