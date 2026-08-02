import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import {
  generateReviewReport,
  serializeReviewReport,
  type ReviewReport,
} from '../../src/domain/report';
import { sha256 } from '../../src/domain/migration';
import type { ValidationResult } from '../../src/domain/engine-types';
import type { DeviceInstanceV2, WorkshopDocumentV2 } from '../../src/domain/types';

function instance(
  id: string,
  profileId: string,
  overrides: Partial<DeviceInstanceV2> = {},
): DeviceInstanceV2 {
  const profile = DEVICE_PROFILES[profileId];
  return {
    id,
    profileId,
    profileVersion: profile?.version ?? 'missing-v1',
    evidenceLevel: profile?.evidence.level ?? 'educational',
    missingProfile: !profile,
    x: 0,
    y: 0,
    rotation: 0,
    configuration: {},
    ...overrides,
  };
}

function workshop(): WorkshopDocumentV2 {
  return {
    schemaVersion: 2,
    mode: 'prewire',
    revision: 7,
    name: 'review report fixture',
    source: { kind: 'native-v2', hash: 'a'.repeat(64) },
    devices: [
      instance('psu', 'mean-well:mdr-100-24', {
        configuration: { outputVoltage: 24, trimLocked: true },
      }),
      instance('plc', 'ls-electric:xbc-dr32h', {
        configuration: { inputMode: 'sink', station: 1 },
      }),
      instance('mains', 'boundary:ac-supply'),
    ],
    wires: [
      {
        id: 'w-neutral',
        from: { deviceId: 'mains', terminalId: 'N' },
        to: { deviceId: 'psu', terminalId: 'N' },
        color: 'blue',
        tag: 'N01',
      },
      {
        id: 'w-line',
        from: { deviceId: 'mains', terminalId: 'L1' },
        to: { deviceId: 'psu', terminalId: 'L' },
        color: 'black',
        gauge: '1.5mm2',
      },
    ],
    jumpers: [
      { id: 'j-positive', deviceId: 'psu', terminalIds: ['V+1', 'V+2'] },
    ],
    layout: { cabinet: 'demo' },
    settings: { voltageSystem: '1P2W' },
    extensions: { legacy: {} },
  };
}

