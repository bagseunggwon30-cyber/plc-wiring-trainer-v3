import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES, verifiedProfiles } from '../../src/catalog/profiles';
import { DeviceProfileSchema } from '../../src/domain/schema';

describe('device profile catalog', () => {
  it('manual-verifies only exact profiles backed by retained official evidence', () => {
    expect(verifiedProfiles().map((profile) => profile.profileId)).toEqual([
      'ls-electric:xbc-dn32up',
      'ls-electric:xbc-dp32up',
      'ls-electric:xbc-dn60su',
      'ls-electric:xbc-dn32h',
      'ls-electric:xbc-dr32h',
      'ls-electric:xbl-c41a',
      'ls-electric:xbf-pd02a',
      'ls-electric:exp2-0700d',
      'ls-electric:xbf-ah04a',
      'mean-well:mdr-100-24',
      'ls-electric:mc-22b-dc24-1a1b',
      'omron:my2n-d2-dc24',
      'schneider:eocr3de-05duh',
      'phoenix-contact:ut-2.5-3044076',
      'phoenix-contact:ut-2.5-pe-3044092',
      'phoenix-contact:ut-4-hesi-3046032',
    ]);
    expect(DEVICE_PROFILES['ls-electric:sv-ig5a'].evidence.level).toBe('educational');
    expect(DEVICE_PROFILES['generic:xy-md02'].evidence.level).toBe('educational');
    expect(DEVICE_PROFILES['generic:prox-npn-3wire'].evidence.level).toBe('educational');
    expect(DEVICE_PROFILES['generic:prox-pnp-3wire'].evidence.level).toBe('educational');
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
      'boundary:analog-voltage-source',
      'boundary:analog-current-source',
      'boundary:analog-voltage-input',
      'boundary:analog-current-input',
      'boundary:two-wire-current-transmitter',
      'boundary:communication-peer',
    ]);
    expect(boundaries.every((profile) => profile.includeInBom === false)).toBe(true);
  });

  it('conforms every catalog entry to the runtime schema', () => {
    for (const profile of Object.values(DEVICE_PROFILES)) {
      expect(DeviceProfileSchema.parse(profile)).toEqual(profile);
    }
  });

  it('does not hard-code XBF channel voltage/current mode into physical terminal numbers', () => {
    const xbf = DEVICE_PROFILES['ls-electric:xbf-ah04a'];
    const analogTerminals = xbf.terminals.filter((terminal) => /^(I|O)[01][+-]$/.test(terminal.id));
    expect(analogTerminals).toHaveLength(8);
    expect(analogTerminals.every((terminal) => terminal.protocol === undefined)).toBe(true);
    expect(analogTerminals.map((terminal) => terminal.channel)).toEqual([
      'AI0', 'AI0', 'AI1', 'AI1', 'AO0', 'AO0', 'AO1', 'AO1',
    ]);
  });

  it('keeps XBC power, PE, P0F, configurable input COM and relay COM roles distinct', () => {
    const xbc = DEVICE_PROFILES['ls-electric:xbc-dr32h'];
    const byId = new Map(xbc.terminals.map((terminal) => [terminal.id, terminal]));

    expect(byId.get('24V')).toMatchObject({ domain: 'dc', potential: '+24V', polarity: 'positive' });
    expect(byId.get('24G')).toMatchObject({ domain: 'dc', potential: '0V', polarity: 'return' });
    expect(byId.get('PE')).toMatchObject({ domain: 'pe', polarity: 'protective-earth' });
    expect(byId.get('P0F')).toMatchObject({ role: 'input', comGroup: 'COMI', channel: 'P0F' });
    expect(byId.get('COMI')).toMatchObject({
      polarity: 'configurable', commonType: 'configurable-dc', comGroup: 'COMI',
    });
    expect(byId.get('COM0')).toMatchObject({
      polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'COM0',
    });
  });

  it('separates the exact DN sink and DP source output contracts without inventing connector pins', () => {
    const dn = DEVICE_PROFILES['ls-electric:xbc-dn32up'];
    const dp = DEVICE_PROFILES['ls-electric:xbc-dp32up'];
    const dnById = new Map(dn.terminals.map((terminal) => [terminal.id, terminal]));
    const dpById = new Map(dp.terminals.map((terminal) => [terminal.id, terminal]));

    expect(dn.terminals).toHaveLength(126);
    expect(dp.terminals).toHaveLength(126);
    expect(dn.behavior).toMatchObject({ kind: 'plc-transistor', outputMode: 'sinking-transistor' });
    expect(dp.behavior).toMatchObject({ kind: 'plc-transistor', outputMode: 'sourcing-transistor' });
    expect(dnById.get('P20')).toMatchObject({ polarity: 'signal-return', outputMode: 'sinking-transistor' });
    expect(dpById.get('P20')).toMatchObject({ polarity: 'signal-positive', outputMode: 'sourcing-transistor' });
    expect(dnById.get('VOUT')).toMatchObject({ potential: '+24V', role: 'supply-input' });
    expect(dnById.get('COMO')).toMatchObject({ potential: '0V', role: 'common' });
    expect(dpById.get('COMO')).toMatchObject({ potential: '+24V', role: 'common' });
    expect(dpById.get('0VOUT')).toMatchObject({ potential: '0V', role: 'supply-input' });
    expect(dn.internalLinks).toContainEqual({ from: 'COMI-A', to: 'COMI-B', kind: 'conductive' });
    expect(dnById.get('A20')).toMatchObject({ label: '20A MPG A+', channel: 'MPG-A' });
    expect(dnById.get('D20')).toMatchObject({ role: 'not-connected' });
  });

  it('keeps XBF channel G/return and MDR DC OK contacts separate from power 0V', () => {
    const xbf = new Map(DEVICE_PROFILES['ls-electric:xbf-ah04a'].terminals
      .map((terminal) => [terminal.id, terminal]));
    const mdr = new Map(DEVICE_PROFILES['mean-well:mdr-100-24'].terminals
      .map((terminal) => [terminal.id, terminal]));

    expect(xbf.get('I0-')).toMatchObject({
      domain: 'signal', polarity: 'signal-return', commonType: 'analog-reference', channel: 'AI0',
    });
    expect(xbf.get('0V')).toMatchObject({ domain: 'dc', potential: '0V', polarity: 'return' });
    expect(mdr.get('DCOK-A')).toMatchObject({ domain: 'floating', commonType: 'dry-contact' });
    expect(mdr.get('DCOK-B')).toMatchObject({ domain: 'floating', commonType: 'dry-contact' });
  });

  it('keeps iG5A educational while preserving manual-backed CM, MG, analog and contact roles', () => {
    const drive = DEVICE_PROFILES['ls-electric:sv-ig5a'];
    const byId = new Map(drive.terminals.map((terminal) => [terminal.id, terminal]));

    expect(drive.evidence.level).toBe('educational');
    expect(drive.evidence.documents).toEqual([
      expect.objectContaining({
        documentId: 'LS_SV-iG5A_User_Manual_EN_V2.4.pdf',
        pages: [21, 26, 27],
        sha256: '974654E65A7D0B61476CA64FD180BC3E0C96DE0407A2080012DFE879A2F7A950',
      }),
    ]);
    expect(byId.get('CM')).toMatchObject({
      domain: 'dc', potential: '0V', polarity: 'return', commonType: 'dc-control-common',
    });
    expect(byId.get('MG')).toMatchObject({
      domain: 'dc', potential: '0V', polarity: 'return', commonType: 'dc-output-common',
    });
    expect(byId.get('MO')).toMatchObject({ outputMode: 'sinking-transistor', polarity: 'signal-return' });
    expect(byId.get('VR')).toMatchObject({
      protocol: 'analog-voltage', role: 'source', ratedVoltage: { min: 12, max: 12, unit: 'VDC' },
    });
    expect(byId.get('V1')).toMatchObject({
      protocol: 'analog-voltage', role: 'input', ratedVoltage: { min: -10, max: 10, unit: 'VDC' },
    });
    expect(byId.get('I')).toMatchObject({ protocol: 'analog-current', role: 'input' });
    expect(byId.get('U')).toMatchObject({ phase: 'U', channel: 'motor-output' });
    expect(byId.get('V')).toMatchObject({ phase: 'V', channel: 'motor-output' });
    expect(byId.get('W')).toMatchObject({ phase: 'W', channel: 'motor-output' });
    expect(byId.get('3A')).toMatchObject({ commonType: 'dry-contact', comGroup: 'fault-relay' });
    expect(byId.get('3B')).toMatchObject({ commonType: 'dry-contact', comGroup: 'fault-relay' });
    expect(byId.get('3C')).toMatchObject({ commonType: 'dry-contact', comGroup: 'fault-relay' });
    expect(byId.get('P1')).toMatchObject({
      inputLogicMode: 'configurable',
      ratedVoltage: { min: 12, max: 24, unit: 'VDC' },
    });
  });

  it('types generic practice power and motor terminals without promoting them to prewire evidence', () => {
    const dcSource = DEVICE_PROFILES['educational:dc24-source-box'];
    const motor = DEVICE_PROFILES['educational:three-phase-motor'];
    const dcById = new Map(dcSource.terminals.map((terminal) => [terminal.id, terminal]));
    const motorById = new Map(motor.terminals.map((terminal) => [terminal.id, terminal]));

    expect(dcSource.evidence.level).toBe('educational');
    expect(dcById.get('L')).toMatchObject({ potential: 'L1', role: 'supply-input', polarity: 'line' });
    expect(dcById.get('N')).toMatchObject({ potential: 'N', role: 'supply-input', polarity: 'neutral' });
    expect(dcById.get('V+')).toMatchObject({ potential: '+24V', role: 'source', polarity: 'positive' });
    expect(dcById.get('V-')).toMatchObject({ potential: '0V', role: 'source', polarity: 'return' });
    expect(dcById.get('PE')).toMatchObject({ domain: 'pe', polarity: 'protective-earth' });
    expect(motor.evidence.level).toBe('educational');
    expect(motorById.get('U')).toMatchObject({ phase: 'U', role: 'input', channel: 'motor-input' });
    expect(motorById.get('V')).toMatchObject({ phase: 'V', role: 'input', channel: 'motor-input' });
    expect(motorById.get('W')).toMatchObject({ phase: 'W', role: 'input', channel: 'motor-input' });
  });

  it('keeps common practice loads and terminal blocks typed but educational', () => {
    const load = DEVICE_PROFILES['educational:dc24-load'];
    const solenoid = DEVICE_PROFILES['educational:dc24-solenoid'];
    const tb4 = DEVICE_PROFILES['educational:terminal-block-4'];

    expect(load.evidence.level).toBe('educational');
    expect(load.terminals).toEqual([
      expect.objectContaining({ id: '+', potential: '+24V', polarity: 'positive' }),
      expect.objectContaining({ id: '-', potential: '0V', polarity: 'return' }),
    ]);
    expect(solenoid.terminals).toEqual([
      expect.objectContaining({ id: 'A1', potential: '+24V', polarity: 'positive' }),
      expect.objectContaining({ id: 'A2', potential: '0V', polarity: 'return' }),
    ]);
    expect(tb4.terminals.map((terminal) => terminal.id)).toEqual([
      '1', "1'", '2', "2'", '3', "3'", '4', "4'",
    ]);
    expect(tb4.terminals.map((terminal) => ({
      id: terminal.id,
      label: terminal.label,
      marker: terminal.marker,
      connectionPoint: terminal.connectionPoint,
    }))).toEqual([
      { id: '1', label: '1', marker: '1', connectionPoint: 'A' },
      { id: "1'", label: '1', marker: '1', connectionPoint: 'B' },
      { id: '2', label: '2', marker: '2', connectionPoint: 'A' },
      { id: "2'", label: '2', marker: '2', connectionPoint: 'B' },
      { id: '3', label: '3', marker: '3', connectionPoint: 'A' },
      { id: "3'", label: '3', marker: '3', connectionPoint: 'B' },
      { id: '4', label: '4', marker: '4', connectionPoint: 'A' },
      { id: "4'", label: '4', marker: '4', connectionPoint: 'B' },
    ]);
    expect(tb4.internalLinks).toHaveLength(4);
  });
});
