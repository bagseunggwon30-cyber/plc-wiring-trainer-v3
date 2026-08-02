import { z } from 'zod';
import type { DeviceBehaviorCondition, DeviceBehaviorProfile } from './contracts';

const nonEmptyText = z.string().trim().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);

export const DeviceBehaviorConditionSchema: z.ZodType<DeviceBehaviorCondition> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('boolean-input'), inputId: nonEmptyText, equals: z.boolean() }).strict(),
  z.object({
    kind: z.literal('number-compare'),
    inputId: nonEmptyText,
    operator: z.enum(['lt', 'lte', 'eq', 'gte', 'gt']),
    value: z.number().finite(),
  }).strict(),
  z.object({ kind: z.literal('all'), conditions: z.array(DeviceBehaviorConditionSchema).min(1).max(32) }).strict(),
  z.object({ kind: z.literal('any'), conditions: z.array(DeviceBehaviorConditionSchema).min(1).max(32) }).strict(),
  z.object({ kind: z.literal('not'), condition: DeviceBehaviorConditionSchema }).strict(),
]));

const inputSchema = z.object({
  id: nonEmptyText,
  dataType: z.enum(['boolean', 'number']),
  source: z.enum(['circuit-element-energized', 'circuit-measurement', 'plc-output', 'operator-control']),
  terminalIds: z.array(nonEmptyText).min(1),
  unit: nonEmptyText.optional(),
}).strict();

const transitionSchema = z.object({
  to: nonEmptyText,
  when: DeviceBehaviorConditionSchema,
  delayMs: z.number().int().nonnegative().max(86_400_000),
}).strict();

const outputValueSchema = z.union([z.boolean(), z.number().finite()]);
const stateSchema = z.object({
  id: nonEmptyText,
  outputs: z.record(z.string(), outputValueSchema),
  transitions: z.array(transitionSchema).max(64),
}).strict();

const faultSchema = z.object({
  id: nonEmptyText,
  when: DeviceBehaviorConditionSchema,
  latching: z.boolean(),
  resetWhen: DeviceBehaviorConditionSchema.optional(),
}).strict();

function conditionInputIds(condition: DeviceBehaviorCondition): readonly string[] {
  if (condition.kind === 'boolean-input' || condition.kind === 'number-compare') return [condition.inputId];
  if (condition.kind === 'not') return conditionInputIds(condition.condition);
  return condition.conditions.flatMap(conditionInputIds);
}

export const DeviceBehaviorProfileSchema: z.ZodType<DeviceBehaviorProfile> = z.object({
  schemaVersion: z.literal(1),
  profileId: nonEmptyText,
  profileVersion: nonEmptyText,
  manufacturer: nonEmptyText,
  fullOrderCode: nonEmptyText,
  initialState: nonEmptyText,
  inputs: z.array(inputSchema).min(1).max(128),
  states: z.array(stateSchema).min(1).max(128),
  faults: z.array(faultSchema).max(64),
  ratings: z.record(z.string(), z.union([nonEmptyText, z.number().finite()])),
  unsupportedBehaviors: z.array(nonEmptyText),
  manualEvidence: z.array(z.object({
    manualId: nonEmptyText,
    pages: z.array(z.number().int().positive()).min(1),
    sha256,
    note: nonEmptyText,
  }).strict()).min(1),
}).strict().superRefine((profile, context) => {
  const inputIds = new Set<string>();
  profile.inputs.forEach((input, index) => {
    if (inputIds.has(input.id)) context.addIssue({ code: 'custom', path: ['inputs', index, 'id'], message: 'Duplicate device behavior input id.' });
    inputIds.add(input.id);
  });
  const stateIds = new Set<string>();
  profile.states.forEach((state, index) => {
    if (stateIds.has(state.id)) context.addIssue({ code: 'custom', path: ['states', index, 'id'], message: 'Duplicate device behavior state id.' });
    stateIds.add(state.id);
  });
  if (!stateIds.has(profile.initialState)) {
    context.addIssue({ code: 'custom', path: ['initialState'], message: 'Initial behavior state does not exist.' });
  }
  profile.states.forEach((state, stateIndex) => {
    state.transitions.forEach((transition, transitionIndex) => {
      if (!stateIds.has(transition.to)) {
        context.addIssue({ code: 'custom', path: ['states', stateIndex, 'transitions', transitionIndex, 'to'], message: 'Transition target state does not exist.' });
      }
      for (const inputId of conditionInputIds(transition.when)) {
        if (!inputIds.has(inputId)) context.addIssue({ code: 'custom', path: ['states', stateIndex, 'transitions', transitionIndex, 'when'], message: `Unknown behavior input ${inputId}.` });
      }
    });
  });
  const faultIds = new Set<string>();
  profile.faults.forEach((fault, faultIndex) => {
    if (faultIds.has(fault.id)) context.addIssue({ code: 'custom', path: ['faults', faultIndex, 'id'], message: 'Duplicate device behavior fault id.' });
    faultIds.add(fault.id);
    for (const inputId of [...conditionInputIds(fault.when), ...(fault.resetWhen ? conditionInputIds(fault.resetWhen) : [])]) {
      if (!inputIds.has(inputId)) context.addIssue({ code: 'custom', path: ['faults', faultIndex], message: `Unknown behavior input ${inputId}.` });
    }
  });
});
