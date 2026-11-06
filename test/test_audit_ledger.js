'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  canonicalize,
  generateKeyPair,
  SoftwareSigningAuthority,
  SignedLedger,
  DEFAULT_HASH_ALGORITHM,
  GENESIS_HASH
} = require('../src/core/security/record_signing');

const HASH_ALG = 'sha384';
const N_RECORDS = 15;

function sha384Hex(bytes) {
  return crypto.createHash(HASH_ALG).update(bytes).digest('hex');
}

function makeRevisionRecords(n) {
  const records = [];
  for (let i = 0; i < n; i++) {
    records.push({
      recordType: 'DRAWING_REVISION',
      id: `DRG-2026-${String(i + 1).padStart(4, '0')}`,
      author: `engineer_${(i % 5) + 1}`,
      timestamp: `2026-11-0${(i % 9) + 1}T10:${String(15 + (i % 30)).padStart(2, '0')}:00.000Z`,
      revision: i + 1,
      geometryDigest: sha384Hex(`geometry-v${i + 1}-${i * 7 + 3}`),
      changeNote:
        i % 3 === 0 ? 'overall dimension update' : i % 3 === 1 ? 'hole pattern revision' : 'surface finish note'
    });
  }
  return records;
}

function recomputeSeal(entry) {
  const material = canonicalize({
    sequenceNumber: entry.sequenceNumber,
    prevHash: entry.prevHash,
    signedPayloadHash: entry.signedPayloadHash,
    signature: entry.signature,
    signatureAlg: entry.signatureAlg,
    signedAt: entry.signedAt,
    signerLabel: entry.signerLabel
  });
  return sha384Hex(Buffer.from(material, 'utf8'));
}

function flipHexByteBit(hexStr, byteIndex, bitIndex) {
  const buf = Buffer.from(hexStr, 'hex');
  buf[byteIndex] ^= 1 << bitIndex;
  return buf.toString('hex');
}

function flipBase64Char(str, charIndex) {
  const chars = Array.from(str);
  chars[charIndex] = chars[charIndex] === 'A' ? 'B' : 'A';
  return chars.join('');
}

const DETERMINISTIC_KEY_PAIR = generateKeyPair();

class DeterministicAuthority {
  constructor() {
    this.publicKeyPem = DETERMINISTIC_KEY_PAIR.publicKeyPem;
    this.privateKeyPem = DETERMINISTIC_KEY_PAIR.privateKeyPem;
    this.signatureAlg = DETERMINISTIC_KEY_PAIR.signatureAlg;
    this.label = 'development/software keystore';
    this.fixedSignedAt = '2026-11-05T00:00:00.000Z';
    this.fixedSignature = Buffer.alloc(96, 7).toString('base64');
  }

  signRecord(record) {
    const canonicalBytes = Buffer.from(canonicalize(record), 'utf8');
    return {
      signature: this.fixedSignature,
      signatureAlg: this.signatureAlg,
      signedPayloadHash: sha384Hex(canonicalBytes),
      signedAt: this.fixedSignedAt
    };
  }

  verifyRecord() {
    return { valid: true, reason: null, signedPayloadHash: null };
  }
}

function buildLedger(records, Authority = SoftwareSigningAuthority) {
  const authority = new Authority();
  const ledger = new SignedLedger(authority);
  for (const record of records) {
    ledger.append(record);
  }
  return { authority, ledger, entries: ledger.getEntries() };
}

const records = makeRevisionRecords(N_RECORDS);

test('hash algorithm is SHA-384 with a 384-bit genesis seal', () => {
  assert.equal(DEFAULT_HASH_ALGORITHM, HASH_ALG);
  assert.equal(GENESIS_HASH.length, 96, 'genesis hash must be 96 hex chars = 384 bits');
});

test(`chain of N=${N_RECORDS} drawing revision records builds a valid SHA-384 hash chain`, () => {
  const { ledger, entries } = buildLedger(records);
  assert.equal(entries.length, N_RECORDS);
  assert.equal(ledger.latestChainHash, entries[entries.length - 1].chainHash);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    assert.equal(entry.sequenceNumber, i + 1);
    assert.equal(entry.signatureAlg, 'ECDSA-P384-SHA384');
    if (i === 0) {
      assert.equal(entry.prevHash, GENESIS_HASH);
    } else {
      assert.equal(entry.prevHash, entries[i - 1].chainHash, `link at ${i} must point at predecessor seal`);
    }
    assert.equal(
      recomputeSeal(entry),
      entry.chainHash,
      `seal at entry ${i} must equal hash(prevSeal + canonical fields)`
    );
    assert.equal(entry.chainHash.length, 96);
  }
});

