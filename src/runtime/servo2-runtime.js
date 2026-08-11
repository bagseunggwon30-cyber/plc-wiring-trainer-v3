(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.PLCTrainerServo2Runtime = api;
    root.PLCServo2Runtime = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.7.0';
  const EPS = 1e-9;
  const MAX_TICK_STEP = 0.02;
  const AXIS_NAMES = Object.freeze(['X', 'Y']);
  const BIT_BANKS = new Set(['P', 'M', 'X', 'Y']);

  const AXIS_DEFAULTS = Object.freeze({
    X: Object.freeze({ min: 0, max: 500, home: 0, dogPosition: 0, current: 120, maxSpeed: 250, homeSpeed: 70, accel: 700, decel: 800, tolerance: 0.01 }),
    Y: Object.freeze({ min: 0, max: 400, home: 0, dogPosition: 0, current: 80, maxSpeed: 220, homeSpeed: 60, accel: 650, decel: 750, tolerance: 0.01 })
  });

  function makeProfile(definition) {
    const profile = definition;
    profile.commands = profile.addresses.commands;
    profile.data = profile.addresses.data;
    profile.status = profile.addresses.status;
    return profile;
  }

  // These are teaching maps only. No fieldbus, PLC driver, or hardware transport is used.
  const PROFILES = {
    ls: makeProfile({
      id: 'ls',
      vendor: 'LS Electric',
      family: 'XGB',
      module: 'XBF-PD02A',
      addressStyle: 'P / M / D',
      aliases: ['ls', 'xgb', 'xbf-pd02a', 'xbf_pd02a'],
      addresses: {
        commands: {
          servoOn: { X: 'P00000', Y: 'P00001' },
          alarmReset: { X: 'P00002', Y: 'P00003' },
          home: { X: 'M0100', Y: 'M0101' },
          jogForward: { X: 'M0110', Y: 'M0112' },
          jogReverse: { X: 'M0111', Y: 'M0113' },
          move: { X: 'M0120', Y: 'M0121' },
          linear: 'M0122',
          stop: { X: 'M0123', Y: 'M0124' },
          executePoint: 'M0125',
          stopAll: 'M0126'
        },
        data: {
          pointNumber: 'D0000', pointMode: 'D0001',
          target: { X: 'D0010', Y: 'D0012' }, speed: 'D0014',
          current: { X: 'D0100', Y: 'D0102' }
        },
        status: {
          servoReady: { X: 'P00010', Y: 'P00011' },
          homed: { X: 'P00012', Y: 'P00013' },
          busy: { X: 'P00014', Y: 'P00015' },
          inPosition: { X: 'P00016', Y: 'P00017' },
          alarm: { X: 'P00018', Y: 'P00019' },
          reverseLimit: { X: 'P00020', Y: 'P00021' },
          forwardLimit: { X: 'P00022', Y: 'P00023' },
          dog: { X: 'P00024', Y: 'P00025' },
          linearBusy: 'M0200', linearDone: 'M0201'
        }
      }
    }),
    mitsubishi: makeProfile({
      id: 'mitsubishi',
      vendor: 'Mitsubishi Electric',
      family: 'QnU',
      module: 'QD75 / MR-J4',
      addressStyle: 'X / Y / M / D',
      aliases: ['mitsubishi', 'qnu', 'qd75', 'mr-j4', 'mrj4'],
      addresses: {
        commands: {
          servoOn: { X: 'Y000', Y: 'Y001' },
          alarmReset: { X: 'Y002', Y: 'Y003' },
          home: { X: 'M100', Y: 'M101' },
          jogForward: { X: 'M110', Y: 'M112' },
          jogReverse: { X: 'M111', Y: 'M113' },
          move: { X: 'M120', Y: 'M121' },
          linear: 'M122',
          stop: { X: 'M123', Y: 'M124' },
          executePoint: 'M125',
          stopAll: 'M126'
        },
        data: {
          pointNumber: 'D90', pointMode: 'D91',
          target: { X: 'D100', Y: 'D102' }, speed: 'D104',
          current: { X: 'D200', Y: 'D202' }
        },
        status: {
          servoReady: { X: 'X000', Y: 'X001' },
          homed: { X: 'X010', Y: 'X011' },
          busy: { X: 'X020', Y: 'X021' },
          inPosition: { X: 'X030', Y: 'X031' },
          alarm: { X: 'X040', Y: 'X041' },
          reverseLimit: { X: 'X050', Y: 'X051' },
          forwardLimit: { X: 'X060', Y: 'X061' },
          dog: { X: 'X070', Y: 'X071' },
          linearBusy: 'M200', linearDone: 'M201'
        }
      }
    })
  };

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function approach(value, target, amount) {
    return value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asBool(value) {
    if (value === true || value === 1 || value === '1') return true;
    const text = String(value).trim().toUpperCase();
    return text === 'TRUE' || text === 'ON';
  }

  function normalizeAddress(value) {
    return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, '');
  }

  function normalizeAxis(value) {
    const key = String(value == null ? '' : value).trim().toUpperCase().replace(/[\s_-]+/g, '');
    if (key === 'X' || key === '1' || key === 'A1' || key === 'AXIS1') return 'X';
    if (key === 'Y' || key === '2' || key === 'A2' || key === 'AXIS2') return 'Y';
    return null;
  }

  function normalizeMode(value) {
    if (value === 1) return 'INC';
    const key = String(value == null ? 'ABS' : value).trim().toUpperCase();
    return key === 'INC' || key === 'REL' || key === 'INCREMENTAL' || key === '1' ? 'INC' : 'ABS';
  }

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

  function createAxis(name, overrides = {}) {
    const defaults = AXIS_DEFAULTS[name] || AXIS_DEFAULTS.X;
    let minimum = finite(overrides.min, defaults.min);
    let maximum = finite(overrides.max, defaults.max);
    if (maximum <= minimum) maximum = minimum + 1;
    const home = clamp(finite(overrides.home, defaults.home), minimum, maximum);
    const dogPosition = clamp(finite(overrides.dogPosition, defaults.dogPosition), minimum, maximum);
    const current = clamp(finite(overrides.current ?? overrides.position, defaults.current), minimum, maximum);
    const axis = {
      name,
      index: name === 'X' ? 1 : 2,
      min: minimum,
      max: maximum,
      home,
      dogPosition,
      dogEnabled: overrides.dogEnabled !== false,
      maxSpeed: Math.max(0.01, finite(overrides.maxSpeed, defaults.maxSpeed)),
      homeSpeed: Math.max(0.01, finite(overrides.homeSpeed, defaults.homeSpeed)),
      accel: Math.max(0.01, finite(overrides.accel, defaults.accel)),
      decel: Math.max(0.01, finite(overrides.decel, defaults.decel)),
      tolerance: Math.max(EPS, finite(overrides.tolerance, defaults.tolerance)),
      servoOn: !!overrides.servoOn,
      current,
      position: current,
      target: clamp(finite(overrides.target, current), minimum, maximum),
      velocity: 0,
      commandSpeed: Math.min(Math.max(0.01, finite(overrides.commandSpeed, 120)), Math.max(0.01, finite(overrides.maxSpeed, defaults.maxSpeed))),
      mode: 'idle',
      jog: 0,
      jogDirection: 0,
      homed: !!overrides.homed,
      busy: false,
      inPosition: true,
      alarm: overrides.alarm ? clone(overrides.alarm) : null,
      dog: false,
      forwardLimit: false,
      reverseLimit: false,
      positiveLimit: false,
      negativeLimit: false,
      posLimit: false,
      negLimit: false
    };
    updateSensors(axis);
    return axis;
  }

  function emptyLinear() {
    return {
      active: false, busy: false, done: false, mode: 'ABS',
      start: { X: 0, Y: 0 }, target: { X: 0, Y: 0 }, delta: { X: 0, Y: 0 },
      distance: 0, travelled: 0, velocity: 0, commandSpeed: 0,
      accel: 0, decel: 0, pointNumber: null, reason: null
    };
  }

  function emptyMemory() {
    return { P: {}, M: {}, D: {}, X: {}, Y: {} };
  }

  function createState(options = {}) {
    const requestedProfile = options.profileId || options.profile || 'ls';
    const profileId = resolveProfile(requestedProfile) || 'ls';
    const state = {
      version: VERSION,
      elapsed: 0,
      profileId,
      profile: profileId,
      axes: {
        X: createAxis('X', options.axes?.X || options.axes?.x || {}),
        Y: createAxis('Y', options.axes?.Y || options.axes?.y || {})
      },
      pointTable: {},
      linear: emptyLinear(),
      memory: emptyMemory(),
      events: []
    };
    initializeMemory(state);
    if (Array.isArray(options.points)) {
      options.points.forEach((point, index) => { if (point) setPoint(state, index, point); });
    } else if (options.pointTable && typeof options.pointTable === 'object') {
      for (const [number, point] of Object.entries(options.pointTable)) setPoint(state, number, point);
    }
    if (options.saved) importState(state, options.saved);
    return state;
  }

  function axisFor(state, name) {
    const key = normalizeAxis(name);
    return key ? state.axes[key] : null;
  }

  function setCurrent(axis, value) {
    axis.current = clamp(finite(value, axis.current), axis.min, axis.max);
    axis.position = axis.current;
    updateSensors(axis);
  }

  function updateSensors(axis) {
    axis.forwardLimit = axis.current >= axis.max - EPS;
    axis.reverseLimit = axis.current <= axis.min + EPS;
    axis.positiveLimit = axis.posLimit = axis.forwardLimit;
    axis.negativeLimit = axis.negLimit = axis.reverseLimit;
    axis.dog = !!axis.dogEnabled && axis.current <= axis.dogPosition + axis.tolerance;
  }

  function addEvent(state, type, message, details) {
    const event = { time: Number(state.elapsed.toFixed(6)), type, message };
    if (details !== undefined) event.details = clone(details);
    state.events.push(event);
    if (state.events.length > 100) state.events.splice(0, state.events.length - 100);
  }

  function cancelLinear(state, reason = 'cancelled') {
    if (!state.linear.active) return false;
    state.linear.active = false;
    state.linear.busy = false;
    state.linear.done = false;
    state.linear.velocity = 0;
    state.linear.reason = reason;
    for (const name of AXIS_NAMES) {
      const axis = state.axes[name];
      if (axis.mode !== 'linear') continue;
      axis.mode = 'idle';
      axis.velocity = 0;
      axis.target = axis.current;
      axis.busy = false;
      axis.inPosition = true;
    }
    return true;
  }

  function raiseAlarm(state, nameOrAxis, code, message) {
    const axis = typeof nameOrAxis === 'object' ? nameOrAxis : axisFor(state, nameOrAxis);
    if (!axis) return false;
    if (axis.mode === 'linear') cancelLinear(state, code);
    axis.alarm = { code, message, time: Number(state.elapsed.toFixed(6)) };
    axis.mode = 'idle';
    axis.velocity = 0;
    axis.jog = axis.jogDirection = 0;
    axis.busy = false;
    axis.inPosition = false;
    addEvent(state, 'alarm', `${axis.name}: ${message}`, { axis: axis.name, code });
    refreshMemory(state);
    return false;
  }

  function resetAlarm(state, name) {
    const names = name == null ? AXIS_NAMES : [normalizeAxis(name)];
    let changed = false;
    for (const key of names) {
      const axis = key && state.axes[key];
      if (!axis) continue;
      changed = changed || !!axis.alarm;
      axis.alarm = null;
      axis.mode = 'idle';
      axis.velocity = 0;
      axis.jog = axis.jogDirection = 0;
      axis.busy = false;
      axis.inPosition = Math.abs(axis.target - axis.current) <= axis.tolerance;
    }
    refreshMemory(state);
    return changed;
  }

  function resetAlarms(state) {
    resetAlarm(state);
    return state;
  }

  function setServo(state, name, on = true) {
    if (typeof name === 'boolean') {
      on = name;
      name = null;
    }
    const names = name == null ? AXIS_NAMES : [normalizeAxis(name)];
    if (names.some(key => !key)) return false;
    for (const key of names) {
      const axis = state.axes[key];
      axis.servoOn = !!on;
      if (!axis.servoOn) {
        if (axis.mode === 'linear') cancelLinear(state, 'servo-off');
        axis.mode = 'idle';
        axis.velocity = 0;
        axis.jog = axis.jogDirection = 0;
        axis.target = axis.current;
        axis.busy = false;
        axis.inPosition = false;
      }
    }
    refreshMemory(state);
    return true;
  }

  function targetFor(axis, value, mode) {
    const amount = finite(value, NaN);
    return normalizeMode(mode) === 'INC' ? axis.current + amount : amount;
  }

  function validateTarget(state, axis, target) {
    if (!Number.isFinite(target)) return raiseAlarm(state, axis, 'INVALID_TARGET', '유효한 목표 위치가 필요합니다');
    if (target > axis.max + EPS) return raiseAlarm(state, axis, 'FORWARD_LIMIT', `목표 ${target}가 +방향 한계 ${axis.max}를 초과합니다`);
    if (target < axis.min - EPS) return raiseAlarm(state, axis, 'REVERSE_LIMIT', `목표 ${target}가 -방향 한계 ${axis.min}를 초과합니다`);
    return true;
  }

  function commandAxis(state, name, value, options = {}) {
    const axis = axisFor(state, name);
    if (!axis) return false;
    if (!axis.servoOn) return raiseAlarm(state, axis, 'SERVO_OFF', '서보 ON 후 운전해야 합니다');
    if (axis.alarm) return false;
    const mode = normalizeMode(options.mode);
    const target = targetFor(axis, value, mode);
    if (!validateTarget(state, axis, target)) return false;
    if (state.linear.active) cancelLinear(state, 'single-axis-command');
    axis.target = clamp(target, axis.min, axis.max);
    axis.commandSpeed = clamp(finite(options.speed, axis.commandSpeed), 0.01, axis.maxSpeed);
    axis.mode = 'position';
    axis.jog = axis.jogDirection = 0;
    axis.busy = Math.abs(axis.target - axis.current) > axis.tolerance;
    axis.inPosition = !axis.busy;
    if (!axis.busy) {
      axis.mode = 'idle';
      axis.velocity = 0;
      setCurrent(axis, axis.target);
    }
    setMappedTarget(state, axis.name, axis.target);
    setMappedSpeed(state, axis.commandSpeed);
    addEvent(state, 'command', `${axis.name}축 ${mode} 위치결정`, { target: axis.target, speed: axis.commandSpeed });
    refreshMemory(state);
    return true;
  }

  function commandLinear(state, targets, options = {}, extraOptions) {
    if (typeof targets === 'number') {
      targets = { X: targets, Y: options };
      options = extraOptions || {};
    }
    const source = targets && typeof targets === 'object' ? (targets.targets || targets) : {};
    const mode = normalizeMode(options.mode ?? targets?.mode);
    const requested = {
      X: source.X ?? source.x,
      Y: source.Y ?? source.y
    };
    if (requested.X == null || requested.Y == null) return false;
    const absolute = {};
    for (const name of AXIS_NAMES) {
      const axis = state.axes[name];
      if (!axis.servoOn) return raiseAlarm(state, axis, 'SERVO_OFF', '2축 보간 전 서보 ON이 필요합니다');
      if (axis.alarm) return false;
      absolute[name] = targetFor(axis, requested[name], mode);
      if (!validateTarget(state, axis, absolute[name])) return false;
    }
    cancelLinear(state, 'new-linear-command');
    const start = { X: state.axes.X.current, Y: state.axes.Y.current };
    const target = { X: absolute.X, Y: absolute.Y };
    const delta = { X: target.X - start.X, Y: target.Y - start.Y };
    const distance = Math.hypot(delta.X, delta.Y);
    const speedLimit = Math.min(state.axes.X.maxSpeed, state.axes.Y.maxSpeed);
    const commandSpeed = clamp(finite(options.speed, Math.min(state.axes.X.commandSpeed, state.axes.Y.commandSpeed)), 0.01, speedLimit);
    state.linear = {
      active: distance > Math.max(state.axes.X.tolerance, state.axes.Y.tolerance),
      busy: distance > Math.max(state.axes.X.tolerance, state.axes.Y.tolerance),
      done: distance <= Math.max(state.axes.X.tolerance, state.axes.Y.tolerance),
      mode,
      start,
      target,
      delta,
      distance,
      travelled: 0,
      velocity: 0,
      commandSpeed,
      accel: Math.min(state.axes.X.accel, state.axes.Y.accel),
      decel: Math.min(state.axes.X.decel, state.axes.Y.decel),
      pointNumber: options.pointNumber ?? null,
      reason: null
    };
    for (const name of AXIS_NAMES) {
      const axis = state.axes[name];
      axis.target = target[name];
      axis.commandSpeed = commandSpeed;
      axis.velocity = 0;
      axis.mode = state.linear.active ? 'linear' : 'idle';
      axis.busy = state.linear.active;
      axis.inPosition = !state.linear.active;
      axis.jog = axis.jogDirection = 0;
      if (!state.linear.active) setCurrent(axis, target[name]);
      setMappedTarget(state, name, target[name]);
    }
    setMappedSpeed(state, commandSpeed);
    addEvent(state, 'command', `2축 ${mode} 직선 보간`, { target, speed: commandSpeed });
    refreshMemory(state);
    return true;
  }

  function homeAxis(state, name) {
    const axis = axisFor(state, name);
    if (!axis) return false;
    if (!axis.servoOn) return raiseAlarm(state, axis, 'SERVO_OFF', '원점복귀 전 서보 ON이 필요합니다');
    if (axis.alarm) return false;
    if (state.linear.active) cancelLinear(state, 'home-command');
    axis.mode = 'home';
    axis.target = axis.home;
    axis.velocity = 0;
    axis.jog = axis.jogDirection = -1;
    axis.homed = false;
    axis.busy = true;
    axis.inPosition = false;
    addEvent(state, 'command', `${axis.name}축 원점복귀`);
    refreshMemory(state);
    return true;
  }

  function homeAll(state) {
    let accepted = true;
    for (const name of AXIS_NAMES) accepted = homeAxis(state, name) && accepted;
    return accepted;
  }

  function jogAxis(state, name, direction, speed) {
    const axis = axisFor(state, name);
    if (!axis) return false;
    const sign = Math.sign(finite(direction, 0));
    if (!sign) return stopAxis(state, name);
    if (!axis.servoOn) return raiseAlarm(state, axis, 'SERVO_OFF', '조그 전 서보 ON이 필요합니다');
    if (axis.alarm) return false;
    updateSensors(axis);
    if (sign > 0 && axis.forwardLimit) return raiseAlarm(state, axis, 'FORWARD_LIMIT', '+방향 리미트가 동작 중입니다');
    if (sign < 0 && axis.reverseLimit) return raiseAlarm(state, axis, 'REVERSE_LIMIT', '-방향 리미트가 동작 중입니다');
    if (state.linear.active) cancelLinear(state, 'jog-command');
    axis.commandSpeed = clamp(finite(speed, Math.min(80, axis.maxSpeed)), 0.01, axis.maxSpeed);
    axis.target = sign > 0 ? axis.max : axis.min;
    axis.mode = 'jog';
    axis.jog = axis.jogDirection = sign;
    axis.busy = true;
    axis.inPosition = false;
    refreshMemory(state);
    return true;
  }

  function stopAxis(state, name) {
    const axis = axisFor(state, name);
    if (!axis) return false;
    if (axis.mode === 'linear') cancelLinear(state, 'axis-stop');
    axis.mode = 'idle';
    axis.velocity = 0;
    axis.jog = axis.jogDirection = 0;
    axis.target = axis.current;
    axis.busy = false;
    axis.inPosition = true;
    refreshMemory(state);
    return true;
  }

  function stopAll(state) {
    cancelLinear(state, 'stop-all');
    for (const name of AXIS_NAMES) stopAxis(state, name);
    addEvent(state, 'command', '전축 정지');
    return state;
  }

  function finishHome(axis) {
    setCurrent(axis, axis.home);
    axis.target = axis.home;
    axis.velocity = 0;
    axis.mode = 'idle';
    axis.jog = axis.jogDirection = 0;
    axis.homed = true;
    axis.busy = false;
    axis.inPosition = true;
  }

  function tickAxis(state, axis, dt) {
    updateSensors(axis);
    if (!axis.servoOn || axis.alarm || axis.mode === 'idle' || axis.mode === 'linear') {
      axis.velocity = 0;
      if (axis.mode === 'idle') axis.busy = false;
      return;
    }
    if (axis.mode === 'home' && (axis.dog || axis.reverseLimit)) {
      finishHome(axis);
      return;
    }

    const isJog = axis.mode === 'jog';
    const isHome = axis.mode === 'home';
    const target = isHome ? axis.min : axis.target;
    const distance = target - axis.current;
    if (!isJog && !isHome && Math.abs(distance) <= axis.tolerance) {
      setCurrent(axis, axis.target);
      axis.velocity = 0;
      axis.mode = 'idle';
      axis.busy = false;
      axis.inPosition = true;
      return;
    }

    const direction = isHome ? -1 : (isJog ? axis.jogDirection : Math.sign(distance));
    const speed = isHome ? axis.homeSpeed : axis.commandSpeed;
    const desiredMagnitude = isJog || isHome
      ? speed
      : Math.min(speed, Math.sqrt(Math.max(0, 2 * axis.decel * Math.abs(distance))));
    const desired = direction * desiredMagnitude;
    const rate = axis.velocity === 0 || Math.sign(axis.velocity) === direction ? axis.accel : axis.decel;
    axis.velocity = approach(axis.velocity, desired, rate * dt);
    let next = axis.current + axis.velocity * dt;
    if (direction > 0 && next > target) next = target;
    if (direction < 0 && next < target) next = target;

    if (isHome && (next <= axis.dogPosition + axis.tolerance || next <= axis.min + EPS)) {
      finishHome(axis);
      return;
    }
    setCurrent(axis, next);
    axis.busy = true;
    axis.inPosition = false;

    if (isJog && ((axis.jogDirection > 0 && axis.forwardLimit) || (axis.jogDirection < 0 && axis.reverseLimit))) {
      raiseAlarm(state, axis, axis.jogDirection > 0 ? 'FORWARD_LIMIT' : 'REVERSE_LIMIT', '조그 중 하드 리미트에 도달했습니다');
      return;
    }
    if (!isJog && !isHome && Math.abs(axis.target - axis.current) <= axis.tolerance) {
      setCurrent(axis, axis.target);
      axis.velocity = 0;
      axis.mode = 'idle';
      axis.busy = false;
      axis.inPosition = true;
    }
  }

  function tickLinear(state, dt) {
    const motion = state.linear;
    if (!motion.active) return;
    if (AXIS_NAMES.some(name => !state.axes[name].servoOn || state.axes[name].alarm)) {
      cancelLinear(state, 'axis-not-ready');
      return;
    }
    const remaining = Math.max(0, motion.distance - motion.travelled);
    const brakingSpeed = Math.sqrt(Math.max(0, 2 * motion.decel * remaining));
    const desired = Math.min(motion.commandSpeed, brakingSpeed);
    motion.velocity = approach(motion.velocity, desired, motion.accel * dt);
    motion.travelled = Math.min(motion.distance, motion.travelled + motion.velocity * dt);
    if (motion.distance - motion.travelled <= Math.max(state.axes.X.tolerance, state.axes.Y.tolerance)) {
      motion.travelled = motion.distance;
    }
    const ratio = motion.distance <= EPS ? 1 : motion.travelled / motion.distance;
    for (const name of AXIS_NAMES) {
      const axis = state.axes[name];
      setCurrent(axis, motion.start[name] + motion.delta[name] * ratio);
      axis.velocity = motion.velocity * motion.delta[name] / Math.max(motion.distance, EPS);
      axis.busy = true;
      axis.inPosition = false;
    }
    if (motion.travelled >= motion.distance - EPS) {
      for (const name of AXIS_NAMES) {
        const axis = state.axes[name];
        setCurrent(axis, motion.target[name]);
        axis.target = motion.target[name];
        axis.velocity = 0;
        axis.mode = 'idle';
        axis.busy = false;
        axis.inPosition = true;
      }
      motion.active = false;
      motion.busy = false;
      motion.done = true;
      motion.velocity = 0;
      motion.reason = 'complete';
      addEvent(state, 'complete', '2축 직선 보간 완료', { target: motion.target });
    }
  }

  function tick(state, dt) {
    let remaining = finite(dt, 0);
    if (remaining <= 0) {
      refreshMemory(state);
      return state;
    }
    while (remaining > EPS) {
      const step = Math.min(MAX_TICK_STEP, remaining);
      tickLinear(state, step);
      for (const name of AXIS_NAMES) tickAxis(state, state.axes[name], step);
      state.elapsed += step;
      remaining -= step;
    }
    refreshMemory(state);
    return state;
  }

  function normalizePoint(definition = {}, forcedAxis) {
    const source = definition && typeof definition === 'object' ? definition : { value: definition };
    const targetSource = source.targets && typeof source.targets === 'object' ? source.targets : source;
    const targets = {};
    if (forcedAxis) {
      const value = source.position ?? source.target ?? source.value ?? targetSource[forcedAxis] ?? targetSource[forcedAxis.toLowerCase()];
      if (Number.isFinite(Number(value))) targets[forcedAxis] = Number(value);
    } else {
      for (const name of AXIS_NAMES) {
        const value = targetSource[name] ?? targetSource[name.toLowerCase()];
        if (value != null && Number.isFinite(Number(value))) targets[name] = Number(value);
      }
      const namedAxis = normalizeAxis(source.axis);
      if (!Object.keys(targets).length && namedAxis) {
        const value = source.position ?? source.target ?? source.value;
        if (Number.isFinite(Number(value))) targets[namedAxis] = Number(value);
      }
    }
    const axes = Object.keys(targets);
    if (!axes.length) return null;
    const interpolation = axes.length > 1
      ? (String(source.interpolation || source.type || 'linear').toLowerCase() === 'linear' ? 'linear' : 'independent')
      : 'single';
    return {
      mode: normalizeMode(source.mode),
      interpolation,
      speed: Math.max(0.01, finite(source.speed, 120)),
      targets
    };
  }

  function setPoint(state, numberOrAxis, definitionOrNumber, maybeDefinition) {
    let number = numberOrAxis;
    let definition = definitionOrNumber;
    let forcedAxis = null;
    const possibleAxis = normalizeAxis(numberOrAxis);
    if (possibleAxis && maybeDefinition !== undefined) {
      forcedAxis = possibleAxis;
      number = definitionOrNumber;
      definition = maybeDefinition;
    }
    const index = Math.trunc(finite(number, NaN));
    if (!Number.isInteger(index) || index < 0 || index > 9999) return false;
    const point = normalizePoint(definition, forcedAxis);
    if (!point) return false;
    point.number = index;
    state.pointTable[index] = point;
    return clone(point);
  }

  function getPoint(state, number) {
    const point = state.pointTable[Math.trunc(finite(number, -1))];
    return point ? clone(point) : undefined;
  }

  function deletePoint(state, number) {
    const key = Math.trunc(finite(number, -1));
    if (!Object.prototype.hasOwnProperty.call(state.pointTable, key)) return false;
    delete state.pointTable[key];
    return true;
  }

  function executePoint(state, number, options = {}) {
    const point = state.pointTable[Math.trunc(finite(number, -1))];
    if (!point) return false;
    const names = Object.keys(point.targets);
    const speed = finite(options.speed, point.speed);
    if (names.length === 1) return commandAxis(state, names[0], point.targets[names[0]], { mode: point.mode, speed });
    if (point.interpolation === 'linear') {
      return commandLinear(state, point.targets, { mode: point.mode, speed, pointNumber: point.number });
    }
    const absolute = {};
    for (const name of names) {
      const axis = state.axes[name];
      if (!axis?.servoOn || axis.alarm) return false;
      absolute[name] = targetFor(axis, point.targets[name], point.mode);
      if (!validateTarget(state, axis, absolute[name])) return false;
    }
    return names.every(name => commandAxis(state, name, absolute[name], { mode: 'ABS', speed }));
  }

  function bankForAddress(address) {
    const match = /^([PMDXY])([0-9A-F]+)$/.exec(address);
    return match ? match[1] : null;
  }

  function memorySet(state, address, value) {
    const key = normalizeAddress(address);
    const bank = bankForAddress(key);
    if (!bank) return false;
    state.memory[bank][key] = bank === 'D' ? finite(value, 0) : !!value;
    return true;
  }

  function memoryGet(state, address) {
    const key = normalizeAddress(address);
    const bank = bankForAddress(key);
    return bank ? state.memory[bank][key] : undefined;
  }

  function flattenAddresses(value, result = []) {
    if (typeof value === 'string') result.push(normalizeAddress(value));
    else if (value && typeof value === 'object') Object.values(value).forEach(item => flattenAddresses(item, result));
    return result;
  }

  function allMappedAddresses(profile) {
    return new Set(flattenAddresses(profile.addresses));
  }

  function commandAt(profile, address) {
    const commands = profile.commands;
    for (const [kind, mapping] of Object.entries(commands)) {
      if (typeof mapping === 'string' && normalizeAddress(mapping) === address) return { kind, axis: null };
      if (mapping && typeof mapping === 'object') {
        for (const name of AXIS_NAMES) if (normalizeAddress(mapping[name]) === address) return { kind, axis: name };
      }
    }
    return null;
  }

  function writableDataAt(profile, address) {
    const data = profile.data;
    for (const name of AXIS_NAMES) if (normalizeAddress(data.target[name]) === address) return { kind: 'target', axis: name };
    for (const kind of ['speed', 'pointNumber', 'pointMode']) {
      if (normalizeAddress(data[kind]) === address) return { kind, axis: null };
    }
    return null;
  }

  function setMappedTarget(state, name, value) {
    memorySet(state, getProfile(state).data.target[name], value);
  }

  function setMappedSpeed(state, value) {
    memorySet(state, getProfile(state).data.speed, value);
  }

  function initializeMemory(state) {
    state.memory = emptyMemory();
    const profile = getProfile(state);
    for (const address of flattenAddresses(profile.commands)) memorySet(state, address, false);
    memorySet(state, profile.data.pointNumber, 0);
    memorySet(state, profile.data.pointMode, 0);
    memorySet(state, profile.data.speed, 120);
    for (const name of AXIS_NAMES) memorySet(state, profile.data.target[name], state.axes[name].target);
    refreshMemory(state);
  }

  function refreshMemory(state) {
    const profile = getProfile(state);
    const status = profile.status;
    for (const name of AXIS_NAMES) {
      const axis = state.axes[name];
      updateSensors(axis);
      memorySet(state, status.servoReady[name], axis.servoOn && !axis.alarm);
      memorySet(state, status.homed[name], axis.homed);
      memorySet(state, status.busy[name], axis.busy);
      memorySet(state, status.inPosition[name], axis.inPosition);
      memorySet(state, status.alarm[name], !!axis.alarm);
      memorySet(state, status.reverseLimit[name], axis.reverseLimit);
      memorySet(state, status.forwardLimit[name], axis.forwardLimit);
      memorySet(state, status.dog[name], axis.dog);
      memorySet(state, profile.data.current[name], Number(axis.current.toFixed(6)));
    }
    memorySet(state, status.linearBusy, state.linear.active);
    memorySet(state, status.linearDone, state.linear.done);
    return state.memory;
  }

  function readDevice(state, rawAddress) {
    const address = normalizeAddress(rawAddress);
    const profile = getProfile(state);
    if (!allMappedAddresses(profile).has(address)) return undefined;
    refreshMemory(state);
    const value = memoryGet(state, address);
    return bankForAddress(address) === 'D' ? finite(value, 0) : !!value;
  }

  function writeDevice(state, rawAddress, value) {
    const address = normalizeAddress(rawAddress);
    const profile = getProfile(state);
    const dataRole = writableDataAt(profile, address);
    if (dataRole) {
      let stored;
      if (dataRole.kind === 'pointMode') stored = normalizeMode(value) === 'INC' ? 1 : 0;
      else {
        stored = finite(value, NaN);
        if (!Number.isFinite(stored)) return { ok: false, error: '숫자 설정값이 필요합니다' };
        if (dataRole.kind === 'pointNumber') stored = Math.trunc(stored);
        if (dataRole.kind === 'speed' && stored <= 0) return { ok: false, error: '속도는 0보다 커야 합니다' };
      }
      memorySet(state, address, stored);
      return { ok: true, address, value: stored };
    }

    const command = commandAt(profile, address);
    if (!command) {
      if (allMappedAddresses(profile).has(address)) return { ok: false, error: `${address}는 읽기 전용 상태 주소입니다` };
      return { ok: false, error: `${address || '(빈 주소)'}는 현재 프로필에 정의되지 않았습니다` };
    }

    const on = asBool(value);
    memorySet(state, address, on);
    let accepted = true;
    const data = profile.data;
    switch (command.kind) {
      case 'servoOn': accepted = setServo(state, command.axis, on); break;
      case 'alarmReset': if (on) resetAlarm(state, command.axis); break;
      case 'home': if (on) accepted = homeAxis(state, command.axis); break;
      case 'jogForward': accepted = on ? jogAxis(state, command.axis, 1, memoryGet(state, data.speed)) : stopJogDirection(state, command.axis, 1); break;
      case 'jogReverse': accepted = on ? jogAxis(state, command.axis, -1, memoryGet(state, data.speed)) : stopJogDirection(state, command.axis, -1); break;
      case 'move':
        if (on) accepted = commandAxis(state, command.axis, memoryGet(state, data.target[command.axis]), { mode: memoryGet(state, data.pointMode), speed: memoryGet(state, data.speed) });
        break;
      case 'linear':
        if (on) accepted = commandLinear(state, { X: memoryGet(state, data.target.X), Y: memoryGet(state, data.target.Y) }, { mode: memoryGet(state, data.pointMode), speed: memoryGet(state, data.speed) });
        break;
      case 'executePoint': if (on) accepted = executePoint(state, memoryGet(state, data.pointNumber)); break;
      case 'stop': if (on) accepted = stopAxis(state, command.axis); break;
      case 'stopAll': if (on) stopAll(state); break;
      default: accepted = false;
    }
    refreshMemory(state);
    return { ok: true, address, value: on, accepted: accepted !== false };
  }

  function stopJogDirection(state, name, direction) {
    const axis = axisFor(state, name);
    if (axis && axis.mode === 'jog' && axis.jogDirection === direction) return stopAxis(state, name);
    return true;
  }

  function setProfile(state, profileName) {
    const profileId = resolveProfile(profileName);
    if (!profileId) return false;
    if (profileId === state.profileId) return true;
    stopAll(state);
    setServo(state, false);
    state.profileId = profileId;
    state.profile = profileId;
    initializeMemory(state);
    addEvent(state, 'profile', `${getProfile(state).vendor} ${getProfile(state).module} 프로필 선택 · 이전 출력 안전 해제`);
    return true;
  }

  function exportState(state) {
    refreshMemory(state);
    return clone({
      version: VERSION,
      elapsed: state.elapsed,
      profileId: state.profileId,
      profile: state.profileId,
      axes: state.axes,
      pointTable: state.pointTable,
      linear: state.linear,
      memory: state.memory,
      events: state.events
    });
  }

  function importState(state, saved = {}) {
    if (!saved || typeof saved !== 'object') return state;
    const profileId = resolveProfile(saved.profileId || saved.profile) || state.profileId || 'ls';
    state.profileId = profileId;
    state.profile = profileId;
    for (const name of AXIS_NAMES) {
      const source = saved.axes?.[name];
      if (!source) continue;
      const restored = createAxis(name, source);
      restored.servoOn = false;
      restored.homed = !!source.homed;
      restored.alarm = source.alarm ? clone(source.alarm) : null;
      restored.target = restored.current;
      restored.mode = 'idle';
      restored.velocity = 0;
      restored.jog = restored.jogDirection = 0;
      restored.busy = false;
      restored.inPosition = false;
      state.axes[name] = restored;
    }
    state.pointTable = {};
    if (saved.pointTable && typeof saved.pointTable === 'object') {
      for (const [number, point] of Object.entries(saved.pointTable)) setPoint(state, number, point);
    }
    state.linear = emptyLinear();
    if (saved.linear && typeof saved.linear === 'object') {
      state.linear.done = !!saved.linear.done;
      state.linear.mode = normalizeMode(saved.linear.mode);
      state.linear.start = { ...state.linear.start, ...(saved.linear.start || {}) };
      state.linear.target = { ...state.linear.target, ...(saved.linear.target || {}) };
      state.linear.pointNumber = saved.linear.pointNumber ?? null;
      state.linear.reason = 'restored-stopped';
    }
    state.elapsed = Math.max(0, finite(saved.elapsed, 0));
    state.events = Array.isArray(saved.events) ? clone(saved.events).slice(-100) : [];
    initializeMemory(state);
    const profile = getProfile(state);
    if (saved.memory && typeof saved.memory === 'object') {
      for (const address of [profile.data.pointNumber, profile.data.pointMode, profile.data.speed, profile.data.target.X, profile.data.target.Y]) {
        const key = normalizeAddress(address);
        const bank = bankForAddress(key);
        if (bank && saved.memory[bank] && saved.memory[bank][key] != null) memorySet(state, key, saved.memory[bank][key]);
      }
    }
    refreshMemory(state);
    return state;
  }

  function linearMove(state, xOrTargets, yOrOptions, maybeOptions) {
    return commandLinear(state, xOrTargets, yOrOptions, maybeOptions);
  }

  return {
    version: VERSION,
    VERSION,
    AXIS_NAMES: [...AXIS_NAMES],
    AXIS_DEFAULTS: clone(AXIS_DEFAULTS),
    PROFILES: clone(PROFILES),
    VENDOR_PROFILES: clone(PROFILES),
    createAxis,
    createState,
    create: createState,
    tick,
    setServo,
    servoOn: setServo,
    commandAxis,
    moveAxis: commandAxis,
    homeAxis,
    homeAll,
    jogAxis,
    stopAxis,
    stopAll,
    commandLinear,
    linearMove,
    interpolateLinear: commandLinear,
    setPoint,
    definePoint: setPoint,
    getPoint,
    deletePoint,
    executePoint,
    runPoint: executePoint,
    resetAlarm,
    resetAlarms,
    raiseAlarm,
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
    normalizeAxis,
    normalizeMode
  };
});
