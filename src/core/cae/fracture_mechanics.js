/**
 * OmniEng Linear-Elastic Fracture Mechanics Engine
 *
 * Verifiable gate for the classical fracture mechanics toolkit:
 *   - Mode I stress-intensity factor (SIF) extraction from the near-tip
 *     displacement field (crack-face opening displacement, theta = pi).
 *   - Mode II SIF extraction from the analogous sliding displacement field
 *     ahead of the crack tip (theta = 0).
 *   - ASTM E399 compact tension (CT) specimen geometry factor f(a/W) and
 *     K_I = (P / (B sqrt(W))) * f(a/W).
 *   - J-integral / SIF equivalence for linear-elastic plane strain:
 *     J = K_I^2 * (1 - nu^2) / E.
 *   - Critical crack / toughness verdict against material toughness K_IC.
 *
 * All routines are pure, deterministic, and depend only on the arguments;
 * no external runtime dependencies are used.
 */

'use strict';

const TWO_PI = 2 * Math.PI;

class FractureMechanics {
  static _checkScalar(name, val) {
    if (!Number.isFinite(val)) throw new TypeError(`Provide finite ${name}.`);
  }

  static _checkMaterial(E, nu) {
    this._checkScalar('E', E);
    this._checkScalar('nu', nu);
    if (E <= 0) throw new RangeError('Young modulus E must be positive.');
    if (Math.abs(nu) >= 1) throw new RangeError('Poisson ratio nu must satisfy |nu| < 1.');
  }

  /**
   * Near-tip Mode I crack-face opening displacement (theta = pi):
   *   v(r) = K_I * 4(1 - nu^2)/E * sqrt(r/(2 pi))   [plane strain]
   * This is the closed form used for SIF extraction from displacement data.
   */
  static modeICrackFaceOpening(K_I, E, nu, r, planeStrain = true) {
    this._checkScalar('K_I', K_I);
    this._checkScalar('r', r);
    this._checkMaterial(E, nu);
    if (r <= 0) throw new RangeError('Distance r must be positive.');
    const c = planeStrain ? (4 * (1 - nu * nu)) / E : 4 / E;
    return K_I * c * Math.sqrt(r / TWO_PI);
  }

  /**
   * Near-tip Mode II sliding displacement on the crack plane ahead of the tip
   * (theta = 0, plane strain):
   *   u_x(r) = K_II * (1 - 2 nu)/(2G) * sqrt(r/(2 pi)),  G = E/(2(1+nu)).
   */
  static modeIISlidingDisplacement(K_II, E, nu, r, planeStrain = true) {
    this._checkScalar('K_II', K_II);
    this._checkScalar('r', r);
    this._checkMaterial(E, nu);
    if (r <= 0) throw new RangeError('Distance r must be positive.');
    const G = E / (2 * (1 + nu));
    const c = planeStrain ? (1 - 2 * nu) / (2 * G) : 1 / (2 * G);
    return K_II * c * Math.sqrt(r / TWO_PI);
  }

