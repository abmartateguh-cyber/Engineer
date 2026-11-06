/**
 * Final dead-code / capability sweep (standalone).
 *
 * Run directly: node test/test_final_sweep.js
 * Exposes runFinalSweepTests() -> { total, passed, failed }.
 * Intentionally NOT registered in run_all_tests.js.
 *
 * Scope of this sweep:
 *  (a) The ten newly added public functions all exist and are callable with
 *      valid inputs. Production wiring status at sweep time:
 *        - solveSparse (LinearSolver)          -> wired in src/main/ipc/system_ipc.js
 *        - isPositiveDefinite (LinearSolver)   -> wired in src/main/ipc/system_ipc.js
 *        - solveRadauIIA (ODESolvers)          -> wired in src/main/ipc/system_ipc.js
 *        - generateSlurmScript (HpcClusterGateway) -> wired in headless_solver_daemon.js
 *            and hpc_engine_adapter.js
 *        - generatePbsProScript (HpcClusterGateway) -> unreferenced in production;
 *            exercised here (public API for IPC use)
 *        - analyzeTiming (StaticTimingAnalysis) -> unreferenced in production;
 *            exercised here (public API for IPC use)
 *        - traceInterface (NonSequentialTracer) -> unreferenced in production;
 *            exercised here (public API for IPC use)
 *        - evaluateEvidence (ToolQualificationKit) -> unreferenced in production;
 *            exercised here (public API for IPC use)
 *        - registerTopologicalEntities (PersistentNamingManager) -> unreferenced
 *            in production; exercised here (public API for IPC use)
 *        - exportNurbsSurfaces (StepTranslator) -> unreferenced in production;
 *            exercised here (public API for IPC use)
 *  (b) Zero "TODO(fake)"/"FIXME(mock)" markers remain in src/core.
 *  (c) No hardcoded pass/fail constants ('0.92','0.08','0.005','0.02') remain
 *      in src/core outside documented engineering/correlation constants.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_CORE = path.join(ROOT, 'src', 'core');

const { LinearSolver } = require('../src/core/math/linear_algebra');
const { ODESolvers } = require('../src/core/math/ode_solvers');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { NonSequentialTracer } = require('../src/core/optics/non_sequential_tracer');
const { HpcClusterGateway } = require('../src/core/hpc/hpc_cluster_gateway');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');
const { StepTranslator } = require('../src/core/cad/step_translator');

function walkJs(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(full, out);
    else if (ent.name.endsWith('.js')) out.push(full);
  }
}

function listCoreJsFiles() {
  const files = [];
  walkJs(SRC_CORE, files);
  return files;
}

function runFinalSweepTests() {
  const results = [];
  let total = 0;
  let passed = 0;
  let failed = 0;

  function t(name, fn) {
    total++;
    try {
      fn();
      passed++;
      results.push(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      results.push(
        `  FAIL  ${name}\n        ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n        ') : err}`
      );
    }
  }

  // ---------------------------------------------------------- (a) public API --
  t('solveSparse exists and solves a small SPD system', () => {
    assert.strictEqual(typeof LinearSolver.solveSparse, 'function');
    const A = [[4, 1, 0], [1, 3, 1], [0, 1, 2]];
    const out = LinearSolver.solveSparse(A, [1, 2, 3]);
    assert.ok(out.solution && out.solution.length === 3);
    assert.ok(Number.isFinite(out.relativeResidual));
    assert.strictEqual(typeof out.method, 'string');
    assert.strictEqual(typeof out.converged, 'boolean');
  });

  t('isPositiveDefinite exists and classifies an SPD matrix', () => {
    assert.strictEqual(typeof LinearSolver.isPositiveDefinite, 'function');
    const A = [[4, 1, 0], [1, 3, 1], [0, 1, 2]];
    const out = LinearSolver.isPositiveDefinite(A);
    assert.strictEqual(out.positiveDefinite, true);
    assert.strictEqual(out.n, 3);
  });

  t('solveRadauIIA exists and integrates a stiff decay ODE', () => {
    assert.strictEqual(typeof ODESolvers.solveRadauIIA, 'function');
    const traj = ODESolvers.solveRadauIIA((t, y) => [-y[0]], 0, [1], 1, {});
    assert.ok(traj.length > 1);
    const last = traj[traj.length - 1];
    assert.ok(Number.isFinite(last.t) && Array.isArray(last.y));
    assert.ok(Math.abs(last.y[0] - Math.exp(-1)) < 1e-3);
  });

  t('analyzeTiming exists and analyzes a 3-node DAG', () => {
    assert.strictEqual(typeof StaticTimingAnalysis.analyzeTiming, 'function');
    const graph = {
      nodes: [
        { id: 'a', type: 'input' },
        { id: 'b', type: 'gate', delay: 0.1 },
        { id: 'c', type: 'output' }
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
    };
    const report = StaticTimingAnalysis.analyzeTiming(graph, {
      corners: [{ name: 'typical', delays: {} }],
      modes: [{ name: 'function', constraints: {} }]
    });
    assert.ok(report && typeof report === 'object');
    assert.ok(JSON.stringify(report).length > 0);
  });

  t('traceInterface exists and computes Snell/Fresnel for a ray', () => {
    assert.strictEqual(typeof NonSequentialTracer.traceInterface, 'function');
    const r = NonSequentialTracer.traceInterface(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 1 },
      1.0,
      1.5
    );
    assert.strictEqual(r.tir, false);
    assert.ok(r.refractedDir && Number.isFinite(r.refractedDir.x));
    assert.strictEqual(typeof r.reflectanceR, 'number');
  });

  t('generateSlurmScript exists and emits an sbatch script', () => {
    assert.strictEqual(typeof HpcClusterGateway.generateSlurmScript, 'function');
    const out = HpcClusterGateway.generateSlurmScript({
      jobName: 'final_sweep',
      nodes: 2,
      ntasksPerNode: 4,
      walltime: '01:00:00'
    });
    assert.strictEqual(out.scheduler, 'SLURM');
    assert.ok(out.script.includes('#!/bin/bash'));
    assert.ok(out.script.includes('#SBATCH --nodes=2'));
  });

  t('generatePbsProScript exists and emits a qsub script', () => {
    assert.strictEqual(typeof HpcClusterGateway.generatePbsProScript, 'function');
    const out = HpcClusterGateway.generatePbsProScript({
      jobName: 'final_sweep',
      nodes: 2,
      walltime: '01:00:00'
    });
    assert.strictEqual(out.scheduler, 'PBS_PRO');
    assert.ok(out.script.includes('#!/bin/bash'));
    assert.ok(out.script.includes('#PBS -l'));
  });

  t('evaluateEvidence exists and returns a verdict object', () => {
    const kit = new ToolQualificationKit({ targetSafetyStandard: 'DO-330' });
    assert.strictEqual(typeof kit.evaluateEvidence, 'function');
    const verdict = kit.evaluateEvidence({
      usedFor: 'verification',
      testResults: { passed: 50, failed: 1 },
      coverage: { functions: 95, branches: 90, mcDc: 88 },
      defectTracking: { open: 1, closed: 9, openCritical: 0 },
      configMgmt: { baselines: 2, changes: 5, changesReviewed: 5 }
    });
    assert.ok(Object.prototype.hasOwnProperty.call(verdict, 'verdict'));
    assert.ok(Object.prototype.hasOwnProperty.call(verdict, 'incomplete'));
  });

  t('registerTopologicalEntities exists and records a split/create', () => {
    const mgr = new PersistentNamingManager();
    assert.strictEqual(typeof mgr.registerTopologicalEntities, 'function');
    const faceA = { entityType: 'FACE', attributes: { centroid: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, area: 10 } };
    const faceB = { entityType: 'FACE', attributes: { centroid: { x: -1, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, area: 5 } };
    const faceC = { entityType: 'FACE', attributes: { centroid: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, area: 5 } };
    const res = mgr.registerTopologicalEntities([faceA], [faceB, faceC]);
    assert.ok(['CREATE', 'SPLIT'].includes(res.op));
    assert.ok(Array.isArray(res.childTags) && res.childTags.length === 2);
  });

  t('exportNurbsSurfaces exists and emits STEP NURBS', () => {
    assert.strictEqual(typeof StepTranslator.exportNurbsSurfaces, 'function');
    const solid = {
      faces: [
        {
          vertices: [
            { point: { x: 0, y: 0, z: 0 } },
            { point: { x: 1, y: 0, z: 0 } },
            { point: { x: 1, y: 1, z: 0 } },
            { point: { x: 0, y: 1, z: 0 } }
          ],
          normal: { x: 0, y: 0, z: 1 }
        }
      ]
    };
    const step = StepTranslator.exportNurbsSurfaces(solid, 'FinalSweepModel');
    assert.ok(step.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    assert.ok(step.includes('END-ISO-10303-21;'));
  });

  // ---------------------------------------------------------- (b) marker scan --
  t('no TODO(fake)/FIXME(mock) markers remain in src/core', () => {
    const markerRe = /TODO\(fake\)|FIXME\(mock\)/;
    const offenders = [];
    for (const file of listCoreJsFiles()) {
      const content = fs.readFileSync(file, 'utf8');
      if (markerRe.test(content)) offenders.push(path.relative(ROOT, file));
    }
    assert.deepStrictEqual(offenders, [], `markers found in: ${offenders.join(', ')}`);
  });

  // ---------------------------------------- (c) hardcoded pass/fail constants --
  t('no hardcoded pass/fail constants (0.92/0.08/0.005/0.02) remain in src/core', () => {
    const literals = ['0.92', '0.08', '0.005', '0.02'];
    // Verdict contexts: strict equality against the literal (a fabricated exact
    // match), returning the literal as a verdict, or assigning the literal to a
    // pass/fail-named field to fake a test outcome. Arithmetic use inside
    // physical formulas and documented engineering/correlation constants are
    // intentionally not treated as pass/fail constants.
    const verdictRe = new RegExp(
      [
        '(===|==|!==|!=)\\s*0\\.(92|08|005|02)\\b',
        'return\\s+0\\.(92|08|005|02)\\b',
        '(pass|fail|verdict|expected|outcome)\\s*=\\s*0\\.(92|08|005|02)\\b'
      ].join('|'),
      'i'
    );
    const offenders = [];
    for (const file of listCoreJsFiles()) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!literals.some((lit) => line.includes(lit))) continue;
        if (verdictRe.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [], `verdict-context constants found:\n  ${offenders.join('\n  ')}`);
  });

  const summary = { total, passed, failed };
  console.log('\n[final-sweep] results:');
  results.forEach((line) => console.log(line));
  console.log(`summary: total=${summary.total} passed=${summary.passed} failed=${summary.failed}`);
  return summary;
}

if (require.main === module) {
  const summary = runFinalSweepTests();
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

module.exports = { runFinalSweepTests };
