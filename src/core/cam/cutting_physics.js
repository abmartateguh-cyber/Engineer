/**
 * CuttingPhysicsEngine: Machining Cutting-Force / Physics Engine
 *
 * Implements the standard Kienzle cutting-force model with radial chip-thinning
 * feed compensation, cutting power/torque, and Taylor tool-life relations for
 * face-milling configurations.
 *
 * Models
 * ------
 * 1. Kienzle (1952):  Fc = ks1.1 * b * h^(1 - mc)
 *      Fc     = main cutting force (N)
 *      ks1.1 = specific cutting force for h = 1 mm (N/mm^2)
 *      b      = width of cut (mm)
 *      h      = uncut chip thickness (mm)
 *      mc     = chip-thickness exponent (0 < mc < 1)
 *    Reference: W. Kienzle, "Die Bestimmung von Kräften und Leistungen an
 *    spanenden Werkzeugen und Werkzeugmaschinen", VDI-Z 94 (1952).
 *    Inconel 718 dynamometer-fit values (ks1.1 = 2900 N/mm^2, mc = 0.76)
 *    as used in published machining benchmark data sets.
 *
 * 2. Radial chip thinning (rotating cutter): with engagement angle theta_eng
 *    the instantaneous chip thickness is h(t) = fz * sin(theta(t)). The
 *    effective average chip thickness over the engaged arc [0, theta_eng] is
 *      h_avg = (1/theta_eng) * integral(0..theta_eng) fz*sin(u) du
 *            = fz * (1 - cos(theta_eng)) / theta_eng
 *    Feed compensation factor to hold constant chip load: F = h_nom / h_avg
 *    with h_nom = fz (nominal feed-based chip thickness). F > 1 for any
 *    engagement < 180deg because h_avg < fz.
 *
 * 3. Cutting power and torque:
 *      Pc = Fc * vc / 60000   (kW, Fc in N, vc in m/min)
 *      Tc = Fc * D_tool / 2000 (N*m, D_tool in mm)
 *
 * 4. Taylor tool life:  T = (Cv / vc)^(1/n)  (min)
 *    Published constants (Machining Data Handbook, Metcut; and Krar & Gill,
 *    "Machine Tool Operations"):
 *      Inconel 718, HSS:     Cv = 55,  n = 0.22
 *      Inconel 718, carbide:  Cv = 150, n = 0.25
 */

'use strict';

const CUTTING_PHYSICS_VERSION = '1.0.0';

const MATERIAL_CONSTANTS = {
  inconel718: {
    ks11: 2900.0, // N/mm^2, specific cutting force at h = 1 mm (dynamometer fit)
    mc: 0.76, // chip-thickness exponent
    source: 'Published dynamometer-fit values for Inconel 718 (Kienzle form).'
  }
};

const TAYLOR_CONSTANTS = {
  inconel718HSS: {
    Cv: 55.0,
    n: 0.22,
    source: 'Machining Data Handbook (Metcut), Inconel 718 HSS tooling.'
  },
  inconel718Carbide: {
    Cv: 150.0,
    n: 0.25,
    source: 'Machining Data Handbook (Metcut), Inconel 718 carbide tooling.'
  }
};

function assertPositiveFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`CuttingPhysicsEngine: ${name} must be a finite positive number (got ${value})`);
  }
}

function argumentError(name) {
  return new TypeError(`CuttingPhysicsEngine: ${name} must be a numeric value`);
}

class CuttingPhysicsEngine {
  /**
   * Kienzle cutting force: Fc = ks1.1 * b * h^(1 - mc).
   * @param {Object} p
   * @param {number} p.ks11 specific cutting force at h = 1 mm (N/mm^2)
   * @param {number} p.mc  chip-thickness exponent (0 < mc < 1)
   * @param {number} p.b   width of cut (mm)
   * @param {number} p.h   uncut chip thickness (mm, > 0)
   * @returns {number} Fc (N)
   */
  kienzleCuttingForce(p) {
    const ks11 = p.ks11;
    const mc = p.mc;
    const b = p.b;
    const h = p.h;
    if (typeof ks11 !== 'number' || typeof mc !== 'number' || typeof b !== 'number' || typeof h !== 'number') {
      throw argumentError('ks11, mc, b, h');
    }
    assertPositiveFinite(ks11, 'ks11');
    assertPositiveFinite(b, 'b');
    assertPositiveFinite(h, 'h');
    if (!Number.isFinite(mc) || mc <= 0 || mc >= 1) {
      throw new RangeError(`CuttingPhysicsEngine: mc must be in (0, 1) (got ${mc})`);
    }
    return ks11 * b * Math.pow(h, 1.0 - mc);
  }

  /**
   * Instantaneous chip thickness for a rotating cutter at angular position
   * theta (rad) within the engaged arc: h(theta) = fz * sin(theta).
   * @param {number} fz feed per tooth (mm/tooth)
   * @param {number} thetaRad cutter angular position (rad)
   * @returns {number} h (mm)
   */
  chipThicknessAtAngle(fz, thetaRad) {
    if (typeof fz !== 'number' || typeof thetaRad !== 'number') {
      throw argumentError('fz, thetaRad');
    }
    assertPositiveFinite(fz, 'fz');
    if (!Number.isFinite(thetaRad)) {
      throw argumentError('thetaRad');
    }
    return fz * Math.sin(thetaRad);
  }

