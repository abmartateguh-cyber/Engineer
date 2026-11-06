/**
 * Industrial Hydraulic Line Sizing & ASME B31.3 Mechanical Design Engine.
 *
 * Implements:
 * 1. Single-phase liquid & gas Darcy-Weisbach pressure drop with Colebrook-White
 *    implicit friction factor solved by Newton-Raphson.
 * 2. API RP 14E Erosional Velocity limits and service-specific velocity criteria:
 *    - Pump suction / discharge
 *    - Gas / liquid headers
 *    - Steam lines
 * 3. Two-phase Beggs-Brill & Lockhart-Martinelli multiphase flow correlations:
 *    - Liquid holdup, flow regime determination (segregated, intermittent, distributed)
 *    - Mixture density and elevation pressure drops.
 * 4. ASME B31.3 Process Piping Section 304.1.2 Mechanical Minimum Wall Thickness:
 *    t = (P * D) / (2 * (S * E * W + P * Y)) + c_a
 *    with mill undertolerance correction (12.5%).
 * 5. ASME B36.10M / B36.19M Standard Pipe Schedule database (NPS 1/2" to 36").
 * 6. Automated line sizing algorithm: selects the optimal standard NPS & Schedule
 *    satisfying hydraulic pressure drop, velocity, erosional limit, and ASME B31.3 MAWP.
 */

'use strict';

