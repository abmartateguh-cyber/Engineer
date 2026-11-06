/**
 * src/core/plant/nozzle_load_evaluator.js
 * Rotating-equipment nozzle load evaluator.
 *
 * Standards embedded:
 *  - API 610 (11th ed.) Table 5 — allowable nozzle forces/moments for centrifugal
 *    pumps, by pump size category (suction nozzle nominal size). Values embedded
 *    are the widely published Table 5 magnitudes, applied as INDIVIDUAL
 *    per-component allowables (standard conservative practice) on suction and
 *    discharge nozzles. SI values are rounded from the published imperial
 *    equivalents: 1-2 in: 150/120/150 lbf, 250/190/250 ft-lbf; 3-4 in:
 *    200/160/200 lbf, 340/260/340 ft-lbf; 6-8 in: 300/240/300 lbf,
 *    460/350/460 ft-lbf; 10-12 in: 400/320/400 lbf, 640/490/640 ft-lbf;
 *    14+ in: 500/400/500 lbf, 830/630/830 ft-lbf (1 lbf = 4.448222 N,
 *    1 ft-lbf = 1.355818 N·m). Verify against a licensed copy of API 610
 *    before regulatory use.
 *  - NEMA SM 23 — allowable combined moment on steam turbine inlet/exhaust
 *    flanges. Values embedded are REPRESENTATIVE, derived from the commonly
 *    reproduced NEMA SM 23 flange moment guideline
 *    M_max = 97,000 x (D/12)^3 in-lbf (D = nominal flange diameter, in),
 *    converted to N·m (1 in-lbf = 0.112985 N·m): frame 0-2/4/6/8/10/12 maps
 *    to exhaust flange 8/10/12/14/16/18 in and inlet flange 60% of exhaust.
 *    TREAT AS REPRESENTATIVE pending verification against a licensed copy of
 *    NEMA SM 23.
 */

'use strict';

const API610_TABLE_5 = Object.freeze({
  '1-2': Object.freeze({
    suction: Object.freeze({ Fx: 670, Fy: 530, Fz: 670, Mx: 340, My: 260, Mz: 340 }),
    discharge: Object.freeze({ Fx: 670, Fy: 530, Fz: 670, Mx: 340, My: 260, Mz: 340 })
  }),
  '3-4': Object.freeze({
    suction: Object.freeze({ Fx: 890, Fy: 710, Fz: 890, Mx: 470, My: 350, Mz: 470 }),
    discharge: Object.freeze({ Fx: 890, Fy: 710, Fz: 890, Mx: 470, My: 350, Mz: 470 })
  }),
  '6-8': Object.freeze({
    suction: Object.freeze({ Fx: 1330, Fy: 1070, Fz: 1330, Mx: 620, My: 470, Mz: 620 }),
    discharge: Object.freeze({ Fx: 1330, Fy: 1070, Fz: 1330, Mx: 620, My: 470, Mz: 620 })
  }),
  '10-12': Object.freeze({
    suction: Object.freeze({ Fx: 1780, Fy: 1420, Fz: 1780, Mx: 870, My: 660, Mz: 870 }),
    discharge: Object.freeze({ Fx: 1780, Fy: 1420, Fz: 1780, Mx: 870, My: 660, Mz: 870 })
  }),
  '14+': Object.freeze({
    suction: Object.freeze({ Fx: 2220, Fy: 1780, Fz: 2220, Mx: 1130, My: 850, Mz: 1130 }),
    discharge: Object.freeze({ Fx: 2220, Fy: 1780, Fz: 2220, Mx: 1130, My: 850, Mz: 1130 })
  })
});

const NEMA_SM23_FRAMES = Object.freeze({
  '0-2': Object.freeze({ inlet: 700, exhaust: 3250 }),
  4: Object.freeze({ inlet: 1370, exhaust: 6350 }),
  6: Object.freeze({ inlet: 2370, exhaust: 10960 }),
  8: Object.freeze({ inlet: 3760, exhaust: 17400 }),
  10: Object.freeze({ inlet: 5610, exhaust: 25980 }),
  12: Object.freeze({ inlet: 7990, exhaust: 36990 })
});

const API610_SIZE_ORDER = ['1-2', '3-4', '6-8', '10-12', '14+'];
const NEMA_FRAME_ORDER = ['0-2', '4', '6', '8', '10', '12'];

const FORCE_COMPONENTS = ['Fx', 'Fy', 'Fz'];
const MOMENT_COMPONENTS = ['Mx', 'My', 'Mz'];

class NozzleLoadEvaluator {
  static api610Table() {
    return API610_TABLE_5;
  }

  static nemaSm23Frames() {
    return NEMA_SM23_FRAMES;
  }

