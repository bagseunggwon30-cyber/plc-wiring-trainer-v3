const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/servo2-runtime.js');

function runUntil(state, predicate, seconds = 30) {
  const dt = 0.01;
  for (let count = 0; count < Math.ceil(seconds / dt) && !predicate(); count += 1) Runtime.tick(state, dt);
}

test('two axes home deterministically on the simplified DOG/reverse-limit sensor', () => {
  const state = Runtime.createState({
    axes: { X: { current: 180 }, Y: { current: 140 } }
  });
  Runtime.setServo(state, true);
  assert.equal(Runtime.homeAll(state), true);
  runUntil(state, () => state.axes.X.homed && state.axes.Y.homed);

  for (const axis of Object.values(state.axes)) {
    assert.equal(axis.current, axis.home);
    assert.equal(axis.position, axis.home);
    assert.equal(axis.homed, true);
    assert.equal(axis.dog, true);
    assert.equal(axis.reverseLimit, true);
    assert.equal(axis.busy, false);
    assert.equal(axis.inPosition, true);
  }
});

test('ABS and INC point-table entries execute as single-axis positioning', () => {
  const state = Runtime.createState({ axes: { X: { current: 25 } } });
  Runtime.setServo(state, 'X', true);
  Runtime.setPoint(state, 10, { axis: 'X', mode: 'ABS', position: 160, speed: 140 });
  assert.equal(Runtime.executePoint(state, 10), true);
  runUntil(state, () => state.axes.X.inPosition);
  assert.ok(Math.abs(state.axes.X.current - 160) < 1e-9);

  Runtime.setPoint(state, 'X', 11, { mode: 'INC', value: 37.5, speed: 100 });
  assert.equal(Runtime.executePoint(state, 11), true);
  runUntil(state, () => state.axes.X.inPosition);
  assert.ok(Math.abs(state.axes.X.current - 197.5) < 1e-9);
  assert.deepEqual(Runtime.getPoint(state, 11).targets, { X: 37.5 });
});

test('two-axis linear interpolation stays on one geometric line and finishes together', () => {
  const state = Runtime.createState({ axes: { X: { current: 10 }, Y: { current: 20 } } });
  Runtime.setServo(state, true);
  assert.equal(Runtime.commandLinear(state, { X: 210, Y: 120 }, { mode: 'ABS', speed: 120 }), true);

  for (let index = 0; index < 90; index += 1) Runtime.tick(state, 0.01);
  const xRatio = (state.axes.X.current - 10) / 200;
  const yRatio = (state.axes.Y.current - 20) / 100;
  assert.ok(xRatio > 0 && xRatio < 1);
  assert.ok(Math.abs(xRatio - yRatio) < 1e-12);
  assert.equal(state.axes.X.busy, state.axes.Y.busy);

  runUntil(state, () => state.linear.done);
  assert.deepEqual([state.axes.X.current, state.axes.Y.current], [210, 120]);
  assert.equal(state.axes.X.inPosition, true);
  assert.equal(state.axes.Y.inPosition, true);
  assert.equal(state.linear.busy, false);
});

test('incremental point can start a two-axis linear move', () => {
  const state = Runtime.createState({ axes: { X: { current: 40 }, Y: { current: 60 } } });
  Runtime.setServo(state, true);
  Runtime.setPoint(state, 20, { mode: 'INC', x: 35, y: -20, interpolation: 'linear', speed: 90 });
  assert.equal(Runtime.executePoint(state, 20), true);
  runUntil(state, () => state.linear.done);
  assert.deepEqual([state.axes.X.current, state.axes.Y.current], [75, 40]);
});

