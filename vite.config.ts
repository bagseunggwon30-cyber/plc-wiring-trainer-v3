import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import packageJson from './package.json';

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
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  plugins: [
    {
      name: 'copy-dynamic-device-assets',
      closeBundle() {
        const source = resolve(__dirname, 'assets');
        const target = resolve(__dirname, 'build/renderer/assets');
        if (!existsSync(source)) return;
        mkdirSync(target, { recursive: true });
        cpSync(source, target, { recursive: true });
      },
    },
  ],
});
