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

test('v3 loads automation runtimes, hub UI, and the local model bridge in order', () => {
  const order = [
    'assets/vendor/three.min.js',
    'src/runtime/palletizer-runtime.js',
    'src/runtime/servo2-runtime.js',
    'src/runtime/mps-runtime.js',
    'src/runtime/pneumatic-runtime.js',
    'src/runtime/discrete-io-runtime.js',
    'src/ui/multiview-ui.js',
    'src/ui/camera-navigation.js',
    'src/ui/palletizer-3d.js',
    'src/ui/sov-editor-engine.js',
    'src/ui/automation-labs.js',
    'src/ui/imported-models.js'
  ].map(value => html.indexOf(value));
  order.forEach(index => assert.ok(index > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /workspaceView:S\.workspaceView\|\|'panel'/);
  assert.match(html, /diagramLayouts:S\.diagramLayouts\|\|\{schematic:\{\},sequence:\{\}\}/);
  assert.match(html, /palletizer3d:window\.PLCTrainerPalletizer3D\?\.exportState/);
  assert.match(html, /automationLab:window\.PLCTrainerAutomationLabs\?\.exportState/);
  assert.match(html, /window\.PLCTrainerAutomationLabs\?\.importState\?\.\(S\.automationLab\)/);
  assert.match(html, /type="module" src="src\/ui\/imported-models\.js"/);
  const gltfLoader = read('assets/vendor/GLTFLoader.js');
  assert.match(gltfLoader, /from '\.\/three-global\.js'/);
  assert.doesNotMatch(gltfLoader, /from '\.\/three\.module\.js'/);
});

test('automation hub exposes six labs and delegates the shared 3D view', () => {
  for (const lab of ['palletizer3d', 'servo2', 'mps', 'pneumatic', 'discrete', 'equipment3d']) assert.match(ui, new RegExp(`['"]${lab}['"]`));
  assert.match(ui, /PLCTrainerPalletizer3D\?\.setVisible/);
  assert.match(ui, /PLCTrainerImportedModels/);
  assert.match(ui, /servo2-workshop\.glb/);
  assert.match(ui, /mps-complete-station\.glb/);
  assert.match(ui, /PLCTrainerDiscreteIoRuntime/);
  assert.match(ui, /Discrete\.setConnections/);
  assert.match(ui, /Discrete\.referenceConnections/);
  for (const asset of [
    'mitsubishi-q-plc-module.glb', 'smps.glb', 'switch-box.glb', 'relay-module.glb',
    'timer-box.glb', 'counter-unit.glb', 'counter-box.glb', 'buzzer-lamp.glb',
    'tower-lamp.glb', 'photo-sensor-npn.glb', 'photo-sensor-pnp.glb',
    'inductive-sensor-npn.glb', 'inductive-sensor-pnp.glb',
    'capacitive-sensor-npn.glb', 'capacitive-sensor-pnp.glb',
    'limit-switch-left.glb', 'limit-switch-right.glb'
  ]) assert.match(ui, new RegExp(asset.replace('.', '\\.')));
  assert.match(ui, /CanvasTexture/);
  assert.match(ui, /model\?\.traverse\?\./);
  assert.match(ui, /data-discrete-profile/);
  assert.match(multiview, /🏭 자동화 실습실/);
  assert.match(multiview, /PLCTrainerAutomationLabs/);
  assert.doesNotThrow(() => new Function(ui));
  assert.doesNotThrow(() => new Function(multiview));
});

test('manual lab controls are routed through the currently selected vendor address map', () => {
  assert.match(ui, /Servo\.writeDevice/);
  assert.match(ui, /MPS\.writeDevice/);
  assert.match(ui, /Pneumatic\.writeDevice/);
  assert.match(ui, /Discrete\.writeDevice/);
  assert.doesNotMatch(ui, /MPS\.setOutput\(/);
  assert.doesNotMatch(ui, /MPS\.setLiftServoTarget\(/);
  assert.doesNotMatch(ui, /Pneumatic\.setSupply\(/);
  assert.doesNotMatch(ui, /Pneumatic\.setCoil\(/);
});

test('pneumatic valve selection swaps the single and double solenoid equipment safely', () => {
  assert.match(ui, /addImported\('pneumatic', 'valve-5-2-single\.glb'/);
  assert.match(ui, /addImported\('pneumatic', 'valve-5-2-double\.glb'/);
  assert.match(ui, /registerEditorModule\('pneumatic', 'valve-single'/);
  assert.match(ui, /registerEditorModule\('pneumatic', 'valve-double'/);
  assert.match(ui, /function syncPneumaticValveVisual\(\)/);
  assert.match(ui, /single\.visible = state\.valve\.type === 'single'/);
  assert.match(ui, /double\.visible = state\.valve\.type === 'double'/);
  assert.match(ui, /coilB\.disabled = state\.valve\.type !== 'double'/);
  assert.match(ui, /state\.valve\.type !== 'double' && state\.valve\.coilB[\s\S]*?Pneumatic\.writeDevice\(state, Pneumatic\.getProfile\(state\)\.commands\.coilB, false\)/);
  assert.match(ui, /input\.dataset\.pneuCoil === 'B' && state\.valve\.type !== 'double'/);
  assert.match(ui, /function updatePneumaticScene\(\)[\s\S]*?syncPneumaticValveVisual\(\)/);
  assert.match(ui, /function importState\(saved\)[\s\S]*?updateScenes\(\)/);
});

test('the discrete lab uses movable 3D probes and the circuit graph as its multimeter source', () => {
  assert.match(ui, /add\('probe-black', 'banana-plug-black\.glb'/);
  assert.match(ui, /parts\.imported\['probe-red'\]/);
  assert.match(ui, /add\('ruler', 'ruler\.glb'/);
  assert.match(ui, /registerEditorModule\('discrete', 'probe-red'/);
  assert.match(ui, /function applyProbeReferenceConnections\(\)/);
  assert.match(ui, /moduleId: 'probe-red', anchorId: 'TIP'/);
  assert.match(ui, /moduleId: 'probe-black', anchorId: 'TIP'/);
  assert.match(ui, /Discrete\.measureBetween\(discrete, 'probe-red\.TIP', 'probe-black\.TIP'\)/);
  assert.match(ui, /id="al-discrete-meter-mode"/);
  assert.match(ui, /POWER_ON_CONTINUITY_BLOCKED|연속성 모드는 통전 중 자동 차단/);
});

test('automation lab camera keeps the audited orthographic presets behind shared navigation controls', () => {
  assert.match(ui, /new Three\.OrthographicCamera\(-3\.5, 3\.5, 3\.5, -3\.5, \.01, 100\)/);
  assert.match(ui, /const CAMERA_DISTANCE = 16\.17/);
  assert.match(ui, /focus: \[-2\.8e-8, \.882998, \.0190001\], pitch: 10\.67, yaw: 360, scale: \.9/);
  assert.match(ui, /focus: \[0, \.82, 0\], pitch: 90, yaw: 0, scale: 1/);
  assert.match(ui, /focus: \[5\.72e-6, \.819996, 0\], pitch: 24\.9, yaw: 20\.2, scale: \.9/);
  assert.match(ui, /focus: \[0, \.87, 0\], pitch: 27\.33, yaw: 332\.5, scale: \.76/);
  assert.match(ui, /CameraNavigation\.resolvePointerAction/);
  assert.match(ui, /CameraNavigation\.orbitFromDrag/);
  assert.match(ui, /legacyYawSign: 1, legacyPitchSign: -1/);
  assert.match(ui, /cameraNavigationPreset/);
  assert.match(ui, /value="3ds-max">3ds Max/);
  assert.match(ui, /value="legacy">기존 조작/);
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
  for (const type of ['LS-L7S-400W', 'LS-XML-SB04A', 'MELSEC-QD75D2N-RACK', 'MR-J4-40A', 'MELSEC-QD77MS2-RACK', 'MR-J4-40B', 'HG-KR43', 'MPS-CONVEYOR-STATION', 'PNEU-SERVICE-UNIT']) assert.ok(library[type]);
  assert.equal(library['LS-L7S-400W'].terminals.find(term => term.id === 'PF+').pin, 'CN1-9');
  assert.equal(library['MR-J4-40A'].terminals.find(term => term.id === 'EM2').safety, true);
  assert.equal(library['MR-J4-40B'].terminals.find(term => term.id === 'CN1A').protocol, 'SSCNET III/H');
  assert.equal(library['MR-J4-40B'].assetEvidence.status, 'BLOCKED');
  assert.equal(library['MELSEC-QD77MS2-RACK'].motionNetwork.protocol, 'SSCNET III/H');
  assert.match(library['MELSEC-QD75D2N-RACK'].notes, /모듈 축 오류.*서보 ALM/);
  assert.equal(library['MPS-CONVEYOR-STATION'].modelAsset, 'mps-complete-station.glb');
});

test('selected imported assets match their manifest and contain no executable payloads', () => {
  const base = path.join(root, 'assets', 'imported', 'sov-kdp');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  assert.equal(manifest.policy, 'selective-assets-only');
  assert.equal(manifest.models.length, 33);
  assert.equal(manifest.textures.length, 0);
  assert.equal(fs.existsSync(path.join(base, 'models', 'pneumatic-workshop.glb')), false);
  assert.equal(fs.existsSync(path.join(base, 'ASSET-NOTICE.md')), false);
  for (const file of [
    'counter-box.glb', 'sscnetiii-amp-head.glb', 'ruler.glb', 'banana-plug-black.glb',
    'workblock-steel-blue.glb', 'workblock-plastic-orange.glb'
  ]) assert.ok(manifest.models.some(entry => entry.file === file), file);
  for (const file of ['workblock-steel-blue.glb', 'workblock-plastic-orange.glb']) {
    const entry = manifest.models.find(item => item.file === file);
    assert.equal(entry.rootTransformMode, 'scale-only', file);
    const size = entry.bounds[1].map((value, index) => Number((value - entry.bounds[0][index]).toFixed(6)));
    assert.deepEqual(size, [0.06, 0.08, 0.04], file);
  }
  assert.ok(manifest.geometryExclusions.some(item => item.root === 'STWorker_Flat' && item.reason === 'duplicate-scale-variant'));
  assert.ok(manifest.geometryExclusions.some(item => item.root === 'FND_Mesh' && item.reason === 'internal-display-part'));
  assert.ok(manifest.knownLimitations.some(item => item.code === 'SKINNED_FND_NOT_EXPORTED' && item.status === 'partial-runtime-overlay'));
  assert.ok(manifest.runtimeOverlays.some(item => item.code === 'TIMER_COUNTER_FND_OVERLAY_V1' && item.status === 'implemented'));
  const labUi = read('src/ui/automation-labs.js');
  assert.match(labUi, /'sscnetiii-amp-head\.glb': 'SSCNET III 앰프 헤드'/);
  assert.match(labUi, /Mitsubishi QD75D2N \+ MR-J4-A/);
  assert.match(labUi, /Mitsubishi QD77MS2 \+ MR-J4-B \(SSCNET III\/H\)/);
  assert.match(labUi, /syncServoTopology/);
  assert.match(labUi, /referenceSscnetConnections/);
  assert.match(labUi, /sscnetiii-amp-head\.glb/);
  assert.match(labUi, /CN1A/);
  assert.match(labUi, /CN1B/);
  assert.match(labUi, /PROTECTIVE_CAP/);
  assert.match(labUi, /ASSET_MODEL_UNVERIFIED/);
  assert.match(labUi, /servo-amplifier\|sscnet\|relay/);
  assert.match(labUi, /'banana-plug-black\.glb': '바나나 플러그 · BPlugBlack'/);
  assert.match(labUi, /A\.equipmentCatalog\.length.*종/);
  assert.doesNotMatch(labUi, /\['equipment3d', '3D 장비 \d+종'\]/);
  assert.match(labUi, /workblock-steel-blue\.glb/);
  assert.match(labUi, /workblock-plastic-orange\.glb/);
  assert.match(labUi, /id="al-mps-workpiece-style"/);
  assert.match(labUi, /MPS\.setWorkpieceLength/);
  for (const entry of [...manifest.models.map(item => ({ ...item, folder: 'models' })), ...manifest.textures.map(item => ({ ...item, folder: 'textures' }))]) {
    const file = path.join(base, entry.folder, entry.file);
    assert.equal(fs.existsSync(file), true, entry.file);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(hash, entry.sha256, entry.file);
    assert.equal(/\.(exe|dll|bat|cmd|config)$/i.test(entry.file), false);
  }
  const importedFiles = fs.readdirSync(base, { recursive: true }).map(String);
  assert.equal(importedFiles.some(file => /\.(exe|dll|bat|cmd)$/i.test(file)), false);
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
});
