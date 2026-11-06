'use strict';

/**
 * ISO 5167 Differential Pressure Flow Elements Engine.
 *
 * Implements:
 * - ISO 5167-1:2003 (General principles and requirements)
 * - ISO 5167-2:2003 (Concentric square-edged orifice plates with corner, flange, and D - D/2 taps)
 * - ISO 5167-3:2003 (ISA 1932 nozzles and long radius nozzles)
 * - ISO 5167-4:2003 (Classical Venturi tubes: as-cast, machined, and welded)
 *
 * Core physical calculations:
 * 1. Reader-Harris/Gallagher (R-H/G 1998) discharge coefficient Cd(beta, ReD)
 * 2. Expansibility factor epsilon for compressible gases and incompressible liquids
 * 3. Velocity of approach factor E = 1 / sqrt(1 - beta^4)
 * 4. Permanent pressure loss ratio Delta_omega / Delta_P
 * 5. Iterative bore diameter (d) solver for given mass flow rate and differential pressure
 * 6. Forward solver for flow rate given differential pressure, and Delta_P given flow rate
 * 7. Standard application limits and geometric constraint auditing
 */

const TAP_TYPES = Object.freeze({
  CORNER: 'corner',
  FLANGE: 'flange',
  D_AND_D_OVER_2: 'd_and_d_over_2'
});

const DEVICE_TYPES = Object.freeze({
  ORIFICE_PLATE: 'orifice_plate',
  ISA_1932_NOZZLE: 'isa_1932_nozzle',
  LONG_RADIUS_NOZZLE: 'long_radius_nozzle',
  VENTURI_AS_CAST: 'venturi_as_cast',
  VENTURI_MACHINED: 'venturi_machined',
  VENTURI_WELDED: 'venturi_welded'
});

/**
 * Compute the Reader-Harris/Gallagher (R-H/G) discharge coefficient for orifice plates.
 * ISO 5167-2:2003 Clause 5.3.2.1.
 *
 * @param {Object} params
 * @param {number} params.beta - Diameter ratio d / D [-]
 * @param {number} params.D - Pipe internal diameter [m]
 * @param {number} params.ReD - Pipe Reynolds number [-]
 * @param {string} [params.tapType='flange'] - Tapping arrangement: 'corner', 'flange', 'd_and_d_over_2'
 * @returns {number} Discharge coefficient Cd [-]
 */
function calculateOrificeCd({ beta, D, ReD, tapType = TAP_TYPES.FLANGE }) {
  if (beta <= 0 || beta >= 1) {
    throw new RangeError(`Beta ratio must be between 0 and 1, got ${beta}`);
  }
  if (ReD <= 0) {
    throw new RangeError(`Reynolds number must be positive, got ${ReD}`);
  }
  if (D <= 0) {
    throw new RangeError(`Pipe diameter must be positive, got ${D}`);
  }

  // Tapping dimensionless distances L1 and L'2
  let L1 = 0;
  let L2Prime = 0;

  switch (tapType) {
    case TAP_TYPES.CORNER:
      L1 = 0;
      L2Prime = 0;
      break;
    case TAP_TYPES.FLANGE:
      // Taps are at 25.4 mm (1 inch) from the respective plate faces
      L1 = 0.0254 / D;
      L2Prime = 0.0254 / D;
      break;
    case TAP_TYPES.D_AND_D_OVER_2:
      // Upstream tap at 1 D, downstream tap at 0.47 D (accounting for plate thickness)
      L1 = 1.0;
      L2Prime = 0.47;
      break;
    default:
      throw new Error(`Unknown tap type: ${tapType}. Use 'corner', 'flange', or 'd_and_d_over_2'.`);
  }

  const beta2 = beta * beta;
  const beta4 = beta2 * beta2;
  const beta8 = beta4 * beta4;

  // Auxiliary parameter A
  const A = Math.pow((19000.0 * beta) / ReD, 0.8);

  // Term 1, 2, 3
  let cd = 0.5961 + 0.0261 * beta2 - 0.216 * beta8;

  // Term 4: ReD dependence
  cd += 0.000521 * Math.pow((1e6 * beta) / ReD, 0.7);

  // Term 5: beta^3.5 and ReD
  cd += (0.0188 + 0.0063 * A) * Math.pow(beta, 3.5) * Math.pow(1e6 / ReD, 0.3);

  // Term 6: upstream tap location L1
  const term6Factor = 0.043 + 0.080 * Math.exp(-10.0 * L1) - 0.123 * Math.exp(-7.0 * L1);
  cd += term6Factor * (1.0 - 0.11 * A) * (beta4 / (1.0 - beta4));

  // Term 7: downstream tap location L'2
  if (L2Prime > 0) {
    const M2Prime = (2.0 * L2Prime) / (1.0 - beta);
    const m2Term = M2Prime - 0.8 * Math.pow(M2Prime, 1.1);
    cd -= 0.031 * m2Term * Math.pow(beta, 1.3);
  }

  // Small bore pipe correction: if D < 71.12 mm (2.8 inches)
  if (D < 0.07112) {
    const DInches = D / 0.0254;
    cd += 0.011 * (0.75 - beta) * (2.8 - DInches);
  }

  return cd;
}

