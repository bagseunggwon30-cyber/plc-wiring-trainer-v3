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

test('manual device expansion pack registers XGB digital and analog modules', () => {
  for (const type of [
    'XBE-DC32A', 'XBE-RY16A', 'XBE-TN16A', 'XBE-TP16A', 'XBE-DR16A',
    'XBF-AD04A', 'XBF-DV04A', 'XBF-DC04A', 'XBF-RD04A', 'XBF-TC04S', 'XBF-AD08A',
    'PT100-3W', 'TC-K'
  ]) {
    assert.match(html, new RegExp(`LIB\\['${type}'\\]\\s*=`), `${type} definition missing`);
  }
  assert.match(html, /const GPTX='assets\/devices\/gpt-expansion\/'/);
  assert.match(html, /xgb-main-expansion-gpt\.png/);
  assert.match(html, /xgb-relay-io-gpt\.png/);
  assert.match(html, /xgb-analog-io-gpt\.png/);
  assert.match(html, /xbf-tc04s-gpt\.png/);
  assert.match(html, /xbf-ad08a-gpt\.png/);
  assert.match(html, /pt100-3wire-gpt\.png/);
  assert.match(html, /thermocouple-k-gpt\.png/);
});

test('new XGB modules carry manual-derived common, power, and channel metadata', () => {
  assert.match(html, /XBE-DC32A[\s\S]*digitalInputModule:true/);
  assert.match(html, /XBE-RY16A[\s\S]*8점\/COM × 2/);
  assert.match(html, /XBE-TN16A[\s\S]*mode:'sink'/);
  assert.match(html, /XBE-TP16A[\s\S]*mode:'source'/);
  assert.match(html, /XBF-AD04A[\s\S]*ranges:\['0-10V','0-20mA','4-20mA'\]/);
  assert.match(html, /XBF-DV04A[\s\S]*range:'0-10V'/);
  assert.match(html, /XBF-DC04A[\s\S]*ranges:\['0-20mA','4-20mA'\]/);
  assert.match(html, /XBF-RD04A[\s\S]*A\/B\/b/);
  assert.match(html, /rdIds\.push\('\+24V','0V','PE'\)/);
  assert.match(html, /XBF-TC04S[\s\S]*thermocoupleTypes:\['K','J','T','R'\]/);
  assert.match(html, /XBF-AD08A[\s\S]*pairChannels\(8,'input'\)/);
});

test('single phase missions use a 2-pole L/N breaker instead of two phases of a 3-pole breaker', () => {
  assert.match(html, /needed:\['MCCB1P','MDR-100','TB10'\]/);
  assert.match(html, /type:'MCCB1P',term:"L'"/);
  assert.match(html, /type:'MCCB1P',term:"N'"/);
  const g1 = html.match(/id:'g1'[\s\S]*?id:'g2'/)?.[0] || '';
  assert.doesNotMatch(g1, /type:'MCCB',term:'T2'/);
  const g12 = html.match(/id:'g12'[\s\S]*?id:'g13'/)?.[0] || '';
  assert.doesNotMatch(g12, /type:'MCCB',term:'T2'/);
});

test('RS485 polarity is explicit and partial pairs are validated', () => {
  assert.match(html, /'RS485\+':\{color:'#93f'/);
  assert.match(html, /'RS485-':\{color:'#93f'/);
  assert.match(html, /setPol\('XBC-DR32H','485\+','RS485\+'\)/);
  assert.match(html, /setPol\('EXP2-700','T-','RS485-'\)/);
  assert.match(html, /function\s+validateDeviceFunctionalRules\s*\(/);
  assert.match(html, /RS-485 \$\{plus\}\/\$\{minus\} 중 한 가닥만 연결/);
});

test('SMPS simulation requires valid AC input before DC outputs become sources', () => {
  assert.match(html, /function\s+markSimulationSources\s*\(/);
  assert.match(html, /const powered=!!\(ln&&nn&&ln!==nn&&ln\._acL&&nn\._acN\)/);
  assert.match(html, /powerSupply:\{acL:'L',acN:'N',dcPos:\['V\+1','V\+2'\],dcNeg:\['V-1','V-2'\]\}/);
  assert.doesNotMatch(html, /def\.cat==='power' && \(m\.term==='V\+1'/);
});

test('simulation supports breaker/fuse switching and PLC output forcing', () => {
  assert.match(html, /openSwitches:\s*new Set\(\)/);
  assert.match(html, /forcedOutputs:\s*new Set\(\)/);
  assert.match(html, /simSwitchPairs:\[\['L',"L'"\],\['N',"N'"\]\]/);
  assert.match(html, /function\s+outputGroupForTerminal\s*\(/);
  assert.match(html, /출력 강제 \$\{SIM\.forcedOutputs\.has\(key\)\?'ON':'OFF'\}/);
});

test('legacy MY-MD02 projects migrate to the canonical XY-MD02 device', () => {
  assert.match(html, /'MY-MD02':'XY-MD02'/);
  assert.match(html, /function\s+migrateDeviceTypes\s*\(/);
  assert.match(html, /LIB\['XY-MD02'\]\s*=\s*\{/);
  assert.match(html, /mdLegacy\.hidden=true/);
  assert.match(html, /needed:\['MDR-100','XBC-DR32H','XY-MD02'\]/);
});

test('device validation checks power pairs, I/O commons, analog pairs, and RTD three-wire channels', () => {
  assert.match(html, /외부 DC 전원 \$\{pair\.pos\}\/\$\{pair\.neg\} 연결이 완성되지 않았습니다/);
  assert.match(html, /입력 \$\{used\.slice\(0,4\)\.join\(', '\)\} 사용 중이지만 입력 COM/);
  assert.match(html, /해당 출력 COM이 연결되지 않았습니다/);
  assert.match(html, /채널 배선이 한쪽만 연결되었습니다/);
  assert.match(html, /PT100 3선식 A\/B\/b/);
});
