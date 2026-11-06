/**
 * API 570 Piping Inspection & API 579-1 / ASME FFS-1 Fitness-For-Service Engine.
 * Corrosion rate analysis, remaining life projection, inspection intervals & de Waard-Milliams CO2 modeling.
 *
 * Implements:
 * 1. API 570 Section 7:
 *    - Short-Term Corrosion Rate (CR_ST) and Long-Term Corrosion Rate (CR_LT) [mm/year].
 *    - Remaining Life (RL) = (t_actual - t_min) / CR [years].
 *    - Maximum inspection intervals per API 570 Table 2 (Piping Classes 1 to 4).
 *    - Half-life inspection interval rule: Interval = min(RL / 2, Max_Class_Interval).
 * 2. ASME B31.3 / API 570 Pressure Design Minimum Thickness + Structural Minimum Thickness.
 * 3. API 579-1 / ASME FFS-1 Part 5:
 *    - Local Thin Area (LTA) assessment.
 *    - Folias bulging factor M and Remaining Strength Factor (RSF).
 *    - Safe derated MAWP when RSF < RSF_allowable (0.90).
 * 4. de Waard-Milliams (1993 / 1995) CO2 Sweet Corrosion Rate Prediction:
 *    - Partial pressure of CO2 (P_CO2).
 *    - In-situ pH correction and protective FeCO3 siderite scale formation above 60 °C.
 *    - Inhibitor availability & efficiency reduction.
 */

'use strict';

// claims:evidence:API-570-API-579-deWaard-1995

/**
 * API 570 Table 2 - Maximum Recommended Inspection Intervals (years)
 */
const API_570_CLASS_INTERVALS = {
  1: {
    description: 'Class 1: Flammable gas, toxic chemicals, cryogenic LNG/LPG, high-hazard',
    maxVisualExternalYears: 5,
    maxThicknessMeasurementYears: 5
  },
  2: {
    description: 'Class 2: Hydrocarbons, steam, hot water, sour water, moderate hazard',
    maxVisualExternalYears: 5,
    maxThicknessMeasurementYears: 10
  },
  3: {
    description: 'Class 3: Distillate, lube oil, cooling water, instrument air, nitrogen',
    maxVisualExternalYears: 10,
    maxThicknessMeasurementYears: 10
  },
  4: {
    description: 'Class 4: Optional / low hazard utility lines',
    maxVisualExternalYears: 10,
    maxThicknessMeasurementYears: 10
  }
};

/**
 * Standard structural minimum thicknesses per API 570 Table 1 guidelines
 */
const API_570_STRUCTURAL_MIN_MM = {
  '0.5': 1.8,
  '0.75': 1.8,
  '1': 1.8,
  '1.5': 1.8,
  '2': 1.8,
  '3': 2.0,
  '4': 2.3,
  '6': 2.8,
  '8': 3.2,
  '10': 3.6,
  '12': 3.6,
  '14': 4.0,
  '16': 4.0,
  '18': 4.0,
  '20': 4.0,
  '24': 4.0,
  '30': 4.5,
  '36': 5.0
};

class CorrosionRemainingLifeApi570 {
  /**
   * Calculate Short-Term and Long-Term Corrosion Rates per API 570 Section 7.1.
   *
   * @param {Object} params
   * @param {number} params.tInitialMm - Original baseline thickness at installation (mm)
   * @param {number} params.tPreviousMm - Thickness measured at previous inspection (mm)
   * @param {number} params.tActualMm - Current measured thickness (mm)
   * @param {number} params.yearsSinceInitial - Time elapsed since initial installation (years)
   * @param {number} params.yearsSincePrevious - Time elapsed since previous inspection (years)
   * @returns {{crShortTermMmYr: number, crLongTermMmYr: number, crGoverningMmYr: number}}
   */
  static calculateCorrosionRate(params) {
    const {
      tInitialMm,
      tPreviousMm,
      tActualMm,
      yearsSinceInitial,
      yearsSincePrevious
    } = params;

    if (yearsSinceInitial <= 0) {
      throw new Error('yearsSinceInitial must be greater than zero.');
    }

    const crLongTerm = Math.max(0, (tInitialMm - tActualMm) / yearsSinceInitial);

    let crShortTerm = crLongTerm;
    if (yearsSincePrevious && yearsSincePrevious > 0) {
      crShortTerm = Math.max(0, (tPreviousMm - tActualMm) / yearsSincePrevious);
    }

    // Governing corrosion rate defaults to the maximum of short and long term rates
    const crGoverning = Math.max(crShortTerm, crLongTerm);

    return {
      crShortTermMmYr: Number(crShortTerm.toFixed(3)),
      crLongTermMmYr: Number(crLongTerm.toFixed(3)),
      crGoverningMmYr: Number(crGoverning.toFixed(3))
    };
  }

