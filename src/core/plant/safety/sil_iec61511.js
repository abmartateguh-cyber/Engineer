/**
 * IEC 61511 / IEC 61508 Safety Instrumented Function (SIF) Verification Engine.
 *
 * Implements standard reliability and functional safety calculations for low-demand SIFs:
 *  - Architecture modeling: 1oo1, 1oo2, 2oo2, 2oo3 voting structures.
 *  - Subsystem evaluation: Sensors, Logic Solver, Final Elements (Valves/ESDV/Actuators).
 *  - Beta-factor common cause failure (CCF) modeling.
 *  - Partial Stroke Test (PST) coverage and proof test interval (TI) effects.
 *  - PFD_avg (Average Probability of Failure on Demand) and RRF (Risk Reduction Factor).
 *  - Spurious trip rate / Mean Time To Fail Spurious (MTTFs).
 *  - Architectural constraints: Hardware Fault Tolerance (HFT) and Safe Failure Fraction (SFF).
 *  - Generic published failure rate references (OREDA, exida generic ranges).
 *
 * Note: Failure rates provided are generic published benchmarks for engineering calculation.
 */

'use strict';

/**
 * Generic published failure rate benchmarks (per hour).
 * Sourced from generic industry safety reliability tables (e.g. OREDA, exida safety equipment benchmarks).
 */
const GENERIC_FAILURE_RATES = Object.freeze({
  pressure_transmitter: {
    description: 'Smart electronic pressure transmitter',
    type: 'Type B',
    lambdaDU: 1.2e-7, // 1.2 failures per 10^7 hours (~0.00105/yr)
    lambdaDD: 3.8e-7,
    lambdaSU: 2.0e-7,
    lambdaSD: 5.0e-7,
    defaultBeta: 0.05
  },
  temperature_transmitter: {
    description: 'RTD/Thermocouple + Smart temperature transmitter',
    type: 'Type B',
    lambdaDU: 1.5e-7,
    lambdaDD: 3.5e-7,
    lambdaSU: 2.5e-7,
    lambdaSD: 4.5e-7,
    defaultBeta: 0.05
  },
  level_transmitter_radar: {
    description: 'Non-contact / guided wave radar level transmitter',
    type: 'Type B',
    lambdaDU: 2.2e-7,
    lambdaDD: 4.0e-7,
    lambdaSU: 3.0e-7,
    lambdaSD: 4.0e-7,
    defaultBeta: 0.05
  },
  gas_detector_ir: {
    description: 'Point infrared hydrocarbon gas detector',
    type: 'Type B',
    lambdaDU: 4.5e-7,
    lambdaDD: 8.5e-7,
    lambdaSU: 4.0e-7,
    lambdaSD: 7.0e-7,
    defaultBeta: 0.10
  },
  flame_detector_ir3: {
    description: 'Multi-spectrum triple IR flame detector',
    type: 'Type B',
    lambdaDU: 4.0e-7,
    lambdaDD: 7.5e-7,
    lambdaSU: 3.5e-7,
    lambdaSD: 6.0e-7,
    defaultBeta: 0.10
  },
  safety_plc_logic_solver: {
    description: 'Dual / Triple modular redundant safety logic solver',
    type: 'Type B',
    lambdaDU: 3.5e-8,
    lambdaDD: 1.2e-6,
    lambdaSU: 2.0e-8,
    lambdaSD: 2.5e-6,
    defaultBeta: 0.02
  },
  esdv_ball_valve_assembly: {
    description: 'Emergency shutdown ball valve + scotch yoke actuator + solenoid valve',
    type: 'Type A',
    lambdaDU: 1.1e-6, // ~0.0096/yr
    lambdaDD: 2.0e-7,
    lambdaSU: 8.0e-7,
    lambdaSD: 1.5e-7,
    defaultBeta: 0.08
  },
  solenoid_valve: {
    description: '3/2-way direct acting safety solenoid valve',
    type: 'Type A',
    lambdaDU: 2.5e-7,
    lambdaDD: 5.0e-8,
    lambdaSU: 3.0e-7,
    lambdaSD: 5.0e-8,
    defaultBeta: 0.05
  },
  pneumatic_actuator: {
    description: 'Spring return pneumatic scotch yoke / rack & pinion actuator',
    type: 'Type A',
    lambdaDU: 4.5e-7,
    lambdaDD: 5.0e-8,
    lambdaSU: 2.5e-7,
    lambdaSD: 5.0e-8,
    defaultBeta: 0.05
  },
  quarter_turn_valve: {
    description: 'Trunnion mounted ball valve body and trim',
    type: 'Type A',
    lambdaDU: 4.0e-7,
    lambdaDD: 1.0e-7,
    lambdaSU: 2.5e-7,
    lambdaSD: 5.0e-8,
    defaultBeta: 0.05
  }
});

