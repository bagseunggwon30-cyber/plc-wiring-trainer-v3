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

function validateMonitorBindings(bindings: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  const addresses = new Set<string>();
  for (const [bindingId, rawAddress] of Object.entries(bindings)) {
    const address = rawAddress.toUpperCase();
    if (!bindingId.trim() || !/^M[0-9]{4}[0-9A-F]$/.test(address) || addresses.has(address)) {
      throw codedError(
        'XGSIM_INVALID_MONITOR_BINDINGS',
        'Monitor aliases require unique, non-empty binding IDs and unique XG5000 M-bit addresses.',
      );
    }
    normalized[bindingId] = address;
    addresses.add(address);
  }
  return Object.freeze(normalized);
}

function normalizeSnapshot(snapshot: PlcRuntimeSnapshot, bindings: Readonly<Record<string, string>>): PlcRuntimeSnapshot {
  const monitors = { ...snapshot.monitors };
  for (const [bindingId, address] of Object.entries(bindings)) {
    const values = [snapshot.monitors, snapshot.outputs, snapshot.inputs]
      .filter((image) => Object.prototype.hasOwnProperty.call(image, bindingId))
      .map((image) => image[bindingId]);
    if (!values.length) continue;
    if (values.some((value) => typeof value !== 'boolean') || values.some((value) => value !== values[0])) {
      throw codedError('XGSIM_AMBIGUOUS_MONITOR_VALUE', `Monitor alias ${bindingId} has a non-BOOL or conflicting frame value.`);
    }
    if (Object.prototype.hasOwnProperty.call(monitors, address) && monitors[address] !== values[0]) {
      throw codedError('XGSIM_AMBIGUOUS_MONITOR_VALUE', `Monitor alias ${bindingId} conflicts with ${address}.`);
    }
    monitors[address] = values[0];
  }
  return { ...snapshot, monitors };
}

const DI_SUFFIXES = Array.from({ length: 16 }, (_, index) => String(index).padStart(2, '0'));

