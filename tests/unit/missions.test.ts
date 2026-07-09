import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import {
  PUBLIC_MISSIONS,
  prepareMissionEvaluation,
  type MissionDefinitionV2,
  type RoleBinding,
} from '../../src/domain/missions';
import { SUPPORTED_FORBIDDEN_STATE_CODES } from '../../src/domain/mission-evaluator';
import type { DeviceInstanceV2, WorkshopDocumentV2, WorkshopMode } from '../../src/domain/types';

function device(id: string, profileId: string): DeviceInstanceV2 {
  const profile = DEVICE_PROFILES[profileId];
  return {
    id,
    profileId,
    profileVersion: profile?.version ?? 'legacy-v1',
    evidenceLevel: profile?.evidence.level ?? 'educational',
    missingProfile: !profile,
    x: 0,
    y: 0,
    rotation: 0,
    configuration: {},
  };
}

function workshop(mode: WorkshopMode, devices: DeviceInstanceV2[]): WorkshopDocumentV2 {
  return {
    schemaVersion: 2,
    mode,
    revision: 1,
    name: 'mission test',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires: [],
    jumpers: [],
    layout: {},
    settings: {},
    extensions: { legacy: {} },
  };
}

function mission(id: string): MissionDefinitionV2 {
  const found = PUBLIC_MISSIONS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing mission ${id}`);
  return found;
}

function bindings(entries: Record<string, string>): RoleBinding[] {
  return Object.entries(entries).map(([role, deviceId]) => ({ role, deviceId }));
}

describe('public MissionDefinitionV2 catalog', () => {
  it('publishes exactly the seven approved role-based missions', () => {
    expect(PUBLIC_MISSIONS.map((entry) => entry.id)).toEqual([
      'mdr-ac-dc-distribution',
      'xbc-source-sink-input',
      'xbc-forced-relay-output',
      'xbf-analog-voltage-current',
      'ig5a-terminal-control-practice',
      'md02-rs485-practice',
      'door-terminal-block-routing',
    ]);
    expect(new Set(PUBLIC_MISSIONS.map((entry) => entry.id)).size).toBe(7);
  });

  it('makes only evidence-qualified missions eligible for prewire mode', () => {
    expect(PUBLIC_MISSIONS.filter((entry) => entry.eligibleModes.includes('prewire')).map((entry) => entry.id)).toEqual([
      'mdr-ac-dc-distribution',
      'xbc-source-sink-input',
      'xbc-forced-relay-output',
      'xbf-analog-voltage-current',
    ]);

    for (const entry of PUBLIC_MISSIONS.filter((item) => item.eligibleModes.includes('prewire'))) {
      for (const role of entry.roles) {
        for (const profileId of role.allowedProfileIds) {
          const profile = DEVICE_PROFILES[profileId];
          expect(profile, `${entry.id}:${role.id}:${profileId}`).toBeDefined();
          expect(profile.boundary || profile.evidence.level !== 'educational').toBe(true);
        }
      }
    }
    for (const entry of PUBLIC_MISSIONS.slice(4)) expect(entry.eligibleModes).toEqual(['practice']);
  });

  it('declares explicit roles, four-level hints, states, actions, expectations and forbidden states', () => {
    for (const entry of PUBLIC_MISSIONS) {
      const declaredRoles = new Set(entry.roles.map((role) => role.id));
      expect(entry.roles.length).toBeGreaterThan(0);
      expect(entry.roles.every((role) => role.allowedProfileIds.length > 0)).toBe(true);
      expect(entry.hints.map((hint) => hint.level)).toEqual(['concept', 'device', 'terminal', 'answer']);
      expect(entry.hints.at(-1)?.oneStep).toBe(true);
      expect(entry.initialState).toBeDefined();
      expect(entry.actions.length).toBeGreaterThan(0);
      expect(entry.scenarios.length).toBeGreaterThan(0);
      expect(entry.expectedConnections.length).toBeGreaterThan(0);
      expect(entry.expectedStates.length).toBeGreaterThan(0);
      expect(entry.forbiddenStates.length).toBeGreaterThan(0);

      for (const set of entry.expectedConnections) {
        for (const connection of set.connections) {
          expect(declaredRoles.has(connection.from.role)).toBe(true);
          expect(declaredRoles.has(connection.to.role)).toBe(true);
        }
      }
      for (const state of entry.expectedStates) expect(declaredRoles.has(state.target.role)).toBe(true);
    }
  });

  it('has a deterministic evaluator for every declared forbidden-state code', () => {
    const supported = new Set(SUPPORTED_FORBIDDEN_STATE_CODES);
    for (const entry of PUBLIC_MISSIONS) {
      for (const state of entry.forbiddenStates) {
        expect(supported.has(state.code), `${entry.id}:${state.code}`).toBe(true);
      }
    }
  });

  it('references catalog profiles and terminals that the shared graph can evaluate', () => {
    for (const entry of PUBLIC_MISSIONS) {
      const terminalIdsByRole = new Map<string, Set<string>>();
      const add = (role: string, terminalId: string) => {
        const terminalIds = terminalIdsByRole.get(role) ?? new Set<string>();
        terminalIds.add(terminalId);
        terminalIdsByRole.set(role, terminalIds);
      };
      for (const set of entry.expectedConnections) for (const connection of set.connections) {
        add(connection.from.role, connection.from.terminalId);
        add(connection.to.role, connection.to.terminalId);
      }
      for (const state of entry.expectedStates) add(state.target.role, state.target.terminalId);
      for (const action of entry.actions) if (action.target) add(action.target.role, action.target.terminalId);

      for (const role of entry.roles) {
        for (const profileId of role.allowedProfileIds) {
          const profile = DEVICE_PROFILES[profileId];
          expect(profile, `${entry.id}:${role.id}:${profileId}`).toBeDefined();
          const available = new Set(profile.terminals.map((terminal) => terminal.id));
          for (const terminalId of terminalIdsByRole.get(role.id) ?? []) {
            expect(available.has(terminalId), `${entry.id}:${role.id}:${profileId}:${terminalId}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('prepareMissionEvaluation', () => {
  it('does not infer the first matching device and blocks every missing explicit role binding', () => {
    const definition = mission('mdr-ac-dc-distribution');
    const doc = workshop('practice', [
      device('ac-1', 'boundary:ac-supply'),
      device('psu-1', 'mean-well:mdr-100-24'),
      device('load-1', 'boundary:load'),
    ]);

    const result = prepareMissionEvaluation(definition, doc, DEVICE_PROFILES, []);

    expect(result.status).toBe('BLOCKED');
    expect(result.scenarios).toEqual([]);
    expect(result.issues.filter((issue) => issue.code === 'MISSING_ROLE_BINDING')).toHaveLength(definition.roles.length);
  });

  it('blocks duplicate roles and reuse of one instance for different roles', () => {
    const definition = mission('xbc-source-sink-input');
    const doc = workshop('practice', [
      device('dc-1', 'boundary:dc-supply'),
      device('plc-1', 'ls-electric:xbc-dr32h'),
      device('contact-1', 'boundary:dry-contact'),
    ]);
    const result = prepareMissionEvaluation(definition, doc, DEVICE_PROFILES, [
      { role: 'dcSupply', deviceId: 'dc-1' },
      { role: 'dcSupply', deviceId: 'plc-1' },
      { role: 'plc', deviceId: 'plc-1' },
      { role: 'inputContact', deviceId: 'plc-1' },
    ]);

    expect(result.status).toBe('BLOCKED');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_ROLE_BINDING', severity: 'blocked', blocking: true }),
      expect.objectContaining({ code: 'DUPLICATE_DEVICE_BINDING', severity: 'blocked', blocking: true }),
    ]));
  });

  it('blocks unknown roles, absent instances and role/profile mismatches', () => {
    const definition = mission('mdr-ac-dc-distribution');
    const doc = workshop('practice', [device('ac-1', 'boundary:ac-supply'), device('wrong-1', 'boundary:load')]);
    const result = prepareMissionEvaluation(definition, doc, DEVICE_PROFILES, [
      { role: 'acSupply', deviceId: 'ac-1' },
      { role: 'powerSupply', deviceId: 'wrong-1' },
      { role: 'dcLoad', deviceId: 'absent' },
      { role: 'surprise', deviceId: 'ac-1' },
    ]);

    expect(result.status).toBe('BLOCKED');
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'UNKNOWN_MISSION_ROLE',
      'BOUND_DEVICE_NOT_FOUND',
      'ROLE_PROFILE_MISMATCH',
    ]));
  });

  it('blocks practice-only missions and educational instances in prewire mode', () => {
    const practiceOnly = mission('ig5a-terminal-control-practice');
    const practiceDoc = workshop('prewire', [
      device('drive-1', 'ls-electric:sv-ig5a'),
      device('fwd-1', 'boundary:dry-contact'),
      device('rev-1', 'boundary:dry-contact'),
    ]);
    const modeResult = prepareMissionEvaluation(practiceOnly, practiceDoc, DEVICE_PROFILES, bindings({
      drive: 'drive-1', forwardPb: 'fwd-1', reversePb: 'rev-1',
    }));
    expect(modeResult.issues.map((issue) => issue.code)).toContain('MISSION_MODE_NOT_ELIGIBLE');

    const verified = mission('xbc-forced-relay-output');
    const downgradedPlc = { ...device('plc-1', 'ls-electric:xbc-dr32h'), evidenceLevel: 'educational' as const };
    const prewireDoc = workshop('prewire', [
      device('dc-1', 'boundary:dc-supply'),
      downgradedPlc,
      device('load-1', 'boundary:load'),
    ]);
    const evidenceResult = prepareMissionEvaluation(verified, prewireDoc, DEVICE_PROFILES, bindings({
      dcSupply: 'dc-1', plc: 'plc-1', load: 'load-1',
    }));
    expect(evidenceResult.status).toBe('BLOCKED');
    expect(evidenceResult.issues.map((issue) => issue.code)).toContain('ROLE_PROFILE_NOT_VERIFIED');
  });

  it('resolves role-based initial states and scenarios to SimulationScenario device IDs', () => {
    const definition = mission('xbc-forced-relay-output');
    const doc = workshop('prewire', [
      device('ac-3', 'boundary:ac-supply'),
      device('dc-17', 'boundary:dc-supply'),
      device('plc-42', 'ls-electric:xbc-dr32h'),
      device('load-9', 'boundary:load'),
    ]);
    const result = prepareMissionEvaluation(definition, doc, DEVICE_PROFILES, bindings({
      acSupply: 'ac-3', dcSupply: 'dc-17', plc: 'plc-42', load: 'load-9',
    }));

    expect(result.status).toBe('PASS');
    expect(result.issues).toEqual([]);
    expect(result.bindings).toEqual({ acSupply: 'ac-3', dcSupply: 'dc-17', plc: 'plc-42', load: 'load-9' });
    expect(result.scenarios).toEqual([
      { id: 'relay-off', forcedOutputs: { 'plc-42': [] } },
      { id: 'relay-on', forcedOutputs: { 'plc-42': ['P20'] } },
    ]);
  });

  it('resolves contact role state keys without leaking catalog instance order', () => {
    const definition = mission('xbc-source-sink-input');
    const doc = workshop('practice', [
      device('ac-8', 'boundary:ac-supply'),
      device('contact-other', 'boundary:dry-contact'),
      device('plc-other', 'ls-electric:xbc-dr32h'),
      device('dc-8', 'boundary:dc-supply'),
      device('plc-8', 'ls-electric:xbc-dr32h'),
      device('contact-8', 'boundary:dry-contact'),
    ]);
    const result = prepareMissionEvaluation(definition, doc, DEVICE_PROFILES, bindings({
      acSupply: 'ac-8', dcSupply: 'dc-8', plc: 'plc-8', inputContact: 'contact-8',
    }));

    expect(result.status).toBe('PASS');
    expect(result.scenarios).toEqual([
      { id: 'contact-open', contactStates: { 'contact-8:contact': false } },
      { id: 'contact-closed', contactStates: { 'contact-8:contact': true } },
    ]);
  });
});
