'use strict';

const assert = require('assert/strict');
const {
  loadConfiguration,
  validateConfiguration,
  validateCredentials,
  validateCatalogs
} = require('../scripts/check_industrial_agents');

function runIndustrialAgentConfigTests() {
  const { config, manifest } = loadConfiguration();
  let total = 0;
  let passed = 0;
  const run = (name, fn) => {
    total++;
    try {
      fn();
      passed++;
      console.log(`  PASS ${name}`);
    } catch (error) {
      console.error(`  FAIL ${name}: ${error.message}`);
    }
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const rejectConfig = (mutate, expected) => {
    const c = clone(config);
    const m = clone(manifest);
    mutate(c, m);
    const result = validateConfiguration(c, m);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), expected);
  };

  run('Checked-in configuration has the complete direct-Inception routing contract', () => {
    assert.deepEqual(validateConfiguration(config, manifest), { ok: true, errors: [] });
  });
  run('Reject any provider other than Inception direct', () => {
    rejectConfig((c) => {
      c.providers['inception-direct'].settings.baseURL = 'https://openrouter.ai/api/v1';
    }, /endpoint/);
  });
  run('Reject credentials other than INCEPTION_API_KEY', () => {
    rejectConfig((c) => {
      c.providers['inception-direct'].settings.apiKey = '{env:OPENROUTER_API_KEY}';
    }, /credentials/);
  });
  run('Reject an inherited agent model', () => {
    rejectConfig((c) => {
      delete c.agents['mercury-industrial-worker'].model;
    }, /explicit provider/);
  });
  run('Reject generic-agent fallback delegation', () => {
    rejectConfig((c) => {
      c.agents['mercury-industrial-supervisor'].permissions.push({
        action: 'subagent',
        resource: 'general',
        effect: 'allow'
      });
    }, /only to the three/);
  });
  run('Reject incorrect or ineffective reasoning settings', () => {
    rejectConfig((c) => {
      c.providers['inception-direct'].models['mercury-3'].body.reasoning_effort = 'medium';
    }, /reasoning_effort=high/);
    rejectConfig((c) => {
      c.agents['mercury-industrial-worker'].request = { body: { reasoning_effort: 'high' } };
    }, /overlays/);
    rejectConfig((c) => {
      c.providers['inception-direct'].models['mercury-3'].variants[0].body.reasoning_effort = 'low';
    }, /high-reasoning variant/);
  });
  run('A second provider is rejected by policy and provider count', () => {
    rejectConfig((c) => {
      c.providers['openrouter-glm'] = JSON.parse(JSON.stringify(c.providers['inception-direct']));
    }, /Exactly one provider/);
  });
  run('Reviewer remains read-only and independent', () => {
    rejectConfig((c) => {
      c.agents['mercury-industrial-reviewer'].permissions = [];
    }, /Reviewer must deny/);
  });
  run('Reject missing prompt files', () => {
    rejectConfig((c) => {
      c.agents['mercury-industrial-worker'].system = '{file:.opencode/prompts/missing-prompt.md}';
    }, /prompt is missing/);
  });
  run('Reject excessive laptop concurrency', () => {
    rejectConfig((c, m) => {
      m.limits.writingWorkers = 24;
    }, /bounded to two/);
    rejectConfig((c, m) => {
      m.limits.heavyProcesses = 2;
    }, /one heavy process/);
  });
  run('Reject unknown and cyclic task dependencies', () => {
    rejectConfig((c, m) => {
      m.workstreams[0].dependsOn = ['WS-99'];
    }, /Unknown dependency/);
    rejectConfig((c, m) => {
      m.workstreams[0].dependsOn = ['WS-24'];
    }, /dependency cycle/);
  });
  run('Reject duplicate workstreams or false running status', () => {
    rejectConfig((c, m) => {
      m.workstreams[1].id = m.workstreams[0].id;
    }, /unique workstreams/);
    rejectConfig((c, m) => {
      m.state = 'running';
    }, /must not claim/);
  });
  run('Credential failures contain names/reasons but never values', () => {
    assert.equal(validateCredentials({}).ok, false);
    const placeholder = validateCredentials({ INCEPTION_API_KEY: '<your-key>' });
    assert.equal(placeholder.ok, false);
    assert.match(placeholder.errors.join(), /INCEPTION_API_KEY/);
    assert(!JSON.stringify(placeholder).includes('<your-key>'));
    assert.equal(validateCredentials({ INCEPTION_API_KEY: 'unit-inception-token' }).ok, true);
  });
  run('Catalog checks reject absent model or missing tool support', () => {
    // Metadata fixtures test routing validation; no inference/engineering result is mocked.
    const catalog = { data: [{ id: 'mercury-3', supported_features: ['tools'] }] };
    assert.equal(validateCatalogs(catalog).ok, true);
    assert.equal(validateCatalogs({ data: [] }).ok, false);
    const noTools = { data: [{ id: 'mercury-3', supported_features: [] }] };
    assert.equal(validateCatalogs(noTools).ok, false);
  });

  const stats = { total, passed, failed: total - passed };
  console.log(`Industrial agent configuration: ${stats.passed}/${stats.total} passed; ${stats.failed} failed.`);
  return stats;
}

module.exports = { runIndustrialAgentConfigTests };
if (require.main === module) process.exitCode = runIndustrialAgentConfigTests().failed > 0 ? 1 : 0;
