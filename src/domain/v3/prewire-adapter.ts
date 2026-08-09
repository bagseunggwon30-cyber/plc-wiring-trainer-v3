import { APPROVED_ASSET_MANIFEST } from '../../catalog/assets/approved-manifest';
import { isApprovedAsset, type ApprovedAssetAllowlist } from '../../catalog/v3-asset-manifest';
import {
  checkApprovedTerminalGeometryParity,
  type TerminalGeometrySnapshotInputV3,
} from '../../catalog/v3-geometry';
import {
  validatePrewireEligibility,
  validateXbfAh04aConfiguration,
  type DeviceProfileV3,
  type XbfAh04aConfiguration,
} from '../../catalog/v3-profiles';
import type { DeviceProfile, TerminalRef, WorkshopDocumentV2 } from '../types';
import { PUBLIC_MISSIONS } from '../missions';
import { sha256 } from '../migration';
import { assessTerminalCompatibility } from '../terminal-semantics';
import { effectiveTerminalProtocol, effectiveTerminalSpec } from '../terminal-configuration';
import { simulateScenario } from './circuit';
import type {
  CircuitIssueV3,
  CircuitSolution,
  ElectricalBranch,
  ElectricalElement,
  PhaseSequenceV3,
  SourceSystem,
  ValidationResultV3,
  WorkshopDocumentV3,
} from './contracts';
import { migrateWorkshopDocumentV3 } from './migration';

export interface PrewireCircuitBuildV3 {
  document: WorkshopDocumentV3;
  issues: readonly CircuitIssueV3[];
  installedDeviceIds: readonly string[];
}

export interface PrewireDocumentValidationV3 extends ValidationResultV3 {
  solution: CircuitSolution;
  canIssueVerifiedPrewire: boolean;
}

export type PrewireTerminalGeometryInputV3 = TerminalGeometrySnapshotInputV3;

const v3Ref = (deviceId: string, terminalId: string) => ({ elementId: deviceId, terminalId });

function issue(
  code: CircuitIssueV3['code'],
  message: string,
  refs: readonly string[],
  blocking = true,
): CircuitIssueV3 {
  return { code, message, refs, blocking };
}

function profileForDevice(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  deviceId: string,
): DeviceProfile | undefined {
  const device = document.devices.find((entry) => entry.id === deviceId);
  return device ? catalog[device.profileId] : undefined;
}

function conductorKind(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  from: TerminalRef,
  to: TerminalRef,
): ElectricalBranch['conductor'] {
  const terminals = [from, to].map((ref) => profileForDevice(document, catalog, ref.deviceId)
    ?.terminals.find((terminal) => terminal.id === ref.terminalId));
  if (terminals.some((terminal) => terminal?.domain === 'pe')) return 'pe';
  if (terminals.some((terminal) => terminal?.domain === 'ac')) return 'ac';
  return terminals.some((terminal) =>
    terminal?.domain === 'signal' || terminal?.domain === 'communication')
    ? 'signal'
    : 'dc';
}

function configurationRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

interface CoilDrivenContactContract {
  readonly positiveTerminal: string;
  readonly returnTerminal: string;
  readonly onThresholdVoltage?: number;
  readonly resistanceOhms?: number;
}

function coilDrivenContactContract(profile: DeviceProfile): CoilDrivenContactContract | undefined {
  const behavior = configurationRecord(profile.behavior);
  if (behavior.contactStateSource !== 'coil') return undefined;
  const coil = configurationRecord(behavior.coil);
  const positiveTerminal = typeof coil.positiveTerminal === 'string' ? coil.positiveTerminal : undefined;
  const returnTerminal = typeof coil.returnTerminal === 'string' ? coil.returnTerminal : undefined;
  if (!positiveTerminal || !returnTerminal) return undefined;
  const nominalVoltage = positiveNumber(coil.nominalVoltageVdc);
  const mustOperateVoltage = positiveNumber(coil.mustOperateVoltageVdc);
  const onThresholdVoltage = mustOperateVoltage
    ?? (nominalVoltage === undefined ? undefined : nominalVoltage * 0.85);
  const resistanceOhms = positiveNumber(coil.resistanceOhms);
  return {
    positiveTerminal,
    returnTerminal,
    ...(onThresholdVoltage === undefined ? {} : { onThresholdVoltage }),
    ...(resistanceOhms === undefined ? {} : { resistanceOhms }),
  };
}

function exactProfileConfiguration(
  document: WorkshopDocumentV2,
  deviceId: string,
): { device: Record<string, unknown>; workflow: Record<string, unknown> } {
  const device = document.devices.find((entry) => entry.id === deviceId);
  const workflow = configurationRecord(document.settings.v3Workflow);
  const workflowDeviceSettings = configurationRecord(workflow.deviceSettings);
  return {
    device: configurationRecord(device?.configuration),
    workflow: configurationRecord(workflowDeviceSettings[deviceId]),
  };
}

function scopeDeviceIds(document: WorkshopDocumentV2): Set<string> {
  const workflow = configurationRecord(document.settings.v3Workflow);
  const scope = configurationRecord(workflow.reviewScope);
  return new Set(Array.isArray(scope.deviceIds) ? scope.deviceIds.filter((entry): entry is string => typeof entry === 'string') : []);
}

function connectedTerminalIds(
  document: WorkshopDocumentV2,
  deviceId: string,
): Set<string> {
  const terminalIds = new Set<string>();
  for (const wire of document.wires) {
    if (wire.from.deviceId === deviceId) terminalIds.add(wire.from.terminalId);
    if (wire.to.deviceId === deviceId) terminalIds.add(wire.to.terminalId);
  }
  for (const jumper of document.jumpers) {
    if (jumper.deviceId !== deviceId) continue;
    for (const terminalId of jumper.terminalIds) terminalIds.add(terminalId);
  }
  return terminalIds;
}

/**
 * A boundary load is not required in the unforced baseline when a selected
 * mission explicitly observes it only after a contact change or forced output.
 * The decision remains bound to the saved mission id and role binding, not a
 * display label or inferred device type.
 */
function scenarioControlledBoundaryLoadIds(document: WorkshopDocumentV2): Set<string> {
  const missionId = typeof document.settings.missionId === 'string' ? document.settings.missionId : undefined;
  const mission = PUBLIC_MISSIONS.find((entry) => entry.id === missionId);
  if (!mission) return new Set();
  const bindings = configurationRecord(document.settings.roleBindings);
  const dynamicScenarioIds = new Set(mission.scenarios
    .filter((scenario) => (scenario.forcedOutputs?.length ?? 0) > 0 || (scenario.contactStates?.length ?? 0) > 0)
    .map((scenario) => scenario.id));
  const deviceIds = mission.expectedStates
    .filter((state) => state.kind === 'energized' && state.expected === true && dynamicScenarioIds.has(state.scenarioId))
    .flatMap((state) => {
      const deviceId = bindings[state.target.role];
      const device = typeof deviceId === 'string' ? document.devices.find((entry) => entry.id === deviceId) : undefined;
      return device?.profileId === 'boundary:load' ? [device.id] : [];
    });
  return new Set(deviceIds);
}

