/**
 * OmniEng Comprehensive Engineering Material Database
 * Standardized mechanical, thermal, electrical, and process properties for CAD/CAE/EDA/Plant.
 * Governing Standards: ASTM, ISO, MIL-HDBK-5J, ASME Section II Part D.
 */

const MATERIAL_DATABASE = {
  // Structural & Consumer Electronics Materials
  'Ti-6Al-4V_Grade5': {
    name: 'Titanium Grade 5 (Ti-6Al-4V Annealed)',
    category: 'Structural Metal',
    densityKgM3: 4430,
    youngsModulusGPa: 113.8,
    poissonsRatio: 0.342,
    yieldStrengthMPa: 880.0,
    ultimateStrengthMPa: 950.0,
    thermalConductivityW_mK: 6.7,
    specificHeatJ_kgK: 526,
    thermalExpansionPpmK: 8.6,
    fractureToughnessMPa_m05: 75.0,
    dampingRatio: 0.005,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 1.78e-6,
    colorHex: 0x8a9ba8
  },
  'Al_6061-T6': {
    name: 'Aluminum 6061-T6 (Aerospace Grade)',
    category: 'Structural Metal',
    densityKgM3: 2700,
    youngsModulusGPa: 68.9,
    poissonsRatio: 0.33,
    yieldStrengthMPa: 276.0,
    ultimateStrengthMPa: 310.0,
    thermalConductivityW_mK: 167.0,
    specificHeatJ_kgK: 896,
    thermalExpansionPpmK: 23.2,
    fractureToughnessMPa_m05: 29.0,
    dampingRatio: 0.008,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 3.99e-8,
    colorHex: 0xd4d8dd
  },
  'Al_7075-T6': {
    name: 'Aluminum 7075-T6 (High Strength Airframe)',
    category: 'Aerospace Metal',
    densityKgM3: 2810,
    youngsModulusGPa: 71.7,
    poissonsRatio: 0.33,
    yieldStrengthMPa: 503.0,
    ultimateStrengthMPa: 572.0,
    thermalConductivityW_mK: 130.0,
    specificHeatJ_kgK: 960,
    thermalExpansionPpmK: 23.4,
    fractureToughnessMPa_m05: 25.0,
    dampingRatio: 0.006,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 5.15e-8,
    colorHex: 0xc8cdd2
  },
  'Stainless_316L': {
    name: 'Stainless Steel AISI 316L (Austenitic)',
    category: 'Corrosion Resistant Metal',
    densityKgM3: 8000,
    youngsModulusGPa: 193.0,
    poissonsRatio: 0.30,
    yieldStrengthMPa: 290.0,
    ultimateStrengthMPa: 580.0,
    thermalConductivityW_mK: 16.3,
    specificHeatJ_kgK: 500,
    thermalExpansionPpmK: 16.0,
    fractureToughnessMPa_m05: 110.0,
    dampingRatio: 0.007,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 7.4e-7,
    colorHex: 0x9fa9b3
  },
  'Corning_GorillaGlass_Victus2': {
    name: 'Corning Gorilla Glass Victus 2 (Aluminosilicate)',
    category: 'Technical Glass',
    densityKgM3: 2480,
    youngsModulusGPa: 76.5,
    poissonsRatio: 0.22,
    yieldStrengthMPa: 110.0, // Flexural fracture strength threshold
    ultimateStrengthMPa: 160.0,
    thermalConductivityW_mK: 1.15,
    specificHeatJ_kgK: 830,
    thermalExpansionPpmK: 7.5,
    fractureToughnessMPa_m05: 0.78,
    dampingRatio: 0.002,
    relativePermittivity: 6.8,
    electricalResistivityOhmM: 1e12,
    colorHex: 0x38bdf8
  },
  'CarbonFiber_Toray_T800': {
    name: 'Toray T800 Quasi-Isotropic Carbon Fiber (3K Twill)',
    category: 'Aerospace Composite',
    densityKgM3: 1550,
    youngsModulusGPa: 135.0,
    poissonsRatio: 0.28,
    yieldStrengthMPa: 820.0,
    ultimateStrengthMPa: 1250.0,
    thermalConductivityW_mK: 4.8,
    specificHeatJ_kgK: 1100,
    thermalExpansionPpmK: 0.8,
    fractureToughnessMPa_m05: 45.0,
    dampingRatio: 0.015,
    relativePermittivity: 3.5,
    electricalResistivityOhmM: 1.5e-3,
    colorHex: 0x18181b
  },

  // Thermal Management & Heat Spreaders
  'Copper_VaporChamber_Sintered': {
    name: 'Two-Phase Sintered Copper Vapor Chamber',
    category: 'Thermal Superconductor',
    densityKgM3: 8940,
    youngsModulusGPa: 110.0,
    poissonsRatio: 0.34,
    yieldStrengthMPa: 70.0,
    ultimateStrengthMPa: 220.0,
    thermalConductivityW_mK: 45000.0, // Effective two-phase phase-change latent heat conductivity
    specificHeatJ_kgK: 385,
    thermalExpansionPpmK: 16.5,
    fractureToughnessMPa_m05: 35.0,
    dampingRatio: 0.012,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 1.68e-8,
    colorHex: 0xb45309
  },
  'Pyrolytic_Graphite_Sheet': {
    name: 'Panasonic EYG Pyrolytic Graphite Sheet (PGS)',
    category: 'Anisotropic Heat Spreader',
    densityKgM3: 2100,
    youngsModulusGPa: 4.5,
    poissonsRatio: 0.25,
    yieldStrengthMPa: 20.0,
    ultimateStrengthMPa: 40.0,
    thermalConductivityW_mK: 1950.0, // In-plane thermal conductivity
    specificHeatJ_kgK: 850,
    thermalExpansionPpmK: -1.0,
    fractureToughnessMPa_m05: 1.2,
    dampingRatio: 0.025,
    relativePermittivity: 10.0,
    electricalResistivityOhmM: 1e-6,
    colorHex: 0x27272a
  },

  // Semiconductor & EDA Substrates
  'Silicon_SingleCrystal_100': {
    name: 'Single Crystal Silicon (100) Wafer Substrate',
    category: 'Semiconductor',
    densityKgM3: 2329,
    youngsModulusGPa: 165.0,
    poissonsRatio: 0.22,
    yieldStrengthMPa: 7000.0, // Theoretical brittle fracture
    ultimateStrengthMPa: 7000.0,
    thermalConductivityW_mK: 148.0,
    specificHeatJ_kgK: 712,
    thermalExpansionPpmK: 2.6,
    fractureToughnessMPa_m05: 0.95,
    dampingRatio: 0.001,
    relativePermittivity: 11.68,
    electricalResistivityOhmM: 2.3e3,
    colorHex: 0x475569
  },
  'Copper_Interconnect_M1_M8': {
    name: 'Electroplated Copper Interconnect (Dual Damascene)',
    category: 'Metal Conductor',
    densityKgM3: 8960,
    youngsModulusGPa: 117.0,
    poissonsRatio: 0.34,
    yieldStrengthMPa: 220.0,
    ultimateStrengthMPa: 340.0,
    thermalConductivityW_mK: 398.0,
    specificHeatJ_kgK: 385,
    thermalExpansionPpmK: 16.5,
    fractureToughnessMPa_m05: 35.0,
    dampingRatio: 0.005,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 1.72e-8,
    colorHex: 0x38bdf8
  },

  // Piping & Process Infrastructure (ASME B31.3)
  'ASTM_A106_GradeB': {
    name: 'Carbon Steel ASTM A106 Grade B (Seamless)',
    category: 'Piping Steel',
    densityKgM3: 7850,
    youngsModulusGPa: 200.0,
    poissonsRatio: 0.29,
    yieldStrengthMPa: 240.0,
    ultimateStrengthMPa: 415.0,
    allowableStressASME_MPa: 138.0, // Sh at 100°C per ASME B31.3 Table A-1
    thermalConductivityW_mK: 48.0,
    specificHeatJ_kgK: 460,
    thermalExpansionPpmK: 12.5,
    fractureToughnessMPa_m05: 65.0,
    dampingRatio: 0.010,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 1.7e-7,
    colorHex: 0x4b5563
  },
  'Inconel_625': {
    name: 'Inconel 625 Nickel-Chromium Superalloy (UNS N06625)',
    category: 'High-Temperature Superalloy',
    densityKgM3: 8440,
    youngsModulusGPa: 207.0,
    poissonsRatio: 0.31,
    yieldStrengthMPa: 415.0,
    ultimateStrengthMPa: 827.0,
    allowableStressASME_MPa: 184.0,
    thermalConductivityW_mK: 9.8,
    specificHeatJ_kgK: 410,
    thermalExpansionPpmK: 12.8,
    fractureToughnessMPa_m05: 120.0,
    dampingRatio: 0.008,
    relativePermittivity: 1.0,
    electricalResistivityOhmM: 1.29e-6,
    colorHex: 0x6b7280
  },

  // Precision Optical Glass & Crystal (Schott / Ohara / Corning)
  'Schott_NBK7': {
    name: 'Schott N-BK7 Precision Borosilicate Crown Glass',
    category: 'Optical Crown Glass',
    densityKgM3: 2510,
    youngsModulusGPa: 82.0,
    poissonsRatio: 0.206,
    yieldStrengthMPa: 65.0,
    ultimateStrengthMPa: 95.0,
    refractiveIndex_nd: 1.5168,
    abbeNumber_Vd: 64.17,
    thermalConductivityW_mK: 1.114,
    specificHeatJ_kgK: 858,
    thermalExpansionPpmK: 7.1,
    fractureToughnessMPa_m05: 0.85,
    dampingRatio: 0.002,
    relativePermittivity: 6.7,
    electricalResistivityOhmM: 1e11,
    colorHex: 0x38bdf8
  },
  'Schott_NSF11': {
    name: 'Schott N-SF11 Dense Flint Glass (High Chromatic Dispersion)',
    category: 'Optical Flint Glass',
    densityKgM3: 3220,
    youngsModulusGPa: 65.0,
    poissonsRatio: 0.23,
    yieldStrengthMPa: 55.0,
    ultimateStrengthMPa: 80.0,
    refractiveIndex_nd: 1.7847,
    abbeNumber_Vd: 25.76,
    thermalConductivityW_mK: 0.82,
    specificHeatJ_kgK: 630,
    thermalExpansionPpmK: 8.6,
    fractureToughnessMPa_m05: 0.65,
    dampingRatio: 0.002,
    relativePermittivity: 8.2,
    electricalResistivityOhmM: 1e10,
    colorHex: 0xa855f7
  },
  'OpticalFluorite_CaF2': {
    name: 'Single-Crystal Calcium Fluoride (CaF2 Fluorite ED Lens)',
    category: 'Optical Single Crystal',
    densityKgM3: 3180,
    youngsModulusGPa: 75.8,
    poissonsRatio: 0.26,
    yieldStrengthMPa: 36.0,
    ultimateStrengthMPa: 50.0,
    refractiveIndex_nd: 1.4338,
    abbeNumber_Vd: 95.3,
    thermalConductivityW_mK: 9.71,
    specificHeatJ_kgK: 854,
    thermalExpansionPpmK: 18.8,
    fractureToughnessMPa_m05: 0.45,
    dampingRatio: 0.001,
    relativePermittivity: 6.8,
    electricalResistivityOhmM: 1e14,
    colorHex: 0x22d3ee
  }
};

