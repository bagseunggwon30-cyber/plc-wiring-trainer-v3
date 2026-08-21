import type { DeviceProfile, WorkshopDocumentV2, WorkshopMode } from '../domain/types';
import {
  buildControlPanelBomDocument,
  CONTROL_PANEL_BOM_ITEMS,
  defaultControlPanelBomQuantities,
  validateControlPanelBomQuantities,
  type EquipmentOrderCatalogItem,
} from '../domain/equipment-order';

const STYLE_ID = 'equipment-order-panel-style';
const AUTO_WIRING_STORAGE_KEY = 'plc-wiring-trainer:equipment-order:auto-wiring';

export interface EquipmentOrderPanelOptions {
  readonly catalog: readonly EquipmentOrderCatalogItem[];
  readonly profiles: Readonly<Record<string, DeviceProfile>>;
  readonly getMode: () => WorkshopMode;
  readonly createPanelLayout: (rows: number) => Readonly<Record<string, unknown>>;
  readonly applyOrder: (document: WorkshopDocumentV2, summary: string) => void | Promise<void>;
  readonly restoreBackup?: () => boolean | Promise<boolean>;
  readonly getPanelPower: () => boolean;
  readonly setPanelPower: (on: boolean) => boolean;
  readonly setStatus: (message: string) => void;
}

export interface EquipmentOrderPanelController {
  setMode(mode: WorkshopMode): void;
  ensureLauncher(): void;
  destroy(): void;
}

