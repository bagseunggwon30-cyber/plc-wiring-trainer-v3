'use strict';

const crypto = require('crypto');
const { createReadStream } = require('fs');
const { stat } = require('fs/promises');
const path = require('path');

const MAX_XGWX_BYTES = 200_000_000;

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function inspectXgSimProjectFile(rawPath) {
  if (typeof rawPath !== 'string' || path.extname(rawPath).toLowerCase() !== '.xgwx') {
    throw new Error('Only an .xgwx XG5000 project may be selected.');
  }
  const absolutePath = path.resolve(rawPath);
  const info = await stat(absolutePath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_XGWX_BYTES) {
    throw new Error('Selected .xgwx project must be a regular file between 1 byte and 200 MB.');
  }
  return Object.freeze({
    schemaVersion: 1,
    absolutePath,
    fileName: path.basename(absolutePath),
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    sha256: await sha256File(absolutePath),
  });
}

module.exports = { inspectXgSimProjectFile, MAX_XGWX_BYTES };
