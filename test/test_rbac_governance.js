/**
 * Verification gate for RBAC governance / ITAR-EAR data partitioning.
 *
 * Deterministic node:test suite. Verifies:
 *  1. VIEW allowed for every role that carries VIEW.
 *  2. EDIT denied without EDIT permission.
 *  3. APPROVE denied for non-approver roles.
 *  4. EXPORT of a non-export-controlled blisk with EXPORT permission -> allowed.
 *  5. EXPORT of an ITAR-flagged blisk: US-cleared engineer with EXPORT -> allowed;
 *     non-US-cleared or missing citizenship -> blocked with reason;
 *     US-cleared without EXPORT -> blocked.
 *  6. EAR variant behaves per its regime (blocked for non-cleared).
 *  7. Denials appended to the audit log (count + reason recorded).
 *  8. Fail-closed: unknown action, unknown role, missing citizenship -> denied.
 *  9. Optional EXPORT_ITAR escalation gating.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { RBACGovernance, PERMISSIONS, ROLES } = require('../src/core/security/rbac_governance');

const { VIEW, EDIT, APPROVE, EXPORT, EXPORT_ITAR } = PERMISSIONS;

function session(userId, role, clearedCitizenships) {
  const s = { userId, role };
  if (clearedCitizenships !== undefined) {
    s.clearedCitizenships = clearedCitizenships;
  }
  return s;
}

const US_ENGINEER = session('eng-us-01', 'ExportEngineer', ['US']);
const GB_ENGINEER = session('eng-gb-01', 'ExportEngineer', ['GB']);
const NO_CITIZENSHIP_ENGINEER = session('eng-none-01', 'ExportEngineer', []);
const MISSING_CITIZENSHIP_ENGINEER = session('eng-missing-01', 'ExportEngineer', null);
const US_VIEWER = session('viewer-us-01', 'Viewer', ['US']);
const DESIGNER = session('designer-01', 'Designer', ['US']);
const APPROVER = session('approver-01', 'Approver', ['US']);
const ITAR_ENGINEER = session('eng-itar-01', 'ITARExportEngineer', ['US']);

const BLISK_OPEN = {
  id: 'BLK-1001',
  name: 'Turbine Blisk Stage 1',
  modelType: '5-axis',
  exportControl: { regime: 'none', clearedCitizenships: [] }
};

const BLISK_ITAR = {
  id: 'BLK-1002',
  name: 'Turbine Blisk Stage 2',
  modelType: '5-axis',
  exportControl: { regime: 'ITAR', clearedCitizenships: ['US'] }
};

const BLISK_EAR = {
  id: 'BLK-1003',
  name: 'Turbine Blisk Stage 3',
  modelType: '5-axis',
  exportControl: { regime: 'EAR', clearedCitizenships: ['US'] }
};

const BLISK_ITAR_ESCALATED = {
  id: 'BLK-1004',
  name: 'Turbine Blisk Stage 4',
  modelType: '5-axis',
  exportControl: { regime: 'ITAR', clearedCitizenships: ['US'], escalationRequired: true }
};

describe('RBACGovernance: role permissions', () => {
  const gov = new RBACGovernance();

  it('VIEW is allowed for every role carrying VIEW', () => {
    for (const [role, permissions] of Object.entries(ROLES)) {
      if (!permissions.includes(VIEW)) {
        continue;
      }
      const decision = gov.authorize(session(`u-${role}`, role, ['US']), VIEW, BLISK_OPEN);
      assert.equal(decision.allowed, true, `${role} should be allowed to VIEW`);
      assert.equal(decision.reason, 'allowed');
    }
  });

  it('EDIT is denied without EDIT permission', () => {
    const decision = gov.authorize(US_VIEWER, EDIT, BLISK_OPEN);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /lacks permission 'EDIT'/);

    const allowed = gov.authorize(DESIGNER, EDIT, BLISK_OPEN);
    assert.equal(allowed.allowed, true);
  });

  it('APPROVE is denied for non-approver roles', () => {
    for (const [role, permissions] of Object.entries(ROLES)) {
      if (permissions.includes(APPROVE)) {
        continue;
      }
      const decision = gov.authorize(session(`u-${role}`, role, ['US']), APPROVE, BLISK_OPEN);
      assert.equal(decision.allowed, false, `${role} must not APPROVE`);
      assert.match(decision.reason, /lacks permission 'APPROVE'/);
    }
    assert.equal(gov.authorize(APPROVER, APPROVE, BLISK_OPEN).allowed, true);
  });
});

describe('RBACGovernance: ITAR/EAR export control', () => {
  const gov = new RBACGovernance();

  it('EXPORT of a non-export-controlled blisk with EXPORT permission is allowed', () => {
    const decision = gov.authorize(US_ENGINEER, EXPORT, BLISK_OPEN);
    assert.equal(decision.allowed, true);
  });

  it('EXPORT of an ITAR-flagged blisk by a US-cleared engineer with EXPORT is allowed', () => {
    const decision = gov.authorize(US_ENGINEER, EXPORT, BLISK_ITAR);
    assert.equal(decision.allowed, true);
  });

  it('EXPORT of an ITAR-flagged blisk by a non-US-cleared engineer is blocked with reason', () => {
    const decision = gov.authorize(GB_ENGINEER, EXPORT, BLISK_ITAR);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /ITAR/);
    assert.match(decision.reason, /citizenship/);
  });

  it('EXPORT of an ITAR-flagged blisk by an engineer with missing citizenship is blocked', () => {
    const decision = gov.authorize(MISSING_CITIZENSHIP_ENGINEER, EXPORT, BLISK_ITAR);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /citizenship/);
  });

  it('EXPORT of an ITAR-flagged blisk by a US-cleared engineer without EXPORT is blocked', () => {
    const decision = gov.authorize(US_VIEWER, EXPORT, BLISK_ITAR);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /lacks permission 'EXPORT'/);
  });

  it('EAR variant follows its regime: cleared allowed, non-cleared blocked', () => {
    assert.equal(gov.authorize(US_ENGINEER, EXPORT, BLISK_EAR).allowed, true);
    const blocked = gov.authorize(GB_ENGINEER, EXPORT, BLISK_EAR);
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /EAR/);
  });

  it('optional EXPORT_ITAR escalation gates ITAR export', () => {
    const noEscalation = gov.authorize(US_ENGINEER, EXPORT, BLISK_ITAR_ESCALATED);
    assert.equal(noEscalation.allowed, false);
    assert.match(noEscalation.reason, /EXPORT_ITAR/);

    const escalated = gov.authorize(ITAR_ENGINEER, EXPORT, BLISK_ITAR_ESCALATED);
    assert.equal(escalated.allowed, true);
    assert.equal(ITAR_ENGINEER.role === 'ITARExportEngineer' && ROLES.ITARExportEngineer.includes(EXPORT_ITAR), true);
  });
});

describe('RBACGovernance: audit logging of denials', () => {
  const gov = new RBACGovernance();

  it('denials are appended with count and reason', () => {
    gov.clearAuditLog();
    assert.equal(gov.getAuditLog().length, 0);

    gov.authorize(US_VIEWER, EDIT, BLISK_OPEN);
    gov.authorize(GB_ENGINEER, EXPORT, BLISK_ITAR);
    gov.authorize(US_ENGINEER, 'DELETE', BLISK_OPEN);
    gov.authorize(session('u-x', 'UnknownRole', ['US']), VIEW, BLISK_OPEN);

    const log = gov.getAuditLog();
    assert.equal(log.length, 4);

    assert.equal(log[0].action, EDIT);
    assert.equal(log[0].resourceId, BLISK_OPEN.id);
    assert.equal(log[0].allowed, false);
    assert.match(log[0].reason, /lacks permission 'EDIT'/);

    assert.equal(log[1].action, EXPORT);
    assert.equal(log[1].resourceId, BLISK_ITAR.id);
    assert.match(log[1].reason, /ITAR/);
    assert.match(log[1].reason, /citizenship/);

    assert.equal(log[2].action, 'DELETE');
    assert.match(log[2].reason, /unknown action/);

    assert.equal(log[3].role, 'UnknownRole');
    assert.match(log[3].reason, /unknown role/);
  });

  it('allowed decisions do not append audit entries', () => {
    gov.clearAuditLog();
    gov.authorize(US_ENGINEER, EXPORT, BLISK_ITAR);
    gov.authorize(US_ENGINEER, VIEW, BLISK_ITAR);
    assert.equal(gov.getAuditLog().length, 0);
  });
});

describe('RBACGovernance: fail-closed', () => {
  const gov = new RBACGovernance();

  it('unknown action is denied', () => {
    const decision = gov.authorize(US_ENGINEER, 'DELETE', BLISK_OPEN);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /unknown action/);
  });

  it('unknown role is denied', () => {
    const decision = gov.authorize(session('u-x', 'Contractor', ['US']), VIEW, BLISK_OPEN);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /unknown role/);
  });

  it('missing session is denied', () => {
    const decision = gov.authorize(null, VIEW, BLISK_OPEN);
    assert.equal(decision.allowed, false);
  });

  it('missing citizenship (null / empty / absent) is denied for export-controlled resources', () => {
    assert.equal(gov.authorize(NO_CITIZENSHIP_ENGINEER, EXPORT, BLISK_ITAR).allowed, false);
    assert.equal(gov.authorize(MISSING_CITIZENSHIP_ENGINEER, EXPORT, BLISK_ITAR).allowed, false);
    const noField = session('eng-nofield-01', 'ExportEngineer');
    assert.equal(gov.authorize(noField, EXPORT, BLISK_ITAR).allowed, false);
  });
});
