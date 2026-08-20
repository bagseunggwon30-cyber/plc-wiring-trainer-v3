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
    P00000: true, P00001: true, P00002: false, P00003: false,
    P00004: false, P00005: true, P00006: true, P00007: true,
    P00008: true, P00009: true, P0000A: true, P0000B: true,
    P0000C: true, P0000D: true, P0000E: true, P0000F: true,
    ...patch,
  };
  for (const [address, value] of Object.entries(values)) assert.equal(Runtime.setPhysicalInput(state, address, value), true);
}

function readyState(cell = {}, axes = {}) {
  const state = Runtime.createState({ profile: 'xgb-production', cell, axes });
  Runtime.setServo(state, null, true);
  assert.equal(Runtime.requestManualOrg(state), true);
  assert.equal(tickUntil(state, () => Runtime.allHomed(state), 30), true, 'manual ORG must complete');
  setInputs(state);
  return state;
}

test('STEP100 safely re-runs servo and wait-pose preparation when a product arrives after servo power was removed', () => {
  const state = readyState({ pallet: { rows: 1, cols: 1, layers: 1 } });
  Runtime.setServo(state, null, false);
  setInputs(state, { P00006: false, P00007: false });

  assert.equal(Runtime.writeDevice(state, 'M00123', true).accepted, undefined);
  assert.equal(Runtime.readDevice(state, STEP), 100);
  assert.equal(Object.values(state.axes).every(axis => axis.servoOn === false), true);

  Runtime.setPhysicalInput(state, 'P00006', true);
  Runtime.setPhysicalInput(state, 'P00007', true);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 220, 60), true);
  assert.equal(state.pallet.placed.length, 1);
  assert.equal(state.auto.running, false, 'pallet-full is an operator wait state, not AUTO running');
  assert.equal(Runtime.readDevice(state, 'M00409'), false, 'AUTO ready must remain false while the pallet is full');
});

test('loss of a safety loop during motion faults immediately, stops all axes, and removes servo power', () => {
  const state = readyState();
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) >= 30, 20), true);

  Runtime.setPhysicalInput(state, 'P00000', false);
  Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.auto.fault?.code, 'PREFLIGHT_LOST');
  assert.equal(Object.values(state.axes).every(axis => !axis.busy && !axis.servoOn), true);
});

test('servo loss during an AUTO motion becomes SERVO_DROPPED instead of hanging on an idle not-in-position axis', () => {
  const state = readyState();
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(tickUntil(state, () => [30, 31, 32, 110, 111, 130].includes(Runtime.readDevice(state, STEP)), 30), true);

  Runtime.setServo(state, 'X', false);
  Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.auto.fault?.code, 'SERVO_DROPPED');
  assert.equal(Object.values(state.axes).every(axis => !axis.busy && !axis.servoOn), true);
});

test('a real axis alarm can be reset after motion stops without the alarm itself deadlocking RESET', () => {
  const state = readyState();
  state.auto.running = true;
  state.auto.state = 'PROD_FEED_X';
  Runtime.refreshMemory(state);

  assert.equal(Runtime.commandAxis(state, 'X', state.axes.X.max + 100), false);
  assert.equal(state.axes.X.alarm?.code, 'SOFT_LIMIT');
  assert.equal(Runtime.readDevice(state, STEP), 900);

  const result = Runtime.writeDevice(state, 'M00126', true);
  assert.equal(result.accepted, undefined);
  assert.equal(Runtime.readDevice(state, STEP), 0);
  assert.equal(state.axes.X.alarm, null);
  assert.equal(state.auto.fault, null);
});

test('an unreachable pallet pattern is rejected before any production motion and stays latched until corrected', () => {
  const state = readyState({
    pallet: { rows: 1, cols: 5, layers: 1, origin: { x: 342, y: 146, z: 24 }, spacingX: 100 },
  });

  const start = Runtime.writeDevice(state, 'M00123', true);
  assert.equal(start.accepted, false);
  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.auto.fault?.code, 'CONFIG_INVALID');
  assert.equal(Object.values(state.axes).every(axis => !axis.busy && !axis.servoOn), true);
  assert.equal(Runtime.writeDevice(state, 'M00126', true).accepted, false, 'RESET must not hide an invalid pattern');

  Runtime.configurePallet(state, { cols: 2 });
  assert.equal(Runtime.writeDevice(state, 'M00126', true).accepted, undefined);
  assert.equal(Runtime.readDevice(state, STEP), 0);
});

