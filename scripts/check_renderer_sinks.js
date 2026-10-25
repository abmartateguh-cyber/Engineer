'use strict';

const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src');
const RENDERER_DOCUMENTS = Object.freeze(['index.html', 'ui/panel_host.html']);

const THIRD_PARTY_SCRIPTS = new Set(['vendor/three.min.js']);
const REVIEWED_INNER_HTML_ASSIGNMENTS = Object.freeze({
  'ui/app.js': 12,
  'ui/icons.js': 1,
  'ui/optical_inspector_ui.js': 2,
  'ui/spice_oscilloscope_ui.js': 1
});

const FORBIDDEN_SINKS = [
  ['outerHTML assignment', /\.outerHTML\s*=/g],
  ['insertAdjacentHTML', /\.insertAdjacentHTML\s*\(/g],
  ['document.write', /\bdocument\.write\s*\(/g],
  ['eval', /\beval\s*\(/g],
  ['Function constructor', /\bnew\s+Function\s*\(/g],
  ['runtime script creation', /\bdocument\.createElement\(\s*['"]script['"]\s*\)/g],
  ['dynamic import', /\bimport\s*\(/g]
];

function readLoadedScripts() {
  const scriptPattern = /<script\b(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>/gi;
  const scripts = [];

  for (const documentPath of RENDERER_DOCUMENTS) {
    const absoluteDocumentPath = path.resolve(SOURCE_ROOT, documentPath);
    if (!absoluteDocumentPath.startsWith(`${SOURCE_ROOT}${path.sep}`)) {
      throw new Error(`Renderer document escapes src/: ${documentPath}`);
    }

    const html = fs.readFileSync(absoluteDocumentPath, 'utf8');
    for (const match of html.matchAll(scriptPattern)) {
      scripts.push({ documentPath, sourcePath: match[1] });
    }
  }

  return scripts;
}

function checkRendererSinkInventory() {
  const scriptPaths = readLoadedScripts();
  const firstPartyScripts = new Map();
  const thirdPartyScripts = [];

  for (const { documentPath, sourcePath } of scriptPaths) {
    if (/^[a-z][a-z\d+.-]*:/i.test(sourcePath) || sourcePath.startsWith('//')) {
      throw new Error(`Renderer script is not same-origin: ${documentPath}: ${sourcePath}`);
    }

    const absolutePath = path.resolve(path.dirname(path.join(SOURCE_ROOT, documentPath)), sourcePath);
    if (!absolutePath.startsWith(`${SOURCE_ROOT}${path.sep}`)) {
      throw new Error(`Renderer script escapes src/: ${documentPath}: ${sourcePath}`);
    }

    const repositorySourcePath = path.relative(SOURCE_ROOT, absolutePath).split(path.sep).join('/');
    if (THIRD_PARTY_SCRIPTS.has(repositorySourcePath)) {
      thirdPartyScripts.push(repositorySourcePath);
      continue;
    }

    firstPartyScripts.set(repositorySourcePath, fs.readFileSync(absolutePath, 'utf8'));
  }

  const actualHtmlAssignments = {};
  const violations = [];
  for (const [sourcePath, source] of firstPartyScripts) {
    const assignmentCount = [...source.matchAll(/\.innerHTML\s*=/g)].length;
    if (assignmentCount > 0) actualHtmlAssignments[sourcePath] = assignmentCount;

    for (const [sinkName, pattern] of FORBIDDEN_SINKS) {
      const matches = [...source.matchAll(pattern)];
      if (matches.length > 0) violations.push(`${sourcePath}: ${sinkName} (${matches.length})`);
    }
  }

  if (violations.length > 0) {
    throw new Error(`Unreviewed renderer sink(s) found:\n${violations.join('\n')}`);
  }

  const sortEntries = (value) =>
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  if (
    JSON.stringify(sortEntries(actualHtmlAssignments)) !== JSON.stringify(sortEntries(REVIEWED_INNER_HTML_ASSIGNMENTS))
  ) {
    throw new Error(
      `First-party innerHTML inventory changed. Expected ${JSON.stringify(REVIEWED_INNER_HTML_ASSIGNMENTS)}, found ${JSON.stringify(actualHtmlAssignments)}.`
    );
  }

  return Object.freeze({
    rendererDocuments: RENDERER_DOCUMENTS,
    firstPartyScriptCount: firstPartyScripts.size,
    thirdPartyScripts: Object.freeze([...thirdPartyScripts]),
    innerHTMLAssignments: Object.freeze({ ...actualHtmlAssignments }),
    innerHTMLAssignmentCount: Object.values(actualHtmlAssignments).reduce((sum, count) => sum + count, 0)
  });
}

if (require.main === module) {
  try {
    const result = checkRendererSinkInventory();
    console.log(
      `Renderer sink inventory passed: ${result.rendererDocuments.length} renderer documents, ${result.firstPartyScriptCount} first-party scripts, ${result.innerHTMLAssignmentCount} reviewed innerHTML assignments, ${result.thirdPartyScripts.length} excluded vendor script.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkRendererSinkInventory };
