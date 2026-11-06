/**
 * ASME Section II Part D & ASME B31.3 / B31.1 / B31.4 / B31.8 / B31.12
 * Material Allowable Stress, Physical Properties & Temperature Derating Catalog.
 *
 * Implements:
 * 1. Maximum allowable stresses S(T) [MPa] per ASME Section II Part D Table 1A & 1B.
 * 2. Minimum yield strength Sy(T) and ultimate tensile strength Su(T).
 * 3. Elastic modulus E(T) [GPa] and mean coefficient of thermal expansion alpha(T) [1e-6 / K].
 * 4. Weld joint quality factors E per ASME B31.3 Table A-1B.
 * 5. Linear / spline temperature interpolation with bounds checking and code upper limits.
 */

'use strict';

// claims:evidence:ASME-Section-II-Part-D

/**
 * @typedef {Object} MaterialStressRecord
 * @property {string} id - Material designation / ASTM specification
 * @property {string} uns - UNS number if applicable
 * @property {string} nominalComposition - Nominal alloy chemistry description
 * @property {string} productForm - Pipe, tube, plate, forging, fitting
 * @property {string} pNumber - ASME P-Number and Group Number (e.g. 'P-No 1 Gr 1')
 * @property {number} minTensileMPa - Minimum specified tensile strength at ambient (MPa)
 * @property {number} minYieldMPa - Minimum specified yield strength at ambient (MPa)
 * @property {number} maxTempC - Maximum code permissible operating temperature (°C)
 * @property {number} minTempC - Minimum design metal temperature MDMT without impact test (°C)
 * @property {number} defaultJointEfficiency - Default longitudinal joint factor E
 * @property {Array<{tempC: number, allowableStressMPa: number, yieldStrengthMPa: number}>} tempDerating
 * @property {Array<{tempC: number, elasticModulusGPa: number, thermalExpansionCoeff: number}>} physicalProps
 */

