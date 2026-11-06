'use strict';

/**
 * Industrial Flowmeter Selection & Sizing Engine.
 *
 * Implements physics and sizing models for:
 * 1. Coriolis Mass Flowmeter (dual bent/straight tube, mass flow, Delta P, zero stability error)
 * 2. Ultrasonic Multipath Gas Flowmeter (AGA Report No. 9 / ISO 17089-1 chordal paths, velocity limits, SOS diagnostics)
 * 3. Vortex Shedding Flowmeter (von Kármán Strouhal number, minimum Re >= 20,000, dynamic pressure limit)
 * 4. Turbine Flowmeter (AGA Report No. 7 / ISO 9951, K-factor, viscosity limits)
 * 5. Electromagnetic Flowmeter (Faraday's law, minimum conductivity >= 5 uS/cm, zero Delta P)
 *
 * Provides automated technology screening, multi-attribute evaluation, and sizing diagnostics.
 */

const FLOWMETER_TECHNOLOGIES = Object.freeze({
  CORIOLIS: 'coriolis',
  ULTRASONIC_MULTIPATH: 'ultrasonic_multipath',
  VORTEX: 'vortex',
  TURBINE: 'turbine',
  ELECTROMAGNETIC: 'electromagnetic',
  DIFFERENTIAL_PRESSURE: 'differential_pressure'
});

const FLUID_PHASES = Object.freeze({
  LIQUID: 'liquid',
  GAS: 'gas',
  STEAM: 'steam',
  TWO_PHASE: 'two_phase',
  SLURRY: 'slurry'
});

/**
 * Standard Coriolis meter catalog parameters across nominal sizes DN15 to DN300.
 */
const CORIOLIS_CATALOG = Object.freeze({
  DN15: { nominalDiameterMm: 15, maxFlowKgH: 3500, zeroStabilityKgH: 0.05, tubeInnerMm: 8.0, lengthM: 0.35 },
  DN25: { nominalDiameterMm: 25, maxFlowKgH: 12000, zeroStabilityKgH: 0.15, tubeInnerMm: 14.0, lengthM: 0.45 },
  DN40: { nominalDiameterMm: 40, maxFlowKgH: 30000, zeroStabilityKgH: 0.40, tubeInnerMm: 22.0, lengthM: 0.55 },
  DN50: { nominalDiameterMm: 50, maxFlowKgH: 60000, zeroStabilityKgH: 0.90, tubeInnerMm: 30.0, lengthM: 0.65 },
  DN80: { nominalDiameterMm: 80, maxFlowKgH: 150000, zeroStabilityKgH: 2.50, tubeInnerMm: 48.0, lengthM: 0.80 },
  DN100: { nominalDiameterMm: 100, maxFlowKgH: 300000, zeroStabilityKgH: 5.50, tubeInnerMm: 62.0, lengthM: 0.95 },
  DN150: { nominalDiameterMm: 150, maxFlowKgH: 750000, zeroStabilityKgH: 14.0, tubeInnerMm: 95.0, lengthM: 1.20 },
  DN200: { nominalDiameterMm: 200, maxFlowKgH: 1500000, zeroStabilityKgH: 32.0, tubeInnerMm: 130.0, lengthM: 1.50 },
  DN250: { nominalDiameterMm: 250, maxFlowKgH: 2500000, zeroStabilityKgH: 60.0, tubeInnerMm: 165.0, lengthM: 1.80 },
  DN300: { nominalDiameterMm: 300, maxFlowKgH: 4000000, zeroStabilityKgH: 100.0, tubeInnerMm: 200.0, lengthM: 2.10 }
});

/**
 * Coriolis Mass Flowmeter sizing calculation.
 */
