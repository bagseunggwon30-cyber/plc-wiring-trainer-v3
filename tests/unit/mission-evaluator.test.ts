import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { evaluateMission } from '../../src/domain/mission-evaluator';
import { PUBLIC_MISSIONS, type MissionDefinitionV2, type RoleBinding } from '../../src/domain/missions';
import type { DeviceInstanceV2, WireV2, WorkshopDocumentV2 } from '../../src/domain/types';

function referenceDocument(definition: MissionDefinitionV2): { document: WorkshopDocumentV2; bindings: RoleBinding[] } {
  const bindings: RoleBinding[] = definition.roles.map((role) => ({ role: role.id, deviceId: `device-${role.id}` }));
  const ids = Object.fromEntries(bindings.map((binding) => [binding.role, binding.deviceId]));
  const devices: DeviceInstanceV2[] = definition.roles.map((role) => {
    const profile = DEVICE_PROFILES[role.allowedProfileIds[0]];
    const configuration = profile.profileId === 'ls-electric:xbf-ah04a'
      ? {
        xbfChannels: {
          AI0: { enabled: true, selector: 'V', parameterRange: '0-10V' },
          AI1: { enabled: true, selector: 'I', parameterRange: '4-20mA' },
          AO0: { enabled: false },
          AO1: { enabled: false },
        },
      }
      : {};
    return {
      id: ids[role.id],
      profileId: profile.profileId,
      profileVersion: profile.version,
      evidenceLevel: profile.evidence.level,
      missingProfile: false,
      x: 0,
      y: 0,
      rotation: 0,
      configuration,
    };
  });
  const requiredSets = definition.connectionPolicy === 'one-of'
    ? definition.expectedConnections.slice(0, 1)
    : definition.expectedConnections;
  let wireNumber = 0;
  const wires: WireV2[] = requiredSets.flatMap((set) => set.connections.map((connection) => ({
    id: `wire-${++wireNumber}`,
    from: { deviceId: ids[connection.from.role], terminalId: connection.from.terminalId },
    to: { deviceId: ids[connection.to.role], terminalId: connection.to.terminalId },
  })));
  return {
    bindings,
    document: {
      schemaVersion: 2,
      mode: definition.eligibleModes.includes('prewire') ? 'prewire' : 'practice',
      revision: 1,
      name: definition.title,
      source: { kind: 'native-v2', hash: '0'.repeat(64) },
      devices,
      wires,
      jumpers: [],
      layout: {},
      settings: { missionId: definition.id, roleBindings: ids },
      extensions: { legacy: {} },
    },
  };
}

function ensureBoundary(document: WorkshopDocumentV2, id: string, profileId: string): string {
  const existing = document.devices.find((device) => device.profileId === profileId);
  if (existing) return existing.id;
  const profile = DEVICE_PROFILES[profileId];
  document.devices.push({
    id, profileId, profileVersion: profile.version, evidenceLevel: profile.evidence.level,
    missingProfile: false, x: 0, y: 0, rotation: 0, configuration: {},
  });
  return id;
}

