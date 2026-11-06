'use strict';

// Development-harness preflight only. No inference, credentials on stdout, or product mutation.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'opencode.industrial.json');
const PLAN_PATH = path.join(ROOT, 'docs/industrialization/mercury_inception/workstreams.json');
const SCHEMA_URL = 'https://opencode.ai/config.json';
const INCEPTION_CATALOG = 'https://api.inceptionlabs.ai/v1/models';
const PROVIDER_ID = 'inception-direct';
const MODEL_ID = 'mercury-3';
const WORKER_MODEL = `${PROVIDER_ID}/${MODEL_ID}#high`;
const SUPERVISOR_MODEL = `${PROVIDER_ID}/${MODEL_ID}#high`;
const ENDPOINT = 'https://api.inceptionlabs.ai/v1';
const RUNTIME = '@opencode/ai/providers/openai-compatible';
const CREDENTIAL = 'INCEPTION_API_KEY';

function loadConfiguration() {
  return {
    config: JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')),
    manifest: JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'))
  };
}

/** Check the campaign's routing contract: direct Inception Mercury only. */
function validateConfiguration(config, manifest, root = ROOT) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const providers = config.providers || {};
  const inception = providers[PROVIDER_ID] || {};
  const model = inception.models?.[MODEL_ID] || {};
  const agents = config.agents || {};

  check(config.$schema === SCHEMA_URL, 'The published OpenCode config schema must be declared.');
  check(config.default_agent === 'mercury-industrial-supervisor', 'The default agent must be the Mercury supervisor.');
  check(
    config.model === `${PROVIDER_ID}/${MODEL_ID}`,
    'The root model must be the explicitly pinned Inception Mercury 3 route.'
  );
  check(config.share === 'disabled' && config.warming === false, 'Sharing and paid idle warming must remain disabled.');
  check(
    Object.keys(providers).length === 1 && providers[PROVIDER_ID],
    'Exactly one provider may be defined: Inception direct. No other provider is permitted.'
  );
  check(inception.settings?.baseURL === ENDPOINT, `${PROVIDER_ID}: endpoint must be the Inception API exactly.`);
  check(
    inception.settings?.apiKey === `{env:${CREDENTIAL}}`,
    `${PROVIDER_ID}: credentials must reference ${CREDENTIAL}.`
  );
  check(
    JSON.stringify(inception.env) === JSON.stringify([CREDENTIAL]),
    `${PROVIDER_ID}: credential environment list must not contain fallback keys.`
  );
  check(inception.package === RUNTIME, `${PROVIDER_ID}: use the verified V2 OpenAI-compatible runtime.`);
  check(!inception.canonical, `${PROVIDER_ID}: do not inherit an unrelated provider catalog or credentials.`);
  check(!inception.headers?.Authorization, `${PROVIDER_ID}: authorization must not be embedded in config headers.`);
  check(
    inception.settings?.transport === 'http' && inception.settings?.encoding === 'none',
    `${PROVIDER_ID}: use the documented HTTP JSON endpoint.`
  );
  check(Object.keys(inception.models || {}).length === 1, `${PROVIDER_ID}: unexpected alternative model definition.`);
  check(model.modelID === MODEL_ID, `The model ID must be ${MODEL_ID}.`);
  check(
    model.capabilities?.tools === true &&
      model.capabilities?.reasoning?.supported === true &&
      model.capabilities?.reasoning?.effort?.includes('high') &&
      JSON.stringify(model.capabilities?.input) === JSON.stringify(['text']),
    'Mercury must explicitly declare tools, High reasoning, and its actual text-only modality.'
  );
  check(model.body?.reasoning_effort === 'high', 'The active model body must request reasoning_effort=high.');
  const variants = Array.isArray(model.variants) ? model.variants : [];
  check(
    variants.length === 1 && variants[0]?.id === 'high' && variants[0]?.body?.reasoning_effort === 'high',
    'Exactly one high-reasoning variant is required.'
  );

  const expectedAgents = {
    'mercury-industrial-supervisor': [SUPERVISOR_MODEL, 'primary'],
    'mercury-industrial-corrector': [SUPERVISOR_MODEL, 'subagent'],
    'mercury-industrial-worker': [WORKER_MODEL, 'subagent'],
    'mercury-industrial-reviewer': [WORKER_MODEL, 'subagent']
  };
  for (const [name, [modelRef, mode]] of Object.entries(expectedAgents)) {
    const agent = agents[name] || {};
    check(
      agent.model === modelRef && agent.mode === mode,
      `${name}: explicit provider/model/variant and mode are required.`
    );
    const reference =
      typeof agent.system === 'string' && agent.system.match(/^\{file:(\.opencode\/prompts\/[a-z-]+\.md)\}$/);
    check(Boolean(reference), `${name}: system prompt must reference its tracked prompt file.`);
    if (reference) {
      const promptPath = path.join(root, reference[1]);
      check(fs.existsSync(promptPath), `${name}: referenced prompt is missing.`);
      if (fs.existsSync(promptPath))
        check(fs.readFileSync(promptPath, 'utf8').trim().length > 500, `${name}: prompt is incomplete.`);
    }
    check(!agent.request, `${name}: do not rely on V2 agent request overlays, which are not sent by the runner.`);
  }
  check(
    Object.keys(agents).sort().join(',') ===
      [...Object.keys(expectedAgents), 'title', 'summary', 'compaction'].sort().join(','),
    'Unexpected campaign agent or unpinned built-in override.'
  );
  for (const name of ['title', 'summary', 'compaction'])
    check(agents[name]?.model === WORKER_MODEL, `${name}: maintenance model must be explicitly pinned.`);
  const reviewerRules = agents['mercury-industrial-reviewer']?.permissions || [];
  for (const action of ['edit', 'shell', 'subagent'])
    check(
      reviewerRules.some((rule) => rule.action === action && rule.resource === '*' && rule.effect === 'deny'),
      `Reviewer must deny ${action}.`
    );
  const subagentRules =
    agents['mercury-industrial-supervisor']?.permissions?.filter((r) => r.action === 'subagent') || [];
  check(
    subagentRules[0]?.resource === '*' && subagentRules[0]?.effect === 'deny',
    'Supervisor must deny generic agent delegation before explicit exceptions.'
  );
  const allowed = subagentRules
    .filter((r) => r.effect === 'allow')
    .map((r) => r.resource)
    .sort();
  check(
    allowed.join(',') ===
      ['mercury-industrial-corrector', 'mercury-industrial-reviewer', 'mercury-industrial-worker'].join(','),
    'Supervisor may delegate only to the three pinned child roles.'
  );
  for (const name of ['mercury-industrial-worker', 'mercury-industrial-corrector'])
    check(
      agents[name]?.permissions?.some((r) => r.action === 'subagent' && r.resource === '*' && r.effect === 'deny'),
      `${name}: nested delegation must remain disabled.`
    );
  const policies = config.policies || [];
  check(
    JSON.stringify(policies) ===
      JSON.stringify([
        { action: 'provider.use', resource: '*', effect: 'deny' },
        { action: 'provider.use', resource: PROVIDER_ID, effect: 'allow' }
      ]),
    'Provider policies must deny other routes and allow only the Inception direct provider ID.'
  );
  check(
    config.commands?.industrialize?.agent === 'mercury-industrial-supervisor' &&
      config.commands?.industrialize?.model === SUPERVISOR_MODEL,
    'The industrialize command must select the Mercury supervisor and high-effort model.'
  );
  check(
    config.commands?.industrialize?.template === '{file:.opencode/prompts/industrialize-command.md}' &&
      fs.existsSync(path.join(root, '.opencode/prompts/industrialize-command.md')),
    'The industrialize command template must exist.'
  );
  check(
    (config.instructions || []).includes('PROJECT-CONTEXT.md') &&
      (config.instructions || []).includes('docs/industrialization/mercury_inception/ENGINEERING_PROTOCOL.md'),
    'Project context and the engineering protocol must be loaded.'
  );

  check(
    manifest.state === 'planned',
    'The checked-in manifest must not claim agents are running or tasks are finished.'
  );
  check(
    manifest.workerAgent === 'mercury-industrial-worker' &&
      manifest.reviewerAgent === 'mercury-industrial-reviewer' &&
      manifest.supervisorAgent === 'mercury-industrial-supervisor' &&
      manifest.correctorAgent === 'mercury-industrial-corrector',
    'Manifest roles must match the configured agents.'
  );
  const limits = manifest.limits || {};
  check(
    Number.isInteger(limits.modelRequests) && limits.modelRequests > 0 && limits.modelRequests <= 3,
    'Model concurrency must be bounded to three on this laptop.'
  );
  check(
    Number.isInteger(limits.writingWorkers) && limits.writingWorkers > 0 && limits.writingWorkers <= 2,
    'Writing concurrency must be bounded to two.'
  );
  check(limits.heavyProcesses === 1, 'Only one heavy process may run at a time.');
  const streams = Array.isArray(manifest.workstreams) ? manifest.workstreams : [];
  const ids = new Set(streams.map((stream) => stream.id));
  check(streams.length === 24 && ids.size === 24, 'The specialist manifest must contain 24 unique workstreams.');
  const byWsId = new Map(streams.map((stream) => [stream.id, stream]));
  const visited = new Set();
  const active = new Set();
  const visit = (id) => {
    if (active.has(id)) {
      errors.push(`Workstream dependency cycle at ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const dep of byWsId.get(id)?.dependsOn || []) {
      if (!byWsId.has(dep)) errors.push(`Unknown dependency ${dep} in ${id}.`);
      else visit(dep);
    }
    active.delete(id);
    visited.add(id);
  };
  for (const stream of streams) {
    check(/^WS-\d{2}$/.test(stream.id), 'Workstream IDs must use WS-NN.');
    check(
      Array.isArray(stream.dependsOn) &&
        Array.isArray(stream.candidatePaths) &&
        stream.candidatePaths.length > 0 &&
        typeof stream.acceptance === 'string' &&
        stream.acceptance.length > 50,
      `${stream.id}: dependencies, ownership candidates and acceptance criteria are required.`
    );
    visit(stream.id);
  }
  return { ok: errors.length === 0, errors };
}

/** Inspect only presence; never return credential values. */
function validateCredentials(env = process.env) {
  const errors = [];
  const value = env[CREDENTIAL];
  if (typeof value !== 'string' || !value.trim() || /[<>\r\n]|your[_ -]?api|placeholder/i.test(value))
    errors.push(`${CREDENTIAL} is missing or contains a placeholder.`);
  return { ok: errors.length === 0, errors };
}

function validateCatalogs(catalog) {
  const errors = [];
  const model = catalog.data?.find((m) => m.id === MODEL_ID);
  if (!model) errors.push(`The Inception catalog does not advertise ${MODEL_ID}.`);
  else if (!model.supported_features?.includes('tools'))
    errors.push('The Inception catalog does not advertise Mercury tool support.');
  return { ok: errors.length === 0, errors };
}

async function fetchJson(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Public metadata request failed with HTTP ${response.status}.`);
  return response.json();
}

async function validatePublishedSchema(config) {
  let Ajv2020;
  try {
    Ajv2020 = require('ajv/dist/2020').default;
  } catch {
    throw new Error('Ajv 2020 is unavailable locally; schema validation was not performed.');
  }
  const schema = await fetchJson(SCHEMA_URL);
  const ajv = new Ajv2020({
    strict: false,
    validateFormats: false,
    loadSchema: async (uri) => {
      const url = new URL(uri);
      if (url.protocol !== 'https:' || !['opencode.ai', 'models.dev'].includes(url.hostname))
        throw new Error('Unexpected external schema origin.');
      url.hash = '';
      return fetchJson(url.href);
    }
  });
  const validate = await ajv.compileAsync(schema);
  if (!validate(config)) throw new Error(`Published schema rejected config: ${ajv.errorsText(validate.errors)}`);
}

function validateRuntime(binary = 'opencode') {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000, maxBuffer: 65536, shell: false });
  if (result.error || result.status !== 0)
    return { ok: false, errors: ['OpenCode CLI is unavailable or --version failed; use a verified V2 runtime.'] };
  const version = (result.stdout || '')
    .trim()
    .match(/(?:^|\s)(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?(?:\s|$)/);
  if (!version || Number(version[1]) < 2)
    return {
      ok: false,
      errors: ['This opt-in config requires OpenCode V2; V1/current desktop compatibility was not established.']
    };
  return { ok: true, errors: [], version: `${version[1]}.${version[2]}.${version[3]}` };
}