function sizeCoriolisMeter({
  massFlowKgH,
  densityKgM3,
  viscosityCp = 1.0,
  lineSizeMm = 100,
  baseAccuracyPercent = 0.10
}) {
  if (massFlowKgH <= 0 || densityKgM3 <= 0) {
    throw new RangeError('Mass flow and density must be positive');
  }

  const qmKgS = massFlowKgH / 3600.0;
  const qvM3S = qmKgS / densityKgM3;

  // Find best fitting meter size based on target tube velocity (typically 2.0 to 6.0 m/s)
  let selectedKey = null;
  const keys = Object.keys(CORIOLIS_CATALOG);

  for (const key of keys) {
    const meter = CORIOLIS_CATALOG[key];
    const dTubeM = meter.tubeInnerMm / 1000.0;
    const singleTubeArea = (Math.PI / 4.0) * dTubeM * dTubeM;
    const totalTubeArea = 2.0 * singleTubeArea;
    const v = qvM3S / totalTubeArea;
    if (v <= 6.5 && massFlowKgH <= meter.maxFlowKgH * 1.25) {
      selectedKey = key;
      break;
    }
  }

  if (!selectedKey) {
    // Pick the size that gives velocity closest to 4.0 m/s
    let bestDiff = Infinity;
    for (const key of keys) {
      const meter = CORIOLIS_CATALOG[key];
      const dTubeM = meter.tubeInnerMm / 1000.0;
      const singleTubeArea = (Math.PI / 4.0) * dTubeM * dTubeM;
      const totalTubeArea = 2.0 * singleTubeArea;
      const v = qvM3S / totalTubeArea;
      const diff = Math.abs(v - 4.0);
      if (diff < bestDiff) {
        bestDiff = diff;
        selectedKey = key;
      }
    }
  }

  const spec = CORIOLIS_CATALOG[selectedKey];
  const dTubeM = spec.tubeInnerMm / 1000.0;
  const singleTubeArea = (Math.PI / 4.0) * dTubeM * dTubeM;
  const totalTubeArea = 2.0 * singleTubeArea;
  const velocityMS = qvM3S / totalTubeArea;

  // Tube friction and pressure drop: Delta P = (f * L / D + K_split) * (rho * v^2 / 2)
  const muPaS = viscosityCp * 1e-3;
  const reynoldsTube = (densityKgM3 * velocityMS * dTubeM) / muPaS;
  const frictionFactor = reynoldsTube < 2300 ? 64.0 / Math.max(1, reynoldsTube) : 0.3164 * Math.pow(Math.max(1, reynoldsTube), -0.25);
  const kManifold = 4.5; // Flow splitter and bends
  const deltaPPa = (frictionFactor * (spec.lengthM / dTubeM) + kManifold) * 0.5 * densityKgM3 * velocityMS * velocityMS;
  const deltaPBar = deltaPPa / 1e5;

  // Total measurement uncertainty including zero stability
  const zeroErrorPercent = (spec.zeroStabilityKgH / massFlowKgH) * 100.0;
  const totalUncertaintyPercent = baseAccuracyPercent + zeroErrorPercent;

  // Turndown ratio from maxFlow
  const turndownAchieved = spec.maxFlowKgH / massFlowKgH;

  return {
    technology: FLOWMETER_TECHNOLOGIES.CORIOLIS,
    selectedSize: selectedKey,
    meterDiameterMm: spec.nominalDiameterMm,
    massFlowKgH,
    densityKgM3,
    tubeVelocityMS: velocityMS,
    tubeReynoldsNumber: reynoldsTube,
    pressureDropPa: deltaPPa,
    pressureDropBar: deltaPBar,
    zeroStabilityKgH: spec.zeroStabilityKgH,
    zeroStabilityErrorPercent: zeroErrorPercent,
    totalUncertaintyPercent,
    turndownRatio: turndownAchieved,
    suitability: velocityMS <= 7.0 && deltaPBar <= 1.5 ? 'EXCELLENT' : velocityMS <= 10.0 ? 'ACCEPTABLE' : 'HIGH_PRESSURE_DROP',
    straightRunRequiredUpstreamD: 0,
    straightRunRequiredDownstreamD: 0
  };
}

/**
 * Ultrasonic Multipath Flowmeter sizing per AGA Report No. 9 / ISO 17089-1.
 * Evaluates 4-path chordal transit time geometry, chordal velocity profiles, and limits.
 */