test('software targets and jog motion enforce forward/reverse limits and reset alarms', () => {
  const state = Runtime.createState({ axes: { X: { current: 490 } } });
  Runtime.setServo(state, 'X', true);
  assert.equal(Runtime.commandAxis(state, 'X', 501), false);
  assert.equal(state.axes.X.alarm.code, 'FORWARD_LIMIT');
  assert.equal(Runtime.resetAlarm(state, 'X'), true);

  assert.equal(Runtime.jogAxis(state, 'X', 1, 80), true);
  runUntil(state, () => !!state.axes.X.alarm);
  assert.equal(state.axes.X.current, state.axes.X.max);
  assert.equal(state.axes.X.forwardLimit, true);
  assert.equal(state.axes.X.alarm.code, 'FORWARD_LIMIT');

  Runtime.resetAlarm(state, 'X');
  assert.equal(Runtime.jogAxis(state, 'X', -1, 50), true);
  Runtime.tick(state, 0.2);
  assert.ok(state.axes.X.current < state.axes.X.max);
  assert.equal(state.axes.X.forwardLimit, false);
});

test('LS and Mitsubishi profiles expose and execute their teaching-only address maps', () => {
  const state = Runtime.createState({ profile: 'xbf-pd02a', axes: { X: { current: 20 } } });
  const ls = Runtime.getProfile(state);
  assert.equal(ls.id, 'ls');
  assert.match(ls.commands.servoOn.X, /^P/);
  assert.match(ls.commands.home.X, /^M/);
  assert.match(ls.data.target.X, /^D/);

  assert.equal(Runtime.writeDevice(state, ls.commands.servoOn.X, 1).ok, true);
  Runtime.writeDevice(state, ls.data.target.X, 85);
  Runtime.writeDevice(state, ls.data.speed, 100);
  assert.equal(Runtime.writeDevice(state, ls.commands.move.X, 1).accepted, true);
  runUntil(state, () => state.axes.X.inPosition);
  assert.equal(Runtime.readDevice(state, ls.data.current.X), 85);
  assert.equal(Runtime.readDevice(state, ls.status.servoReady.X), true);

  assert.equal(Runtime.setProfile(state, 'QD75'), true);
  const mitsubishi = Runtime.getProfile(state);
  assert.equal(mitsubishi.id, 'mitsubishi');
  assert.match(mitsubishi.commands.servoOn.X, /^Y/);
  assert.match(mitsubishi.status.servoReady.X, /^X/);
  assert.match(mitsubishi.commands.home.X, /^M/);
  assert.match(mitsubishi.data.target.X, /^D/);
  assert.equal(Runtime.writeDevice(state, mitsubishi.commands.servoOn.Y, true).ok, true);
  assert.equal(Runtime.readDevice(state, mitsubishi.status.servoReady.Y), true);
  assert.equal(Runtime.writeDevice(state, mitsubishi.status.busy.X, true).ok, false);
  assert.equal(Runtime.writeDevice(state, 'D9999', 1).ok, false);
});

test('pulse-train and SSCNET Mitsubishi servo profiles are separate selectable sessions', () => {
  const pulse = Runtime.getProfile('mitsubishi');
  assert.equal(pulse.module, 'QD75D2N + MR-J4-A');
  assert.equal(pulse.commandInterface, 'differential-pulse');
  assert.equal(pulse.sscnet, undefined);

  const state = Runtime.createState({ profile: 'mitsubishi-sscnet' });
  const sscnet = Runtime.getProfile(state);
  assert.equal(sscnet.id, 'mitsubishi-sscnet');
  assert.equal(sscnet.module, 'QD77MS2 + MR-J4-B');
  assert.equal(sscnet.commandInterface, 'sscnet-iii-h');
  assert.equal(sscnet.reviewStatus, 'BLOCKED');
  assert.ok(sscnet.blockers.includes('ASSET_MODEL_UNVERIFIED'));

  const initial = Runtime.evaluateSscnetTopology(state);
  assert.equal(initial.topologyStatus, 'FAIL');
  assert.equal(initial.reviewStatus, 'BLOCKED');
  assert.deepEqual(
    initial.issues.filter(issue => issue.severity === 'error').map(issue => issue.code).sort(),
    ['SSCNET_AXIS_CHAIN_OPEN', 'SSCNET_CONTROLLER_PATH_OPEN', 'SSCNET_FINAL_CAP_MISSING']
  );

  Runtime.setSscnetConnections(state, Runtime.referenceSscnetConnections());
  const connected = Runtime.evaluateSscnetTopology(state);
  assert.equal(connected.topologyStatus, 'PASS');
  assert.equal(connected.reviewStatus, 'BLOCKED');
  assert.deepEqual(connected.issues.map(issue => issue.code), ['ASSET_MODEL_UNVERIFIED']);

  const sscnetServoAddress = sscnet.commands.servoOn.X;
  assert.equal(Runtime.writeDevice(state, sscnetServoAddress, true).ok, true);
  assert.equal(Runtime.setProfile(state, 'ls'), true);
  assert.equal(Runtime.writeDevice(state, sscnetServoAddress, true).ok, false);
  assert.equal(Object.values(state.axes).every(axis => !axis.servoOn), true);
});

