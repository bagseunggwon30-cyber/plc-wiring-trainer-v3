import { z } from 'zod';

export const EvidenceLevelSchema = z.enum(['educational', 'manual-verified', 'bench-verified']);
export const VerificationStatusSchema = z.enum(['PASS', 'FAIL', 'BLOCKED']);

export const EvidenceDocumentSchema = z.object({
  documentId: z.string().min(1),
  revision: z.string().min(1),
  pages: z.array(z.number().int().positive()).min(1),
  sha256: z.string().regex(/^[A-F0-9]{64}$/),
  notes: z.string().min(1),
});

export const TerminalSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  domain: z.enum(['ac', 'dc', 'pe', 'signal', 'communication', 'floating']),
  potential: z.enum(['L1', 'L2', 'L3', 'N', '+24V', '0V', 'PE', 'floating', 'signal']),
  role: z.enum([
    'source',
    'supply-input',
    'input',
    'output',
    'common',
    'protective-earth',
    'dry-contact',
    'communication',
    'not-connected',
  ]),
  phase: z.enum(['L1', 'L2', 'L3', 'N']).optional(),
  comGroup: z.string().optional(),
  channel: z.string().optional(),
  protocol: z.enum(['RS232', 'RS485', 'analog-voltage', 'analog-current']).optional(),
  ratedVoltage: z
    .object({ min: z.number(), max: z.number(), unit: z.enum(['VAC', 'VDC']) })
    .refine((range) => range.max >= range.min, 'rated voltage max must be >= min')
    .optional(),
});

export const DeviceProfileSchema = z.object({
  profileId: z.string().min(1),
  version: z.string().min(1),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  variant: z.string().optional(),
  evidence: z.object({
    level: EvidenceLevelSchema,
    documents: z.array(EvidenceDocumentSchema),
    reviewer: z.string().optional(),
    reviewedAt: z.string().optional(),
    note: z.string().optional(),
  }),
  boundary: z.boolean(),
  includeInBom: z.boolean(),
  terminals: z.array(TerminalSpecSchema),
  internalLinks: z.array(
    z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      kind: z.enum(['conductive', 'dynamic-contact']),
      stateKey: z.string().optional(),
    }),
  ),
  behavior: z.record(z.string(), z.unknown()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export const TerminalRefSchema = z.object({ deviceId: z.string().min(1), terminalId: z.string().min(1) });

export const WorkshopDocumentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    mode: z.enum(['practice', 'prewire']),
    revision: z.number().int().nonnegative(),
    name: z.string().min(1),
    source: z.object({
      kind: z.enum(['native-v2', 'legacy-v1']),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    devices: z.array(
      z.object({
        id: z.string().min(1),
        profileId: z.string().min(1),
        profileVersion: z.string().min(1),
        evidenceLevel: EvidenceLevelSchema,
        legacyType: z.string().optional(),
        missingProfile: z.boolean(),
        x: z.number(),
        y: z.number(),
        rotation: z.number(),
        configuration: z.record(z.string(), z.unknown()),
      }),
    ),
    wires: z.array(
      z.object({
        id: z.string().min(1),
        from: TerminalRefSchema,
        to: TerminalRefSchema,
        color: z.string().optional(),
        tag: z.string().optional(),
        gauge: z.string().optional(),
        waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
      }),
    ),
    jumpers: z.array(
      z.object({ id: z.string().min(1), deviceId: z.string().min(1), terminalIds: z.array(z.string()).min(2) }),
    ),
    layout: z.record(z.string(), z.unknown()),
    settings: z.record(z.string(), z.unknown()),
    extensions: z.object({ legacy: z.record(z.string(), z.unknown()) }),
  })
  .passthrough();

