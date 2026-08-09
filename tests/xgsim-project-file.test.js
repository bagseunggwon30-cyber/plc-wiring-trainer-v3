const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectXgSimProjectFile } = require('../src/main/xgsim-project-file');

test('project inspection returns bounded metadata and SHA-256 without exposing file contents', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plc-trainer-xgwx-'));
  const filePath = path.join(directory, 'PLC-Trainer-SelfHold.xgwx');
  const content = Buffer.from('fixture-xgwx-content');
  try {
    await fs.writeFile(filePath, content);
    const reference = await inspectXgSimProjectFile(filePath);
    assert.equal(reference.schemaVersion, 1);
    assert.equal(reference.absolutePath, path.resolve(filePath));
    assert.equal(reference.fileName, 'PLC-Trainer-SelfHold.xgwx');
    assert.equal(reference.sizeBytes, content.length);
    assert.equal(reference.sha256, crypto.createHash('sha256').update(content).digest('hex'));
    assert.match(reference.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Object.hasOwn(reference, 'content'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('project inspection rejects non-XGWX files before hashing', async () => {
  await assert.rejects(() => inspectXgSimProjectFile('C:\\temp\\project.zip'), /\.xgwx/i);
});
