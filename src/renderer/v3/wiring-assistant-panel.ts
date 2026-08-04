import type { TerminalReferenceV3 } from '../../domain/v3';
import type {
  WiringCircuitRoleV3,
  WiringGuidePlanV3,
  WiringGuideStepV3,
  WiringIntentV3,
} from '../../domain/v3/wiring-assistant';

export interface WiringPreviewResultV3 {
  readonly ok: boolean;
  readonly code: string;
  readonly reason: string;
}

export interface WiringAssistantPanelOptions {
  readonly calculate: (
    deviceIds: readonly [string, string],
    intent: WiringIntentV3,
  ) => Promise<readonly WiringGuidePlanV3[]>;
  readonly focus: (refs: readonly string[]) => void;
  readonly preview: (from: TerminalReferenceV3, to: TerminalReferenceV3) => WiringPreviewResultV3;
  readonly showFlow: (steps: readonly WiringGuideStepV3[]) => void;
  readonly clearFlow: () => void;
  readonly clearSelection: () => void;
  readonly setStatus: (message: string) => void;
}

export interface WiringAssistantPanelController {
  readonly element: HTMLElement;
  setSelection(deviceIds: readonly string[]): void;
  markStale(message?: string): void;
}

const INTENTS: readonly { value: WiringIntentV3; label: string }[] = [
  { value: 'dc-power', label: 'DC 전원·귀로' },
  { value: 'ac-power', label: 'AC L/N 전원' },
  { value: 'digital-input', label: 'PLC 디지털 입력' },
  { value: 'digital-output', label: 'PLC 출력·부하' },
  { value: 'relay-contact', label: '릴레이 무전압 접점' },
  { value: 'analog-voltage', label: '아날로그 전압' },
  { value: 'analog-current', label: '아날로그 전류' },
  { value: 'rs485', label: 'RS485 A/B' },
  { value: 'protective-earth', label: 'PE 보호접지' },
  { value: 'three-phase', label: '3상 U/V/W' },
];

const STATUS_LABEL: Readonly<Record<WiringGuidePlanV3['status'], string>> = {
  READY: '결선 가능',
  REQUIRES_PREREQUISITE: '추가 경로 필요',
  ALREADY_CONNECTED: '이미 결선됨',
  BLOCKED: '차단',
};

const FLOW_ROLE_ORDER: Readonly<Record<WiringCircuitRoleV3, number>> = {
  source: 0,
  signal: 1,
  'differential-pair': 1,
  return: 2,
  pe: 3,
};

const FLOW_ROLE_LABEL: Readonly<Record<WiringCircuitRoleV3, string>> = {
  source: '① + 공급',
  signal: '② 장비·신호',
  'differential-pair': '② 장비·신호',
  return: '③ 0V/N 귀로',
  pe: 'PE 보호접지',
};

function refText(ref: TerminalReferenceV3 | undefined): string {
  return ref ? `${ref.elementId}:${ref.terminalId}` : '단자 미지정';
}

function stepRefs(step: WiringGuideStepV3): string[] {
  return [step.from, step.to].filter((ref): ref is TerminalReferenceV3 => ref !== undefined).map(refText);
}

function hasUsableConductor(plans: readonly WiringGuidePlanV3[]): boolean {
  return plans.some((plan) => plan.steps.some((step) =>
    step.kind === 'conductor'
    && step.status !== 'BLOCKED'
    && step.from !== undefined
    && step.to !== undefined));
}

