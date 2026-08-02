import type { IoBindingV1, PlcRuntimeConfigurationV1 } from '../../domain/plc-runtime/io-binding';
import { XgSimRuntimeAdapter } from './xgsim-adapter';

export interface XgSimDiagnosticsPanel {
  readonly element: HTMLElement;
  disconnect(): Promise<void>;
  setConfiguration(configuration: PlcRuntimeConfigurationV1 | null): void;
}

export interface XgSimDiagnosticsPanelOptions {
  readonly initialConfiguration?: PlcRuntimeConfigurationV1 | null;
  readonly onConfigurationChange?: (configuration: PlcRuntimeConfigurationV1) => void;
}

function field(labelText: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, input);
  return label;
}

function textInput(value: string, ariaLabel: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.setAttribute('aria-label', ariaLabel);
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

function button(label: string): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button';
  result.textContent = label;
  return result;
}

function makeBinding(
  projectId: string,
  projectSha256: string,
  cpuModel: string,
  id: string,
  terminalId: string,
  address: string,
  direction: 'input' | 'output',
): IoBindingV1 {
  return {
    schemaVersion: 1,
    id,
    deviceInstanceId: 'plc1',
    terminalId,
    cpuModel,
    projectId,
    symbolName: id === 'diagnostic-input' ? 'XGSIM_DIAGNOSTIC_INPUT' : 'XGSIM_DIAGNOSTIC_OUTPUT',
    address,
    direction,
    dataType: 'BOOL',
    inverted: false,
    normalState: false,
    communicationLossState: false,
    access: { read: true, write: direction === 'input' },
    projectSha256,
  };
}

/**
 * An explicit transport diagnostic, not a SIL pass workflow. It never exposes
 * an output-write action and it does not infer a project hash or I/O address.
 */
