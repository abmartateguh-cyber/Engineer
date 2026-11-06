/**
 * OmniEng Main Process (Electron Application)
 * Connects experimental JavaScript calculation examples, local file systems, and IPC bridges.
 *
 * Architecture & Security Hardening:
 * - Project-specific IPC input checks through defineHandler and domain routers
 * - Sandbox enabled, context isolation enforced, node integration disabled
 * - Navigation and window-open guards (CWE-200 / CWE-94)
 * - Zero raw ipcMain.handle calls in main process
 */

'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// Master Schema-Validated IPC Hub
const { registerAllIpcHandlers } = require('./src/main/ipc');
const { computeWindowBounds } = require('./src/main/window_bounds');

// Domain Service Singletons (only those consumed by the IPC routers)
const { CloudHPCEngine } = require('./src/core/hpc/cloud_cluster');
const {
  DropTestWizard,
  DroneDesignWizard,
  CameraLensWizard,
  PCBDesignWizard
} = require('./src/ui/wizards/design_wizards');
const { ImmutableAuditLedger } = require('./src/core/compliance/immutable_audit_ledger');
const { OutOfCoreAssemblyManager } = require('./src/core/cad/out_of_core_octree');
const { KeymapManager } = require('./src/ui/keymap_manager');

const auditLedger = new ImmutableAuditLedger('OmniEng_Experimental_Local_Session_2026');
const outOfCoreOctree = new OutOfCoreAssemblyManager();
const keymapManager = new KeymapManager();
const hpcEngine = new CloudHPCEngine({ provider: 'local' });

// In-process software key signing provider for audit trail records.
// This uses an ECDSA P-256 (prime256v1) key generated in Node's crypto
// module; it is NOT a PKCS#11 hardware token, and no FIPS or hardware
// security module guarantees are implied or provided.
class SoftwareHsmProvider {
  constructor() {
    this._keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
  }
  sign({ payload, keyId = 'omni-ec-signer-1' } = {}) {
    try {
      if (typeof payload !== 'string' || payload.length === 0) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A non-empty payload string is required.' }
        };
      }
      const signer = crypto.createSign('SHA256');
      signer.update(payload);
      signer.end();
      const signatureHex = signer.sign(this._keyPair.privateKey, 'hex');
      return {
        success: true,
        keyId,
        algorithm: 'ECDSA-P256-SHA256',
        signatureHex,
        publicKeyPem: this._keyPair.publicKey
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL', message: `Software key signing failed: ${error.message}` }
      };
    }
  }
  verify({ payload, signatureHex, publicKeyPem } = {}) {
    try {
      if (typeof payload !== 'string' || payload.length === 0) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A non-empty payload string is required.' }
        };
      }
      if (typeof signatureHex !== 'string' || signatureHex.length === 0) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'A hex-encoded signature is required.' }
        };
      }
      const pubKey = publicKeyPem || this._keyPair.publicKey;
      const verifier = crypto.createVerify('SHA256');
      verifier.update(payload);
      verifier.end();
      const valid = verifier.verify(pubKey, Buffer.from(signatureHex, 'hex'));
      return { success: true, valid, algorithm: 'ECDSA-P256-SHA256' };
    } catch (error) {
      return {
        success: false,
        error: { code: 'INTERNAL', message: `Software key verification failed: ${error.message}` }
      };
    }
  }
}
const hsmProvider = new SoftwareHsmProvider();

// Validation Service wrapper for V&V benchmarks. It delegates to the shipped
// core registry (src/core/vv/vv_registry.js) and never requires test-tree
// modules, which are excluded from the packaged asar.
const validationService = {
  runBenchmarks({ suite } = {}) {
    try {
      const { runAllVVBenchmarks, listVVBenchmarks } = require('./src/core/vv/vv_registry');
      const report = runAllVVBenchmarks();
      return {
        success: true,
        suite: suite === 'extended' ? 'extended' : 'core',
        catalog: listVVBenchmarks(),
        ...report,
        releaseApproved: false
      };
    } catch (error) {
      return {
        success: false,
        validationLevel: 'experimental',
        releaseApproved: false,
        error: {
          code: 'INTERNAL',
          message: `V&V benchmark execution failed: ${error.message}`
        }
      };
    }
  }
};

