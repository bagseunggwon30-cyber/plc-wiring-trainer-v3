import type { ValidationIssue } from '../engine-types';
import type {
  MissionDefinitionV2,
  MissionExpectedState,
  MissionRuntimeTemplate,
  MissionScenarioDefinition,
} from '../missions';
import { buildCircuitModel, simulateScenario, solveCircuit } from './circuit';
import type { ScenarioSimulationV3, SimulationScenarioV3, WorkshopDocumentV3 } from './contracts';

export interface MissionConnectionSetResultV3 {
  id: string;
  complete: boolean;
  missingLabels: readonly string[];
}

export interface MissionEvaluationV3 {
  issues: readonly ValidationIssue[];
  connectionSets: readonly MissionConnectionSetResultV3[];
  simulations: readonly ScenarioSimulationV3[];
}

function validationIssue(
  code: string,
  message: string,
  refs: readonly string[],
  severity: ValidationIssue['severity'] = 'function',
): ValidationIssue {
  return { code, message, refs: [...refs], severity, blocking: true };
}

function terminalKey(deviceId: string, terminalId: string): string {
  return `${deviceId}:${terminalId}`;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveBindings(
  mission: MissionDefinitionV2,
  document: WorkshopDocumentV3,
  bindings: Readonly<Record<string, string>>,
): { resolved: Record<string, string>; issues: ValidationIssue[] } {
  const resolved: Record<string, string> = {};
  const issues: ValidationIssue[] = [];
  const deviceById = new Map((document.deviceInstances ?? []).map((device) => [device.id, device]));
  const seenDevices = new Set<string>();
  for (const role of mission.roles) {
    const deviceId = bindings[role.id];
    if (!deviceId) {
      issues.push(validationIssue('MISSING_ROLE_BINDING', `${mission.title}: ${role.label} 장비를 직접 지정해야 합니다.`, [role.id], 'blocked'));
      continue;
    }
    const device = deviceById.get(deviceId);
    if (!device) {
      issues.push(validationIssue('BOUND_DEVICE_NOT_FOUND', `${role.label}에 지정한 ${deviceId} 장비가 문서에 없습니다.`, [role.id, deviceId], 'blocked'));
      continue;
    }
    if (!role.allowedProfileIds.includes(device.profileId)) {
      issues.push(validationIssue('ROLE_PROFILE_MISMATCH', `${deviceId}의 프로필은 ${role.label} 역할에 사용할 수 없습니다.`, [role.id, deviceId], 'blocked'));
      continue;
    }
    if (seenDevices.has(deviceId)) {
      issues.push(validationIssue('DUPLICATE_DEVICE_BINDING', `${deviceId}가 둘 이상의 미션 역할에 중복 지정됐습니다.`, [deviceId], 'blocked'));
      continue;
    }
    seenDevices.add(deviceId);
    resolved[role.id] = deviceId;
  }
  return { resolved, issues };
}

function contactStatesForTemplate(
  target: Record<string, boolean>,
  forcedByDevice: Map<string, Set<string>>,
  template: MissionRuntimeTemplate,
  bindings: Readonly<Record<string, string>>,
): void {
  for (const contact of template.contactStates ?? []) {
    const deviceId = bindings[contact.role];
    if (deviceId) target[`${deviceId}:${contact.stateKey}`] = contact.closed;
  }
  for (const output of template.forcedOutputs ?? []) {
    const deviceId = bindings[output.role];
    if (deviceId) forcedByDevice.set(deviceId, new Set(output.terminalIds));
  }
}

function scenarioFor(
  mission: MissionDefinitionV2,
  scenario: MissionScenarioDefinition,
  document: WorkshopDocumentV3,
  bindings: Readonly<Record<string, string>>,
): SimulationScenarioV3 {
  const contactStates: Record<string, boolean> = {};
  const forcedByDevice = new Map<string, Set<string>>();
  contactStatesForTemplate(contactStates, forcedByDevice, mission.initialState, bindings);
  contactStatesForTemplate(contactStates, forcedByDevice, scenario, bindings);
  for (const element of document.elements) {
    if (element.kind !== 'contact') continue;
    const separator = element.stateKey.lastIndexOf(':');
    const deviceId = separator > 0 ? element.stateKey.slice(0, separator) : '';
    const terminalId = separator > 0 ? element.stateKey.slice(separator + 1) : '';
    const forced = forcedByDevice.get(deviceId);
    if (forced) contactStates[element.stateKey] = forced.has(terminalId);
  }
  const contactRules = (scenario.contactRules ?? []).map((rule) => {
    const stateDeviceId = bindings[rule.state.role];
    const senseDeviceId = bindings[rule.sense.role];
    const stateKey = stateDeviceId
      ? `${stateDeviceId}:${rule.state.stateKey}`
      : `invalid-target:${rule.state.role}:${rule.state.stateKey}`;
    const inputElementId = senseDeviceId
      ? `${senseDeviceId}#${rule.sense.terminalId}`
      : `invalid-sense:${rule.sense.role}:${rule.sense.terminalId}`;
    const senseElementId = document.elements.some((element) => element.kind === 'load' && element.id === inputElementId)
      ? inputElementId
      : senseDeviceId && document.elements.some((element) => element.kind === 'load' && element.id === senseDeviceId)
        ? senseDeviceId
        : inputElementId;
    return {
      stateKey,
      senseElementId,
      mode: rule.mode,
    };
  });
  return { id: scenario.id, contactStates, contactRules };
}

function protocolState(
  expected: MissionExpectedState,
  deviceId: string,
  document: WorkshopDocumentV3,
): string | null {
  const terminalId = expected.target.terminalId;
  const device = document.deviceInstances?.find((entry) => entry.id === deviceId);
  if (!device) return null;
  if (device.profileId === 'ls-electric:xbf-ah04a') {
    const channelId = terminalId.startsWith('I0') ? 'AI0'
      : terminalId.startsWith('I1') ? 'AI1'
        : terminalId.startsWith('O0') ? 'AO0'
          : terminalId.startsWith('O1') ? 'AO1'
            : null;
    if (!channelId) return null;
    const channel = record(record(device.configuration.xbfChannels)[channelId]);
    const selector = channel.selector;
    const parameterRange = channel.parameterRange;
    if (channel.enabled !== true || (selector !== 'V' && selector !== 'I') || typeof parameterRange !== 'string') return null;
    const voltage = parameterRange.endsWith('V');
    if ((selector === 'V') !== voltage) return null;
    return voltage ? 'analog-voltage' : 'analog-current';
  }
  if (device.profileId === 'generic:xy-md02') {
    if (terminalId === 'A+') return 'RS485-A';
    if (terminalId === 'B-') return 'RS485-B';
  }
  return null;
}

function expectedActualValue(
  expected: MissionExpectedState,
  simulation: ScenarioSimulationV3,
  document: WorkshopDocumentV3,
  bindings: Readonly<Record<string, string>>,
): boolean | string | null {
  const deviceId = bindings[expected.target.role];
  if (!deviceId) return null;
  const terminalId = expected.target.terminalId;
  if (expected.kind === 'input') return simulation.solution.loads[`${deviceId}#${terminalId}`]?.state === 'ON';
  if (expected.kind === 'output') return simulation.contactStates[`${deviceId}:${terminalId}`] ?? false;
  if (expected.kind === 'contact') return simulation.contactStates[`${deviceId}:contact`] ?? false;
  if (expected.kind === 'protocol') return protocolState(expected, deviceId, document);
  if (expected.kind === 'operating-mode') {
    const model = buildCircuitModel(document, simulation.contactStates);
    const component = (terminal: string): string | undefined => model.netGraph.componentOf.get(terminalKey(deviceId, terminal));
    const common = component('CM');
    const forward = common !== undefined && common === component('P1');
    const reverse = common !== undefined && common === component('P2');
    return forward && reverse ? 'forward-reverse-conflict' : forward ? 'forward-command' : reverse ? 'reverse-command' : 'stopped';
  }
  const directLoad = simulation.solution.loads[deviceId];
  if (directLoad) return directLoad.state === 'ON';
  const inputLoad = simulation.solution.loads[`${deviceId}#${terminalId}`];
  if (inputLoad) return inputLoad.state === 'ON';
  return simulation.solution.energizedTerminals.includes(terminalKey(deviceId, terminalId));
}

/** Evaluates the public mission against the same v3 net/branch model used by validation. */
export function evaluateMissionV3(
  mission: MissionDefinitionV2,
  document: WorkshopDocumentV3,
  bindings: Readonly<Record<string, string>>,
): MissionEvaluationV3 {
  const prepared = resolveBindings(mission, document, bindings);
  if (prepared.issues.length) return { issues: prepared.issues, connectionSets: [], simulations: [] };

  const baseModel = buildCircuitModel(document);
  const continuityGroups = solveCircuit(baseModel).continuityGroups;
  const connectionSets = mission.expectedConnections.map((set) => {
    const missingLabels = set.connections.flatMap((connection) => {
      const fromDevice = prepared.resolved[connection.from.role];
      const toDevice = prepared.resolved[connection.to.role];
      const from = fromDevice && terminalKey(fromDevice, connection.from.terminalId);
      const to = toDevice && terminalKey(toDevice, connection.to.terminalId);
      const connected = from && to
        && continuityGroups[from] !== undefined
        && continuityGroups[from] === continuityGroups[to];
      return connected ? [] : [connection.label];
    });
    return { id: set.id, complete: missingLabels.length === 0, missingLabels };
  });
  const connectionComplete = mission.connectionPolicy === 'one-of'
    ? connectionSets.some((set) => set.complete)
    : connectionSets.every((set) => set.complete);
  const issues: ValidationIssue[] = [];
  if (!connectionComplete) {
    issues.push(validationIssue(
      'MISSION_CONNECTION_MISSING',
      `${mission.title}: 필수 핀투핀 연결이 완성되지 않았습니다 (${connectionSets.flatMap((set) => set.missingLabels).join(', ')}).`,
      Object.values(prepared.resolved),
    ));
  }

  const simulations = mission.scenarios.map((scenario) => simulateScenario(
    document,
    scenarioFor(mission, scenario, document, prepared.resolved),
  ));
  const expectedByScenario = new Map<string, MissionExpectedState[]>();
  for (const expected of mission.expectedStates) {
    const values = expectedByScenario.get(expected.scenarioId) ?? [];
    values.push(expected);
    expectedByScenario.set(expected.scenarioId, values);
    const simulation = simulations.find((entry) => entry.scenarioId === expected.scenarioId);
    if (!simulation || expectedActualValue(expected, simulation, document, prepared.resolved) !== expected.expected) {
      const deviceId = prepared.resolved[expected.target.role] ?? expected.target.role;
      issues.push(validationIssue(
        'MISSION_STATE_MISMATCH',
        `${mission.title}: ${expected.scenarioId}에서 ${expected.target.role}.${expected.target.terminalId}의 예상 상태 ${String(expected.expected)}를 확인하지 못했습니다.`,
        [terminalKey(deviceId, expected.target.terminalId), expected.scenarioId],
      ));
    }
  }
  for (const simulation of simulations) {
    const expected = expectedByScenario.get(simulation.scenarioId) ?? [];
    const requiredOnLoadIds = new Set(expected.flatMap((state) => {
      const deviceId = prepared.resolved[state.target.role];
      return state.kind === 'energized' && state.expected === true && simulation.solution.loads[deviceId]
        ? [deviceId]
        : [];
    }));
    const scenarioControlledLoadIds = new Set(document.elements.flatMap((element) =>
      element.kind === 'load' && element.required === 'scenario' ? [element.id] : []));
    for (const electricalIssue of simulation.solution.issues) {
      const openLoadId = electricalIssue.refs
        .map((ref) => ref.slice(0, ref.indexOf(':')))
        .find((elementId) => scenarioControlledLoadIds.has(elementId));
      if (openLoadId && !requiredOnLoadIds.has(openLoadId)
        && (electricalIssue.code === 'OPEN_SOURCE_PATH' || electricalIssue.code === 'OPEN_RETURN_PATH')) continue;
      if (issues.some((entry) => entry.code === electricalIssue.code && entry.refs.join('|') === electricalIssue.refs.join('|'))) continue;
      issues.push(validationIssue(
        electricalIssue.code,
        `${simulation.scenarioId}: ${electricalIssue.message}`,
        electricalIssue.refs,
        electricalIssue.code === 'NON_CONVERGENT_SIMULATION'
          ? 'blocked'
          : electricalIssue.code === 'DC_SHORT' || electricalIssue.code === 'CURRENT_LOOP_POLARITY_REVERSED'
            ? 'danger'
            : 'function',
      ));
    }
  }
  return { issues, connectionSets, simulations };
}
