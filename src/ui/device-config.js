(function initDeviceConfig(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PLCTrainerDeviceConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDeviceConfig(root) {
  'use strict';

  let modal = null;
  let keyHandler = null;

  const toNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const escapeText = value => String(value == null ? '' : value);
  const isRackCpu = definition => !!(definition?.rackCpu || definition?.rack?.role === 'host');
  const isRackModule = definition => !!(definition?.rackModule || definition?.rack?.role === 'module');
  const isDrive = (device, definition) => device?.type === 'IG5A' || definition?.driveModel === 'ig5a' || /iG5A/i.test(definition?.label || '');
  const isConfigurable = (device, definition) => !!(
    isRackCpu(definition) || isRackModule(definition) || definition?.analogChannels?.length ||
    definition?.sensorKind || definition?.rs485Pairs?.length || definition?.rs485BusPorts?.length ||
    definition?.modbusDefaults || isDrive(device, definition)
  );

  function element(tag, options = {}, children = []) {
    const node = root.document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = escapeText(options.text);
    if (options.type) node.type = options.type;
    if (options.name) node.name = options.name;
    if (options.value != null) node.value = escapeText(options.value);
    if (options.min != null) node.min = escapeText(options.min);
    if (options.max != null) node.max = escapeText(options.max);
    if (options.step != null) node.step = escapeText(options.step);
    if (options.disabled != null) node.disabled = !!options.disabled;
    if (options.checked != null) node.checked = !!options.checked;
    if (options.title) node.title = options.title;
    for (const [key, value] of Object.entries(options.dataset || {})) node.dataset[key] = escapeText(value);
    for (const child of Array.isArray(children) ? children : [children]) if (child) node.appendChild(typeof child === 'string' ? root.document.createTextNode(child) : child);
    return node;
  }
  function option(value, label, selected = false) {
    const node = element('option', { value, text: label });
    node.selected = !!selected;
    return node;
  }
  function field(label, input, note) {
    const row = element('label');
    row.appendChild(element('span', { text: label }));
    row.appendChild(input);
    if (note) {
      const help = element('div', { className: 'config-note', text: note });
      help.style.gridColumn = '1 / -1';
      row.appendChild(help);
    }
    return row;
  }
  function fieldset(title) {
    const set = element('fieldset');
    set.appendChild(element('legend', { text: title }));
    return set;
  }
  function selectInput(name, values, current) {
    const select = element('select', { name });
    for (const item of values) {
      const value = typeof item === 'object' ? item.value : item;
      const label = typeof item === 'object' ? item.label : item;
      select.appendChild(option(value, label, String(value) === String(current)));
    }
    return select;
  }
  function query(container, name) {
    return container.querySelector(`[name="${name}"]`);
  }
  function readNumber(container, name, fallback) {
    return toNumber(query(container, name)?.value, fallback);
  }
  function normalizeRuntime(device) {
    if (!device.runtime || typeof device.runtime !== 'object') device.runtime = {};
    return device.runtime;
  }

  function rackSection(context) {
    const { device, definition, assignment } = context;
    if (!isRackCpu(definition) && !isRackModule(definition)) return null;
    const cpu = isRackCpu(definition);
    const set = fieldset(cpu ? 'PLC 베이스 · XG5000 P 주소' : '증설 랙 · 슬롯 · XG5000 P 주소');
    const currentRack = assignment?.rackId || device.runtime?.rack?.rackId || device.rackId || device.rackHostId || '';
    const currentSlot = cpu ? 0 : (assignment?.slot ?? device.runtime?.rack?.slot ?? device.slot ?? device.rackSlot ?? 0);
    const rackId = element('input', { name: 'rackId', value: currentRack, disabled: cpu, title: cpu ? 'CPU 자신의 장비 ID가 랙 ID입니다.' : '비워두면 같은 레일의 가까운 호환 CPU에 자동 장착됩니다.' });
    const slot = element('input', { type: 'number', name: 'rackSlot', value: currentSlot, min: 0, max: definition.rack?.maxSlots || 32, step: 1, disabled: cpu });
    set.appendChild(field('랙/CPU 장비 ID', rackId, cpu ? 'CPU는 자체적으로 BASE/Slot 0입니다.' : '빈칸은 자동 CPU 선택입니다.'));
    set.appendChild(field('슬롯 번호', slot, cpu ? 'CPU 입력 P0000~P001F, 출력 P0020~P003F' : '0은 자동 배정, 1 이상은 고정 슬롯입니다. 각 XGB 증설 슬롯은 64점(P 주소 4워드)을 점유합니다.'));
    const preview = assignment?.pRange || device.ioBinding?.pRange || (cpu ? 'P0000~P003F' : 'CPU에 장착 후 계산');
    set.appendChild(field('현재 주소 범위', element('input', { value: preview, disabled: true }), assignment?.uPrefix ? `특수 모듈 베이스: ${assignment.uPrefix}` : '디지털 단자는 해당 범위 안에서 단자별 P 주소가 계산됩니다.'));
    return set;
  }

  function analogSection(context) {
    const { device, definition, analogApi } = context;
    if (!definition?.analogChannels?.length) return null;
    analogApi?.ensureDeviceRuntime?.(device, definition);
    const set = fieldset('아날로그 채널 · RAW · 공학값');
    const rangeKeys = Object.keys(analogApi?.RANGE_TABLE || { '0~10V': {}, '4~20mA': {} });
    const dataTypes = Object.keys(analogApi?.DATA_TYPES || { '0~4000': {}, '0~16000': {} });
    for (const channel of definition.analogChannels) {
      const key = String(channel.channel);
      const config = device.runtime?.analog?.channels?.[key] || {};
      const ranges = channel.ranges?.length ? channel.ranges : [channel.range || config.range || rangeKeys[0]];
      const card = element('div', { className: 'config-channel', dataset: { channel: key } });
      card.appendChild(element('b', { text: `CH${key} · ${String(channel.direction || 'input').toUpperCase()} · ${channel.pos}/${channel.neg}` }));
      card.appendChild(field('입출력 범위', selectInput(`analog-${key}-range`, ranges, config.range || ranges[0])));
      card.appendChild(field('RAW 형식', selectInput(`analog-${key}-dataType`, dataTypes, config.dataType || channel.dataType || dataTypes[0])));
      card.appendChild(field('공학값 최소', element('input', { type: 'number', name: `analog-${key}-min`, value: config.engineeringMin ?? 0, step: 'any' })));
      card.appendChild(field('공학값 최대', element('input', { type: 'number', name: `analog-${key}-max`, value: config.engineeringMax ?? 100, step: 'any' })));
      card.appendChild(field('현재/발생 공학값', element('input', { type: 'number', name: `analog-${key}-value`, value: config.engineeringValue ?? 50, step: 'any' }), ['source', 'output', 'sensor'].includes(channel.direction) ? '시뮬레이션에서 실제 전압·전류로 변환됩니다.' : '입력 채널에서는 배선된 신호원의 값으로 갱신됩니다.'));
      card.appendChild(field('단위', element('input', { name: `analog-${key}-unit`, value: config.unit || '%' })));
      set.appendChild(card);
    }
    return set;
  }

  function sensorSection(context) {
    const { device, definition, analogApi } = context;
    if (!definition?.sensorKind) return null;
    const sensor = analogApi?.ensureSensorRuntime?.(device, definition.sensorKind) || (normalizeRuntime(device).sensor ||= { kind: definition.sensorKind });
    const set = fieldset('현장 센서 상태');
    const kind = String(definition.sensorKind).toUpperCase();
    if (['RTD', 'THERMOCOUPLE', 'TEMP_HUMIDITY'].includes(kind)) {
      set.appendChild(field('온도 (°C)', element('input', { type: 'number', name: 'sensorTemperature', value: sensor.temperatureC ?? 25, step: 0.1 })));
    }
    if (kind === 'TEMP_HUMIDITY') {
      set.appendChild(field('상대습도 (%RH)', element('input', { type: 'number', name: 'sensorHumidity', value: sensor.humidityRH ?? 50, min: 0, max: 100, step: 0.1 })));
    }
    if (kind === 'PRESSURE' || kind === 'GENERIC') {
      const first = device.runtime?.analog?.channels?.['0'];
      set.appendChild(field('프로세스 값', element('input', { type: 'number', name: 'sensorProcess', value: first?.engineeringValue ?? sensor.processValue ?? 50, step: 'any' }), first?.unit ? `단위: ${first.unit}. 아날로그 CH0 발생값과 동기화됩니다.` : '아날로그 발생값과 동기화됩니다.'));
    }
    set.appendChild(field('센서 단선', element('input', { type: 'checkbox', name: 'sensorWireBreak', checked: !!sensor.wireBreak }), '체크하면 RTD/열전대/아날로그 신호가 wire-break 오류로 처리됩니다.'));
    return set;
  }

  function modbusSection(context) {
    const { device, definition, modbusApi } = context;
    if (!definition?.modbusDefaults && !definition?.rs485Pairs?.length && !definition?.rs485BusPorts?.length) return null;
    const config = modbusApi?.settings?.(device, definition) || device.runtime?.modbus || definition.modbusDefaults || {};
    const set = fieldset('RS-485 · Modbus RTU');
    set.appendChild(field('Modbus 사용', element('input', { type: 'checkbox', name: 'modbusEnabled', checked: !!config.enabled })));
    set.appendChild(field('역할', selectInput('modbusRole', [
      { value: 'none', label: '사용 안 함' }, { value: 'master', label: '마스터' }, { value: 'slave', label: '슬레이브' }, { value: 'monitor', label: '모니터' }
    ], config.role || 'slave')));
    set.appendChild(field('국번', element('input', { type: 'number', name: 'modbusAddress', value: config.address ?? config.slaveId ?? 1, min: 1, max: 247, step: 1 })));
    set.appendChild(field('보드레이트', selectInput('modbusBaud', (modbusApi?.BAUD_RATES || [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]), config.baudRate || 9600)));
    set.appendChild(field('데이터 비트', selectInput('modbusDataBits', [7, 8], config.dataBits || 8)));
    set.appendChild(field('패리티', selectInput('modbusParity', ['none', 'even', 'odd'], config.parity || 'none')));
    set.appendChild(field('정지 비트', selectInput('modbusStopBits', [1, 2], config.stopBits || 1)));
    set.appendChild(field('배선 모드', selectInput('modbusMode', [{ value: '2wire', label: 'RS-485 2선식' }, { value: '4wire', label: 'RS-422/485 4선식' }], config.mode || '2wire')));
    set.appendChild(field('종단저항 사용', element('input', { type: 'checkbox', name: 'modbusTermination', checked: !!config.termination }), '멀티드롭 버스의 양 끝 장비에만 적용하는 것이 원칙입니다.'));
    if (definition?.rs485BusPorts?.some(port => port.requireBridgeIn2Wire)) set.appendChild(element('div', { className: 'config-note', text: 'XBL-C41A의 2선식 구성은 TX+/RX+와 TX−/RX−를 각각 실제 배선으로 브리지해야 READY가 됩니다.' }));
    return set;
  }

  function driveSection(context) {
    const { device, definition, driveApi } = context;
    if (!isDrive(device, definition)) return null;
    const params = driveApi?.ensureRuntime?.(device) || device.runtime?.drive || {};
    const set = fieldset('iG5A 인버터 운전 모델');
    set.appendChild(field('지령 주파수 (Hz)', element('input', { type: 'number', name: 'driveTarget', value: params.targetHz ?? 60, min: 0, max: 400, step: 0.1 })));
    set.appendChild(field('최대 주파수 (Hz)', element('input', { type: 'number', name: 'driveMax', value: params.maxHz ?? 60, min: 40, max: 400, step: 0.1 })));
    set.appendChild(field('가속 시간 (s)', element('input', { type: 'number', name: 'driveAccel', value: params.accelSec ?? 5, min: 0.1, max: 6000, step: 0.1 })));
    set.appendChild(field('감속 시간 (s)', element('input', { type: 'number', name: 'driveDecel', value: params.decelSec ?? 10, min: 0.1, max: 6000, step: 0.1 })));
    set.appendChild(field('모터 극수', selectInput('drivePoles', [2, 4, 6, 8, 10, 12], params.motorPoles ?? 4)));
    set.appendChild(field('정격 전류 (A)', element('input', { type: 'number', name: 'driveCurrent', value: params.ratedCurrentA ?? 2.5, min: 0.01, max: 1000, step: 0.01 })));
    set.appendChild(field('운전 지령원', selectInput('driveSource', [
      { value: 'terminal', label: '단자 P1/P2 (v2.4 지원)' }
    ], 'terminal'), 'v2.4에서는 P1/P2 접점으로 정·역운전을 판정하고, 위 지령 주파수 설정값으로 가감속을 계산합니다. 키패드·아날로그·RS-485 지령은 다음 연동 단계에서 구현합니다.'));
    return set;
  }

  function save(context, box) {
    const { device, definition, analogApi, modbusApi, driveApi } = context;
    const runtime = normalizeRuntime(device);

    if (isRackModule(definition)) {
      runtime.rack ||= {};
      const rackId = query(box, 'rackId')?.value.trim();
      const slot = Math.trunc(readNumber(box, 'rackSlot', 0));
      if (rackId) runtime.rack.rackId = rackId; else delete runtime.rack.rackId;
      if (slot > 0) runtime.rack.slot = slot; else delete runtime.rack.slot;
      device.rackId = rackId || undefined;
      device.rackHostId = rackId || undefined;
      device.slot = slot > 0 ? slot : undefined;
      device.rackSlot = slot > 0 ? slot : undefined;
    }

    if (definition?.analogChannels?.length) {
      analogApi?.ensureDeviceRuntime?.(device, definition);
      runtime.analog ||= { channels: {} };
      runtime.analog.channels ||= {};
      for (const channel of definition.analogChannels) {
        const key = String(channel.channel);
        const config = runtime.analog.channels[key] ||= {};
        config.range = query(box, `analog-${key}-range`)?.value || config.range;
        config.dataType = query(box, `analog-${key}-dataType`)?.value || config.dataType;
        config.engineeringMin = readNumber(box, `analog-${key}-min`, config.engineeringMin ?? 0);
        config.engineeringMax = readNumber(box, `analog-${key}-max`, config.engineeringMax ?? 100);
        config.engineeringValue = readNumber(box, `analog-${key}-value`, config.engineeringValue ?? 50);
        config.unit = query(box, `analog-${key}-unit`)?.value.trim() || config.unit || '%';
      }
      device.analogConfig = Object.fromEntries(Object.entries(runtime.analog.channels).map(([key, value]) => [key, { ...value }]));
    }

    if (definition?.sensorKind) {
      const sensor = analogApi?.ensureSensorRuntime?.(device, definition.sensorKind) || (runtime.sensor ||= { kind: definition.sensorKind });
      const temp = query(box, 'sensorTemperature');
      const humidity = query(box, 'sensorHumidity');
      const process = query(box, 'sensorProcess');
      const wireBreak = query(box, 'sensorWireBreak');
      if (temp) sensor.temperatureC = toNumber(temp.value, sensor.temperatureC ?? 25);
      if (humidity) sensor.humidityRH = Math.min(100, Math.max(0, toNumber(humidity.value, sensor.humidityRH ?? 50)));
      if (process) {
        sensor.processValue = toNumber(process.value, sensor.processValue ?? 50);
        if (runtime.analog?.channels?.['0']) runtime.analog.channels['0'].engineeringValue = sensor.processValue;
      }
      sensor.wireBreak = !!wireBreak?.checked;
      device.temperatureC = sensor.temperatureC;
      device.humidityRh = sensor.humidityRH;
    }

    if (definition?.modbusDefaults || definition?.rs485Pairs?.length || definition?.rs485BusPorts?.length) {
      const raw = {
        enabled: !!query(box, 'modbusEnabled')?.checked,
        role: query(box, 'modbusRole')?.value || 'none',
        address: readNumber(box, 'modbusAddress', 1),
        baudRate: readNumber(box, 'modbusBaud', 9600),
        dataBits: readNumber(box, 'modbusDataBits', 8),
        parity: query(box, 'modbusParity')?.value || 'none',
        stopBits: readNumber(box, 'modbusStopBits', 1),
        mode: query(box, 'modbusMode')?.value || '2wire',
        termination: !!query(box, 'modbusTermination')?.checked
      };
      runtime.modbus = modbusApi?.normalizeConfig?.(raw, definition.modbusDefaults || {}) || raw;
      device.modbus = { ...runtime.modbus };
    }

    if (isDrive(device, definition)) {
      const raw = {
        targetHz: readNumber(box, 'driveTarget', 60), maxHz: readNumber(box, 'driveMax', 60),
        accelSec: readNumber(box, 'driveAccel', 5), decelSec: readNumber(box, 'driveDecel', 10),
        motorPoles: readNumber(box, 'drivePoles', 4), ratedCurrentA: readNumber(box, 'driveCurrent', 2.5),
        commandSource: query(box, 'driveSource')?.value || 'terminal'
      };
      runtime.drive = driveApi?.normalizeParams?.(raw) || raw;
      device.driveConfig = { commandHz: runtime.drive.targetHz, ...runtime.drive };
    }
  }

  function close() {
    if (keyHandler && root.document) root.document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    if (modal) modal.remove();
    modal = null;
  }

  function open(context = {}) {
    if (!root.document) throw new Error('Device configuration UI requires a DOM document.');
    const normalized = {
      ...context,
      devId: context.devId ?? context.deviceId ?? '',
      definition: context.definition ?? context.def
    };
    const { device, definition } = normalized;
    if (!device || !definition) throw new Error('Device and definition are required.');
    close();

    modal = element('div', { className: 'device-config-modal show' });
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `${definition.label || device.type} 장비 설정`);
    const box = element('div', { className: 'device-config-box' });
    box.appendChild(element('h3', { text: `⚙ ${definition.label || device.type} 장비 설정` }));
    box.appendChild(element('div', { className: 'config-note', text: `장비 ID: ${context.deviceId || context.devId || ''} · 타입: ${device.type || ''}` }));

    const sections = [rackSection(context), analogSection(context), sensorSection(context), modbusSection(context), driveSection(context)].filter(Boolean);
    if (!sections.length) box.appendChild(element('div', { className: 'config-note', text: '이 장비에는 변경 가능한 런타임 설정이 없습니다.' }));
    else for (const section of sections) box.appendChild(section);

    const actions = element('div', { className: 'device-config-actions' });
    const cancel = element('button', { type: 'button', text: '취소' });
    const apply = element('button', { type: 'button', className: 'primary', text: '저장' });
    cancel.addEventListener('click', close);
    apply.addEventListener('click', () => {
      save(normalized, box);
      if (typeof normalized.onSave === 'function') normalized.onSave(device);
      close();
    });
    actions.append(cancel, apply);
    box.appendChild(actions);
    modal.appendChild(box);
    root.document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    keyHandler = event => { if (event.key === 'Escape') close(); };
    root.document.addEventListener('keydown', keyHandler);
    const focus = box.querySelector('input:not([disabled]),select:not([disabled]),button');
    focus?.focus?.();
    return modal;
  }

  return { version: '1.0.0', isConfigurable, open, close, save };
});