function pushProfileTrustIssues(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  profilesV3: Readonly<Record<string, DeviceProfileV3>>,
  assets: ApprovedAssetAllowlist,
  geometry: PrewireTerminalGeometryInputV3 | undefined,
  issues: CircuitIssueV3[],
): string[] {
  const installed: string[] = [];
  const workflow = configurationRecord(document.settings.v3Workflow);
  const designations = configurationRecord(workflow.designations);
  const workflowDeviceSettings = configurationRecord(workflow.deviceSettings);
  const snapshotsByDeviceId = new Map<string, PrewireTerminalGeometryInputV3['snapshots'][number]>();
  const duplicateSnapshotDeviceIds = new Set<string>();
  for (const snapshot of geometry?.snapshots ?? []) {
    if (snapshotsByDeviceId.has(snapshot.deviceId)) duplicateSnapshotDeviceIds.add(snapshot.deviceId);
    snapshotsByDeviceId.set(snapshot.deviceId, snapshot);
  }
  for (const device of document.devices) {
    const legacyProfile = device.profileId;
    const currentProfile = catalog[legacyProfile];
    if (currentProfile !== undefined && device.profileVersion !== currentProfile.version) {
      issues.push(issue(
        'PROFILE_VERSION_MISMATCH',
        `${device.id} was saved with profile ${device.profileVersion}, but the current approved profile is ${currentProfile.version}.`,
        [device.id, legacyProfile, device.profileVersion, currentProfile.version],
      ));
    }
    if (legacyProfile.startsWith('boundary:')) continue;
    installed.push(device.id);
    if (typeof designations[device.id] !== 'string' || String(designations[device.id]).trim().length === 0) {
      issues.push(issue('DESIGNATION_REQUIRED', `${device.id} requires an installation designation such as PS1 or PLC1.`, [device.id]));
    }
    const deviceWorkflow = configurationRecord(workflowDeviceSettings[device.id]);
    if (legacyProfile === 'ls-electric:sv-ig5a') {
      const connected = connectedTerminalIds(document, device.id);
      const inputTouched = [...connected].some((terminalId) => /^P[1-8]$/.test(terminalId));
      const internal24Touched = connected.has('24');
      const inputLogic = device.configuration.ig5aInputLogic ?? deviceWorkflow.ig5aInputLogic;
      if (
        inputTouched
        && inputLogic !== 'NPN_INTERNAL_24V'
        && inputLogic !== 'PNP_EXTERNAL_24V'
      ) {
        issues.push(issue(
          'IG5A_INPUT_LOGIC_REQUIRED',
          `${device.id} requires the actual S8 NPN/PNP selector position before P1-P8 wiring can be evaluated.`,
          [device.id, 'S8', 'ig5aInputLogic'],
        ));
      }
      const controlPowerState = device.configuration.ig5aControlPowerState
        ?? deviceWorkflow.ig5aControlPowerState;
      if (
        (inputTouched || internal24Touched)
        && controlPowerState !== 'POWERED'
        && controlPowerState !== 'UNPOWERED'
      ) {
        issues.push(issue(
          'IG5A_CONTROL_POWER_STATE_REQUIRED',
          `${device.id} requires its actual control-power state before terminal 24 or P1-P8 can be evaluated.`,
          [device.id, 'control-power', 'ig5aControlPowerState'],
        ));
      }
    }
    const profile = profilesV3[legacyProfile];
    if (!profile) {
      issues.push(issue('PROFILE_NOT_V3', `${legacyProfile} has no v3 prewire profile.`, [device.id, legacyProfile]));
      continue;
    }
    const suppliedOrderCode = typeof device.configuration.orderCode === 'string'
      ? device.configuration.orderCode
      : typeof deviceWorkflow.orderCode === 'string'
        ? deviceWorkflow.orderCode
        : undefined;
    const eligibility = validatePrewireEligibility(profile, suppliedOrderCode);
    if (!eligibility.ok) {
      const code = eligibility.reason === 'order-code-required'
        ? 'ORDER_CODE_REQUIRED'
        : eligibility.reason === 'order-code-mismatch'
          ? 'ORDER_CODE_MISMATCH'
          : eligibility.reason === 'review-capability-incomplete'
            ? 'PROFILE_REVIEW_CAPABILITY_INCOMPLETE'
            : 'PROFILE_EVIDENCE_INELIGIBLE';
      issues.push(issue(code, `${device.id} is not eligible for exact-model prewire review (${eligibility.reason}).`, [device.id, legacyProfile]));
    }
    const snapshot = duplicateSnapshotDeviceIds.has(device.id) ? undefined : snapshotsByDeviceId.get(device.id);
    const assetId = typeof device.configuration.assetId === 'string'
      ? device.configuration.assetId
      : snapshot?.assetId ?? '';
    const geometryHash = typeof device.configuration.geometryHash === 'string'
      ? device.configuration.geometryHash
      : snapshot?.geometryHash ?? '';
    if (!assetId || !geometryHash || !isApprovedAsset(assets, assetId, geometryHash)) {
      issues.push(issue(
        'ASSET_GEOMETRY_UNAPPROVED',
        `${device.id} has no approved asset and geometry pair; electrical evidence is not promoted by its image.`,
        [device.id, assetId || 'asset:missing', geometryHash || 'geometry:missing'],
      ));
    }
    if (geometry !== undefined) {
      const parity = checkApprovedTerminalGeometryParity(
        profile,
        snapshot,
        (observedAssetId, observedGeometryHash) => isApprovedAsset(assets, observedAssetId, observedGeometryHash),
      );
      if (!parity.ok) {
        const refs = [
          device.id,
          ...parity.missingTerminalIds.map((terminalId) => `missing:${terminalId}`),
          ...parity.extraTerminalIds.map((terminalId) => `extra:${terminalId}`),
          ...parity.hiddenTerminalIds.map((terminalId) => `invisible:${terminalId}`),
          ...parity.duplicateTerminalIds.map((terminalId) => `duplicate:${terminalId}`),
          ...(parity.approved ? [] : ['geometry:unapproved']),
          ...(duplicateSnapshotDeviceIds.has(device.id) ? ['snapshot:duplicate'] : []),
        ];
        issues.push(issue(
          'TERMINAL_GEOMETRY_MISMATCH',
          `${device.id} renderer terminal geometry is incomplete, mismatched, invisible, duplicated, or unapproved for ${profile.orderCode}.`,
          refs,
        ));
      }
    }
    if (profile.analogIo?.kind === 'xbf-ah04a') {
      const rawChannels = configurationRecord(device.configuration.xbfChannels ?? deviceWorkflow.xbfChannels);
      const configuration = rawChannels as unknown as XbfAh04aConfiguration;
      const result = validateXbfAh04aConfiguration(profile, configuration);
      if (!result.ok) {
        issues.push(issue(
          result.reason === 'selector-range-mismatch' ? 'XBF_SELECTOR_RANGE_MISMATCH' : 'XBF_CONFIGURATION_INCOMPLETE',
          `${device.id} ${result.channelId} analog selector/parameter configuration is ${result.reason}.`,
          [device.id, result.channelId],
        ));
      }
    }
    if (legacyProfile === 'schneider:eocr3de-05duh') {
      const failSafeMode = device.configuration.failSafeMode ?? deviceWorkflow.failSafeMode;
      if (typeof failSafeMode !== 'boolean') {
        issues.push(issue(
          'EOCR_CONFIGURATION_INCOMPLETE',
          `${device.id} requires an explicit failSafeMode selection because 95-96 and 97-98 reverse their healthy state in fail-safe operation.`,
          [device.id, 'failSafeMode'],
        ));
      }
    }
    if (legacyProfile === 'phoenix-contact:ut-4-hesi-3046032') {
      const fuseLinkOrderCode = device.configuration.fuseLinkOrderCode ?? deviceWorkflow.fuseLinkOrderCode;
      if (typeof fuseLinkOrderCode !== 'string' || fuseLinkOrderCode.trim().length === 0) {
        issues.push(issue(
          'FUSE_LINK_REQUIRED',
          `${device.id} requires the exact installed 5x20 fuse-link order code; Phoenix Contact item 3046032 is supplied without a fuse.`,
          [device.id, 'fuseLinkOrderCode'],
        ));
      } else {
        issues.push(issue(
          'FUSE_LINK_PROFILE_UNVERIFIED',
          `${device.id} records fuse link ${fuseLinkOrderCode.trim()}, but that fuse link has no approved exact-model profile, rating, breaking-capacity, characteristic, and manual hash yet.`,
          [device.id, fuseLinkOrderCode.trim()],
        ));
      }
    }
  }
  return installed.sort();
}

