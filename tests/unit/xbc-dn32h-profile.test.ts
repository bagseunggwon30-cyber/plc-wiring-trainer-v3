import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { auditProfileTerminalSemantics } from '../../src/catalog/terminal-semantic-audit';

describe('LS ELECTRIC XBC-DN32H manual-backed profile', () => {
  it('models the exact AC-powered 16DI/16 NPN sinking-output terminal contract', () => {
    const profile = DEVICE_PROFILES['ls-electric:xbc-dn32h'];
    expect(profile).toBeDefined();
    expect(profile).toMatchObject({
      manufacturer: 'LS ELECTRIC',
      model: 'XBC-DN32H',
      evidence: { level: 'manual-verified' },
      behavior: {
        kind: 'plc-transistor',
        outputMode: 'sinking-transistor',
        inputComTerminals: ['COMI'],
        outputSupplyTerminals: {
          positive: 'P',
          returns: ['COM0', 'COM1', 'COM2', 'COM3'],
        },
        dimensionsMm: { width: 114, height: 100, depth: 64 },
      },
    });

    const byId = new Map(profile.terminals.map((terminal) => [terminal.id, terminal]));
    expect(profile.terminals).toHaveLength(48);
    expect(byId.get('L')).toMatchObject({ domain: 'ac', potential: 'L1', role: 'supply-input' });
    expect(byId.get('N')).toMatchObject({ domain: 'ac', potential: 'N', role: 'supply-input' });
    expect(byId.get('PE')).toMatchObject({ domain: 'pe', role: 'protective-earth' });
    expect(byId.get('24V')).toMatchObject({ domain: 'dc', potential: '+24V', role: 'source' });
    expect(byId.get('24G')).toMatchObject({ domain: 'dc', potential: '0V', role: 'source' });
    expect(byId.get('COMI')).toMatchObject({
      polarity: 'configurable', commonType: 'configurable-dc', comGroup: 'COMI',
    });
    expect(byId.get('P')).toMatchObject({
      domain: 'dc', potential: '+24V', role: 'supply-input', polarity: 'positive',
    });

    for (let index = 0; index < 16; index += 1) {
      const inputId = `P0${index.toString(16).toUpperCase()}`;
      const outputId = `P2${index.toString(16).toUpperCase()}`;
      const group = `COM${Math.floor(index / 4)}`;
      expect(byId.get(inputId)).toMatchObject({ role: 'input', comGroup: 'COMI', channel: inputId });
      expect(byId.get(outputId)).toMatchObject({
        role: 'output', polarity: 'signal-return', outputMode: 'sinking-transistor', comGroup: group,
      });
    }
    for (let index = 0; index < 4; index += 1) {
      expect(byId.get(`COM${index}`)).toMatchObject({
        domain: 'dc', potential: '0V', role: 'common', polarity: 'return',
        commonType: 'dc-output-common', outputMode: 'sinking-transistor', comGroup: `COM${index}`,
      });
    }
    expect(auditProfileTerminalSemantics(profile)).toEqual([]);
  });
});