const designWizards = {
  drop_test: new DropTestWizard(),
  drone: new DroneDesignWizard(),
  camera_lens: new CameraLensWizard(),
  pcb: new PCBDesignWizard()
};

function createWindow() {
  let bounds = computeWindowBounds();
  try {
    const primaryDisplay = screen ? screen.getPrimaryDisplay() : null;
    if (primaryDisplay && primaryDisplay.workAreaSize) {
      bounds = computeWindowBounds(primaryDisplay.workAreaSize);
    }
  } catch (_) {
    // fallback if screen is unavailable
  }

  if (process.env.OMNIENG_WINDOW_DEBUG === '1') {
    console.log(
      `[window] workArea=${JSON.stringify(screen ? screen.getPrimaryDisplay()?.workAreaSize : null)} bounds=${JSON.stringify(bounds)}`
    );
  }

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    title: 'OmniEng — Experimental Engineering Workbench',
    backgroundColor: '#090d16',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      enableWebSQL: false,
      devTools: !app.isPackaged && !process.argv.includes('--no-devtools')
    }
  });

  // Strict Navigation & Window Opening Security Guards (CWE-200 / CWE-94)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || !url.startsWith('file://')) {
      return { action: 'deny' };
    }
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(new URL(url).pathname);
    } catch {
      return { action: 'deny' };
    }
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(requestedPath)) {
      requestedPath = requestedPath.slice(1);
    }
    const panelHostPath = path.join(__dirname, 'src', 'ui', 'panel_host.html');
    if (path.normalize(requestedPath) !== path.normalize(panelHostPath)) {
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      }
    };
  });
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

// macOS 12 (Monterey) Intel-host diagnostic path: the packaged window can hang
// at load when the hardware-accelerated compositor fails under the bundled
// Chromium GPU stack. `--disable-gpu` (or OMNIENG_DISABLE_GPU=1) routes
// around the compositor for diagnosis. The web-mode workstation server remains
// the documented primary fallback for Monterey hosts (see packaging report).
if (process.argv.includes('--disable-gpu') || process.env.OMNIENG_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
}

