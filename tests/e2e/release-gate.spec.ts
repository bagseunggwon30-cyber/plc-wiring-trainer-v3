import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { createAcademyExp2Md02Template } from '../../src/domain/academy-panel-template';
import { PUBLIC_MISSIONS } from '../../src/domain/missions';
import { expect, test } from './electron.fixture';

const VERIFIED_PREWIRE_TYPES = [
  'BOUNDARY-AC',
  'BOUNDARY-CONTACT',
  'BOUNDARY-DC',
  'BOUNDARY-LOAD',
  'BOUNDARY-ANALOG-I',
  'BOUNDARY-ANALOG-I-IN',
  'BOUNDARY-ANALOG-V',
  'BOUNDARY-ANALOG-V-IN',
  'BOUNDARY-2W-I',
  'BOUNDARY-RS485',
  'EOCR3DE-05DUH',
  'EXP2-700',
  'MC-22B-DC24',
  'MDR-100',
  'MY2N',
  'UT-2.5',
  'UT-2.5-PE',
  'UT-4-HESI',
  'XBC-DR32H',
  'XBF-AH04A',
].sort();

const PRACTICE_MISSIONS = PUBLIC_MISSIONS.filter((mission) => mission.eligibleModes.includes('practice'));
const PREWIRE_MISSIONS = PUBLIC_MISSIONS
  .filter((mission) => mission.eligibleModes.includes('prewire'))
  .map((mission) => mission.title);

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

async function openAdvancedTools(page: Page): Promise<void> {
  const advancedTools = page.locator('#advanced-tools');
  if (!(await advancedTools.evaluate((element: HTMLDetailsElement) => element.open))) {
    await advancedTools.locator('> summary').click();
  }
  await expect(advancedTools).toHaveAttribute('open', '');
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
    settings: {},
    extensions: { legacy: { nextId: 100 } },
  };
}

function relayReferenceDocument() {
  const device = (
    id: string,
    profileId: string,
    profileVersion: string,
    evidenceLevel: 'manual-verified' | 'bench-verified',
    x: number,
  ) => ({
    id, profileId, profileVersion, evidenceLevel, missingProfile: false, x, y: 320, rotation: 0, configuration: {},
  });
  return {
    schemaVersion: 2 as const,
    mode: 'prewire' as const,
    revision: 21,
    name: 'Electron E2E · relay OFF/ON',
    source: { kind: 'native-v2' as const, hash: '1'.repeat(64) },
    devices: [
      device('ac-relay', 'boundary:ac-supply', '1.0.0', 'bench-verified', 240),
      device('dc-relay', 'boundary:dc-supply', '1.0.0', 'bench-verified', 520),
      device('plc-relay', 'ls-electric:xbc-dr32h', '1.0.0', 'manual-verified', 840),
      device('load-relay', 'boundary:load', '1.0.0', 'bench-verified', 1300),
    ],
    wires: [
      { id: 'relay-l', from: { deviceId: 'ac-relay', terminalId: 'L1' }, to: { deviceId: 'plc-relay', terminalId: 'L' } },
      { id: 'relay-n', from: { deviceId: 'ac-relay', terminalId: 'N' }, to: { deviceId: 'plc-relay', terminalId: 'N' } },
      { id: 'relay-pe', from: { deviceId: 'ac-relay', terminalId: 'PE' }, to: { deviceId: 'plc-relay', terminalId: 'PE' } },
      { id: 'relay-com', from: { deviceId: 'dc-relay', terminalId: '+' }, to: { deviceId: 'plc-relay', terminalId: 'COM0' } },
      { id: 'relay-output', from: { deviceId: 'plc-relay', terminalId: 'P20' }, to: { deviceId: 'load-relay', terminalId: '+' } },
      { id: 'relay-return', from: { deviceId: 'load-relay', terminalId: '-' }, to: { deviceId: 'dc-relay', terminalId: '-' } },
    ],
    jumpers: [], layout: {},
    settings: {
      missionId: 'xbc-forced-relay-output',
      roleBindings: { acSupply: 'ac-relay', dcSupply: 'dc-relay', plc: 'plc-relay', load: 'load-relay' },
    },
    extensions: { legacy: { nextId: 100 } },
  };
}

function plusOnlyLoadDocument() {
  return {
    schemaVersion: 2 as const,
    mode: 'prewire' as const,
    revision: 31,
    name: 'Electron E2E · +24V only load',
    source: { kind: 'native-v2' as const, hash: '2'.repeat(64) },
    devices: [
      { id: 'dc-open', profileId: 'boundary:dc-supply', profileVersion: '1.0.0', evidenceLevel: 'bench-verified' as const, missingProfile: false, x: 300, y: 320, rotation: 0, configuration: {} },
      { id: 'load-open', profileId: 'boundary:load', profileVersion: '1.0.0', evidenceLevel: 'bench-verified' as const, missingProfile: false, x: 820, y: 320, rotation: 0, configuration: {} },
    ],
    wires: [{ id: 'positive-only', from: { deviceId: 'dc-open', terminalId: '+' }, to: { deviceId: 'load-open', terminalId: '+' } }],
    jumpers: [], layout: {}, settings: {}, extensions: { legacy: { nextId: 100 } },
  };
}

