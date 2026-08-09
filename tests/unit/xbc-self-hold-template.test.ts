import { describe, expect, it } from 'vitest';
import {
  createXbcDr32hSelfHoldSliceDefinition,
  createXbcDr32hSelfHoldWorkshopV2,
} from '../../src/domain/device-runtime';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../src/catalog/v3-profiles';
import { buildPrewireCircuitV3, simulateScenario } from '../../src/domain/v3';

function endpoint(wire: { from: { deviceId: string; terminalId: string }; to: { deviceId: string; terminalId: string } }): string {
  return `${wire.from.deviceId}:${wire.from.terminalId}->${wire.to.deviceId}:${wire.to.terminalId}`;
}

describe('XBC-DR32H self-hold workshop template', () => {
  it('uses the internal 24V/24G pair, P03/P02 inputs and P21/COM0 relay output', async () => {
    const document = createXbcDr32hSelfHoldWorkshopV2();
    const wires = new Set(document.wires.map(endpoint));

    const expectedWires = [
      'ac:L1->plc1:L',
      'ac:N->plc1:N',
      'ac:PE->plc1:PE',
      'plc1:24V->x24:1',
      'plc1:24G->x0:1',
      'x24:2->startPb:13',
      'startPb:14->plc1:P03',
      'x24:3->stopPb:21',
      'stopPb:22->plc1:P02',
      'plc1:COMI->x0:2',
      'x24:4->plc1:COM0',
      'plc1:P21->relay1:14',
      'relay1:13->x0:3',
      'x24:5->relay1:9',
      'relay1:5->runLamp:+',
      'runLamp:-->x0:4',
    ];
    for (const expected of expectedWires) expect(wires, expected).toContain(expected);
    expect(document.wires.flatMap((wire) => [wire.from.terminalId, wire.to.terminalId])).not.toContain('NC');

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const baseline = simulateScenario(built.document, {
      id: 'idle',
      contactStates: { 'startPb:contact': false, 'stopPb:contact': true, 'plc1:P21': false },
    });
    expect(baseline.solution.loads['plc1#P03']?.energized).toBe(false);
    expect(baseline.solution.loads['plc1#P02']?.energized).toBe(true);
    expect(baseline.solution.loads['relay1#coil']?.energized).toBe(false);
    expect(baseline.solution.loads.runLamp?.energized).toBe(false);

    const running = simulateScenario(built.document, {
      id: 'running',
      contactStates: { 'startPb:contact': false, 'stopPb:contact': true, 'plc1:P21': true },
    });
    expect(running.solution.loads['relay1#coil']).toMatchObject({ energized: true, voltageV: 24 });
    expect(running.solution.loads.runLamp?.energized).toBe(true);
    expect(built.document.sources).toContainEqual(expect.objectContaining({
      id: 'plc1#internal24',
      maximumCurrentA: 0.4,
    }));
    expect(running.solution.elements['plc1#internal24'].currentA).toBeGreaterThan(0.05);
    expect(running.solution.elements['plc1#internal24'].currentA).toBeLessThan(0.4);
    expect(running.solution.issues.map((entry) => entry.code)).not.toContain('SOURCE_CURRENT_EXCEEDED');
  });

  it('fails an overloaded internal 24 V rail and blocks when an active load current is unknown', async () => {
    const overloaded = createXbcDr32hSelfHoldWorkshopV2();
    const overloadedLamp = overloaded.devices.find((device) => device.id === 'runLamp');
    if (!overloadedLamp) throw new Error('runLamp fixture is missing');
    overloadedLamp.configuration.assumedCurrentA = 0.38;
    const overloadedBuild = await buildPrewireCircuitV3(overloaded, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const overloadedRun = simulateScenario(overloadedBuild.document, {
      id: 'overloaded',
      contactStates: { 'startPb:contact': false, 'stopPb:contact': true, 'plc1:P21': true },
    });
    expect(overloadedRun.solution.issues).toContainEqual(expect.objectContaining({
      code: 'SOURCE_CURRENT_EXCEEDED',
      refs: expect.arrayContaining(['plc1#internal24']),
    }));
    expect(overloadedRun.validation.status).toBe('FAIL');

    const unknown = createXbcDr32hSelfHoldWorkshopV2();
    const unknownLamp = unknown.devices.find((device) => device.id === 'runLamp');
    if (!unknownLamp) throw new Error('runLamp fixture is missing');
    delete unknownLamp.configuration.assumedCurrentA;
    const unknownBuild = await buildPrewireCircuitV3(unknown, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const unknownRun = simulateScenario(unknownBuild.document, {
      id: 'unknown-current',
      contactStates: { 'startPb:contact': false, 'stopPb:contact': true, 'plc1:P21': true },
    });
    expect(unknownRun.solution.issues.map((entry) => entry.code)).toContain('SOURCE_CAPACITY_BLOCKED');
    expect(unknownRun.validation.status).toBe('BLOCKED');
  });

  it('provides renderer-independent element and contact identities for the runtime slice', () => {
    expect(createXbcDr32hSelfHoldSliceDefinition()).toMatchObject({
      startInputElementId: 'plc1#P03',
      stopInputElementId: 'plc1#P02',
      stopInputEncoding: 'active-high-stop-request',
      plcPowerElementId: 'plc1#ac-input',
      startContactStateKey: 'startPb:contact',
      stopContactStateKey: 'stopPb:contact',
      plcOutputContactStateKey: 'plc1:P21',
      relayCoilElementId: 'relay1#coil',
      lampElementId: 'runLamp',
    });
  });
});
