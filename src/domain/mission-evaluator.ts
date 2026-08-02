import { resolvePower } from './electrical';
import type { SimulationResult, ValidationIssue, ValidationResult } from './engine-types';
import { buildCircuitGraph, terminalKey } from './graph';
import { effectiveTerminalProtocol } from './terminal-configuration';
import {
  prepareMissionEvaluation,
  type MissionConnectionSet,
  type MissionDefinitionV2,
  type MissionExpectedState,
  type MissionForbiddenState,
  type MissionPreparationResult,
  type RoleBinding,
} from './missions';
import { simulateScenario, validateWorkshopScenarios } from './simulator';
import type { DeviceProfile, VerificationStatus, WorkshopDocumentV2 } from './types';

export interface MissionConnectionSetResult {
  id: string;
  passed: boolean;
  missingLabels: string[];
  missingRefs: string[];
}

export interface MissionEvaluationResult {
  status: VerificationStatus;
  completed: boolean;
  issues: ValidationIssue[];
  preparation: MissionPreparationResult;
  validation: ValidationResult | null;
  simulations: SimulationResult[];
  connectionSets: MissionConnectionSetResult[];
}

function functionIssue(code: string, message: string, refs: string[], scenarioId?: string): ValidationIssue {
  return { code, severity: 'function', blocking: true, message, refs, scenarioId };
}

function evaluateConnectionSet(
  set: MissionConnectionSet,
  bindings: Readonly<Record<string, string>>,
  componentOf: ReadonlyMap<string, string>,
): MissionConnectionSetResult {
  const missingLabels = set.connections.filter((connection) => {
    const from = terminalKey(bindings[connection.from.role], connection.from.terminalId);
    const to = terminalKey(bindings[connection.to.role], connection.to.terminalId);
    return !componentOf.has(from) || componentOf.get(from) !== componentOf.get(to);
  }).map((connection) => connection.label);
  const missingRefs = set.connections.flatMap((connection) => {
    const from = terminalKey(bindings[connection.from.role], connection.from.terminalId);
    const to = terminalKey(bindings[connection.to.role], connection.to.terminalId);
    if (componentOf.has(from) && componentOf.get(from) === componentOf.get(to)) return [];
    return [from, to];
  });
  return {
    id: set.id,
    passed: missingLabels.length === 0,
    missingLabels,
    missingRefs: [...new Set(missingRefs)],
  };
}

const VALIDATOR_FORBIDDEN_CODES = new Set([
  'AC_PHASE_NEUTRAL_SHORT',
  'PE_MIXED',
  'DC_SHORT',
  'PARALLEL_SOURCE',
  'UNKNOWN_FORCED_OUTPUT',
  'ANALOG_MODE_MISMATCH',
  'CURRENT_LOOP_POLARITY_REVERSED',
  'CURRENT_LOOP_RETURN_PATH_OPEN',
  'RS485_POLARITY_MISMATCH',
]);

export const SUPPORTED_FORBIDDEN_STATE_CODES = Object.freeze([
  ...VALIDATOR_FORBIDDEN_CODES,
  'UNPOWERED_SOURCE_OUTPUT',
  'INPUT_COMMON_POLARITY',
  'OUTPUT_ON_WHEN_OFF',
  'NC_TERMINAL_USED',
  'FORWARD_REVERSE_SIMULTANEOUS',
  'EXTERNAL_SUPPLY_VARIANT_UNKNOWN',
  'UNVERIFIED_PROFILE',
  'BYPASSED_TERMINAL_BLOCK',
  'STOP_CONTACT_BYPASSED',
]);

function isConnectedWithoutDevices(
  graph: ReturnType<typeof buildCircuitGraph>,
  from: string,
  to: string,
  excludedDeviceIds: ReadonlySet<string>,
): boolean {
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return false;
  const excluded = (key: string): boolean => excludedDeviceIds.has(graph.nodes.get(key)?.deviceId ?? '');
  if (excluded(from) || excluded(to)) return false;
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!edge.active || excluded(edge.from) || excluded(edge.to)) continue;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
  }
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []).filter((next) => !visited.has(next)));
  }
  return false;
}