export function createXgSimDiagnosticsPanel(options: XgSimDiagnosticsPanelOptions = {}): XgSimDiagnosticsPanel {
  const adapter = new XgSimRuntimeAdapter();
  let connected = false;
  const root = document.createElement('section');
  root.className = 'xgsim-diagnostics';
  root.setAttribute('aria-labelledby', 'xgsim-diagnostics-heading');
  const heading = document.createElement('h3');
  heading.id = 'xgsim-diagnostics-heading';
  heading.textContent = 'XG-SIM 공식 인터페이스 진단';
  const explanation = document.createElement('p');
  explanation.textContent = '로컬 시뮬레이터 전송 경로만 점검합니다. PLC 출력 쓰기는 금지되며, 이 결과만으로 SIL 또는 사전 결선 통과가 되지 않습니다.';

  const grid = document.createElement('div');
  grid.className = 'xgsim-diagnostics-grid';
  const cpu = textInput('XGB-XBCH', 'XG-SIM CPU 모델');
  const projectId = textInput('15번', 'XG5000 프로젝트 식별자');
  const projectHash = textInput('', 'XG5000 프로젝트 SHA-256');
  projectHash.placeholder = '열린 프로젝트를 닫은 뒤 계산한 SHA-256 64자리';
  const inputTerminal = textInput('P03', 'PLC 입력 단자 ID');
  const inputAddress = textInput('B0S00.IN03', 'XG-SIM 입력 채널');
  const outputTerminal = textInput('P21', 'PLC 출력 단자 ID');
  const outputAddress = textInput('B0S00.OUT01', 'XG-SIM 출력 채널');
  grid.append(
    field('CPU', cpu), field('프로젝트', projectId), field('프로젝트 SHA-256', projectHash),
    field('입력 단자', inputTerminal), field('입력 채널', inputAddress),
    field('출력 단자', outputTerminal), field('출력 채널', outputAddress),
  );

  const actions = document.createElement('div');
  actions.className = 'xgsim-diagnostics-actions';
  const probe = button('설치·채널 확인');
  const connect = button('명시 바인딩 연결');
  const inputOn = button('입력 ON');
  const inputOff = button('입력 OFF');
  const read = button('I/O 읽기');
  const disconnect = button('안전 해제');
  inputOn.disabled = true;
  inputOff.disabled = true;
  read.disabled = true;
  disconnect.disabled = true;
  actions.append(probe, connect, inputOn, inputOff, read, disconnect);
  const status = document.createElement('output');
  status.className = 'xgsim-diagnostics-status';
  status.setAttribute('aria-live', 'polite');
  status.textContent = window.WorkshopDesktop?.xgSim
    ? '미연결 · 프로젝트 해시는 자동 추측하지 않습니다.'
    : 'BLOCKED · XG-SIM 진단은 오프라인 Electron 앱에서만 사용할 수 있습니다.';
  if (!window.WorkshopDesktop?.xgSim) {
    probe.disabled = true;
    connect.disabled = true;
  }

  const setConnected = (value: boolean): void => {
    connected = value;
    inputOn.disabled = !value;
    inputOff.disabled = !value;
    read.disabled = !value;
    disconnect.disabled = !value;
    connect.disabled = value || !window.WorkshopDesktop?.xgSim;
  };
  const setConfiguration = (configuration: PlcRuntimeConfigurationV1 | null): void => {
    if (!configuration) {
      cpu.value = 'XGB-XBCH';
      projectId.value = '15번';
      projectHash.value = '';
      inputTerminal.value = 'P03';
      inputAddress.value = 'B0S00.IN03';
      outputTerminal.value = 'P21';
      outputAddress.value = 'B0S00.OUT01';
      return;
    }
    const input = configuration.bindings.find((binding) => binding.direction === 'input');
    const output = configuration.bindings.find((binding) => binding.direction === 'output');
    const identity = input ?? output;
    if (identity) {
      cpu.value = identity.cpuModel;
      projectId.value = identity.projectId;
      projectHash.value = identity.projectSha256;
    }
    if (input) { inputTerminal.value = input.terminalId; inputAddress.value = input.address; }
    if (output) { outputTerminal.value = output.terminalId; outputAddress.value = output.address; }
  };
  setConfiguration(options.initialConfiguration ?? null);
  const run = async (action: () => Promise<void>): Promise<void> => {
    for (const control of [probe, connect, inputOn, inputOff, read, disconnect]) control.disabled = true;
    try {
      await action();
    } catch (error) {
      status.textContent = `BLOCKED · ${error instanceof Error ? error.message : String(error)}`;
      setConnected(false);
      return;
    }
    setConnected(connected);
  };

  probe.addEventListener('click', () => void run(async () => {
    const result = await adapter.probe({ base: 0, slot: 0 });
    status.textContent = result.status === 'available'
      ? `사용 가능 · 채널 ${result.channelNames.length}개 · 출력 쓰기 지원 ${result.capabilities.supportsOutputWrite ? '예' : '아니오'}`
      : `BLOCKED · ${result.reason ?? 'XG-SIM을 시작하고 프로젝트 시뮬레이터를 확인하세요.'}`;
  }));

  connect.addEventListener('click', () => void run(async () => {
    const bindings = [
      makeBinding(projectId.value.trim(), projectHash.value.trim(), cpu.value.trim(), 'diagnostic-input', inputTerminal.value.trim(), inputAddress.value.trim(), 'input'),
      makeBinding(projectId.value.trim(), projectHash.value.trim(), cpu.value.trim(), 'diagnostic-output', outputTerminal.value.trim(), outputAddress.value.trim(), 'output'),
    ];
    const connection = await adapter.connect({
      sessionNonce: globalThis.crypto.randomUUID().replaceAll('-', ''),
      cpuModel: cpu.value.trim(),
      projectId: projectId.value.trim(),
      projectSha256: projectHash.value.trim(),
      base: 0,
      slot: 0,
      bindings,
    });
    options.onConfigurationChange?.({ schemaVersion: 1, adapter: 'xgsim', pollIntervalMs: 20, bindings });
    connected = true;
    status.textContent = connection.projectIdentityVerified
      ? `연결됨 · ${connection.sessionId} · 프로젝트 일치 확인 · 출력은 읽기 전용`
      : `연결됨(진단 전용) · ${connection.sessionId} · 로드된 프로젝트 일치 여부는 공식 API에서 확인 불가 · 출력은 읽기 전용`;
  }));

  const writeInput = (value: boolean): void => {
    void run(async () => {
      await adapter.writeInputImage({ values: { 'diagnostic-input': value } });
      const snapshot = await adapter.readSnapshot();
      status.textContent = `입력 ${value ? 'ON' : 'OFF'} · 출력 ${snapshot.outputs['diagnostic-output'] === true ? 'ON' : 'OFF'} · sequence ${snapshot.sequence}`;
    });
  };
  inputOn.addEventListener('click', () => writeInput(true));
  inputOff.addEventListener('click', () => writeInput(false));
  read.addEventListener('click', () => void run(async () => {
    const snapshot = await adapter.readSnapshot();
    status.textContent = `입력 ${snapshot.inputs['diagnostic-input'] === true ? 'ON' : 'OFF'} · 출력 ${snapshot.outputs['diagnostic-output'] === true ? 'ON' : 'OFF'} · sequence ${snapshot.sequence}`;
  }));
  const disconnectSafely = async (): Promise<void> => {
    if (!connected) return;
    await adapter.disconnect();
    connected = false;
    status.textContent = '안전 해제됨 · 허용된 가상 입력을 OFF로 복귀했습니다.';
    setConnected(false);
  };
  disconnect.addEventListener('click', () => void run(disconnectSafely));
  window.addEventListener('pagehide', () => { void disconnectSafely(); }, { once: true });

  root.append(heading, explanation, grid, actions, status);
  return { element: root, disconnect: disconnectSafely, setConfiguration };
}
