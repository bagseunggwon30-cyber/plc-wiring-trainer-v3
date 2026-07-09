import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './electron.fixture';

const VERIFIED_PREWIRE_TYPES = [
  'BOUNDARY-AC',
  'BOUNDARY-CONTACT',
  'BOUNDARY-DC',
  'BOUNDARY-LOAD',
  'BOUNDARY-RS485',
  'MDR-100',
  'XBC-DR32H',
  'XBF-AH04A',
].sort();

const PREWIRE_MISSIONS = [
  'MDR AC 입력과 DC24V 배전',
  'XBC 입력의 소스/싱크 결선',
  'XBC 릴레이 출력 강제 시험',
  'XBF-AH04A 전압·전류 채널 결선',
];

const WORKSHOP_V2_KEY = 'plc-wiring-trainer:workshop-document-v2';

interface AxeSummary {
  id: string;
  impact: string | null;
  targets: unknown[];
}

async function seriousAxeViolations(page: Page, include?: string): Promise<AxeSummary[]> {
  // Electron's BrowserContext intentionally does not implement newPage(). Axe's
  // legacy mode injects and runs axe in the existing desktop renderer instead.
  let builder = new AxeBuilder({ page })
    .setLegacyMode()
    .options({
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      targets: violation.nodes.map((node) => node.target),
    }));
}

async function chooseMode(page: Page, mode: 'practice' | 'prewire'): Promise<void> {
  const name = mode === 'practice' ? /연습 모드/ : /사전 결선 검토/;
  await page.locator('#workshop-mode-selector').getByRole('button', { name }).click();
  await expect(page.locator('body')).toHaveAttribute('data-workshop-mode', mode);
  await expect(page.locator('#workshop-mode-selector')).toHaveCount(0);
}

function mdrReferenceDocument() {
  const device = (
    id: string,
    profileId: string,
    profileVersion: string,
    evidenceLevel: 'manual-verified' | 'bench-verified',
    x: number,
  ) => ({
    id,
    profileId,
    profileVersion,
    evidenceLevel,
    missingProfile: false,
    x,
    y: 320,
    rotation: 0,
    configuration: {},
  });

  return {
    schemaVersion: 2 as const,
    mode: 'prewire' as const,
    revision: 11,
    name: 'Electron E2E · MDR reference',
    source: { kind: 'native-v2' as const, hash: '0'.repeat(64) },
    devices: [
      device('ac-e2e', 'boundary:ac-supply', '1.0.0', 'bench-verified', 360),
      device('mdr-e2e', 'mean-well:mdr-100-24', '1.0.0', 'manual-verified', 920),
      device('load-e2e', 'boundary:load', '1.0.0', 'bench-verified', 1480),
    ],
    wires: [
      { id: 'wire-l', from: { deviceId: 'ac-e2e', terminalId: 'L1' }, to: { deviceId: 'mdr-e2e', terminalId: 'L' } },
      { id: 'wire-n', from: { deviceId: 'ac-e2e', terminalId: 'N' }, to: { deviceId: 'mdr-e2e', terminalId: 'N' } },
      { id: 'wire-pe', from: { deviceId: 'ac-e2e', terminalId: 'PE' }, to: { deviceId: 'mdr-e2e', terminalId: 'PE' } },
      { id: 'wire-plus', from: { deviceId: 'mdr-e2e', terminalId: 'V+1' }, to: { deviceId: 'load-e2e', terminalId: '+' } },
      { id: 'wire-minus', from: { deviceId: 'mdr-e2e', terminalId: 'V-1' }, to: { deviceId: 'load-e2e', terminalId: '-' } },
    ],
    jumpers: [],
    layout: {},
    settings: {
      missionId: 'mdr-ac-dc-distribution',
      roleBindings: { acSupply: 'ac-e2e', powerSupply: 'mdr-e2e', dcLoad: 'load-e2e' },
    },
    extensions: { legacy: { nextId: 100 } },
  };
}

