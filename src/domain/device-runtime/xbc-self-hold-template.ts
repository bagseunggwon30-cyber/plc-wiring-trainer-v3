import { DEVICE_PROFILES } from '../../catalog/profiles';
import { MY2N_D2_DC24_BEHAVIOR } from '../../catalog/device-behavior-profiles';
import type { DeviceInstanceV2, WireV2, WorkshopDocumentV2 } from '../types';
import type { XbcRelayLampSliceDefinition } from './xbc-relay-lamp-slice';

function device(
  id: string,
  legacyType: string,
  profileId: string,
  x: number,
  y: number,
  configuration: Record<string, unknown> = {},
): DeviceInstanceV2 {
  const profile = DEVICE_PROFILES[profileId];
  if (!profile) throw new Error(`XBC self-hold template profile is missing: ${profileId}`);
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
  waypoints: readonly { x: number; y: number }[] = [],
): WireV2 {
  return {
    id,
    from: { deviceId: fromDevice, terminalId: fromTerminal },
    to: { deviceId: toDevice, terminalId: toTerminal },
    color,
    tag,
    gauge: '0.75mm2',
    ...(waypoints.length ? { waypoints: waypoints.map((point) => ({ ...point })) } : {}),
  };
}

export function createXbcDr32hSelfHoldSliceDefinition(): XbcRelayLampSliceDefinition {
  return Object.freeze({
    startInputBindingId: 'start-input',
    stopInputBindingId: 'stop-input',
    runOutputBindingId: 'run-output',
    startInputElementId: 'plc1#P03',
    stopInputElementId: 'plc1#P02',
    stopInputEncoding: 'active-high-stop-request',
    plcPowerElementId: 'plc1#ac-input',
    startContactStateKey: 'startPb:contact',
    stopContactStateKey: 'stopPb:contact',
    plcOutputContactStateKey: 'plc1:P21',
    relayCoilElementId: 'relay1#coil',
    lampElementId: 'runLamp',
    relayBehaviorProfile: MY2N_D2_DC24_BEHAVIOR,
  });
}

/**
 * Diagnostic-only panel fixture. Generic pushbutton and lamp profiles keep the
 * formal review blocked, while every electrical terminal and return path is
 * explicit and the XBC NC terminal remains unused.
 */
