import { describe, expect, it, vi } from 'vitest';
import {
  createPalletizerXgSimUiIntegration,
  type PalletizerClassicRuntimePort,
} from '../../src/renderer/plc-runtime/palletizer-xgsim-ui-integration';

const sha256 = 'b'.repeat(64);
const canonicalDiChannels = Array.from({ length: 16 }, (_, index) => `B0S00.IN${String(index).padStart(2, '0')}`);

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
  it('treats the selected hash as a connection reference and never reports exact project verification for Host v1', async () => {
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
      status: { state: 'disconnected' as const, blocked: [] as readonly string[], identityVerified: true },
    }));
    const readSnapshot = vi.fn(async () => { order.push('post-scan-snapshot'); return { sequence: 1, capturedAt: '2026-08-13T00:00:00.000Z', inputs: {}, outputs: {}, monitors: {} }; });
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
    expect(order).toEqual(['input-image', 'post-scan-snapshot', 'apply-snapshot']);
    expect(setStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'connected',
      blocked: ['D00000', 'D004xx', 'D005xx'],
      identityVerified: false,
      reason: 'project-identity-unverified',
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
});
