const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('Electron keeps the renderer isolated and exposes only bounded report/XG-SIM bridges', () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /preload:\s*path\.join\(__dirname,\s*'preload\.js'\)/);
  assert.match(main, /event\.sender\s*!==\s*mainWindow\.webContents/);
  assert.match(main, /sandbox:\s*true,\s*javascript:\s*false/);
  assert.match(main, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*'deny'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('WorkshopDesktop'/);
  assert.match(preload, /ipcRenderer\.invoke\(SAVE_REVIEW_PDF_CHANNEL/);
  assert.match(preload, /writeInputImage\(payload\).*XGSIM_CHANNELS\.writeInputImage/);
  assert.doesNotMatch(preload, /writeOutput|spawn|exec|filesystem|readFile|writeFile/i);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^]*\brequire\b/);
});

test('XG-SIM sidecar is x86, local-stdio-only, input-write-only and fail-safe', () => {
  const hostProject = fs.readFileSync(path.join(__dirname, '..', 'native', 'xgsim-host', 'XgSimHost.csproj'), 'utf8');
  const host = fs.readFileSync(path.join(__dirname, '..', 'native', 'xgsim-host', 'Program.cs'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'xgsim-session-service.js'), 'utf8');
  assert.match(hostProject, /<PlatformTarget>x86<\/PlatformTarget>/);
  assert.match(service, /stdio:\s*\['pipe',\s*'pipe',\s*'pipe'\]/);
  assert.match(service, /windowsHide:\s*true/);
  assert.doesNotMatch(service, /listen\(|createServer|WebSocket|http:/);
  assert.match(host, /Only documented IN channels may be writable/);
  const writeInputBody = /private static object WriteInputImage[\s\S]*?private static bool ReadBool/.exec(host)?.[0] ?? '';
  assert.match(writeInputBody, /_allowedInputs\.Contains/);
  assert.doesNotMatch(writeInputBody, /_allowedOutputs|OutputPattern/);
  assert.match(host, /WatchdogTimeoutMilliseconds/);
  assert.match(host, /foreach \(var address in _allowedInputs\)[\s\S]*WriteIOChannel\(address, BoolChannelType, false\)/);
});

test('only interim-safe legacy missions are published', () => {
  const { PUBLIC_MISSION_IDS, isPublishedMission } = require('../public/safety-policy.js');
  assert.deepEqual([...PUBLIC_MISSION_IDS], ['g2', 'g3', 'g4', 'g5', 'g6', 'g10', 'g13']);
  assert.equal(isPublishedMission('g2'), true);
  assert.equal(isPublishedMission('g1'), false);
  assert.match(html, /if\s*\(\s*!isPublishedMission\(g\.id\)\s*\)\s*continue/);
});

test('danger and function issues block mission completion', () => {
  const { hasBlockingIssues } = require('../public/safety-policy.js');
  assert.equal(hasBlockingIssues([]), false);
  assert.equal(hasBlockingIssues([{ category: 'quality' }]), false);
  assert.equal(hasBlockingIssues([{ category: 'danger' }]), true);
  assert.equal(hasBlockingIssues([{ category: 'function' }]), true);
  assert.match(html, /allDone\s*&&\s*!hasBlockingIssues\(\)/);
});

test('legacy state snapshots restore unsafe transactional mutations', () => {
  const { captureLegacyState, restoreLegacyState } = require('../public/safety-policy.js');
  const state = {
    devices: { d1: { type: 'MCCB' } },
    wires: [{ id: 'w1' }],
    nextId: 2,
    history: [{ marker: 'before' }],
    future: [{ marker: 'redo' }],
  };
  const snapshot = captureLegacyState(state);
  state.devices.d2 = { type: 'MDR-100' };
  state.wires.push({ id: 'w2' });
  state.nextId = 9;
  state.history.push({ marker: 'unsafe' });
  state.future.length = 0;

  restoreLegacyState(state, snapshot);

  assert.deepEqual(state, {
    devices: { d1: { type: 'MCCB' } },
    wires: [{ id: 'w1' }],
    nextId: 2,
    history: [{ marker: 'before' }],
    future: [{ marker: 'redo' }],
  });
  assert.match(html, /if\s*\(\s*!isPublishedMission\(goalId\)\s*\)/);
  assert.match(html, /restoreLegacyState\(S,\s*transactionSnapshot\)/);
});

test('unsafe MCCB phase to neutral mission wiring remains detectable', () => {
  const mccbT2 = { domain: 'ac', potential: 'L2' };
  const mdrN = { domain: 'ac', potential: 'N' };
  assert.notEqual(mccbT2.potential, mdrN.potential);
  assert.match(html, /AC-L과 AC-N이 같은 net \(전원 단락!\)/);
});

test('ordinary renderer updates topology but never run electrical validation implicitly', () => {
  const renderBody = /function render\(\)\{([\s\S]*?)\n\}/.exec(html)?.[1] ?? '';
  assert.match(renderBody, /refreshLiveTopology\(\)/);
  assert.doesNotMatch(renderBody, /\bvalidate\(\)/);
  assert.match(html, /legacyValidatedRevision\s*=\s*S\.revision/);
  assert.match(html, /\$\('#b-validate'\)\.onclick\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\bvalidate\(\)/);
});

test('a placed conductor exposes the terminals still needed to complete its circuit', () => {
  assert.match(html, /function computeOpenCircuitHints\(\)/);
  assert.match(html, /function terminalCompletionConnectionCount\(ref\)/);
  assert.match(html, /동일전위 대체 단자 중 하나/);
  assert.match(html, /circuit-open-mate/);
  assert.match(html, /주황 점선 단자 .*공급·귀로·COM\/접점 경로를 완성하세요/);
  assert.match(html, /미완성 동반단자/);
});

test('prewire connection preview fails closed for known polarity and ambiguous COM G V roles', () => {
  assert.match(html, /function strictPrewireConnectionMode\(\)/);
  assert.match(html, /level:strict\?'blocked':'warn',code:semantic\.code/);
  assert.match(html, /TERMINAL_PROFILE_UNRESOLVED/);
  assert.match(html, /AMBIGUOUS_TERMINAL_ROLE/);
  assert.match(html, /COM\/G\/V 계열 명칭만으로 전위를 추정할 수 없습니다/);
  assert.match(html, /진단용 강제결선/);
  assert.match(html, /V\+=DC전원 · V1=아날로그입력 · VR=12V 기준공급 · V\/T2=모터상/);
});

test('field workflow never treats a three-pole MCCB phase as neutral or parallels XBC internal 24V', () => {
  const workflow = /function evaluateFieldWorkOrder\(nets\)\{([\s\S]*?)\n\}/.exec(html)?.[1] ?? '';
  assert.match(workflow, /MCCB1P',"L'"/);
  assert.match(workflow, /MCCB1P',"N'"/);
  assert.doesNotMatch(workflow, /MCCB','T2','MDR-100','N/);
  assert.doesNotMatch(workflow, /MDR-100','V\+1','XBC-DR32H','24V/);
  assert.match(workflow, /XBC 내장 24V\/24G와 병렬 연결 금지/);
});

test('legacy educational equipment remains visible in practice mode', () => {
  assert.match(html, /const PRACTICE_ONLY_LEGACY_TYPES=\[/);
  assert.match(html, /LIB\[type\]\.practiceOnly=true/);
  assert.match(html, /LIB\[type\]\.hidden=false/);
});

test('palette click placement uses the current visible SVG view instead of an off-screen fixed origin', () => {
  assert.match(html, /function visibleDeviceOrigin\(type\)/);
  assert.match(html, /const fallback=visibleDeviceOrigin\(type\)/);
  assert.doesNotMatch(html, /if\(!placed && \(ensureDeviceMount\(type,def\)\.tags\|\|\[\]\)\.includes\('free'\)\)\{\s*const id=addDevice\(type,200,200\)/);
  assert.match(html, /function zoomFit\(\)[\s\S]*?S\.pan\.k=Math\.max\(0\.2,k\)/);
  assert.match(html, /function zoomFitPanel\(\)[\s\S]*?S\.pan\.k=Math\.max\(0\.2,k\)/);
});
