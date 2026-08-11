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
