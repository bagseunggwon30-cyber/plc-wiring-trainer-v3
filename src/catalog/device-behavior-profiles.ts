import type { DeviceBehaviorProfile } from '../domain/device-runtime/contracts';

/**
 * MY2N-D2 DC24V behavior is intentionally limited to the manual-backed coil,
 * indicator and de-energized/energized DPDT contact states. Bounce, thermal
 * transients and mechanical life are reported as unsupported, never guessed.
 */
export const MY2N_D2_DC24_BEHAVIOR = Object.freeze({
  schemaVersion: 1,
  profileId: 'omron:my2n-d2-dc24:behavior',
  profileVersion: '1.0.0',
  manufacturer: 'OMRON',
  fullOrderCode: 'MY2N-D2 DC24V',
  initialState: 'deenergized',
  inputs: [{
    id: 'coilEnergized',
    dataType: 'boolean',
    source: 'circuit-element-energized',
    terminalIds: ['14', '13'],
  }],
  states: [
    {
      id: 'deenergized',
      outputs: { indicator: false, no1: false, nc1: true, no2: false, nc2: true },
      transitions: [{
        to: 'energized',
        when: { kind: 'boolean-input', inputId: 'coilEnergized', equals: true },
        delayMs: 20,
      }],
    },
    {
      id: 'energized',
      outputs: { indicator: true, no1: true, nc1: false, no2: true, nc2: false },
      transitions: [{
        to: 'deenergized',
        when: { kind: 'boolean-input', inputId: 'coilEnergized', equals: false },
        delayMs: 20,
      }],
    },
  ],
  faults: [],
  ratings: {
    nominalCoilVoltageVdc: 24,
    mustOperateVoltageVdc: 19.2,
    maximumCoilVoltageVdc: 26.4,
    ratedCoilCurrentA: 0.0363,
    coilResistanceOhms: 662,
    coilPowerW: 0.9,
  },
  unsupportedBehaviors: ['contact-bounce', 'coil-thermal-transient', 'mechanical-life-aging'],
  manualEvidence: [{
    manualId: 'Omron_MY_Series_J219-E1.pdf',
    pages: [8, 10, 20],
    sha256: '2C422A3BA468E3140CE4D3D8D716F6C11AD11A842CA1999F5E7339847170242D',
    note: 'DC24V coil, DPDT ratings, bottom-view pins, diode polarity and de-energized contacts.',
  }],
} satisfies DeviceBehaviorProfile);
