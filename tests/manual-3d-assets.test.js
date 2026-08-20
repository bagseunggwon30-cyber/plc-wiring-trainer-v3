const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assetRoot = path.join(root, 'assets', 'manual-backed');
const manifestPath = path.join(assetRoot, 'manifest.json');
const uiPath = path.join(root, 'src', 'ui', 'automation-labs.js');
const importedModelsPath = path.join(root, 'src', 'ui', 'imported-models.js');

const EXPECTED_MODELS = Object.freeze([
  {
    file: 'xbc-dr32h.glb',
    model: 'XBC-DR32H',
    dimensionsMm: { width: 114, height: 100, depth: 64 },
    manual: 'pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf',
    pages: [39, 43, 95, 96, 125, 130, 253],
    terminalIds: ['L', 'N', 'PE', 'NC', '24V', '24G', 'COMI', ...Array.from({ length: 16 }, (_, index) => `P0${index.toString(16).toUpperCase()}`), ...Array.from({ length: 16 }, (_, index) => `P2${index.toString(16).toUpperCase()}`), 'COM0', 'COM1', 'COM2', 'COM3', 'RX', 'TX', 'SG', '485+', '485-'],
    visualNodes: ['housing:xbc', 'panel:xbc-status', 'panel:xbc-io', 'cover:xbc-expansion', 'terminal-bank:xbc-input', 'terminal-bank:xbc-output', 'led:xbc-pwr', 'brand:xgb', 'brand:ls'],
  },
  {
    file: 'mdr-100-24.glb',
    model: 'MDR-100-24',
    dimensionsMm: { width: 55, height: 90, depth: 100 },
    manual: 'pdf/01_MDR-100-24_MeanWell_SPEC.pdf',
    pages: [1, 2],
    terminalIds: ['L', 'N', 'PE', 'V+1', 'V+2', 'V-1', 'V-2', 'DCOK-A', 'DCOK-B'],
    visualNodes: ['housing:mdr', 'front:mdr', 'vent:mdr-left-0', 'vent:mdr-right-0', 'indicator:mdr-dc-ok', 'control:mdr-v-adj', 'brand:mean-well'],
  },
  {
    file: 'mc-22b-dc24.glb',
    model: 'MC-22b DC24V 1a1b',
    dimensionsMm: { width: 45, height: 73.5, depth: 103.6 },
    manual: 'pdf/08_LS_Metasol_MC_Contactor_Catalog.pdf',
    pages: [10, 18, 22, 75, 125],
    terminalIds: ['1L1', '2T1', '3L2', '4T2', '5L3', '6T3', '13', '14', '21', '22', 'A1', 'A2'],
    visualNodes: ['housing:mc', 'mechanism:mc-armature', 'mechanism:mc-orange', 'aux:mc-1a1b', 'brand:ls-mc'],
  },
  {
    file: 'my2n-d2-dc24.glb',
    model: 'MY2N-D2 DC24V',
    dimensionsMm: { width: 21.5, height: 36, depth: 28 },
    manual: 'pdf/official/Omron_MY_Series_J219-E1.pdf',
    pages: [8, 10, 20],
    terminalIds: ['1', '5', '9', '4', '8', '12', '13', '14'],
    visualNodes: ['cover:my2n-transparent', 'base:my2n', 'coil:my2n-copper', 'armature:my2n', 'runtime:coil-indicator'],
    requiresTransparency: true,
  },
  {
    file: 'eocr3de-05duh.glb',
    model: 'EOCR3DE-05DUH',
    dimensionsMm: { width: 70, height: 70, depth: 106 },
    manual: 'pdf/official/Schneider_EOCR_Digital_E_Instruction_2023.pdf',
    pages: [1, 2],
    terminalIds: ['L1-IN', 'L1-OUT', 'L2-IN', 'L2-OUT', 'L3-IN', 'L3-OUT', 'A1', 'A2', '95', '96', '97', '98', '07', '08'],
    visualNodes: ['housing:eocr', 'display:eocr-7segment', 'button:eocr-set', 'button:eocr-dn', 'button:eocr-up', 'button:eocr-reset', 'ct:eocr-l1', 'ct:eocr-l2', 'ct:eocr-l3', 'brand:schneider'],
  },
  {
    file: 'ut-2-5-3044076.glb',
    model: 'UT 2,5 / 3044076',
    dimensionsMm: { width: 5.2, height: 47.7, depth: 46.9 },
    manual: 'pdf/official/Phoenix_UT-2.5_3044076.pdf',
    pages: [1, 2, 3, 4, 7],
    terminalIds: ['1', '2'],
    visualNodes: ['profile:ut25', 'clamp:ut25-left', 'clamp:ut25-right', 'bridge:ut25-copper', 'din:ut25-foot'],
  },
  {
    file: 'ut-2-5-pe-3044092.glb',
    model: 'UT 2,5-PE / 3044092',
    dimensionsMm: { width: 5.2, height: 47.7, depth: 46.9 },
    manual: 'pdf/official/Phoenix_UT-2.5-PE_3044092.pdf',
    pages: [1, 2, 3, 5],
    terminalIds: ['1', '2'],
    visualNodes: ['profile:ut25-pe', 'clamp:ut25-pe-left', 'clamp:ut25-pe-right', 'bridge:ut25-pe', 'din:ut25-pe-foot'],
  },
  {
    file: 'ut-4-hesi-3046032.glb',
    model: 'UT 4-HESI (5X20) / 3046032',
    dimensionsMm: { width: 6.2, height: 57.8, depth: 75.6 },
    manual: 'pdf/official/Phoenix_UT-4-HESI-5x20_3046032.pdf',
    pages: [1, 2, 3, 8],
    terminalIds: ['1', '2'],
    visualNodes: ['profile:ut4-hesi', 'clamp:ut4-hesi-left', 'clamp:ut4-hesi-right', 'carrier:ut4-hesi', 'fuse:5x20', 'din:ut4-hesi-foot'],
  },
]);