test('SSCNET profile persists its own optical topology and detects a missing protective cap', () => {
  const state = Runtime.createState({ profile: 'mitsubishi-sscnet' });
  const withoutCap = Runtime.referenceSscnetConnections().filter(connection => connection.id !== 'sscnet-final-cap');
  Runtime.setSscnetConnections(state, withoutCap);
  assert.equal(Runtime.evaluateSscnetTopology(state).issues.some(issue => issue.code === 'SSCNET_FINAL_CAP_MISSING'), true);

  const restored = Runtime.createState({ saved: Runtime.exportState(state) });
  assert.equal(restored.profileId, 'mitsubishi-sscnet');
  assert.equal(restored.sscnet.connections.length, 2);
  assert.equal(Runtime.evaluateSscnetTopology(restored).issues.some(issue => issue.code === 'SSCNET_FINAL_CAP_MISSING'), true);
  assert.equal(Object.values(restored.axes).every(axis => !axis.servoOn), true);
});

test('export/import preserves profile, points, axis data, and setpoints without resuming motion', () => {
  const state = Runtime.createState({ profile: 'mitsubishi', axes: { X: { current: 15 }, Y: { current: 30 } } });
  Runtime.setServo(state, true);
  Runtime.setPoint(state, 7, { mode: 'ABS', x: 180, y: 135, speed: 110 });
  Runtime.executePoint(state, 7);
  runUntil(state, () => state.linear.done);
  const profile = Runtime.getProfile(state);
  Runtime.writeDevice(state, profile.data.target.X, 222);
  const saved = JSON.parse(JSON.stringify(Runtime.exportState(state)));

  const restored = Runtime.createState({ saved });
  assert.equal(restored.profileId, 'mitsubishi');
  assert.deepEqual(Runtime.getPoint(restored, 7).targets, { X: 180, Y: 135 });
  assert.deepEqual([restored.axes.X.current, restored.axes.Y.current], [180, 135]);
  assert.equal(restored.linear.active, false);
  assert.equal(restored.axes.X.busy, false);
  assert.equal(restored.axes.Y.busy, false);
  assert.equal(Runtime.readDevice(restored, Runtime.getProfile(restored).data.target.X), 222);
});

test('one large tick is equivalent to the same deterministic internal tick slices', () => {
  const first = Runtime.createState({ axes: { X: { current: 0 } } });
  const second = Runtime.createState({ axes: { X: { current: 0 } } });
  Runtime.setServo(first, 'X', true);
  Runtime.setServo(second, 'X', true);
  Runtime.commandAxis(first, 'X', 200, { speed: 100 });
  Runtime.commandAxis(second, 'X', 200, { speed: 100 });
  Runtime.tick(first, 1);
  for (let index = 0; index < 50; index += 1) Runtime.tick(second, 0.02);
  assert.ok(Math.abs(first.axes.X.current - second.axes.X.current) < 1e-10);
  assert.ok(Math.abs(first.axes.X.velocity - second.axes.X.velocity) < 1e-10);
});
