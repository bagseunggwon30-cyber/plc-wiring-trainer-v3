import type { PlcRuntimeAdapter, PlcRuntimeSnapshot, RuntimeFrame, RuntimeIssueV1 } from '../plc-runtime/contracts';
import { synchronizeRuntimeFrame } from '../plc-runtime/runtime-coordinator';
import { simulateScenario } from '../v3/circuit';
import type { CircuitIssueV3, CircuitSolution, ScenarioSimulationV3, WorkshopDocumentV3 } from '../v3/contracts';
import { stepDeviceBehavior } from './behavior-runtime';
import type { DeviceBehaviorProfile, DeviceBehaviorSnapshot } from './contracts';
import { DeviceBehaviorProfileSchema } from './schema';

export interface XbcRelayLampSliceDefinition {
  readonly startInputBindingId: string;
  readonly stopInputBindingId: string;
  readonly runOutputBindingId: string;
  readonly startInputElementId: string;
  readonly stopInputElementId: string;
  readonly plcPowerElementId: string;
  readonly plcOutputContactStateKey: string;
  readonly relayCoilElementId: string;
  readonly lampElementId: string;
  readonly relayBehaviorProfile: DeviceBehaviorProfile;
}

export interface XbcRelayLampControls {
  readonly startPressed: boolean;
  readonly stopPressed: boolean;
}

export interface RunXbcRelayLampFrameRequest {
  readonly frameNumber: number;
  readonly workshop: WorkshopDocumentV3;
  readonly definition: XbcRelayLampSliceDefinition;
  readonly controls: XbcRelayLampControls;
  readonly previousRelayState: DeviceBehaviorSnapshot;
  readonly elapsedMs?: number;
  readonly retryCount?: number;
  readonly now?: () => number;
  readonly timestamp?: () => string;
}

export interface XbcRelayLampFrameResult {
  readonly frame: RuntimeFrame<CircuitSolution>;
  readonly relayState: DeviceBehaviorSnapshot;
  readonly inputCircuit: ScenarioSimulationV3;
}

interface PreparedXbcFrame {
  readonly inputCircuit: ScenarioSimulationV3;
  readonly plcPowered: boolean;
  readonly contactStates: Readonly<Record<string, boolean>>;
}

function elementIsEnergized(solution: CircuitSolution, elementId: string): boolean {
  return solution.loads[elementId]?.energized === true || solution.acLoads[elementId]?.energized === true;
}

function booleanOutput(snapshot: PlcRuntimeSnapshot, bindingId: string): { value: boolean; issue?: RuntimeIssueV1 } {
  const value = snapshot.outputs[bindingId];
  if (typeof value === 'boolean') return { value };
  return {
    value: false,
    issue: {
      code: 'PLC_OUTPUT_VALUE_INVALID',
      message: `PLC output ${bindingId} did not produce a BOOL value; the physical contact was forced open.`,
      bindingIds: [bindingId],
      blocking: true,
    },
  };
}

function circuitIssueToRuntime(issue: CircuitIssueV3): RuntimeIssueV1 {
  return {
    code: issue.code,
    message: issue.message,
    bindingIds: [...issue.refs],
    blocking: issue.blocking,
  };
}

function relevantCircuitIssue(
  issue: CircuitIssueV3,
  request: RunXbcRelayLampFrameRequest,
  runOutputOn: boolean,
  coilEnergized: boolean,
): boolean {
  if (issue.code !== 'OPEN_SOURCE_PATH' && issue.code !== 'OPEN_RETURN_PATH' && issue.code !== 'LOAD_INACTIVE') return true;
  const referencedElementIds = new Set(issue.refs.map((ref) => ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : ref));
  if (referencedElementIds.has(request.definition.startInputElementId)) return request.controls.startPressed;
  if (referencedElementIds.has(request.definition.stopInputElementId)) return !request.controls.stopPressed;
  if (referencedElementIds.has(request.definition.relayCoilElementId)) return runOutputOn;
  if (referencedElementIds.has(request.definition.lampElementId)) return coilEnergized;
  return true;
}

function assertSliceDefinition(document: WorkshopDocumentV3, definition: XbcRelayLampSliceDefinition): void {
  const elementIds = new Set(document.elements.map((element) => element.id));
  for (const [name, id] of Object.entries({
    startInputElementId: definition.startInputElementId,
    stopInputElementId: definition.stopInputElementId,
    plcPowerElementId: definition.plcPowerElementId,
    relayCoilElementId: definition.relayCoilElementId,
    lampElementId: definition.lampElementId,
  })) {
    if (!elementIds.has(id)) throw new Error(`XBC runtime slice ${name} does not exist in the workshop: ${id}`);
  }
  const outputContact = document.elements.find((element) => (
    element.kind === 'contact' && element.stateKey === definition.plcOutputContactStateKey
  ));
  if (!outputContact) throw new Error(`XBC runtime slice output contact state key is missing: ${definition.plcOutputContactStateKey}`);
  DeviceBehaviorProfileSchema.parse(definition.relayBehaviorProfile);
}

