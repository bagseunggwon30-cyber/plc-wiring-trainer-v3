const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadPackLibrary() {
  const registryPath = path.join(ROOT, 'src/device-packs/device-pack-registry.js');
  const packPath = path.join(ROOT, 'src/device-packs/ls-xgb-v24-pack.js');
  delete require.cache[require.resolve(registryPath)];
  delete require.cache[require.resolve(packPath)];
  delete globalThis.PLCDevicePacks;
  const registry = require(registryPath);
  require(packPath);
  registry.resetInstallState();
  const library = {};
  const report = registry.installAll(library, { force: true });
  return { registry, library, report };
}

function terminalIds(definition) {
  return (definition.terminals || []).map(item => item.id);
}

function net(id, members) {
  return { id, members };
}

function netFor(nets, deviceId, terminalId) {
  return nets.find(item => item.members.some(member => member.dev === deviceId && member.term === terminalId)) || null;
}

test('v2.4 JSON-style device pack installs four manual/runtime devices without duplicate terminals', () => {
  const { registry, library, report } = loadPackLibrary();
  assert.deepEqual(report.errors, []);
  assert.ok(report.packs.includes('ls-xgb-v24'));
  assert.deepEqual(new Set(Object.keys(library)), new Set(['XBL-C41A', 'XBF-PD02A', 'SIGNAL-GEN-VI', 'PRESSURE-TX-420']));
  for (const [type, definition] of Object.entries(library)) {
    const ids = terminalIds(definition);
    assert.equal(new Set(ids).size, ids.length, `${type} has duplicate terminal IDs`);
    assert.ok(definition.image.startsWith('assets/devices/gpt-v24/'));
  }
  assert.equal(registry.list()[0].version, '2.4.0');
});

test('XBL-C41A and XBF-PD02A expose manual-derived connector metadata and rack classes', () => {
  const { library } = loadPackLibrary();
  const cnet = library['XBL-C41A'];
  assert.deepEqual(terminalIds(cnet), ['TX+', 'TX-', 'RX+', 'RX-', 'SG']);
  assert.equal(cnet.rack.role, 'module');
  assert.equal(cnet.rack.moduleClass, 'communication');
  assert.equal(cnet.communicationModule.channels, 1);
  assert.equal(cnet.rs485BusPorts[0].requireBridgeIn2Wire, true);

  const pd = library['XBF-PD02A'];
  assert.equal(pd.terminals.length, 40);
  assert.equal(pd.positioning.axes, 2);
  assert.equal(pd.positioning.maxPulsePps, 2_000_000);
  assert.equal(pd.rack.moduleClass, 'highSpeed');
  assert.ok(terminalIds(pd).includes('X-FP+'));
  assert.ok(terminalIds(pd).includes('Y-HOME-COM'));
  const pinOf = id => pd.terminals.find(terminal => terminal.id === id)?.pin;
  assert.equal(pinOf('X-FP+'), 'A18');
  assert.equal(pinOf('Y-FP+'), 'B18');
  assert.equal(pinOf('MPG-A+'), 'B20');
  assert.equal(pinOf('X-HOME-COM'), 'A02');
});

test('rack runtime assigns nearest compatible modules by slot and creates XG5000 P addresses', () => {
  const rack = require(path.join(ROOT, 'src/runtime/rack-runtime.js'));
  const library = {
    CPU: { w: 200, h: 300, rack: { role: 'host', family: 'LS-XGB', maxSlots: 4, maxCommunication: 2, maxHighSpeed: 2 } },
    DI: { w: 80, h: 300, rack: { role: 'module', family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 16 }, inputGroups: [{ inputs: ['I0', 'I1'] }] },
    DO: { w: 80, h: 300, rack: { role: 'module', family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 16 }, outputGroups: [{ outputs: ['Q0', 'Q1'] }] },
    COM: { w: 80, h: 300, rack: { role: 'module', family: 'LS-XGB', moduleClass: 'communication', occupiedPoints: 64, specialBase: true } }
  };
  const devices = {
    cpu: { type: 'CPU', x: 0, y: 0, railId: 'r1' },
    di: { type: 'DI', x: 230, y: 0, railId: 'r1' },
    dout: { type: 'DO', x: 330, y: 0, railId: 'r1' },
    com: { type: 'COM', x: 430, y: 0, railId: 'r1' }
  };
  const state = rack.reconcile(devices, library);
  assert.equal(state.assignedCount, 3);
  assert.deepEqual(state.racks[0].modules.map(item => item.slot), [1, 2, 3]);
  assert.equal(devices.di.ioBinding.inputs[0].address, 'P0040');
  assert.equal(devices.dout.ioBinding.outputs[1].address, 'P0081');
  assert.equal(devices.com.ioBinding.specialBase, 'U0.3');
  assert.match(rack.badge(devices.di), /^S1/);
});

