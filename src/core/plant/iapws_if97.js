/**
 * IAPWS-IF97: International Association for the Properties of Water and Steam
 * Industrial Formulation 1997 for the Thermodynamic Properties of Water and Steam.
 *
 * Implements:
 * - Region 4: Saturation pressure Psat(T) and Saturation temperature Tsat(P)
 * - Region 1: Subcooled/compressed liquid water properties (273.15 K <= T <= 623.15 K, P <= 100 MPa)
 *   Gibbs free energy formulation yielding exact specific volume v, density rho,
 *   specific enthalpy h, specific entropy s, and isobaric heat capacity cp.
 *
 * References:
 * - IAPWS R7-97(2012): Revised Release on the IAPWS Industrial Formulation 1997.
 * - NIST Chemistry WebBook SRD 69 Thermophysical Properties of Fluid Systems.
 */

'use strict';

// Universal gas constant for water vapor: R = 461.526 J/(kg*K)
const R_WATER = 461.526;

// Region 1 Reference constants
const REGION1_P_STAR = 16.53e6; // Pa (16.53 MPa)
const REGION1_T_STAR = 1386.0; // K

// Region 4 Saturation Reference constants
const REGION4_P_STAR = 1.0e6; // Pa (1.0 MPa)
const REGION4_T_STAR = 1.0; // K

// Region 4 (Saturation Line) coefficients n_1 to n_10
const REGION4_COEFFS = [
  0.0, // 1-indexed padding
  1.1670521452767e3,
  -7.2421316703206e5,
  -1.7073846940092e1,
  1.202082470247e4,
  -3.2325550322333e6,
  1.491510861353e1,
  -4.8232657361591e3,
  4.0511340542057e5,
  -2.3855557567849e-1,
  6.5017534844798e2
];

// Region 2 (Vapor / Superheated Steam) Reference constants
const REGION2_P_STAR = 1.0e6; // Pa (1.0 MPa)
const REGION2_T_STAR = 540.0; // K

// Region 2 Ideal-Gas coefficients n_i^0 and exponents J_i^0 (Table 10)
const REGION2_N0 = [
  0.0, // 1-indexed padding
  -9.6927686500217,
  10.086655968018,
  -0.005608791128302,
  0.071452738081455,
  -0.40710498223928,
  1.4240819171444,
  -4.383951131945,
  -0.28408632460772,
  0.021268463753307
];
const REGION2_J0 = [0, 0, 1, -5, -4, -3, -2, -1, 2, 3];

// Region 2 Residual coefficients: [I_i, J_i, n_i] (Table 11)
const REGION2_TERMS = [
  [1, 0, -0.17731742473213e-2],
  [1, 1, -0.17834862292358e-1],
  [1, 2, -0.45996013696365e-1],
  [1, 3, -0.57581259083432e-1],
  [1, 6, -0.5032527872793e-1],
  [2, 1, -0.33032641670203e-4],
  [2, 2, -0.18948987516315e-3],
  [2, 4, -0.39392777243355e-2],
  [2, 7, -0.43797295650573e-1],
  [2, 36, -0.26674547914087e-4],
  [3, 0, 0.20481737692309e-7],
  [3, 1, 0.43870667284435e-6],
  [3, 3, -0.3227767723857e-4],
  [3, 6, -0.15033924542148e-2],
  [3, 35, -0.40668253562649e-1],
  [4, 1, -0.78847309559367e-9],
  [4, 2, 0.12790717852285e-7],
  [4, 3, 0.48225372718507e-6],
  [5, 7, 0.22922076337661e-5],
  [6, 3, -0.16714766451061e-11],
  [6, 16, -0.21171472321355e-2],
  [6, 35, -23.895741934104],
  [7, 0, -0.5905956432427e-17],
  [7, 11, -0.12621808899101e-5],
  [7, 25, -0.38946842435739e-1],
  [8, 8, 0.11256211360459e-10],
  [8, 36, -0.82311340897998e1],
  [9, 13, 0.19809712802088e-7],
  [10, 4, 0.10406965210174e-18],
  [10, 10, -0.10234747095929e-12],
  [10, 14, -0.10018179379511e-8],
  [16, 29, -0.80882908646985e-10],
  [16, 50, 0.10693031879409],
  [18, 57, -0.33662250574171],
  [20, 20, 0.89185845355421e-24],
  [20, 35, 0.30629316876232e-12],
  [20, 48, -0.42002467698208e-5],
  [21, 21, -0.59056029685639e-25],
  [22, 53, 0.37826947613457e-5],
  [23, 39, -0.12768608934681e-14],
  [24, 26, 0.73087610595061e-28],
  [24, 40, 0.55414715350778e-16],
  [24, 58, -0.9436970724121e-6]
];

