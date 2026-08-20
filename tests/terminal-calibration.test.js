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

test('XBC input overlay follows the measured two-row PPT screw centres', () => {
  assert.match(html, /terminalMarkerStyle:'screw-center-ring',terminalMarkerRadius:5\.2/);
  assert.match(html, /id:'P0F',x:612\.2,y:72\.8/);
  assert.match(html, /id:'24G',x:654\.7,y:72\.8/);
  assert.match(html, /id:'24V',x:666\.7,y:109\.9/);
  assert.match(html, /id:'PE',x:196\.4,y:490\.7/);
  assert.match(html, /id:'P',x:238\.3,y:490\.7[^\n]*label:'P \(DC12\/24V\)'/);
  assert.doesNotMatch(html, /id:'24G-TOP'/);
  assert.doesNotMatch(html, /id:'PE2'/);
  assert.match(html, /const REVIEW_PROFILE_TERMINAL_TYPES=new Set\(\['XBC-DN32UP','XBC-DN60SU','XBC-DP32UP','XBC-DN32H','XBC-DR32H','EXP2-700','XBL-C41A','XBF-AH04A','XBF-PD02A','MDR-100','MC-22B-DC24','MY2N','EOCR3DE-05DUH','UT-2\.5','UT-2\.5-PE','UT-4-HESI'\]\)/);
  assert.match(html, /fuseLinkOrderCode/);
  assert.match(html, /LIB\[type\]\.assetId&&LIB\[type\]\.geometryHash/);
  assert.match(html, /function geometryOnlyCalibrationEntry\(type,entry\)/);
});

test('XBC-DN32UP and DP32UP use one manual-backed UP chassis skin with model-specific output terminals', () => {
  assert.match(html, /const XBC_U_IMAGE=CODEX_EXACT\+'xbc-dn-dp32up-imagen-v1\.png'/);
  assert.match(html, /'XBC-DN32UP':xbcUPlcDefinition\('XBC-DN32UP','sinking-transistor'\)/);
  assert.match(html, /'XBC-DP32UP':\{\.\.\.xbcUPlcDefinition\('XBC-DP32UP','sourcing-transistor'\),hidden:true\}/);
  assert.match(html, /\{id:'N',label:'N',pol:'AC-N'\}.*\{id:'24G',label:'24G',pol:'DC-'\}/s);
  assert.match(html, /\{id:'VOUT',label:'DC12\/24V',pol:'DC\+'\}.*\{id:'COMO',label:'COM',pol:'DC-'\}/s);
  assert.match(html, /\{id:'COMO',label:'COM',pol:'DC\+'\}.*\{id:'0VOUT',label:'0V',pol:'DC-'\}/s);
  assert.match(html, /manualOverlay:true/);
  assert.match(html, /function drawXbcUManualOverlay\(/);
});

test('XBC-DN60SU has its own manual-backed 42+42 terminal chassis and DP32UP is hidden from new work', () => {
  assert.match(html, /'XBC-DN60SU':xbcDn60SuDefinition\(\)/);
  assert.match(html, /'XBC-DP32UP':\{\.\.\.xbcUPlcDefinition\('XBC-DP32UP','sourcing-transistor'\),hidden:true\}/);
  assert.match(html, /const XBC_DN60SU_INPUT_ODD=/);
  assert.match(html, /const XBC_DN60SU_OUTPUT_EVEN=/);
  assert.match(html, /const XBC_DN60SU_ODD_X=Array\.from\(\{length:21\},\(_,index\)=>30\+index\*38\)/);
  assert.match(html, /const XBC_DN60SU_EVEN_X=Array\.from\(\{length:21\},\(_,index\)=>49\+index\*38\)/);
  assert.match(html, /'P42','P','P44'/);
  assert.doesNotMatch(html, /NC-TB11/);
  assert.match(html, /drawRow\(XBC_DN60SU_INPUT_ODD,XBC_DN60SU_ODD_X,48,27\)/);
  assert.match(html, /drawRow\(XBC_DN60SU_INPUT_EVEN,XBC_DN60SU_EVEN_X,88,112\)/);
  assert.match(html, /if\(def\.overlaySkin==='xbc-su-manual'\)drawXbcSuManualOverlay\(g,def,s\)/);
});

test('the BOM launcher has a delegated click path that survives palette rebuilds', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'equipment-order-panel.ts'), 'utf8');
  assert.match(source, /targetDocument\.addEventListener\('click', handleLauncherClick, true\)/);
  assert.match(source, /targetDocument\.removeEventListener\('click', handleLauncherClick, true\)/);
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
