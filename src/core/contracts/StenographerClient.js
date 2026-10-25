'use strict';

const EventEmitter = require('events');
const { OmniError, OmniErrorCode } = require('./OmniError');
const { ToolProposal } = require('./ToolProposal');

/**
 * Abstract interface for communication with local Stenographer daemon.
 */
class StenographerClient extends EventEmitter {
  constructor() {
    super();
    if (new.target === StenographerClient) {
      throw new TypeError('Cannot construct StenographerClient instances directly; must subclass');
    }
  }

  /**
   * Connects or spawns daemon process.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new OmniError(OmniErrorCode.UNSUPPORTED, 'connect() not implemented');
  }

  /**
   * Disconnects and terminates daemon safely.
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new OmniError(OmniErrorCode.UNSUPPORTED, 'disconnect() not implemented');
  }

  /**
   * Sends user prompt and context to daemon; streams responses/proposals.
   * @param {string} prompt
   * @param {object} context
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ text: string, proposals: ToolProposal[] }>}
   */
  async query(prompt, context = {}, signal = null) {
    throw new OmniError(OmniErrorCode.UNSUPPORTED, 'query() not implemented');
  }

  /**
   * Submits approved tool result back to daemon to continue conversation.
   * @param {string} proposalId
   * @param {object} resultData
   * @returns {Promise<{ text: string, proposals: ToolProposal[] }>}
   */
  async submitToolResult(proposalId, resultData) {
    throw new OmniError(OmniErrorCode.UNSUPPORTED, 'submitToolResult() not implemented');
  }

  /**
   * Returns daemon health and status.
   * @returns {Promise<{ alive: boolean, version: string, pid?: number }>}
   */
  async getStatus() {
    throw new OmniError(OmniErrorCode.UNSUPPORTED, 'getStatus() not implemented');
  }
}

module.exports = {
  StenographerClient
};
