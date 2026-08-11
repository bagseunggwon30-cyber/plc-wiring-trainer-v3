import type { DeviceProfile, InternalLinkSpec, TerminalSpec } from '../domain/types';
import { DEVICE_PROFILES } from './profiles';
import type { DeviceBehaviorProfile } from '../domain/device-runtime/contracts';
import { MY2N_D2_DC24_BEHAVIOR } from './device-behavior-profiles';

export type EvidenceGradeV3 = 'educational' | 'manual-verified' | 'bench-verified';
export type XbfChannelId = 'AI0' | 'AI1' | 'AO0' | 'AO1';
export type XbfSelectorPosition = 'V' | 'I';
export type XbfParameterRange = '1-5V' | '0-5V' | '0-10V' | '4-20mA' | '0-20mA';

export interface EvidenceDocumentV3 {
  readonly documentId: string;
  readonly revision: string;
  readonly pages: readonly number[];
  readonly sha256: string;
  readonly notes: string;
}

export interface EvidenceV3 {
  readonly grade: EvidenceGradeV3;
  readonly documents: readonly EvidenceDocumentV3[];
  readonly reviewer?: string;
  readonly reviewedAt?: string;
  readonly note?: string;
}

export interface DeviceTerminalV3 {
  readonly id: string;
  readonly label: string;
  readonly marker?: string;
  readonly connectionPoint?: TerminalSpec['connectionPoint'];
  readonly domain: TerminalSpec['domain'];
  readonly potential: TerminalSpec['potential'];
  readonly role: TerminalSpec['role'];
  readonly polarity: TerminalSpec['polarity'];
  readonly commonType?: TerminalSpec['commonType'];
  readonly phase?: TerminalSpec['phase'];
  readonly comGroup?: string;
  readonly channel?: string;
  readonly protocol?: TerminalSpec['protocol'];
  readonly outputMode?: TerminalSpec['outputMode'];
  readonly inputLogicMode?: TerminalSpec['inputLogicMode'];
  readonly inputActivationPotential?: TerminalSpec['inputActivationPotential'];
  readonly ratedVoltage?: Readonly<TerminalSpec['ratedVoltage']>;
  readonly maxConductors?: number;
  readonly conductorRangeMm2?: Readonly<NonNullable<TerminalSpec['conductorRangeMm2']>>;
  readonly tighteningTorqueNm?: Readonly<NonNullable<TerminalSpec['tighteningTorqueNm']>>;
  readonly strippingLengthMm?: number;
}

export interface XbfAh04aChannelDefinition {
  readonly id: XbfChannelId;
  readonly direction: 'AI' | 'AO';
  readonly terminalIds: readonly [positive: string, negative: string];
  readonly selectorIsPhysical: true;
  readonly supportedRanges: readonly XbfParameterRange[];
}

export interface XbfAh04aContract {
  readonly kind: 'xbf-ah04a';
  readonly inputChannels: readonly [XbfAh04aChannelDefinition, XbfAh04aChannelDefinition];
  readonly outputChannels: readonly [XbfAh04aChannelDefinition, XbfAh04aChannelDefinition];
  readonly requiresExternal24V: true;
  readonly supplyTerminalIds: readonly ['+24V', '0V'];
}

export type ReviewCapabilityV3 = 'full' | 'profile-only';
export type RackModuleClassV3 = 'io' | 'communication' | 'high-speed' | 'special';

export interface RackContractV3 {
  readonly family: 'LS-XGB';
  readonly role: 'host' | 'module';
  readonly occupiedPoints: 64;
  readonly maxExpansionSlots?: number;
  readonly moduleClass?: RackModuleClassV3;
  readonly inputTerminalIds?: readonly string[];
  readonly outputTerminalIds?: readonly string[];
}

export interface DeviceProfileV3 {
  readonly catalogVersion: 3;
  readonly profileId: string;
  readonly legacyProfileId: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly orderCode: string;
  readonly evidence: EvidenceV3;
  readonly reviewCapability: ReviewCapabilityV3;
  readonly rack?: RackContractV3;
  readonly terminals: readonly DeviceTerminalV3[];
  readonly internalLinks: readonly Readonly<InternalLinkSpec>[];
  readonly behavior?: Readonly<Record<string, unknown>>;
  readonly behaviorProfile?: DeviceBehaviorProfile;
  readonly analogIo?: XbfAh04aContract;
}

