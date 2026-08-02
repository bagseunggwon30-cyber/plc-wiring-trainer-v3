import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../src/catalog/v3-profiles';
import type { WorkshopDocumentV3 } from '../../src/domain/v3';
import {
  suggestWiringPlans,
  type WiringGuideCatalogV3,
  type WiringIntentV3,
} from '../../src/domain/v3/wiring-assistant';

const catalog: WiringGuideCatalogV3 = {
  profiles: DEVICE_PROFILES,
  verifiedProfiles: DEVICE_PROFILES_V3,
};

interface DeviceInput {
  id: string;
  profileId: string;
  orderCode?: string | null;
  configuration?: Readonly<Record<string, unknown>>;
}

function documentWith(
  mode: 'practice' | 'prewire',
  devices: readonly DeviceInput[],
  connections: readonly [string, string, string, string][] = [],
): WorkshopDocumentV3 {
  return {
    schemaVersion: 3,
    revision: 7,
    hash: 'a'.repeat(64),
    mode,
    sources: [],
    elements: devices.map((device) => ({ kind: 'device', id: device.id, terminals: [] })),
    branches: [],
    reviewScope: { elementIds: devices.map((device) => device.id), deviceIds: devices.map((device) => device.id), status: 'complete' },
    deviceInstances: devices.map((device) => ({
      id: device.id,
      profileId: device.profileId,
      profileVersion: DEVICE_PROFILES[device.profileId]?.version ?? '0.0.0',
      assetVersion: null,
      exactOrderCode: device.orderCode ?? null,
      designation: device.id.toUpperCase(),
      configuration: device.configuration ?? {},
      layoutMm: { x: 0, y: 0, rotation: 0 },
      verification: 'unverified',
    })),
    conductorBranches: connections.map(([fromDevice, fromTerminal, toDevice, toTerminal], index) => ({
      id: `branch:w${index + 1}`,
      conductorId: `conductor:w${index + 1}`,
      from: { elementId: fromDevice, terminalId: fromTerminal },
      to: { elementId: toDevice, terminalId: toTerminal },
      waypointsMm: [],
    })),
    settings: {},
    extensions: { legacy: {} },
  };
}

function plansFor(
  document: WorkshopDocumentV3,
  deviceIds: readonly [string, string],
  intent: WiringIntentV3,
) {
  return suggestWiringPlans(document, deviceIds, intent, catalog);
}