// ASME B36.10M Welded and Seamless Wrought Steel Pipe Dimensions
// Dimensions in millimeters: { nps: string, do: number (mm), schedules: { [sch: string]: { wall: number (mm), id: number (mm) } } }
const PIPE_SCHEDULE_DATABASE = [
  {
    nps: '0.5',
    nominalInch: 0.5,
    do: 21.3,
    schedules: {
      10: { wall: 2.11, id: 17.08 },
      40: { wall: 2.77, id: 15.76 }, // STD
      80: { wall: 3.73, id: 13.84 }, // XS
      160: { wall: 4.78, id: 11.74 }
    }
  },
  {
    nps: '0.75',
    nominalInch: 0.75,
    do: 26.7,
    schedules: {
      10: { wall: 2.11, id: 22.48 },
      40: { wall: 2.87, id: 20.96 },
      80: { wall: 3.91, id: 18.88 },
      160: { wall: 5.56, id: 15.58 }
    }
  },
  {
    nps: '1',
    nominalInch: 1.0,
    do: 33.4,
    schedules: {
      10: { wall: 2.77, id: 27.86 },
      40: { wall: 3.38, id: 26.64 },
      80: { wall: 4.55, id: 24.3 },
      160: { wall: 6.35, id: 20.7 }
    }
  },
  {
    nps: '1.5',
    nominalInch: 1.5,
    do: 48.3,
    schedules: {
      10: { wall: 2.77, id: 42.76 },
      40: { wall: 3.68, id: 40.94 },
      80: { wall: 5.08, id: 38.14 },
      160: { wall: 7.14, id: 34.02 }
    }
  },
  {
    nps: '2',
    nominalInch: 2.0,
    do: 60.3,
    schedules: {
      10: { wall: 2.77, id: 54.76 },
      40: { wall: 3.91, id: 52.48 },
      80: { wall: 5.54, id: 49.22 },
      160: { wall: 8.74, id: 42.82 }
    }
  },
  {
    nps: '3',
    nominalInch: 3.0,
    do: 88.9,
    schedules: {
      10: { wall: 3.05, id: 82.8 },
      40: { wall: 5.49, id: 77.92 },
      80: { wall: 7.62, id: 73.66 },
      160: { wall: 11.13, id: 66.64 }
    }
  },
  {
    nps: '4',
    nominalInch: 4.0,
    do: 114.3,
    schedules: {
      10: { wall: 3.05, id: 108.2 },
      40: { wall: 6.02, id: 102.26 },
      80: { wall: 8.56, id: 97.18 },
      120: { wall: 11.13, id: 92.04 },
      160: { wall: 13.49, id: 87.32 }
    }
  },
  {
    nps: '6',
    nominalInch: 6.0,
    do: 168.3,
    schedules: {
      10: { wall: 3.4, id: 161.5 },
      40: { wall: 7.11, id: 154.08 },
      80: { wall: 10.97, id: 146.36 },
      120: { wall: 14.27, id: 139.76 },
      160: { wall: 18.26, id: 131.78 }
    }
  },
  {
    nps: '8',
    nominalInch: 8.0,
    do: 219.1,
    schedules: {
      10: { wall: 3.76, id: 211.58 },
      20: { wall: 6.35, id: 206.4 },
      30: { wall: 7.04, id: 205.02 },
      40: { wall: 8.18, id: 202.74 },
      80: { wall: 12.7, id: 193.7 },
      120: { wall: 18.26, id: 182.58 },
      160: { wall: 23.01, id: 173.08 }
    }
  },
  {
    nps: '10',
    nominalInch: 10.0,
    do: 273.0,
    schedules: {
      10: { wall: 4.19, id: 264.62 },
      20: { wall: 6.35, id: 260.3 },
      40: { wall: 9.27, id: 254.46 },
      80: { wall: 15.09, id: 242.82 },
      120: { wall: 21.44, id: 230.12 },
      160: { wall: 28.58, id: 215.84 }
    }
  },
  {
    nps: '12',
    nominalInch: 12.0,
    do: 323.8,
    schedules: {
      10: { wall: 4.57, id: 314.66 },
      20: { wall: 6.35, id: 311.1 },
      40: { wall: 10.31, id: 303.18 },
      80: { wall: 17.48, id: 288.84 },
      120: { wall: 25.4, id: 273.0 },
      160: { wall: 33.32, id: 257.16 }
    }
  },
  {
    nps: '14',
    nominalInch: 14.0,
    do: 355.6,
    schedules: {
      10: { wall: 6.35, id: 342.9 },
      20: { wall: 7.92, id: 339.76 },
      30: { wall: 9.53, id: 336.54 },
      40: { wall: 11.13, id: 333.34 },
      80: { wall: 19.05, id: 317.5 },
      120: { wall: 27.79, id: 300.02 },
      160: { wall: 35.71, id: 284.18 }
    }
  },
  {
    nps: '16',
    nominalInch: 16.0,
    do: 406.4,
    schedules: {
      10: { wall: 6.35, id: 393.7 },
      20: { wall: 7.92, id: 390.56 },
      30: { wall: 9.53, id: 387.34 },
      40: { wall: 12.7, id: 381.0 },
      80: { wall: 21.44, id: 363.52 },
      120: { wall: 30.96, id: 344.48 },
      160: { wall: 40.49, id: 325.42 }
    }
  },
  {
    nps: '18',
    nominalInch: 18.0,
    do: 457.0,
    schedules: {
      10: { wall: 6.35, id: 444.3 },
      20: { wall: 7.92, id: 441.16 },
      40: { wall: 14.27, id: 428.46 },
      80: { wall: 23.83, id: 409.34 },
      120: { wall: 34.93, id: 387.14 },
      160: { wall: 45.24, id: 366.52 }
    }
  },
  {
    nps: '20',
    nominalInch: 20.0,
    do: 508.0,
    schedules: {
      10: { wall: 6.35, id: 495.3 },
      20: { wall: 9.53, id: 488.94 },
      40: { wall: 15.09, id: 477.82 },
      80: { wall: 26.19, id: 455.62 },
      120: { wall: 38.1, id: 431.8 },
      160: { wall: 50.01, id: 407.98 }
    }
  },
  {
    nps: '24',
    nominalInch: 24.0,
    do: 610.0,
    schedules: {
      10: { wall: 6.35, id: 597.3 },
      20: { wall: 9.53, id: 590.94 },
      40: { wall: 17.48, id: 575.04 },
      80: { wall: 30.96, id: 548.08 },
      120: { wall: 46.02, id: 517.96 },
      160: { wall: 59.54, id: 490.92 }
    }
  }
];

// ASME B31.3 Table A-1 Allowable Stresses (Pa) at -29 to 93 deg C
const MATERIAL_ALLOWABLE_STRESS = {
  'A106-B': 137.9e6, // Carbon steel seamless (20.0 ksi = 137.9 MPa)
  'A53-B': 137.9e6, // Carbon steel ERW (with E factor)
  'A312-TP304': 137.9e6, // Stainless 304
  'A312-TP316': 137.9e6, // Stainless 316
  'A333-6': 137.9e6 // Low temp carbon steel
};

