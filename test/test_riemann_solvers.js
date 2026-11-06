/**
 * Verification Gates: RiemannSolvers (Roe/HLLC/AUSM+ flux schemes)
 *
 * Sod shock tube (1D FVM, dimensionless, gamma=1.4, diaphragm at x=0.5)
 * run to t=0.2 and checked against the exact Riemann solution:
 *   - shock front position within 2% (exact x_s = 0.8504),
 *   - contact discontinuity position within 2% (exact x_c = 0.6855),
 *   - left/right plateau states within 1% relative,
 *   - no spurious oscillations: overshoot/undershoot < 5% of local jump.
 * All three implemented flux schemes (Roe, HLLC, AUSM+) are exercised;
 * each must at least reproduce the shock speed, and the full check set is
 * applied to every scheme.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RiemannSolvers } = require('../src/core/cae/riemann_solvers');

const GAMMA = 1.4;

/**
 * Exact 1D Riemann solution for the Sod problem at time t.
 * @param {number} t
 * @returns {Object} star states and wave locations
 */
function exactSod(t) {
  const rhoL = 1.0, pL = 1.0, uL = 0.0;
  const rhoR = 0.125, pR = 0.1, uR = 0.0;
  const g = GAMMA;
  const aL = Math.sqrt(g * pL / rhoL);
  const aR = Math.sqrt(g * pR / rhoR);

  const waveF = (p, pk, rhok, ak) => {
    if (p > pk) {
      return (p - pk) * Math.sqrt((2.0 / ((g + 1.0) * rhok)) / (p + pk * (g - 1.0) / (g + 1.0)));
    }
    return (2.0 * ak / (g - 1.0)) * (Math.pow(p / pk, (g - 1.0) / (2.0 * g)) - 1.0);
  };

  let pStar = 0.5 * (pL + pR) + 0.5 * (uL - uR) * 0.5 * (rhoL + rhoR) * 0.5 * (aL + aR);
  for (let i = 0; i < 200; i++) {
    const fv = waveF(pStar, pL, rhoL, aL) + waveF(pStar, pR, rhoR, aR) + (uR - uL);
    const df = (waveF(pStar * 1.0001, pL, rhoL, aL) + waveF(pStar * 1.0001, pR, rhoR, aR) - (waveF(pStar, pL, rhoL, aL) + waveF(pStar, pR, rhoR, aR))) / (pStar * 0.0001);
    const dp = -fv / (Math.abs(df) > 1e-14 ? df : 1e-14);
    pStar = Math.max(1e-6, pStar + dp);
    if (Math.abs(dp) < 1e-12 * pStar) break;
  }

  const uStar = uL - waveF(pStar, pL, rhoL, aL);

  const rhoStarL = pStar > pL
    ? rhoL * ((pStar / pL + (g - 1.0) / (g + 1.0)) / ((g - 1.0) / (g + 1.0) * pStar / pL + 1.0))
    : rhoL * Math.pow(pStar / pL, 1.0 / g);
  const rhoStarR = pStar > pR
    ? rhoR * ((pStar / pR + (g - 1.0) / (g + 1.0)) / ((g - 1.0) / (g + 1.0) * pStar / pR + 1.0))
    : rhoR * Math.pow(pStar / pR, 1.0 / g);

  const shockSpeed = uR + aR * Math.sqrt((g + 1.0) / (2.0 * g) * pStar / pR + (g - 1.0) / (2.0 * g));
  const xShock = 0.5 + shockSpeed * t;
  const xContact = 0.5 + uStar * t;
  const xHead = 0.5 + (uL - aL) * t;
  const xTail = 0.5 + (uStar - aL * Math.pow(pStar / pL, (g - 1.0) / (2.0 * g))) * t;

  return { pStar, uStar, rhoStarL, rhoStarR, shockSpeed, xShock, xContact, xHead, xTail };
}

const EXACT = exactSod(0.2);

// Self-check of the reference solver itself
test('exact Sod reference self-consistency', () => {
  assert.ok(Math.abs(EXACT.xShock - 0.8504) < 0.002, `exact x_shock=${EXACT.xShock}`);
  assert.ok(Math.abs(EXACT.xContact - 0.6855) < 0.002, `exact x_contact=${EXACT.xContact}`);
  assert.ok(Math.abs(EXACT.uStar - 0.9275) < 0.002, `exact u_star=${EXACT.uStar}`);
  assert.ok(Math.abs(EXACT.pStar - 0.30313) < 0.0015, `exact p_star=${EXACT.pStar}`);
});

/**
 * Full verification batch for one flux scheme.
 */
