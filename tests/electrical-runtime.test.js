const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1] || '';

function extractFunction(name) {
  const start = script.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  let i = script.indexOf('(', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let endParams = -1;
  for (; i < script.length; i += 1) {
    const ch = script[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')' && --depth === 0) { endParams = i; break; }
  }
  const bodyStart = script.indexOf('{', endParams);
  depth = 0; quote = null; escaped = false;
  for (i = bodyStart; i < script.length; i += 1) {
    const ch = script[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function loadLib() {
  const start = script.indexOf('const POL =');
  const end = script.indexOf('const TERMINAL_DATA_DEVICE_TYPES=');
  const context = { console, structuredClone: global.structuredClone, window: {} };
  vm.createContext(context);
  vm.runInContext(`${script.slice(start, end)}\nglobalThis.__LIB=LIB;`, context, { timeout: 10_000 });
  return context.__LIB;
}

const runtimeFunctions = [
  'simNetFor', 'setSimNetFlag', 'markSimulationSources', 'rackHostPresentFor', 'simDeviceRequiresPower', 'simDevicePowered',
  'updateSimIoState', 'externalMemberMatches', 'updateSimCommunicationState', 'analogRoleForMember',
  'updateSimSignalState', 'outputGroupForTerminal', 'buildNetsWithSim', 'computeDynamicState',
  'simCoilPowered', 'computeCoilCandidates', 'resolveInterlockedCoils', 'updateSimTimerState',
  'updateSimDriveState', 'updateSimMotorState', 'updateSimCylinderState'
].map(extractFunction).join('\n');

function makeScenario({ breakerOpen = false, includeAcInput = true } = {}) {
  const LIB = loadLib();
  const S = {
    devices: {
      b: { type: 'MCCB1P' }, f: { type: 'FUSE' }, p: { type: 'MDR-100' },
      h: { type: 'EXP2-700' }, m: { type: 'XY-MD02' }, x: { type: 'XBC-DR32H' },
      i: { type: 'XBE-DC32A' }, l: { type: 'LAMP-G' }
    },
    wires: []
  };
  const add = (a, at, b, bt) => S.wires.push({
    id: `w${S.wires.length + 1}`, from: { dev: a, term: at }, to: { dev: b, term: bt }
  });
  if (includeAcInput) {
    add('b', "L'", 'f', 'L-IN'); add('b', "N'", 'f', 'N-IN');
    add('f', 'L-OUT', 'p', 'L'); add('f', 'N-OUT', 'p', 'N');
    add('b', "L'", 'x', 'L'); add('b', "N'", 'x', 'N');
  }
  add('p', 'V+1', 'h', 'V+'); add('p', 'V-1', 'h', 'V-');
  add('p', 'V+2', 'm', 'V+'); add('p', 'V-2', 'm', 'V-');
  add('h', 'T+', 'x', '485+'); add('h', 'T-', 'x', '485-');
  add('p', 'V+1', 'x', 'COM0'); add('x', 'P20', 'l', '+'); add('l', '-', 'p', 'V-1');
  add('p', 'V+1', 'i', 'I00'); add('p', 'V-1', 'i', 'COM-A1');

  const SIM = {
    pressed: new Set(), toggled: new Set(),
    openSwitches: new Set(breakerOpen ? ['b'] : []),
    forcedOutputs: new Set(['x.P20']), selPos: {}, energized: new Set(), liveTerms: new Set(),
    ioState: new Map(), devicePower: new Map(), commState: new Map(), signalState: new Map(),
    coilState: new Map(), timerStarted: new Map(),
    timerSet: 3000, cylState: new Map()
  };
  const context = { console, Date, LIB, S, SIM };
  vm.createContext(context);
  vm.runInContext(runtimeFunctions, context);
  const preNets = context.buildNetsWithSim(context.computeDynamicState({ includeForcedOutputs: false }));
  context.markSimulationSources(preNets);
  const nets = context.buildNetsWithSim(context.computeDynamicState({ includeForcedOutputs: true }));
  context.markSimulationSources(nets);
  context.updateSimIoState(nets);
  context.updateSimCommunicationState(nets);
  context.updateSimSignalState(nets);
  return { S, SIM, nets };
}

test('valid L/N input powers MDR, HMI, MD02, PLC and physical input logic', () => {
  const { SIM } = makeScenario();
  assert.equal(SIM.devicePower.get('p'), true);
  assert.equal(SIM.devicePower.get('h'), true);
  assert.equal(SIM.devicePower.get('m'), true);
  assert.equal(SIM.devicePower.get('x'), true);
  assert.equal(SIM.ioState.get('i.I00'), true);
  assert.equal(SIM.commState.get('h').ready, true);
  assert.equal(SIM.commState.get('x').ready, true);
});

test('forced PLC relay output only energizes the lamp when PLC and MDR power are valid', () => {
  const { SIM } = makeScenario();
  assert.equal(SIM.liveTerms.has('l.+'), true);
  assert.equal(SIM.liveTerms.has('l.-'), true);
});

test('opening the two-pole breaker removes downstream AC and DC power', () => {
  const { SIM } = makeScenario({ breakerOpen: true });
  assert.equal(SIM.devicePower.get('p'), false);
  assert.equal(SIM.devicePower.get('h'), false);
  assert.equal(SIM.devicePower.get('m'), false);
  assert.equal(SIM.devicePower.get('x'), false);
  assert.equal(SIM.ioState.get('i.I00'), false);
  assert.equal(SIM.commState.get('h').ready, false);
  assert.equal(SIM.liveTerms.has('l.+'), false);
});

test('MDR outputs stay inactive when no AC input is wired', () => {
  const { SIM } = makeScenario({ includeAcInput: false });
  assert.equal(SIM.devicePower.get('p'), false);
  assert.equal(SIM.liveTerms.has('p.V+1'), false);
  assert.equal(SIM.liveTerms.has('p.V-1'), false);
});


function makeTemperatureSignalScenario({ breakerOpen = false } = {}) {
  const LIB = loadLib();
  const S = {
    devices: {
      b: { type: 'MCCB1P' }, p: { type: 'MDR-100' },
      tc: { type: 'XBF-TC04S' }, tcs: { type: 'TC-K' },
      rd: { type: 'XBF-RD04A' }, rtd: { type: 'PT100-3W' }
    },
    wires: []
  };
  const add = (a, at, b, bt) => S.wires.push({
    id: `w${S.wires.length + 1}`, from: { dev: a, term: at }, to: { dev: b, term: bt }
  });
  add('b', "L'", 'p', 'L'); add('b', "N'", 'p', 'N');
  for (const id of ['tc', 'rd']) {
    add('p', 'V+1', id, '+24V'); add('p', 'V-1', id, '0V');
  }
  add('tcs', '+', 'tc', 'CH0+'); add('tcs', '-', 'tc', 'CH0-');
  add('rtd', 'A', 'rd', 'CH0A'); add('rtd', 'B', 'rd', 'CH0B'); add('rtd', 'b', 'rd', 'CH0b');
  const SIM = {
    pressed: new Set(), toggled: new Set(), openSwitches: new Set(breakerOpen ? ['b'] : []),
    forcedOutputs: new Set(), selPos: {}, energized: new Set(), liveTerms: new Set(),
    ioState: new Map(), devicePower: new Map(), commState: new Map(), signalState: new Map(),
    coilState: new Map(), timerStarted: new Map(), timerSet: 3000, cylState: new Map()
  };
  const context = { console, Date, LIB, S, SIM };
  vm.createContext(context);
  vm.runInContext(runtimeFunctions, context);
  const nets = context.buildNetsWithSim(context.computeDynamicState({ includeForcedOutputs: false }));
  context.markSimulationSources(nets);
  context.updateSimSignalState(nets);
  return { SIM };
}

test('thermocouple and PT100 channels become ready only with complete signal wiring and module power', () => {
  const { SIM } = makeTemperatureSignalScenario();
  assert.equal(SIM.signalState.get('tc.CH0').ready, true);
  assert.equal(SIM.signalState.get('rd.CH0').ready, true);
});

test('temperature channels lose ready state when the upstream breaker opens', () => {
  const { SIM } = makeTemperatureSignalScenario({ breakerOpen: true });
  assert.equal(SIM.signalState.get('tc.CH0').ready, false);
  assert.equal(SIM.signalState.get('rd.CH0').ready, false);
});


function makeControlRuntime(devices, wires) {
  const LIB = loadLib();
  const S = { devices, wires };
  const SIM = {
    pressed: new Set(), toggled: new Set(), openSwitches: new Set(), forcedOutputs: new Set(),
    selPos: {}, energized: new Set(), liveTerms: new Set(), ioState: new Map(),
    devicePower: new Map(), commState: new Map(), signalState: new Map(), coilState: new Map(),
    timerStarted: new Map(), timerSet: 3000, cylState: new Map(), tripped: new Set(),
    interlockConflicts: new Set(), driveState: new Map(), motorState: new Map()
  };
  const context = { console, Date, LIB, S, SIM };
  vm.createContext(context);
  vm.runInContext(runtimeFunctions, context);
  context.scan = () => {
    const nets = context.buildNetsWithSim(context.computeDynamicState({ includeForcedOutputs: false }));
    context.markSimulationSources(nets);
    const previous = new Map(SIM.coilState);
    SIM.coilState = context.resolveInterlockedCoils(context.computeCoilCandidates(nets), previous);
    context.updateSimTimerState(previous, SIM.coilState);
    context.updateSimDriveState(nets);
    context.updateSimMotorState(nets);
    return nets;
  };
  return context;
}

function wireBuilder() {
  const wires = [];
  const add = (a, at, b, bt) => wires.push({
    id: `w${wires.length + 1}`, from: { dev: a, term: at }, to: { dev: b, term: bt }
  });
  return { wires, add };
}

test('standard g7 control circuit self-holds and the NC stop contact releases the MC', () => {
  const { wires, add } = wireBuilder();
  const devices = {
    b: { type: 'MCCB1P' }, p: { type: 'MDR-100' },
    start: { type: 'PB-1C', role: 'startPB' }, stop: { type: 'PB-1C', role: 'stopPB' },
    mc: { type: 'MC', role: 'mainMC' }, lamp: { type: 'LAMP-G' }
  };
  add('b', "L'", 'p', 'L'); add('b', "N'", 'p', 'N');
  add('p', 'V+1', 'stop', '21'); add('stop', '22', 'start', '11');
  add('start', '12', 'mc', 'A1'); add('mc', 'A2', 'p', 'V-1');
  add('stop', '22', 'mc', '13'); add('mc', '14', 'mc', 'A1');
  add('mc', 'A1', 'lamp', '+'); add('lamp', '-', 'p', 'V-1');
  const ctx = makeControlRuntime(devices, wires);

  ctx.SIM.pressed.add('start');
  ctx.scan();
  assert.equal(ctx.SIM.coilState.get('mc'), true, 'start PB should energize MC');
  ctx.scan();
  ctx.SIM.pressed.delete('start');
  ctx.scan();
  assert.equal(ctx.SIM.coilState.get('mc'), true, '13-14 auxiliary contact should hold MC');
  ctx.SIM.pressed.add('stop');
  ctx.scan();
  assert.equal(ctx.SIM.coilState.get('mc'), false, 'opening stop NC must release MC');
});

test('electrical interlock blocks simultaneous forward and reverse coils', () => {
  const ctx = makeControlRuntime({
    f: { type: 'MC', role: 'forwardMC', interlockGroup: 'direction-MC' },
    r: { type: 'MC', role: 'reverseMC', interlockGroup: 'direction-MC' }
  }, []);
  let resolved = ctx.resolveInterlockedCoils(new Map([['f', true], ['r', true]]), new Map());
  assert.equal(resolved.get('f'), false);
  assert.equal(resolved.get('r'), false);
  assert.equal(ctx.SIM.interlockConflicts.has('direction-MC'), true);

  resolved = ctx.resolveInterlockedCoils(
    new Map([['f', true], ['r', true]]),
    new Map([['f', true], ['r', false]])
  );
  assert.equal(resolved.get('f'), true, 'already-held direction wins transient simultaneous request');
  assert.equal(resolved.get('r'), false);
});

test('iG5A dry-contact commands drive the connected motor with direction and conflict state', () => {
  const ctx = makeControlRuntime({ d: { type: 'IG5A' }, m: { type: 'MOTOR-3P' } }, []);
  ctx.SIM.devicePower.set('d', true);
  const forwardNets = [
    { id: 'cmdF', members: [{ dev: 'd', term: 'CM' }, { dev: 'd', term: 'P1' }] },
    { id: 'p2', members: [{ dev: 'd', term: 'P2' }] },
    { id: 'u', members: [{ dev: 'd', term: 'U' }, { dev: 'm', term: 'U' }] },
    { id: 'v', members: [{ dev: 'd', term: 'V' }, { dev: 'm', term: 'V' }] },
    { id: 'w', members: [{ dev: 'd', term: 'W' }, { dev: 'm', term: 'W' }] },
  ];
  ctx.updateSimDriveState(forwardNets);
  ctx.updateSimMotorState(forwardNets);
  assert.equal(ctx.SIM.driveState.get('d').direction, 'forward');
  assert.equal(ctx.SIM.motorState.get('m').running, true);
  assert.equal(ctx.SIM.motorState.get('m').direction, 'forward');

  const conflictNets = [
    { id: 'cmdBoth', members: [{ dev: 'd', term: 'CM' }, { dev: 'd', term: 'P1' }, { dev: 'd', term: 'P2' }] },
    ...forwardNets.slice(2),
  ];
  ctx.updateSimDriveState(conflictNets);
  ctx.updateSimMotorState(conflictNets);
  assert.equal(ctx.SIM.driveState.get('d').conflict, true);
  assert.equal(ctx.SIM.motorState.get('m').running, false);
});

test('EOCR reset contact holds the starter and TRIP opens 95-96 to release it', () => {
  const { wires, add } = wireBuilder();
  const devices = {
    b: { type: 'MCCB1P' }, p: { type: 'MDR-100' }, e: { type: 'EOCR' },
    start: { type: 'PB-1C', role: 'startPB' }, stop: { type: 'PB-1C', role: 'stopPB' },
    mc: { type: 'MC', role: 'mainMC' }
  };
  add('b', "L'", 'p', 'L'); add('b', "N'", 'p', 'N');
  add('p', 'V+2', 'e', 'A1'); add('e', 'A2', 'p', 'V-2');
  add('p', 'V+1', 'stop', '21'); add('stop', '22', 'e', '95');
  add('e', '96', 'start', '11'); add('start', '12', 'mc', 'A1');
  add('mc', 'A2', 'p', 'V-1'); add('e', '96', 'mc', '13'); add('mc', '14', 'mc', 'A1');
  const ctx = makeControlRuntime(devices, wires);

  ctx.SIM.pressed.add('start');
  ctx.scan();
  assert.equal(ctx.SIM.coilState.get('mc'), true);
  ctx.scan();
  ctx.SIM.pressed.delete('start');
  ctx.scan();
  assert.equal(ctx.SIM.coilState.get('mc'), true, 'reset EOCR NC should permit self-hold');
  ctx.SIM.tripped.add('e');
  ctx.scan();
  assert.equal(ctx.SIM.coilState.get('mc'), false, 'EOCR trip must interrupt the starter coil');
  const dyn = ctx.computeDynamicState({ includeForcedOutputs: false });
  assert.equal(dyn.e.some(([a, b]) => a === '95' && b === '96'), false);
  assert.equal(dyn.e.some(([a, b]) => a === '97' && b === '98'), true);
});

test('rack attachment does not bypass an expansion module external DC power pair', () => {
  const context = {
    S: { devices: { m: { type: 'MOD', rackStatus: 'attached' } } },
    SIM: { devicePower: new Map([['m', false]]) }
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction('simDeviceRequiresPower')}\n${extractFunction('simDevicePowered')}`, context);
  const definition = { rackModule: { family: 'LS-XGB' }, powerPairs: [{ pos: '+24V', neg: '0V' }] };
  assert.equal(context.simDevicePowered('m', definition), false);
  context.SIM.devicePower.set('m', true);
  assert.equal(context.simDevicePowered('m', definition), true);
  context.S.devices.m.rackStatus = 'unattached';
  assert.equal(context.simDevicePowered('m', definition), false);
});
