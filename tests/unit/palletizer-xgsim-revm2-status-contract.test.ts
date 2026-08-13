import { describe, expect, it, vi } from 'vitest';
import type { PlcRuntimeAdapter, PlcRuntimeConnectRequest, PlcRuntimeSnapshot } from '../../src/domain/plc-runtime';
import { createPalletizerXgSimBridge } from '../../src/renderer/plc-runtime/palletizer-xgsim-bridge';

const sha256 = 'e'.repeat(64);
const identity = { cpuModel: 'XGB-XBCU', projectSha256: sha256, base: 0, slot: 1 };
const commandAddresses = ['M00111', 'M00119', 'M00122', 'M00123', 'M00124', 'M00125', 'M00126'];
const revM2OutcomeAddresses = [
  ...Array.from({ length: 30 }, (_, index) => `M003${String(20 + index).padStart(2, '0')}`),
  ...Array.from({ length: 16 }, (_, index) => `M004${String(index).padStart(2, '0')}`),
];

function snapshot(monitors: Record<string, boolean> = {}): PlcRuntimeSnapshot {
  return { sequence: 1, capturedAt: '2026-08-13T00:00:00.000Z', inputs: {}, outputs: {}, monitors };
}

function createHarness() {
  const connect = vi.fn(async (_request: PlcRuntimeConnectRequest) => ({
    sessionId: 'revm2', connectedAt: '2026-08-13T00:00:00.000Z', projectSha256: sha256, projectIdentityVerified: true,
  }));
  const adapter: PlcRuntimeAdapter = {
    probe: async () => { throw new Error('not used'); },
    connect,
    readSnapshot: async () => snapshot(),
    writeInputImage: async () => ({ acceptedBindingIds: [], rejectedBindingIds: [] }),
    getStatus: async () => ({ state: 'connected', sessionId: 'revm2', projectSha256: sha256, projectIdentityVerified: true, lastSequence: 0, lastError: null }),
    disconnect: async () => undefined,
  };
  const writeDevice = vi.fn(() => ({ ok: true }));
  return {
    connect,
    writeDevice,
    adapter,
    runtime: {
      readDevice: () => false,
      setPhysicalInput: () => true,
      writeDevice,
      stopAll: () => undefined,
      setServo: () => undefined,
    },
  };
}

describe('Rev.M2 XG-SIM status outcome contract', () => {
  it('subscribes to every reviewed axis and PLC-to-HMI M outcome as a read-only monitor binding', async () => {
    const harness = createHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: harness.adapter, runtime: harness.runtime, expectedIdentity: identity });

    await bridge.connect(identity);

    const request = harness.connect.mock.calls[0][0] as PlcRuntimeConnectRequest;
    const outcomeBindings = request.bindings.filter((binding) => revM2OutcomeAddresses.includes(binding.address));
    expect(outcomeBindings.map((binding) => binding.address)).toEqual(revM2OutcomeAddresses);
    expect(outcomeBindings.every((binding) => binding.direction === 'monitor' && binding.access.read && !binding.access.write)).toBe(true);
  });

  it('does not replay a live PLC M001 command snapshot through the local 3D runtime command writer', async () => {
    const harness = createHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: harness.adapter, runtime: harness.runtime, expectedIdentity: identity });
    await bridge.connect(identity);

    await bridge.applySnapshot(snapshot({ M00123: true, M00125: true }));
    await bridge.applySnapshot(snapshot({ M00123: false, M00125: false }));
    await bridge.applySnapshot(snapshot({ M00123: true, M00125: true }));

    expect(commandAddresses).toEqual(expect.arrayContaining(['M00123', 'M00125']));
    expect(harness.writeDevice).not.toHaveBeenCalled();
  });
});
