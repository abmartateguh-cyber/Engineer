'use strict';

const crypto = require('crypto');
const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { Quantity } = require('../contracts/Quantity');
const { ValidationRecord, ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { EngineeringBOMManager } = require('./engineering_bom_manager');
const { GitCADVisualDiffEngine } = require('./git_cad_visual_diff');

const VALID_LIFECYCLE_STATES = new Set(['DRAFT', 'IN_REVIEW', 'RELEASED', 'OBSOLETE']);

function findWhereUsed(node, targetPartNumber, path = [], results = []) {
  if (!node) return results;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child.partNumber === targetPartNumber) {
        results.push({
          parentPartNumber: node.partNumber,
          parentName: node.name,
          usageQuantity: child.quantity,
          level: child.level,
          path: [...path, node.partNumber]
        });
      }
      findWhereUsed(child, targetPartNumber, [...path, node.partNumber], results);
    }
  }
  return results;
}

function checkLifecycleCompliance(node, targetState, errors = [], warnings = []) {
  if (!node) return;
  const state = (node.lifecycleState || node.state || 'DRAFT').toUpperCase();
  if (targetState === 'RELEASED') {
    if (state === 'DRAFT') {
      errors.push(`Part '${node.partNumber}' (${node.name}) is in DRAFT state and cannot be in a RELEASED assembly.`);
    } else if (state === 'OBSOLETE') {
      warnings.push(`Part '${node.partNumber}' (${node.name}) is OBSOLETE.`);
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      checkLifecycleCompliance(child, targetState, errors, warnings);
    }
  }
}

/**
 * PDMEngineAdapter: Standard EngineAdapter for Product Data Management, BOM Hierarchy Roll-Up & CAD Visual Diff
 */
class PDMEngineAdapter extends EngineAdapter {
  constructor() {
    super('pdm', 'pdm-bom-diff-engine-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'pdm',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'compute_bom_rollup',
        'generate_indented_bom',
        'generate_flattened_bom',
        'export_bom_csv',
        'where_used',
        'validate_lifecycle',
        'visual_diff_cad'
      ],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async validate(jobRequest) {
    await super.validate(jobRequest);
    const params = jobRequest.parameters;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'PDM operations require an explicit parameter object');
    }

