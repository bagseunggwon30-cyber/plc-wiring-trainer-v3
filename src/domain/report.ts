import type {
  EvidenceLevel,
  TerminalRef,
  VerificationStatus,
  WorkshopDocumentV2,
  DeviceProfile,
} from './types';
import type {
  IssueSeverity,
  ReportEligibility,
  ValidationResult,
} from './engine-types';
import { canonicalStringify, sha256 } from './migration';
import { canIssueVerifiedReport } from './verification';

export type ReviewReportClassification = 'LEGACY_DIAGNOSTIC' | 'DIAGNOSTIC';

export interface ReviewReportDocumentIdentity {
  schemaVersion: 2;
  name: string;
  mode: WorkshopDocumentV2['mode'];
  revision: number;
  hash: string;
  sourceKind: WorkshopDocumentV2['source']['kind'];
  sourceHash: string;
  validationRevision: number;
  validationHash: string;
  validationStatus: VerificationStatus;
  validatedAt: string;
}

export interface ReviewReportProfileInstanceVersion {
  deviceId: string;
  profileVersion: string;
  evidenceLevel: EvidenceLevel;
  missingProfile: boolean;
}

export interface ReviewReportProfileVersion {
  profileId: string;
  catalogVersion: string | null;
  manufacturer: string | null;
  model: string | null;
  catalogEvidenceLevel: EvidenceLevel | null;
  boundary: boolean | null;
  instances: ReviewReportProfileInstanceVersion[];
}

export interface ReviewReportTerminal {
  deviceId: string;
  terminalId: string;
  terminalLabel: string | null;
  profileId: string | null;
  profileVersion: string | null;
}

export interface ReviewReportPinToPinRow {
  rowId: string;
  kind: 'wire' | 'jumper';
  connectionId: string;
  segment: number;
  from: ReviewReportTerminal;
  to: ReviewReportTerminal;
  color: string | null;
  tag: string | null;
  gauge: string | null;
}

export interface ReviewReportDeviceSettings {
  deviceId: string;
  profileId: string;
  profileVersion: string;
  evidenceLevel: EvidenceLevel;
  manufacturer: string | null;
  model: string | null;
  configuration: Record<string, unknown>;
}

export interface ReviewReportBomEntry {
  profileId: string;
  profileVersion: string;
  manufacturer: string | null;
  model: string | null;
  evidenceLevels: EvidenceLevel[];
  quantity: number;
  deviceIds: string[];
}

export interface ReviewReportManualEvidence {
  profileId: string;
  profileVersion: string;
  manufacturer: string;
  model: string;
  evidenceLevel: EvidenceLevel;
  reviewer: string | null;
  reviewedAt: string | null;
  deviceIds: string[];
  documentId: string;
  revision: string;
  pages: number[];
  sha256: string;
  notes: string;
}

export interface ReviewReportIssue {
  code: string;
  severity: IssueSeverity;
  blocking: boolean;
  message: string;
  refs: string[];
  scenarioId: string | null;
  evidence: ReviewReportManualEvidence[];
}