/**
 * Compute discharge coefficient for nozzles (ISO 5167-3) and Venturi tubes (ISO 5167-4).
 *
 * @param {Object} params
 * @param {string} params.deviceType - Element type
 * @param {number} params.beta - Diameter ratio [-]
 * @param {number} params.ReD - Reynolds number [-]
 * @returns {number} Discharge coefficient Cd [-]
 */
function calculateDeviceCd({ deviceType, beta, ReD }) {
  switch (deviceType) {
    case DEVICE_TYPES.ORIFICE_PLATE:
      throw new Error('Use calculateOrificeCd for orifice plates');

    case DEVICE_TYPES.ISA_1932_NOZZLE: {
      // ISO 5167-3:2003 Clause 5.1.3.1
      const beta4_1 = Math.pow(beta, 4.1);
      const beta2 = beta * beta;
      const beta4_15 = Math.pow(beta, 4.15);
      const reTerm = Math.pow(1e6 / ReD, 1.15);
      return 0.9900 - 0.2262 * beta4_1 - (0.00175 * beta2 - 0.0033 * beta4_15) * reTerm;
    }

    case DEVICE_TYPES.LONG_RADIUS_NOZZLE:
      // ISO 5167-3:2003 Clause 5.2.3.1
      return 0.9965 - 0.00653 * Math.sqrt(1e6 / ReD) * Math.pow(beta, 0.5);

    case DEVICE_TYPES.VENTURI_AS_CAST:
      // ISO 5167-4:2003 Clause 5.2.1: Cd = 0.984
      return 0.984;

    case DEVICE_TYPES.VENTURI_MACHINED:
      // ISO 5167-4:2003 Clause 5.2.2: Cd = 0.995
      return 0.995;

    case DEVICE_TYPES.VENTURI_WELDED:
      // ISO 5167-4:2003 Clause 5.2.3: Cd = 0.985
      return 0.985;

    default:
      throw new Error(`Unsupported device type: ${deviceType}`);
  }
}

/**
 * Expansibility factor epsilon for compressible gases and liquids.
 *
 * @param {Object} params
 * @param {number} params.beta - Diameter ratio d / D [-]
 * @param {number} params.P1 - Upstream absolute pressure [Pa]
 * @param {number} params.deltaP - Differential pressure P1 - P2 [Pa]
 * @param {number} [params.isentropicExponent=1.4] - Gas isentropic exponent kappa (Cp / Cv) [-]
 * @param {boolean} [params.isGas=false] - True if fluid is compressible gas/vapor
 * @param {string} [params.deviceType='orifice_plate'] - Device type
 * @returns {number} Expansibility factor epsilon [-]
 */
