import type {
  MissionConnection,
  MissionConnectionSet,
  MissionDefinitionV2,
} from './missions';
import type {
  DeviceInstanceV2,
  DeviceProfile,
  WireV2,
  WorkshopDocumentV2,
  WorkshopMode,
} from './types';

const MAX_ORDER_SETS = 6;

export interface EquipmentOrderCatalogItem {
  readonly profileId: string;
  readonly legacyType: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly mountTags: readonly string[];
}

export interface EquipmentOrderItem {
  readonly profileId: string;
  readonly roleIds: readonly string[];
  readonly label: string;
  readonly unitsPerSet: number;
}

export interface EquipmentOrderRecipe {
  readonly id: string;
  readonly missionId: string;
  readonly title: string;
  readonly description: string;
  readonly eligibleModes: readonly WorkshopMode[];
  readonly roleProfileIds: Readonly<Record<string, string>>;
  readonly connectionSets: readonly MissionConnectionSet[];
  readonly items: readonly EquipmentOrderItem[];
  readonly wiresPerSet: number;
}

export type EquipmentOrderValidation =
  | {
    readonly ok: true;
    readonly setCount: number;
    readonly totalDevices: number;
    readonly totalWires: number;
  }
  | {
    readonly ok: false;
    readonly code: 'ORDER_QUANTITY_INVALID' | 'ORDER_QUANTITY_EMPTY' | 'ORDER_QUANTITY_RATIO_MISMATCH' | 'ORDER_SET_LIMIT_EXCEEDED';
    readonly message: string;
  };

export interface EquipmentOrderBuildInput {
  readonly recipe: EquipmentOrderRecipe;
  readonly quantities: Readonly<Record<string, number>>;
  readonly catalog: readonly EquipmentOrderCatalogItem[];
  readonly profiles: Readonly<Record<string, DeviceProfile>>;
  readonly layout: Readonly<Record<string, unknown>>;
}

export interface EquipmentOrderBuildResult {
  readonly document: WorkshopDocumentV2;
  readonly setCount: number;
  readonly totalDevices: number;
  readonly totalWires: number;
}

function recipeFor(
  mission: MissionDefinitionV2,
  id: string,
  title: string,
  connectionSets: readonly MissionConnectionSet[],
): EquipmentOrderRecipe {
  const roleProfileIds = Object.fromEntries(mission.roles.map((role) => [role.id, role.allowedProfileIds[0]]));
  const itemsByProfile = new Map<string, { roleIds: string[]; labels: string[] }>();
  for (const role of mission.roles) {
    const profileId = roleProfileIds[role.id];
    if (!profileId) continue;
    const current = itemsByProfile.get(profileId) ?? { roleIds: [], labels: [] };
    current.roleIds.push(role.id);
    current.labels.push(role.label);
    itemsByProfile.set(profileId, current);
  }
  const items = [...itemsByProfile].map(([profileId, value]) => ({
    profileId,
    roleIds: value.roleIds,
    label: value.labels.join(' / '),
    unitsPerSet: value.roleIds.length,
  }));
  return {
    id,
    missionId: mission.id,
    title,
    description: mission.description,
    eligibleModes: mission.eligibleModes,
    roleProfileIds,
    connectionSets,
    items,
    wiresPerSet: connectionSets.reduce((sum, set) => sum + set.connections.length, 0),
  };
}

/** Converts mission pin-to-pin contracts into explicit order recipes. */
export function createMissionOrderRecipes(
  missions: readonly MissionDefinitionV2[],
): readonly EquipmentOrderRecipe[] {
  return missions.flatMap((mission) => {
    if (mission.connectionPolicy === 'one-of') {
      return mission.expectedConnections.map((set) => recipeFor(
        mission,
        `${mission.id}:${set.id}`,
        `${mission.title} · ${set.label}`,
        [set],
      ));
    }
    return [recipeFor(mission, mission.id, mission.title, mission.expectedConnections)];
  });
}

export function defaultEquipmentOrderQuantities(
  recipe: EquipmentOrderRecipe,
  setCount = 1,
): Readonly<Record<string, number>> {
  return Object.fromEntries(recipe.items.map((item) => [item.profileId, item.unitsPerSet * setCount]));
}

export function validateEquipmentOrderQuantities(
  recipe: EquipmentOrderRecipe,
  quantities: Readonly<Record<string, number>>,
): EquipmentOrderValidation {
  const ratios: number[] = [];
  for (const item of recipe.items) {
    const quantity = quantities[item.profileId];
    if (!Number.isInteger(quantity) || quantity < 0) {
      return {
        ok: false,
        code: 'ORDER_QUANTITY_INVALID',
        message: `${item.label} 수량은 0 이상의 정수여야 합니다.`,
      };
    }
    ratios.push(quantity / item.unitsPerSet);
  }
  if (ratios.every((ratio) => ratio === 0)) {
    return { ok: false, code: 'ORDER_QUANTITY_EMPTY', message: '장비 수량을 한 세트 이상 입력하세요.' };
  }
  const setCount = ratios[0];
  if (!Number.isInteger(setCount) || setCount <= 0 || ratios.some((ratio) => ratio !== setCount)) {
    return {
      ok: false,
      code: 'ORDER_QUANTITY_RATIO_MISMATCH',
      message: '모든 장비 수량은 선택한 회로의 한 세트 구성과 같은 배수여야 합니다.',
    };
  }
  if (setCount > MAX_ORDER_SETS) {
    return {
      ok: false,
      code: 'ORDER_SET_LIMIT_EXCEEDED',
      message: `한 번에 만들 수 있는 회로는 ${MAX_ORDER_SETS}세트까지입니다.`,
    };
  }
  return {
    ok: true,
    setCount,
    totalDevices: recipe.items.reduce((sum, item) => sum + item.unitsPerSet * setCount, 0),
    totalWires: recipe.wiresPerSet * setCount,
  };
}

