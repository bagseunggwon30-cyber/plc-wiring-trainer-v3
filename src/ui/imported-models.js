import { GLTFLoader } from '../../assets/vendor/GLTFLoader.js';

// Chromium can expose createImageBitmap while still failing to decode inlined
// images through ImageBitmapLoader in an offline Electron window. Route the
// texture formats used by our GLBs through the DOM-backed TextureLoader.
const manager = new globalThis.THREE.LoadingManager();
const inlineTextureLoader = new globalThis.THREE.TextureLoader(manager);
manager.addHandler(/^data:image\/(?:png|jpe?g|webp)/i, inlineTextureLoader);
const loader = new GLTFLoader(manager);

const SAFE_MODEL_FILE = /^[a-z0-9][a-z0-9._-]*\.glb$/i;
const SAFE_ASSET_KEY = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*\.glb$/i;
const MANIFEST_TIMEOUT_MS = Number.isFinite(globalThis.__PLC_TRAINER_MANIFEST_TIMEOUT_MS__)
  ? globalThis.__PLC_TRAINER_MANIFEST_TIMEOUT_MS__ : 10_000;
const MODEL_TIMEOUT_MS = Number.isFinite(globalThis.__PLC_TRAINER_MODEL_TIMEOUT_MS__)
  ? globalThis.__PLC_TRAINER_MODEL_TIMEOUT_MS__ : 30_000;
const MAX_CACHED_MODELS = Number.isFinite(globalThis.__PLC_TRAINER_MAX_CACHED_MODELS__)
  ? Math.max(1, globalThis.__PLC_TRAINER_MAX_CACHED_MODELS__) : 6;
const CATALOG_RETRY_DELAYS_MS = Array.isArray(globalThis.__PLC_TRAINER_CATALOG_RETRY_DELAYS_MS__)
  ? globalThis.__PLC_TRAINER_CATALOG_RETRY_DELAYS_MS__ : [500, 2_000, 8_000];
const cache = new Map();
const sourceCatalogCache = new Map();
const requested = new Set();
const pending = new Set();
const loaded = new Set();
const failed = new Map();
const instanceRecords = new WeakMap();
const releasedInstances = new WeakSet();
let cacheClock = 0;

const localAssets = Object.freeze({
  'palletizer-3axis-v2.glb': Object.freeze({
    file: 'palletizer-3axis-v2.glb',
    assetKey: 'local-automation:palletizer-3axis-v2.glb',
    model: '3축 팔레타이징 장비 v2',
    kind: 'automation-cell',
    modelBaseUrl: 'assets/models/automation/',
    sourceProduct: 'User-authored Blender 5.2 · 3-axis palletizer v2',
    assetCollection: 'local-automation',
  }),
  'l7sa004a-production-v3.glb': Object.freeze({
    file: 'l7sa004a-production-v3.glb',
    assetKey: 'local-ls-electric:l7sa004a-production-v3.glb',
    model: 'L7SA004A',
    kind: 'servo-amplifier',
    modelBaseUrl: 'assets/models/ls-electric/',
    sourceProduct: 'User-authored Blender 5.2 · L7SA004A production v3',
    assetCollection: 'local-ls-electric',
  }),
});

const manifestSources = Object.freeze([
  Object.freeze({
    id: 'sov-kdp',
    manifestUrl: 'assets/imported/sov-kdp/manifest.json',
    modelBaseUrl: 'assets/imported/sov-kdp/models/',
    sourceProduct: 'SoV-KDP 1.1.9K',
  }),
  Object.freeze({
    id: 'manual-backed',
    manifestUrl: 'assets/manual-backed/manifest.json',
    modelBaseUrl: 'assets/manual-backed/',
    sourceProduct: 'Manual-backed · Blender 5.2',
  }),
]);

let generation = 0;
let catalogPromise = null;
let catalogState = 'idle';
let catalogWarnings = [];
let catalogRetryTimer = null;
let catalogRetryAttempt = 0;

function normalizeError(error, fallback) {
  if (error instanceof Error) return error;
  return new Error(String(error?.message || error || fallback));
}

