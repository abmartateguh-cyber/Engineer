'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { StenographerSupervisor } = require('../src/main/stenographer_supervisor');

async function runStenographerDaemonLifecycleTests() {
  const results = [];
  async function runCase(name, fn) {
    try {
      await fn();
      results.push({ ok: true });
    } catch (err) {
      results.push({ ok: false });
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  await runCase('connect lifecycle: alive, deliberate disconnect stays disconnected', async () => {
    const supervisor = new StenographerSupervisor({
      daemonPath: process.execPath,
      daemonArgs: [
        '-e',
        'process.stdout.write("READY\\n"); process.stderr.write("WARN\\n"); setInterval(() => {}, 1000)'
      ],
      bindRegistry: false
    });
    try {
      await Promise.all([supervisor.connect(), supervisor.connect()]);
      assert.equal((await supervisor.getStatus()).alive, true);
      if (supervisor.rl) supervisor.rl.emit('line', 'READY');
      if (supervisor.process?.stderr) supervisor.process.stderr.emit('data', Buffer.from('WARN\n'));
      await Promise.race([
        Promise.all([
          new Promise((resolve) => (supervisor.rl ? supervisor.rl.once('line', resolve) : resolve())),
          new Promise((resolve) => supervisor.once('daemon:stderr', resolve))
        ]),
        new Promise((resolve) => setTimeout(resolve, 600))
      ]);
      const child = supervisor.process;
      const exit = once(child, 'exit');
      await supervisor.disconnect();
      await exit;
      await new Promise((resolve) => setTimeout(resolve, 650));
      assert.equal((await supervisor.getStatus()).alive, false, 'deliberate disconnect must stay disconnected');
      assert.equal(supervisor.restartCount, 0, 'deliberate disconnect must not consume a restart');
    } finally {
      await supervisor.disconnect();
    }
  });

  await runCase('disconnect during pending connect does not hang', async () => {
    const pendingSup = new StenographerSupervisor({
      daemonPath: process.execPath,
      daemonArgs: ['-e', 'setInterval(() => {}, 1000)'],
      bindRegistry: false
    });
    const p = pendingSup.connect();
    await pendingSup.disconnect();
    await p.catch(() => {});
  });

  await runCase('missing daemon binary is reported as failed spawn', async () => {
    const missing = new StenographerSupervisor({
      daemonPath: '/no-such-omnieng-stenographer-executable',
      maxRestarts: 0,
      bindRegistry: false
    });
    await assert.rejects(missing.connect(), /Failed to spawn daemon/);
    assert.equal((await missing.getStatus()).alive, false, 'failed spawn must not report connected');
  });

  await runCase('crashing daemon consumes restart budget then reports exhausted', async () => {
    const crashing = new StenographerSupervisor({
      daemonPath: process.execPath,
      daemonArgs: ['-e', 'setTimeout(() => process.exit(7), 20)'],
      maxRestarts: 1,
      bindRegistry: false
    });
    crashing.once('daemon:restarting', () => {
      crashing.daemonPath = '/no-such-omnieng-daemon-path-on-restart';
    });
    try {
      const exhausted = once(crashing, 'daemon:exhausted');
      await crashing.connect();
      await exhausted;
      assert.equal(crashing.restartCount, 1, 'unexpected exit must use the configured restart budget');
      assert.equal((await crashing.getStatus()).alive, false, 'exhausted daemon must report unavailable');
    } finally {
      await crashing.disconnect();
    }
  });

  const total = results.length;
  const failed = results.filter((r) => !r.ok).length;
  const passed = total - failed;
  console.log(`Stenographer daemon lifecycle checks: ${passed}/${total} passed, ${failed} failed`);
  return { total, passed, failed };
}

if (require.main === module) {
  runStenographerDaemonLifecycleTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runStenographerDaemonLifecycleTests };
