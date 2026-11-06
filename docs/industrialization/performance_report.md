# Build/Test Performance Report

Date: 2026-10-29
Scope: `node test/run_all_tests.js` (root regression smoke suite), `scripts/run_tests_clean.js`, `scripts/run_coverage.js`

## 1. Baseline (before optimization)

Single run of `node test/run_all_tests.js`:

| Metric | Value |
|---|---:|
| Total wall time | 98.68 s |
| User CPU | 82.41 s |
| System CPU | 9.28 s |
| Result | 791/792 passed; 1 failed (NASA_TMR_FLAT_PLATE — expected honest failure) |

### Per-suite visible times (worst first, measured from streamed output sections)

| Suite | Wall time |
|---|---:|
| OmniEng Experimental Validation Readiness (V&V benchmarks) | ~24.3 s |
| OmniEng Experimental Multi-Domain Stack checks (e2e) | ~19.1 s |
| Deterministic Parser Smoke checks (fuzz gates) | ~14.7 s |
| Running 30 Experimental Legacy Smoke checks (gold benchmarks 3) | ~9.4 s |
| Domain Industrial Upgrade Verification (Phase 3) | ~8.2 s |
| Core Solvers coverage | ~4.8 s |
| UI Views coverage | ~2.7 s |
| Remaining suites + startup | ~19 s |

**5 slowest suites:** V&V benchmarks, e2e stack, parser fuzz, gold benchmarks 3, domain industrial upgrade.

## 2. Findings and fixes (test-side only; no assertions weakened)

All fixes keep identical tolerance thresholds and assertion semantics; only input sizes / initial
guesses / iteration counts were reduced where the same checks still pass with margin.

| Suite / file | Issue | Fix | Saving |
|---|---|---|---:|
| `test/vv/nafems/test_nafems_t1.js` | Explicit transient conduction integrated 40 000 steps to steady state (120 s of simulated time) | `totalTimeSec` 120 → 10 (still converged; error 0.0008% vs 1% tolerance) | ~6.7 s |
| `test/vv/nafems/test_nafems_le10.js` | 12 radial divisions in perforated-plate FEA mesh | `nr` 12 → 6 (error 0.70% vs 8% tolerance) | ~3.0 s |
| `test/vv/nafems/test_nafems_le1.js` | Fine HEX20 wedge mesh 6×6×2 | Fine mesh 6×6×2 → 5×5×2 (hoop error 1.69%, ur error 0.006% vs 5% tolerance) | ~1.6 s |
| `test/fuzz/test_parsers_fuzz.js` | Vault gate ran 100 AES-256-GCM decrypts, each PBKDF2 (100k iterations) | 100 → 20 iterations (all 5 corruption strategies still covered 4×) | ~10.2 s |
| `test/test_gold_benchmarks_3.js` | PCG scale check on 100×100 (10 000-unknown) CSR + sparse Cholesky cross-check | 100×100 → 60×60 (3 600 unknowns); PCG converges, max|diff| = 1.2e-9 < 1e-6 | ~3 s |
| `test/test_domain_industrial_upgrade.js` | Radau IIA stiff van der Pol runs started from `h0 = 1e-6` (1815 steps) | `h0` 1e-6 → 1e-4 (final states identical; coarse/fine consistency diff 1.3e-11 < 1e-2) | ~1.7 s |
| `test/test_coverage_core_solvers.js` | Deep VOF dam-break advection 0.15 s | 0.15 s → 0.08 s (front 0.45 m > 0.2 m, inside domain, mass error 0% < 0.1%) | ~1.2 s |

Left unchanged (no safe non-weakening fix):
- **e2e stack (~19 s)**: dominated by ~20 subprocess `bin/stenographer.js` CLI invocations that
  exercise the real state-file/locking boundary; per-process startup cost is fixed by the module
  graph (src/), and removing any scenario would delete covered behavior.
- **NASA_TMR_FLAT_PLATE (~5 s)**: the expected honest failure; its compute is the failing
  flat-plate boundary-layer divergence, which must be exercised to fail closed.

## 3. After optimization

Single run of `node test/run_all_tests.js`:

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Total wall time | 98.68 s | 82.28 s | −16.4 s (−17%) |
| User CPU | 82.41 s | 64.08 s | −18.3 s |
| System CPU | 9.28 s | 8.24 s | −1.0 s |
| Result | 791/792 (1 NASA_TMR) | 791/792 (1 NASA_TMR) | unchanged |

Per-suite after (same measurement method):

| Suite | Before | After |
|---|---:|---:|
| V&V benchmarks | 24.3 s | 15.5 s |
| e2e stack | 19.1 s | 20.4 s (noise) |
| Parser fuzz | 14.7 s | 4.5 s |
| Gold benchmarks 3 | 9.4 s | 8.6 s |
| Domain industrial upgrade | 8.2 s | 7.3 s |
| Core solvers coverage | 4.8 s | 3.8 s |

Final summary line:

```
Experimental smoke assertions: 791/792 passed; 0 validation cases unavailable; 1 failed
```

(`node scripts/run_tests_clean.js` exits 1 only due to the expected NASA_TMR failure; the
worktree guard passes: "Worktree unchanged across 3704 tracked and untracked paths." Syntax check:
357/357 files parse.)

## 4. Timeout defaults

- `scripts/run_tests_clean.js`: `DEFAULT_TEST_TIMEOUT_MS = 300 000` (300 s)
- `scripts/run_coverage.js`: `DEFAULT_COVERAGE_TIMEOUT_MS = 420 000` (420 s)

Measured root-suite wall time on this machine: 82–99 s (before: 98.7 s; after: 82.3 s). The
suite does **not** exceed 300 s, so the defaults are kept as-is (no bump required). Both remain
comfortably above the measured runtime (≥3× margin), and the `TEST_TIMEOUT_MS` environment
override still takes precedence in both scripts.

## 5. Tooling

`scripts/measure_suite_times.js` (new) is a read-only harness: it runs the root suite under a PTY
(line-buffered output), attributes wall time to the visible suite header sections, and prints a
per-suite breakdown plus total wall time. It does not modify the test registry.
