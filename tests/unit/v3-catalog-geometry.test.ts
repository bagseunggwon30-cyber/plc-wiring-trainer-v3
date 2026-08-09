import { describe, expect, it } from 'vitest';
import { getDeviceProfileV3 } from '../../src/catalog/v3-profiles';
import {
  applyV3CalibrationOverride,
  checkApprovedTerminalGeometryParity,
  checkTerminalGeometryParity,
  measureTerminalCenterCalibration,
} from '../../src/catalog/v3-geometry';

describe('v3 terminal geometry trust policy', () => {
  it('calculates RMS and maximum pointer-centre error against the 3px/5px gate', () => {
    const passing = measureTerminalCenterCalibration([
      { terminalId: 'A', reference: { x: 10, y: 10 }, observed: { x: 11, y: 12 } },
      { terminalId: 'B', reference: { x: 20, y: 20 }, observed: { x: 22, y: 20 } },
    ]);
    expect(passing.ok).toBe(true);
    expect(passing.rmsErrorPx).toBeCloseTo(Math.sqrt(4.5));
    expect(passing.maxErrorPx).toBeCloseTo(Math.sqrt(5));
    expect(passing.worstTerminalId).toBe('A');

    const failing = measureTerminalCenterCalibration([
      { terminalId: 'A', reference: { x: 0, y: 0 }, observed: { x: 6, y: 0 } },
    ]);
    expect(failing).toMatchObject({ ok: false, sampleCount: 1, maxErrorPx: 6, worstTerminalId: 'A' });
    expect(measureTerminalCenterCalibration([]).ok).toBe(false);
  });

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
    ['ls-electric:xbc-dn32up'],
    ['ls-electric:xbc-dp32up'],
    ['ls-electric:xbc-dr32h'],
    ['ls-electric:xbl-c41a'],
    ['ls-electric:xbf-ah04a'],
    ['ls-electric:xbf-pd02a'],
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
