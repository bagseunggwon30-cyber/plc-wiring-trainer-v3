export type EvidenceLevel = 'educational' | 'manual-verified' | 'bench-verified';
export type VerificationStatus = 'PASS' | 'FAIL' | 'BLOCKED';
export type WorkshopMode = 'practice' | 'prewire';
export type ElectricalDomain = 'ac' | 'dc' | 'pe' | 'signal' | 'communication' | 'floating';
export type ElectricalPotential = 'L1' | 'L2' | 'L3' | 'N' | '+24V' | '0V' | 'PE' | 'floating' | 'signal';
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
  phase?: 'L1' | 'L2' | 'L3' | 'N';
  comGroup?: string;
  channel?: string;
  protocol?: 'RS232' | 'RS485' | 'analog-voltage' | 'analog-current';
  ratedVoltage?: RatedVoltageRange;
}

export interface InternalLinkSpec {
  from: string;
  to: string;
  kind: 'conductive' | 'dynamic-contact';
  stateKey?: string;
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

