const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'src', 'ui', 'imported-models.js'), 'utf8')
  .replace(/^import \{ GLTFLoader \} from ['"][^'"]+['"];\r?\n/, 'const GLTFLoader = globalThis.GLTFLoader;\n');

function makeHarness() {
  const loadCalls = [];

  class GLTFLoader {
    load(url, onLoad, _onProgress, onError) {
      loadCalls.push({ url, onLoad, onError });
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
    dispatchEvent() {},
  };
  const context = vm.createContext({
    console,
    CustomEvent: class CustomEvent {},
    document: { baseURI: 'https://trainer.invalid/' },
    fetch: async url => ({
      ok: true,
      json: async () => ({
        models: String(url).includes('sov-kdp') ? [{ file: 'retry.glb' }] : [],
      }),
    }),
    GLTFLoader,
    Promise,
    setTimeout,
    URL,
    window,
  });
  context.globalThis = context;
  context.THREE = {
    LoadingManager: class LoadingManager { addHandler() {} },
    TextureLoader: class TextureLoader {},
  };
  vm.runInContext(moduleSource, context, { filename: 'src/ui/imported-models.js' });

  return {
    api: window.PLCTrainerImportedModels,
    loadCalls,
    sourceScene,
  };
}

async function waitForLoadCount(loadCalls, expected) {
  for (let attempts = 0; attempts < 20 && loadCalls.length < expected; attempts += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(loadCalls.length, expected);
}

test('a rejected GLB load is evicted so the next request retries while successful loads stay shared', async () => {
  const { api, loadCalls, sourceScene } = makeHarness();

  const first = api.loadModel('retry.glb');
  const concurrent = api.loadModel('retry.glb');
  await waitForLoadCount(loadCalls, 1);
  loadCalls[0].onError(new Error('first GLB load failed'));
  await assert.rejects(first, /first GLB load failed/);
  await assert.rejects(concurrent, /first GLB load failed/);

  const retry = api.loadModel('retry.glb');
  await waitForLoadCount(loadCalls, 2);
  loadCalls[1].onLoad({ scene: sourceScene });
  await retry;

  await api.loadModel('retry.glb');
  assert.equal(loadCalls.length, 2, 'the fulfilled retry remains cached');
});

test('a stale rejected load cannot evict a newer cache entry for the same resolved URL', async () => {
  const { api, loadCalls, sourceScene } = makeHarness();

  const stale = api.loadModel('retry.glb');
  await waitForLoadCount(loadCalls, 1);
  api.clearCache();

  const replacement = api.loadModel('retry.glb');
  await waitForLoadCount(loadCalls, 2);
  loadCalls[0].onError(new Error('stale GLB load failed'));
  await assert.rejects(stale, /stale GLB load failed/);

  const follower = api.loadModel('retry.glb');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loadCalls.length, 2, 'the follower shares the replacement request');

  loadCalls[1].onLoad({ scene: sourceScene });
  await Promise.all([replacement, follower]);
});
