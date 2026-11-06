'use strict';

const assert = require('assert');
const http = require('http');
const { createWorkstationServer } = require('../src/main/workstation_web_server');

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

(async () => {
  console.log('================================================================');
  console.log('       TESTING WORKSTATION WEB SERVER & IPC BRIDGE              ');
  console.log('================================================================\n');

  const TEST_PORT = 3199;
  const { server, port, host, token, ipcHandlers } = createWorkstationServer({ port: TEST_PORT, host: '127.0.0.1' });

  await new Promise((resolve) => server.listen(port, host, resolve));
  console.log(`[1] Server started on http://${host}:${port}`);
  assert.strictEqual(ipcHandlers.size, 180, `Expected 180 IPC channels, found ${ipcHandlers.size}`);
  console.log(`  ✓ 180 IPC channels registered in web dispatcher\n`);

  const sessionRes = await makeRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/session',
    method: 'GET'
  });
  assert.strictEqual(sessionRes.statusCode, 200);
  const sessionJson = JSON.parse(sessionRes.body);
  assert.strictEqual(sessionJson.token, token, 'session endpoint must return the server session token');
  console.log('[1b] Session token endpoint issued token\n');

  const authedHeaders = {
    'Content-Type': 'application/json',
    'X-OmniEng-Session': token
  };

  // Test 1: Health check endpoint
  console.log('[2] Testing GET /api/health...');
  const healthRes = await makeRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/api/health',
    method: 'GET'
  });
  assert.strictEqual(healthRes.statusCode, 200);
  const healthJson = JSON.parse(healthRes.body);
  assert.strictEqual(healthJson.status, 'ok');
  assert.strictEqual(healthJson.channels, 180);
  console.log(`  ✓ PASSED: Health endpoint returned 200 OK with ${healthJson.channels} active channels\n`);

  // Test 2: Static file serving (index.html)
  console.log('[3] Testing GET /index.html...');
  const indexRes = await makeRequest({
    hostname: '127.0.0.1',
    port: TEST_PORT,
    path: '/index.html',
    method: 'GET'
  });
  assert.strictEqual(indexRes.statusCode, 200);
  assert(indexRes.headers['content-type'].includes('text/html'));
  assert(indexRes.body.includes('OmniEng') || indexRes.body.includes('viewport'));
  assert(indexRes.headers['content-security-policy'], 'index.html must carry a CSP header');
  assert.strictEqual(indexRes.headers['x-frame-options'], 'DENY');
  assert(indexRes.headers['content-security-policy'].includes("script-src 'self'"));
  console.log(`  ✓ PASSED: Static file server served index.html with CSP headers (${indexRes.body.length} bytes)\n`);

  // Test 3: IPC invocation through POST /api/ipc (omni:size-api520-prv)
  console.log('[4] Testing POST /api/ipc (omni:size-api520-prv)...');
  const prvIpcRes = await makeRequest(
    {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ipc',
      method: 'POST',
      headers: authedHeaders
    },
    {
      channel: 'omni:size-api520-prv',
      args: [
        {
          massFlow: 10000,
          P1: 1000,
          Pb: 101.325,
          T: 350,
          M: 28.97,
          k: 1.4
        }
      ]
    }
  );
  assert.strictEqual(prvIpcRes.statusCode, 200);
  const prvResult = JSON.parse(prvIpcRes.body);
  assert.strictEqual(prvResult.success, true);
  assert(prvResult.sizing && prvResult.sizing.requiredArea_sq_mm > 0);
  // SI choked-gas sizing (kg/h, kPa abs) must stay in physical mm² range
  // (the US-unit 13160 factor would inflate this case to ~17.4e6 mm²).
  assert(
    prvResult.sizing.requiredArea_sq_mm < 5000,
    `area ${prvResult.sizing.requiredArea_sq_mm} mm² exceeds physical SI range`
  );
  assert(prvResult.sizing.selectedOrifice && prvResult.sizing.selectedOrifice.designation);
  console.log(
    `  ✓ PASSED: omni:size-api520-prv returned relief area ${prvResult.sizing.requiredArea_sq_mm.toFixed(1)} mm² (orifice ${prvResult.sizing.selectedOrifice.designation})\n`
  );

  // Test 4: IPC invocation through POST /api/ipc (omni:generate-p-id)
  console.log('[5] Testing POST /api/ipc (omni:generate-p-id)...');
  const pidIpcRes = await makeRequest(
    {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ipc',
      method: 'POST',
      headers: authedHeaders
    },
    {
      channel: 'omni:generate-p-id',
      args: [{ template: 'oilgas' }]
    }
  );
  assert.strictEqual(pidIpcRes.statusCode, 200);
  const pidResult = JSON.parse(pidIpcRes.body);
  assert.strictEqual(pidResult.success, true);
  assert(Array.isArray(pidResult.sheets) && pidResult.sheets.length > 0);
  console.log(`  ✓ PASSED: omni:generate-p-id generated ${pidResult.sheets.length} P&ID drawing sheet(s)\n`);

  // Test 5: IPC invocation through POST /api/ipc (omni:pkcs11-sign-payload)
  console.log('[6] Testing POST /api/ipc (omni:pkcs11-sign-payload)...');
  const hsmIpcRes = await makeRequest(
    {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ipc',
      method: 'POST',
      headers: authedHeaders
    },
    {
      channel: 'omni:pkcs11-sign-payload',
      args: [{ payload: 'ENGINEERING_ECO_VERIFICATION_HASH_2026' }]
    }
  );
  assert.strictEqual(hsmIpcRes.statusCode, 200);
  const hsmResult = JSON.parse(hsmIpcRes.body);
  assert.strictEqual(hsmResult.success, true);
  assert(hsmResult.signatureHex);
  console.log(`  ✓ PASSED: omni:pkcs11-sign-payload generated ECDSA signature (${hsmResult.algorithm})\n`);

  // Test 6: Unknown IPC channel returns 404
  console.log('[7] Testing POST /api/ipc with unknown channel...');
  const unknownIpcRes = await makeRequest(
    {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ipc',
      method: 'POST',
      headers: authedHeaders
    },
    {
      channel: 'invalid:unknown-channel',
      args: []
    }
  );
  assert.strictEqual(unknownIpcRes.statusCode, 404);
  console.log(`  ✓ PASSED: Unknown channel correctly returned 404 Channel Not Found\n`);

  // Test 7: IPC without session token is rejected (401)
  console.log('[8] Testing POST /api/ipc without session token...');
  const noTokenRes = await makeRequest(
    {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ipc',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    {
      channel: 'omni:solve-thermal',
      args: []
    }
  );
  assert.strictEqual(noTokenRes.statusCode, 401);
  assert(JSON.parse(noTokenRes.body).error.code === 'SESSION_REQUIRED');
  console.log('  ✓ PASSED: IPC without session token rejected with 401\n');

  // Test 8: IPC with disallowed Origin is rejected (403)
  console.log('[9] Testing POST /api/ipc with foreign Origin...');
  const badOriginRes = await makeRequest(
    {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ipc',
      method: 'POST',
      headers: { ...authedHeaders, Origin: 'https://evil.example.com' }
    },
    {
      channel: 'omni:solve-thermal',
      args: []
    }
  );
  assert.strictEqual(badOriginRes.statusCode, 403);
  assert(JSON.parse(badOriginRes.body).error.code === 'ORIGIN_DENIED');
  console.log('  ✓ PASSED: Foreign origin rejected with 403\n');

  // Clean shutdown
  await new Promise((resolve) => server.close(resolve));
  console.log('================================================================');
  console.log('   ALL WORKSTATION WEB SERVER TESTS PASSED (8/8)!               ');
  console.log('================================================================\n');
})();
