import { migrateWorkshop, canonicalStringify, sha256 } from '../migration';
import { WorkshopDocumentV2Schema } from '../schema';
import type { WorkshopDocumentV2 } from '../types';
import { WorkshopDocumentV3Schema, type PersistedWorkshopDocumentV3 } from './schema';
import { PlcRuntimeConfigurationV1Schema } from '../plc-runtime/io-binding';

export const WORKSHOP_V3_STORAGE_KEY = 'plc-wiring-trainer:workshop-document-v3';
export const WORKSHOP_V3_QUARANTINE_STORAGE_KEY = `${WORKSHOP_V3_STORAGE_KEY}:quarantine`;

export interface V3PersistenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type WorkshopDocumentV3MigrationResult =
  | { ok: true; migrated: boolean; document: PersistedWorkshopDocumentV3; issues: readonly V3MigrationIssue[] }
  | { ok: false; status: 'BLOCKED'; issues: readonly V3MigrationIssue[] };

export interface V3MigrationIssue {
  code: 'INVALID_WORKSHOP_DOCUMENT' | 'MIGRATION_OUTPUT_INVALID' | 'HASH_MISMATCH';
  message: string;
}

export type WorkshopDocumentV3LoadResult =
  | { ok: true; document: PersistedWorkshopDocumentV3 }
  | { ok: false; status: 'BLOCKED'; code: 'CORRUPT_WORKSHOP_V3_JSON' | 'INVALID_WORKSHOP_V3'; message: string };

export type WorkshopDocumentV3ParseResult =
  | { ok: true; document: PersistedWorkshopDocumentV3 }
  | { ok: false; status: 'BLOCKED'; issue: V3MigrationIssue };

const v2Keys = new Set([
  'schemaVersion', 'mode', 'revision', 'name', 'source', 'devices', 'wires', 'jumpers', 'layout', 'settings', 'extensions',
]);
const v1Keys = new Set([
  'd', 'w', 'n', 'goal', 'boardMode', 'cabinet', 'rails', 'ducts', 'doorPanel', 'panelConfig', 'jumpers', 'terminalCalibration',
]);
const v2DeviceKeys = new Set(['id', 'profileId', 'profileVersion', 'evidenceLevel', 'legacyType', 'missingProfile', 'x', 'y', 'rotation', 'configuration']);
const v2WireKeys = new Set(['id', 'from', 'to', 'color', 'tag', 'gauge', 'waypoints']);
const v2JumperKeys = new Set(['id', 'deviceId', 'terminalIds']);
const v1DeviceKeys = new Set(['type', 'x', 'y', 'rot']);
const v1WireKeys = new Set(['id', 'from', 'to', 'color', 'tag', 'gauge', 'waypoints']);
const v1JumperKeys = new Set(['id', 'deviceId', 'terms']);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))].sort(compareText) : [];
}

function unknownFields(value: unknown, knownKeys: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record(value)).filter(([key]) => !knownKeys.has(key)).sort(([left], [right]) => compareText(left, right)));
}

function unknownByEntry(value: unknown, knownKeys: ReadonlySet<string>): Record<string, Record<string, unknown>> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.flatMap((entry, index) => {
    const unknown = unknownFields(entry, knownKeys);
    return Object.keys(unknown).length ? [[String(index), unknown] as const] : [];
  }));
}

function unknownById(value: unknown, knownKeys: ReadonlySet<string>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([id, entry]) => {
    const unknown = unknownFields(entry, knownKeys);
    return Object.keys(unknown).length ? [[id, unknown] as const] : [];
  }).sort(([left], [right]) => compareText(left, right)));
}