test('rack runtime flags slot, communication, and high-speed capacity violations', () => {
  const rack = require(path.join(ROOT, 'src/runtime/rack-runtime.js'));
  const library = {
    CPU: { w: 200, h: 300, rack: { role: 'host', family: 'LS-XGB', maxSlots: 3, maxCommunication: 1, maxHighSpeed: 1 } },
    COM: { w: 60, h: 300, rack: { role: 'module', family: 'LS-XGB', moduleClass: 'communication' } },
    FAST: { w: 60, h: 300, rack: { role: 'module', family: 'LS-XGB', moduleClass: 'highSpeed' } }
  };
  const devices = { cpu: { type: 'CPU', x: 0, y: 0 } };
  ['c1', 'c2'].forEach((id, i) => { devices[id] = { type: 'COM', x: 230 + i * 70, y: 0 }; });
  ['f1', 'f2'].forEach((id, i) => { devices[id] = { type: 'FAST', x: 370 + i * 70, y: 0 }; });
  const state = rack.reconcile(devices, library);
  assert.ok(state.errors.some(item => item.message.includes('통신 모듈')));
  assert.ok(state.unattached.some(item => item.reason === 'slot-overflow'));
  assert.ok(rack.validate(state).some(item => item.category === 'function'));
});

test('analog runtime converts a 5 bar pressure value to 12 mA and an input raw value', () => {
  const analog = require(path.join(ROOT, 'src/runtime/analog-runtime.js'));
  const { library } = loadPackLibrary();
  library.AI = {
    analogChannels: [{ channel: 0, pos: 'CH0+', neg: 'CH0-', direction: 'input', ranges: ['4~20mA'], dataType: '0~16000' }]
  };
  const devices = {
    sensor: { type: 'PRESSURE-TX-420', runtime: { analog: { channels: { 0: { range: '4~20mA', dataType: '0~16000', engineeringMin: 0, engineeringMax: 10, engineeringValue: 5, unit: 'bar' } } } } },
    input: { type: 'AI', runtime: { analog: { channels: { 0: { range: '4~20mA', dataType: '0~16000', engineeringMin: 0, engineeringMax: 10, engineeringValue: 0, unit: 'bar' } } } } }
  };
  const nets = [
    net('plus', [{ dev: 'sensor', term: 'SIG+' }, { dev: 'input', term: 'CH0+' }]),
    net('minus', [{ dev: 'sensor', term: 'SIG-' }, { dev: 'input', term: 'CH0-' }])
  ];
  const state = analog.evaluate({ devices, library, nets, netFor, powered: () => true });
  const source = state.get('sensor.CH0');
  const input = state.get('input.CH0');
  assert.equal(source.signalValue, 12);
  assert.equal(source.rawValue, 8000);
  assert.equal(input.ready, true);
  assert.equal(input.rawValue, 8000);
  assert.equal(input.engineeringValue, 5);
});

test('analog runtime detects voltage/current range mismatch on a completed pair', () => {
  const analog = require(path.join(ROOT, 'src/runtime/analog-runtime.js'));
  const { library } = loadPackLibrary();
  library.AI = { analogChannels: [{ channel: 0, pos: '+', neg: '-', direction: 'input', ranges: ['0~10V'], dataType: '0~4000' }] };
  const devices = { sensor: { type: 'PRESSURE-TX-420' }, input: { type: 'AI' } };
  const nets = [net('p', [{ dev: 'sensor', term: 'SIG+' }, { dev: 'input', term: '+' }]), net('n', [{ dev: 'sensor', term: 'SIG-' }, { dev: 'input', term: '-' }])];
  const state = analog.evaluate({ devices, library, nets, netFor, powered: () => true });
  assert.equal(state.get('input.CH0').quality, 'range-mismatch');
  assert.ok(analog.validate(state).some(item => item.category === 'function'));
});

