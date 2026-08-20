const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'src', 'ui', 'imported-models.js'), 'utf8')
  .replace(/^import \{ GLTFLoader \} from ['"][^'"]+['"];\r?\n/, 'const GLTFLoader = globalThis.GLTFLoader;\n');

const okResponse = models => ({
  ok: true,
  status: 200,
  json: async () => ({ models }),
  arrayBuffer: async () => new ArrayBuffer(8),
});

function makeHarness(options = {}) {
  const loadCalls = [];
  const fetchCalls = [];
  const events = [];

  class GLTFLoader {
    parse(buffer, resourcePath, onLoad, onError) {
      loadCalls.push({ buffer, resourcePath, onLoad, onError });
    }
  }

  const makeClone = () => ({
    name: '',
    userData: {},
    scale: { setScalar() {} },
    position: { set() {} },
    rotation: { set() {} },
    traverse() {},
  });
  const sourceScene = { clone: () => makeClone() };
  const window = {
    dispatchEvent(event) { events.push(event); },
  };
  const fetchImpl = options.fetch || (async url => okResponse(
    String(url).includes('sov-kdp')
      ? [{ file: 'retry.glb' }]
      : [{ file: 'manual.glb', evidence: { manual: 'manual.pdf' } }],
  ));
  const context = vm.createContext({
    console,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    document: { baseURI: 'https://trainer.invalid/app/' },
    fetch: async (url, init) => {
      fetchCalls.push(String(url));
      return fetchImpl(url, fetchCalls.length, init);
    },
    GLTFLoader,
    AbortController,
    Promise,
    clearTimeout,
    setTimeout,
    URL,
    window,
    __PLC_TRAINER_MANIFEST_TIMEOUT_MS__: options.manifestTimeoutMs,
    __PLC_TRAINER_MODEL_TIMEOUT_MS__: options.modelTimeoutMs,
    __PLC_TRAINER_MAX_CACHED_MODELS__: options.maxCachedModels,
    __PLC_TRAINER_CATALOG_RETRY_DELAYS_MS__: options.catalogRetryDelaysMs || [],
  });
  context.globalThis = context;
  context.THREE = {
    LoadingManager: class LoadingManager { addHandler() {} },
    TextureLoader: class TextureLoader {},
  };
  vm.runInContext(moduleSource, context, { filename: 'src/ui/imported-models.js' });

  return {
    api: window.PLCTrainerImportedModels,
    events,
    fetchCalls,
    loadCalls,
    sourceScene,
  };
}

