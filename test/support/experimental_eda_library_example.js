'use strict';

/**
 * Synthetic library fixture for adapter smoke checks only.
 * Values are not sourced SKY130 data and are not suitable for chip design.
 */
function getExperimentalEdaLibraryExample() {
  const commonPowerPins = (x) => ({
    VPWR: { name: 'VPWR', direction: 'INOUT', layer: 'metal1', offsetUm: [x, 2.65], use: 'POWER' },
    VGND: { name: 'VGND', direction: 'INOUT', layer: 'metal1', offsetUm: [x, 0.07], use: 'GROUND' }
  });
  const cell = (name, description, widthUm, baseDelayPs, driveResOhm, signalPins) => ({
    name,
    description,
    class: 'CORE',
    widthUm,
    heightUm: 2.72,
    pins: Object.fromEntries(
      Object.entries({ ...signalPins, ...commonPowerPins(widthUm / 2) }).map(([pinName, pin]) => [
        pinName,
        {
          ...pin,
          use: pin.use || 'SIGNAL',
          rectUm: [pin.offsetUm[0] - 0.07, pin.offsetUm[1] - 0.07, pin.offsetUm[0] + 0.07, pin.offsetUm[1] + 0.07]
        }
      ])
    ),
    timing: { baseDelayPs, driveResOhm }
  });

  return {
    libraryName: 'synthetic-test-cell-library',
    processName: 'synthetic-example',
    provenance: {
      source: 'Synthetic test fixture; no external source or PDK revision is recorded.',
      license: 'Test-only synthetic fixture; redistribution status is unreviewed.'
    },
    layers: {
      metal1: {
        name: 'metal1',
        type: 'ROUTING',
        index: 0,
        pitchUm: 0.34,
        minWidthUm: 0.14,
        sheetResOhmSq: 0.125,
        direction: 'horizontal'
      },
      metal2: {
        name: 'metal2',
        type: 'ROUTING',
        index: 1,
        pitchUm: 0.46,
        minWidthUm: 0.14,
        sheetResOhmSq: 0.125,
        direction: 'vertical'
      }
    },
    cornerDerates: { typical: 1, slow: 1.25, fast: 0.8 },
    cells: {
      demo_inv: cell('demo_inv', 'Synthetic inverter example', 1.38, 18.5, 3450, {
        A: { name: 'A', direction: 'INPUT', layer: 'metal1', offsetUm: [0.38, 1.36], capFf: 3.2 },
        Y: { name: 'Y', direction: 'OUTPUT', layer: 'metal1', offsetUm: [1.02, 1.36], maxCapFf: 60 }
      }),
      demo_nand2: cell('demo_nand2', 'Synthetic two-input NAND example', 2.07, 24.2, 4200, {
        A: { name: 'A', direction: 'INPUT', layer: 'metal1', offsetUm: [0.42, 1.36], capFf: 3.6 },
        B: { name: 'B', direction: 'INPUT', layer: 'metal1', offsetUm: [1.12, 1.36], capFf: 3.4 },
        Y: { name: 'Y', direction: 'OUTPUT', layer: 'metal1', offsetUm: [1.72, 1.36], maxCapFf: 60 }
      }),
      demo_nor2: cell('demo_nor2', 'Synthetic two-input NOR example', 2.07, 26.5, 4800, {
        A: { name: 'A', direction: 'INPUT', layer: 'metal1', offsetUm: [0.42, 1.36], capFf: 3.8 },
        B: { name: 'B', direction: 'INPUT', layer: 'metal1', offsetUm: [1.12, 1.36], capFf: 3.8 },
        Y: { name: 'Y', direction: 'OUTPUT', layer: 'metal1', offsetUm: [1.72, 1.36], maxCapFf: 60 }
      }),
      demo_buf: cell('demo_buf', 'Synthetic buffer example', 2.07, 22, 1850, {
        A: { name: 'A', direction: 'INPUT', layer: 'metal1', offsetUm: [0.45, 1.36], capFf: 3.4 },
        Y: { name: 'Y', direction: 'OUTPUT', layer: 'metal1', offsetUm: [1.62, 1.36], maxCapFf: 120 }
      }),
      demo_dff: cell('demo_dff', 'Synthetic edge-triggered storage example', 5.52, 85, 3600, {
        D: { name: 'D', direction: 'INPUT', layer: 'metal1', offsetUm: [0.55, 1.36], capFf: 3.2 },
        CLK: { name: 'CLK', direction: 'INPUT', layer: 'metal1', offsetUm: [1.85, 1.36], capFf: 4.8 },
        Q: { name: 'Q', direction: 'OUTPUT', layer: 'metal1', offsetUm: [4.9, 1.36], maxCapFf: 60 }
      })
    }
  };
}

module.exports = { getExperimentalEdaLibraryExample };
