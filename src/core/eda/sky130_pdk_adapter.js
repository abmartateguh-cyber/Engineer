/**
 * OmniEng SkyWater 130nm PDK (sky130_fd_sc_hd) Standard Cell & Routing Adapter
 * Built-in standard cell geometry, pin definitions, metal stack, and NLDM timing models.
 *
 * Open-source silicon parity: Efabless OpenLane / Google SkyWater 130nm High-Density.
 * Zero external dependencies.
 */

'use strict';

class Sky130PdkAdapter {
  constructor() {
    this.processName = 'sky130_fd_sc_hd';
    this.techNodeNm = 130;
    this.siteHeightUm = 2.72; // Standard cell row height in sky130_fd_sc_hd
    this.siteWidthUm = 0.46;  // Standard cell placement site grid pitch

    // Layer stack (li1 to met5)
    this.layers = {
      li1: { name: 'li1', index: 0, pitchUm: 0.34, minWidthUm: 0.17, sheetResOhmSq: 12.8, thicknessUm: 0.10, direction: 'horizontal' },
      met1: { name: 'met1', index: 1, pitchUm: 0.34, minWidthUm: 0.14, sheetResOhmSq: 0.125, thicknessUm: 0.36, direction: 'vertical' },
      met2: { name: 'met2', index: 2, pitchUm: 0.46, minWidthUm: 0.14, sheetResOhmSq: 0.125, thicknessUm: 0.36, direction: 'horizontal' },
      met3: { name: 'met3', index: 3, pitchUm: 0.68, minWidthUm: 0.30, sheetResOhmSq: 0.047, thicknessUm: 0.85, direction: 'vertical' },
      met4: { name: 'met4', index: 4, pitchUm: 0.92, minWidthUm: 0.30, sheetResOhmSq: 0.047, thicknessUm: 0.85, direction: 'horizontal' },
      met5: { name: 'met5', index: 5, pitchUm: 1.80, minWidthUm: 1.60, sheetResOhmSq: 0.029, thicknessUm: 1.26, direction: 'vertical' }
    };

    // Standard cell catalog
    this.cells = {
      'sky130_fd_sc_hd__inv_1': {
        name: 'sky130_fd_sc_hd__inv_1',
        description: '1x Inverter',
        widthUm: 1.38,
        heightUm: 2.72,
        pins: {
          A: { name: 'A', direction: 'INPUT', layer: 'met1', offsetUm: [0.38, 1.36], capFf: 3.2 },
          Y: { name: 'Y', direction: 'OUTPUT', layer: 'met1', offsetUm: [1.02, 1.36], maxCapFf: 60.0 },
          VPWR: { name: 'VPWR', direction: 'INOUT', layer: 'met1', offsetUm: [0.69, 2.72], use: 'POWER' },
          VGND: { name: 'VGND', direction: 'INOUT', layer: 'met1', offsetUm: [0.69, 0.00], use: 'GROUND' }
        },
        timing: {
          baseDelayPs: 18.5,
          driveResOhm: 3450.0 // Output resistance
        }
      },
      'sky130_fd_sc_hd__nand2_1': {
        name: 'sky130_fd_sc_hd__nand2_1',
        description: '2-Input NAND Gate 1x',
        widthUm: 2.07,
        heightUm: 2.72,
        pins: {
          A: { name: 'A', direction: 'INPUT', layer: 'met1', offsetUm: [0.42, 1.36], capFf: 3.6 },
          B: { name: 'B', direction: 'INPUT', layer: 'met1', offsetUm: [1.12, 1.36], capFf: 3.4 },
          Y: { name: 'Y', direction: 'OUTPUT', layer: 'met1', offsetUm: [1.72, 1.36], maxCapFf: 60.0 },
          VPWR: { name: 'VPWR', direction: 'INOUT', layer: 'met1', offsetUm: [1.03, 2.72], use: 'POWER' },
          VGND: { name: 'VGND', direction: 'INOUT', layer: 'met1', offsetUm: [1.03, 0.00], use: 'GROUND' }
        },
        timing: {
          baseDelayPs: 24.2,
          driveResOhm: 4200.0
        }
      },
      'sky130_fd_sc_hd__nor2_1': {
        name: 'sky130_fd_sc_hd__nor2_1',
        description: '2-Input NOR Gate 1x',
        widthUm: 2.07,
        heightUm: 2.72,
        pins: {
          A: { name: 'A', direction: 'INPUT', layer: 'met1', offsetUm: [0.42, 1.36], capFf: 3.8 },
          B: { name: 'B', direction: 'INPUT', layer: 'met1', offsetUm: [1.12, 1.36], capFf: 3.8 },
          Y: { name: 'Y', direction: 'OUTPUT', layer: 'met1', offsetUm: [1.72, 1.36], maxCapFf: 60.0 },
          VPWR: { name: 'VPWR', direction: 'INOUT', layer: 'met1', offsetUm: [1.03, 2.72], use: 'POWER' },
          VGND: { name: 'VGND', direction: 'INOUT', layer: 'met1', offsetUm: [1.03, 0.00], use: 'GROUND' }
        },
        timing: {
          baseDelayPs: 26.5,
          driveResOhm: 4800.0
        }
      },
      'sky130_fd_sc_hd__buf_2': {
        name: 'sky130_fd_sc_hd__buf_2',
        description: '2x High-Drive Buffer',
        widthUm: 2.07,
        heightUm: 2.72,
        pins: {
          A: { name: 'A', direction: 'INPUT', layer: 'met1', offsetUm: [0.45, 1.36], capFf: 3.4 },
          X: { name: 'X', direction: 'OUTPUT', layer: 'met1', offsetUm: [1.62, 1.36], maxCapFf: 120.0 },
          VPWR: { name: 'VPWR', direction: 'INOUT', layer: 'met1', offsetUm: [1.03, 2.72], use: 'POWER' },
          VGND: { name: 'VGND', direction: 'INOUT', layer: 'met1', offsetUm: [1.03, 0.00], use: 'GROUND' }
        },
        timing: {
          baseDelayPs: 22.0,
          driveResOhm: 1850.0
        }
      },
      'sky130_fd_sc_hd__dfxtp_1': {
        name: 'sky130_fd_sc_hd__dfxtp_1',
        description: 'Positive Edge D-Flip-Flop',
        widthUm: 5.52,
        heightUm: 2.72,
        pins: {
          D: { name: 'D', direction: 'INPUT', layer: 'met1', offsetUm: [0.55, 1.36], capFf: 3.2 },
          CLK: { name: 'CLK', direction: 'INPUT', layer: 'met1', offsetUm: [1.85, 1.36], capFf: 4.8 },
          Q: { name: 'Q', direction: 'OUTPUT', layer: 'met1', offsetUm: [4.90, 1.36], maxCapFf: 60.0 },
          VPWR: { name: 'VPWR', direction: 'INOUT', layer: 'met1', offsetUm: [2.76, 2.72], use: 'POWER' },
          VGND: { name: 'VGND', direction: 'INOUT', layer: 'met1', offsetUm: [2.76, 0.00], use: 'GROUND' }
        },
        timing: {
          baseDelayPs: 85.0, // Clk-to-Q delay
          driveResOhm: 3600.0,
          tSetupPs: 35.0,
          tHoldPs: 15.0
        }
      }
    };
  }