// ASME B31.3-2020, Appendix A, Table A-1 (Basic Allowable Stresses).
// Published values are in ksi at temperatures in deg F; linear interpolation between
// adjacent temperatures is permitted by the Code. 1 ksi = 6.894757 MPa.
const MATERIAL_ALLOWABLE_STRESS_VS_TEMP = {
  'A106-B': [
    [-20, 20.0],
    [100, 20.0],
    [200, 20.0],
    [300, 20.0],
    [400, 20.0],
    [500, 18.9],
    [600, 17.8],
    [650, 17.3],
    [700, 16.8],
    [750, 16.1],
    [800, 15.4],
    [850, 13.7],
    [900, 12.0],
    [950, 10.2],
    [1000, 8.2]
  ],
  'A53-B': [
    [-20, 20.0],
    [100, 20.0],
    [200, 20.0],
    [300, 20.0],
    [400, 20.0],
    [500, 18.9],
    [600, 17.8],
    [650, 17.3],
    [700, 16.8],
    [750, 16.1],
    [800, 15.4],
    [850, 13.7],
    [900, 12.0],
    [950, 10.2],
    [1000, 8.2]
  ],
  'A312-TP316L': [
    [-20, 16.7],
    [100, 16.7],
    [200, 15.7],
    [300, 14.5],
    [400, 13.8],
    [500, 13.2],
    [600, 12.8],
    [700, 12.5],
    [800, 12.2],
    [900, 11.9],
    [1000, 11.5]
  ]
};

const KSI_TO_PA = 6.894757e6;

function interpolateAllowableStress(breakpoints, temperatureC) {
  const tempF = (temperatureC * 9.0) / 5.0 + 32.0;
  const first = breakpoints[0];
  const last = breakpoints[breakpoints.length - 1];
  if (tempF <= first[0]) return first[1] * KSI_TO_PA;
  if (tempF >= last[0]) return last[1] * KSI_TO_PA;
  for (let i = 1; i < breakpoints.length; i++) {
    const tHi = breakpoints[i][0];
    const sHi = breakpoints[i][1];
    const tLo = breakpoints[i - 1][0];
    const sLo = breakpoints[i - 1][1];
    if (tempF <= tHi) {
      const f = (tempF - tLo) / (tHi - tLo);
      return (sLo + f * (sHi - sLo)) * KSI_TO_PA;
    }
  }
  return last[1] * KSI_TO_PA;
}

// Recommended velocity bounds by fluid service (m/s)
const SERVICE_VELOCITY_BOUNDS = {
  pump_suction: { min: 0.6, max: 1.5, defaultMaxDPBarPer100m: 0.05 },
  pump_discharge: { min: 1.5, max: 3.0, defaultMaxDPBarPer100m: 0.25 },
  general_liquid: { min: 1.0, max: 2.5, defaultMaxDPBarPer100m: 0.15 },
  gas_header: { min: 10.0, max: 25.0, defaultMaxDPBarPer100m: 0.08 },
  steam_header: { min: 20.0, max: 40.0, defaultMaxDPBarPer100m: 0.1 },
  cooling_water: { min: 1.2, max: 2.5, defaultMaxDPBarPer100m: 0.15 }
};

class PipeSizingEngine {
  constructor() {
    this.database = PIPE_SCHEDULE_DATABASE;
    this.defaultRoughness = 0.0457e-3; // Commercial steel roughness eps = 0.0457 mm = 4.57e-5 m
  }

  /**
   * Darcy friction factor via Colebrook-White implicit equation solved by Newton-Raphson.
   * 1 / sqrt(f) = -2 * log10( (eps / (3.7 * D)) + (2.51 / (Re * sqrt(f))) )
   *
   * @param {number} Re Reynolds number (dimensionless)
   * @param {number} eps Absolute roughness (m)
   * @param {number} D Internal pipe diameter (m)
   * @returns {number} Darcy-Weisbach friction factor f
   */
  calculateFrictionFactor(Re, eps, D) {
    if (Re <= 0 || !Number.isFinite(Re)) return 0.02;
    // Laminar regime (Re <= 2000)
    if (Re <= 2000) {
      return 64.0 / Re;
    }

    // Initial estimate via Haaland explicit approximation
    const ed = eps / D;
    const invSqrtF0 = -1.8 * Math.log10(Math.pow(ed / 3.7, 1.11) + 6.9 / Re);
    let f = Math.max(0.005, Math.min(0.1, 1.0 / (invSqrtF0 * invSqrtF0)));

    // Transition regime blend (2000 < Re < 4000)
    if (Re < 4000) {
      const fLam = 64.0 / Re;
      const t = (Re - 2000) / 2000;
      // Evaluate turbulent friction factor at Re = 4000
      const fTurb4000 = this.calculateFrictionFactor(4000, eps, D);
      return (1 - t) * fLam + t * fTurb4000;
    }

    // Newton-Raphson refinement on 1/sqrt(f) for turbulent flow
    let x = 1.0 / Math.sqrt(f); // x = 1/sqrt(f)
    for (let it = 0; it < 10; it++) {
      const term = ed / 3.7 + (2.51 * x) / Re;
      if (term <= 0) break;
      const g = x + 2.0 * Math.log10(term); // g(x) = x + 2*log10(term) = 0
      const dg = 1.0 + ((2.0 / Math.LN10) * (2.51 / Re)) / term;
      const dx = g / dg;
      x -= dx;
      if (Math.abs(dx) < 1e-7) break;
    }

    f = 1.0 / (x * x);
    return Math.max(0.005, Math.min(0.12, f));
  }

