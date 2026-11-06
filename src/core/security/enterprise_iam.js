/**
 * Experimental local RBAC/ABAC policy example; not an authenticated identity service.
 *
 * Evaluates example role and attribute rules supplied by the caller:
 * 1. Role-based policy examples for engineering actions.
 * 2. Attribute-based policy examples using caller-supplied attributes.
 * No identity verification, export-control certification, or formal compliance evidence is provided.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

const crypto = require('crypto');

const CLEARANCE_LEVELS = {
  UNCLASSIFIED: 1,
  CONFIDENTIAL: 2,
  SECRET: 3,
  TOP_SECRET: 4
};

const ACTIONS = {
  READ: 'READ',
  MODIFY_CAD: 'MODIFY_CAD',
  APPROVE_ECO: 'APPROVE_ECO',
  EXPORT_GDSII: 'EXPORT_GDSII',
  EXPORT_STEP: 'EXPORT_STEP',
  RUN_SIMULATION: 'RUN_SIMULATION',
  AUDIT_LOGS: 'AUDIT_LOGS',
  QUALIFICATION_SIGN: 'QUALIFICATION_SIGN'
};

const ROLE_PERMISSIONS = {
  ChiefEngineer: [
    ACTIONS.READ,
    ACTIONS.MODIFY_CAD,
    ACTIONS.APPROVE_ECO,
    ACTIONS.EXPORT_GDSII,
    ACTIONS.EXPORT_STEP,
    ACTIONS.RUN_SIMULATION,
    ACTIONS.AUDIT_LOGS,
    ACTIONS.QUALIFICATION_SIGN
  ],
  StressAnalyst: [ACTIONS.READ, ACTIONS.MODIFY_CAD, ACTIONS.RUN_SIMULATION],
  ThermalEngineer: [ACTIONS.READ, ACTIONS.MODIFY_CAD, ACTIONS.RUN_SIMULATION],
  EdaEngineer: [ACTIONS.READ, ACTIONS.MODIFY_CAD, ACTIONS.EXPORT_GDSII, ACTIONS.RUN_SIMULATION],
  OpticsSpecialist: [ACTIONS.READ, ACTIONS.MODIFY_CAD, ACTIONS.RUN_SIMULATION],
  QualityAuditor: [ACTIONS.READ, ACTIONS.AUDIT_LOGS, ACTIONS.QUALIFICATION_SIGN],
  Guest: [ACTIONS.READ]
};

function createPolicyExampleResult(granted, reason, auditId, timestamp) {
  return {
    granted,
    reason,
    auditId,
    timestamp,
    status: 'example-only',
    validationLevel: 'experimental',
    identityVerified: false,
    enforced: false,
    auditRecordPersisted: false
  };
}

class EnterpriseIAM {
  /**
   * Evaluates a caller-supplied request against local demonstration rules.
   *
   * @param {Object} request
   * @param {Object} request.user - The subject requesting access
   * @param {string} request.user.username - e.g. 'dr_smith'
   * @param {string} request.user.role - ChiefEngineer, StressAnalyst, etc.
   * @param {string} [request.user.clearance='UNCLASSIFIED'] - Clearance tier
   * @param {boolean} [request.user.itarCertified=false] - Unverified caller assertion used by the legacy example rule
   * @param {string[]} [request.user.assignedProjects=[]] - Array of assigned project IDs
   * @param {string} request.action - Action requested (from ACTIONS)
   * @param {Object} request.resource - The engineering object being accessed
   * @param {string} request.resource.id - Part or Document ID
   * @param {string} [request.resource.projectId] - Associated project ID
   * @param {string} [request.resource.classification='UNCLASSIFIED'] - Resource classification
   * @param {boolean} [request.resource.isITAR=false] - Unverified caller assertion used by the legacy example rule
   * @param {Object} [request.context={}] - Environmental context (ipAddress, etc.)
   * @returns {{ granted: boolean, reason: string, auditId: string, timestamp: string, status: 'example-only', validationLevel: 'experimental', identityVerified: false, enforced: false }}
   */
  static evaluateAccess(request) {
    const { user, action, resource, context = {} } = request;
    const auditId = 'AUD_' + crypto.randomBytes(8).toString('hex');
    const timestamp = new Date().toISOString();

    // 1. Subject validation
    if (!user || !user.role) {
      return createPolicyExampleResult(
        false,
        'DENIED BY EXAMPLE RULE: Caller-supplied identity fields are missing; identity was not verified.',
        auditId,
        timestamp
      );
    }

    // 2. RBAC Permission Check
    const allowedActions = ROLE_PERMISSIONS[user.role] || [];
    if (!allowedActions.includes(action)) {
      return createPolicyExampleResult(
        false,
        `DENIED BY EXAMPLE RULE (RBAC): Caller-supplied role '${user.role}' does not include action '${action}'. No authorization was enforced.`,
        auditId,
        timestamp
      );
    }

    // 3. ABAC Clearance Level Check
    const userClearanceVal = CLEARANCE_LEVELS[user.clearance || 'UNCLASSIFIED'] || 1;
    const resourceClearanceVal = CLEARANCE_LEVELS[resource.classification || 'UNCLASSIFIED'] || 1;
    if (userClearanceVal < resourceClearanceVal) {
      return createPolicyExampleResult(
        false,
        `DENIED BY EXAMPLE RULE (classification): Caller-supplied level '${user.clearance}' is below '${resource.classification}'. No authorization was enforced.`,
        auditId,
        timestamp
      );
    }

    // 4. ABAC ITAR Export Control Check
    if (resource.isITAR && !user.itarCertified) {
      return createPolicyExampleResult(
        false,
        'DENIED BY EXAMPLE RULE (ITAR-related attribute): A caller-supplied restricted-resource flag lacked a caller-supplied eligibility flag. No ITAR authorization decision was made.',
        auditId,
        timestamp
      );
    }

    // 5. ABAC Project Segregation Check
    if (resource.projectId) {
      const isPrivilegedRole = user.role === 'ChiefEngineer' || user.role === 'QualityAuditor';
      const assigned = user.assignedProjects || [];
      if (!isPrivilegedRole && !assigned.includes(resource.projectId)) {
        return createPolicyExampleResult(
          false,
          `DENIED BY EXAMPLE RULE (project): Caller-supplied project assignment does not include '${resource.projectId}'. No authorization was enforced.`,
          auditId,
          timestamp
        );
      }
    }

    // 6. Network / IP Whitelist Check (if configured)
    if (context.allowedSubnet && context.clientIp) {
      if (!context.clientIp.startsWith(context.allowedSubnet)) {
        return createPolicyExampleResult(
          false,
          'DENIED BY EXAMPLE RULE (network): The caller-supplied address did not match the caller-supplied prefix. No network authorization was enforced.',
          auditId,
          timestamp
        );
      }
    }

    // All policies passed
    return createPolicyExampleResult(
      true,
      'EXAMPLE RULES PASSED: Caller-supplied attributes matched local demonstration rules; identity was not verified and no access was authorized or enforced.',
      auditId,
      timestamp
    );
  }

  /**
   * Helper to verify if an engineer can approve an Engineering Change Order (ECO).
   */
  static canApproveECO(user, eco) {
    return this.evaluateAccess({
      user,
      action: ACTIONS.APPROVE_ECO,
      resource: eco
    });
  }

  /**
   * Helper to verify if an engineer can export semiconductor GDSII mask layouts.
   */
  static canExportGDSII(user, tapeOutProject) {
    return this.evaluateAccess({
      user,
      action: ACTIONS.EXPORT_GDSII,
      resource: tapeOutProject
    });
  }
}

