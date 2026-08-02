import type { TerminalPolarity, TerminalSpec } from './types';

export type TerminalCompatibilityCode =
  | 'COMPATIBLE'
  | 'TERMINAL_NOT_CONNECTED'
  | 'TERMINAL_DOMAIN_MISMATCH'
  | 'TERMINAL_POLARITY_MISMATCH'
  | 'AC_LINE_NEUTRAL_MISMATCH'
  | 'AC_PHASE_MISMATCH'
  | 'AC_MAINS_DRIVE_OUTPUT_CONFLICT'
  | 'DC_POLARITY_MISMATCH'
  | 'PE_TERMINAL_MISUSE'
  | 'COMMON_ROLE_MISMATCH'
  | 'ANALOG_REFERENCE_MISMATCH'
  | 'COMMUNICATION_REFERENCE_MISMATCH'
  | 'COMMUNICATION_POLARITY_MISMATCH'
  | 'TERMINAL_PROTOCOL_MISMATCH'
  | 'SIGNAL_DIRECTION_MISMATCH'
  | 'TERMINAL_SOURCE_CONFLICT'
  | 'INPUT_LOGIC_MODE_REQUIRED'
  | 'INPUT_LOGIC_POLARITY_MISMATCH';

export type TerminalCompatibilityRisk = 'none' | 'function' | 'safety';

export type TerminalCompatibility =
  | {
    readonly compatible: true;
    readonly code: 'COMPATIBLE';
    readonly message: string;
    readonly risk: 'none';
  }
  | {
    readonly compatible: false;
    readonly code: Exclude<TerminalCompatibilityCode, 'COMPATIBLE'>;
    readonly message: string;
    readonly risk: Exclude<TerminalCompatibilityRisk, 'none'>;
  };

export type TerminalConductorKind =
  | 'ac-line'
  | 'ac-neutral'
  | 'dc-positive'
  | 'dc-return'
  | 'dc-control-common'
  | 'dc-output-common'
  | 'protective-earth'
  | 'ac-drive-phase'
  | 'configurable-common'
  | 'dry-contact'
  | 'digital-signal'
  | 'analog-positive'
  | 'analog-return'
  | 'analog-reference-supply'
  | 'rs232-tx'
  | 'rs232-rx'
  | 'data-positive'
  | 'data-negative'
  | 'communication-reference'
  | 'pass-through'
  | 'conflict'
  | 'not-connected'
  | 'unknown';

export interface TerminalConductorVisual {
  readonly kind: TerminalConductorKind;
  readonly color: string;
  readonly label: string;
  readonly circuitSide: 'source' | 'return' | 'pe' | 'configurable' | 'switch' | 'signal' | 'other';
}

const CONDUCTOR_VISUALS: Readonly<Record<TerminalConductorKind, TerminalConductorVisual>> = Object.freeze({
  'ac-line': { kind: 'ac-line', color: '#8b4513', label: 'AC L/상선', circuitSide: 'source' },
  'ac-neutral': { kind: 'ac-neutral', color: '#2563eb', label: 'AC N/중성선', circuitSide: 'return' },
  'dc-positive': { kind: 'dc-positive', color: '#dc2626', label: 'DC + 전원', circuitSide: 'source' },
  'dc-return': { kind: 'dc-return', color: '#1565c0', label: 'DC 0V/귀로', circuitSide: 'return' },
  'dc-control-common': {
    kind: 'dc-control-common', color: '#1565c0', label: 'DC 제어 공통 CM (0V)', circuitSide: 'return',
  },
  'dc-output-common': {
    kind: 'dc-output-common', color: '#1565c0', label: '트랜지스터 출력 공통 MG (0V)', circuitSide: 'return',
  },
  'protective-earth': { kind: 'protective-earth', color: '#65a30d', label: 'PE 보호접지', circuitSide: 'pe' },
  'ac-drive-phase': {
    kind: 'ac-drive-phase', color: '#b45309', label: '인버터 모터 출력 U/V/W', circuitSide: 'source',
  },
  'configurable-common': {
    kind: 'configurable-common', color: '#64748b', label: '설정형 DC COM', circuitSide: 'configurable',
  },
  'dry-contact': { kind: 'dry-contact', color: '#737373', label: '무전압 접점', circuitSide: 'switch' },
  'digital-signal': { kind: 'digital-signal', color: '#15803d', label: '디지털 I/O 신호', circuitSide: 'signal' },
  'analog-positive': { kind: 'analog-positive', color: '#0891b2', label: '아날로그 신호 +', circuitSide: 'signal' },
  'analog-return': { kind: 'analog-return', color: '#0e7490', label: '아날로그 신호 귀로', circuitSide: 'signal' },
  'analog-reference-supply': {
    kind: 'analog-reference-supply', color: '#0284c7', label: '아날로그 기준 공급 VR', circuitSide: 'signal',
  },
  'rs232-tx': { kind: 'rs232-tx', color: '#ea580c', label: 'RS232 TX', circuitSide: 'signal' },
  'rs232-rx': { kind: 'rs232-rx', color: '#16a34a', label: 'RS232 RX', circuitSide: 'signal' },
  'data-positive': { kind: 'data-positive', color: '#7c3aed', label: '통신 A/+', circuitSide: 'signal' },
  'data-negative': { kind: 'data-negative', color: '#c026d3', label: '통신 B/−', circuitSide: 'signal' },
  'communication-reference': {
    kind: 'communication-reference', color: '#475569', label: '통신 기준 SG', circuitSide: 'signal',
  },
  'pass-through': { kind: 'pass-through', color: '#525252', label: '관통 단자', circuitSide: 'other' },
  conflict: { kind: 'conflict', color: '#b91c1c', label: '상충하는 전위', circuitSide: 'other' },
  'not-connected': { kind: 'not-connected', color: '#b91c1c', label: 'NC 미사용', circuitSide: 'other' },
  unknown: { kind: 'unknown', color: '#404040', label: '고정 전위 없음', circuitSide: 'other' },
});

const compatible = (message: string): TerminalCompatibility => ({
  compatible: true,
  code: 'COMPATIBLE',
  message,
  risk: 'none',
});

const incompatible = (
  code: Exclude<TerminalCompatibilityCode, 'COMPATIBLE'>,
  message: string,
  risk: Exclude<TerminalCompatibilityRisk, 'none'> = 'function',
): TerminalCompatibility => ({ compatible: false, code, message, risk });

function terminalName(terminal: TerminalSpec): string {
  return terminal.label || terminal.id;
}

function isPassThrough(terminal: TerminalSpec): boolean {
  return terminal.domain === 'floating'
    && terminal.role === 'common'
    && terminal.polarity === 'none'
    && (terminal.commonType === undefined
      || terminal.commonType === 'power-pass-through'
      || terminal.commonType === 'fused-power');
}

function isDryContact(terminal: TerminalSpec): boolean {
  return terminal.commonType === 'dry-contact'
    || terminal.role === 'dry-contact'
    || terminal.polarity === 'nonpolar';
}

function isConfigurableDcCommon(terminal: TerminalSpec): boolean {
  return terminal.commonType === 'configurable-dc' || terminal.polarity === 'configurable';
}

function isDcControlCommon(terminal: TerminalSpec): boolean {
  return terminal.commonType === 'dc-control-common';
}

function isDcOutputCommon(terminal: TerminalSpec): boolean {
  return terminal.commonType === 'dc-output-common';
}

function isDigitalInput(terminal: TerminalSpec): boolean {
  return terminal.domain === 'signal'
    && terminal.role === 'input'
    && terminal.polarity === 'signal-positive'
    && !isAnalogTerminal(terminal)
    && terminal.ratedVoltage?.unit === 'VDC';
}

function isTransistorOutput(terminal: TerminalSpec): boolean {
  return terminal.outputMode === 'sinking-transistor' || terminal.outputMode === 'sourcing-transistor';
}

function isDrivePhase(terminal: TerminalSpec): boolean {
  return terminal.phase === 'U' || terminal.phase === 'V' || terminal.phase === 'W';
}

function isAnalogProtocol(terminal: TerminalSpec): boolean {
  return terminal.protocol === 'analog-voltage' || terminal.protocol === 'analog-current';
}

function isAnalogTerminal(terminal: TerminalSpec): boolean {
  const channel = terminal.channel?.trim().toUpperCase() ?? '';
  return isAnalogProtocol(terminal)
    || terminal.commonType === 'analog-reference'
    || /^(AI|AO)\d+$/.test(channel)
    || channel.startsWith('ANALOG-');
}

function isSignalSource(terminal: TerminalSpec): boolean {
  return terminal.domain === 'signal'
    && (terminal.role === 'source' || terminal.role === 'output');
}

function isFixedPowerSource(terminal: TerminalSpec): boolean {
  return terminal.role === 'source'
    && (terminal.domain === 'ac' || terminal.domain === 'dc')
    && !isDrivePhase(terminal);
}

function isSameDrivePhase(left: TerminalSpec, right: TerminalSpec): boolean {
  return isDrivePhase(left) && isDrivePhase(right) && left.phase === right.phase;
}

function fixedAcPhase(terminal: TerminalSpec): 'L1' | 'L2' | 'L3' | null {
  if (terminal.phase === 'L1' || terminal.phase === 'L2' || terminal.phase === 'L3') return terminal.phase;
  if (terminal.polarity !== 'line') return null;
  return terminal.potential === 'L1' || terminal.potential === 'L2' || terminal.potential === 'L3'
    ? terminal.potential
    : null;
}

