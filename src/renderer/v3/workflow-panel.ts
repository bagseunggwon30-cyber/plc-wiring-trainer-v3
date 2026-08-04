import {
  type Earthing0vPePolicy,
  type Ig5aControlPowerStateV3,
  type Ig5aInputLogicV3,
  type PhaseSequenceV3Workflow,
  type Rs485ProtocolV3,
  type Rs485WorkflowSetting,
  type SourceSystemSelection,
  type V3WorkflowState,
  type XbfChannelIdV3,
  type XbfChannelWorkflowSetting,
} from './workflow-state';

export interface V3WorkflowDevice {
  id: string;
  label: string;
  profileId: string;
}

export interface V3WorkflowConductor {
  id: string;
  label: string;
  wireNumber?: string;
  gauge?: string;
  color?: string;
}

export interface V3WorkflowPanelOptions {
  document?: Document;
  state: V3WorkflowState;
  devices: readonly V3WorkflowDevice[];
  conductors: readonly V3WorkflowConductor[];
  onChange(state: V3WorkflowState): void;
  onLoadAcademyTemplate?(): void;
}

const SOURCE_SYSTEMS: readonly SourceSystemSelection[] = [
  { id: 'ac-1ph-220v', label: 'AC 1Φ 220 V / L-N-PE' },
  { id: 'ac-3ph-220v', label: 'AC 3Φ 220 V / L1-L2-L3-PE' },
  { id: 'ac-3ph-380-220v', label: 'AC 3Φ 380/220 V / L1-L2-L3-N-PE' },
  { id: 'dc-24v-isolated', label: 'DC 24 V 절연 전원 / +24V-0V' },
];

const EARTHING_OPTIONS: readonly { value: Earthing0vPePolicy; label: string }[] = [
  { value: 'PE_SEPARATE_0V_FLOATING', label: 'PE와 0V 분리, 0V 부동' },
  { value: 'PE_0V_SINGLE_POINT_BOND', label: 'PE-0V 단일점 본딩' },
  { value: 'SITE_DEFINED_BONDING', label: '현장 도면 본딩 규칙 적용' },
];

const REVIEW_TEMPLATES = [
  ['control-panel-prewire', '제어반 사전 결선 검토'],
  ['field-io-prewire', '필드 I/O 사전 결선 검토'],
  ['academy-exp2-md02', '학원 eXP2·XBC·MD02 진단'],
] as const;
const XBF_CHANNELS: readonly XbfChannelIdV3[] = ['AI0', 'AI1', 'AO0', 'AO1'];
const XBF_RANGES = ['1-5V', '0-5V', '0-10V', '4-20mA', '0-20mA'] as const;

function defaultXbfChannel(): XbfChannelWorkflowSetting {
  return { enabled: false, selector: null, parameterRange: null };
}

function cloneState(state: V3WorkflowState): V3WorkflowState {
  return {
    ...state,
    sourceSystem: state.sourceSystem && { ...state.sourceSystem },
    canvasUnitsPerMm: state.canvasUnitsPerMm,
    sourceProtection: { ...state.sourceProtection },
    reviewScope: { ...state.reviewScope, deviceIds: [...state.reviewScope.deviceIds] },
    designations: { ...state.designations },
    deviceSettings: structuredClone(state.deviceSettings),
    conductorSettings: structuredClone(state.conductorSettings),
    plcRuntime: state.plcRuntime === null ? null : structuredClone(state.plcRuntime),
  };
}

function labelledSelect(
  targetDocument: Document,
  label: string,
  ariaLabel: string,
): { field: HTMLLabelElement; select: HTMLSelectElement } {
  const field = targetDocument.createElement('label');
  field.className = 'v3-workflow-field';
  const caption = targetDocument.createElement('span');
  caption.textContent = label;
  const select = targetDocument.createElement('select');
  select.setAttribute('aria-label', ariaLabel);
  field.append(caption, select);
  return { field, select };
}