function flowStepsFromPlans(
  plans: readonly WiringGuidePlanV3[],
  intent: WiringIntentV3,
): readonly WiringGuideStepV3[] {
  const usable = plans.filter((plan) => plan.steps.some((step) =>
    step.kind === 'conductor'
    && step.status !== 'BLOCKED'
    && step.from !== undefined
    && step.to !== undefined));
  const selectedPlans: WiringGuidePlanV3[] = [];
  if (intent === 'three-phase') {
    selectedPlans.push(...usable.slice(0, 3));
  } else {
    const coveredRoles = new Set<WiringCircuitRoleV3>();
    for (const plan of usable) {
      const directRoles = new Set(plan.steps.filter((step) =>
        step.kind === 'conductor'
        && step.status !== 'BLOCKED'
        && step.from !== undefined
        && step.to !== undefined).map((step) => step.circuitRole));
      if ([...directRoles].every((role) => coveredRoles.has(role))) continue;
      selectedPlans.push(plan);
      for (const role of directRoles) coveredRoles.add(role);
    }
  }
  const unique = new Map<string, WiringGuideStepV3>();
  for (const step of selectedPlans.flatMap((plan) => [...plan.steps, ...plan.remainingPrerequisites])) {
    if (step.status === 'BLOCKED' || (!step.from && !step.to)) continue;
    const key = [step.circuitRole, refText(step.from), refText(step.to)].join('\u0000');
    if (!unique.has(key)) unique.set(key, step);
  }
  return [...unique.values()].sort((left, right) =>
    FLOW_ROLE_ORDER[left.circuitRole] - FLOW_ROLE_ORDER[right.circuitRole]
    || refText(left.from).localeCompare(refText(right.from), 'ko')
    || refText(left.to).localeCompare(refText(right.to), 'ko'));
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = label; element.className = className;
  element.addEventListener('click', onClick);
  return element;
}

