# ADR-0003: Product license and EULA require rights-holder review

- **Status:** OPEN — dual-licensing model proposed; operative license/EULA texts pending rights-holder review
- **Date:** 2026-10-24 (status last reviewed 2026-10-31)

## Context

`package.json` historically declared `ISC`; it now declares `Apache-2.0`. A root `LICENSE` file (Apache License 2.0 boilerplate, copyright "OmniEng Engineering Systems Inc.") and a `docs/EULA.md` draft exist in the working tree but are not yet committed. Third-party notices describe dependencies and do not establish ownership or licensing rights for OmniEng itself.

A dual-licensing structure is proposed to allow open-core contributions while protecting proprietary desktop application assets:

1. **Open Source Core (Apache-2.0)**: the underlying mathematical engines, shared data contracts (`src/core/contracts/`), IPC interfaces, and verification suites under the Apache License, Version 2.0 (see root `LICENSE`).
2. **Commercial Workstation Application (OmniEng Commercial EULA)**: the packaged desktop binary, Electron application shell, renderer user interfaces, and proprietary domain adapters under the OmniEng Commercial EULA (`docs/EULA.md`).

## Status

The proposal is adopted as the intended direction, but the operative terms are not approved:

- `docs/EULA.md` states it is a **DRAFT FOR RIGHTS-HOLDER REVIEW — not yet adopted** and requires review and signature by the rights holder before it becomes effective.
- The implementation tracker records ADR-0003 as an external-blocked decision pending the rights holder.
- Neither `LICENSE` nor `docs/EULA.md` is committed, and they are not release-approved; treat current package metadata and distribution terms as unverified for product distribution until rights-holder review completes.

## Evidence required to close

1. Identify the rights holder and obtain review/signature of the proposed license and EULA text.
2. Commit the reviewed `LICENSE` and `docs/EULA.md` and align `package.json`, installers, and product documentation.
3. Complete the dependency and engineering-data redistribution review, including source, version, scope, and required notices.

## Consequences

- No product license or EULA is represented as approved or adopted. Existing distribution terms remain pending review; this ADR does not grant or revoke rights.
- Licensing remains an R0 release blocker.
