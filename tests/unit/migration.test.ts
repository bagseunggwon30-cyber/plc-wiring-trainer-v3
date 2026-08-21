import { describe, expect, it } from 'vitest';
import { canonicalStringify, migrateLegacyLocalStorage, migrateWorkshop } from '../../src/domain/migration';
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
  it('canonicalizes non-ASCII keys with locale-independent UTF-16 ordering', () => {
    const value = { '😀': 5, 가: 4, é: 3, a: 2, Z: 1 };
    expect(canonicalStringify(value)).toBe('{"Z":1,"a":2,"é":3,"가":4,"😀":5}');
  });

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

  it('accepts old cleared routes as null and canonicalizes them to an omitted waypoint list', async () => {
    const withClearedRoute = structuredClone(legacy) as typeof legacy & {
      w: Array<(typeof legacy.w)[number] & { waypoints?: null }>;
    };
    withClearedRoute.w[0].waypoints = null;

    const result = await migrateWorkshop(withClearedRoute);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.wires[0].waypoints).toBeUndefined();
  });

  it('migrates manual waypoint locks without changing the saved route', async () => {
    const withLockedRoute = structuredClone(legacy) as typeof legacy & {
      w: Array<(typeof legacy.w)[number] & {
        waypoints?: Array<{ x: number; y: number }>;
        routeLocked?: boolean;
        manualColor?: boolean;
      }>;
    };
    withLockedRoute.w[0].waypoints = [{ x: 100, y: 120 }];
    withLockedRoute.w[0].routeLocked = true;
    withLockedRoute.w[0].color = '#2563eb';
    withLockedRoute.w[0].manualColor = true;

    const result = await migrateWorkshop(withLockedRoute);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.wires[0]).toMatchObject({
      waypoints: [{ x: 100, y: 120 }],
      routeLocked: true,
      color: '#2563eb',
      manualColor: true,
    });
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
