import type { DeviceProfileV3, EvidenceGradeV3 } from '../../catalog/v3-profiles';
import { validatePrewireEligibility } from '../../catalog/v3-profiles';
import { effectiveTerminalSpecFromSettings } from '../terminal-configuration';
import { assessTerminalCompatibility } from '../terminal-semantics';
import type { DeviceProfile, TerminalSpec } from '../types';
import type { DeviceInstanceV3, TerminalReferenceV3, WorkshopDocumentV3 } from './contracts';

export type WiringIntentV3 =
  | 'dc-power'
  | 'ac-power'
  | 'digital-input'
  | 'digital-output'
  | 'relay-contact'
  | 'analog-voltage'
  | 'analog-current'
  | 'rs485'
  | 'protective-earth'
  | 'three-phase';

export type WiringGuideStatusV3 = 'READY' | 'REQUIRES_PREREQUISITE' | 'ALREADY_CONNECTED' | 'BLOCKED';
export type WiringCircuitRoleV3 = 'source' | 'signal' | 'return' | 'pe' | 'differential-pair';

export interface WiringGuideCatalogV3 {
  readonly profiles: Readonly<Record<string, DeviceProfile>>;
  readonly verifiedProfiles: Readonly<Record<string, DeviceProfileV3>>;
}

export interface WiringGuideStepV3 {
  readonly kind: 'conductor' | 'setting' | 'manual-check';
  readonly circuitRole: WiringCircuitRoleV3;
  readonly from?: TerminalReferenceV3;
  readonly to?: TerminalReferenceV3;
  readonly status: WiringGuideStatusV3;
  readonly reasonCode: string;
  readonly message: string;
  readonly relatedIssueCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface WiringGuidePlanV3 {
  readonly id: string;
  readonly intent: WiringIntentV3;
  readonly status: WiringGuideStatusV3;
  readonly reasonCode: string;
  readonly message: string;
  readonly evidenceGrade: EvidenceGradeV3;
  readonly steps: readonly WiringGuideStepV3[];
  readonly remainingPrerequisites: readonly WiringGuideStepV3[];
}

interface ResolvedDevice {
  readonly instance: DeviceInstanceV3;
  readonly profile: DeviceProfile;
  readonly terminals: readonly TerminalSpec[];
}

interface TerminalEndpoint {
  readonly device: ResolvedDevice;
  readonly terminal: TerminalSpec;
  readonly ref: TerminalReferenceV3;
}

interface CandidatePair {
  readonly left: TerminalEndpoint;
  readonly right: TerminalEndpoint;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function workflowDeviceSettings(document: WorkshopDocumentV3, deviceId: string): Readonly<Record<string, unknown>> {
  const workflow = record(record(document.settings).v3Workflow);
  return record(record(workflow.deviceSettings)[deviceId]);
}

function resolveDevice(
  document: WorkshopDocumentV3,
  deviceId: string,
  profiles: Readonly<Record<string, DeviceProfile>>,
): ResolvedDevice | undefined {
  const instance = document.deviceInstances?.find((entry) => entry.id === deviceId);
  const profile = instance ? profiles[instance.profileId] : undefined;
  if (!instance || !profile) return undefined;
  const settings = workflowDeviceSettings(document, deviceId);
  return {
    instance,
    profile,
    terminals: profile.terminals.map((terminal) => effectiveTerminalSpecFromSettings(
      profile.profileId,
      terminal,
      instance.configuration,
      settings,
    )),
  };
}

function evidenceReferences(...devices: readonly ResolvedDevice[]): string[] {
  return [...new Set(devices.flatMap(({ profile }) => profile.evidence.documents.map((document) =>
    `${profile.model} · ${document.documentId} p.${document.pages.join(',')} · ${document.sha256}`,
  )))].sort();
}

function evidenceGrade(devices: readonly ResolvedDevice[]): EvidenceGradeV3 {
  const installed = devices.filter((device) => !device.profile.boundary);
  const grades = (installed.length ? installed : devices).map((device) => device.profile.evidence.level);
  if (grades.includes('educational')) return 'educational';
  if (grades.includes('manual-verified')) return 'manual-verified';
  return 'bench-verified';
}

function refKey(ref: TerminalReferenceV3): string {
  return `${ref.elementId}:${ref.terminalId}`;
}

function compareRefs(left: TerminalReferenceV3, right: TerminalReferenceV3): number {
  return refKey(left).localeCompare(refKey(right));
}

function connectionExists(
  document: WorkshopDocumentV3,
  from: TerminalReferenceV3,
  to: TerminalReferenceV3,
): boolean {
  return (document.conductorBranches ?? []).some((branch) =>
    (compareRefs(branch.from, from) === 0 && compareRefs(branch.to, to) === 0)
    || (compareRefs(branch.from, to) === 0 && compareRefs(branch.to, from) === 0));
}

function connectionCount(document: WorkshopDocumentV3, ref: TerminalReferenceV3): number {
  return (document.conductorBranches ?? []).filter((branch) =>
    compareRefs(branch.from, ref) === 0 || compareRefs(branch.to, ref) === 0).length;
}

function isDryContact(terminal: TerminalSpec): boolean {
  return terminal.commonType === 'dry-contact' || terminal.role === 'dry-contact';
}

function isSwitchedContactEndpoint(terminal: TerminalSpec): boolean {
  return isDryContact(terminal) && terminal.role !== 'common';
}

function isInput(terminal: TerminalSpec): boolean {
  return terminal.role === 'input' || terminal.role === 'supply-input';
}

function isOutput(terminal: TerminalSpec): boolean {
  return terminal.role === 'output' || terminal.role === 'source';
}

function isPowerSource(terminal: TerminalSpec): boolean {
  return terminal.role === 'source';
}

function samePolarity(left: TerminalSpec, right: TerminalSpec, polarity: TerminalSpec['polarity']): boolean {
  return left.polarity === polarity && right.polarity === polarity;
}

function matchesIntent(intent: WiringIntentV3, left: TerminalSpec, right: TerminalSpec): boolean {
  switch (intent) {
    case 'dc-power':
      return (samePolarity(left, right, 'positive') || samePolarity(left, right, 'return'))
        && (isPowerSource(left) !== isPowerSource(right));
    case 'ac-power':
      return (samePolarity(left, right, 'line') || samePolarity(left, right, 'neutral'))
        && (isPowerSource(left) !== isPowerSource(right));
    case 'digital-input': {
      const input = left.role === 'input' ? left : right.role === 'input' ? right : undefined;
      const peer = input === left ? right : input === right ? left : undefined;
      return input !== undefined
        && peer !== undefined
        && input.domain !== 'communication'
        && (isSwitchedContactEndpoint(peer) || peer.role === 'output');
    }
    case 'digital-output':
      return ((left.role === 'output' || isSwitchedContactEndpoint(left)) && isInput(right))
        || ((right.role === 'output' || isSwitchedContactEndpoint(right)) && isInput(left));
    case 'relay-contact': {
      const contact = isDryContact(left) ? left : isDryContact(right) ? right : undefined;
      const peer = contact === left ? right : contact === right ? left : undefined;
      if (!contact || !peer || peer.domain === 'pe' || peer.domain === 'communication') return false;
      if (peer.role === 'source') return contact.role === 'common';
      if (isInput(peer)) return contact.role !== 'common';
      return false;
    }
    case 'analog-voltage':
    case 'analog-current': {
      const protocol = intent === 'analog-voltage' ? 'analog-voltage' : 'analog-current';
      if (left.protocol !== protocol || right.protocol !== protocol || left.polarity !== right.polarity) return false;
      if (left.polarity === 'signal-return') return left.role === 'common' && right.role === 'common';
      return left.polarity === 'signal-positive'
        && ((left.role === 'output' && right.role === 'input') || (right.role === 'output' && left.role === 'input'));
    }
    case 'rs485':
      return left.protocol === 'RS485'
        && right.protocol === 'RS485'
        && left.polarity === right.polarity
        && ['data-positive', 'data-negative', 'reference'].includes(left.polarity);
    case 'protective-earth':
      return left.polarity === 'protective-earth' && right.polarity === 'protective-earth';
    case 'three-phase':
      return left.domain === 'ac'
        && right.domain === 'ac'
        && left.polarity === 'line'
        && right.polarity === 'line'
        && ((isOutput(left) && isInput(right)) || (isOutput(right) && isInput(left)));
  }
}

function candidatePairs(intent: WiringIntentV3, left: ResolvedDevice, right: ResolvedDevice): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  for (const leftTerminal of left.terminals) {
    for (const rightTerminal of right.terminals) {
      if (!matchesIntent(intent, leftTerminal, rightTerminal)) continue;
      if (!assessTerminalCompatibility(leftTerminal, rightTerminal).compatible) continue;
      pairs.push({
        left: { device: left, terminal: leftTerminal, ref: { elementId: left.instance.id, terminalId: leftTerminal.id } },
        right: { device: right, terminal: rightTerminal, ref: { elementId: right.instance.id, terminalId: rightTerminal.id } },
      });
    }
  }
  return pairs.sort((a, b) => compareRefs(a.left.ref, b.left.ref) || compareRefs(a.right.ref, b.right.ref));
}

function sourceWeight(terminal: TerminalSpec): number {
  if (terminal.role === 'source') return 5;
  if (terminal.role === 'output') return 4;
  if (isDryContact(terminal)) return 3;
  if (terminal.role === 'supply-input') return 1;
  return 0;
}

function circuitRole(intent: WiringIntentV3, pair: CandidatePair): WiringCircuitRoleV3 {
  const polarity = pair.left.terminal.polarity;
  if (intent === 'protective-earth') return 'pe';
  if (intent === 'rs485') return 'differential-pair';
  if (['return', 'neutral', 'signal-return'].includes(polarity)) return 'return';
  if (intent === 'dc-power' || intent === 'ac-power' || intent === 'three-phase') return 'source';
  if (intent === 'relay-contact' && (pair.left.terminal.role === 'source' || pair.right.terminal.role === 'source')) return 'source';
  return 'signal';
}

const CIRCUIT_ROLE_ORDER: Readonly<Record<WiringCircuitRoleV3, number>> = {
  source: 0,
  signal: 1,
  return: 2,
  pe: 3,
  'differential-pair': 4,
};

function orientPair(pair: CandidatePair, role: WiringCircuitRoleV3): readonly [TerminalEndpoint, TerminalEndpoint] {
  const leftWeight = sourceWeight(pair.left.terminal);
  const rightWeight = sourceWeight(pair.right.terminal);
  if (role === 'return') return leftWeight <= rightWeight ? [pair.left, pair.right] : [pair.right, pair.left];
  if (role === 'source' || role === 'signal') return leftWeight >= rightWeight ? [pair.left, pair.right] : [pair.right, pair.left];
  return [pair.left, pair.right];
}

function reasonForRole(role: WiringCircuitRoleV3): { code: string; message: string } {
  switch (role) {
    case 'source': return { code: 'SOURCE_CONDUCTOR_READY', message: '공급측에서 부하·입력측으로 이어지는 전원 경로입니다.' };
    case 'return': return { code: 'RETURN_CONDUCTOR_READY', message: '부하·입력측에서 같은 전원쌍의 0V/N으로 마무리하는 귀로입니다.' };
    case 'pe': return { code: 'PE_CONDUCTOR_READY', message: '정상 운전 귀로와 분리된 보호접지 경로입니다.' };
    case 'differential-pair': return { code: 'DIFFERENTIAL_CONDUCTOR_READY', message: '동일 극성의 차동 통신 도체입니다.' };
    case 'signal': return { code: 'SIGNAL_CONDUCTOR_READY', message: '출력·접점에서 입력 또는 부하로 이어지는 신호 경로입니다.' };
  }
}

function directStep(
  document: WorkshopDocumentV3,
  pair: CandidatePair,
  intent: WiringIntentV3,
  evidenceRefs: readonly string[],
): WiringGuideStepV3 {
  const role = circuitRole(intent, pair);
  const [from, to] = orientPair(pair, role);
  const connected = connectionExists(document, from.ref, to.ref);
  const capacityExceeded = !connected && [from, to].some((endpoint) =>
    endpoint.terminal.maxConductors !== undefined
    && connectionCount(document, endpoint.ref) >= endpoint.terminal.maxConductors);
  const reason = reasonForRole(role);
  return {
    kind: 'conductor',
    circuitRole: role,
    from: from.ref,
    to: to.ref,
    status: capacityExceeded ? 'BLOCKED' : connected ? 'ALREADY_CONNECTED' : 'READY',
    reasonCode: capacityExceeded ? 'TERMINAL_CAPACITY_EXCEEDED' : connected ? 'ALREADY_CONNECTED' : reason.code,
    message: capacityExceeded ? '단자 허용 도체 수를 초과하므로 이 결선을 시작할 수 없습니다.' : reason.message,
    relatedIssueCodes: capacityExceeded ? ['TERMINAL_CAPACITY_EXCEEDED'] : [],
    evidenceRefs,
  };
}

function manualPrerequisite(
  code: string,
  message: string,
  ref: TerminalReferenceV3 | undefined,
  evidenceRefs: readonly string[],
): WiringGuideStepV3 {
  return {
    kind: 'manual-check',
    circuitRole: code.includes('COMMON') || code.includes('RETURN') ? 'return' : 'source',
    ...(ref ? { from: ref } : {}),
    status: 'REQUIRES_PREREQUISITE',
    reasonCode: code,
    message,
    relatedIssueCodes: [code],
    evidenceRefs,
  };
}

function oppositePolarity(intent: WiringIntentV3, polarity: TerminalSpec['polarity']): TerminalSpec['polarity'] | undefined {
  if (intent === 'dc-power') return polarity === 'positive' ? 'return' : polarity === 'return' ? 'positive' : undefined;
  if (intent === 'ac-power') return polarity === 'line' ? 'neutral' : polarity === 'neutral' ? 'line' : undefined;
  if (intent === 'analog-voltage' || intent === 'analog-current') {
    return polarity === 'signal-positive' ? 'signal-return' : polarity === 'signal-return' ? 'signal-positive' : undefined;
  }
  if (intent === 'rs485') return polarity === 'data-positive' ? 'data-negative' : polarity === 'data-negative' ? 'data-positive' : undefined;
  return undefined;
}

function oppositeReason(intent: WiringIntentV3, polarity: TerminalSpec['polarity']): { code: string; message: string } {
  if (intent === 'rs485') return { code: 'DIFFERENTIAL_PAIR_INCOMPLETE', message: 'RS485의 반대 극성 데이터선도 같은 상대 노드까지 연결해야 합니다.' };
  if (intent === 'analog-voltage' || intent === 'analog-current') {
    return polarity === 'signal-positive'
      ? { code: 'ANALOG_RETURN_PATH_OPEN', message: '같은 아날로그 채널의 G/− 귀로를 연결해야 합니다.' }
      : { code: 'ANALOG_SOURCE_PATH_OPEN', message: '같은 아날로그 채널의 + 신호선을 연결해야 합니다.' };
  }
  return polarity === 'positive' || polarity === 'line'
    ? { code: 'OPEN_RETURN_PATH', message: '같은 전원쌍의 0V/N 귀로를 연결해야 폐회로가 완성됩니다.' }
    : { code: 'OPEN_SOURCE_PATH', message: '같은 전원쌍의 +24V/L 공급 경로를 연결해야 폐회로가 완성됩니다.' };
}

function companionPrerequisites(
  document: WorkshopDocumentV3,
  pair: CandidatePair,
  intent: WiringIntentV3,
  allPairs: readonly CandidatePair[],
  evidenceRefs: readonly string[],
): WiringGuideStepV3[] {
  const requirements: WiringGuideStepV3[] = [];
  const opposite = oppositePolarity(intent, pair.left.terminal.polarity);
  if (opposite) {
    const companion = allPairs.find((candidate) => candidate.left.terminal.polarity === opposite);
    if (companion) {
      const step = directStep(document, companion, intent, evidenceRefs);
      if (step.status !== 'ALREADY_CONNECTED') {
        const reason = oppositeReason(intent, pair.left.terminal.polarity);
        requirements.push({
          ...step,
          status: 'REQUIRES_PREREQUISITE',
          reasonCode: reason.code,
          message: reason.message,
          relatedIssueCodes: [reason.code],
        });
      }
    } else {
      const reason = oppositeReason(intent, pair.left.terminal.polarity);
      requirements.push(manualPrerequisite(reason.code, reason.message, undefined, evidenceRefs));
    }
  }

  if (intent === 'digital-input') {
    const input = pair.left.terminal.role === 'input' ? pair.left : pair.right.terminal.role === 'input' ? pair.right : undefined;
    const contact = isDryContact(pair.left.terminal) ? pair.left : isDryContact(pair.right.terminal) ? pair.right : undefined;
    if (input?.terminal.comGroup) {
      const common = input.device.terminals.find((terminal) =>
        terminal.role === 'common' && terminal.comGroup === input.terminal.comGroup);
      const commonRef = common ? { elementId: input.device.instance.id, terminalId: common.id } : undefined;
      if (!commonRef || connectionCount(document, commonRef) === 0) {
        requirements.push(manualPrerequisite(
          'INPUT_COMMON_REQUIRED',
          'PLC 입력 COM을 선택한 소스/싱크 방식에 맞춰 같은 +24V/0V 전원쌍에 연결해야 합니다.',
          commonRef,
          evidenceRefs,
        ));
      }
    }
    if (contact) {
      const groupRefs = contact.device.terminals
        .filter((terminal) => terminal.comGroup === contact.terminal.comGroup)
        .map((terminal) => ({ elementId: contact.device.instance.id, terminalId: terminal.id }));
      if (!groupRefs.some((ref) => connectionCount(document, ref) > 0)) {
        requirements.push(manualPrerequisite(
          'CONTACT_SUPPLY_REQUIRED',
          '무전압 접점의 반대편에 같은 DC 전원쌍의 공급 전위를 연결해야 입력 전류가 흐릅니다.',
          groupRefs[0],
          evidenceRefs,
        ));
      }
    }
  }

  if (intent === 'digital-output' || intent === 'relay-contact') {
    const contact = isDryContact(pair.left.terminal) ? pair.left : isDryContact(pair.right.terminal) ? pair.right : undefined;
    if (contact && contact.terminal.role !== 'common') {
      const common = contact.device.terminals.find((terminal) =>
        terminal.role === 'common'
        && terminal.commonType === 'dry-contact'
        && terminal.comGroup === contact.terminal.comGroup);
      const commonRef = common ? { elementId: contact.device.instance.id, terminalId: common.id } : undefined;
      if (!commonRef || connectionCount(document, commonRef) === 0) {
        requirements.push(manualPrerequisite(
          'CONTACT_SUPPLY_REQUIRED',
          '릴레이 출력 COM에 부하와 같은 전원계통의 공급 전위를 먼저 연결해야 합니다.',
          commonRef,
          evidenceRefs,
        ));
      }
    }
  }

  const unique = new Map<string, WiringGuideStepV3>();
  for (const requirement of requirements) {
    const key = `${requirement.reasonCode}:${requirement.from ? refKey(requirement.from) : ''}:${requirement.to ? refKey(requirement.to) : ''}`;
    if (!unique.has(key)) unique.set(key, requirement);
  }
  return [...unique.values()];
}

function blockedPlan(
  intent: WiringIntentV3,
  reasonCode: string,
  message: string,
  devices: readonly ResolvedDevice[] = [],
): WiringGuidePlanV3 {
  const refs = evidenceReferences(...devices);
  return {
    id: `${intent}:blocked:${reasonCode}`,
    intent,
    status: 'BLOCKED',
    reasonCode,
    message,
    evidenceGrade: devices.length ? evidenceGrade(devices) : 'educational',
    steps: [manualPrerequisite(reasonCode, message, undefined, refs)],
    remainingPrerequisites: [],
  };
}

function prewireBlock(
  device: ResolvedDevice,
  verifiedProfiles: Readonly<Record<string, DeviceProfileV3>>,
): { code: string; message: string } | undefined {
  if (device.profile.boundary) return undefined;
  const verified = verifiedProfiles[device.profile.profileId];
  if (!verified) {
    return {
      code: 'PROFILE_NOT_PREWIRE_ELIGIBLE',
      message: `${device.profile.model}은(는) 정확한 v3 검토 프로필이 없어 사전 결선 안내를 제공할 수 없습니다.`,
    };
  }
  const result = validatePrewireEligibility(verified, device.instance.exactOrderCode ?? undefined);
  if (result.ok) return undefined;
  if (result.reason === 'order-code-required') {
    return { code: 'ORDER_CODE_REQUIRED', message: `${device.profile.model}의 정확한 주문코드를 먼저 입력하세요.` };
  }
  if (result.reason === 'order-code-mismatch') {
    return { code: 'ORDER_CODE_MISMATCH', message: `${device.profile.model} 주문코드가 검증 프로필과 일치하지 않습니다.` };
  }
  return {
    code: 'PROFILE_NOT_PREWIRE_ELIGIBLE',
    message: `${device.profile.model}의 근거 등급은 사전 결선 안내에 사용할 수 없습니다.`,
  };
}

/**
 * Produces deterministic, non-mutating conductor guidance for one explicit
 * circuit intent. A READY step means that conductor itself is allowed; the
 * plan remains REQUIRES_PREREQUISITE until its source/return/COM companions
 * are present. This function never issues a validation PASS.
 */
export function suggestWiringPlans(
  document: WorkshopDocumentV3,
  deviceIds: readonly [string, string],
  intent: WiringIntentV3,
  catalog: WiringGuideCatalogV3,
): readonly WiringGuidePlanV3[] {
  if (deviceIds[0] === deviceIds[1]) {
    return [blockedPlan(intent, 'TWO_DISTINCT_DEVICES_REQUIRED', '서로 다른 장비 두 대를 선택하세요.')];
  }
  const left = resolveDevice(document, deviceIds[0], catalog.profiles);
  const right = resolveDevice(document, deviceIds[1], catalog.profiles);
  if (!left || !right) {
    return [blockedPlan(intent, 'DEVICE_PROFILE_MISSING', '선택한 장비의 정확한 프로필을 찾을 수 없습니다.', [left, right].filter(Boolean) as ResolvedDevice[])];
  }
  const devices = [left, right] as const;
  if (document.mode === 'prewire') {
    for (const device of devices) {
      const block = prewireBlock(device, catalog.verifiedProfiles);
      if (block) return [blockedPlan(intent, block.code, block.message, devices)];
    }
  }
  const pairs = candidatePairs(intent, left, right);
  if (!pairs.length) {
    return [blockedPlan(
      intent,
      'NO_COMPATIBLE_TERMINAL_PAIR',
      '선택한 목적에 맞는 검증된 단자 조합이 없습니다. 장비 설정과 매뉴얼 단자 역할을 확인하세요.',
      devices,
    )];
  }
  const refs = evidenceReferences(...devices);
  const grade = evidenceGrade(devices);
  const orderedPairs = [...pairs].sort((leftPair, rightPair) => {
    const roleDifference = CIRCUIT_ROLE_ORDER[circuitRole(intent, leftPair)]
      - CIRCUIT_ROLE_ORDER[circuitRole(intent, rightPair)];
    return roleDifference
      || compareRefs(leftPair.left.ref, rightPair.left.ref)
      || compareRefs(leftPair.right.ref, rightPair.right.ref);
  });
  return orderedPairs.map((pair) => {
    const step = directStep(document, pair, intent, refs);
    const remaining = step.status === 'BLOCKED'
      ? []
      : companionPrerequisites(document, pair, intent, pairs, refs);
    const status: WiringGuideStatusV3 = step.status === 'BLOCKED'
      ? 'BLOCKED'
      : remaining.length
        ? 'REQUIRES_PREREQUISITE'
        : step.status;
    const suffix = grade === 'educational' ? ' 교육용 프로필 안내이며 검토 통과 근거가 아닙니다.' : '';
    return {
      id: `${intent}:${refKey(step.from ?? pair.left.ref)}:${refKey(step.to ?? pair.right.ref)}`,
      intent,
      status,
      reasonCode: status === 'REQUIRES_PREREQUISITE' ? 'CIRCUIT_PREREQUISITE_REQUIRED' : step.reasonCode,
      message: `${step.message}${suffix}`,
      evidenceGrade: grade,
      steps: [step],
      remainingPrerequisites: remaining,
    };
  });
}
