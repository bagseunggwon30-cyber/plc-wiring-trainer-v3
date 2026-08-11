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
  const context = { console, structuredClone: global.structuredClone };
  context.window = context;
  vm.createContext(context);
  for (const file of [
    'src/device-packs/device-pack-registry.js',
    'src/device-packs/ls-xgb-expansion-pack.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file, timeout: 10_000 });
  }
  vm.runInContext(
    `${script.slice(start, end)}\nwindow.PLCDevicePacks.installAll(LIB,{force:true,replaceExisting:false});\nglobalThis.__LIB=LIB;`,
    context,
    { timeout: 10_000 },
  );
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

test('v3 public missions retain power, analog, RS485, and door-terminal exercises', () => {
  const missions = fs.readFileSync(path.join(root, 'src', 'domain', 'missions.ts'), 'utf8');
  for (const title of [
    'MDR AC 입력과 DC24V 배전',
    'XBF-AH04A',
    'RS485',
    '도어 기기와 내부 단자대'
  ]) assert.match(missions, new RegExp(title));
});

test('v3 document bridge preserves revision, workflow state, and fail-closed validation ownership', () => {
  assert.match(html, /revision:S\.revision/);
  assert.match(html, /workflowState:S\.workflowState/);
  assert.match(html, /window\.LegacyTrainerBridge=/);
  assert.match(html, /workshop-document-revision/);
  assert.match(html, /실제 검증은 사용자가 검증·시뮬·측정·리포트를/);
});

test('the application is self-contained and no longer depends on the RBush CDN', () => {
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/rbush/);
  assert.match(html, /<script src="\/vendor\/rbush\.min\.js"><\/script>/);
});
