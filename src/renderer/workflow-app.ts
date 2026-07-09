import { DEVICE_PROFILES } from '../catalog/profiles';
import type { ValidationIssue, ValidationResult } from '../domain/engine-types';
import { evaluateMission, type MissionEvaluationResult } from '../domain/mission-evaluator';
import { sha256, migrateLegacyLocalStorage } from '../domain/migration';
import { PUBLIC_MISSIONS, type MissionDefinitionV2, type RoleBinding } from '../domain/missions';
import { generateReviewReport, serializeReviewReport } from '../domain/report';
import { simulateScenario } from '../domain/simulator';
import type { WorkshopDocumentV2, WorkshopMode } from '../domain/types';
import { validateWorkshop } from '../domain/validator';
import {
  adaptLegacyState,
  LEGACY_PROFILE_MAP,
  mergeWorkshopShadow,
  type LegacyTrainerState,
  type WorkshopShadowSnapshot,
} from './legacy-adapter';
import {
  installModeSelector,
  isLegacyTypeAllowed,
  MODE_STORAGE_KEY,
  normalizeWorkshopMode,
} from './mode-controller';
import {
  loadWorkshopV2,
  saveWorkshopV2,
  WORKSHOP_V2_STORAGE_KEY,
} from './workshop-persistence';

interface LegacyTrainerBridge {
  readState(): LegacyTrainerState;
  readV2Shadow(): WorkshopShadowSnapshot | null;
  clearV2Shadow(): void;
  rememberDocumentV2(document: WorkshopDocumentV2): void;
  applyDocumentV2(document: WorkshopDocumentV2): void;
  undo(): void;
  redo(): void;
  setStatus(message: string): void;
  focusRefs(refs: string[]): void;
  downloadJson(value: unknown, filename: string): void;
}

interface CoreRun {
  document: WorkshopDocumentV2;
  validation: ValidationResult;
  evaluation?: MissionEvaluationResult;
}

const LEGACY_STORAGE_KEY = 'wiring-workshop-v2';

