# OmniEng engineering execution protocol

<!-- claims:evidence:ENGINEERING_PROTOCOL.md definitional vocabulary list (implemented/wired/executed/verified/validated/release-approved/certified stages); protocol definitions, not status claims -->

**Status: development workflow; no production release or certification is granted by this document.**

## Evidence and identity

- Preserve the working tree and public interfaces incrementally. Existing uncommitted/untracked files are part of the baseline, not disposable scratch work.
- Separate **implemented**, **wired**, **executed**, **verified**, **validated**, **release-approved**, and **certified**. Each requires its own evidence. Test count and agent count establish none of the later stages.
- The agent harness determines the actual model/provider. A model claiming its own name is not evidence. Workers/reviewers use direct Inception; Mercury supervision/correction uses Inception. No cross-provider fallback.
- Track live session/process IDs and states. Configuration is not dispatch; dispatch is not execution; an empty/interrupted response is unknown. Do not claim invisible background progress without an active process/session.
- Record the command, cwd, UTC time, input/patch digests, environment, stdout/stderr artifact and real exit code. Pipes must preserve the originating exit code (`set -o pipefail` where relevant). Coverage above 75% does not override a red test process.

## Numerical integrity

- Declare validity domain, units, material/property provenance, discretization, boundaries, convergence and limitations for every engine operation.
- Measure residuals, mass/energy balance, runtime, memory and backend from actual execution. Never substitute constants or theoretical peak performance.
- Non-finite state is a typed numerical failure. Positivity floors must have a derived admissibility/stability rationale and report correction magnitude; do not replace NaN/Infinity silently.
- Verify reference identity. Retain useful analytic/manufactured tests with descriptive IDs; they cannot satisfy a named published or experimental case whose geometry/data/model was not run.
- Reference records contain publisher/source URL, version/edition, license/redistribution status, SHA-256, units, exact setup, comparison metric, predeclared tolerance and independence rationale.
- Verification includes refinement, conservation, rigid-body/constant-field checks, edge cases and failure injection where applicable. Validation compares the shipped engine through the shipped adapter against an independent reference within the supported domain.
- Do not optimize a benchmark to green by selecting a favorable station, coefficient, timestep count or grid. Stationarity, mesh convergence and measurement selection must be predeclared.

## Product completeness

Use a capability matrix for each operation: input contract → engine → adapter → compute job → IPC → preload → visible UI/headless command → result/provenance → saved project → export/recovery. Mark each cell with evidence or an explicit gap.

An unavailable dataset, external identity/HSM/cluster, license, or unsupported method remains an unavailable capability with a precise reason. Preserve compatibility routes and implement missing capabilities on scoped tasks; do not fabricate data to make them look active.

Fixtures and diagnostic runners stay under `test/`. Product code must not import test fixtures. No automatic user-input defaults for engineering conditions unless the user explicitly selects a labeled example with its complete assumptions.

## Parallel work and resources

The task manifest contains 24 specialist lanes. On the observed 4-logical-CPU/8-GiB Mac, start at **2 writing workers**, **3 concurrent provider requests**, and **1 heavy test/build/Electron process**. Schedule the rest as queued work. Increase limits only after memory, latency, thermal and provider-rate measurements justify it.

Reserve exact files before dispatch. Shared routers, preload, app/main entry points, package/lockfile, master test registry, workflow files and evidence ledgers have a single integration writer. Another worker requests ownership rather than overwriting concurrent edits. Never label a shared-file race as a pre-existing issue without reproducing it on the captured baseline.

Reviews use a separate context and compare actual artifacts. The supervisor runs independent reproduction for read-only reviewers. Three failed correction attempts trigger diagnosis/replanning, not a relaxed tolerance or an infinite autonomous loop.

## Gates

At an integration boundary run, preserving all exit statuses:

```sh
npm test
npm run test:poisson-budget
npm run test:vv
npm run check:syntax
npm run check:ipc
npm run check:renderer-sinks
npm run lint
npm run typecheck
npm run format:check
npm run dependency:audit
npm run coverage -- --output-dir /absolute/path/outside-the-worktree
npm run test:ui
```

`typecheck` currently uses `checkJs: false`; lint enables only a narrow ruleset; formatting checks a maintained file list; coverage counts loaded source. Record those limitations. Strengthen them incrementally rather than implying semantic/type/security coverage they do not provide.

Do not use `continue-on-error`, timeout, output filtering, environment-specific skip, or warning suppression to describe a failing release gate as green. A diagnostic may report known gaps separately, but release status includes every unresolved blocker.

`test:clean` means tests left the baseline unchanged. It does not mean `git status` is clean or authorize committing pre-existing work. Packaged smoke requires an affirmative bounded completion and exit code zero; a process surviving until killed is not a pass.

## Release authority

Each release candidate has a finite supported workflow/physics/platform/data scope and an evidence manifest. Independent engineering review, legal/data licensing, security support, configuration control and operational acceptance are required as applicable. Qualification is use-specific: an ASIL or TQL label, signed hash, template dossier or blanket percentage is not a certification grant.

An unsupported Electron runtime remains runtime security exposure even if listed in `devDependencies`. Keep laptop-compatible development distinct from a supported industrial deployment target; decide platform support explicitly with the product owner.
