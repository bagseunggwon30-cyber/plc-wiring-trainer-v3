import { describe, expect, it, vi } from 'vitest';
import {
  createPalletizerXgSimUiIntegration,
  type PalletizerClassicRuntimePort,
} from '../../src/renderer/plc-runtime/palletizer-xgsim-ui-integration';

const sha256 = 'b'.repeat(64);
const canonicalDiChannels = Array.from({ length: 16 }, (_, index) => `B0S00.IN${String(index).padStart(2, '0')}`);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function availableProbe(channelNames: readonly string[]) {
  return {
    status: 'available' as const,
    capabilities: {
      provider: 'xgsim' as const, protocolVersion: 1, supportsInputChannels: true,
      supportsOutputChannels: true, supportsDeviceRead: true,
      supportsOutputWrite: false as const, supportsProjectIdentityVerification: false, maximumBindings: 256,
    },
    channelNames,
  };
}

function classic(): PalletizerClassicRuntimePort {
  return {
    getProfile: () => ({ id: 'xgb-production' }),
    getRuntimePort: () => ({
      readDevice: () => false,
      setPhysicalInput: () => true,
      writeDevice: () => ({ ok: true }),
      stopAll: () => undefined,
      setServo: () => undefined,
    }),
    renderActive: vi.fn(),
  };
}