interface RailBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly row: number;
  readonly col: number;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function railsFromLayout(layout: Readonly<Record<string, unknown>>): RailBox[] {
  const raw = layout.rails;
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' ? Object.values(raw as Record<string, unknown>) : [];
  return values.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    const w = finite(value.w);
    if (w <= 0) return [];
    return [{
      id: String(value.id ?? `rail-${index + 1}`),
      x: finite(value.x), y: finite(value.y), w, h: finite(value.h, 44),
      row: finite(value.row, index), col: finite(value.col),
    }];
  }).sort((a, b) => a.row - b.row || a.col - b.col || a.id.localeCompare(b.id));
}

function doorFromLayout(layout: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const door = layout.doorPanel;
  return door && typeof door === 'object' ? door as Record<string, unknown> : null;
}

function idPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function wireColor(connection: MissionConnection): string {
  const marker = `${connection.from.terminalId} ${connection.to.terminalId} ${connection.label}`.toUpperCase();
  if (marker.includes('PE') || marker.includes('FG')) return '#16a34a';
  if (marker.includes('RS485') || marker.includes('485') || marker.includes(' A →') || marker.includes(' B →')) return '#8b5cf6';
  if (marker.includes('0V') || marker.includes('DC-') || marker.includes(' N ') || marker.includes('→ N')) return '#2563eb';
  if (marker.includes('+24V') || marker.includes('V+') || marker.includes('DC+')) return '#ef4444';
  if (marker.includes('L1') || marker.includes('AC L')) return '#8b4513';
  return '#f59e0b';
}

function assertTerminal(
  profiles: Readonly<Record<string, DeviceProfile>>,
  profileId: string,
  terminalId: string,
): void {
  const profile = profiles[profileId];
  if (!profile?.terminals.some((terminal) => terminal.id === terminalId)) {
    throw new Error(`ORDER_TERMINAL_UNKNOWN:${profileId}:${terminalId}`);
  }
}

/** Builds a complete, deterministic practice document. Every ordered device belongs to one circuit set. */
export function buildEquipmentOrderDocument(input: EquipmentOrderBuildInput): EquipmentOrderBuildResult {
  const validation = validateEquipmentOrderQuantities(input.recipe, input.quantities);
  if (!validation.ok) throw new Error(`${validation.code}:${validation.message}`);
  const catalogByProfile = new Map(input.catalog.map((item) => [item.profileId, item]));
  const rails = railsFromLayout(input.layout);
  if (rails.length < validation.setCount) throw new Error('ORDER_LAYOUT_RAILS_INSUFFICIENT');
  const door = doorFromLayout(input.layout);
  const devices: DeviceInstanceV2[] = [];
  const wires: WireV2[] = [];
  const bindingsBySet: Array<Record<string, string>> = [];
  const designations: Record<string, string> = {};
  const deviceSettings: Record<string, Record<string, unknown>> = {};
  const conductorSettings: Record<string, Record<string, unknown>> = {};
  let wireIndex = 1;
  let doorIndex = 0;
  const railsPerSet = Math.max(1, Math.floor(rails.length / validation.setCount));

  for (let setIndex = 0; setIndex < validation.setCount; setIndex += 1) {
    const setRails = rails.slice(setIndex * railsPerSet, (setIndex + 1) * railsPerSet);
    if (!setRails.length) throw new Error('ORDER_LAYOUT_RAILS_INSUFFICIENT');
    const placementRails = setRails.slice(0, Math.min(2, setRails.length));
    const roleIds = Object.keys(input.recipe.roleProfileIds);
    const firstRowCount = placementRails.length > 1 ? Math.ceil(roleIds.length / 2) : roleIds.length;
    const cursorByRail = new Map(placementRails.map((rail) => [rail.id, rail.x + 70]));
    const binding: Record<string, string> = {};
    for (const [roleIndex, role] of roleIds.entries()) {
      const rail = placementRails[roleIndex < firstRowCount ? 0 : Math.min(1, placementRails.length - 1)];
      let cursorX = cursorByRail.get(rail.id) ?? rail.x + 70;
      const profileId = input.recipe.roleProfileIds[role];
      const profile = input.profiles[profileId];
      const catalogItem = catalogByProfile.get(profileId);
      if (!profile || !catalogItem) throw new Error(`ORDER_CATALOG_PROFILE_MISSING:${profileId}`);
      const deviceId = `order-s${String(setIndex + 1).padStart(2, '0')}-${idPart(role)}`;
      let x = cursorX;
      let y = rail.y + rail.h / 2 - catalogItem.height / 2;
      const doorWidth = door ? finite(door.w, 420) : 0;
      if (catalogItem.mountTags.includes('door') && door && catalogItem.width <= doorWidth - 30) {
        const doorX = finite(door.x), doorY = finite(door.y);
        x = doorX + (doorWidth - catalogItem.width) / 2;
        y = doorY + 60 + doorIndex * (catalogItem.height + 50);
        doorIndex += 1;
      } else {
        if (cursorX + catalogItem.width > rail.x + rail.w - 30) throw new Error(`ORDER_LAYOUT_OVERFLOW:${rail.id}`);
        cursorByRail.set(rail.id, cursorX + catalogItem.width + 280);
      }
      devices.push({
        id: deviceId,
        profileId,
        profileVersion: profile.version,
        evidenceLevel: profile.evidence.level,
        legacyType: catalogItem.legacyType,
        missingProfile: false,
        x, y, rotation: 0,
        configuration: { orderCode: profile.model },
      });
      binding[role] = deviceId;
      designations[deviceId] = `S${setIndex + 1}-${role.toUpperCase()}`;
      deviceSettings[deviceId] = { orderCode: profile.model };
    }
    bindingsBySet.push(binding);

    for (const set of input.recipe.connectionSets) {
      for (const connection of set.connections) {
        const fromDevice = binding[connection.from.role];
        const toDevice = binding[connection.to.role];
        const fromProfile = input.recipe.roleProfileIds[connection.from.role];
        const toProfile = input.recipe.roleProfileIds[connection.to.role];
        if (!fromDevice || !toDevice || !fromProfile || !toProfile) throw new Error('ORDER_ROLE_BINDING_MISSING');
        assertTerminal(input.profiles, fromProfile, connection.from.terminalId);
        assertTerminal(input.profiles, toProfile, connection.to.terminalId);
        const id = `order-w${String(wireIndex).padStart(3, '0')}`;
        const color = wireColor(connection);
        const tag = `ORD-S${String(setIndex + 1).padStart(2, '0')}-${String(wireIndex).padStart(3, '0')}`;
        wires.push({
          id,
          from: { deviceId: fromDevice, terminalId: connection.from.terminalId },
          to: { deviceId: toDevice, terminalId: connection.to.terminalId },
          color,
          tag,
        });
        conductorSettings[id] = {
          cableId: null, core: null, wireNumber: tag, gauge: null, color, lengthMm: null,
          ferruleFrom: null, ferruleTo: null, lugFrom: null, lugTo: null,
          shielded: connection.label.toUpperCase().includes('RS485'), drain: false,
        };
        wireIndex += 1;
      }
    }
  }

  const singleBinding = validation.setCount === 1 ? bindingsBySet[0] : undefined;
  const hasAcSupply = input.recipe.items.some((item) => item.profileId === 'boundary:ac-supply');
  const scopeDevices = devices.filter((device) => !input.profiles[device.profileId]?.boundary).map((device) => device.id);
  const document: WorkshopDocumentV2 = {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: `장비 주문 자동 구성 · ${input.recipe.title} · ${validation.setCount}세트`,
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires,
    jumpers: [],
    layout: { ...input.layout },
    settings: {
      ...(singleBinding ? { missionId: input.recipe.missionId, roleBindings: singleBinding } : {}),
      v3Workflow: {
        sourceSystem: hasAcSupply
          ? { id: 'ac-1ph-220v', label: 'AC 1Φ 220 V / L-N-PE' }
          : { id: 'dc-24v-isolated', label: 'DC 24 V 절연 전원 / +24V-0V' },
        earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
        canvasUnitsPerMm: 2,
        sourceProtection: {
          phaseSequence: null,
          prospectiveShortCircuitCurrentA: null,
          protectiveDeviceCurve: null,
        },
        reviewScope: {
          templateId: 'control-panel-prewire',
          deviceIds: scopeDevices,
        },
        designations,
        deviceSettings,
        conductorSettings,
        plcRuntime: null,
      },
    },
    extensions: {
      legacy: {
        equipmentOrder: {
          recipeId: input.recipe.id,
          setCount: validation.setCount,
          quantities: { ...input.quantities },
          connectionSetIds: input.recipe.connectionSets.map((set) => set.id),
        },
      },
    },
  };
  return {
    document,
    setCount: validation.setCount,
    totalDevices: validation.totalDevices,
    totalWires: validation.totalWires,
  };
}

