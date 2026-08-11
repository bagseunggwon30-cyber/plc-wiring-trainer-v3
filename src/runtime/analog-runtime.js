(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PLCTrainerAnalog = api;
  root.PLCAnalogRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RANGE_TABLE = Object.freeze({
    '0~10V': { kind: 'voltage', min: 0, max: 10, unit: 'V' },
    '-10~10V': { kind: 'voltage', min: -10, max: 10, unit: 'V' },
    '0~5V': { kind: 'voltage', min: 0, max: 5, unit: 'V' },
    '1~5V': { kind: 'voltage', min: 1, max: 5, unit: 'V' },
    '0~20mA': { kind: 'current', min: 0, max: 20, unit: 'mA' },
    '4~20mA': { kind: 'current', min: 4, max: 20, unit: 'mA' }
  });
  const DATA_TYPES = Object.freeze({
    '0~4000': [0, 4000], '-2000~2000': [-2000, 2000],
    '0~16000': [0, 16000], '-8000~8000': [-8000, 8000],
    normalized: [0, 16000], '0~1000': [0, 1000]
  });

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
  function normalizeRange(value) {
    const source = String(value || '0~10V').replace(/\s+/g, '').replace(/[–—-]/g, '~');
    return Object.keys(RANGE_TABLE).find(key => key.toLowerCase() === source.toLowerCase()) || '0~10V';
  }
  function normalizeDataType(value, range = '0~10V') {
    if (DATA_TYPES[value]) return value;
    return normalizeRange(range).startsWith('-') ? '-2000~2000' : '0~4000';
  }
  function ratioForSignal(signalValue, rangeKey) {
    const range = RANGE_TABLE[normalizeRange(rangeKey)];
    return clamp((finite(signalValue) - range.min) / (range.max - range.min), 0, 1);
  }
  function signalToRaw(signalValue, rangeKey, dataType = '0~4000') {
    const [min, max] = DATA_TYPES[normalizeDataType(dataType, rangeKey)];
    return Math.round(min + ratioForSignal(signalValue, rangeKey) * (max - min));
  }
  function rawToSignal(rawValue, rangeKey, dataType = '0~4000') {
    const [min, max] = DATA_TYPES[normalizeDataType(dataType, rangeKey)];
    const ratio = max === min ? 0 : clamp((finite(rawValue) - min) / (max - min), 0, 1);
    const range = RANGE_TABLE[normalizeRange(rangeKey)];
    return +(range.min + ratio * (range.max - range.min)).toFixed(5);
  }
  function engineeringToSignal(value, config = {}) {
    const rangeKey = normalizeRange(config.range), range = RANGE_TABLE[rangeKey];
    const engMin = finite(config.engineeringMin, 0), engMax = finite(config.engineeringMax, 100);
    const low = Math.min(engMin, engMax), high = Math.max(engMin, engMax);
    const engineeringValue = clamp(value, low, high);
    const ratio = engMax === engMin ? 0 : (engineeringValue - engMin) / (engMax - engMin);
    return {
      range: rangeKey, engineeringValue: +engineeringValue.toFixed(4), engineeringUnit: config.unit || '%',
      signalValue: +(range.min + ratio * (range.max - range.min)).toFixed(5), signalUnit: range.unit,
      ratio: +ratio.toFixed(7)
    };
  }
  function signalToEngineering(signalValue, config = {}) {
    const ratio = ratioForSignal(signalValue, config.range);
    const min = finite(config.engineeringMin, 0), max = finite(config.engineeringMax, 100);
    return +(min + ratio * (max - min)).toFixed(4);
  }

  function ensureDeviceRuntime(device, definition) {
    if (!device.runtime) device.runtime = {};
    if (!device.runtime.analog) device.runtime.analog = { channels: {} };
    if (!device.runtime.analog.channels) device.runtime.analog.channels = {};
    const legacy = device.analogConfig || {};
    for (const channel of definition?.analogChannels || []) {
      const key = String(channel.channel), current = { ...(legacy[key] || {}), ...(device.runtime.analog.channels[key] || {}) };
      const source = definition.analogSource || {};
      const defaultRange = channel.range || channel.ranges?.[0] || source.defaultRange || '0~10V';
      device.runtime.analog.channels[key] = {
        range: normalizeRange(current.range || defaultRange),
        dataType: normalizeDataType(current.dataType || channel.dataType || '0~4000', defaultRange),
        engineeringMin: finite(current.engineeringMin, source.engineeringMin ?? 0),
        engineeringMax: finite(current.engineeringMax, source.engineeringMax ?? 100),
        engineeringValue: finite(current.engineeringValue, source.defaultEngineeringValue ?? 50),
        unit: current.unit || source.unit || '%'
      };
    }
    device.analogConfig = Object.fromEntries(Object.entries(device.runtime.analog.channels).map(([key, value]) => [key, { ...value }]));
    return device.runtime.analog;
  }
  function ensureSensorRuntime(device, kind = 'GENERIC') {
    if (!device.runtime) device.runtime = {};
    const oldHumidity = device.humidityRh ?? device.humidityRH;
    if (!device.runtime.sensor) {
      device.runtime.sensor = {
        kind, temperatureC: finite(device.temperatureC, 25), humidityRH: finite(oldHumidity, 50),
        processValue: 50, wireBreak: false
      };
    }
    device.runtime.sensor.kind = kind || device.runtime.sensor.kind;
    device.temperatureC = device.runtime.sensor.temperatureC;
    device.humidityRh = device.runtime.sensor.humidityRH;
    return device.runtime.sensor;
  }
  function channelConfig(device, definition, channel) {
    ensureDeviceRuntime(device, definition);
    return device.runtime.analog.channels[String(channel.channel)];
  }
  function netTouched(net, deviceId) {
    return !!net && (net.members || []).some(member => member.dev !== deviceId);
  }
  function channelNets(nets, id, channel, netFor) {
    const posNet = netFor(nets, id, channel.pos), negNet = netFor(nets, id, channel.neg);
    return { posNet, negNet, touched: netTouched(posNet, id) || netTouched(negNet, id), wired: netTouched(posNet, id) && netTouched(negNet, id) && posNet?.id !== negNet?.id };
  }
  function memberDeviceIds(net, selfId, predicate) {
    return [...new Set((net?.members || []).filter(member => member.dev !== selfId && predicate(member)).map(member => member.dev))];
  }
  function matchingSensor(posNet, negNet, id, devices, library, kind, posTerms, negTerms) {
    const candidates = memberDeviceIds(posNet, id, member => library?.[devices?.[member.dev]?.type]?.sensorKind === kind && posTerms.includes(member.term));
    return candidates.find(sensorId => (negNet?.members || []).some(member => member.dev === sensorId && negTerms.includes(member.term))) || null;
  }

  function evaluate({ devices, library, nets, netFor, powered }) {
    const state = new Map(), sources = [];
    const isPowered = typeof powered === 'function' ? powered : () => true;

    for (const [id, device] of Object.entries(devices || {})) {
      const definition = library?.[device.type];
      if (definition?.sensorKind) ensureSensorRuntime(device, definition.sensorKind);
      if (!definition?.analogChannels?.length) continue;
      ensureDeviceRuntime(device, definition);
      for (const channel of definition.analogChannels) {
        if (!['output', 'source', 'sensor'].includes(channel.direction)) continue;
        const config = channelConfig(device, definition, channel), signal = engineeringToSignal(config.engineeringValue, config);
        const connection = channelNets(nets, id, channel, netFor);
        const sensor = definition.sensorKind ? ensureSensorRuntime(device, definition.sensorKind) : null;
        const powerRequired = !!definition.powerPairs?.length || channel.direction === 'output' || channel.direction === 'sensor';
        const powerOk = powerRequired ? isPowered(id, definition) : true;
        const broken = !!sensor?.wireBreak;
        const entry = {
          kind: 'analog', deviceId: id, channel: channel.channel, direction: channel.direction,
          powered: powerOk, ...connection, ready: powerOk && connection.wired && !broken,
          quality: !connection.touched ? 'unused' : broken ? 'wire-break' : !powerOk ? 'power-off' : !connection.wired ? 'open-circuit' : 'good',
          ...signal, dataType: config.dataType, rawValue: signalToRaw(signal.signalValue, signal.range, config.dataType)
        };
        state.set(`${id}.CH${channel.channel}`, entry);
        sources.push({ id, definition, channel, config, entry, ...connection });
      }
    }

    for (const [id, device] of Object.entries(devices || {})) {
      const definition = library?.[device.type];
      const hasAnalog = !!definition?.analogChannels?.length;
      const hasRtd = !!definition?.rtdChannels?.length;
      if (!hasAnalog && !hasRtd) continue;
      if (hasAnalog) ensureDeviceRuntime(device, definition);
      for (const channel of definition.analogChannels || []) {
        if (channel.direction !== 'input') continue;
        const config = channelConfig(device, definition, channel), connection = channelNets(nets, id, channel, netFor);
        const source = sources.find(item => item.posNet && item.negNet && connection.posNet && connection.negNet && item.posNet.id === connection.posNet.id && item.negNet.id === connection.negNet.id);
        const powerOk = isPowered(id, definition), inputRange = normalizeRange(config.range), inputMeta = RANGE_TABLE[inputRange];
        const sourceMeta = source ? RANGE_TABLE[normalizeRange(source.entry.range)] : null;
        const compatibleRange = !sourceMeta || sourceMeta.kind === inputMeta.kind;
        const sourceReady = !!source?.entry.ready, signalValue = sourceReady ? source.entry.signalValue : null;
        const quality = !connection.touched ? 'unused' : !powerOk ? 'power-off' : !connection.wired || !source ? 'open-circuit' : !sourceReady ? source.entry.quality : !compatibleRange ? 'range-mismatch' : 'good';
        state.set(`${id}.CH${channel.channel}`, {
          kind: 'analog', deviceId: id, channel: channel.channel, direction: 'input', powered: powerOk,
          ...connection, ready: quality === 'good', quality, range: inputRange, sourceRange: source?.entry.range || null,
          signalValue, signalUnit: inputMeta.unit, dataType: config.dataType,
          rawValue: signalValue == null ? null : signalToRaw(signalValue, inputRange, config.dataType),
          engineeringValue: signalValue == null ? null : signalToEngineering(signalValue, config), engineeringUnit: config.unit,
          sourceDevice: source?.id || null
        });

        /* Passive thermocouple support: the TC sensor provides temperature instead of V/I range metadata. */
        if (!source && definition.thermocoupleTypes?.length) {
          const sensorId = matchingSensor(connection.posNet, connection.negNet, id, devices, library, 'THERMOCOUPLE', ['+'], ['-']);
          if (sensorId) {
            const sensorDef = library[devices[sensorId].type], sensor = ensureSensorRuntime(devices[sensorId], sensorDef.sensorKind);
            const broken = !!sensor.wireBreak, type = sensorDef.thermocoupleType || 'K', temperatureC = finite(sensor.temperatureC, 25);
            const ready = powerOk && connection.wired && !broken;
            state.set(`${id}.CH${channel.channel}`, {
              kind: 'thermocouple', deviceId: id, channel: channel.channel, direction: 'input', powered: powerOk,
              ...connection, ready, quality: broken ? 'wire-break' : !powerOk ? 'power-off' : !connection.wired ? 'open-circuit' : 'good',
              sensorDevice: sensorId, sensorType: type, temperatureC, engineeringValue: temperatureC, engineeringUnit: '°C',
              signalValue: thermocoupleMillivolts(type, temperatureC), signalUnit: 'mV', rawValue: Math.round(temperatureC * 10)
            });
          }
        }
      }

      for (const channel of definition.rtdChannels || []) {
        const aNet = netFor(nets, id, channel.A), bNet = netFor(nets, id, channel.B), b2Net = netFor(nets, id, channel.b);
        const touched = netTouched(aNet, id) || netTouched(bNet, id) || netTouched(b2Net, id);
        const aSensors = memberDeviceIds(aNet, id, member => library?.[devices?.[member.dev]?.type]?.sensorKind === 'RTD' && member.term === 'A');
        const sensorId = aSensors.find(candidate => (bNet?.members || []).some(m => m.dev === candidate && (m.term === 'B' || m.term === 'b')) && (b2Net?.members || []).some(m => m.dev === candidate && (m.term === 'B' || m.term === 'b'))) || null;
        const sensor = sensorId ? ensureSensorRuntime(devices[sensorId], 'RTD') : null;
        const powerOk = isPowered(id, definition), wired = !!(aNet && bNet && b2Net && aNet.id !== bNet.id && aNet.id !== b2Net.id && sensorId);
        const broken = !!sensor?.wireBreak, temperatureC = sensor ? finite(sensor.temperatureC, 25) : null;
        const quality = !touched ? 'unused' : broken ? 'wire-break' : !powerOk ? 'power-off' : !wired ? 'open-circuit' : 'good';
        state.set(`${id}.CH${channel.channel}`, {
          kind: 'rtd', deviceId: id, channel: channel.channel, direction: 'input', powered: powerOk, touched, wired,
          ready: quality === 'good', quality, sensorDevice: sensorId, temperatureC,
          engineeringValue: temperatureC, engineeringUnit: '°C',
          signalValue: temperatureC == null ? null : pt100Resistance(temperatureC), signalUnit: 'Ω',
          rawValue: temperatureC == null ? null : Math.round(temperatureC * 10)
        });
      }
    }
    return state;
  }

  function validate(state) {
    const issues = [];
    for (const [key, item] of state || []) {
      if (!item.touched || item.quality === 'unused' || item.quality === 'good') continue;
      const dev = item.deviceId;
      if (item.quality === 'range-mismatch') issues.push({ category: 'function', msg: `${key}: 입력 범위 ${item.range}와 신호원 ${item.sourceRange}의 전압/전류 종류가 다릅니다.`, dev });
      if (item.quality === 'open-circuit') issues.push({ category: 'function', msg: `${key}: 채널 배선 또는 센서 신호원이 완성되지 않았습니다.`, dev });
      if (item.quality === 'power-off') issues.push({ category: 'function', msg: `${key}: 모듈/센서 전원이 없어 값이 유효하지 않습니다.`, dev });
      if (item.quality === 'wire-break') issues.push({ category: 'function', msg: `${key}: 센서 단선 상태입니다.`, dev });
    }
    return issues;
  }
  function pt100Resistance(temperatureC) {
    const t = finite(temperatureC, 0);
    return +(100 * (1 + 0.00385 * t)).toFixed(4);
  }
  function thermocoupleMillivolts(type, temperatureC) {
    const sensitivity = { K: 0.041, J: 0.055, T: 0.043, R: 0.0105 }[String(type || 'K').toUpperCase()] || 0.041;
    return +(finite(temperatureC, 0) * sensitivity).toFixed(4);
  }

  return {
    version: '2.0.0', RANGE_TABLE, DATA_TYPES, normalizeRange, normalizeDataType,
    engineeringToSignal, signalToEngineering, signalToRaw, rawToSignal,
    ensureDeviceRuntime, ensureSensorRuntime, channelConfig, evaluate, validate,
    pt100Resistance, thermocoupleMillivolts
  };
});
