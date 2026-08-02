import {
  IoBindingV1Schema,
  PlcRuntimeConnectRequestSchema,
  isWritableRuntimeBinding,
  type IoBindingV1,
} from './io-binding';
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
} from './contracts';

export interface MockPlcResolverContext {
  inputs: Readonly<Record<string, PlcRuntimeValue>>;
  previousOutputs: Readonly<Record<string, PlcRuntimeValue>>;
}

export type MockPlcResolver = (context: MockPlcResolverContext) => Readonly<Record<string, PlcRuntimeValue>>;

function isoTimestamp(): string {
  return new Date().toISOString();
}

export class MockPlcRuntimeAdapter implements PlcRuntimeAdapter {
  readonly #resolver: MockPlcResolver;
  #bindings = new Map<string, IoBindingV1>();
  #inputs: Record<string, PlcRuntimeValue> = {};
  #outputs: Record<string, PlcRuntimeValue> = {};
  #monitors: Record<string, PlcRuntimeValue> = {};
  #sequence = 0;
  #status: PlcRuntimeStatus = {
    state: 'disconnected', sessionId: null, projectSha256: null, projectIdentityVerified: false, lastSequence: 0, lastError: null,
  };

  constructor(resolver: MockPlcResolver = () => ({})) {
    this.#resolver = resolver;
  }

  async probe(_request: PlcRuntimeProbeRequest): Promise<PlcRuntimeProbeResult> {
    return {
      status: 'available',
      capabilities: {
        provider: 'mock', protocolVersion: 1, supportsInputChannels: true,
        supportsOutputChannels: true, supportsDeviceRead: true,
        supportsOutputWrite: false, supportsProjectIdentityVerification: true, maximumBindings: 256,
      },
      channelNames: [],
    };
  }

  async connect(rawRequest: Parameters<PlcRuntimeAdapter['connect']>[0]): Promise<PlcRuntimeConnection> {
    const request = PlcRuntimeConnectRequestSchema.parse(rawRequest);
    this.#bindings = new Map(request.bindings.map((entry) => [entry.id, IoBindingV1Schema.parse(entry)]));
    this.#inputs = {};
    this.#outputs = {};
    this.#monitors = {};
    for (const binding of this.#bindings.values()) {
      if (binding.direction === 'input' || binding.direction === 'internal-request') this.#inputs[binding.id] = binding.normalState;
      else if (binding.direction === 'output') this.#outputs[binding.id] = binding.normalState;
      else this.#monitors[binding.id] = binding.normalState;
    }
    this.#sequence = 0;
    const sessionId = `mock:${request.sessionNonce}`;
    this.#status = {
      state: 'running', sessionId, projectSha256: request.projectSha256, projectIdentityVerified: true, lastSequence: 0, lastError: null,
    };
    return { sessionId, connectedAt: isoTimestamp(), projectSha256: request.projectSha256, projectIdentityVerified: true };
  }

  async readSnapshot(): Promise<PlcRuntimeSnapshot> {
    this.#assertConnected();
    const resolved = this.#resolver({ inputs: { ...this.#inputs }, previousOutputs: { ...this.#outputs } });
    for (const [bindingId, value] of Object.entries(resolved)) {
      const binding = this.#bindings.get(bindingId);
      if (!binding || binding.direction !== 'output') throw new Error(`Resolver returned unknown output binding: ${bindingId}`);
      this.#outputs[bindingId] = value;
    }
    this.#sequence += 1;
    this.#status = { ...this.#status, lastSequence: this.#sequence };
    return Object.freeze({
      sequence: this.#sequence,
      capturedAt: isoTimestamp(),
      inputs: Object.freeze({ ...this.#inputs }),
      outputs: Object.freeze({ ...this.#outputs }),
      monitors: Object.freeze({ ...this.#monitors }),
    });
  }

  async writeInputImage(image: PlcInputImage): Promise<PlcInputWriteResult> {
    this.#assertConnected();
    const accepted: string[] = [];
    for (const [bindingId, value] of Object.entries(image.values)) {
      const binding = this.#bindings.get(bindingId);
      if (!binding || !isWritableRuntimeBinding(binding)) throw new Error(`Binding is not writable: ${bindingId}`);
      if (binding.dataType === 'BOOL' ? typeof value !== 'boolean' : typeof value !== 'number') {
        throw new Error(`Binding value type mismatch: ${bindingId}`);
      }
      this.#inputs[bindingId] = binding.inverted && typeof value === 'boolean' ? !value : value;
      accepted.push(bindingId);
    }
    return { acceptedBindingIds: accepted.sort(), rejectedBindingIds: [] };
  }

  async getStatus(): Promise<PlcRuntimeStatus> {
    return { ...this.#status };
  }

  async disconnect(): Promise<void> {
    for (const binding of this.#bindings.values()) {
      if (binding.direction === 'input' || binding.direction === 'internal-request') {
        this.#inputs[binding.id] = binding.communicationLossState;
      } else if (binding.direction === 'output') {
        this.#outputs[binding.id] = binding.communicationLossState;
      }
    }
    this.#status = {
      state: 'disconnected', sessionId: null, projectSha256: null, projectIdentityVerified: false,
      lastSequence: this.#sequence, lastError: null,
    };
  }

  #assertConnected(): void {
    if (this.#status.state === 'disconnected') throw new Error('PLC runtime is not connected.');
  }
}
