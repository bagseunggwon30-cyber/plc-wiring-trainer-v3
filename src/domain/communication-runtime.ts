import { buildCircuitGraph, terminalKey } from './graph';
import type { CircuitSolution } from './v3/contracts';
import type { DeviceProfile, WorkshopDocumentV2 } from './types';

interface Rs485PortContract {
  id: string;
  positiveTerminal: string;
  negativeTerminal: string;
  receivePositiveTerminal?: string;
  receiveNegativeTerminal?: string;
  requiresTwoWireBridge?: boolean;
  terminationSetting?: string;
  defaultTermination?: boolean;
}

interface Rs485LineSettings {
  protocol: string;
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
  stationId: number | null;
  mode: '2WIRE' | '4WIRE' | null;
  termination: boolean | null;
}

interface Rs485Endpoint {
  deviceId: string;
  profileId: string;
  port: Rs485PortContract;
  powered: boolean;
  settings: Rs485LineSettings | null;
  bridgeComplete: boolean;
  termination: boolean;
  terminationExplicit: boolean;
}

export interface SerialNetworkIssue {
  code:
    | 'RS485_BRIDGE_MISSING'
    | 'RS485_POLARITY_REVERSED'
    | 'RS485_PEER_MISSING'
    | 'RS485_SETTINGS_MISMATCH'
    | 'RS485_ADDRESS_REQUIRED'
    | 'RS485_ADDRESS_DUPLICATE'
    | 'RS485_MULTIPLE_MASTERS'
    | 'RS485_TERMINATION_REQUIRED'
    | 'RS485_TERMINATION_INVALID'
    | 'RS485_MODE_UNSUPPORTED';
  severity: 'function' | 'blocked';
  blocking: true;
  message: string;
  refs: string[];
}

export interface SerialNetworkAnalysis {
  devices: Readonly<Record<string, SerialDeviceState>>;
  issues: readonly SerialNetworkIssue[];
}

