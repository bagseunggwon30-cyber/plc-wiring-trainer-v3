const test = require('node:test');
const assert = require('node:assert/strict');

const Discrete = require('../src/runtime/discrete-io-runtime.js');

function createPoweredReference(options = {}) {
  const inputMode = options.inputMode || 'sink';
  const state = Discrete.createState({
    profile: options.profile || 'ls',
    inputMode,
    timerPresetSeconds: options.timerPresetSeconds || 0.1,
    counterPreset: options.counterPreset || 2
  });
  Discrete.setConnections(state, Discrete.referenceConnections(inputMode));
  Discrete.setPower(state, true);
  return state;
}

function withoutConnection(connections, moduleId, anchorId) {
  return connections.filter(connection => {
    const endpoints = [connection.from, connection.to];
    return !endpoints.some(endpoint => endpoint.moduleId === moduleId && endpoint.anchorId === anchorId);
  });
}

test('reference sink wiring powers the bench and exposes only the selected LS map', () => {
  const state = createPoweredReference();
  const topology = Discrete.evaluateTopology(state);
  const ls = Discrete.getProfile(state);
  const mitsubishi = Discrete.getProfile('mitsubishi');

  assert.equal(topology.ready, true);
  assert.deepEqual(topology.issues, []);
  assert.equal(Discrete.readDevice(state, ls.inputs.switchRed), true);
  assert.equal(Discrete.writeDevice(state, ls.outputs.relay1, true).ok, true);
  assert.equal(state.effectiveOutputs.relay1, true);
  assert.equal(Discrete.readDevice(state, mitsubishi.inputs.switchRed), undefined);
  assert.equal(Discrete.writeDevice(state, mitsubishi.outputs.relay1, true).ok, false);
});

test('sink input common accepts a powered PNP sensor and rejects an active NPN sensor', () => {
  const state = createPoweredReference({ inputMode: 'sink' });
  const profile = Discrete.getProfile(state);

  Discrete.setPhysicalInput(state, 'photoPnp', true);
  Discrete.setPhysicalInput(state, 'photoNpn', true);
  const topology = Discrete.evaluateTopology(state);

  assert.equal(Discrete.readDevice(state, profile.inputs.photoPnp), true);
  assert.equal(Discrete.readDevice(state, profile.inputs.photoNpn), false);
  assert.equal(topology.issues.some(issue => issue.code === 'INPUT_TYPE_MISMATCH' && issue.objectId === 'photoNpn'), true);
});

test('source input common accepts NPN sensors and dry contacts referenced to 0V', () => {
  const state = createPoweredReference({ profile: 'mitsubishi', inputMode: 'source' });
  const profile = Discrete.getProfile(state);

  Discrete.setPhysicalInput(state, 'inductiveNpn', true);
  Discrete.setPhysicalInput(state, 'switchGreen', true);
  Discrete.evaluateTopology(state);

  assert.equal(profile.id, 'mitsubishi');
  assert.equal(Discrete.readDevice(state, profile.inputs.inductiveNpn), true);
  assert.equal(Discrete.readDevice(state, profile.inputs.switchGreen), true);
  assert.equal(state.solution.issues.some(issue => issue.code === 'INPUT_COMMON_OPEN'), false);
});

test('a commanded relay stays off and reports its exact missing 24G return', () => {
  const state = createPoweredReference();
  const profile = Discrete.getProfile(state);
  const broken = withoutConnection(state.connections, 'relay', 'RY1-');
  Discrete.setConnections(state, broken);

  const result = Discrete.writeDevice(state, profile.outputs.relay1, true);

  assert.equal(result.ok, true);
  assert.equal(state.commandOutputs.relay1, true);
  assert.equal(state.effectiveOutputs.relay1, false);
  assert.equal(state.solution.issues.some(issue => issue.code === 'LOAD_RETURN_OPEN' && issue.objectId === 'relay1'), true);
});

