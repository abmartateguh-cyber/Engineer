/**
 * Verification gate for the AES-256-GCM envelope-encrypted project vault
 * (src/core/security/vault_encryption.js).
 *
 * Covers: round-trips, tamper detection (ciphertext/tag/IV), key rotation with
 * legacy-entry retention, wrong passphrase rejection, non-determinism (fresh
 * IV), and a 500 MiB performance smoke.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectVault } = require('../src/core/security/vault_encryption');

const PASSPHRASE = 'correct horse battery staple';

function flipByte(buffer, index) {
  const copy = Buffer.from(buffer);
  copy[index % copy.length] ^= 0xff;
  return copy;
}

test('round-trip: 1 MiB buffer returns original bytes exactly', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const payload = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < payload.length; i += 4096) {
    payload.writeUInt32LE(i, i);
  }
  const envelope = vault.seal(payload);
  const opened = vault.open(envelope);
  assert.deepStrictEqual(opened, payload);
  assert.strictEqual(envelope.version, 'v1');
  assert.ok(Buffer.isBuffer(envelope.ciphertext));
  assert.ok(Buffer.isBuffer(envelope.tag));
  assert.ok(Buffer.isBuffer(envelope.iv));
  assert.ok(Buffer.isBuffer(envelope.salt));
  assert.ok(Buffer.isBuffer(envelope.wrappedKey.data));
  assert.ok(envelope.ciphertext.length >= payload.length);
});

test('round-trip: small JSON object serializes and opens to same bytes', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const project = {
    id: 'turbine-7',
    rev: 7,
    owner: 'dr_smith',
    payload: { pressureMPa: 24.1, tempK: 833.15 }
  };
  const payload = Buffer.from(JSON.stringify(project), 'utf8');
  const opened = vault.open(vault.seal(payload));
  assert.deepStrictEqual(opened, payload);
  assert.deepStrictEqual(JSON.parse(opened.toString('utf8')), project);
});

test('tamper detection: flipping one ciphertext byte fails authentication', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const payload = Buffer.from('do not touch me', 'utf8');
  const envelope = vault.seal(payload);
  const tampered = {
    ...envelope,
    ciphertext: flipByte(envelope.ciphertext, 0)
  };
  assert.throws(() => vault.open(tampered), /authenticate/);
});

test('tamper detection: flipping one tag byte fails authentication', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const envelope = vault.seal(Buffer.from('authenticated payload', 'utf8'));
  const tampered = {
    ...envelope,
    tag: flipByte(envelope.tag, 0)
  };
  assert.throws(() => vault.open(tampered), /authenticate/);
});

test('tamper detection: altering IV fails authentication', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const envelope = vault.seal(Buffer.from('iv must be authenticated', 'utf8'));
  const tampered = {
    ...envelope,
    iv: flipByte(envelope.iv, 0)
  };
  assert.throws(() => vault.open(tampered), /authenticate/);
});

test('key rotation: new entries use new key; legacy entries keep authenticating', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const payload = Buffer.from(JSON.stringify({ project: 'steam-turbine', rev: 3 }), 'utf8');
  const legacyPayload = Buffer.from('legacy entry, never re-sealed', 'utf8');

  const legacy = vault.seal(legacyPayload);
  const original = vault.seal(payload);
  const firstKeyId = vault.currentKeyIdValue();

  const rotated = vault.rotate([original]);
  const newKeyId = vault.currentKeyIdValue();
  assert.notStrictEqual(newKeyId, firstKeyId);

  const reSealed = rotated[0];
  assert.strictEqual(reSealed.keyId, newKeyId);
  assert.notStrictEqual(reSealed.ciphertext.toString('hex'), original.ciphertext.toString('hex'));

  const freshlySealed = vault.seal(payload);
  assert.strictEqual(freshlySealed.keyId, newKeyId);

  assert.deepStrictEqual(vault.open(reSealed), payload);
  assert.deepStrictEqual(vault.open(freshlySealed), payload);
  assert.deepStrictEqual(vault.open(legacy), legacyPayload);
  assert.deepStrictEqual(vault.open(original), payload);
});

test('key rotation: repeated rotations keep old retained keys working', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const payload = Buffer.from('rotation stress', 'utf8');
  const envelopes = [vault.seal(payload), vault.seal(payload)];
  const first = envelopes[0];
  const second = envelopes[1];

  for (let i = 0; i < 12; i += 1) {
    const rotated = vault.rotate(envelopes);
    envelopes.length = 0;
    envelopes.push(...rotated);
  }

  assert.deepStrictEqual(vault.open(first), payload);
  assert.deepStrictEqual(vault.open(second), payload);
  for (const envelope of envelopes) {
    assert.deepStrictEqual(vault.open(envelope), payload);
  }
});

test('wrong passphrase: open fails', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const sealed = vault.seal(Buffer.from('class: project data', 'utf8'));
  const wrongVault = new ProjectVault({ passphrase: 'wrong passphrase' });
  assert.throws(() => wrongVault.open(sealed), /authenticate|GCM|decrypt/i);
});

test('determinism: same payload+passphrase yields different ciphertexts; both open', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const payload = Buffer.from('same bytes, fresh IV', 'utf8');
  const first = vault.seal(payload);
  const second = vault.seal(payload);

  assert.notStrictEqual(first.ciphertext.toString('hex'), second.ciphertext.toString('hex'));
  assert.notStrictEqual(first.iv.toString('hex'), second.iv.toString('hex'));
  assert.deepStrictEqual(vault.open(first), payload);
  assert.deepStrictEqual(vault.open(second), payload);
});

test('performance smoke: 500 MiB seal/open within 60 s', () => {
  const vault = new ProjectVault({ passphrase: PASSPHRASE });
  const SIZE = 500 * 1024 * 1024;
  const payload = Buffer.alloc(SIZE, 0x5a);

  const t0 = process.hrtime.bigint();
  const envelope = vault.seal(payload);
  const t1 = process.hrtime.bigint();
  const opened = vault.open(envelope);
  const t2 = process.hrtime.bigint();

  const sealSec = Number(t1 - t0) / 1e9;
  const openSec = Number(t2 - t1) / 1e9;
  const totalSec = Number(t2 - t0) / 1e9;
  const mib = SIZE / (1024 * 1024);

  assert.deepStrictEqual(opened, payload);
  assert.ok(totalSec < 60, `seal+open took ${totalSec.toFixed(2)}s (>= 60s)`);
  console.log(
    `  [perf] seal=${(mib / sealSec).toFixed(1)} MiB/s, ` +
      `open=${(mib / openSec).toFixed(1)} MiB/s, ` +
      `combined=${((2 * mib) / totalSec).toFixed(1)} MiB/s (total ${totalSec.toFixed(2)}s)`
  );
});
