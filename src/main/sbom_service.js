'use strict';

const { execFile } = require('child_process');
const { createHash } = require('crypto');
const { readFileSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const lockPath = path.join(root, 'package-lock.json');

function getNpmCommand() {
  const npmCli = process.env.npm_execpath;
  const args = ['sbom', '--package-lock-only'];
  if (npmCli) {
    return [process.execPath, [npmCli, ...args]];
  }
  return [process.platform === 'win32' ? 'npm.cmd' : 'npm', args];
}

function loadPackageLockSha256() {
  return createHash('sha256').update(readFileSync(lockPath)).digest('hex');
}

function runNpmSbom(format) {
  const [command, args] = getNpmCommand();
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      [...args, '--sbom-format', format],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        shell: process.platform === 'win32'
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(new Error(`npm returned an invalid ${format} SBOM: ${parseError.message}`));
        }
      }
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`npm sbom (${format}) timed out after 120 seconds.`));
    }, 120000);
    child.on('close', () => clearTimeout(timer));
  });
}

function countLockfileDependencies() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const packages = lock.packages || {};
  let count = 0;
  for (const name of Object.keys(packages)) {
    if (name !== '') count += 1;
  }
  return count;
}

function countSbomComponents(cyclonedx) {
  return Array.isArray(cyclonedx?.components) ? cyclonedx.components.length : 0;
}

function countSbomPackages(spdx) {
  return Array.isArray(spdx?.packages) ? spdx.packages.length : 0;
}

function manifestDigest(manifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

/**
 * Runs the real `npm sbom --package-lock-only` generation for CycloneDX and
 * SPDX and returns the manifest digest plus dependency counts. When npm is not
 * available (e.g., inside a packaged asar) it falls back to counting packages
 * from the bundled package-lock.json and marks the fallback.
 */
async function generateSbomReport({ writeFiles = false, generatedAt = new Date().toISOString() } = {}) {
  const packageLockSha256 = loadPackageLockSha256();
  const manifest = {
    generatedAt,
    command: 'npm sbom --package-lock-only --sbom-format <cyclonedx|spdx>',
    packageLockSha256,
    formats: ['CycloneDX', 'SPDX'],
    dependencyReview: 'SBOM generation does not constitute manual license or provenance approval.'
  };

  let cyclonedxComponentCount = null;
  let spdxPackageCount = null;
  let fallback = null;
  try {
    const [cyclonedx, spdx] = await Promise.all([runNpmSbom('cyclonedx'), runNpmSbom('spdx')]);
    cyclonedxComponentCount = countSbomComponents(cyclonedx);
    spdxPackageCount = countSbomPackages(spdx);
  } catch (error) {
    fallback = 'lockfile-count';
    cyclonedxComponentCount = countLockfileDependencies();
    spdxPackageCount = countLockfileDependencies();
  }

  const report = {
    generatedAt,
    packageLockSha256,
    formats: manifest.formats,
    cyclonedxComponentCount,
    spdxPackageCount,
    manifestDigest: manifestDigest(manifest),
    fallback
  };

  return report;
}

module.exports = {
  generateSbomReport,
  countSbomComponents,
  countSbomPackages,
  countLockfileDependencies,
  manifestDigest,
  loadPackageLockSha256
};