function calculateExpansibility({
  beta,
  P1,
  deltaP,
  isentropicExponent = 1.4,
  isGas = false,
  deviceType = DEVICE_TYPES.ORIFICE_PLATE
}) {
  if (!isGas) {
    return 1.0;
  }
  if (P1 <= 0) {
    throw new RangeError(`Upstream pressure must be positive, got ${P1}`);
  }
  if (deltaP < 0) {
    throw new RangeError(`Differential pressure must be non-negative, got ${deltaP}`);
  }

  if (deltaP <= 1e-9) {
    return 1.0;
  }

  const P2 = P1 - deltaP;
  if (P2 <= 0) {
    throw new RangeError(`Downstream pressure P2 must be positive: P1=${P1}, deltaP=${deltaP}`);
  }

  const tau = P2 / P1;
  const kappa = isentropicExponent;

  if (deviceType === DEVICE_TYPES.ORIFICE_PLATE) {
    // ISO 5167-2:2003 Clause 5.3.3.1
    const beta4 = Math.pow(beta, 4);
    const beta8 = beta4 * beta4;
    const factor = 0.351 + 0.256 * beta4 + 0.93 * beta8;
    const pressFactor = 1.0 - Math.pow(tau, 1.0 / kappa);
    const eps = 1.0 - factor * pressFactor;
    return Math.max(0.1, eps);
  }

  // For nozzles and Venturi tubes: isentropic flow expansion (ISO 5167-3 and 5167-4)
  if (Math.abs(1.0 - tau) < 1e-7) {
    return 1.0;
  }

  const beta4 = Math.pow(beta, 4);
  const tau2k = Math.pow(tau, 2.0 / kappa);
  const num1 = (kappa * tau2k) / (kappa - 1.0);
  const num2 = (1.0 - beta4) / (1.0 - beta4 * tau2k);
  const num3 = (1.0 - Math.pow(tau, (kappa - 1.0) / kappa)) / (1.0 - tau);

  const termInside = num1 * num2 * num3;
  if (termInside <= 0 || !Number.isFinite(termInside)) {
    return 1.0;
  }
  return Math.sqrt(termInside);
}

/**
 * Permanent pressure loss Delta_omega across the primary element.
 *
 * @param {Object} params
 * @param {number} params.deltaP - Differential pressure [Pa]
 * @param {number} params.beta - Diameter ratio [-]
 * @param {number} params.Cd - Discharge coefficient [-]
 * @param {string} [params.deviceType='orifice_plate'] - Element type
 * @returns {Object} { lossPa, lossRatio, lossPercentage }
 */
function calculatePermanentPressureLoss({ deltaP, beta, Cd, deviceType = DEVICE_TYPES.ORIFICE_PLATE }) {
  let lossRatio = 0;

  if (deviceType === DEVICE_TYPES.ORIFICE_PLATE) {
    // ISO 5167-2:2003 Clause 5.4.1:
    // Delta_omega / Delta_P = (sqrt(1 - beta^4 * (1 - Cd^2)) - Cd * beta^2) / (sqrt(1 - beta^4 * (1 - Cd^2)) + Cd * beta^2)
    const beta2 = beta * beta;
    const beta4 = beta2 * beta2;
    const radical = Math.sqrt(Math.max(1e-12, 1.0 - beta4 * (1.0 - Cd * Cd)));
    const numerator = radical - Cd * beta2;
    const denominator = radical + Cd * beta2;
    lossRatio = numerator / denominator;
  } else if (deviceType.startsWith('venturi')) {
    // ISO 5167-4:2003 Clause 5.4: permanent loss ratio depends on diameter ratio beta
    // and divergent diffuser geometry (typical 7 to 15 degrees)
    const baseRatio = 0.219 - 0.216 * beta + 0.12 * beta * beta;
    lossRatio = Math.max(0.05, Math.min(0.20, baseRatio));
  } else {
    // Nozzle loss per ISO 5167-3 Clause 5.4
    const beta2 = beta * beta;
    const beta4 = beta2 * beta2;
    const radical = Math.sqrt(Math.max(1e-12, 1.0 - beta4 * (1.0 - Cd * Cd)));
    lossRatio = (radical - Cd * beta2) / (radical + Cd * beta2);
  }

  // Bounded within physical limits [0, 1]
  lossRatio = Math.max(0.01, Math.min(0.99, lossRatio));
  const lossPa = deltaP * lossRatio;

  return {
    lossPa,
    lossRatio,
    lossPercentage: lossRatio * 100.0
  };
}

