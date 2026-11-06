'use strict';

const assert = require('assert');
const { HILTelemetryEngine } = require('../src/core/dynamic_simulink/hil_telemetry');

function runHilTelemetryContractTests() {
  const checks = [];
  function check(name, fn) {
    checks.push({ name, fn });
  }

  check('frame pack/unpack round-trip', () => {
    const frame = HILTelemetryEngine.packFrame(42, 1234.5, new Float64Array([1.25, -2.5]));
    const decoded = HILTelemetryEngine.unpackFrame(frame);
    assert.strictEqual(decoded.seqId, 42);
    assert.strictEqual(decoded.timestampUs, 1234.5);
    assert.deepStrictEqual(decoded.states, [1.25, -2.5]);
    assert.strictEqual(decoded.crcValid, true);
    assert.throws(() => HILTelemetryEngine.packFrame(-1, 1, [1]), /uint32/);
    assert.throws(() => HILTelemetryEngine.packFrame(1, -1, [1]), /Timestamp/);
    assert.throws(() => HILTelemetryEngine.packFrame(1, 1, [NaN]), /finite values/);
  });

  check('corrupt frame rejection', () => {
    const frame = HILTelemetryEngine.packFrame(42, 1234.5, new Float64Array([1.25, -2.5]));
    const corrupted = Uint8Array.from(frame);
    corrupted[16] ^= 1;
    assert.throws(() => HILTelemetryEngine.unpackFrame(corrupted), /CRC mismatch/);
    assert.throws(() => HILTelemetryEngine.unpackFrame(frame.subarray(0, frame.length - 1)), /length/);
    assert.throws(() => HILTelemetryEngine.unpackFrame(new Uint8Array(4)), /at least 20 bytes/);
    const forgedNonfinite = Uint8Array.from(frame);
    const view = new DataView(forgedNonfinite.buffer);
    view.setFloat64(16, NaN, false);
    view.setUint32(
      forgedNonfinite.length - 4,
      HILTelemetryEngine.calculateCrc32(forgedNonfinite.subarray(0, -4)),
      false
    );
    assert.throws(() => HILTelemetryEngine.unpackFrame(forgedNonfinite), /non-finite/);
  });

  check('jitter evaluation contract', () => {
    const timing = HILTelemetryEngine.evaluateJitter([900, 1000, 1250], 1000, 1200);
    assert.strictEqual(timing.meanPeriodUs, 1050);
    assert.strictEqual(timing.deadlineMissesCount, 1);
    assert.strictEqual(timing.p95JitterUs, 250);
    assert.strictEqual(timing.hardRealTimeAssessment, 'not_assessed');
    assert.strictEqual(Object.hasOwn(timing, 'hardRealTimeCompliant'), false);
    assert.throws(() => HILTelemetryEngine.evaluateJitter([], 1000, 1200), /measured period/);
    assert.throws(() => HILTelemetryEngine.evaluateJitter([1000]), /target period and deadline/);
    assert.throws(() => HILTelemetryEngine.evaluateJitter([Infinity], 1000, 1200), /measured period/);
  });

  let passed = 0;
  let failed = 0;
  for (const c of checks) {
    try {
      c.fn();
      passed++;
      console.log(`  ✓ ${c.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ FAIL: ${c.name}`);
      console.error(`    ${err.message}`);
    }
  }

  const total = checks.length;
  console.log(`HIL telemetry contract checks: ${passed}/${total} passed, ${failed} failed`);
  return { total, passed, failed };
}

if (require.main === module) {
  const stats = runHilTelemetryContractTests();
  if (stats.failed > 0) process.exitCode = 1;
}

module.exports = { runHilTelemetryContractTests };
