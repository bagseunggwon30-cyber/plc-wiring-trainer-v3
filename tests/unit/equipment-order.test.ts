import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import {
  buildControlPanelBomDocument,
  buildEquipmentOrderDocument,
  CONTROL_PANEL_BOM_ITEMS,
  createMissionOrderRecipes,
  defaultControlPanelBomQuantities,
  validateControlPanelBomQuantities,
  validateEquipmentOrderQuantities,
  type EquipmentOrderCatalogItem,
} from '../../src/domain/equipment-order';
import { PUBLIC_MISSIONS } from '../../src/domain/missions';

const legacyByProfile: Readonly<Record<string, string>> = {
  'boundary:ac-supply': 'BOUNDARY-AC',
  'boundary:dc-supply': 'BOUNDARY-DC',
  'boundary:dry-contact': 'BOUNDARY-CONTACT',
  'boundary:load': 'BOUNDARY-LOAD',
  'mean-well:mdr-100-24': 'MDR-100',
  'ls-electric:xbc-dn32up': 'XBC-DN32UP',
  'ls-electric:xbc-dr32h': 'XBC-DR32H',
  'ls-electric:exp2-0700d': 'EXP2-700',
  'educational:terminal-block-10': 'TB10',
};

const catalog: EquipmentOrderCatalogItem[] = Object.entries(legacyByProfile).map(([profileId, legacyType]) => ({
  profileId,
  legacyType,
  label: DEVICE_PROFILES[profileId]?.model ?? legacyType,
  width: legacyType === 'XBC-DR32H' ? 700 : 240,
  height: legacyType === 'XBC-DR32H' ? 560 : 220,
  mountTags: legacyType === 'EXP2-700' ? ['door'] : ['din'],
}));

const layout = {
  boardMode: 'panel-layout',
  cabinet: { x: 50, y: 50, w: 3500, h: 1800 },
  rails: {
    r1: { id: 'r1', x: 140, y: 200, w: 3200, h: 44, row: 0, col: 0 },
    r2: { id: 'r2', x: 140, y: 720, w: 3200, h: 44, row: 1, col: 0 },
  },
  ducts: {},
  doorPanel: { id: 'door', x: 3650, y: 100, w: 420, h: 1500 },
  panelConfig: { rows: 2, cols: 1, door: true },
};

const controlPanelLegacyByProfile: Readonly<Record<string, string>> = {
  'boundary:ac-supply': 'BOUNDARY-AC',
  'educational:mccb-2p': 'MCCB1P',
  'educational:mccb-3p': 'MCCB',
  'mean-well:mdr-100-24': 'MDR-100',
  'ls-electric:xbc-dr32h': 'XBC-DR32H',
  'omron:my2n-d2-dc24': 'MY2N',
  'ls-electric:mc-22b-dc24-1a1b': 'MC-22B-DC24',
  'ls-electric:sv-ig5a': 'IG5A',
  'educational:three-phase-motor': 'MOTOR-3P',
  'educational:pushbutton-no': 'PB-NO',
  'educational:pushbutton-nc': 'PB-NC',
  'educational:emergency-stop-nc2': 'EMSTOP',
  'generic:prox-npn-3wire': 'PROX-NPN',
  'educational:dc24-load': 'LAMP-G',
  'educational:distribution-24v-10': 'TB-24V-10',
  'educational:distribution-0v-10': 'TB-0V-10',
  'educational:distribution-pe-10': 'TB-PE-10',
};

const controlPanelCatalog: EquipmentOrderCatalogItem[] = [
  ...CONTROL_PANEL_BOM_ITEMS.map((item) => ({
    profileId: item.profileId,
    legacyType: item.legacyType,
    label: item.label,
    width: item.legacyType === 'XBC-DN32UP' ? 760 : item.placementZone === 'door' ? 120 : 180,
    height: item.legacyType === 'XBC-DN32UP' ? 240 : item.placementZone === 'door' ? 120 : 180,
    mountTags: item.placementZone === 'door' ? ['door'] : item.placementZone === 'field' ? ['free'] : ['din'],
  })),
  ...Object.entries(controlPanelLegacyByProfile)
    .filter(([profileId]) => !CONTROL_PANEL_BOM_ITEMS.some((item) => item.profileId === profileId))
    .map(([profileId, legacyType]) => ({
      profileId,
      legacyType,
      label: DEVICE_PROFILES[profileId]?.model ?? legacyType,
      width: 220,
      height: 100,
      mountTags: ['din'],
    })),
];

