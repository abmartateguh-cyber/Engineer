# ADR-0003: Product license and EULA require rights-holder review

- **Status:** Pending external rights-holder decision
- **Date:** 2026-10-24

## Context

`package.json` declares `ISC`, but the repository has no root `LICENSE` text or product EULA. Project context records that the rights holder and final license decision are unresolved. Third-party notices describe dependencies and do not establish ownership or licensing rights for OmniEng itself.

## Decision

Do not infer ownership, issue new license terms, or draft operative EULA language without authorization from the rights holder. Treat the current package metadata as unverified for product distribution. Keep licensing as an R0 release blocker and keep source and dependency licensing assessments separate.

## Evidence required to close

1. Identify the rights holder and verify authority to license the application and its contributed material.
2. Confirm the intended product license and distribution model.
3. Obtain approved license and EULA text, then align `package.json`, root notices, installers, and product documentation.
4. Complete the dependency and engineering-data redistribution review, including source, version, scope, and required notices.

## Consequences

No product license or EULA is represented as approved. The existing `ISC` field remains unchanged pending review; this ADR does not grant or revoke rights.
