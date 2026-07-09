(function attachSafetyPolicy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LegacySafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSafetyPolicy() {
  const PUBLIC_MISSION_IDS = Object.freeze(['g2', 'g3', 'g4', 'g5', 'g6', 'g10', 'g13']);
  const publicMissionSet = new Set(PUBLIC_MISSION_IDS);

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function isPublishedMission(id) {
    return publicMissionSet.has(id);
  }

  function hasBlockingIssues(issues) {
    return (issues || []).some(issue => issue?.category === 'danger' || issue?.category === 'function');
  }

  function captureLegacyState(state) {
    return clone({
      devices: state.devices,
      wires: state.wires,
      nextId: state.nextId,
      history: state.history,
      future: state.future,
    });
  }

  function restoreLegacyState(state, snapshot) {
    state.devices = clone(snapshot.devices);
    state.wires = clone(snapshot.wires);
    state.nextId = snapshot.nextId;
    state.history = clone(snapshot.history);
    state.future = clone(snapshot.future);
  }

  return {
    PUBLIC_MISSION_IDS,
    isPublishedMission,
    hasBlockingIssues,
    captureLegacyState,
    restoreLegacyState,
  };
});