// Region 3 (Critical vicinity) Reference constants
// Fundamental equation: f/(RT) = phi(delta, tau) = n1*ln(delta) + sum(n_i * delta^I_i * tau^J_i)
// with delta = rho/rhoc and tau = Tc/T (Eqs. 15-20 of R7-97(2012)).
const REGION3_T_STAR = 647.096; // K (critical temperature)
const REGION3_RHO_STAR = 322.0; // kg/m3 (critical density)
const REGION3_N1 = 0.10658070028513e1; // coefficient of the ln(delta) term

// Region 3 Residual coefficients: [I_i, J_i, n_i] (Table 32 of R7-97(2012), 39 terms,
// excluding the n1*ln(delta) term). Verified against the official Region 3 critical
// point (p(Tc, rhoc) = 22.064 MPa) and cross-checked against CoolProp IF97 and
// IAPWS-95 (HEOS) at 650 K / 25 MPa.
const REGION3_TERMS = [
  [0, 0, -0.15732845290239e2],
  [0, 1, 0.20944396974307e2],
  [0, 2, -0.76867707878716e1],
  [0, 7, 0.26185947787954e1],
  [0, 10, -0.28080781148620e1],
  [0, 12, 0.12053369696517e1],
  [0, 23, -0.84566812812502e-2],
  [1, 2, -0.12654315477714e1],
  [1, 6, -0.11524407806681e1],
  [1, 15, 0.88521043984318],
  [1, 17, -0.64207765181607],
  [2, 0, 0.38493460186671],
  [2, 2, -0.85214708824206],
  [2, 6, 0.48972281541877e1],
  [2, 7, -0.30502617256965e1],
  [2, 22, 0.39420536879154e-1],
  [2, 26, 0.12558408424308],
  [3, 0, -0.27999329698710],
  [3, 2, 0.13899799569460e1],
  [3, 4, -0.20189915023570e1],
  [3, 16, -0.82147637173963e-2],
  [3, 26, -0.47596035734923],
  [4, 0, 0.43984074473500e-1],
  [4, 2, -0.44476435428739],
  [4, 4, 0.90572070719733],
  [4, 26, 0.70522450087967],
  [5, 1, 0.10770512626332],
  [5, 3, -0.32913623258954],
  [5, 26, -0.50871062041158],
  [6, 0, -0.22175400873096e-1],
  [6, 2, 0.94260751665092e-1],
  [6, 26, 0.16436278447961],
  [7, 2, -0.13503372241348e-1],
  [8, 26, -0.14834345352472e-1],
  [9, 2, 0.57922953628084e-3],
  [9, 26, 0.32308904703711e-2],
  [10, 0, 0.80964802996215e-4],
  [10, 1, -0.16557679795037e-3],
  [11, 26, -0.44923899061815e-4]
];

// Region 5 (High-Temperature Steam) Reference constants
const REGION5_P_STAR = 1.0e6; // Pa (1.0 MPa)
const REGION5_T_STAR = 1000.0; // K

// Region 5 Ideal-Gas coefficients n_i^0 and exponents J_i^0 (Table 37 of R7-97(2012))
const REGION5_N0 = [
  0.0, // 1-indexed padding
  -13.179983674201,
  6.8540841634434,
  -0.024805148933466,
  0.36901534980333,
  -3.1161318213925,
  -0.32961626538917
];
const REGION5_J0 = [0, 0, 1, -3, -2, -1, 2];

