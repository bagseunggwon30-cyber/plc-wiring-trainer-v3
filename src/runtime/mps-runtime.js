(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.PLCTrainerMPSRuntime = api;
    root.PLCMPSRuntime = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.7.1';
  const EPS = 1e-9;
  const MAX_TICK_STEP = 0.02;
  const MATERIALS = Object.freeze(['steel', 'plastic']);
  const BIT_BANKS = new Set(['P', 'M', 'D', 'X', 'Y']);

  /*
   * SoV-KDP MPS I/O map. Output and input indexes are deliberately the
   * primary interface: aliases only make the teaching UI easier to read.
   */
  const OUTPUT_DEFINITIONS = Object.freeze([
    Object.freeze({ index: 0, address: 'O0', key: 'supplyForward', label: 'Supply F' }),
    Object.freeze({ index: 1, address: 'O1', key: 'supplyReverse', label: 'Supply R' }),
    Object.freeze({ index: 2, address: 'O2', key: 'drillCylinder', label: 'Drill cylinder' }),
    Object.freeze({ index: 3, address: 'O3', key: 'distributionForward', label: 'Distribution F' }),
    Object.freeze({ index: 4, address: 'O4', key: 'distributionReverse', label: 'Distribution R' }),
    Object.freeze({ index: 5, address: 'O5', key: 'emissionForward', label: 'Emission F' }),
    Object.freeze({ index: 6, address: 'O6', key: 'emissionReverse', label: 'Emission R' }),
    Object.freeze({ index: 7, address: 'O7', key: 'liftPneumaticForward', label: 'Lift pneumatic F' }),
    Object.freeze({ index: 8, address: 'O8', key: 'liftPneumaticReverse', label: 'Lift pneumatic R' }),
    Object.freeze({ index: 9, address: 'O9', key: 'vacuum', label: 'Vacuum' }),
    Object.freeze({ index: 10, address: 'O10', key: 'unloadingForward', label: 'Unloading F' }),
    Object.freeze({ index: 11, address: 'O11', key: 'unloadingReverse', label: 'Unloading R' }),
    Object.freeze({ index: 12, address: 'O12', key: 'stopper', label: 'Stopper' }),
    Object.freeze({ index: 13, address: 'O13', key: 'drillMotor', label: 'Drill motor' }),
    Object.freeze({ index: 14, address: 'O14', key: 'conveyor', label: 'Conveyor' }),
    Object.freeze({ index: 15, address: 'O15', key: 'towerRed', label: 'Tower red' }),
    Object.freeze({ index: 16, address: 'O16', key: 'towerYellow', label: 'Tower yellow' }),
    Object.freeze({ index: 17, address: 'O17', key: 'towerGreen', label: 'Tower green' })
  ]);

  const INPUT_DEFINITIONS = Object.freeze([
    Object.freeze({ index: 0, address: 'I0', key: 'supplyForwardLimit', label: 'Supply F limit' }),
    Object.freeze({ index: 1, address: 'I1', key: 'supplyReverseLimit', label: 'Supply R limit' }),
    Object.freeze({ index: 2, address: 'I2', key: 'drillForwardLimit', label: 'Drill F limit' }),
    Object.freeze({ index: 3, address: 'I3', key: 'drillReverseLimit', label: 'Drill R limit' }),
    Object.freeze({ index: 4, address: 'I4', key: 'distributionForwardLimit', label: 'Distribution F limit' }),
    Object.freeze({ index: 5, address: 'I5', key: 'distributionReverseLimit', label: 'Distribution R limit' }),
    Object.freeze({ index: 6, address: 'I6', key: 'emissionForwardLimit', label: 'Emission F limit' }),
    Object.freeze({ index: 7, address: 'I7', key: 'emissionReverseLimit', label: 'Emission R limit' }),
    Object.freeze({ index: 8, address: 'I8', key: 'stopperForwardLimit', label: 'Stopper F limit' }),
    Object.freeze({ index: 9, address: 'I9', key: 'stopperReverseLimit', label: 'Stopper R limit' }),
    Object.freeze({ index: 10, address: 'I10', key: 'liftPneumaticForwardLimit', label: 'Lift pneumatic F limit' }),
    Object.freeze({ index: 11, address: 'I11', key: 'liftPneumaticReverseLimit', label: 'Lift pneumatic R limit' }),
    Object.freeze({ index: 12, address: 'I12', key: 'unloadingForwardLimit', label: 'Unloading F limit' }),
    Object.freeze({ index: 13, address: 'I13', key: 'unloadingReverseLimit', label: 'Unloading R limit' }),
    Object.freeze({ index: 14, address: 'I14', key: 'supplyPhoto', label: 'Supply photo sensor' }),
    Object.freeze({ index: 15, address: 'I15', key: 'distributionPhoto', label: 'Distribution photo sensor' }),
    Object.freeze({ index: 16, address: 'I16', key: 'inductiveSteel', label: 'Inductive sensor' }),
    Object.freeze({ index: 17, address: 'I17', key: 'capacitiveAny', label: 'Capacitive sensor' }),
    Object.freeze({ index: 18, address: 'I18', key: 'endPhoto', label: 'End photo sensor' }),
    Object.freeze({ index: 19, address: 'I19', key: 'vacuumAcquired', label: 'Vacuum acquired' }),
    Object.freeze({ index: 20, address: 'I20', key: 'reserved20', label: 'Reserved' }),
    Object.freeze({ index: 21, address: 'I21', key: 'reserved21', label: 'Reserved' }),
    Object.freeze({ index: 22, address: 'I22', key: 'reserved22', label: 'Reserved' }),
    Object.freeze({ index: 23, address: 'I23', key: 'reserved23', label: 'Reserved' }),
    Object.freeze({ index: 24, address: 'I24', key: 'liftServoReverseLimitNC', label: 'Lift servo RLS (NC)' }),
    Object.freeze({ index: 25, address: 'I25', key: 'liftServoDogNO', label: 'Lift servo DOG (NO)' }),
    Object.freeze({ index: 26, address: 'I26', key: 'liftServoForwardLimitNC', label: 'Lift servo FLS (NC)' })
  ]);

  const OUTPUT_NAMES = Object.freeze(OUTPUT_DEFINITIONS.map(item => item.key));
  const SENSOR_NAMES = Object.freeze(INPUT_DEFINITIONS.map(item => item.key));

  const AXIS_DEFINITIONS = Object.freeze({
    supply: Object.freeze({ mode: 'double', forward: 0, reverse: 1, rate: 0.8, inputForward: 0, inputReverse: 1 }),
    drill: Object.freeze({ mode: 'single', output: 2, rate: 1.2, inputForward: 2, inputReverse: 3 }),
    distribution: Object.freeze({ mode: 'double', forward: 3, reverse: 4, rate: 0.6, inputForward: 4, inputReverse: 5 }),
    emission: Object.freeze({ mode: 'double', forward: 5, reverse: 6, rate: 1.0, inputForward: 6, inputReverse: 7 }),
    stopper: Object.freeze({ mode: 'single', output: 12, rate: 1.6, inputForward: 8, inputReverse: 9 }),
    liftPneumatic: Object.freeze({ mode: 'double', forward: 7, reverse: 8, rate: 0.4, inputForward: 10, inputReverse: 11 }),
    unloading: Object.freeze({ mode: 'double', forward: 10, reverse: 11, rate: 1.4, inputForward: 12, inputReverse: 13 })
  });

  const DEFAULT_CONFIG = Object.freeze({
    conveyor: Object.freeze({
      length: 0.62,
      speed: 0.06,
      spawnX: 0.0,
      stopperX: 0.34,
      minimumGap: 0.004,
      maxWorkpieces: 24
    }),
    workpiece: Object.freeze({ length: 0.028 }),
    sensors: Object.freeze({
      supplyPhoto: Object.freeze({ x: 0.055, width: 0.018 }),
      distributionPhoto: Object.freeze({ x: 0.255, width: 0.018 }),
      inductiveSteel: Object.freeze({ x: 0.285, width: 0.016 }),
      capacitiveAny: Object.freeze({ x: 0.285, width: 0.016 }),
      endPhoto: Object.freeze({ x: 0.565, width: 0.018 }),
      vacuum: Object.freeze({ x: 0.455, width: 0.025 })
    }),
    vacuum: Object.freeze({ unloadingThreshold: 0.85 }),
    liftServo: Object.freeze({ speed: 0.75, dogMinimum: 0.47, dogMaximum: 0.53 })
  });

  const AUTO_STEPS = Object.freeze({ IDLE: 0, PLC_CONTROL: 10, PAUSED: 60, FAULT: 900 });

  const OUTPUT_ALIASES = Object.freeze({
    supplyf: 0, supplyforward: 0, supplyextend: 0,
    supplyr: 1, supplyreverse: 1, supplyretract: 1,
    drill: 2, drillcylinder: 2,
    distributionf: 3, distributionforward: 3, pusher: 3, push: 3,
    distributionr: 4, distributionreverse: 4,
    emissionf: 5, emissionforward: 5,
    emissionr: 6, emissionreverse: 6,
    liftf: 7, liftforward: 7, liftpneumaticforward: 7,
    liftr: 8, liftreverse: 8, liftpneumaticreverse: 8,
    vacuum: 9, pick: 9, picker: 9,
    unloadingf: 10, unloadingforward: 10,
    unloadingr: 11, unloadingreverse: 11,
    stopper: 12, stopperextended: 12,
    drillmotor: 13,
    conveyor: 14, conveyoron: 14, belt: 14, motor: 14,
    towerred: 15, redlamp: 15,
    toweryellow: 16, yellowlamp: 16,
    towergreen: 17, greenlamp: 17
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asBool(value) {
    if (value === true || value === 1 || value === '1') return true;
    const text = String(value).trim().toUpperCase();
    return text === 'TRUE' || text === 'ON';
  }

  function normalizedKey(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function normalizeAddress(value) {
    return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, '');
  }

  function normalizeMaterial(value) {
    const text = String(value == null ? 'plastic' : value).trim().toLowerCase();
    if (['steel', 'metal', 'iron', '강재', '금속'].includes(text)) return 'steel';
    if (['plastic', 'nonmetal', 'non-metal', '플라스틱'].includes(text)) return 'plastic';
    return null;
  }

  function outputIndex(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < OUTPUT_DEFINITIONS.length) return value;
    const raw = String(value == null ? '' : value).trim();
    const bit = /^(?:O|Y)?(\d+)$/i.exec(raw);
    if (bit) {
      const index = Number(bit[1]);
      if (index >= 0 && index < OUTPUT_DEFINITIONS.length) return index;
    }
    const key = normalizedKey(raw);
    if (Object.prototype.hasOwnProperty.call(OUTPUT_ALIASES, key)) return OUTPUT_ALIASES[key];
    return OUTPUT_DEFINITIONS.find(item => normalizedKey(item.key) === key)?.index ?? null;
  }

  function inputIndex(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < INPUT_DEFINITIONS.length) return value;
    const raw = String(value == null ? '' : value).trim();
    const bit = /^(?:I|X)?(\d+)$/i.exec(raw);
    if (bit) {
      const index = Number(bit[1]);
      if (index >= 0 && index < INPUT_DEFINITIONS.length) return index;
    }
    const key = normalizedKey(raw);
    return INPUT_DEFINITIONS.find(item => normalizedKey(item.key) === key)?.index ?? null;
  }

  function normalizeOutput(value) {
    const index = outputIndex(value);
    return index == null ? null : OUTPUT_DEFINITIONS[index].key;
  }

  function makeProfile(id, vendor, family, style) {
    const isLs = id === 'ls';
    const outputAddress = index => isLs
      ? `P${String(100 + index).padStart(5, '0')}`
      : `Y${(0x100 + index).toString(16).toUpperCase()}`;
    const inputAddress = index => isLs
      ? `P${String(120 + index).padStart(5, '0')}`
      : `X${(0x100 + index).toString(16).toUpperCase()}`;
    const outputs = {};
    const inputs = {};
    for (const definition of OUTPUT_DEFINITIONS) outputs[definition.key] = outputAddress(definition.index);
    for (const definition of INPUT_DEFINITIONS) inputs[definition.key] = inputAddress(definition.index);
    const commands = {
      autoStart: isLs ? 'M0300' : 'M300',
      autoStop: isLs ? 'M0301' : 'M301',
      reset: isLs ? 'M0302' : 'M302',
      ...outputs
    };
    commands.conveyor = outputs.conveyor;
    commands.stopper = outputs.stopper;
    commands.pusher = outputs.distributionForward;
    commands.pick = outputs.vacuum;
    const status = {
      ...inputs,
      entrance: inputs.supplyPhoto,
      position: inputs.distributionPhoto,
      metal: inputs.inductiveSteel,
      exit: inputs.endPhoto,
      autoRunning: isLs ? 'M0310' : 'M310',
      fault: isLs ? 'M0311' : 'M311',
      jam: isLs ? 'M0312' : 'M312',
      step: isLs ? 'D0310' : 'D310'
    };
    const counters = {
      total: isLs ? 'D0300' : 'D300',
      steel: isLs ? 'D0301' : 'D301',
      plastic: isLs ? 'D0302' : 'D302',
      exited: isLs ? 'D0303' : 'D303'
    };
    return {
      id, vendor, family, addressStyle: style,
      aliases: isLs ? ['ls', 'xgb', 'xg5000'] : ['mitsubishi', 'qnu', 'q-series', 'qseries'],
      simulationOnly: true,
      transport: null,
      addresses: { commands, outputs, inputs, status, counters },
      commands, outputs, inputs, status, counters
    };
  }

  const PROFILES = {
    ls: makeProfile('ls', 'LS Electric', 'XGB / XG5000 teaching image', 'P / M / D'),
    mitsubishi: makeProfile('mitsubishi', 'Mitsubishi Electric', 'QnU teaching image', 'X / Y / M / D')
  };

  function resolveProfile(value) {
    if (value && typeof value === 'object') value = value.id;
    const key = String(value == null ? 'ls' : value).trim().toLowerCase();
    for (const profile of Object.values(PROFILES)) {
      if (profile.id === key || profile.aliases.includes(key)) return profile.id;
    }
    return null;
  }

  function getProfile(stateOrId) {
    const raw = stateOrId && typeof stateOrId === 'object'
      ? stateOrId.profileId || stateOrId.profile
      : stateOrId;
    return PROFILES[resolveProfile(raw) || 'ls'];
  }

  function createConfig(options = {}) {
    const source = options.config || {};
    const conveyor = { ...DEFAULT_CONFIG.conveyor, ...(source.conveyor || {}), ...(options.conveyor || {}) };
    const workpiece = { ...DEFAULT_CONFIG.workpiece, ...(source.workpiece || {}), ...(options.workpiece || {}) };
    const vacuum = { ...DEFAULT_CONFIG.vacuum, ...(source.vacuum || {}), ...(options.vacuum || {}) };
    const liftServo = { ...DEFAULT_CONFIG.liftServo, ...(source.liftServo || {}), ...(options.liftServo || {}) };
    const sensorSource = { ...(source.sensors || {}), ...(options.sensors || {}) };
    const sensors = {};
    for (const [name, defaults] of Object.entries(DEFAULT_CONFIG.sensors)) sensors[name] = { ...defaults, ...(sensorSource[name] || {}) };

    conveyor.length = Math.max(0.1, finite(conveyor.length, DEFAULT_CONFIG.conveyor.length));
    conveyor.speed = Math.max(0, finite(conveyor.speed, DEFAULT_CONFIG.conveyor.speed));
    conveyor.spawnX = finite(conveyor.spawnX, DEFAULT_CONFIG.conveyor.spawnX);
    conveyor.stopperX = clamp(finite(conveyor.stopperX, DEFAULT_CONFIG.conveyor.stopperX), 0, conveyor.length);
    conveyor.minimumGap = Math.max(0, finite(conveyor.minimumGap, DEFAULT_CONFIG.conveyor.minimumGap));
    conveyor.maxWorkpieces = clamp(Math.trunc(finite(conveyor.maxWorkpieces, DEFAULT_CONFIG.conveyor.maxWorkpieces)), 1, 100);
    workpiece.length = clamp(finite(workpiece.length, DEFAULT_CONFIG.workpiece.length), 0.005, 0.15);
    for (const [name, sensor] of Object.entries(sensors)) {
      sensor.x = clamp(finite(sensor.x, DEFAULT_CONFIG.sensors[name].x), 0, conveyor.length);
      sensor.width = Math.max(0.001, finite(sensor.width, DEFAULT_CONFIG.sensors[name].width));
    }
    vacuum.unloadingThreshold = clamp(finite(vacuum.unloadingThreshold, DEFAULT_CONFIG.vacuum.unloadingThreshold), 0, 1);
    liftServo.speed = Math.max(0.001, finite(liftServo.speed, DEFAULT_CONFIG.liftServo.speed));
    liftServo.dogMinimum = clamp(finite(liftServo.dogMinimum, DEFAULT_CONFIG.liftServo.dogMinimum), 0, 1);
    liftServo.dogMaximum = clamp(finite(liftServo.dogMaximum, DEFAULT_CONFIG.liftServo.dogMaximum), liftServo.dogMinimum, 1);
    return { conveyor, workpiece, sensors, vacuum, liftServo };
  }

  function createAxis(name, definition) {
    return {
      name,
      mode: definition.mode,
      position: 0,
      t: 0,
      rate: definition.rate,
      direction: 0,
      lastDirection: 0,
      moving: false,
      forwardLimit: false,
      reverseLimit: true
    };
  }

  function emptyOutputs() {
    const outputs = {};
    for (const definition of OUTPUT_DEFINITIONS) {
      outputs[definition.address] = false;
      outputs[definition.key] = false;
    }
    return outputs;
  }

  function emptySensors() {
    const sensors = {};
    for (const definition of INPUT_DEFINITIONS) {
      sensors[definition.address] = false;
      sensors[definition.key] = false;
    }
    return sensors;
  }

  function emptySensorItems() {
    return {
      supplyPhoto: [], distributionPhoto: [], inductiveSteel: [],
      capacitiveAny: [], endPhoto: [], vacuum: []
    };
  }

  function emptyCounters() {
    return { total: 0, steel: 0, plastic: 0, exited: 0, pushed: 0, picked: 0, rejected: 0, faults: 0 };
  }

  function emptyMemory() {
    return { P: {}, M: {}, D: {}, X: {}, Y: {} };
  }

  function emptyAuto() {
    return {
      running: false,
      state: 'IDLE',
      previous: 'IDLE',
      timer: 0,
      cycles: 0,
      message: '외부 PLC 출력 대기',
      fault: null
    };
  }

  function syncOutputView(state) {
    if (!state.outputs) state.outputs = emptyOutputs();
    for (const definition of OUTPUT_DEFINITIONS) {
      const value = !!state.outputBits[definition.index];
      state.outputs[definition.address] = value;
      state.outputs[definition.key] = value;
    }
    // Compatibility aliases used by the pre-parity automation-labs UI.
    state.outputs.conveyorOn = !!state.outputBits[14];
    state.outputs.stopperExtended = !!state.outputBits[12];
    state.outputs.pusher = !!state.outputBits[3];
    state.outputs.pusherExtended = !!state.outputBits[3];
    state.outputs.pick = !!state.outputBits[9];
    state.outputs.pickActive = !!state.outputBits[9];
    return state.outputs;
  }

  function setInputBit(state, index, value) {
    state.inputBits[index] = !!value;
    const definition = INPUT_DEFINITIONS[index];
    state.inputs[definition.address] = !!value;
    state.inputs[definition.key] = !!value;
    state.sensors[definition.address] = !!value;
    state.sensors[definition.key] = !!value;
  }

  function syncInputAliases(state) {
    state.sensors.entrance = state.sensors.supplyPhoto;
    state.sensors.entranceSensor = state.sensors.supplyPhoto;
    state.sensors.position = state.sensors.distributionPhoto;
    state.sensors.positionSensor = state.sensors.distributionPhoto;
    state.sensors.metal = state.sensors.inductiveSteel;
    state.sensors.metalSensor = state.sensors.inductiveSteel;
    state.sensors.exit = state.sensors.endPhoto;
    state.sensors.exitSensor = state.sensors.endPhoto;
  }

  function addEvent(state, type, message, details) {
    const event = { time: Number(state.elapsed.toFixed(6)), type, message };
    if (details !== undefined) event.details = clone(details);
    state.events.push(event);
    if (state.events.length > 120) state.events.splice(0, state.events.length - 120);
  }

  function createState(options = {}) {
    const profileId = resolveProfile(options.profileId || options.profile) || 'ls';
    const actuators = {};
    for (const [name, definition] of Object.entries(AXIS_DEFINITIONS)) actuators[name] = createAxis(name, definition);
    const state = {
      version: VERSION,
      elapsed: 0,
      profileId,
      profile: profileId,
      mode: 'manual',
      config: createConfig(options),
      outputBits: Array(OUTPUT_DEFINITIONS.length).fill(false),
      inputBits: Array(INPUT_DEFINITIONS.length).fill(false),
      outputs: emptyOutputs(),
      inputs: emptySensors(),
      sensors: emptySensors(),
      sensorItems: emptySensorItems(),
      actuators,
      liftServo: {
        position: 0,
        t: 0,
        target: 0,
        speed: createConfig(options).liftServo.speed,
        moving: false,
        direction: 0
      },
      vacuum: { workpieceId: null, acquired: false },
      workpieces: [],
      completed: [],
      nextWorkpieceId: 1,
      counters: emptyCounters(),
      auto: emptyAuto(),
      fault: null,
      jammed: false,
      events: [],
      memory: emptyMemory()
    };
    syncOutputView(state);
    if (Array.isArray(options.workpieces)) {
      for (const item of options.workpieces) addWorkpiece(state, item.type || item.material, item);
    }
    if (options.saved) importState(state, options.saved);
    updateInputs(state);
    initializeMemory(state);
    return state;
  }

  function nextWorkpieceId(state) {
    const id = `WP-${String(state.nextWorkpieceId).padStart(4, '0')}`;
    state.nextWorkpieceId += 1;
    return id;
  }

  function addWorkpiece(state, material = 'plastic', options = {}) {
    if (material && typeof material === 'object') {
      options = material;
      material = options.material || options.type;
    }
    const type = normalizeMaterial(material);
    if (!type || state.workpieces.length >= state.config.conveyor.maxWorkpieces) return false;
    const length = clamp(finite(options.length, state.config.workpiece.length), 0.005, 0.15);
    const x = finite(options.x ?? options.position ?? options.travel, state.config.conveyor.spawnX);
    const item = {
      id: options.id ? String(options.id) : nextWorkpieceId(state),
      type,
      material: type,
      metal: type === 'steel',
      x,
      position: x,
      travel: x,
      length,
      state: options.state || 'on-conveyor',
      blocked: false,
      heldByVacuum: false,
      countedExit: false,
      createdAt: Number(state.elapsed.toFixed(6))
    };
    state.workpieces.push(item);
    state.workpieces.sort((a, b) => b.x - a.x);
    addEvent(state, 'feed', `${type === 'steel' ? '강재' : '플라스틱'} 워크 투입`, { id: item.id });
    updateInputs(state);
    refreshMemory(state);
    return item;
  }

  function setWorkpieceLength(state, length, options = {}) {
    const value = clamp(finite(length, state.config.workpiece.length), 0.005, 0.15);
    state.config.workpiece.length = value;
    if (options.updateExisting) {
      for (const item of state.workpieces) item.length = value;
    }
    updateInputs(state);
    refreshMemory(state);
    if (options.emit !== false) addEvent(state, 'configuration', `워크 길이 ${(value * 1000).toFixed(0)} mm`, { updateExisting: !!options.updateExisting });
    return value;
  }

  function removeWorkpiece(state, id) {
    const index = state.workpieces.findIndex(item => item.id === id);
    if (index < 0) return false;
    const removed = state.workpieces.splice(index, 1)[0];
    if (state.vacuum.workpieceId === removed.id) {
      state.vacuum.workpieceId = null;
      state.vacuum.acquired = false;
    }
    updateInputs(state);
    refreshMemory(state);
    return removed;
  }

  function workpieceAt(state, id) {
    return state.workpieces.find(item => item.id === id) || null;
  }

  function itemIntersectsSensor(item, sensor) {
    return Math.abs(item.x - sensor.x) <= item.length / 2 + sensor.width / 2 + EPS;
  }

  function updateVacuum(state) {
    const vacuumOn = !!state.outputBits[9];
    let held = workpieceAt(state, state.vacuum.workpieceId);
    if (!vacuumOn) {
      if (held) {
        held.heldByVacuum = false;
        held.state = 'on-conveyor';
      }
      state.vacuum.workpieceId = null;
      state.vacuum.acquired = false;
      return;
    }
    if (!held && state.actuators.unloading.position >= state.config.vacuum.unloadingThreshold) {
      held = state.workpieces.find(item => item.state === 'on-conveyor' && itemIntersectsSensor(item, state.config.sensors.vacuum));
      if (held) {
        held.heldByVacuum = true;
        held.state = 'vacuum-held';
        state.vacuum.workpieceId = held.id;
      }
    }
    state.vacuum.acquired = !!held;
  }

  function updateInputs(state) {
    const items = emptySensorItems();
    for (const item of state.workpieces) {
      if (item.state !== 'on-conveyor' && item.state !== 'vacuum-held') continue;
      if (itemIntersectsSensor(item, state.config.sensors.supplyPhoto)) items.supplyPhoto.push(item.id);
      if (itemIntersectsSensor(item, state.config.sensors.distributionPhoto)) items.distributionPhoto.push(item.id);
      if (item.metal && itemIntersectsSensor(item, state.config.sensors.inductiveSteel)) items.inductiveSteel.push(item.id);
      if (itemIntersectsSensor(item, state.config.sensors.capacitiveAny)) items.capacitiveAny.push(item.id);
      if (itemIntersectsSensor(item, state.config.sensors.endPhoto)) items.endPhoto.push(item.id);
      if (itemIntersectsSensor(item, state.config.sensors.vacuum)) items.vacuum.push(item.id);
    }
    state.sensorItems = items;

    for (const [name, definition] of Object.entries(AXIS_DEFINITIONS)) {
      const axis = state.actuators[name];
      setInputBit(state, definition.inputForward, axis.position >= 1 - EPS);
      setInputBit(state, definition.inputReverse, axis.position <= EPS);
    }
    setInputBit(state, 14, items.supplyPhoto.length > 0);
    setInputBit(state, 15, items.distributionPhoto.length > 0);
    setInputBit(state, 16, items.inductiveSteel.length > 0);
    setInputBit(state, 17, items.capacitiveAny.length > 0);
    setInputBit(state, 18, items.endPhoto.length > 0);
    setInputBit(state, 19, state.vacuum.acquired);
    for (let index = 20; index <= 23; index += 1) setInputBit(state, index, false);

    // NC limit switches open only while their respective limit is pressed.
    const servoPosition = state.liftServo.position;
    setInputBit(state, 24, servoPosition > EPS);
    setInputBit(state, 25, servoPosition >= state.config.liftServo.dogMinimum - EPS && servoPosition <= state.config.liftServo.dogMaximum + EPS);
    setInputBit(state, 26, servoPosition < 1 - EPS);
    syncInputAliases(state);
    return state.inputs;
  }

  function setOutput(state, rawOutput, on = true) {
    const index = outputIndex(rawOutput);
    if (index == null) return false;
    const value = asBool(on);
    if (state.outputBits[index] === value) return true;
    state.outputBits[index] = value;
    syncOutputView(state);
    addEvent(state, 'output', `${OUTPUT_DEFINITIONS[index].address} ${value ? 'ON' : 'OFF'}`, {
      index, name: OUTPUT_DEFINITIONS[index].key, value
    });
    updateVacuum(state);
    updateInputs(state);
    refreshMemory(state);
    return true;
  }

  function setOutputs(state, patch = {}) {
    let accepted = true;
    if (Array.isArray(patch)) {
      for (let index = 0; index < Math.min(patch.length, OUTPUT_DEFINITIONS.length); index += 1) {
        if (patch[index] !== undefined && !setOutput(state, index, patch[index])) accepted = false;
      }
      return accepted;
    }
    for (const [name, value] of Object.entries(patch || {})) {
      if (!setOutput(state, name, value)) accepted = false;
    }
    return accepted;
  }

  function getOutput(state, rawOutput) {
    const index = outputIndex(rawOutput);
    return index == null ? undefined : !!state.outputBits[index];
  }

  function getInput(state, rawInput) {
    const index = inputIndex(rawInput);
    if (index == null) return undefined;
    updateInputs(state);
    return !!state.inputBits[index];
  }

  function integrateAxis(axis, direction, dt) {
    axis.direction = direction;
    const previous = axis.position;
    axis.position = clamp(previous + direction * axis.rate * dt, 0, 1);
    axis.t = axis.position;
    axis.moving = Math.abs(axis.position - previous) > EPS;
    axis.forwardLimit = axis.position >= 1 - EPS;
    axis.reverseLimit = axis.position <= EPS;
  }

  function tickActuators(state, dt) {
    for (const [name, definition] of Object.entries(AXIS_DEFINITIONS)) {
      const axis = state.actuators[name];
      let direction;
      if (definition.mode === 'double') {
        const forward = !!state.outputBits[definition.forward];
        const reverse = !!state.outputBits[definition.reverse];
        if (forward && !reverse) axis.lastDirection = 1;
        else if (reverse && !forward) axis.lastDirection = -1;
        // A bistable valve keeps its last spool direction for both/neither.
        direction = axis.lastDirection;
      } else {
        direction = state.outputBits[definition.output] ? 1 : -1;
        axis.lastDirection = direction;
      }
      integrateAxis(axis, direction, dt);
    }
  }

  function tickLiftServo(state, dt) {
    const servo = state.liftServo;
    const delta = servo.target - servo.position;
    if (Math.abs(delta) <= EPS) {
      servo.position = servo.target;
      servo.t = servo.position;
      servo.direction = 0;
      servo.moving = false;
      return;
    }
    servo.direction = Math.sign(delta);
    const distance = Math.min(Math.abs(delta), servo.speed * dt);
    servo.position = clamp(servo.position + servo.direction * distance, 0, 1);
    servo.t = servo.position;
    servo.moving = distance > EPS;
  }

  function setLiftServoTarget(state, target, speed = state.config.liftServo.speed) {
    state.liftServo.target = clamp(finite(target, state.liftServo.target), 0, 1);
    state.liftServo.speed = Math.max(0.001, finite(speed, state.config.liftServo.speed));
    return state.liftServo.target;
  }

  function setLiftServoPosition(state, position) {
    const value = clamp(finite(position, state.liftServo.position), 0, 1);
    state.liftServo.position = value;
    state.liftServo.t = value;
    state.liftServo.target = value;
    state.liftServo.direction = 0;
    state.liftServo.moving = false;
    updateInputs(state);
    refreshMemory(state);
    return value;
  }

  function setActuatorPosition(state, name, position, options = {}) {
    const axis = state.actuators[name];
    if (!axis) return false;
    axis.position = axis.t = clamp(finite(position, axis.position), 0, 1);
    axis.forwardLimit = axis.position >= 1 - EPS;
    axis.reverseLimit = axis.position <= EPS;
    axis.moving = false;
    if (options.lastDirection === -1 || options.lastDirection === 0 || options.lastDirection === 1) {
      axis.lastDirection = options.lastDirection;
    }
    updateInputs(state);
    refreshMemory(state);
    return true;
  }

  function recordExit(state, item) {
    state.counters.total += 1;
    state.counters.exited += 1;
    state.counters[item.type] += 1;
    state.completed.push({
      id: item.id,
      type: item.type,
      material: item.type,
      outcome: 'exited',
      completedAt: Number(state.elapsed.toFixed(6))
    });
    if (state.completed.length > 200) state.completed.splice(0, state.completed.length - 200);
    addEvent(state, 'exit', '워크가 컨베이어 출구를 통과했습니다', { id: item.id, type: item.type });
  }

  function moveWorkpieces(state, dt) {
    if (!state.outputBits[14]) {
      for (const item of state.workpieces) item.blocked = false;
      return;
    }
    const distance = state.config.conveyor.speed * dt;
    const ordered = [...state.workpieces].sort((a, b) => b.x - a.x);
    let ahead = null;
    for (const item of ordered) {
      if (item.heldByVacuum || item.state !== 'on-conveyor') continue;
      let maximum = Infinity;
      const stopperActive = state.actuators.stopper.position >= 0.5;
      const stopperContact = state.config.conveyor.stopperX - item.length / 2;
      if (stopperActive && item.x <= stopperContact + EPS) maximum = Math.min(maximum, stopperContact);
      if (ahead) {
        const clearance = (ahead.length + item.length) / 2 + state.config.conveyor.minimumGap;
        maximum = Math.min(maximum, ahead.x - clearance);
      }
      const desired = item.x + distance;
      const next = Math.max(item.x, Math.min(desired, maximum));
      item.x = item.position = item.travel = next;
      item.blocked = next < desired - EPS;
      if (item.x > state.config.conveyor.length + item.length / 2 && !item.countedExit) {
        item.countedExit = true;
        recordExit(state, item);
        item.state = 'completed';
      }
      ahead = item;
    }
    state.workpieces = state.workpieces.filter(item => item.state !== 'completed');
  }

  function tick(state, dt) {
    let remaining = Math.max(0, finite(dt, 0));
    if (remaining <= 0) {
      updateVacuum(state);
      updateInputs(state);
      refreshMemory(state);
      return state;
    }
    while (remaining > EPS) {
      const step = Math.min(MAX_TICK_STEP, remaining);
      tickActuators(state, step);
      tickLiftServo(state, step);
      updateVacuum(state);
      moveWorkpieces(state, step);
      updateVacuum(state);
      updateInputs(state);
      state.elapsed += step;
      if (state.auto.running) state.auto.timer += step;
      remaining -= step;
    }
    syncOutputView(state);
    refreshMemory(state);
    return state;
  }

  function startAuto(state) {
    if (state.fault) return false;
    state.mode = 'external-auto';
    state.auto.previous = state.auto.state;
    state.auto.state = 'PLC_CONTROL';
    state.auto.running = true;
    state.auto.timer = 0;
    state.auto.message = '외부 PLC 출력으로 운전 중';
    addEvent(state, 'auto', '외부 PLC 제어 시작');
    refreshMemory(state);
    return true;
  }

  function stopAuto(state, reason = '외부 PLC 제어 정지') {
    state.auto.previous = state.auto.state;
    state.auto.state = 'PAUSED';
    state.auto.running = false;
    state.auto.timer = 0;
    state.auto.message = reason;
    state.mode = 'manual';
    state.outputBits.fill(false);
    for (const axis of Object.values(state.actuators)) {
      axis.direction = 0;
      axis.lastDirection = 0;
      axis.moving = false;
    }
    state.liftServo.target = state.liftServo.position;
    state.liftServo.direction = 0;
    state.liftServo.moving = false;
    syncOutputView(state);
    updateVacuum(state);
    updateInputs(state);
    addEvent(state, 'auto', reason);
    refreshMemory(state);
    return state;
  }

  function tripFault(state, code, message, details) {
    state.fault = { code: String(code || 'FAULT'), message: String(message || '설비 고장'), time: Number(state.elapsed.toFixed(6)) };
    if (details !== undefined) state.fault.details = clone(details);
    state.jammed = state.fault.code === 'JAM';
    state.counters.faults += 1;
    state.auto.previous = state.auto.state;
    state.auto.state = 'FAULT';
    state.auto.running = false;
    state.auto.message = state.fault.message;
    state.auto.fault = clone(state.fault);
    state.mode = 'fault';
    addEvent(state, 'fault', state.fault.message, details);
    refreshMemory(state);
    return false;
  }

  function resetFault(state) {
    const changed = !!state.fault;
    state.fault = null;
    state.jammed = false;
    state.auto = { ...emptyAuto(), cycles: state.auto.cycles };
    state.mode = 'manual';
    if (changed) addEvent(state, 'reset', '고장 리셋');
    updateInputs(state);
    refreshMemory(state);
    return changed;
  }

  function resetCell(state, options = {}) {
    state.outputBits.fill(false);
    syncOutputView(state);
    for (const axis of Object.values(state.actuators)) {
      axis.position = axis.t = 0;
      axis.direction = axis.lastDirection = 0;
      axis.moving = false;
      axis.forwardLimit = false;
      axis.reverseLimit = true;
    }
    setLiftServoPosition(state, 0);
    state.vacuum = { workpieceId: null, acquired: false };
    state.fault = null;
    state.jammed = false;
    state.auto = emptyAuto();
    state.mode = 'manual';
    if (options.clearWorkpieces !== false) state.workpieces = [];
    if (options.clearCounters) state.counters = emptyCounters();
    if (options.clearCompleted !== false) state.completed = [];
    updateInputs(state);
    refreshMemory(state);
    return state;
  }

  function bankForAddress(address) {
    const match = /^([PMDXY])([0-9A-F]+)$/.exec(address);
    return match ? match[1] : null;
  }

  function memorySet(state, rawAddress, value) {
    const address = normalizeAddress(rawAddress);
    const bank = bankForAddress(address);
    if (!bank || !BIT_BANKS.has(bank)) return false;
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
    for (const address of flattenAddresses(getProfile(state).addresses)) memorySet(state, address, false);
    refreshMemory(state);
  }

  function refreshMemory(state) {
    const profile = getProfile(state);
    for (const definition of OUTPUT_DEFINITIONS) memorySet(state, profile.outputs[definition.key], state.outputBits[definition.index]);
    for (const definition of INPUT_DEFINITIONS) memorySet(state, profile.inputs[definition.key], state.inputBits[definition.index]);
    memorySet(state, profile.status.autoRunning, state.auto.running);
    memorySet(state, profile.status.fault, !!state.fault);
    memorySet(state, profile.status.jam, state.jammed);
    memorySet(state, profile.status.step, AUTO_STEPS[state.auto.state] ?? -1);
    for (const [name, address] of Object.entries(profile.counters)) memorySet(state, address, state.counters[name] || 0);
    return state.memory;
  }

  function commandAt(profile, address) {
    for (const [key, mapped] of Object.entries(profile.commands)) {
      if (normalizeAddress(mapped) === address) return key;
    }
    return null;
  }

  function readDevice(state, rawAddress) {
    const address = normalizeAddress(rawAddress);
    if (!new Set(flattenAddresses(getProfile(state).addresses)).has(address)) return undefined;
    updateInputs(state);
    refreshMemory(state);
    const value = memoryGet(state, address);
    return bankForAddress(address) === 'D' ? finite(value, 0) : !!value;
  }

  function writeDevice(state, rawAddress, value) {
    const address = normalizeAddress(rawAddress);
    const profile = getProfile(state);
    const command = commandAt(profile, address);
    if (!command) {
      if (new Set(flattenAddresses(profile.addresses)).has(address)) return { ok: false, error: `${address}는 읽기 전용 상태 주소입니다` };
      return { ok: false, error: `${address || '(빈 주소)'}는 현재 프로필에 정의되지 않았습니다` };
    }
    const on = asBool(value);
    let accepted = true;
    if (command === 'autoStart') {
      memorySet(state, address, on);
      if (on) accepted = startAuto(state);
    } else if (command === 'autoStop') {
      memorySet(state, address, on);
      if (on) stopAuto(state, '내부 주소 정지 지령');
    } else if (command === 'reset') {
      memorySet(state, address, on);
      if (on) resetFault(state);
    } else {
      accepted = setOutput(state, command, on);
    }
    refreshMemory(state);
    return { ok: true, address, value: on, accepted: accepted !== false };
  }

  function setProfile(state, profileName) {
    const profileId = resolveProfile(profileName);
    if (!profileId) return false;
    if (profileId === state.profileId) return true;
    stopAuto(state, 'PLC 제조사 프로필 전환 · 출력 전체 OFF');
    state.profileId = profileId;
    state.profile = profileId;
    initializeMemory(state);
    addEvent(state, 'profile', `${getProfile(state).vendor} 내부 학습 주소 선택 · 이전 주소 격리`);
    return true;
  }

  function exportState(state) {
    updateVacuum(state);
    updateInputs(state);
    refreshMemory(state);
    return clone({
      version: VERSION,
      elapsed: state.elapsed,
      profileId: state.profileId,
      config: state.config,
      outputBits: state.outputBits,
      inputBits: state.inputBits,
      actuators: state.actuators,
      liftServo: state.liftServo,
      vacuum: state.vacuum,
      workpieces: state.workpieces,
      completed: state.completed,
      nextWorkpieceId: state.nextWorkpieceId,
      counters: state.counters,
      auto: state.auto,
      fault: state.fault,
      jammed: state.jammed,
      events: state.events
    });
  }

  function importState(state, saved = {}) {
    if (!saved || typeof saved !== 'object') return state;
    state.profileId = resolveProfile(saved.profileId || saved.profile) || state.profileId || 'ls';
    state.profile = state.profileId;
    state.config = createConfig({ config: saved.config || state.config });
    state.elapsed = Math.max(0, finite(saved.elapsed, 0));
    state.outputBits = Array(OUTPUT_DEFINITIONS.length).fill(false);
    syncOutputView(state);

    for (const [name, definition] of Object.entries(AXIS_DEFINITIONS)) {
      const source = saved.actuators?.[name];
      const axis = state.actuators[name] || createAxis(name, definition);
      axis.position = axis.t = clamp(finite(source?.position ?? source?.t, 0), 0, 1);
      axis.rate = definition.rate;
      axis.direction = 0;
      axis.lastDirection = 0;
      axis.moving = false;
      axis.forwardLimit = axis.position >= 1 - EPS;
      axis.reverseLimit = axis.position <= EPS;
      state.actuators[name] = axis;
    }
    const servoPosition = clamp(finite(saved.liftServo?.position ?? saved.liftServo?.t, 0), 0, 1);
    state.liftServo = {
      position: servoPosition,
      t: servoPosition,
      target: servoPosition,
      speed: Math.max(0.001, finite(saved.liftServo?.speed, state.config.liftServo.speed)),
      moving: false,
      direction: 0
    };

    state.workpieces = [];
    if (Array.isArray(saved.workpieces)) {
      for (const source of saved.workpieces.slice(0, state.config.conveyor.maxWorkpieces)) {
        const type = normalizeMaterial(source.type || source.material);
        if (!type) continue;
        const x = finite(source.x ?? source.position ?? source.travel, state.config.conveyor.spawnX);
        state.workpieces.push({
          id: String(source.id || nextWorkpieceId(state)),
          type,
          material: type,
          metal: type === 'steel',
          x,
          position: x,
          travel: x,
          length: clamp(finite(source.length, state.config.workpiece.length), 0.005, 0.15),
          state: 'on-conveyor',
          blocked: !!source.blocked,
          heldByVacuum: false,
          countedExit: !!source.countedExit,
          createdAt: Math.max(0, finite(source.createdAt, 0))
        });
      }
    }
    state.completed = Array.isArray(saved.completed) ? clone(saved.completed).slice(-200) : [];
    state.nextWorkpieceId = Math.max(1, Math.trunc(finite(saved.nextWorkpieceId, state.nextWorkpieceId)));
    state.counters = emptyCounters();
    for (const key of Object.keys(state.counters)) state.counters[key] = Math.max(0, Math.trunc(finite(saved.counters?.[key], 0)));
    state.events = Array.isArray(saved.events) ? clone(saved.events).slice(-120) : [];
    state.fault = saved.fault && typeof saved.fault === 'object' ? clone(saved.fault) : null;
    state.jammed = !!saved.jammed;
    state.auto = emptyAuto();
    state.auto.cycles = Math.max(0, Math.trunc(finite(saved.auto?.cycles, 0)));
    state.auto.previous = saved.auto?.state || 'IDLE';
    state.mode = state.fault ? 'fault' : 'manual';
    state.vacuum = { workpieceId: saved.vacuum?.workpieceId || null, acquired: false };
    updateVacuum(state);
    updateInputs(state);
    initializeMemory(state);
    return state;
  }

  return {
    version: VERSION,
    VERSION,
    MATERIALS: [...MATERIALS],
    OUTPUT_COUNT: OUTPUT_DEFINITIONS.length,
    INPUT_COUNT: INPUT_DEFINITIONS.length,
    OUTPUT_DEFINITIONS: clone(OUTPUT_DEFINITIONS),
    INPUT_DEFINITIONS: clone(INPUT_DEFINITIONS),
    OUTPUT_NAMES: [...OUTPUT_NAMES],
    SENSOR_NAMES: [...SENSOR_NAMES],
    AXIS_DEFINITIONS: clone(AXIS_DEFINITIONS),
    AUTO_STEPS: { ...AUTO_STEPS },
    DEFAULT_CONFIG: clone(DEFAULT_CONFIG),
    PROFILES: clone(PROFILES),
    ADDRESS_PROFILES: clone(PROFILES),
    createState,
    create: createState,
    tick,
    addWorkpiece,
    setWorkpieceLength,
    spawnWorkpiece: addWorkpiece,
    enqueueWorkpiece: addWorkpiece,
    removeWorkpiece,
    workpieceAt,
    updateInputs,
    updateSensors: updateInputs,
    getSensors: updateInputs,
    getInput,
    readInput: getInput,
    setOutput,
    setManualOutput: setOutput,
    setOutputs,
    setManualOutputs: setOutputs,
    getOutput,
    setLiftServoTarget,
    commandLiftServo: setLiftServoTarget,
    setLiftServoPosition,
    setActuatorPosition,
    startAuto,
    stopAuto,
    resetFault,
    reset: resetFault,
    resetCell,
    tripFault,
    getProfile,
    setProfile,
    switchProfile: setProfile,
    resolveProfile,
    readDevice,
    writeDevice,
    readMemory: readDevice,
    writeMemory: writeDevice,
    refreshMemory,
    exportState,
    importState,
    normalizeAddress,
    normalizeMaterial,
    normalizeOutput,
    outputIndex,
    inputIndex
  };
});
