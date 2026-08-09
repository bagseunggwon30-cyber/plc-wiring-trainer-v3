import { DEVICE_PROFILES } from '../catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../catalog/v3-profiles';
import type { WorkshopMode } from '../domain/types';
import { LEGACY_PROFILE_MAP } from './legacy-adapter';

export const MODE_STORAGE_KEY = 'plc-wiring-trainer:workshop-mode';

export interface ModePolicy {
  mode: WorkshopMode;
  label: string;
  allowAutoWire: boolean;
  allowAnyLegacyType: boolean;
  allowedLegacyTypes: ReadonlySet<string>;
}

const REVIEW_LEGACY_TYPES = new Set(
  Object.entries(LEGACY_PROFILE_MAP)
    .filter(([, profileId]) => {
      const profile = DEVICE_PROFILES[profileId];
      const v3Profile = DEVICE_PROFILES_V3[profileId];
      return Boolean(profile && (
        profile.boundary
        || (profile.evidence.level !== 'educational' && v3Profile?.reviewCapability === 'full')
      ));
    })
    .map(([legacyType]) => legacyType),
);

export function normalizeWorkshopMode(value: unknown): WorkshopMode {
  return value === 'prewire' ? 'prewire' : 'practice';
}

export function modePolicy(mode: WorkshopMode): ModePolicy {
  return mode === 'prewire'
    ? {
        mode,
        label: '사전 결선 검토',
        allowAutoWire: false,
        allowAnyLegacyType: false,
        allowedLegacyTypes: REVIEW_LEGACY_TYPES,
      }
    : {
        mode,
        label: '연습 모드',
        allowAutoWire: true,
        allowAnyLegacyType: true,
        allowedLegacyTypes: new Set(Object.keys(LEGACY_PROFILE_MAP)),
      };
}

export function isLegacyTypeAllowed(mode: WorkshopMode, legacyType: string): boolean {
  const policy = modePolicy(mode);
  return policy.allowAnyLegacyType || policy.allowedLegacyTypes.has(legacyType);
}

export function createModeSelectorMarkup(defaultMode: WorkshopMode): string {
  const selected = (mode: WorkshopMode): string => mode === defaultMode ? ' aria-pressed="true"' : ' aria-pressed="false"';
  return `<div id="workshop-mode-selector" class="mode-selector" role="dialog" aria-modal="true" aria-labelledby="mode-selector-title" aria-describedby="mode-selector-description">
    <div class="mode-selector-card">
      <p class="mode-selector-kicker">결선 작업장</p>
      <h1 id="mode-selector-title">작업 목적을 선택하세요</h1>
      <p id="mode-selector-description">모드에 따라 사용할 수 있는 장비와 판정 기준이 달라집니다.</p>
      <div class="mode-selector-actions">
        <button type="button" data-workshop-mode="practice"${selected('practice')}>
          <strong>연습 모드</strong><span>모든 교육 장비 · 단계별 힌트</span>
        </button>
        <button type="button" data-workshop-mode="prewire"${selected('prewire')}>
          <strong>사전 결선 검토</strong><span>검증 프로필 · 엄격한 전원/I-O 판정</span>
        </button>
      </div>
      <p class="mode-selector-warning">실제 통전 전에는 제조사 매뉴얼과 자격자의 현장 확인이 필요합니다.</p>
    </div>
  </div>`;
}

export interface ModeControllerOptions {
  document?: Document;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  onModeChange?: (mode: WorkshopMode) => void;
  showOnStart?: boolean;
}

export interface InstalledModeController {
  getMode(): WorkshopMode;
  choose(mode: WorkshopMode): void;
  destroy(): void;
}

export function installModeSelector(options: ModeControllerOptions = {}): InstalledModeController {
  const targetDocument = options.document ?? document;
  const storage = options.storage ?? localStorage;
  let currentMode = normalizeWorkshopMode(storage.getItem(MODE_STORAGE_KEY));
  const host = targetDocument.createElement('div');
  host.innerHTML = createModeSelectorMarkup(currentMode);
  const selector = host.firstElementChild as HTMLElement;

  const applyMode = (mode: WorkshopMode): void => {
    currentMode = mode;
    targetDocument.body.dataset.workshopMode = mode;
    storage.setItem(MODE_STORAGE_KEY, mode);
    options.onModeChange?.(mode);
    targetDocument.defaultView?.dispatchEvent(new CustomEvent('workshop-mode-change', { detail: { mode } }));
  };
  const choose = (mode: WorkshopMode): void => {
    applyMode(mode);
    selector.remove();
  };

  selector.querySelectorAll<HTMLButtonElement>('[data-workshop-mode]').forEach((button) => {
    button.addEventListener('click', () => choose(normalizeWorkshopMode(button.dataset.workshopMode)));
  });
  selector.addEventListener('keydown', (event) => {
    const buttons = [...selector.querySelectorAll<HTMLButtonElement>('[data-workshop-mode]')];
    if (event.key === 'Escape') {
      event.preventDefault();
      buttons.find((button) => button.getAttribute('aria-pressed') === 'true')?.focus();
    }
    if (event.key !== 'Tab' || buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && targetDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && targetDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (options.showOnStart !== false) {
    targetDocument.body.appendChild(selector);
    queueMicrotask(() => {
      const preferred = selector.querySelector<HTMLButtonElement>(`[data-workshop-mode="${currentMode}"]`);
      preferred?.focus();
    });
  } else {
    applyMode(currentMode);
  }

  return { getMode: () => currentMode, choose, destroy: () => selector.remove() };
}
