'use strict';

// Arbitrary test-only values for exercising the RC formulas; not measured or process-derived.
const EXPERIMENTAL_SPEF_TEST_DATA = Object.freeze({
  name: 'synthetic-spef-formula-test-data',
  provenance: Object.freeze({
    source: 'project-authored synthetic test fixture; not physical design data',
    license: 'project-authored test fixture'
  }),
  layers: Object.freeze({
    test_metal_a: Object.freeze({
      sheetResOhmSq: 2.5,
      capAreaFfUm2: 0.0021,
      capFringeFfUm: 0.0034,
      viaResOhm: 7.25
    }),
    test_metal_b: Object.freeze({
      sheetResOhmSq: 1.75,
      capAreaFfUm2: 0.0018,
      capFringeFfUm: 0.0029,
      viaResOhm: 5.5
    })
  })
});

module.exports = { EXPERIMENTAL_SPEF_TEST_DATA };
