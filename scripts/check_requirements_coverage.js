'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MATRIX_PATH = path.join(ROOT, 'docs', 'industrialization', 'requirements_traceability.md');
const ID_RE = /REQ-\d{3}/g;
const ARTIFACT_CELL_RE = /`([^`]+)`/g;

function parseMatrix(markdown) {
  const lines = markdown.split('\n');
  const headerIndex = lines.findIndex(
    (line) =>
      line.trim().startsWith('|') &&
      line
        .split('|')
        .map((cell) => cell.trim())
        .includes('Artifact')
  );
  if (headerIndex === -1) {
    throw new Error('requirements traceability matrix must contain an "Artifact" column header');
  }
  const headerCells = lines[headerIndex].split('|').map((cell) => cell.trim());
  const artifactColumn = headerCells.findIndex((cell) => cell === 'Artifact');
  if (artifactColumn === -1) {
    throw new Error('requirements traceability matrix must contain an "Artifact" column');
  }

  const rows = [];
  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim().startsWith('|')) continue;
    const idMatch = line.match(ID_RE);
    if (!idMatch) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const status = (cells[cells.length - 2] || '').toUpperCase();
    const artifactCell = cells[artifactColumn] || '';
    const artifacts = [];
    let artifactMatch;
    ARTIFACT_CELL_RE.lastIndex = 0;
    while ((artifactMatch = ARTIFACT_CELL_RE.exec(artifactCell)) !== null) {
      artifacts.push(artifactMatch[1]);
    }
    rows.push({ id: idMatch[0], status, artifacts, expected: /expected/i.test(line) });
  }
  return rows;
}

function checkRequirementsCoverage() {
  let markdown;
  try {
    markdown = fs.readFileSync(MATRIX_PATH, 'utf8');
  } catch (error) {
    console.error(`requirements traceability gate: FAIL — cannot read ${MATRIX_PATH}: ${error.message}`);
    process.exitCode = 1;
    return { total: 0, implemented: 0, checked: 0, missingImplemented: [], warnings: [] };
  }

  const rows = parseMatrix(markdown);
  const missingImplemented = [];
  const warnings = [];

  for (const row of rows) {
    if (row.status === 'EXTERNAL-BLOCKED') continue;
    for (const artifact of row.artifacts) {
      const resolved = path.resolve(ROOT, artifact);
      const exists = fs.existsSync(resolved);
      if (exists) continue;
      if (row.status === 'IMPLEMENTED') {
        missingImplemented.push({ id: row.id, artifact });
      } else if (row.status === 'PARTIAL') {
        const label = row.expected ? 'expected (non-fatal)' : 'partial (non-fatal)';
        warnings.push({ id: row.id, artifact, label });
      }
    }
  }

  const uniqueWarnings = [];
  const seenWarnings = new Set();
  for (const warning of warnings) {
    const key = `${warning.id}:${warning.artifact}`;
    if (seenWarnings.has(key)) continue;
    seenWarnings.add(key);
    uniqueWarnings.push(warning);
  }

  for (const warning of uniqueWarnings) {
    console.warn(`WARN ${warning.id} ${warning.label} artifact missing: ${warning.artifact}`);
  }
  for (const missing of missingImplemented) {
    console.error(`MISSING IMPLEMENTED artifact ${missing.id}: ${missing.artifact}`);
  }

  const implementedCount = rows.filter((row) => row.status === 'IMPLEMENTED').length;
  console.log(
    `requirements traceability matrix: ${rows.length} requirements parsed (${implementedCount} IMPLEMENTED), ` +
      `${missingImplemented.length} missing IMPLEMENTED artifact(s), ${uniqueWarnings.length} warning(s)`
  );

  if (missingImplemented.length > 0) {
    console.error('requirements traceability gate: FAIL');
    process.exitCode = 1;
    return {
      total: rows.length,
      implemented: implementedCount,
      checked: rows.length,
      missingImplemented,
      warnings: uniqueWarnings
    };
  }

  console.log('requirements traceability gate: PASS');
  return {
    total: rows.length,
    implemented: implementedCount,
    checked: rows.length,
    missingImplemented,
    warnings: uniqueWarnings
  };
}

if (require.main === module) {
  checkRequirementsCoverage();
}

module.exports = { checkRequirementsCoverage, parseMatrix };
