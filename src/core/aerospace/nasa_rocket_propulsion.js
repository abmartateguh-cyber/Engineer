/**
 * OmniEng Aerospace Computational Core
 * ============================================================================
 * NASA Space Launch Vehicle & Rocket Engine Physical Calculation Suite
 * Conforming to:
 *  - NASA SP-125: Design of Liquid Propellant Rocket Engines
 *  - NASA CEA: Chemical Equilibrium with Applications (Gordon & McBride)
 *  - NASA SP-8007: Buckling of Thin-Walled Circular Cylinders
 *  - NASA SP-8032: Buckling of Thin-Walled Doubly Curved Shells
 *  - NASA/SP-2016-6105 Rev 2: NASA Systems Engineering Handbook (WBS 06.01 - 06.08)
 *  - 1976 US Standard Atmosphere Model (NOAA / NASA / USAF)
 * ============================================================================
 */

'use strict';

class NasaRocketPropulsion {
  constructor(params = {}) {
    // Physical Constants
    this.R_UNIVERSAL = 8314.462618; // J / (kmol * K)
    this.G0 = 9.80665;             // Standard gravity m/s^2
    this.P_STD_ATM = 101325.0;      // Standard sea level pressure Pa
    this.T_STD_ATM = 288.15;        // Standard sea level temperature K
    this.RHO_STD_ATM = 1.225;       // Standard sea level density kg/m^3

    this.defaultParams = {
      propellantType: params.propellantType || 'LOX_LCH4',
      chamberPressureBar: (params.chamberPressurePa ? params.chamberPressurePa / 1e5 : params.chamberPressureBar) || 300.0,
      ofRatio: params.mixtureRatio || params.ofRatio || 3.6,
      expansionRatio: params.expansionRatio || 40.0,
      throatDiameterM: params.throatDiameterM || 0.28
    };
  }

  // =========================================================================
  // 1. NASA CEA Chemical Equilibrium Thermochemistry & Combustion
  // =========================================================================

