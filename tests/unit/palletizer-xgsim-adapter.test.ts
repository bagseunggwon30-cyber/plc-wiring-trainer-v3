import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlcRuntimeConnectRequest } from '../../src/domain/plc-runtime';
import { XgSimRuntimeAdapter } from '../../src/renderer/plc-runtime/xgsim-adapter';

const sha256 = 'c'.repeat(64);
const nonce = '1'.repeat(32);
const inputBinding = {
  schemaVersion: 1 as const,
  id: 'B0S0.IN00',
  deviceInstanceId: 'palletizer-xgb',
  terminalId: 'XG-SIM',
  cpuModel: 'XGB-XBCU',
  projectId: 'palletizer-xgb-production',
  symbolName: 'B0S0.IN00',
  address: 'B0S0.IN00',
  direction: 'input' as const,
  dataType: 'BOOL' as const,
  inverted: false,
  normalState: false,
  communicationLossState: false,
  access: { read: true, write: true },
  projectSha256: sha256,
};
const monitorBinding = {
  ...inputBinding,
  id: 'M00320',
  symbolName: 'M00320',
  address: 'M00320',
  direction: 'monitor' as const,
  access: { read: true, write: false },
};
const request: PlcRuntimeConnectRequest = {
  sessionNonce: nonce,
  cpuModel: 'XGB-XBCU',
  projectId: 'palletizer-xgb-production',
  projectSha256: sha256,
  base: 0,
  slot: 1,
  bindings: [inputBinding, monitorBinding],
};

function installApi(overrides: Record<string, unknown> = {}) {
  const identity = {
    sessionId: 'native-session', sessionNonce: nonce, hostEpoch: 'epoch-1', projectSha256: sha256,
  };
  const api = {
    probe: vi.fn(),
    connect: vi.fn(async () => ({ connected: true, projectIdentityVerified: true, ...identity })),
    readSnapshot: vi.fn(async () => ({
      ...identity, sequence: 1, capturedAt: '2026-08-13T00:00:00.001Z',
      inputs: { 'B0S0.IN00': true }, outputs: {}, monitors: { M00320: true },
    })),
    writeInputImage: vi.fn(async () => ({
      ...identity, committed: true, acceptedAddresses: ['B0S0.IN00'], rejectedAddresses: [],
    })),
    getStatus: vi.fn(async () => ({ state: 'connected', ...identity })),
    disconnect: vi.fn(async () => ({})),
    ...overrides,
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { WorkshopDesktop: { xgSim: api } },
  });
  return { api, identity };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('XG-SIM adapter native-host evidence contract', () => {
  it('passes the nonce to the host and accepts only a fully echoed session/project identity', async () => {
    const { api } = installApi();
    const adapter = new XgSimRuntimeAdapter();

    const connection = await adapter.connect(request);

    expect(api.connect).toHaveBeenCalledWith(expect.objectContaining({ sessionNonce: nonce, projectSha256: sha256 }));
    expect(connection).toMatchObject({
      sessionId: 'native-session', sessionNonce: nonce, hostEpoch: 'epoch-1',
      projectSha256: sha256, projectIdentityVerified: true,
    });
  });

  it('keeps legacy host responses diagnostic-only and rejects authoritative reads and writes', async () => {
    installApi({ connect: vi.fn(async () => ({ connected: true, projectIdentityVerified: true })) });
    const adapter = new XgSimRuntimeAdapter();
    const connection = await adapter.connect(request);

    expect(connection.projectIdentityVerified).toBe(false);
    await expect(adapter.readSnapshot()).rejects.toMatchObject({ code: 'XGSIM_DIAGNOSTIC_ONLY' });
    await expect(adapter.writeInputImage({ values: { 'B0S0.IN00': true } }))
      .rejects.toMatchObject({ code: 'XGSIM_DIAGNOSTIC_ONLY' });
  });

  it('uses the host sequence and rejects a replayed frame from the same native session', async () => {
    const { api, identity } = installApi();
    api.readSnapshot = vi.fn(async () => ({
      ...identity, sequence: 9, capturedAt: '2026-08-13T00:00:00.009Z',
      inputs: { 'B0S0.IN00': true }, outputs: {}, monitors: { M00320: true },
    }));
    const adapter = new XgSimRuntimeAdapter();
    await adapter.connect(request);

    await expect(adapter.readSnapshot()).resolves.toMatchObject({
      sequence: 9, sessionId: 'native-session', hostEpoch: 'epoch-1', monitors: { M00320: true },
    });
    await expect(adapter.readSnapshot()).rejects.toMatchObject({ code: 'XGSIM_STALE_HOST_FRAME' });
  });

  it('requires a committed session-bound write acknowledgement and maps real host address results to binding IDs', async () => {
    const { api, identity } = installApi();
    const adapter = new XgSimRuntimeAdapter();
    await adapter.connect(request);

    await expect(adapter.writeInputImage({ values: { 'B0S0.IN00': true } })).resolves.toEqual({
      acceptedBindingIds: ['B0S0.IN00'], rejectedBindingIds: [],
    });
    api.writeInputImage.mockResolvedValueOnce({
      ...identity, committed: false, acceptedAddresses: ['B0S0.IN00'], rejectedAddresses: [],
    });
    await expect(adapter.writeInputImage({ values: { 'B0S0.IN00': false } }))
      .rejects.toMatchObject({ code: 'XGSIM_INPUT_ACK_UNVERIFIED' });
  });

  it('rejects a frame from another session even when its sequence is newer', async () => {
    const { api, identity } = installApi();
    api.readSnapshot = vi.fn(async () => ({
      ...identity, sessionId: 'other-session', sequence: 20, capturedAt: '2026-08-13T00:00:00.020Z',
      inputs: { 'B0S0.IN00': false }, outputs: {}, monitors: { M00320: false },
    }));
    const adapter = new XgSimRuntimeAdapter();
    await adapter.connect(request);

    await expect(adapter.readSnapshot()).rejects.toMatchObject({ code: 'XGSIM_UNBOUND_HOST_FRAME' });
  });
});
