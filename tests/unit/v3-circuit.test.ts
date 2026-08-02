import { describe, expect, it } from 'vitest';
import {
  buildCircuitModel,
  createVirtualMultimeter,
  isValidationCurrent,
  simulateScenario,
  solveCircuit,
  validateWorkshopV3,
  type WorkshopDocumentV3,
} from '../../src/domain/v3';

const source = { id: 'psu', positiveTerminal: '+24', returnTerminal: '0V', voltage: 24 as const };
const load = { kind: 'load' as const, id: 'lamp', positiveTerminal: '+', returnTerminal: '-' };

function branch(id: string, from: string, fromTerminal: string, to: string, toTerminal: string, conductor: 'dc' | 'pe' = 'dc') {
  return { id, from: { elementId: from, terminalId: fromTerminal }, to: { elementId: to, terminalId: toTerminal }, conductor };
}

function document(branches: WorkshopDocumentV3['branches'] = []): WorkshopDocumentV3 {
  return {
    schemaVersion: 3,
    revision: 7,
    hash: 'v3-fixture-hash',
    sources: [source],
    elements: [load],
    branches,
    reviewScope: { elementIds: ['lamp'] },
  };
}

describe('v3 closed-loop DC solver', () => {
  it('energizes a load only when its +24 V and 0 V paths close a loop', () => {
    const model = buildCircuitModel(document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
    ]));

    expect(solveCircuit(model).loads.lamp).toMatchObject({ energized: true, state: 'ON' });
  });

  it('energizes a configurable PLC input in both source and sink COM orientations', () => {
    const buildInput = (reversed: boolean) => {
      const doc = document([
        branch('high', 'psu', '+24', 'input', reversed ? 'COM' : 'P00'),
        branch('low', 'input', reversed ? 'P00' : 'COM', 'psu', '0V'),
      ]);
      doc.elements = [{
        kind: 'load',
        id: 'input',
        positiveTerminal: 'P00',
        returnTerminal: 'COM',
        role: 'digital-input',
        polarity: 'either',
        resistanceOhms: 5600,
        onThresholdVoltage: 19,
        onThresholdCurrentA: 0.003,
      }];
      doc.reviewScope = { elementIds: ['input'] };
      return solveCircuit(buildCircuitModel(doc)).loads.input;
    };

    expect(buildInput(false)).toMatchObject({ energized: true, state: 'ON', voltageV: 24 });
    expect(buildInput(true)).toMatchObject({ energized: true, state: 'ON', voltageV: -24 });
    expect(buildInput(true).currentA).toBeCloseTo(24 / 5600);
  });

  it('identifies the exact missing side of an incomplete reversed-COM input circuit', () => {
    const input = {
      kind: 'load' as const,
      id: 'input',
      positiveTerminal: 'P00',
      returnTerminal: 'COM',
      role: 'digital-input' as const,
      polarity: 'either' as const,
      resistanceOhms: 5600,
    };
    const highOnly = document([branch('high', 'psu', '+24', 'input', 'COM')]);
    highOnly.elements = [input];
    highOnly.reviewScope = { elementIds: ['input'] };
    const lowOnly = document([branch('low', 'input', 'P00', 'psu', '0V')]);
    lowOnly.elements = [input];
    lowOnly.reviewScope = { elementIds: ['input'] };

    const highSolution = solveCircuit(buildCircuitModel(highOnly));
    const lowSolution = solveCircuit(buildCircuitModel(lowOnly));

    expect(highSolution.loads.input).toMatchObject({
      state: 'OPEN_RETURN_PATH',
      sourcePath: { branchIds: ['high'] },
      returnPath: null,
    });
    expect(highSolution.issues.find((entry) => entry.code === 'OPEN_RETURN_PATH')?.refs).toEqual(['input:P00']);
    expect(lowSolution.loads.input).toMatchObject({
      state: 'OPEN_SOURCE_PATH',
      sourcePath: null,
      returnPath: { branchIds: ['low'] },
    });
    expect(lowSolution.issues.find((entry) => entry.code === 'OPEN_SOURCE_PATH')?.refs).toEqual(['input:COM']);
  });

  it.each([
    {
      name: 'NPN',
      mode: 'sinking' as const,
      comSourceTerminal: '+24',
    },
    {
      name: 'PNP',
      mode: 'sourcing' as const,
      comSourceTerminal: '0V',
    },
  ])('energizes an XBC input through a powered $name three-wire sensor only when BK is ON', ({
    mode,
    comSourceTerminal,
  }) => {
    const doc = document([
      branch('sensor-power+', 'psu', '+24', 'sensor-supply', '+'),
      branch('sensor-power0', 'sensor-supply', '-', 'psu', '0V'),
      branch('output-power+', 'psu', '+24', 'sensor-output', 'BN'),
      branch('output-power0', 'sensor-output', 'BU', 'psu', '0V'),
      branch('plc-com', 'psu', comSourceTerminal, 'input', 'COM'),
      branch('sensor-bk', 'sensor-output', 'BK', 'input', 'P00'),
    ]);
    doc.elements = [
      {
        kind: 'load', id: 'sensor-supply', positiveTerminal: '+', returnTerminal: '-',
        role: 'module-supply', resistanceOhms: 2400, onThresholdVoltage: 20.4,
      },
      {
        kind: 'transistor-output', id: 'sensor-output',
        supplyPositiveTerminal: 'BN', supplyReturnTerminal: 'BU', outputTerminal: 'BK',
        mode, stateKey: 'sensor:detect', supplyElementId: 'sensor-supply',
      },
      {
        kind: 'load', id: 'input', positiveTerminal: 'P00', returnTerminal: 'COM',
        role: 'digital-input', polarity: 'either', resistanceOhms: 3300,
        onThresholdVoltage: 19, onThresholdCurrentA: 0.003,
      },
    ];
    doc.reviewScope = { elementIds: doc.elements.map((element) => element.id) };

    const off = simulateScenario(doc, { id: 'off', contactStates: { 'sensor:detect': false } });
    const on = simulateScenario(doc, { id: 'on', contactStates: { 'sensor:detect': true } });

    expect(off.solution.loads.input.energized).toBe(false);
    expect(on.solution.loads.input).toMatchObject({ energized: true, state: 'ON' });
    expect(on.solution.elements['sensor-output']).toMatchObject({
      kind: 'transistor-output',
      state: 'OUTPUT_ON',
    });
    expect(on.solution.continuityGroups['sensor-output:BK'])
      .toBe(on.solution.continuityGroups[`sensor-output:${mode === 'sinking' ? 'BU' : 'BN'}`]);
  });

  it('keeps a commanded transistor output open when the sensor BN/BU supply pair is incomplete', () => {
    const doc = document([
      branch('sensor-return-only', 'sensor-output', 'BU', 'psu', '0V'),
      branch('plc-com', 'psu', '+24', 'input', 'COM'),
      branch('sensor-bk', 'sensor-output', 'BK', 'input', 'P00'),
    ]);
    doc.elements = [
      {
        kind: 'load', id: 'sensor-supply', positiveTerminal: '+', returnTerminal: '-',
        role: 'module-supply', resistanceOhms: 2400, onThresholdVoltage: 20.4,
      },
      {
        kind: 'transistor-output', id: 'sensor-output',
        supplyPositiveTerminal: 'BN', supplyReturnTerminal: 'BU', outputTerminal: 'BK',
        mode: 'sinking', stateKey: 'sensor:detect', supplyElementId: 'sensor-supply',
      },
      {
        kind: 'load', id: 'input', positiveTerminal: 'P00', returnTerminal: 'COM',
        role: 'digital-input', polarity: 'either', resistanceOhms: 3300,
      },
    ];
    doc.reviewScope = { elementIds: doc.elements.map((element) => element.id) };

    const result = simulateScenario(doc, { id: 'unpowered', contactStates: { 'sensor:detect': true } });

    expect(result.solution.loads.input.energized).toBe(false);
    expect(result.solution.elements['sensor-output'].state).toBe('OUTPUT_UNPOWERED');
    expect(result.solution.issues.map((entry) => entry.code)).toContain('TRANSISTOR_OUTPUT_UNPOWERED');
  });

  it('keeps a fully wired PLC input inactive below its manual voltage/current threshold', () => {
    const doc = document([
      branch('high', 'psu', '+24', 'input', 'P00'),
      branch('low', 'input', 'COM', 'psu', '0V'),
    ]);
    doc.sources = [{ ...source, voltage: 12 }];
    doc.elements = [{
      kind: 'load',
      id: 'input',
      positiveTerminal: 'P00',
      returnTerminal: 'COM',
      role: 'digital-input',
      polarity: 'either',
      resistanceOhms: 5600,
      onThresholdVoltage: 19,
      onThresholdCurrentA: 0.003,
    }];
    doc.reviewScope = { elementIds: ['input'] };

    const solution = solveCircuit(buildCircuitModel(doc));
    const validation = validateWorkshopV3(doc);

    expect(solution.loads.input).toMatchObject({
      energized: false,
      state: 'BELOW_THRESHOLD',
      voltageV: 12,
      currentA: 12 / 5600,
    });
    expect(solution.branchCurrents.high).toEqual({
      currentA: 12 / 5600,
      loadIds: ['input'],
    });
    expect(solution.elements.psu.currentA).toBeCloseTo(12 / 5600);
    expect(validation.status).toBe('FAIL');
    expect(validation.issues.map((entry) => entry.code)).toContain('INPUT_CURRENT_BELOW_THRESHOLD');
  });

  it('keeps a fully wired coil inactive below its pickup voltage', () => {
    const doc = document([
      branch('high', 'psu', '+24', 'coil', 'A1'),
      branch('low', 'coil', 'A2', 'psu', '0V'),
    ]);
    doc.sources = [{ ...source, voltage: 12 }];
    doc.elements = [{
      kind: 'load',
      id: 'coil',
      positiveTerminal: 'A1',
      returnTerminal: 'A2',
      role: 'coil',
      onThresholdVoltage: 20.4,
    }];
    doc.reviewScope = { elementIds: ['coil'] };

    const solution = solveCircuit(buildCircuitModel(doc));
    const validation = validateWorkshopV3(doc);

    expect(solution.loads.coil).toMatchObject({ energized: false, state: 'INACTIVE', voltageV: 12 });
    expect(validation.issues.map((entry) => entry.code)).toContain('LOAD_INACTIVE');
  });

  it('reports terminal voltage, resistive load current, and deterministic source/return paths', () => {
    const doc = document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
    ]);
    doc.elements = [{ ...load, resistanceOhms: 1200 }];

    const solution = solveCircuit(buildCircuitModel(doc));

    expect(solution.elements.lamp).toEqual({
      kind: 'load',
      state: 'ON',
      terminals: {
        '+': { state: 'positive', voltageV: 24 },
        '-': { state: 'return', voltageV: 0 },
      },
      voltageV: 24,
      currentA: 0.02,
      sourceId: 'psu',
      sourcePath: {
        sourceId: 'psu',
        terminalKeys: ['psu:+24', 'lamp:+'],
        branchIds: ['positive'],
      },
      returnPath: {
        sourceId: 'psu',
        terminalKeys: ['lamp:-', 'psu:0V'],
        branchIds: ['return'],
      },
    });
    expect(solution.branchCurrents.positive).toEqual({ currentA: 0.02, loadIds: ['lamp'] });
    expect(solution.branchCurrents.return).toEqual({ currentA: 0.02, loadIds: ['lamp'] });
    expect(solution.elements.psu).toMatchObject({
      kind: 'source',
      state: 'SOURCE_ACTIVE',
      voltageV: 24,
      currentA: 0.02,
      terminals: {
        '+24': { state: 'positive', voltageV: 24 },
        '0V': { state: 'return', voltageV: 0 },
      },
    });
  });

  it('chooses the same source path when equivalent branches are supplied in a different order', () => {
    const routeA = [
      branch('a-1', 'psu', '+24', 'junction-a', 'T'),
      branch('a-2', 'junction-a', 'T', 'lamp', '+'),
    ];
    const routeZ = [
      branch('z-1', 'psu', '+24', 'junction-z', 'T'),
      branch('z-2', 'junction-z', 'T', 'lamp', '+'),
    ];
    const build = (branches: WorkshopDocumentV3['branches']) => {
      const doc = document([...branches, branch('return', 'lamp', '-', 'psu', '0V')]);
      doc.elements = [load,
        { kind: 'device', id: 'junction-a', terminals: ['T'] },
        { kind: 'device', id: 'junction-z', terminals: ['T'] },
      ];
      doc.reviewScope = { elementIds: ['lamp', 'junction-a', 'junction-z'] };
      return solveCircuit(buildCircuitModel(doc)).elements.lamp.sourcePath;
    };

    expect(build([...routeZ, ...routeA])).toEqual(build([...routeA, ...routeZ]));
    expect(build([...routeZ, ...routeA])?.branchIds).toEqual(['a-1', 'a-2']);
  });

  it('provides pure two-point voltage/continuity measurements and branch-current lookup', () => {
    const doc = document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
    ]);
    doc.elements = [{ ...load, resistanceOhms: 2400 }];
    const meter = createVirtualMultimeter(solveCircuit(buildCircuitModel(doc)));

    expect(meter.voltage({ elementId: 'lamp', terminalId: '+' }, { elementId: 'lamp', terminalId: '-' }))
      .toEqual({ status: 'measured', voltageV: 24 });
    expect(meter.voltage({ elementId: 'lamp', terminalId: '-' }, { elementId: 'lamp', terminalId: '+' }))
      .toEqual({ status: 'measured', voltageV: -24 });
    expect(meter.continuity({ elementId: 'psu', terminalId: '+24' }, { elementId: 'lamp', terminalId: '+' }))
      .toEqual({ status: 'measured', continuous: true });
    expect(meter.continuity({ elementId: 'lamp', terminalId: '+' }, { elementId: 'lamp', terminalId: '-' }))
      .toEqual({ status: 'measured', continuous: false });
    expect(meter.branchCurrent('positive')).toEqual({ status: 'measured', currentA: 0.01, loadIds: ['lamp'] });
    expect(meter.branchCurrent('missing')).toEqual({ status: 'unknown-branch', currentA: null, loadIds: [] });
  });

  it('measures physical continuity across a PE conductor without using PE as a DC return path', () => {
    const doc = document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('protective-earth', 'lamp', '-', 'psu', '0V', 'pe'),
    ]);
    const solution = solveCircuit(buildCircuitModel(doc));
    const meter = createVirtualMultimeter(solution);

    expect(solution.loads.lamp.state).toBe('OPEN_RETURN_PATH');
    expect(meter.continuity({ elementId: 'lamp', terminalId: '-' }, { elementId: 'psu', terminalId: '0V' }))
      .toEqual({ status: 'measured', continuous: true });
    expect(meter.voltage({ elementId: 'lamp', terminalId: '+' }, { elementId: 'lamp', terminalId: '-' }))
      .toEqual({ status: 'measured', voltageV: 24 });
    expect(meter.branchCurrent('protective-earth')).toEqual({ status: 'indeterminate', currentA: null, loadIds: [] });
  });

  it('returns indeterminate voltage and zero branch current for an open resistive load', () => {
    const doc = document([branch('positive', 'psu', '+24', 'lamp', '+')]);
    doc.elements = [{ ...load, resistanceOhms: 1200 }];
    const solution = solveCircuit(buildCircuitModel(doc));
    const meter = createVirtualMultimeter(solution);

    expect(solution.elements.lamp).toMatchObject({ state: 'OPEN_RETURN_PATH', voltageV: null, currentA: 0 });
    expect(solution.elements.lamp.sourcePath?.branchIds).toEqual(['positive']);
    expect(solution.elements.lamp.returnPath).toBeNull();
    expect(meter.voltage({ elementId: 'lamp', terminalId: '+' }, { elementId: 'lamp', terminalId: '-' }))
      .toEqual({ status: 'indeterminate', voltageV: null });
    expect(meter.branchCurrent('positive')).toEqual({ status: 'measured', currentA: 0, loadIds: [] });
  });

  it('sums known resistive currents on a shared feeder branch', () => {
    const doc = document([
      branch('feed', 'psu', '+24', 'bus', 'T'),
      branch('lamp-1-positive', 'bus', 'T', 'lamp-1', '+'),
      branch('lamp-2-positive', 'bus', 'T', 'lamp-2', '+'),
      branch('lamp-1-return', 'lamp-1', '-', 'psu', '0V'),
      branch('lamp-2-return', 'lamp-2', '-', 'psu', '0V'),
    ]);
    doc.elements = [
      { ...load, id: 'lamp-1', resistanceOhms: 1200 },
      { ...load, id: 'lamp-2', resistanceOhms: 1200 },
      { kind: 'device', id: 'bus', terminals: ['T'] },
    ];
    doc.reviewScope = { elementIds: ['lamp-1', 'lamp-2', 'bus'] };

    const meter = createVirtualMultimeter(solveCircuit(buildCircuitModel(doc)));

    expect(meter.branchCurrent('feed')).toEqual({ status: 'measured', currentA: 0.04, loadIds: ['lamp-1', 'lamp-2'] });
    expect(meter.branchCurrent('lamp-1-positive')).toEqual({ status: 'measured', currentA: 0.02, loadIds: ['lamp-1'] });
  });

  it('keeps current indeterminate when an energized load has no resistance model', () => {
    const solution = solveCircuit(buildCircuitModel(document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
    ])));
    const meter = createVirtualMultimeter(solution);

    expect(solution.elements.lamp).toMatchObject({ state: 'ON', voltageV: 24, currentA: null });
    expect(meter.branchCurrent('positive')).toEqual({ status: 'indeterminate', currentA: null, loadIds: ['lamp'] });
  });

  it('reports an open return path when the load negative side is not connected', () => {
    const result = validateWorkshopV3(document([branch('positive', 'psu', '+24', 'lamp', '+')]));

    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('OPEN_RETURN_PATH');
  });

  it('reports an open source path when the load positive side is not connected', () => {
    const result = validateWorkshopV3(document([branch('return', 'lamp', '-', 'psu', '0V')]));

    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('OPEN_SOURCE_PATH');
  });

  it('reports a reversed load polarity instead of energizing it', () => {
    const result = validateWorkshopV3(document([
      branch('wrong-positive', 'psu', '+24', 'lamp', '-'),
      branch('wrong-return', 'lamp', '+', 'psu', '0V'),
    ]));

    expect(result.issues.map((issue) => issue.code)).toContain('LOAD_REVERSED');
    expect(solveCircuit(buildCircuitModel(document([
      branch('wrong-positive', 'psu', '+24', 'lamp', '-'),
      branch('wrong-return', 'lamp', '+', 'psu', '0V'),
    ]))).loads.lamp.energized).toBe(false);
  });

  it('rejects a conductor that bypasses the load and shorts +24 V to 0 V', () => {
    const result = validateWorkshopV3(document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
      branch('bypass', 'psu', '+24', 'psu', '0V'),
    ]));

    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('DC_SHORT');
  });

  it('does not accept PE as a DC return conductor', () => {
    const result = validateWorkshopV3(document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('protective-earth', 'lamp', '-', 'psu', '0V', 'pe'),
    ]));

    expect(result.issues.map((issue) => issue.code)).toContain('OPEN_RETURN_PATH');
    expect(solveCircuit(buildCircuitModel(document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('protective-earth', 'lamp', '-', 'psu', '0V', 'pe'),
    ]))).loads.lamp.energized).toBe(false);
  });

  it('rejects two independent source pairs wired in parallel', () => {
    const doc = document([
      branch('positive-rails', 'psu', '+24', 'psu2', '+24'),
      branch('return-rails', 'psu', '0V', 'psu2', '0V'),
      branch('load-positive', 'psu', '+24', 'lamp', '+'),
      branch('load-return', 'lamp', '-', 'psu', '0V'),
    ]);
    doc.sources = [source, { ...source, id: 'psu2' }];

    const result = validateWorkshopV3(doc);
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((entry) => entry.code)).toContain('PARALLEL_SOURCE');
  });

  it('blocks a device outside the explicit review scope', () => {
    const doc = document();
    doc.elements = [{ kind: 'device', id: 'unscoped', terminals: ['A'] }];
    doc.reviewScope = { elementIds: [] };

    const result = validateWorkshopV3(doc);
    expect(result.status).toBe('BLOCKED');
    expect(result.issues.map((issue) => issue.code)).toContain('REVIEW_SCOPE_INCOMPLETE');
  });
});

