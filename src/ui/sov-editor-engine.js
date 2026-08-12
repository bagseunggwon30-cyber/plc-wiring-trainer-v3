(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PLCTrainerSovEditorEngine = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  const MODES = Object.freeze({
    CONTROL: 'CONTROL',
    MOVE: 'MOVE',
    WIRE: 'WIRE',
    AIR: 'AIR',
    DELETE_WIRE: 'DELETE_WIRE',
    DELETE_MODULE: 'DELETE_MODULE'
  });
  const LABS = Object.freeze(['servo2', 'mps', 'pneumatic', 'discrete', 'workbench3d']);
  const MODE_ALLOWANCES = Object.freeze({
    servo2: Object.freeze([MODES.CONTROL, MODES.WIRE, MODES.DELETE_WIRE]),
    mps: Object.freeze([MODES.CONTROL, MODES.WIRE, MODES.DELETE_WIRE]),
    pneumatic: Object.freeze(Object.values(MODES)),
    discrete: Object.freeze([MODES.CONTROL, MODES.MOVE, MODES.WIRE, MODES.DELETE_WIRE, MODES.DELETE_MODULE]),
    workbench3d: Object.freeze([MODES.CONTROL, MODES.WIRE, MODES.DELETE_WIRE])
  });
  const HOTKEYS = Object.freeze({
    Digit1: MODES.CONTROL, Numpad1: MODES.CONTROL,
    Digit2: MODES.MOVE, Numpad2: MODES.MOVE,
    Digit3: MODES.DELETE_MODULE, Numpad3: MODES.DELETE_MODULE,
    Digit4: MODES.WIRE, Numpad4: MODES.WIRE,
    Digit5: MODES.AIR, Numpad5: MODES.AIR,
    Digit6: MODES.DELETE_WIRE, Numpad6: MODES.DELETE_WIRE,
    Escape: 'CANCEL'
  });
  const SCHEMA_VERSION = 1;
  const ID_LIMIT = 128;

  function editableTarget(target) {
    return !!target?.closest?.('input,textarea,select,button,[contenteditable]:not([contenteditable="false"])');
  }

  function hotkeyAction(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey || editableTarget(event.target)) return null;
    return HOTKEYS[event.code] || (event.key === 'Escape' ? 'CANCEL' : null);
  }

  function normalizeId(value, label) {
    const id = String(value ?? '').trim();
    if (!id || id.length > ID_LIMIT || id.includes('::')) throw new TypeError(`${label} must be 1-${ID_LIMIT} characters and cannot contain ::`);
    return id;
  }

  function normalizeLab(value) {
    const lab = String(value || '').toLowerCase();
    if (!LABS.includes(lab)) throw new RangeError(`Unsupported lab: ${value}`);
    return lab;
  }

  function normalizeMode(value) {
    const mode = String(value || '').toUpperCase();
    if (!Object.values(MODES).includes(mode)) throw new RangeError(`Unsupported editor mode: ${value}`);
    return mode;
  }

  function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
    return number;
  }

  function finiteTuple(value, length, label) {
    if (!Array.isArray(value) || value.length !== length) throw new TypeError(`${label} must contain ${length} numbers`);
    return value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
  }

  function connectionKey(moduleId, anchorId) { return `${moduleId}::${anchorId}`; }

  function normalizeRouting(value) {
    const style = typeof value === 'string' ? value : value?.style;
    if (style == null || style === '' || style === 'auto') return Object.freeze({ style: 'auto' });
    if (style === 'terminal-panel') return Object.freeze({ style: 'terminal-panel' });
    throw new RangeError(`Unsupported connection routing style: ${style}`);
  }

  function createAnchorHitTarget(options = {}) {
    const Three = options.three || root?.THREE;
    if (!Three?.Mesh || !Three?.SphereGeometry || !Three?.MeshBasicMaterial) throw new Error('A compatible THREE namespace is required');
    const radius = Math.max(.001, finiteNumber(options.radius ?? .012, 'anchor hit radius'));
    const target = new Three.Mesh(
      new Three.SphereGeometry(radius, 12, 8),
      new Three.MeshBasicMaterial({
        color: options.color ?? 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false
      })
    );
    target.name = options.name || 'sov-terminal-hole-hit-target';
    target.userData.sovAnchorHitTarget = true;
    return target;
  }

  class EditorEngine {
    constructor(options = {}) {
      this.THREE = options.three || root?.THREE;
      if (!this.THREE?.Group || !this.THREE?.Vector3 || !this.THREE?.Ray) throw new Error('A compatible THREE namespace is required');
      this.lab = normalizeLab(options.lab || 'pneumatic');
      const initialMode = options.mode == null ? MODES.CONTROL : normalizeMode(options.mode);
      this.mode = MODE_ALLOWANCES[this.lab].includes(initialMode) ? initialMode : MODES.CONTROL;
      this.gridSize = Math.max(0, finiteNumber(options.gridSize ?? .05, 'gridSize'));
      this.modules = new Map();
      this.anchors = new Map();
      this.connections = new Map();
      this.pendingConnection = null;
      this.pendingMove = null;
      this.listeners = new Map();
      this.callbacks = options.callbacks && typeof options.callbacks === 'object' ? options.callbacks : {};
      this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
      this.canConnect = typeof options.canConnect === 'function' ? options.canConnect : null;
      this.connectionRoot = options.connectionRoot || new this.THREE.Group();
      this.connectionRoot.name ||= 'sov-editor-connections';
      this.previewRoot = new this.THREE.Group(); this.previewRoot.name = 'sov-editor-preview'; this.connectionRoot.add(this.previewRoot);
      this.ownsConnectionRoot = !options.connectionRoot;
      if (options.scene && this.connectionRoot.parent !== options.scene) options.scene.add(this.connectionRoot);
      this.colors = {
        electric: options.electricColor ?? 0x31b7ff,
        optical: options.opticalColor ?? 0xd86cff,
        air: options.airColor ?? 0x50d4ef,
        preview: options.previewColor ?? 0xffd15a
      };
      this.tubeRadius = Math.max(.001, finiteNumber(options.tubeRadius ?? .018, 'tubeRadius'));
      this.solidElectricWires = options.solidElectricWires === true;
      this.wireRadius = Math.max(.0005, finiteNumber(options.wireRadius ?? .004, 'wireRadius'));
      this.connectionCounter = 0;
      this.hotkeyDetachers = new Set();
      this.disposed = false;
      this._up = new this.THREE.Vector3(0, 1, 0);
    }

    getAllowedModes(lab = this.lab) { return [...MODE_ALLOWANCES[normalizeLab(lab)]]; }
    isModeAllowed(mode, lab = this.lab) { return MODE_ALLOWANCES[normalizeLab(lab)].includes(normalizeMode(mode)); }

    on(type, listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      const key = String(type); if (!this.listeners.has(key)) this.listeners.set(key, new Set()); this.listeners.get(key).add(listener);
      return () => this.off(key, listener);
    }

    off(type, listener) { return this.listeners.get(String(type))?.delete(listener) || false; }

    _emit(type, detail = {}) {
      const event = Object.freeze({ type, ...detail });
      const invoke = listener => { try { listener(event); } catch (error) { setTimeout(() => { throw error; }, 0); } };
      if (typeof this.callbacks[type] === 'function') invoke(this.callbacks[type]);
      if (this.onEvent) invoke(this.onEvent);
      for (const listener of this.listeners.get(type) || []) invoke(listener);
      for (const listener of this.listeners.get('*') || []) invoke(listener);
      return event;
    }

    _change(reason, detail = {}) { this._emit('change', { reason, ...detail }); }

    setLab(lab) {
      const next = normalizeLab(lab); if (next === this.lab) return true;
      const previous = this.lab; this.cancel('lab-change'); this.lab = next;
      if (!MODE_ALLOWANCES[next].includes(this.mode)) this.mode = MODES.CONTROL;
      this._emit('labchange', { lab: next, previous, mode: this.mode }); return true;
    }

    setMode(mode) {
      const next = normalizeMode(mode);
      if (!MODE_ALLOWANCES[this.lab].includes(next)) { this._emit('moderejected', { lab: this.lab, mode: next }); return false; }
      if (next === this.mode) return true;
      const previous = this.mode; this.cancel('mode-change'); this.mode = next; this._emit('modechange', { mode: next, previous, lab: this.lab }); return true;
    }

    handleHotkey(event) {
      const action = hotkeyAction(event); if (!action) return false;
      if (action === 'CANCEL') { this.cancel('escape'); event.preventDefault?.(); return true; }
      const accepted = this.setMode(action); if (accepted) event.preventDefault?.(); return accepted;
    }

    attachHotkeys(target = root?.document) {
      if (!target?.addEventListener) throw new TypeError('A keyboard event target is required');
      const handler = event => this.handleHotkey(event); target.addEventListener('keydown', handler);
      const detach = () => { target.removeEventListener('keydown', handler); this.hotkeyDetachers.delete(detach); };
      this.hotkeyDetachers.add(detach); return detach;
    }

    _vector(value, label = 'position') {
      if (value?.isVector3) return value.clone();
      if (Array.isArray(value)) return new this.THREE.Vector3(...finiteTuple(value, 3, label));
      if (value && typeof value === 'object') return new this.THREE.Vector3(finiteNumber(value.x, `${label}.x`), finiteNumber(value.y, `${label}.y`), finiteNumber(value.z, `${label}.z`));
      throw new TypeError(`${label} must be a THREE.Vector3, [x,y,z], or {x,y,z}`);
    }

    _anchorDescriptors(descriptor) {
      const anchors = descriptor.anchors || {};
      if (Array.isArray(anchors)) return anchors.map(item => ({ ...item, kind: item.kind || item.type }));
      return [
        ...(anchors.electric || descriptor.electricAnchors || []).map(item => ({ ...item, kind: 'electric' })),
        ...(anchors.optical || descriptor.opticalAnchors || []).map(item => ({ ...item, kind: 'optical' })),
        ...(anchors.air || descriptor.airAnchors || []).map(item => ({ ...item, kind: 'air' }))
      ];
    }

    registerModule(descriptor) {
      if (!descriptor || typeof descriptor !== 'object') throw new TypeError('module descriptor is required');
      const id = normalizeId(descriptor.id, 'module id'); if (this.modules.has(id)) throw new Error(`Module already registered: ${id}`);
      const lab = normalizeLab(descriptor.lab || this.lab), object = descriptor.object;
      if (!object?.isObject3D || !object.position || !object.updateMatrixWorld) throw new TypeError('module object must be a THREE.Object3D');
      const module = {
        id, lab, object, movable: descriptor.movable !== false,
        removeObjectOnDelete: descriptor.removeObjectOnDelete !== false,
        tag: descriptor.tag == null ? null : String(descriptor.tag), anchors: new Map(), metadata: descriptor.metadata
      };
      for (const item of this._anchorDescriptors(descriptor)) {
        const anchorId = normalizeId(item.id, `anchor id for ${id}`), kind = String(item.kind || '').toLowerCase();
        if (!['electric', 'optical', 'air'].includes(kind)) throw new RangeError(`Anchor ${id}:${anchorId} must be electric, optical, or air`);
        if (module.anchors.has(anchorId)) throw new Error(`Duplicate anchor: ${id}:${anchorId}`);
        const anchorObject = item.object || object;
        if (!anchorObject?.isObject3D || !anchorObject.localToWorld) throw new TypeError(`Anchor ${id}:${anchorId} object must be a THREE.Object3D`);
        const anchor = {
          id: anchorId, moduleId: id, kind, object: anchorObject,
          localPosition: this._vector(item.localPosition ?? item.position ?? [0, 0, 0], `anchor ${id}:${anchorId} position`),
          tag: item.tag == null ? anchorId : String(item.tag), connectionId: null, metadata: item.metadata
        };
        module.anchors.set(anchorId, anchor); this.anchors.set(connectionKey(id, anchorId), anchor);
      }
      this.modules.set(id, module); this._emit('moduleregistered', { module: this.moduleInfo(id) }); this._change('module-register', { moduleId: id }); return module;
    }

    moduleInfo(id) {
      const module = this.modules.get(String(id)); if (!module) return null;
      return { id: module.id, lab: module.lab, movable: module.movable, tag: module.tag, anchors: [...module.anchors.values()].map(anchor => ({ id: anchor.id, kind: anchor.kind, tag: anchor.tag, connected: !!anchor.connectionId })) };
    }

    _resolveAnchor(reference) {
      if (typeof reference === 'string') {
        const anchor = this.anchors.get(reference); if (anchor) return anchor;
        throw new Error(`Unknown anchor: ${reference}`);
      }
      const moduleId = normalizeId(reference?.moduleId, 'anchor moduleId'), anchorId = normalizeId(reference?.anchorId ?? reference?.id, 'anchor id');
      const anchor = this.anchors.get(connectionKey(moduleId, anchorId)); if (!anchor) throw new Error(`Unknown anchor: ${moduleId}:${anchorId}`); return anchor;
    }

    anchorWorldPosition(reference) {
      const anchor = this._resolveAnchor(reference); anchor.object.updateWorldMatrix(true, false); return anchor.object.localToWorld(anchor.localPosition.clone());
    }

    _connectionLocal(world) {
      this.connectionRoot.updateWorldMatrix(true, false); return this.connectionRoot.worldToLocal(world.clone());
    }

    _createVisual(kind, preview = false, options = {}) {
      const color = options.color ?? (preview ? this.colors.preview : this.colors[kind]);
      if (kind === 'electric' || kind === 'optical') {
        if (this.solidElectricWires) {
          const start = new this.THREE.Vector3(), end = new this.THREE.Vector3(0, .0001, 0);
          const geometry = new this.THREE.TubeGeometry(new this.THREE.LineCurve3(start, end), 1, options.radius || this.wireRadius, 8, false);
          const material = new this.THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: preview ? .35 : .12,
            roughness: .38,
            metalness: .04,
            transparent: preview,
            opacity: preview ? .78 : 1,
            depthWrite: !preview
          });
          const cable = new this.THREE.Mesh(geometry, material);
          cable.userData.sovEditorVisual = 'cable';
          cable.userData.sovEditorRouting = normalizeRouting(options.routing);
          cable.userData.sovWireRadius = options.radius || this.wireRadius;
          return cable;
        }
        const geometry = new this.THREE.BufferGeometry().setFromPoints(Array.from({ length: 6 }, () => new this.THREE.Vector3()));
        const material = new this.THREE.LineBasicMaterial({ color, transparent: preview, opacity: preview ? .72 : 1 });
        const line = new this.THREE.Line(geometry, material); line.userData.sovEditorVisual = 'line'; line.userData.sovEditorRouting = normalizeRouting(options.routing); return line;
      }
      const geometry = new this.THREE.CylinderGeometry(options.radius || this.tubeRadius, options.radius || this.tubeRadius, 1, 6, 1, true);
      const material = new this.THREE.MeshBasicMaterial({ color, transparent: preview, opacity: preview ? .66 : .9 });
      const tube = new this.THREE.Mesh(geometry, material); tube.userData.sovEditorVisual = 'tube'; return tube;
    }

    _updateVisual(visual, worldA, worldB) {
      const a = this._connectionLocal(worldA), b = this._connectionLocal(worldB);
      if (visual.userData.sovEditorVisual === 'line' || visual.userData.sovEditorVisual === 'cable') {
        const id = String(visual.userData.connectionId || 'preview'); let hash = 0; for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
        const terminalPanel = visual.userData.sovEditorRouting?.style === 'terminal-panel';
        const lane = terminalPanel ? hash % 8 : hash % 9;
        const routeY = Math.max(a.y, b.y) + (terminalPanel ? .018 + lane * .002 : .12 + lane * .018);
        const routeZ = Math.max(a.z, b.z) + (terminalPanel ? .010 + lane * .003 : .10 + lane * .024);
        const points = [a, new this.THREE.Vector3(a.x, routeY, a.z), new this.THREE.Vector3(a.x, routeY, routeZ), new this.THREE.Vector3(b.x, routeY, routeZ), new this.THREE.Vector3(b.x, routeY, b.z), b];
        if (visual.userData.sovEditorVisual === 'cable') {
          const length = a.distanceTo(b); visual.visible = length > 1e-6;
          if (!visual.visible) return;
          const curve = new this.THREE.CatmullRomCurve3(points, false, 'centripetal', .35);
          const geometry = new this.THREE.TubeGeometry(curve, 30, visual.userData.sovWireRadius || this.wireRadius, 8, false);
          visual.geometry.dispose?.(); visual.geometry = geometry; visual.geometry.computeBoundingSphere(); return;
        }
        const position = visual.geometry.getAttribute('position'); points.forEach((point, index) => position.setXYZ(index, point.x, point.y, point.z)); position.needsUpdate = true; visual.geometry.computeBoundingSphere(); visual.visible = true; return;
      }
      const delta = b.clone().sub(a), length = delta.length(); visual.visible = length > 1e-6;
      if (!visual.visible) return;
      visual.position.copy(a).add(b).multiplyScalar(.5); visual.quaternion.setFromUnitVectors(this._up, delta.normalize()); visual.scale.set(1, length, 1);
    }

    _nextConnectionId() { let id; do { id = `link-${++this.connectionCounter}`; } while (this.connections.has(id)); return id; }

    _connect(fromReference, toReference, options = {}) {
      const from = this._resolveAnchor(fromReference), to = this._resolveAnchor(toReference);
      if (from === to) throw new Error('A socket cannot connect to itself');
      if (from.kind !== to.kind) throw new Error('Sockets must use the same connection medium');
      if (from.connectionId || to.connectionId) throw new Error('Each socket accepts only one direct connection');
      const fromModule = this.modules.get(from.moduleId), toModule = this.modules.get(to.moduleId);
      if (fromModule.lab !== toModule.lab) throw new Error('Connections cannot cross labs');
      if (options.enforceMode !== false) {
        const required = from.kind === 'air' ? MODES.AIR : MODES.WIRE;
        if (this.lab !== fromModule.lab || this.mode !== required) throw new Error(`${from.kind} connection requires ${required} mode in ${fromModule.lab}`);
      }
      if (this.canConnect && this.canConnect({ from, to, kind: from.kind, editor: this }) === false) throw new Error('Connection rejected by compatibility callback');
      const id = options.id == null ? this._nextConnectionId() : normalizeId(options.id, 'connection id');
      if (this.connections.has(id)) throw new Error(`Connection already exists: ${id}`);
      const routing = normalizeRouting(options.routing ?? from.metadata?.routing ?? to.metadata?.routing);
      const visual = this._createVisual(from.kind, false, { ...options, routing }), connection = { id, kind: from.kind, from, to, visual, metadata: options.metadata };
      visual.name = `sov-${from.kind}-${id}`; visual.userData.connectionId = id; this.connectionRoot.add(visual);
      this.connections.set(id, connection); from.connectionId = id; to.connectionId = id; this._updateConnection(connection);
      if (options.emit !== false) { this._emit('connectioncreated', { connection: this.connectionInfo(id) }); this._change('connection-create', { connectionId: id }); }
      return connection;
    }

    connect(from, to, options = {}) { return this._connect(from, to, options); }

    connectionInfo(id) {
      const connection = this.connections.get(String(id)); if (!connection) return null;
      return { id: connection.id, kind: connection.kind, from: { moduleId: connection.from.moduleId, anchorId: connection.from.id }, to: { moduleId: connection.to.moduleId, anchorId: connection.to.id } };
    }

    beginConnection(reference) {
      const anchor = this._resolveAnchor(reference), module = this.modules.get(anchor.moduleId);
      const modeAcceptsKind = this.mode === MODES.WIRE
        ? anchor.kind === 'electric' || anchor.kind === 'optical'
        : this.mode === MODES.AIR && anchor.kind === 'air';
      if (!modeAcceptsKind) { this._emit('actionrejected', { action: 'connection-start', mode: this.mode }); return false; }
      const kind = anchor.kind;
      if (module.lab !== this.lab || anchor.connectionId) { this._emit('actionrejected', { action: 'connection-start', moduleId: anchor.moduleId, anchorId: anchor.id }); return false; }
      this.cancel('connection-restart');
      const routing = normalizeRouting(anchor.metadata?.routing);
      const visual = this._createVisual(kind, true, { routing }); this.previewRoot.add(visual);
      const point = this.anchorWorldPosition(anchor); this._updateVisual(visual, point, point);
      this.pendingConnection = { anchor, kind, visual, point: point.clone() };
      this._emit('connectionstart', { kind, from: { moduleId: anchor.moduleId, anchorId: anchor.id } }); return true;
    }

    updateConnectionPreview(worldPosition) {
      if (!this.pendingConnection) return false;
      const point = this._vector(worldPosition, 'preview position'); this.pendingConnection.point.copy(point);
      this._updateVisual(this.pendingConnection.visual, this.anchorWorldPosition(this.pendingConnection.anchor), point); return true;
    }

    completeConnection(reference, options = {}) {
      if (!this.pendingConnection) return null;
      try {
        const connection = this._connect(this.pendingConnection.anchor, reference, { ...options, enforceMode: true });
        this._clearConnectionPreview(); return connection;
      } catch (error) {
        this._emit('connectionrejected', { message: error.message }); return null;
      }
    }

    _clearConnectionPreview() {
      const visual = this.pendingConnection?.visual; if (visual) { visual.removeFromParent(); visual.geometry?.dispose?.(); visual.material?.dispose?.(); }
      this.pendingConnection = null;
    }

    _updateConnection(connection) { this._updateVisual(connection.visual, this.anchorWorldPosition(connection.from), this.anchorWorldPosition(connection.to)); }

    updateConnections(moduleId = null) {
      const id = moduleId == null ? null : String(moduleId);
      for (const connection of this.connections.values()) if (!id || connection.from.moduleId === id || connection.to.moduleId === id) this._updateConnection(connection);
      if (this.pendingConnection && (!id || this.pendingConnection.anchor.moduleId === id)) this._updateVisual(this.pendingConnection.visual, this.anchorWorldPosition(this.pendingConnection.anchor), this.pendingConnection.point);
    }

    _ray(value) {
      if (value?.isRay) return value;
      if (value?.ray?.isRay) return value.ray;
      if (value?.origin && value?.direction) return new this.THREE.Ray(this._vector(value.origin, 'ray origin'), this._vector(value.direction, 'ray direction').normalize());
      throw new TypeError('ray must be a THREE.Ray or {origin,direction}');
    }

    beginMove(moduleId, rayValue, options = {}) {
      const module = this.modules.get(String(moduleId));
      if (!module || module.lab !== this.lab || !MODE_ALLOWANCES[this.lab].includes(MODES.MOVE) || this.mode !== MODES.MOVE || !module.movable) { this._emit('actionrejected', { action: 'move-start', moduleId: String(moduleId) }); return false; }
      const ray = this._ray(rayValue), world = new this.THREE.Vector3(); module.object.updateWorldMatrix(true, false); module.object.getWorldPosition(world);
      const planeY = finiteNumber(options.planeY ?? world.y, 'planeY'), plane = new this.THREE.Plane(new this.THREE.Vector3(0, 1, 0), -planeY), hit = ray.intersectPlane(plane, new this.THREE.Vector3());
      if (!hit) return false;
      this.cancel('move-restart'); this.pendingMove = { module, plane, offset: world.clone().sub(hit), planeY, grid: options.grid == null ? this.gridSize : Math.max(0, finiteNumber(options.grid, 'grid')) };
      this._emit('movestart', { moduleId: module.id, position: world.toArray() }); return true;
    }

    _setModuleWorldPosition(module, worldPosition, grid = this.gridSize, planeY = null, emit = true) {
      const world = this._vector(worldPosition, 'module position');
      if (planeY != null) world.y = finiteNumber(planeY, 'planeY');
      if (grid > 0) { world.x = Math.round(world.x / grid) * grid; world.z = Math.round(world.z / grid) * grid; }
      const local = world.clone(); if (module.object.parent) { module.object.parent.updateWorldMatrix(true, false); module.object.parent.worldToLocal(local); }
      module.object.position.copy(local); module.object.updateMatrixWorld(true); this.updateConnections(module.id);
      if (emit) { this._emit('modulemoved', { moduleId: module.id, position: world.toArray() }); this._change('module-move', { moduleId: module.id }); }
      return world;
    }

    updateMove(rayValue) {
      if (!this.pendingMove) return false;
      const ray = this._ray(rayValue), hit = ray.intersectPlane(this.pendingMove.plane, new this.THREE.Vector3()); if (!hit) return false;
      hit.add(this.pendingMove.offset); this._setModuleWorldPosition(this.pendingMove.module, hit, this.pendingMove.grid, this.pendingMove.planeY, true); return true;
    }

    endMove() {
      if (!this.pendingMove) return false;
      const id = this.pendingMove.module.id; this.pendingMove = null; this._emit('moveend', { moduleId: id }); return true;
    }

    moveModule(moduleId, worldPosition, options = {}) {
      const module = this.modules.get(String(moduleId)); if (!module) throw new Error(`Unknown module: ${moduleId}`);
      if (options.enforceMode !== false && (module.lab !== this.lab || !MODE_ALLOWANCES[this.lab].includes(MODES.MOVE) || this.mode !== MODES.MOVE || !module.movable)) throw new Error(`Module movement requires MOVE mode in ${this.lab} lab`);
      const current = new this.THREE.Vector3(); module.object.getWorldPosition(current);
      return this._setModuleWorldPosition(module, worldPosition, options.grid == null ? this.gridSize : Math.max(0, finiteNumber(options.grid, 'grid')), options.planeY ?? current.y, options.emit !== false);
    }

    _resolveConnection(reference) {
      if (typeof reference === 'string' && this.connections.has(reference)) return this.connections.get(reference);
      try { const anchor = this._resolveAnchor(reference); return anchor.connectionId ? this.connections.get(anchor.connectionId) : null; } catch (_) { return null; }
    }

    _removeConnection(reference, emit = true) {
      const connection = this._resolveConnection(reference); if (!connection) return false;
      connection.from.connectionId = null; connection.to.connectionId = null; connection.visual.removeFromParent(); connection.visual.geometry?.dispose?.(); connection.visual.material?.dispose?.(); this.connections.delete(connection.id);
      if (emit) { this._emit('connectiondeleted', { connectionId: connection.id }); this._change('connection-delete', { connectionId: connection.id }); } return true;
    }

    removeConnection(reference) { return this._removeConnection(reference, true); }

    deleteLink(reference) {
      if (this.mode !== MODES.DELETE_WIRE) { this._emit('actionrejected', { action: 'delete-link', mode: this.mode }); return false; }
      return this._removeConnection(reference, true);
    }

    unregisterModule(moduleId, options = {}) {
      const module = this.modules.get(String(moduleId)); if (!module) return false;
      const links = new Set([...module.anchors.values()].map(anchor => anchor.connectionId).filter(Boolean)); for (const id of links) this._removeConnection(id, options.emit !== false);
      for (const anchor of module.anchors.values()) this.anchors.delete(connectionKey(module.id, anchor.id)); this.modules.delete(module.id);
      if (options.removeObject ?? module.removeObjectOnDelete) module.object.removeFromParent?.();
      if (this.pendingMove?.module === module || this.pendingConnection?.anchor.moduleId === module.id) this.cancel('module-delete');
      if (options.emit !== false) { this._emit('moduledeleted', { moduleId: module.id, connectionIds: [...links] }); this._change('module-delete', { moduleId: module.id }); } return true;
    }

    deleteModule(moduleId) {
      if (!MODE_ALLOWANCES[this.lab].includes(MODES.DELETE_MODULE) || this.mode !== MODES.DELETE_MODULE) { this._emit('actionrejected', { action: 'delete-module', mode: this.mode }); return false; }
      const module = this.modules.get(String(moduleId)); if (!module || module.lab !== this.lab) return false;
      return this.unregisterModule(moduleId, { removeObject: true, emit: true });
    }

    cancel(reason = 'cancel') {
      const hadConnection = !!this.pendingConnection, hadMove = !!this.pendingMove;
      this._clearConnectionPreview(); this.pendingMove = null;
      if (hadConnection || hadMove) this._emit('cancel', { reason, connection: hadConnection, move: hadMove });
      return hadConnection || hadMove;
    }

    clearConnections(options = {}) {
      const ids = [...this.connections.keys()]; for (const id of ids) this._removeConnection(id, options.emit !== false);
      return ids.length;
    }

    serialize() {
      const modules = [...this.modules.values()].map(module => ({
        id: module.id, lab: module.lab,
        position: module.object.position.toArray(), quaternion: module.object.quaternion.toArray(), scale: module.object.scale.toArray()
      }));
      const connections = [...this.connections.values()].map(connection => this.connectionInfo(connection.id));
      return { schemaVersion: SCHEMA_VERSION, lab: this.lab, mode: this.mode, modules, connections };
    }

    _validateImport(state, strict) {
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Editor state must be an object');
      if (state.schemaVersion !== SCHEMA_VERSION) throw new RangeError(`Unsupported editor schema: ${state.schemaVersion}`);
      const lab = normalizeLab(state.lab), mode = normalizeMode(state.mode);
      if (!MODE_ALLOWANCES[lab].includes(mode)) throw new RangeError(`${mode} is not allowed in ${lab}`);
      if (!Array.isArray(state.modules) || !Array.isArray(state.connections)) throw new TypeError('Editor state modules and connections must be arrays');
      if (state.modules.length > 5000 || state.connections.length > 10000) throw new RangeError('Editor state exceeds safe item limits');
      const seenModules = new Set(), modules = [];
      for (const item of state.modules) {
        const id = normalizeId(item?.id, 'module id'); if (seenModules.has(id)) throw new Error(`Duplicate module state: ${id}`); seenModules.add(id);
        const module = this.modules.get(id); if (!module) { if (strict) throw new Error(`Unknown module in state: ${id}`); continue; }
        if (normalizeLab(item.lab) !== module.lab) throw new Error(`Module lab mismatch: ${id}`);
        modules.push({ module, position: finiteTuple(item.position, 3, `${id}.position`), quaternion: finiteTuple(item.quaternion, 4, `${id}.quaternion`), scale: finiteTuple(item.scale, 3, `${id}.scale`) });
      }
      const occupied = new Set(), ids = new Set(), connections = [];
      for (const item of state.connections) {
        const id = normalizeId(item?.id, 'connection id'); if (ids.has(id)) throw new Error(`Duplicate connection state: ${id}`); ids.add(id);
        let from, to;
        try { from = this._resolveAnchor(item.from); to = this._resolveAnchor(item.to); } catch (error) { if (strict) throw error; continue; }
        if (from === to || from.kind !== to.kind) throw new Error(`Invalid connection: ${id}`);
        if (item.kind && item.kind !== from.kind) throw new Error(`Connection kind mismatch: ${id}`);
        const fromKey = connectionKey(from.moduleId, from.id), toKey = connectionKey(to.moduleId, to.id);
        if (occupied.has(fromKey) || occupied.has(toKey)) throw new Error(`Socket used more than once in state: ${id}`);
        if (this.modules.get(from.moduleId).lab !== this.modules.get(to.moduleId).lab) throw new Error(`Cross-lab connection: ${id}`);
        occupied.add(fromKey); occupied.add(toKey); connections.push({ id, from, to });
      }
      return { lab, mode, modules, connections };
    }

    importState(state, options = {}) {
      const validated = this._validateImport(state, options.strict !== false); this.cancel('state-import'); this.clearConnections({ emit: false });
      for (const item of validated.modules) {
        item.module.object.position.fromArray(item.position); item.module.object.quaternion.fromArray(item.quaternion); item.module.object.scale.fromArray(item.scale); item.module.object.updateMatrixWorld(true);
      }
      this.lab = validated.lab; this.mode = validated.mode;
      for (const item of validated.connections) this._connect(item.from, item.to, { id: item.id, enforceMode: false, emit: false });
      this.updateConnections(); this._emit('stateimported', { lab: this.lab, mode: this.mode, modules: validated.modules.length, connections: validated.connections.length }); this._change('state-import'); return this.serialize();
    }

    dispose() {
      if (this.disposed) return; this.cancel('dispose'); this.clearConnections({ emit: false });
      for (const detach of [...this.hotkeyDetachers]) detach(); this.listeners.clear();
      this.modules.clear(); this.anchors.clear(); this.previewRoot.removeFromParent?.();
      if (this.ownsConnectionRoot) this.connectionRoot.removeFromParent?.(); this.disposed = true;
    }
  }

  function create(options) { return new EditorEngine(options); }

  return Object.freeze({ version: '1.2.0', SCHEMA_VERSION, MODES, LABS, MODE_ALLOWANCES, hotkeyAction, editableTarget, normalizeRouting, createAnchorHitTarget, EditorEngine, create });
});
