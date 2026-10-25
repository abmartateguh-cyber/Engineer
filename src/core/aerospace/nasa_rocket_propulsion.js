/**
 * Legacy aerospace calculation examples.
 *
 * These simplified equations and constants are experimental smoke-test material.
 * They have not been independently correlated to the named aerospace standards,
 * nor reviewed for flight, safety, or design use. Do not treat outputs as approval.
 */

'use strict';

class NasaRocketPropulsion {
  constructor(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) params = {};
    // Physical Constants
    this.R_UNIVERSAL = 8314.462618; // J / (kmol * K)
    this.G0 = 9.80665; // Standard gravity m/s^2
    this.P_STD_ATM = 101325.0; // Standard sea level pressure Pa
    this.T_STD_ATM = 288.15; // Standard sea level temperature K
    this.RHO_STD_ATM = 1.225; // Standard sea level density kg/m^3

    // Retain the legacy configuration object for callers that explicitly pass
    // constructor settings. Missing values stay missing; no vehicle is implied.
    this.defaultParams = Object.freeze({
      propellantType: params.propellantType,
      chamberPressureBar:
        params.chamberPressurePa !== undefined ? params.chamberPressurePa / 1e5 : params.chamberPressureBar,
      ofRatio: params.mixtureRatio !== undefined ? params.mixtureRatio : params.ofRatio,
      expansionRatio: params.expansionRatio,
      throatDiameterM: params.throatDiameterM
    });
  }

  invalidInput(operation, missingInputs) {
    return {
      success: false,
      status: 'invalid-input',
      validationLevel: 'experimental',
      error: {
        code: 'INVALID_INPUT',
        message: `${operation} requires explicit valid inputs: ${missingInputs.join(', ')}`
      }
    };
  }

  numericalFailure(operation, diagnostic) {
    return {
      success: false,
      status: 'numerical-failure',
      validationLevel: 'experimental',
      error: {
        code: 'NUMERICAL_FAILURE',
        message: `${operation} produced invalid numerical output: ${diagnostic}`
      }
    };
  }

  // =========================================================================
  // 1. Experimental propellant thermochemistry example
  // =========================================================================

  /**
   * Computes a toy propellant-property estimate from bundled, unsourced coefficients.
   * This is not a chemical-equilibrium solver or a NASA CEA replacement.
   *
   * @param {string} propellantType - 'LOX_LCH4' | 'LOX_LH2' | 'LOX_RP1'
   * @param {number} chamberPressureBar - Chamber pressure in bar (e.g., 300 bar for FFSC)
   * @param {number} ofRatio - Oxidizer-to-fuel mass mixture ratio (e.g., 3.6 for CH4, 6.0 for H2, 2.6 for RP1)
   * @returns {Object} Experimental property estimates and the coefficients used
   */
  evaluateCombustionEquilibrium(propellantType, chamberPressureBar, ofRatio) {
    const missingInputs = [];
    if (typeof propellantType !== 'string' || propellantType.trim() === '') missingInputs.push('propellantType');
    if (!Number.isFinite(chamberPressureBar) || chamberPressureBar <= 0) missingInputs.push('chamberPressureBar');
    if (!Number.isFinite(ofRatio) || ofRatio <= 0) missingInputs.push('ofRatio');
    if (missingInputs.length > 0) return this.invalidInput('Combustion estimate', missingInputs);

    const Pc_Pa = chamberPressureBar * 1e5;
    let correlationParameters;

    switch (propellantType.trim().toUpperCase()) {
      case 'LOX_LCH4':
      case 'METHALOX':
        correlationParameters = {
          optimumOfRatio: 3.6,
          referenceChamberTemperatureK: 3580,
          temperaturePressureSlopeKPerDecade: 35,
          referenceChamberPressureBar: 100,
          temperatureMixtureQuadraticK: 280,
          gammaAtOptimumOf: 1.215,
          gammaPerOfRatio: -0.005,
          molecularWeightAtOptimumOfKgKmol: 21.4,
          molecularWeightPerOfRatioKgKmol: 1.2
        };
        break;

      case 'LOX_LH2':
      case 'HYDROLOX':
        correlationParameters = {
          optimumOfRatio: 6,
          referenceChamberTemperatureK: 3580,
          temperaturePressureSlopeKPerDecade: 40,
          referenceChamberPressureBar: 100,
          temperatureMixtureQuadraticK: 160,
          gammaAtOptimumOf: 1.23,
          gammaPerOfRatio: -0.008,
          molecularWeightAtOptimumOfKgKmol: 13,
          molecularWeightPerOfRatioKgKmol: 1.1
        };
        break;

      case 'LOX_RP1':
      case 'KEROLOX':
        correlationParameters = {
          optimumOfRatio: 2.6,
          referenceChamberTemperatureK: 3670,
          temperaturePressureSlopeKPerDecade: 30,
          referenceChamberPressureBar: 100,
          temperatureMixtureQuadraticK: 320,
          gammaAtOptimumOf: 1.225,
          gammaPerOfRatio: -0.004,
          molecularWeightAtOptimumOfKgKmol: 23.8,
          molecularWeightPerOfRatioKgKmol: 1.4
        };
        break;
      default:
        return this.invalidInput('Combustion estimate', ['supported propellantType (LOX_LCH4, LOX_LH2, or LOX_RP1)']);
    }

    const mixtureOffset = ofRatio - correlationParameters.optimumOfRatio;
    const Tc =
      correlationParameters.referenceChamberTemperatureK +
      correlationParameters.temperaturePressureSlopeKPerDecade *
        Math.log10(chamberPressureBar / correlationParameters.referenceChamberPressureBar) -
      correlationParameters.temperatureMixtureQuadraticK * mixtureOffset * mixtureOffset;
    const gamma = correlationParameters.gammaAtOptimumOf + correlationParameters.gammaPerOfRatio * mixtureOffset;
    const molWeight =
      correlationParameters.molecularWeightAtOptimumOfKgKmol +
      correlationParameters.molecularWeightPerOfRatioKgKmol * mixtureOffset;
    if (![Pc_Pa, Tc, gamma, molWeight].every(Number.isFinite) || Tc <= 0 || gamma <= 1 || molWeight <= 0) {
      return this.invalidInput('Combustion estimate', ['inputs within the simplified correlation domain']);
    }
    const R_spec = this.R_UNIVERSAL / molWeight; // J / (kg * K)

    // Characteristic exhaust velocity estimate.
    // c* = sqrt(gamma * R_spec * Tc) / ( gamma * sqrt( (2 / (gamma + 1))^((gamma + 1)/(gamma - 1)) ) )
    const exponent = (gamma + 1.0) / (gamma - 1.0);
    const vFactor = Math.pow(2.0 / (gamma + 1.0), exponent / 2.0);
    const cStar = Math.sqrt(gamma * R_spec * Tc) / (gamma * vFactor);

    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      correlationParameters,
      assumptions: [
        'Built-in illustrative coefficients have no verified source or independent correlation',
        'Outputs are not chemical-equilibrium, combustion-stability, or propellant-qualification results'
      ],
      propellantType,
      chamberPressureBar,
      chamberPressurePa: Pc_Pa,
      ofRatio,
      chamberTemperatureK: Tc,
      gamma,
      molecularWeightKgKmol: molWeight,
      specificGasConstantJ_KgK: R_spec,
      characteristicVelocityM_s: cStar
    };
  }

  // =========================================================================
  // 2. Experimental isentropic nozzle estimate
  // =========================================================================

  /**
   * Solves exit Mach number Me for a given nozzle area expansion ratio eps = Ae / At
   * using the isentropic area-Mach relation:
   * (A / At)^2 = (1 / M^2) * [ (2 / (gamma + 1)) * (1 + 0.5 * (gamma - 1) * M^2) ]^((gamma + 1)/(gamma - 1))
   */
  solveNozzleExitMach(expansionRatio, gamma) {
    if (!Number.isFinite(expansionRatio) || expansionRatio < 1 || !Number.isFinite(gamma) || gamma <= 1) {
      throw new RangeError('Nozzle estimate requires expansionRatio >= 1 and gamma > 1.');
    }
    if (expansionRatio <= 1.0) return 1.0;
    const areaRatio = (mach) => {
      const term = (2.0 / (gamma + 1.0)) * (1.0 + 0.5 * (gamma - 1.0) * mach * mach);
      return Math.pow(term, (gamma + 1.0) / (2.0 * (gamma - 1.0))) / mach;
    };

    // The supersonic area ratio is monotonic for Mach >= 1, so bisection keeps
    // the inversion bracketed and avoids Newton steps crossing onto the other branch.
    let lowerMach = 1.0;
    let upperMach = 2.0;
    while (areaRatio(upperMach) < expansionRatio && upperMach < 1e6) upperMach *= 2.0;
    if (!Number.isFinite(areaRatio(upperMach)) || areaRatio(upperMach) < expansionRatio) {
      throw new RangeError('Nozzle area ratio is outside the supported numerical range.');
    }

    for (let iteration = 0; iteration < 128; iteration++) {
      const mach = 0.5 * (lowerMach + upperMach);
      const ratio = areaRatio(mach);
      if (!Number.isFinite(ratio)) throw new RangeError('Nozzle Mach inversion produced a non-finite result.');
      if (Math.abs(ratio - expansionRatio) <= 1e-12 * expansionRatio || upperMach - lowerMach <= 1e-12 * mach)
        return mach;
      if (ratio < expansionRatio) lowerMach = mach;
      else upperMach = mach;
    }
    throw new Error('Nozzle Mach inversion did not converge within 128 bisection steps.');
  }

  /**
   * Computes rocket engine thrust, specific impulse (Isp), mass flow rates,
   * with a simplified exit pressure estimate.
   */
  calculateEnginePerformance(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return this.invalidInput('Engine performance estimate', ['parameter object']);
    }
    const { propellantType, chamberPressureBar, ofRatio, throatDiameterM, expansionRatio, ambientPressureBar } = params;

    const missingInputs = [];
    if (typeof propellantType !== 'string' || propellantType.trim() === '') missingInputs.push('propellantType');
    for (const name of ['chamberPressureBar', 'ofRatio', 'throatDiameterM', 'expansionRatio']) {
      if (!Number.isFinite(params[name]) || params[name] <= 0) missingInputs.push(name);
    }
    if (!Number.isFinite(ambientPressureBar) || ambientPressureBar < 0) missingInputs.push('ambientPressureBar');
    if (expansionRatio < 1) missingInputs.push('expansionRatio >= 1');
    if (missingInputs.length > 0) return this.invalidInput('Engine performance estimate', missingInputs);

    const thermo = this.evaluateCombustionEquilibrium(propellantType, chamberPressureBar, ofRatio);
    if (!thermo.success) return thermo;
    const Pc = thermo.chamberPressurePa;
    const Pa = ambientPressureBar * 1e5;
    const gamma = thermo.gamma;
    const cStar = thermo.characteristicVelocityM_s;

    const At = (Math.PI / 4.0) * Math.pow(throatDiameterM, 2);
    const Ae = At * expansionRatio;
    const exitDiameterM = Math.sqrt((4.0 * Ae) / Math.PI);

    // Solve Exit Mach number
    const Me = this.solveNozzleExitMach(expansionRatio, gamma);

    // Isentropic Exit Static Pressure Pe
    const totalToStatic = 1.0 + 0.5 * (gamma - 1.0) * Me * Me;
    const Pe = Pc * Math.pow(totalToStatic, -gamma / (gamma - 1.0));
    const Te = thermo.chamberTemperatureK / totalToStatic;

    // Total Propellant Mass Flow Rate: mdot = Pc * At / c*
    const mdot_total = (Pc * At) / cStar; // kg/s
    const mdot_fuel = mdot_total / (1.0 + ofRatio);
    const mdot_ox = mdot_total - mdot_fuel;

    // Effective Exit Velocity: ve = Me * sqrt(gamma * R * Te)
    const exitSoundSpeed = Math.sqrt(gamma * thermo.specificGasConstantJ_KgK * Te);
    const ve = Me * exitSoundSpeed;

    // Ideal thrust coefficient estimate.
    const gm1 = gamma - 1.0;
    const gp1 = gamma + 1.0;
    const term1 = (2.0 * gamma * gamma) / gm1;
    const term2 = Math.pow(2.0 / gp1, gp1 / gm1);
    const term3 = 1.0 - Math.pow(Pe / Pc, gm1 / gamma);
    const coefficientSquared = term1 * term2 * term3;
    if (!Number.isFinite(coefficientSquared) || coefficientSquared < 0) {
      return this.numericalFailure('Engine performance estimate', 'invalid ideal thrust coefficient');
    }
    const Cf_momentum = Math.sqrt(coefficientSquared);
    const Cf_pressure = ((Pe - Pa) / Pc) * expansionRatio;
    const Cf_actual = Cf_momentum + Cf_pressure;

    // Vacuum Thrust Coefficient Cf_vac (Pa = 0)
    const Cf_vac = Cf_momentum + (Pe / Pc) * expansionRatio;

    // Actual Thrust
    const thrust_N = mdot_total * ve + (Pe - Pa) * Ae;
    const thrustVac_N = mdot_total * ve + Pe * Ae;

    // Specific Impulse: Isp = F / (mdot * g0)
    const Isp_sl = thrust_N / (mdot_total * this.G0);
    const Isp_vac = thrustVac_N / (mdot_total * this.G0);

    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      assumptions: [
        'One-dimensional ideal isentropic nozzle relations; nozzle losses and separation are not modeled',
        'Thermochemistry uses the unsourced illustrative correlation coefficients returned in thermo'
      ],
      thermo,
      throatDiameterM,
      throatAreaM2: At,
      expansionRatio,
      exitDiameterM,
      exitAreaM2: Ae,
      exitMach: Me,
      exitPressureBar: Pe / 1e5,
      exitTemperatureK: Te,
      massFlowTotalKgS: mdot_total,
      massFlowOxKgS: mdot_ox,
      massFlowFuelKgS: mdot_fuel,
      thrustSeaLevelKN: thrust_N / 1000.0,
      thrustVacuumKN: thrustVac_N / 1000.0,
      thrustSeaLevelN: thrust_N,
      thrustVacuumN: thrustVac_N,
      IspSeaLevelS: Isp_sl,
      IspVacuumS: Isp_vac,
      ispSeaLevelS: Isp_sl,
      ispVacuumS: Isp_vac,
      totalMassFlowKg_s: mdot_total,
      exitPressurePa: Pe,
      thrustCoefficientSeaLevel: Cf_actual,
      thrustCoefficientVacuum: Cf_vac
    };
  }

  // =========================================================================
  // 3. Bartz Convective Heat Transfer & Narloy-Z Regenerative Cooling
  // =========================================================================

  /**
   * Computes local convective heat flux across the rocket nozzle contour
   * using the Bartz equation and checks regenerative coolant temperature rise.
   */
  calculateBartzRegenerativeCooling(enginePerf, coolantProps) {
    const missingInputs = [];
    const requiredPositiveInputs = [
      'gasViscosityPaS',
      'gasSpecificHeatJKgK',
      'gasPrandtl',
      'bartzCorrectionFactor',
      'recoveryFactor',
      'throatRadiusOfCurvatureM',
      'channelWidthM',
      'channelHeightM',
      'wallThicknessM',
      'coolantInletTempK',
      'coolantMassFlowKgS',
      'coolantDensityKgM3',
      'coolantViscosityPaS',
      'coolantSpecificHeatJKgK',
      'coolantPrandtl',
      'coolantThermalConductivityWmK',
      'linerThermalConductivityWmK',
      'effectiveHeatTransferAreaM2',
      'coolantChannelLengthM'
    ];
    if (!enginePerf || enginePerf.success !== true || !enginePerf.thermo) {
      missingInputs.push('successful engine performance result');
    }
    if (!coolantProps || typeof coolantProps !== 'object') {
      missingInputs.push('coolant properties object');
    } else {
      for (const name of requiredPositiveInputs) {
        if (!Number.isFinite(coolantProps[name]) || coolantProps[name] <= 0) missingInputs.push(name);
      }
      if (!Number.isInteger(coolantProps.coolantChannelCount) || coolantProps.coolantChannelCount <= 0) {
        missingInputs.push('positive integer coolantChannelCount');
      }
      if (
        typeof coolantProps.inputSourceDescription !== 'string' ||
        coolantProps.inputSourceDescription.trim() === ''
      ) {
        missingInputs.push('inputSourceDescription');
      }
    }
    if (missingInputs.length > 0) return this.invalidInput('Regenerative cooling estimate', missingInputs);

    const engineInputs = [
      'throatDiameterM',
      'throatAreaM2',
      'exitDiameterM',
      'massFlowFuelKgS',
      'thermo.chamberPressurePa',
      'thermo.characteristicVelocityM_s',
      'thermo.chamberTemperatureK',
      'thermo.gamma'
    ];
    const engineValues = [
      enginePerf.throatDiameterM,
      enginePerf.throatAreaM2,
      enginePerf.exitDiameterM,
      enginePerf.massFlowFuelKgS,
      enginePerf.thermo.chamberPressurePa,
      enginePerf.thermo.characteristicVelocityM_s,
      enginePerf.thermo.chamberTemperatureK,
      enginePerf.thermo.gamma
    ];
    for (let index = 0; index < engineValues.length; index++) {
      if (!Number.isFinite(engineValues[index]) || engineValues[index] <= 0) missingInputs.push(engineInputs[index]);
    }
    if (enginePerf.thermo.gamma <= 1) missingInputs.push('thermo.gamma > 1');
    if (missingInputs.length > 0) return this.invalidInput('Regenerative cooling estimate', missingInputs);

    const {
      gasViscosityPaS,
      gasSpecificHeatJKgK,
      gasPrandtl,
      bartzCorrectionFactor,
      recoveryFactor,
      throatRadiusOfCurvatureM,
      coolantChannelCount,
      channelWidthM,
      channelHeightM,
      wallThicknessM,
      coolantInletTempK,
      coolantMassFlowKgS,
      coolantDensityKgM3,
      coolantViscosityPaS,
      coolantSpecificHeatJKgK,
      coolantPrandtl,
      coolantThermalConductivityWmK,
      linerThermalConductivityWmK,
      effectiveHeatTransferAreaM2,
      coolantChannelLengthM,
      inputSourceDescription
    } = coolantProps;

    if (bartzCorrectionFactor > 1 || recoveryFactor > 1) {
      return this.invalidInput('Regenerative cooling estimate', ['bartzCorrectionFactor <= 1', 'recoveryFactor <= 1']);
    }

    const Dt = enginePerf.throatDiameterM;
    const Pc_Pa = enginePerf.thermo.chamberPressurePa;
    const cStar = enginePerf.thermo.characteristicVelocityM_s;
    const Tc = enginePerf.thermo.chamberTemperatureK;
    const gamma = enginePerf.thermo.gamma;
    const channelAreaTotalM2 = coolantChannelCount * channelWidthM * channelHeightM;
    const hydraulicDiameterM = (2 * channelWidthM * channelHeightM) / (channelWidthM + channelHeightM);
    const coolantVelocityM_s = coolantMassFlowKgS / (coolantDensityKgM3 * channelAreaTotalM2);
    const coolantRe = (coolantDensityKgM3 * coolantVelocityM_s * hydraulicDiameterM) / coolantViscosityPaS;
    if (!Number.isFinite(coolantRe) || coolantRe < 10000) {
      return this.invalidInput('Regenerative cooling estimate', [
        'coolant inputs in the turbulent Dittus-Boelter correlation range (Re >= 10000)'
      ]);
    }

    // Experimental Bartz and Dittus-Boelter correlations with caller-supplied
    // transport properties and correction factors.
    const gasSideCoefficient =
      (0.026 / Math.pow(Dt, 0.2)) *
      ((Math.pow(gasViscosityPaS, 0.2) * gasSpecificHeatJKgK) / Math.pow(gasPrandtl, 0.6)) *
      Math.pow(Pc_Pa / cStar, 0.8) *
      Math.pow(Dt / throatRadiusOfCurvatureM, 0.1) *
      bartzCorrectionFactor;
    const adiabaticRecoveryTemp = Tc * ((1 + recoveryFactor * 0.5 * (gamma - 1)) / (1 + 0.5 * (gamma - 1)));
    const nusselt = 0.023 * Math.pow(coolantRe, 0.8) * Math.pow(coolantPrandtl, 0.4);
    const coolantSideCoefficient = (nusselt * coolantThermalConductivityWmK) / hydraulicDiameterM;

    const thermalResistance =
      1 / gasSideCoefficient + wallThicknessM / linerThermalConductivityWmK + 1 / coolantSideCoefficient;
    const heatFluxWm2 = (adiabaticRecoveryTemp - coolantInletTempK) / thermalResistance;
    const gasSideWallTempK = adiabaticRecoveryTemp - heatFluxWm2 / gasSideCoefficient;
    const coolantSideWallTempK = gasSideWallTempK - (heatFluxWm2 * wallThicknessM) / linerThermalConductivityWmK;
    const totalHeatTransferW = heatFluxWm2 * effectiveHeatTransferAreaM2;
    const coolantTempRiseK = totalHeatTransferW / (coolantMassFlowKgS * coolantSpecificHeatJKgK);
    const coolantOutletTempK = coolantInletTempK + coolantTempRiseK;
    const frictionFactor = 0.3164 / Math.pow(coolantRe, 0.25);
    const coolantPressureDropPa =
      frictionFactor *
      (coolantChannelLengthM / hydraulicDiameterM) *
      (0.5 * coolantDensityKgM3 * coolantVelocityM_s * coolantVelocityM_s);

    const outputs = [
      gasSideCoefficient,
      adiabaticRecoveryTemp,
      heatFluxWm2,
      gasSideWallTempK,
      coolantSideWallTempK,
      coolantVelocityM_s,
      coolantRe,
      coolantOutletTempK,
      coolantTempRiseK,
      coolantPressureDropPa
    ];
    if (!outputs.every(Number.isFinite) || outputs.some((value) => value <= 0)) {
      return this.numericalFailure(
        'Regenerative cooling estimate',
        'one or more calculated quantities are non-positive or non-finite'
      );
    }

    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      inputs: { ...coolantProps },
      inputSourceDescription,
      assumptions: [
        'Bartz throat heat-transfer estimate',
        'Dittus-Boelter turbulent internal-flow estimate (Re >= 10000)',
        'Blasius smooth-channel friction-factor estimate',
        'Single-phase coolant; boiling, material limits, and channel maldistribution are not assessed',
        'EffectiveHeatTransferAreaM2 represents the caller-supplied integrated heat-transfer area'
      ],
      gasSideCoefficientWm2K: gasSideCoefficient,
      hg_throat_W_m2K: gasSideCoefficient,
      recoveryTempThroatK: adiabaticRecoveryTemp,
      heatFluxThroatMW_m2: heatFluxWm2 / 1e6,
      gasSideWallTempK,
      coolantSideWallTempK,
      coolantVelocityM_s,
      coolantRe,
      coolantInletTempK,
      coolantOutletTempK,
      coolantTempRiseK,
      coolantPressureDropPa,
      coolantPressureDropBar: coolantPressureDropPa / 1e5,
      effectiveHeatTransferAreaM2,
      coolantChannelLengthM,
      linerThermalConductivityWmK
    };
  }

  // =========================================================================
  // 4. Euler Turbomachinery & Power Balance
  // =========================================================================

  /**
   * Computes high-pressure turbopump shaft speeds, impeller diameters,
   * turbine power expansion balance, and cavitation NPSH margins.
   */
  calculateTurbopumpSystem(enginePerf, coolingResult, pumpProps) {
    const missingInputs = [];
    const requiredPositiveInputs = [
      'fuelDensityKgM3',
      'oxidizerDensityKgM3',
      'fuelPumpEfficiency',
      'oxidizerPumpEfficiency',
      'injectorPressureDropPa',
      'oxidizerAdditionalPressureDropPa',
      'fuelPumpSpeedRPM',
      'oxidizerPumpSpeedRPM',
      'fuelImpellerTipSpeedM_s',
      'oxidizerImpellerTipSpeedM_s',
      'turbineEfficiency',
      'oxidizerTankPressurePa',
      'oxidizerVaporPressurePa',
      'oxidizerNpshRequiredM'
    ];
    if (!enginePerf || enginePerf.success !== true || !enginePerf.thermo) {
      missingInputs.push('successful engine performance result');
    }
    if (!coolingResult || coolingResult.success !== true) {
      missingInputs.push('successful cooling result');
    } else if (!Number.isFinite(coolingResult.coolantPressureDropPa) || coolingResult.coolantPressureDropPa <= 0) {
      missingInputs.push('coolingResult.coolantPressureDropPa');
    }
    if (!pumpProps || typeof pumpProps !== 'object') {
      missingInputs.push('turbopump properties object');
    } else {
      for (const name of requiredPositiveInputs) {
        if (!Number.isFinite(pumpProps[name]) || pumpProps[name] <= 0) missingInputs.push(name);
      }
      if (pumpProps.fuelPumpEfficiency > 1) missingInputs.push('fuelPumpEfficiency <= 1');
      if (pumpProps.oxidizerPumpEfficiency > 1) missingInputs.push('oxidizerPumpEfficiency <= 1');
      if (pumpProps.turbineEfficiency > 1) missingInputs.push('turbineEfficiency <= 1');
      if (typeof pumpProps.inputSourceDescription !== 'string' || pumpProps.inputSourceDescription.trim() === '') {
        missingInputs.push('inputSourceDescription');
      }
    }
    if (missingInputs.length > 0) return this.invalidInput('Turbopump estimate', missingInputs);

    const engineInputs = ['thermo.chamberPressurePa', 'massFlowOxKgS', 'massFlowFuelKgS'];
    const engineValues = [enginePerf.thermo.chamberPressurePa, enginePerf.massFlowOxKgS, enginePerf.massFlowFuelKgS];
    for (let index = 0; index < engineValues.length; index++) {
      if (!Number.isFinite(engineValues[index]) || engineValues[index] <= 0) missingInputs.push(engineInputs[index]);
    }
    if (pumpProps.oxidizerTankPressurePa <= pumpProps.oxidizerVaporPressurePa) {
      missingInputs.push('oxidizerTankPressurePa > oxidizerVaporPressurePa');
    }
    if (missingInputs.length > 0) return this.invalidInput('Turbopump estimate', missingInputs);

    const {
      fuelDensityKgM3,
      oxidizerDensityKgM3,
      fuelPumpEfficiency,
      oxidizerPumpEfficiency,
      injectorPressureDropPa,
      oxidizerAdditionalPressureDropPa,
      fuelPumpSpeedRPM,
      oxidizerPumpSpeedRPM,
      fuelImpellerTipSpeedM_s,
      oxidizerImpellerTipSpeedM_s,
      turbineEfficiency,
      oxidizerTankPressurePa,
      oxidizerVaporPressurePa,
      oxidizerNpshRequiredM,
      inputSourceDescription
    } = pumpProps;
    const Pc_Pa = enginePerf.thermo.chamberPressurePa;
    const mdot_ox = enginePerf.massFlowOxKgS;
    const mdot_fuel = enginePerf.massFlowFuelKgS;
    const fuelDischargePressurePa = Pc_Pa + coolingResult.coolantPressureDropPa + injectorPressureDropPa;
    const oxidizerDischargePressurePa = Pc_Pa + injectorPressureDropPa + oxidizerAdditionalPressureDropPa;

    const oxidizerPumpPowerW = (mdot_ox * oxidizerDischargePressurePa) / (oxidizerDensityKgM3 * oxidizerPumpEfficiency);
    const fuelPumpPowerW = (mdot_fuel * fuelDischargePressurePa) / (fuelDensityKgM3 * fuelPumpEfficiency);
    const totalPumpingPowerW = oxidizerPumpPowerW + fuelPumpPowerW;
    const turbineShaftPowerW = totalPumpingPowerW / turbineEfficiency;
    const fuelOmegaRadS = (fuelPumpSpeedRPM * 2 * Math.PI) / 60;
    const oxidizerOmegaRadS = (oxidizerPumpSpeedRPM * 2 * Math.PI) / 60;
    const fuelImpellerDiameterM = (2 * fuelImpellerTipSpeedM_s) / fuelOmegaRadS;
    const oxidizerImpellerDiameterM = (2 * oxidizerImpellerTipSpeedM_s) / oxidizerOmegaRadS;
    const npshAvailableOxM = (oxidizerTankPressurePa - oxidizerVaporPressurePa) / (oxidizerDensityKgM3 * this.G0);
    const cavitationMarginOx = npshAvailableOxM / oxidizerNpshRequiredM;
    const outputs = [
      fuelDischargePressurePa,
      oxidizerDischargePressurePa,
      oxidizerPumpPowerW,
      fuelPumpPowerW,
      totalPumpingPowerW,
      turbineShaftPowerW,
      fuelImpellerDiameterM,
      oxidizerImpellerDiameterM,
      npshAvailableOxM,
      cavitationMarginOx
    ];
    if (!outputs.every(Number.isFinite) || outputs.some((value) => value <= 0)) {
      return this.numericalFailure(
        'Turbopump estimate',
        'one or more calculated quantities are non-positive or non-finite'
      );
    }

    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      inputs: { ...pumpProps },
      inputSourceDescription,
      assumptions: [
        'Hydraulic pump power from mass flow, pressure rise, density, and supplied efficiency',
        'Impeller diameter inferred from supplied tip speed and shaft speed',
        'NPSH available uses the supplied tank and vapor pressures',
        'Cavitation margin is a ratio only; no cavitation or pump adequacy verdict is assessed'
      ],
      pumpDischargePressureFuelBar: fuelDischargePressurePa / 1e5,
      pumpDischargePressureOxBar: oxidizerDischargePressurePa / 1e5,
      hydraulicPowerFuelMW: fuelPumpPowerW / 1e6,
      hydraulicPowerOxMW: oxidizerPumpPowerW / 1e6,
      totalPumpingPowerMW: totalPumpingPowerW / 1e6,
      turbopumpPowerMw: totalPumpingPowerW / 1e6,
      turbineShaftPowerMW: turbineShaftPowerW / 1e6,
      fuelTurbopumpRPM: fuelPumpSpeedRPM,
      oxTurbopumpRPM: oxidizerPumpSpeedRPM,
      fuelImpellerDiameterMm: fuelImpellerDiameterM * 1000,
      oxImpellerDiameterMm: oxidizerImpellerDiameterM * 1000,
      npshAvailableOxM,
      npshRequiredOxM: oxidizerNpshRequiredM,
      cavitationMarginOx,
      cavitationStatus: 'NOT ASSESSED',
      fuelPump: {
        pumpPowerW: fuelPumpPowerW,
        rpm: fuelPumpSpeedRPM,
        impellerDiameterMm: fuelImpellerDiameterM * 1000,
        dischargePressureBar: fuelDischargePressurePa / 1e5
      },
      oxPump: {
        pumpPowerW: oxidizerPumpPowerW,
        rpm: oxidizerPumpSpeedRPM,
        impellerDiameterMm: oxidizerImpellerDiameterM * 1000,
        dischargePressureBar: oxidizerDischargePressurePa / 1e5
      },
      turbine: {
        shaftPowerMW: turbineShaftPowerW / 1e6,
        efficiency: turbineEfficiency
      }
    };
  }

  // =========================================================================
  // 5. 1976 US Standard Atmosphere & Max-Q Ascent Trajectory
  // =========================================================================

  /**
   * Evaluates atmospheric properties at geometric altitude z using the
   * 1976 US Standard Atmosphere piecewise barometric temperature lapse rates.
   */
  get1976Atmosphere(altitudeM) {
    if (!Number.isFinite(altitudeM) || altitudeM < 0 || altitudeM > 86000) {
      return this.invalidInput('1976 atmosphere estimate', ['altitudeM between 0 and 86000']);
    }
    const z = altitudeM;
    const R_EARTH = 6356766.0;
    const h = (R_EARTH * z) / (R_EARTH + z);

    const layers = [
      [0.0, -0.0065, 288.15, 101325.0], // Troposphere
      [11000.0, 0.0, 216.65, 22632.1], // Tropopause
      [20000.0, 0.001, 216.65, 5474.89], // Stratosphere 1
      [32000.0, 0.0028, 228.65, 868.019], // Stratosphere 2
      [47000.0, 0.0, 270.65, 110.906], // Stratopause
      [51000.0, -0.0028, 270.65, 66.9389], // Mesosphere 1
      [71000.0, -0.002, 214.65, 3.95642], // Mesosphere 2
      [84852.0, 0.0, 186.87, 0.3734] // Mesopause
    ];

    let layer = layers[0];
    for (let i = layers.length - 1; i >= 0; i--) {
      if (h >= layers[i][0]) {
        layer = layers[i];
        break;
      }
    }

    const [h_b, L_b, T_b, P_b] = layer;
    const dh = h - h_b;
    let T = T_b;
    let P = P_b;

    if (Math.abs(L_b) < 1e-8) {
      T = T_b;
      P = P_b * Math.exp((-this.G0 * dh) / (287.05287 * T_b));
    } else {
      T = T_b + L_b * dh;
      const exponent = -this.G0 / (L_b * 287.05287);
      P = P_b * Math.pow(T / T_b, exponent);
    }

    const rho = P / (287.05287 * T);
    const speedOfSound = Math.sqrt(1.4 * 287.05287 * T);

    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      altitudeM: z,
      temperatureK: T,
      pressurePa: P,
      densityKgM3: rho,
      speedOfSoundM_s: speedOfSound
    };
  }

  _validateLinearSchedule(schedule, name, xKey, yKey, yMinimum, yMaximum) {
    if (!Array.isArray(schedule) || schedule.length < 2) return `${name} with at least two points`;
    if (!schedule[0] || schedule[0][xKey] !== 0) return `${name} starting at ${xKey}=0`;
    let previousX = -Infinity;
    for (const point of schedule) {
      if (
        !point ||
        !Number.isFinite(point[xKey]) ||
        !Number.isFinite(point[yKey]) ||
        point[xKey] <= previousX ||
        point[yKey] < yMinimum ||
        point[yKey] > yMaximum
      ) {
        return `${name} with finite, increasing ${xKey} values and ${yKey} in [${yMinimum}, ${yMaximum}]`;
      }
      previousX = point[xKey];
    }
    return null;
  }

  _interpolateLinearSchedule(schedule, xKey, yKey, value) {
    if (value < schedule[0][xKey] || value > schedule[schedule.length - 1][xKey]) return null;
    for (let index = 1; index < schedule.length; index++) {
      const upper = schedule[index];
      if (value <= upper[xKey]) {
        const lower = schedule[index - 1];
        const fraction = (value - lower[xKey]) / (upper[xKey] - lower[xKey]);
        return lower[yKey] + fraction * (upper[yKey] - lower[yKey]);
      }
    }
    return schedule[schedule.length - 1][yKey];
  }

  /**
   * Simulates full ascent trajectory to compute aerodynamic dynamic pressure q(t),
   * identifying the exact Max-Q (Maximum Dynamic Pressure) point.
   */
  simulateAscentTrajectory(vehicleParams = {}) {
    const requiredInputs = [
      'liftOffMassKg',
      'stage1PropellantMassKg',
      'stage1EngineCount',
      'thrustPerEngineSL_kN',
      'Isp_sl',
      'Isp_vac',
      'rocketDiameterM',
      'burnTimeS',
      'timeStepS',
      'inputSourceDescription'
    ];
    if (!vehicleParams || typeof vehicleParams !== 'object' || Array.isArray(vehicleParams)) {
      return this.invalidInput('Ascent example', ['vehicle parameter object']);
    }
    const missingInputs = requiredInputs.filter((name) =>
      name === 'inputSourceDescription'
        ? typeof vehicleParams[name] !== 'string' || vehicleParams[name].trim() === ''
        : !Number.isFinite(vehicleParams[name]) || vehicleParams[name] <= 0
    );
    if (missingInputs.length > 0 || !Number.isInteger(vehicleParams.stage1EngineCount)) {
      return this.invalidInput('Ascent example', [
        ...missingInputs,
        ...(!Number.isInteger(vehicleParams.stage1EngineCount) ? ['integer stage1EngineCount'] : [])
      ]);
    }
    const scheduleErrors = [
      this._validateLinearSchedule(
        vehicleParams.dragCoefficientByMach,
        'dragCoefficientByMach',
        'machNumber',
        'dragCoefficient',
        0,
        Infinity
      ),
      this._validateLinearSchedule(
        vehicleParams.pitchAngleByAltitude,
        'pitchAngleByAltitude',
        'altitudeM',
        'pitchAngleDeg',
        0,
        90
      )
    ].filter(Boolean);
    if (scheduleErrors.length > 0) return this.invalidInput('Ascent example', scheduleErrors);
    const {
      liftOffMassKg,
      stage1PropellantMassKg,
      stage1EngineCount,
      thrustPerEngineSL_kN,
      Isp_sl,
      Isp_vac,
      rocketDiameterM,
      burnTimeS,
      timeStepS
    } = vehicleParams;
    if (stage1PropellantMassKg >= liftOffMassKg) {
      return this.invalidInput('Ascent example', ['stage1PropellantMassKg < liftOffMassKg']);
    }
    if (Isp_vac < Isp_sl) return this.invalidInput('Ascent example', ['Isp_vac >= Isp_sl']);

    const crossSectionAreaM2 = (Math.PI / 4.0) * Math.pow(rocketDiameterM, 2);
    const totalThrustSL_N = stage1EngineCount * thrustPerEngineSL_kN * 1000.0;
    const mdot_total = totalThrustSL_N / (Isp_sl * this.G0);
    if (!Number.isFinite(mdot_total) || mdot_total * burnTimeS > stage1PropellantMassKg) {
      return this.invalidInput('Ascent example', ['stage1PropellantMassKg >= thrust-derived propellant consumption']);
    }

    let t = 0.0;
    let dt = timeStepS;
    let altitude = 0.0;
    let velocity = 0.0;
    let mass = liftOffMassKg;

    let maxQ_Pa = 0.0;
    let maxQ_timeS = 0.0;
    let maxQ_altitudeM = 0.0;
    let maxQ_velocityM_s = 0.0;
    let maxQ_Mach = 0.0;

    const trajectorySamples = [];

    while (t < burnTimeS) {
      dt = Math.min(timeStepS, burnTimeS - t);
      const atm = this.get1976Atmosphere(altitude);
      if (!atm.success)
        return this.invalidInput('Ascent example', [`atmosphere model range at altitude ${altitude} m`]);
      const Mach = velocity / atm.speedOfSoundM_s;
      const Cd = this._interpolateLinearSchedule(
        vehicleParams.dragCoefficientByMach,
        'machNumber',
        'dragCoefficient',
        Mach
      );
      const pitchAngleDeg = this._interpolateLinearSchedule(
        vehicleParams.pitchAngleByAltitude,
        'altitudeM',
        'pitchAngleDeg',
        altitude
      );
      if (Cd === null) {
        return this.invalidInput('Ascent example', [`dragCoefficientByMach range covering Mach ${Mach}`]);
      }
      if (pitchAngleDeg === null) {
        return this.invalidInput('Ascent example', [`pitchAngleByAltitude range covering altitude ${altitude} m`]);
      }

      const q_dynamic = 0.5 * atm.densityKgM3 * velocity * velocity;
      if (q_dynamic > maxQ_Pa) {
        maxQ_Pa = q_dynamic;
        maxQ_timeS = t;
        maxQ_altitudeM = altitude;
        maxQ_velocityM_s = velocity;
        maxQ_Mach = Mach;
      }

      const F_drag = q_dynamic * crossSectionAreaM2 * Cd;
      const currentIsp = Isp_sl + (Isp_vac - Isp_sl) * (1.0 - atm.pressurePa / this.P_STD_ATM);
      const currentThrust = mdot_total * currentIsp * this.G0;

      const pitchRad = (pitchAngleDeg * Math.PI) / 180.0;

      const a_thrust = currentThrust / mass;
      const a_drag = F_drag / mass;
      const a_gravity = this.G0 * Math.pow(6371000.0 / (6371000.0 + altitude), 2);

      const dv_dt = a_thrust - a_drag - a_gravity * Math.sin(pitchRad);

      velocity += dv_dt * dt;
      altitude += velocity * Math.sin(pitchRad) * dt;
      if (altitude < 0)
        return this.invalidInput('Ascent example', ['trajectory remains above ground during powered ascent']);
      mass -= mdot_total * dt;
      t += dt;

      if (t % 15 === 0 || Math.abs(t - maxQ_timeS) < 1.0) {
        trajectorySamples.push({
          timeS: Math.round(t),
          altitudeKm: +(altitude / 1000.0).toFixed(2),
          velocityM_s: Math.round(velocity),
          machNumber: +Mach.toFixed(2),
          dynamicPressureKPa: +(q_dynamic / 1000.0).toFixed(2),
          massTon: +(mass / 1000.0).toFixed(1)
        });
      }
    }

    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      inputs: { ...vehicleParams },
      inputSourceDescription: vehicleParams.inputSourceDescription,
      maxDynamicPressureKPa: +(maxQ_Pa / 1000.0).toFixed(2),
      maxQTimeS: maxQ_timeS,
      maxQAltitudeKm: +(maxQ_altitudeM / 1000.0).toFixed(2),
      maxQVelocityM_s: Math.round(maxQ_velocityM_s),
      maxQMach: +maxQ_Mach.toFixed(2),
      cutoffAltitudeKm: +(altitude / 1000.0).toFixed(2),
      cutoffVelocityM_s: Math.round(velocity),
      trajectorySamples,
      assumptions: [
        'Drag coefficient and pitch angle use piecewise linear interpolation of caller-supplied schedules.',
        'The 1976 atmosphere model is supported from 0 to 86 km; trajectories outside that range fail closed.',
        'No wind, staging event, guidance law, propulsion transient, or trajectory validation is included.'
      ]
    };
  }

  // =========================================================================
  // 6. Multi-Stage Tsiolkovsky Delta-V & Staging Dynamics
  // =========================================================================

  /**
   * Computes an experimental idealized staging estimate from explicitly supplied inputs.
   * Loss assumptions are illustrative and are not a trajectory or mission assessment.
   */
  calculateStagingDeltaV(missionParams = {}) {
    if (!missionParams || typeof missionParams !== 'object' || Array.isArray(missionParams)) {
      return this.invalidInput('Staging estimate', ['mission parameter object']);
    }
    const requiredInputs = [
      'payloadMassKg',
      'stage1DryMassKg',
      'stage1PropellantMassKg',
      'stage1IspVac',
      'stage2DryMassKg',
      'stage2PropellantMassKg',
      'stage2IspVac',
      'gravityLossesM_s',
      'aerodynamicLossesM_s',
      'steeringLossesM_s',
      'requiredDeltaV_m_s',
      'inputSourceDescription'
    ];
    const nonNegativeInputs = new Set([
      'gravityLossesM_s',
      'aerodynamicLossesM_s',
      'steeringLossesM_s',
      'requiredDeltaV_m_s'
    ]);
    const missingInputs = requiredInputs.filter((name) =>
      name === 'inputSourceDescription'
        ? typeof missionParams[name] !== 'string' || missionParams[name].trim() === ''
        : !Number.isFinite(missionParams[name]) ||
          (nonNegativeInputs.has(name) ? missionParams[name] < 0 : missionParams[name] <= 0)
    );
    if (missingInputs.length > 0) {
      return {
        success: false,
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: `Explicit positive inputs required: ${missingInputs.join(', ')}`
        }
      };
    }

    const {
      payloadMassKg,
      stage1DryMassKg,
      stage1PropellantMassKg,
      stage1IspVac,
      stage2DryMassKg,
      stage2PropellantMassKg,
      stage2IspVac
    } = missionParams;

    // Stage 2 Initial & Final Masses
    const m0_stage2 = stage2DryMassKg + stage2PropellantMassKg + payloadMassKg;
    const mf_stage2 = stage2DryMassKg + payloadMassKg;
    const massRatio_stage2 = m0_stage2 / mf_stage2;
    const deltaV_stage2 = stage2IspVac * this.G0 * Math.log(massRatio_stage2);

    // Stage 1 Initial & Final Masses
    const m0_stage1 = stage1DryMassKg + stage1PropellantMassKg + m0_stage2;
    const mf_stage1 = stage1DryMassKg + m0_stage2;
    const massRatio_stage1 = m0_stage1 / mf_stage1;
    const deltaV_stage1 = stage1IspVac * this.G0 * Math.log(massRatio_stage1);

    // Total Ideal Delta-V
    const totalIdealDeltaV = deltaV_stage1 + deltaV_stage2;

    const deltaV_gravity_loss = missionParams.gravityLossesM_s;
    const deltaV_aerodynamic_loss = missionParams.aerodynamicLossesM_s;
    const deltaV_steering_loss = missionParams.steeringLossesM_s;
    const totalLosses = deltaV_gravity_loss + deltaV_aerodynamic_loss + deltaV_steering_loss;

    const netDeliveredDeltaV = totalIdealDeltaV - totalLosses;
    const requiredOrbitalDeltaV = missionParams.requiredDeltaV_m_s;

    return {
      success: true,
      status: 'estimate-only',
      validationLevel: 'experimental',
      inputs: { ...missionParams },
      inputSourceDescription: missionParams.inputSourceDescription,
      assumptions: [
        'Ideal two-stage Tsiolkovsky rocket equation',
        'Gravity, aerodynamic, and steering losses are caller-supplied estimates',
        'No trajectory, staging event, or orbital insertion is simulated'
      ],
      payloadMassKg,
      totalLiftoffMassKg: m0_stage1,
      stage1: {
        initialMassKg: m0_stage1,
        burnoutMassKg: mf_stage1,
        massRatio: +massRatio_stage1.toFixed(3),
        idealDeltaV_m_s: Math.round(deltaV_stage1)
      },
      stage2: {
        initialMassKg: m0_stage2,
        burnoutMassKg: mf_stage2,
        massRatio: +massRatio_stage2.toFixed(3),
        idealDeltaV_m_s: Math.round(deltaV_stage2)
      },
      totalIdealDeltaV_m_s: Math.round(totalIdealDeltaV),
      gravityLossesM_s: deltaV_gravity_loss,
      dragLossesM_s: deltaV_aerodynamic_loss,
      steeringLossesM_s: deltaV_steering_loss,
      netDeliveredDeltaV_m_s: Math.round(netDeliveredDeltaV),
      orbitalMarginDeltaV_m_s: Math.round(netDeliveredDeltaV - requiredOrbitalDeltaV),
      screeningStatus: 'EXPERIMENTAL_SCREENING_ONLY'
    };
  }

  // =========================================================================
  // 7. Experimental isogrid structural screening estimate
  // =========================================================================

  /**
   * Produces an experimental cylindrical-shell screening estimate. This simplified
   * model is not an approved buckling analysis or material-specific design check.
   */
  calculateIsogridTankBuckling(tankParams = {}) {
    if (!tankParams || typeof tankParams !== 'object' || Array.isArray(tankParams)) {
      return this.invalidInput('Isogrid structural estimate', ['tank parameter object']);
    }
    const requiredInputs = [
      'tankRadiusM',
      'tankLengthM',
      'internalPressureBar',
      'axialCompressiveLoadKN',
      'skinThicknessMm',
      'ribHeightMm',
      'ribWidthMm',
      'elasticModulusPa',
      'poissonRatio',
      'yieldStrengthPa',
      'safetyFactor',
      'minimumSkinThicknessMm',
      'bucklingKnockdownFactor',
      'material'
    ];
    const nonNegativeInputs = ['pressureStabilizationCoefficient', 'internalPressureAxialLoadReliefFactor'];
    const missingInputs = requiredInputs.filter((name) => {
      const value = tankParams[name];
      return name === 'material'
        ? typeof value !== 'string' || value.trim().length === 0
        : !Number.isFinite(value) || value <= 0;
    });
    for (const name of nonNegativeInputs) {
      if (!Number.isFinite(tankParams[name]) || tankParams[name] < 0) missingInputs.push(name);
    }
    if (typeof tankParams.inputSourceDescription !== 'string' || tankParams.inputSourceDescription.trim() === '') {
      missingInputs.push('inputSourceDescription');
    }
    if (missingInputs.length > 0) {
      return {
        success: false,
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: `Explicit positive inputs required: ${missingInputs.join(', ')}`
        }
      };
    }
    if (tankParams.poissonRatio >= 0.5) {
      return this.invalidInput('Isogrid structural estimate', ['poissonRatio < 0.5']);
    }
    if (tankParams.bucklingKnockdownFactor > 1) {
      return this.invalidInput('Isogrid structural estimate', ['bucklingKnockdownFactor <= 1']);
    }
    if (tankParams.internalPressureAxialLoadReliefFactor > 1) {
      return this.invalidInput('Isogrid structural estimate', ['internalPressureAxialLoadReliefFactor <= 1']);
    }

    const {
      tankRadiusM,
      tankLengthM,
      internalPressureBar,
      axialCompressiveLoadKN,
      skinThicknessMm,
      ribHeightMm,
      ribWidthMm,
      material,
      elasticModulusPa,
      poissonRatio,
      yieldStrengthPa,
      safetyFactor,
      minimumSkinThicknessMm,
      bucklingKnockdownFactor,
      pressureStabilizationCoefficient,
      internalPressureAxialLoadReliefFactor,
      inputSourceDescription
    } = tankParams;

    const P_internal_Pa = internalPressureBar * 1e5;
    const R = tankRadiusM;

    const sigma_allow = yieldStrengthPa / safetyFactor;
    const t_skin_min_m = (P_internal_Pa * R) / sigma_allow;
    const t_skin_calc_mm = Math.max(skinThicknessMm, minimumSkinThicknessMm, t_skin_min_m * 1000.0);

    const alpha = ribWidthMm / ribHeightMm;
    const beta = ribHeightMm / t_skin_calc_mm;
    const t_bar_mm = (t_skin_calc_mm * (1.0 + 3.0 * alpha * beta)) / (1.0 + alpha * beta);
    const t_bar_m = t_bar_mm * 1e-3;

    // Classical theoretical buckling estimate; not independently validated.
    const sigma_cl = elasticModulusPa * (t_bar_m / R) * (1.0 / Math.sqrt(3.0 * (1.0 - poissonRatio * poissonRatio)));
    const sigma_crit = bucklingKnockdownFactor * sigma_cl;
    const sigma_press_stabilized = sigma_crit + pressureStabilizationCoefficient * (P_internal_Pa * (R / t_bar_m));

    // Internal pressure axial tension relief on cylindrical tank barrel
    const F_internal_press_tension_KN = (P_internal_Pa * Math.PI * R * R) / 1000.0;
    const F_net_compressive_KN =
      axialCompressiveLoadKN - F_internal_press_tension_KN * internalPressureAxialLoadReliefFactor;
    if (!Number.isFinite(F_net_compressive_KN) || F_net_compressive_KN <= 0) {
      return this.invalidInput('Isogrid structural estimate', [
        'positive net axial compressive load after pressure relief'
      ]);
    }

    const crossSectionAreaMetalM2 = 2.0 * Math.PI * R * t_bar_m;
    const N_axial_Pa = (F_net_compressive_KN * 1000.0) / crossSectionAreaMetalM2;

    const bucklingMarginOfSafety = sigma_press_stabilized / (N_axial_Pa * safetyFactor) - 1.0;

    return {
      success: true,
      status: 'estimate-only',
      validationLevel: 'experimental',
      inputs: { ...tankParams },
      inputSourceDescription,
      assumptions: [
        'Simplified equivalent-thickness and classical cylindrical-shell buckling equations',
        'Material properties and knockdown factors are caller supplied and unverified',
        'No code conformity, structural adequacy, or design approval is assessed'
      ],
      material,
      tankRadiusM,
      tankLengthM,
      skinThicknessMm: +t_skin_calc_mm.toFixed(2),
      isogridRibHeightMm: ribHeightMm,
      isogridRibWidthMm: ribWidthMm,
      equivalentThicknessMm: +t_bar_mm.toFixed(2),
      hoopStressMPa: +((P_internal_Pa * R) / (t_skin_calc_mm * 1e-3) / 1e6).toFixed(1),
      allowableYieldStressMPa: +(sigma_allow / 1e6).toFixed(1),
      safetyFactor,
      criticalBucklingStressMPa: +(sigma_press_stabilized / 1e6).toFixed(1),
      actualAxialStressMPa: +(N_axial_Pa / 1e6).toFixed(1),
      marginOfSafety: +bucklingMarginOfSafety.toFixed(3),
      structuralIntegrity: 'NOT ASSESSED'
    };
  }

  // =========================================================================
  // 8. Source-verified aerospace subsystem registry
  // =========================================================================

  /**
   * The prior canned WBS contained unsourced affiliations, subsystem data, and standards claims.
   * Return no records until an independently reviewed source registry is available.
   */
  getNasaSubsystemEntities() {
    return [];
  }

  /**
   * The prior canned spacecraft specification had no source provenance.
   * Return an unavailable status until a sourced, independently reviewed specification exists.
   */
  getNasaSpacecraftInteriorSpecification() {
    return {
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message: 'No sourced and independently reviewed spacecraft specification is available.'
      }
    };
  }

  // Compatibility names retained for callers of the former convenience API.
  // These adapters require caller inputs and delegate to the current methods.
  solveEquilibriumComposition(ofRatio, chamberPressurePa, propellantType) {
    const configuredPropellant = propellantType ?? this.defaultParams.propellantType;
    if (
      !Number.isFinite(ofRatio) ||
      ofRatio <= 0 ||
      !Number.isFinite(chamberPressurePa) ||
      chamberPressurePa <= 0 ||
      typeof configuredPropellant !== 'string' ||
      configuredPropellant.trim() === ''
    ) {
      return this.invalidInput('Equilibrium compatibility adapter', ['ofRatio', 'chamberPressurePa', 'propellantType']);
    }
    const result = this.evaluateCombustionEquilibrium(configuredPropellant, chamberPressurePa / 1e5, ofRatio);
    return result.success ? { ...result, characteristic_velocity_m_s: result.characteristicVelocityM_s } : result;
  }

  solveNozzleExpansion(expansionRatio, ambientPressurePa) {
    const requiredConfigured = ['propellantType', 'chamberPressureBar', 'ofRatio', 'throatDiameterM'];
    const missing = requiredConfigured.filter((name) => {
      const value = this.defaultParams[name];
      return name === 'propellantType'
        ? typeof value !== 'string' || value.trim() === ''
        : !Number.isFinite(value) || value <= 0;
    });
    if (!Number.isFinite(expansionRatio) || expansionRatio < 1) missing.push('expansionRatio >= 1');
    if (!Number.isFinite(ambientPressurePa) || ambientPressurePa < 0) missing.push('ambientPressurePa');
    if (missing.length > 0) return this.invalidInput('Nozzle compatibility adapter', missing);
    const performance = this.calculateEnginePerformance({
      ...this.defaultParams,
      expansionRatio,
      ambientPressureBar: ambientPressurePa / 1e5
    });
    if (!performance.success) return performance;
    return {
      ...performance,
      thrust_sl_kN: performance.thrustSeaLevelKN,
      thrust_vac_kN: performance.thrustVacuumKN,
      isp_sl_s: performance.IspSeaLevelS,
      isp_vac_s: performance.IspVacuumS,
      exitPressureBar: performance.exitPressureBar
    };
  }

  /**
   * Compatibility adapter for callers of the former cooling convenience API.
   * Engine conditions and coolant properties must be supplied explicitly.
   */
  solveBartzHeatTransfer(engineParameters, coolantProps) {
    const performance = this.calculateEnginePerformance(engineParameters);
    if (!performance.success) return performance;

    const cooling = this.calculateBartzRegenerativeCooling(performance, coolantProps);
    if (!cooling.success) return cooling;

    return {
      ...cooling,
      qThroat_MW_m2: cooling.heatFluxThroatMW_m2
    };
  }

  /**
   * Compatibility adapter for callers of the former turbopump convenience API.
   * Engine, coolant, and pump data must be supplied explicitly.
   */
  solveTurbopumpPowerBalance(engineParameters, coolantProps, pumpProps) {
    const performance = this.calculateEnginePerformance(engineParameters);
    if (!performance.success) return performance;

    const cooling = this.calculateBartzRegenerativeCooling(performance, coolantProps);
    if (!cooling.success) return cooling;

    const turbopump = this.calculateTurbopumpSystem(performance, cooling, pumpProps);
    if (!turbopump.success) return turbopump;

    return {
      ...turbopump,
      fuelPumpPowerMW: turbopump.fuelPumpPowerW / 1e6,
      oxPumpPowerMW: turbopump.oxidizerPumpPowerW / 1e6,
      turbopumpPowerMw: turbopump.totalPumpingPowerMW
    };
  }

  solveIsogridBuckling(tankParams) {
    return this.calculateIsogridTankBuckling(tankParams);
  }

  solveMultiStageTrajectory(missionParams) {
    return this.calculateStagingDeltaV(missionParams);
  }

  static getWbsHierarchy() {
    const instance = new NasaRocketPropulsion();
    return instance.getNasaSubsystemEntities();
  }
}

// Module export for Node.js test environment and browser window globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NasaRocketPropulsion };
}
if (typeof window !== 'undefined') {
  window.NasaRocketPropulsion = NasaRocketPropulsion;
}
