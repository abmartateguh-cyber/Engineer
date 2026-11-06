#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKSTATION_URL = 'http://127.0.0.1:3000';

const server = spawn(process.execPath, ['src/main/workstation_web_server.js'], {
  cwd: ROOT,
  stdio: 'inherit'
});

const openBrowser = () => {
  const { platform } = process;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [WORKSTATION_URL];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', WORKSTATION_URL];
  } else {
    cmd = 'xdg-open';
    args = [WORKSTATION_URL];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch (_) {
    // browser launch is best-effort; server keeps running
  }
};

setTimeout(openBrowser, 1500);

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
