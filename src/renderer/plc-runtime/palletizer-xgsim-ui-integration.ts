import type { PlcRuntimeProbeResult, PlcRuntimeSnapshot } from '../../domain/plc-runtime';
import type { PalletizerRuntimePort, PalletizerXgSimBridgeStatus, PalletizerXgSimIdentity } from './palletizer-xgsim-bridge';

export interface PalletizerClassicRuntimePort {
  getProfile(): { readonly id: string };
  getRuntimePort(): PalletizerRuntimePort;
  renderActive(): void;
}

export interface PalletizerProjectSelection {
  readonly selected: boolean;
  readonly reference?: {
    readonly sha256: string;
  };
}

export interface PalletizerXgSimUiStatus extends PalletizerXgSimBridgeStatus {}

export interface PalletizerXgSimUiIntegration {
  connect(request: { readonly localSimulationConsented: boolean }): Promise<void>;
  pollOnce(): Promise<void>;
  disconnect(): Promise<void>;
  onProfileChanged(): Promise<void>;
  onViewHidden(): Promise<void>;
  onPageHide(): Promise<void>;
}

interface UiBridgePort {
  readonly status: PalletizerXgSimBridgeStatus;
  connect(identity: PalletizerXgSimIdentity): Promise<void>;
  synchronizeInputImage(): Promise<void>;
  applySnapshot(snapshot: PlcRuntimeSnapshot): Promise<{ readonly blocked: readonly string[] }>;
  disconnect(): Promise<void>;
  handleError(error: unknown): Promise<void>;
}

type BridgeFactory = (options: {
  runtime: PalletizerRuntimePort;
  expectedIdentity: PalletizerXgSimIdentity;
  /** Exact strings returned by the DI probe, ordered by IN00 through IN15. */
  inputChannels: readonly string[];
  positioningProbe: PlcRuntimeProbeResult;
}) => UiBridgePort;

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function normalizeSnapshot(snapshot: PlcRuntimeSnapshot, bindings: Readonly<Record<string, string>>): PlcRuntimeSnapshot {
  const monitors = { ...snapshot.monitors };
  for (const [bindingId, address] of Object.entries(bindings)) {
    if (snapshot.monitors[bindingId] !== undefined) monitors[address] = snapshot.monitors[bindingId];
  }
  return { ...snapshot, monitors };
}

const DI_SUFFIXES = Array.from({ length: 16 }, (_, index) => String(index).padStart(2, '0'));

function exactDiChannels(probe: PlcRuntimeProbeResult): readonly string[] | null {
  if (probe.status !== 'available') return null;
  const bySuffix = new Map<string, string>();
  for (const channel of probe.channelNames) {
    const match = /\.IN(\d{2})$/i.exec(channel);
    if (!match || !DI_SUFFIXES.includes(match[1])) continue;
    if (bySuffix.has(match[1])) return null;
    bySuffix.set(match[1], channel);
  }
  return DI_SUFFIXES.every((suffix) => bySuffix.has(suffix))
    ? DI_SUFFIXES.map((suffix) => bySuffix.get(suffix)!)
    : null;
}

/**
 * Vite-side owner for the optional local XG-SIM session.  The classic 3D
 * script supplies only its small runtime port; no UI/global dependency leaks
 * into the bridge itself.  Callers own scheduling and call pollOnce at most
 * once per frame/interval.
 */
