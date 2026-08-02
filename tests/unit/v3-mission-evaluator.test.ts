import { describe, expect, it } from 'vitest';
import { PUBLIC_MISSIONS } from '../../src/domain/missions';
import {
  evaluateMissionV3,
  type ElectricalBranch,
  type WorkshopDocumentV3,
} from '../../src/domain/v3';

const branch = (
  id: string,
  fromElement: string,
  fromTerminal: string,
  toElement: string,
  toTerminal: string,
  conductor: ElectricalBranch['conductor'] = 'dc',
): ElectricalBranch => ({
  id,
  from: { elementId: fromElement, terminalId: fromTerminal },
  to: { elementId: toElement, terminalId: toTerminal },
  conductor,
});

function document(includeReturn = true): WorkshopDocumentV3 {
  const branches: ElectricalBranch[] = [
    branch('ac-l', 'ac', 'L1', 'plc', 'L'),
    branch('ac-n', 'ac', 'N', 'plc', 'N'),
    branch('ac-pe', 'ac', 'PE', 'plc', 'PE', 'pe'),
    branch('dc-com', 'dc', '+', 'plc', 'COM0'),
    branch('relay-com', 'plc', 'COM0', 'plc#P20:relay', 'common'),
    branch('relay-out', 'plc#P20:relay', 'output', 'plc', 'P20'),
    branch('switched-load', 'plc', 'P20', 'load', '+'),
  ];
  if (includeReturn) branches.push(branch('load-return', 'load', '-', 'dc', '-'));
  return {
    schemaVersion: 3,
    revision: 1,
    hash: 'mission-fixture',
    sources: [{ id: 'dc', positiveTerminal: '+', returnTerminal: '-', voltage: 24 }],
    elements: [
      { kind: 'device', id: 'ac', terminals: ['L1', 'N', 'PE'] },
      { kind: 'device', id: 'plc', terminals: ['L', 'N', 'PE', 'COM0', 'P20'] },
      { kind: 'contact', id: 'plc#P20:relay', terminalA: 'output', terminalB: 'common', stateKey: 'plc:P20', normally: 'open' },
      { kind: 'load', id: 'load', positiveTerminal: '+', returnTerminal: '-', required: 'scenario' },
    ],
    branches,
    reviewScope: { elementIds: ['ac', 'plc', 'plc#P20:relay', 'load'] },
    deviceInstances: [
      ['ac', 'boundary:ac-supply'],
      ['dc', 'boundary:dc-supply'],
      ['plc', 'ls-electric:xbc-dr32h'],
      ['load', 'boundary:load'],
    ].map(([id, profileId]) => ({
      id,
      profileId,
      profileVersion: 'test',
      assetVersion: null,
      exactOrderCode: null,
      designation: null,
      configuration: {},
      layoutMm: { x: 0, y: 0, rotation: 0 },
      verification: 'unverified' as const,
    })),
  };
}

const mission = PUBLIC_MISSIONS.find((entry) => entry.id === 'xbc-forced-relay-output')!;
const bindings = { acSupply: 'ac', dcSupply: 'dc', plc: 'plc', load: 'load' };

describe('v3 mission evaluator', () => {
  it('uses the same branch model for pin-to-pin checks and relay OFF/ON scenarios', () => {
    const result = evaluateMissionV3(mission, document(), bindings);

    expect(result.issues).toEqual([]);
    expect(result.connectionSets).toEqual([{ id: 'p20-load-test', complete: true, missingLabels: [] }]);
    expect(result.simulations.find((entry) => entry.scenarioId === 'relay-off')?.solution.loads.load.state)
      .toBe('OPEN_SOURCE_PATH');
    expect(result.simulations.find((entry) => entry.scenarioId === 'relay-on')?.solution.loads.load.state)
      .toBe('ON');
  });

  it('reports the exact missing return during the required relay-on scenario', () => {
    const result = evaluateMissionV3(mission, document(false), bindings);

    expect(result.issues.map((entry) => entry.code)).toContain('MISSION_CONNECTION_MISSING');
    expect(result.issues.map((entry) => entry.code)).toContain('OPEN_RETURN_PATH');
    expect(result.issues.map((entry) => entry.code)).toContain('MISSION_STATE_MISMATCH');
  });

  it('does not discard an unresolved mission contact-rule mapping', () => {
    const invalidRuleMission = {
      ...mission,
      expectedStates: [],
      scenarios: [{
        id: 'invalid-rule',
        contactRules: [{
          state: { role: 'plc', stateKey: 'P20' },
          sense: { role: 'missing-role', terminalId: 'P00' },
          mode: 'closed-when-energized' as const,
        }],
      }],
    };

    const result = evaluateMissionV3(invalidRuleMission, document(), bindings);
    expect(result.simulations[0]?.validation.status).toBe('BLOCKED');
    expect(result.issues.map((entry) => entry.code)).toContain('INVALID_CONTACT_RULE');
  });
});