/**
 * Determine SIL level for low demand mode based on PFD_avg.
 *
 * SIL 4: 1e-5 <= PFD < 1e-4 (10,000 <= RRF < 100,000)
 * SIL 3: 1e-4 <= PFD < 1e-3 (1,000 <= RRF < 10,000)
 * SIL 2: 1e-3 <= PFD < 1e-2 (100 <= RRF < 1,000)
 * SIL 1: 1e-2 <= PFD < 1e-1 (10 <= RRF < 100)
 * No SIL: PFD >= 0.1 (RRF < 10)
 *
 * @param {number} pfdAvg
 * @returns {{sil:number, silLabel:string, rrf:number}}
 */
function determineSilFromPfd(pfdAvg) {
  if (pfdAvg <= 0 || !Number.isFinite(pfdAvg)) {
    throw new RangeError('pfdAvg must be a positive finite number');
  }
  const rrf = 1.0 / pfdAvg;
  let sil = 0;
  let silLabel = '< SIL 1';

  if (pfdAvg < 1e-4 && pfdAvg >= 1e-5) {
    sil = 4;
    silLabel = 'SIL 4';
  } else if (pfdAvg < 1e-3 && pfdAvg >= 1e-4) {
    sil = 3;
    silLabel = 'SIL 3';
  } else if (pfdAvg < 1e-2 && pfdAvg >= 1e-3) {
    sil = 2;
    silLabel = 'SIL 2';
  } else if (pfdAvg < 0.1 && pfdAvg >= 1e-2) {
    sil = 1;
    silLabel = 'SIL 1';
  } else if (pfdAvg < 1e-5) {
    sil = 4;
    silLabel = 'SIL 4 (Exceeds SIL 4)';
  }

  return { sil, silLabel, rrf };
}

/**
 * Calculate Safe Failure Fraction (SFF).
 * SFF = (sum lambda_S + sum lambda_DD) / (sum lambda_S + sum lambda_D)
 *
 * @param {Object} rates
 * @param {number} rates.lambdaDU
 * @param {number} rates.lambdaDD
 * @param {number} rates.lambdaSU
 * @param {number} rates.lambdaSD
 * @returns {number} SFF between 0 and 1
 */
function calculateSff(rates) {
  const lambdaS = (rates.lambdaSU || 0) + (rates.lambdaSD || 0);
  const lambdaD = (rates.lambdaDU || 0) + (rates.lambdaDD || 0);
  const total = lambdaS + lambdaD;
  if (total <= 0) return 0;
  return (lambdaS + (rates.lambdaDD || 0)) / total;
}

/**
 * Check maximum architectural SIL claimable under IEC 61508 Route 1H / Route 2H.
 *
 * @param {Object} p
 * @param {'Type A'|'Type B'} p.deviceType
 * @param {number} p.hft Hardware fault tolerance (0, 1, 2)
 * @param {number} p.sff Safe failure fraction (0.0 to 1.0)
 * @param {'Route 1H'|'Route 2H'} [p.route='Route 2H']
 * @returns {number} Maximum permissible SIL (1, 2, 3, or 4)
 */