const controlPanelLayout = {
  boardMode: 'panel-layout',
  cabinet: { x: 50, y: 50, w: 3500, h: 2900 },
  rails: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
    `r${index + 1}`,
    { id: `r${index + 1}`, x: 140, y: 200 + index * 520, w: 3200, h: 44, row: index, col: 0 },
  ])),
  ducts: {},
  doorPanel: { id: 'door', x: 3650, y: 100, w: 420, h: 2700 },
  panelConfig: { rows: 5, cols: 1, door: true },
};

describe('equipment order recipes', () => {
  const recipes = createMissionOrderRecipes(PUBLIC_MISSIONS);

  it('splits one-of source and sink circuits into explicit recipes', () => {
    expect(recipes.some((recipe) => recipe.id === 'xbc-source-sink-input:source-input')).toBe(true);
    expect(recipes.some((recipe) => recipe.id === 'xbc-source-sink-input:sink-input')).toBe(true);
  });

  it('accepts only whole repeated circuit sets', () => {
    const recipe = recipes.find((entry) => entry.id === 'door-terminal-block-routing');
    expect(recipe).toBeDefined();
    const doubled = Object.fromEntries(recipe!.items.map((item) => [item.profileId, item.unitsPerSet * 2]));
    expect(validateEquipmentOrderQuantities(recipe!, doubled)).toMatchObject({ ok: true, setCount: 2 });

    doubled['boundary:dry-contact'] -= 1;
    expect(validateEquipmentOrderQuantities(recipe!, doubled)).toMatchObject({
      ok: false,
      code: 'ORDER_QUANTITY_RATIO_MISMATCH',
    });
  });

  it('creates a complete MDR order with deterministic role bindings and wires', () => {
    const recipe = recipes.find((entry) => entry.id === 'mdr-ac-dc-distribution')!;
    const quantities = Object.fromEntries(recipe.items.map((item) => [item.profileId, item.unitsPerSet]));
    const built = buildEquipmentOrderDocument({
      recipe, quantities, catalog, profiles: DEVICE_PROFILES, layout,
    });

    expect(built.setCount).toBe(1);
    expect(built.document.devices).toHaveLength(3);
    expect(built.document.wires).toHaveLength(5);
    expect(built.document.settings).toMatchObject({
      missionId: 'mdr-ac-dc-distribution',
      roleBindings: {
        acSupply: 'order-s01-acSupply',
        powerSupply: 'order-s01-powerSupply',
        dcLoad: 'order-s01-dcLoad',
      },
    });
    expect(built.document.wires).toContainEqual(expect.objectContaining({
      from: { deviceId: 'order-s01-powerSupply', terminalId: 'V+1' },
      to: { deviceId: 'order-s01-dcLoad', terminalId: '+' },
    }));
    expect(new Set(built.document.devices.map((device) => `${device.x}:${device.y}`)).size).toBe(3);
  });

  it('uses every ordered device when two identical circuit sets are requested', () => {
    const recipe = recipes.find((entry) => entry.id === 'exp2-xbc-rs485-practice')!;
    const quantities = Object.fromEntries(recipe.items.map((item) => [item.profileId, item.unitsPerSet * 2]));
    const built = buildEquipmentOrderDocument({
      recipe, quantities, catalog, profiles: DEVICE_PROFILES, layout,
    });

    expect(built.document.devices).toHaveLength(4);
    expect(built.document.wires).toHaveLength(4);
    expect(built.document.settings.missionId).toBeUndefined();
    expect(new Set(built.document.wires.flatMap((wire) => [wire.from.deviceId, wire.to.deviceId]))).toEqual(new Set([
      'order-s01-hmi', 'order-s01-plc', 'order-s02-hmi', 'order-s02-plc',
    ]));
  });
});