test('a P24-to-24G short de-energizes the MDR-powered bench and blocks voltage claims', () => {
  const state = createPoweredReference();
  const profile = Discrete.getProfile(state);
  assert.equal(Discrete.writeDevice(state, profile.outputs.relay1, true).accepted, true);
  assert.equal(state.effectiveOutputs.relay1, true);
  Discrete.setConnections(state, state.connections.concat({
    id: 'fatal-source-short',
    from: { moduleId: 'power', anchorId: 'P24-18' },
    to: { moduleId: 'power', anchorId: 'N24-18' }
  }));

  assert.equal(state.solution.ready, false);
  assert.equal(state.solution.powerReady, false);
  assert.equal(state.commandOutputs.relay1, true);
  assert.equal(state.effectiveOutputs.relay1, false);
  assert.equal(state.solution.issues.some(issue => issue.code === 'POWER_RAIL_SHORT' && issue.objectId === 'source'), true);
  assert.deepEqual(Discrete.measureBetween(state, 'source.P24', 'source.N24', 'voltage'), {
    status: 'BLOCKED',
    mode: 'voltage',
    code: 'POWER_RAIL_SHORT',
    message: 'DC 24V +24V와 24G가 단락되어 전원을 안전 차단했습니다.'
  });
});

test('timer and counter advance only through complete physical output branches', () => {
  const state = createPoweredReference({ timerPresetSeconds: 0.1, counterPreset: 2 });
  const profile = Discrete.getProfile(state);

  Discrete.writeDevice(state, profile.outputs.timer, true);
  Discrete.tick(state, 0.05);
  assert.equal(state.timer.done, false);
  Discrete.tick(state, 0.05);
  assert.equal(state.timer.done, true);

  Discrete.writeDevice(state, profile.outputs.counter, true);
  Discrete.tick(state, 0.01);
  Discrete.writeDevice(state, profile.outputs.counter, false);
  Discrete.tick(state, 0.01);
  Discrete.writeDevice(state, profile.outputs.counter, true);
  Discrete.tick(state, 0.01);
  assert.equal(state.counter.value, 2);
  assert.equal(state.counter.done, true);

  const brokenTimer = withoutConnection(state.connections, 'timer', 'N24');
  Discrete.setConnections(state, brokenTimer);
  Discrete.tick(state, 0.2);
  assert.equal(state.effectiveOutputs.timer, false);
  assert.equal(state.timer.active, false);
  assert.equal(state.solution.issues.some(issue => issue.code === 'LOAD_RETURN_OPEN' && issue.objectId === 'timer'), true);
});

test('timer completion clears immediately when its powered output branch opens', () => {
  const state = createPoweredReference({ timerPresetSeconds: 0.1 });
  const profile = Discrete.getProfile(state);

  Discrete.writeDevice(state, profile.outputs.timer, true);
  Discrete.tick(state, 0.1);
  assert.equal(state.timer.active, true);
  assert.equal(state.timer.done, true);
  assert.equal(Discrete.readDevice(state, profile.status.timerDone), true);

  Discrete.setConnections(state, withoutConnection(state.connections, 'timer', 'N24'));

  assert.equal(state.effectiveOutputs.timer, false);
  assert.equal(state.timer.active, false);
  assert.equal(state.timer.value, 0);
  assert.equal(state.timer.done, false);
  assert.equal(Discrete.readDevice(state, profile.status.timerDone), false);
});

test('counter clears its pulse edge immediately when the powered output branch opens', () => {
  const state = createPoweredReference({ counterPreset: 1 });
  const profile = Discrete.getProfile(state);

  Discrete.writeDevice(state, profile.outputs.counter, true);
  Discrete.tick(state, 0.01);
  assert.equal(state.counter.value, 1);
  assert.equal(state.counter.done, true);
  assert.equal(state.counter.previousPulse, true);

  const completeConnections = state.connections;
  Discrete.setConnections(state, withoutConnection(completeConnections, 'counter', 'N24'));

  assert.equal(state.effectiveOutputs.counter, false);
  assert.equal(state.counter.previousPulse, false);
  assert.equal(state.counter.value, 1);
  assert.equal(state.counter.done, true);

  Discrete.setConnections(state, completeConnections);
  Discrete.tick(state, 0.01);
  assert.equal(state.counter.value, 2);
  assert.equal(state.counter.done, true);
});