export interface SerialDeviceState {
  deviceId: string;
  profileId: string;
  portId: string;
  powered: boolean;
  communicationWired: boolean;
  polarityCorrect: boolean;
  protocolConfigured: boolean;
  settingsCompatible: boolean;
  bridgeComplete: boolean;
  terminationEnabled: boolean;
  peerDeviceId: string | null;
  communicationReady: boolean;
  status:
    | 'READY'
    | 'UNPOWERED'
    | 'COMMUNICATION_NOT_WIRED'
    | 'BRIDGE_MISSING'
    | 'POLARITY_REVERSED'
    | 'PROTOCOL_NOT_CONFIGURED'
    | 'SETTINGS_MISMATCH';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function communicationPorts(profile: DeviceProfile): Rs485PortContract[] {
  const behavior = record(profile.behavior);
  const ports = Array.isArray(behavior.communicationPorts) ? behavior.communicationPorts : [];
  return ports.flatMap((raw): Rs485PortContract[] => {
    const port = record(raw);
    return port.protocol === 'RS485'
      && typeof port.id === 'string'
      && typeof port.positiveTerminal === 'string'
      && typeof port.negativeTerminal === 'string'
      ? [{
          id: port.id,
          positiveTerminal: port.positiveTerminal,
          negativeTerminal: port.negativeTerminal,
          ...(typeof port.receivePositiveTerminal === 'string' ? { receivePositiveTerminal: port.receivePositiveTerminal } : {}),
          ...(typeof port.receiveNegativeTerminal === 'string' ? { receiveNegativeTerminal: port.receiveNegativeTerminal } : {}),
          ...(typeof port.requiresTwoWireBridge === 'boolean' ? { requiresTwoWireBridge: port.requiresTwoWireBridge } : {}),
          ...(typeof port.terminationSetting === 'string' ? { terminationSetting: port.terminationSetting } : {}),
          ...(typeof port.defaultTermination === 'boolean' ? { defaultTermination: port.defaultTermination } : {}),
        }]
      : [];
  });
}

const XBC_BUILT_IN_CNET_PROFILES = new Set([
  'ls-electric:xbc-dr32h',
  'ls-electric:xbc-dn32up',
  'ls-electric:xbc-dp32up',
]);

function fallbackPort(profileId: string): Rs485PortContract | null {
  if (XBC_BUILT_IN_CNET_PROFILES.has(profileId)) {
    return {
      id: 'BUILT_IN_CNET', positiveTerminal: '485+', negativeTerminal: '485-',
      terminationSetting: 'termination', defaultTermination: true,
    };
  }
  return null;
}

function selectedPort(
  profile: DeviceProfile,
  configuration: Readonly<Record<string, unknown>>,
): Rs485PortContract | null {
  const ports = communicationPorts(profile);
  const fallback = fallbackPort(profile.profileId);
  const selected = record(configuration.rs485).port;
  if (typeof selected === 'string') {
    return ports.find((port) => port.id === selected)
      ?? (fallback?.id === selected ? fallback : null);
  }
  return ports[0] ?? fallback;
}

function lineSettings(configuration: Readonly<Record<string, unknown>>): Rs485LineSettings | null {
  const settings = record(configuration.rs485);
  return typeof settings.protocol === 'string'
    && typeof settings.baudRate === 'number'
    && typeof settings.dataBits === 'number'
    && typeof settings.parity === 'string'
    && typeof settings.stopBits === 'number'
    ? {
        protocol: settings.protocol,
        baudRate: settings.baudRate,
        dataBits: settings.dataBits,
        parity: settings.parity,
        stopBits: settings.stopBits,
        stationId: typeof settings.stationId === 'number' && Number.isInteger(settings.stationId)
          ? settings.stationId
          : null,
        mode: settings.mode === '2WIRE' || settings.mode === '4WIRE' ? settings.mode : null,
        termination: typeof settings.termination === 'boolean' ? settings.termination : null,
      }
    : null;
}

function terminationEnabled(
  configuration: Readonly<Record<string, unknown>>,
  port: Rs485PortContract,
  settings: Rs485LineSettings | null,
): boolean {
  if (settings?.termination !== null && settings?.termination !== undefined) return settings.termination;
  const raw = record(configuration.rs485);
  const configured = port.terminationSetting ? raw[port.terminationSetting] : undefined;
  return typeof configured === 'boolean' ? configured : port.defaultTermination === true;
}

function hasExplicitTermination(
  configuration: Readonly<Record<string, unknown>>,
  port: Rs485PortContract,
  settings: Rs485LineSettings | null,
): boolean {
  if (settings?.termination !== null && settings?.termination !== undefined) return true;
  const raw = record(configuration.rs485);
  return port.terminationSetting !== undefined && typeof raw[port.terminationSetting] === 'boolean';
}

function effectiveConfiguration(
  document: WorkshopDocumentV2,
  deviceId: string,
  configuration: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const workflow = record(document.settings.v3Workflow);
  const workflowDevices = record(workflow.deviceSettings);
  const workflowDevice = record(workflowDevices[deviceId]);
  return {
    ...configuration,
    ...(Object.keys(record(workflowDevice.rs485)).length
      ? { rs485: { ...record(configuration.rs485), ...record(workflowDevice.rs485) } }
      : {}),
  };
}

function rackHostId(
  document: WorkshopDocumentV2,
  deviceId: string,
  configuration: Readonly<Record<string, unknown>>,
): string | null {
  const workflow = record(document.settings.v3Workflow);
  const workflowDevices = record(workflow.deviceSettings);
  const workflowDevice = record(workflowDevices[deviceId]);
  const explicit = typeof workflowDevice.rackHostId === 'string'
    ? workflowDevice.rackHostId
    : typeof configuration.rackHostId === 'string' ? configuration.rackHostId : null;
  if (explicit) return explicit;
  const candidates = document.devices.filter((device) => XBC_BUILT_IN_CNET_PROFILES.has(device.profileId));
  return candidates.length === 1 ? candidates[0].id : null;
}

function isPowered(
  document: WorkshopDocumentV2,
  deviceId: string,
  profile: DeviceProfile,
  configuration: Readonly<Record<string, unknown>>,
  solution: CircuitSolution,
): boolean {
  const behaviorKind = record(profile.behavior).kind;
  if (behaviorKind === 'dc-load-practice' || behaviorKind === 'modbus-practice') {
    return (solution.loads[`${deviceId}#supply`] ?? solution.loads[deviceId])?.state === 'ON';
  }
  if (XBC_BUILT_IN_CNET_PROFILES.has(profile.profileId)) {
    return solution.acLoads[`${deviceId}#ac-input`]?.energized === true;
  }
  if (behaviorKind === 'rack-communication-module') {
    const hostId = rackHostId(document, deviceId, configuration);
    return hostId !== null && solution.acLoads[`${hostId}#ac-input`]?.energized === true;
  }
  return true;
}

function sameProtocol(left: string, right: string): boolean {
  if (left === right) return true;
  const modbus = (value: string): boolean => value.startsWith('MODBUS_RTU_');
  return modbus(left) && modbus(right)
    && ((left.endsWith('_MASTER') && right.endsWith('_SLAVE'))
      || (left.endsWith('_SLAVE') && right.endsWith('_MASTER')));
}

function settingsMatch(left: Rs485LineSettings | null, right: Rs485LineSettings | null): boolean {
  return left !== null && right !== null
    && sameProtocol(left.protocol, right.protocol)
    && left.baudRate === right.baudRate
    && left.dataBits === right.dataBits
    && left.parity === right.parity
    && left.stopBits === right.stopBits;
}

/**
 * Resolves RS485 physical wiring separately from device power and protocol
 * configuration. A powered sensor with no A/B conductors is a valid
 * intermediate state, never a fabricated communication-ready result.
 */
export function analyzeSerialNetwork(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  solution: CircuitSolution,
): SerialNetworkAnalysis {
  const graph = buildCircuitGraph(document, catalog);
  const parent = new Map<string, string>();
  for (const key of graph.nodes.keys()) parent.set(key, key);
  const find = (key: string): string => {
    const current = parent.get(key);
    if (current === undefined) return key;
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const edge of graph.edges) if (edge.active) union(edge.from, edge.to);
  const joined = (left: string, right: string): boolean =>
    parent.has(left) && parent.has(right) && find(left) === find(right);

  const endpoints: Rs485Endpoint[] = [];
  for (const device of document.devices) {
    const profile = catalog[device.profileId];
    if (!profile) continue;
    const configuration = effectiveConfiguration(document, device.id, device.configuration);
    const port = selectedPort(profile, configuration);
    if (!port) continue;
    const settings = lineSettings(configuration);
    const mode = settings?.mode ?? '2WIRE';
    const needsBridge = port.requiresTwoWireBridge === true && mode === '2WIRE';
    const bridgeComplete = !needsBridge || (
      port.receivePositiveTerminal !== undefined
      && port.receiveNegativeTerminal !== undefined
      && joined(terminalKey(device.id, port.positiveTerminal), terminalKey(device.id, port.receivePositiveTerminal))
      && joined(terminalKey(device.id, port.negativeTerminal), terminalKey(device.id, port.receiveNegativeTerminal))
    );
    endpoints.push({
      deviceId: device.id,
      profileId: device.profileId,
      port,
      powered: isPowered(document, device.id, profile, configuration, solution),
      settings,
      bridgeComplete,
      termination: terminationEnabled(configuration, port, settings),
      terminationExplicit: hasExplicitTermination(configuration, port, settings),
    });
  }

  const states: Record<string, SerialDeviceState> = {};
  const issues: SerialNetworkIssue[] = [];
  const busKeyByDevice = new Map<string, string>();
  const endpointByDevice = new Map(endpoints.map((endpoint) => [endpoint.deviceId, endpoint]));
  const addIssue = (
    code: SerialNetworkIssue['code'],
    severity: SerialNetworkIssue['severity'],
    message: string,
    refs: string[],
  ): void => {
    const key = `${code}|${[...refs].sort().join('|')}`;
    if (!issues.some((entry) => `${entry.code}|${[...entry.refs].sort().join('|')}` === key)) {
      issues.push({ code, severity, blocking: true, message, refs });
    }
  };
  for (const endpoint of endpoints) {
    const positive = terminalKey(endpoint.deviceId, endpoint.port.positiveTerminal);
    const negative = terminalKey(endpoint.deviceId, endpoint.port.negativeTerminal);
    const peers = endpoints.filter((candidate) => candidate.deviceId !== endpoint.deviceId);
    const correctPeer = peers.find((candidate) =>
      joined(positive, terminalKey(candidate.deviceId, candidate.port.positiveTerminal))
      && joined(negative, terminalKey(candidate.deviceId, candidate.port.negativeTerminal)));
    const reversedPeer = peers.find((candidate) =>
      joined(positive, terminalKey(candidate.deviceId, candidate.port.negativeTerminal))
      && joined(negative, terminalKey(candidate.deviceId, candidate.port.positiveTerminal)));
    const peer = correctPeer ?? reversedPeer ?? null;
    const polarityCorrect = correctPeer !== undefined;
    const communicationWired = correctPeer !== undefined;
    const protocolConfigured = endpoint.settings !== null;
    const compatible = peer !== null && settingsMatch(endpoint.settings, peer.settings);
    const communicationReady = endpoint.powered
      && peer?.powered === true
      && communicationWired
      && protocolConfigured
      && compatible
      && endpoint.bridgeComplete
      && endpoint.settings?.mode !== '4WIRE';
    const status: SerialDeviceState['status'] = communicationReady
      ? 'READY'
      : !endpoint.powered
        ? 'UNPOWERED'
        : !endpoint.bridgeComplete
          ? 'BRIDGE_MISSING'
          : reversedPeer
            ? 'POLARITY_REVERSED'
            : !communicationWired
              ? 'COMMUNICATION_NOT_WIRED'
              : !protocolConfigured
                ? 'PROTOCOL_NOT_CONFIGURED'
                : 'SETTINGS_MISMATCH';
    states[endpoint.deviceId] = {
      deviceId: endpoint.deviceId,
      profileId: endpoint.profileId,
      portId: endpoint.port.id,
      powered: endpoint.powered,
      communicationWired,
      polarityCorrect,
      protocolConfigured,
      settingsCompatible: compatible,
      bridgeComplete: endpoint.bridgeComplete,
      terminationEnabled: endpoint.termination,
      peerDeviceId: peer?.deviceId ?? null,
      communicationReady,
      status,
    };
    const roots = [find(positive), find(negative)].sort();
    if (peer) busKeyByDevice.set(endpoint.deviceId, roots.join('|'));
    if (endpoint.settings && !endpoint.terminationExplicit) {
      addIssue('RS485_TERMINATION_REQUIRED', 'blocked', `${endpoint.deviceId} must explicitly record whether RS485 termination is applied.`, [endpoint.deviceId, endpoint.port.id]);
    }
    if (endpoint.settings && endpoint.settings.mode === '4WIRE') {
      addIssue('RS485_MODE_UNSUPPORTED', 'blocked', `${endpoint.deviceId} selects 4-wire mode, which is not solved by this prewire engine yet.`, [endpoint.deviceId, endpoint.port.id]);
    } else if (endpoint.settings && !endpoint.bridgeComplete) {
      addIssue('RS485_BRIDGE_MISSING', 'function', `${endpoint.deviceId} requires TX+/RX+ and TX-/RX- bridge jumpers for two-wire RS485.`, [endpoint.deviceId, endpoint.port.positiveTerminal, endpoint.port.negativeTerminal]);
    } else if (endpoint.settings && reversedPeer) {
      addIssue('RS485_POLARITY_REVERSED', 'function', `${endpoint.deviceId} RS485 positive and negative conductors are crossed.`, [endpoint.deviceId, reversedPeer.deviceId]);
    } else if (endpoint.settings && !peer) {
      addIssue('RS485_PEER_MISSING', 'function', `${endpoint.deviceId} has RS485 settings but no complete peer connection.`, [endpoint.deviceId, endpoint.port.id]);
    } else if (endpoint.settings && peer && !compatible) {
      addIssue('RS485_SETTINGS_MISMATCH', 'function', `${endpoint.deviceId} and ${peer.deviceId} use incompatible protocol or serial framing.`, [endpoint.deviceId, peer.deviceId]);
    }
  }

  const buses = new Map<string, Rs485Endpoint[]>();
  for (const [deviceId, key] of busKeyByDevice) {
    const endpoint = endpointByDevice.get(deviceId);
    if (!endpoint) continue;
    const entries = buses.get(key) ?? [];
    entries.push(endpoint);
    buses.set(key, entries);
  }
  for (const endpointsOnBus of buses.values()) {
    const configured = endpointsOnBus.filter((endpoint) => endpoint.settings !== null);
    if (configured.length < 2) continue;
    const refs = configured.map((endpoint) => endpoint.deviceId).sort();
    const masters = configured.filter((endpoint) => endpoint.settings?.protocol === 'MODBUS_RTU_MASTER');
    if (masters.length > 1) {
      addIssue('RS485_MULTIPLE_MASTERS', 'function', `RS485 bus has ${masters.length} Modbus RTU masters.`, masters.map((endpoint) => endpoint.deviceId));
    }
    const slaves = configured.filter((endpoint) => endpoint.settings?.protocol === 'MODBUS_RTU_SLAVE');
    const byAddress = new Map<number, Rs485Endpoint[]>();
    for (const slave of slaves) {
      const address = slave.settings?.stationId;
      if (address === null || address === undefined || address < 1 || address > 247) {
        addIssue('RS485_ADDRESS_REQUIRED', 'function', `${slave.deviceId} requires a Modbus slave address from 1 to 247.`, [slave.deviceId]);
        continue;
      }
      const entries = byAddress.get(address) ?? [];
      entries.push(slave);
      byAddress.set(address, entries);
    }
    for (const [address, entries] of byAddress) {
      if (entries.length > 1) {
        addIssue('RS485_ADDRESS_DUPLICATE', 'function', `Modbus slave address ${address} is used by multiple devices.`, entries.map((endpoint) => endpoint.deviceId));
      }
    }
    const terminated = configured.filter((endpoint) => endpoint.termination);
    if (configured.every((endpoint) => endpoint.terminationExplicit) && terminated.length !== 2) {
      addIssue('RS485_TERMINATION_INVALID', 'function', `RS485 bus requires exactly two enabled terminators; found ${terminated.length}.`, refs);
    }
  }

  const failedDevices = new Set(issues.flatMap((entry) => entry.refs.filter((ref) => states[ref] !== undefined)));
  for (const deviceId of failedDevices) {
    const state = states[deviceId];
    if (state?.communicationReady) states[deviceId] = { ...state, communicationReady: false, status: 'SETTINGS_MISMATCH' };
  }
  return { devices: states, issues };
}

export function analyzeSerialDeviceStates(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  solution: CircuitSolution,
): Readonly<Record<string, SerialDeviceState>> {
  return analyzeSerialNetwork(document, catalog, solution).devices;
}
