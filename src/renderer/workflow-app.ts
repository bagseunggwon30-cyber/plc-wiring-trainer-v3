import { DEVICE_PROFILES } from '../catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../catalog/v3-profiles';
import { XGSIM_CLOSED_LOOP_MANIFEST } from '../catalog/xgsim-project-manifest';
import { createAcademyExp2Md02Template } from '../domain/academy-panel-template';
import type { EquipmentOrderCatalogItem } from '../domain/equipment-order';
import type { ValidationIssue, ValidationResult } from '../domain/engine-types';
import { analyzeSerialDeviceStates } from '../domain/communication-runtime';
import { evaluateMission, type MissionEvaluationResult } from '../domain/mission-evaluator';
import { sha256, migrateLegacyLocalStorage } from '../domain/migration';
import { PUBLIC_MISSIONS, type MissionDefinitionV2, type RoleBinding } from '../domain/missions';
import { generateReviewReport, type ReviewReport } from '../domain/report';
import {
  assessTerminalCompatibility,
  terminalConductorVisual,
  wireConductorVisual,
} from '../domain/terminal-semantics';
import { fieldWireConductorVisual } from '../domain/field-wiring-policy';
import { effectiveTerminalSpecFromSettings } from '../domain/terminal-configuration';
import {
  createVirtualMultimeter,
  loadWorkshopDocumentV3,
  migrateWorkshopDocumentV3,
  restoreWorkshopDocumentV2FromV3,
  saveWorkshopDocumentV3,
  WORKSHOP_V3_STORAGE_KEY,
  type CircuitSolution,
  type PrewireTerminalGeometryInputV3,
  type ScenarioSimulationV3,
  suggestWiringPlans,
  type TerminalReferenceV3,
  type WiringGuideStepV3,
} from '../domain/v3';
import type { TerminalSpec, WorkshopDocumentV2, WorkshopMode } from '../domain/types';
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
import { createV3WorkflowPanel } from './v3/workflow-panel';
import { createDomainV3ValidationPort } from './v3/domain-validation-port';
import { createV3ValidationPort } from './v3/validation-port';
import {
  bomCsv,
  cableCoreScheduleCsv,
  htmlReport,
  jsonReport,
  pinToPinCsv,
  terminalPlanCsv,
  type V3ExportReport,
} from './v3/report-export';
import {
  applyV3WorkflowState,
  createV3WorkflowState,
  type V3ReportClassification,
  type V3WorkflowState,
  workflowStateFromDocument,
} from './v3/workflow-state';
import { createWiringAssistantPanel } from './v3/wiring-assistant-panel';
import { createXgSimDiagnosticsPanel } from './plc-runtime/xgsim-diagnostics-panel';
import { createXgSimFunctionTestPanel } from './plc-runtime/xgsim-function-test-panel';
import { installEquipmentOrderPanel, type EquipmentOrderPanelController } from './equipment-order-panel';

interface LegacyTrainerBridge {
  applyTerminalSemantics(
    semanticsByLegacyType: Readonly<Record<string, Readonly<Record<string, TerminalSpec>>>>,
    assessor: typeof assessTerminalCompatibility,
    terminalVisual: typeof terminalConductorVisual,
    wireVisual: typeof wireConductorVisual,
    contextualTerminal: (
      legacyType: string,
      terminal: TerminalSpec,
      instanceConfiguration: Readonly<Record<string, unknown>>,
      workflowDeviceSettings: Readonly<Record<string, unknown>>,
    ) => TerminalSpec,
  ): void;
  readState(): LegacyTrainerState;
  readEquipmentCatalog(): EquipmentOrderCatalogItem[];
  createPanelLayoutV2(rows: number): Readonly<Record<string, unknown>>;
  readTerminalGeometryV3(): PrewireTerminalGeometryInputV3;
  readV2Shadow(): WorkshopShadowSnapshot | null;
  clearV2Shadow(): void;
  rememberDocumentV2(document: WorkshopDocumentV2): void;
  applyDocumentV2(document: WorkshopDocumentV2): void;
  updateWorkflowState(state: V3WorkflowState): number;
  setWorkflowStateBaseline(state: V3WorkflowState): void;
  undo(): void;
  redo(): void;
  setStatus(message: string): void;
  readSelection(): { deviceIds: string[] };
  clearDeviceSelection(): void;
  previewSuggestedWire(
    from: TerminalReferenceV3,
    to: TerminalReferenceV3,
  ): { ok: boolean; code: string; reason: string };
  focusRefs(refs: string[]): void;
  showWiringFlowV3(steps: readonly WiringGuideStepV3[]): void;
  clearWiringFlowV3(): void;
  traceCircuitV3(forwardRefs: string[], returnRefs: string[], peRefs: string[]): void;
  downloadJson(value: unknown, filename: string): void;
  downloadText(value: string, filename: string, mimeType?: string): void;
}

interface CoreRun {
  document: WorkshopDocumentV2;
  validation: ValidationResult;
  evaluation?: MissionEvaluationResult;
  classification: V3ReportClassification;
  circuitSolution?: CircuitSolution;
  scenarioSimulations?: readonly ScenarioSimulationV3[];
}

