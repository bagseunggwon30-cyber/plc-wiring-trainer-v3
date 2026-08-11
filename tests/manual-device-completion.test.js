const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1] || '';

function loadLib() {
  const start = script.indexOf('const POL =');
  const end = script.indexOf('const TERMINAL_DATA_DEVICE_TYPES=');
  const context = { console, structuredClone: global.structuredClone, window: {} };
  vm.createContext(context);
  vm.runInContext(`${script.slice(start, end)}\nglobalThis.__LIB=LIB;`, context, { timeout: 10_000 });
  return context.__LIB;
}

const LIB = loadLib();

test('manual-completed XBF modules use physical terminal IDs and exact functional terminal counts', () => {
  const expected = {
    'XBF-AD04A': 10,
    'XBF-DV04A': 10,
    'XBF-DC04A': 10,
    'XBF-RD04A': 15,
    'XBF-TC04S': 11,
    'XBF-AD08A': 18,
  };
  for (const [type, count] of Object.entries(expected)) {
    assert.ok(LIB[type], `${type} missing`);
    assert.equal(LIB[type].terminals.length, count, `${type} terminal count`);
    assert.ok(LIB[type].terminals.some(t => t.id === '+24V'));
    assert.ok(LIB[type].terminals.some(t => t.id === '0V'));
    assert.equal(LIB[type].manualVerified, true);
  }
  assert.equal(LIB['XBF-RD04A'].terminals.some(t => t.id === 'PE'), true, 'RD04A manual terminal list includes the PE/shield point');
});

test('PT100 and K thermocouple field sensors are implemented for the temperature missions', () => {
  assert.deepEqual(Array.from(LIB['PT100-3W'].terminals, t => t.id), ['A', 'B', 'b']);
  assert.deepEqual(Array.from(LIB['TC-K'].terminals, t => t.id), ['+', '-', 'SH']);
  assert.equal(LIB['PT100-3W'].sensorKind, 'RTD');
  assert.equal(LIB['TC-K'].sensorKind, 'THERMOCOUPLE');
});

test('all newly referenced GPT-derived images exist and are non-empty', () => {
  const types = [
    'MCCB1P','XBE-DC32A','XBE-RY16A','XBE-TN16A','XBE-TP16A','XBE-DR16A',
    'XBF-AD04A','XBF-DV04A','XBF-DC04A','XBF-RD04A','XBF-TC04S','XBF-AD08A','PT100-3W','TC-K'
  ];
  for (const type of types) {
    const rel = LIB[type].image;
    const file = path.join(root, rel);
    assert.ok(fs.existsSync(file), `${type} image missing: ${rel}`);
    assert.ok(fs.statSync(file).size > 1000, `${type} image is unexpectedly small`);
  }
});

test('new missions cover analog loop, RTD, thermocouple, and the real HMI/MD02 panel wiring', () => {
  for (const id of ['g15','g16','g17','g18','g19']) assert.match(html, new RegExp(`id:'${id}'`));
  assert.match(html, /DV04A CH0\+ → AD04A CH0\+/);
  assert.match(html, /PT100 A → CH0 A/);
  assert.match(html, /K열전대 \+ → CH0\+/);
  assert.match(html, /MDR \+V2 → XY-MD02 V\+/);
  assert.match(html, /HMI 485\+ → PLC 485\+/);
  assert.match(html, /PB NO 출력 → 입력 00/);
});

test('project migration and mission completion block unsafe functional states', () => {
  assert.match(html, /const PROJECT_SCHEMA_VERSION=9/);
  assert.match(html, /function\s+canonicalTerminalId\s*\(/);
  assert.match(html, /terminalAliases:\{P24:'\+24V',P0V:'0V'\}/);
  assert.match(html, /lastIssues\.filter\(i=>i\.category==='danger'\|\|i\.category==='function'\)/);
  assert.match(html, /단계 연결 완료 · 안전\/기능 오류/);
});

test('the application is self-contained and no longer depends on the RBush CDN', () => {
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/rbush/);
  assert.match(html, /내장 spatial-index fallback/);
});