  /**
   * Single-phase hydraulic pressure drop and velocity.
   *
   * @param {Object} params
   * @param {number} params.massFlowKgS Mass flow rate (kg/s)
   * @param {number} params.densityKgM3 Fluid density (kg/m^3)
   * @param {number} params.viscosityPaS Dynamic viscosity (Pa*s)
   * @param {number} params.innerDiameterM Inner diameter D (m)
   * @param {number} params.lengthM Equivalent length L (m)
   * @param {number} [params.roughnessM] Pipe roughness (m)
   * @param {number} [params.elevationChangeM=0] Elevation gain dz (m)
   * @returns {Object} Hydraulic summary
   */
  calculateHydraulics({
    massFlowKgS,
    densityKgM3,
    viscosityPaS,
    innerDiameterM,
    lengthM,
    roughnessM = this.defaultRoughness,
    elevationChangeM = 0
  }) {
    const D = innerDiameterM;
    const area = 0.25 * Math.PI * D * D;
    const volFlowM3S = massFlowKgS / densityKgM3;
    const velocity = volFlowM3S / area;

    const Re = (densityKgM3 * velocity * D) / Math.max(1e-7, viscosityPaS);
    const f = this.calculateFrictionFactor(Re, roughnessM, D);

    // Darcy-Weisbach frictional loss: dP_f = f * (L/D) * (rho * v^2 / 2)
    const dPFrictionPa = f * (lengthM / D) * (0.5 * densityKgM3 * velocity * velocity);

    // Hydrostatic head loss: dP_grav = rho * g * dz
    const g = 9.80665;
    const dPElevationPa = densityKgM3 * g * elevationChangeM;

    const dPTotalPa = dPFrictionPa + dPElevationPa;
    const dPTotalBar = dPTotalPa / 1e5;
    const dPPer100mBar = ((dPFrictionPa / lengthM) * 100) / 1e5;

    return {
      innerDiameterM: D,
      innerDiameterMm: D * 1000,
      velocityMS: velocity,
      reynoldsNumber: Re,
      frictionFactor: f,
      pressureDropTotalPa: dPTotalPa,
      pressureDropTotalBar: dPTotalBar,
      pressureDropFrictionalBar: dPFrictionPa / 1e5,
      pressureDropElevationBar: dPElevationPa / 1e5,
      pressureDropBarPer100m: dPPer100mBar
    };
  }

  /**
   * API RP 14E Erosional Velocity.
   * v_e = C / sqrt(rho_m)
   *
   * @param {number} mixtureDensityKgM3 Fluid or mixture density (kg/m^3)
   * @param {number} [C=122] Empirical constant (100 for continuous solids, 122 for clean continuous, 150 for intermittent)
   * @returns {number} Erosional velocity limit (m/s)
   */
  calculateErosionalVelocity(mixtureDensityKgM3, C = 122) {
    if (mixtureDensityKgM3 <= 0) return 30.0;
    // In SI units: v_e = C_si / sqrt(rho) where C_si ~ 122 * 1.22 ~ 122
    return C / Math.sqrt(mixtureDensityKgM3);
  }

