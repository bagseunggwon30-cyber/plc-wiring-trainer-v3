import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './electron.fixture';

const MANUAL_FILES = [
  'xbc-dr32h.glb',
  'mdr-100-24.glb',
  'mc-22b-dc24.glb',
  'my2n-d2-dc24.glb',
  'eocr3de-05duh.glb',
  'ut-2-5-3044076.glb',
  'ut-2-5-pe-3044092.glb',
  'ut-4-hesi-3046032.glb',
].sort();

test('manual-backed Blender equipment loads into the wireable 3D lab from packaged paths', async ({ harness }) => {
  const { page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors } = harness;
  expect(existsSync(resolve('build/renderer/assets/manual-backed/manual-backed-equipment.blend'))).toBe(false);
  expect(existsSync(resolve('build/renderer/assets/manual-backed/manual-backed-equipment.blend1'))).toBe(false);
  await page.locator('#workshop-mode-selector').getByRole('button', { name: /연습 모드/ }).click();
  // The compact startup layout hides the advanced multi-view toolbar. Exercise
  // the same production route through its public controller API.
  await page.waitForFunction(() => typeof (
    window as unknown as { PLCTrainerMultiView?: { setView?: unknown } }
  ).PLCTrainerMultiView?.setView === 'function');
  await page.evaluate(() => (
    window as unknown as { PLCTrainerMultiView: { setView(view: string): void } }
  ).PLCTrainerMultiView.setView('palletizer'));
  await expect(page.locator('#al-hub')).toBeVisible();
  await page.locator('.al-tab[data-lab="discrete"]').click();
  await expect(page.locator('.al-pane[data-lab-pane="discrete"]')).toHaveClass(/active/);

  await expect.poll(async () => page.evaluate(() => {
    const api = (window as unknown as {
      PLCTrainerImportedModels: { getStatus(): { loaded: string[] } };
    }).PLCTrainerImportedModels;
    return api.getStatus().loaded.filter((file) => file.includes('.glb'));
  }), { timeout: 30_000 }).toEqual(expect.arrayContaining(MANUAL_FILES));

  const requiredModules = [
    'source', 'plc', 'relay', 'manual-mc', 'manual-eocr', 'manual-ut', 'manual-ut-pe', 'manual-ut-fuse',
  ];
  await expect.poll(async () => page.evaluate((required) => {
    const diagnostics = (window as unknown as {
      PLCTrainerAutomationLabs: { getSceneDiagnostics(): { discrete: { importedAssets: string[] } } };
      PLCTrainerImportedModels: { getStatus(): unknown };
    }).PLCTrainerAutomationLabs.getSceneDiagnostics();
    return {
      missing: required.filter((moduleId) => !diagnostics.discrete.importedAssets.includes(moduleId)),
      importedAssets: diagnostics.discrete.importedAssets,
      modelStatus: (window as unknown as { PLCTrainerImportedModels: { getStatus(): unknown } }).PLCTrainerImportedModels.getStatus(),
    };
  }, requiredModules), { timeout: 30_000 }).toMatchObject({ missing: [] });

  const diagnostics = await page.evaluate(() => (
    window as unknown as {
      PLCTrainerAutomationLabs: { getSceneDiagnostics(): {
        discrete: { importedAssets: string[] };
        terminalTargets: { discrete: { physicalSurfaces: number; visibleFloatingMarkers: number } };
        equipment3d: { catalogCount: number };
        cameras: { discrete: { aspect: number; scale: number; fitPreset: string | null; proxyRootFitsView: boolean } };
      } };
    }
  ).PLCTrainerAutomationLabs.getSceneDiagnostics());
  expect(diagnostics.discrete.importedAssets).toEqual(expect.arrayContaining(requiredModules));
  expect(diagnostics.terminalTargets.discrete.physicalSurfaces).toBeGreaterThanOrEqual(100);
  expect(diagnostics.terminalTargets.discrete.visibleFloatingMarkers).toBe(0);
  expect(diagnostics.equipment3d.catalogCount).toBeGreaterThanOrEqual(41);
  expect(diagnostics.cameras.discrete.fitPreset).toBe('default');
  expect(diagnostics.cameras.discrete.scale).toBeGreaterThan(7);
  expect(diagnostics.cameras.discrete.proxyRootFitsView).toBe(true);

  await page.locator('[data-scene="discrete"] [data-camera-preset="space"]').click();
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as { PLCTrainerAutomationLabs: { getSceneDiagnostics(): { cameras: { discrete: { fitPreset: string | null; proxyRootFitsView: boolean } } } } }
  ).PLCTrainerAutomationLabs.getSceneDiagnostics().cameras.discrete)).toMatchObject({ fitPreset: 'space', proxyRootFitsView: true });

  // Exercise the actual mesh-bound terminal endpoints, not only catalog load.
  await page.locator('[data-discrete-action="reference"]').click();
  await page.locator('[data-discrete-action="power"]').click();
  await expect(page.locator('#al-discrete-status b')).toHaveText('폐회로 결선 정상');
  await expect(page.locator('#al-discrete-wire-count')).toHaveText('55');
  await page.locator('[data-discrete-output="relay1"]').check();
  await expect.poll(async () => page.evaluate(() => Boolean((
    window as unknown as { PLCTrainerAutomationLabs: { state: { labs: { discrete: { effectiveOutputs: { relay1: boolean } } } } } }
  ).PLCTrainerAutomationLabs.state.labs.discrete.effectiveOutputs.relay1))).toBe(true);
  await page.screenshot({ path: 'output/manual-backed-3d-wiring.png', fullPage: true });

  await page.locator('.al-tab[data-lab="equipment3d"]').click();
  await page.locator('#al-equipment-select').selectOption('xbc-dr32h.glb');
  await expect(page.locator('#al-equipment-file')).toContainText('xbc-dr32h.glb');
  await expect(page.locator('#al-equipment-file')).toContainText('Blender 5.2');
  await expect(page.locator('#al-equipment-status b')).toContainText('XBC-DR32H');
  await page.screenshot({ path: 'output/manual-backed-3d-assets.png', fullPage: true });

  expect(await readMainNetworkAudit()).toEqual({ externalRequests: [], failedRequests: [] });
  expect(externalRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('manual-backed 3D I/O lab visibly fails closed when a physical +24V to 24G short is restored', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await page.locator('#workshop-mode-selector').getByRole('button', { name: /연습 모드/ }).click();
  await page.waitForFunction(() => typeof (
    window as unknown as { PLCTrainerMultiView?: { setView?: unknown } }
  ).PLCTrainerMultiView?.setView === 'function');
  await page.evaluate(() => (
    window as unknown as { PLCTrainerMultiView: { setView(view: string): void } }
  ).PLCTrainerMultiView.setView('palletizer'));
  await page.locator('.al-tab[data-lab="discrete"]').click();
  await expect(page.locator('.al-pane[data-lab-pane="discrete"]')).toHaveClass(/active/);
  await page.waitForFunction(() => Boolean((
    window as unknown as {
      PLCTrainerAutomationLabs?: { getEditor(lab: string): { modules?: Map<string, unknown> } | null };
    }
  ).PLCTrainerAutomationLabs?.getEditor('discrete')?.modules?.has('power')));
  const requiredModules = [
    'source', 'plc', 'relay', 'manual-mc', 'manual-eocr', 'manual-ut', 'manual-ut-pe', 'manual-ut-fuse',
  ];
  await expect.poll(async () => page.evaluate((required) => (
    required.filter((moduleId) => !(
      window as unknown as {
        PLCTrainerAutomationLabs: { getSceneDiagnostics(): { discrete: { importedAssets: string[] } } };
      }
    ).PLCTrainerAutomationLabs.getSceneDiagnostics().discrete.importedAssets.includes(moduleId))
  ), requiredModules), { timeout: 30_000 }).toEqual([]);

  await page.locator('[data-discrete-action="reference"]').click();
  await page.locator('[data-discrete-action="power"]').click();
  await page.locator('[data-discrete-action="probe-reference"]').click();
  await expect(page.locator('#al-discrete-status b')).toHaveText('폐회로 결선 정상');
  await expect(page.locator('#al-discrete-meter')).toContainText('+24.0 V DC');
  await page.locator('[data-discrete-output="relay1"]').check();
  await expect.poll(async () => page.evaluate(() => Boolean((
    window as unknown as { PLCTrainerAutomationLabs: { state: { labs: { discrete: { effectiveOutputs: { relay1: boolean } } } } } }
  ).PLCTrainerAutomationLabs.state.labs.discrete.effectiveOutputs.relay1))).toBe(true);

  // Use the same public 3D editor that backs the terminal meshes, then commit
  // its serialized topology through the production electrical runtime.
  await page.evaluate(() => {
    const labs = (window as unknown as {
      PLCTrainerAutomationLabs: {
        getEditor(lab: string): {
          connect(from: unknown, to: unknown, options: { id: string; enforceMode: boolean }): void;
          serialize(): { connections: unknown[] };
        };
        state: { labs: { discrete: unknown } };
        renderActive(): void;
      };
      PLCTrainerDiscreteIoRuntime: {
        setConnections(state: unknown, connections: unknown[]): void;
      };
    }).PLCTrainerAutomationLabs;
    const editor = labs.getEditor('discrete');
    editor.connect(
      { moduleId: 'power', anchorId: 'P24-18' },
      { moduleId: 'power', anchorId: 'N24-18' },
      { id: 'e2e-power-rail-short', enforceMode: false },
    );
    (window as unknown as {
      PLCTrainerDiscreteIoRuntime: { setConnections(state: unknown, connections: unknown[]): void };
    }).PLCTrainerDiscreteIoRuntime.setConnections(labs.state.labs.discrete, editor.serialize().connections);
    labs.renderActive();
  });

  await expect(page.locator('#al-discrete-status')).toHaveClass(/fault/);
  await expect(page.locator('#al-discrete-status b')).toContainText('안전 차단');
  await expect(page.locator('#al-discrete-issues')).toContainText('POWER_RAIL_SHORT');
  await expect(page.locator('#al-discrete-meter span')).toHaveText('POWER_RAIL_SHORT');
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as { PLCTrainerAutomationLabs: { state: { labs: { discrete: {
      solution: { ready: boolean; issueCodes?: string[]; issues: Array<{ code: string }> };
      effectiveOutputs: { relay1: boolean };
    } } } } }
  ).PLCTrainerAutomationLabs.state.labs.discrete)).toMatchObject({
    solution: { ready: false, issues: expect.arrayContaining([expect.objectContaining({ code: 'POWER_RAIL_SHORT' })]) },
    effectiveOutputs: { relay1: false },
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
