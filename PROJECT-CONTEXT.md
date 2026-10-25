# OmniEng Project Context

## Purpose

OmniEng is an experimental desktop workbench containing engineering examples and early implementations across CAD, CAE, EDA, optics, controls, process engineering, and aerospace. The repository is being industrialized incrementally. Existing domains and their APIs are being preserved while their evidence, limits, and readiness are audited.

The current work is **R0: Credibility and Reproducibility**. No domain is release-approved. The application and its calculations must not be described as production-ready, certified, standards-compliant, or equivalent to commercial engineering software without evidence that supports that claim.

## Repository facts

- Electron desktop application with JavaScript computational and UI code.
- `package.json` declares Node.js `>=22.12.0`, npm `>=10.9.0`, and the ISC package license. The intended rights holder and final license decision have not been resolved.
- Feature maturity defaults to `experimental`; release approval is false.
- Some modules perform useful exploratory calculations, but passing smoke checks do not establish independent engineering validation.
- Independent reference artifacts, qualified production validation adapters, full supported-platform CI results, and legal review are not yet established.

## Current audit record

See [`docs/industrialization/status.md`](docs/industrialization/status.md) for dated command results, open R0 gates, and the next required work. Treat it and the current source tree as authoritative; older readiness scores, test totals, and capability descriptions are not current evidence.

## Working constraints

- Keep changes incremental and preserve the current engineering domains and public interfaces where practical.
- Do not convert missing references or unimplemented behavior into passing results.
- Keep test fixtures and diagnostic runners under `test/`; production code must not import from the test tree.
- Identify the source, license, units, scope, and limitations of engineering data before using it as validation evidence.
- Do not claim industrial readiness or standards compliance until the relevant R0 and later release gates have evidence.
