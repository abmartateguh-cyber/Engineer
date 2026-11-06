'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AssemblySolver } = require('../src/core/cad/assembly_constraint_solver');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function looseGuess(rng, scale) {
  return [(rng() - 0.5) * 2 * scale, (rng() - 0.5) * 2 * scale, (rng() - 0.5) * 2 * scale];
}

function r3(a, b, c) {
  return [a, b, c];
}

test('quaternion helpers: rotate local axis into world frame', () => {
  const asm = new AssemblySolver();
  asm.addBody('A', { position: [1, 2, 3], rotation: [0, 0, Math.PI / 2] });
  const w = asm._worldAxis(asm.body('A'), [1, 0, 0]);
  assert.ok(Math.abs(w[0]) < 1e-12);
  assert.ok(Math.abs(w[1] - 1) < 1e-12);
  assert.ok(Math.abs(w[2]) < 1e-12);
});

test('Coincident closes to residual < 1e-8 from loose guess', () => {
  const rng = mulberry32(11);
  const asm = new AssemblySolver();
  asm.addBody('A', { position: looseGuess(rng, 4), rotation: looseGuess(rng, 1) });
  asm.addBody('B', { position: [1, 2, 3], rotation: [0.2, 0.4, 0.6], isFixed: true });
  asm.coincident('A', [0.5, -0.25, 0.1], 'B', [0, 0, 0]);
  const res = asm.solve({ tol: 1e-11 });
  assert.ok(res.converged, `not converged: ${JSON.stringify(res)}`);
  const residMax = Math.max(...asm.computeResiduals().map(Math.abs));
  assert.ok(residMax < 1e-8, `residual ${residMax}`);
});

test('Distance closes to residual < 1e-8 from loose guess', () => {
  const rng = mulberry32(23);
  const asm = new AssemblySolver();
  asm.addBody('A', { position: looseGuess(rng, 5), rotation: looseGuess(rng, 1.2) });
  asm.addBody('B', { position: [-2, 1, 0.5], rotation: [0.1, -0.3, 0.9], isFixed: true });
  asm.distance('A', [0, 0, 0], 'B', [0, 0, 0], 5.0);
  const res = asm.solve({ tol: 1e-11 });
  assert.ok(res.converged, `not converged: ${JSON.stringify(res)}`);
  const residMax = Math.max(...asm.computeResiduals().map(Math.abs));
  assert.ok(residMax < 1e-8, `residual ${residMax}`);
});

test('Angle closes to residual < 1e-8 from loose guess', () => {
  const rng = mulberry32(37);
  const asm = new AssemblySolver();
  asm.addBody('A', { position: looseGuess(rng, 3), rotation: looseGuess(rng, 0.9) });
  asm.addBody('B', { position: [0, 0, 0], rotation: [0, 0, 0], isFixed: true });
  asm.angle('A', [0, 0, 1], 'B', [0, 0, 1], 0.7);
  const res = asm.solve({ tol: 1e-11 });
  assert.ok(res.converged, `not converged: ${JSON.stringify(res)}`);
  const residMax = Math.max(...asm.computeResiduals().map(Math.abs));
  assert.ok(residMax < 1e-8, `residual ${residMax}`);
});

test('Parallel closes to residual < 1e-8 from loose guess', () => {
  const rng = mulberry32(41);
  const asm = new AssemblySolver();
  asm.addBody('A', { position: looseGuess(rng, 4), rotation: looseGuess(rng, 1.1) });
  asm.addBody('B', { position: [5, 5, 5], rotation: [0.8, 0.2, -0.5], isFixed: true });
  asm.parallel('A', [0, 0, 1], 'B', [0, 0, 1]);
  const res = asm.solve({ tol: 1e-11 });
  assert.ok(res.converged, `not converged: ${JSON.stringify(res)}`);
  const residMax = Math.max(...asm.computeResiduals().map(Math.abs));
  assert.ok(residMax < 1e-8, `residual ${residMax}`);
});

test('Tangent sphere-plane closes to residual < 1e-8 from loose guess', () => {
  const rng = mulberry32(53);
  const asm = new AssemblySolver();
  asm.addBody('A', { position: looseGuess(rng, 4), rotation: looseGuess(rng, 0.8) });
  asm.addBody('B', { position: [0, 0, 0], rotation: [0, 0, 0], isFixed: true });
  asm.tangentSpherePlane('A', [0, 0, 0], 2.0, 'B', [0, 0, 0], [0, 1, 0]);
  const res = asm.solve({ tol: 1e-11 });
  assert.ok(res.converged, `not converged: ${JSON.stringify(res)}`);
  const residMax = Math.max(...asm.computeResiduals().map(Math.abs));
  assert.ok(residMax < 1e-8, `residual ${residMax}`);
});

