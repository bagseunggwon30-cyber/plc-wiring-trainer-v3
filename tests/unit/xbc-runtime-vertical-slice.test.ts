import { describe, expect, it } from 'vitest';
import { MY2N_D2_DC24_BEHAVIOR } from '../../src/catalog/device-behavior-profiles';
import { MockPlcRuntimeAdapter, type IoBindingV1 } from '../../src/domain/plc-runtime';
import { assessFunctionalSimulation } from '../../src/domain/plc-runtime';
import {
  createInitialDeviceBehaviorSnapshot,
  runXbcRelayLampFrame,
  type XbcRelayLampSliceDefinition,
} from '../../src/domain/device-runtime';
import type { ElectricalBranch, WorkshopDocumentV3 } from '../../src/domain/v3';

const projectSha256 = 'b'.repeat(64);

function ioBinding(
  id: string,
  terminalId: string,
  address: string,
  direction: 'internal-request' | 'output',
  normalState: boolean,
  communicationLossState = false,
): IoBindingV1 {
  return {
    schemaVersion: 1,
    id,
    deviceInstanceId: 'plc1',
    terminalId,
    cpuModel: 'XGB-XBCH',
    projectId: 'self-hold-fixture',
    symbolName: id.toUpperCase().replaceAll('-', '_'),
    address,
    direction,
    dataType: 'BOOL',
    inverted: false,
    normalState,
    communicationLossState,
    access: { read: true, write: direction === 'internal-request' },
    projectSha256,
  };
}

const bindings = [
  ioBinding('start-input', 'P03', 'M00001', 'internal-request', false),
  ioBinding('stop-input', 'P02', 'M00002', 'internal-request', false, true),
  ioBinding('run-output', 'P21', 'M00100', 'output', false),
];

function branch(
  id: string,
  fromElement: string,
  fromTerminal: string,
  toElement: string,
  toTerminal: string,
  conductor: ElectricalBranch['conductor'] = 'dc',
): ElectricalBranch {
  return {
    id,
    from: { elementId: fromElement, terminalId: fromTerminal },
    to: { elementId: toElement, terminalId: toTerminal },
    conductor,
  };
}

