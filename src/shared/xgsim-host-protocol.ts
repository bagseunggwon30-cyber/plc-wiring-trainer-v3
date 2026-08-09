import { z } from 'zod';

export const XGSIM_HOST_PROTOCOL_VERSION = 1 as const;
export const XGSIM_HOST_MAX_BINDINGS = 256;

const nonceSchema = z.string().regex(/^[a-f0-9]{32,128}$/i);
const requestIdSchema = z.string().uuid();
const inputChannelSchema = z.string().regex(/^B\d+S\d+\.IN\d+$/i);
const outputChannelSchema = z.string().regex(/^B\d+S\d+\.OUT\d+$/i);
const mDeviceBitSchema = z.string().regex(/^M[0-9]{4}[0-9A-F]$/i);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const emptyPayloadSchema = z.object({}).strict();

const writableAddressSchema = z.union([inputChannelSchema, mDeviceBitSchema]);
const writeValuesSchema = z.record(writableAddressSchema, z.boolean()).superRefine((values, context) => {
  if (Object.keys(values).length > XGSIM_HOST_MAX_BINDINGS) {
    context.addIssue({ code: 'custom', message: `At most ${XGSIM_HOST_MAX_BINDINGS} input values are allowed.` });
  }
});

const envelope = {
  protocolVersion: z.literal(XGSIM_HOST_PROTOCOL_VERSION),
  requestId: requestIdSchema,
  nonce: nonceSchema,
};

const connectPayloadSchema = z.object({
  base: z.number().int().nonnegative().max(255),
  slot: z.number().int().nonnegative().max(255),
  cpuModel: z.string().min(1),
  projectId: z.string().min(1),
  projectSha256: sha256Schema,
  allowedInputs: z.array(inputChannelSchema).max(XGSIM_HOST_MAX_BINDINGS),
  allowedOutputs: z.array(outputChannelSchema).max(XGSIM_HOST_MAX_BINDINGS),
  allowedDeviceWrites: z.array(mDeviceBitSchema).max(XGSIM_HOST_MAX_BINDINGS),
  allowedDeviceReads: z.array(mDeviceBitSchema).max(XGSIM_HOST_MAX_BINDINGS),
  deviceFailSafeValues: z.record(mDeviceBitSchema, z.boolean()),
}).strict().superRefine((payload, context) => {
  const writes = new Set(payload.allowedDeviceWrites.map((address) => address.toUpperCase()));
  const safeValues = new Set(Object.keys(payload.deviceFailSafeValues).map((address) => address.toUpperCase()));
  if (writes.size !== safeValues.size || [...writes].some((address) => !safeValues.has(address))) {
    context.addIssue({ code: 'custom', path: ['deviceFailSafeValues'], message: 'Every writable M device requires exactly one fail-safe value.' });
  }
});

export const XgSimHostRequestSchema = z.discriminatedUnion('command', [
  z.object({ ...envelope, command: z.literal('hello'), payload: emptyPayloadSchema }).strict(),
  z.object({ ...envelope, command: z.literal('probe'), payload: z.object({
    base: z.number().int().nonnegative().max(255), slot: z.number().int().nonnegative().max(255),
  }).strict() }).strict(),
  z.object({ ...envelope, command: z.literal('connect'), payload: connectPayloadSchema }).strict(),
  z.object({ ...envelope, command: z.literal('readSnapshot'), payload: emptyPayloadSchema }).strict(),
  z.object({ ...envelope, command: z.literal('writeInputImage'), payload: z.object({ values: writeValuesSchema }).strict() }).strict(),
  z.object({ ...envelope, command: z.literal('getStatus'), payload: emptyPayloadSchema }).strict(),
  z.object({ ...envelope, command: z.literal('disconnect'), payload: emptyPayloadSchema }).strict(),
  z.object({ ...envelope, command: z.literal('shutdown'), payload: emptyPayloadSchema }).strict(),
]);

export type XgSimHostRequest = z.infer<typeof XgSimHostRequestSchema>;

export const XgSimHostResponseSchema = z.object({
  protocolVersion: z.literal(XGSIM_HOST_PROTOCOL_VERSION),
  requestId: requestIdSchema,
  nonce: nonceSchema,
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1), blocked: z.boolean() }).strict().optional(),
}).strict().superRefine((response, context) => {
  if (response.ok === Boolean(response.error)) {
    context.addIssue({ code: 'custom', message: 'Successful responses cannot carry an error and failed responses must carry one.' });
  }
});

export type XgSimHostResponse = z.infer<typeof XgSimHostResponseSchema>;

type HostCommand = XgSimHostRequest['command'];
type PayloadFor<TCommand extends HostCommand> = Extract<XgSimHostRequest, { command: TCommand }>['payload'];

export function createXgSimHostRequest<TCommand extends HostCommand>(
  command: TCommand,
  nonce: string,
  payload: PayloadFor<TCommand>,
): Extract<XgSimHostRequest, { command: TCommand }> {
  return {
    protocolVersion: XGSIM_HOST_PROTOCOL_VERSION,
    requestId: globalThis.crypto.randomUUID(),
    nonce,
    command,
    payload,
  } as Extract<XgSimHostRequest, { command: TCommand }>;
}
