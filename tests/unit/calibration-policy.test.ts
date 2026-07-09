import { describe, expect, it } from 'vitest';
import { applyProfileOverride } from '../../src/domain/calibration-policy';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';

describe('calibration evidence policy', () => {
  it('preserves evidence for coordinate and hit-area changes', () => {
    const profile = DEVICE_PROFILES['mean-well:mdr-100-24'];
    const result = applyProfileOverride(profile, {
      kind: 'geometry',
      terminalId: 'L',
      anchor: { x: 10, y: 20 },
      hitRadius: 18,
    });
    expect(result.evidence.level).toBe('manual-verified');
  });

  it.each(['terminal-add', 'terminal-delete', 'terminal-id', 'electrical', 'internal-link'] as const)(
    'downgrades %s overrides to educational',
    (kind) => {
      const profile = DEVICE_PROFILES['mean-well:mdr-100-24'];
      const result = applyProfileOverride(profile, { kind });
      expect(result.evidence.level).toBe('educational');
      expect(result.profileId).toContain(':local:');
    },
  );
});

