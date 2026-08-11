const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'src', 'renderer', 'workflow-app.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src', 'renderer', 'v3', 'wiring-assistant-panel.ts'), 'utf8');

test('v3 wiring assistant uses the typed domain planner instead of legacy polarity score guesses', () => {
  assert.match(workflow, /suggestWiringPlans\(migrated\.document, deviceIds, intent/);
  assert.doesNotMatch(html, /WIRING_GUIDE_RULES|wiringGuidePhase|wiringGuideCommScore/);
  assert.match(panel, /남은 필수 경로·확인/);
  assert.match(panel, /안내는 정식 검증 결과가 아닙니다/);
});

test('selection and suggested-wire preview cross a narrow non-committing renderer bridge', () => {
  assert.match(html, /workshop-selection-change/);
  assert.match(html, /readSelection\(\)\{return \{deviceIds:selectedDeviceIds\(\)\.sort\(\)\};\}/);
  const previewStart = html.indexOf('previewSuggestedWire(from,to){');
  const previewEnd = html.indexOf('focusRefs(refs){', previewStart);
  assert.notEqual(previewStart, -1);
  assert.notEqual(previewEnd, -1);
  const preview = html.slice(previewStart, previewEnd);
  assert.match(preview, /connectionAssessment\(source,target\)/);
  assert.match(preview, /S\.pending=\{dev:source\.dev,term:source\.term/);
  assert.doesNotMatch(preview, /S\.wires\.push|connectTerms\(/);
  assert.match(panel, /direct\.status !== 'READY'/);
});

test('ordinary rendering still does not trigger formal validation after assistant integration', () => {
  const renderBody = /function render\(\)\{([\s\S]*?)\n\}/.exec(html)?.[1] ?? '';
  assert.match(renderBody, /refreshLiveTopology\(\)/);
  assert.doesNotMatch(renderBody, /\bvalidate\(\)/);
});

test('selecting exactly two devices automatically shows ordered source-load-return flow', () => {
  assert.match(panel, /if \(selectedDeviceIds\.length === 2\) void calculate\('automatic'\)/);
  assert.match(panel, /options\.showFlow\(flowSteps\)/);
  assert.match(panel, /\+ 공급/);
  assert.match(panel, /장비·신호/);
  assert.match(panel, /0V\/N 귀로/);
  assert.match(workflow, /showWiringFlowV3\(steps/);
  assert.match(workflow, /clearWiringFlowV3\(\)/);
});
