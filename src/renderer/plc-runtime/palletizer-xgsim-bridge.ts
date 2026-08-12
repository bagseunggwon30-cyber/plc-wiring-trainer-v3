import type { IoBindingV1, PlcRuntimeAdapter, PlcRuntimeConnectRequest, PlcRuntimeSnapshot } from '../../domain/plc-runtime';

export const PALLETIZER_XGSIM_INPUT_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
    `P0000${index.toString(16).toUpperCase()}`,
    `B0S0.IN${String(index).padStart(2, '0')}`,
  ])),
);

const COMMANDS = ['M00111', 'M00119', 'M00122', 'M00123', 'M00124', 'M00125', 'M00126'] as const;
const OUTCOME_MONITORS = Object.freeze([
  ...Array.from({ length: 30 }, (_, index) => `M003${String(20 + index).padStart(2, '0')}`),
  ...Array.from({ length: 16 }, (_, index) => `M004${String(index).padStart(2, '0')}`),
]);
const HOST_V1_BLOCKED = Object.freeze(['D00000', 'D004xx', 'D005xx']);

export interface PalletizerRuntimePort {
  readDevice(address: string): unknown;
  setPhysicalInput(address: string, value: boolean): boolean;
  writeDevice(address: string, value: boolean): unknown;
  stopAll(): unknown;
  setServo(axis: null, value: boolean): unknown;
  /** Mirrors PLC-owned M outcomes locally without turning them into commands. */
  setObservedStatus?(values: Readonly<Record<string, boolean>>): unknown;
  clearObservedStatus?(): unknown;
  /** Suppresses the offline AUTO engine while a PLC snapshot is authoritative. */
  setPlcAuthoritative?(active: boolean): unknown;
}

export interface PalletizerXgSimIdentity {
  readonly cpuModel: string;
  readonly projectSha256: string;
  readonly base: number;
  readonly slot: number;
}

export interface PalletizerXgSimBridgeStatus {
  readonly state: 'disconnected' | 'connected' | 'blocked' | 'faulted';
  readonly reason?: string;
  readonly blocked: readonly string[];
  /** Host v1 normally cannot prove the loaded XG5000 project identity. */
  readonly identityVerified?: boolean;
}

export interface PalletizerXgSimBridge {
  readonly status: PalletizerXgSimBridgeStatus;
  connect(identity: PalletizerXgSimIdentity): Promise<void>;
  synchronizeInputImage(): Promise<void>;
  applySnapshot(snapshot: PlcRuntimeSnapshot): Promise<{ readonly blocked: readonly string[] }>;
  disconnect(): Promise<void>;
  handleError(error: unknown): Promise<void>;
}

function identityMismatch(expected: PalletizerXgSimIdentity, actual: PalletizerXgSimIdentity): string | null {
  if (actual.projectSha256.toLowerCase() !== expected.projectSha256.toLowerCase()) return 'hash-mismatch';
  if (actual.cpuModel !== expected.cpuModel) return 'cpu-mismatch';
  if (actual.base !== expected.base) return 'base-mismatch';
  if (actual.slot !== expected.slot) return 'slot-mismatch';
  return null;
}

function commandValue(snapshot: PlcRuntimeSnapshot, address: string): boolean {
  return snapshot.monitors[address] === true || snapshot.inputs[address] === true || snapshot.outputs[address] === true;
}

function errorWithCode(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function inputMapFromChannels(inputChannels?: readonly string[]): Readonly<Record<string, string>> {
  if (!inputChannels) return PALLETIZER_XGSIM_INPUT_MAP;
  if (inputChannels.length !== 16 || new Set(inputChannels).size !== 16 || inputChannels.some((channel) => !channel)) {
    throw errorWithCode('XGSIM_INVALID_DI_CHANNELS', 'The palletizer requires exactly sixteen unique XG-SIM DI channels.');
  }
  return Object.freeze(Object.fromEntries(inputChannels.map((channel, index) => [
    `P0000${index.toString(16).toUpperCase()}`,
    channel,
  ])));
}

function bindingsFor(identity: PalletizerXgSimIdentity, inputMap: Readonly<Record<string, string>>): IoBindingV1[] {
  const base = { schemaVersion: 1 as const, deviceInstanceId: 'palletizer-xgb', terminalId: 'XG-SIM', cpuModel: identity.cpuModel, projectId: 'palletizer-xgb-production', projectSha256: identity.projectSha256 };
  return [
    ...Object.values(inputMap).map((address) => ({ ...base, id: address, symbolName: address, address, direction: 'input' as const, dataType: 'BOOL' as const, inverted: false, normalState: false, communicationLossState: false, access: { read: true, write: true } })),
    ...COMMANDS.map((address) => ({ ...base, id: address, symbolName: address, address, direction: 'monitor' as const, dataType: 'BOOL' as const, inverted: false, normalState: false, communicationLossState: false, access: { read: true, write: false } })),
    ...OUTCOME_MONITORS.map((address) => ({ ...base, id: address, symbolName: address, address, direction: 'monitor' as const, dataType: 'BOOL' as const, inverted: false, normalState: false, communicationLossState: false, access: { read: true, write: false } })),
  ];
}

function inputImageFromRuntime(runtime: PalletizerRuntimePort, inputMap: Readonly<Record<string, string>>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(inputMap)
    .map(([physicalAddress, channel]) => [channel, runtime.readDevice(physicalAddress) === true]));
}

