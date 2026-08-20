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

test('3D wiring targets terminal holes directly without persistent floating socket markers', () => {
  assert.match(ui, /createAnchorHitTarget/);
  assert.match(ui, /sovPickEnabled/);
  assert.match(ui, /filter\(target => target\.userData\.sovPickEnabled\)/);
  assert.doesNotMatch(ui, /marker\.visible = selectedServoEquipment/);
  assert.match(ui, /hitObject: terminalSurface/);
  assert.match(ui, /style: importedDrive \? 'cn1-pin' : 'terminal-panel'/);
  assert.match(ui, /editor\.anchorWorldPosition\(ref\)/);
  assert.match(ui, /editor\.anchorWorldPosition\(editor\.pendingConnection\.anchor\)/);
});

test('LS pulse trainer replaces its fallback housing with the optimized Blender L7SA004A asset', () => {
  for (const token of ['xbf-pd02a', 'l7sa004a', 'three-dimensional-equipment', 'smart-link-connector', 'heatsink-fin-', 'encoder-connector', 'motor-connector', 'equipmentModels']) assert.match(ui, new RegExp(token));
  for (const token of ['l7sa004a-production-v3.glb', 'mountL7SA004AModel', 'TERM_CN1_09_PF_POS', 'TERM_CN1_10_PF_NEG', 'TERM_CN1_11_PR_POS', 'TERM_CN1_12_PR_NEG']) assert.match(ui, new RegExp(token));
  assert.match(ui, /model\.rotation\.y \+= Math\.PI/);
  assert.match(ui, /dimensions: importedModelInfo\?\.dimensions \|\| \{ width, height, depth \}/);
  assert.match(ui, /LS-XBF-PD02A-OFFICIAL-PRODUCT-PAGE/);
  assert.match(ui, /USER-BLENDER-5\.2-L7SA004A-PRODUCTION-V3/);
  assert.match(ui, /LS-XDL-L7S-CATALOG/);
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
  assert.match(ui, /const maxScale = scene\.lab === 'discrete' \? DISCRETE_CAMERA_BOUNDS\.maxScale : 7/);
  assert.match(ui, /scene\.orbit\.scale - scaleCurve \* step, \.1, maxScale/);
  for (const preset of ['space', 'f1', 'f2']) assert.match(ui, new RegExp(`data-camera-preset="${preset}"`));
  assert.match(ui, /event\.code === 'Space'/);
  assert.match(ui, /isEditableTarget\(event\.target\)/);
  assert.match(ui, /addEventListener\('contextmenu'/);
  assert.doesNotMatch(ui, /addEventListener\('dblclick'/);
  assert.match(ui, /new Three\.Color\(0x3a4757\)/);
  assert.doesNotMatch(ui, /new Three\.Fog\(/);
  assert.doesNotMatch(ui, /new Three\.GridHelper\(/);
});

test('lazy lab asset failures clear only their rejected memo so a later ensure retries while in-flight loads stay shared', () => {
  assert.match(ui, /if \(A\.labAssetLoads\[lab\]\) return A\.labAssetLoads\[lab\];/, 'an in-flight request must remain memoized');
  assert.match(
    ui,
    /const memoized = load\.catch\(error => \{\s*if \(A\.labAssetLoads\[lab\] === memoized\) delete A\.labAssetLoads\[lab\];\s*throw error;\s*\}\);\s*A\.labAssetLoads\[lab\] = memoized;/,
    'a rejected current memo must be removed, allowing a later ensureLabAssets call to retry without clearing a replacement load'
  );
});

test('pneumatic asset failures reject the shared load, clear its memo for retry, and keep the functional proxy visible', () => {
  const section = ui.match(/async function loadPneumaticAssets\(\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function loadEquipmentAssets/);
  assert.ok(section, 'pneumatic asset loader exists');
  const body = section[1];
  const importOptions = [...body.matchAll(/\{ authoredCoordinates: true(?:, rethrow: true)? \}/g)].map(match => match[0]);
  const assetsSettled = body.indexOf('await Promise.all(assets);');
  const proxyHidden = body.indexOf('A.scenes.pneumatic.proxyRoot.visible = false;');
  assert.equal(importOptions.length, 6, 'the six pneumatic prefab imports each have an explicit options object');
  assert.deepEqual(
    importOptions,
    Array(6).fill('{ authoredCoordinates: true, rethrow: true }'),
    'each pneumatic import must rethrow loader failures so Promise.all rejects and ensureLabAssets clears its rejected memo for retry'
  );
  assert.ok(assetsSettled >= 0, 'all required pneumatic assets are awaited');
  assert.ok(proxyHidden > assetsSettled, 'the proxy is hidden only after all required pneumatic assets load successfully; a rejected Promise.all leaves it visible');
});

test('the discrete wiring bench starts and resets with a viewport-aware full-equipment camera fit', () => {
  assert.match(ui, /const DISCRETE_CAMERA_BOUNDS = Object\.freeze\(\{ width: 12\.6, depth: 6\.3, padding: 1\.08, maxScale: 14 \}\)/);
  assert.match(ui, /function discreteFitScale\(aspect\)/);
  assert.match(ui, /Math\.max\(DISCRETE_CAMERA_BOUNDS\.width \/ safeAspect, DISCRETE_CAMERA_BOUNDS\.depth\)/);
  assert.match(ui, /data\.cameraFit = 'default'/);
  assert.match(ui, /scene\?\.lab === 'discrete' \? DISCRETE_CAMERA_PRESETS\[name\] : CAMERA_PRESETS\[name\]/);
  assert.match(ui, /scene\.cameraFit = preset\.fit \? name : null/);
  assert.match(ui, /if \(scene\.cameraFit\) scene\.orbit\.scale = discreteFitScale\(scene\.aspect\)/);
  assert.match(ui, /const maxScale = scene\.lab === 'discrete' \? DISCRETE_CAMERA_BOUNDS\.maxScale : 7/);
  assert.match(ui, /SPACE 전체 상단/);
  assert.doesNotMatch(ui, /data\.orbit = \{ yaw: 18, pitch: 32, scale: \.88 \}/);
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
  assert.equal(library['LS-L7S-400W'].servoAmplifier.maximumLineDriverInputPps, 1000000);
  assert.match(library['MELSEC-QD75D2N-RACK'].terminals.find(term => term.id === 'AX1-PF+').label, /1A15 PULSE F\+/);
  assert.equal(library['MR-J4-40A'].terminals.find(term => term.id === 'PP').signalClass, 'line-driver+');
  assert.equal(library['MR-J4-40A'].terminals.find(term => term.id === 'NP').signalClass, 'line-driver-');
  assert.match(library['MR-J4-40A'].notes, /F\+→PP\(10\).*F−→NP\(35\).*R\+→PG\(11\).*R−→NG\(36\)/);
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
  assert.match(labUi, /Mitsubishi QD75D2N \+ MR-J4-40A/);
  assert.match(labUi, /Mitsubishi QD77MS2 \+ MR-J4-B \(SSCNET III\/H\)/);
  assert.match(labUi, /syncServoTopology/);
  assert.match(labUi, /referenceSscnetConnections/);
  assert.match(labUi, /sscnetiii-amp-head\.glb/);
  assert.match(labUi, /CN1A/);
  assert.match(labUi, /CN1B/);
  assert.match(labUi, /PROTECTIVE_CAP/);
  assert.match(labUi, /ASSET_MODEL_UNVERIFIED/);
  assert.match(labUi, /id="al-servo-guide"/);
  assert.match(labUi, /data-servo-guide-step/);
  assert.match(labUi, /data-servo-training-action="fault"/);
  assert.match(labUi, /id="al-servo-pulse"/);
  assert.match(labUi, /data-servo-pulse="reference"/);
  assert.match(labUi, /data-servo-pulse="clear"/);
  assert.match(labUi, /createPulseTerminalModule/);
  assert.match(labUi, /map\.controller\.moduleId/);
  assert.match(labUi, /map\.amplifier\.moduleIds\.X/);
  assert.match(labUi, /map\.amplifier\.moduleIds\.Y/);
  assert.match(labUi, /referencePulseConnections/);
  assert.match(labUi, /setPulseConnections/);
  assert.match(labUi, /evaluatePulseTopology/);
  assert.match(labUi, /id="al-servo-pulse-source-format"/);
  assert.match(labUi, /id="al-servo-pulse-amplifier-format"/);
  assert.match(labUi, /id="al-servo-pulse-rate"/);
  assert.match(labUi, /id="al-servo-pulse-cable-length"/);
  assert.match(labUi, /id="al-servo-pulse-shielded"/);
  assert.match(labUi, /acknowledgePulseParameterRestart/);
  assert.match(labUi, /applyServoProfileConnections/);
  assert.match(labUi, /isManagedServoConnection/);
  assert.match(labUi, /isLegacyServoPlaceholder/);
  assert.match(labUi, /connection\.visual\.visible = !isLegacyServoPlaceholder/);
  assert.match(labUi, /syncServoTopology\(\); updateUi\(true\)/);
  assert.match(labUi, /getCommissioningGuide/);
  assert.match(labUi, /setTrainingStepComplete/);
  assert.match(labUi, /setTrainingFault/);
  assert.match(labUi, /evaluateCommissioning/);
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
  assert.match(extractor, /extension_webp=False/);
  assert.match(extractor, /inline_lossless_webp_textures/);
  assert.match(extractor, /alphaMode=info\["alpha_mode"\]/);
  assert.match(extractor, /normalTexture=info\.get\("normal_image"\)/);
  assert.match(extractor, /metallicRoughnessTexture=info\.get\("metallic_roughness_image"\)/);
  assert.match(extractor, /occlusionTexture=info\.get\("occlusion_image"\)/);
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

test('automation labs defer imported models behind a per-lab Promise memo boundary', () => {
  // Each tab should pay only for its own 3D assets.  The memo prevents rapid
  // tab clicks from issuing duplicate GLTF requests for the same lab.
  assert.match(ui, /async function ensureLabAssets\(lab\)/);
  assert.match(ui, /A\.labAssetLoads\s*\?\?=/);
  assert.match(ui, /A\.labAssetLoads\[lab\]/);
  assert.match(ui, /return A\.labAssetLoads\[lab\]/);
  assert.match(ui, /const load\s*=\s*Promise\.resolve\(/);
  assert.match(ui, /A\.labAssetLoads\[lab\]\s*=\s*memoized/);

  // The old all-at-once gate must not survive the lazy-loading migration.
  assert.doesNotMatch(ui, /importedLoaded/);
  assert.doesNotMatch(ui, /function loadImportedAssets\(/);
  assert.doesNotMatch(ui, /loadImportedAssets\(\)/);
});

test('tab activation requests only the active lab asset bundle', () => {
  for (const loader of ['loadServoAssets', 'loadMpsAssets', 'loadPneumaticAssets', 'loadDiscreteAssets', 'loadEquipmentAssets']) {
    assert.match(ui, new RegExp(`function ${loader}\\(`), loader);
  }
  assert.match(ui, /const LAB_ASSET_LOADERS\s*=\s*Object\.freeze\(/);
  for (const lab of ['servo2', 'mps', 'pneumatic', 'discrete', 'equipment3d']) {
    assert.match(ui, new RegExp(`${lab}:\\s*load[A-Z][A-Za-z]+Assets`), lab);
  }

  const setLab = ui.match(/function setLab\(lab\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  const setVisible = ui.match(/function setVisible\(visible\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(setLab, /void ensureLabAssets\(lab\)/);
  assert.match(setVisible, /void ensureLabAssets\(A\.activeLab\)/);
  assert.doesNotMatch(setLab, /load(?:Servo|Mps|Pneumatic|Discrete|Equipment)Assets\(/);
  assert.doesNotMatch(setVisible, /load(?:Servo|Mps|Pneumatic|Discrete|Equipment)Assets\(/);
});

test('a pneumatic retry cannot add stale in-flight models after its replacement bundle succeeds', async () => {
  // Run the production functions in a deliberately tiny Three-like harness.
  // The first bundle rejects one file while its other five GLTF promises stay
  // in flight.  A retry then succeeds before the old promises settle.  The
  // scene must still contain exactly one wrapper per prefab.
  const normalizedUi = ui.replace(/\r\n/g, '\n');
  const extract = (start, end) => {
    const from = normalizedUi.indexOf(start);
    const to = normalizedUi.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `could not extract ${start}`);
    return normalizedUi.slice(from, to);
  };
  const addImportedSource = extract('  async function addImported(', '\n\n  async function loadWorkpieceTemplates');
  const pneumaticSource = extract('  async function loadPneumaticAssets()', '\n\n  async function loadEquipmentAssets');
  const ensureSource = extract('  async function ensureLabAssets(lab)', '\n\n  function installCameraControls');
  const pending = [];
  const calls = new Map();
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const rootNode = { children: [], add(node) { this.children.push(node); } };
  class Group {
    constructor() {
      this.children = [];
      this.position = { set() {} };
    }
    add(node) { this.children.push(node); node.parent = this; }
  }
  const makeModel = filename => ({
    filename,
    rotation: { set() {} },
    position: { sub() {} },
    updateMatrixWorld() {},
    traverse() {}
  });
  const context = {
    console: { warn() {} },
    Promise,
    Three: {
      Group,
      Box3: class { setFromObject() { return this; } },
      Vector3: class {}
    },
    A: {
      scenes: {
        pneumatic: { root: rootNode, parts: { importedValves: {} }, proxyRoot: { visible: true } }
      },
      labAssetLoads: Object.create(null)
    },
    window: {
      PLCTrainerImportedModels: {
        loadModel(filename) {
          const nth = (calls.get(filename) || 0) + 1;
          calls.set(filename, nth);
          if (filename === 'service-unit.glb' && nth === 1) return Promise.reject(new Error('first bundle failure'));
          const gate = deferred();
          pending.push({ filename, nth, ...gate });
          return gate.promise.then(() => makeModel(filename));
        }
      },
      addEventListener() {}
    },
    schedule() {},
    registerEditorModule() {},
    restoreEditorState() {},
    syncPneumaticValveVisual() {},
    findImportedNode() { return null; }
  };
  context.globalThis = context;
  vm.runInNewContext(`${addImportedSource}\n${pneumaticSource}\nconst LAB_ASSET_LOADERS = { pneumatic: loadPneumaticAssets };\n${ensureSource}\nglobalThis.api = { ensureLabAssets };`, context);

  await assert.rejects(context.api.ensureLabAssets('pneumatic'), /first bundle failure/);
  const retry = context.api.ensureLabAssets('pneumatic');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.filter(item => item.nth === 2).length, 6, 'retry issues a full replacement bundle');
  for (const item of pending.filter(item => item.nth === 2)) item.resolve();
  await retry;
  for (const item of pending.filter(item => item.nth === 1)) item.resolve();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(rootNode.children.length, 6, 'late completions from the failed bundle must not duplicate scene objects');
  for (const filename of ['service-unit.glb', 'air-distributor.glb', 'valve-5-2-single.glb', 'valve-5-2-double.glb', 'speed-controller.glb', 'double-acting-cylinder.glb']) {
    assert.equal(rootNode.children.filter(wrapper => wrapper.children[0]?.filename === filename).length, 1, filename);
  }
});