function sourceSystem(settings: Record<string, unknown>): PersistedWorkshopDocumentV3['sourceSystem'] {
  const workflow = record(settings.v3Workflow);
  const selected = record(workflow.sourceSystem);
  const id = typeof selected.id === 'string' && selected.id.length > 0 ? selected.id : null;
  const label = typeof selected.label === 'string' && selected.label.length > 0 ? selected.label : null;
  const policy = workflow.earthingPolicy;
  const earthingPolicy = policy === 'PE_SEPARATE_0V_FLOATING' || policy === 'PE_0V_SINGLE_POINT_BOND' || policy === 'SITE_DEFINED_BONDING'
    ? policy
    : null;
  const definitions = {
    'ac-1ph-220v': { kind: 'ac-single-phase' as const, nominalVoltage: 220, conductors: ['L', 'N', 'PE'], positivePotential: null, returnPotential: null },
    'ac-1ph-230v': { kind: 'ac-single-phase' as const, nominalVoltage: 230, conductors: ['L', 'N', 'PE'], positivePotential: null, returnPotential: null },
    'ac-3ph-220v': { kind: 'ac-three-phase' as const, nominalVoltage: 220, conductors: ['L1', 'L2', 'L3', 'PE'], positivePotential: null, returnPotential: null },
    'ac-3ph-380-220v': { kind: 'ac-three-phase' as const, nominalVoltage: 380, conductors: ['L1', 'L2', 'L3', 'N', 'PE'], positivePotential: null, returnPotential: null },
    'ac-3ph-400v': { kind: 'ac-three-phase' as const, nominalVoltage: 400, conductors: ['L1', 'L2', 'L3', 'N', 'PE'], positivePotential: null, returnPotential: null },
    'dc-24v-isolated': { kind: 'dc' as const, nominalVoltage: 24, conductors: ['+24V', '0V'], positivePotential: '+24V' as const, returnPotential: '0V' as const },
  };
  const definition = id === null ? undefined : definitions[id as keyof typeof definitions];
  return {
    id,
    label,
    supply: {
      status: definition === undefined ? 'incomplete' as const : 'complete' as const,
      kind: definition?.kind ?? null,
      nominalVoltage: definition?.nominalVoltage ?? null,
      conductors: definition?.conductors ?? [],
      positivePotential: definition?.positivePotential ?? null,
      returnPotential: definition?.returnPotential ?? null,
    },
    earthing: { status: earthingPolicy === null ? 'incomplete' as const : 'complete' as const, policy: earthingPolicy },
  };
}

function physicalLayout(settings: Record<string, unknown>): NonNullable<PersistedWorkshopDocumentV3['physicalLayout']> {
  const workflow = record(settings.v3Workflow);
  const canvasUnitsPerMm = typeof workflow.canvasUnitsPerMm === 'number'
    && Number.isFinite(workflow.canvasUnitsPerMm)
    && workflow.canvasUnitsPerMm > 0
    ? workflow.canvasUnitsPerMm
    : null;
  return {
    status: canvasUnitsPerMm === null ? 'incomplete' : 'complete',
    sourceUnit: 'canvas-unit',
    canvasUnitsPerMm,
  };
}

function canvasCoordinateToMm(value: number, layout: NonNullable<PersistedWorkshopDocumentV3['physicalLayout']>): number {
  return layout.status === 'complete' && layout.canvasUnitsPerMm !== null
    ? value / layout.canvasUnitsPerMm
    : 0;
}

function canvasPointsToMm(
  points: readonly { x: number; y: number }[],
  layout: NonNullable<PersistedWorkshopDocumentV3['physicalLayout']>,
): { x: number; y: number }[] {
  return layout.status === 'complete'
    ? points.map((point) => ({
      x: canvasCoordinateToMm(point.x, layout),
      y: canvasCoordinateToMm(point.y, layout),
    }))
    : [];
}

