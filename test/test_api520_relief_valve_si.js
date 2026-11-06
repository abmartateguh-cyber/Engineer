'use strict';

/**
 * Regression guard for API 520 Part I SI (metric) sizing in the legacy
 * `api520_relief_valve.js` module (used by the `omni:size-api520-prv` IPC
 * route). The US-customary 13160 (choked) and 17.9 (subcritical) factors are
 * only valid for lb/h / psia inputs; applying them to kg/h / kPa inputs
 * inflates areas by orders of magnitude (measured ~17.4e6 mm² for a case that
 * should size near ~1.3e3 mm²).
 */

'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { Api520ReliefValve } = require('../src/core/plant/api520_relief_valve');

describe('Api520ReliefValve.sizeGasVapor (SI units)', () => {
  // Propane-like gas: W = 30,000 kg/h, P_set = 1000 kPa(g) + 10% overpressure
  // -> P1 = 1201.325 kPa(a); T = 330 K; M = 44.097; Z = 0.85; k = 1.13.
  // Matches PSVSizingEngine result (~2,578 mm², 'N' orifice).
  it('critical flow matches the corrected SI equation (A = W/(C Kd P1 Kb Kc) sqrt(TZ/M))', () => {
    const r = Api520ReliefValve.sizeGasVapor({
      massFlow: 30000,
      P1: 1201.325,
      Pb: 101.325,
      T: 330,
      M: 44.097,
      k: 1.13,
      Z: 0.85
    });
    assert.equal(r.flowRegime, 'critical');
    assert(
      r.requiredArea_sq_mm > 1000 && r.requiredArea_sq_mm < 4000,
      `area ${r.requiredArea_sq_mm} mm² not in expected SI range`
    );
    assert.equal(r.selectedOrifice.designation, 'N');
  });

  it('critical flow returns physically sane area for a 10,000 kg/h air-like case', () => {
    const r = Api520ReliefValve.sizeGasVapor({
      massFlow: 10000,
      P1: 1000,
      Pb: 101.325,
      T: 350,
      M: 28.97,
      k: 1.4
    });
    assert.equal(r.flowRegime, 'critical');
    assert(
      r.requiredArea_sq_mm > 100 && r.requiredArea_sq_mm < 5000,
      `area ${r.requiredArea_sq_mm} mm² not in expected SI range`
    );
  });

  it('subcritical flow uses the SI flow-factor equation (A >= choked area, grows with backpressure)', () => {
    const base = {
      massFlow: 10000,
      P1: 1000,
      T: 350,
      M: 28.97,
      k: 1.4
    };
    const choked = Api520ReliefValve.sizeGasVapor({ ...base, Pb: 101.325 });
    const sub = Api520ReliefValve.sizeGasVapor({ ...base, Pb: 900 });
    const sub2 = Api520ReliefValve.sizeGasVapor({ ...base, Pb: 950 });
    assert.equal(choked.flowRegime, 'critical');
    assert.equal(sub.flowRegime, 'subcritical');
    assert.equal(sub2.flowRegime, 'subcritical');
    // subcritical area must be >= choked area (capacity cannot exceed choked)
    assert(
      sub.requiredArea_sq_mm >= choked.requiredArea_sq_mm * 0.99,
      `subcritical ${sub.requiredArea_sq_mm} < choked ${choked.requiredArea_sq_mm}`
    );
    // higher backpressure -> larger required area
    assert(
      sub2.requiredArea_sq_mm > sub.requiredArea_sq_mm,
      `Pb=950 area ${sub2.requiredArea_sq_mm} should exceed Pb=900 area ${sub.requiredArea_sq_mm}`
    );
    assert(sub.requiredArea_sq_mm < 5000, `area ${sub.requiredArea_sq_mm} mm² not in expected SI range`);
  });
});
