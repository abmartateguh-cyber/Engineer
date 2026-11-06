/**
 * Unit and Verification Tests for PIDFlowsheetBridge.
 *
 * Verifies:
 * 1. Extraction of flowsheet stream thermodynamics into P&ID line specifications.
 * 2. Automated hydraulic line sizing for liquid and gas streams.
 * 3. H&MB summary table generation matching industrial format.
 * 4. Equipment overpressure PSV sizing.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PIDFlowsheetBridge } = require('../src/core/plant/pid_flowsheet_bridge');

describe('PIDFlowsheetBridge: Flowsheet-to-P&ID Synchronization & H&MB', () => {
  const bridge = new PIDFlowsheetBridge();

  it('synchronizes flowsheet streams with automated line sizing and H&MB table', () => {
    const mockFlowsheet = {
      streams: {
        'S-101': {
          from: 'FEED_PUMP',
          to: 'FLASH_DRUM_1',
          temperatureC: 45.0,
          pressureBar: 18.0,
          massFlowKgS: 25.0,
          molarFlowKmolH: 500.0,
          vaporFraction: 0.0,
          densityKgM3: 920.0,
          viscosityPaS: 0.0012,
          isPumpDischarge: true
        },
        'S-102': {
          from: 'FLASH_DRUM_1',
          to: 'GAS_COMPRESSOR',
          temperatureC: 42.0,
          pressureBar: 12.0,
          massFlowKgS: 8.0,
          molarFlowKmolH: 450.0,
          vaporFraction: 1.0,
          densityKgM3: 14.5,
          viscosityPaS: 0.000014
        }
      },
      unitOperations: {
        FEED_PUMP: { type: 'PUMP', powerKW: 45.0, pressureBar: 18.0 },
        FLASH_DRUM_1: { type: 'FLASH_DRUM', pressureBar: 12.0, temperatureC: 45.0, vaporOutKgH: 28800.0 }
      }
    };

    const synced = bridge.synchronize(mockFlowsheet);

    assert.equal(synced.success, true);
    assert.equal(synced.streamsCount, 2);
    assert.equal(synced.equipmentCount, 2);

    // Check line sizing
    assert.equal(synced.lines.length, 2);
    const liqLine = synced.lines.find((l) => l.streamId === 'S-101');
    assert.ok(liqLine, 'Must size S-101');
    assert.ok(liqLine.sizing.compliant, 'S-101 sizing must be compliant');
    assert.ok(['3', '4', '6'].includes(liqLine.sizing.nps), `Recommended NPS ${liqLine.sizing.nps}`);

    // Check H&MB table
    assert.equal(synced.hmbSummaryTable.length, 2);
    const gasHmb = synced.hmbSummaryTable.find((h) => h.streamId === 'S-102');
    assert.equal(gasHmb.phase, 'VAPOR');
    assert.ok(gasHmb.velocityMS > 5.0, `Gas velocity ${gasHmb.velocityMS} m/s`);

    // Check PSV sizing
    assert.ok(synced.reliefValves.length >= 1, 'Must size PSV on pressurized flash drum');
    const psv = synced.reliefValves[0];
    assert.equal(psv.protectedEquipmentId, 'FLASH_DRUM_1');
    assert.ok(psv.requiredAreaMm2 > 0);
    assert.ok(psv.selectedOrifice);
  });
});
