import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './electron.fixture';

test('Blender L7SA004A drives load in the LS servo lab and expose real CN1 wiring targets', async ({ harness }) => {
  const { app, page, consoleErrors, pageErrors, failedRequests } = harness;
  const launchedViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(launchedViewport.width).toBeGreaterThan(900);
  expect(launchedViewport.height).toBeGreaterThan(600);

  const practiceButton = page.locator('#workshop-mode-selector').getByRole('button', { name: /연습 모드/ });
  if (await practiceButton.count()) await practiceButton.click();
  if (!await page.locator('#al-hub').isVisible()) {
    await page.locator('#advanced-tools > summary').click();
    await expect(page.locator('.mv-view-btn[data-view="palletizer"]')).toBeVisible();
    await page.locator('.mv-view-btn[data-view="palletizer"]').click();
  }
  await expect(page.locator('#al-hub')).toBeVisible();
  await page.locator('.al-tab[data-lab="servo2"]').click();
  await expect(page.locator('[data-lab-pane="servo2"]')).toHaveClass(/active/);

  await expect.poll(async () => page.evaluate(() => {
    const diagnostics = (window as unknown as {
      PLCTrainerAutomationLabs: { getSceneDiagnostics(): { servo2: { equipmentModels: Array<{ sourceAsset?: string; evidence?: string }> } } };
    }).PLCTrainerAutomationLabs.getSceneDiagnostics();
    return diagnostics.servo2.equipmentModels.filter(model => model.sourceAsset === 'l7sa004a-production-v3.glb').length;
  })).toBe(2);

  await page.locator('[data-editor-tools="servo2"] [data-editor-mode="WIRE"]').click();
  await expect(page.locator('[data-editor-tools="servo2"] [data-editor-mode="WIRE"]')).toHaveClass(/active/);
  await page.locator('[data-servo-pulse="reference"]').click();

  const diagnostics = await page.evaluate(() => (window as unknown as {
    PLCTrainerAutomationLabs: { getSceneDiagnostics(): {
      editors: { servo2: { mode: string; connections: number } };
      terminalTargets: { servo2: { enabled: number; physicalSurfaces: number; screenTargets: Array<{ moduleId: string; anchorId: string; x: number; y: number; physicalSurface: boolean }> } };
      servo2: { equipmentModels: Array<{ sourceAsset?: string; evidence?: string; dimensions: { width: number; height: number; depth: number } }>; pulseTopology: string };
    } };
  }).PLCTrainerAutomationLabs.getSceneDiagnostics());

  const drives = diagnostics.servo2.equipmentModels.filter(model => model.sourceAsset === 'l7sa004a-production-v3.glb');
  expect(drives).toHaveLength(2);
  expect(drives.every(model => model.evidence === 'USER-BLENDER-5.2-L7SA004A-PRODUCTION-V3')).toBe(true);
  expect(drives.every(model => model.dimensions.height > 0.22 && model.dimensions.height < 0.23)).toBe(true);
  expect(diagnostics.editors.servo2).toMatchObject({ mode: 'WIRE', connections: 8 });
  expect(diagnostics.servo2.pulseTopology).toBe('PASS');
  const l7Targets = diagnostics.terminalTargets.servo2.screenTargets.filter(target => target.moduleId === 'pulse-ls-axis-x' || target.moduleId === 'pulse-ls-axis-y');
  expect(l7Targets).toHaveLength(8);
  expect(new Set(l7Targets.map(target => `${target.moduleId}:${target.anchorId}`)).size).toBe(8);
  expect(l7Targets.every(target => target.physicalSurface)).toBe(true);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1500, 900));
  await expect.poll(async () => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 1500, height: 900 });
  await page.evaluate(() => {
    const labs = (window as unknown as { PLCTrainerAutomationLabs: { resize(): void; renderActive(): void } }).PLCTrainerAutomationLabs;
    labs.resize();
    labs.renderActive();
  });
  await page.waitForTimeout(750);
  const sceneRect = await page.locator('[data-scene="servo2"]').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  expect(sceneRect.left).toBeGreaterThanOrEqual(0);
  expect(sceneRect.top).toBeGreaterThanOrEqual(0);
  expect(sceneRect.right).toBeLessThanOrEqual(sceneRect.viewportWidth + 1);
  expect(sceneRect.bottom).toBeLessThanOrEqual(sceneRect.viewportHeight + 1);
  expect(sceneRect.width).toBeGreaterThan(800);
  expect(sceneRect.height).toBeGreaterThan(600);

  const screenshotPath = resolve('artifacts', 'l7sa004a-electron-integration.png');
  await mkdir(resolve('artifacts'), { recursive: true });
  await page.screenshot({ path: screenshotPath, type: 'png' });

  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