// Region 5 Residual coefficients: [I_i, J_i, n_i] (Table 38 of R7-97(2012), Eq. 34, 6 terms)
// Source: IAPWS R7-97(2012) "Revised Release on the IAPWS Industrial Formulation 1997",
// Table 38. Values verified against the official Region 5 test states (Table 42).
const REGION5_TERMS = [
  [1, 1, 0.15736404855259e-2],
  [1, 2, 0.90153761673944e-3],
  [1, 3, -0.50270077677648e-2],
  [2, 3, 0.22440037409485e-5],
  [2, 9, -0.41163275453471e-5],
  [3, 7, 0.37919454822955e-7]
];

// Region 1 (Liquid) coefficients: [I_i, J_i, n_i] (34 terms)
const REGION1_TERMS = [
  [0, -2, 0.14632971213167],
  [0, -1, -0.84548187169114],
  [0, 0, -0.37563600249323e1],
  [0, 1, 0.33855169168385e1],
  [0, 2, -0.95791963387872],
  [0, 3, 0.15772038513228],
  [0, 4, -0.16616417199501e-1],
  [0, 5, 0.81214629983568e-3],
  [1, -9, 0.28319080123804e-3],
  [1, -7, -0.60706301565874e-3],
  [1, -1, -0.18990068218419e-1],
  [1, 0, -0.32529748770505e-1],
  [1, 1, -0.21841717175414e-1],
  [1, 3, -0.5283835796993e-4],
  [2, -3, -0.47184321077267e-3],
  [2, 0, -0.30001780793026e-3],
  [2, 1, 0.47661393906987e-4],
  [2, 3, -0.44141845330547e-5],
  [2, 17, -0.72694996297594e-15],
  [3, -4, -0.31679644845054e-4],
  [3, 0, -0.28270797985312e-5],
  [3, 6, -0.85205128120103e-9],
  [4, -5, -0.22425281908e-5],
  [4, -2, -0.65171222895601e-6],
  [4, 10, -0.14341729937924e-12],
  [5, -8, -0.40516996860117e-6],
  [8, -11, -0.12734301741641e-8],
  [8, -6, -0.17424871230634e-9],
  [21, -29, -0.68762131295531e-18],
  [23, -31, 0.14478307828521e-19],
  [29, -38, 0.26335781662795e-22],
  [30, -39, -0.11947622840002e-22],
  [31, -40, 0.18228094581404e-23],
  [32, -41, -0.93537087292458e-25]
];

class IAPWS_IF97 {
  /**
   * Saturation pressure Psat as a function of temperature T (Region 4)
   * Valid from 273.15 K to 647.096 K (Critical Temperature Tc)
   *
   * @param {number} tempK - Temperature in Kelvin
   * @returns {number} Saturation pressure in Pascal (Pa)
   */
  static saturationPressure(tempK) {
    if (tempK < 273.15 || tempK > 647.096) {
      throw new RangeError(`Temperature ${tempK} K is outside IAPWS-IF97 saturation range [273.15, 647.096] K`);
    }

    const n = REGION4_COEFFS;
    const theta = tempK / REGION4_T_STAR + n[9] / (tempK / REGION4_T_STAR - n[10]);

    const A = theta * theta + n[1] * theta + n[2];
    const B = n[3] * theta * theta + n[4] * theta + n[5];
    const C = n[6] * theta * theta + n[7] * theta + n[8];

    // Discriminant
    const disc = B * B - 4.0 * A * C;
    if (disc < 0) {
      throw new Error(`Numerical evaluation failure in IAPWS-IF97 Region 4 for T=${tempK} K`);
    }

    const beta = (2.0 * C) / (-B + Math.sqrt(disc));
    const pSatMPa = Math.pow(beta, 4.0);
    return pSatMPa * REGION4_P_STAR;
  }

