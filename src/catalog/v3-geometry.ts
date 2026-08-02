import type { DeviceProfileV3, EvidenceV3 } from './v3-profiles';

export interface TerminalGeometryV3 {
  readonly terminalId: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly visible: boolean;
}

/**
 * A renderer-owned observation of the terminal geometry actually shown to a user.
 * It intentionally carries the rendered asset identity so an approved catalog asset
 * cannot be substituted after geometry was captured.
 */
export interface TerminalGeometrySnapshotV3 {
  readonly deviceId: string;
  readonly profileId: string;
  readonly assetId: string;
  readonly geometryHash: string;
  readonly terminals: readonly TerminalGeometryV3[];
}

export interface TerminalGeometrySnapshotInputV3 {
  readonly snapshots: readonly TerminalGeometrySnapshotV3[];
}

export interface ApprovedTerminalGeometryParity extends TerminalGeometryParity {
  readonly approved: boolean;
}

export interface TerminalGeometryParity {
  readonly ok: boolean;
  readonly missingTerminalIds: readonly string[];
  readonly hiddenTerminalIds: readonly string[];
  readonly extraTerminalIds: readonly string[];
  readonly duplicateTerminalIds: readonly string[];
}

export type V3CalibrationOverride =
  | { readonly kind: 'geometry'; readonly terminalId: string; readonly anchor: { readonly x: number; readonly y: number }; readonly hitRadius: number }
  | { readonly kind: 'terminal-add' | 'terminal-delete' | 'terminal-id' | 'electrical' | 'internal-link'; readonly terminalId?: string };

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function checkTerminalGeometryParity(
  profile: DeviceProfileV3,
  geometry: readonly TerminalGeometryV3[],
): TerminalGeometryParity {
  const profileTerminalIds = new Set(profile.terminals.map((terminal) => terminal.id));
  const geometryTerminalIds = new Set(geometry.map((terminal) => terminal.terminalId));
  const seen = new Set<string>();
  const duplicateTerminalIds: string[] = [];

  for (const terminal of geometry) {
    if (seen.has(terminal.terminalId)) duplicateTerminalIds.push(terminal.terminalId);
    seen.add(terminal.terminalId);
  }

  const missingTerminalIds = [...profileTerminalIds].filter((terminalId) => !geometryTerminalIds.has(terminalId)).sort();
  const hiddenTerminalIds = geometry
    .filter((terminal) => profileTerminalIds.has(terminal.terminalId) && !terminal.visible)
    .map((terminal) => terminal.terminalId);
  const extraTerminalIds = geometry
    .filter((terminal) => !profileTerminalIds.has(terminal.terminalId))
    .map((terminal) => terminal.terminalId);
  const result = {
    missingTerminalIds,
    hiddenTerminalIds: sortedUnique(hiddenTerminalIds),
    extraTerminalIds: sortedUnique(extraTerminalIds),
    duplicateTerminalIds: sortedUnique(duplicateTerminalIds),
  };

  return {
    ok: Object.values(result).every((terminalIds) => terminalIds.length === 0),
    ...result,
  };
}

/** Combines exact terminal-set parity with the renderer asset/geometry approval boundary. */
export function checkApprovedTerminalGeometryParity(
  profile: DeviceProfileV3,
  snapshot: TerminalGeometrySnapshotV3 | undefined,
  isApproved: (assetId: string, geometryHash: string) => boolean,
): ApprovedTerminalGeometryParity {
  if (snapshot === undefined || snapshot.profileId !== profile.profileId) {
    return {
      ok: false,
      approved: false,
      missingTerminalIds: profile.terminals.map((terminal) => terminal.id).sort(),
      hiddenTerminalIds: [],
      extraTerminalIds: [],
      duplicateTerminalIds: [],
    };
  }
  const parity = checkTerminalGeometryParity(profile, snapshot.terminals);
  const approved = isApproved(snapshot.assetId, snapshot.geometryHash);
  return { ...parity, approved, ok: parity.ok && approved };
}

function structuralOverrideEvidence(override: V3CalibrationOverride): EvidenceV3 {
  return {
    grade: 'educational',
    documents: [],
    note: `Structural calibration override (${override.kind}); prior manual and asset calibration evidence no longer applies.`,
  };
}

/** Coordinates can be calibrated without changing the electrical contract; structural changes cannot. */
export function applyV3CalibrationOverride(profile: DeviceProfileV3, override: V3CalibrationOverride): DeviceProfileV3 {
  if (override.kind === 'geometry') return profile;
  return {
    ...profile,
    profileId: `${profile.profileId}:local:${override.kind}`,
    evidence: structuralOverrideEvidence(override),
  };
}