export function createXbcDr32hSelfHoldWorkshopV2(): WorkshopDocumentV2 {
  const devices = [
    device('ac', 'BOUNDARY-AC', 'boundary:ac-supply', 40, 80),
    device('plc1', 'XBC-DR32H', 'ls-electric:xbc-dr32h', 360, 80, { orderCode: 'XBC-DR32H' }),
    device('x24', 'TB-24V-10', 'educational:distribution-24v-10', 360, 520),
    device('x0', 'TB-0V-10', 'educational:distribution-0v-10', 700, 520),
    device('relay1', 'MY2N', 'omron:my2n-d2-dc24', 360, 760, { orderCode: 'MY2N-D2 DC24V' }),
    device('startPb', 'PB-NO', 'educational:pushbutton-no', 1120, 120),
    device('stopPb', 'PB-NC', 'educational:pushbutton-nc', 1120, 360),
    device('runLamp', 'LAMP-G', 'educational:dc24-load', 1120, 760, { assumedCurrentA: 0.02 }),
  ];
  const wires = [
    wire('sh-w01', 'ac', 'L1', 'plc1', 'L', '#8b4513', 'AC-L-01', [{ x: 280, y: 40 }, { x: 280, y: 120 }]),
    wire('sh-w02', 'ac', 'N', 'plc1', 'N', '#2563eb', 'AC-N-01', [{ x: 300, y: 60 }, { x: 300, y: 140 }]),
    wire('sh-w03', 'ac', 'PE', 'plc1', 'PE', '#16a34a', 'PE-01', [{ x: 320, y: 80 }, { x: 320, y: 160 }]),
    wire('sh-w04', 'plc1', '24V', 'x24', '1', '#ef4444', '24V-MAIN', [{ x: 300, y: 460 }, { x: 430, y: 460 }]),
    wire('sh-w05', 'plc1', '24G', 'x0', '1', '#2563eb', '24G-MAIN', [{ x: 320, y: 480 }, { x: 770, y: 480 }]),
    wire('sh-w06', 'x24', '2', 'startPb', '13', '#ef4444', '24V-START', [{ x: 980, y: 600 }, { x: 980, y: 160 }]),
    wire('sh-w07', 'startPb', '14', 'plc1', 'P03', '#f59e0b', 'START-P03', [{ x: 1020, y: 200 }, { x: 1020, y: 40 }, { x: 700, y: 40 }]),
    wire('sh-w08', 'x24', '3', 'stopPb', '21', '#ef4444', '24V-STOP', [{ x: 940, y: 620 }, { x: 940, y: 400 }]),
    wire('sh-w09', 'stopPb', '22', 'plc1', 'P02', '#f59e0b', 'STOP-P02', [{ x: 1060, y: 440 }, { x: 1060, y: 20 }, { x: 680, y: 20 }]),
    wire('sh-w10', 'plc1', 'COMI', 'x0', '2', '#2563eb', 'COMI-24G', [{ x: 820, y: 460 }, { x: 820, y: 580 }]),
    wire('sh-w11', 'x24', '4', 'plc1', 'COM0', '#ef4444', '24V-COM0', [{ x: 500, y: 650 }, { x: 500, y: 500 }]),
    wire('sh-w12', 'plc1', 'P21', 'relay1', '14', '#f59e0b', 'P21-K1-14', [{ x: 660, y: 680 }, { x: 660, y: 820 }]),
    wire('sh-w13', 'relay1', '13', 'x0', '3', '#2563eb', 'K1-13-24G', [{ x: 700, y: 900 }, { x: 820, y: 900 }, { x: 820, y: 640 }]),
    wire('sh-w14', 'x24', '5', 'relay1', '9', '#ef4444', '24V-K1-COM', [{ x: 460, y: 680 }, { x: 460, y: 760 }]),
    wire('sh-w15', 'relay1', '5', 'runLamp', '+', '#f59e0b', 'K1-NO-LAMP', [{ x: 900, y: 820 }, { x: 900, y: 800 }]),
    wire('sh-w16', 'runLamp', '-', 'x0', '4', '#2563eb', 'LAMP-24G', [{ x: 1040, y: 900 }, { x: 860, y: 900 }, { x: 860, y: 660 }]),
  ];
  const conductorSettings = Object.fromEntries(wires.map((entry) => [entry.id, {
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
    shielded: false,
    drain: false,
  }]));
  return {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: 'XBC-DR32H · XG-SIM 자기유지 폐루프 진단',
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
        sourceProtection: { phaseSequence: null, prospectiveShortCircuitCurrentA: 1_000, protectiveDeviceCurve: 'C10' },
        reviewScope: {
          templateId: 'xbc-dr32h-xgsim-self-hold-v1',
          deviceIds: devices.filter((entry) => !entry.profileId.startsWith('boundary:')).map((entry) => entry.id),
        },
        designations: {
          plc1: 'PLC1', x24: 'X24', x0: 'X0', relay1: 'KA1', startPb: 'SB1', stopPb: 'SB2', runLamp: 'HL1',
        },
        deviceSettings: {
          plc1: { orderCode: 'XBC-DR32H' },
          relay1: { orderCode: 'MY2N-D2 DC24V' },
        },
        conductorSettings,
        plcRuntime: null,
      },
    },
    extensions: {
      legacy: {
        templateId: 'xbc-dr32h-xgsim-self-hold-v1',
        diagnosticOnly: true,
        note: 'Generic pushbutton and lamp profiles are educational boundaries; formal project identity remains unverified.',
      },
    },
  };
}
