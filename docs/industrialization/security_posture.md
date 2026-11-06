# Historical Security Posture Audit — Electron 34 Baseline (Superseded)

Historical audit date: 2026-10-29, before the Electron upgrade in this worktree.

> **Superseded current state (2026-10-29):** `package.json` resolves Electron
> 45.1.0; `electron-builder.yml` declares macOS 13.0.0; `npm run dependency:audit`
> now exits 0 with 0 vulnerabilities; and the current SBOM was regenerated for
> lockfile SHA-256 `360d0c0e6341164eba8756d731ae61eb365985d1101f4da578f02229e0845666`.
> The macOS 12.7.6 host cannot launch the current GUI runtime. Sections below
> preserve the previous Electron 34 findings and rationale as historical
> evidence; they do not describe the current dependency tree.

## 1. Dependency tree position

| Package                                                           | Type                                           | Installed           | Ships in app artifact?                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `three@0.186.1`                                                   | prod dependency                                | 0.186.1             | yes                                                                             |
| `electron`                                                        | devDependency (`^34.3.0`)                      | 34.5.8              | no — build/run tooling only; the packaged app is produced by `electron-builder` |
| `electron-builder`, `eslint`, `globals`, `prettier`, `typescript` | devDependencies                                | latest per lockfile | no                                                                              |
| `extract-zip@2.0.1`                                               | transitive dependency of `electron` (dev-only) | 2.0.1               | no — used at `npm install` time to unzip the downloaded Electron binary         |

The only prod dependency (`three`) is not affected by any high/critical advisory.
Both vulnerabilities are dev-only tooling chain, and neither reaches the runtime app surface.

## 2. Findings (high/critical)

`npm audit` reports **2 high-severity package findings (0 critical)**:

### 2.1 `electron@34.5.8` — high — 46 GitHub Security Advisories (one audit finding)

All fixed only by a breaking major-version change (see §4). The 46 advisories:

**A. Renderer isolation & sandbox bypasses (14):**

- `GHSA-h7rp-cf8h-j98x` — Context isolation bypass via Function.prototype.bind hijack
- `GHSA-xwr5-m59h-vwqr` — nodeIntegrationInWorker not correctly scoped in shared renderer processes
- `GHSA-9qh4-3jw8-366w` — `<webview>` can enable Node.js integration in Web Workers despite embedder restrictions
- `GHSA-hq2x-r82h-9wj4` — inherited HTML sandbox restrictions dropped for popups opened through OpenURLFromTab
- `GHSA-gr2m-v5gq-v685` — windows opened from a sandboxed top-level document do not inherit sandbox restrictions
- `GHSA-9f4c-93c8-jc8g` — sandboxed iframe can bypass the allow-popups restriction via OpenURL navigation
- `GHSA-p2rr-rvmm-c5fp` — sandboxed iframes can launch external protocol handlers
- `GHSA-f3pv-wv63-48x8` — named window.open targets not scoped to the opener's browsing context
- `GHSA-v93f-fgjr-hjrj` — window.open features string controls privileged window options
- `GHSA-ff2p-hmqr-hxm4` — contextBridge object copy honors prototype setters
- `GHSA-9wfr-w7mm-pc7f` — renderer command-line switch injection via commandLineSwitches webPreference
- `GHSA-4f78-qhmw-8j8m` — DevTools JavaScript injection via unsanitized dock state parameter
- `GHSA-f2r8-jv7c-xqmp` — DevTools embedder handler executes arbitrary files via shell open
- `GHSA-xj5x-m3f3-5x3h` — service worker can spoof executeJavaScript IPC replies

**B. Permission / origin misattribution (10):**

- `GHSA-r5p7-gp4j-qhrx` — incorrect origin passed to permission request handler for iframe requests
- `GHSA-9pf5-hg6p-4pwp` — permission check handler receives main frame origin instead of requesting iframe origin
- `GHSA-fw47-9c62-h3vw` — HID and USB permission checks can be attributed to the wrong origin
- `GHSA-x562-297c-g43g` — pointer lock permission requests can be attributed to the wrong frame
- `GHSA-997q-gvvc-jwmx` — openExternal permission requests can be attributed to the wrong origin
- `GHSA-m55f-7gqj-fr98` — extension tab APIs operate across session boundaries
- `GHSA-98mx-cjp9-gchm` — extension tabs.query returns tab URLs and titles without the tabs permission
- `GHSA-x8rc-wpg4-grpf` — cross-origin iframe can position native autofill popup
- `GHSA-9899-m83m-qhpj` — USB device selection not validated against filtered device list
- `GHSA-8337-3p73-46f4` — use-after-free in fullscreen, pointer-lock, and keyboard-lock permission callbacks