function xbcMd02VisualDocument() {
  return {
    schemaVersion: 2 as const,
    mode: 'practice' as const,
    revision: 41,
    name: 'Electron E2E · XBC terminal and MD02 geometry',
    source: { kind: 'native-v2' as const, hash: '3'.repeat(64) },
    devices: [
      { id: 'plc-visual', profileId: 'ls-electric:xbc-dr32h', profileVersion: '1.0.0', evidenceLevel: 'manual-verified' as const, missingProfile: false, x: 260, y: 220, rotation: 0, configuration: {} },
      { id: 'md02-visual', profileId: 'generic:xy-md02', profileVersion: '1.0.0', evidenceLevel: 'educational' as const, missingProfile: false, x: 1120, y: 380, rotation: 0, configuration: {} },
    ],
    wires: [], jumpers: [], layout: {}, settings: {}, extensions: { legacy: { nextId: 100 } },
  };
}

async function applyDocument(page: Page, documentV2: unknown): Promise<void> {
  await page.evaluate((document) => {
    const target = window as unknown as {
      LegacyTrainerBridge: { applyDocumentV2(value: unknown): void };
      WorkshopV2Controller: { renderMissions(): void };
    };
    target.LegacyTrainerBridge.applyDocumentV2(document);
    target.WorkshopV2Controller.renderMissions();
  }, documentV2);
  await expect(page.locator('#v3-workflow-panel')).toBeVisible();
}

async function completeVisibleV3Workflow(page: Page, orderCode?: string): Promise<void> {
  await page.getByRole('combobox', { name: '공급 SourceSystem 선택' }).selectOption('ac-1ph-220v');
  await page.getByRole('combobox', { name: 'PE 및 0V 정책 선택' }).selectOption('PE_SEPARATE_0V_FLOATING');
  await page.getByRole('spinbutton', { name: '밀리미터당 캔버스 단위' }).fill('2');
  await page.getByRole('combobox', { name: '검토 범위 템플릿 선택' }).selectOption('control-panel-prewire');
  await page.getByRole('spinbutton', { name: '예상 단락전류 A' }).fill('1500');
  await page.getByRole('textbox', { name: '보호기기 차단곡선' }).fill('C16');
  for (const checkbox of await page.getByRole('checkbox', { name: /검토 범위 포함/ }).all()) {
    if (!(await checkbox.isChecked())) {
      await checkbox.scrollIntoViewIfNeeded();
      await checkbox.check();
    }
  }
  if (orderCode) {
    const candidates = page.locator('input[aria-label$="전체 주문코드"]');
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      const label = await candidate.getAttribute('aria-label');
      if (label?.includes(orderCode.startsWith('XBC') ? 'XBC' : 'MDR')) await candidate.fill(orderCode);
    }
    const designations = page.locator('input[aria-label$="설비 명칭"]');
    for (let index = 0; index < await designations.count(); index += 1) {
      const candidate = designations.nth(index);
      const label = await candidate.getAttribute('aria-label');
      if (label?.includes(orderCode.startsWith('XBC') ? 'XBC' : 'MDR')) await candidate.fill(orderCode.startsWith('XBC') ? 'PLC1' : 'PS1');
    }
  }
  const wireNumbers = page.locator('input[aria-label$="선번"]');
  for (let index = 0; index < await wireNumbers.count(); index += 1) await wireNumbers.nth(index).fill(`W-${index + 1}`);
  const gauges = page.locator('input[aria-label$="mm²/AWG"]');
  for (let index = 0; index < await gauges.count(); index += 1) await gauges.nth(index).fill('0.75 mm²');
  await page.keyboard.press('Tab');
}

