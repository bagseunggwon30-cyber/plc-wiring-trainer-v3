import type { ValidationStatusV3, WorkshopDocumentV3 } from '../v3/contracts';
import type { FunctionalSimulationStatusV1, RuntimeFrame } from './contracts';

export interface FunctionalSimulationAssessmentRequest {
  readonly workshop: WorkshopDocumentV3;
  readonly frame: RuntimeFrame;
  readonly prewireStatus: ValidationStatusV3;
  readonly requiredDeviceProfilesEligible: boolean;
  readonly requiredOutputBindingIds: readonly string[];
  readonly requiredDeviceStateIds: readonly string[];
  readonly projectIdentityVerified: boolean;
}

export interface FunctionalSimulationResultV1 {
  readonly status: FunctionalSimulationStatusV1;
  readonly frameNumber: number;
  readonly workshopRevision: number;
  readonly workshopHash: string;
  readonly stages: {
    readonly prewire: 'PASS' | 'FAIL' | 'BLOCKED' | 'STALE';
    readonly plc: 'PASS' | 'BLOCKED';
    readonly devices: 'PASS' | 'FAIL' | 'BLOCKED';
  };
  readonly issueCodes: readonly string[];
  readonly disclaimer: 'OFFLINE_PREWIRE_FUNCTION_TEST_NOT_ENERGIZATION_APPROVAL';
}

const dataBlockedCodes = new Set([
  'PROJECT_IDENTITY_UNVERIFIED',
  'PLC_OUTPUT_VALUE_INVALID',
  'RUNTIME_BINDING_MISSING',
  'DEVICE_STATE_MISSING',
]);

/** Evaluates freshness and evidence independently of presentation/report code. */
export function assessFunctionalSimulation(request: FunctionalSimulationAssessmentRequest): FunctionalSimulationResultV1 {
  const stale = request.frame.workshopRevision !== request.workshop.revision
    || request.frame.workshopHash !== request.workshop.hash;
  const outputBindingsPresent = request.requiredOutputBindingIds.every((id) => (
    typeof request.frame.plcOutputs[id] === 'boolean' || typeof request.frame.plcOutputs[id] === 'number'
  ));
  const deviceStatesPresent = request.requiredDeviceStateIds.every((id) => request.frame.deviceStates[id] !== undefined);
  const syntheticCodes = [
    ...(!outputBindingsPresent ? ['RUNTIME_BINDING_MISSING'] : []),
    ...(!deviceStatesPresent ? ['DEVICE_STATE_MISSING'] : []),
    ...(!request.projectIdentityVerified ? ['PROJECT_IDENTITY_UNVERIFIED'] : []),
  ];
  const issueCodes = [...new Set([...request.frame.issues.map((issue) => issue.code), ...syntheticCodes])].sort();
  const blocked = issueCodes.some((code) => dataBlockedCodes.has(code)) || !request.requiredDeviceProfilesEligible;
  const failed = request.frame.issues.some((issue) => issue.blocking && !dataBlockedCodes.has(issue.code));
  const prewire: FunctionalSimulationResultV1['stages']['prewire'] = stale || request.prewireStatus === 'STALE'
    ? 'STALE'
    : request.prewireStatus;
  let status: FunctionalSimulationStatusV1;
  if (prewire === 'STALE') status = 'STALE';
  else if (prewire === 'BLOCKED' || blocked) status = 'BLOCKED';
  else if (prewire === 'FAIL' || failed) status = 'FAIL';
  else status = 'SIL_PASS';
  const plc: FunctionalSimulationResultV1['stages']['plc'] = outputBindingsPresent && request.projectIdentityVerified ? 'PASS' : 'BLOCKED';
  const devices: FunctionalSimulationResultV1['stages']['devices'] = !deviceStatesPresent || !request.requiredDeviceProfilesEligible
    ? 'BLOCKED'
    : failed ? 'FAIL' : 'PASS';
  return Object.freeze({
    status,
    frameNumber: request.frame.frameNumber,
    workshopRevision: request.frame.workshopRevision,
    workshopHash: request.frame.workshopHash,
    stages: {
      prewire,
      plc,
      devices,
    },
    issueCodes,
    disclaimer: 'OFFLINE_PREWIRE_FUNCTION_TEST_NOT_ENERGIZATION_APPROVAL',
  });
}