function sameSignalSide(left: TerminalPolarity, right: TerminalPolarity): boolean {
  if (left === right) return true;
  return (left === 'positive' && right === 'signal-positive')
    || (left === 'signal-positive' && right === 'positive')
    || (left === 'return' && right === 'signal-return')
    || (left === 'signal-return' && right === 'return');
}

function isPowerDomain(terminal: TerminalSpec): boolean {
  return terminal.domain === 'ac' || terminal.domain === 'dc' || terminal.domain === 'pe';
}

function terminalDirection(terminal: TerminalSpec): 'input' | 'output' | 'other' {
  if (terminal.role === 'input' || terminal.role === 'supply-input') return 'input';
  if (terminal.role === 'output' || terminal.role === 'source') return 'output';
  return 'other';
}

function communicationDirection(terminal: TerminalSpec): 'TX' | 'RX' | null {
  const channel = terminal.channel?.trim().toUpperCase();
  if (channel === 'TX' || channel === 'TXD') return 'TX';
  if (channel === 'RX' || channel === 'RXD') return 'RX';
  return null;
}

/** Returns the physical conductor role used consistently by terminal dots, wires and hints. */
export function terminalConductorVisual(terminal: TerminalSpec): TerminalConductorVisual {
  let kind: TerminalConductorKind = 'unknown';
  if (terminal.role === 'not-connected') kind = 'not-connected';
  else if (terminal.domain === 'pe' || terminal.polarity === 'protective-earth') kind = 'protective-earth';
  else if (isDryContact(terminal)) kind = 'dry-contact';
  else if (isConfigurableDcCommon(terminal)) kind = 'configurable-common';
  else if (isDcControlCommon(terminal)) kind = 'dc-control-common';
  else if (isDcOutputCommon(terminal)) kind = 'dc-output-common';
  else if (isPassThrough(terminal)) kind = 'pass-through';
  else if (terminal.domain === 'communication') {
    const direction = terminal.protocol === 'RS232' ? communicationDirection(terminal) : null;
    if (direction === 'TX') kind = 'rs232-tx';
    else if (direction === 'RX') kind = 'rs232-rx';
    else if (terminal.polarity === 'data-positive') kind = 'data-positive';
    else if (terminal.polarity === 'data-negative') kind = 'data-negative';
    else if (terminal.polarity === 'reference' || terminal.commonType === 'communication-reference') {
      kind = 'communication-reference';
    }
  } else if (isDrivePhase(terminal)) kind = 'ac-drive-phase';
  else if (terminal.polarity === 'line') kind = 'ac-line';
  else if (terminal.polarity === 'neutral') kind = 'ac-neutral';
  else if (terminal.polarity === 'positive') kind = 'dc-positive';
  else if (terminal.polarity === 'return') kind = 'dc-return';
  else if (isTransistorOutput(terminal)) kind = 'digital-signal';
  else if (terminal.polarity === 'signal-return' || terminal.commonType === 'analog-reference') kind = 'analog-return';
  else if (terminal.channel === 'analog-reference-supply') kind = 'analog-reference-supply';
  else if (terminal.polarity === 'signal-positive') {
    kind = isAnalogTerminal(terminal)
      ? 'analog-positive'
      : terminal.ratedVoltage?.unit === 'VDC' ? 'digital-signal' : 'analog-positive';
  }
  const visual = CONDUCTOR_VISUALS[kind];
  if (kind === 'analog-positive' && terminal.protocol) {
    return {
      ...visual,
      label: terminal.protocol === 'analog-voltage' ? '아날로그 전압 신호 +' : '아날로그 전류 신호 +',
    };
  }
  if (kind === 'analog-return' && terminal.protocol) {
    return {
      ...visual,
      label: terminal.protocol === 'analog-voltage' ? '아날로그 전압 G/귀로' : '아날로그 전류 G/귀로',
    };
  }
  if (kind === 'ac-drive-phase') {
    const side = terminal.role === 'output' ? '인버터 모터 출력' : '모터 입력';
    return { ...visual, label: `${side} ${terminal.phase}/T${terminal.phase === 'U' ? '1' : terminal.phase === 'V' ? '2' : '3'}` };
  }
  if (kind === 'dc-positive' && (terminal.id === '24V' || terminal.id === '24')) {
    return { ...visual, label: 'DC +24V 공급' };
  }
  if (kind === 'dc-return' && terminal.id === '24G') {
    return { ...visual, label: 'DC 24G (0V 귀로)' };
  }
  if (kind === 'dry-contact' && terminal.role === 'common') {
    return { ...visual, label: '릴레이 접점 COM (무전압)' };
  }
  if (kind === 'configurable-common') {
    return { ...visual, label: 'PLC 입력 COM (+24V/0V 선택)' };
  }
  if (kind === 'digital-signal' && terminal.inputLogicMode === 'npn-internal-24v') {
    return { ...visual, label: 'iG5A 입력 (S8 NPN · 0V 동작)' };
  }
  if (kind === 'digital-signal' && terminal.inputLogicMode === 'pnp-external-24v') {
    return { ...visual, label: 'iG5A 입력 (S8 PNP · +24V 동작)' };
  }
  if (kind === 'digital-signal' && terminal.inputLogicMode === 'configurable') {
    return { ...visual, label: 'iG5A 입력 (S8 NPN/PNP 미설정)' };
  }
  return visual;
}

