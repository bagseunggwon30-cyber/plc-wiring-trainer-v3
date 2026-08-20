const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/palletizer-runtime.js');

const STEP = 'D00000';

function tickUntil(state, predicate, seconds = 45) {
  for (let count = 0; count < seconds * 50 && !predicate(); count += 1) Runtime.tick(state, 0.02);
  return predicate();
}

function setInputs(state, patch = {}) {
  const values = {
    P00000: true, P00001: true, P00002: false, P00003: false, P00004: false,
    P00005: true, P00006: true, P00007: true, P00008: true, P00009: true,
    P0000A: true, P0000B: true, P0000C: true, P0000D: true, P0000E: true, P0000F: true,
    ...patch,
  };
  for (const [address, value] of Object.entries(values)) assert.equal(Runtime.setPhysicalInput(state, address, value), true);
}

function readyState(options = {}) {
  const state = Runtime.createState({ profile: 'xgb-production', ...options });
  Runtime.setServo(state, null, true);
  assert.equal(Runtime.requestManualOrg(state), true);
  assert.equal(tickUntil(state, () => Runtime.allHomed(state), 30), true);
  setInputs(state);
  return state;
}

test('vacuum faults reset only after the vacuum feedback has dropped with output safely off', () => {
  const state = readyState();
  state.auto.state = 'PROD_FAULT';state.auto.running = false;state.auto.fault = { code: 'VACUUM_TIMEOUT' };
  state.gripper.closed = false;Runtime.refreshMemory(state);

  assert.equal(Runtime.writeDevice(state, 'M00126', true).accepted, false);
  Runtime.setPhysicalInput(state, 'P00008', false);
  assert.equal(Runtime.writeDevice(state, 'M00126', true).accepted, undefined);
  assert.equal(Runtime.readDevice(state, STEP), 0);
});

test('one stable WORK_PRESENT signal is consumed once and a second cycle requires OFF then ON', () => {
  const state = readyState({ cell: { pallet: { rows: 1, cols: 2, layers: 1 } } });
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(tickUntil(state, () => state.pallet.placed.length === 1 && Runtime.readDevice(state, STEP) === 100), true);
  for(let count=0;count<500;count+=1)Runtime.tick(state,.02);
  assert.equal(state.pallet.placed.length, 1);
  assert.equal(Runtime.readDevice(state, STEP), 100);

  Runtime.setPhysicalInput(state, 'P00006', false);Runtime.tick(state,.02);
  Runtime.setPhysicalInput(state, 'P00006', true);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 220), true);
  assert.equal(state.pallet.placed.length, 2);
});

test('a restored or stopped held workpiece blocks AUTO and normal RESET until explicit recovery', () => {
  const source = readyState();
  source.gripper.holding = true;source.gripper.closed = true;source.gripper.workpieceId = 'BOX-RECOVERY';
  const restored = Runtime.createState({ saved: Runtime.exportState(source) });
  setInputs(restored);

  assert.equal(restored.auto.fault?.code, 'RECOVERY_REQUIRED');
  assert.equal(Runtime.writeDevice(restored, 'M00123', true).accepted, false);
  assert.equal(Runtime.writeDevice(restored, 'M00126', true).accepted, false);
  assert.equal(Runtime.resetCell(restored, { clearPallet: true, recoverWorkpiece: true }), true);
  assert.equal(restored.gripper.holding, false);
  assert.equal(restored.gripper.workpieceId, null);
});

test('STOP PB is consumed before automatic state or axis integration in the same scan', () => {
  const state = readyState();
  assert.equal(Runtime.commandAxis(state, 'X', 500, { speed: 260 }), true);
  Runtime.tick(state, .1);
  const beforeStop = state.axes.X.position;
  Runtime.setPhysicalInput(state, 'P00003', true);
  Runtime.tick(state, .1);
  assert.equal(state.axes.X.position, beforeStop);
  assert.equal(Runtime.readDevice(state, STEP), 800);
  assert.equal(state.axes.X.servoOn, false);
});

test('production resetCell and pallet configuration are rejected during AUTO motion', () => {
  const state = readyState();
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(state.auto.running, true);
  assert.equal(Runtime.resetCell(state, { clearPallet: true }), false);
  assert.equal(Runtime.configurePallet(state, { cols: 2 }), false);
  assert.equal(state.auto.running, true);
});

test('positioning and manual ORG watchdogs fault stalled operations', () => {
  const motion = readyState();
  motion.auto.running = true;motion.auto.state = 'PROD_Z_WAIT';motion.auto.timer = 0;motion.production.motionTimeout = .01;
  motion.axes.Z.busy = true;motion.axes.Z.inPosition = false;motion.axes.Z.mode = 'position';motion.axes.Z.target = motion.axes.Z.position - 100;
  Runtime.tick(motion, .02);
  assert.equal(motion.auto.fault?.code, 'MOTION_TIMEOUT');

  const org = Runtime.createState({ profile: 'xgb-production', axes: { Z: { position: 0 } } });
  Runtime.setServo(org, null, true);assert.equal(Runtime.requestManualOrg(org), true);org.manualOrg.timer = 19.99;
  Runtime.tick(org, .02);
  assert.equal(org.auto.fault?.code, 'ORG_TIMEOUT');
  assert.equal(Runtime.readDevice(org, STEP), 900);
});

