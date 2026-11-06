#!/usr/bin/env node
'use strict';

/**
 * @file bin/stenographer.js
 * @description Executable CLI and NDJSON / JSON-RPC 2.0 stdio daemon for the
 * OmniEng Stenographer Supervisor.
 *
 * Supported CLI flags:
 *   --health
 *   --list-tools
 *   --verify-ledger
 *   --query <prompt>
 *   --propose <json>
 *   --approve <proposalId> [--reviewer <id>] [--rationale <text>]
 *   --execute <proposalId>
 *   --run-tool <toolName> [--args <json>] --project-revision <revision>
 *   --stdio
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { StenographerSupervisor } = require('../src/main/stenographer_supervisor');
const { defaultEngineRegistry } = require('../src/core/contracts/engine_registry');
const { ToolProposal } = require('../src/core/contracts/ToolProposal');
const { ApprovalRecord } = require('../src/core/contracts/ApprovalRecord');

const DEFAULT_STATE_PATH = path.join(os.tmpdir(), 'omnieng-stenographer-cli-state.json');

function getStateFilePath(customPath) {
  return customPath || process.env.OMNI_STENOGRAPHER_STATE_FILE || DEFAULT_STATE_PATH;
}

function readPrivateStateFile(stateFilePath) {
  let stat;
  try {
    stat = fs.lstatSync(stateFilePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error('State must be a private regular file (mode 0600)');
  }
  return fs.readFileSync(stateFilePath, 'utf8');
}

function stateDigest(raw) {
  return raw === null ? null : crypto.createHash('sha256').update(raw).digest('hex');
}

function loadSupervisorState(supervisor, stateFilePath) {
  if (!supervisor.ledgerKeyIsPersistent) return;
  try {
    const raw = readPrivateStateFile(stateFilePath);
    supervisor.persistedStateDigest = stateDigest(raw);
    if (raw === null) return;
    if (!raw || !raw.trim()) throw new Error('State file is empty');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.ledger)) {
      throw new Error('State file has no ledger');
    }
    supervisor.ledger = data.ledger.slice();
    supervisor.latestHash =
      supervisor.ledger.length > 0
        ? supervisor.ledger[supervisor.ledger.length - 1].hash
        : '0000000000000000000000000000000000000000000000000000000000000000';
    if (!supervisor.verifyLedgerIntegrity().valid) {
      throw new Error('Stenographer ledger verification failed; refusing persisted state');
    }

    // Rebuild actionable state exclusively from authenticated events. The
    // unsigned proposals/approvals fields in older state files are ignored.
    for (const entry of supervisor.ledger) {
      const payload = entry.payload;
      if (entry.type === 'PROPOSAL') {
        const proposal = new ToolProposal(payload);
        const tool = supervisor.tools.get(proposal.toolName);
        if (!tool || tool.approvalClass !== proposal.approvalClass || supervisor.proposals.has(proposal.id)) {
          throw new Error(`Invalid or duplicate signed proposal: ${proposal.id}`);
        }
        supervisor.proposals.set(proposal.id, proposal);
      } else if (entry.type === 'APPROVAL') {
        const approval = new ApprovalRecord(payload);
        const proposal = supervisor.proposals.get(approval.proposalId);
        if (!proposal || proposal.status !== 'PROPOSED') {
          throw new Error(`Approval has no pending signed proposal: ${approval.proposalId}`);
        }
        if (approval.isApproved()) proposal.approve(approval);
        else proposal.reject(approval.reason);
        supervisor.approvals.set(approval.proposalId, approval);
      } else if (entry.type === 'TOOL_STARTED') {
        const proposal = supervisor.proposals.get(payload?.proposalId);
        if (
          !proposal ||
          (proposal.status !== 'APPROVED' && !(proposal.canAutoRun() && proposal.status === 'PROPOSED'))
        ) {
          throw new Error(`Start has no approved signed proposal: ${payload?.proposalId}`);
        }
        if (
          payload.toolName !== proposal.toolName ||
          payload.idempotencyKey !== proposal.idempotencyKey ||
          payload.originatingProjectRevision !== proposal.originatingProjectRevision ||
          (payload.originatingProjectId || null) !== proposal.originatingProjectId
        ) {
          throw new Error(`Start does not match signed proposal: ${payload.proposalId}`);
        }
        proposal.markExecuting();
      } else if (entry.type === 'TOOL_RESULT' || entry.type === 'TOOL_FAILED') {
        const proposal = supervisor.proposals.get(payload?.proposalId);
        if (
          !proposal ||
          (proposal.status !== 'EXECUTING' && proposal.status !== 'APPROVED' && !proposal.canAutoRun())
        ) {
          throw new Error(`Result has no approved signed proposal: ${payload?.proposalId}`);
        }
        if (entry.type === 'TOOL_RESULT') proposal.markExecuted(payload.result);
        else proposal.markFailed(payload.error);
      }
    }
  } catch (error) {
    throw new Error(`Could not load Stenographer state: ${error.message}`);
  }
}

function saveSupervisorState(supervisor, stateFilePath) {
  if (!supervisor.ledgerKeyIsPersistent) return;
  let temporaryPath;
  let lockFd;
  const lockPath = `${stateFilePath}.lock`;
  try {
    lockFd = fs.openSync(lockPath, 'wx', 0o600);
    const currentDigest = stateDigest(readPrivateStateFile(stateFilePath));
    if (currentDigest !== (supervisor.persistedStateDigest || null)) {
      throw new Error('State changed since load; restart and reload before writing');
    }
    const payload = {
      updatedAt: new Date().toISOString(),
      ledger: supervisor.getAuditLedger()
    };
    const serialized = JSON.stringify(payload, null, 2);
    temporaryPath = `${stateFilePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    const fd = fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, serialized, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporaryPath, stateFilePath);
    temporaryPath = null;
    const dirFd = fs.openSync(path.dirname(stateFilePath), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
    supervisor.persistedStateDigest = stateDigest(serialized);
  } catch (error) {
    supervisor.statePersistenceFailed = true;
    throw new Error(`Could not persist Stenographer state: ${error.message}`);
  } finally {
    if (temporaryPath) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (_) {}
    }
    if (lockFd !== undefined) {
      let releaseError;
      try {
        fs.closeSync(lockFd);
      } catch (error) {
        releaseError = error;
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        releaseError = releaseError || error;
      }
      if (releaseError) {
        supervisor.statePersistenceFailed = true;
        throw new Error(`Could not release Stenographer state lock: ${releaseError.message}`);
      }
    }
  }
}

function parseArgv(argv) {
  const opts = {
    health: false,
    listTools: false,
    verifyLedger: false,
    stdio: false,
    resetState: false,
    query: null,
    propose: null,
    approve: null,
    reviewer: 'cli-operator',
    rationale: 'Approved via Stenographer CLI',
    execute: null,
    runTool: null,
    args: null,
    approveFlag: false,
    projectRevision: null,
    stateFile: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--health') {
      opts.health = true;
    } else if (arg === '--list-tools') {
      opts.listTools = true;
    } else if (arg === '--verify-ledger') {
      opts.verifyLedger = true;
    } else if (arg === '--stdio') {
      opts.stdio = true;
    } else if (arg === '--reset-state') {
      opts.resetState = true;
    } else if (arg === '--query' && i + 1 < argv.length) {
      opts.query = argv[++i];
    } else if (arg === '--propose' && i + 1 < argv.length) {
      opts.propose = argv[++i];
    } else if (arg === '--approve') {
      opts.approveFlag = true;
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts.approve = argv[++i];
      }
    } else if (arg === '--reviewer' && i + 1 < argv.length) {
      opts.reviewer = argv[++i];
    } else if (arg === '--rationale' && i + 1 < argv.length) {
      opts.rationale = argv[++i];
    } else if (arg === '--execute' && i + 1 < argv.length) {
      opts.execute = argv[++i];
    } else if (arg === '--run-tool' && i + 1 < argv.length) {
      opts.runTool = argv[++i];
    } else if (arg === '--args' && i + 1 < argv.length) {
      opts.args = argv[++i];
    } else if (arg === '--project-revision' && i + 1 < argv.length) {
      opts.projectRevision = argv[++i];
    } else if (arg === '--state-file' && i + 1 < argv.length) {
      opts.stateFile = argv[++i];
    }
  }

  return opts;
}

async function dispatchRpcMethod(supervisor, method, params = {}, stateFilePath = null) {
  if (supervisor.statePersistenceFailed) {
    throw new Error('Stenographer state persistence failed; restart and reload before continuing');
  }
  const normalizedMethod = String(method || '').trim();

  switch (normalizedMethod) {
    case 'stenographer.health':
    case 'health': {
      const tools = supervisor.getRegisteredTools();
      const integrity = supervisor.verifyLedgerIntegrity();
      return {
        status: 'ok',
        engine: 'StenographerSupervisor',
        toolCount: tools.length,
        proposalCount: supervisor.proposals.size,
        ledgerEntries: supervisor.ledger.length,
        ledgerIntegrity: integrity,
        timestamp: new Date().toISOString()
      };
    }

    case 'stenographer.listTools':
    case 'listTools':
    case 'list_tools': {
      const tools = supervisor.getRegisteredTools();
      return {
        status: 'ok',
        tools,
        count: tools.length
      };
    }

    case 'stenographer.verifyLedger':
    case 'verifyLedger':
    case 'verify_ledger': {
      const integrity = supervisor.verifyLedgerIntegrity();
      return {
        status: integrity.valid ? 'ok' : 'error',
        ...integrity
      };
    }

    case 'stenographer.query':
    case 'query': {
      const prompt = typeof params === 'string' ? params : params.prompt || params.query || '';
      const projectRevision = params && params.projectRevision;
      const context = (params && params.context) || {};
      let res;
      try {
        res = supervisor.processQuery({ prompt, projectRevision, context });
      } finally {
        if (stateFilePath) saveSupervisorState(supervisor, stateFilePath);
      }
      return res;
    }

    case 'stenographer.propose':
    case 'propose': {
      const toolName = params.toolName || params.toolId || params.name;
      const args = params.args || params.parameters || {};
      const rationale = params.rationale || `Proposed ${toolName} via RPC`;
      const projectRevision = Number(params.projectRevision);
      const proposedBy = params.proposedBy || 'stenographer-cli';
      const proposal = supervisor.proposeToolCall({
        toolName,
        args,
        rationale,
        originatingProjectRevision: projectRevision,
        proposedBy
      });
      if (stateFilePath) saveSupervisorState(supervisor, stateFilePath);
      return {
        status: 'ok',
        proposalId: proposal.proposalId,
        proposal: proposal.toJSON()
      };
    }

    case 'stenographer.approve':
    case 'approve': {
      const proposalId = params.proposalId || params.id;
      const decision = params.decision || 'approved';
      const reviewer = params.reviewer || params.decidedBy || 'cli-operator';
      const rationale = params.rationale || params.reason || 'Approved via Stenographer RPC';
      const record = supervisor.evaluateProposal({ proposalId, decision, reviewer, rationale });
      const proposal = supervisor.getProposal(proposalId);
      if (stateFilePath) saveSupervisorState(supervisor, stateFilePath);
      return {
        status: 'ok',
        proposalId,
        decision: record.decision,
        approval: record.toJSON(),
        proposal: proposal ? proposal.toJSON() : null
      };
    }

    case 'stenographer.execute':
    case 'execute': {
      const proposalId = params.proposalId || params.id;
      let execution;
      try {
        execution = await supervisor.executeApprovedTool(proposalId);
      } finally {
        if (stateFilePath) saveSupervisorState(supervisor, stateFilePath);
      }
      return {
        status: 'ok',
        ...execution
      };
    }

    default:
      throw new Error(`Unsupported JSON-RPC method '${normalizedMethod}'`);
  }
}

function startStdioServer(supervisor, stateFilePath) {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (parseErr) {
      const errResp = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${parseErr.message}`
        }
      };
      process.stdout.write(`${JSON.stringify(errResp)}\n`);
      return;
    }

    const id = msg.id !== undefined ? msg.id : null;
    const method = msg.method || msg.type;
    const params = msg.params || msg.payload || {};

    try {
      const result = await dispatchRpcMethod(supervisor, method, params, stateFilePath);
      const response = {
        jsonrpc: '2.0',
        id,
        result
      };
      process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (err) {
      const errResp = {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: err.message || String(err)
        }
      };
      process.stdout.write(`${JSON.stringify(errResp)}\n`);
    }
  });
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgv(argv);
  const stateFilePath = getStateFilePath(opts.stateFile);

  const supervisor = new StenographerSupervisor({
    engineRegistry: defaultEngineRegistry
  });

  try {
    if (opts.resetState) {
      throw new Error('Audit state reset is unavailable; use an authorized recovery workflow');
    }
    if (opts.runTool && opts.approveFlag) {
      throw new Error('Review the printed proposal, then approve its ID in a separate command');
    }
    if (opts.approveFlag && !opts.approve) {
      throw new Error('--approve requires an existing proposal ID');
    }
    if (opts.approve && opts.execute && opts.execute !== opts.approve) {
      throw new Error('--execute must reference the same proposal ID as --approve');
    }
    if ((opts.stateFile || process.env.OMNI_STENOGRAPHER_STATE_FILE) && !supervisor.ledgerKeyIsPersistent) {
      throw new Error('Persistent Stenographer state requires OMNI_STENOGRAPHER_HMAC_KEY');
    }

    loadSupervisorState(supervisor, stateFilePath);
    if (supervisor.ledgerKeyIsPersistent) {
      supervisor.on('ledger:entry', () => saveSupervisorState(supervisor, stateFilePath));
    }

    if (opts.stdio) {
      startStdioServer(supervisor, stateFilePath);
      return;
    }

    if (opts.health) {
      const res = await dispatchRpcMethod(supervisor, 'stenographer.health', {}, stateFilePath);
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      return;
    }

    if (opts.listTools) {
      const res = await dispatchRpcMethod(supervisor, 'stenographer.listTools', {}, stateFilePath);
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      return;
    }

    if (opts.verifyLedger) {
      const res = await dispatchRpcMethod(supervisor, 'stenographer.verifyLedger', {}, stateFilePath);
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      if (!res.valid) {
        process.exitCode = 1;
      }
      return;
    }

    if (opts.query) {
      const res = await dispatchRpcMethod(
        supervisor,
        'stenographer.query',
        { prompt: opts.query, projectRevision: opts.projectRevision },
        stateFilePath
      );
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      return;
    }

    if (opts.propose) {
      const parsed = JSON.parse(opts.propose);
      const res = await dispatchRpcMethod(
        supervisor,
        'stenographer.propose',
        {
          toolName: parsed.toolName || parsed.toolId || parsed.name,
          args: parsed.args || parsed.parameters || {},
          rationale: parsed.rationale || `CLI proposal for ${parsed.toolName || parsed.toolId}`,
          projectRevision: parsed.projectRevision || opts.projectRevision,
          proposedBy: parsed.proposedBy || opts.reviewer
        },
        stateFilePath
      );
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      return;
    }

    if (opts.runTool) {
      const parsedArgs = opts.args ? JSON.parse(opts.args) : {};
      const proposed = await dispatchRpcMethod(
        supervisor,
        'stenographer.propose',
        {
          toolName: opts.runTool,
          args: parsedArgs,
          rationale: `CLI --run-tool ${opts.runTool}`,
          projectRevision: opts.projectRevision,
          proposedBy: opts.reviewer
        },
        stateFilePath
      );

      process.stdout.write(`${JSON.stringify(proposed, null, 2)}\n`);
      return;
    }

    if (opts.approve) {
      const approved = await dispatchRpcMethod(
        supervisor,
        'stenographer.approve',
        {
          proposalId: opts.approve,
          decision: 'approved',
          reviewer: opts.reviewer,
          rationale: opts.rationale
        },
        stateFilePath
      );

      if (opts.execute === opts.approve) {
        const executed = await dispatchRpcMethod(
          supervisor,
          'stenographer.execute',
          { proposalId: opts.execute },
          stateFilePath
        );
        process.stdout.write(`${JSON.stringify({ ...approved, execution: executed.result }, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${JSON.stringify(approved, null, 2)}\n`);
      return;
    }

    if (opts.execute) {
      const executed = await dispatchRpcMethod(
        supervisor,
        'stenographer.execute',
        { proposalId: opts.execute },
        stateFilePath
      );
      process.stdout.write(`${JSON.stringify(executed, null, 2)}\n`);
      return;
    }

    // Default help/status output when no flags are provided
    const health = await dispatchRpcMethod(supervisor, 'stenographer.health', {}, stateFilePath);
    process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: err.message })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgv,
  dispatchRpcMethod,
  startStdioServer
};