function addAlias(
  branches: ElectricalBranch[],
  id: string,
  fromElement: string,
  fromTerminal: string,
  toElement: string,
  toTerminal: string,
  conductor: ElectricalBranch['conductor'] = 'dc',
): void {
  branches.push({ id, from: v3Ref(fromElement, fromTerminal), to: v3Ref(toElement, toTerminal), conductor });
}

/** Converts the visible V2/SVG document into the conductor/branch model used by the v3 solver. */
export async function buildPrewireCircuitV3(
  source: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  profilesV3: Readonly<Record<string, DeviceProfileV3>>,
  assets: ApprovedAssetAllowlist = APPROVED_ASSET_MANIFEST,
  geometry?: PrewireTerminalGeometryInputV3,
): Promise<PrewireCircuitBuildV3> {
  const migrated = await migrateWorkshopDocumentV3(source);
  if (!migrated.ok) throw new Error(migrated.issues.map((entry) => entry.message).join(' '));
  const customIssues: CircuitIssueV3[] = [];
  const installedDeviceIds = pushProfileTrustIssues(source, catalog, profilesV3, assets, geometry, customIssues);
  const conductorSettings = configurationRecord(configurationRecord(source.settings.v3Workflow).conductorSettings);
  const sourceProtection = configurationRecord(configurationRecord(source.settings.v3Workflow).sourceProtection);
  for (const wire of source.wires) {
    const setting = configurationRecord(conductorSettings[wire.id]);
    const wireNumber = wire.tag?.trim() || (typeof setting.wireNumber === 'string' ? setting.wireNumber.trim() : '');
    const gauge = wire.gauge?.trim() || (typeof setting.gauge === 'string' ? setting.gauge.trim() : '');
    if (!wireNumber) {
      customIssues.push(issue('CONDUCTOR_IDENTIFICATION_REQUIRED', `${wire.id} requires a wire/core number.`, [wire.id]));
    }
    if (!gauge) {
      customIssues.push(issue('CONDUCTOR_SIZE_REQUIRED', `${wire.id} requires a conductor cross-section or AWG size.`, [wire.id]));
    }
    const fromDevice = source.devices.find((device) => device.id === wire.from.deviceId);
    const toDevice = source.devices.find((device) => device.id === wire.to.deviceId);
    const fromDeclared = profileForDevice(source, catalog, wire.from.deviceId)
      ?.terminals.find((terminal) => terminal.id === wire.from.terminalId);
    const toDeclared = profileForDevice(source, catalog, wire.to.deviceId)
      ?.terminals.find((terminal) => terminal.id === wire.to.terminalId);
    const fromTerminal = fromDevice && fromDeclared
      ? effectiveTerminalSpec(source, fromDevice, fromDeclared)
      : fromDeclared;
    const toTerminal = toDevice && toDeclared
      ? effectiveTerminalSpec(source, toDevice, toDeclared)
      : toDeclared;
    if (fromTerminal && toTerminal) {
      const assessment = assessTerminalCompatibility(fromTerminal, toTerminal);
      if (!assessment.compatible) {
        customIssues.push(issue(
          assessment.code,
          assessment.message,
          [
            wire.id,
            `${wire.from.deviceId}:${wire.from.terminalId}`,
            `${wire.to.deviceId}:${wire.to.terminalId}`,
          ],
        ));
      }
    }
  }
  const scoped = scopeDeviceIds(source);
  const scenarioControlledLoads = scenarioControlledBoundaryLoadIds(source);
  const elements: ElectricalElement[] = [];
  const sources: SourceSystem[] = [];
  const branches: ElectricalBranch[] = source.wires.map((wire) => ({
    id: wire.id,
    from: v3Ref(wire.from.deviceId, wire.from.terminalId),
    to: v3Ref(wire.to.deviceId, wire.to.terminalId),
    conductor: conductorKind(source, catalog, wire.from, wire.to),
  }));

  for (const jumper of source.jumpers) {
    const first = jumper.terminalIds[0];
    if (!first) continue;
    for (const [index, terminalId] of jumper.terminalIds.slice(1).entries()) {
      addAlias(branches, `${jumper.id}:${index + 1}`, jumper.deviceId, first, jumper.deviceId, terminalId);
    }
  }

  const parentByElement = new Map<string, string>();
  for (const device of source.devices) {
    const profile = catalog[device.profileId];
    if (!profile) continue;
    if (device.profileId === 'boundary:ac-supply') {
      const sourceSupply = migrated.document.sourceSystem.supply;
      const prospectiveShortCircuitCurrentA = typeof sourceProtection.prospectiveShortCircuitCurrentA === 'number'
        ? sourceProtection.prospectiveShortCircuitCurrentA
        : typeof device.configuration.prospectiveShortCircuitCurrentA === 'number'
          ? device.configuration.prospectiveShortCircuitCurrentA
        : null;
      const protectiveDeviceCurve = typeof sourceProtection.protectiveDeviceCurve === 'string'
        ? sourceProtection.protectiveDeviceCurve
        : typeof device.configuration.protectiveDeviceCurve === 'string'
          ? device.configuration.protectiveDeviceCurve
        : null;
      const protectionCoordination = { prospectiveShortCircuitCurrentA, protectiveDeviceCurve };
      if (sourceSupply.kind === 'ac-three-phase') {
        const configuredPhaseSequence = sourceProtection.phaseSequence ?? device.configuration.phaseSequence;
        const declaredPhaseSequence: PhaseSequenceV3 | undefined = configuredPhaseSequence === 'L1-L2-L3' || configuredPhaseSequence === 'L1-L3-L2'
          ? configuredPhaseSequence
          : undefined;
        sources.push({
          kind: 'ac-three-phase',
          id: device.id,
          phaseTerminals: { L1: 'L1', L2: 'L2', L3: 'L3' },
          ...(sourceSupply.conductors.includes('N') ? { neutralTerminal: 'N' } : {}),
          peTerminal: 'PE',
          lineToLineVoltage: sourceSupply.nominalVoltage ?? 400,
          ...(sourceSupply.conductors.includes('N') && sourceSupply.nominalVoltage !== null
            ? { lineToNeutralVoltage: Math.round(sourceSupply.nominalVoltage / Math.sqrt(3)) }
            : {}),
          ...(declaredPhaseSequence ? { declaredPhaseSequence } : {}),
          protectionCoordination,
        });
      } else {
        sources.push({
          kind: 'ac-single-phase',
          id: device.id,
          lineTerminal: 'L1',
          neutralTerminal: 'N',
          peTerminal: 'PE',
          lineToNeutralVoltage: sourceSupply.kind === 'ac-single-phase' ? sourceSupply.nominalVoltage ?? 230 : 230,
          protectionCoordination,
        });
      }
      continue;
    }
    if (device.profileId === 'boundary:dc-supply') {
      sources.push({ kind: 'dc', id: device.id, positiveTerminal: '+', returnTerminal: '-', voltage: 24 });
      continue;
    }
    if (profile.behavior?.kind === 'dc-source-practice') {
      const positiveTerminal = typeof profile.behavior.positiveTerminal === 'string'
        ? profile.behavior.positiveTerminal
        : 'V+';
      const returnTerminal = typeof profile.behavior.returnTerminal === 'string'
        ? profile.behavior.returnTerminal
        : 'V-';
      sources.push({
        kind: 'dc',
        id: device.id,
        positiveTerminal,
        returnTerminal,
        voltage: positiveNumber(profile.behavior.voltageVdc) ?? 24,
      });
      continue;
    }
    if (profile.behavior?.kind === 'ac-dc-power-supply-practice') {
      elements.push({
        kind: 'device',
        id: device.id,
        terminals: profile.terminals.map((terminal) => terminal.id),
      });
      parentByElement.set(device.id, device.id);
      const lineTerminal = typeof profile.behavior.lineTerminal === 'string'
        ? profile.behavior.lineTerminal
        : 'L';
      const neutralTerminal = typeof profile.behavior.neutralTerminal === 'string'
        ? profile.behavior.neutralTerminal
        : 'N';
      const peTerminal = typeof profile.behavior.peTerminal === 'string'
        ? profile.behavior.peTerminal
        : 'PE';
      const positiveTerminal = typeof profile.behavior.positiveTerminal === 'string'
        ? profile.behavior.positiveTerminal
        : 'V+';
      const returnTerminal = typeof profile.behavior.returnTerminal === 'string'
        ? profile.behavior.returnTerminal
        : 'V-';
      const acInputId = `${device.id}#ac-input`;
      elements.push({
        kind: 'ac-load',
        id: acInputId,
        lineTerminal: 'L',
        neutralTerminal: 'N',
        peTerminal: 'PE',
        parentDeviceId: device.id,
        required: 'always',
      });
      parentByElement.set(acInputId, device.id);
      addAlias(branches, `practice-psu:${device.id}:L`, device.id, lineTerminal, acInputId, 'L', 'ac');
      addAlias(branches, `practice-psu:${device.id}:N`, device.id, neutralTerminal, acInputId, 'N', 'ac');
      addAlias(branches, `practice-psu:${device.id}:PE`, device.id, peTerminal, acInputId, 'PE', 'pe');

      const sourceId = `${device.id}#dc-output`;
      sources.push({
        kind: 'dc',
        id: sourceId,
        positiveTerminal: '+24V',
        returnTerminal: '0V',
        voltage: positiveNumber(profile.behavior.voltageVdc) ?? 24,
        enabledByElementId: acInputId,
      });
      addAlias(
        branches,
        `practice-psu:${device.id}:+`,
        sourceId,
        '+24V',
        device.id,
        positiveTerminal,
        'internal',
      );
      addAlias(
        branches,
        `practice-psu:${device.id}:0`,
        sourceId,
        '0V',
        device.id,
        returnTerminal,
        'internal',
      );
      continue;
    }
    if (profile.behavior?.kind === 'three-phase-motor-practice') {
      elements.push({
        kind: 'three-phase-load',
        id: device.id,
        phaseTerminals: { L1: 'U', L2: 'V', L3: 'W' },
        peTerminal: 'PE',
        parentDeviceId: device.id,
        required: 'always',
      });
      parentByElement.set(device.id, device.id);
      continue;
    }
    if (profile.behavior?.kind === 'dc-load-practice') {
      const positiveTerminal = typeof profile.behavior.positiveTerminal === 'string'
        ? profile.behavior.positiveTerminal
        : '+';
      const returnTerminal = typeof profile.behavior.returnTerminal === 'string'
        ? profile.behavior.returnTerminal
        : '-';
      const hasAdditionalTerminals = profile.terminals.some((terminal) =>
        terminal.id !== positiveTerminal && terminal.id !== returnTerminal);
      const loadElementId = hasAdditionalTerminals ? `${device.id}#supply` : device.id;
      if (hasAdditionalTerminals) {
        elements.push({
          kind: 'device',
          id: device.id,
          terminals: profile.terminals.map((terminal) => terminal.id),
        });
        parentByElement.set(device.id, device.id);
      }
      elements.push({
        kind: 'load',
        id: loadElementId,
        positiveTerminal,
        returnTerminal,
        parentDeviceId: device.id,
        polarity: 'positive-return',
        required: 'always',
        resistanceOhms: positiveNumber(profile.behavior.resistanceOhms),
        onThresholdVoltage: positiveNumber(profile.behavior.onThresholdVoltage),
      });
      parentByElement.set(loadElementId, device.id);
      if (hasAdditionalTerminals) {
        addAlias(branches, `supply:${device.id}:positive`, device.id, positiveTerminal, loadElementId, positiveTerminal);
        addAlias(branches, `supply:${device.id}:return`, device.id, returnTerminal, loadElementId, returnTerminal);
      }
      continue;
    }
    if (profile.behavior?.kind === 'modbus-practice') {
      const positiveTerminal = typeof profile.behavior.positiveTerminal === 'string'
        ? profile.behavior.positiveTerminal
        : 'V+';
      const returnTerminal = typeof profile.behavior.returnTerminal === 'string'
        ? profile.behavior.returnTerminal
        : 'V-';
      const assumedCurrentA = positiveNumber(profile.behavior.assumedCurrentA);
      const loadElementId = `${device.id}#supply`;
      elements.push({
        kind: 'device',
        id: device.id,
        terminals: profile.terminals.map((terminal) => terminal.id),
      });
      parentByElement.set(device.id, device.id);
      elements.push({
        kind: 'load',
        id: loadElementId,
        positiveTerminal,
        returnTerminal,
        parentDeviceId: device.id,
        polarity: 'positive-return',
        required: 'always',
        ...(assumedCurrentA === undefined ? {} : { resistanceOhms: 24 / assumedCurrentA }),
        onThresholdVoltage: positiveNumber(profile.behavior.onThresholdVoltage),
      });
      parentByElement.set(loadElementId, device.id);
      addAlias(branches, `supply:${device.id}:positive`, device.id, positiveTerminal, loadElementId, positiveTerminal);
      addAlias(branches, `supply:${device.id}:return`, device.id, returnTerminal, loadElementId, returnTerminal);
      continue;
    }
    if (device.profileId === 'boundary:load') {
      elements.push({
        kind: 'load', id: device.id, positiveTerminal: '+', returnTerminal: '-',
        required: scenarioControlledLoads.has(device.id) ? 'scenario' : 'always',
      });
      parentByElement.set(device.id, device.id);
      continue;
    }
    if (profile.behavior?.kind === 'analog-boundary') {
      const protocol = profile.behavior.protocol;
      const direction = profile.behavior.direction;
      if (
        (protocol === 'analog-voltage' || protocol === 'analog-current')
        && (direction === 'source' || direction === 'sink')
      ) {
        elements.push({
          kind: 'analog-port',
          id: device.id,
          positiveTerminal: '+',
          returnTerminal: '-',
          protocol,
          direction,
          required: 'always',
        });
        parentByElement.set(device.id, device.id);
      }
      continue;
    }
    if (profile.behavior?.kind === 'two-wire-current-transmitter') {
      const configured = exactProfileConfiguration(source, device.id);
      const configuredMilliamp = positiveNumber(
        configured.device.currentMilliamp ?? configured.workflow.currentMilliamp,
      );
      const defaultCurrentA = positiveNumber(profile.behavior.currentA) ?? 0.012;
      elements.push({
        kind: 'two-wire-current-transmitter',
        id: device.id,
        positiveTerminal: '+',
        negativeTerminal: '-',
        currentA: configuredMilliamp === undefined ? defaultCurrentA : configuredMilliamp / 1000,
        minimumOperatingVoltageV: positiveNumber(profile.behavior.minimumOperatingVoltageV) ?? 12,
        maximumLoopVoltageV: positiveNumber(profile.behavior.maximumLoopVoltageV) ?? 30,
        required: 'always',
      });
      parentByElement.set(device.id, device.id);
      continue;
    }
    if (device.profileId === 'boundary:dry-contact') {
      elements.push({ kind: 'contact', id: device.id, terminalA: 'A', terminalB: 'B', stateKey: `${device.id}:contact`, normally: 'open' });
      parentByElement.set(device.id, device.id);
      continue;
    }
    elements.push({ kind: 'device', id: device.id, terminals: profile.terminals.map((terminal) => terminal.id) });
    parentByElement.set(device.id, device.id);
    const coilContract = coilDrivenContactContract(profile);
    if (coilContract) {
      const elementId = `${device.id}#coil`;
      elements.push({
        kind: 'load',
        id: elementId,
        positiveTerminal: coilContract.positiveTerminal,
        returnTerminal: coilContract.returnTerminal,
        role: 'coil',
        parentDeviceId: device.id,
        polarity: 'positive-return',
        required: 'scenario',
        ...(coilContract.onThresholdVoltage === undefined
          ? {}
          : { onThresholdVoltage: coilContract.onThresholdVoltage }),
        ...(coilContract.resistanceOhms === undefined
          ? {}
          : { resistanceOhms: coilContract.resistanceOhms }),
      });
      parentByElement.set(elementId, device.id);
      addAlias(
        branches,
        `coil:${device.id}:${coilContract.positiveTerminal}`,
        device.id,
        coilContract.positiveTerminal,
        elementId,
        coilContract.positiveTerminal,
      );
      addAlias(
        branches,
        `coil:${device.id}:${coilContract.returnTerminal}`,
        device.id,
        coilContract.returnTerminal,
        elementId,
        coilContract.returnTerminal,
      );
    }
    for (const link of profile.internalLinks.filter((entry) => entry.kind === 'conductive')) {
      const fromTerminal = profile.terminals.find((terminal) => terminal.id === link.from);
      const toTerminal = profile.terminals.find((terminal) => terminal.id === link.to);
      const conductor = fromTerminal?.domain === 'pe' || toTerminal?.domain === 'pe'
        ? 'pe'
        : fromTerminal?.domain === 'ac' || toTerminal?.domain === 'ac'
          ? 'ac'
          : 'dc';
      addAlias(branches, `internal:${device.id}:${link.from}:${link.to}`, device.id, link.from, device.id, link.to, conductor);
    }
    const dynamicLinks = profile.internalLinks.filter((entry) => entry.kind === 'dynamic-contact');
    const dynamicContactKeyCounts = new Map<string, number>();
    for (const [index, link] of dynamicLinks.entries()) {
      const contactKey = link.stateKey ?? `contact-${index + 1}`;
      dynamicContactKeyCounts.set(contactKey, (dynamicContactKeyCounts.get(contactKey) ?? 0) + 1);
    }
    for (const [index, link] of dynamicLinks.entries()) {
      const contactKey = link.stateKey ?? `contact-${index + 1}`;
      let normally = link.normally ?? 'open';
      if (device.profileId === 'schneider:eocr3de-05duh') {
        const workflow = configurationRecord(source.settings.v3Workflow);
        const workflowDeviceSettings = configurationRecord(configurationRecord(workflow.deviceSettings)[device.id]);
        const failSafeMode = device.configuration.failSafeMode ?? workflowDeviceSettings.failSafeMode;
        if (typeof failSafeMode === 'boolean') {
          if (contactKey === 'ol-95-96') normally = failSafeMode ? 'open' : 'closed';
          if (contactKey === 'ol-97-98') normally = failSafeMode ? 'closed' : 'open';
        }
      }
      const contactIdSuffix = (dynamicContactKeyCounts.get(contactKey) ?? 0) > 1
        ? `:${link.from}-${link.to}`
        : '';
      const elementId = `${device.id}#contact:${contactKey}${contactIdSuffix}`;
      const physicalStateKey = `${device.id}:${contactKey}${contactIdSuffix}`;
      const drivenBy = coilContract
        ? {
            elementId: `${device.id}#coil`,
            mode: normally === 'closed'
              ? 'closed-when-deenergized' as const
              : 'closed-when-energized' as const,
          }
        : device.profileId === 'mean-well:mdr-100-24' && contactKey === 'powered'
          ? {
              elementId: `${device.id}#ac-input`,
              mode: 'closed-when-energized' as const,
            }
        : undefined;
      elements.push({
        kind: 'contact',
        id: elementId,
        terminalA: 'a',
        terminalB: 'b',
        // A changeover pole contains two physical branches with opposite
        // states. They must not share one boolean state key.
        stateKey: physicalStateKey,
        normally,
        ...(drivenBy ? { drivenBy } : {}),
      });
      parentByElement.set(elementId, device.id);
      addAlias(branches, `contact:${elementId}:a`, device.id, link.from, elementId, 'a', 'internal');
      addAlias(branches, `contact:${elementId}:b`, device.id, link.to, elementId, 'b', 'internal');
    }

    if (profile.behavior?.kind === 'three-wire-sensor') {
      const configured = exactProfileConfiguration(source, device.id);
      const outputMode = profile.behavior.outputMode;
      const supplyPositiveTerminal = typeof profile.behavior.supplyPositiveTerminal === 'string'
        ? profile.behavior.supplyPositiveTerminal
        : 'BN';
      const supplyReturnTerminal = typeof profile.behavior.supplyReturnTerminal === 'string'
        ? profile.behavior.supplyReturnTerminal
        : 'BU';
      const outputTerminal = typeof profile.behavior.outputTerminal === 'string'
        ? profile.behavior.outputTerminal
        : 'BK';
      if (outputMode === 'sinking-transistor' || outputMode === 'sourcing-transistor') {
        const supplyElementId = `${device.id}#supply`;
        const assumedSupplyCurrentA = positiveNumber(profile.behavior.assumedSupplyCurrentA) ?? 0.01;
        elements.push({
          kind: 'load',
          id: supplyElementId,
          positiveTerminal: 'positive',
          returnTerminal: 'return',
          role: 'module-supply',
          parentDeviceId: device.id,
          polarity: 'positive-return',
          required: 'always',
          resistanceOhms: 24 / assumedSupplyCurrentA,
          onThresholdVoltage: 20.4,
        });
        parentByElement.set(supplyElementId, device.id);
        addAlias(branches, `sensor-supply:${device.id}:+`, device.id, supplyPositiveTerminal, supplyElementId, 'positive');
        addAlias(branches, `sensor-supply:${device.id}:0`, device.id, supplyReturnTerminal, supplyElementId, 'return');

        const outputElementId = `${device.id}#output`;
        elements.push({
          kind: 'transistor-output',
          id: outputElementId,
          supplyPositiveTerminal: 'positive',
          supplyReturnTerminal: 'return',
          outputTerminal: 'output',
          mode: outputMode === 'sinking-transistor' ? 'sinking' : 'sourcing',
          stateKey: `${device.id}:detect`,
          defaultState: configured.device.sensorDetected === true || configured.workflow.sensorDetected === true,
          supplyElementId,
          parentDeviceId: device.id,
          required: 'scenario',
        });
        parentByElement.set(outputElementId, device.id);
        addAlias(branches, `sensor-output:${device.id}:+`, device.id, supplyPositiveTerminal, outputElementId, 'positive');
        addAlias(branches, `sensor-output:${device.id}:0`, device.id, supplyReturnTerminal, outputElementId, 'return');
        addAlias(branches, `sensor-output:${device.id}:out`, device.id, outputTerminal, outputElementId, 'output', 'signal');
      }
    }

    const isXbcUTransistor = device.profileId === 'ls-electric:xbc-dn32up'
      || device.profileId === 'ls-electric:xbc-dp32up';
    const isXbcPlc = device.profileId === 'ls-electric:xbc-dr32h' || isXbcUTransistor;
    const isConverter = device.profileId === 'mean-well:mdr-100-24' || isXbcPlc;
    if (isConverter) {
      const acInputId = `${device.id}#ac-input`;
      elements.push({
        kind: 'ac-load', id: acInputId, lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE',
        parentDeviceId: device.id, required: 'always',
      });
      parentByElement.set(acInputId, device.id);
      addAlias(branches, `ac-input:${device.id}:L`, device.id, 'L', acInputId, 'L', 'ac');
      addAlias(branches, `ac-input:${device.id}:N`, device.id, 'N', acInputId, 'N', 'ac');
      addAlias(branches, `ac-input:${device.id}:PE`, device.id, 'PE', acInputId, 'PE', 'pe');

      const sourceId = `${device.id}#internal24`;
      sources.push({
        kind: 'dc', id: sourceId, positiveTerminal: '+24V', returnTerminal: '0V', voltage: 24,
        enabledByElementId: acInputId,
      });
      const positiveTerminal = device.profileId === 'mean-well:mdr-100-24' ? 'V+1' : '24V';
      const returnTerminal = device.profileId === 'mean-well:mdr-100-24' ? 'V-1' : '24G';
      addAlias(branches, `internal-source:${device.id}:+`, sourceId, '+24V', device.id, positiveTerminal);
      addAlias(branches, `internal-source:${device.id}:0`, sourceId, '0V', device.id, returnTerminal);
    }

    if (isXbcPlc) {
      const inputCommon = isXbcUTransistor ? 'COMI-A' : 'COMI';
      for (const terminal of profile.terminals.filter((entry) => /^P0[0-9A-F]$/.test(entry.id))) {
        const elementId = `${device.id}#${terminal.id}`;
        elements.push({
          kind: 'load', id: elementId, positiveTerminal: 'signal', returnTerminal: 'common', role: 'digital-input',
          parentDeviceId: device.id, polarity: 'either', required: 'scenario', resistanceOhms: terminal.id <= 'P03' ? 3300 : 5600,
          onThresholdVoltage: 19, onThresholdCurrentA: 0.003,
        });
        parentByElement.set(elementId, device.id);
        addAlias(branches, `input:${device.id}:${terminal.id}:signal`, device.id, terminal.id, elementId, 'signal');
        addAlias(branches, `input:${device.id}:${terminal.id}:common`, device.id, inputCommon, elementId, 'common');
      }
      if (isXbcUTransistor) {
        const sinking = device.profileId === 'ls-electric:xbc-dn32up';
        const supplyPositiveTerminal = sinking ? 'VOUT' : 'COMO';
        const supplyReturnTerminal = sinking ? 'COMO' : '0VOUT';
        const supplyElementId = `${device.id}#output-supply`;
        elements.push({
          kind: 'load', id: supplyElementId, positiveTerminal: 'positive', returnTerminal: 'return',
          role: 'module-supply', parentDeviceId: device.id, required: 'scenario', onThresholdVoltage: 10.2,
        });
        parentByElement.set(supplyElementId, device.id);
        addAlias(branches, `output-supply:${device.id}:+`, device.id, supplyPositiveTerminal, supplyElementId, 'positive');
        addAlias(branches, `output-supply:${device.id}:0`, device.id, supplyReturnTerminal, supplyElementId, 'return');
        for (const terminal of profile.terminals.filter((entry) => /^P2[0-9A-F]$/.test(entry.id))) {
          const elementId = `${device.id}#${terminal.id}:transistor`;
          elements.push({
            kind: 'transistor-output', id: elementId,
            supplyPositiveTerminal: 'positive', supplyReturnTerminal: 'return', outputTerminal: 'output',
            mode: sinking ? 'sinking' : 'sourcing', stateKey: `${device.id}:${terminal.id}`,
            supplyElementId, controlPowerElementId: `${device.id}#ac-input`,
            parentDeviceId: device.id, required: 'scenario',
          });
          parentByElement.set(elementId, device.id);
          addAlias(branches, `transistor:${device.id}:${terminal.id}:out`, device.id, terminal.id, elementId, 'output');
          addAlias(branches, `transistor:${device.id}:${terminal.id}:+`, device.id, supplyPositiveTerminal, elementId, 'positive');
          addAlias(branches, `transistor:${device.id}:${terminal.id}:0`, device.id, supplyReturnTerminal, elementId, 'return');
        }
      } else {
        for (const terminal of profile.terminals.filter((entry) => /^P2[0-9A-F]$/.test(entry.id))) {
          const elementId = `${device.id}#${terminal.id}:relay`;
          const index = Number.parseInt(terminal.id.slice(2), 16);
          const common = `COM${Math.floor(index / 4)}`;
          elements.push({ kind: 'contact', id: elementId, terminalA: 'output', terminalB: 'common', stateKey: `${device.id}:${terminal.id}`, normally: 'open' });
          parentByElement.set(elementId, device.id);
          addAlias(branches, `relay:${device.id}:${terminal.id}:out`, device.id, terminal.id, elementId, 'output');
          addAlias(branches, `relay:${device.id}:${terminal.id}:com`, device.id, common, elementId, 'common');
        }
      }
    }

    if (device.profileId === 'ls-electric:sv-ig5a') {
      const configured = exactProfileConfiguration(source, device.id);
      const inputLogic = configured.device.ig5aInputLogic ?? configured.workflow.ig5aInputLogic;
      const controlPowerState = configured.device.ig5aControlPowerState
        ?? configured.workflow.ig5aControlPowerState;
      const connected = connectedTerminalIds(source, device.id);
      const inputTerminalIds = profile.terminals
        .map((terminal) => terminal.id)
        .filter((terminalId) => /^P[1-8]$/.test(terminalId) && connected.has(terminalId));

      /*
       * The exact drive power variant is deliberately not inferred. POWERED is
       * an explicit practice-state assertion, while the educational profile
       * remains ineligible for VERIFIED_PREWIRE. It only enables the manual
       * page-25 control circuit and the documented terminal-24 auxiliary rail.
       */
      const controlSourceId = `${device.id}#control24`;
      if (controlPowerState === 'POWERED') {
        sources.push({
          kind: 'dc',
          id: controlSourceId,
          positiveTerminal: '+24V',
          returnTerminal: '0V',
          voltage: 24,
        });
        addAlias(
          branches,
          `ig5a-control:${device.id}:24`,
          controlSourceId,
          '+24V',
          device.id,
          '24',
          'internal',
        );
        addAlias(
          branches,
          `ig5a-control:${device.id}:CM`,
          controlSourceId,
          '0V',
          device.id,
          'CM',
          'internal',
        );
      }

      if (
        controlPowerState === 'POWERED'
        && (inputLogic === 'NPN_INTERNAL_24V' || inputLogic === 'PNP_EXTERNAL_24V')
      ) {
        for (const terminalId of inputTerminalIds) {
          const elementId = `${device.id}#${terminalId}`;
          const internalNpn = inputLogic === 'NPN_INTERNAL_24V';
          elements.push({
            kind: 'load',
            id: elementId,
            positiveTerminal: internalNpn ? 'internal-positive' : 'signal',
            returnTerminal: internalNpn ? 'switched-return' : 'common',
            role: 'digital-input',
            parentDeviceId: device.id,
            polarity: 'positive-return',
            required: 'always',
            onThresholdVoltage: 12,
            ...(internalNpn ? {} : { forbiddenSourceIds: [controlSourceId] }),
          });
          parentByElement.set(elementId, device.id);
          if (internalNpn) {
            addAlias(
              branches,
              `ig5a-input:${device.id}:${terminalId}:internal+`,
              controlSourceId,
              '+24V',
              elementId,
              'internal-positive',
              'internal',
            );
            addAlias(
              branches,
              `ig5a-input:${device.id}:${terminalId}:P`,
              device.id,
              terminalId,
              elementId,
              'switched-return',
              'internal',
            );
          } else {
            addAlias(
              branches,
              `ig5a-input:${device.id}:${terminalId}:P`,
              device.id,
              terminalId,
              elementId,
              'signal',
              'internal',
            );
            addAlias(
              branches,
              `ig5a-input:${device.id}:${terminalId}:CM`,
              device.id,
              'CM',
              elementId,
              'common',
              'internal',
            );
          }
        }
      }
    }

    if (device.profileId === 'ls-electric:xbf-ah04a') {
      const elementId = `${device.id}#supply`;
      elements.push({
        kind: 'load', id: elementId, positiveTerminal: '+24V', returnTerminal: '0V',
        role: 'module-supply', parentDeviceId: device.id, required: 'always', onThresholdVoltage: 20.4,
      });
      parentByElement.set(elementId, device.id);
      addAlias(branches, `supply:${device.id}:+`, device.id, '+24V', elementId, '+24V');
      addAlias(branches, `supply:${device.id}:0`, device.id, '0V', elementId, '0V');
      const channelTerminals = [
        ['AI0', 'I0+', 'I0-', 'sink'],
        ['AI1', 'I1+', 'I1-', 'sink'],
        ['AO0', 'O0+', 'O0-', 'source'],
        ['AO1', 'O1+', 'O1-', 'source'],
      ] as const;
      for (const [channelId, positiveTerminal, returnTerminal, direction] of channelTerminals) {
        const terminal = profile.terminals.find((entry) => entry.id === positiveTerminal);
        if (!terminal) continue;
        const protocol = effectiveTerminalProtocol(source, device, terminal);
        if (protocol !== 'analog-voltage' && protocol !== 'analog-current') continue;
        const analogElementId = `${device.id}#${channelId}`;
        elements.push({
          kind: 'analog-port',
          id: analogElementId,
          positiveTerminal,
          returnTerminal,
          protocol,
          direction,
          parentDeviceId: device.id,
          supplyElementId: elementId,
          required: 'always',
          ...(protocol === 'analog-current' && direction === 'sink'
            ? { inputResistanceOhms: 250, maximumCurrentA: 0.025 }
            : {}),
        });
        parentByElement.set(analogElementId, device.id);
        addAlias(
          branches,
          `analog:${device.id}:${channelId}:+`,
          device.id,
          positiveTerminal,
          analogElementId,
          positiveTerminal,
          'signal',
        );
        addAlias(
          branches,
          `analog:${device.id}:${channelId}:return`,
          device.id,
          returnTerminal,
          analogElementId,
          returnTerminal,
          'signal',
        );
      }
    }

    if (device.profileId === 'schneider:eocr3de-05duh') {
      const elementId = `${device.id}#control-supply`;
      elements.push({
        kind: 'ac-load',
        id: elementId,
        lineTerminal: 'A1',
        neutralTerminal: 'A2',
        parentDeviceId: device.id,
        required: 'always',
      });
      parentByElement.set(elementId, device.id);
      addAlias(branches, `control:${device.id}:A1`, device.id, 'A1', elementId, 'A1', 'ac');
      addAlias(branches, `control:${device.id}:A2`, device.id, 'A2', elementId, 'A2', 'ac');
    }
  }

  if (migrated.document.sourceSystem.supply.status !== 'complete') {
    customIssues.push(issue('SOURCE_SYSTEM_REQUIRED', 'A project SourceSystem must be selected before prewire review.', []));
  }
  if (migrated.document.sourceSystem.earthing.status !== 'complete') {
    customIssues.push(issue('EARTHING_POLICY_REQUIRED', 'An earthing and 0V-PE policy must be selected before prewire review.', []));
  }
  if (!installedDeviceIds.length) {
    customIssues.push(issue('NO_INSTALLED_EQUIPMENT', 'Boundary nodes alone can produce only a diagnostic result.', []));
  }

  const elementIds = elements
    .filter((element) => scoped.has(parentByElement.get(element.id) ?? element.id))
    .map((element) => element.id)
    .sort();
  const deviceInstances = (migrated.document.deviceInstances ?? []).map((instance) => {
    const profile = profilesV3[instance.profileId];
    if (!profile) return instance;
    const suppliedOrderCode = instance.exactOrderCode ?? undefined;
    if (!validatePrewireEligibility(profile, suppliedOrderCode).ok) return instance;
    const behavior = configurationRecord(profile.behavior);
    const dimensions = configurationRecord(behavior.dimensionsMm);
    const width = positiveNumber(dimensions.width);
    const height = positiveNumber(dimensions.height);
    const depth = positiveNumber(dimensions.depth);
    return {
      ...instance,
      layoutMm: {
        ...instance.layoutMm,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(depth === undefined ? {} : { depth }),
      },
    };
  });
  const terminalAssemblies = (migrated.document.terminalAssemblies ?? []).map((assembly) => {
    const instance = deviceInstances.find((entry) => entry.id === assembly.deviceId);
    const profile = instance ? profilesV3[instance.profileId] : undefined;
    if (!instance || !profile || !validatePrewireEligibility(profile, instance.exactOrderCode ?? undefined).ok) {
      return assembly;
    }
    const behavior = configurationRecord(profile.behavior);
    const terminalType = behavior.kind === 'terminal-block'
      && (behavior.terminalType === 'through' || behavior.terminalType === 'pe')
      ? behavior.terminalType
      : behavior.kind === 'protection' && behavior.terminalType === 'fused'
        ? 'fused' as const
        : assembly.terminalType;
    const maximumConductorsPerTerminal = positiveNumber(behavior.maximumConductorsPerConnection)
      ?? assembly.maximumConductorsPerTerminal;
    const settings = exactProfileConfiguration(source, instance.id);
    const fuseLinkOrderCode = settings.device.fuseLinkOrderCode ?? settings.workflow.fuseLinkOrderCode;
    const accessories = terminalType === 'fused' && typeof fuseLinkOrderCode === 'string' && fuseLinkOrderCode.trim()
      ? [...assembly.accessories, `fuse-link:${fuseLinkOrderCode.trim()}`]
      : [...assembly.accessories];
    return {
      ...assembly,
      manufacturer: profile.manufacturer,
      orderCode: profile.orderCode,
      terminalType,
      maximumConductorsPerTerminal,
      accessories: [...new Set(accessories)].sort(),
    };
  });
  const enrichedWithoutHash: WorkshopDocumentV3 = {
    ...migrated.document,
    sources,
    elements,
    branches,
    deviceInstances,
    terminalAssemblies,
    reviewScope: {
      ...migrated.document.reviewScope,
      elementIds,
      deviceIds: [...scoped].sort(),
      status: migrated.document.reviewScope.status,
    },
  };
  const { hash: _oldHash, ...hashPayload } = enrichedWithoutHash;
  const document: WorkshopDocumentV3 = { ...enrichedWithoutHash, hash: await sha256(hashPayload) };
  return { document, issues: customIssues, installedDeviceIds };
}