function validateManifest(source, manifest) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.models)) {
    throw new Error(`${source.id} asset manifest has no models array`);
  }

  const models = [];
  const warnings = [];
  const files = new Set();
  for (const entry of manifest.models) {
    if (!entry || typeof entry !== 'object' || !SAFE_MODEL_FILE.test(entry.file || '')) {
      warnings.push(`${source.id}: ignored unsafe or invalid model filename`);
      continue;
    }
    if (files.has(entry.file)) {
      warnings.push(`${source.id}: ignored duplicate model ${entry.file}`);
      continue;
    }
    files.add(entry.file);
    models.push({
      ...entry,
      file: entry.file,
      assetKey: `${source.id}:${entry.file}`,
      assetCollection: source.id,
      sourceProduct: source.sourceProduct,
      modelBaseUrl: source.modelBaseUrl,
    });
  }
  return { models, warnings };
}

function loadManifestSource(source) {
  if (sourceCatalogCache.has(source.id)) return sourceCatalogCache.get(source.id);

  const controller = new AbortController();
  const timeoutError = new Error(`${source.id} asset manifest timed out`);
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, MANIFEST_TIMEOUT_MS);
  });
  const fetchRequest = Promise.resolve()
    .then(() => fetch(new URL(source.manifestUrl, document.baseURI), { signal: controller.signal }));
  let request;
  request = Promise.race([fetchRequest, deadline])
    .then(response => {
      if (!response.ok) throw new Error(`${source.id} asset manifest HTTP ${response.status}`);
      return response.json();
    })
    .then(manifest => validateManifest(source, manifest))
    .catch(error => {
      // A rejected fetch/parse must not poison the cache for the remainder of
      // the Electron session. Successful sources stay memoized independently.
      if (sourceCatalogCache.get(source.id) === request) sourceCatalogCache.delete(source.id);
      throw normalizeError(error, `${source.id} asset manifest failed`);
    })
    .finally(() => clearTimeout(timeout));
  sourceCatalogCache.set(source.id, request);
  return request;
}

function mergeCatalog(results) {
  const models = [];
  const locations = new Map();
  const qualifiedLocations = new Map();
  const ambiguousFiles = new Set();
  const warnings = [];
  let retryableFailureCount = 0;

  const add = entry => {
    const assetKey = entry.assetKey || `${entry.assetCollection}:${entry.file}`;
    const normalized = { ...entry, assetKey };
    if (qualifiedLocations.has(assetKey)) {
      warnings.push(`${entry.assetCollection}: ignored duplicate asset key ${assetKey}`);
      return;
    }
    qualifiedLocations.set(assetKey, normalized);
    models.push(normalized);

    const existing = locations.get(entry.file);
    if (!existing) {
      locations.set(entry.file, normalized);
      return;
    }
    if (existing.assetCollection?.startsWith('local-')) {
      warnings.push(`${assetKey}: unqualified alias reserved by ${existing.assetKey}`);
      return;
    }
    ambiguousFiles.add(entry.file);
    locations.delete(entry.file);
    warnings.push(`${entry.file}: ambiguous filename; use collection:file asset key`);
  };

  // Local authored assets are reserved first, so a downloaded manifest can
  // never redirect a known filename to a different model or directory.
  Object.values(localAssets).forEach(add);

  results.forEach((result, index) => {
    const source = manifestSources[index];
    if (result.status === 'rejected') {
      retryableFailureCount += 1;
      warnings.push(`${source.id}: ${normalizeError(result.reason, 'manifest failed').message}`);
      return;
    }
    warnings.push(...result.value.warnings);
    result.value.models.forEach(add);
  });

  return { models, locations, qualifiedLocations, ambiguousFiles, warnings, retryableFailureCount };
}

function loadCatalog() {
  if (catalogPromise) return catalogPromise;

  const requestGeneration = generation;
  catalogState = 'loading';
  let request;
  request = Promise.allSettled(manifestSources.map(loadManifestSource))
    .then(results => {
      const catalog = mergeCatalog(results);
      if (generation === requestGeneration) {
        catalogWarnings = catalog.warnings;
        catalogState = catalog.retryableFailureCount ? 'partial' : 'ready';
        // Keep a complete catalog memoized, but allow the next call to retry
        // only the failed sources after a partial preload.
        if (catalog.retryableFailureCount && catalogPromise === request) catalogPromise = null;
        if (!catalog.retryableFailureCount) {
          if (catalogRetryTimer) clearTimeout(catalogRetryTimer);
          catalogRetryTimer = null;
          catalogRetryAttempt = 0;
        }
      }
      return catalog;
    })
    .catch(error => {
      if (generation === requestGeneration) {
        catalogState = 'failed';
        catalogWarnings = [normalizeError(error, '3D asset catalog failed').message];
        if (catalogPromise === request) catalogPromise = null;
      }
      throw error;
    });
  catalogPromise = request;
  return request;
}

