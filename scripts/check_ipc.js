/**
 * OmniEng IPC Security & Architecture Verification Gate
 * 
 * Verifies that:
 * 1. 100% of IPC channels are registered through defineHandler with schemas
 * 2. Zero raw `ipcMain.handle(` calls exist outside define_handler.js (CWE-20 / CWE-1321 compliance)
 * 3. All channels exposed in preload.js are registered in the IPC router catalog
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function findFiles(dir, filterFn, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'build') {
        findFiles(fullPath, filterFn, files);
      }
    } else if (filterFn(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function runCheck() {
  console.log('================================================================');
  console.log('   OMNIENG IPC SECURITY & ARCHITECTURE VERIFICATION GATE       ');
  console.log('================================================================\n');

  let errors = 0;

  // 1. Scan for raw ipcMain.handle outside define_handler.js
  const jsFiles = findFiles(ROOT_DIR, f => f.endsWith('.js') && !f.includes('/test/') && !f.includes('/scripts/'));
  const allowedHandlerFile = path.resolve(ROOT_DIR, 'src', 'main', 'ipc', 'define_handler.js');

  const rawHandlePattern = /\bipcMain\.handle\s*\(/g;

  for (const file of jsFiles) {
    if (path.resolve(file) === allowedHandlerFile) continue;

    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(rawHandlePattern);
    if (matches) {
      console.error(`  ✗ VIOLATION: Raw 'ipcMain.handle(' found in ${path.relative(ROOT_DIR, file)} (${matches.length} occurrences). Must use defineHandler!`);
      errors += matches.length;
    }
  }

  // 2. Extract channels from preload.js
  const preloadPath = path.resolve(ROOT_DIR, 'preload.js');
  const preloadContent = fs.readFileSync(preloadPath, 'utf8');
  const preloadMatches = preloadContent.match(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g) || [];
  const preloadChannels = new Set(preloadMatches.map(m => m.match(/['"]([^'"]+)['"]/)[1]));

  console.log(`[Gate Check] Found ${preloadChannels.size} unique channels exposed in preload.js`);

  // 3. Extract channels registered in src/main/ipc/*.js
  const ipcFiles = [
    'cad_ipc.js',
    'cae_ipc.js',
    'eda_ipc.js',
    'optics_ipc.js',
    'plant_ipc.js',
    'controls_ipc.js',
    'system_ipc.js'
  ];

  const registeredChannels = new Set();
  const definePattern = /defineHandler\(\s*['"]([^'"]+)['"]/g;

  for (const f of ipcFiles) {
    const fPath = path.resolve(ROOT_DIR, 'src', 'main', 'ipc', f);
    if (!fs.existsSync(fPath)) {
      console.error(`  ✗ MISSING ROUTER: ${f} does not exist`);
      errors++;
      continue;
    }
    const content = fs.readFileSync(fPath, 'utf8');
    let m;
    while ((m = definePattern.exec(content)) !== null) {
      registeredChannels.add(m[1]);
    }
  }

  console.log(`[Gate Check] Found ${registeredChannels.size} schema-validated channels in src/main/ipc/*.js`);

  // 4. Verify all preload channels are registered
  for (const channel of preloadChannels) {
    if (!registeredChannels.has(channel)) {
      console.error(`  ✗ UNROUTED CHANNEL: '${channel}' exposed in preload.js but not registered in src/main/ipc/`);
      errors++;
    }
  }

  if (errors === 0) {
    console.log('\n  ✓ PASSED: 100% of IPC channels schema-validated with zero raw ipcMain.handle violations!');
    console.log('================================================================\n');
    return true;
  } else {
    console.error(`\n  ✗ FAILED: ${errors} architecture & security violations detected!`);
    console.log('================================================================\n');
    return false;
  }
}

if (require.main === module) {
  const success = runCheck();
  process.exit(success ? 0 : 1);
}

module.exports = { runCheck };
