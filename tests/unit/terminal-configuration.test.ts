import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import {
  effectiveTerminalProtocol,
  effectiveTerminalSpec,
  effectiveTerminalSpecFromSettings,
} from '../../src/domain/terminal-configuration';
import type { DeviceInstanceV2, WorkshopDocumentV2 } from '../../src/domain/types';

const profile = DEVICE_PROFILES['ls-electric:xbf-ah04a'];

function fixture(channelSettings: Record<string, unknown>): {
  document: WorkshopDocumentV2;
  instance: DeviceInstanceV2;
} {
  const instance: DeviceInstanceV2 = {
    id: 'analog-1',
    profileId: profile.profileId,
    profileVersion: profile.version,
    evidenceLevel: profile.evidence.level,
    missingProfile: false,
    x: 0,
    y: 0,
    rotation: 0,
    configuration: { xbfChannels: channelSettings },
  };
  return {
    instance,
    document: {
      schemaVersion: 2,
      mode: 'prewire',
      revision: 1,
      name: 'XBF configuration',
      source: { kind: 'native-v2', hash: '0'.repeat(64) },
      devices: [instance],
      wires: [],
      jumpers: [],
      layout: {},
      settings: {},
      extensions: { legacy: {} },
    },
  };
}

describe('effective terminal configuration', () => {
  it('derives XBF voltage/current protocol from the saved selector and range', () => {
    const { document, instance } = fixture({
      AI0: { enabled: true, selector: 'V', parameterRange: '0-10V' },
      AI1: { enabled: true, selector: 'I', parameterRange: '4-20mA' },
    });
    const input0 = profile.terminals.find((terminal) => terminal.id === 'I0+')!;
    const input1Return = profile.terminals.find((terminal) => terminal.id === 'I1-')!;

    expect(effectiveTerminalProtocol(document, instance, input0)).toBe('analog-voltage');
    expect(effectiveTerminalSpec(document, instance, input1Return))
      .toMatchObject({ id: 'I1-', protocol: 'analog-current' });
    expect(input0.protocol).toBeUndefined();
  });

  it('does not invent a protocol for a disabled or internally inconsistent channel', () => {
    const { document, instance } = fixture({
      AI0: { enabled: false },
      AI1: { enabled: true, selector: 'V', parameterRange: '4-20mA' },
    });
    const input0 = profile.terminals.find((terminal) => terminal.id === 'I0+')!;
    const input1 = profile.terminals.find((terminal) => terminal.id === 'I1+')!;

    expect(effectiveTerminalProtocol(document, instance, input0)).toBeUndefined();
    expect(effectiveTerminalProtocol(document, instance, input1)).toBeUndefined();
  });

  it('uses workflow settings for the live renderer without mutating the catalog terminal', () => {
    const terminal = profile.terminals.find((entry) => entry.id === 'O0+')!;
    const effective = effectiveTerminalSpecFromSettings(
      profile.profileId,
      terminal,
      {},
      {
        xbfChannels: {
          AO0: { enabled: true, selector: 'I', parameterRange: '0-20mA' },
        },
      },
    );

    expect(effective).toMatchObject({ id: 'O0+', protocol: 'analog-current' });
    expect(effective).not.toBe(terminal);
    expect(terminal.protocol).toBeUndefined();
  });

  it('resolves iG5A P-input activation potential from the physical S8 setting', () => {
    const drive = DEVICE_PROFILES['ls-electric:sv-ig5a'];
    const p1 = drive.terminals.find((terminal) => terminal.id === 'P1')!;

    const unresolved = effectiveTerminalSpecFromSettings(drive.profileId, p1);
    expect(unresolved).toMatchObject({ inputLogicMode: 'configurable' });
    expect(unresolved).not.toHaveProperty('inputActivationPotential');
    expect(effectiveTerminalSpecFromSettings(
      drive.profileId,
      p1,
      {},
      { ig5aInputLogic: 'NPN_INTERNAL_24V' },
    )).toMatchObject({
      inputLogicMode: 'npn-internal-24v',
      inputActivationPotential: '0V',
    });
    expect(effectiveTerminalSpecFromSettings(
      drive.profileId,
      p1,
      { ig5aInputLogic: 'PNP_EXTERNAL_24V' },
    )).toMatchObject({
      inputLogicMode: 'pnp-external-24v',
      inputActivationPotential: '+24V',
    });
    expect(p1).toMatchObject({ inputLogicMode: 'configurable' });
    expect(p1.inputActivationPotential).toBeUndefined();
  });
});
