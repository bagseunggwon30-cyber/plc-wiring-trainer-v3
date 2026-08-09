import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../src/catalog/v3-profiles';
import { analyzeSerialNetwork } from '../../src/domain/communication-runtime';
import type { WorkshopDocumentV2 } from '../../src/domain/types';
import { buildPrewireCircuitV3, validatePrewireDocumentV3 } from '../../src/domain/v3';

function device(id: string, profileId: string, rs485: Record<string, unknown>): WorkshopDocumentV2['devices'][number] {
  const profile = DEVICE_PROFILES[profileId];
  return {
    id, profileId, profileVersion: profile.version, evidenceLevel: profile.evidence.level,
    missingProfile: false, x: 0, y: 0, rotation: 0, configuration: { rs485 },
  };
}

function workshop(overrides: Partial<WorkshopDocumentV2> = {}): WorkshopDocumentV2 {
  const source: WorkshopDocumentV2 = {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: 'XBL-C41A RS485 bus',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices: [
      device('ac', 'boundary:ac-supply', {}),
      device('plc', 'ls-electric:xbc-dr32h', {}),
      device('cnet', 'ls-electric:xbl-c41a', {
        port: 'CNET', protocol: 'MODBUS_RTU_MASTER', baudRate: 9600, dataBits: 8,
        parity: 'NONE', stopBits: 1, mode: '2WIRE', termination: true,
      }),
      device('peer', 'boundary:communication-peer', {
        port: 'RS485', protocol: 'MODBUS_RTU_SLAVE', baudRate: 9600, dataBits: 8,
        parity: 'NONE', stopBits: 1, stationId: 7, mode: '2WIRE', termination: true,
      }),
    ],
    wires: [
      { id: 'ac-l', from: { deviceId: 'ac', terminalId: 'L1' }, to: { deviceId: 'plc', terminalId: 'L' } },
      { id: 'ac-n', from: { deviceId: 'ac', terminalId: 'N' }, to: { deviceId: 'plc', terminalId: 'N' } },
      { id: 'ac-pe', from: { deviceId: 'ac', terminalId: 'PE' }, to: { deviceId: 'plc', terminalId: 'PE' } },
      { id: 'a', from: { deviceId: 'cnet', terminalId: 'TX+' }, to: { deviceId: 'peer', terminalId: 'A' } },
      { id: 'b', from: { deviceId: 'cnet', terminalId: 'TX-' }, to: { deviceId: 'peer', terminalId: 'B' } },
    ],
    jumpers: [
      { id: 'bridge-plus', deviceId: 'cnet', terminalIds: ['TX+', 'RX+'] },
      { id: 'bridge-minus', deviceId: 'cnet', terminalIds: ['TX-', 'RX-'] },
    ],
    layout: {}, settings: {}, extensions: { legacy: {} },
    ...overrides,
  };
  source.devices.find((entry) => entry.id === 'cnet')!.configuration.rackHostId = 'plc';
  return source;
}

async function solution(document: WorkshopDocumentV2) {
  const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
  return validatePrewireDocumentV3(built).solution;
}

describe('RS485 network safety analysis', () => {
  it('requires both XBL-C41A two-wire bridge jumpers before communication can be ready', async () => {
    const complete = workshop();
    expect(analyzeSerialNetwork(complete, DEVICE_PROFILES, await solution(complete))).toMatchObject({
      issues: [],
      devices: { cnet: { bridgeComplete: true, communicationReady: true, status: 'READY' } },
    });

    const open = workshop();
    open.jumpers = open.jumpers.filter((entry) => entry.id !== 'bridge-minus');
    const analyzed = analyzeSerialNetwork(open, DEVICE_PROFILES, await solution(open));
    expect(analyzed.devices.cnet).toMatchObject({ bridgeComplete: false, communicationReady: false, status: 'BRIDGE_MISSING' });
    expect(analyzed.issues.map((issue) => issue.code)).toContain('RS485_BRIDGE_MISSING');
  });

  it('reports reversed A/B, duplicate slave addresses, multiple masters, and invalid termination counts', async () => {
    const reversed = workshop();
    reversed.wires = reversed.wires.map((wire) => wire.id === 'a'
      ? { ...wire, to: { deviceId: 'peer', terminalId: 'B' } }
      : wire.id === 'b' ? { ...wire, to: { deviceId: 'peer', terminalId: 'A' } } : wire);
    expect(analyzeSerialNetwork(reversed, DEVICE_PROFILES, await solution(reversed)).issues.map((issue) => issue.code))
      .toContain('RS485_POLARITY_REVERSED');

    const bus = workshop();
    bus.devices.push(
      device('slave2', 'boundary:communication-peer', {
        port: 'RS485', protocol: 'MODBUS_RTU_SLAVE', baudRate: 9600, dataBits: 8,
        parity: 'NONE', stopBits: 1, stationId: 7, mode: '2WIRE', termination: false,
      }),
      device('master2', 'boundary:communication-peer', {
        port: 'RS485', protocol: 'MODBUS_RTU_MASTER', baudRate: 9600, dataBits: 8,
        parity: 'NONE', stopBits: 1, mode: '2WIRE', termination: false,
      }),
    );
    bus.wires.push(
      { id: 'a2', from: { deviceId: 'peer', terminalId: 'A' }, to: { deviceId: 'slave2', terminalId: 'A' } },
      { id: 'b2', from: { deviceId: 'peer', terminalId: 'B' }, to: { deviceId: 'slave2', terminalId: 'B' } },
      { id: 'a3', from: { deviceId: 'slave2', terminalId: 'A' }, to: { deviceId: 'master2', terminalId: 'A' } },
      { id: 'b3', from: { deviceId: 'slave2', terminalId: 'B' }, to: { deviceId: 'master2', terminalId: 'B' } },
    );
    const peer = bus.devices.find((entry) => entry.id === 'peer')!;
    peer.configuration.rs485 = {
      ...(peer.configuration.rs485 as Record<string, unknown>), termination: false,
    };
    const codes = analyzeSerialNetwork(bus, DEVICE_PROFILES, await solution(bus)).issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'RS485_ADDRESS_DUPLICATE', 'RS485_MULTIPLE_MASTERS', 'RS485_TERMINATION_INVALID',
    ]));
  });

  it('blocks a configured endpoint until termination application is recorded explicitly', async () => {
    const missing = workshop();
    const cnetSettings = missing.devices.find((entry) => entry.id === 'cnet')!.configuration.rs485 as Record<string, unknown>;
    delete cnetSettings.termination;

    const analyzed = analyzeSerialNetwork(missing, DEVICE_PROFILES, await solution(missing));
    expect(analyzed.issues).toContainEqual(expect.objectContaining({
      code: 'RS485_TERMINATION_REQUIRED', severity: 'blocked', refs: ['cnet', 'CNET'],
    }));
    expect(analyzed.devices.cnet.communicationReady).toBe(false);
  });

  it('keeps a rack communication module unpowered when its XBC base unit has no valid AC input', async () => {
    const unpowered = workshop();
    unpowered.wires = unpowered.wires.filter((wire) => wire.id !== 'ac-l');

    expect(analyzeSerialNetwork(unpowered, DEVICE_PROFILES, await solution(unpowered)).devices.cnet).toMatchObject({
      powered: false, communicationReady: false, status: 'UNPOWERED',
    });
  });
});