**C. Protocol / file / navigation handling (9):**

- `GHSA-j84w-jfhq-vhvj` — file and HTTP protocol handlers allow cross-origin reads without corsEnabled
- `GHSA-v3j7-r9gq-3gjw` — custom protocol with supportFetchAPI but not corsEnabled allows cross-origin reads
- `GHSA-4p4r-m79c-wq3v` — HTTP response header injection in custom protocol handlers and webRequest
- `GHSA-v64r-4m7r-3mvq` — HTTP redirect followed into local file loader
- `GHSA-5c9j-mhmv-5xgx` — shell.openPath path validation bypass via embedded null byte
- `GHSA-mwmh-mq4g-g6gr` — registry key path injection in app.setAsDefaultProtocolClient on Windows
- `GHSA-jfqx-fxh3-c62j` — unquoted executable path in app.setLoginItemSettings on Windows
- `GHSA-5rqw-r77c-jp79` — AppleScript injection in app.moveToApplicationsFolder on macOS
- `GHSA-2p8c-gr87-2676` — SameSite cookie restrictions not applied to windows opened from links

**D. Memory-safety (use-after-free / OOB / crash / offscreen geometry) (9):**

- `GHSA-3c8v-cfp5-9885` — out-of-bounds read in second-instance IPC on macOS and Linux
- `GHSA-532v-xpq5-8h95` — use-after-free in offscreen child window paint callback
- `GHSA-9w97-2464-8783` — use-after-free in download save dialog callback
- `GHSA-jjp3-mq3x-295m` — use-after-free in PowerMonitor on Windows and macOS
- `GHSA-8x5q-pvf5-64mp` — use-after-free in offscreen shared texture release() callback
- `GHSA-f37v-82c4-4x64` — crash in clipboard.readImage() on malformed clipboard image data
- `GHSA-pfmc-3mgc-p6fp` — off-screen rendering trusts GPU-supplied geometry over shared-memory size
- `GHSA-h3v5-h239-pg29` — off-screen rendering on macOS trusts GPU-supplied frame geometry
- `GHSA-3qxv-5xgr-q7w9` — frame subscription trusts GPU-supplied frame geometry

**E. Packaging / update / supply-chain (4):**

- `GHSA-vmqv-hx8q-j7mg` — ASAR integrity bypass via resource modification
- `GHSA-vv43-5jgx-7qv8` — local race condition in Squirrel.Mac update installation on macOS
- `GHSA-jm7p-cc5g-qwxx` — parent process code-sign check is spoofable
- `GHSA-jr5w-w6x2-84p9` — mitigation for compromised eMudhra intermediate certificates

### 2.2 `extract-zip@2.0.1` — high — 2 GitHub Security Advisories

Transitive, dev-only (dependency of the `electron` npm package; runs only while
downloading/unzipping the Electron binary during `npm install`):

- `GHSA-jmr9-qjv8-65gv` — unvalidated symlink path traversal
- `GHSA-7pqw-9j4j-h8q3` — arbitrary file writes through symlink archive entries

## 3. Exploitability in this application's context

Mitigations present in the shipped runtime (`main.js` BrowserWindow, lines 55–58):
`preload` bridge, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
The renderer only loads bundled local content (`file://` app shell). Source search
confirmed the app does not use: `<webview>`, offscreen rendering, custom protocol
handlers (`registerSchemesAsPrivileged`/`protocol.registerFileProtocol`),
`setAsDefaultProtocolClient`, `moveToApplicationsFolder`, `setLoginItemSettings`,
`clipboard.readImage`, PowerMonitor APIs, USB/HID APIs, or an auto-updater.

- Classes A/D — renderer isolation bypasses and memory-safety UAF/OOB issues require
  attacker-influenced web content or specific surfaces (webview, offscreen, clipboard,
  PowerMonitor, DevTools dock) that this app neither loads nor exposes. Latent, low
  practical exploitability today; they become meaningful if the renderer is ever pointed
  at untrusted content or the listed APIs are adopted.
- Class B — permission/origin misattribution affects permission flows the app does not
  register (`setPermissionRequestHandler` usage is not present in app code), except the
  pointer-lock/fullscreen path which is not exercised by the UI. Low current exposure.
