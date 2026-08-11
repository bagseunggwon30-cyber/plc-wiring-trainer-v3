const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const Editor = require('../src/ui/sov-editor-engine.js');

function makeModule(engine, scene, id, lab = engine.lab, position = [0, 0, 0]) {
  const object = new THREE.Group(); object.name = id; object.position.fromArray(position); scene.add(object);
  const electricSocket = new THREE.Object3D(); electricSocket.position.set(.1, .2, 0); object.add(electricSocket);
  const airSocket = new THREE.Object3D(); airSocket.position.set(-.1, .15, 0); object.add(airSocket);
  engine.registerModule({
    id, lab, object,
    anchors: {
      electric: [{ id: 'E', object: electricSocket, localPosition: [.02, 0, 0], tag: 'P24' }],
      air: [{ id: 'A', object: airSocket, localPosition: [0, .01, 0], tag: 'PORT-A' }]
    }
  });
  return object;
}

test('mode allowances and Digit/Numpad hotkeys match the six SoV editor modes', () => {
  assert.deepEqual(Object.values(Editor.MODES), ['CONTROL', 'MOVE', 'WIRE', 'AIR', 'DELETE_WIRE', 'DELETE_MODULE']);
  assert.deepEqual(Editor.MODE_ALLOWANCES.servo2, ['CONTROL', 'WIRE', 'DELETE_WIRE']);
  assert.deepEqual(Editor.MODE_ALLOWANCES.mps, ['CONTROL', 'WIRE', 'DELETE_WIRE']);
  assert.deepEqual(Editor.MODE_ALLOWANCES.pneumatic, Object.values(Editor.MODES));

  const expected = ['CONTROL', 'MOVE', 'DELETE_MODULE', 'WIRE', 'AIR', 'DELETE_WIRE'];
  expected.forEach((mode, index) => {
    assert.equal(Editor.hotkeyAction({ code: `Digit${index + 1}` }), mode);
    assert.equal(Editor.hotkeyAction({ code: `Numpad${index + 1}` }), mode);
  });
  assert.equal(Editor.hotkeyAction({ code: 'Escape' }), 'CANCEL');
  assert.equal(Editor.hotkeyAction({ code: 'Digit4', ctrlKey: true }), null);
  assert.equal(Editor.hotkeyAction({ code: 'Digit4', target: { closest: () => ({}) } }), null);

  const rejected = [];
  const engine = Editor.create({ three: THREE, lab: 'servo2', onEvent: event => rejected.push(event) });
  assert.equal(engine.setMode(Editor.MODES.MOVE), false);
  assert.equal(engine.mode, Editor.MODES.CONTROL);
  assert.equal(rejected.at(-1).type, 'moderejected');
  assert.equal(engine.handleHotkey({ code: 'Numpad4', preventDefault() {} }), true);
  assert.equal(engine.mode, Editor.MODES.WIRE);
  assert.equal(engine.handleHotkey({ code: 'Escape', preventDefault() {} }), true);
  engine.dispose();
});

test('registered electric lines and air tubes use live object-local anchors and one direct link per socket', () => {
  const scene = new THREE.Scene(), events = [];
  const engine = Editor.create({ three: THREE, scene, lab: 'pneumatic', onEvent: event => events.push(event) });
  makeModule(engine, scene, 'left', 'pneumatic', [0, 0, 0]);
  makeModule(engine, scene, 'right', 'pneumatic', [2, 0, 0]);
  makeModule(engine, scene, 'third', 'pneumatic', [4, 0, 0]);
  scene.updateMatrixWorld(true);

  assert.equal(engine.moduleInfo('left').anchors.find(anchor => anchor.id === 'E').tag, 'P24');
  const anchorPosition = engine.anchorWorldPosition({ moduleId: 'left', anchorId: 'E' });
  assert.ok(anchorPosition.distanceTo(new THREE.Vector3(.12, .2, 0)) < 1e-12);
  engine.setMode(Editor.MODES.WIRE);
  const wire = engine.connect({ moduleId: 'left', anchorId: 'E' }, { moduleId: 'right', anchorId: 'E' });
  assert.equal(wire.visual.isLine, true);
  assert.equal(wire.visual.geometry.getAttribute('position').count, 2);
  assert.throws(() => engine.connect({ moduleId: 'left', anchorId: 'E' }, { moduleId: 'third', anchorId: 'E' }), /only one direct connection/);

  engine.setMode(Editor.MODES.AIR);
  assert.equal(engine.beginConnection({ moduleId: 'left', anchorId: 'A' }), true);
  assert.equal(engine.pendingConnection.visual.isMesh, true);
  assert.equal(engine.pendingConnection.visual.userData.sovEditorVisual, 'tube');
  assert.equal(engine.updateConnectionPreview([1, .5, .5]), true);
  const tube = engine.completeConnection({ moduleId: 'right', anchorId: 'A' });
  assert.ok(tube);
  assert.equal(tube.visual.geometry.type, 'CylinderGeometry');
  assert.equal(engine.pendingConnection, null);
  assert.equal(events.filter(event => event.type === 'connectioncreated').length, 2);
  engine.dispose();
});

