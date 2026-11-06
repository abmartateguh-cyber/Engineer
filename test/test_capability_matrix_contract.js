'use strict';

/**
 * Contract for the industrialization capability-matrix artifacts (WS-02):
 *   1. scripts/generate_capability_matrix.js runs standalone (exit 0) and
 *      writes a non-empty markdown matrix into a temp directory (no network).
 *   2. The generated matrix contains the required column header row.
 *   3. The matrix contains at least one "gap: no verified production path"
 *      row, i.e. an advertised capability without a verified IPC route
 *      (guards against fabricated production paths).
 *   4. docs/industrialization/reference_registry.md exists and records the
 *      NASA_TMR_FLAT_PLATE and SPARSE_SPD_GENERATED_SUITE case IDs.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HEADER_ROW =
  '| Domain | Capability | Engine/Adapter | Production IPC path | Preload surface | UI/headless route | Evidence status |';

function runCapabilityMatrixContractTests() {
  const checks = [];
  const record = (label, fn) => {
    try {
      fn();
      checks.push({ label, ok: true });
    } catch (error) {
      checks.push({ label, ok: false, error: error.message });
    }
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnieng-capmatrix-'));
  const genScript = path.join(__dirname, '..', 'scripts', 'generate_capability_matrix.js');
  const outFile = path.join(tmpDir, 'capability_matrix.md');

  const child = spawnSync(process.execPath, [genScript], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, OMNIENG_CAP_MATRIX_OUT: outFile }
  });

  record('generator exits 0', () => {
    assert.strictEqual(child.status, 0, `generator exit ${child.status}; stderr: ${child.stderr}`);
  });

  let generated = '';
  record('generated markdown exists and is non-empty', () => {
    assert(fs.existsSync(outFile), `expected generated matrix at ${outFile}`);
    generated = fs.readFileSync(outFile, 'utf8');
    assert(generated.trim().length > 0, 'generated matrix must not be empty');
  });

  record('matrix contains the required column header', () => {
    assert(generated.includes(HEADER_ROW), 'missing header row in generated matrix');
  });

  record('matrix keeps unbound capabilities as explicit gaps', () => {
    const gapRows = generated.split('\n').filter((line) => line.startsWith('| ') && line.includes('gap:'));
    assert(gapRows.length > 0, 'expected at least one advertised capability without a verified IPC route');
  });

  record('matrix binds the 3D FVM capability only to the actual FVM IPC route', () => {
    const row = generated
      .split('\n')
      .find((line) => line.startsWith('| cfd | Experimental 3D FVM Navier-Stokes Box-Flow Step'));
    assert(row, 'missing 3D FVM capability row');
    assert.match(row, /omni:solve-fvm-cfd-3d/);
    assert.doesNotMatch(row, /omni:step-simple-cfd/);
  });

  record('matrix maps CAM and BOM only to their actual routes', () => {
    const roughing = generated
      .split('\n')
      .find((line) => line.startsWith('| cam | Experimental 3-Axis Constant-Z Planar Roughing'));
    const bom = generated.split('\n').find((line) => line.startsWith('| pdm | Caller-Supplied BOM Roll-Up'));
    assert.match(roughing || '', /omni:cam-generate-toolpath/);
    assert.match(roughing || '', /CAMEngineAdapter\.plan_roughing_toolpath/);
    assert.match(bom || '', /omni:rollup-ebom/);
    assert.doesNotMatch(bom || '', /omni:add-blob/);
  });

  record('matrix reports unavailable FMI route and does not map Bode to block simulation', () => {
    const fmi = generated.split('\n').find((line) => line.startsWith('| cosim | FMI Master Operation'));
    const dynamicBlock = generated
      .split('\n')
      .find((line) => line.startsWith('| dynamic_simulink | Causal Block-Diagram'));
    assert.match(fmi || '', /omni:run-fmi-cosimulation/);
    assert.match(fmi || '', /unavailable/i);
    assert.match(dynamicBlock || '', /omni:simulate-block-diagram/);
    assert.doesNotMatch(dynamicBlock || '', /omni:solve-bode/);
  });

  record('headless paths are identified separately from IPC paths', () => {
    const steam = generated
      .split('\n')
      .find((line) => line.startsWith('| plant | IAPWS-IF97 Industrial Water & Steam'));
    const scheduler = generated
      .split('\n')
      .find((line) => line.startsWith('| hpc | SLURM/PBS Pro Job Script Templates'));
    assert.match(steam || '', /headless_solver_daemon/);
    assert.match(steam || '', /omni:calculate-steam-properties/);
    assert.match(scheduler || '', /headless_solver_daemon/);
    assert.match(scheduler || '', /gap: no explicit IPC binding/);
  });

  record('CAM IPC route requires explicit stock, tool, and program inputs', () => {
    const cadIpc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'cad_ipc.js'), 'utf8');
    const routeStart = cadIpc.indexOf("'omni:cam-generate-toolpath'");
    const routeEnd = cadIpc.indexOf("'omni:get-rocket-feature-tree'", routeStart);
    const route = cadIpc.slice(routeStart, routeEnd);
    assert.match(route, /required: \['bounds', 'options', 'programNumber'\]/);
    assert.doesNotMatch(route, /params\.bounds\s*\|\||params\.options\s*\|\|/);
    assert.match(route, /defaultEngineRegistry\.dispatch/);
  });

  record('generated matrix matches the checked-in matrix byte-for-byte', () => {
    const checkedIn = fs.readFileSync(
      path.join(__dirname, '..', 'docs', 'industrialization', 'capability_matrix.md'),
      'utf8'
    );
    assert.strictEqual(generated, checkedIn);
  });

  const registryPath = path.join(__dirname, '..', 'docs', 'industrialization', 'reference_registry.md');
  record('reference_registry.md exists under docs/industrialization', () => {
    assert(fs.existsSync(registryPath), `missing ${registryPath}`);
  });

  record('reference_registry.md records required case IDs', () => {
    const registry = fs.readFileSync(registryPath, 'utf8');
    assert(registry.includes('NASA_TMR_FLAT_PLATE'), 'reference_registry.md must record NASA_TMR_FLAT_PLATE');
    assert(
      registry.includes('SPARSE_SPD_GENERATED_SUITE'),
      'reference_registry.md must record SPARSE_SPD_GENERATED_SUITE'
    );
  });

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    if (check.ok) {
      console.log(`  ✓ ${check.label}`);
    } else {
      console.error(`  ✗ ${check.label}: ${check.error}`);
    }
  }
  console.log(`Capability-matrix contract: ${checks.length - failed.length}/${checks.length} checks passed.`);

  return { total: checks.length, passed: checks.length - failed.length, failed: failed.length };
}

if (require.main === module) {
  const stats = runCapabilityMatrixContractTests();
  if (stats.failed > 0) process.exitCode = 1;
}

module.exports = { runCapabilityMatrixContractTests };