function directWireBetween(
  document: WorkshopDocumentV2,
  leftDeviceId: string,
  rightDeviceIds: ReadonlySet<string>,
): string[] {
  return document.wires.filter((wire) => (
    wire.from.deviceId === leftDeviceId && rightDeviceIds.has(wire.to.deviceId)
  ) || (
    wire.to.deviceId === leftDeviceId && rightDeviceIds.has(wire.from.deviceId)
  )).map((wire) => wire.id);
}

function terminalIsPhysicallyUsed(document: WorkshopDocumentV2, key: string): string[] {
  const separator = key.indexOf(':');
  const deviceId = key.slice(0, separator);
  const terminalId = key.slice(separator + 1);
  const wireIds = document.wires.filter((wire) => (
    wire.from.deviceId === deviceId && wire.from.terminalId === terminalId
  ) || (
    wire.to.deviceId === deviceId && wire.to.terminalId === terminalId
  )).map((wire) => wire.id);
  const jumperIds = document.jumpers.filter((jumper) => (
    jumper.deviceId === deviceId && jumper.terminalIds.includes(terminalId)
  )).map((jumper) => jumper.id);
  return [...wireIds, ...jumperIds];
}

function customForbiddenViolation(
  state: MissionForbiddenState,
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  preparation: MissionPreparationResult,
  simulations: readonly SimulationResult[],
): string[] | null {
  const boundTerminal = (role: string, terminalId: string): string =>
    terminalKey(preparation.bindings[role], terminalId);
  const scenarioPower = (index: number) => {
    const graph = buildCircuitGraph(document, catalog, preparation.scenarios[index]);
    return { graph, power: resolvePower(document, catalog, graph) };
  };

  switch (state.code) {
    case 'UNPOWERED_SOURCE_OUTPUT': {
      const deviceId = preparation.bindings.powerSupply;
      if (!deviceId) return null;
      for (let index = 0; index < preparation.scenarios.length; index += 1) {
        const { power } = scenarioPower(index);
        const outputs = ['V+1', 'V+2', 'V-1', 'V-2'].map((terminalId) => terminalKey(deviceId, terminalId));
        if (!power.activeDevices.has(deviceId) && outputs.some((key) => power.energizedTerminals.has(key))) return outputs;
      }
      return null;
    }
    case 'INPUT_COMMON_POLARITY': {
      const deviceId = preparation.bindings.plc;
      if (!deviceId) return null;
      for (let index = 0; index < preparation.scenarios.length; index += 1) {
        const { power } = scenarioPower(index);
        const input = terminalKey(deviceId, 'P00');
        const common = terminalKey(deviceId, 'COMI');
        if (power.componentOf.get(input) === power.componentOf.get(common)) return [input, common];
      }
      return null;
    }
    case 'OUTPUT_ON_WHEN_OFF': {
      const offIndex = preparation.scenarios.findIndex((scenario) =>
        (scenario.forcedOutputs?.[preparation.bindings.plc] ?? []).length === 0);
      const load = preparation.bindings.load;
      const key = load ? terminalKey(load, '+') : '';
      return offIndex >= 0 && key && simulations[offIndex]?.energizedTerminals.includes(key) ? [key] : null;
    }
    case 'NC_TERMINAL_USED': {
      const keys = (state.refs ?? []).map((ref) => boundTerminal(ref.role, ref.terminalId));
      const connections = keys.flatMap((key) => terminalIsPhysicallyUsed(document, key));
      return connections.length ? [...keys, ...connections] : null;
    }
    case 'FORWARD_REVERSE_SIMULTANEOUS': {
      const drive = preparation.bindings.drive;
      if (!drive) return null;
      for (let index = 0; index < preparation.scenarios.length; index += 1) {
        const { power } = scenarioPower(index);
        const common = power.componentOf.get(terminalKey(drive, 'CM'));
        if (
          common !== undefined
          && power.componentOf.get(terminalKey(drive, 'P1')) === common
          && power.componentOf.get(terminalKey(drive, 'P2')) === common
        ) return [terminalKey(drive, 'CM'), terminalKey(drive, 'P1'), terminalKey(drive, 'P2')];
      }
      return null;
    }
    case 'EXTERNAL_SUPPLY_VARIANT_UNKNOWN': {
      const drive = document.devices.find((device) => device.id === preparation.bindings.drive);
      return document.mode === 'prewire' && drive?.evidenceLevel === 'educational' ? [drive.id] : null;
    }
    case 'UNVERIFIED_PROFILE': {
      const unverified = document.devices.filter((device) => {
        const profile = catalog[device.profileId];
        return !profile?.boundary && (device.evidenceLevel === 'educational' || profile?.evidence.level === 'educational');
      });
      return document.mode === 'prewire' && unverified.length ? unverified.map((device) => device.id) : null;
    }
    case 'BYPASSED_TERMINAL_BLOCK': {
      const plc = preparation.bindings.plc;
      if (!plc) return null;
      const doorDevices = new Set(['startPb', 'stopPb', 'doorLamp']
        .map((role) => preparation.bindings[role]).filter(Boolean));
      const wires = directWireBetween(document, plc, doorDevices);
      return wires.length ? [plc, ...doorDevices, ...wires] : null;
    }
    case 'STOP_CONTACT_BYPASSED': {
      const dcSupply = preparation.bindings.dcSupply;
      const startPb = preparation.bindings.startPb;
      const stopPb = preparation.bindings.stopPb;
      if (!dcSupply || !startPb || !stopPb) return null;
      const scenarioIndex = Math.max(0, preparation.scenarios.findIndex((scenario) => scenario.id === 'start-pressed'));
      const { graph } = scenarioPower(scenarioIndex);
      const source = terminalKey(dcSupply, '+');
      const targets = [terminalKey(startPb, 'A'), preparation.bindings.plc && terminalKey(preparation.bindings.plc, 'P00')].filter(Boolean) as string[];
      return targets.some((target) => isConnectedWithoutDevices(graph, source, target, new Set([stopPb])))
        ? [source, ...targets, stopPb]
        : null;
    }
    default:
      return null;
  }
}