async function bridgeState(page: Page): Promise<{
  devices: Record<string, { type: string; x: number; y: number }>;
  revision: number;
  wires: Array<{
    id: string;
    from: { dev: string; term: string };
    to: { dev: string; term: string };
    waypoints?: Array<{ x: number; y: number }>;
  }>;
}> {
  return page.evaluate(() => {
    const bridge = (window as unknown as {
      LegacyTrainerBridge: { readState(): unknown };
    }).LegacyTrainerBridge;
    return bridge.readState() as {
      devices: Record<string, { type: string; x: number; y: number }>;
      revision: number;
      wires: Array<{
        id: string;
        from: { dev: string; term: string };
        to: { dev: string; term: string };
        waypoints?: Array<{ x: number; y: number }>;
      }>;
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

async function pointerClickSvgTerminal(page: Page, deviceId: string, terminalId: string): Promise<void> {
  const terminal = page.locator(
    `#g-terminals .terminal-hit[data-id="${deviceId}"][data-term="${terminalId}"]`,
  );
  await expect(terminal).toHaveCount(1);
  await terminal.scrollIntoViewIfNeeded();
  const box = await terminal.boundingBox();
  expect(box, `${deviceId}.${terminalId} must be visible for real-pointer wiring`).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function pointerClickSvgDeviceBody(page: Page, deviceId: string, addToSelection = false): Promise<void> {
  const body = page.locator(`#g-devices > .device[data-id="${deviceId}"] .device-body`);
  await expect(body).toHaveCount(1);
  await body.scrollIntoViewIfNeeded();
  const box = await body.boundingBox();
  expect(box, `${deviceId} body must be visible for real-pointer selection`).not.toBeNull();
  if (addToSelection) await page.keyboard.down('Control');
  await page.mouse.click(box!.x + Math.min(12, box!.width / 2), box!.y + Math.min(12, box!.height / 2));
  if (addToSelection) await page.keyboard.up('Control');
}

async function findBlankCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.locator('#canvas').evaluate((canvas: SVGSVGElement) => {
    const rect = canvas.getBoundingClientRect();
    const forbidden = '.wire, .terminal, .terminal-hit, .device, .wire-handle, .calib-anchor';
    const margin = 24;
    for (let y = rect.top + margin; y <= rect.bottom - margin; y += 20) {
      for (let x = rect.left + margin; x <= rect.right - margin; x += 20) {
        const stack = document.elementsFromPoint(x, y);
        if (!stack.some((element) => element === canvas || canvas.contains(element))) continue;
        if (stack.some((element) => element.matches(forbidden) || element.closest(forbidden))) continue;
        return { x, y };
      }
    }
    return null;
  });
  expect(point, 'the visible SVG canvas must contain a blank point for a real waypoint click').not.toBeNull();
  return point!;
}

async function boxSelectSvgDevices(page: Page, deviceIds: readonly string[]): Promise<void> {
  await page.locator('#m-select').click();
  const boxes = await Promise.all(deviceIds.map(async (deviceId) => {
    const body = page.locator(`#g-devices > .device[data-id="${deviceId}"] .device-body`);
    await expect(body).toHaveCount(1);
    const box = await body.boundingBox();
    expect(box, `${deviceId} body must be visible for box selection`).not.toBeNull();
    return box!;
  }));
  const canvas = await page.locator('#canvas').boundingBox();
  expect(canvas).not.toBeNull();
  const left = Math.max(canvas!.x + 4, Math.min(...boxes.map((box) => box.x)) - 14);
  const top = Math.max(canvas!.y + 4, Math.min(...boxes.map((box) => box.y)) - 14);
  const right = Math.min(canvas!.x + canvas!.width - 4, Math.max(...boxes.map((box) => box.x + box.width)) + 14);
  const bottom = Math.min(canvas!.y + canvas!.height - 4, Math.max(...boxes.map((box) => box.y + box.height)) + 14);
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 10 });
  await page.mouse.up();
}

async function imageCrossingAudit(page: Page): Promise<{ crossings: string[]; blocked: string[] }> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      LegacyTrainerBridge: {
        readState(): {
          wires: Array<{ id: string; from: { dev: string }; to: { dev: string } }>;
        };
      };
    }).LegacyTrainerBridge.readState();
    const wires = new Map(state.wires.map((wire) => [wire.id, wire]));
    const images = [...document.querySelectorAll<SVGGElement>('#g-devices > .device')].flatMap((group) => {
      const deviceId = group.dataset.id ?? '';
      return [...group.querySelectorAll<SVGGraphicsElement>('.device-image')].map((image) => ({
        deviceId,
        rect: image.getBoundingClientRect(),
      })).filter(({ rect }) => rect.width > 2 && rect.height > 2);
    });
    const crossings = new Set<string>();
    const paths = [...document.querySelectorAll<SVGPathElement>('#g-wires > path.wire:not(.wire-hit)')];
    for (const path of paths) {
      const wireId = path.dataset.id ?? '';
      const wire = wires.get(wireId);
      const matrix = path.getScreenCTM();
      if (!wire || !matrix) continue;
      const total = path.getTotalLength();
      const sampleStep = Math.max(1, total / 5000);
      for (let distance = 0; distance <= total; distance += sampleStep) {
        const local = path.getPointAtLength(distance);
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        for (const image of images) {
          if (image.deviceId === wire.from.dev || image.deviceId === wire.to.dev) continue;
          if (screen.x > image.rect.left + 1 && screen.x < image.rect.right - 1
            && screen.y > image.rect.top + 1 && screen.y < image.rect.bottom - 1) {
            crossings.add(`${wireId}:${image.deviceId}`);
          }
        }
      }
    }
    return {
      crossings: [...crossings].sort(),
      blocked: [...document.querySelectorAll<SVGPathElement>('#g-wires > path.wire.route-blocked:not(.wire-hit)')]
        .map((path) => path.dataset.id ?? '')
        .filter(Boolean)
        .sort(),
    };
  });
}

test.describe.configure({ mode: 'serial' });

