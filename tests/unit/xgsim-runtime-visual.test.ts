import { describe, expect, it } from 'vitest';
import { createXbcDr32hSelfHoldSliceDefinition } from '../../src/domain/device-runtime';
import type { XbcClosedLoopStepResult } from '../../src/domain/plc-runtime';
import { createXgSimRuntimeVisualFrame } from '../../src/renderer/plc-runtime/xgsim-runtime-visual';

const definition = createXbcDr32hSelfHoldSliceDefinition();

function step(
  deviceStates: Record<string, string>,
  issues: Array<{ code: string; bindingIds: string[]; blocking: boolean }> = [],
): XbcClosedLoopStepResult {
  const runtimeIssues = issues.map(issue => ({ ...issue, message: issue.code }));
  return {
    id: 'start-pressed',
    passed: true,
    issueCodes: runtimeIssues.map(issue => issue.code),
    frame: {
      frameNumber: 2,
      capturedAt: '2026-08-11T00:00:00.000Z',
      workshopRevision: 9,
      workshopHash: 'a'.repeat(64),
      sessionId: 'session-1',
      projectSha256: 'b'.repeat(64),
      plcInputs: {},
      plcOutputs: {},
      circuitSolution: {} as XbcClosedLoopStepResult['frame']['circuitSolution'],
      deviceStates,
      issues: runtimeIssues,
      elapsedMs: 20,
      retryCount: 0,
    },
  };
}

describe('XG-SIM display-only SVG projection', () => {
  it('maps the already-solved P21, MY2N, and lamp state to explicit device IDs', () => {
    const visual = createXgSimRuntimeVisualFrame(step({
      [definition.plcOutputContactStateKey]: 'CLOSED',
      [definition.relayCoilElementId]: 'energized',
      [definition.lampElementId]: 'ON',
    }), definition);

    expect(visual).toMatchObject({
      workshopRevision: 9,
      plcDeviceId: 'plc1',
      relayDeviceId: 'relay1',
      lampDeviceId: 'runLamp',
      plcOutputTerminalId: 'P21',
      plcOutputClosed: true,
      relayEnergized: true,
      lampEnergized: true,
    });
  });

  it('shows electrical path failures while keeping project identity as a report-only block', () => {
    const visual = createXgSimRuntimeVisualFrame(step({
      [definition.plcOutputContactStateKey]: 'CLOSED',
      [definition.relayCoilElementId]: 'deenergized',
      [definition.lampElementId]: 'OFF',
    }, [
      { code: 'OPEN_RETURN_PATH', bindingIds: [definition.relayCoilElementId], blocking: true },
      { code: 'PROJECT_IDENTITY_UNVERIFIED', bindingIds: [definition.runOutputBindingId], blocking: true },
    ]), definition);

    expect(visual.relayFaultCodes).toEqual(['OPEN_RETURN_PATH']);
    expect(visual.plcFaultCodes).toEqual([]);
    expect(visual.lampFaultCodes).toEqual([]);
  });
});