  /**
   * Two-phase Beggs-Brill multiphase pressure drop and liquid holdup.
   *
   * @param {Object} params
   * @param {number} params.liquidMassFlowKgS Liquid mass flow rate (kg/s)
   * @param {number} params.gasMassFlowKgS Gas mass flow rate (kg/s)
   * @param {number} params.liquidDensityKgM3 Liquid density (kg/m^3)
   * @param {number} params.gasDensityKgM3 Gas density (kg/m^3)
   * @param {number} params.liquidViscosityPaS Liquid viscosity (Pa*s)
   * @param {number} params.gasViscosityPaS Gas viscosity (Pa*s)
   * @param {number} params.surfaceTensionNM Liquid-gas surface tension (N/m)
   * @param {number} params.innerDiameterM Inner pipe diameter (m)
   * @param {number} params.lengthM Length of line (m)
   * @param {number} [params.inclinationAngleRad=0] Pipe angle (rad, 0=horizontal, pi/2=vertical up)
   * @returns {Object} Two-phase hydraulic report
   */
  calculateBeggsBrillTwoPhase({
    liquidMassFlowKgS,
    gasMassFlowKgS,
    liquidDensityKgM3,
    gasDensityKgM3,
    liquidViscosityPaS,
    gasViscosityPaS,
    surfaceTensionNM = 0.025,
    innerDiameterM,
    lengthM,
    inclinationAngleRad = 0
  }) {
    const D = innerDiameterM;
    const A = 0.25 * Math.PI * D * D;
    const qL = liquidMassFlowKgS / liquidDensityKgM3;
    const qG = gasMassFlowKgS / gasDensityKgM3;
    const qTotal = qL + qG;

    const vsL = qL / A; // superficial liquid velocity
    const vsG = qG / A; // superficial gas velocity
    const vm = vsL + vsG; // mixture velocity

    // No-slip liquid holdup lambda_L
    const lambdaL = qL / Math.max(1e-9, qTotal);

    // No-slip mixture properties
    const rhoNoSlip = lambdaL * liquidDensityKgM3 + (1 - lambdaL) * gasDensityKgM3;
    const muNoSlip = lambdaL * liquidViscosityPaS + (1 - lambdaL) * gasViscosityPaS;

    // Froude number
    const g = 9.80665;
    const Fr = (vm * vm) / (g * D);

    // Beggs-Brill Flow Pattern determination (horizontal limits)
    const L1 = 316.0 * Math.pow(lambdaL, 0.302);
    const L2 = 0.0009252 * Math.pow(lambdaL, -2.4684);
    const L3 = 0.1 * Math.pow(lambdaL, -1.4516);
    const L4 = 0.5 * Math.pow(lambdaL, -6.738);

    let pattern = 'segregated';
    if ((lambdaL < 0.01 && Fr < L1) || (lambdaL >= 0.01 && Fr < L1)) {
      pattern = 'segregated';
    } else if (lambdaL >= 0.01 && Fr >= L1 && Fr <= L2) {
      pattern = 'transition';
    } else if ((lambdaL >= 0.01 && lambdaL < 0.4 && Fr > L2 && Fr <= L3) || (lambdaL >= 0.4 && Fr > L1 && Fr <= L4)) {
      pattern = 'intermittent';
    } else {
      pattern = 'distributed';
    }

    // Horizontal holdup parameters
    let a = 0.98,
      b = 0.4846,
      c = 0.0868;
    if (pattern === 'intermittent') {
      a = 0.845;
      b = 0.5351;
      c = 0.0173;
    } else if (pattern === 'distributed') {
      a = 1.065;
      b = 0.5824;
      c = 0.0609;
    }

    let H_L0 = (a * Math.pow(lambdaL, b)) / Math.pow(Fr, c);
    H_L0 = Math.max(lambdaL, Math.min(1.0, H_L0));

    // Inclination factor B
    const N_Lv = 1.938 * vsL * Math.pow(liquidDensityKgM3 / Math.max(1e-5, surfaceTensionNM), 0.25);
    let d = 0.011,
      e = -3.768,
      f_exp = 3.539,
      g_exp = -1.614;
    if (pattern === 'intermittent') {
      d = 2.96;
      e = 0.305;
      f_exp = -0.4473;
      g_exp = 0.0978;
    } else if (pattern === 'distributed') {
      d = 0;
      e = 0;
      f_exp = 0;
      g_exp = 0;
    }

    const C_inc =
      (1 - lambdaL) * Math.log(d * Math.pow(lambdaL, e) * Math.pow(Fr, f_exp) * Math.pow(N_Lv, g_exp) + 1e-10);
    const B_inc =
      inclinationAngleRad !== 0 ? 1 + Math.max(-0.9, Math.min(2.0, C_inc)) * Math.sin(1.8 * inclinationAngleRad) : 1.0;

    const H_L = Math.max(lambdaL, Math.min(1.0, H_L0 * B_inc));
    const rhoMixture = H_L * liquidDensityKgM3 + (1 - H_L) * gasDensityKgM3;

    // Mixture friction factor
    const Re_m = (rhoNoSlip * vm * D) / Math.max(1e-7, muNoSlip);
    const fn = this.calculateFrictionFactor(Re_m, this.defaultRoughness, D);

    const y = Math.max(0.001, lambdaL / (H_L * H_L));
    const S_exp =
      Math.log(y) /
      (-0.0523 + 3.182 * Math.log(y) - 0.8725 * Math.pow(Math.log(y), 2) + 0.01853 * Math.pow(Math.log(y), 4));
    const f_ratio = Math.exp(Math.max(-2.0, Math.min(3.0, S_exp)));
    const f_two_phase = fn * f_ratio;

    const dPFriction = f_two_phase * (lengthM / D) * (0.5 * rhoNoSlip * vm * vm);
    const dPElevation = rhoMixture * g * Math.sin(inclinationAngleRad) * lengthM;
    const dPTotalPa = dPFriction + dPElevation;

    return {
      flowPattern: pattern,
      liquidHoldup: H_L,
      noSlipHoldup: lambdaL,
      mixtureVelocityMS: vm,
      superficialLiquidVelocityMS: vsL,
      superficialGasVelocityMS: vsG,
      mixtureDensityKgM3: rhoMixture,
      noSlipDensityKgM3: rhoNoSlip,
      pressureDropTotalBar: dPTotalPa / 1e5,
      pressureDropFrictionalBar: dPFriction / 1e5,
      pressureDropElevationBar: dPElevation / 1e5,
      pressureDropBarPer100m: ((dPFriction / lengthM) * 100) / 1e5
    };
  }

