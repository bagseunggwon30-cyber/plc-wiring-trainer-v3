import { DEVICE_PROFILES } from '../../catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../catalog/v3-profiles';
import type { IssueSeverity, ValidationIssue, ValidationResult } from '../../domain/engine-types';
import { PUBLIC_MISSIONS } from '../../domain/missions';
import {
  buildPrewireCircuitV3,
  canIssueVerifiedReportV3,
  evaluateMissionV3,
  validatePhysicalPrewireV3,
  validatePrewireDocumentV3,
  type CircuitIssueV3,
} from '../../domain/v3';
import type { V3ValidationRequest, V3ValidationResult } from './validation-port';

export type SerializableV3ValidationRequest = Omit<V3ValidationRequest, 'validateLegacy'>;

const BLOCKED_CODES = new Set<CircuitIssueV3['code']>([
  'REVIEW_SCOPE_INCOMPLETE', 'SOURCE_SYSTEM_REQUIRED', 'EARTHING_POLICY_REQUIRED', 'ORDER_CODE_REQUIRED',
  'ORDER_CODE_MISMATCH', 'PROFILE_EVIDENCE_INELIGIBLE', 'PROFILE_NOT_V3', 'ASSET_GEOMETRY_UNAPPROVED',
  'TERMINAL_GEOMETRY_MISMATCH', 'XBF_CONFIGURATION_INCOMPLETE', 'XBF_SELECTOR_RANGE_MISMATCH',
  'IG5A_INPUT_LOGIC_REQUIRED', 'IG5A_CONTROL_POWER_STATE_REQUIRED', 'INPUT_LOGIC_MODE_REQUIRED',
  'EOCR_CONFIGURATION_INCOMPLETE', 'FUSE_LINK_REQUIRED', 'FUSE_LINK_PROFILE_UNVERIFIED',
  'NO_INSTALLED_EQUIPMENT', 'DESIGNATION_REQUIRED', 'CONDUCTOR_IDENTIFICATION_REQUIRED',
  'CONDUCTOR_SIZE_REQUIRED', 'TERMINAL_ASSEMBLY_DATA_INCOMPLETE', 'UNKNOWN_TERMINAL',
  'DUPLICATE_ELEMENT_ID', 'NON_CONVERGENT_SIMULATION', 'PROTECTION_COORDINATION_BLOCKED',
  'PROFILE_VERSION_MISMATCH', 'INVALID_CONTACT_RULE',
]);

const DANGER_CODES = new Set<CircuitIssueV3['code']>([
  'DC_SHORT', 'AC_PHASE_NEUTRAL_SHORT', 'AC_PHASE_PHASE_SHORT', 'AC_PHASE_PE_FAULT',
  'LOAD_REVERSED', 'PARALLEL_SOURCE', 'PE_MISSING', 'PE_AS_WORKING_RETURN',
  'EARTHING_POLICY_BOND_COUNT', 'TERMINAL_DOMAIN_MISMATCH', 'TERMINAL_POLARITY_MISMATCH',
  'AC_LINE_NEUTRAL_MISMATCH', 'AC_PHASE_MISMATCH', 'AC_MAINS_DRIVE_OUTPUT_CONFLICT',
  'DC_POLARITY_MISMATCH', 'PE_TERMINAL_MISUSE', 'COMMON_ROLE_MISMATCH',
  'TERMINAL_SOURCE_CONFLICT',
  'ANALOG_SIGNAL_SHORT', 'ANALOG_POLARITY_REVERSED',
  'CURRENT_LOOP_POLARITY_REVERSED', 'CURRENT_LOOP_OVER_RANGE',
]);

function severity(issue: CircuitIssueV3): IssueSeverity {
  if (BLOCKED_CODES.has(issue.code)) return 'blocked';
  if (DANGER_CODES.has(issue.code)) return 'danger';
  return 'function';
}

function rendererIssue(issue: CircuitIssueV3): ValidationIssue {
  return { code: issue.code, severity: severity(issue), blocking: issue.blocking, message: issue.message, refs: [...issue.refs] };
}

/** Pure, serializable v3 validation operation shared by the Worker and unit tests. */
export async function validateDomainV3(request: SerializableV3ValidationRequest): Promise<V3ValidationResult> {
  const built = await buildPrewireCircuitV3(
    request.document,
    DEVICE_PROFILES,
    DEVICE_PROFILES_V3,
    undefined,
    request.terminalGeometry,
  );
  const result = validatePrewireDocumentV3(built);
  const missionId = typeof request.document.settings.missionId === 'string' ? request.document.settings.missionId : null;
  const mission = PUBLIC_MISSIONS.find((entry) => entry.id === missionId);
  const rawBindings = request.document.settings.roleBindings;
  const bindings = rawBindings && typeof rawBindings === 'object' && !Array.isArray(rawBindings)
    ? Object.fromEntries(Object.entries(rawBindings).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};
  const missionResult = mission ? evaluateMissionV3(mission, built.document, bindings) : null;
  const missionIssues = missionResult?.issues ?? [];
  const physical = request.mode === 'prewire' ? validatePhysicalPrewireV3({
    document: built.document,
    devices: (built.document.deviceInstances ?? [])
      .filter((device) => !device.profileId.startsWith('boundary:'))
      .map((device) => ({
        deviceId: device.id,
        partNumber: device.exactOrderCode,
        designation: device.designation,
        widthMm: device.layoutMm.width ?? null,
        heightMm: device.layoutMm.height ?? null,
        depthMm: device.layoutMm.depth ?? null,
        orientationDeg: device.layoutMm.rotation,
        railId: typeof device.configuration.railId === 'string' ? device.configuration.railId : null,
      })),
    requireFerrules: true,
  }) : { status: 'PASS' as const, issues: [] };
  const physicalIssues: ValidationIssue[] = physical.issues.map((entry) => ({
    ...entry,
    refs: [...entry.refs],
    severity: 'blocked',
  }));
  const missionFailure = missionIssues.some((entry) => entry.blocking && entry.severity !== 'blocked');
  const combinedStatus: ValidationResult['status'] = result.status === 'FAIL' || missionFailure
    ? 'FAIL'
    : result.status === 'BLOCKED' || physical.status === 'BLOCKED'
      || missionIssues.some((entry) => entry.severity === 'blocked')
      ? 'BLOCKED'
      : 'PASS';
  const validation: ValidationResult = {
    status: combinedStatus,
    issues: [...result.issues.map(rendererIssue), ...missionIssues, ...physicalIssues],
    documentRevision: result.documentRevision,
    documentHash: result.documentHash,
    checkedAt: new Date().toISOString(),
  };
  const eligibility = canIssueVerifiedReportV3(
    built.document,
    {
      status: combinedStatus,
      issues: result.issues,
      documentRevision: result.documentRevision,
      documentHash: result.documentHash,
    },
    missionResult?.simulations ?? [],
    {
      profilesEligible: result.canIssueVerifiedPrewire,
      assetsEligible: result.canIssueVerifiedPrewire,
      geometryEligible: result.canIssueVerifiedPrewire,
      physicalReviewPassed: physical.status === 'PASS',
      requiredScenarioIds: mission?.scenarios.map((scenario) => scenario.id) ?? [],
    },
  );
  return {
    validation,
    circuitSolution: result.solution,
    scenarioSimulations: missionResult?.simulations,
    classification: request.mode === 'prewire' && eligibility.eligible
      ? 'VERIFIED_PREWIRE'
      : request.mode === 'prewire' ? 'DIAGNOSTIC' : 'LEGACY_DIAGNOSTIC',
  };
}