  /**
   * Saturation temperature Tsat as a function of pressure P (Region 4)
   * Valid from 611.213 Pa (Triple point) to 22.064 MPa (Critical pressure)
   *
   * @param {number} pressurePa - Pressure in Pascal
   * @returns {number} Saturation temperature in Kelvin (K)
   */
  static saturationTemperature(pressurePa) {
    if (pressurePa < 611.213 || pressurePa > 22.064e6) {
      throw new RangeError(`Pressure ${pressurePa} Pa is outside IAPWS-IF97 saturation range [611.213 Pa, 22.064 MPa]`);
    }

    const beta = Math.pow(pressurePa / REGION4_P_STAR, 0.25);
    const n = REGION4_COEFFS;

    const E = beta * beta + n[3] * beta + n[6];
    const F = n[1] * beta * beta + n[4] * beta + n[7];
    const G = n[2] * beta * beta + n[5] * beta + n[8];

    const D = (2.0 * G) / (-F - Math.sqrt(F * F - 4.0 * E * G));
    const term = Math.sqrt((n[10] + D) * (n[10] + D) - 4.0 * (n[9] + n[10] * D));
    const tempK = 0.5 * (n[10] + D - term);
    return tempK;
  }

  /**
   * Evaluates Region 1 subcooled/compressed liquid properties.
   * Valid for 273.15 K <= T <= 623.15 K and Psat(T) <= P <= 100 MPa.
   *
   * @param {number} pressurePa - Pressure in Pa
   * @param {number} tempK - Temperature in K
   * @returns {Object} { specificVolume_m3_kg, density_kg_m3, specificEnthalpy_J_kg, specificEntropy_J_kg_K, isobaricHeatCapacity_J_kg_K }
   */
  static region1Properties(pressurePa, tempK) {
    if (tempK < 273.15 || tempK > 623.15) {
      throw new RangeError(`Temperature ${tempK} K is outside IAPWS-IF97 Region 1 range [273.15, 623.15] K`);
    }
    if (pressurePa <= 0 || pressurePa > 100.0e6) {
      throw new RangeError(`Pressure ${pressurePa} Pa is outside IAPWS-IF97 Region 1 range (0, 100 MPa]`);
    }

    const pi = pressurePa / REGION1_P_STAR;
    const tau = REGION1_T_STAR / tempK;

    const termPi = 7.1 - pi;
    const termTau = tau - 1.222;

    let gamma = 0.0;
    let gammaPi = 0.0;
    let gammaTau = 0.0;
    let gammaTauTau = 0.0;

    for (const [I, J, n] of REGION1_TERMS) {
      const powPi = Math.pow(termPi, I);
      const powTau = Math.pow(termTau, J);

      gamma += n * powPi * powTau;

      // Derivative d(gamma)/d(pi) = sum(-I * n * (7.1 - pi)^(I - 1) * (tau - 1.222)^J)
      if (I !== 0) {
        gammaPi += -I * n * Math.pow(termPi, I - 1) * powTau;
      }

      // Derivative d(gamma)/d(tau) = sum(n * (7.1 - pi)^I * J * (tau - 1.222)^(J - 1))
      gammaTau += n * powPi * J * Math.pow(termTau, J - 1);

      // Derivative d2(gamma)/d(tau)2 = sum(n * (7.1 - pi)^I * J * (J - 1) * (tau - 1.222)^(J - 2))
      gammaTauTau += n * powPi * J * (J - 1) * Math.pow(termTau, J - 2);
    }

    // Specific volume v = (R * T / P) * pi * (dgamma / dpi) = (R * T_star / P_star) * (dgamma / dpi)
    // Note: pi * (R * T / P) = R * T / P_star = (R * T_star / P_star) / tau
    const v = ((R_WATER * tempK) / pressurePa) * pi * gammaPi;
    const density = 1.0 / v;

    // Specific enthalpy h = R * T * tau * (dgamma / dtau)
    const h = R_WATER * tempK * tau * gammaTau;

    // Specific entropy s = R * (tau * dgamma/dtau - gamma)
    const s = R_WATER * (tau * gammaTau - gamma);

    // Isobaric heat capacity cp = -R * tau^2 * (d2gamma / dtau2)
    const cp = -R_WATER * tau * tau * gammaTauTau;

    return {
      pressurePa,
      temperatureK: tempK,
      phase: 'liquid',
      specificVolume_m3_kg: v,
      density_kg_m3: density,
      specificEnthalpy_J_kg: h,
      specificEntropy_J_kg_K: s,
      isobaricHeatCapacity_J_kg_K: cp,
      provenance: {
        formulation: 'IAPWS-IF97 (Industrial Formulation 1997)',
        source: 'International Association for the Properties of Water and Steam',
        region: 1,
        licenseStatus: 'unreviewed'
      }
    };
  }

