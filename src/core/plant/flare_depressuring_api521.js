/**
 * API 521 Flare / Emergency Depressuring (Blowdown) Module.
 *
 * Implements:
 *  - Sonic and subsonic ideal-gas orifice / PSV flow to a flare header
 *    (choked flow when Pb/P <= (2/(gamma+1))^(gamma/(gamma-1))).
 *  - Dynamic vessel depressurization: dN/dt = -F_out with adiabatic
 *    (isentropic) cooling T2 = T1 (P2/P1)^((gamma-1)/gamma).
 *  - Minimum design metal temperature (MDMT) tracking of the vessel wall
 *    (instant wall-gas equilibrium by default, first-order thermal lag optional).
 *  - Flare header network balancing: given multiple relieving sources and a
 *    header capacity curve, iterate the header pressure balance to a
 *    converged common header pressure.
 *
 * Units (SI): Pa, m^3, K, kg/s, mol, kg/kmol.
 */

'use strict';

const R_GAS = 8.31446261815324;

function criticalPressureRatio(gamma) {
  if (gamma <= 1.0) gamma = 1.01;
  return Math.pow(2.0 / (gamma + 1.0), gamma / (gamma - 1.0));
}

function isentropicTemperature(initialPressurePa, initialTemperatureK, finalPressurePa, gamma) {
  if (initialPressurePa <= 0.0) throw new RangeError('initialPressurePa must be > 0');
  if (gamma <= 1.0) gamma = 1.01;
  return initialTemperatureK * Math.pow(Math.max(0.0, finalPressurePa) / initialPressurePa, (gamma - 1.0) / gamma);
}

/**
 * Ideal-gas orifice / PSV mass flow, sonic or subsonic.
 * @param {Object} p
 * @param {number} p.area Orifice flow area (m^2)
 * @param {number} p.upstreamPressure Vessel pressure (Pa)
 * @param {number} p.downstreamPressure Flare header backpressure (Pa)
 * @param {number} p.temperature Upstream gas temperature (K)
 * @param {number} p.molecularWeight Molar mass (kg/kmol)
 * @param {number} [p.gamma=1.4] Cp/Cv
 * @param {number} [p.dischargeCoefficient=0.85] Discharge coefficient Cd
 * @param {number} [p.compressibilityZ=1] Compressibility factor
 * @returns {{massFlowKgS:number, regime:string, pressureRatio:number, criticalRatio:number}}
 */
function orificeMassFlow(p) {
  const area = p.area;
  const pu = p.upstreamPressure;
  const pd = p.downstreamPressure;
  const T = p.temperature;
  const gamma = p.gamma || 1.4;
  const mw = p.molecularWeight;
  const cd = p.dischargeCoefficient !== undefined ? p.dischargeCoefficient : 0.85;
  const Z = p.compressibilityZ || 1.0;
  const cr = criticalPressureRatio(gamma);
  const pr = pd / pu;
  if (area <= 0.0 || pu <= pd || T <= 0.0 || mw <= 0.0) {
    return { massFlowKgS: 0.0, regime: 'none', pressureRatio: pr, criticalRatio: cr };
  }
  const rs = (R_GAS * 1000.0) / mw;
  const root = Math.sqrt(1.0 / (Z * rs * T));
  if (pr <= cr) {
    const term = Math.sqrt(gamma * Math.pow(2.0 / (gamma + 1.0), (gamma + 1.0) / (gamma - 1.0)));
    return { massFlowKgS: cd * area * pu * root * term, regime: 'sonic', pressureRatio: pr, criticalRatio: cr };
  }
  const k = (2.0 * gamma) / (gamma - 1.0);
  const inner = Math.max(0.0, Math.pow(pr, 2.0 / gamma) - Math.pow(pr, (gamma + 1.0) / gamma));
  return {
    massFlowKgS: cd * area * pu * root * Math.sqrt(k * inner),
    regime: 'subsonic',
    pressureRatio: pr,
    criticalRatio: cr
  };
}

class VesselDepressuringSimulator {
  constructor(spec) {
    this.volume = spec.volume;
    this.initialPressure = spec.initialPressure;
    this.initialTemperature = spec.initialTemperature;
    this.backpressure = spec.backpressure;
    this.molecularWeight = spec.molecularWeight;
    this.gamma = spec.gamma || 1.4;
    this.orificeArea = spec.orificeArea;
    this.dischargeCoefficient = spec.dischargeCoefficient !== undefined ? spec.dischargeCoefficient : 0.85;
    this.compressibilityZ = spec.compressibilityZ || 1.0;
    this.mdmtK = spec.mdmtK !== undefined ? spec.mdmtK : null;
    this.wallThermalLagS = spec.wallThermalLagS || 0.0;
  }

