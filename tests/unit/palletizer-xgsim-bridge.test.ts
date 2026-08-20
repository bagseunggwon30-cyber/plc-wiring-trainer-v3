import { describe, expect, it } from 'vitest';
import type { PlcRuntimeAdapter, PlcRuntimeConnectRequest, PlcRuntimeSnapshot } from '../../src/domain/plc-runtime';
import {
  PALLETIZER_XGSIM_INPUT_MAP,
  createPalletizerXgSimBridge,
} from '../../src/renderer/plc-runtime/palletizer-xgsim-bridge';

const sha256 = 'a'.repeat(64);
let snapshotSequence = 0;
let sessionNonce = '';
const hostEpoch = 'host-epoch-1';
const allMonitors = [
  'M00111', 'M00119', 'M00122', 'M00123', 'M00124', 'M00125', 'M00126',
  ...Array.from({ length: 30 }, (_, index) => `M003${String(20 + index).padStart(2, '0')}`),
  ...Array.from({ length: 16 }, (_, index) => `M004${String(index).padStart(2, '0')}`),
];

function snapshot(inputs: Record<string, boolean>, devices: Record<string, boolean> = {}): PlcRuntimeSnapshot {
  snapshotSequence += 1;
  return {
    sequence: snapshotSequence,
    capturedAt: new Date(Date.parse('2026-08-13T00:00:00.000Z') + snapshotSequence).toISOString(),
    sessionId: 'bridge', sessionNonce, hostEpoch, projectSha256: sha256,
    inputs, outputs: {},
    monitors: { ...Object.fromEntries(allMonitors.map((address) => [address, false])), ...devices },
  };
}

function adapter(): PlcRuntimeAdapter {
  snapshotSequence = 0;
  sessionNonce = '';
  return {
    async probe() { throw new Error('not used'); },
    async connect(request) {
      sessionNonce = request.sessionNonce;
      return {
        sessionId: 'bridge', sessionNonce, hostEpoch, connectedAt: '2026-08-13T00:00:00.000Z',
        projectSha256: sha256, projectIdentityVerified: true,
      };
    },
    async readSnapshot() { return snapshot({}); },
    async writeInputImage(image) { return { acceptedBindingIds: Object.keys(image.values), rejectedBindingIds: [] }; },
    async getStatus() { return { state: 'connected', sessionId: 'bridge', projectSha256: sha256, projectIdentityVerified: true, lastSequence: 0, lastError: null }; },
    async disconnect() {},
  };
}

function runtime() {
  const calls: string[] = [];
  return {
    calls,
    readDevice: (address: string) => address.endsWith('0') || address.endsWith('2') || address.endsWith('4') || address.endsWith('6') || address.endsWith('8') || address.endsWith('A') || address.endsWith('C') || address.endsWith('E'),
    setPhysicalInput: (address: string, value: boolean) => { calls.push(`input:${address}=${value}`); return true; },
    writeDevice: (address: string, value: boolean) => { calls.push(`command:${address}=${value}`); return { ok: true }; },
    stopAll: () => { calls.push('stop-all'); },
    setServo: (_axis: null, value: boolean) => { calls.push(`servo=${value}`); },
  };
}

const identity = { cpuModel: 'XGB-XBC-DN32UP', projectSha256: sha256, base: 0, slot: 0 };

