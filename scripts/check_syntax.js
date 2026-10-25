'use strict';

const { readdirSync, statSync } = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const roots = ['main.js', 'preload.js', 'src', 'test', 'scripts'];
const ignoredDirectories = new Set(['node_modules', 'vendor', 'public', 'dist']);
const files = [];

function collect(entry) {
  let stat;
  try {
    stat = statSync(entry);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isFile()) {
    if (entry.endsWith('.js') || entry.endsWith('.mjs')) files.push(entry);
    return;
  }
  for (const child of readdirSync(entry, { withFileTypes: true })) {
    if (child.isDirectory() && ignoredDirectories.has(child.name)) continue;
    collect(path.join(entry, child.name));
  }
}

for (const root of roots) collect(root);

const failures = [];
let nextFile = 0;

function checkFile(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ file, error: error.message }));
    child.on('close', (code) => resolve(code === 0 ? null : { file, error: stderr || `node --check exited ${code}` }));
  });
}

async function worker() {
  while (nextFile < files.length) {
    const file = files[nextFile++];
    const failure = await checkFile(file);
    if (failure) failures.push(failure);
  }
}

(async () => {
  const workers = Array.from({ length: Math.min(6, files.length) }, () => worker());
  await Promise.all(workers);
  for (const failure of failures) process.stderr.write(`${failure.file}\n${failure.error}\n`);
  console.log(`Syntax check: ${files.length - failures.length}/${files.length} JavaScript files parsed.`);
  if (failures.length > 0) process.exitCode = 1;
})();