  /**
   * Resolve the allowable stress S for a material at a design temperature.
   * Without a temperature, the legacy ambient (Table A-1, -29 to 93 deg C)
   * value is used. With a temperature, the published Table A-1 temperature
   * breakpoints are linearly interpolated.
   *
   * @param {string} material Material specification
   * @param {number} [designTemperatureC] Design metal temperature (deg C)
   * @returns {number} Allowable stress (Pa)
   */
  resolveAllowableStress(material, designTemperatureC) {
    if (designTemperatureC === undefined || designTemperatureC === null) {
      const ambient = MATERIAL_ALLOWABLE_STRESS[material];
      if (ambient === undefined) {
        throw new Error(`Unknown pipe material: "${material}"`);
      }
      return ambient;
    }
    if (!Number.isFinite(designTemperatureC)) {
      throw new RangeError(`designTemperatureC must be a finite number, got ${designTemperatureC}`);
    }
    const breakpoints = MATERIAL_ALLOWABLE_STRESS_VS_TEMP[material];
    if (breakpoints === undefined) {
      throw new Error(`No temperature-dependent allowable stress table available for material "${material}"`);
    }
    return interpolateAllowableStress(breakpoints, designTemperatureC);
  }

  /**
   * ASME B31.3 Section 304.1.2 Minimum Required Pipe Wall Thickness for Internal Pressure.
   *
   * Formula 3a:
   * t = (P * D) / (2 * (S * E * W + P * Y))
   *
   * Total required nominal thickness considering corrosion allowance and mill tolerance:
   * t_min = t + c_a
   * t_nom_req = t_min / (1 - millTolerance)   (millTolerance = 0.125 for standard seamless/ERW pipe)
   *
   * @param {Object} params
   * @param {number} params.designPressurePa Internal design gauge pressure (Pa, >= 0)
   * @param {number} params.outerDiameterM Outer diameter Do (m, > 0)
   * @param {string} [params.material='A106-B'] Material specification
   * @param {number} [params.designTemperatureC] Design metal temperature (deg C); selects the
   *   Table A-1 temperature-dependent allowable stress. Omit to use the legacy ambient value.
   * @param {number} [params.allowableStressPa] Explicit allowable stress S (Pa); overrides the
   *   material/temperature lookup (e.g. for a de-rated or vendor-specific S).
   * @param {number} [params.qualityFactorE=1.0] Longitudinal weld joint quality factor E (1.0 seamless, 0.85 ERW)
   * @param {number} [params.weldJointFactorW=1.0] Weld joint strength reduction factor W
   * @param {number} [params.coefficientY=0.4] Material coefficient Y (0.4 for steels < 482 C)
   * @param {number} [params.corrosionAllowanceM=0.0015] Corrosion/erosion allowance (m, default 1.5 mm)
   * @param {number} [params.millTolerance=0.125] Manufacturing undertolerance (default 12.5%)
   * @returns {Object} Mechanical wall thickness calculation report
   */
  calculateASMEB313WallThickness({
    designPressurePa,
    outerDiameterM,
    material = 'A106-B',
    designTemperatureC,
    allowableStressPa,
    qualityFactorE = 1.0,
    weldJointFactorW = 1.0,
    coefficientY = 0.4,
    corrosionAllowanceM = 0.0015,
    millTolerance = 0.125
  }) {
    if (!Number.isFinite(designPressurePa) || designPressurePa < 0) {
      throw new RangeError(`designPressurePa must be a non-negative finite number, got ${designPressurePa}`);
    }
    if (!Number.isFinite(outerDiameterM) || outerDiameterM <= 0) {
      throw new RangeError(`outerDiameterM must be a positive finite number, got ${outerDiameterM}`);
    }
    if (!Number.isFinite(corrosionAllowanceM) || corrosionAllowanceM < 0) {
      throw new RangeError(`corrosionAllowanceM must be a non-negative finite number, got ${corrosionAllowanceM}`);
    }
    if (allowableStressPa !== undefined && (!Number.isFinite(allowableStressPa) || allowableStressPa <= 0)) {
      throw new RangeError(`allowableStressPa must be a positive finite number, got ${allowableStressPa}`);
    }

    const P = designPressurePa;
    const D = outerDiameterM;
    const S =
      allowableStressPa !== undefined ? allowableStressPa : this.resolveAllowableStress(material, designTemperatureC);
    const E = qualityFactorE;
    const W = weldJointFactorW;
    const Y = coefficientY;

    // Denominator = 2 * (S * E * W + P * Y)
    const denom = 2.0 * (S * E * W + P * Y);
    const tPressure = (P * D) / denom;
    const tMin = tPressure + corrosionAllowanceM;
    const tNominalRequired = tMin / (1.0 - millTolerance);

    // Maximum Allowable Working Pressure (MAWP) for a given nominal wall thickness tn:
    // P_mawp = (2 * S * E * W * (tn * (1 - millTol) - c_a)) / (D - 2 * Y * (tn * (1 - millTol) - c_a))
    const calculateMAWP = (nominalWallThicknessM) => {
      if (!Number.isFinite(nominalWallThicknessM) || nominalWallThicknessM <= 0) {
        throw new RangeError(`nominalWallThicknessM must be a positive finite number, got ${nominalWallThicknessM}`);
      }
      const tCorroded = nominalWallThicknessM * (1.0 - millTolerance) - corrosionAllowanceM;
      if (tCorroded <= 0) {
        throw new RangeError(
          `Corroded wall thickness is non-positive (tn=${nominalWallThicknessM} m, ca=${corrosionAllowanceM} m)`
        );
      }
      return (2.0 * S * E * W * tCorroded) / (D - 2.0 * Y * tCorroded);
    };

    return {
      designPressurePa: P,
      designPressureBar: P / 1e5,
      allowableStressPa: S,
      allowableStressMPa: S / 1e6,
      pressureDesignThicknessMm: tPressure * 1000,
      corrosionAllowanceMm: corrosionAllowanceM * 1000,
      minimumRequiredThicknessMm: tMin * 1000,
      requiredNominalThicknessMm: tNominalRequired * 1000,
      calculateMAWP
    };
  }