function mergedStatus(issues: readonly CircuitIssueV3[]): Exclude<ValidationResultV3['status'], 'STALE'> {
  const safetyFailed = new Set<CircuitIssueV3['code']>(['AC_PHASE_PE_FAULT', 'PARALLEL_SOURCE', 'EARTHING_POLICY_BOND_COUNT']);
  if (issues.some((entry) => safetyFailed.has(entry.code))) return 'FAIL';
  const failed = new Set<CircuitIssueV3['code']>([
    'DC_SHORT', 'LOAD_REVERSED', 'LOAD_INACTIVE', 'INPUT_CURRENT_BELOW_THRESHOLD', 'INPUT_SOURCE_MISMATCH',
    'OPEN_RETURN_PATH', 'OPEN_SOURCE_PATH', 'SOURCE_CONDITION_UNMET',
    'PARALLEL_SOURCE', 'PE_MISSING', 'AC_PHASE_NEUTRAL_SHORT', 'AC_PHASE_PHASE_SHORT',
    'AC_PHASE_PE_FAULT', 'EARTHING_POLICY_BOND_COUNT', 'MISSING_PHASE', 'WRONG_PHASE_SEQUENCE', 'PE_AS_WORKING_RETURN',
    'TERMINAL_NOT_CONNECTED', 'TERMINAL_DOMAIN_MISMATCH', 'TERMINAL_POLARITY_MISMATCH',
    'AC_LINE_NEUTRAL_MISMATCH', 'AC_PHASE_MISMATCH', 'AC_MAINS_DRIVE_OUTPUT_CONFLICT',
    'DC_POLARITY_MISMATCH', 'PE_TERMINAL_MISUSE', 'COMMON_ROLE_MISMATCH',
    'ANALOG_REFERENCE_MISMATCH', 'COMMUNICATION_REFERENCE_MISMATCH',
    'COMMUNICATION_POLARITY_MISMATCH', 'TERMINAL_PROTOCOL_MISMATCH',
    'SIGNAL_DIRECTION_MISMATCH', 'TERMINAL_SOURCE_CONFLICT',
    'INPUT_LOGIC_POLARITY_MISMATCH',
    'ANALOG_SIGNAL_SHORT', 'ANALOG_POLARITY_REVERSED', 'ANALOG_MODE_MISMATCH',
    'ANALOG_DIRECTION_MISMATCH', 'ANALOG_SOURCE_PATH_OPEN', 'ANALOG_RETURN_PATH_OPEN',
    'TRANSISTOR_OUTPUT_UNPOWERED',
    'CURRENT_LOOP_SOURCE_PATH_OPEN', 'CURRENT_LOOP_SIGNAL_PATH_OPEN', 'CURRENT_LOOP_RETURN_PATH_OPEN',
    'CURRENT_LOOP_POLARITY_REVERSED', 'CURRENT_LOOP_RECEIVER_UNPOWERED',
    'CURRENT_LOOP_COMPLIANCE_INSUFFICIENT', 'CURRENT_LOOP_OVER_RANGE',
  ]);
  if (issues.some((entry) => failed.has(entry.code))) return 'FAIL';
  const blocked = new Set<CircuitIssueV3['code']>([
    'REVIEW_SCOPE_INCOMPLETE', 'SOURCE_SYSTEM_REQUIRED', 'EARTHING_POLICY_REQUIRED', 'ORDER_CODE_REQUIRED',
    'ORDER_CODE_MISMATCH', 'PROFILE_EVIDENCE_INELIGIBLE', 'PROFILE_REVIEW_CAPABILITY_INCOMPLETE',
    'PROFILE_NOT_V3', 'ASSET_GEOMETRY_UNAPPROVED',
    'XBF_CONFIGURATION_INCOMPLETE', 'XBF_SELECTOR_RANGE_MISMATCH', 'IG5A_INPUT_LOGIC_REQUIRED',
    'IG5A_CONTROL_POWER_STATE_REQUIRED', 'NO_INSTALLED_EQUIPMENT',
    'INPUT_LOGIC_MODE_REQUIRED',
    'EOCR_CONFIGURATION_INCOMPLETE', 'FUSE_LINK_REQUIRED', 'FUSE_LINK_PROFILE_UNVERIFIED',
    'DESIGNATION_REQUIRED', 'CONDUCTOR_IDENTIFICATION_REQUIRED', 'CONDUCTOR_SIZE_REQUIRED',
    'TERMINAL_ASSEMBLY_DATA_INCOMPLETE', 'TERMINAL_GEOMETRY_MISMATCH',
    'UNKNOWN_TERMINAL', 'DUPLICATE_ELEMENT_ID', 'NON_CONVERGENT_SIMULATION', 'PROTECTION_COORDINATION_BLOCKED',
    'PROFILE_VERSION_MISMATCH', 'INVALID_CONTACT_RULE',
  ]);
  if (issues.some((entry) => blocked.has(entry.code))) return 'BLOCKED';
  return issues.some((entry) => entry.blocking) ? 'FAIL' : 'PASS';
}

export function validatePrewireDocumentV3(build: PrewireCircuitBuildV3): PrewireDocumentValidationV3 {
  const baseline = simulateScenario(build.document, { id: 'baseline' });
  const base = baseline.validation;
  const solution = baseline.solution;
  const issues = [...base.issues, ...build.issues];
  const deduplicated = issues.filter((entry, index) => issues.findIndex((candidate) =>
    candidate.code === entry.code && candidate.refs.join('|') === entry.refs.join('|')) === index);
  const status = mergedStatus(deduplicated);
  return {
    status,
    issues: deduplicated,
    documentRevision: build.document.revision,
    documentHash: build.document.hash,
    solution,
    canIssueVerifiedPrewire: status === 'PASS' && build.installedDeviceIds.length > 0,
  };
}
