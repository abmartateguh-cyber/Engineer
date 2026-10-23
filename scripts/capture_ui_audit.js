const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, '../artifacts_audit');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await win.loadFile(path.join(__dirname, '../src/index.html'));
  await new Promise(r => setTimeout(r, 1200));

  // 1. Default Main View (1440x900)
  let img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '01_main_view_1440.png'), img.toPNG());
  console.log('Captured 01_main_view_1440.png');

  // 2. Switch to Aerospace Studio
  await win.webContents.executeJavaScript(`(() => {
    const tab = document.querySelector('.studio-btn[data-studio="aerospace"]');
    if (tab) tab.click();
  })()`);
  await new Promise(r => setTimeout(r, 800));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '02_aerospace_studio_1440.png'), img.toPNG());
  console.log('Captured 02_aerospace_studio_1440.png');

  // 3. Switch to Silicon Studio + EDA View
  await win.webContents.executeJavaScript(`(() => {
    const tab = document.querySelector('.studio-btn[data-studio="silicon"]');
    if (tab) tab.click();
    const edaBtn = document.getElementById('btn-view-eda');
    if (edaBtn) edaBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 800));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '03_silicon_eda_1440.png'), img.toPNG());
  console.log('Captured 03_silicon_eda_1440.png');

  // 4. Open Command Palette Modal
  await win.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById('btn-open-palette');
    if (btn) btn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '04_command_palette_modal_1440.png'), img.toPNG());
  console.log('Captured 04_command_palette_modal_1440.png');

  // Close Command Palette and Open eBOM Modal
  await win.webContents.executeJavaScript(`(() => {
    const closeBtn = document.getElementById('btn-close-command-palette');
    if (closeBtn) closeBtn.click();
    const ebomBtn = document.getElementById('ribbon-btn-ebom');
    if (ebomBtn) ebomBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '05_ebom_modal_1440.png'), img.toPNG());
  console.log('Captured 05_ebom_modal_1440.png');

  // 5. Test 1024x640 Compact Screen
  await win.webContents.executeJavaScript(`(() => {
    const closeEbom = document.getElementById('btn-close-ebom-manager');
    if (closeEbom) closeEbom.click();
    const cadTab = document.querySelector('.studio-btn[data-studio="consumer"]');
    if (cadTab) cadTab.click();
    const view3d = document.getElementById('btn-view-3d');
    if (view3d) view3d.click();
  })()`);
  win.setSize(1024, 640);
  await new Promise(r => setTimeout(r, 800));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '06_compact_1024x640.png'), img.toPNG());
  console.log('Captured 06_compact_1024x640.png');

  win.destroy();
  app.quit();
});
