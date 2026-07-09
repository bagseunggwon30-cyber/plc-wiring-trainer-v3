import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { adaptLegacyState, mergeWorkshopShadow } from '../../src/renderer/legacy-adapter';
import type { WorkshopDocumentV2 } from '../../src/domain/types';

describe('legacy renderer to WorkshopDocument v2 adapter', () => {
  it('never promotes raw legacy type names to verified catalog profiles', async () => {
    const document = await adaptLegacyState({
      devices: {
        plc: { type: 'XBC-DR32H', x: 10, y: 20, rot: 90 },
        supply: { type: 'BOUNDARY-AC', x: 0, y: 0 },
        unknown: { type: 'MCCB', x: 30, y: 40 },
      },
      wires: [{ id: 'w1', from: { dev: 'supply', term: 'L1' }, to: { dev: 'plc', term: 'L' } }],
      jumpers: [],
      nextId: 4,
      revision: 7,
      goal: null,
    }, 'prewire', DEVICE_PROFILES);

    expect(document.mode).toBe('prewire');
    expect(document.revision).toBe(7);
    expect(document.devices.find((device) => device.id === 'plc')).toMatchObject({
      profileId: 'legacy:XBC-DR32H',
      profileVersion: 'legacy-v1',
      evidenceLevel: 'educational',
      missingProfile: true,
      rotation: 90,
    });
    expect(document.devices.find((device) => device.id === 'supply')).toMatchObject({
      profileId: 'legacy:BOUNDARY-AC',
      evidenceLevel: 'educational',
      missingProfile: true,
    });
    expect(document.devices.find((device) => device.id === 'unknown')).toMatchObject({
      profileId: 'legacy:MCCB',
      evidenceLevel: 'educational',
      missingProfile: true,
    });
    expect(document.wires[0]).toMatchObject({
      from: { deviceId: 'supply', terminalId: 'L1' },
      to: { deviceId: 'plc', terminalId: 'L' },
    });
  });

  it('uses an explicit profile identity assigned when a catalog item is placed', async () => {
    const document = await adaptLegacyState({
      devices: {
        plc: { type: 'XBC-DR32H', __v2ProfileId: 'ls-electric:xbc-dr32h' },
        supply: { type: 'BOUNDARY-AC', __v2ProfileId: 'boundary:ac-supply' },
      },
      wires: [], jumpers: [], revision: 1,
    }, 'prewire', DEVICE_PROFILES);

    expect(document.devices).toEqual([
      expect.objectContaining({
        id: 'plc', profileId: 'ls-electric:xbc-dr32h', profileVersion: '1.0.0',
        evidenceLevel: 'manual-verified', missingProfile: false,
      }),
      expect.objectContaining({
        id: 'supply', profileId: 'boundary:ac-supply', profileVersion: '1.0.0',
        evidenceLevel: 'educational', missingProfile: false,
      }),
    ]);
  });

  it('preserves jumpers, settings, layout, and opaque legacy fields', async () => {
    const document = await adaptLegacyState({
      devices: { psu: { type: 'MDR-100', x: 1, y: 2, locked: true } },
      wires: [],
      jumpers: [{ id: 'j1', deviceId: 'psu', terms: ['V+1', 'V+2'] }],
      nextId: 2,
      revision: 3,
      goal: 'core-mdr-distribution',
      boardMode: 'panel-layout',
      panelConfig: { rows: 3, cols: 1, door: true },
      customLegacyField: { keep: true },
    }, 'practice', DEVICE_PROFILES);

    expect(document.jumpers[0].terminalIds).toEqual(['V+1', 'V+2']);
    expect(document.settings.goal).toBe('core-mdr-distribution');
    expect(document.layout.panelConfig).toEqual({ rows: 3, cols: 1, door: true });
    expect(document.devices[0].configuration.locked).toBe(true);
    expect(document.extensions.legacy.customLegacyField).toEqual({ keep: true });
    expect(document.source.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves migrated educational identity instead of promoting by visible type name', async () => {
    const document = await adaptLegacyState({
      devices: {
        plc: {
          type: 'XBC-DR32H',
          __v2ProfileId: 'legacy:XBC-DR32H',
          __v2ProfileVersion: 'legacy-v1',
          __v2EvidenceLevel: 'educational',
          __v2MissingProfile: true,
        },
      },
      wires: [], jumpers: [], revision: 2,
    }, 'practice', DEVICE_PROFILES);

    expect(document.devices[0]).toMatchObject({
      profileId: 'legacy:XBC-DR32H',
      profileVersion: 'legacy-v1',
      evidenceLevel: 'educational',
      missingProfile: true,
    });
    expect(document.devices[0].configuration).not.toHaveProperty('__v2ProfileId');
  });

  it('preserves unrenderable devices and opaque v2 data while merging visible editor deltas', async () => {
    const edited = await adaptLegacyState({
      devices: {
        plc: { type: 'XBC-DR32H', x: 99, __v2ProfileId: 'ls-electric:xbc-dr32h' },
        added: { type: 'MDR-100', __v2ProfileId: 'mean-well:mdr-100-24' },
      },
      wires: [], jumpers: [], revision: 9, goal: null, nextId: 20,
    }, 'prewire', DEVICE_PROFILES);
    const shadow: WorkshopDocumentV2 = {
      ...edited,
      revision: 8,
      name: '사용자 원본 이름',
      source: { kind: 'legacy-v1', hash: 'b'.repeat(64) },
      devices: [
        { ...edited.devices[0], x: 1 },
        {
          id: 'opaque', profileId: 'vendor:future-device', profileVersion: '3.2',
          evidenceLevel: 'educational', missingProfile: true, x: 7, y: 8, rotation: 0,
          configuration: { keep: 'exactly' },
        },
        { ...edited.devices[0], id: 'deleted' },
      ],
      layout: { futureLayout: { keep: true } },
      settings: { futureSetting: 42 },
      extensions: { legacy: { opaqueField: { keep: true } } },
    };

    const merged = mergeWorkshopShadow(shadow, edited, ['plc', 'deleted']);

    expect(merged.name).toBe('사용자 원본 이름');
    expect(merged.source).toEqual(shadow.source);
    expect(merged.revision).toBe(9);
    expect(merged.devices.find((device) => device.id === 'plc')?.x).toBe(99);
    expect(merged.devices).toContainEqual(expect.objectContaining({
      id: 'opaque', profileId: 'vendor:future-device', configuration: { keep: 'exactly' },
    }));
    expect(merged.devices.some((device) => device.id === 'deleted')).toBe(false);
    expect(merged.devices.some((device) => device.id === 'added')).toBe(true);
    expect(merged.layout.futureLayout).toEqual({ keep: true });
    expect(merged.settings.futureSetting).toBe(42);
    expect(merged.extensions.legacy.opaqueField).toEqual({ keep: true });
  });
});
