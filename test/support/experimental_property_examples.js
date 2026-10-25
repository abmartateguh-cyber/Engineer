'use strict';

/**
 * Test-only unverified property examples retained for legacy calculation smoke checks.
 * These records have no verified source or redistribution license and are not design data.
 */
const EXPERIMENTAL_PROPERTY_EXAMPLES = [
  // --- Light Alkanes ---
  {
    id: 'Methane',
    name: 'Methane',
    formula: 'CH4',
    cas: '74-82-8',
    family: 'Alkane',
    mw: 16.043,
    Tc: 190.56,
    Pc: 4.599e6,
    omega: 0.011,
    Tb: 111.66,
    pvEq: [39.205, -1324.4, -3.4366, 3.1019e-5, 2],
    pvTmin: 90.69,
    pvTmax: 190.56,
    rhoLEq: [2.9214, 0.28941, 190.56, 0.28881],
    cpEq: [33.298, 79.933, 2086.9, 41.602, 991.96]
  },
  {
    id: 'Ethane',
    name: 'Ethane',
    formula: 'C2H6',
    cas: '74-84-0',
    family: 'Alkane',
    mw: 30.07,
    Tc: 305.32,
    Pc: 4.872e6,
    omega: 0.099,
    Tb: 184.55,
    pvEq: [44.757, -2392.3, -4.1132, 2.0628e-5, 2],
    pvTmin: 90.35,
    pvTmax: 305.32,
    rhoLEq: [1.9122, 0.27931, 305.32, 0.28662],
    cpEq: [38.16, 102.39, 1421.1, 56.76, 686.0]
  },
  {
    id: 'Propane',
    name: 'Propane',
    formula: 'C3H8',
    cas: '74-98-6',
    family: 'Alkane',
    mw: 44.097,
    Tc: 369.83,
    Pc: 4.248e6,
    omega: 0.152,
    Tb: 231.02,
    pvEq: [59.078, -3492.6, -6.322, 2.478e-5, 2],
    pvTmin: 85.53,
    pvTmax: 369.83,
    rhoLEq: [1.3768, 0.2764, 369.83, 0.2872],
    cpEq: [51.92, 172.9, 1550.0, 78.4, 730.0]
  },
  {
    id: 'n-Butane',
    name: 'n-Butane',
    formula: 'C4H10',
    cas: '106-97-8',
    family: 'Alkane',
    mw: 58.123,
    Tc: 425.12,
    Pc: 3.796e6,
    omega: 0.2,
    Tb: 272.66,
    pvEq: [66.345, -4389.1, -7.346, 2.145e-5, 2],
    pvTmin: 134.86,
    pvTmax: 425.12,
    rhoLEq: [1.065, 0.273, 425.12, 0.286],
    cpEq: [66.5, 225.0, 1560.0, 105.0, 740.0]
  },
  {
    id: 'i-Butane',
    name: 'Isobutane',
    formula: 'C4H10',
    cas: '75-28-5',
    family: 'Alkane',
    mw: 58.123,
    Tc: 407.85,
    Pc: 3.64e6,
    omega: 0.181,
    Tb: 261.42,
    pvEq: [65.02, -4170.0, -7.15, 2.2e-5, 2],
    pvTmin: 113.54,
    pvTmax: 407.85,
    rhoLEq: [1.04, 0.272, 407.85, 0.284],
    cpEq: [65.0, 220.0, 1540.0, 102.0, 735.0]
  },
  {
    id: 'n-Pentane',
    name: 'n-Pentane',
    formula: 'C5H12',
    cas: '109-66-0',
    family: 'Alkane',
    mw: 72.15,
    Tc: 469.7,
    Pc: 3.37e6,
    omega: 0.251,
    Tb: 309.22,
    pvEq: [72.24, -5320.0, -8.11, 1.8e-5, 2],
    pvTmin: 143.42,
    pvTmax: 469.7,
    rhoLEq: [0.875, 0.268, 469.7, 0.285],
    cpEq: [81.5, 275.0, 1570.0, 130.0, 750.0]
  },
  {
    id: 'n-Hexane',
    name: 'n-Hexane',
    formula: 'C6H14',
    cas: '110-54-3',
    family: 'Alkane',
    mw: 86.177,
    Tc: 507.6,
    Pc: 3.025e6,
    omega: 0.301,
    Tb: 341.88,
    pvEq: [78.5, -6280.0, -8.95, 1.6e-5, 2],
    pvTmin: 177.83,
    pvTmax: 507.6,
    rhoLEq: [0.745, 0.264, 507.6, 0.284],
    cpEq: [98.0, 325.0, 1580.0, 155.0, 760.0]
  },
  {
    id: 'n-Heptane',
    name: 'n-Heptane',
    formula: 'C7H16',
    cas: '142-82-5',
    family: 'Alkane',
    mw: 100.204,
    Tc: 540.2,
    Pc: 2.74e6,
    omega: 0.35,
    Tb: 371.57,
    pvEq: [84.1, -7220.0, -9.65, 1.4e-5, 2],
    pvTmin: 182.55,
    pvTmax: 540.2,
    rhoLEq: [0.65, 0.26, 540.2, 0.283],
    cpEq: [114.0, 375.0, 1590.0, 180.0, 770.0]
  },
  {
    id: 'n-Octane',
    name: 'n-Octane',
    formula: 'C8H18',
    cas: '111-65-9',
    family: 'Alkane',
    mw: 114.231,
    Tc: 568.7,
    Pc: 2.49e6,
    omega: 0.4,
    Tb: 398.82,
    pvEq: [89.5, -8150.0, -10.35, 1.3e-5, 2],
    pvTmin: 216.38,
    pvTmax: 568.7,
    rhoLEq: [0.575, 0.258, 568.7, 0.282],
    cpEq: [130.0, 425.0, 1600.0, 205.0, 780.0]
  },
  {
    id: 'n-Decane',
    name: 'n-Decane',
    formula: 'C10H22',
    cas: '124-18-5',
    family: 'Alkane',
    mw: 142.285,
    Tc: 617.7,
    Pc: 2.11e6,
    omega: 0.492,
    Tb: 447.3,
    pvEq: [99.8, -9980.0, -11.65, 1.1e-5, 2],
    pvTmin: 243.5,
    pvTmax: 617.7,
    rhoLEq: [0.465, 0.253, 617.7, 0.28],
    cpEq: [162.0, 525.0, 1610.0, 255.0, 790.0]
  },

  // --- Aromatics ---
  {
    id: 'Benzene',
    name: 'Benzene',
    formula: 'C6H6',
    cas: '71-43-2',
    family: 'Aromatic',
    mw: 78.114,
    Tc: 562.05,
    Pc: 4.895e6,
    omega: 0.21,
    Tb: 353.24,
    pvEq: [60.89, -5860.0, -6.05, 1.4e-5, 2],
    pvTmin: 278.68,
    pvTmax: 562.05,
    rhoLEq: [1.025, 0.27, 562.05, 0.285],
    cpEq: [42.0, 210.0, 1420.0, 105.0, 680.0]
  },
  {
    id: 'Toluene',
    name: 'Toluene',
    formula: 'C7H8',
    cas: '108-88-3',
    family: 'Aromatic',
    mw: 92.141,
    Tc: 591.75,
    Pc: 4.108e6,
    omega: 0.264,
    Tb: 383.78,
    pvEq: [68.45, -6720.0, -7.02, 1.3e-5, 2],
    pvTmin: 178.18,
    pvTmax: 591.75,
    rhoLEq: [0.865, 0.265, 591.75, 0.284],
    cpEq: [58.0, 260.0, 1450.0, 130.0, 700.0]
  },
  {
    id: 'p-Xylene',
    name: 'p-Xylene',
    formula: 'C8H10',
    cas: '106-42-3',
    family: 'Aromatic',
    mw: 106.167,
    Tc: 616.23,
    Pc: 3.511e6,
    omega: 0.322,
    Tb: 411.51,
    pvEq: [75.12, -7540.0, -7.95, 1.2e-5, 2],
    pvTmin: 286.41,
    pvTmax: 616.23,
    rhoLEq: [0.745, 0.26, 616.23, 0.283],
    cpEq: [74.0, 310.0, 1470.0, 155.0, 710.0]
  },

  // --- Alcohols & Water ---
  {
    id: 'Water',
    name: 'Water',
    formula: 'H2O',
    cas: '7732-18-5',
    family: 'Aqueous',
    mw: 18.015,
    Tc: 647.1,
    Pc: 22.064e6,
    omega: 0.344,
    Tb: 373.15,
    pvEq: [73.649, -7258.2, -7.3037, 4.1653e-6, 2],
    pvTmin: 273.16,
    pvTmax: 647.1,
    rhoLEq: [5.459, 0.30542, 647.13, 0.081],
    cpEq: [33.253, 0, 0, 0, 0] // 33.25 J/(mol*K)
  },
  {
    id: 'Methanol',
    name: 'Methanol',
    formula: 'CH4O',
    cas: '67-56-1',
    family: 'Alcohol',
    mw: 32.042,
    Tc: 512.6,
    Pc: 8.097e6,
    omega: 0.564,
    Tb: 337.85,
    pvEq: [81.76, -6870.0, -8.72, 1.25e-5, 2],
    pvTmin: 175.61,
    pvTmax: 512.6,
    rhoLEq: [2.288, 0.271, 512.6, 0.245],
    cpEq: [40.0, 85.0, 1600.0, 45.0, 750.0]
  },
  {
    id: 'Ethanol',
    name: 'Ethanol',
    formula: 'C2H6O',
    cas: '64-17-5',
    family: 'Alcohol',
    mw: 46.069,
    Tc: 514.0,
    Pc: 6.137e6,
    omega: 0.645,
    Tb: 351.44,
    pvEq: [73.3, -7120.0, -7.16, 8.8e-6, 2],
    pvTmin: 159.05,
    pvTmax: 514.0,
    rhoLEq: [1.628, 0.265, 514.0, 0.255],
    cpEq: [55.0, 135.0, 1580.0, 70.0, 740.0]
  },

  // --- Atmospheric & Acid Gases ---
  {
    id: 'Nitrogen',
    name: 'Nitrogen',
    formula: 'N2',
    cas: '7727-37-9',
    family: 'Gas',
    mw: 28.013,
    Tc: 126.2,
    Pc: 3.398e6,
    omega: 0.037,
    Tb: 77.36,
    pvEq: [34.02, -870.0, -2.85, 2.5e-5, 2],
    pvTmin: 63.15,
    pvTmax: 126.2,
    rhoLEq: [2.88, 0.288, 126.2, 0.292],
    cpEq: [29.1, 0.0, 0.0, 0.0, 0.0]
  },
  {
    id: 'Oxygen',
    name: 'Oxygen',
    formula: 'O2',
    cas: '7782-44-7',
    family: 'Gas',
    mw: 31.999,
    Tc: 154.58,
    Pc: 5.043e6,
    omega: 0.022,
    Tb: 90.2,
    pvEq: [35.15, -1020.0, -2.95, 2.4e-5, 2],
    pvTmin: 54.36,
    pvTmax: 154.58,
    rhoLEq: [3.35, 0.287, 154.58, 0.291],
    cpEq: [29.3, 0.0, 0.0, 0.0, 0.0]
  },
  {
    id: 'CO2',
    name: 'Carbon Dioxide',
    formula: 'CO2',
    cas: '124-38-9',
    family: 'Gas',
    mw: 44.01,
    Tc: 304.13,
    Pc: 7.377e6,
    omega: 0.224,
    Tb: 194.67,
    pvEq: [48.85, -2580.0, -4.62, 2.8e-5, 2],
    pvTmin: 216.58,
    pvTmax: 304.13,
    rhoLEq: [2.76, 0.272, 304.13, 0.29],
    cpEq: [36.0, 52.0, 1400.0, 28.0, 650.0]
  },
  {
    id: 'H2S',
    name: 'Hydrogen Sulfide',
    formula: 'H2S',
    cas: '7783-06-4',
    family: 'Gas',
    mw: 34.081,
    Tc: 373.53,
    Pc: 8.963e6,
    omega: 0.094,
    Tb: 212.84,
    pvEq: [50.2, -2950.0, -4.85, 2.6e-5, 2],
    pvTmin: 187.65,
    pvTmax: 373.53,
    rhoLEq: [2.5, 0.274, 373.53, 0.288],
    cpEq: [33.5, 25.0, 1450.0, 15.0, 700.0]
  },

  // --- Refrigerants ---
  {
    id: 'R134a',
    name: '1,1,1,2-Tetrafluoroethane',
    formula: 'C2H2F4',
    cas: '811-97-2',
    family: 'Refrigerant',
    mw: 102.032,
    Tc: 374.21,
    Pc: 4.059e6,
    omega: 0.327,
    Tb: 247.08,
    pvEq: [60.25, -4250.0, -6.45, 1.8e-5, 2],
    pvTmin: 169.85,
    pvTmax: 374.21,
    rhoLEq: [1.18, 0.278, 374.21, 0.285],
    cpEq: [75.0, 160.0, 1450.0, 80.0, 710.0]
  }
];

