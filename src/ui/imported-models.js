import { GLTFLoader } from '../../assets/vendor/GLTFLoader.js';

// The embedded browser exposes createImageBitmap, so GLTFLoader selects its
// ImageBitmapLoader by default. Some offline Chromium builds cannot decode
// image data through that path even though ordinary DOM images work. Route
// inlined PNG/JPEG/WebP textures through TextureLoader; other resources
// keep GLTFLoader's normal path.
const manager = new globalThis.THREE.LoadingManager();
const webpTextureLoader = new globalThis.THREE.TextureLoader(manager);
manager.addHandler(/^data:image\/(?:png|jpe?g|webp)/i, webpTextureLoader);
const loader = new GLTFLoader(manager);
const cache = new Map();
const requested = new Set();
const loaded = new Set();
const failed = new Map();
// Keep the asset path literal inside new URL so Vite rewrites it relative to
// the emitted module instead of resolving a runtime string from the JS chunk.
const manifestUrl = new URL('../../assets/imported/sov-kdp/manifest.json', import.meta.url);
const localAssets = Object.freeze({
  'l7sa004a-production-v3.glb': Object.freeze({
    url: new URL('../../assets/models/ls-electric/l7sa004a-production-v3.glb', import.meta.url),
    sourceProduct: 'User-authored Blender 5.2 · L7SA004A production v3',
  }),
});

function loadRaw(filename) {
  const resolved = localAssets[filename]?.url.href || new URL(`../../assets/imported/sov-kdp/models/${filename}`, import.meta.url).href;
  requested.add(filename);
  if (!cache.has(resolved)) {
    cache.set(resolved, new Promise((resolve, reject) => {
      loader.load(resolved, gltf => {
        loaded.add(filename);
        failed.delete(filename);
        resolve(gltf.scene);
      }, undefined, error => {
        failed.set(filename, String(error?.message || error));
        reject(error);
      });
    }));
  }
  return cache.get(resolved);
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
  const source = await loadRaw(filename);
  const root = cloneMaterials(source.clone(true));
  root.name = options.name || filename.replace(/\.glb$/i, '');
  root.userData.importedAsset = true;
  root.userData.sourceProduct = localAssets[filename]?.sourceProduct || 'SoV-KDP 1.1.9K';
  if (Number.isFinite(options.scale)) root.scale.setScalar(options.scale);
  if (Array.isArray(options.position)) root.position.set(...options.position);
  if (Array.isArray(options.rotation)) root.rotation.set(...options.rotation);
  return root;
}

async function loadManifest() {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Asset manifest HTTP ${response.status}`);
  return response.json();
}

window.PLCTrainerImportedModels = Object.freeze({
  version: '1.0.0',
  loadModel,
  loadManifest,
  getStatus: () => ({ requested: [...requested], loaded: [...loaded], failed: [...failed].map(([filename, error]) => ({ filename, error })) }),
  clearCache: () => { cache.clear(); requested.clear(); loaded.clear(); failed.clear(); },
});
window.dispatchEvent(new CustomEvent('plc-trainer-imported-models-ready'));
