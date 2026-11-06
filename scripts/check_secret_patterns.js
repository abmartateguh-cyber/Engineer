'use strict';

const { readFileSync } = require('fs');
const { spawnSync } = require('child_process');

const PATTERNS = [
  { name: 'RSA private key block', re: /-----BEGIN RSA PRIVATE KEY-----/ },
  { name: 'AWS access key ID (AKIA...)', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'API key followed by 64-hex secret', re: /api[_-]?key(?:[_:=\s]*["']?[0-9a-fA-F]{64})/ },
  { name: 'password assignment', re: /password\s*=\s*["'][^"']+["']/ }
];

function listTrackedFiles() {
  const result = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`check_secret_patterns: git ls-files failed: ${result.stderr || result.error}\n`);
    process.exit(2);
  }
  return result.stdout.split('\n').filter(Boolean);
}

function isIgnoredPath(file) {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.github/') || normalized.startsWith('.github/')) return true;
  if (normalized.includes('test') || normalized.includes('fixture') || normalized.includes('simulator')) {
    return true;
  }
  return false;
}

function scanFile(file) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    return [];
  }
  const hits = [];
  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.re.source, 'g');
    let match;
    while ((match = re.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const start = Math.max(0, match.index - 48);
      const end = Math.min(content.length, match.index + match[0].length + 48);
      const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
      hits.push(`${file}:${line}: ${pattern.name} -> ${snippet}`);
    }
  }
  return hits;
}

const failures = [];
for (const file of listTrackedFiles()) {
  if (isIgnoredPath(file)) continue;
  failures.push(...scanFile(file));
}

if (failures.length > 0) {
  process.stderr.write('secret-pattern scan: FAIL\n');
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}

process.stdout.write('secret-pattern scan: PASS\n');