/** @type {Record<string, MaterialStressRecord>} */
const ASME_MATERIAL_CATALOG = {
  // -------------------------------------------------------------
  // CARBON STEELS & LOW-TEMPERATURE CARBON STEEL (SEAMLESS & WELDED)
  // -------------------------------------------------------------
  'A106-B': {
    id: 'A106-B',
    uns: 'K03006',
    nominalComposition: 'Carbon Steel (C-Si)',
    productForm: 'Seamless Pipe',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 240.0,
    minTempC: -29.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 226.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 208.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 198.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 184.0 },
      { tempC: 343, allowableStressMPa: 126.0, yieldStrengthMPa: 176.0 },
      { tempC: 371, allowableStressMPa: 120.0, yieldStrengthMPa: 168.0 },
      { tempC: 399, allowableStressMPa: 107.0, yieldStrengthMPa: 160.0 },
      { tempC: 427, allowableStressMPa: 83.0, yieldStrengthMPa: 151.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 100, elasticModulusGPa: 199.0, thermalExpansionCoeff: 12.1 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 },
      { tempC: 300, elasticModulusGPa: 185.0, thermalExpansionCoeff: 13.6 },
      { tempC: 400, elasticModulusGPa: 176.0, thermalExpansionCoeff: 14.3 }
    ]
  },
  'A53-B': {
    id: 'A53-B',
    uns: 'K03005',
    nominalComposition: 'Carbon Steel (ERW / Seamless)',
    productForm: 'Welded or Seamless Pipe',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 240.0,
    minTempC: -29.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 0.85,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 226.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 208.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 198.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 184.0 },
      { tempC: 371, allowableStressMPa: 120.0, yieldStrengthMPa: 168.0 },
      { tempC: 427, allowableStressMPa: 83.0, yieldStrengthMPa: 151.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 },
      { tempC: 400, elasticModulusGPa: 176.0, thermalExpansionCoeff: 14.3 }
    ]
  },
  'A333-6': {
    id: 'A333-6',
    uns: 'K03022',
    nominalComposition: 'LTCS (Low Temperature Carbon Steel)',
    productForm: 'Seamless & Welded Pipe for Low Temp',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 240.0,
    minTempC: -46.0,
    maxTempC: 343.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -46, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 226.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 208.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 198.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 184.0 },
      { tempC: 343, allowableStressMPa: 126.0, yieldStrengthMPa: 176.0 }
    ],
    physicalProps: [
      { tempC: -50, elasticModulusGPa: 207.0, thermalExpansionCoeff: 10.9 },
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 150, elasticModulusGPa: 196.0, thermalExpansionCoeff: 12.5 },
      { tempC: 300, elasticModulusGPa: 185.0, thermalExpansionCoeff: 13.6 }
    ]
  },
  'API-5L-X65': {
    id: 'API-5L-X65',
    uns: 'K03014',
    nominalComposition: 'High-Strength Pipeline Steel (PSL2)',
    productForm: 'Seamless / DSAW Pipe',
    pNumber: 'P-No 1 Gr 3',
    minTensileMPa: 535.0,
    minYieldMPa: 450.0,
    minTempC: -29.0,
    maxTempC: 204.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 178.0, yieldStrengthMPa: 450.0 },
      { tempC: 38, allowableStressMPa: 178.0, yieldStrengthMPa: 450.0 },
      { tempC: 93, allowableStressMPa: 178.0, yieldStrengthMPa: 435.0 },
      { tempC: 149, allowableStressMPa: 178.0, yieldStrengthMPa: 420.0 },
      { tempC: 204, allowableStressMPa: 175.0, yieldStrengthMPa: 405.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 205.0, thermalExpansionCoeff: 11.6 },
      { tempC: 100, elasticModulusGPa: 200.0, thermalExpansionCoeff: 12.2 },
      { tempC: 200, elasticModulusGPa: 194.0, thermalExpansionCoeff: 13.0 }
    ]
  },
  'API-5L-B': {
    id: 'API-5L-B',
    uns: 'K03014',
    nominalComposition: 'Carbon Steel Pipeline Grade B',
    productForm: 'Seamless / ERW Pipe',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 245.0,
    minTempC: -29.0,
    maxTempC: 204.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 245.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 245.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 232.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 220.0 },
      { tempC: 204, allowableStressMPa: 135.0, yieldStrengthMPa: 210.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 100, elasticModulusGPa: 199.0, thermalExpansionCoeff: 12.1 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 }
    ]
  },
  'API-5L-X52': {
    id: 'API-5L-X52',
    uns: 'K03014',
    nominalComposition: 'Pipeline Steel Grade X52',
    productForm: 'Seamless / DSAW Pipe',
    pNumber: 'P-No 1 Gr 2',
    minTensileMPa: 460.0,
    minYieldMPa: 360.0,
    minTempC: -29.0,
    maxTempC: 204.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 153.0, yieldStrengthMPa: 360.0 },
      { tempC: 38, allowableStressMPa: 153.0, yieldStrengthMPa: 360.0 },
      { tempC: 93, allowableStressMPa: 153.0, yieldStrengthMPa: 345.0 },
      { tempC: 149, allowableStressMPa: 153.0, yieldStrengthMPa: 330.0 },
      { tempC: 204, allowableStressMPa: 150.0, yieldStrengthMPa: 315.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 204.0, thermalExpansionCoeff: 11.5 },
      { tempC: 100, elasticModulusGPa: 199.0, thermalExpansionCoeff: 12.2 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 }
    ]
  },
  'API-5L-X70': {
    id: 'API-5L-X70',
    uns: 'K03014',
    nominalComposition: 'High-Strength Pipeline Steel Grade X70',
    productForm: 'Seamless / DSAW Pipe',
    pNumber: 'P-No 1 Gr 4',
    minTensileMPa: 570.0,
    minYieldMPa: 485.0,
    minTempC: -29.0,
    maxTempC: 204.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 190.0, yieldStrengthMPa: 485.0 },
      { tempC: 38, allowableStressMPa: 190.0, yieldStrengthMPa: 485.0 },
      { tempC: 93, allowableStressMPa: 190.0, yieldStrengthMPa: 465.0 },
      { tempC: 149, allowableStressMPa: 190.0, yieldStrengthMPa: 450.0 },
      { tempC: 204, allowableStressMPa: 185.0, yieldStrengthMPa: 435.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 205.0, thermalExpansionCoeff: 11.6 },
      { tempC: 100, elasticModulusGPa: 200.0, thermalExpansionCoeff: 12.2 },
      { tempC: 200, elasticModulusGPa: 194.0, thermalExpansionCoeff: 13.0 }
    ]
  },
  'A671-CC60': {
    id: 'A671-CC60',
    uns: 'K02100',
    nominalComposition: 'C-Mn-Si Electric-Fusion-Welded Pipe',
    productForm: 'EFW Pipe for Atmospheric / Low Temp',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 220.0,
    minTempC: -29.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 220.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 220.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 207.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 190.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 168.0 },
      { tempC: 427, allowableStressMPa: 83.0, yieldStrengthMPa: 138.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 },
      { tempC: 400, elasticModulusGPa: 176.0, thermalExpansionCoeff: 14.3 }
    ]
  },

  // -------------------------------------------------------------
  // CARBON STEEL & LTCS FITTINGS, FORGINGS & PLATES
  // -------------------------------------------------------------
  'A234-WPB': {
    id: 'A234-WPB',
    uns: 'K03006',
    nominalComposition: 'Wrought Carbon Steel (C-Si)',
    productForm: 'Piping Fitting (Elbow, Tee, Reducer)',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 240.0,
    minTempC: -29.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 226.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 208.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 198.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 184.0 },
      { tempC: 371, allowableStressMPa: 120.0, yieldStrengthMPa: 168.0 },
      { tempC: 427, allowableStressMPa: 83.0, yieldStrengthMPa: 151.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 },
      { tempC: 400, elasticModulusGPa: 176.0, thermalExpansionCoeff: 14.3 }
    ]
  },
  'A420-WPL6': {
    id: 'A420-WPL6',
    uns: 'K03022',
    nominalComposition: 'Wrought LTCS Fitting',
    productForm: 'Piping Fitting for Low Temp (-46 °C)',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 240.0,
    minTempC: -46.0,
    maxTempC: 343.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -46, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 226.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 208.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 198.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 184.0 },
      { tempC: 343, allowableStressMPa: 126.0, yieldStrengthMPa: 176.0 }
    ],
    physicalProps: [
      { tempC: -50, elasticModulusGPa: 207.0, thermalExpansionCoeff: 10.9 },
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 }
    ]
  },
  'A105': {
    id: 'A105',
    uns: 'K03504',
    nominalComposition: 'Forged Carbon Steel',
    productForm: 'Piping Forging / Flange',
    pNumber: 'P-No 1 Gr 2',
    minTensileMPa: 485.0,
    minYieldMPa: 250.0,
    minTempC: -29.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 250.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 250.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 235.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 225.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 205.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 191.0 },
      { tempC: 371, allowableStressMPa: 120.0, yieldStrengthMPa: 175.0 },
      { tempC: 427, allowableStressMPa: 83.0, yieldStrengthMPa: 157.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 },
      { tempC: 400, elasticModulusGPa: 176.0, thermalExpansionCoeff: 14.3 }
    ]
  },
  'A350-LF2': {
    id: 'A350-LF2',
    uns: 'K03011',
    nominalComposition: 'Forged LTCS Grade LF2 Class 1',
    productForm: 'Low Temp Forging / Flange (-46 °C)',
    pNumber: 'P-No 1 Gr 2',
    minTensileMPa: 485.0,
    minYieldMPa: 250.0,
    minTempC: -46.0,
    maxTempC: 343.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -46, allowableStressMPa: 138.0, yieldStrengthMPa: 250.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 250.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 235.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 225.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 205.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 191.0 },
      { tempC: 343, allowableStressMPa: 126.0, yieldStrengthMPa: 183.0 }
    ],
    physicalProps: [
      { tempC: -50, elasticModulusGPa: 207.0, thermalExpansionCoeff: 10.9 },
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 }
    ]
  },
  'A350-LF3': {
    id: 'A350-LF3',
    uns: 'K32025',
    nominalComposition: '3.5% Nickel Forging Grade LF3 Class 1',
    productForm: 'Cryogenic Forging / Flange (-101 °C)',
    pNumber: 'P-No 9B Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 260.0,
    minTempC: -101.0,
    maxTempC: 343.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -101, allowableStressMPa: 138.0, yieldStrengthMPa: 260.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 260.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 245.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 235.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 226.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 215.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 201.0 },
      { tempC: 343, allowableStressMPa: 126.0, yieldStrengthMPa: 192.0 }
    ],
    physicalProps: [
      { tempC: -100, elasticModulusGPa: 206.0, thermalExpansionCoeff: 10.1 },
      { tempC: 20, elasticModulusGPa: 201.0, thermalExpansionCoeff: 11.2 },
      { tempC: 200, elasticModulusGPa: 191.0, thermalExpansionCoeff: 12.4 }
    ]
  },
  'A516-GR70': {
    id: 'A516-GR70',
    uns: 'K02700',
    nominalComposition: 'Carbon Steel Plate for Pressure Vessels',
    productForm: 'Plate',
    pNumber: 'P-No 1 Gr 2',
    minTensileMPa: 485.0,
    minYieldMPa: 260.0,
    minTempC: -46.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -46, allowableStressMPa: 138.0, yieldStrengthMPa: 260.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 260.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 245.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 234.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 225.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 215.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 200.0 },
      { tempC: 371, allowableStressMPa: 120.0, yieldStrengthMPa: 182.0 },
      { tempC: 427, allowableStressMPa: 83.0, yieldStrengthMPa: 163.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 },
      { tempC: 400, elasticModulusGPa: 176.0, thermalExpansionCoeff: 14.3 }
    ]
  },
  'A516-GR60': {
    id: 'A516-GR60',
    uns: 'K02100',
    nominalComposition: 'Carbon Steel Plate Grade 60',
    productForm: 'Pressure Vessel Plate',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 220.0,
    minTempC: -46.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -46, allowableStressMPa: 118.0, yieldStrengthMPa: 220.0 },
      { tempC: 38, allowableStressMPa: 118.0, yieldStrengthMPa: 220.0 },
      { tempC: 93, allowableStressMPa: 118.0, yieldStrengthMPa: 207.0 },
      { tempC: 204, allowableStressMPa: 118.0, yieldStrengthMPa: 190.0 },
      { tempC: 316, allowableStressMPa: 112.0, yieldStrengthMPa: 168.0 },
      { tempC: 427, allowableStressMPa: 71.0, yieldStrengthMPa: 138.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 }
    ]
  },
  'A537-CL1': {
    id: 'A537-CL1',
    uns: 'K02400',
    nominalComposition: 'Heat-Treated C-Mn-Si Plate Class 1',
    productForm: 'Heat-Treated Plate for Pressure Vessels',
    pNumber: 'P-No 1 Gr 3',
    minTensileMPa: 485.0,
    minYieldMPa: 345.0,
    minTempC: -46.0,
    maxTempC: 371.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -46, allowableStressMPa: 162.0, yieldStrengthMPa: 345.0 },
      { tempC: 38, allowableStressMPa: 162.0, yieldStrengthMPa: 345.0 },
      { tempC: 93, allowableStressMPa: 162.0, yieldStrengthMPa: 325.0 },
      { tempC: 149, allowableStressMPa: 162.0, yieldStrengthMPa: 310.0 },
      { tempC: 204, allowableStressMPa: 162.0, yieldStrengthMPa: 298.0 },
      { tempC: 260, allowableStressMPa: 162.0, yieldStrengthMPa: 284.0 },
      { tempC: 316, allowableStressMPa: 154.0, yieldStrengthMPa: 265.0 },
      { tempC: 371, allowableStressMPa: 140.0, yieldStrengthMPa: 241.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 204.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 194.0, thermalExpansionCoeff: 12.8 },
      { tempC: 370, elasticModulusGPa: 179.0, thermalExpansionCoeff: 14.1 }
    ]
  },

  // -------------------------------------------------------------
  // CHROME-MOLY HIGH TEMPERATURE HIGH PRESSURE ALLOY PIPING & FORGINGS
  // -------------------------------------------------------------
  'A335-P11': {
    id: 'A335-P11',
    uns: 'K11597',
    nominalComposition: '1.25Cr-0.5Mo-Si Alloy Steel',
    productForm: 'Seamless Ferritic Alloy Pipe',
    pNumber: 'P-No 4 Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 205.0,
    minTempC: -29.0,
    maxTempC: 593.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 182.0 },
      { tempC: 316, allowableStressMPa: 138.0, yieldStrengthMPa: 168.0 },
      { tempC: 427, allowableStressMPa: 133.0, yieldStrengthMPa: 152.0 },
      { tempC: 482, allowableStressMPa: 112.0, yieldStrengthMPa: 142.0 },
      { tempC: 510, allowableStressMPa: 94.0, yieldStrengthMPa: 136.0 },
      { tempC: 538, allowableStressMPa: 66.0, yieldStrengthMPa: 130.0 },
      { tempC: 566, allowableStressMPa: 41.0, yieldStrengthMPa: 122.0 },
      { tempC: 593, allowableStressMPa: 25.0, yieldStrengthMPa: 115.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 212.0, thermalExpansionCoeff: 11.8 },
      { tempC: 300, elasticModulusGPa: 192.0, thermalExpansionCoeff: 13.2 },
      { tempC: 500, elasticModulusGPa: 172.0, thermalExpansionCoeff: 14.1 }
    ]
  },
  'A335-P22': {
    id: 'A335-P22',
    uns: 'K21590',
    nominalComposition: '2.25Cr-1Mo Alloy Steel',
    productForm: 'Seamless Ferritic Alloy Pipe',
    pNumber: 'P-No 5A Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 205.0,
    minTempC: -29.0,
    maxTempC: 649.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 316, allowableStressMPa: 138.0, yieldStrengthMPa: 170.0 },
      { tempC: 454, allowableStressMPa: 131.0, yieldStrengthMPa: 153.0 },
      { tempC: 510, allowableStressMPa: 112.0, yieldStrengthMPa: 143.0 },
      { tempC: 538, allowableStressMPa: 76.0, yieldStrengthMPa: 138.0 },
      { tempC: 566, allowableStressMPa: 52.0, yieldStrengthMPa: 132.0 },
      { tempC: 593, allowableStressMPa: 34.0, yieldStrengthMPa: 126.0 },
      { tempC: 621, allowableStressMPa: 22.0, yieldStrengthMPa: 119.0 },
      { tempC: 649, allowableStressMPa: 14.0, yieldStrengthMPa: 112.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 213.0, thermalExpansionCoeff: 11.7 },
      { tempC: 300, elasticModulusGPa: 193.0, thermalExpansionCoeff: 13.1 },
      { tempC: 500, elasticModulusGPa: 174.0, thermalExpansionCoeff: 14.0 }
    ]
  },
  'A335-P5': {
    id: 'A335-P5',
    uns: 'K41545',
    nominalComposition: '5Cr-0.5Mo Alloy Steel',
    productForm: 'Seamless Ferritic Alloy Pipe',
    pNumber: 'P-No 5B Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 205.0,
    minTempC: -29.0,
    maxTempC: 649.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 181.0 },
      { tempC: 371, allowableStressMPa: 135.0, yieldStrengthMPa: 161.0 },
      { tempC: 510, allowableStressMPa: 90.0, yieldStrengthMPa: 140.0 },
      { tempC: 593, allowableStressMPa: 28.0, yieldStrengthMPa: 120.0 },
      { tempC: 649, allowableStressMPa: 12.0, yieldStrengthMPa: 105.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 214.0, thermalExpansionCoeff: 11.5 },
      { tempC: 300, elasticModulusGPa: 194.0, thermalExpansionCoeff: 12.8 },
      { tempC: 500, elasticModulusGPa: 175.0, thermalExpansionCoeff: 13.7 }
    ]
  },
  'A335-P9': {
    id: 'A335-P9',
    uns: 'K90941',
    nominalComposition: '9Cr-1Mo Alloy Steel',
    productForm: 'Seamless Ferritic Alloy Pipe',
    pNumber: 'P-No 5B Gr 1',
    minTensileMPa: 415.0,
    minYieldMPa: 205.0,
    minTempC: -29.0,
    maxTempC: 649.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 180.0 },
      { tempC: 371, allowableStressMPa: 138.0, yieldStrengthMPa: 160.0 },
      { tempC: 510, allowableStressMPa: 98.0, yieldStrengthMPa: 141.0 },
      { tempC: 593, allowableStressMPa: 31.0, yieldStrengthMPa: 122.0 },
      { tempC: 649, allowableStressMPa: 13.0, yieldStrengthMPa: 108.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 215.0, thermalExpansionCoeff: 11.3 },
      { tempC: 300, elasticModulusGPa: 195.0, thermalExpansionCoeff: 12.5 },
      { tempC: 500, elasticModulusGPa: 176.0, thermalExpansionCoeff: 13.5 }
    ]
  },
  'A335-P91': {
    id: 'A335-P91',
    uns: 'K90901',
    nominalComposition: '9Cr-1Mo-V Creep Strength Enhanced Steel',
    productForm: 'Seamless Ferritic Alloy Pipe',
    pNumber: 'P-No 5B Gr 2',
    minTensileMPa: 585.0,
    minYieldMPa: 415.0,
    minTempC: -29.0,
    maxTempC: 649.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 195.0, yieldStrengthMPa: 415.0 },
      { tempC: 38, allowableStressMPa: 195.0, yieldStrengthMPa: 415.0 },
      { tempC: 204, allowableStressMPa: 195.0, yieldStrengthMPa: 380.0 },
      { tempC: 371, allowableStressMPa: 190.0, yieldStrengthMPa: 350.0 },
      { tempC: 510, allowableStressMPa: 162.0, yieldStrengthMPa: 315.0 },
      { tempC: 566, allowableStressMPa: 110.0, yieldStrengthMPa: 285.0 },
      { tempC: 593, allowableStressMPa: 85.0, yieldStrengthMPa: 260.0 },
      { tempC: 621, allowableStressMPa: 55.0, yieldStrengthMPa: 235.0 },
      { tempC: 649, allowableStressMPa: 34.0, yieldStrengthMPa: 210.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 218.0, thermalExpansionCoeff: 10.9 },
      { tempC: 300, elasticModulusGPa: 198.0, thermalExpansionCoeff: 12.1 },
      { tempC: 500, elasticModulusGPa: 180.0, thermalExpansionCoeff: 13.0 }
    ]
  },
  'A182-F11': {
    id: 'A182-F11',
    uns: 'K11572',
    nominalComposition: '1.25Cr-0.5Mo Forged Alloy Steel',
    productForm: 'Forged Flange / Fitting',
    pNumber: 'P-No 4 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 275.0,
    minTempC: -29.0,
    maxTempC: 593.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 275.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 275.0 },
      { tempC: 316, allowableStressMPa: 138.0, yieldStrengthMPa: 210.0 },
      { tempC: 482, allowableStressMPa: 112.0, yieldStrengthMPa: 165.0 },
      { tempC: 593, allowableStressMPa: 25.0, yieldStrengthMPa: 125.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 212.0, thermalExpansionCoeff: 11.8 },
      { tempC: 300, elasticModulusGPa: 192.0, thermalExpansionCoeff: 13.2 }
    ]
  },
  'A182-F22': {
    id: 'A182-F22',
    uns: 'K21590',
    nominalComposition: '2.25Cr-1Mo Forged Alloy Steel',
    productForm: 'Forged Flange / Fitting',
    pNumber: 'P-No 5A Gr 1',
    minTensileMPa: 515.0,
    minYieldMPa: 310.0,
    minTempC: -29.0,
    maxTempC: 649.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 310.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 310.0 },
      { tempC: 316, allowableStressMPa: 138.0, yieldStrengthMPa: 235.0 },
      { tempC: 510, allowableStressMPa: 112.0, yieldStrengthMPa: 175.0 },
      { tempC: 649, allowableStressMPa: 14.0, yieldStrengthMPa: 120.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 213.0, thermalExpansionCoeff: 11.7 },
      { tempC: 300, elasticModulusGPa: 193.0, thermalExpansionCoeff: 13.1 }
    ]
  },

  // -------------------------------------------------------------
  // AUSTENITIC STAINLESS STEELS (CRYOGENIC TO HIGH TEMP)
  // -------------------------------------------------------------
  'A312-TP304L': {
    id: 'A312-TP304L',
    uns: 'S30403',
    nominalComposition: '18Cr-8Ni Low Carbon Austenitic SS',
    productForm: 'Seamless / Welded Cryogenic Pipe',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 93, allowableStressMPa: 104.0, yieldStrengthMPa: 146.0 },
      { tempC: 149, allowableStressMPa: 94.0, yieldStrengthMPa: 132.0 },
      { tempC: 204, allowableStressMPa: 87.0, yieldStrengthMPa: 122.0 },
      { tempC: 260, allowableStressMPa: 82.0, yieldStrengthMPa: 115.0 },
      { tempC: 316, allowableStressMPa: 78.0, yieldStrengthMPa: 109.0 },
      { tempC: 371, allowableStressMPa: 75.0, yieldStrengthMPa: 105.0 },
      { tempC: 427, allowableStressMPa: 72.0, yieldStrengthMPa: 101.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 207.0, thermalExpansionCoeff: 13.5 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 16.0 },
      { tempC: 200, elasticModulusGPa: 181.0, thermalExpansionCoeff: 17.2 },
      { tempC: 400, elasticModulusGPa: 168.0, thermalExpansionCoeff: 18.2 }
    ]
  },
  'A312-TP304': {
    id: 'A312-TP304',
    uns: 'S30400',
    nominalComposition: '18Cr-8Ni Standard Austenitic SS',
    productForm: 'Seamless / Welded Austenitic Pipe',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 515.0,
    minYieldMPa: 205.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 93, allowableStressMPa: 124.0, yieldStrengthMPa: 172.0 },
      { tempC: 204, allowableStressMPa: 106.0, yieldStrengthMPa: 147.0 },
      { tempC: 316, allowableStressMPa: 96.0, yieldStrengthMPa: 134.0 },
      { tempC: 427, allowableStressMPa: 90.0, yieldStrengthMPa: 126.0 },
      { tempC: 538, allowableStressMPa: 85.0, yieldStrengthMPa: 119.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 207.0, thermalExpansionCoeff: 13.5 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 16.0 },
      { tempC: 300, elasticModulusGPa: 175.0, thermalExpansionCoeff: 17.7 }
    ]
  },
  'A312-TP316L': {
    id: 'A312-TP316L',
    uns: 'S31603',
    nominalComposition: '16Cr-12Ni-2Mo Low Carbon Austenitic SS',
    productForm: 'Seamless / Welded Cryogenic & Chemical Pipe',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 454.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 93, allowableStressMPa: 102.0, yieldStrengthMPa: 145.0 },
      { tempC: 149, allowableStressMPa: 93.0, yieldStrengthMPa: 132.0 },
      { tempC: 204, allowableStressMPa: 86.0, yieldStrengthMPa: 122.0 },
      { tempC: 260, allowableStressMPa: 81.0, yieldStrengthMPa: 114.0 },
      { tempC: 316, allowableStressMPa: 77.0, yieldStrengthMPa: 108.0 },
      { tempC: 371, allowableStressMPa: 74.0, yieldStrengthMPa: 103.0 },
      { tempC: 427, allowableStressMPa: 71.0, yieldStrengthMPa: 99.0 },
      { tempC: 454, allowableStressMPa: 70.0, yieldStrengthMPa: 97.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 207.0, thermalExpansionCoeff: 13.8 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 15.9 },
      { tempC: 200, elasticModulusGPa: 180.0, thermalExpansionCoeff: 16.9 },
      { tempC: 400, elasticModulusGPa: 166.0, thermalExpansionCoeff: 17.8 }
    ]
  },
  'A312-TP316': {
    id: 'A312-TP316',
    uns: 'S31600',
    nominalComposition: '16Cr-12Ni-2Mo Standard Austenitic SS',
    productForm: 'Seamless / Welded Chemical Pipe',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 515.0,
    minYieldMPa: 205.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 93, allowableStressMPa: 123.0, yieldStrengthMPa: 178.0 },
      { tempC: 204, allowableStressMPa: 107.0, yieldStrengthMPa: 153.0 },
      { tempC: 316, allowableStressMPa: 97.0, yieldStrengthMPa: 140.0 },
      { tempC: 427, allowableStressMPa: 91.0, yieldStrengthMPa: 132.0 },
      { tempC: 538, allowableStressMPa: 86.0, yieldStrengthMPa: 125.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 207.0, thermalExpansionCoeff: 13.8 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 15.9 },
      { tempC: 300, elasticModulusGPa: 173.0, thermalExpansionCoeff: 17.5 }
    ]
  },
  'A312-TP321': {
    id: 'A312-TP321',
    uns: 'S32100',
    nominalComposition: '18Cr-10Ni-Ti Titanium Stabilized Austenitic SS',
    productForm: 'Seamless / Welded High Temp Pipe',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 515.0,
    minYieldMPa: 205.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 204, allowableStressMPa: 115.0, yieldStrengthMPa: 165.0 },
      { tempC: 371, allowableStressMPa: 99.0, yieldStrengthMPa: 145.0 },
      { tempC: 538, allowableStressMPa: 88.0, yieldStrengthMPa: 130.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 16.6 },
      { tempC: 300, elasticModulusGPa: 175.0, thermalExpansionCoeff: 17.9 }
    ]
  },
  'A312-TP347': {
    id: 'A312-TP347',
    uns: 'S34700',
    nominalComposition: '18Cr-10Ni-Nb Niobium Stabilized Austenitic SS',
    productForm: 'Seamless / Welded High Temp Pipe',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 515.0,
    minYieldMPa: 205.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 204, allowableStressMPa: 118.0, yieldStrengthMPa: 170.0 },
      { tempC: 371, allowableStressMPa: 104.0, yieldStrengthMPa: 150.0 },
      { tempC: 538, allowableStressMPa: 93.0, yieldStrengthMPa: 135.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 16.6 },
      { tempC: 300, elasticModulusGPa: 175.0, thermalExpansionCoeff: 17.9 }
    ]
  },
  'A403-WP316L': {
    id: 'A403-WP316L',
    uns: 'S31603',
    nominalComposition: '16Cr-12Ni-2Mo Wrought SS 316L Fitting',
    productForm: 'Piping Fitting for Cryogenic / Chemical',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 454.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 93, allowableStressMPa: 102.0, yieldStrengthMPa: 145.0 },
      { tempC: 204, allowableStressMPa: 86.0, yieldStrengthMPa: 122.0 },
      { tempC: 316, allowableStressMPa: 77.0, yieldStrengthMPa: 108.0 },
      { tempC: 454, allowableStressMPa: 70.0, yieldStrengthMPa: 97.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 207.0, thermalExpansionCoeff: 13.8 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 15.9 },
      { tempC: 200, elasticModulusGPa: 180.0, thermalExpansionCoeff: 16.9 }
    ]
  },
  'A182-F316L': {
    id: 'A182-F316L',
    uns: 'S31603',
    nominalComposition: '16Cr-12Ni-2Mo Forged SS 316L Flange',
    productForm: 'Forged Flange / Fitting for Cryogenic',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 454.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 93, allowableStressMPa: 102.0, yieldStrengthMPa: 145.0 },
      { tempC: 204, allowableStressMPa: 86.0, yieldStrengthMPa: 122.0 },
      { tempC: 316, allowableStressMPa: 77.0, yieldStrengthMPa: 108.0 },
      { tempC: 454, allowableStressMPa: 70.0, yieldStrengthMPa: 97.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 207.0, thermalExpansionCoeff: 13.8 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 15.9 },
      { tempC: 200, elasticModulusGPa: 180.0, thermalExpansionCoeff: 16.9 }
    ]
  },
  'A182-F304L': {
    id: 'A182-F304L',
    uns: 'S30403',
    nominalComposition: '18Cr-8Ni Forged SS 304L Flange',
    productForm: 'Forged Flange / Fitting',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 93, allowableStressMPa: 104.0, yieldStrengthMPa: 146.0 },
      { tempC: 204, allowableStressMPa: 87.0, yieldStrengthMPa: 122.0 },
      { tempC: 316, allowableStressMPa: 78.0, yieldStrengthMPa: 109.0 },
      { tempC: 427, allowableStressMPa: 72.0, yieldStrengthMPa: 101.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 16.0 },
      { tempC: 200, elasticModulusGPa: 181.0, thermalExpansionCoeff: 17.2 }
    ]
  },
  'A240-316L': {
    id: 'A240-316L',
    uns: 'S31603',
    nominalComposition: '16Cr-12Ni-2Mo SS 316L Plate',
    productForm: 'Pressure Vessel / Tank Plate',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 454.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 115.0, yieldStrengthMPa: 170.0 },
      { tempC: 93, allowableStressMPa: 102.0, yieldStrengthMPa: 145.0 },
      { tempC: 204, allowableStressMPa: 86.0, yieldStrengthMPa: 122.0 },
      { tempC: 316, allowableStressMPa: 77.0, yieldStrengthMPa: 108.0 },
      { tempC: 454, allowableStressMPa: 70.0, yieldStrengthMPa: 97.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 15.9 },
      { tempC: 200, elasticModulusGPa: 180.0, thermalExpansionCoeff: 16.9 }
    ]
  },

  // -------------------------------------------------------------
  // DUPLEX & SUPER DUPLEX STAINLESS STEELS (PIPES & FORGINGS)
  // -------------------------------------------------------------
  'A790-UNS-S31803': {
    id: 'A790-UNS-S31803',
    uns: 'S31803',
    nominalComposition: '22Cr-5Ni-3Mo-N (Duplex 2205)',
    productForm: 'Seamless / Welded Duplex Pipe',
    pNumber: 'P-No 10H Gr 1',
    minTensileMPa: 620.0,
    minYieldMPa: 450.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 177.0, yieldStrengthMPa: 450.0 },
      { tempC: 38, allowableStressMPa: 177.0, yieldStrengthMPa: 450.0 },
      { tempC: 93, allowableStressMPa: 175.0, yieldStrengthMPa: 386.0 },
      { tempC: 149, allowableStressMPa: 165.0, yieldStrengthMPa: 352.0 },
      { tempC: 204, allowableStressMPa: 157.0, yieldStrengthMPa: 328.0 },
      { tempC: 260, allowableStressMPa: 152.0, yieldStrengthMPa: 312.0 },
      { tempC: 316, allowableStressMPa: 149.0, yieldStrengthMPa: 301.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 200.0, thermalExpansionCoeff: 13.0 },
      { tempC: 150, elasticModulusGPa: 190.0, thermalExpansionCoeff: 13.8 },
      { tempC: 300, elasticModulusGPa: 180.0, thermalExpansionCoeff: 14.5 }
    ]
  },
  'A182-F51': {
    id: 'A182-F51',
    uns: 'S31803',
    nominalComposition: '22Cr-5Ni-3Mo-N Forged Duplex 2205',
    productForm: 'Forged Flange / Fitting (Duplex)',
    pNumber: 'P-No 10H Gr 1',
    minTensileMPa: 620.0,
    minYieldMPa: 450.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 177.0, yieldStrengthMPa: 450.0 },
      { tempC: 38, allowableStressMPa: 177.0, yieldStrengthMPa: 450.0 },
      { tempC: 93, allowableStressMPa: 175.0, yieldStrengthMPa: 386.0 },
      { tempC: 149, allowableStressMPa: 165.0, yieldStrengthMPa: 352.0 },
      { tempC: 204, allowableStressMPa: 157.0, yieldStrengthMPa: 328.0 },
      { tempC: 260, allowableStressMPa: 152.0, yieldStrengthMPa: 312.0 },
      { tempC: 316, allowableStressMPa: 149.0, yieldStrengthMPa: 301.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 200.0, thermalExpansionCoeff: 13.0 },
      { tempC: 150, elasticModulusGPa: 190.0, thermalExpansionCoeff: 13.8 },
      { tempC: 300, elasticModulusGPa: 180.0, thermalExpansionCoeff: 14.5 }
    ]
  },
  'A790-UNS-S32750': {
    id: 'A790-UNS-S32750',
    uns: 'S32750',
    nominalComposition: '25Cr-7Ni-4Mo-N (Super Duplex 2507)',
    productForm: 'Seamless / Welded Super Duplex Pipe',
    pNumber: 'P-No 10H Gr 1',
    minTensileMPa: 795.0,
    minYieldMPa: 550.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 227.0, yieldStrengthMPa: 550.0 },
      { tempC: 38, allowableStressMPa: 227.0, yieldStrengthMPa: 550.0 },
      { tempC: 93, allowableStressMPa: 220.0, yieldStrengthMPa: 480.0 },
      { tempC: 149, allowableStressMPa: 207.0, yieldStrengthMPa: 442.0 },
      { tempC: 204, allowableStressMPa: 198.0, yieldStrengthMPa: 418.0 },
      { tempC: 260, allowableStressMPa: 192.0, yieldStrengthMPa: 400.0 },
      { tempC: 316, allowableStressMPa: 188.0, yieldStrengthMPa: 388.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 202.0, thermalExpansionCoeff: 13.0 },
      { tempC: 150, elasticModulusGPa: 192.0, thermalExpansionCoeff: 13.7 },
      { tempC: 300, elasticModulusGPa: 181.0, thermalExpansionCoeff: 14.4 }
    ]
  },
  'A182-F53': {
    id: 'A182-F53',
    uns: 'S32750',
    nominalComposition: '25Cr-7Ni-4Mo-N Forged Super Duplex 2507',
    productForm: 'Forged Flange / Fitting (Super Duplex)',
    pNumber: 'P-No 10H Gr 1',
    minTensileMPa: 795.0,
    minYieldMPa: 550.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 227.0, yieldStrengthMPa: 550.0 },
      { tempC: 38, allowableStressMPa: 227.0, yieldStrengthMPa: 550.0 },
      { tempC: 93, allowableStressMPa: 220.0, yieldStrengthMPa: 480.0 },
      { tempC: 149, allowableStressMPa: 207.0, yieldStrengthMPa: 442.0 },
      { tempC: 204, allowableStressMPa: 198.0, yieldStrengthMPa: 418.0 },
      { tempC: 260, allowableStressMPa: 192.0, yieldStrengthMPa: 400.0 },
      { tempC: 316, allowableStressMPa: 188.0, yieldStrengthMPa: 388.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 202.0, thermalExpansionCoeff: 13.0 },
      { tempC: 150, elasticModulusGPa: 192.0, thermalExpansionCoeff: 13.7 },
      { tempC: 300, elasticModulusGPa: 181.0, thermalExpansionCoeff: 14.4 }
    ]
  },
  'A312-UNS-S31254': {
    id: 'A312-UNS-S31254',
    uns: 'S31254',
    nominalComposition: '20Cr-18Ni-6Mo-N (6Mo Super Austenitic 254SMO)',
    productForm: 'Seamless / Welded 6Mo Stainless Pipe',
    pNumber: 'P-No 8 Gr 4',
    minTensileMPa: 650.0,
    minYieldMPa: 300.0,
    minTempC: -196.0,
    maxTempC: 400.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 155.0, yieldStrengthMPa: 300.0 },
      { tempC: 38, allowableStressMPa: 155.0, yieldStrengthMPa: 300.0 },
      { tempC: 100, allowableStressMPa: 148.0, yieldStrengthMPa: 260.0 },
      { tempC: 200, allowableStressMPa: 136.0, yieldStrengthMPa: 225.0 },
      { tempC: 300, allowableStressMPa: 128.0, yieldStrengthMPa: 205.0 },
      { tempC: 400, allowableStressMPa: 122.0, yieldStrengthMPa: 190.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 195.0, thermalExpansionCoeff: 15.3 },
      { tempC: 200, elasticModulusGPa: 182.0, thermalExpansionCoeff: 16.5 },
      { tempC: 400, elasticModulusGPa: 168.0, thermalExpansionCoeff: 17.5 }
    ]
  },

  // -------------------------------------------------------------
  // HIGH-NICKEL CORROSION RESISTANT ALLOYS
  // -------------------------------------------------------------
  'B444-INCONEL-625': {
    id: 'B444-INCONEL-625',
    uns: 'N06625',
    nominalComposition: '60Ni-22Cr-9Mo-3.5Nb (Alloy 625 Gr 1)',
    productForm: 'Seamless Nickel-Chromium-Moly Pipe',
    pNumber: 'P-No 43',
    minTensileMPa: 825.0,
    minYieldMPa: 415.0,
    minTempC: -196.0,
    maxTempC: 649.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 184.0, yieldStrengthMPa: 415.0 },
      { tempC: 38, allowableStressMPa: 184.0, yieldStrengthMPa: 415.0 },
      { tempC: 204, allowableStressMPa: 172.0, yieldStrengthMPa: 345.0 },
      { tempC: 316, allowableStressMPa: 167.0, yieldStrengthMPa: 324.0 },
      { tempC: 427, allowableStressMPa: 164.0, yieldStrengthMPa: 310.0 },
      { tempC: 538, allowableStressMPa: 161.0, yieldStrengthMPa: 300.0 },
      { tempC: 649, allowableStressMPa: 155.0, yieldStrengthMPa: 285.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 207.0, thermalExpansionCoeff: 12.8 },
      { tempC: 300, elasticModulusGPa: 193.0, thermalExpansionCoeff: 13.5 },
      { tempC: 600, elasticModulusGPa: 175.0, thermalExpansionCoeff: 14.8 }
    ]
  },
  'B622-HASTELLOY-C276': {
    id: 'B622-HASTELLOY-C276',
    uns: 'N10276',
    nominalComposition: '54Ni-16Mo-16Cr-4W (Alloy C-276)',
    productForm: 'Seamless Severe Sour / Acid Pipe',
    pNumber: 'P-No 43',
    minTensileMPa: 690.0,
    minYieldMPa: 283.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 172.0, yieldStrengthMPa: 283.0 },
      { tempC: 38, allowableStressMPa: 172.0, yieldStrengthMPa: 283.0 },
      { tempC: 149, allowableStressMPa: 172.0, yieldStrengthMPa: 236.0 },
      { tempC: 260, allowableStressMPa: 153.0, yieldStrengthMPa: 208.0 },
      { tempC: 371, allowableStressMPa: 141.0, yieldStrengthMPa: 188.0 },
      { tempC: 482, allowableStressMPa: 133.0, yieldStrengthMPa: 175.0 },
      { tempC: 538, allowableStressMPa: 129.0, yieldStrengthMPa: 168.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 205.0, thermalExpansionCoeff: 11.2 },
      { tempC: 300, elasticModulusGPa: 189.0, thermalExpansionCoeff: 12.6 },
      { tempC: 500, elasticModulusGPa: 174.0, thermalExpansionCoeff: 13.8 }
    ]
  },
  'B165-N04400': {
    id: 'B165-N04400',
    uns: 'N04400',
    nominalComposition: '67Ni-30Cu (Monel 400)',
    productForm: 'Seamless Nickel-Copper Alloy Pipe',
    pNumber: 'P-No 42',
    minTensileMPa: 485.0,
    minYieldMPa: 195.0,
    minTempC: -196.0,
    maxTempC: 482.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 120.0, yieldStrengthMPa: 195.0 },
      { tempC: 38, allowableStressMPa: 120.0, yieldStrengthMPa: 195.0 },
      { tempC: 93, allowableStressMPa: 120.0, yieldStrengthMPa: 178.0 },
      { tempC: 204, allowableStressMPa: 114.0, yieldStrengthMPa: 162.0 },
      { tempC: 316, allowableStressMPa: 110.0, yieldStrengthMPa: 155.0 },
      { tempC: 427, allowableStressMPa: 104.0, yieldStrengthMPa: 148.0 },
      { tempC: 482, allowableStressMPa: 95.0, yieldStrengthMPa: 142.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 179.0, thermalExpansionCoeff: 13.9 },
      { tempC: 200, elasticModulusGPa: 170.0, thermalExpansionCoeff: 14.8 },
      { tempC: 400, elasticModulusGPa: 159.0, thermalExpansionCoeff: 15.6 }
    ]
  },
  'B423-N08825': {
    id: 'B423-N08825',
    uns: 'N08825',
    nominalComposition: '42Ni-21Cr-3Mo (Incoloy 825)',
    productForm: 'Seamless Nickel-Iron-Chromium Pipe',
    pNumber: 'P-No 45',
    minTensileMPa: 585.0,
    minYieldMPa: 240.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 147.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 147.0, yieldStrengthMPa: 240.0 },
      { tempC: 100, allowableStressMPa: 147.0, yieldStrengthMPa: 220.0 },
      { tempC: 200, allowableStressMPa: 140.0, yieldStrengthMPa: 205.0 },
      { tempC: 316, allowableStressMPa: 135.0, yieldStrengthMPa: 192.0 },
      { tempC: 427, allowableStressMPa: 131.0, yieldStrengthMPa: 184.0 },
      { tempC: 538, allowableStressMPa: 125.0, yieldStrengthMPa: 175.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 196.0, thermalExpansionCoeff: 14.0 },
      { tempC: 200, elasticModulusGPa: 185.0, thermalExpansionCoeff: 14.9 },
      { tempC: 400, elasticModulusGPa: 172.0, thermalExpansionCoeff: 15.7 }
    ]
  },
  'B407-N08810': {
    id: 'B407-N08810',
    uns: 'N08810',
    nominalComposition: '32Ni-21Cr (Incoloy 800H)',
    productForm: 'Seamless Nickel-Iron-Chromium Pipe',
    pNumber: 'P-No 45',
    minTensileMPa: 450.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 760.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 105.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 105.0, yieldStrengthMPa: 170.0 },
      { tempC: 204, allowableStressMPa: 98.0, yieldStrengthMPa: 148.0 },
      { tempC: 427, allowableStressMPa: 92.0, yieldStrengthMPa: 132.0 },
      { tempC: 538, allowableStressMPa: 88.0, yieldStrengthMPa: 125.0 },
      { tempC: 649, allowableStressMPa: 62.0, yieldStrengthMPa: 118.0 },
      { tempC: 760, allowableStressMPa: 31.0, yieldStrengthMPa: 105.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 196.0, thermalExpansionCoeff: 14.4 },
      { tempC: 300, elasticModulusGPa: 180.0, thermalExpansionCoeff: 15.8 },
      { tempC: 600, elasticModulusGPa: 161.0, thermalExpansionCoeff: 17.2 }
    ]
  },
  'B464-N08020': {
    id: 'B464-N08020',
    uns: 'N08020',
    nominalComposition: '35Ni-20Cr-3.5Cu-2.5Mo (Alloy 20)',
    productForm: 'Welded / Seamless Sulfuric Acid Alloy Pipe',
    pNumber: 'P-No 45',
    minTensileMPa: 550.0,
    minYieldMPa: 240.0,
    minTempC: -196.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 100, allowableStressMPa: 132.0, yieldStrengthMPa: 215.0 },
      { tempC: 200, allowableStressMPa: 122.0, yieldStrengthMPa: 195.0 },
      { tempC: 316, allowableStressMPa: 114.0, yieldStrengthMPa: 180.0 },
      { tempC: 427, allowableStressMPa: 108.0, yieldStrengthMPa: 170.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 14.7 },
      { tempC: 200, elasticModulusGPa: 180.0, thermalExpansionCoeff: 15.6 },
      { tempC: 400, elasticModulusGPa: 165.0, thermalExpansionCoeff: 16.5 }
    ]
  },
  'B163-N06600': {
    id: 'B163-N06600',
    uns: 'N06600',
    nominalComposition: '72Ni-15Cr-8Fe (Inconel 600)',
    productForm: 'Seamless Nickel-Chromium Alloy Pipe / Tube',
    pNumber: 'P-No 43',
    minTensileMPa: 550.0,
    minYieldMPa: 240.0,
    minTempC: -196.0,
    maxTempC: 649.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 215.0 },
      { tempC: 371, allowableStressMPa: 135.0, yieldStrengthMPa: 200.0 },
      { tempC: 538, allowableStressMPa: 110.0, yieldStrengthMPa: 185.0 },
      { tempC: 649, allowableStressMPa: 42.0, yieldStrengthMPa: 160.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 214.0, thermalExpansionCoeff: 13.3 },
      { tempC: 300, elasticModulusGPa: 198.0, thermalExpansionCoeff: 14.2 },
      { tempC: 600, elasticModulusGPa: 178.0, thermalExpansionCoeff: 15.5 }
    ]
  },
  'B574-N06022': {
    id: 'B574-N06022',
    uns: 'N06022',
    nominalComposition: '56Ni-22Cr-13Mo-3W (Hastelloy C-22)',
    productForm: 'Seamless Severe Chemical / Oxidizing Pipe',
    pNumber: 'P-No 43',
    minTensileMPa: 690.0,
    minYieldMPa: 310.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 172.0, yieldStrengthMPa: 310.0 },
      { tempC: 38, allowableStressMPa: 172.0, yieldStrengthMPa: 310.0 },
      { tempC: 150, allowableStressMPa: 172.0, yieldStrengthMPa: 260.0 },
      { tempC: 260, allowableStressMPa: 158.0, yieldStrengthMPa: 230.0 },
      { tempC: 371, allowableStressMPa: 146.0, yieldStrengthMPa: 210.0 },
      { tempC: 538, allowableStressMPa: 134.0, yieldStrengthMPa: 190.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 206.0, thermalExpansionCoeff: 12.4 },
      { tempC: 300, elasticModulusGPa: 190.0, thermalExpansionCoeff: 13.4 }
    ]
  },

  // -------------------------------------------------------------
  // CRYOGENIC 9% & 3.5% NICKEL STEELS (LNG & CRYOGENICS)
  // -------------------------------------------------------------
  'A333-8': {
    id: 'A333-8',
    uns: 'K81340',
    nominalComposition: '9% Ni Cryogenic Alloy Steel',
    productForm: 'Seamless Cryogenic Pipe (-196 °C)',
    pNumber: 'P-No 11A Gr 1',
    minTensileMPa: 690.0,
    minYieldMPa: 515.0,
    minTempC: -196.0,
    maxTempC: 149.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 218.0, yieldStrengthMPa: 515.0 },
      { tempC: -100, allowableStressMPa: 218.0, yieldStrengthMPa: 515.0 },
      { tempC: 38, allowableStressMPa: 218.0, yieldStrengthMPa: 515.0 },
      { tempC: 93, allowableStressMPa: 218.0, yieldStrengthMPa: 488.0 },
      { tempC: 149, allowableStressMPa: 215.0, yieldStrengthMPa: 465.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 205.0, thermalExpansionCoeff: 8.8 },
      { tempC: 20, elasticModulusGPa: 190.0, thermalExpansionCoeff: 10.6 },
      { tempC: 100, elasticModulusGPa: 185.0, thermalExpansionCoeff: 11.2 }
    ]
  },
  'A333-3': {
    id: 'A333-3',
    uns: 'K31918',
    nominalComposition: '3.5% Ni Cryogenic Alloy Steel',
    productForm: 'Seamless Cryogenic Pipe (-101 °C)',
    pNumber: 'P-No 9B Gr 1',
    minTensileMPa: 450.0,
    minYieldMPa: 240.0,
    minTempC: -101.0,
    maxTempC: 343.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -101, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 226.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 208.0 },
      { tempC: 343, allowableStressMPa: 126.0, yieldStrengthMPa: 176.0 }
    ],
    physicalProps: [
      { tempC: -100, elasticModulusGPa: 206.0, thermalExpansionCoeff: 10.1 },
      { tempC: 20, elasticModulusGPa: 201.0, thermalExpansionCoeff: 11.2 }
    ]
  },

  // -------------------------------------------------------------
  // COPPER-NICKEL ALLOYS (SEAWATER / COOLING WATER)
  // -------------------------------------------------------------
  'B466-UNS-C70600': {
    id: 'B466-UNS-C70600',
    uns: 'C70600',
    nominalComposition: 'Cu-Ni 90/10 Copper-Nickel Alloy',
    productForm: 'Seamless Seawater Cooling Pipe',
    pNumber: 'P-No 34',
    minTensileMPa: 275.0,
    minYieldMPa: 105.0,
    minTempC: -196.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 69.0, yieldStrengthMPa: 105.0 },
      { tempC: 38, allowableStressMPa: 69.0, yieldStrengthMPa: 105.0 },
      { tempC: 93, allowableStressMPa: 66.0, yieldStrengthMPa: 98.0 },
      { tempC: 149, allowableStressMPa: 63.0, yieldStrengthMPa: 93.0 },
      { tempC: 204, allowableStressMPa: 60.0, yieldStrengthMPa: 89.0 },
      { tempC: 260, allowableStressMPa: 57.0, yieldStrengthMPa: 85.0 },
      { tempC: 316, allowableStressMPa: 52.0, yieldStrengthMPa: 80.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 135.0, thermalExpansionCoeff: 17.1 },
      { tempC: 150, elasticModulusGPa: 128.0, thermalExpansionCoeff: 17.6 },
      { tempC: 300, elasticModulusGPa: 120.0, thermalExpansionCoeff: 18.2 }
    ]
  },
  'B466-UNS-C71500': {
    id: 'B466-UNS-C71500',
    uns: 'C71500',
    nominalComposition: 'Cu-Ni 70/30 Copper-Nickel Alloy',
    productForm: 'Seamless High-Velocity Seawater Pipe',
    pNumber: 'P-No 34',
    minTensileMPa: 360.0,
    minYieldMPa: 125.0,
    minTempC: -196.0,
    maxTempC: 371.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 83.0, yieldStrengthMPa: 125.0 },
      { tempC: 38, allowableStressMPa: 83.0, yieldStrengthMPa: 125.0 },
      { tempC: 93, allowableStressMPa: 79.0, yieldStrengthMPa: 118.0 },
      { tempC: 149, allowableStressMPa: 76.0, yieldStrengthMPa: 112.0 },
      { tempC: 204, allowableStressMPa: 73.0, yieldStrengthMPa: 107.0 },
      { tempC: 260, allowableStressMPa: 70.0, yieldStrengthMPa: 102.0 },
      { tempC: 316, allowableStressMPa: 66.0, yieldStrengthMPa: 97.0 },
      { tempC: 371, allowableStressMPa: 60.0, yieldStrengthMPa: 90.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 152.0, thermalExpansionCoeff: 16.2 },
      { tempC: 150, elasticModulusGPa: 144.0, thermalExpansionCoeff: 16.7 },
      { tempC: 300, elasticModulusGPa: 135.0, thermalExpansionCoeff: 17.3 }
    ]
  },

  // -------------------------------------------------------------
  // TITANIUM & TITANIUM ALLOYS (OFFSHORE, SEAWATER & CHLORINE)
  // -------------------------------------------------------------
  'B861-TI-GR2': {
    id: 'B861-TI-GR2',
    uns: 'R50400',
    nominalComposition: 'Unalloyed Commercially Pure Titanium Gr 2',
    productForm: 'Seamless Titanium Pipe (Seawater / Hypochlorite)',
    pNumber: 'P-No 51',
    minTensileMPa: 345.0,
    minYieldMPa: 275.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 95.0, yieldStrengthMPa: 275.0 },
      { tempC: 38, allowableStressMPa: 95.0, yieldStrengthMPa: 275.0 },
      { tempC: 93, allowableStressMPa: 81.0, yieldStrengthMPa: 210.0 },
      { tempC: 149, allowableStressMPa: 67.0, yieldStrengthMPa: 168.0 },
      { tempC: 204, allowableStressMPa: 57.0, yieldStrengthMPa: 139.0 },
      { tempC: 260, allowableStressMPa: 49.0, yieldStrengthMPa: 118.0 },
      { tempC: 316, allowableStressMPa: 43.0, yieldStrengthMPa: 102.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 105.0, thermalExpansionCoeff: 8.6 },
      { tempC: 150, elasticModulusGPa: 98.0, thermalExpansionCoeff: 9.3 },
      { tempC: 300, elasticModulusGPa: 89.0, thermalExpansionCoeff: 9.9 }
    ]
  },
  'B861-TI-GR5': {
    id: 'B861-TI-GR5',
    uns: 'R56400',
    nominalComposition: 'Ti-6Al-4V High Strength Titanium Gr 5',
    productForm: 'Seamless Titanium Alloy Pipe',
    pNumber: 'P-No 53',
    minTensileMPa: 895.0,
    minYieldMPa: 828.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 224.0, yieldStrengthMPa: 828.0 },
      { tempC: 38, allowableStressMPa: 224.0, yieldStrengthMPa: 828.0 },
      { tempC: 93, allowableStressMPa: 205.0, yieldStrengthMPa: 740.0 },
      { tempC: 149, allowableStressMPa: 185.0, yieldStrengthMPa: 670.0 },
      { tempC: 204, allowableStressMPa: 168.0, yieldStrengthMPa: 610.0 },
      { tempC: 260, allowableStressMPa: 152.0, yieldStrengthMPa: 560.0 },
      { tempC: 316, allowableStressMPa: 140.0, yieldStrengthMPa: 520.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 114.0, thermalExpansionCoeff: 8.8 },
      { tempC: 150, elasticModulusGPa: 106.0, thermalExpansionCoeff: 9.4 },
      { tempC: 300, elasticModulusGPa: 97.0, thermalExpansionCoeff: 10.0 }
    ]
  },
  'B861-TI-GR7': {
    id: 'B861-TI-GR7',
    uns: 'R52400',
    nominalComposition: 'Ti-0.15Pd Palladium-Alloyed Titanium Gr 7',
    productForm: 'Seamless Corrosion-Resistant Titanium Pipe',
    pNumber: 'P-No 51',
    minTensileMPa: 345.0,
    minYieldMPa: 275.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 95.0, yieldStrengthMPa: 275.0 },
      { tempC: 38, allowableStressMPa: 95.0, yieldStrengthMPa: 275.0 },
      { tempC: 93, allowableStressMPa: 81.0, yieldStrengthMPa: 210.0 },
      { tempC: 149, allowableStressMPa: 67.0, yieldStrengthMPa: 168.0 },
      { tempC: 204, allowableStressMPa: 57.0, yieldStrengthMPa: 139.0 },
      { tempC: 260, allowableStressMPa: 49.0, yieldStrengthMPa: 118.0 },
      { tempC: 316, allowableStressMPa: 43.0, yieldStrengthMPa: 102.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 105.0, thermalExpansionCoeff: 8.6 },
      { tempC: 150, elasticModulusGPa: 98.0, thermalExpansionCoeff: 9.3 },
      { tempC: 300, elasticModulusGPa: 89.0, thermalExpansionCoeff: 9.9 }
    ]
  },
  'B861-TI-GR12': {
    id: 'B861-TI-GR12',
    uns: 'R53400',
    nominalComposition: 'Ti-0.3Mo-0.8Ni Titanium Alloy Gr 12',
    productForm: 'Seamless High-Temp Crevice-Resistant Titanium Pipe',
    pNumber: 'P-No 52',
    minTensileMPa: 485.0,
    minYieldMPa: 345.0,
    minTempC: -50.0,
    maxTempC: 316.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -50, allowableStressMPa: 131.0, yieldStrengthMPa: 345.0 },
      { tempC: 38, allowableStressMPa: 131.0, yieldStrengthMPa: 345.0 },
      { tempC: 93, allowableStressMPa: 115.0, yieldStrengthMPa: 285.0 },
      { tempC: 149, allowableStressMPa: 98.0, yieldStrengthMPa: 240.0 },
      { tempC: 204, allowableStressMPa: 85.0, yieldStrengthMPa: 208.0 },
      { tempC: 260, allowableStressMPa: 75.0, yieldStrengthMPa: 182.0 },
      { tempC: 316, allowableStressMPa: 67.0, yieldStrengthMPa: 162.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 107.0, thermalExpansionCoeff: 8.9 },
      { tempC: 150, elasticModulusGPa: 100.0, thermalExpansionCoeff: 9.5 },
      { tempC: 300, elasticModulusGPa: 91.0, thermalExpansionCoeff: 10.1 }
    ]
  },

  // -------------------------------------------------------------
  // VALVE CASTINGS (CARBON STEEL, LTCS & STAINLESS)
  // -------------------------------------------------------------
  'A216-WCB': {
    id: 'A216-WCB',
    uns: 'J03002',
    nominalComposition: 'Carbon Steel Castings for Valves / Fittings',
    productForm: 'Cast Valve Body / Fitting',
    pNumber: 'P-No 1 Gr 2',
    minTensileMPa: 485.0,
    minYieldMPa: 250.0,
    minTempC: -29.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 250.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 250.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 235.0 },
      { tempC: 149, allowableStressMPa: 138.0, yieldStrengthMPa: 225.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 216.0 },
      { tempC: 260, allowableStressMPa: 137.0, yieldStrengthMPa: 205.0 },
      { tempC: 316, allowableStressMPa: 131.0, yieldStrengthMPa: 191.0 },
      { tempC: 371, allowableStressMPa: 120.0, yieldStrengthMPa: 175.0 },
      { tempC: 427, allowableStressMPa: 83.0, yieldStrengthMPa: 157.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 },
      { tempC: 400, elasticModulusGPa: 176.0, thermalExpansionCoeff: 14.3 }
    ]
  },
  'A352-LCB': {
    id: 'A352-LCB',
    uns: 'J03003',
    nominalComposition: 'Carbon Steel Castings for Low Temperature',
    productForm: 'Cast Low-Temp Valve Body (-46 °C)',
    pNumber: 'P-No 1 Gr 1',
    minTensileMPa: 450.0,
    minYieldMPa: 240.0,
    minTempC: -46.0,
    maxTempC: 343.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -46, allowableStressMPa: 129.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 129.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 129.0, yieldStrengthMPa: 226.0 },
      { tempC: 149, allowableStressMPa: 129.0, yieldStrengthMPa: 216.0 },
      { tempC: 204, allowableStressMPa: 129.0, yieldStrengthMPa: 208.0 },
      { tempC: 260, allowableStressMPa: 129.0, yieldStrengthMPa: 198.0 },
      { tempC: 316, allowableStressMPa: 124.0, yieldStrengthMPa: 184.0 },
      { tempC: 343, allowableStressMPa: 119.0, yieldStrengthMPa: 176.0 }
    ],
    physicalProps: [
      { tempC: -50, elasticModulusGPa: 207.0, thermalExpansionCoeff: 10.9 },
      { tempC: 20, elasticModulusGPa: 203.0, thermalExpansionCoeff: 11.5 },
      { tempC: 200, elasticModulusGPa: 193.0, thermalExpansionCoeff: 12.9 }
    ]
  },
  'A351-CF8M': {
    id: 'A351-CF8M',
    uns: 'J92900',
    nominalComposition: 'Austenitic 18Cr-8Ni-2Mo Stainless Steel Casting (Cast 316)',
    productForm: 'Cast Valve Body / Cryogenic Fitting (-196 °C)',
    pNumber: 'P-No 8 Gr 1',
    minTensileMPa: 485.0,
    minYieldMPa: 205.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 205.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 178.0 },
      { tempC: 149, allowableStressMPa: 130.0, yieldStrengthMPa: 161.0 },
      { tempC: 204, allowableStressMPa: 122.0, yieldStrengthMPa: 148.0 },
      { tempC: 260, allowableStressMPa: 116.0, yieldStrengthMPa: 138.0 },
      { tempC: 316, allowableStressMPa: 112.0, yieldStrengthMPa: 131.0 },
      { tempC: 427, allowableStressMPa: 106.0, yieldStrengthMPa: 121.0 },
      { tempC: 538, allowableStressMPa: 98.0, yieldStrengthMPa: 112.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 205.0, thermalExpansionCoeff: 14.2 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 16.0 },
      { tempC: 200, elasticModulusGPa: 179.0, thermalExpansionCoeff: 16.8 },
      { tempC: 400, elasticModulusGPa: 163.0, thermalExpansionCoeff: 17.8 }
    ]
  },

  // -------------------------------------------------------------
  // NICKEL ALLOY FORGINGS & FLANGES
  // -------------------------------------------------------------
  'B564-N04400': {
    id: 'B564-N04400',
    uns: 'N04400',
    nominalComposition: '67Ni-30Cu Monel 400 Forging / Flange',
    productForm: 'Nickel-Copper Alloy Forging / Flange',
    pNumber: 'P-No 42',
    minTensileMPa: 485.0,
    minYieldMPa: 170.0,
    minTempC: -196.0,
    maxTempC: 427.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 120.0, yieldStrengthMPa: 170.0 },
      { tempC: 38, allowableStressMPa: 120.0, yieldStrengthMPa: 170.0 },
      { tempC: 93, allowableStressMPa: 114.0, yieldStrengthMPa: 154.0 },
      { tempC: 149, allowableStressMPa: 110.0, yieldStrengthMPa: 145.0 },
      { tempC: 204, allowableStressMPa: 108.0, yieldStrengthMPa: 140.0 },
      { tempC: 260, allowableStressMPa: 107.0, yieldStrengthMPa: 138.0 },
      { tempC: 316, allowableStressMPa: 106.0, yieldStrengthMPa: 137.0 },
      { tempC: 371, allowableStressMPa: 105.0, yieldStrengthMPa: 136.0 },
      { tempC: 427, allowableStressMPa: 102.0, yieldStrengthMPa: 134.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 179.0, thermalExpansionCoeff: 13.9 },
      { tempC: 200, elasticModulusGPa: 169.0, thermalExpansionCoeff: 14.8 },
      { tempC: 400, elasticModulusGPa: 158.0, thermalExpansionCoeff: 15.6 }
    ]
  },
  'B564-N08825': {
    id: 'B564-N08825',
    uns: 'N08825',
    nominalComposition: 'Incoloy 825 Ni-Fe-Cr Forging / Flange',
    productForm: 'Nickel-Iron-Chromium Forging / Flange',
    pNumber: 'P-No 45',
    minTensileMPa: 585.0,
    minYieldMPa: 240.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 161.0, yieldStrengthMPa: 240.0 },
      { tempC: 38, allowableStressMPa: 161.0, yieldStrengthMPa: 240.0 },
      { tempC: 93, allowableStressMPa: 148.0, yieldStrengthMPa: 220.0 },
      { tempC: 149, allowableStressMPa: 140.0, yieldStrengthMPa: 208.0 },
      { tempC: 204, allowableStressMPa: 133.0, yieldStrengthMPa: 198.0 },
      { tempC: 260, allowableStressMPa: 128.0, yieldStrengthMPa: 191.0 },
      { tempC: 316, allowableStressMPa: 124.0, yieldStrengthMPa: 185.0 },
      { tempC: 427, allowableStressMPa: 118.0, yieldStrengthMPa: 176.0 },
      { tempC: 538, allowableStressMPa: 111.0, yieldStrengthMPa: 166.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 196.0, thermalExpansionCoeff: 14.0 },
      { tempC: 200, elasticModulusGPa: 184.0, thermalExpansionCoeff: 14.9 },
      { tempC: 400, elasticModulusGPa: 171.0, thermalExpansionCoeff: 15.8 }
    ]
  },

  // -------------------------------------------------------------
  // HIGH-STRENGTH ALLOY & CRYOGENIC BOLTING MATERIALS
  // -------------------------------------------------------------
  'A193-B7': {
    id: 'A193-B7',
    uns: 'G41400',
    nominalComposition: 'AISI 4140 Cr-Mo High-Strength Bolting',
    productForm: 'Stud Bolt with Heavy Hex Nuts',
    pNumber: 'Non-Pressure Bolting',
    minTensileMPa: 860.0,
    minYieldMPa: 725.0,
    minTempC: -29.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 172.0, yieldStrengthMPa: 725.0 },
      { tempC: 38, allowableStressMPa: 172.0, yieldStrengthMPa: 725.0 },
      { tempC: 93, allowableStressMPa: 172.0, yieldStrengthMPa: 690.0 },
      { tempC: 204, allowableStressMPa: 172.0, yieldStrengthMPa: 640.0 },
      { tempC: 316, allowableStressMPa: 172.0, yieldStrengthMPa: 590.0 },
      { tempC: 427, allowableStressMPa: 145.0, yieldStrengthMPa: 520.0 },
      { tempC: 538, allowableStressMPa: 68.0, yieldStrengthMPa: 380.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 207.0, thermalExpansionCoeff: 11.5 },
      { tempC: 300, elasticModulusGPa: 186.0, thermalExpansionCoeff: 13.5 }
    ]
  },
  'A193-B7M': {
    id: 'A193-B7M',
    uns: 'G41400',
    nominalComposition: 'AISI 4140 Sour Service Bolting (HRC <= 22)',
    productForm: 'Stud Bolt for Sour / NACE Service',
    pNumber: 'Non-Pressure Bolting',
    minTensileMPa: 690.0,
    minYieldMPa: 550.0,
    minTempC: -29.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -29, allowableStressMPa: 138.0, yieldStrengthMPa: 550.0 },
      { tempC: 38, allowableStressMPa: 138.0, yieldStrengthMPa: 550.0 },
      { tempC: 93, allowableStressMPa: 138.0, yieldStrengthMPa: 520.0 },
      { tempC: 204, allowableStressMPa: 138.0, yieldStrengthMPa: 480.0 },
      { tempC: 316, allowableStressMPa: 138.0, yieldStrengthMPa: 440.0 },
      { tempC: 427, allowableStressMPa: 120.0, yieldStrengthMPa: 390.0 },
      { tempC: 538, allowableStressMPa: 55.0, yieldStrengthMPa: 290.0 }
    ],
    physicalProps: [
      { tempC: 20, elasticModulusGPa: 207.0, thermalExpansionCoeff: 11.5 },
      { tempC: 300, elasticModulusGPa: 186.0, thermalExpansionCoeff: 13.5 }
    ]
  },
  'A320-L7': {
    id: 'A320-L7',
    uns: 'G41400',
    nominalComposition: 'Cr-Mo Low Temperature Impact-Tested Bolting',
    productForm: 'Stud Bolt for Low Temp (-101 °C)',
    pNumber: 'Non-Pressure Bolting',
    minTensileMPa: 860.0,
    minYieldMPa: 725.0,
    minTempC: -101.0,
    maxTempC: 343.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -101, allowableStressMPa: 172.0, yieldStrengthMPa: 725.0 },
      { tempC: 38, allowableStressMPa: 172.0, yieldStrengthMPa: 725.0 },
      { tempC: 93, allowableStressMPa: 172.0, yieldStrengthMPa: 690.0 },
      { tempC: 204, allowableStressMPa: 172.0, yieldStrengthMPa: 640.0 },
      { tempC: 316, allowableStressMPa: 172.0, yieldStrengthMPa: 590.0 },
      { tempC: 343, allowableStressMPa: 168.0, yieldStrengthMPa: 575.0 }
    ],
    physicalProps: [
      { tempC: -100, elasticModulusGPa: 212.0, thermalExpansionCoeff: 10.2 },
      { tempC: 20, elasticModulusGPa: 207.0, thermalExpansionCoeff: 11.5 }
    ]
  },
  'A193-B8M': {
    id: 'A193-B8M',
    uns: 'S31600',
    nominalComposition: '18Cr-12Ni-2Mo Stainless Bolting Class 2 (Strain Hardened)',
    productForm: 'Cryogenic Stud Bolt (-196 °C)',
    pNumber: 'Non-Pressure Bolting',
    minTensileMPa: 655.0,
    minYieldMPa: 515.0,
    minTempC: -196.0,
    maxTempC: 538.0,
    defaultJointEfficiency: 1.0,
    tempDerating: [
      { tempC: -196, allowableStressMPa: 131.0, yieldStrengthMPa: 515.0 },
      { tempC: 38, allowableStressMPa: 131.0, yieldStrengthMPa: 515.0 },
      { tempC: 93, allowableStressMPa: 120.0, yieldStrengthMPa: 460.0 },
      { tempC: 204, allowableStressMPa: 105.0, yieldStrengthMPa: 410.0 },
      { tempC: 316, allowableStressMPa: 96.0, yieldStrengthMPa: 375.0 },
      { tempC: 427, allowableStressMPa: 89.0, yieldStrengthMPa: 340.0 },
      { tempC: 538, allowableStressMPa: 82.0, yieldStrengthMPa: 310.0 }
    ],
    physicalProps: [
      { tempC: -196, elasticModulusGPa: 205.0, thermalExpansionCoeff: 14.5 },
      { tempC: 20, elasticModulusGPa: 193.0, thermalExpansionCoeff: 16.0 }
    ]
  }
};

