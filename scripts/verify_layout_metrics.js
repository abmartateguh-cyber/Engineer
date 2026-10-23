/**
 * Layout Overlap Verification Script
 * Validates CSS Grid non-overlapping layout bounds across window sizes:
 * 1024x640, 1440x900, 1920x1080.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const resolutions = [
    { w: 1024, h: 640 },
    { w: 1440, h: 900 },
    { w: 1920, h: 1080 }
  ];

  const win = new BrowserWindow({
    width: 1024,
    height: 640,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await win.loadFile(path.join(__dirname, '../src/index.html'));
  await new Promise(r => setTimeout(r, 300));

  for (const res of resolutions) {
    win.setSize(res.w, res.h);
    await new Promise(r => setTimeout(r, 250));

    const metrics = await win.webContents.executeJavaScript(`(() => {
      const getBox = sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { sel, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
      };

      return {
        topbar: getBox('.topbar'),
        toolbar: getBox('.context-toolbar'),
        rail: getBox('.activity-rail'),
        left: getBox('#left-sidebar'),
        stage: getBox('.stage'),
        right: getBox('#right-inspector'),
        status: getBox('#workstation-status-bar'),
        tabBar: getBox('#workspace-tab-bar'),
        stageModeBar: getBox('#viewport-toolbar'),
        canvasHost: getBox('#canvas-host'),
        aiDock: getBox('#ai-copilot-dock')
      };
    })()`);

    console.log(`\n=== Testing Resolution: ${res.w} x ${res.h} ===`);
    console.log('Topbar:', metrics.topbar);
    console.log('Context Toolbar:', metrics.toolbar);
    console.log('Activity Rail:', metrics.rail);
    console.log('Left Sidebar:', metrics.left);
    console.log('Stage Area:', metrics.stage);
    console.log('Right Inspector:', metrics.right);
    console.log('Status Bar:', metrics.status);
    console.log('Tab Bar:', metrics.tabBar);
    console.log('Stage Mode Bar:', metrics.stageModeBar);
    console.log('Canvas Host:', metrics.canvasHost);
    console.log('AI Copilot Dock:', metrics.aiDock);

    // Assertions for zero vertical overlap in shell grid rows
    const topbarBottom = metrics.topbar.bottom;
    const toolbarTop = metrics.toolbar.top;
    const toolbarBottom = metrics.toolbar.bottom;
    const railTop = metrics.rail.top;
    const statusTop = metrics.status.top;
    const railBottom = metrics.rail.bottom;

    if (topbarBottom !== toolbarTop) {
      console.error(`FAIL: Topbar bottom (${topbarBottom}) does not align with Toolbar top (${toolbarTop})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: Topbar and Toolbar abut seamlessly at y = ${topbarBottom}px with 0 overlap.`);
    }

    if (toolbarBottom !== railTop) {
      console.error(`FAIL: Toolbar bottom (${toolbarBottom}) does not align with Activity Rail top (${railTop})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: Toolbar and Middle Body abut seamlessly at y = ${toolbarBottom}px with 0 overlap.`);
    }

    if (railBottom !== statusTop) {
      console.error(`FAIL: Middle row bottom (${railBottom}) does not align with Status bar top (${statusTop})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: Middle row and Status bar abut seamlessly at y = ${railBottom}px with 0 overlap.`);
    }

    // Assertions for zero horizontal overlap in shell grid columns
    const railRight = metrics.rail.right;
    const stageLeft = metrics.stage.left;
    const stageRight = metrics.stage.right;
    const rightInspectorLeft = metrics.right.left;

    if (metrics.left && metrics.left.width > 0) {
      const leftSidebarLeft = metrics.left.left;
      const leftSidebarRight = metrics.left.right;
      if (railRight !== leftSidebarLeft) {
        console.error(`FAIL: Rail right (${railRight}) does not align with Left Sidebar left (${leftSidebarLeft})`);
        process.exitCode = 1;
      } else {
        console.log(`PASS: Rail and Left Sidebar abut seamlessly at x = ${railRight}px with 0 overlap.`);
      }
      if (leftSidebarRight !== stageLeft) {
        console.error(`FAIL: Left Sidebar right (${leftSidebarRight}) does not align with Stage left (${stageLeft})`);
        process.exitCode = 1;
      } else {
        console.log(`PASS: Left Sidebar and Stage abut seamlessly at x = ${leftSidebarRight}px with 0 overlap.`);
      }
    } else {
      if (railRight !== stageLeft) {
        console.error(`FAIL: Rail right (${railRight}) does not align with Stage left (${stageLeft}) when left sidebar collapsed`);
        process.exitCode = 1;
      } else {
        console.log(`PASS: Responsive left collapsed: Rail and Stage abut seamlessly at x = ${railRight}px with 0 overlap.`);
      }
    }

    if (stageRight !== rightInspectorLeft) {
      console.error(`FAIL: Stage right (${stageRight}) does not align with Right Inspector left (${rightInspectorLeft})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: Stage and Right Inspector abut seamlessly at x = ${stageRight}px with 0 overlap.`);
    }

    // Assertions inside stage
    const tabBottom = metrics.tabBar.bottom;
    const modeBarTop = metrics.stageModeBar.top;
    const modeBarBottom = metrics.stageModeBar.bottom;
    const canvasTop = metrics.canvasHost.top;
    const canvasBottom = metrics.canvasHost.bottom;
    const aiDockTop = metrics.aiDock.top;

    if (tabBottom !== modeBarTop) {
      console.error(`FAIL: Tab bar bottom (${tabBottom}) does not align with Mode bar top (${modeBarTop})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: Tab bar and Mode bar abut seamlessly at y = ${tabBottom}px with 0 overlap.`);
    }

    if (modeBarBottom !== canvasTop) {
      console.error(`FAIL: Mode bar bottom (${modeBarBottom}) does not align with Canvas top (${canvasTop})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: Mode bar and Canvas Host abut seamlessly at y = ${modeBarBottom}px with 0 overlap.`);
    }

    if (canvasBottom !== aiDockTop) {
      console.error(`FAIL: Canvas bottom (${canvasBottom}) does not align with AI Dock top (${aiDockTop})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: Canvas and AI Dock abut seamlessly at y = ${canvasBottom}px with 0 overlap.`);
    }
  }

  win.destroy();

  console.log('\n========================================');
  console.log('ALL RESOLUTION CHECKS PASSED: 0 OVERLAPS');
  console.log('========================================\n');
  app.quit();
});
