import type {
  IoBindingV1,
  PlcRuntimeAdapter,
  PlcRuntimeConnection,
  PlcRuntimeConnectRequest,
  PlcRuntimeSnapshot,
} from '../../domain/plc-runtime';

export const PALLETIZER_XGSIM_INPUT_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
    `P0000${index.toString(16).toUpperCase()}`,
    `B0S0.IN${String(index).padStart(2, '0')}`,
  ])),
);

export const PALLETIZER_XGSIM_COMMANDS = Object.freeze([
  'M00111', 'M00119', 'M00122', 'M00123', 'M00124', 'M00125', 'M00126',
] as const);
export const PALLETIZER_XGSIM_OUTCOME_MONITORS = Object.freeze([
  ...Array.from({ length: 30 }, (_, index) => `M003${String(20 + index).padStart(2, '0')}`),
  ...Array.from({ length: 16 }, (_, index) => `M004${String(index).padStart(2, '0')}`),
]);
const HOST_V1_BLOCKED = Object.freeze(['D00000', 'D004xx', 'D005xx']);
const DI_CHANNEL_PATTERN = /^(B\d+S\d+)\.IN(\d{2})$/i;

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
  readonly state: 'disconnected' | 'connected' | 'diagnostic' | 'blocked' | 'faulted';
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

function snapshotBoolean(snapshot: PlcRuntimeSnapshot, address: string): boolean {
  const values = [snapshot.monitors, snapshot.inputs, snapshot.outputs]
    .filter((image) => Object.prototype.hasOwnProperty.call(image, address))
    .map((image) => image[address]);
  if (!values.length || values.some((value) => typeof value !== 'boolean') || values.some((value) => value !== values[0])) {
    throw errorWithCode('XGSIM_INCOMPLETE_BOOL_SNAPSHOT', `PLC frame is missing one unambiguous BOOL value for ${address}.`);
  }
  return values[0] as boolean;
}

function errorWithCode(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function inputMapFromChannels(inputChannels?: readonly string[]): Readonly<Record<string, string>> {
  if (!inputChannels) return PALLETIZER_XGSIM_INPUT_MAP;
  if (inputChannels.length !== 16 || new Set(inputChannels).size !== 16 || inputChannels.some((channel) => !channel)) {
    throw errorWithCode('XGSIM_INVALID_DI_CHANNELS', 'The palletizer requires exactly sixteen unique XG-SIM DI channels.');
  }
  const parsed = inputChannels.map((channel) => DI_CHANNEL_PATTERN.exec(channel));
  const prefixes = new Set(parsed.map((match) => match?.[1].toUpperCase()));
  if (parsed.some((match, index) => !match || Number(match[2]) !== index) || prefixes.size !== 1) {
    throw errorWithCode(
      'XGSIM_INVALID_DI_CHANNELS',
      'The palletizer DI channels must be one ordered IN00..IN15 bank from a single base/slot prefix.',
    );
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
    ...PALLETIZER_XGSIM_COMMANDS.map((address) => ({ ...base, id: address, symbolName: address, address, direction: 'monitor' as const, dataType: 'BOOL' as const, inverted: false, normalState: false, communicationLossState: false, access: { read: true, write: false } })),
    ...PALLETIZER_XGSIM_OUTCOME_MONITORS.map((address) => ({ ...base, id: address, symbolName: address, address, direction: 'monitor' as const, dataType: 'BOOL' as const, inverted: false, normalState: false, communicationLossState: false, access: { read: true, write: false } })),
  ];
}

function inputImageFromRuntime(runtime: PalletizerRuntimePort, inputMap: Readonly<Record<string, string>>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(inputMap).map(([physicalAddress, channel]) => {
    const value = runtime.readDevice(physicalAddress);
    if (typeof value !== 'boolean') {
      throw errorWithCode('XGSIM_INCOMPLETE_PHYSICAL_INPUT', `Physical input ${physicalAddress} did not return a BOOL value.`);
    }
    return [channel, value];
  }));
}

function neutralInputImage(inputMap: Readonly<Record<string, string>>): Record<string, boolean> {
  return Object.fromEntries(Object.values(inputMap).map((channel) => [channel, false]));
}

