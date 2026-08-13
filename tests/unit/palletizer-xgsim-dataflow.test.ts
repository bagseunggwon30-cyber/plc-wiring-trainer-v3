import { describe, expect, it, vi } from 'vitest';
import type { PlcInputImage, PlcRuntimeAdapter, PlcRuntimeSnapshot } from '../../src/domain/plc-runtime';
import { createPalletizerXgSimBridge } from '../../src/renderer/plc-runtime/palletizer-xgsim-bridge';

const sha256 = 'd'.repeat(64);
const identity = { cpuModel: 'XGB-XBCU', projectSha256: sha256, base: 0, slot: 1 };
const physicalAddresses = Array.from({ length: 16 }, (_, index) => `P0000${index.toString(16).toUpperCase()}`);
const inputChannels = Array.from({ length: 16 }, (_, index) => `B0S0.IN${String(index).padStart(2, '0')}`);
const commandAddresses = ['M00111', 'M00119', 'M00122', 'M00123', 'M00124', 'M00125', 'M00126'];
const outcomeAddresses = [
  ...Array.from({ length: 30 }, (_, index) => `M003${String(20 + index).padStart(2, '0')}`),
  ...Array.from({ length: 16 }, (_, index) => `M004${String(index).padStart(2, '0')}`),
];
let activeNonce = '';
let frameSequence = 0;

function snapshot(outputs: Record<string, boolean> = {}, inputs: Record<string, boolean> = {}): PlcRuntimeSnapshot {
  frameSequence += 1;
  return {
    sequence: frameSequence,
    capturedAt: new Date(Date.parse('2026-08-13T00:00:00.000Z') + frameSequence).toISOString(),
    sessionId: 'dataflow', sessionNonce: activeNonce, hostEpoch: 'dataflow-epoch', projectSha256: sha256,
    inputs, outputs: {},
    monitors: {
      ...Object.fromEntries([...commandAddresses, ...outcomeAddresses].map((address) => [address, false])),
      ...outputs,
    },
  };
}

function createAdapterHarness() {
  frameSequence = 0;
  activeNonce = '';
  const connects: unknown[] = [];
  const inputFrames: PlcInputImage[] = [];
  const adapter: PlcRuntimeAdapter = {
    async probe() { throw new Error('not used'); },
    async connect(request) {
      connects.push(request);
      activeNonce = request.sessionNonce;
      return {
        sessionId: 'dataflow', sessionNonce: activeNonce, hostEpoch: 'dataflow-epoch',
        connectedAt: '2026-08-13T00:00:00.000Z', projectSha256: sha256, projectIdentityVerified: true,
      };
    },
    async readSnapshot() { return snapshot(); },
    async writeInputImage(image) {
      inputFrames.push(image);
      return { acceptedBindingIds: Object.keys(image.values).sort(), rejectedBindingIds: [] };
    },
    async getStatus() { return { state: 'connected', sessionId: 'dataflow', projectSha256: sha256, projectIdentityVerified: true, lastSequence: 0, lastError: null }; },
    async disconnect() {},
  };
  return { adapter, connects, inputFrames };
}

function createRuntimeHarness() {
  const localImage = new Map(physicalAddresses.map((address, index) => [address, index % 2 === 0]));
  const readDevice = vi.fn((address: string) => localImage.get(address) === true);
  const setPhysicalInput = vi.fn((_address: string, _value: boolean) => true);
  const writeDevice = vi.fn(() => ({ ok: true }));
  const stopAll = vi.fn();
  const setServo = vi.fn();
  const setObservedStatus = vi.fn();
  const clearObservedStatus = vi.fn();
  const setPlcAuthoritative = vi.fn();
  return {
    port: { readDevice, setPhysicalInput, writeDevice, stopAll, setServo, setObservedStatus, clearObservedStatus, setPlcAuthoritative },
    localImage,
    readDevice,
    setPhysicalInput,
    writeDevice,
    setObservedStatus,
    clearObservedStatus,
    setPlcAuthoritative,
  };
}

