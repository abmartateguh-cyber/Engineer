'use strict';

const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'sbom');
const lockPath = path.join(root, 'package-lock.json');
const lockHash = createHash('sha256').update(readFileSync(lockPath)).digest('hex');
const npmArgs = ['sbom', '--package-lock-only'];
const npmCli = process.env.npm_execpath;

function createSbom(format) {
  const args = [...npmArgs, '--sbom-format', format];
  const output = npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        shell: process.platform === 'win32'
      });
  const sbom = JSON.parse(output);
  if (!sbom || typeof sbom !== 'object') throw new Error(`npm returned an invalid ${format} SBOM.`);
  return sbom;
}

mkdirSync(outputDir, { recursive: true });
const generatedAt = new Date().toISOString();
const cyclonedx = createSbom('cyclonedx');
const spdx = createSbom('spdx');

writeFileSync(path.join(outputDir, 'omnieng-dependencies.cdx.json'), `${JSON.stringify(cyclonedx, null, 2)}\n`);
writeFileSync(path.join(outputDir, 'omnieng-dependencies.spdx.json'), `${JSON.stringify(spdx, null, 2)}\n`);
writeFileSync(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(
    {
      generatedAt,
      command: 'npm sbom --package-lock-only --sbom-format <cyclonedx|spdx>',
      packageLockSha256: lockHash,
      formats: ['CycloneDX', 'SPDX'],
      dependencyReview: 'SBOM generation does not constitute manual license or provenance approval.'
    },
    null,
    2
  )}\n`
);

console.log(`Wrote CycloneDX and SPDX SBOMs for package-lock sha256 ${lockHash}.`);
