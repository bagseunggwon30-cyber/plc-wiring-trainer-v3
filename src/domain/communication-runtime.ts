import { buildCircuitGraph, terminalKey } from './graph';
import type { CircuitSolution } from './v3/contracts';
import type { DeviceProfile, WorkshopDocumentV2 } from './types';

interface Rs485PortContract {
  id: string;
  positiveTerminal: string;
  negativeTerminal: string;
}

interface Rs485LineSettings {
  protocol: string;
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
}

interface Rs485Endpoint {
  deviceId: string;
  profileId: string;
  port: Rs485PortContract;
  powered: boolean;
  settings: Rs485LineSettings | null;
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
  peerDeviceId: string | null;
  communicationReady: boolean;
  status:
    | 'READY'
    | 'UNPOWERED'
    | 'COMMUNICATION_NOT_WIRED'
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
      ? [{ id: port.id, positiveTerminal: port.positiveTerminal, negativeTerminal: port.negativeTerminal }]
      : [];
  });
}

function fallbackPort(profileId: string): Rs485PortContract | null {
  if (profileId === 'ls-electric:xbc-dr32h') {
    return { id: 'BUILT_IN_CNET', positiveTerminal: '485+', negativeTerminal: '485-' };
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
      }
    : null;
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

function isPowered(deviceId: string, profile: DeviceProfile, solution: CircuitSolution): boolean {
  const behaviorKind = record(profile.behavior).kind;
  if (behaviorKind === 'dc-load-practice' || behaviorKind === 'modbus-practice') {
    return (solution.loads[`${deviceId}#supply`] ?? solution.loads[deviceId])?.state === 'ON';
  }
  if (profile.profileId === 'ls-electric:xbc-dr32h') {
    return solution.acLoads[`${deviceId}#ac-input`]?.energized === true;
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
export function analyzeSerialDeviceStates(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  solution: CircuitSolution,
): Readonly<Record<string, SerialDeviceState>> {
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
    endpoints.push({
      deviceId: device.id,
      profileId: device.profileId,
      port,
      powered: isPowered(device.id, profile, solution),
      settings: lineSettings(configuration),
    });
  }

  const states: Record<string, SerialDeviceState> = {};
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
      && compatible;
    const status: SerialDeviceState['status'] = communicationReady
      ? 'READY'
      : !endpoint.powered
        ? 'UNPOWERED'
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
      peerDeviceId: peer?.deviceId ?? null,
      communicationReady,
      status,
    };
  }
  return states;
}