test('undo and redo keep the persisted workspace view synchronized with the rendered MultiView', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'practice');

  // A palette placement creates a real history entry while the panel is the
  // saved view. Switching into the automation lab must not leave its DOM
  // visible when undo restores that panel snapshot.
  await page.locator('#palette .pal[data-type="BOUNDARY-AC"]').click();
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(1);

  await openAdvancedTools(page);
  await page.getByRole('button', { name: /자동화 실습실/ }).click();
  await expect(page.locator('#mv-palletizer')).toHaveClass(/show/);
  await page.getByRole('button', { name: 'MPS 제어' }).click();
  await expect(page.locator('#al-mps-status')).toBeVisible();

  await page.keyboard.press('Control+Z');
  await expect.poll(async () => page.evaluate(() => (
    (window as unknown as {
      LegacyTrainerBridge: { readState(): { workspaceView: string } };
    }).LegacyTrainerBridge.readState().workspaceView
  ))).toBe('panel');
  await expect(page.locator('#canvas')).toBeVisible();
  await expect(page.locator('#mv-palletizer')).not.toHaveClass(/show/);

  await page.keyboard.press('Control+Y');
  await expect.poll(async () => page.evaluate(() => (
    (window as unknown as {
      LegacyTrainerBridge: { readState(): { workspaceView: string } };
    }).LegacyTrainerBridge.readState().workspaceView
  ))).toBe('palletizer');
  await expect(page.locator('#canvas')).not.toBeVisible();
  await expect(page.locator('#mv-palletizer')).toHaveClass(/show/);
  await expect(page.locator('#al-mps-status')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

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

test('startup keyboard flow separates practice and prewire review modes', async ({ harness }) => {
  const { app, page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors, userDataDir } = harness;

  await expect(page).toHaveURL(/^file:\/\/\//);
  const activeUserDataDir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  expect(activeUserDataDir.toLocaleLowerCase()).toBe(userDataDir.toLocaleLowerCase());
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
  await expect(page.locator('.mission-v2-header')).toHaveCount(PRACTICE_MISSIONS.length);
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

test('startup automatically restores the saved workshop and fits every device on screen', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  const saved = mdrReferenceDocument();
  saved.layout = {
    boardMode: 'free',
    cabinet: { x: 50, y: 50, w: 3900, h: 1800, label: 'legacy cabinet' },
    panelConfig: { rows: 3, cols: 1, door: true },
  };
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('plc-wiring-trainer:workshop-mode', value.mode);
  }, { key: WORKSHOP_V2_KEY, value: saved });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#workshop-mode-selector')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-workshop-mode', 'prewire');
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(3);
  await expect.poll(async () => (await bridgeState(page)).wires.length).toBe(5);
  await expect(page.locator('#stat')).toContainText(/자동 복원|복원 완료/);
  // The empty-workspace bootstrap also schedules a two-frame fit. Wait beyond
  // that point so it cannot overwrite the restored document's device fit.
  await page.waitForTimeout(250);
  const restoredZoom = Number((await page.locator('#zoomlbl').textContent())?.replace('%', ''));
  expect(Number.isFinite(restoredZoom)).toBe(true);
  expect(restoredZoom).toBeGreaterThan(0);
  const stageBox = await page.locator('#stage').boundingBox();
  expect(stageBox).not.toBeNull();
  for (const device of saved.devices) {
    const rendered = page.locator(`#g-devices > .device[data-id="${device.id}"]`);
    await expect(rendered).toBeVisible();
    const box = await rendered.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(stageBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(stageBox!.x + stageBox!.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(stageBox!.y - 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 1);
  }
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('XBC clean open-cover image aligns every wire target to its screw and preserves MD02 aspect ratio', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'practice');
  await applyDocument(page, xbcMd02VisualDocument());

  const xbcTerminals = page.locator('#g-terminals .terminal-hit[data-id="plc-visual"]');
  await expect(xbcTerminals).toHaveCount(48);
  await expect(page.locator('#g-terminals [data-id="plc-visual"][data-term="24G-TOP"]')).toHaveCount(0);
  await expect(page.locator('#g-terminals [data-id="plc-visual"][data-term="PE2"]')).toHaveCount(0);
  await expect(page.locator('#g-devices .device[data-id="plc-visual"] .disabled-terminal-mark')).toHaveCount(0);
  await expect(page.locator('#g-devices .device[data-id="plc-visual"] .image-label-correction')).toHaveCount(0);

  const positions = await page.locator('#g-terminals .terminal-hit[data-id="plc-visual"]').evaluateAll((items) =>
    Object.fromEntries(items.map((item) => [
      (item as SVGCircleElement).dataset.term,
      { x: Number(item.getAttribute('cx')), y: Number(item.getAttribute('cy')), r: Number(item.getAttribute('r')) },
    ])),
  );
  expect(positions['24G']).toMatchObject({ x: 654.7, y: 72.8 });
  expect(positions['24V']).toMatchObject({ x: 666.7, y: 109.9 });
  expect(positions['24G'].y).toBeLessThan(positions['24V'].y);
  expect(positions['P0F'].r).toBeGreaterThanOrEqual(7.2);
  expect(positions.PE.r).toBeGreaterThanOrEqual(7.2);

  await pointerClickSvgTerminal(page, 'plc-visual', 'P0F');
  await expect(page.locator('#stat')).toContainText('끝 단자');
  await pointerClickSvgTerminal(page, 'plc-visual', 'P0F');
  await pointerClickSvgTerminal(page, 'plc-visual', 'PE');
  await expect(page.locator('#stat')).toContainText('끝 단자');
  await pointerClickSvgTerminal(page, 'plc-visual', 'PE');

  const md02Image = page.locator('#g-devices .device[data-id="md02-visual"] .device-image');
  await expect(md02Image).toHaveAttribute('href', 'assets/devices/codex/md02-imagen-v2.png');
  await expect(md02Image).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  const md02Box = await md02Image.boundingBox();
  expect(md02Box).not.toBeNull();
  expect(md02Box!.width / md02Box!.height).toBeCloseTo(220 / 330, 2);
  const md02Terminals = await page.locator('#g-terminals .terminal-hit[data-id="md02-visual"]').evaluateAll((items) =>
    items.map((item) => ({ id: (item as SVGCircleElement).dataset.term, x: Number(item.getAttribute('cx')) })),
  );
  expect(md02Terminals).toEqual([
    { id: 'B-', x: 82.7 }, { id: 'A+', x: 101.1 }, { id: 'V-', x: 119.5 }, { id: 'V+', x: 137.9 },
  ]);

  await page.screenshot({ path: 'output/xbc-md02-terminal-fix.png', fullPage: true });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('academy panel routes every conductor around non-endpoint equipment images', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'practice');
  await applyDocument(page, createAcademyExp2Md02Template());
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(5);
  await expect.poll(async () => (await bridgeState(page)).wires.length).toBe(12);

  await expect.poll(() => imageCrossingAudit(page)).toEqual({ crossings: [], blocked: [] });

  await page.locator('#m-select').click();
  await pointerClickSvgDeviceBody(page, 'academy-ps1');
  await pointerClickSvgDeviceBody(page, 'academy-hmi1', true);
  const assistant = page.locator('.v3-wiring-assistant');
  await expect(assistant.locator('.v3-wiring-selection')).toContainText('academy-hmi1 ↔ academy-ps1');
  await expect(assistant.locator('.v3-wiring-flow')).toBeVisible();
  await expect(page.locator('#g-wiring-flow .wiring-flow-path.source')).toHaveCount(1);
  await expect(page.locator('#g-wiring-flow .wiring-flow-path.return')).toHaveCount(1);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Electron UI keeps a prewire reference fail-closed through validate, restore, and report export', async ({ harness }) => {
  const { page, readMainNetworkAudit, externalRequests, failedRequests, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'prewire');

  // Exercise the real SVG editor before deterministic seeding: palette placement
  // followed by explicit wire mode and two terminal clicks must produce a physical wire.
  await page.locator('#palette .pal[data-type="BOUNDARY-AC"]').click();
  await page.locator('#palette .pal[data-type="MDR-100"]').click();
  const placed = await bridgeState(page);
  const acId = Object.entries(placed.devices).find(([, entry]) => entry.type === 'BOUNDARY-AC')?.[0];
  const mdrId = Object.entries(placed.devices).find(([, entry]) => entry.type === 'MDR-100')?.[0];
  expect(acId).toBeTruthy();
  expect(mdrId).toBeTruthy();
  await page.locator('#m-wire').click();
  await clickSvgTerminal(page, acId!, 'L1');
  await clickSvgTerminal(page, mdrId!, 'L');
  await expect.poll(async () => (await bridgeState(page)).wires.length).toBe(1);

  const reference = mdrReferenceDocument();
  await applyDocument(page, reference);
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(3);
  await completeVisibleV3Workflow(page, 'MDR-100-24');
  const existingImagePaths = await page.locator('#g-devices .device-image').evaluateAll((images) =>
    images.map((image) => image.getAttribute('href')),
  );

  await page.locator('#b-validate').click();
  await expect(page.locator('#validation .core-validation-status')).toContainText('BLOCKED');
  await expect(page.locator('#validation')).toContainText('TERMINAL_GEOMETRY_MISMATCH');
  await expect(page.locator('#g-devices .device-image').evaluateAll((images) =>
    images.map((image) => image.getAttribute('href')),
  )).resolves.toEqual(existingImagePaths);

  const protectionCurve = page.getByRole('textbox', { name: '보호기기 차단곡선' });
  await protectionCurve.fill('D16');
  await expect(page.locator('#validation .core-validation-status')).toContainText('STALE');
  await expect(page.locator('#validation')).toContainText('revision');
  await page.keyboard.press('Control+Z');
  await expect(page.getByRole('textbox', { name: '보호기기 차단곡선' })).toHaveValue('C16');
  await page.locator('#b-validate').click();
  await expect(page.locator('#validation .core-validation-status')).toContainText('BLOCKED');

  await page.locator('#b-simulate').click();
  await expect(page.locator('#sim-monitor')).toContainText('v3 폐회로 해');

  await page.locator('#b-save').click();
  await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), WORKSHOP_V2_KEY)).not.toBeNull();
  await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').settings?.v3Workflow?.sourceSystem?.id, WORKSHOP_V2_KEY)).toBe('ac-1ph-220v');
  await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').settings?.v3Workflow?.sourceProtection, WORKSHOP_V2_KEY)).toEqual({
    phaseSequence: null,
    prospectiveShortCircuitCurrentA: 1500,
    protectiveDeviceCurve: 'C16',
  });
  const savedRevision = await page.evaluate((key) => Number(JSON.parse(localStorage.getItem(key) ?? '{}').revision), WORKSHOP_V2_KEY);
  expect(savedRevision).toBeGreaterThan(reference.revision);

  await page.evaluate((emptyDocument) => {
    (window as unknown as {
      LegacyTrainerBridge: { applyDocumentV2(document: unknown): void };
    }).LegacyTrainerBridge.applyDocumentV2(emptyDocument);
  }, { ...reference, revision: 12, devices: [], wires: [], settings: {} });
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(0);
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(0);

  await openAdvancedTools(page);
  await page.locator('#b-load').click();
  await expect.poll(async () => Object.keys((await bridgeState(page)).devices).length).toBe(3);
  await expect.poll(async () => (await bridgeState(page)).wires.length).toBe(5);
  await expect(page.locator('body')).toHaveAttribute('data-workshop-mode', 'prewire');
  await expect(page.getByRole('combobox', { name: '공급 SourceSystem 선택' })).toHaveValue('ac-1ph-220v');
  await expect(page.getByRole('spinbutton', { name: '밀리미터당 캔버스 단위' })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: '예상 단락전류 A' })).toHaveValue('1500');
  await expect(page.getByRole('textbox', { name: '보호기기 차단곡선' })).toHaveValue('C16');

  // Restoring a workshop returns to the panel view. The production view switch
  // closes the advanced flyout so it cannot cover the workspace; report export
  // therefore requires the same explicit re-open action as the user flow.
  await expect(page.locator('#advanced-tools')).not.toHaveAttribute('open', '');
  await openAdvancedTools(page);

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
  expect(reportCapture.filename).toBe(`prewire-diagnostic-r${savedRevision}.json`);
  const report = reportCapture.value as {
    classification: string;
    document: { validationStatus: string; revision: number };
    sourceProtection: { prospectiveShortCircuitCurrentA: number; protectiveDeviceCurve: string };
    pinToPin: unknown[];
    bom: Array<{ partNumber: string; quantity: number }>;
  };
  expect(report.classification).toBe('DIAGNOSTIC');
  expect(report.document).toMatchObject({ validationStatus: 'BLOCKED', revision: savedRevision });
  expect(report.sourceProtection).toMatchObject({ prospectiveShortCircuitCurrentA: 1500, protectiveDeviceCurve: 'C16' });
  expect(report.pinToPin).toHaveLength(5);
  expect(report.bom).toEqual([
    expect.objectContaining({ partNumber: 'MDR-100-24', quantity: 1 }),
  ]);

  const textArtifacts: Array<{ filename: string; value: string }> = [];
  await page.evaluate(() => {
    const target = window as unknown as {
      LegacyTrainerBridge: { downloadText(value: string, filename: string): void };
      __capturedTextReports?: Array<{ filename: string; value: string }>;
    };
    target.__capturedTextReports = [];
    target.LegacyTrainerBridge.downloadText = (value, filename) => target.__capturedTextReports?.push({ value, filename });
  });
  await page.getByRole('heading', { name: /시뮬 모니터/ }).click();
  await expect(page.getByRole('button', { name: 'HTML·CSV 내보내기' })).toBeVisible();
  await page.getByRole('button', { name: 'HTML·CSV 내보내기' }).click();
  await expect.poll(async () => page.evaluate(() =>
    (window as unknown as { __capturedTextReports?: Array<{ filename: string; value: string }> }).__capturedTextReports ?? [],
  )).toHaveLength(5);
  textArtifacts.push(...await page.evaluate(() =>
    (window as unknown as { __capturedTextReports: Array<{ filename: string; value: string }> }).__capturedTextReports,
  ));
  expect(textArtifacts.map((artifact) => artifact.filename)).toEqual(expect.arrayContaining([
    `prewire-diagnostic-r${savedRevision}.html`,
    `prewire-diagnostic-r${savedRevision}-pin-to-pin.csv`,
    `prewire-diagnostic-r${savedRevision}-cable-cores.csv`,
    `prewire-diagnostic-r${savedRevision}-terminal-plan.csv`,
    `prewire-diagnostic-r${savedRevision}-bom.csv`,
  ]));

  expect(await readMainNetworkAudit()).toEqual({ externalRequests: [], failedRequests: [] });
  expect(externalRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('diagram Delete removes only its selected wire after retaining a panel device selection', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'practice');
  await applyDocument(page, mdrReferenceDocument());

  // Select a real panel device first: this is the stale selection that must
  // never turn a diagram-local wire deletion into device deletion.
  await pointerClickSvgDeviceBody(page, 'mdr-e2e');
  await expect.poll(async () => page.evaluate(() => (
    (window as unknown as { LegacyTrainerBridge: { readSelection(): { deviceIds: string[] } } })
      .LegacyTrainerBridge.readSelection().deviceIds
  ))).toEqual(['mdr-e2e']);

  const originalDeviceIds = Object.keys((await bridgeState(page)).devices).sort();
  for (const [view, wireId] of [
    ['schematic', 'wire-l'],
    ['sequence', 'wire-n'],
  ] as const) {
    await openAdvancedTools(page);
    await page.locator(`#mv-view-group [data-view="${view}"]`).click();
    await expect(page.locator('#mv-stage')).toHaveClass(/show/);
    const wireHit = page.locator(`#mv-wires .mv-wire-hit[data-wire="${wireId}"]`);
    await expect(wireHit).toHaveCount(1);
    await wireHit.dispatchEvent('pointerdown', { button: 0 });
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { PLCTrainerMultiView: { selectedWire: string | null } })
        .PLCTrainerMultiView.selectedWire
    ))).toBe(wireId);

    await page.keyboard.press('Delete');
    const state = await bridgeState(page);
    expect(Object.keys(state.devices).sort()).toEqual(originalDeviceIds);
    expect(state.wires.map((wire) => wire.id)).not.toContain(wireId);
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('real-pointer terminal click starts wiring, previews a routed pending wire, and invalidates v3 validation', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'prewire');
  await applyDocument(page, plusOnlyLoadDocument());
  await completeVisibleV3Workflow(page);
  await page.keyboard.press('f');

  const positiveSource = { deviceId: 'dc-open', terminalId: '+' };
  const positiveDestination = { deviceId: 'load-open', terminalId: '+' };
  const negativeSource = { deviceId: 'dc-open', terminalId: '-' };
  const negativeDestination = { deviceId: 'load-open', terminalId: '-' };
  const initial = await bridgeState(page);
  await page.locator('#b-validate').click();
  await expect(page.locator('#validation .core-validation-status')).toContainText('FAIL');
  await expect(page.locator('#validation')).toContainText('OPEN_RETURN_PATH');

  // A terminal click is the user's clearest expression of wiring intent. It
  // enters wire mode and starts a preview, but does not mutate the document
  // until a different destination terminal is chosen.
  await page.locator('#m-select').click();
  await pointerClickSvgTerminal(page, positiveSource.deviceId, positiveSource.terminalId);
  await expect(page.locator(
    `#g-terminals .terminal:not(.terminal-hit)[data-id="${positiveSource.deviceId}"][data-term="${positiveSource.terminalId}"]`,
  )).toHaveClass(/pending/);
  await expect(page.locator('#m-wire')).toHaveClass(/active/);
  await expect(page.locator('#stat')).toContainText('끝 단자');
  expect(await bridgeState(page)).toMatchObject({ revision: initial.revision, wires: initial.wires });

  await pointerClickSvgTerminal(page, positiveSource.deviceId, positiveSource.terminalId);
  await expect(page.locator('#stat')).toContainText(/취소|같은/);

  await page.locator('#m-wire').click();
  await expect(page.locator('#m-wire')).toHaveClass(/active/);

  // Start through the actual hit target, then move a real pointer so the user
  // gets both the pending-terminal cue and a live ghost route before commit.
  // A same-terminal second click is a no-op, too.
  await pointerClickSvgTerminal(page, negativeSource.deviceId, negativeSource.terminalId);
  await pointerClickSvgTerminal(page, negativeSource.deviceId, negativeSource.terminalId);
  await expect(page.locator('#stat')).toContainText(/취소|같은/);
  expect(await bridgeState(page)).toMatchObject({ revision: initial.revision, wires: initial.wires });

  // An existing pair cannot silently become a parallel duplicate.
  await pointerClickSvgTerminal(page, positiveSource.deviceId, positiveSource.terminalId);
  await pointerClickSvgTerminal(page, positiveDestination.deviceId, positiveDestination.terminalId);
  await expect(page.locator('#stat')).toContainText(/이미|중복|duplicate/i);
  expect(await bridgeState(page)).toMatchObject({ revision: initial.revision, wires: initial.wires });

  await pointerClickSvgTerminal(page, negativeSource.deviceId, negativeSource.terminalId);
  await expect(page.locator('#stat')).toContainText('시작:');
  await expect(page.locator(
    `#g-terminals .terminal:not(.terminal-hit)[data-id="${negativeSource.deviceId}"][data-term="${negativeSource.terminalId}"]`,
  )).toHaveClass(/pending/);
  const destination = page.locator(
    `#g-terminals .terminal-hit[data-id="${negativeDestination.deviceId}"][data-term="${negativeDestination.terminalId}"]`,
  );
  const destinationBox = await destination.boundingBox();
  expect(destinationBox).not.toBeNull();
  await page.mouse.move(destinationBox!.x + destinationBox!.width / 2 - 12, destinationBox!.y + destinationBox!.height / 2);
  await expect(page.locator('#ghost')).toBeVisible();
  await expect(page.locator('#ghost')).toHaveAttribute('d', /.+/);
  const initialGhostPath = await page.locator('#ghost').getAttribute('d');

  // A click on a blank part of the canvas records a route waypoint while the
  // wire is still pending. It is not a document edit until a destination is
  // chosen, so neither wire count nor revision may change here.
  const source = page.locator(
    `#g-terminals .terminal-hit[data-id="${negativeSource.deviceId}"][data-term="${negativeSource.terminalId}"]`,
  );
  const waypointPoint = await findBlankCanvasPoint(page);
  await page.mouse.click(waypointPoint.x, waypointPoint.y);
  await expect(page.locator('#stat')).toContainText(/경유|waypoint/i);
  await expect(page.locator('#ghost')).toBeVisible();
  await expect(page.locator('#ghost')).not.toHaveAttribute('d', initialGhostPath ?? '');
  expect(await bridgeState(page)).toMatchObject({ revision: initial.revision, wires: initial.wires });

  // Escape is a pure cancellation: it leaves no wire or history revision behind.
  await page.keyboard.press('Escape');
  await expect(page.locator('#ghost')).toBeHidden();
  await expect(page.locator('#stat')).toContainText('취소');
  expect(await bridgeState(page)).toMatchObject({ revision: initial.revision, wires: initial.wires });

  await pointerClickSvgTerminal(page, negativeSource.deviceId, negativeSource.terminalId);
  await page.mouse.click(waypointPoint.x, waypointPoint.y);
  await pointerClickSvgTerminal(page, negativeDestination.deviceId, negativeDestination.terminalId);
  const afterCommit = await bridgeState(page);
  expect(afterCommit.revision).toBe(initial.revision + 1);
  expect(afterCommit.wires).toHaveLength(2);
  expect(afterCommit.wires).toEqual(expect.arrayContaining([
    expect.objectContaining({
      from: { dev: negativeSource.deviceId, term: negativeSource.terminalId },
      to: { dev: negativeDestination.deviceId, term: negativeDestination.terminalId },
    }),
  ]));
  const committedWire = afterCommit.wires.find((wire) => wire.from.dev === negativeSource.deviceId && wire.from.term === negativeSource.terminalId);
  expect(committedWire).toBeDefined();
  expect(committedWire).toMatchObject({
    from: { dev: negativeSource.deviceId, term: negativeSource.terminalId },
    to: { dev: negativeDestination.deviceId, term: negativeDestination.terminalId },
  });
  expect(committedWire?.waypoints).toHaveLength(1);
  await expect(page.locator('#validation .core-validation-status')).toContainText('STALE');
  await expect(page.locator('#validation')).toContainText('revision');

  await page.keyboard.press('Control+Z');
  const afterUndo = await bridgeState(page);
  expect(afterUndo.revision).toBe(afterCommit.revision + 1);
  expect(afterUndo.wires).toEqual(initial.wires);
  await expect(page.locator('#validation .core-validation-status')).toContainText('STALE');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('typed wiring assistant selects two devices and finishes the missing 0 V return through the real preview path', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'practice');
  await applyDocument(page, plusOnlyLoadDocument());

  const assistant = page.locator('.v3-wiring-assistant');
  await expect(assistant).toBeVisible();
  await boxSelectSvgDevices(page, ['dc-open', 'load-open']);
  await expect(assistant.locator('.v3-wiring-selection')).toContainText('dc-open ↔ load-open');
  await expect(assistant.locator('.v3-wiring-flow')).toBeVisible();
  await expect(assistant.locator('.v3-wiring-flow')).toContainText('+ 공급');
  await expect(assistant.locator('.v3-wiring-flow')).toContainText('장비·신호');
  await expect(assistant.locator('.v3-wiring-flow')).toContainText('0V/N 귀로');
  await expect(page.locator('#g-wiring-flow .wiring-flow-path.source')).toHaveCount(1);
  await expect(page.locator('#g-wiring-flow .wiring-flow-path.return')).toHaveCount(1);

  await assistant.getByRole('button', { name: '두 장비 선택 시작' }).click();
  await pointerClickSvgDeviceBody(page, 'dc-open');
  await pointerClickSvgDeviceBody(page, 'load-open', true);
  await expect(assistant.locator('.v3-wiring-selection')).toContainText('dc-open ↔ load-open');
  await expect(assistant.locator('.v3-wiring-flow')).toBeVisible();
  const returnPlan = assistant.locator(
    '.v3-wiring-plan[data-direct-from="load-open:-"][data-direct-to="dc-open:-"]',
  );
  await expect(returnPlan).toHaveCount(1);
  await expect(returnPlan).toContainText('결선 가능');

  const beforePreview = await bridgeState(page);
  await returnPlan.getByRole('button', { name: '결선 시작' }).click();
  await expect(page.locator('#m-wire')).toHaveClass(/active/);
  await expect(page.locator(
    '#g-terminals .terminal:not(.terminal-hit)[data-id="load-open"][data-term="-"]',
  )).toHaveClass(/pending/);
  expect(await bridgeState(page)).toMatchObject({ revision: beforePreview.revision, wires: beforePreview.wires });

  await pointerClickSvgTerminal(page, 'dc-open', '-');
  const afterCommit = await bridgeState(page);
  expect(afterCommit.revision).toBeGreaterThan(beforePreview.revision);
  expect(afterCommit.wires).toHaveLength(beforePreview.wires.length + 1);
  await expect(assistant.locator('.v3-wiring-stale')).toContainText('다시 계산');
  await expect(page.locator('#validation')).toContainText('검증 버튼을 누르세요');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('prewire mode blocks a physical miswire unless Alt explicitly records a diagnostic fault', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'prewire');
  await applyDocument(page, plusOnlyLoadDocument());
  await completeVisibleV3Workflow(page);
  await page.keyboard.press('f');

  const before = await bridgeState(page);
  await page.locator('#m-select').click();
  await pointerClickSvgTerminal(page, 'dc-open', '+');
  await pointerClickSvgTerminal(page, 'dc-open', '-');

  const blocked = await bridgeState(page);
  expect(blocked.wires).toHaveLength(before.wires.length);
  await expect(page.locator('#stat')).toContainText('DC_POLARITY_MISMATCH');
  await expect(page.locator('#stat')).toContainText('Alt');

  await page.keyboard.down('Alt');
  await pointerClickSvgTerminal(page, 'dc-open', '-');
  await page.keyboard.up('Alt');
  const after = await bridgeState(page);
  expect(after.wires).toHaveLength(before.wires.length + 1);
  await expect(page.locator('#stat')).toContainText('진단용 강제결선(DC_POLARITY_MISMATCH)');
  await page.locator('#b-validate').click();
  await expect(page.locator('#validation .core-validation-status')).toContainText('FAIL');
  await expect(page.locator('#validation')).toContainText('DC_SHORT');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('v3 Validate exposes an OPEN_RETURN_PATH for a +24V-only load', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'prewire');
  await applyDocument(page, plusOnlyLoadDocument());
  await completeVisibleV3Workflow(page);

  await page.locator('#b-validate').click();
  await expect(page.locator('#validation .core-validation-status')).toContainText('FAIL');
  await expect(page.locator('#validation')).toContainText('OPEN_RETURN_PATH');
  await expect(page.locator('#validation')).toContainText('0V/N 귀로');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('v3 simulation displays the relay OFF and ON closed-loop scenarios', async ({ harness }) => {
  const { page, consoleErrors, pageErrors } = harness;
  await chooseMode(page, 'prewire');
  await applyDocument(page, relayReferenceDocument());
  await completeVisibleV3Workflow(page, 'XBC-DR32H');

  await page.locator('#b-simulate').click();
  await expect(page.locator('#sim-monitor')).toContainText('v3 결정적 I/O 시험');
  await expect(page.locator('#sim-monitor')).toContainText('relay-off');
  await expect(page.locator('#sim-monitor')).toContainText('relay-on');
  await expect(page.locator('#sim-monitor')).toContainText('ON[');
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
  await expect(page.locator('#stat')).toContainText('결선 검토: BLOCKED');
  await expect(page.locator('#stat')).toContainText('LEGACY_DIAGNOSTIC');

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