describe('3-axis palletizer XG-SIM dataflow contract', () => {
  it('connects XG-SIM with sixteen writable input-image bindings and all seven ladder command M bits as read-only bindings', async () => {
    const adapter = createAdapterHarness();
    const runtime = createRuntimeHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });

    await bridge.connect(identity);

    const request = adapter.connects[0] as { bindings: Array<{ id: string; address: string; direction: string; access: { read: boolean; write: boolean } }> };
    const inputs = request.bindings.filter((binding) => binding.direction === 'input');
    const commands = request.bindings.filter((binding) => binding.address.startsWith('M001'));

    expect(inputs.map((binding) => binding.address)).toEqual(inputChannels);
    expect(inputs.every((binding) => binding.access.read && binding.access.write)).toBe(true);
    expect(commands.map((binding) => binding.address)).toEqual(commandAddresses);
    expect(commands.every((binding) => binding.direction === 'monitor' && binding.access.read && !binding.access.write)).toBe(true);
  });

  it('writes the local P00000..P0000F image to XG-SIM before observing post-scan M outcomes, without putting M bits in an input frame, replaying commands, or overwriting local sensors', async () => {
    const adapter = createAdapterHarness();
    const runtime = createRuntimeHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });
    await bridge.connect(identity);

    await bridge.synchronizeInputImage();
    await bridge.applySnapshot(snapshot({ M00123: true, M00320: true, M00408: true }, Object.fromEntries(inputChannels.map((address) => [address, false]))));

    expect(runtime.readDevice).toHaveBeenCalledTimes(16);
    expect(runtime.readDevice.mock.calls.map(([address]) => address)).toEqual(physicalAddresses);
    expect(adapter.inputFrames).toContainEqual({ values: Object.fromEntries(inputChannels.map((channel, index) => [channel, index % 2 === 0])) });
    expect(adapter.inputFrames.flatMap((frame) => Object.keys(frame.values))).toEqual(expect.not.arrayContaining(commandAddresses));
    expect(runtime.setPhysicalInput).not.toHaveBeenCalled();
    expect(runtime.writeDevice).not.toHaveBeenCalled();
    expect(runtime.setObservedStatus).toHaveBeenCalledWith(expect.objectContaining({ M00320: true, M00408: true }));
  });

  it('sends an explicit all-false neutral input frame before disconnecting or faulting the XG-SIM session', async () => {
    const adapter = createAdapterHarness();
    const runtime = createRuntimeHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });
    await bridge.connect(identity);

    await bridge.disconnect();
    await bridge.connect(identity);
    await bridge.handleError(new Error('post-scan read failed'));

    const neutral = { values: Object.fromEntries(inputChannels.map((channel) => [channel, false])) };
    expect(adapter.inputFrames.filter((frame) => JSON.stringify(frame) === JSON.stringify(neutral))).toHaveLength(2);
  });

  it('rejects duplicate, regressing, and pre-connection snapshots before they can update observed PLC status', async () => {
    const adapter = createAdapterHarness();
    const runtime = createRuntimeHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });
    await bridge.connect(identity);

    await bridge.applySnapshot({
      ...snapshot({ M00320: true }), sequence: 101, capturedAt: '2026-08-13T00:00:00.101Z',
    });
    await expect(bridge.applySnapshot({
      ...snapshot({ M00320: false }), sequence: 101, capturedAt: '2026-08-13T00:00:00.102Z',
    })).rejects.toMatchObject({ code: 'XGSIM_STALE_SNAPSHOT' });
    await expect(bridge.applySnapshot({
      ...snapshot({ M00320: false }), sequence: 102, capturedAt: '2026-08-12T23:59:59.999Z',
    })).rejects.toMatchObject({ code: 'XGSIM_STALE_SNAPSHOT' });

    expect(runtime.setObservedStatus).toHaveBeenCalledOnce();
    expect(runtime.setObservedStatus).toHaveBeenLastCalledWith(expect.objectContaining({ M00320: true }));
  });

  it('fails closed when XG-SIM rejects or silently omits any channel from the sixteen-bit input image', async () => {
    const adapter = createAdapterHarness();
    adapter.adapter.writeInputImage = vi.fn(async (image) => ({
      acceptedBindingIds: Object.keys(image.values).slice(0, -1),
      rejectedBindingIds: [Object.keys(image.values).at(-1)!],
    }));
    const runtime = createRuntimeHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });
    await bridge.connect(identity);

    await expect(bridge.synchronizeInputImage()).rejects.toMatchObject({ code: 'XGSIM_INPUT_IMAGE_REJECTED' });
    expect(runtime.setObservedStatus).not.toHaveBeenCalled();
  });

  it('rejects an incomplete PLC BOOL image without clearing omitted outcomes to false', async () => {
    const adapter = createAdapterHarness();
    const runtime = createRuntimeHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });
    await bridge.connect(identity);
    const incomplete = snapshot({ M00320: true });
    delete (incomplete.monitors as Record<string, boolean>).M00415;

    await expect(bridge.applySnapshot(incomplete)).rejects.toMatchObject({ code: 'XGSIM_INCOMPLETE_BOOL_SNAPSHOT' });
    expect(runtime.setObservedStatus).not.toHaveBeenCalled();
  });

  it('awaits asynchronous local fail-safe operations before reporting disconnect complete', async () => {
    const adapter = createAdapterHarness();
    const runtime = createRuntimeHarness();
    const order: string[] = [];
    const port = {
      ...runtime.port,
      stopAll: vi.fn(async () => { await Promise.resolve(); order.push('stop'); }),
      setServo: vi.fn(async () => { await Promise.resolve(); order.push('servo'); }),
    };
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: port, expectedIdentity: identity });
    await bridge.connect(identity);

    await bridge.disconnect();

    expect(order).toEqual(['stop', 'servo']);
    expect(bridge.status.state).toBe('disconnected');
  });

  it('attempts every local and host fail-safe action even when individual shutdown actions fail', async () => {
    const adapter = createAdapterHarness();
    const disconnect = vi.fn(async () => { throw new Error('host disconnect failed'); });
    adapter.adapter.disconnect = disconnect;
    const runtime = createRuntimeHarness();
    const stopAll = vi.fn(() => { throw new Error('local stop failed'); });
    const setServo = vi.fn();
    const setPhysicalInput = vi.fn((address: string) => address !== 'P00002');
    runtime.port.stopAll = stopAll;
    runtime.port.setServo = setServo;
    runtime.port.setPhysicalInput = setPhysicalInput;
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });
    await bridge.connect(identity);

    await expect(bridge.disconnect()).rejects.toMatchObject({ code: 'XGSIM_SAFE_STOP_FAILED' });

    expect(stopAll).toHaveBeenCalledOnce();
    expect(setServo).toHaveBeenCalledWith(null, false);
    expect(setPhysicalInput).toHaveBeenCalledTimes(16);
    expect(runtime.clearObservedStatus).toHaveBeenCalledOnce();
    expect(runtime.setPlcAuthoritative).toHaveBeenLastCalledWith(false);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(bridge.status).toMatchObject({ state: 'faulted', identityVerified: false });
  });

  it('tears down a host session that claims a verified hash different from the selected project', async () => {
    const adapter = createAdapterHarness();
    const disconnect = vi.fn(async () => undefined);
    adapter.adapter.disconnect = disconnect;
    adapter.adapter.connect = vi.fn(async () => ({
      sessionId: 'wrong-project', connectedAt: '2026-08-13T00:00:00.000Z',
      projectSha256: 'f'.repeat(64), projectIdentityVerified: true,
    }));
    const runtime = createRuntimeHarness();
    const bridge = createPalletizerXgSimBridge({ adapter: adapter.adapter, runtime: runtime.port, expectedIdentity: identity });

    await expect(bridge.connect(identity)).rejects.toMatchObject({ code: 'XGSIM_VERIFIED_PROJECT_MISMATCH' });

    expect(runtime.setPlcAuthoritative).not.toHaveBeenCalledWith(true);
    expect(runtime.setPlcAuthoritative).toHaveBeenCalledWith(false);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(bridge.status).toMatchObject({ state: 'faulted', identityVerified: false });
  });
});