test('pneumatic MOVE snaps on a horizontal grid and immediately updates connected endpoints', () => {
  const scene = new THREE.Scene();
  const engine = Editor.create({ three: THREE, scene, lab: 'pneumatic', gridSize: .1 });
  const left = makeModule(engine, scene, 'left');
  makeModule(engine, scene, 'right', 'pneumatic', [2, 0, 0]);
  scene.updateMatrixWorld(true);
  engine.setMode(Editor.MODES.WIRE);
  const connection = engine.connect({ moduleId: 'left', anchorId: 'E' }, { moduleId: 'right', anchorId: 'E' });
  const before = Array.from(connection.visual.geometry.getAttribute('position').array);

  engine.setMode(Editor.MODES.MOVE);
  engine.moveModule('left', [.26, 4, .74]);
  assert.deepEqual(left.position.toArray(), [.30000000000000004, 0, .7000000000000001]);
  const after = Array.from(connection.visual.geometry.getAttribute('position').array);
  assert.notDeepEqual(after, before);

  const startRay = new THREE.Ray(new THREE.Vector3(.3, 5, .7), new THREE.Vector3(0, -1, 0));
  assert.equal(engine.beginMove('left', startRay), true);
  const nextRay = new THREE.Ray(new THREE.Vector3(1.24, 5, 1.26), new THREE.Vector3(0, -1, 0));
  assert.equal(engine.updateMove(nextRay), true);
  assert.deepEqual(left.position.toArray(), [1.2000000000000002, 0, 1.3]);
  assert.equal(engine.endMove(), true);

  const servo = Editor.create({ three: THREE, lab: 'servo2' });
  const servoScene = new THREE.Scene(); makeModule(servo, servoScene, 'axis', 'servo2');
  assert.equal(servo.setMode(Editor.MODES.MOVE), false);
  assert.throws(() => servo.moveModule('axis', [1, 0, 1]), /requires MOVE mode/);
  engine.dispose(); servo.dispose();
});

test('delete-link and pneumatic delete-module cascade through visuals and socket occupancy', () => {
  const scene = new THREE.Scene();
  const engine = Editor.create({ three: THREE, scene, lab: 'pneumatic' });
  const left = makeModule(engine, scene, 'left'); makeModule(engine, scene, 'right', 'pneumatic', [2, 0, 0]);
  engine.setMode(Editor.MODES.WIRE);
  const first = engine.connect({ moduleId: 'left', anchorId: 'E' }, { moduleId: 'right', anchorId: 'E' });
  engine.setMode(Editor.MODES.DELETE_WIRE);
  assert.equal(engine.deleteLink({ moduleId: 'left', anchorId: 'E' }), true);
  assert.equal(engine.connections.size, 0);
  assert.equal(first.visual.parent, null);

  engine.setMode(Editor.MODES.WIRE);
  engine.connect({ moduleId: 'left', anchorId: 'E' }, { moduleId: 'right', anchorId: 'E' });
  engine.setMode(Editor.MODES.DELETE_MODULE);
  assert.equal(engine.deleteModule('left'), true);
  assert.equal(engine.modules.has('left'), false);
  assert.equal(engine.connections.size, 0);
  assert.equal(left.parent, null);
  engine.dispose();
});

test('serialize/import restores registered module transforms and both connection kinds atomically', () => {
  const scene1 = new THREE.Scene(), engine1 = Editor.create({ three: THREE, scene: scene1, lab: 'pneumatic', gridSize: 0 });
  makeModule(engine1, scene1, 'left'); makeModule(engine1, scene1, 'right', 'pneumatic', [2, 0, 0]);
  engine1.setMode(Editor.MODES.MOVE); engine1.moveModule('left', [.42, 0, .81]);
  engine1.setMode(Editor.MODES.WIRE); engine1.connect({ moduleId: 'left', anchorId: 'E' }, { moduleId: 'right', anchorId: 'E' });
  engine1.setMode(Editor.MODES.AIR); engine1.connect({ moduleId: 'left', anchorId: 'A' }, { moduleId: 'right', anchorId: 'A' });
  const saved = engine1.serialize();

  const scene2 = new THREE.Scene(), importedEvents = [];
  const engine2 = Editor.create({ three: THREE, scene: scene2, lab: 'servo2', onEvent: event => importedEvents.push(event) });
  const left2 = makeModule(engine2, scene2, 'left', 'pneumatic'); makeModule(engine2, scene2, 'right', 'pneumatic');
  const imported = engine2.importState(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(imported, saved);
  assert.deepEqual(left2.position.toArray(), [.42, 0, .81]);
  assert.equal(engine2.connections.size, 2);
  assert.equal(engine2.lab, 'pneumatic');
  assert.equal(engine2.mode, Editor.MODES.AIR);
  assert.equal(importedEvents.some(event => event.type === 'stateimported'), true);

  const invalid = JSON.parse(JSON.stringify(saved));
  invalid.connections.push({ id: 'duplicate-use', kind: 'electric', from: { moduleId: 'left', anchorId: 'E' }, to: { moduleId: 'right', anchorId: 'E' } });
  const before = engine2.serialize();
  assert.throws(() => engine2.importState(invalid), /Socket used more than once/);
  assert.deepEqual(engine2.serialize(), before);
  engine1.dispose(); engine2.dispose();
});

test('engine remains caller-driven with no animation, authentication, or network implementation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'sov-editor-engine.js'), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|SignalR/i);
  assert.doesNotMatch(source, /password|credential|login|auth(?:entication)?/i);
  assert.doesNotThrow(() => new Function(source));
});
