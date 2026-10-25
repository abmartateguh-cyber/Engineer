/**
 * Experimental dispatcher and mesh partition smoke checks.
 * These assertions do not establish HPC capability or numerical validation.
 */

'use strict';

const assert = require('assert');
const { HeadlessSolverDaemon } = require('../src/main/headless_solver_daemon');
const { DomainDecompositionEngine } = require('../src/core/math/domain_decomposition');
const { registerSystemIpc, loadOmniArchiveFromBuffer } = require('../src/main/ipc/system_ipc');
const { getRegisteredChannels, isChannelRegistered, validateSchema } = require('../src/main/ipc/define_handler');
const { IPCValidator } = require('../src/core/security/ipc_validator');
const { OmniArchive } = require('../src/core/storage/omni_archive');

console.log('[P10] Experimental local dispatcher and mesh partition smoke checks');

const health = HeadlessSolverDaemon.getHealth();
assert.strictEqual(health.status, 'experimental');
assert.strictEqual(health.releaseApproved, false);
assert.strictEqual(Object.hasOwn(health, 'enginesLoaded'), false);

const optics = HeadlessSolverDaemon.solveJob({
  discipline: 'optics',
  parameters: { n1: 1, n2: 1.5, thetaI: 0 }
});
assert.strictEqual(optics.status, 'COMPUTED_EXPERIMENTAL');
assert.strictEqual(optics.validationLevel, 'experimental');
assert(Math.abs(optics.result.Rs - 0.04) < 0.005, 'Fresnel example returns the expected normal-incidence calculation');

assert.throws(() => HeadlessSolverDaemon.solveJob({ discipline: 'optics' }), /parameters are required/i);
assert.throws(() => HeadlessSolverDaemon.solveJob({ parameters: {} }), /discipline is required/i);

const meshNodes = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 1, z: 0 },
  { x: 2, y: 1, z: 0 },
  { x: 0.5, y: 0.5, z: 1 },
  { x: 1.5, y: 0.5, z: 1 }
];
const meshElements = [
  [0, 1, 3, 6],
  [1, 4, 3, 6],
  [1, 2, 4, 7],
  [2, 5, 4, 7]
];
const partition = DomainDecompositionEngine.partitionMesh(meshNodes, meshElements, 2);
assert.strictEqual(partition.subdomains.length, 2);
assert.strictEqual(partition.subdomains[0].elementIndices.length + partition.subdomains[1].elementIndices.length, 4);

registerSystemIpc();
assert(isChannelRegistered('omni:mesh-domain-decomposition'));
assert(isChannelRegistered('omni:run-100-gold-benchmarks'));
const testArchive = new OmniArchive({ projectName: 'IPC Buffer Test' });
testArchive.addSection('example', { source: 'test' });
const archiveResult = loadOmniArchiveFromBuffer(new Uint8Array(testArchive.saveToBuffer()));
assert.strictEqual(archiveResult.success, true);
assert.strictEqual(archiveResult.manifest.projectName, 'IPC Buffer Test');
assert.deepStrictEqual(archiveResult.sections, ['manifest', 'example']);
assert.strictEqual(loadOmniArchiveFromBuffer('../private.omni').error.code, 'INVALID_INPUT');
const archiveChannel = getRegisteredChannels().find((channel) => channel.channel === 'omni:load-omni-archive');
assert.strictEqual(archiveChannel.schema.type, 'buffer');
assert.strictEqual(archiveChannel.schema.maxBytes, 100 * 1024 * 1024);
const sanitizedArchiveBytes = IPCValidator.sanitize(new Uint8Array(testArchive.saveToBuffer()));
validateSchema(sanitizedArchiveBytes, archiveChannel.schema);
assert.throws(
  () => validateSchema(IPCValidator.sanitize(new Uint8Array([1, 2])), { type: 'buffer', maxBytes: 1 }),
  /exceeds maximum allowed 1 bytes/
);

console.log('[P10] Experimental smoke checks passed; no HPC or benchmark validation is claimed.');
