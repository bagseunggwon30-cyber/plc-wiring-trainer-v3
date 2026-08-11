(function (root) {
  'use strict';

  const MAX_PRESET = '3ds-max';
  const LEGACY_PRESET = 'legacy';

  function normalizePreset(value) {
    return value === LEGACY_PRESET ? LEGACY_PRESET : MAX_PRESET;
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function buttons(value, fallback) {
    return Array.isArray(value)
      ? value.map(Number).filter(Number.isInteger)
      : fallback;
  }

  function resolvePointerAction(event, preset, legacyMapping = {}) {
    const button = Number(event?.button);
    if (!Number.isInteger(button)) return null;
    if (normalizePreset(preset) === MAX_PRESET) {
      if (button !== 1) return null;
      return event?.altKey ? 'orbit' : 'pan';
    }
    const orbitButtons = buttons(legacyMapping.orbitButtons, [2]);
    const panButtons = buttons(legacyMapping.panButtons, [1]);
    if (orbitButtons.includes(button)) return 'orbit';
    if (panButtons.includes(button)) return 'pan';
    return null;
  }

  function orbitFromDrag(preset, start, delta, sensitivity = {}) {
    const isMax = normalizePreset(preset) === MAX_PRESET;
    const yawSign = isMax ? -1 : finite(sensitivity.legacyYawSign, 1);
    const pitchSign = isMax ? 1 : finite(sensitivity.legacyPitchSign, -1);
    return {
      yaw: finite(start?.yaw, 0) + finite(delta?.x, 0) * finite(sensitivity.yaw, 1) * yawSign,
      pitch: finite(start?.pitch, 0) + finite(delta?.y, 0) * finite(sensitivity.pitch, 1) * pitchSign,
    };
  }

  function hint(preset, legacyHint = '우클릭: 회전 · 가운데 드래그: 이동 · 휠: 확대/축소') {
    return normalizePreset(preset) === MAX_PRESET
      ? 'Alt+가운데 드래그: 회전 · 가운데 드래그: 이동 · 휠: 확대/축소'
      : legacyHint;
  }

  root.PLCTrainerCameraNavigation = Object.freeze({
    version: '1.0.0',
    presets: Object.freeze([MAX_PRESET, LEGACY_PRESET]),
    normalizePreset,
    resolvePointerAction,
    orbitFromDrag,
    hint,
  });
})(typeof window !== 'undefined' ? window : globalThis);