function maximumPermissibleSil(p) {
  const hft = p.hft || 0;
  const sff = p.sff !== undefined ? p.sff : 0.9;
  const deviceType = p.deviceType || 'Type B';
  const route = p.route || 'Route 2H';

  if (route === 'Route 2H') {
    // IEC 61511-1 Clause 11.4 / IEC 61508 Route 2H based on prior use and field feedback
    if (hft === 0) return 2; // HFT=0 allows up to SIL 2
    if (hft === 1) return 3; // HFT=1 allows up to SIL 3
    return 4; // HFT>=2 allows SIL 4
  }

  // Route 1H (IEC 61508-2 Table 2 & 3)
  if (deviceType === 'Type A') {
    if (sff < 0.60) return hft === 0 ? 1 : hft === 1 ? 2 : 3;
    if (sff < 0.90) return hft === 0 ? 2 : hft === 1 ? 3 : 4;
    return hft === 0 ? 3 : 4;
  } else {
    // Type B (complex / microprocessor)
    if (sff < 0.60) return hft === 0 ? 0 : hft === 1 ? 1 : 2;
    if (sff < 0.90) return hft === 0 ? 1 : hft === 1 ? 2 : 3;
    if (sff < 0.99) return hft === 0 ? 2 : hft === 1 ? 3 : 4;
    return hft === 0 ? 3 : 4;
  }
}

/**
 * Calculate PFD_avg and spurious trip rate for standard MooN voting structures.
 * Implements standard IEC 61508-6 Annex B formulas for low demand mode.
 *
 * @param {Object} params
 * @param {'1oo1'|'1oo2'|'2oo2'|'2oo3'} params.architecture Voting structure
 * @param {number} params.lambdaDU Dangerous undetected failure rate (/h)
 * @param {number} [params.lambdaDD=0] Dangerous detected failure rate (/h)
 * @param {number} [params.lambdaSU=0] Safe undetected failure rate (/h)
 * @param {number} [params.lambdaSD=0] Safe detected failure rate (/h)
 * @param {number} params.proofTestIntervalHours TI in hours (e.g. 8760 = 1 yr)
 * @param {number} [params.mttrHours=24] Mean Time to Restoration in hours
 * @param {number} [params.beta=0.05] Common cause failure fraction beta
 * @param {number} [params.betaD=0.02] Common cause failure fraction for detected dangerous failures
 * @param {number} [params.proofTestCoverage=1.0] Proof test effectiveness (0.0 to 1.0)
 * @param {Object} [params.pst] Partial stroke testing configuration (for valves)
 * @param {number} [params.pst.intervalHours=720] PST interval in hours (default 30 days = 720 h)
 * @param {number} [params.pst.coverage=0.0] PST diagnostic coverage (e.g. 0.60 to 0.70)
 * @returns {Object} Calculated PFD_avg, RRF, STR (/yr), MTTFs (yr), HFT
 */