/**
 * Forward mass flow calculation from differential pressure.
 *
 * @param {Object} input
 * @returns {Object} Comprehensive flow calculation results
 */
function calculateFlowRate(input) {
  const {
    d,
    D,
    deltaP,
    P1,
    rho1,
    mu,
    tapType = TAP_TYPES.FLANGE,
    deviceType = DEVICE_TYPES.ORIFICE_PLATE,
    isGas = false,
    isentropicExponent = 1.4
  } = input;

  if (d <= 0 || D <= 0 || d >= D) {
    throw new RangeError(`Invalid diameters: d=${d}, D=${D}`);
  }
  if (deltaP <= 0) {
    throw new RangeError(`Differential pressure must be positive, got ${deltaP}`);
  }
  if (rho1 <= 0 || mu <= 0) {
    throw new RangeError(`Fluid density and viscosity must be positive`);
  }

  const beta = d / D;
  const beta4 = Math.pow(beta, 4);
  const E = 1.0 / Math.sqrt(1.0 - beta4); // Velocity of approach factor
  const dArea = (Math.PI / 4.0) * d * d;

  const epsilon = calculateExpansibility({
    beta,
    P1: P1 || deltaP * 5.0,
    deltaP,
    isentropicExponent,
    isGas,
    deviceType
  });

  // Iteratively compute mass flow rate and Cd since ReD depends on qm
  let qm = (Math.PI / 4.0) * d * d * Math.sqrt(2.0 * rho1 * deltaP); // Initial guess (Cd ~ 0.6)
  let Cd = 0.6;
  let ReD = 1e5;

  for (let iter = 0; iter < 40; iter++) {
    ReD = (4.0 * qm) / (Math.PI * D * mu);
    if (deviceType === DEVICE_TYPES.ORIFICE_PLATE) {
      Cd = calculateOrificeCd({ beta, D, ReD, tapType });
    } else {
      Cd = calculateDeviceCd({ deviceType, beta, ReD });
    }

    const qmNew = Cd * E * epsilon * dArea * Math.sqrt(2.0 * rho1 * deltaP);
    if (Math.abs(qmNew - qm) / qm < 1e-9) {
      qm = qmNew;
      break;
    }
    qm = 0.5 * (qm + qmNew);
  }

  const qvM3S = qm / rho1;
  const qvM3H = qvM3S * 3600.0;
  const qmKgH = qm * 3600.0;
  const Red = ReD / beta;
  const C = Cd * E; // Flow coefficient

  const loss = calculatePermanentPressureLoss({ deltaP, beta, Cd, deviceType });

  const limits = checkStandardLimits({ deviceType, beta, D, d, ReD, deltaP, P1, isGas });

  return {
    deviceType,
    tapType,
    pipeDiameterM: D,
    pipeDiameterMm: D * 1000.0,
    boreDiameterM: d,
    boreDiameterMm: d * 1000.0,
    beta,
    massFlowRateKgS: qm,
    massFlowRateKgH: qmKgH,
    volumeFlowRateM3S: qvM3S,
    volumeFlowRateM3H: qvM3H,
    differentialPressurePa: deltaP,
    differentialPressureKPa: deltaP / 1000.0,
    differentialPressureMbar: deltaP / 100.0,
    dischargeCoefficient: Cd,
    velocityOfApproachFactor: E,
    flowCoefficient: C,
    expansibilityFactor: epsilon,
    reynoldsD: ReD,
    reynoldsd: Red,
    permanentPressureLossPa: loss.lossPa,
    permanentPressureLossKPa: loss.lossPa / 1000.0,
    permanentLossPercentage: loss.lossPercentage,
    standardLimits: limits
  };
}

