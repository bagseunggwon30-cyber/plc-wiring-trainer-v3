const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src', 'ui', 'camera-navigation.js');
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const automation = fs.readFileSync(path.join(root, 'src', 'ui', 'automation-labs.js'), 'utf8');
const palletizer = fs.readFileSync(path.join(root, 'src', 'ui', 'palletizer-3d.js'), 'utf8');

function loadNavigation() {
  const window = {};
  vm.runInNewContext(source, { window, globalThis: window });
  return window.PLCTrainerCameraNavigation;
}

test('shared camera navigation exposes the 3ds Max and legacy presets', () => {
  assert.notEqual(source, '');
  assert.doesNotThrow(() => new Function(source));
  const navigation = loadNavigation();
  assert.equal(navigation.normalizePreset('3ds-max'), '3ds-max');
  assert.equal(navigation.normalizePreset('legacy'), 'legacy');
  assert.equal(navigation.normalizePreset('unknown'), '3ds-max');
});

test('3ds Max navigation uses Alt+MMB orbit and bare MMB pan', () => {
  const navigation = loadNavigation();
  assert.equal(navigation.resolvePointerAction({ button: 1, altKey: true }, '3ds-max'), 'orbit');
  assert.equal(navigation.resolvePointerAction({ button: 1, altKey: false }, '3ds-max'), 'pan');
  assert.equal(navigation.resolvePointerAction({ button: 0, altKey: true }, '3ds-max'), null);
  assert.equal(navigation.resolvePointerAction({ button: 2, altKey: true }, '3ds-max'), null);
});

test('3ds Max orbit direction is opposite the old automation-lab direction', () => {
  const navigation = loadNavigation();
  assert.deepEqual(
    { ...navigation.orbitFromDrag('3ds-max', { yaw: 10, pitch: 20 }, { x: 5, y: 6 }, { yaw: 0.1, pitch: 0.1 }) },
    { yaw: 9.5, pitch: 20.6 },
  );
  assert.deepEqual(
    { ...navigation.orbitFromDrag('legacy', { yaw: 10, pitch: 20 }, { x: 5, y: 6 }, { yaw: 0.1, pitch: 0.1, legacyYawSign: 1, legacyPitchSign: -1 }) },
    { yaw: 10.5, pitch: 19.4 },
  );
});

test('legacy pointer mappings can preserve each previous viewport behavior', () => {
  const navigation = loadNavigation();
  assert.equal(navigation.resolvePointerAction({ button: 2 }, 'legacy', { orbitButtons: [2], panButtons: [1] }), 'orbit');
  assert.equal(navigation.resolvePointerAction({ button: 1 }, 'legacy', { orbitButtons: [2], panButtons: [1] }), 'pan');
  assert.equal(navigation.resolvePointerAction({ button: 1 }, 'legacy', { orbitButtons: [0, 1, 2], panButtons: [] }), 'orbit');
});

test('all five 3D labs share and persist the selectable navigation preset', () => {
  const shared = html.indexOf('src/ui/camera-navigation.js');
  const pallet = html.indexOf('src/ui/palletizer-3d.js');
  const labs = html.indexOf('src/ui/automation-labs.js');
  assert.ok(shared > 0 && shared < pallet && pallet < labs);
  assert.match(automation, /id="al-camera-navigation"/);
  assert.match(automation, /cameraNavigationPreset/);
  assert.match(automation, /setCameraNavigationPreset/);
  assert.match(palletizer, /resolvePointerAction/);
  assert.match(palletizer, /setCameraNavigationPreset/);
});
