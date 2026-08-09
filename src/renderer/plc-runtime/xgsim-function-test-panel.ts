import { DEVICE_PROFILES } from '../../catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../catalog/v3-profiles';
import {
  createXbcDr32hSelfHoldSliceDefinition,
  createXbcDr32hSelfHoldWorkshopV2,
} from '../../domain/device-runtime';
import {
  XbcClosedLoopSessionController,
  XgSimLocalProjectRefV1Schema,
  createFunctionalSimulationReportV2,
  type FunctionalSimulationReportV2,
  type XbcClosedLoopRunResult,
  type XbcClosedLoopStepResult,
  type XgSimLocalProjectRefV1,
  type XgSimTestProjectManifestV1,
} from '../../domain/plc-runtime';
import type { WorkshopDocumentV2 } from '../../domain/types';
import { buildPrewireCircuitV3 } from '../../domain/v3';
import { XgSimRuntimeAdapter } from './xgsim-adapter';

export interface XgSimFunctionTestPanelOptions {
  readonly manifest: XgSimTestProjectManifestV1;
  readonly readWorkshop: () => Promise<WorkshopDocumentV2>;
  readonly applyTemplate: (workshop: WorkshopDocumentV2) => Promise<boolean> | boolean;
  readonly setStatus: (message: string) => void;
  readonly downloadReport: (report: FunctionalSimulationReportV2, filename: string) => void;
  readonly onResult?: (result: XbcClosedLoopRunResult, projectReference: XgSimLocalProjectRefV1) => void;
}

export interface XgSimFunctionTestPanel {
  readonly element: HTMLElement;
  markStale(reason: string): Promise<void>;
  disconnect(): Promise<void>;
}

function button(label: string): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.textContent = label;
  return result;
}

function valueCell(label: string): { root: HTMLElement; output: HTMLOutputElement } {
  const root = document.createElement('div');
  const heading = document.createElement('span'); heading.textContent = label;
  const output = document.createElement('output'); output.textContent = '—';
  root.append(heading, output);
  return { root, output };
}

function yesNo(value: unknown): string {
  return value === true ? 'ON' : 'OFF';
}

