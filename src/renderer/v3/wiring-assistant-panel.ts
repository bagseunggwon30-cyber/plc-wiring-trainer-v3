import type { TerminalReferenceV3 } from '../../domain/v3';
import type {
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

function refText(ref: TerminalReferenceV3 | undefined): string {
  return ref ? `${ref.elementId}:${ref.terminalId}` : '단자 미지정';
}

function stepRefs(step: WiringGuideStepV3): string[] {
  return [step.from, step.to].filter((ref): ref is TerminalReferenceV3 => ref !== undefined).map(refText);
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
  let calculating = false;

  const section = document.createElement('section');
  section.className = 'v3-wiring-assistant';
  section.setAttribute('aria-labelledby', 'v3-wiring-assistant-heading');
  const heading = document.createElement('h3');
  heading.id = 'v3-wiring-assistant-heading'; heading.textContent = '결선 안내';
  const help = document.createElement('p');
  help.className = 'v3-wiring-help';
  help.textContent = '장비 두 대와 결선 목적을 지정하면 공급·신호·0V/N 귀로를 분리해 안내합니다. 안내는 정식 검증 결과가 아닙니다.';
  const selection = document.createElement('output');
  selection.className = 'v3-wiring-selection'; selection.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div'); controls.className = 'v3-wiring-controls';
  const intentSelect = document.createElement('select'); intentSelect.setAttribute('aria-label', '결선 목적');
  for (const intent of INTENTS) intentSelect.add(new Option(intent.label, intent.value));
  const calculateButton = button('안내 계산', () => { void calculate(); }, 'primary');
  const selectButton = button('두 장비 선택 시작', () => {
    options.clearSelection();
    options.setStatus('결선 안내: 첫 장비를 클릭한 뒤 Ctrl+클릭으로 두 번째 장비를 선택하세요.');
  });
  controls.append(intentSelect, calculateButton, selectButton);
  const result = document.createElement('div');
  result.className = 'v3-wiring-results'; result.setAttribute('aria-live', 'polite');
  section.append(heading, help, selection, controls, result);

  const renderSelection = (): void => {
    selection.textContent = selectedDeviceIds.length === 2
      ? `선택됨: ${selectedDeviceIds[0]} ↔ ${selectedDeviceIds[1]}`
      : `선택 장비 ${selectedDeviceIds.length}/2 · 첫 장비 클릭 후 Ctrl+클릭으로 두 번째 장비를 추가하세요.`;
    calculateButton.disabled = selectedDeviceIds.length !== 2 || calculating;
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

  const calculate = async (): Promise<void> => {
    if (selectedDeviceIds.length !== 2 || calculating) return;
    calculating = true; plans = null; renderSelection(); renderPlans();
    try {
      plans = await options.calculate(
        [selectedDeviceIds[0], selectedDeviceIds[1]],
        intentSelect.value as WiringIntentV3,
      );
      options.setStatus(`결선 안내 계산 완료 · 후보 ${plans.length}개 · 정식 검증은 마지막에 별도로 실행하세요.`);
    } catch (error) {
      plans = [{
        id: 'assistant:error', intent: intentSelect.value as WiringIntentV3, status: 'BLOCKED',
        reasonCode: 'WIRING_GUIDE_ERROR', message: error instanceof Error ? error.message : String(error),
        evidenceGrade: 'educational', steps: [], remainingPrerequisites: [],
      }];
      options.setStatus(`결선 안내 BLOCKED · ${plans[0].message}`);
    } finally {
      calculating = false; renderSelection(); renderPlans();
    }
  };

  renderSelection(); renderPlans();
  return {
    element: section,
    setSelection(deviceIds) {
      const next = [...new Set(deviceIds)].slice(0, 3);
      if (next.join('\u0000') === selectedDeviceIds.join('\u0000')) return;
      selectedDeviceIds = next; plans = null; renderSelection(); renderPlans();
    },
    markStale(message = '문서가 변경되어 이전 결선 안내가 STALE 상태입니다. 다시 계산하세요.') {
      if (plans === null) return;
      plans = null; renderPlans();
      result.replaceChildren();
      const stale = document.createElement('p'); stale.className = 'v3-wiring-stale'; stale.textContent = message; result.appendChild(stale);
    },
  };
}
