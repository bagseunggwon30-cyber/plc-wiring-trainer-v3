import { describe, expect, it } from 'vitest';
import {
  createModeSelectorMarkup,
  isLegacyTypeAllowed,
  modePolicy,
  normalizeWorkshopMode,
} from '../../src/renderer/mode-controller';

describe('practice and prewire mode policy', () => {
  it('keeps auto-wiring available only in practice mode', () => {
    expect(modePolicy('practice').allowAutoWire).toBe(true);
    expect(modePolicy('prewire').allowAutoWire).toBe(false);
  });

  it('limits prewire mode to verified equipment and logical boundaries', () => {
    for (const type of [
      'XBC-DR32H', 'XBF-AH04A', 'MDR-100', 'MC-22B-DC24', 'MY2N', 'EOCR3DE-05DUH',
      'UT-2.5', 'UT-2.5-PE', 'UT-4-HESI',
      'BOUNDARY-AC', 'BOUNDARY-DC', 'BOUNDARY-CONTACT', 'BOUNDARY-LOAD',
      'BOUNDARY-ANALOG-V', 'BOUNDARY-ANALOG-I',
      'BOUNDARY-ANALOG-V-IN', 'BOUNDARY-ANALOG-I-IN', 'BOUNDARY-2W-I', 'BOUNDARY-RS485',
    ]) {
      expect(isLegacyTypeAllowed('prewire', type)).toBe(true);
    }
    for (const type of [
      'IG5A', 'MY-MD02', 'PROX-NPN', 'PROX-PNP', 'PSU24', 'MOTOR-3P',
      'LAMP-G', 'LAMP-Y', 'LAMP-W', 'LAMP', 'BUZZER', 'SOL-Y', 'TB4', 'TB10',
      'MCCB', 'PB-1C',
    ]) {
      expect(isLegacyTypeAllowed('prewire', type)).toBe(false);
      expect(isLegacyTypeAllowed('practice', type)).toBe(true);
    }
  });

  it('normalizes corrupt persisted values safely', () => {
    expect(normalizeWorkshopMode('prewire')).toBe('prewire');
    expect(normalizeWorkshopMode('anything-else')).toBe('practice');
    expect(normalizeWorkshopMode(null)).toBe('practice');
  });

  it('generates a blocking accessible startup choice', () => {
    const markup = createModeSelectorMarkup('practice');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-workshop-mode="practice"');
    expect(markup).toContain('data-workshop-mode="prewire"');
    expect(markup).toContain('연습 모드');
    expect(markup).toContain('사전 결선 검토');
  });
});
