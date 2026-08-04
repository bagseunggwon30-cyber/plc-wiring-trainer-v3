import { sha256 } from '../domain/migration';
import type { DeviceProfile, EvidenceLevel, WorkshopDocumentV2, WorkshopMode } from '../domain/types';

export const LEGACY_PROFILE_MAP: Readonly<Record<string, string>> = Object.freeze({
  'XBC-DR32H': 'ls-electric:xbc-dr32h',
  'EXP2-700': 'ls-electric:exp2-0700d',
  'XBF-AH04A': 'ls-electric:xbf-ah04a',
  'MDR-100': 'mean-well:mdr-100-24',
  'MC-22B-DC24': 'ls-electric:mc-22b-dc24-1a1b',
  MY2N: 'omron:my2n-d2-dc24',
  'EOCR3DE-05DUH': 'schneider:eocr3de-05duh',
  'UT-2.5': 'phoenix-contact:ut-2.5-3044076',
  'UT-2.5-PE': 'phoenix-contact:ut-2.5-pe-3044092',
  'UT-4-HESI': 'phoenix-contact:ut-4-hesi-3046032',
  IG5A: 'ls-electric:sv-ig5a',
  'MY-MD02': 'generic:xy-md02',
  'PROX-NPN': 'generic:prox-npn-3wire',
  'PROX-PNP': 'generic:prox-pnp-3wire',
  PSU24: 'educational:dc24-source-box',
  'MOTOR-3P': 'educational:three-phase-motor',
  'LAMP-G': 'educational:dc24-load',
  'LAMP-Y': 'educational:dc24-load',
  'LAMP-W': 'educational:dc24-load',
  LAMP: 'educational:dc24-load',
  BUZZER: 'educational:dc24-load',
  'SOL-Y': 'educational:dc24-solenoid',
  TB4: 'educational:terminal-block-4',
  TB10: 'educational:terminal-block-10',
  'BOUNDARY-AC': 'boundary:ac-supply',
  'BOUNDARY-DC': 'boundary:dc-supply',
  'BOUNDARY-CONTACT': 'boundary:dry-contact',
  'BOUNDARY-LOAD': 'boundary:load',
  'BOUNDARY-ANALOG-V': 'boundary:analog-voltage-source',
  'BOUNDARY-ANALOG-I': 'boundary:analog-current-source',
  'BOUNDARY-ANALOG-V-IN': 'boundary:analog-voltage-input',
  'BOUNDARY-ANALOG-I-IN': 'boundary:analog-current-input',
  'BOUNDARY-2W-I': 'boundary:two-wire-current-transmitter',
  'BOUNDARY-RS485': 'boundary:communication-peer',
});

interface LegacyEndpoint { dev: string; term: string }
interface LegacyWire {
  id: string;
  from: LegacyEndpoint;
  to: LegacyEndpoint;
  color?: string;
  tag?: string;
  gauge?: string;
  waypoints?: Array<{ x: number; y: number }> | null;
}
interface LegacyDevice extends Record<string, unknown> {
  type: string;
  x?: number;
  y?: number;
  rot?: number;
}
interface LegacyJumper { id: string; deviceId: string; terms: string[] }

const LEGACY_IDENTITY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'EXP2-700': 'ls-electric:exp2-0700d',
  'MY-MD02': 'generic:xy-md02',
});

const LEGACY_TERMINAL_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'EXP2-700': Object.freeze({
    'V+': 'DC24V',
    'V-': 'DC0V',
    'T+': 'COM1-6',
    '485+': 'COM1-6',
    'RS485+': 'COM1-6',
    'T-': 'COM1-1',
    '485-': 'COM1-1',
    'RS485-': 'COM1-1',
    RXD: 'COM2-2',
    TXD: 'COM2-3',
    SG: 'COM2-5',
    'COM3-RDB': 'COM3-RX-',
    'COM3-RDA': 'COM3-RX+',
    'COM3-SDB': 'COM3-TX-',
    'COM3-SDA': 'COM3-TX+',
    'COM3-SG': 'COM3-SG',
  }),
});

export interface LegacyTrainerState extends Record<string, unknown> {
  devices: Record<string, LegacyDevice>;
  wires: LegacyWire[];
  jumpers?: LegacyJumper[];
  nextId?: number;
  revision?: number;
  goal?: string | null;
  boardMode?: string;
  cabinet?: unknown;
  rails?: unknown;
  ducts?: unknown;
  doorPanel?: unknown;
  panelConfig?: unknown;
  terminalCalibration?: unknown;
  workflowState?: unknown;
}

export interface WorkshopShadowSnapshot {
  document: WorkshopDocumentV2;
  renderedDeviceIds: string[];
}

const DEVICE_POSITION_KEYS = new Set([
  'type', 'x', 'y', 'rot', '__v2ProfileId', '__v2ProfileVersion', '__v2EvidenceLevel', '__v2MissingProfile',
]);
const TOP_LEVEL_KEYS = new Set([
  'devices', 'wires', 'jumpers', 'nextId', 'revision', 'goal', 'boardMode', 'cabinet', 'rails', 'ducts',
  'doorPanel', 'panelConfig', 'terminalCalibration', 'workflowState',
]);