/**
 * Calculate differential pressure given mass flow rate and bore diameter.
 *
 * @param {Object} input
 * @returns {Object} Comprehensive calculation result
 */
function calculateDeltaP(input) {
  const {
    qm,
    d,
    D,
    P1,
    rho1,
    mu,
    tapType = TAP_TYPES.FLANGE,
    deviceType = DEVICE_TYPES.ORIFICE_PLATE,
    isGas = false,
    isentropicExponent = 1.4
  } = input;

  if (qm <= 0) {
    throw new RangeError(`Mass flow rate must be positive, got ${qm}`);
  }
  if (d <= 0 || D <= 0 || d >= D) {
    throw new RangeError(`Invalid diameters: d=${d}, D=${D}`);
  }

  const beta = d / D;
  const beta4 = Math.pow(beta, 4);
  const E = 1.0 / Math.sqrt(1.0 - beta4);
  const dArea = (Math.PI / 4.0) * d * d;
  const ReD = (4.0 * qm) / (Math.PI * D * mu);

  let Cd = 0.6;
  if (deviceType === DEVICE_TYPES.ORIFICE_PLATE) {
    Cd = calculateOrificeCd({ beta, D, ReD, tapType });
  } else {
    Cd = calculateDeviceCd({ deviceType, beta, ReD });
  }

  // Iteratively solve for deltaP (accounting for gas expansibility if applicable)
  let deltaP = Math.pow(qm / (Cd * E * dArea), 2.0) / (2.0 * rho1);

  if (isGas && P1) {
    for (let i = 0; i < 25; i++) {
      const eps = calculateExpansibility({
        beta,
        P1,
        deltaP,
        isentropicExponent,
        isGas: true,
        deviceType
      });
      const newDeltaP = Math.pow(qm / (Cd * E * eps * dArea), 2.0) / (2.0 * rho1);
      if (Math.abs(newDeltaP - deltaP) / deltaP < 1e-8) {
        deltaP = newDeltaP;
        break;
      }
      deltaP = 0.5 * (deltaP + newDeltaP);
    }
  }

  return calculateFlowRate({
    d,
    D,
    deltaP,
    P1,
    rho1,
    mu,
    tapType,
    deviceType,
    isGas,
    isentropicExponent
  });
}

/**
 * Size orifice bore diameter d given mass flow rate and target differential pressure.
 * Employs a bracketed Brent/Newton root solver for monotonic convergence.
 *
 * @param {Object} input
 * @param {number} input.qm - Design mass flow rate [kg/s]
 * @param {number} input.targetDeltaP - Allowable / transmitter span differential pressure [Pa]
 * @param {number} input.D - Pipe internal diameter [m]
 * @param {number} input.P1 - Upstream static pressure [Pa]
 * @param {number} input.rho1 - Upstream fluid density [kg/m3]
 * @param {number} input.mu - Dynamic viscosity [Pa.s]
 * @param {string} [input.tapType='flange']
 * @param {string} [input.deviceType='orifice_plate']
 * @param {boolean} [input.isGas=false]
 * @param {number} [input.isentropicExponent=1.4]
 * @returns {Object} Sizing results with sized diameter d and full verification
 */
