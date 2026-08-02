import { describe, expect, it } from 'vitest';
import {
  assessTerminalCompatibility,
  terminalConductorVisual,
  wireConductorVisual,
} from '../../src/domain/terminal-semantics';
import type { TerminalSpec } from '../../src/domain/types';

function terminal(overrides: Partial<TerminalSpec>): TerminalSpec {
  return {
    id: 'T',
    label: 'T',
    domain: 'floating',
    potential: 'floating',
    role: 'common',
    polarity: 'none',
    ...overrides,
  };
}

describe('terminal electrical compatibility', () => {
  const positive = terminal({
    id: '+24V', label: '+24V', domain: 'dc', potential: '+24V', role: 'source', polarity: 'positive',
  });
  const dcReturn = terminal({
    id: '0V', label: '0V', domain: 'dc', potential: '0V', role: 'source', polarity: 'return',
  });

  it('keeps AC L/N and DC positive/return as different conductor roles', () => {
    const acLine = terminal({
      id: 'L', label: 'L', domain: 'ac', potential: 'L1', role: 'source', polarity: 'line', phase: 'L1',
    });
    const neutral = terminal({
      id: 'N', label: 'N', domain: 'ac', potential: 'N', role: 'source', polarity: 'neutral', phase: 'N',
    });
    const positiveLoad = terminal({
      id: '+', label: 'Load +', domain: 'floating', potential: 'floating', role: 'input', polarity: 'positive',
    });
    const returnLoad = terminal({
      id: '-', label: 'Load -', domain: 'floating', potential: 'floating', role: 'common', polarity: 'return',
    });

    expect(assessTerminalCompatibility(positive, positiveLoad)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(dcReturn, returnLoad)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(positive, returnLoad))
      .toMatchObject({ compatible: false, code: 'DC_POLARITY_MISMATCH', risk: 'safety' });
    expect(assessTerminalCompatibility(dcReturn, positiveLoad))
      .toMatchObject({ compatible: false, code: 'DC_POLARITY_MISMATCH', risk: 'safety' });
    expect(assessTerminalCompatibility(positive, positive))
      .toMatchObject({ compatible: false, code: 'TERMINAL_SOURCE_CONFLICT', risk: 'safety' });
    expect(assessTerminalCompatibility(dcReturn, dcReturn))
      .toMatchObject({ compatible: false, code: 'TERMINAL_SOURCE_CONFLICT', risk: 'safety' });
    expect(assessTerminalCompatibility(positive, dcReturn))
      .toMatchObject({ compatible: false, code: 'DC_POLARITY_MISMATCH', risk: 'safety' });
    expect(assessTerminalCompatibility(acLine, neutral))
      .toMatchObject({ compatible: false, code: 'AC_LINE_NEUTRAL_MISMATCH', risk: 'safety' });
  });

  it('allows a configurable PLC input COM to use either side of one DC source/sink circuit', () => {
    const inputCommon = terminal({
      id: 'COMI',
      label: 'COM',
      polarity: 'configurable',
      commonType: 'configurable-dc',
      comGroup: 'COMI',
    });

    expect(assessTerminalCompatibility(inputCommon, positive)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(inputCommon, dcReturn)).toMatchObject({ compatible: true });
  });

  it('keeps a relay output COM potential-free instead of treating it as a fixed 0V return', () => {
    const relayCommon = terminal({
      id: 'COM0',
      label: 'COM0',
      polarity: 'nonpolar',
      commonType: 'dry-contact',
      comGroup: 'COM0',
    });
    const acLine = terminal({
      id: 'L', label: 'L', domain: 'ac', potential: 'L1', role: 'source', polarity: 'line',
    });

    expect(assessTerminalCompatibility(relayCommon, positive)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(relayCommon, dcReturn)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(relayCommon, acLine)).toMatchObject({ compatible: true });
    expect(terminalConductorVisual(relayCommon)).toMatchObject({
      kind: 'dry-contact', circuitSide: 'switch',
    });
    expect(wireConductorVisual(relayCommon, positive)).toMatchObject({
      kind: 'dc-positive', color: '#dc2626',
    });
    expect(wireConductorVisual(relayCommon, dcReturn)).toMatchObject({
      kind: 'dc-return', color: '#1565c0',
    });
  });

  it('rejects reversed analog and RS485 signal pairs by their explicit polarity', () => {
    const analogPositive = terminal({
      id: 'I0+', domain: 'signal', potential: 'signal', role: 'input', polarity: 'signal-positive', channel: 'AI0',
    });
    const analogReturn = terminal({
      id: 'I0-', domain: 'signal', potential: 'signal', role: 'common', polarity: 'signal-return', channel: 'AI0',
      commonType: 'analog-reference',
    });
    const rs485A = terminal({
      id: 'A+', domain: 'communication', potential: 'signal', role: 'communication', polarity: 'data-positive',
      channel: 'A', protocol: 'RS485',
    });
    const rs485B = terminal({
      id: 'B-', domain: 'communication', potential: 'signal', role: 'communication', polarity: 'data-negative',
      channel: 'B', protocol: 'RS485',
    });

    expect(assessTerminalCompatibility(analogPositive, analogReturn))
      .toMatchObject({ compatible: false, code: 'ANALOG_REFERENCE_MISMATCH' });
    expect(assessTerminalCompatibility(rs485A, rs485B))
      .toMatchObject({ compatible: false, code: 'COMMUNICATION_POLARITY_MISMATCH' });
  });

  it('keeps an analog channel return distinct while permitting an intentional shared 0V reference', () => {
    const analogReturn = terminal({
      id: 'I0-', domain: 'signal', potential: 'signal', role: 'common', polarity: 'signal-return',
      channel: 'AI0', commonType: 'analog-reference',
    });
    const analogPositive = terminal({
      id: 'I0+', domain: 'signal', potential: 'signal', role: 'input', polarity: 'signal-positive', channel: 'AI0',
    });

    expect(assessTerminalCompatibility(analogReturn, dcReturn)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(analogReturn, analogPositive))
      .toMatchObject({ compatible: false, code: 'ANALOG_REFERENCE_MISMATCH' });
  });

  it('rejects a voltage source wired to a current-configured analog channel', () => {
    const voltageSource = terminal({
      id: 'V+', domain: 'signal', potential: 'signal', role: 'output',
      polarity: 'signal-positive', protocol: 'analog-voltage',
    });
    const currentInput = terminal({
      id: 'I0+', domain: 'signal', potential: 'signal', role: 'input',
      polarity: 'signal-positive', protocol: 'analog-current',
    });

    expect(assessTerminalCompatibility(voltageSource, currentInput))
      .toMatchObject({ compatible: false, code: 'TERMINAL_PROTOCOL_MISMATCH' });
    expect(terminalConductorVisual(voltageSource).label).toBe('아날로그 전압 신호 +');
    expect(terminalConductorVisual(currentInput).label).toBe('아날로그 전류 신호 +');
  });

  it('reports use of a documented NC terminal as a known wiring error', () => {
    const notConnected = terminal({
      id: 'NC', label: 'NC', role: 'not-connected', polarity: 'none',
    });

    expect(assessTerminalCompatibility(notConnected, positive))
      .toMatchObject({ compatible: false, code: 'TERMINAL_NOT_CONNECTED' });
  });

  it('keeps each contactor main pole on its documented AC phase', () => {
    const sourceL2 = terminal({
      id: 'L2', label: 'L2', domain: 'ac', potential: 'L2', role: 'source', polarity: 'line', phase: 'L2',
    });
    const contactL1 = terminal({
      id: '1L1', label: '1L1', domain: 'ac', potential: 'L1', role: 'dry-contact',
      polarity: 'nonpolar', commonType: 'dry-contact', phase: 'L1',
    });

    expect(assessTerminalCompatibility(contactL1, sourceL2))
      .toMatchObject({ compatible: false, code: 'AC_PHASE_MISMATCH' });
  });

  it('does not allow ordinary or fused through terminals to substitute for a PE terminal', () => {
    const pe = terminal({
      id: 'PE', domain: 'pe', potential: 'PE', role: 'protective-earth', polarity: 'protective-earth',
    });
    const through = terminal({
      id: '1', commonType: 'power-pass-through',
    });
    const fused = terminal({
      id: '1', commonType: 'fused-power',
    });

    expect(assessTerminalCompatibility(through, pe))
      .toMatchObject({ compatible: false, code: 'PE_TERMINAL_MISUSE' });
    expect(assessTerminalCompatibility(fused, pe))
      .toMatchObject({ compatible: false, code: 'PE_TERMINAL_MISUSE' });
  });

  it('requires RS232 TX/RX crossing and keeps SG separate', () => {
    const tx = terminal({
      id: 'TX', domain: 'communication', potential: 'signal', role: 'communication',
      polarity: 'none', protocol: 'RS232', channel: 'TX',
    });
    const rx = terminal({
      id: 'RX', domain: 'communication', potential: 'signal', role: 'communication',
      polarity: 'none', protocol: 'RS232', channel: 'RX',
    });
    const sg = terminal({
      id: 'SG', domain: 'communication', potential: 'signal', role: 'common',
      polarity: 'reference', protocol: 'RS232', channel: 'SG', commonType: 'communication-reference',
    });

    expect(assessTerminalCompatibility(tx, rx)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(tx, tx))
      .toMatchObject({ compatible: false, code: 'COMMUNICATION_POLARITY_MISMATCH' });
    expect(assessTerminalCompatibility(tx, sg))
      .toMatchObject({ compatible: false, code: 'COMMUNICATION_REFERENCE_MISMATCH' });
    expect(terminalConductorVisual(tx).kind).toBe('rs232-tx');
    expect(terminalConductorVisual(rx).kind).toBe('rs232-rx');
    expect(wireConductorVisual(rx, tx).kind).toBe('rs232-tx');
  });

  it('models a sinking transistor output on the return side of its load', () => {
    const sinkingOutput = terminal({
      id: 'MO', domain: 'signal', potential: 'signal', role: 'output',
      polarity: 'signal-return', outputMode: 'sinking-transistor',
    });
    const loadReturn = terminal({
      id: '-', role: 'common', polarity: 'return',
    });
    const loadPositive = terminal({
      id: '+', role: 'input', polarity: 'positive',
    });

    expect(assessTerminalCompatibility(sinkingOutput, loadReturn)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(sinkingOutput, loadPositive))
      .toMatchObject({ compatible: false, code: 'DC_POLARITY_MISMATCH' });
    expect(terminalConductorVisual(sinkingOutput).kind).toBe('digital-signal');
  });

  it('allows NPN/PNP BK outputs to reach a PLC input and defers COM direction to the closed-loop solver', () => {
    const plcInput = terminal({
      id: 'P00', domain: 'signal', potential: 'signal', role: 'input',
      polarity: 'signal-positive', ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
    });
    const npn = terminal({
      id: 'BK', domain: 'signal', potential: 'signal', role: 'output',
      polarity: 'signal-return', outputMode: 'sinking-transistor',
    });
    const pnp = terminal({
      id: 'BK', domain: 'signal', potential: 'signal', role: 'output',
      polarity: 'signal-positive', outputMode: 'sourcing-transistor',
    });

    expect(assessTerminalCompatibility(npn, plcInput)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(pnp, plcInput)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(npn, plcInput).message).toContain('COM은 +24V');
    expect(assessTerminalCompatibility(pnp, plcInput).message).toContain('COM은 0V');
  });

  it('distinguishes fixed CM, MG, 24G and configurable or relay COM labels', () => {
    const cm = terminal({
      id: 'CM', label: 'CM input/analog common', domain: 'dc', potential: '0V',
      role: 'common', polarity: 'return', commonType: 'dc-control-common',
    });
    const mg = terminal({
      id: 'MG', label: 'MG output common', domain: 'dc', potential: '0V',
      role: 'common', polarity: 'return', commonType: 'dc-output-common',
    });
    const supplyReturn = terminal({
      id: '24G', label: '24G', domain: 'dc', potential: '0V', role: 'source', polarity: 'return',
    });
    const configurable = terminal({
      id: 'COMI', label: 'COM', polarity: 'configurable', commonType: 'configurable-dc',
    });
    const relayCommon = terminal({
      id: 'COM0', label: 'COM0', role: 'common', polarity: 'nonpolar', commonType: 'dry-contact',
    });

    expect(terminalConductorVisual(cm)).toMatchObject({
      kind: 'dc-control-common', label: 'DC 제어 공통 CM (0V)',
    });
    expect(terminalConductorVisual(mg)).toMatchObject({
      kind: 'dc-output-common', label: '트랜지스터 출력 공통 MG (0V)',
    });
    expect(terminalConductorVisual(supplyReturn)).toMatchObject({
      kind: 'dc-return', label: 'DC 24G (0V 귀로)',
    });
    expect(terminalConductorVisual(configurable).label).toContain('PLC 입력 COM');
    expect(terminalConductorVisual(relayCommon).label).toContain('무전압');
    expect(wireConductorVisual(cm, dcReturn)).toMatchObject({ color: '#1565c0' });
    expect(wireConductorVisual(mg, dcReturn)).toMatchObject({ color: '#1565c0' });
  });

  it('rejects direct source paralleling and same-direction signal wiring', () => {
    const internal24V = terminal({
      id: '24V', label: 'PLC 24V', domain: 'dc', potential: '+24V', role: 'source', polarity: 'positive',
    });
    const inputA = terminal({
      id: 'P00', label: 'P00', domain: 'signal', potential: 'signal', role: 'input',
      polarity: 'signal-positive', ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
    });
    const inputB = { ...inputA, id: 'P01', label: 'P01' };

    expect(assessTerminalCompatibility(internal24V, positive))
      .toMatchObject({ compatible: false, code: 'TERMINAL_SOURCE_CONFLICT', risk: 'safety' });
    expect(assessTerminalCompatibility(inputA, inputB))
      .toMatchObject({ compatible: false, code: 'SIGNAL_DIRECTION_MISMATCH' });
  });

  it('keeps mains L2 separate from an inverter V/T2 motor output', () => {
    const mainsL2 = terminal({
      id: 'S', label: 'S/L2', domain: 'ac', potential: 'L2', role: 'supply-input',
      polarity: 'line', phase: 'L2',
    });
    const driveV = terminal({
      id: 'V', label: 'V/T2', domain: 'ac', potential: 'floating', role: 'output',
      polarity: 'line', phase: 'V', channel: 'motor-output',
    });
    const motorV = terminal({
      id: 'V', label: 'Motor V', domain: 'ac', potential: 'floating', role: 'input',
      polarity: 'line', phase: 'V', channel: 'motor-input',
    });

    expect(assessTerminalCompatibility(driveV, mainsL2))
      .toMatchObject({ compatible: false, code: 'AC_MAINS_DRIVE_OUTPUT_CONFLICT', risk: 'safety' });
    expect(assessTerminalCompatibility(driveV, motorV)).toMatchObject({ compatible: true });
    expect(terminalConductorVisual(driveV)).toMatchObject({
      kind: 'ac-drive-phase', label: '인버터 모터 출력 V/T2',
    });
  });

  it('allows ordered mains phases into a motor while rejecting a swapped motor phase', () => {
    const mainsL1 = terminal({
      id: 'L1', domain: 'ac', potential: 'L1', role: 'source',
      polarity: 'line', phase: 'L1',
    });
    const mainsL2 = terminal({
      id: 'L2', domain: 'ac', potential: 'L2', role: 'source',
      polarity: 'line', phase: 'L2',
    });
    const motorU = terminal({
      id: 'U', domain: 'ac', potential: 'floating', role: 'input',
      polarity: 'line', phase: 'U', channel: 'motor-input',
    });

    expect(assessTerminalCompatibility(mainsL1, motorU)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(mainsL2, motorU))
      .toMatchObject({ compatible: false, code: 'AC_PHASE_MISMATCH', risk: 'safety' });
    expect(terminalConductorVisual(motorU).label).toContain('모터 입력 U');
  });

  it('does not treat VR, V1, motor V and DC V+ as interchangeable V terminals', () => {
    const vr = terminal({
      id: 'VR', label: 'VR', domain: 'signal', potential: 'signal', role: 'source',
      polarity: 'signal-positive', protocol: 'analog-voltage', channel: 'analog-reference-supply',
      ratedVoltage: { min: 12, max: 12, unit: 'VDC' },
    });
    const v1 = terminal({
      id: 'V1', label: 'V1', domain: 'signal', potential: 'signal', role: 'input',
      polarity: 'signal-positive', protocol: 'analog-voltage',
      ratedVoltage: { min: -10, max: 10, unit: 'VDC' },
    });

    expect(terminalConductorVisual(vr)).toMatchObject({
      kind: 'analog-reference-supply', label: '아날로그 기준 공급 VR',
    });
    expect(assessTerminalCompatibility(vr, v1))
      .toMatchObject({ compatible: false, code: 'TERMINAL_SOURCE_CONFLICT' });
    expect(assessTerminalCompatibility(v1, positive))
      .toMatchObject({ compatible: false, code: 'TERMINAL_DOMAIN_MISMATCH' });
  });

  it('uses the selected iG5A S8 mode instead of accepting either DC polarity at P inputs', () => {
    const unresolved = terminal({
      id: 'P1', label: 'P1 / FX', domain: 'signal', potential: 'signal', role: 'input',
      polarity: 'signal-positive', ratedVoltage: { min: 12, max: 24, unit: 'VDC' },
      inputLogicMode: 'configurable',
    });
    const npn = {
      ...unresolved,
      inputLogicMode: 'npn-internal-24v' as const,
      inputActivationPotential: '0V' as const,
    };
    const pnp = {
      ...unresolved,
      inputLogicMode: 'pnp-external-24v' as const,
      inputActivationPotential: '+24V' as const,
    };

    expect(assessTerminalCompatibility(unresolved, positive))
      .toMatchObject({ compatible: false, code: 'INPUT_LOGIC_MODE_REQUIRED' });
    expect(assessTerminalCompatibility(npn, dcReturn)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(npn, positive))
      .toMatchObject({ compatible: false, code: 'INPUT_LOGIC_POLARITY_MISMATCH' });
    expect(assessTerminalCompatibility(pnp, positive)).toMatchObject({ compatible: true });
    expect(assessTerminalCompatibility(pnp, dcReturn))
      .toMatchObject({ compatible: false, code: 'INPUT_LOGIC_POLARITY_MISMATCH' });
    expect(terminalConductorVisual(npn).label).toContain('S8 NPN');
    expect(terminalConductorVisual(pnp).label).toContain('S8 PNP');
  });

  it('keeps RS232 SG and RS485 SG protocol references distinct', () => {
    const rs232Sg = terminal({
      id: 'SG', domain: 'communication', potential: 'signal', role: 'common',
      polarity: 'reference', commonType: 'communication-reference', protocol: 'RS232',
    });
    const rs485Sg = terminal({
      id: 'SG', domain: 'communication', potential: 'signal', role: 'common',
      polarity: 'reference', commonType: 'communication-reference', protocol: 'RS485',
    });

    expect(assessTerminalCompatibility(rs232Sg, rs485Sg))
      .toMatchObject({ compatible: false, code: 'TERMINAL_PROTOCOL_MISMATCH' });
  });
});
