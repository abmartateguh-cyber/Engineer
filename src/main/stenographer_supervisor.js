'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');
const { StenographerClient } = require('../core/contracts/StenographerClient');
const { ToolProposal, ProposalStatus } = require('../core/contracts/ToolProposal');
const { ToolDefinition, ToolClassification } = require('../core/contracts/ToolDefinition');
const { ApprovalRecord, ApprovalDecision } = require('../core/contracts/ApprovalRecord');
const { OmniError, OmniErrorCode } = require('../core/contracts/OmniError');
const { ArtifactRef } = require('../core/contracts/ArtifactRef');

/**
 * Immutable Engineering Record Ledger Entry
 */
class LedgerEntry {
  constructor({ sequenceNumber, prevHash, type, payload, timestamp }) {
    this.sequenceNumber = sequenceNumber;
    this.prevHash = prevHash || '0000000000000000000000000000000000000000000000000000000000000000';
    this.type = type; // 'PROMPT' | 'PROPOSAL' | 'APPROVAL' | 'TOOL_RESULT' | 'CRASH' | 'CHECKPOINT'
    this.payload = payload;
    this.timestamp = timestamp || new Date().toISOString();

    const dataToHash = `${this.sequenceNumber}:${this.prevHash}:${this.type}:${JSON.stringify(this.payload)}:${this.timestamp}`;
    this.hash = crypto.createHash('sha256').update(dataToHash).digest('hex');
    Object.freeze(this);
  }
}

/**
 * StenographerSupervisor: Daemon Supervisor & Fail-Closed Tool Gateway
 * Enforces human-in-the-loop review for state mutations, compute, and exports.
 */
class StenographerSupervisor extends StenographerClient {
  /**
   * @param {object} [options]
   * @param {string} [options.daemonPath] - Path to daemon executable or script
   * @param {string[]} [options.daemonArgs]
   * @param {number} [options.maxRestarts=3]
   * @param {boolean} [options.mockMode=false] - For standalone unit testing without separate process
   */
  constructor(options = {}) {
    super();
    this.daemonPath = options.daemonPath || null;
    this.daemonArgs = options.daemonArgs || [];
    this.maxRestarts = options.maxRestarts !== undefined ? options.maxRestarts : 3;
    this.mockMode = Boolean(options.mockMode || !options.daemonPath);

    this.process = null;
    this.rl = null;
    this.restartCount = 0;
    this.isConnected = false;
    this.proposals = new Map(); // [id] -> ToolProposal
    this.tools = new Map(); // [name] -> ToolDefinition

    // Immutable Hash-Chained Engineering Ledger
    this.ledger = [];
    this.latestHash = '0000000000000000000000000000000000000000000000000000000000000000';

    // Register baseline tools
    this._registerDefaultTools();
  }

  /**
   * Appends an entry to the cryptographic hash chain ledger.
   * @param {string} type
   * @param {object} payload
   * @returns {LedgerEntry}
   */
  _appendLedger(type, payload) {
    const entry = new LedgerEntry({
      sequenceNumber: this.ledger.length + 1,
      prevHash: this.latestHash,
      type,
      payload,
      timestamp: new Date().toISOString()
    });
    this.ledger.push(entry);
    this.latestHash = entry.hash;
    this.emit('ledger:entry', entry);
    return entry;
  }

  /**
   * Registers a tool definition.
   * @param {ToolDefinition} toolDef
   */
  registerTool(toolDef) {
    if (!(toolDef instanceof ToolDefinition)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Expected ToolDefinition instance');
    }
    this.tools.set(toolDef.name, toolDef);
  }

  _registerDefaultTools() {
    this.registerTool(
      new ToolDefinition({
        name: 'read_mesh_summary',
        description: 'Read node/element statistics of currently loaded mesh',
        classification: ToolClassification.READ_ONLY,
        autoRun: true
      })
    );
    this.registerTool(
      new ToolDefinition({
        name: 'mutate_geometry_parameter',
        description: 'Modify CAD feature parameter',
        classification: ToolClassification.MUTATION_PREVIEW,
        autoRun: false
      })
    );
    this.registerTool(
      new ToolDefinition({
        name: 'execute_fea_solve',
        description: 'Dispatch 3D Continuum structural FEA calculation',
        classification: ToolClassification.COMPUTE_JOB,
        autoRun: false
      })
    );
    this.registerTool(
      new ToolDefinition({
        name: 'export_step_file',
        description: 'Export solid body to STEP geometry file',
        classification: ToolClassification.EXPORT_OVERWRITE,
        autoRun: false
      })
    );
  }

