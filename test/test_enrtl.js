'use strict';

/**
 * eNRTL / electrolyte verification gate.
 *
 * Verifies the Pitzer-Debye-Hückel limiting law, the electroneutrality
 * invariant, and the qualitative/published-range behavior of CO2/H2S
 * partial pressures over aqueous MDEA (monotonicity with loading and
 * temperature, H2S/CO2 selectivity).
 */

const assert = require('assert');
const {
  pdhLnGamma,
  pdhMeanIonicGamma,
  mdeaAcidGasEquilibrium,
  electroneutralityResidual
} = require('../src/core/plant/electrolyte_nrtl');

let passed = 0;
let total = 0;

function check(name, condition, detail) {
  total++;
  try {
    assert(condition, detail);
    passed++;
    console.log(`  PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } catch (err) {
    console.log(`  FAIL ${name} [${detail}]`);
    throw err;
  }
}

// --- 1. PDH limiting law ---
{
  for (const I of [1e-4, 1e-3, 1e-2]) {
    const gPDH = pdhMeanIonicGamma(I, 1, 1, 0.509);
    const gLimit = Math.exp(-0.509 * Math.sqrt(I));
    check(
      `PDH limiting law at I=${I}: within 0.1%`,
      Math.abs(gPDH - gLimit) / gLimit < 1e-3,
      `${gPDH.toFixed(8)} vs ${gLimit.toFixed(8)}`
    );
  }
  // mole-fraction PDH: 1:1 electrolyte at low mole fraction
  const ions = [
    { z: 1, x: 1e-4 },
    { z: -1, x: 1e-4 },
    { z: 0, x: 0.9998 }
  ];
  const lnG = pdhLnGamma(ions);
  check(
    'PDH ln γ finite and negative for low-I electrolyte',
    lnG.every((v) => Number.isFinite(v) && v <= 0),
    lnG.map((v) => v.toFixed(6)).join(', ')
  );
}

// --- 2. Electroneutrality ---
{
  const species = [
    { z: 1, c: 0.5 },
    { z: -1, c: 0.5 }
  ];
  check(
    'electroneutrality residual is zero for balanced species',
    Math.abs(electroneutralityResidual(species)) < 1e-12,
    `${electroneutralityResidual(species)}`
  );
}

// --- 3. MDEA-CO2/H2S: monotonicity + published range ---
{
  const mAmine = 2.5; // 30 wt% MDEA ≈ 2.5 mol/kg
  const T = 313.15; // 40°C
  const lo = mdeaAcidGasEquilibrium({ T, mAmine, alphaCO2: 0.1, alphaH2S: 0.1 });
  const mid = mdeaAcidGasEquilibrium({ T, mAmine, alphaCO2: 0.4, alphaH2S: 0.1 });
  const hi = mdeaAcidGasEquilibrium({ T, mAmine, alphaCO2: 0.8, alphaH2S: 0.1 });
  check(
    'CO2 partial pressure positive and finite',
    lo.pCO2kPa > 0 && Number.isFinite(lo.pCO2kPa),
    `${lo.pCO2kPa.toFixed(4)} kPa`
  );
  check(
    'CO2 partial pressure monotonic increasing with loading',
    hi.pCO2kPa > mid.pCO2kPa && mid.pCO2kPa > lo.pCO2kPa,
    `${lo.pCO2kPa.toFixed(3)} < ${mid.pCO2kPa.toFixed(3)} < ${hi.pCO2kPa.toFixed(3)}`
  );
  // published range: at 30 wt% MDEA, 40°C, α_CO2=0.4 → P_CO2 on the order of
  // 10-100 kPa (fitted correlations); assert a broad physical band.
  check(
    'CO2 partial pressure in published band (0.1–500 kPa) at α=0.4',
    mid.pCO2kPa > 0.1 && mid.pCO2kPa < 500,
    `${mid.pCO2kPa.toFixed(2)} kPa`
  );

  // temperature trend: fixed loading, higher T → higher P_CO2
  const Tcold = mdeaAcidGasEquilibrium({ T: 293.15, mAmine, alphaCO2: 0.4, alphaH2S: 0.1 });
  const Thot = mdeaAcidGasEquilibrium({ T: 393.15, mAmine, alphaCO2: 0.4, alphaH2S: 0.1 });
  check(
    'CO2 partial pressure monotonic increasing with temperature (20→120°C)',
    Thot.pCO2kPa > Tcold.pCO2kPa,
    `${Tcold.pCO2kPa.toFixed(3)} → ${Thot.pCO2kPa.toFixed(3)}`
  );

  // At EQUAL loadings, the stronger H2S binding (higher effective K2) leaves
  // less free H2S, so p_H2S < p_CO2 — the equilibrium volatility ordering.
  // (Kinetic selectivity — H2S absorbed faster than CO2 — is not modeled.)
  const sel = mdeaAcidGasEquilibrium({ T, mAmine, alphaCO2: 0.4, alphaH2S: 0.4 });
  check(
    'H2S/CO2 partial-pressure ratio < 1 at equal loadings (stronger H2S binding)',
    sel.pH2SkPa / sel.pCO2kPa < 1,
    `${(sel.pH2SkPa / sel.pCO2kPa).toFixed(3)}×`
  );
}

// --- 4. eNRTL local term sanity ---
{
  const [lnGIon, lnGSolv] = require('../src/core/plant/electrolyte_nrtl').enrtlLocalGamma(0.1, 0.9, 8.0, 4.0, 0.2);
  check(
    'eNRTL local ln γ finite',
    Number.isFinite(lnGIon) && Number.isFinite(lnGSolv),
    `${lnGIon.toFixed(4)}, ${lnGSolv.toFixed(4)}`
  );
  const [a] = require('../src/core/plant/electrolyte_nrtl').enrtlLocalGamma(0.5, 0.5, 8.0, 4.0, 0.2);
  const [b] = require('../src/core/plant/electrolyte_nrtl').enrtlLocalGamma(0.5, 0.5, 8.0, 4.0, 0.2);
  check('eNRTL deterministic', a === b);
}

console.log(`\nenrtl: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