function isInheritedPotential(kind: TerminalConductorKind): boolean {
  return kind === 'configurable-common' || kind === 'dry-contact' || kind === 'pass-through' || kind === 'unknown';
}

function isFixedPower(kind: TerminalConductorKind): boolean {
  return kind === 'ac-line'
    || kind === 'ac-neutral'
    || kind === 'dc-positive'
    || kind === 'dc-return'
    || kind === 'dc-control-common'
    || kind === 'dc-output-common'
    || kind === 'ac-drive-phase'
    || kind === 'protective-earth';
}

function fixedPotentialClass(kind: TerminalConductorKind): string {
  if (kind === 'dc-control-common' || kind === 'dc-output-common') return 'dc-return';
  return kind;
}

/**
 * Resolves the visible conductor role for a wire.
 *
 * Floating contacts, through terminals and configurable COM terminals inherit
 * the known potential at their other endpoint. This prevents every terminal
 * named COM from being rendered as a blue 0V conductor.
 */
export function wireConductorVisual(left: TerminalSpec, right: TerminalSpec): TerminalConductorVisual {
  const leftVisual = terminalConductorVisual(left);
  const rightVisual = terminalConductorVisual(right);
  if (leftVisual.kind === 'not-connected' || rightVisual.kind === 'not-connected') {
    return CONDUCTOR_VISUALS['not-connected'];
  }
  if (leftVisual.kind === 'protective-earth' || rightVisual.kind === 'protective-earth') {
    return CONDUCTOR_VISUALS['protective-earth'];
  }
  if (isFixedPower(leftVisual.kind) && !isFixedPower(rightVisual.kind)) return leftVisual;
  if (isFixedPower(rightVisual.kind) && !isFixedPower(leftVisual.kind)) return rightVisual;
  if (isFixedPower(leftVisual.kind) && isFixedPower(rightVisual.kind)) {
    return fixedPotentialClass(leftVisual.kind) === fixedPotentialClass(rightVisual.kind)
      ? leftVisual
      : CONDUCTOR_VISUALS.conflict;
  }
  if (isInheritedPotential(leftVisual.kind) && !isInheritedPotential(rightVisual.kind)) return rightVisual;
  if (isInheritedPotential(rightVisual.kind) && !isInheritedPotential(leftVisual.kind)) return leftVisual;
  if (leftVisual.kind === rightVisual.kind) return leftVisual;
  if (leftVisual.kind === 'rs232-tx' || rightVisual.kind === 'rs232-tx') {
    return CONDUCTOR_VISUALS['rs232-tx'];
  }
  if (leftVisual.kind === 'rs232-rx' || rightVisual.kind === 'rs232-rx') {
    return CONDUCTOR_VISUALS['rs232-rx'];
  }
  if (leftVisual.kind === 'analog-return' || rightVisual.kind === 'analog-return') {
    return CONDUCTOR_VISUALS['analog-return'];
  }
  if (leftVisual.kind === 'analog-reference-supply' || rightVisual.kind === 'analog-reference-supply') {
    return CONDUCTOR_VISUALS['analog-reference-supply'];
  }
  if (leftVisual.kind === 'analog-positive' || rightVisual.kind === 'analog-positive') {
    return CONDUCTOR_VISUALS['analog-positive'];
  }
  if (leftVisual.kind === 'digital-signal' || rightVisual.kind === 'digital-signal') {
    return CONDUCTOR_VISUALS['digital-signal'];
  }
  return isInheritedPotential(leftVisual.kind) ? leftVisual : rightVisual;
}

/**
 * Checks the electrical meaning of two physical wire endpoints.
 *
 * This deliberately does not decide whether the whole circuit will operate:
 * contacts, loads and PLC inputs remain separate branches in the v3 solver.
 * It only catches endpoint facts that are already known from the exact
 * terminal profiles (L/N, +/return, NC, analog polarity and bus polarity).
 */
