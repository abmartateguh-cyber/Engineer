# Mercury 3 High execution setup (direct Inception)

This package configures **Mercury 3 High workers, reviewers, supervisor and correctors directly through Inception**, with an implementation plan and a provider-separation preflight.

## Files

- `opencode.industrial.json` at the repository root: opt-in **OpenCode V2** configuration.
- `.opencode/prompts/`: supervisor, worker, reviewer, corrector and launch command prompts.
- `IMPLEMENTATION_PLAN.md`: phased product work and verifiable exit criteria.
- `ENGINEERING_PROTOCOL.md`: evidence, benchmark identity, concurrency and release rules.
- `workstreams.json`: 24 dependency-ordered specialist lanes (planned, not running).
- `scripts/check_industrial_agents.js`: static/preflight, schema and catalog checks.
- `test/test_industrial_agent_config.js`: routing-integrity and negative-path tests.

The configuration is opt-in because V1 and V2 have different field/tool/permission names. The published schema accepts deprecated V1 fields, but this package deliberately uses current V2 `providers`/`agents` and native provider runtimes. Do not load this file into an unverified V1 installation.

## Credentials

Set these variables in the environment of the **OpenCode server process**, using your normal secret manager or a private terminal session:

```sh
export INCEPTION_API_KEY="<Inception key>"
```

Do not paste credentials into agent prompts or commit them. The current opt-in config defines a single `inception-direct` provider and uses this one credential for all four agent roles. The initial plan draft's `/api/v1` route was corrected to `/v1`: Inception's official model examples use `/v1`, and a read-only request to `/api/v1/models` returned HTTP 404. The key was absent from the implementation shell when this package was prepared, so no authenticated inference is demonstrated.

## Preflight

Run on Node >= 22.12:

```sh
node test/test_industrial_agent_config.js
node scripts/check_industrial_agents.js
node scripts/check_industrial_agents.js --catalogs --schema
node scripts/check_industrial_agents.js --ready
```

- Default: verifies local routes, effort settings, prompt paths, specialist dependencies and laptop resource limits. Makes no network requests and needs no key.
- `--catalogs`: read-only public model-catalog checks; no inference or source code is sent.
- `--schema`: validates the config against the published JSON Schema with Ajv 2020 if available locally. Missing validator or schema/network failure is a failed check, not a pass. It does not install dependencies.
- `--ready`: additionally requires the configured non-placeholder `INCEPTION_API_KEY` and an `opencode` CLI reporting major version 2 or newer. It does not print keys or spend inference tokens. A successful readiness check still does not prove account access, tool-calling behavior, server config merging or end-to-end inference.

For a CLI outside PATH, provide `--opencode /absolute/path/to/opencode` to readiness. A desktop-managed server must instead be restarted with the verified config and variables; terminal variables do not retroactively modify an existing server.

## Launch

After readiness succeeds, **quit/restart OpenCode and create a new session**. Configuration is not hot-reloaded, and selecting a new agent alone may preserve an existing session's model.

From the project root, with a verified V2 CLI:

```sh
OPENCODE_CONFIG="$PWD/opencode.industrial.json" opencode
```

Confirm the effective primary model is `inception-direct/mercury-3#high` (or the same model with the model-level max body applied), select `mercury-industrial-supervisor`, and run:

```text
/industrialize Start M0: reference integrity and the live capability inventory. Preserve all existing work. Dispatch only the explicitly configured Mercury workers and independent Mercury reviewers.
```

Before the first engineering dispatch, confirm a small real tool-call interaction on the direct route and inspect harness/provider metadata. Verify the effective endpoint, `model=mercury-3`, and `reasoning_effort=high`; record sanitized metadata and usage without authorization headers, secrets, source prompts or hidden reasoning. Account-specific access is verified here, not by a model declaring its own name.

Model and variant `body` fields carry active settings. V2 documents that agent-level `request` overlays are not yet sent by the runner, so this package does not rely on them for reasoning effort. Provider policies restrict this opt-in campaign to the single configured provider ID; higher-priority managed policies and account settings can still affect the effective configuration and must be inspected in the harness.

## Run rules

There are 24 lanes, but this 8-GiB/4-logical-CPU laptop starts at two writers, three model requests and one heavy process. Mercury assigns exact owned files and acceptance tests before each task. A separate Mercury context reviews each patch; Mercury reproduces and corrects findings. Shared routers, preload, entry points and registries are serialized.

The first product milestone corrects reference identity and establishes the real baseline. The plan does **not** accept 14 mislabeled/substitute diagnostics as proof of industrial readiness, or the last NASA failure as the only missing capability.

## Completion status

This is an implemented configuration/prompt/plan package. Product industrialization tasks in the manifest remain `planned` until the configured agents actually execute and their artifacts pass independent review. A successful package preflight does not certify OmniEng or establish that a background campaign is running.
