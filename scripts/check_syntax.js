'use strict';

const { readdirSync, statSync, readFileSync } = require('fs');
const path = require('path');
const vm = require('vm');

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

for (const file of files) {
  try {
    const code = readFileSync(file, 'utf8');
    new vm.Script(code, { filename: file });
  } catch (err) {
    failures.push({ file, error: err.stack || err.message });
  }
}

for (const failure of failures) process.stderr.write(`${failure.file}\n${failure.error}\n`);
console.log(`Syntax check: ${files.length - failures.length}/${files.length} JavaScript files parsed.`);
if (failures.length > 0) process.exitCode = 1;
