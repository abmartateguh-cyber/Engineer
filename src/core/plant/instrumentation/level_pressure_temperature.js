'use strict';

/**
 * Level, Pressure, and Temperature Transmitter Engineering Engine.
 *
 * Implements:
 * 1. DP Level Transmitter Wet-Leg & Dry-Leg Zero/Span Calibration (mmH2O, kPa, mbar)
 * 2. Interface Level Measurement (immiscible hydrocarbon/water/amine phases)
 * 3. Guided-Wave Radar (GWR) & Non-Contact FMCW Radar evaluation (dielectric constant, beam spread)
 * 4. Pressure & DP Transmitter Rangeability and Manifold Selection
 * 5. Thermowell Wake-Frequency & Mechanical Stress Analysis per ASME PTC 19.3 TW-2016
 * 6. Temperature Sensor Selection (IEC 60751 Pt100 RTD Callendar-Van Dusen vs IEC 60584 Thermocouples)
 */

const GRAVITY = 9.80665; // Standard acceleration of gravity [m/s^2]
const PA_TO_MMH2O = 1.0 / 9.80665;
const MMH2O_TO_KPA = 0.00980665;

// ============================================================================
// 1. DIFFERENTIAL PRESSURE LEVEL CALIBRATION (WET-LEG & DRY-LEG)
// ============================================================================

/**
 * Calibrate Dry-Leg DP Level Transmitter.
 * Used for closed vessels containing non-condensing gas/vapor.
 *
 * @param {Object} input
 * @param {number} input.hSpanMm - Maximum liquid level span [mm]
 * @param {number} input.hMinMm - Minimum liquid level elevation above bottom tap [mm]
 * @param {number} input.processDensityKgM3 - Process liquid density [kg/m3]
 * @param {number} [input.vaporDensityKgM3=0] - Vessel gas/vapor density [kg/m3]
 * @returns {Object} Calibration range (LRV, URV, Span in Pa, kPa, mmH2O)
 */
function calibrateDryLeg({
  hSpanMm,
  hMinMm = 0,
  processDensityKgM3,
  vaporDensityKgM3 = 1.2
}) {
  if (hSpanMm <= 0 || processDensityKgM3 <= 0) {
    throw new RangeError('Span and liquid density must be positive');
  }

  const effectiveDeltaDensity = Math.max(0, processDensityKgM3 - vaporDensityKgM3);

  // At 0% level (minimum level elevation hMin):
  // P_HP = P_gas + rho_proc * g * (hMin) + rho_vap * g * (hSpan)
  // P_LP = P_gas + rho_vap * g * (hSpan + hMin)
  // Delta_P_zero = P_HP - P_LP = (rho_proc - rho_vap) * g * hMin
  const lrvPa = effectiveDeltaDensity * GRAVITY * (hMinMm / 1000.0);

  // At 100% level:
  // Delta_P_100 = Delta_P_zero + (rho_proc - rho_vap) * g * hSpan
  const spanPa = effectiveDeltaDensity * GRAVITY * (hSpanMm / 1000.0);
  const urvPa = lrvPa + spanPa;

  return {
    method: 'dry_leg',
    spanMm: hSpanMm,
    hMinMm,
    processDensityKgM3,
    vaporDensityKgM3,
    lrvPa,
    urvPa,
    spanPa,
    lrvKPa: lrvPa / 1000.0,
    urvKPa: urvPa / 1000.0,
    spanKPa: spanPa / 1000.0,
    lrvMmH2O: lrvPa * PA_TO_MMH2O,
    urvMmH2O: urvPa * PA_TO_MMH2O,
    spanMmH2O: spanPa * PA_TO_MMH2O,
    zeroSuppression: lrvPa > 0,
    zeroElevation: lrvPa < 0
  };
}

