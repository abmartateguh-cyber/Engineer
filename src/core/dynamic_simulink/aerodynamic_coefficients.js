/**
 * OmniEng Aircraft & UAV Aerodynamic Stability Derivative Engine
 * Standard: USAF DATCOM / Etkin Flight Dynamics Stability Derivatives
 * Experimental implementation: NASA JSBSim / MATLAB Aerospace Blockset longitudinal and lateral stability.
 */

class AerodynamicCoefficients {
  /**
   * Standard stability derivatives for light UAV / Fixed-Wing Drone.
   */
  static getStandardDroneAeroModel() {
    return {
      wingAreaS: 0.55,       // m^2
      wingSpanB: 1.8,        // m
      meanChordC: 0.31,      // m
      aspectRatioAR: 5.9,    // b^2 / S
      oswaldEfficiencyE: 0.82,
      massKg: 3.5,           // kg

      // Longitudinal Stability Derivatives
      CL0: 0.28,             // Lift at zero alpha
      CL_alpha: 4.85,        // Lift curve slope (1/rad)
      CL_q: 5.2,             // Pitch damping lift (1/rad)
      CL_delta_e: 0.42,      // Elevator lift control power (1/rad)

      CD0: 0.028,            // Zero-lift parasite drag coefficient
      CD_alpha: 0.30,        // Induced drag slope

      Cm0: 0.045,            // Pitch moment at zero alpha
      Cm_alpha: -0.65,       // Longitudinal static stability slope (must be < 0)
      Cm_q: -12.4,           // Pitch rate damping moment (must be < 0)
      Cm_delta_e: -1.15,     // Elevator pitch control effectiveness (1/rad)

      // Lateral-Directional Stability Derivatives
      CY_beta: -0.32,        // Sideforce slope due to sideslip
      CY_delta_r: 0.18,      // Rudder sideforce

      Cl_beta: -0.085,       // Roll moment due to sideslip (Dihedral effect, < 0)
      Cl_p: -0.45,           // Roll damping (< 0)
      Cl_r: 0.095,           // Roll due to yaw rate
      Cl_delta_a: 0.22,      // Aileron roll control power

      Cn_beta: 0.11,         // Directional weathercock stability (> 0)
      Cn_p: -0.035,          // Yaw due to roll rate
      Cn_r: -0.12,           // Yaw damping (< 0)
      Cn_delta_r: -0.075     // Rudder yaw control power
    };
  }

  constructor(customModel = {}) {
    const std = AerodynamicCoefficients.getStandardDroneAeroModel();
    this.model = {
      ...std,
      wingAreaS: customModel.wingAreaM2 || customModel.wingAreaS || std.wingAreaS,
      meanChordC: customModel.meanChordM || customModel.meanChordC || std.meanChordC,
      CL_alpha: customModel.cLalpha !== undefined ? customModel.cLalpha : std.CL_alpha,
      CD0: customModel.cD0 !== undefined ? customModel.cD0 : std.CD0,
      Cm_alpha: customModel.cmAlpha !== undefined ? customModel.cmAlpha : std.Cm_alpha,
      Cm_delta_e: customModel.cmDeltaE !== undefined ? customModel.cmDeltaE : std.Cm_delta_e,
      neutralPointX: customModel.neutralPointX !== undefined ? customModel.neutralPointX : 0.35,
      cgLocationX: customModel.cgLocationX !== undefined ? customModel.cgLocationX : 0.28,
      massKg: customModel.weightKg || customModel.massKg || std.massKg
    };
  }

  computeStaticMargin() {
    if (this.model.neutralPointX !== undefined && this.model.cgLocationX !== undefined && this.model.meanChordC) {
      return (this.model.neutralPointX - this.model.cgLocationX) / this.model.meanChordC;
    }
    return -(this.model.Cm_alpha / this.model.CL_alpha);
  }

  solveTrim(opts = {}) {
    const speed = opts.speedMs || opts.airspeedMs || 18.0;
    const alt = opts.altitudeM || 0.0;
    if (opts.weightKg) this.model.massKg = opts.weightKg;
    const res = AerodynamicCoefficients.solveTrimCondition(this.model, speed, alt);
    const forces = AerodynamicCoefficients.evaluateCoefficients(this.model, {
      alphaRad: (res.alphaTrimDeg * Math.PI) / 180.0,
      deltaE: (res.elevatorTrimDeg * Math.PI) / 180.0,
      Vinf: speed
    });
    return {
      ...res,
      liftN: forces.liftForceN,
      dragN: forces.dragForceN
    };
  }

