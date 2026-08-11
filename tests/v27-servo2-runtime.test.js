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
  assert.equal(pulse.module, 'QD75D2N + MR-J4-40A');
  assert.equal(pulse.commandInterface, 'differential-pulse');
  assert.equal(pulse.sscnet, undefined);

  const state = Runtime.createState({ profile: 'mitsubishi-sscnet' });
  const sscnet = Runtime.getProfile(state);
  assert.equal(sscnet.id, 'mitsubishi-sscnet');
  assert.equal(sscnet.module, 'QD77MS2 + MR-J4-B');
  assert.equal(sscnet.commandInterface, 'sscnet-iii-h');
  assert.equal(sscnet.reviewStatus, 'BLOCKED');
  assert.ok(sscnet.blockers.includes('ASSET_MODEL_UNVERIFIED'));
  const flattenAddresses = profile => [...new Set(JSON.stringify(profile.addresses).match(/[PMXYD]\d+/g) || [])];
  const pulseAddresses = new Set(flattenAddresses(pulse));
  assert.equal(flattenAddresses(sscnet).some(address => pulseAddresses.has(address)), false);

  const pulseState = Runtime.createState({ profile: 'mitsubishi' });
  assert.equal(Runtime.writeDevice(pulseState, sscnet.commands.servoOn.X, true).ok, false);
  assert.equal(Runtime.writeDevice(state, pulse.commands.servoOn.X, true).ok, false);

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

test('LS and Mitsubishi pulse terminal maps are selectable and never share wiring state', () => {
  const state = Runtime.createState({ profile: 'ls' });
  const lsMap = Runtime.getPulseTerminalMap(state);
  assert.equal(lsMap.profileId, 'ls');
  assert.equal(lsMap.controller.model, 'XBF-PD02A');
  assert.equal(lsMap.amplifier.model, 'XDL-L7SA004A');
  assert.deepEqual(
    lsMap.pairs.find(pair => pair.axis === 'X' && pair.direction === 'forward').source.map(pin => pin.terminal),
    ['A18', 'A17']
  );
  assert.deepEqual(
    lsMap.pairs.find(pair => pair.axis === 'X' && pair.direction === 'forward').target.map(pin => pin.terminal),
    ['CN1-9', 'CN1-10']
  );

  const lsReference = Runtime.referencePulseConnections(state);
  assert.equal(lsReference.length, 8);
  Runtime.setPulseConnections(state, lsReference.filter(connection => connection.id !== 'pulse-ls-x-forward-positive'));
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_PAIR_OPEN'), true);

  assert.equal(Runtime.setProfile(state, 'mitsubishi'), true);
  const mitsubishiMap = Runtime.getPulseTerminalMap(state);
  assert.equal(mitsubishiMap.profileId, 'mitsubishi');
  assert.equal(mitsubishiMap.controller.model, 'QD75D2N');
  assert.equal(mitsubishiMap.amplifier.model, 'MR-J4-40A');
  assert.deepEqual(
    mitsubishiMap.pairs.find(pair => pair.axis === 'X' && pair.direction === 'forward').source.map(pin => pin.terminal),
    ['1A15', '1A16']
  );
  assert.deepEqual(
    mitsubishiMap.pairs.find(pair => pair.axis === 'X' && pair.direction === 'forward').target.map(pin => `${pin.terminal} ${pin.signal}`),
    ['CN1-10 PP', 'CN1-35 NP']
  );
  assert.deepEqual(
    mitsubishiMap.pairs.find(pair => pair.axis === 'X' && pair.direction === 'reverse').target.map(pin => `${pin.terminal} ${pin.signal}`),
    ['CN1-11 PG', 'CN1-36 NG']
  );
  assert.equal(Runtime.evaluatePulseTopology(state).topologyStatus, 'PASS');
  assert.equal(Runtime.setProfile(state, 'ls'), true);
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_PAIR_OPEN'), true);
});

