import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { canIssueVerifiedReport } from '../../src/domain/verification';
import { validateWorkshop } from '../../src/domain/validator';
import type { WorkshopDocumentV2 } from '../../src/domain/types';

function prewire(profileId = 'mean-well:mdr-100-24'): WorkshopDocumentV2 {
  const profile = DEVICE_PROFILES[profileId];
  return {
    schemaVersion: 2,
    mode: 'prewire',
    revision: 4,
    name: 'verification test',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices: [
      {
        id: 'd1',
        profileId,
        profileVersion: profile.version,
        evidenceLevel: profile.evidence.level,
        missingProfile: false,
        x: 0,
        y: 0,
        rotation: 0,
        configuration: {},
      },
    ],
    wires: [],
    jumpers: [],
    layout: {},
    settings: {},
    extensions: { legacy: {} },
  };
}

describe('verified report eligibility', () => {
  it('passes only a fresh PASS result with eligible profiles', async () => {
    const doc = prewire();
    const validation = await validateWorkshop(doc, DEVICE_PROFILES);
    expect(validation.status).toBe('PASS');
    expect(await canIssueVerifiedReport(doc, validation, DEVICE_PROFILES)).toEqual({
      eligible: true,
      status: 'PASS',
      reason: null,
    });
  });

  it('marks a result stale after any document edit', async () => {
    const doc = prewire();
    const validation = await validateWorkshop(doc, DEVICE_PROFILES);
    doc.revision += 1;
    const eligibility = await canIssueVerifiedReport(doc, validation, DEVICE_PROFILES);
    expect(eligibility.status).toBe('STALE');
    expect(eligibility.eligible).toBe(false);
  });

  it('blocks educational equipment in prewire mode', async () => {
    const doc = prewire('ls-electric:sv-ig5a');
    const validation = await validateWorkshop(doc, DEVICE_PROFILES);
    expect(validation.status).toBe('BLOCKED');
    expect((await canIssueVerifiedReport(doc, validation, DEVICE_PROFILES)).eligible).toBe(false);
  });

  it('blocks a locally downgraded instance even when its base profile was verified', async () => {
    const doc = prewire();
    doc.devices[0].evidenceLevel = 'educational';
    const validation = await validateWorkshop(doc, DEVICE_PROFILES);
    expect(validation.status).toBe('BLOCKED');
    expect(validation.issues.map((issue) => issue.code)).toContain('INSTANCE_EVIDENCE_DOWNGRADED');
    expect((await canIssueVerifiedReport(doc, validation, DEVICE_PROFILES)).eligible).toBe(false);
  });
});