export interface XbfChannelConfiguration {
  readonly enabled: boolean;
  readonly selector?: XbfSelectorPosition;
  readonly parameterRange?: XbfParameterRange;
}

export type XbfAh04aConfiguration = Readonly<Record<XbfChannelId, XbfChannelConfiguration>>;

export type ExactOrderCodeValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'order-code-required' | 'order-code-mismatch' };

export type PrewireEligibilityValidation =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason:
      | 'order-code-required'
      | 'order-code-mismatch'
      | 'evidence-grade-ineligible'
      | 'review-capability-incomplete';
  };

export type XbfConfigurationValidation =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason: 'incomplete-channel-configuration' | 'selector-range-mismatch' | 'unsupported-range';
    readonly channelId: XbfChannelId;
  };

interface DeviceProfileV3AdapterOptions {
  readonly orderCode: string;
  readonly evidenceGrade: EvidenceGradeV3;
  readonly reviewCapability?: ReviewCapabilityV3;
  readonly rack?: RackContractV3;
  readonly analogIo?: XbfAh04aContract;
  readonly behaviorProfile?: DeviceBehaviorProfile;
}

function toV3Terminal(terminal: TerminalSpec): DeviceTerminalV3 {
  return {
    id: terminal.id,
    label: terminal.label,
    ...(terminal.marker === undefined ? {} : { marker: terminal.marker }),
    ...(terminal.connectionPoint === undefined ? {} : { connectionPoint: terminal.connectionPoint }),
    domain: terminal.domain,
    potential: terminal.potential,
    role: terminal.role,
    polarity: terminal.polarity,
    ...(terminal.commonType === undefined ? {} : { commonType: terminal.commonType }),
    ...(terminal.phase === undefined ? {} : { phase: terminal.phase }),
    ...(terminal.comGroup === undefined ? {} : { comGroup: terminal.comGroup }),
    ...(terminal.channel === undefined ? {} : { channel: terminal.channel }),
    ...(terminal.protocol === undefined ? {} : { protocol: terminal.protocol }),
    ...(terminal.outputMode === undefined ? {} : { outputMode: terminal.outputMode }),
    ...(terminal.inputLogicMode === undefined ? {} : { inputLogicMode: terminal.inputLogicMode }),
    ...(terminal.inputActivationPotential === undefined
      ? {}
      : { inputActivationPotential: terminal.inputActivationPotential }),
    ...(terminal.ratedVoltage === undefined ? {} : { ratedVoltage: { ...terminal.ratedVoltage } }),
    ...(terminal.maxConductors === undefined ? {} : { maxConductors: terminal.maxConductors }),
    ...(terminal.conductorRangeMm2 === undefined ? {} : { conductorRangeMm2: { ...terminal.conductorRangeMm2 } }),
    ...(terminal.tighteningTorqueNm === undefined ? {} : { tighteningTorqueNm: { ...terminal.tighteningTorqueNm } }),
    ...(terminal.strippingLengthMm === undefined ? {} : { strippingLengthMm: terminal.strippingLengthMm }),
  };
}

function toV3Evidence(profile: DeviceProfile, grade: EvidenceGradeV3): EvidenceV3 {
  return {
    grade,
    documents: profile.evidence.documents.map((document) => ({
      documentId: document.documentId,
      revision: document.revision,
      pages: [...document.pages],
      sha256: document.sha256,
      notes: document.notes,
    })),
    ...(profile.evidence.reviewer === undefined ? {} : { reviewer: profile.evidence.reviewer }),
    ...(profile.evidence.reviewedAt === undefined ? {} : { reviewedAt: profile.evidence.reviewedAt }),
    ...(profile.evidence.note === undefined ? {} : { note: profile.evidence.note }),
  };
}

/** Adapts the legacy catalog without treating a model-family label as an order code. */
export function adaptDeviceProfileToV3(profile: DeviceProfile, options: DeviceProfileV3AdapterOptions): DeviceProfileV3 {
  return {
    catalogVersion: 3,
    profileId: profile.profileId,
    legacyProfileId: profile.profileId,
    manufacturer: profile.manufacturer,
    model: profile.model,
    orderCode: options.orderCode,
    evidence: toV3Evidence(profile, options.evidenceGrade),
    reviewCapability: options.reviewCapability ?? 'full',
    ...(options.rack === undefined ? {} : { rack: options.rack }),
    terminals: profile.terminals.map(toV3Terminal),
    internalLinks: profile.internalLinks.map((link) => ({ ...link })),
    ...(profile.behavior === undefined ? {} : { behavior: structuredClone(profile.behavior) }),
    ...(options.behaviorProfile === undefined ? {} : { behaviorProfile: structuredClone(options.behaviorProfile) }),
    ...(options.analogIo === undefined ? {} : { analogIo: options.analogIo }),
  };
}

