const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/palletizer-runtime.js');

const STEP = 'D00000';

function tickUntil(state, predicate, seconds = 45) {
  for (let count = 0; count < seconds * 50 && !predicate(); count += 1) Runtime.tick(state, 0.02);
  return predicate();
}

function stopped(state) {
  return Object.values(state.axes).every((axis) => !axis.busy);
}

function manualHome(state) {
  Runtime.setServo(state, null, true);
  assert.equal(Runtime.requestManualOrg(state), true, 'manual ORG must be accepted before production AUTO');
  assert.equal(tickUntil(state, () => Runtime.allHomed(state)), true, 'all three axes must finish manual ORG');
}

function setInputs(state, patch = {}) {
  const values = {
    P00000: true, // E_STOP_LOOP_OK
    P00001: true, // GUARD_LOOP_OK
    P00005: true, // AUTO_ENABLE_KEY
    P00006: true, // WORK_PRESENT
    P00007: true, // PALLET_PRESENT
    P00008: true, // VACUUM_OK
    P0000A: true, // AIR_PRESSURE_OK / X power feedback in the current profile
    P0000B: true,
    P0000C: true,
    P0000D: true,
    P0000E: true, // SAFETY_RELAY_EDM_OK
    P0000F: true, // EXT_STOP_LOOP_OK
    ...patch,
  };
  for (const [address, value] of Object.entries(values)) assert.equal(Runtime.setPhysicalInput(state, address, value), true, `${address} must be an addressable DI`);
}

function productionState() {
  const state = Runtime.createState({ profile: 'xgb-production' });
  manualHome(state);
  return state;
}

test('production AUTO never leaves start/wait without the required safety, AUTO, air, product, pallet, and preflight permits', () => {
  const requiredInputs = ['P00000', 'P00001', 'P00005', 'P00006', 'P00007', 'P0000A', 'P0000B', 'P0000C', 'P0000D', 'P0000E', 'P0000F'];

  for (const missing of requiredInputs) {
    const state = productionState();
    setInputs(state, { [missing]: false });
    const result = Runtime.writeDevice(state, 'M00123', true);
    const step = Runtime.readDevice(state, STEP);

    assert.equal(result.accepted === false || step === 100, true, `${missing}: START may reject, or enter only STEP100 wait`);
    assert.equal([0, 100].includes(step), true, `${missing}: no motion/pick STEP may be entered`);
    assert.equal(state.gripper.holding, false, `${missing}: product must not be picked`);
  }
});

test('missing product holds at STEP100 and never advances into the pick sequence', () => {
  const state = productionState();
  setInputs(state, { P00006: false });

  Runtime.writeDevice(state, 'M00123', true);
  tickUntil(state, () => Runtime.readDevice(state, STEP) === 100, 30);
  for (let count = 0; count < 500; count += 1) Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 100);
  assert.equal(state.gripper.holding, false);
  assert.equal(state.pallet.placed.length, 0);
});

test('missing vacuum confirmation times out into STEP900 with a machine-readable vacuum fault', () => {
  const state = productionState();
  setInputs(state, { P00008: false });

  Runtime.writeDevice(state, 'M00123', true);

  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) === 900, 60), true);
  assert.equal(Runtime.readDevice(state, 'M00103'), true);
  assert.equal(state.auto.fault?.code, 'VACUUM_TIMEOUT');
});

test('pallet loss prevents place motion and product release', () => {
  const state = productionState();
  setInputs(state);
  Runtime.writeDevice(state, 'M00123', true);

  assert.equal(tickUntil(state, () => [140, 150, 160, 161, 162, 170].includes(Runtime.readDevice(state, STEP)), 45), true, 'cycle must reach the verified pick stage');
  Runtime.setPhysicalInput(state, 'P00007', false);
  for (let count = 0; count < 1_500 && Runtime.readDevice(state, STEP) !== 900; count += 1) Runtime.tick(state, 0.02);

  assert.equal(Runtime.readDevice(state, STEP), 900);
  assert.equal(state.pallet.placed.length, 0);
  assert.equal(state.gripper.holding, true, 'the held product must not be released without a pallet');
});

test('STOP enters STEP800, waits for all axes to stop, then removes servo power; reset needs cause clear and stopped axes before STEP0', () => {
  const state = productionState();
  setInputs(state);
  Runtime.writeDevice(state, 'M00123', true);
  assert.equal(tickUntil(state, () => Runtime.readDevice(state, STEP) >= 30, 30), true);

  Runtime.writeDevice(state, 'M00124', true);
  assert.equal(Runtime.readDevice(state, STEP), 800);
  assert.equal(tickUntil(state, () => stopped(state), 10), true);
  assert.equal(Object.values(state.axes).every((axis) => axis.servoOn === false), true);

  // A latched production fault cannot be cleared while its physical cause remains asserted.
  state.auto.fault = { code: 'VACUUM_TIMEOUT' };
  state.auto.state = 'FAULT';
  Runtime.refreshMemory(state);
  Runtime.setPhysicalInput(state, 'P00008', false);
  Runtime.writeDevice(state, 'M00126', true);
  assert.equal(Runtime.readDevice(state, STEP), 900);

  Runtime.setPhysicalInput(state, 'P00008', true);
  Runtime.writeDevice(state, 'M00126', true);
  assert.equal(Runtime.readDevice(state, STEP), 0);
});
