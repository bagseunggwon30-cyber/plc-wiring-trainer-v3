import { expect, test } from './electron.fixture';

type PalletizerApi = {
  getProfile(): { id: string; simulationOnly: boolean };
  readDevice(address: string): boolean | number | undefined;
  writeDevice(address: string, value: unknown): { ok: boolean; accepted?: boolean; error?: string };
  state: {
    auto: { running: boolean; state: string; message: string };
    manualOrg: { step: number; message: string };
    events: Array<{ type: string; message: string }>;
  };
};

test('XGB production palletizer UI exposes the reviewed XG5000 contract and traces rejected AUTO through manual ORG', async ({ harness }) => {
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

  // This must be a real UI choice, not an undocumented test-only state change.
  const profile = page.locator('#p3-profile');
  await expect(profile.locator('option[value="xgb-production"]')).toHaveText(/XGB.*XG5000/i);
  await profile.selectOption('xgb-production');
  await expect(profile).toHaveValue('xgb-production');

  await expect.poll(async () => page.evaluate(() => (
    window as unknown as { PLCTrainerPalletizer3D: PalletizerApi }
  ).PLCTrainerPalletizer3D.getProfile())).toMatchObject({ id: 'xgb-production', simulationOnly: false });

  // The visible table is the operator contract: inputs P00000..P0000F and
  // the actual step word D00000 must be inspectable without devtools.
  for (const address of [
    'P00000', 'P00001', 'P00002', 'P00003', 'P00004', 'P00005', 'P00006', 'P00007',
    'P00008', 'P00009', 'P0000A', 'P0000B', 'P0000C', 'P0000D', 'P0000E', 'P0000F', 'D00000',
  ]) {
    await expect(page.locator(`#p3-memory [data-memory="${address}"]`)).toBeVisible();
  }
  await expect(page.locator('#p3-production-inputs')).toContainText(
    /P00000.*비상정지 루프 정상.*P00001.*안전문 인터록 정상.*P00005.*AUTO 선택 키.*P0000A.*공압 압력 정상.*P0000E.*안전 릴레이 EDM 정상.*P0000F.*외부 정지 루프 정상/s,
  );
  await expect(page.locator('[data-memory="D00000"]')).toHaveText('0');

  // AUTO is fail-closed until the reviewed manual Z → X → Y ORG sequence
  // completes. The reason must be visible and retained in the event trace.
  await page.locator('[data-action="auto"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const api = (window as unknown as { PLCTrainerPalletizer3D: PalletizerApi }).PLCTrainerPalletizer3D;
    return { running: api.state.auto.running, message: api.state.auto.message, events: api.state.events };
  })).toMatchObject({
    running: false,
    message: expect.stringMatching(/ORG|원점/i),
    events: expect.arrayContaining([expect.objectContaining({ type: 'reject', message: expect.stringMatching(/ORG|원점/i) })]),
  });
  await expect(page.locator('#p3-log')).toContainText(/ORG|원점/i);

  // The production profile uses M00119, and the normal UI home control must
  // drive that command rather than the legacy profile's `home` address.
  await page.locator('[data-action="servo"]').click();
  await page.locator('[data-action="home"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const api = (window as unknown as { PLCTrainerPalletizer3D: PalletizerApi }).PLCTrainerPalletizer3D;
    return {
      orgStep: api.state.manualOrg.step,
      orgMessage: api.state.manualOrg.message,
      command: api.readDevice('M00119'),
      events: api.state.events,
    };
  // The empty-home initial machine can complete Z → X → Y between UI frames;
  // accept either the observable start step or its completed trace. M00119 is
  // a one-scan command and must already be safely OFF after the UI action.
  })).toMatchObject({
    orgStep: expect.any(Number),
    orgMessage: expect.stringMatching(/Z.*원점|원점복귀 완료/i),
    command: false,
    events: expect.arrayContaining([
      expect.objectContaining({ type: 'command', message: expect.stringMatching(/ORG.*Z.*X.*Y/i) }),
    ]),
  });

  // Once ORG is complete, a rejected AUTO must name the actual missing
  // production permits instead of incorrectly blaming ORG again.
  await page.locator('[data-action="auto"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const api = (window as unknown as { PLCTrainerPalletizer3D: PalletizerApi }).PLCTrainerPalletizer3D;
    return { running: api.state.auto.running, message: api.state.auto.message, events: api.state.events };
  })).toMatchObject({
    running: false,
    message: expect.stringMatching(/AUTO 허가 조건 OFF.*P00000.*비상정지 루프 정상/i),
    events: expect.arrayContaining([expect.objectContaining({ type: 'reject', message: expect.stringMatching(/P00000.*비상정지 루프 정상/i) })]),
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