async function validation(
  document: WorkshopDocumentV2,
  overrides: Partial<ValidationResult> = {},
): Promise<ValidationResult> {
  return {
    status: 'PASS',
    issues: [
      {
        code: 'WIRE_LABEL_RECOMMENDED',
        severity: 'quality',
        blocking: false,
        message: 'Label the line wire.',
        refs: ['w-line', 'psu:L'],
        scenarioId: 'default',
      },
    ],
    documentRevision: document.revision,
    documentHash: await sha256(document),
    checkedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('review report generation', () => {
  it('creates a deterministic verified report with complete traceability', async () => {
    const document = workshop();
    const result = await validation(document);

    const first = await generateReviewReport(document, result, DEVICE_PROFILES);
    const second = await generateReviewReport(document, result, DEVICE_PROFILES);

    expect(first).toEqual(second);
    expect(serializeReviewReport(first)).toBe(serializeReviewReport(second));
    expect(JSON.parse(serializeReviewReport(first))).toEqual(first);
    const { reportHash, ...reportPayload } = first;
    expect(reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reportHash).toBe(await sha256(reportPayload));
    expect(first.classification).toBe('LEGACY_DIAGNOSTIC');
    expect(first.eligibility).toEqual({
      eligible: false,
      status: 'BLOCKED',
      reason: 'Legacy v2 validation is diagnostic-only; rerun the review with the v3 closed-loop engine.',
    });
    expect(first.document).toMatchObject({
      schemaVersion: 2,
      mode: 'prewire',
      revision: 7,
      validationRevision: 7,
      validationHash: first.document.hash,
    });

    expect(first.profileVersions.map((entry) => entry.profileId)).toEqual([
      'boundary:ac-supply',
      'ls-electric:xbc-dr32h',
      'mean-well:mdr-100-24',
    ]);
    expect(first.pinToPin.map((entry) => [entry.kind, entry.connectionId])).toEqual([
      ['jumper', 'j-positive'],
      ['wire', 'w-line'],
      ['wire', 'w-neutral'],
    ]);
    expect(first.pinToPin[0]).toMatchObject({
      from: { deviceId: 'psu', terminalId: 'V+1', terminalLabel: '+V' },
      to: { deviceId: 'psu', terminalId: 'V+2', terminalLabel: '+V' },
    });
    expect(first.deviceSettings).toEqual([
      expect.objectContaining({ deviceId: 'plc', configuration: { inputMode: 'sink', station: 1 } }),
      expect.objectContaining({ deviceId: 'psu', configuration: { outputVoltage: 24, trimLocked: true } }),
    ]);
    expect(first.bom.map((entry) => entry.profileId)).toEqual([
      'ls-electric:xbc-dr32h',
      'mean-well:mdr-100-24',
    ]);
    expect(first.bom.flatMap((entry) => entry.deviceIds)).not.toContain('mains');

    const mdrEvidence = first.manualEvidence.find((entry) => entry.profileId === 'mean-well:mdr-100-24');
    expect(mdrEvidence).toMatchObject({
      documentId: '01_MDR-100-24_MeanWell_SPEC.pdf',
      revision: '2025-12-12',
      pages: [1, 2],
      sha256: '9DE6ABE926DF1D33974544D82989964E828C079F7E8B8E0448AE7667ED16E896',
    });
    expect(first.issues).toHaveLength(result.issues.length);
    expect(first.issues[0]).toMatchObject({
      code: 'WIRE_LABEL_RECOMMENDED',
      refs: ['w-line', 'psu:L'],
      scenarioId: 'default',
    });
    expect(first.issues[0].evidence).toContainEqual(expect.objectContaining({
      profileId: 'mean-well:mdr-100-24',
      documentId: '01_MDR-100-24_MeanWell_SPEC.pdf',
      pages: [1, 2],
    }));
  });

  it('expands multi-terminal jumpers into deterministic pin-to-pin segments', async () => {
    const document = workshop();
    document.jumpers = [{ id: 'j3', deviceId: 'psu', terminalIds: ['V+1', 'V+2', 'V-1'] }];
    const report = await generateReviewReport(document, await validation(document), DEVICE_PROFILES);

    expect(report.pinToPin.filter((entry) => entry.kind === 'jumper')).toEqual([
      expect.objectContaining({ connectionId: 'j3', segment: 1, from: expect.objectContaining({ terminalId: 'V+1' }), to: expect.objectContaining({ terminalId: 'V+2' }) }),
      expect.objectContaining({ connectionId: 'j3', segment: 2, from: expect.objectContaining({ terminalId: 'V+1' }), to: expect.objectContaining({ terminalId: 'V-1' }) }),
    ]);
  });

  it.each([
    ['failed validation', (doc: WorkshopDocumentV2, value: ValidationResult) => ({ doc, value: { ...value, status: 'FAIL' as const } })],
    ['blocked validation', (doc: WorkshopDocumentV2, value: ValidationResult) => ({ doc, value: { ...value, status: 'BLOCKED' as const } })],
    ['stale validation', (doc: WorkshopDocumentV2, value: ValidationResult) => { doc.revision += 1; return { doc, value }; }],
    ['practice mode', (doc: WorkshopDocumentV2, value: ValidationResult) => { doc.mode = 'practice'; return { doc, value: { ...value, documentHash: '' } }; }],
    ['educational profile', (doc: WorkshopDocumentV2, value: ValidationResult) => {
      doc.devices = [instance('drive', 'ls-electric:sv-ig5a')];
      return { doc, value: { ...value, documentHash: '' } };
    }],
    ['local downgrade', (doc: WorkshopDocumentV2, value: ValidationResult) => {
      doc.devices[0].evidenceLevel = 'educational';
      return { doc, value: { ...value, documentHash: '' } };
    }],
    ['missing profile', (doc: WorkshopDocumentV2, value: ValidationResult) => {
      doc.devices = [instance('unknown', 'vendor:missing')];
      return { doc, value: { ...value, documentHash: '' } };
    }],
  ])('emits a diagnostic, never verified, for %s', async (_name, arrange) => {
    const original = workshop();
    const originalValidation = await validation(original);
    const { doc, value } = arrange(original, originalValidation);
    if (value.documentHash === '') value.documentHash = await sha256(doc);

    const report: ReviewReport = await generateReviewReport(doc, value, DEVICE_PROFILES);

    expect(report.classification).toBe('LEGACY_DIAGNOSTIC');
    expect(report.eligibility.eligible).toBe(false);
    expect(report.pinToPin).toBeDefined();
    expect(report.profileVersions).toBeDefined();
  });

  it('preserves every validation issue and uses empty evidence when no device can be resolved', async () => {
    const document = workshop();
    const result = await validation(document, {
      status: 'FAIL',
      issues: [
        {
          code: 'GLOBAL_POLICY', severity: 'function', blocking: true,
          message: 'Global policy failed.', refs: ['policy'], scenarioId: 'forced-output-on',
        },
        {
          code: 'PHASE_NEUTRAL_MISMATCH', severity: 'danger', blocking: true,
          message: 'Wrong phase.', refs: ['w-line', 'psu:N'],
        },
      ],
    });

    const report = await generateReviewReport(document, result, DEVICE_PROFILES);

    expect(report.issues.map((issue) => issue.code)).toEqual(['GLOBAL_POLICY', 'PHASE_NEUTRAL_MISMATCH']);
    expect(report.issues[0].evidence).toEqual([]);
    expect(report.issues[1].evidence).toContainEqual(expect.objectContaining({
      profileId: 'mean-well:mdr-100-24',
      sha256: '9DE6ABE926DF1D33974544D82989964E828C079F7E8B8E0448AE7667ED16E896',
    }));
  });

  it('keeps missing installed equipment in the diagnostic BOM while excluding known boundaries', async () => {
    const document = workshop();
    document.devices.push(instance('unknown', 'vendor:missing'));
    const result = await validation(document, { status: 'BLOCKED' });
    const report = await generateReviewReport(document, result, DEVICE_PROFILES);

    expect(report.bom).toContainEqual(expect.objectContaining({
      profileId: 'vendor:missing',
      manufacturer: null,
      model: null,
      deviceIds: ['unknown'],
    }));
    expect(report.bom.flatMap((entry) => entry.deviceIds)).not.toContain('mains');
  });
});
