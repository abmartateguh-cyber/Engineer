'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const manifestPath = path.join(__dirname, 'support', 'preload_api_v1.json');
const preloadPath = path.join(__dirname, '..', 'preload.js');

function listPreloadApiMethods(source) {
  if (typeof source !== 'string' || !source.includes("contextBridge.exposeInMainWorld('omniEngAPI', {")) {
    throw new TypeError('The omniEngAPI contextBridge declaration was not found.');
  }

  return [...source.matchAll(/^  ([A-Za-z_$][A-Za-z0-9_$]*):/gm)].map((match) => match[1]);
}

function checkPreloadCompatibility() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const source = fs.readFileSync(preloadPath, 'utf8');
  const currentNames = listPreloadApiMethods(source);
  const currentSet = new Set(currentNames);
  const duplicates = currentNames.filter((name, index) => currentNames.indexOf(name) !== index);
  const missing = manifest.methodNames.filter((name) => !currentSet.has(name));

  return {
    baselineCount: manifest.methodNames.length,
    currentCount: currentNames.length,
    missing,
    duplicates
  };
}

function capturePreloadRoutes() {
  const exposed = {};
  const invocations = [];
  const source = fs.readFileSync(preloadPath, 'utf8');
  vm.runInNewContext(
    source,
    {
      require(moduleName) {
        if (moduleName !== 'electron') throw new Error(`Unexpected preload import: ${moduleName}`);
        return {
          contextBridge: {
            exposeInMainWorld(name, api) {
              exposed[name] = api;
            }
          },
          ipcRenderer: {
            invoke(channel, payload) {
              invocations.push({ channel, payload });
              return Promise.resolve({ success: true });
            }
          }
        };
      }
    },
    { filename: preloadPath, timeout: 1000 }
  );
  return { exposed, invocations };
}

module.exports = { checkPreloadCompatibility, listPreloadApiMethods, capturePreloadRoutes };
