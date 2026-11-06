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
  // 7b. Isentropic nozzle compilation (Rao parabolic bell contour)
  // =========================================================================

  /**
   * Compiles a rocket nozzle design (exit Mach, static exit pressure/velocity,
   * ideal thrust coefficient, choked mass flow, and a Rao-parabolic-style
   * contour table normalized to the throat radius).
   *
   * Assumptions documented with the result:
   * - One-dimensional isentropic perfect-gas nozzle relations.
   * - Chamber gas constant R defaults to 287 J/(kg·K) (air) unless a molar mass
   *   is supplied (R = R_universal / M). Chamber temperature defaults to 3000 K.
   * - The divergent contour is the classic Rao-style parabolic arc: matched at
   *   the throat to the divergent half-angle tangent and resolving to the exit
   *   radius with zero exit slope. The convergent section is a straight cone.
   */
  compileRocketNozzle(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return this.invalidInput('Rocket nozzle compilation', ['parameter object']);
    }

    const pc =
      params.chamberPressurePa ??
      params.pc ??
      (Number.isFinite(params.chamberPressureBar) ? params.chamberPressureBar * 1e5 : undefined);
    const pa = Number.isFinite(params.ambientPressurePa) ? params.ambientPressurePa : (params.pa ?? 101325.0);
    const eps = params.expansionRatio ?? params.eps ?? params.areaRatio;
    const gamma = Number.isFinite(params.gamma) && params.gamma > 1 ? params.gamma : 1.2;
    const Tc = Number.isFinite(params.chamberTempK)
      ? params.chamberTempK
      : Number.isFinite(params.Tc)
        ? params.Tc
        : 3000.0;

    let rt;
    if (Number.isFinite(params.throatRadiusM) && params.throatRadiusM > 0) rt = params.throatRadiusM;
    else if (Number.isFinite(params.throatDiameterM) && params.throatDiameterM > 0) rt = params.throatDiameterM / 2;
    else if (Number.isFinite(params.throatAreaM2) && params.throatAreaM2 > 0)
      rt = Math.sqrt(params.throatAreaM2 / Math.PI);
    else rt = undefined;

    let R;
    if (Number.isFinite(params.specificGasConstantJ_KgK) && params.specificGasConstantJ_KgK > 0) {
      R = params.specificGasConstantJ_KgK;
    } else if (Number.isFinite(params.molarMassKgMol) && params.molarMassKgMol > 0) {
      R = this.R_UNIVERSAL / (1000.0 * params.molarMassKgMol);
    } else {
      R = 287.0;
    }

    const missingInputs = [];
    if (!Number.isFinite(pc) || pc <= 0) missingInputs.push('chamberPressurePa');
    if (!Number.isFinite(eps) || eps < 1) missingInputs.push('expansionRatio >= 1');
    if (!Number.isFinite(rt) || rt <= 0) missingInputs.push('throatRadiusM | throatDiameterM | throatAreaM2');
    if (!Number.isFinite(pa) || pa < 0) missingInputs.push('ambientPressurePa >= 0');
    if (!Number.isFinite(Tc) || Tc <= 0) missingInputs.push('chamberTempK');
    if (missingInputs.length > 0) return this.invalidInput('Rocket nozzle compilation', missingInputs);

    let Me;
    try {
      Me = solveNozzleExitMach(eps, gamma);
    } catch (err) {
      return this.numericalFailure('Rocket nozzle compilation', `exit Mach inversion failed: ${err.message}`);
    }

    const totalToStatic = 1.0 + 0.5 * (gamma - 1.0) * Me * Me;
    const pe = pc * Math.pow(totalToStatic, -gamma / (gamma - 1.0));
    const Te = Tc / totalToStatic;
    const ve = Math.sqrt(((2.0 * gamma) / (gamma - 1.0)) * R * Tc * (1.0 - Math.pow(pe / pc, (gamma - 1.0) / gamma)));

    const At = Math.PI * rt * rt;
    const Ae = At * eps;
    const re = rt * Math.sqrt(eps);

    // Ideal thrust coefficient: momentum + pressure terms.
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const cfMomentum = Math.sqrt(
      ((2.0 * gamma * gamma) / gm1) * Math.pow(2.0 / gp1, gp1 / gm1) * (1.0 - Math.pow(pe / pc, gm1 / gamma))
    );
    const cfPressure = ((pe - pa) / pc) * eps;
    const cf = cfMomentum + cfPressure;
    const cfVacuum = cfMomentum + (pe / pc) * eps;

    // Choked flow mass flow estimate: mdot = pc*At*sqrt(gamma/(R*Tc))*(2/(gamma+1))^((gamma+1)/(2(gamma-1)))
    let mdot = Number.isFinite(params.massFlowKgS) && params.massFlowKgS > 0 ? params.massFlowKgS : undefined;
    if (mdot === undefined) {
      mdot = pc * At * Math.sqrt(gamma / (R * Tc)) * Math.pow(2.0 / gp1, gp1 / (2.0 * gm1));
    }
    const thrustN = mdot * ve + (pe - pa) * Ae;
    const thrustVacuumN = mdot * ve + pe * Ae;

    // Rao-parabolic-style contour (x in metres from throat, r normalized by throat radius).
    const thetaConv =
      ((Number.isFinite(params.convergentAngleDeg) ? params.convergentAngleDeg : 45.0) * Math.PI) / 180.0;
    const thetaDiv = ((Number.isFinite(params.divergentAngleDeg) ? params.divergentAngleDeg : 15.0) * Math.PI) / 180.0;
    const rc =
      Number.isFinite(params.chamberRadiusM) && params.chamberRadiusM > 0
        ? params.chamberRadiusM
        : (params.chamberRadiusRatio ?? 2.5) * rt;
    const Lc = (rc - rt) / Math.tan(thetaConv);
    const Ld = (2.0 * (re - rt)) / Math.tan(thetaDiv);
    const contourPoints = 48;
    const contour = [];
    const contourMeters = [];
    for (let i = 0; i < contourPoints; i++) {
      const t = i / (contourPoints - 1);
      const x = -Lc + t * (Lc + Ld);
      let r;
      if (x < 0) {
        r = rc - ((rc - rt) * (x + Lc)) / Lc;
      } else {
        r = rt + Math.tan(thetaDiv) * x - (Math.tan(thetaDiv) / (2.0 * Ld)) * x * x;
      }
      contour.push({ x: +x.toPrecision(8), r: +(r / rt).toPrecision(8) });
      contourMeters.push({ x: +x.toPrecision(8), r: +r.toPrecision(8) });
    }

    const outputs = [Me, pe, ve, cf, mdot, thrustN, Te];
    if (!outputs.every(Number.isFinite) || outputs.some((value) => value <= 0)) {
      return this.numericalFailure(
        'Rocket nozzle compilation',
        'one or more calculated quantities are non-finite or non-positive'
      );
    }

    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      inputs: {
        chamberPressurePa: pc,
        ambientPressurePa: pa,
        expansionRatio: eps,
        throatRadiusM: rt,
        gamma,
        chamberTempK: Tc,
        specificGasConstantJ_KgK: R,
        convergentAngleDeg: (thetaConv * 180) / Math.PI,
        divergentAngleDeg: (thetaDiv * 180) / Math.PI,
        chamberRadiusRatio: rc / rt
      },
      assumptions: [
        'One-dimensional ideal isentropic nozzle relations; boundary layer, separation, and losses are not modeled',
        `Specific gas constant R = ${R.toFixed(1)} J/(kg·K) (molar-mass-derived or default air 287); chamber temperature Tc = ${Tc.toFixed(1)} K`,
        'Divergent contour is a Rao-parabolic arc matched to the divergent half-angle at the throat and resolving to the exit radius with zero exit slope; convergent section is a straight cone',
        'Mass flow is the choked-flow estimate mdot = pc*At*sqrt(gamma/(R*Tc))*(2/(gamma+1))^((gamma+1)/(2(gamma-1))) unless a massFlowKgS input overrides it',
        'Contour r values are normalized by the throat radius; x is metres from the throat plane'
      ],
      exitMach: Me,
      exitPressurePa: pe,
      exitPressureBar: pe / 1e5,
      exitTemperatureK: Te,
      exitVelocityMps: ve,
      areaRatio: eps,
      contour,
      contourMeters,
      throatRadiusM: rt,
      throatAreaM2: At,
      exitAreaM2: Ae,
      exitDiameterM: 2.0 * re,
      massFlowKgS: mdot,
      thrustCoefficient: cf,
      thrustCoefficientVacuum: cfVacuum,
      thrustN,
      thrustVacuumN,
      thrustSeaLevelKN: thrustN / 1000.0,
      thrustVacuumKN: thrustVacuumN / 1000.0
    };
  }

  // =========================================================================
  // 7c. Supersonic shock-expansion aerodynamic analysis
  // =========================================================================

  /**
   * Supersonic shock-expansion analysis around a symmetric double-wedge airfoil
   * or an axisymmetric cone:
   * - Double wedge: leading-edge oblique shocks (lower surface), Prandtl-Meyer
   *   expansions, trailing-edge expansion (lower) / compression (upper), with
   *   surface pressures integrated to CL, CD, and CM about the leading edge.
   * - Cone: Taylor-Maccoll conical flow at zero angle of attack with a
   *   linearized supersonic angle-of-attack correction; forces integrated over
   *   the conical surface and referenced to the base area.
   */
  runAerospaceCFD(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return this.invalidInput('Aerospace CFD analysis', ['parameter object']);
    }

    const MInf = params.machNumber ?? params.MInf ?? params.mach;
    const gamma = Number.isFinite(params.gamma) && params.gamma > 1 ? params.gamma : 1.4;
    const alphaDeg = Number.isFinite(params.angleOfAttackDeg)
      ? params.angleOfAttackDeg
      : Number.isFinite(params.alphaDeg)
        ? params.alphaDeg
        : 0.0;
    const altitudeM = Number.isFinite(params.altitudeM) ? params.altitudeM : 0.0;
    const wedgeDeg = params.wedgeHalfAngleDeg ?? params.deflectionAngleDeg;
    const coneDeg = params.coneAngleDeg ?? params.coneHalfAngleDeg;
    const geometry = params.geometry === 'cone' || Number.isFinite(coneDeg) ? 'cone' : 'double-wedge';

    const missingInputs = [];
    if (!Number.isFinite(MInf) || MInf <= 1) missingInputs.push('machNumber > 1');
    const halfAngleDeg = geometry === 'cone' ? coneDeg : wedgeDeg;
    if (!Number.isFinite(halfAngleDeg) || halfAngleDeg <= 0) {
      missingInputs.push(geometry === 'cone' ? 'coneAngleDeg' : 'wedgeHalfAngleDeg | deflectionAngleDeg');
    }
    const chordM = params.chordM ?? params.lengthM ?? params.referenceLengthM;
    if (!Number.isFinite(chordM) || chordM <= 0) missingInputs.push('chordM | lengthM');
    if (missingInputs.length > 0) return this.invalidInput('Aerospace CFD analysis', missingInputs);

    const atm = this.get1976Atmosphere(altitudeM);
    if (!atm.success) return this.invalidInput('Aerospace CFD analysis', ['altitudeM within 1976 atmosphere range']);
    const pInf = atm.pressurePa;
    const TInf = atm.temperatureK;
    const rhoInf = atm.densityKgM3;
    const aInf = atm.speedOfSoundM_s;
    const VInf = MInf * aInf;
    const qInf = 0.5 * rhoInf * VInf * VInf;

    const halfAngleRad = (halfAngleDeg * Math.PI) / 180.0;
    const alphaRad = (alphaDeg * Math.PI) / 180.0;

    let result;
    if (geometry === 'double-wedge') {
      result = this._doubleWedgeShockExpansion(
        MInf,
        gamma,
        alphaRad,
        halfAngleRad,
        chordM,
        pInf,
        qInf,
        params.referenceAreaM2
      );
    } else {
      result = this._conicalFlowShockExpansion(
        MInf,
        gamma,
        alphaRad,
        halfAngleRad,
        chordM,
        pInf,
        qInf,
        params.referenceAreaM2
      );
    }
    if (result.success === false) return result;
    return {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      geometry,
      machNumber: MInf,
      angleOfAttackDeg: alphaDeg,
      alphaRad,
      altitudeM,
      freestreamPressurePa: pInf,
      freestreamTemperatureK: TInf,
      freestreamDensityKgM3: rhoInf,
      freestreamVelocityMps: VInf,
      dynamicPressurePa: qInf,
      ...result,
      assumptions: [
        'Inviscid supersonic shock-expansion theory; no boundary layer, viscosity, or finite-wall effects are modeled',
        'Double wedge: leading-edge oblique shock, Prandtl-Meyer expansion, and trailing-edge processes per surface; forces per unit span referenced to chord',
        'Cone: Taylor-Maccoll conical-flow surface pressure at alpha = 0 with a linearized supersonic angle-of-attack correction; forces referenced to the base area',
        'All coefficients are experimental estimates, not wind-tunnel or flight-derived data'
      ]
    };
  }

  _doubleWedgeShockExpansion(MInf, gamma, alphaRad, deltaRad, chordM, pInf, qInf, referenceAreaM2) {
    const twoDelta = 2.0 * deltaRad;
    const turning = alphaRad + deltaRad;

    // Lower fore surface: oblique compression shock (attached) for turning > 0.
    let lowerForeP;
    let lowerForeM;
    if (turning > 1e-12) {
      const beta = solveObliqueShockBeta(MInf, turning, gamma);
      if (!Number.isFinite(beta)) {
        return {
          success: false,
          status: 'numerical-failure',
          error: {
            code: 'NUMERICAL_FAILURE',
            message: `Detached leading-edge lower shock for deflection ${(turning * 180) / Math.PI} deg at M = ${MInf}.`
          }
        };
      }
      const st = obliqueShockState(MInf, beta, turning, gamma);
      lowerForeP = st.pRatio * pInf;
      lowerForeM = st.M2;
    } else {
      lowerForeP = pInf;
      lowerForeM = MInf;
    }

    // Upper fore surface: compression shock by (delta - alpha) when the
    // incidence is positive, Prandtl-Meyer expansion of (alpha - delta) when
    // the upper surface is leeward (alpha > delta).
    const upperTurn = deltaRad - alphaRad;
    let upperForeP;
    let upperForeM;
    if (Math.abs(upperTurn) < 1e-12) {
      upperForeP = pInf;
      upperForeM = MInf;
    } else if (upperTurn > 0) {
      const beta = solveObliqueShockBeta(MInf, upperTurn, gamma);
      if (!Number.isFinite(beta)) {
        return {
          success: false,
          status: 'numerical-failure',
          error: {
            code: 'NUMERICAL_FAILURE',
            message: `Detached upper-surface shock for deflection ${(upperTurn * 180) / Math.PI} deg at M = ${MInf}.`
          }
        };
      }
      const st = obliqueShockState(MInf, beta, upperTurn, gamma);
      upperForeP = st.pRatio * pInf;
      upperForeM = st.M2;
    } else {
      const nuTarget = prandtlMeyerFunction(MInf, gamma) - upperTurn;
      const MUpper = inversePrandtlMeyerFunction(nuTarget, gamma);
      if (!Number.isFinite(MUpper)) {
        return {
          success: false,
          status: 'numerical-failure',
          error: {
            code: 'NUMERICAL_FAILURE',
            message: 'Upper-surface expansion angle exceeds the Prandtl-Meyer maximum.'
          }
        };
      }
      upperForeM = MUpper;
      upperForeP = pInf * isentropicPressureRatio(MInf, MUpper, gamma);
    }

    // Lower aft: expansion by 2*delta after the lower fore shock.
    let lowerAftP;
    let lowerAftM;
    if (lowerForeM > 1.0001) {
      const nuTarget = prandtlMeyerFunction(lowerForeM, gamma) + twoDelta;
      const MAft = inversePrandtlMeyerFunction(nuTarget, gamma);
      if (!Number.isFinite(MAft)) {
        return {
          success: false,
          status: 'numerical-failure',
          error: {
            code: 'NUMERICAL_FAILURE',
            message: 'Lower aft-surface expansion angle exceeds the Prandtl-Meyer maximum.'
          }
        };
      }
      lowerAftM = MAft;
      lowerAftP = lowerForeP * isentropicPressureRatio(lowerForeM, MAft, gamma);
    } else {
      lowerAftM = lowerForeM;
      lowerAftP = lowerForeP;
    }

    // Upper aft: expansion by 2*delta after the upper fore process (the
    // trailing-edge surfaces turn the flow back toward the freestream
    // direction, which is a convex corner: an expansion fan).
    let upperAftP;
    let upperAftM;
    if (upperForeM > 1.0001) {
      const nuTarget = prandtlMeyerFunction(upperForeM, gamma) + twoDelta;
      const MAft = inversePrandtlMeyerFunction(nuTarget, gamma);
      if (!Number.isFinite(MAft)) {
        return {
          success: false,
          status: 'numerical-failure',
          error: {
            code: 'NUMERICAL_FAILURE',
            message: 'Upper aft-surface expansion angle exceeds the Prandtl-Meyer maximum.'
          }
        };
      }
      upperAftM = MAft;
      upperAftP = upperForeP * isentropicPressureRatio(upperForeM, MAft, gamma);
    } else {
      upperAftP = upperForeP;
      upperAftM = upperForeM;
    }

    const pressures = [lowerForeP, lowerAftP, upperForeP, upperAftP];
    if (!pressures.every(Number.isFinite) || pressures.some((p) => p <= 0)) {
      return {
        success: false,
        status: 'numerical-failure',
        error: { code: 'NUMERICAL_FAILURE', message: 'Surface pressures are non-finite or non-positive.' }
      };
    }

    // Per unit span:
    const liftPerSpan = (chordM / 2.0) * (lowerForeP + lowerAftP - upperForeP - upperAftP);
    const dragPerSpan = (chordM / 2.0) * Math.tan(deltaRad) * (lowerForeP - lowerAftP + upperAftP - upperForeP);

    // Thin-body pitching moment about the leading edge from the integrated
    // pressure on the chordwise (planform) projection. The y*Fx cross terms
    // of a full surface integration cancel by symmetry for the symmetric
    // wedge and are neglected per standard slender-body practice.
    const momentAboutLE =
      ((chordM * chordM) / 8.0) * (lowerForeP - upperForeP) + ((3.0 * chordM * chordM) / 8.0) * (lowerAftP - upperAftP);

    const refArea = Number.isFinite(referenceAreaM2) && referenceAreaM2 > 0 ? referenceAreaM2 : chordM;
    const cl = liftPerSpan / (qInf * refArea);
    const cd = dragPerSpan / (qInf * refArea);
    const cm = momentAboutLE / (qInf * refArea * chordM);

    return {
      surfacePressuresPa: { lowerFore: lowerForeP, lowerAft: lowerAftP, upperFore: upperForeP, upperAft: upperAftP },
      surfaceMachNumbers: { lowerFore: lowerForeM, lowerAft: lowerAftM, upperFore: upperForeM, upperAft: upperAftM },
      referenceAreaM2: refArea,
      referenceLengthM: chordM,
      liftPerSpanN: liftPerSpan,
      dragPerSpanN: dragPerSpan,
      cl,
      cd,
      cm,
      cL: cl,
      cD: cd,
      cM: cm
    };
  }

  _conicalFlowShockExpansion(MInf, gamma, alphaRad, thetaRad, lengthM, pInf, qInf, referenceAreaM2) {
    const surface = this._solveConicalFlowSurfacePressure(MInf, gamma, thetaRad);
    if (!surface) {
      return {
        success: false,
        status: 'numerical-failure',
        error: {
          code: 'NUMERICAL_FAILURE',
          message: 'Taylor-Maccoll conical flow did not converge to an attached shock solution.'
        }
      };
    }
    const p0 = surface.pSurface * pInf;
    const pShocked = surface.p2 * pInf;
    const baseRadiusM = lengthM * Math.tan(thetaRad);
    const refArea =
      Number.isFinite(referenceAreaM2) && referenceAreaM2 > 0 ? referenceAreaM2 : Math.PI * baseRadiusM * baseRadiusM;

    // Linearized supersonic angle-of-attack correction: Cp(phi) = Cp0 + (2*alpha/sqrt(M^2-1))*cos(phi)
    const deltaCp = (2.0 * alphaRad) / Math.sqrt(MInf * MInf - 1.0);
    const deltaP = qInf * deltaCp;

    const dragN = Math.PI * lengthM * lengthM * Math.tan(thetaRad) * Math.tan(thetaRad) * p0;
    const liftN = (Math.PI / 2.0) * lengthM * lengthM * Math.tan(thetaRad) * deltaP;
    const momentAboutApex = -(2.0 / 3.0) * lengthM * liftN;

    const cl = liftN / (qInf * refArea);
    const cd = dragN / (qInf * refArea);
    const cm = momentAboutApex / (qInf * refArea * lengthM);

    return {
      surfacePressuresPa: { coneSurface: p0, shocked: pShocked, freestream: pInf },
      coneShockAngleDeg: (surface.beta * 180) / Math.PI,
      surfaceMach: surface.MSurface,
      baseAreaM2: Math.PI * baseRadiusM * baseRadiusM,
      baseRadiusM,
      referenceAreaM2: refArea,
      referenceLengthM: lengthM,
      liftN,
      dragN,
      cl,
      cd,
      cm,
      cL: cl,
      cD: cd,
      cM: cm
    };
  }

  _solveConicalFlowSurfacePressure(M1, gamma, thetaC) {
    // Taylor-Maccoll conical flow. Velocities are normalized by the
    // freestream speed V_inf = 1. Across the oblique shock the total enthalpy
    // is conserved but the static enthalpy rises, so the flow speed drops to
    // V2 = M2*a2 < 1 and stays constant through the isentropic conical field.
    const aInfSq = 1.0 / (M1 * M1);
    const a0Sq = aInfSq * (1.0 + ((gamma - 1.0) / 2.0) * M1 * M1);

    const mu = Math.asin(1.0 / M1);
    const limit = Math.PI / 2.0 - 1e-9;

    const f = (beta) => {
      const delta = thetaFromBeta(M1, beta, gamma);
      if (!Number.isFinite(delta)) return null;
      const sinB = Math.sin(beta);
      const M1n = M1 * sinB;
      const M2nSq = (M1n * M1n + 2.0 / (gamma - 1.0)) / (((2.0 * gamma) / (gamma - 1.0)) * M1n * M1n - 1.0);
      if (M2nSq <= 0) return null;
      const M2 = Math.sqrt(M2nSq) / Math.sin(beta - delta);
      const T2OverT1 = (1.0 + ((gamma - 1.0) / 2.0) * M1 * M1) / (1.0 + ((gamma - 1.0) / 2.0) * M2 * M2);
      const a2Sq = aInfSq * T2OverT1;
      const V2 = M2 * Math.sqrt(a2Sq);
      const aSq = a2Sq;

      // Just downstream of the oblique shock the flow direction makes angle
      // delta with the axis, while the spherical coordinate there is the
      // shock cone angle beta, so the velocity components are:
      let vr = V2 * Math.cos(beta - delta);
      let vtheta = -V2 * Math.sin(beta - delta);
      const steps = 500;
      const h = (beta - thetaC) / steps;
      for (let i = 0; i < steps; i++) {
        const theta = beta - i * h;
        const deriv = (th, vr0, vt0) => {
          const denom = aSq - vt0 * vt0;
          if (Math.abs(denom) < 1e-12) return null;
          // Taylor-Maccoll radial/angular momentum system:
          //   dvr/dtheta = vtheta
          //   dvtheta/dtheta = [a^2*(vtheta*cot(theta) + 2*vr) - vtheta^2*vr] / (a^2 - vtheta^2)
          const dvth = (aSq * ((vt0 * Math.cos(th)) / Math.sin(th) + 2.0 * vr0) - vt0 * vt0 * vr0) / denom;
          return { vr: vt0, vth: dvth };
        };
        const k1 = deriv(theta, vr, vtheta);
        if (!k1) return null;
        const k2 = deriv(theta - h / 2, vr + (h / 2) * k1.vr, vtheta + (h / 2) * k1.vth);
        if (!k2) return null;
        const k3 = deriv(theta - h / 2, vr + (h / 2) * k2.vr, vtheta + (h / 2) * k2.vth);
        if (!k3) return null;
        const k4 = deriv(theta - h, vr + h * k3.vr, vtheta + h * k3.vth);
        if (!k4) return null;
        vr += (h / 6.0) * (k1.vr + 2.0 * k2.vr + 2.0 * k3.vr + k4.vr);
        vtheta += (h / 6.0) * (k1.vth + 2.0 * k2.vth + 2.0 * k3.vth + k4.vth);
      }
      const MSurface = Math.sqrt((vr * vr + vtheta * vtheta) / aSq);
      const pRatioFrom2 = Math.pow(
        (1.0 + ((gamma - 1.0) / 2.0) * M2 * M2) / (1.0 + ((gamma - 1.0) / 2.0) * MSurface * MSurface),
        gamma / (gamma - 1.0)
      );
      const p2Ratio = 1.0 + ((2.0 * gamma) / (gamma + 1.0)) * (M1n * M1n - 1.0);
      return { vthetaSurface: vtheta, MSurface, pSurfaceRatio: p2Ratio * pRatioFrom2, beta, delta, M2 };
    };

    // Scan for first sign change of vtheta(thetaC) as beta increases from the Mach angle.
    let previous = null;
    let previousBeta = mu + 1e-6;
    for (let i = 1; i <= 400; i++) {
      const beta = mu + (limit - mu) * (i / 400.0);
      const state = f(beta);
      if (!state) {
        previous = null;
        previousBeta = beta;
        continue;
      }
      if (previous !== null && previous.vthetaSurface * state.vthetaSurface < 0) {
        let lo = previousBeta;
        let hi = beta;
        let loState = previous;
        for (let iter = 0; iter < 80; iter++) {
          const mid = 0.5 * (lo + hi);
          const midState = f(mid);
          if (!midState) break;
          if (midState.vthetaSurface * loState.vthetaSurface <= 0) {
            hi = mid;
          } else {
            lo = mid;
            loState = midState;
          }
        }
        const root = 0.5 * (lo + hi);
        const rootState = f(root);
        if (rootState) {
          return {
            beta: root,
            p2: pInf2Ratio(M1, root, gamma),
            MSurface: rootState.MSurface,
            vthetaSurface: rootState.vthetaSurface,
            delta: rootState.delta,
            pSurface: rootState.pSurfaceRatio * pInf2Ratio(M1, root, gamma)
          };
        }
      }
      previous = state;
      previousBeta = beta;
    }
    return null;
  }

  // =========================================================================
  // 7d. Orbital transfer (Hohmann and bi-elliptic)
  // =========================================================================

  /**
   * Two-impulse Hohmann (and optional bi-elliptic) orbital transfer analysis.
   * Default gravitational parameter mu = 3.986004418e14 m^3/s^2 (Earth).
   */
  calculateOrbitalTransfer(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return this.invalidInput('Orbital transfer analysis', ['parameter object']);
    }
    const r1 = params.r1Meters ?? params.r1;
    const r2 = params.r2Meters ?? params.r2;
    const mu = Number.isFinite(params.mu) && params.mu > 0 ? params.mu : 3.986004418e14;

    const missingInputs = [];
    if (!Number.isFinite(r1) || r1 <= 0) missingInputs.push('r1Meters');
    if (!Number.isFinite(r2) || r2 <= 0) missingInputs.push('r2Meters');

    const biElliptic = Boolean(params.biElliptic) || Number.isFinite(params.intermediateRadiusM);
    const rA = biElliptic
      ? Number.isFinite(params.intermediateRadiusM)
        ? params.intermediateRadiusM
        : params.rA
      : undefined;
    if (biElliptic && (!Number.isFinite(rA) || rA <= Math.max(r1, r2))) {
      missingInputs.push('intermediateRadiusM > max(r1Meters, r2Meters) for bi-elliptic');
    }
    if (!biElliptic && r2 <= r1) {
      missingInputs.push('r2Meters > r1Meters for outbound Hohmann transfer');
    }
    if (missingInputs.length > 0) return this.invalidInput('Orbital transfer analysis', missingInputs);

    const sqrtMuOverR1 = Math.sqrt(mu / r1);
    const sqrtMuOverR2 = Math.sqrt(mu / r2);
    const deltaV1 = sqrtMuOverR1 * (Math.sqrt((2.0 * r2) / (r1 + r2)) - 1.0);
    const deltaV2 = sqrtMuOverR2 * (1.0 - Math.sqrt((2.0 * r1) / (r1 + r2)));
    const deltaVTotal = deltaV1 + deltaV2;
    const timeOfFlightS = Math.PI * Math.sqrt(Math.pow(r1 + r2, 3) / (8.0 * mu));

    const output = {
      success: true,
      status: 'computed',
      validationLevel: 'experimental',
      inputs: { r1Meters: r1, r2Meters: r2, mu, biElliptic },
      assumptions: [
        'Ideal impulsive two-burn orbital transfers in a point-mass central gravity field',
        'Hohmann transfer assumes coplanar circular orbits with no plane change; phasing and perturbations are ignored',
        'Bi-elliptic uses the supplied intermediate radius rA; preference over Hohmann depends on rA/r1 and the mission delta-V budget'
      ],
      transferType: biElliptic ? 'bi-elliptic' : 'hohmann',
      mu,
      r1Meters: r1,
      r2Meters: r2,
      r1Km: r1 / 1000.0,
      r2Km: r2 / 1000.0,
      deltaV1,
      deltaV2,
      deltaVTotal,
      deltaV1KmS: deltaV1 / 1000.0,
      deltaV2KmS: deltaV2 / 1000.0,
      deltaVTotalKmS: deltaVTotal / 1000.0,
      timeOfFlightS,
      timeOfFlightHours: timeOfFlightS / 3600.0
    };

    if (biElliptic) {
      const sqr1 = Math.sqrt(mu / r1);
      const sqrA = Math.sqrt(mu / rA);
      const sqr2 = Math.sqrt(mu / r2);
      const b1 = sqr1 * (Math.sqrt((2.0 * rA) / (r1 + rA)) - 1.0);
      const b2 = sqrA * (Math.sqrt((2.0 * r2) / (rA + r2)) - Math.sqrt((2.0 * r1) / (rA + r1)));
      const b3 = sqr2 * (1.0 - Math.sqrt((2.0 * rA) / (r2 + rA)));
      const bTotal = b1 + b2 + b3;
      const bTof =
        Math.PI * (Math.sqrt(Math.pow(r1 + rA, 3) / (8.0 * mu)) + Math.sqrt(Math.pow(rA + r2, 3) / (8.0 * mu)));
      output.intermediateRadiusM = rA;
      output.intermediateRadiusKm = rA / 1000.0;
      output.biEllipticDeltaV1 = b1;
      output.biEllipticDeltaV2 = b2;
      output.biEllipticDeltaV3 = b3;
      output.biEllipticDeltaVTotal = bTotal;
      output.biEllipticDeltaVTotalKmS = bTotal / 1000.0;
      output.biEllipticTimeOfFlightS = bTof;
      output.biEllipticTimeOfFlightHours = bTof / 3600.0;
    }

    return output;
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