export type ControlPanelPlacementZone = 'power' | 'control' | 'drive' | 'distribution' | 'door' | 'field';

export interface ControlPanelBomItem {
  readonly key: string;
  readonly category: '전원·보호' | '제어' | '구동' | '도어 조작' | '센서·부하';
  readonly label: string;
  readonly detail: string;
  readonly profileId: string;
  readonly legacyType: string;
  readonly placementZone: ControlPanelPlacementZone;
  readonly designationPrefix: string;
  readonly defaultQuantity: number;
  readonly maximumQuantity: number;
}

export const CONTROL_PANEL_BOM_ITEMS: readonly ControlPanelBomItem[] = Object.freeze([
  { key: 'mccb2p', category: '전원·보호', label: 'MCCB 2P', detail: 'PLC·파워 단상 분기용', profileId: 'educational:mccb-2p', legacyType: 'MCCB1P', placementZone: 'power', designationPrefix: 'QF', defaultQuantity: 2, maximumQuantity: 8 },
  { key: 'mccb3p', category: '전원·보호', label: 'MCCB 3P', detail: 'MC·인버터 3상 분기용', profileId: 'educational:mccb-3p', legacyType: 'MCCB', placementZone: 'power', designationPrefix: 'QF', defaultQuantity: 0, maximumQuantity: 8 },
  { key: 'powerSupply', category: '전원·보호', label: 'MDR-100-24 파워', detail: 'DC24V/0V 제어전원', profileId: 'mean-well:mdr-100-24', legacyType: 'MDR-100', placementZone: 'power', designationPrefix: 'PS', defaultQuantity: 1, maximumQuantity: 4 },
  { key: 'plc', category: '제어', label: 'XBC-DN32UP PLC', detail: 'DI16·NPN 싱크 TR DO16·4축 위치결정', profileId: 'ls-electric:xbc-dn32up', legacyType: 'XBC-DN32UP', placementZone: 'control', designationPrefix: 'PLC', defaultQuantity: 1, maximumQuantity: 4 },
  { key: 'relay', category: '제어', label: 'MY2N-D2 릴레이', detail: 'DC24V 코일·2c', profileId: 'omron:my2n-d2-dc24', legacyType: 'MY2N', placementZone: 'control', designationPrefix: 'KA', defaultQuantity: 2, maximumQuantity: 16 },
  { key: 'contactor', category: '구동', label: 'MC-22b 전자접촉기', detail: 'DC24V 코일·3극', profileId: 'ls-electric:mc-22b-dc24-1a1b', legacyType: 'MC-22B-DC24', placementZone: 'drive', designationPrefix: 'KM', defaultQuantity: 0, maximumQuantity: 8 },
  { key: 'inverter', category: '구동', label: 'SV-iG5A 인버터', detail: '교육용 계열 프로필', profileId: 'ls-electric:sv-ig5a', legacyType: 'IG5A', placementZone: 'drive', designationPrefix: 'INV', defaultQuantity: 0, maximumQuantity: 4 },
  { key: 'motor', category: '구동', label: '3상 유도전동기', detail: 'MC·인버터 부하', profileId: 'educational:three-phase-motor', legacyType: 'MOTOR-3P', placementZone: 'field', designationPrefix: 'M', defaultQuantity: 0, maximumQuantity: 8 },
  { key: 'startButton', category: '도어 조작', label: 'a접 버튼', detail: 'NO·PLC 입력', profileId: 'educational:pushbutton-no', legacyType: 'PB-NO', placementZone: 'door', designationPrefix: 'SB', defaultQuantity: 1, maximumQuantity: 16 },
  { key: 'stopButton', category: '도어 조작', label: 'b접 버튼', detail: 'NC·PLC 입력', profileId: 'educational:pushbutton-nc', legacyType: 'PB-NC', placementZone: 'door', designationPrefix: 'SB', defaultQuantity: 1, maximumQuantity: 16 },
  { key: 'emergencyStop', category: '도어 조작', label: '비상정지 버튼', detail: 'NC×2 중 1회로 PLC 입력', profileId: 'educational:emergency-stop-nc2', legacyType: 'EMSTOP', placementZone: 'door', designationPrefix: 'SB', defaultQuantity: 1, maximumQuantity: 4 },
  { key: 'npnSensor', category: '센서·부하', label: 'NPN 근접센서', detail: '갈색 +24V·청색 0V·흑색 입력', profileId: 'generic:prox-npn-3wire', legacyType: 'PROX-NPN', placementZone: 'field', designationPrefix: 'B', defaultQuantity: 2, maximumQuantity: 16 },
  { key: 'greenLamp', category: '도어 조작', label: '녹색 램프', detail: 'DC24V 표시등', profileId: 'educational:dc24-load', legacyType: 'LAMP-G', placementZone: 'door', designationPrefix: 'HL', defaultQuantity: 1, maximumQuantity: 16 },
  { key: 'yellowLamp', category: '도어 조작', label: '황색 램프', detail: 'DC24V 표시등', profileId: 'educational:dc24-load', legacyType: 'LAMP-Y', placementZone: 'door', designationPrefix: 'HL', defaultQuantity: 1, maximumQuantity: 16 },
  { key: 'whiteLamp', category: '도어 조작', label: '백색 램프', detail: 'DC24V 표시등', profileId: 'educational:dc24-load', legacyType: 'LAMP-W', placementZone: 'door', designationPrefix: 'HL', defaultQuantity: 0, maximumQuantity: 16 },
  { key: 'buzzer', category: '도어 조작', label: '버저', detail: 'DC24V 경보 부하', profileId: 'educational:dc24-load', legacyType: 'BUZZER', placementZone: 'door', designationPrefix: 'HA', defaultQuantity: 1, maximumQuantity: 8 },
]);