app.whenReady().then(() => {
  // Enterprise Headless CLI Mode Handling
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    const pkg = require('./package.json');
    console.log(`${pkg.productName || 'OmniEng'} v${pkg.version} [experimental workbench]`);
    app.exit(0);
    return;
  }

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
OmniEng — Experimental Engineering Workbench
Version: ${require('./package.json').version} (experimental; not release-approved)

Usage:
  omnieng [options] [project.omni]

Options:
  --version, -v          Display platform release version and build info
  --help, -h             Display command-line options
  --benchmark            Run benchmarks (currently unavailable)
  --test-ui              Run the Electron UI diagnostic mode
  --capture              Run automated visual showcase and screenshot capture
  --no-devtools          Launch without developer inspection tools
`);
    app.exit(0);
    return;
  }

  if (process.argv.includes('--benchmark')) {
    console.error(
      'No released benchmark service is configured. Use the experimental test diagnostics with `npm run test:vv`.'
    );
    app.exit(2);
    return;
  }

  // Register domain IPC handlers with project-specific input checks.
  registerAllIpcHandlers({
    auditLedger,
    outOfCoreOctree,
    keymapManager,
    hpcEngine,
    designWizards,
    validationService,
    hsmProvider
  });

  const win = createWindow();

  win.webContents.on('console-message', (e, level, msg, line, src) => {
    console.log(`[Renderer Console lvl=${level}] ${msg} (${src}:${line})`);
  });

  if (process.argv.includes('--test-ui')) {
    const rendererErrors = [];
    let finished = false;
    let timeout;
    const finish = (exitCode, message) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      (exitCode === 0 ? console.log : console.error)(message);
      app.exit(exitCode);
    };

    win.webContents.on('console-message', (event, level, message, line, source) => {
      if (level >= 3 && !message.includes('favicon')) {
        rendererErrors.push({ message, line, source });
      }
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        finish(1, `UI smoke failed to load ${validatedURL}: ${errorDescription} (${errorCode}).`);
      }
    });

    timeout = setTimeout(
      () => finish(1, 'UI smoke failed: the renderer did not finish loading within 30 seconds.'),
      30_000
    );
    win.webContents.once('did-finish-load', async () => {
      try {
        const results = await win.webContents.executeJavaScript(`
          (async () => {
            const checks = [];
            const check = (passed, name) => checks.push({ passed: Boolean(passed), name });
            check(document.readyState === 'complete', 'Renderer document completed loading');
            check(document.title.includes('Experimental Engineering Workbench'), 'Window title identifies the experimental workbench');
            check(document.body.classList.contains('app-shell'), 'Application shell rendered');
            check(
              ['consumer', 'eda', 'aerospace', 'oilgas', 'simulink', 'universal_cad'].every((studio) =>
                document.querySelector('.studio-switcher .studio-btn[data-studio="' + studio + '"]')
              ),
              'Core domain studio tabs rendered'
            );
            check(['btn-open-palette', 'ribbon-btn-new-project', 'ribbon-btn-open-project', 'ribbon-btn-save-project', 'workspace-tab-bar', 'viewport-stats', 'ai-copilot-dock'].every((id) => document.getElementById(id)), 'Core workspace controls rendered');
            check(document.getElementById('status-maturity-label')?.textContent.includes('experimental'), 'Visible status identifies experimental maturity');
            check(typeof window.omniEngAPI?.getFeatureMaturity === 'function', 'Compatibility preload exposes the maturity query');
            check(typeof window.omnieng?.projects?.openProject === 'function', 'Grouped preload exposes the project API');

            const maturity = await window.omniEngAPI.getFeatureMaturity();
            const domains = Object.values(maturity?.domains ?? {});
            check(maturity?.success === true && domains.length > 0, 'Maturity IPC returns registered domains');
            check(domains.every((domain) => domain.state === 'experimental' && domain.releaseApproved === false), 'Registered domains remain experimental and unapproved');
            return checks;
          })();
        `);

        for (const result of results) {
          console.log(`${result.passed ? '✓' : '✗'} ${result.name}`);
        }
        if (rendererErrors.length > 0) {
          for (const error of rendererErrors) {
            console.error(`Renderer console error: ${error.message} (${error.source}:${error.line})`);
          }
        }

        const passed = results.every((result) => result.passed) && rendererErrors.length === 0;
        finish(passed ? 0 : 1, passed ? 'UI smoke passed.' : 'UI smoke failed.');
      } catch (error) {
        finish(1, `UI smoke failed: ${error.stack || error.message || error}`);
      }
    });
    return;
  }

  if (process.argv.includes('--capture-rocket')) {
    win.webContents.on('did-finish-load', async () => {
      console.log('[OmniEng Capture] WebContents loaded. Preparing the synthetic aerospace example...');
      const outputDir = process.env.CAPTURE_OUTPUT_DIR || path.join(__dirname, 'screenshots');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await sleep(2500);

      // Shot 1: Full application with illustrative vehicle geometry
      console.log('[OmniEng Capture] Preparing illustrative vehicle geometry...');
      await win.webContents.executeJavaScript(`
        (() => {
          const btnRocket = document.getElementById('ribbon-btn-nasa-rocket');
          if (btnRocket) btnRocket.click();
          if (window.viewport3D && window.viewport3D.camera && window.viewport3D.controls) {
            window.viewport3D.camera.position.set(0, 75, 220);
            window.viewport3D.controls.target.set(0, 60, 0);
            window.viewport3D.controls.update();
          }
        })();
      `);
      await sleep(1500);

      console.log('[OmniEng Capture] Capturing illustrative vehicle geometry...');
      const fullApp = await win.capturePage();
      fs.writeFileSync(path.join(outputDir, 'omnieng_synthetic_aerospace_full_app.png'), fullApp.toPNG());

      // Get canvas bounds
      const canvasRect = await win.webContents.executeJavaScript(`
        (() => {
          const el = document.getElementById('three-canvas');
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        })();
      `);

      // Shot 2: Illustrative vehicle geometry close-up
      console.log('[OmniEng Capture] Capturing illustrative vehicle geometry...');
      const rocket3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'omnieng_synthetic_aerospace_viewport_3d.png'), rocket3D.toPNG());

      // Shot 3: Illustrative engine geometry
      console.log('[OmniEng Capture] Switching to illustrative engine geometry...');
      await win.webContents.executeJavaScript(`
        (() => {
          const btnEngine = document.getElementById('btn-cad-nasa-engine');
          if (btnEngine) btnEngine.click();
          if (window.viewport3D && window.viewport3D.camera && window.viewport3D.controls) {
            window.viewport3D.camera.position.set(0, 25, 75);
            window.viewport3D.controls.target.set(0, 15, 0);
            window.viewport3D.controls.update();
          }
        })();
      `);
      await sleep(1500);
      const engine3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'omnieng_synthetic_engine_viewport_3d.png'), engine3D.toPNG());

      // Shot 4: Aerospace subsystem data availability modal
      console.log('[OmniEng Capture] Opening the aerospace subsystem source-status modal...');
      const diag = await win.webContents.executeJavaScript(`
        (() => {
          const m = document.getElementById('modal-nasa-wbs');
          if (typeof window.openNasaWbsModal === 'function') {
            window.openNasaWbsModal();
          } else {
            const btnWbs = document.getElementById('ribbon-btn-nasa-wbs');
            if (btnWbs) btnWbs.click();
          }
          const card = m ? m.querySelector('.modal-card') : null;
          return {
            hasFn: typeof window.openNasaWbsModal,
            modalFound: !!m,
            modalClasses: m ? m.className : null,
            modalRect: m ? m.getBoundingClientRect() : null,
            cardFound: !!card,
            cardRect: card ? card.getBoundingClientRect() : null,
            cardVisible: card ? window.getComputedStyle(card).visibility : null,
            cardOpacity: card ? window.getComputedStyle(card).opacity : null,
            cardDisplay: card ? window.getComputedStyle(card).display : null,
            parentTag: m ? m.parentElement.tagName : null,
            parentId: m ? m.parentElement.id : null,
            parentClass: m ? m.parentElement.className : null
          };
        })();
      `);
      console.log('[OmniEng Capture] Modal diagnostics:', JSON.stringify(diag, null, 2));
      await sleep(1800);
      const wbsModal = await win.capturePage();
      fs.writeFileSync(path.join(outputDir, 'omnieng_aerospace_source_status.png'), wbsModal.toPNG());

      console.log('[OmniEng Capture] Synthetic aerospace screenshots saved to:', outputDir);
      app.quit();
    });
  }

  if (process.argv.includes('--capture')) {
    win.webContents.on('did-finish-load', async () => {
      console.log('[OmniEng Capture] WebContents loaded. Preparing showcase...');
      const outputDir = process.env.CAPTURE_OUTPUT_DIR || path.join(__dirname, 'screenshots');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await sleep(1800);

      // Switch to 50mm Lens Cutaway
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = document.getElementById('subtab-lens');
          if (btn) btn.click();
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 10);
            window.viewport3D.cameraAngle = { theta: 0.55, phi: 0.75 };
            window.viewport3D.cameraDistance = 145;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(2000);

      // Shot 1: Full App UI
      console.log('[OmniEng Capture] Capturing full application UI...');
      const fullApp = await win.capturePage();
      fs.writeFileSync(path.join(outputDir, 'omnieng_camera_lens_app_ui.png'), fullApp.toPNG());

      // Get canvas rect
      const canvasRect = await win.webContents.executeJavaScript(`
        (() => {
          const el = document.getElementById('three-canvas');
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        })();
      `);

      // Shot 2: 3D Viewport Inside Cutaway (Rear / Sensor & Master Group)
      console.log('[OmniEng Capture] Capturing 3D viewport inside cutaway (Rear / Sensor)...');
      const cutaway3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_cutaway_inside.png'), cutaway3D.toPNG());

      // Shot 2B: 3D Viewport Front Entrance Pupil Cutaway (Front Aspheric, Crown & Doublet)
      console.log('[OmniEng Capture] Capturing 3D viewport front entrance cutaway...');
      await win.webContents.executeJavaScript(`
        (() => {
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, -5);
            window.viewport3D.cameraAngle = { theta: 2.45, phi: 0.85 };
            window.viewport3D.cameraDistance = 140;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1000);
      const frontCutaway3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_cutaway_front_iso.png'), frontCutaway3D.toPNG());

      // Shot 2C: 3D Cross-Sectional Profile Inspection (Full Optomechanical Optical Train)
      console.log('[OmniEng Capture] Capturing full optomechanical cross-section profile...');
      await win.webContents.executeJavaScript(`
        (() => {
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 10);
            window.viewport3D.cameraAngle = { theta: 1.35, phi: 0.82 };
            window.viewport3D.cameraDistance = 145;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1000);
      const profile3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_cross_section_profile.png'), profile3D.toPNG());

      // Shot 3: Exploded View
      console.log('[OmniEng Capture] Setting exploded view 65%...');
      await win.webContents.executeJavaScript(`
        (() => {
          const slider = document.getElementById('lens-explode-slider');
          if (slider) {
            slider.value = 65;
            slider.dispatchEvent(new Event('input'));
          }
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 10);
            window.viewport3D.cameraAngle = { theta: 0.65, phi: 0.85 };
            window.viewport3D.cameraDistance = 210;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1200);
      const exploded3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_exploded_view.png'), exploded3D.toPNG());

      // Shot 4: Closed f/16 Aperture
      console.log('[OmniEng Capture] Setting f/16 aperture...');
      await win.webContents.executeJavaScript(`
        (() => {
          const slider = document.getElementById('lens-explode-slider');
          if (slider) {
            slider.value = 0;
            slider.dispatchEvent(new Event('input'));
          }
          const sel = document.getElementById('lens-fstop');
          if (sel) {
            sel.value = '16';
            sel.dispatchEvent(new Event('change'));
          }
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 4);
            window.viewport3D.cameraAngle = { theta: 0.50, phi: 0.65 };
            window.viewport3D.cameraDistance = 115;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1200);
      const f16_3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_aperture_f16.png'), f16_3D.toPNG());

      console.log('[OmniEng Capture] All showcase screenshots saved to:', outputDir);
      app.quit();
    });
  }

  if (process.argv.includes('--capture-pid')) {
    win.webContents.on('did-finish-load', async () => {
      console.log('[OmniEng Capture] P&ID studio capture starting...');
      const outputDir = process.env.CAPTURE_OUTPUT_DIR || path.join(__dirname, 'screenshots', 'pid');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await sleep(1600);

      await win.webContents.executeJavaScript(`
        (() => {
          const btn = document.querySelector('.studio-btn[data-studio="oilgas"]');
          if (btn) btn.click();
        })();
      `);
      await sleep(900);

      await win.webContents.executeJavaScript(`
        (() => {
          const ribbon = document.getElementById('ribbon-btn-pid');
          if (ribbon) ribbon.click();
        })();
      `);
      await sleep(1000);

      await win.webContents.executeJavaScript(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('#pid-studio-body button'));
          const gen = buttons.find((b) => b.textContent.trim() === 'Generate P&ID');
          if (gen) gen.click();
        })();
      `);

      let svgReady = false;
      for (let i = 0; i < 60; i++) {
        svgReady = await win.webContents.executeJavaScript(`
          Boolean(document.querySelector('#pid-studio-body svg'))
        `);
        if (svgReady) break;
        await sleep(300);
      }
      await sleep(1000);

      const state = await win.webContents.executeJavaScript(`
        (() => {
          const svg = document.querySelector('#pid-studio-body svg');
          const status = document.querySelector('#pid-studio-body .pid-statusline');
          return {
            svgPresent: Boolean(svg),
            svgChildren: svg ? svg.querySelectorAll('*').length : 0,
            status: status ? status.textContent : ''
          };
        })();
      `);

      const fullApp = await win.capturePage();
      fs.writeFileSync(path.join(outputDir, 'app_pid_studio.png'), fullApp.toPNG());
      console.log('[OmniEng Capture] Saved app_pid_studio.png');
      console.log('[OmniEng Capture] State:', JSON.stringify(state));

      if (!state.svgPresent) {
        console.error('[OmniEng Capture] FAILED: P&ID SVG did not render.');
        app.exit(1);
        return;
      }
      app.exit(0);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
