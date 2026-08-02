import type {
  CircuitIssueV3,
  ConductorBranchV3,
  ConductorV3,
  TerminalAssemblyV3,
  ValidationResultV3,
  ValidationStatusV3,
  WorkshopDocumentV3,
} from './contracts';

export type PhysicalValidationCodeV3 =
  | 'PHYSICAL_SCALE_REQUIRED'
  | 'PHYSICAL_PART_NUMBER_REQUIRED'
  | 'PHYSICAL_DIMENSIONS_REQUIRED'
  | 'PHYSICAL_DESIGNATION_REQUIRED'
  | 'PHYSICAL_DESIGNATION_DUPLICATE'
  | 'PHYSICAL_CLEARANCE_LIMIT_REQUIRED'
  | 'PHYSICAL_CLEARANCE_VIOLATION'
  | 'DIN_RAIL_DATA_REQUIRED'
  | 'DIN_RAIL_CONTAINMENT_VIOLATION'
  | 'DIN_RAIL_ORIENTATION_VIOLATION'
  | 'DUCT_CAPACITY_DATA_REQUIRED'
  | 'DUCT_CAPACITY_EXCEEDED'
  | 'CONDUCTOR_METADATA_INCOMPLETE'
  | 'CONDUCTOR_IDENTIFIER_DUPLICATE'
  | 'TERMINAL_CAPACITY_REQUIRED'
  | 'TERMINAL_CAPACITY_EXCEEDED'
  | 'ROUTE_SEPARATION_LIMIT_REQUIRED'
  | 'ROUTE_SEPARATION_VIOLATION'
  | 'SHIELD_TERMINATION_REQUIRED';

export interface PhysicalValidationIssueV3 {
  readonly code: PhysicalValidationCodeV3;
  readonly message: string;
  readonly refs: readonly string[];
  readonly blocking: boolean;
}

export interface PhysicalDeviceV3 {
  readonly deviceId: string;
  readonly partNumber: string | null;
  readonly designation: string | null;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
  readonly depthMm: number | null;
  readonly orientationDeg: number | null;
  readonly railId?: string | null;
}

export interface DinRailV3 {
  readonly id: string;
  readonly partNumber: string | null;
  readonly xMm: number;
  readonly yMm: number;
  readonly lengthMm: number | null;
  readonly widthMm: number | null;
  readonly orientation: 'horizontal' | 'vertical';
}

export interface DuctV3 {
  readonly id: string;
  readonly partNumber: string | null;
  readonly capacityMm2: number | null;
}

export type RouteDomainV3 = 'power' | 'analog' | 'communication';
export type ShieldTerminationV3 = 'source-only' | 'load-only' | 'both' | 'none';

export interface ConductorRouteV3 {
  readonly conductorId: string;
  readonly routeId: string;
  readonly domain: RouteDomainV3;
  readonly ductId?: string | null;
  readonly separationMm?: number | null;
  readonly shieldTermination?: ShieldTerminationV3 | null;
}

export interface ClearanceLimitV3 {
  readonly minimumMm: number;
  readonly sourcePartNumber: string;
}

export interface RouteSeparationLimitV3 {
  readonly minimumMm: number;
  readonly sourcePartNumber: string;
}

export interface PhysicalPrewireValidationInputV3 {
  readonly document: Pick<WorkshopDocumentV3, 'physicalLayout' | 'deviceInstances' | 'conductors' | 'terminalAssemblies' | 'conductorBranches'>;
  readonly devices: readonly PhysicalDeviceV3[];
  readonly rails?: readonly DinRailV3[];
  readonly ducts?: readonly DuctV3[];
  readonly routes?: readonly ConductorRouteV3[];
  readonly clearance?: ClearanceLimitV3 | null;
  readonly routeSeparation?: RouteSeparationLimitV3 | null;
  readonly requireFerrules?: boolean;
}

export interface PhysicalValidationResultV3 {
  readonly status: ValidationStatusV3;
  readonly issues: readonly PhysicalValidationIssueV3[];
}

export interface MergedPhysicalValidationResultV3 extends Omit<ValidationResultV3, 'issues' | 'status'> {
  readonly status: ValidationStatusV3;
  readonly issues: readonly (CircuitIssueV3 | PhysicalValidationIssueV3)[];
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const validPositive = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validOrientation = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value) && value % 90 === 0;

