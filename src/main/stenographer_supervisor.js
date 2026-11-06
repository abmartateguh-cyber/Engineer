'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');
const { StenographerClient } = require('../core/contracts/StenographerClient');
const { ToolProposal, ProposalStatus } = require('../core/contracts/ToolProposal');
const { ToolDefinition, ToolApprovalClass } = require('../core/contracts/ToolDefinition');
const { ApprovalRecord, ApprovalDecision } = require('../core/contracts/ApprovalRecord');
const { OmniError, OmniErrorCode } = require('../core/contracts/OmniError');
const { ArtifactRef } = require('../core/contracts/ArtifactRef');
const { JobRequest } = require('../core/contracts/JobRequest');
const { defaultEngineRegistry } = require('../core/contracts/engine_registry');
const { SoftwareSigningAuthority, SignedLedger } = require('../core/security/record_signing');

/**
 * Immutable Engineering Record Ledger Entry (Keyed HMAC-SHA256)
 */
class LedgerEntry {
  constructor({ sequenceNumber, prevHash, type, payload, timestamp, hmacSecret }) {
    this.sequenceNumber = sequenceNumber;
    this.prevHash = prevHash || '0000000000000000000000000000000000000000000000000000000000000000';
    this.type = type; // 'PROMPT' | 'QUERY_RECEIVED' | 'PROPOSAL' | 'APPROVAL' | 'TOOL_RESULT' | 'CRASH' | 'CHECKPOINT'
    this.payload = payload;
    this.timestamp = timestamp || new Date().toISOString();

    if (!hmacSecret) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Ledger signing requires an explicit secret');
    }
    const dataToHash = `${this.sequenceNumber}:${this.prevHash}:${this.type}:${JSON.stringify(this.payload)}:${this.timestamp}`;
    const signature = crypto.createHmac('sha256', hmacSecret).update(dataToHash).digest('hex');
    this.hash = signature;
    this.signature = signature;
    this.algorithm = 'HMAC-SHA256';
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
   * @param {object} [options.registry] - Central EngineRegistry instance
   * @param {boolean} [options.bindRegistry=true] - Whether to auto-bind tools from EngineRegistry
   * @param {string} [options.hmacSecret] - Secret key for HMAC-SHA256 audit ledger
   */
  constructor(options = {}) {
    super();
    this.daemonPath = options.daemonPath || null;
    this.daemonArgs = options.daemonArgs || [];
    this.maxRestarts = options.maxRestarts !== undefined ? options.maxRestarts : 3;
    this.mockMode = options.mockMode === true;
    this.hmacSecret = options.hmacSecret || process.env.OMNI_STENOGRAPHER_HMAC_KEY || crypto.randomBytes(32);
    this.ledgerKeyIsPersistent = Boolean(options.hmacSecret || process.env.OMNI_STENOGRAPHER_HMAC_KEY);
    if (this.ledgerKeyIsPersistent && Buffer.byteLength(this.hmacSecret) < 32) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Persistent ledger key must contain at least 32 bytes');
    }

    this.process = null;
    this.rl = null;
    this.restartCount = 0;
    this.isConnected = false;
    this._connectPromise = null;
    this._restartTimer = null;
    this._disconnecting = false;
    this.proposals = new Map(); // [id] -> ToolProposal
    this.approvals = new Map(); // [id] -> ApprovalRecord
    this.tools = new Map(); // [name] -> ToolDefinition
    this.registry = options.registry || options.engineRegistry || defaultEngineRegistry;

    // Immutable HMAC-SHA256 Hash-Chained Engineering Ledger
    this.ledger = [];
    this.latestHash = '0000000000000000000000000000000000000000000000000000000000000000';

    // Optional local software signing authority (ECDSA P-384 / RSA-4096 SHA-384).
    // Hardware PKCS#11 remains unavailable (CKR_FUNCTION_NOT_SUPPORTED); this is a
    // development/software keystore, not an HSM. The HMAC ledger path is intact.
    this.signingAuthority = options.signingAuthority || null;
    if (!this.signingAuthority && options.enableSoftwareSigning) {
      this.signingAuthority = new SoftwareSigningAuthority({ label: 'development/software keystore' });
    }
    this.signedLedger = this.signingAuthority ? new SignedLedger(this.signingAuthority) : null;

    // Register baseline tools and domain tools
    this._registerDefaultTools();