export interface ControlPanelBomValidationSuccess {
  readonly ok: true;
  readonly totalOrderedDevices: number;
  readonly inputPointCount: number;
  readonly generalOutputCount: number;
  readonly inverterOutputGroupCount: number;
  readonly outputPointCount: number;
  readonly requiredOutputGroups: number;
}

export interface ControlPanelBomValidationFailure {
  readonly ok: false;
  readonly code:
    | 'BOM_QUANTITY_INVALID'
    | 'BOM_EMPTY'
    | 'BOM_MCCB_2P_COUNT'
    | 'BOM_MCCB_3P_COUNT'
    | 'BOM_MOTOR_COUNT'
    | 'BOM_PLC_REQUIRED'
    | 'BOM_POWER_REQUIRED'
    | 'BOM_PLC_INPUT_CAPACITY'
    | 'BOM_PLC_OUTPUT_CAPACITY';
  readonly message: string;
}

export type ControlPanelBomValidation = ControlPanelBomValidationSuccess | ControlPanelBomValidationFailure;

export function defaultControlPanelBomQuantities(): Record<string, number> {
  return Object.fromEntries(CONTROL_PANEL_BOM_ITEMS.map((item) => [item.key, item.defaultQuantity]));
}

export function validateControlPanelBomQuantities(
  quantities: Readonly<Record<string, number>>,
): ControlPanelBomValidation {
  for (const item of CONTROL_PANEL_BOM_ITEMS) {
    const quantity = quantities[item.key];
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.maximumQuantity) {
      return { ok: false, code: 'BOM_QUANTITY_INVALID', message: `${item.label} 수량은 0~${item.maximumQuantity}의 정수여야 합니다.` };
    }
  }
  const quantity = (key: string): number => quantities[key] ?? 0;
  const totalOrderedDevices = CONTROL_PANEL_BOM_ITEMS.reduce((sum, item) => sum + quantity(item.key), 0);
  if (totalOrderedDevices === 0) return { ok: false, code: 'BOM_EMPTY', message: '제어반에 넣을 장비 수량을 입력하세요.' };

  const requiredMccb2p = quantity('powerSupply') + quantity('plc');
  if (quantity('mccb2p') !== requiredMccb2p) {
    return { ok: false, code: 'BOM_MCCB_2P_COUNT', message: `단상 분기마다 MCCB 2P가 1대 필요합니다. 현재 필요한 수량은 ${requiredMccb2p}대입니다.` };
  }
  const requiredThreePhaseBranches = quantity('contactor') + quantity('inverter');
  if (quantity('mccb3p') !== requiredThreePhaseBranches) {
    return { ok: false, code: 'BOM_MCCB_3P_COUNT', message: `MC·인버터 3상 분기마다 MCCB 3P가 1대 필요합니다. 현재 필요한 수량은 ${requiredThreePhaseBranches}대입니다.` };
  }
  if (quantity('motor') !== requiredThreePhaseBranches) {
    return { ok: false, code: 'BOM_MOTOR_COUNT', message: `MC·인버터마다 연결할 모터가 1대 필요합니다. 현재 필요한 수량은 ${requiredThreePhaseBranches}대입니다.` };
  }

  const inputPointCount = quantity('startButton') + quantity('stopButton') + quantity('emergencyStop') + quantity('npnSensor');
  const generalOutputCount = quantity('relay') + quantity('contactor') + quantity('greenLamp')
    + quantity('yellowLamp') + quantity('whiteLamp') + quantity('buzzer');
  const inverterOutputGroupCount = quantity('inverter');
  const outputPointCount = inverterOutputGroupCount * 2 + generalOutputCount;
  const requiredOutputGroups = Math.ceil(outputPointCount / 4);
  if ((inputPointCount > 0 || outputPointCount > 0) && quantity('plc') === 0) {
    return { ok: false, code: 'BOM_PLC_REQUIRED', message: '입력·출력 장비를 자동 결선하려면 PLC가 1대 이상 필요합니다.' };
  }
  if ((inputPointCount > 0 || outputPointCount > 0) && quantity('powerSupply') === 0) {
    return { ok: false, code: 'BOM_POWER_REQUIRED', message: '버튼·센서·DC 부하를 자동 결선하려면 DC24V 파워가 1대 이상 필요합니다.' };
  }
  if (inputPointCount > quantity('plc') * 16) {
    return { ok: false, code: 'BOM_PLC_INPUT_CAPACITY', message: `입력 ${inputPointCount}점에 PLC 입력이 부족합니다. PLC ${Math.ceil(inputPointCount / 16)}대 이상이 필요합니다.` };
  }
  if (outputPointCount > quantity('plc') * 16) {
    return { ok: false, code: 'BOM_PLC_OUTPUT_CAPACITY', message: `출력 ${outputPointCount}점에 XBC-DN32UP 출력이 부족합니다. PLC ${Math.ceil(outputPointCount / 16)}대 이상이 필요합니다.` };
  }
  return { ok: true, totalOrderedDevices, inputPointCount, generalOutputCount, inverterOutputGroupCount, outputPointCount, requiredOutputGroups };
}

