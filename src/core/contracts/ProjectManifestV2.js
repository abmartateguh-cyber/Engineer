'use strict';

const crypto = require('crypto');
const { OmniError, OmniErrorCode } = require('./OmniError');

/**
 * Manifest representing the root metadata of an .omni v2 engineering project archive.
 */
class ProjectManifestV2 {
  /**
   * @param {object} params
   * @param {string} [params.schemaVersion='2.0.0']
   * @param {string} [params.projectId] - Project UUID
   * @param {string} [params.name='Untitled Project']
   * @param {number} [params.revision=1]
   * @param {string} [params.activeUnits='SI_MM'] - Preferred default display unit system ('SI', 'SI_MM', 'US_CUSTOMARY')
   * @param {object} [params.domainModels={}] - Pointers to domain state (cad, cae, eda, optics, plant, controls)
   * @param {object} [params.blobs={}] - Content-addressed blobs map { [sha256]: ArtifactRef }
   * @param {string} [params.journalRef=''] - Reference to command history journal blob
   * @param {object[]} [params.results=[]] - Saved JobResult summaries
   * @param {object[]} [params.signatures=[]] - Cryptographic signatures or approvals
   * @param {string} [params.createdAt]
   * @param {string} [params.updatedAt]
   */
  constructor({
    schemaVersion = '2.0.0',
    projectId,
    name = 'Untitled Project',
    revision = 1,
    activeUnits = 'SI_MM',
    domainModels = {},
    blobs = {},
    journalRef = '',
    results = [],
    signatures = [],
    createdAt,
    updatedAt,
    author = 'OmniEng_Engineer',
    engineeringDomain = 'universal'
  }) {
    if (schemaVersion !== '2.0.0') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `ProjectManifestV2 requires schemaVersion "2.0.0", received "${schemaVersion}"`);
    }

    this._schemaVersion = '2.0.0';
    this._projectId = projectId && typeof projectId === 'string' ? projectId : crypto.randomUUID();
    this._name = String(name || 'Untitled Project');
    this._author = String(author || 'OmniEng_Engineer');
    this._engineeringDomain = String(engineeringDomain || 'universal');
    this._revision = Number.isInteger(revision) && revision >= 1 ? revision : 1;
    this._activeUnits = String(activeUnits || 'SI_MM');
    this._domainModels = Object.freeze(JSON.parse(JSON.stringify(domainModels || {})));
    this._blobs = Object.freeze(JSON.parse(JSON.stringify(blobs || {})));
    this._journalRef = String(journalRef || '');
    this._results = Object.freeze([...(results || [])].map((r) => Object.freeze({ ...r })));
    this._signatures = Object.freeze([...(signatures || [])].map((s) => Object.freeze({ ...s })));
    this._createdAt = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();
    this._updatedAt = updatedAt ? new Date(updatedAt).toISOString() : this._createdAt;
    Object.freeze(this);
  }

  get schemaVersion() { return this._schemaVersion; }
  get projectId() { return this._projectId; }
  get name() { return this._name; }
  get projectName() { return this._name; }
  get author() { return this._author; }
  get engineeringDomain() { return this._engineeringDomain; }
  get revision() { return this._revision; }
  get activeUnits() { return this._activeUnits; }
  get domainModels() { return this._domainModels; }
  get blobs() { return this._blobs; }
  get journalRef() { return this._journalRef; }
  get results() { return this._results; }
  get signatures() { return this._signatures; }
  get createdAt() { return this._createdAt; }
  get created() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }
  get updated() { return this._updatedAt; }

  /**
   * Clones manifest with an incremented revision and updated timestamp.
   * @param {object} changes - Properties to update
   * @returns {ProjectManifestV2}
   */
  withIncrementedRevision(changes = {}) {
    return new ProjectManifestV2({
      ...this.toJSON(),
      ...changes,
      revision: this._revision + 1,
      updatedAt: new Date().toISOString()
    });
  }

  toJSON() {
    return {
      schemaVersion: this._schemaVersion,
      projectId: this._projectId,
      name: this._name,
      author: this._author,
      engineeringDomain: this._engineeringDomain,
      revision: this._revision,
      activeUnits: this._activeUnits,
      domainModels: this._domainModels,
      blobs: this._blobs,
      journalRef: this._journalRef,
      results: [...this._results],
      signatures: [...this._signatures],
      createdAt: this._createdAt,
      updatedAt: this._updatedAt
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid ProjectManifestV2 JSON');
    }
    return new ProjectManifestV2(json);
  }
}

module.exports = {
  ProjectManifestV2
};
