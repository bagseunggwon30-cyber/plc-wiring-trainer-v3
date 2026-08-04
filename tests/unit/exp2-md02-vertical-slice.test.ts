import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../src/catalog/v3-profiles';
import { createAcademyExp2Md02Template } from '../../src/domain/academy-panel-template';
import { analyzeSerialDeviceStates } from '../../src/domain/communication-runtime';
import { PUBLIC_MISSIONS } from '../../src/domain/missions';
import type { WorkshopDocumentV2 } from '../../src/domain/types';
import { simulateScenario } from '../../src/domain/v3/circuit';
import { evaluateMissionV3 } from '../../src/domain/v3/mission-evaluator';
import { buildPrewireCircuitV3 } from '../../src/domain/v3/prewire-adapter';
import { adaptLegacyState, type LegacyTrainerState } from '../../src/renderer/legacy-adapter';

const wire = (
  id: string,
  fromDevice: string,
  fromTerminal: string,
  toDevice: string,
  toTerminal: string,
) => ({
  id,
  from: { deviceId: fromDevice, terminalId: fromTerminal },
  to: { deviceId: toDevice, terminalId: toTerminal },
  tag: id.toUpperCase(),
  gauge: '1.5mm2',
});

function device(
  id: string,
  profileId: string,
  configuration: Record<string, unknown> = {},
): WorkshopDocumentV2['devices'][number] {
  const profile = DEVICE_PROFILES[profileId];
  return {
    id,
    profileId,
    profileVersion: profile.version,
    evidenceLevel: profile.evidence.level,
    missingProfile: false,
    x: 0,
    y: 0,
    rotation: 0,
    configuration,
  };
}

function academyWorkshop(): WorkshopDocumentV2 {
  const devices = [
    device('ac', 'boundary:ac-supply'),
    device('psu', 'mean-well:mdr-100-24', { orderCode: 'MDR-100-24' }),
    device('hmi', 'ls-electric:exp2-0700d', {
      orderCode: 'eXP2-0700D',
      rs485: { port: 'COM1', protocol: 'XGB_CNET', baudRate: 9600, dataBits: 8, parity: 'NONE', stopBits: 1 },
    }),
    device('plc', 'ls-electric:xbc-dr32h', {
      orderCode: 'XBC-DR32H',
      rs485: { protocol: 'XGB_CNET', baudRate: 9600, dataBits: 8, parity: 'NONE', stopBits: 1 },
    }),
    device('md02', 'generic:xy-md02'),
  ];
  return {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: '학원 제어반 eXP2·MD02 시험',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires: [
      wire('w-ac-psu-l', 'ac', 'L1', 'psu', 'L'),
      wire('w-ac-psu-n', 'ac', 'N', 'psu', 'N'),
      wire('w-ac-psu-pe', 'ac', 'PE', 'psu', 'PE'),
      wire('w-ac-plc-l', 'ac', 'L1', 'plc', 'L'),
      wire('w-ac-plc-n', 'ac', 'N', 'plc', 'N'),
      wire('w-ac-plc-pe', 'ac', 'PE', 'plc', 'PE'),
      wire('w-hmi-plus', 'psu', 'V+1', 'hmi', 'DC24V'),
      wire('w-hmi-return', 'psu', 'V-1', 'hmi', 'DC0V'),
      wire('w-md02-plus', 'psu', 'V+2', 'md02', 'V+'),
      wire('w-md02-return', 'psu', 'V-2', 'md02', 'V-'),
      wire('w-hmi-rs485-plus', 'hmi', 'COM1-6', 'plc', '485+'),
      wire('w-hmi-rs485-minus', 'hmi', 'COM1-1', 'plc', '485-'),
    ],
    jumpers: [],
    layout: {},
    settings: {
      v3Workflow: {
        sourceSystem: { id: 'academy-ac-220', label: '학원 단상 AC 220 V' },
        earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
        reviewScope: { templateId: 'academy-exp2-md02', deviceIds: devices.map((entry) => entry.id) },
        designations: { psu: 'PS1', hmi: 'HMI1', plc: 'PLC1', md02: 'TS1' },
      },
    },
    extensions: { legacy: {} },
  };
}