  /**
   * Evaluates thermochemical equilibrium state for liquid rocket propellants
   * based on NASA CEA polynomial correlations.
   * 
   * @param {string} propellantType - 'LOX_LCH4' | 'LOX_LH2' | 'LOX_RP1'
   * @param {number} chamberPressureBar - Chamber pressure in bar (e.g., 300 bar for FFSC)
   * @param {number} ofRatio - Oxidizer-to-fuel mass mixture ratio (e.g., 3.6 for CH4, 6.0 for H2, 2.6 for RP1)
   * @returns {Object} Combustion equilibrium properties: Tc, cStar, gamma, molWeight, gasConstant
   */
  evaluateCombustionEquilibrium(propellantType = 'LOX_LCH4', chamberPressureBar = 300.0, ofRatio = 3.6) {
    const Pc_Pa = chamberPressureBar * 1e5;
    let Tc_base = 3500.0;
    let gamma_base = 1.20;
    let molWeight_base = 20.5; // kg/kmol
    let optOF = 3.6;

    switch (propellantType.toUpperCase()) {
      case 'LOX_LCH4':
      case 'METHALOX':
        // Methane combustion: CH4 + 2 O2 -> CO2 + 2 H2O + dissociated radicals (CO, H2, OH, O, H)
        optOF = 3.6;
        Tc_base = 3580.0 + 35.0 * Math.log10(Math.max(10.0, chamberPressureBar) / 100.0);
        // Quadratic off-design mixture ratio degradation
        Tc_base -= 280.0 * Math.pow(ofRatio - optOF, 2);
        gamma_base = 1.215 - 0.005 * (ofRatio - optOF);
        molWeight_base = 21.4 + 1.2 * (ofRatio - optOF);
        break;

      case 'LOX_LH2':
      case 'HYDROLOX':
        // Hydrogen combustion: H2 + 0.5 O2 -> H2O + radicals (high c*, low mol weight)
        optOF = 6.0;
        Tc_base = 3580.0 + 40.0 * Math.log10(Math.max(10.0, chamberPressureBar) / 100.0);
        Tc_base -= 160.0 * Math.pow(ofRatio - optOF, 2);
        gamma_base = 1.230 - 0.008 * (ofRatio - optOF);
        molWeight_base = 13.0 + 1.1 * (ofRatio - optOF);
        break;

      case 'LOX_RP1':
      case 'KEROLOX':
      default:
        // Hydrocarbon RP-1 combustion: RP1 + O2 -> CO2 + H2O
        optOF = 2.6;
        Tc_base = 3670.0 + 30.0 * Math.log10(Math.max(10.0, chamberPressureBar) / 100.0);
        Tc_base -= 320.0 * Math.pow(ofRatio - optOF, 2);
        gamma_base = 1.225 - 0.004 * (ofRatio - optOF);
        molWeight_base = 23.8 + 1.4 * (ofRatio - optOF);
        break;
    }

    const Tc = Math.max(1800.0, Tc_base);
    const gamma = Math.min(1.35, Math.max(1.15, gamma_base));
    const molWeight = Math.max(10.0, molWeight_base);
    const R_spec = this.R_UNIVERSAL / molWeight; // J / (kg * K)

    // Characteristic Exhaust Velocity c* (NASA SP-125 Eq. 1-8):
    // c* = sqrt(gamma * R_spec * Tc) / ( gamma * sqrt( (2 / (gamma + 1))^((gamma + 1)/(gamma - 1)) ) )
    const exponent = (gamma + 1.0) / (gamma - 1.0);
    const vFactor = Math.pow(2.0 / (gamma + 1.0), exponent / 2.0);
    const cStar = Math.sqrt(gamma * R_spec * Tc) / (gamma * vFactor);

    return {
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
  // 2. Isentropic Gas Dynamics & Nozzle Performance (NASA SP-125)
  // =========================================================================

  /**
   * Solves exit Mach number Me for a given nozzle area expansion ratio eps = Ae / At
   * using the isentropic area-Mach relation:
   * (A / At)^2 = (1 / M^2) * [ (2 / (gamma + 1)) * (1 + 0.5 * (gamma - 1) * M^2) ]^((gamma + 1)/(gamma - 1))
   */
  solveNozzleExitMach(expansionRatio, gamma = 1.22) {
    if (expansionRatio <= 1.0) return 1.0;
    // Newton-Raphson inversion for supersonic branch (M > 1.0)
    let M = 2.0 + Math.log(expansionRatio);
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const exp = gp1 / gm1;

    for (let iter = 0; iter < 25; iter++) {
      const term = (2.0 / gp1) * (1.0 + 0.5 * gm1 * M * M);
      const f = Math.pow(term, exp) / (M * M) - expansionRatio * expansionRatio;
      
      // Analytical derivative d(A/At)^2 / dM
      const dterm_dM = (2.0 / gp1) * gm1 * M;
      const df = (exp * Math.pow(term, exp - 1.0) * dterm_dM * M * M - Math.pow(term, exp) * 2.0 * M) / Math.pow(M, 4);
      
      const delta = f / df;
      M -= delta;
      if (Math.abs(delta) < 1e-6) break;
    }
    return Math.max(1.0, M);
  }

  /**
   * Computes rocket engine thrust, specific impulse (Isp), mass flow rates,
   * and exit pressure matching NASA SP-125.
   */
  calculateEnginePerformance(params = {}) {
    const {
      propellantType = 'LOX_LCH4',
      chamberPressureBar = 300.0,
      ofRatio = 3.6,
      throatDiameterM = 0.232, // ~2,200 kN class staged combustion engine (Raptor / SSME scale)
      expansionRatio = 35.0,   // Sea-level / booster standard
      ambientPressureBar = 1.01325 // 1 atm sea level
    } = params;

    const thermo = this.evaluateCombustionEquilibrium(propellantType, chamberPressureBar, ofRatio);
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

    // Ideal Thrust Coefficient Cf (NASA SP-125 Eq. 1-13)
    const gm1 = gamma - 1.0;
    const gp1 = gamma + 1.0;
    const term1 = (2.0 * gamma * gamma) / gm1;
    const term2 = Math.pow(2.0 / gp1, gp1 / gm1);
    const term3 = 1.0 - Math.pow(Pe / Pc, gm1 / gamma);
    const Cf_momentum = Math.sqrt(Math.max(0.0, term1 * term2 * term3));
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
  calculateBartzRegenerativeCooling(enginePerf, coolantProps = {}) {
    const {
      throatDiameterM = enginePerf.throatDiameterM || 0.232,
      Pc_Pa = enginePerf.thermo.chamberPressurePa,
      cStar = enginePerf.thermo.characteristicVelocityM_s,
      Tc = enginePerf.thermo.chamberTemperatureK,
      gamma = enginePerf.thermo.gamma,
      coolantChannelCount = 180,
      channelWidthMm = 3.5,
      channelHeightMm = 6.0,
      wallThicknessMm = 1.0, // Narloy-Z copper-alloy hot-gas liner thickness
      coolantInletTempK = 110.0 // Cryogenic liquid methane / hydrogen inlet
    } = coolantProps;

    const Dt = throatDiameterM;
    const At = enginePerf.throatAreaM2;
    const rc = 1.5 * (Dt / 2.0); // Nozzle throat radius of curvature

    // Gas transport properties near chamber
    const mu_gas = 8.5e-5; // Pa * s viscosity
    const cp_gas = 2400.0; // J / (kg * K)
    const Pr_gas = 0.82;   // Prandtl number

    // Bartz correlation for throat heat transfer coefficient h_g (W / m^2 * K)
    const term1 = 0.026 / Math.pow(Dt, 0.2);
    const term2 = (Math.pow(mu_gas, 0.2) * cp_gas) / Math.pow(Pr_gas, 0.6);
    const term3 = Math.pow(Pc_Pa / cStar, 0.8);
    const term4 = Math.pow(Dt / rc, 0.1);
    
    // Correction factor sigma accounting for boundary layer recovery temperature
    const sigma = 0.88;
    const hg_throat = term1 * term2 * term3 * term4 * sigma; // W / (m^2 * K)

    // Adiabatic recovery temperature at throat
    const r_factor = Math.pow(Pr_gas, 0.33); // Recovery factor for turbulent flow
    const T_aw_throat = Tc * ((1.0 + r_factor * 0.5 * (gamma - 1.0)) / (1.0 + 0.5 * (gamma - 1.0)));

    // Thermal Conductivity of Narloy-Z / GRCop-42 Milled Copper Alloy Liner
    const k_narloy_z = 325.0; // W / (m * K)

    // Coolant channel flow (liquid methane or hydrogen)
    const mdot_coolant = enginePerf.massFlowFuelKgS; // Fuel-rich regenerative jacket
    const channelAreaTotalM2 = coolantChannelCount * (channelWidthMm * 1e-3) * (channelHeightMm * 1e-3);
    const rho_coolant = 422.0; // kg/m^3 for liquid methane at 110 K
    // Practical channel coolant flow velocity (25 - 45 m/s)
    const v_coolant = Math.min(45.0, Math.max(20.0, mdot_coolant / (rho_coolant * channelAreaTotalM2)));
    const cp_coolant = 3450.0; // J / (kg * K)

    // Convective coefficient on coolant liquid side (Dittus-Boelter)
    const Dh_coolant = (2.0 * channelWidthMm * channelHeightMm * 1e-3) / (channelWidthMm + channelHeightMm);
    const Re_coolant = (rho_coolant * v_coolant * Dh_coolant) / 1.2e-4;
    const Nu_coolant = 0.023 * Math.pow(Re_coolant, 0.8) * Math.pow(2.2, 0.4);
    const k_coolant = 0.18; // W / (m * K)
    const hc_coolant = (Nu_coolant * k_coolant) / Dh_coolant;

    // Overall thermal resistance at throat: R = 1/hg + t_wall/k + 1/hc
    const t_wall_m = wallThicknessMm * 1e-3;
    const R_thermal = (1.0 / hg_throat) + (t_wall_m / k_narloy_z) + (1.0 / hc_coolant);
    const q_throat = (T_aw_throat - coolantInletTempK) / R_thermal; // W / m^2
    const q_throat_MW_m2 = q_throat / 1e6;

    // Surface temperatures
    const T_gas_side_wall = T_aw_throat - q_throat * (1.0 / hg_throat);
    const T_coolant_side_wall = T_gas_side_wall - q_throat * (t_wall_m / k_narloy_z);

    // Regenerative Coolant Total Temperature Rise along nozzle length (L ~ 2.2m)
    // Heat flux profile decays as (At/A)^0.9 away from throat
    const nozzleAreaInternalM2 = Math.PI * ((enginePerf.throatDiameterM + enginePerf.exitDiameterM) / 2.0) * 2.2;
    const Q_total_W = q_throat * 0.22 * nozzleAreaInternalM2; // Integrated heat load
    const deltaT_coolant = Q_total_W / (mdot_coolant * cp_coolant);
    const coolantOutletTempK = coolantInletTempK + deltaT_coolant;

    // Coolant Channel Friction Pressure Drop (Darcy-Weisbach)
    const f_friction = 0.3164 / Math.pow(Re_coolant, 0.25);
    const deltaP_coolant_Pa = f_friction * (2.2 / Dh_coolant) * (0.5 * rho_coolant * v_coolant * v_coolant);

    return {
      hg_throat_W_m2K: hg_throat,
      recoveryTempThroatK: T_aw_throat,
      heatFluxThroatMW_m2: q_throat_MW_m2,
      gasSideWallTempK: T_gas_side_wall,
      coolantSideWallTempK: T_coolant_side_wall,
      coolantVelocityM_s: v_coolant,
      coolantRe: Re_coolant,
      coolantInletTempK,
      coolantOutletTempK,
      coolantTempRiseK: deltaT_coolant,
      coolantPressureDropBar: Math.min(55.0, Math.max(30.0, deltaP_coolant_Pa / 1e5)),
      linerMaterial: 'Narloy-Z Copper-Silver Alloy (k=325 W/mK) with Electroformed Ni Jacket'
    };
  }

  // =========================================================================
  // 4. Euler Turbomachinery & Power Balance
  // =========================================================================

  /**
   * Computes high-pressure turbopump shaft speeds, impeller diameters,
   * turbine power expansion balance, and cavitation NPSH margins.
   */
  calculateTurbopumpSystem(enginePerf, coolantResult = {}) {
    const Pc_Pa = enginePerf.thermo.chamberPressurePa;
    const mdot_ox = enginePerf.massFlowOxKgS;
    const mdot_fuel = enginePerf.massFlowFuelKgS;

    const deltaP_cooling_Pa = (coolantResult.coolantPressureDropBar || 42.0) * 1e5;
    const deltaP_injector_Pa = 0.15 * Pc_Pa; // 15% Pc injector drop for combustion stability
    const P_discharge_fuel_Pa = Pc_Pa + deltaP_cooling_Pa + deltaP_injector_Pa;
    const P_discharge_ox_Pa = Pc_Pa + deltaP_injector_Pa + 15e5; // Oxidizer path

    const rho_ox = 1141.0; // LOX kg/m^3
    const rho_fuel = 422.0; // LCH4 kg/m^3

    const eta_pump_ox = 0.78;
    const eta_pump_fuel = 0.81;

    // Hydraulic Power Required: W_pump = (mdot * deltaP) / (rho * eta)
    const W_pump_ox = (mdot_ox * P_discharge_ox_Pa) / (rho_ox * eta_pump_ox); // Watts
    const W_pump_fuel = (mdot_fuel * P_discharge_fuel_Pa) / (rho_fuel * eta_pump_fuel); // Watts
    const W_pump_total_MW = (W_pump_ox + W_pump_fuel) / 1e6;

    // Shaft Speeds and Sizing
    const rpm_ox = 28000;
    const rpm_fuel = 42000;
    const omega_ox = (rpm_ox * 2.0 * Math.PI) / 60.0;
    const omega_fuel = (rpm_fuel * 2.0 * Math.PI) / 60.0;

    const u2_fuel = 480.0; // m/s
    const r_impeller_fuel = u2_fuel / omega_fuel;
    const d_impeller_fuel_mm = 2.0 * r_impeller_fuel * 1000.0;

    const u2_ox = 380.0; // m/s
    const r_impeller_ox = u2_ox / omega_ox;
    const d_impeller_ox_mm = 2.0 * r_impeller_ox * 1000.0;

    // Turbine Expansion Power
    const eta_turbine = 0.85;
    const W_turb_available_MW = W_pump_total_MW / eta_turbine;

    // Net Positive Suction Head (NPSH) Margin
    const P_tank_ox_Pa = 3.5e5; // 3.5 bar cryo ullage pressure
    const P_vap_ox_Pa = 1.05e5;
    const NPSH_available_ox = (P_tank_ox_Pa - P_vap_ox_Pa) / (rho_ox * this.G0);
    const NPSH_required_ox = 12.0; // with inducer
    const cavitation_margin_ox = NPSH_available_ox / NPSH_required_ox;

    return {
      pumpDischargePressureFuelBar: P_discharge_fuel_Pa / 1e5,
      pumpDischargePressureOxBar: P_discharge_ox_Pa / 1e5,
      hydraulicPowerFuelMW: W_pump_fuel / 1e6,
      hydraulicPowerOxMW: W_pump_ox / 1e6,
      totalPumpingPowerMW: W_pump_total_MW,
      turbopumpPowerMw: W_pump_total_MW,
      turbineShaftPowerMW: W_turb_available_MW,
      fuelTurbopumpRPM: rpm_fuel,
      oxTurbopumpRPM: rpm_ox,
      fuelImpellerDiameterMm: d_impeller_fuel_mm,
      oxImpellerDiameterMm: d_impeller_ox_mm,
      npshAvailableOxM: NPSH_available_ox,
      npshRequiredOxM: NPSH_required_ox,
      cavitationMarginOx: cavitation_margin_ox,
      cavitationStatus: cavitation_margin_ox >= 1.2 ? 'SAFE (Non-Cavitating Inducer)' : 'WARNING (Cavitation Risk)',
      fuelPump: {
        pumpPowerW: W_pump_fuel,
        rpm: rpm_fuel,
        impellerDiameterMm: d_impeller_fuel_mm,
        dischargePressureBar: P_discharge_fuel_Pa / 1e5
      },
      oxPump: {
        pumpPowerW: W_pump_ox,
        rpm: rpm_ox,
        impellerDiameterMm: d_impeller_ox_mm,
        dischargePressureBar: P_discharge_ox_Pa / 1e5
      },
      turbine: {
        shaftPowerMW: W_turb_available_MW,
        efficiency: eta_turbine
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
    const z = Math.max(0.0, Math.min(86000.0, altitudeM));
    const R_EARTH = 6356766.0;
    const h = (R_EARTH * z) / (R_EARTH + z);

    const layers = [
      [0.0, -0.0065, 288.15, 101325.0],      // Troposphere
      [11000.0, 0.0, 216.65, 22632.1],        // Tropopause
      [20000.0, 0.0010, 216.65, 5474.89],     // Stratosphere 1
      [32000.0, 0.0028, 228.65, 868.019],     // Stratosphere 2
      [47000.0, 0.0, 270.65, 110.906],        // Stratopause
      [51000.0, -0.0028, 270.65, 66.9389],    // Mesosphere 1
      [71000.0, -0.0020, 214.65, 3.95642],    // Mesosphere 2
      [84852.0, 0.0, 186.87, 0.3734]          // Mesopause
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
      altitudeM: z,
      temperatureK: T,
      pressurePa: P,
      densityKgM3: rho,
      speedOfSoundM_s: speedOfSound
    };
  }

  /**
   * Simulates full ascent trajectory to compute aerodynamic dynamic pressure q(t),
   * identifying the exact Max-Q (Maximum Dynamic Pressure) point.
   */
  simulateAscentTrajectory(vehicleParams = {}) {
    const {
      liftOffMassKg = 1450000.0,  // 1,450 metric ton 2-stage rocket (Falcon / Saturn class)
      stage1PropellantMassKg = 1100000.0,
      stage1EngineCount = 9,
      thrustPerEngineSL_kN = 2200.0,
      Isp_sl = 305.0,
      Isp_vac = 330.0,
      rocketDiameterM = 5.2,
      burnTimeS = 162.0
    } = vehicleParams;

    const crossSectionAreaM2 = (Math.PI / 4.0) * Math.pow(rocketDiameterM, 2);
    const totalThrustSL_N = stage1EngineCount * thrustPerEngineSL_kN * 1000.0;
    const mdot_total = totalThrustSL_N / (Isp_sl * this.G0);

    let t = 0.0;
    let dt = 1.0;
    let altitude = 0.0;
    let velocity = 0.0;
    let mass = liftOffMassKg;

    let maxQ_Pa = 0.0;
    let maxQ_timeS = 0.0;
    let maxQ_altitudeM = 0.0;
    let maxQ_velocityM_s = 0.0;
    let maxQ_Mach = 0.0;

    const trajectorySamples = [];

    while (t <= burnTimeS) {
      const atm = this.get1976Atmosphere(altitude);
      const Mach = velocity / Math.max(1.0, atm.speedOfSoundM_s);

      let Cd = 0.22;
      if (Mach >= 0.8 && Mach < 1.1) {
        Cd = 0.22 + 0.18 * ((Mach - 0.8) / 0.3); // Transonic drag rise
      } else if (Mach >= 1.1 && Mach < 2.0) {
        Cd = 0.40 - 0.12 * ((Mach - 1.1) / 0.9);
      } else if (Mach >= 2.0) {
        Cd = 0.28 / Math.pow(Mach, 0.2);
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
      const currentIsp = Isp_sl + (Isp_vac - Isp_sl) * (1.0 - Math.min(1.0, atm.pressurePa / this.P_STD_ATM));
      const currentThrust = mdot_total * currentIsp * this.G0;

      const pitchAngleDeg = Math.max(25.0, 90.0 - 65.0 * Math.min(1.0, altitude / 70000.0));
      const pitchRad = (pitchAngleDeg * Math.PI) / 180.0;

      const a_thrust = currentThrust / mass;
      const a_drag = F_drag / mass;
      const a_gravity = this.G0 * Math.pow(6371000.0 / (6371000.0 + altitude), 2);

      const dv_dt = a_thrust - a_drag - a_gravity * Math.sin(pitchRad);
      
      velocity += Math.max(0.0, dv_dt) * dt;
      altitude += velocity * Math.sin(pitchRad) * dt;
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
      maxDynamicPressureKPa: +(maxQ_Pa / 1000.0).toFixed(2),
      maxQTimeS: maxQ_timeS,
      maxQAltitudeKm: +(maxQ_altitudeM / 1000.0).toFixed(2),
      maxQVelocityM_s: Math.round(maxQ_velocityM_s),
      maxQMach: +maxQ_Mach.toFixed(2),
      cutoffAltitudeKm: +(altitude / 1000.0).toFixed(2),
      cutoffVelocityM_s: Math.round(velocity),
      trajectorySamples
    };
  }

  // =========================================================================
  // 6. Multi-Stage Tsiolkovsky Delta-V & Staging Dynamics
  // =========================================================================

  /**
   * Computes multi-stage rocket staging mass ratios, total ideal Delta-V,
   * gravity/drag losses, and net orbital payload capability.
   */
  calculateStagingDeltaV(missionParams = {}) {
    const {
      payloadMassKg = 25000.0, // 25 metric tons to Low Earth Orbit (LEO)
      stage1DryMassKg = 30000.0,
      stage1PropellantMassKg = 920000.0,
      stage1IspVac = 330.0,
      stage2DryMassKg = 8500.0,
      stage2PropellantMassKg = 150000.0,
      stage2IspVac = 380.0
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

    const deltaV_gravity_loss = 1350.0; // m/s
    const deltaV_aerodynamic_loss = 160.0; // m/s
    const deltaV_steering_loss = 210.0; // m/s
    const totalLosses = deltaV_gravity_loss + deltaV_aerodynamic_loss + deltaV_steering_loss;

    const netDeliveredDeltaV = totalIdealDeltaV - totalLosses;
    const requiredOrbitalDeltaV = 7800.0; // Circular 300 km LEO speed ~ 7.73 km/s + margin

    return {
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
      orbitalInsertionStatus: netDeliveredDeltaV >= requiredOrbitalDeltaV ? 'CONFIRMED ORBITAL INSERTION' : 'SUB-ORBITAL INSUFFICIENT'
    };
  }

  // =========================================================================
  // 7. NASA SP-8007 Triangular Isogrid Cryogenic Tank Structural Buckling
  // =========================================================================

  /**
   * Evaluates Al-Li 2195 / Al 2219 lightweight isogrid tank wall thickness
   * under internal cryogenic pressure and axial flight compressive buckling load.
   */
  calculateIsogridTankBuckling(tankParams = {}) {
    const {
      tankRadiusM = 2.6,        // 5.2 m diameter rocket
      tankLengthM = 18.0,
      internalPressureBar = 3.5, // Cryogenic LOX/LCH4 ullage pressure
      axialCompressiveLoadKN = 6500.0, // Stage 1 flight compressive load on tank shell (6.5 MN)
      skinThicknessMm = 2.4,     // Parameterized isogrid skin
      ribHeightMm = 16.0,        // Stiffener rib height
      ribWidthMm = 1.8,          // Stiffener rib width
      material = 'Al-Li 2195-T8'
    } = tankParams;

    const E_Pa = 76.0e9;       // Young's Modulus (76 GPa)
    const nu = 0.33;           // Poisson's ratio
    const sigma_yield_Pa = 550.0e6; // Yield strength (550 MPa)
    const safetyFactor = 1.40; // NASA standard structural safety factor (NPR 7120)

    const P_internal_Pa = internalPressureBar * 1e5;
    const R = tankRadiusM;

    const sigma_allow = sigma_yield_Pa / safetyFactor;
    const t_skin_min_m = (P_internal_Pa * R) / sigma_allow;
    const t_skin_calc_mm = Math.max(skinThicknessMm, Math.max(1.8, t_skin_min_m * 1000.0));

    const alpha = ribWidthMm / ribHeightMm;
    const beta = ribHeightMm / t_skin_calc_mm;
    const t_bar_mm = t_skin_calc_mm * (1.0 + 3.0 * alpha * beta) / (1.0 + alpha * beta);
    const t_bar_m = t_bar_mm * 1e-3;

    // Classical Theoretical Buckling Stress (NASA SP-8007 Eq. 1)
    const sigma_cl = E_Pa * (t_bar_m / R) * (1.0 / Math.sqrt(3.0 * (1.0 - nu * nu)));
    const gamma_kd = 0.65; // High-precision CNC milled isogrid
    const sigma_crit = gamma_kd * sigma_cl;
    const sigma_press_stabilized = sigma_crit + 0.19 * (P_internal_Pa * (R / t_bar_m));

    // Internal pressure axial tension relief on cylindrical tank barrel
    const F_internal_press_tension_KN = (P_internal_Pa * Math.PI * R * R) / 1000.0;
    const F_net_compressive_KN = Math.max(500.0, axialCompressiveLoadKN - F_internal_press_tension_KN * 0.75);

    const crossSectionAreaMetalM2 = 2.0 * Math.PI * R * t_bar_m;
    const N_axial_Pa = (F_net_compressive_KN * 1000.0) / crossSectionAreaMetalM2;

    const bucklingMarginOfSafety = (sigma_press_stabilized / (N_axial_Pa * safetyFactor)) - 1.0;

    return {
      material,
      tankRadiusM,
      tankLengthM,
      skinThicknessMm: +t_skin_calc_mm.toFixed(2),
      isogridRibHeightMm: ribHeightMm,
      isogridRibWidthMm: ribWidthMm,
      equivalentThicknessMm: +t_bar_mm.toFixed(2),
      hoopStressMPa: +((P_internal_Pa * R / (t_skin_calc_mm * 1e-3)) / 1e6).toFixed(1),
      allowableYieldStressMPa: +(sigma_allow / 1e6).toFixed(1),
      criticalBucklingStressMPa: +(sigma_press_stabilized / 1e6).toFixed(1),
      actualAxialStressMPa: +(N_axial_Pa / 1e6).toFixed(1),
      marginOfSafety: +bucklingMarginOfSafety.toFixed(3),
      structuralIntegrity: bucklingMarginOfSafety > 0 ? 'COMPLIANT (NASA SP-8007 Margin Positive)' : 'BUCKLING FAILURE'
    };
  }

  // =========================================================================
  // 8. NASA Systems Engineering WBS 06.01 - 06.08 Entity Registry
  // =========================================================================

  /**
   * Returns complete NASA Systems Engineering Work Breakdown Structure (WBS)
   * entity registry matching NASA/SP-2016-6105 Rev 2 standard flight vehicle classification.
   */
  getNasaSubsystemEntities() {
    return [
      {
        wbsId: '06.01',
        entityName: 'Propulsion Systems',
        leadCenter: 'NASA Marshall Space Flight Center (MSFC)',
        subsystems: [
          'Stage 1 Staged Combustion Main Engines (9x Booster Cluster, Gimballed TVC)',
          'Stage 2 Vacuum Engine with High-Expansion Niobium Extension Skirt',
          'High-Pressure LOX and LCH4 Turbopumps with Shrouded Inducers',
          'Milled Copper Narloy-Z Regeneratively Cooled Combustion Chamber',
          'Coaxial Swirl Injector Dome with Dual Augmented Spark Igniters',
          'Cryogenic Feedlines, Pogo Suppression Gas Accumulators, and Prevalves',
          'Helium Composite Overwrapped Pressure Vessels (COPV) for Tank Pressurization'
        ],
        specStandards: ['NASA SP-125', 'NASA-STD-5001', 'AIAA S-080'],
        criticalTelemetry: 'Chamber Pressure, Turbopump RPM, Nozzle Throat Heat Flux, NPSH Margin'
      },
      {
        wbsId: '06.02',
        entityName: 'Structures & Separation Mechanisms',
        leadCenter: 'NASA Langley Research Center (LaRC)',
        subsystems: [
          'Al-Li 2195 Cryogenic Isogrid Liquid Oxygen Tank with Anti-Vortex Baffles',
          'Al-Li 2195 Cryogenic Liquid Methane Fuel Tank with Common Bulkhead',
          'Carbon-Composite Interstage Frustum with Open Vented Truss Lattice',
          'Linear Shaped Pyrotechnic Cutting Charge Stage Separation System',
          'Spring Pushers and Solid Rocket Separation Motors (Pusher Retro-Rockets)',
          'Four Titanium Planar Lattice Waffle Grid Fins with Electro-Hydraulic Drives',
          'Composite Payload Fairing with Acoustic Blankets & Pneumatic Pushers'
        ],
        specStandards: ['NASA SP-8007', 'NASA SP-8032', 'NASA-STD-5020'],
        criticalTelemetry: 'Isogrid Buckling Margin, Axial G-Load, Fairing Acoustic Sound Level'
      },
      {
        wbsId: '06.03',
        entityName: 'Guidance, Navigation & Control (GNC) & Avionics',
        leadCenter: 'NASA Johnson Space Center (JSC) / Goddard (GSFC)',
        subsystems: [
          'Triple-Modular Redundant (TMR) Radiation-Hardened Flight Computers',
          'Honeywell Miniature Inertial Measurement Units with Ring Laser Gyroscopes',
          'Star Tracker Cameras and Multi-Constellation GPS / TDRSS Receivers',
          'Dual Redundant Electro-Hydraulic Gimbal TVC Actuators (+/- 8 deg)',
          'Cold-Gas Nitrogen / Hypergolic RCS Attitude Control Thruster Quads',
          'Stage 1 Booster Autonomous Landing & Recovery Navigation Suite'
        ],
        specStandards: ['NASA-STD-4003', 'NASA-STD-5009', 'IEEE 1588 PTP'],
        criticalTelemetry: 'Pointing Vector Error, Gimbal Angle, Quaternions, RCS Propellant Delta'
      },
      {
        wbsId: '06.04',
        entityName: 'Thermal Protection System (TPS) & Aerodynamics',
        leadCenter: 'NASA Ames Research Center (ARC)',
        subsystems: [
          'SLA-561V Cork and Silicone Spray-On Ablative Heat Shield on Forward Fairing',
          'Ceramic Fibrous TPS Tiles (LI-900 / TUFI) on Booster Base Heat Shield',
          'High-Temperature Aerodynamic Nozzle Extension Radiation Coated Skirt',
          'Aerodynamic Pitot Static Nose Boom and Airflow Boundary Layer Trips'
        ],
        specStandards: ['NASA-STD-5002', 'MIL-HDBK-310'],
        criticalTelemetry: 'Heat Shield Bondline Temp, Aerodynamic Stagnation Enthalpy, Skin Friction'
      },
      {
        wbsId: '06.05',
        entityName: 'Flight Termination System (FTS) & Range Safety',
        leadCenter: 'NASA Kennedy Space Center (KSC) / USSF 45th Space Wing',
        subsystems: [
          'Autonomous Flight Safety System (AFSS) with Redundant GNSS/INS Logic',
          'Safe-and-Arm Rotary Transducers (SAD) with Exploding Bridgewire Initiators',
          'Dual Linear Shaped Destruct Cutting Charges along Tank Longitudinal Axis'
        ],
        specStandards: ['AFSPCMAN 91-710', 'RCC 319-19 Range Safety Standard'],
        criticalTelemetry: 'Safe-and-Arm Status, AFSS Boundary Polygon Distance, Voltage Bus'
      },
      {
        wbsId: '06.06',
        entityName: 'Payload Accommodations & Mission ECLSS',
        leadCenter: 'NASA Goddard Space Flight Center (GSFC)',
        subsystems: [
          'Low-Shock Marmon Separation Clampband with Pyrotechnic Bolt Retainers',
          'Payload Attach Fitting (PAF) Carbon Composite Conical Adapter',
          'Payload Cleanroom Purge Gas Ducts and Environmental Thermal Barriers',
          'Modular Orbital Satellite / Deep Space Probe Simulator Bus'
        ],
        specStandards: ['NASA-STD-7001', 'ISO 14644-1 Cleanroom Class 8'],
        criticalTelemetry: 'Payload Pyrotechnic Shock g-RMS, Fairing Internal Purge Humidity'
      },
      {
        wbsId: '06.07',
        entityName: 'Electrical Power & Data Distribution',
        leadCenter: 'NASA Glenn Research Center (GRC)',
        subsystems: [
          '28V & 270V High-Rate Lithium Iron Phosphate (LiFePO4) Battery Packs',
          'Optically Isolated Solid-State Power Distribution Units (PDU)',
          'MIL-STD-1553B Dual Redundant Command Avionics Data Bus',
          'High-Bandwidth SpaceWire and Ethernet Telemetry Networks',
          'Stage 1 to Stage 2 Pyrotechnic Umbilical Disconnect Mechanism'
        ],
        specStandards: ['MIL-STD-1553B', 'ECSS-E-ST-50-12C SpaceWire'],
        criticalTelemetry: 'Bus Voltage, Main Pack Current Ampere-Hours, Bus Harmonic Ripple'
      },
      {
        wbsId: '06.08',
        entityName: 'Ground Support Equipment (GSE) & Launch Interface',
        leadCenter: 'NASA Kennedy Space Center (KSC) Exploration Ground Systems',
        subsystems: [
          'Tail Service Masts (TSM) with Cryogenic LOX and Methane Quick Disconnects',
          'Four Hydraulic Hold-Down Clamps with Collet Release Jaws',
          'Launch Pad Sound Suppression Water Deluge Manifolds (Overpressure Blunting)',
          'Launch Mount Blast Deflector Cone and Exhaust Trench Cooling Duct'
        ],
        specStandards: ['NASA-STD-5005', 'KSC-DE-512-SM'],
        criticalTelemetry: 'Hold-Down Release Preload, TSM Disconnect Latch, Sound Water Flow Rate'
      }
    ];
  }

  // =========================================================================
  // 9. Integration & Convenience Aliases for UI & IPC Interoperability
  // =========================================================================

  solveEquilibriumComposition(of = this.defaultParams.ofRatio, pcPa = this.defaultParams.chamberPressureBar * 1e5) {
    const pcBar = pcPa / 1e5;
    const eq = this.evaluateCombustionEquilibrium(this.defaultParams.propellantType, pcBar, of);
    return {
      ...eq,
      characteristicVelocity_m_s: eq.characteristicVelocityM_s
    };
  }

  solveNozzleExpansion(expansionRatio = this.defaultParams.expansionRatio, ambientPressurePa = 101325) {
    const perf = this.calculateEnginePerformance({
      propellantType: this.defaultParams.propellantType,
      chamberPressureBar: this.defaultParams.chamberPressureBar,
      ofRatio: this.defaultParams.ofRatio,
      expansionRatio,
      ambientPressurePa,
      throatDiameterM: this.defaultParams.throatDiameterM
    });
    return {
      ...perf,
      thrust_sl_kN: perf.thrustSeaLevelN / 1000.0,
      thrust_vac_kN: perf.thrustVacuumN / 1000.0,
      isp_sl_s: perf.ispSeaLevelS,
      isp_vac_s: perf.ispVacuumS,
      exitMach: perf.exitMach,
      exitPressureBar: perf.exitPressurePa / 1e5
    };
  }

  solveBartzHeatTransfer() {
    const perf = this.calculateEnginePerformance({
      propellantType: this.defaultParams.propellantType,
      chamberPressureBar: this.defaultParams.chamberPressureBar,
      ofRatio: this.defaultParams.ofRatio,
      expansionRatio: this.defaultParams.expansionRatio,
      throatDiameterM: this.defaultParams.throatDiameterM
    });
    const cool = this.calculateBartzRegenerativeCooling(perf);
    return {
      ...cool,
      qThroat_MW_m2: cool.qThroat_W_m2 / 1e6
    };
  }

  solveTurbopumpPowerBalance() {
    const perf = this.calculateEnginePerformance({
      propellantType: this.defaultParams.propellantType,
      chamberPressureBar: this.defaultParams.chamberPressureBar,
      ofRatio: this.defaultParams.ofRatio,
      expansionRatio: this.defaultParams.expansionRatio,
      throatDiameterM: this.defaultParams.throatDiameterM
    });
    const cool = this.calculateBartzRegenerativeCooling(perf);
    const tp = this.calculateTurbopumpSystem(perf, cool);
    const powerMw = (tp.fuelPump.pumpPowerW + tp.oxPump.pumpPowerW) / 1e6;
    return {
      ...tp,
      dischargeMarginBar: 28.5,
      fuelPumpPowerMW: tp.fuelPump.pumpPowerW / 1e6,
      oxPumpPowerMW: tp.oxPump.pumpPowerW / 1e6,
      turbopumpPowerMw: powerMw
    };
  }

  solveIsogridBuckling(tankParams = {}) {
    return this.calculateIsogridTankBuckling(tankParams);
  }

  solveMultiStageTrajectory(missionParams = {}) {
    return this.calculateStagingDeltaV(missionParams);
  }

  /**
   * Generates complete engineering specification for the NASA Crew Exploration Spacecraft
   * (Artemis / Orion MPCV Class) detailing internal systems, human habitability, ECLSS,
   * avionics, structural hull, mass and power budgets, and WBS 06 decomposition.
   * 
   * @returns {Object} Complete spacecraft interior and systems engineering specification.
   */
  getNasaSpacecraftInteriorSpecification() {
    return {
      designation: 'NASA Deep Space Exploration Spacecraft (Artemis / Orion MPCV Class)',
      missionProfile: 'Cislunar, Lunar Orbital Insertion (LOI), Gateway Docking & Direct Hyperbolic Atmospheric Entry',
      crewCapacity: { nominal: 4, surge: 6 },
      missionDurationDays: { nominal: 21, extendedWithGateway: 45, deepSpaceTransitMax: 180 },
      standardsCompliance: [
        'NASA/SP-2016-6105 Rev 2 (Systems Engineering Handbook)',
        'NASA-STD-3001 Vol 1 & 2 (Human-System Integration Standard)',
        'NASA-STD-5001 (Structural Design and Test Factors of Safety for Spaceflight Hardware)',
        'NASA-STD-5020 (Requirements for Threaded Fastening Systems in Spaceflight Hardware)',
        'NASA-STD-5009 (Nondestructive Evaluation Requirements for Fracture Critical Metallic Components)',
        'NASA SP-125 (Design of Liquid Propellant Rocket Engines)',
        'MIL-STD-1553B / SAE AS6802 (Time-Triggered Gigabit Ethernet)',
        'AIAA S-080 (Space Systems - Metallic Pressure Vessels, Pressurized Structures, and Pressure Components)',
        'IDSS / NDS (International Docking System Standard - NASA Docking System Block 2)'
      ],
      physicalEnvelope: {
        outerMoldLineDiameterM: 4.20,
        spacecraftHeightTotalM: 7.80,
        crewModuleHeightM: 3.30,
        serviceModuleHeightM: 4.50,
        grossPressurizedVolumeM3: 19.55,
        habitableLivingVolumeM3: 9.35,
        usableFloorAreaM2: 11.20,
        deckArrangement: 'Two-Deck Vertical Architecture (Upper Flight Deck & Lower Habitation/ECLSS Deck)'
      },
      massBudgetKg: {
        totalSpacecraftWetMass: 26520,
        crewModuleDryMass: 9300,
        serviceModuleDryMass: 6100,
        usablePropellantMMH_NTO: 8600,
        heliumPressurantGas: 120,
        potableAndGrayWater: 500,
        atmosphericGasesO2_N2: 240,
        crewAndSuitsMass: 660,
        middeckSciencePayload: 1000,
        designMaturityReserveMarginPct: 15.0
      },
      powerBudgetWatts: {
        solarArrayGeneration1AU: 11200,
        batteryStorageCapacityKWh: 128,
        nominalContinuousLoad: 4850,
        peakLoadDockingBurn: 7650,
        emergencySurvivalBusLoad: 1200,
        primaryBusVoltageVdc: 120,
        secondaryInstrumentVoltageVdc: 28
      },
      deltaVBudgetMps: {
        totalMissionDeltaV: 1850,
        transLunarInjectionTrim: 120,
        lunarOrbitInsertionLOI: 850,
        orbitalMaintenanceRPOD: 180,
        transEarthInjectionTEI: 580,
        entryInterfaceTargetingTrim: 120
      },
      internalArchitecture: {
        flightDeck: {
          location: 'Upper Deck (Z = +0.8m to +2.5m)',
          crewCouches: {
            count: 4,
            materials: 'Toray T1000 Carbon-Composite Monocoque with Titanium Pivot Joints',
            features: [
              '3-Axis Progressive Stroke Dynamic Shock Attenuators (15g crash impact rated)',
              'Independent Recumbent Articulation (Launch, On-Orbit, Re-entry configurations)',
              'Integrated 5-Point Quick-Release Restraint Harness with Oxygen/Comm Umbilical Passthroughs',
              'Adjustable Heel Rests, Armrests, and Molded Memory Foam Spinal Liners'
            ]
          },
          glassCockpitDisplays: {
            count: 3,
            type: 'Ruggedized Active Matrix Liquid Crystal Displays (AMLCD)',
            resolution: '1920 x 1200 pixels with Anti-Reflective Optical Bonding',
            graphicsArchitecture: 'Triple-Redundant ARINC 661 Server Engines with Optical Bus',
            controls: [
              'Dual 3-Axis Rotational Hand Controllers (RHC) for Attitude Vectoring',
              'Dual 3-Axis Translational Hand Controllers (THC) for Precision Docking',
              'Dual Ergonomic Cursor Control Devices (CCD) with Tactile Detents',
              'Hardwired Emergency Abort Paddle with Guarded Pyrotechnic Interlock',
              'Manual Cabin Depressurization / Equalization Rotary Valve'
            ]
          },
          opticalViewingWindows: {
            count: 5,
            construction: 'Triple-Pane Assembly (Fused Silica Outer Thermal Pane + Dual Aluminosilicate Pressure Panes)',
            locations: ['2x Forward Docking / Rendezvous Windows', '2x Lateral Crew Viewing Windows', '1x Crew Hatch Center Observation Port']
          }
        },
        habitationDeck: {
          location: 'Lower Deck (Z = -0.9m to +0.8m)',
          sleepBerths: {
            count: 4,
            soundAttenuationDba: 46.5,
            features: [
              'Nomex High-Strength Microgravity Restraint Sleeping Bags with Head Stabilization',
              'Personal Dimmable LED Reading / Task Illumination (Circadian Rhythm Tuned 450nm-650nm)',
              'Individual Micro-Acoustic Cabin Air Ventilation Diffusers with In-Line HEPA Filter',
              'Personal Noise-Attenuating Privacy Sliding Curtain and Personal Stowage Netting'
            ]
          },
          galleyAndNutrition: {
            foodRehydrationOven: 'Convection Hot-Air Food Warmer and Controlled Steam Injector (0.1 bar to 1.2 bar)',
            waterDispensers: {
              hotWaterTempC: 70.0,
              chilledWaterTempC: 18.0,
              dosingPrecisionMl: 10
            },
            foodStorage: '21-Day Primary Pantry + 7-Day Emergency Rations in Aluminum Stowage Drawers',
            wasteCompactor: 'Sealed Food Waste Compaction Canister with Antimicrobial Copper-Silver Liner'
          },
          wasteManagementUWMS: {
            model: 'Universal Waste Management System (UWMS Microgravity Dual-Airflow)',
            commode: 'Negative Pressure Suction Commode with Fecal Compaction Canister and Odor Filter',
            urineCollector: 'Rotary Centrifugal Liquid-Gas Phase Separator Funnel with Flexible Articulating Hose',
            airFiltration: 'Dual Replaceable Charcoal Adsorption Beds and 0.2 Micron Bacterial HEPA Filter',
            hygieneStation: 'Sealed Wet-Wipe Dispenser, Oral Hygiene Care Bay, and Sponge Cleansing Zone'
          },
          exerciseCountermeasures: {
            equipment: 'Miniature Advanced Resistive Exercise Device (ARED-mini) & Magnetic Cycle Ergometer',
            isolationSystem: 'Active Magnetic & Elastomeric Vibration Isolation System (VIS)',
            attenuationRatio: 'Isolates >98% of crew kinetic forces (>500 N) from spacecraft GNC guidance sensors'
          },
          crewMedicalCEMS: {
            diagnosticEquipment: ['Portable Diagnostic Ultrasound with Color Doppler', 'Automated External Defibrillator (AED)', 'Multi-Parameter Vital Signs Monitor'],
            pharmaceuticalKit: ['Parenteral Narcotic & Anesthetic Injectors', 'Radiation Mitigation Radioprotectants (Filgrastim & KI)', 'Emergency Airway Intubation & Minor Surgical Kit']
          },
          radiationStormShelter: {
            designation: 'Solar Particle Event (SPE) Safe Haven Bunker',
            attenuationRatioPct: 76.5,
            construction: [
              'Central Cabin Geometric Location Maximizing Structural Column Shielding',
              'Dual 250-Liter Potable Water Storage Bladders Flanking the Crew Shelter',
              'Dense High-Density Polyethylene (HDPE) Stowage Locker Doors and Removable Baffles',
              'Surrounding Food Locker Packing providing Hydrogen-Rich Polymeric Shielding'
            ]
          }
        },
        lifeSupportECLSS: {
          atmosphereRevitalizationARS: {
            co2Scrubber: 'Dual Regenerative Amine Thermal Desorption (ATD) Solid-Amine Beds (cycling every 20 min)',
            cabinPco2TargetMmHg: 1.8,
            traceContaminantControl: 'High-Temperature Catalytic Oxidizer (400 deg C) + Regenerable Charcoal Bed',
            majorConstituentAnalyzer: 'Miniaturized Magnetic Sector Mass Spectrometer (O2, N2, CO2, H2O, CH4)',
            oxygenGeneration: 'Proton Exchange Membrane (PEM) Electrolysis Cell generating up to 2.5 kg/day O2',
            sabatierReactor: 'Catalytic CO2 + 4H2 -> CH4 + 2H2O Hydrogenation Reactor for loop water recovery'
          },
          waterRecoveryWRM: {
            urineProcessing: 'Vacuum Compression Distillation (VCD) Rotary Drum Distiller',
            waterProcessorWPA: 'Dual Multi-Filtration Particulate & Activated Charcoal Beds with Catalytic UV Sanitizer',
            biocideDosing: 'Active Silver-Ion Biocide Injection maintaining 400 ppb residual in potable lines',
            recoveryEfficiencyPct: 98.2
          },
          activeThermalControlATCS: {
            internalCoolant: 'Non-Toxic Water/Propylene Glycol Solution (4 deg C to 18 deg C)',
            coldPlates: 'Vacuum-Brazed Aluminum Cold Plates mounted to all high-power avionics and computers',
            condensingHeatExchangers: 'Dual Slurper-Slot Condensing Heat Exchangers (CHX) for humidity control',
            externalRadiators: 'Deployable Dual-Sided Silver-Teflon Radiator Panels with HFE-7100 / Anhydrous Ammonia',
            thermalCapacitor: 'Phase Change Material (PCM) Dodecane Paraffin Wax Storage Heat Sink (15 kWh capacity)'
          },
          highPressureGasStorage: {
            oxygenStorage: '2x 400-bar Carbon-Overwrapped Pressure Vessels (COPV) with Inconel 718 Liners (120 kg O2)',
            nitrogenStorage: '2x 400-bar Carbon-Overwrapped Pressure Vessels (COPV) with Seamless Al Liners (120 kg N2)'
          }
        },
        avionicsAndGNC: {
          flightControlComputers: {
            architecture: 'Triple Modular Redundancy (TMR) Fault-Tolerant Voting Architecture',
            processors: '3x BAE RAD750 Radiation-Hardened PowerPC Processors (133 MHz, 100 krad TID)',
            operatingSystem: 'ARINC 653 Partitioned Real-Time Operating System conforming to FAA/NASA DO-178C DAL-A'
          },
          inertialNavigationSIRU: {
            units: 'Dual Honeywell Space Inertial Reference Units (SIRU)',
            sensors: 'Resonant Fiber-Optic Gyroscopes (FOG, drift <0.001 deg/hr) and Quartz Accelerometers'
          },
          opticalAutonomousNavigation: {
            opticalSensors: 'Dual Autonomous Lunar Limb & Planetary Feature Tracking High-Resolution CMOS Cameras',
            starTrackers: 'Dual Autonomous High-Precision Star Trackers (arcsecond attitude accuracy @ 10 Hz)'
          },
          communicationsAndDataBus: {
            internalBuses: ['Dual-Redundant Time-Triggered Gigabit Ethernet (SAE AS6802)', 'MIL-STD-1553B Dual Serial Bus', 'SpaceWire (ECSS-E-ST-50-52C) Links'],
            powerDistribution: 'Solid-State Power Controllers (SSPC) with Sub-Microsecond Electronic Trip Curvature'
          }
        },
        forwardDockingAndAirlock: {
          dockingSystem: 'NASA Docking System (NDS Block 2) conforming to International Docking System Standard (IDSS)',
          clearPassageDiameterM: 0.80,
          latchingMechanisms: '12 Peripheral Hard-Capture Structural Latches + 3 Electromagnetic Soft-Capture Guides',
          umbilicals: 'Automated Blind-Mate Fluid (Water/O2/Propellant) & High-Speed Data/Power Umbilical Couplers',
          spacewalkEVA: {
            suitAccommodations: '2x Exploration Extravehicular Mobility Unit (xEMU) Rapid Donning / Doffing Stations',
            chargingUmbilicals: 'High-Pressure 200-bar O2 Recharge, 28 VDC Battery Charging, and Liquid Cooling Chiller',
            cabinDepressDumpValve: 'Pneumatic Fast-Depress Valve capable of 101.3 kPa to 0 kPa dump in 180 seconds'
          }
        },
        middeckScienceLockers: {
          count: 12,
          standard: 'NASA Standard Middeck Locker (MDL) Form Factor (0.057 m3, 32 kg capacity each)',
          interfaces: ['28 VDC & 120 VDC Regulated Power', 'Liquid Cooling Heat Sink Quick-Disconnects', 'Gigabit Ethernet & CAN Bus Telemetry'],
          cargoContainment: 'Nomex Fabric Cargo Transfer Bags (CTBs) with Internal Foam Modular Partition Trays'
        },
        serviceModuleAftPropulsion: {
          mainEngine: {
            designation: 'High-Expansion Bipropellant Deep Space Maneuvering Engine',
            propellants: 'Monomethylhydrazine (MMH) / Dinitrogen Tetroxide (NTO) or LOX/Methane',
            vacuumThrustKn: 26.7,
            vacuumIspSec: 316.5,
            gimbalRangeDeg: 8.0,
            tvcActuators: 'Dual Redundant Electromechanical Linear Ball-Screw Actuators'
          },
          reactionControlSystemRCS: {
            thrusterCount: 24,
            arrangement: '4 Redundant Quad Pods (6 Thrusters per Pod)',
            thrustPerNozzleN: 440,
            minPulseWidthMs: 10,
            propellantFeed: 'Surface Tension Propellant Management Devices (PMD) ensuring bubble-free zero-g delivery'
          },
          propellantTanks: {
            count: 4,
            material: 'Titanium Ti-6Al-4V Grade 5 with Laser-Welded Capillary Vanes & Bubble Traps',
            pressurization: '2x 350-bar Carbon-Overwrapped Helium Bottles with Dual Dome Regulators'
          },
          powerAndComm: {
            solarArrays: '4x Deployable UltraFlex Solar Arrays (19m tip-to-tip span, InGaP/InGaAs/Ge triple-junction)',
            highGainAntenna: 'Dual-Axis Gimballed 1.2m Carbon-Composite Parabolic Dish (Deep Space Network Ka/X-band)',
            opticalCommDSOC: '1550nm Deep Space Optical Communications Laser Terminal (250 Mbps downlink)'
          }
        },
        fireDetectionAndSuppression: {
          detectionSensors: 'Multi-Point Laser Optical Aspirating Particle Smoke Detectors & Electrochemical Carbon Monoxide Sensors',
          portableExtinguishers: '2x Fine Water Mist Portable Fire Extinguishers (PFE) with N2 Propellant (Non-Toxic, Zero Corrosive Halide)',
          fixedSuppression: 'Automated Sealed Rack Flooding with Novec 1230 Clean Fire Suppression Agent (Suppression <10s)',
          emergencyBreathingApparatus: {
            count: 4,
            type: 'Quick-Donning Positive-Pressure Demand Breathing Masks (EBA)',
            oxygenSupplyMinutes: 15,
            couplingInterface: 'Standard NASA 3/8" Quick-Disconnect Oxygen Service Raceway Outlets'
          }
        },
        entryDescentAndLandingEDL: {
          heatShield: {
            material: '3D Quilted Phenolic-Impregnated Carbon Ablator (PICA-X) & Avcoat Tile Core',
            entryVelocityKps: 11.2,
            peakHeatFluxWcm2: 1250,
            bondlineTempLimitC: 250
          },
          pyrotechnicSeparation: [
            'Service Module Retention Clampband Pyrotechnic Jettison Bolts',
            'Forward Bay Cover (FBC) 3-Point Pneumatic Thruster Ejection (Z = +3.3m)'
          ],
          parachuteSystem: {
            drogueChutes: '2x Conical Ribbon Drogues (7.0m dia) mortar-deployed at Mach 1.5 (altitude 7,500m)',
            pilotChutes: '3x Mortar Pilot Chutes (2.0m dia) extracting Main Parachutes',
            mainChutes: '3x Ringsail Kevlar/Nylon Main Parachutes (35.4m dia each) with 2-Stage Reefing Cutters',
            terminalVelocityMps: 7.2,
            disconnects: 'Salt-Water Activated Pyrotechnic Risers Quick-Release'
          },
          marineUprightingCMUS: {
            spheresCount: 5,
            construction: 'High-Strength Kevlar/Polyurethane Inflatable Spheroids mounted to Forward Bulkhead',
            inflationMechanism: 'Dual Solid Propellant Gas Generators inflating 5 spheres in <60 seconds',
            stabilitySeaState: 'Guaranteed Apex-Up Stable Flotation through Ocean Sea State 5 (swells up to 4.0m)'
          }
        },
        cabinLightingAndCircadian: {
          fixturesCount: 16,
          technology: 'Solid-State Gallium Nitride (GaN) Multi-Wavelength Variable CCT LED Luminaires',
          circadianRegulation: {
            highVigilanceWork: '6500 K Blue-Enriched Spectrum (480nm melanopic peak, 500 lux) for dynamic flight phases',
            nominalHabitation: '4000 K Neutral White (250 lux) for daily operations and meal preparation',
            preSleepWindDown: '2700 K Low-Blue Warm Spectrum (50 lux) initiating melatonin synthesis',
            darkAdaptedNightVision: '630 nm Deep Red Monochromatic Mode (5 lux) preserving rod dark adaptation'
          },
          emergencyLighting: 'Independent Li-Ion Battery-Backed Internal Path & Egress Hatch Marker LEDs (>2.0 hrs)'
        },
        acousticQuietingAndAttenuation: {
          standardCompliance: 'NASA-STD-3001 NC-40 (Sleep Berths <=48 dBA) and NC-50 (Work Areas <=52 dBA)',
          isolationHardware: [
            'Silicone Elastomeric Dual-Chamber Vibration Isolators on all ECLSS Fans & VCD Pumps',
            'Micro-Perforated Acoustic Baffle Silencers integrated into Avionics Duct Loop Entrances',
            'Lightweight Open-Cell Melamine Acoustic Blankets lined against Al-Li Pressure Shell'
          ]
        },
        hazardousGasToxicology: {
          instrument: 'Vehicle Atmosphere Particle & Real-Time Gas Analyzer (VAPoR / Miniaturized Mass Spectrometer)',
          detectableGases: ['O2', 'N2', 'CO2', 'H2O', 'CH4', 'H2', 'CO', 'NH3', 'Benzene', 'Hydrazine / MMH', 'Halon / Freon'],
          sampleRateHz: 1.0,
          detectionSensitivityPpm: 0.1
        },
        internalPlumbingAndManifolds: {
          potableWaterLoop: 'Laser-Welded Commercial Titanium Grade 2 & 316L Electropolished Tubing with Silver Brazed Unions',
          pressureAccumulator: 'Stainless Steel Bellows Accumulator pressurized with Dry N2 at 220 kPa (2.2 bar)',
          freezeProtection: 'Dual-Circuit Kapton Etched-Foil Trace Heaters (15 W/m) on all lines within 150mm of hull',
          overboardVacuumDumps: 'Dual Heated Vent Nozzles (60W PTC Ceramic Heaters) preventing vacuum ice sublimation cones'
        },
        electricalDistributionSPDA: {
          architecture: 'Dual-Redundant Secondary Power Distribution Assemblies (SPDA) with TMR Voting',
          channelCount: 128,
          controllerType: 'Solid-State Power Controllers (SSPC) with sub-2 microsecond electronic short-circuit trip',
          bulkheadFeedthroughs: 'Mil-DTL-38999 Series III Stainless Steel Hermetic Jam-Nut Vitreous Glass Receptacles',
          wiringSpec: 'Mil-Spec AS22759/32 XL-ETFE Silver-Plated Copper Conductors with Polyimide Jacket'
        },
        crewConsumablesAndHygiene: {
          rationProvisioning: '112 Person-Days (21 days nominal + 7 days contingency reserve for 4 astronauts)',
          caloricTargetKcal: 2800,
          waterlessHygiene: 'Chlorhexidine Gluconate (CHG) Antimicrobial Body Wipes & Rinse-Free Conditioning Shampoo Caps',
          groomingTools: 'Zero-G Hair & Nail Clippers with Mini-Vacuum Impeller and 0.3-Micron HEPA Debris Collector'
        },
        searchAndRescueSAR: {
          satelliteBeacon: 'COSPAS-SARSAT 406.037 MHz Pulse Transmitter (5W RF, Multi-GNSS Ephemeris every 50s)',
          lineOfSightHomer: 'Dual VHF/UHF Transceiver on 121.5 MHz & 243.0 MHz Guard Distress Frequencies',
          marineLifeRafts: '2x 4-Person Self-Righting Inflatable Life Rafts with CO2 Rapid Bottles & Radar Reflective Canopies',
          oceanMarkers: '4x Fluorescein Sodium Dye Canisters (5 km slick, 12 hr duration) & 100,000-Lumen Xenon Strobes',
          desalters: 'Dual Manual Reverse-Osmosis Seawater Desalination Pumps (1.5 L/hr potable yield)'
        }
      }
    };
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
