'use strict';

/** Test-only legacy optical examples. Values have not completed source, applicability, or redistribution review. */
const examples = {
  opticalGlassExamples: [
    {
      name: 'N-BK7',
      supplier: 'Schott',
      type: 'Crown',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [1.03961212, 0.231792344, 1.01046945],
      C: [0.00600069867, 0.0200179144, 103.560653],
      density: 2.51,
      thermalExpansion: 0.0000071,
      dndTPerK: 0.000003,
      dataStatus: 'experimental',
      provenance: {
        source: 'SCHOTT N-BK7 optical glass datasheet',
        sourceUrl: 'https://www.schott.com/shop/medias/schott-datasheet-n-bk7-eng.pdf',
        redistributionLicenseStatus: 'not reviewed'
      }
    },
    {
      name: 'F_SILICA',
      supplier: 'Corning',
      type: 'Fused Silica',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [0.6961663, 0.4079426, 0.8974794],
      C: [0.004679148, 0.013512063, 97.9340025],
      density: 2.2,
      thermalExpansion: 5.2e-7,
      dndTPerK: 0.00001,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'N-SF11',
      supplier: 'Schott',
      type: 'Flint',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [1.73759695, 0.313747346, 1.89878101],
      C: [0.013188707, 0.0623068142, 155.23629],
      density: 3.22,
      thermalExpansion: 0.0000076,
      dndTPerK: 0.0000085,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'N-SF5',
      supplier: 'Schott',
      type: 'Flint',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [1.52481889, 0.187085527, 1.42729015],
      C: [0.0112547545, 0.0588995306, 129.141675],
      density: 2.86,
      thermalExpansion: 0.0000082,
      dndTPerK: 0.0000052,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'N-SK16',
      supplier: 'Schott',
      type: 'Dense Crown',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [1.32796058, 0.203878418, 0.835605694],
      C: [0.00762403336, 0.0312155703, 85.3475995],
      density: 3.58,
      thermalExpansion: 0.0000063,
      dndTPerK: 0.0000041,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'N-FK51A',
      supplier: 'Schott',
      type: 'Fluorite Crown',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [0.971247817, 0.216901417, 0.904651666],
      C: [0.00472301995, 0.0153575612, 168.68133],
      density: 3.76,
      thermalExpansion: 0.0000134,
      dndTPerK: -0.0000057,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'N-BAF10',
      supplier: 'Schott',
      type: 'Barium Flint',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [1.5851495, 0.143559385, 1.08521269],
      C: [0.00926681282, 0.0424489805, 105.613573],
      density: 3.77,
      thermalExpansion: 0.0000068,
      dndTPerK: 0.0000038,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'S-FPL51',
      supplier: 'Ohara',
      type: 'Extra-Low Dispersion',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [0.965416, 0.213946, 0.892461],
      C: [0.004689, 0.015219, 165.234],
      density: 3.75,
      thermalExpansion: 0.000013,
      dndTPerK: -0.0000059,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'H-K9L',
      supplier: 'CDGM',
      type: 'Crown',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [1.03961212, 0.231792344, 1.01046945],
      C: [0.00600069867, 0.0200179144, 103.560653],
      density: 2.51,
      thermalExpansion: 0.0000071,
      dndTPerK: 0.000003,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'CAF2',
      supplier: 'Schott',
      type: 'Crystal',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [0.5675888, 0.4710914, 3.8484723],
      C: [0.00252642999, 0.0100783328, 1200.556],
      density: 3.18,
      thermalExpansion: 0.0000188,
      dndTPerK: -0.0000085,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'SAPPHIRE',
      supplier: 'Crystal',
      type: 'Anisotropic Crystal',
      formula: 'sellmeier1',
      referenceTemperatureC: 20.0,
      B: [1.4313493, 0.65054713, 5.3414021],
      C: [0.0052799261, 0.0142382647, 325.017834],
      density: 3.98,
      thermalExpansion: 0.0000053,
      dndTPerK: 0.000013,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'CALCITE',
      supplier: 'Crystal',
      type: 'Uniaxial Birefringent Crystal',
      formula: 'birefringent',
      referenceTemperatureC: 20.0,
      no: 1.658,
      ne: 1.486,
      birefringence: -0.172,
      density: 2.71,
      thermalExpansion: 0.0000243,
      dndTPerK: -0.000012,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'QUARTZ',
      supplier: 'Crystal',
      type: 'Uniaxial Birefringent Crystal',
      formula: 'birefringent',
      referenceTemperatureC: 20.0,
      no: 1.544,
      ne: 1.553,
      birefringence: 0.009,
      density: 2.65,
      thermalExpansion: 0.0000071,
      dndTPerK: -0.0000055,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'YVO4',
      supplier: 'Crystal',
      type: 'Uniaxial Birefringent Crystal',
      formula: 'birefringent',
      referenceTemperatureC: 20.0,
      no: 1.957,
      ne: 2.165,
      birefringence: 0.208,
      density: 4.22,
      thermalExpansion: 0.0000044,
      dndTPerK: 0.0000085,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    },
    {
      name: 'MGF2',
      supplier: 'Crystal',
      type: 'Uniaxial Birefringent Crystal',
      formula: 'birefringent',
      referenceTemperatureC: 20.0,
      no: 1.378,
      ne: 1.39,
      birefringence: 0.012,
      density: 3.15,
      thermalExpansion: 0.0000137,
      dndTPerK: 0.0000011,
      dataStatus: 'experimental',
      provenance: {
        source: null,
        sourceUrl: null,
        redistributionLicenseStatus: 'unverified'
      }
    }
  ],
  sellmeierExamples: {
    Schott_NBK7: {
      name: 'Schott N-BK7 Standard Borosilicate Crown',
      category: 'Crown',
      B1: 1.03961212,
      B2: 0.231792344,
      B3: 1.01046945,
      C1: 0.00600069867,
      C2: 0.0200179144,
      C3: 103.560653,
      nominal_nd: 1.5168,
      nominal_Vd: 64.17
    },
    Schott_NSF11: {
      name: 'Schott N-SF11 Dense Flint',
      category: 'Flint',
      B1: 1.73759695,
      B2: 0.313747346,
      B3: 1.89878101,
      C1: 0.013188707,
      C2: 0.0623068142,
      C3: 155.23629,
      nominal_nd: 1.78472,
      nominal_Vd: 25.76
    },
    Schott_NLAK9: {
      name: 'Schott N-LAK9 Lanthanum Crown',
      category: 'Lanthanum Crown',
      B1: 1.57945041,
      B2: 0.283151977,
      B3: 1.02636254,
      C1: 0.00780287413,
      C2: 0.0286884841,
      C3: 86.8180327,
      nominal_nd: 1.691,
      nominal_Vd: 54.71
    },
    Schott_F2: {
      name: 'Schott F2 Classical Optical Flint',
      category: 'Flint',
      B1: 1.34533359,
      B2: 0.209073176,
      B3: 0.93735716,
      C1: 0.00997743871,
      C2: 0.0470450767,
      C3: 111.886764,
      nominal_nd: 1.62004,
      nominal_Vd: 36.37
    },
    Fused_Silica: {
      name: 'Synthetic Fused Silica (Corning 7980)',
      category: 'Fused Silica',
      B1: 0.6961663,
      B2: 0.4079426,
      B3: 0.8974794,
      C1: 0.004679148,
      C2: 0.01351206,
      C3: 97.934,
      nominal_nd: 1.45846,
      nominal_Vd: 67.82
    },
    OpticalFluorite_CaF2: {
      name: 'Single Crystal Calcium Fluoride (CaF2)',
      category: 'Fluorite',
      B1: 0.5675888,
      B2: 0.4710914,
      B3: 3.8484723,
      C1: 0.00252643,
      C2: 0.01007833,
      C3: 1200.556,
      nominal_nd: 1.43384,
      nominal_Vd: 95.34
    },
    PMMA_Acrylic: {
      name: 'Poly(methyl methacrylate) Optical Grade',
      category: 'Optical Polymer',
      B1: 1.1819,
      B2: 0.029,
      B3: 0.02,
      C1: 0.0105,
      C2: 0.021,
      C3: 100,
      nominal_nd: 1.4917,
      nominal_Vd: 57.4
    },
    Polycarbonate_Optical: {
      name: 'Optical Grade Polycarbonate (PC)',
      category: 'Optical Polymer',
      B1: 1.4182,
      B2: 0.1796,
      B3: 0.5,
      C1: 0.0213,
      C2: 0.052,
      C3: 120,
      nominal_nd: 1.5855,
      nominal_Vd: 30.3
    },
    Air: {
      name: 'Dry Atmospheric Air at 1 atm, 20°C',
      category: 'Gas',
      B1: 0,
      B2: 0,
      B3: 0,
      C1: 1,
      C2: 1,
      C3: 1,
      nominal_nd: 1.000277,
      nominal_Vd: 89330
    }
  },
  glassAliases: {
    'N-BK7': 'Schott_NBK7',
    NBK7: 'Schott_NBK7',
    'N-SF11': 'Schott_NSF11',
    NSF11: 'Schott_NSF11',
    'N-LAK9': 'Schott_NLAK9',
    NLAK9: 'Schott_NLAK9',
    F2: 'Schott_F2',
    FusedSilica: 'Fused_Silica',
    CaF2: 'OpticalFluorite_CaF2',
    PMMA: 'PMMA_Acrylic',
    Polycarbonate: 'Polycarbonate_Optical'
  },
  illustrativePrescription: {
    focalLengthMm: 50,
    nominalFStop: 1.4,
    designAperture: 1.4,
    designWavelengthNm: 550,
    sensorFormat: 'FullFrame_35mm',
    sensorWidthMm: 36,
    sensorHeightMm: 24,
    flangeFocalDistanceMm: 44,
    groups: [1, 2, 3, 4, 5, 6],
    elements: [
      {
        id: 'E1_FrontAsphere',
        name: 'Front Spherical Meniscus Element',
        group: 1,
        glassKey: 'Schott_NBK7',
        refractiveIndex: 1.5168,
        refractiveIndex_nd: 1.5168,
        abbeNumber: 64.17,
        abbeNumber_Vd: 64.17,
        radiusFrontMm: 42.5,
        radiusRearMm: 110,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 7.8,
        thicknessMm: 7.8,
        diameterMm: 48,
        clearApertureMm: 48,
        zPosMm: 0,
        colorHex: 3718648
      },
      {
        id: 'E2_ThickMeniscus',
        name: 'Positive Meniscus Crown Element',
        group: 2,
        glassKey: 'Schott_NBK7',
        refractiveIndex: 1.5168,
        refractiveIndex_nd: 1.5168,
        abbeNumber: 64.17,
        abbeNumber_Vd: 64.17,
        radiusFrontMm: 28,
        radiusRearMm: 54,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 6.2,
        thicknessMm: 6.2,
        diameterMm: 42,
        clearApertureMm: 42,
        zPosMm: 10.5,
        colorHex: 6333946
      },
      {
        id: 'E3_AchromatCrown',
        name: 'Achromatic Doublet Crown Element (Low Dispersion)',
        group: 3,
        glassKey: 'OpticalFluorite_CaF2',
        refractiveIndex: 1.4338,
        refractiveIndex_nd: 1.4338,
        abbeNumber: 95.3,
        abbeNumber_Vd: 95.3,
        radiusFrontMm: 48,
        radiusRearMm: -24.5,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 4.8,
        thicknessMm: 4.8,
        diameterMm: 36,
        clearApertureMm: 36,
        zPosMm: 19,
        colorHex: 10980346
      },
      {
        id: 'E4_AchromatFlint',
        name: 'Achromatic Doublet Flint Element (Dense Flint Dispersion)',
        group: 3,
        glassKey: 'Schott_NSF11',
        refractiveIndex: 1.7847,
        refractiveIndex_nd: 1.7847,
        abbeNumber: 25.76,
        abbeNumber_Vd: 25.76,
        radiusFrontMm: -24.5,
        radiusRearMm: 32,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 2.2,
        thicknessMm: 2.2,
        diameterMm: 36,
        clearApertureMm: 36,
        zPosMm: 23.8,
        colorHex: 12616956
      },
      {
        id: 'E5_VariatorNegative',
        name: 'Autofocus Variator Biconcave Element',
        group: 4,
        glassKey: 'Schott_NSF11',
        refractiveIndex: 1.7847,
        refractiveIndex_nd: 1.7847,
        abbeNumber: 25.76,
        abbeNumber_Vd: 25.76,
        radiusFrontMm: -35,
        radiusRearMm: 28,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 2.8,
        thicknessMm: 2.8,
        diameterMm: 32,
        clearApertureMm: 32,
        zPosMm: 33,
        colorHex: 8490232
      },
      {
        id: 'E6_VariatorPositive',
        name: 'Biconvex Rear Master Element',
        group: 5,
        glassKey: 'Schott_NBK7',
        refractiveIndex: 1.5168,
        refractiveIndex_nd: 1.5168,
        abbeNumber: 64.17,
        abbeNumber_Vd: 64.17,
        radiusFrontMm: 36,
        radiusRearMm: -42,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 5.4,
        thicknessMm: 5.4,
        diameterMm: 34,
        clearApertureMm: 34,
        zPosMm: 38.5,
        colorHex: 3718648
      },
      {
        id: 'E7_RearDoubletCrown',
        name: 'Rear Field Flattener Crown Element',
        group: 6,
        glassKey: 'Schott_NBK7',
        refractiveIndex: 1.5168,
        refractiveIndex_nd: 1.5168,
        abbeNumber: 64.17,
        abbeNumber_Vd: 64.17,
        radiusFrontMm: 55,
        radiusRearMm: -30,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 4.2,
        thicknessMm: 4.2,
        diameterMm: 36,
        clearApertureMm: 36,
        zPosMm: 46.5,
        colorHex: 3003583
      },
      {
        id: 'E8_RearDoubletFlint',
        name: 'Rear High-Index Correcting Flint Element',
        group: 6,
        glassKey: 'Schott_NSF11',
        refractiveIndex: 1.7847,
        refractiveIndex_nd: 1.7847,
        abbeNumber: 25.76,
        abbeNumber_Vd: 25.76,
        radiusFrontMm: -30,
        radiusRearMm: -85,
        conicFront: 0,
        conicRear: 0,
        asphericCoeffsFront: [0, 0, 0, 0],
        asphericCoeffsRear: [0, 0, 0, 0],
        centerThicknessMm: 2.6,
        thicknessMm: 2.6,
        diameterMm: 36,
        clearApertureMm: 36,
        zPosMm: 50.7,
        colorHex: 3462041
      }
    ]
  },
  thermalGlassExamples: {
    'N-BK7': {
      D0: 0.00000186,
      D1: 1.31e-8,
      D2: -1.37e-11,
      E0: 4.34e-7,
      E1: 6.27e-10,
      lambdaTk: 0.17,
      cte: 0.0000071
    },
    'N-SF11': {
      D0: 0.00000421,
      D1: 1.54e-8,
      D2: -1.82e-11,
      E0: 9.85e-7,
      E1: 1.25e-9,
      lambdaTk: 0.215,
      cte: 0.0000086
    },
    'N-LAK9': {
      D0: 0.00000245,
      D1: 1.12e-8,
      D2: -1.15e-11,
      E0: 5.6e-7,
      E1: 7.1e-10,
      lambdaTk: 0.185,
      cte: 0.0000063
    },
    FUSED_SILICA: {
      D0: 0.00001,
      D1: 1.45e-8,
      D2: -5e-12,
      E0: 0.00000115,
      E1: 1.05e-9,
      lambdaTk: 0.16,
      cte: 5.2e-7
    }
  },
  housingCteExamples: {
    ALUMINUM_6061: 0.0000231,
    STAINLESS_304: 0.000016,
    TITANIUM_TI6AL4V: 0.0000086,
    INVAR_36: 0.0000012
  }
};

const vacuum = Object.freeze({ nd: 1, nF: 1, nC: 1 });
examples.illustrativePrescription.objectSpaceMaterial = vacuum;
examples.illustrativePrescription.gapMaterial = vacuum;
examples.illustrativePrescription.imageSpaceMaterial = vacuum;
for (const element of examples.illustrativePrescription.elements) {
  element.opticalMaterial = examples.sellmeierExamples[element.glassKey];
  element.cementedToNext = ['E3_AchromatCrown', 'E7_RearDoubletCrown'].includes(element.id);
}

module.exports = examples;
