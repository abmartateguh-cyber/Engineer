'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  canonicalize,
  generateKeyPair,
  signRecord,
  verifyRecord,
  SoftwareSigningAuthority,
  SignedLedger,
  SIGNATURE_ALGORITHMS
} = require('../src/core/security/record_signing');
const { StenographerSupervisor } = require('../src/main/stenographer_supervisor');

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

function sha384Hex(text) {
  return crypto.createHash('sha384').update(text, 'utf8').digest('hex');
}

console.log('================================================================');
console.log('       TESTING REAL RECORD SIGNING & SIGNED LEDGER CHAIN         ');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 1. Canonicalization invariance across key orders + fixed float formatting
// ---------------------------------------------------------------------------
{
  const structuredRecord = () => ({
    toolName: 'fea.solve',
    status: 'COMPLETED',
    metrics: { maxStressPa: 123.456, safetyFactor: 2.5, energyJ: 0.1 + 0.2, exponent: 1e21, negZero: -0 },
    tags: ['structural', 'thermal'],
    nested: { b: [1, 2.5, 'x'], a: { z: 1, y: 'v' } }
  });
  const recordA = structuredRecord();
  const recordB = {
    // Object key insertion order is scrambled; arrays keep their order (arrays are order-sensitive).
    nested: { a: { y: 'v', z: 1 }, b: [1, 2.5, 'x'] },
    tags: ['structural', 'thermal'],
    metrics: { energyJ: 0.30000000000000004, exponent: 1e21, negZero: 0, maxStressPa: 123.456, safetyFactor: 2.5 },
    status: 'COMPLETED',
    toolName: 'fea.solve'
  };

  test('canonicalize is invariant across object key orders (digest equality)', () => {
    const cA = canonicalize(recordA);
    const cB = canonicalize(recordB);
    assert.strictEqual(cA, cB);
    assert.strictEqual(sha384Hex(cA), sha384Hex(cB));
  });

  test('canonicalize emits deterministic fixed float formatting', () => {
    assert.strictEqual(canonicalize({ a: 1, b: 'x' }), '{"a":1,"b":"x"}');
    assert.strictEqual(canonicalize(0.1 + 0.2), '0.30000000000000004');
    assert.strictEqual(canonicalize(1e21), '1e+21');
    assert.strictEqual(canonicalize(-0), '0');
    assert.throws(() => canonicalize(NaN), /non-finite/);
    assert.throws(() => canonicalize(Infinity), /non-finite/);
  });
}

// ---------------------------------------------------------------------------
// 2. Sign / verify round trip (ECDSA P-384 and RSA-4096)
// ---------------------------------------------------------------------------
{
  const record = {
    recordId: 'rec-1',
    toolName: 'robotics.solve_kinematics',
    status: 'STARTED',
    proposalId: 'P-42',
    projectRevision: 7,
    payload: { operation: 'forward_kinematics', jointAnglesRad: [0, 1.57, -0.785] }
  };

  test('ECDSA P-384 sign/verify round trip', () => {
    const { privateKeyPem, publicKeyPem, signatureAlg } = generateKeyPair({
      algorithm: SIGNATURE_ALGORITHMS.ECDSA_P384
    });
    const sig = signRecord(record, privateKeyPem, { algorithm: signatureAlg });
    assert.strictEqual(sig.signatureAlg, SIGNATURE_ALGORITHMS.ECDSA_P384);
    assert.ok(sig.signature.length > 0);
    assert.ok(Number.isNaN(Date.parse(sig.signedAt)) === false);
    assert.strictEqual(sig.signedPayloadHash, sha384Hex(canonicalize(record)));
    const v = verifyRecord(record, sig.signature, publicKeyPem);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.reason, null);
  });

  test('RSA-4096 sign/verify round trip', () => {
    const { privateKeyPem, publicKeyPem, signatureAlg } = generateKeyPair({
      algorithm: SIGNATURE_ALGORITHMS.RSA4096
    });
    const sig = signRecord(record, privateKeyPem, { algorithm: signatureAlg });
    assert.strictEqual(sig.signatureAlg, SIGNATURE_ALGORITHMS.RSA4096);
    const v = verifyRecord(record, sig.signature, publicKeyPem);
    assert.strictEqual(v.valid, true);
  });
}

// ---------------------------------------------------------------------------
// 3. Tamper detection: flip one byte in record or signature
// ---------------------------------------------------------------------------
{
  const authority = new SoftwareSigningAuthority();
  const record = { recordId: 'rec-2', value: 123.456, meta: { createdAt: '2026-01-01T00:00:00Z' } };
  const sig = authority.signRecord(record);

  test('tampered record (flipped byte) fails verification with detail', () => {
    const tampered = { ...record, recordId: 'rec-3' };
    const v = verifyRecord(tampered, sig.signature, authority.publicKeyPem);
    assert.strictEqual(v.valid, false);
    assert.ok(typeof v.reason === 'string' && v.reason.length > 0, 'must carry detached-failure detail');
  });

  test('tampered signature bytes fail verification', () => {
    const flipped = Buffer.from(sig.signature, 'base64');
    flipped[0] ^= 0x01;
    const v = verifyRecord(record, flipped.toString('base64'), authority.publicKeyPem);
    assert.strictEqual(v.valid, false);
  });

  test('tampered nested value fails verification', () => {
    const tampered = { ...record, meta: { createdAt: '2026-01-01T00:00:01Z' } };
    assert.strictEqual(verifyRecord(tampered, sig.signature, authority.publicKeyPem).valid, false);
  });
}