describe('3-axis palletizer XG-SIM bridge contract', () => {
  it('has an explicit one-to-one P00000..P0000F to B0S0.IN00..IN15 image mapping', () => {
    expect(PALLETIZER_XGSIM_INPUT_MAP).toEqual(Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
      `P0000${index.toString(16).toUpperCase()}`,
      `B0S0.IN${String(index).padStart(2, '0')}`,
    ])));
  });

  it('uses the exact validated DI channel names from the base/slot 0/0 probe and exposes an unverified Host v1 project identity', async () => {
    const canonicalChannels = Array.from({ length: 16 }, (_, index) => `B0S00.IN${String(index).padStart(2, '0')}`);
    const observed: { request?: PlcRuntimeConnectRequest } = {};
    const host: PlcRuntimeAdapter = {
      ...adapter(),
      async connect(value: PlcRuntimeConnectRequest) {
        observed.request = value;
        return { sessionId: 'bridge', connectedAt: '2026-08-13T00:00:00.000Z', projectSha256: sha256, projectIdentityVerified: false };
      },
    };
    const bridge = createPalletizerXgSimBridge({
      adapter: host, runtime: runtime(), expectedIdentity: identity, inputChannels: canonicalChannels,
    });

    await bridge.connect(identity);

    const request = observed.request;
    if (!request) throw new Error('Expected bridge adapter connection request.');
    expect(request.bindings
      .filter((binding) => binding.direction === 'input')
      .map((binding) => binding.address)).toEqual(canonicalChannels);
    expect(bridge.status).toMatchObject({
      state: 'diagnostic', identityVerified: false, reason: 'project-identity-unverified-diagnostic-only',
    });
  });

  it('rejects reordered or mixed-base DI channel banks before constructing a usable host binding set', () => {
    const mixedChannels = Array.from({ length: 16 }, (_, index) => (
      `${index === 7 ? 'B9S09' : 'B0S00'}.IN${String(index).padStart(2, '0')}`
    ));
    expect(() => createPalletizerXgSimBridge({
      adapter: adapter(), runtime: runtime(), expectedIdentity: identity, inputChannels: mixedChannels,
    })).toThrow(expect.objectContaining({ code: 'XGSIM_INVALID_DI_CHANNELS' }));

    const reordered = Array.from({ length: 16 }, (_, index) => `B0S00.IN${String(15 - index).padStart(2, '0')}`);
    expect(() => createPalletizerXgSimBridge({
      adapter: adapter(), runtime: runtime(), expectedIdentity: identity, inputChannels: reordered,
    })).toThrow(expect.objectContaining({ code: 'XGSIM_INVALID_DI_CHANNELS' }));
  });

  it('blocks a connect identity mismatch before any simulator session is usable', async () => {
    const bridge = createPalletizerXgSimBridge({ adapter: adapter(), runtime: runtime(), expectedIdentity: identity });

    await expect(bridge.connect({ ...identity, base: 1 })).rejects.toMatchObject({ code: 'XGSIM_IDENTITY_MISMATCH' });
    expect(bridge.status).toMatchObject({ state: 'blocked', reason: 'base-mismatch' });
  });

  it('keeps a nominally verified connection diagnostic-only when the host does not echo this session nonce', async () => {
    const host = adapter();
    host.connect = async () => ({
      sessionId: 'bridge', sessionNonce: 'f'.repeat(32), hostEpoch,
      connectedAt: '2026-08-13T00:00:00.000Z', projectSha256: sha256, projectIdentityVerified: true,
    });
    const cell = runtime();
    const bridge = createPalletizerXgSimBridge({ adapter: host, runtime: cell, expectedIdentity: identity });

    await bridge.connect(identity);

    expect(bridge.status).toMatchObject({ state: 'diagnostic', identityVerified: false });
    await expect(bridge.synchronizeInputImage()).rejects.toMatchObject({ code: 'XGSIM_NOT_CONNECTED' });
  });

  it('writes local virtual DIs, observes PLC-owned M outcomes without replaying commands, and explicitly blocks host-v1 D/D004xx/D005xx reads', async () => {
    const cell = runtime();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter(), runtime: cell, expectedIdentity: identity });
    await bridge.connect(identity);

    const commands = { M00111: true, M00119: true, M00122: true, M00123: true, M00124: true, M00125: true, M00126: true, M00320: true, M00408: true };
    await bridge.synchronizeInputImage();
    const first = await bridge.applySnapshot(snapshot({}, {}));
    await bridge.applySnapshot(snapshot({}, commands));
    await bridge.applySnapshot(snapshot({}, commands));

    expect(cell.calls.filter((call) => call.startsWith('input:'))).toHaveLength(0);
    expect(cell.calls.filter((call) => call.startsWith('command:'))).toEqual([]);
    expect(first.blocked).toEqual(expect.arrayContaining(['D00000', 'D004xx', 'D005xx']));
  });

  it('fails safe on disconnect or snapshot error: local STOP/servo-off, all sixteen DIs false, and no PLC-command replay after reconnect', async () => {
    const cell = runtime();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter(), runtime: cell, expectedIdentity: identity });
    await bridge.connect(identity);
    await bridge.applySnapshot(snapshot({}, { M00123: true }));
    await bridge.disconnect();

    expect(cell.calls).toContain('stop-all');
    expect(cell.calls).toContain('servo=false');
    expect(cell.calls.filter((call) => call === 'input:P00000=false').length).toBeGreaterThanOrEqual(1);
    expect(cell.calls.filter((call) => call === 'input:P0000F=false').length).toBeGreaterThanOrEqual(1);

    await bridge.connect(identity);
    await bridge.applySnapshot(snapshot({}, { M00123: true }));
    expect(cell.calls.filter((call) => call === 'command:M00123=true')).toHaveLength(0);

    await bridge.handleError(new Error('host read failed'));
    expect(bridge.status).toMatchObject({ state: 'faulted' });
    expect(cell.calls.filter((call) => call === 'stop-all')).toHaveLength(2);
    expect(cell.calls.filter((call) => call === 'servo=false')).toHaveLength(2);
  });
});