test('solver is deterministic across identical runs', () => {
  function run(seed) {
    const rng = mulberry32(seed);
    const asm = new AssemblySolver();
    asm.addBody('A', { position: looseGuess(rng, 5), rotation: looseGuess(rng, 1) });
    asm.addBody('B', { position: [1, 1, 1], rotation: [0.3, 0.2, 0.1], isFixed: true });
    asm.coincident('A', [0, 0, 0], 'B', [0, 0, 0]);
    asm.distance('A', [1, 0, 0], 'B', [0, 0, 0], 3.0);
    asm.solve({ tol: 1e-11 });
    const b = asm.body('A');
    return [...b.position, ...b.q];
  }
  const first = run(97);
  for (let i = 0; i < 3; i++) {
    const again = run(97);
    for (let k = 0; k < first.length; k++) {
      assert.ok(Math.abs(first[k] - again[k]) < 1e-14, `nondeterministic at ${k}`);
    }
  }
});

function buildFourBar(a, b, c, d, perturb) {
  const base = d - a;
  const x = (base * base + b * b - c * c) / (2 * base);
  const y = Math.sqrt(Math.max(0, b * b - x * x));
  const gamma = Math.atan2(y, x);
  const Q = [a + x, y, 0];
  const psi = Math.atan2(Q[1], Q[0] - d);
  const asm = new AssemblySolver();
  asm.addBody('ground', { position: [0, 0, 0], rotation: [0, 0, 0], isFixed: true });
  asm.addBody('crank', { position: [a / 2 + perturb[0], perturb[1], perturb[2]], rotation: [0, 0, perturb[3]] });
  asm.addBody('coupler', {
    position: [a + perturb[4], perturb[5], perturb[6]],
    rotation: [0, 0, gamma + perturb[7]]
  });
  asm.addBody('rocker', {
    position: [Q[0] + perturb[8], Q[1] + perturb[9], perturb[10]],
    rotation: [0, 0, psi + perturb[11]]
  });
  asm.coincident('crank', [0, 0, 0], 'ground', [0, 0, 0]);
  asm.coincident('crank', [a, 0, 0], 'coupler', [0, 0, 0]);
  asm.coincident('coupler', [b, 0, 0], 'rocker', [0, 0, 0]);
  asm.coincident('rocker', [c, 0, 0], 'ground', [d, 0, 0]);
  asm.parallel('crank', [0, 0, 1], 'ground', [0, 0, 1]);
  asm.parallel('coupler', [0, 0, 1], 'ground', [0, 0, 1]);
  asm.parallel('rocker', [0, 0, 1], 'ground', [0, 0, 1]);
  asm.orientationBias('rocker', [1, 0, 0], [0, 1, 0], 1000);
  const drv = asm.drive('crank', [0, 0, 1], 0);
  return { asm, drv };
}

test('4-bar linkage: assemble, drive 720 deg, closure + periodicity + Grashof swing', () => {
  const a = 3;
  const b = 5;
  const c = 6;
  const d = 7;
  const { asm, drv } = buildFourBar(a, b, c, d, [0.4, -0.3, 0.2, 0.15, -0.5, 0.35, 0.1, -0.2, 0.3, -0.25, 0.05, 0.12]);

  let init = asm.solve({ tol: 1e-11 });
  assert.ok(init.converged, `assembly failed: ${JSON.stringify(init)}`);

  const steps = 720;
  const deltaRad = (4 * Math.PI) / steps;
  let maxClosure = 0;
  const rockerVals = [];
  const crankVals = [];

  for (let i = 0; i <= steps; i++) {
    const target = i * deltaRad;
    drv.setTarget(target);
    const res = asm.solve({ tol: 1e-11 });
    assert.ok(res.converged, `drive step ${i} failed: ${JSON.stringify(res)}`);
    const residuals = asm.computeResiduals();
    let closure = 0;
    let ci = 0;
    for (const cns of asm.constraints) {
      const r = cns.residual(asm);
      if (cns.type !== 'driver') {
        for (let k = 0; k < r.length; k++) closure = Math.max(closure, Math.abs(r[k]));
      }
      ci += r.length;
    }
    void residuals;
    void ci;
    maxClosure = Math.max(maxClosure, closure);
    const rockerAng = asm.angleAboutAxis('rocker', [0, 0, 1]);
    rockerVals.push(rockerAng);
    crankVals.push(target);
    assert.ok(closure < 1e-8, `closure residual ${closure} at step ${i}`);
  }

  const swing = Math.max(...rockerVals) - Math.min(...rockerVals);
  const t1 = (d * d + c * c - (a + b) * (a + b)) / (2 * d * c);
  const t2 = (d * d + c * c - (b - a) * (b - a)) / (2 * d * c);
  const theorySwing = Math.abs(Math.acos(Math.min(1, Math.max(-1, t1))) - Math.acos(Math.min(1, Math.max(-1, t2))));
  const swingRatio = swing / theorySwing;
  assert.ok(Math.abs(swingRatio - 1) < 0.01, `swing ${swing} vs theory ${theorySwing} ratio ${swingRatio}`);
  assert.ok(maxClosure < 1e-8, `max closure ${maxClosure}`);

  for (let i = 0; i < steps / 2; i++) {
    const periodErr = Math.abs(rockerVals[i] - rockerVals[i + steps / 2]);
    assert.ok(periodErr < 1e-5, `periodicity error ${periodErr} at step ${i}`);
  }

  console.log(
    `[4-bar] swing measured=${swing.toFixed(8)} theory=${theorySwing.toFixed(8)} ratio=${swingRatio.toFixed(6)} maxClosure=${maxClosure.toExponential(3)}`
  );
});

