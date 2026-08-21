(function installWorkbenchInspectorCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WorkbenchInspectorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkbenchInspectorCore() {
  'use strict';

  function endpointDevice(endpoint) {
    return String(endpoint?.dev ?? endpoint?.deviceId ?? '');
  }

  function endpointTerminal(endpoint) {
    return String(endpoint?.term ?? endpoint?.terminalId ?? '');
  }

  function resolveWireIds(refs, wires) {
    const orderedWires = Array.isArray(wires) ? wires : [];
    const values = [...new Set((Array.isArray(refs) ? refs : []).map(String))];
    const result = [];
    const add = (wireId) => {
      if (wireId && !result.includes(wireId)) result.push(wireId);
    };

    for (const ref of values) {
      const direct = orderedWires.find((wire) => String(wire?.id) === ref);
      if (direct) add(String(direct.id));
      const separator = ref.indexOf(':');
      const kind = separator > 0 ? ref.slice(0, separator) : '';
      const referencedWireId = separator > 0 ? ref.slice(separator + 1) : '';
      if (['conductor', 'wire', 'branch'].includes(kind)) {
        const referencedWire = orderedWires.find((wire) => String(wire?.id) === referencedWireId);
        if (referencedWire) add(String(referencedWire.id));
      }
    }

    for (const ref of values) {
      if (!ref.includes(':')) continue;
      const separator = ref.indexOf(':');
      if (['conductor', 'wire', 'branch'].includes(ref.slice(0, separator))) continue;
      let matched = false;
      for (const wire of orderedWires) {
        const endpoints = [wire?.from, wire?.to];
        if (endpoints.some((endpoint) => `${endpointDevice(endpoint)}:${endpointTerminal(endpoint)}` === ref)) {
          add(String(wire.id));
          matched = true;
        }
      }
      if (matched) continue;
      const deviceId = ref.slice(0, ref.lastIndexOf(':'));
      for (const wire of orderedWires) {
        if ([wire?.from, wire?.to].some((endpoint) => endpointDevice(endpoint) === deviceId)) add(String(wire.id));
      }
    }

    for (const ref of values) {
      if (ref.includes(':') || orderedWires.some((wire) => String(wire?.id) === ref)) continue;
      for (const wire of orderedWires) {
        if ([wire?.from, wire?.to].some((endpoint) => endpointDevice(endpoint) === ref)) add(String(wire.id));
      }
    }
    return result;
  }

  function boundsFromPoints(points) {
    const valid = (Array.isArray(points) ? points : []).filter((point) =>
      Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
    if (!valid.length) return null;
    const xs = valid.map((point) => Number(point.x));
    const ys = valid.map((point) => Number(point.y));
    const x1 = Math.min(...xs);
    const y1 = Math.min(...ys);
    const x2 = Math.max(...xs);
    const y2 = Math.max(...ys);
    return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
  }

  function viewportForBounds(bounds, viewport, options = {}) {
    if (!bounds) return null;
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    if (!(width > 0) || !(height > 0)) return null;
    const padding = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 80;
    const minZoom = Number.isFinite(Number(options.minZoom)) ? Number(options.minZoom) : 0.2;
    const maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : 2.2;
    const contentWidth = Math.max(1, Number(bounds.width) || Number(bounds.x2) - Number(bounds.x1));
    const contentHeight = Math.max(1, Number(bounds.height) || Number(bounds.y2) - Number(bounds.y1));
    const k = Math.max(minZoom, Math.min(maxZoom,
      width / (contentWidth + padding * 2),
      height / (contentHeight + padding * 2)));
    const centerX = (Number(bounds.x1) + Number(bounds.x2)) / 2;
    const centerY = (Number(bounds.y1) + Number(bounds.y2)) / 2;
    return {
      k,
      centerX,
      centerY,
      panX: width / 2 - k * centerX,
      panY: height / 2 - k * centerY,
    };
  }

  return Object.freeze({ resolveWireIds, boundsFromPoints, viewportForBounds });
});