  /**
   * Maps a nominal pipe size (in) to its API 610 Table 5 pump size category.
   * @param {number|string} nps Nominal suction nozzle size (in)
   * @returns {string} Category key ('1-2' | '3-4' | '6-8' | '10-12' | '14+')
   */
  static resolveApi610Category(nps) {
    const n = Number(nps);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`NozzleLoadEvaluator: invalid nps ${nps}`);
    }
    if (n <= 2) return '1-2';
    if (n <= 4) return '3-4';
    if (n <= 8) return '6-8';
    if (n <= 12) return '10-12';
    return '14+';
  }

  /**
   * Evaluates centrifugal pump nozzle loads against API 610 Table 5.
   * Each tabulated magnitude is applied as the individual allowable of the
   * corresponding component; the combined utilization is the governing
   * (maximum) component ratio. Resultant force/moment ratios are reported for
   * information and do not themselves drive the verdict.
   * @param {Object} loads
   * @param {string} loads.sizeCategory Pump size category (e.g. '3-4')
   * @param {string} [loads.nozzle='suction'] 'suction' | 'discharge'
   * @param {number} loads.Fx Radial force (N) (+x = horizontal, away from pump)
   * @param {number} loads.Fy Vertical force (N) (+y = up)
   * @param {number} loads.Fz Axial force (N) (+z = along pump axis)
   * @param {number} loads.Mx Moment about x (N·m)
   * @param {number} loads.My Moment about y (N·m)
   * @param {number} loads.Mz Moment about z (N·m)
   */
  static evaluateApi610(loads) {
    const { sizeCategory, nozzle = 'suction', Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0 } = loads;

    const allow = API610_TABLE_5[sizeCategory] && API610_TABLE_5[sizeCategory][nozzle];
    if (!allow) {
      throw new Error(`NozzleLoadEvaluator: unknown API 610 size category '${sizeCategory}' or nozzle '${nozzle}'`);
    }

    const values = { Fx, Fy, Fz, Mx, My, Mz };
    const components = [];

    for (const name of FORCE_COMPONENTS.concat(MOMENT_COMPONENTS)) {
      const actual = values[name];
      const allowable = allow[name];
      const utilization = Math.abs(actual) / allowable;
      components.push({
        name,
        type: name.startsWith('F') ? 'force' : 'moment',
        actual,
        allowable,
        utilization,
        pass: utilization <= 1.0
      });
    }

    const forceResultant = Math.sqrt(Fx * Fx + Fy * Fy + Fz * Fz);
    const momentResultant = Math.sqrt(Mx * Mx + My * My + Mz * Mz);
    const forceRatio = forceResultant / allow.Fx;
    const momentRatio = momentResultant / allow.Mx;
    const combinedUtilization = Math.max(...components.map((c) => c.utilization));
    const pass = components.every((c) => c.pass);

    return {
      standard: 'API 610 (11th ed.) Table 5',
      sizeCategory,
      nozzle,
      allowables: allow,
      components,
      forceResultant,
      momentResultant,
      forceRatio,
      momentRatio,
      combinedUtilization,
      pass
    };
  }

  /**
   * Evaluates steam turbine flange loads against NEMA SM 23.
   * @param {Object} loads
   * @param {string} loads.frameSize Turbine frame size (e.g. '4')
   * @param {string} [loads.flange='exhaust'] 'inlet' | 'exhaust'
   * @param {number} loads.Mx Moment about x (N·m)
   * @param {number} loads.My Moment about y (N·m)
   * @param {number} loads.Mz Moment about z (N·m)
   */
  static evaluateNemaSm23(loads) {
    const { frameSize, flange = 'exhaust', Mx = 0, My = 0, Mz = 0 } = loads;

    const frame = NEMA_SM23_FRAMES[frameSize];
    if (!frame || frame[flange] === undefined) {
      throw new Error(`NozzleLoadEvaluator: unknown NEMA SM 23 frame size '${frameSize}' or flange '${flange}'`);
    }
    const M_allow = frame[flange];

    const momentResultant = Math.sqrt(Mx * Mx + My * My + Mz * Mz);
    const utilization = momentResultant / M_allow;

    const components = [
      { name: 'Mx', actual: Mx },
      { name: 'My', actual: My },
      { name: 'Mz', actual: Mz }
    ].map((c) => ({
      name: c.name,
      type: 'moment',
      actual: c.actual,
      allowable: M_allow,
      utilization: Math.abs(c.actual) / M_allow,
      pass: Math.abs(c.actual) <= M_allow
    }));

    return {
      standard: 'NEMA SM 23',
      frameSize,
      flange,
      allowableMoment: M_allow,
      momentResultant,
      utilization,
      components,
      pass: momentResultant <= M_allow
    };
  }

  /**
   * Computes the spring hanger relief adjustment for a failed API 610
   * evaluation: the support load change needed to bring the worst failing
   * force component within its allowable.
   * @param {Object} evaluation Result of evaluateApi610
   * @returns {Object} { required, component, requiredReduction_N, adjustedActual_N }
   */
  static computeSpringHangerRelief(evaluation) {
    if (evaluation.pass) {
      return {
        required: false,
        component: null,
        requiredReduction_N: 0,
        adjustedActual_N: null,
        reason: 'nozzle already within allowables; no relief required'
      };
    }

    const failingForces = evaluation.components.filter((c) => c.type === 'force' && !c.pass);
    if (failingForces.length === 0) {
      return {
        required: false,
        component: null,
        requiredReduction_N: 0,
        adjustedActual_N: null,
        reason: 'worst failing component is a moment; a single support force cannot directly cancel a moment'
      };
    }

    const worst = failingForces.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    const requiredReduction_N = worst.actual - worst.allowable;

    return {
      required: true,
      component: worst.name,
      requiredReduction_N,
      adjustedActual_N: worst.allowable,
      reason: `support load adjustment of ${requiredReduction_N} N opposing ${worst.name} brings it to its allowable`
    };
  }
}

module.exports = {
  NozzleLoadEvaluator,
  API610_TABLE_5,
  NEMA_SM23_FRAMES,
  API610_SIZE_ORDER,
  NEMA_FRAME_ORDER
};
