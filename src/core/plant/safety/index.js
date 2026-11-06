/**
 * Unified Process Safety & Functional Safety (SIS) Module Index.
 *
 * Exports:
 *  1. sil_iec61511: IEC 61511 / IEC 61508 SIF verification engine
 *  2. lopa: CCPS Layer of Protection Analysis engine
 *  3. cause_effect_matrix: Industrial C&E Matrix & SVG/CSV generator
 *  4. hazardous_area_iec60079: IEC 60079-10-1 Hazardous Area Classification
 *  5. fire_gas_detection: F&G detector voting and NFPA 15 deluge sizing
 *  6. flare_radiation_api521: API 521 flare radiation & sterile boundary engine
 *  7. hazop_worksheet: IEC 61882 HAZOP study generator
 */

'use strict';

const sil = require('./sil_iec61511');
const lopa = require('./lopa');
const causeEffect = require('./cause_effect_matrix');
const hazardousArea = require('./hazardous_area_iec60079');
const fireGas = require('./fire_gas_detection');
const flareRadiation = require('./flare_radiation_api521');
const hazop = require('./hazop_worksheet');

module.exports = {
  // SIL / IEC 61511
  ...sil,
  // LOPA
  ...lopa,
  // Cause & Effect
  ...causeEffect,
  // Hazardous Area IEC 60079
  ...hazardousArea,
  // Fire & Gas Detection & NFPA 15
  ...fireGas,
  // Flare Radiation API 521
  ...flareRadiation,
  // HAZOP IEC 61882
  ...hazop,

  // Namespaced sub-objects for structured access
  silEngine: sil,
  lopaEngine: lopa,
  causeEffectEngine: causeEffect,
  hazardousAreaEngine: hazardousArea,
  fireGasEngine: fireGas,
  flareRadiationEngine: flareRadiation,
  hazopEngine: hazop
};
