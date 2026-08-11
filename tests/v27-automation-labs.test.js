const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const ui = read('src/ui/automation-labs.js');
const multiview = read('src/ui/multiview-ui.js');

test('v2.7 loads automation runtimes, hub UI, and the authorised model bridge in order', () => {
  const order = [
    'assets/vendor/three.min.js',
    'src/runtime/palletizer-runtime.js',
    'src/runtime/servo2-runtime.js',
    'src/runtime/mps-runtime.js',
    'src/runtime/pneumatic-runtime.js',
    'src/ui/multiview-ui.js',
    'src/ui/palletizer-3d.js',
    'src/ui/sov-editor-engine.js',
    'src/ui/automation-labs.js',
    'src/ui/imported-models.js'
  ].map(value => html.indexOf(value));
  order.forEach(index => assert.ok(index > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /const PROJECT_SCHEMA_VERSION=9/);
  assert.match(html, /automationLab:window\.PLCTrainerAutomationLabs\?\.exportState/);
  assert.match(html, /type="module" src="src\/ui\/imported-models\.js"/);
  const gltfLoader = read('assets/vendor/GLTFLoader.js');
  assert.match(gltfLoader, /from '\.\/three-global\.js'/);
  assert.doesNotMatch(gltfLoader, /from '\.\/three\.module\.js'/);
});

test('automation hub exposes four labs and delegates the shared 3D view', () => {
  for (const lab of ['palletizer3d', 'servo2', 'mps', 'pneumatic']) assert.match(ui, new RegExp(`['"]${lab}['"]`));
  assert.match(ui, /PLCTrainerPalletizer3D\?\.setVisible/);
  assert.match(ui, /PLCTrainerImportedModels/);
  assert.match(ui, /servo2-workshop\.glb/);
  assert.match(ui, /mps-complete-station\.glb/);
  assert.match(multiview, /🏭 자동화 실습실/);
  assert.match(multiview, /PLCTrainerAutomationLabs/);
  assert.doesNotThrow(() => new Function(ui));
  assert.doesNotThrow(() => new Function(multiview));
});

test('automation lab camera matches the audited SoV orthographic controls and presets', () => {
  assert.match(ui, /new Three\.OrthographicCamera\(-3\.5, 3\.5, 3\.5, -3\.5, \.01, 100\)/);
  assert.match(ui, /const CAMERA_DISTANCE = 16\.17/);
  assert.match(ui, /focus: \[-2\.8e-8, \.882998, \.0190001\], pitch: 10\.67, yaw: 360, scale: \.9/);
  assert.match(ui, /focus: \[0, \.82, 0\], pitch: 90, yaw: 0, scale: 1/);
  assert.match(ui, /focus: \[5\.72e-6, \.819996, 0\], pitch: 24\.9, yaw: 20\.2, scale: \.9/);
  assert.match(ui, /focus: \[0, \.87, 0\], pitch: 27\.33, yaw: 332\.5, scale: \.76/);
  assert.match(ui, /event\.button !== 2 && event\.button !== 1/);
  assert.match(ui, /A\.drag\.yaw \+ \(event\.clientX - A\.drag\.x\) \* \.1/);
  assert.match(ui, /A\.drag\.pitch - \(event\.clientY - A\.drag\.y\) \* \.1, -20, 89\.999/);
  assert.match(ui, /addScaledVector\(forward, 20\)/);
  assert.match(ui, /setFromNormalAndCoplanarPoint\(forward\.clone\(\)\.negate\(\), planePoint\)/);
  assert.match(ui, /\.0339661 \+ \(scene\.orbit\.scale - \.450001\) \* \.104327/);
  assert.match(ui, /scene\.orbit\.scale - scaleCurve \* step, \.1, 7/);
  for (const preset of ['space', 'f1', 'f2']) assert.match(ui, new RegExp(`data-camera-preset="${preset}"`));
  assert.match(ui, /event\.code === 'Space'/);
  assert.match(ui, /isEditableTarget\(event\.target\)/);
  assert.match(ui, /addEventListener\('contextmenu'/);
  assert.doesNotMatch(ui, /addEventListener\('dblclick'/);
  assert.match(ui, /new Three\.Color\(0x3a4757\)/);
  assert.doesNotMatch(ui, /new Three\.Fog\(/);
  assert.doesNotMatch(ui, /new Three\.GridHelper\(/);
});

test('LS and Mitsubishi automation equipment pack validates and keeps vendor faults distinct', () => {
  const context = vm.createContext({ console });
  context.globalThis = context;
  vm.runInContext(read('src/device-packs/device-pack-registry.js'), context);
  vm.runInContext(read('src/device-packs/automation-equipment-pack.js'), context);
  const library = {};
  const report = context.PLCDevicePacks.installAll(library, { force: true });
  assert.equal(report.errors.length, 0);
  for (const type of ['LS-L7S-400W', 'LS-XML-SB04A', 'MELSEC-QD75D2N-RACK', 'MR-J4-40A', 'HG-KR43', 'MPS-CONVEYOR-STATION', 'PNEU-SERVICE-UNIT']) assert.ok(library[type]);
  assert.equal(library['LS-L7S-400W'].terminals.find(term => term.id === 'PF+').pin, 'CN1-9');
  assert.equal(library['MR-J4-40A'].terminals.find(term => term.id === 'EM2').safety, true);
  assert.match(library['MELSEC-QD75D2N-RACK'].notes, /모듈 축 오류.*서보 ALM/);
  assert.equal(library['MPS-CONVEYOR-STATION'].modelAsset, 'mps-complete-station.glb');
});

test('selected imported assets match their manifest and contain no executable payloads', () => {
  const base = path.join(root, 'assets', 'imported', 'sov-kdp');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  assert.equal(manifest.policy, 'authorised-selective-assets-only');
  assert.equal(manifest.models.length, 13);
  assert.equal(manifest.textures.length, 0);
  assert.equal(fs.existsSync(path.join(base, 'models', 'pneumatic-workshop.glb')), false);
  assert.equal(fs.existsSync(path.join(base, 'ASSET-NOTICE.md')), true);
  for (const entry of [...manifest.models.map(item => ({ ...item, folder: 'models' })), ...manifest.textures.map(item => ({ ...item, folder: 'textures' }))]) {
    const file = path.join(base, entry.folder, entry.file);
    assert.equal(fs.existsSync(file), true, entry.file);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(hash, entry.sha256, entry.file);
    assert.equal(/\.(exe|dll|bat|cmd|config)$/i.test(entry.file), false);
  }
  const importedFiles = fs.readdirSync(base, { recursive: true }).map(String);
  assert.equal(importedFiles.some(file => /\.(exe|dll|bat|cmd)$/i.test(file)), false);
  assert.doesNotMatch(JSON.stringify(manifest), /techflex/i);
});

test('asset extractor records the selective boundary and has no credential constants', () => {
  const extractor = read('scripts/extract-sov-kdp-assets.py');
  assert.match(extractor, /managed and native code/);
  assert.match(extractor, /authentication and account data/);
  assert.match(extractor, /source.*required=True/);
  assert.match(extractor, /m_IsActive/);
  assert.match(extractor, /SkinnedMeshRenderer/);
  assert.match(extractor, /extension_webp=True/);
  assert.match(extractor, /include_normals=True/);
  assert.match(extractor, /renderer is not None/);
  assert.match(extractor, /UNITY_TO_GLTF_BASIS @ matrix @ UNITY_TO_GLTF_BASIS/);
  assert.match(extractor, /geometry\.visual = TextureVisuals/);
  assert.match(extractor, /1625: \("Servo motion kit", "servo2-workshop\.glb"\)/);
  assert.match(extractor, /283: \("MPS equipment", "mps-complete-station\.glb"\)/);
  assert.doesNotMatch(extractor, /pneumatic-workshop\.glb/);
  assert.match(extractor, /entry\.get\("file"\) in known_models/);
  assert.match(extractor, /SCENE_PATH_TARGETS/);
  assert.doesNotMatch(extractor, /techflex/i);
  assert.doesNotMatch(ui, /techflex/i);
});
