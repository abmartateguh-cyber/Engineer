'use strict';

/**
 * Claims-language gate for OmniEng (Industrial Readiness Specification v1,
 * "Tolerance & claims policy").
 *
 * Scans first-party prose for positive, unguarded uses of banned claim terms:
 *   certified, validated, qualified, conforms to, compliant with,
 *   production-ready, release-approved
 *
 * A positive claim is allowed only when it carries an evidence reference or is
 * negated. Files may be whitelisted by placing a marker ANYWHERE in the file:
 *   HTML:  <!-- claims:evidence:<ref> -->
 *   JS:    // claims:evidence:<ref>
 *
 * Built-in suppression rules:
 *   1. Negation preceding the match inside the same sentence (not, no, never,
 *      belum, does not, do not, is not, are not, has not, have not, not yet,
 *      unavailable, absent, cannot, contractions, un- prefix attached to the
 *      matched word, etc.).
 *   2. Negation within 40 characters AFTER the match (e.g. "X are unavailable",
 *      "X is not configured").
 *   3. Non-assertive or requirement frames: "whether ..." clauses and
 *      "requires/needs ..." complements state obligations, not possessed
 *      status, and are not claims.
 *   4. Caller-obligation notes ("callers should validate ...") that assign the
 *      validation action to callers rather than to the product.
 *   5. Metadata contexts: whole-line code comments (labels/annotations) and
 *      property assignments with a false value (e.g. `releaseApproved: false`,
 *      `certificationClaimed: false`).
 *   6. URLs are stripped before scanning; vendored third-party code
 *      (src/vendor), src/public bundles, node_modules, dist and generated
 *      directories are outside the first-party claim surface and are not
 *      scanned (same convention as ESLint / Prettier / syntax check).
 *
 * Usage: node scripts/check_claims_language.js [rootDir]
 * Exits 0 and prints "claims-language gate: PASS" when no violations are found;
 * otherwise prints file:line:match lines and exits 1.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const IGNORED_DIRS = new Set(['node_modules', 'vendor', 'public', 'dist', '.git', 'build', 'coverage']);

const BANNED_TERMS = [
  { label: 'certified', re: /\bcertified\b/g },
  { label: 'validated', re: /\bvalidated\b/g },
  { label: 'qualified', re: /\bqualified\b/g },
  { label: 'conforms to', re: /\bconforms\s+to\b/g },
  { label: 'compliant with', re: /\bcompliant\s+with\b/g },
  { label: 'production-ready', re: /\bproduction-ready\b/g },
  { label: 'release-approved', re: /\brelease-approved\b/g }
];

const NEGATION_PATTERNS = [
  /\bdoes\s+not\b/i,
  /\bdo\s+not\b/i,
  /\bis\s+not\b/i,
  /\bare\s+not\b/i,
  /\bhas\s+not\b/i,
  /\bhave\s+not\b/i,
  /\bwas\s+not\b/i,
  /\bwere\s+not\b/i,
  /\bcan\s+not\b/i,
  /\bnot\s+yet\b/i,
  /\bno\s+longer\b/i,
  /\bnot\b/i,
  /\bno\b/i,
  /\bnever\b/i,
  /\bbelum\b/i,
  /\bunavailable\b/i,
  /\babsent\b/i,
  /\bcannot\b/i,
  /\bcan't\b/i,
  /\bdon't\b/i,
  /\bdoesn't\b/i,
  /\bisn't\b/i,
  /\baren't\b/i,
  /\bwon't\b/i,
  /\bshouldn't\b/i,
  /\bmustn't\b/i,
  /\bcouldn't\b/i,
  /\bhasn't\b/i,
  /\bhaven't\b/i,
  /\bwasn't\b/i,
  /\bweren't\b/i,
  /\bain't\b/i
];

const WHETHER_RE = /\bwhether\b/i;
const REQUIRES_RE = /\b(requires?|needs?|demands?)\b/i;
const CALLER_VALIDATE_RE = /\bcallers?\s+(should|must|can|cannot)\s+validate\b/i;
const URL_RE = /https?:\/\/[^\s"')\]>]+/g;

const HTML_WHITELIST_RE = /<!--\s*claims:\s*evidence:[^>]*-->/;
const JS_WHITELIST_RE = /\/\/\s*claims:\s*evidence:[^\n]*/;

