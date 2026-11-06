/**
 * OmniEng Reference Material Catalog (documented-typical values).
 *
 * HONESTY PROVISION:
 *  - Every card carries explicit provenance: reference, URL, and retrieval date.
 *  - validationStatus is 'documented-typical' for every record. Nothing here
 *    claims design-allowable status: the values are typical published values
 *    compiled from public-domain or openly published sources (e.g. MIL-HDBK-5J,
 *    ASTM standard summaries, manufacturer/supplier technical literature).
 *  - Steel pressure-vessel values are TYPICAL PUBLISHED VALUES from ASTM
 *    standard summaries, NOT ASME code-minimum design allowables.
 *  - Temperature-dependent arrays are sampled at the listed ladder temperatures
 *    (K) and are intended for linear interpolation only.
 */

'use strict';

const RETRIEVED_AT = '2026-11-01';

const MIL_HDBK_5J = {
  reference:
    'MIL-HDBK-5J, Department of Defense Handbook: Metallic Materials and Elements for Aerospace Vehicle Structures (31 Jan 2003), public domain (U.S. DoD)',
  url: 'https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/MIL_HDBK_5J_139/',
  retrievedAt: RETRIEVED_AT
};

const ASTM_A516 = {
  reference:
    'ASTM A516/A516M-17 Standard Specification for Pressure Vessel Plates, Carbon Steel, for Moderate- and Lower-Temperature Service — typical published values from standard summary (not ASME code-minimum)',
  url: 'https://www.astm.org/a0516_a0516m-17.html',
  retrievedAt: RETRIEVED_AT
};

const ASTM_A106 = {
  reference:
    'ASTM A106/A106M-19 Standard Specification for Seamless Carbon Steel Pipe for High-Temperature Service — typical published values from standard summary (not ASME code-minimum)',
  url: 'https://www.astm.org/a0106_a0106m-19.html',
  retrievedAt: RETRIEVED_AT
};

const ASTM_A240 = {
  reference:
    'ASTM A240/A240M-22 Standard Specification for Chromium and Chromium-Nickel Stainless Steel Plate, Sheet, and Strip for Pressure Vessels and for General Applications — typical published values from standard summary (not ASME code-minimum)',
  url: 'https://www.astm.org/a0240_a0240m-22.html',
  retrievedAt: RETRIEVED_AT
};

const SPECIAL_METALS_718 = {
  reference:
    'Special Metals Corporation, INCONEL alloy 718 Technical Bulletin (publicly published manufacturer datasheet)',
  url: 'https://www.specialmetals.com/documents/technical-bulletins/inconel/inconel-alloy-718.pdf',
  retrievedAt: RETRIEVED_AT
};

const VICTREX_PEEK_SOURCE = {
  reference:
    "Polyether ether ketone (PEEK) — publicly published reference values (Wikipedia; sourced from Ullmann's Encyclopedia of Industrial Chemistry and Victrex literature)",
  url: 'https://en.wikipedia.org/wiki/Polyether_ether_ketone',
  retrievedAt: RETRIEVED_AT
};

const PTFE_SOURCE = {
  reference:
    'Polytetrafluoroethylene (PTFE) — publicly published reference values (Wikipedia; sourced from NIST composition data and Chemours Teflon literature)',
  url: 'https://en.wikipedia.org/wiki/Polytetrafluoroethylene',
  retrievedAt: RETRIEVED_AT
};

const PARKER_NBR_SOURCE = {
  reference:
    'Parker Hannifin, Parker O-Ring Handbook (ORD 5700) — publicly published elastomer compound data (nitrile/NBR)',
  url: 'https://www.parker.com/literature/ORD%205700%20Parker_O-Ring_Handbook.pdf',
  retrievedAt: RETRIEVED_AT
};

const UNIT_PROFILE = {
  temperature: 'K',
  modulus: 'Pa',
  stress: 'Pa',
  density: 'kg/m³',
  alpha: '1/K',
  poisson: '-',
  thermalConductivity: 'W/(m·K)',
  length: 'm'
};