/**
 * Runs one fail-safe software-in-the-loop frame. The PLC sees only inputs that
 * the circuit solver energized. Conversely, a true PLC output closes only its
 * modeled dry contact and can never directly mark the relay or lamp as active.
 */
export async function runXbcRelayLampFrame(
  adapter: PlcRuntimeAdapter,
  request: RunXbcRelayLampFrameRequest,
): Promise<XbcRelayLampFrameResult> {
  assertSliceDefinition(request.workshop, request.definition);
  const status = await adapter.getStatus();
  if (!status.sessionId || !status.projectSha256 || status.state === 'disconnected' || status.state === 'blocked' || status.state === 'faulted') {
    throw new Error('PLC runtime must be connected before running the XBC vertical slice.');
  }
  let relayState = request.previousRelayState;
  let inputCircuit: ScenarioSimulationV3 | null = null;
  const elapsedMs = request.elapsedMs ?? 20;

  const frame = await synchronizeRuntimeFrame(adapter, {
    frameNumber: request.frameNumber,
    workshopRevision: request.workshop.revision,
    workshopHash: request.workshop.hash,
    sessionId: status.sessionId,
    projectSha256: status.projectSha256,
    retryCount: request.retryCount,
    now: request.now,
    timestamp: request.timestamp,
    prepare: (previous): { nextInputs: { values: Readonly<Record<string, boolean>> }; context: PreparedXbcFrame } => {
      const previousOutput = booleanOutput(previous, request.definition.runOutputBindingId).value;
      const contactStates = {
        'operator:start': request.controls.startPressed,
        'operator:stop-closed': !request.controls.stopPressed,
        [request.definition.plcOutputContactStateKey]: previousOutput,
      };
      const solved = simulateScenario(request.workshop, { id: `runtime-input-${request.frameNumber}`, contactStates });
      inputCircuit = solved;
      const plcPowered = elementIsEnergized(solved.solution, request.definition.plcPowerElementId);
      return {
        nextInputs: {
          values: {
            [request.definition.startInputBindingId]: plcPowered
              && solved.solution.loads[request.definition.startInputElementId]?.energized === true,
            [request.definition.stopInputBindingId]: plcPowered
              && solved.solution.loads[request.definition.stopInputElementId]?.energized === true,
          },
        },
        context: { inputCircuit: solved, plcPowered, contactStates },
      };
    },
    solve: (stable, prepared) => {
      const output = booleanOutput(stable, request.definition.runOutputBindingId);
      const runOutputOn = prepared.plcPowered && output.value;
      const finalCircuit = simulateScenario(request.workshop, {
        id: `runtime-output-${request.frameNumber}`,
        contactStates: {
          ...prepared.contactStates,
          [request.definition.plcOutputContactStateKey]: runOutputOn,
        },
      });
      const coilEnergized = elementIsEnergized(finalCircuit.solution, request.definition.relayCoilElementId);
      const lampEnergized = elementIsEnergized(finalCircuit.solution, request.definition.lampElementId);
      relayState = stepDeviceBehavior(
        request.definition.relayBehaviorProfile,
        request.previousRelayState,
        { coilEnergized },
        elapsedMs,
      );
      const issues = finalCircuit.solution.issues
        .filter((issue) => relevantCircuitIssue(issue, request, runOutputOn, coilEnergized))
        .map(circuitIssueToRuntime);
      if (output.issue) issues.push(output.issue);
      if (!prepared.plcPowered) {
        issues.push({
          code: 'PLC_POWER_UNAVAILABLE',
          message: `PLC power element ${request.definition.plcPowerElementId} is not energized; PLC inputs and output contacts are fail-safe OFF.`,
          bindingIds: [request.definition.startInputBindingId, request.definition.stopInputBindingId, request.definition.runOutputBindingId],
          blocking: true,
        });
      }
      if (!status.projectIdentityVerified) {
        issues.push({
          code: 'PROJECT_IDENTITY_UNVERIFIED',
          message: 'The connected runtime cannot prove that the loaded XG-SIM project matches the declared project SHA-256.',
          bindingIds: [request.definition.startInputBindingId, request.definition.stopInputBindingId, request.definition.runOutputBindingId],
          blocking: true,
        });
      }
      if (output.value && !coilEnergized) {
        issues.push({
          code: 'PLC_OUTPUT_LOAD_INACTIVE',
          message: `PLC output ${request.definition.runOutputBindingId} is ON, but the relay coil lacks a complete powered source/return path.`,
          bindingIds: [request.definition.runOutputBindingId, request.definition.relayCoilElementId],
          blocking: true,
        });
      }
      return {
        circuitSolution: finalCircuit.solution,
        deviceStates: {
          [request.definition.plcOutputContactStateKey]: runOutputOn ? 'CLOSED' : 'OPEN',
          [request.definition.relayCoilElementId]: relayState.state,
          [request.definition.lampElementId]: lampEnergized ? 'ON' : 'OFF',
        },
        issues,
      };
    },
  });

  if (!inputCircuit) throw new Error('XBC runtime input circuit was not prepared.');
  return Object.freeze({ frame, relayState, inputCircuit });
}
