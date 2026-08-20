import { describe, expect, it, vi } from 'vitest';
import type { PlcRuntimeProbeResult } from '../../src/domain/plc-runtime';
import {
  createPalletizerXgSimUiIntegration,
  type PalletizerClassicRuntimePort,
} from '../../src/renderer/plc-runtime/palletizer-xgsim-ui-integration';

const sha256 = 'e'.repeat(64);
const expectedIdentity = { cpuModel: 'XGB-XBCU', projectSha256: sha256, base: 0, slot: 1 };
const canonicalDiChannels = Array.from({ length: 16 }, (_, index) => `B0S00.IN${String(index).padStart(2, '0')}`);

function probeResult(
  status: PlcRuntimeProbeResult['status'],
  channelNames: readonly string[] = [],
  reason?: string,
): PlcRuntimeProbeResult {
  return {
    status,
    capabilities: {
      provider: 'xgsim', protocolVersion: 1, supportsInputChannels: true,
      supportsOutputChannels: true, supportsDeviceRead: true,
      supportsOutputWrite: false, supportsProjectIdentityVerification: false, maximumBindings: 256,
    },
    channelNames,
    reason,
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

function createHarness(probeResults: readonly PlcRuntimeProbeResult[], options: { readonly projectIdentityVerified?: boolean } = {}) {
  const probe = vi.fn(async () => probeResults[probe.mock.calls.length - 1]!);
  let bridgeState: 'disconnected' | 'connected' | 'diagnostic' = 'disconnected';
  const connect = vi.fn(async () => {
    bridgeState = options.projectIdentityVerified === false ? 'diagnostic' : 'connected';
  });
  const status = {
    blocked: [] as readonly string[],
    identityVerified: options.projectIdentityVerified ?? false,
  };
  const bridgeFactory = vi.fn(() => ({
    get status() {
      return {
        ...status, state: bridgeState,
        ...(bridgeState === 'diagnostic' ? { reason: 'project-identity-unverified-diagnostic-only' } : {}),
      };
    },
    connect,
    synchronizeInputImage: vi.fn(async () => undefined),
    applySnapshot: vi.fn(async () => ({ blocked: [] })),
    disconnect: vi.fn(async () => undefined),
    handleError: vi.fn(async () => undefined),
  }));
  const setStatus = vi.fn();
  const integration = createPalletizerXgSimUiIntegration({
    classic: classic(),
    selectProject: vi.fn(async () => ({ selected: true, reference: { sha256 } })),
    bridgeFactory,
    readSnapshot: vi.fn(),
    setStatus,
    runtimeTarget: { cpuModel: expectedIdentity.cpuModel, base: expectedIdentity.base, slot: expectedIdentity.slot },
    // The production controller must own this preflight rather than letting
    // the bridge connect against a guessed B0S0/B0S00 spelling.
    probe,
  } as unknown as Parameters<typeof createPalletizerXgSimUiIntegration>[0]);
  return { integration, probe, connect, bridgeFactory, setStatus };
}

describe('3-axis palletizer XG-SIM probe preflight contract', () => {
  it('discovers the exact B0S00.IN00..IN15 names at DI base/slot 0/0 and confirms the XG-PM positioning slot 0/1 before connecting', async () => {
    const harness = createHarness([
      probeResult('available', [...canonicalDiChannels, 'B0S00.OUT00']),
      probeResult('available', ['B0S01.POS00']),
    ]);

    await harness.integration.connect({ localSimulationConsented: true });

    expect(harness.probe).toHaveBeenNthCalledWith(1, { base: 0, slot: 0 });
    expect(harness.probe).toHaveBeenNthCalledWith(2, { base: 0, slot: 1 });
    expect(harness.bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      inputChannels: canonicalDiChannels,
      positioningProbe: expect.objectContaining({ status: 'available' }),
    }));
    expect(harness.connect).toHaveBeenCalledWith(expectedIdentity);
  });

  it('blocks without opening an XG-SIM session when the DI probe is unavailable or omits any exact IN00..IN15 channel', async () => {
    const harness = createHarness([
      probeResult('available', canonicalDiChannels.slice(0, -1)),
      probeResult('available', ['B0S01.POS00']),
    ]);

    await expect(harness.integration.connect({ localSimulationConsented: true }))
      .rejects.toMatchObject({ code: 'XGSIM_DI_CHANNEL_CONTRACT_MISSING' });

    expect(harness.connect).not.toHaveBeenCalled();
    expect(harness.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'blocked', reason: 'di-channel-contract-missing',
    }));
  });

  it('rejects a complete-looking IN00..IN15 list assembled from different base/slot banks', async () => {
    const mixedBanks = canonicalDiChannels.map((channel, index) => (
      index === 8 ? channel.replace('B0S00', 'B1S03') : channel
    ));
    const harness = createHarness([
      probeResult('available', mixedBanks),
      probeResult('available', ['B0S01.POS00']),
    ]);

    await expect(harness.integration.connect({ localSimulationConsented: true }))
      .rejects.toMatchObject({ code: 'XGSIM_DI_CHANNEL_CONTRACT_MISSING' });

    expect(harness.probe).toHaveBeenCalledOnce();
    expect(harness.connect).not.toHaveBeenCalled();
    expect(harness.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'blocked', reason: 'di-channel-contract-missing',
    }));
  });

  it('blocks without opening an XG-SIM session when the DI probe itself is unavailable', async () => {
    const harness = createHarness([
      probeResult('blocked', [], 'XG-SIM DI simulator unavailable'),
    ]);

    await expect(harness.integration.connect({ localSimulationConsented: true }))
      .rejects.toMatchObject({ code: 'XGSIM_DI_CHANNEL_CONTRACT_MISSING' });

    expect(harness.probe).toHaveBeenCalledOnce();
    expect(harness.probe).toHaveBeenCalledWith({ base: 0, slot: 0 });
    expect(harness.connect).not.toHaveBeenCalled();
    expect(harness.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'blocked', reason: 'di-channel-contract-missing',
    }));
  });

  it('blocks without opening an XG-SIM session when the XG-PM positioning probe at base/slot 0/1 is not available', async () => {
    const harness = createHarness([
      probeResult('available', canonicalDiChannels),
      probeResult('blocked', [], 'XG-PM positioning simulator unavailable'),
    ]);

    await expect(harness.integration.connect({ localSimulationConsented: true }))
      .rejects.toMatchObject({ code: 'XGSIM_POSITIONING_PROBE_UNAVAILABLE' });

    expect(harness.probe).toHaveBeenNthCalledWith(1, { base: 0, slot: 0 });
    expect(harness.probe).toHaveBeenNthCalledWith(2, { base: 0, slot: 1 });
    expect(harness.connect).not.toHaveBeenCalled();
    expect(harness.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'blocked', reason: 'positioning-probe-unavailable',
    }));
  });

  it('publishes an explicitly unverified project state when Host v1 returns projectIdentityVerified=false', async () => {
    const harness = createHarness([
      probeResult('available', canonicalDiChannels),
      probeResult('available', ['B0S01.POS00']),
    ], { projectIdentityVerified: false });

    await harness.integration.connect({ localSimulationConsented: true });

    expect(harness.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'diagnostic',
      identityVerified: false,
      reason: 'project-identity-unverified-diagnostic-only',
    }));
  });
});