function designationFor(settings: Record<string, unknown>, deviceId: string): string | null {
  const value = record(record(settings.v3Workflow).designations)[deviceId];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function textConfiguration(configuration: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = configuration[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function workflowSetting(settings: Record<string, unknown>, group: 'deviceSettings' | 'conductorSettings', id: string): Record<string, unknown> {
  return record(record(record(settings.v3Workflow)[group])[id]);
}

function crossSectionMm2(gauge: string | undefined): number | null {
  if (!gauge) return null;
  const match = gauge.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:mm2|mm²|㎟)/i);
  return match ? Number(match[1]) : null;
}

function reviewScope(settings: Record<string, unknown>, devices: readonly WorkshopDocumentV2['devices'][number][]) {
  const raw = record(record(settings.v3Workflow).reviewScope);
  const templateId = typeof raw.templateId === 'string' && raw.templateId.length > 0 ? raw.templateId : null;
  const deviceIds = strings(raw.deviceIds).filter((id) => devices.some((device) => device.id === id));
  const status = templateId !== null && deviceIds.length > 0 ? 'complete' as const : 'incomplete' as const;
  return { elementIds: deviceIds, templateId, deviceIds, status };
}

function terminalIdsFor(deviceId: string, document: WorkshopDocumentV2): string[] {
  return document.wires.flatMap((wire) => [
    wire.from.deviceId === deviceId ? wire.from.terminalId : null,
    wire.to.deviceId === deviceId ? wire.to.terminalId : null,
  ]).filter((terminal): terminal is string => terminal !== null).filter((terminal, index, all) => all.indexOf(terminal) === index).sort(compareText);
}

function legacyExtensions(input: unknown, sourceVersion: 1 | 2, document: WorkshopDocumentV2): Record<string, unknown> {
  const originalLegacy = record(record(input).extensions).legacy;
  const raw = record(input);
  const unknownNested = sourceVersion === 2
    ? {
      devices: unknownByEntry(raw.devices, v2DeviceKeys),
      wires: unknownByEntry(raw.wires, v2WireKeys),
      jumpers: unknownByEntry(raw.jumpers, v2JumperKeys),
      source: unknownFields(raw.source, new Set(['kind', 'hash'])),
      extensions: unknownFields(raw.extensions, new Set(['legacy'])),
    }
    : {
      devices: unknownById(raw.d, v1DeviceKeys),
      wires: unknownByEntry(raw.w, v1WireKeys),
      jumpers: unknownByEntry(raw.jumpers, v1JumperKeys),
    };
  return {
    sourceDocumentV2: document,
    v2ExtensionsLegacy: sourceVersion === 2 ? originalLegacy : document.extensions.legacy,
    unknownTopLevel: unknownFields(input, sourceVersion === 2 ? v2Keys : v1Keys),
    unknownNested,
  };
}

/** Restores the exact editor snapshot archived during V3 migration without inferring any approval. */
export function restoreWorkshopDocumentV2FromV3(document: PersistedWorkshopDocumentV3): WorkshopDocumentV2 | null {
  const snapshot = record(document.extensions.legacy).sourceDocumentV2;
  const parsed = WorkshopDocumentV2Schema.safeParse(snapshot);
  return parsed.success ? parsed.data as WorkshopDocumentV2 : null;
}

async function documentHash(document: Omit<PersistedWorkshopDocumentV3, 'hash'>): Promise<string> {
  return sha256(document);
}

function withoutHash(document: PersistedWorkshopDocumentV3): Omit<PersistedWorkshopDocumentV3, 'hash'> {
  const { hash: _hash, ...value } = document;
  return value;
}

/** Parses only canonical, content-addressed V3 documents; a schema-valid stale hash is still rejected. */
export async function parseWorkshopDocumentV3(input: unknown): Promise<WorkshopDocumentV3ParseResult> {
  const current = WorkshopDocumentV3Schema.safeParse(input);
  if (!current.success) {
    return { ok: false, status: 'BLOCKED', issue: { code: 'INVALID_WORKSHOP_DOCUMENT', message: current.error.message } };
  }
  const expectedHash = await documentHash(withoutHash(current.data));
  if (current.data.hash !== expectedHash) {
    return { ok: false, status: 'BLOCKED', issue: { code: 'HASH_MISMATCH', message: 'WorkshopDocument v3 hash does not match its canonical content.' } };
  }
  return { ok: true, document: current.data };
}

/** Migrates a v1/v2 workshop without inferring electrical approvals from legacy labels or evidence. */
export async function migrateWorkshopDocumentV3(input: unknown): Promise<WorkshopDocumentV3MigrationResult> {
  const current = await parseWorkshopDocumentV3(input);
  if (current.ok) {
    return { ok: true, migrated: false, document: current.document, issues: [] };
  }
  // A malformed native v3 document is never safe to reinterpret as a legacy snapshot:
  // doing so could silently replace its circuit model with an empty migrated model.
  if (record(input).schemaVersion === 3) {
    return { ok: false, status: 'BLOCKED', issues: [current.issue] };
  }

  const v2 = WorkshopDocumentV2Schema.safeParse(input);
  const sourceVersion: 1 | 2 = v2.success ? 2 : 1;
  const v2Result = v2.success ? { ok: true as const, document: v2.data as WorkshopDocumentV2 } : await migrateWorkshop(input);
  if (!v2Result.ok) {
    return { ok: false, status: 'BLOCKED', issues: [{ code: 'INVALID_WORKSHOP_DOCUMENT', message: v2Result.issues.map((issue) => issue.message).join(' ') }] };
  }
  const source = v2Result.document;
  const scope = reviewScope(source.settings, source.devices);
  const layoutConversion = physicalLayout(source.settings);
  const devices = [...source.devices].sort((left, right) => compareText(left.id, right.id));
  const deviceInstances = devices.map((device) => ({
    id: device.id,
    profileId: device.profileId,
    profileVersion: device.profileVersion,
    assetVersion: textConfiguration(device.configuration, 'assetId'),
    exactOrderCode: textConfiguration(device.configuration, 'orderCode')
      ?? textConfiguration(workflowSetting(source.settings, 'deviceSettings', device.id), 'orderCode'),
    designation: designationFor(source.settings, device.id),
    configuration: device.configuration,
    layoutMm: {
      x: canvasCoordinateToMm(device.x, layoutConversion),
      y: canvasCoordinateToMm(device.y, layoutConversion),
      rotation: device.rotation,
    },
    verification: sourceVersion === 1 ? 'legacy-unverified' as const : 'unverified' as const,
  }));
  const conductors = [...source.wires].sort((left, right) => compareText(left.id, right.id)).map((wire) => {
    const setting = workflowSetting(source.settings, 'conductorSettings', wire.id);
    const gauge = wire.gauge ?? textConfiguration(setting, 'gauge');
    return {
      id: `conductor:${wire.id}`,
      cableAssemblyId: `cable:${textConfiguration(setting, 'cableId') ?? wire.id}`,
      core: textConfiguration(setting, 'core') ?? '1',
      color: wire.color ?? textConfiguration(setting, 'color'),
      gauge,
      wireNumber: wire.tag ?? textConfiguration(setting, 'wireNumber'),
      crossSectionMm2: crossSectionMm2(gauge ?? undefined),
      awg: gauge?.match(/AWG\s*([0-9]+)/i)?.[1] ?? null,
      lengthMm: typeof setting.lengthMm === 'number' && setting.lengthMm > 0 ? setting.lengthMm : null,
      pairId: null,
      shielded: setting.shielded === true,
      drain: setting.drain === true,
      ferruleFrom: textConfiguration(setting, 'ferruleFrom'),
      ferruleTo: textConfiguration(setting, 'ferruleTo'),
      lugFrom: textConfiguration(setting, 'lugFrom'),
      lugTo: textConfiguration(setting, 'lugTo'),
    };
  });
  const cableAssemblies = [...new Set(conductors.map((conductor) => conductor.cableAssemblyId))].sort(compareText).map((cableAssemblyId) => {
    const members = conductors.filter((conductor) => conductor.cableAssemblyId === cableAssemblyId);
    return {
      id: cableAssemblyId,
      designation: cableAssemblyId.slice('cable:'.length),
      conductorIds: members.map((conductor) => conductor.id).sort(compareText),
      cableType: null,
      lengthMm: members.every((conductor) => conductor.lengthMm === members[0]?.lengthMm) ? members[0]?.lengthMm ?? null : null,
      shielded: members.some((conductor) => conductor.shielded),
      drainConductorId: members.find((conductor) => conductor.drain)?.id ?? null,
      routeMm: [],
    };
  });
  const legacy = legacyExtensions(input, sourceVersion, source);
  const rawRuntimeConfiguration = source.settings.plcRuntime ?? record(source.settings.v3Workflow).plcRuntime;
  const runtimeConfiguration = rawRuntimeConfiguration === undefined || rawRuntimeConfiguration === null
    ? undefined
    : PlcRuntimeConfigurationV1Schema.safeParse(rawRuntimeConfiguration);
  if (runtimeConfiguration !== undefined && !runtimeConfiguration.success) {
    return {
      ok: false,
      status: 'BLOCKED',
      issues: [{ code: 'MIGRATION_OUTPUT_INVALID', message: `Saved PLC runtime bindings are invalid: ${runtimeConfiguration.error.message}` }],
    };
  }
  const base = {
    schemaVersion: 3 as const,
    revision: source.revision,
    mode: source.mode,
    profileVersions: Object.fromEntries(deviceInstances.map((device) => [device.profileId, device.profileVersion]).sort(([left], [right]) => compareText(left, right))),
    assetVersions: Object.fromEntries(deviceInstances
      .flatMap((device) => {
        const geometryHash = textConfiguration(device.configuration, 'geometryHash');
        return device.assetVersion && geometryHash ? [[device.assetVersion, geometryHash] as const] : [];
      })
      .sort(([left], [right]) => compareText(left, right))),
    sourceSystem: sourceSystem(source.settings),
    physicalLayout: layoutConversion,
    sources: [],
    elements: devices.map((device) => ({ kind: 'device' as const, id: device.id, terminals: terminalIdsFor(device.id, source) })),
    branches: [],
    deviceInstances,
    cableAssemblies,
    conductors,
    terminalAssemblies: devices.map((device) => ({
      id: `terminals:${device.id}`, deviceId: device.id, terminalIds: terminalIdsFor(device.id, source), manufacturer: null,
      orderCode: null, designation: designationFor(source.settings, device.id), terminalType: 'device' as const, marker: null,
      maximumConductorsPerTerminal: null, bridges: [], accessories: [],
    })),
    conductorBranches: source.wires.map((wire) => ({
      id: `branch:${wire.id}`,
      conductorId: `conductor:${wire.id}`,
      from: { elementId: wire.from.deviceId, terminalId: wire.from.terminalId },
      to: { elementId: wire.to.deviceId, terminalId: wire.to.terminalId },
      waypointsMm: canvasPointsToMm(wire.waypoints ?? [], layoutConversion),
    })),
    reviewScope: scope,
    scenarios: [],
    settings: source.settings,
    layout: source.layout,
    extensions: { legacy },
    ...(runtimeConfiguration?.success ? { plcRuntime: runtimeConfiguration.data } : {}),
  };
  const document = { ...base, hash: await documentHash(base) };
  const validated = WorkshopDocumentV3Schema.safeParse(document);
  if (!validated.success) {
    return { ok: false, status: 'BLOCKED', issues: [{ code: 'MIGRATION_OUTPUT_INVALID', message: validated.error.message }] };
  }
  return { ok: true, migrated: true, document: validated.data, issues: [] };
}

export async function saveWorkshopDocumentV3(storage: V3PersistenceStorage, document: PersistedWorkshopDocumentV3): Promise<void> {
  const parsed = await parseWorkshopDocumentV3(document);
  if (!parsed.ok) throw new Error(parsed.issue.message);
  storage.setItem(WORKSHOP_V3_STORAGE_KEY, canonicalStringify(parsed.document));
}

function quarantine(storage: V3PersistenceStorage, code: 'CORRUPT_WORKSHOP_V3_JSON' | 'INVALID_WORKSHOP_V3', raw: string): void {
  storage.setItem(WORKSHOP_V3_QUARANTINE_STORAGE_KEY, canonicalStringify({ code, raw }));
}

export async function loadWorkshopDocumentV3(storage: V3PersistenceStorage): Promise<WorkshopDocumentV3LoadResult | null> {
  const raw = storage.getItem(WORKSHOP_V3_STORAGE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(storage, 'CORRUPT_WORKSHOP_V3_JSON', raw);
    return { ok: false, status: 'BLOCKED', code: 'CORRUPT_WORKSHOP_V3_JSON', message: 'Saved WorkshopDocument v3 JSON is corrupt and was copied to quarantine.' };
  }
  const validated = await parseWorkshopDocumentV3(parsed);
  if (!validated.ok) {
    quarantine(storage, 'INVALID_WORKSHOP_V3', raw);
    return { ok: false, status: 'BLOCKED', code: 'INVALID_WORKSHOP_V3', message: 'Saved WorkshopDocument v3 does not match the schema and was copied to quarantine.' };
  }
  return { ok: true, document: validated.document };
}