test('Modbus runtime forms a ready two-wire bus and exposes XY-MD02 registers', () => {
  const modbus = require(path.join(ROOT, 'src/runtime/modbus-runtime.js'));
  const { library } = loadPackLibrary();
  library['XY-MD02'] = {
    canonicalType: 'XY-MD02', rs485Pairs: [['A+', 'B-']],
    modbusDefaults: { enabled: true, role: 'slave', address: 1, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, mode: '2wire' }
  };
  const devices = {
    master: { type: 'XBL-C41A', runtime: { modbus: { enabled: true, role: 'master', address: 1, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, mode: '2wire', termination: true } } },
    sensor: { type: 'XY-MD02', runtime: { modbus: { enabled: true, role: 'slave', address: 1, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, mode: '2wire' }, sensor: { temperatureC: 25.6, humidityRH: 51.2 } } }
  };
  const nets = [
    net('A', [{ dev: 'master', term: 'TX+' }, { dev: 'master', term: 'RX+' }, { dev: 'sensor', term: 'A+' }]),
    net('B', [{ dev: 'master', term: 'TX-' }, { dev: 'master', term: 'RX-' }, { dev: 'sensor', term: 'B-' }])
  ];
  const result = modbus.evaluate({ devices, library, nets, netFor, powered: () => true });
  assert.equal(result.buses.length, 1);
  assert.equal(result.buses[0].ready, true);
  assert.equal(result.devices.get('sensor').ready, true);
  assert.equal(result.devices.get('sensor').registers.inputRegisters[1], 256);
  assert.equal(result.devices.get('sensor').registers.inputRegisters[2], 512);
  assert.deepEqual(modbus.validate(result), []);
});

test('Modbus runtime detects a missing XBL two-wire bridge and duplicate slave addresses', () => {
  const modbus = require(path.join(ROOT, 'src/runtime/modbus-runtime.js'));
  const { library } = loadPackLibrary();
  library.SLAVE = { rs485Pairs: [['A', 'B']], modbusDefaults: { enabled: true, role: 'slave', address: 1, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, mode: '2wire' } };
  const baseConfig = { enabled: true, role: 'master', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, mode: '2wire' };
  const devices = { master: { type: 'XBL-C41A', runtime: { modbus: baseConfig } }, s1: { type: 'SLAVE' } };
  const missingBridge = [net('A', [{ dev: 'master', term: 'TX+' }, { dev: 's1', term: 'A' }]), net('B', [{ dev: 'master', term: 'TX-' }, { dev: 's1', term: 'B' }])];
  const first = modbus.evaluate({ devices, library, nets: missingBridge, netFor, powered: () => true });
  assert.ok(first.portIssues.some(item => item.fault === 'two-wire-bridge-missing'));

  devices.s2 = { type: 'SLAVE' };
  const complete = [
    net('A', [{ dev: 'master', term: 'TX+' }, { dev: 'master', term: 'RX+' }, { dev: 's1', term: 'A' }, { dev: 's2', term: 'A' }]),
    net('B', [{ dev: 'master', term: 'TX-' }, { dev: 'master', term: 'RX-' }, { dev: 's1', term: 'B' }, { dev: 's2', term: 'B' }])
  ];
  const second = modbus.evaluate({ devices, library, nets: complete, netFor, powered: () => true });
  assert.equal(second.buses[0].reason, 'duplicate-slave-id');
  assert.ok(modbus.validate(second).some(item => item.msg.includes('중복')));
});

test('drive runtime ramps iG5A frequency and calculates four-pole synchronous speed', () => {
  const drive = require(path.join(ROOT, 'src/runtime/drive-runtime.js'));
  const state = drive.step({ currentHz: 0, direction: 'stop', lastAtMs: 1000 }, { powered: true, forward: true, reverse: false, conflict: false }, { targetHz: 60, maxHz: 60, accelSec: 5, decelSec: 10, motorPoles: 4 }, 2000);
  assert.equal(state.currentHz, 12);
  assert.equal(state.rpm, 360);
  assert.equal(state.direction, 'forward');
  assert.equal(state.running, true);
});