function neutralInputImage(inputMap: Readonly<Record<string, string>>): Record<string, boolean> {
  return Object.fromEntries(Object.values(inputMap).map((channel) => [channel, false]));
}

/**
 * A deliberately local-only translation layer.  Host v1 exposes virtual IN
 * images and M-device snapshots, but does not provide the D monitor contract
 * required to claim position or STEP feedback from a live XG5000 project.
 */
export function createPalletizerXgSimBridge(options: {
  readonly adapter: PlcRuntimeAdapter;
  readonly runtime: PalletizerRuntimePort;
  readonly expectedIdentity: PalletizerXgSimIdentity;
  /** Exact DI channel spellings returned by the successful base 0 / slot 0 probe. */
  readonly inputChannels?: readonly string[];
}): PalletizerXgSimBridge {
  const inputMap = inputMapFromChannels(options.inputChannels);
  let state: PalletizerXgSimBridgeStatus = { state: 'disconnected', blocked: HOST_V1_BLOCKED };

  const safeStop = async (): Promise<void> => {
    options.runtime.stopAll();
    options.runtime.setServo(null, false);
    for (const address of Object.keys(inputMap)) options.runtime.setPhysicalInput(address, false);
    options.runtime.clearObservedStatus?.();
    options.runtime.setPlcAuthoritative?.(false);
    await options.adapter.writeInputImage({ values: neutralInputImage(inputMap) }).catch(() => undefined);
    await options.adapter.disconnect().catch(() => undefined);
  };

  return {
    get status(): PalletizerXgSimBridgeStatus { return state; },

    async connect(identity: PalletizerXgSimIdentity): Promise<void> {
      const mismatch = identityMismatch(options.expectedIdentity, identity);
      if (mismatch) {
        state = { state: 'blocked', reason: mismatch, blocked: HOST_V1_BLOCKED };
        throw errorWithCode('XGSIM_IDENTITY_MISMATCH', `XG-SIM ${mismatch}`);
      }
      const request: PlcRuntimeConnectRequest = {
        sessionNonce: '0'.repeat(32), cpuModel: identity.cpuModel, projectId: 'palletizer-xgb-production',
        projectSha256: identity.projectSha256, base: identity.base, slot: identity.slot, bindings: bindingsFor(identity, inputMap),
      };
      const connection = await options.adapter.connect(request);
      options.runtime.setPlcAuthoritative?.(true);
      state = {
        state: 'connected',
        blocked: HOST_V1_BLOCKED,
        identityVerified: connection.projectIdentityVerified,
        ...(connection.projectIdentityVerified ? {} : { reason: 'project-identity-unverified' }),
      };
    },

    async synchronizeInputImage(): Promise<void> {
      if (state.state !== 'connected') throw errorWithCode('XGSIM_NOT_CONNECTED', 'XG-SIM palletizer bridge is not connected.');
      await options.adapter.writeInputImage({ values: inputImageFromRuntime(options.runtime, inputMap) });
    },

    async applySnapshot(snapshot: PlcRuntimeSnapshot): Promise<{ readonly blocked: readonly string[] }> {
      if (state.state !== 'connected') throw errorWithCode('XGSIM_NOT_CONNECTED', 'XG-SIM palletizer bridge is not connected.');
      const observed = Object.fromEntries(OUTCOME_MONITORS.map((address) => [address, commandValue(snapshot, address)]));
      options.runtime.setObservedStatus?.(observed);
      return { blocked: HOST_V1_BLOCKED };
    },

    async disconnect(): Promise<void> {
      await safeStop();
      state = { state: 'disconnected', blocked: HOST_V1_BLOCKED };
    },

    async handleError(error: unknown): Promise<void> {
      await safeStop();
      state = { state: 'faulted', reason: error instanceof Error ? error.message : String(error), blocked: HOST_V1_BLOCKED };
    },
  };
}
