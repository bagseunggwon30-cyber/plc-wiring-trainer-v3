import { z } from 'zod';
import { PlcRuntimeConfigurationV1Schema } from '../plc-runtime/io-binding';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const textSchema = z.string().min(1);
const terminalReferenceSchema = z.object({ elementId: textSchema, terminalId: textSchema }).strict();
const pointSchema = z.object({ x: z.number(), y: z.number() }).strict();
const protectionCoordinationSchema = z.object({
  prospectiveShortCircuitCurrentA: z.number().nonnegative().nullable(),
  protectiveDeviceCurve: z.string().min(1).nullable(),
}).strict();

const sourceSchema = z.union([
  z.object({
    // `kind` stayed optional for historical 24 V circuit fixtures and must remain round-trippable.
    kind: z.literal('dc').optional(), id: textSchema, positiveTerminal: textSchema, returnTerminal: textSchema, voltage: z.number().positive(),
    enabledByElementId: textSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('ac-single-phase'), id: textSchema, lineTerminal: textSchema, neutralTerminal: textSchema, peTerminal: textSchema,
    lineToNeutralVoltage: z.number().positive(), protectionCoordination: protectionCoordinationSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('ac-three-phase'), id: textSchema,
    phaseTerminals: z.object({ L1: textSchema, L2: textSchema, L3: textSchema }).strict(), neutralTerminal: textSchema.optional(), peTerminal: textSchema,
    lineToLineVoltage: z.number().positive(), lineToNeutralVoltage: z.number().positive().optional(),
    declaredPhaseSequence: z.enum(['L1-L2-L3', 'L1-L3-L2']).optional(), protectionCoordination: protectionCoordinationSchema.optional(),
  }).strict(),
]);

const elementSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('load'), id: textSchema, positiveTerminal: textSchema, returnTerminal: textSchema,
    role: z.enum(['load', 'digital-input', 'coil', 'module-supply']).optional(), parentDeviceId: textSchema.optional(),
    polarity: z.enum(['positive-return', 'either']).optional(), required: z.enum(['always', 'scenario']).optional(),
    resistanceOhms: z.number().positive().optional(), onThresholdVoltage: z.number().nonnegative().optional(), onThresholdCurrentA: z.number().nonnegative().optional(),
    forbiddenSourceIds: z.array(textSchema).optional(),
  }).strict(),
  z.object({
    kind: z.literal('ac-load'), id: textSchema, lineTerminal: textSchema, neutralTerminal: textSchema, peTerminal: textSchema.optional(),
    parentDeviceId: textSchema.optional(), required: z.enum(['always', 'scenario']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('three-phase-load'), id: textSchema,
    phaseTerminals: z.object({ L1: textSchema, L2: textSchema, L3: textSchema }).strict(), neutralTerminal: textSchema.optional(), peTerminal: textSchema.optional(),
    expectedPhaseSequence: z.enum(['L1-L2-L3', 'L1-L3-L2']).optional(), parentDeviceId: textSchema.optional(), required: z.enum(['always', 'scenario']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('contact'), id: textSchema, terminalA: textSchema, terminalB: textSchema,
    stateKey: textSchema, normally: z.enum(['open', 'closed']),
    drivenBy: z.object({
      elementId: textSchema,
      mode: z.enum(['closed-when-energized', 'closed-when-deenergized']),
    }).strict().optional(),
  }).strict(),
  z.object({
    kind: z.literal('analog-port'), id: textSchema, positiveTerminal: textSchema, returnTerminal: textSchema,
    protocol: z.enum(['analog-voltage', 'analog-current']), direction: z.enum(['source', 'sink']),
    parentDeviceId: textSchema.optional(), supplyElementId: textSchema.optional(),
    required: z.enum(['always', 'scenario']).optional(),
    inputResistanceOhms: z.number().positive().optional(), maximumCurrentA: z.number().positive().optional(),
  }).strict(),
  z.object({
    kind: z.literal('transistor-output'), id: textSchema,
    supplyPositiveTerminal: textSchema, supplyReturnTerminal: textSchema, outputTerminal: textSchema,
    mode: z.enum(['sinking', 'sourcing']), stateKey: textSchema, defaultState: z.boolean().optional(),
    supplyElementId: textSchema.optional(),
    parentDeviceId: textSchema.optional(), required: z.enum(['always', 'scenario']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('two-wire-current-transmitter'), id: textSchema,
    positiveTerminal: textSchema, negativeTerminal: textSchema,
    currentA: z.number().positive(), minimumOperatingVoltageV: z.number().nonnegative(),
    maximumLoopVoltageV: z.number().positive().optional(),
    parentDeviceId: textSchema.optional(), required: z.enum(['always', 'scenario']).optional(),
  }).strict(),
  z.object({ kind: z.literal('device'), id: textSchema, terminals: z.array(textSchema) }).strict(),
]);

export const WorkshopDocumentV3Schema = z.object({
  schemaVersion: z.literal(3),
  revision: z.number().int().nonnegative(),
  hash: hashSchema,
  mode: z.enum(['practice', 'prewire']),
  profileVersions: z.record(z.string(), z.string()),
  assetVersions: z.record(z.string(), z.string()),
  sourceSystem: z.object({
    id: z.string().min(1).nullable(),
    label: z.string().min(1).nullable(),
    supply: z.object({
      status: z.enum(['complete', 'incomplete']),
      kind: z.enum(['ac-single-phase', 'ac-three-phase', 'dc']).nullable(),
      nominalVoltage: z.number().positive().nullable(),
      conductors: z.array(z.string().min(1)),
      positivePotential: z.literal('+24V').nullable(),
      returnPotential: z.literal('0V').nullable(),
    }).strict(),
    earthing: z.object({
      status: z.enum(['complete', 'incomplete']),
      policy: z.enum(['PE_SEPARATE_0V_FLOATING', 'PE_0V_SINGLE_POINT_BOND', 'SITE_DEFINED_BONDING']).nullable(),
    }).strict(),
  }).strict(),
  physicalLayout: z.object({
    status: z.enum(['complete', 'incomplete']),
    sourceUnit: z.enum(['canvas-unit', 'millimeter']),
    canvasUnitsPerMm: z.number().positive().nullable(),
  }).strict().optional(),
  sources: z.array(sourceSchema),
  elements: z.array(elementSchema),
  branches: z.array(z.object({
    id: textSchema,
    from: terminalReferenceSchema,
    to: terminalReferenceSchema,
    conductor: z.enum(['dc', 'ac', 'pe', 'signal', 'internal']),
  }).strict()),
  deviceInstances: z.array(z.object({
    id: textSchema,
    profileId: textSchema,
    profileVersion: textSchema,
    assetVersion: z.string().min(1).nullable(),
    exactOrderCode: z.string().min(1).nullable(),
    designation: z.string().min(1).nullable(),
    configuration: z.record(z.string(), z.unknown()),
    layoutMm: z.object({
      x: z.number(), y: z.number(), rotation: z.number(),
      width: z.number().positive().optional(), height: z.number().positive().optional(), depth: z.number().positive().optional(),
    }).strict(),
    verification: z.enum(['unverified', 'legacy-unverified']),
  }).strict()),
  cableAssemblies: z.array(z.object({
    id: textSchema, designation: z.string().min(1).nullable(), conductorIds: z.array(textSchema), cableType: z.string().min(1).nullable(),
    lengthMm: z.number().positive().nullable(), shielded: z.boolean(), drainConductorId: z.string().min(1).nullable(), routeMm: z.array(pointSchema),
  }).strict()),
  conductors: z.array(z.object({
    id: textSchema, cableAssemblyId: textSchema, core: textSchema, color: z.string().min(1).nullable(), gauge: z.string().min(1).nullable(),
    wireNumber: z.string().min(1).nullable(), crossSectionMm2: z.number().positive().nullable(), awg: z.string().min(1).nullable(),
    lengthMm: z.number().positive().nullable(), pairId: z.string().min(1).nullable(), shielded: z.boolean(), drain: z.boolean(),
    ferruleFrom: z.string().min(1).nullable(), ferruleTo: z.string().min(1).nullable(), lugFrom: z.string().min(1).nullable(), lugTo: z.string().min(1).nullable(),
  }).strict()),
  terminalAssemblies: z.array(z.object({
    id: textSchema, deviceId: textSchema, terminalIds: z.array(textSchema), manufacturer: z.string().min(1).nullable(),
    orderCode: z.string().min(1).nullable(), designation: z.string().min(1).nullable(),
    terminalType: z.enum(['through', 'pe', 'fused', 'disconnect', 'device']).nullable(), marker: z.string().min(1).nullable(),
    maximumConductorsPerTerminal: z.number().int().positive().nullable(), bridges: z.array(textSchema), accessories: z.array(textSchema),
  }).strict()),
  conductorBranches: z.array(z.object({
    id: textSchema, conductorId: textSchema, from: terminalReferenceSchema, to: terminalReferenceSchema, waypointsMm: z.array(pointSchema),
  }).strict()),
  reviewScope: z.object({
    elementIds: z.array(textSchema),
    templateId: z.string().min(1).nullable(),
    deviceIds: z.array(textSchema),
    status: z.enum(['complete', 'incomplete']),
  }).strict(),
  scenarios: z.array(z.object({
    id: textSchema,
    contactStates: z.record(z.string(), z.boolean()).optional(),
    contactRules: z.array(z.object({
      stateKey: textSchema,
      senseElementId: textSchema.optional(),
      sense: terminalReferenceSchema.optional(),
      mode: z.enum(['closed-when-energized', 'closed-when-deenergized']),
    }).strict().refine((rule) => rule.senseElementId !== undefined || rule.sense !== undefined, {
      message: 'A contact rule must identify a two-terminal sensed element.',
    })).optional(),
  }).strict()),
  settings: z.record(z.string(), z.unknown()),
  layout: z.record(z.string(), z.unknown()),
  // Preserve additive extension payloads from native v3 writers; migration-owned data remains under `legacy`.
  extensions: z.object({ legacy: z.record(z.string(), z.unknown()) }).passthrough(),
  plcRuntime: PlcRuntimeConfigurationV1Schema.optional(),
}).strict();

export type PersistedWorkshopDocumentV3 = z.infer<typeof WorkshopDocumentV3Schema>;