export async function adaptLegacyState(
  state: LegacyTrainerState,
  mode: WorkshopMode,
  catalog: Readonly<Record<string, DeviceProfile>>,
): Promise<WorkshopDocumentV2> {
  const devices = Object.entries(state.devices).map(([id, legacy]) => {
    const preservedProfileId = typeof legacy.__v2ProfileId === 'string' ? legacy.__v2ProfileId : undefined;
    const inferredProfileId = preservedProfileId ?? LEGACY_IDENTITY_ALIASES[legacy.type];
    const profile = inferredProfileId ? catalog[inferredProfileId] : undefined;
    const preservedEvidence = ['educational', 'manual-verified', 'bench-verified'].includes(String(legacy.__v2EvidenceLevel))
      ? legacy.__v2EvidenceLevel as EvidenceLevel
      : undefined;
    return {
      id,
      profileId: inferredProfileId ?? `legacy:${legacy.type}`,
      profileVersion: typeof legacy.__v2ProfileVersion === 'string'
        ? legacy.__v2ProfileVersion
        : profile?.version ?? 'legacy-v1',
      // A legacy type label is enough to restore endpoints, but never enough
      // to inherit a verified-report grade or exact installed order code.
      evidenceLevel: preservedEvidence ?? (preservedProfileId ? profile?.evidence.level : 'educational') ?? 'educational' as const,
      legacyType: legacy.type,
      missingProfile: typeof legacy.__v2MissingProfile === 'boolean' ? legacy.__v2MissingProfile : profile === undefined,
      x: legacy.x ?? 0,
      y: legacy.y ?? 0,
      rotation: legacy.rot ?? 0,
      configuration: Object.fromEntries(Object.entries(legacy).filter(([key]) => !DEVICE_POSITION_KEYS.has(key))),
    };
  });
  const opaqueLegacy = Object.fromEntries(Object.entries(state).filter(([key]) => !TOP_LEVEL_KEYS.has(key)));

  return {
    schemaVersion: 2,
    mode,
    revision: state.revision ?? 0,
    name: mode === 'prewire' ? '사전 결선 검토 작업장' : '결선 연습 작업장',
    source: { kind: 'legacy-v1', hash: await sha256(state) },
    devices,
    wires: state.wires.map((wire) => {
      const normalizeEndpoint = (endpoint: LegacyEndpoint) => {
        const legacyType = state.devices[endpoint.dev]?.type;
        const terminalId = legacyType
          ? LEGACY_TERMINAL_ALIASES[legacyType]?.[endpoint.term] ?? endpoint.term
          : endpoint.term;
        return { deviceId: endpoint.dev, terminalId };
      };
      return {
        id: wire.id,
        from: normalizeEndpoint(wire.from),
        to: normalizeEndpoint(wire.to),
        color: wire.color,
        tag: wire.tag,
        gauge: wire.gauge,
        waypoints: Array.isArray(wire.waypoints) ? wire.waypoints : undefined,
      };
    }),
    jumpers: (state.jumpers ?? []).map((jumper) => ({
      id: jumper.id,
      deviceId: jumper.deviceId,
      terminalIds: jumper.terms.map((terminalId) => {
        const legacyType = state.devices[jumper.deviceId]?.type;
        return legacyType ? LEGACY_TERMINAL_ALIASES[legacyType]?.[terminalId] ?? terminalId : terminalId;
      }),
    })),
    layout: {
      boardMode: state.boardMode ?? 'panel-layout',
      cabinet: state.cabinet ?? null,
      rails: state.rails ?? {},
      ducts: state.ducts ?? {},
      doorPanel: state.doorPanel ?? null,
      panelConfig: state.panelConfig ?? null,
    },
    settings: { goal: state.goal ?? null },
    extensions: {
      legacy: {
        ...opaqueLegacy,
        nextId: state.nextId ?? null,
        terminalCalibration: state.terminalCalibration ?? {},
      },
    },
  };
}

/**
 * Reconciles visible SVG editor deltas with an authoritative v2 document.
 * Devices that could not be rendered by the legacy canvas remain byte-for-byte
 * represented, while devices that were rendered can be edited or deleted.
 */
export function mergeWorkshopShadow(
  shadow: WorkshopDocumentV2,
  edited: WorkshopDocumentV2,
  renderedDeviceIds: readonly string[],
): WorkshopDocumentV2 {
  const editedById = new Map(edited.devices.map((device) => [device.id, device]));
  const shadowIds = new Set(shadow.devices.map((device) => device.id));
  const rendered = new Set(renderedDeviceIds);
  const devices = shadow.devices.flatMap((device) => {
    const replacement = editedById.get(device.id);
    if (replacement) return [replacement];
    return rendered.has(device.id) ? [] : [device];
  });
  for (const device of edited.devices) if (!shadowIds.has(device.id)) devices.push(device);

  return {
    ...structuredClone(shadow),
    ...edited,
    name: shadow.name,
    source: structuredClone(shadow.source),
    devices,
    layout: { ...structuredClone(shadow.layout), ...edited.layout },
    settings: { ...structuredClone(shadow.settings), ...edited.settings },
    extensions: {
      ...structuredClone(shadow.extensions),
      ...edited.extensions,
      legacy: {
        ...structuredClone(shadow.extensions.legacy),
        ...edited.extensions.legacy,
      },
    },
  };
}