function sizeUltrasonicMultipath({
  pipeDiameterMm,
  volumeFlowM3H,
  operatingPressureBar,
  operatingTempC,
  gasDensityKgM3,
  speedOfSoundMS = 400.0,
  pathConfiguration = 4
}) {
  if (pipeDiameterMm <= 0 || volumeFlowM3H <= 0 || gasDensityKgM3 <= 0) {
    throw new RangeError('Pipe diameter, volume flow, and density must be positive');
  }

  const D = pipeDiameterMm / 1000.0;
  const pipeArea = (Math.PI / 4.0) * D * D;
  const qvM3S = volumeFlowM3H / 3600.0;
  const meanVelocityMS = qvM3S / pipeArea;

  // AGA 9 velocity thresholds
  const vMinAga9 = 0.3; // Low velocity cutoff
  const vMaxContinuousAga9 = 30.0; // Recommended upper continuous limit
  const vMaxPeakAga9 = 35.0; // Emergency peak limit

  let velocityStatus = 'OK';
  if (meanVelocityMS < vMinAga9) {
    velocityStatus = 'LOW_FLOW_BELOW_AGA9_MIN';
  } else if (meanVelocityMS > vMaxPeakAga9) {
    velocityStatus = 'EXCEEDS_PEAK_LIMIT_AGA9';
  } else if (meanVelocityMS > vMaxContinuousAga9) {
    velocityStatus = 'HIGH_VELOCITY_OVER_30MS';
  }

  // 4-path Gauss-Chebyshev / British Gas chordal geometry
  // Normalized chord heights yi / R: [-0.809, -0.309, +0.309, +0.809]
  // Quadrature weights wi: [0.1382, 0.3618, 0.3618, 0.1382]
  const chordNormalizedY = [-0.809, -0.309, 0.309, 0.809];
  const chordWeights = [0.1382, 0.3618, 0.3618, 0.1382];
  const pathAngleRad = (45.0 * Math.PI) / 180.0; // Typical 45 degree tilt

  const paths = [];
  let pathVelocitySum = 0;

  for (let i = 0; i < 4; i++) {
    const yNorm = chordNormalizedY[i];
    const halfChordM = (D / 2.0) * Math.sqrt(Math.max(0.01, 1.0 - yNorm * yNorm));
    const pathLengthM = (2.0 * halfChordM) / Math.sin(pathAngleRad);

    // Approximate fully developed turbulent profile: v(r) = v_max * (1 - r/R)^(1/7)
    const rNorm = Math.abs(yNorm);
    const localChordVel = meanVelocityMS * 1.18 * Math.pow(Math.max(0.05, 1.0 - rNorm), 1.0 / 7.0);

    // Transit times: t_ab = L / (c + v*cos(theta)), t_ba = L / (c - v*cos(theta))
    const vProj = localChordVel * Math.cos(pathAngleRad);
    const t_ab = pathLengthM / (speedOfSoundMS + vProj);
    const t_ba = pathLengthM / (speedOfSoundMS - vProj);
    const deltaT = t_ba - t_ab;

    // Measured chord velocity and path SOS
    const measuredVel = (pathLengthM / (2.0 * Math.cos(pathAngleRad))) * (1.0 / t_ab - 1.0 / t_ba);
    const measuredSos = (pathLengthM / 2.0) * (1.0 / t_ab + 1.0 / t_ba);

    paths.push({
      pathIndex: i + 1,
      normalizedElevation: yNorm,
      weight: chordWeights[i],
      pathLengthM,
      chordVelocityMS: localChordVel,
      transitTimeForwardUs: t_ab * 1e6,
      transitTimeReverseUs: t_ba * 1e6,
      deltaTimeNs: deltaT * 1e9,
      pathSpeedOfSoundMS: measuredSos
    });

    pathVelocitySum += chordWeights[i] * localChordVel;
  }

  // AGA 9 Speed of Sound (SOS) Diagnostic check
  const pathSosValues = paths.map((p) => p.pathSpeedOfSoundMS);
  const minSos = Math.min(...pathSosValues);
  const maxSos = Math.max(...pathSosValues);
  const maxSosSpread = maxSos - minSos;
  const sosSpreadStatus = maxSosSpread <= 0.5 ? 'NORMAL' : 'PATH_SOS_DEVIATION_HIGH';

  // Pressure drop across ultrasonic meter is essentially pipe friction
  const frictionFactor = 0.014;
  const meterBodyLengthM = 3.0 * D;
  const deltaPPa = frictionFactor * (meterBodyLengthM / D) * 0.5 * gasDensityKgM3 * meanVelocityMS * meanVelocityMS;

  return {
    technology: FLOWMETER_TECHNOLOGIES.ULTRASONIC_MULTIPATH,
    standardReference: 'AGA Report No. 9 / ISO 17089-1',
    pipeDiameterMm,
    volumeFlowM3H,
    gasDensityKgM3,
    meanVelocityMS,
    velocityStatus,
    speedOfSoundTheoreticalMS: speedOfSoundMS,
    maxSosSpreadBetweenPathsMS: maxSosSpread,
    sosSpreadStatus,
    straightRunRequiredUpstreamD: 10, // With CPA 50E flow conditioner
    straightRunRequiredDownstreamD: 3,
    pressureDropPa: deltaPPa,
    pressureDropBar: deltaPPa / 1e5,
    custodyTransferApproved: velocityStatus === 'OK' && sosSpreadStatus === 'NORMAL',
    baseUncertaintyPercent: 0.15, // Fiscal grade multipath
    chordalPaths: paths
  };
}

