import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import {
  QUARANTINE_STORAGE_KEY,
  WORKSHOP_V2_STORAGE_KEY,
  loadWorkshopV2,
  saveWorkshopV2,
} from '../../src/renderer/workshop-persistence';
import type { WorkshopDocumentV2 } from '../../src/domain/types';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function document(): WorkshopDocumentV2 {
  const profile = DEVICE_PROFILES['mean-well:mdr-100-24'];
  return {
    schemaVersion: 2, mode: 'prewire', revision: 8, name: 'roundtrip',
    source: { kind: 'native-v2', hash: 'a'.repeat(64) },
    devices: [{
      id: 'psu', profileId: profile.profileId, profileVersion: profile.version,
      evidenceLevel: profile.evidence.level, missingProfile: false,
      x: 4, y: 8, rotation: 0, configuration: { trim: 24 },
    }],
    wires: [], jumpers: [], layout: {}, settings: {}, extensions: { legacy: {} },
  };
}

describe('WorkshopDocument v2 persistence', () => {
  it('round-trips a valid document deterministically', () => {
    const storage = new MemoryStorage();
    const original = document();
    saveWorkshopV2(storage, original);
    const firstSerialized = storage.getItem(WORKSHOP_V2_STORAGE_KEY);
    saveWorkshopV2(storage, original);
    expect(storage.getItem(WORKSHOP_V2_STORAGE_KEY)).toBe(firstSerialized);
    expect(loadWorkshopV2(storage)).toEqual({ ok: true, document: original });
  });

  it('quarantines corrupt JSON without deleting or rewriting the original', () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKSHOP_V2_STORAGE_KEY, '{broken');
    const result = loadWorkshopV2(storage);
    expect(result).toMatchObject({ ok: false, status: 'BLOCKED', code: 'CORRUPT_WORKSHOP_JSON' });
    expect(storage.getItem(WORKSHOP_V2_STORAGE_KEY)).toBe('{broken');
    expect(storage.getItem(QUARANTINE_STORAGE_KEY)).toContain('{broken');
  });

  it('quarantines schema-invalid JSON and leaves an empty store alone', () => {
    const storage = new MemoryStorage();
    expect(loadWorkshopV2(storage)).toBeNull();
    storage.setItem(WORKSHOP_V2_STORAGE_KEY, JSON.stringify({ schemaVersion: 2 }));
    expect(loadWorkshopV2(storage)).toMatchObject({ ok: false, status: 'BLOCKED', code: 'INVALID_WORKSHOP_V2' });
    expect(storage.getItem(QUARANTINE_STORAGE_KEY)).toContain('schemaVersion');
  });
});
