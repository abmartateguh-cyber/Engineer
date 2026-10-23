/**
 * OmniEng Phase 10 Verification Suite:
 * Headless Linux HPC Solver Daemon, Parallel Domain Decomposition &
 * Unified 100-Case Gold Benchmark Regulatory Verification Suite
 */

'use strict';

const assert = require('assert');
const { HeadlessSolverDaemon } = require('../src/main/headless_solver_daemon');
const { DomainDecompositionEngine } = require('../src/core/math/domain_decomposition');
const { runSuite100GoldBenchmarks } = require('./vv/suite_100_gold_benchmarks');
const { registerSystemIpc } = require('../src/main/ipc/system_ipc');
const { isChannelRegistered } = require('../src/main/ipc/define_handler');

console.log('================================================================');
console.log('   RUNNING PHASE 10: HEADLESS HPC DAEMON & 100 GOLD BENCHMARKS  ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: HeadlessSolverDaemon Health Check & Pure Headless Multi-Discipline Solve
// -----------------------------------------------------------------------------
console.log('[P10-1] HeadlessSolverDaemon Health Check & Multi-Discipline Execution...');
const health = HeadlessSolverDaemon.getHealth();
assert(health.status === 'HEALTHY', 'Daemon health must be HEALTHY');
assert(health.enginesLoaded >= 12, 'Must have at least 12 engines loaded');

// Test FEA solve via daemon
const feaJob = {
  discipline: 'fea',
  parameters: {
    nodes: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    elements: [{ nodes: [0, 1, 2, 3], material: { E: 200e9, nu: 0.3 } }]
  }
};
const feaRes = HeadlessSolverDaemon.solveJob(feaJob);
assert(feaRes.status === 'CONVERGED', 'FEA solve must converge');

// Test Optics Fresnel solve via daemon
const opticsJob = {
  discipline: 'optics',
  parameters: { n1: 1.0, n2: 1.5, thetaI: 0.0 }
};
const opticsRes = HeadlessSolverDaemon.solveJob(opticsJob);
assert(opticsRes.status === 'CONVERGED', 'Optics solve must converge');
assert(Math.abs(opticsRes.result.Rs - 0.04) < 0.005, 'Normal incidence reflectance ~ 4%');

// Test instance dispatchJob method (used by system_ipc)
const daemon = new HeadlessSolverDaemon();
const dispatchRes = daemon.dispatchJob({ type: 'optics', params: { n1: 1.0, n2: 1.5, thetaI: 0.0 } });
assert(dispatchRes.status === 'CONVERGED', 'Instance dispatchJob must converge');

console.log(`  ✓ [P10-1] Daemon Health: ${health.status} (${health.enginesLoaded} engines), Multi-discipline headless solves verified`);

// -----------------------------------------------------------------------------
// Test 2: Recursive Coordinate Bisection (RCB) Mesh Domain Decomposition
// -----------------------------------------------------------------------------
console.log('\n[P10-2] Spatial Graph Partitioning & Domain Decomposition Engine...');
// Construct a 2x2 grid of 4 tetrahedral elements
const meshNodes = [
  { x: 0, y: 0, z: 0 }, // 0
  { x: 1, y: 0, z: 0 }, // 1
  { x: 2, y: 0, z: 0 }, // 2
  { x: 0, y: 1, z: 0 }, // 3
  { x: 1, y: 1, z: 0 }, // 4
  { x: 2, y: 1, z: 0 }, // 5
  { x: 0.5, y: 0.5, z: 1 }, // 6 (apex 1)
  { x: 1.5, y: 0.5, z: 1 }  // 7 (apex 2)
];
const meshElements = [
  [0, 1, 3, 6], // Tet 0 (left)
  [1, 4, 3, 6], // Tet 1 (left-center)
  [1, 2, 4, 7], // Tet 2 (right-center)
  [2, 5, 4, 7]  // Tet 3 (right)
];

const partition2 = DomainDecompositionEngine.partitionMesh(meshNodes, meshElements, 2);
assert(partition2.subdomains.length === 2, 'Must create 2 subdomains');
assert(partition2.subdomains[0].elementIndices.length === 2, 'Subdomain 0 must contain 2 elements');
assert(partition2.subdomains[1].elementIndices.length === 2, 'Subdomain 1 must contain 2 elements');
assert(partition2.interfaceNodes.length > 0, 'Interface nodes must exist along partition cut');
assert(partition2.loadImbalanceRatio <= 1.2, 'Load balance ratio must be close to 1.0');

console.log(`  ✓ [P10-2] Domain Decomposition: 4 elements partitioned into 2 balanced subdomains with ${partition2.interfaceNodes.length} interface boundary nodes`);

// -----------------------------------------------------------------------------
// Test 3: Unified 100-Case Gold Benchmark Regulatory Verification Suite
// -----------------------------------------------------------------------------
console.log('\n[P10-3] Executing 100-Case Unified Gold Benchmark Regulatory Suite...');
const goldSummary = runSuite100GoldBenchmarks();
assert(goldSummary.passed === 100, `All 100 benchmarks must pass (passed: ${goldSummary.passed})`);
assert(goldSummary.total === 100, `Total benchmarks must be 100 (total: ${goldSummary.total})`);

console.log(`  ✓ [P10-3] 100 / 100 Gold Regulatory Benchmarks Passed (${goldSummary.durationSec}s)`);

// -----------------------------------------------------------------------------
// Test 4: Phase 10 HPC Daemon & Benchmarks IPC Channel Registration
// -----------------------------------------------------------------------------
console.log('\n[P10-4] Phase 10 Headless HPC & Domain Decomposition IPC Channels...');
registerSystemIpc();
assert(isChannelRegistered('omni:mesh-domain-decomposition'), 'Must register omni:mesh-domain-decomposition');
assert(isChannelRegistered('omni:run-100-gold-benchmarks'), 'Must register omni:run-100-gold-benchmarks');

console.log('  ✓ [P10-4] All Phase 10 HPC IPC Channels Registered & Schema-Validated');

console.log('\n================================================================');
console.log('   ALL 4 PHASE 10 TESTS PASSED SUCCESSFULLY!                   ');
console.log('================================================================\n');