function calculateSubsystemPfd(params) {
  const arch = params.architecture || '1oo1';
  let lambdaDU = params.lambdaDU;
  const lambdaDD = params.lambdaDD || 0.0;
  const lambdaSU = params.lambdaSU || 0.0;
  const lambdaSD = params.lambdaSD || 0.0;
  const TI = params.proofTestIntervalHours;
  const MTTR = params.mttrHours !== undefined ? params.mttrHours : 24.0;
  const beta = params.beta !== undefined ? params.beta : 0.05;
  const betaD = params.betaD !== undefined ? params.betaD : beta / 2.0;
  const PTC = params.proofTestCoverage !== undefined ? params.proofTestCoverage : 1.0;

  if (TI <= 0) throw new RangeError('proofTestIntervalHours must be > 0');
  if (lambdaDU <= 0) throw new RangeError('lambdaDU must be > 0');

  // Handle Partial Stroke Testing (PST) and Proof Test Coverage (PTC) credit
  // If PST is active, a fraction c_pst of lambdaDU is tested at interval T_pst,
  // leaving (1 - c_pst) tested at full TI.
  let effectivePfd1oo1Du = 0;
  let effectiveDuSqTerm = (Math.pow(lambdaDU * TI, 2) / 3.0);
  const missionTime = 87600.0; // 10 years default mission time

  if (params.pst && params.pst.coverage > 0) {
    const cPst = Math.min(1.0, Math.max(0.0, params.pst.coverage));
    const tPst = params.pst.intervalHours || 720.0;
    // Two terms: part tested by PST at T_pst, and remainder tested at TI with proof test coverage
    const pfdPst = cPst * lambdaDU * (tPst / 2.0);
    const pfdFull = (1.0 - cPst) * lambdaDU * (TI / 2.0);
    const pfdUncovered = (1.0 - PTC) * lambdaDU * (missionTime / 2.0);
    effectivePfd1oo1Du = pfdPst + pfdFull * PTC + pfdUncovered;
    effectiveDuSqTerm = (cPst * Math.pow(lambdaDU * tPst, 2) + (1.0 - cPst) * Math.pow(lambdaDU * TI, 2)) / 3.0;
  } else {
    effectivePfd1oo1Du = PTC * lambdaDU * (TI / 2.0) + (1.0 - PTC) * lambdaDU * (missionTime / 2.0);
    effectiveDuSqTerm = (Math.pow(lambdaDU * TI, 2) / 3.0);
  }

  let pfdAvg = 0.0;
  let hft = 0;
  let strPerHour = 0.0; // Spurious Trip Rate per hour

  // Safe failure rates for spurious trip calculation
  const lambdaS = lambdaSU + lambdaSD;
  const termCcDu = beta * effectivePfd1oo1Du;
  const termCcDd = betaD * lambdaDD * MTTR;
  const termCommonCause = termCcDu + termCcDd;

  switch (arch) {
    case '1oo1': {
      hft = 0;
      pfdAvg = effectivePfd1oo1Du + lambdaDD * MTTR;
      strPerHour = lambdaS;
      break;
    }

    case '1oo2': {
      hft = 1;
      // IEC 61508-6 Annex B Eq B.13 with PST and betaD support
      const termIndependent =
        Math.pow((1.0 - beta), 2) *
        (effectiveDuSqTerm +
          2.0 * effectivePfd1oo1Du * lambdaDD * MTTR +
          Math.pow(lambdaDD * MTTR, 2));
      pfdAvg = termIndependent + termCommonCause;

      // Spurious trip: either channel failing spuriously trips the system
      strPerHour = 2.0 * lambdaS;
      break;
    }

    case '2oo2': {
      hft = 0;
      // IEC 61508-6 Annex B Eq B.21
      // Both channels must trip; dangerous failure in either prevents safety action
      const termIndependent = 2.0 * (1.0 - beta) * (effectivePfd1oo1Du + lambdaDD * MTTR);
      pfdAvg = termIndependent + termCommonCause;

      // Spurious trip: requires both channels to fail spuriously
      strPerHour = 2.0 * Math.pow(lambdaS, 2) * MTTR + beta * lambdaS;
      break;
    }

    case '2oo3': {
      hft = 1;
      // IEC 61508-6 Annex B Eq B.31 with PST and betaD support
      const termIndependent =
        Math.pow((1.0 - beta), 2) *
        (3.0 * effectiveDuSqTerm +
          3.0 * effectivePfd1oo1Du * lambdaDD * MTTR +
          3.0 * Math.pow(lambdaDD * MTTR, 2));
      pfdAvg = termIndependent + termCommonCause;

      // Spurious trip: 2 out of 3 failing spuriously
      strPerHour = 6.0 * Math.pow(lambdaS, 2) * MTTR + beta * lambdaS;
      break;
    }

    default:
      throw new Error(`Unsupported architecture: ${arch}. Supported: 1oo1, 1oo2, 2oo2, 2oo3`);
  }

  // Convert STR to per-year (8760 hours)
  const strPerYear = strPerHour * 8760.0;
  const mttfsYears = strPerYear > 0 ? 1.0 / strPerYear : Infinity;
  const rrf = pfdAvg > 0 ? 1.0 / pfdAvg : Infinity;

  return {
    architecture: arch,
    pfdAvg,
    rrf,
    hft,
    strPerHour,
    strPerYear,
    mttfsYears,
    proofTestIntervalHours: TI,
    proofTestIntervalYears: TI / 8760.0,
    pstApplied: Boolean(params.pst && params.pst.coverage > 0)
  };
}

/**
 * Safety Instrumented Function (SIF) Verification Engine.
 * Combines Sensor Subsystem, Logic Solver, and Final Element Subsystem.
 */