  /**
   * Determine minimum required wall thickness t_min per ASME B31.3 Eq 3a and API 570 structural rules.
   *
   * @param {Object} params
   * @param {number} params.designPressureBarg - Internal design pressure (barg)
   * @param {number} params.outsideDiameterMm - Pipe OD (mm)
   * @param {number} params.allowableStressMPa - Code allowable stress S (MPa)
   * @param {number} [params.jointEfficiency=1.0] - Weld joint quality factor E
   * @param {number} [params.yFactor=0.4] - ASME B31.3 Y factor
   * @param {string} [params.nps='8'] - Nominal pipe size for structural min lookup
   * @returns {{tPressureMm: number, tStructuralMm: number, tMinRequiredMm: number}}
   */
  static calculateMinimumThickness(params) {
    const {
      designPressureBarg,
      outsideDiameterMm,
      allowableStressMPa,
      jointEfficiency = 1.0,
      yFactor = 0.4,
      nps = '8'
    } = params;

    const pMPa = designPressureBarg / 10.0;
    const denominator = 2.0 * (allowableStressMPa * jointEfficiency + pMPa * yFactor);
    const tPressureMm = (pMPa * outsideDiameterMm) / denominator;

    const tStructuralMm = API_570_STRUCTURAL_MIN_MM[nps] || 3.0;
    const tMinRequiredMm = Math.max(tPressureMm, tStructuralMm);

    return {
      tPressureMm: Number(tPressureMm.toFixed(2)),
      tStructuralMm: Number(tStructuralMm.toFixed(2)),
      tMinRequiredMm: Number(tMinRequiredMm.toFixed(2))
    };
  }

  /**
   * Calculate Remaining Life (RL) and API 570 inspection interval.
   *
   * @param {Object} params
   * @param {number} params.tActualMm - Measured thickness (mm)
   * @param {number} params.tMinRequiredMm - Minimum required thickness (mm)
   * @param {number} params.corrosionRateMmYr - Corrosion rate (mm/year)
   * @param {number} [params.pipingClass=2] - API 570 Piping Class (1, 2, 3, or 4)
   * @returns {Object} Remaining life, inspection interval, and retirement warning
   */
  static calculateRemainingLife(params) {
    const {
      tActualMm,
      tMinRequiredMm,
      corrosionRateMmYr,
      pipingClass = 2
    } = params;

    if (corrosionRateMmYr < 0) {
      throw new Error('Corrosion rate must be non-negative.');
    }

    const availableCorrosionMarginMm = Math.max(0, tActualMm - tMinRequiredMm);
    const isBelowTmin = tActualMm < tMinRequiredMm;

    let remainingLifeYears = 0.0;
    if (corrosionRateMmYr === 0) {
      remainingLifeYears = 100.0; // Infinite / negligible corrosion
    } else {
      remainingLifeYears = availableCorrosionMarginMm / corrosionRateMmYr;
    }

    const classRule = API_570_CLASS_INTERVALS[pipingClass] || API_570_CLASS_INTERVALS[2];
    const halfLifeYears = remainingLifeYears / 2.0;

    // Next inspection interval = min(half-life, class maximum interval)
    // If actual thickness is already below t_min, code violation requires immediate action (interval = 0)
    const nextThicknessInspectionYears = isBelowTmin
      ? 0.0
      : Number(Math.max(0.5, Math.min(halfLifeYears, classRule.maxThicknessMeasurementYears)).toFixed(2));
    const nextVisualInspectionYears = isBelowTmin
      ? 0.0
      : Number(Math.max(0.5, Math.min(halfLifeYears, classRule.maxVisualExternalYears)).toFixed(2));

    return {
      tActualMm,
      tMinRequiredMm,
      corrosionMarginMm: Number(availableCorrosionMarginMm.toFixed(2)),
      corrosionRateMmYr,
      remainingLifeYears: Number(remainingLifeYears.toFixed(2)),
      pipingClass,
      halfLifeYears: Number(halfLifeYears.toFixed(2)),
      nextThicknessInspectionYears,
      nextVisualInspectionYears,
      isBelowTmin,
      actionRequired: isBelowTmin
        ? 'REPAIR OR RETIRE: Actual thickness is below ASME/API minimum code requirement.'
        : remainingLifeYears < 2.0
          ? 'CRITICAL MONITORING: Remaining life is under 2 years. Plan replacement or clamp repair.'
          : 'ACCEPTABLE: Continue scheduled API 570 inspection.'
    };
  }