- Class C — the protocol/file issues (cross-origin reads, HTTP redirect into local file
  loader, header injection) require registered protocol handlers or navigation to
  remote content; the app has none. Low current exposure.
- Class E — ASAR integrity and code-sign spoofing are packaging-level; relevant when
  distributing signed builds, not to the dev-mode runtime. Squirrel.Mac applies only if
  an updater is introduced.
- `extract-zip` — exploitable only on the development machine during `npm install`
  (dependency-chain/supply-chain attack against the build environment); it never ships
  and cannot be reached by end users of the packaged app.

Residual risk is primarily the acceptance of a known-vulnerable Electron runtime in the
development/build chain, plus the standing risk that a future feature (webview,
untrusted remote content, permission handlers, auto-update) activates currently-latent
advisories without a corresponding Electron upgrade.

## 4. Remediation status

1. Ran `npm run dependency:audit` (before): **2 high, 0 critical**; exit 1.
2. Ran `npm audit fix` (non-force): **no-op** — "up to date, audited 369 packages";
   no package.json/package-lock.json changes resulted from this task (the working tree
   already had pre-existing, unrelated modifications before this session).
3. Re-ran `npm run dependency:audit` (after): **identical — 2 high, 0 critical**;
   exit 1.
4. `npm audit fix --force` was **not** run: it is the only automated remediation and
   would install `electron@45.1.0` (`npm audit --json` fixAvailable:
   `{"name":"electron","version":"45.1.0","isSemVerMajor":true}`), a breaking major
   change that conflicts with the deliberate Electron 34 pin for the macOS 12 host
   (§5). One transient text-mode audit response proposed `electron@41.7.1`; five
   repeated runs and `npm audit --json` consistently report 45.1.0, and 41.x is
   end-of-life, so the decision is unchanged.
5. Verified after the attempt (no dependency change): `npx electron . --test-ui` exits
   0 with "UI smoke passed."; `npm run check:syntax` parses 356/356 files (exit 0);
   installed versions unchanged (`electron@34.5.8`, `extract-zip@2.0.1`).

**Status: not remediated — accepted with documented rationale; the two high findings
are tracked below and remain open by design pending a host-OS migration.**

## 5. Pinned-Electron trade-off (macOS 12 vs latest)

- Host verified: **macOS 12.7.6 (Monterey)**.
- Electron 34.x platform floor (upstream README at `v34.5.8`): **macOS 11+ (Big Sur
  and up)** → macOS 12 is supported; `34.5.8` is the latest published 34.x (verified
  via `npm view electron@34 version`; no patched 34.x line exists).
- Current upstream line (main, Electron 45 era) platform floor: **macOS 13+ (Ventura
  and up)** → macOS 12 falls below the supported floor. Electron 45 is Chromium 156 /
  Node 24.22 based; binary/OS floor incompatibility makes upgrading from 34 a launch
  risk on this host.
- Trade-off: **keeping Electron 34** preserves macOS 12 host support but leaves the 46
  runtime advisories open (mostly latent given the app hardening in §3); **upgrading to
  Electron 45** clears them but abandons macOS 12 support and incurs major-version
  churn (Chromium 132→156, Node 22→24, sandboxed-preload shim removals — our preload.js
  does not use `Buffer`/`setImmediate`/`events`/`timers`/`url` shims, so that specific
  breaking change would not affect it, but the OS floor mismatch remains the blocker).
- Recommendation: keep the 34 pin until the host fleet moves to macOS 13+; block
  automatic `npm audit fix --force` in CI with an explicit macOS-12 validation gate;
  re-run this audit on every dependency change; re-evaluate when a fixed release exists
  within a macOS-12-compatible line or the host OS is upgraded.

## 6. Verification evidence

| Check                      | Before                       | After                                    |
| -------------------------- | ---------------------------- | ---------------------------------------- |
| `npm run dependency:audit` | 2 high / 0 critical (exit 1) | 2 high / 0 critical (exit 1) — unchanged |
| `npx electron . --test-ui` | exit 0, "UI smoke passed."   | exit 0, "UI smoke passed."               |
| `npm run check:syntax`     | —                            | 356/356 files parsed, exit 0             |
| `electron` version         | 34.5.8                       | 34.5.8                                   |
| `extract-zip` version      | 2.0.1                        | 2.0.1                                    |

Changes made by this task: only this document created. No dependency changes, no
commits.