function workshop(options: { coilReturn?: boolean; outputCommon?: boolean; plcPower?: boolean } = {}): WorkshopDocumentV3 {
  const coilReturn = options.coilReturn ?? true;
  const outputCommon = options.outputCommon ?? true;
  const plcPower = options.plcPower ?? true;
  const branches: ElectricalBranch[] = [
    branch('ac-n', 'ac', 'N', 'plc-power', 'N', 'ac'),
    branch('ac-pe', 'ac', 'PE', 'plc-power', 'PE', 'pe'),
    branch('start-feed', 'dc24', '+24V', 'start-pb', '13'),
    branch('start-signal', 'start-pb', '14', 'plc-start-input', 'P03'),
    branch('start-com', 'plc-start-input', 'COMI', 'dc24', '0V'),
    branch('stop-feed', 'dc24', '+24V', 'stop-pb', '21'),
    branch('stop-signal', 'stop-pb', '22', 'plc-stop-input', 'P02'),
    branch('stop-com', 'plc-stop-input', 'COMI', 'dc24', '0V'),
    branch('output-to-coil', 'plc-p21-contact', 'P21', 'relay-coil', '14'),
    branch('relay-return', 'relay-coil', '13', 'dc24', '0V'),
    branch('lamp-feed', 'dc24', '+24V', 'relay-no1', '9'),
    branch('lamp-switched', 'relay-no1', '5', 'run-lamp', '+'),
    branch('lamp-return', 'run-lamp', '-', 'dc24', '0V'),
  ];
  if (plcPower) branches.push(branch('ac-l', 'ac', 'L', 'plc-power', 'L', 'ac'));
  if (outputCommon) branches.push(branch('output-com', 'dc24', '+24V', 'plc-p21-contact', 'COM0'));
  if (!coilReturn) {
    const index = branches.findIndex((entry) => entry.id === 'relay-return');
    branches.splice(index, 1);
  }
  return {
    schemaVersion: 3,
    revision: 4,
    hash: `vertical-${Number(coilReturn)}-${Number(outputCommon)}-${Number(plcPower)}`,
    sources: [
      {
        kind: 'ac-single-phase', id: 'ac', lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE', lineToNeutralVoltage: 220,
        protectionCoordination: { prospectiveShortCircuitCurrentA: 1000, protectiveDeviceCurve: 'C10' },
      },
      { kind: 'dc', id: 'dc24', positiveTerminal: '+24V', returnTerminal: '0V', voltage: 24, enabledByElementId: 'plc-power' },
    ],
    elements: [
      { kind: 'ac-load', id: 'plc-power', lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE', required: 'always' },
      { kind: 'contact', id: 'start-pb', terminalA: '13', terminalB: '14', stateKey: 'start-pb:contact', normally: 'open' },
      { kind: 'contact', id: 'stop-pb', terminalA: '21', terminalB: '22', stateKey: 'stop-pb:contact', normally: 'closed' },
      { kind: 'load', id: 'plc-start-input', positiveTerminal: 'P03', returnTerminal: 'COMI', role: 'digital-input', required: 'scenario', resistanceOhms: 5600, onThresholdVoltage: 15, onThresholdCurrentA: 0.003 },
      { kind: 'load', id: 'plc-stop-input', positiveTerminal: 'P02', returnTerminal: 'COMI', role: 'digital-input', required: 'scenario', resistanceOhms: 5600, onThresholdVoltage: 15, onThresholdCurrentA: 0.003 },
      { kind: 'contact', id: 'plc-p21-contact', terminalA: 'COM0', terminalB: 'P21', stateKey: 'plc:P21', normally: 'open' },
      { kind: 'load', id: 'relay-coil', positiveTerminal: '14', returnTerminal: '13', role: 'coil', polarity: 'positive-return', required: 'scenario', resistanceOhms: 662, onThresholdVoltage: 19.2 },
      { kind: 'contact', id: 'relay-no1', terminalA: '9', terminalB: '5', stateKey: 'relay:no1', normally: 'open', drivenBy: { elementId: 'relay-coil', mode: 'closed-when-energized' } },
      { kind: 'load', id: 'run-lamp', positiveTerminal: '+', returnTerminal: '-', role: 'load', required: 'scenario', resistanceOhms: 1200, onThresholdVoltage: 20 },
    ],
    branches,
    reviewScope: { elementIds: ['plc-power', 'start-pb', 'stop-pb', 'plc-start-input', 'plc-stop-input', 'plc-p21-contact', 'relay-coil', 'relay-no1', 'run-lamp'] },
  };
}

const definition: XbcRelayLampSliceDefinition = {
  startInputBindingId: 'start-input',
  stopInputBindingId: 'stop-input',
  runOutputBindingId: 'run-output',
  startInputElementId: 'plc-start-input',
  stopInputElementId: 'plc-stop-input',
  stopInputEncoding: 'active-high-stop-request',
  plcPowerElementId: 'plc-power',
  startContactStateKey: 'start-pb:contact',
  stopContactStateKey: 'stop-pb:contact',
  plcOutputContactStateKey: 'plc:P21',
  relayCoilElementId: 'relay-coil',
  lampElementId: 'run-lamp',
  relayBehaviorProfile: MY2N_D2_DC24_BEHAVIOR,
};

async function connectedAdapter(): Promise<MockPlcRuntimeAdapter> {
  let run = false;
  const adapter = new MockPlcRuntimeAdapter(({ inputs }) => {
    if (inputs['stop-input'] === true) run = false;
    else if (inputs['start-input'] === true) run = true;
    return { 'run-output': run };
  });
  await adapter.connect({
    sessionNonce: 'fedcba9876543210fedcba9876543210',
    cpuModel: 'XGB-XBCH',
    projectId: 'self-hold-fixture',
    projectSha256,
    base: 0,
    slot: 0,
    bindings,
  });
  return adapter;
}

describe('XBC relay/lamp runtime vertical slice', () => {
  it('runs start NO -> PLC latch -> P21 dry contact -> MY2N coil -> lamp, then releases through stop NC', async () => {
    const adapter = await connectedAdapter();
    let relay = createInitialDeviceBehaviorSnapshot(MY2N_D2_DC24_BEHAVIOR);
    const started = await runXbcRelayLampFrame(adapter, {
      frameNumber: 1,
      workshop: workshop(),
      definition,
      controls: { startPressed: true, stopPressed: false },
      expectedRunOutput: true,
      previousRelayState: relay,
    });
    relay = started.relayState;
    expect(started.frame.plcInputs).toMatchObject({ 'start-input': true, 'stop-input': false });
    expect(started.frame.plcOutputs['run-output']).toBe(true);
    expect(started.frame.circuitSolution.loads['relay-coil']).toMatchObject({ energized: true, voltageV: 24 });
    expect(started.frame.circuitSolution.loads['run-lamp'].energized).toBe(true);
    expect(relay.state).toBe('energized');
    expect(assessFunctionalSimulation({
      workshop: workshop(),
      frame: started.frame,
      prewireStatus: 'PASS',
      requiredDeviceProfilesEligible: true,
      requiredOutputBindingIds: ['run-output'],
      requiredDeviceStateIds: ['relay-coil', 'run-lamp'],
      projectIdentityVerified: true,
    }).status).toBe('SIL_PASS');

    const held = await runXbcRelayLampFrame(adapter, {
      frameNumber: 2,
      workshop: workshop(),
      definition,
      controls: { startPressed: false, stopPressed: false },
      expectedRunOutput: true,
      previousRelayState: relay,
    });
    expect(held.frame.plcOutputs['run-output']).toBe(true);

    const stopped = await runXbcRelayLampFrame(adapter, {
      frameNumber: 3,
      workshop: workshop(),
      definition,
      controls: { startPressed: false, stopPressed: true },
      expectedRunOutput: false,
      previousRelayState: held.relayState,
    });
    expect(stopped.frame.plcInputs['stop-input']).toBe(true);
    expect(stopped.frame.plcOutputs['run-output']).toBe(false);
    expect(stopped.frame.circuitSolution.loads['relay-coil'].energized).toBe(false);
    expect(stopped.frame.circuitSolution.loads['run-lamp'].energized).toBe(false);
  });

  it('keeps the physical load off when P21 is ON but the coil return is open', async () => {
    const adapter = await connectedAdapter();
    const result = await runXbcRelayLampFrame(adapter, {
      frameNumber: 1,
      workshop: workshop({ coilReturn: false }),
      definition,
      controls: { startPressed: true, stopPressed: false },
      expectedRunOutput: true,
      previousRelayState: createInitialDeviceBehaviorSnapshot(MY2N_D2_DC24_BEHAVIOR),
    });
    expect(result.frame.plcOutputs['run-output']).toBe(true);
    expect(result.frame.circuitSolution.loads['relay-coil']).toMatchObject({ energized: false, state: 'OPEN_RETURN_PATH' });
    expect(result.frame.circuitSolution.loads['run-lamp'].energized).toBe(false);
    expect(result.frame.deviceStates['relay-coil']).toBe('deenergized');
    expect(result.frame.issues.map((issue) => issue.code)).toContain('PLC_OUTPUT_LOAD_INACTIVE');
    expect(assessFunctionalSimulation({
      workshop: workshop({ coilReturn: false }),
      frame: result.frame,
      prewireStatus: 'PASS',
      requiredDeviceProfilesEligible: true,
      requiredOutputBindingIds: ['run-output'],
      requiredDeviceStateIds: ['relay-coil', 'run-lamp'],
      projectIdentityVerified: true,
    }).status).toBe('FAIL');
  });

  it.each([
    ['output COM open', { outputCommon: false }, 'OPEN_SOURCE_PATH', true],
    ['PLC power open', { plcPower: false }, 'PLC_POWER_UNAVAILABLE', false],
  ])('fails safe with %s', async (_name, options, expectedCode, expectedRunOutput) => {
    const adapter = await connectedAdapter();
    const result = await runXbcRelayLampFrame(adapter, {
      frameNumber: 1,
      workshop: workshop(options),
      definition,
      controls: { startPressed: true, stopPressed: false },
      expectedRunOutput,
      previousRelayState: createInitialDeviceBehaviorSnapshot(MY2N_D2_DC24_BEHAVIOR),
    });
    expect(result.frame.circuitSolution.loads['relay-coil'].energized).toBe(false);
    expect(result.frame.circuitSolution.loads['run-lamp'].energized).toBe(false);
    expect(result.frame.issues.map((issue) => issue.code)).toContain(expectedCode);
  });
});