function exactDiChannels(probe: PlcRuntimeProbeResult): readonly string[] | null {
  if (probe.status !== 'available') return null;
  const bySuffix = new Map<string, string>();
  const prefixes = new Set<string>();
  for (const channel of probe.channelNames) {
    const match = /^(B\d+S\d+)\.IN(\d{2})$/i.exec(channel);
    if (!match) continue;
    if (!DI_SUFFIXES.includes(match[2]) || bySuffix.has(match[2])) return null;
    prefixes.add(match[1].toUpperCase());
    bySuffix.set(match[2], channel);
  }
  return prefixes.size === 1 && DI_SUFFIXES.every((suffix) => bySuffix.has(suffix))
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
  const monitorBindings = validateMonitorBindings(options.monitorBindings ?? {
    'servo-on-command': 'M00111', 'manual-org-command': 'M00119', 'servo-off-command': 'M00122',
    'auto-start-command': 'M00123', 'stop-command': 'M00124', 'new-pallet-command': 'M00125', 'reset-command': 'M00126',
  });
  let connected = false;
  let generation = 0;
  let connectTask: Promise<void> | null = null;
  let pollTask: Promise<void> | null = null;
  let stopTask: Promise<void> | null = null;

  const publish = (status: PalletizerXgSimUiStatus): void => {
    options.setStatus(status);
    options.classic.renderActive();
  };
  const blockedStatus = (reason: string, candidate: UiBridgePort | null = bridge): PalletizerXgSimUiStatus => ({
    state: 'blocked', reason, blocked: candidate?.status.blocked ?? [], identityVerified: false,
  });
  const connectedStatus = (candidate: UiBridgePort, blocked: readonly string[]): PalletizerXgSimUiStatus => {
    const status = candidate.status;
    if (status.state !== 'connected' && status.state !== 'diagnostic') {
      throw codedError('XGSIM_BRIDGE_NOT_CONNECTED', `The XG-SIM bridge reported ${status.state} after a connection operation.`);
    }
    return {
      ...status,
      blocked,
    };
  };
  const assertConnectCurrent = (token: number): void => {
    if (token !== generation) {
      throw codedError('XGSIM_CONNECTION_CANCELLED', 'The XG-SIM connection was cancelled by a lifecycle transition.');
    }
    if (options.classic.getProfile().id !== 'xgb-production') {
      throw codedError('XGSIM_CONNECTION_CANCELLED', 'The palletizer profile changed while XG-SIM was connecting.');
    }
  };
  const stop = async (): Promise<void> => {
    if (stopTask) return stopTask;
    const operation = (async (): Promise<void> => {
      generation += 1;
      connected = false;
      await connectTask?.catch(() => undefined);
      await pollTask?.catch(() => undefined);
      const candidate = bridge;
      bridge = null;
      if (!candidate) {
        publish({ state: 'disconnected', blocked: [] });
        return;
      }
      try {
        await candidate.disconnect();
        publish({ state: 'disconnected', blocked: candidate.status.blocked });
      } catch (error) {
        publish({
          state: 'faulted',
          reason: candidate.status.reason ?? (error instanceof Error ? error.message : String(error)),
          blocked: candidate.status.blocked,
          identityVerified: false,
        });
      }
    })();
    stopTask = operation;
    try {
      await operation;
    } finally {
      if (stopTask === operation) stopTask = null;
    }
  };

  return {
    async connect(request): Promise<void> {
      if (connectTask || stopTask || connected) {
        throw codedError('XGSIM_CONNECTION_ACTIVE', 'An XG-SIM connection or lifecycle transition is already active.');
      }
      if (!request.localSimulationConsented) throw codedError('LOCAL_SIMULATION_CONSENT_REQUIRED', 'Local XG-SIM operation requires explicit consent.');
      if (options.classic.getProfile().id !== 'xgb-production') throw codedError('PRODUCTION_PROFILE_REQUIRED', 'Select the XGB production profile before connecting XG-SIM.');
      const token = ++generation;
      const operation = (async (): Promise<void> => {
        let candidate: UiBridgePort | null = null;
        try {
          const selected = await options.selectProject();
          assertConnectCurrent(token);
          if (!selected.selected || !selected.reference) {
            throw codedError('XGSIM_PROJECT_SELECTION_REQUIRED', 'Select the exact local XG5000 project first.');
          }
          const connectionIdentity: PalletizerXgSimIdentity = {
            ...options.runtimeTarget,
            projectSha256: selected.reference.sha256,
          };
          let diProbe: PlcRuntimeProbeResult;
          try {
            diProbe = await options.probe({ base: 0, slot: 0 });
          } catch (error) {
            publish(blockedStatus('di-probe-unavailable', candidate));
            throw codedError('XGSIM_DI_PROBE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
          }
          assertConnectCurrent(token);
          const inputChannels = exactDiChannels(diProbe);
          if (!inputChannels) {
            publish(blockedStatus('di-channel-contract-missing', candidate));
            throw codedError('XGSIM_DI_CHANNEL_CONTRACT_MISSING', diProbe.reason ?? 'XG-SIM DI probe did not return one exact channel for each IN00..IN15 suffix.');
          }
          let positioningProbe: PlcRuntimeProbeResult;
          try {
            positioningProbe = await options.probe({ base: 0, slot: 1 });
          } catch (error) {
            publish(blockedStatus('positioning-probe-unavailable', candidate));
            throw codedError('XGSIM_POSITIONING_PROBE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
          }
          assertConnectCurrent(token);
          if (positioningProbe.status !== 'available') {
            publish(blockedStatus('positioning-probe-unavailable', candidate));
            throw codedError('XGSIM_POSITIONING_PROBE_UNAVAILABLE', positioningProbe.reason ?? 'XG-PM positioning simulator probe is unavailable.');
          }
          candidate = options.bridgeFactory({
            runtime: options.classic.getRuntimePort(), expectedIdentity: connectionIdentity, inputChannels, positioningProbe,
          });
          bridge = candidate;
          await candidate.connect(connectionIdentity);
          assertConnectCurrent(token);
          const status = connectedStatus(candidate, candidate.status.blocked);
          connected = status.state === 'connected';
          publish(status);
        } catch (error) {
          connected = false;
          if (candidate) {
            const cancelled = (error as { code?: unknown })?.code === 'XGSIM_CONNECTION_CANCELLED';
            if (cancelled) await candidate.disconnect().catch(() => undefined);
            else if (candidate.status.state !== 'faulted' && candidate.status.state !== 'blocked') {
              await candidate.handleError(error).catch(() => undefined);
            }
            if (bridge === candidate) bridge = null;
          }
          throw error;
        }
      })();
      connectTask = operation;
      try {
        await operation;
      } finally {
        if (connectTask === operation) connectTask = null;
      }
    },

    async pollOnce(): Promise<void> {
      if (!connected || pollTask || stopTask || !bridge) return;
      const candidate = bridge;
      const token = generation;
      const operation = (async (): Promise<void> => {
        try {
          if (options.classic.getProfile().id !== 'xgb-production') {
            throw codedError('XGSIM_PROFILE_LEASE_LOST', 'The XGB production profile lease was lost before polling.');
          }
          await candidate.synchronizeInputImage();
          if (token !== generation || candidate !== bridge || !connected) return;
          if (options.classic.getProfile().id !== 'xgb-production') {
            throw codedError('XGSIM_PROFILE_LEASE_LOST', 'The XGB production profile lease changed during input synchronization.');
          }
          const raw = await options.readSnapshot();
          if (token !== generation || candidate !== bridge || !connected) return;
          if (options.classic.getProfile().id !== 'xgb-production') {
            throw codedError('XGSIM_PROFILE_LEASE_LOST', 'The XGB production profile lease changed while reading a PLC frame.');
          }
          const result = await candidate.applySnapshot(normalizeSnapshot(raw, monitorBindings));
          if (token !== generation || candidate !== bridge || !connected) return;
          publish(connectedStatus(candidate, result.blocked));
        } catch (error) {
          if (token !== generation || candidate !== bridge) return;
          await candidate.handleError(error).catch(() => undefined);
          connected = false;
          publish({
            state: 'faulted',
            reason: candidate.status.reason ?? (error instanceof Error ? error.message : String(error)),
            blocked: candidate.status.blocked,
            identityVerified: false,
          });
        }
      })();
      pollTask = operation;
      try {
        await operation;
      } finally {
        if (pollTask === operation) pollTask = null;
      }
    },

    disconnect: stop,
    async onProfileChanged(): Promise<void> {
      if (options.classic.getProfile().id !== 'xgb-production' && (connected || connectTask || pollTask || bridge)) await stop();
    },
    async onViewHidden(): Promise<void> { if (connected || connectTask || pollTask || bridge) await stop(); },
    async onPageHide(): Promise<void> { if (connected || connectTask || pollTask || bridge) await stop(); },
  };
}
