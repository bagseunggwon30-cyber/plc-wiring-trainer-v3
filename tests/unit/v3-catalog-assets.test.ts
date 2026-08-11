import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPROVED_ASSET_MANIFEST } from '../../src/catalog/assets/approved-manifest';
import { approvedAssetAllowlist, isApprovedAsset } from '../../src/catalog/v3-asset-manifest';

describe('v3 approved asset allowlist', () => {
  it('admits only approved assets whose geometry hash remains pinned', () => {
    const allowlist = approvedAssetAllowlist([
      {
        assetId: 'approved-test-front',
        model: 'test-model',
        view: 'front',
        path: 'assets/test/front.png',
        sha256: 'A'.repeat(64),
        pixelDimensions: { width: 800, height: 600 },
        physicalDimensionsMm: { width: 100, height: 100, depth: 100 },
        prompt: 'Synthetic unit-test asset metadata.',
        generatedAt: '2026-07-09T00:00:00.000Z',
        approval: { status: 'approved', reviewer: 'project-manual-review', approvedAt: '2026-07-10' },
        geometryHash: 'B'.repeat(64),
        terminalCenterCalibration: {
          basis: 'manual-overlay', measuredAt: '2026-08-09T00:00:00.000Z', method: 'browser pointer-centre comparison',
          referenceDocumentId: 'manual.pdf', referencePages: [1], requiredTerminalCount: 1, sampleCount: 1,
          rmsErrorPx: 0, maxErrorPx: 0, thresholds: { rmsPx: 3, maxPx: 5 }, result: 'pass', note: 'fixture',
        },
      },
      {
        assetId: 'pending-test-rear',
        model: 'test-model',
        view: 'rear',
        path: 'assets/test/rear.png',
        sha256: 'C'.repeat(64),
        pixelDimensions: { width: 800, height: 600 },
        physicalDimensionsMm: { width: 100, height: 100, depth: 100 },
        prompt: 'Synthetic pending unit-test asset metadata.',
        generatedAt: '2026-07-09T00:00:00.000Z',
        approval: { status: 'pending' },
        geometryHash: 'D'.repeat(64),
      },
    ]);

    expect(isApprovedAsset(allowlist, 'approved-test-front', 'B'.repeat(64))).toBe(true);
    expect(isApprovedAsset(allowlist, 'approved-test-front', 'wrong')).toBe(false);
    expect(isApprovedAsset(allowlist, 'pending-test-rear', 'D'.repeat(64))).toBe(false);
    expect(isApprovedAsset(allowlist, 'unknown', 'B'.repeat(64))).toBe(false);
  });

  it('registers new Imagen exact-model skins as pending rather than silently approving them', () => {
    const expected = [
      'codex:xbc-dn60su-imagen-v1',
      'codex:xbc-dn-dp32up-imagen-v1',
      'codex:xbl-c41a-imagen-v1',
      'codex:xbf-pd02a-imagen-v1',
      'existing:my2n-flat-v1',
      'codex:mc-22b-dc24-imagen-v2',
      'codex:eocr3de-05duh-imagen-v1',
      'codex:phoenix-ut25-3044076-imagen-v1',
      'codex:phoenix-ut25pe-3044092-imagen-v1',
      'codex:phoenix-ut4-hesi-3046032-imagen-v1',
    ];

    for (const assetId of expected) {
      const entry = APPROVED_ASSET_MANIFEST.entriesById.get(assetId);
      expect(entry?.approval.status).toBe('pending');
      expect(isApprovedAsset(APPROVED_ASSET_MANIFEST, assetId, entry?.geometryHash ?? '')).toBe(false);
      expect(createHash('sha256').update(readFileSync(resolve(process.cwd(), entry?.path ?? '')))
        .digest('hex').toUpperCase()).toBe(entry?.sha256);
    }
  });

  it('allows unknown physical size only while an asset remains unapproved', () => {
    expect(() => approvedAssetAllowlist([{
      assetId: 'unknown-size-approved', model: 'test-model', view: 'front', path: 'asset.png',
      sha256: 'A'.repeat(64), pixelDimensions: { width: 100, height: 100 }, physicalDimensionsMm: null,
      prompt: 'Test asset.', generatedAt: '2026-08-09T00:00:00.000Z',
      approval: { status: 'approved', reviewer: 'reviewer', approvedAt: '2026-08-09' },
      geometryHash: 'B'.repeat(64),
      terminalCenterCalibration: {
        basis: 'manual-overlay', measuredAt: '2026-08-09T00:00:00.000Z', method: 'fixture',
        referenceDocumentId: 'manual.pdf', referencePages: [1], requiredTerminalCount: 1, sampleCount: 1,
        rmsErrorPx: 0, maxErrorPx: 0, thresholds: { rmsPx: 3, maxPx: 5 }, result: 'pass', note: 'fixture',
      },
    }])).toThrow('manual-backed physical dimensions');
  });
});
