/**
 * Verification gate for the IAPWS-IF97 steam formulation
 * (src/core/plant/iapws_if97.js).
 *
 * Checks, against the official IAPWS-IF97 release values (R7-97(2012))
 * and independent cross-checks (CoolProp IF97 / IAPWS-95 HEOS):
 *   - Region 1 (liquid):   h(300 K, 3 MPa) = 115.331273021 kJ/kg,
 *                           s = 0.392294792402 kJ/(kg K), v = 0.00100215168 m3/kg
 *   - Region 2 (steam):    h(300 K, 0.0035 MPa) = 2549.911450 kJ/kg,
 *                           s = 8.522389675 kJ/(kg K), v = 39.491386688 m3/kg
 *   - Region 3 (critical): v(650 K, 25 MPa) = 0.002045512416876044 m3/kg
 *                           (CoolProp IF97/HEOS-confirmed; the value stated in the
 *                           task brief, 0.002446..., is reported for transparency)
 *   - Region 4 saturation: Tsat(0.101325 MPa) = 373.1243 K, psat(373.15 K) = 101.418 kPa
 *   - Sound speed ideal-gas consistency for steam (gamma = cp/(cp - R) ~ 1.33)
 *   - Gibbs consistency dg/dp = v where derivatives are available
 *   - cp(300 K, 0.0035 MPa) = 1.913 kJ/(kg K) (CoolProp-confirmed; the brief's
 *     1.891 approximate is off; see report)
 *
 * Deterministic; plain assert style per repo convention.
 */

'use strict';

const assert = require('assert');
const { IAPWS_IF97, R_WATER } = require('../src/core/plant/iapws_if97');

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

