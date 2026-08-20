import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import packageJson from './package.json';

const ASSET_PREFIXES = {
  IMG: 'assets/devices/',
  FLAT: 'assets/devices/flat/',
  ORTHO: 'assets/devices/orthographic/',
  GPT: 'assets/devices/gpt/',
  CODEX: 'assets/devices/codex/',
  CODEX_BOM: 'assets/devices/codex/bom/',
  CODEX_EXACT: 'assets/devices/codex/exact/',
} as const;

const STATIC_RUNTIME_DIRECTORIES = [
  'src/device-packs',
  'src/runtime',
  'src/ui',
  'assets/vendor',
  'assets/imported/sov-kdp',
  'assets/models/ls-electric',
  'assets/models/automation',
  'assets/manual-backed',
  'assets/devices/gpt',
  'assets/devices/gpt-expansion',
  'assets/devices/gpt-v24',
] as const;

const BLENDER_WORKFILE = /\.blend\d*$/i;
const SAFE_MODEL_FILE = /^[a-z0-9][a-z0-9._-]*\.glb$/i;
const LARGE_MODEL_WARNING_BYTES = 32 * 1024 * 1024;
const PACKAGED_MODEL_BUDGET_BYTES = 512 * 1024 * 1024;
const MANIFEST_MODEL_COLLECTIONS = [
  {
    manifest: 'assets/imported/sov-kdp/manifest.json',
    modelDirectory: 'assets/imported/sov-kdp/models',
  },
  {
    manifest: 'assets/manual-backed/manifest.json',
    modelDirectory: 'assets/manual-backed',
  },
] as const;
const LOCAL_MODEL_ASSETS = [
  'assets/models/ls-electric/l7sa004a-production-v3.glb',
  'assets/models/automation/palletizer-3axis-v2.glb',
] as const;

