const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const test = require('node:test');

const hostPath = path.join(__dirname, '..', 'native', 'xgsim-host', 'bin', 'Release', 'xgsim-host-x86.exe');

test('XG-SIM host answers hello while the Electron stdio session stays open', {
  skip: process.platform !== 'win32' || !fs.existsSync(hostPath),
  timeout: 8_000,
}, async () => {
  const child = spawn(hostPath, [], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const nonce = crypto.randomBytes(32).toString('hex');
  const requestId = crypto.randomUUID();
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  try {
    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('hello response timed out while stdin remained open')), 4_000);
      lines.once('line', (line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      });
      child.once('error', reject);
    });

    child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId, nonce, command: 'hello', payload: {} })}\n`);
    const response = await responsePromise;

    assert.equal(child.stdin.destroyed, false);
    assert.equal(response.ok, true);
    assert.equal(response.requestId, requestId);
    assert.equal(response.nonce, nonce);
  } finally {
    lines.close();
    child.stdin.end();
    child.kill();
  }
});
