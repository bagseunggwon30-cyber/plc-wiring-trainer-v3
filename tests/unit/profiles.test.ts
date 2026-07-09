import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES, verifiedProfiles } from '../../src/catalog/profiles';
import { DeviceProfileSchema } from '../../src/domain/schema';

describe('device profile catalog', () => {
  it('manual-verifies only the three evidence-backed initial profiles', () => {
    expect(verifiedProfiles().map((profile) => profile.profileId)).toEqual([
      'ls-electric:xbc-dr32h',
      'ls-electric:xbf-ah04a',
      'mean-well:mdr-100-24',
    ]);
    expect(DEVICE_PROFILES['ls-electric:sv-ig5a'].evidence.level).toBe('educational');
    expect(DEVICE_PROFILES['generic:xy-md02'].evidence.level).toBe('educational');
  });

  it('records manual pages and sha256 for every verified profile', () => {
    for (const profile of verifiedProfiles()) {
      expect(profile.evidence.documents.length).toBeGreaterThan(0);
      for (const document of profile.evidence.documents) {
        expect(document.pages.length).toBeGreaterThan(0);
        expect(document.sha256).toMatch(/^[A-F0-9]{64}$/);
      }
    }
  });

  it('keeps boundary nodes out of the bill of materials', () => {
    const boundaries = Object.values(DEVICE_PROFILES).filter((profile) => profile.boundary);
    expect(boundaries.map((profile) => profile.profileId)).toEqual([
      'boundary:ac-supply',
      'boundary:dc-supply',
      'boundary:dry-contact',
      'boundary:load',
      'boundary:communication-peer',
    ]);
    expect(boundaries.every((profile) => profile.includeInBom === false)).toBe(true);
  });

  it('conforms every catalog entry to the runtime schema', () => {
    for (const profile of Object.values(DEVICE_PROFILES)) {
      expect(DeviceProfileSchema.parse(profile)).toEqual(profile);
    }
  });
});

