'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  EnterpriseIAM,
  EnterpriseSSO,
  ACTIONS,
  ROLE_PERMISSIONS,
  JWT_ALGORITHMS
} = require('../src/core/security/enterprise_iam');

const IDP_ISSUER = 'https://idp.example.com';
const SP_AUDIENCE = 'https://app.example.com/sso';
const SUBJECT = 'dr_smith';
const NOW = '2026-11-05T12:00:00Z';
const NOT_BEFORE = '2026-11-05T11:59:00Z';
const NOT_ON_OR_AFTER = '2026-11-05T13:00:00Z';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SHARED_SECRET = 'omnieng-sso-test-secret-2026';

function base64urlEncode(input) {
  return Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)).toString('base64url');
}

function makeCompactJWT({ header, payload, secret, signingKey, alg }) {
  const signingInput = base64urlEncode(header) + '.' + base64urlEncode(payload);
  let signature;
  if (alg === JWT_ALGORITHMS.HS256) {
    signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  } else if (alg === JWT_ALGORITHMS.RS256) {
    signature = crypto.sign('sha256', Buffer.from(signingInput), signingKey);
  } else {
    signature = Buffer.alloc(0);
  }
  return signingInput + '.' + signature.toString('base64url');
}

function makeSAMLAssertion({
  issuer = IDP_ISSUER,
  audience = SP_AUDIENCE,
  subject = SUBJECT,
  notBefore = NOT_BEFORE,
  notOnOrAfter = NOT_ON_OR_AFTER,
  groups = 'designers,approvers',
  id = '_a1b2c3',
  sign = true
} = {}) {
  const groupsAttr =
    groups !== null
      ? `<saml:Attribute Name="groups"><saml:AttributeValue>${groups}</saml:AttributeValue></saml:Attribute>`
      : '';
  const unsigned =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="2026-11-05T12:00:00Z">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject><saml:NameID>${subject}</saml:NameID></saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AttributeStatement>${groupsAttr}</saml:AttributeStatement>`;
  const fullUnsigned = unsigned + '</saml:Assertion>';
  if (!sign) {
    return fullUnsigned;
  }
  const canonical = EnterpriseSSO.canonicalizeSAMLAssertion(fullUnsigned);
  const signature = crypto.sign('sha256', Buffer.from(canonical), privateKey).toString('base64');
  return (
    unsigned +
    `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
    `<ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
    `<ds:Reference URI="#${id}"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>dGVzdA==</ds:DigestValue></ds:Reference></ds:SignedInfo>` +
    `<ds:SignatureValue>${signature}</ds:SignatureValue>` +
    `</ds:Signature></saml:Assertion>`
  );
}

function tamperSignatureByte(xml) {
  const match = xml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/);
  assert.ok(match, 'test: signature value must exist');
  const original = Buffer.from(match[1], 'base64');
  const mutated = Buffer.from(original);
  mutated[0] ^= 0x01;
  const replacement = mutated.toString('base64');
  return xml.replace(match[1], replacement);
}

// ---------------------------------------------------------------------------
// SAML
// ---------------------------------------------------------------------------

test('SAML: signed assertion validates (signature, issuer, audience, time window)', () => {
  const xml = makeSAMLAssertion();
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml,
    issuer: IDP_ISSUER,
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.subject, SUBJECT);
  assert.equal(result.issuer, IDP_ISSUER);
  assert.equal(result.audience, SP_AUDIENCE);
  assert.deepEqual(result.groups, 'designers,approvers');
  assert.deepEqual(result.roles, ['EdaEngineer', 'ChiefEngineer']);
});

test('SAML: one byte changed in signature -> validation fails', () => {
  const xml = tamperSignatureByte(makeSAMLAssertion());
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml,
    issuer: IDP_ISSUER,
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signature/);
});

test('SAML: assertion body mutated after signing -> fails', () => {
  const mutated = makeSAMLAssertion().replace(SUBJECT, 'dr_mallory');
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml: mutated,
    issuer: IDP_ISSUER,
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signature/);
});

test('SAML: expired assertion fails time window', () => {
  const xml = makeSAMLAssertion({ notOnOrAfter: '2026-11-05T11:30:00Z' });
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml,
    issuer: IDP_ISSUER,
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /expired/);
});

test('SAML: not-yet-valid assertion fails time window', () => {
  const xml = makeSAMLAssertion({ notBefore: '2026-11-05T12:30:00Z' });
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml,
    issuer: IDP_ISSUER,
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /not yet valid/);
});

test('SAML: wrong issuer fails', () => {
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml: makeSAMLAssertion(),
    issuer: 'https://evil.example.com',
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /issuer/);
});

test('SAML: wrong audience fails', () => {
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml: makeSAMLAssertion(),
    issuer: IDP_ISSUER,
    audience: 'https://evil.example.com/cb',
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /audience/);
});

test('SAML: missing signature fails closed', () => {
  const result = EnterpriseSSO.verifySAMLAssertion({
    xml: makeSAMLAssertion({ sign: false }),
    issuer: IDP_ISSUER,
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signature/);
});

test('SAML: malformed input fails closed without throwing', () => {
  for (const garbage of ['', 'not xml at all', '<xml>unclosed', null, undefined, 42, {}]) {
    const result = EnterpriseSSO.verifySAMLAssertion({
      xml: garbage,
      issuer: IDP_ISSUER,
      audience: SP_AUDIENCE,
      certificate: publicKey,
      now: NOW
    });
    assert.equal(result.valid, false, `must reject input of type ${typeof garbage}`);
    assert.equal(typeof result.reason, 'string');
  }
});

// ---------------------------------------------------------------------------
// OIDC / JWT
// ---------------------------------------------------------------------------

const NOW_SECONDS = Math.floor(Date.parse(NOW) / 1000);
const FUTURE_EXP = NOW_SECONDS + 3600;
const PAST_EXP = NOW_SECONDS - 3600;

function oidcOptions(overrides = {}) {
  return Object.assign({ issuer: IDP_ISSUER, audience: SP_AUDIENCE, now: NOW }, overrides);
}

test('OIDC: HS256 ID token validates and extracts groups claim', () => {
  const token = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.HS256, typ: 'JWT' },
    payload: { iss: IDP_ISSUER, sub: SUBJECT, aud: SP_AUDIENCE, exp: FUTURE_EXP, groups: ['designers', 'approvers'] },
    secret: SHARED_SECRET,
    alg: JWT_ALGORITHMS.HS256
  });
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token, secret: SHARED_SECRET }));
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.subject, SUBJECT);
  assert.deepEqual(result.groups, ['designers', 'approvers']);
  assert.deepEqual(result.roles, ['EdaEngineer', 'ChiefEngineer']);
});

test('OIDC: RS256 ID token validates with asymmetric key', () => {
  const token = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.RS256, typ: 'JWT' },
    payload: { iss: IDP_ISSUER, sub: SUBJECT, aud: SP_AUDIENCE, exp: FUTURE_EXP, groups: ['auditors'] },
    signingKey: privateKey,
    alg: JWT_ALGORITHMS.RS256
  });
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token, publicKey }));
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.roles, ['QualityAuditor']);
});

test('OIDC: expired token fails', () => {
  const token = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.HS256, typ: 'JWT' },
    payload: { iss: IDP_ISSUER, sub: SUBJECT, aud: SP_AUDIENCE, exp: PAST_EXP, groups: ['designers'] },
    secret: SHARED_SECRET,
    alg: JWT_ALGORITHMS.HS256
  });
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token, secret: SHARED_SECRET }));
  assert.equal(result.valid, false);
  assert.match(result.reason, /expired/);
});

test('OIDC: wrong issuer fails', () => {
  const token = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.HS256, typ: 'JWT' },
    payload: { iss: 'https://evil.example.com', sub: SUBJECT, aud: SP_AUDIENCE, exp: FUTURE_EXP, groups: [] },
    secret: SHARED_SECRET,
    alg: JWT_ALGORITHMS.HS256
  });
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token, secret: SHARED_SECRET }));
  assert.equal(result.valid, false);
  assert.match(result.reason, /issuer/);
});

test('OIDC: wrong audience fails', () => {
  const token = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.HS256, typ: 'JWT' },
    payload: { iss: IDP_ISSUER, sub: SUBJECT, aud: 'https://evil.example.com/cb', exp: FUTURE_EXP, groups: [] },
    secret: SHARED_SECRET,
    alg: JWT_ALGORITHMS.HS256
  });
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token, secret: SHARED_SECRET }));
  assert.equal(result.valid, false);
  assert.match(result.reason, /audience/);
});

test('OIDC: tampered signature fails', () => {
  const good = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.HS256, typ: 'JWT' },
    payload: { iss: IDP_ISSUER, sub: SUBJECT, aud: SP_AUDIENCE, exp: FUTURE_EXP, groups: ['designers'] },
    secret: SHARED_SECRET,
    alg: JWT_ALGORITHMS.HS256
  });
  const parts = good.split('.');
  const tampered = parts[0] + '.' + parts[1] + '.' + parts[2].replace(/^./, parts[2][0] === 'A' ? 'B' : 'A');
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token: tampered, secret: SHARED_SECRET }));
  assert.equal(result.valid, false);
  assert.match(result.reason, /signature/);
});

test('OIDC: malformed tokens fail closed without throwing', () => {
  const garbageTokens = [
    '',
    'not-a-jwt',
    'a.b',
    '...',
    'a.b.c.d',
    '!!!.###.???',
    '{bad json}.e30.e30',
    'e30.{"exp":123}.e30'
  ];
  for (const token of garbageTokens) {
    const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token, secret: SHARED_SECRET }));
    assert.equal(result.valid, false, `must reject token ${JSON.stringify(token)}`);
    assert.equal(typeof result.reason, 'string');
  }
  const algNoneHeader = { alg: 'none', typ: 'JWT' };
  const algNonePayload = { iss: IDP_ISSUER, sub: SUBJECT, aud: SP_AUDIENCE, exp: FUTURE_EXP };
  const algNone = base64urlEncode(algNoneHeader) + '.' + base64urlEncode(algNonePayload) + '.AAAA';
  const noneResult = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token: algNone, secret: SHARED_SECRET }));
  assert.equal(noneResult.valid, false);
  assert.match(noneResult.reason, /unsupported algorithm/);
});

test('OIDC: missing verification key fails closed', () => {
  const token = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.RS256, typ: 'JWT' },
    payload: { iss: IDP_ISSUER, sub: SUBJECT, aud: SP_AUDIENCE, exp: FUTURE_EXP, groups: [] },
    signingKey: privateKey,
    alg: JWT_ALGORITHMS.RS256
  });
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token }));
  assert.equal(result.valid, false);
  assert.match(result.reason, /key/);
});

// ---------------------------------------------------------------------------
// Group -> RBAC role mapping
// ---------------------------------------------------------------------------

test('RBAC: SAML groups map to roles that grant expected permissions', () => {
  const samlResult = EnterpriseSSO.verifySAMLAssertion({
    xml: makeSAMLAssertion({ groups: 'designers,approvers' }),
    issuer: IDP_ISSUER,
    audience: SP_AUDIENCE,
    certificate: publicKey,
    now: NOW
  });
  assert.equal(samlResult.valid, true);
  assert.deepEqual(samlResult.roles, ['EdaEngineer', 'ChiefEngineer']);

  for (const role of samlResult.roles) {
    assert.ok(ROLE_PERMISSIONS[role], `role ${role} must exist in RBAC table`);
  }
  assert.ok(ROLE_PERMISSIONS.EdaEngineer.includes(ACTIONS.EXPORT_GDSII));
  assert.ok(ROLE_PERMISSIONS.ChiefEngineer.includes(ACTIONS.APPROVE_ECO));

  const granted = EnterpriseSSO.authorizeWithIdentity(samlResult, {
    user: { username: SUBJECT, clearance: 'SECRET', assignedProjects: ['PRJ-1'] },
    action: ACTIONS.APPROVE_ECO,
    resource: { id: 'ECO-1', projectId: 'PRJ-1', classification: 'SECRET' }
  });
  assert.equal(granted.granted, true, granted.reason);
});

test('RBAC: OIDC groups array maps to same roles', () => {
  const token = makeCompactJWT({
    header: { alg: JWT_ALGORITHMS.HS256, typ: 'JWT' },
    payload: { iss: IDP_ISSUER, sub: SUBJECT, aud: SP_AUDIENCE, exp: FUTURE_EXP, groups: ['auditors', 'stress'] },
    secret: SHARED_SECRET,
    alg: JWT_ALGORITHMS.HS256
  });
  const result = EnterpriseSSO.validateOIDCIDToken(oidcOptions({ token, secret: SHARED_SECRET }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.roles, ['QualityAuditor', 'StressAnalyst']);
  assert.ok(ROLE_PERMISSIONS.QualityAuditor.includes(ACTIONS.AUDIT_LOGS));
  assert.ok(ROLE_PERMISSIONS.StressAnalyst.includes(ACTIONS.RUN_SIMULATION));

  const granted = EnterpriseSSO.authorizeWithIdentity(result, {
    user: { username: SUBJECT, clearance: 'CONFIDENTIAL' },
    action: ACTIONS.AUDIT_LOGS,
    resource: { id: 'LOG-7', classification: 'CONFIDENTIAL' }
  });
  assert.equal(granted.granted, true, granted.reason);
});

test('RBAC: unknown groups fall back to Guest (read-only) and deny actions', () => {
  const roles = EnterpriseSSO.resolveRolesFromGroups('marketing,interns');
  assert.deepEqual(roles, ['Guest']);
  assert.deepEqual(ROLE_PERMISSIONS.Guest, [ACTIONS.READ]);

  const denied = EnterpriseSSO.authorizeWithIdentity(
    { roles },
    {
      user: { username: SUBJECT, clearance: 'UNCLASSIFIED' },
      action: ACTIONS.MODIFY_CAD,
      resource: { id: 'CAD-9', classification: 'UNCLASSIFIED' }
    }
  );
  assert.equal(denied.granted, false);
  assert.match(denied.reason, /DENIED/);
});
