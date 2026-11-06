# Setup verification — 2026-10-29

<!-- claims:evidence:SETUP_VERIFICATION.md recorded command results (check_industrial_agents.js --catalogs --schema, Ajv 2020) executed 2026-10-29 -->

> Historical setup-package snapshot. The JavaScript syntax count below records
> the package-preparation revision (359 files); later product changes are
> reported in `docs/industrialization/status.md`.

## What this evidence covers

The configuration, agent prompts, dependency-ordered industrialization plan and provider-separation checks created in this change. It is not a fresh numerical validation of OmniEng, an authenticated model-access test, an agent dispatch record, or a product release.

## Observed environment

- macOS 12.7.6, x86_64.
- 4 logical CPUs, 8 GiB physical memory.
- Node v24.16.0 used for the checks below.
- `INCEPTION_API_KEY` absent from the implementation shell (presence only inspected; no credential files read). The current opt-in config has one direct Inception `/v1` provider for all roles.
- `opencode` CLI unavailable on PATH. The installed desktop application's compatibility with this V2 config was not established.

## Checks performed

| Command/check                                                                             | Result                 | Scope                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node test/test_industrial_agent_config.js`                                               | Exit 0; 14/14 passed   | Routing, reasoning, explicit tools/modalities, prompt files, no-fallback policies, reviewer isolation, task DAG and resource limits; negative tests reject misconfiguration |
| `node scripts/check_industrial_agents.js`                                                 | Exit 0                 | Local configuration and manifest contract                                                                                                                                   |
| `node scripts/check_industrial_agents.js --catalogs --schema`                             | Exit 0                 | Both public catalogs checked; full config validated against the published OpenCode schema with local Ajv 2020                                                               |
| `node scripts/check_industrial_agents.js --ready`                                         | Exit 1; BLOCKED        | The configured credential is absent and no verified V2 CLI is available; not a launch-ready environment                                                                     |
| `node scripts/check_syntax.js`                                                            | Exit 0; 359/359 parsed | Repository-wide JavaScript syntax, including the two new harness/test files                                                                                                 |
| ESLint on `scripts/check_industrial_agents.js` and `test/test_industrial_agent_config.js` | Exit 0                 | New JavaScript only                                                                                                                                                         |
| Prettier check on the new config, prompts, plan, manifest, script and test                | Exit 0                 | New implementation package formatting                                                                                                                                       |

Public catalog facts observed: Inception lists `mercury-3` with tool support; its official model documentation advertises `high` reasoning. The config pins the single direct Inception route and uses active model/variant request bodies rather than ineffective V2 per-agent request overlays. No authenticated inference or provider-specific account access was verified.

## Remaining activation checks

1. Supply `INCEPTION_API_KEY` through the intended OpenCode server process environment.
2. Use a verified OpenCode V2 runtime and repeat readiness plus schema/catalog checks.
3. Restart the harness with the opt-in config and create a new session; inspect its actual primary model/variant.
4. Exercise a small real tool call on the configured direct route, inspect sanitized endpoint/model/effort metadata and record account access, usage and session ID. Public catalog access does not prove this step.
5. Start M0. Workers, reviewers and correction sessions are not running merely because their prompts/config exist.

No inference request was sent in this change. No Mercury or Mercury engineering execution is claimed. Product V&V, security, packaged-workflow and independent release gates remain open under the implementation plan.
