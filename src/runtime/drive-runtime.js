(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PLCTrainerDrive = api;
  root.PLCDriveRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    targetHz: 60,
    maxHz: 60,
    accelSec: 5,
    decelSec: 10,
    motorPoles: 4,
    commandSource: 'terminal',
    ratedCurrentA: 2.5
  });

  function clamp(value, min, max, fallback = min) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeParams(params = {}) {
    const maxHz = clamp(params.maxHz, 40, 400, DEFAULTS.maxHz);
    return {
      targetHz: clamp(params.targetHz ?? params.commandHz, 0, maxHz, DEFAULTS.targetHz),
      maxHz,
      accelSec: clamp(params.accelSec, 0.1, 6000, DEFAULTS.accelSec),
      decelSec: clamp(params.decelSec, 0.1, 6000, DEFAULTS.decelSec),
      motorPoles: Math.round(clamp(params.motorPoles, 2, 12, DEFAULTS.motorPoles)),
      ratedCurrentA: clamp(params.ratedCurrentA, 0.01, 1000, DEFAULTS.ratedCurrentA),
      commandSource: ['terminal', 'keypad', 'analog-v1', 'analog-i', 'rs485'].includes(params.commandSource)
        ? params.commandSource : DEFAULTS.commandSource
    };
  }

  function ensureRuntime(device) {
    if (!device.runtime) device.runtime = {};
    device.runtime.drive = normalizeParams({ ...(device.runtime.drive || {}), ...(device.driveConfig || {}) });
    device.driveConfig = { commandHz: device.runtime.drive.targetHz, ...device.runtime.drive };
    return device.runtime.drive;
  }

  function step(previous = {}, command = {}, params = {}, nowMs = Date.now()) {
    const p = normalizeParams(params);
    const lastAt = Number(previous.lastAtMs) || nowMs;
    const dt = Math.max(0, Math.min(1, (nowMs - lastAt) / 1000));
    let currentHz = clamp(previous.currentHz, 0, p.maxHz, 0);
    let direction = previous.direction || 'stop';
    const requestedDirection = !command.powered || command.conflict ? 'stop' : command.forward ? 'forward' : command.reverse ? 'reverse' : 'stop';
    let requestedHz = requestedDirection === 'stop' ? 0 : p.targetHz;
    let reversing = false;

    if (direction !== 'stop' && requestedDirection !== 'stop' && direction !== requestedDirection && currentHz > 0.01) {
      requestedHz = 0;
      reversing = true;
    }

    if (requestedHz > currentHz) {
      const rate = p.maxHz / p.accelSec;
      currentHz = Math.min(requestedHz, currentHz + rate * dt);
    } else if (requestedHz < currentHz) {
      const rate = p.maxHz / p.decelSec;
      currentHz = Math.max(requestedHz, currentHz - rate * dt);
    }

    if (currentHz <= 0.01) {
      currentHz = 0;
      direction = requestedDirection;
    } else if (direction === 'stop') {
      direction = requestedDirection;
    }

    const running = !command.conflict && currentHz > 0.01 && direction !== 'stop';
    const synchronousRpm = running ? (120 * currentHz) / p.motorPoles : 0;
    const currentA = running ? +(p.ratedCurrentA * Math.max(0.08, currentHz / Math.max(p.maxHz, 0.01))).toFixed(3) : 0;
    return {
      powered: !!command.powered,
      forward: !!command.forward,
      reverse: !!command.reverse,
      conflict: !!command.conflict,
      fault: command.conflict ? 'direction-conflict' : null,
      commandActive: requestedDirection !== 'stop',
      reversing,
      running,
      direction: running ? direction : (requestedDirection === 'stop' ? 'stop' : direction),
      targetHz: p.targetHz,
      currentHz,
      frequencyHz: currentHz,
      maxHz: p.maxHz,
      accelSec: p.accelSec,
      decelSec: p.decelSec,
      motorPoles: p.motorPoles,
      ratedCurrentA: p.ratedCurrentA,
      rpm: Math.round(synchronousRpm),
      speedRpm: Math.round(synchronousRpm),
      currentA,
      lastAtMs: nowMs
    };
  }

  return { version: '1.0.0', DEFAULTS, normalizeParams, ensureRuntime, step };
});