/**
 * Normalization helper & alias map for material IDs across standard notations.
 */
const MATERIAL_ALIASES = {
  'CS': 'A106-B',
  'CARBON STEEL': 'A106-B',
  'LTCS': 'A333-6',
  'A105N': 'A105',
  'A105-N': 'A105',
  'A234 WPB': 'A234-WPB',
  'A420 WPL6': 'A420-WPL6',
  'A403 WP316L': 'A403-WP316L',
  'WP316L': 'A403-WP316L',
  'A182 F316L': 'A182-F316L',
  'F316L': 'A182-F316L',
  'A182 F304L': 'A182-F304L',
  'F304L': 'A182-F304L',
  'A182 F51': 'A182-F51',
  'F51': 'A182-F51',
  'A182 F53': 'A182-F53',
  'F53': 'A182-F53',
  'A350 LF2': 'A350-LF2',
  'LF2': 'A350-LF2',
  'A350 LF3': 'A350-LF3',
  'LF3': 'A350-LF3',
  'A516 Gr 70': 'A516-GR70',
  'A516-70': 'A516-GR70',
  'A516 GR 70': 'A516-GR70',
  'A516 Gr 60': 'A516-GR60',
  'A537 Cl 1': 'A537-CL1',
  'A537-1': 'A537-CL1',
  'SS316L': 'A312-TP316L',
  '316L': 'A312-TP316L',
  'TP316L': 'A312-TP316L',
  'SS316': 'A312-TP316',
  '316': 'A312-TP316',
  'SS304L': 'A312-TP304L',
  '304L': 'A312-TP304L',
  'SS304': 'A312-TP304',
  '304': 'A312-TP304',
  'MONEL 400': 'B165-N04400',
  'MONEL-400': 'B165-N04400',
  'N04400': 'B165-N04400',
  'B564 N04400': 'B564-N04400',
  'INCOLOY 825': 'B423-N08825',
  'INCOLOY-825': 'B423-N08825',
  'N08825': 'B423-N08825',
  'B564 N08825': 'B564-N08825',
  'INCOLOY 800H': 'B407-N08810',
  'INCOLOY-800H': 'B407-N08810',
  'N08810': 'B407-N08810',
  'ALLOY 20': 'B464-N08020',
  'ALLOY-20': 'B464-N08020',
  'N08020': 'B464-N08020',
  '6MO': 'A312-UNS-S31254',
  '6-MO': 'A312-UNS-S31254',
  '254SMO': 'A312-UNS-S31254',
  'S31254': 'A312-UNS-S31254',
  'CU-NI 90/10': 'B466-UNS-C70600',
  'C70600': 'B466-UNS-C70600',
  'CU-NI 70/30': 'B466-UNS-C71500',
  'C71500': 'B466-UNS-C71500',
  'TI GR 2': 'B861-TI-GR2',
  'TI-GR2': 'B861-TI-GR2',
  'TI GR 5': 'B861-TI-GR5',
  'TI-GR5': 'B861-TI-GR5',
  'TI GR 7': 'B861-TI-GR7',
  'TI-GR7': 'B861-TI-GR7',
  'TI GR 12': 'B861-TI-GR12',
  'TI-GR12': 'B861-TI-GR12',
  'INCONEL 625': 'B444-INCONEL-625',
  'HASTELLOY C276': 'B622-HASTELLOY-C276',
  'HASTELLOY-C276': 'B622-HASTELLOY-C276',
  'HASTELLOY C22': 'B574-N06022',
  'INCONEL 600': 'B163-N06600',
  '2205': 'A790-UNS-S31803',
  'DUPLEX 2205': 'A790-UNS-S31803',
  '2507': 'A790-UNS-S32750',
  'SUPER DUPLEX 2507': 'A790-UNS-S32750',
  'A216 WCB': 'A216-WCB',
  'A352 LCB': 'A352-LCB',
  'A351 CF8M': 'A351-CF8M',
  'A193 B7': 'A193-B7',
  'A193 B7M': 'A193-B7M',
  'A320 L7': 'A320-L7',
  'A193 B8M': 'A193-B8M'
};