function scheduleCatalogRetry() {
  if (catalogRetryTimer || catalogRetryAttempt >= CATALOG_RETRY_DELAYS_MS.length) return;
  const delay = CATALOG_RETRY_DELAYS_MS[catalogRetryAttempt++];
  catalogRetryTimer = setTimeout(() => {
    catalogRetryTimer = null;
    loadCatalog().then(catalog => {
      window.dispatchEvent(new CustomEvent('plc-trainer-imported-models-catalog-updated', {
        detail: { count: catalog.models.length, warnings: [...catalog.warnings], state: catalogState },
      }));
      if (catalog.retryableFailureCount) scheduleCatalogRetry();
      else catalogRetryAttempt = 0;
    }).catch(scheduleCatalogRetry);
  }, delay);
}

function resolveCatalogEntry(catalog, identifier) {
  if (SAFE_ASSET_KEY.test(identifier || '')) return catalog.qualifiedLocations.get(identifier);
  if (catalog.ambiguousFiles.has(identifier)) {
    throw new Error(`Ambiguous 3D equipment asset: ${identifier}; use collection:file`);
  }
  return catalog.locations.get(identifier);
}

function disposeSource(source) {
  const textures = new Set();
  const materials = new Set();
  source.traverse?.(object => {
    if (object.geometry?.dispose) object.geometry.dispose();
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && value.dispose) textures.add(value);
      }
      material.dispose?.();
    }
  });
  textures.forEach(texture => texture.dispose());
}

function evictUnusedModels() {
  const candidates = [...cache.entries()]
    .filter(([, record]) => record.settled && record.refCount === 0)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  while (cache.size > MAX_CACHED_MODELS && candidates.length) {
    const [url, record] = candidates.shift();
    if (cache.get(url) !== record || record.refCount !== 0) continue;
    cache.delete(url);
    disposeSource(record.scene);
  }
}