const THERMODYNAMIC_COMPONENT_ALIASES = Object.freeze({
  nButane: 'n-Butane',
  nPentane: 'n-Pentane',
  nHexane: 'n-Hexane'
});

function getExperimentalThermoProperties(componentNames) {
  if (!Array.isArray(componentNames) || componentNames.length === 0) {
    throw new TypeError('Request at least one test-only component property example.');
  }
  const recordsById = new Map(EXPERIMENTAL_PROPERTY_EXAMPLES.map((record) => [record.id, record]));
  return Object.fromEntries(
    componentNames.map((componentName) => {
      const recordId = THERMODYNAMIC_COMPONENT_ALIASES[componentName] || componentName;
      const record = recordsById.get(recordId);
      if (!record) throw new RangeError(`No test-only property example exists for '${componentName}'.`);
      return [
        componentName,
        {
          criticalTemperatureK: record.Tc,
          criticalPressurePa: record.Pc,
          acentricFactor: record.omega,
          molecularWeightKgPerMol: record.mw / 1000,
          provenance: {
            source: `Unverified test-only example '${record.id}'; no external source is recorded.`,
            license: 'Unreviewed test fixture; redistribution rights are not established.'
          }
        }
      ];
    })
  );
}

function getExperimentalPengRobinsonComponents(componentNames) {
  const properties = getExperimentalThermoProperties(componentNames);
  return componentNames.map((name) => {
    const record = properties[name];
    return {
      name,
      criticalTemperatureK: record.criticalTemperatureK,
      criticalPressurePa: record.criticalPressurePa,
      acentricFactor: record.acentricFactor,
      provenance: record.provenance
    };
  });
}

module.exports = {
  EXPERIMENTAL_PROPERTY_EXAMPLES,
  getExperimentalThermoProperties,
  getExperimentalPengRobinsonComponents
};
