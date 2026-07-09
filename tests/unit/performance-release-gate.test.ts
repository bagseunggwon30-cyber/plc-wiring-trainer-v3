import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { buildCircuitGraph } from '../../src/domain/graph';
import { validateWorkshop } from '../../src/domain/validator';
import type { DeviceInstanceV2, WireV2, WorkshopDocumentV2 } from '../../src/domain/types';

const DEVICE_COUNT = 100;
const WIRE_COUNT = 300;
const WARMUP_RUNS = 5;
const SAMPLE_RUNS = 40;
const P95_LIMIT_MS = 250;
const PLC_COUNT = 40;
const ANALOG_COUNT = 20;
const POWER_SUPPLY_COUNT = 20;
const CONTACT_COUNT = DEVICE_COUNT - 2 - PLC_COUNT - ANALOG_COUNT - POWER_SUPPLY_COUNT;

function device(id: string, profileId: string): DeviceInstanceV2 {
  const profile = DEVICE_PROFILES[profileId];
  if (!profile) throw new Error(`Missing fixture profile ${profileId}`);
  return {
    id,
    profileId,
    profileVersion: profile.version,
    evidenceLevel: profile.evidence.level,
    missingProfile: false,
    x: 0,
    y: 0,
    rotation: 0,
    configuration: {},
  };
}

function wire(
  id: string,
  fromDevice: string,
  fromTerminal: string,
  toDevice: string,
  toTerminal: string,
): WireV2 {
  return {
    id,
    from: { deviceId: fromDevice, terminalId: fromTerminal },
    to: { deviceId: toDevice, terminalId: toTerminal },
  };
}

function buildScaleFixture(): WorkshopDocumentV2 {
  const devices: DeviceInstanceV2[] = [
    device('dc-source', 'boundary:dc-supply'),
    device('load', 'boundary:load'),
    ...Array.from({ length: PLC_COUNT }, (_, index) => (
      device(`plc-${index}`, 'ls-electric:xbc-dr32h')
    )),
    ...Array.from({ length: ANALOG_COUNT }, (_, index) => (
      device(`analog-${index}`, 'ls-electric:xbf-ah04a')
    )),
    ...Array.from({ length: POWER_SUPPLY_COUNT }, (_, index) => (
      device(`power-supply-${index}`, 'mean-well:mdr-100-24')
    )),
    ...Array.from({ length: CONTACT_COUNT }, (_, index) => (
      device(`contact-${index}`, 'boundary:dry-contact')
    )),
  ];
  const wires: WireV2[] = [
    wire('wire-dc-plus', 'dc-source', '+', 'load', '+'),
    wire('wire-dc-minus', 'dc-source', '-', 'load', '-'),
  ];

  const contactTerminals = Array.from({ length: CONTACT_COUNT }, (_, index) => [
    { deviceId: `contact-${index}`, terminalId: 'A' },
    { deviceId: `contact-${index}`, terminalId: 'B' },
  ]).flat();
  const connectedPairs = new Set<string>();
  for (let offset = 1; wires.length < WIRE_COUNT; offset += 1) {
    for (let index = 0; index < contactTerminals.length && wires.length < WIRE_COUNT; index += 1) {
      const from = contactTerminals[index];
      const to = contactTerminals[(index + offset) % contactTerminals.length];
      const pair = [`${from.deviceId}:${from.terminalId}`, `${to.deviceId}:${to.terminalId}`].sort().join('|');
      if (connectedPairs.has(pair)) continue;
      connectedPairs.add(pair);
      wires.push(wire(
        `wire-contact-${wires.length}`,
        from.deviceId,
        from.terminalId,
        to.deviceId,
        to.terminalId,
      ));
    }
  }

  return {
    schemaVersion: 2,
    mode: 'practice',
    revision: 1,
    name: '100-device 300-wire validation release gate',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires,
    jumpers: [],
    layout: {},
    settings: {},
    extensions: { legacy: {} },
  };
}

