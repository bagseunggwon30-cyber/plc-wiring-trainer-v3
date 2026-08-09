import { z } from 'zod';

const hashSchema = z.string().regex(/^[A-Fa-f0-9]{64}$/, 'Expected a SHA-256 hex digest.');

export const AssetViewSchema = z.enum(['front', 'rear', 'left', 'right', 'top', 'bottom', 'terminal']);
export const PixelDimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
}).strict();
export const PhysicalDimensionsMmSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive(),
}).strict();
export const AssetApprovalSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved'), reviewer: z.string().min(1), approvedAt: z.string().date() }).strict(),
  z.object({ status: z.literal('pending') }).strict(),
  z.object({ status: z.literal('rejected'), reason: z.string().min(1) }).strict(),
]);
export const TerminalCenterCalibrationSchema = z.object({
  basis: z.enum(['manual-overlay', 'raster-terminal-centres']),
  measuredAt: z.string().datetime(),
  method: z.string().min(1),
  referenceDocumentId: z.string().min(1),
  referencePages: z.array(z.number().int().positive()).min(1),
  requiredTerminalCount: z.number().int().positive(),
  sampleCount: z.number().int().nonnegative(),
  rmsErrorPx: z.number().nonnegative(),
  maxErrorPx: z.number().nonnegative(),
  thresholds: z.object({ rmsPx: z.number().positive(), maxPx: z.number().positive() }).strict(),
  result: z.enum(['pass', 'fail']),
  note: z.string().min(1),
}).strict().superRefine((measurement, context) => {
  const passesNumbers = measurement.sampleCount === measurement.requiredTerminalCount
    && measurement.rmsErrorPx <= measurement.thresholds.rmsPx
    && measurement.maxErrorPx <= measurement.thresholds.maxPx;
  if ((measurement.result === 'pass') !== passesNumbers) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['result'],
      message: 'Calibration result must match sample completeness and RMS/max thresholds.',
    });
  }
});
export const AssetManifestEntrySchema = z.object({
  assetId: z.string().min(1),
  model: z.string().min(1),
  view: AssetViewSchema,
  path: z.string().min(1),
  sha256: hashSchema,
  pixelDimensions: PixelDimensionsSchema,
  /** Null is allowed only while an exact physical envelope remains unverified. */
  physicalDimensionsMm: PhysicalDimensionsMmSchema.nullable(),
  prompt: z.string().min(1),
  generatedAt: z.string().datetime(),
  approval: AssetApprovalSchema,
  geometryHash: hashSchema,
  terminalCenterCalibration: TerminalCenterCalibrationSchema.optional(),
}).strict().superRefine((entry, context) => {
  if (entry.approval.status === 'approved' && entry.physicalDimensionsMm === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['physicalDimensionsMm'],
      message: 'Approved assets require manual-backed physical dimensions.',
    });
  }
  if (entry.approval.status === 'approved' && entry.terminalCenterCalibration?.result !== 'pass') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['terminalCenterCalibration'],
      message: 'Approved assets require a complete passing terminal-centre calibration.',
    });
  }
});

export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;
export type AssetApproval = z.infer<typeof AssetApprovalSchema>;
export type TerminalCenterCalibration = z.infer<typeof TerminalCenterCalibrationSchema>;

export interface ApprovedAssetAllowlist {
  readonly entriesById: ReadonlyMap<string, Readonly<AssetManifestEntry>>;
}

export function approvedAssetAllowlist(entries: readonly AssetManifestEntry[]): ApprovedAssetAllowlist {
  const parsedEntries = entries.map((entry) => AssetManifestEntrySchema.parse(entry));
  const entriesById = new Map<string, Readonly<AssetManifestEntry>>();

  for (const entry of parsedEntries) {
    if (entriesById.has(entry.assetId)) throw new Error(`Duplicate assetId in approved asset manifest: ${entry.assetId}`);
    entriesById.set(entry.assetId, entry);
  }

  return { entriesById };
}

export function isApprovedAsset(
  allowlist: ApprovedAssetAllowlist,
  assetId: string,
  geometryHash: string,
): boolean {
  const entry = allowlist.entriesById.get(assetId);
  return entry?.approval.status === 'approved' && entry.geometryHash === geometryHash;
}