function sessionNonce(): string {
  const bytes = new Uint8Array(16);
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw errorWithCode('XGSIM_SECURE_NONCE_UNAVAILABLE', 'A secure session nonce source is unavailable.');
  }
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function assertCompleteInputWrite(
  result: { readonly acceptedBindingIds: readonly string[]; readonly rejectedBindingIds: readonly string[] },
  expectedBindingIds: readonly string[],
): void {
  const expected = new Set(expectedBindingIds);
  const accepted = new Set(result.acceptedBindingIds);
  const missing = expectedBindingIds.filter((bindingId) => !accepted.has(bindingId));
  const unexpected = result.acceptedBindingIds.filter((bindingId) => !expected.has(bindingId));
  if (result.rejectedBindingIds.length || missing.length || unexpected.length || accepted.size !== result.acceptedBindingIds.length) {
    throw errorWithCode(
      'XGSIM_INPUT_IMAGE_REJECTED',
      `XG-SIM did not accept the complete DI image (missing=${missing.join(',') || 'none'}, rejected=${result.rejectedBindingIds.join(',') || 'none'}).`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const inputChannels = Object.values(inputMap);
  let state: PalletizerXgSimBridgeStatus = { state: 'disconnected', blocked: HOST_V1_BLOCKED };
  let minimumSnapshotCapturedAt: number | null = null;
  let lastSnapshotCapturedAt: number | null = null;
  let lastSnapshotSequence: number | null = null;
  let activeConnection: PlcRuntimeConnection | null = null;
  let authoritative = false;

  const resetSnapshotBoundary = (): void => {
    minimumSnapshotCapturedAt = null;
    lastSnapshotCapturedAt = null;
    lastSnapshotSequence = null;
  };

  const safeStop = async (): Promise<readonly string[]> => {
    const failures: string[] = [];
    const attempt = async (label: string, action: () => unknown): Promise<void> => {
      try {
        if (await action() === false) failures.push(`${label}: rejected`);
      } catch (error) {
        failures.push(`${label}: ${errorMessage(error)}`);
      }
    };
    await attempt('runtime-stop', () => options.runtime.stopAll());
    await attempt('servo-off', () => options.runtime.setServo(null, false));
    for (const address of Object.keys(inputMap)) {
      await attempt(`input-neutral-${address}`, () => options.runtime.setPhysicalInput(address, false));
    }
    await attempt('observed-status-clear', () => options.runtime.clearObservedStatus?.());
    await attempt('plc-authority-clear', () => options.runtime.setPlcAuthoritative?.(false));
    if (authoritative) {
      try {
        const result = await options.adapter.writeInputImage({ values: neutralInputImage(inputMap) });
        assertCompleteInputWrite(result, inputChannels);
      } catch (error) {
        failures.push(`host-input-neutral: ${errorMessage(error)}`);
      }
    }
    try {
      await options.adapter.disconnect();
    } catch (error) {
      failures.push(`host-disconnect: ${errorMessage(error)}`);
    }
    activeConnection = null;
    authoritative = false;
    resetSnapshotBoundary();
    return failures;
  };

  return {
    get status(): PalletizerXgSimBridgeStatus { return state; },

    async connect(identity: PalletizerXgSimIdentity): Promise<void> {
      if (state.state === 'connected') {
        throw errorWithCode('XGSIM_ALREADY_CONNECTED', 'Disconnect the active XG-SIM palletizer session before reconnecting.');
      }
      const mismatch = identityMismatch(options.expectedIdentity, identity);
      if (mismatch) {
        state = { state: 'blocked', reason: mismatch, blocked: HOST_V1_BLOCKED };
        throw errorWithCode('XGSIM_IDENTITY_MISMATCH', `XG-SIM ${mismatch}`);
      }
      const request: PlcRuntimeConnectRequest = {
        sessionNonce: sessionNonce(), cpuModel: identity.cpuModel, projectId: 'palletizer-xgb-production',
        projectSha256: identity.projectSha256, base: identity.base, slot: identity.slot, bindings: bindingsFor(identity, inputMap),
      };
      let connection: PlcRuntimeConnection;
      try {
        connection = await options.adapter.connect(request);
        const connectedAt = Date.parse(connection.connectedAt);
        if (!Number.isFinite(connectedAt)) {
          throw errorWithCode('XGSIM_INVALID_CONNECTION_TIME', 'XG-SIM returned an invalid connection timestamp.');
        }
        if (connection.projectIdentityVerified
          && connection.projectSha256.toLowerCase() !== identity.projectSha256.toLowerCase()) {
          throw errorWithCode('XGSIM_VERIFIED_PROJECT_MISMATCH', 'XG-SIM verified a different project hash than the selected project.');
        }
        minimumSnapshotCapturedAt = connectedAt;
        lastSnapshotCapturedAt = null;
        lastSnapshotSequence = null;
        activeConnection = connection;
        authoritative = connection.projectIdentityVerified
          && typeof connection.sessionId === 'string' && connection.sessionId.length > 0
          && connection.sessionNonce === request.sessionNonce
          && typeof connection.hostEpoch === 'string' && connection.hostEpoch.length > 0;
        await options.runtime.setPlcAuthoritative?.(authoritative);
      } catch (error) {
        const cleanupFailures = await safeStop();
        state = {
          state: 'faulted',
          reason: [errorMessage(error), ...cleanupFailures].join(' | '),
          blocked: HOST_V1_BLOCKED,
          identityVerified: false,
        };
        throw error;
      }
      state = {
        state: authoritative ? 'connected' : 'diagnostic',
        blocked: HOST_V1_BLOCKED,
        identityVerified: authoritative,
        ...(authoritative ? {} : { reason: 'project-identity-unverified-diagnostic-only' }),
      };
    },

    async synchronizeInputImage(): Promise<void> {
      if (state.state !== 'connected') throw errorWithCode('XGSIM_NOT_CONNECTED', 'XG-SIM palletizer bridge is not connected.');
      if (!activeConnection || !authoritative) {
        throw errorWithCode('XGSIM_DIAGNOSTIC_ONLY', 'An unverified XG-SIM session cannot receive physical inputs.');
      }
      const lease = await options.adapter.getStatus();
      if (lease.state !== 'connected' || lease.sessionId !== activeConnection.sessionId
        || !lease.projectIdentityVerified || lease.projectSha256?.toLowerCase() !== activeConnection.projectSha256.toLowerCase()) {
        throw errorWithCode('XGSIM_SESSION_LEASE_LOST', 'The active native-host session lease no longer matches the palletizer connection.');
      }
      const result = await options.adapter.writeInputImage({ values: inputImageFromRuntime(options.runtime, inputMap) });
      assertCompleteInputWrite(result, inputChannels);
    },

    async applySnapshot(snapshot: PlcRuntimeSnapshot): Promise<{ readonly blocked: readonly string[] }> {
      if (state.state !== 'connected') throw errorWithCode('XGSIM_NOT_CONNECTED', 'XG-SIM palletizer bridge is not connected.');
      if (!activeConnection || !authoritative
        || snapshot.sessionId !== activeConnection.sessionId
        || snapshot.sessionNonce !== activeConnection.sessionNonce
        || snapshot.hostEpoch !== activeConnection.hostEpoch
        || snapshot.projectSha256?.toLowerCase() !== activeConnection.projectSha256.toLowerCase()) {
        throw errorWithCode('XGSIM_UNBOUND_HOST_FRAME', 'PLC frame identity does not match the active native-host session lease.');
      }
      const capturedAt = Date.parse(snapshot.capturedAt);
      if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence <= 0 || !Number.isFinite(capturedAt)) {
        throw errorWithCode('XGSIM_INVALID_SNAPSHOT', 'XG-SIM returned an invalid frame sequence or capture timestamp.');
      }
      if ((minimumSnapshotCapturedAt !== null && capturedAt < minimumSnapshotCapturedAt)
        || (lastSnapshotSequence !== null && snapshot.sequence <= lastSnapshotSequence)
        || (lastSnapshotCapturedAt !== null && capturedAt <= lastSnapshotCapturedAt)) {
        throw errorWithCode('XGSIM_STALE_SNAPSHOT', 'XG-SIM returned a stale or out-of-order PLC frame.');
      }
      for (const address of PALLETIZER_XGSIM_COMMANDS) snapshotBoolean(snapshot, address);
      const observed = Object.fromEntries(PALLETIZER_XGSIM_OUTCOME_MONITORS.map((address) => [address, snapshotBoolean(snapshot, address)]));
      options.runtime.setObservedStatus?.(observed);
      lastSnapshotSequence = snapshot.sequence;
      lastSnapshotCapturedAt = capturedAt;
      return { blocked: HOST_V1_BLOCKED };
    },

    async disconnect(): Promise<void> {
      const failures = await safeStop();
      if (failures.length) {
        const reason = `XG-SIM safe disconnect was incomplete: ${failures.join(' | ')}`;
        state = { state: 'faulted', reason, blocked: HOST_V1_BLOCKED, identityVerified: false };
        throw errorWithCode('XGSIM_SAFE_STOP_FAILED', reason);
      }
      state = { state: 'disconnected', blocked: HOST_V1_BLOCKED };
    },

    async handleError(error: unknown): Promise<void> {
      const failures = await safeStop();
      state = {
        state: 'faulted',
        reason: [errorMessage(error), ...failures].join(' | '),
        blocked: HOST_V1_BLOCKED,
        identityVerified: false,
      };
    },
  };
}