test('intact chain re-verification passes 100% (10/10 runs)', () => {
  const { ledger } = buildLedger(records);
  for (let run = 0; run < 10; run++) {
    const result = ledger.verifyChain();
    assert.equal(result.valid, true, `run ${run}: intact chain must verify`);
    assert.equal(result.entriesCount, N_RECORDS);
    assert.equal(result.algorithm, 'ECDSA-P384-SHA384');
    assert.equal(result.latestChainHash, ledger.latestChainHash);
  }
});

test('determinism: identical chains produce identical seals when signed fields are identical', () => {
  const a = buildLedger(records, DeterministicAuthority);
  const b = buildLedger(records, DeterministicAuthority);
  assert.equal(a.entries.length, b.entries.length);
  for (let i = 0; i < a.entries.length; i++) {
    assert.deepEqual(a.entries[i], b.entries[i], `entry ${i} must be byte-identical`);
  }
  assert.equal(a.ledger.latestChainHash, b.ledger.latestChainHash);
});

test('determinism: canonical payload hash is identical across independent ledgers; linkage identical', () => {
  const a = buildLedger(records);
  const b = buildLedger(records);
  for (let i = 0; i < N_RECORDS; i++) {
    assert.equal(a.entries[i].signedPayloadHash, b.entries[i].signedPayloadHash);
    const expectedPrevA = i === 0 ? GENESIS_HASH : a.entries[i - 1].chainHash;
    const expectedPrevB = i === 0 ? GENESIS_HASH : b.entries[i - 1].chainHash;
    assert.equal(a.entries[i].prevHash, expectedPrevA);
    assert.equal(b.entries[i].prevHash, expectedPrevB);
  }
  assert.notEqual(
    a.entries[3].signature,
    b.entries[3].signature,
    'live ECDSA P-384 signatures are randomized per signing'
  );
});

test('tamper detection: flipping ONE BIT in an interior record payload fails and identifies index 7 exactly', () => {
  const { entries, ledger } = buildLedger(records);
  const tampered = structuredClone(entries);
  const original = tampered[7].record.geometryDigest;
  tampered[7].record.geometryDigest = flipHexByteBit(original, 2, 5);
  assert.notEqual(tampered[7].record.geometryDigest, original);

  const result = ledger.verifyChain({ entries: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.firstFailureIndex, 7);
  assert.match(result.error, /signedPayloadHash mismatch/);
});

test('tamper detection: flipping ONE BYTE in an interior record signature fails at index 9 exactly', () => {
  const { entries, ledger } = buildLedger(records);
  const tampered = structuredClone(entries);
  tampered[9].signature = flipBase64Char(tampered[9].signature, 20);

  const result = ledger.verifyChain({ entries: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.firstFailureIndex, 9);
  assert.match(result.error, /Detached signature invalid/);
});

test('tamper detection: flipping ONE BIT in an interior chain seal fails at index 11 exactly', () => {
  const { entries, ledger } = buildLedger(records);
  const tampered = structuredClone(entries);
  tampered[11].chainHash = flipHexByteBit(tampered[11].chainHash, 10, 0);

  const result = ledger.verifyChain({ entries: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.firstFailureIndex, 11);
  assert.match(result.error, /chainHash mismatch/);
});

test('tamper detection: flipping ONE BIT in the head (last) record payload fails at index 14 exactly', () => {
  const { entries, ledger } = buildLedger(records);
  const tampered = structuredClone(entries);
  tampered[14].record.geometryDigest = flipHexByteBit(tampered[14].record.geometryDigest, 0, 0);

  const result = ledger.verifyChain({ entries: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.firstFailureIndex, 14);
});

test('missing record (hole -> null) fails closed at the missing index', () => {
  const { entries, ledger } = buildLedger(records);
  const tampered = structuredClone(entries);
  tampered[4] = null;

  const result = ledger.verifyChain({ entries: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.firstFailureIndex, 4);
  assert.match(result.error, /not an object/);
});

test('unknown/malformed record shape fails closed at that index', () => {
  const { entries, ledger } = buildLedger(records);
  const tampered = structuredClone(entries);
  tampered[4] = { foo: 'bar' };

  const result = ledger.verifyChain({ entries: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.firstFailureIndex, 4);
});

test('broken chain link (prevHash tamper) fails exactly at the broken entry', () => {
  const { entries, ledger } = buildLedger(records);
  const tampered = structuredClone(entries);
  tampered[6].prevHash = GENESIS_HASH;

  const result = ledger.verifyChain({ entries: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.firstFailureIndex, 6);
  assert.match(result.error, /Broken hash-chain link/);
});

test('documented behavior: empty entry array verifies with 0 entries (no records to tamper)', () => {
  const { ledger } = buildLedger(records);
  const result = ledger.verifyChain({ entries: [] });
  assert.equal(result.valid, true);
  assert.equal(result.entriesCount, 0);
});
