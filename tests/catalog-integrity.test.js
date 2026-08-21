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

function extractArray(name) {
  const start = script.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `${name} not found`);
  const begin = script.indexOf('[', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = begin; i < script.length; i += 1) {
    const ch = script[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']' && --depth === 0) return script.slice(begin, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const LIB = loadLib();
const goalContext = {};
vm.createContext(goalContext);
vm.runInContext(`globalThis.__GOALS=${extractArray('GOALS')}`, goalContext);
const GOALS = goalContext.__GOALS;

test('all catalog terminals have unique IDs and coordinates inside their device bounds', () => {
  for (const [type, def] of Object.entries(LIB)) {
    const seen = new Set();
    for (const terminal of def.terminals || []) {
      assert.equal(seen.has(terminal.id), false, `${type}: duplicate terminal ${terminal.id}`);
      seen.add(terminal.id);
      assert.equal(Number.isFinite(terminal.x) && Number.isFinite(terminal.y), true, `${type}.${terminal.id}: invalid coordinate`);
      assert.ok(terminal.x >= -1 && terminal.x <= def.w + 1, `${type}.${terminal.id}: x outside device`);
      assert.ok(terminal.y >= -1 && terminal.y <= def.h + 1, `${type}.${terminal.id}: y outside device`);
    }
  }
});

test('every mission device and terminal endpoint exists in the catalog', () => {
  for (const goal of GOALS) {
    for (const item of goal.needed || []) {
      const type = typeof item === 'string' ? item : item?.type;
      assert.ok(type && LIB[type], `${goal.id}: missing device ${type || String(item)}`);
    }
    for (const check of goal.checks || []) {
      for (const side of ['from', 'to']) {
        const endpoint = check[side];
        assert.ok(LIB[endpoint.type], `${goal.id}: missing endpoint device ${endpoint.type}`);
        assert.ok(LIB[endpoint.type].terminals.some(t => t.id === endpoint.term), `${goal.id}: missing terminal ${endpoint.type}.${endpoint.term}`);
      }
    }
  }
});

test('every visible image-backed catalog item resolves to a packaged file', () => {
  for (const [type, def] of Object.entries(LIB)) {
    if (def.hidden || !def.image) continue;
    const file = path.join(root, def.image);
    assert.ok(fs.existsSync(file), `${type}: image not packaged: ${def.image}`);
    assert.ok(fs.statSync(file).size > 0, `${type}: empty image: ${def.image}`);
  }
});

test('registers both user-PPT Metamec relays as practice-only terminal devices', () => {
  const relay8 = LIB['RELAY-8P'];
  const relay14 = LIB['RELAY-14P'];

  assert.ok(relay8);
  assert.ok(relay14);
  assert.equal(relay8.label, 'Metamec 8핀 릴레이');
  assert.equal(relay14.label, 'Metamec 14핀 릴레이');
  assert.equal(relay8.image, 'assets/devices/manual/metamec-relay-8p-ppt.png');
  assert.equal(relay14.image, 'assets/devices/manual/metamec-relay-14p-ppt.png');
  assert.equal(relay8.practiceOnly, true);
  assert.equal(relay14.practiceOnly, true);
  assert.deepEqual(Array.from(relay8.terminals, terminal => terminal.id),
    ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']);
  assert.deepEqual(Array.from(relay14.terminals, terminal => terminal.id),
    ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14']);
  assert.equal(relay8.terminals.every(terminal => terminal.pol === 'NEUTRAL'), true);
  assert.equal(relay14.terminals.every(terminal => terminal.pol === 'NEUTRAL'), true);
});

test('renders pilot lamps as flat front devices with top screw terminals', () => {
  const images = {
    'LAMP-G': 'assets/devices/codex/bom/lamp-green-flat-screw-v1.png',
    'LAMP-Y': 'assets/devices/codex/bom/lamp-yellow-flat-screw-v1.png',
    'LAMP-W': 'assets/devices/codex/bom/lamp-white-flat-screw-v1.png',
    LAMP: 'assets/devices/codex/bom/lamp-yellow-flat-screw-v1.png',
  };

  for (const [type, image] of Object.entries(images)) {
    const lamp = LIB[type];
    assert.equal(lamp.image, image);
    assert.equal(lamp.w, 180);
    assert.equal(lamp.h, 180);
    assert.equal(lamp.imageHasLabels, true);
    assert.deepEqual(Array.from(lamp.terminals, terminal => terminal.id), ['+', '-']);
    assert.equal(lamp.terminals.every(terminal => terminal.side === 'T'), true);
    assert.equal(lamp.terminals.every(terminal => terminal.y === 33), true);
    assert.equal(lamp.terminals.every(terminal => terminal.anchor?.y === 0), true);
  }
});

test('provides click-insert, drag, delete-point, and route-lock controls for wires', () => {
  assert.match(script, /function beginWireWaypointInsert\(wireId,point,path=null\)/);
  assert.match(script, /wire\.waypoints\.splice\(waypointIndex,0,snapped\)/);
  assert.match(script, /function removeWireWaypoint\(wireId,waypointIndex\)/);
  assert.match(script, /function setWireRouteLocked\(wireId,locked\)/);
  assert.match(script, /function setWireManualColor\(wireId,color\)/);
  assert.match(script, /className='wire-color-palette'/);
  assert.match(script, /chip\.setAttribute\('aria-label',`선 색상 \$\{label\}`\)/);
  assert.match(script, /🗑 선 삭제 \(Delete\)/);
  assert.match(script, /if\(waypoints && waypoints\.length\)/);
  assert.match(script, /사용자가 찍거나 이동한 경로점은 자동 이미지 회피보다 우선한다/);
  assert.match(script, /원하는 선 구간을 클릭해 점 추가/);
  assert.doesNotMatch(script, /한 번 더 클릭하면 삭제/);
});
