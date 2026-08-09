import { sha256 } from '../migration';
import type { DeviceBehaviorProfile } from '../device-runtime/contracts';
import type { CircuitSolution, WorkshopDocumentV3 } from '../v3/contracts';
import type { IoBindingV1 } from './io-binding';
import type { RuntimeFrame } from './contracts';
import type { FunctionalSimulationResultV1 } from './functional-simulation';
import type { XgSimLocalProjectRefV1 } from './project-manifest';
import type {
  RuntimeDiagnosticOutcomeV1,
  XbcClosedLoopSafeStopEvidenceV1,
  XbcClosedLoopStepId,
} from './xbc-closed-loop-session';

export interface FunctionalRuntimeMetadataV1 {
  readonly provider: 'mock' | 'xgsim';
  readonly xg5000Version: string;
  readonly xgSimVersion: string;
  readonly hostProtocolVersion: number;
  readonly cpuModel: string;
  readonly projectId: string;
  readonly projectSha256: string;
  readonly projectIdentityVerified: boolean;
}

export interface FunctionalSimulationReportV1 {
  readonly schemaVersion: 1;
  readonly classification: FunctionalSimulationResultV1['status'];
  readonly disclaimer: FunctionalSimulationResultV1['disclaimer'];
  readonly workshop: { readonly revision: number; readonly hash: string };
  readonly runtime: FunctionalRuntimeMetadataV1;
  readonly bindings: readonly IoBindingV1[];
  readonly manualEvidence: readonly {
    readonly profileId: string;
    readonly fullOrderCode: string;
    readonly manualId: string;
    readonly pages: readonly number[];
    readonly sha256: string;
  }[];
  readonly frames: readonly {
    readonly frameNumber: number;
    readonly capturedAt: string;
    readonly inputs: Readonly<Record<string, boolean | number>>;
    readonly outputs: Readonly<Record<string, boolean | number>>;
    readonly deviceStates: Readonly<Record<string, string>>;
    readonly issueCodes: readonly string[];
    readonly closedLoopPaths: readonly {
      readonly elementId: string;
      readonly state: string;
      readonly sourceId: string | null;
      readonly sourceBranchIds: readonly string[];
      readonly returnBranchIds: readonly string[];
    }[];
  }[];
  readonly stages: FunctionalSimulationResultV1['stages'];
  readonly unsupportedChecks: readonly string[];
  readonly reportHash: string;
}

export interface CreateFunctionalSimulationReportRequest {
  readonly workshop: WorkshopDocumentV3;
  readonly assessment: FunctionalSimulationResultV1;
  readonly runtime: FunctionalRuntimeMetadataV1;
  readonly bindings: readonly IoBindingV1[];
  readonly behaviorProfiles: readonly DeviceBehaviorProfile[];
  readonly frames: readonly RuntimeFrame<CircuitSolution>[];
  readonly unsupportedChecks: readonly string[];
}

export interface FunctionalSimulationReportV2 extends Omit<FunctionalSimulationReportV1, 'schemaVersion' | 'reportHash'> {
  readonly schemaVersion: 2;
  readonly diagnosticOutcome: RuntimeDiagnosticOutcomeV1;
  readonly issueCodes: readonly string[];
  readonly steps: readonly {
    readonly id: XbcClosedLoopStepId;
    readonly frameNumber: number;
    readonly passed: boolean;
    readonly issueCodes: readonly string[];
  }[];
  readonly projectDeclaration: {
    readonly fileName: string;
    readonly sizeBytes: number;
    readonly modifiedAt: string;
    readonly sha256: string;
    readonly userConfirmedLoaded: boolean;
    readonly identityProof: 'USER_DECLARATION_ONLY';
  };
  readonly safeStop: XbcClosedLoopSafeStopEvidenceV1;
  readonly reportHash: string;
}