describe('v3 wiring assistant', () => {
  it('guides both the +24 V source path and 0 V return without mutating the document', () => {
    const document = documentWith('practice', [
      { id: 'dc', profileId: 'boundary:dc-supply' },
      { id: 'load', profileId: 'boundary:load' },
    ]);
    const before = structuredClone(document);

    const plans = plansFor(document, ['dc', 'load'], 'dc-power');
    const conductors = plans.flatMap((plan) => plan.steps.filter((step) => step.kind === 'conductor'));

    expect(conductors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        circuitRole: 'source',
        from: { elementId: 'dc', terminalId: '+' },
        to: { elementId: 'load', terminalId: '+' },
      }),
      expect.objectContaining({
        circuitRole: 'return',
        from: { elementId: 'load', terminalId: '-' },
        to: { elementId: 'dc', terminalId: '-' },
      }),
    ]));
    expect(conductors.map((step) => step.circuitRole)).toEqual(['source', 'return']);
    expect(plans.some((plan) => plan.remainingPrerequisites.some((step) => step.reasonCode === 'OPEN_RETURN_PATH'))).toBe(true);
    expect(document).toEqual(before);
  });

  it('marks an existing positive conductor separately while still requiring the return path', () => {
    const document = documentWith('practice', [
      { id: 'dc', profileId: 'boundary:dc-supply' },
      { id: 'load', profileId: 'boundary:load' },
    ], [['dc', '+', 'load', '+']]);

    const plans = plansFor(document, ['dc', 'load'], 'dc-power');
    const positive = plans.find((plan) => plan.steps.some((step) => step.from?.terminalId === '+' && step.to?.terminalId === '+'));
    const negative = plans.find((plan) => plan.steps.some((step) => step.from?.terminalId === '-' && step.to?.terminalId === '-'));

    expect(positive?.steps[0]?.status).toBe('ALREADY_CONNECTED');
    expect(positive?.status).toBe('REQUIRES_PREREQUISITE');
    expect(negative?.steps[0]?.status).toBe('READY');
  });

  it('blocks prewire guidance until exact manual-backed order codes are present', () => {
    const missingOrderCode = documentWith('prewire', [
      { id: 'mdr', profileId: 'mean-well:mdr-100-24' },
      { id: 'load', profileId: 'boundary:load' },
    ]);
    const educationalDevice = documentWith('prewire', [
      { id: 'md02', profileId: 'generic:xy-md02', orderCode: 'XY-MD02' },
      { id: 'peer', profileId: 'boundary:communication-peer' },
    ]);

    expect(plansFor(missingOrderCode, ['mdr', 'load'], 'dc-power')).toEqual([
      expect.objectContaining({ status: 'BLOCKED', reasonCode: 'ORDER_CODE_REQUIRED' }),
    ]);
    expect(plansFor(educationalDevice, ['md02', 'peer'], 'rs485')).toEqual([
      expect.objectContaining({ status: 'BLOCKED', reasonCode: 'PROFILE_NOT_PREWIRE_ELIGIBLE' }),
    ]);
  });

  it('never offers NC or PE as a normal DC conductor', () => {
    const document = documentWith('practice', [
      { id: 'plc', profileId: 'ls-electric:xbc-dr32h', orderCode: 'XBC-DR32H' },
      { id: 'load', profileId: 'boundary:load' },
    ]);

    const refs = plansFor(document, ['plc', 'load'], 'dc-power')
      .flatMap((plan) => [...plan.steps, ...plan.remainingPrerequisites])
      .flatMap((step) => [step.from, step.to])
      .filter(Boolean)
      .map((ref) => `${ref?.elementId}:${ref?.terminalId}`);

    expect(refs).not.toContain('plc:NC');
    expect(refs).not.toContain('plc:PE');
  });

  it('matches RS485 A-to-A and B-to-B and never recommends an A/B reversal', () => {
    const document = documentWith('practice', [
      { id: 'md02', profileId: 'generic:xy-md02' },
      { id: 'peer', profileId: 'boundary:communication-peer' },
    ]);

    const pairs = plansFor(document, ['md02', 'peer'], 'rs485')
      .flatMap((plan) => plan.steps)
      .filter((step) => step.kind === 'conductor')
      .map((step) => `${step.from?.terminalId}->${step.to?.terminalId}`);

    expect(pairs).toEqual(expect.arrayContaining(['A+->A', 'B-->B']));
    expect(pairs).not.toEqual(expect.arrayContaining(['A+->B', 'B-->A']));
  });

  it('keeps PE guidance exclusive to protective-earth terminals', () => {
    const document = documentWith('practice', [
      { id: 'plc', profileId: 'ls-electric:xbc-dr32h' },
      { id: 'ac', profileId: 'boundary:ac-supply' },
    ]);

    const steps = plansFor(document, ['plc', 'ac'], 'protective-earth').flatMap((plan) => plan.steps);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      circuitRole: 'pe',
      from: { elementId: 'plc', terminalId: 'PE' },
      to: { elementId: 'ac', terminalId: 'PE' },
    });
  });

  it('shows COM and contact supply prerequisites for a dry-contact PLC input path', () => {
    const document = documentWith('practice', [
      { id: 'contact', profileId: 'boundary:dry-contact' },
      { id: 'plc', profileId: 'ls-electric:xbc-dr32h' },
    ]);

    const plans = plansFor(document, ['contact', 'plc'], 'digital-input');
    expect(plans.some((plan) => plan.steps.some((step) => step.to?.terminalId === 'P00'))).toBe(true);
    expect(plans.flatMap((plan) => plan.remainingPrerequisites).map((step) => step.reasonCode)).toEqual(
      expect.arrayContaining(['INPUT_COMMON_REQUIRED', 'CONTACT_SUPPLY_REQUIRED']),
    );
    expect(plans.every((plan) => plan.status === 'REQUIRES_PREREQUISITE')).toBe(true);
  });

  it('uses relay output points for a load and keeps the COM terminal as a supply prerequisite', () => {
    const document = documentWith('practice', [
      { id: 'plc', profileId: 'ls-electric:xbc-dr32h' },
      { id: 'load', profileId: 'boundary:load' },
    ]);

    const plans = plansFor(document, ['plc', 'load'], 'digital-output');
    const directFrom = plans.flatMap((plan) => plan.steps).map((step) => step.from?.terminalId).filter(Boolean);
    const prerequisites = plans.flatMap((plan) => plan.remainingPrerequisites);

    expect(directFrom).toContain('P20');
    expect(directFrom.some((terminalId) => String(terminalId).startsWith('COM'))).toBe(false);
    expect(prerequisites).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reasonCode: 'CONTACT_SUPPLY_REQUIRED',
        from: { elementId: 'plc', terminalId: 'COM0' },
      }),
    ]));
  });
});
