import { expect, test } from './electron.fixture';

const LEGACY_STORAGE_KEY = 'wiring-workshop-v2';
const probePayload = '<img onerror="window.__xssProbe=(window.__xssProbe||0)+1">';

test('legacy localStorage terminal labels render as text, never executable netlist markup', async ({ harness }) => {
  const { page } = harness;

  // This is a legacy-state-shaped payload only: no file picker, IPC, or network
  // request is involved. The custom terminal label reaches renderNetlist() after
  // the old localStorage load path applies terminal calibration.
  await page.evaluate(({ key, payload }) => {
    window.__xssProbe = 0;
    localStorage.setItem(key, JSON.stringify({
      d: {
        source: { type: 'TB4', x: 100, y: 100 },
        destination: { type: 'TB4', x: 400, y: 100 },
      },
      w: [{
        id: 'legacy-xss-wire',
        from: { dev: 'source', term: 'legacy-xss-terminal' },
        to: { dev: 'destination', term: '1' },
      }],
      n: 3,
      terminalCalibration: {
        TB4: {
          added: [{
            id: 'legacy-xss-terminal',
            x: 0,
            y: 25,
            side: 'L',
            label: payload,
            pol: 'NEUTRAL',
          }],
        },
      },
    }));
  }, { key: LEGACY_STORAGE_KEY, payload: probePayload });

  // The workflow shell may visually hide legacy controls while keeping the
  // compatibility renderer mounted; this intentionally invokes that exact
  // localStorage load listener without a file-picker path.
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#b-load')?.click();
  });
  const netlist = page.locator('#netlist');
  await expect(netlist).toContainText('NET 1');

  // Contract: all dynamic member labels must use escaped markup/textContent.
  // Dispatching error ourselves avoids a real resource request while proving that
  // an inserted onerror attribute would be executable in the renderer.
  const result = await netlist.evaluate((element) => {
    const injected = element.querySelector('img[onerror]');
    injected?.dispatchEvent(new Event('error'));
    return {
      injectedElementCount: element.querySelectorAll('img[onerror]').length,
      renderedText: element.textContent ?? '',
      probe: window.__xssProbe ?? 0,
    };
  });

  expect(result.probe).toBe(0);
  expect(result.injectedElementCount).toBe(0);
  expect(result.renderedText).toContain(probePayload);
});

test('legacy import-controlled validation members render as literal text, never executable markup', async ({ harness }) => {
  const { page } = harness;
  const maliciousDeviceId = '<img onerror="window.__validationXssProbe=(window.__validationXssProbe||0)+1">';

  // The legacy load route is deliberately used here. The invalid terminal is a
  // normal validation-quality condition, while the legacy-controlled device ID
  // becomes `iss.members` in validateQualityWarnings(). No file picker, IPC,
  // or network request is needed for this regression.
  await page.evaluate(({ key, deviceId }) => {
    window.__validationXssProbe = 0;
    localStorage.setItem(key, JSON.stringify({
      d: {
        [deviceId]: { type: 'TB4', x: 100, y: 100 },
        destination: { type: 'TB4', x: 400, y: 100 },
      },
      w: [{
        id: 'legacy-validation-xss-wire',
        from: { dev: deviceId, term: 'missing-terminal' },
        to: { dev: 'destination', term: '1' },
      }],
      n: 3,
    }));
  }, { key: LEGACY_STORAGE_KEY, deviceId: maliciousDeviceId });

  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#b-load')?.click();
    document.querySelector<HTMLButtonElement>('#b-validate')?.click();
  });

  const validation = page.locator('#validation');
  await expect(validation).toContainText('존재하지 않는 단자를 참조하는 와이어가 있음');

  // Triggering an error manually avoids any external request while proving
  // that an injected event handler would execute if markup reached this panel.
  const result = await validation.evaluate((element) => {
    const injected = element.querySelector('img[onerror]');
    injected?.dispatchEvent(new Event('error'));
    return {
      injectedElementCount: element.querySelectorAll('img[onerror]').length,
      renderedText: element.textContent ?? '',
      probe: window.__validationXssProbe ?? 0,
    };
  });

  expect(result.probe).toBe(0);
  expect(result.injectedElementCount).toBe(0);
  expect(result.renderedText).toContain(maliciousDeviceId);
});