class MaterialManager {
  static getMaterial(key) {
    return MATERIAL_DATABASE[key] || MATERIAL_DATABASE['Ti-6Al-4V_Grade5'];
  }

  static listAllMaterials() {
    return Object.keys(MATERIAL_DATABASE).map(k => ({
      key: k,
      ...MATERIAL_DATABASE[k]
    }));
  }

  /**
   * Computes Mass, Center of Gravity, and Moment of Inertia for a rectangular cuboid
   */
  static computeInertiaCuboid(matKey, widthM, heightM, depthM) {
    const mat = this.getMaterial(matKey);
    const volumeM3 = widthM * heightM * depthM;
    const massKg = volumeM3 * mat.densityKgM3;

    // Moments of inertia about centroidal principal axes:
    // I_xx = (1/12) * M * (h^2 + d^2)
    // I_yy = (1/12) * M * (w^2 + d^2)
    // I_zz = (1/12) * M * (w^2 + h^2)
    const Ixx = (1 / 12) * massKg * (heightM * heightM + depthM * depthM);
    const Iyy = (1 / 12) * massKg * (widthM * widthM + depthM * depthM);
    const Izz = (1 / 12) * massKg * (widthM * widthM + heightM * heightM);

    return {
      materialName: mat.name,
      massKg: Number(massKg.toFixed(4)),
      volumeCm3: Number((volumeM3 * 1e6).toFixed(2)),
      densityKgM3: mat.densityKgM3,
      Ixx: Number(Ixx.toExponential(4)),
      Iyy: Number(Iyy.toExponential(4)),
      Izz: Number(Izz.toExponential(4)),
      yieldStrengthMPa: mat.yieldStrengthMPa,
      thermalConductivityW_mK: mat.thermalConductivityW_mK
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MATERIAL_DATABASE, MaterialManager };
}