/**
 * Calibrate Wet-Leg DP Level Transmitter.
 * Used for closed vessels with condensing vapors (e.g., steam drums, LNG vessels, reflux drums).
 *
 * @param {Object} input
 * @param {number} input.hSpanMm - Maximum liquid level span [mm]
 * @param {number} input.hMinMm - Minimum liquid level elevation above bottom tap [mm]
 * @param {number} input.tapDistanceMm - Total vertical distance between high and low taps [mm]
 * @param {number} input.processDensityKgM3 - Process liquid density [kg/m3]
 * @param {number} input.fillFluidDensityKgM3 - Reference seal liquid density in wet leg [kg/m3]
 * @param {number} [input.vaporDensityKgM3=1.2] - Gas/vapor density [kg/m3]
 * @returns {Object} Calibration range (LRV, URV, Span in Pa, kPa, mmH2O)
 */
function calibrateWetLeg({
  hSpanMm,
  hMinMm = 0,
  tapDistanceMm,
  processDensityKgM3,
  fillFluidDensityKgM3,
  vaporDensityKgM3 = 1.2
}) {
  if (hSpanMm <= 0 || tapDistanceMm <= 0 || processDensityKgM3 <= 0 || fillFluidDensityKgM3 <= 0) {
    throw new RangeError('Span, tap distance, process density, and fill density must be positive');
  }
  if (hMinMm + hSpanMm > tapDistanceMm) {
    throw new RangeError(`Total level height (hMin + span = ${hMinMm + hSpanMm} mm) exceeds tap distance (${tapDistanceMm} mm)`);
  }

  const L = tapDistanceMm / 1000.0;
  const hMin = hMinMm / 1000.0;
  const hSpan = hSpanMm / 1000.0;

  // Wet leg (LP side) is filled to elevation L with fill fluid:
  // P_LP = P_gas + fillFluidDensity * g * L
  // HP side at 0% level:
  // P_HP = P_gas + processDensity * g * hMin + vaporDensity * g * (L - hMin)
  // Delta_P = P_HP - P_LP
  const lrvPa = (processDensityKgM3 - vaporDensityKgM3) * GRAVITY * hMin - (fillFluidDensityKgM3 - vaporDensityKgM3) * GRAVITY * L;

  // At 100% level:
  // P_HP = P_gas + processDensity * g * (hMin + hSpan) + vaporDensity * g * (L - hMin - hSpan)
  const urvPa = (processDensityKgM3 - vaporDensityKgM3) * GRAVITY * (hMin + hSpan) - (fillFluidDensityKgM3 - vaporDensityKgM3) * GRAVITY * L;
  const spanPa = urvPa - lrvPa;

  return {
    method: 'wet_leg',
    spanMm: hSpanMm,
    hMinMm,
    tapDistanceMm,
    processDensityKgM3,
    fillFluidDensityKgM3,
    vaporDensityKgM3,
    lrvPa,
    urvPa,
    spanPa,
    lrvKPa: lrvPa / 1000.0,
    urvKPa: urvPa / 1000.0,
    spanKPa: spanPa / 1000.0,
    lrvMmH2O: lrvPa * PA_TO_MMH2O,
    urvMmH2O: urvPa * PA_TO_MMH2O,
    spanMmH2O: spanPa * PA_TO_MMH2O,
    zeroElevation: lrvPa < 0,
    elevationMmH2O: Math.abs(Math.min(0, lrvPa * PA_TO_MMH2O))
  };
}

/**
 * Calibrate Interface Level DP Transmitter for two immiscible liquid phases.
 * (e.g., amine/hydrocarbon separator, water/condensate separator).
 */