  /**
   * Computes total aerodynamic force and moment coefficients in wind and body axes.
   * @param {Object} aeroModel Aero stability parameters
   * @param {Object} flightState
   *   alphaRad: Angle of attack (rad)
   *   betaRad: Sideslip angle (rad)
   *   Vinf: Airspeed (m/s)
   *   pRadS, qRadS, rRadS: Body angular rates (rad/s)
   *   deltaE, deltaA, deltaR: Control surface deflections (rad)
   */
  static evaluateCoefficients(aeroModel, flightState = {}) {
    const m = aeroModel;
    const {
      alphaRad = 0.05,
      betaRad = 0.0,
      Vinf = 18.0,
      pRadS = 0.0,
      qRadS = 0.0,
      rRadS = 0.0,
      deltaE = 0.0,
      deltaA = 0.0,
      deltaR = 0.0
    } = flightState;

    const V = Math.max(1.0, Vinf);
    const qHat = (qRadS * m.meanChordC) / (2.0 * V);
    const pHat = (pRadS * m.wingSpanB) / (2.0 * V);
    const rHat = (rRadS * m.wingSpanB) / (2.0 * V);

    // 1. Lift Coefficient CL
    const CL = m.CL0 + m.CL_alpha * alphaRad + m.CL_q * qHat + m.CL_delta_e * deltaE;

    // 2. Drag Coefficient CD (Parabolic drag polar: CD = CD0 + K * CL^2)
    const K = 1.0 / (Math.PI * m.oswaldEfficiencyE * m.aspectRatioAR);
    const CD = m.CD0 + K * (CL * CL) + m.CD_alpha * Math.abs(alphaRad);

    // 3. Pitching Moment Coefficient Cm
    const Cm = m.Cm0 + m.Cm_alpha * alphaRad + m.Cm_q * qHat + m.Cm_delta_e * deltaE;

    // 4. Side Force Coefficient CY
    const CY = m.CY_beta * betaRad + m.CY_delta_r * deltaR;

    // 5. Rolling Moment Coefficient Cl
    const Cl = m.Cl_beta * betaRad + m.Cl_p * pHat + m.Cl_r * rHat + m.Cl_delta_a * deltaA;

    // 6. Yawing Moment Coefficient Cn
    const Cn = m.Cn_beta * betaRad + m.Cn_p * pHat + m.Cn_r * rHat + m.Cn_delta_r * deltaR;

    // Static Margin: Kn = -Cm_alpha / CL_alpha
    const staticMargin = -(m.Cm_alpha / m.CL_alpha);

    // Dynamic Pressure q_inf = 0.5 * rho * V^2 (rho = 1.225 kg/m^3 sea level)
    const rho = 1.225;
    const qInf = 0.5 * rho * V * V;

    const liftForceN = CL * qInf * m.wingAreaS;
    const dragForceN = CD * qInf * m.wingAreaS;
    const pitchMomentNm = Cm * qInf * m.wingAreaS * m.meanChordC;

    return {
      CL: Number(CL.toFixed(4)),
      CD: Number(CD.toFixed(4)),
      Cm: Number(Cm.toFixed(4)),
      CY: Number(CY.toFixed(4)),
      Cl: Number(Cl.toFixed(4)),
      Cn: Number(Cn.toFixed(4)),
      liftToDragRatio: Number((CL / Math.max(1e-4, CD)).toFixed(2)),
      staticMargin: Number(staticMargin.toFixed(3)),
      isPitchStaticallyStable: m.Cm_alpha < 0,
      isYawStaticallyStable: m.Cn_beta > 0,
      liftForceN: Number(liftForceN.toFixed(2)),
      dragForceN: Number(dragForceN.toFixed(2)),
      pitchMomentNm: Number(pitchMomentNm.toFixed(3))
    };
  }

  /**
   * Solves the level unaccelerated flight trim condition:
   * Finds alpha_trim and elevator delta_e_trim such that Lift = Weight and Pitch Moment = 0.
   */
  static solveTrimCondition(aeroModel, airspeedMs = 18.0, altitudeM = 100.0) {
    const m = aeroModel;
    const g = 9.80665;
    const weightN = m.massKg * g;

    // Air density at altitude: rho = rho0 * exp(-alt / 8500)
    const rho = 1.225 * Math.exp(-altitudeM / 8500.0);
    const qInf = 0.5 * rho * airspeedMs * airspeedMs;

    // Required trim lift coefficient: CL_req = W / (q * S)
    const CL_req = weightN / (qInf * m.wingAreaS);

    // Solve 2x2 linear system:
    // [ CL_alpha    CL_delta_e ] [ alpha   ] = [ CL_req - CL0 ]
    // [ Cm_alpha    Cm_delta_e ] [ delta_e ] = [       - Cm0 ]
    const a11 = m.CL_alpha, a12 = m.CL_delta_e;
    const a21 = m.Cm_alpha, a22 = m.Cm_delta_e;

    const b1 = CL_req - m.CL0;
    const b2 = -m.Cm0;

    const det = a11 * a22 - a12 * a21;
    if (Math.abs(det) < 1e-6) {
      return null;
    }

    const alphaTrimRad = (b1 * a22 - b2 * a12) / det;
    const deltaETrimRad = (a11 * b2 - a21 * b1) / det;

    const alphaTrimDeg = (alphaTrimRad * 180.0) / Math.PI;
    const deltaETrimDeg = (deltaETrimRad * 180.0) / Math.PI;

    return {
      airspeedMs,
      weightN: Number(weightN.toFixed(1)),
      requiredCL: Number(CL_req.toFixed(4)),
      alphaTrimDeg: Number(alphaTrimDeg.toFixed(2)),
      elevatorTrimDeg: Number(deltaETrimDeg.toFixed(2)),
      isTrimPossible: Math.abs(alphaTrimDeg) < 15.0 && Math.abs(deltaETrimDeg) < 25.0
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AerodynamicCoefficients };
}
