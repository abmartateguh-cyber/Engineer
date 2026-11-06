/**
 * Experimental binary telemetry codec and sampled timing diagnostic.
 * No hardware transport, deterministic scheduler, or real-time compliance assessment is provided.
 */

'use strict';

class HILTelemetryEngine {
  /**
   * Packs real-time state telemetry into compact binary ArrayBuffer
   * @param {number} seqId - Monotonic packet sequence counter
   * @param {number} timestampUs - Microsecond timestamp
   * @param {Float64Array} states - Dynamic state values [u, v, w, p, q, r, x, y, z...]
   * @returns {Uint8Array} Packed binary frame
   */
  static packFrame(seqId, timestampUs, states) {
    if (!Number.isSafeInteger(seqId) || seqId < 0 || seqId > 0xffffffff) {
      throw new RangeError('Sequence ID must be a uint32 integer');
    }
    if (!Number.isFinite(timestampUs) || timestampUs < 0) {
      throw new RangeError('Timestamp must be a non-negative finite number of microseconds');
    }
    if (!(states instanceof Float64Array) && !Array.isArray(states)) {
      throw new TypeError('Telemetry states must be a Float64Array or array');
    }
    const numStates = states.length;
    if (numStates > 0xffff || !Array.from(states).every(Number.isFinite)) {
      throw new RangeError('Telemetry states must contain at most 65535 finite values');
    }
    // Header: 2B Magic (0x48, 0x4C = 'HL'), 4B Seq, 8B TimestampUs, 2B NumStates, numStates*8B data, 4B CRC
    const byteLength = 16 + numStates * 8 + 4;
    const buffer = new ArrayBuffer(byteLength);
    const view = new DataView(buffer);

    view.setUint8(0, 0x48); // 'H'
    view.setUint8(1, 0x4c); // 'L'
    view.setUint32(2, seqId, false);
    view.setFloat64(6, timestampUs, false);
    view.setUint16(14, numStates, false);

    let offset = 16;
    for (let i = 0; i < numStates; i++) {
      view.setFloat64(offset, states[i], false);
      offset += 8;
    }

    // Compute full IEEE 802.3 CRC-32 checksum across sync header and state payload
    const payloadBytes = new Uint8Array(buffer, 0, offset);
    const crc32 = HILTelemetryEngine.calculateCrc32(payloadBytes);
    view.setUint32(offset, crc32, false);

    return new Uint8Array(buffer);
  }

  /**
   * Pre-computed IEEE 802.3 32-bit polynomial lookup table (0xEDB88320)
   */
  static get _crcTable() {
    if (!this.__crcTable) {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
      }
      this.__crcTable = table;
    }
    return this.__crcTable;
  }

  /**
   * Calculates IEEE 802.3 standard CRC-32 checksum across a byte buffer
   * @param {Uint8Array} uint8Array
   * @param {number} [length=uint8Array.length]
   * @returns {number} 32-bit unsigned CRC-32
   */
  static calculateCrc32(uint8Array, length = uint8Array.length) {
    const table = this._crcTable;
    let crc = 0xffffffff;
    for (let i = 0; i < length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ uint8Array[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Unpacks received binary frame and verifies integrity
   * @param {Uint8Array} bytes
   * @returns {Object} Unpacked telemetry packet
   */
  static unpackFrame(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20) {
      throw new RangeError('HIL telemetry frame must contain at least 20 bytes');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint8(0) !== 0x48 || view.getUint8(1) !== 0x4c) {
      throw new Error('Invalid HIL telemetry packet magic header');
    }

    const seqId = view.getUint32(2, false);
    const timestampUs = view.getFloat64(6, false);
    const numStates = view.getUint16(14, false);
    if (bytes.byteLength !== 20 + numStates * 8) {
      throw new RangeError('HIL telemetry frame length does not match its state count');
    }

    const crcOffset = 16 + numStates * 8;
    const crc = view.getUint32(crcOffset, false);
    const payloadBytes = new Uint8Array(bytes.buffer, bytes.byteOffset, crcOffset);
    if (crc !== this.calculateCrc32(payloadBytes)) {
      throw new Error('HIL telemetry frame CRC mismatch');
    }
    if (!Number.isFinite(timestampUs) || timestampUs < 0) {
      throw new RangeError('HIL telemetry timestamp is invalid');
    }

    const states = new Float64Array(numStates);
    let offset = 16;
    for (let i = 0; i < numStates; i++) {
      states[i] = view.getFloat64(offset, false);
      if (!Number.isFinite(states[i])) {
        throw new RangeError('HIL telemetry state is non-finite');
      }
      offset += 8;
    }

    return {
      seqId,
      timestampUs,
      numStates,
      states: Array.from(states),
      crc,
      crcValid: true
    };
  }

  /**
   * Calculates sample timing diagnostics from caller-supplied measured periods.
   * @param {number[]} deltaTimesUs
   * @param {number} targetPeriodUs - Caller-declared nominal period
   * @param {number} deadlineUs - Caller-declared deadline
   * @returns {Object} Descriptive sample statistics; no real-time compliance verdict
   */
  static evaluateJitter(deltaTimesUs, targetPeriodUs, deadlineUs) {
    if (
      !Array.isArray(deltaTimesUs) ||
      deltaTimesUs.length === 0 ||
      !deltaTimesUs.every((dt) => Number.isFinite(dt) && dt > 0)
    ) {
      throw new RangeError('At least one positive finite measured period is required');
    }
    if (!Number.isFinite(targetPeriodUs) || targetPeriodUs <= 0 || !Number.isFinite(deadlineUs) || deadlineUs <= 0) {
      throw new RangeError('Positive finite target period and deadline are required');
    }

    let sum = 0.0;
    let sumSqErr = 0.0;
    let deadlineMisses = 0;

    const errors = deltaTimesUs.map((dt) => {
      sum += dt;
      const err = dt - targetPeriodUs;
      sumSqErr += err * err;
      if (dt > deadlineUs) deadlineMisses++;
      return Math.abs(err);
    });

    errors.sort((a, b) => a - b);
    const n = errors.length;
    const p50 = errors[Math.ceil(n * 0.5) - 1];
    const p95 = errors[Math.ceil(n * 0.95) - 1];
    const p99 = errors[Math.ceil(n * 0.99) - 1];

    return {
      status: 'sample-diagnostic',
      dataStatus: 'caller-supplied-periods',
      hardRealTimeAssessment: 'not_assessed',
      packetsCount: n,
      targetPeriodUs,
      deadlineUs,
      meanPeriodUs: Number((sum / n).toFixed(2)),
      jitterRmsUs: Number(Math.sqrt(sumSqErr / n).toFixed(2)),
      p50JitterUs: Number(p50.toFixed(2)),
      p95JitterUs: Number(p95.toFixed(2)),
      p99JitterUs: Number(p99.toFixed(2)),
      deadlineMissesCount: deadlineMisses
    };
  }
}

module.exports = {
  HILTelemetryEngine
};