/**
 * Vortex Shedding Flowmeter sizing.
 * Physics: Strouhal shedding frequency f = St * v / d_bluff.
 * Minimum Reynolds number Re >= 20,000 for linear Strouhal number.
 */
function sizeVortexMeter({
  pipeDiameterMm,
  volumeFlowM3H,
  densityKgM3,
  viscosityCp = 1.0,
  fluidPhase = FLUID_PHASES.LIQUID
}) {
  if (pipeDiameterMm <= 0 || volumeFlowM3H <= 0 || densityKgM3 <= 0) {
    throw new RangeError('Pipe diameter, volume flow, and density must be positive');
  }

  const D = pipeDiameterMm / 1000.0;
  const pipeArea = (Math.PI / 4.0) * D * D;
  const qvM3S = volumeFlowM3H / 3600.0;
  const velocityMS = qvM3S / pipeArea;

  const muPaS = viscosityCp * 1e-3;
  const ReD = (densityKgM3 * velocityMS * D) / muPaS;

  // Bluff body geometry: typical width d_b ~ 0.28 * D
  const bluffBodyWidthM = 0.28 * D;
  const blockageRatio = bluffBodyWidthM / D;
  const bluffBodyVelocityMS = velocityMS / (1.0 - blockageRatio);
  const strouhal = 0.205; // Constant for Re > 20,000

  // Shedding frequency based on approach velocity and bluff body width
  const sheddingFrequencyHz = (strouhal * velocityMS) / bluffBodyWidthM;

  // Dynamic pressure (rho * v^2): vortex sensor needs minimum 50 Pa to detect vortex pulses
  const dynamicPressurePa = densityKgM3 * velocityMS * velocityMS;
  const minDynamicPressureThreshold = 50.0;

  // Minimum Reynolds number check: Re >= 20,000 per ASME MFC-6M / ISO 7145
  const isReynoldsSufficient = ReD >= 20000;
  const isDynamicPressureSufficient = dynamicPressurePa >= minDynamicPressureThreshold;

  // Upper velocity limits: liquid < 9 m/s (cavitation limit), gas < 80 m/s
  const maxVelAllowed = fluidPhase === FLUID_PHASES.LIQUID ? 9.0 : 80.0;
  const isVelocityWithinLimit = velocityMS <= maxVelAllowed;

  let feasibilityStatus = 'FEASIBLE';
  const warnings = [];

  if (!isReynoldsSufficient) {
    feasibilityStatus = 'INSUFFICIENT_REYNOLDS';
    warnings.push(`Reynolds number (${ReD.toFixed(0)}) < 20,000. Vortex shedding is non-linear or absent.`);
  }
  if (!isDynamicPressureSufficient) {
    if (feasibilityStatus === 'FEASIBLE') {
      feasibilityStatus = 'LOW_SIGNAL_DYNAMIC_PRESSURE';
    }
    warnings.push(`Dynamic pressure (${dynamicPressurePa.toFixed(1)} Pa) < 50 Pa. Sensor cannot reliably detect vortices.`);
  }
  if (!isVelocityWithinLimit) {
    if (feasibilityStatus === 'FEASIBLE') {
      feasibilityStatus = 'EXCEEDS_MAX_VELOCITY';
    }
    warnings.push(`Velocity (${velocityMS.toFixed(2)} m/s) exceeds maximum limit (${maxVelAllowed} m/s). Risk of cavitation or fatigue.`);
  }

  // Pressure drop: typical head loss K_factor ~ 2.0
  const deltaPPa = 2.0 * 0.5 * densityKgM3 * velocityMS * velocityMS;

  // Pulses per unit volume (K-factor in pulses/m3)
  const kFactorPulsesM3 = qvM3S > 0 ? sheddingFrequencyHz / qvM3S : 0;

  return {
    technology: FLOWMETER_TECHNOLOGIES.VORTEX,
    pipeDiameterMm,
    velocityMS,
    bluffBodyVelocityMS,
    blockageRatio,
    reynoldsNumber: ReD,
    bluffBodyWidthMm: bluffBodyWidthM * 1000.0,
    strouhalNumber: strouhal,
    sheddingFrequencyHz,
    kFactorPulsesM3,
    dynamicPressurePa,
    pressureDropPa: deltaPPa,
    pressureDropBar: deltaPPa / 1e5,
    isReynoldsSufficient,
    isDynamicPressureSufficient,
    isVelocityWithinLimit,
    feasibilityStatus,
    warnings,
    straightRunRequiredUpstreamD: 15,
    straightRunRequiredDownstreamD: 5,
    turndownRatio: 15.0,
    typicalUncertaintyPercent: fluidPhase === FLUID_PHASES.LIQUID ? 0.75 : 1.0
  };
}

