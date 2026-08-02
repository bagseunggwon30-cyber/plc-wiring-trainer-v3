import type { DeviceInstanceV2, TerminalSpec, WorkshopDocumentV2 } from './types';

type AnalogProtocol = Extract<TerminalSpec['protocol'], 'analog-voltage' | 'analog-current'>;
export type Ig5aInputLogicSetting = 'NPN_INTERNAL_24V' | 'PNP_EXTERNAL_24V';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function xbfChannels(
  instanceConfiguration: Readonly<Record<string, unknown>>,
  workflowDeviceSettings: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return record(instanceConfiguration.xbfChannels ?? workflowDeviceSettings.xbfChannels);
}

function protocolFromChannelSetting(value: unknown): AnalogProtocol | undefined {
  const setting = record(value);
  if (setting.enabled !== true) return undefined;
  const selector = setting.selector;
  const range = setting.parameterRange;
  if (selector !== 'V' && selector !== 'I') return undefined;
  if (typeof range !== 'string') return undefined;
  const protocol = range.endsWith('V') ? 'analog-voltage' : range.endsWith('mA') ? 'analog-current' : undefined;
  if (protocol === undefined) return undefined;
  if ((selector === 'V') !== (protocol === 'analog-voltage')) return undefined;
  return protocol;
}

export function ig5aInputLogicFromSettings(
  instanceConfiguration: Readonly<Record<string, unknown>> = {},
  workflowDeviceSettings: Readonly<Record<string, unknown>> = {},
): Ig5aInputLogicSetting | undefined {
  const value = instanceConfiguration.ig5aInputLogic ?? workflowDeviceSettings.ig5aInputLogic;
  return value === 'NPN_INTERNAL_24V' || value === 'PNP_EXTERNAL_24V' ? value : undefined;
}

function effectiveIg5aInputTerminal(
  terminal: TerminalSpec,
  instanceConfiguration: Readonly<Record<string, unknown>>,
  workflowDeviceSettings: Readonly<Record<string, unknown>>,
): TerminalSpec {
  if (!/^P[1-8]$/.test(terminal.id)) return terminal;
  const setting = ig5aInputLogicFromSettings(instanceConfiguration, workflowDeviceSettings);
  if (setting === 'NPN_INTERNAL_24V') {
    return {
      ...terminal,
      inputLogicMode: 'npn-internal-24v',
      inputActivationPotential: '0V',
    };
  }
  if (setting === 'PNP_EXTERNAL_24V') {
    return {
      ...terminal,
      inputLogicMode: 'pnp-external-24v',
      inputActivationPotential: '+24V',
    };
  }
  return terminal.inputLogicMode === 'configurable'
    ? terminal
    : { ...terminal, inputLogicMode: 'configurable' };
}

/**
 * XBF-AH04A terminal mode is selected by the physical V/I switch and channel
 * parameter, not by the terminal number. Other profiles retain their declared
 * fixed protocol.
 */
export function effectiveTerminalProtocol(
  document: WorkshopDocumentV2,
  instance: DeviceInstanceV2,
  terminal: TerminalSpec,
): TerminalSpec['protocol'] {
  const workflow = record(document.settings.v3Workflow);
  const workflowDeviceSettings = record(record(workflow.deviceSettings)[instance.id]);
  return effectiveTerminalProtocolFromSettings(
    instance.profileId,
    terminal,
    instance.configuration,
    workflowDeviceSettings,
  );
}

/**
 * Synchronous renderer-friendly variant. It keeps the catalog immutable while
 * allowing the terminal dots, wire preview and click-time compatibility check
 * to follow the saved physical selector/parameter state immediately.
 */
export function effectiveTerminalProtocolFromSettings(
  profileId: string,
  terminal: TerminalSpec,
  instanceConfiguration: Readonly<Record<string, unknown>> = {},
  workflowDeviceSettings: Readonly<Record<string, unknown>> = {},
): TerminalSpec['protocol'] {
  if (profileId !== 'ls-electric:xbf-ah04a') return terminal.protocol;
  if (!terminal.channel || !/^(AI|AO)[01]$/.test(terminal.channel)) return terminal.protocol;
  return protocolFromChannelSetting(
    xbfChannels(instanceConfiguration, workflowDeviceSettings)[terminal.channel],
  );
}

export function effectiveTerminalSpecFromSettings(
  profileId: string,
  terminal: TerminalSpec,
  instanceConfiguration: Readonly<Record<string, unknown>> = {},
  workflowDeviceSettings: Readonly<Record<string, unknown>> = {},
): TerminalSpec {
  if (profileId === 'ls-electric:sv-ig5a') {
    return effectiveIg5aInputTerminal(
      terminal,
      instanceConfiguration,
      workflowDeviceSettings,
    );
  }
  const protocol = effectiveTerminalProtocolFromSettings(
    profileId,
    terminal,
    instanceConfiguration,
    workflowDeviceSettings,
  );
  if (protocol === terminal.protocol) return terminal;
  const { protocol: _declaredProtocol, ...withoutProtocol } = terminal;
  return protocol === undefined ? withoutProtocol : { ...withoutProtocol, protocol };
}

/** Returns a graph-local terminal without mutating the catalog profile. */
export function effectiveTerminalSpec(
  document: WorkshopDocumentV2,
  instance: DeviceInstanceV2,
  terminal: TerminalSpec,
): TerminalSpec {
  const workflow = record(document.settings.v3Workflow);
  const workflowDeviceSettings = record(record(workflow.deviceSettings)[instance.id]);
  return effectiveTerminalSpecFromSettings(
    instance.profileId,
    terminal,
    instance.configuration,
    workflowDeviceSettings,
  );
}
