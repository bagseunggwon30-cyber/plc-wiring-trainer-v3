const test = require('node:test');
const assert = require('node:assert/strict');

const Palletizer = require('../src/runtime/palletizer-runtime.js');
const Servo = require('../src/runtime/servo2-runtime.js');
const MPS = require('../src/runtime/mps-runtime.js');
const Pneumatic = require('../src/runtime/pneumatic-runtime.js');

test('palletizer exposes an explicit LS or Mitsubishi profile and never mixes address maps', () => {
  const state = Palletizer.createState({ profile: 'ls' });
  const ls = Palletizer.getProfile(state);
  assert.equal(ls.id, 'ls');
  assert.equal(Palletizer.writeDevice(state, ls.commands.servoOn, 1).ok, true);
  assert.equal(Palletizer.writeDevice(state, ls.setpoints.x, 125).ok, true);
  assert.equal(Palletizer.writeDevice(state, ls.commands.moveX, 1).ok, true);
  assert.equal(state.axes.X.busy, true);

  assert.equal(Palletizer.setProfile(state, 'mitsubishi'), true);
  const mitsubishi = Palletizer.getProfile(state);
  assert.equal(mitsubishi.id, 'mitsubishi');
  assert.notEqual(mitsubishi.commands.servoOn, ls.commands.servoOn);
  assert.equal(state.axes.X.busy, false);
  assert.equal(Object.values(state.axes).every(axis => axis.servoOn === false), true);
  assert.equal(Palletizer.readDevice(state, ls.status.xBusy), undefined);
  assert.equal(Palletizer.writeDevice(state, ls.commands.servoOn, 1).ok, false);
  assert.equal(Palletizer.writeDevice(state, mitsubishi.commands.servoOn, 1).ok, true);
});

test('MPS vendor selection de-energizes all outputs and rejects the inactive vendor map', () => {
  const state = MPS.createState({ profile: 'ls' });
  const ls = MPS.getProfile(state);
  assert.equal(MPS.writeDevice(state, ls.outputs.conveyor, 1).ok, true);
  MPS.writeDevice(state, ls.outputs.supplyForward, 1);
  MPS.tick(state, .1);
  const stoppedAt = state.actuators.supply.position;
  assert.equal(state.outputBits.some(Boolean), true);

  assert.equal(MPS.setProfile(state, 'mitsubishi'), true);
  MPS.tick(state, 1);
  const mitsubishi = MPS.getProfile(state);
  assert.equal(state.outputBits.every(value => value === false), true);
  assert.equal(state.actuators.supply.position, stoppedAt);
  assert.equal(Object.entries(state.actuators).filter(([name]) => MPS.AXIS_DEFINITIONS[name].mode === 'double').every(([, axis]) => axis.lastDirection === 0), true);
  assert.equal(MPS.writeDevice(state, ls.outputs.conveyor, 1).ok, false);
  assert.equal(MPS.writeDevice(state, mitsubishi.outputs.conveyor, 1).ok, true);
});

test('pneumatic vendor selection closes commands before the other map is enabled', () => {
  const state = Pneumatic.createState({ profile: 'ls' });
  const ls = Pneumatic.getProfile(state);
  Pneumatic.writeDevice(state, ls.commands.supply, 1);
  Pneumatic.writeDevice(state, ls.commands.coilA, 1);
  assert.equal(state.source.on, true);
  assert.equal(state.valve.coilA, true);

  assert.equal(Pneumatic.setProfile(state, 'mitsubishi'), 'mitsubishi');
  const mitsubishi = Pneumatic.getProfile(state);
  assert.equal(state.source.on, false);
  assert.equal(state.valve.coilA, false);
  assert.equal(state.valve.coilB, false);
  assert.equal(Pneumatic.writeDevice(state, ls.commands.supply, 1).ok, false);
  assert.equal(Pneumatic.writeDevice(state, mitsubishi.commands.supply, 1).ok, true);
});

test('servo vendor selection stops motion and servo power before accepting the selected map', () => {
  const state = Servo.createState({ profile: 'ls' });
  const ls = Servo.getProfile(state);
  Servo.writeDevice(state, ls.commands.servoOn.X, 1);
  Servo.writeDevice(state, ls.data.target.X, 200);
  Servo.writeDevice(state, ls.commands.move.X, 1);
  assert.equal(state.axes.X.busy, true);

  assert.equal(Servo.setProfile(state, 'mitsubishi'), true);
  const mitsubishi = Servo.getProfile(state);
  assert.equal(state.axes.X.busy, false);
  assert.equal(Object.values(state.axes).every(axis => axis.servoOn === false), true);
  assert.equal(Servo.writeDevice(state, ls.commands.servoOn.X, 1).ok, false);
  assert.equal(Servo.writeDevice(state, mitsubishi.commands.servoOn.X, 1).ok, true);
});

test('saved plant states restore with every output and motion command safely off', () => {
  const palletizer = Palletizer.createState({ profile: 'mitsubishi' });
  const palletProfile = Palletizer.getProfile(palletizer);
  Palletizer.writeDevice(palletizer, palletProfile.commands.servoOn, 1);
  Palletizer.writeDevice(palletizer, palletProfile.setpoints.x, 400);
  Palletizer.writeDevice(palletizer, palletProfile.commands.moveX, 1);
  Palletizer.tick(palletizer, .05);
  const restoredPalletizer = Palletizer.createState({ saved: Palletizer.exportState(palletizer) });
  const palletPosition = restoredPalletizer.axes.X.position;
  Palletizer.tick(restoredPalletizer, 1);
  assert.equal(restoredPalletizer.axes.X.position, palletPosition);
  assert.equal(Object.values(restoredPalletizer.axes).every(axis => !axis.servoOn && !axis.busy && axis.mode === 'idle'), true);
  assert.equal(restoredPalletizer.gripper.closed, false);

  const mps = MPS.createState({ profile: 'ls' });
  const mpsProfile = MPS.getProfile(mps);
  MPS.writeDevice(mps, mpsProfile.outputs.supplyForward, 1);
  MPS.writeDevice(mps, mpsProfile.outputs.conveyor, 1);
  MPS.tick(mps, .1);
  const restoredMps = MPS.createState({ saved: MPS.exportState(mps) });
  const mpsPosition = restoredMps.actuators.supply.position;
  MPS.tick(restoredMps, 1);
  assert.equal(restoredMps.actuators.supply.position, mpsPosition);
  assert.equal(restoredMps.outputBits.every(value => value === false), true);
  assert.equal(Object.entries(restoredMps.actuators).filter(([name]) => MPS.AXIS_DEFINITIONS[name].mode === 'double').every(([, axis]) => axis.lastDirection === 0), true);

  const servo = Servo.createState({ profile: 'ls' });
  Servo.setServo(servo, true);
  const restoredServo = Servo.createState({ saved: Servo.exportState(servo) });
  assert.equal(Object.values(restoredServo.axes).every(axis => !axis.servoOn && !axis.busy && axis.mode === 'idle'), true);
});