  /**
   * Connects to or spawns the daemon process.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isConnected) return;

    if (this.mockMode) {
      this.isConnected = true;
      this._appendLedger('CHECKPOINT', { status: 'connected', mode: 'in-process' });
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.daemonPath, this.daemonArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, STENOGRAPHER_SUPERVISED: '1' }
        });

        this.rl = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity
        });

        this.rl.on('line', (line) => this._handleDaemonLine(line));

        this.process.stderr.on('data', (data) => {
          this.emit('daemon:stderr', data.toString());
        });

        this.process.on('exit', (code, signal) => {
          this._handleDaemonExit(code, signal);
        });

        this.isConnected = true;
        this._appendLedger('CHECKPOINT', { status: 'spawned', pid: this.process.pid });
        resolve();
      } catch (err) {
        reject(new OmniError(OmniErrorCode.INTERNAL, `Failed to spawn daemon: ${err.message}`));
      }
    });
  }

  /**
   * Disconnects daemon and releases resources.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.isConnected = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this._appendLedger('CHECKPOINT', { status: 'disconnected' });
  }

  /**
   * Handles unexpected daemon termination and restarts supervisor up to maxRestarts.
   * @private
   */
  _handleDaemonExit(code, signal) {
    this.isConnected = false;
    this._appendLedger('CRASH', { code, signal, restartCount: this.restartCount });

    if (this.restartCount < this.maxRestarts) {
      this.restartCount++;
      this.emit('daemon:restarting', { attempt: this.restartCount });
      setTimeout(() => {
        this.connect().catch((err) => {
          this.emit('daemon:error', err);
        });
      }, 500);
    } else {
      this.emit('daemon:exhausted', { restartCount: this.restartCount });
    }
  }

