import type { DeviceProfile, WorkshopDocumentV2 } from './types';
import type { PowerResolution, SimulationResult, SimulationScenario, ValidationIssue, ValidationResult } from './engine-types';
import { resolvePower, terminalPotentials } from './electrical';
import { buildCircuitGraph, terminalKey } from './graph';
import { sha256 } from './migration';
import { validateWorkshop } from './validator';

const stateSignature = (states: Record<string, boolean>): string =>
  Object.entries(states).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}:${value ? 1 : 0}`).join('|');

function plcStates(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  power: PowerResolution,
  scenario: SimulationScenario,
): Pick<SimulationResult, 'inputStates' | 'outputStates'> {
  const inputStates: Record<string, Record<string, boolean>> = {};
  const outputStates: Record<string, Record<string, boolean>> = {};
  for (const instance of document.devices) {
    const profile = catalog[instance.profileId];
    if (profile?.behavior?.kind !== 'plc-relay') continue;
    const common = terminalPotentials(terminalKey(instance.id, 'COMI'), power);
    inputStates[instance.id] = {};
    for (const terminal of profile.terminals.filter((entry) => entry.role === 'input')) {
      const signal = terminalPotentials(terminalKey(instance.id, terminal.id), power);
      inputStates[instance.id][terminal.id] =
        (signal.has('+24V') && common.has('0V')) || (signal.has('0V') && common.has('+24V'));
    }
    outputStates[instance.id] = {};
    for (const terminal of profile.terminals.filter((entry) => entry.role === 'output')) {
      outputStates[instance.id][terminal.id] = (scenario.forcedOutputs?.[instance.id] ?? []).includes(terminal.id);
    }
  }
  return { inputStates, outputStates };
}

export async function simulateScenario(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  scenario: SimulationScenario,
): Promise<SimulationResult> {
  let contacts = { ...(scenario.contactStates ?? {}) };
  const seen = new Set<string>();
  let lastPower: PowerResolution | null = null;

  for (let iteration = 1; iteration <= 32; iteration += 1) {
    const signature = stateSignature(contacts);
    if (seen.has(signature)) {
      const nonConvergent: ValidationIssue = {
        code: 'NON_CONVERGENT_SIMULATION', severity: 'blocked', blocking: true,
        message: 'Dynamic contact states did not converge within 32 iterations.', refs: [], scenarioId: scenario.id,
      };
      const validation: ValidationResult = {
        status: 'BLOCKED', issues: [nonConvergent], documentRevision: document.revision,
        documentHash: await sha256(document), checkedAt: new Date().toISOString(),
      };
      return {
        status: 'BLOCKED', converged: false, iterations: iteration,
        energizedTerminals: [...(lastPower?.energizedTerminals ?? [])].sort(),
        inputStates: {}, outputStates: {}, validation,
      };
    }
    seen.add(signature);

    const graph = buildCircuitGraph(document, catalog, { contactStates: contacts, forcedOutputs: scenario.forcedOutputs });
    const power = resolvePower(document, catalog, graph);
    lastPower = power;
    const nextContacts = { ...contacts };
    for (const instanceId of power.activeDevices) {
      const profile = catalog[document.devices.find((device) => device.id === instanceId)?.profileId ?? ''];
      if (profile?.behavior?.kind === 'ac-dc-power-supply') nextContacts[`${instanceId}:powered`] = true;
    }
    for (const rule of scenario.contactRules ?? []) {
      const energized = power.energizedTerminals.has(terminalKey(rule.sense.deviceId, rule.sense.terminalId));
      nextContacts[rule.stateKey] = rule.mode === 'closed-when-energized' ? energized : !energized;
    }

    if (stateSignature(nextContacts) === signature) {
      const validation = await validateWorkshop(document, catalog, {
        runtime: { contactStates: contacts, forcedOutputs: scenario.forcedOutputs },
        scenarioId: scenario.id,
      });
      const states = plcStates(document, catalog, power, scenario);
      return {
        status: validation.status,
        converged: true,
        iterations: iteration,
        energizedTerminals: [...power.energizedTerminals].sort(),
        ...states,
        validation,
      };
    }
    contacts = nextContacts;
  }

  throw new Error('Simulation iteration bound was not handled');
}

/** Validate the unforced circuit and every mission-declared dynamic state. */
export async function validateWorkshopScenarios(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  scenarios: readonly SimulationScenario[],
): Promise<ValidationResult> {
  const baseline = await validateWorkshop(document, catalog);
  const simulations = await Promise.all(scenarios.map((scenario) => simulateScenario(document, catalog, scenario)));
  const issues = [baseline, ...simulations.map((simulation) => simulation.validation)]
    .flatMap((validation) => validation.issues);
  const uniqueIssues = [...new Map(issues.map((entry) => [
    `${entry.scenarioId ?? 'default'}:${entry.code}:${[...entry.refs].sort().join('|')}`,
    entry,
  ])).values()];
  const status = [baseline.status, ...simulations.map((simulation) => simulation.status)].includes('BLOCKED')
    ? 'BLOCKED'
    : [baseline.status, ...simulations.map((simulation) => simulation.status)].includes('FAIL')
      ? 'FAIL'
      : 'PASS';
  return {
    status,
    issues: uniqueIssues,
    documentRevision: baseline.documentRevision,
    documentHash: baseline.documentHash,
    checkedAt: new Date().toISOString(),
  };
}
