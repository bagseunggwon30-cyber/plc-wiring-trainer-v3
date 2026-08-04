import { PlcRuntimeConfigurationV1Schema, type PlcRuntimeConfigurationV1 } from '../../domain/plc-runtime/io-binding';

export type V3ReportClassification = 'LEGACY_DIAGNOSTIC' | 'DIAGNOSTIC' | 'VERIFIED_PREWIRE';

export type Earthing0vPePolicy =
  | 'PE_SEPARATE_0V_FLOATING'
  | 'PE_0V_SINGLE_POINT_BOND'
  | 'SITE_DEFINED_BONDING';

export interface SourceSystemSelection {
  id: string;
  label: string;
}

export interface ReviewScope {
  templateId: string | null;
  deviceIds: string[];
}

export type PhaseSequenceV3Workflow = 'L1-L2-L3' | 'L1-L3-L2';
export interface SourceProtectionWorkflowSetting {
  phaseSequence: PhaseSequenceV3Workflow | null;
  prospectiveShortCircuitCurrentA: number | null;
  protectiveDeviceCurve: string | null;
}

export type XbfChannelIdV3 = 'AI0' | 'AI1' | 'AO0' | 'AO1';
export type XbfRangeV3 = '1-5V' | '0-5V' | '0-10V' | '4-20mA' | '0-20mA';
export type Ig5aInputLogicV3 = 'NPN_INTERNAL_24V' | 'PNP_EXTERNAL_24V';
export type Ig5aControlPowerStateV3 = 'POWERED' | 'UNPOWERED';
export type Rs485ProtocolV3 = 'XGB_CNET' | 'MODBUS_RTU_MASTER' | 'MODBUS_RTU_SLAVE';
export interface Rs485WorkflowSetting {
  port: string | null;
  protocol: Rs485ProtocolV3 | null;
  baudRate: number | null;
  dataBits: 7 | 8 | null;
  parity: 'NONE' | 'EVEN' | 'ODD' | null;
  stopBits: 1 | 2 | null;
  stationId: number | null;
}
export interface XbfChannelWorkflowSetting {
  enabled: boolean;
  selector: 'V' | 'I' | null;
  parameterRange: XbfRangeV3 | null;
}
export interface DeviceWorkflowSetting {
  orderCode: string | null;
  xbfChannels?: Record<XbfChannelIdV3, XbfChannelWorkflowSetting>;
  ig5aInputLogic?: Ig5aInputLogicV3;
  ig5aControlPowerState?: Ig5aControlPowerStateV3;
  sensorDetected?: boolean;
  currentMilliamp?: number;
  rs485?: Rs485WorkflowSetting;
}
export interface ConductorWorkflowSetting {
  cableId: string | null;
  core: string | null;
  wireNumber: string | null;
  gauge: string | null;
  color: string | null;
  lengthMm: number | null;
  ferruleFrom: string | null;
  ferruleTo: string | null;
  lugFrom: string | null;
  lugTo: string | null;
  shielded: boolean;
  drain: boolean;
}

export interface V3WorkflowState {
  sourceSystem: SourceSystemSelection | null;
  earthingPolicy: Earthing0vPePolicy | null;
  /** Explicit conversion for the legacy SVG canvas. Null means physical placement is not reviewable. */
  canvasUnitsPerMm: number | null;
  sourceProtection: SourceProtectionWorkflowSetting;
  reviewScope: ReviewScope;
  designations: Record<string, string>;
  deviceSettings: Record<string, DeviceWorkflowSetting>;
  conductorSettings: Record<string, ConductorWorkflowSetting>;
  plcRuntime: PlcRuntimeConfigurationV1 | null;
}

export interface V3WorkflowIssue {
  code: 'SOURCE_SYSTEM_REQUIRED' | 'EARTHING_POLICY_REQUIRED' | 'REVIEW_SCOPE_REQUIRED' | 'REVIEW_TEMPLATE_REQUIRED';
  message: string;
}

export const V3_WORKFLOW_SETTINGS_KEY = 'v3Workflow';

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function uniqueSortedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => text(item) ?? []))].sort();
}

function earthingPolicy(value: unknown): Earthing0vPePolicy | null {
  return value === 'PE_SEPARATE_0V_FLOATING' || value === 'PE_0V_SINGLE_POINT_BOND' || value === 'SITE_DEFINED_BONDING'
    ? value
    : null;
}