function issue(code: PhysicalValidationCodeV3, message: string, refs: readonly string[], blocking = true): PhysicalValidationIssueV3 {
  return { code, message, refs: [...refs].sort(compareText), blocking };
}

function normalizedDesignation(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function documentDeviceById(input: PhysicalPrewireValidationInputV3): ReadonlyMap<string, NonNullable<WorkshopDocumentV3['deviceInstances']>[number]> {
  return new Map((input.document.deviceInstances ?? []).map((device) => [device.id, device]));
}

function branchTerminalUse(branches: readonly ConductorBranchV3[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const branch of branches) for (const endpoint of [branch.from, branch.to]) {
    const key = `${endpoint.elementId}:${endpoint.terminalId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function conductorById(conductors: readonly ConductorV3[]): ReadonlyMap<string, ConductorV3> {
  return new Map(conductors.map((conductor) => [conductor.id, conductor]));
}

function validateDevices(
  input: PhysicalPrewireValidationInputV3,
  issues: PhysicalValidationIssueV3[],
  layoutReady: boolean,
): void {
  const instances = documentDeviceById(input);
  const clearance = input.clearance;
  const devices = [...input.devices].sort((left, right) => compareText(left.deviceId, right.deviceId));
  const designationOwners = new Map<string, string>();
  const rails = new Map((input.rails ?? []).map((rail) => [rail.id, rail]));

  for (const device of devices) {
    const instance = instances.get(device.deviceId);
    if (!instance) {
      issues.push(issue('PHYSICAL_DIMENSIONS_REQUIRED', 'Physical device does not map to a persisted V3 device instance.', [device.deviceId]));
      continue;
    }
    if (!device.partNumber?.trim()) issues.push(issue('PHYSICAL_PART_NUMBER_REQUIRED', 'Physical prewire requires an official device part number.', [device.deviceId]));
    const hasDimensions = validPositive(device.widthMm) && validPositive(device.heightMm) && validPositive(device.depthMm) && validOrientation(device.orientationDeg);
    if (!hasDimensions) {
      issues.push(issue('PHYSICAL_DIMENSIONS_REQUIRED', 'Physical prewire requires positive mm dimensions and a 90-degree orientation.', [device.deviceId]));
    }
    const designation = normalizedDesignation(device.designation ?? instance.designation);
    if (!designation) issues.push(issue('PHYSICAL_DESIGNATION_REQUIRED', 'Installed physical device requires a designation.', [device.deviceId]));
    else {
      const owner = designationOwners.get(designation);
      if (owner) issues.push(issue('PHYSICAL_DESIGNATION_DUPLICATE', `Designation ${designation} is assigned to more than one device.`, [owner, device.deviceId, designation]));
      else designationOwners.set(designation, device.deviceId);
    }
    if (device.railId) {
      const rail = rails.get(device.railId);
      if (!rail || !rail.partNumber?.trim() || !validPositive(rail.lengthMm) || !validPositive(rail.widthMm)) {
        issues.push(issue('DIN_RAIL_DATA_REQUIRED', 'DIN rail part number and mm dimensions are required.', [device.deviceId, device.railId]));
        continue;
      }
      if (!hasDimensions) continue;
      const expectedOrientation = rail.orientation === 'horizontal' ? 0 : 90;
      if (device.orientationDeg % 180 !== expectedOrientation) {
        issues.push(issue('DIN_RAIL_ORIENTATION_VIOLATION', 'Device orientation does not match its DIN rail orientation.', [device.deviceId, rail.id]));
      }
      if (!layoutReady) continue;
      const extent = rail.orientation === 'horizontal' ? device.widthMm : device.heightMm;
      const start = rail.orientation === 'horizontal' ? instance.layoutMm.x : instance.layoutMm.y;
      const railStart = rail.orientation === 'horizontal' ? rail.xMm : rail.yMm;
      if (start < railStart || start + extent > railStart + rail.lengthMm) {
        issues.push(issue('DIN_RAIL_CONTAINMENT_VIOLATION', 'Device footprint extends beyond its DIN rail length.', [device.deviceId, rail.id]));
      }
    }
  }

  if (devices.length > 1 && (!clearance || !validPositive(clearance.minimumMm) || !clearance.sourcePartNumber.trim())) {
    issues.push(issue('PHYSICAL_CLEARANCE_LIMIT_REQUIRED', 'Published clearance limit and source part number are required before checking device separation.', devices.map((device) => device.deviceId)));
    return;
  }
  if (!clearance) return;
  if (!layoutReady) return;
  for (let index = 0; index < devices.length; index += 1) for (const other of devices.slice(index + 1)) {
    const device = devices[index];
    const instance = instances.get(device.deviceId);
    const otherInstance = instances.get(other.deviceId);
    if (!instance || !otherInstance || !validPositive(device.widthMm) || !validPositive(device.heightMm) || !validPositive(other.widthMm) || !validPositive(other.heightMm)) continue;
    const horizontalGap = Math.max(instance.layoutMm.x - (otherInstance.layoutMm.x + other.widthMm), otherInstance.layoutMm.x - (instance.layoutMm.x + device.widthMm));
    const verticalGap = Math.max(instance.layoutMm.y - (otherInstance.layoutMm.y + other.heightMm), otherInstance.layoutMm.y - (instance.layoutMm.y + device.heightMm));
    if (horizontalGap < clearance.minimumMm && verticalGap < clearance.minimumMm) {
      issues.push(issue('PHYSICAL_CLEARANCE_VIOLATION', `Device clearance is below the published ${clearance.minimumMm} mm limit.`, [device.deviceId, other.deviceId]));
    }
  }
}

function validateConductors(input: PhysicalPrewireValidationInputV3, issues: PhysicalValidationIssueV3[]): void {
  const conductors = [...(input.document.conductors ?? [])].sort((left, right) => compareText(left.id, right.id));
  const wireOwners = new Map<string, string>();
  const coreOwners = new Map<string, string>();
  for (const conductor of conductors) {
    if (!conductor.wireNumber || (!validPositive(conductor.crossSectionMm2) && !conductor.awg && !conductor.gauge) || !validPositive(conductor.lengthMm)
      || (input.requireFerrules === true && (!conductor.ferruleFrom || !conductor.ferruleTo))) {
      issues.push(issue('CONDUCTOR_METADATA_INCOMPLETE', 'Conductor requires wire/core identifier, size, length, and required ferrules.', [conductor.id]));
    }
    if (conductor.wireNumber) {
      const owner = wireOwners.get(conductor.wireNumber);
      if (owner) issues.push(issue('CONDUCTOR_IDENTIFIER_DUPLICATE', 'Wire number is assigned to more than one conductor.', [owner, conductor.id, conductor.wireNumber]));
      else wireOwners.set(conductor.wireNumber, conductor.id);
    }
    const coreKey = `${conductor.cableAssemblyId}:${conductor.core}`;
    const coreOwner = coreOwners.get(coreKey);
    if (coreOwner) issues.push(issue('CONDUCTOR_IDENTIFIER_DUPLICATE', 'Cable core is assigned to more than one conductor.', [coreOwner, conductor.id, coreKey]));
    else coreOwners.set(coreKey, conductor.id);
  }
}

function validateTerminals(input: PhysicalPrewireValidationInputV3, issues: PhysicalValidationIssueV3[]): void {
  const counts = branchTerminalUse(input.document.conductorBranches ?? []);
  const instances = documentDeviceById(input);
  for (const assembly of [...(input.document.terminalAssemblies ?? [])].sort((left, right) => compareText(left.id, right.id))) {
    // Logical AC/DC/contact/load boundaries define the review interface; they
    // are neither BOM items nor installed terminal products.
    if (instances.get(assembly.deviceId)?.profileId.startsWith('boundary:')) continue;
    if (!validPositive(assembly.maximumConductorsPerTerminal)) {
      issues.push(issue('TERMINAL_CAPACITY_REQUIRED', 'Terminal assembly requires an official maximum conductor count.', [assembly.id]));
      continue;
    }
    for (const terminalId of assembly.terminalIds) {
      const key = `${assembly.deviceId}:${terminalId}`;
      if ((counts.get(key) ?? 0) > assembly.maximumConductorsPerTerminal) {
        issues.push(issue('TERMINAL_CAPACITY_EXCEEDED', 'Terminal conductor count exceeds the declared terminal limit.', [assembly.id, key]));
      }
    }
  }
}

function validateRoutes(input: PhysicalPrewireValidationInputV3, issues: PhysicalValidationIssueV3[]): void {
  const routes = input.routes ?? [];
  const conductors = conductorById(input.document.conductors ?? []);
  const ducts = new Map((input.ducts ?? []).map((duct) => [duct.id, duct]));
  const routeGroups = new Map<string, ConductorRouteV3[]>();
  for (const route of routes) {
    const group = routeGroups.get(route.routeId) ?? [];
    group.push(route);
    routeGroups.set(route.routeId, group);
    if (route.ductId) {
      const duct = ducts.get(route.ductId);
      if (!duct || !duct.partNumber?.trim() || !validPositive(duct.capacityMm2)) {
        issues.push(issue('DUCT_CAPACITY_DATA_REQUIRED', 'Duct part number and official capacity are required.', [route.conductorId, route.ductId]));
      }
    }
    const conductor = conductors.get(route.conductorId);
    if (conductor?.shielded && (route.domain === 'analog' || route.domain === 'communication') && !route.shieldTermination) {
      issues.push(issue('SHIELD_TERMINATION_REQUIRED', 'Shielded analog or communication conductor requires an explicit shield termination.', [route.conductorId, route.routeId]));
    }
  }
  for (const [routeId, entries] of routeGroups) {
    const power = entries.filter((entry) => entry.domain === 'power');
    const sensitive = entries.filter((entry) => entry.domain === 'analog' || entry.domain === 'communication');
    if (power.length && sensitive.length) {
      const limit = input.routeSeparation;
      if (!limit || !validPositive(limit.minimumMm) || !limit.sourcePartNumber.trim()) {
        issues.push(issue('ROUTE_SEPARATION_LIMIT_REQUIRED', 'Published power-to-signal route separation limit is required.', [routeId]));
      } else if (entries.some((entry) => !validPositive(entry.separationMm) || entry.separationMm < limit.minimumMm)) {
        issues.push(issue('ROUTE_SEPARATION_VIOLATION', `Power and analog/communication conductors violate the ${limit.minimumMm} mm route separation limit.`, [routeId]));
      }
    }
  }
  for (const duct of input.ducts ?? []) {
    if (!validPositive(duct.capacityMm2)) continue;
    const used = routes.filter((route) => route.ductId === duct.id)
      .reduce((sum, route) => sum + (conductors.get(route.conductorId)?.crossSectionMm2 ?? 0), 0);
    if (used > duct.capacityMm2) issues.push(issue('DUCT_CAPACITY_EXCEEDED', 'Duct conductor cross-section exceeds its declared capacity.', [duct.id]));
  }
}

/** Pure, deterministic validation of explicitly supplied physical installation facts and published limits. */
export function validatePhysicalPrewireV3(input: PhysicalPrewireValidationInputV3): PhysicalValidationResultV3 {
  const issues: PhysicalValidationIssueV3[] = [];
  const layout = input.document.physicalLayout;
  const layoutReady = input.devices.length === 0 || (
    layout?.status === 'complete' && validPositive(layout.canvasUnitsPerMm)
  );
  if (input.devices.length > 0 && !layoutReady) {
    issues.push(issue(
      'PHYSICAL_SCALE_REQUIRED',
      'Physical placement review requires an explicit positive canvas-units-per-mm conversion; legacy canvas coordinates are not millimetres.',
      [],
    ));
  }
  validateDevices(input, issues, layoutReady);
  validateConductors(input, issues);
  validateTerminals(input, issues);
  validateRoutes(input, issues);
  const sorted = [...issues].sort((left, right) => compareText(left.code, right.code) || left.refs.join('|').localeCompare(right.refs.join('|')));
  return { status: sorted.length ? 'BLOCKED' : 'PASS', issues: sorted };
}

/** Preserves revision/hash and combines physical findings without mutating the circuit validation snapshot. */
export function mergePhysicalValidationV3(
  validation: ValidationResultV3,
  physical: PhysicalValidationResultV3,
): MergedPhysicalValidationResultV3 {
  const status: ValidationStatusV3 = validation.status === 'STALE'
    ? 'STALE'
    : validation.status === 'FAIL'
      ? 'FAIL'
      : validation.status === 'BLOCKED' || physical.status === 'BLOCKED'
        ? 'BLOCKED'
        : 'PASS';
  return { ...validation, status, issues: [...validation.issues, ...physical.issues] };
}
