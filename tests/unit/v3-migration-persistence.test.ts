import { describe, expect, it } from 'vitest';
import {
  WORKSHOP_V3_QUARANTINE_STORAGE_KEY,
  WORKSHOP_V3_STORAGE_KEY,
  loadWorkshopDocumentV3,
  migrateWorkshopDocumentV3,
  parseWorkshopDocumentV3,
  saveWorkshopDocumentV3,
  restoreWorkshopDocumentV2FromV3,
} from '../../src/domain/v3';
import { sha256 } from '../../src/domain/migration';
import type { WorkshopDocumentV2 } from '../../src/domain/types';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function v2Document(): WorkshopDocumentV2 & Record<string, unknown> {
  return {
    schemaVersion: 2,
    mode: 'prewire',
    revision: 8,
    name: 'migration fixture',
    source: { kind: 'native-v2', hash: 'a'.repeat(64) },
    devices: [{
      id: 'psu', profileId: 'mean-well:mdr-100-24', profileVersion: '2026.07', evidenceLevel: 'manual-verified', missingProfile: false,
      x: 10, y: 20, rotation: 0, configuration: { trim: 24 },
    }],
    wires: [{ id: 'w1', from: { deviceId: 'psu', terminalId: '+V' }, to: { deviceId: 'lamp', terminalId: '+' }, color: 'red' }],
    jumpers: [],
    layout: { cabinet: 'A' },
    settings: {},
    extensions: { legacy: { retained: { original: true } } },
    vendorOpaqueValue: { retain: 'me' },
  };
}

