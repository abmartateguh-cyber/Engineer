const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Register all IPC handlers so IPC calls work
const { registerAllIpcHandlers } = require('../src/main/ipc/index');
const auditLedger = { recordEvent: () => {} };
const outOfCoreOctree = {};
const keymapManager = {};
const dockingManager = {};
const dipprDatabase = {};
const aiEngine = {};
const hpcEngine = {};
const symbolicReasoner = {};
const designWizards = {};

app.whenReady().then(async () => {
  registerAllIpcHandlers({
    auditLedger,
    outOfCoreOctree,
    keymapManager,
    dockingManager,
    dipprDatabase,
    aiEngine,
    hpcEngine,
    symbolicReasoner,
    designWizards
  });

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  await win.loadFile(path.join(__dirname, '../src/index.html'));

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(2500);

  const outputDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('[Capture] Step 1: Solving Cryogenic Loading Cycle...');
  await win.webContents.executeJavaScript(`
    (async () => {
      const btnRocket = document.getElementById('ribbon-btn-nasa-rocket');
      if (btnRocket) btnRocket.click();
      await new Promise(r => setTimeout(r, 800));
      const btnCryo = document.getElementById('btn-solve-cryo-flowsheet');
      if (btnCryo) btnCryo.click();
      await new Promise(r => setTimeout(r, 500));
      const telem = document.getElementById('nasa-propulsion-telemetry-container');
      if (telem) telem.scrollIntoView({ behavior: 'instant', block: 'center' });
    })();
  `);
  await sleep(1500);

  const cryoShot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, 'omnieng_nasa_cryo_telemetry.png'), cryoShot.toPNG());
  console.log('[Capture] Saved omnieng_nasa_cryo_telemetry.png');

  console.log('[Capture] Step 2: Simulating Dual ASI SPICE Ignition...');
  await win.webContents.executeJavaScript(`
    (async () => {
      const btnAsi = document.getElementById('btn-solve-asi-ignition');
      if (btnAsi) btnAsi.click();
      await new Promise(r => setTimeout(r, 500));
      const telem = document.getElementById('nasa-propulsion-telemetry-container');
      if (telem) telem.scrollIntoView({ behavior: 'instant', block: 'center' });
    })();
  `);
  await sleep(1500);

  const asiShot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, 'omnieng_nasa_asi_telemetry.png'), asiShot.toPNG());
  console.log('[Capture] Saved omnieng_nasa_asi_telemetry.png');

  console.log('[Capture] Step 3: Triggering 3D Part Selection for NASA WBS Property Grid...');
  await win.webContents.executeJavaScript(`
    (async () => {
      if (window.viewport3D && window.viewport3D.scene) {
        let rocketPart = null;
        window.viewport3D.scene.traverse(obj => {
          if (!rocketPart && obj.isMesh && obj.userData && (obj.userData.isNasaEntity || obj.userData.wbsId)) {
            rocketPart = obj;
          }
        });
        if (rocketPart) {
          window.viewport3D.selectPart(rocketPart);
        } else {
          // Direct call to renderPropertyGrid with NASA entity data
          if (window.renderPropertyGrid) {
            window.renderPropertyGrid({
              name: 'Al-Li 2195 Cryogenic Isogrid LOX Tank',
              type: 'NASA WBS 06.02 Liquid Oxygen Tank',
              material: 'Al-Li 2195 Cryogenic Alloy',
              wbsId: '06.02',
              entityName: 'Cryogenic Tank Structure',
              specStandard: 'NASA SP-8007 / NASA-STD-5001',
              leadCenter: 'NASA Marshall (MSFC)',
              operatingPressure: '320 kPa (46.4 psia)',
              operatingTemp: '90 K (-183.2°C)',
              dimensions: { width: 5200, height: 28400, depth: 5200 },
              position: { x: 0, y: 35000, z: 0 }
            }, true);
          }
        }
        await new Promise(r => setTimeout(r, 400));
        const btnWbs = document.getElementById('btn-inspect-wbs-entity');
        if (btnWbs) btnWbs.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    })();
  `);
  await sleep(1200);

  const propShot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, 'omnieng_nasa_property_grid.png'), propShot.toPNG());
  console.log('[Capture] Saved omnieng_nasa_property_grid.png');

  console.log('[Capture] Complete!');
  app.quit();
});
