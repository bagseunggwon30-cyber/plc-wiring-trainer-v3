import { describe, expect, it } from 'vitest';
import { getDeviceProfileV3 } from '../../src/catalog/v3-profiles';
import { applyV3CalibrationOverride, checkApprovedTerminalGeometryParity, checkTerminalGeometryParity } from '../../src/catalog/v3-geometry';

describe('v3 terminal geometry trust policy', () => {
  it('rejects hidden and extra terminals even when all expected ids are present', () => {
    const profile = getDeviceProfileV3('mean-well:mdr-100-24');
    const geometry = profile.terminals.map((terminal, index) => ({
      terminalId: terminal.id,
      anchor: { x: index, y: index },
      visible: terminal.id !== 'L',
    }));
    geometry.push({ terminalId: 'invented', anchor: { x: 10, y: 10 }, visible: true });

    expect(checkTerminalGeometryParity(profile, geometry)).toEqual({
      ok: false,
      missingTerminalIds: [],
      hiddenTerminalIds: ['L'],
      extraTerminalIds: ['invented'],
      duplicateTerminalIds: [],
    });
  });

  it('downgrades evidence after a structural calibration override', () => {
    const profile = getDeviceProfileV3('mean-well:mdr-100-24');
    const result = applyV3CalibrationOverride(profile, { kind: 'terminal-add', terminalId: 'added-terminal' });

    expect(result.evidence.grade).toBe('educational');
    expect(result.evidence.note).toContain('Structural calibration override');
  });

  it.each([
    ['ls-electric:xbc-dr32h'],
    ['ls-electric:xbf-ah04a'],
    ['mean-well:mdr-100-24'],
    ['ls-electric:mc-22b-dc24-1a1b'],
    ['omron:my2n-d2-dc24'],
    ['schneider:eocr3de-05duh'],
    ['phoenix-contact:ut-2.5-3044076'],
    ['phoenix-contact:ut-2.5-pe-3044092'],
    ['phoenix-contact:ut-4-hesi-3046032'],
  ])('requires the exact visible terminal ID set for %s', (profileId) => {
    const profile = getDeviceProfileV3(profileId);
    const snapshot = {
      deviceId: 'device-1', profileId, assetId: 'approved-asset', geometryHash: 'geometry-hash',
      terminals: profile.terminals.map((terminal, index) => ({ terminalId: terminal.id, anchor: { x: index, y: index }, visible: true })),
    };

    expect(checkApprovedTerminalGeometryParity(profile, snapshot, () => true)).toMatchObject({ ok: true, approved: true });
    expect(checkApprovedTerminalGeometryParity(profile, snapshot, () => false)).toMatchObject({ ok: false, approved: false });
  });
});