  /**
   * Effective average chip thickness over the engaged arc [0, thetaEngRad]:
   * h_avg = fz * (1 - cos(thetaEngRad)) / thetaEngRad.
   * Also returns the feed-compensation factor F = h_nom / h_avg with
   * h_nom = fz (constant chip-load maintenance).
   * @param {Object} p
   * @param {number} p.fz feed per tooth (mm/tooth)
   * @param {number} p.thetaEngRad engagement angle (rad, in (0, pi])
   * @returns {{hAvg: number, hAvgFactor: number, hNom: number, factor: number}}
   */
  chipThinningAverage(p) {
    const fz = p.fz;
    const thetaEngRad = p.thetaEngRad;
    if (typeof fz !== 'number' || typeof thetaEngRad !== 'number') {
      throw argumentError('fz, thetaEngRad');
    }
    assertPositiveFinite(fz, 'fz');
    if (!Number.isFinite(thetaEngRad) || thetaEngRad <= 0 || thetaEngRad > Math.PI) {
      throw new RangeError(`CuttingPhysicsEngine: thetaEngRad must be in (0, pi] (got ${thetaEngRad})`);
    }
    const hAvg = (fz * (1.0 - Math.cos(thetaEngRad))) / thetaEngRad;
    const hNom = fz;
    const factor = hNom / hAvg;
    return { hAvg, hAvgFactor: hAvg / fz, hNom, factor };
  }

  /**
   * Face-milling chip thickness approximation for a rotating cutter with
   * approach angle kappa: h_avg ~= h_peak ~= fz * sin(kappa).
   * @param {Object} p
   * @param {number} p.fz feed per tooth (mm/tooth)
   * @param {number} p.kappaDeg cutting edge approach angle (deg, default 90)
   * @returns {{hAvgApprox: number, hPeak: number}}
   */
  faceMillingChipThickness(p) {
    const fz = p.fz;
    const kappaDeg = p.kappaDeg === undefined ? 90.0 : p.kappaDeg;
    if (typeof fz !== 'number' || typeof kappaDeg !== 'number') {
      throw argumentError('fz, kappaDeg');
    }
    assertPositiveFinite(fz, 'fz');
    if (!Number.isFinite(kappaDeg) || kappaDeg <= 0 || kappaDeg > 90.0) {
      throw new RangeError(`CuttingPhysicsEngine: kappaDeg must be in (0, 90] (got ${kappaDeg})`);
    }
    const h = fz * Math.sin(kappaDeg * (Math.PI / 180.0));
    return { hAvgApprox: h, hPeak: h };
  }

  /**
   * Cutting power: Pc = Fc * vc / 60000 (kW).
   * @param {number} Fc main cutting force (N)
   * @param {number} vc cutting speed (m/min)
   * @returns {number} Pc (kW)
   */
  cuttingPower(Fc, vc) {
    if (typeof Fc !== 'number' || typeof vc !== 'number') {
      throw argumentError('Fc, vc');
    }
    if (Fc < 0 || !Number.isFinite(Fc)) {
      throw new RangeError(`CuttingPhysicsEngine: Fc must be a finite non-negative number (got ${Fc})`);
    }
    assertPositiveFinite(vc, 'vc');
    return (Fc * vc) / 60000.0;
  }

  /**
   * Cutting torque: Tc = Fc * D_tool / 2000 (N*m).
   * @param {number} Fc main cutting force (N)
   * @param {number} DTool tool diameter (mm)
   * @returns {number} Tc (N*m)
   */
  cuttingTorque(Fc, DTool) {
    if (typeof Fc !== 'number' || typeof DTool !== 'number') {
      throw argumentError('Fc, DTool');
    }
    if (Fc < 0 || !Number.isFinite(Fc)) {
      throw new RangeError(`CuttingPhysicsEngine: Fc must be a finite non-negative number (got ${Fc})`);
    }
    assertPositiveFinite(DTool, 'DTool');
    return (Fc * DTool) / 2000.0;
  }

  /**
   * Taylor tool life: T = (Cv / vc)^(1/n) (min).
   * @param {number} vc cutting speed (m/min)
   * @param {Object} [constants] { Cv, n } (defaults to HSS Inconel 718)
   * @returns {number} T (min)
   */
  taylorToolLife(vc, constants = TAYLOR_CONSTANTS.inconel718HSS) {
    const Cv = constants.Cv;
    const n = constants.n;
    if (typeof vc !== 'number' || typeof Cv !== 'number' || typeof n !== 'number') {
      throw argumentError('vc, Cv, n');
    }
    assertPositiveFinite(vc, 'vc');
    assertPositiveFinite(Cv, 'Cv');
    if (!Number.isFinite(n) || n <= 0) {
      throw new RangeError(`CuttingPhysicsEngine: n must be a finite positive number (got ${n})`);
    }
    const ratio = Cv / vc;
    if (ratio <= 0) {
      throw new RangeError('CuttingPhysicsEngine: Cv / vc must be positive');
    }
    return Math.pow(ratio, 1.0 / n);
  }
}

module.exports = {
  CuttingPhysicsEngine,
  MATERIAL_CONSTANTS,
  TAYLOR_CONSTANTS,
  CUTTING_PHYSICS_VERSION
};
