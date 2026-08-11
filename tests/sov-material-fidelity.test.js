const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assetRoot = path.join(root, 'assets', 'imported', 'sov-kdp');

function readGlb(filename) {
  const data = fs.readFileSync(path.join(assetRoot, 'models', filename));
  assert.equal(data.toString('ascii', 0, 4), 'glTF', filename);
  const jsonLength = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function imageSource(document, textureIndex) {
  const texture = document.textures[textureIndex];
  return texture.source ?? texture.extensions?.EXT_texture_webp?.source;
}

function material(document, name) {
  const result = document.materials.find(entry => entry.name === name);
  assert.ok(result, `material missing: ${name}`);
  return result;
}

function losslessWebpSize(uri) {
  assert.match(uri || '', /^data:image\/webp;base64,/);
  const data = Buffer.from(uri.split(',', 2)[1], 'base64');
  const marker = data.indexOf(Buffer.from('VP8L'));
  assert.notEqual(marker, -1, 'texture must use lossless WebP');
  assert.equal(data[marker + 8], 0x2f, 'invalid VP8L signature');
  const bits = data.readUInt32LE(marker + 9);
  return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
}

test('SoV labels retain native detail and Unity alpha-cutout semantics', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(assetRoot, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.materialFidelity, {
    version: 2,
    textureEncoding: 'lossless-webp',
    labelTextureMaxSize: 4096,
    surfaceTextureMaxSize: 2048,
    preservesAlphaClip: true,
    preservesAuthoredNormals: true,
    preservesAuxiliaryMaps: true,
  });

  for (const model of manifest.models) {
    const document = readGlb(model.file);
    for (const image of document.images || []) losslessWebpSize(image.uri);
  }

  const plc = readGlb('mitsubishi-q-plc-module.glb');
  for (const name of ['PLC Nameplate HOLE', 'Nameplate_Sticker_Material', 'Q03UDVCPU_Sticker_Material']) {
    const entry = material(plc, name);
    assert.equal(entry.alphaMode, 'MASK', name);
    assert.equal(entry.alphaCutoff, 0.5, name);
  }
  const nameplate = material(plc, 'Nameplate_Sticker_Material');
  const textureIndex = nameplate.pbrMetallicRoughness.baseColorTexture.index;
  assert.deepEqual(losslessWebpSize(plc.images[imageSource(plc, textureIndex)].uri), [4096, 2048]);

  const smps = readGlb('smps.glb');
  assert.equal(material(smps, 'DC Power Supply_Sticker_Material').alphaMode, 'MASK');
  const relay = readGlb('relay-module.glb');
  assert.equal(material(relay, 'Relay Unit_Sticker_Material').alphaMode, 'MASK');
});

test('SoV PBR export keeps source surface maps and authored hard-surface normals', () => {
  const mps = readGlb('mps-complete-station.glb');
  assert.ok(mps.materials.filter(entry => entry.normalTexture).length >= 7);
  assert.ok(mps.materials.filter(entry => entry.pbrMetallicRoughness?.metallicRoughnessTexture).length >= 2);
  assert.ok(mps.materials.filter(entry => entry.occlusionTexture).length >= 1);

  const extractor = fs.readFileSync(path.join(root, 'scripts', 'extract-sov-kdp-assets.py'), 'utf8');
  assert.match(extractor, /authored_normals/);
  assert.doesNotMatch(extractor, /loaded\.vertex_normals = _calculate_vertex_normals/);
  assert.doesNotMatch(extractor, /geometry\.vertex_normals = _calculate_vertex_normals/);
  assert.match(extractor, /normalTexture=/);
  assert.match(extractor, /metallicRoughnessTexture=/);
  assert.match(extractor, /occlusionTexture=/);
});
