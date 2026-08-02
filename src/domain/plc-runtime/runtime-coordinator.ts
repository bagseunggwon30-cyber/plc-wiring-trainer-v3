import type {
  PlcInputImage,
  PlcRuntimeAdapter,
  PlcRuntimeSnapshot,
  RuntimeFrame,
  RuntimeIssueV1,
} from './contracts';

export interface RuntimeFramePreparation<TPreparation> {
  nextInputs: PlcInputImage;
  context: TPreparation;
}

export interface RuntimeFrameContext<TCircuitSolution, TPreparation = unknown> {
  frameNumber: number;
  workshopRevision: number;
  workshopHash: string;
  sessionId: string;
  projectSha256: string;
  retryCount?: number;
  /** Calculates only the writable PLC input image from the pre-scan snapshot. */
  prepare(snapshot: PlcRuntimeSnapshot): RuntimeFramePreparation<TPreparation>;
  /** Calculates the published circuit/device state from the post-scan snapshot. */
  solve(snapshot: PlcRuntimeSnapshot, preparation: TPreparation): {
    circuitSolution: TCircuitSolution;
    deviceStates: Readonly<Record<string, string>>;
    issues: readonly RuntimeIssueV1[];
  };
  now?: () => number;
  timestamp?: () => string;
}

export async function synchronizeRuntimeFrame<TCircuitSolution, TPreparation>(
  adapter: PlcRuntimeAdapter,
  context: RuntimeFrameContext<TCircuitSolution, TPreparation>,
): Promise<RuntimeFrame<TCircuitSolution>> {
  const now = context.now ?? (() => performance.now());
  const timestamp = context.timestamp ?? (() => new Date().toISOString());
  const startedAt = now();
  const previous = await adapter.readSnapshot();
  const prepared = context.prepare(previous);
  await adapter.writeInputImage(prepared.nextInputs);
  const stable = await adapter.readSnapshot();
  const solved = context.solve(stable, prepared.context);
  return Object.freeze({
    frameNumber: context.frameNumber,
    capturedAt: timestamp(),
    workshopRevision: context.workshopRevision,
    workshopHash: context.workshopHash,
    sessionId: context.sessionId,
    projectSha256: context.projectSha256,
    plcInputs: stable.inputs,
    plcOutputs: stable.outputs,
    circuitSolution: solved.circuitSolution,
    deviceStates: solved.deviceStates,
    issues: solved.issues,
    elapsedMs: Math.max(0, now() - startedAt),
    retryCount: context.retryCount ?? 0,
  });
}