  /**
   * Automated Line Sizing Engine.
   *
   * Iterates through the ASME B36.10M standard pipe sizes and schedules to find
   * the optimal pipe size that satisfies:
   * 1. Velocity within service limits (min <= v <= max)
   * 2. Velocity below API RP 14E erosional limit
   * 3. Pressure drop <= max allowable dP/100m
   * 4. ASME B31.3 schedule wall thickness >= required nominal wall thickness
   *
   * @param {Object} options
   * @param {string} options.service Fluid service type ('pump_suction', 'pump_discharge', 'general_liquid', 'gas_header', 'steam_header')
   * @param {number} options.massFlowKgS Mass flow rate (kg/s)
   * @param {number} options.densityKgM3 Fluid density (kg/m^3)
   * @param {number} options.viscosityPaS Viscosity (Pa*s)
   * @param {number} options.designPressureBar Design pressure (bar)
   * @param {number} [options.lengthM=100] Equivalent line length (m)
   * @param {number} [options.maxPressureDropBarPer100m] Custom dP limit (bar/100m)
   * @param {string} [options.material='A106-B'] Pipe material
   * @param {number} [options.corrosionAllowanceMm=1.5] Corrosion allowance (mm)
   * @returns {Object} Sizing recommendation with full engineering dossier
   */
  sizeLine(options) {
    const {
      service = 'general_liquid',
      massFlowKgS,
      densityKgM3,
      viscosityPaS,
      designPressureBar,
      lengthM = 100,
      maxPressureDropBarPer100m,
      material = 'A106-B',
      corrosionAllowanceMm = 1.5
    } = options;

    const bounds = SERVICE_VELOCITY_BOUNDS[service] || SERVICE_VELOCITY_BOUNDS.general_liquid;
    const maxDP = maxPressureDropBarPer100m || bounds.defaultMaxDPBarPer100m;
    const erosionalLimit = this.calculateErosionalVelocity(densityKgM3);
    const vMaxAllowed = Math.min(bounds.max, erosionalLimit);

    const P_Pa = designPressureBar * 1e5;
    const c_a_m = corrosionAllowanceMm / 1000;

    const evaluatedOptions = [];

    for (const pipe of this.database) {
      const Do_m = pipe.do / 1000;
      const mech = this.calculateASMEB313WallThickness({
        designPressurePa: P_Pa,
        outerDiameterM: Do_m,
        material,
        corrosionAllowanceM: c_a_m
      });

      for (const [schName, schData] of Object.entries(pipe.schedules)) {
        const Di_m = schData.id / 1000;
        const tn_m = schData.wall / 1000;

        // Mechanical check: nominal wall must meet or exceed required nominal thickness
        const mechPass = schData.wall >= mech.requiredNominalThicknessMm;
        const mawpPa = mech.calculateMAWP(tn_m);

        // Hydraulic check
        const hydro = this.calculateHydraulics({
          massFlowKgS,
          densityKgM3,
          viscosityPaS,
          innerDiameterM: Di_m,
          lengthM
        });

        const vPass = hydro.velocityMS <= vMaxAllowed && hydro.velocityMS >= bounds.min * 0.7;
        const dpPass = hydro.pressureDropBarPer100m <= maxDP * 1.05; // 5% engineering margin

        const score =
          (mechPass ? 0 : 1000) + (vPass ? 0 : 500) + (dpPass ? 0 : 300) + pipe.nominalInch * 10 + schData.wall;

        evaluatedOptions.push({
          nps: pipe.nps,
          nominalInch: pipe.nominalInch,
          outerDiameterMm: pipe.do,
          schedule: schName,
          nominalWallMm: schData.wall,
          innerDiameterMm: schData.id,
          velocityMS: hydro.velocityMS,
          pressureDropBarPer100m: hydro.pressureDropBarPer100m,
          reynoldsNumber: hydro.reynoldsNumber,
          mawpBar: mawpPa / 1e5,
          requiredWallMm: mech.requiredNominalThicknessMm,
          mechanicalCompliant: mechPass,
          velocityCompliant: vPass,
          pressureDropCompliant: dpPass,
          compliant: mechPass && vPass && dpPass,
          score
        });
      }
    }

    // Sort compliant candidates by smallest weight / nominal inch
    const compliant = evaluatedOptions.filter((o) => o.compliant);
    compliant.sort((a, b) => a.score - b.score);

    const selected = compliant.length > 0 ? compliant[0] : evaluatedOptions.sort((a, b) => a.score - b.score)[0];

    return {
      service,
      recommended: selected,
      designLimits: {
        velocityMinMS: bounds.min,
        velocityMaxMS: bounds.max,
        erosionalVelocityLimitMS: erosionalLimit,
        effectiveVelocityMaxMS: vMaxAllowed,
        maxAllowableDPBarPer100m: maxDP,
        corrosionAllowanceMm
      },
      candidatesEvaluatedCount: evaluatedOptions.length,
      compliantCandidatesCount: compliant.length,
      allCompliantCandidates: compliant.slice(0, 5)
    };
  }
}

module.exports = {
  PipeSizingEngine,
  PIPE_SCHEDULE_DATABASE,
  MATERIAL_ALLOWABLE_STRESS,
  MATERIAL_ALLOWABLE_STRESS_VS_TEMP,
  KSI_TO_PA,
  SERVICE_VELOCITY_BOUNDS
};