describe('control-panel BOM order', () => {
  it('validates independent equipment quantities instead of mission-set ratios', () => {
    const quantities = defaultControlPanelBomQuantities();
    expect(validateControlPanelBomQuantities(quantities)).toMatchObject({
      ok: true,
      inputPointCount: 5,
      generalOutputCount: 5,
    });

    quantities.mccb2p = 1;
    expect(validateControlPanelBomQuantities(quantities)).toMatchObject({
      ok: false,
      code: 'BOM_MCCB_2P_COUNT',
    });
  });

  it('blocks a panel whose requested I/O exceeds the ordered PLC capacity', () => {
    const quantities = defaultControlPanelBomQuantities();
    quantities.relay = 16;
    expect(validateControlPanelBomQuantities(quantities)).toMatchObject({
      ok: false,
      code: 'BOM_PLC_OUTPUT_CAPACITY',
    });
  });

  it('places the ordered BOM in fixed panel zones and completes source and return wiring', () => {
    const quantities = defaultControlPanelBomQuantities();
    const built = buildControlPanelBomDocument({
      quantities,
      catalog: controlPanelCatalog,
      profiles: DEVICE_PROFILES,
      layout: controlPanelLayout,
    });

    const workflow = built.document.settings.v3Workflow as { designations: Record<string, string> };
    const designations = workflow.designations;
    const byDesignation = Object.fromEntries(built.document.devices.map((device) => [designations[device.id], device]));
    expect(byDesignation.QF1.y).toBe(200 + 22 - Number(byDesignation.QF1.configuration.catalogHeight) / 2);
    expect(byDesignation.PLC1.y).toBe(720 + 22 - Number(byDesignation.PLC1.configuration.catalogHeight) / 2);
    expect(byDesignation.SB1.x).toBeGreaterThanOrEqual(3650);
    expect(byDesignation.B1.y).toBeGreaterThan(2900);

    expect(built.ioAssignments.inputs.map((entry) => entry.plcTerminal)).toEqual([
      'P00', 'P01', 'P02', 'P03', 'P04',
    ]);
    expect(built.document.wires).toContainEqual(expect.objectContaining({
      from: { deviceId: byDesignation.PLC1.id, terminalId: 'P00' },
      to: { deviceId: byDesignation.SB1.id, terminalId: '2' },
    }));
    expect(built.document.wires).toContainEqual(expect.objectContaining({
      from: { deviceId: byDesignation.HL1.id, terminalId: '-' },
      to: expect.objectContaining({ deviceId: byDesignation.PLC1.id, terminalId: expect.stringMatching(/^P2[0-9A-F]$/) }),
    }));
    expect(built.document.wires).toContainEqual(expect.objectContaining({
      from: { deviceId: byDesignation.PS1.id, terminalId: 'V+1' },
      to: expect.objectContaining({ deviceId: expect.stringContaining('bus24') }),
    }));
  });

  it('uses the DN32UP NPN output supply and a shared 0V reference for inverter commands', () => {
    const quantities = defaultControlPanelBomQuantities();
    Object.assign(quantities, {
      mccb3p: 1,
      inverter: 1,
      motor: 1,
      relay: 0,
      greenLamp: 0,
      yellowLamp: 0,
      buzzer: 0,
    });
    const built = buildControlPanelBomDocument({
      quantities,
      catalog: controlPanelCatalog,
      profiles: DEVICE_PROFILES,
      layout: controlPanelLayout,
    });
    const inverterAssignment = built.ioAssignments.outputs.find((entry) => entry.kind === 'inverter');
    expect(inverterAssignment).toMatchObject({ plcCommon: 'COMO', plcTerminals: ['P20', 'P21'] });
    const inverter = built.document.devices.find((device) => device.id === inverterAssignment!.deviceId)!;
    expect(built.document.wires).toContainEqual(expect.objectContaining({
      to: { deviceId: inverter.id, terminalId: 'CM' },
    }));
    expect(built.document.wires).toContainEqual(expect.objectContaining({
      to: { deviceId: inverterAssignment!.plcId, terminalId: 'VOUT' },
    }));
    expect(built.document.wires).toContainEqual(expect.objectContaining({
      to: { deviceId: inverterAssignment!.plcId, terminalId: 'COMO' },
    }));
    expect(built.document.wires.some((wire) => wire.from.deviceId === inverter.id && wire.from.terminalId === '24')).toBe(false);
  });
});
