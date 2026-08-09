import type { DeviceProfileV3, RackContractV3 } from '../catalog/v3-profiles';

export interface RackDevicePlacement {
  readonly deviceId: string;
  readonly profileId: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly railId?: string;
  readonly requestedHostId?: string;
  readonly requestedSlot?: number;
}

export interface XgbAddressRange {
  readonly startPoint: number;
  readonly endPoint: number;
  readonly start: string;
  readonly end: string;
}

export interface RackAssignment {
  readonly deviceId: string;
  readonly hostDeviceId: string;
  readonly slot: number;
  readonly range: XgbAddressRange;
  readonly specialBase: string | null;
  readonly terminalAddresses: Readonly<Record<string, string>>;
}

export interface RackLayoutIssue {
  readonly code:
    | 'RACK_HOST_NOT_FOUND'
    | 'RACK_SLOT_DUPLICATE'
    | 'RACK_SLOT_OUT_OF_RANGE'
    | 'RACK_FAMILY_MISMATCH';
  readonly message: string;
  readonly refs: readonly string[];
  readonly blocking: true;
}

export interface RackLayoutResult {
  readonly assignments: Readonly<Record<string, RackAssignment>>;
  readonly issues: readonly RackLayoutIssue[];
}

function rack(profile: DeviceProfileV3 | undefined): RackContractV3 | null {
  return profile?.rack ?? null;
}

/** XG5000 P notation uses a decimal word number plus a hexadecimal bit suffix. */
export function xgbPAddressFromPoint(point: number): string {
  if (!Number.isInteger(point) || point < 0) throw new Error(`Invalid XGB point index: ${point}`);
  const word = Math.floor(point / 16);
  const bit = (point % 16).toString(16).toUpperCase();
  return `P${String(word).padStart(3, '0')}${bit}`;
}

/** XGB hardware manual PDF pp.95-96: every stage occupies 64 P points. */
export function xgbSlotRange(slot: number): XgbAddressRange {
  if (!Number.isInteger(slot) || slot < 0) throw new Error(`Invalid XGB slot: ${slot}`);
  const startPoint = slot * 64;
  const endPoint = startPoint + 63;
  return {
    startPoint,
    endPoint,
    start: xgbPAddressFromPoint(startPoint),
    end: xgbPAddressFromPoint(endPoint),
  };
}

function hostTerminalAddresses(profile: DeviceProfileV3, contract: RackContractV3): Readonly<Record<string, string>> {
  const addresses: Record<string, string> = {};
  contract.inputTerminalIds?.forEach((terminalId, index) => {
    if (profile.terminals.some((terminal) => terminal.id === terminalId)) {
      addresses[terminalId] = xgbPAddressFromPoint(index);
    }
  });
  contract.outputTerminalIds?.forEach((terminalId, index) => {
    if (profile.terminals.some((terminal) => terminal.id === terminalId)) {
      addresses[terminalId] = xgbPAddressFromPoint(32 + index);
    }
  });
  return addresses;
}

function issue(code: RackLayoutIssue['code'], message: string, refs: readonly string[]): RackLayoutIssue {
  return { code, message, refs, blocking: true };
}

function matchingHost(
  module: RackDevicePlacement,
  moduleRack: RackContractV3,
  hosts: readonly RackDevicePlacement[],
  profiles: Readonly<Record<string, DeviceProfileV3>>,
): RackDevicePlacement | null {
  if (module.requestedHostId) {
    return hosts.find((host) => host.deviceId === module.requestedHostId) ?? null;
  }
  return hosts
    .filter((host) => {
      const hostRack = rack(profiles[host.profileId]);
      return hostRack?.family === moduleRack.family
        && (host.railId ?? null) === (module.railId ?? null)
        && host.xMm <= module.xMm;
    })
    .sort((left, right) => right.xMm - left.xMm || left.deviceId.localeCompare(right.deviceId))[0] ?? null;
}

/**
 * Assigns rack stages without mutating the workshop document. Explicit slots
 * win; remaining modules fill the lowest free stage by physical x-position.
 */
