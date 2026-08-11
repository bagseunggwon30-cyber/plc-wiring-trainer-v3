(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const DEVICE_CLASSES = ['runtime-output-on', 'runtime-coil-on', 'runtime-load-on', 'runtime-fault'];
  let currentRevision = null;
  let visualFrame = null;

  function clearDom() {
    document.querySelectorAll('[data-runtime-visual="1"]').forEach(element => {
      element.classList.remove(...DEVICE_CLASSES, 'runtime-contact-closed');
      element.removeAttribute('data-runtime-visual');
      element.removeAttribute('data-runtime-issue');
    });
    document.querySelectorAll('.runtime-state-badge').forEach(element => element.remove());
  }

  function deviceGroup(deviceId) {
    return [...document.querySelectorAll('#g-devices > g.device[data-id]')]
      .find(element => element.dataset.id === deviceId) || null;
  }

  function terminalMarkers(deviceId, terminalId) {
    return [...document.querySelectorAll('#g-terminals > g[data-id] .terminal[data-id][data-term]')]
      .filter(element => element.dataset.id === deviceId && element.dataset.term === terminalId);
  }

  function badge(group, label, faultCodes) {
    const root = document.createElementNS(SVGNS, 'g');
    root.setAttribute('class', `runtime-state-badge${faultCodes.length ? ' fault' : ''}`);
    root.setAttribute('aria-label', faultCodes.length ? `${label}: ${faultCodes.join(', ')}` : `${label}: 활성`);
    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('x', '6'); rect.setAttribute('y', '24'); rect.setAttribute('width', faultCodes.length ? '52' : '42'); rect.setAttribute('height', '17'); rect.setAttribute('rx', '8');
    const text = document.createElementNS(SVGNS, 'text');
    text.setAttribute('x', faultCodes.length ? '32' : '27'); text.setAttribute('y', '36'); text.setAttribute('text-anchor', 'middle');
    text.textContent = faultCodes.length ? 'FAULT' : label;
    const title = document.createElementNS(SVGNS, 'title');
    title.textContent = faultCodes.length ? faultCodes.join(', ') : `${label} 활성`;
    root.append(rect, text, title); group.appendChild(root);
  }

  function applyDevice(deviceId, activeClass, active, faultCodes, label) {
    const group = deviceGroup(deviceId);
    if (!group || (!active && !faultCodes.length)) return;
    group.dataset.runtimeVisual = '1';
    if (active) group.classList.add(activeClass);
    if (faultCodes.length) {
      group.classList.add('runtime-fault');
      group.dataset.runtimeIssue = faultCodes.join(',');
    }
    badge(group, label, faultCodes);
  }

  function normalizeFrame(value) {
    if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.workshopRevision)) return null;
    for (const key of ['plcDeviceId', 'relayDeviceId', 'lampDeviceId', 'plcOutputTerminalId']) if (typeof value[key] !== 'string' || !value[key]) return null;
    for (const key of ['plcOutputClosed', 'relayEnergized', 'lampEnergized']) if (typeof value[key] !== 'boolean') return null;
    const codes = key => Array.isArray(value[key]) ? value[key].filter(code => typeof code === 'string') : [];
    return {
      schemaVersion: 1,
      workshopRevision: value.workshopRevision,
      plcDeviceId: value.plcDeviceId,
      relayDeviceId: value.relayDeviceId,
      lampDeviceId: value.lampDeviceId,
      plcOutputTerminalId: value.plcOutputTerminalId,
      plcOutputClosed: value.plcOutputClosed,
      relayEnergized: value.relayEnergized,
      lampEnergized: value.lampEnergized,
      plcFaultCodes: codes('plcFaultCodes'),
      relayFaultCodes: codes('relayFaultCodes'),
      lampFaultCodes: codes('lampFaultCodes')
    };
  }

  function apply() {
    clearDom();
    if (!visualFrame || visualFrame.workshopRevision !== currentRevision) return false;
    applyDevice(visualFrame.plcDeviceId, 'runtime-output-on', visualFrame.plcOutputClosed, visualFrame.plcFaultCodes, 'P21');
    applyDevice(visualFrame.relayDeviceId, 'runtime-coil-on', visualFrame.relayEnergized, visualFrame.relayFaultCodes, 'COIL');
    applyDevice(visualFrame.lampDeviceId, 'runtime-load-on', visualFrame.lampEnergized, visualFrame.lampFaultCodes, 'LAMP');
    if (visualFrame.plcOutputClosed) {
      for (const terminal of terminalMarkers(visualFrame.plcDeviceId, visualFrame.plcOutputTerminalId)) {
        terminal.dataset.runtimeVisual = '1'; terminal.classList.add('runtime-contact-closed');
      }
    }
    return true;
  }

  function clear() {
    visualFrame = null;
    clearDom();
  }

  function setRevision(value) {
    currentRevision = Number.isInteger(value) ? value : null;
    clear();
  }

  window.addEventListener('xgsim-runtime-visual-frame', event => {
    const next = normalizeFrame(event.detail);
    if (!next || next.workshopRevision !== currentRevision) { clear(); return; }
    visualFrame = next; apply();
  });
  window.addEventListener('xgsim-runtime-visual-clear', clear);
  window.addEventListener('workshop-document-revision', event => setRevision(event.detail?.revision));
  window.addEventListener('workshop-document-replaced', event => setRevision(event.detail?.revision));

  try {
    const revision = window.LegacyTrainerBridge?.readState?.().revision;
    currentRevision = Number.isInteger(revision) ? revision : null;
  } catch (_) { currentRevision = null; }

  window.PLCTrainerRuntimeVisuals = Object.freeze({
    version: '1.0.0', apply, clear, normalizeFrame,
    getSnapshot: () => ({ currentRevision, frame: visualFrame ? { ...visualFrame } : null })
  });
  apply();
})();
