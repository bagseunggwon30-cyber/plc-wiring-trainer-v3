export type EvidenceLevel = 'educational' | 'manual-verified' | 'bench-verified';
export type VerificationStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'STALE';
export type WorkshopMode = 'practice' | 'prewire';
export type ElectricalDomain = 'ac' | 'dc' | 'pe' | 'signal' | 'communication' | 'floating';
export type ElectricalPotential = 'L1' | 'L2' | 'L3' | 'N' | '+24V' | '0V' | 'PE' | 'floating' | 'signal';
export type TerminalPolarity =
  | 'line'
  | 'neutral'
  | 'positive'
  | 'return'
  | 'protective-earth'
  | 'configurable'
  | 'nonpolar'
  | 'signal-positive'
  | 'signal-return'
  | 'data-positive'
  | 'data-negative'
  | 'reference'
  | 'none';
export type TerminalCommonType =
  | 'configurable-dc'
  | 'dc-control-common'
  | 'dc-output-common'
  | 'dry-contact'
  | 'analog-reference'
  | 'communication-reference'
  | 'power-pass-through'
  | 'fused-power';
export type TerminalRole =
  | 'source'
  | 'supply-input'
  | 'input'
  | 'output'
  | 'common'
  | 'protective-earth'
  | 'dry-contact'
  | 'communication'
  | 'not-connected';
export type DigitalInputLogicMode =
  | 'configurable'
  | 'npn-internal-24v'
  | 'pnp-external-24v';

export interface EvidenceDocument {
  documentId: string;
  revision: string;
  pages: number[];
  sha256: string;
  notes: string;
}

export interface ProfileEvidence {
  level: EvidenceLevel;
  documents: EvidenceDocument[];
  reviewer?: string;
  reviewedAt?: string;
  note?: string;
}

export interface RatedVoltageRange {
  min: number;
  max: number;
  unit: 'VAC' | 'VDC';
}

export interface TerminalSpec {
  id: string;
  label: string;
  domain: ElectricalDomain;
  potential: ElectricalPotential;
  role: TerminalRole;
  polarity: TerminalPolarity;
  commonType?: TerminalCommonType;
  phase?: 'L1' | 'L2' | 'L3' | 'N' | 'U' | 'V' | 'W';
  comGroup?: string;
  channel?: string;
  protocol?: 'RS232' | 'RS485' | 'analog-voltage' | 'analog-current';
  outputMode?: 'relay' | 'sinking-transistor' | 'sourcing-transistor';
  /**
   * Physical selector-dependent input circuit. `inputActivationPotential`
   * records the voltage that must reach this terminal after the selector is
   * resolved; it is not inferred from a DI label.
   */
  inputLogicMode?: DigitalInputLogicMode;
  inputActivationPotential?: '+24V' | '0V';
  ratedVoltage?: RatedVoltageRange;
  maxConductors?: number;
  conductorRangeMm2?: { min: number; max: number };
  tighteningTorqueNm?: { min: number; max: number };
  strippingLengthMm?: number;
}

export interface InternalLinkSpec {
  from: string;
  to: string;
  kind: 'conductive' | 'dynamic-contact';
  stateKey?: string;
  normally?: 'open' | 'closed';
}

export interface DeviceProfile {
  profileId: string;
  version: string;
  manufacturer: string;
  model: string;
  variant?: string;
  evidence: ProfileEvidence;
  boundary: boolean;
  includeInBom: boolean;
  terminals: TerminalSpec[];
  internalLinks: InternalLinkSpec[];
  behavior?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface TerminalRef {
  deviceId: string;
  terminalId: string;
}

export interface DeviceInstanceV2 {
  id: string;
  profileId: string;
  profileVersion: string;
  evidenceLevel: EvidenceLevel;
  legacyType?: string;
  missingProfile: boolean;
  x: number;
  y: number;
  rotation: number;
  configuration: Record<string, unknown>;
}

export interface WireV2 {
  id: string;
  from: TerminalRef;
  to: TerminalRef;
  color?: string;
  tag?: string;
  gauge?: string;
  waypoints?: Array<{ x: number; y: number }>;
}

export interface JumperV2 {
  id: string;
  deviceId: string;
  terminalIds: string[];
}

export interface WorkshopDocumentV2 {
  schemaVersion: 2;
  mode: WorkshopMode;
  revision: number;
  name: string;
  source: {
    kind: 'native-v2' | 'legacy-v1';
    hash: string;
  };
  devices: DeviceInstanceV2[];
  wires: WireV2[];
  jumpers: JumperV2[];
  layout: Record<string, unknown>;
  settings: Record<string, unknown>;
  extensions: {
    legacy: Record<string, unknown>;
  };
}

export interface MigrationIssue {
  code: string;
  message: string;
}

export type MigrationResult =
  | { ok: true; migrated: boolean; document: WorkshopDocumentV2; issues: MigrationIssue[] }
  | { ok: false; status: 'BLOCKED'; issues: MigrationIssue[] };

export type ProfileOverride =
  | { kind: 'geometry'; terminalId: string; anchor: { x: number; y: number }; hitRadius: number }
  | { kind: 'terminal-add' | 'terminal-delete' | 'terminal-id' | 'electrical' | 'internal-link' };
