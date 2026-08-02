import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { buildCircuitGraph } from '../../src/domain/graph';
import { simulateScenario, validateWorkshopScenarios } from '../../src/domain/simulator';
import { validateWorkshop } from '../../src/domain/validator';
import type { DeviceInstanceV2, WireV2, WorkshopDocumentV2 } from '../../src/domain/types';

function device(id: string, profileId: string): DeviceInstanceV2 {
  const profile = DEVICE_PROFILES[profileId];
  return {
    id,
    profileId,
    profileVersion: profile?.version ?? 'missing',
    evidenceLevel: profile?.evidence.level ?? 'educational',
    missingProfile: !profile,
    x: 0,
    y: 0,
    rotation: 0,
    configuration: {},
  };
}

function wire(id: string, fromDevice: string, fromTerminal: string, toDevice: string, toTerminal: string): WireV2 {
  return {
    id,
    from: { deviceId: fromDevice, terminalId: fromTerminal },
    to: { deviceId: toDevice, terminalId: toTerminal },
  };
}

function workshop(devices: DeviceInstanceV2[], wires: WireV2[] = []): WorkshopDocumentV2 {
  return {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: 'engine test',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires,
    jumpers: [],
    layout: {},
    settings: {},
    extensions: { legacy: {} },
  };
}

