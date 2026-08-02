import type {
  DeviceBehaviorCondition,
  DeviceBehaviorInputValue,
  DeviceBehaviorProfile,
  DeviceBehaviorSnapshot,
} from './contracts';
import { DeviceBehaviorProfileSchema } from './schema';

function evaluateCondition(
  condition: DeviceBehaviorCondition,
  inputs: Readonly<Record<string, DeviceBehaviorInputValue>>,
): boolean {
  switch (condition.kind) {
    case 'boolean-input': return inputs[condition.inputId] === condition.equals;
    case 'number-compare': {
      const value = inputs[condition.inputId];
      if (typeof value !== 'number') return false;
      if (condition.operator === 'lt') return value < condition.value;
      if (condition.operator === 'lte') return value <= condition.value;
      if (condition.operator === 'eq') return value === condition.value;
      if (condition.operator === 'gte') return value >= condition.value;
      return value > condition.value;
    }
    case 'all': return condition.conditions.every((entry) => evaluateCondition(entry, inputs));
    case 'any': return condition.conditions.some((entry) => evaluateCondition(entry, inputs));
    case 'not': return !evaluateCondition(condition.condition, inputs);
  }
}

function validateInputImage(
  profile: DeviceBehaviorProfile,
  inputs: Readonly<Record<string, DeviceBehaviorInputValue>>,
): void {
  for (const definition of profile.inputs) {
    const value = inputs[definition.id];
    if (value === undefined) throw new Error(`Missing device behavior input: ${definition.id}`);
    if (typeof value !== definition.dataType) throw new Error(`Device behavior input type mismatch: ${definition.id}`);
  }
  for (const inputId of Object.keys(inputs)) {
    if (!profile.inputs.some((definition) => definition.id === inputId)) throw new Error(`Unknown device behavior input: ${inputId}`);
  }
}

export function createInitialDeviceBehaviorSnapshot(rawProfile: DeviceBehaviorProfile): DeviceBehaviorSnapshot {
  const profile = DeviceBehaviorProfileSchema.parse(rawProfile);
  const initial = profile.states.find((state) => state.id === profile.initialState);
  if (!initial) throw new Error(`Initial device behavior state is missing: ${profile.initialState}`);
  return Object.freeze({
    state: initial.id,
    stateElapsedMs: 0,
    outputs: Object.freeze({ ...initial.outputs }),
    activeFaultIds: Object.freeze([]),
  });
}

export function stepDeviceBehavior(
  rawProfile: DeviceBehaviorProfile,
  previous: DeviceBehaviorSnapshot,
  inputs: Readonly<Record<string, DeviceBehaviorInputValue>>,
  elapsedMs: number,
): DeviceBehaviorSnapshot {
  const profile = DeviceBehaviorProfileSchema.parse(rawProfile);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Device behavior elapsed time must be finite and non-negative.');
  validateInputImage(profile, inputs);
  const current = profile.states.find((state) => state.id === previous.state);
  if (!current) throw new Error(`Unknown previous device behavior state: ${previous.state}`);

  const previousFaults = new Set(previous.activeFaultIds);
  const activeFaultIds = profile.faults.flatMap((fault) => {
    const active = previousFaults.has(fault.id);
    if (active && fault.latching && !(fault.resetWhen && evaluateCondition(fault.resetWhen, inputs))) return [fault.id];
    return evaluateCondition(fault.when, inputs) ? [fault.id] : [];
  }).sort();

  const elapsedInState = previous.stateElapsedMs + elapsedMs;
  const transition = current.transitions.find((candidate) => (
    elapsedInState >= candidate.delayMs && evaluateCondition(candidate.when, inputs)
  ));
  const next = transition
    ? profile.states.find((state) => state.id === transition.to)
    : current;
  if (!next) throw new Error(`Device behavior transition target is missing: ${transition?.to ?? 'unknown'}`);
  return Object.freeze({
    state: next.id,
    stateElapsedMs: transition ? 0 : elapsedInState,
    outputs: Object.freeze({ ...next.outputs }),
    activeFaultIds: Object.freeze(activeFaultIds),
  });
}