export interface ControlPanelIoInputAssignment {
  readonly deviceId: string;
  readonly plcId: string;
  readonly plcTerminal: string;
  readonly kind: 'dry-contact' | 'npn-sensor';
}

export interface ControlPanelIoOutputAssignment {
  readonly deviceId: string;
  readonly plcId: string;
  readonly kind: 'relay' | 'contactor' | 'load' | 'inverter';
  readonly plcCommon: string;
  readonly plcTerminals: readonly string[];
}

export interface ControlPanelBomBuildInput {
  readonly quantities: Readonly<Record<string, number>>;
  readonly catalog: readonly EquipmentOrderCatalogItem[];
  readonly profiles: Readonly<Record<string, DeviceProfile>>;
  readonly layout: Readonly<Record<string, unknown>>;
}

export interface ControlPanelBomBuildResult {
  readonly document: WorkshopDocumentV2;
  readonly totalDevices: number;
  readonly totalWires: number;
  readonly ioAssignments: {
    readonly inputs: readonly ControlPanelIoInputAssignment[];
    readonly outputs: readonly ControlPanelIoOutputAssignment[];
  };
}

const PLC_INPUT_TERMINALS = Array.from({ length: 16 }, (_, index) => `P0${index.toString(16).toUpperCase()}`);
const PLC_OUTPUT_TERMINALS = Array.from({ length: 16 }, (_, index) => `P2${index.toString(16).toUpperCase()}`);

