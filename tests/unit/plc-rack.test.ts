import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES_V3 } from '../../src/catalog/v3-profiles';
import {
  assignXgbRack,
  xgbPAddressFromPoint,
  xgbSlotRange,
  type RackDevicePlacement,
} from '../../src/domain/plc-rack';

const placement = (
  deviceId: string,
  profileId: string,
  xMm: number,
  requestedSlot?: number,
): RackDevicePlacement => ({
  deviceId,
  profileId,
  xMm,
  yMm: 0,
  railId: 'DIN-1',
  ...(requestedSlot === undefined ? {} : { requestedSlot }),
});

describe('manual-backed XGB rack allocation', () => {
  it('formats the hexadecimal bit suffix used by XG5000 P addresses', () => {
    expect(xgbPAddressFromPoint(0)).toBe('P0000');
    expect(xgbPAddressFromPoint(31)).toBe('P001F');
    expect(xgbPAddressFromPoint(32)).toBe('P0020');
    expect(xgbPAddressFromPoint(63)).toBe('P003F');
    expect(xgbPAddressFromPoint(64)).toBe('P0040');
    expect(xgbPAddressFromPoint(127)).toBe('P007F');
    expect(xgbPAddressFromPoint(192)).toBe('P0120');
  });

  it('allocates the official 64-point range to each expansion stage deterministically', () => {
    expect(xgbSlotRange(1)).toMatchObject({ start: 'P0040', end: 'P007F' });
    expect(xgbSlotRange(3)).toMatchObject({ start: 'P0120', end: 'P015F' });

    const result = assignXgbRack([
      placement('plc1', 'ls-electric:xbc-dr32h', 0),
      placement('pd1', 'ls-electric:xbf-pd02a', 140),
      placement('cnet1', 'ls-electric:xbl-c41a', 100, 3),
    ], DEVICE_PROFILES_V3);

    expect(result.issues).toEqual([]);
    expect(result.assignments).toMatchObject({
      plc1: { slot: 0, range: { start: 'P0000', end: 'P003F' } },
      pd1: { hostDeviceId: 'plc1', slot: 1, range: { start: 'P0040', end: 'P007F' } },
      cnet1: { hostDeviceId: 'plc1', slot: 3, range: { start: 'P0120', end: 'P015F' } },
    });
  });

  it('fails closed for duplicate, out-of-range, and unattached module slots', () => {
    const result = assignXgbRack([
      placement('plc1', 'ls-electric:xbc-dr32h', 0),
      placement('cnet1', 'ls-electric:xbl-c41a', 100, 2),
      placement('cnet2', 'ls-electric:xbl-c41a', 120, 2),
      placement('pd-overflow', 'ls-electric:xbf-pd02a', 140, 11),
      { ...placement('pd-other-rail', 'ls-electric:xbf-pd02a', 160), railId: 'DIN-2' },
    ], DEVICE_PROFILES_V3);

    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'RACK_SLOT_DUPLICATE', 'RACK_SLOT_OUT_OF_RANGE', 'RACK_HOST_NOT_FOUND',
    ]));
    expect(result.assignments.cnet2).toBeUndefined();
    expect(result.assignments['pd-overflow']).toBeUndefined();
  });
});
