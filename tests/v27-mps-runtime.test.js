const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/mps-runtime.js');

function close(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test('publishes the complete SoV MPS map and initializes every physical input correctly', () => {
  const state = Runtime.createState();

  assert.equal(Runtime.OUTPUT_COUNT, 18);
  assert.equal(Runtime.INPUT_COUNT, 27);
  assert.deepEqual(Runtime.OUTPUT_DEFINITIONS.map(item => item.address), Array.from({ length: 18 }, (_, index) => `O${index}`));
  assert.deepEqual(Runtime.INPUT_DEFINITIONS.map(item => item.address), Array.from({ length: 27 }, (_, index) => `I${index}`));
  assert.equal(state.outputBits.length, 18);
  assert.equal(state.inputBits.length, 27);
  assert.ok(state.outputBits.every(value => value === false));

  // Every pneumatic axis starts on its reverse sensor.
  for (const pair of [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13]]) {
    assert.equal(state.inputBits[pair[0]], false);
    assert.equal(state.inputBits[pair[1]], true);
  }
  assert.deepEqual(state.inputBits.slice(20, 24), [false, false, false, false]);
  assert.equal(state.inputBits[24], false, 'RLS NC opens at the reverse limit');
  assert.equal(state.inputBits[25], false, 'DOG NO is open away from the dog');
  assert.equal(state.inputBits[26], true, 'FLS NC is closed away from the forward limit');
});

test('double-solenoid both and neither states keep the last direction without a fault', () => {
  const state = Runtime.createState();

  assert.equal(Runtime.setOutput(state, 'O0', true), true);
  Runtime.tick(state, 0.5);
  close(state.actuators.supply.position, 0.4);

  // Both coils energized: the bistable spool keeps the last (+) direction.
  Runtime.setOutput(state, 1, true);
  Runtime.tick(state, 0.5);
  close(state.actuators.supply.position, 0.8);
  assert.equal(state.fault, null);

  // Reverse-only selects -, then neither coil keeps that selected direction.
  Runtime.setOutput(state, 'supplyForward', false);
  Runtime.tick(state, 0.25);
  close(state.actuators.supply.position, 0.6);
  Runtime.setOutput(state, 'supplyReverse', false);
  Runtime.tick(state, 0.25);
  close(state.actuators.supply.position, 0.4);
  assert.equal(state.actuators.supply.lastDirection, -1);
  assert.equal(state.fault, null);
});

test('all seven cylinder axes use the confirmed independent rates and single coils return directly', () => {
  const state = Runtime.createState();
  Runtime.setOutputs(state, {
    O0: true,
    O2: true,
    O3: true,
    O5: true,
    O7: true,
    O10: true,
    O12: true
  });
  Runtime.tick(state, 0.5);

  close(state.actuators.supply.position, 0.4);
  close(state.actuators.drill.position, 0.6);
  close(state.actuators.distribution.position, 0.3);
  close(state.actuators.emission.position, 0.5);
  close(state.actuators.liftPneumatic.position, 0.2);
  close(state.actuators.unloading.position, 0.7);
  close(state.actuators.stopper.position, 0.8);

  Runtime.setOutput(state, 'drillCylinder', false);
  Runtime.setOutput(state, 'stopper', false);
  Runtime.tick(state, 0.25);
  close(state.actuators.drill.position, 0.3);
  close(state.actuators.stopper.position, 0.4);
});

test('photo, inductive and capacitive inputs are calculated from workpiece type and travel', () => {
  const state = Runtime.createState();
  const sensors = state.config.sensors;

  const steel = Runtime.addWorkpiece(state, 'steel', { x: sensors.inductiveSteel.x });
  assert.equal(Runtime.getInput(state, 16), true);
  assert.equal(Runtime.getInput(state, 'I17'), true);
  assert.deepEqual(state.sensorItems.inductiveSteel, [steel.id]);

  Runtime.removeWorkpiece(state, steel.id);
  Runtime.addWorkpiece(state, 'plastic', { x: sensors.capacitiveAny.x });
  assert.equal(Runtime.getInput(state, 'inductiveSteel'), false);
  assert.equal(Runtime.getInput(state, 'capacitiveAny'), true);

  state.workpieces = [];
  Runtime.addWorkpiece(state, 'plastic', { x: sensors.supplyPhoto.x });
  Runtime.updateInputs(state);
  assert.equal(state.inputs.I14, true);
  assert.equal(state.sensors.entrance, true);

  state.workpieces[0].x = state.workpieces[0].position = sensors.distributionPhoto.x;
  Runtime.updateInputs(state);
  assert.equal(state.inputs.I15, true);
  assert.equal(state.sensors.position, true);

  state.workpieces[0].x = state.workpieces[0].position = sensors.endPhoto.x;
  Runtime.updateInputs(state);
  assert.equal(state.inputs.I18, true);
  assert.equal(state.sensors.exit, true);
});

test('the conveyor moves at 0.06 m/s in positive travel and respects the physical stopper', () => {
  const state = Runtime.createState();
  const item = Runtime.addWorkpiece(state, 'plastic', { x: 0.1 });
  Runtime.setOutput(state, 14, true);
  Runtime.tick(state, 1);
  close(item.travel, 0.16);

  Runtime.setOutput(state, 12, true);
  Runtime.tick(state, 0.4); // stopper reaches 0.64 and is physically extended
  item.x = item.position = item.travel = 0.31;
  Runtime.tick(state, 1);
  close(item.x, state.config.conveyor.stopperX - item.length / 2);
  assert.equal(item.blocked, true);
  assert.equal(state.fault, null);
});