/**
 * Electromagnetic Flowmeter sizing per Faraday's Law.
 * Physics: U_e = B * D * v. Requires fluid electrical conductivity >= 5 uS/cm.
 */
function sizeElectromagneticMeter({
  pipeDiameterMm,
  volumeFlowM3H,
  conductivityUSCm,
  densityKgM3 = 1000.0
}) {
  if (pipeDiameterMm <= 0 || volumeFlowM3H <= 0) {
    throw new RangeError('Pipe diameter and volume flow must be positive');
  }

  const D = pipeDiameterMm / 1000.0;
  const pipeArea = (Math.PI / 4.0) * D * D;
  const qvM3S = volumeFlowM3H / 3600.0;
  const velocityMS = qvM3S / pipeArea;

  const minConductivityThreshold = 5.0; // uS/cm
  const isConductive = (conductivityUSCm || 0) >= minConductivityThreshold;

  // Standard recommended velocity range: 1.0 to 5.0 m/s (acceptable 0.3 to 10 m/s)
  let velocityQuality = 'OPTIMAL';
  if (velocityMS < 0.3) {
    velocityQuality = 'TOO_LOW_BELOW_0_3MS';
  } else if (velocityMS < 1.0) {
    velocityQuality = 'LOW_FLOW';
  } else if (velocityMS > 10.0) {
    velocityQuality = 'EXCESSIVE_VELOCITY';
  } else if (velocityMS > 5.0) {
    velocityQuality = 'HIGH_VELOCITY';
  }

  // Induced voltage: U_e = B * D * v (typical B ~ 0.05 Tesla)
  const magneticFieldTesla = 0.05;
  const inducedVoltageMicroVolts = magneticFieldTesla * D * velocityMS * 1e6;

  // Magmeters have zero constriction -> pressure drop is purely straight pipe friction
  const deltaPPa = 0.018 * 2.0 * 0.5 * densityKgM3 * velocityMS * velocityMS;

  const warnings = [];
  if (!isConductive) {
    warnings.push(
      `Fluid conductivity (${conductivityUSCm || 0} uS/cm) is below minimum threshold (5 uS/cm). Hydrocarbons, gas, and deionized water cannot be measured by electromagnetic flowmeters.`
    );
  }

  return {
    technology: FLOWMETER_TECHNOLOGIES.ELECTROMAGNETIC,
    pipeDiameterMm,
    velocityMS,
    fluidConductivityUSCm: conductivityUSCm || 0,
    isConductivitySufficient: isConductive,
    inducedVoltageMicroVolts,
    pressureDropPa: deltaPPa,
    pressureDropBar: deltaPPa / 1e5,
    velocityQuality,
    warnings,
    straightRunRequiredUpstreamD: 5,
    straightRunRequiredDownstreamD: 2,
    turndownRatio: 20.0,
    baseUncertaintyPercent: 0.30
  };
}