async function bridgeState(page: Page): Promise<{
  devices: Record<string, { type: string; x: number; y: number }>;
  wires: Array<{ from: { dev: string; term: string }; to: { dev: string; term: string } }>;
}> {
  return page.evaluate(() => {
    const bridge = (window as unknown as {
      LegacyTrainerBridge: { readState(): unknown };
    }).LegacyTrainerBridge;
    return bridge.readState() as {
      devices: Record<string, { type: string; x: number; y: number }>;
      wires: Array<{ from: { dev: string; term: string }; to: { dev: string; term: string } }>;
    };
  });
}

async function clickSvgTerminal(page: Page, deviceId: string, terminalId: string): Promise<void> {
  const terminal = page.locator(
    `#g-terminals .terminal-hit[data-id="${deviceId}"][data-term="${terminalId}"]`,
  );
  await expect(terminal).toHaveCount(1);
  // Dispatch against the SVG node itself. Pointer coordinates can sit outside
  // the clipped viewport after panel auto-fit, while the editor's event model
  // intentionally keys the terminal by data-id/data-term and bubbles to #canvas.
  await terminal.dispatchEvent('mousedown', { button: 0, clientX: 10, clientY: 10 });
  await terminal.dispatchEvent('mouseup', { button: 0, clientX: 10, clientY: 10 });
}

test.describe.configure({ mode: 'serial' });