/**
 * Resolve material identifier accounting for common naming variants.
 * @param {string} materialId
 * @returns {MaterialStressRecord | undefined}
 */
function resolveMaterial(materialId) {
  if (!materialId || typeof materialId !== 'string') {
    return undefined;
  }
  if (ASME_MATERIAL_CATALOG[materialId]) {
    return ASME_MATERIAL_CATALOG[materialId];
  }
  const trimmed = materialId.trim();
  const upper = trimmed.toUpperCase();
  if (ASME_MATERIAL_CATALOG[upper]) {
    return ASME_MATERIAL_CATALOG[upper];
  }
  const aliasTarget = MATERIAL_ALIASES[upper];
  if (aliasTarget && ASME_MATERIAL_CATALOG[aliasTarget]) {
    return ASME_MATERIAL_CATALOG[aliasTarget];
  }
  const hyphenated = upper.replace(/\s+/g, '-');
  if (ASME_MATERIAL_CATALOG[hyphenated]) {
    return ASME_MATERIAL_CATALOG[hyphenated];
  }
  const aliasHyphenated = MATERIAL_ALIASES[hyphenated];
  if (aliasHyphenated && ASME_MATERIAL_CATALOG[aliasHyphenated]) {
    return ASME_MATERIAL_CATALOG[aliasHyphenated];
  }
  return undefined;
}