  /**
   * Evaluates Region 2 vapor and superheated steam properties.
   * Valid for 273.15 K <= T <= 1073.15 K and 0 < P <= 100 MPa.
   *
   * @param {number} pressurePa - Pressure in Pa
   * @param {number} tempK - Temperature in K
   * @returns {Object} { pressurePa, temperatureK, phase: 'vapor', specificVolume_m3_kg, density_kg_m3, specificEnthalpy_J_kg, specificEntropy_J_kg_K, isobaricHeatCapacity_J_kg_K, ... }
   */
  static region2Properties(pressurePa, tempK) {
    if (tempK < 273.15 || tempK > 1073.15) {
      throw new RangeError(`Temperature ${tempK} K is outside IAPWS-IF97 Region 2 range [273.15, 1073.15] K`);
    }
    if (pressurePa <= 0 || pressurePa > 100.0e6) {
      throw new RangeError(`Pressure ${pressurePa} Pa is outside IAPWS-IF97 Region 2 range (0, 100 MPa]`);
    }

    const pi = pressurePa / REGION2_P_STAR;
    const tau = REGION2_T_STAR / tempK;

    // Ideal-gas contribution gamma0
    let gamma0 = Math.log(pi);
    let gamma0_tau = 0.0;
    let gamma0_tautau = 0.0;

    for (let i = 1; i <= 9; i++) {
      const J = REGION2_J0[i];
      const n = REGION2_N0[i];
      const powTau = Math.pow(tau, J);
      gamma0 += n * powTau;
      if (J !== 0) {
        gamma0_tau += n * J * Math.pow(tau, J - 1);
        gamma0_tautau += n * J * (J - 1) * Math.pow(tau, J - 2);
      }
    }

    // Residual contribution gammar
    let gammar = 0.0;
    let gammar_pi = 0.0;
    let gammar_tau = 0.0;
    let gammar_tautau = 0.0;
    const tauShift = tau - 0.5;

    for (const [I, J, n] of REGION2_TERMS) {
      const powPi = Math.pow(pi, I);
      const powTauShift = Math.pow(tauShift, J);

      gammar += n * powPi * powTauShift;
      gammar_pi += n * I * Math.pow(pi, I - 1) * powTauShift;

      if (J !== 0) {
        gammar_tau += n * powPi * J * Math.pow(tauShift, J - 1);
        if (J !== 1) {
          gammar_tautau += n * powPi * J * (J - 1) * Math.pow(tauShift, J - 2);
        }
      }
    }

    const v = ((R_WATER * tempK) / pressurePa) * (1.0 + pi * gammar_pi);
    const density = 1.0 / v;
    const h = R_WATER * tempK * tau * (gamma0_tau + gammar_tau);
    const s = R_WATER * (tau * (gamma0_tau + gammar_tau) - (gamma0 + gammar));
    const cp = -R_WATER * tau * tau * (gamma0_tautau + gammar_tautau);

    return {
      pressurePa,
      temperatureK: tempK,
      phase: 'vapor',
      specificVolume_m3_kg: v,
      density_kg_m3: density,
      specificEnthalpy_J_kg: h,
      specificEntropy_J_kg_K: s,
      isobaricHeatCapacity_J_kg_K: cp,
      provenance: {
        formulation: 'IAPWS-IF97 (Industrial Formulation 1997)',
        source: 'International Association for the Properties of Water and Steam',
        region: 2,
        licenseStatus: 'unreviewed'
      }
    };
  }

  /**
   * B23 boundary pressure p23(T) between Regions 2 and 3 (R7-97(2012), Eq. 5).
   * @param {number} tempK - Temperature in Kelvin (623.15 K <= T <= 863.15 K)
   * @returns {number} Boundary pressure in Pascal (Pa)
   */
  static region3Boundary23(tempK) {
    const p23MPa =
      0.34805185628969e3 -
      0.11671859879975e1 * tempK +
      0.10192970039326e-2 * tempK * tempK;
    return p23MPa * 1e6;
  }

