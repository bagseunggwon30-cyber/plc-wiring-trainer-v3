import type { DeviceProfile, ElectricalPotential, TerminalRef, TerminalSpec, VerificationStatus } from './types';

export type CircuitEdgeKind = 'wire' | 'jumper' | 'internal' | 'dynamic-contact';
export type IssueSeverity = 'danger' | 'function' | 'quality' | 'blocked';

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  blocking: boolean;
  message: string;
  refs: string[];
  scenarioId?: string;
}

export interface CircuitNode {
  key: string;
  deviceId: string;
  terminalId: string;
  terminal: TerminalSpec;
  profile: DeviceProfile;
}

export interface CircuitEdge {
  id: string;
  kind: CircuitEdgeKind;
  from: string;
  to: string;
  active: boolean;
}

export interface CircuitGraph {
  nodes: Map<string, CircuitNode>;
  edges: CircuitEdge[];
  issues: ValidationIssue[];
}

export interface RuntimeState {
  contactStates?: Record<string, boolean>;
  forcedOutputs?: Record<string, string[]>;
  poweredDevices?: string[];
}

export interface ContactRule {
  stateKey: string;
  sense: TerminalRef;
  mode: 'closed-when-energized' | 'closed-when-deenergized';
}

export interface SimulationScenario extends RuntimeState {
  id: string;
  contactRules?: ContactRule[];
}

export interface PowerToken {
  potential: ElectricalPotential;
  sourceId: string;
}

export interface PowerResolution {
  componentOf: Map<string, string>;
  componentTokens: Map<string, PowerToken[]>;
  activeDevices: Set<string>;
  energizedTerminals: Set<string>;
}

export interface ValidationResult {
  status: VerificationStatus;
  issues: ValidationIssue[];
  documentRevision: number;
  documentHash: string;
  checkedAt: string;
}

export interface SimulationResult {
  scenarioId: string;
  status: VerificationStatus;
  converged: boolean;
  iterations: number;
  energizedTerminals: string[];
  inputStates: Record<string, Record<string, boolean>>;
  outputStates: Record<string, Record<string, boolean>>;
  validation: ValidationResult;
}

export interface ReportEligibility {
  eligible: boolean;
  status: VerificationStatus | 'STALE';
  reason: string | null;
}
