import type { XbcRelayLampSliceDefinition } from '../../domain/device-runtime';
import type { XbcClosedLoopStepResult } from '../../domain/plc-runtime';

export interface XgSimRuntimeVisualFrameV1 {
  readonly schemaVersion: 1;
  readonly workshopRevision: number;
  readonly plcDeviceId: string;
  readonly relayDeviceId: string;
  readonly lampDeviceId: string;
  readonly plcOutputTerminalId: string;
  readonly plcOutputClosed: boolean;
  readonly relayEnergized: boolean;
  readonly lampEnergized: boolean;
  readonly plcFaultCodes: readonly string[];
  readonly relayFaultCodes: readonly string[];
  readonly lampFaultCodes: readonly string[];
}

function blockingCodesFor(step: XbcClosedLoopStepResult, refs: ReadonlySet<string>): readonly string[] {
  return [...new Set(step.frame.issues
    .filter((issue) => issue.blocking
      && issue.code !== 'PROJECT_IDENTITY_UNVERIFIED'
      && issue.bindingIds.some((bindingId) => refs.has(bindingId)))
    .map((issue) => issue.code))]
    .sort();
}

/**
 * Converts an already-solved XG-SIM frame into display-only SVG state. This
 * adapter intentionally has no circuit builder or solver dependency.
 */
export function createXgSimRuntimeVisualFrame(
  step: XbcClosedLoopStepResult,
  definition: XbcRelayLampSliceDefinition,
): XgSimRuntimeVisualFrameV1 {
  const frame = step.frame;
  return Object.freeze({
    schemaVersion: 1,
    workshopRevision: frame.workshopRevision,
    plcDeviceId: definition.plcDeviceId,
    relayDeviceId: definition.relayDeviceId,
    lampDeviceId: definition.lampDeviceId,
    plcOutputTerminalId: definition.plcOutputTerminalId,
    plcOutputClosed: frame.deviceStates[definition.plcOutputContactStateKey] === 'CLOSED',
    relayEnergized: frame.deviceStates[definition.relayCoilElementId] === 'energized',
    lampEnergized: frame.deviceStates[definition.lampElementId] === 'ON',
    plcFaultCodes: blockingCodesFor(step, new Set([
      definition.runOutputBindingId,
      definition.plcOutputContactStateKey,
      definition.plcPowerElementId,
    ])),
    relayFaultCodes: blockingCodesFor(step, new Set([
      definition.runOutputBindingId,
      definition.relayCoilElementId,
    ])),
    lampFaultCodes: blockingCodesFor(step, new Set([definition.lampElementId])),
  });
}
