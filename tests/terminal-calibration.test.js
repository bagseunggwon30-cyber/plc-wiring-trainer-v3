const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('terminal model separates visual, hit, anchor, and lead-out roles', () => {
  assert.match(html, /function\s+terminalRolePoint\s*\(/);
  assert.match(html, /function\s+rotatedTerminalPose\s*\(/);
  assert.match(html, /function\s+terminalLeadOutPoint\s*\(/);
  assert.match(html, /terminalRolePoint\([^)]*['"]visual['"]/);
  assert.match(html, /terminalRolePoint\([^)]*['"]anchor['"]/);
  assert.match(html, /leadOut:\s*terminalLeadOutSpec\(/);
});

test('calibration state is saved, loaded, and applied to DEVICE_TERMINAL_DATA', () => {
  assert.match(html, /terminalCalibration:\s*S\.terminalCalibration/);
  assert.match(html, /S\.terminalCalibration\s*=/);
  assert.match(html, /function\s+applyTerminalCalibrationToRegistry\s*\(/);
  assert.match(html, /DEVICE_TERMINAL_DATA\[type\]\s*=\s*cloneTerminalData/);
  assert.match(html, /function\s+persistTerminalCalibration\s*\(/);
  assert.match(html, /function\s+beginTerminalCalibrationDrag\s*\(/);
});

test('nearest terminal snap uses an RBush-backed index with a 20px snap radius', () => {
  assert.match(html, /rbush/i);
  assert.match(html, /const\s+TERMINAL_SNAP_RADIUS\s*=\s*20/);
  assert.match(html, /function\s+buildTerminalSnapIndex\s*\(/);
  assert.match(html, /function\s+findNearestTerminal\s*\(/);
  assert.match(html, /\.search\(\s*\{\s*minX:/);
});

test('calibration UI exposes debug overlay roles without changing image assets', () => {
  assert.match(html, /id="m-calib"/);
  assert.match(html, /id="m-term-debug"/);
  assert.match(html, /terminal-debug-visual/);
  assert.match(html, /terminal-debug-hit/);
  assert.match(html, /terminal-debug-anchor/);
  assert.match(html, /terminal-debug-lead/);
  assert.doesNotMatch(html, /\.(png|jpg|jpeg|webp)['"]\s*=/i);
});

test('calibration supports add and remove terminals', () => {
  assert.match(html, /function\s+addTerminalToDeviceType\s*\(/);
  assert.match(html, /function\s+removeTerminalFromDeviceType\s*\(/);
  assert.match(html, /function\s+uiAddTerminal\s*\(/);
  assert.match(html, /function\s+uiDeleteActiveTerminal\s*\(/);
  assert.match(html, /function\s+normalizeCalibEntry\s*\(/);
  assert.match(html, /id="m-calib-add"/);
  assert.match(html, /id="m-calib-del"/);
});

test('calibration and workshop save/load helpers exist', () => {
  assert.match(html, /function\s+saveTerminalCalibration\s*\(/);
  assert.match(html, /function\s+saveWorkshop\s*\(/);
  assert.match(html, /function\s+importTerminalCalibrationFromFile\s*\(/);
  assert.match(html, /function\s+applyTerminalCalibrationObject\s*\(/);
  assert.match(html, /id="m-calib-save"/);
  assert.match(html, /id="m-calib-load"/);
});