  /**
   * Evaluates Region 3 (critical vicinity) single-phase properties.
   * Valid for 623.15 K <= T <= 863.15 K and p23(T) <= P <= 100 MPa.
   * Uses the fundamental equation in terms of reduced density delta = rho/rhoc
   * and inverse reduced temperature tau = Tc/T (R7-97(2012), Eqs. 15-20).
   * The density is solved from the pressure relation p = rho*R*T*delta*dphi/ddelta
   * with a safeguarded Newton iteration (bracket search + Newton refinement).
   *
   * @param {number} pressurePa - Pressure in Pa
   * @param {number} tempK - Temperature in K
   * @returns {Object} { pressurePa, temperatureK, phase: 'supercritical', specificVolume_m3_kg, density_kg_m3, specificEnthalpy_J_kg, specificEntropy_J_kg_K, isobaricHeatCapacity_J_kg_K, ... }
   */
  static region3Properties(pressurePa, tempK) {
    if (tempK < 623.15 || tempK > 863.15) {
      throw new RangeError(`Temperature ${tempK} K is outside IAPWS-IF97 Region 3 range [623.15, 863.15] K`);
    }
    if (pressurePa <= 0 || pressurePa > 100.0e6) {
      throw new RangeError(`Pressure ${pressurePa} Pa is outside IAPWS-IF97 Region 3 range (0, 100 MPa]`);
    }
    const p23 = this.region3Boundary23(tempK);
    if (pressurePa < p23) {
      throw new RangeError(
        `Pressure ${pressurePa} Pa is below the B23 boundary p23(${tempK} K)=${(p23 / 1e6).toFixed(4)} MPa; ` +
          `state belongs to Region 2 (use region2Properties).`
      );
    }

    const R = R_WATER;
    const Tc = REGION3_T_STAR;
    const rhoc = REGION3_RHO_STAR;
    const tau = Tc / tempK;

    const phiAt = (delta, tauIn) => {
      let phi = REGION3_N1 * Math.log(delta);
      for (const [I, J, n] of REGION3_TERMS) {
        phi += n * Math.pow(delta, I) * Math.pow(tauIn, J);
      }
      return phi;
    };

    const phiDerivs = (delta) => {
      let phiD = REGION3_N1 / delta;
      let phiDD = -REGION3_N1 / (delta * delta);
      let phiT = 0.0;
      let phiTT = 0.0;
      let phiDT = 0.0;
      for (const [I, J, n] of REGION3_TERMS) {
        const dI = Math.pow(delta, I);
        const dIm1 = Math.pow(delta, I - 1);
        const tJ = Math.pow(tau, J);
        const tJm1 = Math.pow(tau, J - 1);
        phiD += n * I * dIm1 * tJ;
        if (I >= 2) {
          phiDD += n * I * (I - 1) * Math.pow(delta, I - 2) * tJ;
        }
        phiT += n * J * dI * tJm1;
        if (J >= 2) {
          phiTT += n * J * (J - 1) * dI * Math.pow(tau, J - 2);
        }
        if (I >= 1 && J >= 1) {
          phiDT += n * I * J * dIm1 * tJm1;
        }
      }
      return { phiD, phiDD, phiT, phiTT, phiDT };
    };

    // Pressure as a function of density: p = rho*R*T*delta*dphi/ddelta
    const pressureAt = (rho) => {
      const delta = rho / rhoc;
      const { phiD } = phiDerivs(delta);
      return rho * R * tempK * delta * phiD;
    };

    // Solve for density: bracket then safeguarded Newton
    let rho = pressurePa / (R * tempK);
    let lo = rho;
    let hi = rho;
    while (pressureAt(lo) > pressurePa) {
      lo /= 2.0;
    }
    while (pressureAt(hi) < pressurePa) {
      hi *= 2.0;
    }
    for (let it = 0; it < 100; it++) {
      const p = pressureAt(rho);
      const delta = rho / rhoc;
      const { phiD, phiDD } = phiDerivs(delta);
      const dpdrho = R * tempK * delta * (phiD + delta * phiDD);
      let next = rho - (p - pressurePa) / dpdrho;
      if (!(next > lo && next < hi)) {
        next = 0.5 * (lo + hi);
      }
      const pNext = pressureAt(next);
      if (pNext < pressurePa) {
        lo = next;
      } else {
        hi = next;
      }
      rho = next;
      if (Math.abs(pNext - pressurePa) / pressurePa < 1e-14) {
        break;
      }
    }

    const delta = rho / rhoc;
    const { phiD, phiDD, phiT, phiTT, phiDT } = phiDerivs(delta);
    const v = 1.0 / rho;
    const h = R * tempK * (tau * phiT + delta * phiD);
    const s = R * (tau * phiT - phiAt(delta, tau));
    const cp =
      -R * tau * tau * phiTT +
      (R * Math.pow(delta * phiD - delta * tau * phiDT, 2)) /
        (2.0 * delta * phiD + delta * delta * phiDD);

    return {
      pressurePa,
      temperatureK: tempK,
      phase: 'supercritical',
      specificVolume_m3_kg: v,
      density_kg_m3: rho,
      specificEnthalpy_J_kg: h,
      specificEntropy_J_kg_K: s,
      isobaricHeatCapacity_J_kg_K: cp,
      provenance: {
        formulation: 'IAPWS-IF97 (Industrial Formulation 1997)',
        source: 'International Association for the Properties of Water and Steam',
        region: 3,
        licenseStatus: 'unreviewed'
      }
    };
  }