describe('palletizer classic-script to Vite XG-SIM integration contract', () => {
  it('publishes the bridge-proven identity state and preserves input-before-snapshot ordering', async () => {
    const selectProject = vi.fn(async () => ({
      selected: true,
      reference: { sha256, cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
    }));
    const order: string[] = [];
    const connect = vi.fn(async () => undefined);
    const synchronizeInputImage = vi.fn(async () => { order.push('input-image'); });
    const applySnapshot = vi.fn(async () => { order.push('apply-snapshot'); return { blocked: ['D00000', 'D004xx', 'D005xx'] }; });
    const disconnect = vi.fn(async () => undefined);
    const bridgeFactory = vi.fn(() => ({
      connect, synchronizeInputImage, applySnapshot, disconnect, handleError: vi.fn(),
      status: { state: 'connected' as const, blocked: [] as readonly string[], identityVerified: true },
    }));
    const readSnapshot = vi.fn(async () => {
      order.push('post-scan-snapshot');
      return {
        sequence: 1, capturedAt: '2026-08-13T00:00:00.000Z', inputs: {},
        outputs: { 'auto-start-command': true }, monitors: {},
      };
    });
    const probe = vi.fn()
      .mockResolvedValueOnce(availableProbe(canonicalDiChannels))
      .mockResolvedValueOnce(availableProbe(['B0S01.POS00']));
    const setStatus = vi.fn();
    const integration = createPalletizerXgSimUiIntegration({
      classic: classic(), selectProject, bridgeFactory, readSnapshot, probe, setStatus,
      runtimeTarget: { cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
    });

    await expect(integration.connect({ localSimulationConsented: false })).rejects.toMatchObject({ code: 'LOCAL_SIMULATION_CONSENT_REQUIRED' });
    await integration.connect({ localSimulationConsented: true });
    await integration.pollOnce();

    expect(selectProject).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenNthCalledWith(1, { base: 0, slot: 0 });
    expect(probe).toHaveBeenNthCalledWith(2, { base: 0, slot: 1 });
    expect(connect).toHaveBeenCalledWith({ cpuModel: 'XGB-XBC-DN32UP', projectSha256: sha256, base: 0, slot: 0 });
    expect(synchronizeInputImage).toHaveBeenCalledOnce();
    expect(readSnapshot).toHaveBeenCalledOnce();
    expect(applySnapshot).toHaveBeenCalledOnce();
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      monitors: expect.objectContaining({ M00123: true }),
    }));
    expect(order).toEqual(['input-image', 'post-scan-snapshot', 'apply-snapshot']);
    expect(setStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'connected',
      blocked: ['D00000', 'D004xx', 'D005xx'],
      identityVerified: true,
    }));
  });

  it('does not connect outside the production profile and stops polling before bridge safe-disconnect', async () => {
    const bridge = {
      connect: vi.fn(), synchronizeInputImage: vi.fn(), applySnapshot: vi.fn(), disconnect: vi.fn(async () => undefined), handleError: vi.fn(),
      status: { state: 'connected' as const, blocked: [] as readonly string[] },
    };
    const integration = createPalletizerXgSimUiIntegration({
      classic: { ...classic(), getProfile: () => ({ id: 'ls' }) },
      selectProject: vi.fn(), bridgeFactory: vi.fn(() => bridge), readSnapshot: vi.fn(), probe: vi.fn(), setStatus: vi.fn(),
      runtimeTarget: { cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
    });

    await expect(integration.connect({ localSimulationConsented: true })).rejects.toMatchObject({ code: 'PRODUCTION_PROFILE_REQUIRED' });
    await integration.disconnect();
    expect(bridge.disconnect).not.toHaveBeenCalled();
  });

  it('cancels an in-flight preflight when the profile changes and never creates a late bridge session', async () => {
    let profileId = 'xgb-production';
    const selection = deferred<{ selected: true; reference: { sha256: string } }>();
    const selectProject = vi.fn(() => selection.promise);
    const bridgeFactory = vi.fn();
    const setStatus = vi.fn();
    const integration = createPalletizerXgSimUiIntegration({
      classic: { ...classic(), getProfile: () => ({ id: profileId }) },
      selectProject,
      bridgeFactory,
      readSnapshot: vi.fn(),
      probe: vi.fn(),
      setStatus,
      runtimeTarget: { cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
    });

    const connecting = integration.connect({ localSimulationConsented: true });
    await vi.waitFor(() => expect(selectProject).toHaveBeenCalledOnce());
    profileId = 'ls';
    const stopping = integration.onProfileChanged();
    selection.resolve({ selected: true, reference: { sha256 } });

    await expect(connecting).rejects.toMatchObject({ code: 'XGSIM_CONNECTION_CANCELLED' });
    await stopping;
    expect(bridgeFactory).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'disconnected' }));
  });

  it('disconnects exactly once when the view is hidden while the host connection is still opening', async () => {
    const connectGate = deferred<void>();
    const connect = vi.fn(() => connectGate.promise);
    const disconnect = vi.fn(async () => undefined);
    const candidate = {
      connect,
      synchronizeInputImage: vi.fn(),
      applySnapshot: vi.fn(),
      disconnect,
      handleError: vi.fn(),
      status: { state: 'disconnected' as const, blocked: [] as readonly string[] },
    };
    const probe = vi.fn()
      .mockResolvedValueOnce(availableProbe(canonicalDiChannels))
      .mockResolvedValueOnce(availableProbe(['B0S01.POS00']));
    const integration = createPalletizerXgSimUiIntegration({
      classic: classic(),
      selectProject: vi.fn(async () => ({ selected: true, reference: { sha256 } })),
      bridgeFactory: vi.fn(() => candidate),
      readSnapshot: vi.fn(), probe, setStatus: vi.fn(),
      runtimeTarget: { cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
    });

    const connecting = integration.connect({ localSimulationConsented: true });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    const hiding = integration.onViewHidden();
    connectGate.resolve();

    await expect(connecting).rejects.toMatchObject({ code: 'XGSIM_CONNECTION_CANCELLED' });
    await hiding;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('lets a view-hide transition invalidate an in-flight poll before the stale frame reaches the 3D runtime', async () => {
    const snapshotGate = deferred<{
      sequence: number; capturedAt: string; inputs: Record<string, boolean>;
      outputs: Record<string, boolean>; monitors: Record<string, boolean>;
    }>();
    const disconnect = vi.fn(async () => undefined);
    const applySnapshot = vi.fn(async () => ({ blocked: [] as readonly string[] }));
    const candidate = {
      connect: vi.fn(async () => undefined),
      synchronizeInputImage: vi.fn(async () => undefined),
      applySnapshot,
      disconnect,
      handleError: vi.fn(),
      status: { state: 'connected' as const, blocked: [] as readonly string[] },
    };
    const readSnapshot = vi.fn(() => snapshotGate.promise);
    const probe = vi.fn()
      .mockResolvedValueOnce(availableProbe(canonicalDiChannels))
      .mockResolvedValueOnce(availableProbe(['B0S01.POS00']));
    const integration = createPalletizerXgSimUiIntegration({
      classic: classic(),
      selectProject: vi.fn(async () => ({ selected: true, reference: { sha256 } })),
      bridgeFactory: vi.fn(() => candidate), readSnapshot, probe, setStatus: vi.fn(),
      runtimeTarget: { cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
    });
    await integration.connect({ localSimulationConsented: true });

    const polling = integration.pollOnce();
    await vi.waitFor(() => expect(readSnapshot).toHaveBeenCalledOnce());
    const hiding = integration.onViewHidden();
    snapshotGate.resolve({
      sequence: 1, capturedAt: '2026-08-13T00:00:00.000Z', inputs: {}, outputs: {}, monitors: { M00320: true },
    });

    await polling;
    await hiding;
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('faults closed when an alias conflicts with the same direct M address in one frame', async () => {
    const handleError = vi.fn(async () => undefined);
    const candidate = {
      connect: vi.fn(async () => undefined),
      synchronizeInputImage: vi.fn(async () => undefined),
      applySnapshot: vi.fn(), disconnect: vi.fn(), handleError,
      status: { state: 'connected' as const, blocked: [] as readonly string[] },
    };
    const probe = vi.fn()
      .mockResolvedValueOnce(availableProbe(canonicalDiChannels))
      .mockResolvedValueOnce(availableProbe(['B0S01.POS00']));
    const setStatus = vi.fn();
    const integration = createPalletizerXgSimUiIntegration({
      classic: classic(),
      selectProject: vi.fn(async () => ({ selected: true, reference: { sha256 } })),
      bridgeFactory: vi.fn(() => candidate),
      readSnapshot: vi.fn(async () => ({
        sequence: 1, capturedAt: '2026-08-13T00:00:00.000Z', inputs: {},
        outputs: { 'auto-start-command': true }, monitors: { M00123: false },
      })),
      probe, setStatus,
      runtimeTarget: { cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
    });
    await integration.connect({ localSimulationConsented: true });

    await integration.pollOnce();

    expect(candidate.applySnapshot).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ code: 'XGSIM_AMBIGUOUS_MONITOR_VALUE' }));
    expect(setStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'faulted', identityVerified: false }));
  });

  it('rejects duplicate monitor targets at construction instead of silently overwriting an address', () => {
    expect(() => createPalletizerXgSimUiIntegration({
      classic: classic(), selectProject: vi.fn(), bridgeFactory: vi.fn(), readSnapshot: vi.fn(),
      probe: vi.fn(), setStatus: vi.fn(),
      runtimeTarget: { cpuModel: 'XGB-XBC-DN32UP', base: 0, slot: 0 },
      monitorBindings: { first: 'M00123', second: 'm00123' },
    })).toThrow(expect.objectContaining({ code: 'XGSIM_INVALID_MONITOR_BINDINGS' }));
  });
});