function calibrateInterfaceLevel({
  hSpanMm,
  tapDistanceMm,
  heavyDensityKgM3,
  lightDensityKgM3,
  vaporDensityKgM3 = 1.2
}) {
  if (heavyDensityKgM3 <= lightDensityKgM3) {
    throw new RangeError('Heavy phase density must exceed light phase density');
  }

  const hSpan = hSpanMm / 1000.0;
  // Span is solely driven by density difference between heavy and light liquids
  const spanPa = (heavyDensityKgM3 - lightDensityKgM3) * GRAVITY * hSpan;

  // For flooded upper tap with light phase:
  // At 0% interface (vessel 100% light phase): Delta_P_zero = 0 (referenced to light phase)
  const lrvPa = 0;
  const urvPa = spanPa;

  return {
    method: 'interface_level',
    heavyDensityKgM3,
    lightDensityKgM3,
    densityDifferenceKgM3: heavyDensityKgM3 - lightDensityKgM3,
    spanMm: hSpanMm,
    lrvPa,
    urvPa,
    spanPa,
    lrvKPa: lrvPa / 1000.0,
    urvKPa: urvPa / 1000.0,
    spanKPa: spanPa / 1000.0,
    spanMmH2O: spanPa * PA_TO_MMH2O
  };
}

// ============================================================================
// 2. RADAR & GUIDED-WAVE RADAR (GWR) SELECTION
// ============================================================================

/**
 * Radar Level Measurement Evaluation.
 * Evaluates dielectric constant reflection and beam geometry.
 */
function evaluateRadarLevel({
  dielectricConstant,
  vesselHeightM,
  nozzleDiameterMm = 100,
  nozzleHeightMm = 150,
  isCryogenic = false,
  isFoaming = false,
  isTurbulent = false,
  hasInternalObstructions = false
}) {
  if (dielectricConstant < 1.1) {
    throw new RangeError(`Dielectric constant (${dielectricConstant}) is too low for radar reflection (min 1.2)`);
  }

  // Reflection coefficient at liquid surface: Gamma = (1 - sqrt(er)) / (1 + sqrt(er))
  const sqrtEr = Math.sqrt(dielectricConstant);
  const reflectionCoefficient = Math.abs((1.0 - sqrtEr) / (1.0 + sqrtEr));
  const reflectedPowerPercent = reflectionCoefficient * reflectionCoefficient * 100.0;

  // 80 GHz Non-contact radar beam spread angle: theta ~ 70 * lambda / D_ant
  // For 80 GHz, lambda = 3.75 mm; for DN80 antenna (D ~ 75 mm), theta ~ 3.5 to 4 degrees
  const beamAngleDeg = 4.0;
  const beamRadiusAtBottomM = vesselHeightM * Math.tan((beamAngleDeg / 2.0) * (Math.PI / 180.0));

  let recommendedType = 'NON_CONTACT_80GHZ_FMCW';
  let probeType = 'LENS_ANTENNA';
  const recommendations = [];

  // Low dielectric constant (e.g., LNG er ~ 1.6 to 1.8, LPG er ~ 1.6 to 1.9)
  if (dielectricConstant < 1.9 || isCryogenic || isFoaming || hasInternalObstructions) {
    recommendedType = 'GUIDED_WAVE_RADAR';
    probeType = dielectricConstant < 1.8 ? 'COAXIAL_PROBE' : 'TWIN_ROD_OR_CABLE';
    recommendations.push(
      'Guided Wave Radar (GWR) with coaxial or twin probe recommended to concentrate microwave energy for low dielectric constant fluid.'
    );
  } else {
    recommendations.push('Non-contact 80 GHz FMCW radar provides non-intrusive measurement with narrow 4-degree beam angle.');
  }

  if (nozzleHeightMm > 1.5 * nozzleDiameterMm) {
    recommendations.push('Nozzle standoff exceeds 1.5D; ensure radar antenna horn extends below bottom lip of nozzle to prevent false echoes.');
  }

  return {
    dielectricConstant,
    reflectionCoefficient,
    reflectedPowerPercent,
    recommendedTechnology: recommendedType,
    probeOrAntennaType: probeType,
    beamAngleDegrees: beamAngleDeg,
    beamRadiusAtBottomM,
    recommendations
  };
}

// ============================================================================
// 3. PRESSURE TRANSMITTER SIZING & RANGE SELECTION
// ============================================================================

const STANDARD_URL_RANGES_BAR = Object.freeze([0.25, 1.0, 2.5, 6.0, 16.0, 40.0, 100.0, 250.0, 400.0, 700.0]);

/**
 * Pressure Transmitter Sizing & Calibration Span Selection.
 */
