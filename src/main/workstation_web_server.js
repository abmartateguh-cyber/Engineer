/**
 * OmniEng Standalone Web Workstation Server.
 *
 * Runs OmniEng directly in any modern web browser (Safari, Chrome, Firefox, Edge)
 * without requiring Electron or native desktop wrappers.
 *
 * Features:
 * - Zero external dependencies (uses native node:http, node:fs, node:path, node:url, node:crypto).
 * - Full IPC bridge mapping: routes all 180+ domain IPC channels (CAD, CAE, EDA,
 *   Optics, Plant, Controls, System) through HTTP POST /api/ipc.
 * - Static file server for the complete Web workstation UI, styles, vendor libs, and shaders.
 * - Fallback polyfill support for window.omniEngAPI and window.electronAPI.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Master Schema-Validated IPC Hub
const { registerAllIpcHandlers, withIpcMain } = require('./ipc');

// Domain Service Singletons
const { CloudHPCEngine } = require('../core/hpc/cloud_cluster');
const {
  DropTestWizard,
  DroneDesignWizard,
  CameraLensWizard,
  PCBDesignWizard
} = require('../ui/wizards/design_wizards');
const { ImmutableAuditLedger } = require('../core/compliance/immutable_audit_ledger');
const { OutOfCoreAssemblyManager } = require('../core/cad/out_of_core_octree');
const { KeymapManager } = require('../ui/keymap_manager');

const auditLedger = new ImmutableAuditLedger('OmniEng_Web_Workstation_Session');
const outOfCoreOctree = new OutOfCoreAssemblyManager();
const keymapManager = new KeymapManager();
const hpcEngine = new CloudHPCEngine({ provider: 'local' });

class WebSoftwareHsmProvider {
  constructor() {
    this._keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
  }
  sign({ payload, keyId = 'omni-web-signer-1' } = {}) {
    try {
      if (typeof payload !== 'string' || payload.length === 0) {
        return { success: false, error: { code: 'INVALID_INPUT', message: 'Payload required' } };
      }
      const signer = crypto.createSign('SHA256');
      signer.update(payload);
      signer.end();
      const signatureHex = signer.sign(this._keyPair.privateKey, 'hex');
      return {
        success: true,
        keyId,
        algorithm: 'ECDSA-P256-SHA256',
        signatureHex,
        publicKeyPem: this._keyPair.publicKey
      };
    } catch (err) {
      return { success: false, error: { code: 'INTERNAL', message: err.message } };
    }
  }
  verify({ payload, signatureHex, publicKeyPem } = {}) {
    try {
      const pubKey = publicKeyPem || this._keyPair.publicKey;
      const verifier = crypto.createVerify('SHA256');
      verifier.update(payload);
      verifier.end();
      const valid = verifier.verify(pubKey, Buffer.from(signatureHex, 'hex'));
      return { success: true, valid, algorithm: 'ECDSA-P256-SHA256' };
    } catch (err) {
      return { success: false, error: { code: 'INTERNAL', message: err.message } };
    }
  }
}

const hsmProvider = new WebSoftwareHsmProvider();

const validationService = {
  runBenchmarks({ suite } = {}) {
    try {
      const { runAllVVBenchmarks, listVVBenchmarks } = require('../core/vv/vv_registry');
      const report = runAllVVBenchmarks();
      return {
        success: true,
        suite: suite === 'extended' ? 'extended' : 'core',
        catalog: listVVBenchmarks(),
        ...report,
        releaseApproved: false
      };
    } catch (err) {
      return { success: false, error: { code: 'INTERNAL', message: err.message } };
    }
  }
};

const designWizards = {
  drop_test: new DropTestWizard(),
  drone: new DroneDesignWizard(),
  camera_lens: new CameraLensWizard(),
  pcb: new PCBDesignWizard()
};

// Virtual IPC Hub: maps Electron-style ipcMain.handle to in-memory dispatch map
const ipcHandlers = new Map();
const virtualIpcMain = {
  handle(channel, handler) {
    ipcHandlers.set(channel, handler);
  }
};

// Register all domain IPC routes into the virtual dispatcher
registerAllIpcHandlers({
  ipcMain: virtualIpcMain,
  auditLedger,
  outOfCoreOctree,
  keymapManager,
  hpcEngine,
  designWizards,
  validationService,
  hsmProvider
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

const SRC_ROOT = path.resolve(__dirname, '..'); // Points to /src
const PROJECT_ROOT = path.resolve(SRC_ROOT, '..');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'"
};

function handleStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(SRC_ROOT, safePath);

  // If file doesn't exist in /src, check in project root (for vendor or docs if needed)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const fallbackPath = path.join(PROJECT_ROOT, safePath);
    if (fs.existsSync(fallbackPath) && !fs.statSync(fallbackPath).isDirectory()) {
      filePath = fallbackPath;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`404 Not Found: ${pathname}`);
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate',
      ...SECURITY_HEADERS
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal Server Error: ${err.message}`);
  }
}

function isAllowedOrigin(origin, port) {
  if (!origin || origin === 'null') return true;
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
  return allowed.has(origin);
}

async function handleIpcPost(req, res, { token, port }) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin, port)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: { code: 'ORIGIN_DENIED', message: 'Origin not allowed' } }));
  }

  if (req.headers['x-omnieng-session'] !== token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({ success: false, error: { code: 'SESSION_REQUIRED', message: 'Valid session token required' } })
    );
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 50 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds 50MB' } })
      );
      req.destroy();
    }
  });

  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const { channel, args } = payload;

      if (!channel || typeof channel !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({ success: false, error: { code: 'INVALID_REQUEST', message: 'Channel name required' } })
        );
      }

      const handler = ipcHandlers.get(channel);
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: false,
            error: { code: 'CHANNEL_NOT_FOUND', message: `IPC channel ${channel} not registered` }
          })
        );
      }

      const trustedPath = path.resolve(__dirname, '..', 'index.html');
      const trustedUrl = url.pathToFileURL ? url.pathToFileURL(trustedPath).href : `file://${trustedPath}`;
      const fakeEvent = {
        sender: {
          id: 1,
          isDestroyed: () => false,
          mainFrame: { frameTreeNodeId: 1 },
          getURL: () => trustedUrl
        },
        senderFrame: {
          frameTreeNodeId: 1,
          url: trustedUrl
        }
      };

      const handlerArgs = Array.isArray(args) ? args : args !== undefined ? [args] : [];
      const result = await handler(fakeEvent, ...handlerArgs);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-OmniEng-Channel': channel
      });
      res.end(JSON.stringify(result !== undefined ? result : { success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }));
    }
  });
}

function createWorkstationServer(options = {}) {
  const port = options.port || parseInt(process.env.PORT, 10) || 3000;
  const host = options.host || '127.0.0.1';
  const token = crypto.randomBytes(32).toString('hex');

  const server = http.createServer((req, res) => {
    // Loopback-only CORS: origin is validated per-request on IPC routes.
    res.setHeader('Access-Control-Allow-Origin', `http://127.0.0.1:${port}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OmniEng-Channel, X-OmniEng-Session');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (req.method === 'POST' && pathname === '/api/ipc') {
      return handleIpcPost(req, res, { token, port });
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ token }));
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ status: 'ok', channels: ipcHandlers.size, version: '1.0.0' }));
    }

    if (req.method === 'GET') {
      return handleStaticFile(req, res, pathname);
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  });

  return { server, port, host, token, ipcHandlers };
}

if (require.main === module) {
  const { server, port, host, ipcHandlers } = createWorkstationServer();
  server.listen(port, host, () => {
    console.log('\n================================================================');
    console.log('   OmniEng Web Workstation Server is Live');
    console.log('================================================================');
    console.log(`  Access URL:     http://${host}:${port}/`);
    console.log(`  IPC Endpoints:  ${ipcHandlers.size} channels active at /api/ipc`);
    console.log(`  Compatible:     Safari, Chrome, Firefox, Edge, iPad, Laptops`);
    console.log('================================================================\n');
  });
}

module.exports = {
  createWorkstationServer,
  ipcHandlers
};
