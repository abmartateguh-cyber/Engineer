'use strict';

const fs = require('fs');
const path = require('path');
const { OmniArchiveV2, CommandJournal } = require('./omni_archive');
const { ProjectManifestV2 } = require('../contracts/ProjectManifestV2');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

/**
 * ProjectManager: Master Session Controller for OmniEng Projects
 * Manages the active .omni v2 archive, command journaling, undo/redo, and atomic persistence.
 */
class ProjectManager {
  /**
   * @param {object} [options]
   * @param {string} [options.projectName]
   * @param {string} [options.engineeringDomain]
   * @param {string} [options.author]
   */
  constructor(options = {}) {
    this.currentFilePath = null;
    this.archive = null;
    this.isDirty = false;
    this.initializeNewProject(options);
  }

  /**
   * Initializes a fresh, empty project.
   * @param {object} [options]
   * @param {string} [options.projectName]
   * @param {string} [options.engineeringDomain]
   * @param {string} [options.author]
   * @returns {object} Project manifest summary
   */
  initializeNewProject(options = {}) {
    this.currentFilePath = null;
    this.isDirty = false;
    this.archive = new OmniArchiveV2({
      projectName: options.projectName || 'Untitled_Project',
      engineeringDomain: options.engineeringDomain || 'universal',
      author: options.author || 'OmniEng_Engineer'
    });
    return this.getSummary();
  }

  /**
   * Returns whether a project is currently open and initialized.
   * @returns {boolean}
   */
  hasActiveProject() {
    return Boolean(this.archive && this.archive.manifest);
  }

  /**
   * Returns metadata summary of the active project.
   * @returns {object}
   */
  getSummary() {
    if (!this.archive) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'No project currently active');
    }
    const manifest = this.archive.manifest;
    return {
      projectName: manifest.projectName,
      engineeringDomain: manifest.engineeringDomain,
      author: manifest.author,
      revision: manifest.revision,
      schemaVersion: manifest.schemaVersion,
      created: manifest.created,
      updated: manifest.updated,
      currentFilePath: this.currentFilePath,
      isDirty: this.isDirty,
      blobCount: this.archive.blobs.size,
      historyCount: this.archive.journal.history.length,
      canUndo: this.archive.journal.canUndo(),
      canRedo: this.archive.journal.canRedo()
    };
  }

  /**
   * Executes and journals an engineering state mutation.
   * @param {string} actionType
   * @param {object} forwardPatch
   * @param {object} reversePatch
   * @param {string} [description]
   * @param {string} [author]
   * @returns {object} Journal entry
   */
  recordCommand(actionType, forwardPatch, reversePatch, description = '', author = 'user') {
    if (!this.archive) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'No project currently active');
    }
    const entry = this.archive.journal.execute(actionType, forwardPatch, reversePatch, description, author);
    this.archive.bumpRevision();
    this.isDirty = true;

    // If an on-disk project exists, log to crash recovery journal for power-loss safety
    if (this.currentFilePath) {
      try {
        OmniArchiveV2.recordAcknowledgedCommandSync(this.currentFilePath, entry);
      } catch {
        // Non-fatal if recovery journal write fails
      }
    }

    return entry;
  }

  /**
   * Undoes the last acknowledged command.
   * @returns {object|null}
   */
  undo() {
    if (!this.archive) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'No project currently active');
    }
    const res = this.archive.journal.undo();
    if (!res) return null;
    this.isDirty = true;
    return {
      ...res,
      canUndo: this.archive.journal.canUndo(),
      canRedo: this.archive.journal.canRedo()
    };
  }

  /**
   * Redoes the last undone command.
   * @returns {object|null}
   */
  redo() {
    if (!this.archive) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'No project currently active');
    }
    const res = this.archive.journal.redo();
    if (!res) return null;
    this.isDirty = true;
    return {
      ...res,
      canUndo: this.archive.journal.canUndo(),
      canRedo: this.archive.journal.canRedo()
    };
  }

  /**
   * Returns full command history.
   * @returns {Array<object>}
   */
  getHistory() {
    if (!this.archive) return [];
    return this.archive.journal.getHistory();
  }

  /**
   * Saves project atomically to disk.
   * @param {string} [targetPath]
   * @returns {object} Save confirmation
   */
  saveProject(targetPath = null) {
    if (!this.archive) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'No project currently active');
    }
    const destPath = targetPath || this.currentFilePath;
    if (!destPath) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Target file path must be specified for new project');
    }

    const absPath = path.resolve(destPath);
    this.archive.saveAtomicSync(absPath);
    this.currentFilePath = absPath;
    this.isDirty = false;

    return {
      success: true,
      filePath: absPath,
      revision: this.archive.manifest.revision,
      sizeBytes: fs.statSync(absPath).size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Opens an existing .omni archive from disk or buffer.
   * @param {string|Buffer|Uint8Array} source
   * @returns {object} Project summary
   */
  openProject(source) {
    let archive;
    let filePath = null;

    if (typeof source === 'string') {
      filePath = path.resolve(source);
      if (!fs.existsSync(filePath)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, `Project file does not exist: ${filePath}`);
      }
      archive = OmniArchiveV2.loadFromFile(filePath);
    } else if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
      archive = OmniArchiveV2.loadFromBuffer(Buffer.from(source));
    } else {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Expected file path string or binary Buffer');
    }

    this.archive = archive;
    this.currentFilePath = filePath;
    this.isDirty = false;

    return this.getSummary();
  }

  /**
   * Attaches a content-addressed binary blob.
   * @param {string|Buffer} content
   * @param {string|object} [mimeTypeOrOptions]
   * @returns {import('../contracts/ArtifactRef').ArtifactRef}
   */
  addBlob(content, mimeTypeOrOptions = 'application/octet-stream') {
    if (!this.archive) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'No project currently active');
    }
    const options = typeof mimeTypeOrOptions === 'string'
      ? { mimeType: mimeTypeOrOptions }
      : (mimeTypeOrOptions || {});
    const ref = this.archive.addBlob(content, options);
    this.isDirty = true;
    return ref;
  }

  /**
   * Retrieves a binary blob by its SHA-256 hash.
   * @param {string} hash
   * @returns {Buffer}
   */
  getBlob(hash) {
    if (!this.archive) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'No project currently active');
    }
    return this.archive.getBlob(hash);
  }
}

// Global active project instance for workstation IPC
const activeProjectManager = new ProjectManager();

module.exports = {
  ProjectManager,
  activeProjectManager
};