/** Native controls keep v3 workflow choices keyboard accessible while SVG stays legacy-owned. */
export function createV3WorkflowPanel(options: V3WorkflowPanelOptions): HTMLElement {
  const targetDocument = options.document ?? document;
  let state = cloneState(options.state);
  const panel = targetDocument.createElement('section');
  panel.id = 'v3-workflow-panel';
  panel.className = 'v3-workflow-panel';
  panel.setAttribute('aria-labelledby', 'v3-workflow-heading');

  const notify = (): void => options.onChange(cloneState(state));
  const heading = targetDocument.createElement('h3');
  heading.id = 'v3-workflow-heading';
  heading.textContent = 'v3 검토 조건';
  const description = targetDocument.createElement('p');
  description.className = 'v3-workflow-help';
  description.textContent = '공급계통, PE/0V 규칙, 실제 mm 환산, 템플릿과 검토 범위를 모두 명시해야 합니다.';
  panel.append(heading, description);
  if (options.onLoadAcademyTemplate) {
    const loadTemplate = targetDocument.createElement('button');
    loadTemplate.type = 'button';
    loadTemplate.id = 'load-academy-exp2-md02-template';
    loadTemplate.textContent = '학원 eXP2·MD02 시험 예제 불러오기';
    loadTemplate.addEventListener('click', options.onLoadAcademyTemplate);
    panel.appendChild(loadTemplate);
  }

  const source = labelledSelect(targetDocument, '공급 SourceSystem', '공급 SourceSystem 선택');
  const sourcePrompt = new Option('선택 필요', '');
  sourcePrompt.disabled = true;
  source.select.add(sourcePrompt);
  for (const item of SOURCE_SYSTEMS) source.select.add(new Option(item.label, item.id));
  source.select.value = state.sourceSystem?.id ?? '';
  source.select.required = true;
  source.select.addEventListener('change', () => {
    const choice = SOURCE_SYSTEMS.find((item) => item.id === source.select.value) ?? null;
    state.sourceSystem = choice && { ...choice };
    notify();
  });

  const earth = labelledSelect(targetDocument, 'PE / 0V 정책', 'PE 및 0V 정책 선택');
  const earthPrompt = new Option('선택 필요', '');
  earthPrompt.disabled = true;
  earth.select.add(earthPrompt);
  for (const item of EARTHING_OPTIONS) earth.select.add(new Option(item.label, item.value));
  earth.select.value = state.earthingPolicy ?? '';
  earth.select.required = true;
  earth.select.addEventListener('change', () => {
    state.earthingPolicy = earth.select.value ? earth.select.value as Earthing0vPePolicy : null;
    notify();
  });

  const template = labelledSelect(targetDocument, 'ReviewScope 템플릿', '검토 범위 템플릿 선택');
  const templatePrompt = new Option('선택 필요', '');
  templatePrompt.disabled = true;
  template.select.add(templatePrompt);
  for (const [id, label] of REVIEW_TEMPLATES) template.select.add(new Option(label, id));
  template.select.value = state.reviewScope.templateId ?? '';
  template.select.required = true;
  template.select.addEventListener('change', () => {
    state.reviewScope.templateId = template.select.value || null;
    notify();
  });
  const scaleField = targetDocument.createElement('label');
  scaleField.className = 'v3-workflow-field';
  const scaleCaption = targetDocument.createElement('span');
  scaleCaption.textContent = '물리 배치 환산 (캔버스 단위/mm)';
  const scale = targetDocument.createElement('input');
  scale.type = 'number';
  scale.min = '0.001';
  scale.step = 'any';
  scale.placeholder = '예: 2 (1 mm = 2 canvas units)';
  scale.value = state.canvasUnitsPerMm?.toString() ?? '';
  scale.required = true;
  scale.setAttribute('aria-label', '밀리미터당 캔버스 단위');
  scale.addEventListener('input', () => {
    const value = Number(scale.value);
    state.canvasUnitsPerMm = Number.isFinite(value) && value > 0 ? value : null;
    notify();
  });
  scaleField.append(scaleCaption, scale);
  const scaleHelp = targetDocument.createElement('small');
  scaleHelp.className = 'v3-workflow-help';
  scaleHelp.textContent = '값이 없으면 이격거리·레일 수용 검토는 근거 부족으로 BLOCKED 됩니다.';
  scaleField.appendChild(scaleHelp);
  panel.append(source.field, earth.field, scaleField, template.field);

  const protection = targetDocument.createElement('fieldset');
  protection.className = 'v3-workflow-scope';
  const protectionLegend = targetDocument.createElement('legend');
  protectionLegend.textContent = 'AC 보호협조 / 상순서';
  protection.appendChild(protectionLegend);
  const phase = labelledSelect(targetDocument, '3상 상순서', '3상 상순서 선택');
  phase.select.add(new Option('미기록', ''));
  phase.select.add(new Option('L1-L2-L3', 'L1-L2-L3'));
  phase.select.add(new Option('L1-L3-L2', 'L1-L3-L2'));
  phase.select.value = state.sourceProtection.phaseSequence ?? '';
  phase.select.addEventListener('change', () => {
    state.sourceProtection.phaseSequence = phase.select.value === 'L1-L2-L3' || phase.select.value === 'L1-L3-L2'
      ? phase.select.value as PhaseSequenceV3Workflow : null;
    notify();
  });
  const prospective = targetDocument.createElement('input');
  prospective.type = 'number'; prospective.min = '0'; prospective.step = 'any';
  prospective.placeholder = '예상 단락전류 A';
  prospective.value = state.sourceProtection.prospectiveShortCircuitCurrentA?.toString() ?? '';
  prospective.setAttribute('aria-label', '예상 단락전류 A');
  prospective.addEventListener('input', () => {
    const value = Number(prospective.value);
    state.sourceProtection.prospectiveShortCircuitCurrentA = Number.isFinite(value) && value > 0 ? value : null;
    notify();
  });
  const curve = targetDocument.createElement('input');
  curve.type = 'text'; curve.placeholder = '보호기기 차단곡선';
  curve.value = state.sourceProtection.protectiveDeviceCurve ?? '';
  curve.setAttribute('aria-label', '보호기기 차단곡선');
  curve.addEventListener('input', () => {
    state.sourceProtection.protectiveDeviceCurve = curve.value.trim() || null;
    notify();
  });
  protection.append(phase.field, prospective, curve);
  panel.appendChild(protection);

  const scope = targetDocument.createElement('fieldset');
  scope.className = 'v3-workflow-scope';
  const legend = targetDocument.createElement('legend');
  legend.textContent = 'ReviewScope 장비';
  scope.appendChild(legend);
  for (const device of options.devices) {
    const row = targetDocument.createElement('div');
    row.className = 'v3-workflow-device';
    const checkLabel = targetDocument.createElement('label');
    const checkbox = targetDocument.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.reviewScope.deviceIds.includes(device.id);
    checkbox.setAttribute('aria-label', `${device.label} 검토 범위 포함`);
    const name = targetDocument.createElement('span');
    name.textContent = device.label;
    checkLabel.append(checkbox, name);
    checkbox.addEventListener('change', () => {
      const selected = new Set(state.reviewScope.deviceIds);
      if (checkbox.checked) selected.add(device.id); else selected.delete(device.id);
      state.reviewScope.deviceIds = [...selected].sort();
      notify();
    });
    const designation = targetDocument.createElement('input');
    designation.type = 'text';
    designation.value = state.designations[device.id] ?? '';
    designation.placeholder = '설비 명칭 (예: PS1)';
    designation.setAttribute('aria-label', `${device.label} 설비 명칭`);
    designation.addEventListener('input', () => {
      const value = designation.value.trim();
      if (value) state.designations[device.id] = value; else delete state.designations[device.id];
      notify();
    });
    const orderCode = targetDocument.createElement('input');
    orderCode.type = 'text';
    orderCode.value = state.deviceSettings[device.id]?.orderCode ?? '';
    orderCode.placeholder = '전체 주문코드';
    orderCode.setAttribute('aria-label', `${device.label} 전체 주문코드`);
    orderCode.addEventListener('input', () => {
      const previous = state.deviceSettings[device.id] ?? { orderCode: null };
      state.deviceSettings[device.id] = { ...previous, orderCode: orderCode.value.trim() || null };
      notify();
    });
    row.append(checkLabel, designation, orderCode);
    scope.appendChild(row);

    if (device.profileId === 'ls-electric:xbf-ah04a') {
      const analog = targetDocument.createElement('fieldset');
      analog.className = 'v3-xbf-settings';
      const analogLegend = targetDocument.createElement('legend');
      analogLegend.textContent = `${device.label} 채널 스위치 / 파라미터`;
      analog.appendChild(analogLegend);
      const previous = state.deviceSettings[device.id] ?? { orderCode: null };
      const channels = previous.xbfChannels ?? Object.fromEntries(
        XBF_CHANNELS.map((channelId) => [channelId, defaultXbfChannel()]),
      ) as Record<XbfChannelIdV3, XbfChannelWorkflowSetting>;
      state.deviceSettings[device.id] = { ...previous, xbfChannels: channels };
      for (const channelId of XBF_CHANNELS) {
        const channel = channels[channelId];
        const channelRow = targetDocument.createElement('div');
        channelRow.className = 'v3-xbf-channel';
        const enabledLabel = targetDocument.createElement('label');
        const enabled = targetDocument.createElement('input');
        enabled.type = 'checkbox'; enabled.checked = channel.enabled;
        enabled.setAttribute('aria-label', `${channelId} 사용`);
        enabledLabel.append(enabled, targetDocument.createTextNode(channelId));
        const selector = targetDocument.createElement('select');
        selector.setAttribute('aria-label', `${channelId} 물리 V/I 스위치`);
        selector.add(new Option('스위치', '')); selector.add(new Option('V', 'V')); selector.add(new Option('I', 'I'));
        selector.value = channel.selector ?? '';
        const range = targetDocument.createElement('select');
        range.setAttribute('aria-label', `${channelId} 파라미터 범위`);
        range.add(new Option('범위', ''));
        for (const value of XBF_RANGES) range.add(new Option(value, value));
        range.value = channel.parameterRange ?? '';
        const update = (): void => {
          channels[channelId] = {
            enabled: enabled.checked,
            selector: selector.value === 'V' || selector.value === 'I' ? selector.value : null,
            parameterRange: XBF_RANGES.includes(range.value as typeof XBF_RANGES[number])
              ? range.value as typeof XBF_RANGES[number]
              : null,
          };
          notify();
        };
        enabled.addEventListener('change', update);
        selector.addEventListener('change', update);
        range.addEventListener('change', update);
        channelRow.append(enabledLabel, selector, range);
        analog.appendChild(channelRow);
      }
      scope.appendChild(analog);
    }
    if (device.profileId === 'ls-electric:sv-ig5a') {
      const inputLogic = labelledSelect(
        targetDocument,
        `${device.label} S8 입력 방식`,
        `${device.label} S8 NPN PNP 선택`,
      );
      inputLogic.select.add(new Option('실제 스위치 위치 선택', ''));
      inputLogic.select.add(new Option('NPN · 내부 24V · P→접점→CM', 'NPN_INTERNAL_24V'));
      inputLogic.select.add(new Option('PNP · 외부 +24V→접점→P / 0V→CM', 'PNP_EXTERNAL_24V'));
      inputLogic.select.value = state.deviceSettings[device.id]?.ig5aInputLogic ?? '';
      inputLogic.select.required = true;
      inputLogic.select.addEventListener('change', () => {
        const previous = state.deviceSettings[device.id] ?? { orderCode: null };
        const value = inputLogic.select.value;
        const ig5aInputLogic = value === 'NPN_INTERNAL_24V' || value === 'PNP_EXTERNAL_24V'
          ? value as Ig5aInputLogicV3
          : undefined;
        state.deviceSettings[device.id] = {
          ...previous,
          ...(ig5aInputLogic === undefined ? {} : { ig5aInputLogic }),
        };
        if (ig5aInputLogic === undefined) delete state.deviceSettings[device.id].ig5aInputLogic;
        notify();
      });
      const inputLogicHelp = targetDocument.createElement('small');
      inputLogicHelp.className = 'v3-workflow-help';
      inputLogicHelp.textContent = 'LS iG5A 사용자 매뉴얼 PDF p.25: 화면 추정이 아니라 장비 전면 S8의 실제 위치와 일치해야 합니다.';
      inputLogic.field.appendChild(inputLogicHelp);
      scope.appendChild(inputLogic.field);

      const controlPower = labelledSelect(
        targetDocument,
        `${device.label} 제어전원 상태`,
        `${device.label} 제어전원 상태 선택`,
      );
      controlPower.select.add(new Option('실제 전원 상태 선택', ''));
      controlPower.select.add(new Option('POWERED · 제어전원 정상 인가', 'POWERED'));
      controlPower.select.add(new Option('UNPOWERED · 무전원', 'UNPOWERED'));
      controlPower.select.value = state.deviceSettings[device.id]?.ig5aControlPowerState ?? '';
      controlPower.select.required = true;
      controlPower.select.addEventListener('change', () => {
        const previous = state.deviceSettings[device.id] ?? { orderCode: null };
        const value = controlPower.select.value;
        const ig5aControlPowerState = value === 'POWERED' || value === 'UNPOWERED'
          ? value as Ig5aControlPowerStateV3
          : undefined;
        state.deviceSettings[device.id] = {
          ...previous,
          ...(ig5aControlPowerState === undefined ? {} : { ig5aControlPowerState }),
        };
        if (ig5aControlPowerState === undefined) {
          delete state.deviceSettings[device.id].ig5aControlPowerState;
        }
        notify();
      });
      const controlPowerHelp = targetDocument.createElement('small');
      controlPowerHelp.className = 'v3-workflow-help';
      controlPowerHelp.textContent = 'P1–P8 입력 시험은 인버터 제어전원이 실제로 살아 있을 때만 유효합니다. 이 값은 연습용 상태 기록이며 정확 주문코드의 주회로 검증을 대신하지 않습니다.';
      controlPower.field.appendChild(controlPowerHelp);
      scope.appendChild(controlPower.field);
    }
    if (
      device.profileId === 'ls-electric:exp2-0700d'
      || device.profileId === 'ls-electric:xbc-dr32h'
      || device.profileId === 'generic:xy-md02'
    ) {
      const serial = targetDocument.createElement('fieldset');
      serial.className = 'v3-xbf-settings';
      const serialLegend = targetDocument.createElement('legend');
      serialLegend.textContent = `${device.label} RS485 실제 설정`;
      serial.appendChild(serialLegend);
      const previous = state.deviceSettings[device.id] ?? { orderCode: null };
      const defaults: Rs485WorkflowSetting = {
        port: device.profileId === 'ls-electric:exp2-0700d'
          ? 'COM1'
          : device.profileId === 'ls-electric:xbc-dr32h' ? 'BUILT_IN_CNET' : 'RS485',
        protocol: null,
        baudRate: null,
        dataBits: null,
        parity: null,
        stopBits: null,
        stationId: null,
      };
      const setting = previous.rs485 ?? defaults;
      state.deviceSettings[device.id] = { ...previous, rs485: setting };
      const port = targetDocument.createElement('select');
      port.setAttribute('aria-label', `${device.label} RS485 포트`);
      const ports = device.profileId === 'ls-electric:exp2-0700d'
        ? [['COM1', 'COM1 DB9 · pin 6(+), pin 1(-)'], ['COM3', 'COM3 RS422/485 단자']] as const
        : device.profileId === 'ls-electric:xbc-dr32h'
          ? [['BUILT_IN_CNET', '내장 485+/485-']] as const
          : [['RS485', 'A+/B-']] as const;
      for (const [value, label] of ports) port.add(new Option(label, value));
      port.value = setting.port ?? ports[0][0];

      const protocol = targetDocument.createElement('select');
      protocol.setAttribute('aria-label', `${device.label} RS485 프로토콜`);
      protocol.add(new Option('프로토콜 선택 필요', ''));
      if (device.profileId !== 'generic:xy-md02') protocol.add(new Option('XGB Cnet', 'XGB_CNET'));
      if (device.profileId === 'ls-electric:exp2-0700d') protocol.add(new Option('Modbus RTU Master', 'MODBUS_RTU_MASTER'));
      if (device.profileId === 'generic:xy-md02') protocol.add(new Option('Modbus RTU Slave', 'MODBUS_RTU_SLAVE'));
      protocol.value = setting.protocol ?? '';

      const baud = targetDocument.createElement('select');
      baud.setAttribute('aria-label', `${device.label} RS485 baud rate`);
      baud.add(new Option('baud rate', ''));
      for (const value of [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]) {
        baud.add(new Option(String(value), String(value)));
      }
      baud.value = setting.baudRate === null ? '' : String(setting.baudRate);

      const dataBits = targetDocument.createElement('select');
      dataBits.setAttribute('aria-label', `${device.label} RS485 data bits`);
      dataBits.add(new Option('data bits', ''));
      dataBits.add(new Option('7 bit', '7')); dataBits.add(new Option('8 bit', '8'));
      dataBits.value = setting.dataBits === null ? '' : String(setting.dataBits);

      const parity = targetDocument.createElement('select');
      parity.setAttribute('aria-label', `${device.label} RS485 parity`);
      parity.add(new Option('parity', ''));
      parity.add(new Option('None', 'NONE')); parity.add(new Option('Even', 'EVEN')); parity.add(new Option('Odd', 'ODD'));
      parity.value = setting.parity ?? '';

      const stopBits = targetDocument.createElement('select');
      stopBits.setAttribute('aria-label', `${device.label} RS485 stop bits`);
      stopBits.add(new Option('stop bits', ''));
      stopBits.add(new Option('1 bit', '1')); stopBits.add(new Option('2 bit', '2'));
      stopBits.value = setting.stopBits === null ? '' : String(setting.stopBits);

      const station = targetDocument.createElement('input');
      station.type = 'number'; station.min = '1'; station.max = '247'; station.placeholder = '국번';
      station.setAttribute('aria-label', `${device.label} Modbus 국번`);
      station.value = setting.stationId === null ? '' : String(setting.stationId);
      if (device.profileId !== 'generic:xy-md02') station.hidden = true;

      const updateSerial = (): void => {
        const latest = state.deviceSettings[device.id] ?? { orderCode: null };
        const selectedProtocol = protocol.value;
        const baudValue = Number(baud.value);
        const dataValue = Number(dataBits.value);
        const stopValue = Number(stopBits.value);
        const stationValue = Number(station.value);
        latest.rs485 = {
          port: port.value || null,
          protocol: selectedProtocol === 'XGB_CNET'
            || selectedProtocol === 'MODBUS_RTU_MASTER'
            || selectedProtocol === 'MODBUS_RTU_SLAVE'
            ? selectedProtocol as Rs485ProtocolV3
            : null,
          baudRate: Number.isFinite(baudValue) && baudValue > 0 ? baudValue : null,
          dataBits: dataValue === 7 || dataValue === 8 ? dataValue : null,
          parity: parity.value === 'NONE' || parity.value === 'EVEN' || parity.value === 'ODD' ? parity.value : null,
          stopBits: stopValue === 1 || stopValue === 2 ? stopValue : null,
          stationId: Number.isInteger(stationValue) && stationValue > 0 ? stationValue : null,
        };
        state.deviceSettings[device.id] = latest;
        notify();
      };
      for (const control of [port, protocol, baud, dataBits, parity, stopBits, station]) {
        control.addEventListener('change', updateSerial);
      }
      serial.append(port, protocol, baud, dataBits, parity, stopBits, station);
      const help = targetDocument.createElement('small');
      help.className = 'v3-workflow-help';
      help.textContent = device.profileId === 'ls-electric:exp2-0700d'
        ? 'COM1의 물리 극성은 공식 매뉴얼 기준 pin 6(+), pin 1(-)입니다. 실제 XP-Builder 설정도 동일하게 기록하세요.'
        : '통신 준비는 전원, A/B 두 가닥, 프로토콜과 모든 직렬 설정이 함께 맞을 때만 표시됩니다.';
      serial.appendChild(help);
      scope.appendChild(serial);
    }
    if (device.profileId === 'generic:prox-npn-3wire' || device.profileId === 'generic:prox-pnp-3wire') {
      const previous = state.deviceSettings[device.id] ?? { orderCode: null };
      const sensorState = targetDocument.createElement('label');
      sensorState.className = 'v3-workflow-field';
      const detected = targetDocument.createElement('input');
      detected.type = 'checkbox';
      detected.checked = previous.sensorDetected === true;
      detected.setAttribute('aria-label', `${device.label} 검출 출력 ON`);
      detected.addEventListener('change', () => {
        const latest = state.deviceSettings[device.id] ?? { orderCode: null };
        state.deviceSettings[device.id] = { ...latest, sensorDetected: detected.checked };
        notify();
      });
      sensorState.append(detected, targetDocument.createTextNode(' 검출 ON (BK 출력 시험)'));
      scope.appendChild(sensorState);
    }
    if (device.profileId === 'boundary:two-wire-current-transmitter') {
      const previous = state.deviceSettings[device.id] ?? { orderCode: null };
      const currentField = targetDocument.createElement('label');
      currentField.className = 'v3-workflow-field';
      const currentCaption = targetDocument.createElement('span');
      currentCaption.textContent = `${device.label} 시험 전류 (mA)`;
      const current = targetDocument.createElement('input');
      current.type = 'number';
      current.min = '4';
      current.max = '20';
      current.step = '0.1';
      current.value = String(previous.currentMilliamp ?? 12);
      current.setAttribute('aria-label', `${device.label} 시험 전류 mA`);
      current.addEventListener('input', () => {
        const value = Number(current.value);
        const latest = state.deviceSettings[device.id] ?? { orderCode: null };
        state.deviceSettings[device.id] = {
          ...latest,
          ...(Number.isFinite(value) && value > 0 ? { currentMilliamp: value } : {}),
        };
        notify();
      });
      currentField.append(currentCaption, current);
      scope.appendChild(currentField);
    }
  }
  panel.appendChild(scope);

  const conductors = targetDocument.createElement('fieldset');
  conductors.className = 'v3-workflow-scope';
  const conductorLegend = targetDocument.createElement('legend');
  conductorLegend.textContent = '전선 / 케이블 심선 정보';
  conductors.appendChild(conductorLegend);
  for (const conductor of options.conductors) {
    const setting = state.conductorSettings[conductor.id] ?? {
      cableId: null,
      core: null,
      wireNumber: conductor.wireNumber?.trim() || null,
      gauge: conductor.gauge?.trim() || null,
      color: conductor.color?.trim() || null,
      lengthMm: null,
      ferruleFrom: null,
      ferruleTo: null,
      lugFrom: null,
      lugTo: null,
      shielded: false,
      drain: false,
    };
    state.conductorSettings[conductor.id] = setting;
    const row = targetDocument.createElement('div');
    row.className = 'v3-conductor-row';
    const label = targetDocument.createElement('span'); label.textContent = conductor.label;
    row.appendChild(label);
    const addTextInput = (key: 'cableId' | 'core' | 'wireNumber' | 'gauge' | 'color' | 'ferruleFrom' | 'ferruleTo' | 'lugFrom' | 'lugTo', placeholder: string): void => {
      const input = targetDocument.createElement('input');
      input.type = 'text'; input.placeholder = placeholder; input.value = setting[key] ?? '';
      input.setAttribute('aria-label', `${conductor.label} ${placeholder}`);
      input.addEventListener('input', () => { setting[key] = input.value.trim() || null; notify(); });
      row.appendChild(input);
    };
    addTextInput('cableId', '케이블 ID');
    addTextInput('core', '심선');
    addTextInput('wireNumber', '선번');
    addTextInput('gauge', 'mm²/AWG');
    addTextInput('color', '선색');
    const length = targetDocument.createElement('input');
    length.type = 'number'; length.min = '0'; length.placeholder = '길이 mm';
    length.value = setting.lengthMm === null ? '' : String(setting.lengthMm);
    length.setAttribute('aria-label', `${conductor.label} 길이 mm`);
    length.addEventListener('input', () => {
      const value = Number(length.value); setting.lengthMm = Number.isFinite(value) && value > 0 ? value : null; notify();
    });
    row.appendChild(length);
    addTextInput('ferruleFrom', '시작 페룰');
    addTextInput('ferruleTo', '종단 페룰');
    addTextInput('lugFrom', '시작 러그');
    addTextInput('lugTo', '종단 러그');
    const addCheck = (key: 'shielded' | 'drain', labelText: string): void => {
      const label = targetDocument.createElement('label');
      const checkbox = targetDocument.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = setting[key];
      checkbox.setAttribute('aria-label', `${conductor.label} ${labelText}`);
      checkbox.addEventListener('change', () => { setting[key] = checkbox.checked; notify(); });
      label.append(checkbox, targetDocument.createTextNode(labelText)); row.appendChild(label);
    };
    addCheck('shielded', '실드');
    addCheck('drain', '드레인');
    conductors.appendChild(row);
  }
  panel.appendChild(conductors);
  return panel;
}
