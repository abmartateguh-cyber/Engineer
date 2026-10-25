# OmniEng Experimental Engineering Workbench

OmniEng is an Electron desktop application that groups CAD, CAE, CFD, EDA, optics, plant, controls, aerospace, PDM, HPC, and AI experiments behind a shared interface.

All registered domains are currently marked experimental and are not release-approved. The repository does not provide evidence for competitor parity, code sign-off, regulated-tool qualification, or engineering certification. Treat displayed calculations and supplied examples as development outputs.

## Current build

- Desktop shell: Electron with a Three.js viewport.
- Computational modules: legacy JavaScript implementations and small example datasets.
- IPC: allowlisted preload methods and a lightweight schema gate.
- Project storage: experimental archive and password-based encryption helpers; full project save, recovery, and revision workflows are not available.
- Compute: local experimental engines; no configured local worker scheduler or remote cluster provider is included.
- Reports: an experimental evidence report can summarize supplied project inputs and results. It does not validate them.

## Development

Install the dependencies recorded in package-lock.json, then run:

    npm start
    npm test
    npm run test:vv
    npm run report:vv -- --output-dir ./artifacts

The test commands report code assertions and experimental diagnostics. Passing checks do not establish numerical validation, standards compliance, or release maturity. `npm run test:vv` prints test-only diagnostics. `npm run report:vv` writes a production-side availability report; it does not execute a solver, and missing independent references remain unavailable.

## Release status

The current release train is R0. See docs/industrialization/status.md for verified progress and outstanding gates, docs/known_limitations.md for current product limitations, and docs/security/threat_model.md for the preliminary security review.