const voltageRanges: readonly XbfParameterRange[] = ['1-5V', '0-5V', '0-10V'];
const currentRanges: readonly XbfParameterRange[] = ['4-20mA', '0-20mA'];

function xbfChannel(
  id: XbfChannelId,
  direction: 'AI' | 'AO',
  terminalIds: readonly [positive: string, negative: string],
): XbfAh04aChannelDefinition {
  return {
    id,
    direction,
    terminalIds,
    selectorIsPhysical: true,
    supportedRanges: [...voltageRanges, ...currentRanges],
  };
}

export const XBF_AH04A_CONTRACT: XbfAh04aContract = {
  kind: 'xbf-ah04a',
  inputChannels: [
    xbfChannel('AI0', 'AI', ['I0+', 'I0-']),
    xbfChannel('AI1', 'AI', ['I1+', 'I1-']),
  ],
  outputChannels: [
    xbfChannel('AO0', 'AO', ['O0+', 'O0-']),
    xbfChannel('AO1', 'AO', ['O1+', 'O1-']),
  ],
  requiresExternal24V: true,
  supplyTerminalIds: ['+24V', '0V'],
};

const V3_PROFILE_LIST: readonly DeviceProfileV3[] = [
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:xbc-dn32up'], {
    orderCode: 'XBC-DN32UP',
    evidenceGrade: 'manual-verified',
    reviewCapability: 'profile-only',
    rack: {
      family: 'LS-XGB', role: 'host', occupiedPoints: 64, maxExpansionSlots: 10,
      inputTerminalIds: Array.from({ length: 16 }, (_, index) => `P0${index.toString(16).toUpperCase()}`),
      outputTerminalIds: Array.from({ length: 16 }, (_, index) => `P2${index.toString(16).toUpperCase()}`),
    },
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:xbc-dn60su'], {
    orderCode: 'XBC-DN60SU',
    evidenceGrade: 'manual-verified',
    reviewCapability: 'profile-only',
    rack: {
      family: 'LS-XGB', role: 'host', occupiedPoints: 64, maxExpansionSlots: 7,
      inputTerminalIds: Array.from({ length: 36 }, (_, index) => `P${index.toString(16).padStart(2, '0').toUpperCase()}`),
      outputTerminalIds: Array.from({ length: 24 }, (_, index) => `P${(0x40 + index).toString(16).toUpperCase()}`),
    },
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:xbc-dp32up'], {
    orderCode: 'XBC-DP32UP',
    evidenceGrade: 'manual-verified',
    reviewCapability: 'profile-only',
    rack: {
      family: 'LS-XGB', role: 'host', occupiedPoints: 64, maxExpansionSlots: 10,
      inputTerminalIds: Array.from({ length: 16 }, (_, index) => `P0${index.toString(16).toUpperCase()}`),
      outputTerminalIds: Array.from({ length: 16 }, (_, index) => `P2${index.toString(16).toUpperCase()}`),
    },
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:xbc-dr32h'], {
    orderCode: 'XBC-DR32H',
    evidenceGrade: 'manual-verified',
    rack: {
      family: 'LS-XGB', role: 'host', occupiedPoints: 64, maxExpansionSlots: 10,
      inputTerminalIds: Array.from({ length: 16 }, (_, index) => `P0${index.toString(16).toUpperCase()}`),
      outputTerminalIds: Array.from({ length: 16 }, (_, index) => `P2${index.toString(16).toUpperCase()}`),
    },
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:exp2-0700d'], {
    orderCode: 'eXP2-0700D',
    evidenceGrade: 'manual-verified',
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:xbl-c41a'], {
    orderCode: 'XBL-C41A',
    evidenceGrade: 'manual-verified',
    reviewCapability: 'profile-only',
    rack: { family: 'LS-XGB', role: 'module', moduleClass: 'communication', occupiedPoints: 64 },
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:xbf-ah04a'], {
    orderCode: 'XBF-AH04A',
    evidenceGrade: 'manual-verified',
    analogIo: XBF_AH04A_CONTRACT,
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:xbf-pd02a'], {
    orderCode: 'XBF-PD02A',
    evidenceGrade: 'manual-verified',
    reviewCapability: 'profile-only',
    rack: { family: 'LS-XGB', role: 'module', moduleClass: 'high-speed', occupiedPoints: 64 },
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['mean-well:mdr-100-24'], {
    orderCode: 'MDR-100-24',
    evidenceGrade: 'manual-verified',
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['ls-electric:mc-22b-dc24-1a1b'], {
    orderCode: 'MC-22b / DC24 / 1a1b',
    evidenceGrade: 'manual-verified',
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['omron:my2n-d2-dc24'], {
    orderCode: 'MY2N-D2 DC24V',
    evidenceGrade: 'manual-verified',
    behaviorProfile: MY2N_D2_DC24_BEHAVIOR,
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['schneider:eocr3de-05duh'], {
    orderCode: 'EOCR3DE-05DUH',
    evidenceGrade: 'manual-verified',
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['phoenix-contact:ut-2.5-3044076'], {
    orderCode: '3044076',
    evidenceGrade: 'manual-verified',
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['phoenix-contact:ut-2.5-pe-3044092'], {
    orderCode: '3044092',
    evidenceGrade: 'manual-verified',
  }),
  adaptDeviceProfileToV3(DEVICE_PROFILES['phoenix-contact:ut-4-hesi-3046032'], {
    orderCode: '3046032',
    evidenceGrade: 'manual-verified',
  }),
];

export const DEVICE_PROFILES_V3: Readonly<Record<string, DeviceProfileV3>> = Object.freeze(
  Object.fromEntries(V3_PROFILE_LIST.map((profile) => [profile.profileId, profile])),
);

export function getDeviceProfileV3(profileId: string): DeviceProfileV3 {
  const profile = DEVICE_PROFILES_V3[profileId];
  if (profile === undefined) throw new Error(`Unknown v3 device profile: ${profileId}`);
  return profile;
}

export function validateExactOrderCode(profile: DeviceProfileV3, suppliedOrderCode: string | undefined): ExactOrderCodeValidation {
  if (suppliedOrderCode === undefined || suppliedOrderCode.trim().length === 0) {
    return { ok: false, reason: 'order-code-required' };
  }
  return suppliedOrderCode === profile.orderCode
    ? { ok: true }
    : { ok: false, reason: 'order-code-mismatch' };
}

/** Prewire review requires both the exact ordered device and manual evidence for its electrical contract. */
export function validatePrewireEligibility(
  profile: DeviceProfileV3,
  suppliedOrderCode: string | undefined,
): PrewireEligibilityValidation {
  const orderCodeValidation = validateExactOrderCode(profile, suppliedOrderCode);
  if (!orderCodeValidation.ok) return orderCodeValidation;
  if (profile.evidence.grade !== 'manual-verified' && profile.evidence.grade !== 'bench-verified') {
    return { ok: false, reason: 'evidence-grade-ineligible' };
  }
  return profile.reviewCapability === 'full'
    ? { ok: true }
    : { ok: false, reason: 'review-capability-incomplete' };
}

function selectorForRange(range: XbfParameterRange): XbfSelectorPosition {
  return range.endsWith('V') ? 'V' : 'I';
}

export function validateXbfAh04aConfiguration(
  profile: DeviceProfileV3,
  configuration: XbfAh04aConfiguration,
): XbfConfigurationValidation {
  if (profile.analogIo?.kind !== 'xbf-ah04a') {
    throw new Error(`Profile ${profile.profileId} does not define an XBF-AH04A configuration contract.`);
  }

  const channels = [...profile.analogIo.inputChannels, ...profile.analogIo.outputChannels];
  for (const channel of channels) {
    const configurationForChannel = configuration[channel.id];
    if (configurationForChannel === undefined) {
      return { ok: false, reason: 'incomplete-channel-configuration', channelId: channel.id };
    }
    if (!configurationForChannel.enabled) continue;
    if (configurationForChannel.selector === undefined || configurationForChannel.parameterRange === undefined) {
      return { ok: false, reason: 'incomplete-channel-configuration', channelId: channel.id };
    }
    if (!channel.supportedRanges.includes(configurationForChannel.parameterRange)) {
      return { ok: false, reason: 'unsupported-range', channelId: channel.id };
    }
    if (configurationForChannel.selector !== selectorForRange(configurationForChannel.parameterRange)) {
      return { ok: false, reason: 'selector-range-mismatch', channelId: channel.id };
    }
  }
  return { ok: true };
}
