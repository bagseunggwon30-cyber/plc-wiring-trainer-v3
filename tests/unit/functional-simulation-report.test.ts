import { describe, expect, it } from 'vitest';
import { MY2N_D2_DC24_BEHAVIOR } from '../../src/catalog/device-behavior-profiles';
import {
  createFunctionalSimulationReport,
  createFunctionalSimulationReportV2,
  type FunctionalSimulationResultV1,
  type IoBindingV1,
  type RuntimeFrame,
} from '../../src/domain/plc-runtime';
import type { CircuitSolution, WorkshopDocumentV3 } from '../../src/domain/v3';

const hash = 'd'.repeat(64);
const binding: IoBindingV1 = {
  schemaVersion: 1,
  id: 'run-output',
  deviceInstanceId: 'plc1',
  terminalId: 'P20',
  cpuModel: 'XGB-XBCH',
  projectId: 'fixture',
  symbolName: 'RUN',
  address: 'M00100',
  direction: 'output',
  dataType: 'BOOL',
  inverted: false,
  normalState: false,
  communicationLossState: false,
  access: { read: true, write: false },
  projectSha256: hash,
};

const solution: CircuitSolution = {
  loads: { coil: { energized: true, state: 'ON', sourceId: 'dc', voltageV: 24, currentA: 0.036, sourcePath: { sourceId: 'dc', terminalKeys: ['dc:+', 'coil:14'], branchIds: ['feed'] }, returnPath: { sourceId: 'dc', terminalKeys: ['coil:13', 'dc:-'], branchIds: ['return'] } } },
  acLoads: {}, analogPorts: {}, currentLoops: {}, elements: {}, terminals: {}, acTerminalPotentials: {}, continuityGroups: {}, branchCurrents: {}, energizedTerminals: ['coil:14'], issues: [],
};
const workshop = { schemaVersion: 3, revision: 1, hash: 'workshop', sources: [], elements: [], branches: [], reviewScope: { elementIds: [] } } as WorkshopDocumentV3;
const frame: RuntimeFrame<CircuitSolution> = {
  frameNumber: 1,
  capturedAt: '2026-08-02T00:00:00.000Z',
  workshopRevision: 1,
  workshopHash: 'workshop',
  sessionId: 'mock:fixture',
  projectSha256: hash,
  plcInputs: { start: true },
  plcOutputs: { 'run-output': true },
  circuitSolution: solution,
  deviceStates: { coil: 'energized' },
  issues: [],
  elapsedMs: 4,
  retryCount: 0,
};
const assessment: FunctionalSimulationResultV1 = {
  status: 'SIL_PASS', frameNumber: 1, workshopRevision: 1, workshopHash: 'workshop',
  stages: { prewire: 'PASS', plc: 'PASS', devices: 'PASS' }, issueCodes: [],
  disclaimer: 'OFFLINE_PREWIRE_FUNCTION_TEST_NOT_ENERGIZATION_APPROVAL',
};

describe('functional simulation report', () => {
  it('records bindings, closed-loop paths and manual evidence without embedding manuals', async () => {
    const report = await createFunctionalSimulationReport({
      workshop,
      assessment,
      runtime: {
        provider: 'mock', xg5000Version: '4.78.2.0', xgSimVersion: '1.0.0.1', hostProtocolVersion: 1,
        cpuModel: 'XGB-XBCH', projectId: 'fixture', projectSha256: hash, projectIdentityVerified: true,
      },
      bindings: [binding],
      behaviorProfiles: [MY2N_D2_DC24_BEHAVIOR],
      frames: [frame],
      unsupportedChecks: ['transient-analysis'],
    });
    expect(report.classification).toBe('SIL_PASS');
    expect(report.bindings[0]).toMatchObject({ address: 'M00100', access: { write: false } });
    expect(report.frames[0].closedLoopPaths[0]).toMatchObject({ elementId: 'coil', sourceBranchIds: ['feed'], returnBranchIds: ['return'] });
    expect(report.manualEvidence[0]).toMatchObject({ manualId: 'Omron_MY_Series_J219-E1.pdf', pages: [8, 10, 20] });
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain('%PDF');
  });

  it('keeps a successful roundtrip separate from the formal identity block and strips the local path', async () => {
    const blockedAssessment: FunctionalSimulationResultV1 = {
      ...assessment,
      status: 'BLOCKED',
      stages: { prewire: 'PASS', plc: 'BLOCKED', devices: 'PASS' },
      issueCodes: ['PROJECT_IDENTITY_UNVERIFIED'],
    };
    const report = await createFunctionalSimulationReportV2({
      workshop,
      assessment: blockedAssessment,
      runtime: {
        provider: 'xgsim', xg5000Version: '4.78.2.0', xgSimVersion: '1.0.0.1', hostProtocolVersion: 1,
        cpuModel: 'XGB-XBCH', projectId: 'xbc-dr32h-self-hold-v1', projectSha256: hash, projectIdentityVerified: false,
      },
      bindings: [binding],
      behaviorProfiles: [MY2N_D2_DC24_BEHAVIOR],
      frames: [frame],
      unsupportedChecks: ['project-identity-proof'],
      diagnosticOutcome: 'ROUNDTRIP_PASS',
      steps: [{ id: 'start-pressed', frameNumber: 1, passed: true, issueCodes: ['PROJECT_IDENTITY_UNVERIFIED'] }],
      projectDeclaration: {
        reference: {
          schemaVersion: 1,
          absolutePath: 'C:\\Users\\bark\\Desktop\\4층_GEMINI\\4층_GEMINI.xgwx',
          fileName: '4층_GEMINI.xgwx',
          sizeBytes: 1024,
          modifiedAt: '2026-08-09T00:00:00.000Z',
          sha256: hash,
        },
        userConfirmedLoaded: true,
      },
      safeStop: {
        reason: 'automatic-test-complete',
        attemptedAt: '2026-08-09T00:00:01.000Z',
        inputBindingIds: ['start-input', 'stop-input'],
        allInputsForcedOff: true,
        safeInputValues: { 'start-input': false, 'stop-input': true },
        runOutputObservedOff: true,
        disconnected: true,
        error: null,
      },
    });

    expect(report).toMatchObject({
      schemaVersion: 2,
      classification: 'BLOCKED',
      diagnosticOutcome: 'ROUNDTRIP_PASS',
      projectDeclaration: {
        fileName: '4층_GEMINI.xgwx',
        sha256: hash,
        identityProof: 'USER_DECLARATION_ONLY',
      },
      safeStop: {
        allInputsForcedOff: true,
        safeInputValues: { 'start-input': false, 'stop-input': true },
        runOutputObservedOff: true,
        disconnected: true,
      },
    });
    expect(report.issueCodes).toContain('PROJECT_IDENTITY_UNVERIFIED');
    expect(JSON.stringify(report)).not.toContain('C:\\XG5000');
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
