import { describe, expect, it } from 'vitest';
import { MY2N_D2_DC24_BEHAVIOR } from '../../src/catalog/device-behavior-profiles';
import {
  createFunctionalSimulationReport,
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
  address: 'B0S00.OUT00',
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
    expect(report.bindings[0]).toMatchObject({ address: 'B0S00.OUT00', access: { write: false } });
    expect(report.frames[0].closedLoopPaths[0]).toMatchObject({ elementId: 'coil', sourceBranchIds: ['feed'], returnBranchIds: ['return'] });
    expect(report.manualEvidence[0]).toMatchObject({ manualId: 'Omron_MY_Series_J219-E1.pdf', pages: [8, 10, 20] });
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain('%PDF');
  });
});