  /**
   * API 579-1 / ASME FFS-1 Fitness-For-Service Level 1 evaluation of Local Thin Area (LTA).
   *
   * @param {Object} params
   * @param {number} params.outsideDiameterMm - Pipe OD (mm)
   * @param {number} params.nominalWallMm - Nominal uncorroded wall thickness (mm)
   * @param {number} params.tMinRequiredMm - ASME code minimum required thickness (mm)
   * @param {number} params.tMinMeasuredMm - Minimum measured wall thickness at bottom of pit/trench (mm)
   * @param {number} params.lengthAxialMm - Axial / longitudinal flaw length (mm)
   * @param {number} [params.designPressureBarg=50.0] - Design pressure (barg)
   * @param {number} [params.rsfAllowable=0.90] - Target remaining strength factor (typically 0.90)
   * @returns {Object} RSF, Folias factor, verdict, and safe derated pressure
   */
  static evaluateLocalThinAreaApi579(params) {
    const {
      outsideDiameterMm,
      nominalWallMm,
      tMinRequiredMm,
      tMinMeasuredMm,
      lengthAxialMm,
      designPressureBarg = 50.0,
      rsfAllowable = 0.90
    } = params;

    if (outsideDiameterMm <= 0 || tMinRequiredMm <= 0 || lengthAxialMm < 0) {
      throw new Error('Piping dimensions and flaw length must be positive.');
    }
    if (tMinMeasuredMm < 0) {
      throw new Error('Measured wall thickness cannot be negative.');
    }

    // Remaining thickness ratio Rt = t_mm / t_min
    const rt = tMinMeasuredMm / tMinRequiredMm;

    // Dimensionless length parameter lambda = 1.285 * s / sqrt(D * t_min)
    const lambda = (1.285 * lengthAxialMm) / Math.sqrt(outsideDiameterMm * tMinRequiredMm);

    // Folias bulging factor M per API 579 Part 5 Eq 5.10
    const foliasM = Math.sqrt(1.0 + 0.48 * Math.pow(lambda, 2));

    // Remaining Strength Factor (RSF) per API 579 Eq 5.12
    // RSF = Rt / (1 - (1 - Rt) / M)
    let rsf = 1.0;
    if (rt <= 0) {
      rsf = 0.0;
    } else if (rt < 1.0) {
      rsf = rt / (1.0 - (1.0 - rt) / foliasM);
    }

    const isAcceptableAtDesignPressure = rsf >= rsfAllowable;

    // Safe derated MAWP if RSF < RSF_allowable
    let safeOperatingPressureBarg = designPressureBarg;
    if (rsf < rsfAllowable) {
      safeOperatingPressureBarg = designPressureBarg * (rsf / rsfAllowable);
    }

    return {
      standard: 'API 579-1 / ASME FFS-1 Part 5 (Local Thin Area)',
      remainingThicknessRatioRt: Number(rt.toFixed(3)),
      axialFlawLengthMm: lengthAxialMm,
      dimensionlessLengthLambda: Number(lambda.toFixed(3)),
      foliasFactorM: Number(foliasM.toFixed(3)),
      rsfCalculated: Number(rsf.toFixed(3)),
      rsfAllowable,
      isAcceptableAtDesignPressure,
      originalDesignPressureBarg: designPressureBarg,
      safeOperatingPressureBarg: Number(safeOperatingPressureBarg.toFixed(2)),
      verdict: isAcceptableAtDesignPressure
        ? 'FIT FOR SERVICE: Flaw meets API 579 Level 1 criteria at full design pressure.'
        : `DERATING REQUIRED: Flaw fails full pressure check. Derate system to ${safeOperatingPressureBarg.toFixed(1)} barg or repair.`
    };
  }