// ---------------------------------------------------------------------------
// 4. Signed ledger chain: append 5 records, verify chain integrity
// ---------------------------------------------------------------------------
{
  const authority = new SoftwareSigningAuthority();
  const ledger = new SignedLedger(authority);

  test('append 5 records builds a verifiable signed hash chain', () => {
    for (let i = 1; i <= 5; i++) {
      ledger.append({ tool: 'sim', step: i, ts: `2026-11-0${i}T00:00:00Z` });
    }
    assert.strictEqual(ledger.entries.length, 5);
    const integrity = ledger.verifyChain();
    assert.strictEqual(integrity.valid, true);
    assert.strictEqual(integrity.entriesCount, 5);
    assert.strictEqual(integrity.latestChainHash, ledger.entries[4].chainHash);
    for (let i = 0; i < 5; i++) {
      const e = ledger.entries[i];
      assert.strictEqual(e.sequenceNumber, i + 1);
      assert.ok(e.signature && e.signedPayloadHash && e.chainHash);
      assert.strictEqual(e.signedPayloadHash, sha384Hex(canonicalize(e.record)));
    }
    assert.strictEqual(ledger.entries[1].prevHash, ledger.entries[0].chainHash);
    assert.strictEqual(ledger.entries[0].prevHash, '0'.repeat(96));
  });

  test('reordered chain fails verification', () => {
    const reordered = [ledger.entries[1], ledger.entries[0], ...ledger.entries.slice(2)];
    const integrity = ledger.verifyChain({ entries: reordered });
    assert.strictEqual(integrity.valid, false);
    assert.ok(integrity.error, 'must report chain failure detail');
  });

  test('removed entry fails verification', () => {
    const removed = ledger.entries.slice(1);
    const integrity = ledger.verifyChain({ entries: removed });
    assert.strictEqual(integrity.valid, false);
  });

  test('tampered record inside chain fails verification', () => {
    const mutated = ledger.getEntries();
    mutated[2] = { ...mutated[2], record: { ...mutated[2].record, step: 999 } };
    const integrity = ledger.verifyChain({ entries: mutated });
    assert.strictEqual(integrity.valid, false);
    assert.match(integrity.error, /signedPayloadHash mismatch/);
  });
}

// ---------------------------------------------------------------------------
// 5. Determinism: canonical digest equality + verification stability
// ---------------------------------------------------------------------------
{
  const authority = new SoftwareSigningAuthority();
  const record = { recordId: 'rec-det', tool: 'cad.mutate', value: 5.25 };

  test('same record+key yields equal canonical digests and both signatures verify', () => {
    const sig1 = authority.signRecord(record);
    const sig2 = authority.signRecord(record);
    assert.strictEqual(sig1.signedPayloadHash, sig2.signedPayloadHash);
    assert.strictEqual(sig1.signedPayloadHash, sha384Hex(canonicalize(record)));
    assert.strictEqual(verifyRecord(record, sig1.signature, authority.publicKeyPem).valid, true);
    assert.strictEqual(verifyRecord(record, sig2.signature, authority.publicKeyPem).valid, true);
    assert.notStrictEqual(sig1.signature, sig2.signature, 'ECDSA is randomized; signatures differ');
  });
}

// ---------------------------------------------------------------------------
// 6. Integration: supervisor signs TOOL_STARTED / TOOL_RESULT records
// ---------------------------------------------------------------------------
{
  const supervisor = new StenographerSupervisor({ mockMode: true, enableSoftwareSigning: true });
  supervisor.registerTool(
    new (require('../src/core/contracts/ToolDefinition').ToolDefinition)({
      name: 'test.sign_sim',
      description: 'Signing integration fixture',
      approvalClass: require('../src/core/contracts/ToolDefinition').ToolApprovalClass.COMPUTE_JOB,
      classification: require('../src/core/contracts/ToolDefinition').ToolApprovalClass.COMPUTE_JOB,
      modifiesState: false
    })
  );

  test('supervisor signs TOOL_STARTED/TOOL_RESULT with the software authority', async () => {
    await supervisor.connect();
    const proposal = supervisor.proposeToolCall({
      toolName: 'test.sign_sim',
      originatingProjectRevision: 1,
      args: { x: 1 }
    });
    supervisor.evaluateProposal(
      proposal.id,
      require('../src/core/contracts/ApprovalRecord').ApprovalDecision.APPROVED,
      'ok',
      'test_engineer'
    );
    await supervisor.executeTool(proposal.id, async () => ({ converged: true, iterations: 12 }));

    const types = supervisor.getSignedAuditLedger().map((e) => e.record.type);
    assert.ok(types.includes('TOOL_STARTED'), 'TOOL_STARTED must be signed');
    assert.ok(types.includes('TOOL_RESULT'), 'TOOL_RESULT must be signed');

    const signedIntegrity = supervisor.verifySignedLedgerIntegrity();
    assert.strictEqual(signedIntegrity.valid, true);

    const hmacIntegrity = supervisor.verifyLedgerIntegrity();
    assert.strictEqual(hmacIntegrity.valid, true, 'existing HMAC ledger path remains intact');

    const signerInfo = supervisor.signingAuthority.describe();
    assert.strictEqual(signerInfo.label, 'development/software keystore');
    assert.strictEqual(signerInfo.hardwareBacked, false);

    const tampered = supervisor.getSignedAuditLedger();
    tampered[0].record = { ...tampered[0].record, payload: { evil: true } };
    const broken = supervisor.signedLedger.verifyChain({ entries: tampered });
    assert.strictEqual(broken.valid, false, 'signed chain detects supervisor-level tampering');

    await supervisor.disconnect();
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