/**
 * Turbine Flowmeter sizing per ISO 9951 / AGA Report No. 7.
 */
function sizeTurbineMeter({
  pipeDiameterMm,
  volumeFlowM3H,
  viscosityCp = 1.0,
  densityKgM3 = 800.0,
  cleanFluid = true
}) {
  if (pipeDiameterMm <= 0 || volumeFlowM3H <= 0) {
    throw new RangeError('Pipe diameter and volume flow must be positive');
  }

  const D = pipeDiameterMm / 1000.0;
  const pipeArea = (Math.PI / 4.0) * D * D;
  const qvM3S = volumeFlowM3H / 3600.0;
  const velocityMS = qvM3S / pipeArea;

  const muPaS = viscosityCp * 1e-3;
  const kinematicViscosityCSt = (muPaS / densityKgM3) * 1e6;

  const warnings = [];
  if (!cleanFluid) {
    warnings.push('Fluid contains particulates or dirty solids. Turbine rotor bearings will suffer rapid wear or jamming.');
  }
  if (kinematicViscosityCSt > 10.0) {
    warnings.push(`Kinematic viscosity (${kinematicViscosityCSt.toFixed(1)} cSt) > 10 cSt. Boundary layer shift degrades linearity.`);
  }

  // Pressure drop: rotor pressure drop K ~ 1.5
  const deltaPPa = 1.5 * 0.5 * densityKgM3 * velocityMS * velocityMS;

  return {
    technology: FLOWMETER_TECHNOLOGIES.TURBINE,
    pipeDiameterMm,
    velocityMS,
    kinematicViscosityCSt,
    pressureDropPa: deltaPPa,
    pressureDropBar: deltaPPa / 1e5,
    warnings,
    straightRunRequiredUpstreamD: 10,
    straightRunRequiredDownstreamD: 5,
    turndownRatio: 10.0,
    baseUncertaintyPercent: 0.50
  };
}

/**
 * Master multi-criteria flowmeter selection and rating engine.
 *
 * @param {Object} input - Comprehensive process conditions and specifications
 * @returns {Object} Ranked options with sizing results and engineering justification
 */
