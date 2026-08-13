import { describe, expect, it, vi } from 'vitest';
import type { PlcInputImage, PlcRuntimeAdapter, PlcRuntimeSnapshot } from '../../src/domain/plc-runtime';
import { createPalletizerXgSimBridge } from '../../src/renderer/plc-runtime/palletizer-xgsim-bridge';

const sha256 = 'd'.repeat(64);
const identity = { cpuModel: 'XGB-XBCU', projectSha256: sha256, base: 0, slot: 1 };
const physicalAddresses = Array.from({ length: 16 }, (_, index) => `P0000${index.toString(16).toUpperCase()}`);
const inputChannels = Array.from({ length: 16 }, (_, index) => `B0S0.IN${String(index).padStart(2, '0')}`);
const commandAddresses = ['M00111', 'M00119', 'M00122', 'M00123', 'M00124', 'M00125', 'M00126'];

function snapshot(outputs: Record<string, boolean> = {}, inputs: Record<string, boolean> = {}): PlcRuntimeSnapshot {
  return { sequence: 1, capturedAt: '2026-08-13T00:00:00.000Z', inputs, outputs, monitors: {} };
}

function createAdapterHarness() {
  const connects: unknown[] = [];
  const inputFrames: PlcInputImage[] = [];
  const adapter: PlcRuntimeAdapter = {
    async probe() { throw new Error('not used'); },
    async connect(request) {
      connects.push(request);
      return { sessionId: 'dataflow', connectedAt: '2026-08-13T00:00:00.000Z', projectSha256: sha256, projectIdentityVerified: true };
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
  const setPhysicalInput = vi.fn(() => true);
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
});