function findNegation(text) {
  let earliest = null;
  for (const pattern of NEGATION_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && (earliest === null || match.index < earliest)) earliest = match.index;
  }
  return earliest;
}

function containsNegation(text) {
  return findNegation(text) !== null;
}

function sentenceStart(text, position) {
  let start = 0;
  for (const delim of ['.', '!', '?', ';']) {
    const index = text.lastIndexOf(delim, position - 1);
    if (index > start) start = index;
  }
  return start + 1;
}

function lineOf(text, position) {
  let line = 1;
  for (let i = 0; i < position; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function isMetadataContext(text, matchStart, matchEnd) {
  const after = text.slice(matchEnd, Math.min(text.length, matchEnd + 16));
  if (/^\s*:\s*(false|FALSE|0)\b/.test(after)) return true;
  const lineStart = text.lastIndexOf('\n', matchStart - 1) + 1;
  const newlineEnd = text.indexOf('\n', matchEnd);
  const lineEnd = newlineEnd === -1 ? text.length : newlineEnd;
  const line = text.slice(lineStart, lineEnd).trim();
  return line.startsWith('//');
}

function matchAllowed(text, match) {
  const s = match.index;
  const e = s + match[0].length;

  if (isMetadataContext(text, s, e)) return true;

  const preceded = text.slice(Math.max(0, s - 2), s);
  if (/^(un|un-)$/i.test(preceded)) return true;

  const beforeStart = sentenceStart(text, s);
  const before = text.slice(beforeStart, s);
  if (containsNegation(before)) return true;

  const afterWindow = text.slice(e, Math.min(text.length, e + 80));
  const afterNegation = findNegation(afterWindow);
  if (afterNegation !== null && afterNegation <= 40) return true;

  if (WHETHER_RE.test(before)) return true;
  if (REQUIRES_RE.test(before)) return true;
  if (CALLER_VALIDATE_RE.test(afterWindow)) return true;

  return false;
}

function collectScannableFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full);
        const inScope =
          (rel.startsWith('src') && rel.endsWith('.js')) ||
          rel === 'main.js' ||
          rel === 'preload.js' ||
          (rel.startsWith('docs') && rel.endsWith('.md'));
        if (inScope) files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

function hasWhitelistMarker(content) {
  return HTML_WHITELIST_RE.test(content) || JS_WHITELIST_RE.test(content);
}

function scanFile(filePath, violations) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (hasWhitelistMarker(content)) return;
  const text = content.replace(URL_RE, ' ');
  for (const term of BANNED_TERMS) {
    term.re.lastIndex = 0;
    let match;
    while ((match = term.re.exec(text)) !== null) {
      if (!matchAllowed(text, match)) {
        violations.push(`${filePath}:${lineOf(text, match.index)}:${term.label}`);
      }
    }
  }
}

function runClaimsLanguageGate(rootDir) {
  const root = path.resolve(rootDir || DEFAULT_ROOT);
  const violations = [];
  for (const file of collectScannableFiles(root)) {
    scanFile(file, violations);
  }
  return violations;
}

function main() {
  const target = process.argv[2];
  const violations = runClaimsLanguageGate(target);
  for (const violation of violations) {
    process.stdout.write(`${violation}\n`);
  }
  if (violations.length > 0) {
    process.exitCode = 1;
    return;
  }
  process.stdout.write('claims-language gate: PASS\n');
}

if (require.main === module) {
  main();
}

module.exports = { runClaimsLanguageGate };
