(function initDevicePackRegistry(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PLCDevicePacks = api;
})(typeof window !== 'undefined' ? window : globalThis, function createRegistry() {
  'use strict';

  const packs = [];
  const installed = new Set();

  function assert(condition, message) {
    if (!condition) throw new Error(`Device pack error: ${message}`);
  }

  function validateTerminal(type, terminal, seen) {
    assert(terminal && typeof terminal.id === 'string' && terminal.id.length > 0, `${type}: terminal id is required`);
    assert(!seen.has(terminal.id), `${type}: duplicate terminal ${terminal.id}`);
    seen.add(terminal.id);
    assert(Number.isFinite(Number(terminal.x)) && Number.isFinite(Number(terminal.y)), `${type}.${terminal.id}: terminal coordinates are invalid`);
  }

  function validateDevice(type, definition) {
    assert(definition && typeof definition === 'object', `${type}: definition is required`);
    assert(typeof definition.label === 'string' && definition.label.length > 0, `${type}: label is required`);
    assert(Number(definition.w) > 0 && Number(definition.h) > 0, `${type}: width and height are required`);
    const seen = new Set();
    for (const terminal of definition.terminals || []) validateTerminal(type, terminal, seen);
    return true;
  }

  function validatePack(pack) {
    assert(pack && typeof pack === 'object', 'pack object is required');
    assert(typeof pack.id === 'string' && pack.id.length > 0, 'pack id is required');
    assert(pack.devices && typeof pack.devices === 'object', `${pack.id}: devices object is required`);
    for (const [type, definition] of Object.entries(pack.devices)) validateDevice(type, definition);
    return true;
  }

  function register(pack) {
    validatePack(pack);
    const index = packs.findIndex(item => item.id === pack.id);
    if (index >= 0) packs[index] = pack;
    else packs.push(pack);
    return pack;
  }

  function installAll(library, options = {}) {
    assert(library && typeof library === 'object', 'target library is required');
    const report = { packs: [], devices: [], replaced: [], skipped: [], errors: [] };
    for (const pack of packs) {
      if (installed.has(pack.id) && !options.force) continue;
      try {
        for (const [type, definition] of Object.entries(pack.devices)) {
          if (library[type] && options.replaceExisting === false) {
            report.skipped.push(type);
            continue;
          }
          if (library[type]) report.replaced.push(type);
          library[type] = { ...library[type], ...definition, packId: pack.id, packVersion: pack.version || '1' };
          report.devices.push(type);
        }
        installed.add(pack.id);
        report.packs.push(pack.id);
      } catch (error) {
        report.errors.push({ pack: pack.id, message: error.message });
      }
    }
    return report;
  }

  function list() {
    return packs.map(pack => ({ id: pack.id, version: pack.version || '1', deviceTypes: Object.keys(pack.devices) }));
  }

  function resetInstallState() {
    installed.clear();
  }

  return { register, installAll, validatePack, list, resetInstallState };
});