let checks = 0;
function check(name, fn) {
  checks++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAILED: ${name}`);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
    throw err;
  }
}

console.log('================================================================');
console.log('   IAPWS-IF97 EXPANDED VERIFICATION GATE');
console.log('================================================================\n');

// ------------------------------------------------------------------
// 1. Region 1 (liquid): official Table 5 state
// ------------------------------------------------------------------
console.log('[1] Region 1 (liquid) at T=300 K, p=3 MPa ...');
check('Region 1 v/h/s match official release values (6 sig figs)', () => {
  const r = IAPWS_IF97.region1Properties(3e6, 300);
  const official = { v: 0.00100215168, h: 115.331273021, s: 0.392294792402 };
  assert(rel(r.specificVolume_m3_kg, official.v) < 1e-6,
    `v ${r.specificVolume_m3_kg} vs ${official.v} (${rel(r.specificVolume_m3_kg, official.v)})`);
  assert(rel(r.specificEnthalpy_J_kg / 1000, official.h) < 1e-6,
    `h ${r.specificEnthalpy_J_kg / 1000} vs ${official.h}`);
  assert(rel(r.specificEntropy_J_kg_K / 1000, official.s) < 1e-6,
    `s ${r.specificEntropy_J_kg_K / 1000} vs ${official.s}`);
});

// ------------------------------------------------------------------
// 2. Region 2 (steam): official Table 15 state
// ------------------------------------------------------------------
console.log('[2] Region 2 (steam) at T=300 K, p=0.0035 MPa ...');
check('Region 2 v/h/s match official release values (6 sig figs)', () => {
  const r = IAPWS_IF97.region2Properties(0.0035e6, 300);
  const official = { v: 39.491386688, h: 2549.911450, s: 8.522389675 };
  assert(rel(r.specificVolume_m3_kg, official.v) < 1e-6,
    `v ${r.specificVolume_m3_kg} vs ${official.v}`);
  assert(rel(r.specificEnthalpy_J_kg / 1000, official.h) < 1e-6,
    `h ${r.specificEnthalpy_J_kg / 1000} vs ${official.h}`);
  assert(rel(r.specificEntropy_J_kg_K / 1000, official.s) < 1e-6,
    `s ${r.specificEntropy_J_kg_K / 1000} vs ${official.s}`);
});

check('Region 2 cp(300 K, 0.0035 MPa) = 1.913 (within 1%)', () => {
  const r = IAPWS_IF97.region2Properties(0.0035e6, 300);
  const cpRef = 1.91300162; // CoolProp IF97 confirmed
  assert(rel(r.isobaricHeatCapacity_J_kg_K / 1000, cpRef) < 1e-2,
    `cp ${r.isobaricHeatCapacity_J_kg_K / 1000} vs ${cpRef} (brief-stated 1.891 approx is off)`);
});

// ------------------------------------------------------------------
// 3. Region 3 (critical vicinity): v(650 K, 25 MPa)
// ------------------------------------------------------------------
console.log('[3] Region 3 (critical) at T=650 K, p=25 MPa ...');
check('Region 3 v matches CoolProp IF97/HEOS-confirmed value (1e-3%)', () => {
  const r = IAPWS_IF97.region3Properties(25e6, 650);
  const vRef = 0.002045512416876044; // CoolProp IF97; IAPWS-95 HEOS: 0.00204563386
  assert(rel(r.specificVolume_m3_kg, vRef) < 1e-5,
    `v ${r.specificVolume_m3_kg} vs ${vRef} (${rel(r.specificVolume_m3_kg, vRef)})`);
});
check('Region 3 h/s/cp finite and plausible', () => {
  const r = IAPWS_IF97.region3Properties(25e6, 650);
  assert(Number.isFinite(r.specificEnthalpy_J_kg));
  assert(Number.isFinite(r.specificEntropy_J_kg_K));
  assert(Number.isFinite(r.isobaricHeatCapacity_J_kg_K));
  assert(r.density_kg_m3 > 0);
});
{
  const r = IAPWS_IF97.region3Properties(25e6, 650);
  const briefClaim = 0.00244620075764775;
  const devBrief = rel(r.specificVolume_m3_kg, briefClaim);
  console.log(`    INFO: measured v=${r.specificVolume_m3_kg.toFixed(12)} m3/kg; ` +
    `task-brief claimed 0.00244620075764775 -> deviation ${(devBrief * 100).toFixed(2)}% ` +
    `(brief value is inconsistent with CoolProp IF97 and IAPWS-95 HEOS)`);
}

// ------------------------------------------------------------------
// 4. Region 4 saturation
// ------------------------------------------------------------------
console.log('[4] Region 4 (saturation) ...');
check('Tsat(0.101325 MPa) = 373.1243 K (within 0.05%)', () => {
  const tsat = IAPWS_IF97.saturationTemperature(0.101325e6);
  const ref = 373.1243;
  assert(rel(tsat, ref) < 5e-4, `Tsat ${tsat} vs ${ref}`);
});
check('psat(373.15 K) = 101.418 kPa (within 0.05%)', () => {
  const psat = IAPWS_IF97.saturationPressure(373.15);
  const ref = 101417.98;
  assert(rel(psat, ref) < 5e-4, `psat ${psat} vs ${ref}`);
});

// ------------------------------------------------------------------
// 5. Sound speed in ideal gas limit (Region 2, low p)
// ------------------------------------------------------------------
console.log('[5] Sound speed consistency (ideal gas limit, Region 2) ...');
check('gamma = cp/(cp - R) ~ 1.33 within 1%; c = sqrt(gamma R T) within 1%', () => {
  const p = 0.0035e6;
  const T = 300;
  const r = IAPWS_IF97.region2Properties(p, T);
  const cp = r.isobaricHeatCapacity_J_kg_K;
  const gamma = cp / (cp - R_WATER);
  assert(rel(gamma, 1.33) < 1e-2, `gamma ${gamma} vs 1.33`);
  const cMod = Math.sqrt(gamma * p * r.specificVolume_m3_kg);
  const cIdeal = Math.sqrt(1.33 * R_WATER * T);
  assert(rel(cMod, cIdeal) < 1e-2, `c ${cMod} vs ideal ${cIdeal}`);
});

// ------------------------------------------------------------------
// 6. Gibbs consistency dg/dp = v
// ------------------------------------------------------------------
console.log('[6] Gibbs consistency dg/dp = v (finite difference) ...');
check('Region 1: dg/dp = v at (300 K, 3 MPa) within 0.1%', () => {
  const p = 3e6;
  const T = 300;
  const eps = p * 1e-4;
  const gAt = (pp) => {
    const r = IAPWS_IF97.region1Properties(pp, T);
    return r.specificEnthalpy_J_kg - T * r.specificEntropy_J_kg_K;
  };
  const dgdp = (gAt(p + eps) - gAt(p - eps)) / (2 * eps);
  const v = IAPWS_IF97.region1Properties(p, T).specificVolume_m3_kg;
  assert(rel(dgdp, v) < 1e-3, `dg/dp ${dgdp} vs v ${v}`);
});
check('Region 2: dg/dp = v at (300 K, 0.0035 MPa) within 0.1%', () => {
  const p = 0.0035e6;
  const T = 300;
  const eps = p * 1e-4;
  const gAt = (pp) => {
    const r = IAPWS_IF97.region2Properties(pp, T);
    return r.specificEnthalpy_J_kg - T * r.specificEntropy_J_kg_K;
  };
  const dgdp = (gAt(p + eps) - gAt(p - eps)) / (2 * eps);
  const v = IAPWS_IF97.region2Properties(p, T).specificVolume_m3_kg;
  assert(rel(dgdp, v) < 1e-3, `dg/dp ${dgdp} vs v ${v}`);
});
check('Region 3: dg/dp = v at (650 K, 25 MPa) within 0.1%', () => {
  const p = 25e6;
  const T = 650;
  const eps = p * 1e-4;
  const gAt = (pp) => {
    const r = IAPWS_IF97.region3Properties(pp, T);
    return r.specificEnthalpy_J_kg - T * r.specificEntropy_J_kg_K;
  };
  const dgdp = (gAt(p + eps) - gAt(p - eps)) / (2 * eps);
  const v = IAPWS_IF97.region3Properties(p, T).specificVolume_m3_kg;
  assert(rel(dgdp, v) < 1e-3, `dg/dp ${dgdp} vs v ${v}`);
});

// ------------------------------------------------------------------
// Measured summary table
// ------------------------------------------------------------------
console.log('\n--- Measured h/s/v vs official release values ---');
{
  const r1 = IAPWS_IF97.region1Properties(3e6, 300);
  console.log(`Region 1 (300 K, 3 MPa): v=${r1.specificVolume_m3_kg.toFixed(11)} (off 0.00100215168) ` +
    `h=${(r1.specificEnthalpy_J_kg / 1000).toFixed(9)} s=${(r1.specificEntropy_J_kg_K / 1000).toFixed(12)}`);
  const r2 = IAPWS_IF97.region2Properties(0.0035e6, 300);
  console.log(`Region 2 (300 K, 0.0035 MPa): v=${r2.specificVolume_m3_kg.toFixed(9)} (off 39.491386688) ` +
    `h=${(r2.specificEnthalpy_J_kg / 1000).toFixed(9)} s=${(r2.specificEntropy_J_kg_K / 1000).toFixed(9)}`);
  const r3 = IAPWS_IF97.region3Properties(25e6, 650);
  console.log(`Region 3 (650 K, 25 MPa): v=${r3.specificVolume_m3_kg.toFixed(12)} (CoolProp 0.002045512416876044) ` +
    `h=${(r3.specificEnthalpy_J_kg / 1000).toFixed(6)} s=${(r3.specificEntropy_J_kg_K / 1000).toFixed(8)}`);
  const tsat = IAPWS_IF97.saturationTemperature(0.101325e6);
  const psat = IAPWS_IF97.saturationPressure(373.15);
  console.log(`Region 4: Tsat(0.101325 MPa)=${tsat.toFixed(4)} K (off 373.1243); ` +
    `psat(373.15 K)=${(psat / 1000).toFixed(4)} kPa (off 101.418)`);
}

console.log(`\nAll ${checks} verification checks passed.`);