describe('shared circuit graph and validation', () => {
  it('blocks unknown terminal references instead of throwing', async () => {
    const doc = workshop([device('ac', 'boundary:ac-supply')], [wire('w1', 'ac', 'NOPE', 'ac', 'N')]);
    expect(buildCircuitGraph(doc, DEVICE_PROFILES).issues[0].code).toBe('UNKNOWN_TERMINAL');
    expect((await validateWorkshop(doc, DEVICE_PROFILES)).status).toBe('BLOCKED');
  });

  it('detects phase wired to a neutral-only terminal', async () => {
    const doc = workshop(
      [device('ac', 'boundary:ac-supply'), device('psu', 'mean-well:mdr-100-24')],
      [wire('w1', 'ac', 'L2', 'psu', 'N')],
    );
    const result = await validateWorkshop(doc, DEVICE_PROFILES);
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('TERMINAL_POTENTIAL_MISMATCH');
  });

  it.each([
    ['AC_PHASE_NEUTRAL_SHORT', 'boundary:ac-supply', 'L1', 'N'],
    ['DC_SHORT', 'boundary:dc-supply', '+', '-'],
    ['PE_MIXED', 'boundary:ac-supply', 'L1', 'PE'],
  ])('detects %s', async (code, profileId, left, right) => {
    const doc = workshop([device('source', profileId)], [wire('w1', 'source', left, 'source', right)]);
    const result = await validateWorkshop(doc, DEVICE_PROFILES);
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain(code);
  });

  it('energizes MDR output only after valid L and N input are present', async () => {
    const devices = [device('ac', 'boundary:ac-supply'), device('psu', 'mean-well:mdr-100-24')];
    const off = await simulateScenario(workshop(devices, [wire('w1', 'ac', 'L1', 'psu', 'L')]), DEVICE_PROFILES, { id: 'off' });
    expect(off.scenarioId).toBe('off');
    expect(off.energizedTerminals).not.toContain('psu:V+1');

    const on = await simulateScenario(
      workshop(devices, [wire('w1', 'ac', 'L1', 'psu', 'L'), wire('w2', 'ac', 'N', 'psu', 'N')]),
      DEVICE_PROFILES,
      { id: 'on' },
    );
    expect(on.status).toBe('PASS');
    expect(on.energizedTerminals).toEqual(expect.arrayContaining(['psu:V+1', 'psu:V-1']));
  });

  it('uses jumpers identically for validation and simulation', async () => {
    const doc = workshop(
      [device('dc', 'boundary:dc-supply'), device('load', 'boundary:load')],
      [wire('w1', 'dc', '+', 'load', '+'), wire('w2', 'dc', '-', 'load', '-')],
    );
    doc.jumpers = [{ id: 'j1', deviceId: 'load', terminalIds: ['+', '-'] }];
    const graph = buildCircuitGraph(doc, DEVICE_PROFILES);
    expect(graph.edges.some((edge) => edge.kind === 'jumper')).toBe(true);
    const simulation = await simulateScenario(doc, DEVICE_PROFILES, { id: 'jumper' });
    expect(simulation.validation.issues.map((issue) => issue.code)).toContain('DC_SHORT');
  });

  it('rejects paralleling XBC internal 24V with an external DC source', async () => {
    const doc = workshop(
      [device('ac', 'boundary:ac-supply'), device('dc', 'boundary:dc-supply'), device('plc', 'ls-electric:xbc-dr32h')],
      [
        wire('w1', 'ac', 'L1', 'plc', 'L'),
        wire('w2', 'ac', 'N', 'plc', 'N'),
        wire('w3', 'dc', '+', 'plc', '24V'),
        wire('w4', 'dc', '-', 'plc', '24G'),
      ],
    );
    const result = await validateWorkshop(doc, DEVICE_PROFILES);
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('PARALLEL_SOURCE');
  });

  it('rejects mixing voltage and current analog channel modes', async () => {
    const analog = device('analog', 'ls-electric:xbf-ah04a');
    analog.configuration.xbfChannels = {
      AI0: { enabled: true, selector: 'V', parameterRange: '0-10V' },
      AI1: { enabled: true, selector: 'I', parameterRange: '4-20mA' },
      AO0: { enabled: false },
      AO1: { enabled: false },
    };
    const doc = workshop(
      [analog],
      [wire('w1', 'analog', 'I0+', 'analog', 'I1+')],
    );
    const result = await validateWorkshop(doc, DEVICE_PROFILES);
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('ANALOG_MODE_MISMATCH');
  });

  it('rejects RS485 A/B reversal while accepting like-to-like pairs', async () => {
    const devices = [device('plc', 'ls-electric:xbc-dr32h'), device('peer', 'boundary:communication-peer')];
    const reversed = await validateWorkshop(
      workshop(devices, [wire('w1', 'plc', '485+', 'peer', 'B'), wire('w2', 'plc', '485-', 'peer', 'A')]),
      DEVICE_PROFILES,
    );
    expect(reversed.status).toBe('FAIL');
    expect(reversed.issues.map((issue) => issue.code)).toContain('RS485_POLARITY_MISMATCH');

    const correct = await validateWorkshop(
      workshop(devices, [wire('w1', 'plc', '485+', 'peer', 'A'), wire('w2', 'plc', '485-', 'peer', 'B')]),
      DEVICE_PROFILES,
    );
    expect(correct.issues.map((issue) => issue.code)).not.toContain('RS485_POLARITY_MISMATCH');
  });

  it('requires RS232 TX/RX crossing instead of accepting TX-to-TX', async () => {
    const devices = [device('plc-a', 'ls-electric:xbc-dr32h'), device('plc-b', 'ls-electric:xbc-dr32h')];
    const straight = await validateWorkshop(
      workshop(devices, [wire('w1', 'plc-a', 'TX', 'plc-b', 'TX')]),
      DEVICE_PROFILES,
    );
    expect(straight.status).toBe('FAIL');
    expect(straight.issues).toContainEqual(expect.objectContaining({
      code: 'COMMUNICATION_POLARITY_MISMATCH',
    }));

    const crossed = await validateWorkshop(
      workshop(devices, [
        wire('w1', 'plc-a', 'TX', 'plc-b', 'RX'),
        wire('w2', 'plc-a', 'RX', 'plc-b', 'TX'),
        wire('w3', 'plc-a', 'SG', 'plc-b', 'SG'),
      ]),
      DEVICE_PROFILES,
    );
    expect(crossed.status).toBe('PASS');
  });
});