    if (options.bindRegistry !== false && this.registry) {
      this.bindEngineRegistry(this.registry);
    }
  }

  /**
   * Appends an entry to the cryptographic HMAC-SHA256 hash chain ledger.
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
      timestamp: new Date().toISOString(),
      hmacSecret: this.hmacSecret
    });
    this.ledger.push(entry);
    this.latestHash = entry.hash;
    if (this.signedLedger) {
      const signedEntry = this.signedLedger.append({
        type,
        payload,
        timestamp: entry.timestamp,
        sequenceNumber: entry.sequenceNumber,
        prevHash: entry.prevHash,
        hmacHash: entry.hash
      });
      this.emit('ledger:signed-entry', signedEntry);
    }
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
    if (toolDef.approvalClass === ToolApprovalClass.READ_ONLY && toolDef.modifiesState) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A state-changing tool cannot be read-only');
    }
    this.tools.set(toolDef.name, toolDef);
  }

  /**
   * Returns all registered ToolDefinition schemas as plain objects.
   * @returns {Array<object>}
   */
  getRegisteredTools() {
    return Array.from(this.tools.values()).map((t) => t.toJSON());
  }

  /**
   * Returns copy of the immutable HMAC-SHA256 audit ledger.
   * @returns {Array<LedgerEntry>}
   */
  getAuditLedger() {
    return [...this.ledger];
  }

  /**
   * Resolves or lazy-loads the RoboticsEngineAdapter.
   * @returns {object|null}
   */
  _getOrLoadRoboticsAdapter() {
    if (this.registry && typeof this.registry.hasAdapter === 'function' && this.registry.hasAdapter('robotics')) {
      return this.registry.getAdapter('robotics');
    }
    try {
      const mod = require('../core/robotics/robotics_engine_adapter');
      const AdapterClass = mod.RoboticsEngineAdapter || mod;
      if (typeof AdapterClass === 'function') {
        const instance = new AdapterClass();
        if (this.registry && typeof this.registry.register === 'function') {
          this.registry.register(instance);
        }
        return instance;
      }
    } catch (_) {
      // Robotics adapter module not yet present; fallback will be used
    }
    return null;
  }

  _registerDefaultTools() {
    // This compatibility alias resolves to a registered robotics adapter.
    // Placeholder mesh, CAD, FEA, export, and RCWA entries are not advertised.
    this.registerTool(
      new ToolDefinition({
        name: 'robotics.solve_kinematics',
        description:
          'Solve 6-DOF serial manipulator forward/inverse kinematics and differential Jacobian via RoboticsEngineAdapter',
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        classification: ToolApprovalClass.COMPUTE_JOB,
        parametersSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['forward_kinematics', 'inverse_kinematics', 'inverse_dynamics', 'trajectory_plan', 'parse_urdf']
            },
            jointAnglesRad: { type: 'array', items: { type: 'number' } },
            targetPose: { type: 'object' },
            dhParams: { type: 'array' }
          }
        },
        modifiesState: false,
        estimatedDurationMs: 150
      })
    );
  }

  /**
   * Binds an EngineRegistry instance and discovers all operations across all registered domain adapters,
   * automatically registering them as typed ToolDefinition entries.
   * @param {object} [registry=defaultEngineRegistry]
   */
  bindEngineRegistry(registry = defaultEngineRegistry) {
    this.registry = registry;
    // Ensure robotics adapter is registered if available on disk
    this._getOrLoadRoboticsAdapter();

    const caps = registry.describeAllCapabilities();
    for (const [domain, cap] of Object.entries(caps)) {
      for (const op of cap.supportedOperations || []) {
        // Adapter names do not establish whether an operation is bounded,
        // side-effect-free, or local. Discover them with approval required;
        // only separately reviewed fixed supervisor queries may auto-run.
        let approvalClass = ToolApprovalClass.COMPUTE_JOB;
        if (op.startsWith('export_') || op.startsWith('serialize_') || op.includes('write_')) {
          approvalClass = ToolApprovalClass.EXPORT_OVERWRITE;
        } else if (
          op.startsWith('create_') ||
          op.startsWith('mutate_') ||
          op.startsWith('apply_') ||
          op.startsWith('heal_') ||
          op.startsWith('set_') ||
          op.startsWith('validate_')
        ) {
          approvalClass = ToolApprovalClass.MUTATION_PREVIEW;
        } else if (
          op.startsWith('solve_') ||
          op.startsWith('simulate_') ||
          op.startsWith('calculate_') ||
          op.startsWith('estimate_') ||
          op.startsWith('trace_') ||
          op.startsWith('synthesize_') ||
          op.startsWith('partition_') ||
          op.startsWith('run_') ||
          op.startsWith('extract_') ||
          op.startsWith('plan_') ||
          op.startsWith('execute_') ||
          op.startsWith('characterize_') ||
          op.startsWith('compute_') ||
          op.startsWith('generate_')
        ) {
          approvalClass = ToolApprovalClass.COMPUTE_JOB;
        }

        const domainToolName = `${domain}.${op}`;
        this.registerTool(
          new ToolDefinition({
            name: domainToolName,
            description: `${domain.toUpperCase()} operation: ${op}`,
            approvalClass,
            classification: approvalClass,
            modifiesState: approvalClass === ToolApprovalClass.MUTATION_PREVIEW,
            autoRun: approvalClass === ToolApprovalClass.READ_ONLY
          })
        );
        if (!this.tools.has(op)) {
          this.registerTool(
            new ToolDefinition({
              name: op,
              description: `${domain.toUpperCase()} operation: ${op}`,
              approvalClass,
              classification: approvalClass,
              modifiesState: approvalClass === ToolApprovalClass.MUTATION_PREVIEW,
              autoRun: approvalClass === ToolApprovalClass.READ_ONLY
            })
          );
        }
      }
    }
  }

  /**
   * Registers a typed ToolProposal in the supervisor and appends it to the HMAC ledger.
   * @param {ToolProposal|object} proposalInput
   * @returns {ToolProposal}
   */
  proposeToolCall(proposalInput = {}) {
    let proposal;
    if (proposalInput instanceof ToolProposal) {
      proposal = proposalInput;
    } else if (proposalInput && typeof proposalInput === 'object') {
      const toolName = proposalInput.toolName || proposalInput.tool || proposalInput.name;
      if (!toolName || typeof toolName !== 'string') {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'proposeToolCall requires a valid toolName');
      }
      const toolDef = this.tools.get(toolName);
      if (!toolDef) {
        throw new OmniError(OmniErrorCode.UNSUPPORTED, `Unregistered Stenographer tool: ${toolName}`);
      }
      const requestedClass = proposalInput.approvalClass || proposalInput.classification;
      if (requestedClass && requestedClass !== toolDef.approvalClass) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `Approval class for ${toolName} must be ${toolDef.approvalClass}`
        );
      }
      if (
        !Number.isSafeInteger(proposalInput.originatingProjectRevision) ||
        proposalInput.originatingProjectRevision < 1
      ) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A current project revision is required for tool proposals');
      }
      const rawClass = toolDef.approvalClass;
      const args = proposalInput.args || proposalInput.parameters || {};
      const expectedMutations = Array.isArray(proposalInput.expectedMutations)
        ? proposalInput.expectedMutations
        : rawClass === ToolApprovalClass.READ_ONLY
          ? []
          : [`Execute governed tool ${toolName}`];

      proposal = new ToolProposal({
        proposalId: proposalInput.proposalId || proposalInput.id,
        toolName,
        args,
        expectedMutations,
        approvalClass: rawClass,
        idempotencyKey: proposalInput.idempotencyKey,
        originatingProjectRevision: proposalInput.originatingProjectRevision,
        originatingProjectId: proposalInput.originatingProjectId,
        reasoning: proposalInput.reasoning || (toolDef ? toolDef.description : `Proposed execution of ${toolName}`),
        costEstimate: proposalInput.costEstimate || { estimatedDurationMs: toolDef ? toolDef.estimatedDurationMs : 150 }
      });
    } else {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid proposal input');
    }

    const registeredTool = this.tools.get(proposal.toolName);
    if (!registeredTool || proposal.approvalClass !== registeredTool.approvalClass) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Proposal must match a registered tool approval class');
    }
    if (!Number.isSafeInteger(proposal.originatingProjectRevision) || proposal.originatingProjectRevision < 1) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A current project revision is required for tool proposals');
    }
    if (this.proposals.has(proposal.id)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Duplicate Stenographer proposal ID: ${proposal.id}`);
    }
    if (Array.from(this.proposals.values()).some((existing) => existing.idempotencyKey === proposal.idempotencyKey)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Duplicate Stenographer idempotency key');
    }

    if (proposal.canAutoRun()) {
      const autoApproval = new ApprovalRecord({
        proposalId: proposal.id,
        decision: ApprovalDecision.APPROVED,
        approvedBy: 'SYSTEM_AUTO_READ_ONLY',
        reason: 'Auto-approved READ_ONLY tool'
      });
      proposal.approve(autoApproval);
    }

    this.proposals.set(proposal.id, proposal);
    this._appendLedger('PROPOSAL', {
      ...proposal.toJSON(),
      status: proposal.status
    });
    return proposal;
  }

  /**
   * Natural-language & structured query handler governed by Stenographer.
   * - Logs incoming query to the HMAC ledger (QUERY_RECEIVED).
   * - Executes read-only diagnostic queries (list tools, verify ledger, project status, domain capabilities) automatically.
   * - Generates a typed ToolProposal (via proposeToolCall) for engineering mutation/compute intents.
   * - Labels local proposal routing separately from the OmniAI legacy macro adapter.
   *
   * @param {object|string} input
   * @returns {object}
   */
  processQuery(input = {}) {
    const rawPrompt = typeof input === 'string' ? input : String(input?.prompt || '');
    const projectRevision = typeof input === 'object' && input !== null ? input.projectRevision : null;
    const projectId = typeof input === 'object' && input !== null ? input.projectId || null : null;
    const numericRevision =
      Number.isSafeInteger(projectRevision) && projectRevision >= 1
        ? projectRevision
        : typeof projectRevision === 'string' && /^[1-9]\d*$/.test(projectRevision)
          ? Number(projectRevision)
          : null;
    const context = typeof input === 'object' && input !== null ? input.context || {} : {};

    const ledgerEntry = this._appendLedger('QUERY_RECEIVED', {
      prompt: rawPrompt,
      projectRevision,
      projectId,
      context
    });

    const p = rawPrompt.toLowerCase().trim();

    // 1. Read-Only Diagnostic Queries (auto-executed without mutation approval)
    if (
      p === 'list tools' ||
      p.includes('list tools') ||
      p.includes('available tools') ||
      p.includes('registered tools')
    ) {
      const tools = this.getRegisteredTools();
      return {
        success: true,
        status: 'success',
        mode: 'stenographer-readonly',
        classification: ToolApprovalClass.READ_ONLY,
        requiresApproval: false,
        queryType: 'list_tools',
        prompt: rawPrompt,
        projectRevision,
        tools,
        data: { tools, count: tools.length },
        assistantMessage: `Stenographer has ${tools.length} governed engineering tools registered across all domains.`,
        text: `Stenographer has ${tools.length} governed engineering tools registered across all domains.`,
        proposal: null,
        proposals: [],
        ledgerEntry
      };
    }

    if (
      p === 'verify ledger' ||
      p.includes('verify ledger') ||
      p.includes('ledger integrity') ||
      p.includes('audit ledger')
    ) {
      const integrity = this.verifyLedgerIntegrity();
      return {
        success: true,
        status: 'success',
        mode: 'stenographer-readonly',
        classification: ToolApprovalClass.READ_ONLY,
        requiresApproval: false,
        queryType: 'verify_ledger',
        prompt: rawPrompt,
        projectRevision,
        integrity,
        data: integrity,
        assistantMessage: `Cryptographic HMAC-SHA256 ledger verification: ${integrity.valid ? 'VALID' : 'TAMPERED'} (${integrity.entriesCount} entries).`,
        text: `Cryptographic HMAC-SHA256 ledger verification: ${integrity.valid ? 'VALID' : 'TAMPERED'} (${integrity.entriesCount} entries).`,
        proposal: null,
        proposals: [],
        ledgerEntry
      };
    }

    if (
      p === 'project status' ||
      p.includes('project status') ||
      p.includes('project summary') ||
      p.includes('session status')
    ) {
      let projectStatus = context.projectSummary || null;
      if (!projectStatus) {
        try {
          const { activeProjectManager } = require('../core/storage/project_manager');
          if (activeProjectManager && activeProjectManager.hasActiveProject()) {
            projectStatus = activeProjectManager.getSummary();
          }
        } catch (_) {}
      }
      return {
        success: true,
        status: 'success',
        mode: 'stenographer-readonly',
        classification: ToolApprovalClass.READ_ONLY,
        requiresApproval: false,
        queryType: 'project_status',
        prompt: rawPrompt,
        projectRevision,
        projectStatus,
        data: { projectStatus, projectRevision },
        assistantMessage: `Active project status retrieved (revision: ${projectStatus?.revision ?? projectRevision}).`,
        text: `Active project status retrieved (revision: ${projectStatus?.revision ?? projectRevision}).`,
        proposal: null,
        proposals: [],
        ledgerEntry
      };
    }

    if (
      p === 'domain capabilities' ||
      p.includes('domain capabilities') ||
      p.includes('list domains') ||
      p.includes('registered domains')
    ) {
      this._getOrLoadRoboticsAdapter();
      const capabilities = this.registry ? this.registry.describeAllCapabilities() : {};
      const domains = Object.keys(capabilities);
      return {
        success: true,
        status: 'success',
        mode: 'stenographer-readonly',
        classification: ToolApprovalClass.READ_ONLY,
        requiresApproval: false,
        queryType: 'domain_capabilities',
        prompt: rawPrompt,
        projectRevision,
        capabilities,
        domains,
        data: { domains, capabilities },
        assistantMessage: `Registered engineering domains (${domains.length}): ${domains.join(', ')}.`,
        text: `Registered engineering domains (${domains.length}): ${domains.join(', ')}.`,
        proposal: null,
        proposals: [],
        ledgerEntry
      };
    }

    // 2. Governed Engineering Mutation / Compute Intents -> Generate typed ToolProposal
    let proposedSpec = null;

    if (
      p.includes('robotics') ||
      p.includes('kinematics') ||
      p.includes('manipulator') ||
      p.includes('urdf') ||
      p.includes('6-dof') ||
      p.includes('6dof') ||
      p.includes('jacobian')
    ) {
      const op =
        p.includes('inverse') && p.includes('dynamics')
          ? 'inverse_dynamics'
          : p.includes('inverse')
            ? 'inverse_kinematics'
            : p.includes('trajectory')
              ? 'trajectory_plan'
              : p.includes('urdf')
                ? 'parse_urdf'
                : 'forward_kinematics';
      proposedSpec = {
        toolName: 'robotics.solve_kinematics',
        args: { operation: op, ...(context.args || {}) },
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: [`Execute 6-DOF robotics ${op} calculation`],
        reasoning: `Governed RoboticsEngineAdapter ${op} solve for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('steam') ||
      p.includes('iapws') ||
      p.includes('if97') ||
      p.includes('water properties') ||
      p.includes('superheated')
    ) {
      const mpaMatch = rawPrompt.match(/(\d+(?:\.\d+)?)\s*mpa/i);
      const tempMatch = rawPrompt.match(/(\d+(?:\.\d+)?)\s*k\b/i);
      const parsedArgs = { ...(context.args || {}) };
      if (mpaMatch) parsedArgs.pressurePa = Number(mpaMatch[1]) * 1e6;
      if (tempMatch) parsedArgs.temperatureK = Number(tempMatch[1]);
      proposedSpec = {
        toolName: 'plant.calculate_steam_properties',
        args: parsedArgs,
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: ['Evaluate caller-supplied IAPWS-IF97 steam state'],
        reasoning: `Governed IAPWS-IF97 thermodynamic formulation evaluation for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('rcwa') ||
      p.includes('grating') ||
      p.includes('diffraction') ||
      p.includes('polarization') ||
      p.includes('optics') ||
      p.includes('lens')
    ) {
      const isRcwa = p.includes('rcwa') || p.includes('grating');
      proposedSpec = {
        toolName: isRcwa ? 'optics.solve_rcwa_grating' : 'optics.trace_polarization',
        args: context.args || {},
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: [isRcwa ? 'Evaluate RCWA diffraction grating orders' : 'Trace polarization ray state'],
        reasoning: `Governed optical solver execution for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('verilog') ||
      p.includes('systemverilog') ||
      p.includes('rtl') ||
      p.includes('synthesize') ||
      p.includes('synthesis') ||
      p.includes('eda') ||
      p.includes('drc') ||
      p.includes('spice')
    ) {
      proposedSpec = {
        toolName: 'eda.synthesize_logic',
        args: context.args || {},
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: ['Synthesize RTL netlist and gate-level graph'],
        reasoning: `Governed EDA RTL logic synthesis for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('bom') ||
      p.includes('ebom') ||
      p.includes('bill of materials') ||
      p.includes('pdm') ||
      p.includes('rollup')
    ) {
      proposedSpec = {
        toolName: 'pdm.compute_bom_rollup',
        args: context.args || {},
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: ['Compute hierarchical eBOM mass and cost rollup'],
        reasoning: `Governed PDM BOM rollup for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('cfd') ||
      p.includes('navier-stokes') ||
      p.includes('navier stokes') ||
      p.includes('fvm') ||
      p.includes('fluid flow') ||
      p.includes('aerodynamic')
    ) {
      proposedSpec = {
        toolName: 'cfd.fvm_navier_stokes_3d',
        args: context.args || {},
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: ['Dispatch 3D FVM Navier-Stokes CFD solver'],
        reasoning: `Governed 3D FVM Navier-Stokes CFD calculation for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('extrude') ||
      p.includes('fillet') ||
      p.includes('chamfer') ||
      p.includes('revolve') ||
      p.includes('nurbs') ||
      p.includes('cad') ||
      p.includes('modify')
    ) {
      const mmMatch = rawPrompt.match(/(\d+(?:\.\d+)?)\s*mm/i);
      const parsedArgs = { ...(context.args || {}) };
      if (mmMatch) parsedArgs.value = Number(mmMatch[1]);
      proposedSpec = {
        toolName: 'mutate_geometry_parameter',
        args: parsedArgs,
        approvalClass: ToolApprovalClass.MUTATION_PREVIEW,
        expectedMutations: ['Mutate the explicitly selected CAD feature parameter'],
        reasoning: `Governed CAD geometry parameter mutation for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('fea') ||
      p.includes('structural') ||
      p.includes('plasticity') ||
      p.includes('stress') ||
      p.includes('drop test') ||
      p.includes('drop') ||
      p.includes('thermal') ||
      p.includes('solve')
    ) {
      proposedSpec = {
        toolName: 'execute_fea_solve',
        args: context.args || {},
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: ['Dispatch 3D structural FEA solver'],
        reasoning: `Governed 3D structural FEA calculation for prompt: "${rawPrompt}"`
      };
    } else if (
      p.includes('rocket') ||
      p.includes('nozzle') ||
      p.includes('orbital') ||
      p.includes('propulsion') ||
      p.includes('aerospace')
    ) {
      proposedSpec = {
        toolName: 'aerospace.calculate_engine_performance',
        args: context.args || {},
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: ['Compute liquid rocket engine chamber & nozzle performance'],
        reasoning: `Governed AerospaceEngineAdapter calculation for prompt: "${rawPrompt}"`
      };
    } else if (p.includes('piping') || p.includes('distillation') || p.includes('flash') || p.includes('plant')) {
      proposedSpec = {
        toolName: 'plant.calculate_steam_properties',
        args: context.args || {},
        approvalClass: ToolApprovalClass.COMPUTE_JOB,
        expectedMutations: ['Evaluate plant thermodynamic process state'],
        reasoning: `Governed PlantEngineAdapter evaluation for prompt: "${rawPrompt}"`
      };
    }

    if (proposedSpec && !this.tools.has(proposedSpec.toolName)) {
      const assistantMessage = `The requested ${proposedSpec.toolName} operation is unavailable. No calculation was run.`;
      return {
        success: false,
        status: 'UNAVAILABLE',
        mode: 'stenographer-unavailable',
        prompt: rawPrompt,
        projectRevision,
        assistantMessage,
        text: assistantMessage,
        proposal: null,
        proposals: [],
        ledgerEntry
      };
    }

    if (proposedSpec && !Number.isSafeInteger(numericRevision)) {
      return {
        success: false,
        status: 'INPUT_REQUIRED',
        mode: 'stenographer-input-required',
        prompt: rawPrompt,
        projectRevision,
        assistantMessage: 'Open a project with a current revision before proposing an engineering action.',
        proposals: [],
        proposal: null,
        ledgerEntry
      };
    }

    if (proposedSpec) {
      const proposal = this.proposeToolCall({
        ...proposedSpec,
        originatingProjectRevision: numericRevision,
        originatingProjectId: projectId
      });
      const proposalRecord = {
        ...proposal.toJSON(),
        id: proposal.id,
        proposalId: proposal.proposalId || proposal.id,
        projectRevision,
        status: proposal.canAutoRun() ? 'APPROVED' : 'PENDING',
        proposalStatus: proposal.status,
        requiresApproval: proposal.requiresApproval
      };
      const assistantMessage = `Local Stenographer gateway proposed tool "${proposal.toolName}" (${proposal.approvalClass}) for review.`;
      return {
        success: true,
        status: 'PROPOSAL_CREATED',
        mode: 'stenographer-proposal',
        requiresApproval: proposal.requiresApproval,
        prompt: rawPrompt,
        projectRevision,
        proposalId: proposal.proposalId || proposal.id,
        proposal: proposalRecord,
        proposals: [proposal],
        assistantMessage,
        text: assistantMessage,
        matchedTool: proposal.toolName,
        modalToOpen: null,
        suggestedManualEdits: [],
        ledgerEntry
      };
    }

    // The standalone OmniAI legacy macro has a separate IPC route. A
    // Stenographer query never executes it as a hidden fallback.
    const assistantMessage = 'No governed engineering tool matched this request. No calculation was run.';
    return {
      success: false,
      status: 'UNAVAILABLE',
      mode: 'stenographer-unavailable',
      requiresApproval: false,
      prompt: rawPrompt,
      projectRevision,
      matchedTool: null,
      toolInput: null,
      result: null,
      modalToOpen: null,
      suggestedManualEdits: [],
      assistantMessage,
      text: assistantMessage,
      proposal: null,
      proposals: [],
      ledgerEntry
    };
  }

  /**
   * Connects to or spawns the daemon process.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isConnected) return;
    if (this._connectPromise) return this._connectPromise;

    if (this.mockMode) {
      this._disconnecting = false;
      this.isConnected = true;
      this._appendLedger('CHECKPOINT', { status: 'connected', mode: 'in-process' });
      return;
    }
    if (!this.daemonPath) {
      throw new OmniError(OmniErrorCode.UNSUPPORTED, 'Stenographer daemon is not configured');
    }

    this._disconnecting = false;
    this._connectPromise = new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(this.daemonPath, this.daemonArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, STENOGRAPHER_SUPERVISED: '1' }
        });

        const lines = readline.createInterface({
          input: child.stdout,
          crlfDelay: Infinity
        });
        lines.on('line', (line) => this._handleDaemonLine(line));
        child.stderr.on('data', (data) => {
          this.emit('daemon:stderr', data.toString());
        });
        child.once('error', (error) => {
          lines.close();
          if (this.process === child) {
            this.process = null;
            this.rl = null;
            this.isConnected = false;
          }
          reject(new OmniError(OmniErrorCode.INTERNAL, `Failed to spawn daemon: ${error.message}`));
        });
        child.once('exit', (code, signal) => this._handleDaemonExit(child, code, signal));
        child.once('spawn', () => {
          if (this._disconnecting) {
            child.kill('SIGTERM');
            reject(new OmniError(OmniErrorCode.CANCELLED, 'Daemon connection was cancelled'));
            return;
          }
          this.process = child;
          this.rl = lines;
          this.isConnected = true;
          this._appendLedger('CHECKPOINT', { status: 'spawned', pid: child.pid });
          resolve();
        });
      } catch (err) {
        reject(new OmniError(OmniErrorCode.INTERNAL, `Failed to spawn daemon: ${err.message}`));
      }
    }).finally(() => {
      this._connectPromise = null;
    });
    return this._connectPromise;
  }

  /**
   * Disconnects daemon and releases resources.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._disconnecting = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._connectPromise) await this._connectPromise.catch(() => {});
    this.isConnected = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    const child = this.process;
    this.process = null;
    if (child) child.kill('SIGTERM');
    this._appendLedger('CHECKPOINT', { status: 'disconnected' });
  }

  /**
   * Handles unexpected daemon termination and restarts supervisor up to maxRestarts.
   * @private
   */
  _handleDaemonExit(child, code, signal) {
    if (this.process !== child || this._disconnecting) return;
    this.isConnected = false;
    this.process = null;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this._appendLedger('CRASH', { code, signal, restartCount: this.restartCount });
    this._scheduleRestart();
  }

  _scheduleRestart() {
    if (this._disconnecting || this._restartTimer) return;
    if (this.restartCount < this.maxRestarts) {
      this.restartCount++;
      this.emit('daemon:restarting', { attempt: this.restartCount });
      this._restartTimer = setTimeout(() => {
        this._restartTimer = null;
        if (this._disconnecting) return;
        this.connect().catch((err) => {
          this.emit('daemon:error', err);
          this._scheduleRestart();
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
   * The daemon-facing client query is unavailable until a versioned transport
   * has authenticated its response. The legacy macro path is processQuery().
   */
  async query() {
    throw new OmniError(
      OmniErrorCode.UNSUPPORTED,
      'Stenographer daemon query transport is unavailable; use the labeled legacy macro adapter'
    );
  }

  /**
   * Retrieves a proposal by ID.
   * @param {string} proposalId
   * @returns {ToolProposal|null}
   */
  getProposal(proposalId) {
    return this.proposals.get(proposalId) || null;
  }

  /**
   * Evaluates and approves or rejects a tool proposal.
   * Supports:
   * - evaluateProposal({ proposalId, decision, decidedBy, rationale })
   * - evaluateProposal(proposalId, 'APPROVED'|'REJECTED', reason, approvedBy)
   * - evaluateProposal(proposalId, booleanApproved, reviewerId, reason)
   * @param {string|object} proposalIdOrPayload
   * @param {string|boolean} [decisionOrApproved]
   * @param {string} [thirdArg='']
   * @param {string} [fourthArg='lead_engineer']
   * @returns {ApprovalRecord}
   */
  evaluateProposal(proposalIdOrPayload, decisionOrApproved, thirdArg = '', fourthArg = 'lead_engineer') {
    let proposalId = proposalIdOrPayload;
    let rawDecision = decisionOrApproved;
    let third = thirdArg;
    let fourth = fourthArg;

    if (proposalIdOrPayload && typeof proposalIdOrPayload === 'object') {
      proposalId = proposalIdOrPayload.proposalId || proposalIdOrPayload.id;
      rawDecision =
        proposalIdOrPayload.decision !== undefined ? proposalIdOrPayload.decision : proposalIdOrPayload.approved;
      third = proposalIdOrPayload.rationale || proposalIdOrPayload.reason || proposalIdOrPayload.comment || '';
      fourth =
        proposalIdOrPayload.decidedBy ||
        proposalIdOrPayload.reviewer ||
        proposalIdOrPayload.approvedBy ||
        'lead_engineer';
    }

    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `No tool proposal found with ID: ${proposalId}`);
    }
    if (proposal.status !== ProposalStatus.PROPOSED) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `Proposal is no longer pending: ${proposal.status}`);
    }

    let decision;
    let reason;
    let approvedBy;

    if (typeof rawDecision === 'boolean') {
      decision = rawDecision ? ApprovalDecision.APPROVED : ApprovalDecision.REJECTED;
      approvedBy = third || 'lead_engineer';
      reason = typeof fourth === 'string' && fourth !== 'lead_engineer' ? fourth : '';
    } else {
      const norm = String(rawDecision || '').toUpperCase();
      if (norm === 'APPROVED' || norm === 'TRUE') {
        decision = ApprovalDecision.APPROVED;
      } else if (norm === 'REJECTED' || norm === 'FALSE') {
        decision = ApprovalDecision.REJECTED;
      } else {
        decision = rawDecision;
      }
      reason = third || '';
      approvedBy = fourth || 'lead_engineer';
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

    this.approvals.set(proposalId, approval);
    this._appendLedger('APPROVAL', approval.toJSON());
    return approval;
  }

  /**
   * Alias for executeTool used by IPC and CLI gateways.
   * @param {string} proposalId
   * @param {Function} [executor]
   * @returns {Promise<object>}
   */
  async executeApprovedTool(proposalId, executor = null) {
    return this.executeTool(proposalId, executor);
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
    const toolDef = this.tools.get(proposal.toolName);
    if (!toolDef || proposal.approvalClass !== toolDef.approvalClass) {
      throw new OmniError(OmniErrorCode.UNSUPPORTED, 'Tool is unregistered or its approval class changed');
    }

    // Fail-Closed Security Gate:
    // If tool requires approval and is not approved, fail immediately.
    if (
      proposal.status !== ProposalStatus.APPROVED &&
      !(proposal.canAutoRun() && proposal.status === ProposalStatus.PROPOSED)
    ) {
      throw new OmniError(
        OmniErrorCode.UNSUPPORTED,
        `Fail-closed gate: Tool "${proposal.toolName}" requires explicit engineer approval before execution (status: ${proposal.status})`
      );
    }

    proposal.markExecuting();

    try {
      this._appendLedger('TOOL_STARTED', {
        proposalId,
        toolName: proposal.toolName,
        idempotencyKey: proposal.idempotencyKey,
        originatingProjectRevision: proposal.originatingProjectRevision,
        originatingProjectId: proposal.originatingProjectId
      });
      let resultData;
      let jobResultObj = null;

      if (typeof executor === 'function') {
        resultData = await executor(proposal.parameters);
      } else if (proposal.toolName === 'robotics.solve_kinematics' || proposal.toolName.startsWith('robotics.')) {
        const roboticsAdapter = this._getOrLoadRoboticsAdapter();
        const rawOp = proposal.toolName.includes('.')
          ? proposal.toolName.split('.').slice(1).join('.')
          : proposal.toolName;
        const params = { ...(proposal.parameters || {}) };
        if (roboticsAdapter) {
          const supported = roboticsAdapter.describeCapabilities?.()?.supportedOperations || [];
          const resolvedOp = rawOp === 'solve_kinematics' ? params.operation : rawOp;
          if (!supported.includes(resolvedOp)) {
            throw new OmniError(
              OmniErrorCode.UNSUPPORTED,
              `Unsupported robotics operation: ${resolvedOp || 'missing'}`
            );
          }
          const jobReq = new JobRequest({
            jobId: `steno_${proposal.id}`,
            domain: 'robotics',
            operation: resolvedOp,
            parameters: params
          });
          jobResultObj = await roboticsAdapter.execute(jobReq);
          resultData = jobResultObj.outputData;
        } else {
          throw new OmniError(OmniErrorCode.UNSUPPORTED, 'Robotics adapter is unavailable');
        }
      } else if (proposal.toolName === 'optics.solve_rcwa_grating') {
        throw new OmniError(OmniErrorCode.UNSUPPORTED, 'RCWA grating solver is unavailable pending validation');
      } else if (this.registry) {
        let domain = null;
        let operation = proposal.toolName;
        if (proposal.toolName.includes('.')) {
          const parts = proposal.toolName.split('.');
          domain = parts[0];
          operation = parts.slice(1).join('.');
        } else {
          for (const d of this.registry.listRegisteredDomains()) {
            const adapter = this.registry.getAdapter(d);
            if (adapter.describeCapabilities().supportedOperations.includes(operation)) {
              domain = d;
              break;
            }
          }
        }
        if (domain && this.registry.hasAdapter(domain)) {
          const params = { ...(proposal.parameters || {}) };
          if (domain === 'plant' && operation === 'calculate_steam_properties') {
            if (params.pressurePa === undefined && Number.isFinite(params.pressureMPa)) {
              params.pressurePa = params.pressureMPa * 1e6;
            }
          }
          const jobReq = new JobRequest({
            jobId: `steno_${proposal.id}`,
            domain,
            operation,
            parameters: params
          });
          jobResultObj = await this.registry.dispatch(jobReq);
          resultData = jobResultObj.outputData;
        } else {
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `No execution adapter for ${proposal.toolName}`);
        }
      } else {
        throw new OmniError(OmniErrorCode.UNSUPPORTED, `No execution adapter for ${proposal.toolName}`);
      }

      if (jobResultObj && jobResultObj.status !== 'COMPLETED') {
        throw new OmniError(
          OmniErrorCode.NUMERICAL_FAILURE,
          `Engineering job did not complete: ${jobResultObj.error?.message || jobResultObj.status}`
        );
      }

      proposal.markExecuted(resultData);

      // Hash result artifact for audit integrity
      const artifactRef = ArtifactRef.fromContent(Buffer.from(JSON.stringify(resultData), 'utf8'), {
        mimeType: 'application/json',
        name: `result_${proposal.toolName}`
      });

      const ledgerEntry = this._appendLedger('TOOL_RESULT', {
        proposalId,
        toolName: proposal.toolName,
        artifactHash: artifactRef.hash,
        result: resultData
      });

      return {
        success: true,
        status: 'success',
        proposalId,
        toolName: proposal.toolName,
        artifactRef,
        jobResult: jobResultObj ? jobResultObj.toJSON() : null,
        result: resultData,
        ledgerEntry
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
      pid: this.process ? this.process.pid : this.mockMode && this.isConnected ? process.pid : null,
      ledgerSize: this.ledger.length,
      latestHash: this.latestHash,
      ledgerKeyPersistence: this.ledgerKeyIsPersistent ? 'configured' : 'session-only',
      signedLedgerSize: this.signedLedger ? this.signedLedger.entries.length : 0,
      signingAuthority: this.signingAuthority ? this.signingAuthority.describe() : { status: 'disabled' },
      hardwarePkcs11: {
        status: 'unavailable',
        error: 'No hardware signing provider is configured (CKR_FUNCTION_NOT_SUPPORTED)'
      },
      restartCount: this.restartCount
    };
  }

  /**
   * Verifies the cryptographic HMAC-SHA256 integrity of the entire ledger chain.
   * @returns {{ valid: boolean, entriesCount: number, entryCount: number, algorithm: string, error?: string }}
   */
  verifyLedgerIntegrity() {
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    for (let i = 0; i < this.ledger.length; i++) {
      const entry = this.ledger[i];
      if (!entry || entry.sequenceNumber !== i + 1) {
        return {
          valid: false,
          entriesCount: i,
          entryCount: i,
          tamperedIndex: i,
          algorithm: 'HMAC-SHA256',
          error: `Invalid sequence number at ${i + 1}`
        };
      }
      if (entry.prevHash !== prevHash) {
        return {
          valid: false,
          entriesCount: i,
          entryCount: i,
          tamperedIndex: i,
          algorithm: 'HMAC-SHA256',
          error: `Broken prevHash link at entry ${i + 1}`
        };
      }
      const expectedData = `${entry.sequenceNumber}:${entry.prevHash}:${entry.type}:${JSON.stringify(entry.payload)}:${entry.timestamp}`;
      const expectedSignature = crypto.createHmac('sha256', this.hmacSecret).update(expectedData).digest('hex');
      const actualSig = entry.signature || entry.hash;
      if (actualSig !== expectedSignature || entry.hash !== expectedSignature) {
        return {
          valid: false,
          entriesCount: i,
          entryCount: i,
          tamperedIndex: i,
          algorithm: 'HMAC-SHA256',
          error: `HMAC-SHA256 signature mismatch at entry ${i + 1}`
        };
      }
      prevHash = entry.hash;
    }
    if (this.latestHash !== prevHash) {
      return {
        valid: false,
        entriesCount: this.ledger.length,
        entryCount: this.ledger.length,
        algorithm: 'HMAC-SHA256',
        error: 'Ledger head does not match its final signed entry'
      };
    }
    return {
      valid: true,
      entriesCount: this.ledger.length,
      entryCount: this.ledger.length,
      algorithm: 'HMAC-SHA256',
      latestHash: this.latestHash,
      latestSignature: this.latestHash
    };
  }

  /**
   * Returns a copy of the signed (ECDSA/RSA + SHA-384) hash-chain ledger,
   * or an empty array when no software signing authority is configured.
   * @returns {Array<object>}
   */
  getSignedAuditLedger() {
    return this.signedLedger ? this.signedLedger.getEntries() : [];
  }

  /**
   * Verifies the entire signed ledger: canonical record hashes, detached
   * signatures, and hash-chain linkage (each entry digests the previous).
   * @returns {{ valid: boolean, entriesCount: number, firstFailureIndex?: number, error?: string }}
   */
  verifySignedLedgerIntegrity() {
    if (!this.signedLedger) {
      return { valid: false, entriesCount: 0, error: 'Signed ledger is not enabled on this supervisor' };
    }
    return this.signedLedger.verifyChain();
  }
}

module.exports = {
  StenographerSupervisor,
  LedgerEntry
};