const LEGACY_STORAGE_KEY = 'wiring-workshop-v2';
const EQUIPMENT_ORDER_BACKUP_KEY = 'plc-wiring-trainer:before-equipment-order';
const XGSIM_FUNCTION_TEST_BACKUP_KEY = 'plc-wiring-trainer:before-xgsim-function-test';

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
  .mission-work-sequence{margin:8px 0;padding:7px 7px 7px 28px;border:1px solid #3d4f63;border-radius:5px;background:#121b25}.mission-work-sequence li{margin:5px 0;color:#dce8f5;font-size:10px}.mission-work-sequence label{display:flex;gap:6px;align-items:flex-start}.mission-work-sequence b{color:#8fc7ff;margin-right:4px}
  .core-validation-status{font-weight:800;margin-bottom:6px}.core-validation-status.pass{color:#8fda9a}.core-validation-status.fail{color:#ff9b8f}.core-validation-status.blocked{color:#ffd178}.core-validation-status.stale{color:#ffbd66}
  .core-issue{display:block;width:100%;text-align:left;margin:5px 0;padding:7px;border:1px solid #663f3f;border-radius:5px;background:#321f22;color:#f7d8d8;cursor:pointer}.core-issue.blocked{border-color:#735f2d;background:#342d1b;color:#ffe7a8}.core-issue small{display:block;color:#bdb7b7;margin-top:3px;line-height:1.35}
  .v3-workflow-panel{margin:0 0 10px;padding:9px;border:1px solid #46617d;border-radius:7px;background:#152230}.v3-workflow-panel h3{margin:0 0 4px;font-size:12px;color:#b6ddff}.v3-workflow-help{margin:0 0 8px;color:#b9c9d8;font-size:10px;line-height:1.35}.v3-workflow-field{display:grid;gap:3px;margin:6px 0;color:#dcecff;font-size:10px}.v3-workflow-field select,.v3-workflow-field input,.v3-workflow-device input,.v3-conductor-row input,.v3-xbf-channel select{min-width:0;border:1px solid #52637a;border-radius:4px;background:#101923;color:#eef4ff;padding:4px}.v3-workflow-scope{margin:8px 0 0;border:1px solid #41576d;border-radius:5px;overflow-x:auto}.v3-workflow-scope legend{font-size:10px;color:#b6ddff}.v3-workflow-device{display:grid;grid-template-columns:minmax(0,1fr) 100px 112px;gap:6px;align-items:center;margin:5px 0;font-size:10px}.v3-workflow-device label{display:flex;gap:5px;align-items:center;min-width:0}.v3-workflow-device span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v3-xbf-settings{margin:4px 0 8px;border:1px dashed #52637a}.v3-xbf-channel{display:grid;grid-template-columns:70px 1fr 1fr;gap:5px;margin:4px 0}.v3-conductor-row{display:grid;grid-template-columns:minmax(150px,1fr) repeat(12,minmax(70px,.7fr));gap:4px;align-items:center;margin:5px 0;min-width:1120px;font-size:9px}.v3-conductor-row label{display:flex;gap:3px;align-items:center}
  .xgsim-diagnostics{flex:1 1 760px;padding:9px;border:1px solid #3f6f63;border-radius:7px;background:#10231f;color:#d8eee8}.xgsim-diagnostics h3{margin:0 0 4px;color:#a9ead7;font-size:12px}.xgsim-diagnostics p{margin:0 0 7px;color:#b7cdc6;font-size:10px}.xgsim-diagnostics-grid{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:5px}.xgsim-diagnostics-grid label{display:grid;gap:2px;font-size:9px}.xgsim-diagnostics-grid input{min-width:0;border:1px solid #4f746a;border-radius:4px;background:#0b1715;color:#effffb;padding:4px}.xgsim-diagnostics-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}.xgsim-diagnostics-status{display:block;margin-top:6px;padding:5px;border-radius:4px;background:#07110f;font:10px/1.45 monospace;color:#bff7e7}
  .xgsim-function-test{flex:1 1 920px;padding:10px;border:1px solid #51739b;border-radius:7px;background:#101d2b;color:#e4f1ff}.xgsim-function-test h3{margin:0 0 4px;color:#a9d7ff;font-size:12px}.xgsim-function-test p{margin:0 0 7px;color:#b8c9da;font-size:10px;line-height:1.4}.xgsim-function-project,.xgsim-function-status,.xgsim-function-path{display:block;margin:6px 0;padding:5px;border-radius:4px;background:#08111b;color:#cce7ff;font:10px/1.45 ui-monospace,monospace;overflow-wrap:anywhere}.xgsim-function-confirm{display:flex;gap:6px;align-items:flex-start;font-size:10px;color:#e7f2ff}.xgsim-function-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}.xgsim-function-actions button{border:1px solid #52769c;border-radius:4px;background:#17314b;color:#eef7ff;padding:5px 8px;font-size:9px;cursor:pointer}.xgsim-function-actions button:disabled{opacity:.45;cursor:not-allowed}.xgsim-function-live{display:grid;grid-template-columns:repeat(7,minmax(92px,1fr));gap:5px;margin-top:7px}.xgsim-function-live div{display:grid;gap:2px;padding:5px;border:1px solid #334d68;border-radius:4px;background:#0b1622;font-size:9px}.xgsim-function-live output{color:#fff;font-weight:800}.xgsim-function-steps{max-height:180px;overflow:auto;margin:6px 0 0;padding-left:24px;font:9px/1.4 ui-monospace,monospace}.xgsim-function-steps li.pass{color:#91e0a0}.xgsim-function-steps li.fail{color:#ff9f96}
  .v3-test-tools{margin-top:7px;padding:7px;border:1px solid #41576d;border-radius:5px;background:#111c27}.v3-test-tools h3{margin:0 0 5px;color:#b6ddff;font-size:11px}.v3-test-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.v3-test-grid select,.v3-test-grid button{min-width:0;border:1px solid #52637a;border-radius:4px;background:#101923;color:#eef4ff;padding:5px;font-size:9px}.v3-test-result{display:block;margin-top:6px;min-height:1.4em;color:#ffe29a;font:10px ui-monospace,monospace}.v3-trace-legend{margin-top:4px;color:#b9c9d8;font-size:9px}.v3-trace-legend b:nth-child(1){color:#ef4444}.v3-trace-legend b:nth-child(2){color:#60a5fa}.v3-trace-legend b:nth-child(3){color:#a3e635}
  .v3-wiring-assistant{margin:0;padding:9px;border-bottom:1px solid #3b5066;background:#152230}.v3-wiring-assistant h3{margin:0 0 4px;color:#b6ddff;font-size:12px}.v3-wiring-help{margin:0 0 7px;color:#b9c9d8;font-size:10px;line-height:1.4}.v3-wiring-selection{display:block;margin:5px 0;color:#e6f2ff;font-size:10px}.v3-wiring-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px}.v3-wiring-controls button:last-child{grid-column:1/-1}.v3-wiring-controls select,.v3-wiring-controls button,.v3-wiring-actions button{min-width:0;border:1px solid #52637a;border-radius:4px;background:#101923;color:#eef4ff;padding:5px;font-size:9px}.v3-wiring-controls button.primary,.v3-wiring-actions button.primary{background:#23583b;border-color:#438a59}.v3-wiring-results{max-height:300px;overflow:auto;margin-top:7px}.v3-wiring-empty,.v3-wiring-stale{margin:5px 0;color:#9fb2c4;font-size:10px}.v3-wiring-stale{color:#ffbd66}.v3-wiring-plan{margin:6px 0;padding:7px;border:1px solid #425469;border-left:3px solid #4f91c9;border-radius:5px;background:#111b26;font-size:9px}.v3-wiring-plan.blocked{border-left-color:#d15b5b}.v3-wiring-plan.requires_prerequisite{border-left-color:#d49a43}.v3-wiring-plan-title{display:flex;gap:5px;margin-bottom:5px}.v3-wiring-badge,.v3-wiring-grade{padding:1px 5px;border-radius:8px;background:#264f6c;color:#d9efff;font-weight:700}.v3-wiring-grade.educational{background:#5b4520;color:#ffe2a1}.v3-wiring-grade.manual-verified,.v3-wiring-grade.bench-verified{background:#245a3a;color:#bdf4ca}.v3-wiring-path{display:block;color:#f1f7ff}.v3-wiring-plan p{margin:4px 0;color:#c6d4e1;line-height:1.35}.v3-wiring-plan ul{margin:4px 0;padding-left:17px;color:#ffd998}.v3-wiring-plan details{margin-top:5px;color:#9fc3e3}.v3-wiring-plan details li{overflow-wrap:anywhere;color:#aebdca}.v3-wiring-actions{display:flex;gap:5px;margin-top:6px}.v3-wiring-actions button{flex:1}.v3-wiring-controls button:disabled,.v3-wiring-actions button:disabled{opacity:.45;cursor:not-allowed}
  .v3-wiring-flow{margin:7px 0;padding:7px;border:1px solid #516477;border-radius:5px;background:#0d1721}.v3-wiring-flow[hidden]{display:none}.v3-wiring-flow-title{display:block;margin-bottom:5px;color:#e7f3ff;font-size:10px}.v3-wiring-flow-step{display:grid;grid-template-columns:84px minmax(0,1fr);gap:5px;margin:3px 0;font-size:9px}.v3-wiring-flow-step b{white-space:nowrap}.v3-wiring-flow-step.source b{color:#f87171}.v3-wiring-flow-step.signal b,.v3-wiring-flow-step.differential-pair b{color:#fb923c}.v3-wiring-flow-step.return b{color:#60a5fa}.v3-wiring-flow-step.pe b{color:#a3e635}.v3-wiring-flow-internal{margin:4px 0;color:#fed7aa;font-size:9px}
  .v3-workflow-field select,.v3-workflow-field input{width:100%;box-sizing:border-box}@media(max-width:1600px){.v3-workflow-device{grid-template-columns:1fr}.v3-workflow-device input{width:100%;box-sizing:border-box}.v3-xbf-channel{grid-template-columns:58px minmax(70px,1fr) minmax(90px,1fr)}}
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
    ANALOG_SIGNAL_SHORT: '아날로그 신호 +와 G/귀로를 직접 연결한 선이나 점퍼를 제거하세요.',
    ANALOG_POLARITY_REVERSED: '아날로그 신호원의 +와 G/귀로를 수신 채널의 같은 표시에 맞춰 다시 연결하세요.',
    ANALOG_DIRECTION_MISMATCH: '신호원 출력과 수신기 입력을 한 쌍으로 연결하고 출력끼리 또는 입력끼리 연결하지 마세요.',
    ANALOG_SOURCE_PATH_OPEN: '아날로그 신호 + 경로의 끊긴 단자·심선을 연결하세요.',
    ANALOG_RETURN_PATH_OPEN: '같은 아날로그 채널의 G/귀로 심선을 끝까지 연결하세요.',
    TRANSISTOR_OUTPUT_UNPOWERED: '센서 BN을 +24V, BU를 0V에 연결한 뒤 BK 출력과 PLC 입력 COM 방향을 다시 시험하세요.',
    CURRENT_LOOP_SOURCE_PATH_OPEN: '같은 DC 전원의 +24V에서 2선식 송신기 TX+까지 전원 경로를 연결하세요.',
    CURRENT_LOOP_SIGNAL_PATH_OPEN: '송신기 TX−를 XBF 전류 입력 I+에 직렬로 연결하세요.',
    CURRENT_LOOP_RETURN_PATH_OPEN: 'XBF 전류 입력 I−를 송신기에 사용한 같은 전원의 0V까지 연결하세요.',
    CURRENT_LOOP_POLARITY_REVERSED: '2선식 루프를 +24V→TX+→TX−→I+→I−→0V 순서로 다시 결선하세요.',
    CURRENT_LOOP_RECEIVER_UNPOWERED: 'XBF 외부전원 +24V/0V를 같은 전원쌍으로 먼저 완성하세요.',
    CURRENT_LOOP_COMPLIANCE_INSUFFICIENT: '송신기 최소 동작전압과 XBF 250Ω 입력부담을 합산해 충분한 루프 전압을 확보하세요.',
    CURRENT_LOOP_OVER_RANGE: '시험 전류를 XBF 허용 입력 범위(최대 25mA) 안으로 낮추세요.',
    RS485_POLARITY_MISMATCH: 'A(+)는 A(+), B(-)는 B(-)끼리 다시 연결하세요.',
    RS485_POLARITY_REVERSED: 'RS485의 +/− 또는 A/B 심선을 같은 극성끼리 다시 연결하세요.',
    RS485_BRIDGE_MISSING: 'XBL-C41A 2선식에서는 TX+↔RX+, TX−↔RX− 점퍼를 모두 결선하세요.',
    RS485_PEER_MISSING: '통신 상대까지 +/− 두 심선을 모두 연결하세요.',
    RS485_SETTINGS_MISMATCH: '양쪽 장비의 프로토콜, 속도, 데이터 비트, 패리티와 정지 비트를 일치시키세요.',
    RS485_ADDRESS_REQUIRED: 'Modbus RTU 슬레이브 국번을 1~247 범위에서 지정하세요.',
    RS485_ADDRESS_DUPLICATE: '같은 버스의 Modbus RTU 슬레이브 국번을 서로 다르게 지정하세요.',
    RS485_MULTIPLE_MASTERS: '하나의 Modbus RTU 버스에는 마스터를 한 대만 두세요.',
    RS485_TERMINATION_REQUIRED: '각 통신 장비에서 종단저항 적용 여부를 실제 배선 상태대로 기록하세요.',
    RS485_TERMINATION_INVALID: '버스 양 끝 두 지점에만 종단저항을 적용하세요.',
    RS485_MODE_UNSUPPORTED: '현재는 2선식 RS485만 사전 검토할 수 있습니다. 4선식은 지원 전까지 차단됩니다.',
    RACK_HOST_NOT_FOUND: '확장 모듈이 연결된 XGB 기본 유닛과 동일 DIN 레일을 확인해 지정하세요.',
    RACK_SLOT_REQUIRED: '검토 모드에서는 확장 모듈의 실제 XGB 기본 유닛과 슬롯 번호를 지정하세요.',
    RACK_SLOT_DUPLICATE: '같은 XGB 기본 유닛에서 중복된 슬롯 번호를 각각 다르게 지정하세요.',
    RACK_SLOT_OUT_OF_RANGE: '확장 슬롯 번호를 기본 유닛이 허용하는 1~10 범위로 수정하세요.',
    RACK_FAMILY_MISMATCH: '확장 모듈을 호환되는 LS XGB 기본 유닛에 연결하세요.',
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
    SOURCE_SYSTEM_REQUIRED: '검토 대상의 공급 SourceSystem을 명시적으로 선택하세요.',
    EARTHING_POLICY_REQUIRED: 'PE와 0V의 결합 또는 분리 정책을 명시적으로 선택하세요.',
    REVIEW_TEMPLATE_REQUIRED: '검토에 적용할 ReviewScope 템플릿을 선택하세요.',
    REVIEW_SCOPE_REQUIRED: '검토할 장비를 한 대 이상 ReviewScope에 포함하세요.',
    OPEN_SOURCE_PATH: '+24V/L 측 경로에서 끊긴 단자나 열린 접점을 찾아 연결하세요.',
    OPEN_RETURN_PATH: '부하의 0V/N 귀로를 같은 전원쌍으로 완성하세요.',
    LOAD_REVERSED: '부하 +/− 극성을 바로잡으세요.',
    LOAD_INACTIVE: '양단 전압을 확인하고 장비의 픽업·동작 임계값 이상이 되도록 같은 정격 전원쌍에 연결하세요.',
    INPUT_CURRENT_BELOW_THRESHOLD: 'PLC 입력의 COM 방식, 입력저항, 양단 전압을 확인해 매뉴얼의 ON 전압·전류 이상으로 결선하세요.',
    INPUT_SOURCE_MISMATCH: '입력에 허용된 전원쌍을 사용하세요. iG5A S8=PNP는 단자 24가 아니라 외부 +24V/0V 전원쌍을 사용합니다.',
    SOURCE_CONDITION_UNMET: '전원변환기의 입력 L/N과 보호접지를 먼저 정상 공급하세요.',
    PE_MISSING: '장비 PE/FG를 공급계통의 PE에 연결하세요.',
    ORDER_CODE_REQUIRED: '장비 명판의 전체 주문코드를 설정에 기록하세요.',
    ORDER_CODE_MISMATCH: '프로필과 실제 장비 주문코드를 일치시키세요.',
    PROFILE_NOT_V3: '정확한 v3 검증 프로필이 있는 장비로 교체하거나 연습 모드에서 사용하세요.',
    PROFILE_EVIDENCE_INELIGIBLE: '매뉴얼 검증 또는 벤치 검증 근거가 있는 프로필을 사용하세요.',
    PROFILE_REVIEW_CAPABILITY_INCOMPLETE: '공식 단자 프로필은 등록됐지만 동작 모델과 화면 단자 좌표 승인이 끝나지 않았습니다. 연습 모드에서 사용하고 검토 통과는 보류하세요.',
    ASSET_GEOMETRY_UNAPPROVED: '기존 이미지는 유지하되 단자 geometry 검수를 완료하기 전에는 진단 리포트만 사용하세요.',
    TERMINAL_GEOMETRY_MISMATCH: '화면 단자 ID·표시 여부와 검증 프로필을 1:1로 맞춘 뒤 geometry 승인을 다시 받으세요.',
    XBF_CONFIGURATION_INCOMPLETE: 'AI0/AI1/AO0/AO1의 사용 여부, V/I 스위치와 범위를 모두 설정하세요.',
    XBF_SELECTOR_RANGE_MISMATCH: 'XBF 물리 V/I 스위치와 파라미터 범위를 일치시키세요.',
    EOCR_CONFIGURATION_INCOMPLETE: 'EOCR 장비를 우클릭해 fail-safe 또는 non-fail-safe를 명시적으로 선택하세요.',
    FUSE_LINK_REQUIRED: '퓨즈 단자대를 우클릭해 실제 장착할 5×20 퓨즈 링크의 정확 품번을 입력하세요.',
    FUSE_LINK_PROFILE_UNVERIFIED: '입력한 퓨즈 링크의 정확 프로필(정격·차단용량·특성·공식 매뉴얼 해시)을 장비 카탈로그에 등록하세요.',
    NO_INSTALLED_EQUIPMENT: '경계 노드 외 실제 설치 장비를 검토 범위에 포함하세요.',
    DESIGNATION_REQUIRED: '장비에 QF1, PS1, PLC1, XT1 같은 고유 표기를 입력하세요.',
    CONDUCTOR_IDENTIFICATION_REQUIRED: '각 전선/심선에 중복되지 않는 선번을 입력하세요.',
    CONDUCTOR_SIZE_REQUIRED: '각 도체에 mm² 또는 AWG 규격을 입력하세요.',
    TERMINAL_ASSEMBLY_DATA_INCOMPLETE: '단자대 품번, 종류, 허용 도체 수와 액세서리를 입력하세요.',
    TERMINAL_NOT_CONNECTED: 'NC(미사용) 단자에 연결된 와이어를 제거하고 제조사 단자표의 실제 단자를 사용하세요.',
    TERMINAL_DOMAIN_MISMATCH: '표시된 전원·신호·통신·PE 단자의 회로 영역을 맞춰 다시 결선하세요.',
    TERMINAL_POLARITY_MISMATCH: '표시된 L/N, +/0V, 아날로그 +/G 또는 RS485 A/B 극성을 맞춰 다시 결선하세요.',
    AC_LINE_NEUTRAL_MISMATCH: 'AC L/상선과 N/중성선을 분리하고 각 장비의 L·N 대응 단자로 다시 결선하세요.',
    AC_PHASE_MISMATCH: 'L1/L2/L3 또는 U/V/W 상 대응을 유지하도록 표시된 도체를 다시 결선하세요.',
    AC_MAINS_DRIVE_OUTPUT_CONFLICT: '인버터 입력 R/S/T와 모터 출력 U/V/W를 분리하고 출력은 모터 측에만 연결하세요.',
    DC_POLARITY_MISMATCH: '+24V와 0V·24G·CM·MG를 분리하고 같은 전원쌍의 올바른 극성으로 다시 결선하세요.',
    PE_TERMINAL_MISUSE: 'PE를 운전 귀로·COM·G·SG에서 분리하고 승인된 PE 단자와 보호도체에만 연결하세요.',
    COMMON_ROLE_MISMATCH: '입력 COM, 릴레이 COM, CM, MG, 아날로그 G의 역할을 매뉴얼에서 확인해 해당 회로 공통으로 다시 연결하세요.',
    ANALOG_REFERENCE_MISMATCH: '아날로그 채널의 +와 G/−를 같은 채널 쌍과 설정 범위에 맞춰 다시 결선하세요.',
    COMMUNICATION_REFERENCE_MISMATCH: '통신 SG를 A/B 또는 TX/RX, PE, 아날로그 G와 분리하고 상대 SG에만 연결하세요.',
    COMMUNICATION_POLARITY_MISMATCH: 'RS485 A/B 극성 또는 RS232 TX/RX 교차 방향을 바로잡으세요.',
    TERMINAL_PROTOCOL_MISMATCH: 'RS232/RS485 또는 아날로그 V/I 형식이 같은 단자끼리 연결되도록 장비 설정과 결선을 맞추세요.',
    INPUT_LOGIC_MODE_REQUIRED: '장비 전면의 실제 NPN/PNP 선택 스위치 위치를 장비 설정에 기록하세요.',
    INPUT_LOGIC_POLARITY_MISMATCH: '선택된 NPN/PNP 방식에 맞게 P 입력의 동작 전위와 CM 귀로를 다시 결선하세요.',
    IG5A_INPUT_LOGIC_REQUIRED: 'iG5A 전면 S8의 실제 NPN/PNP 위치를 장비 설정에서 선택하세요.',
    IG5A_CONTROL_POWER_STATE_REQUIRED: 'iG5A P입력 시험 전에 실제 제어전원 상태를 POWERED 또는 UNPOWERED로 기록하세요.',
    SIGNAL_DIRECTION_MISMATCH: '입력끼리 연결한 선을 제거하고 센서·출력·시험 신호원을 입력에 연결하세요.',
    TERMINAL_SOURCE_CONFLICT: '두 전원·신호 출력의 직접 병렬선을 제거하고 부하·입력·분배 단자를 통해 각각 연결하세요.',
    TERMINAL_PROFILE_UNRESOLVED: '화면 단자 ID와 장비 프로필을 1:1로 동기화한 뒤 해당 단자의 전기 역할을 다시 확인하세요.',
    AMBIGUOUS_TERMINAL_ROLE: 'COM·G·V 계열 단자의 정확한 제품 기능과 전위를 공식 매뉴얼 프로필에 등록하세요.',
    DEVICE_PROFILE_UNVERIFIED: '장비 명판의 정확 품번과 제조사 공식 단자 매뉴얼을 확보한 뒤 프로필을 등록하세요.',
    V3_WORKER_ERROR: '검증 Worker 오류를 확인하고 문서를 다시 검증하세요. 이 상태에서는 통과 리포트를 발급할 수 없습니다.',
    PHYSICAL_SCALE_REQUIRED: '고급 도구의 v3 검토 조건에서 실제 자 또는 도면 치수로 캔버스 단위/mm 환산값을 입력하세요.',
    PHYSICAL_PART_NUMBER_REQUIRED: '설치 장비·레일·덕트의 정확한 품번을 입력하세요.',
    PHYSICAL_DIMENSIONS_REQUIRED: '매뉴얼 근거가 있는 실제 폭·높이·깊이(mm)와 설치 방향을 입력하세요.',
    PHYSICAL_DESIGNATION_REQUIRED: '설치 장비에 고유한 QF1·PS1·PLC1·XT1 표기를 입력하세요.',
    PHYSICAL_DESIGNATION_DUPLICATE: '중복된 장비 표기를 고유하게 수정하세요.',
    PHYSICAL_CLEARANCE_LIMIT_REQUIRED: '회사 규칙 또는 매뉴얼의 이격거리 값과 근거 품번을 입력하세요.',
    PHYSICAL_CLEARANCE_VIOLATION: '표시된 두 장비 사이를 공식 최소 이격거리 이상으로 이동하세요.',
    DIN_RAIL_DATA_REQUIRED: 'DIN 레일 품번·방향·실제 길이와 폭(mm)을 입력하세요.',
    DIN_RAIL_CONTAINMENT_VIOLATION: '장비 전체 폭이 DIN 레일 유효 길이 안에 들어오도록 배치하세요.',
    DIN_RAIL_ORIENTATION_VIOLATION: '장비 설치 방향을 DIN 레일 방향과 일치시키세요.',
    DUCT_CAPACITY_DATA_REQUIRED: '덕트 품번과 공식 허용 수용량을 입력하세요.',
    DUCT_CAPACITY_EXCEEDED: '덕트 내 도체를 분산하거나 공식 용량이 큰 덕트로 변경하세요.',
    CONDUCTOR_METADATA_INCOMPLETE: '케이블·심선·선번·규격·길이·페룰/러그 정보를 완성하세요.',
    CONDUCTOR_IDENTIFIER_DUPLICATE: '중복된 선번 또는 케이블 심선 번호를 수정하세요.',
    TERMINAL_CAPACITY_REQUIRED: '정확한 단자 품번과 단자당 허용 도체 수를 입력하세요.',
    TERMINAL_CAPACITY_EXCEEDED: '한 단자에 연결된 도체 수를 줄이거나 분배 단자를 사용하세요.',
    ROUTE_SEPARATION_LIMIT_REQUIRED: '전력선과 아날로그·통신선 분리 거리의 회사/매뉴얼 기준을 입력하세요.',
    ROUTE_SEPARATION_VIOLATION: '전력선과 민감 신호선의 경로를 분리하거나 공식 간격을 확보하세요.',
    SHIELD_TERMINATION_REQUIRED: '실드·드레인의 종단 위치를 명시하고 회사 접지 규칙과 일치시키세요.',
    SOURCE_CAPACITY_BLOCKED: 'XBC 내부 24V 0.4A에 연결된 입력·릴레이 코일·램프 전류를 확인하고 정격 안으로 줄이세요.',
    PROJECT_IDENTITY_UNVERIFIED: '선택한 XG5000 프로젝트 해시를 확인하고, 열린 프로젝트 신원은 사용자 선언과 진단 근거로만 기록하세요.',
    PROJECT_FILE_HASH_MISMATCH: '검사된 4층_GEMINI.xgwx를 다시 선택하고 매니페스트 SHA-256과 일치하는지 확인하세요.',
    PROJECT_LOAD_DECLARATION_REQUIRED: '선택한 프로젝트를 XG5000에서 열고 XG-SIM을 시작했음을 확인한 뒤 다시 사전 점검하세요.',
    PROGRAM_CHECK_REQUIRED: '정확한 4층_GEMINI.xgwx에서 XG5000 Program Check를 실행하고 오류·경고 결과와 저장 파일 해시를 기록하세요.',
    PLC_OUTPUT_NOT_STABLE: 'XG-SIM 연결과 M00100 운전상태를 확인하고 500ms 안에 동일 값이 두 번 연속 관찰되는지 다시 시험하세요.',
    PLC_OUTPUT_LOAD_INACTIVE: 'M00100 상태, P21 가상접점의 COM0 공급, P21-릴레이 14번 선, 코일 13번-24G 귀로를 순서대로 확인하세요.',
    RUNTIME_FRAME_IN_FLIGHT: '진행 중인 XG-SIM 프레임이 끝날 때까지 기다린 뒤 기능시험을 다시 시작하세요.',
    VALIDATION_STALE: '문서가 검증 이후 변경됐습니다. 최신 상태로 다시 검증하세요.',
  });

export function issueAction(code: string): string {
  return ISSUE_ACTIONS[code] ?? '관련 단자와 와이어를 확인한 뒤 문서를 다시 검증하세요.';
}

export function workshopHasEditableContent(document: WorkshopDocumentV2): boolean {
  return document.devices.length > 0 || document.wires.length > 0 || document.jumpers.length > 0;
}

function terminalText(terminal: {
  deviceId: string;
  terminalLabel: string | null;
  terminalMarker?: string | null;
  connectionPoint?: 'A' | 'B' | null;
  terminalId: string;
}): string {
  const marker = terminal.terminalMarker ?? terminal.terminalLabel ?? terminal.terminalId;
  return `${terminal.deviceId}:${marker}${terminal.connectionPoint ? `(${terminal.connectionPoint})` : ''}`;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Maps the v2 snapshot into the deliberately small v3 export contract. */
function createV3ExportReport(run: CoreRun, report: ReviewReport): V3ExportReport {
  const workflow = objectRecord(run.document.settings.v3Workflow);
  const conductorSettings = objectRecord(workflow.conductorSettings);
  const deviceWorkflowSettings = objectRecord(workflow.deviceSettings);
  const designations = objectRecord(workflow.designations);
  const terminalFor = (ref: { deviceId: string; terminalId: string }): TerminalSpec | undefined => {
    const instance = run.document.devices.find((device) => device.id === ref.deviceId);
    const profile = instance ? DEVICE_PROFILES[instance.profileId] : undefined;
    const declared = profile?.terminals.find((terminal) => terminal.id === ref.terminalId);
    if (!instance || !profile || !declared) return undefined;
    return effectiveTerminalSpecFromSettings(
      profile.profileId,
      declared,
      instance.configuration,
      objectRecord(deviceWorkflowSettings[instance.id]),
    );
  };
  const pinToPin = report.pinToPin.map((row) => {
    const setting = objectRecord(conductorSettings[row.connectionId]);
    const gauge = typeof setting.gauge === 'string' ? setting.gauge : row.gauge ?? '';
    const metric = gauge.match(/([0-9]+(?:\.[0-9]+)?)\s*mm(?:²|2)?/i);
    const awg = gauge.match(/(?:AWG\s*)?([0-9]{1,2})\s*AWG|AWG\s*([0-9]{1,2})/i);
    const fromTerminal = terminalFor(row.from);
    const toTerminal = terminalFor(row.to);
    return {
      from: terminalText(row.from),
      fromRole: fromTerminal ? terminalConductorVisual(fromTerminal).label : '프로필 역할 미확정',
      to: terminalText(row.to),
      toRole: toTerminal ? terminalConductorVisual(toTerminal).label : '프로필 역할 미확정',
      conductorRole: fromTerminal && toTerminal
        ? wireConductorVisual(fromTerminal, toTerminal).label
        : '프로필 역할 미확정',
      cableId: row.connectionId,
      conductorId: row.connectionId,
      wireNumber: typeof setting.wireNumber === 'string' ? setting.wireNumber : row.tag ?? row.connectionId,
      core: String(row.segment),
      color: typeof setting.color === 'string' ? setting.color : row.color ?? '',
      gauge,
      crossSectionMm2: metric ? Number(metric[1]) : undefined,
      awg: awg ? awg[1] ?? awg[2] : undefined,
      lengthMm: typeof setting.lengthMm === 'number' ? setting.lengthMm : undefined,
      shielded: setting.shielded === true,
      drain: setting.drain === true,
      ferruleFrom: typeof setting.ferruleFrom === 'string' ? setting.ferruleFrom : null,
      ferruleTo: typeof setting.ferruleTo === 'string' ? setting.ferruleTo : null,
      lugFrom: typeof setting.lugFrom === 'string' ? setting.lugFrom : null,
      lugTo: typeof setting.lugTo === 'string' ? setting.lugTo : null,
    };
  });
  const cables = pinToPin.map((row) => ({
    cableId: row.cableId ?? '',
    from: row.from,
    to: row.to,
    cores: 1,
    lengthMm: row.lengthMm,
    shielded: row.shielded,
    conductorIds: row.conductorId ? [row.conductorId] : [],
    description: [row.wireNumber, row.color, row.gauge].filter(Boolean).join(' · ') || undefined,
  }));
  const terminals = [...new Map(pinToPin.flatMap((row) => [
    [row.from, {
      designation: row.from.split(':')[0],
      terminal: row.from.slice(row.from.indexOf(':') + 1),
      signal: row.conductorRole ?? '',
      destination: row.to,
      terminalType: row.fromRole ?? null,
    }],
    [row.to, {
      designation: row.to.split(':')[0],
      terminal: row.to.slice(row.to.indexOf(':') + 1),
      signal: row.conductorRole ?? '',
      destination: row.from,
      terminalType: row.toRole ?? null,
    }],
  ])).values()];
  const solutionRuns = run.scenarioSimulations?.length
    ? run.scenarioSimulations.map((scenario) => ({ scenarioId: scenario.scenarioId, solution: scenario.solution }))
    : run.circuitSolution ? [{ scenarioId: 'base', solution: run.circuitSolution }] : [];
  const closedLoopPaths = solutionRuns.flatMap(({ scenarioId, solution }) => [
    ...Object.entries(solution.elements)
      .filter(([, element]) =>
        element.kind === 'load'
        || element.kind === 'ac-load'
        || element.kind === 'three-phase-load'
        || element.kind === 'analog-port'
        || element.kind === 'transistor-output')
      .map(([loadId, element]) => ({
        scenarioId,
        sourceId: element.sourceId ?? null,
        loadId,
        status: element.state,
        terminals: [...new Set([
          ...(element.sourcePath?.terminalKeys ?? []),
          ...(element.returnPath?.terminalKeys ?? []),
          ...Object.keys(element.terminals).map((terminalId) => `${loadId}:${terminalId}`),
        ])],
      })),
    ...Object.entries(solution.currentLoops).map(([loopId, loop]) => ({
      scenarioId,
      sourceId: loop.sourceId ?? null,
      loadId: loopId,
      status: loop.state,
      terminals: [...new Set([
        ...(loop.sourcePath?.terminalKeys ?? []),
        ...(loop.signalPath?.terminalKeys ?? []),
        ...(loop.returnPath?.terminalKeys ?? []),
      ])],
    })),
  ]);
  const deviceSettings = report.deviceSettings.map((device) => {
    const workflowSetting = objectRecord(deviceWorkflowSettings[device.deviceId]);
    return {
      designation: typeof designations[device.deviceId] === 'string' ? String(designations[device.deviceId]) : device.deviceId,
      profileId: device.profileId,
      orderCode: typeof workflowSetting.orderCode === 'string'
        ? workflowSetting.orderCode
        : typeof device.configuration.orderCode === 'string' ? device.configuration.orderCode : null,
      settings: { ...device.configuration, ...workflowSetting },
    };
  });
  const bom = report.bom.map((entry) => {
    const orderCodes = entry.deviceIds.map((deviceId) => objectRecord(deviceWorkflowSettings[deviceId]).orderCode)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return {
      designation: entry.deviceIds.map((deviceId) => typeof designations[deviceId] === 'string' ? String(designations[deviceId]) : deviceId).join(', '),
      partNumber: [...new Set(orderCodes)].join(' / ') || entry.model || entry.profileId,
      description: `${entry.manufacturer ?? ''} ${entry.model ?? entry.profileId}`.trim(),
      quantity: entry.quantity,
      manufacturer: entry.manufacturer ?? undefined,
    };
  });
  const source = objectRecord(workflow.sourceSystem);
  const sourceProtection = objectRecord(workflow.sourceProtection);
  return {
    classification: run.classification,
    title: `${run.document.name} · ${run.classification}`,
    pinToPin,
    cables,
    terminals,
    bom,
    sourceAssumptions: {
      sourceSystem: typeof source.id === 'string' ? source.id : null,
      supply: typeof source.label === 'string' ? source.label : null,
      earthing: typeof workflow.earthingPolicy === 'string' ? workflow.earthingPolicy : null,
      canvasUnitsPerMm: typeof workflow.canvasUnitsPerMm === 'number' ? workflow.canvasUnitsPerMm : null,
    },
    sourceProtection: {
      phaseSequence: typeof sourceProtection.phaseSequence === 'string' ? sourceProtection.phaseSequence : null,
      prospectiveShortCircuitCurrentA: typeof sourceProtection.prospectiveShortCircuitCurrentA === 'number'
        ? sourceProtection.prospectiveShortCircuitCurrentA : null,
      protectiveDeviceCurve: typeof sourceProtection.protectiveDeviceCurve === 'string' ? sourceProtection.protectiveDeviceCurve : null,
    },
    checks: {
      supported: ['DC 폐회로와 귀로', 'PLC 입력 임계값', 'iG5A S8 NPN/PNP 입력 폐회로', '릴레이 출력 OFF/ON', '전원쌍 병렬', '3상 U/V/W 상순서', 'PE 연속성', '단자 geometry 1:1', '핀투핀 및 선번'],
      unsupported: ['PLC 래더 실행', '정확 주문코드 없는 iG5A 주회로·STO·출력 동특성', '과도현상/EMC', '공식 단락전류 및 보호협조(입력 데이터 없을 때)', '열해석'],
    },
    closedLoopPaths,
    deviceSettings,
    hashes: {
      report: report.reportHash,
      document: report.document.hash,
      validation: report.document.validationHash,
      source: report.document.sourceHash,
    },
    document: report.document,
    eligibility: {
      engine: 'v3-closed-loop',
      eligible: run.classification === 'VERIFIED_PREWIRE',
      status: run.validation.status,
      reason: run.classification === 'VERIFIED_PREWIRE'
        ? null
        : 'v3 prewire eligibility is incomplete or blocked.',
    },
    issues: report.issues,
    legacyDiagnostic: { classification: report.classification, eligibility: report.eligibility },
    workflow,
  };
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
  let equipmentOrderPanel: EquipmentOrderPanelController | null = null;
  const terminalSemanticsByLegacyType = Object.fromEntries(
    Object.entries(LEGACY_PROFILE_MAP).flatMap(([legacyType, profileId]) => {
      const profile = DEVICE_PROFILES[profileId];
      return profile
        ? [[legacyType, Object.fromEntries(profile.terminals.map((terminal) => [terminal.id, terminal]))] as const]
        : [];
    }),
  );
  bridge.applyTerminalSemantics(
    terminalSemanticsByLegacyType,
    assessTerminalCompatibility,
    terminalConductorVisual,
    fieldWireConductorVisual,
    (legacyType, terminal, instanceConfiguration, workflowDeviceSettings) => {
      const profileId = LEGACY_PROFILE_MAP[legacyType];
      return profileId
        ? effectiveTerminalSpecFromSettings(
            profileId,
            terminal,
            instanceConfiguration,
            workflowDeviceSettings,
          )
        : terminal;
    },
  );

  let currentMode = normalizeWorkshopMode(localStorage.getItem(MODE_STORAGE_KEY));
  let selectedMissionId: string | null = null;
  let missionRenderToken = 0;
  const bindingsByMission = new Map<string, Map<string, string>>();
  const hintLevelByMission = new Map<string, number>();
  const completedStepsByMission = new Map<string, Set<string>>();
  let v3WorkflowState = workflowStateFromDocument(bridge.readV2Shadow()?.document ?? {});
  let readWorkshopForAssistant: (() => Promise<WorkshopDocumentV2>) | undefined;
  let readWorkshopForFunctionTest: (() => Promise<WorkshopDocumentV2>) | undefined;
  let applyWorkshopForFunctionTest:
    ((workshop: WorkshopDocumentV2, message: string) => void) | undefined;
  bridge.setWorkflowStateBaseline(v3WorkflowState);
  let lastValidatedRevision: number | null = null;
  const v3Validator = createV3ValidationPort(createDomainV3ValidationPort());

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
  const xgSimDiagnostics = createXgSimDiagnosticsPanel({
    initialConfiguration: v3WorkflowState.plcRuntime,
    onConfigurationChange: (configuration) => {
      v3WorkflowState = { ...v3WorkflowState, plcRuntime: configuration };
      bridge.updateWorkflowState(v3WorkflowState);
    },
  });
  advancedBody.appendChild(xgSimDiagnostics.element);
  const xgSimFunctionTest = createXgSimFunctionTestPanel({
    manifest: XGSIM_CLOSED_LOOP_MANIFEST,
    readWorkshop: async () => {
      if (!readWorkshopForFunctionTest) throw new Error('결선 문서 판독기가 아직 준비되지 않았습니다.');
      return readWorkshopForFunctionTest();
    },
    applyTemplate: async (template) => {
      if (!readWorkshopForFunctionTest || !applyWorkshopForFunctionTest) {
        throw new Error('진단 템플릿 적용기가 아직 준비되지 않았습니다.');
      }
      const current = await readWorkshopForFunctionTest();
      if (workshopHasEditableContent(current)
        && !window.confirm('현재 제어반을 XG-SIM 자기유지 진단 템플릿으로 교체할까요? 기존 작업은 로컬 백업에 보존됩니다.')) {
        return false;
      }
      localStorage.setItem(XGSIM_FUNCTION_TEST_BACKUP_KEY, JSON.stringify(current));
      applyWorkshopForFunctionTest(
        template,
        `XG-SIM 자기유지 진단 템플릿 적용 · 장비 ${template.devices.length}대 · 결선 ${template.wires.length}가닥 · 이전 작업 자동 백업`,
      );
      return true;
    },
    setStatus: (message) => bridge.setStatus(message),
    downloadReport: (report, filename) => bridge.downloadJson(report, filename),
    onVisualFrame: (frame) => window.dispatchEvent(new CustomEvent('xgsim-runtime-visual-frame', { detail: frame })),
    onVisualClear: (reason) => window.dispatchEvent(new CustomEvent('xgsim-runtime-visual-clear', { detail: { reason } })),
  });
  advancedBody.appendChild(xgSimFunctionTest.element);
  if (counter) header.insertBefore(advanced, counter); else header.appendChild(advanced);

  const legacySave = saveButton.onclick;
  const loadButton = requiredElement<HTMLButtonElement>('b-load');
  const legacyLoad = loadButton.onclick;
  const reportButton = requiredElement<HTMLButtonElement>('b-export-report');
  const simMonitor = requiredElement<HTMLElement>('sim-monitor');
  const testTools = document.createElement('section');
  testTools.className = 'v3-test-tools';
  testTools.setAttribute('aria-labelledby', 'v3-test-tools-heading');
  const testHeading = document.createElement('h3');
  testHeading.id = 'v3-test-tools-heading'; testHeading.textContent = '가상 멀티미터 · 회로 추적';
  const testGrid = document.createElement('div'); testGrid.className = 'v3-test-grid';
  const meterMode = document.createElement('select'); meterMode.setAttribute('aria-label', '멀티미터 측정 모드');
  meterMode.add(new Option('DC 전압', 'voltage')); meterMode.add(new Option('연속성', 'continuity')); meterMode.add(new Option('분기 전류', 'current'));
  const positiveProbe = document.createElement('select'); positiveProbe.setAttribute('aria-label', '멀티미터 빨강 프로브');
  const negativeProbe = document.createElement('select'); negativeProbe.setAttribute('aria-label', '멀티미터 검정 프로브');
  const branchProbe = document.createElement('select'); branchProbe.setAttribute('aria-label', '전류 측정 분기');
  const measureButton = document.createElement('button'); measureButton.type = 'button'; measureButton.textContent = '측정';
  const traceLoad = document.createElement('select'); traceLoad.setAttribute('aria-label', '추적할 부하');
  const traceButton = document.createElement('button'); traceButton.type = 'button'; traceButton.textContent = '폐회로 추적';
  const artifactButton = document.createElement('button'); artifactButton.type = 'button'; artifactButton.textContent = 'HTML·CSV 내보내기';
  const pdfButton = document.createElement('button'); pdfButton.type = 'button'; pdfButton.textContent = 'PDF 저장';
  const testResult = document.createElement('output'); testResult.className = 'v3-test-result'; testResult.setAttribute('aria-live', 'polite');
  const traceLegend = document.createElement('div'); traceLegend.className = 'v3-trace-legend';
  traceLegend.innerHTML = '<b>빨강</b> 공급 경로 · <b>파랑</b> 0V/N 귀로 · <b>녹황</b> PE';
  testGrid.append(meterMode, positiveProbe, negativeProbe, branchProbe, measureButton, traceLoad, traceButton, artifactButton, pdfButton);
  testTools.append(testHeading, testGrid, testResult, traceLegend);
  simMonitor.parentElement?.appendChild(testTools);

  const wiringAssistant = createWiringAssistantPanel({
    calculate: async (deviceIds, intent) => {
      if (!readWorkshopForAssistant) throw new Error('결선 문서 판독기가 아직 준비되지 않았습니다.');
      const workshop = await readWorkshopForAssistant();
      const migrated = await migrateWorkshopDocumentV3(workshop);
      if (!migrated.ok) throw new Error(migrated.issues[0]?.message ?? 'WorkshopDocument v3 변환 실패');
      return suggestWiringPlans(migrated.document, deviceIds, intent, {
        profiles: DEVICE_PROFILES,
        verifiedProfiles: DEVICE_PROFILES_V3,
      });
    },
    focus: (refs) => bridge.focusRefs([...refs]),
    preview: (from, to) => bridge.previewSuggestedWire(from, to),
    showFlow: (steps) => bridge.showWiringFlowV3(steps),
    clearFlow: () => bridge.clearWiringFlowV3(),
    clearSelection: () => bridge.clearDeviceSelection(),
    setStatus: (message) => bridge.setStatus(message),
  });
  const rightPanel = requiredElement<HTMLElement>('right');
  rightPanel.insertBefore(wiringAssistant.element, rightPanel.firstChild);
  wiringAssistant.setSelection(bridge.readSelection().deviceIds);

  const replaceOptions = (select: HTMLSelectElement, values: readonly string[], emptyLabel: string): void => {
    const previous = select.value;
    select.replaceChildren();
    if (!values.length) {
      const option = new Option(emptyLabel, ''); option.disabled = true; option.selected = true; select.add(option);
      return;
    }
    for (const value of values) select.add(new Option(value, value));
    select.value = values.includes(previous) ? previous : values[0];
  };

  const updateTestToolOptions = (run: CoreRun): void => {
    if (!run.circuitSolution) return;
    const terminals = Object.keys(run.circuitSolution.terminals).sort();
    replaceOptions(positiveProbe, terminals, '단자 없음');
    replaceOptions(negativeProbe, terminals, '단자 없음');
    if (terminals.length > 1 && negativeProbe.value === positiveProbe.value) negativeProbe.value = terminals[1];
    replaceOptions(branchProbe, Object.keys(run.circuitSolution.branchCurrents).sort(), '분기 없음');
    replaceOptions(traceLoad, Object.entries(run.circuitSolution.elements)
      .filter(([, element]) =>
        element.kind === 'load'
        || element.kind === 'ac-load'
        || element.kind === 'three-phase-load'
        || element.kind === 'two-wire-current-transmitter')
      .map(([elementId]) => elementId)
      .sort(), '부하 없음');
  };

  const markValidationStale = (revision: number, force = false): void => {
    if (lastValidatedRevision === null || (!force && revision === lastValidatedRevision)) return;
    const panel = requiredElement<HTMLElement>('validation');
    panel.className = 'box'; panel.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'core-validation-status stale';
    heading.textContent = force && revision === lastValidatedRevision
      ? `STALE · revision ${revision} 문서가 교체되어 이전 결과 폐기`
      : `STALE · revision ${lastValidatedRevision} 검증 후 문서가 revision ${revision}(으)로 변경됨`;
    panel.appendChild(heading);
    const action = document.createElement('div'); action.className = 'warn'; action.textContent = '검증 또는 리포트 내보내기를 다시 실행하세요.'; panel.appendChild(action);
    simMonitor.textContent = 'STALE · 문서 변경으로 이전 시뮬레이션 결과를 사용할 수 없습니다.';
    testResult.textContent = 'STALE · 다시 검증한 뒤 측정하세요.';
  };
  window.addEventListener('workshop-document-revision', (event) => {
    const revision = (event as CustomEvent<{ revision?: number }>).detail?.revision;
    if (typeof revision === 'number') {
      markValidationStale(revision);
      wiringAssistant.markStale();
      void xgSimFunctionTest.markStale(`문서 revision ${revision}(으)로 변경`);
    }
  });
  window.addEventListener('workshop-document-replaced', (event) => {
    const revision = (event as CustomEvent<{ revision?: number }>).detail?.revision;
    if (typeof revision === 'number') {
      markValidationStale(revision, true);
      wiringAssistant.markStale('문서를 불러와 이전 결선 안내를 폐기했습니다. 다시 계산하세요.');
      void xgSimFunctionTest.markStale(`문서 revision ${revision} 교체`);
    }
  });
  window.addEventListener('workshop-selection-change', (event) => {
    const deviceIds = (event as CustomEvent<{ deviceIds?: unknown }>).detail?.deviceIds;
    wiringAssistant.setSelection(Array.isArray(deviceIds)
      ? deviceIds.filter((id): id is string => typeof id === 'string')
      : []);
  });
  window.addEventListener('workshop-workflow-state-restored', (event) => {
    const state = (event as CustomEvent<{ state?: unknown }>).detail?.state;
    v3WorkflowState = createV3WorkflowState(state);
    void xgSimDiagnostics.disconnect();
    void xgSimFunctionTest.disconnect();
    xgSimDiagnostics.setConfiguration(v3WorkflowState.plcRuntime);
    void renderMissions();
  });

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
    return applyV3WorkflowState(documentV2, v3WorkflowState);
  };
  readWorkshopForAssistant = readDocument;
  readWorkshopForFunctionTest = readDocument;

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
        : validation.status === 'STALE'
          ? 'STALE · 문서 변경 후 재검증 필요'
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

  const runLegacyCoreValidation = async (workshop: WorkshopDocumentV2): Promise<Omit<CoreRun, 'classification'>> => {
    const mission = missionForSelection();
    if (mission) {
      const evaluation = await evaluateMission(mission, workshop, DEVICE_PROFILES, selectedBindings(mission));
      const validation = await normalizeMissionValidation(workshop, evaluation);
      return { document: workshop, validation, evaluation };
    }
    const validation = await validateWorkshop(workshop, DEVICE_PROFILES);
    return { document: workshop, validation };
  };

  const runCoreValidation = async (): Promise<CoreRun> => {
    const workshop = await readDocument();
    let legacyRun: Omit<CoreRun, 'classification'> | undefined;
    const v3Result = await v3Validator.validate({
      document: workshop,
      mode: currentMode,
      workflow: v3WorkflowState,
      terminalGeometry: bridge.readTerminalGeometryV3(),
      validateLegacy: async () => {
        legacyRun = await runLegacyCoreValidation(workshop);
        return legacyRun.validation;
      },
    });
    const run: CoreRun = {
      document: workshop,
      validation: v3Result.validation,
      evaluation: legacyRun?.evaluation,
      classification: v3Result.classification,
      circuitSolution: v3Result.circuitSolution,
      scenarioSimulations: v3Result.scenarioSimulations,
    };
    const liveRevision = bridge.readState().revision ?? workshop.revision;
    if (liveRevision !== workshop.revision) {
      run.validation = {
        ...run.validation,
        status: 'STALE',
        issues: [{
          code: 'VALIDATION_STALE', severity: 'blocked', blocking: true,
          message: `Document changed from revision ${workshop.revision} to ${liveRevision} while validation was running.`,
          refs: [],
        }, ...run.validation.issues],
      };
      run.classification = currentMode === 'practice' ? 'LEGACY_DIAGNOSTIC' : 'DIAGNOSTIC';
      run.circuitSolution = undefined;
      run.scenarioSimulations = undefined;
    }
    lastValidatedRevision = liveRevision;
    renderValidation(run.validation, workshop);
    updateTestToolOptions(run);
    const mission = missionForSelection();
    bridge.setStatus(`${mission?.title ?? '결선 검토'}: ${run.validation.status} · 이슈 ${run.validation.issues.length}건 · ${run.classification}`);
    return run;
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
    const solution = run.circuitSolution;
    if (!solution) {
      requiredElement('sim-monitor').textContent = 'BLOCKED · v3 회로 해를 만들 수 없습니다.';
      return;
    }
    const monitor = requiredElement<HTMLElement>('sim-monitor');
    monitor.replaceChildren();
    const appendSerialStates = (serialSolution: CircuitSolution): void => {
      const serialStates = analyzeSerialDeviceStates(run.document, DEVICE_PROFILES, serialSolution);
      for (const state of Object.values(serialStates)) {
        const row = document.createElement('div');
        row.dataset.serialDeviceId = state.deviceId;
        row.textContent = `${state.deviceId} ${state.portId}: 전원 ${state.powered ? '정상' : '꺼짐'}`
          + ` · 통신선 ${state.communicationWired ? '정상' : '미구성'}`
          + ` · 설정 ${state.protocolConfigured ? (state.settingsCompatible ? '일치' : '불일치') : '미입력'}`
          + ` · ${state.communicationReady ? '통신 준비' : state.status}`;
        monitor.appendChild(row);
      }
    };
    if (run.scenarioSimulations?.length) {
      const heading = document.createElement('div');
      heading.textContent = `v3 결정적 I/O 시험 · ${run.validation.status} · ${run.scenarioSimulations.length}개 시나리오`;
      monitor.appendChild(heading);
      for (const scenario of run.scenarioSimulations) {
        const scenarioRow = document.createElement('div');
        const activeLoads = Object.entries(scenario.solution.loads)
          .filter(([, load]) => load.state === 'ON')
          .map(([loadId]) => loadId);
        const closedContacts = Object.entries(scenario.contactStates)
          .filter(([, closed]) => closed)
          .map(([stateKey]) => stateKey);
        const activeLoops = Object.entries(scenario.solution.currentLoops)
          .filter(([, loop]) => loop.active)
          .map(([loopId, loop]) => `${loopId}:${(loop.currentA * 1000).toFixed(1)}mA`);
        scenarioRow.textContent = `${scenario.scenarioId}: ${scenario.validation.status} · ON[${activeLoads.join(', ') || '-'}]`
          + ` · LOOP[${activeLoops.join(', ') || '-'}] · 접점[${closedContacts.join(', ') || '-'}] · 반복 ${scenario.iterations}`;
        monitor.appendChild(scenarioRow);
      }
      appendSerialStates(solution);
      return;
    }
    const heading = document.createElement('div');
    heading.textContent = `v3 폐회로 해 · ${run.validation.status} · 통전 단자 ${solution.energizedTerminals.length}`;
    monitor.appendChild(heading);
    for (const [loadId, load] of Object.entries(solution.loads)) {
      const row = document.createElement('div');
      row.textContent = `${loadId}: ${load.state}${load.sourceId ? ` · source ${load.sourceId}` : ''}`;
      monitor.appendChild(row);
    }
    for (const [loopId, loop] of Object.entries(solution.currentLoops)) {
      const row = document.createElement('div');
      row.textContent = `${loopId}: ${loop.state} · ${(loop.currentA * 1000).toFixed(1)}mA`
        + ` · RX ${loop.receiverVoltageV?.toFixed(3) ?? '?'}V · TX ${loop.transmitterVoltageV?.toFixed(3) ?? '?'}V`;
      monitor.appendChild(row);
    }
    appendSerialStates(solution);
  };

  const probeReference = (key: string): { elementId: string; terminalId: string } | null => {
    const separator = key.lastIndexOf(':');
    return separator > 0 ? { elementId: key.slice(0, separator), terminalId: key.slice(separator + 1) } : null;
  };

  measureButton.addEventListener('click', () => {
    void (async () => {
      const run = await runCoreValidation();
      if (!run.circuitSolution) { testResult.textContent = 'BLOCKED · 회로 해가 없습니다.'; return; }
      const meter = createVirtualMultimeter(run.circuitSolution);
      if (meterMode.value === 'current') {
        const measurement = meter.branchCurrent(branchProbe.value);
        testResult.textContent = measurement.status === 'measured'
          ? `${branchProbe.value}: ${measurement.currentA.toFixed(6)} A · 부하 ${measurement.loadIds.join(', ') || '-'}`
          : `${branchProbe.value}: ${measurement.status} · 전류 계산 입력 부족`;
        return;
      }
      const positive = probeReference(positiveProbe.value);
      const negative = probeReference(negativeProbe.value);
      if (!positive || !negative) { testResult.textContent = '측정할 두 단자를 선택하세요.'; return; }
      if (meterMode.value === 'continuity') {
        const measurement = meter.continuity(positive, negative);
        testResult.textContent = measurement.status === 'measured'
          ? `${positiveProbe.value} ↔ ${negativeProbe.value}: ${measurement.continuous ? '연속' : '개방'}`
          : '단자 정보가 없어 연속성을 측정할 수 없습니다.';
        return;
      }
      const measurement = meter.voltage(positive, negative);
      testResult.textContent = measurement.status === 'measured'
        ? `${positiveProbe.value} − ${negativeProbe.value}: ${measurement.voltageV.toFixed(3)} V DC`
        : `${positiveProbe.value} − ${negativeProbe.value}: ${measurement.status}`;
    })();
  });

  traceButton.addEventListener('click', () => {
    void (async () => {
      const run = await runCoreValidation();
      const load = run.circuitSolution?.elements[traceLoad.value];
      const currentLoop = run.circuitSolution?.currentLoops[traceLoad.value];
      if (!load || (
        load.kind !== 'load'
        && load.kind !== 'ac-load'
        && load.kind !== 'three-phase-load'
        && load.kind !== 'two-wire-current-transmitter'
      )) { testResult.textContent = '추적할 부하 또는 2선식 전류 루프를 선택하세요.'; return; }
      const peWireIds = run.document.wires.filter((wire) => {
        const fromProfile = DEVICE_PROFILES[run.document.devices.find((device) => device.id === wire.from.deviceId)?.profileId ?? ''];
        const toProfile = DEVICE_PROFILES[run.document.devices.find((device) => device.id === wire.to.deviceId)?.profileId ?? ''];
        return fromProfile?.terminals.find((terminal) => terminal.id === wire.from.terminalId)?.domain === 'pe'
          || toProfile?.terminals.find((terminal) => terminal.id === wire.to.terminalId)?.domain === 'pe';
      }).map((wire) => wire.id);
      const connectedWireIds = run.document.wires
        .filter((wire) => wire.from.deviceId === traceLoad.value || wire.to.deviceId === traceLoad.value)
        .map((wire) => wire.id);
      if (currentLoop) {
        const forwardRefs = [
          ...(currentLoop.sourcePath?.branchIds ?? []),
          ...(currentLoop.signalPath?.branchIds ?? []),
        ];
        const returnRefs = [...(currentLoop.returnPath?.branchIds ?? [])];
        bridge.traceCircuitV3(forwardRefs, returnRefs, peWireIds);
        testResult.textContent = `${traceLoad.value}: ${currentLoop.state} · ${(currentLoop.currentA * 1000).toFixed(1)}mA`
          + ` · 수신기 ${currentLoop.receiverVoltageV?.toFixed(3) ?? '?'}V`
          + ` · 송신기 ${currentLoop.transmitterVoltageV?.toFixed(3) ?? '?'}V`;
        return;
      }
      const forwardRefs = load.sourcePath?.branchIds ? [...load.sourcePath.branchIds] : connectedWireIds.filter((wireId) => !peWireIds.includes(wireId));
      bridge.traceCircuitV3(forwardRefs, load.returnPath?.branchIds ? [...load.returnPath.branchIds] : [], peWireIds);
      const terminals = Object.keys(load.terminals);
      const sourceTrace = load.sourcePath?.terminalKeys.join(' → ') ?? (terminals.join(' · ') || '끊김');
      const returnTrace = load.returnPath?.terminalKeys.join(' → ') ?? (load.kind === 'load' ? '끊김' : 'AC/3상 경로는 연결 단자 표시');
      testResult.textContent = `${traceLoad.value}: ${load.state} · 공급 ${sourceTrace} · 귀로 ${returnTrace}`;
    })();
  });

  const buildFreshReviewReport = async (): Promise<{ run: CoreRun; report: ReviewReport; v3Report: V3ExportReport }> => {
    const run = await runCoreValidation();
    const report = await generateReviewReport(run.document, run.validation, DEVICE_PROFILES);
    const v3Report = createV3ExportReport(run, report);
    return { run, report, v3Report };
  };

  const exportFreshReviewReport = async (): Promise<void> => {
    const { run, report, v3Report } = await buildFreshReviewReport();
    const filename = run.classification === 'VERIFIED_PREWIRE'
      ? `prewire-verified-r${run.document.revision}.json`
      : `prewire-diagnostic-r${run.document.revision}.json`;
    bridge.downloadJson(JSON.parse(jsonReport(v3Report)), filename);
    bridge.setStatus(run.classification === 'VERIFIED_PREWIRE'
      ? 'VERIFIED_PREWIRE 리포트 발급 완료 · 최신 revision과 근거 해시 포함'
      : `${run.classification} 리포트 생성 · 통과 리포트 미발급 (${report.eligibility.reason ?? '검증 불충분'})`);
  };

  artifactButton.addEventListener('click', () => {
    void (async () => {
      const { run, v3Report } = await buildFreshReviewReport();
      const base = run.classification === 'VERIFIED_PREWIRE'
        ? `prewire-verified-r${run.document.revision}`
        : `prewire-diagnostic-r${run.document.revision}`;
      bridge.downloadText(htmlReport(v3Report), `${base}.html`, 'text/html;charset=utf-8');
      bridge.downloadText(pinToPinCsv(v3Report), `${base}-pin-to-pin.csv`, 'text/csv;charset=utf-8');
      bridge.downloadText(cableCoreScheduleCsv(v3Report), `${base}-cable-cores.csv`, 'text/csv;charset=utf-8');
      bridge.downloadText(terminalPlanCsv(v3Report), `${base}-terminal-plan.csv`, 'text/csv;charset=utf-8');
      bridge.downloadText(bomCsv(v3Report), `${base}-bom.csv`, 'text/csv;charset=utf-8');
      bridge.setStatus('최신 v3 재검증 후 HTML·CSV 리포트 묶음을 내보냈습니다.');
    })();
  });

  pdfButton.addEventListener('click', () => {
    void (async () => {
      const { run, v3Report } = await buildFreshReviewReport();
      const desktop = (window as unknown as {
        WorkshopDesktop?: { saveReportPdf(html: string, filename: string): Promise<{ saved: boolean; filePath?: string }> };
      }).WorkshopDesktop;
      if (!desktop) { bridge.setStatus('PDF 저장은 오프라인 Electron 앱에서만 사용할 수 있습니다.'); return; }
      const base = run.classification === 'VERIFIED_PREWIRE'
        ? `prewire-verified-r${run.document.revision}`
        : `prewire-diagnostic-r${run.document.revision}`;
      const result = await desktop.saveReportPdf(htmlReport(v3Report), `${base}.pdf`);
      bridge.setStatus(result.saved ? `PDF 저장 완료: ${result.filePath ?? base}` : 'PDF 저장을 취소했습니다.');
    })();
  });

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
    panel.appendChild(createV3WorkflowPanel({
      state: v3WorkflowState,
      devices: workshop.devices.map((device) => ({
        id: device.id,
        profileId: device.profileId,
        label: `${device.id} · ${DEVICE_PROFILES[device.profileId]?.model ?? device.profileId}`,
      })),
      conductors: workshop.wires.map((wire) => ({
        id: wire.id,
        label: `${wire.from.deviceId}:${wire.from.terminalId} → ${wire.to.deviceId}:${wire.to.terminalId}`,
        fromTerminalId: wire.from.terminalId,
        toTerminalId: wire.to.terminalId,
        wireNumber: wire.tag,
        gauge: wire.gauge,
        color: wire.color,
      })),
      onChange: (state) => {
        if (JSON.stringify(state) === JSON.stringify(v3WorkflowState)) return;
        v3WorkflowState = state;
        bridge.updateWorkflowState(state);
      },
      onLoadAcademyTemplate: () => {
        void (async () => {
          const current = await readDocument();
          if ((current.devices.length || current.wires.length)
            && !window.confirm('현재 작업장을 학원 eXP2·MD02 진단 예제로 교체할까요? 저장하지 않은 결선은 현재 화면에서 사라집니다.')) return;
          const template = createAcademyExp2Md02Template();
          applyLoadedWorkshop(template, '학원 진단 예제 로드 · 시뮬 버튼으로 HMI 통신 준비와 MD02 전원 정상/통신 미구성을 확인하세요.');
        })();
      },
    }));
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

        const connectAction = mission.actions.find((action) => action.kind === 'connect');
        const configureActions = mission.actions.filter((action) => action.kind === 'configure');
        const operateActions = mission.actions.filter((action) => action.kind === 'toggle-contact' || action.kind === 'force-output');
        const expectedText = mission.expectedStates.map((state) =>
          `${state.scenarioId}: ${state.target.role}.${state.target.terminalId}=${String(state.expected)}`).join(', ');
        const workSteps = [
          ['prepare', '장비 준비', mission.roles.map((role) => role.label).join(', ')],
          ['first-wire', '첫 결선', connectAction?.label ?? mission.expectedConnections[0]?.connections[0]?.label ?? '도면의 첫 공급선을 연결한다.'],
          ['configure', '설정', configureActions.map((action) => action.label).join(' / ') || '공급계통·접지·주문코드와 장비 설정을 확인한다.'],
          ['operate', '조작', operateActions.map((action) => action.label).join(' / ') || '지정된 접점 또는 보호기기 상태를 적용한다.'],
          ['measure', '예상 측정값', expectedText || '가상 멀티미터의 예상값을 기록한다.'],
          ['confirm', '확인', 'v3 검증과 I/O 시험 결과를 확인한다.'],
        ] as const;
        const completed = completedStepsByMission.get(mission.id) ?? new Set<string>();
        completedStepsByMission.set(mission.id, completed);
        const sequence = document.createElement('ol'); sequence.className = 'mission-work-sequence';
        for (const [stepId, heading, detail] of workSteps) {
          const item = document.createElement('li');
          const label = document.createElement('label');
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = completed.has(stepId);
          checkbox.setAttribute('aria-label', `${mission.title} · ${heading} 완료`);
          checkbox.addEventListener('change', () => { if (checkbox.checked) completed.add(stepId); else completed.delete(stepId); });
          const text = document.createElement('span');
          const strong = document.createElement('b'); strong.textContent = heading;
          text.append(strong, document.createTextNode(detail)); label.append(checkbox, text); item.appendChild(label); sequence.appendChild(item);
        }
        body.appendChild(sequence);

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

  window.addEventListener('workshop-render-missions', () => {
    void renderMissions();
  });

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
    equipmentOrderPanel?.setMode(mode);
    applyPalettePolicy();
    void renderMissions();
  };

  const openModeSelector = (): void => {
    if (document.getElementById('workshop-mode-selector')) return;
    installModeSelector({ onModeChange: setMode, showOnStart: true });
  };
  modeButton.addEventListener('click', openModeSelector);

  const applyLoadedWorkshop = (workshop: WorkshopDocumentV2, message: string): void => {
    selectedMissionId = null;
    resetMissionSessionState(bindingsByMission, hintLevelByMission);
    completedStepsByMission.clear();
    const loadedMission = missionStateFromDocument(workshop);
    selectedMissionId = loadedMission.missionId;
    if (selectedMissionId) bindingsByMission.set(selectedMissionId, loadedMission.bindings);
    v3WorkflowState = workflowStateFromDocument(workshop);
    bridge.applyDocumentV2(workshop);
    bridge.setWorkflowStateBaseline(v3WorkflowState);
    setMode(workshop.mode);
    bridge.setStatus(message);
  };
  applyWorkshopForFunctionTest = applyLoadedWorkshop;

  const equipmentOrderCatalog = bridge.readEquipmentCatalog();
  equipmentOrderPanel = installEquipmentOrderPanel(document, {
    catalog: equipmentOrderCatalog,
    profiles: DEVICE_PROFILES,
    getMode: () => currentMode,
    createPanelLayout: (rows) => bridge.createPanelLayoutV2(rows),
    applyOrder: async (workshop, summary) => {
      const current = await readDocument();
      localStorage.setItem(EQUIPMENT_ORDER_BACKUP_KEY, JSON.stringify(current));
      applyLoadedWorkshop(workshop, `제어반 BOM 적용 완료 · ${summary} · 이전 작업 자동 백업됨`);
    },
    restoreBackup: () => {
      const raw = localStorage.getItem(EQUIPMENT_ORDER_BACKUP_KEY);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw) as WorkshopDocumentV2;
        if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.devices) || !Array.isArray(parsed.wires)) return false;
        applyLoadedWorkshop(parsed, `BOM 구성 전 작업 복원 완료 · 장비 ${parsed.devices.length}대 · 결선 ${parsed.wires.length}가닥`);
        return true;
      } catch {
        bridge.setStatus('장비 주문 전 백업 JSON이 손상되어 복원하지 못했습니다.');
        return false;
      }
    },
    setStatus: (message) => bridge.setStatus(message),
  });

  const loadBestStoredWorkshop = async (): Promise<WorkshopDocumentV2 | null> => {
    // V2 is the editable renderer source of truth and preserves every legacy
    // device. Prefer it over a derived V3 copy so a partial migration can never
    // make visible equipment disappear on startup.
    const storedV2 = loadWorkshopV2(localStorage);
    if (storedV2?.ok) return storedV2.document;
    if (storedV2 && !storedV2.ok) {
      bridge.setStatus(`${storedV2.status}: ${storedV2.message}`);
      return null;
    }
    const storedV3 = await loadWorkshopDocumentV3(localStorage);
    if (storedV3?.ok) return restoreWorkshopDocumentV2FromV3(storedV3.document);
    if (storedV3 && !storedV3.ok) bridge.setStatus(`${storedV3.status}: ${storedV3.message}`);
    return null;
  };

  validateButton.onclick = (event) => {
    event?.preventDefault();
    void runCoreValidation();
  };
  simulateButton.onclick = (event) => {
    event?.preventDefault();
    void runCoreSimulation();
  };
  reportButton.onclick = (event) => {
    event?.preventDefault();
    void exportFreshReviewReport();
  };
  saveButton.onclick = (event) => {
    void (async () => {
      const workshop = await readDocument();
      saveWorkshopV2(localStorage, workshop);
      const migratedV3 = await migrateWorkshopDocumentV3(workshop);
      if (!migratedV3.ok) {
        bridge.setStatus(`BLOCKED · WorkshopDocument v3 저장 실패: ${migratedV3.issues[0]?.message ?? '변환 실패'}`);
        return;
      }
      await saveWorkshopDocumentV3(localStorage, migratedV3.document);
      bridge.rememberDocumentV2(workshop);
      legacySave?.call(saveButton, event);
      bridge.setStatus(`WorkshopDocument v3 저장 완료 · revision ${workshop.revision} · v2/구형 원본도 보존`);
    })();
  };
  loadButton.onclick = (event) => {
    void (async () => {
      const restored = await loadBestStoredWorkshop();
      if (restored === null) {
        selectedMissionId = null;
        resetMissionSessionState(bindingsByMission, hintLevelByMission);
        completedStepsByMission.clear();
        bridge.clearV2Shadow();
        v3WorkflowState = createV3WorkflowState({});
        legacyLoad?.call(loadButton, event);
        bridge.setWorkflowStateBaseline(v3WorkflowState);
        void renderMissions();
        return;
      }
      applyLoadedWorkshop(restored, `저장 작업 복원 완료 · ${restored.devices.length}개 장비 · ${restored.wires.length}개 결선 · revision ${restored.revision}`);
    })();
  };

  (window as unknown as { WorkshopV2Controller: { ownsCorePanels: boolean; renderMissions(): void } }).WorkshopV2Controller = {
    ownsCorePanels: true,
    renderMissions: () => { void renderMissions(); },
  };

  setMode(currentMode);
  void (async () => {
    const migration = await migrateLegacyLocalStorage(
      localStorage,
      LEGACY_STORAGE_KEY,
      WORKSHOP_V2_STORAGE_KEY,
      { knownLegacyTypes: new Set(Object.keys(LEGACY_PROFILE_MAP)) },
    );
    if (migration && !migration.ok) {
      bridge.setStatus(`BLOCKED: ${migration.issues[0]?.message ?? '기존 저장본 변환 실패'}`);
      openModeSelector();
      return;
    }

    const restored = await loadBestStoredWorkshop();
    if (!restored) {
      openModeSelector();
      return;
    }

    applyLoadedWorkshop(
      restored,
      `${migration?.migrated ? '기존 작업 자동 변환·복원' : '저장 작업 자동 복원'} · ${restored.devices.length}개 장비 · ${restored.wires.length}개 결선 · revision ${restored.revision}`,
    );
    const migratedV3 = await migrateWorkshopDocumentV3(restored);
    if (migratedV3.ok) await saveWorkshopDocumentV3(localStorage, migratedV3.document);
  })();
}
