'use strict';

const assert = require('assert');
const { StenographerSupervisor } = require('../src/main/stenographer_supervisor');
const { ToolClassification } = require('../src/core/contracts/ToolDefinition');
const { ProposalStatus } = require('../src/core/contracts/ToolProposal');
const { ApprovalDecision } = require('../src/core/contracts/ApprovalRecord');

console.log('================================================================');
console.log('       TESTING STENOGRAPHER SUPERVISOR & FAIL-CLOSED GATEWAY    ');
console.log('================================================================\n');

(async () => {
  const supervisor = new StenographerSupervisor({ mockMode: true });

  // 1. Connect and verify status
  console.log('[1] Connecting supervisor...');
  await supervisor.connect();
  const status = await supervisor.getStatus();
  assert.strictEqual(status.alive, true);
  assert.strictEqual(status.version, '2.0.0');
  console.log('  ✓ PASSED: Supervisor connected and status verified\n');

  // 2. Query with read-only request
  console.log('[2] Querying read-only mesh stats...');
  const res1 = await supervisor.query('Show me the active mesh statistics and node count');
  assert.strictEqual(res1.proposals.length, 1);
  const readProp = res1.proposals[0];
  assert.strictEqual(readProp.toolName, 'read_mesh_summary');
  assert.strictEqual(readProp.classification, ToolClassification.READ_ONLY);
  assert.strictEqual(readProp.requiresApproval, false);

  // Auto-run read-only tool
  const readExec = await supervisor.executeTool(readProp.id, async () => ({ nodeCount: 15420, elemCount: 42100 }));
  assert.strictEqual(readExec.success, true);
  assert.strictEqual(readProp.status, ProposalStatus.EXECUTED);
  assert(readExec.artifactRef.hash, 'ArtifactRef must have SHA-256 hash');
  console.log('  ✓ PASSED: Read-only tool auto-ran and produced content-addressed artifact\n');

  // 3. Query with mutation request and test FAIL-CLOSED security gate
  console.log('[3] Testing FAIL-CLOSED gate on unapproved mutation proposal...');
  const res2 = await supervisor.query('Extrude the main boss cylinder by 50mm');
  assert.strictEqual(res2.proposals.length, 1);
  const mutateProp = res2.proposals[0];
  assert.strictEqual(mutateProp.toolName, 'mutate_geometry_parameter');
  assert.strictEqual(mutateProp.classification, ToolClassification.MUTATION_PREVIEW);
  assert.strictEqual(mutateProp.requiresApproval, true);
  assert.strictEqual(mutateProp.status, ProposalStatus.PROPOSED);

  // Attempting to execute unapproved mutation MUST throw
  let blocked = false;
  try {
    await supervisor.executeTool(mutateProp.id);
  } catch (err) {
    blocked = true;
    assert(err.message.includes('Fail-closed gate'), 'Error must specify fail-closed gate');
  }
  assert.strictEqual(blocked, true, 'Unapproved mutation MUST be blocked fail-closed');
  console.log('  ✓ PASSED: Fail-closed gate blocked unapproved mutation\n');

  // 4. Approve mutation and execute
  console.log('[4] Approving mutation proposal and executing...');
  const approval = supervisor.evaluateProposal(
    mutateProp.id,
    ApprovalDecision.APPROVED,
    'Verified with stress analysis constraints',
    'Chief_Structural_Engineer'
  );
  assert.strictEqual(approval.decision, ApprovalDecision.APPROVED);
  assert.strictEqual(mutateProp.status, ProposalStatus.APPROVED);

  const mutateExec = await supervisor.executeTool(mutateProp.id, async (params) => ({
    mutated: true,
    feature: params.feature,
    newDepthMm: params.value
  }));
  assert.strictEqual(mutateExec.success, true);
  assert.strictEqual(mutateProp.status, ProposalStatus.EXECUTED);
  console.log('  ✓ PASSED: Approved mutation executed cleanly and recorded in ledger\n');

  // 5. Test rejection flow
  console.log('[5] Testing proposal rejection flow...');
  const res3 = await supervisor.query('Run FEA structural solve on body');
  const feaProp = res3.proposals.find((p) => p.toolName === 'execute_fea_solve');
  assert(feaProp, 'FEA solve proposal must be generated');
  assert.strictEqual(feaProp.requiresApproval, true);

  supervisor.evaluateProposal(feaProp.id, ApprovalDecision.REJECTED, 'Body must be meshed before solving');
  assert.strictEqual(feaProp.status, ProposalStatus.REJECTED);

  let rejectBlocked = false;
  try {
    await supervisor.executeTool(feaProp.id);
  } catch (err) {
    rejectBlocked = true;
  }
  assert.strictEqual(rejectBlocked, true, 'Rejected proposal must not execute');
  console.log('  ✓ PASSED: Rejected proposal marked REJECTED and execution blocked\n');

  // 6. Verify Cryptographic Hash Chain of Engineering Ledger
  console.log('[6] Verifying cryptographic integrity of immutable ledger...');
  const ledgerIntegrity = supervisor.verifyLedgerIntegrity();
  assert.strictEqual(ledgerIntegrity.valid, true);
  assert(supervisor.ledger.length >= 7, 'Ledger must contain recorded audit events');
  console.log(`  ✓ PASSED: All ${supervisor.ledger.length} ledger entries cryptographically verified\n`);

  // 7. Cleanup
  await supervisor.disconnect();

  console.log('================================================================');
  console.log('   ALL STENOGRAPHER SUPERVISOR TESTS PASSED!                    ');
  console.log('================================================================\n');
})();