// =========================================================================
// Standalone compressible-flow helpers (exported for tests and reuse)
// =========================================================================

/**
 * Inverts the isentropic area-Mach relation A/A* = f(M) for a given area
 * expansion ratio eps = Ae/At by bisection on [1.0001, 20].
 */
function solveNozzleExitMach(expansionRatio, gamma) {
  if (!Number.isFinite(expansionRatio) || expansionRatio < 1 || !Number.isFinite(gamma) || gamma <= 1) {
    throw new RangeError('Nozzle estimate requires expansionRatio >= 1 and gamma > 1.');
  }
  if (expansionRatio <= 1.0) return 1.0;
  const areaRatio = (mach) => {
    const term = (2.0 / (gamma + 1.0)) * (1.0 + 0.5 * (gamma - 1.0) * mach * mach);
    return Math.pow(term, (gamma + 1.0) / (2.0 * (gamma - 1.0))) / mach;
  };
  let lower = 1.0001;
  let upper = 20.0;
  if (areaRatio(upper) < expansionRatio) {
    throw new RangeError('Nozzle area ratio is outside the supported M <= 20 bisection range.');
  }
  for (let iteration = 0; iteration < 200; iteration++) {
    const mach = 0.5 * (lower + upper);
    const ratio = areaRatio(mach);
    if (!Number.isFinite(ratio)) throw new RangeError('Nozzle Mach inversion produced a non-finite result.');
    if (Math.abs(ratio - expansionRatio) <= 1e-12 * expansionRatio || upper - lower <= 1e-12 * mach) return mach;
    if (ratio < expansionRatio) lower = mach;
    else upper = mach;
  }
  throw new Error('Nozzle Mach inversion did not converge within 200 bisection steps.');
}