describe('PLC force and deterministic simulation', () => {
  it.each([
    ['source', '+', 'P00', '-', 'COMI'],
    ['sink', '+', 'COMI', '-', 'P00'],
  ])('recognizes XBC %s input wiring', async (_label, plus, plusTerm, minus, minusTerm) => {
    const doc = workshop(
      [device('ac', 'boundary:ac-supply'), device('dc', 'boundary:dc-supply'), device('plc', 'ls-electric:xbc-dr32h')],
      [
        wire('w1', 'dc', plus, 'plc', plusTerm), wire('w2', 'dc', minus, 'plc', minusTerm),
        wire('w3', 'ac', 'L1', 'plc', 'L'), wire('w4', 'ac', 'N', 'plc', 'N'),
      ],
    );
    const result = await simulateScenario(doc, DEVICE_PROFILES, { id: 'input' });
    expect(result.inputStates.plc.P00).toBe(true);
  });

  it('opens and closes an XBC relay output from forced output state', async () => {
    const doc = workshop(
      [device('ac', 'boundary:ac-supply'), device('dc', 'boundary:dc-supply'), device('plc', 'ls-electric:xbc-dr32h'), device('load', 'boundary:load')],
      [
        wire('w1', 'dc', '+', 'plc', 'COM0'), wire('w2', 'plc', 'P20', 'load', '+'),
        wire('w3', 'ac', 'L1', 'plc', 'L'), wire('w4', 'ac', 'N', 'plc', 'N'),
      ],
    );
    const off = await simulateScenario(doc, DEVICE_PROFILES, { id: 'off' });
    expect(off.energizedTerminals).not.toContain('plc:P20');
    const on = await simulateScenario(doc, DEVICE_PROFILES, { id: 'on', forcedOutputs: { plc: ['P20'] } });
    expect(on.energizedTerminals).toContain('plc:P20');
    expect(on.outputStates.plc.P20).toBe(true);
  });

  it('keeps XBC inputs and forced relay contacts inactive without PLC AC power', async () => {
    const inputDoc = workshop(
      [device('dc', 'boundary:dc-supply'), device('plc', 'ls-electric:xbc-dr32h')],
      [wire('w1', 'dc', '+', 'plc', 'P00'), wire('w2', 'dc', '-', 'plc', 'COMI')],
    );
    const input = await simulateScenario(inputDoc, DEVICE_PROFILES, { id: 'unpowered-input' });
    expect(input.inputStates.plc.P00).toBe(false);

    const outputDoc = workshop(
      [device('dc', 'boundary:dc-supply'), device('plc', 'ls-electric:xbc-dr32h'), device('load', 'boundary:load')],
      [wire('w1', 'dc', '+', 'plc', 'COM0'), wire('w2', 'plc', 'P20', 'load', '+')],
    );
    const output = await simulateScenario(outputDoc, DEVICE_PROFILES, { id: 'unpowered-output', forcedOutputs: { plc: ['P20'] } });
    expect(output.outputStates.plc.P20).toBe(false);
    expect(output.energizedTerminals).not.toContain('plc:P20');
  });

  it('validates the default state and every declared scenario state', async () => {
    const doc = workshop(
      [device('ac', 'boundary:ac-supply'), device('dc', 'boundary:dc-supply'), device('plc', 'ls-electric:xbc-dr32h')],
      [
        wire('w1', 'dc', '+', 'plc', 'COM0'), wire('w2', 'dc', '-', 'plc', 'P20'),
        wire('w3', 'ac', 'L1', 'plc', 'L'), wire('w4', 'ac', 'N', 'plc', 'N'),
      ],
    );
    expect((await validateWorkshop(doc, DEVICE_PROFILES)).status).toBe('PASS');

    const result = await validateWorkshopScenarios(doc, DEVICE_PROFILES, [
      { id: 'relay-on', forcedOutputs: { plc: ['P20'] } },
    ]);
    expect(result.status).toBe('FAIL');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DC_SHORT', scenarioId: 'relay-on' }),
    ]));
  });

  it('blocks contact-state oscillation after detecting non-convergence', async () => {
    const doc = workshop(
      [device('dc', 'boundary:dc-supply'), device('contact', 'boundary:dry-contact')],
      [wire('w1', 'dc', '+', 'contact', 'A')],
    );
    const result = await simulateScenario(doc, DEVICE_PROFILES, {
      id: 'oscillating',
      contactRules: [
        {
          stateKey: 'contact:contact',
          sense: { deviceId: 'contact', terminalId: 'B' },
          mode: 'closed-when-deenergized',
        },
      ],
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.validation.issues.map((issue) => issue.code)).toContain('NON_CONVERGENT_SIMULATION');
    expect(result.iterations).toBeLessThanOrEqual(32);
  });
});
