(function initRackRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PLCTrainerRack = api;
  root.PLCRackRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRackRuntime() {
  'use strict';

  const DEFAULTS = Object.freeze({
    family: 'LS-XGB',
    maxSlots: 10,
    maxCommunication: 2,
    maxHighSpeed: 2,
    pointsPerSlot: 64,
    wordsPerSlot: 4,
    yTolerance: 150,
    maxAttachDistance: 1800,
    leftTolerance: 40
  });

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const scaleOf = device => Math.max(0.05, number(device?.scale, 1));
  const centerY = (device, definition) => number(device?.y) + number(definition?.h) * scaleOf(device) / 2;
  const rightX = (device, definition) => number(device?.x) + number(definition?.w) * scaleOf(device);

  function cpuMeta(definition) {
    if (definition?.rackCpu) return definition.rackCpu;
    if (definition?.rack?.role === 'host') return definition.rack;
    return null;
  }
  function moduleMeta(definition) {
    if (definition?.rackModule) return definition.rackModule;
    if (definition?.rack?.role === 'module') return definition.rack;
    return null;
  }
  function compatible(hostDef, moduleDef) {
    const host = cpuMeta(hostDef), module = moduleMeta(moduleDef);
    return !!host && !!module && (host.family || DEFAULTS.family) === (module.family || DEFAULTS.family);
  }

  /*
   * XGB P address notation is word + hexadecimal bit:
   * slot 0 CPU input P0000..P001F, CPU output P0020..P003F,
   * expansion slot 1 P0040..P007F, slot 2 P0080..P011F, ...
   */
  function pAddressFromPoint(point) {
    const safe = Math.max(0, Math.trunc(number(point)));
    const word = Math.floor(safe / 16);
    const bit = (safe % 16).toString(16).toUpperCase();
    return `P${String(word).padStart(3, '0')}${bit}`;
  }
  function slotPointBase(slot, wordsPerSlot = DEFAULTS.wordsPerSlot) {
    return Math.max(0, Math.trunc(number(slot))) * Math.max(1, Math.trunc(number(wordsPerSlot, DEFAULTS.wordsPerSlot))) * 16;
  }
  function slotRange(slot, meta = {}) {
    const points = Math.max(1, Math.trunc(number(meta.pointsPerSlot || meta.occupiedPoints, DEFAULTS.pointsPerSlot)));
    const startPoint = slotPointBase(slot, meta.wordsPerSlot || DEFAULTS.wordsPerSlot);
    return {
      startPoint,
      endPoint: startPoint + points - 1,
      start: pAddressFromPoint(startPoint),
      end: pAddressFromPoint(startPoint + points - 1),
      text: `${pAddressFromPoint(startPoint)}~${pAddressFromPoint(startPoint + points - 1)}`
    };
  }
  function collectTerms(definition, groupName, fieldName) {
    const out = [];
    for (const group of definition?.[groupName] || []) {
      for (const terminal of group?.[fieldName] || []) if (!out.includes(terminal)) out.push(terminal);
    }
    return out;
  }
  function terminalBindings(definition, slot, meta = {}) {
    const inputs = collectTerms(definition, 'inputGroups', 'inputs');
    const outputs = collectTerms(definition, 'outputGroups', 'outputs');
    const base = slotPointBase(slot, meta.wordsPerSlot || DEFAULTS.wordsPerSlot);
    const mixed = inputs.length > 0 && outputs.length > 0;
    const inputOffset = Math.max(0, Math.trunc(number(meta.inputOffset, 0)));
    const outputOffset = Math.max(0, Math.trunc(number(meta.outputOffset, mixed ? 16 : 0)));
    return {
      inputs: inputs.map((terminal, index) => ({ terminal, index, point: base + inputOffset + index, address: pAddressFromPoint(base + inputOffset + index), direction: 'input' })),
      outputs: outputs.map((terminal, index) => ({ terminal, index, point: base + outputOffset + index, address: pAddressFromPoint(base + outputOffset + index), direction: 'output' }))
    };
  }
  function ioBindings(definition, slot, options = {}) {
    const host = cpuMeta(definition), module = moduleMeta(definition);
    const meta = host || module || {};
    const isCpu = !!host || slot === 0;
    const pRange = isCpu
      ? { startPoint: 0, endPoint: 63, start: 'P0000', end: 'P003F', text: 'P0000~P003F' }
      : slotRange(slot, meta);
    let terms;
    if (isCpu) {
      const inputs = collectTerms(definition, 'inputGroups', 'inputs');
      const outputs = collectTerms(definition, 'outputGroups', 'outputs');
      const inputBase = Math.trunc(number(meta.inputPointBase, 0));
      const outputBase = Math.trunc(number(meta.outputPointBase, 32));
      terms = {
        inputs: inputs.map((terminal, index) => ({ terminal, index, point: inputBase + index, address: pAddressFromPoint(inputBase + index), direction: 'input' })),
        outputs: outputs.map((terminal, index) => ({ terminal, index, point: outputBase + index, address: pAddressFromPoint(outputBase + index), direction: 'output' }))
      };
    } else {
      terms = terminalBindings(definition, slot, meta);
    }
    const terminalMap = {};
    for (const item of [...terms.inputs, ...terms.outputs]) terminalMap[item.terminal] = item.address;
    return {
      namespace: 'XG5000-P-preview',
      slot,
      pRange: pRange.text,
      pStart: pRange.start,
      pEnd: pRange.end,
      inputs: terms.inputs,
      outputs: terms.outputs,
      terminalMap,
      occupiedPoints: isCpu ? 64 : Math.max(DEFAULTS.pointsPerSlot, Math.trunc(number(meta.occupiedPoints, DEFAULTS.pointsPerSlot))),
      specialBase: !isCpu && (meta.moduleClass === 'special' || meta.moduleClass === 'communication' || meta.moduleClass === 'highSpeed' || meta.specialBase) ? `U0.${slot}` : null,
      uPrefix: !isCpu && (meta.moduleClass === 'special' || meta.moduleClass === 'communication' || meta.moduleClass === 'highSpeed' || meta.specialBase) ? `U0.${slot}` : null
    };
  }

  function detach(device, reason = 'unattached') {
    delete device.rackHostId;
    delete device.rackSlot;
    delete device.ioBinding;
    device.rackStatus = reason;
  }
  function hostCandidate(module, moduleDef, hostId, host, hostDef, config) {
    if (!compatible(hostDef, moduleDef)) return null;
    if (host.railId && module.railId && host.railId !== module.railId) return null;
    const dx = number(module.x) - rightX(host, hostDef);
    if (dx < -config.leftTolerance || dx > config.maxAttachDistance) return null;
    const dy = Math.abs(centerY(host, hostDef) - centerY(module, moduleDef));
    if (dy > config.yTolerance) return null;
    return { hostId, host, hostDef, dx, dy, score: Math.max(0, dx) + dy * 2 };
  }
  function explicitHostId(module, devices, library, moduleDef) {
    const requested = module?.runtime?.rack?.rackId || module?.rackId || null;
    if (!requested || !devices?.[requested]) return null;
    return compatible(library?.[devices[requested].type], moduleDef) ? requested : null;
  }
  function requestedSlot(module) {
    const value = module?.runtime?.rack?.slot ?? module?.slot;
    const slot = Number(value);
    return Number.isInteger(slot) && slot > 0 ? slot : null;
  }

  function reconcile(devices, library, options = {}) {
    const config = { ...DEFAULTS, ...options };
    const entries = Object.entries(devices || {});
    const hosts = entries.filter(([, device]) => !!cpuMeta(library?.[device.type]));
    const modules = entries.filter(([, device]) => !!moduleMeta(library?.[device.type]));
    const summary = { version: 2, racks: [], unattached: [], errors: [], assignments: {}, assignedCount: 0 };

    for (const [, module] of modules) detach(module);
    const assignments = new Map(hosts.map(([id]) => [id, []]));
    for (const [moduleId, module] of modules) {
      const moduleDef = library[module.type];
      const requestedRack = module?.runtime?.rack?.rackId || module?.rackId || null;
      const explicit = explicitHostId(module, devices, library, moduleDef);
      if (explicit) {
        assignments.get(explicit).push([moduleId, module, true]);
        continue;
      }
      if (requestedRack) {
        detach(module, 'rack-not-found');
        continue;
      }
      const candidates = hosts
        .map(([hostId, host]) => hostCandidate(module, moduleDef, hostId, host, library[host.type], config))
        .filter(Boolean)
        .sort((a, b) => a.score - b.score || a.hostId.localeCompare(b.hostId));
      if (candidates.length) assignments.get(candidates[0].hostId).push([moduleId, module, false]);
    }

    for (const [hostId, host] of hosts) {
      const hostDef = library[host.type];
      const meta = cpuMeta(hostDef);
      const maxSlots = Math.max(1, Math.trunc(number(meta.maxSlots || meta.maxExpansion, config.maxSlots)));
      const maxCommunication = Math.max(0, Math.trunc(number(meta.maxCommunication, config.maxCommunication)));
      const maxHighSpeed = Math.max(0, Math.trunc(number(meta.maxHighSpeed, config.maxHighSpeed)));
      host.rackHostId = hostId;
      host.rackId = hostId;
      host.rackSlot = 0;
      host.rackStatus = 'host';
      host.ioBinding = ioBindings(hostDef, 0);
      summary.assignments[hostId] = { rackId: hostId, hostId, slot: 0, pRange: host.ioBinding.pRange, ioBinding: host.ioBinding };

      const candidates = (assignments.get(hostId) || []).sort((a, b) => number(a[1].x) - number(b[1].x) || a[0].localeCompare(b[0]));
      const occupied = new Map();
      const pending = [];
      const rackErrors = [];
      for (const entry of candidates) {
        const slot = requestedSlot(entry[1]);
        if (!slot) { pending.push(entry); continue; }
        if (slot > maxSlots) {
          detach(entry[1], 'slot-overflow');
          rackErrors.push(`${entry[1].type}: 지정 슬롯 ${slot}이 최대 ${maxSlots}를 초과`);
          continue;
        }
        if (occupied.has(slot)) {
          detach(entry[1], 'slot-duplicate');
          rackErrors.push(`슬롯 ${slot} 중복 지정: ${occupied.get(slot)[1].type}, ${entry[1].type}`);
          continue;
        }
        occupied.set(slot, entry);
      }
      const freeSlots = [];
      for (let slot = 1; slot <= maxSlots; slot += 1) if (!occupied.has(slot)) freeSlots.push(slot);
      for (const entry of pending) {
        const slot = freeSlots.shift();
        if (!slot) { detach(entry[1], 'slot-overflow'); continue; }
        occupied.set(slot, entry);
      }

      const rack = { hostId, hostType: host.type, family: meta.family || config.family, maxSlots, maxCommunication, maxHighSpeed, modules: [], errors: rackErrors };
      const counters = { communication: 0, highSpeed: 0 };
      for (const [slot, [moduleId, module]] of [...occupied.entries()].sort((a, b) => a[0] - b[0])) {
        const def = library[module.type], modMeta = moduleMeta(def) || {};
        const moduleClass = modMeta.moduleClass || 'io';
        if (moduleClass === 'communication') counters.communication += 1;
        if (moduleClass === 'highSpeed') counters.highSpeed += 1;
        module.rackHostId = hostId;
        module.rackId = hostId;
        module.rackSlot = slot;
        module.slot = slot;
        module.rackStatus = 'attached';
        module.ioBinding = ioBindings(def, slot);
        const assignment = { rackId: hostId, hostId, slot, type: module.type, moduleClass, pRange: module.ioBinding.pRange, uPrefix: module.ioBinding.uPrefix, ioBinding: module.ioBinding };
        rack.modules.push({ id: moduleId, ...assignment });
        summary.assignments[moduleId] = assignment;
        summary.assignedCount += 1;
      }
      if (candidates.length > maxSlots) rack.errors.push(`확장 모듈 ${candidates.length}대: 최대 ${maxSlots}슬롯 초과`);
      if (counters.communication > maxCommunication) rack.errors.push(`통신 모듈 ${counters.communication}대: 최대 ${maxCommunication}대 초과`);
      if (counters.highSpeed > maxHighSpeed) rack.errors.push(`고속/위치결정 모듈 ${counters.highSpeed}대: 최대 ${maxHighSpeed}대 초과`);
      for (const message of [...new Set(rack.errors)]) summary.errors.push({ hostId, message });
      rack.errors = [...new Set(rack.errors)];
      summary.racks.push(rack);
    }

    for (const [moduleId, module] of modules) {
      if (!module.rackHostId) summary.unattached.push({ id: moduleId, type: module.type, reason: module.rackStatus || 'unattached' });
    }
    return summary;
  }

  function terminalAddress(device, terminalId) {
    return device?.ioBinding?.terminalMap?.[terminalId] || null;
  }
  function badge(device) {
    if (device?.rackSlot === 0) return `BASE · ${device?.ioBinding?.pRange || 'P0000~P003F'}`;
    if (!Number.isInteger(device?.rackSlot)) return device?.rackStatus === 'slot-overflow' ? 'RACK FULL' : '';
    const binding = device.ioBinding || {};
    return `S${device.rackSlot} · ${binding.pRange || ''}${binding.uPrefix ? ` · ${binding.uPrefix}` : ''}`.trim();
  }
  function validate(summary, options = {}) {
    const issues = [];
    const defaultCategory = options.unattachedCategory || 'quality';
    for (const item of summary?.unattached || []) {
      issues.push({
        category: ['slot-overflow', 'slot-duplicate', 'rack-not-found'].includes(item.reason) ? 'function' : defaultCategory,
        msg: `${item.type} 확장 모듈이 호환 CPU 랙에 장착되지 않았습니다${item.reason === 'slot-overflow' ? ' (슬롯 초과)' : item.reason === 'slot-duplicate' ? ' (슬롯 중복)' : item.reason === 'rack-not-found' ? ' (지정 CPU 없음/비호환)' : ''}.`,
        dev: item.id
      });
    }
    for (const error of summary?.errors || []) issues.push({ category: 'function', msg: error.message, dev: error.hostId });
    return issues;
  }

  return {
    version: '2.0.0', DEFAULTS, cpuMeta, moduleMeta, compatible,
    pAddressFromPoint, slotPointBase, slotRange, ioBindings, reconcile,
    terminalAddress, badge, validate
  };
});