function installStyle(targetDocument: Document): void {
  if (targetDocument.getElementById(STYLE_ID)) return;
  const style = targetDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  .equipment-order-launcher{position:sticky;top:0;z-index:5;width:100%;margin:0 0 7px;padding:9px;border:1px solid #5d87ad;border-radius:5px;background:#244967;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 3px 8px rgba(0,0,0,.35)}
  .equipment-order-launcher:hover{background:#2d5c81}.equipment-order-launcher small{display:block;margin-top:2px;color:#cce6fb;font-size:9px;font-weight:400}
  .equipment-order-backdrop{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.72)}
  .equipment-order-backdrop[hidden]{display:none}.equipment-order-dialog{width:min(880px,96vw);max-height:94vh;overflow:auto;border:1px solid #6687a6;border-radius:10px;background:#14202b;color:#edf6ff;box-shadow:0 18px 60px rgba(0,0,0,.55)}
  .equipment-order-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:15px 16px;border-bottom:1px solid #3d5368}.equipment-order-header h2{margin:0;font-size:18px;color:#bfe4ff}.equipment-order-header p{margin:4px 0 0;color:#9fb4c7;font-size:11px;line-height:1.45}
  .equipment-order-close{border:0;background:transparent;color:#dbe9f5;font-size:20px;cursor:pointer}.equipment-order-body{padding:14px 16px}.equipment-order-zone-note{margin:0 0 12px;padding:9px 11px;border-left:3px solid #4e91c8;background:#101b25;color:#c5d6e5;font-size:11px;line-height:1.55}
  .equipment-order-category{margin:13px 0 5px;color:#8fd0ff;font-size:12px}.equipment-order-table{width:100%;border-collapse:collapse;font-size:11px}.equipment-order-table th,.equipment-order-table td{padding:7px;border-bottom:1px solid #314354;text-align:left}.equipment-order-table th{color:#9ec9ea;background:#101b25;position:sticky;top:0}.equipment-order-table td:nth-child(2){color:#aebfce}.equipment-order-table input{width:82px;padding:7px;border:1px solid #587087;border-radius:4px;background:#09121a;color:#fff;text-align:right;font-weight:700}
  .equipment-order-toggle{display:flex;align-items:center;gap:11px;margin:13px 0;padding:11px 12px;border:1px solid #3f5d73;border-radius:7px;background:#101b25;cursor:pointer}.equipment-order-auto-wire-copy{display:grid;gap:2px}.equipment-order-auto-wire-copy strong{color:#d9efff;font-size:12px}.equipment-order-auto-wire-copy small{color:#91a9ba;font-size:10px;line-height:1.45}.equipment-order-panel-power.on{border-color:#4e9d69;background:#10271b;box-shadow:inset 0 0 0 1px rgba(78,157,105,.18)}.equipment-order-panel-power.on strong{color:#8ff0ac}.equipment-order-switch{position:relative;flex:0 0 auto;width:44px;height:24px}.equipment-order-switch input{position:absolute;opacity:0;pointer-events:none}.equipment-order-switch-track{position:absolute;inset:0;border:1px solid #62798c;border-radius:999px;background:#273643;transition:.16s}.equipment-order-switch-track::after{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#c4d1db;transition:.16s}.equipment-order-switch input:checked+.equipment-order-switch-track{border-color:#54ae77;background:#24613e}.equipment-order-switch input:checked+.equipment-order-switch-track::after{transform:translateX(20px);background:#fff}.equipment-order-switch input:focus-visible+.equipment-order-switch-track{outline:2px solid #8fd0ff;outline-offset:2px}.equipment-order-switch input:disabled+.equipment-order-switch-track{opacity:.45;cursor:not-allowed}
  .equipment-order-presets{display:flex;flex-wrap:wrap;gap:6px;margin:13px 0}.equipment-order-presets button,.equipment-order-actions button{padding:8px 11px;border:1px solid #536d84;border-radius:5px;background:#172a39;color:#edf6ff;cursor:pointer}.equipment-order-summary{min-height:44px;padding:10px;border-radius:5px;background:#0c151d;color:#bfe5c9;font-size:11px;line-height:1.5}.equipment-order-summary.invalid{color:#ffc08c;border:1px solid #8a5933}
  .equipment-order-safety{margin:10px 0 0;color:#f6cf8f;font-size:10px;line-height:1.5}.equipment-order-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #3d5368}.equipment-order-actions .confirm{background:#24613e;border-color:#4e9d69;font-weight:700}.equipment-order-actions button:disabled{opacity:.45;cursor:not-allowed}
  @media(max-width:720px){.equipment-order-table th:nth-child(2),.equipment-order-table td:nth-child(2){display:none}.equipment-order-dialog{max-height:96vh}.equipment-order-table input{width:66px}}
  `;
  targetDocument.head.appendChild(style);
}

export function installEquipmentOrderPanel(
  targetDocument: Document,
  options: EquipmentOrderPanelOptions,
): EquipmentOrderPanelController {
  installStyle(targetDocument);
  let currentMode = options.getMode();
  let quantities = defaultControlPanelBomQuantities();
  let automaticWiring = true;
  let panelPowerOn = options.getPanelPower();
  try {
    automaticWiring = targetDocument.defaultView?.localStorage.getItem(AUTO_WIRING_STORAGE_KEY) !== 'false';
  } catch {
    // Storage can be unavailable in embedded/file contexts; the safe default is enabled.
  }

  const launcher = targetDocument.createElement('button');
  launcher.type = 'button';
  launcher.className = 'equipment-order-launcher';
  launcher.innerHTML = '📋 제어반 BOM 구성<small>장비별 수량 입력 → 자동 배치/결선 → 제어반 전원 ON/OFF</small>';

  const backdrop = targetDocument.createElement('div');
  backdrop.className = 'equipment-order-backdrop';
  backdrop.hidden = true;
  const dialog = targetDocument.createElement('section');
  dialog.className = 'equipment-order-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'equipment-order-title');

  const header = targetDocument.createElement('header');
  header.className = 'equipment-order-header';
  const headingWrap = targetDocument.createElement('div');
  const heading = targetDocument.createElement('h2');
  heading.id = 'equipment-order-title';
  heading.tabIndex = -1;
  heading.textContent = '제어반 장비 수량표 · 자동 배치/결선';
  const headingHelp = targetDocument.createElement('p');
  headingHelp.textContent = 'MCCB·파워·PLC·릴레이·MC·인버터·버튼·센서·램프·버저 수량을 각각 입력합니다.';
  headingWrap.append(heading, headingHelp);
  const close = targetDocument.createElement('button');
  close.type = 'button'; close.className = 'equipment-order-close'; close.textContent = '✕'; close.setAttribute('aria-label', '제어반 BOM 구성 닫기');
  header.append(headingWrap, close);

  const body = targetDocument.createElement('div');
  body.className = 'equipment-order-body';
  const zoneNote = targetDocument.createElement('p');
  zoneNote.className = 'equipment-order-zone-note';
  zoneNote.textContent = '고정 배치: 1단 전원·보호 / 2단 PLC·릴레이 / 3단 MC·인버터 / 4단 24V·0V·PE 단자대 / 도어 버튼·램프·버저 / 제어반 외부 센서·모터';
  const table = targetDocument.createElement('table');
  table.className = 'equipment-order-table';
  table.innerHTML = '<thead><tr><th>장비</th><th>자동 결선 용도</th><th>수량</th></tr></thead><tbody></tbody>';
  const autoWireLabel = targetDocument.createElement('label');
  autoWireLabel.className = 'equipment-order-toggle equipment-order-auto-wire';
  const switchWrap = targetDocument.createElement('span'); switchWrap.className = 'equipment-order-switch';
  const autoWireToggle = targetDocument.createElement('input');
  autoWireToggle.type = 'checkbox'; autoWireToggle.checked = automaticWiring;
  autoWireToggle.setAttribute('role', 'switch'); autoWireToggle.setAttribute('aria-label', '선택 장비 자동 결선');
  const switchTrack = targetDocument.createElement('span'); switchTrack.className = 'equipment-order-switch-track';
  switchWrap.append(autoWireToggle, switchTrack);
  const switchCopy = targetDocument.createElement('span'); switchCopy.className = 'equipment-order-auto-wire-copy';
  const switchTitle = targetDocument.createElement('strong'); switchTitle.textContent = '선택 장비 자동 결선';
  const switchHelp = targetDocument.createElement('small');
  switchHelp.textContent = '전원·차단기 구성이 없으면 첨부 예시처럼 연습용 DC24V 직접 결선을 사용합니다.';
  switchCopy.append(switchTitle, switchHelp); autoWireLabel.append(switchWrap, switchCopy);
  const panelPowerLabel = targetDocument.createElement('label');
  panelPowerLabel.className = 'equipment-order-toggle equipment-order-panel-power';
  const panelPowerSwitchWrap = targetDocument.createElement('span'); panelPowerSwitchWrap.className = 'equipment-order-switch';
  const panelPowerToggle = targetDocument.createElement('input');
  panelPowerToggle.type = 'checkbox'; panelPowerToggle.checked = panelPowerOn;
  panelPowerToggle.setAttribute('role', 'switch'); panelPowerToggle.setAttribute('aria-label', '제어반 전원 ON/OFF');
  const panelPowerTrack = targetDocument.createElement('span'); panelPowerTrack.className = 'equipment-order-switch-track';
  panelPowerSwitchWrap.append(panelPowerToggle, panelPowerTrack);
  const panelPowerCopy = targetDocument.createElement('span'); panelPowerCopy.className = 'equipment-order-auto-wire-copy';
  const panelPowerTitle = targetDocument.createElement('strong');
  const panelPowerHelp = targetDocument.createElement('small');
  panelPowerCopy.append(panelPowerTitle, panelPowerHelp); panelPowerLabel.append(panelPowerSwitchWrap, panelPowerCopy);
  const presets = targetDocument.createElement('div');
  presets.className = 'equipment-order-presets';
  const standard = targetDocument.createElement('button'); standard.type = 'button'; standard.textContent = '기본 제어반 수량';
  const clear = targetDocument.createElement('button'); clear.type = 'button'; clear.textContent = '전체 수량 0';
  presets.append(standard, clear);
  const summary = targetDocument.createElement('div'); summary.className = 'equipment-order-summary'; summary.setAttribute('role', 'status');
  const safety = targetDocument.createElement('p'); safety.className = 'equipment-order-safety';
  safety.textContent = '확인 시 현재 작업을 로컬에 백업한 뒤 새 제어반으로 교체합니다. 자동 결선은 연습 모드 전용이며, 교육용 프로필은 VERIFIED_PREWIRE 근거로 사용되지 않습니다.';
  body.append(zoneNote, table, autoWireLabel, panelPowerLabel, presets, summary, safety);

  const actions = targetDocument.createElement('footer');
  actions.className = 'equipment-order-actions';
  const restore = targetDocument.createElement('button'); restore.type = 'button'; restore.textContent = '구성 전 작업 복원'; restore.disabled = !options.restoreBackup;
  const cancel = targetDocument.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소';
  const confirm = targetDocument.createElement('button'); confirm.type = 'button'; confirm.className = 'confirm'; confirm.textContent = '확인 · 제어반 자동 구성';
  actions.append(restore, cancel, confirm);
  dialog.append(header, body, actions); backdrop.appendChild(dialog); targetDocument.body.appendChild(backdrop);

  const syncPanelPower = (): void => {
    panelPowerOn = options.getPanelPower();
    panelPowerToggle.checked = panelPowerOn;
    panelPowerToggle.disabled = currentMode !== 'practice';
    panelPowerLabel.classList.toggle('on', panelPowerOn);
    panelPowerTitle.textContent = panelPowerOn ? '제어반 전원 ON' : '제어반 전원 OFF';
    panelPowerHelp.textContent = currentMode !== 'practice'
      ? '사전 결선 검토 모드에서는 안전을 위해 전원을 켤 수 없습니다.'
      : panelPowerOn
        ? '연습용 시뮬레이션 통전 중 · 버튼과 릴레이 동작을 시험할 수 있습니다.'
        : '코일·활성선·타이머가 안전하게 초기화된 무전원 상태입니다.';
  };

  const updateSummary = (): void => {
    syncPanelPower();
    const validation = validateControlPanelBomQuantities(quantities, {
      automaticWiring,
      allowDirectPowerFallback: automaticWiring,
    });
    const practiceAllowed = currentMode === 'practice';
    summary.classList.toggle('invalid', !validation.ok || !practiceAllowed);
    summary.textContent = !practiceAllowed
      ? '사전 결선 검토 모드에서는 자동 결선을 실행하지 않습니다. 상단 모드 버튼에서 연습 모드로 전환하세요.'
      : validation.ok
        ? automaticWiring
          ? `제어반 전원 ${panelPowerOn ? 'ON' : 'OFF'} · 입력 ${validation.inputPointCount}점 · 일반 출력 ${validation.generalOutputCount}점 · 인버터 전용 COM ${validation.inverterOutputGroupCount}그룹 · 주문 장비 ${validation.totalOrderedDevices}대 · 전원부 미선택 시 DC24V 직접 결선`
          : `제어반 전원 ${panelPowerOn ? 'ON' : 'OFF'} · 주문 장비 ${validation.totalOrderedDevices}대 · 장비만 자동 배치 · 결선은 직접 작성`
        : `${validation.code} · ${validation.message}`;
    confirm.disabled = !practiceAllowed || !validation.ok;
    confirm.textContent = automaticWiring ? '확인 · 자동 배치/결선' : '확인 · 장비만 배치';
  };

  const renderTable = (): void => {
    const tbody = table.tBodies[0];
    tbody.replaceChildren();
    let lastCategory = '';
    for (const item of CONTROL_PANEL_BOM_ITEMS) {
      if (item.category !== lastCategory) {
        const categoryRow = tbody.insertRow();
        const categoryCell = categoryRow.insertCell();
        categoryCell.colSpan = 3;
        categoryCell.className = 'equipment-order-category';
        categoryCell.textContent = item.category;
        lastCategory = item.category;
      }
      const row = tbody.insertRow();
      row.dataset.equipmentKey = item.key;
      row.insertCell().textContent = item.label;
      row.insertCell().textContent = item.detail;
      const quantityCell = row.insertCell();
      const input = targetDocument.createElement('input');
      input.type = 'number'; input.min = '0'; input.max = String(item.maximumQuantity); input.step = '1';
      input.value = String(quantities[item.key] ?? 0); input.setAttribute('aria-label', `${item.label} 수량`);
      input.addEventListener('input', () => {
        quantities[item.key] = Number(input.value);
        updateSummary();
      });
      quantityCell.appendChild(input);
    }
    updateSummary();
  };

  const closeDialog = (): void => { backdrop.hidden = true; launcher.focus(); };
  const openDialog = (): void => { backdrop.hidden = false; renderTable(); heading.focus(); };
  const handleLauncherClick = (event: Event): void => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function' || !target.closest('.equipment-order-launcher')) return;
    event.preventDefault();
    openDialog();
  };
  // The legacy palette rebuilds its children with innerHTML. Event delegation
  // keeps the launcher working even during the brief cloned-node window.
  targetDocument.addEventListener('click', handleLauncherClick, true);
  close.addEventListener('click', closeDialog); cancel.addEventListener('click', closeDialog);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeDialog(); });
  targetDocument.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !backdrop.hidden) closeDialog(); });
  autoWireToggle.addEventListener('change', () => {
    automaticWiring = autoWireToggle.checked;
    try { targetDocument.defaultView?.localStorage.setItem(AUTO_WIRING_STORAGE_KEY, String(automaticWiring)); } catch { /* no-op */ }
    updateSummary();
  });
  panelPowerToggle.addEventListener('change', () => {
    if (currentMode !== 'practice') {
      syncPanelPower(); updateSummary(); return;
    }
    panelPowerOn = options.setPanelPower(panelPowerToggle.checked);
    syncPanelPower();
    options.setStatus(panelPowerOn
      ? '제어반 전원 ON · 연습용 시뮬레이션 통전 상태입니다.'
      : '제어반 전원 OFF · 코일·활성선·타이머 상태를 초기화했습니다.');
    updateSummary();
  });
  standard.addEventListener('click', () => { quantities = defaultControlPanelBomQuantities(); renderTable(); });
  clear.addEventListener('click', () => {
    quantities = Object.fromEntries(CONTROL_PANEL_BOM_ITEMS.map((item) => [item.key, 0]));
    renderTable();
  });
  restore.addEventListener('click', () => {
    if (!options.restoreBackup) return;
    void (async () => {
      const restored = await options.restoreBackup?.();
      if (restored) closeDialog();
      else {
        summary.classList.add('invalid');
        summary.textContent = '복원할 제어반 구성 전 작업이 없습니다.';
      }
    })();
  });
  confirm.addEventListener('click', () => {
    void (async () => {
      const validation = validateControlPanelBomQuantities(quantities, {
        automaticWiring,
        allowDirectPowerFallback: automaticWiring,
      });
      if (currentMode !== 'practice' || !validation.ok) { updateSummary(); return; }
      confirm.disabled = true; confirm.textContent = '제어반 구성 중…';
      try {
        const built = buildControlPanelBomDocument({
          quantities,
          catalog: options.catalog,
          profiles: options.profiles,
          layout: options.createPanelLayout(6),
          automaticWiring,
          allowDirectPowerFallback: automaticWiring,
        });
        await options.applyOrder(
          built.document,
          automaticWiring
            ? `BOM 장비 ${validation.totalOrderedDevices}대 · 자동 추가 포함 ${built.totalDevices}대 · 자동 결선 ${built.totalWires}가닥`
            : `BOM 장비 ${validation.totalOrderedDevices}대 · 장비만 배치 · 결선 0가닥`,
        );
        panelPowerOn = options.setPanelPower(panelPowerOn);
        closeDialog();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.setStatus(`제어반 BOM 구성 실패 · ${message}`);
        summary.classList.add('invalid'); summary.textContent = `구성 실패 · ${message}`;
      } finally {
        updateSummary();
      }
    })();
  });

  const ensureLauncher = (): void => {
    const palette = targetDocument.getElementById('palette');
    if (!palette) return;
    palette.querySelectorAll('.equipment-order-launcher').forEach((candidate) => {
      if (candidate !== launcher) candidate.remove();
    });
    if (launcher.parentElement !== palette) palette.prepend(launcher);
  };
  ensureLauncher();
  const palette = targetDocument.getElementById('palette');
  const observer = palette ? new MutationObserver(() => {
    if (!launcher.isConnected) queueMicrotask(ensureLauncher);
  }) : null;
  observer?.observe(palette!, { childList: true });

  return {
    setMode(mode) {
      currentMode = mode;
      if (mode !== 'practice' && options.getPanelPower()) options.setPanelPower(false);
      updateSummary();
    },
    ensureLauncher,
    destroy() {
      observer?.disconnect();
      targetDocument.removeEventListener('click', handleLauncherClick, true);
      launcher.remove(); backdrop.remove();
    },
  };
}
