import { canonicalStringify } from '../domain/migration';
import { WorkshopDocumentV2Schema } from '../domain/schema';
import type { WorkshopDocumentV2 } from '../domain/types';

export const WORKSHOP_V2_STORAGE_KEY = 'plc-wiring-trainer:workshop-document-v2';
export const QUARANTINE_STORAGE_KEY = `${WORKSHOP_V2_STORAGE_KEY}:quarantine`;

export interface PersistenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type PersistenceErrorCode = 'CORRUPT_WORKSHOP_JSON' | 'INVALID_WORKSHOP_V2';

export type WorkshopLoadResult =
  | { ok: true; document: WorkshopDocumentV2 }
  | { ok: false; status: 'BLOCKED'; code: PersistenceErrorCode; message: string };

export function saveWorkshopV2(storage: PersistenceStorage, document: WorkshopDocumentV2): void {
  const validated = WorkshopDocumentV2Schema.parse(document) as WorkshopDocumentV2;
  storage.setItem(WORKSHOP_V2_STORAGE_KEY, canonicalStringify(validated));
}

function quarantine(storage: PersistenceStorage, code: PersistenceErrorCode, raw: string): void {
  storage.setItem(QUARANTINE_STORAGE_KEY, canonicalStringify({ code, raw }));
}

export function loadWorkshopV2(storage: PersistenceStorage): WorkshopLoadResult | null {
  const raw = storage.getItem(WORKSHOP_V2_STORAGE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(storage, 'CORRUPT_WORKSHOP_JSON', raw);
    return {
      ok: false, status: 'BLOCKED', code: 'CORRUPT_WORKSHOP_JSON',
      message: 'Saved WorkshopDocument v2 JSON is corrupt and was copied to quarantine.',
    };
  }
  const validated = WorkshopDocumentV2Schema.safeParse(parsed);
  if (!validated.success) {
    quarantine(storage, 'INVALID_WORKSHOP_V2', raw);
    return {
      ok: false, status: 'BLOCKED', code: 'INVALID_WORKSHOP_V2',
      message: 'Saved WorkshopDocument v2 does not match the schema and was copied to quarantine.',
    };
  }
  return { ok: true, document: validated.data as WorkshopDocumentV2 };
}
