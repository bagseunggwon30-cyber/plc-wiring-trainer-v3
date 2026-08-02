import { describe, expect, it } from 'vitest';
import {
  canIssueVerifiedReportV3,
  simulateScenario,
  validateWorkshopV3,
  type WorkshopDocumentV3,
} from '../../src/domain/v3';

function document(): WorkshopDocumentV3 {
  return {
    schemaVersion: 3,
    revision: 4,
    hash: 'current-hash',
    mode: 'prewire',
    sources: [{ id: 'dc', positiveTerminal: '+', returnTerminal: '-', voltage: 24 }],
    elements: [{ kind: 'load', id: 'load', positiveTerminal: '+', returnTerminal: '-' }],
    branches: [
      { id: 'positive', from: { elementId: 'dc', terminalId: '+' }, to: { elementId: 'load', terminalId: '+' }, conductor: 'dc' },
      { id: 'return', from: { elementId: 'load', terminalId: '-' }, to: { elementId: 'dc', terminalId: '-' }, conductor: 'dc' },
    ],
    reviewScope: { elementIds: ['load'] },
  };
}

const requirements = {
  profilesEligible: true,
  assetsEligible: true,
  geometryEligible: true,
  physicalReviewPassed: true,
  requiredScenarioIds: ['base-test'],
};

describe('v3 verified report eligibility', () => {
  it('requires a current PASS and every required deterministic scenario', () => {
    const source = document();
    const validation = validateWorkshopV3(source);
    const scenario = simulateScenario(source, { id: 'base-test' });

    expect(canIssueVerifiedReportV3(source, validation, [scenario], requirements))
      .toEqual({ eligible: true, status: 'PASS', reason: null });
  });

  it('returns STALE after a revision/hash edit and BLOCKED for missing evidence gates', () => {
    const source = document();
    const validation = validateWorkshopV3(source);
    const scenario = simulateScenario(source, { id: 'base-test' });

    expect(canIssueVerifiedReportV3({ ...source, revision: 5 }, validation, [scenario], requirements).status).toBe('STALE');
    expect(canIssueVerifiedReportV3(source, validation, [scenario], { ...requirements, assetsEligible: false }).status).toBe('BLOCKED');
  });

  it('rejects duplicate scenario IDs and scenario validations that are stale independently of the main validation', () => {
    const source = document();
    const validation = validateWorkshopV3(source);
    const scenario = simulateScenario(source, { id: 'base-test' });

    expect(canIssueVerifiedReportV3(source, validation, [scenario, scenario], requirements))
      .toMatchObject({ eligible: false, status: 'BLOCKED' });
    expect(canIssueVerifiedReportV3(source, validation, [{
      ...scenario,
      validation: { ...scenario.validation, documentHash: 'obsolete-hash' },
    }], requirements)).toMatchObject({ eligible: false, status: 'STALE' });
    expect(canIssueVerifiedReportV3(source, validation, [scenario], {
      ...requirements, requiredScenarioIds: ['base-test', 'base-test'],
    })).toMatchObject({ eligible: false, status: 'BLOCKED' });
  });
});