function sizePressureTransmitter({
  operatingPressureBarg,
  designPressureBarg,
  processTempC,
  processFluid = 'Hydrocarbon Gas',
  isDifferential = false,
  requiresDiaphragmSeal = false
}) {
  if (operatingPressureBarg < 0) {
    throw new RangeError('Operating pressure must be non-negative');
  }

  // Recommended operating point: 50% to 75% of Upper Range Limit (URL)
  const targetUrl = operatingPressureBarg / 0.65;
  let selectedUrl = STANDARD_URL_RANGES_BAR[STANDARD_URL_RANGES_BAR.length - 1];

  for (const url of STANDARD_URL_RANGES_BAR) {
    if (url >= targetUrl) {
      selectedUrl = url;
      break;
    }
  }

  // Calibrated range: 0 to URV (round URV up to clean engineering value)
  const urvBarg = Math.ceil(operatingPressureBarg * 1.3 * 10) / 10;
  const lrvBarg = 0.0;
  const spanBarg = urvBarg - lrvBarg;

  // Turndown ratio = URL / Span (standard transmitters support up to 50:1 or 100:1)
  const turndownRatio = selectedUrl / spanBarg;

  // Proof pressure / overpressure rating (typically 1.5x URL or design pressure)
  const proofPressureBarg = Math.max(1.5 * designPressureBarg, 1.5 * selectedUrl);

  // Manifold selection
  const manifoldType = isDifferential ? '5_VALVE_MANIFOLD' : '2_VALVE_MANIFOLD';

  // Diaphragm seal check: required for high temp (>200 C), cryogenic (<-40 C), slurry, or corrosive
  const sealNeeded = requiresDiaphragmSeal || processTempC < -40 || processTempC > 180;
  const sealFillFluid = processTempC < -40 ? 'SYLTHERM_XLT' : processTempC > 180 ? 'HIGH_TEMP_SILICONE_OIL' : 'DC_200_SILICONE';

  return {
    operatingPressureBarg,
    designPressureBarg,
    selectedUrlBarg: selectedUrl,
    calibratedLrvBarg: lrvBarg,
    calibratedUrvBarg: urvBarg,
    calibratedSpanBarg: spanBarg,
    turndownRatio,
    proofPressureBarg,
    manifoldType,
    requiresDiaphragmSeal: sealNeeded,
    recommendedFillFluid: sealNeeded ? sealFillFluid : 'NONE',
    referenceAccuracyPercent: 0.04
  };
}

// ============================================================================
// 4. ASME PTC 19.3 TW-2016 THERMOWELL WAKE-FREQUENCY & STRESS ANALYSIS
// ============================================================================

/**
 * Standard materials for thermowells per ASME PTC 19.3 TW.
 */
const THERMOWELL_MATERIALS = Object.freeze({
  SS316L: { densityKgM3: 8000, youngsModulusGpa: 195, poissonsRatio: 0.30, allowableStressMpa: 115 },
  INCONEL_625: { densityKgM3: 8440, youngsModulusGpa: 205, poissonsRatio: 0.31, allowableStressMpa: 185 },
  HASTELLOY_C276: { densityKgM3: 8890, youngsModulusGpa: 205, poissonsRatio: 0.31, allowableStressMpa: 170 },
  MONEL_400: { densityKgM3: 8800, youngsModulusGpa: 179, poissonsRatio: 0.32, allowableStressMpa: 125 },
  DUPLEX_2205: { densityKgM3: 7800, youngsModulusGpa: 200, poissonsRatio: 0.30, allowableStressMpa: 175 }
});

