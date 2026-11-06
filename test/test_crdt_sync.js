'use strict';

/**
 * test_crdt_sync.js — verification gate for the state-based CRDT assembly
 * sync engine (src/core/collaboration/crdt_model_sync.js).
 * Battalion 9, Agent 85.
 *
 * Verified properties (all deterministic, dependency-free):
 *   1. Convergence under pairwise merge: two identical replicas, engineer
 *      A adds 3 components and moves 1; engineer B concurrently adds 2
 *      components and deletes 1. After `A.merge(B)` and `B.merge(A)` both
 *      replicas deep-equal and contain the union of all additions minus
 *      deletions.
 *   2. Commutativity: merging replica states in any order yields the same
 *      final state (all 6 permutations of 3 replicas).
 *   3. Idempotence: re-merging an already-merged state changes nothing
 *      (state identical, digest unchanged).
 *   4. Convergence under repeated sync: 100 random-but-seeded operations on
 *      3 replicas with 50 random pairwise merges — all replicas converge to
 *      one deep-equal state.
 *   5. No lost updates: a transform by A on a component never disappears
 *      after B's merge, even when B has never seen that component.
 *
 * Run standalone:  node --test test/test_crdt_sync.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { CrdtModelSync } = require('../src/core/collaboration/crdt_model_sync');

/* Deterministic seeded PRNG (mulberry32) for tests only. */
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

function makeComponent(id, extra = {}) {
  return { id, name: `part-${id}`, ...extra };
}

const INITIAL_COMPONENTS = ['c0', 'c1', 'c2'];

function freshReplica(actor, initial = INITIAL_COMPONENTS) {
  const r = new CrdtModelSync({ actor });
  for (const id of initial) r.applyLocal({ op: 'addComponent', componentId: id, value: makeComponent(id) });
  return r;
}

function snapshotOf(replica) {
  return replica.snapshot();
}

test('convergence: concurrent A/B edits converge after bidirectional merge', () => {
  const A = freshReplica('engineerA');
  const B = freshReplica('engineerB');

  A.applyLocal({ op: 'addComponent', componentId: 'c3', value: makeComponent('c3') });
  A.applyLocal({ op: 'addComponent', componentId: 'c4', value: makeComponent('c4') });
  A.applyLocal({ op: 'addComponent', componentId: 'c5', value: makeComponent('c5') });
  A.applyLocal({ op: 'transformComponent', componentId: 'c0', value: { position: [1, 2, 3], rotation: [0, 0, 45] } });

  B.applyLocal({ op: 'addComponent', componentId: 'c6', value: makeComponent('c6') });
  B.applyLocal({ op: 'addComponent', componentId: 'c7', value: makeComponent('c7') });
  B.applyLocal({ op: 'deleteComponent', componentId: 'c1' });

  A.merge(B);
  B.merge(A);

  assert.deepStrictEqual(snapshotOf(A), snapshotOf(B));

  const expectedPresent = ['c0', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].sort();
  assert.deepStrictEqual(A.componentIds(), expectedPresent);
  assert.deepStrictEqual(B.componentIds(), expectedPresent);

  assert.equal(A.hasComponent('c1'), false, 'deleted component must be absent');
  assert.equal(B.hasComponent('c1'), false);

  const transformA = A.snapshot().elements['c0:transformComponent'];
  const transformB = B.snapshot().elements['c0:transformComponent'];
  assert.ok(transformA, 'A move record must persist');
  assert.ok(transformB, 'A move record must reach B');
  assert.deepStrictEqual(transformA.value, { position: [1, 2, 3], rotation: [0, 0, 45] });
  assert.deepStrictEqual(transformB.value, transformA.value);
});

test('commutativity: merge order across 3 replicas does not matter', () => {
  const replicas = [];
  const actors = ['r1', 'r2', 'r3'];
  for (const actor of actors) replicas.push(freshReplica(actor, []));

  replicas[0].applyLocal({ op: 'addComponent', componentId: 'a', value: makeComponent('a') });
  replicas[0].applyLocal({ op: 'transformComponent', componentId: 'a', value: { position: [1, 0, 0] } });
  replicas[1].applyLocal({ op: 'addComponent', componentId: 'b', value: makeComponent('b') });
  replicas[1].applyLocal({ op: 'deleteComponent', componentId: 'a' });
  replicas[2].applyLocal({ op: 'addComponent', componentId: 'c', value: makeComponent('c') });
  replicas[2].applyLocal({ op: 'addRelation', componentId: 'rel12', value: { from: 'a', to: 'b', kind: 'mate' } });

  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0]
  ];

  const results = new Map();
  for (const perm of permutations) {
    const merged = new CrdtModelSync({ actor: 'sink' });
    for (const idx of perm) merged.merge(replicas[idx]);
    const snap = snapshotOf(merged);
    const digest = merged.digest();
    results.set(perm.join(''), { digest, snap });
  }

  const firstDigest = results.get('012').digest;
  for (const perm of permutations) {
    assert.equal(results.get(perm.join('')).digest, firstDigest, `merge order ${perm} must yield identical digest`);
  }
  for (const perm of permutations) {
    assert.deepStrictEqual(
      results.get(perm.join('')).snap,
      results.get('012').snap,
      `merge order ${perm} must yield identical state`
    );
  }
});