/**
 * Query ASME Section II Part D allowable stress S at a given design temperature.
 * Performs code-governed linear interpolation between temperature milestones.
 *
 * @param {string} materialId
 * @param {number} tempC - Design temperature in Celsius
 * @returns {{allowableStressMPa: number, yieldStrengthMPa: number, elasticModulusGPa: number, thermalExpansionCoeff: number}}
 */
function getMaterialPropertiesAtTemp(materialId, tempC) {
  const mat = resolveMaterial(materialId);
  if (!mat) {
    throw new Error(`Material "${materialId}" not found in ASME Section II Part D catalog. Available: ${Object.keys(ASME_MATERIAL_CATALOG).join(', ')}`);
  }

  if (tempC < mat.minTempC) {
    throw new Error(`Temperature ${tempC} °C is below MDMT limit ${mat.minTempC} °C for ${mat.id} per ASME B31.3.`);
  }
  if (tempC > mat.maxTempC) {
    throw new Error(`Temperature ${tempC} °C exceeds ASME Section II Part D maximum code limit ${mat.maxTempC} °C for ${mat.id}.`);
  }

  // Linear interpolation for stress
  const table = mat.tempDerating;
  let s = table[0].allowableStressMPa;
  let sy = table[0].yieldStrengthMPa;

  if (tempC <= table[0].tempC) {
    s = table[0].allowableStressMPa;
    sy = table[0].yieldStrengthMPa;
  } else if (tempC >= table[table.length - 1].tempC) {
    s = table[table.length - 1].allowableStressMPa;
    sy = table[table.length - 1].yieldStrengthMPa;
  } else {
    for (let i = 0; i < table.length - 1; i++) {
      if (tempC >= table[i].tempC && tempC <= table[i + 1].tempC) {
        const f = (tempC - table[i].tempC) / (table[i + 1].tempC - table[i].tempC);
        s = table[i].allowableStressMPa + f * (table[i + 1].allowableStressMPa - table[i].allowableStressMPa);
        sy = table[i].yieldStrengthMPa + f * (table[i + 1].yieldStrengthMPa - table[i].yieldStrengthMPa);
        break;
      }
    }
  }

  // Linear interpolation for physical properties (E and alpha)
  const ptable = mat.physicalProps;
  let e = ptable[0].elasticModulusGPa;
  let alpha = ptable[0].thermalExpansionCoeff;

  if (tempC <= ptable[0].tempC) {
    e = ptable[0].elasticModulusGPa;
    alpha = ptable[0].thermalExpansionCoeff;
  } else if (tempC >= ptable[ptable.length - 1].tempC) {
    e = ptable[ptable.length - 1].elasticModulusGPa;
    alpha = ptable[ptable.length - 1].thermalExpansionCoeff;
  } else {
    for (let i = 0; i < ptable.length - 1; i++) {
      if (tempC >= ptable[i].tempC && tempC <= ptable[i + 1].tempC) {
        const f = (tempC - ptable[i].tempC) / (table[i + 1].tempC - table[i].tempC);
        e = ptable[i].elasticModulusGPa + f * (ptable[i + 1].elasticModulusGPa - ptable[i].elasticModulusGPa);
        alpha = ptable[i].thermalExpansionCoeff + f * (ptable[i + 1].thermalExpansionCoeff - ptable[i].thermalExpansionCoeff);
        break;
      }
    }
  }

  return {
    allowableStressMPa: s,
    yieldStrengthMPa: sy,
    elasticModulusGPa: e,
    thermalExpansionCoeff: alpha
  };
}

module.exports = {
  ASME_MATERIAL_CATALOG,
  getMaterialPropertiesAtTemp,
  resolveMaterial
};