    switch (jobRequest.operation) {
      case 'compute_bom_rollup':
      case 'generate_indented_bom':
      case 'generate_flattened_bom':
      case 'export_bom_csv':
        if (!params.rootAssembly && !params.rootItem && !params.bom) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, `${jobRequest.operation} requires rootAssembly or bom`);
        }
        break;
      case 'where_used':
        if (!params.rootAssembly && !params.rootItem && !params.bom) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'where_used requires rootAssembly or bom');
        }
        if (typeof params.partNumber !== 'string' || !params.partNumber.trim()) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'where_used requires a valid target partNumber string');
        }
        break;
      case 'validate_lifecycle':
        if (!params.rootAssembly && !params.rootItem && !params.bom && !params.item) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'validate_lifecycle requires an assembly or item to validate'
          );
        }
        break;
      case 'visual_diff_cad':
        if (!params.revisionA || !params.revisionB) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'visual_diff_cad requires revisionA and revisionB objects');
        }
        break;
      default:
        break;
    }
    return true;
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting PDM operation "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'compute_bom_rollup': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Parsing and normalizing hierarchical eBOM tree'
            })
          );
          const manager = new EngineeringBOMManager();
          manager.setRootAssembly(params.rootAssembly || params.rootItem || params.bom);
          const rollup = manager.computeRollUp();
          outputData = {
            rollup,
            rootAssembly: manager.rootAssembly
          };
          break;
        }

        case 'generate_indented_bom': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Generating multi-level indented BOM table'
            })
          );
          const manager = new EngineeringBOMManager();
          manager.setRootAssembly(params.rootAssembly || params.rootItem || params.bom);
          const indented = manager.generateIndentedBOM();
          outputData = {
            indented,
            totalRows: indented.length
          };
          break;
        }

        case 'generate_flattened_bom': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Consolidating unique leaf parts for procurement'
            })
          );
          const manager = new EngineeringBOMManager();
          manager.setRootAssembly(params.rootAssembly || params.rootItem || params.bom);
          const flattened = manager.generateFlattenedBOM();
          outputData = {
            flattened,
            uniquePartCount: flattened.length
          };
          break;
        }

        case 'export_bom_csv': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Serializing BOM to CSV string'
            })
          );
          const manager = new EngineeringBOMManager();
          manager.setRootAssembly(params.rootAssembly || params.rootItem || params.bom);
          const format = params.format === 'flattened' ? 'flattened' : 'indented';
          const csv = manager.exportToCSV(format);
          outputData = {
            format,
            csv
          };
          break;
        }

        case 'where_used': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: `Traversing BOM hierarchy for usage of part "${params.partNumber}"`
            })
          );
          const root = params.rootAssembly || params.rootItem || params.bom;
          const usages = findWhereUsed(root, params.partNumber);
          outputData = {
            partNumber: params.partNumber,
            totalOccurrences: usages.length,
            usages
          };
          break;
        }

        case 'validate_lifecycle': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Evaluating lifecycle state transitions and child release gates'
            })
          );
          const targetState = (params.targetState || 'RELEASED').toUpperCase();
          if (!VALID_LIFECYCLE_STATES.has(targetState)) {
            throw new OmniError(OmniErrorCode.INVALID_INPUT, `Invalid target lifecycle state: ${targetState}`);
          }
          const root = params.rootAssembly || params.rootItem || params.bom || params.item;
          const errors = [];
          const warnings = [];

          if (params.fromState && params.toState) {
            const from = params.fromState.toUpperCase();
            const to = params.toState.toUpperCase();
            if (from === 'OBSOLETE' && to !== 'OBSOLETE') {
              errors.push(`Cannot transition from OBSOLETE to ${to}; obsolete parts are immutable.`);
            }
            if (from === 'DRAFT' && to === 'RELEASED' && !params.skipReview) {
              warnings.push('Bypassing IN_REVIEW gate when transitioning directly from DRAFT to RELEASED.');
            }
          }

          checkLifecycleCompliance(root, targetState, errors, warnings);

          outputData = {
            valid: errors.length === 0,
            targetState,
            errors,
            warnings
          };
          break;
        }

        case 'visual_diff_cad': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Comparing CAD revision topology centroids and volumes'
            })
          );
          const diffEngine = new GitCADVisualDiffEngine({
            toleranceMm: params.toleranceMm !== undefined ? params.toleranceMm : 0.1,
            modificationThresholdMm: params.modificationThresholdMm !== undefined ? params.modificationThresholdMm : 1.0
          });
          outputData = diffEngine.compareRevisions(params.revisionA, params.revisionB);
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in PDMEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'PDM operation complete' })
      );

      const inputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ operation: jobRequest.operation, parameters: params }))
        .digest('hex');

      const validationRecord = new ValidationRecord({
        maturity: ValidationMaturity.EXPERIMENTAL,
        benchmarkSet: `PDM-${jobRequest.operation.toUpperCase()}-01`,
        errors: { errorCount: Array.isArray(outputData?.errors) ? outputData.errors.length : 0 },
        tolerances: { maxErrors: 0 }
      });

      if (outputData && typeof outputData === 'object' && !Array.isArray(outputData)) {
        const quantities = {};
        if (Number.isFinite(outputData.rollup?.rolledUpMassKg)) {
          quantities.totalMass = Quantity.from(outputData.rollup.rolledUpMassKg, 'kg').toJSON();
        }
        if (Number.isFinite(outputData.rollup?.totalPartCount)) {
          quantities.totalPartCount = Quantity.from(outputData.rollup.totalPartCount, '1').toJSON();
        }
        if (Number.isFinite(outputData.totalRows)) {
          quantities.totalRows = Quantity.from(outputData.totalRows, '1').toJSON();
        }
        if (Number.isFinite(outputData.uniquePartCount)) {
          quantities.uniquePartCount = Quantity.from(outputData.uniquePartCount, '1').toJSON();
        }
        if (Number.isFinite(outputData.totalOccurrences)) {
          quantities.totalOccurrences = Quantity.from(outputData.totalOccurrences, '1').toJSON();
        }
        outputData.inputSha256 = inputHash;
        outputData.validationRecord = validationRecord.toJSON();
        outputData.quantities = quantities;
      }

      const outputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(outputData || {}))
        .digest('hex');

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
        inputArtifactHashes: [inputHash],
        resultArtifactHashes: [outputHash],
        validationMaturity: ValidationMaturity.EXPERIMENTAL,
        backendName: this.name,
        backendVersion: this.version,
        executionDurationMs: durationMs,
        peakMemoryMb: process.memoryUsage().heapUsed / (1024 * 1024)
      });

      onEvent(new JobEvent({ jobId, type: JobEventType.COMPLETED, message: `Completed in ${durationMs}ms` }));
      return result;
    } catch (err) {
      onEvent(new JobEvent({ jobId, type: JobEventType.FAILED, message: err.message }));
      throw err;
    }
  }
}

module.exports = {
  PDMEngineAdapter
};
