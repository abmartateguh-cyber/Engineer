'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const handlers = new Map();
const repositoryRoot = path.resolve(__dirname, '..');
const electronMock = {
  app: { getAppPath: () => repositoryRoot },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  }
};

const originalLoad = Module._load;
Module._load = function loadWithElectronIpcMock(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

let registerSystemIpc;
try {
  ({ registerSystemIpc } = require('../src/main/ipc/system_ipc'));
} finally {
  Module._load = originalLoad;
}

async function runSessionSnapshotIpcTests() {
  registerSystemIpc();
  const encrypt = handlers.get('omni:vault-encrypt-project');
  const decrypt = handlers.get('omni:vault-decrypt-project');
  assert.equal(typeof encrypt, 'function');
  assert.equal(typeof decrypt, 'function');

  const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
  const event = {
    sender: {
      isDestroyed: () => false,
      mainFrame: { frameTreeNodeId: 7 }
    },
    senderFrame: { frameTreeNodeId: 7, url: entryUrl }
  };
  const password = 'verified-session-snapshot-password';
  const payload = {
    format: 'experimental-session-snapshot',
    schemaVersion: 1,
    manualParams: { massKg: 2.5 }
  };

  const encrypted = await encrypt(event, { password, payload });
  assert.equal(encrypted.success, true);
  assert.equal(encrypted.isEncrypted, true);

  const encryptedBytes = Uint8Array.from(Buffer.from(encrypted.encryptedBase64, 'base64'));
  const binaryResult = await decrypt(event, { password, encryptedBytes });
  const base64Result = await decrypt(event, { password, encryptedBase64: encrypted.encryptedBase64 });
  assert.deepEqual(binaryResult.payload, payload);
  assert.deepEqual(base64Result.payload, payload);

  const malformed = await decrypt(event, { password, encryptedBase64: 'not base64!' });
  assert.equal(malformed.success, false);
  await assert.rejects(() =>
    decrypt(event, { password: 'incorrect-password', encryptedBase64: encrypted.encryptedBase64 })
  );
  await assert.rejects(
    () => decrypt(event, { password, encryptedBytes: new Uint8Array(16 * 1024 * 1024 + 1) }),
    /exceeds maximum/
  );

  return true;
}

if (require.main === module) {
  runSessionSnapshotIpcTests()
    .then(() => console.log('Session snapshot IPC integration passed.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runSessionSnapshotIpcTests };