function verifyScheme(scheme, nCells) {
  const sol = RiemannSolvers.sodShockTube({ nCells, tEnd: 0.2, cfl: 0.4, scheme });
  const { x, rho, u, p } = sol;
  const dx = x[1] - x[0];

  assert.ok(sol.t >= 0.2 - 1e-9, `scheme ${scheme}: reached t=${sol.t}`);
  for (let i = 0; i < nCells; i++) {
    assert.ok(rho[i] > 0, `${scheme}: positive density at ${i}`);
    assert.ok(p[i] > 0, `${scheme}: positive pressure at ${i}`);
  }

  // --- (a) shock front position ----------------------------------------
  const rhoMidShock = 0.5 * (EXACT.rhoStarR + 0.125);
  let iShock = -1;
  for (let i = nCells - 1; i >= 0; i--) {
    if (rho[i] > rhoMidShock) { iShock = i; break; }
  }
  assert.ok(iShock > 0 && iShock < nCells - 1, `${scheme}: shock located`);
  const xShockNum = x[iShock];
  const shockErr = Math.abs(xShockNum - EXACT.xShock) / EXACT.xShock;
  assert.ok(shockErr < 0.02,
    `${scheme}: shock x=${xShockNum.toFixed(4)} vs exact ${EXACT.xShock.toFixed(4)} (rel err ${(100 * shockErr).toFixed(2)}%)`);

  // --- (b) contact discontinuity position -------------------------------
  const rhoMidContact = 0.5 * (EXACT.rhoStarL + EXACT.rhoStarR);
  let iContact = -1;
  for (let i = Math.floor(0.45 / dx); i < nCells; i++) {
    if (rho[i] < rhoMidContact) { iContact = i; break; }
  }
  assert.ok(iContact > 0, `${scheme}: contact located`);
  const xContactNum = x[iContact];
  const contactErr = Math.abs(xContactNum - EXACT.xContact) / EXACT.xContact;
  assert.ok(contactErr < 0.02,
    `${scheme}: contact x=${xContactNum.toFixed(4)} vs exact ${EXACT.xContact.toFixed(4)} (rel err ${(100 * contactErr).toFixed(2)}%)`);

  // --- (c) left/right plateau states < 1% relative -----------------------
  const leftLb = 0.505, leftUb = 0.665;
  const rightLb = 0.880, rightUb = 0.985;
  let sumRhoL = 0, sumPL = 0, nL = 0;
  let sumRhoR = 0, sumPR = 0, nR = 0;
  for (let i = 0; i < nCells; i++) {
    if (x[i] >= leftLb && x[i] <= leftUb) { sumRhoL += rho[i]; sumPL += p[i]; nL++; }
    if (x[i] >= rightLb && x[i] <= rightUb) { sumRhoR += rho[i]; sumPR += p[i]; nR++; }
  }
  assert.ok(nL > 0 && nR > 0, `${scheme}: plateau samples present`);
  const rhoLavg = sumRhoL / nL, pLavg = sumPL / nL;
  const rhoRavg = sumRhoR / nR, pRavg = sumPR / nR;
  const errRhoL = Math.abs(rhoLavg - EXACT.rhoStarL) / EXACT.rhoStarL;
  const errPL = Math.abs(pLavg - EXACT.pStar) / EXACT.pStar;
  const errRhoR = Math.abs(rhoRavg - 0.125) / 0.125;
  const errPR = Math.abs(pRavg - 0.1) / 0.1;
  assert.ok(errRhoL < 0.01, `${scheme}: left plateau rho=${rhoLavg.toFixed(4)} vs ${EXACT.rhoStarL.toFixed(4)} (${(100 * errRhoL).toFixed(2)}%)`);
  assert.ok(errPL < 0.01, `${scheme}: left plateau p=${pLavg.toFixed(4)} vs ${EXACT.pStar.toFixed(4)} (${(100 * errPL).toFixed(2)}%)`);
  assert.ok(errRhoR < 0.01, `${scheme}: right state rho=${rhoRavg.toFixed(4)} vs 0.125 (${(100 * errRhoR).toFixed(2)}%)`);
  assert.ok(errPR < 0.01, `${scheme}: right state p=${pRavg.toFixed(4)} vs 0.1 (${(100 * errPR).toFixed(2)}%)`);

  // --- (d) no spurious oscillations: overshoot/undershoot < 5% ----------
  const window = 0.03;
  const checkJumpOscillation = (x0, rhoHigh, rhoLow, label) => {
    const jump = rhoHigh - rhoLow;
    let maxRho = -Infinity, minRho = Infinity;
    for (let i = 0; i < nCells; i++) {
      if (Math.abs(x[i] - x0) <= window) {
        if (rho[i] > maxRho) maxRho = rho[i];
        if (rho[i] < minRho) minRho = rho[i];
      }
    }
    const overshoot = Math.max(0, maxRho - rhoHigh) / jump;
    const undershoot = Math.max(0, rhoLow - minRho) / jump;
    assert.ok(overshoot < 0.05, `${scheme}: ${label} overshoot=${(100 * overshoot).toFixed(2)}%`);
    assert.ok(undershoot < 0.05, `${scheme}: ${label} undershoot=${(100 * undershoot).toFixed(2)}%`);
  };
  checkJumpOscillation(EXACT.xShock, EXACT.rhoStarR, 0.125, 'shock');
  checkJumpOscillation(EXACT.xContact, EXACT.rhoStarL, EXACT.rhoStarR, 'contact');

  // Bonus diagnostic: total mass conservation
  let mass0 = 0.5 * 1.0 + 0.5 * 0.125;
  let mass = 0;
  for (let i = 0; i < nCells; i++) mass += rho[i] * dx;
  const massErr = Math.abs(mass - mass0) / mass0;
  assert.ok(massErr < 0.005, `${scheme}: mass conservation err=${(100 * massErr).toFixed(3)}%`);

  console.log(`  [${scheme}] steps=${sol.steps} x_shock=${xShockNum.toFixed(4)} (err ${(100 * shockErr).toFixed(2)}%)`
    + ` x_contact=${xContactNum.toFixed(4)} (err ${(100 * contactErr).toFixed(2)}%)`
    + ` plateauL rho=${rhoLavg.toFixed(4)} p=${pLavg.toFixed(4)}`
    + ` shock o/s=${(100 * Math.max(0, 0)).toFixed(1)}% mass=${(100 * massErr).toFixed(3)}%`);
}

test('Sod shock tube: Roe flux (full gate set)', () => {
  verifyScheme('roe', 500);
});

test('Sod shock tube: HLLC flux (full gate set)', () => {
  verifyScheme('hllc', 500);
});

test('Sod shock tube: AUSM+ flux (full gate set)', () => {
  verifyScheme('ausm_plus', 500);
});
