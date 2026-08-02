import { describe, expect, it } from 'vitest';
import { MY2N_D2_DC24_BEHAVIOR } from '../../src/catalog/device-behavior-profiles';
import { getDeviceProfileV3 } from '../../src/catalog/v3-profiles';
import {
  DeviceBehaviorProfileSchema,
  createInitialDeviceBehaviorSnapshot,
  stepDeviceBehavior,
} from '../../src/domain/device-runtime';

describe('DeviceBehaviorProfile', () => {
  it('accepts the manual-backed MY2N-D2 profile and switches its contacts from solved coil energy', () => {
    const profile = DeviceBehaviorProfileSchema.parse(MY2N_D2_DC24_BEHAVIOR);
    const initial = createInitialDeviceBehaviorSnapshot(profile);
    expect(initial).toMatchObject({ state: 'deenergized', outputs: { indicator: false, no1: false, nc1: true } });

    const energized = stepDeviceBehavior(profile, initial, { coilEnergized: true }, 20);
    expect(energized).toMatchObject({ state: 'energized', outputs: { indicator: true, no1: true, nc1: false } });

    const released = stepDeviceBehavior(profile, energized, { coilEnergized: false }, 20);
    expect(released).toMatchObject({ state: 'deenergized', outputs: { indicator: false, no1: false, nc1: true } });
  });

  it('attaches the validated behavior to the exact-order-code v3 equipment profile', () => {
    const equipment = getDeviceProfileV3('omron:my2n-d2-dc24');
    expect(equipment.orderCode).toBe('MY2N-D2 DC24V');
    expect(DeviceBehaviorProfileSchema.parse(equipment.behaviorProfile)).toEqual(MY2N_D2_DC24_BEHAVIOR);
  });

  it('rejects dangling states, inputs and missing manual evidence', () => {
    expect(() => DeviceBehaviorProfileSchema.parse({
      ...MY2N_D2_DC24_BEHAVIOR,
      manualEvidence: [],
      states: [{
        id: 'deenergized',
        outputs: { indicator: false },
        transitions: [{ to: 'missing', when: { kind: 'boolean-input', inputId: 'missing', equals: true } }],
      }],
    })).toThrow();
  });

  it('is deterministic and never evaluates executable script strings', () => {
    const profile = DeviceBehaviorProfileSchema.parse(MY2N_D2_DC24_BEHAVIOR);
    const initial = createInitialDeviceBehaviorSnapshot(profile);
    expect(stepDeviceBehavior(profile, initial, { coilEnergized: true }, 20))
      .toEqual(stepDeviceBehavior(profile, initial, { coilEnergized: true }, 20));
    expect(JSON.stringify(profile)).not.toMatch(/eval|new Function/);
  });
});
