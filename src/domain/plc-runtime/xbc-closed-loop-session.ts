import {
  createInitialDeviceBehaviorSnapshot,
  runXbcRelayLampFrame,
  type XbcRelayLampSliceDefinition,
} from '../device-runtime';
import { simulateScenario } from '../v3/circuit';
import type { CircuitIssueV3, CircuitSolution, ValidationStatusV3, WorkshopDocumentV3 } from '../v3/contracts';
import type { PlcInputImage, PlcRuntimeAdapter, RuntimeFrame } from './contracts';
import { assessFunctionalSimulation, type FunctionalSimulationResultV1 } from './functional-simulation';
import {
  XgSimLocalProjectRefV1Schema,
  projectReferenceMatchesManifest,
  type XgSimLocalProjectRefV1,
  type XgSimTestProjectManifestV1,
} from './project-manifest';
import {
  DEFAULT_STABLE_SNAPSHOT_POLICY,
  waitForExpectedStableSnapshot,
  type StableSnapshotClock,
  type StableSnapshotPolicyV1,
} from './stable-snapshot';

export type XbcClosedLoopSessionState =
  | 'disconnected'
  | 'preflight'
  | 'ready'
  | 'running'
  | 'paused'
  | 'stale'
  | 'faulted'
  | 'safe-stopped';

export type RuntimeDiagnosticOutcomeV1 = 'NOT_RUN' | 'ROUNDTRIP_PASS' | 'ROUNDTRIP_FAIL' | 'INTERRUPTED';

export type XbcClosedLoopStepId =
  | 'initial'
  | 'start-pressed'
  | 'start-released'
  | 'stop-pressed'
  | 'stop-released';