  /**
   * Handles inbound JSON-RPC / NDJSON lines from daemon.
   * @private
   */
  _handleDaemonLine(line) {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      this.emit('daemon:message', msg);
    } catch (err) {
      this.emit('daemon:parse_error', { line, error: err.message });
    }
  }

  /**
   * Queries the assistant and generates tool proposals.
   * @param {string} prompt
   * @param {object} [context={}]
   * @returns {Promise<{ text: string, proposals: ToolProposal[] }>}
   */
  async query(prompt, context = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    this._appendLedger('PROMPT', { prompt, context });

    // In mock/in-process mode or fallback, evaluate based on registered tools
    const proposals = [];
    let text = `Processed engineering request: "${prompt}"`;

    if (prompt.toLowerCase().includes('mesh') || prompt.toLowerCase().includes('stats')) {
      const toolDef = this.tools.get('read_mesh_summary');
      if (toolDef) {
        const prop = toolDef.createProposal({}, 'Analyze active finite element mesh statistics');
        this.proposals.set(prop.id, prop);
        proposals.push(prop);
        this._appendLedger('PROPOSAL', prop.toJSON());
      }
    }

    if (prompt.toLowerCase().includes('extrude') || prompt.toLowerCase().includes('modify')) {
      const toolDef = this.tools.get('mutate_geometry_parameter');
      if (toolDef) {
        const prop = toolDef.createProposal(
          { feature: 'extrude_01', param: 'depth', value: 50 },
          'Mutate CAD model thickness parameter'
        );
        this.proposals.set(prop.id, prop);
        proposals.push(prop);
        this._appendLedger('PROPOSAL', prop.toJSON());
      }
    }

    if (prompt.toLowerCase().includes('solve') || prompt.toLowerCase().includes('fea')) {
      const toolDef = this.tools.get('execute_fea_solve');
      if (toolDef) {
        const prop = toolDef.createProposal(
          { meshId: 'mesh_01', solver: 'continuum_plasticity_3d' },
          'Run non-linear structural solver'
        );
        this.proposals.set(prop.id, prop);
        proposals.push(prop);
        this._appendLedger('PROPOSAL', prop.toJSON());
      }
    }

    return { text, proposals };
  }

  /**
   * Evaluates and approves or rejects a tool proposal.
   * @param {string} proposalId
   * @param {string} decision - 'APPROVED' | 'REJECTED'
   * @param {string} [reason]
   * @param {string} [approvedBy='lead_engineer']
   * @returns {ApprovalRecord}
   */
  evaluateProposal(proposalId, decision, reason = '', approvedBy = 'lead_engineer') {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `No tool proposal found with ID: ${proposalId}`);
    }

    const approval = new ApprovalRecord({
      proposalId,
      decision,
      reason,
      approvedBy
    });

    if (decision === ApprovalDecision.APPROVED) {
      proposal.approve(approval);
    } else {
      proposal.reject(reason);
    }

    this._appendLedger('APPROVAL', approval.toJSON());
    return approval;
  }

  /**
   * Executes a proposed tool through the fail-closed security gateway.
   * Auto-runs read-only tools; strictly blocks mutations, compute, and exports without approval.
   * @param {string} proposalId
   * @param {Function} [executor] - Optional custom execution function
   * @returns {Promise<object>}
   */
  async executeTool(proposalId, executor = null) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Proposal not found: ${proposalId}`);
    }

    // Fail-Closed Security Gate:
    // If tool requires approval and is not approved, fail immediately.
    if (proposal.requiresApproval && proposal.status !== ProposalStatus.APPROVED) {
      throw new OmniError(
        OmniErrorCode.UNSUPPORTED,
        `Fail-closed gate: Tool "${proposal.toolName}" requires explicit engineer approval before execution (status: ${proposal.status})`
      );
    }

    proposal.markExecuting();

    try {
      let resultData;
      if (typeof executor === 'function') {
        resultData = await executor(proposal.parameters);
      } else {
        // Built-in mock/fallback executor
        resultData = { executed: true, tool: proposal.toolName, params: proposal.parameters };
      }

      proposal.markExecuted(resultData);

      // Hash result artifact for audit integrity
      const artifactRef = ArtifactRef.fromContent(Buffer.from(JSON.stringify(resultData), 'utf8'), {
        mimeType: 'application/json',
        name: `result_${proposal.toolName}`
      });

      this._appendLedger('TOOL_RESULT', {
        proposalId,
        toolName: proposal.toolName,
        artifactHash: artifactRef.hash,
        result: resultData
      });

      return {
        success: true,
        proposalId,
        artifactRef,
        result: resultData
      };
    } catch (err) {
      proposal.markFailed(err.message);
      this._appendLedger('TOOL_FAILED', { proposalId, error: err.message });
      throw err;
    }
  }

  /**
   * Returns daemon supervisor status.
   * @returns {Promise<{ alive: boolean, version: string, pid?: number, ledgerSize: number }>}
   */
  async getStatus() {
    return {
      alive: this.isConnected,
      version: '2.0.0',
      pid: this.process ? this.process.pid : process.pid,
      ledgerSize: this.ledger.length,
      latestHash: this.latestHash,
      restartCount: this.restartCount
    };
  }

  /**
   * Verifies the cryptographic integrity of the entire ledger chain.
   * @returns {{ valid: boolean, entriesCount: number, error?: string }}
   */
  verifyLedgerIntegrity() {
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    for (let i = 0; i < this.ledger.length; i++) {
      const entry = this.ledger[i];
      if (entry.sequenceNumber !== i + 1) {
        return { valid: false, entriesCount: i, error: `Invalid sequence number at ${i + 1}` };
      }
      if (entry.prevHash !== prevHash) {
        return { valid: false, entriesCount: i, error: `Broken prevHash link at entry ${i + 1}` };
      }
      const expectedData = `${entry.sequenceNumber}:${entry.prevHash}:${entry.type}:${JSON.stringify(entry.payload)}:${entry.timestamp}`;
      const expectedHash = crypto.createHash('sha256').update(expectedData).digest('hex');
      if (entry.hash !== expectedHash) {
        return { valid: false, entriesCount: i, error: `Hash mismatch at entry ${i + 1}` };
      }
      prevHash = entry.hash;
    }
    return { valid: true, entriesCount: this.ledger.length };
  }
}

module.exports = {
  StenographerSupervisor,
  LedgerEntry
};
