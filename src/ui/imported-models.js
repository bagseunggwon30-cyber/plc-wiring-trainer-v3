import { GLTFLoader } from '../../assets/vendor/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();
const requested = new Set();
const loaded = new Set();
const failed = new Map();
const manifestUrl = '../../assets/imported/sov-kdp/manifest.json';

function loadRaw(filename) {
  const resolved = new URL(`../../assets/imported/sov-kdp/models/${filename}`, import.meta.url).href;
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
  root.userData.sourceProduct = 'SoV-KDP 1.1.9K';
  if (Number.isFinite(options.scale)) root.scale.setScalar(options.scale);
  if (Array.isArray(options.position)) root.position.set(...options.position);
  if (Array.isArray(options.rotation)) root.rotation.set(...options.rotation);
  return root;
}

async function loadManifest() {
  const response = await fetch(new URL(manifestUrl, import.meta.url));
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
