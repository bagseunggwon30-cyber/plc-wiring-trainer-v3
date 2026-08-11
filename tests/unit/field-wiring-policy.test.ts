import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIELD_WIRE_COLORS,
  defaultFerruleTerminalNumbers,
  fieldWireColorForConnectionText,
  fieldWireColorForTerminals,
} from '../../src/domain/field-wiring-policy';
import type { TerminalSpec } from '../../src/domain/types';

function terminal(overrides: Partial<TerminalSpec>): TerminalSpec {
  return {
    id: 'T',
    label: 'terminal',
    domain: 'floating',
    potential: 'floating',
    role: 'common',
    polarity: 'none',
    ...overrides,
  };
}

describe('field wiring color and ferrule policy', () => {
  it('uses brown, black and gray for R/S/T and green for FE/PE', () => {
    const through = terminal({ id: 'XT1' });
    const phase = (id: string, phaseName: 'L1' | 'L2' | 'L3' | 'U' | 'V' | 'W') => terminal({
      id,
      domain: 'ac',
      potential: 'floating',
      role: 'source',
      polarity: 'line',
      phase: phaseName,
    });

    expect(fieldWireColorForTerminals(phase('R', 'L1'), through)).toBe(FIELD_WIRE_COLORS.R);
    expect(fieldWireColorForTerminals(phase('S', 'L2'), through)).toBe(FIELD_WIRE_COLORS.S);
    expect(fieldWireColorForTerminals(phase('T', 'L3'), through)).toBe(FIELD_WIRE_COLORS.T);
    expect(fieldWireColorForTerminals(phase('U', 'U'), through)).toBe(FIELD_WIRE_COLORS.R);
    expect(fieldWireColorForTerminals(phase('V', 'V'), through)).toBe(FIELD_WIRE_COLORS.S);
    expect(fieldWireColorForTerminals(phase('W', 'W'), through)).toBe(FIELD_WIRE_COLORS.T);

    const pe = terminal({
      id: 'PE', domain: 'pe', potential: 'PE', role: 'protective-earth', polarity: 'protective-earth',
    });
    const fe = terminal({ id: 'FE', label: 'FE' });
    expect(fieldWireColorForTerminals(pe, through)).toBe(FIELD_WIRE_COLORS.FE);
    expect(fieldWireColorForTerminals(fe, through)).toBe(FIELD_WIRE_COLORS.FE);
  });

  it('uses yellow for DC, control, analog and communication conductors', () => {
    const examples = [
      terminal({ id: '+24V', domain: 'dc', potential: '+24V', role: 'source', polarity: 'positive' }),
      terminal({ id: 'P03', domain: 'signal', role: 'input', polarity: 'signal-positive' }),
      terminal({ id: 'AI0+', domain: 'signal', role: 'input', polarity: 'signal-positive', protocol: 'analog-voltage' }),
      terminal({ id: 'A+', domain: 'communication', role: 'input', polarity: 'data-positive', protocol: 'RS485' }),
    ];

    for (const example of examples) {
      expect(fieldWireColorForTerminals(example, terminal({ id: 'XT1' }))).toBe(FIELD_WIRE_COLORS.OTHER);
    }
    expect(fieldWireColorForTerminals(
      terminal({ id: 'V+1', domain: 'dc', potential: '+24V', role: 'source', polarity: 'positive' }),
      terminal({ id: '1' }),
    )).toBe(FIELD_WIRE_COLORS.OTHER);
    expect(fieldWireColorForConnectionText('V+1', '24V', 'DC positive')).toBe(FIELD_WIRE_COLORS.OTHER);
    expect(fieldWireColorForConnectionText('V-1', '24G', 'DC return')).toBe(FIELD_WIRE_COLORS.OTHER);
    expect(fieldWireColorForConnectionText('N', 'N', 'AC neutral')).toBe(FIELD_WIRE_COLORS.OTHER);
  });

  it('creates editable ferrule labels from both connected terminal numbers', () => {
    expect(defaultFerruleTerminalNumbers('P03', '14')).toEqual({ from: 'P03', to: '14' });
    expect(defaultFerruleTerminalNumbers('  ', '22')).toEqual({ from: null, to: '22' });
  });

  it('binds the prepared Imagen assets and renders editable, visible ferrule sleeves', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain("const CODEX_BOM=CODEX+'bom/';");
    expect(html).toContain("image:CODEX_BOM+'boundary-ac-source-imagen-v1.png'");
    expect(html).toContain("image:CODEX_BOM+'pushbutton-no-green-imagen-v1.png'");
    expect(html).toContain("image:CODEX_BOM+'pushbutton-nc-red-imagen-v1.png'");
    expect(html).toContain("image:CODEX_BOM+'lamp-green-imagen-v1.png'");
    expect(html).toContain("image:CODEX_BOM+'lamp-yellow-imagen-v1.png'");
    expect(html).toContain("image:CODEX_BOM+'lamp-white-imagen-v1.png'");
    expect(html).toContain("image:XBC_DN60SU_IMAGE");
    expect(html).toContain("appendFerrule(pa,fromDef,ferruleFrom,'wire-ferrule-from')");
    expect(html).toContain("appendFerrule(pb,toDef,ferruleTo,'wire-ferrule-to')");
    expect(html).toContain('editWireFerrule(w,endpoint)');
    expect(html).toContain("group.setAttribute('tabindex','0')");
    expect(html).toMatch(/\.wire-ferrule\{pointer-events:all;cursor:text\}/);
  });
});
