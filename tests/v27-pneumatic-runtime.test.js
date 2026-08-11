const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/pneumatic-runtime.js');

function runUntil(state, predicate, seconds = 20) {
  for (let i = 0; i < seconds / .01 && !predicate(); i += 1) Runtime.tick(state, .01);
}

test('service unit regulates pressure through the default air graph', () => {
  const state = Runtime.createState();
  Runtime.setSupply(state, true, 7);
  Runtime.setRegulator(state, 4.5);
  Runtime.tick(state, .02);
  assert.equal(state.service.inputBar, 7);
  assert.equal(state.service.outputBar, 4.5);
  assert.equal(state.pressures['valve.P'], 4.5);
});
test('single-solenoid valve extends and spring-returns a double-acting cylinder', () => {
  const state = Runtime.createState();
  Runtime.setSupply(state, true);
  Runtime.setCoil(state, 'A', true);
  runUntil(state, () => state.cylinder.extended);
  assert.equal(state.cylinder.extended, true);
  Runtime.setCoil(state, 'A', false);
  runUntil(state, () => state.cylinder.retracted);
  assert.equal(state.valve.spool, 'retract');
  assert.equal(state.cylinder.retracted, true);
});

test('double-solenoid valve retains its last spool state and rejects simultaneous coils', () => {
  const state = Runtime.createState({ valve: { type: 'double' } });
  Runtime.setCoil(state, 'A', true);
  Runtime.setCoil(state, 'A', false);
  assert.equal(state.valve.spool, 'extend');
  Runtime.setCoil(state, 'B', true);
  Runtime.setCoil(state, 'A', true);
  Runtime.tick(state, 0);
  assert.equal(state.valve.conflict, true);
  assert.equal(state.faults.some(fault => fault.code === 'COIL_CONFLICT'), true);
});

test('throttles change stroke time and vacuum feedback requires pressure and a part', () => {
  const fast = Runtime.createState(), slow = Runtime.createState();
  for (const state of [fast, slow]) { Runtime.setSupply(state, true); Runtime.setCoil(state, 'A', true); }
  Runtime.setThrottle(slow, 'extend', .2);
  Runtime.tick(fast, 1); Runtime.tick(slow, 1);
  assert.ok(fast.cylinder.position > slow.cylinder.position);
  Runtime.setVacuum(fast, true); Runtime.tick(fast, 0);
  assert.equal(fast.vacuum.holding, true);
  fast.vacuum.partPresent = false; Runtime.tick(fast, 0);
  assert.equal(fast.vacuum.holding, false);
});

test('open tubes and configured leakage are exposed as separate training faults', () => {
  const state = Runtime.createState();
  Runtime.setSupply(state, true);
  Runtime.removeTube(state, 'T04');
  Runtime.setTubeLeak(state, 'T03', .6);
  Runtime.tick(state, 0);
  assert.equal(state.faults.some(fault => fault.code === 'OPEN_PORT' && fault.port === 'cylinder.A'), true);
  assert.equal(state.faults.some(fault => fault.code === 'AIR_LEAK'), true);
});

test('automatic pneumatic sequence completes deterministically', () => {
  const state = Runtime.createState();
  Runtime.tick(state, 0);
  assert.equal(Runtime.startAuto(state), true);
  runUntil(state, () => state.auto.state === 'COMPLETE' || state.auto.state === 'FAULT', 20);
  assert.equal(state.auto.state, 'COMPLETE');
  assert.equal(state.auto.cycleCount, 1);
  assert.equal(state.cylinder.retracted, true);
});

test('LS and Mitsubishi maps are internal-only commands and restoration is safely stopped', () => {
  const state = Runtime.createState({ profile: 'ls' });
  const ls = Runtime.getProfile(state);
  Runtime.writeDevice(state, ls.commands.supply, 1);
  Runtime.writeDevice(state, ls.commands.coilA, 1);
  Runtime.tick(state, .5);
  assert.equal(Runtime.readDevice(state, ls.status.ready), true);
  assert.equal(Runtime.writeDevice(state, ls.status.ready, 1).ok, false);
  Runtime.setProfile(state, 'mitsubishi');
  assert.equal(Runtime.getProfile(state).id, 'mitsubishi');
  const restored = Runtime.createState({ saved: Runtime.exportState(state) });
  assert.equal(restored.source.on, false);
  assert.equal(restored.valve.coilA, false);
  assert.equal(restored.auto.running, false);
});