export interface ReviewReport {
  reportSchema: 'plc-prewire-review/1.0';
  reportHash: string;
  classification: ReviewReportClassification;
  eligibility: ReportEligibility;
  document: ReviewReportDocumentIdentity;
  profileVersions: ReviewReportProfileVersion[];
  pinToPin: ReviewReportPinToPinRow[];
  workshopSettings: Record<string, unknown>;
  deviceSettings: ReviewReportDeviceSettings[];
  bom: ReviewReportBomEntry[];
  manualEvidence: ReviewReportManualEvidence[];
  issues: ReviewReportIssue[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalCopy<T>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}

function profileVersions(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): ReviewReportProfileVersion[] {
  const grouped = new Map<string, ReviewReportProfileInstanceVersion[]>();
  for (const device of document.devices) {
    const instances = grouped.get(device.profileId) ?? [];
    instances.push({
      deviceId: device.id,
      profileVersion: device.profileVersion,
      evidenceLevel: device.evidenceLevel,
      missingProfile: device.missingProfile,
    });
    grouped.set(device.profileId, instances);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([profileId, instances]) => {
      const profile = catalog[profileId];
      return {
        profileId,
        catalogVersion: profile?.version ?? null,
        manufacturer: profile?.manufacturer ?? null,
        model: profile?.model ?? null,
        catalogEvidenceLevel: profile?.evidence.level ?? null,
        boundary: profile?.boundary ?? null,
        instances: instances.sort((left, right) => compareText(left.deviceId, right.deviceId)),
      };
    });
}

function terminalDetails(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  ref: TerminalRef,
): ReviewReportTerminal {
  const device = document.devices.find((entry) => entry.id === ref.deviceId);
  const profile = device ? catalog[device.profileId] : undefined;
  const terminal = profile?.terminals.find((entry) => entry.id === ref.terminalId);
  return {
    deviceId: ref.deviceId,
    terminalId: ref.terminalId,
    terminalLabel: terminal?.label ?? null,
    profileId: device?.profileId ?? null,
    profileVersion: device?.profileVersion ?? null,
  };
}

function pinToPinRows(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): ReviewReportPinToPinRow[] {
  const rows: ReviewReportPinToPinRow[] = document.wires.map((wire) => ({
    rowId: `wire:${wire.id}`,
    kind: 'wire',
    connectionId: wire.id,
    segment: 1,
    from: terminalDetails(document, catalog, wire.from),
    to: terminalDetails(document, catalog, wire.to),
    color: wire.color ?? null,
    tag: wire.tag ?? null,
    gauge: wire.gauge ?? null,
  }));

  for (const jumper of document.jumpers) {
    const [first, ...rest] = jumper.terminalIds;
    if (!first) continue;
    for (const [index, terminalId] of rest.entries()) {
      rows.push({
        rowId: `jumper:${jumper.id}:${index + 1}`,
        kind: 'jumper',
        connectionId: jumper.id,
        segment: index + 1,
        from: terminalDetails(document, catalog, { deviceId: jumper.deviceId, terminalId: first }),
        to: terminalDetails(document, catalog, { deviceId: jumper.deviceId, terminalId }),
        color: null,
        tag: null,
        gauge: null,
      });
    }
  }

  return rows.sort((left, right) => compareText(left.rowId, right.rowId));
}

function deviceSettings(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): ReviewReportDeviceSettings[] {
  return document.devices
    .filter((device) => catalog[device.profileId]?.boundary !== true)
    .map((device) => {
      const profile = catalog[device.profileId];
      return {
        deviceId: device.id,
        profileId: device.profileId,
        profileVersion: device.profileVersion,
        evidenceLevel: device.evidenceLevel,
        manufacturer: profile?.manufacturer ?? null,
        model: profile?.model ?? null,
        configuration: canonicalCopy(device.configuration),
      };
    })
    .sort((left, right) => compareText(left.deviceId, right.deviceId));
}

function bom(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): ReviewReportBomEntry[] {
  const groups = new Map<string, ReviewReportBomEntry>();
  for (const device of document.devices) {
    const profile = catalog[device.profileId];
    if (profile?.boundary === true || profile?.includeInBom === false) continue;
    const key = `${device.profileId}\u0000${device.profileVersion}`;
    const current = groups.get(key);
    if (current) {
      current.quantity += 1;
      current.deviceIds.push(device.id);
      if (!current.evidenceLevels.includes(device.evidenceLevel)) current.evidenceLevels.push(device.evidenceLevel);
    } else {
      groups.set(key, {
        profileId: device.profileId,
        profileVersion: device.profileVersion,
        manufacturer: profile?.manufacturer ?? null,
        model: profile?.model ?? null,
        evidenceLevels: [device.evidenceLevel],
        quantity: 1,
        deviceIds: [device.id],
      });
    }
  }
  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      evidenceLevels: entry.evidenceLevels.sort(compareText),
      deviceIds: entry.deviceIds.sort(compareText),
    }))
    .sort((left, right) => compareText(`${left.profileId}\u0000${left.profileVersion}`, `${right.profileId}\u0000${right.profileVersion}`));
}