function loadSceneWithTimeout(url, filename) {
  const controller = new AbortController();
  const timeoutError = new Error(`${filename} model load timed out`);
  let expired = false;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      expired = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, MODEL_TIMEOUT_MS);
  });
  const operation = fetch(url, { signal: controller.signal })
    .then(response => {
      if (!response.ok) throw new Error(`${filename} model HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(buffer => new Promise((resolve, reject) => {
      const resourcePath = new URL('.', url).href;
      loader.parse(buffer, resourcePath, gltf => {
        if (expired) disposeSource(gltf.scene);
        else resolve(gltf.scene);
      }, error => reject(normalizeError(error, `${filename} failed to parse`)));
    }))
    .catch(error => {
      if (controller.signal.aborted) throw normalizeError(controller.signal.reason, `${filename} model load timed out`);
      throw normalizeError(error, `${filename} failed to load`);
    });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timeout));
}

async function loadRaw(filename) {
  const isQualified = SAFE_ASSET_KEY.test(filename || '');
  const plainFilename = isQualified ? filename.slice(filename.indexOf(':') + 1) : filename;
  if (!SAFE_MODEL_FILE.test(plainFilename || '')) throw new Error(`Unsafe 3D equipment asset name: ${filename}`);

  const localEntry = isQualified
    ? Object.values(localAssets).find(entry => entry.assetKey === filename)
    : localAssets[plainFilename];
  let catalog = localEntry ? null : await loadCatalog();
  let entry = localEntry || resolveCatalogEntry(catalog, filename);
  // If this filename belongs to a manifest that failed during preload, make
  // one transparent retry before reporting it as unknown. Healthy manifests
  // remain independently cached, so this only repeats failed I/O.
  if (!entry && catalog?.retryableFailureCount) {
    catalog = await loadCatalog();
    entry = resolveCatalogEntry(catalog, filename);
  }
  if (!entry) throw new Error(`Unknown 3D equipment asset: ${filename}`);

  const baseUrl = new URL(entry.modelBaseUrl, document.baseURI);
  const resolved = new URL(encodeURIComponent(entry.file), baseUrl).href;
  const statusKey = isQualified ? entry.assetKey : entry.file;
  requested.add(statusKey);
  failed.delete(statusKey);

  if (!cache.has(resolved)) {
    const requestGeneration = generation;
    pending.add(statusKey);
    const record = { promise: null, scene: null, settled: false, refCount: 0, lastUsed: ++cacheClock, assetKey: statusKey, evicted: false };
    record.promise = loadSceneWithTimeout(resolved, entry.file).then(scene => {
      record.scene = scene;
      record.settled = true;
      if (generation === requestGeneration) {
        pending.delete(statusKey);
        loaded.add(statusKey);
        failed.delete(statusKey);
      }
      if (record.evicted && record.refCount === 0) disposeSource(scene);
      else evictUnusedModels();
      return scene;
    }).catch(error => {
      if (cache.get(resolved) === record) cache.delete(resolved);
      if (generation === requestGeneration) {
        pending.delete(statusKey);
        failed.set(statusKey, error.message);
      }
      throw error;
    });
    cache.set(resolved, record);
  }
  const record = cache.get(resolved);
  record.lastUsed = ++cacheClock;
  record.refCount += 1;
  try {
    return { scene: await record.promise, entry, record };
  } catch (error) {
    record.refCount = Math.max(0, record.refCount - 1);
    throw error;
  }
}

function cloneMaterials(root) {
  root.traverse?.(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (Array.isArray(object.material)) object.material = object.material.map(material => material.clone());
    else if (object.material) object.material = object.material.clone();
  });
  return root;
}

async function loadModel(filename, options = {}) {
  const { scene: source, entry, record } = await loadRaw(filename);
  const root = cloneMaterials(source.clone(true));
  root.name = options.name || filename.replace(/\.glb$/i, '');
  root.userData.importedAsset = true;
  root.userData.sourceProduct = entry.sourceProduct;
  root.userData.assetCollection = entry.assetCollection;
  root.userData.manualEvidence = entry.evidence || null;
  if (Number.isFinite(options.scale)) root.scale.setScalar(options.scale);
  if (Array.isArray(options.position)) root.position.set(...options.position);
  if (Array.isArray(options.rotation)) root.rotation.set(...options.rotation);
  instanceRecords.set(root, record);
  return root;
}

function releaseModel(root, options = {}) {
  const record = instanceRecords.get(root);
  if (!record || releasedInstances.has(root)) return false;
  releasedInstances.add(root);
  instanceRecords.delete(root);
  root.traverse?.(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => material?.dispose?.());
  });
  if (options.removeFromParent !== false) root.removeFromParent?.();
  record.refCount = Math.max(0, record.refCount - 1);
  record.lastUsed = ++cacheClock;
  if (record.evicted && record.refCount === 0 && record.scene) disposeSource(record.scene);
  else evictUnusedModels();
  return true;
}

async function loadManifest() {
  const catalog = await loadCatalog();
  return {
    schemaVersion: 1,
    sourceTool: 'mixed',
    models: catalog.models.map(({ modelBaseUrl, ...entry }) => entry),
    warnings: [...catalog.warnings],
  };
}

function clearCache() {
  generation += 1;
  for (const record of cache.values()) {
    record.evicted = true;
    if (record.settled && record.refCount === 0 && record.scene) disposeSource(record.scene);
  }
  cache.clear();
  sourceCatalogCache.clear();
  requested.clear();
  pending.clear();
  loaded.clear();
  failed.clear();
  catalogPromise = null;
  catalogState = 'idle';
  catalogWarnings = [];
  if (catalogRetryTimer) clearTimeout(catalogRetryTimer);
  catalogRetryTimer = null;
  catalogRetryAttempt = 0;
}

function preloadCatalog() {
  const requestGeneration = generation;
  return loadCatalog().then(catalog => {
    if (generation === requestGeneration) {
      window.dispatchEvent(new CustomEvent('plc-trainer-imported-models-catalog-ready', {
        detail: { count: catalog.models.length, warnings: [...catalog.warnings] },
      }));
    }
    if (catalog.retryableFailureCount) scheduleCatalogRetry();
    return catalog;
  });
}

window.PLCTrainerImportedModels = Object.freeze({
  version: '1.3.0',
  loadModel,
  releaseModel,
  loadManifest,
  preloadCatalog,
  getStatus: () => ({
    requested: [...requested],
    pending: [...pending],
    loaded: [...loaded],
    failed: [...failed].map(([filename, error]) => ({ filename, error })),
    catalog: { state: catalogState, warnings: [...catalogWarnings] },
  }),
  clearCache,
});
window.dispatchEvent(new CustomEvent('plc-trainer-imported-models-ready'));

// Start manifest I/O immediately while the rest of the UI initializes. The
// explicit API still returns the shared promise, and a partial failure is
// automatically eligible for retry on the next catalog request.
void preloadCatalog().catch(() => {});