test('idempotence: re-merging an already-merged state changes nothing', () => {
  const A = freshReplica('A');
  const B = freshReplica('B');
  A.applyLocal({ op: 'addComponent', componentId: 'x', value: makeComponent('x') });
  B.applyLocal({ op: 'addComponent', componentId: 'y', value: makeComponent('y') });
  B.applyLocal({ op: 'transformComponent', componentId: 'x', value: { position: [5, 5, 5] } });

  A.merge(B);
  B.merge(A);
  const before = snapshotOf(A);
  const beforeDigest = A.digest();
  const beforeB = snapshotOf(B);

  A.merge(B);
  A.merge(A);
  B.merge(B);
  B.merge(A);

  const after = snapshotOf(A);
  const afterDigest = A.digest();

  assert.deepStrictEqual(after, before, 'state must be unchanged after idempotent re-merge');
  assert.equal(afterDigest, beforeDigest, 'digest must be unchanged after idempotent re-merge');
  assert.deepStrictEqual(snapshotOf(B), after, 'self-merge must be a no-op');
  assert.deepStrictEqual(snapshotOf(B), beforeB, 're-merge must be a no-op on B');
});

test('convergence under repeated sync: 100 seeded ops, 3 replicas, random pairwise merges', () => {
  const rand = mulberry32(0xc0ffee);
  const actors = ['A', 'B', 'C'];
  const replicas = [freshReplica('A', []), freshReplica('B', []), freshReplica('C', [])];

  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let i = 0; i < 100; i += 1) {
    const r = pick(replicas);
    const cid = `c${Math.floor(rand() * 10)}`;
    const opKind = Math.floor(rand() * 4);
    const op =
      opKind === 0
        ? { op: 'addComponent', componentId: cid, value: makeComponent(cid, { mass: Math.floor(rand() * 100) }) }
        : opKind === 1
          ? { op: 'transformComponent', componentId: cid, value: { position: [rand(), rand(), rand()] } }
          : opKind === 2
            ? { op: 'deleteComponent', componentId: cid }
            : {
                op: 'addRelation',
                componentId: `rel${Math.floor(rand() * 10)}`,
                value: { from: cid, to: `c${Math.floor(rand() * 10)}`, kind: 'mate' }
              };
    r.applyLocal(op);
  }

  for (let i = 0; i < 50; i += 1) {
    const a = pick(replicas);
    const b = pick(replicas);
    if (a === b) continue;
    a.merge(b);
    b.merge(a);
  }

  const snapshotA = snapshotOf(replicas[0]);
  const digestA = replicas[0].digest();
  for (const r of replicas) {
    assert.deepStrictEqual(snapshotOf(r), snapshotA, 'all replicas must converge to one state');
    assert.equal(r.digest(), digestA, 'all replicas must share one digest');
  }
});

test('no lost updates: A transform never disappears after B merges without ever seeing it', () => {
  const A = freshReplica('A', []);
  const B = freshReplica('B', []);

  A.applyLocal({ op: 'addComponent', componentId: 'gear1', value: makeComponent('gear1', { teeth: 32 }) });
  A.applyLocal({ op: 'transformComponent', componentId: 'gear1', value: { position: [10, 20, 30] } });

  B.applyLocal({ op: 'addComponent', componentId: 'plate1', value: makeComponent('plate1') });

  const transformBefore = A.snapshot().elements['gear1:transformComponent'];
  assert.ok(transformBefore, 'A transform record must exist before any merge');

  A.merge(B);
  B.merge(A);

  const transformA = A.snapshot().elements['gear1:transformComponent'];
  const transformB = B.snapshot().elements['gear1:transformComponent'];
  assert.deepStrictEqual(transformA.value, { position: [10, 20, 30] }, 'transform must survive A-side merge');
  assert.deepStrictEqual(
    transformB.value,
    { position: [10, 20, 30] },
    'transform must propagate to B even though B never saw gear1'
  );
  assert.equal(B.hasComponent('gear1'), true, 'component must still be present on B');
  assert.equal(B.hasComponent('plate1'), true);
  assert.equal(A.hasComponent('plate1'), true, 'B addition must propagate to A');

  const diffAB = A.diff(B);
  assert.deepStrictEqual(diffAB, [], 'after bidirectional merge, no incremental diff may remain');

  const applied = new CrdtModelSync({ actor: 'newcomer' });
  applied.applyDiff(A.diff(new CrdtModelSync({ actor: 'blank' })));
  assert.deepStrictEqual(snapshotOf(applied), snapshotOf(A), 'applyDiff from scratch must reconstruct the full state');
});