const WORKFLOW_STYLES = `
  :focus-visible{outline:3px solid #ffd54f!important;outline-offset:2px}
  .mode-selector{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:24px;background:rgba(6,10,16,.86);backdrop-filter:blur(5px)}
  .mode-selector-card{width:min(720px,96vw);background:#151b24;color:#eef4ff;border:1px solid #52637a;border-radius:16px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.55)}
  .mode-selector-kicker{margin:0;color:#8fc7ff;font-weight:800;letter-spacing:.08em}.mode-selector h1{margin:6px 0 8px;font-size:28px}
  .mode-selector-actions{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}
  .mode-selector-actions button{min-height:122px;text-align:left;border:1px solid #52637a;border-radius:12px;background:#202a38;color:#fff;padding:18px;cursor:pointer}
  .mode-selector-actions button[aria-pressed=true]{border-color:#69b7ff;box-shadow:0 0 0 2px rgba(105,183,255,.25)}
  .mode-selector-actions strong,.mode-selector-actions span{display:block}.mode-selector-actions strong{font-size:18px;margin-bottom:8px}.mode-selector-actions span{color:#c3cfdd;line-height:1.45}
  .mode-selector-warning{margin:0;color:#ffc982;font-size:12px}
  #core-toolbar{display:inline-flex;align-items:center;gap:3px;padding:3px;background:#17202b;border:1px solid #334254;border-radius:6px}
  #core-toolbar .workflow-mode-badge{padding:2px 7px;border-radius:10px;background:#243d55;color:#a9d7ff;white-space:nowrap;font-weight:700}
  #advanced-tools{position:relative;margin-left:3px;color:#bbb}#advanced-tools>summary{cursor:pointer;list-style:none;border:1px solid #444;border-radius:4px;padding:3px 8px;background:#242424}
  #advanced-tools>summary::-webkit-details-marker{display:none}.advanced-tools-body{display:none}
  #advanced-tools[open] .advanced-tools-body{display:flex;position:fixed;z-index:1200;left:12px;right:12px;top:42px;max-height:45vh;overflow:auto;flex-wrap:wrap;align-items:center;gap:4px;padding:10px;background:#111;border:1px solid #555;border-radius:8px;box-shadow:0 10px 32px rgba(0,0,0,.55)}
  body[data-workshop-mode=prewire] .auto-wire-btn{display:none!important}.pal.mode-hidden,.mode-category-hidden{display:none!important}
  body[data-workshop-mode=prewire] .practice-only-section{display:none!important}
  .mission-v2{border:1px solid #3d4f63;border-radius:7px;margin:6px 0;background:#192331;overflow:hidden}.mission-v2.active{border-color:#65aee8;background:#1d2d40}
  .mission-v2-header{display:block;width:100%;padding:9px;text-align:left;border:0;background:transparent;color:#eaf4ff;cursor:pointer}.mission-v2-header strong{display:block}.mission-v2-header span{display:block;color:#9eafc1;font-size:10px;margin-top:3px}
  .mission-v2-body{padding:0 9px 10px}.mission-role{display:grid;grid-template-columns:minmax(90px,1fr) 1.5fr;align-items:center;gap:6px;margin:6px 0}.mission-role select{min-width:0;background:#101923;color:#eee;border:1px solid #52637a;border-radius:4px;padding:4px}
  .mission-hints{margin-top:8px;padding:7px;background:#14251d;border-left:3px solid #5fa978;border-radius:4px}.mission-hint{margin:4px 0;color:#cde8d5;font-size:10px}.mission-answer{color:#ffe28a}
  .mission-v2-actions{display:flex;gap:6px;margin-top:8px}.mission-v2-actions button{flex:1;padding:6px;background:#274d6d;color:#fff;border:1px solid #4f83ad;border-radius:4px;cursor:pointer}
  .core-validation-status{font-weight:800;margin-bottom:6px}.core-validation-status.pass{color:#8fda9a}.core-validation-status.fail{color:#ff9b8f}.core-validation-status.blocked{color:#ffd178}
  .core-issue{display:block;width:100%;text-align:left;margin:5px 0;padding:7px;border:1px solid #663f3f;border-radius:5px;background:#321f22;color:#f7d8d8;cursor:pointer}.core-issue.blocked{border-color:#735f2d;background:#342d1b;color:#ffe7a8}.core-issue small{display:block;color:#bdb7b7;margin-top:3px;line-height:1.35}
  @media(max-width:1280px){.mode-selector-actions{grid-template-columns:1fr}#core-toolbar button{font-size:10px;padding:3px 5px}.workflow-mode-badge{display:none}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

function injectStyles(): void {
  if (document.getElementById('workflow-v2-styles')) return;
  const style = document.createElement('style');
  style.id = 'workflow-v2-styles';
  style.textContent = WORKFLOW_STYLES;
  document.head.appendChild(style);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing renderer element #${id}`);
  return element as T;
}