async function nativeV3Document() {
  const payload = {
    schemaVersion: 3,
    revision: 12,
    mode: 'prewire',
    profileVersions: { 'vendor:drive': '2026.07' },
    assetVersions: { 'asset:drive': 'geometry-v1' },
    sourceSystem: {
      id: 'ac-3ph-400v', label: 'AC 3 phase 400 V',
      supply: { status: 'complete', kind: 'ac-three-phase', nominalVoltage: 400, conductors: ['L1', 'L2', 'L3', 'N', 'PE'], positivePotential: null, returnPotential: null },
      earthing: { status: 'complete', policy: 'PE_SEPARATE_0V_FLOATING' },
    },
    sources: [
      { id: 'dc', positiveTerminal: '+24V', returnTerminal: '0V', voltage: 24 },
      { kind: 'ac-single-phase', id: 'mains-1ph', lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE', lineToNeutralVoltage: 230, protectionCoordination: { prospectiveShortCircuitCurrentA: 1500, protectiveDeviceCurve: 'C16' } },
      { kind: 'ac-three-phase', id: 'mains-3ph', phaseTerminals: { L1: 'L1', L2: 'L2', L3: 'L3' }, neutralTerminal: 'N', peTerminal: 'PE', lineToLineVoltage: 400, lineToNeutralVoltage: 230, declaredPhaseSequence: 'L1-L2-L3', protectionCoordination: { prospectiveShortCircuitCurrentA: null, protectiveDeviceCurve: null } },
    ],
    elements: [
      { kind: 'load', id: 'lamp', positiveTerminal: '+', returnTerminal: '-', role: 'coil', parentDeviceId: 'device', polarity: 'positive-return', required: 'scenario', resistanceOhms: 120, onThresholdVoltage: 20, onThresholdCurrentA: 0.1 },
      { kind: 'ac-load', id: 'control', lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE', parentDeviceId: 'device', required: 'always' },
      { kind: 'three-phase-load', id: 'motor', phaseTerminals: { L1: 'U', L2: 'V', L3: 'W' }, neutralTerminal: 'N', peTerminal: 'PE', expectedPhaseSequence: 'L1-L3-L2', parentDeviceId: 'device', required: 'scenario' },
      { kind: 'contact', id: 'contact', terminalA: '13', terminalB: '14', stateKey: 'coil', normally: 'open' },
      { kind: 'device', id: 'device', terminals: ['A1', 'A2'] },
    ],
    branches: [
      { id: 'dc-branch', from: { elementId: 'dc', terminalId: '+24V' }, to: { elementId: 'lamp', terminalId: '+' }, conductor: 'dc' },
      { id: 'ac-branch', from: { elementId: 'mains-1ph', terminalId: 'L' }, to: { elementId: 'control', terminalId: 'L' }, conductor: 'ac' },
      { id: 'pe-branch', from: { elementId: 'mains-3ph', terminalId: 'PE' }, to: { elementId: 'motor', terminalId: 'PE' }, conductor: 'pe' },
    ],
    deviceInstances: [{ id: 'device', profileId: 'vendor:drive', profileVersion: '2026.07', assetVersion: 'asset:drive', exactOrderCode: 'DRIVE-1', designation: 'DRV1', configuration: { mode: 'vector' }, layoutMm: { x: 10, y: 20, rotation: 90, width: 45, height: 100, depth: 120 }, verification: 'unverified' }],
    cableAssemblies: [{ id: 'cable:1', designation: 'W1', conductorIds: ['conductor:1'], cableType: 'H07V-K', lengthMm: 1200, shielded: true, drainConductorId: 'conductor:1', routeMm: [{ x: 1, y: 2 }] }],
    conductors: [{ id: 'conductor:1', cableAssemblyId: 'cable:1', core: '1', color: 'brown', gauge: '1.5 mm2', wireNumber: '101', crossSectionMm2: 1.5, awg: null, lengthMm: 1200, pairId: 'pair:1', shielded: true, drain: true, ferruleFrom: 'F1', ferruleTo: 'F2', lugFrom: null, lugTo: null }],
    terminalAssemblies: [{ id: 'terminals:device', deviceId: 'device', terminalIds: ['A1', 'A2'], manufacturer: 'Vendor', orderCode: 'TB-1', designation: 'X1', terminalType: 'through', marker: '1', maximumConductorsPerTerminal: 2, bridges: ['bridge:1'], accessories: ['cover:1'] }],
    conductorBranches: [{ id: 'branch:1', conductorId: 'conductor:1', from: { elementId: 'device', terminalId: 'A1' }, to: { elementId: 'lamp', terminalId: '+' }, waypointsMm: [{ x: 3, y: 4 }] }],
    reviewScope: { elementIds: ['lamp', 'control', 'motor'], templateId: 'template:1', deviceIds: ['device'], status: 'complete' },
    scenarios: [{ id: 'energized', contactStates: { coil: true }, contactRules: [{ stateKey: 'coil', senseElementId: 'lamp', sense: { elementId: 'lamp', terminalId: '+' }, mode: 'closed-when-energized' }] }],
    settings: { nativeSetting: { retain: true } },
    layout: { zoom: 1.25 },
    extensions: { legacy: { sourceDocumentV2: { retained: true } }, nativeV3: { retain: 'this extension' } },
  };
  return { ...payload, hash: await sha256(payload) };
}

describe('WorkshopDocument v3 migration and persistence', () => {
  it('is deterministic, idempotent, and makes missing electrical review decisions incomplete', async () => {
    const source = v2Document();
    const first = await migrateWorkshopDocumentV3(source);
    const second = await migrateWorkshopDocumentV3(source);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('migration unexpectedly blocked');
    expect(first.document.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.document.sourceSystem.supply.status).toBe('incomplete');
    expect(first.document.sourceSystem.earthing.status).toBe('incomplete');
    expect(first.document.physicalLayout).toEqual({
      status: 'incomplete',
      sourceUnit: 'canvas-unit',
      canvasUnitsPerMm: null,
    });
    expect(first.document.deviceInstances[0].layoutMm).toMatchObject({ x: 0, y: 0 });
    expect(first.document.reviewScope.status).toBe('incomplete');

    const repeated = await migrateWorkshopDocumentV3(first.document);
    expect(repeated).toEqual({ ok: true, migrated: false, document: first.document, issues: [] });
  });

  it('converts legacy canvas coordinates to mm only with an explicit positive project scale', async () => {
    const source = v2Document();
    source.settings = {
      v3Workflow: {
        canvasUnitsPerMm: 2,
      },
    };
    source.wires[0].waypoints = [{ x: 30, y: 50 }];

    const first = await migrateWorkshopDocumentV3(source);
    const second = await migrateWorkshopDocumentV3(source);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('migration unexpectedly blocked');
    expect(first.document.physicalLayout).toEqual({
      status: 'complete',
      sourceUnit: 'canvas-unit',
      canvasUnitsPerMm: 2,
    });
    expect(first.document.deviceInstances[0].layoutMm).toMatchObject({ x: 5, y: 10 });
    expect(first.document.conductorBranches[0].waypointsMm).toEqual([{ x: 15, y: 25 }]);
  });

  it('does not promote v2 evidence or prior PASS/VERIFIED claims into v3 approval state', async () => {
    const source = v2Document();
    source.validation = { status: 'PASS' };
    source.classification = 'VERIFIED';
    const result = await migrateWorkshopDocumentV3(source);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('migration unexpectedly blocked');
    expect(result.document.deviceInstances[0]).toMatchObject({
      verification: 'unverified',
      exactOrderCode: null,
      assetVersion: null,
    });
    expect(result.document).not.toHaveProperty('validation');
    expect(result.document).not.toHaveProperty('classification');
  });

  it('migrates explicit PLC runtime bindings deterministically without carrying a live session', async () => {
    const source = v2Document();
    source.settings.plcRuntime = {
      schemaVersion: 1,
      adapter: 'xgsim',
      pollIntervalMs: 20,
      bindings: [{
        schemaVersion: 1,
        id: 'start-input',
        deviceInstanceId: 'plc1',
        terminalId: 'P03',
        cpuModel: 'XGB-XBCH',
        projectId: 'project-15',
        symbolName: 'START',
        address: 'B0S00.IN03',
        direction: 'input',
        dataType: 'BOOL',
        inverted: false,
        normalState: false,
        communicationLossState: false,
        access: { read: true, write: true },
        projectSha256: 'c'.repeat(64),
      }],
    };
    const first = await migrateWorkshopDocumentV3(source);
    const second = await migrateWorkshopDocumentV3(source);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('migration unexpectedly blocked');
    expect(first.document.plcRuntime).toEqual(source.settings.plcRuntime);
    expect(first.document).not.toHaveProperty('plcSession');
  });

  it('pins an explicitly saved asset id to its geometry hash without inferring either value', async () => {
    const source = v2Document();
    source.devices[0].configuration = {
      ...source.devices[0].configuration,
      assetId: 'codex:exact-device-v1',
      geometryHash: 'A'.repeat(64),
    };

    const result = await migrateWorkshopDocumentV3(source);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('migration unexpectedly blocked');
    expect(result.document.deviceInstances[0].assetVersion).toBe('codex:exact-device-v1');
    expect(result.document.assetVersions).toEqual({
      'codex:exact-device-v1': 'A'.repeat(64),
    });
  });

  it('preserves unknown v1/v2 content only under extensions.legacy', async () => {
    const source = v2Document();
    (source.devices[0] as unknown as Record<string, unknown>).vendorDeviceExtension = { retain: 'device' };
    const v2 = await migrateWorkshopDocumentV3(source);
    expect(v2.ok).toBe(true);
    if (!v2.ok) throw new Error('migration unexpectedly blocked');
    expect(v2.document.extensions.legacy).toMatchObject({
      v2ExtensionsLegacy: { retained: { original: true } },
      unknownTopLevel: { vendorOpaqueValue: { retain: 'me' } },
      unknownNested: { devices: { 0: { vendorDeviceExtension: { retain: 'device' } } } },
    });

    const v1 = await migrateWorkshopDocumentV3({
      d: { old: { type: 'OLD-PLC', x: 1, y: 2, deviceExtension: { keep: true } } }, w: [], vendorExtension: { keep: true },
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) throw new Error('migration unexpectedly blocked');
    expect(v1.document.deviceInstances[0].verification).toBe('legacy-unverified');
    expect(v1.document.extensions.legacy.unknownTopLevel).toEqual({ vendorExtension: { keep: true } });
    expect(v1.document.extensions.legacy).toMatchObject({ unknownNested: { devices: { old: { deviceExtension: { keep: true } } } } });
  });

  it('round-trips canonical persisted v3 data and quarantines corrupt JSON without overwriting it', async () => {
    const migrated = await migrateWorkshopDocumentV3(v2Document());
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) throw new Error('migration unexpectedly blocked');
    const storage = new MemoryStorage();
    await saveWorkshopDocumentV3(storage, migrated.document);
    const first = storage.getItem(WORKSHOP_V3_STORAGE_KEY);
    await saveWorkshopDocumentV3(storage, migrated.document);
    expect(storage.getItem(WORKSHOP_V3_STORAGE_KEY)).toBe(first);
    await expect(loadWorkshopDocumentV3(storage)).resolves.toEqual({ ok: true, document: migrated.document });
    expect(restoreWorkshopDocumentV2FromV3(migrated.document)).toEqual(v2Document());

    storage.setItem(WORKSHOP_V3_STORAGE_KEY, '{bad');
    await expect(loadWorkshopDocumentV3(storage)).resolves.toMatchObject({ ok: false, status: 'BLOCKED', code: 'CORRUPT_WORKSHOP_V3_JSON' });
    expect(storage.getItem(WORKSHOP_V3_STORAGE_KEY)).toBe('{bad');
    expect(storage.getItem(WORKSHOP_V3_QUARANTINE_STORAGE_KEY)).toContain('{bad');
  });

  it('round-trips native DC, single-phase, and three-phase v3 circuit snapshots without stripping extension data', async () => {
    const native = await nativeV3Document();
    const parsed = await parseWorkshopDocumentV3(native);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.issue.message);

    const storage = new MemoryStorage();
    await saveWorkshopDocumentV3(storage, parsed.document);
    await expect(loadWorkshopDocumentV3(storage)).resolves.toEqual({ ok: true, document: parsed.document });
    expect(parsed.document).toMatchObject({
      sources: native.sources,
      elements: native.elements,
      branches: native.branches,
      scenarios: native.scenarios,
      cableAssemblies: native.cableAssemblies,
      conductors: native.conductors,
      terminalAssemblies: native.terminalAssemblies,
      deviceInstances: native.deviceInstances,
      extensions: native.extensions,
    });

    await expect(migrateWorkshopDocumentV3(native)).resolves.toEqual({ ok: true, migrated: false, document: parsed.document, issues: [] });
  });

  it('blocks and quarantines a stale native v3 snapshot instead of reinterpreting it as legacy data', async () => {
    const native = await nativeV3Document();
    const stale = { ...native, revision: native.revision + 1 };
    await expect(migrateWorkshopDocumentV3(stale)).resolves.toMatchObject({
      ok: false,
      status: 'BLOCKED',
      issues: [{ code: 'HASH_MISMATCH' }],
    });

    const storage = new MemoryStorage();
    const raw = JSON.stringify(stale);
    storage.setItem(WORKSHOP_V3_STORAGE_KEY, raw);
    await expect(loadWorkshopDocumentV3(storage)).resolves.toMatchObject({ ok: false, status: 'BLOCKED', code: 'INVALID_WORKSHOP_V3' });
    expect(storage.getItem(WORKSHOP_V3_STORAGE_KEY)).toBe(raw);
    expect(JSON.parse(storage.getItem(WORKSHOP_V3_QUARANTINE_STORAGE_KEY) ?? '{}')).toMatchObject({ code: 'INVALID_WORKSHOP_V3', raw });
  });
});
