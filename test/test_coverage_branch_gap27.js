'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 27).
 *
 * Targets remaining uncovered branch blocks in the EDA engine cluster (GDSII,
 * OASIS, Liberty parser, logic synthesis, P&R, STA, polygon booleans, DRC,
 * SPICE, MCMM STA, CCS timing model, EDA adapter), the security cluster (IPC
 * validator, enterprise IAM), the storage cluster (Omni archive v1/v2/v3,
 * WAL, journal, vault, project manager), the contracts cluster (engine
 * registry, EngineAdapter, JobRequest, Quantity, ToolDefinition,
 * ToolProposal, ValidationRecord), the compliance cluster (tool qualification
 * kit, ASME VIII-2), maturity, and reporting modules. No production source is
 * modified.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const { IPCValidator } = require('../src/core/security/ipc_validator');
const { EnterpriseIAM, ACTIONS } = require('../src/core/security/enterprise_iam');
const {
  EngineRegistry,
  createDefaultEngineRegistry,
  defaultEngineRegistry
} = require('../src/core/contracts/engine_registry');
const { EngineAdapter } = require('../src/core/contracts/EngineAdapter');
const { JobRequest, JobPriority } = require('../src/core/contracts/JobRequest');
const { Quantity, Dimensions, UnitRegistry, dimensionsEqual } = require('../src/core/contracts/Quantity');
const { ToolDefinition, ToolApprovalClass, ToolClassification } = require('../src/core/contracts/ToolDefinition');
const { ToolProposal, ProposalStatus } = require('../src/core/contracts/ToolProposal');
const { ValidationRecord, ValidationMaturity } = require('../src/core/contracts/ValidationRecord');
const {
  GdsLibrary,
  GdsStructure,
  GdsPolygon,
  GdsPath,
  GdsiiStreamEngine,
  GdsRecordType,
  floatToGdsReal,
  gdsRealToFloat
} = require('../src/core/eda/gdsii_stream');
const { OasisStreamEngine } = require('../src/core/eda/oasis_stream_engine');
const { parseLiberty, LibertyTable, LibertyLibrary, LibertyTiming } = require('../src/core/eda/liberty_parser');
const { LogicSynthesisEngine, STANDARD_CELL_LIB } = require('../src/core/eda/logic_synthesis');
const { PlaceAndRouteEngine } = require('../src/core/eda/place_and_route_engine');
const { StaticTimingAnalysis } = require('../src/core/eda/static_timing_analysis');
const { Polygon2D, PolygonBooleanEngine } = require('../src/core/eda/polygon_boolean_engine');
const { DRCEngine } = require('../src/core/eda/drc_engine');
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { MCMMStaticTimingEngine, MCMMTimingCorner } = require('../src/core/eda/mcmm_sta_engine');
const { CCSTimingModel } = require('../src/core/eda/ccs_timing_model');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');
const {
  OmniArchive,
  OmniArchiveV2,
  OmniArchiveV3,
  CommandJournal,
  OmniVaultAES256,
  OmniWal,
  WAL_FILE_NAME,
  calculateCRC32,
  saveAtomicSync,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2,
  VAULT_MAGIC_BYTES,
  DEFAULT_CHUNK_SIZE
} = require('../src/core/storage/omni_archive');
const { ProjectManager, activeProjectManager } = require('../src/core/storage/project_manager');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const {
  ASMESectionVIIIDiv2Analyzer,
  linearizeStressThroughThickness,
  evaluatePart5Allowables
} = require('../src/core/compliance/asme_section_viii_div2');
const {
  MATURITY_STATES,
  DOMAIN_MATURITY,
  getFeatureMaturity,
  listFeatureMaturity,
  getDomainMaturity,
  getAllDomainMaturity,
  getMaturitySummary,
  getReleaseGatedDomains,
  isReleaseApproved,
  listCorrelatedDomains
} = require('../src/core/maturity/feature_maturity');
const { AuditReportGenerator } = require('../src/core/reporting/audit_report');

async function runBranchGapTwentySevenCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Security cluster: IPCValidator
  // ------------------------------------------------------------------
  check('IPCValidator sanitize primitives, buffers, arrays, and pollution vectors', () => {
    assert.strictEqual(IPCValidator.sanitize(null), null);
    assert.strictEqual(IPCValidator.sanitize(42), 42);
    assert.strictEqual(IPCValidator.sanitize('text'), 'text');
    const buf = Buffer.from([1, 2, 3]);
    const bufCopy = IPCValidator.sanitize(buf);
    assert.notStrictEqual(bufCopy, buf);
    assert.deepStrictEqual(bufCopy, buf);
    const u8 = new Uint8Array([9, 8]);
    const u8Copy = IPCValidator.sanitize(u8);
    assert.notStrictEqual(u8Copy, u8);
    assert.deepStrictEqual(Array.from(u8Copy), [9, 8]);
    const arr = IPCValidator.sanitize([1, { a: 2 }]);
    assert.deepStrictEqual(arr, [1, { a: 2 }]);
    const dirty = {};
    dirty['__proto__'] = { polluted: true };
    dirty.constructor = { hacked: true };
    dirty.prototype = { evil: true };
    dirty.ok = 1;
    const clean = IPCValidator.sanitize(dirty);
    assert.strictEqual(clean.ok, 1);
    assert.strictEqual(clean.polluted, undefined);
    assert.strictEqual(clean.hacked, undefined);
    assert.strictEqual(clean.evil, undefined);
    assert.strictEqual(Object.getPrototypeOf(clean), Object.prototype);
  });

  check('IPCValidator validateFiniteNumbers branches', () => {
    assert.strictEqual(IPCValidator.validateFiniteNumbers({ a: 1, b: 2.5 }, ['a', 'b']), true);
    assert.throws(() => IPCValidator.validateFiniteNumbers(null, ['a']), /non-null object/);
    assert.throws(() => IPCValidator.validateFiniteNumbers('nope', ['a']), /non-null object/);
    assert.throws(() => IPCValidator.validateFiniteNumbers({ a: Infinity }, ['a']), /finite number/);
    assert.throws(() => IPCValidator.validateFiniteNumbers({ a: NaN }, ['a']), /finite number/);
    assert.throws(() => IPCValidator.validateFiniteNumbers({ a: 'x' }, ['a']), /finite number/);
    assert.throws(() => IPCValidator.validateFiniteNumbers({}, ['missing']), /finite number/);
  });

  check('IPCValidator sanitizePath traversal and containment branches', () => {
    const base = path.resolve('/tmp/omni-base');
    assert.strictEqual(IPCValidator.sanitizePath('sub/file.txt', base), path.join(base, 'sub/file.txt'));
    const sibling = IPCValidator.sanitizePath('project-evil', base);
    assert.strictEqual(sibling, path.join(base, 'project-evil'));
    assert.throws(() => IPCValidator.sanitizePath('', base), /non-empty string/);
    assert.throws(() => IPCValidator.sanitizePath(42, base), /non-empty string/);
    assert.throws(() => IPCValidator.sanitizePath('a.txt', ''), /allowed path root/);
    assert.throws(() => IPCValidator.sanitizePath('a.txt', null), /allowed path root/);
    assert.throws(() => IPCValidator.sanitizePath('../escape.txt', base), /Path traversal/);
    assert.throws(() => IPCValidator.sanitizePath('/etc/passwd', base), /Path traversal/);
  });

  check('IPCValidator validateBuffer limit branches', () => {
    assert.strictEqual(IPCValidator.validateBuffer(Buffer.from('abc'), 10), true);
    assert.strictEqual(IPCValidator.validateBuffer(new Uint8Array(4), 10), true);
    assert.throws(() => IPCValidator.validateBuffer(null, 10), /expected Buffer or Uint8Array/);
    assert.throws(() => IPCValidator.validateBuffer('abc', 10), /expected Buffer or Uint8Array/);
    assert.throws(() => IPCValidator.validateBuffer(Buffer.alloc(64), 32), /Exceeded Security Limit/);
  });

  // ------------------------------------------------------------------
  // Security cluster: EnterpriseIAM
  // ------------------------------------------------------------------
  check('EnterpriseIAM evaluateAccess denial branches', () => {
    const denied = EnterpriseIAM.evaluateAccess({ action: ACTIONS.READ, resource: {} });
    assert.strictEqual(denied.granted, false);
    assert.match(denied.reason, /identity fields are missing/);
    const roleDenied = EnterpriseIAM.evaluateAccess({
      user: { role: 'Guest' },
      action: ACTIONS.MODIFY_CAD,
      resource: {}
    });
    assert.strictEqual(roleDenied.granted, false);
    assert.match(roleDenied.reason, /RBAC/);
    const clearanceDenied = EnterpriseIAM.evaluateAccess({
      user: { role: 'QualityAuditor', clearance: 'CONFIDENTIAL' },
      action: ACTIONS.AUDIT_LOGS,
      resource: { classification: 'SECRET' }
    });
    assert.strictEqual(clearanceDenied.granted, false);
    assert.match(clearanceDenied.reason, /classification/);
    const itarDenied = EnterpriseIAM.evaluateAccess({
      user: { role: 'ChiefEngineer' },
      action: ACTIONS.EXPORT_GDSII,
      resource: { isITAR: true }
    });
    assert.strictEqual(itarDenied.granted, false);
    assert.match(itarDenied.reason, /ITAR/);
    const projectDenied = EnterpriseIAM.evaluateAccess({
      user: { role: 'StressAnalyst', assignedProjects: ['P1'] },
      action: ACTIONS.RUN_SIMULATION,
      resource: { projectId: 'P2' }
    });
    assert.strictEqual(projectDenied.granted, false);
    assert.match(projectDenied.reason, /project/);
    const networkDenied = EnterpriseIAM.evaluateAccess({
      user: { role: 'ChiefEngineer' },
      action: ACTIONS.READ,
      resource: {},
      context: { allowedSubnet: '10.1.', clientIp: '192.168.0.5' }
    });
    assert.strictEqual(networkDenied.granted, false);
    assert.match(networkDenied.reason, /network/);
  });

  check('EnterpriseIAM evaluateAccess grant and privileged-role branches', () => {
    const granted = EnterpriseIAM.evaluateAccess({
      user: { role: 'ChiefEngineer', clearance: 'TOP_SECRET', itarCertified: true },
      action: ACTIONS.EXPORT_GDSII,
      resource: { classification: 'SECRET', isITAR: true, projectId: 'P1' },
      context: { allowedSubnet: '10.1.', clientIp: '10.1.2.3' }
    });
    assert.strictEqual(granted.granted, true);
    assert.strictEqual(granted.enforced, false);
    assert.strictEqual(granted.identityVerified, false);
    const privilegedProject = EnterpriseIAM.evaluateAccess({
      user: { role: 'QualityAuditor', assignedProjects: [] },
      action: ACTIONS.AUDIT_LOGS,
      resource: { projectId: 'P9' }
    });
    assert.strictEqual(privilegedProject.granted, true);
    const noContext = EnterpriseIAM.evaluateAccess({
      user: { role: 'ChiefEngineer' },
      action: ACTIONS.READ,
      resource: {}
    });
    assert.strictEqual(noContext.granted, true);
  });

  check('EnterpriseIAM canApproveECO and canExportGDSII helpers', () => {
    const approval = EnterpriseIAM.canApproveECO(
      { role: 'ChiefEngineer', clearance: 'SECRET' },
      { classification: 'CONFIDENTIAL', projectId: 'P1', id: 'ECO-1' }
    );
    assert.strictEqual(approval.granted, true);
    const denied = EnterpriseIAM.canApproveECO({ role: 'StressAnalyst' }, { id: 'ECO-2' });
    assert.strictEqual(denied.granted, false);
    const exportOk = EnterpriseIAM.canExportGDSII(
      { role: 'EdaEngineer', clearance: 'SECRET' },
      { classification: 'CONFIDENTIAL' }
    );
    assert.strictEqual(exportOk.granted, true);
    const exportDenied = EnterpriseIAM.canExportGDSII({ role: 'ThermalEngineer' }, {});
    assert.strictEqual(exportDenied.granted, false);
  });

  // ------------------------------------------------------------------
  // Contracts cluster: EngineRegistry
  // ------------------------------------------------------------------
  check('EngineRegistry registration, lookup, and capability branches', () => {
    const registry = new EngineRegistry();
    assert.strictEqual(registry.listRegisteredDomains().length, 12);
    assert.deepStrictEqual(registry.listDomains(), registry.listRegisteredDomains());
    assert.strictEqual(registry.hasAdapter('eda'), true);
    assert.strictEqual(registry.hasAdapter('EDA'), true);
    assert.strictEqual(registry.has('eda'), true);
    assert.strictEqual(registry.hasAdapter(''), false);
    assert.strictEqual(registry.hasAdapter(undefined), false);
    assert.strictEqual(registry.getAdapter('eda').domain, 'eda');
    assert.strictEqual(registry.get('EDA').domain, 'eda');
    assert.throws(() => registry.getAdapter(undefined), /Domain string is required/);
    assert.throws(() => registry.getAdapter(42), /Domain string is required/);
    assert.throws(() => registry.getAdapter('nonexistent'), /No EngineAdapter registered/);
    assert.throws(() => registry.register({}), /Invalid adapter registration/);
    assert.throws(() => registry.register(null), /Invalid adapter registration/);
    const custom = { domain: 'custom', describeCapabilities: () => ({}) };
    registry.register(custom);
    assert.strictEqual(registry.getAdapter('CUSTOM'), custom);
    registry.registerAdapter({ domain: 'custom2', describeCapabilities: () => ({}) });
    assert.strictEqual(registry.hasAdapter('custom2'), true);
    const caps = registry.describeAllCapabilities();
    assert.strictEqual(typeof caps.eda, 'object');
  });

  check('EngineRegistry dispatch and executeJob branches', async () => {
    const registry = new EngineRegistry();
    await assert.rejects(() => registry.dispatch(null), /requires a JobRequest/);
    await assert.rejects(() => registry.dispatch({}), /requires a JobRequest/);
    const res = await registry.dispatch({
      jobId: 'registry-eda-1',
      domain: 'eda',
      operation: 'static_timing_analysis',
      parameters: { clockPeriodNs: 5 }
    });
    assert(res.outputData !== undefined);
    assert(res.status !== undefined);
    const res2 = await registry.executeJob('eda', {
      jobId: 'registry-eda-2',
      operation: 'extract_wire_parasitics',
      parameters: { lengthMm: 1 }
    });
    assert(res2.outputData.resistanceOhms !== undefined);
    const res3 = await registry.executeJob({
      jobId: 'registry-eda-3',
      domain: 'eda',
      operation: 'static_timing_analysis',
      parameters: {}
    });
    assert(res3.outputData !== undefined);
    const sig = new AbortController().signal;
    await registry.dispatch(
      { jobId: 'registry-eda-4', domain: 'eda', operation: 'static_timing_analysis', parameters: {} },
      () => {},
      sig
    );
    assert.strictEqual(defaultEngineRegistry.hasAdapter('eda'), true);
    assert.strictEqual(createDefaultEngineRegistry().listRegisteredDomains().length, 12);
  });

  // ------------------------------------------------------------------
  // Contracts cluster: EngineAdapter
  // ------------------------------------------------------------------
  check('EngineAdapter abstract guards and validation branches', async () => {
    assert.throws(() => new EngineAdapter('eda', 'base'), /Cannot construct EngineAdapter instances directly/);
    class TestAdapter extends EngineAdapter {
      constructor() {
        super('test', 'test-adapter', '3.1.0');
      }
      describeCapabilities() {
        return {
          domain: 'test',
          name: this.name,
          version: this.version,
          supportedOperations: ['run'],
          supportedBackends: ['js'],
          supportedSolvers: ['fast'],
          maturity: ValidationMaturity.EXPERIMENTAL,
          native: false
        };
      }
    }
    const adapter = new TestAdapter();
    const caps = adapter.describeCapabilities();
    assert.strictEqual(caps.domain, 'test');
    assert.strictEqual(caps.native, false);
    assert.strictEqual(caps.maturity, ValidationMaturity.EXPERIMENTAL);
    await assert.rejects(() => adapter.validate(null), /null request/);
    await assert.rejects(() => adapter.validate({ domain: 'eda', operation: 'run' }), /Domain mismatch/);
    await assert.rejects(() => adapter.validate({ domain: 'test', operation: 'nope' }), /not supported/);
    await assert.rejects(() => adapter.validate({ domain: 'test', operation: 'run', backend: 'remote' }), /Backend/);
    await assert.rejects(
      () => adapter.validate({ domain: 'test', operation: 'run', backendVersion: '9.9.9' }),
      /version/
    );
    await assert.rejects(
      () => adapter.validate({ domain: 'test', operation: 'run', solver: 'not-a-solver' }),
      /Solver/
    );
    assert.strictEqual(await adapter.validate({ domain: 'test', operation: 'run' }), true);
    await assert.rejects(() => adapter.execute({}), /not implemented/);
    assert.strictEqual(await adapter.cancel('job-1'), false);
    assert.strictEqual(await adapter.checkpoint('job-1'), null);
    const ctx = await adapter.prepare({ domain: 'test', operation: 'run' });
    assert.deepStrictEqual(ctx, {});
  });

  // ------------------------------------------------------------------
  // Contracts cluster: JobRequest
  // ------------------------------------------------------------------
  check('JobRequest constructor and validation branches', () => {
    const req = new JobRequest({ domain: 'eda', operation: 'run_drc' });
    assert.strictEqual(req.domain, 'eda');
    assert.strictEqual(req.operation, 'run_drc');
    assert.strictEqual(req.priority, JobPriority.NORMAL);
    assert.strictEqual(req.seed, 42);
    assert.strictEqual(req.resourceBudget.maxTimeMs, 30000);
    assert.strictEqual(req.resourceBudget.maxMemoryMb, 2048);
    assert.strictEqual(req.resourceBudget.maxThreads, 4);
    assert.strictEqual(req.projectRevision, 1);
    assert.throws(() => new JobRequest({ operation: 'x' }), /domain string/);
    assert.throws(() => new JobRequest({ domain: 'eda' }), /operation string/);
    assert.throws(() => new JobRequest({ domain: 'eda', operation: 'x', solver: 5 }), /solver must be a string/);
    assert.throws(() => new JobRequest({ domain: 'eda', operation: 'x', backend: 'pdp11' }), /backend must be one of/);
    assert.throws(() => new JobRequest({ domain: 'eda', operation: 'x', backendVersion: 3 }), /backendVersion/);
    assert.throws(() => new JobRequest({ domain: 'eda', operation: 'x', createdAt: 'not-a-date' }), /createdAt/);
    const withCreated = new JobRequest({
      domain: 'eda',
      operation: 'x',
      createdAt: '2024-01-01T00:00:00.000Z'
    });
    assert.strictEqual(withCreated.createdAt, '2024-01-01T00:00:00.000Z');
  });

  check('JobRequest parameter guards, deep freeze, and content hash', () => {
    assert.throws(() => new JobRequest({ domain: 'eda', operation: 'x', parameters: [1] }), /must be an object/);
    assert.throws(
      () => new JobRequest({ domain: 'eda', operation: 'x', parameters: { a: NaN } }),
      /non-finite numbers/
    );
    const circular = {};
    circular.self = circular;
    assert.throws(() => new JobRequest({ domain: 'eda', operation: 'x', parameters: circular }), /circular references/);
    const h = new JobRequest({ domain: 'eda', operation: 'x' });
    const h2 = new JobRequest({ domain: 'eda', operation: 'x' });
    assert.strictEqual(h.computeContentHash(), h2.computeContentHash());
    const h3 = new JobRequest({
      domain: 'eda',
      operation: 'x',
      inputArtifactHashes: ['B', 'A'],
      projectRevision: 3,
      priority: 'not-a-priority'
    });
    assert.strictEqual(h3.priority, JobPriority.NORMAL);
    assert.deepStrictEqual(h3.inputArtifactHashes, ['b', 'a']);
    const lowBudget = new JobRequest({
      domain: 'eda',
      operation: 'x',
      resourceBudget: { maxTimeMs: 1, maxMemoryMb: 1, maxThreads: 0 }
    });
    assert.strictEqual(lowBudget.resourceBudget.maxTimeMs, 500);
    assert.strictEqual(lowBudget.resourceBudget.maxMemoryMb, 64);
    assert.strictEqual(lowBudget.resourceBudget.maxThreads, 4);
    const badSeed = new JobRequest({ domain: 'eda', operation: 'x', seed: 1.5 });
    assert.strictEqual(badSeed.seed, 42);
    const frozenParams = new JobRequest({ domain: 'eda', operation: 'x', parameters: { a: { b: 1 } } });
    assert(Object.isFrozen(frozenParams.parameters));
    assert(Object.isFrozen(frozenParams.parameters.a));
    assert.throws(() => {
      frozenParams.parameters.a.b = 2;
    }, TypeError);
  });

  check('JobRequest toJSON/fromJSON round trips', () => {
    const req = new JobRequest({ domain: 'eda', operation: 'run_drc', jobId: 'job-fit', parameters: { k: 1 } });
    const json = req.toJSON();
    assert.strictEqual(json.jobId, 'job-fit');
    assert.strictEqual(json.parameters.k, 1);
    const restored = JobRequest.fromJSON(json);
    assert.strictEqual(restored.jobId, 'job-fit');
    assert.strictEqual(restored.domain, 'eda');
    assert.throws(() => JobRequest.fromJSON(null), /Invalid JobRequest JSON/);
    assert.throws(() => JobRequest.fromJSON('x'), /Invalid JobRequest JSON/);
  });

  // ------------------------------------------------------------------
  // Contracts cluster: Quantity
  // ------------------------------------------------------------------
  check('Quantity construction and from() unit conversion branches', () => {
    assert.throws(() => new Quantity('x', 'm', Dimensions.LENGTH), /finite number/);
    assert.throws(() => new Quantity(1, 'm', Dimensions.LENGTH, -1), /uncertainty/);
    assert.throws(() => new Quantity(1, 'm', Dimensions.LENGTH, NaN), /uncertainty/);
    assert.throws(() => new Quantity(1, 'm', [0, 1]), /7-element array/);
    assert.throws(() => Quantity.from(NaN, 'm'), /non-finite value/);
    assert.throws(() => Quantity.from(1, 'parsecs'), /Unrecognized unit/);
    const q = Quantity.from(20, 'degC', 0.5);
    assert(Math.abs(q.valueSi - 293.15) < 1e-9);
    assert.strictEqual(q.displayUnit, 'degC');
    assert.strictEqual(q.uncertaintySi, 0.5);
    assert.strictEqual(q.to('degC'), 20);
    assert.throws(() => q.to('not-a-unit'), /not registered/);
    assert.throws(() => q.to('m'), /Dimension mismatch/);
    const raw = new Quantity(3, 'm', Dimensions.LENGTH, 0.1);
    assert.strictEqual(raw.valueSi, 3);
  });

  check('Quantity arithmetic and toString branches', () => {
    const a = Quantity.from(2, 'm', 0.1);
    const b = Quantity.from(3, 'mm', 0.05);
    const sum = a.add(b);
    assert.strictEqual(typeof sum.valueSi, 'number');
    const diff = a.subtract(b);
    assert.strictEqual(typeof diff.valueSi, 'number');
    assert.throws(() => a.add('x'), /non-Quantity/);
    assert.throws(() => a.subtract(5), /non-Quantity/);
    const force = Quantity.from(10, 'N');
    assert.throws(() => a.add(force), /different dimensions/);
    assert.throws(() => a.subtract(force), /different dimensions/);
    const scaled = a.multiply(3);
    assert.strictEqual(scaled.valueSi, 6);
    assert.throws(() => a.multiply(Infinity), /Multiplier must be finite/);
    const area = a.multiply(b);
    assert.strictEqual(area.dimension[1], 2);
    assert.throws(() => a.multiply('x'), /requires Quantity or finite number/);
    const div = a.divide(2);
    assert.strictEqual(div.valueSi, 1);
    assert.throws(() => a.divide(0), /non-zero finite number/);
    const speed = Quantity.from(10, 'm').divide(Quantity.from(2, 's'));
    assert.strictEqual(speed.dimension[1], 1);
    assert.throws(() => a.divide(Quantity.from(0, 'm')), /Division by zero Quantity/);
    assert.throws(() => a.divide({}), /requires Quantity or finite number/);
    assert.strictEqual(a.toString().includes('2.000000'), true);
    const withUnc = a.toString();
    assert(withUnc.includes('±'));
    const noDisplay = new Quantity(5, 'm', Dimensions.LENGTH, 0);
    assert.strictEqual(noDisplay.toString().includes('5.000000'), true);
    const bare = new Quantity(5, '', Dimensions.LENGTH, 0);
    assert.strictEqual(bare.toString().includes('5.000000'), true);
  });

  check('Quantity uncertainty, display unit, and JSON branches', () => {
    const q = Quantity.from(100, 'cm', 1);
    assert.strictEqual(q.uncertaintyTo('cm'), 1);
    assert.throws(() => q.uncertaintyTo('bogus'), /not registered/);
    assert.throws(() => q.uncertaintyTo('kg'), /Dimension mismatch/);
    const shown = q.withDisplayUnit('m');
    assert.strictEqual(shown.displayUnit, 'm');
    assert.strictEqual(shown.to('cm'), 100);
    const json = q.toJSON();
    assert.strictEqual(json.valueSi, 1);
    const restored = Quantity.fromJSON(json);
    assert.strictEqual(restored.to('cm'), 100);
    assert.throws(() => Quantity.fromJSON(null), /Invalid Quantity JSON/);
    const noUnc = { valueSi: 2, displayUnit: 'm', dimension: Dimensions.LENGTH };
    assert.strictEqual(Quantity.fromJSON(noUnc).uncertaintySi, 0);
    assert.strictEqual(dimensionsEqual(Dimensions.LENGTH, [0, 1, 0, 0, 0, 0, 0]), true);
    assert.strictEqual(dimensionsEqual(null, Dimensions.LENGTH), false);
    assert.strictEqual(dimensionsEqual([0, 1], [0, 1]), false);
    assert.strictEqual(dimensionsEqual(Dimensions.LENGTH, Dimensions.MASS), false);
    assert.strictEqual(UnitRegistry['degC'].offset, 273.15);
    assert.strictEqual(UnitRegistry.psi.scale > 6000, true);
  });

  // ------------------------------------------------------------------
  // Contracts cluster: ToolDefinition / ToolProposal / ValidationRecord
  // ------------------------------------------------------------------
  check('ToolDefinition constructor, approval classes, and proposals', () => {
    assert.throws(() => new ToolDefinition({}), /requires a valid name/);
    assert.throws(() => new ToolDefinition({ name: 'tool' }), /requires a description/);
    assert.throws(
      () => new ToolDefinition({ name: 'tool', description: 'd', classification: 'BOGUS' }),
      /Invalid ToolApprovalClass/
    );
    const readOnly = new ToolDefinition({
      name: 'project.query',
      description: 'query',
      classification: ToolApprovalClass.READ_ONLY
    });
    assert.strictEqual(readOnly.isReadOnly(), true);
    const mutating = new ToolDefinition({
      name: 'cad.edit',
      description: 'edit',
      classification: ToolApprovalClass.READ_ONLY,
      modifiesState: true
    });
    assert.strictEqual(mutating.isReadOnly(), false);
    const preview = new ToolDefinition({ name: 'cad.fillet', description: 'fillet', estimatedDurationMs: 0 });
    assert.strictEqual(preview.isReadOnly(), false);
    assert.strictEqual(preview.estimatedDurationMs, 100);
    const proposal = preview.createProposal({ a: 1 }, 'reasoning', [{ op: 'x' }], 7, 'proj-1');
    assert.strictEqual(proposal.toolName, 'cad.fillet');
    assert.strictEqual(proposal.originatingProjectRevision, 7);
    const proposalNoId = preview.createProposal({}, '', [], 2);
    assert.strictEqual(proposalNoId.originatingProjectId, null);
    assert.strictEqual(ToolClassification, ToolApprovalClass);
    assert.throws(() => ToolDefinition.fromJSON(null), /Invalid ToolDefinition JSON/);
    const restored = ToolDefinition.fromJSON({
      name: 'again',
      description: 'd',
      classification: ToolApprovalClass.READ_ONLY
    });
    assert.strictEqual(restored.name, 'again');
  });

  check('ToolProposal lifecycle, status, and freeze branches', () => {
    assert.throws(() => new ToolProposal({}), /requires a toolName/);
    assert.throws(() => new ToolProposal({ toolName: 't', approvalClass: 'BAD' }), /Invalid ToolApprovalClass/);
    assert.throws(
      () => new ToolProposal({ toolName: 't', originatingProjectRevision: 0 }),
      /positive project revision/
    );
    assert.throws(
      () => new ToolProposal({ toolName: 't', originatingProjectRevision: 1.5 }),
      /positive project revision/
    );
    assert.throws(
      () => new ToolProposal({ toolName: 't', originatingProjectRevision: 1, originatingProjectId: '  ' }),
      /non-empty string/
    );
    const p = new ToolProposal({
      toolName: 't',
      proposalId: 'prop-1',
      originatingProjectRevision: 1,
      idempotencyKey: 'k1',
      args: { x: { y: 1 } },
      expectedMutations: ['m1'],
      costEstimate: { cpuMs: 5 }
    });
    assert.strictEqual(p.proposalId, 'prop-1');
    assert.strictEqual(p.id, 'prop-1');
    assert.strictEqual(p.parameters.x.y, 1);
    assert(Object.isFrozen(p.args));
    assert(Object.isFrozen(p.args.x));
    assert.strictEqual(p.idempotencyKey, 'k1');
    assert.strictEqual(p.status, ProposalStatus.PROPOSED);
    assert.strictEqual(p.requiresApproval, true);
    assert.strictEqual(p.canAutoRun(), false);
    p.approve({ id: 'rec-1' });
    assert.strictEqual(p.status, ProposalStatus.APPROVED);
    p.markExecuting();
    assert.strictEqual(p.status, ProposalStatus.EXECUTING);
    p.markExecuted('result');
    assert.strictEqual(p.status, ProposalStatus.EXECUTED);
    assert.strictEqual(p._result, 'result');
    const p2 = new ToolProposal({
      toolName: 't2',
      originatingProjectRevision: 1,
      approvalClass: ToolApprovalClass.READ_ONLY
    });
    assert.strictEqual(p2.canAutoRun(), true);
    assert.strictEqual(p2.requiresApproval, false);
    p2.reject('because');
    assert.strictEqual(p2.status, ProposalStatus.REJECTED);
    p2.markFailed(new Error('boom'));
    assert.strictEqual(p2.status, ProposalStatus.FAILED);
    assert.strictEqual(p2.classification, p2.approvalClass);
    assert.strictEqual(typeof p2.idempotencyKey, 'string');
    const json = p.toJSON();
    assert.strictEqual(json.proposalId, 'prop-1');
    const restored = ToolProposal.fromJSON(json);
    assert.strictEqual(restored.toolName, 't');
    assert.throws(() => ToolProposal.fromJSON(undefined), /Invalid ToolProposal JSON/);
  });

  check('ValidationRecord validity, maturity, and JSON branches', () => {
    assert.throws(() => new ValidationRecord({}), /requires a benchmarkSet/);
    assert.throws(() => new ValidationRecord({ benchmarkSet: 'b', maturity: 'gold' }), /Invalid validation maturity/);
    const rec = new ValidationRecord({
      benchmarkSet: 'b1',
      maturity: ValidationMaturity.VERIFIED,
      reviewer: 'r',
      date: '2024-05-01T00:00:00.000Z',
      signature: 'sig',
      referenceArtifacts: ['h1'],
      errors: { rel: 0.01 },
      tolerances: { maxRel: 0.05 }
    });
    assert.strictEqual(rec.maturity, ValidationMaturity.VERIFIED);
    assert.strictEqual(rec.reviewer, 'r');
    assert.strictEqual(rec.date, '2024-05-01T00:00:00.000Z');
    assert.strictEqual(rec.signature, 'sig');
    assert.deepStrictEqual(rec.referenceArtifacts, ['h1']);
    assert.strictEqual(rec.isReleaseReady(), false);
    const auto = new ValidationRecord({ benchmarkSet: 'b2' });
    assert.strictEqual(auto.maturity, ValidationMaturity.EXPERIMENTAL);
    assert.strictEqual(typeof auto.date, 'string');
    const restored = ValidationRecord.fromJSON(rec.toJSON());
    assert.strictEqual(restored.benchmarkSet, 'b1');
    assert.throws(() => ValidationRecord.fromJSON(null), /Invalid ValidationRecord JSON/);
    assert.strictEqual(ValidationMaturity.RELEASED, 'released');
  });

  // ------------------------------------------------------------------
  // EDA cluster: GDSII stream
  // ------------------------------------------------------------------
  check('GdsiiStreamEngine write/read round trip with open and closed polygons', () => {
    const lib = new GdsLibrary('TEST_LIB', 1e-3, 1e-9);
    const str = lib.createStructure('TOP');
    const poly = str.addPolygon(1, 0, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 }
    ]);
    assert.strictEqual(poly.layer, 1);
    const closedPoly = str.addPolygon(2, 1, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 }
    ]);
    assert.strictEqual(closedPoly.points.length, 5);
    const gpath = str.addPath(3, 0, 25, [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]);
    assert.strictEqual(gpath.width, 25);
    const thinPath = str.addPath(3, 0, 0, [
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    ]);
    assert.strictEqual(thinPath.width, 0);
    const buf = GdsiiStreamEngine.writeGdsii(lib);
    assert(buf.length > 0);
    const parsed = GdsiiStreamEngine.readGdsii(buf);
    assert.strictEqual(parsed.name, 'TEST_LIB');
    assert.strictEqual(parsed.structures.size, 1);
    const top = parsed.getStructure('TOP');
    assert.strictEqual(top.elements.length, 4);
    const polyParsed = top.elements[0];
    assert(polyParsed instanceof GdsPolygon);
    assert.strictEqual(polyParsed.points.length, 4);
    assert.strictEqual(top.elements[1].points.length, 5);
    assert(top.elements[2] instanceof GdsPath);
    assert.strictEqual(top.elements[2].width, 25);
    assert.strictEqual(top.elements[3].width, 0);
  });

  check('GdsiiStreamEngine odd-length names, empty library, and corrupted records', () => {
    const lib = new GdsLibrary('X', 1e-3, 1e-9);
    const str = lib.createStructure('Y');
    str.addPolygon(1, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 }
    ]);
    const buf = GdsiiStreamEngine.writeGdsii(lib);
    const parsed = GdsiiStreamEngine.readGdsii(buf);
    assert.strictEqual(parsed.name, 'X');
    const emptyLib = new GdsLibrary('EMPTY');
    const emptyBuf = GdsiiStreamEngine.writeGdsii(emptyLib);
    const emptyParsed = GdsiiStreamEngine.readGdsii(emptyBuf);
    assert.strictEqual(emptyParsed.structures.size, 0);
    const corrupt = Buffer.alloc(4);
    corrupt.writeUInt16BE(2, 0);
    corrupt.writeUInt16BE(GdsRecordType.LIBNAME, 2);
    assert.throws(() => GdsiiStreamEngine.readGdsii(corrupt), /Corrupted GDSII record/);
    const declaredLong = Buffer.alloc(8);
    declaredLong.writeUInt16BE(1000, 0);
    declaredLong.writeUInt16BE(GdsRecordType.LIBNAME, 2);
    assert.throws(() => GdsiiStreamEngine.readGdsii(declaredLong), /Corrupted GDSII record/);
    const trailing = Buffer.concat([emptyBuf, Buffer.from([1, 2])]);
    const parsedTrailing = GdsiiStreamEngine.readGdsii(trailing);
    assert(parsedTrailing instanceof GdsLibrary);
    assert.strictEqual(parsedTrailing.structures.size, 0);
  });

  check('GDSII float conversion helpers', () => {
    const zero = floatToGdsReal(0.0);
    assert.deepStrictEqual(Array.from(zero), Array(8).fill(0));
    const pos = floatToGdsReal(123.456);
    const neg = floatToGdsReal(-123.456);
    assert.strictEqual(gdsRealToFloat(pos), 123.456);
    assert.strictEqual(gdsRealToFloat(neg), -123.456);
    const small = floatToGdsReal(1e-9);
    assert(Math.abs(gdsRealToFloat(small) - 1e-9) / 1e-9 < 1e-6);
    const unitsBuf = Buffer.concat([floatToGdsReal(1e6), floatToGdsReal(1e-9)]);
    assert.strictEqual(gdsRealToFloat(unitsBuf, 0), 1e6);
    assert.strictEqual(gdsRealToFloat(unitsBuf, 8), 1e-9);
  });

  // ------------------------------------------------------------------
  // EDA cluster: OASIS stream engine
  // ------------------------------------------------------------------
  check('OasisStreamEngine vint/vsint encode-decode branches', () => {
    const engine = new OasisStreamEngine({ unit: 1e-9, version: '1.2' });
    assert.strictEqual(engine.unit, 1e-9);
    assert.strictEqual(engine.version, '1.2');
    assert.deepStrictEqual(engine.encodeVint(0), [0]);
    assert.deepStrictEqual(engine.encodeVint(127), [127]);
    assert.deepStrictEqual(engine.encodeVint(128), [128, 1]);
    const big = engine.encodeVint(2 ** 20);
    assert(big.length > 1);
    assert.strictEqual(engine.decodeVint(Buffer.from(big), 0).value, 2 ** 20);
    assert.deepStrictEqual(engine.encodeVsint(5), engine.encodeVint(10));
    assert.deepStrictEqual(engine.encodeVsint(-5), engine.encodeVint(9));
    assert.strictEqual(engine.decodeVsint(Buffer.from(engine.encodeVsint(-7)), 0).value, -7);
    assert.strictEqual(engine.decodeVsint(Buffer.from(engine.encodeVsint(7)), 0).value, 7);
    const overflow = Buffer.alloc(11, 0xff);
    assert.throws(() => engine.decodeVint(overflow, 0), /Vint overflow/);
    const truncated = Buffer.from([0x80]);
    assert.strictEqual(engine.decodeVint(truncated, 0).bytesRead, 1);
  });

  check('OasisStreamEngine serialize/deserialize modal compression round trip', () => {
    const engine = new OasisStreamEngine();
    const layout = {
      name: 'TOP',
      cells: [
        {
          name: 'A',
          rectangles: [
            { layer: 1, datatype: 0, width: 10, height: 20, x: 0, y: 0 },
            { layer: 1, datatype: 0, width: 10, height: 20, x: 100, y: 200 },
            { layer: 2, datatype: 1, width: 5, height: 5, x: -10, y: -20 }
          ],
          placements: [
            { cellName: 'B', x: 5, y: 6 },
            { cellName: 'B', x: -1, y: 0 }
          ]
        },
        { name: 'B', rectangles: [], placements: [] }
      ]
    };
    const bytes = engine.serialize(layout);
    assert(bytes instanceof Uint8Array);
    const parsed = engine.deserialize(bytes);
    assert.strictEqual(parsed.format, 'oasis-like-record-subset-unverified');
    assert.strictEqual(parsed.version, '1.0');
    assert.strictEqual(parsed.cells.length, 2);
    const cellA = parsed.cells[0];
    assert.strictEqual(cellA.name, 'A');
    assert.strictEqual(cellA.rectangles.length, 3);
    assert.strictEqual(cellA.rectangles[1].x, 100);
    assert.strictEqual(cellA.rectangles[1].y, 200);
    assert.strictEqual(cellA.rectangles[2].layer, 2);
    assert.strictEqual(cellA.rectangles[2].x, -10);
    assert.strictEqual(cellA.placements.length, 2);
    assert.strictEqual(cellA.placements[1].x, -1);
    assert.strictEqual(parsed.cells[1].name, 'B');
  });

  check('OasisStreamEngine deserialize failure branches and compression ratio', () => {
    const engine = new OasisStreamEngine();
    assert.throws(() => engine.deserialize(null), /Invalid or truncated OASIS/);
    assert.throws(() => engine.deserialize(new Uint8Array(5)), /Invalid or truncated OASIS/);
    const badMagic = new Uint8Array(20);
    assert.throws(() => engine.deserialize(badMagic), /Invalid OASIS magic header/);
    const magic = [0x25, 0x53, 0x45, 0x4d, 0x49, 0x2d, 0x4f, 0x41, 0x53, 0x49, 0x53, 0x0d, 0x0a];
    const rectOutsideCell = new Uint8Array([...magic, 20, 0x00]);
    assert.throws(() => engine.deserialize(rectOutsideCell), /RECTANGLE encountered outside of CELL/);
    const placementOutsideCell = new Uint8Array([...magic, 17, 0, 0, 0]);
    assert.throws(() => engine.deserialize(placementOutsideCell), /PLACEMENT encountered outside of CELL/);
    const unknownRecord = new Uint8Array([...magic, 99]);
    assert.throws(() => engine.deserialize(unknownRecord), /Unknown or corrupted OASIS record/);
    const layout = {
      name: 'T',
      cells: [{ name: 'A', rectangles: [{ layer: 1, datatype: 0, width: 10, height: 10, x: 0, y: 0 }], placements: [] }]
    };
    const ratio = engine.evaluateCompressionRatio(layout);
    assert(ratio.oasisSizeBytes > 0);
    assert(ratio.estimatedGdsiiSizeBytes > 0);
    assert.strictEqual(ratio.estimateBasis.includes('fixed per-record'), true);
    const empty = engine.evaluateCompressionRatio({ cells: [] });
    assert(empty.estimatedReductionPercent > 0);
    assert.strictEqual(empty.reductionPercent, empty.estimatedReductionPercent);
  });

  // ------------------------------------------------------------------
  // EDA cluster: Liberty parser
  // ------------------------------------------------------------------
  const LIBERTY_SAMPLE = `
library (demo) {
  delay_model : table_lookup;
  time_unit : "1ns";
  capacitance_unit : "1pF";
  voltage_unit : "1V";
  current_unit : "1mA";
  resistance_unit : "1kohm";
  leakage_power_unit : "1nW";
  cell (INV) {
    area : 1.2;
    cell_leakage_power : 0.05;
    pin (A) {
      direction : input;
      capacitance : 0.01;
      min_capacitance : 0.001;
      max_capacitance : 0.5;
      timing () {
        related_pin : "A";
        timing_type : rising_edge;
        cell_rise (0.05);
        cell_fall (0.06);
        rise_transition (0.015);
        fall_transition (0.03);
      }
    }
    pin (Y) {
      direction : output;
      capacitance : 0.02;
      timing () {
        related_pin : "A";
        timing_type : falling_edge;
        cell_rise (0.04);
        cell_fall (0.05);
        rise_transition (0.02);
        fall_transition (0.03);
      }
    }
  }
  cell (NAND2) {
    area : 2.0;
    pin (A) {
      direction : input;
      timing () {
        related_pin : "A";
        timing_type : rising_edge;
        cell_rise (tpl1) {
          index_1 ("0.01, 0.05, 0.10");
          index_2 ("0.01, 0.05, 0.10");
          values ("0.10, 0.12, 0.14", "0.15, 0.17, 0.19", "0.20, 0.22, 0.24");
        }
        cell_fall (0.07);
      }
    }
  }
}
`;

  check('Liberty parser full library parse with attributes, scalar, and table arcs', () => {
    const lib = parseLiberty(LIBERTY_SAMPLE);
    assert(lib instanceof LibertyLibrary);
    assert.strictEqual(lib.name, 'demo');
    assert.strictEqual(lib.delayModel, 'table_lookup');
    assert.strictEqual(lib.units.time_unit, '1ns');
    assert.strictEqual(lib.cells.size, 2);
    const inv = lib.getCell('INV');
    assert.strictEqual(inv.area, 1.2);
    assert.strictEqual(inv.cellLeakagePower, 0.05);
    assert.strictEqual(inv.pins.size, 2);
    const pinA = inv.pins.get('A');
    assert.strictEqual(pinA.direction, 'input');
    assert.strictEqual(pinA.capacitance, 0.01);
    assert.strictEqual(pinA.minCapacitance, 0.001);
    assert.strictEqual(pinA.maxCapacitance, 0.5);
    assert.strictEqual(pinA.timings.length, 1);
    const timing = pinA.timings[0];
    assert.strictEqual(timing.relatedPin, 'A');
    assert.strictEqual(timing.timingType, 'rising_edge');
    assert.strictEqual(timing.getArc('cellRise'), 0.05);
    assert.strictEqual(timing.delay(0.02, 0.2, 'cellFall'), 0.06);
    assert.strictEqual(timing.cellRiseDelay(0.01, 0.1), 0.05);
    assert.strictEqual(timing.riseTransitionDelay(0.01, 0.1), 0.015);
    assert.strictEqual(timing.fallTransitionDelay(0.01, 0.1), 0.03);
    assert.throws(() => timing.delay(0.01, 0.1, 'missingArc'), /no arc/);
    const nand = lib.getCell('NAND2');
    const tableTiming = nand.pins.get('A').timings[0];
    const table = tableTiming.getArc('cellRise');
    assert(table instanceof LibertyTable);
    assert.strictEqual(table.rows, 3);
    assert.strictEqual(table.cols, 3);
    assert.strictEqual(table.get(0, 0), 0.1);
    assert.strictEqual(tableTiming.cellRiseDelay(0.05, 0.05), 0.17);
    assert(Math.abs(tableTiming.delay(0.03, 0.03, 'cellRise') - 0.135) < 1e-9);
    assert.strictEqual(lib.getCell('MISSING'), null);
  });

  check('LibertyTable lookup extrapolation and validation branches', () => {
    const table = new LibertyTable([0, 1, 2], [0, 1, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.strictEqual(table.lookup(1, 1), 5);
    assert.strictEqual(table.lookup(-1, -1), -3);
    assert.strictEqual(table.lookup(3, 3), 13);
    assert.throws(() => new LibertyTable([0, 1], [0], [1, 1]), /at least 2x2/);
    assert.throws(() => new LibertyTable([0, 0, 1], [0, 1], [1, 1, 1, 1, 1, 1]), /strictly increasing/);
    assert.throws(() => new LibertyTable([0, 1], [0, 0], [1, 1, 1, 1]), /strictly increasing/);
    assert.throws(() => new LibertyTable([0, 1], [0, 1], [1]), /value count/);
  });

  check('Liberty parser fail-closed error branches', () => {
    assert.throws(() => parseLiberty(''), /Empty Liberty source/);
    assert.throws(() => parseLiberty('notalibrary {}'), /begin with a library declaration/);
    assert.throws(() => parseLiberty('library (x) { bad_attr : 1; }'), /Unsupported construct "bad_attr"/);
    assert.throws(() => parseLiberty('library (x) { cell (c) { pin (a) { } } }'), /missing required "direction"/);
    assert.throws(
      () => parseLiberty('library (x) { cell (c) { pin (a) { direction : sideways; } } }'),
      /Unsupported pin direction/
    );
    assert.throws(
      () =>
        parseLiberty('library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; } } } }'),
      /missing required "timing_type"/
    );
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { timing_type : rising_edge; } } } }'
        ),
      /missing required "related_pin"/
    );
    assert.throws(() => parseLiberty('library (x) { cell (c) { cell (d) {} } }'), /Unsupported construct "cell"/);
    assert.throws(
      () => parseLiberty('library (x) { cell (c) { pin (a) { direction : input; direction : output; } } }'),
      /Duplicate attribute "direction"/
    );
    assert.throws(
      () => parseLiberty('library (x) { cell (c) { pin (a) { direction : input; } pin (a) { direction : input; } } }'),
      /Duplicate pin "a"/
    );
    assert.throws(() => parseLiberty('library (x) { cell (c) { } cell (c) { } }'), /Duplicate cell "c"/);
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; cell_rise (0.1); cell_rise (0.2); } } } }'
        ),
      /Duplicate timing arc/
    );
    assert.throws(() => parseLiberty(42), /must be a string/);
    assert.throws(() => parseLiberty('library (x) { /* unterminated'), /Unterminated block comment/);
    assert.throws(
      () => parseLiberty('library (x) { cell (c) { pin (a) { direction : "unterminated'),
      /Unterminated string literal/
    );
    assert.throws(() => parseLiberty('library (x) { @ }'), /Illegal character/);
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; cell_rise (0.1); }'
        ),
      /Unterminated pin block/
    );
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; cell_rise (0.1); } }'
        ),
      /Unterminated cell block/
    );
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; cell_rise (0.1); } } }'
        ),
      /Unterminated library block/
    );
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; cell_rise (0.1);'
        ),
      /Unterminated timing group/
    );
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; cell_rise (0.1); } } }'
        ),
      /Unterminated library block/
    );
  });

  check('Liberty parser arc table malformed branches', () => {
    const wrap = (body) =>
      `library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; ${body} } } } }`;
    assert.throws(() => parseLiberty(wrap('cell_rise (0.01, 0.02);')), /Expected "\)"/);
    assert.throws(
      () => parseLiberty(wrap('cell_rise (template) { index_1 ("0, 1"); values ("1, 2"); }')),
      /must define index_1, index_2, and values/
    );
    assert.throws(
      () =>
        parseLiberty(wrap('cell_rise (template) { index_1 ("0, 1"); index_2 ("0, 1"); values ("1, 2"); bogus : 1; }')),
      /Unsupported construct "bogus"/
    );
    assert.throws(
      () =>
        parseLiberty(
          'library (x) { cell (c) { pin (a) { direction : input; timing () { related_pin : "A"; timing_type : rising_edge; cell_rise (template) { index_1 (0, 1); index_2 (0, 1); values (1, 2);'
        ),
      /Unterminated timing arc table/
    );
    assert.throws(
      () => parseLiberty(wrap('cell_rise (template) { index_1 ("0, 1"); index_2 ("0, 1"); values ("1, ") }')),
      /empty number|Invalid number/i
    );
    assert.throws(
      () => parseLiberty(wrap('cell_rise (template) { index_1 ("0, 1"); index_2 ("0, 1"); values ("1, 2"); }')),
      /value count|does not match/
    );
    assert.throws(() => parseLiberty(wrap('cell_rise ("1, 2");')), /Expected scalar or table timing arc/);
  });

  // ------------------------------------------------------------------
  // EDA cluster: LogicSynthesisEngine
  // ------------------------------------------------------------------
  check('LogicSynthesisEngine synthesize combinational and sequential netlists', () => {
    const src = [
      'module m;',
      'input a, b, c, clk;',
      'output y, q;',
      'assign y = a & b;',
      'assign z = a | b;',
      'assign w = a ^ b;',
      'assign n = ~a;',
      'always @(posedge clk) q <= y;',
      'endmodule'
    ].join('\n');
    const res = LogicSynthesisEngine.synthesize(src, { computeTiming: true, clockPeriod_ps: 1000 });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.moduleName, 'm');
    assert.strictEqual(res.gateCount, 5);
    assert.strictEqual(res.inputs.includes('a'), true);
    assert.strictEqual(res.outputs.includes('y'), true);
    assert.strictEqual(res.timing.status, 'computed-dag');
    assert(res.criticalPathDelay_ps !== undefined);
    assert(res.timingSlack_ps !== undefined);
    assert.strictEqual(res.timing.maxFrequency_MHz !== null, true);
    assert.strictEqual(res.totalArea_um2 > 0, true);
    assert.strictEqual(res.experimentalStatus, 'ESTIMATE_ONLY');
    const cells = res.gates.map((g) => g.cell);
    assert(cells.includes('AND2'));
    assert(cells.includes('OR2'));
    assert(cells.includes('XOR2'));
    assert(cells.includes('INV'));
    assert(cells.includes('DFF'));
  });

  check('LogicSynthesisEngine no-timing and input-delay branches', () => {
    const src = 'module m;\ninput a, b;\noutput y;\nassign y = a & b;\nendmodule';
    const res = LogicSynthesisEngine.synthesize(src);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.timing.status, 'unavailable');
    assert.strictEqual(res.criticalPathDelay_ps, null);
    const withDelay = LogicSynthesisEngine.synthesize(src, { computeTiming: true, inputDelay_ps: 5 });
    assert.strictEqual(withDelay.timing.status, 'computed-dag');
    const withPeriod = LogicSynthesisEngine.synthesize(src, { clockPeriod_ps: 2000 });
    assert.strictEqual(withPeriod.timing.clockPeriod_ps, 2000);
  });

  check('LogicSynthesisEngine failure branches', () => {
    assert.throws(() => LogicSynthesisEngine.synthesize(''), /Explicit non-empty Verilog source/);
    assert.throws(() => LogicSynthesisEngine.synthesize('   '), /Explicit non-empty Verilog source/);
    assert.throws(() => LogicSynthesisEngine.synthesize(42), /Explicit non-empty Verilog source/);
    assert.throws(() => LogicSynthesisEngine.synthesize('input a;'), /A Verilog module declaration is required/);
    assert.throws(() => LogicSynthesisEngine.synthesize('module ;'), /The module declaration could not be recognized/);
    assert.throws(
      () => LogicSynthesisEngine.synthesize('module m;\nassign = y;\nendmodule'),
      /A simple single-line Verilog assignment is required/
    );
    assert.throws(
      () => LogicSynthesisEngine.synthesize('module m;\nassign y = a & 1;\nendmodule'),
      /Boolean operands must be simple identifiers/
    );
    assert.throws(
      () => LogicSynthesisEngine.synthesize('module m;\nassign y = ~1;\nendmodule'),
      /Inversion requires a simple identifier operand/
    );
    assert.throws(() => LogicSynthesisEngine.synthesize('module m;\nassign y = a + b;\nendmodule'), /Only one/);
    assert.throws(
      () => LogicSynthesisEngine.synthesize('module m;\nalways @(posedge clk) q <= y + 1;\nendmodule'),
      /Only a single-line identifier-to-identifier/
    );
    const noGates = LogicSynthesisEngine.synthesize('module m;\ninput a;\noutput y;\nendmodule');
    assert.strictEqual(noGates.success, false);
    assert.strictEqual(noGates.status, 'unavailable');
    assert.strictEqual(noGates.error.code, 'UNSUPPORTED');
    assert.strictEqual(STANDARD_CELL_LIB.INV.delay_ps, 12.0);
  });

  check('LogicSynthesisEngine _mapExpressionToGates operator edges', () => {
    const gates = [];
    LogicSynthesisEngine._mapExpressionToGates('a & b', 'y', gates);
    assert.strictEqual(gates[0].cell, 'AND2');
    LogicSynthesisEngine._mapExpressionToGates('a | b', 'y2', gates);
    assert.strictEqual(gates[1].cell, 'OR2');
    LogicSynthesisEngine._mapExpressionToGates('a ^ b', 'y3', gates);
    assert.strictEqual(gates[2].cell, 'XOR2');
    LogicSynthesisEngine._mapExpressionToGates('~a', 'y4', gates);
    assert.strictEqual(gates[3].cell, 'INV');
    assert.throws(() => LogicSynthesisEngine._mapExpressionToGates('a & b & c', 'y', []), /Only one/);
  });

  // ------------------------------------------------------------------
  // EDA cluster: PlaceAndRouteEngine
  // ------------------------------------------------------------------
  check('PlaceAndRouteEngine constructor validation branches', () => {
    assert.throws(() => new PlaceAndRouteEngine({}), /Explicit positive coreWidth/);
    assert.throws(
      () => new PlaceAndRouteEngine({ coreWidth: 5, coreHeight: 100, stdCellHeight: 10 }),
      /Explicit positive coreWidth/
    );
    assert.throws(
      () => new PlaceAndRouteEngine({ coreWidth: 100, coreHeight: 5, stdCellHeight: 10 }),
      /Explicit positive coreWidth/
    );
    assert.strictEqual(new PlaceAndRouteEngine({ coreWidth: 100, coreHeight: 100, stdCellHeight: 10 }).coreWidth, 100);
    const engine = new PlaceAndRouteEngine({
      coreWidth: 100,
      coreHeight: 100,
      stdCellHeight: 10,
      optimizer: 'greedy',
      seed: 123,
      maxIterations: 100,
      minCellGap: 1,
      densityCols: 2
    });
    assert.strictEqual(engine.optimizer, 'greedy');
    assert.strictEqual(engine.seed, 123);
    assert.strictEqual(engine.maxIterations, 100);
    assert.strictEqual(engine.minCellGap, 1);
    assert.strictEqual(engine.densityCols, 2);
    const anneal = new PlaceAndRouteEngine({ coreWidth: 100, coreHeight: 100, stdCellHeight: 10 });
    assert.strictEqual(anneal.optimizer, 'annealing');
    assert.strictEqual(anneal.seed, 42);
    assert.strictEqual(anneal.maxIterations, 20000);
    assert.strictEqual(anneal.minCellGap, 2.0);
  });

  check('PlaceAndRouteEngine annealing round trip with telemetry', () => {
    const engine = new PlaceAndRouteEngine({ coreWidth: 200, coreHeight: 200, stdCellHeight: 10, seed: 7 });
    const circuit = {
      cells: [
        { id: 'c1', width: 20, height: 10 },
        { id: 'c2', width: 20, height: 10 },
        { id: 'c3', width: 20, height: 10 }
      ],
      nets: [
        { name: 'n1', pins: ['c1', 'c2'] },
        { name: 'n2', pins: ['c2', 'c3'] },
        { name: 'n3', pins: ['c1'] }
      ]
    };
    const res = engine.runPlaceAndRoute(circuit, { seed: 99 });
    assert.strictEqual(res.status, 'EXPERIMENTAL_LAYOUT_ESTIMATE');
    assert.strictEqual(res.cellsPlacedCount, 3);
    assert.strictEqual(res.netsRoutedCount, 2);
    assert.strictEqual(typeof res.placements.c1, 'object');
    assert.strictEqual(typeof res.telemetry.placementMetrics.iterations, 'number');
    assert.strictEqual(typeof res.telemetry.placementMetrics.converged, 'boolean');
    assert.strictEqual(res.telemetry.placementMetrics.startTemperature !== null, true);
    assert.strictEqual(res.telemetry.placementMetrics.coolingAlpha, 0.92);
  });

  check('PlaceAndRouteEngine greedy optimizer and defaults branches', () => {
    const engine = new PlaceAndRouteEngine({ coreWidth: 100, coreHeight: 100, stdCellHeight: 10 });
    const circuit = {
      cells: [{}],
      nets: []
    };
    const res = engine.runPlaceAndRoute(circuit, { optimizer: 'greedy' });
    assert.strictEqual(res.cellsPlacedCount, 1);
    assert.strictEqual(res.telemetry.optimizer, 'greedy');
    assert.strictEqual(res.telemetry.placementMetrics.iterations, 0);
    const idCell = engine.runPlaceAndRoute({ cells: [{ id: 'x', width: 5, height: 5 }], nets: [] });
    assert.strictEqual(idCell.placements.x.cellId, 'x');
    const invalid = engine.runPlaceAndRoute({});
    assert.strictEqual(invalid.success, false);
    assert.strictEqual(invalid.error.code, 'INVALID_INPUT');
    const badCells = engine.runPlaceAndRoute({ cells: [], nets: [] });
    assert.strictEqual(badCells.success, false);
    const badNets = engine.runPlaceAndRoute({ cells: [{ id: 'a' }], nets: 'nope' });
    assert.strictEqual(badNets.success, false);
  });

  check('PlaceAndRouteEngine legalize spill and route filtering branches', () => {
    const engine = new PlaceAndRouteEngine({ coreWidth: 60, coreHeight: 10, stdCellHeight: 10, minCellGap: 0 });
    const wideCells = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, width: 30, height: 10 }));
    const res = engine.runPlaceAndRoute(
      { cells: wideCells, nets: [{ name: 'n', pins: ['w0', 'w7'] }] },
      { optimizer: 'greedy' }
    );
    assert.strictEqual(res.cellsPlacedCount, 8);
    const route = engine._route(res.placements, [{ name: 'short', pins: ['w0'] }]);
    assert.strictEqual(route.routes.length, 0);
    const routeSkip = engine._route(res.placements, [{ name: 'bad', pins: ['missing', 'also-missing'] }]);
    assert.strictEqual(routeSkip.routes.length, 0);
    const routeSkipNull = engine._route(res.placements, [null, { name: 'n2', pins: [] }]);
    assert.strictEqual(routeSkipNull.routes.length, 0);
    const cellIds = Object.keys(res.placements).map((id) => ({ id }));
    const idx = engine._indexNets([{ name: 'n', pins: ['w0', 'w0', 'w1'] }], cellIds);
    assert.strictEqual(idx.length, 1);
    assert.strictEqual(idx[0].pins.length, 2);
  });

  // ------------------------------------------------------------------
  // EDA cluster: StaticTimingAnalysis
  // ------------------------------------------------------------------
  check('StaticTimingAnalysis parasitics, Elmore, and path timing branches', () => {
    const pex = StaticTimingAnalysis.extractParasitics({
      lengthMm: 2,
      widthUm: 1,
      thicknessUm: 0.5,
      dielectricHeightUm: 1.5,
      dielectricConstant: 4.3,
      resistivityOhmM: 1.68e-8
    });
    assert.strictEqual(pex.lengthMm, 2);
    assert(pex.resistanceOhms > 0);
    assert(pex.capacitancePf > 0);
    const defaults = StaticTimingAnalysis.extractParasitics({});
    assert.strictEqual(defaults.lengthMm, 1.0);
    const elmore = StaticTimingAnalysis.computeElmoreDelay(100, 50, 1e-12, 0.1e-12);
    assert(Number.isFinite(elmore));
    const met = StaticTimingAnalysis.evaluatePathTiming({ clockPeriodNs: 5 });
    assert.strictEqual(met.status, 'TIMING_MET');
    assert.strictEqual(met.isSetupMet, true);
    assert.strictEqual(met.isHoldMet, true);
    const setupViolation = StaticTimingAnalysis.evaluatePathTiming({
      clockPeriodNs: 0.5,
      tLaunchCqNs: 0.35,
      tSetupNs: 0.15,
      gateDelaysNs: [0.5],
      wireDelaysNs: [0.1]
    });
    assert.strictEqual(setupViolation.status, 'SETUP_VIOLATION');
    const holdViolation = StaticTimingAnalysis.evaluatePathTiming({
      clockPeriodNs: 5,
      clockSkewNs: 2,
      tHoldNs: 0.5,
      tLaunchCqNs: 0.1,
      gateDelaysNs: [0.1],
      wireDelaysNs: [0.1]
    });
    assert.strictEqual(holdViolation.status, 'HOLD_VIOLATION');
    assert.strictEqual(holdViolation.isHoldMet, false);
    assert.strictEqual(met.breakdown.logicDelay_ns, 1.15);
  });

  check('StaticTimingAnalysis MCMM corners branches', () => {
    const res = StaticTimingAnalysis.evaluateMCMM({ clockPeriodNs: 5, name: 'CP' });
    assert.strictEqual(res.cornerCount, 3);
    assert(res.screeningPassed === true || res.screeningPassed === false);
    assert.strictEqual(typeof res.worstSetupCorner, 'string');
    const custom = StaticTimingAnalysis.evaluateMCMM(
      {
        clockPeriodNs: 2,
        gateDelaysNs: [1],
        wireDelaysNs: [1],
        tLaunchCqNs: 0.5,
        tSetupNs: 0.2,
        tHoldNs: 0.1,
        clockSkewNs: 0.1
      },
      [{ name: 'x', pvtFactor: 1.5, ocvLate: 1.2, ocvEarly: 0.8, desc: 'x' }]
    );
    assert.strictEqual(custom.cornerCount, 1);
    assert.strictEqual(custom.cornerReports[0].corner, 'x');
  });

  check('StaticTimingAnalysis analyzeTiming DAG success paths', () => {
    const graph = {
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'ff1', type: 'ff', delay: 0.1 },
        { id: 'g', type: 'gate' },
        { id: 'out', type: 'output' }
      ],
      edges: [
        { from: 'in', to: 'ff1', delay: 0.01 },
        { from: 'ff1', to: 'g', delay: 0.02 },
        { from: 'g', to: 'out', delay: 0.03 }
      ]
    };
    const res = StaticTimingAnalysis.analyzeTiming(graph, {
      corners: [{ name: 'slow', delays: { defaultCell: 0.2, defaultNet: 0.05 } }],
      modes: [{ name: 'func', constraints: { period: 1, setup: 0.1, hold: 0.05, skew: 0.01, tCq: 0.2 } }]
    });
    assert.strictEqual(res.graph.nodeCount, 4);
    assert.strictEqual(res.corners.length, 1);
    assert.strictEqual(res.corners[0].modes[0].mode, 'func');
    assert.strictEqual(typeof res.worstSetupSlackOverall, 'number');
    assert.strictEqual(typeof res.worstHoldSlackOverall, 'number');
    assert.strictEqual(typeof res.timingMetOverall, 'boolean');
  });

  check('StaticTimingAnalysis analyzeTiming default corners/modes and per-edge delays', () => {
    const graph = {
      nodes: [
        { id: 'a', type: 'input' },
        { id: 'b', type: 'ff' },
        { id: 'c', type: 'output' }
      ],
      edges: [
        { from: 'a', to: 'b', delay: 0.05 },
        { from: 'b', to: 'c' }
      ]
    };
    const res = StaticTimingAnalysis.analyzeTiming(graph);
    assert.strictEqual(res.corners.length, 1);
    assert.strictEqual(res.corners[0].corner, 'typical');
    assert.strictEqual(res.corners[0].modes[0].mode, 'function');
    assert.strictEqual(res.corners[0].modes[0].slacks.length, 2);
  });

  check('StaticTimingAnalysis analyzeTiming validation error branches', () => {
    assert.throws(() => StaticTimingAnalysis.analyzeTiming(null), /requires a timing graph object/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming('x'), /requires a timing graph object/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [] }), /at least one node/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [{}] }), /non-empty string id/);
    assert.throws(() => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }, { id: 'a' }] }), /duplicate node id/);
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a', type: 'weird' }] }),
      /unsupported type/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }], edges: [{ from: 'a' }] }),
      /requires string from\/to/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'z' }] }),
      /references unknown node/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'a' }] }),
      /self-loop/
    );
    const cyclic = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' }
      ]
    };
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming(cyclic),
      (err) => {
        assert.strictEqual(err.name, 'CyclicGraphError');
        return true;
      }
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }] }, { corners: [{}] }),
      /corner requires a name/
    );
    assert.throws(
      () => StaticTimingAnalysis.analyzeTiming({ nodes: [{ id: 'a' }] }, { modes: [{}] }),
      /mode requires a name/
    );
    assert.throws(
      () =>
        StaticTimingAnalysis.analyzeTiming(
          { nodes: [{ id: 'a' }] },
          {
            modes: [{ name: 'm', constraints: { period: -1 } }]
          }
        ),
      /must be finite, non-negative/
    );
  });

  check('StaticTimingAnalysis constructor analyzePath with and without interconnect trace', () => {
    const sta = new StaticTimingAnalysis({ clockPeriodPs: 4000 });
    const res = sta.analyzePath({ tCqPs: 100, tSetupPs: 50, tHoldPs: 20, logicGateDelayPs: 500 });
    assert(res.setupSlackPs !== undefined);
    assert.strictEqual(res.interconnectDelayPs, 0);
    const withTrace = sta.analyzePath({
      interconnectTrace: { lengthUm: 2000, widthUm: 1.5, thicknessUm: 0.6, substrateHeightUm: 1.2, er: 4.0 }
    });
    assert(withTrace.interconnectDelayPs > 0);
    const defaults = new StaticTimingAnalysis();
    assert.strictEqual(defaults.clockPeriodPs, 5000);
  });

  // ------------------------------------------------------------------
  // EDA cluster: polygon boolean engine
  // ------------------------------------------------------------------
  check('Polygon2D area and point-in-polygon branches', () => {
    const square = new Polygon2D([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]);
    assert.strictEqual(square.area(), 100);
    assert.strictEqual(square.isPointInside(5, 5), true);
    assert.strictEqual(square.isPointInside(15, 5), false);
    const triangle = new Polygon2D([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 }
    ]);
    assert(Math.abs(triangle.area() - 8) < 1e-9);
    assert.strictEqual(triangle.isPointInside(1, 1), true);
    assert.strictEqual(triangle.isPointInside(3, 3), false);
  });

  check('PolygonBooleanEngine intersect clipping and size operations', () => {
    const a = new Polygon2D([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]);
    const b = new Polygon2D([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 }
    ]);
    const inter = PolygonBooleanEngine.intersect(a, b);
    assert.strictEqual(inter.length, 1);
    assert.strictEqual(inter[0].area(), 25);
    const far = new Polygon2D([
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 }
    ]);
    const disjoint = PolygonBooleanEngine.intersect(a, far);
    assert.strictEqual(disjoint.length, 0);
    const grown = PolygonBooleanEngine.sizePolygon(b, -5);
    assert(grown.area() > b.area());
    const shrunk = PolygonBooleanEngine.sizePolygon(b, 5);
    assert(shrunk.area() < b.area());
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 10, y: 0 };
    const p3 = { x: 0, y: 5 };
    const p4 = { x: 10, y: 5 };
    const degenerate = PolygonBooleanEngine._computeIntersection(p1, p2, p3, p4);
    assert.strictEqual(degenerate.x, 0);
  });

  // ------------------------------------------------------------------
  // EDA cluster: DRCEngine
  // ------------------------------------------------------------------
  check('DRCEngine.runDRC rectangular screening branches', () => {
    const shapes = [
      { id: 's1', layer: 'M1', x: 0, y: 0, w: 2, h: 2 },
      { id: 's2', layer: 'M1', x: 3, y: 0, w: 10, h: 10 },
      { id: 's3', layer: 'M1', x: 3, y: 0, w: 4, h: 4 }
    ];
    const rules = { minWidth: 5, minSpacing: 1, minArea: 50 };
    const res = DRCEngine.runDRC(shapes, rules);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.clean, false);
    const types = res.violations.map((v) => v.type);
    assert(types.includes('MIN_WIDTH_VIOLATION'));
    assert(types.includes('MIN_AREA_VIOLATION'));
    assert(types.includes('SHORT_CIRCUIT_OVERLAP'));
    assert.strictEqual(res.verdict, 'EXPERIMENTAL_RECTANGLE_SCREENING_FLAGS');
    const cleanShapes = [{ id: 'c1', layer: 'M1', x: 0, y: 0, w: 100, h: 100 }];
    const clean = DRCEngine.runDRC(cleanShapes, { minWidth: 5, minSpacing: 1, minArea: 10 });
    assert.strictEqual(clean.clean, true);
    assert.strictEqual(clean.verdict, 'EXPERIMENTAL_RECTANGLE_SCREENING_CLEAR');
    const spacingShapes = [
      { id: 'p1', layer: 'M1', x: 0, y: 0, w: 10, h: 10 },
      { id: 'p2', layer: 'M2', x: 0, y: 0, w: 10, h: 10 },
      { id: 'p3', layer: 'M1', x: 14, y: 0, w: 10, h: 10 }
    ];
    const spacing = DRCEngine.runDRC(spacingShapes, { minWidth: 1, minSpacing: 5, minArea: 1 });
    const spacingTypes = spacing.violations.map((v) => v.type);
    assert(!spacingTypes.includes('SHORT_CIRCUIT_OVERLAP'));
    assert(spacingTypes.includes('MIN_SPACING_VIOLATION'));
  });

  check('DRCEngine.runDRC invalid input branches', () => {
    const rules = { minWidth: 1, minSpacing: 1, minArea: 1 };
    const bad = DRCEngine.runDRC([], rules);
    assert.strictEqual(bad.success, false);
    assert.strictEqual(bad.error.code, 'INVALID_INPUT');
    assert.strictEqual(DRCEngine.runDRC('x', rules).success, false);
    assert.strictEqual(DRCEngine.runDRC([{ id: 'a', layer: 'M1', x: 0, y: 0, w: 1, h: 1 }], null).success, false);
    assert.strictEqual(DRCEngine.runDRC([{ id: 'a', layer: 'M1', x: 0, y: 0, w: 1, h: 1 }], []).success, false);
    assert.strictEqual(
      DRCEngine.runDRC([{ id: 'a', layer: 'M1', x: 0, y: 0, w: 1, h: 1 }], { minWidth: 0, minSpacing: 1, minArea: 1 })
        .success,
      false
    );
    assert.strictEqual(
      DRCEngine.runDRC([{ id: 'a', layer: 'M1', x: 0, y: 0, w: 1, h: 1 }], { minWidth: 1, minSpacing: 1, minArea: 1 })
        .success,
      true
    );
    assert.strictEqual(DRCEngine.runDRC([{ id: '', layer: 'M1', x: 0, y: 0, w: 1, h: 1 }], rules).success, false);
    assert.strictEqual(DRCEngine.runDRC([{ id: 'a', layer: '', x: 0, y: 0, w: 1, h: 1 }], rules).success, false);
    assert.strictEqual(DRCEngine.runDRC([{ id: 'a', layer: 'M1', x: NaN, y: 0, w: 1, h: 1 }], rules).success, false);
    assert.strictEqual(DRCEngine.runDRC([{ id: 'a', layer: 'M1', x: 0, y: 0, w: 0, h: 1 }], rules).success, false);
    assert.strictEqual(DRCEngine.runDRC([{ id: 'a', layer: 'M1', x: 0, y: 0, w: 1, h: -1 }], rules).success, false);
    assert.strictEqual(
      DRCEngine.runDRC(
        [
          { id: 'a', layer: 'M1', x: 0, y: 0, w: 1, h: 1 },
          { id: 'a', layer: 'M1', x: 5, y: 5, w: 1, h: 1 }
        ],
        rules
      ).success,
      false
    );
    const many = Array.from({ length: 2001 }, (_, i) => ({ id: `s${i}`, layer: 'M1', x: 0, y: 0, w: 1, h: 1 }));
    assert.strictEqual(DRCEngine.runDRC(many, rules).success, false);
  });

  check('DRCEngine.runPolygonDRC box conversion and validity branches', () => {
    const shapes = [
      { id: 'b1', layer: 'M1', x: 0, y: 0, w: 100, h: 100 },
      {
        id: 'p1',
        layer: 'M1',
        vertices: [
          { x: 200, y: 0 },
          { x: 210, y: 0 },
          { x: 210, y: 10 },
          { x: 200, y: 10 }
        ]
      }
    ];
    const res = DRCEngine.runPolygonDRC(shapes, { minWidth: 1, minSpacing: 2, minArea: 1 });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.clean, true);
    const self = DRCEngine.runPolygonDRC(
      [
        {
          id: 'bow',
          layer: 'M1',
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 10, y: 0 }
          ]
        }
      ],
      { minWidth: 1, minSpacing: 1 }
    );
    assert.strictEqual(self.success, false);
    assert.strictEqual(self.error.code, 'INVALID_POLYGON_SELF_INTERSECTION');
    assert.strictEqual(self.error.edges.length, 2);
  });

  check('DRCEngine.runPolygonDRC width/area/spacing/enclosure branches', () => {
    const notch = {
      id: 'n1',
      layer: 'M1',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 60, y: 100 },
        { x: 60, y: 90 },
        { x: 40, y: 90 },
        { x: 40, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    const small = {
      id: 's1',
      layer: 'M2',
      vertices: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 }
      ]
    };
    const far = {
      id: 'f1',
      layer: 'M1',
      vertices: [
        { x: 500, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 10 },
        { x: 500, y: 10 }
      ]
    };
    const mid = {
      id: 'm1',
      layer: 'M1',
      vertices: [
        { x: 120, y: 0 },
        { x: 130, y: 0 },
        { x: 130, y: 10 },
        { x: 120, y: 10 }
      ]
    };
    const res = DRCEngine.runPolygonDRC([notch, small, far, mid], {
      minWidth: { M1: 20, M2: 10 },
      minSpacing: 30,
      spacingByLayer: { 'M1:M2': 50 },
      minArea: 100,
      enclosures: [{ layer: 'M2', enclosingLayer: 'M1', margin: 2 }]
    });
    assert.strictEqual(res.success, true);
    const types = res.violations.map((v) => v.type);
    assert(types.includes('MIN_WIDTH_VIOLATION'));
    assert(types.includes('MIN_AREA_VIOLATION'));
    assert(types.includes('MIN_SPACING_VIOLATION'));
    assert(types.includes('ENCLOSURE_VIOLATION'));
    const enclosed = {
      id: 'inner',
      layer: 'M2',
      vertices: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 }
      ]
    };
    const host = {
      id: 'host',
      layer: 'M1',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    const good = DRCEngine.runPolygonDRC([host, enclosed], {
      minWidth: 1,
      minSpacing: 1,
      enclosures: [{ layer: 'M2', enclosingLayer: 'M1', margin: 5 }]
    });
    assert.strictEqual(good.clean, true);
    const noHost = DRCEngine.runPolygonDRC([enclosed], {
      minWidth: 1,
      minSpacing: 1,
      enclosures: [{ layer: 'M2', enclosingLayer: 'M1', margin: 5 }]
    });
    assert.strictEqual(noHost.violations.length, 1);
    assert.strictEqual(noHost.violations[0].type, 'ENCLOSURE_VIOLATION');
    const badRule = DRCEngine.runPolygonDRC([host, enclosed], {
      minWidth: 1,
      minSpacing: 1,
      enclosures: [{ enclosingLayer: 'M1' }]
    });
    assert.strictEqual(badRule.clean, true);
    const overlapHost = {
      id: 'host2',
      layer: 'M1',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    const overlap = DRCEngine.runPolygonDRC([host, overlapHost], { minWidth: 1, minSpacing: 1 });
    assert.strictEqual(overlap.violations[0].type, 'SHORT_CIRCUIT_OVERLAP');
  });

  check('DRCEngine.runPolygonDRC input validation branches', () => {
    const rules = { minWidth: 1, minSpacing: 1 };
    assert.strictEqual(DRCEngine.runPolygonDRC([], rules).success, false);
    assert.strictEqual(DRCEngine.runPolygonDRC('x', rules).success, false);
    assert.strictEqual(DRCEngine.runPolygonDRC([{ id: 'a', layer: 'M1', vertices: [] }], rules).success, false);
    assert.strictEqual(DRCEngine.runPolygonDRC([null], rules).success, false);
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: '',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 }
            ]
          }
        ],
        rules
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: '',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 }
            ]
          }
        ],
        rules
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: NaN },
              { x: 0, y: 1 }
            ]
          }
        ],
        rules
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
              { x: 1, y: 1 }
            ]
          }
        ],
        rules
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
              { x: 0, y: 0 }
            ]
          }
        ],
        rules
      ).success,
      true
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 }
            ]
          }
        ],
        rules
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 }
            ]
          }
        ],
        null
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 }
            ]
          }
        ],
        { minWidth: 0, minSpacing: 1 }
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 }
            ]
          }
        ],
        { minWidth: 1, minSpacing: 0 }
      ).success,
      false
    );
    assert.strictEqual(
      DRCEngine.runPolygonDRC(
        [
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 }
            ]
          },
          {
            id: 'a',
            layer: 'M1',
            vertices: [
              { x: 5, y: 5 },
              { x: 6, y: 5 },
              { x: 5, y: 6 }
            ]
          }
        ],
        rules
      ).success,
      false
    );
    const manyShapes = Array.from({ length: 5001 }, (_, i) => ({
      id: `m${i}`,
      layer: 'M1',
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 }
      ]
    }));
    assert.strictEqual(DRCEngine.runPolygonDRC(manyShapes, rules).success, false);
    const manyVerts = Array.from({ length: 2500 }, (_, i) => {
      const verts = [];
      for (let k = 0; k < 41; k++) {
        verts.push({ x: k, y: k + i });
      }
      return { id: `v${i}`, layer: 'M1', vertices: verts };
    });
    assert.strictEqual(DRCEngine.runPolygonDRC(manyVerts, rules).success, false);
  });

  check('DRCEngine.runLVS matching and validation branches', () => {
    const gates = [
      { id: 'G1', cell: 'INV' },
      { id: 'G2', cell: 'INV' },
      { id: 'G3', cell: 'NAND2' }
    ];
    const shapes = [
      { id: 'G1', cellType: 'INV' },
      { name: 'G2', type: 'INV' },
      { id: 'G3', cell: 'NAND2' },
      { id: 'EXTRA', cell: 'INV' }
    ];
    const matched = DRCEngine.runLVS(gates, shapes);
    assert.strictEqual(matched.success, true);
    assert.strictEqual(matched.isLVSMatched, false);
    assert.strictEqual(matched.matchedCount, 3);
    assert.strictEqual(matched.unmatchedLayout.length, 1);
    assert.strictEqual(matched.verdict, 'EXPERIMENTAL_HEURISTIC_MISMATCH');
    const exact = DRCEngine.runLVS([{ id: 'A', cell: 'BUF' }], [{ id: 'A', cell: 'BUF' }]);
    assert.strictEqual(exact.isLVSMatched, true);
    assert.strictEqual(exact.verdict, 'EXPERIMENTAL_HEURISTIC_MATCH');
    const viaCells = DRCEngine.runLVS({ gates: [{ id: 'Z', cell: 'X' }] }, { cells: [{ id: 'Z', cellType: 'X' }] });
    assert.strictEqual(viaCells.isLVSMatched, true);
    assert.strictEqual(DRCEngine.runLVS([], shapes).success, false);
    assert.strictEqual(DRCEngine.runLVS(gates, []).success, false);
    assert.strictEqual(DRCEngine.runLVS(null, null).success, false);
    assert.strictEqual(DRCEngine.runLVS([{ cell: 'X' }], shapes).success, false);
    assert.strictEqual(
      DRCEngine.runLVS(
        [
          { id: 'A', cell: 'X' },
          { id: 'A', cell: 'X' }
        ],
        shapes
      ).success,
      false
    );
    assert.strictEqual(DRCEngine.runLVS(gates, [null]).success, false);
    assert.strictEqual(DRCEngine.runLVS(gates, [{ id: '', cell: 'X' }]).success, false);
    const tooManyGates = Array.from({ length: 10001 }, (_, i) => ({ id: `g${i}`, cell: 'INV' }));
    assert.strictEqual(DRCEngine.runLVS(tooManyGates, [{ id: 'G1', cell: 'INV' }]).success, false);
    const tooManyShapes = Array.from({ length: 10001 }, (_, i) => ({ id: `s${i}`, cell: 'INV' }));
    assert.strictEqual(DRCEngine.runLVS([{ id: 'G1', cell: 'INV' }], tooManyShapes).success, false);
    assert.strictEqual(DRCEngine.Spice, SpiceEngine);
    assert.strictEqual(DRCEngine.STA, StaticTimingAnalysis);
  });

  // ------------------------------------------------------------------
  // EDA cluster: SpiceEngine
  // ------------------------------------------------------------------
  check('SpiceEngine DC operating point with nonlinear devices', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5);
    spice.addResistor('R1', 'in', 'out', 1000);
    spice.addDiode('D1', 'out', '0', { Is: 1e-14, n: 1.0 });
    spice.addMOSFET('M1', 'out', 'in', '0', 'NMOS', 0.7, 1e-3, 0.01);
    const res = spice.solveDCOperatingPoint(50, 1e-6);
    assert.strictEqual(typeof res.nodeVoltages, 'object');
    assert.strictEqual(res.nodeVoltages['0'], 0);
    assert.strictEqual(typeof res.branchCurrents.V1, 'number');
    assert(res.converged === true || res.converged === false);
    const alias = spice.runDCOperatingPoint(20, 1e-5);
    assert(alias.iterations !== undefined);
  });

  check('SpiceEngine inductor and current source stamps', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5);
    spice.addInductor('L1', 'in', 'out', 1e-6, 0.01);
    spice.addResistor('R1', 'out', '0', 100);
    spice.addCurrentSource('I1', 'out', '0', 0.001);
    const res = spice.solveDCOperatingPoint();
    assert.strictEqual(typeof res.nodeVoltages.in, 'number');
    assert.strictEqual(typeof res.nodeVoltages.out, 'number');
  });

  check('SpiceEngine singular MNA matrix error branch', () => {
    const spice = new SpiceEngine();
    spice.addCurrentSource('I1', 'n1', 'n2', 0.001);
    assert.throws(() => spice.solveDCOperatingPoint(5, 1e-6), /Singular MNA matrix/);
  });

  check('SpiceEngine transient waveforms and capacitor/inductor companion branch', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 0, { type: 'STEP', v1: 0, v2: 5, delay: 0.00005 });
    spice.addVoltageSource('V2', 'in2', '0', 0, { type: 'SINE', freq: 1e3, offset: 1, amplitude: 2 });
    spice.addVoltageSource('V3', 'in3', '0', 0, {
      type: 'PULSE',
      v1: 0,
      v2: 3,
      period: 0.0005,
      width: 0.0002,
      delay: 0
    });
    spice.addVoltageSource('V4', 'in4', '0', 2.5, { type: 'TRIANGLE' });
    spice.addResistor('R1', 'in', 'out', 1000);
    spice.addCapacitor('C1', 'out', '0', 1e-6, 0.5);
    spice.addInductor('L1', 'out', 'out2', 1e-6, 0);
    spice.addResistor('R2', 'out2', '0', 1000);
    const res = spice.runTransient(0.001, 1e-5);
    assert(Array.isArray(res.time));
    assert(res.time.length > 0);
    assert(res.nodes['in'] !== undefined);
    assert.strictEqual(res.waveforms, res.nodes);
  });

  check('SpiceEngine transient with unknown waveform default and partial nets', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 3, { type: 'MYSTERY' });
    spice.addResistor('R1', 'in', 'out', 500);
    const res = spice.runTransient(0.0002, 1e-5);
    assert(Array.isArray(res.time));
    const spice2 = new SpiceEngine();
    spice2.addVoltageSource('V1', 'in', '0', 3);
    spice2.addResistor('R1', 'in', 'out', 1000);
    spice2.addResistor('R2', 'out', '0', 1000);
    const res2 = spice2.solveDCOperatingPoint();
    assert.strictEqual(res2.converged, true);
    assert.strictEqual(typeof res2.nodeVoltages.out, 'number');
  });

  check('SpiceEngine adders and rocket stubs', () => {
    const spice = new SpiceEngine();
    spice.addResistor('R1', 'a', 'b', 0);
    assert.strictEqual(spice.components[0].value, 1e-12);
    spice.addCapacitor('C1', 'a', 'b', 0, 1);
    assert.strictEqual(spice.components[1].value, 1e-18);
    assert.strictEqual(spice.components[1].v0, 1);
    spice.addInductor('L1', 'a', 'b', 0);
    assert.strictEqual(spice.components[2].value, 1e-18);
    spice.addVoltageSource('V1', 'a', 'b', 3, null);
    assert.strictEqual(spice.components[3].dcValue, 3);
    spice.addCurrentSource('I1', 'a', 'b', 0.002);
    assert.strictEqual(spice.components[4].value, 0.002);
    spice.addDiode('D1', 'a', 'b', 1e-12, 1.2);
    assert.strictEqual(spice.components[5].Is, 1e-12);
    spice.addMOSFET('M1', 'd', 'g', 's');
    assert.strictEqual(spice.components[6].mosType, 'NMOS');
    spice._registerNodes();
    assert.strictEqual(typeof spice.addResistor('R2', 'c', 'd', 50), 'object');
    const stub = SpiceEngine.createRocketIgnitionControllerCircuit();
    assert.strictEqual(stub.success, false);
    const stub2 = SpiceEngine.simulateDualAugmentedSparkIgniter();
    assert.strictEqual(stub2.success, false);
  });

  // ------------------------------------------------------------------
  // EDA cluster: MCMM STA engine
  // ------------------------------------------------------------------
  check('MCMMStaticTimingEngine.runMCMMAnalysis branches', () => {
    assert.throws(() => MCMMStaticTimingEngine.runMCMMAnalysis(null), /Timing-screen inputs are required/);
    assert.throws(() => MCMMStaticTimingEngine.runMCMMAnalysis({}), /Missing required timing-screen inputs/);
    assert.throws(
      () =>
        MCMMStaticTimingEngine.runMCMMAnalysis({
          clockPeriodNs: 1,
          logicDelayTypNs: -1,
          clockSkewNs: 0,
          tCqTypNs: 0.1,
          tSetupTypNs: 0.1,
          tHoldTypNs: 0.1
        }),
      /finite non-negative number/
    );
    assert.throws(
      () =>
        MCMMStaticTimingEngine.runMCMMAnalysis({
          clockPeriodNs: 0,
          logicDelayTypNs: 1,
          clockSkewNs: 0,
          tCqTypNs: 0.1,
          tSetupTypNs: 0.1,
          tHoldTypNs: 0.1,
          corners: []
        }),
      /greater than zero/
    );
    assert.throws(
      () =>
        MCMMStaticTimingEngine.runMCMMAnalysis({
          clockPeriodNs: 1,
          logicDelayTypNs: 1,
          clockSkewNs: 0,
          tCqTypNs: 0.1,
          tSetupTypNs: 0.1,
          tHoldTypNs: 0.1
        }),
      /At least one caller-supplied timing corner/
    );
    assert.throws(
      () =>
        MCMMStaticTimingEngine.runMCMMAnalysis({
          clockPeriodNs: 1,
          logicDelayTypNs: 1,
          clockSkewNs: 0,
          tCqTypNs: 0.1,
          tSetupTypNs: 0.1,
          tHoldTypNs: 0.1,
          corners: [{}]
        }),
      /non-empty name/
    );
    assert.throws(
      () =>
        MCMMStaticTimingEngine.runMCMMAnalysis({
          clockPeriodNs: 1,
          logicDelayTypNs: 1,
          clockSkewNs: 0,
          tCqTypNs: 0.1,
          tSetupTypNs: 0.1,
          tHoldTypNs: 0.1,
          corners: [{ name: 'c', voltage: 1, temperatureC: 25, processScale: NaN }]
        }),
      /must be finite/
    );
    assert.throws(
      () =>
        MCMMStaticTimingEngine.runMCMMAnalysis({
          clockPeriodNs: 1,
          logicDelayTypNs: 1,
          clockSkewNs: 0,
          tCqTypNs: 0.1,
          tSetupTypNs: 0.1,
          tHoldTypNs: 0.1,
          corners: [{ name: 'c', voltage: 0, temperatureC: 25, processScale: 1 }]
        }),
      /must be positive/
    );
    const res = MCMMStaticTimingEngine.runMCMMAnalysis({
      clockPeriodNs: 2,
      logicDelayTypNs: 0.5,
      clockSkewNs: 0.1,
      tCqTypNs: 0.2,
      tSetupTypNs: 0.15,
      tHoldTypNs: 0.1,
      corners: [
        { name: 'WCS', voltage: 0.9, temperatureC: 125, processScale: 1.25 },
        { name: 'BCF', voltage: 1.1, temperatureC: -40, processScale: 0.8 },
        { name: 'TYP', voltage: 1.0, temperatureC: 25, processScale: 1.0 }
      ]
    });
    assert.strictEqual(res.cornerResults.length, 3);
    assert.strictEqual(res.cornerResults[0].corner, 'WCS');
    assert.strictEqual(typeof res.screeningPassed, 'boolean');
    assert.strictEqual(res.verdict.includes('EXPERIMENTAL_TIMING_SCREEN'), true);
    assert.strictEqual(res.clockFrequencyMHz, 500);
    const corner = new MCMMTimingCorner('X', 1, 25, 1);
    assert.strictEqual(corner.name, 'X');
    assert.strictEqual(corner.processScale, 1);
  });

  check('MCMMStaticTimingEngine.evaluateCDCSynchronizer branches', () => {
    assert.throws(
      () => MCMMStaticTimingEngine.evaluateCDCSynchronizer(0, 1e6, 2, 1e-6, 1e-10),
      /must be a positive finite number/
    );
    assert.throws(
      () => MCMMStaticTimingEngine.evaluateCDCSynchronizer(1e8, NaN, 2, 1e-6, 1e-10),
      /must be a positive finite number/
    );
    assert.throws(
      () => MCMMStaticTimingEngine.evaluateCDCSynchronizer(1e8, 1e6, 1, 1e-6, 1e-10),
      /must be an integer of at least 2/
    );
    assert.throws(
      () => MCMMStaticTimingEngine.evaluateCDCSynchronizer(1e8, 1e6, 2.5, 1e-6, 1e-10),
      /must be an integer of at least 2/
    );
    const res = MCMMStaticTimingEngine.evaluateCDCSynchronizer(1e8, 1e6, 2, 1e-6, 1e-10);
    assert(res.mtbfYears > 0);
    assert.strictEqual(res.numSyncFlops, 2);
    assert.strictEqual(res.validationLevel, 'experimental');
    const res3 = MCMMStaticTimingEngine.evaluateCDCSynchronizer(1e8, 1e6, 3, 1e-6, 1e-10);
    assert(res3.mtbfYears > res.mtbfYears);
  });

  // ------------------------------------------------------------------
  // EDA cluster: CCS timing model
  // ------------------------------------------------------------------
  check('CCSTimingModel constructor defaults and table generation', () => {
    const model = new CCSTimingModel();
    assert.strictEqual(model.cellName, 'INV_X4');
    assert.strictEqual(model.vdd, 1.0);
    assert.strictEqual(model.pinCapacitanceFf, 0.8);
    assert.strictEqual(model.defaultPeakCurrentMa, 8.0);
    assert.strictEqual(model.table, null);
    const custom = new CCSTimingModel({
      cellName: 'BUF',
      supplyVoltageV: 1.2,
      pinCapacitanceFf: 1.5,
      peakDriverCurrentMa: 12
    });
    assert.strictEqual(custom.cellName, 'BUF');
    assert.strictEqual(custom.vdd, 1.2);
    assert.strictEqual(custom.pinCapacitanceFf, 1.5);
    assert.strictEqual(custom.defaultPeakCurrentMa, 12);
    const tbl = CCSTimingModel._defaultDriveTable(1.0, 8.0);
    assert.strictEqual(tbl.vinGrid.length, 33);
    assert.strictEqual(tbl.voutGrid.length, 33);
    assert.strictEqual(tbl.currents.length, 33);
    assert.strictEqual(tbl.currents[0].length, 33);
  });

  check('CCSTimingModel.validateTable branches', () => {
    assert.throws(() => CCSTimingModel.validateTable(null), /driver table must be/);
    assert.throws(() => CCSTimingModel.validateTable({}), /driver table must be/);
    assert.throws(
      () => CCSTimingModel.validateTable({ vinGrid: [0], voutGrid: [0, 1], currents: [[0, 0]] }),
      /at least 2 points/
    );
    assert.throws(
      () => CCSTimingModel.validateTable({ vinGrid: [0, 1], voutGrid: [0, 1], currents: [[0]] }),
      /ni x nj matrix/
    );
    assert.throws(
      () =>
        CCSTimingModel.validateTable({
          vinGrid: [0, 0],
          voutGrid: [0, 1],
          currents: [
            [0, 0],
            [0, 0]
          ]
        }),
      /vinGrid must be strictly increasing/
    );
    assert.throws(
      () =>
        CCSTimingModel.validateTable({
          vinGrid: [0, 1],
          voutGrid: [1, 1],
          currents: [
            [0, 0],
            [0, 0]
          ]
        }),
      /voutGrid must be strictly increasing/
    );
    assert.throws(
      () =>
        CCSTimingModel.validateTable({
          vinGrid: [0, 1],
          voutGrid: [0, 1],
          currents: [
            [0, NaN],
            [0, 0]
          ]
        }),
      /must be finite/
    );
    assert.strictEqual(
      CCSTimingModel.validateTable({
        vinGrid: [0, 1],
        voutGrid: [0, 1],
        currents: [
          [0, 1],
          [1, 2]
        ]
      }),
      true
    );
  });

  check('CCSTimingModel interpolateCurrent and receiver capacitance branches', () => {
    const table = {
      vinGrid: [0, 1, 2],
      voutGrid: [0, 1, 2],
      currents: [
        [0, 1, 2],
        [1, 2, 3],
        [2, 3, 4]
      ]
    };
    assert.strictEqual(CCSTimingModel.interpolateCurrent(table, -5, -5), 0);
    assert.strictEqual(CCSTimingModel.interpolateCurrent(table, 10, 10), 4);
    assert.strictEqual(CCSTimingModel.interpolateCurrent(table, 1, 1), 2);
    const model = new CCSTimingModel();
    assert(Math.abs(model.evaluateReceiverCapacitance(0.5) - 0.8e-15) < 1e-28);
    const cv = new CCSTimingModel({
      cvTable: { vGrid: [0, 0.5, 1.0], cFfValues: [1, 2, 3] }
    });
    assert(Math.abs(cv.evaluateReceiverCapacitance(0.25) - 1.5e-15) < 1e-28);
    assert(Math.abs(cv.evaluateReceiverCapacitance(10) - 3e-15) < 1e-28);
    assert.strictEqual(cv.evaluateReceiverCapacitance(-10), 1e-15);
    const badCv = new CCSTimingModel({ cvTable: { vGrid: [0, 1], cFfValues: [1] } });
    assert.throws(() => badCv.evaluateReceiverCapacitance(0.5), /matching, ascending/);
    const flatCv = new CCSTimingModel({ cvTable: { vGrid: [0, 0, 1], cFfValues: [1, 1, 2] } });
    assert.throws(() => flatCv.evaluateReceiverCapacitance(0.5), /strictly increasing/);
  });

  check('CCSTimingModel characterizeCell with provided table and fall direction', () => {
    const model = new CCSTimingModel({ supplyVoltageV: 1.0 });
    const table = {
      vinGrid: [0, 0.5, 1.0],
      voutGrid: [0, 0.5, 1.0],
      currents: [
        [5e-3, 4e-3, 3e-3],
        [3e-3, 2e-3, 1e-3],
        [1e-3, 0.5e-3, 0]
      ]
    };
    const res = model.characterizeCell(table, {
      cload: 10,
      rLoad: 500,
      slew: 40,
      direction: 'fall',
      maxTimeSeconds: 1e-9
    });
    assert.strictEqual(res.tableSource, 'provided');
    assert.strictEqual(res.direction, 'fall');
    assert.strictEqual(res.integrator, 'RK4');
    assert(Array.isArray(res.waveform));
    assert(res.waveform.length > 0);
    assert.strictEqual(res.cTotalFf, 10.8);
    assert.strictEqual(res.rLoadOhms, 500);
    assert.strictEqual(res.inputSlewPs, 40);
    assert(res.delayPs === null || Number.isFinite(res.delayPs));
  });

  check('CCSTimingModel characterizeCell defaults, rLoad zero, and simulate helpers', () => {
    const model = new CCSTimingModel();
    const res = model.characterizeCell(null, { maxTimeSeconds: 1e-9 });
    assert.strictEqual(res.tableSource, 'built-in-illustrative');
    assert.strictEqual(res.direction, 'rise');
    assert(res.outputSlewPs === null || Number.isFinite(res.outputSlewPs));
    const open = model.characterizeCell(null, { rLoad: 0, maxTimeSeconds: 1e-9 });
    assert.strictEqual(open.rLoadOhms, 0);
    const stage = model.simulateStageDelay({ cLoadFf: 20, rWireOhms: 2000 }, 50);
    assert.strictEqual(stage.cell, 'INV_X4');
    assert.strictEqual(stage.loadCapacitanceFf, 20);
    assert.strictEqual(stage.inputSlewPs, 50);
    assert.strictEqual(stage.modelStandard.includes('Composite Current Source'), true);
    const stageDefault = model.simulateStageDelay({}, 20);
    assert.strictEqual(stageDefault.loadCapacitanceFf, 5);
    const driver = model.simulateDriverOutput(8e-15, 1.1);
    assert.strictEqual(driver.cell, 'INV_X4');
    assert(driver.delaySeconds === null || Number.isFinite(driver.delaySeconds));
    const driverDefault = model.simulateDriverOutput();
    assert.strictEqual(model.vdd, 1.1);
    assert(driverDefault.delayNs === null || Number.isFinite(driverDefault.delayNs));
  });

  check('CCSTimingModel _crossing missing-crossing branch', () => {
    const trajectory = [
      { t: 0, y: [1.0] },
      { t: 1e-9, y: [0.8] },
      { t: 2e-9, y: [0.6] }
    ];
    assert.strictEqual(CCSTimingModel._crossing(trajectory, 0.5), null);
    const crossing = CCSTimingModel._crossing(trajectory, 0.7);
    assert(crossing !== null);
    assert(Math.abs(crossing.v - 0.7) < 1e-9);
  });

  // ------------------------------------------------------------------
  // EDA cluster: EDAEngineAdapter operation matrix (residual operations)
  // ------------------------------------------------------------------
  check('EDAEngineAdapter serialization/DRC box-mode/synthesis error ops', async () => {
    const adapter = new EDAEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `eda27-${operation}`, domain: 'eda', operation, parameters });
    const layout = {
      name: 'TOP',
      cells: [{ name: 'A', rectangles: [{ layer: 1, datatype: 0, width: 10, height: 20, x: 0, y: 0 }], placements: [] }]
    };
    const ser = await adapter.execute(job('serialize_oasis', { layout }));
    const serBytes = new Uint8Array(Object.values(ser.outputData.bytes));
    assert(serBytes.length > 0);
    const de = await adapter.execute(job('deserialize_oasis', { bytes: serBytes }));
    assert.strictEqual(de.outputData.cells.length, 1);
    const comp = await adapter.execute(job('evaluate_oasis_compression', { layout }));
    assert(comp.outputData.oasisSizeBytes > 0);
    const boxDrc = await adapter.execute(
      job('run_drc', {
        mode: 'box',
        shapes: [{ id: 'b1', layer: 'M1', x: 0, y: 0, w: 5, h: 5 }],
        rules: { minWidth: 1, minSpacing: 2, minArea: 1 }
      })
    );
    assert.strictEqual(boxDrc.outputData.success, true);
    const emptyDrc = await adapter.execute(job('run_drc', { shapes: [], rules: {} }));
    assert.strictEqual(emptyDrc.outputData.success, false);
    const synth = await adapter.execute(
      job('synthesize_logic', {
        verilogSource: 'module m;\ninput a, b;\noutput y;\nassign y = a & b;\nendmodule',
        clockPeriod_ps: 1500
      })
    );
    assert.strictEqual(synth.outputData.success, true);
    await assert.rejects(() => adapter.execute(job('synthesize_logic', {})), /Explicit non-empty Verilog source/);
  });

  check('EDAEngineAdapter timing/pex/PnR/SPEF/crosstalk residual ops', async () => {
    const adapter = new EDAEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `eda27b-${operation}`, domain: 'eda', operation, parameters });
    const timing = await adapter.execute(job('static_timing_analysis', { clockPeriodNs: 6 }));
    assert.strictEqual(timing.outputData.status, 'TIMING_MET');
    const pex = await adapter.execute(job('extract_wire_parasitics', { lengthMm: 4 }));
    assert(pex.outputData.resistanceOhms > 0);
    const pnr = await adapter.execute(
      job('place_and_route', {
        coreWidth: 50,
        coreHeight: 50,
        stdCellHeight: 5,
        optimizer: 'greedy',
        circuitData: {
          cells: [
            { id: 'a', width: 10, height: 5 },
            { id: 'b', width: 10, height: 5 }
          ],
          nets: [{ name: 'n', pins: ['a', 'b'] }]
        }
      })
    );
    assert.strictEqual(pnr.outputData.cellsPlacedCount, 2);
    const spef = await adapter.execute(
      job('extract_spef', {
        pexInput: {
          designName: 'top',
          nets: [
            {
              name: 'n1',
              totalCapacitance: 1e-12,
              resistance: 50,
              pins: [{ name: 'n1:1', direction: 'output', isPort: true }],
              segments: [
                {
                  layer: 'M1',
                  lengthUm: 1000,
                  widthUm: 0.5,
                  fromNode: 'n1:1',
                  toNode: 'n1:2',
                  hasVia: false
                }
              ],
              crossCouplings: []
            }
          ],
          techPdk: {
            name: 'test',
            provenance: { source: 'test', license: 't' },
            layers: { M1: { sheetResOhmSq: 0.1, capAreaFfUm2: 0.05, capFringeFfUm: 0.02, viaResOhm: 5 } }
          }
        }
      })
    );
    assert.strictEqual(spef.status, 'COMPLETED');
    const spefText = await adapter.execute(
      job('parse_spef', {
        spefText:
          '*SPEF "1.0"\n*DESIGN "top"\n*DIVIDER /\n*DELIMITER :\n*TOTAL_CAP 1.0\n*NET n1\n*CAP 1 n1:1 0.01\n*RES 1 n1:1 n1:2 10.0\n*END\n'
      })
    );
    assert.strictEqual(spefText.status, 'COMPLETED');
    const xt = await adapter.execute(
      job('evaluate_crosstalk', {
        spec: {
          aggressorVoltageSwingV: 1.0,
          aggressorSlewRateVPerSecond: 1e10,
          couplingCapacitance: 1e-13,
          victimGroundCapacitance: 1e-12,
          victimDriverResistance: 100,
          noiseMarginThresholdV: 0.1
        }
      })
    );
    assert.strictEqual(xt.status, 'COMPLETED');
  });

  check('EDAEngineAdapter transient linear/nonlinear and DC operators', async () => {
    const adapter = new EDAEngineAdapter();
    const job = (operation, parameters) => ({ jobId: `eda27c-${operation}`, domain: 'eda', operation, parameters });
    const lin = await adapter.execute(
      job('simulate_spice_transient', {
        tStop: 0.0002,
        dt: 1e-5,
        components: [
          {
            id: 'V1',
            type: 'V',
            nPlus: 'in',
            nMinus: '0',
            dcValue: 5,
            waveform: { type: 'STEP', v1: 0, v2: 5, delay: 0 }
          },
          { id: 'R1', type: 'R', n1: 'in', n2: 'out', value: 1000 },
          { id: 'C1', type: 'C', n1: 'out', n2: '0', value: 1e-6, v0: 0 }
        ]
      })
    );
    assert.strictEqual(lin.status, 'COMPLETED');
    const nonLin = await adapter.execute(
      job('simulate_spice_transient', {
        tStop: 0.0002,
        dt: 1e-5,
        components: [
          { id: 'V1', type: 'V', nPlus: 'in', nMinus: '0', dcValue: 5 },
          { id: 'R1', type: 'R', n1: 'in', n2: 'out', value: 1000 },
          { id: 'D1', type: 'D', anode: 'out', cathode: '0', is: 1e-14 },
          {
            id: 'M1',
            type: 'M',
            drain: 'out',
            gate: 'in',
            source: '0',
            model: 'NMOS',
            vth: 0.7,
            kp: 1e-3,
            lambda: 0.01
          }
        ]
      })
    );
    assert.strictEqual(nonLin.status, 'COMPLETED');
    await assert.rejects(
      () => adapter.execute(job('simulate_spice_transient', { components: [{ id: 'X1', type: 'X' }] })),
      /Unsupported circuit component type/
    );
    await assert.rejects(
      () =>
        adapter.execute(
          job('simulate_spice_dc', { components: [{ id: 'I1', type: 'I', nFrom: 'a', nTo: 'b', current: 0.001 }] })
        ),
      /Singular MNA matrix/
    );
    const dc = await adapter.execute(
      job('simulate_spice_dc', {
        components: [
          { id: 'V1', type: 'V', nPlus: 'in', nMinus: '0', dcValue: 5 },
          { id: 'R1', type: 'R', n1: 'in', n2: 'out', value: 1000 },
          { id: 'C1', type: 'C', n1: 'out', n2: '0', value: 1e-6 },
          { id: 'L1', type: 'L', n1: 'out', n2: 'out2', value: 1e-6 },
          { id: 'I1', type: 'I', nFrom: 'out2', nTo: '0', current: 0.001 },
          { id: 'D1', type: 'D', anode: 'out2', cathode: '0', is: 1e-14 },
          { id: 'M1', type: 'M', drain: 'out2', gate: 'in', source: '0', model: 'NMOS', vth: 0.7, kp: 1e-3 }
        ]
      })
    );
    assert.strictEqual(dc.status, 'COMPLETED');
  });

  check('EDAEngineAdapter signal cancellation and unknown op', async () => {
    const adapter = new EDAEngineAdapter();
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      () =>
        adapter.execute(
          { jobId: 'eda27-abort', domain: 'eda', operation: 'static_timing_analysis', parameters: {} },
          () => {},
          aborted.signal
        ),
      /cancelled|CANCELLED/
    );
    await assert.rejects(
      () => adapter.execute({ jobId: 'eda27-unknown', domain: 'eda', operation: 'not_a_real_op', parameters: {} }),
      /not supported by adapter/
    );
  });

  // ------------------------------------------------------------------
  // Storage cluster: omni_archive
  // ------------------------------------------------------------------
  check('OmniArchiveV2 save/load round trip with blobs, results, and journal', () => {
    const archive = new OmniArchiveV2({ projectName: 'P1', engineeringDomain: 'eda', author: 'tester' });
    assert.strictEqual(archive.manifest.name, 'P1');
    assert.strictEqual(archive.manifest.engineeringDomain, 'eda');
    const ref = archive.addBlob(Buffer.from('hello world'), { mimeType: 'text/plain', name: 'greeting.txt' });
    assert.strictEqual(typeof ref.hash, 'string');
    archive.addBlob({ structured: true });
    archive.addBlob('plain string');
    assert.strictEqual(archive.listBlobs().length, 3);
    assert.strictEqual(archive.hasBlob(ref.hash), true);
    assert.strictEqual(archive.hasBlob('nope'), false);
    const buf = archive.getBlob(ref.hash);
    assert.strictEqual(buf.toString('utf8'), 'hello world');
    const jsonBlob = archive.getBlob(archive.listBlobs()[1], true);
    assert.strictEqual(jsonBlob.structured, true);
    const textAsJson = archive.getBlob(archive.listBlobs()[2], true);
    assert.strictEqual(textAsJson, 'plain string');
    assert.strictEqual(archive.getBlob('missing'), null);
    const revBefore = archive.manifest.revision;
    archive.bumpRevision();
    assert(archive.manifest.revision > revBefore);
    const saved = archive.saveToBuffer();
    assert(saved.subarray(0, 8).equals(MAGIC_BYTES_V2));
    const loaded = OmniArchiveV2.loadFromBuffer(saved);
    assert.strictEqual(loaded.manifest.name, 'P1');
    assert.strictEqual(loaded.blobs.size, 3);
    assert.strictEqual(loaded.listBlobs().length, 3);
    assert.strictEqual(loaded.getBlob(ref.hash).toString('utf8'), 'hello world');
    assert.strictEqual(loaded.journal.history.length, 0);
  });

  check('OmniArchiveV2 load failures and v1 migration branches', () => {
    assert.throws(() => OmniArchiveV2.loadFromBuffer(Buffer.alloc(4)), /buffer is too small/);
    assert.throws(() => OmniArchiveV2.loadFromBuffer(Buffer.alloc(64)), /magic header/);
    const v1 = new OmniArchive({ projectName: 'OLD' });
    v1.addSection('artifact.bin', Buffer.from([1, 2, 3]));
    const v1Buf = v1.saveToBuffer();
    assert.throws(() => OmniArchiveV2.loadFromBuffer(v1Buf), /magic header/);
    const migrated = OmniArchiveV2.fromV1(v1);
    assert.strictEqual(migrated.manifest.name, 'OLD');
    assert.strictEqual(migrated.blobs.size, 1);
    assert.throws(() => OmniArchiveV2.fromV1({}), /fromV1 requires an OmniArchive instance/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cov27-'));
    const v2Path = path.join(dir, 'proj.omni');
    const v2 = new OmniArchiveV2({ projectName: 'MIG' });
    v2.addBlob('data');
    v2.saveToFile(v2Path);
    const loadedV1 = OmniArchiveV2.loadFromFile(v2Path);
    assert.strictEqual(loadedV1.manifest.name, 'MIG');
    const v1File = path.join(dir, 'legacy.omni');
    fs.writeFileSync(v1File, v1Buf);
    const fromV1File = OmniArchiveV2.loadFromFile(v1File);
    assert.strictEqual(fromV1File.manifest.name, 'OLD');
    assert.throws(() => OmniArchiveV2.loadFromFile(path.join(dir, 'missing.omni')), /Archive file not found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchiveV2 WAL enable/append/flush/commit/disable branches', () => {
    const archive = new OmniArchiveV2({ projectName: 'WAL' });
    assert.throws(() => archive.enableWal(), /WAL path is required/);
    assert.throws(() => archive.appendWalEntry('add_blob', {}), /WAL is not enabled/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-wal27-'));
    const walPath = path.join(dir, WAL_FILE_NAME);
    const stats = archive.enableWal({ path: walPath });
    assert.strictEqual(stats.path, walPath);
    const same = archive.enableWal({ path: walPath });
    assert.strictEqual(same.path, walPath);
    archive.appendWalEntry('journal_execute', {
      actionType: 'edit',
      forwardPatch: { a: 1 },
      reversePatch: { a: 0 },
      author: 't'
    });
    archive.appendWalEntry('bump_revision', { changes: { note: 'rev' } });
    assert(archive.getWalStats().pending > 0);
    archive.flushWal();
    archive.commitTransaction();
    assert.strictEqual(archive.getWalStats().committed >= 2, true);
    const committed = archive.commitTransaction();
    assert.strictEqual(committed.wal, true);
    archive.disableWal();
    assert.strictEqual(archive.getWalStats().path, null);
    const noWalCommit = archive.commitTransaction();
    assert.strictEqual(noWalCommit.wal, false);
    const noWalFlush = archive.flushWal();
    assert.strictEqual(noWalFlush.path, null);
    assert.strictEqual(archive.getWalStats().seq, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchiveV2 WAL replay, recovery journal, and crash recovery', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-replay27-'));
    const archivePath = path.join(dir, 'proj.omni');
    const archive = new OmniArchiveV2({ projectName: 'REPLAY' });
    archive.saveToFile(archivePath);
    const walPath = path.join(dir, WAL_FILE_NAME);
    archive.enableWal({ path: walPath });
    archive.appendWalEntry('journal_execute', {
      actionType: 'fix',
      forwardPatch: { b: 2 },
      reversePatch: { b: 1 },
      author: 'u'
    });
    archive.commitTransaction();
    archive.disableWal();
    const fromDisk = OmniArchiveV2.loadFromFile(archivePath, { walPath });
    assert(fromDisk.getWalStats().recovered === true || fromDisk.getWalStats().applied >= 1);
    const tornWalPath = path.join(dir, 'torn.wal');
    const tornHeader = JSON.stringify(['OMNIWAL', 3, 0, path.resolve(archivePath)]);
    const tornLine = JSON.stringify([1, 'add_blob', JSON.stringify({ hash: 'abc', name: 'n' }), 0]);
    fs.writeFileSync(tornWalPath, tornHeader + '\n' + tornLine + '\n', 'utf8');
    const tornArchive = new OmniArchiveV2({ projectName: 'TORN' });
    tornArchive.saveToFile(archivePath);
    const tornStats = OmniArchiveV2.replayWal(archivePath, tornArchive, { walPath: tornWalPath });
    assert.strictEqual(tornStats.applicable, true);
    assert.strictEqual(typeof tornStats.discarded, 'number');
    const noWal = OmniArchiveV2.replayWal(archivePath, tornArchive, { walPath: path.join(dir, 'absent.wal') });
    assert.strictEqual(noWal.applicable, false);
    const recoveryPath = archivePath + '.recovery.journal';
    const entry = {
      id: 'r1',
      actionType: 'edit',
      forwardPatch: { a: 1 },
      reversePatch: { a: 0 },
      description: 'd',
      author: 'u'
    };
    OmniArchiveV2.recordAcknowledgedCommandSync(archivePath, entry);
    const recovered = OmniArchiveV2.recoverFromCrash(archivePath);
    assert.strictEqual(recovered.recoveredCount, 1);
    assert.strictEqual(recovered.commands[0].id, 'r1');
    const none = OmniArchiveV2.recoverFromCrash(path.join(dir, 'never-saved.omni'));
    assert.strictEqual(none.recoveredCount, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('CommandJournal execute, undo/redo, truncation, and import branches', () => {
    const journal = new CommandJournal();
    assert.strictEqual(journal.canUndo(), false);
    assert.strictEqual(journal.canRedo(), false);
    assert.strictEqual(journal.undo(), null);
    assert.strictEqual(journal.redo(), null);
    journal.execute('add', { a: 1 }, { a: 0 }, 'add a', 'alice');
    journal.execute('edit', { a: 2 }, { a: 1 }, 'edit a');
    assert.strictEqual(journal.canUndo(), true);
    assert.strictEqual(journal.canRedo(), false);
    const undone = journal.undo();
    assert.strictEqual(undone.appliedPatch.a, 1);
    assert.strictEqual(journal.canRedo(), true);
    const redone = journal.redo();
    assert.strictEqual(redone.appliedPatch.a, 2);
    journal.undo();
    journal.execute('branch', { a: 3 }, { a: 2 });
    assert.strictEqual(journal.history.length, 2);
    assert.strictEqual(journal.canRedo(), false);
    const hist = journal.getHistory();
    assert.strictEqual(hist.length, 2);
    assert.strictEqual(hist[1].isCurrent, true);
    const exported = journal.export();
    assert.strictEqual(exported.currentIndex, 1);
    const fresh = new CommandJournal();
    fresh.import(exported);
    assert.strictEqual(fresh.history.length, 2);
    assert.strictEqual(fresh.currentIndex, 1);
    assert.strictEqual(fresh.branchCounter >= 3, true);
    const minimal = new CommandJournal();
    minimal.import({ history: [{ id: 'x' }] });
    assert.strictEqual(minimal.currentIndex, 0);
    assert.throws(() => fresh.import({}), /Invalid journal import data format/);
    assert.throws(() => fresh.import(null), /Invalid journal import data format/);
  });

  check('OmniVaultAES256 encrypt/decrypt branches', () => {
    const plain = Buffer.from('secret project bytes');
    const enc = OmniVaultAES256.encrypt(plain, 'correct horse battery staple');
    assert(enc.length > plain.length);
    assert(enc.subarray(0, 8).equals(VAULT_MAGIC_BYTES));
    const dec = OmniVaultAES256.decrypt(enc, 'correct horse battery staple');
    assert.deepStrictEqual(dec, plain);
    assert.throws(() => OmniVaultAES256.decrypt(Buffer.alloc(10), 'pw'), /Corrupt encrypted vault/);
    const badMagic = Buffer.alloc(60, 7);
    assert.throws(() => OmniVaultAES256.decrypt(badMagic, 'pw'), /Invalid vault header/);
    const wrong = OmniVaultAES256.encrypt(plain, 'other password');
    assert.throws(() => OmniVaultAES256.decrypt(wrong, 'wrong'), /Decryption Failed/);
  });

  check('OmniArchiveV3 writeChunks/readIndex/readEntryBufferSync branches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-v3-27-'));
    const archivePath = path.join(dir, 'stream.omni');
    const entries = [
      { name: 'manifest.json', stream: Buffer.from(JSON.stringify({ schemaVersion: '2.0.0', name: 'S' })) },
      { name: 'blobs/abc', stream: Buffer.from('payload bytes', 'utf8') },
      { name: 'results.json', stream: Buffer.from('[]') }
    ];
    const ws = fs.createWriteStream(archivePath);
    const res = await OmniArchiveV3.writeChunks(ws, entries, { chunkSize: 64 });
    await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.end(resolve);
    });
    assert.strictEqual(res.entries.length, 3);
    assert(res.fileSize > 0);
    const index = OmniArchiveV3.readIndex(archivePath);
    assert.strictEqual(index.entries.length, 3);
    const manifest = OmniArchiveV3.readEntryBufferSync(archivePath, 'manifest.json');
    assert.strictEqual(JSON.parse(manifest.toString('utf8')).name, 'S');
    const blob = OmniArchiveV3.readEntryBufferSync(archivePath, 'blobs/abc');
    assert.strictEqual(blob.toString('utf8'), 'payload bytes');
    assert.throws(() => OmniArchiveV3.readEntryBufferSync(archivePath, 'missing'), /entry not found/);
    const small = OmniArchiveV3.writeChunks(
      fs.createWriteStream(path.join(dir, 'small.omni')),
      [{ name: 'empty', stream: null }],
      { compression: false }
    );
    const smallRes = await small;
    assert.strictEqual(smallRes.entries[0].chunkCount, 0);
    const noCompress = path.join(dir, 'plain.omni');
    const ws2 = fs.createWriteStream(noCompress);
    const plainRes = await OmniArchiveV3.writeChunks(ws2, [{ name: 'a', stream: Buffer.from('xyz') }], {
      compression: false
    });
    await new Promise((resolve, reject) => {
      ws2.on('error', reject);
      ws2.end(resolve);
    });
    assert.strictEqual(plainRes.entries[0].chunkCount, 1);
    assert.strictEqual(OmniArchiveV3.readEntryBufferSync(noCompress, 'a').toString('utf8'), 'xyz');
    await assert.rejects(
      () => OmniArchiveV3.writeChunks({}, [{ name: 'a', stream: Buffer.from('x') }]),
      /requires a writable stream/
    );
    await assert.rejects(
      () => OmniArchiveV3.writeChunks(undefined, [{ name: 'a', stream: Buffer.from('x') }]),
      /requires a writable stream/
    );
    await assert.rejects(
      () =>
        OmniArchiveV3.writeChunks(fs.createWriteStream(path.join(dir, 'dup.omni')), [
          { name: 'a', stream: Buffer.from('x') },
          { name: 'a', stream: Buffer.from('y') }
        ]),
      /Duplicate streaming archive entry/
    );
    await assert.rejects(
      () =>
        OmniArchiveV3.writeChunks(fs.createWriteStream(path.join(dir, 'empty.omni')), [
          { name: '', stream: Buffer.from('x') }
        ]),
      /entry name must not be empty/
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('OmniArchiveV3 loadArchiveSync and stream error branches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-v3b-27-'));
    const archivePath = path.join(dir, 'full.omni');
    const v2 = new OmniArchiveV2({ projectName: 'STREAM' });
    v2.addBlob('data1');
    await v2.saveToFileStreaming(archivePath);
    const loaded = OmniArchiveV3.loadArchiveSync(archivePath);
    assert.strictEqual(loaded.manifest.name, 'STREAM');
    assert.strictEqual(loaded.blobs.size, 1);
    assert.strictEqual(loaded.getBlob(loaded.listBlobs()[0]).toString('utf8'), 'data1');
    const stream = OmniArchiveV3.readEntryStream(archivePath, 'manifest.json');
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    assert(Buffer.concat(chunks).length > 0);
    const missingStream = OmniArchiveV3.readEntryStream(archivePath, 'absent');
    await assert.rejects(() => {
      return new Promise((resolve, reject) => {
        missingStream.on('error', reject);
        missingStream.on('end', resolve);
        missingStream.resume();
      });
    }, /entry not found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('saveAtomicSync backup flag and CRC32 helper branches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-atomic-27-'));
    const target = path.join(dir, 'file.bin');
    const buf = Buffer.from('content');
    saveAtomicSync(target, buf);
    assert.strictEqual(fs.readFileSync(target).toString('utf8'), 'content');
    fs.writeFileSync(target, Buffer.from('replacement'));
    saveAtomicSync(target, buf, true);
    assert.strictEqual(fs.readFileSync(target).toString('utf8'), 'content');
    assert.strictEqual(typeof calculateCRC32(Buffer.from('hello')), 'number');
    assert.strictEqual(typeof calculateCRC32(Buffer.alloc(0)), 'number');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Storage cluster: ProjectManager
  // ------------------------------------------------------------------
  check('ProjectManager lifecycle, commands, and persistence branches', () => {
    const pm = new ProjectManager({ projectName: 'Cov27', engineeringDomain: 'eda', author: 't' });
    assert.strictEqual(pm.hasActiveProject(), true);
    const summary = pm.getSummary();
    assert.strictEqual(summary.projectName, 'Cov27');
    assert.strictEqual(summary.engineeringDomain, 'eda');
    assert.strictEqual(summary.author, 't');
    assert.strictEqual(summary.revision >= 1, true);
    assert.strictEqual(summary.canUndo, false);
    const entry = pm.recordCommand('edit', { a: 1 }, { a: 0 }, 'edit');
    assert.strictEqual(entry.actionType, 'edit');
    assert.strictEqual(pm.isDirty, true);
    assert.strictEqual(pm.getSummary().canUndo, true);
    const undone = pm.undo();
    assert.strictEqual(undone.appliedPatch.a, 0);
    const redone = pm.redo();
    assert.strictEqual(redone.appliedPatch.a, 1);
    assert.strictEqual(pm.getHistory().length, 1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-mgr-27-'));
    const target = path.join(dir, 'proj.omni');
    const saved = pm.saveProject(target);
    assert.strictEqual(saved.success, true);
    assert.strictEqual(saved.filePath, path.resolve(target));
    assert.strictEqual(pm.isDirty, false);
    assert.strictEqual(pm.currentFilePath, path.resolve(target));
    const reopened = pm.openProject(target);
    assert.strictEqual(reopened.projectName, 'Cov27');
    const buf = fs.readFileSync(target);
    const fromBuffer = pm.openProject(buf);
    assert.strictEqual(fromBuffer.projectName, 'Cov27');
    assert.throws(() => pm.openProject(path.join(dir, 'missing.omni')), /does not exist/);
    assert.throws(() => pm.openProject(12345), /Expected file path string or binary Buffer/);
    assert.throws(() => pm.saveProject(null), /Target file path must be specified/);
    const ref = pm.addBlob('content', 'text/plain');
    assert.strictEqual(typeof ref.hash, 'string');
    pm.addBlob(Buffer.from('bytes'), { mimeType: 'application/octet-stream', name: 'blob' });
    assert.strictEqual(pm.getBlob(ref.hash).toString('utf8'), 'content');
    assert.strictEqual(pm.getBlob('missing'), null);
    pm.archive = null;
    assert.throws(() => pm.getSummary(), /No project currently active/);
    assert.throws(() => pm.recordCommand('x', {}, {}), /No project currently active/);
    assert.throws(() => pm.undo(), /No project currently active/);
    assert.throws(() => pm.redo(), /No project currently active/);
    assert.throws(() => pm.addBlob('x'), /No project currently active/);
    assert.throws(() => pm.getBlob('x'), /No project currently active/);
    assert.throws(() => pm.saveProject('/tmp/x.omni'), /No project currently active/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('ProjectManager exportLargeArchive streaming branch', async () => {
    const pm = new ProjectManager({ projectName: 'Cov27-export' });
    pm.addBlob('big payload');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-mgr-export-27-'));
    const target = path.join(dir, 'big.omni');
    const res = await pm.exportLargeArchive(target);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.streamed, true);
    assert.strictEqual(res.blobCount, 1);
    assert.strictEqual(pm.currentFilePath, path.resolve(target));
    assert.strictEqual(pm.isDirty, false);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(typeof activeProjectManager.hasActiveProject(), 'boolean');
  });

  // ------------------------------------------------------------------
  // Compliance cluster: ToolQualificationKit
  // ------------------------------------------------------------------
  check('ToolQualificationKit statics and constructors', () => {
    const do330 = ToolQualificationKit.evaluateDO330TQL();
    assert.strictEqual(do330.supported, false);
    assert.strictEqual(do330.certificationClaimed, false);
    const iso = ToolQualificationKit.evaluateISO26262TCL();
    assert.strictEqual(iso.supported, false);
    const kit = new ToolQualificationKit({ toolName: 'T', toolVersion: '1.0', targetSafetyStandard: 'DO-330' });
    assert.strictEqual(kit.toolName, 'T');
    assert.strictEqual(kit.toolVersion, '1.0');
    assert.strictEqual(kit.targetSafetyStandard, 'DO-330');
    assert.throws(() => kit.registerTestCase({}), /execute function is required/);
    assert.strictEqual(typeof ToolQualificationKit.computeSha256('abc'), 'string');
    assert.strictEqual(ToolQualificationKit.computeSha256('abc').length, 64);
    const defaults = ToolQualificationKit.DEFAULT_GOLD_FUNCTIONS();
    assert(defaults.length >= 5);
    assert.throws(() => kit.generateCycloneDX_SBOM(), /Runtime SBOM generation is unavailable/);
    assert.throws(() => kit.generateSPDX_SBOM(), /Runtime SBOM generation is unavailable/);
  });

  check('ToolQualificationKit executeQualificationSuite and report branches', () => {
    const kit = new ToolQualificationKit({ toolName: 'T', toolVersion: '1.0' });
    kit.registerTestCase({
      id: 'pass',
      description: 'passes',
      execute: () => ({ passes: true, actual: 1, expected: 1 })
    });
    kit.registerTestCase({
      id: 'fail',
      description: 'fails',
      execute: () => ({ passes: false, actual: 2, expected: 1 })
    });
    kit.registerTestCase({
      id: 'throw',
      description: 'throws',
      execute: () => {
        throw new Error('boom');
      }
    });
    kit.registerTestCase({ execute: () => ({ passes: true }) });
    const summary = kit.executeQualificationSuite();
    assert.strictEqual(summary.totalTests, 4);
    assert.strictEqual(summary.passedCount, 2);
    assert.strictEqual(summary.failedCount, 2);
    assert.strictEqual(summary.passRatePercent, 50);
    assert.strictEqual(summary.dataStatus, 'experimental');
    assert.strictEqual(summary.status, 'diagnostic-only');
    assert.strictEqual(summary.sha256Digest.length, 64);
    const report = kit.generateExperimentalDiagnosticReport();
    assert(report.includes('# Experimental Test Diagnostic Summary'));
    assert(report.includes('| pass |'));
    const report2 = kit.generateComplianceReport();
    assert(report2.includes('diagnostic only'));
    const emptyKit = new ToolQualificationKit();
    const emptySummary = emptyKit.executeQualificationSuite();
    assert.strictEqual(emptySummary.passRatePercent, 0);
  });

  check('ToolQualificationKit collectGoldFunctionEvidence branches', () => {
    const gold = [
      {
        id: 'g1',
        module: 'test/test_liberty_parser.js',
        runner: 'runLibertyParserTests',
        description: 'd',
        snapshot: (r) => ({ total: r.total })
      },
      { id: 'g2', module: 'test/test_liberty_parser.js', runner: 'MISSING_RUNNER', description: 'd2' },
      {
        id: 'g3',
        module: 'test/test_liberty_parser.js',
        runner: 'runLibertyParserTests',
        description: 'd3',
        snapshot: () => {
          throw new Error('snap');
        }
      },
      { id: 'g4', module: 'test/no_such_module.js', runner: 'run', description: 'd4' },
      { id: 'g5', module: 'test/test_liberty_parser.js', runner: 'runLibertyParserTests', description: 'd5' }
    ];
    const collected = ToolQualificationKit.collectGoldFunctionEvidence(gold);
    assert.strictEqual(collected.evidences.length, 5);
    const g1 = collected.evidences[0];
    assert.strictEqual(g1.status, 'passed');
    assert.strictEqual(g1.passedChecks > 0, true);
    const g2 = collected.evidences[1];
    assert.strictEqual(g2.status, 'error');
    assert.strictEqual(g2.failedChecks, 1);
    const g3 = collected.evidences[2];
    assert.strictEqual(g3.summary, null);
    const g4 = collected.evidences[3];
    assert.strictEqual(g4.status, 'error');
    const g5 = collected.evidences[4];
    assert.strictEqual(g5.status, 'passed');
    const boolRunner = [
      {
        id: 'b',
        module: 'test/test_liberty_parser.js',
        runner: 'runLibertyParserTests',
        description: 'd',
        snapshot: () => ({ passed: true })
      }
    ];
    const boolCollected = ToolQualificationKit.collectGoldFunctionEvidence(boolRunner);
    assert.strictEqual(boolCollected.evidences[0].passedChecks, 24);
    const shapeRunner = [
      { id: 's', module: 'test/test_liberty_parser.js', runner: 'runLibertyParserTests', description: 'd' }
    ];
    const shapeCollected = ToolQualificationKit.collectGoldFunctionEvidence(shapeRunner);
    assert.strictEqual(shapeCollected.evidences[0].status, 'passed');
  });

  check('ToolQualificationKit evaluateEvidence verdict branches', () => {
    const kit = new ToolQualificationKit();
    const ev = kit.evaluateEvidence({});
    assert.strictEqual(ev.verdict, 'evidence-insufficient');
    assert.strictEqual(ev.incomplete, true);
    assert.strictEqual(ev.usedFor, 'unspecified');
    assert.strictEqual(ev.certificationClaimed, false);
    const good = kit.evaluateEvidence({
      level: 'do330:TQL-5',
      usedFor: 'verification',
      toolVersion: '1.0',
      testResults: { passed: 100, failed: 0 },
      coverage: { functions: { total: 100, covered: 95 }, branches: { total: 100, covered: 92 }, mcDc: 91 },
      defectTracking: { open: 0, closed: 10, openCritical: 0 },
      configMgmt: { baselines: 2, changes: 5, changesReviewed: 4 }
    });
    assert.strictEqual(good.verdict, 'evidence-satisfies-do330:TQL-5');
    assert.strictEqual(good.incomplete, false);
    assert.strictEqual(good.metrics.passRatePercent, 100);
    assert.strictEqual(good.metrics.coverage.overall, 91);
    assert.strictEqual(good.criteria.length, 5);
    const missingCoverage = kit.evaluateEvidence({
      level: 'do330:TQL-5',
      usedFor: 'verification',
      testResults: { passed: 1, failed: 0 }
    });
    assert.strictEqual(missingCoverage.incomplete, true);
    assert(missingCoverage.reasoning.some((r) => r.includes('coverage')));
    const badUsedFor = kit.evaluateEvidence({
      usedFor: 'not-a-real-use',
      testResults: { passed: 1, failed: 0 },
      coverage: { functions: 100, branches: 100, mcDc: 100 },
      defectTracking: { open: 0, closed: 0, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 1 }
    });
    assert.strictEqual(badUsedFor.incomplete, true);
    assert(badUsedFor.reasoning.some((r) => r.includes('invalid usedFor')));
    const isoLevel = kit.evaluateEvidence({
      testResults: { passed: 1, failed: 0 },
      coverage: { functions: 100, branches: 100, mcDc: 100 },
      defectTracking: { open: 0, closed: 0, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 1, changesReviewed: 1 }
    });
    assert.strictEqual(isoLevel.level, 'do330:TQL-5');
    const isoKit = new ToolQualificationKit({ targetSafetyStandard: 'ISO 26262' });
    const isoEv = isoKit.evaluateEvidence({
      testResults: { passed: 1, failed: 0 },
      coverage: { functions: 100, branches: 100, mcDc: 100 },
      defectTracking: { open: 0, closed: 0, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 1, changesReviewed: 1 }
    });
    assert.strictEqual(isoEv.level, 'iso26262:TCL1-ASIL-D');
    const tql1 = kit.evaluateEvidence({
      level: 'do330:TQL-1',
      usedFor: 'codegen',
      testResults: { passed: 50, failed: 0 },
      coverage: { functions: { total: 10, covered: 10 }, branches: { total: 10, covered: 10 }, mcDc: 100 },
      defectTracking: { open: 0, closed: 5, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 3, changesReviewed: 3 }
    });
    assert.strictEqual(tql1.verdict, 'evidence-satisfies-do330:TQL-1');
    const tql1Missing = kit.evaluateEvidence({
      level: 'do330:TQL-1',
      usedFor: 'codegen',
      testResults: { passed: 50, failed: 0 },
      coverage: { functions: 100, branches: 100, mcDc: 100 },
      defectTracking: { open: 0, closed: 5, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 3 }
    });
    assert.strictEqual(tql1Missing.incomplete, true);
    assert(tql1Missing.reasoning.some((r) => r.includes('changesReviewed')));
    const failCriteria = kit.evaluateEvidence({
      level: 'do330:TQL-5',
      usedFor: 'test',
      testResults: { passed: 50, failed: 50 },
      coverage: { functions: 50, branches: 50, mcDc: 50 },
      defectTracking: { open: 5, closed: 0, openCritical: 5 },
      configMgmt: { baselines: 0, changes: 0 }
    });
    assert.strictEqual(failCriteria.verdict, 'evidence-insufficient');
    assert(failCriteria.reasoning.some((r) => r.includes('failed criteria')));
    const thresholdOverride = kit.evaluateEvidence({
      level: 'do330:TQL-5',
      usedFor: 'test',
      thresholds: { minPassRatePercent: 50 },
      testResults: { passed: 50, failed: 50 },
      coverage: { functions: 95, branches: 95, mcDc: 95 },
      defectTracking: { open: 0, closed: 5, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 1 }
    });
    assert.strictEqual(thresholdOverride.verdict, 'evidence-satisfies-do330:TQL-5');
    const arrayEvidence = kit.evaluateEvidence([]);
    assert.strictEqual(arrayEvidence.incomplete, true);
  });

  // ------------------------------------------------------------------
  // Compliance cluster: ASME Section VIII Div 2
  // ------------------------------------------------------------------
  check('linearizeStressThroughThickness validation and computation branches', () => {
    assert.throws(() => linearizeStressThroughThickness(null), /stressField must be an array/);
    assert.throws(() => linearizeStressThroughThickness([], { direction: '' }), /non-empty string/);
    assert.throws(() => linearizeStressThroughThickness([{ s: 0 }]), /At least two stress samples/);
    assert.throws(() => linearizeStressThroughThickness('x'), /stressField must be an array/);
    const sample = (s) => ({ s, σxx: 10 + s, σyy: 5, σzz: 0, τxy: 1, τyz: 0.5, τzx: 0.25 });
    assert.throws(() => linearizeStressThroughThickness([null, sample(1)]), /must be an object/);
    assert.throws(
      () => linearizeStressThroughThickness([{ s: NaN, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 }, sample(1)]),
      /coordinate s/
    );
    assert.throws(
      () =>
        linearizeStressThroughThickness([
          { s: 0, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 },
          { s: 0, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 }
        ]),
      /strictly increasing/
    );
    assert.throws(
      () => linearizeStressThroughThickness([{ s: 0, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: NaN }, sample(1)]),
      /component τzx/
    );
    const field = [sample(0), sample(0.5), sample(1)];
    const result = linearizeStressThroughThickness(field, { direction: 'through-thickness', sectionLines: ['SCL-1'] });
    assert.strictEqual(result.dataStatus, 'computed');
    assert.strictEqual(result.direction, 'through-thickness');
    assert.deepStrictEqual(result.sectionLines, ['SCL-1']);
    assert.strictEqual(result.thicknessMm, 1);
    assert.strictEqual(result.sampleCount, 3);
    assert.strictEqual(result.components.σxx.membrane, 10.5);
    assert(Math.abs(result.components.σxx.bending - 0.5) < 1e-9);
    assert.strictEqual(result.components.σyy.membrane, 5);
    assert.strictEqual(typeof result.envelope.P_m, 'number');
    assert.strictEqual(typeof result.envelope.F_local, 'number');
    const defaultOptions = linearizeStressThroughThickness([sample(0), sample(1)]);
    assert.strictEqual(defaultOptions.direction, 'through-thickness');
    assert.strictEqual(defaultOptions.sectionLines, null);
  });

  check('evaluatePart5Allowables branches', () => {
    assert.throws(() => evaluatePart5Allowables('a', 1, 1, { S: 100 }), /membrane must be a finite number/);
    assert.throws(() => evaluatePart5Allowables(1, NaN, 1, { S: 100 }), /bending must be a finite number/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 'x', { S: 100 }), /local must be a finite number/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 1, {}), /S must be a finite number/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 1, { S: 0 }), /S must be positive/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 1, { S: 100, Sy: -1 }), /Sy must be positive/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 1, { S: 100, secondaryQ: -1 }), /Q must be non-negative/);
    const pass = evaluatePart5Allowables(20, 20, 5, { S: 100, Sy: 200 });
    assert.strictEqual(pass.overallAcceptable, true);
    assert.strictEqual(pass.checks.primaryMembrane.acceptable, true);
    assert.strictEqual(pass.checks.primaryMembranePlusBending.acceptable, true);
    assert.strictEqual(pass.checks.primaryPlusSecondary.acceptable, true);
    assert.strictEqual(pass.checks.yieldSanity.acceptable, true);
    assert.strictEqual(pass.checks.peakLocal.assessed, false);
    assert.strictEqual(pass.utilization.PmOverS, 0.2);
    const fail = evaluatePart5Allowables(200, 50, 10, { S: 100 });
    assert.strictEqual(fail.overallAcceptable, false);
    assert.strictEqual(fail.checks.primaryMembrane.acceptable, false);
    assert.strictEqual(fail.checks.yieldSanity.assessed, false);
    const withQ = evaluatePart5Allowables(10, 10, 5, { S: 100, secondaryQ: 50 });
    assert.strictEqual(withQ.checks.primaryPlusSecondary.acceptable, true);
    const failQ = evaluatePart5Allowables(100, 100, 5, { S: 100, secondaryQ: 200 });
    assert.strictEqual(failQ.checks.primaryPlusSecondary.acceptable, false);
    assert.strictEqual(failQ.checks.primaryMembrane.acceptable, true);
  });

  check('ASMESectionVIIIDiv2Analyzer constructor and linearization branches', () => {
    assert.throws(() => new ASMESectionVIIIDiv2Analyzer({}), /positive caller-supplied screening limit/);
    assert.throws(() => new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 100 }), /source label/);
    assert.throws(
      () => new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 100, allowableStressSource: '   ' }),
      /source label/
    );
    const analyzer = new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 100, allowableStressSource: 'caller 2019' });
    assert.strictEqual(analyzer.S, 100);
    assert.strictEqual(analyzer.allowableStressSource, 'caller 2019');
    assert.throws(() => analyzer.linearizeStressClassificationLine([], 10, false), /between 2 and 10,000 samples/);
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -5, stressMpa: 1 },
            { x: 5, stressMpa: 2 }
          ],
          0,
          false
        ),
      /Wall thickness must be finite and positive/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -5, stressMpa: 1 },
            { x: 5, stressMpa: 2 }
          ],
          10,
          'yes'
        ),
      /Explicitly declare/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -5, stressMpa: 1 },
            { x: 5, stressMpa: 2 }
          ],
          10,
          true
        ),
      /Secondary thermal stress screening is unavailable/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -5, stressMpa: NaN },
            { x: 5, stressMpa: 2 }
          ],
          10,
          false
        ),
      /finite x and stressMpa/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -10, stressMpa: 1 },
            { x: 5, stressMpa: 2 }
          ],
          10,
          false
        ),
      /lies outside the supplied wall thickness/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: 0, stressMpa: 1 },
            { x: 0, stressMpa: 2 }
          ],
          10,
          false
        ),
      /strictly increasing/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: 0, stressMpa: 1 },
            { x: 5, stressMpa: 2 }
          ],
          10,
          false
        ),
      /must include both supplied wall surfaces/
    );
    const line = [
      { x: -5, stressMpa: 100 },
      { x: 0, stressMpa: 200 },
      { x: 5, stressMpa: 300 }
    ];
    const res = analyzer.linearizeStressClassificationLine(line, 10, false);
    assert.strictEqual(res.dataStatus, 'caller-supplied-unverified');
    assert.strictEqual(res.status, 'screening-only');
    assert.strictEqual(res.wallThicknessMm, 10);
    assert.strictEqual(res.screening.withinAllSuppliedLimits, false);
    assert.strictEqual(res.screening.withinSuppliedPmLimit, false);
    assert.strictEqual(typeof res.membraneStressPm, 'number');
    assert.strictEqual(typeof res.peakStressF, 'number');
    const alias = analyzer.evaluateStressClassificationLine(line, 10, false);
    assert.strictEqual(typeof alias.screening.withinSuppliedPmLimit, 'boolean');
    const zeroLine = [
      { x: -5, stressMpa: 0 },
      { x: 5, stressMpa: 0 }
    ];
    const zeroRes = analyzer.linearizeStressClassificationLine(zeroLine, 10, false);
    assert.strictEqual(zeroRes.suppliedLimitRatios.membrane, null);
    assert.strictEqual(zeroRes.suppliedLimitRatios.combined, null);
    const linSample = (s) => ({ s, σxx: 10 + s, σyy: 5, σzz: 0, τxy: 1, τyz: 0.5, τzx: 0.25 });
    const staticLin = ASMESectionVIIIDiv2Analyzer.linearizeStressThroughThickness([linSample(0), linSample(1)]);
    assert.strictEqual(staticLin.thicknessMm, 1);
    const staticAllow = ASMESectionVIIIDiv2Analyzer.evaluatePart5Allowables(10, 10, 1, { S: 100 });
    assert.strictEqual(staticAllow.overallAcceptable, true);
  });

  check('ASMESectionVIIIDiv2Analyzer certificate methods', () => {
    const analyzer = new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 100, allowableStressSource: 'src' });
    const cert = analyzer.generateComplianceCertificate('VESSEL-9');
    assert(cert.includes('VESSEL-9'));
    assert(cert.includes('not an ASME BPVC report'));
    const certDefault = analyzer.generateComplianceCertificate();
    assert(certDefault.includes('unspecified'));
    const certObj = analyzer.generateComplianceCertificate({ vesselTag: 'T-1' });
    assert(certObj.includes('T-1'));
    const formal = analyzer.generateFormalCertificationDocument({ vesselTag: 'T-2' });
    assert(formal.includes('T-2'));
    const formalDefault = analyzer.generateFormalCertificationDocument();
    assert(formalDefault.includes('unspecified'));
  });

  // ------------------------------------------------------------------
  // Maturity cluster: feature_maturity
  // ------------------------------------------------------------------
  check('feature_maturity registry access branches', () => {
    assert.strictEqual(getFeatureMaturity('eda').state, MATURITY_STATES.EXPERIMENTAL);
    assert.strictEqual(getFeatureMaturity('EDA').state, MATURITY_STATES.EXPERIMENTAL);
    assert.strictEqual(getFeatureMaturity(' eda ').state, MATURITY_STATES.EXPERIMENTAL);
    const unknown = getFeatureMaturity('no_such_domain');
    assert.strictEqual(unknown.state, MATURITY_STATES.EXPERIMENTAL);
    assert.strictEqual(unknown.releaseApproved, false);
    assert.strictEqual(getFeatureMaturity(42).state, MATURITY_STATES.EXPERIMENTAL);
    const listed = listFeatureMaturity();
    assert.strictEqual(typeof listed.eda, 'object');
    assert.notStrictEqual(listed.eda, DOMAIN_MATURITY.eda);
    assert.strictEqual(getDomainMaturity('eda').status, 'experimental');
    assert.strictEqual(getDomainMaturity(42), null);
    assert.strictEqual(getDomainMaturity('missing'), null);
    const all = getAllDomainMaturity();
    assert(all.length > 10);
    assert.strictEqual(typeof all[0].domain, 'string');
    const gate = getReleaseGatedDomains();
    assert(gate.length === all.length);
    assert.strictEqual(isReleaseApproved('eda'), false);
    assert.strictEqual(isReleaseApproved('missing'), false);
    assert.strictEqual(listCorrelatedDomains().length, 0);
    const customRegistry = { a: { status: 'correlated' }, b: { status: 'experimental' } };
    assert.deepStrictEqual(listCorrelatedDomains(customRegistry), ['a']);
    const summary = getMaturitySummary();
    assert.strictEqual(summary.totalDomains, all.length);
    assert.strictEqual(typeof summary.byStatus.experimental, 'number');
    assert.strictEqual(summary.releaseApprovedCount, 0);
  });

  // ------------------------------------------------------------------
  // Reporting cluster: audit_report
  // ------------------------------------------------------------------
  check('AuditReportGenerator comprehensive report validation branches', () => {
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(null).success, false);
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport('x').success, false);
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport([]).success, false);
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport({ projectId: 'p' }).success, false);
    const circular = { projectId: 'p' };
    circular.self = circular;
    const circResult = AuditReportGenerator.generateComprehensiveReport(circular);
    assert.strictEqual(circResult.success, false);
    const tooBig = {
      projectId: 'p',
      projectName: 'n',
      projectRevision: '1',
      engineVersion: '1',
      dependencyVersions: { a: '1' },
      inputs: [],
      results: [],
      assumptions: [],
      warnings: [],
      junk: 'x'.repeat(2 * 1024 * 1024)
    };
    const bigResult = AuditReportGenerator.generateComprehensiveReport(tooBig);
    assert.strictEqual(bigResult.success, false);
    assert.strictEqual(bigResult.error.code, 'RESOURCE_EXHAUSTED');
    const base = {
      projectId: 'p1',
      projectName: 'Proj',
      projectRevision: '3',
      engineVersion: '2.0.0',
      dependencyVersions: { lib: '1.0' },
      assumptions: [],
      warnings: []
    };
    const noDeps = AuditReportGenerator.generateComprehensiveReport({ ...base, dependencyVersions: {} });
    assert.strictEqual(noDeps.success, false);
    const noInputs = AuditReportGenerator.generateComprehensiveReport({
      ...base,
      inputs: [],
      results: [
        {
          domain: 'eda',
          name: 'n',
          units: 'u',
          projectRevision: '3',
          engineVersion: '2.0.0',
          backendVersion: '1',
          dependencyVersions: { a: '1' },
          convergenceDiagnostics: { status: 'converged', residuals: [] },
          warnings: [],
          inputHashes: []
        }
      ]
    });
    assert.strictEqual(noInputs.success, false);
    const badInput = AuditReportGenerator.generateComprehensiveReport({
      ...base,
      inputs: [{ hash: '', units: 'u' }],
      results: []
    });
    assert.strictEqual(badInput.success, false);
    const badAssumptions = AuditReportGenerator.generateComprehensiveReport({
      ...base,
      inputs: [{ hash: 'h1', units: 'u' }],
      results: [],
      assumptions: [null],
      warnings: []
    });
    assert.strictEqual(badAssumptions.success, false);
    const badWarnings = AuditReportGenerator.generateComprehensiveReport({
      ...base,
      inputs: [{ hash: 'h1', units: 'u' }],
      results: [],
      assumptions: [],
      warnings: ['ok', '']
    });
    assert.strictEqual(badWarnings.success, false);
  });

  check('AuditReportGenerator successful report and result validation branches', () => {
    const valid = {
      projectId: 'p1',
      projectName: 'Proj',
      projectRevision: '3',
      engineVersion: '2.0.0',
      dependencyVersions: { lib: '1.0' },
      assumptions: ['assumption'],
      warnings: ['warning'],
      inputs: [{ hash: 'h1', units: 'u' }],
      results: [
        {
          domain: 'eda',
          name: 'timing',
          units: 'ns',
          projectRevision: '3',
          engineVersion: '2.0.0',
          backendVersion: '2.0.0',
          dependencyVersions: { lib: '1.0' },
          convergenceDiagnostics: { status: 'converged', residuals: [{ metric: 'rms', value: 0.01, units: 'v' }] },
          warnings: [],
          inputHashes: ['h1']
        }
      ]
    };
    const res = AuditReportGenerator.generateComprehensiveReport(valid);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.report.projectId, 'p1');
    assert.strictEqual(res.report.validationLevel, 'experimental');
    assert.strictEqual(res.report.domainMaturities[0].maturity, 'experimental');
    assert.strictEqual(res.report.results[0].validationLevel, 'experimental');
    assert(res.htmlReport.includes('<!doctype html>'));
    assert(res.htmlReport.includes('p1'));
    const badResult = { ...valid, results: [{ ...valid.results[0], projectRevision: '2' }] };
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(badResult).success, false);
    const badHashRef = { ...valid, results: [{ ...valid.results[0], inputHashes: ['nope'] }] };
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(badHashRef).success, false);
    const badConvergence = {
      ...valid,
      results: [{ ...valid.results[0], convergenceDiagnostics: { status: 'converged', residuals: [] } }]
    };
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(badConvergence).success, false);
    const badResidual = {
      ...valid,
      results: [
        {
          ...valid.results[0],
          convergenceDiagnostics: { status: 'not-converged', residuals: [{ metric: 'rms', value: 'x', units: 'v' }] }
        }
      ]
    };
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(badResidual).success, false);
    const reasonResidual = {
      ...valid,
      results: [
        {
          ...valid.results[0],
          convergenceDiagnostics: {
            status: 'unavailable',
            residuals: [{ metric: 'rms', value: 1, units: 'v' }],
            reason: 'why'
          }
        }
      ]
    };
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(reasonResidual).success, true);
    const noReason = {
      ...valid,
      results: [
        {
          ...valid.results[0],
          convergenceDiagnostics: { status: 'unavailable', residuals: [{ metric: 'rms', value: 1, units: 'v' }] }
        }
      ]
    };
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(noReason).success, false);
    const badWarningsResult = { ...valid, results: [{ ...valid.results[0], warnings: ['ok', ''] }] };
    assert.strictEqual(AuditReportGenerator.generateComprehensiveReport(badWarningsResult).success, false);
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 120000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentySevenCoverageTests };

if (require.main === module) {
  runBranchGapTwentySevenCoverageTests().then((stats) => {
    console.log(`gap27: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