export function createPalletizerXgSimUiIntegration(options: {
  readonly classic: PalletizerClassicRuntimePort;
  readonly selectProject: () => Promise<PalletizerProjectSelection>;
  readonly bridgeFactory: BridgeFactory;
  readonly readSnapshot: () => Promise<PlcRuntimeSnapshot>;
  /** The same local desktop adapter used by the bridge, kept injectable for deterministic preflight tests. */
  readonly probe: (request: { readonly base: number; readonly slot: number }) => Promise<PlcRuntimeProbeResult>;
  readonly setStatus: (status: PalletizerXgSimUiStatus) => void;
  /** Runtime endpoint contract only. Host v1 cannot verify which project is loaded. */
  readonly runtimeTarget: Pick<PalletizerXgSimIdentity, 'cpuModel' | 'base' | 'slot'>;
  readonly monitorBindings?: Readonly<Record<string, string>>;
}): PalletizerXgSimUiIntegration {
  let bridge: UiBridgePort | null = null;
  const monitorBindings = options.monitorBindings ?? {
    'servo-on-command': 'M00111', 'manual-org-command': 'M00119', 'servo-off-command': 'M00122',
    'auto-start-command': 'M00123', 'stop-command': 'M00124', 'new-pallet-command': 'M00125', 'reset-command': 'M00126',
  };
  let connected = false;
  let polling = false;

  const publish = (status: PalletizerXgSimUiStatus): void => {
    options.setStatus(status);
    options.classic.renderActive();
  };
  const blockedStatus = (reason: string): PalletizerXgSimUiStatus => ({
    state: 'blocked', reason, blocked: bridge?.status.blocked ?? [], identityVerified: false,
  });
  const connectedStatus = (blocked: readonly string[]): PalletizerXgSimUiStatus => {
    if (!bridge) return { state: 'blocked', reason: 'bridge-not-created', blocked, identityVerified: false };
    const status = bridge.status;
    return {
      ...status,
      state: 'connected',
      blocked,
      // The selected-file hash is only a connection reference. Host v1 cannot
      // prove that the selected file is the project loaded by XG-SIM.
      identityVerified: false,
      reason: 'project-identity-unverified',
    };
  };
  const stop = async (): Promise<void> => {
    polling = false;
    await bridge?.disconnect();
    connected = false;
    publish({ state: 'disconnected', blocked: bridge?.status.blocked ?? [] });
  };

  return {
    async connect(request): Promise<void> {
      if (!request.localSimulationConsented) throw codedError('LOCAL_SIMULATION_CONSENT_REQUIRED', 'Local XG-SIM operation requires explicit consent.');
      if (options.classic.getProfile().id !== 'xgb-production') throw codedError('PRODUCTION_PROFILE_REQUIRED', 'Select the XGB production profile before connecting XG-SIM.');
      const selected = await options.selectProject();
      if (!selected.selected || !selected.reference) throw codedError('XGSIM_PROJECT_SELECTION_REQUIRED', 'Select the exact local XG5000 project first.');
      const connectionIdentity: PalletizerXgSimIdentity = {
        ...options.runtimeTarget,
        projectSha256: selected.reference.sha256,
      };
      let diProbe: PlcRuntimeProbeResult;
      try {
        diProbe = await options.probe({ base: 0, slot: 0 });
      } catch (error) {
        publish(blockedStatus('di-probe-unavailable'));
        throw codedError('XGSIM_DI_PROBE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
      }
      const inputChannels = exactDiChannels(diProbe);
      if (!inputChannels) {
        publish(blockedStatus('di-channel-contract-missing'));
        throw codedError('XGSIM_DI_CHANNEL_CONTRACT_MISSING', diProbe.reason ?? 'XG-SIM DI probe did not return one exact channel for each IN00..IN15 suffix.');
      }
      let positioningProbe: PlcRuntimeProbeResult;
      try {
        positioningProbe = await options.probe({ base: 0, slot: 1 });
      } catch (error) {
        publish(blockedStatus('positioning-probe-unavailable'));
        throw codedError('XGSIM_POSITIONING_PROBE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
      }
      if (positioningProbe.status !== 'available') {
        publish(blockedStatus('positioning-probe-unavailable'));
        throw codedError('XGSIM_POSITIONING_PROBE_UNAVAILABLE', positioningProbe.reason ?? 'XG-PM positioning simulator probe is unavailable.');
      }
      bridge = options.bridgeFactory({
        runtime: options.classic.getRuntimePort(), expectedIdentity: connectionIdentity, inputChannels, positioningProbe,
      });
      await bridge.connect(connectionIdentity);
      connected = true;
      publish(connectedStatus(bridge.status.blocked));
    },

    async pollOnce(): Promise<void> {
      if (!connected || polling || !bridge) return;
      polling = true;
      try {
        await bridge.synchronizeInputImage();
        const raw = await options.readSnapshot();
        const result = await bridge.applySnapshot(normalizeSnapshot(raw, monitorBindings));
        publish(connectedStatus(result.blocked));
      } catch (error) {
        await bridge.handleError(error);
        connected = false;
        publish({
          state: 'faulted', reason: error instanceof Error ? error.message : String(error), blocked: bridge.status.blocked,
          identityVerified: false,
        });
      } finally {
        polling = false;
      }
    },

    disconnect: stop,
    async onProfileChanged(): Promise<void> { if (connected && options.classic.getProfile().id !== 'xgb-production') await stop(); },
    async onViewHidden(): Promise<void> { if (connected) await stop(); },
    async onPageHide(): Promise<void> { if (connected) await stop(); },
  };
}