function selectFlowmeter(input) {
  const {
    fluidPhase = FLUID_PHASES.LIQUID,
    fluidName = 'Generic Fluid',
    massFlowKgH,
    volumeFlowM3H,
    operatingPressureBar = 10.0,
    operatingTempC = 20.0,
    densityKgM3,
    viscosityCp = 1.0,
    conductivityUSCm = 0.0,
    pipeDiameterMm = 100,
    allowableDeltaPBar = 1.0,
    requiredAccuracyPercent = 1.0,
    isCustodyTransfer = false,
    hasSolids = false,
    straightRunUpstreamD = 20,
    straightRunDownstreamD = 5
  } = input;

  if ((!massFlowKgH && !volumeFlowM3H) || !densityKgM3) {
    throw new Error('Must provide either massFlowKgH or volumeFlowM3H, and densityKgM3');
  }

  const effectiveMassFlowKgH = massFlowKgH || volumeFlowM3H * densityKgM3;
  const effectiveVolumeFlowM3H = volumeFlowM3H || effectiveMassFlowKgH / densityKgM3;

  const evaluations = [];

  // 1. Evaluate Coriolis
  try {
    const coriolis = sizeCoriolisMeter({
      massFlowKgH: effectiveMassFlowKgH,
      densityKgM3,
      viscosityCp,
      lineSizeMm: pipeDiameterMm
    });

    let score = 90;
    const disqualifications = [];
    if (coriolis.pressureDropBar > allowableDeltaPBar) {
      score -= 40;
      disqualifications.push(`Pressure drop (${coriolis.pressureDropBar.toFixed(2)} bar) exceeds allowable (${allowableDeltaPBar} bar).`);
    }
    if (fluidPhase === FLUID_PHASES.TWO_PHASE) {
      score -= 30; // Entrained gas damping
    }
    if (isCustodyTransfer) {
      score += 20; // Primary choice for custody transfer (especially liquid LNG mass custody)
    }

    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.CORIOLIS,
      title: 'Coriolis Mass Flowmeter',
      score: Math.max(0, score),
      isFeasible: disqualifications.length === 0,
      disqualifications,
      sizingResult: coriolis,
      recommended: disqualifications.length === 0 && (isCustodyTransfer || score >= 80),
      pros: ['Direct true mass flow measurement', 'High accuracy (0.1%)', 'No straight runs required', 'Integrated density and temp'],
      cons: ['Higher capital cost', 'Higher pressure drop at elevated velocities']
    });
  } catch (err) {
    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.CORIOLIS,
      score: 0,
      isFeasible: false,
      disqualifications: [err.message]
    });
  }

  // 2. Evaluate Ultrasonic Multipath (AGA Report No. 9 is specifically for gas measurement)
  if (fluidPhase === FLUID_PHASES.GAS) {
    try {
      const usm = sizeUltrasonicMultipath({
        pipeDiameterMm,
        volumeFlowM3H: effectiveVolumeFlowM3H,
        operatingPressureBar,
        operatingTempC,
        gasDensityKgM3: densityKgM3
      });

      let score = 85;
      const disqualifications = [];
      if (hasSolids) {
        score = 0;
        disqualifications.push('Solid particles scatter ultrasonic acoustic beam.');
      }
      if (straightRunUpstreamD < usm.straightRunRequiredUpstreamD) {
        score -= 25;
        disqualifications.push(`Insufficient upstream straight run (${straightRunUpstreamD}D available vs ${usm.straightRunRequiredUpstreamD}D required).`);
      }
      if (usm.velocityStatus !== 'OK') {
        score -= 35;
        disqualifications.push(`Velocity out of range: ${usm.velocityStatus}`);
      }
      if (isCustodyTransfer) {
        score += 20; // Prime choice for natural gas custody transfer per AGA 9
      }

      evaluations.push({
        technology: FLOWMETER_TECHNOLOGIES.ULTRASONIC_MULTIPATH,
        title: 'Multipath Ultrasonic Flowmeter (AGA 9)',
        score: Math.max(0, score),
        isFeasible: disqualifications.length === 0,
        disqualifications,
        sizingResult: usm,
        recommended: disqualifications.length === 0 && (isCustodyTransfer || score >= 75),
        pros: ['Negligible pressure drop', 'AGA 9 custody transfer approved', 'High turndown (>50:1)', 'Diagnostics via speed of sound'],
        cons: ['Requires straight pipe run and flow conditioner', 'Expensive in small pipe sizes (<DN100)']
      });
    } catch (err) {
      evaluations.push({
        technology: FLOWMETER_TECHNOLOGIES.ULTRASONIC_MULTIPATH,
        score: 0,
        isFeasible: false,
        disqualifications: [err.message]
      });
    }
  }

  // 3. Evaluate Vortex
  try {
    const vortex = sizeVortexMeter({
      pipeDiameterMm,
      volumeFlowM3H: effectiveVolumeFlowM3H,
      densityKgM3,
      viscosityCp,
      fluidPhase
    });

    let score = 75;
    const disqualifications = [...vortex.warnings];
    if (hasSolids) {
      score -= 30;
      disqualifications.push('Solids can erode or clog bluff body.');
    }
    if (straightRunUpstreamD < vortex.straightRunRequiredUpstreamD) {
      score -= 20;
      disqualifications.push(`Requires 15D upstream straight run (only ${straightRunUpstreamD}D available).`);
    }
    if (!vortex.isReynoldsSufficient || !vortex.isDynamicPressureSufficient) {
      score = 0;
    }
    if (isCustodyTransfer) {
      score -= 30; // Not accepted for custody transfer
    }

    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.VORTEX,
      title: 'Vortex Shedding Flowmeter',
      score: Math.max(0, score),
      isFeasible: disqualifications.length === 0,
      disqualifications,
      sizingResult: vortex,
      recommended: disqualifications.length === 0 && score >= 70,
      pros: ['No moving parts', 'Robust for steam, gas, clean liquids', 'Moderate cost', 'Good turndown (15:1)'],
      cons: ['Requires Re >= 20,000', 'Requires 15D straight run', 'Low signal at low flows']
    });
  } catch (err) {
    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.VORTEX,
      score: 0,
      isFeasible: false,
      disqualifications: [err.message]
    });
  }

  // 4. Evaluate Electromagnetic (Magmeter)
  try {
    const mag = sizeElectromagneticMeter({
      pipeDiameterMm,
      volumeFlowM3H: effectiveVolumeFlowM3H,
      conductivityUSCm,
      densityKgM3
    });

    let score = 80;
    const disqualifications = [...mag.warnings];
    if (!mag.isConductivitySufficient) {
      score = 0; // Absolute physical barrier
    }
    if (fluidPhase !== FLUID_PHASES.LIQUID && fluidPhase !== FLUID_PHASES.SLURRY) {
      score = 0;
      disqualifications.push('Electromagnetic meters only operate on conductive liquids or slurries.');
    }

    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.ELECTROMAGNETIC,
      title: 'Electromagnetic Flowmeter (Magmeter)',
      score: Math.max(0, score),
      isFeasible: disqualifications.length === 0,
      disqualifications,
      sizingResult: mag,
      recommended: disqualifications.length === 0 && score >= 75,
      pros: ['Zero pressure drop', 'Obstructionless bore', 'Unaffected by viscosity or solids', 'Short straight run (5D/2D)'],
      cons: ['Strictly requires conductivity >= 5 uS/cm', 'Cannot measure hydrocarbons, gas, or steam']
    });
  } catch (err) {
    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.ELECTROMAGNETIC,
      score: 0,
      isFeasible: false,
      disqualifications: [err.message]
    });
  }

  // 5. Evaluate Turbine
  try {
    const turbine = sizeTurbineMeter({
      pipeDiameterMm,
      volumeFlowM3H: effectiveVolumeFlowM3H,
      viscosityCp,
      densityKgM3,
      cleanFluid: !hasSolids
    });

    let score = 65;
    const disqualifications = [...turbine.warnings];
    if (hasSolids) {
      score = 0;
    }
    if (isCustodyTransfer && fluidPhase === FLUID_PHASES.GAS) {
      score += 10;
    }

    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.TURBINE,
      title: 'Turbine Flowmeter',
      score: Math.max(0, score),
      isFeasible: disqualifications.length === 0,
      disqualifications,
      sizingResult: turbine,
      recommended: disqualifications.length === 0 && score >= 70,
      pros: ['High repeatability', 'Compact', 'Fast dynamic response'],
      cons: ['Moving parts subject to bearing wear', 'Requires upstream strainer', 'Sensitive to viscosity shifts']
    });
  } catch (err) {
    evaluations.push({
      technology: FLOWMETER_TECHNOLOGIES.TURBINE,
      score: 0,
      isFeasible: false,
      disqualifications: [err.message]
    });
  }

  // Sort by score descending
  evaluations.sort((a, b) => b.score - a.score);

  const bestOption = evaluations.find((e) => e.isFeasible) || evaluations[0];

  return {
    serviceName: fluidName,
    fluidPhase,
    massFlowKgH: effectiveMassFlowKgH,
    volumeFlowM3H: effectiveVolumeFlowM3H,
    pipeDiameterMm,
    isCustodyTransfer,
    recommendedTechnology: bestOption.technology,
    recommendationTitle: bestOption.title,
    rankedOptions: evaluations
  };
}

module.exports = {
  FLOWMETER_TECHNOLOGIES,
  FLUID_PHASES,
  CORIOLIS_CATALOG,
  sizeCoriolisMeter,
  sizeUltrasonicMultipath,
  sizeVortexMeter,
  sizeElectromagneticMeter,
  sizeTurbineMeter,
  selectFlowmeter
};