test('pulse topology distinguishes open, reversed polarity, crossed axis, and crossed pair role', () => {
  const state = Runtime.createState({ profile: 'ls' });
  const reference = Runtime.referencePulseConnections(state);

  Runtime.setPulseConnections(state, reference.filter(connection => connection.id !== 'pulse-ls-x-forward-negative'));
  assert.deepEqual(
    [...new Set(Runtime.evaluatePulseTopology(state).issues.filter(issue => issue.severity === 'error').map(issue => issue.code))],
    ['PULSE_PAIR_OPEN']
  );

  const reversed = reference.map(connection => {
    if (connection.id === 'pulse-ls-x-forward-positive') return { ...connection, to: { moduleId: 'pulse-ls-axis-x', anchorId: 'PF-' } };
    if (connection.id === 'pulse-ls-x-forward-negative') return { ...connection, to: { moduleId: 'pulse-ls-axis-x', anchorId: 'PF+' } };
    return connection;
  });
  Runtime.setPulseConnections(state, reversed);
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_POLARITY_REVERSED'), true);

  const axisCrossed = reference.map(connection => {
    if (!connection.id.startsWith('pulse-ls-x-forward')) return connection;
    return { ...connection, to: { ...connection.to, moduleId: 'pulse-ls-axis-y' } };
  });
  Runtime.setPulseConnections(state, axisCrossed);
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_AXIS_CROSSED'), true);

  const directionCrossed = reference.map(connection => {
    if (connection.id === 'pulse-ls-x-forward-positive') return { ...connection, to: { moduleId: 'pulse-ls-axis-x', anchorId: 'PR+' } };
    if (connection.id === 'pulse-ls-x-forward-negative') return { ...connection, to: { moduleId: 'pulse-ls-axis-x', anchorId: 'PR-' } };
    return connection;
  });
  Runtime.setPulseConnections(state, directionCrossed);
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_PAIR_ROLE_CROSSED'), true);

  const duplicatedEndpoint = [
    ...reference,
    { ...reference[0], id: 'pulse-ls-duplicate-positive' }
  ];
  Runtime.setPulseConnections(state, duplicatedEndpoint);
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_ENDPOINT_DUPLICATED'), true);
});

test('pulse topology blocks motion but not servo enable and persists safely per profile', () => {
  const state = Runtime.createState({ profile: 'mitsubishi' });
  Runtime.setPulseConnections(state, []);
  assert.equal(Runtime.setServo(state, true), true);
  assert.equal(Runtime.commandAxis(state, 'X', 100, { speed: 80 }), false);
  assert.equal(state.axes.X.alarm?.code, 'PULSE_PAIR_OPEN');

  Runtime.resetAlarms(state);
  Runtime.setPulseConnections(state, Runtime.referencePulseConnections(state));
  assert.equal(Object.values(state.axes).every(axis => !axis.servoOn), true);
  assert.equal(Runtime.setServo(state, true), true);
  assert.equal(Runtime.commandAxis(state, 'X', 100, { speed: 80 }), true);
  Runtime.stopAll(state);

  const restored = Runtime.createState({ saved: Runtime.exportState(state) });
  assert.equal(restored.profileId, 'mitsubishi');
  assert.equal(Runtime.evaluatePulseTopology(restored).topologyStatus, 'PASS');
  assert.equal(Object.values(restored.axes).every(axis => !axis.servoOn), true);
  assert.equal(Runtime.setProfile(restored, 'mitsubishi-sscnet'), true);
  assert.equal(Runtime.evaluatePulseTopology(restored).topologyStatus, 'NOT_APPLICABLE');
});

test('selected pulse profile validates command format, logic, rate, cable, and restart state', () => {
  const state = Runtime.createState({ profile: 'ls' });
  const lsSettings = Runtime.getPulseSettings(state);
  assert.equal(lsSettings.commandPulsePps, 100000);
  assert.equal(Runtime.getPulseTerminalMap(state).electrical.pathMaximumPulsePps, 1000000);
  assert.equal(Runtime.evaluatePulseTopology(state).topologyStatus, 'PASS');

  Runtime.setPulseSettings(state, { amplifierFormat: 'pulse-direction' });
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_COMMAND_FORMAT_MISMATCH'), true);
  Runtime.setPulseSettings(state, { amplifierFormat: 'cw-ccw', commandPulsePps: 1200000 });
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_RATE_EXCEEDS_RECEIVER'), true);
  Runtime.setPulseSettings(state, { commandPulsePps: 100000, cableLengthM: 10.1 });
  assert.equal(Runtime.evaluatePulseTopology(state).issues.some(issue => issue.code === 'PULSE_CABLE_LENGTH_EXCEEDED'), true);
  Runtime.setPulseSettings(state, { cableLengthM: 3, shielded: false, twistedPair: false });
  const cableCodes = Runtime.evaluatePulseTopology(state).issues.map(issue => issue.code);
  assert.ok(cableCodes.includes('PULSE_CABLE_SHIELD_UNVERIFIED'));
  assert.ok(cableCodes.includes('PULSE_CABLE_TWIST_UNVERIFIED'));

  Runtime.setPulseSettings(state, { shielded: true, twistedPair: true });
  assert.equal(Runtime.evaluatePulseTopology(state).topologyStatus, 'PASS');
});

