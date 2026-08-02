const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const workflowSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'workflow-app.ts'), 'utf8');

test('review boundary nodes are explicit non-BOM logical devices', () => {
  for (const type of [
    'BOUNDARY-AC', 'BOUNDARY-DC', 'BOUNDARY-CONTACT', 'BOUNDARY-LOAD',
    'BOUNDARY-ANALOG-V', 'BOUNDARY-ANALOG-I',
    'BOUNDARY-ANALOG-V-IN', 'BOUNDARY-ANALOG-I-IN', 'BOUNDARY-2W-I', 'BOUNDARY-RS485',
  ]) {
    assert.match(source, new RegExp(`'${type}'\\s*:`));
  }
  assert.ok((source.match(/reviewBoundary:true/g) || []).length >= 10);
  assert.ok((source.match(/includeInBom:false/g) || []).length >= 10);
  assert.ok((source.match(/reviewBoundary:true,includeInBom:false,\s*mount:\{tags:\['free'\]/g) || []).length >= 10);
});

test('legacy renderer exposes a revisioned bridge for the typed renderer', () => {
  assert.match(source, /revision:1/);
  assert.match(source, /S\.revision\s*=\s*\(S\.revision\|\|0\)\+1/);
  assert.match(source, /window\.LegacyTrainerBridge\s*=/);
  assert.match(source, /readState\(\)/);
  assert.match(source, /readV2Shadow\(\)/);
  assert.match(source, /clearV2Shadow\(\)/);
  assert.match(source, /rememberDocumentV2\(document\)/);
  assert.match(source, /workshopV2RenderedDeviceIds/);
  assert.match(source, /setMultiDeviceSelection\(\[\.\.\.deviceRefs\]\)/);
  assert.match(source, /applyDocumentV2\(document\)/);
});

test('legacy live refresh cannot replace the mounted v3 mission and device settings panel', () => {
  assert.match(source, /function render\(\)\{[\s\S]*renderJumpers\(\);\s*updateMissionCoach\(\);/);
  assert.match(source, /document\.getElementById\('core-toolbar'\)[\s\S]*workshop-render-missions/);
  assert.match(workflowSource, /addEventListener\('workshop-render-missions'[\s\S]*renderMissions\(\)/);
});

test('legacy fallback loading resets mission session state and the V2 shadow first', () => {
  const fallback = /if \(restored === null\) \{([\s\S]*?)\n\s*return;\n\s*\}/.exec(workflowSource)?.[1] ?? '';
  const resetIndex = fallback.indexOf('selectedMissionId = null;');
  const missionResetIndex = fallback.indexOf('resetMissionSessionState(bindingsByMission, hintLevelByMission);');
  const shadowClearIndex = fallback.indexOf('bridge.clearV2Shadow();');
  const legacyLoadIndex = fallback.indexOf('legacyLoad?.call(loadButton, event);');
  assert.ok(resetIndex >= 0 && missionResetIndex > resetIndex && shadowClearIndex > missionResetIndex && legacyLoadIndex > shadowClearIndex,
    'legacy fallback must reset mission state and clear the v2 shadow before delegating to the legacy loader');
});

test('startup restores persisted V2 before opening an empty-workspace mode selector', () => {
  assert.match(workflowSource, /const storedV2 = loadWorkshopV2\(localStorage\);[\s\S]*if \(storedV2\?\.ok\) return storedV2\.document;/);
  assert.match(workflowSource, /const restored = await loadBestStoredWorkshop\(\);[\s\S]*if \(!restored\) \{[\s\S]*openModeSelector\(\);[\s\S]*return;[\s\S]*\}[\s\S]*applyLoadedWorkshop/);
});
