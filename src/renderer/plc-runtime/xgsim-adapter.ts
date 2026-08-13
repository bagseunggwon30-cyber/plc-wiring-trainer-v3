import {
  PlcRuntimeConnectRequestSchema,
  isInputChannelAddress,
  isMDeviceBitAddress,
  isOutputChannelAddress,
  isWritableRuntimeBinding,
  type IoBindingV1,
} from '../../domain/plc-runtime/io-binding';
import type {
  PlcInputImage,
  PlcInputWriteResult,
  PlcRuntimeAdapter,
  PlcRuntimeConnection,
  PlcRuntimeProbeRequest,
  PlcRuntimeProbeResult,
  PlcRuntimeSnapshot,
  PlcRuntimeStatus,
  PlcRuntimeValue,
} from '../../domain/plc-runtime/contracts';

interface DesktopXgSimApi {
  probe(payload: PlcRuntimeProbeRequest): Promise<Record<string, unknown>>;
  connect(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  readSnapshot(): Promise<Record<string, unknown>>;
  writeInputImage(payload: { values: Record<string, boolean> }): Promise<Record<string, unknown>>;
  getStatus(): Promise<Record<string, unknown>>;
  disconnect(): Promise<Record<string, unknown>>;
}

function desktopApi(): DesktopXgSimApi {
  const api = window.WorkshopDesktop?.xgSim;
  if (!api) throw new Error('XG-SIM desktop bridge is unavailable.');
  return api;
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    ? value
    : null;
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function hasSessionEvidence(
  raw: Record<string, unknown>,
  connection: PlcRuntimeConnection,
): boolean {
  return nonEmptyString(raw.sessionId) === connection.sessionId
    && nonEmptyString(raw.sessionNonce) === connection.sessionNonce
    && nonEmptyString(raw.hostEpoch) === connection.hostEpoch
    && typeof raw.projectSha256 === 'string'
    && sameHash(raw.projectSha256, connection.projectSha256);
}

export class XgSimRuntimeAdapter implements PlcRuntimeAdapter {
  #bindings = new Map<string, IoBindingV1>();
  #byAddress = new Map<string, IoBindingV1>();
  #sequence = 0;
  #connection: PlcRuntimeConnection | null = null;

  async probe(request: PlcRuntimeProbeRequest): Promise<PlcRuntimeProbeResult> {
    let api: DesktopXgSimApi | null = null;
    try {
      api = desktopApi();
      const result = await api.probe(request);
      const channels = Array.isArray(result.channels) ? result.channels.filter((value): value is string => typeof value === 'string') : [];
      return {
        status: result.available === true ? 'available' : 'blocked',
        capabilities: {
          provider: 'xgsim', protocolVersion: 1, supportsInputChannels: true,
          supportsOutputChannels: true, supportsDeviceRead: true,
          supportsOutputWrite: false, supportsProjectIdentityVerification: false, maximumBindings: 256,
        },
        channelNames: channels,
        reason: result.available === true ? undefined : `XG-SIM connect code: ${String(result.connectCode ?? 'unknown')}`,
      };
    } catch (error) {
      return {
        status: 'blocked',
        capabilities: {
          provider: 'xgsim', protocolVersion: 1, supportsInputChannels: true,
          supportsOutputChannels: true, supportsDeviceRead: true,
          supportsOutputWrite: false, supportsProjectIdentityVerification: false, maximumBindings: 256,
        },
        channelNames: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await api?.disconnect().catch(() => undefined);
    }
  }

  async connect(rawRequest: Parameters<PlcRuntimeAdapter['connect']>[0]): Promise<PlcRuntimeConnection> {
    const request = PlcRuntimeConnectRequestSchema.parse(rawRequest);
    this.#bindings = new Map(request.bindings.map((binding) => [binding.id, binding]));
    this.#byAddress = new Map(request.bindings.map((binding) => [binding.address.toUpperCase(), binding]));
    const api = desktopApi();
    const result = await api.connect({
      sessionNonce: request.sessionNonce,
      base: request.base,
      slot: request.slot,
      cpuModel: request.cpuModel,
      projectId: request.projectId,
      projectSha256: request.projectSha256,
      allowedInputs: request.bindings
        .filter((binding) => isWritableRuntimeBinding(binding) && isInputChannelAddress(binding.address))
        .map((binding) => binding.address),
      allowedOutputs: request.bindings
        .filter((binding) => binding.access.read && isOutputChannelAddress(binding.address))
        .map((binding) => binding.address),
      allowedDeviceWrites: request.bindings
        .filter((binding) => isWritableRuntimeBinding(binding) && isMDeviceBitAddress(binding.address))
        .map((binding) => binding.address),
      allowedDeviceReads: request.bindings
        .filter((binding) => binding.access.read && !binding.access.write && isMDeviceBitAddress(binding.address))
        .map((binding) => binding.address),
      deviceFailSafeValues: Object.fromEntries(request.bindings
        .filter((binding) => isWritableRuntimeBinding(binding) && isMDeviceBitAddress(binding.address))
        .map((binding) => [binding.address, binding.communicationLossState])),
    });
    if (result.connected !== true) throw new Error('XG-SIM host did not confirm the local simulator connection.');
    const hostSessionId = nonEmptyString(result.sessionId);
    const echoedNonce = nonEmptyString(result.sessionNonce);
    const hostEpoch = nonEmptyString(result.hostEpoch);
    const reportedProjectSha256 = nonEmptyString(result.projectSha256);
    if (result.projectIdentityVerified === true
      && reportedProjectSha256
      && !sameHash(reportedProjectSha256, request.projectSha256)) {
      await api.disconnect().catch(() => undefined);
      throw codedError('XGSIM_PROJECT_IDENTITY_MISMATCH', 'The native host verified a different XG5000 project.');
    }
    const projectIdentityVerified = result.projectIdentityVerified === true
      && hostSessionId !== null
      && echoedNonce === request.sessionNonce
      && hostEpoch !== null
      && reportedProjectSha256 !== null
      && sameHash(reportedProjectSha256, request.projectSha256);
    this.#sequence = 0;
    this.#connection = {
      sessionId: hostSessionId ?? `xgsim-diagnostic:${request.sessionNonce}`,
      connectedAt: new Date().toISOString(),
      projectSha256: request.projectSha256,
      projectIdentityVerified,
      ...(echoedNonce ? { sessionNonce: echoedNonce } : {}),
      ...(hostEpoch ? { hostEpoch } : {}),
    };
    return this.#connection;
  }

  async readSnapshot(): Promise<PlcRuntimeSnapshot> {
    if (!this.#connection) throw new Error('XG-SIM runtime is not connected.');
    if (!this.#connection.projectIdentityVerified) {
      throw codedError('XGSIM_DIAGNOSTIC_ONLY', 'Unverified XG-SIM sessions cannot supply authoritative PLC frames.');
    }
    const raw = await desktopApi().readSnapshot();
    if (!hasSessionEvidence(raw, this.#connection)) {
      throw codedError('XGSIM_UNBOUND_HOST_FRAME', 'The PLC frame is not bound to the active native-host session and project.');
    }
    const sequence = raw.sequence;
    const capturedAt = nonEmptyString(raw.capturedAt);
    if (!Number.isSafeInteger(sequence) || (sequence as number) <= this.#sequence
      || !capturedAt || !Number.isFinite(Date.parse(capturedAt))) {
      throw codedError('XGSIM_STALE_HOST_FRAME', 'The native host returned a stale or invalid PLC frame.');
    }
    const inputs = this.#mapAddressValues(raw.inputs);
    const outputs = this.#mapAddressValues(raw.outputs);
    const monitors = {
      ...this.#mapAddressValues(raw.devices),
      ...this.#mapAddressValues(raw.monitors),
    };
    this.#sequence = sequence as number;
    return {
      sequence: this.#sequence,
      capturedAt,
      sessionId: this.#connection.sessionId,
      sessionNonce: this.#connection.sessionNonce,
      hostEpoch: this.#connection.hostEpoch,
      projectSha256: this.#connection.projectSha256,
      inputs,
      outputs,
      monitors,
    };
  }

  async writeInputImage(image: PlcInputImage): Promise<PlcInputWriteResult> {
    if (!this.#connection) throw new Error('XG-SIM runtime is not connected.');
    if (!this.#connection.projectIdentityVerified) {
      throw codedError('XGSIM_DIAGNOSTIC_ONLY', 'Unverified XG-SIM sessions cannot accept a physical input image.');
    }
    const values: Record<string, boolean> = {};
    const bindingIdByAddress = new Map<string, string>();
    for (const [bindingId, value] of Object.entries(image.values)) {
      const binding = this.#bindings.get(bindingId);
      if (!binding || !isWritableRuntimeBinding(binding)
        || (!isInputChannelAddress(binding.address) && !isMDeviceBitAddress(binding.address))) {
        throw new Error(`Binding is not writable through the XG-SIM input/device host: ${bindingId}`);
      }
      if (typeof value !== 'boolean') throw new Error(`XG-SIM host v1 accepts BOOL inputs only: ${bindingId}`);
      values[binding.address] = binding.inverted ? !value : value;
      bindingIdByAddress.set(binding.address.toUpperCase(), bindingId);
    }
    const result = await desktopApi().writeInputImage({ values });
    if (!hasSessionEvidence(result, this.#connection) || result.committed !== true) {
      throw codedError('XGSIM_INPUT_ACK_UNVERIFIED', 'The native host did not return a session-bound input-image commit acknowledgement.');
    }
    const acceptedAddresses = stringArray(result.acceptedAddresses);
    const rejectedAddresses = stringArray(result.rejectedAddresses);
    if (!acceptedAddresses || !rejectedAddresses) {
      throw codedError('XGSIM_INPUT_ACK_UNVERIFIED', 'The native host input acknowledgement is missing accepted/rejected address lists.');
    }
    const accepted = acceptedAddresses.map((address) => bindingIdByAddress.get(address.toUpperCase())).filter((id): id is string => Boolean(id));
    const rejected = rejectedAddresses.map((address) => bindingIdByAddress.get(address.toUpperCase())).filter((id): id is string => Boolean(id));
    if (accepted.length !== acceptedAddresses.length || rejected.length !== rejectedAddresses.length) {
      throw codedError('XGSIM_INPUT_ACK_UNVERIFIED', 'The native host acknowledged an address outside the active input image.');
    }
    return { acceptedBindingIds: accepted.sort(), rejectedBindingIds: rejected.sort() };
  }

  async getStatus(): Promise<PlcRuntimeStatus> {
    const raw = await desktopApi().getStatus();
    const connected = raw.state === 'connected' && this.#connection !== null
      && this.#connection.projectIdentityVerified
      && hasSessionEvidence(raw, this.#connection);
    const diagnostic = raw.state === 'connected' && this.#connection !== null && !connected;
    return {
      state: connected ? 'connected' : diagnostic ? 'blocked' : 'disconnected',
      sessionId: connected ? this.#connection!.sessionId : null,
      projectSha256: connected ? this.#connection!.projectSha256 : null,
      projectIdentityVerified: connected && this.#connection!.projectIdentityVerified,
      lastSequence: this.#sequence,
      lastError: diagnostic ? 'The native host did not prove the active session and loaded-project identity.' : null,
    };
  }

  async disconnect(): Promise<void> {
    await desktopApi().disconnect();
    this.#connection = null;
    this.#sequence = 0;
  }

  #mapAddressValues(rawValues: unknown): Readonly<Record<string, PlcRuntimeValue>> {
    if (!rawValues || Array.isArray(rawValues) || typeof rawValues !== 'object') return {};
    const result: Record<string, PlcRuntimeValue> = {};
    for (const [address, value] of Object.entries(rawValues)) {
      const binding = this.#byAddress.get(address.toUpperCase());
      if (!binding || (typeof value !== 'boolean' && typeof value !== 'number')) continue;
      result[binding.id] = binding.inverted && typeof value === 'boolean' ? !value : value;
    }
    return result;
  }
}
