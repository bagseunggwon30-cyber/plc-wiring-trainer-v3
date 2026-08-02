import { _electron as electron, expect, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ElectronHarness {
  app: ElectronApplication;
  page: Page;
  readMainNetworkAudit: () => Promise<{ externalRequests: string[]; failedRequests: string[] } | null>;
  externalRequests: string[];
  failedRequests: string[];
  consoleErrors: string[];
  pageErrors: string[];
  userDataDir: string;
}

interface Fixtures {
  harness: ElectronHarness;
}

function isExternalRequest(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
  return !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
}

export const test = base.extend<Fixtures>({
  harness: async ({}, use) => {
    const executablePath = require('electron') as string;
    // Never point release-gate automation at the production Electron profile.
    // The suite intentionally clears localStorage to get deterministic tests.
    const userDataDir = await mkdtemp(join(tmpdir(), 'wiring-trainer-e2e-'));
    const app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDir}`, '.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        WIRING_E2E_NETWORK_AUDIT: '1',
      },
      // A cold Electron start on Windows can spend more than 30 seconds in
      // antivirus/code-signature inspection even after both debugger sockets
      // are listening. Keep the isolated-profile launch bounded, but allow the
      // application handshake to finish instead of turning that host delay
      // into an unrelated release-gate failure.
      timeout: 60_000,
    });

    const page = await app.firstWindow({ timeout: 10_000 });
    // Let Electron's first file:// navigation finish before the deterministic
    // reload below. Reloading an in-flight script request produces a spurious
    // ERR_ABORTED/ERR_FILE_NOT_FOUND console error on slower launches.
    await page.waitForLoadState('load');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1);
    });
    const externalRequests: string[] = [];
    const failedRequests: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('request', (request) => {
      if (isExternalRequest(request.url())) externalRequests.push(request.url());
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.url()} · ${request.failure()?.errorText ?? 'unknown failure'}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location();
        consoleErrors.push(`${message.text()} · ${location.url || 'unknown source'}:${location.lineNumber ?? 0}`);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // The production file:// origin uses persistent Electron storage. Clear it,
    // then reload while observers are attached so every renderer request in the
    // deterministic test session is accounted for.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#workshop-mode-selector')).toBeVisible();
    const readMainNetworkAudit = () => app.evaluate(() => (
      globalThis as typeof globalThis & {
        __WIRING_NETWORK_AUDIT__?: { externalRequests: string[]; failedRequests: string[] };
      }
    ).__WIRING_NETWORK_AUDIT__ ?? null);

    try {
      await use({ app, page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors, userDataDir });
    } finally {
      await app.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});

export { expect } from '@playwright/test';