  /**
   * Integrate the depressurization transient (explicit first-order Euler).
   * @param {Object} [options]
   * @param {number} [options.timeStepS=0.25]
   * @param {number} [options.maxTimeS=3600]
   * @param {number} [options.targetPressure] Stop when P <= target (default 1.05*backpressure)
   * @returns {Object} Profile with series, MDMT result and regime transitions.
   */
  simulate(options = {}) {
    const dt = options.timeStepS || 0.25;
    const maxTime = options.maxTimeS || 3600.0;
    const target = options.targetPressure !== undefined ? options.targetPressure : this.backpressure * 1.05;
    if (dt <= 0.0) throw new RangeError('timeStepS must be > 0');

    let P = this.initialPressure;
    let T = this.initialTemperature;
    let wallT = this.initialTemperature;
    let N = (P * this.volume) / (R_GAS * T);
    let time = 0.0;
    let prevRegime = null;
    let mdmtCrossed = false;
    let mdmtCrossingTime = null;
    const regimeTransitions = [];
    const series = [];

    while (time < maxTime && P > target) {
      const flow = orificeMassFlow({
        area: this.orificeArea,
        upstreamPressure: P,
        downstreamPressure: this.backpressure,
        temperature: T,
        gamma: this.gamma,
        molecularWeight: this.molecularWeight,
        dischargeCoefficient: this.dischargeCoefficient,
        compressibilityZ: this.compressibilityZ
      });
      if (prevRegime === null) {
        prevRegime = flow.regime;
      } else if (flow.regime !== prevRegime) {
        regimeTransitions.push({ timeSeconds: time, from: prevRegime, to: flow.regime });
        prevRegime = flow.regime;
      }

      const dPdt = -(flow.massFlowKgS * 1000.0 * R_GAS * T) / (this.volume * this.molecularWeight);
      const Pnew = P + dPdt * dt;
      let Tnew;
      if (Pnew > 0.0) {
        Tnew = isentropicTemperature(P, T, Pnew, this.gamma);
      } else {
        Tnew = T * 1e-6;
      }
      P = Math.max(0.0, Pnew);
      T = Tnew;
      N = (P * this.volume) / (R_GAS * T);

      if (this.wallThermalLagS > 0.0) {
        wallT += (T - wallT) * (dt / this.wallThermalLagS);
      } else {
        wallT = T;
      }
      if (!mdmtCrossed && this.mdmtK !== null && wallT < this.mdmtK) {
        mdmtCrossed = true;
        mdmtCrossingTime = time + dt;
      }

      series.push({
        timeSeconds: time,
        pressurePa: P,
        temperatureK: T,
        wallTemperatureK: wallT,
        moles: N,
        massFlowKgS: flow.massFlowKgS,
        regime: flow.regime
      });
      time += dt;
    }

    return {
      initialPressurePa: this.initialPressure,
      finalPressurePa: P,
      finalTemperatureK: T,
      depressuredPa: target,
      elapsedSeconds: time,
      mdmt: {
        limitK: this.mdmtK,
        crossed: mdmtCrossed,
        crossingTimeS: mdmtCrossingTime,
        minimumWallTemperatureK: Math.min(...series.map((s) => s.wallTemperatureK))
      },
      regimeTransitions,
      series
    };
  }
}

/**
 * Balance a flare header network: find the common header pressure Pb such that
 * the sum of incoming source flows equals the header capacity flow at Pb.
 * F(Pb) = sum_i W_i(Pb) - Wcap(Pb); bisection on F (monotonic decreasing).
 * @param {Object} params
 * @param {Array<{flowAtBackpressure:Function}>} params.sources
 * @param {Function} params.headerCapacity Capacity flow (kg/s) vs Pb (Pa)
 * @param {number} [params.pbMin=0] Lower bracket (Pa)
 * @param {number} [params.pbMax=1e7] Upper bracket (Pa)
 * @param {number} [params.tolerancePa=1e-6] Pressure convergence tolerance (Pa)
 * @returns {{headerPressurePa:number, flows:number[], totalFlow:number, capacityFlow:number, residual:number, iterations:number}}
 */
function balanceFlareHeader(params) {
  const sources = params.sources;
  const capacity = params.headerCapacity;
  const tol = params.tolerancePa !== undefined ? params.tolerancePa : 1e-6;
  let lo = params.pbMin !== undefined ? params.pbMin : 0.0;
  let hi = params.pbMax !== undefined ? params.pbMax : 1e7;

  const F = (pb) => {
    let sum = 0.0;
    for (let i = 0; i < sources.length; i++) sum += sources[i].flowAtBackpressure(pb);
    return sum - capacity(pb);
  };

  let flo = F(lo);
  let fhi = F(hi);
  for (let i = 0; i < 64 && flo * fhi > 0.0; i++) {
    hi *= 2.0;
    fhi = F(hi);
  }
  if (flo * fhi > 0.0) throw new Error('flare header balance: no pressure bracket found');

  let iterations = 0;
  while (hi - lo > tol && iterations < 200) {
    const mid = (lo + hi) / 2.0;
    const fm = F(mid);
    if (flo * fm <= 0.0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
    iterations++;
  }
  const pb = (lo + hi) / 2.0;
  const flows = sources.map((s) => s.flowAtBackpressure(pb));
  const total = flows.reduce((a, b) => a + b, 0.0);
  return {
    headerPressurePa: pb,
    flows,
    totalFlow: total,
    capacityFlow: capacity(pb),
    residual: F(pb),
    iterations
  };
}

module.exports = {
  R_GAS,
  criticalPressureRatio,
  isentropicTemperature,
  orificeMassFlow,
  VesselDepressuringSimulator,
  balanceFlareHeader
};
