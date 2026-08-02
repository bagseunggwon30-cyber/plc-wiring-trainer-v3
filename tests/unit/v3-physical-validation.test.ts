import { describe, expect, it } from 'vitest';
import {
  mergePhysicalValidationV3,
  validatePhysicalPrewireV3,
  type PhysicalPrewireValidationInputV3,
} from '../../src/domain/v3';

function baseInput(): PhysicalPrewireValidationInputV3 {
  return {
    document: {
      physicalLayout: { status: 'complete', sourceUnit: 'canvas-unit', canvasUnitsPerMm: 1 },
      deviceInstances: [
        { id: 'ps1', profileId: 'mean-well:mdr-100-24', profileVersion: '1', assetVersion: '1', exactOrderCode: 'MDR-100-24', designation: 'PS1', configuration: {}, layoutMm: { x: 0, y: 0, rotation: 0 }, verification: 'unverified' },
        { id: 'plc1', profileId: 'ls-electric:xbc-dr32h', profileVersion: '1', assetVersion: '1', exactOrderCode: 'XBC-DR32H', designation: 'PLC1', configuration: {}, layoutMm: { x: 150, y: 0, rotation: 0 }, verification: 'unverified' },
      ],
      conductors: [{
        id: 'c1', cableAssemblyId: 'cable1', core: '1', color: 'red', gauge: '0.75mm2', wireNumber: 'W1', crossSectionMm2: 0.75,
        awg: null, lengthMm: 120, pairId: null, shielded: false, drain: false, ferruleFrom: 'F1', ferruleTo: 'F2', lugFrom: null, lugTo: null,
      }],
      terminalAssemblies: [{
        id: 'ta1', deviceId: 'ps1', terminalIds: ['V+1'], manufacturer: 'Phoenix', orderCode: 'UT 2.5', designation: 'X1', terminalType: 'through', marker: '1',
        maximumConductorsPerTerminal: 2, bridges: [], accessories: [],
      }],
      conductorBranches: [{ id: 'b1', conductorId: 'c1', from: { elementId: 'ps1', terminalId: 'V+1' }, to: { elementId: 'plc1', terminalId: '24V' }, waypointsMm: [] }],
    },
    devices: [
      { deviceId: 'ps1', partNumber: 'MDR-100-24', designation: 'PS1', widthMm: 100, heightMm: 40, depthMm: 120, orientationDeg: 0, railId: 'rail-1' },
      { deviceId: 'plc1', partNumber: 'XBC-DR32H', designation: 'PLC1', widthMm: 120, heightMm: 80, depthMm: 70, orientationDeg: 0, railId: 'rail-1' },
    ],
    rails: [{ id: 'rail-1', partNumber: 'NS35', xMm: 0, yMm: 0, lengthMm: 300, widthMm: 35, orientation: 'horizontal' }],
    ducts: [{ id: 'duct-1', partNumber: 'D-20', capacityMm2: 2 }],
    routes: [{ conductorId: 'c1', routeId: 'power-route', domain: 'power', ductId: 'duct-1', separationMm: 20 }],
    clearance: { minimumMm: 5, sourcePartNumber: 'panel-standard-1' },
    routeSeparation: { minimumMm: 10, sourcePartNumber: 'panel-standard-1' },
    requireFerrules: true,
  };
}