export function createWiringAssistantPanel(options: WiringAssistantPanelOptions): WiringAssistantPanelController {
  let selectedDeviceIds: readonly string[] = [];
  let plans: readonly WiringGuidePlanV3[] | null = null;
  let flowSteps: readonly WiringGuideStepV3[] = [];
  let calculating = false;
  let calculationSequence = 0;

  const section = document.createElement('section');
  section.className = 'v3-wiring-assistant';
  section.setAttribute('aria-labelledby', 'v3-wiring-assistant-heading');
  const heading = document.createElement('h3');
  heading.id = 'v3-wiring-assistant-heading'; heading.textContent = '결선 안내';
  const help = document.createElement('p');
  help.className = 'v3-wiring-help';
  help.textContent = '빈 공간 드래그 또는 Ctrl+클릭으로 장비 두 대를 선택하면 공급·신호·0V/N 귀로를 자동 안내합니다. 안내는 정식 검증 결과가 아닙니다.';
  const selection = document.createElement('output');
  selection.className = 'v3-wiring-selection'; selection.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div'); controls.className = 'v3-wiring-controls';
  const intentSelect = document.createElement('select'); intentSelect.setAttribute('aria-label', '결선 목적');
  for (const intent of INTENTS) intentSelect.add(new Option(intent.label, intent.value));
  const calculateButton = button('안내 계산', () => { void calculate('manual'); }, 'primary');
  const selectButton = button('두 장비 선택 시작', () => {
    calculationSequence += 1; calculating = false; plans = null; flowSteps = [];
    options.clearFlow(); renderFlow(); renderPlans();
    options.clearSelection();
    options.setStatus('결선 안내: 빈 공간을 드래그하거나 첫 장비 클릭 후 Ctrl+클릭으로 두 번째 장비를 선택하세요.');
  });
  controls.append(intentSelect, calculateButton, selectButton);
  const flow = document.createElement('div');
  flow.className = 'v3-wiring-flow'; flow.hidden = true; flow.setAttribute('aria-live', 'polite');
  const result = document.createElement('div');
  result.className = 'v3-wiring-results'; result.setAttribute('aria-live', 'polite');
  section.append(heading, help, selection, controls, flow, result);

  const renderSelection = (): void => {
    selection.textContent = selectedDeviceIds.length === 2
      ? `선택됨: ${selectedDeviceIds[0]} ↔ ${selectedDeviceIds[1]}`
      : `선택 장비 ${selectedDeviceIds.length}/2 · 빈 공간 드래그 또는 Ctrl+클릭으로 장비 두 대를 선택하세요.`;
    calculateButton.disabled = selectedDeviceIds.length !== 2 || calculating;
  };

  const renderFlow = (): void => {
    flow.replaceChildren();
    flow.hidden = flowSteps.length === 0;
    if (!flowSteps.length) return;
    const title = document.createElement('b');
    title.className = 'v3-wiring-flow-title'; title.textContent = '선택 장비 결선 흐름';
    const internal = document.createElement('p');
    internal.className = 'v3-wiring-flow-internal';
    internal.textContent = '① + 공급 → ② 장비·신호(접점/입력/부하) → ③ 0V/N 귀로';
    flow.append(title, internal);
    for (const step of flowSteps) {
      const row = document.createElement('div');
      row.className = `v3-wiring-flow-step ${step.circuitRole}`;
      const role = document.createElement('b'); role.textContent = FLOW_ROLE_LABEL[step.circuitRole];
      const path = document.createElement('span');
      const refs = stepRefs(step);
      path.textContent = refs.length ? refs.join(' → ') : step.message;
      row.append(role, path); flow.appendChild(row);
    }
  };

  const renderPlans = (): void => {
    result.replaceChildren();
    if (calculating) {
      const pending = document.createElement('p'); pending.className = 'v3-wiring-empty'; pending.textContent = '결선 경로를 계산하고 있습니다…'; result.appendChild(pending); return;
    }
    if (plans === null) {
      const empty = document.createElement('p'); empty.className = 'v3-wiring-empty'; empty.textContent = '선택 후 안내 계산을 누르세요.'; result.appendChild(empty); return;
    }
    for (const plan of plans) {
      const card = document.createElement('article'); card.className = `v3-wiring-plan ${plan.status.toLowerCase()}`;
      const title = document.createElement('div'); title.className = 'v3-wiring-plan-title';
      const badge = document.createElement('span'); badge.className = 'v3-wiring-badge'; badge.textContent = STATUS_LABEL[plan.status];
      const grade = document.createElement('span'); grade.className = `v3-wiring-grade ${plan.evidenceGrade}`;
      grade.textContent = plan.evidenceGrade === 'educational' ? '교육용' : plan.evidenceGrade;
      title.append(badge, grade); card.appendChild(title);
      const direct = plan.steps.find((step) => step.kind === 'conductor');
      if (direct) {
        card.dataset.directFrom = refText(direct.from);
        card.dataset.directTo = refText(direct.to);
      }
      const path = document.createElement('strong'); path.className = 'v3-wiring-path';
      path.textContent = direct ? `${refText(direct.from)} → ${refText(direct.to)}` : plan.reasonCode;
      const reason = document.createElement('p'); reason.textContent = plan.message;
      card.append(path, reason);
      if (plan.remainingPrerequisites.length) {
        const prerequisiteTitle = document.createElement('b'); prerequisiteTitle.textContent = '남은 필수 경로·확인'; card.appendChild(prerequisiteTitle);
        const list = document.createElement('ul');
        for (const prerequisite of plan.remainingPrerequisites) {
          const item = document.createElement('li');
          const refs = stepRefs(prerequisite);
          item.textContent = `${prerequisite.reasonCode} · ${prerequisite.message}${refs.length ? ` (${refs.join(' → ')})` : ''}`;
          list.appendChild(item);
        }
        card.appendChild(list);
      }
      const evidence = direct?.evidenceRefs ?? plan.steps.flatMap((step) => step.evidenceRefs);
      if (evidence.length) {
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = `매뉴얼 근거 ${evidence.length}건`;
        const evidenceList = document.createElement('ul');
        for (const entry of [...new Set(evidence)]) { const item = document.createElement('li'); item.textContent = entry; evidenceList.appendChild(item); }
        details.append(summary, evidenceList); card.appendChild(details);
      }
      if (direct?.from && direct.to) {
        const actions = document.createElement('div'); actions.className = 'v3-wiring-actions';
        actions.appendChild(button('위치 표시', () => options.focus(stepRefs(direct))));
        const previewButton = button(direct.status === 'ALREADY_CONNECTED' ? '연결 완료' : '결선 시작', () => {
          if (!direct.from || !direct.to) return;
          const preview = options.preview(direct.from, direct.to);
          options.setStatus(preview.ok
            ? `${refText(direct.from)} → ${refText(direct.to)} 미리보기 · 대상 단자를 클릭하면 연결됩니다.`
            : `${preview.code} · ${preview.reason}`);
        }, 'primary');
        previewButton.disabled = direct.status !== 'READY';
        actions.appendChild(previewButton); card.appendChild(actions);
      }
      result.appendChild(card);
    }
  };

  const calculate = async (trigger: 'manual' | 'automatic' = 'manual'): Promise<void> => {
    if (selectedDeviceIds.length !== 2 || calculating) return;
    const request = ++calculationSequence;
    const pair = [selectedDeviceIds[0], selectedDeviceIds[1]] as const;
    const requestedIntent = intentSelect.value as WiringIntentV3;
    calculating = true; plans = null; flowSteps = []; options.clearFlow();
    renderSelection(); renderFlow(); renderPlans();
    try {
      let resolvedIntent = requestedIntent;
      let nextPlans = await options.calculate(pair, requestedIntent);
      if (trigger === 'automatic' && !hasUsableConductor(nextPlans)) {
        for (const candidate of INTENTS) {
          if (candidate.value === requestedIntent) continue;
          const candidatePlans = await options.calculate(pair, candidate.value);
          if (request !== calculationSequence) return;
          if (!hasUsableConductor(candidatePlans)) continue;
          resolvedIntent = candidate.value; nextPlans = candidatePlans; break;
        }
      }
      if (request !== calculationSequence
        || pair.join('\u0000') !== selectedDeviceIds.join('\u0000')) return;
      plans = nextPlans;
      intentSelect.value = resolvedIntent;
      flowSteps = flowStepsFromPlans(plans, resolvedIntent);
      options.showFlow(flowSteps);
      options.setStatus(`결선 안내 계산 완료 · 후보 ${plans.length}개 · 정식 검증은 마지막에 별도로 실행하세요.`);
    } catch (error) {
      if (request !== calculationSequence) return;
      plans = [{
        id: 'assistant:error', intent: requestedIntent, status: 'BLOCKED',
        reasonCode: 'WIRING_GUIDE_ERROR', message: error instanceof Error ? error.message : String(error),
        evidenceGrade: 'educational', steps: [], remainingPrerequisites: [],
      }];
      flowSteps = []; options.clearFlow();
      options.setStatus(`결선 안내 BLOCKED · ${plans[0].message}`);
    } finally {
      if (request === calculationSequence) {
        calculating = false; renderSelection(); renderFlow(); renderPlans();
      }
    }
  };

  intentSelect.addEventListener('change', () => {
    calculationSequence += 1; calculating = false; plans = null; flowSteps = [];
    options.clearFlow(); renderSelection(); renderFlow(); renderPlans();
    if (selectedDeviceIds.length === 2) void calculate('manual');
  });

  renderSelection(); renderFlow(); renderPlans();
  return {
    element: section,
    setSelection(deviceIds) {
      const next = [...new Set(deviceIds)].slice(0, 3);
      if (next.join('\u0000') === selectedDeviceIds.join('\u0000')) return;
      calculationSequence += 1; calculating = false;
      selectedDeviceIds = next; plans = null; flowSteps = []; options.clearFlow();
      renderSelection(); renderFlow(); renderPlans();
      if (selectedDeviceIds.length === 2) void calculate('automatic');
    },
    markStale(message = '문서가 변경되어 이전 결선 안내가 STALE 상태입니다. 다시 계산하세요.') {
      const hadGuidance = plans !== null || calculating || flowSteps.length > 0;
      calculationSequence += 1; calculating = false; plans = null; flowSteps = [];
      options.clearFlow(); renderFlow();
      if (!hadGuidance) { renderPlans(); return; }
      result.replaceChildren();
      const stale = document.createElement('p'); stale.className = 'v3-wiring-stale'; stale.textContent = message; result.appendChild(stale);
    },
  };
}