test('v2.4 HTML integrates external runtimes, schema 6, rack monitor, and missions g21-g23', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const script of ['device-pack-registry.js', 'ls-xgb-v24-pack.js', 'rack-runtime.js', 'analog-runtime.js', 'modbus-runtime.js', 'drive-runtime.js', 'device-config.js']) {
    assert.match(html, new RegExp(script.replace('.', '\\.')));
  }
  assert.match(html, /const PROJECT_SCHEMA_VERSION=9/);
  assert.match(html, /id="rack-monitor"/);
  for (const mission of ['g21', 'g22', 'g23']) assert.match(html, new RegExp(`id:'${mission}'`));
  assert.match(html, /PLCAnalogRuntime/);
  assert.match(html, /PLCModbusRuntime/);
  assert.match(html, /PLCDriveRuntime/);
});

test('all v2.4 GPT-derived equipment assets and linked manuals are packaged', () => {
  const { library } = loadPackLibrary();
  for (const definition of Object.values(library)) {
    assert.ok(fs.statSync(path.join(ROOT, definition.image)).size > 10_000, definition.image);
    if (definition.manualSource) assert.ok(fs.statSync(path.join(ROOT, definition.manualSource)).size > 50_000, definition.manualSource);
  }
});

test('modular runtimes preserve v2.3 analogConfig, modbus, and driveConfig project fields', () => {
  const analog = require(path.join(ROOT, 'src/runtime/analog-runtime.js'));
  const modbus = require(path.join(ROOT, 'src/runtime/modbus-runtime.js'));
  const drive = require(path.join(ROOT, 'src/runtime/drive-runtime.js'));
  const definition = { analogChannels: [{ channel: 0, pos: '+', neg: '-', direction: 'source', ranges: ['0~10V'] }], analogSource: { engineeringMin: 0, engineeringMax: 100, defaultEngineeringValue: 50, unit: '%' } };
  const device = { analogConfig: { 0: { range: '0~10V', engineeringMin: 0, engineeringMax: 100, engineeringValue: 25, unit: '%' } }, modbus: { enabled: true, role: 'slave', slaveId: 7, baudRate: 19200 }, driveConfig: { commandHz: 30, maxHz: 60, accelSec: 3, decelSec: 4, motorPoles: 4, ratedCurrentA: 5 } };
  analog.ensureDeviceRuntime(device, definition);
  assert.equal(device.runtime.analog.channels['0'].engineeringValue, 25);
  assert.equal(modbus.settings(device, { modbusDefaults: { enabled: false, role: 'slave', slaveId: 1, baudRate: 9600 } }).address, 7);
  assert.equal(modbus.settings(device, { modbusDefaults: {} }).baudRate, 19200);
  assert.equal(drive.ensureRuntime(device).targetHz, 30);
  assert.equal(device.runtime.drive.ratedCurrentA, 5);
});

test('g23 uses the official XBL-C41A TX/RX terminal names and role-specific Modbus defaults', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
  const start = html.indexOf("id:'g23'");
  const end = html.indexOf("\n      ]\n    }", start);
  const block = html.slice(start, end + 20);
  assert.match(block, /term:'TX\+'/);
  assert.match(block, /term:'RX\+'/);
  assert.match(block, /role:'modbusMaster'/);
  assert.match(block, /role:'tempHumiditySlave'/);
  assert.doesNotMatch(block, /term:'SDA'|term:'RDA'|term:'SDB'|term:'RDB'/);
});


test('XGB P address formatter follows CPU and 64-point expansion-slot allocation', () => {
  const rack = require(path.join(ROOT, 'src/runtime/rack-runtime.js'));
  const cases = new Map([
    [0, 'P0000'], [31, 'P001F'], [32, 'P0020'], [63, 'P003F'],
    [64, 'P0040'], [127, 'P007F'], [128, 'P0080'], [191, 'P011F'], [192, 'P0120']
  ]);
  for (const [point, address] of cases) assert.equal(rack.pAddressFromPoint(point), address);
  assert.equal(rack.slotRange(3).text, 'P0120~P015F');
});