test('switching vendor profiles safely clears commands, timer, and counter edge state', () => {
  const state = createPoweredReference({ profile: 'ls' });
  const ls = Discrete.getProfile(state);

  Discrete.writeDevice(state, ls.outputs.relay2, true);
  Discrete.writeDevice(state, ls.outputs.timer, true);
  Discrete.writeDevice(state, ls.outputs.counter, true);
  Discrete.tick(state, 0.05);
  assert.equal(state.timer.active, true);
  assert.equal(state.counter.previousPulse, true);

  assert.equal(Discrete.setProfile(state, 'mitsubishi'), true);
  const mitsubishi = Discrete.getProfile(state);
  assert.equal(mitsubishi.id, 'mitsubishi');
  assert.equal(Object.values(state.commandOutputs).every(value => value === false), true);
  assert.equal(Object.values(state.effectiveOutputs).every(value => value === false), true);
  assert.equal(state.timer.active, false);
  assert.equal(state.timer.value, 0);
  assert.equal(state.counter.previousPulse, false);
  assert.equal(Discrete.writeDevice(state, ls.outputs.relay2, true).ok, false);
  assert.equal(Discrete.writeDevice(state, mitsubishi.outputs.relay2, true).ok, true);
});

test('export and import preserve configuration and wiring but restore safe-off', () => {
  const state = createPoweredReference({ profile: 'mitsubishi', inputMode: 'source' });
  const profile = Discrete.getProfile(state);
  state.layout = { relay: { x: 120, y: 80, z: 0 } };
  Discrete.setMeterMode(state, 'continuity');
  Discrete.setPhysicalInput(state, 'capacitiveNpn', true);
  Discrete.writeDevice(state, profile.outputs.relay3, true);
  Discrete.writeDevice(state, profile.outputs.timer, true);
  Discrete.tick(state, 0.05);

  const saved = Discrete.exportState(state);
  const restored = Discrete.createState({ saved });

  assert.equal(restored.profileId, 'mitsubishi');
  assert.equal(restored.inputMode, 'source');
  assert.equal(restored.meterMode, 'continuity');
  assert.deepEqual(restored.connections, state.connections);
  assert.deepEqual(restored.layout, state.layout);
  assert.equal(restored.physicalInputs.capacitiveNpn, true);
  assert.equal(restored.power.on, false);
  assert.equal(Object.values(restored.commandOutputs).every(value => value === false), true);
  assert.equal(Object.values(restored.effectiveOutputs).every(value => value === false), true);
  assert.equal(restored.timer.active, false);
  assert.equal(restored.timer.value, 0);
  assert.equal(restored.counter.previousPulse, false);
});

test('two 3D probe tips measure DC polarity and continuity without bypassing the wiring graph', () => {
  const state = createPoweredReference();
  const withProbes = state.connections.concat([
    { id: 'probe-red', from: { moduleId: 'probe-red', anchorId: 'TIP' }, to: { moduleId: 'power', anchorId: 'P24-19' } },
    { id: 'probe-black', from: { moduleId: 'probe-black', anchorId: 'TIP' }, to: { moduleId: 'power', anchorId: 'N24-19' } }
  ]);
  Discrete.setConnections(state, withProbes);

  assert.deepEqual(Discrete.measureBetween(state, 'probe-red.TIP', 'probe-black.TIP', 'voltage'), {
    status: 'OK', mode: 'voltage', volts: 24, unit: 'V DC', powered: true
  });
  assert.equal(Discrete.measureBetween(state, 'probe-black.TIP', 'probe-red.TIP', 'voltage').volts, -24);
  assert.equal(Discrete.measureBetween(state, 'probe-red.TIP', 'counter.DONE', 'voltage').status, 'BLOCKED');

  Discrete.setPower(state, false);
  assert.equal(Discrete.measureBetween(state, 'probe-red.TIP', 'probe-black.TIP', 'continuity').continuity, false);
  const sameRail = withProbes.map(connection => connection.id === 'probe-black'
    ? { ...connection, to: { moduleId: 'power', anchorId: 'P24-18' } }
    : connection);
  Discrete.setConnections(state, sameRail);
  assert.deepEqual(Discrete.measureBetween(state, 'probe-red.TIP', 'probe-black.TIP', 'continuity'), {
    status: 'OK', mode: 'continuity', continuity: true, ohms: 0, powered: false
  });

  Discrete.setPower(state, true);
  assert.equal(Discrete.measureBetween(state, 'probe-red.TIP', 'probe-black.TIP', 'continuity').code, 'POWER_ON_CONTINUITY_BLOCKED');
});