function designations(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .flatMap(([deviceId, designation]) => {
      const safeDeviceId = text(deviceId);
      const safeDesignation = text(designation);
      return safeDeviceId && safeDesignation ? [[safeDeviceId, safeDesignation] as const] : [];
    })
    .sort(([left], [right]) => left.localeCompare(right)));
}

const XBF_CHANNEL_IDS: readonly XbfChannelIdV3[] = ['AI0', 'AI1', 'AO0', 'AO1'];
const XBF_RANGES: readonly XbfRangeV3[] = ['1-5V', '0-5V', '0-10V', '4-20mA', '0-20mA'];

function xbfChannels(value: unknown): Record<XbfChannelIdV3, XbfChannelWorkflowSetting> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(XBF_CHANNEL_IDS.map((channelId) => {
    const setting = raw[channelId] && typeof raw[channelId] === 'object' && !Array.isArray(raw[channelId])
      ? raw[channelId] as Record<string, unknown>
      : {};
    const selector = setting.selector === 'V' || setting.selector === 'I' ? setting.selector : null;
    const parameterRange = XBF_RANGES.includes(setting.parameterRange as XbfRangeV3)
      ? setting.parameterRange as XbfRangeV3
      : null;
    return [channelId, { enabled: setting.enabled === true, selector, parameterRange }];
  })) as Record<XbfChannelIdV3, XbfChannelWorkflowSetting>;
}

function deviceSettings(value: unknown): Record<string, DeviceWorkflowSetting> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([deviceId, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    const orderCode = text(raw.orderCode);
    const channels = xbfChannels(raw.xbfChannels);
    const ig5aInputLogic: Ig5aInputLogicV3 | undefined = raw.ig5aInputLogic === 'NPN_INTERNAL_24V'
      || raw.ig5aInputLogic === 'PNP_EXTERNAL_24V'
      ? raw.ig5aInputLogic as Ig5aInputLogicV3
      : undefined;
    const ig5aControlPowerState: Ig5aControlPowerStateV3 | undefined = raw.ig5aControlPowerState === 'POWERED'
      || raw.ig5aControlPowerState === 'UNPOWERED'
      ? raw.ig5aControlPowerState as Ig5aControlPowerStateV3
      : undefined;
    const sensorDetected = typeof raw.sensorDetected === 'boolean' ? raw.sensorDetected : undefined;
    const currentMilliamp = positiveNumber(raw.currentMilliamp) ?? undefined;
    const rawRs485 = raw.rs485 && typeof raw.rs485 === 'object' && !Array.isArray(raw.rs485)
      ? raw.rs485 as Record<string, unknown>
      : null;
    const rs485: Rs485WorkflowSetting | undefined = rawRs485 ? {
      port: text(rawRs485.port),
      protocol: rawRs485.protocol === 'XGB_CNET'
        || rawRs485.protocol === 'MODBUS_RTU_MASTER'
        || rawRs485.protocol === 'MODBUS_RTU_SLAVE'
        ? rawRs485.protocol
        : null,
      baudRate: positiveNumber(rawRs485.baudRate),
      dataBits: rawRs485.dataBits === 7 || rawRs485.dataBits === 8 ? rawRs485.dataBits : null,
      parity: rawRs485.parity === 'NONE' || rawRs485.parity === 'EVEN' || rawRs485.parity === 'ODD'
        ? rawRs485.parity
        : null,
      stopBits: rawRs485.stopBits === 1 || rawRs485.stopBits === 2 ? rawRs485.stopBits : null,
      stationId: positiveNumber(rawRs485.stationId),
    } : undefined;
    if (
      !orderCode
      && !channels
      && ig5aInputLogic === undefined
      && ig5aControlPowerState === undefined
      && sensorDetected === undefined
      && currentMilliamp === undefined
      && rs485 === undefined
    ) return [];
    return [[deviceId, {
      orderCode,
      ...(channels ? { xbfChannels: channels } : {}),
      ...(ig5aInputLogic === undefined ? {} : { ig5aInputLogic }),
      ...(ig5aControlPowerState === undefined ? {} : { ig5aControlPowerState }),
      ...(sensorDetected === undefined ? {} : { sensorDetected }),
      ...(currentMilliamp === undefined ? {} : { currentMilliamp }),
      ...(rs485 === undefined ? {} : { rs485 }),
    }] as const];
  }).sort(([left], [right]) => left.localeCompare(right)));
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sourceProtection(value: unknown): SourceProtectionWorkflowSetting {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    phaseSequence: raw.phaseSequence === 'L1-L2-L3' || raw.phaseSequence === 'L1-L3-L2' ? raw.phaseSequence : null,
    prospectiveShortCircuitCurrentA: positiveNumber(raw.prospectiveShortCircuitCurrentA),
    protectiveDeviceCurve: text(raw.protectiveDeviceCurve),
  };
}