function manualEvidence(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): ReviewReportManualEvidence[] {
  const deviceIdsByProfile = new Map<string, string[]>();
  for (const device of document.devices) {
    const ids = deviceIdsByProfile.get(device.profileId) ?? [];
    ids.push(device.id);
    deviceIdsByProfile.set(device.profileId, ids);
  }

  const records: ReviewReportManualEvidence[] = [];
  for (const [profileId, deviceIds] of deviceIdsByProfile) {
    const profile = catalog[profileId];
    if (!profile) continue;
    for (const documentEvidence of profile.evidence.documents) {
      records.push({
        profileId,
        profileVersion: profile.version,
        manufacturer: profile.manufacturer,
        model: profile.model,
        evidenceLevel: profile.evidence.level,
        reviewer: profile.evidence.reviewer ?? null,
        reviewedAt: profile.evidence.reviewedAt ?? null,
        deviceIds: [...deviceIds].sort(compareText),
        documentId: documentEvidence.documentId,
        revision: documentEvidence.revision,
        pages: [...documentEvidence.pages],
        sha256: documentEvidence.sha256,
        notes: documentEvidence.notes,
      });
    }
  }
  return records.sort((left, right) => compareText(
    `${left.profileId}\u0000${left.documentId}\u0000${left.revision}`,
    `${right.profileId}\u0000${right.documentId}\u0000${right.revision}`,
  ));
}

function devicesReferencedByIssue(document: WorkshopDocumentV2, refs: readonly string[]): Set<string> {
  const deviceIds = new Set(document.devices.map((device) => device.id));
  const wireById = new Map(document.wires.map((wire) => [wire.id, wire]));
  const jumperById = new Map(document.jumpers.map((jumper) => [jumper.id, jumper]));
  const resolved = new Set<string>();

  for (const ref of refs) {
    if (deviceIds.has(ref)) resolved.add(ref);
    const devicePrefix = ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : ref;
    if (deviceIds.has(devicePrefix)) resolved.add(devicePrefix);
    const wire = wireById.get(ref);
    if (wire) {
      resolved.add(wire.from.deviceId);
      resolved.add(wire.to.deviceId);
    }
    const jumper = jumperById.get(ref);
    if (jumper) resolved.add(jumper.deviceId);
  }
  return resolved;
}

function reportIssues(
  document: WorkshopDocumentV2,
  validation: ValidationResult,
  evidence: readonly ReviewReportManualEvidence[],
): ReviewReportIssue[] {
  return validation.issues.map((issue) => {
    const referencedDevices = devicesReferencedByIssue(document, issue.refs);
    return {
      code: issue.code,
      severity: issue.severity,
      blocking: issue.blocking,
      message: issue.message,
      refs: [...issue.refs],
      scenarioId: issue.scenarioId ?? null,
      evidence: evidence
        .filter((entry) => entry.deviceIds.some((deviceId) => referencedDevices.has(deviceId)))
        .map((entry) => canonicalCopy(entry)),
    };
  });
}

/**
 * Creates a deterministic, serializable review snapshot. It does not mutate the
 * document, validation result, or profile catalog and does not read wall-clock state.
 */
export async function generateReviewReport(
  document: WorkshopDocumentV2,
  validation: ValidationResult,
  catalog: Readonly<Record<string, DeviceProfile>>,
): Promise<ReviewReport> {
  const [documentHash, eligibility] = await Promise.all([
    sha256(document),
    canIssueVerifiedReport(document, validation, catalog),
  ]);
  const evidence = manualEvidence(document, catalog);
  const payload: Omit<ReviewReport, 'reportHash'> = {
    reportSchema: 'plc-prewire-review/1.0',
    classification: 'LEGACY_DIAGNOSTIC',
    eligibility: { ...eligibility },
    document: {
      schemaVersion: document.schemaVersion,
      name: document.name,
      mode: document.mode,
      revision: document.revision,
      hash: documentHash,
      sourceKind: document.source.kind,
      sourceHash: document.source.hash,
      validationRevision: validation.documentRevision,
      validationHash: validation.documentHash,
      validationStatus: validation.status,
      validatedAt: validation.checkedAt,
    },
    profileVersions: profileVersions(document, catalog),
    pinToPin: pinToPinRows(document, catalog),
    workshopSettings: canonicalCopy(document.settings),
    deviceSettings: deviceSettings(document, catalog),
    bom: bom(document, catalog),
    manualEvidence: evidence,
    issues: reportIssues(document, validation, evidence),
  };
  return { ...payload, reportHash: await sha256(payload) };
}

export function serializeReviewReport(report: ReviewReport): string {
  return canonicalStringify(report);
}
