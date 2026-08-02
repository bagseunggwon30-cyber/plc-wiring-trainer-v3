'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_BINDINGS = 256;
const INPUT_CHANNEL = /^B\d+S\d+\.IN\d+$/i;
const OUTPUT_CHANNEL = /^B\d+S\d+\.OUT\d+$/i;

class XgSimHostError extends Error {
  constructor(code, message, blocked = false) {
    super(message);
    this.name = 'XgSimHostError';
    this.code = code;
    this.blocked = blocked;
  }
}

class XgSimSessionService {
  constructor({ hostPath, timeoutMs = 2_000 }) {
    this.hostPath = hostPath;
    this.timeoutMs = timeoutMs;
    this.nonce = crypto.randomBytes(32).toString('hex');
    this.process = null;
    this.pending = new Map();
    this.startPromise = null;
    this.stderrTail = '';
  }

  async probe(payload) {
    validateBaseSlot(payload);
    return this.request('probe', payload);
  }

  async connect(payload) {
    validateConnectPayload(payload);
    return this.request('connect', payload);
  }

  async readSnapshot() {
    return this.request('readSnapshot', {});
  }

  async writeInputImage(payload) {
    validateInputFrame(payload);
    return this.request('writeInputImage', payload);
  }

  async getStatus() {
    if (!this.process) return { state: 'disconnected', executionState: 'unknown' };
    return this.request('getStatus', {});
  }

  async disconnect() {
    if (!this.process) return { state: 'disconnected', executionState: 'unknown' };
    return this.request('disconnect', {});
  }

  async close() {
    const child = this.process;
    if (!child) return;
    try {
      await this.request('shutdown', {});
    } catch {
      // The host also clears all virtual inputs in its EOF/final cleanup path.
    } finally {
      if (this.process === child) child.kill();
      this._handleExit(new XgSimHostError('HOST_CLOSED', 'XG-SIM host closed.', true));
    }
  }

  async request(command, payload) {
    await this._ensureStarted();
    return this._send(command, payload);
  }

  async _ensureStarted() {
    if (this.process) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      const child = spawn(this.hostPath, [], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.process = child;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => this._handleLine(line));
      child.stderr.on('data', (chunk) => {
        this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_096).replace(/[\r\n]+/g, ' ');
      });
      child.once('error', (error) => this._handleExit(new XgSimHostError('HOST_START_FAILED', error.message, true)));
      child.once('exit', (code, signal) => this._handleExit(new XgSimHostError(
        'HOST_EXITED',
        `XG-SIM host exited (${code ?? 'null'}/${signal ?? 'none'}). ${this.stderrTail}`.trim(),
        true,
      )));
      await this._send('hello', {});
    })().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  _send(command, payload) {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new XgSimHostError('HOST_NOT_RUNNING', 'XG-SIM host is not running.', true));
    }
    const requestId = crypto.randomUUID();
    const message = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId, nonce: this.nonce, command, payload });
    if (Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES) {
      return Promise.reject(new XgSimHostError('REQUEST_TOO_LARGE', 'XG-SIM host request is too large.', true));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new XgSimHostError('HOST_TIMEOUT', `XG-SIM host timed out while handling ${command}; the host was terminated for fail-safe cleanup.`, true);
        if (this.process) this.process.kill();
        this._handleExit(error);
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process.stdin.write(`${message}\n`, 'utf8', (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new XgSimHostError('HOST_WRITE_FAILED', error.message, true));
      });
    });
  }

  _handleLine(line) {
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
      this._handleExit(new XgSimHostError('RESPONSE_TOO_LARGE', 'XG-SIM host response is too large.', true));
      return;
    }
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      this._handleExit(new XgSimHostError('INVALID_HOST_RESPONSE', 'XG-SIM host returned invalid JSON.', true));
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    if (response.protocolVersion !== PROTOCOL_VERSION || response.nonce !== this.nonce) {
      pending.reject(new XgSimHostError('HOST_IDENTITY_MISMATCH', 'XG-SIM host protocol or nonce mismatch.', true));
      return;
    }
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new XgSimHostError(response.error?.code || 'HOST_ERROR', response.error?.message || 'XG-SIM host failed.', Boolean(response.error?.blocked)));
  }

  _handleExit(error) {
    const child = this.process;
    if (child) {
      this.process = null;
      child.removeAllListeners();
      if (child.exitCode === null && !child.killed) child.kill();
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function validateBaseSlot(payload) {
  if (!payload || !Number.isInteger(payload.base) || payload.base < 0 || payload.base > 255
    || !Number.isInteger(payload.slot) || payload.slot < 0 || payload.slot > 255) {
    throw new XgSimHostError('INVALID_REQUEST', 'Base and slot must be integers from 0 to 255.', true);
  }
}

function validateConnectPayload(payload) {
  validateBaseSlot(payload);
  if (!/^[a-f0-9]{64}$/i.test(payload.projectSha256 || '')
    || typeof payload.cpuModel !== 'string' || !payload.cpuModel
    || typeof payload.projectId !== 'string' || !payload.projectId) {
    throw new XgSimHostError('INVALID_REQUEST', 'Project identity is incomplete.', true);
  }
  validateAddressList(payload.allowedInputs, INPUT_CHANNEL, 'input');
  validateAddressList(payload.allowedOutputs, OUTPUT_CHANNEL, 'output');
}

function validateAddressList(values, pattern, name) {
  if (!Array.isArray(values) || values.length > MAX_BINDINGS || values.some((value) => typeof value !== 'string' || !pattern.test(value))) {
    throw new XgSimHostError('INVALID_ALLOWLIST', `Invalid ${name} channel allowlist.`, true);
  }
  if (new Set(values.map((value) => value.toUpperCase())).size !== values.length) {
    throw new XgSimHostError('DUPLICATE_ADDRESS', `Duplicate ${name} channel address.`, true);
  }
}

function validateInputFrame(payload) {
  const values = payload?.values;
  if (!values || Array.isArray(values) || typeof values !== 'object' || Object.keys(values).length > MAX_BINDINGS) {
    throw new XgSimHostError('INVALID_INPUT_FRAME', 'Input frame is missing or too large.', true);
  }
  for (const [address, value] of Object.entries(values)) {
    if (!INPUT_CHANNEL.test(address) || typeof value !== 'boolean') {
      throw new XgSimHostError('INVALID_INPUT_FRAME', 'Only BOOL input-channel writes are allowed.', true);
    }
  }
}

module.exports = { XgSimSessionService, XgSimHostError, PROTOCOL_VERSION };
