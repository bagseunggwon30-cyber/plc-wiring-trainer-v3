import { describe, expect, it } from 'vitest';
import {
  buildCircuitModel,
  solveCircuit,
  validateWorkshopV3,
  type AnalogPortElement,
  type TwoWireCurrentTransmitterElement,
  type WorkshopDocumentV3,
} from '../../src/domain/v3';

const voltageSource: AnalogPortElement = {
  kind: 'analog-port',
  id: 'sim-v',
  positiveTerminal: '+',
  returnTerminal: '-',
  protocol: 'analog-voltage',
  direction: 'source',
};

const voltageInput: AnalogPortElement = {
  kind: 'analog-port',
  id: 'ai0',
  positiveTerminal: 'I0+',
  returnTerminal: 'I0-',
  protocol: 'analog-voltage',
  direction: 'sink',
};

function branch(
  id: string,
  from: string,
  fromTerminal: string,
  to: string,
  toTerminal: string,
): WorkshopDocumentV3['branches'][number] {
  return {
    id,
    from: { elementId: from, terminalId: fromTerminal },
    to: { elementId: to, terminalId: toTerminal },
    conductor: 'signal',
  };
}

function document(
  elements: AnalogPortElement[],
  branches: WorkshopDocumentV3['branches'],
): WorkshopDocumentV3 {
  return {
    schemaVersion: 3,
    revision: 1,
    hash: 'analog-fixture',
    sources: [],
    elements,
    branches,
    reviewScope: { elementIds: elements.map((element) => element.id) },
  };
}

describe('v3 analog two-conductor solver', () => {
  it('accepts an analog source only when signal + and return/G both reach one compatible input', () => {
    const doc = document([voltageSource, voltageInput], [
      branch('signal-plus', 'sim-v', '+', 'ai0', 'I0+'),
      branch('signal-return', 'ai0', 'I0-', 'sim-v', '-'),
    ]);

    const solution = solveCircuit(buildCircuitModel(doc));

    expect(solution.analogPorts['sim-v']).toMatchObject({
      connected: true,
      state: 'CONNECTED',
      peerId: 'ai0',
      sourceId: 'sim-v',
      sourcePath: { branchIds: ['signal-plus'] },
      returnPath: { branchIds: ['signal-return'] },
    });
    expect(solution.analogPorts.ai0).toMatchObject({ connected: true, state: 'CONNECTED' });
    expect(validateWorkshopV3(doc).status).toBe('PASS');
  });

  it('reports the missing G/return conductor when only signal + is connected', () => {
    const doc = document([voltageSource, voltageInput], [
      branch('signal-plus', 'sim-v', '+', 'ai0', 'I0+'),
    ]);

    const solution = solveCircuit(buildCircuitModel(doc));

    expect(solution.analogPorts.ai0.state).toBe('OPEN_RETURN_PATH');
    expect(solution.issues.map((entry) => entry.code)).toContain('ANALOG_RETURN_PATH_OPEN');
    expect(validateWorkshopV3(doc).status).toBe('FAIL');
  });

  it('rejects reversed signal polarity, voltage/current mixing and two outputs tied together', () => {
    const currentInput: AnalogPortElement = {
      ...voltageInput,
      id: 'current-ai',
      protocol: 'analog-current',
    };
    const secondSource: AnalogPortElement = {
      ...voltageSource,
      id: 'sim-v-2',
    };

    const reversed = solveCircuit(buildCircuitModel(document([voltageSource, voltageInput], [
      branch('wrong-plus', 'sim-v', '+', 'ai0', 'I0-'),
      branch('wrong-return', 'sim-v', '-', 'ai0', 'I0+'),
    ])));
    expect(reversed.issues.map((entry) => entry.code)).toContain('ANALOG_POLARITY_REVERSED');

    const wrongMode = solveCircuit(buildCircuitModel(document([voltageSource, currentInput], [
      branch('plus', 'sim-v', '+', 'current-ai', 'I0+'),
      branch('return', 'sim-v', '-', 'current-ai', 'I0-'),
    ])));
    expect(wrongMode.issues.map((entry) => entry.code)).toContain('ANALOG_MODE_MISMATCH');

    const wrongDirection = solveCircuit(buildCircuitModel(document([voltageSource, secondSource], [
      branch('plus', 'sim-v', '+', 'sim-v-2', '+'),
      branch('return', 'sim-v', '-', 'sim-v-2', '-'),
    ])));
    expect(wrongDirection.issues.map((entry) => entry.code)).toContain('ANALOG_DIRECTION_MISMATCH');
  });

  it('rejects a direct signal + to return/G short', () => {
    const doc = document([voltageSource], [
      branch('short', 'sim-v', '+', 'sim-v', '-'),
    ]);

    const solution = solveCircuit(buildCircuitModel(doc));

    expect(solution.analogPorts['sim-v'].state).toBe('SHORTED');
    expect(solution.issues.map((entry) => entry.code)).toContain('ANALOG_SIGNAL_SHORT');
  });
});