test('Planetary gearbox: carrier = sun/(1+N_ring/N_sun), planets synchronized', () => {
  const zs = 20;
  const zr = 80;
  const zp = 30;
  const sunPlanetRatio = zs / zp;
  const carrierRatio = 1 / (1 + zr / zs);
  const planetCarrierRatio = 1 - zr / zp;

  const asm = new AssemblySolver();
  asm.addBody('ring', { position: [0, 0, 0], rotation: [0, 0, 0], isFixed: true });
  asm.addBody('sun', { position: [0, 0, 0], rotation: [0, 0, 0] });
  asm.addBody('carrier', { position: [0, 0, 0], rotation: [0, 0, 0] });
  asm.coincident('sun', [0, 0, 0], 'ring', [0, 0, 0]);
  asm.coincident('carrier', [0, 0, 0], 'ring', [0, 0, 0]);
  asm.parallel('sun', [0, 0, 1], 'ring', [0, 0, 1]);
  asm.parallel('carrier', [0, 0, 1], 'ring', [0, 0, 1]);
  asm.gear('sun', 'carrier', carrierRatio);

  const orbitR = 25;
  const planetBodies = ['p1', 'p2', 'p3'];
  const planetAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  for (let i = 0; i < 3; i++) {
    const id = planetBodies[i];
    asm.addBody(id, {
      position: [orbitR * Math.cos(planetAngles[i]), orbitR * Math.sin(planetAngles[i]), 0],
      rotation: [0, 0, 0]
    });
    asm.parallel(id, [0, 0, 1], 'ring', [0, 0, 1]);
    asm.gear('carrier', id, planetCarrierRatio);
    asm.orbital(id, 'carrier', orbitR);
  }

  const drv = asm.drive('sun', [0, 0, 1], 0);
  let init = asm.solve({ tol: 1e-11 });
  assert.ok(init.converged, `assembly failed: ${JSON.stringify(init)}`);

  const steps = 36;
  const deltaRad = (2 * Math.PI) / steps;
  let maxClosure = 0;
  let maxCarrierErr = 0;
  let maxPlanetErr = 0;

  for (let i = 0; i <= steps; i++) {
    const target = i * deltaRad;
    drv.setTarget(target);
    const res = asm.solve({ tol: 1e-11 });
    assert.ok(res.converged, `drive step ${i} failed: ${JSON.stringify(res)}`);

    let closure = 0;
    for (const cns of asm.constraints) {
      if (cns.type === 'driver') continue;
      const r = cns.residual(asm);
      for (let k = 0; k < r.length; k++) closure = Math.max(closure, Math.abs(r[k]));
    }
    maxClosure = Math.max(maxClosure, closure);

    const thetaSun = asm.angleAboutAxis('sun', [0, 0, 1], true);
    const thetaCarrier = asm.angleAboutAxis('carrier', [0, 0, 1], true);
    const carrierErr = Math.abs(thetaCarrier - thetaSun * carrierRatio);
    maxCarrierErr = Math.max(maxCarrierErr, carrierErr);
    assert.ok(carrierErr < 1e-6, `carrier error ${carrierErr} at step ${i}`);

    for (let k = 0; k < 3; k++) {
      const thetaPlanet = asm.angleAboutAxis(planetBodies[k], [0, 0, 1], true);
      const expectedPlanet = thetaCarrier * planetCarrierRatio;
      const planetErr = Math.abs(thetaPlanet - expectedPlanet);
      maxPlanetErr = Math.max(maxPlanetErr, planetErr);
    }

    assert.ok(closure < 1e-8, `closure ${closure} at step ${i}`);
  }

  assert.ok(maxCarrierErr < 1e-6);
  assert.ok(maxPlanetErr < 1e-6);
  console.log(
    `[planetary] maxCarrierErr=${maxCarrierErr.toExponential(3)} maxPlanetErr=${maxPlanetErr.toExponential(3)} maxClosure=${maxClosure.toExponential(3)} ratio=1/(1+${zr}/${zs})=${carrierRatio}`
  );
});