export interface XbcClosedLoopSessionSnapshot {
  readonly state: XbcClosedLoopSessionState;
  readonly outcome: RuntimeDiagnosticOutcomeV1;
  readonly frameNumber: number;
  readonly workshopRevision: number | null;
  readonly workshopHash: string | null;
  readonly issueCodes: readonly string[];
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface XbcClosedLoopPreflightIssue {
  readonly code: string;
  readonly message: string;
  readonly blocking: boolean;
}

export interface XbcClosedLoopPreflightResult {
  readonly ready: boolean;
  readonly validationStatus: ValidationStatusV3;
  readonly issues: readonly XbcClosedLoopPreflightIssue[];
}

export interface XbcClosedLoopSafeStopEvidenceV1 {
  readonly reason: string;
  readonly attemptedAt: string;
  readonly inputBindingIds: readonly string[];
  /** Legacy field name: true means every writable binding reached its configured fail-safe value. */
  readonly allInputsForcedOff: boolean;
  readonly safeInputValues: Readonly<Record<string, boolean | number>>;
  readonly runOutputObservedOff: boolean;
  readonly disconnected: boolean;
  readonly error: string | null;
}

export interface XbcClosedLoopStepResult {
  readonly id: XbcClosedLoopStepId;
  readonly frame: RuntimeFrame<CircuitSolution>;
  readonly passed: boolean;
  readonly issueCodes: readonly string[];
}

export interface XbcClosedLoopRunResult {
  readonly outcome: RuntimeDiagnosticOutcomeV1;
  readonly steps: readonly XbcClosedLoopStepResult[];
  readonly issueCodes: readonly string[];
  readonly assessment: FunctionalSimulationResultV1 | null;
  readonly safeStop: XbcClosedLoopSafeStopEvidenceV1;
}

export interface XbcClosedLoopSessionControllerOptions {
  readonly adapter: PlcRuntimeAdapter;
  readonly manifest: XgSimTestProjectManifestV1;
  readonly definition: XbcRelayLampSliceDefinition;
  readonly stableSnapshotPolicy?: StableSnapshotPolicyV1;
  readonly stableSnapshotClock?: StableSnapshotClock;
  readonly sessionNonce?: () => string;
  readonly timestamp?: () => string;
}

interface AutomaticStepDefinition {
  readonly id: XbcClosedLoopStepId;
  readonly startPressed: boolean;
  readonly stopPressed: boolean;
  readonly expectedStart: boolean;
  readonly expectedStop: boolean;
  readonly expectedRun: boolean;
  readonly expectedRelay: 'energized' | 'deenergized';
  readonly expectedLamp: 'ON' | 'OFF';
}

const AUTOMATIC_STEPS: readonly AutomaticStepDefinition[] = Object.freeze([
  { id: 'initial', startPressed: false, stopPressed: false, expectedStart: false, expectedStop: false, expectedRun: false, expectedRelay: 'deenergized', expectedLamp: 'OFF' },
  { id: 'start-pressed', startPressed: true, stopPressed: false, expectedStart: true, expectedStop: false, expectedRun: true, expectedRelay: 'energized', expectedLamp: 'ON' },
  { id: 'start-released', startPressed: false, stopPressed: false, expectedStart: false, expectedStop: false, expectedRun: true, expectedRelay: 'energized', expectedLamp: 'ON' },
  { id: 'stop-pressed', startPressed: false, stopPressed: true, expectedStart: false, expectedStop: true, expectedRun: false, expectedRelay: 'deenergized', expectedLamp: 'OFF' },
  { id: 'stop-released', startPressed: false, stopPressed: false, expectedStart: false, expectedStop: false, expectedRun: false, expectedRelay: 'deenergized', expectedLamp: 'OFF' },
]);

const DANGEROUS_PREFLIGHT_CODES = new Set<CircuitIssueV3['code']>([
  'DC_SHORT',
  'AC_PHASE_NEUTRAL_SHORT',
  'AC_PHASE_PHASE_SHORT',
  'AC_PHASE_PE_FAULT',
  'PE_AS_WORKING_RETURN',
  'LOAD_REVERSED',
  'PARALLEL_SOURCE',
  'EARTHING_POLICY_BOND_COUNT',
]);

const DIAGNOSTIC_ONLY_BLOCKS = new Set(['PROJECT_IDENTITY_UNVERIFIED']);

function defaultSessionNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return 'XGSIM_SESSION_ERROR';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class XbcClosedLoopSessionController {
  readonly #adapter: PlcRuntimeAdapter;
  readonly #manifest: XgSimTestProjectManifestV1;
  readonly #definition: XbcRelayLampSliceDefinition;
  readonly #stablePolicy: StableSnapshotPolicyV1;
  readonly #stableClock: StableSnapshotClock | undefined;
  readonly #sessionNonce: () => string;
  readonly #timestamp: () => string;
  readonly #listeners = new Set<(snapshot: XbcClosedLoopSessionSnapshot) => void>();
  readonly #frameListeners = new Set<(step: XbcClosedLoopStepResult) => void>();
  #snapshot: XbcClosedLoopSessionSnapshot;
  #preflightValidationStatus: ValidationStatusV3 = 'BLOCKED';
  #projectReference: XgSimLocalProjectRefV1 | null = null;
  #generation = 0;
  #frameInFlight = false;

  constructor(options: XbcClosedLoopSessionControllerOptions) {
    this.#adapter = options.adapter;
    this.#manifest = options.manifest;
    this.#definition = options.definition;
    this.#stablePolicy = options.stableSnapshotPolicy ?? DEFAULT_STABLE_SNAPSHOT_POLICY;
    this.#stableClock = options.stableSnapshotClock;
    this.#sessionNonce = options.sessionNonce ?? defaultSessionNonce;
    this.#timestamp = options.timestamp ?? (() => new Date().toISOString());
    this.#snapshot = Object.freeze({
      state: 'disconnected', outcome: 'NOT_RUN', frameNumber: 0,
      workshopRevision: null, workshopHash: null, issueCodes: [], lastError: null,
      updatedAt: this.#timestamp(),
    });
  }

  get snapshot(): XbcClosedLoopSessionSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: XbcClosedLoopSessionSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeFrame(listener: (step: XbcClosedLoopStepResult) => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  async preflight(request: {
    readonly workshop: WorkshopDocumentV3;
    readonly projectReference: XgSimLocalProjectRefV1;
    readonly userConfirmedProjectLoaded: boolean;
    readonly buildIssues?: readonly CircuitIssueV3[];
  }): Promise<XbcClosedLoopPreflightResult> {
    this.#setSnapshot({ state: 'preflight', outcome: 'NOT_RUN', issueCodes: [], lastError: null });
    const reference = XgSimLocalProjectRefV1Schema.parse(request.projectReference);
    const baseline = simulateScenario(request.workshop, { id: 'xgsim-preflight' });
    this.#preflightValidationStatus = baseline.validation.status;
    const issues: XbcClosedLoopPreflightIssue[] = [...baseline.solution.issues, ...(request.buildIssues ?? [])]
      .filter((entry) => DANGEROUS_PREFLIGHT_CODES.has(entry.code))
      .map((entry) => ({ code: entry.code, message: entry.message, blocking: true }));
    if (!projectReferenceMatchesManifest(reference, this.#manifest)) {
      issues.push({ code: 'PROJECT_FILE_HASH_MISMATCH', message: 'Selected .xgwx filename or SHA-256 does not match the checked manifest.', blocking: true });
    }
    if (!request.userConfirmedProjectLoaded) {
      issues.push({ code: 'PROJECT_LOAD_DECLARATION_REQUIRED', message: 'Confirm that the selected project is open in XG5000 and XG-SIM is running.', blocking: true });
    }
    if (this.#manifest.programCheck.status !== 'PASS') {
      issues.push({ code: 'PROGRAM_CHECK_REQUIRED', message: 'The exact M-device project must pass XG5000 Program Check before the runtime test.', blocking: true });
    }
    try {
      const probe = await this.#adapter.probe({ base: this.#manifest.base, slot: this.#manifest.slot });
      if (probe.status !== 'available') {
        issues.push({ code: 'XGSIM_UNAVAILABLE', message: probe.reason ?? 'XG-SIM channels are unavailable.', blocking: true });
      }
    } catch (error) {
      issues.push({ code: errorCode(error), message: errorMessage(error), blocking: true });
    }
    const ready = !issues.some((entry) => entry.blocking);
    this.#projectReference = ready ? reference : null;
    this.#setSnapshot({
      state: ready ? 'ready' : 'faulted',
      workshopRevision: request.workshop.revision,
      workshopHash: request.workshop.hash,
      issueCodes: issues.map((entry) => entry.code),
      lastError: ready ? null : issues.map((entry) => entry.message).join(' '),
    });
    return Object.freeze({ ready, validationStatus: baseline.validation.status, issues: Object.freeze(issues) });
  }

  async connect(workshop: WorkshopDocumentV3): Promise<void> {
    this.#assertFresh(workshop);
    if (this.#snapshot.state !== 'ready' || !this.#projectReference) throw new Error('XG-SIM preflight must pass before connecting.');
    await this.#adapter.connect({
      sessionNonce: this.#sessionNonce(),
      cpuModel: this.#manifest.cpuModel,
      projectId: this.#manifest.projectId,
      projectSha256: this.#manifest.projectSha256,
      base: this.#manifest.base,
      slot: this.#manifest.slot,
      bindings: this.#manifest.bindings,
    });
    this.#setSnapshot({ state: 'ready', lastError: null });
  }

  async runAutomaticTest(workshop: WorkshopDocumentV3): Promise<XbcClosedLoopRunResult> {
    this.#assertFresh(workshop);
    const status = await this.#adapter.getStatus();
    if (!status.sessionId || status.state === 'disconnected') throw new Error('XG-SIM must be connected before the functional test starts.');
    const generation = ++this.#generation;
    this.#setSnapshot({ state: 'running', outcome: 'NOT_RUN', issueCodes: [], lastError: null });
    let relayState = createInitialDeviceBehaviorSnapshot(this.#definition.relayBehaviorProfile);
    const steps: XbcClosedLoopStepResult[] = [];
    const issueCodes = new Set<string>();
    let thrown: unknown = null;

    try {
      for (const step of AUTOMATIC_STEPS) {
        if (generation !== this.#generation) throw Object.assign(new Error('Functional test was interrupted.'), { code: 'INTERRUPTED' });
        if (this.#frameInFlight) throw Object.assign(new Error('Only one XG-SIM frame may run at a time.'), { code: 'RUNTIME_FRAME_IN_FLIGHT' });
        this.#frameInFlight = true;
        let result;
        try {
          result = await runXbcRelayLampFrame(this.#adapter, {
            frameNumber: this.#snapshot.frameNumber + 1,
            workshop,
            definition: this.#definition,
            controls: { startPressed: step.startPressed, stopPressed: step.stopPressed },
            previousRelayState: relayState,
            expectedRunOutput: step.expectedRun,
            stableSnapshotPolicy: this.#stablePolicy,
            stableSnapshotClock: this.#stableClock,
            timestamp: this.#timestamp,
          });
        } finally {
          this.#frameInFlight = false;
        }
        if (generation !== this.#generation) throw Object.assign(new Error('Functional test was interrupted.'), { code: 'INTERRUPTED' });
        relayState = result.relayState;
        const stepIssues = new Set(result.frame.issues.map((entry) => entry.code));
        if (result.frame.plcInputs[this.#definition.startInputBindingId] !== step.expectedStart) stepIssues.add('START_INPUT_STATE_MISMATCH');
        if (result.frame.plcInputs[this.#definition.stopInputBindingId] !== step.expectedStop) stepIssues.add('STOP_INPUT_STATE_MISMATCH');
        if (result.frame.plcOutputs[this.#definition.runOutputBindingId] !== step.expectedRun) stepIssues.add('RUN_OUTPUT_STATE_MISMATCH');
        if (result.frame.deviceStates[this.#definition.relayCoilElementId] !== step.expectedRelay) stepIssues.add('RELAY_COIL_STATE_MISMATCH');
        if (result.frame.deviceStates[this.#definition.lampElementId] !== step.expectedLamp) stepIssues.add('RUN_LAMP_STATE_MISMATCH');
        for (const code of stepIssues) issueCodes.add(code);
        const failed = [...stepIssues].some((code) => !DIAGNOSTIC_ONLY_BLOCKS.has(code));
        const stepResult = Object.freeze({ id: step.id, frame: result.frame, passed: !failed, issueCodes: Object.freeze([...stepIssues].sort()) });
        steps.push(stepResult);
        for (const listener of this.#frameListeners) listener(stepResult);
        this.#setSnapshot({ frameNumber: result.frame.frameNumber, issueCodes: [...issueCodes].sort() });
      }
    } catch (error) {
      thrown = error;
      issueCodes.add(errorCode(error));
    }

    const beforeStopStatus = await this.#adapter.getStatus().catch(() => null);
    const safeStop = await this.#forceInputsOffAndDisconnect(thrown ? 'functional-test-fault' : 'automatic-test-complete');
    if (!safeStop.allInputsForcedOff || !safeStop.runOutputObservedOff || !safeStop.disconnected) issueCodes.add('SAFE_STOP_INCOMPLETE');
    const lastFrame = steps.at(-1)?.frame ?? null;
    const assessment = lastFrame ? assessFunctionalSimulation({
      workshop,
      frame: lastFrame,
      prewireStatus: this.#preflightValidationStatus,
      requiredDeviceProfilesEligible: false,
      requiredOutputBindingIds: [this.#definition.runOutputBindingId],
      requiredDeviceStateIds: [this.#definition.relayCoilElementId, this.#definition.lampElementId],
      projectIdentityVerified: beforeStopStatus?.projectIdentityVerified === true,
    }) : null;
    const diagnosticFailures = [...issueCodes].filter((code) => !DIAGNOSTIC_ONLY_BLOCKS.has(code));
    const outcome: RuntimeDiagnosticOutcomeV1 = thrown && errorCode(thrown) === 'INTERRUPTED'
      ? 'INTERRUPTED'
      : diagnosticFailures.length === 0 && safeStop.allInputsForcedOff && safeStop.runOutputObservedOff && safeStop.disconnected
        ? 'ROUNDTRIP_PASS'
        : 'ROUNDTRIP_FAIL';
    this.#setSnapshot({
      state: 'safe-stopped', outcome, issueCodes: [...issueCodes].sort(),
      lastError: thrown ? errorMessage(thrown) : null,
    });
    return Object.freeze({ outcome, steps: Object.freeze(steps), issueCodes: Object.freeze([...issueCodes].sort()), assessment, safeStop });
  }

  async pause(): Promise<XbcClosedLoopSafeStopEvidenceV1> {
    ++this.#generation;
    const evidence = await this.#forceInputsOff('user-pause');
    this.#setSnapshot({ state: 'paused', outcome: 'INTERRUPTED', issueCodes: evidence.error ? ['SAFE_STOP_INCOMPLETE'] : [], lastError: evidence.error });
    return evidence;
  }

  async safeStop(reason = 'user-stop'): Promise<XbcClosedLoopSafeStopEvidenceV1> {
    ++this.#generation;
    const evidence = await this.#forceInputsOffAndDisconnect(reason);
    this.#setSnapshot({
      state: 'safe-stopped', outcome: 'INTERRUPTED',
      issueCodes: evidence.error ? ['SAFE_STOP_INCOMPLETE'] : [], lastError: evidence.error,
    });
    return evidence;
  }

  async markStale(reason: string): Promise<void> {
    ++this.#generation;
    this.#setSnapshot({ state: 'stale', outcome: 'INTERRUPTED', issueCodes: ['STALE'], lastError: reason });
    await this.#forceInputsOffAndDisconnect(reason);
    this.#setSnapshot({ state: 'stale', outcome: 'INTERRUPTED', issueCodes: ['STALE'], lastError: reason });
  }

  #assertFresh(workshop: WorkshopDocumentV3): void {
    if (this.#snapshot.workshopRevision !== workshop.revision || this.#snapshot.workshopHash !== workshop.hash) {
      throw Object.assign(new Error('Workshop revision/hash changed after XG-SIM preflight.'), { code: 'STALE' });
    }
  }

  async #forceInputsOff(reason: string): Promise<XbcClosedLoopSafeStopEvidenceV1> {
    const attemptedAt = this.#timestamp();
    const inputBindings = this.#manifest.bindings.filter((binding) => binding.access.write);
    const values = Object.fromEntries(inputBindings.map((binding) => [binding.id, binding.communicationLossState]));
    let allInputsForcedOff = false;
    let runOutputObservedOff = false;
    let failure: string | null = null;
    try {
      const status = await this.#adapter.getStatus();
      if (!status.sessionId || status.state === 'disconnected') {
        return Object.freeze({
          reason, attemptedAt, inputBindingIds: inputBindings.map((binding) => binding.id).sort(),
          allInputsForcedOff: true, safeInputValues: values,
          runOutputObservedOff: true, disconnected: true, error: null,
        });
      }
      const result = await this.#adapter.writeInputImage({ values } satisfies PlcInputImage);
      allInputsForcedOff = inputBindings.every((binding) => result.acceptedBindingIds.includes(binding.id));
      const stable = await waitForExpectedStableSnapshot(
        this.#adapter,
        { [this.#definition.runOutputBindingId]: false },
        this.#stablePolicy,
        this.#stableClock,
      );
      runOutputObservedOff = stable.snapshot.outputs[this.#definition.runOutputBindingId] === false;
    } catch (error) {
      failure = errorMessage(error);
    }
    return Object.freeze({
      reason, attemptedAt, inputBindingIds: inputBindings.map((binding) => binding.id).sort(),
      allInputsForcedOff, safeInputValues: values,
      runOutputObservedOff, disconnected: false, error: failure,
    });
  }

  async #forceInputsOffAndDisconnect(reason: string): Promise<XbcClosedLoopSafeStopEvidenceV1> {
    const evidence = await this.#forceInputsOff(reason);
    let disconnected = evidence.disconnected;
    let failure = evidence.error;
    try {
      await this.#adapter.disconnect();
      disconnected = (await this.#adapter.getStatus()).state === 'disconnected';
    } catch (error) {
      failure = [failure, errorMessage(error)].filter(Boolean).join(' ');
    }
    return Object.freeze({ ...evidence, disconnected, error: failure });
  }

  #setSnapshot(patch: Partial<XbcClosedLoopSessionSnapshot>): void {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      issueCodes: Object.freeze([...(patch.issueCodes ?? this.#snapshot.issueCodes)]),
      updatedAt: this.#timestamp(),
    });
    for (const listener of this.#listeners) listener(this.#snapshot);
  }
}
