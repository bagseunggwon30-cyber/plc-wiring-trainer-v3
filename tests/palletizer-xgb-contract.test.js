const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/palletizer-runtime.js');

function snapshotMotion(state) {
  return {
    auto: { running: state.auto.running, state: state.auto.state },
    axes: Object.fromEntries(Object.entries(state.axes).map(([name, axis]) => [name, {
      servoOn: axis.servoOn,
      mode: axis.mode,
      position: axis.position,
      target: axis.target,
    }])),
  };
}

function tickUntil(state, predicate, seconds = 20) {
  for (let count = 0; count < seconds * 50 && !predicate(); count += 1) Runtime.tick(state, 0.02);
}

test('XGB production profile mirrors the reviewed XG5000 ladder command and physical-input contract', () => {
  const profile = Runtime.getProfile('xgb-production');

  assert.equal(profile.id, 'xgb-production');
  assert.deepEqual(profile.commands, {
    autoStart: 'M00123',
    stop: 'M00124',
    newPallet: 'M00125',
    reset: 'M00126',
    manualOrg: 'M00119',
    servoOn: 'M00111',
    servoOff: 'M00122',
  });
  assert.equal(profile.actual.step, 'D00000');
  assert.deepEqual(Object.values(profile.inputs), [
    'P00000', 'P00001', 'P00002', 'P00003', 'P00004', 'P00005', 'P00006', 'P00007',
    'P00008', 'P00009', 'P0000A', 'P0000B', 'P0000C', 'P0000D', 'P0000E', 'P0000F',
  ]);
});

test('fresh or unhomed machine rejects AUTO START without energizing, changing mode, or commanding a position', () => {
  const state = Runtime.createState({ profile: 'xgb-production', axes: { X: { position: 250 }, Y: { position: 120 }, Z: { position: 60 } } });
  const before = snapshotMotion(state);

  assert.deepEqual(Runtime.writeDevice(state, 'M00123', true), {
    ok: true, address: 'M00123', value: true, accepted: false,
  });
  assert.deepEqual(snapshotMotion(state), before);
  assert.equal(Runtime.readDevice(state, 'D00000'), 0);
});

test('manual ORG is blocked while AUTO is active and otherwise homes one axis at a time Z then X then Y', () => {
  const active = Runtime.createState({ profile: 'xgb-production' });
  active.auto.running = true;
  active.auto.state = 'PREFLIGHT';
  assert.equal(Runtime.requestManualOrg(active), false);

  const state = Runtime.createState({ profile: 'xgb-production', axes: { X: { position: 300 }, Y: { position: 200 }, Z: { position: 50 } } });
  Runtime.setServo(state, null, true);
  assert.equal(Runtime.requestManualOrg(state), true);
  assert.equal(state.manualOrg.step, 10);
  assert.equal(state.axes.Z.mode, 'home');
  assert.equal(state.axes.X.mode, 'idle');
  assert.equal(state.axes.Y.mode, 'idle');

  tickUntil(state, () => state.manualOrg.step === 20);
  assert.equal(state.axes.Z.homed, true);
  assert.equal(state.axes.X.mode, 'home');
  assert.equal(state.axes.Y.mode, 'idle');
  tickUntil(state, () => state.manualOrg.step === 30);
  assert.equal(state.axes.X.homed, true);
  assert.equal(state.axes.Y.mode, 'home');
  tickUntil(state, () => state.manualOrg.step === 0);
  assert.equal(Runtime.allHomed(state), true);
});

test('three-layer slot computation follows the ladder Z decreasing convention', () => {
  const state = Runtime.createState({
    profile: 'xgb-production',
    cell: { pallet: { rows: 1, cols: 1, layers: 3, origin: { x: 342, y: 146, z: 240 }, layerHeight: 34 } },
  });

  assert.deepEqual([0, 1, 2].map(index => Runtime.palletSlot(state, index).z), [240, 206, 172]);
});

test('physical DI updates use the PLC-input API only; generic device writes cannot alter P inputs', () => {
  const state = Runtime.createState({ profile: 'xgb-production' });

  assert.deepEqual(Runtime.writeDevice(state, 'P00006', true), {
    ok: false,
    error: 'P00006 is a physical input; use setPhysicalInput',
  });
  assert.equal(Runtime.setPhysicalInput(state, 'P00006', true), true);
  assert.equal(Runtime.readDevice(state, 'P00006'), true);
  assert.equal(Runtime.setPhysicalInput(state, 'P00020', true), false);
});
