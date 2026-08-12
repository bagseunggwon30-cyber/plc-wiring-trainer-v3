const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/palletizer-runtime.js');

const STEP = 'D00000';
const CMD = {
  start: 'M00123',
  reset: 'M00126',
  newPallet: 'M00125',
  servoOn: 'M00111',
};

function tickUntil(state, predicate, seconds = 45, trace = null) {
  let previous = Runtime.readDevice(state, STEP);
  for (let count = 0; count < seconds * 50; count += 1) {
    Runtime.tick(state, 0.02);
    const current = Runtime.readDevice(state, STEP);
    if (trace && current !== previous) trace.push(current);
    previous = current;
    if (predicate()) return true;
  }
  return predicate();
}

function setPhysicalInputs(state, patch = {}) {
  const inputs = {
    P00000: true, // E_STOP_LOOP_OK
    P00001: true, // GUARD_LOOP_OK
    P00002: false, // START_PB
    P00003: false, // STOP_PB
    P00004: false, // RESET_PB
    P00005: true, // AUTO_ENABLE_KEY
    P00006: true, // WORK_PRESENT
    P00007: true, // PALLET_PRESENT
    P00008: true, // VACUUM_OK
    P00009: true, // RELEASE_OK
    P0000A: true, // AIR_PRESSURE_OK
    P0000B: true, // X_DRIVE_POWER_OK
    P0000C: true, // Y_DRIVE_POWER_OK
    P0000D: true, // Z_DRIVE_POWER_OK
    P0000E: true, // SAFETY_RELAY_EDM_OK
    P0000F: true, // EXT_STOP_LOOP_OK
    ...patch,
  };
  for (const [address, value] of Object.entries(inputs)) {
    assert.equal(Runtime.setPhysicalInput(state, address, value), true, `${address} must be a production DI`);
  }
}

function homedProductionState(cell = {}) {
  const state = Runtime.createState({ profile: 'xgb-production', cell });
  Runtime.setServo(state, null, true);
  assert.equal(Runtime.requestManualOrg(state), true);
  assert.equal(tickUntil(state, () => Runtime.allHomed(state), 30), true, 'manual ORG must complete before AUTO');
  setPhysicalInputs(state);
  return state;
}

test('STEP190 does not count or place a box when RELEASE_OK remains false, and instead times out to STEP900', () => {
  const state = homedProductionState();
  setPhysicalInputs(state, { P00009: false });

  assert.equal(Runtime.writeDevice(state, CMD.start, true).accepted, undefined);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 190, 45), true, 'cycle must reach release confirmation');
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 900, 10), true, 'missing RELEASE_OK must be an alarm, not a completed place');
  assert.equal(state.pallet.placed.length, 0);
  assert.equal(state.pallet.nextIndex, 0);
  assert.equal(state.auto.cycle, 0);
});

test('a 1x2 pallet follows STEP210/211 back to STEP100 for the first box and reaches STEP220 only after the second', () => {
  const state = homedProductionState({ pallet: { rows: 1, cols: 2, layers: 1 } });
  const trace = [];

  assert.equal(Runtime.writeDevice(state, CMD.start, true).accepted, undefined);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 220, 90, trace), true, 'two placements must end at PALLET FULL');
  assert.deepEqual(trace.filter(step => [210, 211, 212, 100, 220].includes(step)), [
    100, 210, 211, 212, 100, 210, 211, 212, 220,
  ]);
  assert.equal(state.pallet.placed.length, 2);
  assert.equal(state.pallet.nextIndex, 2);
  assert.equal(state.auto.cycle, 2);
});

test('STEP220 accepts rising M00125 only with PALLET_PRESENT, performs STEP230 reset, then returns to STEP100', () => {
  const state = homedProductionState({ pallet: { rows: 1, cols: 1, layers: 1 } });
  state.pallet.placed = [{ id: 'BOX-1' }];
  state.pallet.nextIndex = 1;
  state.auto.cycle = 1;
  state.auto.running = false;
  state.auto.state = 'PROD_FULL';
  Runtime.refreshMemory(state);

  assert.equal(Runtime.writeDevice(state, CMD.newPallet, true).accepted, undefined, 'M00125 rising acknowledgement must be accepted');
  assert.equal(Runtime.readDevice(state, STEP), 230);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 100, 5), true, 'stable P00007 completes new-pallet initialization');
  assert.equal(state.pallet.nextIndex, 0);
  assert.equal(state.auto.cycle, 0);
});

test('physical START/STOP/RESET pushbuttons act on rising edges only', () => {
  const startState = homedProductionState();
  Runtime.setServo(startState, null, false);
  assert.equal(Runtime.setPhysicalInput(startState, 'P00002', true), true);
  Runtime.tick(startState, 0.02);
  assert.equal(Runtime.readDevice(startState, STEP), 10, 'P00002 rising edge starts AUTO');
  const afterStart = Runtime.readDevice(startState, STEP);
  Runtime.tick(startState, 0.02);
  assert.equal(Runtime.readDevice(startState, STEP), afterStart, 'held START must not retrigger AUTO');

  const stopState = homedProductionState();
  stopState.auto.running = true;
  stopState.auto.state = 'PROD_FEED_X';
  Runtime.refreshMemory(stopState);
  assert.equal(Runtime.setPhysicalInput(stopState, 'P00003', true), true);
  Runtime.tick(stopState, 0.02);
  assert.equal(Runtime.readDevice(stopState, STEP), 800, 'P00003 rising edge requests controlled STOP');

  const resetState = homedProductionState();
  resetState.auto.running = false;
  resetState.auto.state = 'PROD_FAULT';
  resetState.auto.fault = { code: 'VACUUM_TIMEOUT' };
  Runtime.refreshMemory(resetState);
  assert.equal(Runtime.setPhysicalInput(resetState, 'P00004', true), true);
  Runtime.tick(resetState, 0.02);
  assert.equal(Runtime.readDevice(resetState, STEP), 0, 'P00004 rising edge resets only after its cause is clear');
  Runtime.tick(resetState, 0.02);
  assert.equal(Runtime.readDevice(resetState, STEP), 0, 'held RESET must not issue a second reset');
});

test('RESET rejects a non-vacuum preflight fault until its physical safety cause is clear', () => {
  const state = homedProductionState();
  state.auto.running = false;
  state.auto.state = 'PROD_FAULT';
  state.auto.fault = { code: 'PREFLIGHT_LOST' };
  Runtime.setPhysicalInput(state, 'P00000', false);
  Runtime.refreshMemory(state);

  const result = Runtime.writeDevice(state, CMD.reset, true);
  assert.equal(result.accepted, false);
  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.auto.fault.code, 'PREFLIGHT_LOST');
});