async function waitForCount(items, expected) {
  for (let attempts = 0; attempts < 30 && items.length < expected; attempts += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(items.length, expected);
}

test('catalog preload combines local, SoV, and manual-backed assets before the UI requests it', async () => {
  const { api, events, fetchCalls } = makeHarness();
  await Promise.resolve();
  assert.equal(fetchCalls.length, 2, 'both manifests begin loading during module initialization');

  const manifest = await api.loadManifest();
  assert.deepEqual(Array.from(manifest.models, entry => entry.file), [
    'palletizer-3axis-v2.glb',
    'l7sa004a-production-v3.glb',
    'retry.glb',
    'manual.glb',
  ]);
  assert.equal(fetchCalls.length, 2, 'explicit catalog access shares the preload');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(events.some(event => event.type === 'plc-trainer-imported-models-catalog-ready'));
  assert.equal(api.getStatus().catalog.state, 'ready');
});

test('a failed manifest source is evicted and retried while successful sources remain cached', async () => {
  let sovAttempts = 0;
  let manualAttempts = 0;
  const { api, loadCalls, sourceScene } = makeHarness({
    fetch: async url => {
      if (String(url).includes('sov-kdp')) {
        sovAttempts += 1;
        if (sovAttempts === 1) return { ok: false, status: 503, json: async () => ({}) };
        return okResponse([{ file: 'recovered.glb' }]);
      }
      manualAttempts += 1;
      return okResponse([{ file: 'manual.glb' }]);
    },
  });

  const partial = await api.loadManifest();
  assert.equal(api.getStatus().catalog.state, 'partial');
  assert.ok(partial.models.some(entry => entry.file === 'manual.glb'));
  assert.ok(partial.models.every(entry => entry.file !== 'recovered.glb'));

  const recovered = await api.loadManifest();
  assert.equal(api.getStatus().catalog.state, 'ready');
  assert.ok(recovered.models.some(entry => entry.file === 'recovered.glb'));
  assert.equal(sovAttempts, 2);
  assert.equal(manualAttempts, 1, 'the healthy manifest is not fetched again');
});

test('manifest paths cannot escape their collection or shadow a reserved local model', async () => {
  const { api, loadCalls, sourceScene } = makeHarness({
    fetch: async url => okResponse(String(url).includes('sov-kdp') ? [
      { file: '../escape.glb' },
      { file: 'palletizer-3axis-v2.glb', sourceProduct: 'untrusted override' },
      { file: 'safe.glb' },
      { file: 'safe.glb' },
    ] : []),
  });

  const manifest = await api.loadManifest();
  assert.equal(manifest.models.filter(entry => entry.file === 'palletizer-3axis-v2.glb').length, 2);
  assert.ok(manifest.models.some(entry => entry.assetKey === 'local-automation:palletizer-3axis-v2.glb'));
  assert.ok(manifest.models.some(entry => entry.assetKey === 'sov-kdp:palletizer-3axis-v2.glb'));
  assert.equal(manifest.models.filter(entry => entry.file === 'safe.glb').length, 1);
  assert.ok(manifest.models.every(entry => entry.file !== '../escape.glb'));
  assert.ok(manifest.warnings.some(warning => warning.includes('unsafe or invalid')));
  assert.ok(manifest.warnings.some(warning => warning.includes('reserved by local-automation')));
});

test('local Blender assets load through fetch/parse without waiting for manifest network I/O', async () => {
  const never = new Promise(() => {});
  const { api, loadCalls, sourceScene, fetchCalls } = makeHarness({
    manifestTimeoutMs: 5,
    fetch: url => String(url).endsWith('.glb') ? okResponse([]) : never,
  });

  const model = api.loadModel('palletizer-3axis-v2.glb');
  await waitForCount(loadCalls, 1);
  assert.equal(loadCalls[0].resourcePath, 'https://trainer.invalid/app/assets/models/automation/');
  assert.ok(fetchCalls.includes('https://trainer.invalid/app/assets/models/automation/palletizer-3axis-v2.glb'));
  loadCalls[0].onLoad({ scene: sourceScene });
  assert.equal((await model).userData.assetCollection, 'local-automation');
});

test('a rejected GLB load is evicted so the next request retries while successful loads stay shared', async () => {
  const { api, loadCalls, sourceScene } = makeHarness();

  const first = api.loadModel('retry.glb');
  const concurrent = api.loadModel('retry.glb');
  await waitForCount(loadCalls, 1);
  loadCalls[0].onError(new Error('first GLB load failed'));
  await assert.rejects(first, /first GLB load failed/);
  await assert.rejects(concurrent, /first GLB load failed/);
  assert.equal(api.getStatus().pending.length, 0);

  const retry = api.loadModel('retry.glb');
  await waitForCount(loadCalls, 2);
  loadCalls[1].onLoad({ scene: sourceScene });
  await retry;

  await api.loadModel('retry.glb');
  assert.equal(loadCalls.length, 2, 'the fulfilled retry remains cached');
  assert.equal(api.getStatus().failed.length, 0);
});

test('clearing caches isolates stale loader callbacks from replacement state', async () => {
  const { api, loadCalls, sourceScene } = makeHarness();

  const stale = api.loadModel('retry.glb');
  await waitForCount(loadCalls, 1);
  api.clearCache();

  const replacement = api.loadModel('retry.glb');
  await waitForCount(loadCalls, 2);
  loadCalls[0].onError(new Error('stale GLB load failed'));
  await assert.rejects(stale, /stale GLB load failed/);
  assert.equal(api.getStatus().failed.length, 0, 'stale failure is absent after clearCache');

  const follower = api.loadModel('retry.glb');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loadCalls.length, 2, 'the follower shares the replacement request');

  loadCalls[1].onLoad({ scene: sourceScene });
  await Promise.all([replacement, follower]);
  assert.deepEqual(Array.from(api.getStatus().loaded), ['retry.glb']);
});

test('unsafe direct model names are rejected before any loader request', async () => {
  const { api, loadCalls } = makeHarness();
  await assert.rejects(api.loadModel('../outside.glb'), /Unsafe 3D equipment asset name/);
  assert.equal(loadCalls.length, 0);
});

test('a timed out GLB fetch is aborted and evicted so the next call can retry', async () => {
  let glbAttempts = 0;
  const { api, loadCalls, sourceScene } = makeHarness({
    modelTimeoutMs: 25,
    fetch: (url, _call, init) => {
      if (!String(url).endsWith('.glb')) return okResponse([{ file: 'retry.glb' }]);
      glbAttempts += 1;
      if (glbAttempts > 1) return okResponse([]);
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason)));
    },
  });
  await assert.rejects(api.loadModel('sov-kdp:retry.glb'), /timed out/);
  assert.equal(api.getStatus().pending.length, 0);
  const retry = api.loadModel('sov-kdp:retry.glb');
  await waitForCount(loadCalls, 1);
  assert.equal(glbAttempts, 2);
  loadCalls[0].onLoad({ scene: sourceScene });
  await retry;
});

test('loaded instances expose an idempotent release contract', async () => {
  const { api, loadCalls, sourceScene } = makeHarness();
  const promise = api.loadModel('retry.glb');
  await waitForCount(loadCalls, 1);
  loadCalls[0].onLoad({ scene: sourceScene });
  const model = await promise;
  assert.equal(api.releaseModel(model), true);
  assert.equal(api.releaseModel(model), false);
});
