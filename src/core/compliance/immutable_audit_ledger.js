/**
 * OmniEng Immutable Audit Ledger
 * 
 * Provides cryptographically chained, tamper-evident audit logging for aerospace (DO-178C DAL-A),
 * automotive (ISO 26262 ASIL-D), and nuclear/ASME compliance signoffs.
 * Each entry is linked to its predecessor via SHA-256 merkle hash chaining.
 */

'use strict';

const crypto = require('crypto');

class ImmutableAuditLedger {
  constructor(initialGenesisSeed = 'OmniEng_Genesis_2026') {
    this.genesisHash = crypto.createHash('sha256').update(initialGenesisSeed).digest('hex');
    this.chain = [];
    this._addGenesisBlock();
  }

  _addGenesisBlock() {
    const genesisEntry = {
      sequence: 0,
      timestamp: new Date().toISOString(),
      author: 'SYSTEM_ROOT',
      actionType: 'GENESIS_INITIALIZATION',
      prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
      dataHash: this.genesisHash,
      details: { status: 'Audit ledger initialized with cryptographic seal' }
    };
    genesisEntry.entryHash = this._calculateEntryHash(genesisEntry);
    this.chain.push(genesisEntry);
  }

  _calculateEntryHash(entry) {
    const payload = `${entry.sequence}:${entry.prevHash}:${entry.timestamp}:${entry.author}:${entry.actionType}:${entry.dataHash}:${JSON.stringify(entry.details)}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Records an engineering or regulatory action into the immutable ledger.
   * @param {string} author 
   * @param {string} actionType 
   * @param {Object} details 
   * @returns {Object} Sealed audit entry
   */
  recordAction(author, actionType, details = {}) {
    if (!author || typeof author !== 'string') {
      throw new Error('Audit Ledger Error: Author must be a non-empty string');
    }
    if (!actionType || typeof actionType !== 'string') {
      throw new Error('Audit Ledger Error: ActionType must be a non-empty string');
    }

    const prevEntry = this.chain[this.chain.length - 1];
    const dataHash = crypto.createHash('sha256').update(JSON.stringify(details)).digest('hex');

    const entry = {
      sequence: this.chain.length,
      timestamp: new Date().toISOString(),
      author,
      actionType,
      prevHash: prevEntry.entryHash,
      dataHash,
      details
    };

    entry.entryHash = this._calculateEntryHash(entry);
    this.chain.push(entry);
    return entry;
  }

  /**
   * Verifies the entire cryptographic integrity of the ledger.
   * Detects any tampering, altered payloads, or reordered blocks.
   * @returns {{isValid: boolean, blockCount: number, error: string|null}}
   */
  verifyChainIntegrity() {
    if (this.chain.length === 0) {
      return { isValid: false, blockCount: 0, error: 'Empty audit chain' };
    }

    for (let i = 0; i < this.chain.length; i++) {
      const current = this.chain[i];

      // Verify sequence numbering
      if (current.sequence !== i) {
        return { isValid: false, blockCount: this.chain.length, error: `Invalid sequence at block ${i}: expected ${i}, found ${current.sequence}` };
      }

      // Verify link to previous hash
      if (i > 0) {
        const prev = this.chain[i - 1];
        if (current.prevHash !== prev.entryHash) {
          return { isValid: false, blockCount: this.chain.length, error: `Broken chain link at block ${i}: prevHash does not match predecessor hash` };
        }
      }

      // Verify recalculation of entry hash
      const recalculated = this._calculateEntryHash(current);
      if (current.entryHash !== recalculated) {
        return { isValid: false, blockCount: this.chain.length, error: `Tampered hash at block ${i}: recorded hash does not match computed digest` };
      }
    }

    return { isValid: true, blockCount: this.chain.length, error: null };
  }

  /**
   * Generates a regulatory compliance dossier summary
   */
  generateDossierReport() {
    const integrity = this.verifyChainIntegrity();
    return {
      chainLength: this.chain.length,
      genesisHash: this.genesisHash,
      latestHash: this.chain[this.chain.length - 1].entryHash,
      integrityVerified: integrity.isValid,
      records: this.chain.map(c => ({
        seq: c.sequence,
        time: c.timestamp,
        author: c.author,
        action: c.actionType,
        hash: c.entryHash.substring(0, 16) + '...'
      }))
    };
  }
}

module.exports = { ImmutableAuditLedger };