const CARDS = [
  {
    id: 'AL-7075-T6',
    name: 'Aluminum alloy 7075-T6 (wrought, T6 heat treated)',
    class: 'Aluminum alloy (aerospace wrought)',
    source: MIL_HDBK_5J,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 2810,
    densityKgM3: 2810,
    nu: 0.33,
    temperatureLadderK: [293, 366, 422, 489],
    E: [71.7e9, 69.6e9, 67.6e9, 64.1e9],
    alpha: [23.6e-6, 24.0e-6, 24.4e-6, 25.0e-6],
    Sy: [503e6, 437e6, 310e6, 172e6],
    Su: [572e6, 524e6, 421e6, 276e6],
    yieldStrengthMPa: 503,
    thermalConductivityW_mK: 130,
    notes: [
      'Room-temperature E, density, and strengths from MIL-HDBK-5J typical tables; elevated-temperature points from MIL-HDBK-5J figures (documented-typical, not certified allowables).'
    ]
  },
  {
    id: 'AL-2024-T3',
    name: 'Aluminum alloy 2024-T3 (wrought, T3 solution treated + cold worked)',
    class: 'Aluminum alloy (aerospace wrought)',
    source: MIL_HDBK_5J,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 2780,
    densityKgM3: 2780,
    nu: 0.33,
    temperatureLadderK: [293, 366, 422, 489],
    E: [73.1e9, 70.7e9, 68.3e9, 64.8e9],
    alpha: [23.2e-6, 23.5e-6, 23.9e-6, 24.4e-6],
    Sy: [345e6, 318e6, 241e6, 152e6],
    Su: [483e6, 434e6, 352e6, 228e6],
    yieldStrengthMPa: 345,
    thermalConductivityW_mK: 121,
    notes: [
      'Room-temperature E, density, and strengths from MIL-HDBK-5J typical tables; elevated-temperature points from MIL-HDBK-5J figures (documented-typical, not certified allowables).'
    ]
  },
  {
    id: 'TI-6AL-4V',
    name: 'Titanium alloy Ti-6Al-4V (Grade 5, annealed)',
    class: 'Titanium alloy (aerospace wrought)',
    source: MIL_HDBK_5J,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 4430,
    densityKgM3: 4430,
    nu: 0.342,
    temperatureLadderK: [293, 422, 589, 811],
    E: [113.8e9, 108.9e9, 99.3e9, 88.3e9],
    alpha: [8.6e-6, 9.0e-6, 9.5e-6, 10.2e-6],
    Sy: [880e6, 780e6, 615e6, 345e6],
    Su: [950e6, 870e6, 750e6, 520e6],
    yieldStrengthMPa: 880,
    thermalConductivityW_mK: 6.7,
    notes: [
      'Room-temperature E, density, and strengths from MIL-HDBK-5J typical tables; elevated-temperature points from MIL-HDBK-5J figures (documented-typical, not certified allowables).'
    ]
  },
  {
    id: 'STEEL-SA516-GR70',
    name: 'Carbon steel SA-516 Grade 70 (pressure vessel plate, normalized)',
    class: 'Carbon steel (pressure vessel plate)',
    source: ASTM_A516,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 7850,
    densityKgM3: 7850,
    nu: 0.3,
    temperatureLadderK: [293, 366, 478, 589, 700],
    E: [200e9, 194e9, 185e9, 175e9, 160e9],
    alpha: [12.3e-6, 12.9e-6, 13.6e-6, 14.2e-6, 14.8e-6],
    Sy: [262e6, 253e6, 230e6, 199e6, 158e6],
    Su: [550e6, 540e6, 520e6, 490e6, 420e6],
    yieldStrengthMPa: 262,
    thermalConductivityW_mK: 52,
    notes: [
      'Grade 70 tensile range 485–620 MPa per ASTM A516/A516M abstract. Yield is typical near the 260 MPa minimum. Values are typical published summaries, NOT ASME code-minimum design allowables.'
    ]
  },
  {
    id: 'STEEL-SA106-GRB',
    name: 'Carbon steel SA-106 Grade B (seamless pipe, high-temperature service)',
    class: 'Carbon steel (seamless pipe)',
    source: ASTM_A106,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 7850,
    densityKgM3: 7850,
    nu: 0.3,
    temperatureLadderK: [293, 366, 478, 589, 700],
    E: [200e9, 194e9, 185e9, 175e9, 160e9],
    alpha: [11.7e-6, 12.3e-6, 13.0e-6, 13.6e-6, 14.2e-6],
    Sy: [250e6, 240e6, 215e6, 185e6, 145e6],
    Su: [460e6, 450e6, 430e6, 400e6, 340e6],
    yieldStrengthMPa: 250,
    thermalConductivityW_mK: 47,
    notes: [
      'Grade B minimums per ASTM A106/A106M: yield 240 MPa, tensile 415 MPa. Values are typical published summaries, NOT ASME code-minimum design allowables.'
    ]
  },
  {
    id: 'SS-304L',
    name: 'Stainless steel 304L (austenitic, low carbon)',
    class: 'Stainless steel (austenitic)',
    source: ASTM_A240,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 7900,
    densityKgM3: 7900,
    nu: 0.29,
    temperatureLadderK: [293, 366, 478, 589, 811],
    E: [193e9, 186e9, 178e9, 168e9, 148e9],
    alpha: [16.9e-6, 17.3e-6, 17.8e-6, 18.2e-6, 18.8e-6],
    Sy: [210e6, 196e6, 174e6, 153e6, 115e6],
    Su: [560e6, 530e6, 495e6, 465e6, 380e6],
    yieldStrengthMPa: 210,
    thermalConductivityW_mK: 16.2,
    notes: [
      '304L minimums per ASTM A240/A240M: yield 170 MPa, tensile 485 MPa. Values are typical published summaries, NOT ASME code-minimum design allowables.'
    ]
  },
  {
    id: 'SS-316L',
    name: 'Stainless steel 316L (austenitic, low carbon, molybdenum-bearing)',
    class: 'Stainless steel (austenitic)',
    source: ASTM_A240,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 8000,
    densityKgM3: 8000,
    nu: 0.29,
    temperatureLadderK: [293, 366, 478, 589, 811],
    E: [193e9, 186e9, 178e9, 168e9, 148e9],
    alpha: [16.0e-6, 16.4e-6, 16.9e-6, 17.3e-6, 17.9e-6],
    Sy: [205e6, 192e6, 170e6, 150e6, 112e6],
    Su: [515e6, 490e6, 455e6, 425e6, 350e6],
    yieldStrengthMPa: 205,
    thermalConductivityW_mK: 16.3,
    notes: [
      '316L minimums per ASTM A240/A240M: yield 170 MPa, tensile 485 MPa. Values are typical published summaries, NOT ASME code-minimum design allowables.'
    ]
  },
  {
    id: 'INCONEL-718',
    name: 'Nickel alloy Inconel 718 (solution annealed + aged)',
    class: 'Nickel-based superalloy',
    source: SPECIAL_METALS_718,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 8190,
    densityKgM3: 8190,
    nu: 0.294,
    temperatureLadderK: [293, 366, 589, 811, 922],
    E: [200e9, 194e9, 184e9, 171e9, 155e9],
    alpha: [13.0e-6, 13.3e-6, 14.0e-6, 14.8e-6, 15.2e-6],
    Sy: [1103e6, 1055e6, 965e6, 910e6, 825e6],
    Su: [1379e6, 1340e6, 1240e6, 1150e6, 1000e6],
    yieldStrengthMPa: 1103,
    thermalConductivityW_mK: 11.4,
    notes: [
      'Room-temperature values per Special Metals INCONEL 718 datasheet (aged condition). Elevated-temperature points are documented-typical from the same datasheet families; not certified allowables.'
    ]
  },
  {
    id: 'PEEK',
    name: 'Polyetheretherketone, unfilled injection-molding grade (Victrex 450G class)',
    class: 'High-performance thermoplastic',
    source: VICTREX_PEEK_SOURCE,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 1300,
    densityKgM3: 1300,
    nu: 0.4,
    temperatureLadderK: [293, 373, 423, 523],
    E: [3.6e9, 2.6e9, 1.7e9, 0.55e9],
    alpha: [47e-6, 50e-6, 55e-6, 60e-6],
    Sy: [90e6, 75e6, 55e6, 30e6],
    Su: [95e6, 80e6, 60e6, 35e6],
    yieldStrengthMPa: 90,
    thermalConductivityW_mK: 0.25,
    notes: [
      'Tensile modulus 3.6 GPa and tensile strength 90–100 MPa per open PEEK reference data; Tg ≈ 143 °C. Values are documented-typical; modulus near/above Tg is strongly processing- and crystallinity-dependent.'
    ]
  },
  {
    id: 'PTFE',
    name: 'Polytetrafluoroethylene (virgin, molded/sintered)',
    class: 'Fluoropolymer thermoplastic',
    source: PTFE_SOURCE,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 2200,
    densityKgM3: 2200,
    nu: 0.46,
    temperatureLadderK: [233, 293, 373, 473, 533],
    E: [0.5e9, 0.5e9, 0.42e9, 0.3e9, 0.18e9],
    alpha: [112e-6, 118e-6, 125e-6, 135e-6, 140e-6],
    Sy: [23e6, 23e6, 20e6, 16e6, 10e6],
    Su: [28e6, 28e6, 25e6, 21e6, 14e6],
    yieldStrengthMPa: 23,
    thermalConductivityW_mK: 0.25,
    notes: [
      "Density 2200 kg/m³, Young's modulus 0.5 GPa, yield 23 MPa, CTE 112–125×10⁻⁶/K per open PTFE reference data. PTFE creeps strongly; modulus values are short-term documented-typical."
    ]
  },
  {
    id: 'NBR',
    name: 'Nitrile butadiene rubber (NBR, ~70 Shore A)',
    class: 'Elastomer',
    source: PARKER_NBR_SOURCE,
    validationStatus: 'documented-typical',
    units: UNIT_PROFILE,
    rho: 1300,
    densityKgM3: 1300,
    nu: 0.499,
    temperatureLadderK: [233, 293, 353, 393],
    E: [7e6, 6e6, 5e6, 4e6],
    alpha: [180e-6, 190e-6, 200e-6, 210e-6],
    Sy: [8e6, 7e6, 6e6, 5e6],
    Su: [15e6, 14e6, 12e6, 10e6],
    yieldStrengthMPa: 8,
    thermalConductivityW_mK: 0.25,
    notes: [
      'Nitrile compound typical values per Parker O-Ring Handbook compound families (70 Shore A). Elastomer modulus depends strongly on hardness and strain; values are documented-typical, not design data.'
    ]
  }
];