  /**
   * Least-squares slope of y(x) through the origin: m = sum(x*y)/sum(x^2).
   */
  static _fitSlopeThroughOrigin(xs, ys) {
    let Sxx = 0;
    let Sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      Sxx += xs[i] * xs[i];
      Sxy += xs[i] * ys[i];
    }
    if (Sxx <= 0) throw new Error('Degenerate displacement samples (constant r).');
    return Sxy / Sxx;
  }

  /**
   * Extracts K_I from crack-face opening displacement samples {r, v} by
   * least-squares fitting v(r) = K_I * C * sqrt(r) (plane strain).
   * @param {object} opts { E, nu, planeStrain, samples: [{r, v}] }
   * @returns {number} K_I (same unit system as E and displacements).
   */
  static extractSIFModeI(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('Provide options object.');
    const { E, nu, planeStrain = true, samples } = opts;
    this._checkMaterial(E, nu);
    if (!Array.isArray(samples) || samples.length < 2) {
      throw new TypeError('Provide at least two displacement samples [{r, v}].');
    }
    const xs = [];
    const ys = [];
    for (const s of samples) {
      if (!s || !Number.isFinite(s.r) || !Number.isFinite(s.v) || s.r <= 0) {
        throw new TypeError('Each sample must be {r, v} with r > 0.');
      }
      xs.push(Math.sqrt(s.r));
      ys.push(s.v);
    }
    const slope = this._fitSlopeThroughOrigin(xs, ys);
    const C = planeStrain ? (4 * (1 - nu * nu)) / E : 4 / E;
    return (slope * Math.sqrt(TWO_PI)) / C;
  }

  /**
   * Extracts K_II from sliding displacement samples {r, ux} evaluated on the
   * crack plane ahead of the tip (theta = 0, plane strain).
   * @param {object} opts { E, nu, planeStrain, samples: [{r, ux}] }
   * @returns {number} K_II.
   */
  static extractSIFModeII(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('Provide options object.');
    const { E, nu, planeStrain = true, samples } = opts;
    this._checkMaterial(E, nu);
    if (!Array.isArray(samples) || samples.length < 2) {
      throw new TypeError('Provide at least two displacement samples [{r, ux}].');
    }
    const xs = [];
    const ys = [];
    for (const s of samples) {
      if (!s || !Number.isFinite(s.r) || !Number.isFinite(s.ux) || s.r <= 0) {
        throw new TypeError('Each sample must be {r, ux} with r > 0.');
      }
      xs.push(Math.sqrt(s.r));
      ys.push(s.ux);
    }
    const slope = this._fitSlopeThroughOrigin(xs, ys);
    const G = E / (2 * (1 + nu));
    const C = planeStrain ? (1 - 2 * nu) / (2 * G) : 1 / (2 * G);
    return (slope * Math.sqrt(TWO_PI)) / C;
  }

  /**
   * ASTM E399 compact tension specimen geometry factor:
   *   f(a/W) = ((2 + a/W)/(1 - a/W)^1.5) *
   *            [0.886 + 4.64(a/W) - 13.32(a/W)^2 + 14.72(a/W)^3 - 5.6(a/W)^4]
   * Valid for 0.2 <= a/W <= 1.0.
   */
  static ctGeometryFactor(alpha) {
    this._checkScalar('a/W', alpha);
    if (alpha < 0.2 || alpha > 1.0) {
      throw new RangeError('a/W must lie in [0.2, 1.0] for ASTM E399.');
    }
    const a = alpha;
    const poly = 0.886 + 4.64 * a - 13.32 * a * a + 14.72 * a * a * a - 5.6 * a * a * a * a;
    const denom = Math.pow(1 - a, 1.5);
    return ((2 + a) / denom) * poly;
  }

  /**
   * ASTM E399 compact tension (CT) specimen stress-intensity factor:
   *   K_I = (P / (B sqrt(W))) * f(a/W)
   * @param {object} opts { P (force), B (thickness), W (width), a (crack length) }
   * @returns {number} K_I.
   */
  static compactTensionSIF(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('Provide options object.');
    const { P, B, W, a } = opts;
    for (const [name, val] of [
      ['P', P],
      ['B', B],
      ['W', W],
      ['a', a]
    ]) {
      this._checkScalar(name, val);
      if (val <= 0) throw new RangeError(`${name} must be positive.`);
    }
    const alpha = a / W;
    const f = this.ctGeometryFactor(alpha);
    return (P / (B * Math.sqrt(W))) * f;
  }

  /**
   * J-integral / SIF equivalence for linear-elastic behavior:
   *   J = K_I^2 * (1 - nu^2)/E   [plane strain]
   *   J = K_I^2 / E               [plane stress]
   */
  static JintegralFromSIF(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('Provide options object.');
    const { K_I, E, nu, planeStrain = true } = opts;
    this._checkScalar('K_I', K_I);
    this._checkMaterial(E, nu);
    const factor = planeStrain ? 1 - nu * nu : 1;
    return (K_I * K_I * factor) / E;
  }

  /**
   * Critical crack / toughness verdict. Returns cracked=true when the applied
   * SIF reaches or exceeds the plane-strain fracture toughness K_IC.
   * @param {object} opts { K_applied, K_IC }
   */
  static assessFracture(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('Provide options object.');
    const { K_applied, K_IC } = opts;
    this._checkScalar('K_applied', K_applied);
    this._checkScalar('K_IC', K_IC);
    if (K_applied < 0) throw new RangeError('Applied SIF must be non-negative.');
    if (K_IC <= 0) throw new RangeError('Toughness K_IC must be positive.');
    const cracked = K_applied >= K_IC;
    return {
      cracked,
      margin: K_IC - K_applied,
      utilization: K_applied / K_IC,
      verdict: cracked ? 'cracked' : 'not-cracked'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FractureMechanics };
}
