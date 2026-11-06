# V&V Verification Evidence

This document records the local verification run that produced `docs/industrialization/vv_report.md` and the operational behavior of the V&V report pipeline. It is a record of what was executed and what the runner reported; it is not a certification artifact, sign-off record, or compliance statement.

## When

- Local verification performed: 2026-10-31 (macOS host time).
- Generated report timestamp: refreshed by the report pipeline (see below).

## Environment

- Host OS: darwin (macOS)
- Architecture: x64
- Node.js: v24.16.0 (`/Users/yuta/.nvm/versions/node/v24.16.0/bin/node`)
- CPUs: 4

## Commands run

All commands were run with `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` so the Node 24 runtime (the package minimum) was used.

1. Direct runner CLI invocation (verifies the `--output-dir` option and fail-closed exit contract):

   ```sh
   node test/vv/run_vv.js --output-dir docs/industrialization
   ```

   The option `--output-dir` is accepted and the diagnostic report `vv-diagnostic-report.md` is written. The runner exits 1 when a benchmark fails, as documented in `test/vv/run_vv.js`.

2. Report pipeline execution:

   ```sh
   node scripts/generate_vv_report.js --output-dir docs/industrialization
   ```

   This invokes the same runner path (`runVVVerificationBenchmarks({ outputDir })`), writes `vv-diagnostic-report.md` and `vv_report.md`, and exits 1 when any benchmark fails. The 2026-10-31 run reported 10 pass, 0 unavailable, and 5 fail; the failures are preserved in both report artifacts.

3. Static checks on the edited JavaScript:

   ```sh
   node -c scripts/generate_vv_report.js
   node scripts/check_syntax.js
   ```

   Both passed on Node 24.16.0; the repository syntax check parsed 372/372 JavaScript files.

## Summary counts

The runner reported, across 15 experimental diagnostics:

| Total | Passed | Failed | Unavailable |
| ----: | -----: | -----: | ----------: |
|    15 |     10 |      5 |           0 |

Failed (5):

- `NASA_TMR_FLAT_PLATE` — Cf deviates from the Karman–Schoenherr correlation by 6.7% against the declared 4% tolerance. The corrected wall treatment passes the stationarity gate (wall-Cf range 0.22%, profile drift 0.15% over 20 steps; 1% limits) without making the comparison pass.
- `CHANNEL_POISEUILLE_HALF_CHANNEL_DIAGNOSTIC` — predeclared stationarity gate failed over the final 20 steps (ratio range 115.6%, profile drift 368%; limits 1%); the diagnostic is no longer reported unavailable, it fails honestly.
- `NAFEMS_LE1` — measured sigma_y(D) deviates from the NAFEMS LE1 reference (92.7 MPa) beyond ±3.5%.
- `NAFEMS_LE11` — measured sigma_z(A) deviates from the NAFEMS LE11 reference (−105 MPa) beyond ±5%.
- `NAFEMS_T1` — measured T(0.6, 0.2) deviates from the NAFEMS T1 reference (36.6 °C) by more than 0.5 °C.

The 10 passing diagnostics are descriptive analytic/discrete, manufactured, generated, or same-publisher MOOSE cross-solver checks. They are not NAFEMS LE1/LE10/LE11/FV32/T1, discrete Hertz contact, Hannover measurements, an original NIST archive, or ISO 10110 qualification runs. See `reference_registry.md` and the generated per-case report for provenance.

## Disclaimers

- The V&V runner output is experimental diagnostics only. A passing benchmark does not establish solver accuracy, standards compliance, certification, or release maturity.
- Reference provenance is recorded per benchmark as the source of the expected values; external reference artifacts and calculations have not been independently qualified.
- `SPARSE_SPD_GENERATED_SUITE` uses generated systems; it is not the original NIST sparse matrix archive.
- The single failing benchmark is kept visible and fail-closed; it is documented in the "Open items" section of `docs/industrialization/vv_report.md`.
- This evidence document and `vv_report.md` are generated artifacts of local verification runs, not released validation evidence packages.
