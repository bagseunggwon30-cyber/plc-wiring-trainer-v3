import { z } from 'zod';
import { IoBindingV1Schema, type IoBindingV1 } from './io-binding';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const isoTimestampSchema = z.string().datetime({ offset: true });
const xgwxFileNameSchema = z.string().trim().min(1).regex(/^[^\\/]+\.xgwx$/i);
const windowsXgwxPathSchema = z.string().trim().regex(/^[A-Za-z]:[\\/].+\.xgwx$/i);

export const XgSimLocalProjectRefV1Schema = z.object({
  schemaVersion: z.literal(1),
  absolutePath: windowsXgwxPathSchema,
  fileName: xgwxFileNameSchema,
  sizeBytes: z.number().int().positive().max(200_000_000),
  modifiedAt: isoTimestampSchema,
  sha256: sha256Schema,
}).strict().superRefine((reference, context) => {
  const pathFileName = reference.absolutePath.split(/[\\/]/).at(-1);
  if (pathFileName?.toLowerCase() !== reference.fileName.toLowerCase()) {
    context.addIssue({ code: 'custom', path: ['fileName'], message: 'Project filename does not match the selected absolute path.' });
  }
});

export type XgSimLocalProjectRefV1 = z.infer<typeof XgSimLocalProjectRefV1Schema>;

export const XgSimTestProjectManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().trim().min(1),
  projectFileName: xgwxFileNameSchema,
  projectSha256: sha256Schema,
  cpuModel: z.string().trim().min(1),
  base: z.number().int().nonnegative().max(255),
  slot: z.number().int().nonnegative().max(255),
  bindings: z.array(IoBindingV1Schema).length(3),
  ladderContract: z.union([z.object({
    kind: z.literal('seal-in-v1'),
    expression: z.literal('stop && (start || run)'),
    startInputBindingId: z.string().trim().min(1),
    stopInputBindingId: z.string().trim().min(1),
    runOutputBindingId: z.string().trim().min(1),
  }).strict(), z.object({
    kind: z.literal('set-reset-v1'),
    expression: z.literal('start_rising_sets_run; stop_resets_run'),
    startInputBindingId: z.string().trim().min(1),
    stopInputBindingId: z.string().trim().min(1),
    runOutputBindingId: z.string().trim().min(1),
  }).strict()]),
  programCheck: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('PASS'),
      errors: z.literal(0),
      warnings: z.number().int().nonnegative(),
      checkedAt: isoTimestampSchema,
      xg5000Version: z.string().trim().min(1),
      xgSimVersion: z.string().trim().min(1),
    }).strict(),
    z.object({
      status: z.literal('PENDING'),
      errors: z.null(),
      warnings: z.null(),
      checkedAt: z.null(),
      xg5000Version: z.string().trim().min(1),
      xgSimVersion: z.string().trim().min(1),
    }).strict(),
  ]),
}).strict().superRefine((manifest, context) => {
  const bindingById = new Map(manifest.bindings.map((binding) => [binding.id, binding]));
  const contractBindings = [
    manifest.ladderContract.startInputBindingId,
    manifest.ladderContract.stopInputBindingId,
    manifest.ladderContract.runOutputBindingId,
  ];
  for (const bindingId of contractBindings) {
    if (!bindingById.has(bindingId)) {
      context.addIssue({ code: 'custom', path: ['ladderContract'], message: `Ladder contract binding is missing: ${bindingId}` });
    }
  }
  for (const [index, binding] of manifest.bindings.entries()) {
    if (binding.projectId !== manifest.projectId
      || binding.projectSha256.toLowerCase() !== manifest.projectSha256.toLowerCase()
      || binding.cpuModel !== manifest.cpuModel) {
      context.addIssue({ code: 'custom', path: ['bindings', index], message: 'Binding identity does not match the project manifest.' });
    }
  }
});

export type XgSimTestProjectManifestV1 = z.infer<typeof XgSimTestProjectManifestV1Schema>;

export interface CreateXbcDr32hSelfHoldManifestEvidence {
  readonly projectSha256: string;
  readonly checkedAt?: string | null;
  readonly xg5000Version: string;
  readonly xgSimVersion: string;
  readonly warnings?: number;
  readonly programCheckStatus?: 'PASS' | 'PENDING';
  readonly projectId?: string;
  readonly projectFileName?: string;
}

function binding(
  projectId: string,
  projectSha256: string,
  id: string,
  terminalId: string,
  address: string,
  direction: 'internal-request' | 'output',
  normalState: boolean,
  communicationLossState: boolean,
): IoBindingV1 {
  return {
    schemaVersion: 1,
    id,
    deviceInstanceId: 'plc1',
    terminalId,
    cpuModel: 'XGB-XBCH',
    projectId,
    symbolName: id.replaceAll('-', '_').toUpperCase(),
    address,
    direction,
    dataType: 'BOOL',
    inverted: false,
    normalState,
    communicationLossState,
    access: { read: true, write: direction === 'internal-request' },
    projectSha256,
  };
}

export function createXbcDr32hSelfHoldManifest(
  evidence: CreateXbcDr32hSelfHoldManifestEvidence,
): XgSimTestProjectManifestV1 {
  const projectSha256 = evidence.projectSha256.toLowerCase();
  const projectId = evidence.projectId ?? 'xbc-dr32h-self-hold-v1';
  return XgSimTestProjectManifestV1Schema.parse({
    schemaVersion: 1,
    projectId,
    projectFileName: evidence.projectFileName ?? '4층_GEMINI.xgwx',
    projectSha256,
    cpuModel: 'XGB-XBCH',
    base: 0,
    slot: 0,
    bindings: [
      binding(projectId, projectSha256, 'start-input', 'P03', 'M00001', 'internal-request', false, false),
      binding(projectId, projectSha256, 'stop-input', 'P02', 'M00002', 'internal-request', false, true),
      binding(projectId, projectSha256, 'run-output', 'P21', 'M00100', 'output', false, false),
    ],
    ladderContract: {
      kind: 'set-reset-v1',
      expression: 'start_rising_sets_run; stop_resets_run',
      startInputBindingId: 'start-input',
      stopInputBindingId: 'stop-input',
      runOutputBindingId: 'run-output',
    },
    programCheck: evidence.programCheckStatus === 'PENDING'
      ? {
          status: 'PENDING', errors: null, warnings: null, checkedAt: null,
          xg5000Version: evidence.xg5000Version, xgSimVersion: evidence.xgSimVersion,
        }
      : {
          status: 'PASS', errors: 0, warnings: evidence.warnings ?? 0,
          checkedAt: evidence.checkedAt,
          xg5000Version: evidence.xg5000Version, xgSimVersion: evidence.xgSimVersion,
        },
  });
}

export function projectReferenceMatchesManifest(
  reference: XgSimLocalProjectRefV1,
  manifest: XgSimTestProjectManifestV1,
): boolean {
  return reference.fileName.toLowerCase() === manifest.projectFileName.toLowerCase()
    && reference.sha256.toLowerCase() === manifest.projectSha256.toLowerCase();
}
