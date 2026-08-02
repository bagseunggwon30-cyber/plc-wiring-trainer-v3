import type { DeviceProfile, WorkshopDocumentV2 } from './types';
import type { ReportEligibility, ValidationResult } from './engine-types';
import { sha256 } from './migration';

export const LEGACY_V2_VERIFIED_REPORTS_SUSPENDED = true;
export const LEGACY_V2_DIAGNOSTIC_REASON =
  'Legacy v2 validation is diagnostic-only; rerun the review with the v3 closed-loop engine.';

export async function canIssueVerifiedReport(
  document: WorkshopDocumentV2,
  validation: ValidationResult,
  catalog: Readonly<Record<string, DeviceProfile>>,
): Promise<ReportEligibility> {
  const currentHash = await sha256(document);
  if (validation.documentRevision !== document.revision || validation.documentHash !== currentHash) {
    return { eligible: false, status: 'STALE', reason: 'Document changed after validation.' };
  }
  if (LEGACY_V2_VERIFIED_REPORTS_SUSPENDED) {
    return { eligible: false, status: 'BLOCKED', reason: LEGACY_V2_DIAGNOSTIC_REASON };
  }
  if (validation.status !== 'PASS') {
    return { eligible: false, status: validation.status, reason: 'Validation did not pass.' };
  }
  if (document.mode !== 'prewire') {
    return { eligible: false, status: 'BLOCKED', reason: 'Verified reports require prewire mode.' };
  }
  for (const instance of document.devices) {
    const profile = catalog[instance.profileId];
    if (
      !profile
      || instance.missingProfile
      || instance.profileVersion !== profile.version
      || (!profile.boundary && (profile.evidence.level === 'educational' || instance.evidenceLevel === 'educational'))
    ) {
      return { eligible: false, status: 'BLOCKED', reason: `Profile ${instance.profileId} is not verified.` };
    }
  }
  return { eligible: true, status: 'PASS', reason: null };
}