test('vacuum acquisition is an input produced by unloading position, vacuum and a real workpiece', () => {
  const state = Runtime.createState();
  const item = Runtime.addWorkpiece(state, 'steel', { x: state.config.sensors.vacuum.x });
  Runtime.setOutput(state, 'unloadingForward', true);
  Runtime.tick(state, 1);
  Runtime.setOutput(state, 'vacuum', true);

  assert.equal(state.actuators.unloading.position, 1);
  assert.equal(state.vacuum.workpieceId, item.id);
  assert.equal(state.inputs.I19, true);
  assert.equal(item.heldByVacuum, true);

  Runtime.setOutput(state, 9, false);
  assert.equal(state.inputs.I19, false);
  assert.equal(item.heldByVacuum, false);
});

test('lift servo stroke is independent from the lift pneumatic cylinder and drives NC/NO sensors', () => {
  const state = Runtime.createState();
  Runtime.setLiftServoTarget(state, 0.5, 0.5);
  Runtime.setOutput(state, 'liftPneumaticForward', true);
  Runtime.tick(state, 1);

  close(state.liftServo.position, 0.5);
  close(state.actuators.liftPneumatic.position, 0.4);
  assert.equal(state.inputs.I24, true);
  assert.equal(state.inputs.I25, true);
  assert.equal(state.inputs.I26, true);

  Runtime.tick(state, 0.5);
  close(state.liftServo.position, 0.5, 1e-9);
  close(state.actuators.liftPneumatic.position, 0.6);
  Runtime.setLiftServoPosition(state, 1);
  assert.equal(state.inputs.I24, true);
  assert.equal(state.inputs.I25, false);
  assert.equal(state.inputs.I26, false, 'FLS NC opens at the forward limit');
});

test('startAuto is only an external PLC-control marker and never runs a baked material sorter', () => {
  const state = Runtime.createState();
  Runtime.addWorkpiece(state, 'steel', { x: state.config.sensors.inductiveSteel.x });
  Runtime.addWorkpiece(state, 'plastic', { x: state.config.sensors.capacitiveAny.x });

  assert.equal(Runtime.startAuto(state), true);
  Runtime.tick(state, 5);
  assert.equal(state.auto.state, 'PLC_CONTROL');
  assert.equal(state.auto.running, true);
  assert.ok(state.outputBits.every(value => value === false));
  assert.equal(state.workpieces.length, 2);
  assert.equal(state.completed.length, 0);
  assert.equal(state.counters.pushed, 0);
  assert.equal(state.counters.picked, 0);
});

test('LS and Mitsubishi profiles expose all 18 writable outputs and 27 read-only inputs', () => {
  const state = Runtime.createState({ profile: 'xg5000' });
  const ls = Runtime.getProfile(state);
  assert.equal(Object.keys(ls.outputs).length, 18);
  assert.equal(Object.keys(ls.inputs).length, 27);
  assert.equal(Runtime.writeDevice(state, ls.outputs.conveyor, 1).accepted, true);
  assert.equal(state.outputBits[14], true);
  assert.equal(Runtime.writeDevice(state, ls.inputs.supplyPhoto, 1).ok, false);

  assert.equal(Runtime.setProfile(state, 'QnU'), true);
  const mitsubishi = Runtime.getProfile(state);
  assert.match(mitsubishi.outputs.conveyor, /^Y/);
  assert.match(mitsubishi.inputs.supplyPhoto, /^X/);
  assert.equal(Runtime.writeDevice(state, mitsubishi.outputs.towerGreen, true).accepted, true);
  assert.equal(Runtime.readDevice(state, mitsubishi.outputs.towerGreen), true);
});

test('export/import round-trips physical state while leaving the deprecated auto sequencer stopped', () => {
  const state = Runtime.createState({ profile: 'mitsubishi' });
  Runtime.addWorkpiece(state, 'steel', { x: 0.22 });
  Runtime.setOutputs(state, { supplyForward: true, conveyor: true, towerGreen: true });
  Runtime.setLiftServoPosition(state, 0.5);
  Runtime.tick(state, 0.25);
  Runtime.startAuto(state);
  const saved = Runtime.exportState(state);

  const restored = Runtime.createState({ saved });
  assert.equal(restored.profileId, 'mitsubishi');
  assert.deepEqual(restored.outputBits, state.outputBits);
  close(restored.actuators.supply.position, state.actuators.supply.position);
  close(restored.liftServo.position, 0.5);
  close(restored.workpieces[0].x, state.workpieces[0].x);
  assert.equal(restored.auto.running, false);
  assert.equal(restored.auto.state, 'IDLE');
});

test('one large tick matches equivalent fixed-size calls', () => {
  const first = Runtime.createState();
  const second = Runtime.createState();
  Runtime.addWorkpiece(first, 'plastic', { x: 0.1 });
  Runtime.addWorkpiece(second, 'plastic', { x: 0.1 });
  Runtime.setOutputs(first, { O0: true, O3: true, O14: true });
  Runtime.setOutputs(second, { O0: true, O3: true, O14: true });

  Runtime.tick(first, 1);
  for (let index = 0; index < 50; index += 1) Runtime.tick(second, 0.02);
  close(first.workpieces[0].x, second.workpieces[0].x);
  close(first.actuators.supply.position, second.actuators.supply.position);
  close(first.actuators.distribution.position, second.actuators.distribution.position);
  assert.deepEqual(first.inputBits, second.inputBits);
});