describe('mission evaluation through the shared graph', () => {
  it.each(PUBLIC_MISSIONS.map((definition) => [definition.id, definition] as const))(
    'passes the reference circuit for %s with no blocking issues',
    async (_id, definition) => {
      const fixture = referenceDocument(definition);
      const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);
      expect(result.status, result.issues.map((issue) => `${issue.code}:${issue.message}`).join('\n')).toBe('PASS');
      expect(result.completed).toBe(true);
      expect(result.issues.filter((issue) => issue.blocking)).toEqual([]);
    },
  );

  it.each(PUBLIC_MISSIONS.map((definition) => [definition.id, definition] as const))(
    'fails %s when a required pin-to-pin connection is removed',
    async (_id, definition) => {
      const fixture = referenceDocument(definition);
      fixture.document.wires.shift();
      fixture.document.revision += 1;
      const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);
      expect(result.status).toBe('FAIL');
      expect(result.completed).toBe(false);
      const issue = result.issues.find((entry) => entry.code === 'MISSION_CONNECTION_MISSING');
      expect(issue).toBeDefined();
      expect(issue?.refs.length).toBeGreaterThan(0);
      expect(issue?.refs.every((ref) => ref.includes(':'))).toBe(true);
    },
  );

  it.each(PUBLIC_MISSIONS.map((definition) => [definition.id, definition] as const))(
    'fails %s with DC_SHORT for a direct +24V/0V miswire',
    async (_id, definition) => {
      const fixture = referenceDocument(definition);
      const dc = ensureBoundary(fixture.document, 'fault-dc', 'boundary:dc-supply');
      fixture.document.wires.push({
        id: 'fault-dc-short',
        from: { deviceId: dc, terminalId: '+' },
        to: { deviceId: dc, terminalId: '-' },
      });
      fixture.document.revision += 1;
      const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);
      expect(result.status).toBe('FAIL');
      expect(result.issues.map((issue) => issue.code)).toContain('DC_SHORT');
    },
  );

  it.each(PUBLIC_MISSIONS.map((definition) => [definition.id, definition] as const))(
    'fails %s with PE_MIXED for an energized-phase/earth miswire',
    async (_id, definition) => {
      const fixture = referenceDocument(definition);
      const ac = ensureBoundary(fixture.document, 'fault-ac', 'boundary:ac-supply');
      fixture.document.wires.push({
        id: 'fault-pe-mixed',
        from: { deviceId: ac, terminalId: 'L1' },
        to: { deviceId: ac, terminalId: 'PE' },
      });
      fixture.document.revision += 1;
      const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);
      expect(result.status).toBe('FAIL');
      expect(result.issues.map((issue) => issue.code)).toContain('PE_MIXED');
    },
  );

  it('rejects a physical connection to the XBF NC terminal', async () => {
    const definition = PUBLIC_MISSIONS.find((mission) => mission.id === 'xbf-analog-voltage-current')!;
    const fixture = referenceDocument(definition);
    const ids = Object.fromEntries(fixture.bindings.map((binding) => [binding.role, binding.deviceId]));
    fixture.document.wires.push({
      id: 'fault-nc-used',
      from: { deviceId: ids.analogModule, terminalId: 'NC' },
      to: { deviceId: ids.voltagePeer, terminalId: '+' },
    });

    const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);

    expect(result.status).toBe('FAIL');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'NC_TERMINAL_USED', refs: expect.arrayContaining([`${ids.analogModule}:NC`, 'fault-nc-used']),
    }));
  });

  it('rejects a simultaneous iG5A forward/reverse topology', async () => {
    const definition = PUBLIC_MISSIONS.find((mission) => mission.id === 'ig5a-terminal-control-practice')!;
    const fixture = referenceDocument(definition);
    const ids = Object.fromEntries(fixture.bindings.map((binding) => [binding.role, binding.deviceId]));
    fixture.document.wires.push({
      id: 'fault-reverse-bypass',
      from: { deviceId: ids.drive, terminalId: 'CM' },
      to: { deviceId: ids.drive, terminalId: 'P2' },
    });

    const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);

    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('FORWARD_REVERSE_SIMULTANEOUS');
  });

  it('rejects PLC-to-door direct wiring that bypasses the terminal block', async () => {
    const definition = PUBLIC_MISSIONS.find((mission) => mission.id === 'door-terminal-block-routing')!;
    const fixture = referenceDocument(definition);
    const ids = Object.fromEntries(fixture.bindings.map((binding) => [binding.role, binding.deviceId]));
    fixture.document.wires.push({
      id: 'fault-direct-door-wire',
      from: { deviceId: ids.plc, terminalId: 'P00' },
      to: { deviceId: ids.startPb, terminalId: 'B' },
    });

    const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);

    expect(result.status).toBe('FAIL');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'BYPASSED_TERMINAL_BLOCK', refs: expect.arrayContaining(['fault-direct-door-wire']),
    }));
  });

  it('rejects a start path that remains live when the stop contact is removed', async () => {
    const definition = PUBLIC_MISSIONS.find((mission) => mission.id === 'door-terminal-block-routing')!;
    const fixture = referenceDocument(definition);
    const ids = Object.fromEntries(fixture.bindings.map((binding) => [binding.role, binding.deviceId]));
    fixture.document.wires.push({
      id: 'fault-stop-bypass',
      from: { deviceId: ids.dcSupply, terminalId: '+' },
      to: { deviceId: ids.startPb, terminalId: 'A' },
    });

    const result = await evaluateMission(definition, fixture.document, DEVICE_PROFILES, fixture.bindings);

    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('STOP_CONTACT_BYPASSED');
  });
});