function percentile95(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error('At least one performance sample is required');
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

describe('validation performance release gate', () => {
  it('exercises the full fixture and detects a same-size fault mutation', async () => {
    const document = buildScaleFixture();
    const graph = buildCircuitGraph(document, DEVICE_PROFILES);
    const baseline = await validateWorkshop(document, DEVICE_PROFILES);
    const expectedNodeCount = document.devices.reduce((sum, instance) => (
      sum + DEVICE_PROFILES[instance.profileId].terminals.length
    ), 0);
    const expectedInternalEdges = document.devices.reduce((sum, instance) => (
      sum + DEVICE_PROFILES[instance.profileId].internalLinks.length
    ), 0);
    const expectedActiveInternalEdges = document.devices.reduce((sum, instance) => (
      sum + DEVICE_PROFILES[instance.profileId].internalLinks.filter((link) => link.kind === 'conductive').length
    ), 0);

    expect(document.devices).toHaveLength(DEVICE_COUNT);
    expect(document.wires).toHaveLength(WIRE_COUNT);
    expect(new Set(document.wires.map((entry) => entry.id)).size).toBe(WIRE_COUNT);
    expect(expectedNodeCount).toBeGreaterThan(2_000);
    expect(graph.nodes.size).toBe(expectedNodeCount);
    expect(graph.edges).toHaveLength(WIRE_COUNT + expectedInternalEdges);
    expect(graph.edges.filter((edge) => edge.active)).toHaveLength(WIRE_COUNT + expectedActiveInternalEdges);
    expect(graph.issues).toEqual([]);
    expect(baseline.status).toBe('PASS');
    expect(baseline.issues).toEqual([]);
    expect(baseline.documentHash).toMatch(/^[a-f0-9]{64}$/);

    const faulted = structuredClone(document);
    faulted.wires[2] = wire('wire-injected-short', 'dc-source', '+', 'dc-source', '-');
    const faultResult = await validateWorkshop(faulted, DEVICE_PROFILES);
    expect(faulted.devices).toHaveLength(DEVICE_COUNT);
    expect(faulted.wires).toHaveLength(WIRE_COUNT);
    expect(faultResult.status).toBe('FAIL');
    expect(faultResult.issues.map((issue) => issue.code)).toContain('DC_SHORT');
    expect(faultResult.documentHash).not.toBe(baseline.documentHash);
  });

  it('keeps warm sequential validation p95 at or below 250 ms', async () => {
    const document = buildScaleFixture();
    const baseline = await validateWorkshop(document, DEVICE_PROFILES);
    expect(baseline.status).toBe('PASS');

    for (let run = 0; run < WARMUP_RUNS; run += 1) {
      const result = await validateWorkshop(document, DEVICE_PROFILES);
      expect(result.status).toBe('PASS');
      expect(result.documentHash).toBe(baseline.documentHash);
    }

    const samples: number[] = [];
    for (let run = 0; run < SAMPLE_RUNS; run += 1) {
      const startedAt = performance.now();
      const result = await validateWorkshop(document, DEVICE_PROFILES);
      samples.push(performance.now() - startedAt);
      expect(result.status).toBe('PASS');
      expect(result.issues).toEqual([]);
      expect(result.documentRevision).toBe(document.revision);
      expect(result.documentHash).toBe(baseline.documentHash);
    }

    const p95 = percentile95(samples);
    expect(samples).toHaveLength(SAMPLE_RUNS);
    expect(samples.every((sample) => Number.isFinite(sample) && sample > 0)).toBe(true);
    expect(
      p95,
      `validation p95 ${p95.toFixed(2)} ms exceeded ${P95_LIMIT_MS} ms across ${SAMPLE_RUNS} warm samples`,
    ).toBeLessThanOrEqual(P95_LIMIT_MS);
  }, 30_000);
});