test('Mitsubishi PA13 logic is opposite QD75 logic and restart acknowledgement stays profile-local', () => {
  const state = Runtime.createState({ profile: 'mitsubishi' });
  assert.deepEqual(Runtime.getPulseSettings(state), {
    sourceFormat: 'cw-ccw', amplifierFormat: 'cw-ccw', sourceLogic: 'positive', amplifierLogic: 'negative',
    commandPulsePps: 100000, cableLengthM: 3, twistedPair: true, shielded: true, parameterRestartApplied: true
  });
  Runtime.setPulseSettings(state, { amplifierLogic: 'positive' });
  let result = Runtime.evaluatePulseTopology(state);
  assert.ok(result.issues.some(issue => issue.code === 'PULSE_LOGIC_MISMATCH'));
  assert.ok(result.issues.some(issue => issue.code === 'PULSE_PARAMETER_RESTART_REQUIRED'));
  assert.equal(Runtime.acknowledgePulseParameterRestart(state), true);
  result = Runtime.evaluatePulseTopology(state);
  assert.equal(result.issues.some(issue => issue.code === 'PULSE_PARAMETER_RESTART_REQUIRED'), false);
  assert.equal(result.issues.some(issue => issue.code === 'PULSE_LOGIC_MISMATCH'), true);

  Runtime.setPulseSettings(state, { amplifierLogic: 'negative' });
  Runtime.acknowledgePulseParameterRestart(state);
  assert.equal(Runtime.evaluatePulseTopology(state).topologyStatus, 'PASS');
  Runtime.setProfile(state, 'ls');
  assert.equal(Runtime.getPulseSettings(state).amplifierLogic, 'positive');
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

test('commissioning guides and fault sessions stay isolated for every selectable servo profile', () => {
  const state = Runtime.createState({ profile: 'ls' });
  const lsGuide = Runtime.getCommissioningGuide(state);
  assert.equal(lsGuide.profileId, 'ls');
  assert.equal(lsGuide.evidence.manualId, 'XBF-PD02A / XDL-L7S');
  assert.ok(lsGuide.evidence.pdfPages.includes(29));
  assert.match(lsGuide.steps.map(step => step.path).join('\n'), /FP\+.*PF\+/);
  assert.match(lsGuide.steps.map(step => step.path).join('\n'), /RP\+.*PR\+/);
  assert.equal(Runtime.evaluateCommissioning(state).exerciseStatus, 'INCOMPLETE');

  assert.equal(Runtime.setTrainingStepComplete(state, lsGuide.steps[0].id, true), true);
  assert.equal(Runtime.setTrainingFault(state, 'LS_SVON_OPEN'), true);
  assert.equal(Runtime.evaluateCommissioning(state).exerciseStatus, 'FAIL');
  assert.equal(Runtime.setServo(state, true), false);
  assert.equal(Object.values(state.axes).every(axis => axis.alarm?.code === 'LS_SVON_OPEN'), true);

  assert.equal(Runtime.setProfile(state, 'mitsubishi'), true);
  assert.equal(Object.values(state.axes).every(axis => axis.alarm === null), true);
  const mitsubishiGuide = Runtime.getCommissioningGuide(state);
  assert.equal(mitsubishiGuide.profileId, 'mitsubishi');
  assert.match(mitsubishiGuide.steps.map(step => step.path).join('\n'), /QD75D2N.*MR-J4-40A/);
  assert.deepEqual(Runtime.getTrainingSession(state), { completedStepIds: [], faultId: 'NONE' });
  assert.equal(Runtime.setServo(state, true), true);

  assert.equal(Runtime.setProfile(state, 'ls'), true);
  assert.deepEqual(Runtime.getTrainingSession(state), { completedStepIds: [lsGuide.steps[0].id], faultId: 'LS_SVON_OPEN' });
  assert.equal(Object.values(state.axes).every(axis => !axis.servoOn), true);
});

test('selected pulse and SSCNET training faults affect only their real command topology', () => {
  const pulse = Runtime.createState({ profile: 'mitsubishi' });
  assert.equal(Runtime.setTrainingFault(pulse, 'MELSEC_PULSE_PATH_OPEN'), true);
  assert.equal(Runtime.setServo(pulse, true), true);
  assert.equal(Runtime.commandAxis(pulse, 'X', 100, { speed: 80 }), false);
  assert.equal(pulse.axes.X.alarm?.code, 'MELSEC_PULSE_PATH_OPEN');
  assert.equal(Runtime.setTrainingFault(pulse, 'SSCNET_AXIS_CHAIN_OPEN'), false);
  assert.equal(Runtime.evaluatePulseTopology(pulse).issues.some(issue => issue.code === 'PULSE_PAIR_OPEN'), true);
  assert.equal(Runtime.setTrainingFault(pulse, 'NONE'), true);
  assert.equal(Runtime.evaluatePulseTopology(pulse).topologyStatus, 'PASS');

  const sscnet = Runtime.createState({ profile: 'mitsubishi-sscnet' });
  assert.equal(Runtime.setServo(sscnet, true), false);
  assert.equal(sscnet.axes.X.alarm?.code, 'SSCNET_CONTROLLER_PATH_OPEN');
  Runtime.resetAlarms(sscnet);
  assert.equal(Runtime.setTrainingFault(sscnet, 'SSCNET_AXIS_CHAIN_OPEN'), true);
  assert.equal(Runtime.evaluateCommissioning(sscnet).issues.some(issue => issue.code === 'SSCNET_AXIS_CHAIN_OPEN'), true);
  assert.equal(Runtime.setTrainingFault(sscnet, 'NONE'), true);
  assert.equal(Runtime.evaluateSscnetTopology(sscnet).topologyStatus, 'PASS');
  assert.equal(Runtime.setServo(sscnet, true), true);

  const withoutCap = Runtime.referenceSscnetConnections().filter(connection => connection.id !== 'sscnet-final-cap');
  Runtime.setSscnetConnections(sscnet, withoutCap);
  Runtime.resetAlarms(sscnet);
  assert.equal(Runtime.setServo(sscnet, true), true);
  const capResult = Runtime.evaluateCommissioning(sscnet);
  assert.equal(capResult.exerciseStatus, 'FAIL');
  assert.equal(capResult.issues.some(issue => issue.code === 'SSCNET_FINAL_CAP_MISSING'), true);
});

test('commissioning progress and profile-specific faults persist without restoring energized outputs', () => {
  const state = Runtime.createState({ profile: 'mitsubishi' });
  const guide = Runtime.getCommissioningGuide(state);
  Runtime.setTrainingStepComplete(state, guide.steps[0].id, true);
  Runtime.setTrainingStepComplete(state, guide.steps[1].id, true);
  Runtime.setTrainingFault(state, 'MELSEC_SON_OPEN');

  const restored = Runtime.createState({ saved: Runtime.exportState(state) });
  assert.equal(restored.profileId, 'mitsubishi');
  assert.deepEqual(Runtime.getTrainingSession(restored), {
    completedStepIds: [guide.steps[0].id, guide.steps[1].id],
    faultId: 'MELSEC_SON_OPEN'
  });
  assert.equal(Object.values(restored.axes).every(axis => !axis.servoOn), true);
  assert.equal(Runtime.evaluateCommissioning(restored).reviewStatus, 'BLOCKED');
});

test('commissioning exercise passes only after every selected-profile step is checked', () => {
  const state = Runtime.createState({ profile: 'ls' });
  const guide = Runtime.getCommissioningGuide(state);
  for (const step of guide.steps) Runtime.setTrainingStepComplete(state, step.id, true);
  const result = Runtime.evaluateCommissioning(state);
  assert.equal(result.exerciseStatus, 'PASS');
  assert.equal(result.reviewStatus, 'BLOCKED');
  assert.deepEqual(result.progress, { completed: guide.steps.length, total: guide.steps.length });
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
