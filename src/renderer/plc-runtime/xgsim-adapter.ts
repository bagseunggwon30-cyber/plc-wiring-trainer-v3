import {
  PlcRuntimeConnectRequestSchema,
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

export class XgSimRuntimeAdapter implements PlcRuntimeAdapter {
  #bindings = new Map<string, IoBindingV1>();
  #byAddress = new Map<string, IoBindingV1>();
  #sequence = 0;
  #connection: PlcRuntimeConnection | null = null;

  async probe(request: PlcRuntimeProbeRequest): Promise<PlcRuntimeProbeResult> {
    try {
      const result = await desktopApi().probe(request);
      const channels = Array.isArray(result.channels) ? result.channels.filter((value): value is string => typeof value === 'string') : [];
      return {
        status: result.available === true ? 'available' : 'blocked',
        capabilities: {
          provider: 'xgsim', protocolVersion: 1, supportsInputChannels: true,
          supportsOutputChannels: true, supportsDeviceRead: false,
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
          supportsOutputChannels: true, supportsDeviceRead: false,
          supportsOutputWrite: false, supportsProjectIdentityVerification: false, maximumBindings: 256,
        },
        channelNames: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async connect(rawRequest: Parameters<PlcRuntimeAdapter['connect']>[0]): Promise<PlcRuntimeConnection> {
    const request = PlcRuntimeConnectRequestSchema.parse(rawRequest);
    this.#bindings = new Map(request.bindings.map((binding) => [binding.id, binding]));
    this.#byAddress = new Map(request.bindings.map((binding) => [binding.address.toUpperCase(), binding]));
    const result = await desktopApi().connect({
      base: request.base,
      slot: request.slot,
      cpuModel: request.cpuModel,
      projectId: request.projectId,
      projectSha256: request.projectSha256,
      allowedInputs: request.bindings.filter(isWritableRuntimeBinding).map((binding) => binding.address),
      allowedOutputs: request.bindings.filter((binding) => binding.direction === 'output').map((binding) => binding.address),
    });
    if (result.connected !== true) throw new Error('XG-SIM host did not confirm the local simulator connection.');
    this.#sequence = 0;
    this.#connection = {
      sessionId: `xgsim:${request.sessionNonce}`,
      connectedAt: new Date().toISOString(),
      projectSha256: request.projectSha256,
      projectIdentityVerified: result.projectIdentityVerified === true,
    };
    return this.#connection;
  }

  async readSnapshot(): Promise<PlcRuntimeSnapshot> {
    if (!this.#connection) throw new Error('XG-SIM runtime is not connected.');
    const raw = await desktopApi().readSnapshot();
    const inputs = this.#mapAddressValues(raw.inputs);
    const outputs = this.#mapAddressValues(raw.outputs);
    this.#sequence += 1;
    return {
      sequence: this.#sequence,
      capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : new Date().toISOString(),
      inputs,
      outputs,
      monitors: {},
    };
  }

  async writeInputImage(image: PlcInputImage): Promise<PlcInputWriteResult> {
    if (!this.#connection) throw new Error('XG-SIM runtime is not connected.');
    const values: Record<string, boolean> = {};
    const acceptedBindingIds: string[] = [];
    for (const [bindingId, value] of Object.entries(image.values)) {
      const binding = this.#bindings.get(bindingId);
      if (!binding || !isWritableRuntimeBinding(binding) || !binding.address.includes('.IN')) {
        throw new Error(`Binding is not writable through the XG-SIM channel host: ${bindingId}`);
      }
      if (typeof value !== 'boolean') throw new Error(`XG-SIM host v1 accepts BOOL inputs only: ${bindingId}`);
      values[binding.address] = binding.inverted ? !value : value;
      acceptedBindingIds.push(bindingId);
    }
    await desktopApi().writeInputImage({ values });
    return { acceptedBindingIds: acceptedBindingIds.sort(), rejectedBindingIds: [] };
  }

  async getStatus(): Promise<PlcRuntimeStatus> {
    const raw = await desktopApi().getStatus();
    const connected = raw.state === 'connected' && this.#connection !== null;
    return {
      state: connected ? 'connected' : 'disconnected',
      sessionId: connected ? this.#connection!.sessionId : null,
      projectSha256: connected ? this.#connection!.projectSha256 : null,
      projectIdentityVerified: connected && this.#connection!.projectIdentityVerified,
      lastSequence: this.#sequence,
      lastError: connected && !this.#connection!.projectIdentityVerified
        ? 'The official interface does not expose a verifiable loaded-project identity.'
        : null,
    };
  }

  async disconnect(): Promise<void> {
    await desktopApi().disconnect();
    this.#connection = null;
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