test('rack runtime preserves explicit slot rules and reports duplicate or missing CPU assignment', () => {
  const rack = require(path.join(ROOT, 'src/runtime/rack-runtime.js'));
  const library = {
    CPU: { w: 200, h: 300, rackCpu: { family: 'LS-XGB', maxSlots: 4 } },
    MOD: { w: 80, h: 300, rackModule: { family: 'LS-XGB', moduleClass: 'io', occupiedPoints: 64 } }
  };
  const devices = {
    cpu: { type: 'CPU', x: 0, y: 0 },
    first: { type: 'MOD', x: 230, y: 0, runtime: { rack: { rackId: 'cpu', slot: 1 } } },
    duplicate: { type: 'MOD', x: 330, y: 0, runtime: { rack: { rackId: 'cpu', slot: 1 } } },
    missing: { type: 'MOD', x: 430, y: 0, runtime: { rack: { rackId: 'not-there', slot: 2 } } }
  };
  const state = rack.reconcile(devices, library);
  assert.equal(devices.first.rackSlot, 1);
  assert.equal(devices.duplicate.rackStatus, 'slot-duplicate');
  assert.equal(devices.missing.rackStatus, 'rack-not-found');
  assert.ok(state.errors.some(item => item.message.includes('중복')));
  const issues = rack.validate(state);
  assert.ok(issues.some(item => item.msg.includes('슬롯 중복')));
  assert.ok(issues.some(item => item.msg.includes('지정 CPU')));
});

test('RTD and K thermocouple models produce resistance, millivolt, temperature and wire-break state', () => {
  const analog = require(path.join(ROOT, 'src/runtime/analog-runtime.js'));
  const library = {
    RTD: { sensorKind: 'RTD' },
    TC: { sensorKind: 'THERMOCOUPLE', thermocoupleType: 'K' },
    RD: { rtdChannels: [{ channel: 0, A: 'A', B: 'B', b: 'b' }] },
    TCM: { analogChannels: [{ channel: 0, pos: '+', neg: '-', direction: 'input', ranges: ['0~10V'] }], thermocoupleTypes: ['K'] }
  };
  const devices = {
    rtd: { type: 'RTD', runtime: { sensor: { kind: 'RTD', temperatureC: 25, wireBreak: false } } },
    rd: { type: 'RD' },
    tc: { type: 'TC', runtime: { sensor: { kind: 'THERMOCOUPLE', temperatureC: 100, wireBreak: false } } },
    tcm: { type: 'TCM' }
  };
  const nets = [
    net('rtd-a', [{ dev: 'rtd', term: 'A' }, { dev: 'rd', term: 'A' }]),
    net('rtd-b', [{ dev: 'rtd', term: 'B' }, { dev: 'rd', term: 'B' }]),
    net('rtd-b2', [{ dev: 'rtd', term: 'b' }, { dev: 'rd', term: 'b' }]),
    net('tc-p', [{ dev: 'tc', term: '+' }, { dev: 'tcm', term: '+' }]),
    net('tc-n', [{ dev: 'tc', term: '-' }, { dev: 'tcm', term: '-' }])
  ];
  const state = analog.evaluate({ devices, library, nets, netFor, powered: () => true });
  assert.equal(state.get('rd.CH0').ready, true);
  assert.equal(state.get('rd.CH0').signalValue, 109.625);
  assert.equal(state.get('rd.CH0').rawValue, 250);
  assert.equal(state.get('tcm.CH0').ready, true);
  assert.equal(state.get('tcm.CH0').signalValue, 4.1);
  assert.equal(state.get('tcm.CH0').rawValue, 1000);

  devices.tc.runtime.sensor.wireBreak = true;
  const broken = analog.evaluate({ devices, library, nets, netFor, powered: () => true });
  assert.equal(broken.get('tcm.CH0').quality, 'wire-break');
  assert.ok(analog.validate(broken).some(item => item.msg.includes('단선')));
});