/**
 * Oblique-shock deflection angle delta(M1, beta, gamma).
 * Returns NaN when beta is below the Mach angle.
 */
function thetaFromBeta(M1, beta, gamma) {
  const sinB = Math.sin(beta);
  const term = M1 * M1 * sinB * sinB - 1.0;
  if (term <= 0) return NaN;
  const numerator = 2.0 * (Math.cos(beta) / sinB) * term;
  const denominator = M1 * M1 * (gamma + Math.cos(2.0 * beta)) + 2.0;
  return Math.atan(numerator / denominator);
}

/**
 * Solves the theta-beta-M relation for the weak attached oblique-shock angle.
 * Returns null when the deflection exceeds the maximum for an attached shock.
 */
function solveObliqueShockBeta(M1, theta, gamma) {
  if (!Number.isFinite(M1) || M1 <= 1 || !Number.isFinite(theta) || theta <= 0) return null;
  const mu = Math.asin(1.0 / M1);
  const limit = Math.PI / 2.0 - 1e-9;
  const target = Math.tan(theta);
  let previousF = null;
  let previousBeta = mu + 1e-6;
  const b = (beta) => target - Math.tan(thetaFromBeta(M1, beta, gamma));
  for (let i = 1; i <= 400; i++) {
    const beta = mu + (limit - mu) * (i / 400.0);
    const val = b(beta);
    if (!Number.isFinite(val)) {
      previousF = null;
      previousBeta = beta;
      continue;
    }
    if (previousF !== null && previousF > 0 && val < 0) {
      let lo = previousBeta;
      let hi = beta;
      for (let iter = 0; iter < 100; iter++) {
        const mid = 0.5 * (lo + hi);
        const midVal = b(mid);
        if (!Number.isFinite(midVal)) break;
        if (midVal > 0) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    }
    previousF = val;
    previousBeta = beta;
  }
  return null;
}

/**
 * Post-shock state for an attached oblique shock: downstream Mach number and
 * static pressure ratio p2/p1.
 */
function obliqueShockState(M1, beta, theta, gamma) {
  const sinB = Math.sin(beta);
  const M1n = M1 * sinB;
  const M2nSq = (M1n * M1n + 2.0 / (gamma - 1.0)) / (((2.0 * gamma) / (gamma - 1.0)) * M1n * M1n - 1.0);
  const pRatio = 1.0 + ((2.0 * gamma) / (gamma + 1.0)) * (M1n * M1n - 1.0);
  if (M2nSq <= 0) return { M2: NaN, pRatio: NaN };
  return { M2: Math.sqrt(M2nSq) / Math.sin(beta - theta), pRatio };
}

function pInf2Ratio(M1, beta, gamma) {
  const sinB = Math.sin(beta);
  const M1n = M1 * sinB;
  return 1.0 + ((2.0 * gamma) / (gamma + 1.0)) * (M1n * M1n - 1.0);
}

/**
 * Prandtl-Meyer expansion angle nu(M).
 */
function prandtlMeyerFunction(M, gamma) {
  const gm1 = gamma - 1.0;
  const gp1 = gamma + 1.0;
  return Math.sqrt(gp1 / gm1) * Math.atan(Math.sqrt((gm1 * (M * M - 1.0)) / gp1)) - Math.atan(Math.sqrt(M * M - 1.0));
}

/**
 * Inverse Prandtl-Meyer function: returns M for a target expansion angle.
 * Returns NaN when the target exceeds the maximum expansion angle.
 */
function inversePrandtlMeyerFunction(targetNu, gamma) {
  const maxNu = (Math.PI / 2.0) * (Math.sqrt((gamma + 1.0) / (gamma - 1.0)) - 1.0);
  if (!Number.isFinite(targetNu) || targetNu < 0 || targetNu >= maxNu) return NaN;
  let lo = 1.0;
  let hi = 2000.0;
  for (let iter = 0; iter < 200; iter++) {
    const mid = 0.5 * (lo + hi);
    const nu = prandtlMeyerFunction(mid, gamma);
    if (Math.abs(nu - targetNu) <= 1e-12 * (1.0 + targetNu) || hi - lo <= 1e-12 * mid) return mid;
    if (nu < targetNu) lo = mid;
    else hi = mid;
  }
  return NaN;
}

function isentropicPressureRatio(M1, M2, gamma) {
  const top = 1.0 + 0.5 * (gamma - 1.0) * M1 * M1;
  const bottom = 1.0 + 0.5 * (gamma - 1.0) * M2 * M2;
  return Math.pow(top / bottom, gamma / (gamma - 1.0));
}

// Module export for Node.js test environment and browser window globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NasaRocketPropulsion,
    solveNozzleExitMach,
    solveObliqueShockBeta,
    obliqueShockState,
    thetaFromBeta,
    prandtlMeyerFunction,
    inversePrandtlMeyerFunction,
    isentropicPressureRatio
  };
}
if (typeof window !== 'undefined') {
  window.NasaRocketPropulsion = NasaRocketPropulsion;
  window.solveNozzleExitMach = solveNozzleExitMach;
  window.solveObliqueShockBeta = solveObliqueShockBeta;
  window.prandtlMeyerFunction = prandtlMeyerFunction;
}
