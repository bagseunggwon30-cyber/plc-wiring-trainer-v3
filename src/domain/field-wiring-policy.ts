import { wireConductorVisual, type TerminalConductorVisual } from './terminal-semantics';
import type { TerminalSpec } from './types';

/**
 * Project/company wire-colour policy requested for this trainer.
 * It is deliberately kept separate from electrical semantics and must not be
 * presented as an IEC colour-compliance decision.
 */
export const FIELD_WIRE_COLORS = Object.freeze({
  R: '#8b4513',
  S: '#111111',
  T: '#6b7280',
  FE: '#15803d',
  OTHER: '#facc15',
});

type FieldPhase = 'R' | 'S' | 'T';

function normalizedTerminalText(terminal: TerminalSpec): string {
  return `${terminal.id} ${terminal.label}`.trim().toUpperCase();
}

function terminalPhase(terminal: TerminalSpec): FieldPhase | null {
  if (terminal.phase === 'L1' || terminal.phase === 'U') return 'R';
  if (terminal.phase === 'L2' || terminal.phase === 'V') return 'S';
  if (terminal.phase === 'L3' || terminal.phase === 'W') return 'T';
  if (terminal.domain !== 'ac') return null;

  const text = normalizedTerminalText(terminal);
  if (/(^|[^A-Z0-9])(R|L1|1L1|2T1|U)(?=$|[^A-Z0-9])/.test(text)) return 'R';
  if (/(^|[^A-Z0-9])(S|L2|3L2|4T2|V)(?=$|[^A-Z0-9])/.test(text)) return 'S';
  if (/(^|[^A-Z0-9])(T|L3|5L3|6T3|W)(?=$|[^A-Z0-9])/.test(text)) return 'T';
  return null;
}

function isEarthTerminal(terminal: TerminalSpec): boolean {
  if (terminal.domain === 'pe' || terminal.polarity === 'protective-earth') return true;
  return /(^|[^A-Z0-9])(FE|FG|PE)(?=$|[^A-Z0-9])/.test(normalizedTerminalText(terminal));
}

export function fieldWireColorForTerminals(left: TerminalSpec, right: TerminalSpec): string {
  if (isEarthTerminal(left) || isEarthTerminal(right)) return FIELD_WIRE_COLORS.FE;
  const phase = terminalPhase(left) ?? terminalPhase(right);
  return phase ? FIELD_WIRE_COLORS[phase] : FIELD_WIRE_COLORS.OTHER;
}

export function fieldWireConductorVisual(
  left: TerminalSpec,
  right: TerminalSpec,
): TerminalConductorVisual {
  return {
    ...wireConductorVisual(left, right),
    color: fieldWireColorForTerminals(left, right),
  };
}

export function fieldWireColorForConnectionText(...values: readonly string[]): string {
  const text = values.join(' ').trim().toUpperCase();
  if (/(^|[^A-Z0-9])(FE|FG|PE)(?=$|[^A-Z0-9])/.test(text)) return FIELD_WIRE_COLORS.FE;
  // Do not misread DC labels such as V+1 or 24V as the V/S phase.
  if (/(^|[^A-Z0-9])(24V|24G|0V|DC(?:\+|-)?|V\+\d*|V-\d*)(?=$|[^A-Z0-9])/.test(text)) {
    return FIELD_WIRE_COLORS.OTHER;
  }
  if (/(^|[^A-Z0-9])(R|L1|1L1|2T1|U)(?=$|[^A-Z0-9])/.test(text)) return FIELD_WIRE_COLORS.R;
  if (/(^|[^A-Z0-9])(S|L2|3L2|4T2|V)(?=$|[^A-Z0-9])/.test(text)) return FIELD_WIRE_COLORS.S;
  if (/(^|[^A-Z0-9])(T|L3|5L3|6T3|W)(?=$|[^A-Z0-9])/.test(text)) return FIELD_WIRE_COLORS.T;
  return FIELD_WIRE_COLORS.OTHER;
}

export function defaultFerruleTerminalNumbers(
  fromTerminalId: string | null | undefined,
  toTerminalId: string | null | undefined,
): { from: string | null; to: string | null } {
  const normalize = (value: string | null | undefined): string | null => value?.trim() || null;
  return { from: normalize(fromTerminalId), to: normalize(toTerminalId) };
}