async function main(args = process.argv.slice(2)) {
  const supported = new Set(['--catalogs', '--schema', '--ready', '--help', '--opencode']);
  let binary = 'opencode';
  for (let i = 0; i < args.length; i++) {
    if (!supported.has(args[i])) throw new Error('Unknown preflight argument. Use --help.');
    if (args[i] === '--opencode') {
      binary = args[++i];
      if (!binary || binary.startsWith('--')) throw new Error('--opencode requires a CLI executable path.');
    }
  }
  if (args.includes('--help')) {
    console.log(
      'Usage: node scripts/check_industrial_agents.js [--catalogs] [--schema] [--ready] [--opencode /path/to/opencode]'
    );
    return 0;
  }
  const { config, manifest } = loadConfiguration();
  const checks = [['Local routing, prompts and dependency graph', validateConfiguration(config, manifest)]];
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    checks.push(['Node runtime', { ok: false, errors: ['Node >=22.12.0 is required.'] }]);
  if (args.includes('--ready')) {
    checks.push(['Credential presence (value hidden)', validateCredentials()]);
    checks.push(['OpenCode V2 executable', validateRuntime(binary)]);
  }
  if (args.includes('--catalogs')) {
    try {
      checks.push(['Public Inception catalog', validateCatalogs(await fetchJson(INCEPTION_CATALOG))]);
    } catch (error) {
      checks.push(['Public catalog', { ok: false, errors: [error.message] }]);
    }
  }
  if (args.includes('--schema')) {
    try {
      await validatePublishedSchema(config);
      checks.push(['Published OpenCode JSON Schema', { ok: true, errors: [] }]);
    } catch (error) {
      checks.push(['Published OpenCode JSON Schema', { ok: false, errors: [error.message] }]);
    }
  }
  for (const [label, result] of checks) {
    console.log(`${result.ok ? 'PASS' : 'BLOCKED'} ${label}`);
    for (const error of result.errors) console.log(`  ${error}`);
  }
  console.log(`Configured: Mercury 3 High (${MODEL_ID}) via direct Inception; no other provider allowed.`);
  console.log(
    'No inference or agent dispatch performed. Authenticated access and effective session routing remain separate checks.'
  );
  return checks.every(([, result]) => result.ok) ? 0 : 1;
}

module.exports = {
  loadConfiguration,
  validateConfiguration,
  validateCredentials,
  validateCatalogs,
  validateRuntime,
  validatePublishedSchema,
  main
};

if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`Preflight failed: ${error.message}`);
      process.exitCode = 1;
    });