function conductorSettings(value: unknown): Record<string, ConductorWorkflowSetting> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([wireId, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    const setting = {
      cableId: text(raw.cableId),
      core: text(raw.core),
      wireNumber: text(raw.wireNumber),
      gauge: text(raw.gauge),
      color: text(raw.color),
      lengthMm: positiveNumber(raw.lengthMm),
      ferruleFrom: text(raw.ferruleFrom),
      ferruleTo: text(raw.ferruleTo),
      lugFrom: text(raw.lugFrom),
      lugTo: text(raw.lugTo),
      shielded: raw.shielded === true,
      drain: raw.drain === true,
    };
    return Object.values(setting).some((entryValue) => entryValue !== null) ? [[wireId, setting] as const] : [];
  }).sort(([left], [right]) => left.localeCompare(right)));
}

export function createV3WorkflowState(value: unknown): V3WorkflowState {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawSource = raw.sourceSystem && typeof raw.sourceSystem === 'object' && !Array.isArray(raw.sourceSystem)
    ? raw.sourceSystem as Record<string, unknown>
    : {};
  const sourceId = text(rawSource.id);
  const sourceLabel = text(rawSource.label);
  const rawScope = raw.reviewScope && typeof raw.reviewScope === 'object' && !Array.isArray(raw.reviewScope)
    ? raw.reviewScope as Record<string, unknown>
    : {};

  return {
    sourceSystem: sourceId && sourceLabel ? { id: sourceId, label: sourceLabel } : null,
    earthingPolicy: earthingPolicy(raw.earthingPolicy),
    canvasUnitsPerMm: positiveNumber(raw.canvasUnitsPerMm),
    sourceProtection: sourceProtection(raw.sourceProtection),
    reviewScope: {
      templateId: text(rawScope.templateId),
      deviceIds: uniqueSortedStrings(rawScope.deviceIds),
    },
    designations: designations(raw.designations),
    deviceSettings: deviceSettings(raw.deviceSettings),
    conductorSettings: conductorSettings(raw.conductorSettings),
    plcRuntime: (() => {
      const parsed = PlcRuntimeConfigurationV1Schema.safeParse(raw.plcRuntime);
      return parsed.success ? parsed.data : null;
    })(),
  };
}

export function validateV3WorkflowState(state: V3WorkflowState): V3WorkflowIssue[] {
  const issues: V3WorkflowIssue[] = [];
  if (!state.sourceSystem) {
    issues.push({ code: 'SOURCE_SYSTEM_REQUIRED', message: '공급 SourceSystem을 명시적으로 선택하세요.' });
  }
  if (!state.earthingPolicy) {
    issues.push({ code: 'EARTHING_POLICY_REQUIRED', message: 'PE와 0V의 접지/본딩 정책을 명시적으로 선택하세요.' });
  }
  if (!state.reviewScope.templateId) {
    issues.push({ code: 'REVIEW_TEMPLATE_REQUIRED', message: '검토 템플릿을 선택하세요.' });
  }
  if (!state.reviewScope.deviceIds.length) {
    issues.push({ code: 'REVIEW_SCOPE_REQUIRED', message: '검토 범위에 장비를 한 대 이상 선택하세요.' });
  }
  return issues;
}

/** Stores renderer-only v3 metadata without mutating legacy SVG editor state. */
export function applyV3WorkflowState<T extends { settings: Record<string, unknown> }>(
  document: T,
  state: V3WorkflowState,
): T {
  const normalized = createV3WorkflowState(state);
  return {
    ...document,
    settings: {
      ...document.settings,
      [V3_WORKFLOW_SETTINGS_KEY]: normalized,
    },
  };
}

export function workflowStateFromDocument(document: { settings?: Record<string, unknown> }): V3WorkflowState {
  return createV3WorkflowState(document.settings?.[V3_WORKFLOW_SETTINGS_KEY]);
}

export function reportClassLabel(classification: V3ReportClassification): string {
  return classification;
}
