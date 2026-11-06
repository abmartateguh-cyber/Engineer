'use strict';

const { execFile } = require('child_process');
const { createHash } = require('crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'sbom');
const lockPath = path.join(root, 'package-lock.json');
const npmArgs = ['sbom', '--package-lock-only'];

function getNpmCommand() {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return [process.execPath, [npmCli, ...npmArgs]];
  }
  return [process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs];
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
 * Runs the real `npm sbom --package-lock-only` generation for both CycloneDX
 * and SPDX formats and returns the manifest digest and dependency counts.
 * When writeFiles is true the artifacts are written to docs/sbom/ exactly as
 * the CLI does.
 */
async function generateSbomReport({ writeFiles = true, generatedAt = new Date().toISOString() } = {}) {
  const [cyclonedx, spdx] = await Promise.all([runNpmSbom('cyclonedx'), runNpmSbom('spdx')]);
  const packageLockSha256 = loadPackageLockSha256();
  const manifest = {
    generatedAt,
    command: 'npm sbom --package-lock-only --sbom-format <cyclonedx|spdx>',
    packageLockSha256,
    formats: ['CycloneDX', 'SPDX'],
    dependencyReview: 'SBOM generation does not constitute manual license or provenance approval.'
  };

  const report = {
    generatedAt,
    packageLockSha256,
    formats: manifest.formats,
    cyclonedxComponentCount: countSbomComponents(cyclonedx),
    spdxPackageCount: countSbomPackages(spdx),
    manifestDigest: manifestDigest(manifest)
  };

  if (writeFiles) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, 'omnieng-dependencies.cdx.json'), `${JSON.stringify(cyclonedx, null, 2)}\n`);
    writeFileSync(path.join(outputDir, 'omnieng-dependencies.spdx.json'), `${JSON.stringify(spdx, null, 2)}\n`);
    writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return report;
}

if (require.main === module) {
  (async () => {
    try {
      const report = await generateSbomReport();
      console.log(`Wrote CycloneDX and SPDX SBOMs for package-lock sha256 ${report.packageLockSha256}.`);
    } catch (error) {
      console.error(`SBOM generation failed: ${error.message}`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  generateSbomReport,
  countSbomComponents,
  countSbomPackages,
  loadPackageLockSha256,
  manifestDigest
};
