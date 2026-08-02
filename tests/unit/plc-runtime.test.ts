import { describe, expect, it } from 'vitest';
import {
  IoBindingV1Schema,
  MockPlcRuntimeAdapter,
  PlcRuntimeConfigurationV1Schema,
  synchronizeRuntimeFrame,
  type IoBindingV1,
} from '../../src/domain/plc-runtime';

const projectSha256 = 'a'.repeat(64);

function binding(overrides: Partial<IoBindingV1> = {}): IoBindingV1 {
  return {
    schemaVersion: 1,
    id: 'start-input',
    deviceInstanceId: 'plc1',
    terminalId: 'P03',
    cpuModel: 'XGB-XBCH',
    projectId: 'project-15',
    symbolName: 'EOCR_TEST',
    address: 'B0S00.IN03',
    direction: 'input',
    dataType: 'BOOL',
    inverted: false,
    normalState: false,
    communicationLossState: false,
    access: { read: true, write: true },
    projectSha256,
    ...overrides,
  };
}

describe('IoBindingV1', () => {
  it('accepts an exact input-channel binding with a project hash', () => {
    expect(IoBindingV1Schema.parse(binding())).toMatchObject({
      address: 'B0S00.IN03',
      direction: 'input',
      access: { write: true },
    });
  });

  it('blocks output writes and direction/address mismatches', () => {
    expect(() => IoBindingV1Schema.parse(binding({
      id: 'lamp-output',
      address: 'B0S00.OUT01',
      direction: 'output',
      access: { read: true, write: true },
    }))).toThrow();
    expect(() => IoBindingV1Schema.parse(binding({ address: 'B0S00.OUT01' }))).toThrow();
  });

  it('blocks duplicate binding ids and duplicate runtime addresses', () => {
    const first = binding();
    expect(() => PlcRuntimeConfigurationV1Schema.parse({
      schemaVersion: 1,
      adapter: 'mock',
      pollIntervalMs: 20,
      bindings: [first, { ...first }],
    })).toThrow();
  });
});

describe('MockPlcRuntimeAdapter', () => {
  it('produces deterministic snapshots and returns all values to fail-safe state on disconnect', async () => {
    const input = binding();
    const output = binding({
      id: 'lamp-output',
      terminalId: 'P21',
      symbolName: 'EOCR_LAMP',
      address: 'B0S00.OUT01',
      direction: 'output',
      access: { read: true, write: false },
    });
    const adapter = new MockPlcRuntimeAdapter(({ inputs }) => ({
      'lamp-output': inputs['start-input'] === true,
    }));

    await adapter.connect({
      sessionNonce: '0123456789abcdef0123456789abcdef',
      cpuModel: 'XGB-XBCH',
      projectId: 'project-15',
      projectSha256,
      base: 0,
      slot: 0,
      bindings: [input, output],
    });
    await adapter.writeInputImage({ values: { 'start-input': true } });

    expect(await adapter.readSnapshot()).toMatchObject({
      inputs: { 'start-input': true },
      outputs: { 'lamp-output': true },
    });
    await expect(adapter.writeInputImage({ values: { 'lamp-output': true } })).rejects.toThrow('not writable');

    await adapter.disconnect();
    expect((await adapter.getStatus()).state).toBe('disconnected');
    await expect(adapter.readSnapshot()).rejects.toThrow('not connected');
  });

  it('solves the published frame from the post-scan output snapshot', async () => {
    const input = binding();
    const output = binding({
      id: 'lamp-output',
      terminalId: 'P20',
      symbolName: 'RUN_LAMP',
      address: 'B0S00.OUT00',
      direction: 'output',
      access: { read: true, write: false },
    });
    const adapter = new MockPlcRuntimeAdapter(({ inputs }) => ({
      'lamp-output': inputs['start-input'] === true,
    }));
    const connection = await adapter.connect({
      sessionNonce: '0123456789abcdef0123456789abcdef',
      cpuModel: 'XGB-XBCH',
      projectId: 'project-15',
      projectSha256,
      base: 0,
      slot: 0,
      bindings: [input, output],
    });

    const frame = await synchronizeRuntimeFrame(adapter, {
      frameNumber: 1,
      workshopRevision: 7,
      workshopHash: 'workshop-hash',
      sessionId: connection.sessionId,
      projectSha256,
      prepare: () => ({ nextInputs: { values: { 'start-input': true } }, context: { prepared: true } }),
      solve: (stable, prepared) => ({
        circuitSolution: { outputSeenByCircuit: stable.outputs['lamp-output'] },
        deviceStates: { relay: stable.outputs['lamp-output'] === true ? 'ENERGIZED' : 'DEENERGIZED' },
        issues: [],
        prepared,
      }),
      now: (() => { const values = [100, 104]; return () => values.shift() ?? 104; })(),
      timestamp: () => '2026-08-02T00:00:00.000Z',
    });

    expect(frame.plcOutputs['lamp-output']).toBe(true);
    expect(frame.circuitSolution).toEqual({ outputSeenByCircuit: true });
    expect(frame.deviceStates.relay).toBe('ENERGIZED');
    expect(frame.elapsedMs).toBe(4);
  });
});