  /**
   * Evaluates Region 5 high-temperature steam properties.
   * Valid for 1073.15 K < T <= 2273.15 K and 0 < P <= 50 MPa.
   *
   * @param {number} pressurePa - Pressure in Pa
   * @param {number} tempK - Temperature in K
   * @returns {Object} Comprehensive thermodynamic properties
   */
  static region5Properties(pressurePa, tempK) {
    if (tempK < 1073.15 || tempK > 2273.15) {
      throw new RangeError(`Temperature ${tempK} K is outside IAPWS-IF97 Region 5 range [1073.15, 2273.15] K`);
    }
    if (pressurePa <= 0 || pressurePa > 50.0e6) {
      throw new RangeError(`Pressure ${pressurePa} Pa is outside IAPWS-IF97 Region 5 range (0, 50 MPa]`);
    }

    const pi = pressurePa / REGION5_P_STAR;
    const tau = REGION5_T_STAR / tempK;

    // Ideal-gas contribution gamma0
    let gamma0 = Math.log(pi);
    let gamma0_tau = 0.0;
    let gamma0_tautau = 0.0;

    for (let i = 1; i <= 6; i++) {
      const J = REGION5_J0[i];
      const n = REGION5_N0[i];
      const powTau = Math.pow(tau, J);
      gamma0 += n * powTau;
      if (J !== 0) {
        gamma0_tau += n * J * Math.pow(tau, J - 1);
        gamma0_tautau += n * J * (J - 1) * Math.pow(tau, J - 2);
      }
    }

    // Residual contribution gammar
    let gammar = 0.0;
    let gammar_pi = 0.0;
    let gammar_tau = 0.0;
    let gammar_tautau = 0.0;

    for (const [I, J, n] of REGION5_TERMS) {
      const powPi = Math.pow(pi, I);
      const powTau = Math.pow(tau, J);

      gammar += n * powPi * powTau;
      gammar_pi += n * I * Math.pow(pi, I - 1) * powTau;

      if (J !== 0) {
        gammar_tau += n * powPi * J * Math.pow(tau, J - 1);
        if (J !== 1) {
          gammar_tautau += n * powPi * J * (J - 1) * Math.pow(tau, J - 2);
        }
      }
    }

    const v = ((R_WATER * tempK) / pressurePa) * (1.0 + pi * gammar_pi);
    const density = 1.0 / v;
    const h = R_WATER * tempK * tau * (gamma0_tau + gammar_tau);
    const s = R_WATER * (tau * (gamma0_tau + gammar_tau) - (gamma0 + gammar));
    const cp = -R_WATER * tau * tau * (gamma0_tautau + gammar_tautau);

    return {
      pressurePa,
      temperatureK: tempK,
      phase: 'gas',
      specificVolume_m3_kg: v,
      density_kg_m3: density,
      specificEnthalpy_J_kg: h,
      specificEntropy_J_kg_K: s,
      isobaricHeatCapacity_J_kg_K: cp,
      provenance: {
        formulation: 'IAPWS-IF97 (Industrial Formulation 1997)',
        source: 'International Association for the Properties of Water and Steam',
        region: 5,
        licenseStatus: 'unreviewed'
      }
    };
  }