function sizeBoreDiameter(input) {
  const {
    qm,
    targetDeltaP,
    D,
    P1,
    rho1,
    mu,
    tapType = TAP_TYPES.FLANGE,
    deviceType = DEVICE_TYPES.ORIFICE_PLATE,
    isGas = false,
    isentropicExponent = 1.4
  } = input;

  if (qm <= 0 || targetDeltaP <= 0 || D <= 0 || rho1 <= 0 || mu <= 0) {
    throw new RangeError('All physical parameters (qm, targetDeltaP, D, rho1, mu) must be positive');
  }

  // Objective function: f(d) = calculated_flow(d) - qm
  function evalResidual(dBore) {
    const res = calculateFlowRate({
      d: dBore,
      D,
      deltaP: targetDeltaP,
      P1,
      rho1,
      mu,
      tapType,
      deviceType,
      isGas,
      isentropicExponent
    });
    return res.massFlowRateKgS - qm;
  }

  // Initial brackets for diameter ratio beta: [0.05, 0.85]
  let dLow = 0.05 * D;
  let dHigh = 0.85 * D;

  let fLow = evalResidual(dLow);
  let fHigh = evalResidual(dHigh);

  if (fLow > 0) {
    // Pipe may be oversized or flow is small: expand lower search bracket down
    dLow = Math.max(0.0005, 0.005 * D);
    fLow = evalResidual(dLow);
    if (fLow > 0) {
      dLow = Math.max(0.0001, 0.001 * D);
      fLow = evalResidual(dLow);
    }
    if (fLow > 0) {
      throw new Error(
        `Required flow (${(qm * 3600).toFixed(4)} kg/h) is too small for pipe DN ${(D * 1000).toFixed(1)} mm at target deltaP ${(targetDeltaP / 1000).toFixed(2)} kPa. Reduce pipe size or reduce deltaP.`
      );
    }
  }
  if (fHigh < 0) {
    // Pipe is too small for target deltaP
    dHigh = 0.95 * D;
    fHigh = evalResidual(dHigh);
    if (fHigh < 0) {
      dHigh = 0.98 * D;
      fHigh = evalResidual(dHigh);
    }
    if (fHigh < 0) {
      throw new Error(
        `Required flow (${(qm * 3600).toFixed(1)} kg/h) cannot be achieved in pipe DN ${(D * 1000).toFixed(1)} mm at target deltaP ${(targetDeltaP / 1000).toFixed(2)} kPa. Increase pipe size or deltaP.`
      );
    }
  }

  if (fLow * fHigh > 0) {
    throw new Error(
      `Cannot bracket orifice bore root: residual at dLow is ${fLow.toExponential(3)}, at dHigh is ${fHigh.toExponential(3)}. Ensure process parameters are feasible.`
    );
  }

  // Brent-Dekker / Bisection solver
  let dMid = 0.5 * (dLow + dHigh);
  const maxIterations = 60;
  const tol = 1e-9;

  for (let i = 0; i < maxIterations; i++) {
    dMid = 0.5 * (dLow + dHigh);
    const fMid = evalResidual(dMid);

    if (Math.abs(fMid) < tol || Math.abs(dHigh - dLow) / D < 1e-8) {
      break;
    }

    if (fLow * fMid < 0) {
      dHigh = dMid;
      fHigh = fMid;
    } else {
      dLow = dMid;
      fLow = fMid;
    }
  }

  // Final verification run
  const finalResult = calculateFlowRate({
    d: dMid,
    D,
    deltaP: targetDeltaP,
    P1,
    rho1,
    mu,
    tapType,
    deviceType,
    isGas,
    isentropicExponent
  });

  const relativeError = Math.abs(finalResult.massFlowRateKgS - qm) / qm;
  if (relativeError > 1e-4) {
    throw new Error(
      `Orifice bore sizing failed to converge within tolerance. Relative error: ${relativeError.toExponential(3)}.`
    );
  }

  return {
    ...finalResult,
    targetFlowRateKgS: qm,
    flowErrorKgS: finalResult.massFlowRateKgS - qm,
    relativeFlowError: relativeError
  };
}

