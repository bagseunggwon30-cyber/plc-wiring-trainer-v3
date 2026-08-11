const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const vite = read('vite.config.ts');
const multiview = read('src/ui/multiview-ui.js');
const importedModels = read('src/ui/imported-models.js');
const automationLabs = read('src/ui/automation-labs.js');
const runtimeVisuals = read('src/ui/runtime-visual-state.js');

test('v3 installs additive equipment packs without replacing manual-backed device definitions', () => {
  const registry = html.indexOf('src/device-packs/device-pack-registry.js');
  const xgb = html.indexOf('src/device-packs/ls-xgb-v24-pack.js');
  const expansion = html.indexOf('src/device-packs/ls-xgb-expansion-pack.js');
  const automation = html.indexOf('src/device-packs/automation-equipment-pack.js');
  const install = html.indexOf('PLCDevicePacks.installAll(LIB,{force:false,replaceExisting:false})');
  assert.ok(registry > 0 && registry < xgb && xgb < expansion && expansion < automation && automation < install);
});

test('v3 keeps automation view state across save, load, undo, and clear', () => {
  for (const token of [
    "workspaceView:'panel'",
    'diagramLayouts:{schematic:{},sequence:{}}',
    'palletizer3d:null',
    'automationLab:null',
    'workspaceView:S.workspaceView',
    'diagramLayouts:S.diagramLayouts',
    'window.PLCTrainerPalletizer3D?.importState?.(S.palletizer3d)',
    'window.PLCTrainerAutomationLabs?.importState?.(S.automationLab)'
  ]) assert.ok(html.includes(token), token);
  assert.match(html, /S\.workspaceView='panel';S\.diagramLayouts=\{schematic:\{\},sequence:\{\}\};S\.palletizer3d=null;S\.automationLab=null/);
});

test('renderer build copies local automation scripts, vendor modules, manifest, and GLB models', () => {
  for (const token of [
    "'src/device-packs'",
    "'src/runtime'",
    "'src/ui'",
    "'assets/vendor'",
    "'assets/imported/sov-kdp'",
    "'assets/devices/gpt-expansion'"
  ]) assert.ok(vite.includes(token), token);
});

test('selecting a workspace view closes the advanced-tools overlay', () => {
  assert.match(multiview, /const advancedTools=q\('#advanced-tools'\);if\(advancedTools\?\.open\)advancedTools\.open=false/);
});

test('imported SoV GLBs use CSP-safe inlined WebP textures and match the asset manifest', () => {
  const assetRoot = path.join(root, 'assets', 'imported', 'sov-kdp');
  const manifest = JSON.parse(fs.readFileSync(path.join(assetRoot, 'manifest.json'), 'utf8'));

  for (const model of manifest.models) {
    const file = path.join(assetRoot, 'models', model.file);
    const data = fs.readFileSync(file);
    assert.equal(data.toString('ascii', 0, 4), 'glTF', model.file);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), model.sha256, model.file);
    assert.equal(data.length, model.bytes, model.file);

    const jsonLength = data.readUInt32LE(12);
    const document = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    for (const image of document.images || []) {
      assert.match(image.uri || '', /^data:image\/webp;base64,/, `${model.file} texture transport`);
      assert.equal(image.bufferView, undefined, `${model.file} must not create blob-backed textures`);
    }
  }
});

test('WebP model textures use the DOM texture loader when ImageBitmap decoding is unavailable', () => {
  assert.match(importedModels, /new globalThis\.THREE\.LoadingManager\(\)/);
  assert.match(importedModels, /addHandler\(\/\^data:image\\\/webp\/i, webpTextureLoader\)/);
});

test('3D equipment gallery exposes every selective model and lazy-loads only the selected asset', () => {
  const manifest = JSON.parse(read('assets/imported/sov-kdp/manifest.json'));
  assert.equal(manifest.models.length, 29);
  assert.match(automationLabs, /\['palletizer3d', 'servo2', 'mps', 'pneumatic', 'equipment3d'\]/);
  assert.match(automationLabs, /await window\.PLCTrainerImportedModels\.loadManifest\(\)/);
  assert.match(automationLabs, /await window\.PLCTrainerImportedModels\.loadModel\(filename/);
  assert.match(automationLabs, /while \(modelRoot\.children\.length\)/);
  assert.doesNotMatch(automationLabs, /Promise\.all\(A\.equipmentCatalog/);
  for (const file of ['relay-module.glb', 'smps.glb', 'photo-sensor-npn.glb', 'photo-sensor-pnp.glb', 'tower-lamp.glb']) {
    assert.ok(manifest.models.some(model => model.file === file), file);
  }
});

test('XG-SIM frame state is projected onto existing SVG devices without a second circuit solver', () => {
  assert.match(html, /src\/ui\/runtime-visual-state\.js/);
  assert.match(html, /window\.PLCTrainerRuntimeVisuals\?\.apply\?\.\(\)/);
  assert.match(runtimeVisuals, /xgsim-runtime-visual-frame/);
  assert.match(runtimeVisuals, /#g-devices > g\.device\[data-id\]/);
  assert.match(runtimeVisuals, /#g-terminals > g\[data-id\] \.terminal\[data-id\]\[data-term\]/);
  assert.match(runtimeVisuals, /runtime-contact-closed/);
  assert.match(runtimeVisuals, /workshop-document-revision/);
  assert.doesNotMatch(runtimeVisuals, /solveCircuit|simulateScenario|buildCircuitModel|buildPrewireCircuitV3/);
});