test('simultaneous STOP, RESET, and START edges obey STOP-first safety priority', () => {
  const state = readyState();
  Runtime.writeDevice(state, 'M00123', true);
  Runtime.setPhysicalInput(state, 'P00002', true);
  Runtime.setPhysicalInput(state, 'P00003', true);
  Runtime.setPhysicalInput(state, 'P00004', true);

  Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 800);
  assert.equal(state.auto.running, false);
  assert.equal(Object.values(state.axes).every(axis => !axis.servoOn), true);
});

test('physical PB edges observed in PLC-authoritative mode are never replayed into local AUTO after disconnect', () => {
  const state = readyState();
  assert.equal(Runtime.setPlcAuthoritative(state, true), true);
  Runtime.setPhysicalInput(state, 'P00002', true);
  Runtime.tick(state, 0.02);

  assert.equal(Runtime.setPlcAuthoritative(state, false), true);
  Runtime.tick(state, 0.02);

  assert.equal(state.auto.state, 'IDLE');
  assert.equal(state.auto.running, false);
  assert.equal(Runtime.readDevice(state, STEP), 0);
});

test('pallet loss during STEP190 prevents both return motion and the placement count', () => {
  const state = readyState({ pallet: { rows: 1, cols: 1, layers: 1 } });
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 190, 45), true);
  assert.ok(state.releasedWorkpieceId, 'release has been commanded but is not yet confirmed');

  Runtime.setPhysicalInput(state, 'P00007', false);
  Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.auto.fault?.code, 'PALLET_MISSING');
  assert.equal(state.pallet.placed.length, 0);
  assert.equal(state.pallet.nextIndex, 0);

  Runtime.setPhysicalInput(state, 'P00007', true);
  assert.equal(Runtime.writeDevice(state, 'M00126', true).accepted, false, 'normal RESET must preserve an unconfirmed product transaction');
  assert.equal(Runtime.resetCell(state, { clearPallet: true, recoverWorkpiece: true }), true, 'explicit stopped recovery may remove the unconfirmed workpiece');
  assert.equal(state.releasedWorkpieceId, null);
});

test('product loss during pick descent faults before vacuum pickup can be asserted', () => {
  const state = readyState();
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 130, 45), true);

  Runtime.setPhysicalInput(state, 'P00006', false);
  Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.auto.fault?.code, 'PRODUCT_LOST');
  assert.equal(state.gripper.closed, false);
  assert.equal(state.gripper.holding, false);
});

test('vacuum loss after pickup clears the simulated carried product and blocks placement', () => {
  const state = readyState();
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 150 && state.gripper.holding, 45), true);

  Runtime.setPhysicalInput(state, 'P00008', false);
  Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.auto.fault?.code, 'VACUUM_LOST');
  assert.equal(state.gripper.closed, false);
  assert.equal(state.gripper.holding, false);
  assert.equal(state.gripper.workpieceId, null);
  assert.equal(state.pallet.placed.length, 0);
});

test('manual ORG aborts cleanly instead of hanging when the active-axis servo is removed', () => {
  const state = Runtime.createState({
    profile: 'xgb-production',
    axes: { X: { position: 200 }, Y: { position: 150 }, Z: { position: 30 } },
  });
  Runtime.setServo(state, null, true);
  assert.equal(Runtime.requestManualOrg(state), true);

  Runtime.setServo(state, 'Z', false);
  Runtime.tick(state, 0.02);

  assert.equal(state.manualOrg.step, 0);
  assert.match(state.manualOrg.message, /Z축 원점복귀 중단/);
  assert.equal(state.axes.Z.busy, false);
});

test('restoring a saved production fault keeps STEP900 and the alarm latched in a safe stopped state', () => {
  const state = Runtime.createState({ profile: 'xgb-production' });
  state.auto.running = false;
  state.auto.state = 'PROD_FAULT';
  state.auto.fault = { code: 'PALLET_MISSING', message: '팔레트 검출 상실' };
  Runtime.refreshMemory(state);

  const restored = Runtime.createState({ saved: Runtime.exportState(state) });

  assert.equal(restored.auto.running, false);
  assert.equal(restored.auto.state, 'PROD_FAULT');
  assert.equal(restored.auto.fault?.code, 'PALLET_MISSING');
  assert.equal(Runtime.readDevice(restored, STEP), 900);
  assert.equal(Runtime.readDevice(restored, 'M00406'), true);
});