describe('v3 physical prewire validation', () => {
  it('accepts complete explicit mm, rail, conductor, terminal, duct, and route facts', () => {
    const physical = validatePhysicalPrewireV3(baseInput());

    expect(physical).toEqual({ status: 'PASS', issues: [] });
    expect(mergePhysicalValidationV3(
      { status: 'PASS', issues: [], documentRevision: 3, documentHash: 'hash' },
      physical,
    )).toEqual({ status: 'PASS', issues: [], documentRevision: 3, documentHash: 'hash' });
  });

  it('preserves stale freshness and known electrical failures when physical data is blocked', () => {
    const physical = { status: 'BLOCKED' as const, issues: [] };

    expect(mergePhysicalValidationV3(
      { status: 'STALE', issues: [], documentRevision: 3, documentHash: 'old-hash' },
      physical,
    ).status).toBe('STALE');
    expect(mergePhysicalValidationV3(
      { status: 'FAIL', issues: [], documentRevision: 4, documentHash: 'current-hash' },
      physical,
    ).status).toBe('FAIL');
  });

  it('blocks positional review when a legacy canvas has no explicit mm conversion', () => {
    const base = baseInput();
    const result = validatePhysicalPrewireV3({
      ...base,
      document: { ...base.document, physicalLayout: undefined },
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.issues.map((entry) => entry.code)).toContain('PHYSICAL_SCALE_REQUIRED');
    expect(result.issues.map((entry) => entry.code)).not.toContain('DIN_RAIL_CONTAINMENT_VIOLATION');
    expect(result.issues.map((entry) => entry.code)).not.toContain('PHYSICAL_CLEARANCE_VIOLATION');
  });

  it('blocks missing official limits and part facts instead of guessing physical constraints', () => {
    const base = baseInput();
    const input: PhysicalPrewireValidationInputV3 = {
      ...base,
      devices: [{ ...base.devices[0], partNumber: null, widthMm: null, designation: null }],
      clearance: null,
      rails: [{ ...base.rails![0], partNumber: null, lengthMm: null }],
      ducts: [{ ...base.ducts![0], partNumber: null, capacityMm2: null }],
      routes: [{ conductorId: 'c1', routeId: 'mixed', domain: 'analog', ductId: 'duct-1', shieldTermination: null }],
      document: {
        ...base.document,
        conductors: [{ ...base.document.conductors![0], wireNumber: null, crossSectionMm2: null, gauge: null, awg: null, lengthMm: null, ferruleFrom: null }],
        terminalAssemblies: [{ ...base.document.terminalAssemblies![0], maximumConductorsPerTerminal: null }],
      },
    };

    const codes = validatePhysicalPrewireV3(input).issues.map((entry) => entry.code);

    expect(codes).toEqual(expect.arrayContaining([
      'PHYSICAL_PART_NUMBER_REQUIRED', 'PHYSICAL_DIMENSIONS_REQUIRED', 'DIN_RAIL_DATA_REQUIRED', 'DUCT_CAPACITY_DATA_REQUIRED',
      'CONDUCTOR_METADATA_INCOMPLETE', 'TERMINAL_CAPACITY_REQUIRED',
    ]));
  });

  it('does not demand terminal-product capacity for logical review boundaries', () => {
    const result = validatePhysicalPrewireV3({
      document: {
        deviceInstances: [{
          id: 'dc-boundary',
          profileId: 'boundary:dc-supply',
          profileVersion: '1.0.0',
          assetVersion: null,
          exactOrderCode: null,
          designation: null,
          configuration: {},
          layoutMm: { x: 0, y: 0, rotation: 0 },
          verification: 'unverified',
        }],
        conductors: [],
        conductorBranches: [],
        terminalAssemblies: [{
          id: 'terminals:dc-boundary',
          deviceId: 'dc-boundary',
          terminalIds: ['+', '-'],
          manufacturer: null,
          orderCode: null,
          designation: null,
          terminalType: null,
          marker: null,
          maximumConductorsPerTerminal: null,
          bridges: [],
          accessories: [],
        }],
      },
      devices: [],
    });

    expect(result).toEqual({ status: 'PASS', issues: [] });
  });

  it('detects duplicate designations, clearance/rail violations, terminal overfill, duct overload, and unsafe route mixing deterministically', () => {
    const base = baseInput();
    const input: PhysicalPrewireValidationInputV3 = {
      ...base,
      devices: [
        { ...base.devices[0], designation: 'PS1', widthMm: 100, railId: 'rail-1' },
        { ...base.devices[1], designation: 'ps1', widthMm: 120, orientationDeg: 90, railId: 'rail-1' },
      ],
      ducts: [{ ...base.ducts![0], capacityMm2: 1 }],
      routes: [
        { conductorId: 'c1', routeId: 'mixed', domain: 'power', ductId: 'duct-1', separationMm: 2 },
        { conductorId: 'c2', routeId: 'mixed', domain: 'analog', ductId: 'duct-1', separationMm: 2, shieldTermination: null },
      ],
      document: {
        ...base.document,
        deviceInstances: [
          { ...base.document.deviceInstances![0], layoutMm: { x: 250, y: 0, rotation: 0 } },
          { ...base.document.deviceInstances![1], layoutMm: { x: 252, y: 0, rotation: 0 } },
        ],
        conductors: [
          base.document.conductors![0],
          { ...base.document.conductors![0], id: 'c2', core: '1', wireNumber: 'W1', crossSectionMm2: 2, shielded: true },
        ],
        conductorBranches: [
          ...base.document.conductorBranches!,
      { id: 'b2', conductorId: 'c2', from: { elementId: 'ps1', terminalId: 'V+1' }, to: { elementId: 'plc1', terminalId: '24V' }, waypointsMm: [] },
        ],
        terminalAssemblies: [{ ...base.document.terminalAssemblies![0], maximumConductorsPerTerminal: 1 }],
      },
    };

    const first = validatePhysicalPrewireV3(input);
    const second = validatePhysicalPrewireV3(input);
    expect(first).toEqual(second);
    expect(first.status).toBe('BLOCKED');
    expect(first.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'PHYSICAL_DESIGNATION_DUPLICATE', 'PHYSICAL_CLEARANCE_VIOLATION', 'DIN_RAIL_CONTAINMENT_VIOLATION', 'DIN_RAIL_ORIENTATION_VIOLATION',
      'CONDUCTOR_IDENTIFIER_DUPLICATE', 'TERMINAL_CAPACITY_EXCEEDED', 'DUCT_CAPACITY_EXCEEDED', 'ROUTE_SEPARATION_VIOLATION', 'SHIELD_TERMINATION_REQUIRED',
    ]));
  });
});
