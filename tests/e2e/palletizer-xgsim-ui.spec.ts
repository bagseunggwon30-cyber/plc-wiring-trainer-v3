import { expect, test } from './electron.fixture';

test('XGB production palletizer exposes a consent-gated local XG-SIM bridge without opening a project or connecting', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await page.locator('#workshop-mode-selector').getByRole('button', { name: /연습 모드/ }).click();
  await page.waitForFunction(() => typeof (
    window as unknown as { PLCTrainerMultiView?: { setView?: unknown } }
  ).PLCTrainerMultiView?.setView === 'function');
  await page.evaluate(() => (
    window as unknown as { PLCTrainerMultiView: { setView(view: string): void } }
  ).PLCTrainerMultiView.setView('palletizer'));
  await page.locator('.al-tab[data-lab="palletizer3d"]').click();
  await expect(page.locator('.al-pane[data-lab-pane="palletizer3d"]')).toHaveClass(/active/);

  await page.evaluate(() => {
    const testWindow = window as unknown as { palletizerProfileChanges: string[] };
    testWindow.palletizerProfileChanges = [];
    window.addEventListener('palletizer-profile-changed', (event) => {
      testWindow.palletizerProfileChanges.push((event as CustomEvent<{ profile: string }>).detail.profile);
    });
  });
  await page.locator('#p3-profile').selectOption('xgb-production');
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { palletizerProfileChanges: string[] }
  ).palletizerProfileChanges)).toEqual(['xgb-production']);
  const bridge = page.locator('#p3-xgsim');
  await expect(bridge).toBeVisible();
  await expect(bridge).toContainText(/XG-SIM/i);
  await expect(bridge).toContainText(/D00000.*D004.*D005.*host v1.*미지원/i);
  await expect(bridge).toContainText(/프로젝트 식별 미검증.*관측.*DI 시뮬레이션 전용/i);
  await expect(bridge).not.toContainText(/프로젝트 검증됨/i);

  const consent = page.locator('#p3-xgsim-consent');
  const selectProject = page.locator('#p3-xgsim-select-project');
  const connect = page.locator('#p3-xgsim-connect');
  const disconnect = page.locator('#p3-xgsim-disconnect');
  const status = page.locator('#p3-xgsim-status');

  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(selectProject).toBeDisabled();
  await expect(connect).toBeDisabled();
  await expect(disconnect).toBeDisabled();
  await expect(status).toContainText(/동의|대기|연결 안 됨/i);

  // The UI gate alone is tested: no file picker, host probe, or connection.
  await consent.check();
  await expect(selectProject).toBeEnabled();
  await expect(connect).toBeDisabled();
  await expect(disconnect).toBeDisabled();

  await page.evaluate(() => (
    window as unknown as { PLCTrainerPalletizer3D: { setProfile(profile: string): boolean } }
  ).PLCTrainerPalletizer3D.setProfile('ls'));
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { palletizerProfileChanges: string[] }
  ).palletizerProfileChanges)).toEqual(['xgb-production', 'ls']);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