describe('eXP2-0700D and XY-MD02 academy-panel vertical slice', () => {
  it('uses the official power terminal and COM1 DB9 polarity instead of invented screw terminals', () => {
    const profile = DEVICE_PROFILES['ls-electric:exp2-0700d'];
    expect(profile.evidence.level).toBe('manual-verified');
    expect(profile.terminals.map((terminal) => terminal.id)).toEqual(expect.arrayContaining([
      'DC24V', 'DC0V', 'FG', 'COM1-1', 'COM1-6',
      'COM2-2', 'COM2-3', 'COM2-5',
      'COM3-TX+', 'COM3-TX-', 'COM3-RX+', 'COM3-RX-', 'COM3-SG', 'COM3-FG',
    ]));
    expect(profile.terminals.find((terminal) => terminal.id === 'COM1-6')).toMatchObject({
      polarity: 'data-positive',
      channel: 'A',
    });
    expect(profile.terminals.find((terminal) => terminal.id === 'COM1-1')).toMatchObject({
      polarity: 'data-negative',
      channel: 'B',
    });
  });

  it('powers both devices only through complete source-return paths and keeps MD02 communication optional', async () => {
    const document = createAcademyExp2Md02Template();
    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const solution = simulateScenario(built.document, { id: 'academy-normal' }).solution;
    const states = analyzeSerialDeviceStates(document, DEVICE_PROFILES, solution);

    expect(document.wires).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { deviceId: 'academy-ps1', terminalId: 'V+1' }, to: { deviceId: 'academy-hmi1', terminalId: 'DC24V' } }),
      expect.objectContaining({ from: { deviceId: 'academy-hmi1', terminalId: 'COM1-6' }, to: { deviceId: 'academy-plc1', terminalId: '485+' } }),
    ]));
    expect(solution.loads['academy-hmi1#supply']).toMatchObject({ energized: true, state: 'ON' });
    expect(solution.loads['academy-md02#supply']).toMatchObject({ energized: true, state: 'ON' });
    expect(states['academy-hmi1']).toMatchObject({ powered: true, communicationWired: true, communicationReady: true });
    expect(states['academy-md02']).toMatchObject({ powered: true, communicationWired: false, communicationReady: false });

    const mission = PUBLIC_MISSIONS.find((entry) => entry.id === 'exp2-power-practice');
    expect(mission).toBeDefined();
    const normalMission = evaluateMissionV3(mission!, built.document, {
      acSupply: 'academy-ac', powerSupply: 'academy-ps1', hmi: 'academy-hmi1',
    });
    expect(normalMission.issues.map((entry) => entry.code)).not.toContain('MISSION_STATE_MISMATCH');

    const openReturn = createAcademyExp2Md02Template();
    openReturn.wires = openReturn.wires.filter((entry) => entry.id !== 'academy-w08');
    const openBuilt = await buildPrewireCircuitV3(openReturn, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const openSolution = simulateScenario(openBuilt.document, { id: 'hmi-open-return' }).solution;
    expect(openSolution.loads['academy-hmi1#supply']).toMatchObject({ energized: false, state: 'OPEN_RETURN_PATH' });
    const openMission = evaluateMissionV3(mission!, openBuilt.document, {
      acSupply: 'academy-ac', powerSupply: 'academy-ps1', hmi: 'academy-hmi1',
    });
    expect(openMission.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'MISSION_CONNECTION_MISSING', 'MISSION_STATE_MISMATCH', 'OPEN_RETURN_PATH',
    ]));
  });

  it('reports crossed HMI DB9 polarity and deterministically restores legacy endpoint aliases', async () => {
    const reversed = academyWorkshop();
    reversed.wires = reversed.wires.map((entry) => {
      if (entry.id === 'w-hmi-rs485-plus') return wire(entry.id, 'hmi', 'COM1-6', 'plc', '485-');
      if (entry.id === 'w-hmi-rs485-minus') return wire(entry.id, 'hmi', 'COM1-1', 'plc', '485+');
      return entry;
    });
    const reversedBuild = await buildPrewireCircuitV3(reversed, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    expect(reversedBuild.issues.map((entry) => entry.code)).toContain('COMMUNICATION_POLARITY_MISMATCH');

    const legacy: LegacyTrainerState = {
      devices: {
        hmi1: { type: 'EXP2-700', x: 120, y: 80, rot: 90 },
        sensor1: { type: 'MY-MD02', x: 400, y: 160, rot: 0 },
        plc1: { type: 'XBC-DR32H' },
      },
      wires: [
        { id: 'old-plus', from: { dev: 'hmi1', term: 'T+' }, to: { dev: 'plc1', term: '485+' } },
        { id: 'old-minus', from: { dev: 'hmi1', term: 'T-' }, to: { dev: 'plc1', term: '485-' } },
      ],
    };
    const migrated = await adaptLegacyState(legacy, 'practice', DEVICE_PROFILES);
    expect(migrated.devices.find((entry) => entry.id === 'hmi1')).toMatchObject({
      profileId: 'ls-electric:exp2-0700d',
      evidenceLevel: 'educational',
      x: 120,
      y: 80,
      rotation: 90,
    });
    expect(migrated.devices.find((entry) => entry.id === 'sensor1')).toMatchObject({
      profileId: 'generic:xy-md02',
      evidenceLevel: 'educational',
      x: 400,
      y: 160,
    });
    expect(migrated.wires).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { deviceId: 'hmi1', terminalId: 'COM1-6' } }),
      expect.objectContaining({ from: { deviceId: 'hmi1', terminalId: 'COM1-1' } }),
    ]));
  });
});
