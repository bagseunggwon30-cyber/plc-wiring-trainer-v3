import { expect, test } from './electron.fixture';

type Diagnostics = {
  blenderModel: boolean;
  modelLoad: { status: string; source: string; attempts: number; error: string | null; missingNodes: string[] };
  axisBindings: Record<string, { node: string | null; component: string | null; direction: number; worldComponent: string; sceneCoordinate: number | null; expectedSceneCoordinate: number | null; worldCoordinate: number | null; expectedWorldCoordinate: number | null }>;
};

test('late module initialization loads the Blender palletizer and binds all three runtime axes', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await page.locator('#workshop-mode-selector').getByRole('button', { name: /연습 모드/ }).click();
  await page.waitForFunction(() => typeof (
    window as unknown as { PLCTrainerMultiView?: { setView?: unknown } }
  ).PLCTrainerMultiView?.setView === 'function');
  await page.evaluate(() => (
    window as unknown as { PLCTrainerMultiView: { setView(view: string): void } }
  ).PLCTrainerMultiView.setView('palletizer'));
  await page.locator('.al-tab[data-lab="palletizer3d"]').click();

  await expect.poll(async () => page.evaluate(() => (
    window as unknown as { PLCTrainerPalletizer3D: { getDiagnostics(): Diagnostics } }
  ).PLCTrainerPalletizer3D.getDiagnostics()), { timeout: 20_000 }).toMatchObject({
    blenderModel: true,
    modelLoad: { status: 'ready', source: 'blender-glb', error: null, missingNodes: [] },
    axisBindings: {
      X: { node: 'X_Carriage', component: 'x' },
      Y: { node: 'Y_Carriage', component: 'y', worldComponent: 'z' },
      Z: { node: 'Z_Slide', component: 'z', direction: -1, worldComponent: 'y' },
    },
  });

  const measured = await page.evaluate(() => {
    const api = (window as unknown as {
      PLCTrainerPalletizer3D: { state: { axes: Record<string, { position: number }> }; renderActive(): void; getDiagnostics(): Diagnostics };
      PLCTrainerImportedModels: { getStatus(): { requested: string[]; loaded: string[]; failed: unknown[] } };
    });
    api.PLCTrainerPalletizer3D.state.axes.X.position = 600;
    api.PLCTrainerPalletizer3D.state.axes.Y.position = 210;
    api.PLCTrainerPalletizer3D.state.axes.Z.position = 0;
    api.PLCTrainerPalletizer3D.renderActive();
    return { diagnostics: api.PLCTrainerPalletizer3D.getDiagnostics(), imports: api.PLCTrainerImportedModels.getStatus() };
  });
  expect(measured.imports.requested).toContain('palletizer-3axis-v2.glb');
  expect(measured.imports.loaded).toContain('palletizer-3axis-v2.glb');
  expect(measured.imports.failed).toEqual([]);
  expect(measured.diagnostics.axisBindings.X.sceneCoordinate).toBeCloseTo(4.45, 4);
  expect(measured.diagnostics.axisBindings.Y.sceneCoordinate).toBeCloseTo(-0.075, 4);
  expect(measured.diagnostics.axisBindings.Z.sceneCoordinate).toBeCloseTo(-0.62, 4);
  for (const binding of Object.values(measured.diagnostics.axisBindings)) {
    expect(binding.sceneCoordinate).toBeCloseTo(binding.expectedSceneCoordinate as number, 5);
    expect(binding.worldCoordinate).toBeCloseTo(binding.expectedWorldCoordinate as number, 5);
  }

  const statusLeds = await page.evaluate(() => (
    (window as unknown as { PLCTrainerPalletizer3D: { getDiagnostics(): unknown } }).PLCTrainerPalletizer3D.getDiagnostics() as {
      statusLeds: Record<string, { parent: string | null; visible: boolean }>;
    }
  ).statusLeds);
  expect(Object.keys(statusLeds).sort()).toEqual(['xHome', 'xLimit', 'yHome', 'yLimit', 'zHome', 'zLimit']);
  for (const statusLed of Object.values(statusLeds)) {
    expect(statusLed.parent).toBe('Palletizer-Runtime-Workpieces');
    expect(statusLed.visible).toBe(true);
  }

  await page.evaluate(() => {
    const api = (window as unknown as { PLCTrainerPalletizer3D: { state: { axes: { X: { position: number } } }; renderActive(): void } }).PLCTrainerPalletizer3D;
    api.state.axes.X.position = 300;
    api.renderActive();
  });
  await page.locator('[data-jog="X,1"]').hover();
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { PLCTrainerPalletizer3D: { state: { axes: { X: { busy: boolean } } } } }
  ).PLCTrainerPalletizer3D.state.axes.X.busy)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { PLCTrainerPalletizer3D: { state: { axes: { X: { busy: boolean } } } } }
  ).PLCTrainerPalletizer3D.state.axes.X.busy)).toBe(false);
  await page.mouse.up();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