/**
 * ASME PTC 19.3 TW-2016 Thermowell calculation.
 *
 * @param {Object} input
 * @param {number} input.lengthMm - Unsupported shank length L [mm]
 * @param {number} input.rootDiameterMm - Root diameter A [mm]
 * @param {number} input.tipDiameterMm - Tip diameter B [mm]
 * @param {number} input.boreDiameterMm - Bore diameter d [mm]
 * @param {string} [input.materialKey='SS316L'] - Thermowell material
 * @param {number} input.fluidVelocityMS - Process fluid crossflow velocity [m/s]
 * @param {number} input.fluidDensityKgM3 - Process fluid density [kg/m3]
 * @param {number} input.fluidPressureBarg - Process operating pressure [barg]
 * @param {number} [input.fluidTempC=20] - Process operating temperature [degC]
 * @returns {Object} Comprehensive PTC 19.3 TW evaluation
 */
function checkThermowellAsmePtc19_3({
  lengthMm,
  rootDiameterMm,
  tipDiameterMm,
  boreDiameterMm,
  tipThicknessMm,
  materialKey = 'SS316L',
  fluidVelocityMS,
  fluidDensityKgM3,
  fluidPressureBarg = 10.0,
  fluidTempC = 20.0
}) {
  const mat = THERMOWELL_MATERIALS[materialKey] || THERMOWELL_MATERIALS.SS316L;

  const L = lengthMm / 1000.0;
  const A = rootDiameterMm / 1000.0;
  const B = tipDiameterMm / 1000.0;
  const d = boreDiameterMm / 1000.0;
  const tipThkMm = tipThicknessMm || Math.max(3.0, (tipDiameterMm - boreDiameterMm) / 2.0);
  const t_tip = tipThkMm / 1000.0;

  if (L <= 0 || A <= 0 || B <= 0 || d <= 0 || d >= B || B > A || t_tip <= 0) {
    throw new RangeError('Invalid thermowell geometry: require 0 < d < B <= A, t_tip > 0, and L > 0');
  }

  const Bavg = (A + B) / 2.0;
  const E = mat.youngsModulusGpa * 1e9; // Pa
  const rho_m = mat.densityKgM3;
  const rho_f = fluidDensityKgM3;

  // Strouhal vortex shedding frequency: fs = Ns * v / B (per Clause 6-4)
  const Ns = 0.22;
  const sheddingFrequencyHz = (Ns * fluidVelocityMS) / B;

  // Cross-sectional moment of inertia and mass per unit length (average along shank)
  const I_avg = (Math.PI / 64.0) * (Math.pow(Bavg, 4) - Math.pow(d, 4));
  const Acs_avg = (Math.PI / 4.0) * (Math.pow(Bavg, 2) - Math.pow(d, 2));
  const massPerUnitLength = rho_m * Acs_avg;

  // Taper factor Kf for natural frequency
  const taperRatio = B / A;
  // Approximation of PTC 19.3 Table 6-1 for cantilever beam taper factor
  const Kf = taperRatio === 1.0 ? 1.0 : 1.0 + 0.35 * (1.0 - taperRatio);

  // In vacuo natural frequency: fnv = (1.8751^2 / (2 * pi * L^2)) * sqrt(E * I / mu) * Kf
  const lambda1 = 1.8751;
  const fnv = (Math.pow(lambda1, 2) / (2.0 * Math.PI * L * L)) * Math.sqrt((E * I_avg) / massPerUnitLength) * Kf;

  // Fluid-mass loading correction factor Hf per Clause 6-5.3
  const fluidMassRatio = (rho_f * Bavg * Bavg) / (rho_m * (Bavg * Bavg - d * d));
  const Hf = 1.0 / Math.sqrt(1.0 + fluidMassRatio);

  // Corrected natural frequency in process fluid
  const fnc = fnv * Hf;

  // Frequency Ratios per ASME PTC 19.3 TW-2016 Clause 6-5.4:
  // Frequency ratio r = fs / fnc
  const frequencyRatio = sheddingFrequencyHz / fnc;
  // Transverse frequency ratio rt = fs / fnc. Criterion: rt <= 0.8
  const transverseRatio = frequencyRatio;
  // In-line frequency ratio ri = fs / fnc. Criterion: ri < 0.4 (or check Scruton number Nsc >= 2.5)
  const inlineRatio = frequencyRatio;
  const inlineExcitationRatio = (2.0 * sheddingFrequencyHz) / fnc;

  // Scruton number Nsc = 4 * pi * m * zeta / (rho_f * B^2) where structural damping zeta ~ 0.0005
  const dampingZeta = 0.0005;
  const scrutonNumber = (4.0 * Math.PI * massPerUnitLength * dampingZeta) / (rho_f * B * B);

  const passesTransverseResonance = transverseRatio <= 0.8;
  const passesInlineResonance = inlineRatio < 0.4 || scrutonNumber >= 2.5;

  // Stress Analysis (Clause 6-6)
  // Section modulus at root: Z = pi * (A^4 - d^4) / (32 * A)
  const Z_root = (Math.PI * (Math.pow(A, 4) - Math.pow(d, 4))) / (32.0 * A);

  // Steady-state drag force: Fd = 0.5 * Cd * rho_f * v^2 * Bavg * L
  const Cd_drag = 1.2; // Cylindrical shank drag coefficient
  const totalDragForceN = 0.5 * Cd_drag * rho_f * fluidVelocityMS * fluidVelocityMS * Bavg * L;
  const dragBendingMomentNm = totalDragForceN * (L / 2.0);
  const steadyDragStressMpa = (dragBendingMomentNm / Z_root) / 1e6;

  // Dynamic transverse lift stress: CL ~ 0.1
  const CL_lift = 0.1;
  const dynamicTransverseMomentNm = 0.5 * CL_lift * rho_f * fluidVelocityMS * fluidVelocityMS * Bavg * L * (L / 2.0);
  const dynamicTransverseStressMpa = (dynamicTransverseMomentNm / Z_root) / 1e6;

  // Dynamic amplification factor (DAF)
  const daf = 1.0 / Math.sqrt(Math.pow(1.0 - transverseRatio * transverseRatio, 2) + Math.pow(2.0 * dampingZeta * transverseRatio, 2));
  const amplifiedDynamicStressMpa = dynamicTransverseStressMpa * Math.min(daf, 50.0);

  // Combined peak stress at root
  const combinedMaxStressMpa = steadyDragStressMpa + amplifiedDynamicStressMpa;

  // Allowable fatigue stress limit: Sf ~ 0.5 * allowable
  const fatigueLimitMpa = mat.allowableStressMpa * 0.5;
  const passesStressCheck = combinedMaxStressMpa <= fatigueLimitMpa;

  // Tip stress under external hydrostatic pressure per Clause 6-6.3 & Clause 6-7:
  // Circular plate with clamped edges: sigma_tip = 0.1875 * P * (B / t_tip)^2
  const fluidPressurePa = fluidPressureBarg * 1e5;
  const tipStressMpa = (0.1875 * fluidPressurePa * Math.pow(B / t_tip, 2.0)) / 1e6;
  const passesTipStressCheck = tipStressMpa <= mat.allowableStressMpa;

  // External hydrostatic pressure limit (Clause 6-7)
  const allowableExtPressureBarg = 0.66 * mat.allowableStressMpa * 10.0 * ((B - d) / B);
  const passesPressureCheck = fluidPressureBarg <= allowableExtPressureBarg;

  const isCompliant = passesTransverseResonance && passesInlineResonance && passesStressCheck && passesPressureCheck && passesTipStressCheck;

  const failureReasons = [];
  if (!passesTransverseResonance) {
    failureReasons.push(`Transverse resonance ratio (${transverseRatio.toFixed(3)}) exceeds 0.8 limit.`);
  }
  if (!passesInlineResonance) {
    failureReasons.push(`In-line resonance ratio (${inlineRatio.toFixed(3)}) >= 0.4 and Scruton number (${scrutonNumber.toFixed(2)}) < 2.5.`);
  }
  if (!passesStressCheck) {
    failureReasons.push(`Combined shank stress (${combinedMaxStressMpa.toFixed(1)} MPa) exceeds fatigue limit (${fatigueLimitMpa.toFixed(1)} MPa).`);
  }
  if (!passesTipStressCheck) {
    failureReasons.push(`Tip stress (${tipStressMpa.toFixed(1)} MPa) exceeds material allowable (${mat.allowableStressMpa} MPa).`);
  }
  if (!passesPressureCheck) {
    failureReasons.push(`Fluid pressure (${fluidPressureBarg} barg) exceeds external rating (${allowableExtPressureBarg.toFixed(1)} barg).`);
  }

  return {
    standardReference: 'ASME PTC 19.3 TW-2016',
    materialKey,
    lengthMm,
    rootDiameterMm,
    tipDiameterMm,
    tipThicknessMm: tipThkMm,
    sheddingFrequencyHz,
    naturalFrequencyInFluidHz: fnc,
    naturalFrequencyInVacuoHz: fnv,
    transverseFrequencyRatio: transverseRatio,
    inlineFrequencyRatio: inlineRatio,
    inlineExcitationRatio,
    scrutonNumber,
    steadyDragStressMpa,
    amplifiedDynamicStressMpa,
    combinedMaxStressMpa,
    tipStressMpa,
    fatigueLimitStressMpa: fatigueLimitMpa,
    externalPressureRatingBarg: allowableExtPressureBarg,
    passesTransverseResonance,
    passesInlineResonance,
    passesStressCheck,
    passesTipStressCheck,
    passesPressureCheck,
    isCompliant,
    failureReasons,
    recommendedMitigation: isCompliant
      ? 'Thermowell design meets all ASME PTC 19.3 TW requirements.'
      : 'Shorten unsupported shank length L, increase root/tip diameter, increase tip thickness, or select higher-strength alloy.'
  };
}

