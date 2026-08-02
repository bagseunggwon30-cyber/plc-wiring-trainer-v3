import { z } from 'zod';
import { WorkshopDocumentV2Schema } from './schema';
import type { MigrationResult, WorkshopDocumentV2 } from './types';

const LegacyEndpointSchema = z.object({ dev: z.string().min(1), term: z.string().min(1) });
const LegacyDeviceSchema = z.object({ type: z.string().min(1), x: z.number().optional(), y: z.number().optional(), rot: z.number().optional() }).passthrough();
const LegacyWireSchema = z
  .object({
    id: z.string().min(1),
    from: LegacyEndpointSchema,
    to: LegacyEndpointSchema,
    color: z.string().optional(),
    tag: z.string().optional(),
    gauge: z.string().optional(),
    waypoints: z.array(z.object({ x: z.number(), y: z.number() }))
      .nullish()
      .transform((value) => value ?? undefined),
  })
  .passthrough();
const LegacyJumperSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  terms: z.array(z.string().min(1)).min(2),
});
const LegacyWorkshopSchema = z
  .object({
    d: z.record(z.string(), LegacyDeviceSchema),
    w: z.array(LegacyWireSchema),
    n: z.number().optional(),
    goal: z.string().nullable().optional(),
    boardMode: z.string().optional(),
    cabinet: z.unknown().optional(),
    rails: z.unknown().optional(),
    ducts: z.unknown().optional(),
    doorPanel: z.unknown().optional(),
    panelConfig: z.unknown().optional(),
    jumpers: z.array(LegacyJumperSchema).optional(),
    terminalCalibration: z.unknown().optional(),
  })
  .passthrough();

export interface MigrationOptions {
  knownLegacyTypes?: ReadonlySet<string>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function migrateWorkshop(input: unknown, options: MigrationOptions = {}): Promise<MigrationResult> {
  const current = WorkshopDocumentV2Schema.safeParse(input);
  if (current.success) {
    return { ok: true, migrated: false, document: current.data as WorkshopDocumentV2, issues: [] };
  }

  const parsed = LegacyWorkshopSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      status: 'BLOCKED',
      issues: [{ code: 'INVALID_LEGACY_DOCUMENT', message: 'Legacy workshop structure is invalid.' }],
    };
  }

  const source = parsed.data;
  const knownKeys = new Set([
    'd', 'w', 'n', 'goal', 'boardMode', 'cabinet', 'rails', 'ducts', 'doorPanel', 'panelConfig', 'jumpers', 'terminalCalibration',
  ]);
  const unknownEntries = Object.fromEntries(Object.entries(source).filter(([key]) => !knownKeys.has(key)));
  const knownTypes = options.knownLegacyTypes ?? new Set<string>();

  const document: WorkshopDocumentV2 = {
    schemaVersion: 2,
    mode: 'practice',
    revision: 0,
    name: 'Migrated workshop',
    source: { kind: 'legacy-v1', hash: await sha256(input) },
    devices: Object.entries(source.d).map(([id, device]) => ({
      id,
      profileId: `legacy:${device.type}`,
      profileVersion: 'legacy-v1',
      evidenceLevel: 'educational',
      legacyType: device.type,
      missingProfile: !knownTypes.has(device.type),
      x: device.x ?? 0,
      y: device.y ?? 0,
      rotation: device.rot ?? 0,
      configuration: Object.fromEntries(
        Object.entries(device).filter(([key]) => !['type', 'x', 'y', 'rot'].includes(key)),
      ),
    })),
    wires: source.w.map((wire) => ({
      id: wire.id,
      from: { deviceId: wire.from.dev, terminalId: wire.from.term },
      to: { deviceId: wire.to.dev, terminalId: wire.to.term },
      color: wire.color,
      tag: wire.tag,
      gauge: wire.gauge,
      waypoints: wire.waypoints ?? undefined,
    })),
    jumpers: (source.jumpers ?? []).map((jumper) => ({
      id: jumper.id,
      deviceId: jumper.deviceId,
      terminalIds: jumper.terms,
    })),
    layout: {
      boardMode: source.boardMode ?? 'panel-layout',
      cabinet: source.cabinet ?? null,
      rails: source.rails ?? {},
      ducts: source.ducts ?? {},
      doorPanel: source.doorPanel ?? null,
      panelConfig: source.panelConfig ?? null,
    },
    settings: { goal: source.goal ?? null },
    extensions: {
      legacy: {
        ...unknownEntries,
        nextId: source.n ?? null,
        terminalCalibration: source.terminalCalibration ?? {},
      },
    },
  };

  const validated = WorkshopDocumentV2Schema.safeParse(document);
  if (!validated.success) {
    return {
      ok: false,
      status: 'BLOCKED',
      issues: [{ code: 'MIGRATION_OUTPUT_INVALID', message: validated.error.message }],
    };
  }
  return { ok: true, migrated: true, document: validated.data as WorkshopDocumentV2, issues: [] };
}

export async function migrateLegacyLocalStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  legacyKey: string,
  v2Key: string,
  options: MigrationOptions = {},
): Promise<MigrationResult | null> {
  if (storage.getItem(v2Key)) return null;
  const raw = storage.getItem(legacyKey);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 'BLOCKED', issues: [{ code: 'INVALID_LEGACY_JSON', message: 'Legacy JSON cannot be parsed.' }] };
  }
  const result = await migrateWorkshop(parsed, options);
  if (result.ok) storage.setItem(v2Key, JSON.stringify(result.document));
  return result;
}
