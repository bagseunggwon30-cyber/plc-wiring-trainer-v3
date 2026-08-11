(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PLCTrainerModbus = api;
  root.PLCModbusRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BAUD_RATES = Object.freeze([1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]);
  function int(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  function normalizeConfig(config = {}, defaults = {}) {
    const source = { ...defaults, ...config };
    const address = int(source.address ?? source.slaveId, 1, 247, 1);
    const baud = Number(source.baudRate);
    return {
      enabled: source.enabled == null ? false : !!source.enabled,
      role: ['none', 'master', 'slave', 'monitor'].includes(source.role) ? source.role : 'slave',
      address,
      slaveId: address,
      baudRate: BAUD_RATES.includes(baud) ? baud : 9600,
      dataBits: int(source.dataBits, 7, 8, 8),
      parity: ['none', 'even', 'odd'].includes(String(source.parity || '').toLowerCase()) ? String(source.parity).toLowerCase() : 'none',
      stopBits: int(source.stopBits, 1, 2, 1),
      mode: source.mode === '4wire' ? '4wire' : '2wire',
      termination: !!source.termination
    };
  }
  function settings(device, definition) {
    const runtime = { ...(device?.runtime?.modbus || {}), ...(device?.modbus || {}) };
    return normalizeConfig(runtime, definition?.modbusDefaults || {});
  }
  function sameSerialFormat(a, b) {
    return a.baudRate === b.baudRate && a.dataBits === b.dataBits && a.parity === b.parity && a.stopBits === b.stopBits;
  }
  function registerSnapshot(device, definition) {
    if (definition?.canonicalType === 'XY-MD02' || device?.type === 'XY-MD02') {
      const sensor = device?.runtime?.sensor || {};
      const temperatureC = Number(sensor.temperatureC ?? device.temperatureC ?? 25);
      const humidityRH = Number(sensor.humidityRH ?? sensor.humidityRh ?? device.humidityRH ?? device.humidityRh ?? 50);
      const config = settings(device, definition);
      return {
        inputRegisters: { 1: Math.round(temperatureC * 10), 2: Math.round(humidityRH * 10) },
        holdingRegisters: { 257: config.address, 258: config.baudRate },
        engineering: { temperatureC, humidityRH }
      };
    }
    return { inputRegisters: {}, holdingRegisters: {}, engineering: {} };
  }
  function logicalPorts(definition) {
    if (definition?.rs485BusPorts?.length) return definition.rs485BusPorts;
    return (definition?.rs485Pairs || []).map(([plus, minus], index) => ({ id: `P${index + 1}`, plus: [plus], minus: [minus] }));
  }
  function externalNet(terms, nets, deviceId, netFor) {
    const found = terms.map(term => ({ term, net: netFor(nets, deviceId, term) })).filter(item => item.net);
    const external = found.filter(item => (item.net.members || []).some(member => member.dev !== deviceId));
    return { found, external, net: external[0]?.net || null };
  }
  function evaluate({ devices, library, nets, netFor, powered }) {
    const validPorts = [];
    const portIssues = [];
    const deviceState = new Map();
    for (const [id, device] of Object.entries(devices || {})) {
      const definition = library?.[device.type];
      if (!definition || (!definition.rs485Pairs?.length && !definition.rs485BusPorts?.length)) continue;
      const config = settings(device, definition);
      if (!config.enabled || config.role === 'none') continue;
      const powerOk = powered(id, definition);
      const evaluated = [];
      for (const port of logicalPorts(definition)) {
        const plusTerms = Array.isArray(port.plus) ? port.plus : [port.plus];
        const minusTerms = Array.isArray(port.minus) ? port.minus : [port.minus];
        const plus = externalNet(plusTerms, nets, id, netFor);
        const minus = externalNet(minusTerms, nets, id, netFor);
        let fault = null;
        if (config.mode === '2wire' && port.requireBridgeIn2Wire) {
          const plusIds = plus.found.map(item => item.net?.id).filter(Boolean);
          const minusIds = minus.found.map(item => item.net?.id).filter(Boolean);
          if (plusIds.length < plusTerms.length || minusIds.length < minusTerms.length || new Set(plusIds).size !== 1 || new Set(minusIds).size !== 1) fault = 'two-wire-bridge-missing';
        }
        if (!fault && (!plus.net || !minus.net)) fault = 'pair-incomplete';
        if (!fault && plus.net.id === minus.net.id) fault = 'polarity-short';
        const item = { id, device, definition, portId: port.id || 'P1', config, powered: powerOk, plusTerms, minusTerms, plusNet: plus.net, minusNet: minus.net, fault };
        evaluated.push(item);
        if (fault) portIssues.push(item); else validPorts.push(item);
      }
      deviceState.set(id, {
        ready: false,
        reason: !powerOk ? 'device-power-off' : evaluated.find(item => item.fault)?.fault || 'bus-missing',
        settings: config, powered: powerOk, peerCount: 0,
        registers: registerSnapshot(device, definition),
        ports: evaluated.map(item => ({ id: item.portId, fault: item.fault }))
      });
    }

    const grouped = new Map();
    for (const port of validPorts) {
      const key = `${port.plusNet.id}|${port.minusNet.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(port);
    }
    const buses = [];
    for (const [key, ports] of grouped) {
      const members = [...new Map(ports.map(port => [port.id, port])).values()];
      const masters = members.filter(item => item.config.role === 'master');
      const slaves = members.filter(item => item.config.role === 'slave');
      const duplicateIds = [...new Set(slaves.map(item => item.config.address).filter((value, index, all) => all.indexOf(value) !== index))];
      const formatRef = masters[0]?.config || members[0]?.config;
      const formatMismatch = members.filter(item => !sameSerialFormat(formatRef, item.config)).map(item => item.id);
      const poweredAll = members.every(item => item.powered);
      const terminationCount = members.filter(item => item.config.termination).length;
      const reason = members.length < 2 ? 'peer-missing'
        : masters.length === 0 ? 'master-missing'
        : masters.length > 1 ? 'multiple-masters'
        : duplicateIds.length ? 'duplicate-slave-id'
        : formatMismatch.length ? 'serial-format-mismatch'
        : !poweredAll ? 'device-power-off'
        : 'ready';
      const slaveIds = slaves.map(item => item.config.address);
      const bus = {
        key, members: members.map(item => item.id), masters: masters.map(item => item.id),
        slaves: slaves.map(item => ({ id: item.id, address: item.config.address })), slaveIds, duplicateIds,
        formatMismatch, terminationCount, ready: reason === 'ready', reason
      };
      buses.push(bus);
      for (const item of members) {
        deviceState.set(item.id, {
          ...deviceState.get(item.id), busKey: key, ready: bus.ready, reason: bus.reason,
          peerCount: members.length - 1, registers: registerSnapshot(item.device, item.definition)
        });
      }
    }
    return { buses, devices: deviceState, portIssues };
  }
  function validate(result) {
    const issues = [];
    for (const port of result?.portIssues || []) {
      const name = port.definition.label || port.device.type;
      if (port.fault === 'two-wire-bridge-missing') issues.push({ category: 'function', msg: `${name}: 2선식 RS-485에서 TX+/RX+ 및 TX-/RX- 브리지가 필요합니다.`, dev: port.id });
      if (port.fault === 'pair-incomplete') issues.push({ category: 'function', msg: `${name}: RS-485 +/− 두 선이 완성되지 않았습니다.`, dev: port.id });
      if (port.fault === 'polarity-short') issues.push({ category: 'danger', msg: `${name}: RS-485 +와 −가 같은 net으로 단락되었습니다.`, dev: port.id });
    }
    for (const bus of result?.buses || []) {
      if (bus.reason === 'master-missing' && bus.members.length > 1) issues.push({ category: 'function', msg: `Modbus RTU 버스(${bus.members.join(', ')})에 마스터가 없습니다.` });
      if (bus.reason === 'multiple-masters') issues.push({ category: 'function', msg: `Modbus RTU 버스에 마스터가 ${bus.masters.length}대 설정되어 충돌합니다.` });
      if (bus.reason === 'duplicate-slave-id') issues.push({ category: 'function', msg: `Modbus 슬레이브 국번 ${bus.duplicateIds.join(', ')}이 중복되었습니다.` });
      if (bus.reason === 'serial-format-mismatch') issues.push({ category: 'function', msg: `Modbus 통신 설정이 일치하지 않는 장비: ${bus.formatMismatch.join(', ')}` });
      if (bus.ready && bus.members.length > 2 && bus.terminationCount === 0) issues.push({ category: 'quality', msg: `RS-485 멀티드롭 버스(${bus.members.join(', ')})에 종단저항 설정이 없습니다.` });
    }
    return issues;
  }

  return { version: '1.0.0', BAUD_RATES, normalizeConfig, settings, sameSerialFormat, registerSnapshot, logicalPorts, evaluate, validate };
});