function expectedProtocol(
  state: MissionExpectedState,
  bindings: Readonly<Record<string, string>>,
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): string | null {
  const deviceId = bindings[state.target.role];
  const instance = document.devices.find((device) => device.id === deviceId);
  const terminal = instance && catalog[instance.profileId]?.terminals.find((entry) => entry.id === state.target.terminalId);
  if (!instance || !terminal) return null;
  const protocol = effectiveTerminalProtocol(document, instance, terminal);
  if (!protocol) return null;
  return protocol === 'RS485' && terminal.channel ? `RS485-${terminal.channel}` : protocol;
}

function operatingModeMatches(
  state: MissionExpectedState,
  scenario: MissionPreparationResult['scenarios'][number],
  bindings: Readonly<Record<string, string>>,
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): boolean {
  const deviceId = bindings[state.target.role];
  const graph = buildCircuitGraph(document, catalog, scenario);
  const components = resolvePower(document, catalog, graph).componentOf;
  const common = components.get(terminalKey(deviceId, 'CM'));
  const p1Closed = common !== undefined && components.get(terminalKey(deviceId, 'P1')) === common;
  const p2Closed = common !== undefined && components.get(terminalKey(deviceId, 'P2')) === common;
  if (state.expected === 'stopped') return !p1Closed && !p2Closed;
  if (state.expected === 'forward-command') return p1Closed && !p2Closed;
  if (state.expected === 'reverse-command') return p2Closed && !p1Closed;
  return false;
}

function stateMatches(
  state: MissionExpectedState,
  simulation: SimulationResult,
  scenario: MissionPreparationResult['scenarios'][number],
  bindings: Readonly<Record<string, string>>,
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
): boolean {
  const deviceId = bindings[state.target.role];
  const key = terminalKey(deviceId, state.target.terminalId);
  switch (state.kind) {
    case 'energized': return simulation.energizedTerminals.includes(key) === state.expected;
    case 'input': return simulation.inputStates[deviceId]?.[state.target.terminalId] === state.expected;
    case 'output': return simulation.outputStates[deviceId]?.[state.target.terminalId] === state.expected;
    case 'protocol': return expectedProtocol(state, bindings, document, catalog) === state.expected;
    case 'operating-mode': return operatingModeMatches(state, scenario, bindings, document, catalog);
    case 'contact': return scenario.contactStates?.[key] === state.expected;
    default: return false;
  }
}