// ============================================================================
// 5. TEMPERATURE SENSOR SELECTION (RTD Pt100 vs THERMOCOUPLE TYPE K/J/T/E)
// ============================================================================

/**
 * Callendar-Van Dusen equation for Pt100 RTD per IEC 60751:2008.
 *
 * @param {number} tempC - Temperature in degrees Celsius [-200 to +850]
 * @returns {number} Resistance in Ohms (nominal 100.00 Ohm at 0 C)
 */
function pt100ResistanceFromTemp(tempC) {
  const R0 = 100.0;
  const A = 3.9083e-3;
  const B = -5.775e-7;
  const C = -4.183e-12;

  if (tempC >= 0) {
    return R0 * (1.0 + A * tempC + B * tempC * tempC);
  }
  return R0 * (1.0 + A * tempC + B * tempC * tempC + C * (tempC - 100.0) * Math.pow(tempC, 3));
}

/**
 * Select temperature sensor technology based on range, accuracy, and process service.
 * Supports IEC 60751 Pt100 RTD and IEC 60584 Thermocouple Types K, J, T, and E.
 */
function selectTemperatureSensor({
  minTempC,
  maxTempC,
  accuracyRequiredC = 1.0,
  vibrationHigh = false,
  isCryogenic = false,
  atmosphere = 'inert', // 'inert', 'reducing', 'oxidizing', 'vacuum'
  requiresHighEmf = false
}) {
  const options = [];

  // 1. Pt100 RTD Class A (-100 to +450 C) and Class B (-196 to +600 C) per IEC 60751
  if (minTempC >= -200 && maxTempC <= 500) {
    const classATol = 0.15 + 0.002 * Math.max(Math.abs(minTempC), Math.abs(maxTempC));
    options.push({
      sensorType: 'RTD_PT100_CLASS_A',
      standard: 'IEC 60751',
      wiring: '4_WIRE',
      rangeMinC: -100,
      rangeMaxC: 450,
      toleranceAtOperatingC: classATol,
      recommended: !vibrationHigh && classATol <= accuracyRequiredC && !requiresHighEmf,
      suitability: isCryogenic ? 'HIGH_PRECISION_LNG_TRANSFER' : 'EXCELLENT_GENERAL_PROCESS',
      notes: 'Highest precision and stability; standard for custody transfer and cryogenic LNG run-down'
    });
  }

  // 2. Type T Thermocouple (Copper-Constantan): Excellent for cryogenic LNG (-200 to +350 C) per IEC 60584
  if (minTempC >= -200 && maxTempC <= 350) {
    const tolT = Math.max(0.5, 0.004 * Math.max(Math.abs(minTempC), Math.abs(maxTempC)));
    options.push({
      sensorType: 'THERMOCOUPLE_TYPE_T',
      standard: 'IEC 60584',
      rangeMinC: -200,
      rangeMaxC: 350,
      toleranceAtOperatingC: tolT,
      recommended: (isCryogenic || vibrationHigh) && !requiresHighEmf,
      suitability: 'BEST_CRYOGENIC_LNG_THERMOCOUPLE',
      notes: 'High moisture resistance and excellent repeatability in sub-zero and cryogenic LNG services'
    });
  }

  // 3. Type E Thermocouple (Chromel-Constantan): Highest thermoelectric EMF output (-200 to +900 C) per IEC 60584
  if (minTempC >= -200 && maxTempC <= 900) {
    const tolE = Math.max(1.5, 0.004 * Math.max(Math.abs(minTempC), Math.abs(maxTempC)));
    options.push({
      sensorType: 'THERMOCOUPLE_TYPE_E',
      standard: 'IEC 60584',
      rangeMinC: -200,
      rangeMaxC: 900,
      toleranceAtOperatingC: tolE,
      seebeckCoefficientUvPerC: 68.0,
      recommended: requiresHighEmf || (vibrationHigh && minTempC < -100 && maxTempC > 400),
      suitability: 'HIGHEST_EMF_SENSITIVITY_CRYOGENIC_TO_HIGH_TEMP',
      notes: 'Highest output voltage (~68 uV/C), non-magnetic, ideal for low-noise signals across cryogenic to 900C'
    });
  }

  // 4. Type J Thermocouple (Iron-Constantan): Ideal for reducing atmospheres (-40 to +750 C) per IEC 60584
  if (minTempC >= -40 && maxTempC <= 750) {
    const tolJ = Math.max(1.5, 0.004 * Math.max(Math.abs(minTempC), Math.abs(maxTempC)));
    options.push({
      sensorType: 'THERMOCOUPLE_TYPE_J',
      standard: 'IEC 60584',
      rangeMinC: -40,
      rangeMaxC: 750,
      toleranceAtOperatingC: tolJ,
      recommended: atmosphere === 'reducing' || atmosphere === 'vacuum',
      suitability: 'REDUCING_AND_VACUUM_ATMOSPHERE_SPECIALIST',
      notes: 'Well suited for reducing atmospheres and amine sulfur recovery units; iron rusts in oxidizing moist service'
    });
  }

  // 5. Type K Thermocouple (Chromel-Alumel): High temperature furnaces/exhausts (-40 to +1200 C) per IEC 60584
  if (maxTempC > 450 || minTempC >= -40) {
    const tolK = Math.max(1.5, 0.004 * maxTempC);
    options.push({
      sensorType: 'THERMOCOUPLE_TYPE_K',
      standard: 'IEC 60584',
      rangeMinC: -40,
      rangeMaxC: 1200,
      toleranceAtOperatingC: tolK,
      recommended: maxTempC > 500 && atmosphere !== 'reducing',
      suitability: 'HIGH_TEMPERATURE_FURNACE_EXHAUST',
      notes: 'Rugged standard for flare stacks, incinerators, gas turbine exhausts, and sulfur recovery reaction furnaces'
    });
  }

  const primeOption = options.find((o) => o.recommended) || options[0];

  return {
    operatingRange: { minTempC, maxTempC },
    recommendedSensor: primeOption.sensorType,
    sensorOptions: options
  };
}

module.exports = {
  GRAVITY,
  calibrateDryLeg,
  calibrateWetLeg,
  calibrateInterfaceLevel,
  evaluateRadarLevel,
  sizePressureTransmitter,
  checkThermowellAsmePtc19_3,
  THERMOWELL_MATERIALS,
  pt100ResistanceFromTemp,
  selectTemperatureSensor
};
