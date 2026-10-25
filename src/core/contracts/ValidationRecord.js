'use strict';

const { OmniError, OmniErrorCode } = require('./OmniError');

/**
 * Maturity levels for engineering workflows and validation records.
 */
const ValidationMaturity = Object.freeze({
  EXPERIMENTAL: 'experimental',
  CORRELATED: 'correlated',
  VERIFIED: 'verified',
  RELEASED: 'released'
});

/**
 * Immutable validation record documenting empirical, analytical, or cross-solver verification.
 */
class ValidationRecord {
  /**
   * @param {object} params
   * @param {string} params.maturity - One of ValidationMaturity
   * @param {string} params.benchmarkSet - Identifier of benchmark or reference suite
   * @param {object} [params.errors={}] - Measured relative/absolute error metrics
   * @param {string} [params.reviewer=''] - Independent domain engineer or software reviewer identifier
   * @param {string} [params.date=''] - ISO date string
   * @param {string} [params.signature=''] - Cryptographic signature or hash of review package
   * @param {string[]} [params.referenceArtifacts=[]] - Hashes of independent reference datasets
   * @param {object} [params.tolerances={}] - Declared pass criteria / bounds
   */
  constructor({
    maturity = ValidationMaturity.EXPERIMENTAL,
    benchmarkSet,
    errors = {},
    reviewer = '',
    date = '',
    signature = '',
    referenceArtifacts = [],
    tolerances = {}
  }) {
    if (!Object.values(ValidationMaturity).includes(maturity)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Invalid validation maturity: "${maturity}"`);
    }
    if (!benchmarkSet || typeof benchmarkSet !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'ValidationRecord requires a benchmarkSet identifier');
    }

    this._maturity = maturity;
    this._benchmarkSet = benchmarkSet;
    this._errors = Object.freeze({ ...errors });
    this._reviewer = String(reviewer || '');
    this._date = date ? new Date(date).toISOString() : new Date().toISOString();
    this._signature = String(signature || '');
    this._referenceArtifacts = Object.freeze([...(referenceArtifacts || [])]);
    this._tolerances = Object.freeze({ ...tolerances });
    Object.freeze(this);
  }

  get maturity() { return this._maturity; }
  get benchmarkSet() { return this._benchmarkSet; }
  get errors() { return this._errors; }
  get reviewer() { return this._reviewer; }
  get date() { return this._date; }
  get signature() { return this._signature; }
  get referenceArtifacts() { return this._referenceArtifacts; }
  get tolerances() { return this._tolerances; }

  isReleaseReady() {
    return this._maturity === ValidationMaturity.RELEASED && Boolean(this._reviewer) && Boolean(this._signature);
  }

  toJSON() {
    return {
      maturity: this._maturity,
      benchmarkSet: this._benchmarkSet,
      errors: this._errors,
      reviewer: this._reviewer,
      date: this._date,
      signature: this._signature,
      referenceArtifacts: [...this._referenceArtifacts],
      tolerances: this._tolerances
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid ValidationRecord JSON');
    }
    return new ValidationRecord(json);
  }
}

module.exports = {
  ValidationRecord,
  ValidationMaturity
};
