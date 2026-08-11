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

function loadMissionRuntime() {
  const start = script.indexOf('function normalizeMissionDeviceSpec');
  const endNeedle = 'applyMissionPowerProfiles();';
  const end = script.indexOf(endNeedle, start) + endNeedle.length;
  assert.ok(start >= 0 && end > start, 'mission runtime segment not found');
  const LIB = loadLib();
  const context = { console, LIB };
  vm.createContext(context);
  vm.runInContext(`${script.slice(start, end)}\n` +
    `globalThis.__GOALS=GOALS; globalThis.__api={normalizeMissionDeviceSpec,missionSpecKey,missionNeededSpecs,findMissionDeviceId,missionCheckKey};`,
    context, { timeout: 10_000 });
  return { LIB, GOALS: context.__GOALS, api: context.__api, context };
}

const { LIB, GOALS, api } = loadMissionRuntime();
const goal = id => GOALS.find(g => g.id === id);

function endpointKey(ep) {
  return `${ep.type}|${ep.role || ''}|${ep.term}`;
}

function hasCheck(g, from, to) {
  const key = [from, to].sort().join('~');
  return g.checks.some(c => [endpointKey(c.from), endpointKey(c.to)].sort().join('~') === key);
}

function connectedByMissionChecks(g, from, to) {
  const parent = new Map();
  const find = key => {
    if (!parent.has(key)) parent.set(key, key);
    const p = parent.get(key);
    if (p === key) return key;
    const root = find(p);
    parent.set(key, root);
    return root;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const check of g.checks) union(endpointKey(check.from), endpointKey(check.to));
  for (const spec of api.missionNeededSpecs(g)) {
    const role = spec.role || '';
    const def = LIB[spec.type];
    for (const [a, b] of [...(def.netHints || []), ...(def.simSwitchPairs || [])]) {
      union(`${spec.type}|${role}|${a}`, `${spec.type}|${role}|${b}`);
    }
  }
  return find(from) === find(to);
}

test('role-based missions instantiate independent same-type devices', () => {
  const expected = {
    g4: ['PB-1C|forwardPB', 'PB-1C|reversePB'],
    g7: ['PB-1C|startPB', 'PB-1C|stopPB', 'MC|mainMC'],
    g9: ['MC|forwardMC', 'MC|reverseMC', 'PB-1C|forwardPB', 'PB-1C|reversePB', 'PB-1C|stopPB'],
    g20: ['PB-1C|startPB', 'PB-1C|stopPB', 'MC|mainMC'],
  };
  for (const [id, required] of Object.entries(expected)) {
    const keys = new Set(api.missionNeededSpecs(goal(id)).map(api.missionSpecKey));
    for (const key of required) assert.ok(keys.has(key), `${id}: missing role ${key}`);
  }

  const devices = {
    d1: { type: 'MC', role: 'forwardMC' },
    d2: { type: 'MC', role: 'reverseMC' },
    d3: { type: 'MC' },
  };
  assert.equal(api.findMissionDeviceId({ type: 'MC', role: 'forwardMC' }, devices), 'd1');
  assert.equal(api.findMissionDeviceId({ type: 'MC', role: 'reverseMC' }, devices), 'd2');
  assert.equal(api.findMissionDeviceId({ type: 'MC', role: 'missing' }, devices), null);
});

test('all expanded mission endpoints and profile-added device types exist', () => {
  for (const g of GOALS) {
    for (const spec of api.missionNeededSpecs(g)) assert.ok(LIB[spec.type], `${g.id}: ${spec.type}`);
    for (const check of g.checks) {
      for (const ep of [check.from, check.to]) {
        assert.ok(LIB[ep.type], `${g.id}: device ${ep.type}`);
        assert.ok(LIB[ep.type].terminals.some(t => t.id === ep.term), `${g.id}: terminal ${endpointKey(ep)}`);
      }
    }
  }
});

test('every mission that consumes MDR DC has a valid MCB-to-MDR AC source path', () => {
  for (const g of GOALS) {
    const consumesMdr = g.checks.some(c => [c.from, c.to].some(ep =>
      ep.type === 'MDR-100' && /^(V\+|V-)/.test(ep.term)));
    if (!consumesMdr) continue;
    assert.equal(connectedByMissionChecks(g, "MCCB1P||L'", 'MDR-100||L'), true, `${g.id}: MDR L source missing`);
    assert.equal(connectedByMissionChecks(g, "MCCB1P||N'", 'MDR-100||N'), true, `${g.id}: MDR N source missing`);
  }
});

