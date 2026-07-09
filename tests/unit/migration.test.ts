import { describe, expect, it } from 'vitest';
import { migrateLegacyLocalStorage, migrateWorkshop } from '../../src/domain/migration';
import { WorkshopDocumentV2Schema } from '../../src/domain/schema';

const legacy = {
  d: {
    d1: { type: 'XBC-DR32H', x: 10, y: 20, rot: 0 },
    d2: { type: 'UNLISTED', x: 30, y: 40 },
  },
  w: [{ id: 'w1', from: { dev: 'd1', term: 'P00' }, to: { dev: 'd2', term: '1' }, color: '#d33' }],
  n: 3,
  goal: 'g2',
  boardMode: 'panel-layout',
  jumpers: [{ id: 'j1', deviceId: 'd1', terms: ['P00', 'P01'] }],
  vendorExtension: { keep: true },
};

describe('legacy workshop migration', () => {
  it('is deterministic, idempotent, non-destructive, and never auto-promotes profiles', async () => {
    const original = structuredClone(legacy);
    const first = await migrateWorkshop(legacy, { knownLegacyTypes: new Set(['XBC-DR32H']) });
    const second = await migrateWorkshop(legacy, { knownLegacyTypes: new Set(['XBC-DR32H']) });
    expect(first).toEqual(second);
    expect(legacy).toEqual(original);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('migration unexpectedly blocked');
    expect(first.document.devices[0]).toMatchObject({
      profileId: 'legacy:XBC-DR32H',
      evidenceLevel: 'educational',
      missingProfile: false,
    });
    expect(first.document.devices[1].missingProfile).toBe(true);
    expect(first.document.jumpers).toEqual([{ id: 'j1', deviceId: 'd1', terminalIds: ['P00', 'P01'] }]);
    expect(first.document.extensions.legacy.vendorExtension).toEqual({ keep: true });
    expect(first.document.source.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(WorkshopDocumentV2Schema.parse(first.document)).toEqual(first.document);

    const repeated = await migrateWorkshop(first.document);
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.document).toEqual(first.document);
  });

  it('blocks malformed input instead of guessing', async () => {
    const result = await migrateWorkshop({ d: 'not-a-device-map', w: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('BLOCKED');
      expect(result.issues[0].code).toBe('INVALID_LEGACY_DOCUMENT');
    }
  });

  it('copies v1 localStorage to v2 without deleting or rewriting the source', async () => {
    const values = new Map<string, string>([['wiring-workshop-v2', JSON.stringify(legacy)]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const result = await migrateLegacyLocalStorage(storage, 'wiring-workshop-v2', 'wiring-workshop-v3', {
      knownLegacyTypes: new Set(['XBC-DR32H']),
    });
    expect(result?.ok).toBe(true);
    expect(values.get('wiring-workshop-v2')).toBe(JSON.stringify(legacy));
    expect(JSON.parse(values.get('wiring-workshop-v3') ?? '{}').schemaVersion).toBe(2);
    expect(await migrateLegacyLocalStorage(storage, 'wiring-workshop-v2', 'wiring-workshop-v3')).toBeNull();
  });
});