export function assignXgbRack(
  placements: readonly RackDevicePlacement[],
  profiles: Readonly<Record<string, DeviceProfileV3>>,
): RackLayoutResult {
  const issues: RackLayoutIssue[] = [];
  const assignments: Record<string, RackAssignment> = {};
  const hosts = placements.filter((placement) => rack(profiles[placement.profileId])?.role === 'host');
  const modules = placements.filter((placement) => rack(profiles[placement.profileId])?.role === 'module');

  for (const host of hosts) {
    const profile = profiles[host.profileId];
    const contract = rack(profile);
    if (!profile || !contract) continue;
    assignments[host.deviceId] = {
      deviceId: host.deviceId,
      hostDeviceId: host.deviceId,
      slot: 0,
      range: xgbSlotRange(0),
      specialBase: null,
      terminalAddresses: hostTerminalAddresses(profile, contract),
    };
  }

  const modulesByHost = new Map<string, RackDevicePlacement[]>();
  for (const module of modules) {
    const moduleRack = rack(profiles[module.profileId]);
    if (!moduleRack) continue;
    const host = matchingHost(module, moduleRack, hosts, profiles);
    if (!host) {
      issues.push(issue('RACK_HOST_NOT_FOUND', `${module.deviceId} has no compatible ${moduleRack.family} rack host on its rail.`, [module.deviceId]));
      continue;
    }
    const hostRack = rack(profiles[host.profileId]);
    if (!hostRack || hostRack.family !== moduleRack.family) {
      issues.push(issue('RACK_FAMILY_MISMATCH', `${module.deviceId} is incompatible with rack host ${host.deviceId}.`, [module.deviceId, host.deviceId]));
      continue;
    }
    const entries = modulesByHost.get(host.deviceId) ?? [];
    entries.push(module);
    modulesByHost.set(host.deviceId, entries);
  }

  for (const [hostDeviceId, attached] of modulesByHost) {
    const host = hosts.find((entry) => entry.deviceId === hostDeviceId);
    const hostRack = host ? rack(profiles[host.profileId]) : null;
    if (!host || !hostRack) continue;
    const maxSlot = hostRack.maxExpansionSlots ?? 0;
    const occupied = new Map<number, RackDevicePlacement>();
    const pending: RackDevicePlacement[] = [];

    for (const module of [...attached].sort((left, right) => left.xMm - right.xMm || left.deviceId.localeCompare(right.deviceId))) {
      const requested = module.requestedSlot;
      if (requested === undefined) {
        pending.push(module);
        continue;
      }
      if (!Number.isInteger(requested) || requested < 1 || requested > maxSlot) {
        issues.push(issue('RACK_SLOT_OUT_OF_RANGE', `${module.deviceId} requested slot ${requested}; ${hostDeviceId} supports 1-${maxSlot}.`, [module.deviceId, hostDeviceId]));
        continue;
      }
      const prior = occupied.get(requested);
      if (prior) {
        issues.push(issue('RACK_SLOT_DUPLICATE', `Rack ${hostDeviceId} slot ${requested} is assigned to both ${prior.deviceId} and ${module.deviceId}.`, [hostDeviceId, prior.deviceId, module.deviceId]));
        continue;
      }
      occupied.set(requested, module);
    }

    const freeSlots = Array.from({ length: maxSlot }, (_, index) => index + 1).filter((slot) => !occupied.has(slot));
    for (const module of pending) {
      const slot = freeSlots.shift();
      if (slot === undefined) {
        issues.push(issue('RACK_SLOT_OUT_OF_RANGE', `${module.deviceId} cannot be assigned because rack ${hostDeviceId} is full.`, [module.deviceId, hostDeviceId]));
        continue;
      }
      occupied.set(slot, module);
    }

    for (const [slot, module] of occupied) {
      const moduleRack = rack(profiles[module.profileId]);
      assignments[module.deviceId] = {
        deviceId: module.deviceId,
        hostDeviceId,
        slot,
        range: xgbSlotRange(slot),
        specialBase: moduleRack?.moduleClass === 'io' ? null : `U0.${slot}`,
        terminalAddresses: {},
      };
    }
  }

  return {
    assignments: Object.fromEntries(Object.entries(assignments).sort(([left], [right]) => left.localeCompare(right))),
    issues,
  };
}
