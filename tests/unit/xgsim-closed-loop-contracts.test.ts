import { describe, expect, it } from 'vitest';
import {
  RuntimeSynchronizationError,
  XgSimLocalProjectRefV1Schema,
  XgSimTestProjectManifestV1Schema,
  createXbcDr32hSelfHoldManifest,
  waitForExpectedStableSnapshot,
  type PlcRuntimeAdapter,
  type PlcRuntimeSnapshot,
} from '../../src/domain/plc-runtime';

const projectSha256 = 'a'.repeat(64);

describe('XBC-DR32H self-hold XG-SIM manifest', () => {
  it('binds the physical P03/P02/P21 slice to the existing M-device SET/RST logic', () => {
    const manifest = createXbcDr32hSelfHoldManifest({
      projectSha256,
      checkedAt: '2026-08-09T00:00:00.000Z',
      xg5000Version: '4.78.2.0',
      xgSimVersion: '1.0.0.1',
    });

    expect(XgSimTestProjectManifestV1Schema.parse(manifest)).toMatchObject({
      projectId: 'xbc-dr32h-self-hold-v1',
      projectFileName: '4층_GEMINI.xgwx',
      cpuModel: 'XGB-XBCH',
      base: 0,
      slot: 0,
      ladderContract: {
        kind: 'set-reset-v1',
        expression: 'start_rising_sets_run; stop_resets_run',
        startInputBindingId: 'start-input',
        stopInputBindingId: 'stop-input',
        runOutputBindingId: 'run-output',
      },
      programCheck: { status: 'PASS', errors: 0, warnings: 0 },
    });
    expect(manifest.bindings).toEqual([
      expect.objectContaining({ id: 'start-input', terminalId: 'P03', address: 'M00001', direction: 'internal-request', normalState: false, communicationLossState: false, inverted: false }),
      expect.objectContaining({ id: 'stop-input', terminalId: 'P02', address: 'M00002', direction: 'internal-request', normalState: false, communicationLossState: true, inverted: false }),
      expect.objectContaining({ id: 'run-output', terminalId: 'P21', address: 'M00100', direction: 'output', access: { read: true, write: false } }),
    ]);
  });

  it('represents an unchecked project as pending instead of claiming a passed Program Check', () => {
    const manifest = createXbcDr32hSelfHoldManifest({
      projectSha256,
      programCheckStatus: 'PENDING',
      checkedAt: null,
      xg5000Version: '4.78.2.0',
      xgSimVersion: '1.0.0.1',
    });
    expect(manifest.programCheck).toEqual({
      status: 'PENDING', errors: null, warnings: null, checkedAt: null,
      xg5000Version: '4.78.2.0', xgSimVersion: '1.0.0.1',
    });
  });

  it('keeps the local absolute path separate and rejects non-XGWX files', () => {
    expect(XgSimLocalProjectRefV1Schema.parse({
      schemaVersion: 1,
      absolutePath: 'C:\\Users\\bark\\Desktop\\4층_GEMINI\\4층_GEMINI.xgwx',
      fileName: '4층_GEMINI.xgwx',
      sizeBytes: 1234,
      modifiedAt: '2026-08-09T00:00:00.000Z',
      sha256: projectSha256,
    }).absolutePath).toContain('4층_GEMINI');
    expect(() => XgSimLocalProjectRefV1Schema.parse({
      schemaVersion: 1,
      absolutePath: 'C:\\Temp\\not-a-project.txt',
      fileName: 'not-a-project.txt',
      sizeBytes: 1,
      modifiedAt: '2026-08-09T00:00:00.000Z',
      sha256: projectSha256,
    })).toThrow();
  });
});

function snapshot(sequence: number, runOutput: boolean): PlcRuntimeSnapshot {
  return {
    sequence,
    capturedAt: `2026-08-09T00:00:0${sequence}.000Z`,
    inputs: {},
    outputs: { 'run-output': runOutput },
    monitors: {},
  };
}

function snapshotAdapter(values: boolean[]): PlcRuntimeAdapter {
  let index = 0;
  return {
    async probe() { throw new Error('not used'); },
    async connect() { throw new Error('not used'); },
    async readSnapshot() {
      const value = values[Math.min(index, values.length - 1)] ?? false;
      index += 1;
      return snapshot(index, value);
    },
    async writeInputImage() { throw new Error('not used'); },
    async getStatus() { throw new Error('not used'); },
    async disconnect() {},
  };
}

describe('expected output stabilization', () => {
  it('waits for the expected output twice instead of accepting two stale reads', async () => {
    let now = 0;
    const result = await waitForExpectedStableSnapshot(
      snapshotAdapter([false, false, true, true]),
      { 'run-output': true },
      { pollIntervalMs: 20, timeoutMs: 500, consecutiveMatches: 2 },
      { now: () => now, sleep: async (milliseconds) => { now += milliseconds; } },
    );

    expect(result.snapshot.outputs['run-output']).toBe(true);
    expect(result.attempts).toBe(4);
  });

  it('fails with PLC_OUTPUT_NOT_STABLE when the expected output never arrives', async () => {
    let now = 0;
    await expect(waitForExpectedStableSnapshot(
      snapshotAdapter([false]),
      { 'run-output': true },
      { pollIntervalMs: 20, timeoutMs: 60, consecutiveMatches: 2 },
      { now: () => now, sleep: async (milliseconds) => { now += milliseconds; } },
    )).rejects.toMatchObject({ code: 'PLC_OUTPUT_NOT_STABLE' } satisfies Partial<RuntimeSynchronizationError>);
  });
});
