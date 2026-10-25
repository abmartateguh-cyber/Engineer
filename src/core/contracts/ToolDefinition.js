'use strict';

const { OmniError, OmniErrorCode } = require('./OmniError');

/**
 * Approval classifications for Stenographer tool proposals.
 */
const ToolApprovalClass = Object.freeze({
  READ_ONLY: 'READ_ONLY',               // May run automatically without prompt
  MUTATION_PREVIEW: 'MUTATION_PREVIEW', // Modifies project model or canvas; requires user preview & confirm
  COMPUTE_JOB: 'COMPUTE_JOB',           // Spawns heavy compute job; requires budget confirmation
  EXPORT_OVERWRITE: 'EXPORT_OVERWRITE', // Modifies files or exports; requires file path confirmation
  SECURITY_SENSITIVE: 'SECURITY_SENSITIVE' // Accesses credentials or external networks; strictly requires approval
});

/**
 * Specification of an available Stenographer tool.
 */
class ToolDefinition {
  /**
   * @param {object} params
   * @param {string} params.name - Identifier (e.g. 'project.query_parts', 'cad.create_fillet')
   * @param {string} params.description - Clear documentation of tool function
   * @param {string} params.approvalClass - One of ToolApprovalClass
   * @param {object} params.parametersSchema - JSON Schema for arguments
   * @param {boolean} [params.modifiesState=false] - Whether this tool mutates engineering state
   * @param {number} [params.estimatedDurationMs=100] - Estimated execution time
   */
  constructor({
    name,
    description,
    approvalClass = ToolApprovalClass.MUTATION_PREVIEW,
    classification,
    parametersSchema = {},
    modifiesState = false,
    estimatedDurationMs = 100
  }) {
    if (!name || typeof name !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'ToolDefinition requires a valid name');
    }
    if (!description || typeof description !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'ToolDefinition requires a description');
    }
    const resolvedClass = classification || approvalClass;
    if (!Object.values(ToolApprovalClass).includes(resolvedClass)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Invalid ToolApprovalClass: "${resolvedClass}"`);
    }

    this._name = name;
    this._description = description;
    this._approvalClass = resolvedClass;
    this._parametersSchema = Object.freeze(JSON.parse(JSON.stringify(parametersSchema || {})));
    this._modifiesState = Boolean(modifiesState);
    this._estimatedDurationMs = Math.max(1, Number(estimatedDurationMs) || 100);
    Object.freeze(this);
  }

  get name() { return this._name; }
  get description() { return this._description; }
  get approvalClass() { return this._approvalClass; }
  get parametersSchema() { return this._parametersSchema; }
  get modifiesState() { return this._modifiesState; }
  get estimatedDurationMs() { return this._estimatedDurationMs; }

  isReadOnly() {
    return this._approvalClass === ToolApprovalClass.READ_ONLY && !this._modifiesState;
  }

  createProposal(args = {}, reasoning = '', expectedMutations = []) {
    const { ToolProposal } = require('./ToolProposal');
    return new ToolProposal({
      toolName: this._name,
      args,
      reasoning,
      expectedMutations,
      approvalClass: this._approvalClass
    });
  }

  toJSON() {
    return {
      name: this._name,
      description: this._description,
      approvalClass: this._approvalClass,
      parametersSchema: this._parametersSchema,
      modifiesState: this._modifiesState,
      estimatedDurationMs: this._estimatedDurationMs
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid ToolDefinition JSON');
    }
    return new ToolDefinition(json);
  }
}

const ToolClassification = ToolApprovalClass;

module.exports = {
  ToolDefinition,
  ToolApprovalClass,
  ToolClassification
};