export interface CreateFunctionalSimulationReportV2Request extends CreateFunctionalSimulationReportRequest {
  readonly diagnosticOutcome: RuntimeDiagnosticOutcomeV1;
  readonly steps: readonly {
    readonly id: XbcClosedLoopStepId;
    readonly frameNumber: number;
    readonly passed: boolean;
    readonly issueCodes: readonly string[];
  }[];
  readonly projectDeclaration: {
    readonly reference: XgSimLocalProjectRefV1;
    readonly userConfirmedLoaded: boolean;
  };
  readonly safeStop: XbcClosedLoopSafeStopEvidenceV1;
}

export async function createFunctionalSimulationReport(
  request: CreateFunctionalSimulationReportRequest,
): Promise<FunctionalSimulationReportV1> {
  const payload = {
    schemaVersion: 1 as const,
    classification: request.assessment.status,
    disclaimer: request.assessment.disclaimer,
    workshop: { revision: request.workshop.revision, hash: request.workshop.hash },
    runtime: { ...request.runtime },
    bindings: request.bindings.map((binding) => structuredClone(binding)).sort((left, right) => left.id.localeCompare(right.id)),
    manualEvidence: request.behaviorProfiles.flatMap((profile) => profile.manualEvidence.map((evidence) => ({
      profileId: profile.profileId,
      fullOrderCode: profile.fullOrderCode,
      manualId: evidence.manualId,
      pages: [...evidence.pages],
      sha256: evidence.sha256,
    }))).sort((left, right) => `${left.profileId}:${left.manualId}`.localeCompare(`${right.profileId}:${right.manualId}`)),
    frames: request.frames.map((frame) => ({
      frameNumber: frame.frameNumber,
      capturedAt: frame.capturedAt,
      inputs: { ...frame.plcInputs },
      outputs: { ...frame.plcOutputs },
      deviceStates: { ...frame.deviceStates },
      issueCodes: [...new Set(frame.issues.map((issue) => issue.code))].sort(),
      closedLoopPaths: Object.entries(frame.circuitSolution.loads).map(([elementId, load]) => ({
        elementId,
        state: load.state,
        sourceId: load.sourceId ?? null,
        sourceBranchIds: [...(load.sourcePath?.branchIds ?? [])],
        returnBranchIds: [...(load.returnPath?.branchIds ?? [])],
      })).sort((left, right) => left.elementId.localeCompare(right.elementId)),
    })).sort((left, right) => left.frameNumber - right.frameNumber),
    stages: { ...request.assessment.stages },
    unsupportedChecks: [...new Set(request.unsupportedChecks)].sort(),
  };
  return Object.freeze({ ...payload, reportHash: await sha256(payload) });
}

/** V2 remains a strict superset of the V1 payload while separating diagnostic evidence from formal status. */
export async function createFunctionalSimulationReportV2(
  request: CreateFunctionalSimulationReportV2Request,
): Promise<FunctionalSimulationReportV2> {
  const legacy = await createFunctionalSimulationReport(request);
  const { schemaVersion: _schemaVersion, reportHash: _legacyReportHash, ...v1Payload } = legacy;
  const payload = {
    ...v1Payload,
    schemaVersion: 2 as const,
    diagnosticOutcome: request.diagnosticOutcome,
    issueCodes: [...new Set([
      ...request.assessment.issueCodes,
      ...request.steps.flatMap((step) => step.issueCodes),
    ])].sort(),
    steps: request.steps.map((step) => ({
      id: step.id,
      frameNumber: step.frameNumber,
      passed: step.passed,
      issueCodes: [...new Set(step.issueCodes)].sort(),
    })),
    projectDeclaration: {
      fileName: request.projectDeclaration.reference.fileName,
      sizeBytes: request.projectDeclaration.reference.sizeBytes,
      modifiedAt: request.projectDeclaration.reference.modifiedAt,
      sha256: request.projectDeclaration.reference.sha256,
      userConfirmedLoaded: request.projectDeclaration.userConfirmedLoaded,
      identityProof: 'USER_DECLARATION_ONLY' as const,
    },
    safeStop: structuredClone(request.safeStop),
  };
  return Object.freeze({ ...payload, reportHash: await sha256(payload) });
}