/** Builds a deterministic practice panel from independently entered BOM quantities. */
export function buildControlPanelBomDocument(input: ControlPanelBomBuildInput): ControlPanelBomBuildResult {
  const validation = validateControlPanelBomQuantities(input.quantities);
  if (!validation.ok) throw new Error(`${validation.code}:${validation.message}`);
  const rails = railsFromLayout(input.layout);
  if (rails.length < 4) throw new Error('BOM_LAYOUT_REQUIRES_FOUR_RAILS');
  const door = doorFromLayout(input.layout);
  if (!door) throw new Error('BOM_LAYOUT_REQUIRES_DOOR_PANEL');
  const cabinet = input.layout.cabinet && typeof input.layout.cabinet === 'object'
    ? input.layout.cabinet as Record<string, unknown>
    : null;
  if (!cabinet) throw new Error('BOM_LAYOUT_REQUIRES_CABINET');

  const layoutDucts = input.layout.ducts && typeof input.layout.ducts === 'object'
    ? Object.values(input.layout.ducts as Record<string, unknown>).filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
  const rightDuct = layoutDucts.find((entry) => entry.id === 'duct_right');
  const rightDuctX = rightDuct ? finite(rightDuct.channelX, finite(rightDuct.x) + finite(rightDuct.w) / 2) : null;
  const horizontalDuctYs = layoutDucts
    .filter((entry) => entry.type === 'WIRE_DUCT_H')
    .map((entry) => finite(entry.channelY, finite(entry.y) + finite(entry.h) / 2));

  const catalogByLegacy = new Map(input.catalog.map((item) => [item.legacyType, item]));
  const devices: DeviceInstanceV2[] = [];
  const wires: WireV2[] = [];
  const designations: Record<string, string> = {};
  const deviceSettings: Record<string, Record<string, unknown>> = {};
  const conductorSettings: Record<string, Record<string, unknown>> = {};
  const deviceByKey = new Map<string, DeviceInstanceV2[]>();
  const designationCounters = new Map<string, number>();
  const railCursors = new Map<string, number>();
  const inputs: ControlPanelIoInputAssignment[] = [];
  const outputs: ControlPanelIoOutputAssignment[] = [];
  let wireIndex = 1;
  let doorIndex = 0;
  let fieldIndex = 0;

  const placementRail = (zone: ControlPanelPlacementZone): RailBox => {
    const index = zone === 'power' ? 0 : zone === 'control' ? 1 : zone === 'drive' ? 2 : 3;
    return rails[index];
  };
  const nextDesignation = (prefix: string): string => {
    const next = (designationCounters.get(prefix) ?? 0) + 1;
    designationCounters.set(prefix, next);
    return `${prefix}${next}`;
  };
  const addDevice = (
    key: string,
    profileId: string,
    legacyType: string,
    zone: ControlPanelPlacementZone,
    designationPrefix: string,
    explicitDesignation?: string,
  ): DeviceInstanceV2 => {
    const profile = input.profiles[profileId];
    const catalog = catalogByLegacy.get(legacyType);
    if (!profile) throw new Error(`BOM_PROFILE_MISSING:${profileId}`);
    if (!catalog) throw new Error(`BOM_CATALOG_ITEM_MISSING:${legacyType}`);
    const sequence = (deviceByKey.get(key)?.length ?? 0) + 1;
    const id = `bom-${idPart(key)}-${String(sequence).padStart(2, '0')}`;
    let x: number;
    let y: number;
    if (zone === 'door') {
      // A maintained single column with a 320 px pitch keeps every 220 px pilot
      // device plus routing clearance separate. The BOM panel uses six rails so
      // the default button/indicator set fits without image-crossing shortcuts.
      x = finite(door.x) + (finite(door.w, 420) - catalog.width) / 2;
      y = finite(door.y) + 60 + doorIndex * 320;
      doorIndex += 1;
    } else if (zone === 'field') {
      const column = fieldIndex % 6;
      const row = Math.floor(fieldIndex / 6);
      x = finite(cabinet.x) + 100 + column * 520;
      y = finite(cabinet.y) + finite(cabinet.h) + 140 + row * 320;
      fieldIndex += 1;
    } else {
      const rail = placementRail(zone);
      const cursor = railCursors.get(rail.id) ?? rail.x + 70;
      if (cursor + catalog.width > rail.x + rail.w - 40) throw new Error(`BOM_LAYOUT_OVERFLOW:${zone}`);
      x = cursor;
      y = rail.y + rail.h / 2 - catalog.height / 2;
      railCursors.set(rail.id, cursor + catalog.width + 120);
    }
    const device: DeviceInstanceV2 = {
      id,
      profileId,
      profileVersion: profile.version,
      evidenceLevel: profile.evidence.level,
      legacyType,
      missingProfile: false,
      x, y, rotation: 0,
      configuration: {
        equipmentKey: key,
        placementZone: zone,
        orderCode: profile.model,
        catalogWidth: catalog.width,
        catalogHeight: catalog.height,
      },
    };
    devices.push(device);
    const bucket = deviceByKey.get(key) ?? [];
    bucket.push(device);
    deviceByKey.set(key, bucket);
    const designation = explicitDesignation ?? nextDesignation(designationPrefix);
    designations[id] = designation;
    deviceSettings[id] = { orderCode: profile.model, designation };
    return device;
  };
  const addWire = (
    from: DeviceInstanceV2,
    fromTerminal: string,
    to: DeviceInstanceV2,
    toTerminal: string,
    color: string,
    label: string,
  ): void => {
    assertTerminal(input.profiles, from.profileId, fromTerminal);
    assertTerminal(input.profiles, to.profileId, toTerminal);
    const id = `bom-w${String(wireIndex).padStart(4, '0')}`;
    const tag = `AUTO-${String(wireIndex).padStart(4, '0')}`;
    const fromZone = from.configuration.placementZone;
    const toZone = to.configuration.placementZone;
    let waypoints: Array<{ x: number; y: number }> | undefined;
    if (rightDuctX !== null && horizontalDuctYs.length && (fromZone === 'door' || toZone === 'door') && fromZone !== toZone) {
      const doorDevice = fromZone === 'door' ? from : to;
      const panelDevice = fromZone === 'door' ? to : from;
      const panelWidth = finite(panelDevice.configuration.catalogWidth, 180);
      const panelHeight = finite(panelDevice.configuration.catalogHeight, 180);
      const doorHeight = finite(doorDevice.configuration.catalogHeight, 120);
      const panelAnchorX = panelDevice.x + panelWidth / 2;
      const doorAnchorY = doorDevice.y + doorHeight / 2;
      const ductY = [...horizontalDuctYs].sort((left, right) =>
        Math.abs(left - (panelDevice.y + panelHeight)) - Math.abs(right - (panelDevice.y + panelHeight)))[0];
      waypoints = fromZone === 'door'
        ? [{ x: rightDuctX, y: doorAnchorY }, { x: rightDuctX, y: ductY }, { x: panelAnchorX, y: ductY }]
        : [{ x: panelAnchorX, y: ductY }, { x: rightDuctX, y: ductY }, { x: rightDuctX, y: doorAnchorY }];
    }
    wires.push({
      id,
      from: { deviceId: from.id, terminalId: fromTerminal },
      to: { deviceId: to.id, terminalId: toTerminal },
      color,
      tag,
      ...(waypoints ? { waypoints } : {}),
    });
    conductorSettings[id] = {
      cableId: null, core: null, wireNumber: tag, gauge: null, color, lengthMm: null,
      ferruleFrom: null, ferruleTo: null, lugFrom: null, lugTo: null, shielded: false, drain: false, label,
    };
    wireIndex += 1;
  };

  const acSource = addDevice('acSource', 'boundary:ac-supply', 'BOUNDARY-AC', 'power', 'SRC', 'AC-SOURCE');
  for (const item of CONTROL_PANEL_BOM_ITEMS) {
    for (let index = 0; index < (input.quantities[item.key] ?? 0); index += 1) {
      addDevice(item.key, item.profileId, item.legacyType, item.placementZone, item.designationPrefix);
    }
  }

  const powerSupplies = deviceByKey.get('powerSupply') ?? [];
  const plcs = deviceByKey.get('plc') ?? [];
  const mccb2p = deviceByKey.get('mccb2p') ?? [];
  const mccb3p = deviceByKey.get('mccb3p') ?? [];
  const contactors = deviceByKey.get('contactor') ?? [];
  const inverters = deviceByKey.get('inverter') ?? [];
  const motors = deviceByKey.get('motor') ?? [];

  const peBusDevices: DeviceInstanceV2[] = [];
  let peBusUse = 8;
  const allocatePeTerminal = (): { device: DeviceInstanceV2; terminal: string } => {
    if (peBusUse >= 8) {
      const previous = peBusDevices.at(-1);
      const current = addDevice('busPe', 'educational:distribution-pe-10', 'TB-PE-10', 'distribution', 'XPE');
      peBusDevices.push(current);
      if (previous) addWire(previous, '10', current, '1', '#16a34a', 'PE bus continuation');
      else addWire(acSource, 'PE', current, '1', '#16a34a', 'source PE to distribution');
      peBusUse = 0;
    }
    const device = peBusDevices.at(-1)!;
    const terminal = String(2 + peBusUse);
    peBusUse += 1;
    return { device, terminal };
  };
  const connectPe = (device: DeviceInstanceV2, terminal: string): void => {
    const pe = allocatePeTerminal();
    addWire(pe.device, pe.terminal, device, terminal, '#16a34a', 'protective earth');
  };

  [...powerSupplies, ...plcs].forEach((device, index) => {
    const breaker = mccb2p[index];
    addWire(acSource, 'L1', breaker, 'L', '#8b4513', 'AC line to branch breaker');
    addWire(acSource, 'N', breaker, 'N', '#2563eb', 'AC neutral to branch breaker');
    addWire(breaker, "L'", device, 'L', '#8b4513', 'protected AC line');
    addWire(breaker, "N'", device, 'N', '#2563eb', 'protected AC neutral');
    connectPe(device, 'PE');
  });

  const busGroups = powerSupplies.map((supply, supplyIndex) => ({
    supply,
    supplyIndex,
    positive: [] as DeviceInstanceV2[],
    positiveUse: 8,
    return: [] as DeviceInstanceV2[],
    returnUse: 8,
  }));
  const allocateDcTerminal = (supplyIndex: number, kind: 'positive' | 'return'): { device: DeviceInstanceV2; terminal: string } => {
    const group = busGroups[supplyIndex];
    if (!group) throw new Error('BOM_DC_SUPPLY_ASSIGNMENT_MISSING');
    const buses = group[kind];
    const useKey = kind === 'positive' ? 'positiveUse' : 'returnUse';
    if (group[useKey] >= 8) {
      const previous = buses.at(-1);
      const profileId = kind === 'positive' ? 'educational:distribution-24v-10' : 'educational:distribution-0v-10';
      const legacyType = kind === 'positive' ? 'TB-24V-10' : 'TB-0V-10';
      const current = addDevice(`bus${kind === 'positive' ? '24' : '0'}-${supplyIndex + 1}`, profileId, legacyType, 'distribution', kind === 'positive' ? 'X24' : 'X0');
      buses.push(current);
      if (previous) addWire(previous, '10', current, '1', kind === 'positive' ? '#ef4444' : '#2563eb', `${kind} bus continuation`);
      else addWire(group.supply, kind === 'positive' ? 'V+1' : 'V-1', current, '1', kind === 'positive' ? '#ef4444' : '#2563eb', `${kind} distribution source`);
      group[useKey] = 0;
    }
    const device = buses.at(-1)!;
    const terminal = String(2 + group[useKey]);
    group[useKey] += 1;
    return { device, terminal };
  };
  const connectDcBus = (supplyIndex: number, kind: 'positive' | 'return', device: DeviceInstanceV2, terminal: string, direction: 'to-device' | 'from-device' = 'to-device'): void => {
    const bus = allocateDcTerminal(supplyIndex, kind);
    const color = kind === 'positive' ? '#ef4444' : '#2563eb';
    if (direction === 'from-device') addWire(device, terminal, bus.device, bus.terminal, color, `${kind} return`);
    else addWire(bus.device, bus.terminal, device, terminal, color, `${kind} supply`);
  };

  const inputDevices = [
    ...(deviceByKey.get('startButton') ?? []).map((device) => ({ device, kind: 'dry-contact' as const, sourceTerminal: '1', signalTerminal: '2' })),
    ...(deviceByKey.get('stopButton') ?? []).map((device) => ({ device, kind: 'dry-contact' as const, sourceTerminal: '1', signalTerminal: '2' })),
    ...(deviceByKey.get('emergencyStop') ?? []).map((device) => ({ device, kind: 'dry-contact' as const, sourceTerminal: '11', signalTerminal: '12' })),
    ...(deviceByKey.get('npnSensor') ?? []).map((device) => ({ device, kind: 'npn-sensor' as const, sourceTerminal: 'BU', signalTerminal: 'BK' })),
  ];
  plcs.slice(0, Math.ceil(inputDevices.length / 16)).forEach((plc, plcIndex) => {
    const supplyIndex = plcIndex % powerSupplies.length;
    connectDcBus(supplyIndex, 'positive', plc, 'COMI-A');
  });
  inputDevices.forEach((entry, inputIndex) => {
    const plcIndex = Math.floor(inputIndex / 16);
    const plc = plcs[plcIndex];
    const plcTerminal = PLC_INPUT_TERMINALS[inputIndex % 16];
    const supplyIndex = plcIndex % powerSupplies.length;
    if (entry.kind === 'npn-sensor') {
      connectDcBus(supplyIndex, 'positive', entry.device, 'BN');
      connectDcBus(supplyIndex, 'return', entry.device, 'BU');
    } else {
      connectDcBus(supplyIndex, 'return', entry.device, entry.sourceTerminal);
    }
    addWire(plc, plcTerminal, entry.device, entry.signalTerminal, '#f59e0b', `PLC input ${plcTerminal}`);
    inputs.push({ deviceId: entry.device.id, plcId: plc.id, plcTerminal, kind: entry.kind });
  });

  const outputAt = (absolutePoint: number): { plc: DeviceInstanceV2; plcIndex: number; terminal: string } => {
    const plcIndex = Math.floor(absolutePoint / 16);
    return { plc: plcs[plcIndex], plcIndex, terminal: PLC_OUTPUT_TERMINALS[absolutePoint % 16] };
  };
  const usedOutputPlcs = Math.ceil(validation.outputPointCount / 16);
  plcs.slice(0, usedOutputPlcs).forEach((plc, plcIndex) => {
    const supplyIndex = plcIndex % powerSupplies.length;
    connectDcBus(supplyIndex, 'positive', plc, 'VOUT');
    connectDcBus(supplyIndex, 'return', plc, 'COMO');
  });
  let absoluteOutputPoint = 0;
  inverters.forEach((inverter) => {
    const forward = outputAt(absoluteOutputPoint);
    const reverse = outputAt(absoluteOutputPoint + 1);
    if (forward.plc.id !== reverse.plc.id) throw new Error('BOM_INVERTER_OUTPUT_PAIR_SPLIT');
    const supplyIndex = forward.plcIndex % powerSupplies.length;
    connectDcBus(supplyIndex, 'return', inverter, 'CM');
    addWire(forward.plc, forward.terminal, inverter, 'P1', '#f59e0b', 'NPN transistor forward command');
    addWire(reverse.plc, reverse.terminal, inverter, 'P2', '#f59e0b', 'NPN transistor reverse command');
    outputs.push({ deviceId: inverter.id, plcId: forward.plc.id, kind: 'inverter', plcCommon: 'COMO', plcTerminals: [forward.terminal, reverse.terminal] });
    absoluteOutputPoint += 2;
  });
  const generalOutputs = [
    ...(deviceByKey.get('relay') ?? []).map((device) => ({ device, kind: 'relay' as const, positive: '14', return: '13' })),
    ...contactors.map((device) => ({ device, kind: 'contactor' as const, positive: 'A1', return: 'A2' })),
    ...(deviceByKey.get('greenLamp') ?? []).map((device) => ({ device, kind: 'load' as const, positive: '+', return: '-' })),
    ...(deviceByKey.get('yellowLamp') ?? []).map((device) => ({ device, kind: 'load' as const, positive: '+', return: '-' })),
    ...(deviceByKey.get('whiteLamp') ?? []).map((device) => ({ device, kind: 'load' as const, positive: '+', return: '-' })),
    ...(deviceByKey.get('buzzer') ?? []).map((device) => ({ device, kind: 'load' as const, positive: '+', return: '-' })),
  ];
  for (const entry of generalOutputs) {
    const output = outputAt(absoluteOutputPoint);
    const supplyIndex = output.plcIndex % powerSupplies.length;
    connectDcBus(supplyIndex, 'positive', entry.device, entry.positive);
    addWire(entry.device, entry.return, output.plc, output.terminal, '#f59e0b', `NPN sink output ${output.terminal}`);
    outputs.push({ deviceId: entry.device.id, plcId: output.plc.id, kind: entry.kind, plcCommon: 'COMO', plcTerminals: [output.terminal] });
    absoluteOutputPoint += 1;
  }

  contactors.forEach((contactor, branchIndex) => {
    const breaker = mccb3p[branchIndex];
    const motor = motors[branchIndex];
    (['1', '2', '3'] as const).forEach((phase, phaseIndex) => {
      const sourceTerminal = `L${phase}`;
      const breakerOutput = `T${phase}`;
      const contactorInput = ['1L1', '3L2', '5L3'][phaseIndex];
      const contactorOutput = ['2T1', '4T2', '6T3'][phaseIndex];
      const motorInput = ['U', 'V', 'W'][phaseIndex];
      addWire(acSource, sourceTerminal, breaker, sourceTerminal, '#8b4513', `3-phase ${sourceTerminal}`);
      addWire(breaker, breakerOutput, contactor, contactorInput, '#8b4513', `protected ${sourceTerminal}`);
      addWire(contactor, contactorOutput, motor, motorInput, '#8b4513', `contactor motor ${motorInput}`);
    });
    connectPe(motor, 'PE');
  });
  inverters.forEach((inverter, inverterIndex) => {
    const branchIndex = contactors.length + inverterIndex;
    const breaker = mccb3p[branchIndex];
    const motor = motors[branchIndex];
    (['1', '2', '3'] as const).forEach((phase, phaseIndex) => {
      const sourceTerminal = `L${phase}`;
      const breakerOutput = `T${phase}`;
      const inverterInput = ['R', 'S', 'T'][phaseIndex];
      const inverterOutput = ['U', 'V', 'W'][phaseIndex];
      const motorInput = ['U', 'V', 'W'][phaseIndex];
      addWire(acSource, sourceTerminal, breaker, sourceTerminal, '#8b4513', `3-phase ${sourceTerminal}`);
      addWire(breaker, breakerOutput, inverter, inverterInput, '#8b4513', `protected inverter ${inverterInput}`);
      addWire(inverter, inverterOutput, motor, motorInput, '#8b4513', `inverter motor ${motorInput}`);
    });
    connectPe(inverter, 'GMAIN');
    connectPe(inverter, 'GMOT');
    connectPe(motor, 'PE');
  });

  const scopeDevices = devices.filter((device) => !input.profiles[device.profileId]?.boundary).map((device) => device.id);
  const hasThreePhase = mccb3p.length > 0;
  const document: WorkshopDocumentV2 = {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: `BOM 자동 제어반 · 장비 ${validation.totalOrderedDevices}대`,
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires,
    jumpers: [],
    layout: { ...input.layout },
    settings: {
      v3Workflow: {
        sourceSystem: hasThreePhase
          ? { id: 'ac-3ph-380-220v', label: 'AC 3Φ 380/220 V / L1-L2-L3-N-PE' }
          : { id: 'ac-1ph-220v', label: 'AC 1Φ 220 V / L-N-PE' },
        earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
        canvasUnitsPerMm: 2,
        sourceProtection: { phaseSequence: hasThreePhase ? 'L1-L2-L3' : null, prospectiveShortCircuitCurrentA: null, protectiveDeviceCurve: null },
        reviewScope: { templateId: 'control-panel-prewire', deviceIds: scopeDevices },
        designations,
        deviceSettings,
        conductorSettings,
        plcRuntime: null,
      },
    },
    extensions: {
      legacy: {
        controlPanelBom: {
          quantities: Object.fromEntries(CONTROL_PANEL_BOM_ITEMS.map((item) => [item.key, input.quantities[item.key] ?? 0])),
          inputAssignments: inputs,
          outputAssignments: outputs,
          automaticDistributionDevices: devices.filter((device) => device.id.includes('bus')).map((device) => device.id),
        },
      },
    },
  };
  return { document, totalDevices: devices.length, totalWires: wires.length, ioAssignments: { inputs, outputs } };
}