/**
 * Verify dimensional and operational boundaries according to ISO 5167.
 */
function checkStandardLimits({ deviceType, beta, D, d, ReD, deltaP, P1, isGas }) {
  const warnings = [];
  let isWithinStandard = true;

  const DMm = D * 1000.0;
  const dMm = d * 1000.0;

  if (deviceType === DEVICE_TYPES.ORIFICE_PLATE) {
    // ISO 5167-2 Clause 5.1.1
    if (dMm < 12.5) {
      warnings.push(`Bore diameter (${dMm.toFixed(2)} mm) is less than ISO 5167 minimum 12.5 mm.`);
      isWithinStandard = false;
    }
    if (DMm < 50.0 || DMm > 1000.0) {
      warnings.push(`Pipe diameter (${DMm.toFixed(2)} mm) is outside ISO 5167 range [50 mm, 1000 mm].`);
      isWithinStandard = false;
    }
    if (beta < 0.10 || beta > 0.75) {
      warnings.push(`Beta ratio (${beta.toFixed(3)}) is outside standard limits [0.10, 0.75].`);
      isWithinStandard = false;
    } else if (beta < 0.20 || beta > 0.70) {
      warnings.push(`Beta ratio (${beta.toFixed(3)}) is outside recommended engineering range [0.20, 0.70].`);
    }

    const minRe = beta <= 0.56 ? 5000 : 16000 * beta * beta;
    if (ReD < minRe) {
      warnings.push(`Pipe Reynolds number (${ReD.toFixed(0)}) is below minimum required (${minRe.toFixed(0)}).`);
      isWithinStandard = false;
    }
  } else if (deviceType === DEVICE_TYPES.ISA_1932_NOZZLE) {
    if (DMm < 50.0 || DMm > 500.0) {
      warnings.push(`Pipe diameter (${DMm.toFixed(2)} mm) outside nozzle limits [50 mm, 500 mm].`);
      isWithinStandard = false;
    }
    if (beta < 0.30 || beta > 0.80) {
      warnings.push(`Beta ratio (${beta.toFixed(3)}) outside nozzle limits [0.30, 0.80].`);
      isWithinStandard = false;
    }
    if (ReD < 20000 || ReD > 1e7) {
      warnings.push(`Reynolds number (${ReD.toFixed(0)}) outside nozzle limits [2e4, 1e7].`);
      isWithinStandard = false;
    }
  } else if (deviceType.startsWith('venturi')) {
    if (beta < 0.30 || beta > 0.75) {
      warnings.push(`Beta ratio (${beta.toFixed(3)}) outside Venturi limits [0.30, 0.75].`);
      isWithinStandard = false;
    }
    if (ReD < 2e5 || ReD > 2e6) {
      warnings.push(`Reynolds number (${ReD.toFixed(0)}) outside Venturi limits [2e5, 2e6].`);
    }
  }

  if (isGas && P1 && deltaP / P1 > 0.25) {
    warnings.push(`Pressure ratio Delta_P / P1 (${(deltaP / P1).toFixed(3)}) exceeds 0.25 limit for expansibility accuracy.`);
  }

  return {
    isWithinStandard,
    warnings,
    standardReference:
      deviceType === DEVICE_TYPES.ORIFICE_PLATE
        ? 'ISO 5167-2:2003'
        : deviceType.includes('nozzle')
          ? 'ISO 5167-3:2003'
          : 'ISO 5167-4:2003'
  };
}

module.exports = {
  TAP_TYPES,
  DEVICE_TYPES,
  calculateOrificeCd,
  calculateDeviceCd,
  calculateExpansibility,
  calculatePermanentPressureLoss,
  calculateFlowRate,
  calculateDeltaP,
  sizeBoreDiameter,
  checkStandardLimits
};
