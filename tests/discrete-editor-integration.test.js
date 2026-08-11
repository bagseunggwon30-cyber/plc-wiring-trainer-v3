const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('../assets/vendor/three.min.js');
const Editor = require('../src/ui/sov-editor-engine.js');
const Discrete = require('../src/runtime/discrete-io-runtime.js');

function registerReferenceModules(editor, scene, connections) {
  const modules = new Map();
  for (const connection of connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (!modules.has(endpoint.moduleId)) modules.set(endpoint.moduleId, new Set());
      modules.get(endpoint.moduleId).add(endpoint.anchorId);
    }
  }
  for (const [moduleId, anchorIds] of modules) {
    const object = new THREE.Group(); object.name = moduleId; scene.add(object);
    const anchors = [...anchorIds].map((anchorId, index) => {
      const anchor = new THREE.Object3D(); anchor.position.set(index * .01, 0, 0); object.add(anchor);
      return { id: anchorId, kind: 'electric', object: anchor, localPosition: [0, 0, 0], tag: anchorId };
    });
    editor.registerModule({ id: moduleId, lab: 'discrete', object, anchors });
  }
}

test('3D editor wiring is the discrete runtime netlist and a deleted return opens the load', () => {
  const scene = new THREE.Scene();
  const editor = Editor.create({ three: THREE, scene, lab: 'discrete' });
  const reference = Discrete.referenceConnections('sink');
  registerReferenceModules(editor, scene, reference);
  editor.setMode(Editor.MODES.WIRE);
  for (const connection of reference) editor.connect(connection.from, connection.to, { id: connection.id });

  const state = Discrete.createState({ profile: 'ls', inputMode: 'sink' });
  Discrete.setConnections(state, editor.serialize().connections);
  Discrete.setPower(state, true);
  assert.equal(state.solution.ready, true);

  const relayReturn = [...editor.connections.values()].find(connection => [connection.from, connection.to].some(anchor => anchor.moduleId === 'relay' && anchor.id === 'RY1-'));
  editor.setMode(Editor.MODES.DELETE_WIRE);
  assert.equal(editor.deleteLink(relayReturn.id), true);
  Discrete.setConnections(state, editor.serialize().connections);
  Discrete.writeDevice(state, Discrete.getProfile(state).outputs.relay1, true);

  assert.equal(state.effectiveOutputs.relay1, false);
  assert.equal(state.solution.issues.some(issue => issue.code === 'LOAD_RETURN_OPEN' && issue.objectId === 'relay1'), true);
  editor.dispose();
});
