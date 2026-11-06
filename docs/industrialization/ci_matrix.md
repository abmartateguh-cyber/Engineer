# OmniEng CI Matrix — Industrialization

Updated: 2026-10-30

This document records the intended hosted CI matrix (`.github/workflows/ci.yml`),
the exact commands each runner executes, the artifacts it produces, and the
deliberate handling of the documented NASA_TMR fail-closed diagnostic.

## 1. Intended matrix

The `verify` job runs on the following GitHub-hosted runner matrix. GitHub
labels are used per architecture: `macos-15-intel` is the x64 variant of the
macOS 15 image and `macos-15` is the arm64 variant.

| Runner label        | OS / architecture            | Node      |
| ------------------- | ---------------------------- | --------- |
| `ubuntu-22.04`     | Ubuntu 22.04, x64            | 24.22.1  |
| `ubuntu-24.04`     | Ubuntu 24.04, x64            | 24.22.1  |
| `windows-2025`     | Windows Server 2025, x64     | 24.22.1  |
| `macos-15-intel`   | macOS 15, x64                | 24.22.1  |
| `macos-15`         | macOS 15, arm64              | 24.22.1  |

The matrix is declared with an explicit `arch` variable per runner so job names
and artifact names stay unambiguous across the two macOS variants.
`fail-fast: false` keeps all five cells running so one red cell never starves
evidence collection on the other platforms.

## 2. Commands executed per runner

All steps run sequentially inside each matrix cell. Steps are skipped once an
earlier step fails unless the step's `if` explicitly allows continuation
(e.g. evidence uploads use `if: always()`).

| Step | Command | Notes |
| ---- | ------- | ----- |
| Checkout | `actions/checkout@v4` | |
| Node | `actions/setup-node@v4`, Node 24.22.1, npm cache | |
| Install | `npm ci` | |
| Syntax | `npm run check:syntax` | |
| Renderer sinks | `npm run check:renderer-sinks` | preserved |
| IPC registration | `npm run check:ipc` | preserved |
| Lint | `npm run lint` | |
| Typecheck | `npm run typecheck` | |
| Format | `npm run format:check` | maintained subset |
| Format review | `npm run format:check:review` | reviewed subset |
| Dependency audit | `npm run dependency:audit` | |
| Poisson budget | `npm run test:poisson-budget` | isolated 2D Poisson performance/residual |
| Test | `npm test` | `continue-on-error: true` **only** for the documented NASA_TMR fail-closed diagnostic (comment inline); `TEST_TIMEOUT_MS: 900000` |
| UI smoke (Linux) | `xvfb-run -a npx electron . --test-ui` | bounded, `timeout-minutes: 5` |
| UI smoke (other OS) | `npm run test:ui` | bounded, `timeout-minutes: 5` |
| V&V diagnostics | `npm run test:vv` | intentionally blocking; NASA_TMR is the known honest failure |
| V&V report | `npm run report:vv -- --output-dir <temp>/omnieng-vv` | `continue-on-error: true` only because the report generator exits non-zero solely for the NASA fail |
| Experimental suite | `npm run test:experimental` | |
| Coverage | `npm run coverage -- --output-dir <temp>/omnieng-coverage` | V8 function-coverage floor check |
| Pack | `npm run pack` | `electron-builder --dir` for the host OS/arch |
| Evidence uploads | `actions/upload-artifact@v4` | see Section 3 |

### `continue-on-error` policy

The only steps allowed to fail without failing the matrix cell are the ones
whose sole expected failure mode is the **documented, honest fail-closed NASA
TMR flat-plate diagnostic** (production algebraic k-omega SST cannot yet match
Karman–Schoenherr within 4%): `npm test` and the V&V report generation step.
Every other step is strict; a real regression still turns the cell red. The
known-red physics result remains visible in the uploaded V&V report and
coverage JSON rather than being silently suppressed.

## 3. Artifacts

| Artifact name | Contents | Uploaded |
| ------------- | -------- | -------- |
| `{runner}-{arch}-vv-report` | `vv_report.md` (V&V diagnostic report) | even if the V&V report step fails (`if: always()`) |
| `{runner}-{arch}-coverage` | `function-coverage.json` (V8 loaded-source function coverage summary) | even if the coverage step fails (`if: always()`) |
| `{runner}-{arch}-evidence-bundle` | `vv_report.md`, `function-coverage.json`, and the `dist/` unpacked app output | final step; `if: always()`; missing files warn |

The coverage JSON is written by `scripts/run_coverage.js` into a
`v8-*/` subdirectory of the requested output directory, so the upload path uses
the `**/function-coverage.json` glob.

## 4. Hosted execution status

Hosted execution still requires a remote: this checkout currently configures
no Git remote, so the workflow has never run on GitHub-hosted runners. All
recorded gate results in `docs/industrialization/status.md` were produced
locally on one macOS host. The matrix above is the intended target; it is
deliberately not declared "verified" until at least one hosted run completes on
each cell.

## 5. Related determinism gate

`npm run check:determinism` (`scripts/check_determinism.js`) verifies that
generated artifacts are byte-for-byte reproducible: the capability matrix is
generated twice into temp directories and diffed, and the fuzz suite's seeded
PRNG byte stream is replayed against the same seed. It is part of the local
gate suite and is intended to run in CI alongside the steps above.
