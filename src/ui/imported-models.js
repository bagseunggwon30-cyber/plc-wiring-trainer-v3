import { GLTFLoader } from '../../assets/vendor/GLTFLoader.js';

// The embedded browser exposes createImageBitmap, so GLTFLoader selects its
// ImageBitmapLoader by default. Some offline Chromium builds cannot decode
// WebP through that path even though ordinary DOM images work. Route only the
// inlined WebP textures through TextureLoader; geometry and other resources
// keep GLTFLoader's normal path.
const manager = new globalThis.THREE.LoadingManager();
const webpTextureLoader = new globalThis.THREE.TextureLoader(manager);
manager.addHandler(/^data:image\/webp/i, webpTextureLoader);
const loader = new GLTFLoader(manager);
const cache = new Map();
const requested = new Set();
const loaded = new Set();
const failed = new Map();
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
let catalogPromise = null;

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.allSettled(manifestSources.map(async source => {
      // Resolve runtime data from the document root. Vite bundles this module
      // under build/renderer/assets, while its unbundled source lives under
      // src/ui; import.meta.url therefore cannot represent both layouts.
      const response = await fetch(new URL(source.manifestUrl, document.baseURI));
      if (!response.ok) throw new Error(`${source.id} asset manifest HTTP ${response.status}`);
      const manifest = await response.json();
      const models = Array.isArray(manifest.models) ? manifest.models : [];
      return models
        .filter(entry => typeof entry?.file === 'string' && /^[^/\\]+\.glb$/i.test(entry.file))
        .map(entry => ({ ...entry, assetCollection: source.id, sourceProduct: source.sourceProduct, modelBaseUrl: source.modelBaseUrl }));
    })).then(results => {
      const models = [], errors = [];
      for (const result of results) {
        if (result.status === 'fulfilled') models.push(...result.value);
        else errors.push(String(result.reason?.message || result.reason));
      }
      if (!models.length) throw new Error(errors.join('; ') || 'No 3D asset manifests were available');
      const locations = new Map(models.map(entry => [entry.file, entry]));
      return { models, locations, errors };
    });
  }
  return catalogPromise;
}

async function loadRaw(filename) {
  const catalog = await loadCatalog();
  const entry = catalog.locations.get(filename);
  if (!entry) throw new Error(`Unknown 3D equipment asset: ${filename}`);
  const resolved = new URL(`${entry.modelBaseUrl}${filename}`, document.baseURI).href;
  requested.add(filename);
  if (!cache.has(resolved)) {
    const load = new Promise((resolve, reject) => {
      loader.load(resolved, gltf => {
        loaded.add(filename);
        failed.delete(filename);
        resolve(gltf.scene);
      }, undefined, error => {
        failed.set(filename, String(error?.message || error));
        reject(error);
      });
    });
    const memoized = load.catch(error => {
      if (cache.get(resolved) === memoized) cache.delete(resolved);
      throw error;
    });
    cache.set(resolved, memoized);
  }
  return { scene: await cache.get(resolved), entry };
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
  const { scene: source, entry } = await loadRaw(filename);
  const root = cloneMaterials(source.clone(true));
  root.name = options.name || filename.replace(/\.glb$/i, '');
  root.userData.importedAsset = true;
  root.userData.sourceProduct = entry.sourceProduct;
  root.userData.assetCollection = entry.assetCollection;
  root.userData.manualEvidence = entry.evidence || null;
  if (Number.isFinite(options.scale)) root.scale.setScalar(options.scale);
  if (Array.isArray(options.position)) root.position.set(...options.position);
  if (Array.isArray(options.rotation)) root.rotation.set(...options.rotation);
  return root;
}

async function loadManifest() {
  const catalog = await loadCatalog();
  return {
    schemaVersion: 1,
    sourceTool: 'mixed',
    models: catalog.models.map(({ modelBaseUrl, ...entry }) => entry),
    warnings: catalog.errors,
  };
}

window.PLCTrainerImportedModels = Object.freeze({
  version: '1.1.0',
  loadModel,
  loadManifest,
  getStatus: () => ({ requested: [...requested], loaded: [...loaded], failed: [...failed].map(([filename, error]) => ({ filename, error })) }),
  clearCache: () => { cache.clear(); requested.clear(); loaded.clear(); failed.clear(); catalogPromise = null; },
});
window.dispatchEvent(new CustomEvent('plc-trainer-imported-models-ready'));