describe('v3 loop-powered 2-wire 4–20 mA solver', () => {
  const transmitter: TwoWireCurrentTransmitterElement = {
    kind: 'two-wire-current-transmitter',
    id: 'tx',
    positiveTerminal: '+',
    negativeTerminal: '-',
    currentA: 0.012,
    minimumOperatingVoltageV: 12,
    maximumLoopVoltageV: 30,
  };
  const currentInput: AnalogPortElement = {
    kind: 'analog-port',
    id: 'ai0',
    positiveTerminal: 'I0+',
    returnTerminal: 'I0-',
    protocol: 'analog-current',
    direction: 'sink',
    inputResistanceOhms: 250,
    maximumCurrentA: 0.025,
  };
  const loopDocument = (
    branches: WorkshopDocumentV3['branches'],
    tx: TwoWireCurrentTransmitterElement = transmitter,
    input: AnalogPortElement = currentInput,
  ): WorkshopDocumentV3 => ({
    schemaVersion: 3,
    revision: 2,
    hash: 'current-loop-fixture',
    sources: [{ kind: 'dc', id: 'dc', positiveTerminal: '+', returnTerminal: '-', voltage: 24 }],
    elements: [tx, input],
    branches,
    reviewScope: { elementIds: [tx.id, input.id] },
  });

  it('requires +24V → TX+ → TX− → I+ → I− → the same 0V and solves the receiver burden', () => {
    const doc = loopDocument([
      branch('source', 'dc', '+', 'tx', '+'),
      branch('signal', 'tx', '-', 'ai0', 'I0+'),
      branch('return', 'ai0', 'I0-', 'dc', '-'),
    ]);

    const solution = solveCircuit(buildCircuitModel(doc));

    expect(solution.currentLoops.tx).toMatchObject({
      active: true,
      state: 'COMPLETE',
      receiverId: 'ai0',
      sourceId: 'dc',
      currentA: 0.012,
      receiverVoltageV: 3,
      transmitterVoltageV: 21,
    });
    expect(solution.analogPorts.ai0).toMatchObject({ connected: true, state: 'CONNECTED', peerId: 'tx' });
    expect(solution.branchCurrents).toMatchObject({
      source: { currentA: 0.012, loadIds: ['tx'] },
      signal: { currentA: 0.012, loadIds: ['tx'] },
      return: { currentA: 0.012, loadIds: ['tx'] },
    });
    expect(solution.terminals['ai0:I0+']).toMatchObject({ voltageV: 3 });
    expect(validateWorkshopV3(doc).status).toBe('PASS');
  });

  it('reports the exact missing 2-wire loop segment and rejects polarity reversal', () => {
    const openReturn = solveCircuit(buildCircuitModel(loopDocument([
      branch('source', 'dc', '+', 'tx', '+'),
      branch('signal', 'tx', '-', 'ai0', 'I0+'),
    ])));
    expect(openReturn.currentLoops.tx.state).toBe('OPEN_RETURN_PATH');
    expect(openReturn.issues.map((entry) => entry.code)).toContain('CURRENT_LOOP_RETURN_PATH_OPEN');

    const reversed = solveCircuit(buildCircuitModel(loopDocument([
      branch('wrong-source', 'dc', '+', 'tx', '-'),
      branch('wrong-signal', 'tx', '+', 'ai0', 'I0+'),
      branch('return', 'ai0', 'I0-', 'dc', '-'),
    ])));
    expect(reversed.currentLoops.tx.state).toBe('POLARITY_REVERSED');
    expect(reversed.issues.map((entry) => entry.code)).toContain('CURRENT_LOOP_POLARITY_REVERSED');
  });

  it('fails insufficient compliance voltage and receiver over-current separately', () => {
    const branches = [
      branch('source', 'dc', '+', 'tx', '+'),
      branch('signal', 'tx', '-', 'ai0', 'I0+'),
      branch('return', 'ai0', 'I0-', 'dc', '-'),
    ];
    const lowHeadroom = solveCircuit(buildCircuitModel(loopDocument(
      branches,
      { ...transmitter, currentA: 0.02 },
      { ...currentInput, inputResistanceOhms: 1000 },
    )));
    expect(lowHeadroom.currentLoops.tx.state).toBe('COMPLIANCE_INSUFFICIENT');
    expect(lowHeadroom.issues.map((entry) => entry.code)).toContain('CURRENT_LOOP_COMPLIANCE_INSUFFICIENT');

    const overCurrent = solveCircuit(buildCircuitModel(loopDocument(
      branches,
      { ...transmitter, currentA: 0.03 },
    )));
    expect(overCurrent.currentLoops.tx.state).toBe('OVER_RANGE');
    expect(overCurrent.issues.map((entry) => entry.code)).toContain('CURRENT_LOOP_OVER_RANGE');
  });
});
