# Packaging Report — OmniEng (Electron 45.1.0, macOS x64)

## Current directory-build checkpoint — 2026-10-30

- Command: `npm run pack -- --config.directories.output=/var/folders/q7/ssjpm6kd45qft6jcftg5s99m0000gn/T/opencode/review-pack-20261030-final`
- Result: exit 0; electron-builder 26.15.3 packaged Electron 45.1.0 for darwin x64.
- `Info.plist` declares `LSMinimumSystemVersion` 13.0.0.
- `app.asar` contains 4,515 entries; `test/` and `scripts/` are absent.
- `main.js`, `preload.js`, `src/core/maturity/feature_maturity.js`, `src/core/cam/cnc_toolpath_engine.js`, `src/main/ipc/cad_ipc.js`, `src/core/cae/fvm_navier_stokes_3d.js`, `src/core/vv/vv_registry.js`, and `src/core/vv/benchmark_runners.js` match the checkout byte-for-byte.
- Signing was skipped because this host has no valid Developer ID identity. The app was not launched: the host is macOS 12.7.6, below the declared macOS 13 minimum. Installer/update/rollback behavior remains unverified.

## Previous directory-build checkpoint — 2026-10-29

- Command: `npm run pack -- --config.directories.output=/var/folders/q7/ssjpm6kd45qft6jcftg5s99m0000gn/T/opencode/review-pack-20261029`
- Result: exit 0; electron-builder 26.15.3 packaged Electron 45.1.0 for darwin x64.
- `Info.plist` declares `LSMinimumSystemVersion` 13.0.0.
- `app.asar` contains 4,515 entries; `main.js`, `preload.js`, and the maturity registry are present; `test/` and `scripts/` are absent.
- Signing was skipped because this host has no valid Developer ID identity. The app was not launched: the build host is macOS 12.7.6, below the declared macOS 13 minimum. Installer/update/rollback behavior remains unverified.

## Previous source parity recheck — 2026-10-30 (before wall-law correction)

At that earlier check the packaged `app.asar` matched the then-current checkout for `main.js`, `preload.js`, `src/core/maturity/feature_maturity.js`, `src/core/cam/cnc_toolpath_engine.js`, `src/main/ipc/cad_ipc.js`, `src/core/cae/fvm_navier_stokes_3d.js`, `src/core/vv/vv_registry.js`, and `src/core/vv/benchmark_runners.js`. The 2026-10-30 build above supersedes that package.

## Historical Electron 34.5.8 baseline

The following sections preserve the earlier Electron 34.5.8 package inspection and are not evidence for the current runtime.

Recorded environment for the historical build: macOS 21.6.0 (darwin), Node v24.16.0 (nvm), npm 11.13.0, electron-builder 26.15.3.

## 1. Configuration (electron-builder.yml)

- `appId`: com.omnieng.workstation
- `productName`: OmniEng
- `artifactName`: `${productName}-${version}-${os}-${arch}.${ext}`
- `directories.output`: dist, `directories.buildResources`: build
- `files`: `**/*` minus native/target/**, test/**, scripts/**, dist/**, **/\*.map, .git/**
- `asar`: true
- `protocols`: omnieng (OmniEng Project File)
- `mac`: hardenedRuntime true, gatekeeperAssess false, entitlements build/entitlements.mac.plist (+ inherit),
  darkModeSupport, minimumSystemVersion 12.0.0, targets dmg + zip (arm64 + x64)
- `dmg.sign`: false

### Resources referenced and verified present

- build/icon.icns, build/icon.ico, build/icon.png — present
- build/entitlements.mac.plist, build/entitlements.mac.inherit.plist — present, valid plist XML
  (allow-jit, allow-unsigned-executable-memory, files.user-selected.read-write, network.client)

## 2. Build command (timed)

```
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
time npx electron-builder --dir --mac --x64
```

- Result: SUCCESS
- Wall time: 4:52.15 (63.82s user / 25.88s system)
- Output: `dist/mac/OmniEng.app` (unpacked dir; no dmg/zip produced as requested)
- Code signing: SKIPPED — warning only, not a failure:
  `skipped macOS application code signing reason=cannot find valid "Developer ID Application" identity ... allIdentities=0 identities found`
  Classification: environment-only (no signing cert on this machine), not a config error. No electron-builder.yml change required.

## 3. Output verification

- App bundle exists: dist/mac/OmniEng.app
- Binary exists and executable: dist/mac/OmniEng.app/Contents/MacOS/OmniEng (17176 bytes, -rwxr-xr-x)
- Frameworks/Resources present (Electron 34.5.8)
- asar contains app payload: /main.js, /preload.js, /package.json, /src/** (3593 source files)
- Info.plist (`plutil -p`) confirmed:
  - LSMinimumSystemVersion = 12.0.0 ✓
  - CFBundleShortVersionString = 1.0.0 ✓ (matches package.json version)
  - CFBundleVersion = 1.0.0
  - CFBundleIdentifier = com.omnieng.workstation
  - CFBundleExecutable/Name/DisplayName = OmniEng, CFBundleIconFile = icon.icns, NSHighResolutionCapable = 1

## 4. Headless UI smoke test

```
dist/mac/OmniEng.app/Contents/MacOS/OmniEng --test-ui
```

- Launched OK; process still healthy after 40 s (killed by timeout). No stderr/stdout errors.
- PASS: Electron opens, main process stays alive, no crash.

## 5. Environment limitations

- No Apple Developer ID / signing identity available → app is unsigned; on other machines, signing
  should be enabled (CSC_LINK / CSC_KEY_PASSWORD or keychain identity) before distributing.
- `--dir` build only; dmg/zip not produced in this run (per task).
- Headless launch exercised the main process and Electron shell; full renderer/UI interaction
  coverage would require a display or CI with virtual display.

## 6. Verified checkpoint — 2026-11-04 (Electron 43.8.6, macOS 12.7.6 Intel)

- Installed runtime (node_modules/electron/dist/Electron.app/Contents/Info.plist, `plutil -p`):
  `CFBundleShortVersionString` = 43.8.6, `LSMinimumSystemVersion` = 12.0. Electron 43
  does **not** drop macOS 12 Monterey; `LSMinimumSystemVersion` 12.0 is declared.
- The earlier report rows claiming a 13.0.0 minimum refer to historical/EDI Electron package
  inspections and are superseded by the installed-runtime verification above.
- `npm run pack -- --dir` (electron-builder --dir) succeeds; ASAR ~4,565 entries; test/ and
  scripts/ excluded; ad-hoc codesign valid (no Developer ID identity on this host).
- Packaged `--test-ui` launch on this host: reproduces the recorded stall (window load does not
  complete within 120 s). Root-cause classification: GPU/compositor initialization on Intel
  macOS 12 hosts under the bundled Chromium stack (window sizing and IPC registration complete).
  Diagnostic paths added in `main.js`:
  - `--disable-gpu` / `OMNIENG_DISABLE_GPU=1` → `app.disableHardwareAcceleration()` before ready.
  - `OMNIENG_WINDOW_DEBUG=1` → logs work area + chosen window bounds at startup.
- Primary Monterey pathway (documented, verified): web workstation mode — `npm run start:web`
  serves the full workstation at `http://127.0.0.1:3000`; `test/test_workstation_web_server.js`
  8/8 PASS (180 IPC channels, session-token auth, Origin validation, CSP headers).
- PENDING-OWNER: Developer ID notarization; packaged-GUI smoke on a supported-OS matrix.
- PENDING-EXTERNAL: independent assessor launch verification.