export function createXgSimFunctionTestPanel(options: XgSimFunctionTestPanelOptions): XgSimFunctionTestPanel {
  const adapter = new XgSimRuntimeAdapter();
  const definition = createXbcDr32hSelfHoldSliceDefinition();
  const controller = new XbcClosedLoopSessionController({ adapter, manifest: options.manifest, definition });
  let projectReference: XgSimLocalProjectRefV1 | null = null;
  let workingDocumentHash: string | null = null;
  let busy = false;
  let lastLiveRenderAt = 0;
  let pendingStep: XbcClosedLoopStepResult | null = null;
  let pendingRenderTimer: number | null = null;
  let latestReport: FunctionalSimulationReportV2 | null = null;

  const root = document.createElement('section');
  root.className = 'xgsim-function-test';
  root.setAttribute('aria-labelledby', 'xgsim-function-test-heading');
  const heading = document.createElement('h3'); heading.id = 'xgsim-function-test-heading'; heading.textContent = 'XG-SIM 기능시험(진단)';
  const explanation = document.createElement('p');
  explanation.textContent = '물리 결선 P03/P02/P21은 그대로 두고, 4층_GEMINI의 M00001 시작요구 · M00002 정지요구 · M00100 운전상태를 왕복 시험합니다. 성공해도 프로젝트 신원은 공식 API로 증명되지 않아 정식 SIL 통과가 아닙니다.';

  const project = document.createElement('output'); project.className = 'xgsim-function-project';
  project.textContent = `프로젝트 미선택 · ${options.manifest.projectFileName} 필요`;
  const declarationLabel = document.createElement('label'); declarationLabel.className = 'xgsim-function-confirm';
  const declaration = document.createElement('input'); declaration.type = 'checkbox';
  const declarationText = document.createElement('span'); declarationText.textContent = '선택한 프로젝트를 XG5000에서 열고 XG-SIM을 시작했습니다.';
  declarationLabel.append(declaration, declarationText);

  const actions = document.createElement('div'); actions.className = 'xgsim-function-actions';
  const loadTemplate = button('자기유지 템플릿 배치');
  const selectProject = button('프로젝트 선택');
  const preflight = button('사전 점검');
  const runTest = button('기능시험 시작');
  const pause = button('일시정지');
  const safeStop = button('안전 종료');
  const downloadReport = button('진단 JSON 저장');
  actions.append(loadTemplate, selectProject, preflight, runTest, pause, safeStop, downloadReport);

  const state = document.createElement('output'); state.className = 'xgsim-function-status'; state.setAttribute('aria-live', 'polite');
  const live = document.createElement('div'); live.className = 'xgsim-function-live';
  const startValue = valueCell('P03 회로 → M00001 시작요구');
  const stopValue = valueCell('P02 NC 회로 → M00002 정지요구');
  const outputValue = valueCell('M00100 운전상태');
  const contactValue = valueCell('M00100 → P21 가상접점');
  const coilValue = valueCell('MY2N 코일');
  const relayValue = valueCell('MY2N 상태');
  const lampValue = valueCell('운전 램프');
  live.append(startValue.root, stopValue.root, outputValue.root, contactValue.root, coilValue.root, relayValue.root, lampValue.root);
  const path = document.createElement('output'); path.className = 'xgsim-function-path'; path.textContent = '+24V → (시험 전) → 24G';
  const steps = document.createElement('ol'); steps.className = 'xgsim-function-steps'; steps.setAttribute('aria-label', 'XG-SIM 기능시험 단계');

  const desktopAvailable = Boolean(window.WorkshopDesktop?.xgSim?.selectProject);
  if (!desktopAvailable) {
    selectProject.disabled = true;
    preflight.disabled = true;
    runTest.disabled = true;
    pause.disabled = true;
    safeStop.disabled = true;
    state.textContent = 'BLOCKED · 기능시험은 오프라인 Electron 앱에서만 사용할 수 있습니다.';
  }

  const refreshButtons = (): void => {
    const sessionState = controller.snapshot.state;
    const hasProject = projectReference !== null;
    selectProject.disabled = busy || !desktopAvailable;
    preflight.disabled = busy || !desktopAvailable || !hasProject;
    runTest.disabled = busy || sessionState !== 'ready';
    pause.disabled = !desktopAvailable || sessionState !== 'running';
    safeStop.disabled = !desktopAvailable || !['ready', 'running', 'paused', 'faulted'].includes(sessionState);
    downloadReport.disabled = latestReport === null;
    loadTemplate.disabled = busy;
  };

  controller.subscribe((snapshot) => {
    state.textContent = `${snapshot.state.toUpperCase()} · ${snapshot.outcome}${snapshot.issueCodes.length ? ` · ${snapshot.issueCodes.join(', ')}` : ''}${snapshot.lastError ? ` · ${snapshot.lastError}` : ''}`;
    refreshButtons();
  });

  const renderLiveStep = (step: XbcClosedLoopStepResult): void => {
    const frame = step.frame;
    startValue.output.textContent = yesNo(frame.plcInputs[definition.startInputBindingId]);
    stopValue.output.textContent = yesNo(frame.plcInputs[definition.stopInputBindingId]);
    outputValue.output.textContent = yesNo(frame.plcOutputs[definition.runOutputBindingId]);
    contactValue.output.textContent = frame.deviceStates[definition.plcOutputContactStateKey] ?? '—';
    const coil = frame.circuitSolution.loads[definition.relayCoilElementId];
    coilValue.output.textContent = coil
      ? `${coil.voltageV === null ? '?' : coil.voltageV.toFixed(1)} V / ${coil.currentA === null ? '?' : `${(coil.currentA * 1000).toFixed(1)} mA`}`
      : '—';
    relayValue.output.textContent = frame.deviceStates[definition.relayCoilElementId] ?? '—';
    lampValue.output.textContent = frame.deviceStates[definition.lampElementId] ?? '—';
    const load = coil?.energized ? coil : frame.circuitSolution.loads[definition.lampElementId];
    path.textContent = load
      ? `+24V → ${load.sourcePath?.branchIds.join(' → ') || `끊김(${load.state})`} → ${definition.relayCoilElementId} → ${load.returnPath?.branchIds.join(' → ') || `끊김(${load.state})`} → 24G`
      : '+24V → 회로 결과 없음 → 24G';
  };

  const appendStepResult = (step: XbcClosedLoopStepResult): void => {
    const item = document.createElement('li');
    item.className = step.passed ? 'pass' : 'fail';
    item.textContent = `${step.id} · ${step.passed ? 'PASS' : 'FAIL'}${step.issueCodes.length ? ` · ${step.issueCodes.join(', ')}` : ''}`;
    steps.appendChild(item);
  };

  const renderLiveAtMostTenHz = (step: XbcClosedLoopStepResult): void => {
    pendingStep = step;
    const elapsed = performance.now() - lastLiveRenderAt;
    const flush = (): void => {
      pendingRenderTimer = null;
      const next = pendingStep; pendingStep = null;
      if (!next) return;
      lastLiveRenderAt = performance.now();
      renderLiveStep(next);
    };
    if (elapsed >= 100) flush();
    else if (pendingRenderTimer === null) pendingRenderTimer = window.setTimeout(flush, 100 - elapsed);
  };
  const flushPendingStep = (): void => {
    if (pendingRenderTimer !== null) window.clearTimeout(pendingRenderTimer);
    pendingRenderTimer = null;
    const next = pendingStep; pendingStep = null;
    if (!next) return;
    lastLiveRenderAt = performance.now();
    renderLiveStep(next);
  };
  controller.subscribeFrame((step) => {
    appendStepResult(step);
    renderLiveAtMostTenHz(step);
  });

  const guarded = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true; refreshButtons();
    try {
      await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.textContent = `BLOCKED · ${message}`;
      options.setStatus(`XG-SIM 기능시험 BLOCKED · ${message}`);
    } finally {
      busy = false; refreshButtons();
    }
  };

  loadTemplate.addEventListener('click', () => void guarded(async () => {
    const applied = await options.applyTemplate(createXbcDr32hSelfHoldWorkshopV2());
    if (!applied) {
      options.setStatus('XBC-DR32H 자기유지 진단 템플릿 배치를 취소했습니다.');
      return;
    }
    steps.replaceChildren();
    options.setStatus('XBC-DR32H 자기유지 진단 템플릿 배치 완료 · 기존 장비 이미지는 변경하지 않았습니다.');
  }));

  selectProject.addEventListener('click', () => void guarded(async () => {
    const selected = await window.WorkshopDesktop!.xgSim.selectProject();
    if (!selected.selected || !selected.reference) return;
    if (!['disconnected', 'safe-stopped', 'stale'].includes(controller.snapshot.state)) {
      await controller.markStale('XG5000 프로젝트 참조가 변경되었습니다.');
    }
    projectReference = XgSimLocalProjectRefV1Schema.parse(selected.reference);
    workingDocumentHash = null;
    latestReport = null;
    declaration.checked = false;
    project.textContent = `${projectReference.fileName} · ${(projectReference.sizeBytes / 1024).toFixed(1)} KiB · SHA-256 ${projectReference.sha256.slice(0, 16)}…`;
    options.setStatus('XG5000 프로젝트 메타데이터를 선택했습니다. 파일 내용은 renderer로 읽지 않았습니다.');
  }));

  preflight.addEventListener('click', () => void guarded(async () => {
    if (!projectReference) throw new Error('먼저 .xgwx 프로젝트를 선택하세요.');
    const source = await options.readWorkshop();
    const built = await buildPrewireCircuitV3(source, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = await controller.preflight({
      workshop: built.document,
      projectReference,
      userConfirmedProjectLoaded: declaration.checked,
      buildIssues: built.issues,
    });
    workingDocumentHash = result.ready ? built.document.hash : null;
    options.setStatus(result.ready
      ? `XG-SIM 사전 점검 준비 완료 · revision ${built.document.revision} · 실제 시험 전용`
      : `XG-SIM 사전 점검 BLOCKED · ${result.issues.map((issue) => issue.code).join(', ')}`);
  }));

  runTest.addEventListener('click', () => void guarded(async () => {
    if (!projectReference) throw new Error('프로젝트 참조가 없습니다.');
    const source = await options.readWorkshop();
    const built = await buildPrewireCircuitV3(source, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    if (built.document.hash !== workingDocumentHash) {
      await controller.markStale('기능시험 시작 전 문서 해시가 변경되었습니다.');
      throw new Error('STALE · 사전 점검을 다시 실행하세요.');
    }
    steps.replaceChildren();
    latestReport = null;
    await controller.connect(built.document);
    const result = await controller.runAutomaticTest(built.document);
    flushPendingStep();
    if (result.assessment) {
      latestReport = await createFunctionalSimulationReportV2({
        workshop: built.document,
        assessment: result.assessment,
        runtime: {
          provider: 'xgsim',
          xg5000Version: options.manifest.programCheck.xg5000Version,
          xgSimVersion: options.manifest.programCheck.xgSimVersion,
          hostProtocolVersion: 1,
          cpuModel: options.manifest.cpuModel,
          projectId: options.manifest.projectId,
          projectSha256: options.manifest.projectSha256,
          projectIdentityVerified: false,
        },
        bindings: options.manifest.bindings,
        behaviorProfiles: [definition.relayBehaviorProfile],
        frames: result.steps.map((step) => step.frame),
        unsupportedChecks: [
          'loaded-project-identity-proof',
          ...definition.relayBehaviorProfile.unsupportedBehaviors,
        ],
        diagnosticOutcome: result.outcome,
        steps: result.steps.map((step) => ({
          id: step.id,
          frameNumber: step.frame.frameNumber,
          passed: step.passed,
          issueCodes: step.issueCodes,
        })),
        projectDeclaration: { reference: projectReference, userConfirmedLoaded: declaration.checked },
        safeStop: result.safeStop,
      });
    }
    options.onResult?.(result, projectReference);
    options.setStatus(`${result.outcome} · 형식 판정 ${result.assessment?.status ?? 'BLOCKED'} · ${result.assessment?.issueCodes.join(', ') || '진단 오류 없음'}`);
  }));

  pause.addEventListener('click', () => void controller.pause());
  safeStop.addEventListener('click', () => void controller.safeStop('user-stop'));
  downloadReport.addEventListener('click', () => {
    if (!latestReport) return;
    options.downloadReport(latestReport, `xgsim-roundtrip-r${latestReport.workshop.revision}.json`);
    options.setStatus(`${latestReport.diagnosticOutcome} 진단 JSON 저장 · 형식 판정 ${latestReport.classification}`);
  });

  const disconnect = async (): Promise<void> => {
    if (['disconnected', 'safe-stopped'].includes(controller.snapshot.state)) return;
    await controller.safeStop('window-close');
  };
  const markStale = async (reason: string): Promise<void> => {
    workingDocumentHash = null;
    if (!['disconnected', 'safe-stopped', 'stale'].includes(controller.snapshot.state)) await controller.markStale(reason);
  };
  window.addEventListener('pagehide', () => { void disconnect(); }, { once: true });

  root.append(heading, explanation, project, declarationLabel, actions, state, live, path, steps);
  refreshButtons();
  return { element: root, markStale, disconnect };
}