describe('v3 scenario fixed point and validation freshness', () => {
  it('closes a contact only from a fully energized two-terminal coil branch', () => {
    const doc = document([
      branch('coil-positive', 'psu', '+24', 'coil', 'A1'),
      branch('coil-return', 'coil', 'A2', 'psu', '0V'),
      branch('positive', 'psu', '+24', 'contact', 'A'),
      branch('switched-positive', 'contact', 'B', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
    ]);
    doc.elements = [
      load,
      { kind: 'load', id: 'coil', positiveTerminal: 'A1', returnTerminal: 'A2', role: 'coil' },
      {
        kind: 'contact', id: 'contact', terminalA: 'A', terminalB: 'B', stateKey: 'coil', normally: 'open',
        drivenBy: { elementId: 'coil', mode: 'closed-when-energized' },
      },
    ];
    doc.reviewScope = { elementIds: ['lamp', 'coil', 'contact'] };

    const result = simulateScenario(doc, { id: 'energize-contact' });
    const baselineValidation = validateWorkshopV3(doc);

    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(32);
    expect(result.solution.loads.lamp.energized).toBe(true);
    expect(baselineValidation.status).toBe('PASS');
    expect(baselineValidation.issues.map((entry) => entry.code)).not.toContain('OPEN_SOURCE_PATH');
  });

  it('does not close a contact when only one side of the sensed coil has potential', () => {
    const doc = document([
      branch('coil-positive', 'psu', '+24', 'coil', 'A1'),
      branch('positive', 'psu', '+24', 'contact', 'A'),
      branch('switched-positive', 'contact', 'B', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
    ]);
    doc.elements = [
      load,
      { kind: 'load', id: 'coil', positiveTerminal: 'A1', returnTerminal: 'A2', role: 'coil' },
      {
        kind: 'contact', id: 'contact', terminalA: 'A', terminalB: 'B', stateKey: 'coil', normally: 'open',
        drivenBy: { elementId: 'coil', mode: 'closed-when-energized' },
      },
    ];
    doc.reviewScope = { elementIds: ['lamp', 'coil', 'contact'] };

    const result = simulateScenario(doc, { id: 'open-coil-return' });

    expect(result.converged).toBe(true);
    expect(result.contactStates.coil).toBe(false);
    expect(result.solution.loads.lamp.energized).toBe(false);
  });

  it('blocks an invalid contact-rule target or sensed-element mapping without changing contact state', () => {
    const doc = document([
      branch('coil-positive', 'psu', '+24', 'coil', 'A1'),
      branch('coil-return', 'coil', 'A2', 'psu', '0V'),
    ]);
    doc.elements = [
      load,
      { kind: 'load', id: 'coil', positiveTerminal: 'A1', returnTerminal: 'A2', role: 'coil' },
      { kind: 'contact', id: 'contact', terminalA: 'A', terminalB: 'B', stateKey: 'coil', normally: 'open' },
    ];
    doc.reviewScope = { elementIds: ['lamp', 'coil', 'contact'] };

    const badTarget = simulateScenario(doc, {
      id: 'bad-target',
      contactRules: [{ stateKey: 'missing-contact', senseElementId: 'coil', mode: 'closed-when-energized' }],
    });
    const badSense = simulateScenario(doc, {
      id: 'bad-sense',
      contactRules: [{ stateKey: 'coil', senseElementId: 'contact', mode: 'closed-when-energized' }],
    });
    const badMapping = simulateScenario(doc, {
      id: 'bad-mapping',
      contactRules: [{ stateKey: 'coil', senseElementId: 'coil', sense: { elementId: 'coil', terminalId: 'wrong' }, mode: 'closed-when-energized' }],
    });

    for (const result of [badTarget, badSense, badMapping]) {
      expect(result.converged).toBe(false);
      expect(result.iterations).toBe(0);
      expect(result.validation.status).toBe('BLOCKED');
      expect(result.validation.issues.map((entry) => entry.code)).toContain('INVALID_CONTACT_RULE');
      expect(result.contactStates.coil).toBeUndefined();
    }
  });

  it('does not allow a scenario to detach a built-in contact from its physical coil', () => {
    const doc = document([
      branch('coil-positive', 'psu', '+24', 'coil', 'A1'),
      branch('coil-return', 'coil', 'A2', 'psu', '0V'),
    ]);
    doc.elements = [
      load,
      { kind: 'load', id: 'coil', positiveTerminal: 'A1', returnTerminal: 'A2', role: 'coil' },
      { kind: 'load', id: 'other-coil', positiveTerminal: 'A1', returnTerminal: 'A2', role: 'coil' },
      {
        kind: 'contact', id: 'contact', terminalA: 'A', terminalB: 'B', stateKey: 'coil-contact', normally: 'open',
        drivenBy: { elementId: 'coil', mode: 'closed-when-energized' },
      },
    ];
    doc.reviewScope = { elementIds: ['lamp', 'coil', 'other-coil', 'contact'] };

    const result = simulateScenario(doc, {
      id: 'illegal-override',
      contactRules: [{
        stateKey: 'coil-contact',
        senseElementId: 'other-coil',
        mode: 'closed-when-energized',
      }],
    });

    expect(result.validation.status).toBe('BLOCKED');
    expect(result.validation.issues.map((entry) => entry.code)).toContain('INVALID_CONTACT_RULE');
  });

  it('makes validation snapshots stale when either revision or hash changes', () => {
    const doc = document([
      branch('positive', 'psu', '+24', 'lamp', '+'),
      branch('return', 'lamp', '-', 'psu', '0V'),
    ]);
    const validation = validateWorkshopV3(doc);

    expect(isValidationCurrent(validation, doc)).toBe(true);
    expect(isValidationCurrent(validation, { ...doc, revision: doc.revision + 1 })).toBe(false);
    expect(isValidationCurrent(validation, { ...doc, hash: 'new-hash' })).toBe(false);
  });
});