export const ISSUE_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
    UNKNOWN_TERMINAL: '장비 프로필과 단자 ID를 확인하고 해당 연결을 다시 지정하세요.',
    MISSING_PROFILE: '검토 가능한 정확한 모델 프로필로 장비를 교체하세요.',
    EMPTY_REVIEW_SCOPE: '검토할 설치 장비를 한 대 이상 배치하고 정확한 프로필을 지정하세요.',
    PROFILE_VERSION_MISMATCH: '현재 카탈로그 버전과 일치하는 프로필로 장비를 다시 지정하세요.',
    AC_PHASE_NEUTRAL_SHORT: '상선과 N을 분리하고 L/N 단자를 각각 다시 결선하세요.',
    AC_PHASE_CONFLICT: '서로 다른 상을 같은 네트에서 분리하세요.',
    DC_SHORT: '+24V와 0V 사이의 직접 연결 또는 잘못된 점퍼를 제거하세요.',
    PE_MIXED: 'PE를 전원·신호 도체와 분리해 전용 접지 경로로 연결하세요.',
    PARALLEL_SOURCE: '내부/외부 전원 중 하나만 선택하고 독립 전원 병렬 연결을 제거하세요.',
    TERMINAL_POTENTIAL_MISMATCH: '표시된 단자가 요구하는 상·전위를 확인해 맞는 전원선으로 옮기세요.',
    ANALOG_MODE_MISMATCH: '전압 채널과 전류 채널을 분리하고 장비 설정과 단자를 일치시키세요.',
    RS485_POLARITY_MISMATCH: 'A(+)는 A(+), B(-)는 B(-)끼리 다시 연결하세요.',
    UNKNOWN_FORCED_OUTPUT: '프로필에 정의된 릴레이 출력 단자만 강제 시험 대상으로 선택하세요.',
    NON_CONVERGENT_SIMULATION: '동적 접점의 순환 조건을 제거하고 접점 초기 상태를 확인하세요.',
    MISSION_CONNECTION_MISSING: '역할에 지정된 장비의 표시 단자 사이 결선을 완성하세요.',
    MISSION_STATE_MISMATCH: '해당 시나리오의 접점/강제 출력과 COM 결선을 확인하세요.',
    UNSUPPORTED_FORBIDDEN_RULE: '지원되는 판정 규칙으로 미션 정의를 수정한 뒤 다시 실행하세요.',
    MISSION_MODE_NOT_ELIGIBLE: '이 미션을 지원하는 연습/검토 모드로 전환하세요.',
    UNKNOWN_MISSION_ROLE: '미션 정의에 존재하는 역할만 사용하세요.',
    DUPLICATE_ROLE_BINDING: '한 역할에는 장비 한 대만 지정하세요.',
    DUPLICATE_DEVICE_BINDING: '서로 다른 역할에는 서로 다른 장비 인스턴스를 지정하세요.',
    MISSING_ROLE_BINDING: '미션 역할마다 사용할 장비 인스턴스를 직접 선택하세요.',
    BOUND_DEVICE_NOT_FOUND: '문서에 존재하는 장비를 역할에 다시 지정하세요.',
    ROLE_PROFILE_MISMATCH: '역할이 요구하는 모델의 장비를 선택하세요.',
    ROLE_PROFILE_NOT_VERIFIED: '사전 검토에서는 수동 검증 이상 등급의 프로필만 선택하세요.',
    UNVERIFIED_PROFILE: '교육용 장비를 제거하거나 연습 모드에서 사용하세요.',
    INSTANCE_EVIDENCE_DOWNGRADED: '전기적 단자 보정을 되돌리거나 검증된 원본 프로필을 다시 사용하세요.',
    UNPOWERED_SOURCE_OUTPUT: 'MDR의 L/N 입력을 정상 공급하고 외부 출력 역급전을 제거하세요.',
    INPUT_COMMON_POLARITY: 'P00 신호와 COMI가 서로 반대 전위가 되도록 결선하세요.',
    OUTPUT_ON_WHEN_OFF: '강제 OFF 시 부하로 이어지는 우회 전원 경로를 제거하세요.',
    NC_TERMINAL_USED: 'NC 표시 단자의 모든 와이어와 점퍼를 제거하세요.',
    FORWARD_REVERSE_SIMULTANEOUS: '정회전과 역회전 명령이 동시에 닫히는 우회 경로를 제거하세요.',
    EXTERNAL_SUPPLY_VARIANT_UNKNOWN: '정확한 전원 변형이 검증될 때까지 연습 모드에서만 사용하세요.',
    BYPASSED_TERMINAL_BLOCK: 'PLC와 도어 기기 사이의 직접선을 제거하고 지정 단자대를 경유하세요.',
    STOP_CONTACT_BYPASSED: '운전 입력의 모든 전원 경로가 정지 접점을 통과하도록 다시 결선하세요.',
  });

export function issueAction(code: string): string {
  return ISSUE_ACTIONS[code] ?? '관련 단자와 와이어를 확인한 뒤 문서를 다시 검증하세요.';
}

export interface LoadedMissionState {
  missionId: string | null;
  bindings: Map<string, string>;
}

export function resetMissionSessionState(
  bindings: Map<string, Map<string, string>>,
  hints: Map<string, number>,
): void {
  bindings.clear();
  hints.clear();
}

