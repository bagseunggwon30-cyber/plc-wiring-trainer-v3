const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modelPath = path.join(root, 'assets', 'models', 'automation', 'palletizer-3axis-v2.glb');
const MAX_GLB_BYTES = 5 * 1024 * 1024;
const MAX_TRIANGLES = 100_000;

function readGlbJson(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, 'asset must use the binary glTF magic');
  assert.equal(buffer.readUInt32LE(4), 2, 'asset must use glTF 2.0');
  assert.equal(buffer.readUInt32LE(8), buffer.length, 'GLB header length must match the file');
  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a, 'first GLB chunk must be JSON');
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function triangleCount(gltf) {
  const accessors = gltf.accessors || [];
  const meshes = gltf.meshes || [];
  const perMesh = meshes.map(mesh => (mesh.primitives || []).reduce((total, primitive) => {
    const mode = primitive.mode ?? 4;
    if (mode !== 4) return total;
    const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
    const count = accessors[accessorIndex]?.count || 0;
    return total + Math.floor(count / 3);
  }, 0));
  return (gltf.nodes || []).reduce((total, node) => total + (node.mesh == null ? 0 : perMesh[node.mesh] || 0), 0);
}

test('palletizer GLB stays inside the Electron renderer asset budget', () => {
  const size = fs.statSync(modelPath).size;
  assert.ok(size <= MAX_GLB_BYTES, `palletizer GLB is ${(size / 1024 / 1024).toFixed(2)} MiB; budget is 5 MiB`);

  const gltf = readGlbJson(modelPath);
  const triangles = triangleCount(gltf);
  assert.ok(triangles > 0, 'palletizer must contain renderable triangles');
  assert.ok(triangles <= MAX_TRIANGLES, `palletizer has ${triangles.toLocaleString()} triangles; budget is 100,000`);
  assert.equal((gltf.animations || []).length, 0, 'runtime drives the named axis nodes; embedded animations are forbidden');
});

test('palletizer GLB preserves the runtime moving hierarchy and one root', () => {
  const gltf = readGlbJson(modelPath);
  const nodes = gltf.nodes || [];
  const scenes = gltf.scenes || [];
  const activeScene = scenes[gltf.scene || 0];
  assert.deepEqual((activeScene?.nodes || []).map(index => nodes[index]?.name), ['PALLETIZER_ROOT']);

  const indices = new Map(nodes.map((node, index) => [node.name, index]));
  const required = ['PALLETIZER_ROOT', 'STATIC_STRUCTURE', 'X_Carriage', 'Y_Carriage', 'Z_Slide', 'Gripper', 'Jaw_L', 'Jaw_R'];
  for (const name of required) assert.ok(indices.has(name), `missing required palletizer node: ${name}`);

  const parents = new Map();
  nodes.forEach((node, parent) => (node.children || []).forEach(child => parents.set(child, parent)));
  const expectParent = (child, parent) => assert.equal(nodes[parents.get(indices.get(child))]?.name, parent, `${child} must be parented to ${parent}`);
  expectParent('STATIC_STRUCTURE', 'PALLETIZER_ROOT');
  expectParent('X_Carriage', 'PALLETIZER_ROOT');
  expectParent('Y_Carriage', 'X_Carriage');
  expectParent('Z_Slide', 'Y_Carriage');
  expectParent('Gripper', 'Z_Slide');
  expectParent('Jaw_L', 'Gripper');
  expectParent('Jaw_R', 'Gripper');
  assert.equal(nodes.some(node => /^AUTHORING_/.test(node.name || '')), false, 'authoring cameras/lights must not leak into the app GLB');
});