  static calculatePropertiesRegion5(pressurePa, tempK) {
    return IAPWS_IF97.region5Properties(pressurePa, tempK);
  }

  /**
   * Evaluates high-precision water and steam thermodynamic properties with automatic phase identification:
   * - Region 1: Compressed/subcooled liquid (T <= 623.15 K, P >= Psat(T))
   * - Region 2: Superheated steam/vapor (T <= 623.15 K, P < Psat(T), or 623.15 K < T <= 1073.15 K)
   * - Region 4: Saturation boundary detection and metadata
   * - Region 5: High-temperature steam (1073.15 K < T <= 2273.15 K, P <= 50 MPa)
   *
   * @param {number} pressurePa - Absolute pressure in Pa
   * @param {number} tempK - Temperature in K
   * @returns {Object} Comprehensive thermodynamic property object
   */
  static calculateProperties(pressurePa, tempK) {
    if (tempK < 273.15 || tempK > 2273.15) {
      throw new RangeError(`Temperature ${tempK} K is outside IAPWS-IF97 valid range [273.15, 2273.15] K`);
    }
    const maxP = tempK > 1073.15 ? 50.0e6 : 100.0e6;
    if (pressurePa <= 0 || pressurePa > maxP) {
      throw new RangeError(`Pressure ${pressurePa} Pa is outside IAPWS-IF97 valid range (0, ${maxP / 1e6} MPa]`);
    }

    let pSat = null;
    let tSat = null;
    let isSaturated = false;

    if (tempK <= 647.096) {
      try {
        pSat = this.saturationPressure(tempK);
        if (pressurePa >= 611.213 && pressurePa <= 22.064e6) {
          tSat = this.saturationTemperature(pressurePa);
        }
        if (Math.abs(pressurePa - pSat) / pSat < 1e-4) {
          isSaturated = true;
        }
      } catch {
        pSat = null;
      }
    }

    // Region 3 (critical region, 623.15 K <= T <= 863.15 K) is NOT implemented.
    // Fail closed: per R7-97(2012), Region 3 is defined by p >= p23(T)
    // (B23 boundary, Eq. 5) for T in [623.15, 863.15] K; any state inside
    // this envelope is rejected instead of silently returning Region 1/2
    // values that are invalid there.
    if (tempK > 623.15 && tempK <= 863.15) {
      const p23MPa = 0.34805185628969e3 - 0.11671859879975e1 * tempK + 0.10192970039326e-2 * tempK * tempK;
      if (pressurePa >= p23MPa * 1e6) {
        throw new Error(
          `UNSUPPORTED: state p=${pressurePa} Pa, T=${tempK} K lies in IAPWS-IF97 Region 3 ` +
            `(623.15 K <= T <= 863.15 K, p >= p23(T)); the Region 3 fundamental equation is not implemented in this module.`
        );
      }
    }

    let props;
    if (tempK <= 623.15) {
      if (pSat !== null && pressurePa < pSat) {
        props = this.region2Properties(pressurePa, tempK);
      } else {
        props = this.region1Properties(pressurePa, tempK);
      }
    } else if (tempK <= 1073.15) {
      props = this.region2Properties(pressurePa, tempK);
    } else {
      props = this.calculatePropertiesRegion5(pressurePa, tempK);
    }

    return {
      ...props,
      isSaturated,
      saturation:
        pSat !== null
          ? {
              saturationPressurePa: pSat,
              saturationTemperatureK: tSat
            }
          : null
    };
  }
}

module.exports = {
  IAPWS_IF97,
  R_WATER
};
