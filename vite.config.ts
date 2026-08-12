import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
  'assets/devices/gpt',
  'assets/devices/gpt-expansion',
  'assets/devices/gpt-v24',
] as const;

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
          cpSync(source, target, { recursive: true, force: true });
        }
      },
    },
  ],
});
