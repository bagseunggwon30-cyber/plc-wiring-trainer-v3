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

test('XBC input overlay exposes only the 24 manual terminals and marks the fabricated spare screw unused', () => {
  assert.match(html, /id:'P0F',x:468\.9,y:86[^\n]*hit:\{x:468\.9,y:86,r:14\}/);
  assert.match(html, /id:'24V',x:584\.5,y:86/);
  assert.match(html, /id:'24G',x:584\.5,y:140/);
  assert.match(html, /id:'PE',x:182\.5,y:466[^\n]*hit:\{x:182\.5,y:466,r:14\}/);
  assert.match(html, /disabledTerminalSpots:\[\s*\{x:506\.4,y:86,label:'미사용'/);
  assert.match(html, /\{x:545\.9,y:86,label:'미사용'/);
  assert.match(html, /\{x:193,y:141,label:'미사용'/);
  assert.match(html, /imageLabelCorrections:\[\s*\{x:121,y:164,label:'485\+'/);
  assert.doesNotMatch(html, /id:'24G-TOP'/);
  assert.doesNotMatch(html, /id:'PE2'/);
  assert.match(html, /const REVIEW_PROFILE_TERMINAL_TYPES=new Set\(\['XBC-DR32H','EXP2-700','XBF-AH04A','MDR-100','MC-22B-DC24','MY2N','EOCR3DE-05DUH','UT-2\.5','UT-2\.5-PE','UT-4-HESI'\]\)/);
  assert.match(html, /fuseLinkOrderCode/);
  assert.match(html, /LIB\[type\]\.assetId&&LIB\[type\]\.geometryHash/);
  assert.match(html, /function geometryOnlyCalibrationEntry\(type,entry\)/);
});

test('image rendering preserves an explicit device aspect ratio without replacing its asset', () => {
  assert.match(html, /imagePreserveAspectRatio:'xMidYMid meet'/);
  assert.match(html, /def\.imagePreserveAspectRatio\|\|'none'/);
  assert.match(html, /image:CODEX\+'md02-imagen-v2\.png'/);
  assert.match(html, /terminals:row\(\['B-','A\+','V-','V\+'\], 299, 82\.7, 137\.9/);
});

test('typed terminal semantics drive COM, NC, and analog return wiring guidance', () => {
  assert.match(html, /applyTerminalSemantics\(/);
  assert.match(html, /terminalCompatibilityAssessor/);
  assert.match(html, /polarity==='configurable'/);
  assert.match(html, /\{id:'I0-',[\s\S]*?pol:'AI'/);
  assert.match(html, /\{id:'O0-',[\s\S]*?pol:'AO'/);
});

test('visible practice power, loads, solenoid and terminal blocks receive typed profile identities', () => {
  assert.match(html, /'PSU24':'educational:dc24-source-box'/);
  assert.match(html, /'LAMP-G':'educational:dc24-load'/);
  assert.match(html, /'BUZZER':'educational:dc24-load'/);
  assert.match(html, /'SOL-Y':'educational:dc24-solenoid'/);
  assert.match(html, /'TB4':'educational:terminal-block-4'/);
  assert.match(html, /'TB10':'educational:terminal-block-10'/);
  assert.match(html, /Object\.assign\(LIB\['PSU24'\],[\s\S]*?\{id:'L',[^\n]*pol:'AC-L'/);
  assert.match(html, /Object\.assign\(LIB\['PSU24'\],[\s\S]*?\{id:'N',[^\n]*pol:'AC-N'/);
});

test('exact manual-backed additions use separate Imagen assets and preserve legacy device skins', () => {
  assert.match(html, /'MC-22B-DC24':\{[\s\S]*?orderCode:'MC-22b \/ DC24 \/ 1a1b'/);
  assert.match(html, /image:CODEX_EXACT\+'mc-22b-dc24-imagen-v2\.png'/);
  assert.match(html, /'EOCR3DE-05DUH':\{[\s\S]*?orderCode:'EOCR3DE-05DUH'/);
  assert.match(html, /\{id:'A1',x:56,y:246[^\n]*pol:'AC-L'/);
  assert.match(html, /\{id:'A2',x:84,y:246[^\n]*pol:'AC-N'/);
  assert.match(html, /'UT-2\.5':\{[\s\S]*?orderCode:'3044076'/);
  assert.match(html, /'UT-2\.5-PE':\{[\s\S]*?orderCode:'3044092'/);
  assert.match(html, /'UT-4-HESI':\{[\s\S]*?orderCode:'3046032'/);
  assert.match(html, /image:IMG\+'trimmed\/mc-22b-trim\.png'/);
  assert.match(html, /image:IMG\+'trimmed\/eocr-trim\.png'/);
});

test('MY2N-D2 keeps its existing skin but uses the official diode polarity and a/b contact state', () => {
  assert.match(html, /'MY2N':\{[\s\S]*?orderCode:'MY2N-D2 DC24V'/);
  assert.match(html, /\{id:'13'[^\n]*label:'13 \(- \/ 0V\)'[^\n]*pol:'DC-'/);
  assert.match(html, /\{id:'14'[^\n]*label:'14 \(\+24V\)'[^\n]*pol:'DC\+'/);
  assert.match(html, /\{from:'9',to:'1',normally:'closed',stateKey:'pole-1'\}/);
  assert.match(html, /\{from:'9',to:'5',normally:'open',stateKey:'pole-1'\}/);
  assert.match(html, /coil:\['14','13'\]/);
  assert.match(html, /image:FLAT\+'my2n-flat\.png'/);
  assert.match(html, /assetId:'existing:my2n-flat-v1'/);
  assert.doesNotMatch(html, /코일:\s*13\(\+\),\s*14\(-\)/);
});

test('terminal strips show one marker on both connection sides without breaking legacy endpoint ids', () => {
  assert.match(html, /id:`\$\{n\}'`,x,y:yBottom,side:'B',label:`\$\{labelPrefix\}\$\{n\}`,connectionSide:'B'/);
  assert.match(html, /id:"1'",x:77\.7,y:68\.6,side:'B',label:'1',connectionSide:'B'/);
  assert.match(html, /id:\(i\+1\)\+"'",x,y:69\.3,side:'B',label:''\+\(i\+1\),connectionSide:'B'/);
  assert.match(html, /terminalMarker=effectiveTerminal\.marker\|\|t\.marker\|\|t\.label/);
  assert.match(html, /접속점: \$\{connectionPoint\}측/);
});

test('manual-backed Phoenix blocks use two physical connection points and prohibit fuse bypass jumpers', () => {
  assert.match(html, /'UT-2\.5':\{[\s\S]*?id:'1',x:70,y:28,side:'L'[\s\S]*?id:'2',x:110,y:28,side:'R',label:'1'/);
  assert.match(html, /'UT-2\.5-PE':\{[\s\S]*?label:'PE 1',connectionSide:'A'[\s\S]*?label:'PE 1',connectionSide:'B'/);
  assert.match(html, /def\?\.terminalAssemblyType==='fused'/);
  assert.match(html, /점퍼 금지: 퓨즈 단자의 두 접속점을 우회하면 보호 기능이 사라집니다/);
  assert.match(html, /A\/B 사이 5×20 퓨즈 직렬 · 직접 공통 아님/);
  assert.match(html, /DIN 레일 PE 보호결합/);
  assert.match(html, /if\(def\?\.terminalAssemblyType\)return 14/);
});

test('palette distinguishes exact official manuals from family and unresolved educational devices', () => {
  assert.match(html, /const EXACT_MANUAL_DEVICE_TYPES=new Set\(\[/);
  assert.match(html, /'XBC-DR32H','EXP2-700','XBF-AH04A','MDR-100','MC-22B-DC24'/);
  assert.match(html, /const FAMILY_MANUAL_DEVICE_TYPES=new Set\(\['IG5A','SERVO-DRV','MC','EOCR'\]\)/);
  assert.match(html, /type==='MY-MD02'.*공식 제조사·매뉴얼 미확인/);
  assert.match(html, /d\.dataset\.manualStatus=manualStatus\.kind/);
});
