import { describe, expect, it } from 'vitest';
import {
  DEVICE_PROFILES_V3,
  getDeviceProfileV3,
  validateExactOrderCode,
  validatePrewireEligibility,
  validateXbfAh04aConfiguration,
} from '../../src/catalog/v3-profiles';

describe('v3 device profile catalog', () => {
  it('allows review only for an exact, evidence-backed order code', () => {
    const xbc = getDeviceProfileV3('ls-electric:xbc-dr32h');
    expect(validateExactOrderCode(xbc, 'XBC-DR32H')).toEqual({ ok: true });
    expect(validateExactOrderCode(xbc, 'XBC-DR32H family')).toMatchObject({ ok: false, reason: 'order-code-mismatch' });
    expect(validateExactOrderCode(xbc, '')).toMatchObject({ ok: false, reason: 'order-code-required' });
  });

  it('carries the locally and officially evidenced exact order codes into v3', () => {
    expect(Object.values(DEVICE_PROFILES_V3).map((profile) => profile.orderCode)).toEqual([
      'XBC-DN32UP',
      'XBC-DP32UP',
      'XBC-DR32H',
      'eXP2-0700D',
      'XBL-C41A',
      'XBF-AH04A',
      'XBF-PD02A',
      'MDR-100-24',
      'MC-22b / DC24 / 1a1b',
      'MY2N-D2 DC24V',
      'EOCR3DE-05DUH',
      '3044076',
      '3044092',
      '3046032',
    ]);
    expect(Object.values(DEVICE_PROFILES_V3).every((profile) => profile.evidence.grade === 'manual-verified')).toBe(true);
    expect(getDeviceProfileV3('ls-electric:xbf-ah04a').evidence.documents).toContainEqual(expect.objectContaining({
      documentId: '03_LS_XGB_Analog_Manual_KR.pdf',
      pages: [24, 33, 34, 202, 203, 204, 235, 236],
      sha256: '92BF211773DD2FA2D5C11469546C74E148059F55E53866E05022D229CF9A58AF',
    }));
  });

  it('uses manual-backed physical dimensions instead of generated-image proportions', () => {
    expect(getDeviceProfileV3('ls-electric:xbc-dn32up').behavior).toMatchObject({
      dimensionsMm: { width: 185, height: 90, depth: 64 },
    });
    expect(getDeviceProfileV3('ls-electric:xbc-dp32up').behavior).toMatchObject({
      dimensionsMm: { width: 185, height: 90, depth: 64 },
    });
    expect(getDeviceProfileV3('ls-electric:xbc-dr32h').behavior).toMatchObject({
      dimensionsMm: { width: 114, height: 100, depth: 64 },
    });
    expect(getDeviceProfileV3('ls-electric:xbf-ah04a').behavior).toMatchObject({
      dimensionsMm: { width: 20, height: 90, depth: 63 },
    });
    expect(getDeviceProfileV3('mean-well:mdr-100-24').behavior).toMatchObject({
      dimensionsMm: { width: 55, height: 90, depth: 100 },
    });
    expect(getDeviceProfileV3('ls-electric:mc-22b-dc24-1a1b').behavior).toMatchObject({
      dimensionsMm: { width: 45, height: 73.5, depth: 103.6 },
    });
    expect(getDeviceProfileV3('omron:my2n-d2-dc24').behavior).toMatchObject({
      dimensionsMm: { width: 21.5, height: 36, depth: 28 },
    });
  });

  it('keeps new transistor PLC profiles fail-closed until their pointer geometry is approved', () => {
    for (const [profileId, orderCode] of [
      ['ls-electric:xbc-dn32up', 'XBC-DN32UP'],
      ['ls-electric:xbc-dp32up', 'XBC-DP32UP'],
    ] as const) {
      const profile = getDeviceProfileV3(profileId);
      expect(profile.rack).toMatchObject({ role: 'host', family: 'LS-XGB', occupiedPoints: 64 });
      expect(validatePrewireEligibility(profile, orderCode)).toEqual({
        ok: false,
        reason: 'review-capability-incomplete',
      });
    }
  });

  it('keeps official a/b contact numbers and power-terminal semantics on the exact protection devices', () => {
    const mc = getDeviceProfileV3('ls-electric:mc-22b-dc24-1a1b');
    const eocr = getDeviceProfileV3('schneider:eocr3de-05duh');
    const byId = (profile: typeof mc) => new Map(profile.terminals.map((terminal) => [terminal.id, terminal]));

    expect(byId(mc).get('A1')).toMatchObject({ domain: 'dc', potential: '+24V', polarity: 'positive' });
    expect(byId(mc).get('A2')).toMatchObject({ domain: 'dc', potential: '0V', polarity: 'return' });
    expect(mc.internalLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '13', to: '14', normally: 'open' }),
      expect.objectContaining({ from: '21', to: '22', normally: 'closed' }),
    ]));
    expect(byId(eocr).get('A1')).toMatchObject({ domain: 'ac', potential: 'L1', polarity: 'line' });
    expect(byId(eocr).get('A2')).toMatchObject({ domain: 'ac', potential: 'N', polarity: 'neutral' });
    expect(eocr.internalLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '95', to: '96', normally: 'closed' }),
      expect.objectContaining({ from: '97', to: '98', normally: 'open' }),
      expect.objectContaining({ from: '07', to: '08', normally: 'open' }),
    ]));
    expect(eocr.evidence.documents).toContainEqual(expect.objectContaining({
      documentId: 'Schneider_EOCR_Digital_E_Instruction_2023.pdf',
      sha256: 'B7EFD3B57ACC65EA89656A202E1A30CE01718912FE7115FB2DBFC414507975F3',
    }));
  });

  it('models the exact MY2N-D2 diode polarity and de-energized a/b contact state', () => {
    const relay = getDeviceProfileV3('omron:my2n-d2-dc24');
    const byId = new Map(relay.terminals.map((terminal) => [terminal.id, terminal]));

    expect(byId.get('14')).toMatchObject({
      domain: 'dc', potential: '+24V', polarity: 'positive',
    });
    expect(byId.get('13')).toMatchObject({
      domain: 'dc', potential: '0V', polarity: 'return',
    });
    expect(relay.internalLinks).toEqual([
      expect.objectContaining({ from: '9', to: '1', stateKey: 'pole-1', normally: 'closed' }),
      expect.objectContaining({ from: '9', to: '5', stateKey: 'pole-1', normally: 'open' }),
      expect.objectContaining({ from: '12', to: '4', stateKey: 'pole-2', normally: 'closed' }),
      expect.objectContaining({ from: '12', to: '8', stateKey: 'pole-2', normally: 'open' }),
    ]);
    expect(relay.behavior).toMatchObject({
      contactStateSource: 'coil',
      coil: {
        positiveTerminal: '14',
        returnTerminal: '13',
        nominalVoltageVdc: 24,
        mustOperateVoltageVdc: 19.2,
        resistanceOhms: 662,
      },
    });
    expect(relay.evidence.documents).toContainEqual(expect.objectContaining({
      documentId: 'Omron_MY_Series_J219-E1.pdf',
      revision: 'J219-E1-22 0525 (0618)',
      pages: [8, 10, 20],
      sha256: '2C422A3BA468E3140CE4D3D8D716F6C11AD11A842CA1999F5E7339847170242D',
    }));
  });

  it('models exact through, PE, and fused terminal assemblies from their official item numbers', () => {
    const through = getDeviceProfileV3('phoenix-contact:ut-2.5-3044076');
    const pe = getDeviceProfileV3('phoenix-contact:ut-2.5-pe-3044092');
    const fused = getDeviceProfileV3('phoenix-contact:ut-4-hesi-3046032');

    expect(through.terminals.every((terminal) => terminal.commonType === 'power-pass-through')).toBe(true);
    expect(through.terminals.map((terminal) => ({
      id: terminal.id,
      marker: terminal.marker,
      connectionPoint: terminal.connectionPoint,
    }))).toEqual([
      { id: '1', marker: '1', connectionPoint: 'A' },
      { id: '2', marker: '1', connectionPoint: 'B' },
    ]);
    expect(through.terminals.every((terminal) => terminal.maxConductors === 1
      && terminal.conductorRangeMm2?.min === 0.14
      && terminal.conductorRangeMm2.max === 4
      && terminal.tighteningTorqueNm?.min === 0.5
      && terminal.tighteningTorqueNm.max === 0.6
      && terminal.strippingLengthMm === 9)).toBe(true);
    expect(through.internalLinks).toContainEqual(expect.objectContaining({ kind: 'conductive', from: '1', to: '2' }));
    expect(through.behavior).toMatchObject({
      maximumConductorsPerConnection: 1,
      conditionalTwoConductorRule: {
        sameCrossSectionRequired: true,
        rigidOrFlexibleRangeMm2: [0.14, 1.5],
      },
    });
    expect(pe.terminals.every((terminal) => terminal.domain === 'pe' && terminal.polarity === 'protective-earth')).toBe(true);
    expect(pe.terminals.map((terminal) => terminal.marker)).toEqual(['PE 1', 'PE 1']);
    expect(fused.terminals.every((terminal) => terminal.commonType === 'fused-power')).toBe(true);
    expect(fused.terminals.map((terminal) => terminal.marker)).toEqual(['1', '1']);
    expect(fused.terminals.every((terminal) => terminal.maxConductors === 1
      && terminal.conductorRangeMm2?.max === 6
      && terminal.tighteningTorqueNm?.max === 0.8)).toBe(true);
    expect(fused.internalLinks).toContainEqual(expect.objectContaining({
      kind: 'dynamic-contact', from: '1', to: '2', normally: 'closed',
    }));
  });

  it('preserves complete L/N, DC return, COM-group, analog, and bus terminal semantics in v3', () => {
    const xbc = getDeviceProfileV3('ls-electric:xbc-dr32h');
    const xbf = getDeviceProfileV3('ls-electric:xbf-ah04a');
    const mdr = getDeviceProfileV3('mean-well:mdr-100-24');
    const byId = (profile: typeof xbc) => new Map(profile.terminals.map((terminal) => [terminal.id, terminal]));

    expect(byId(xbc).get('L')).toMatchObject({
      domain: 'ac', potential: 'L1', phase: 'L1', role: 'supply-input', polarity: 'line',
    });
    expect(byId(xbc).get('24G')).toMatchObject({
      domain: 'dc', potential: '0V', role: 'source', polarity: 'return',
    });
    expect(byId(xbc).get('COMI')).toMatchObject({
      role: 'common', polarity: 'configurable', commonType: 'configurable-dc', comGroup: 'COMI',
    });
    expect(byId(xbc).get('P00')).toMatchObject({
      role: 'input', polarity: 'signal-positive', comGroup: 'COMI', channel: 'P00',
    });
    expect(byId(xbc).get('COM0')).toMatchObject({
      role: 'common', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'COM0',
    });
    expect(byId(xbc).get('P20')).toMatchObject({
      role: 'output', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'COM0',
    });
    expect(byId(xbf).get('I0-')).toMatchObject({
      domain: 'signal', polarity: 'signal-return', commonType: 'analog-reference', channel: 'AI0',
    });
    expect(byId(mdr).get('V-1')).toMatchObject({
      domain: 'dc', potential: '0V', polarity: 'return',
    });
    expect(mdr.internalLinks).toContainEqual(expect.objectContaining({
      from: 'DCOK-A', to: 'DCOK-B', kind: 'dynamic-contact', normally: 'open',
    }));
    expect(mdr.behavior).toMatchObject({
      dcOkContact: {
        terminals: ['DCOK-A', 'DCOK-B'],
        state: 'closed-when-dc-ok',
        maximumRating: { voltageVdc: 30, currentA: 1, load: 'resistive' },
      },
    });
  });

  it('does not let an exact order code bypass an ineligible evidence grade', () => {
    const xbc = getDeviceProfileV3('ls-electric:xbc-dr32h');
    expect(validatePrewireEligibility({ ...xbc, evidence: { ...xbc.evidence, grade: 'educational' } }, 'XBC-DR32H'))
      .toEqual({ ok: false, reason: 'evidence-grade-ineligible' });
  });

  it('keeps the exact Cnet 5-pin order and blocks profile-only modules from verified review', () => {
    const cnet = getDeviceProfileV3('ls-electric:xbl-c41a');
    expect(cnet.terminals.map((terminal) => terminal.id)).toEqual(['TX+', 'TX-', 'RX+', 'RX-', 'SG']);
    expect(cnet.terminals.map((terminal) => terminal.polarity)).toEqual([
      'data-positive', 'data-negative', 'data-positive', 'data-negative', 'reference',
    ]);
    expect(cnet.evidence.documents).toContainEqual(expect.objectContaining({
      documentId: '09_LS_XGB_Cnet_XBL-C41A_Manual_KR.pdf',
      pages: [195, 196, 217],
      sha256: 'D0D9A6C360004550A4936EBA34B8165DE6445E4812E532A41BC71886682D7F16',
    }));
    expect(cnet.rack).toMatchObject({ role: 'module', family: 'LS-XGB', occupiedPoints: 64 });
    expect(validatePrewireEligibility(cnet, 'XBL-C41A')).toEqual({
      ok: false,
      reason: 'review-capability-incomplete',
    });
  });

  it('maps all 40 PD02A connector pins and never treats NC pins as conductive terminals', () => {
    const positioning = getDeviceProfileV3('ls-electric:xbf-pd02a');
    expect(positioning.terminals).toHaveLength(40);
    expect(positioning.terminals.map((terminal) => terminal.id)).toEqual(expect.arrayContaining([
      'B20', 'A20', 'B19', 'A19', 'B18', 'A18', 'B01', 'A01',
    ]));
    for (const terminalId of ['A20', 'A19']) {
      expect(positioning.terminals.find((terminal) => terminal.id === terminalId)).toMatchObject({
        role: 'input', polarity: 'signal-return',
      });
    }
    for (const terminalId of ['B17', 'A17', 'B15', 'A15']) {
      expect(positioning.terminals.find((terminal) => terminal.id === terminalId)).toMatchObject({
        role: 'output', polarity: 'signal-return',
      });
    }
    for (const terminalId of ['B11', 'A11', 'B10', 'A10', 'B08', 'A08', 'B01', 'A01']) {
      expect(positioning.terminals.find((terminal) => terminal.id === terminalId)).toMatchObject({
        role: 'not-connected', domain: 'floating', potential: 'floating', polarity: 'none',
      });
    }
    expect(positioning.evidence.documents).toContainEqual(expect.objectContaining({
      documentId: '08_LS_XBF-PD02A_Positioning_Manual_KR.pdf',
      pages: [26, 29, 30],
      sha256: 'AEEDDA2002AB616A5A02B25224B3AA462A128375AF1C41392502386FA44ED3F7',
    }));
    expect(positioning.rack).toMatchObject({ role: 'module', moduleClass: 'high-speed', occupiedPoints: 64 });
    expect(validatePrewireEligibility(positioning, 'XBF-PD02A')).toEqual({
      ok: false,
      reason: 'review-capability-incomplete',
    });
  });

  it('blocks an enabled XBF channel whose physical selector disagrees with its parameter range', () => {
    const xbf = getDeviceProfileV3('ls-electric:xbf-ah04a');
    const result = validateXbfAh04aConfiguration(xbf, {
      AI0: { enabled: true, selector: 'V', parameterRange: '4-20mA' },
      AI1: { enabled: false },
      AO0: { enabled: false },
      AO1: { enabled: false },
    });

    expect(result).toMatchObject({ ok: false, reason: 'selector-range-mismatch', channelId: 'AI0' });
  });

  it('blocks XBF review when a channel configuration is incomplete', () => {
    const xbf = getDeviceProfileV3('ls-electric:xbf-ah04a');
    const result = validateXbfAh04aConfiguration(xbf, {
      AI0: { enabled: true, selector: 'V' },
      AI1: { enabled: false },
      AO0: { enabled: false },
      AO1: { enabled: false },
    });

    expect(result).toMatchObject({ ok: false, reason: 'incomplete-channel-configuration', channelId: 'AI0' });
  });
});
