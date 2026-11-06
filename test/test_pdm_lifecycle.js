'use strict';

const assert = require('node:assert/strict');
const { PDMRevisionLifecycle, STATES, TRANSITIONS, STATE_RANK, ZERO_SEAL } = require('../src/core/pdm/pdm_lifecycle');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 PASSED: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 FAILED: ${name}`);
    console.error(`    ${err.stack}`);
  }
}

console.log('================================================================');
console.log('   TESTING PDM REVISION LIFECYCLE & ECO WORKFLOW (Agent-37)  ');
console.log('================================================================\n');

test('state machine topology is complete and rank-consistent', () => {
  assert.deepStrictEqual([...TRANSITIONS.WIP], [STATES.IN_REVIEW], 'WIP -> IN_REVIEW only');
  assert.deepStrictEqual(
    [...TRANSITIONS.IN_REVIEW].sort(),
    [STATES.WIP, STATES.RELEASED].sort(),
    'IN_REVIEW -> WIP | RELEASED'
  );
  assert.deepStrictEqual(
    [...TRANSITIONS.RELEASED].sort(),
    [STATES.SUPERSEDED, STATES.OBSOLETE].sort(),
    'RELEASED -> SUPERSEDED | OBSOLETE only'
  );
  assert.deepStrictEqual([...TRANSITIONS.SUPERSEDED], [STATES.OBSOLETE]);
  assert.deepStrictEqual([...TRANSITIONS.OBSOLETE], []);
  for (const [from, to] of Object.entries(TRANSITIONS)) {
    for (const target of to) {
      const backward = STATE_RANK[target] < STATE_RANK[from];
      assert.ok(
        !backward || (from === STATES.IN_REVIEW && target === STATES.WIP),
        `only IN_REVIEW->WIP may go backward; ${from} -> ${target} is backward`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 1. Full legal lifecycle transitions + illegal transitions rejected
// ---------------------------------------------------------------------------
(function () {
  const life = new PDMRevisionLifecycle();
  life.createItem({ partNumber: 'P-100', name: 'Bracket', revision: 'A' });

  test('WIP -> IN_REVIEW is legal', () => {
    life.submitForReview('P-100');
    assert.strictEqual(life.getItem('P-100').status, STATES.IN_REVIEW);
  });

  test('IN_REVIEW -> WIP (return) is legal', () => {
    life.returnToWIP('P-100');
    assert.strictEqual(life.getItem('P-100').status, STATES.WIP);
  });

  test('WIP -> RELEASED without review is rejected', () => {
    assert.throws(() => life.release('P-100'), /illegal transition WIP -> RELEASED/);
    assert.throws(() => life.transition('P-100', STATES.RELEASED), /illegal transition/);
  });

  test('WIP -> SUPERSEDED / OBSOLETE rejected', () => {
    assert.throws(() => life.transition('P-100', STATES.SUPERSEDED), /illegal transition/);
    assert.throws(() => life.transition('P-100', STATES.OBSOLETE), /illegal transition/);
  });

  test('IN_REVIEW -> RELEASED is legal', () => {
    life.submitForReview('P-100');
    life.release('P-100');
    assert.strictEqual(life.getItem('P-100').status, STATES.RELEASED);
  });

  test('RELEASED -> WIP / IN_REVIEW rejected (no backward transitions)', () => {
    assert.throws(() => life.returnToWIP('P-100'), /illegal transition/);
    assert.throws(() => life.release('P-100'), /illegal transition/);
    assert.throws(() => life.transition('P-100', STATES.IN_REVIEW), /illegal transition/);
  });

  test('RELEASED -> SUPERSEDED is legal', () => {
    life.supersede('P-100');
    assert.strictEqual(life.getItem('P-100').status, STATES.SUPERSEDED);
  });

  test('SUPERSEDED -> OBSOLETE is legal', () => {
    life.obsolete('P-100');
    assert.strictEqual(life.getItem('P-100').status, STATES.OBSOLETE);
  });

  test('OBSOLETE is terminal; RELEASED -> OBSOLETE is legal elsewhere', () => {
    for (const s of Object.values(STATES)) {
      if (s === STATES.OBSOLETE) continue;
      assert.throws(() => life.transition('P-100', s), /illegal transition/);
    }
    const life2 = new PDMRevisionLifecycle();
    life2.createItem({ partNumber: 'P-101', name: 'Direct obsolete' });
    life2.submitForReview('P-101');
    life2.release('P-101');
    life2.obsolete('P-101');
    assert.strictEqual(life2.getItem('P-101').status, STATES.OBSOLETE);
  });
})();

// ---------------------------------------------------------------------------
// 2. ECO approve-then-release path and reject path
// ---------------------------------------------------------------------------
(function () {
  test('ECO approve-then-release applies revision and seals chain', () => {
    const life = new PDMRevisionLifecycle();
    life.createItem({ partNumber: 'SHAFT-01', name: 'Shaft', revision: 'A' });
    const eco = life.createECO({ id: 'ECO-101', title: 'Shaft rev B' });

    assert.strictEqual(eco.status, 'OPEN');
    life.attachItemRevision('ECO-101', 'SHAFT-01', { toRevision: 'B' });
    assert.strictEqual(life.getItem('SHAFT-01').status, STATES.IN_REVIEW);

    const approved = life.approveECO('ECO-101', 'alice');
    assert.strictEqual(approved.status, 'APPROVED');

    const applied = life.applyECO('ECO-101');
    assert.strictEqual(applied.status, 'APPLIED');

    const item = life.getItem('SHAFT-01');
    assert.strictEqual(item.status, STATES.RELEASED);
    assert.strictEqual(item.revision, 'B');
    assert.match(item.seal, /^[0-9a-f]{64}$/);

    const history = life.getHistory('SHAFT-01');
    assert.strictEqual(history.length, 3);
    assert.strictEqual(history[0].prevSeal, ZERO_SEAL);
    assert.strictEqual(history[1].prevSeal, history[0].seal);
    assert.strictEqual(history[2].prevSeal, history[1].seal);
  });

  test('applying a non-APPROVED or already-applied ECO is rejected', () => {
    const life = new PDMRevisionLifecycle();
    life.createItem({ partNumber: 'S-02', name: 'Part' });
    const eco = life.createECO({ id: 'ECO-102' });
    life.attachItemRevision('ECO-102', 'S-02', { toRevision: 'B' });
    assert.throws(() => life.applyECO('ECO-102'), /must be APPROVED/);
    life.approveECO('ECO-102');
    life.applyECO('ECO-102');
    assert.throws(() => life.applyECO('ECO-102'), /must be APPROVED/);
  });

  test('ECO reject path returns item to WIP', () => {
    const life = new PDMRevisionLifecycle();
    life.createItem({ partNumber: 'GEAR-02', name: 'Gear', revision: 'A' });
    const eco = life.createECO({ id: 'ECO-103' });
    life.attachItemRevision('ECO-103', 'GEAR-02', { toRevision: 'B' });
    assert.strictEqual(life.getItem('GEAR-02').status, STATES.IN_REVIEW);

    const rejected = life.rejectECO('ECO-103', 'bob', 'geometry mismatch');
    assert.strictEqual(rejected.status, 'REJECTED');
    assert.strictEqual(rejected.approvals[0].decision, 'REJECTED');
    assert.strictEqual(life.getItem('GEAR-02').status, STATES.WIP);
    assert.throws(() => life.applyECO('ECO-103'), /must be APPROVED/);
  });

  test('ECO guards: unknown ECO, unknown part, duplicate attach, bad revision, released freeze', () => {
    const life = new PDMRevisionLifecycle();
    life.createItem({ partNumber: 'X-1', name: 'X' });
    life.createItem({ partNumber: 'X-2', name: 'X2' });
    const eco = life.createECO({ id: 'ECO-104' });
    assert.strictEqual(eco.id, 'ECO-104');
    assert.throws(() => life.attachItemRevision('ECO-nope', 'X-1', { toRevision: 'B' }), /unknown ECO/);
    assert.throws(() => life.attachItemRevision('ECO-104', 'NO-SUCH-PART', { toRevision: 'B' }), /unknown part/);
    assert.throws(() => life.attachItemRevision('ECO-104', 'X-1', { toRevision: 'A' }), /must differ/);
    life.attachItemRevision('ECO-104', 'X-1', { toRevision: 'B' });
    assert.throws(
      () => life.attachItemRevision('ECO-104', 'X-1', { toRevision: 'C' }),
      /only WIP items|already attached/
    );
    const eco2 = life.createECO({ id: 'ECO-105' });
    assert.throws(
      () => life.attachItemRevision('ECO-105', 'X-1', { toRevision: 'C' }),
      /only WIP items|already attached/
    );

    const life2 = new PDMRevisionLifecycle();
    life2.createItem({ partNumber: 'Y-1', name: 'Y' });
    const eco3 = life2.createECO({ id: 'ECO-106' });
    life2.attachItemRevision('ECO-106', 'Y-1', { toRevision: 'B' });
    life2.approveECO('ECO-106');
    life2.applyECO('ECO-106');
    const eco4 = life2.createECO({ id: 'ECO-107' });
    assert.throws(() => life2.attachItemRevision('ECO-107', 'Y-1', { toRevision: 'C' }), /RELEASED/);
    const eco5 = life2.createECO({ id: 'ECO-108' });
    assert.throws(() => life2.approveECO('ECO-108'), /no attached items/);
    assert.strictEqual(eco2.id, 'ECO-105');
    assert.strictEqual(eco3.id, 'ECO-106');
    assert.strictEqual(eco4.id, 'ECO-107');
  });
})();

// ---------------------------------------------------------------------------
// 3. Assembly revision propagation: effective BOM snapshot + released freeze
// ---------------------------------------------------------------------------
(function () {
  const life = new PDMRevisionLifecycle();
  life.createItem({ partNumber: 'BOLT-1', name: 'Bolt', revision: 'C1' });
  life.createItem({ partNumber: 'NUT-1', name: 'Nut', revision: 'C1' });
  life.createItem({
    partNumber: 'ASM-1',
    name: 'Fastener Assembly',
    revision: 'A',
    children: [
      { partNumber: 'BOLT-1', quantity: 4 },
      { partNumber: 'NUT-1', quantity: 4 }
    ]
  });

  const ecoAsm = life.createECO({ id: 'ECO-201' });
  life.attachItemRevision('ECO-201', 'ASM-1', { toRevision: 'B' });
  life.approveECO('ECO-201');
  life.applyECO('ECO-201');

  test('released assembly records recursive effective BOM snapshot', () => {
    const asm = life.getItem('ASM-1');
    assert.strictEqual(asm.status, STATES.RELEASED);
    assert.strictEqual(asm.revision, 'B');
    assert.ok(Array.isArray(asm.bomSnapshot) && asm.bomSnapshot.length === 2);
    const bolt = asm.bomSnapshot.find((s) => s.partNumber === 'BOLT-1');
    assert.strictEqual(bolt.quantity, 4);
    assert.strictEqual(bolt.revision, 'C1');
    assert.strictEqual(bolt.status, STATES.WIP);
    assert.match(bolt.seal, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(bolt.children, []);
  });

  test('modification of a released assembly is rejected', () => {
    const ecoMod = life.createECO({ id: 'ECO-202' });
    assert.strictEqual(ecoMod.status, 'OPEN');
    assert.throws(() => life.attachItemRevision('ECO-202', 'ASM-1', { toRevision: 'C' }), /RELEASED/);
  });

  test('releasing a component does not retroactively alter released assembly', () => {
    const ecoBolt = life.createECO({ id: 'ECO-203' });
    life.attachItemRevision('ECO-203', 'BOLT-1', { toRevision: 'C2' });
    life.approveECO('ECO-203');
    life.applyECO('ECO-203');
    assert.strictEqual(life.getItem('BOLT-1').revision, 'C2');
    assert.strictEqual(life.getItem('BOLT-1').status, STATES.RELEASED);
    const snapshot = life.getBOMSnapshot('ASM-1');
    assert.strictEqual(snapshot.find((s) => s.partNumber === 'BOLT-1').revision, 'C1');
  });

  test('detectTamper flags tampered BOM snapshot inside released assembly', () => {
    const raw = life.getRawRecord('ASM-1');
    raw.bomSnapshot[0].revision = 'XX';
    const detected = life.detectTamper();
    assert.strictEqual(detected.tampered, true);
    assert.ok(detected.tamperedRecords.includes('ASM-1'));
  });
})();

// ---------------------------------------------------------------------------
// 4. Cryptographic chain verification + tamper detection
// ---------------------------------------------------------------------------
(function () {
  const life = new PDMRevisionLifecycle();
  life.createItem({ partNumber: 'CH-1', name: 'Chain Part', revision: 'A' });
  life.createItem({ partNumber: 'CH-2', name: 'Chain Part 2', revision: 'A' });
  life.createItem({
    partNumber: 'CH-ASM',
    name: 'Chain Assembly',
    revision: 'A',
    children: [
      { partNumber: 'CH-1', quantity: 2 },
      { partNumber: 'CH-2', quantity: 1 }
    ]
  });
  const eco = life.createECO({ id: 'ECO-301' });
  life.attachItemRevision('ECO-301', 'CH-1', { toRevision: 'B' });
  life.attachItemRevision('ECO-301', 'CH-ASM', { toRevision: 'B' });
  life.approveECO('ECO-301');
  life.applyECO('ECO-301');

  test('verifyChain passes on intact records', () => {
    const result = life.verifyChain();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.error, null);
    assert.ok(result.entriesCount >= 5, 'all sealed versions were checked');
    const history = life.getHistory('CH-1');
    assert.strictEqual(history.length, 3);
    assert.strictEqual(history[0].prevSeal, ZERO_SEAL);
    assert.strictEqual(history[1].prevSeal, history[0].seal);
    assert.strictEqual(history[2].prevSeal, history[1].seal);
    assert.notStrictEqual(history[1].seal, history[0].seal);
    assert.notStrictEqual(history[2].seal, history[1].seal);
    assert.strictEqual(life.detectTamper().tampered, false);
  });

  test('detectTamper flags single-byte tampering of a stored record', () => {
    const raw = life.getRawRecord('CH-2');
    const original = raw.name;
    raw.name = original.slice(0, -1) + (original.endsWith('2') ? 'X' : 'Y');
    assert.notStrictEqual(raw.name, original, 'name must be mutated by one byte');
    const detected = life.detectTamper();
    assert.strictEqual(detected.tampered, true);
    assert.ok(detected.tamperedRecords.includes('CH-2'), 'tampered part must be named');
    const result = life.verifyChain();
    assert.strictEqual(result.valid, false);
    assert.match(result.error, /seal mismatch/);
  });

  test('detectTamper flags tampered seal field and descends from valid sibling', () => {
    const raw = life.getRawRecord('CH-1');
    raw.seal = 'f'.repeat(64);
    const detected = life.detectTamper();
    assert.strictEqual(detected.tampered, true);
    assert.ok(detected.tamperedRecords.includes('CH-1'));
    const siblingChain = life.verifyChain();
    assert.strictEqual(siblingChain.valid, false);
  });
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
