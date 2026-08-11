(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PLCTrainerDiscreteIoRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const INPUT_MODES = Object.freeze(['sink', 'source']);
  const BANKS = new Set(['P', 'M', 'D', 'X', 'Y']);

  const INPUT_DEFINITIONS = Object.freeze([
    Object.freeze({ key: 'switchGreen', moduleId: 'switch', kind: 'contact', contact: 'no', supply: 'S1-IN', signal: 'S1-OUT' }),
    Object.freeze({ key: 'switchBlue', moduleId: 'switch', kind: 'contact', contact: 'no', supply: 'S2-IN', signal: 'S2-OUT' }),
    Object.freeze({ key: 'switchRed', moduleId: 'switch', kind: 'contact', contact: 'nc', supply: 'S3-IN', signal: 'S3-OUT' }),
    Object.freeze({ key: 'photoNpn', moduleId: 'photo-npn', kind: 'sensor', sensorType: 'npn' }),
    Object.freeze({ key: 'photoPnp', moduleId: 'photo-pnp', kind: 'sensor', sensorType: 'pnp' }),
    Object.freeze({ key: 'inductiveNpn', moduleId: 'inductive-npn', kind: 'sensor', sensorType: 'npn' }),
    Object.freeze({ key: 'inductivePnp', moduleId: 'inductive-pnp', kind: 'sensor', sensorType: 'pnp' }),
    Object.freeze({ key: 'capacitiveNpn', moduleId: 'capacitive-npn', kind: 'sensor', sensorType: 'npn' }),
    Object.freeze({ key: 'capacitivePnp', moduleId: 'capacitive-pnp', kind: 'sensor', sensorType: 'pnp' }),
    Object.freeze({ key: 'limitLeft', moduleId: 'limit-left', kind: 'contact', contact: 'no', supply: 'COM', signal: 'NO' }),
    Object.freeze({ key: 'limitRight', moduleId: 'limit-right', kind: 'contact', contact: 'no', supply: 'COM', signal: 'NO' })
  ]);

  const OUTPUT_DEFINITIONS = Object.freeze([
    Object.freeze({ key: 'relay1', moduleId: 'relay', signal: 'RY1+', returnAnchor: 'RY1-' }),
    Object.freeze({ key: 'relay2', moduleId: 'relay', signal: 'RY2+', returnAnchor: 'RY2-' }),
    Object.freeze({ key: 'relay3', moduleId: 'relay', signal: 'RY3+', returnAnchor: 'RY3-' }),
    Object.freeze({ key: 'timer', moduleId: 'timer', signal: 'IN', returnAnchor: 'N24', poweredDevice: true }),
    Object.freeze({ key: 'counter', moduleId: 'counter', signal: 'PULSE', returnAnchor: 'N24', poweredDevice: true }),
    Object.freeze({ key: 'lampGreen', moduleId: 'buzzer-lamp', signal: 'G+', returnAnchor: 'COM' }),
    Object.freeze({ key: 'lampYellow', moduleId: 'buzzer-lamp', signal: 'Y+', returnAnchor: 'COM' }),
    Object.freeze({ key: 'lampRed', moduleId: 'buzzer-lamp', signal: 'R+', returnAnchor: 'COM' }),
    Object.freeze({ key: 'lampWhite', moduleId: 'buzzer-lamp', signal: 'W+', returnAnchor: 'COM' }),
    Object.freeze({ key: 'buzzer', moduleId: 'buzzer-lamp', signal: 'BZ+', returnAnchor: 'COM' }),
    Object.freeze({ key: 'towerGreen', moduleId: 'tower', signal: 'G+', returnAnchor: 'COM' }),
    Object.freeze({ key: 'towerYellow', moduleId: 'tower', signal: 'Y+', returnAnchor: 'COM' }),
    Object.freeze({ key: 'towerRed', moduleId: 'tower', signal: 'R+', returnAnchor: 'COM' })
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function asBool(value) {
    if (value === true || value === 1 || value === '1') return true;
    const text = String(value == null ? '' : value).trim().toUpperCase();
    return text === 'TRUE' || text === 'ON';
  }

  function normalizeAddress(value) {
    return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, '');
  }

  function hex(index) {
    return Number(index).toString(16).toUpperCase();
  }

  function makeProfile(id, vendor, family) {
    const ls = id === 'ls';
    const inputs = {};
    const outputs = {};
    const effectiveOutputs = {};
    for (let index = 0; index < INPUT_DEFINITIONS.length; index += 1) {
      inputs[INPUT_DEFINITIONS[index].key] = ls ? `P0020${hex(index)}` : `X20${hex(index)}`;
    }
    for (let index = 0; index < OUTPUT_DEFINITIONS.length; index += 1) {
      const key = OUTPUT_DEFINITIONS[index].key;
      outputs[key] = ls ? `P0021${hex(index)}` : `Y20${hex(index)}`;
      effectiveOutputs[key] = ls ? `P0024${hex(index)}` : `X24${hex(index)}`;
    }
    const commands = {
      timerReset: ls ? 'M0200' : 'M200',
      counterReset: ls ? 'M0201' : 'M201',
      safeStop: ls ? 'M0202' : 'M202'
    };
    const status = {
      powerReady: ls ? 'P00230' : 'X230',
      inputCommonReady: ls ? 'P00231' : 'X231',
      topologyReady: ls ? 'P00232' : 'X232',
      timerDone: ls ? 'P00233' : 'X233',
      counterDone: ls ? 'P00234' : 'X234',
      effectiveOutputs
    };
    const data = {
      timerPreset: ls ? 'D0200' : 'D200',
      timerValue: ls ? 'D0201' : 'D201',
      counterPreset: ls ? 'D0202' : 'D202',
      counterValue: ls ? 'D0203' : 'D203',
      issueCount: ls ? 'D0204' : 'D204'
    };
    return Object.freeze({
      id,
      vendor,
      family,
      simulationOnly: true,
      aliases: ls ? ['ls', 'xgb', 'xg5000'] : ['mitsubishi', 'qnu', 'q-series', 'melsoft'],
      inputs: Object.freeze(inputs),
      outputs: Object.freeze(outputs),
      commands: Object.freeze(commands),
      status: Object.freeze({ ...status, effectiveOutputs: Object.freeze(effectiveOutputs) }),
      data: Object.freeze(data),
      addresses: Object.freeze({ inputs, outputs, commands, status, data })
    });
  }

  const PROFILES = Object.freeze({
    ls: makeProfile('ls', 'LS Electric', 'XGB / XG5000 discrete I/O bench'),
    mitsubishi: makeProfile('mitsubishi', 'Mitsubishi Electric', 'QnU / MELSOFT discrete I/O bench')
  });

  function resolveProfile(value) {
    if (value && typeof value === 'object') value = value.profileId || value.profile || value.id;
    const key = String(value == null ? 'ls' : value).trim().toLowerCase();
    for (const profile of Object.values(PROFILES)) {
      if (profile.id === key || profile.aliases.includes(key)) return profile.id;
    }
    return null;
  }

  function getProfile(stateOrId) {
    const id = resolveProfile(stateOrId) || 'ls';
    return PROFILES[id];
  }

  function booleanMap(definitions) {
    const result = {};
    for (const definition of definitions) result[definition.key] = false;
    return result;
  }

  function emptyMemory() {
    return { P: {}, M: {}, D: {}, X: {}, Y: {} };
  }

  function emptySolution() {
    return {
      ready: false,
      powerReady: false,
      inputCommonReady: false,
      inputs: booleanMap(INPUT_DEFINITIONS),
      outputs: booleanMap(OUTPUT_DEFINITIONS),
      devicePower: {},
      issues: []
    };
  }

  function createState(options = {}) {
    const profileId = resolveProfile(options.profileId || options.profile) || 'ls';
    const inputMode = INPUT_MODES.includes(options.inputMode) ? options.inputMode : 'sink';
    const state = {
      version: VERSION,
      elapsed: 0,
      profileId,
      profile: profileId,
      power: { on: false, voltage: 24 },
      inputMode,
      physicalInputs: booleanMap(INPUT_DEFINITIONS),
      commandOutputs: booleanMap(OUTPUT_DEFINITIONS),
      effectiveOutputs: booleanMap(OUTPUT_DEFINITIONS),
      outputs: booleanMap(OUTPUT_DEFINITIONS),
      inputs: booleanMap(INPUT_DEFINITIONS),
      connections: [],
      layout: clone(options.layout || {}),
      timer: {
        value: 0,
        preset: Math.max(0.001, finite(options.timerPresetSeconds ?? options.timerPreset, 1)),
        active: false,
        done: false
      },
      counter: {
        value: 0,
        preset: Math.max(1, Math.trunc(finite(options.counterPreset, 10))),
        done: false,
        previousPulse: false
      },
      solution: emptySolution(),
      memory: emptyMemory(),
      events: []
    };
    initializeMemory(state);
    if (options.saved) importState(state, options.saved);
    else evaluateTopology(state);
    return state;
  }

  function endpointKey(value) {
    if (typeof value === 'string') {
      const normalized = value.trim().replace(':', '.');
      return normalized.includes('.') ? normalized : '';
    }
    if (!value || typeof value !== 'object') return '';
    const moduleId = String(value.moduleId || value.module || '').trim();
    const anchorId = String(value.anchorId || value.anchor || '').trim();
    return moduleId && anchorId ? `${moduleId}.${anchorId}` : '';
  }

  function endpointObject(value) {
    const key = endpointKey(value);
    if (!key) return null;
    const separator = key.indexOf('.');
    return { moduleId: key.slice(0, separator), anchorId: key.slice(separator + 1) };
  }

  function normalizeConnections(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    for (const candidate of value) {
      if (!candidate || candidate.enabled === false) continue;
      const from = endpointObject(candidate.from);
      const to = endpointObject(candidate.to);
      if (!from || !to) continue;
      const first = endpointKey(from);
      const second = endpointKey(to);
      if (first === second) continue;
      const signature = [first, second].sort().join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      result.push({
        id: String(candidate.id || `wire-${String(result.length + 1).padStart(3, '0')}`),
        kind: String(candidate.kind || 'wire'),
        from,
        to,
        enabled: true
      });
    }
    return result;
  }

  function makeUnionFind() {
    const parent = new Map();
    function find(value) {
      if (!parent.has(value)) parent.set(value, value);
      let root = parent.get(value);
      while (root !== parent.get(root)) root = parent.get(root);
      let current = value;
      while (parent.get(current) !== root) {
        const next = parent.get(current);
        parent.set(current, root);
        current = next;
      }
      return root;
    }
    function join(left, right) {
      const a = find(left);
      const b = find(right);
      if (a !== b) parent.set(b, a);
    }
    return { find, join };
  }

  function connected(graph, left, right) {
    return graph.find(left) === graph.find(right);
  }

  function addIssue(issues, code, objectId, message, related = []) {
    const signature = `${code}|${objectId}`;
    if (issues.some(issue => issue.signature === signature)) return;
    issues.push({ code, objectId, message, related: [...related], signature });
  }

  function contactClosed(definition, state) {
    const operated = !!state.physicalInputs[definition.key];
    return definition.contact === 'nc' ? !operated : operated;
  }

  function buildGraph(state) {
    const graph = makeUnionFind();
    for (const connection of state.connections) graph.join(endpointKey(connection.from), endpointKey(connection.to));
    for (let index = 1; index < 20; index += 1) {
      graph.join('power.P24-0', `power.P24-${index}`);
      graph.join('power.N24-0', `power.N24-${index}`);
    }
    for (const definition of INPUT_DEFINITIONS) {
      if (definition.kind === 'contact' && contactClosed(definition, state)) {
        graph.join(`${definition.moduleId}.${definition.supply}`, `${definition.moduleId}.${definition.signal}`);
      }
    }
    return graph;
  }

  function devicePowered(graph, state, moduleId) {
    return !!state.power.on
      && connected(graph, `${moduleId}.P24`, 'source.P24')
      && connected(graph, `${moduleId}.N24`, 'source.N24');
  }

  function evaluateTopology(state) {
    const issues = [];
    const graph = buildGraph(state);
    const plcPowered = devicePowered(graph, state, 'plc');
    const signalRail = state.inputMode === 'sink' ? 'source.P24' : 'source.N24';
    const commonRail = state.inputMode === 'sink' ? 'source.N24' : 'source.P24';
    const expectedSensorType = state.inputMode === 'sink' ? 'pnp' : 'npn';
    const inputCommonReady = plcPowered && connected(graph, 'plc.COM', commonRail);
    const devicePower = {};

    if (!plcPowered) {
      addIssue(issues, 'POWER_PATH_OPEN', 'plc', 'PLC의 +24V/24G 전원 경로가 완성되지 않았습니다.', ['plc.P24', 'plc.N24']);
    }
    if (!inputCommonReady) {
      addIssue(issues, 'INPUT_COMMON_OPEN', 'plc.COM', `${state.inputMode === 'sink' ? '싱크 입력 COM은 24G' : '소스 입력 COM은 +24V'}에 연결되어야 합니다.`, ['plc.COM']);
    }

    for (const definition of INPUT_DEFINITIONS) {
      if (definition.kind !== 'sensor') continue;
      const powered = devicePowered(graph, state, definition.moduleId);
      devicePower[definition.key] = powered;
      if (!powered) {
        addIssue(issues, 'DEVICE_POWER_OPEN', definition.key, `${definition.key} 센서의 +24V/24G 전원이 완성되지 않았습니다.`, [`${definition.moduleId}.P24`, `${definition.moduleId}.N24`]);
      }
      if (powered && state.physicalInputs[definition.key]) {
        const source = definition.sensorType === 'pnp' ? `${definition.moduleId}.P24` : `${definition.moduleId}.N24`;
        graph.join(`${definition.moduleId}.OUT`, source);
      }
    }

    for (const moduleId of ['timer', 'counter']) {
      const powered = devicePowered(graph, state, moduleId);
      devicePower[moduleId] = powered;
      if (!powered) {
        addIssue(issues, 'DEVICE_POWER_OPEN', moduleId, `${moduleId}의 +24V/24G 전원이 완성되지 않았습니다.`, [`${moduleId}.P24`, `${moduleId}.N24`]);
      }
    }

    const inputs = booleanMap(INPUT_DEFINITIONS);
    for (let index = 0; index < INPUT_DEFINITIONS.length; index += 1) {
      const definition = INPUT_DEFINITIONS[index];
      let shouldConduct = false;
      if (definition.kind === 'sensor') {
        const active = !!state.physicalInputs[definition.key];
        const compatible = definition.sensorType === expectedSensorType;
        if (active && !compatible) {
          addIssue(issues, 'INPUT_TYPE_MISMATCH', definition.key, `${definition.sensorType.toUpperCase()} 센서는 ${state.inputMode === 'sink' ? '싱크 COM(PNP 입력)' : '소스 COM(NPN 입력)'}과 맞지 않습니다.`, [`${definition.moduleId}.OUT`, `plc.I${index}`]);
        }
        shouldConduct = active && compatible && devicePower[definition.key];
      } else {
        shouldConduct = contactClosed(definition, state);
      }
      const on = plcPowered && inputCommonReady && shouldConduct && connected(graph, `plc.I${index}`, signalRail);
      inputs[definition.key] = !!on;
      if (shouldConduct && !on) {
        addIssue(issues, 'INPUT_PATH_OPEN', definition.key, `${definition.key}에서 PLC I${index}까지 입력 전류 경로가 끊어졌습니다.`, [`${definition.moduleId}.${definition.signal || 'OUT'}`, `plc.I${index}`]);
      }
    }

    const effectiveOutputs = booleanMap(OUTPUT_DEFINITIONS);
    for (let index = 0; index < OUTPUT_DEFINITIONS.length; index += 1) {
      const definition = OUTPUT_DEFINITIONS[index];
      if (!state.commandOutputs[definition.key]) continue;
      const outputEndpoint = `plc.O${index}`;
      const signalEndpoint = `${definition.moduleId}.${definition.signal}`;
      const returnEndpoint = `${definition.moduleId}.${definition.returnAnchor}`;
      const signalComplete = connected(graph, outputEndpoint, signalEndpoint);
      const returnComplete = connected(graph, returnEndpoint, 'source.N24');
      if (!signalComplete || !plcPowered) {
        addIssue(issues, 'OUTPUT_PATH_OPEN', definition.key, `PLC O${index}에서 ${signalEndpoint}까지 출력 경로가 끊어졌습니다.`, [outputEndpoint, signalEndpoint]);
      }
      if (signalComplete && !returnComplete) {
        addIssue(issues, 'LOAD_RETURN_OPEN', definition.key, `${definition.key} 부하에서 24G로 돌아가는 귀로가 끊어졌습니다.`, [returnEndpoint, 'source.N24']);
      }
      const extraPowerReady = !definition.poweredDevice || !!devicePower[definition.moduleId];
      effectiveOutputs[definition.key] = plcPowered && signalComplete && returnComplete && extraPowerReady;
    }

    state.inputs = inputs;
    state.effectiveOutputs = effectiveOutputs;
    state.outputs = { ...effectiveOutputs };
    state.solution = {
      ready: issues.length === 0,
      powerReady: plcPowered,
      inputCommonReady,
      inputs: { ...inputs },
      outputs: { ...effectiveOutputs },
      devicePower: { ...devicePower },
      timer: clone(state.timer),
      counter: clone(state.counter),
      issues: issues.map(({ signature, ...issue }) => issue)
    };
    refreshMemory(state);
    return state.solution;
  }

  function referenceConnections(inputMode = 'sink') {
    const mode = INPUT_MODES.includes(inputMode) ? inputMode : 'sink';
    const result = [];
    let pIndex = 0;
    let nIndex = 0;
    function add(fromModule, fromAnchor, toModule, toAnchor) {
      result.push({
        id: `reference-${String(result.length + 1).padStart(3, '0')}`,
        kind: 'wire',
        from: { moduleId: fromModule, anchorId: fromAnchor },
        to: { moduleId: toModule, anchorId: toAnchor },
        enabled: true
      });
    }
    function fromP(moduleId, anchorId) {
      add('power', `P24-${pIndex++}`, moduleId, anchorId);
    }
    function fromN(moduleId, anchorId) {
      add('power', `N24-${nIndex++}`, moduleId, anchorId);
    }
    function fromSignalRail(moduleId, anchorId) {
      if (mode === 'sink') fromP(moduleId, anchorId);
      else fromN(moduleId, anchorId);
    }

    add('source', 'P24', 'power', `P24-${pIndex++}`);
    add('source', 'N24', 'power', `N24-${nIndex++}`);
    fromP('plc', 'P24');
    fromN('plc', 'N24');
    if (mode === 'sink') fromN('plc', 'COM');
    else fromP('plc', 'COM');

    for (let index = 0; index < INPUT_DEFINITIONS.length; index += 1) {
      const definition = INPUT_DEFINITIONS[index];
      if (definition.kind === 'sensor') {
        fromP(definition.moduleId, 'P24');
        fromN(definition.moduleId, 'N24');
        add(definition.moduleId, 'OUT', 'plc', `I${index}`);
      } else {
        fromSignalRail(definition.moduleId, definition.supply);
        add(definition.moduleId, definition.signal, 'plc', `I${index}`);
      }
    }

    for (let index = 0; index < OUTPUT_DEFINITIONS.length; index += 1) {
      const definition = OUTPUT_DEFINITIONS[index];
      add('plc', `O${index}`, definition.moduleId, definition.signal);
    }
    fromN('relay', 'RY1-');
    fromN('relay', 'RY2-');
    fromN('relay', 'RY3-');
    fromP('timer', 'P24');
    fromN('timer', 'N24');
    fromP('counter', 'P24');
    fromN('counter', 'N24');
    fromN('buzzer-lamp', 'COM');
    fromN('tower', 'COM');
    return result;
  }

  function safeStop(state, resetTimer = true) {
    for (const definition of OUTPUT_DEFINITIONS) {
      state.commandOutputs[definition.key] = false;
      state.effectiveOutputs[definition.key] = false;
      state.outputs[definition.key] = false;
    }
    state.timer.active = false;
    if (resetTimer) {
      state.timer.value = 0;
      state.timer.done = false;
    }
    state.counter.previousPulse = false;
  }

  function setPower(state, value) {
    state.power.on = asBool(value);
    if (!state.power.on) safeStop(state, true);
    evaluateTopology(state);
    return state.power.on;
  }

  function setInputMode(state, value) {
    const mode = String(value == null ? '' : value).trim().toLowerCase();
    if (!INPUT_MODES.includes(mode)) return false;
    if (state.inputMode !== mode) safeStop(state, true);
    state.inputMode = mode;
    evaluateTopology(state);
    return true;
  }

  function setPhysicalInput(state, key, value) {
    const name = String(key == null ? '' : key).trim();
    if (!Object.prototype.hasOwnProperty.call(state.physicalInputs, name)) return false;
    state.physicalInputs[name] = asBool(value);
    evaluateTopology(state);
    return true;
  }

  function setConnections(state, connections) {
    state.connections = normalizeConnections(connections);
    evaluateTopology(state);
    return state.connections;
  }

  function setProfile(state, value) {
    const profileId = resolveProfile(value);
    if (!profileId) return false;
    if (profileId === state.profileId) return true;
    safeStop(state, true);
    state.counter.previousPulse = false;
    state.profileId = profileId;
    state.profile = profileId;
    initializeMemory(state);
    evaluateTopology(state);
    return true;
  }

  function tick(state, seconds) {
    const delta = Math.max(0, Math.min(10, finite(seconds, 0)));
    state.elapsed += delta;
    evaluateTopology(state);

    if (state.effectiveOutputs.timer) {
      state.timer.active = true;
      state.timer.value = Math.min(state.timer.preset, state.timer.value + delta);
      state.timer.done = state.timer.value + 1e-9 >= state.timer.preset;
    } else {
      state.timer.active = false;
      state.timer.value = 0;
      state.timer.done = false;
    }

    const pulse = !!state.effectiveOutputs.counter;
    if (pulse && !state.counter.previousPulse) state.counter.value += 1;
    state.counter.previousPulse = pulse;
    state.counter.done = state.counter.value >= state.counter.preset;
    state.solution.timer = clone(state.timer);
    state.solution.counter = clone(state.counter);
    refreshMemory(state);
    return state;
  }

  function bankForAddress(address) {
    const match = /^([PMDXY])([0-9A-F]+)$/.exec(address);
    return match && BANKS.has(match[1]) ? match[1] : null;
  }

  function memorySet(state, rawAddress, value) {
    const address = normalizeAddress(rawAddress);
    const bank = bankForAddress(address);
    if (!bank) return false;
    state.memory[bank][address] = bank === 'D' ? finite(value, 0) : !!value;
    return true;
  }

  function memoryGet(state, rawAddress) {
    const address = normalizeAddress(rawAddress);
    const bank = bankForAddress(address);
    return bank ? state.memory[bank][address] : undefined;
  }

  function flattenAddresses(value, result = []) {
    if (typeof value === 'string') result.push(normalizeAddress(value));
    else if (value && typeof value === 'object') Object.values(value).forEach(item => flattenAddresses(item, result));
    return result;
  }

  function initializeMemory(state) {
    state.memory = emptyMemory();
    const profile = getProfile(state);
    for (const address of flattenAddresses(profile.addresses)) memorySet(state, address, false);
    refreshMemory(state);
  }

  function refreshMemory(state) {
    const profile = getProfile(state);
    for (const definition of INPUT_DEFINITIONS) memorySet(state, profile.inputs[definition.key], state.inputs[definition.key]);
    for (const definition of OUTPUT_DEFINITIONS) {
      memorySet(state, profile.outputs[definition.key], state.commandOutputs[definition.key]);
      memorySet(state, profile.status.effectiveOutputs[definition.key], state.effectiveOutputs[definition.key]);
    }
    memorySet(state, profile.status.powerReady, state.solution.powerReady);
    memorySet(state, profile.status.inputCommonReady, state.solution.inputCommonReady);
    memorySet(state, profile.status.topologyReady, state.solution.ready);
    memorySet(state, profile.status.timerDone, state.timer.done);
    memorySet(state, profile.status.counterDone, state.counter.done);
    memorySet(state, profile.data.timerPreset, state.timer.preset);
    memorySet(state, profile.data.timerValue, state.timer.value);
    memorySet(state, profile.data.counterPreset, state.counter.preset);
    memorySet(state, profile.data.counterValue, state.counter.value);
    memorySet(state, profile.data.issueCount, state.solution.issues.length);
    return state.memory;
  }

  function outputForAddress(profile, address) {
    return OUTPUT_DEFINITIONS.find(definition => normalizeAddress(profile.outputs[definition.key]) === address) || null;
  }

  function commandForAddress(profile, address) {
    return Object.entries(profile.commands).find(([, mapped]) => normalizeAddress(mapped) === address)?.[0] || null;
  }

  function dataForAddress(profile, address) {
    return Object.entries(profile.data).find(([, mapped]) => normalizeAddress(mapped) === address)?.[0] || null;
  }

  function readDevice(state, rawAddress) {
    const address = normalizeAddress(rawAddress);
    const profile = getProfile(state);
    if (!new Set(flattenAddresses(profile.addresses)).has(address)) return undefined;
    evaluateTopology(state);
    return memoryGet(state, address);
  }

  function writeDevice(state, rawAddress, value) {
    const address = normalizeAddress(rawAddress);
    const profile = getProfile(state);
    const output = outputForAddress(profile, address);
    if (output) {
      state.commandOutputs[output.key] = asBool(value);
      evaluateTopology(state);
      return { ok: true, address, value: state.commandOutputs[output.key], accepted: state.effectiveOutputs[output.key] };
    }

    const command = commandForAddress(profile, address);
    if (command) {
      const on = asBool(value);
      if (on && command === 'timerReset') {
        state.timer.value = 0;
        state.timer.active = false;
        state.timer.done = false;
      }
      if (on && command === 'counterReset') {
        state.counter.value = 0;
        state.counter.previousPulse = false;
        state.counter.done = false;
      }
      if (on && command === 'safeStop') safeStop(state, true);
      evaluateTopology(state);
      return { ok: true, address, value: on, accepted: true };
    }

    const data = dataForAddress(profile, address);
    if (data) {
      const number = finite(value, NaN);
      if (!Number.isFinite(number)) return { ok: false, error: '숫자 설정값이 필요합니다' };
      if (data === 'timerPreset') state.timer.preset = Math.max(0.001, number);
      else if (data === 'counterPreset') state.counter.preset = Math.max(1, Math.trunc(number));
      else return { ok: false, error: `${address}는 읽기 전용 데이터 주소입니다` };
      state.counter.done = state.counter.value >= state.counter.preset;
      refreshMemory(state);
      return { ok: true, address, value: memoryGet(state, address), accepted: true };
    }

    if (new Set(flattenAddresses(profile.addresses)).has(address)) {
      return { ok: false, error: `${address}는 읽기 전용 상태 주소입니다` };
    }
    return { ok: false, error: `${address || '(빈 주소)'}는 현재 ${profile.vendor} 벤치 프로필에 정의되지 않았습니다` };
  }

  function exportState(state) {
    evaluateTopology(state);
    return clone({
      version: VERSION,
      elapsed: state.elapsed,
      profileId: state.profileId,
      profile: state.profileId,
      inputMode: state.inputMode,
      power: state.power,
      physicalInputs: state.physicalInputs,
      commandOutputs: state.commandOutputs,
      connections: state.connections,
      layout: state.layout,
      timer: state.timer,
      counter: state.counter
    });
  }

  function importState(state, saved = {}) {
    if (!saved || typeof saved !== 'object') return state;
    const profileId = resolveProfile(saved.profileId || saved.profile) || state.profileId || 'ls';
    state.profileId = profileId;
    state.profile = profileId;
    state.inputMode = INPUT_MODES.includes(saved.inputMode) ? saved.inputMode : state.inputMode;
    state.connections = normalizeConnections(saved.connections);
    state.layout = clone(saved.layout || {});
    for (const definition of INPUT_DEFINITIONS) {
      state.physicalInputs[definition.key] = !!saved.physicalInputs?.[definition.key];
    }
    state.timer.preset = Math.max(0.001, finite(saved.timer?.preset, state.timer.preset));
    state.timer.value = 0;
    state.timer.active = false;
    state.timer.done = false;
    state.counter.preset = Math.max(1, Math.trunc(finite(saved.counter?.preset, state.counter.preset)));
    state.counter.value = Math.max(0, Math.trunc(finite(saved.counter?.value, 0)));
    state.counter.done = state.counter.value >= state.counter.preset;
    state.counter.previousPulse = false;
    state.elapsed = Math.max(0, finite(saved.elapsed, 0));
    state.power = { on: false, voltage: 24 };
    safeStop(state, true);
    initializeMemory(state);
    evaluateTopology(state);
    return state;
  }

  return {
    version: VERSION,
    VERSION,
    INPUT_MODES: [...INPUT_MODES],
    INPUT_DEFINITIONS: clone(INPUT_DEFINITIONS),
    OUTPUT_DEFINITIONS: clone(OUTPUT_DEFINITIONS),
    PROFILES: clone(PROFILES),
    VENDOR_PROFILES: clone(PROFILES),
    createState,
    create: createState,
    getProfile,
    resolveProfile,
    setProfile,
    switchProfile: setProfile,
    setPower,
    setInputMode,
    setPhysicalInput,
    setConnections,
    referenceConnections,
    evaluateTopology,
    tick,
    readDevice,
    writeDevice,
    readMemory: readDevice,
    writeMemory: writeDevice,
    refreshMemory,
    exportState,
    importState,
    normalizeAddress
  };
});
