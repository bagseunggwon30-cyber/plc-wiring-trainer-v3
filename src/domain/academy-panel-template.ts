import { DEVICE_PROFILES } from '../catalog/profiles';
import type { DeviceInstanceV2, WireV2, WorkshopDocumentV2 } from './types';

function device(
  id: string,
  legacyType: string,
  profileId: string,
  x: number,
  y: number,
  configuration: Record<string, unknown> = {},
): DeviceInstanceV2 {
  const profile = DEVICE_PROFILES[profileId];
  return {
    id,
    legacyType,
    profileId,
    profileVersion: profile.version,
    evidenceLevel: profile.evidence.level,
    missingProfile: false,
    x,
    y,
    rotation: 0,
    configuration,
  };
}

function wire(
  id: string,
  fromDevice: string,
  fromTerminal: string,
  toDevice: string,
  toTerminal: string,
  color: string,
  tag: string,
): WireV2 {
  return {
    id,
    from: { deviceId: fromDevice, terminalId: fromTerminal },
    to: { deviceId: toDevice, terminalId: toTerminal },
    color,
    tag,
    gauge: '1.5mm2',
  };
}

/**
 * A visible diagnostic template for the academy-panel wiring described by the
 * user. It deliberately leaves MD02 A+/B- open so power and communication can
 * be observed as independent states.
 */
export function createAcademyExp2Md02Template(): WorkshopDocumentV2 {
  const devices = [
    device('academy-ac', 'BOUNDARY-AC', 'boundary:ac-supply', 60, 60),
    device('academy-ps1', 'MDR-100', 'mean-well:mdr-100-24', 320, 60, { orderCode: 'MDR-100-24' }),
    device('academy-plc1', 'XBC-DR32H', 'ls-electric:xbc-dr32h', 720, 60, { orderCode: 'XBC-DR32H' }),
    // Keep a vertical wiring corridor between the power/HMI group and PLC.
    // The earlier centered HMI closed this passage and forced long hull routes.
    device('academy-hmi1', 'EXP2-700', 'ls-electric:exp2-0700d', 100, 700, { orderCode: 'eXP2-0700D' }),
    device('academy-md02', 'MY-MD02', 'generic:xy-md02', 820, 730),
  ];
  const wires = [
    wire('academy-w01', 'academy-ac', 'L1', 'academy-ps1', 'L', '#8b4513', 'AC-L-01'),
    wire('academy-w02', 'academy-ac', 'N', 'academy-ps1', 'N', '#3b82f6', 'AC-N-01'),
    wire('academy-w03', 'academy-ac', 'PE', 'academy-ps1', 'PE', '#16a34a', 'PE-01'),
    wire('academy-w04', 'academy-ac', 'L1', 'academy-plc1', 'L', '#8b4513', 'AC-L-02'),
    wire('academy-w05', 'academy-ac', 'N', 'academy-plc1', 'N', '#3b82f6', 'AC-N-02'),
    wire('academy-w06', 'academy-ac', 'PE', 'academy-plc1', 'PE', '#16a34a', 'PE-02'),
    wire('academy-w07', 'academy-ps1', 'V+1', 'academy-hmi1', 'DC24V', '#ef4444', '24V-HMI'),
    wire('academy-w08', 'academy-ps1', 'V-1', 'academy-hmi1', 'DC0V', '#2563eb', '0V-HMI'),
    wire('academy-w09', 'academy-ps1', 'V+2', 'academy-md02', 'V+', '#ef4444', '24V-MD02'),
    wire('academy-w10', 'academy-ps1', 'V-2', 'academy-md02', 'V-', '#2563eb', '0V-MD02'),
    wire('academy-w11', 'academy-hmi1', 'COM1-6', 'academy-plc1', '485+', '#8b5cf6', 'RS485-A'),
    wire('academy-w12', 'academy-hmi1', 'COM1-1', 'academy-plc1', '485-', '#a855f7', 'RS485-B'),
  ];
  return {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: '학원 제어반 · eXP2/XBC/MD02 진단 예제',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires,
    jumpers: [],
    layout: { boardMode: 'free', cabinet: null, rails: {}, ducts: {}, doorPanel: null, panelConfig: null },
    settings: {
      v3Workflow: {
        sourceSystem: { id: 'ac-1ph-220v', label: 'AC 1Φ 220 V / L-N-PE' },
        earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
        canvasUnitsPerMm: 2,
        sourceProtection: {
          phaseSequence: null,
          prospectiveShortCircuitCurrentA: null,
          protectiveDeviceCurve: null,
        },
        reviewScope: {
          templateId: 'academy-exp2-md02',
          deviceIds: devices.filter((entry) => !entry.profileId.startsWith('boundary:')).map((entry) => entry.id),
        },
        designations: {
          'academy-ps1': 'PS1',
          'academy-plc1': 'PLC1',
          'academy-hmi1': 'HMI1',
          'academy-md02': 'TS1',
        },
        deviceSettings: {
          'academy-ps1': { orderCode: 'MDR-100-24' },
          'academy-plc1': {
            orderCode: 'XBC-DR32H',
            rs485: { port: 'BUILT_IN_CNET', protocol: 'XGB_CNET', baudRate: 9600, dataBits: 8, parity: 'NONE', stopBits: 1, stationId: null },
          },
          'academy-hmi1': {
            orderCode: 'eXP2-0700D',
            rs485: { port: 'COM1', protocol: 'XGB_CNET', baudRate: 9600, dataBits: 8, parity: 'NONE', stopBits: 1, stationId: null },
          },
          'academy-md02': {
            orderCode: null,
            rs485: { port: 'RS485', protocol: null, baudRate: null, dataBits: null, parity: null, stopBits: null, stationId: null },
          },
        },
        conductorSettings: Object.fromEntries(wires.map((entry) => [entry.id, {
          cableId: null,
          core: null,
          wireNumber: entry.tag ?? null,
          gauge: entry.gauge ?? null,
          color: entry.color ?? null,
          lengthMm: null,
          ferruleFrom: null,
          ferruleTo: null,
          lugFrom: null,
          lugTo: null,
          shielded: entry.id === 'academy-w11' || entry.id === 'academy-w12',
          drain: false,
        }])),
        plcRuntime: null,
      },
    },
    extensions: {
      legacy: {
        templateId: 'academy-exp2-md02-v1',
        note: 'MD02 A+/B- intentionally left open; this is powered but communication-not-configured.',
      },
    },
  };
}
