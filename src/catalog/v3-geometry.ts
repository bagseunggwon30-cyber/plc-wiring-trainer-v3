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

export interface TerminalCenterObservationV3 {
  readonly terminalId: string;
  /** Manual-overlay or independently measured reference centre in CSS pixels. */
  readonly reference: { readonly x: number; readonly y: number };
  /** Centre reported by the rendered pointer target in the same coordinate space. */
  readonly observed: { readonly x: number; readonly y: number };
}

export interface TerminalCenterCalibrationThresholdsV3 {
  readonly rmsPx: number;
  readonly maxPx: number;
}

export interface TerminalCenterCalibrationResultV3 {
  readonly ok: boolean;
  readonly sampleCount: number;
  readonly rmsErrorPx: number;
  readonly maxErrorPx: number;
  readonly worstTerminalId: string | null;
  readonly errors: readonly { readonly terminalId: string; readonly errorPx: number }[];
  readonly thresholds: TerminalCenterCalibrationThresholdsV3;
}

export interface TerminalGeometryParity {
  readonly ok: boolean;
  readonly missingTerminalIds: readonly string[];
  readonly hiddenTerminalIds: readonly string[];
  readonly extraTerminalIds: readonly string[];
  readonly duplicateTerminalIds: readonly string[];
}

export const DEFAULT_TERMINAL_CENTER_THRESHOLDS_V3: TerminalCenterCalibrationThresholdsV3 = {
  rmsPx: 3,
  maxPx: 5,
};

/**
 * Calculates pointer-centre error without rounding individual observations.
 * An empty observation set is never a passing calibration.
 */
export function measureTerminalCenterCalibration(
  observations: readonly TerminalCenterObservationV3[],
  thresholds: TerminalCenterCalibrationThresholdsV3 = DEFAULT_TERMINAL_CENTER_THRESHOLDS_V3,
): TerminalCenterCalibrationResultV3 {
  const errors = observations.map((observation) => {
    const dx = observation.observed.x - observation.reference.x;
    const dy = observation.observed.y - observation.reference.y;
    return { terminalId: observation.terminalId, errorPx: Math.hypot(dx, dy) };
  });
  const squaredErrorSum = errors.reduce((sum, item) => sum + item.errorPx ** 2, 0);
  const rmsErrorPx = errors.length === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(squaredErrorSum / errors.length);
  const worst = errors.reduce<(typeof errors)[number] | null>(
    (current, item) => current === null || item.errorPx > current.errorPx ? item : current,
    null,
  );
  const maxErrorPx = worst?.errorPx ?? Number.POSITIVE_INFINITY;
  return {
    ok: errors.length > 0 && rmsErrorPx <= thresholds.rmsPx && maxErrorPx <= thresholds.maxPx,
    sampleCount: errors.length,
    rmsErrorPx,
    maxErrorPx,
    worstTerminalId: worst?.terminalId ?? null,
    errors,
    thresholds,
  };
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