test('configuration normalization rejects NaN dimensions and AUTO rejects unsafe Z clearance', () => {
  const normalized = Runtime.createState({ profile: 'xgb-production', cell: { pallet: { rows: 'not-a-number', cols: Infinity, layers: -2 } } });
  assert.deepEqual([normalized.cell.pallet.rows, normalized.cell.pallet.cols, normalized.cell.pallet.layers], [3, 3, 1]);

  const unsafe = readyState({ cell: { safeZ: 30, pick: { z: 24 }, pallet: { rows: 1, cols: 1, layers: 1, origin: { z: 24 } } } });
  assert.equal(Runtime.writeDevice(unsafe, 'M00123', true).accepted, false);
  assert.equal(unsafe.auto.fault?.code, 'CONFIG_INVALID');
});

test('import whitelists axis settings and restores pallet count invariants', () => {
  const saved = Runtime.exportState(Runtime.createState({ profile: 'xgb-production', cell: { pallet: { rows: 1, cols: 1, layers: 1 } } }));
  saved.axes.X = { ...saved.axes.X, min: 100, max: 0, accel: 0, decel: -3, tolerance: -4, position: Infinity, unexpected: 'poison' };
  saved.cell.pallet.rows = 'bad';saved.cell.pallet.cols = 1;saved.cell.pallet.layers = 1;
  saved.pallet = { placed: [{id:'A'}, {id:'B'}, {id:'C'}, {id:'D'}], nextIndex: 99 };saved.auto.cycle = 77;
  const restored = Runtime.createState({ saved });

  assert.ok(restored.axes.X.max > restored.axes.X.min);
  assert.ok(restored.axes.X.accel > 0 && restored.axes.X.decel > 0 && restored.axes.X.tolerance > 0);
  assert.equal('unexpected' in restored.axes.X, false);
  assert.equal(restored.pallet.placed.length, Runtime.palletCapacity(restored));
  assert.equal(restored.pallet.nextIndex, restored.pallet.placed.length);
  assert.equal(restored.auto.cycle, restored.pallet.placed.length);
});

test('profile transitions discard pending PB edges, manual sequence, fault, and transient observation state', () => {
  const state = readyState();
  Runtime.setPhysicalInput(state, 'P00002', true);
  state.manualOrg.step = 20;state.auto.fault = { code: 'OLD' };state.observedStatus = { active: true, values: { M00406: true } };
  assert.equal(Runtime.setProfile(state, 'ls'), true);
  assert.equal(Runtime.setProfile(state, 'xgb-production'), true);
  Runtime.tick(state, .02);
  assert.equal(state.auto.state, 'IDLE');
  assert.equal(state.auto.running, false);
  assert.equal(state.auto.fault, null);
  assert.equal(state.manualOrg.step, 0);
  assert.deepEqual(state.physicalInputEdges, {});
  assert.equal(state.observedStatus.active, false);
});

test('observed false status cannot hide a local production safety fault', () => {
  const state = Runtime.createState({ profile: 'xgb-production' });
  Runtime.setObservedStatus(state, { M00406: false, M00407: false });
  state.auto.state = 'PROD_FAULT';state.auto.fault = { code: 'LOCAL_SAFETY', message: 'local' };
  Runtime.refreshMemory(state);
  assert.equal(Runtime.readDevice(state, 'M00406'), true);
  assert.equal(Runtime.readDevice(state, 'M00407'), true);
});

test('command bits are repeatable one-shot pulses and never remain latched ON', () => {
  const state = readyState();
  const first = Runtime.writeDevice(state, 'M00123', true);
  assert.equal(first.accepted, undefined);assert.equal(Runtime.readDevice(state, 'M00123'), false);
  Runtime.writeDevice(state, 'M00124', true);assert.equal(Runtime.readDevice(state, 'M00124'), false);
  assert.equal(Runtime.writeDevice(state, 'M00126', true).accepted, undefined);
  assert.equal(Runtime.readDevice(state, 'M00126'), false);
  assert.equal(Runtime.writeDevice(state, 'M00123', true).accepted, undefined, 'the same one-shot button can be used again without an explicit false write');
  assert.equal(Runtime.readDevice(state, 'M00123'), false);
});

test('production alarm reset always applies safety policy even for an axis alarm raised in IDLE', () => {
  const state = readyState();
  assert.equal(Runtime.commandAxis(state, 'X', 999), false);
  Runtime.setPhysicalInput(state, 'P00000', false);
  assert.equal(Runtime.resetAlarms(state), false);
  assert.ok(state.axes.X.alarm);

  Runtime.setPhysicalInput(state, 'P00000', true);
  assert.equal(Runtime.resetAlarms(state), true);
  assert.equal(state.axes.X.alarm, null);
});