class SifVerificationEngine {
  /**
   * @param {Object} config
   * @param {string} [config.name='Generic SIF'] SIF identifier/tag
   * @param {number} [config.targetSil=2] Required SIL target (1 to 4)
   * @param {number} [config.targetRrf] Optional target RRF
   * @param {Object} config.sensor Sensor subsystem parameters
   * @param {Object} config.logicSolver Logic solver parameters
   * @param {Object} config.finalElement Final element subsystem parameters
   */
  constructor(config) {
    this.name = config.name || 'SIF-001';
    this.targetSil = config.targetSil !== undefined ? config.targetSil : 2;
    this.targetRrf = config.targetRrf || (this.targetSil === 1 ? 10 : this.targetSil === 2 ? 100 : this.targetSil === 3 ? 1000 : 10000);
    this.sensorConfig = config.sensor;
    this.logicSolverConfig = config.logicSolver;
    this.finalElementConfig = config.finalElement;
  }

  /**
   * Run SIF verification calculations across all three subsystems.
   * @returns {Object} Detailed SIF verification assessment report
   */
  verify() {
    const sensorRes = calculateSubsystemPfd(this.sensorConfig);
    const solverRes = calculateSubsystemPfd(this.logicSolverConfig);
    const feRes = calculateSubsystemPfd(this.finalElementConfig);

    const totalPfd = sensorRes.pfdAvg + solverRes.pfdAvg + feRes.pfdAvg;
    const { sil: achievedSilFromPfd, silLabel, rrf: achievedRrf } = determineSilFromPfd(totalPfd);

    // Architectural constraint check: system HFT is minimum of subsystem HFTs if needed,
    // or evaluate each subsystem against Route 2H / 1H.
    const sensorSff = calculateSff(this.sensorConfig);
    const solverSff = calculateSff(this.logicSolverConfig);
    const feSff = calculateSff(this.finalElementConfig);

    const maxSilSensor = maximumPermissibleSil({
      deviceType: this.sensorConfig.deviceType || 'Type B',
      hft: sensorRes.hft,
      sff: sensorSff
    });
    const maxSilSolver = maximumPermissibleSil({
      deviceType: this.logicSolverConfig.deviceType || 'Type B',
      hft: solverRes.hft,
      sff: solverSff
    });
    const maxSilFe = maximumPermissibleSil({
      deviceType: this.finalElementConfig.deviceType || 'Type A',
      hft: feRes.hft,
      sff: feSff
    });

    const maxPermissibleArchitecturalSil = Math.min(maxSilSensor, maxSilSolver, maxSilFe);
    const achievedSil = Math.min(achievedSilFromPfd, maxPermissibleArchitecturalSil);

    // Overall spurious trip rate (sum of independent subsystem STRs)
    const totalStrPerYear = sensorRes.strPerYear + solverRes.strPerYear + feRes.strPerYear;
    const overallMttfsYears = totalStrPerYear > 0 ? 1.0 / totalStrPerYear : Infinity;

    // Subsystem contribution percentages
    const sensorContributionPct = (sensorRes.pfdAvg / totalPfd) * 100.0;
    const solverContributionPct = (solverRes.pfdAvg / totalPfd) * 100.0;
    const feContributionPct = (feRes.pfdAvg / totalPfd) * 100.0;

    const meetsTarget = achievedSil >= this.targetSil && achievedRrf >= this.targetRrf;

    return {
      sifName: this.name,
      targetSil: this.targetSil,
      targetRrf: this.targetRrf,
      achievedSil,
      achievedSilFromPfd,
      maxPermissibleArchitecturalSil,
      silLabel,
      totalPfdAvg: totalPfd,
      achievedRrf,
      meetsTarget,
      overallMttfsYears,
      totalStrPerYear,
      subsystems: {
        sensor: {
          ...sensorRes,
          sff: sensorSff,
          maxPermissibleSil: maxSilSensor,
          contributionPct: sensorContributionPct
        },
        logicSolver: {
          ...solverRes,
          sff: solverSff,
          maxPermissibleSil: maxSilSolver,
          contributionPct: solverContributionPct
        },
        finalElement: {
          ...feRes,
          sff: feSff,
          maxPermissibleSil: maxSilFe,
          contributionPct: feContributionPct
        }
      }
    };
  }
}

module.exports = {
  GENERIC_FAILURE_RATES,
  determineSilFromPfd,
  calculateSff,
  maximumPermissibleSil,
  calculateSubsystemPfd,
  SifVerificationEngine
};
