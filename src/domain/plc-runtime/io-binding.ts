import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const nonEmptyText = z.string().trim().min(1);
const nonceSchema = z.string().regex(/^[a-f0-9]{32,128}$/i);
const inputChannelPattern = /^B\d+S\d+\.IN\d+$/i;
const outputChannelPattern = /^B\d+S\d+\.OUT\d+$/i;
const deviceAddressPattern = /^(?:M[0-9]{4}[0-9A-F]|[PDFTU]\d{5})$/i;
const writableMDevicePattern = /^M[0-9]{4}[0-9A-F]$/i;

export const PlcRuntimeValueSchema = z.union([z.boolean(), z.number().finite()]);

export const IoBindingV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: nonEmptyText,
  deviceInstanceId: nonEmptyText,
  terminalId: nonEmptyText,
  cpuModel: nonEmptyText,
  projectId: nonEmptyText,
  symbolName: nonEmptyText,
  address: nonEmptyText,
  direction: z.enum(['input', 'output', 'internal-request', 'parameter', 'monitor']),
  dataType: z.enum(['BOOL', 'WORD', 'DWORD', 'REAL']),
  inverted: z.boolean(),
  normalState: PlcRuntimeValueSchema,
  communicationLossState: PlcRuntimeValueSchema,
  access: z.object({ read: z.boolean(), write: z.boolean() }).strict(),
  projectSha256: sha256Schema,
}).strict().superRefine((binding, context) => {
  const isChannel = inputChannelPattern.test(binding.address) || outputChannelPattern.test(binding.address);
  if (!isChannel && !deviceAddressPattern.test(binding.address)) {
    context.addIssue({ code: 'custom', path: ['address'], message: 'Unsupported XG5000 address format.' });
  }
  if (binding.direction === 'input' && !inputChannelPattern.test(binding.address) && !writableMDevicePattern.test(binding.address)) {
    context.addIssue({ code: 'custom', path: ['address'], message: 'Input bindings require a documented IN channel or an M-device bridge.' });
  }
  if (binding.direction === 'output' && !outputChannelPattern.test(binding.address) && !writableMDevicePattern.test(binding.address)) {
    context.addIssue({ code: 'custom', path: ['address'], message: 'Output bindings require a documented OUT channel or an M-device monitor.' });
  }
  if (binding.direction === 'internal-request' && !writableMDevicePattern.test(binding.address)) {
    context.addIssue({ code: 'custom', path: ['address'], message: 'Internal request bindings require an M-device address.' });
  }
  if (binding.access.write && binding.direction !== 'input' && binding.direction !== 'internal-request') {
    context.addIssue({ code: 'custom', path: ['access', 'write'], message: 'Only input and internal-request bindings may be writable.' });
  }
  if (binding.direction === 'output' && !binding.access.read) {
    context.addIssue({ code: 'custom', path: ['access', 'read'], message: 'Output bindings must be readable.' });
  }
  if (binding.dataType === 'BOOL') {
    if (typeof binding.normalState !== 'boolean') {
      context.addIssue({ code: 'custom', path: ['normalState'], message: 'BOOL bindings require boolean states.' });
    }
    if (typeof binding.communicationLossState !== 'boolean') {
      context.addIssue({ code: 'custom', path: ['communicationLossState'], message: 'BOOL bindings require boolean fail-safe states.' });
    }
  } else if (typeof binding.normalState !== 'number' || typeof binding.communicationLossState !== 'number') {
    context.addIssue({ code: 'custom', path: ['normalState'], message: 'Numeric bindings require numeric states.' });
  }
});

export type IoBindingV1 = z.infer<typeof IoBindingV1Schema>;

export const PlcRuntimeConfigurationV1Schema = z.object({
  schemaVersion: z.literal(1),
  adapter: z.enum(['mock', 'xgsim']),
  pollIntervalMs: z.number().int().min(10).max(1_000),
  bindings: z.array(IoBindingV1Schema).max(256),
}).strict().superRefine((configuration, context) => {
  const ids = new Set<string>();
  const addresses = new Set<string>();
  configuration.bindings.forEach((binding, index) => {
    const addressKey = `${binding.projectSha256}:${binding.address.toUpperCase()}`;
    if (ids.has(binding.id)) {
      context.addIssue({ code: 'custom', path: ['bindings', index, 'id'], message: 'Duplicate binding id.' });
    }
    if (addresses.has(addressKey)) {
      context.addIssue({ code: 'custom', path: ['bindings', index, 'address'], message: 'Duplicate runtime address.' });
    }
    ids.add(binding.id);
    addresses.add(addressKey);
  });
});

export type PlcRuntimeConfigurationV1 = z.infer<typeof PlcRuntimeConfigurationV1Schema>;

export const PlcRuntimeConnectRequestSchema = z.object({
  sessionNonce: nonceSchema,
  cpuModel: nonEmptyText,
  projectId: nonEmptyText,
  projectSha256: sha256Schema,
  base: z.number().int().nonnegative().max(255),
  slot: z.number().int().nonnegative().max(255),
  bindings: z.array(IoBindingV1Schema).max(256),
}).strict().superRefine((request, context) => {
  request.bindings.forEach((binding, index) => {
    if (binding.projectSha256.toLowerCase() !== request.projectSha256.toLowerCase()) {
      context.addIssue({ code: 'custom', path: ['bindings', index, 'projectSha256'], message: 'Binding project hash mismatch.' });
    }
    if (binding.cpuModel !== request.cpuModel || binding.projectId !== request.projectId) {
      context.addIssue({ code: 'custom', path: ['bindings', index], message: 'Binding project identity mismatch.' });
    }
  });
});

export function isWritableRuntimeBinding(binding: IoBindingV1): boolean {
  return binding.access.write && (binding.direction === 'input' || binding.direction === 'internal-request');
}

export function isInputChannelAddress(address: string): boolean {
  return inputChannelPattern.test(address);
}

export function isOutputChannelAddress(address: string): boolean {
  return outputChannelPattern.test(address);
}

export function isMDeviceBitAddress(address: string): boolean {
  return writableMDevicePattern.test(address);
}
