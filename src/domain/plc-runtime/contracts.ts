import type { IoBindingV1 } from './io-binding';

export type PlcDataTypeV1 = 'BOOL' | 'WORD' | 'DWORD' | 'REAL';
export type PlcRuntimeValue = boolean | number;
export type PlcRuntimeState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'running'
  | 'paused'
  | 'faulted'
  | 'blocked';

export interface PlcRuntimeCapabilities {
  provider: 'mock' | 'xgsim';
  protocolVersion: number;
  supportsInputChannels: boolean;
  supportsOutputChannels: boolean;
  supportsDeviceRead: boolean;
  supportsOutputWrite: false;
  supportsProjectIdentityVerification: boolean;
  maximumBindings: number;
}

export interface PlcRuntimeProbeRequest {
  base: number;
  slot: number;
}

export interface PlcRuntimeProbeResult {
  status: 'available' | 'blocked';
  capabilities: PlcRuntimeCapabilities;
  channelNames: readonly string[];
  reason?: string;
}

export interface PlcRuntimeConnectRequest {
  sessionNonce: string;
  cpuModel: string;
  projectId: string;
  projectSha256: string;
  base: number;
  slot: number;
  bindings: readonly IoBindingV1[];
}

export interface PlcRuntimeConnection {
  sessionId: string;
  connectedAt: string;
  projectSha256: string;
  projectIdentityVerified: boolean;
  /** Echoed by the native host. Missing values keep the session diagnostic-only. */
  sessionNonce?: string;
  /** Changes whenever the native host process/session generation changes. */
  hostEpoch?: string;
}

export interface PlcRuntimeSnapshot {
  sequence: number;
  capturedAt: string;
  /** Native-host session evidence. Required by authoritative consumers. */
  sessionId?: string;
  sessionNonce?: string;
  hostEpoch?: string;
  projectSha256?: string;
  inputs: Readonly<Record<string, PlcRuntimeValue>>;
  outputs: Readonly<Record<string, PlcRuntimeValue>>;
  monitors: Readonly<Record<string, PlcRuntimeValue>>;
}

export interface PlcInputImage {
  values: Readonly<Record<string, PlcRuntimeValue>>;
}

export interface PlcInputWriteResult {
  acceptedBindingIds: readonly string[];
  rejectedBindingIds: readonly string[];
}

export interface PlcRuntimeStatus {
  state: PlcRuntimeState;
  sessionId: string | null;
  projectSha256: string | null;
  projectIdentityVerified: boolean;
  lastSequence: number;
  lastError: string | null;
}

export interface PlcRuntimeAdapter {
  probe(request: PlcRuntimeProbeRequest): Promise<PlcRuntimeProbeResult>;
  connect(request: PlcRuntimeConnectRequest): Promise<PlcRuntimeConnection>;
  readSnapshot(): Promise<PlcRuntimeSnapshot>;
  writeInputImage(image: PlcInputImage): Promise<PlcInputWriteResult>;
  getStatus(): Promise<PlcRuntimeStatus>;
  disconnect(): Promise<void>;
}

export interface RuntimeIssueV1 {
  code: string;
  message: string;
  bindingIds: readonly string[];
  blocking: boolean;
}

export interface RuntimeFrame<TCircuitSolution = unknown> {
  frameNumber: number;
  capturedAt: string;
  workshopRevision: number;
  workshopHash: string;
  sessionId: string;
  projectSha256: string;
  plcInputs: Readonly<Record<string, PlcRuntimeValue>>;
  plcOutputs: Readonly<Record<string, PlcRuntimeValue>>;
  circuitSolution: TCircuitSolution;
  deviceStates: Readonly<Record<string, string>>;
  issues: readonly RuntimeIssueV1[];
  elapsedMs: number;
  retryCount: number;
}

export type FunctionalSimulationStatusV1 =
  | 'PREWIRE_PASS'
  | 'PLC_SIM_PASS'
  | 'DEVICE_SIM_PASS'
  | 'SIL_PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'STALE';
