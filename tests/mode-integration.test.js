const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const workflowSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'workflow-app.ts'), 'utf8');

test('review boundary nodes are explicit non-BOM logical devices', () => {
  for (const type of ['BOUNDARY-AC', 'BOUNDARY-DC', 'BOUNDARY-CONTACT', 'BOUNDARY-LOAD', 'BOUNDARY-RS485']) {
    assert.match(source, new RegExp(`'${type}'\\s*:`));
  }
  assert.ok((source.match(/reviewBoundary:true/g) || []).length >= 5);
  assert.ok((source.match(/includeInBom:false/g) || []).length >= 5);
  assert.ok((source.match(/reviewBoundary:true,includeInBom:false,\s*mount:\{tags:\['free'\]/g) || []).length >= 5);
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

test('legacy fallback loading resets mission session state and the V2 shadow first', () => {
  assert.match(workflowSource, /selectedMissionId\s*=\s*null;\s*resetMissionSessionState\(bindingsByMission, hintLevelByMission\);\s*const result/s);
  assert.match(workflowSource, /if \(result === null\) \{\s*bridge\.clearV2Shadow\(\);\s*legacyLoad\?\.call/s);
});
