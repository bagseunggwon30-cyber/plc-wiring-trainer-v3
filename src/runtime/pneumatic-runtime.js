(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PLCTrainerPneumaticRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.7.0';
  const STEP = 0.02;
  const PORTS = Object.freeze([
    'source.OUT', 'service.IN', 'service.OUT', 'dist.IN', 'dist.1', 'dist.2', 'dist.3',
    'valve.P', 'valve.A', 'valve.B', 'valve.EA', 'valve.EB', 'cylinder.A', 'cylinder.B',
    'vacuum.P', 'vacuum.VAC'
  ]);
  const DEFAULT_TUBES = Object.freeze([
    ['T01', 'source.OUT', 'service.IN'], ['T02', 'service.OUT', 'dist.IN'],
    ['T03', 'dist.1', 'valve.P'], ['T04', 'valve.A', 'cylinder.A'],
    ['T05', 'valve.B', 'cylinder.B'], ['T06', 'dist.2', 'vacuum.P']
  ]);
  const PROFILES = Object.freeze({
    ls: {
      id: 'ls', vendor: 'LS ELECTRIC', family: 'XGB', addressStyle: 'P/M/D',
      commands: { supply: 'M0300', coilA: 'P00020', coilB: 'P00021', vacuum: 'P00022', auto: 'M0301', stop: 'M0302', reset: 'M0303' },
      status: { ready: 'P00030', extended: 'P00031', retracted: 'P00032', vacuumOk: 'P00033', busy: 'M0310', complete: 'M0311', fault: 'M0312' },
      data: { pressure: 'D0300', stroke: 'D0302', cycleCount: 'D0304' }
    },
    mitsubishi: {
      id: 'mitsubishi', vendor: 'Mitsubishi Electric', family: 'QnU', addressStyle: 'X/Y/M/D',
      commands: { supply: 'Y100', coilA: 'Y101', coilB: 'Y102', vacuum: 'Y103', auto: 'M300', stop: 'M301', reset: 'M302' },
      status: { ready: 'X100', extended: 'X101', retracted: 'X102', vacuumOk: 'X103', busy: 'M310', complete: 'M311', fault: 'M312' },
      data: { pressure: 'D300', stroke: 'D302', cycleCount: 'D304' }
    }
  });

  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const bool = value => value === true || value === 1 || String(value).trim().toUpperCase() === 'ON' || String(value).trim() === '1';
  const address = value => String(value == null ? '' : value).toUpperCase().replace(/\s+/g, '');
  const profileId = value => /mitsubishi|melsec|qnu|qd75|mr-?j4/i.test(String(value || '')) ? 'mitsubishi' : 'ls';

  function tube(id, from, to, options = {}) {
    return { id: String(id), from: String(from), to: String(to), enabled: options.enabled !== false, leak: clamp(finite(options.leak, 0), 0, 1) };
  }

  function createState(options = {}) {
    const state = {
      version: VERSION,
      elapsed: 0,
      profileId: profileId(options.profileId || options.profile),
      source: { on: options.source?.on === true, pressureBar: clamp(finite(options.source?.pressureBar, 6), 0, 10) },
      service: { regulatorBar: clamp(finite(options.service?.regulatorBar, 5), 0, 8), inputBar: 0, outputBar: 0 },
      valve: { type: options.valve?.type === 'double' ? 'double' : 'single', coilA: false, coilB: false, spool: 'retract', conflict: false },
      cylinder: {
        strokeMm: Math.max(1, finite(options.cylinder?.strokeMm, 100)), position: clamp(finite(options.cylinder?.position, 0), 0, 1),
        speedMmS: Math.max(1, finite(options.cylinder?.speedMmS, 55)), throttleExtend: clamp(finite(options.cylinder?.throttleExtend, 1), .05, 1),
        throttleRetract: clamp(finite(options.cylinder?.throttleRetract, 1), .05, 1), velocityMmS: 0, pressureA: 0, pressureB: 0,
        extended: false, retracted: true
      },
      vacuum: { command: false, partPresent: options.vacuum?.partPresent !== false, pressureBar: 0, holding: false },
      tubes: DEFAULT_TUBES.map(parts => tube(...parts)),
      pressures: Object.fromEntries(PORTS.map(port => [port, 0])),
      auto: { running: false, state: 'IDLE', timer: 0, message: '대기', cycleCount: Math.max(0, Math.trunc(finite(options.auto?.cycleCount, 0))) },
      faults: [], events: [], memory: {}
    };
    if (Array.isArray(options.tubes)) state.tubes = options.tubes.map(item => tube(item.id, item.from, item.to, item));
    updateCylinderSensors(state);
    if (options.saved) importState(state, options.saved);
    evaluate(state, 0);
    return state;
  }

  function addEvent(state, type, message) {
    state.events.push({ time: Number(state.elapsed.toFixed(3)), type, message });
    if (state.events.length > 80) state.events.splice(0, state.events.length - 80);
  }

  function setSupply(state, on, pressureBar) {
    state.source.on = !!on;
    if (pressureBar != null) state.source.pressureBar = clamp(finite(pressureBar, state.source.pressureBar), 0, 10);
    if (!state.source.on) state.vacuum.holding = false;
    return state.source.on;
  }

  function setRegulator(state, pressureBar) {
    state.service.regulatorBar = clamp(finite(pressureBar, state.service.regulatorBar), 0, 8);
    return state.service.regulatorBar;
  }

  function setValveType(state, type) {
    state.valve.type = String(type).toLowerCase() === 'double' ? 'double' : 'single';
    state.valve.coilA = state.valve.coilB = false;
    if (state.valve.type === 'single') state.valve.spool = 'retract';
    return state.valve.type;
  }

  function setCoil(state, coil, on) {
    const key = String(coil).toUpperCase() === 'B' ? 'coilB' : 'coilA';
    state.valve[key] = !!on;
    updateSpool(state);
    return !state.valve.conflict;
  }

  function updateSpool(state) {
    const valve = state.valve;
    valve.conflict = valve.coilA && valve.coilB;
    if (valve.conflict) return;
    if (valve.coilA) valve.spool = 'extend';
    else if (valve.coilB) valve.spool = 'retract';
    else if (valve.type === 'single') valve.spool = 'retract';
  }

  function setVacuum(state, on) {
    state.vacuum.command = !!on;
    if (!state.vacuum.command) state.vacuum.holding = false;
    return state.vacuum.command;
  }

  function setThrottle(state, direction, ratio) {
    const key = String(direction).toLowerCase().startsWith('r') ? 'throttleRetract' : 'throttleExtend';
    state.cylinder[key] = clamp(finite(ratio, state.cylinder[key]), .05, 1);
    return state.cylinder[key];
  }

  function connectTube(state, from, to, options = {}) {
    if (!PORTS.includes(from) || !PORTS.includes(to) || from === to) return false;
    const id = options.id || `T${String(state.tubes.length + 1).padStart(2, '0')}`;
    state.tubes = state.tubes.filter(item => item.id !== id);
    state.tubes.push(tube(id, from, to, options));
    return id;
  }

  function removeTube(state, id) {
    const before = state.tubes.length;
    state.tubes = state.tubes.filter(item => item.id !== String(id));
    return state.tubes.length !== before;
  }

  function setTubeLeak(state, id, severity) {
    const item = state.tubes.find(value => value.id === String(id));
    if (!item) return false;
    item.leak = clamp(finite(severity, 0), 0, 1);
    return true;
  }

  function unionFind() {
    const parent = Object.fromEntries(PORTS.map(port => [port, port]));
    const find = value => {
      while (parent[value] !== value) { parent[value] = parent[parent[value]]; value = parent[value]; }
      return value;
    };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
    return { parent, find, join };
  }

  function network(state) {
    const uf = unionFind();
    const leaks = {};
    for (const item of state.tubes) {
      if (!item.enabled || !PORTS.includes(item.from) || !PORTS.includes(item.to)) continue;
      uf.join(item.from, item.to);
    }
    uf.join('dist.IN', 'dist.1'); uf.join('dist.IN', 'dist.2'); uf.join('dist.IN', 'dist.3');
    if (!state.valve.conflict) {
      if (state.valve.spool === 'extend') { uf.join('valve.P', 'valve.A'); uf.join('valve.B', 'valve.EB'); }
      else { uf.join('valve.P', 'valve.B'); uf.join('valve.A', 'valve.EA'); }
    }
    for (const item of state.tubes) {
      if (!item.enabled || !item.leak || !PORTS.includes(item.from)) continue;
      const root = uf.find(item.from); leaks[root] = Math.max(leaks[root] || 0, item.leak);
    }
    return { ...uf, leaks };
  }

  function evaluatePressure(state) {
    updateSpool(state);
    const first = network(state);
    const sourceRoot = first.find('source.OUT');
    const inputRoot = first.find('service.IN');
    const inputLeak = first.leaks[inputRoot] || 0;
    state.service.inputBar = state.source.on && sourceRoot === inputRoot ? state.source.pressureBar * (1 - inputLeak) : 0;
    state.service.outputBar = Math.min(state.service.inputBar, state.service.regulatorBar);

    const net = network(state);
    const sourceValues = [
      ['source.OUT', state.source.on ? state.source.pressureBar : 0],
      ['service.OUT', state.service.outputBar], ['valve.EA', 0], ['valve.EB', 0]
    ];
    const roots = {};
    for (const [port, value] of sourceValues) {
      const root = net.find(port);
      if (value > 0) roots[root] = Math.max(roots[root] || 0, value);
      else if (roots[root] == null) roots[root] = 0;
    }
    for (const port of PORTS) {
      const root = net.find(port), reduction = 1 - (net.leaks[root] || 0);
      state.pressures[port] = Number(((roots[root] || 0) * reduction).toFixed(4));
    }
    state.cylinder.pressureA = state.pressures['cylinder.A'];
    state.cylinder.pressureB = state.pressures['cylinder.B'];
    state.vacuum.pressureBar = state.vacuum.command ? state.pressures['vacuum.P'] : 0;
    state.vacuum.holding = state.vacuum.command && state.vacuum.partPresent && state.vacuum.pressureBar >= 3;
  }

  function updateCylinderSensors(state) {
    const cylinder = state.cylinder;
    cylinder.position = clamp(cylinder.position, 0, 1);
    cylinder.extended = cylinder.position >= .995;
    cylinder.retracted = cylinder.position <= .005;
  }

  function evaluateFaults(state) {
    const faults = [];
    if (state.valve.conflict) faults.push({ code: 'COIL_CONFLICT', message: 'A/B 코일 동시 여자' });
    const connected = new Set();
    state.tubes.filter(item => item.enabled).forEach(item => { connected.add(item.from); connected.add(item.to); });
    for (const port of ['service.IN','service.OUT','valve.P','cylinder.A','cylinder.B']) {
      if (!connected.has(port)) faults.push({ code: 'OPEN_PORT', port, message: `${port} 미결선` });
    }
    const worstLeak = Math.max(0, ...state.tubes.map(item => item.enabled ? item.leak : 0));
    if (state.source.on && worstLeak >= .35) faults.push({ code: 'AIR_LEAK', message: `공압 누설 ${Math.round(worstLeak * 100)}%` });
    state.faults = faults;
    if (faults.length && state.auto.running) stopAuto(state, faults[0].message, true);
    return faults;
  }

  function moveCylinder(state, dt) {
    const cylinder = state.cylinder;
    const delta = cylinder.pressureA - cylinder.pressureB;
    if (Math.abs(delta) < .15 || state.valve.conflict) { cylinder.velocityMmS = 0; return; }
    const direction = Math.sign(delta);
    const throttle = direction > 0 ? cylinder.throttleExtend : cylinder.throttleRetract;
    const ratio = clamp(Math.abs(delta) / Math.max(.1, state.service.regulatorBar), 0, 1);
    cylinder.velocityMmS = direction * cylinder.speedMmS * throttle * ratio;
    cylinder.position = clamp(cylinder.position + cylinder.velocityMmS * dt / cylinder.strokeMm, 0, 1);
    updateCylinderSensors(state);
    if ((direction > 0 && cylinder.extended) || (direction < 0 && cylinder.retracted)) cylinder.velocityMmS = 0;
  }

  function startAuto(state) {
    if (state.faults.length) return false;
    setSupply(state, true);
    state.auto.running = true; state.auto.state = 'EXTEND'; state.auto.timer = 0; state.auto.message = '실린더 전진';
    setCoil(state, 'B', false); setCoil(state, 'A', true);
    addEvent(state, 'auto', '공압 자동 사이클 시작');
    return true;
  }

  function stopAuto(state, reason = '정지', fault = false) {
    state.auto.running = false; state.auto.state = fault ? 'FAULT' : 'IDLE'; state.auto.timer = 0; state.auto.message = reason;
    state.valve.coilA = state.valve.coilB = false; updateSpool(state); setVacuum(state, false);
    addEvent(state, fault ? 'alarm' : 'auto', reason);
    return state;
  }

  function resetFaults(state) {
    state.valve.coilA = state.valve.coilB = false; state.valve.conflict = false; updateSpool(state);
    evaluateFaults(state);
    if (!state.faults.length) { state.auto.state = 'IDLE'; state.auto.message = '대기'; }
    return state.faults.length === 0;
  }

  function autoStep(state, dt) {
    if (!state.auto.running) return;
    state.auto.timer += dt;
    if (state.auto.timer > 12) { stopAuto(state, '동작 시간초과', true); return; }
    if (state.auto.state === 'EXTEND' && state.cylinder.extended) {
      state.auto.state = 'DWELL'; state.auto.timer = 0; state.auto.message = '전진단 대기'; setVacuum(state, true);
    } else if (state.auto.state === 'DWELL' && state.auto.timer >= .5) {
      state.auto.state = 'RETRACT'; state.auto.timer = 0; state.auto.message = '실린더 후진'; setCoil(state, 'A', false); setCoil(state, 'B', true);
    } else if (state.auto.state === 'RETRACT' && state.cylinder.retracted) {
      state.auto.running = false; state.auto.state = 'COMPLETE'; state.auto.timer = 0; state.auto.message = '1사이클 완료'; state.auto.cycleCount += 1;
      state.valve.coilA = state.valve.coilB = false; updateSpool(state); setVacuum(state, false); addEvent(state, 'complete', '공압 1사이클 완료');
    }
  }

  function evaluate(state, dt) {
    evaluatePressure(state); evaluateFaults(state); moveCylinder(state, dt); autoStep(state, dt); refreshMemory(state); return state;
  }

  function tick(state, rawDt) {
    let remaining = clamp(finite(rawDt, 0), 0, 5);
    while (remaining > 1e-10) { const dt = Math.min(STEP, remaining); state.elapsed += dt; evaluate(state, dt); remaining -= dt; }
    if (!rawDt) evaluate(state, 0);
    return state;
  }

  function getProfile(stateOrId) { return PROFILES[profileId(typeof stateOrId === 'object' ? stateOrId.profileId : stateOrId)]; }
  function setProfile(state, id) {
    const next = profileId(id);
    if (next === state.profileId) return next;
    stopAuto(state, 'PLC 제조사 프로필 전환');
    setCoil(state, 'A', false); setCoil(state, 'B', false); setVacuum(state, false); setSupply(state, false);
    state.profileId = next; state.memory = {}; evaluate(state, 0);
    addEvent(state, 'profile', `${getProfile(state).vendor} 주소 프로필 선택 · 이전 출력 안전 해제`);
    return state.profileId;
  }

  function refreshMemory(state) {
    const p = getProfile(state), m = state.memory;
    m[address(p.status.ready)] = state.source.on && state.service.outputBar >= 3 && !state.faults.length;
    m[address(p.status.extended)] = state.cylinder.extended; m[address(p.status.retracted)] = state.cylinder.retracted;
    m[address(p.status.vacuumOk)] = state.vacuum.holding; m[address(p.status.busy)] = state.auto.running;
    m[address(p.status.complete)] = state.auto.state === 'COMPLETE'; m[address(p.status.fault)] = state.faults.length > 0 || state.auto.state === 'FAULT';
    m[address(p.data.pressure)] = Number(state.service.outputBar.toFixed(2)); m[address(p.data.stroke)] = Number((state.cylinder.position * state.cylinder.strokeMm).toFixed(2));
    m[address(p.data.cycleCount)] = state.auto.cycleCount;
    return m;
  }

  function readDevice(state, raw) {
    const key = address(raw), p = getProfile(state), known = new Set(Object.values(p.status).concat(Object.values(p.data), Object.values(p.commands)).map(address));
    if (!known.has(key)) return undefined;
    refreshMemory(state); return state.memory[key] ?? false;
  }

  function writeDevice(state, raw, value) {
    const key = address(raw), p = getProfile(state); let accepted = true;
    const command = Object.entries(p.commands).find(([, mapped]) => address(mapped) === key)?.[0];
    if (!command) return { ok: false, error: `${key || '(빈 주소)'}는 쓰기 가능한 명령 주소가 아닙니다` };
    const on = bool(value); state.memory[key] = on;
    if (command === 'supply') setSupply(state, on);
    else if (command === 'coilA') accepted = setCoil(state, 'A', on);
    else if (command === 'coilB') accepted = setCoil(state, 'B', on);
    else if (command === 'vacuum') setVacuum(state, on);
    else if (command === 'auto' && on) accepted = startAuto(state);
    else if (command === 'stop' && on) stopAuto(state);
    else if (command === 'reset' && on) accepted = resetFaults(state);
    evaluate(state, 0);
    return { ok: true, address: key, value: on, accepted: accepted !== false };
  }

  function exportState(state) {
    return clone({ version: VERSION, elapsed: state.elapsed, profileId: state.profileId, source: state.source, service: state.service, valve: state.valve, cylinder: state.cylinder, vacuum: state.vacuum, tubes: state.tubes, auto: state.auto, events: state.events });
  }

  function importState(state, saved = {}) {
    if (!saved || typeof saved !== 'object') return state;
    state.profileId = profileId(saved.profileId);
    state.elapsed = Math.max(0, finite(saved.elapsed, 0));
    if (saved.source) Object.assign(state.source, saved.source, { on: false });
    if (saved.service) Object.assign(state.service, saved.service, { inputBar: 0, outputBar: 0 });
    if (saved.valve) Object.assign(state.valve, saved.valve, { coilA: false, coilB: false, conflict: false });
    if (saved.cylinder) Object.assign(state.cylinder, saved.cylinder, { velocityMmS: 0, pressureA: 0, pressureB: 0 });
    if (saved.vacuum) Object.assign(state.vacuum, saved.vacuum, { command: false, pressureBar: 0, holding: false });
    if (Array.isArray(saved.tubes)) state.tubes = saved.tubes.map(item => tube(item.id, item.from, item.to, item));
    state.auto = { running: false, state: 'IDLE', timer: 0, message: '복원 후 안전 정지', cycleCount: Math.max(0, Math.trunc(finite(saved.auto?.cycleCount, 0))) };
    state.events = Array.isArray(saved.events) ? clone(saved.events).slice(-80) : [];
    updateSpool(state); updateCylinderSensors(state); evaluate(state, 0); return state;
  }

  return {
    version: VERSION, VERSION, PORTS: [...PORTS], DEFAULT_TUBES: clone(DEFAULT_TUBES), PROFILES: clone(PROFILES),
    createState, create: createState, tick, evaluate, setSupply, setRegulator, setValveType, setCoil, setVacuum, setThrottle,
    connectTube, removeTube, setTubeLeak, startAuto, stopAuto, resetFaults, getProfile, setProfile, readDevice, writeDevice,
    refreshMemory, exportState, importState
  };
});
