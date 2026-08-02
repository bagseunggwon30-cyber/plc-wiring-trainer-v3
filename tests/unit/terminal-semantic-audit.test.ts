import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { auditProfileTerminalSemantics } from '../../src/catalog/terminal-semantic-audit';
import type { DeviceProfile } from '../../src/domain/types';

describe('catalog COM G V terminal semantic audit', () => {
  it('keeps every registered overloaded terminal label explicit and unique', () => {
    const issues = Object.values(DEVICE_PROFILES)
      .flatMap((profile) => auditProfileTerminalSemantics(profile));

    expect(issues).toEqual([]);
  });

  it('rejects an untyped SG reference, a motor V mislabeled as mains L2, and an invalid N potential', () => {
    const profile: DeviceProfile = {
      profileId: 'test:ambiguous',
      version: '1.0.0',
      manufacturer: 'Test',
      model: 'Ambiguous',
      evidence: { level: 'educational', documents: [] },
      boundary: false,
      includeInBom: true,
      terminals: [
        {
          id: 'SG', label: 'SG', domain: 'communication', potential: 'signal',
          role: 'common', polarity: 'reference', commonType: 'communication-reference',
        },
        {
          id: 'V', label: 'V/T2', domain: 'ac', potential: 'floating',
          role: 'output', polarity: 'line', phase: 'L2',
        },
        {
          id: 'N', label: 'N', domain: 'dc', potential: 'N',
          role: 'supply-input', polarity: 'return',
        },
      ],
      internalLinks: [],
    };

    expect(auditProfileTerminalSemantics(profile)).toEqual([
      expect.objectContaining({ terminalId: 'SG', code: 'AMBIGUOUS_TERMINAL_ROLE' }),
      expect.objectContaining({ terminalId: 'V', code: 'AMBIGUOUS_TERMINAL_ROLE' }),
      expect.objectContaining({ terminalId: 'N', code: 'AMBIGUOUS_TERMINAL_ROLE' }),
    ]);
  });

  it('rejects a changeover contact that labels both COM paths as normally open', () => {
    const contact = (id: string, role: 'common' | 'dry-contact'): DeviceProfile['terminals'][number] => ({
      id,
      label: id,
      domain: 'floating',
      potential: 'floating',
      role,
      polarity: 'nonpolar',
      commonType: 'dry-contact',
      comGroup: 'pole-1',
    });
    const profile: DeviceProfile = {
      profileId: 'test:broken-changeover',
      version: '1.0.0',
      manufacturer: 'Test',
      model: 'Broken changeover',
      evidence: { level: 'educational', documents: [] },
      boundary: false,
      includeInBom: true,
      terminals: [contact('COM', 'common'), contact('NC', 'dry-contact'), contact('NO', 'dry-contact')],
      internalLinks: [
        { from: 'COM', to: 'NC', kind: 'dynamic-contact', stateKey: 'pole-1', normally: 'open' },
        { from: 'COM', to: 'NO', kind: 'dynamic-contact', stateKey: 'pole-1', normally: 'open' },
      ],
    };

    expect(auditProfileTerminalSemantics(profile)).toContainEqual(expect.objectContaining({
      terminalId: 'pole-1',
      code: 'CHANGEOVER_CONTACT_MISMATCH',
    }));
  });
});
