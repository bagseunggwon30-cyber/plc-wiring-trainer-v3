import { z } from 'zod';
import type { PlcRuntimeAdapter, PlcRuntimeSnapshot, PlcRuntimeValue } from './contracts';

export const StableSnapshotPolicyV1Schema = z.object({
  pollIntervalMs: z.number().int().min(10).max(1_000),
  timeoutMs: z.number().int().min(20).max(10_000),
  consecutiveMatches: z.number().int().min(1).max(10),
}).strict();

export type StableSnapshotPolicyV1 = z.infer<typeof StableSnapshotPolicyV1Schema>;

export const DEFAULT_STABLE_SNAPSHOT_POLICY: StableSnapshotPolicyV1 = Object.freeze({
  pollIntervalMs: 20,
  timeoutMs: 500,
  consecutiveMatches: 2,
});

export class RuntimeSynchronizationError extends Error {
  readonly code: 'PLC_OUTPUT_NOT_STABLE';
  readonly attempts: number;
  readonly lastSnapshot: PlcRuntimeSnapshot | null;

  constructor(attempts: number, lastSnapshot: PlcRuntimeSnapshot | null) {
    super('PLC output did not reach the expected stable state before the diagnostic timeout.');
    this.name = 'RuntimeSynchronizationError';
    this.code = 'PLC_OUTPUT_NOT_STABLE';
    this.attempts = attempts;
    this.lastSnapshot = lastSnapshot;
  }
}

export interface StableSnapshotClock {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface StableSnapshotResult {
  readonly snapshot: PlcRuntimeSnapshot;
  readonly attempts: number;
}

function outputMatches(
  snapshot: PlcRuntimeSnapshot,
  expectedOutputs: Readonly<Record<string, PlcRuntimeValue>>,
): boolean {
  return Object.entries(expectedOutputs).every(([bindingId, expected]) => snapshot.outputs[bindingId] === expected);
}

export async function waitForExpectedStableSnapshot(
  adapter: PlcRuntimeAdapter,
  expectedOutputs: Readonly<Record<string, PlcRuntimeValue>>,
  rawPolicy: StableSnapshotPolicyV1 = DEFAULT_STABLE_SNAPSHOT_POLICY,
  clock: StableSnapshotClock = {
    now: () => performance.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<StableSnapshotResult> {
  const policy = StableSnapshotPolicyV1Schema.parse(rawPolicy);
  const startedAt = clock.now();
  let matches = 0;
  let attempts = 0;
  let lastSnapshot: PlcRuntimeSnapshot | null = null;
  while (true) {
    lastSnapshot = await adapter.readSnapshot();
    attempts += 1;
    matches = outputMatches(lastSnapshot, expectedOutputs) ? matches + 1 : 0;
    if (matches >= policy.consecutiveMatches) return Object.freeze({ snapshot: lastSnapshot, attempts });
    if (clock.now() - startedAt >= policy.timeoutMs) {
      throw new RuntimeSynchronizationError(attempts, lastSnapshot);
    }
    await clock.sleep(policy.pollIntervalMs);
  }
}
