import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

export default function globalSetup(): void {
  const npmCli = process.env.npm_execpath
    ?? resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const result = spawnSync(process.execPath, [npmCli, 'run', 'build:renderer'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Renderer build failed before Electron E2E (exit ${result.status ?? 'unknown'}).`);
  }
}