  /**
   * Generates IEEE LEF 5.8 ASCII syntax for the Sky130 HD library
   * @returns {string} LEF definition text
   */
  generateLEF() {
    const lines = [
      'VERSION 5.8 ;',
      'BUSBITCHARS "[]" ;',
      'DIVIDERCHAR "/" ;',
      ''
    ];

    // Layers
    for (const [name, layer] of Object.entries(this.layers)) {
      lines.push(`LAYER ${name}`);
      lines.push('  TYPE ROUTING ;');
      lines.push(`  PITCH ${layer.pitchUm.toFixed(3)} ;`);
      lines.push(`  WIDTH ${layer.minWidthUm.toFixed(3)} ;`);
      lines.push(`END ${name}`, '');
    }

    // Macros
    for (const [name, cell] of Object.entries(this.cells)) {
      lines.push(`MACRO ${name}`);
      lines.push('  CLASS CORE ;');
      lines.push('  ORIGIN 0.000 0.000 ;');
      lines.push(`  SIZE ${cell.widthUm.toFixed(3)} BY ${cell.heightUm.toFixed(3)} ;`);

      for (const [pinName, pin] of Object.entries(cell.pins)) {
        lines.push(`  PIN ${pinName}`);
        lines.push(`    DIRECTION ${pin.direction} ;`);
        lines.push(`    USE ${pin.use || 'SIGNAL'} ;`);
        lines.push('    PORT');
        lines.push(`      LAYER ${pin.layer} ;`);
        const x1 = (pin.offsetUm[0] - 0.07).toFixed(3);
        const y1 = (pin.offsetUm[1] - 0.07).toFixed(3);
        const x2 = (pin.offsetUm[0] + 0.07).toFixed(3);
        const y2 = (pin.offsetUm[1] + 0.07).toFixed(3);
        lines.push(`      RECT ${x1} ${y1} ${x2} ${y2} ;`);
        lines.push('    END');
        lines.push(`  END ${pinName}`);
      }

      lines.push(`END ${name}`, '');
    }

    return lines.join('\n');
  }

  /**
   * Computes Non-Linear Delay Model (NLDM) gate propagation delay
   * tau = baseDelay + driveRes * loadCap
   * @param {string} cellName
   * @param {number} loadCapFf - Load capacitance in femtofarads
   * @param {string} [corner='tt'] - 'tt', 'ss', 'ff'
   * @returns {Object} Delay metrics
   */
  computeCellDelay(cellName, loadCapFf = 10.0, corner = 'tt') {
    const cell = this.cells[cellName];
    if (!cell) throw new Error(`Unknown Sky130 cell: ${cellName}`);

    // PVT derate factor
    let pvtDerate = 1.0;
    if (corner === 'ss') pvtDerate = 1.25; // Slow process, 100C, 1.60V
    if (corner === 'ff') pvtDerate = 0.80; // Fast process, -40C, 1.95V

    const Cload_F = loadCapFf * 1e-15;
    const tauRC_s = cell.timing.driveResOhm * Cload_F;
    const delayPs = (cell.timing.baseDelayPs + tauRC_s * 1e12) * pvtDerate;

    return {
      cellName,
      corner,
      loadCapFf,
      baseDelayPs: cell.timing.baseDelayPs * pvtDerate,
      loadDependentDelayPs: (tauRC_s * 1e12) * pvtDerate,
      totalDelayPs: Number(delayPs.toFixed(2)),
      totalDelayNs: Number((delayPs / 1000.0).toFixed(4))
    };
  }
}

module.exports = {
  Sky130PdkAdapter
};