// =============================================================================
// Enterprise SSO verification gate (SAML 2.0 assertions + OIDC ID tokens)
//
// Pure Node.js (crypto only) verification utilities used by the SSO module:
//   - SAML assertion parsing, canonicalization, RSA-SHA256 signature
//     verification, and issuer/audience/time-window validation.
//   - OIDC ID token (compact JWT) signature verification (HS256 / RS256)
//     plus exp / iss / aud validation and `groups` claim extraction.
//   - Group-to-role mapping into the RBAC role table above.
// All verifiers are fail-closed: malformed input yields { valid: false }
// and never throws.
// =============================================================================

const SSO_PROVIDERS = Object.freeze({
  SAML: 'saml',
  OIDC: 'oidc'
});

const JWT_ALGORITHMS = Object.freeze({
  HS256: 'HS256',
  RS256: 'RS256'
});

const GROUP_TO_ROLE = Object.freeze({
  designers: 'EdaEngineer',
  stress: 'StressAnalyst',
  thermal: 'ThermalEngineer',
  optics: 'OpticsSpecialist',
  approvers: 'ChiefEngineer',
  auditors: 'QualityAuditor',
  guest: 'Guest'
});

function canonicalizeSAMLAssertion(xml) {
  return String(xml)
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>')
    .replace(/<\s+/g, '<')
    .trim();
}

