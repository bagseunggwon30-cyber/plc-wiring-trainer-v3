import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import {
  ISSUE_ACTIONS,
  issueAction,
  missionStateFromDocument,
  resetMissionSessionState,
} from '../../src/renderer/workflow-app';
import type { WorkshopDocumentV2 } from '../../src/domain/types';

function documentWithSettings(settings: Record<string, unknown>): WorkshopDocumentV2 {
  const ac = DEVICE_PROFILES['boundary:ac-supply'];
  const psu = DEVICE_PROFILES['mean-well:mdr-100-24'];
  const load = DEVICE_PROFILES['boundary:load'];
  return {
    schemaVersion: 2,
    mode: 'prewire',
    revision: 1,
    name: 'workflow state',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices: [
      { id: 'ac', profileId: ac.profileId, profileVersion: ac.version, evidenceLevel: ac.evidence.level, missingProfile: false, x: 0, y: 0, rotation: 0, configuration: {} },
      { id: 'psu', profileId: psu.profileId, profileVersion: psu.version, evidenceLevel: psu.evidence.level, missingProfile: false, x: 0, y: 0, rotation: 0, configuration: {} },
      { id: 'load', profileId: load.profileId, profileVersion: load.version, evidenceLevel: load.evidence.level, missingProfile: false, x: 0, y: 0, rotation: 0, configuration: {} },
    ],
    wires: [], jumpers: [], layout: {}, settings, extensions: { legacy: {} },
  };
}

describe('workflow issue actions and loaded mission state', () => {
  it('provides corrective actions for every domain and mission issue code', () => {
    const emittedCodes = [
      'MISSING_PROFILE', 'UNKNOWN_TERMINAL', 'UNKNOWN_FORCED_OUTPUT',
      'EMPTY_REVIEW_SCOPE', 'PROFILE_VERSION_MISMATCH', 'UNVERIFIED_PROFILE',
      'INSTANCE_EVIDENCE_DOWNGRADED', 'AC_PHASE_NEUTRAL_SHORT', 'AC_PHASE_CONFLICT',
      'DC_SHORT', 'PE_MIXED', 'PARALLEL_SOURCE', 'ANALOG_MODE_MISMATCH',
      'RS485_POLARITY_MISMATCH', 'TERMINAL_POTENTIAL_MISMATCH', 'NON_CONVERGENT_SIMULATION',
      'MISSION_MODE_NOT_ELIGIBLE', 'UNKNOWN_MISSION_ROLE', 'DUPLICATE_ROLE_BINDING',
      'DUPLICATE_DEVICE_BINDING', 'MISSING_ROLE_BINDING', 'BOUND_DEVICE_NOT_FOUND',
      'ROLE_PROFILE_MISMATCH', 'ROLE_PROFILE_NOT_VERIFIED', 'MISSION_CONNECTION_MISSING',
      'MISSION_STATE_MISMATCH', 'UNSUPPORTED_FORBIDDEN_RULE', 'UNPOWERED_SOURCE_OUTPUT',
      'INPUT_COMMON_POLARITY', 'OUTPUT_ON_WHEN_OFF', 'NC_TERMINAL_USED',
      'FORWARD_REVERSE_SIMULTANEOUS', 'EXTERNAL_SUPPLY_VARIANT_UNKNOWN',
      'BYPASSED_TERMINAL_BLOCK', 'STOP_CONTACT_BYPASSED',
    ];

    for (const code of emittedCodes) {
      expect(ISSUE_ACTIONS[code], code).toBeTruthy();
      expect(issueAction(code), code).not.toContain('관련 단자와 와이어');
    }
  });

  it('does not leak role bindings from a previously loaded document', () => {
    const first = documentWithSettings({
      missionId: 'mdr-ac-dc-distribution',
      roleBindings: { acSupply: 'ac', powerSupply: 'psu', dcLoad: 'load' },
    });
    const second = documentWithSettings({ missionId: 'mdr-ac-dc-distribution' });

    expect(Object.fromEntries(missionStateFromDocument(first).bindings)).toEqual({
      acSupply: 'ac', powerSupply: 'psu', dcLoad: 'load',
    });
    expect(missionStateFromDocument(second)).toEqual({
      missionId: 'mdr-ac-dc-distribution', bindings: new Map(),
    });
  });

  it('clears mission bindings and hints before V2 or legacy fallback loading', () => {
    const bindings = new Map([['mdr-ac-dc-distribution', new Map([['powerSupply', 'psu']])]]);
    const hints = new Map([['mdr-ac-dc-distribution', 3]]);

    resetMissionSessionState(bindings, hints);

    expect(bindings.size).toBe(0);
    expect(hints.size).toBe(0);
  });

  it('drops unknown roles and profile-mismatched device IDs from loaded settings', () => {
    const document = documentWithSettings({
      missionId: 'mdr-ac-dc-distribution',
      roleBindings: { acSupply: 'psu', powerSupply: 'psu', dcLoad: 42, surprise: 'ac' },
    });

    expect(Object.fromEntries(missionStateFromDocument(document).bindings)).toEqual({ powerSupply: 'psu' });
  });
});