  /**
   * de Waard-Milliams (1993 / 1995) CO2 Sweet Corrosion Prediction for wet gas / multi-phase flow.
   *
   * @param {Object} params
   * @param {number} params.totalPressureBarg - Total operating pressure (barg)
   * @param {number} params.co2MolePercent - CO2 concentration in gas phase (% mol, e.g. 3.5%)
   * @param {number} params.operatingTempC - Operating temperature (°C)
   * @param {number} [params.flowVelocityMS=2.0] - Fluid mixture velocity (m/s)
   * @param {number} [params.pH] - In-situ water pH (calculated if not provided)
   * @param {number} [params.inhibitorEfficiency=0.0] - Corrosion inhibitor efficiency (0.0 to 0.98)
   * @returns {Object} Bare metal corrosion rate, scaling factor, and inhibited corrosion rate
   */
  static calculateDeWaardMilliams(params) {
    const {
      totalPressureBarg,
      co2MolePercent,
      operatingTempC,
      flowVelocityMS = 2.0,
      pH,
      inhibitorEfficiency = 0.0
    } = params;

    const pTotalBar = totalPressureBarg + 1.01325;
    const yCo2 = Math.max(0.0001, co2MolePercent / 100.0);
    const pCo2Bar = yCo2 * pTotalBar;

    const tempK = operatingTempC + 273.15;

    // de Waard 1995 unscaled baseline corrosion rate:
    // log10(V_corr0) = 5.8 - (1710 / T_K) + 0.67 * log10(P_CO2)  [mm/year]
    const logVcorr0 = 5.8 - (1710.0 / tempK) + 0.67 * Math.log10(pCo2Bar);
    const vCorr0 = Math.pow(10.0, logVcorr0);

    // Natural equilibrium pH of pure CO2 / water system
    const pHeq = 3.71 + 0.00417 * operatingTempC - 0.5 * Math.log10(pCo2Bar);
    const actualPH = pH !== undefined ? pH : pHeq;

    // pH correction factor: if pH > pHeq, corrosion rate derates due to bicarbonate buffering
    let fPh = 1.0;
    if (actualPH > pHeq) {
      fPh = Math.pow(10.0, -(actualPH - pHeq) * 0.32);
    }

    // Protective FeCO3 (Siderite) scale formation above scaling temperature
    // de Waard 1995 scaling temperature correlation
    const tScalingC = (2400.0 / (6.7 + 0.6 * Math.log10(pCo2Bar))) - 273.15;
    const tScalingK = tScalingC + 273.15;
    let fScale = 1.0;
    if (operatingTempC > tScalingC) {
      // Exact de Waard 1995 protective FeCO3 scale reduction factor:
      // log10(F_scale) = 2400 * (1/T_K - 1/T_scale_K)
      const log10FScale = 2400.0 * ((1.0 / tempK) - (1.0 / tScalingK));
      fScale = Math.max(0.01, Math.min(1.0, Math.pow(10.0, log10FScale)));
    }

    // Flow velocity factor
    const fFlow = 1.0 + 0.1 * Math.pow(flowVelocityMS, 0.8);

    // Uninhibited corrosion rate (mm/year)
    const vUninhibitedMmYr = vCorr0 * fPh * fScale * fFlow;

    // Inhibited corrosion rate
    const vFinalMmYr = vUninhibitedMmYr * (1.0 - Math.min(0.99, Math.max(0.0, inhibitorEfficiency)));

    return {
      model: 'de Waard-Milliams (1993 / 1995)',
      pCo2Bar: Number(pCo2Bar.toFixed(3)),
      operatingTempC,
      equilibriumPH: Number(pHeq.toFixed(2)),
      actualPH: Number(actualPH.toFixed(2)),
      scalingTempC: Number(tScalingC.toFixed(1)),
      protectiveScaleFactor: Number(fScale.toFixed(3)),
      flowVelocityMS,
      bareCorrosionRateMmYr: Number(vCorr0.toFixed(2)),
      uninhibitedCorrosionRateMmYr: Number(vUninhibitedMmYr.toFixed(3)),
      inhibitorEfficiency,
      estimatedCorrosionRateMmYr: Number(vFinalMmYr.toFixed(3))
    };
  }
}

module.exports = {
  CorrosionRemainingLifeApi570,
  API_570_CLASS_INTERVALS,
  API_570_STRUCTURAL_MIN_MM
};
