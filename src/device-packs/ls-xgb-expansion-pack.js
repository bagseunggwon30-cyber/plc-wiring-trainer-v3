(function (root) {
  'use strict';

  const registry = root.PLCDevicePacks;
  if (!registry) throw new Error('PLCDevicePacks registry must be loaded first');

  const GPT = 'assets/devices/gpt/';
  const EXPANSION = 'assets/devices/gpt-expansion/';
  const HARDWARE_MANUAL = 'pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf';
  const ANALOG_MANUAL = 'pdf/03_LS_XGB_Analog_Manual_KR.pdf';

  const hex2 = value => value.toString(16).toUpperCase().padStart(2, '0');
  const row = (ids, y, x0, x1, side, metadata = {}) => ids.map((id, index) => ({
    id,
    x: +(ids.length === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * index) / (ids.length - 1)).toFixed(1),
    y,
    side,
    label: metadata[id]?.label || id,
    pol: metadata[id]?.pol || 'NEUTRAL',
    r: metadata[id]?.r || 6.2,
    forceLabel: true,
  }));
  const column = (ids, metadata, width, height) => {
    const x = +(width * 0.32).toFixed(1);
    const y0 = +(height * 0.282).toFixed(1);
    const y1 = +(height * 0.896).toFixed(1);
    const step = ids.length > 1 ? (y1 - y0) / (ids.length - 1) : 0;
    return ids.map((id, index) => ({
      id,
      x,
      y: +(y0 + index * step).toFixed(1),
      side: 'L',
      label: metadata[id]?.label || id,
      pol: metadata[id]?.pol || 'NEUTRAL',
      r: ids.length > 14 ? 5.4 : 6.4,
      forceLabel: true,
      manualOrder: index + 1,
    }));
  };

  const dc32Terminals = [];
  for (let index = 0; index < 16; index += 1) {
    dc32Terminals.push({
      id: `I${hex2(index)}`,
      x: 18,
      y: +(28 + index * 12.1).toFixed(1),
      side: 'L',
      label: hex2(index),
      pol: 'DI',
      r: 5.5,
      forceLabel: true,
      pin: `B${20 - index}`,
    });
    dc32Terminals.push({
      id: `I${hex2(index + 16)}`,
      x: 402,
      y: +(28 + index * 12.1).toFixed(1),
      side: 'R',
      label: hex2(index + 16),
      pol: 'DI',
      r: 5.5,
      forceLabel: true,
      pin: `A${20 - index}`,
    });
  }
  dc32Terminals.push(
    { id: 'COM-B1', x: 18, y: 226, side: 'L', label: 'COM', pol: 'IO-COM', r: 5.5, forceLabel: true, pin: 'B02' },
    { id: 'COM-B2', x: 18, y: 242, side: 'L', label: 'COM', pol: 'IO-COM', r: 5.5, forceLabel: true, pin: 'B01' },
    { id: 'COM-A1', x: 402, y: 226, side: 'R', label: 'COM', pol: 'IO-COM', r: 5.5, forceLabel: true, pin: 'A02' },
    { id: 'COM-A2', x: 402, y: 242, side: 'R', label: 'COM', pol: 'IO-COM', r: 5.5, forceLabel: true, pin: 'A01' },
  );

  const relayTop = Array.from({ length: 8 }, (_, index) => `Q${index.toString(16).toUpperCase()}`).concat('COM0');
  const relayBottom = Array.from({ length: 8 }, (_, index) => `Q${(index + 8).toString(16).toUpperCase()}`).concat('COM1');
  const relayMetadata = { COM0: { label: 'COM', pol: 'SW' }, COM1: { label: 'COM', pol: 'SW' } };
  for (const id of [...relayTop, ...relayBottom]) {
    if (!relayMetadata[id]) relayMetadata[id] = { label: id.slice(1), pol: 'DO' };
  }

  const sinkTop = Array.from({ length: 8 }, (_, index) => `Q${index.toString(16).toUpperCase()}`);
  const sinkBottom = Array.from({ length: 8 }, (_, index) => `Q${(index + 8).toString(16).toUpperCase()}`).concat(['PWR24', 'COM']);
  const sinkMetadata = { PWR24: { label: 'DC12/24V', pol: 'DC+' }, COM: { label: 'COM/0V', pol: 'DC-' } };
  for (const id of [...sinkTop, ...sinkBottom]) {
    if (!sinkMetadata[id]) sinkMetadata[id] = { label: id.slice(1), pol: 'DO' };
  }

  const sourceTop = Array.from({ length: 8 }, (_, index) => `Q${index.toString(16).toUpperCase()}`);
  const sourceBottom = Array.from({ length: 8 }, (_, index) => `Q${(index + 8).toString(16).toUpperCase()}`).concat(['COM+', '0V']);
  const sourceMetadata = { 'COM+': { label: 'COM/+24V', pol: 'DC+' }, '0V': { label: '0V', pol: 'DC-' } };
  for (const id of [...sourceTop, ...sourceBottom]) {
    if (!sourceMetadata[id]) sourceMetadata[id] = { label: id.slice(1), pol: 'DO' };
  }

  const mixedInputs = Array.from({ length: 8 }, (_, index) => `I${index.toString(16).toUpperCase()}`).concat('IN_COM');
  const mixedOutputs = Array.from({ length: 8 }, (_, index) => `Q${index.toString(16).toUpperCase()}`).concat('OUT_COM');
  const mixedMetadata = { IN_COM: { label: 'IN COM', pol: 'IO-COM' }, OUT_COM: { label: 'OUT COM', pol: 'SW' } };
  for (const id of mixedInputs) {
    if (!mixedMetadata[id]) mixedMetadata[id] = { label: `IN ${id.slice(1)}`, pol: 'DI' };
  }
  for (const id of mixedOutputs) {
    if (!mixedMetadata[id]) mixedMetadata[id] = { label: `OUT ${id.slice(1)}`, pol: 'DO' };
  }

  const analogIds = count => Array.from({ length: count }, (_, channel) => [`CH${channel}+`, `CH${channel}-`]).flat().concat(['+24V', '0V']);
  const analogMetadata = (count, direction) => {
    const metadata = {
      '+24V': { label: 'DC24V +', pol: 'DC+' },
      '0V': { label: 'DC24V -', pol: 'DC-' },
    };
    for (let channel = 0; channel < count; channel += 1) {
      metadata[`CH${channel}+`] = { label: `CH${channel}+`, pol: direction === 'input' ? 'AI' : 'AO' };
      metadata[`CH${channel}-`] = { label: `CH${channel}-`, pol: direction === 'input' ? 'AI-COM' : 'AO-COM' };
    }
    return metadata;
  };
  const analogChannels = (count, direction, ranges = ['0~10V', '0~20mA', '4~20mA']) => Array.from(
    { length: count },
    (_, channel) => ({ channel, pos: `CH${channel}+`, neg: `CH${channel}-`, direction, ranges: [...ranges] }),
  );
  const analogModule = ({ type, label, sub, image, count, direction, ranges, notes, width = 160, height = 520 }) => {
    const ids = analogIds(count);
    return {
      cat: 'plc',
      label: label || type,
      sub,
      w: width,
      h: height,
      color: '#e7e8ea',
      image: GPT + image,
      imageBox: { x: 0, y: 0, w: width, h: height },
      imageHasLabels: false,
      overlayLabel: false,
      terminals: column(ids, analogMetadata(count, direction), width, height),
      powerPairs: [{ pos: '+24V', neg: '0V', kind: 'DC24' }],
      polarityCritical: [['+24V', '0V']],
      analogChannels: analogChannels(count, direction, ranges),
      terminalAliases: { P24: '+24V', P0V: '0V' },
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'special', occupiedPoints: 64, specialBase: true },
      rackModule: { family: 'LS-XGB', moduleClass: 'special', occupiedPoints: 64, pointsPerSlot: 64, specialBase: true },
      manualSource: ANALOG_MANUAL,
      manualVerified: true,
      generatedFromGptBase: true,
      notes,
    };
  };

  const rtdIds = [];
  const rtdMetadata = {};
  const rtdChannels = [];
  for (let channel = 0; channel < 4; channel += 1) {
    rtdIds.push(`CH${channel}A`, `CH${channel}B`, `CH${channel}b`);
    rtdMetadata[`CH${channel}A`] = { label: `CH${channel} A`, pol: 'RTD' };
    rtdMetadata[`CH${channel}B`] = { label: `CH${channel} B`, pol: 'RTD' };
    rtdMetadata[`CH${channel}b`] = { label: `CH${channel} b`, pol: 'RTD' };
    rtdChannels.push({ channel, A: `CH${channel}A`, B: `CH${channel}B`, b: `CH${channel}b`, sensor: ['PT100', 'JPT100'] });
  }
  rtdIds.push('+24V', '0V', 'PE');
  rtdMetadata['+24V'] = { label: 'DC24V +', pol: 'DC+' };
  rtdMetadata['0V'] = { label: 'DC24V -', pol: 'DC-' };
  rtdMetadata.PE = { label: 'PE/SHIELD', pol: 'PE' };

  const thermocoupleIds = analogIds(4).slice(0, 8).concat(['NC', '+24V', '0V']);
  const thermocoupleMetadata = analogMetadata(4, 'input');
  thermocoupleMetadata.NC = { label: 'NC', pol: 'NEUTRAL' };

  const devices = {
    'XBE-DC32A': {
      cat: 'plc', label: 'XBE-DC32A', sub: 'DC24V 입력 32점 · Source/Sink · 40핀',
      w: 420, h: 260, color: '#274d72', image: EXPANSION + 'xgb-main-expansion-gpt.png', imageBox: { x: 0, y: 0, w: 420, h: 260 }, imageHasLabels: false,
      overlayLabel: true, terminals: dc32Terminals,
      netHints: [['COM-A1', 'COM-A2'], ['COM-A1', 'COM-B1'], ['COM-A1', 'COM-B2']],
      inputGroups: [{ inputs: Array.from({ length: 32 }, (_, index) => `I${hex2(index)}`), commons: ['COM-A1', 'COM-A2', 'COM-B1', 'COM-B2'] }],
      ioLedTerms: Array.from({ length: 32 }, (_, index) => `I${hex2(index)}`), digitalInputModule: true,
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, actualPoints: 32, inputOffset: 0 },
      rackModule: { family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, pointsPerSlot: 64, actualPoints: 32, inputOffset: 0 },
      manualSource: HARDWARE_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: '매뉴얼 기준 DC24V 입력 32점, 32점/COM, 40핀 커넥터. 00~0F는 B열, 10~1F는 A열이다.',
    },
    'XBE-RY16A': {
      cat: 'plc', label: 'XBE-RY16A', sub: '릴레이 출력 16점 · 8점/COM × 2',
      w: 320, h: 300, color: '#274d72', image: EXPANSION + 'xgb-relay-io-gpt.png', imageBox: { x: 0, y: 0, w: 320, h: 300 }, imageHasLabels: false,
      overlayLabel: true, terminals: [...row(relayTop, 32, 20, 300, 'T', relayMetadata), ...row(relayBottom, 268, 20, 300, 'B', relayMetadata)],
      outputGroups: [{ outputs: relayTop.slice(0, 8), commons: ['COM0'], mode: 'relay' }, { outputs: relayBottom.slice(0, 8), commons: ['COM1'], mode: 'relay' }],
      ioLedTerms: [...relayTop.slice(0, 8), ...relayBottom.slice(0, 8)], manualForceOutputs: true,
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, actualPoints: 16, outputOffset: 0 },
      rackModule: { family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, pointsPerSlot: 64, actualPoints: 16, outputOffset: 0 },
      manualSource: HARDWARE_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: '매뉴얼 기준 릴레이 출력 16점, 8점/COM 두 그룹. 접점은 외부 AC/DC 회로를 스위칭한다.',
    },
    'XBE-TN16A': {
      cat: 'plc', label: 'XBE-TN16A', sub: '트랜지스터 출력 16점 · Sink',
      w: 250, h: 360, color: '#274d72', image: EXPANSION + 'xgb-digital-io-gpt.png', imageBox: { x: 0, y: 0, w: 250, h: 360 }, imageHasLabels: false,
      overlayLabel: true, terminals: [...row(sinkTop, 30, 18, 232, 'T', sinkMetadata), ...row(sinkBottom, 330, 14, 236, 'B', sinkMetadata)],
      powerPairs: [{ pos: 'PWR24', neg: 'COM', kind: 'DC24' }],
      outputGroups: [{ outputs: [...sinkTop, ...sinkBottom.slice(0, 8)], commons: ['COM'], mode: 'sink', power: { pos: 'PWR24', neg: 'COM' } }],
      ioLedTerms: [...sinkTop, ...sinkBottom.slice(0, 8)], manualForceOutputs: true,
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, actualPoints: 16, outputOffset: 0 },
      rackModule: { family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, pointsPerSlot: 64, actualPoints: 16, outputOffset: 0 },
      manualSource: HARDWARE_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: '매뉴얼 기준 DC12/24V 싱크 출력 16점. 출력 ON 시 부하 전류를 COM(0V)으로 끌어내린다.',
    },
    'XBE-TP16A': {
      cat: 'plc', label: 'XBE-TP16A', sub: '트랜지스터 출력 16점 · Source',
      w: 250, h: 360, color: '#274d72', image: EXPANSION + 'xgb-digital-io-gpt.png', imageBox: { x: 0, y: 0, w: 250, h: 360 }, imageHasLabels: false,
      overlayLabel: true, terminals: [...row(sourceTop, 30, 18, 232, 'T', sourceMetadata), ...row(sourceBottom, 330, 14, 236, 'B', sourceMetadata)],
      powerPairs: [{ pos: 'COM+', neg: '0V', kind: 'DC24' }],
      outputGroups: [{ outputs: [...sourceTop, ...sourceBottom.slice(0, 8)], commons: ['COM+'], mode: 'source', power: { pos: 'COM+', neg: '0V' } }],
      ioLedTerms: [...sourceTop, ...sourceBottom.slice(0, 8)], manualForceOutputs: true,
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, actualPoints: 16, outputOffset: 0 },
      rackModule: { family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, pointsPerSlot: 64, actualPoints: 16, outputOffset: 0 },
      manualSource: HARDWARE_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: '매뉴얼 기준 DC12/24V 소스 출력 16점. COM에 +24V, 0V에 전원 귀로를 연결한다.',
    },
    'XBE-DR16A': {
      cat: 'plc', label: 'XBE-DR16A', sub: 'DC24V 입력 8점 + 릴레이 출력 8점',
      w: 320, h: 300, color: '#274d72', image: EXPANSION + 'xgb-relay-io-gpt.png', imageBox: { x: 0, y: 0, w: 320, h: 300 }, imageHasLabels: false,
      overlayLabel: true, terminals: [...row(mixedInputs, 32, 20, 300, 'T', mixedMetadata), ...row(mixedOutputs, 268, 20, 300, 'B', mixedMetadata)],
      inputGroups: [{ inputs: mixedInputs.slice(0, 8), commons: ['IN_COM'] }],
      outputGroups: [{ outputs: mixedOutputs.slice(0, 8), commons: ['OUT_COM'], mode: 'relay' }],
      ioLedTerms: [...mixedInputs.slice(0, 8), ...mixedOutputs.slice(0, 8)], manualForceOutputs: true,
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, actualPoints: 16, inputOffset: 0, outputOffset: 16 },
      rackModule: { family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64, pointsPerSlot: 64, actualPoints: 16, inputOffset: 0, outputOffset: 16 },
      manualSource: HARDWARE_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: '매뉴얼 기준 입력 8점/COM과 릴레이 출력 8점/COM을 각각 별도 단자대로 제공한다.',
    },
    'XBF-AD04A': analogModule({ type: 'XBF-AD04A', sub: '전압/전류 아날로그 입력 4채널', image: 'xbf-ad04a-gpt.png', count: 4, direction: 'input', notes: 'CH0~CH3 각 +/-와 외부 DC24V +/-. 입력 장치 전원은 모듈에서 공급하지 않는다.' }),
    'XBF-DV04A': analogModule({ type: 'XBF-DV04A', sub: '전압 아날로그 출력 4채널 · 0~10V', image: 'xbf-dv04a-gpt.png', count: 4, direction: 'output', ranges: ['0~10V'], notes: 'CH0~CH3 전압 출력 +/-와 외부 DC24V +/-. 부하저항 2kΩ 이상.' }),
    'XBF-DC04A': analogModule({ type: 'XBF-DC04A', sub: '전류 아날로그 출력 4채널 · 0/4~20mA', image: 'xbf-dc04a-gpt.png', count: 4, direction: 'output', ranges: ['0~20mA', '4~20mA'], notes: 'CH0~CH3 전류 출력 +/-와 외부 DC24V +/-. 부하저항 510Ω 이하.' }),
    'XBF-RD04A': {
      cat: 'plc', label: 'XBF-RD04A', sub: 'PT100/JPT100 RTD 입력 4채널 · 3선식',
      w: 160, h: 520, color: '#e7e8ea', image: GPT + 'xbf-rd04a-gpt.png', imageBox: { x: 0, y: 0, w: 160, h: 520 }, imageHasLabels: false,
      overlayLabel: false, terminals: column(rtdIds, rtdMetadata, 160, 520),
      powerPairs: [{ pos: '+24V', neg: '0V', kind: 'DC24' }], polarityCritical: [['+24V', '0V']], rtdChannels,
      terminalAliases: { P24: '+24V', P0V: '0V' },
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'special', occupiedPoints: 64, specialBase: true },
      rackModule: { family: 'LS-XGB', moduleClass: 'special', occupiedPoints: 64, pointsPerSlot: 64, specialBase: true },
      manualSource: ANALOG_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: '채널별 A/B/b 3선식 + 외부 DC24V +/- + PE, 총 15점. 차폐는 제어반측 PE에 한쪽 접지한다.',
    },
    'XBF-TC04S': {
      cat: 'plc', label: 'XBF-TC04S', sub: '열전대 입력 4CH · K/J/T/R · 외부 DC24V',
      w: 160, h: 520, color: '#e7e8ea', image: GPT + 'xbf-tc04s-gpt.png', imageBox: { x: 0, y: 0, w: 160, h: 520 }, imageHasLabels: false,
      overlayLabel: false, terminals: column(thermocoupleIds, thermocoupleMetadata, 160, 520),
      powerPairs: [{ pos: '+24V', neg: '0V', kind: 'DC24' }], polarityCritical: [['+24V', '0V']],
      analogChannels: analogChannels(4, 'input'), thermocoupleTypes: ['K', 'J', 'T', 'R'],
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'special', occupiedPoints: 64, specialBase: true },
      rackModule: { family: 'LS-XGB', moduleClass: 'special', occupiedPoints: 64, pointsPerSlot: 64, specialBase: true },
      manualSource: ANALOG_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: 'CH0~CH3 열전대 +/-와 NC, 외부 DC24V +/-. 센서 타입과 같은 보상도선을 사용한다.',
    },
    'XBF-AD08A': analogModule({ type: 'XBF-AD08A', sub: '아날로그 입력 8CH · 채널별 전압/전류 선택', image: 'xbf-ad08a-gpt.png', count: 8, direction: 'input', width: 170, height: 580, notes: 'CH0~CH7 각 +/-와 외부 DC24V +/-. 채널별 전압/전류 선택 스위치와 파라미터를 일치시킨다.' }),
    'PT100-3W': {
      cat: 'sensor', label: 'PT100 3선 센서', sub: 'A/B/b 측온저항체 · XBF-RD04A용',
      w: 300, h: 130, color: '#9b59b6', image: EXPANSION + 'pt100-3wire-gpt.png', imageBox: { x: 0, y: 0, w: 300, h: 130 }, imageHasLabels: false,
      terminals: [
        { id: 'A', x: 5, y: 30, side: 'L', label: 'A', pol: 'RTD', forceLabel: true },
        { id: 'B', x: 5, y: 65, side: 'L', label: 'B', pol: 'RTD', forceLabel: true },
        { id: 'b', x: 5, y: 100, side: 'L', label: 'b', pol: 'RTD', forceLabel: true },
      ],
      sensorKind: 'RTD', manualSource: ANALOG_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: 'PT100 3선식: A는 한쪽, B/b는 반대쪽의 같은 저항단에서 나온 두 보상선이다.',
    },
    'TC-K': {
      cat: 'sensor', label: 'K형 열전대', sub: '열전대 +/− · 차폐',
      w: 300, h: 130, color: '#b46f35', image: EXPANSION + 'thermocouple-k-gpt.png', imageBox: { x: 0, y: 0, w: 300, h: 130 }, imageHasLabels: false,
      terminals: [
        { id: '+', x: 5, y: 30, side: 'L', label: 'TC +', pol: 'AI', forceLabel: true },
        { id: '-', x: 5, y: 65, side: 'L', label: 'TC -', pol: 'AI-COM', forceLabel: true },
        { id: 'SH', x: 5, y: 100, side: 'L', label: 'SHIELD', pol: 'PE', forceLabel: true },
      ],
      sensorKind: 'THERMOCOUPLE', thermocoupleType: 'K', manualSource: ANALOG_MANUAL, manualVerified: true, generatedFromGptBase: true,
      notes: 'K형 열전대 극성과 보상도선을 유지하고 차폐는 제어반측 PE에 한쪽만 접지한다.',
    },
  };

  registry.register({
    id: 'ls-xgb-expansion-v27',
    version: '2.7.0',
    title: 'LS XGB manual-backed digital, analog and temperature expansion modules',
    devices,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