const MATERIAL_DATABASE = Object.freeze(Object.fromEntries(CARDS.map((card) => [card.id, card])));

const REFERENCE_TEMPERATURE_K = 293;

/**
 * Linear interpolation of a temperature-dependent property from a card ladder.
 * Clamps to ladder bounds. Throws on malformed ladders.
 * @param {Object} card card from MATERIAL_DATABASE
 * @param {string} prop property name holding the value array
 * @param {number} temperatureK temperature in kelvin
 * @returns {number} interpolated property value in SI units
 */
function interpolateProperty(card, prop, temperatureK) {
  const temps = card.temperatureLadderK;
  const values = card[prop];
  if (
    !Array.isArray(temps) ||
    !Array.isArray(values) ||
    temps.length !== values.length ||
    temps.length < 2 ||
    !temps.every(Number.isFinite) ||
    !values.every(Number.isFinite)
  ) {
    throw new TypeError(`Property ladder for "${prop}" must be two parallel finite series of equal length (>= 2).`);
  }
  const T = Number(temperatureK);
  if (!Number.isFinite(T)) {
    throw new TypeError('Temperature must be a finite number in kelvin.');
  }
  if (T <= temps[0]) return values[0];
  if (T >= temps[temps.length - 1]) return values[values.length - 1];
  let lo = 0;
  while (lo + 1 < temps.length && temps[lo + 1] < T) lo++;
  const fraction = (T - temps[lo]) / (temps[lo + 1] - temps[lo]);
  return values[lo] + (values[lo + 1] - values[lo]) * fraction;
}

module.exports = {
  MATERIAL_DATABASE,
  CARDS,
  REFERENCE_TEMPERATURE_K,
  interpolateProperty,
  RETRIEVED_AT
};