function extent(bounds) {
  assert.deepEqual(Object.keys(bounds).sort(), ['max', 'min']);
  assert.equal(bounds.min.length, 3);
  assert.equal(bounds.max.length, 3);
  return bounds.max.map((value, index) => {
    assert.equal(Number.isFinite(value), true, `bounds.max[${index}] must be finite`);
    assert.equal(Number.isFinite(bounds.min[index]), true, `bounds.min[${index}] must be finite`);
    const size = value - bounds.min[index];
    assert.ok(size > 0, `bounds axis ${index} must be nonzero`);
    return Number(size.toFixed(6));
  });
}

function readGlb(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)}: GLB magic`);
  assert.equal(data.readUInt32LE(4), 2, `${path.basename(file)}: GLB version`);
  assert.equal(data.readUInt32LE(8), data.length, `${path.basename(file)}: GLB length`);

  const chunks = [];
  for (let offset = 12; offset < data.length;) {
    assert.ok(offset + 8 <= data.length, `${path.basename(file)}: truncated GLB chunk header`);
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end <= data.length, `${path.basename(file)}: truncated GLB chunk`);
    chunks.push({ type, data: data.subarray(start, end) });
    offset = end;
  }
  assert.deepEqual(chunks.map(chunk => chunk.type), [0x4E4F534A, 0x004E4942], `${path.basename(file)}: only JSON and BIN chunks are allowed`);
  return { data, document: JSON.parse(chunks[0].data.toString('utf8').trimEnd()), binary: chunks[1].data };
}

function collectUris(value, uris = []) {
  if (Array.isArray(value)) value.forEach(item => collectUris(item, uris));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'uri' && typeof item === 'string') uris.push(item);
      else collectUris(item, uris);
    }
  }
  return uris;
}

function assertNoExecutablePayload(glb) {
  const executableMagic = [Buffer.from('MZ'), Buffer.from('\x7fELF'), Buffer.from('\0asm'), Buffer.from('#!')];
  for (const marker of executableMagic) assert.equal(glb.data.includes(marker), false, `disallowed executable payload marker ${JSON.stringify(marker.toString('ascii'))}`);
  for (const uri of collectUris(glb.document)) {
    assert.match(uri, /^data:image\/(?:png|jpeg|webp);base64,/i, `external or non-image GLB URI: ${uri}`);
  }
  assert.equal(JSON.stringify(glb.document).match(/\.(?:exe|dll|bat|cmd|com|ps1|vbs|js|mjs|cjs|wasm)(?:["'\\/?#]|$)/i), null, 'GLB JSON must not refer to executable content');
}

function multiplyMatrices(left, right) {
  const result = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
    }
  }
  return result;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function assertNodesRemainNearPhysicalEnvelope(document, expected) {
  const nodes = document.nodes || [];
  const childIndexes = new Set(nodes.flatMap(node => node.children || []));
  const roots = nodes.map((_, index) => index).filter(index => !childIndexes.has(index));
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // glTF converts Blender XYZ to width/height/depth axes.  Five millimetres
  // permits labels and exposed terminal faces while still catching doubled
  // parent transforms that throw hardware outside its enclosure.
  const limits = [expected.dimensionsMm.width, expected.dimensionsMm.height, expected.dimensionsMm.depth].map(value => value / 2000 + 0.005);
  const violations = [];
  const visit = (index, parentMatrix) => {
    const node = nodes[index];
    const world = multiplyMatrices(parentMatrix, nodeMatrix(node));
    const position = [world[12], world[13], world[14]];
    if (position.some((value, axis) => Math.abs(value) > limits[axis])) violations.push(`${node.name || `node:${index}`} @ ${position.map(value => value.toFixed(4)).join(',')}`);
    for (const child of node.children || []) visit(child, world);
  };
  for (const index of roots) visit(index, identity);
  assert.deepEqual(violations, [], `${expected.file}: no node origin may float outside the physical envelope`);
}

function accessorPositions(glb, accessorIndex) {
  const accessor = glb.document.accessors?.[accessorIndex];
  assert.ok(accessor, `missing POSITION accessor ${accessorIndex}`);
  assert.equal(accessor.componentType, 5126, 'POSITION accessor must use FLOAT components');
  assert.equal(accessor.type, 'VEC3', 'POSITION accessor must use VEC3 values');
  assert.equal(accessor.sparse, undefined, 'sparse POSITION accessors are not supported by this asset contract');
  const view = glb.document.bufferViews?.[accessor.bufferView];
  assert.ok(view, `missing POSITION bufferView ${accessor.bufferView}`);
  assert.equal(view.buffer || 0, 0, 'embedded GLB positions must use buffer 0');
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 12;
  const data = new DataView(glb.binary.buffer, glb.binary.byteOffset, glb.binary.byteLength);
  return Array.from({ length: accessor.count }, (_, index) => {
    const offset = start + index * stride;
    return [data.getFloat32(offset, true), data.getFloat32(offset + 4, true), data.getFloat32(offset + 8, true)];
  });
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function assertMeshFitsPhysicalEnvelope(glb, expected) {
  const nodes = glb.document.nodes || [];
  const meshes = glb.document.meshes || [];
  const childIndexes = new Set(nodes.flatMap(node => node.children || []));
  const roots = nodes.map((_, index) => index).filter(index => !childIndexes.has(index));
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  const visit = (index, parentMatrix) => {
    const node = nodes[index];
    const world = multiplyMatrices(parentMatrix, nodeMatrix(node));
    if (Number.isInteger(node.mesh)) {
      for (const primitive of meshes[node.mesh]?.primitives || []) {
        if (!Number.isInteger(primitive.attributes?.POSITION)) continue;
        for (const local of accessorPositions(glb, primitive.attributes.POSITION)) {
          const point = transformPoint(world, local);
          for (let axis = 0; axis < 3; axis += 1) {
            if (point[axis] < minimum[axis]) minimum[axis] = point[axis];
            if (point[axis] > maximum[axis]) maximum[axis] = point[axis];
          }
        }
      }
    }
    for (const child of node.children || []) visit(child, world);
  };
  for (const index of roots) visit(index, identity);
  assert.equal(minimum.every(Number.isFinite) && maximum.every(Number.isFinite), true, `${expected.file}: mesh bounds must be finite`);
  // glTF axes are width, height, depth. A 0.1 mm tolerance covers float export
  // noise without permitting modeled hardware to exceed its manual envelope.
  const limits = [expected.dimensionsMm.width, expected.dimensionsMm.height, expected.dimensionsMm.depth].map(value => value / 2000 + 0.0001);
  const violations = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (minimum[axis] < -limits[axis] || maximum[axis] > limits[axis]) {
      violations.push(`axis ${axis}: ${(minimum[axis] * 1000).toFixed(3)}..${(maximum[axis] * 1000).toFixed(3)} mm`);
    }
  }
  assert.deepEqual(violations, [], `${expected.file}: every exported vertex must remain within the manual width/height/depth envelope`);
  return {
    min: minimum.map(value => Number((value * 1000).toFixed(6))),
    max: maximum.map(value => Number((value * 1000).toFixed(6))),
  };
}

function assertBoundsClose(actual, expected, file) {
  assert.deepEqual(Object.keys(actual).sort(), ['max', 'min'], `${file}: actual mesh bounds shape`);
  for (const side of ['min', 'max']) {
    assert.equal(actual[side].length, 3, `${file}: ${side} bounds axis count`);
    for (let axis = 0; axis < 3; axis += 1) {
      // Blender's evaluated modifier bounds and the triangulated GLB vertex
      // bounds can differ by a few hundredths of a millimetre at bevel arcs.
      assert.ok(Math.abs(actual[side][axis] - expected[side][axis]) <= 0.05,
        `${file}: manifest ${side}[${axis}] ${actual[side][axis]} must match exported mesh ${expected[side][axis]} mm`);
    }
  }
}

function discreteFunctionSource(ui) {
  const start = ui.indexOf('async function loadDiscreteAssets()');
  const end = ui.indexOf('const LAB_ASSET_LOADERS', start);
  assert.ok(start >= 0 && end > start, 'discrete asset loader must remain independently inspectable');
  return ui.slice(start, end);
}

test('manual-backed Blender asset manifest preserves exact manuals, physical bounds, terminal nodes, hashes, and safe GLBs', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceTool, 'Blender 5.2');
  assert.equal(Array.isArray(manifest.models), true);
  assert.equal(manifest.models.length, EXPECTED_MODELS.length);
  assert.equal(new Set(manifest.models.map(entry => entry.file)).size, EXPECTED_MODELS.length, 'one manifest entry per expected GLB');

  for (const expected of EXPECTED_MODELS) {
    const entry = manifest.models.find(item => item.file === expected.file);
    assert.ok(entry, `${expected.file}: missing manifest entry`);
    assert.equal(entry.model, expected.model, `${expected.file}: exact order code/model`);
    assert.deepEqual(entry.physicalDimensionsMm, expected.dimensionsMm, `${expected.file}: manual physical dimensions`);
    extent(entry.boundsMm);
    assert.deepEqual(entry.evidence, { manual: expected.manual, pages: expected.pages }, `${expected.file}: manual evidence`);
    assert.equal(fs.existsSync(path.join(root, entry.evidence.manual)), true, `${expected.file}: evidence manual must be present`);
    assert.deepEqual(entry.terminalNodes, expected.terminalIds, `${expected.file}: exact manual terminal IDs`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/i, `${expected.file}: SHA-256`);

    const file = path.join(assetRoot, expected.file);
    assert.equal(fs.existsSync(file), true, `${expected.file}: missing GLB`);
    const data = fs.readFileSync(file);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), entry.sha256.toLowerCase(), `${expected.file}: hash mismatch`);
    const glb = readGlb(file);
    assertNoExecutablePayload(glb);
    assertNodesRemainNearPhysicalEnvelope(glb.document, expected);
    const exportedBounds = assertMeshFitsPhysicalEnvelope(glb, expected);
    assert.deepEqual(entry.boundsAxes, ['width', 'height', 'depth'], `${expected.file}: bounds axis contract`);
    assertBoundsClose(entry.boundsMm, exportedBounds, expected.file);
    const names = new Set((glb.document.nodes || []).map(node => node.name));
    assert.deepEqual(entry.terminalNodes.map(id => `terminal:${id}`).filter(name => !names.has(name)), [], `${expected.file}: terminal node names`);
    assert.deepEqual(expected.terminalIds.filter(id => !(glb.document.nodes || []).some(node => node.name === `terminal:${id}` && node.extras?.terminalId === id)), [], `${expected.file}: terminal IDs must survive GLTFLoader name sanitization in node extras`);
    assert.deepEqual(expected.visualNodes.filter(name => !names.has(name)), [], `${expected.file}: product-distinguishing visual nodes`);
    if (expected.requiresTransparency) {
      assert.ok((glb.document.materials || []).some(material => material.alphaMode === 'BLEND' && Number(material.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1) < 1), `${expected.file}: transparent product cover`);
    }
  }
});

test('the equipment gallery names all manual-backed assets and the discrete lab prefers the exact MDR, XBC, and MY2N models with a Mitsubishi fallback', () => {
  const ui = fs.readFileSync(uiPath, 'utf8');
  const importedModels = fs.readFileSync(importedModelsPath, 'utf8');
  for (const expected of EXPECTED_MODELS) {
    assert.match(ui, new RegExp(`['"]${expected.file.replace(/\./g, '\\.') }['"]\\s*:\\s*['"][^'"]+['"]`), `${expected.file}: equipment gallery label`);
  }

  const discrete = discreteFunctionSource(ui);
  assert.match(discrete, /add\('source',\s*'mdr-100-24\.glb'/, 'discrete source must use the exact MDR-100-24 model');
  assert.match(discrete, /add\('plc',\s*'xbc-dr32h\.glb'/, 'discrete PLC must use the exact XBC-DR32H model');
  assert.match(discrete, /add\('relay',\s*'my2n-d2-dc24\.glb'/, 'discrete relay must use the exact MY2N-D2 DC24V model');
  assert.match(discrete, /(?:fallback|catch)[\s\S]{0,600}mitsubishi-q-plc-module\.glb|mitsubishi-q-plc-module\.glb[\s\S]{0,600}(?:fallback|catch)/i, 'discrete PLC must retain a Mitsubishi fallback when the manual-backed asset cannot load');
  assert.match(discrete, /const fallbackRotation[\s\S]{0,700}addImported\('discrete', options\.fallback, size, position, fallbackRotation/, 'a legacy fallback must retain its own authored front orientation');
  assert.match(importedModels, /new URL\(source\.manifestUrl, document\.baseURI\)/, 'manifest URLs must resolve from the packaged renderer root');
  assert.match(importedModels, /const baseUrl = new URL\(entry\.modelBaseUrl, document\.baseURI\)/, 'GLB base URLs must resolve from the packaged renderer root');
  assert.match(importedModels, /new URL\(encodeURIComponent\(entry\.file\), baseUrl\)/, 'GLB filenames must be safely resolved beneath the selected asset collection');
  assert.doesNotMatch(importedModels, /manifestUrl:\s*['"]\.\.\//, 'packaged manifest paths must not escape build\/renderer');
  const createRenderer = ui.slice(ui.indexOf('function createRenderer()'), ui.indexOf('function findImportedNode'));
  assert.doesNotMatch(createRenderer, /loadImportedAssets\(\)/, 'hidden automation labs must not prefetch every GLB during app startup');
  assert.match(ui, /function setVisible\(visible\)[\s\S]*?if \(A\.visible\) \{ void ensureLabAssets\(A\.activeLab\); setLab/, 'the active lab GLBs must start loading when the 3D lab becomes visible');
  assert.match(ui, /function cloneModelMaterials\(root\)[\s\S]*?source\.clone\(\)/, 'independent MY2N instances must clone their runtime materials');
  assert.match(discrete, /cloneModelMaterials\(payload\.model\.clone\(true\)\)/, 'the three MY2N relays must use the in-scope material clone helper');
  assert.match(ui, /id=["']al-equipment-grade["']/, 'gallery must expose a per-model review grade');
  assert.match(ui, /#al-equipment-grade[\s\S]{0,300}entry\.assetCollection === 'manual-backed'/, 'gallery must distinguish manual-backed models from appearance-only assets');
  assert.match(ui, /entry\.assetCollection === 'manual-backed' \? Math\.PI : 0/, 'gallery must turn Blender-authored fronts toward its default camera');
  assert.match(discrete, /mdr-100-24\.glb[\s\S]{0,700}rotation: \[0, Math\.PI, 0\]/, 'manual-backed discrete equipment must face the wiring camera');
});
