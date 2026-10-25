/**
 * OmniEng Pinch Analysis & Heat Exchanger Network (HEN) Synthesis Engine
 * 
 * Implements the Linnhoff Pinch Problem Table Algorithm:
 * 1. Temperature interval shifting: T_hot* = T_hot - DeltaT_min/2, T_cold* = T_cold + DeltaT_min/2.
 * 2. Interval enthalpy balance: Delta_H_i = sum (CP_cold - CP_hot) * (T_i - T_i+1).
 * 3. Heat cascade formulation to determine:
 *    - Pinch Temperature (T_pinch)
 *    - Minimum Hot Utility target (Q_H,min)
 *    - Minimum Cold Utility target (Q_C,min)
 *    - Maximum process-to-process heat recovery
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class PinchEnergyTargeter {
  /**
   * Evaluates minimum utility targets and pinch temperature.
   * 
   * @param {Array<{ type: 'hot'|'cold', Tin: number, Tout: number, mCp: number }>} streams
   * @param {number} [deltaTmin=10.0] - Minimum approach temperature difference (K)
   * @returns {{
   *   pinchTemperatureHotC: number,
   *   pinchTemperatureColdC: number,
   *   QHminKW: number,
   *   QCminKW: number,
   *   maxProcessRecoveryKW: number,
   *   intervals: Array<Object>
   * }}
   */
  static calculateTargets(streams, deltaTmin = 10.0) {
    const halfDeltaT = deltaTmin / 2.0;

    // 1. Shift temperatures
    const shiftedStreams = streams.map(s => {
      const isHot = s.type.toLowerCase() === 'hot';
      return {
        ...s,
        isHot,
        TinShifted: isHot ? s.Tin - halfDeltaT : s.Tin + halfDeltaT,
        ToutShifted: isHot ? s.Tout - halfDeltaT : s.Tout + halfDeltaT,
        TmaxShifted: Math.max(isHot ? s.Tin - halfDeltaT : s.Tin + halfDeltaT, isHot ? s.Tout - halfDeltaT : s.Tout + halfDeltaT),
        TminShifted: Math.min(isHot ? s.Tin - halfDeltaT : s.Tin + halfDeltaT, isHot ? s.Tout - halfDeltaT : s.Tout + halfDeltaT)
      };
    });

    // 2. Collect unique shifted interval temperatures sorted descending
    const tempSet = new Set();
    for (const s of shiftedStreams) {
      tempSet.add(s.TinShifted);
      tempSet.add(s.ToutShifted);
    }
    const temps = Array.from(tempSet).sort((a, b) => b - a);

    // 3. Enthalpy balance per interval
    const intervalDeltas = [];
    for (let i = 0; i < temps.length - 1; i++) {
      const T_high = temps[i];
      const T_low = temps[i + 1];
      const deltaT = T_high - T_low;

      let sumCpHot = 0.0;
      let sumCpCold = 0.0;

      for (const s of shiftedStreams) {
        if (s.TmaxShifted >= T_high && s.TminShifted <= T_low) {
          if (s.isHot) sumCpHot += s.mCp;
          else sumCpCold += s.mCp;
        }
      }

      // Delta H = (sum Cp_cold - sum Cp_hot) * deltaT
      const deltaH = (sumCpCold - sumCpHot) * deltaT;
      intervalDeltas.push({
        interval: i + 1,
        THigh: T_high,
        TLow: T_low,
        deltaT,
        deltaH
      });
    }

    // 4. Heat cascade formulation
    // Unfeasible cascade with Q_0 = 0
    let cascade = [0.0];
    for (let i = 0; i < intervalDeltas.length; i++) {
      const qNext = cascade[i] - intervalDeltas[i].deltaH;
      cascade.push(qNext);
    }

    // Find most negative heat flow
    const minHeat = Math.min(...cascade);
    const QHmin = minHeat < 0 ? -minHeat : 0.0;

    // Feasible cascade
    const feasibleCascade = cascade.map(q => q + QHmin);
    const QCmin = feasibleCascade[feasibleCascade.length - 1];

    // Find pinch point (where feasible heat cascade flow = 0)
    let pinchShifted = temps[0];
    for (let i = 0; i < feasibleCascade.length; i++) {
      if (Math.abs(feasibleCascade[i]) < 1e-6) {
        pinchShifted = temps[i];
        break;
      }
    }

    // Total enthalpy changes
    let totalHotEnthalpy = 0.0;
    let totalColdEnthalpy = 0.0;
    for (const s of streams) {
      const isHot = s.type.toLowerCase() === 'hot';
      const dH = s.mCp * Math.abs(s.Tin - s.Tout);
      if (isHot) totalHotEnthalpy += dH;
      else totalColdEnthalpy += dH;
    }

    const maxProcessRecovery = totalHotEnthalpy - (QCmin > 0 ? (totalHotEnthalpy + QHmin - totalColdEnthalpy) : 0);

    return {
      pinchTemperatureHotC: Number((pinchShifted + halfDeltaT).toFixed(2)),
      pinchTemperatureColdC: Number((pinchShifted - halfDeltaT).toFixed(2)),
      QHminKW: Number(QHmin.toFixed(2)),
      QCminKW: Number(QCmin.toFixed(2)),
      maxProcessRecoveryKW: Number((totalHotEnthalpy - (totalHotEnthalpy + QHmin - totalColdEnthalpy)).toFixed(2)),
      intervals: intervalDeltas
    };
  }
}

module.exports = {
  PinchEnergyTargeter
};