export function missionStateFromDocument(document: WorkshopDocumentV2): LoadedMissionState {
  const missionId = typeof document.settings.missionId === 'string' ? document.settings.missionId : null;
  const mission = PUBLIC_MISSIONS.find((entry) => entry.id === missionId);
  const bindings = new Map<string, string>();
  if (!mission || !document.settings.roleBindings || typeof document.settings.roleBindings !== 'object') {
    return { missionId: mission ? mission.id : null, bindings };
  }
  const raw = document.settings.roleBindings as Record<string, unknown>;
  for (const role of mission.roles) {
    const deviceId = raw[role.id];
    if (typeof deviceId !== 'string') continue;
    const device = document.devices.find((entry) => entry.id === deviceId);
    if (device && role.allowedProfileIds.includes(device.profileId)) bindings.set(role.id, deviceId);
  }
  return { missionId: mission.id, bindings };
}

export function installWorkflowApp(): void {
  injectStyles();
  const bridge = (window as unknown as { LegacyTrainerBridge?: LegacyTrainerBridge }).LegacyTrainerBridge;
  if (!bridge) throw new Error('LegacyTrainerBridge is unavailable');

  let currentMode = normalizeWorkshopMode(localStorage.getItem(MODE_STORAGE_KEY));
  let selectedMissionId: string | null = null;
  let missionRenderToken = 0;
  const bindingsByMission = new Map<string, Map<string, string>>();
  const hintLevelByMission = new Map<string, number>();

  const header = document.querySelector<HTMLElement>('header');
  if (!header) throw new Error('Missing header');
  const coreToolbar = document.createElement('span');
  coreToolbar.id = 'core-toolbar';
  const modeBadge = document.createElement('span');
  modeBadge.className = 'workflow-mode-badge';
  coreToolbar.appendChild(modeBadge);

  const moveButton = (id: string): HTMLButtonElement => {
    const button = requiredElement<HTMLButtonElement>(id);
    coreToolbar.appendChild(button);
    return button;
  };
  const selectButton = moveButton('m-select');
  const wireButton = moveButton('m-wire');
  void selectButton; void wireButton;
  const undoButton = document.createElement('button');
  undoButton.id = 'b-undo'; undoButton.type = 'button'; undoButton.textContent = '↩ 실행취소';
  undoButton.title = '실행 취소 (Ctrl+Z)'; undoButton.addEventListener('click', () => bridge.undo());
  coreToolbar.appendChild(undoButton);
  const redoButton = document.createElement('button');
  redoButton.id = 'b-redo'; redoButton.type = 'button'; redoButton.textContent = '↪ 다시실행';
  redoButton.title = '다시 실행 (Ctrl+Y)'; redoButton.addEventListener('click', () => bridge.redo());
  coreToolbar.appendChild(redoButton);
  const validateButton = moveButton('b-validate');
  const simulateButton = moveButton('b-simulate');
  const saveButton = moveButton('b-save');

  const modeButton = document.createElement('button');
  modeButton.id = 'b-workshop-mode'; modeButton.type = 'button'; modeButton.textContent = '모드 변경';
  modeButton.title = '연습/사전 결선 검토 모드 선택';
  coreToolbar.appendChild(modeButton);

  const badge = header.querySelector('.edu-badge');
  badge?.insertAdjacentElement('afterend', coreToolbar);

  const advanced = document.createElement('details');
  advanced.id = 'advanced-tools';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = '고급 도구';
  const advancedBody = document.createElement('div');
  advancedBody.className = 'advanced-tools-body';
  advanced.append(advancedSummary, advancedBody);

  const title = header.querySelector(':scope > b');
  const counter = requiredElement('counter').parentElement;
  const leftToggle = requiredElement('t-left');
  const rightToggle = requiredElement('t-right');
  const keep = new Set<Element>([coreToolbar, advanced, leftToggle, rightToggle]);
  if (title) keep.add(title);
  if (badge) keep.add(badge);
  if (counter) keep.add(counter);
  for (const child of [...header.children]) if (!keep.has(child)) advancedBody.appendChild(child);
  if (counter) header.insertBefore(advanced, counter); else header.appendChild(advanced);

  const legacyValidate = validateButton.onclick;
  const legacySimulate = simulateButton.onclick;
  const legacySave = saveButton.onclick;
  const loadButton = requiredElement<HTMLButtonElement>('b-load');
  const legacyLoad = loadButton.onclick;
  const reportButton = requiredElement<HTMLButtonElement>('b-export-report');
  const legacyReport = reportButton.onclick;

  for (const id of ['work-order', 'field-quality']) {
    const content = document.getElementById(id)?.parentElement;
    content?.classList.add('practice-only-section');
    content?.previousElementSibling?.classList.add('practice-only-section');
  }

  const missionForSelection = (): MissionDefinitionV2 | undefined =>
    PUBLIC_MISSIONS.find((mission) => mission.id === selectedMissionId);

  const selectedBindings = (mission: MissionDefinitionV2): RoleBinding[] => {
    const values = bindingsByMission.get(mission.id) ?? new Map<string, string>();
    return [...values].map(([role, deviceId]) => ({ role, deviceId }));
  };

  const readDocument = async (): Promise<WorkshopDocumentV2> => {
    const edited = await adaptLegacyState(bridge.readState(), currentMode, DEVICE_PROFILES);
    const shadow = bridge.readV2Shadow();
    const documentV2 = shadow
      ? mergeWorkshopShadow(shadow.document, edited, shadow.renderedDeviceIds)
      : edited;
    const mission = missionForSelection();
    if (mission) {
      documentV2.settings = {
        ...documentV2.settings,
        missionId: mission.id,
        roleBindings: Object.fromEntries(selectedBindings(mission).map((binding) => [binding.role, binding.deviceId])),
      };
    }
    return documentV2;
  };

  const evidenceForIssue = (issue: ValidationIssue, workshop: WorkshopDocumentV2): string[] => {
    const deviceIds = new Set<string>();
    for (const ref of issue.refs) {
      const direct = workshop.devices.find((device) => device.id === ref || ref.startsWith(`${device.id}:`));
      if (direct) deviceIds.add(direct.id);
      const wire = workshop.wires.find((entry) => entry.id === ref);
      if (wire) { deviceIds.add(wire.from.deviceId); deviceIds.add(wire.to.deviceId); }
    }
    const lines: string[] = [];
    for (const deviceId of deviceIds) {
      const instance = workshop.devices.find((device) => device.id === deviceId);
      const profile = instance && DEVICE_PROFILES[instance.profileId];
      for (const evidence of profile?.evidence.documents ?? []) {
        lines.push(`${profile?.model} · ${evidence.documentId} p.${evidence.pages.join(',')} · ${evidence.sha256.slice(0, 12)}…`);
      }
    }
    return [...new Set(lines)];
  };

  const renderValidation = (validation: ValidationResult, workshop: WorkshopDocumentV2): void => {
    const panel = requiredElement<HTMLElement>('validation');
    panel.className = 'box';
    panel.replaceChildren();
    const heading = document.createElement('div');
    heading.className = `core-validation-status ${validation.status.toLowerCase()}`;
    heading.textContent = validation.status === 'PASS'
      ? 'PASS · 필수 검사 완료'
      : validation.status === 'FAIL'
        ? 'FAIL · 안전/기능 오류 발견'
        : 'BLOCKED · 데이터 또는 시험 조건 불충분';
    panel.appendChild(heading);
    if (!validation.issues.length) {
      const okay = document.createElement('div');
      okay.className = 'ok'; okay.textContent = '차단 오류가 없습니다.'; panel.appendChild(okay);
      return;
    }
    for (const issue of validation.issues) {
      const item = document.createElement('button');
      item.type = 'button'; item.className = `core-issue ${issue.severity === 'blocked' ? 'blocked' : ''}`;
      const title = document.createElement('strong'); title.textContent = `${issue.code} · ${issue.message}`;
      const action = document.createElement('small'); action.textContent = `수정: ${issueAction(issue.code)}`;
      item.append(title, action);
      const refs = document.createElement('small'); refs.textContent = `관련: ${issue.refs.join(', ') || '전체 문서'}`; item.appendChild(refs);
      for (const evidence of evidenceForIssue(issue, workshop)) {
        const manual = document.createElement('small'); manual.textContent = `근거: ${evidence}`; item.appendChild(manual);
      }
      item.addEventListener('click', () => bridge.focusRefs(issue.refs));
      panel.appendChild(item);
    }
  };

  const normalizeMissionValidation = async (
    workshop: WorkshopDocumentV2,
    evaluation: MissionEvaluationResult,
  ): Promise<ValidationResult> => {
    if (evaluation.validation) return evaluation.validation;
    const baseline = await validateWorkshop(workshop, DEVICE_PROFILES);
    return {
      ...baseline,
      status: 'BLOCKED',
      issues: [...baseline.issues, ...evaluation.issues],
      documentHash: await sha256(workshop),
    };
  };

  const runCoreValidation = async (): Promise<CoreRun> => {
    const workshop = await readDocument();
    const mission = missionForSelection();
    if (mission) {
      const evaluation = await evaluateMission(mission, workshop, DEVICE_PROFILES, selectedBindings(mission));
      const validation = await normalizeMissionValidation(workshop, evaluation);
      renderValidation(validation, workshop);
      bridge.setStatus(`${mission.title}: ${validation.status} · 이슈 ${validation.issues.length}건`);
      return { document: workshop, validation, evaluation };
    }
    const validation = await validateWorkshop(workshop, DEVICE_PROFILES);
    renderValidation(validation, workshop);
    bridge.setStatus(`검토 검증: ${validation.status} · 이슈 ${validation.issues.length}건`);
    return { document: workshop, validation };
  };

  const renderSimulation = (run: CoreRun): void => {
    const monitor = requiredElement<HTMLElement>('sim-monitor');
    monitor.replaceChildren();
    const title = document.createElement('div');
    title.textContent = `결정적 I/O 시험 · ${run.validation.status}`;
    title.style.color = run.validation.status === 'PASS' ? '#8f8' : '#fc8';
    monitor.appendChild(title);
    const simulations = run.evaluation?.simulations ?? [];
    for (const simulation of simulations) {
      const row = document.createElement('div');
      const scenario = simulation.scenarioId;
      const activeInputs = Object.values(simulation.inputStates).flatMap((states) =>
        Object.entries(states).filter(([, active]) => active).map(([terminal]) => terminal));
      const activeOutputs = Object.values(simulation.outputStates).flatMap((states) =>
        Object.entries(states).filter(([, active]) => active).map(([terminal]) => terminal));
      row.textContent = `${scenario}: 입력[${activeInputs.join(',') || '-'}] 출력[${activeOutputs.join(',') || '-'}] 통전단자 ${simulation.energizedTerminals.length}`;
      monitor.appendChild(row);
    }
    if (!simulations.length) {
      const row = document.createElement('div');
      row.textContent = '기본 상태 검증만 실행됨'; monitor.appendChild(row);
    }
  };

  const runCoreSimulation = async (): Promise<void> => {
    const run = await runCoreValidation();
    if (run.evaluation) {
      renderSimulation(run);
      return;
    }
    if (run.validation.status !== 'PASS') {
      requiredElement('sim-monitor').textContent = '검증이 PASS가 아니므로 I/O 시험을 차단했습니다.';
      return;
    }
    const simulation = await simulateScenario(run.document, DEVICE_PROFILES, { id: 'default-review' });
    requiredElement('sim-monitor').textContent = `기본 상태 ${simulation.status} · 통전 단자 ${simulation.energizedTerminals.length} · ${simulation.iterations}회 수렴`;
  };

  const exportFreshReviewReport = async (): Promise<void> => {
    const run = await runCoreValidation();
    const report = await generateReviewReport(run.document, run.validation, DEVICE_PROFILES);
    const filename = report.classification === 'VERIFIED'
      ? `prewire-verified-r${run.document.revision}.json`
      : `prewire-diagnostic-r${run.document.revision}.json`;
    bridge.downloadJson(JSON.parse(serializeReviewReport(report)), filename);
    bridge.setStatus(report.classification === 'VERIFIED'
      ? '검증 리포트 발급 완료 · 최신 revision과 근거 해시 포함'
      : `진단 리포트 생성 · 통과 리포트 미발급 (${report.eligibility.reason ?? '검증 불충분'})`);
  };

  const applyPalettePolicy = (): void => {
    const palette = requiredElement('palette');
    palette.querySelectorAll<HTMLElement>('.pal[data-type]').forEach((item) => {
      item.classList.toggle('mode-hidden', !isLegacyTypeAllowed(currentMode, item.dataset.type ?? ''));
    });
    palette.querySelectorAll<HTMLElement>('h3[data-cat]').forEach((heading) => {
      const categoryItems = [...palette.querySelectorAll<HTMLElement>(`.pal[data-cat="${heading.dataset.cat}"]`)];
      heading.classList.toggle('mode-category-hidden', categoryItems.length > 0 && categoryItems.every((item) => item.classList.contains('mode-hidden')));
    });
  };

  const renderMissions = async (): Promise<void> => {
    const token = ++missionRenderToken;
    const workshop = await readDocument();
    if (token !== missionRenderToken) return;
    const panel = requiredElement<HTMLElement>('goals');
    panel.replaceChildren();
    const progress = requiredElement<HTMLElement>('mission-progress');
    const eligible = PUBLIC_MISSIONS.filter((mission) => mission.eligibleModes.includes(currentMode));
    progress.textContent = `${eligible.length}개 · ${currentMode === 'prewire' ? '검증 프로필 전용' : '힌트 제공'}`;

    for (const mission of eligible) {
      const card = document.createElement('article');
      card.className = `mission-v2 ${selectedMissionId === mission.id ? 'active' : ''}`;
      const headerButton = document.createElement('button');
      headerButton.type = 'button'; headerButton.className = 'mission-v2-header';
      const title = document.createElement('strong'); title.textContent = mission.title;
      const description = document.createElement('span'); description.textContent = mission.description;
      headerButton.append(title, description);
      headerButton.addEventListener('click', () => {
        selectedMissionId = selectedMissionId === mission.id ? null : mission.id;
        void renderMissions();
      });
      card.appendChild(headerButton);

      if (selectedMissionId === mission.id) {
        const body = document.createElement('div'); body.className = 'mission-v2-body';
        const missionBindings = bindingsByMission.get(mission.id) ?? new Map<string, string>();
        bindingsByMission.set(mission.id, missionBindings);
        for (const role of mission.roles) {
          const row = document.createElement('label'); row.className = 'mission-role';
          const roleName = document.createElement('span'); roleName.textContent = role.label;
          const select = document.createElement('select');
          select.setAttribute('aria-label', `${mission.title} · ${role.label}`);
          const empty = document.createElement('option'); empty.value = ''; empty.textContent = '장비를 직접 선택'; select.appendChild(empty);
          for (const device of workshop.devices.filter((entry) => role.allowedProfileIds.includes(entry.profileId))) {
            const option = document.createElement('option'); option.value = device.id;
            const profile = DEVICE_PROFILES[device.profileId];
            option.textContent = `${device.id} · ${profile?.model ?? device.profileId}`;
            select.appendChild(option);
          }
          select.value = missionBindings.get(role.id) ?? '';
          select.addEventListener('change', () => {
            if (select.value) missionBindings.set(role.id, select.value); else missionBindings.delete(role.id);
          });
          row.append(roleName, select); body.appendChild(row);
        }

        if (currentMode === 'practice') {
          const hintBox = document.createElement('div'); hintBox.className = 'mission-hints';
          const shown = hintLevelByMission.get(mission.id) ?? -1;
          for (const [index, hint] of mission.hints.entries()) if (index <= shown) {
            const line = document.createElement('div');
            line.className = `mission-hint ${hint.oneStep ? 'mission-answer' : ''}`;
            line.textContent = `${index + 1}. ${hint.text}`; hintBox.appendChild(line);
          }
          const hintButton = document.createElement('button'); hintButton.type = 'button';
          hintButton.textContent = shown < 0 ? '개념 힌트 보기' : shown < mission.hints.length - 1 ? '다음 힌트' : '힌트 모두 확인';
          hintButton.disabled = shown >= mission.hints.length - 1;
          hintButton.addEventListener('click', () => {
            hintLevelByMission.set(mission.id, Math.min(shown + 1, mission.hints.length - 1));
            void renderMissions();
          });
          hintBox.appendChild(hintButton); body.appendChild(hintBox);
        }

        const actions = document.createElement('div'); actions.className = 'mission-v2-actions';
        const evaluate = document.createElement('button'); evaluate.type = 'button'; evaluate.textContent = '이 미션 검증';
        evaluate.addEventListener('click', () => void runCoreValidation());
        actions.appendChild(evaluate); body.appendChild(actions);
        card.appendChild(body);
      }
      panel.appendChild(card);
    }
  };

  const setMode = (mode: WorkshopMode): void => {
    currentMode = mode;
    document.body.dataset.workshopMode = mode;
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    modeBadge.textContent = mode === 'prewire' ? '사전 결선 검토' : '연습 모드';
    modeButton.textContent = mode === 'prewire' ? '검토 모드' : '연습 모드';
    if (badge) badge.textContent = mode === 'prewire'
      ? '핀투핀 사전 검토 · 실제 통전 승인 아님'
      : '교육용 시뮬레이터 · 실제 장비 제어 아님';
    if (selectedMissionId && !missionForSelection()?.eligibleModes.includes(mode)) selectedMissionId = null;
    applyPalettePolicy();
    void renderMissions();
  };

  const openModeSelector = (): void => {
    if (document.getElementById('workshop-mode-selector')) return;
    installModeSelector({ onModeChange: setMode, showOnStart: true });
  };
  modeButton.addEventListener('click', openModeSelector);

  validateButton.onclick = (event) => {
    if (currentMode === 'practice' && !selectedMissionId) legacyValidate?.call(validateButton, event);
    else void runCoreValidation();
  };
  simulateButton.onclick = (event) => {
    if (currentMode === 'practice' && !selectedMissionId) legacySimulate?.call(simulateButton, event);
    else void runCoreSimulation();
  };
  reportButton.onclick = (event) => {
    if (currentMode === 'practice') legacyReport?.call(reportButton, event);
    else void exportFreshReviewReport();
  };
  saveButton.onclick = (event) => {
    void (async () => {
      const workshop = await readDocument();
      saveWorkshopV2(localStorage, workshop);
      bridge.rememberDocumentV2(workshop);
      legacySave?.call(saveButton, event);
      bridge.setStatus(`WorkshopDocument v2 저장 완료 · revision ${workshop.revision} · 구형 원본도 보존`);
    })();
  };
  loadButton.onclick = (event) => {
    selectedMissionId = null;
    resetMissionSessionState(bindingsByMission, hintLevelByMission);
    const result = loadWorkshopV2(localStorage);
    if (result === null) {
      bridge.clearV2Shadow();
      legacyLoad?.call(loadButton, event);
      return;
    }
    if (!result.ok) {
      bridge.setStatus(`${result.status}: ${result.message}`);
      return;
    }
    const loadedMission = missionStateFromDocument(result.document);
    selectedMissionId = loadedMission.missionId;
    if (selectedMissionId) bindingsByMission.set(selectedMissionId, loadedMission.bindings);
    bridge.applyDocumentV2(result.document);
    setMode(result.document.mode);
    bridge.setStatus(`WorkshopDocument v2 복원 완료 · revision ${result.document.revision}`);
  };

  (window as unknown as { WorkshopV2Controller: { renderMissions(): void } }).WorkshopV2Controller = {
    renderMissions: () => { void renderMissions(); },
  };

  setMode(currentMode);
  openModeSelector();
  void migrateLegacyLocalStorage(
    localStorage,
    LEGACY_STORAGE_KEY,
    WORKSHOP_V2_STORAGE_KEY,
    { knownLegacyTypes: new Set(Object.keys(LEGACY_PROFILE_MAP)) },
  ).then((result) => {
    if (result?.ok && result.migrated) bridge.setStatus('기존 저장본을 WorkshopDocument v2로 복사했습니다. 구형 원본은 유지됩니다.');
    if (result && !result.ok) bridge.setStatus(`BLOCKED: ${result.issues[0]?.message ?? '기존 저장본 변환 실패'}`);
  });
}
