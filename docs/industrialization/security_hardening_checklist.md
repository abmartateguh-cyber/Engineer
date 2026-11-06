# OmniEng Security Hardening Checklist

> **Experimental — not certification.** This checklist records the state of
> security-hardening controls in the current worktree. Items marked DONE or
> VERIFIED are local source/scan observations with the cited evidence; they do
> not constitute certification, a penetration test, or an independent security
> assessment. Remaining OPEN items are required before any release claim.

As of: **2026-10-30**.

## Legend

- **DONE** — artifact produced and verified locally.
- **VERIFIED** — control present in source and exercised by tests or gates.
- **ADDED** — new control added on 2026-10-30; hosted execution pending.
- **IN PROGRESS** — active work or evidence still required.
- **OPEN** — not implemented or no evidence yet.

## Checklist

| #   | Item                                                                                        | Status      | Evidence / references                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | IPC sender guard: main-frame + exact `src/index.html` path enforced before route validation | VERIFIED    | `src/main/ipc/define_handler.js`; `src/core/security/ipc_validator.js`; `test/test_phase9_enterprise_security.js`; `test/test_preload_compatibility.js`                                          |
| 2   | CSP without `'unsafe-inline'` in `script-src` on both renderer documents                    | VERIFIED    | `src/index.html`; `src/ui/panel_host.html`; `scripts/check_renderer_sinks.js`                                                                                                                    |
| 3   | Context isolation, sandbox, disabled Node integration                                       | VERIFIED    | `main.js` `BrowserWindow` webPreferences; `preload.js` contextBridge                                                                                                                             |
| 4   | Safe DOM construction and renderer sink inventory gate                                      | VERIFIED    | `src/ui/safe_dom.js`; `scripts/check_renderer_sinks.js`; `test/test_anatomy_craft_parity.js`; workspace-tab / measurement-HUD / command-palette / Bode / EDA / engineering result view contracts |
| 5   | SBOM generated and matching current lockfile                                                | DONE        | `docs/sbom/manifest.json`; `docs/sbom/omnieng-dependencies.cdx.json`; `docs/sbom/omnieng-dependencies.spdx.json`; `scripts/generate_sbom.js`                                                     |
| 6   | Dependency audit clean                                                                      | DONE        | `npm run dependency:audit` — exit 0, 0 vulnerabilities (2026-10-30)                                                                                                                              |
| 7   | Weekly dependency update automation (npm + GitHub Actions) with open-PR limits and labels   | ADDED       | `.github/dependabot.yml`                                                                                                                                                                         |
| 8   | Secret scanning on push/PR (gitleaks, full history) — advisory, never blocks on no-secrets  | ADDED       | `.github/workflows/secret_scanning.yml` (gitleaks/gitleaks-action@v2, `fetch-depth: 0`)                                                                                                          |
| 9   | Whitespace gate (`git diff --check`) in the scanning workflow                               | ADDED       | `.github/workflows/secret_scanning.yml` step                                                                                                                                                     |
| 10  | Committed-source secret-pattern gate                                                        | DONE        | `scripts/check_secret_patterns.js` — `secret-pattern scan: PASS`, exit 0 (2026-10-30)                                                                                                            |
| 11  | Artifact signing / notarization / build provenance                                          | OPEN        | `electron-builder.yml`; no Developer ID identity installed; packaging report notes unsigned builds                                                                                               |
| 12  | External audit anchor (independent security review / penetration test)                      | OPEN        | threat model status line; no third-party assessment performed                                                                                                                                    |
| 13  | Session authentication and identity provider                                                | OPEN        | product IAM route returns `UNSUPPORTED`; snapshots use a locally entered password (`test/test_session_snapshot_ipc.js`)                                                                          |
| 14  | Secrets management policy (vault, rotation, no secrets in committed source)                 | IN PROGRESS | gate #10 added; no policy document or vault integration yet                                                                                                                                      |

## Related documents

- Threat model: `docs/security/threat_model.md` (2026-10-30 hardening review section).
- Historical posture audit (superseded Electron 34 baseline): `docs/industrialization/security_posture.md`.
- Release readiness scoring: `docs/industrialization/readiness_scorecard.md` (Security dimension).
- Packaging evidence (unsigned artifacts): `docs/industrialization/packaging_report.md`.
