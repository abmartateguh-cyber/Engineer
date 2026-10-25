'use strict';

const { OmniError, OmniErrorCode } = require('./OmniError');

const ApprovalDecision = Object.freeze({
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  MODIFIED: 'MODIFIED',
  EXPIRED: 'EXPIRED'
});

/**
 * Record of human-in-the-loop approval or rejection for a Stenographer tool proposal.
 */
class ApprovalRecord {
  /**
   * @param {object} params
   * @param {string} params.proposalId - Associated ToolProposal ID
   * @param {string} params.decision - One of ApprovalDecision
   * @param {string} [params.userId='engineer'] - Approving engineer identity
   * @param {object} [params.modifiedArgs=null] - If modified, the user-amended arguments
   * @param {string} [params.comment=''] - Optional comment or justification
   * @param {object} [params.appliedOverrides={}] - Explicit overrides applied (e.g. timeout, memory)
   */
  constructor({
    proposalId,
    decision,
    userId = 'engineer',
    modifiedArgs = null,
    comment = '',
    appliedOverrides = {}
  }) {
    if (!proposalId || typeof proposalId !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'ApprovalRecord requires a proposalId');
    }
    if (!Object.values(ApprovalDecision).includes(decision)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Invalid ApprovalDecision: "${decision}"`);
    }

    this._proposalId = proposalId;
    this._decision = decision;
    this._userId = String(userId || 'engineer');
    this._modifiedArgs = modifiedArgs && typeof modifiedArgs === 'object' ? Object.freeze({ ...modifiedArgs }) : null;
    this._comment = String(comment || '');
    this._appliedOverrides = Object.freeze({ ...appliedOverrides });
    this._decidedAt = new Date().toISOString();
    Object.freeze(this);
  }

  get proposalId() { return this._proposalId; }
  get decision() { return this._decision; }
  get userId() { return this._userId; }
  get modifiedArgs() { return this._modifiedArgs; }
  get comment() { return this._comment; }
  get appliedOverrides() { return this._appliedOverrides; }
  get decidedAt() { return this._decidedAt; }

  isApproved() {
    return this._decision === ApprovalDecision.APPROVED || this._decision === ApprovalDecision.MODIFIED;
  }

  toJSON() {
    return {
      proposalId: this._proposalId,
      decision: this._decision,
      userId: this._userId,
      modifiedArgs: this._modifiedArgs,
      comment: this._comment,
      appliedOverrides: this._appliedOverrides,
      decidedAt: this._decidedAt
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid ApprovalRecord JSON');
    }
    return new ApprovalRecord(json);
  }
}

module.exports = {
  ApprovalRecord,
  ApprovalDecision
};