export function assessTerminalCompatibility(
  left: TerminalSpec,
  right: TerminalSpec,
): TerminalCompatibility {
  if (left.role === 'not-connected' || right.role === 'not-connected') {
    const terminal = left.role === 'not-connected' ? left : right;
    return incompatible(
      'TERMINAL_NOT_CONNECTED',
      `${terminalName(terminal)} 단자는 제조사 단자표의 NC(미사용) 단자이므로 결선할 수 없습니다.`,
    );
  }

  if (isPassThrough(left) || isPassThrough(right)) {
    const passThrough = isPassThrough(left) ? left : right;
    const other = passThrough === left ? right : left;
    if (passThrough.commonType === 'fused-power' && other.domain === 'pe') {
      return incompatible(
        'PE_TERMINAL_MISUSE',
        '퓨즈 단자대는 PE 보호접지 도체의 접속 또는 개폐 단자로 사용할 수 없습니다.',
        'safety',
      );
    }
    if (passThrough.commonType === 'power-pass-through' && other.domain === 'pe') {
      return incompatible(
        'PE_TERMINAL_MISUSE',
        '일반 관통 단자대는 PE 전용 단자대를 대신할 수 없습니다.',
        'safety',
      );
    }
    return compatible('관통 단자대가 상대 회로의 전위를 그대로 전달합니다.');
  }

  if (isDryContact(left) || isDryContact(right)) {
    const other = isDryContact(left) ? right : left;
    const leftPhase = fixedAcPhase(left);
    const rightPhase = fixedAcPhase(right);
    if (leftPhase && rightPhase && leftPhase !== rightPhase) {
      return incompatible(
        'AC_PHASE_MISMATCH',
        `접점의 지정 상과 연결 전원의 상이 다릅니다: ${leftPhase} ↔ ${rightPhase}.`,
        'safety',
      );
    }
    if (other.domain === 'pe') {
      return incompatible(
        'PE_TERMINAL_MISUSE',
        '무전압 접점은 PE 보호접지 도체의 접속 또는 개폐 단자로 사용할 수 없습니다.',
        'safety',
      );
    }
    if (other.domain === 'communication') {
      return incompatible(
        'TERMINAL_DOMAIN_MISMATCH',
        '일반 무전압 접점과 통신 데이터 단자를 직접 연결할 수 없습니다.',
      );
    }
    return compatible('무전압 접점은 연결된 회로의 전위를 따릅니다.');
  }

  if (isConfigurableDcCommon(left) || isConfigurableDcCommon(right)) {
    const other = isConfigurableDcCommon(left) ? right : left;
    if (isConfigurableDcCommon(other)
      || other.domain === 'dc'
      || other.polarity === 'positive'
      || other.polarity === 'return') {
      return compatible('설정형 DC COM은 소스/싱크 방식에 따라 +24V 또는 0V에 연결할 수 있습니다.');
    }
    return incompatible(
      'COMMON_ROLE_MISMATCH',
      '설정형 입력 COM은 같은 DC 24V 전원쌍의 +24V 또는 0V에 연결해야 합니다.',
      'safety',
    );
  }

  if (left.domain === 'pe' || right.domain === 'pe') {
    return left.domain === 'pe' && right.domain === 'pe'
      ? compatible('PE 보호접지끼리 연결됩니다.')
      : incompatible(
        'PE_TERMINAL_MISUSE',
        'PE는 L/N, DC, 신호, COM, G 또는 통신의 정상 운전 귀로로 사용할 수 없습니다.',
        'safety',
      );
  }

  if (left.domain === 'communication' || right.domain === 'communication') {
    if (left.domain !== 'communication' || right.domain !== 'communication') {
      return incompatible(
        'TERMINAL_DOMAIN_MISMATCH',
        '통신 A/B, TX/RX, SG 단자는 전원, PE, 아날로그 G 또는 일반 I/O 단자와 직접 연결할 수 없습니다.',
        'safety',
      );
    }
    if (left.protocol && right.protocol && left.protocol !== right.protocol) {
      return incompatible(
        'TERMINAL_PROTOCOL_MISMATCH',
        `${left.protocol}와 ${right.protocol} 단자는 서로 다른 통신 계층이므로 직접 연결할 수 없습니다.`,
      );
    }
    if (left.protocol === 'RS232' && right.protocol === 'RS232') {
      const leftDirection = communicationDirection(left);
      const rightDirection = communicationDirection(right);
      if (left.polarity === 'reference' || right.polarity === 'reference') {
        return left.polarity === 'reference' && right.polarity === 'reference'
          ? compatible('RS232 SG 기준선끼리 연결됩니다.')
          : incompatible(
            'COMMUNICATION_REFERENCE_MISMATCH',
            'RS232 SG는 신호 기준선이며 TX/RX 데이터 단자, PE 또는 아날로그 G와 직접 바꿔 연결할 수 없습니다.',
          );
      }
      if (leftDirection && rightDirection) {
        return leftDirection !== rightDirection
          ? compatible('RS232 송신(TX)을 상대 수신(RX)에 교차 연결합니다.')
          : incompatible(
            'COMMUNICATION_POLARITY_MISMATCH',
            `RS232는 TX↔RX로 교차 결선해야 합니다: ${terminalName(left)} ↔ ${terminalName(right)}.`,
          );
      }
      return incompatible(
        'TERMINAL_DOMAIN_MISMATCH',
        'RS232 단자의 TX/RX 방향 정보가 없어 안전하게 결선 판정을 할 수 없습니다.',
      );
    }
    if (left.polarity === 'reference' || right.polarity === 'reference') {
      return left.polarity === 'reference' && right.polarity === 'reference'
        ? compatible(`${left.protocol ?? right.protocol ?? '통신'} SG/기준선끼리 연결됩니다.`)
        : incompatible(
          'COMMUNICATION_REFERENCE_MISMATCH',
          '통신 SG는 A/B 데이터 도체, PE, 전원 0V 또는 아날로그 G와 동일한 단자가 아닙니다.',
        );
    }
    return left.polarity === right.polarity
      ? compatible('같은 통신 도체 역할끼리 연결됩니다.')
      : incompatible(
        'COMMUNICATION_POLARITY_MISMATCH',
        `통신 극성이 다릅니다: ${terminalName(left)} ↔ ${terminalName(right)}.`,
      );
  }

  if ((left.domain === 'ac' && right.domain === 'dc') || (left.domain === 'dc' && right.domain === 'ac')) {
    return incompatible(
      'TERMINAL_DOMAIN_MISMATCH',
      'AC L/N 단자와 DC +24V/0V 단자는 서로 다른 전원계통이므로 직접 연결할 수 없습니다.',
      'safety',
    );
  }

  if (isDrivePhase(left) || isDrivePhase(right)) {
    if (isDrivePhase(left) && isDrivePhase(right)) {
      if (!isSameDrivePhase(left, right)) {
        return incompatible(
          'AC_PHASE_MISMATCH',
          `인버터 모터 출력 상이 다릅니다: ${left.phase} ↔ ${right.phase}. U/V/W 순서를 유지하세요.`,
          'safety',
        );
      }
      if (left.role === 'output' && right.role === 'output') {
        return incompatible(
          'TERMINAL_SOURCE_CONFLICT',
          `두 인버터의 ${left.phase} 출력끼리는 직접 병렬 연결할 수 없습니다.`,
          'safety',
        );
      }
      return compatible(`인버터 출력과 모터 입력의 ${left.phase} 상이 일치합니다.`);
    }
    const drive = isDrivePhase(left) ? left : right;
    const other = drive === left ? right : left;
    const mainsPhase = fixedAcPhase(other);
    if (drive.role === 'input' && mainsPhase) {
      const expectedPhase = drive.phase === 'U' ? 'L1' : drive.phase === 'V' ? 'L2' : 'L3';
      return mainsPhase === expectedPhase
        ? compatible(`모터 ${drive.phase} 입력이 대응 전원 ${mainsPhase}상에 연결됩니다.`)
        : incompatible(
          'AC_PHASE_MISMATCH',
          `모터 ${drive.phase} 입력은 ${expectedPhase} 경로여야 하지만 ${mainsPhase}에 연결되었습니다.`,
          'safety',
        );
    }
    if (
      mainsPhase
      || other.polarity === 'neutral'
      || other.role === 'source'
    ) {
      return incompatible(
        'AC_MAINS_DRIVE_OUTPUT_CONFLICT',
        drive.role === 'input'
          ? `${terminalName(drive)} 모터 ${drive.phase} 입력은 N 또는 비대응 전원에 연결할 수 없습니다.`
          : `${terminalName(drive)}는 인버터 모터 출력 ${drive.phase}상이며, 입력 전원 L1/L2/L3/N 또는 다른 전원 출력과 연결할 수 없습니다.`,
        'safety',
      );
    }
    if (other.domain === 'ac' && (other.role === 'input' || other.role === 'supply-input')) {
      return compatible(`인버터 ${drive.phase} 출력이 모터 측 AC 입력으로 연결됩니다.`);
    }
    return incompatible(
      'TERMINAL_DOMAIN_MISMATCH',
      `인버터 모터 출력 ${drive.phase}상은 대응하는 모터/출력회로 단자에만 연결해야 합니다.`,
      'safety',
    );
  }

  if (
    left.domain === 'ac'
    && right.domain === 'ac'
    && (
      (left.polarity === 'line' && right.polarity === 'neutral')
      || (left.polarity === 'neutral' && right.polarity === 'line')
    )
  ) {
    return incompatible(
      'AC_LINE_NEUTRAL_MISMATCH',
      `AC L/상선과 N/중성선을 한 도체로 연결할 수 없습니다: ${terminalName(left)} ↔ ${terminalName(right)}.`,
      'safety',
    );
  }

  const oppositeDcPolarity = (
    (left.polarity === 'positive' && right.polarity === 'return')
    || (left.polarity === 'return' && right.polarity === 'positive')
  );
  const dcOrPassiveLoadDomains = (
    (left.domain === 'dc' || left.domain === 'floating')
    && (right.domain === 'dc' || right.domain === 'floating')
    && (left.domain === 'dc' || right.domain === 'dc')
  );
  if (oppositeDcPolarity && dcOrPassiveLoadDomains) {
    return incompatible(
      'DC_POLARITY_MISMATCH',
      `DC +24V/부하 +와 0V·24G·CM·MG/부하 −를 바꿔 한 도체로 연결할 수 없습니다: ${terminalName(left)} ↔ ${terminalName(right)}.`,
      'safety',
    );
  }

  if (isFixedPowerSource(left) && isFixedPowerSource(right)) {
    return incompatible(
      'TERMINAL_SOURCE_CONFLICT',
      `두 독립 전원 출력(${terminalName(left)} / ${terminalName(right)})을 직접 병렬 연결할 수 없습니다. 같은 전원쌍인지와 내부 공통 여부를 프로필로 확인하세요.`,
      'safety',
    );
  }

  if (left.domain === 'signal' || right.domain === 'signal') {
    const leftAnalog = isAnalogTerminal(left);
    const rightAnalog = isAnalogTerminal(right);
    if (leftAnalog && rightAnalog && left.protocol && right.protocol && left.protocol !== right.protocol) {
      return incompatible(
        'TERMINAL_PROTOCOL_MISMATCH',
        `아날로그 신호 형식이 다릅니다: ${left.protocol} ↔ ${right.protocol}. 물리 V/I 스위치와 파라미터를 확인하세요.`,
      );
    }
    if (isTransistorOutput(left) && isTransistorOutput(right)) {
      return incompatible(
        'TERMINAL_SOURCE_CONFLICT',
        '두 트랜지스터 출력을 직접 연결하면 출력 소자가 충돌할 수 있습니다. 각 출력은 입력 또는 부하에 연결하세요.',
        'safety',
      );
    }
    const transistor = isTransistorOutput(left) ? left : isTransistorOutput(right) ? right : null;
    if (transistor) {
      const other = transistor === left ? right : left;
      if (isDigitalInput(other)) {
        return compatible(
          transistor.outputMode === 'sinking-transistor'
            ? 'NPN BK 출력을 PLC 입력에 연결합니다. PLC COM은 +24V, 센서 BU는 0V여야 입력 폐회로가 완성됩니다.'
            : 'PNP BK 출력을 PLC 입력에 연결합니다. PLC COM은 0V, 센서 BN은 +24V여야 입력 폐회로가 완성됩니다.',
        );
      }
      const expectedPolarity = transistor.outputMode === 'sinking-transistor' ? 'return' : 'positive';
      if (
        other.polarity === expectedPolarity
        || (expectedPolarity === 'return' && other.polarity === 'signal-return')
        || (expectedPolarity === 'positive' && other.polarity === 'signal-positive')
      ) {
        return compatible(
          transistor.outputMode === 'sinking-transistor'
            ? '싱킹(NPN) 트랜지스터 출력이 부하 귀로 측에 연결됩니다.'
            : '소싱(PNP) 트랜지스터 출력이 부하 + 측에 연결됩니다.',
        );
      }
      return incompatible(
        'DC_POLARITY_MISMATCH',
        transistor.outputMode === 'sinking-transistor'
          ? '싱킹(NPN) 트랜지스터 출력은 부하의 귀로 측에 연결해야 합니다.'
          : '소싱(PNP) 트랜지스터 출력은 부하의 + 측에 연결해야 합니다.',
        'safety',
      );
    }

    if (
      leftAnalog
      && rightAnalog
      && (
        (left.polarity === 'signal-positive' && right.polarity === 'signal-return')
        || (left.polarity === 'signal-return' && right.polarity === 'signal-positive')
      )
    ) {
      return incompatible(
        'ANALOG_REFERENCE_MISMATCH',
        `아날로그 신호 +와 채널 G/−를 바꿔 연결할 수 없습니다: ${terminalName(left)} ↔ ${terminalName(right)}.`,
      );
    }

    if (leftAnalog && rightAnalog && left.protocol === 'analog-voltage') {
      const source = isSignalSource(left) ? left : isSignalSource(right) ? right : null;
      const receiver = source === left ? right : source === right ? left : null;
      if (
        source
        && receiver
        && receiver.role === 'input'
        && source.ratedVoltage?.unit === 'VDC'
        && receiver.ratedVoltage?.unit === 'VDC'
        && source.ratedVoltage.min > receiver.ratedVoltage.max
      ) {
        return incompatible(
          'TERMINAL_SOURCE_CONFLICT',
          `${terminalName(source)}의 최소 출력 ${source.ratedVoltage.min}V가 ${terminalName(receiver)}의 최대 입력 ${receiver.ratedVoltage.max}V를 초과합니다.`,
          'safety',
        );
      }
    }

    if (left.domain === 'signal' && right.domain === 'signal') {
      const leftDirection = terminalDirection(left);
      const rightDirection = terminalDirection(right);
      if (leftDirection === 'input' && rightDirection === 'input') {
        return incompatible(
          'SIGNAL_DIRECTION_MISMATCH',
          `입력 단자끼리는 신호를 만들 수 없습니다: ${terminalName(left)} ↔ ${terminalName(right)}. 출력/센서/신호원을 연결하세요.`,
        );
      }
      if (leftDirection === 'output' && rightDirection === 'output') {
        return incompatible(
          'TERMINAL_SOURCE_CONFLICT',
          `두 신호 출력(${terminalName(left)} / ${terminalName(right)})을 직접 연결할 수 없습니다.`,
          'safety',
        );
      }
    }

    const signal = left.domain === 'signal' ? left : right;
    const other = signal === left ? right : left;
    if (other.domain === 'dc' && isDigitalInput(signal)) {
      if (signal.inputLogicMode === 'configurable' && signal.inputActivationPotential === undefined) {
        return incompatible(
          'INPUT_LOGIC_MODE_REQUIRED',
          `${terminalName(signal)} 입력은 장비의 실제 NPN/PNP 선택 스위치 위치를 먼저 기록해야 합니다.`,
        );
      }
      if (signal.inputActivationPotential !== undefined) {
        const observed = other.potential === '+24V' || other.polarity === 'positive'
          ? '+24V'
          : other.potential === '0V' || other.polarity === 'return'
            ? '0V'
            : undefined;
        if (observed !== undefined && observed !== signal.inputActivationPotential) {
          return incompatible(
            'INPUT_LOGIC_POLARITY_MISMATCH',
            `${terminalName(signal)}은 ${signal.inputLogicMode === 'npn-internal-24v' ? 'S8 NPN' : 'S8 PNP'} 설정에서 ${signal.inputActivationPotential}로 동작하지만 ${terminalName(other)}은 ${observed}입니다.`,
          );
        }
        return compatible(
          signal.inputLogicMode === 'npn-internal-24v'
            ? 'S8 NPN: iG5A 내부 24V 입력 회로가 P 단자에서 접점을 거쳐 CM(0V)으로 귀환합니다.'
            : 'S8 PNP: 외부 +24V가 접점을 거쳐 P 단자로 들어가고 외부 0V가 CM으로 귀환합니다.',
        );
      }
      return compatible('PLC DC 입력은 COM과 반대 전위를 받도록 +24V 또는 0V에 연결할 수 있습니다.');
    }
    if (other.domain === 'dc' && signal.polarity === 'signal-return' && other.polarity === 'return') {
      return compatible('아날로그 신호 귀로를 0V와 공통 기준으로 사용하는 결선입니다. 채널 방식과 접지 정책을 함께 확인해야 합니다.');
    }
    if (other.domain === 'floating' && sameSignalSide(signal.polarity, other.polarity)) {
      return compatible('신호 경계의 같은 극성끼리 연결됩니다.');
    }
    if (other.domain !== 'signal') {
      return incompatible('TERMINAL_DOMAIN_MISMATCH', '아날로그/신호 단자는 전원 단자와 분리해 같은 신호 회로에 연결해야 합니다.');
    }
  }

  const leftPhase = fixedAcPhase(left);
  const rightPhase = fixedAcPhase(right);
  if (leftPhase && rightPhase && leftPhase !== rightPhase) {
    return incompatible(
      'AC_PHASE_MISMATCH',
      `서로 다른 AC 상(${leftPhase}/${rightPhase})을 한 선으로 연결할 수 없습니다.`,
      'safety',
    );
  }

  if (sameSignalSide(left.polarity, right.polarity)) {
    return compatible('같은 전위 또는 같은 신호 극성끼리 연결됩니다.');
  }

  if (left.polarity === 'none' && right.polarity === 'none' && !isPowerDomain(left) && !isPowerDomain(right)) {
    return compatible('고정 전위가 없는 동일 역할 단자끼리 연결됩니다.');
  }

  return incompatible(
    'TERMINAL_POLARITY_MISMATCH',
    `단자 극성이 다릅니다: ${terminalName(left)}(${left.polarity}) ↔ ${terminalName(right)}(${right.polarity}).`,
  );
}