test('Rack-and-pinion: x = R*theta exactly (1e-9) both directions', () => {
  const R = 10;
  const asm = new AssemblySolver();
  asm.addBody('ground', { position: [0, 0, 0], rotation: [0, 0, 0], isFixed: true });
  asm.addBody('pinion', { position: [0, 0, 0], rotation: [0, 0, 0] });
  asm.addBody('rack', { position: [0, 0, 0], rotation: [0, 0, 0] });
  asm.coincident('pinion', [0, 0, 0], 'ground', [0, 0, 0]);
  asm.parallel('pinion', [0, 0, 1], 'ground', [0, 0, 1]);
  asm.parallel('rack', [0, 0, 1], 'ground', [0, 0, 1]);
  asm.rackPinion('pinion', 'rack', R);

  const drv = asm.drive('pinion', [0, 0, 1], 0);
  const init = asm.solve({ tol: 1e-11 });
  assert.ok(init.converged, `assembly failed: ${JSON.stringify(init)}`);

  const steps = 72;
  const deltaRad = (4 * Math.PI) / steps;
  let maxErr = 0;

  for (let dir = 0; dir < 2; dir++) {
    for (let i = 0; i <= steps; i++) {
      const target = (dir === 0 ? i : steps - i) * deltaRad;
      drv.setTarget(target);
      const res = asm.solve({ tol: 1e-12 });
      assert.ok(res.converged, `step ${i} dir ${dir} failed: ${JSON.stringify(res)}`);
      const rackX = asm.body('rack').position[0];
      const err = Math.abs(rackX - R * target);
      maxErr = Math.max(maxErr, err);
      assert.ok(err < 1e-9, `rack error ${err} at target ${target}`);
    }
  }
  console.log(`[rack] maxErr=${maxErr.toExponential(3)}`);
});

test('Cam-follower: lift y(theta)=e(1-cos theta)+c to 1e-6', () => {
  const e = 10;
  const c = 25;
  const asm = new AssemblySolver();
  asm.addBody('ground', { position: [0, 0, 0], rotation: [0, 0, 0], isFixed: true });
  asm.addBody('cam', { position: [0, 0, 0], rotation: [0, 0, 0] });
  asm.addBody('follower', { position: [0, c, 0], rotation: [0, 0, 0] });
  asm.coincident('cam', [0, 0, 0], 'ground', [0, 0, 0]);
  asm.parallel('cam', [0, 0, 1], 'ground', [0, 0, 1]);
  asm.parallel('follower', [0, 0, 1], 'ground', [0, 0, 1]);
  asm.camFollower('cam', 'follower', e, c);

  const drv = asm.drive('cam', [0, 0, 1], 0);
  const init = asm.solve({ tol: 1e-11 });
  assert.ok(init.converged, `assembly failed: ${JSON.stringify(init)}`);

  const steps = 360;
  const deltaRad = (2 * Math.PI) / steps;
  let maxErr = 0;
  for (let i = 0; i <= steps; i++) {
    const target = i * deltaRad;
    drv.setTarget(target);
    const res = asm.solve({ tol: 1e-11 });
    assert.ok(res.converged, `step ${i} failed: ${JSON.stringify(res)}`);
    const y = asm.body('follower').position[1];
    const expected = e * (1 - Math.cos(target)) + c;
    const err = Math.abs(y - expected);
    maxErr = Math.max(maxErr, err);
    assert.ok(err < 1e-6, `cam error ${err} at target ${target}`);
  }
  console.log(`[cam] maxErr=${maxErr.toExponential(3)}`);
});