function verifyCopiedFile(relativePath: string): void {
  const source = resolve(__dirname, relativePath);
  const target = resolve(__dirname, 'build/renderer', relativePath);
  if (!existsSync(source)) throw new Error(`Runtime source asset is missing: ${relativePath}`);
  if (!existsSync(target)) throw new Error(`Renderer asset was not copied: ${relativePath}`);
  if (statSync(source).size !== statSync(target).size) {
    throw new Error(`Renderer asset size mismatch after copy: ${relativePath}`);
  }
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function verifyGlb(relativePath: string, expected?: { bytes?: unknown; sha256?: unknown }): number {
  verifyCopiedFile(relativePath);
  const source = readFileSync(resolve(__dirname, relativePath));
  const target = readFileSync(resolve(__dirname, 'build/renderer', relativePath));
  if (source.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error(`Invalid GLB magic: ${relativePath}`);
  if (target.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error(`Invalid packaged GLB magic: ${relativePath}`);
  if (typeof expected?.bytes === 'number' && expected.bytes !== source.length) {
    throw new Error(`Manifest byte count mismatch for ${relativePath}: ${expected.bytes} != ${source.length}`);
  }
  const sourceSha = sha256(source);
  if (typeof expected?.sha256 === 'string' && expected.sha256.toLowerCase() !== sourceSha) {
    throw new Error(`Manifest SHA-256 mismatch for ${relativePath}`);
  }
  if (sha256(target) !== sourceSha) throw new Error(`Packaged GLB SHA-256 mismatch: ${relativePath}`);
  if (source.length >= LARGE_MODEL_WARNING_BYTES) {
    console.warn(`[3D asset] Large optional model ${(source.length / 1024 / 1024).toFixed(1)} MiB: ${relativePath}`);
  }
  return source.length;
}

function verifyPackagedModelAssets(): void {
  const blenderLeaks: string[] = [];
  const outputRoot = resolve(__dirname, 'build/renderer');
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (BLENDER_WORKFILE.test(entry.name)) blenderLeaks.push(absolute);
    }
  };
  visit(outputRoot);
  if (blenderLeaks.length) {
    throw new Error(`Blender workfiles leaked into renderer output: ${blenderLeaks.join(', ')}`);
  }

  let packagedModelBytes = 0;
  for (const collection of MANIFEST_MODEL_COLLECTIONS) {
    verifyCopiedFile(collection.manifest);
    const manifest = JSON.parse(readFileSync(resolve(__dirname, collection.manifest), 'utf8')) as {
      models?: Array<{ file?: unknown; bytes?: unknown; sha256?: unknown }>;
    };
    if (!Array.isArray(manifest.models)) throw new Error(`Asset manifest has no models array: ${collection.manifest}`);
    for (const model of manifest.models) {
      if (typeof model.file !== 'string' || !SAFE_MODEL_FILE.test(model.file)) {
        throw new Error(`Unsafe model filename in ${collection.manifest}: ${String(model.file)}`);
      }
      packagedModelBytes += verifyGlb(`${collection.modelDirectory}/${model.file}`, model);
    }
  }
  LOCAL_MODEL_ASSETS.forEach(relativePath => { packagedModelBytes += verifyGlb(relativePath); });
  if (packagedModelBytes > PACKAGED_MODEL_BUDGET_BYTES) {
    throw new Error(`Packaged GLB budget exceeded: ${(packagedModelBytes / 1024 / 1024).toFixed(1)} MiB`);
  }
}

function runtimeAssetPaths(source: string): string[] {
  const paths = new Set<string>();
  const extensions = String.raw`(?:png|webp|jpe?g|svg)`;
  const aliasPattern = new RegExp(
    String.raw`\b(${Object.keys(ASSET_PREFIXES).join('|')})\s*\+\s*['\"]([^'\"]+\.${extensions})['\"]`,
    'gi',
  );
  const directPattern = new RegExp(
    String.raw`['\"](assets\/[^'\"]+\.${extensions})['\"]`,
    'gi',
  );

  for (const match of source.matchAll(aliasPattern)) {
    const prefix = ASSET_PREFIXES[match[1].toUpperCase() as keyof typeof ASSET_PREFIXES];
    paths.add(`${prefix}${match[2]}`);
  }
  for (const match of source.matchAll(directPattern)) paths.add(match[1]);

  return [...paths].sort();
}

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: 'build/renderer',
    emptyOutDir: true,
    // GLTFLoader fetches model URLs at runtime. Vite's default 4 KiB inlining
    // turns very small GLBs into data: URLs, which the offline CSP correctly
    // rejects as a network source. Keep every GLB as a packaged local file.
    assetsInlineLimit(filePath) {
      if (/\.glb$/i.test(filePath)) return false;
      return undefined;
    },
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  plugins: [
    {
      name: 'copy-dynamic-device-assets',
      closeBundle() {
        const html = readFileSync(resolve(__dirname, 'index.html'), 'utf8');
        const assets = runtimeAssetPaths(html);

        for (const relativePath of assets) {
          const source = resolve(__dirname, relativePath);
          if (!existsSync(source)) {
            throw new Error(`Runtime asset is missing: ${relativePath}`);
          }
          const target = resolve(__dirname, 'build/renderer', relativePath);
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(source, target);
        }

        for (const relativeDirectory of STATIC_RUNTIME_DIRECTORIES) {
          const source = resolve(__dirname, relativeDirectory);
          if (!existsSync(source)) {
            throw new Error(`Static runtime directory is missing: ${relativeDirectory}`);
          }
          const target = resolve(__dirname, 'build/renderer', relativeDirectory);
          cpSync(source, target, {
            recursive: true,
            force: true,
            // Blender working files are editable source, not renderer assets.
            // Apply the exclusion to every runtime tree so a newly added
            // collection cannot accidentally ship .blend/.blend1 backups.
            filter: sourcePath => !BLENDER_WORKFILE.test(sourcePath),
          });
        }

        verifyPackagedModelAssets();
      },
    },
  ],
});