function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...new Map(issues.map((issue) => [
    `${issue.scenarioId ?? 'default'}:${issue.code}:${[...issue.refs].sort().join('|')}:${issue.message}`,
    issue,
  ])).values()];
}

export async function evaluateMission(
  definition: MissionDefinitionV2,
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  suppliedBindings: readonly RoleBinding[],
): Promise<MissionEvaluationResult> {
  const preparation = prepareMissionEvaluation(definition, document, catalog, suppliedBindings);
  if (preparation.status === 'BLOCKED') {
    return {
      status: 'BLOCKED', completed: false, issues: preparation.issues, preparation,
      validation: null, simulations: [], connectionSets: [],
    };
  }

  const baseGraph = buildCircuitGraph(document, catalog);
  const componentOf = resolvePower(document, catalog, baseGraph).componentOf;
  const connectionSets = definition.expectedConnections.map((set) =>
    evaluateConnectionSet(set, preparation.bindings, componentOf));
  const connectionPass = definition.connectionPolicy === 'one-of'
    ? connectionSets.some((set) => set.passed)
    : connectionSets.every((set) => set.passed);
  const missionIssues: ValidationIssue[] = [];
  if (!connectionPass) {
    const failedSets = connectionSets.filter((set) => !set.passed);
    missionIssues.push(functionIssue(
      'MISSION_CONNECTION_MISSING',
      `Required mission connections are incomplete: ${failedSets.flatMap((set) => set.missingLabels).join(', ')}`,
      [...new Set(failedSets.flatMap((set) => set.missingRefs))],
    ));
  }

  const simulations = await Promise.all(
    preparation.scenarios.map((scenario) => simulateScenario(document, catalog, scenario)),
  );
  const simulationById = new Map(simulations.map((simulation) => [simulation.validation.issues[0]?.scenarioId, simulation]));
  for (const [index, scenario] of preparation.scenarios.entries()) simulationById.set(scenario.id, simulations[index]);

  for (const state of definition.expectedStates) {
    const simulation = simulationById.get(state.scenarioId);
    const scenario = preparation.scenarios.find((entry) => entry.id === state.scenarioId);
    if (!simulation || !scenario || !stateMatches(state, simulation, scenario, preparation.bindings, document, catalog)) {
      const deviceId = preparation.bindings[state.target.role];
      missionIssues.push(functionIssue(
        'MISSION_STATE_MISMATCH',
        `${state.scenarioId} did not produce ${state.target.role}.${state.target.terminalId} = ${String(state.expected)}.`,
        [terminalKey(deviceId, state.target.terminalId)],
        state.scenarioId,
      ));
    }
  }

  const validation = await validateWorkshopScenarios(document, catalog, preparation.scenarios);
  const supportedCodes = new Set<string>(SUPPORTED_FORBIDDEN_STATE_CODES);
  for (const state of definition.forbiddenStates) {
    if (validation.issues.some((issue) => issue.code === state.code)) continue;
    if (!supportedCodes.has(state.code)) {
      missionIssues.push({
        code: 'UNSUPPORTED_FORBIDDEN_RULE', severity: 'blocked', blocking: true,
        message: `Mission rule ${state.code} has no deterministic evaluator.`, refs: [definition.id],
      });
      continue;
    }
    if (VALIDATOR_FORBIDDEN_CODES.has(state.code)) continue;
    const refs = customForbiddenViolation(state, document, catalog, preparation, simulations);
    if (refs) missionIssues.push(functionIssue(state.code, state.description, refs));
  }
  const issues = deduplicateIssues([...validation.issues, ...missionIssues]);
  const status: VerificationStatus = validation.status === 'BLOCKED'
    ? 'BLOCKED'
    : validation.status === 'FAIL' || missionIssues.some((issue) => issue.blocking)
      ? 'FAIL'
      : 'PASS';
  return {
    status,
    completed: status === 'PASS',
    issues,
    preparation,
    validation: { ...validation, status, issues },
    simulations,
    connectionSets,
  };
}