test('offline policy blocks main-process and session network before transmission', async ({ harness }) => {
  const { app, externalRequests, failedRequests, pageErrors } = harness;
  const probe = await app.evaluate(async ({ net }) => {
    let mainBlocked = false;
    let mainHttpsBlocked = false;
    let sessionBlocked = false;
    try { await fetch('https://example.invalid/main-probe'); } catch { mainBlocked = true; }
    try {
      process.getBuiltinModule('https').get('https://example.invalid/main-https-probe');
    } catch { mainHttpsBlocked = true; }
    try { await net.fetch('https://example.invalid/session-probe'); } catch { sessionBlocked = true; }
    const audit = (globalThis as typeof globalThis & {
      __WIRING_NETWORK_AUDIT__: { externalRequests: string[]; failedRequests: string[] };
    }).__WIRING_NETWORK_AUDIT__;
    for (let attempt = 0; attempt < 50 && audit.failedRequests.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { mainBlocked, mainHttpsBlocked, sessionBlocked, audit };
  });

  expect(probe.mainBlocked).toBe(true);
  expect(probe.mainHttpsBlocked).toBe(true);
  expect(probe.sessionBlocked).toBe(true);
  expect(probe.audit.externalRequests).toEqual([
    'main:https://example.invalid/main-probe',
    'main:https://example.invalid/main-https-probe',
    'session:https://example.invalid/session-probe',
  ]);
  expect(probe.audit.failedRequests).toContain(
    'session:https://example.invalid/session-probe · net::ERR_BLOCKED_BY_CLIENT',
  );
  expect(externalRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('startup keyboard flow separates practice and verified prewire modes', async ({ harness }) => {
  const { page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors } = harness;

  await expect(page).toHaveURL(/^file:\/\/\//);
  const dialog = page.locator('#workshop-mode-selector');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('button', { name: /연습 모드/ })).toBeFocused();
  expect(await seriousAxeViolations(page, '#workshop-mode-selector')).toEqual([]);

  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: /사전 결선 검토/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: /연습 모드/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: /사전 결선 검토/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: /연습 모드/ })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('#stat')).toHaveAttribute('role', 'status');
  await expect(page.locator('#stat')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('.mission-v2-header')).toHaveCount(7);
  await expect(page.locator('#palette .pal[data-type="IG5A"]')).toBeVisible();
  await expect(page.locator('#palette .pal[data-type="MY-MD02"]')).toBeVisible();
  await page.locator('.mission-v2-header').first().click();
  await expect(page.getByRole('button', { name: '개념 힌트 보기' })).toBeVisible();
  expect(await seriousAxeViolations(page)).toEqual([]);

  await page.locator('#advanced-tools > summary').click();
  const railConfigButton = page.locator('#b-rail-config');
  await railConfigButton.click();
  const railDialog = page.locator('#rail-config-modal');
  await expect(railDialog).toBeVisible();
  await expect(railDialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#modal-rail-rows')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#modal-rail-apply')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#modal-rail-rows')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(railDialog).toBeHidden();
  await expect(railConfigButton).toBeFocused();
  await page.locator('#advanced-tools > summary').click();

  await page.locator('#b-workshop-mode').click();
  await page.locator('#workshop-mode-selector').getByRole('button', { name: /사전 결선 검토/ }).click();
  const visibleTypes = (await page.locator('#palette .pal:visible').evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).dataset.type ?? '').sort(),
  ));
  expect(visibleTypes).toEqual(VERIFIED_PREWIRE_TYPES);
  await expect(page.locator('#palette .pal[data-type="MCCB"]')).toBeHidden();
  await expect(page.locator('#palette .pal[data-type="IG5A"]')).toBeHidden();
  await expect(page.locator('#palette .pal[data-type="MY-MD02"]')).toBeHidden();
  await expect(page.locator('.auto-wire-btn:visible')).toHaveCount(0);
  await expect(page.locator('.mission-hints')).toHaveCount(0);
  await expect(page.locator('.mission-v2-header strong')).toHaveText(PREWIRE_MISSIONS);

  const firstPrewireMission = page.locator('.mission-v2').first();
  if (!(await firstPrewireMission.evaluate((card) => card.classList.contains('active')))) {
    await firstPrewireMission.locator('.mission-v2-header').click();
  }
  const roleSelectors = firstPrewireMission.locator('.mission-role select');
  await expect(roleSelectors).toHaveCount(3);
  for (const selector of await roleSelectors.all()) {
    await expect(selector).toHaveValue('');
    await expect(selector.locator('option').first()).toHaveText('장비를 직접 선택');
  }

  expect(await seriousAxeViolations(page)).toEqual([]);
  expect(await readMainNetworkAudit()).toEqual({ externalRequests: [], failedRequests: [] });
  expect(externalRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Electron UI places and wires devices, then validates, simulates, restores and reports a reference circuit', async ({ harness }) => {
  const { page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'prewire');

  // Exercise the real SVG editor before deterministic seeding: palette placement
  // followed by two terminal clicks must produce a physical wire.
  await page.locator('#palette .pal[data-type="BOUNDARY-AC"]').click();
  await page.locator('#palette .pal[data-type="MDR-100"]').click();
  const placed = await bridgeState(page);
  const acId = Object.entries(placed.devices).find(([, entry]) => entry.type === 'BOUNDARY-AC')?.[0];
  const mdrId = Object.entries(placed.devices).find(([, entry]) => entry.type === 'MDR-100')?.[0];
  expect(acId).toBeTruthy();
  expect(mdrId).toBeTruthy();
  await clickSvgTerminal(page, acId!, 'L1');
  await clickSvgTerminal(page, mdrId!, 'L');
  await expect.poll(async () => (await bridgeState(page)).wires.length).toBe(1);

  const reference = mdrReferenceDocument();
  await page.evaluate((documentV2) => {
    const target = window as unknown as {
      LegacyTrainerBridge: { applyDocumentV2(document: unknown): void };
      WorkshopV2Controller: { renderMissions(): void };
    };
    target.LegacyTrainerBridge.applyDocumentV2(documentV2);
    target.WorkshopV2Controller.renderMissions();
  }, reference);
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(3);

  await page.getByRole('button', { name: new RegExp(`^${PREWIRE_MISSIONS[0]}`) }).click();
  await page.getByRole('combobox', { name: /AC 공급원/ }).selectOption('ac-e2e');
  await page.getByRole('combobox', { name: /MDR 전원공급장치/ }).selectOption('mdr-e2e');
  await page.getByRole('combobox', { name: /DC 부하 경계/ }).selectOption('load-e2e');
  await page.getByRole('button', { name: '이 미션 검증' }).click();
  await expect(page.locator('#validation .core-validation-status')).toContainText('PASS');

  await page.locator('#b-simulate').click();
  await expect(page.locator('#sim-monitor')).toContainText('결정적 I/O 시험 · PASS');
  await expect(page.locator('#sim-monitor > div')).toHaveCount(3);
  await expect(page.locator('#sim-monitor')).toContainText('ac-input-valid');
  await expect(page.locator('#sim-monitor')).toContainText('dc-output-loaded');
  await expect(page.locator('#sim-monitor > div').nth(1)).toContainText('통전단자 14');

  await page.locator('#b-save').click();
  await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), WORKSHOP_V2_KEY)).not.toBeNull();

  await page.evaluate((emptyDocument) => {
    (window as unknown as {
      LegacyTrainerBridge: { applyDocumentV2(document: unknown): void };
    }).LegacyTrainerBridge.applyDocumentV2(emptyDocument);
  }, { ...reference, revision: 12, devices: [], wires: [], settings: {} });
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(0);

  await page.locator('#advanced-tools > summary').click();
  await page.locator('#b-load').click();
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(3);
  await expect.poll(async () => (await bridgeState(page)).wires.length).toBe(5);
  await expect(page.locator('body')).toHaveAttribute('data-workshop-mode', 'prewire');

  await page.evaluate(() => {
    const target = window as unknown as {
      LegacyTrainerBridge: { downloadJson(value: unknown, filename: string): void };
      __capturedReviewReport?: { value: unknown; filename: string };
    };
    target.LegacyTrainerBridge.downloadJson = (value, filename) => {
      target.__capturedReviewReport = { value, filename };
    };
  });
  await page.locator('#b-export-report').click();
  await expect.poll(async () => page.evaluate(() =>
    (window as unknown as {
      __capturedReviewReport?: { value: unknown; filename: string };
    }).__capturedReviewReport ?? null,
  )).not.toBeNull();
  const reportCapture = await page.evaluate(() =>
    (window as unknown as {
      __capturedReviewReport: { value: unknown; filename: string };
    }).__capturedReviewReport,
  );
  expect(reportCapture.filename).toBe('prewire-verified-r11.json');
  const report = reportCapture.value as {
    classification: string;
    document: { validationStatus: string; revision: number };
    pinToPin: unknown[];
    bom: Array<{ profileId: string; quantity: number }>;
  };
  expect(report.classification).toBe('VERIFIED');
  expect(report.document).toMatchObject({ validationStatus: 'PASS', revision: 11 });
  expect(report.pinToPin).toHaveLength(5);
  expect(report.bom).toEqual([
    expect.objectContaining({ profileId: 'mean-well:mdr-100-24', quantity: 1 }),
  ]);

  expect(await readMainNetworkAudit()).toEqual({ externalRequests: [], failedRequests: [] });
  expect(externalRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test.describe('environment-sensitive render performance', () => {
  test.describe.configure({ retries: 1 });

test('device drag render sampling sustains the 30fps release target', async ({ harness }, testInfo) => {
  const { page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors } = harness;
  testInfo.annotations.push({
    type: 'environment-sensitive',
    description: 'rAF sampling during a real Electron pointer drag; rerun on the release workstation if host load is elevated.',
  });
  await chooseMode(page, 'practice');
  await page.locator('#palette .pal[data-type="MDR-100"]').click();

  const before = await bridgeState(page);
  const deviceId = Object.entries(before.devices).find(([, entry]) => entry.type === 'MDR-100')?.[0];
  expect(deviceId).toBeTruthy();
  const image = page.locator(`#g-devices .device[data-id="${deviceId}"] .device-image`);
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  const viewportWidth = await page.evaluate(() => innerWidth);
  const travelX = startX + 220 < viewportWidth ? 180 : -180;

  await page.evaluate(() => {
    let resolveDone!: () => void;
    const probe = {
      intervals: [] as number[],
      lastTimestamp: null as number | null,
      running: true,
      done: new Promise<void>((resolve) => { resolveDone = resolve; }),
      resolveDone,
    };
    (window as unknown as { __dragFrameProbe: typeof probe }).__dragFrameProbe = probe;
    const sample = (timestamp: number) => {
      if (probe.lastTimestamp !== null) probe.intervals.push(timestamp - probe.lastTimestamp);
      probe.lastTimestamp = timestamp;
      if (probe.running) requestAnimationFrame(sample);
      else probe.resolveDone();
    };
    requestAnimationFrame(sample);
  });

  await image.dispatchEvent('mousedown', {
    button: 0,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  });
  for (let step = 1; step <= 60; step += 1) {
    const ratio = step / 60;
    await page.mouse.move(
      startX + travelX * ratio,
      startY + Math.sin(ratio * Math.PI * 2) * 8,
    );
    await page.waitForTimeout(12);
  }
  await page.locator('#canvas').dispatchEvent('mouseup', {
    button: 0,
    clientX: startX + travelX,
    clientY: startY,
  });

  const metrics = await page.evaluate(async () => {
    const probe = (window as unknown as {
      __dragFrameProbe: {
        intervals: number[];
        running: boolean;
        done: Promise<void>;
      };
    }).__dragFrameProbe;
    probe.running = false;
    await probe.done;
    const intervals = probe.intervals.filter((interval) => interval > 0);
    const averageIntervalMs = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const ordered = [...intervals].sort((left, right) => left - right);
    const p95IntervalMs = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))];
    return {
      frameCount: intervals.length,
      averageIntervalMs,
      averageFps: 1000 / averageIntervalMs,
      p95IntervalMs,
      p95Fps: 1000 / p95IntervalMs,
    };
  });
  await testInfo.attach('drag-render-metrics.json', {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: 'application/json',
  });

  const after = await bridgeState(page);
  expect(after.devices[deviceId!].x).not.toBe(before.devices[deviceId!].x);
  expect(metrics.frameCount).toBeGreaterThanOrEqual(20);
  expect(metrics.averageFps).toBeGreaterThanOrEqual(30);
  expect(metrics.p95Fps).toBeGreaterThanOrEqual(30);
  expect(await readMainNetworkAudit()).toEqual({ externalRequests: [], failedRequests: [] });
  expect(externalRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

});

test('1280x720, 200% zoom and reduced-motion states keep the core flow usable', async ({ harness }) => {
  const { app, page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors } = harness;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 720);
  });
  await expect.poll(async () => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 1280,
    height: 720,
  });

  const normalMotion = await page.locator('body').evaluate((element) => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(normalMotion).toEqual({ matches: false, transitionDuration: '0.2s' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await chooseMode(page, 'practice');
  const reducedMotion = await page.locator('body').evaluate((element) => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(reducedMotion.matches).toBe(true);
  expect(['0s', '0.00001s', '1e-05s']).toContain(reducedMotion.transitionDuration);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2);
  });
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
  )).toBe(2);
  await expect(page.locator('#b-validate')).toBeVisible();
  await expect(page.locator('#b-workshop-mode')).toBeVisible();
  const zoomedLayout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { width: box.width, height: box.height, left: box.left, right: box.right } : null;
    };
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      palette: rect('#palette'),
      stage: rect('#stage'),
      rightPanel: rect('#right'),
      canvas: rect('#canvas'),
    };
  });
  expect(zoomedLayout.documentWidth).toBeLessThanOrEqual(zoomedLayout.viewportWidth + 1);
  for (const region of [zoomedLayout.palette, zoomedLayout.stage, zoomedLayout.rightPanel, zoomedLayout.canvas]) {
    expect(region).not.toBeNull();
    expect(region!.width).toBeGreaterThan(0);
    expect(region!.height).toBeGreaterThan(0);
    expect(region!.left).toBeGreaterThanOrEqual(0);
    expect(region!.right).toBeLessThanOrEqual(zoomedLayout.viewportWidth + 1);
  }
  expect(zoomedLayout.palette!.right).toBeLessThanOrEqual(zoomedLayout.stage!.left + 1);
  expect(zoomedLayout.stage!.right).toBeLessThanOrEqual(zoomedLayout.rightPanel!.left + 1);
  await page.locator('#b-validate').click();
  await expect(page.locator('#stat')).toContainText('검증 완료');

  await page.locator('#b-workshop-mode').click();
  await expect(page.locator('#workshop-mode-selector')).toBeVisible();
  await expect(page.locator('#workshop-mode-selector').getByRole('button', { name: /사전 결선 검토/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#workshop-mode-selector').getByRole('button', { name: /연습 모드/ })).toBeFocused();

  expect(await readMainNetworkAudit()).toEqual({ externalRequests: [], failedRequests: [] });
  expect(externalRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