test('device configuration module exposes rack, analog, sensor, Modbus and drive configuration entry points', () => {
  const config = require(path.join(ROOT, 'src/ui/device-config.js'));
  assert.equal(config.isConfigurable({ type: 'CPU' }, { rackCpu: { family: 'LS-XGB' } }), true);
  assert.equal(config.isConfigurable({ type: 'SENSOR' }, { sensorKind: 'PRESSURE', analogChannels: [{ channel: 0 }] }), true);
  assert.equal(config.isConfigurable({ type: 'PLAIN' }, { label: 'plain' }), false);
  for (const method of ['open', 'close', 'save']) assert.equal(typeof config[method], 'function');
  const source = fs.readFileSync(path.join(ROOT, 'src/ui/device-config.js'), 'utf8');
  assert.match(source, /sensorWireBreak/);
  assert.match(source, /rackSlot/);
  assert.match(source, /modbusBaud/);
  assert.match(source, /driveTarget/);
  assert.match(source, /단자 P1\/P2 \(v2\.4 지원\)/);
  assert.doesNotMatch(source, /value: 'rs485', label: 'RS-485'/);
});

test('v2.4 package includes modular source files and terminal tooltips expose P addresses', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.7.0');
  assert.ok(pkg.build.files.includes('src/**/*'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /XG5000 주소:/);
  assert.match(html, /PLCTrainerDeviceConfig/);
  assert.match(html, /devId,device:dev,definition:def/);
  assert.match(html, /이 장비에는 변경 가능한 런타임 설정이 없습니다/);
  assert.doesNotMatch(html, /IEC preview|Slot\/IEC/);
});

test('device configuration save synchronizes rack, analog, Modbus and iG5A compatibility fields', () => {
  const config = require(path.join(ROOT, 'src/ui/device-config.js'));
  const analog = require(path.join(ROOT, 'src/runtime/analog-runtime.js'));
  const modbus = require(path.join(ROOT, 'src/runtime/modbus-runtime.js'));
  const drive = require(path.join(ROOT, 'src/runtime/drive-runtime.js'));
  const { library } = loadPackLibrary();
  const box = values => ({
    querySelector(selector) {
      const name = /\[name="([^"]+)"\]/.exec(selector)?.[1];
      return name && Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null;
    }
  });
  const input = (value, checked = false) => ({ value: String(value ?? ''), checked });

  const xbl = { type: 'XBL-C41A', runtime: {} };
  config.save({ device: xbl, definition: library['XBL-C41A'], modbusApi: modbus }, box({
    rackId: input('cpu-main'), rackSlot: input(3), modbusEnabled: input('', true),
    modbusRole: input('master'), modbusAddress: input(1), modbusBaud: input(19200),
    modbusDataBits: input(8), modbusParity: input('even'), modbusStopBits: input(1),
    modbusMode: input('2wire'), modbusTermination: input('', true)
  }));
  assert.deepEqual(xbl.runtime.rack, { rackId: 'cpu-main', slot: 3 });
  assert.equal(xbl.rackId, 'cpu-main');
  assert.equal(xbl.rackHostId, 'cpu-main');
  assert.equal(xbl.slot, 3);
  assert.equal(xbl.rackSlot, 3);
  assert.equal(xbl.runtime.modbus.baudRate, 19200);
  assert.equal(xbl.modbus.parity, 'even');

  const pressure = { type: 'PRESSURE-TX-420', runtime: {} };
  config.save({ device: pressure, definition: library['PRESSURE-TX-420'], analogApi: analog }, box({
    'analog-0-range': input('4~20mA'), 'analog-0-dataType': input('0~16000'),
    'analog-0-min': input(0), 'analog-0-max': input(10), 'analog-0-value': input(7.5),
    'analog-0-unit': input('bar'), sensorProcess: input(7.5), sensorWireBreak: input('', false)
  }));
  assert.equal(pressure.runtime.analog.channels['0'].engineeringValue, 7.5);
  assert.equal(pressure.analogConfig['0'].dataType, '0~16000');
  assert.equal(pressure.runtime.sensor.processValue, 7.5);

  const inverter = { type: 'IG5A', runtime: {} };
  config.save({ device: inverter, definition: { label: 'iG5A', driveModel: 'ig5a' }, driveApi: drive }, box({
    driveTarget: input(45), driveMax: input(60), driveAccel: input(3), driveDecel: input(4),
    drivePoles: input(4), driveCurrent: input(5.5), driveSource: input('terminal')
  }));
  assert.equal(inverter.runtime.drive.targetHz, 45);
  assert.equal(inverter.runtime.drive.commandSource, 'terminal');
  assert.equal(inverter.driveConfig.commandHz, 45);
});