test('every mission using XBC terminals also powers the XBC main L/N input', () => {
  for (const g of GOALS) {
    const usesXbc = g.checks.some(c => [c.from, c.to].some(ep => ep.type === 'XBC-DR32H'));
    if (!usesXbc) continue;
    assert.equal(hasCheck(g, "MCCB1P||L'", 'XBC-DR32H||L'), true, `${g.id}: XBC L source missing`);
    assert.equal(hasCheck(g, "MCCB1P||N'", 'XBC-DR32H||N'), true, `${g.id}: XBC N source missing`);
  }
});

test('g-field and g13 enforce terminal-block routing while basic direct missions do not', () => {
  assert.equal(goal('g-field').wiringPolicy, 'terminal-block-required');
  assert.equal(goal('g13').wiringPolicy, 'terminal-block-required');
  assert.equal(goal('g2').wiringPolicy, undefined);
  assert.ok(goal('g-field').checks.some(c => c.from.type === 'PB-1C' && c.to.type === 'TB10'));
  assert.ok(goal('g13').checks.some(c => c.from.type === 'PB-1C' && c.to.type === 'TB10'));
});

test('EOCR mission follows manual terminal behavior and CT pass-through metadata', () => {
  const eocr = LIB.EOCR;
  assert.equal(eocr.manualVerified, true);
  assert.match(eocr.manualSource, /EOCR-3DE_FDE/);
  assert.deepEqual(Array.from(eocr.tripContact.normal[0]), ['95', '96']);
  assert.deepEqual(Array.from(eocr.tripContact.trip[0]), ['97', '98']);
  for (const pair of [['R-IN','R-OUT'],['S-IN','S-OUT'],['T-IN','T-OUT']]) {
    assert.ok(eocr.netHints.some(p => p[0] === pair[0] && p[1] === pair[1]));
  }
  assert.equal(goal('g20').checks.some(c => c.from.term === '95' || c.to.term === '95'), true);
});

test('auto-wiring every mission does not create an AC/DC source short in the static topology', () => {
  for (const g of GOALS) {
    const parent = new Map();
    const members = new Map();
    const find = key => {
      if (!parent.has(key)) { parent.set(key, key); members.set(key, []); }
      if (parent.get(key) === key) return key;
      const root = find(parent.get(key)); parent.set(key, root); return root;
    };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const specs = api.missionNeededSpecs(g);
    const terminalKey = (spec, term) => `${spec.type}|${spec.role || ''}|${term}`;
    for (const spec of specs) {
      const def = LIB[spec.type];
      for (const terminal of def.terminals) {
        const key = terminalKey(spec, terminal.id);
        find(key);
        members.get(key).push({ pol: terminal.pol, key });
      }
      const internal = [...(def.netHints || []), ...(def.simSwitchPairs || [])];
      for (const [a, b] of internal) union(terminalKey(spec, a), terminalKey(spec, b));
      if (def.allCommon && def.terminals.length > 1) {
        for (const terminal of def.terminals.slice(1)) {
          union(terminalKey(spec, def.terminals[0].id), terminalKey(spec, terminal.id));
        }
      }
    }
    for (const check of g.checks) union(endpointKey(check.from), endpointKey(check.to));

    const polsByRoot = new Map();
    for (const spec of specs) {
      for (const terminal of LIB[spec.type].terminals) {
        const root = find(terminalKey(spec, terminal.id));
        if (!polsByRoot.has(root)) polsByRoot.set(root, new Set());
        if (terminal.pol) polsByRoot.get(root).add(terminal.pol);
      }
    }
    for (const pols of polsByRoot.values()) {
      assert.equal(pols.has('AC-L') && pols.has('AC-N'), false, `${g.id}: AC L/N short`);
      assert.equal(pols.has('DC+') && pols.has('DC-'), false, `${g.id}: DC +/- short`);
      assert.equal(pols.has('AC-L') && pols.has('DC-'), false, `${g.id}: AC/DC mixed short`);
    }
  }
});
