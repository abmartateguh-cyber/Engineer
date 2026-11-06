/**
 * RBAC governance and ITAR/EAR export-control data partitioning.
 *
 * Models the export-control regime of a data object (e.g. a 5-axis turbine
 * blisk model record) via an `exportControl` stamp and enforces:
 *  - role-based permission checks (VIEW / EDIT / APPROVE / EXPORT, plus the
 *    optional EXPORT_ITAR escalation permission),
 *  - export-control citizenship checks for ITAR- and EAR-tagged resources,
 *  - fail-closed behavior for unknown roles, unknown actions, and missing
 *    citizenship,
 *  - audit logging of every denial.
 *
 * Deterministic: audit identifiers are derived from stable inputs (no wall
 * clock, no randomness), so test runs are reproducible.
 */

'use strict';

const crypto = require('crypto');

const PERMISSIONS = Object.freeze({
  VIEW: 'VIEW',
  EDIT: 'EDIT',
  APPROVE: 'APPROVE',
  EXPORT: 'EXPORT',
  EXPORT_ITAR: 'EXPORT_ITAR'
});

const ROLES = Object.freeze({
  Viewer: [PERMISSIONS.VIEW],
  Designer: [PERMISSIONS.VIEW, PERMISSIONS.EDIT],
  Approver: [PERMISSIONS.VIEW, PERMISSIONS.APPROVE],
  ExportEngineer: [PERMISSIONS.VIEW, PERMISSIONS.EXPORT],
  ITARExportEngineer: [PERMISSIONS.VIEW, PERMISSIONS.EXPORT, PERMISSIONS.EXPORT_ITAR]
});

const EXPORT_CONTROL_REGIMES = Object.freeze({
  NONE: 'none',
  ITAR: 'ITAR',
  EAR: 'EAR'
});

function sessionCitizenships(session) {
  if (!session || !Array.isArray(session.clearedCitizenships)) {
    return [];
  }
  return session.clearedCitizenships.filter((c) => typeof c === 'string' && c.length > 0);
}

function resourceExportControl(resource) {
  if (!resource || typeof resource !== 'object' || !resource.exportControl) {
    return null;
  }
  return resource.exportControl;
}

function clearedCitizenshipsOf(exportControl) {
  if (!exportControl || !Array.isArray(exportControl.clearedCitizenships)) {
    return [];
  }
  return exportControl.clearedCitizenships.filter((c) => typeof c === 'string' && c.length > 0);
}

function hasClearedCitizenship(session, exportControl) {
  const sessionCits = sessionCitizenships(session);
  const resourceCits = clearedCitizenshipsOf(exportControl);
  if (sessionCits.length === 0 || resourceCits.length === 0) {
    return false;
  }
  return sessionCits.some((cit) => resourceCits.includes(cit));
}

class RBACGovernance {
  /**
   * @param {Object} [options]
   * @param {number} [options.auditLogLimit] - optional cap on retained audit entries
   */
  constructor(options = {}) {
    this.auditLog = [];
    this._auditLogLimit = options.auditLogLimit || 10000;
    this._seq = 0;
  }

  /**
   * Evaluate an access request (fail-closed).
   *
   * @param {Object} session - user session: { userId, role, clearedCitizenships }
   * @param {string} action - one of PERMISSIONS
   * @param {Object} resource - data object carrying an optional exportControl stamp
   * @returns {{ allowed: boolean, reason: string, auditId: ?string }}
   */
  authorize(session, action, resource) {
    const decision = this._decide(session, action, resource);
    if (!decision.allowed) {
      decision.auditId = this._recordDenial(session, action, resource, decision.reason);
    }
    return decision;
  }

  _decide(session, action, resource) {
    if (!session || typeof session !== 'object' || session.role === undefined || session.role === null) {
      return { allowed: false, reason: 'denied: missing or invalid session' };
    }

    const role = session.role;
    if (!Object.prototype.hasOwnProperty.call(ROLES, role)) {
      return { allowed: false, reason: `denied: unknown role '${role}'` };
    }

    if (typeof action !== 'string' || !Object.values(PERMISSIONS).includes(action)) {
      return { allowed: false, reason: `denied: unknown action '${action}'` };
    }

    const rolePermissions = ROLES[role];
    if (!rolePermissions.includes(action)) {
      return {
        allowed: false,
        reason: `denied: role '${role}' lacks permission '${action}'`
      };
    }

    if (action === PERMISSIONS.EXPORT) {
      const exportControl = resourceExportControl(resource);
      if (exportControl && exportControl.regime !== EXPORT_CONTROL_REGIMES.NONE) {
        const regime = exportControl.regime;
        const allowedRegimes = [EXPORT_CONTROL_REGIMES.ITAR, EXPORT_CONTROL_REGIMES.EAR];
        if (!allowedRegimes.includes(regime)) {
          return { allowed: false, reason: `denied: unknown export control regime '${regime}'` };
        }

        if (exportControl.escalationRequired === true && !rolePermissions.includes(PERMISSIONS.EXPORT_ITAR)) {
          return {
            allowed: false,
            reason: `denied: export of ${regime}-tagged resource requires escalation permission '${PERMISSIONS.EXPORT_ITAR}'`
          };
        }

        if (!hasClearedCitizenship(session, exportControl)) {
          return {
            allowed: false,
            reason: `denied: no cleared citizenship for ${regime}-tagged resource`
          };
        }
      }
    }

    return { allowed: true, reason: 'allowed' };
  }

  _recordDenial(session, action, resource, reason) {
    this._seq += 1;
    const userId = session && session.userId !== undefined ? String(session.userId) : 'unknown';
    const role = session && session.role !== undefined ? String(session.role) : 'unknown';
    const resourceId = resource && resource.id !== undefined ? String(resource.id) : 'unknown';
    const id = crypto
      .createHash('sha256')
      .update(`${this._seq}:${action}:${userId}:${resourceId}`)
      .digest('hex')
      .slice(0, 16);
    this.auditLog.push({
      id,
      seq: this._seq,
      action,
      userId,
      role,
      resourceId,
      allowed: false,
      reason
    });
    if (this.auditLog.length > this._auditLogLimit) {
      this.auditLog.shift();
    }
    return id;
  }

  getAuditLog() {
    return this.auditLog.slice();
  }

  clearAuditLog() {
    this.auditLog = [];
    this._seq = 0;
  }
}

module.exports = {
  RBACGovernance,
  PERMISSIONS,
  ROLES,
  EXPORT_CONTROL_REGIMES
};