function stripSAMLSignature(xml) {
  return String(xml).replace(/<(?:ds:)?Signature\b[^>]*>[\s\S]*?<\/(?:ds:)?Signature>/g, '');
}

function encodeBase64URL(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function decodeBase64URL(text) {
  return Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function extractSAMLTag(xml, name) {
  const match = String(xml).match(
    new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${name}>`)
  );
  return match ? match[1].trim() : null;
}

function extractSAMLAttributes(xml) {
  const attributes = {};
  const attributeRe =
    /<(?:[a-zA-Z0-9]+:)?Attribute\b[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Attribute>/g;
  const valueRe = /<(?:[a-zA-Z0-9]+:)?AttributeValue\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?AttributeValue>/g;
  const xmlString = String(xml);
  let attributeMatch;
  while ((attributeMatch = attributeRe.exec(xmlString)) !== null) {
    const name = attributeMatch[1];
    const values = [];
    let valueMatch;
    const valueSrc = attributeMatch[2];
    while ((valueMatch = valueRe.exec(valueSrc)) !== null) {
      values.push(valueMatch[1].trim());
    }
    attributes[name] = values.length === 1 ? values[0] : values;
  }
  return attributes;
}

function parseSAMLAssertion(xml) {
  const xmlString = String(xml == null ? '' : xml);
  const signedData = Buffer.from(canonicalizeSAMLAssertion(stripSAMLSignature(xmlString)), 'utf8');

  const conditionsMatch = xmlString.match(/<(?:[a-zA-Z0-9]+:)?Conditions\b[^>]*>/);
  let notBefore = null;
  let notOnOrAfter = null;
  if (conditionsMatch) {
    const beforeMatch = /NotBefore="([^"]+)"/.exec(conditionsMatch[0]);
    const afterMatch = /NotOnOrAfter="([^"]+)"/.exec(conditionsMatch[0]);
    notBefore = beforeMatch ? beforeMatch[1] : null;
    notOnOrAfter = afterMatch ? afterMatch[1] : null;
  }

  const signatureMatch = xmlString.match(/<(?:ds:)?SignatureValue\b[^>]*>([\s\S]*?)<\/(?:ds:)?SignatureValue>/);
  const signature = signatureMatch ? Buffer.from(signatureMatch[1].trim(), 'base64') : null;

  return {
    issuer: extractSAMLTag(xmlString, 'Issuer'),
    audience: extractSAMLTag(xmlString, 'Audience'),
    subject: extractSAMLTag(xmlString, 'NameID'),
    notBefore,
    notOnOrAfter,
    signature,
    signedData,
    attributes: extractSAMLAttributes(xmlString)
  };
}

function normalizeGroups(groups) {
  if (Array.isArray(groups)) {
    return groups.map(String);
  }
  if (typeof groups === 'string') {
    return groups.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

function resolveRolesFromGroups(groups) {
  const roles = normalizeGroups(groups)
    .map((group) => GROUP_TO_ROLE[group])
    .filter(Boolean);
  return roles.length > 0 ? roles : ['Guest'];
}

function verifySAMLAssertion({ xml, issuer, audience, certificate, now }) {
  try {
    const parsed = parseSAMLAssertion(xml);
    if (!parsed.signature || parsed.signature.length === 0) {
      return { valid: false, reason: 'missing signature' };
    }
    if (!certificate || parsed.signedData.length === 0) {
      return { valid: false, reason: 'missing signed data or certificate' };
    }
    if (!crypto.verify('sha256', parsed.signedData, certificate, parsed.signature)) {
      return { valid: false, reason: 'signature verification failed' };
    }
    if (parsed.issuer !== issuer) {
      return { valid: false, reason: 'issuer mismatch' };
    }
    if (parsed.audience !== audience) {
      return { valid: false, reason: 'audience mismatch' };
    }
    const nowMs = now != null ? new Date(now).getTime() : Date.now();
    if (parsed.notBefore) {
      const beforeMs = Date.parse(parsed.notBefore);
      if (Number.isNaN(beforeMs) || nowMs < beforeMs) {
        return { valid: false, reason: 'assertion not yet valid (notBefore)' };
      }
    }
    if (parsed.notOnOrAfter) {
      const afterMs = Date.parse(parsed.notOnOrAfter);
      if (Number.isNaN(afterMs) || nowMs >= afterMs) {
        return { valid: false, reason: 'assertion expired (notOnOrAfter)' };
      }
    }
    if (!parsed.subject) {
      return { valid: false, reason: 'missing subject' };
    }
    const groups = parsed.attributes.groups != null ? parsed.attributes.groups : [];
    return {
      valid: true,
      reason: 'ok',
      subject: parsed.subject,
      groups,
      roles: resolveRolesFromGroups(groups),
      attributes: parsed.attributes,
      issuer: parsed.issuer,
      audience: parsed.audience
    };
  } catch (error) {
    return { valid: false, reason: 'malformed assertion: ' + error.message };
  }
}

function signCompactJWT(header, payload, key, algorithm) {
  const signingInput = encodeBase64URL(JSON.stringify(header)) + '.' + encodeBase64URL(JSON.stringify(payload));
  let signature;
  if (algorithm === JWT_ALGORITHMS.HS256) {
    signature = crypto.createHmac('sha256', key).update(signingInput, 'utf8').digest();
  } else if (algorithm === JWT_ALGORITHMS.RS256) {
    signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), key);
  } else {
    throw new Error('Unsupported JWT signing algorithm: ' + algorithm);
  }
  return signingInput + '.' + encodeBase64URL(signature);
}

function validateOIDCIDToken({ token, issuer, audience, secret, publicKey, now }) {
  try {
    const parts = String(token == null ? '' : token).split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      return { valid: false, reason: 'malformed token' };
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(decodeBase64URL(encodedHeader).toString('utf8'));
    const payload = JSON.parse(decodeBase64URL(encodedPayload).toString('utf8'));
    const algorithm = header.alg;
    const signingInput = encodedHeader + '.' + encodedPayload;
    const signatureBytes = decodeBase64URL(encodedSignature);

    let signatureOk = false;
    if (algorithm === JWT_ALGORITHMS.HS256) {
      if (!secret) {
        return { valid: false, reason: 'no verification secret configured' };
      }
      const expected = crypto.createHmac('sha256', secret).update(signingInput, 'utf8').digest();
      if (expected.length !== signatureBytes.length) {
        return { valid: false, reason: 'signature verification failed' };
      }
      signatureOk = crypto.timingSafeEqual(expected, signatureBytes);
    } else if (algorithm === JWT_ALGORITHMS.RS256) {
      if (!publicKey) {
        return { valid: false, reason: 'no verification key configured' };
      }
      signatureOk = crypto.verify('sha256', Buffer.from(signingInput, 'utf8'), publicKey, signatureBytes);
    } else {
      return { valid: false, reason: 'unsupported algorithm: ' + algorithm };
    }

    if (!signatureOk) {
      return { valid: false, reason: 'signature verification failed' };
    }

    const nowMs = now != null ? new Date(now).getTime() : Date.now();
    if (typeof payload.exp !== 'number' || nowMs >= payload.exp * 1000) {
      return { valid: false, reason: 'token expired or missing exp' };
    }
    if (payload.iss !== issuer) {
      return { valid: false, reason: 'issuer mismatch' };
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud != null ? [payload.aud] : [];
    if (!audiences.includes(audience)) {
      return { valid: false, reason: 'audience mismatch' };
    }

    const groups = payload.groups;
    return {
      valid: true,
      reason: 'ok',
      header,
      payload,
      subject: payload.sub != null ? payload.sub : null,
      groups,
      roles: resolveRolesFromGroups(groups)
    };
  } catch (error) {
    return { valid: false, reason: 'malformed token: ' + error.message };
  }
}

function authorizeWithIdentity(identity, request) {
  const roles = identity && Array.isArray(identity.roles) && identity.roles.length > 0 ? identity.roles : ['Guest'];
  const results = roles.map((role) =>
    EnterpriseIAM.evaluateAccess(Object.assign({}, request, { user: Object.assign({}, request.user, { role }) }))
  );
  const granted = results.some((result) => result.granted);
  const firstDenied = results.find((result) => !result.granted);
  return {
    granted,
    roles,
    results,
    reason: granted
      ? 'GRANTED via enterprise SSO role mapping'
      : firstDenied
        ? firstDenied.reason
        : 'DENIED: no mapped role permits action'
  };
}

const EnterpriseSSO = Object.freeze({
  canonicalizeSAMLAssertion,
  parseSAMLAssertion,
  verifySAMLAssertion,
  signCompactJWT,
  validateOIDCIDToken,
  resolveRolesFromGroups,
  normalizeGroups,
  authorizeWithIdentity
});

module.exports = {
  EnterpriseIAM,
  EnterpriseSSO,
  ACTIONS,
  CLEARANCE_LEVELS,
  ROLE_PERMISSIONS,
  SSO_PROVIDERS,
  JWT_ALGORITHMS,
  GROUP_TO_ROLE
};
