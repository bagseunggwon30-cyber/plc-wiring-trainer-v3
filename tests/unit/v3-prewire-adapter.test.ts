import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../src/catalog/v3-profiles';
import { approvedAssetAllowlist } from '../../src/catalog/v3-asset-manifest';
import {
  buildPrewireCircuitV3,
  validatePrewireDocumentV3,
} from '../../src/domain/v3/prewire-adapter';
import { simulateScenario } from '../../src/domain/v3/circuit';
import type { WorkshopDocumentV2 } from '../../src/domain/types';

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

function workshop(devices: WorkshopDocumentV2['devices'], wires: WorkshopDocumentV2['wires']): WorkshopDocumentV2 {
  return {
    schemaVersion: 2,
    mode: 'prewire',
    revision: 3,
    name: 'v3 adapter fixture',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices,
    wires,
    jumpers: [],
    layout: {},
    settings: {
      v3Workflow: {
        sourceSystem: { id: 'dc-24v-isolated', label: 'DC 24 V isolated source' },
        earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
        reviewScope: { templateId: 'control-panel-prewire', deviceIds: devices.map((entry) => entry.id) },
        designations: {},
      },
    },
    extensions: { legacy: {} },
  };
}

const wire = (id: string, fromDevice: string, fromTerminal: string, toDevice: string, toTerminal: string) => ({
  id,
  from: { deviceId: fromDevice, terminalId: fromTerminal },
  to: { deviceId: toDevice, terminalId: toTerminal },
});

describe('V2 editor to v3 prewire circuit adapter', () => {
  it('maps a two-terminal boundary load and reports its missing 0V return', async () => {
    const source = device('dc', 'boundary:dc-supply');
    const load = device('lamp', 'boundary:load');
    const document = workshop([source, load], [wire('w+', 'dc', '+', 'lamp', '+')]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);

    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('OPEN_RETURN_PATH');
  });

  it('reports fixed-polarity and NC endpoint mistakes while accepting both valid XBC COM modes', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const xbc = device('plc', 'ls-electric:xbc-dr32h', { orderCode: 'XBC-DR32H' });
    const xbf = device('analog', 'ls-electric:xbf-ah04a', { orderCode: 'XBF-AH04A' });
    const document = workshop([dc, xbc, xbf], [
      wire('wrong-polarity', 'dc', '+', 'analog', '0V'),
      wire('nc-used', 'dc', '+', 'plc', 'NC'),
      wire('input-com-positive', 'dc', '+', 'plc', 'COMI'),
      wire('relay-com-return', 'dc', '-', 'plc', 'COM0'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const endpointCodes = new Set([
      'DC_POLARITY_MISMATCH',
      'TERMINAL_NOT_CONNECTED',
      'COMMON_ROLE_MISMATCH',
      'TERMINAL_SOURCE_CONFLICT',
    ]);
    const codesByWire = new Map(built.issues.flatMap((entry) =>
      entry.refs[0] && endpointCodes.has(entry.code)
        ? [[entry.refs[0], entry.code] as const]
        : []));

    expect(codesByWire.get('wrong-polarity')).toBe('DC_POLARITY_MISMATCH');
    expect(codesByWire.get('nc-used')).toBe('TERMINAL_NOT_CONNECTED');
    expect(codesByWire.has('input-com-positive')).toBe(false);
    expect(codesByWire.has('relay-com-return')).toBe(false);
  });

  it.each([
    { profileId: 'ls-electric:xbc-dn32up', orderCode: 'XBC-DN32UP', mode: 'sinking' },
    { profileId: 'ls-electric:xbc-dp32up', orderCode: 'XBC-DP32UP', mode: 'sourcing' },
  ])('maps $orderCode outputs as powered transistors rather than dry relay contacts', async ({
    profileId,
    orderCode,
    mode,
  }) => {
    const plc = device('plc', profileId, { orderCode });
    const built = await buildPrewireCircuitV3(workshop([plc], []), DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const outputs = built.document.elements.filter((element) => element.kind === 'transistor-output');

    expect(outputs).toHaveLength(16);
    expect(outputs[0]).toMatchObject({
      mode,
      stateKey: 'plc:P20',
      supplyElementId: 'plc#output-supply',
      controlPowerElementId: 'plc#ac-input',
    });
    expect(built.document.elements.some((element) => element.id === 'plc#P20:relay')).toBe(false);
    expect(built.issues.map((entry) => entry.code)).toContain('PROFILE_REVIEW_CAPABILITY_INCOMPLETE');
  });

  it('emits distinct endpoint codes for L/N, source paralleling, PE, SG and signal direction', async () => {
    const ac = device('ac', 'boundary:ac-supply');
    const dc = device('dc', 'boundary:dc-supply');
    const xbc = device('plc', 'ls-electric:xbc-dr32h', { orderCode: 'XBC-DR32H' });
    const peer = device('peer', 'boundary:communication-peer');
    const document = workshop([ac, dc, xbc, peer], [
      wire('line-to-neutral', 'ac', 'L1', 'plc', 'N'),
      wire('parallel-dc-source', 'dc', '+', 'plc', '24V'),
      wire('return-to-pe', 'dc', '-', 'plc', 'PE'),
      wire('rs485-sg-to-rs232-sg', 'peer', 'SG', 'plc', 'SG'),
      wire('input-to-input', 'plc', 'P00', 'plc', 'P01'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const codesByWire = new Map(built.issues.flatMap((entry) =>
      entry.refs[0] ? [[entry.refs[0], entry.code] as const] : []));

    expect(codesByWire.get('line-to-neutral')).toBe('AC_LINE_NEUTRAL_MISMATCH');
    expect(codesByWire.get('parallel-dc-source')).toBe('TERMINAL_SOURCE_CONFLICT');
    expect(codesByWire.get('return-to-pe')).toBe('PE_TERMINAL_MISUSE');
    expect(codesByWire.get('rs485-sg-to-rs232-sg')).toBe('TERMINAL_PROTOCOL_MISMATCH');
    expect(codesByWire.get('input-to-input')).toBe('SIGNAL_DIRECTION_MISMATCH');
  });

  it('blocks an iG5A input decision until S8 is recorded and enforces the selected polarity', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const drive = device('drive', 'ls-electric:sv-ig5a');
    const unresolvedDocument = workshop([dc, drive], [
      wire('unresolved-input', 'dc', '+', 'drive', 'P1'),
    ]);

    const unresolved = await buildPrewireCircuitV3(
      unresolvedDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    expect(unresolved.issues.map((entry) => entry.code)).toContain('IG5A_INPUT_LOGIC_REQUIRED');
    expect(unresolved.issues.map((entry) => entry.code)).toContain('IG5A_CONTROL_POWER_STATE_REQUIRED');
    expect(unresolved.issues.some((entry) =>
      entry.refs[0] === 'unresolved-input'
      && entry.code === 'INPUT_LOGIC_MODE_REQUIRED')).toBe(true);

    const npnDocument = workshop([dc, drive], [
      wire('wrong-npn-polarity', 'dc', '+', 'drive', 'P1'),
      wire('right-npn-polarity', 'dc', '-', 'drive', 'P2'),
    ]);
    npnDocument.settings.v3Workflow = {
      ...(npnDocument.settings.v3Workflow as Record<string, unknown>),
      deviceSettings: {
        drive: {
          ig5aInputLogic: 'NPN_INTERNAL_24V',
          ig5aControlPowerState: 'POWERED',
        },
      },
    };
    const npn = await buildPrewireCircuitV3(npnDocument, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    expect(npn.issues.some((entry) =>
      entry.refs[0] === 'wrong-npn-polarity'
      && entry.code === 'INPUT_LOGIC_POLARITY_MISMATCH')).toBe(true);
    expect(npn.issues.some((entry) =>
      entry.refs[0] === 'right-npn-polarity'
      && entry.code === 'INPUT_LOGIC_POLARITY_MISMATCH')).toBe(false);
    expect(npn.issues.map((entry) => entry.code)).not.toContain('IG5A_INPUT_LOGIC_REQUIRED');
    expect(npn.issues.map((entry) => entry.code)).not.toContain('IG5A_CONTROL_POWER_STATE_REQUIRED');
  });

  it('solves the two documented iG5A P-input current paths only as complete circuits', async () => {
    const driveNpn = device('drive-npn', 'ls-electric:sv-ig5a');
    const npnDocument = workshop([driveNpn], [
      wire('npn-return', 'drive-npn', 'P1', 'drive-npn', 'CM'),
    ]);
    npnDocument.settings.v3Workflow = {
      ...(npnDocument.settings.v3Workflow as Record<string, unknown>),
      deviceSettings: {
        'drive-npn': {
          ig5aInputLogic: 'NPN_INTERNAL_24V',
          ig5aControlPowerState: 'POWERED',
        },
      },
    };
    const npnBuilt = await buildPrewireCircuitV3(npnDocument, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const npnResult = validatePrewireDocumentV3(npnBuilt);

    expect(npnBuilt.document.sources).toContainEqual(expect.objectContaining({
      id: 'drive-npn#control24',
      positiveTerminal: '+24V',
      returnTerminal: '0V',
      voltage: 24,
    }));
    expect(npnResult.solution.loads['drive-npn#P1']).toMatchObject({
      energized: true,
      state: 'ON',
      sourceId: 'drive-npn#control24',
    });

    const dc = device('dc', 'boundary:dc-supply');
    const drivePnp = device('drive-pnp', 'ls-electric:sv-ig5a');
    const pnpDocument = workshop([dc, drivePnp], [
      wire('pnp-source', 'dc', '+', 'drive-pnp', 'P1'),
      wire('pnp-return', 'drive-pnp', 'CM', 'dc', '-'),
    ]);
    pnpDocument.settings.v3Workflow = {
      ...(pnpDocument.settings.v3Workflow as Record<string, unknown>),
      deviceSettings: {
        'drive-pnp': {
          ig5aInputLogic: 'PNP_EXTERNAL_24V',
          ig5aControlPowerState: 'POWERED',
        },
      },
    };
    const pnpBuilt = await buildPrewireCircuitV3(pnpDocument, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const pnpResult = validatePrewireDocumentV3(pnpBuilt);

    expect(pnpResult.solution.loads['drive-pnp#P1']).toMatchObject({
      energized: true,
      state: 'ON',
      sourceId: 'dc',
    });

    const openReturnDocument = workshop([dc, drivePnp], [
      wire('pnp-source-only', 'dc', '+', 'drive-pnp', 'P1'),
    ]);
    openReturnDocument.settings.v3Workflow = pnpDocument.settings.v3Workflow;
    const openReturnBuilt = await buildPrewireCircuitV3(
      openReturnDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    const openReturnResult = validatePrewireDocumentV3(openReturnBuilt);
    expect(openReturnResult.solution.loads['drive-pnp#P1']).toMatchObject({
      energized: false,
      state: 'OPEN_RETURN_PATH',
    });
    expect(openReturnResult.issues.map((entry) => entry.code)).toContain('OPEN_RETURN_PATH');

    const internalPnpDocument = workshop([drivePnp], [
      wire('forbidden-internal-24', 'drive-pnp', '24', 'drive-pnp', 'P1'),
    ]);
    internalPnpDocument.settings.v3Workflow = pnpDocument.settings.v3Workflow;
    const internalPnpBuilt = await buildPrewireCircuitV3(
      internalPnpDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    const internalPnpResult = validatePrewireDocumentV3(internalPnpBuilt);
    expect(internalPnpResult.solution.loads['drive-pnp#P1']).toMatchObject({
      energized: false,
      state: 'WRONG_SOURCE',
      sourceId: 'drive-pnp#control24',
    });
    expect(internalPnpResult.issues.map((entry) => entry.code)).toContain('INPUT_SOURCE_MISMATCH');
  });

  it('enables generic practice PSU V+/V- only after L/N/PE and keeps motor U/V/W ordered', async () => {
    const acForPsu = device('ac-psu', 'boundary:ac-supply');
    const source = device('psu', 'educational:dc24-source-box');
    const load = device('load', 'boundary:load');
    const dcDocument = workshop([acForPsu, source, load], [
      wire('ac-line', 'ac-psu', 'L1', 'psu', 'L'),
      wire('ac-neutral', 'ac-psu', 'N', 'psu', 'N'),
      wire('ac-pe', 'ac-psu', 'PE', 'psu', 'PE'),
      wire('positive', 'psu', 'V+', 'load', '+'),
      wire('return', 'load', '-', 'psu', 'V-'),
    ]);
    dcDocument.settings.v3Workflow = {
      ...(dcDocument.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-1ph-220v', label: 'AC single phase 220 V' },
    };
    const dcBuilt = await buildPrewireCircuitV3(dcDocument, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const dcResult = validatePrewireDocumentV3(dcBuilt);

    expect(dcBuilt.document.sources).toContainEqual(expect.objectContaining({
      kind: 'dc',
      id: 'psu#dc-output',
      positiveTerminal: '+24V',
      returnTerminal: '0V',
      voltage: 24,
      enabledByElementId: 'psu#ac-input',
    }));
    expect(dcResult.solution.loads.load).toMatchObject({ energized: true, state: 'ON' });

    const unpoweredDocument = workshop([source, load], [
      wire('unpowered-positive', 'psu', 'V+', 'load', '+'),
      wire('unpowered-return', 'load', '-', 'psu', 'V-'),
    ]);
    const unpoweredBuilt = await buildPrewireCircuitV3(
      unpoweredDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    const unpoweredResult = validatePrewireDocumentV3(unpoweredBuilt);
    expect(unpoweredResult.solution.loads.load.energized).toBe(false);
    expect(unpoweredResult.issues.map((entry) => entry.code)).toContain('SOURCE_CONDITION_UNMET');

    const ac = device('ac', 'boundary:ac-supply', { phaseSequence: 'L1-L2-L3' });
    const motor = device('motor', 'educational:three-phase-motor');
    const motorDocument = workshop([ac, motor], [
      wire('u', 'ac', 'L1', 'motor', 'U'),
      wire('v', 'ac', 'L2', 'motor', 'V'),
      wire('w', 'ac', 'L3', 'motor', 'W'),
      wire('pe', 'ac', 'PE', 'motor', 'PE'),
    ]);
    motorDocument.settings.v3Workflow = {
      ...(motorDocument.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-3ph-220v', label: 'AC 3 phase 220 V' },
      sourceProtection: { phaseSequence: 'L1-L2-L3' },
    };
    const motorBuilt = await buildPrewireCircuitV3(motorDocument, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const motorResult = validatePrewireDocumentV3(motorBuilt);

    expect(motorResult.solution.acLoads.motor).toMatchObject({
      energized: true,
      state: 'ON',
      connectedPhases: ['L1', 'L2', 'L3'],
    });
  });

  it('treats visible practice lamps and solenoids as + to return loads, not energized nets', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const lamp = device('lamp', 'educational:dc24-load');
    const solenoid = device('y1', 'educational:dc24-solenoid');
    const complete = workshop([dc, lamp, solenoid], [
      wire('lamp-positive', 'dc', '+', 'lamp', '+'),
      wire('lamp-return', 'lamp', '-', 'dc', '-'),
      wire('coil-positive', 'dc', '+', 'y1', 'A1'),
      wire('coil-return', 'y1', 'A2', 'dc', '-'),
    ]);
    const completeBuilt = await buildPrewireCircuitV3(complete, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const completeResult = validatePrewireDocumentV3(completeBuilt);
    expect(completeResult.solution.loads.lamp).toMatchObject({ energized: true, state: 'ON' });
    expect(completeResult.solution.loads.y1).toMatchObject({ energized: true, state: 'ON' });

    const missingReturn = workshop([dc, lamp], [
      wire('lamp-positive-only', 'dc', '+', 'lamp', '+'),
    ]);
    const missingReturnBuilt = await buildPrewireCircuitV3(
      missingReturn,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    const missingReturnResult = validatePrewireDocumentV3(missingReturnBuilt);
    expect(missingReturnResult.solution.loads.lamp).toMatchObject({
      energized: false,
      state: 'OPEN_RETURN_PATH',
    });
  });

  it('energizes a load only after both source and return conductors exist', async () => {
    const source = device('dc', 'boundary:dc-supply');
    const load = device('lamp', 'boundary:load');
    const document = workshop([source, load], [
      wire('w+', 'dc', '+', 'lamp', '+'),
      wire('w-', 'lamp', '-', 'dc', '-'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);

    expect(result.status).toBe('BLOCKED');
    expect(result.solution.loads.lamp).toMatchObject({ energized: true, state: 'ON' });
    expect(result.canIssueVerifiedPrewire).toBe(false);
  });

  it('does not create MDR DC output before the same AC source reaches L and N', async () => {
    const ac = device('ac', 'boundary:ac-supply');
    const mdr = device('ps1', 'mean-well:mdr-100-24', { orderCode: 'MDR-100-24' });
    const load = device('lamp', 'boundary:load');
    const document = workshop([ac, mdr, load], [
      wire('l-only', 'ac', 'L1', 'ps1', 'L'),
      wire('dc+', 'ps1', 'V+1', 'lamp', '+'),
      wire('dc-', 'lamp', '-', 'ps1', 'V-1'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);

    expect(built.document.sources.find((entry) => entry.id === 'ps1#internal24')).toMatchObject({
      kind: 'dc', enabledByElementId: 'ps1#ac-input',
    });
    expect(built.document.elements.find((entry) => entry.id === 'ps1#ac-input')).toMatchObject({ kind: 'ac-load' });
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((issue) => issue.code)).toContain('SOURCE_CONDITION_UNMET');
    expect(result.solution.loads.lamp.energized).toBe(false);
  });

  it('closes the MDR DC OK dry contact only after its official L-N input branch is powered', async () => {
    const ac = device('ac', 'boundary:ac-supply');
    const mdr = device('ps1', 'mean-well:mdr-100-24', { orderCode: 'MDR-100-24' });
    const poweredDocument = workshop([ac, mdr], [
      wire('line', 'ac', 'L1', 'ps1', 'L'),
      wire('neutral', 'ac', 'N', 'ps1', 'N'),
      wire('earth', 'ac', 'PE', 'ps1', 'PE'),
    ]);
    poweredDocument.settings.v3Workflow = {
      ...(poweredDocument.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-1ph-230v', label: 'AC 1 phase 230 V' },
    };
    const powered = await buildPrewireCircuitV3(poweredDocument, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const openDocument = workshop([ac, mdr], [wire('line', 'ac', 'L1', 'ps1', 'L')]);
    openDocument.settings.v3Workflow = {
      ...(openDocument.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-1ph-230v', label: 'AC 1 phase 230 V' },
    };
    const open = await buildPrewireCircuitV3(openDocument, DEVICE_PROFILES, DEVICE_PROFILES_V3);

    expect(simulateScenario(powered.document, { id: 'dc-ok' }).contactStates['ps1:powered']).toBe(true);
    expect(simulateScenario(open.document, { id: 'dc-fail' }).contactStates['ps1:powered']).toBe(false);
    expect(validatePrewireDocumentV3(powered).solution.elements['ps1#contact:powered']).toMatchObject({
      kind: 'contact',
      state: 'CLOSED',
    });
    expect(validatePrewireDocumentV3(open).solution.elements['ps1#contact:powered']).toMatchObject({
      kind: 'contact',
      state: 'OPEN',
    });
  });

  it('blocks XBF review until every channel selector and parameter range is explicit', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const xbf = device('analog', 'ls-electric:xbf-ah04a', { orderCode: 'XBF-AH04A' });
    const document = workshop([dc, xbf], [
      wire('supply-positive', 'dc', '+', 'analog', '+24V'),
      wire('supply-return', 'analog', '0V', 'dc', '-'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);

    expect(result.status).toBe('BLOCKED');
    expect(result.issues.map((issue) => issue.code)).toContain('XBF_CONFIGURATION_INCOMPLETE');
  });

  it('maps configured XBF channels to analog source/return pairs instead of DC boundary loads', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const voltageSource = device('sim-v', 'boundary:analog-voltage-source');
    const currentSource = device('sim-i', 'boundary:analog-current-source');
    const xbf = device('analog', 'ls-electric:xbf-ah04a', {
      orderCode: 'XBF-AH04A',
      xbfChannels: {
        AI0: { enabled: true, selector: 'V', parameterRange: '0-10V' },
        AI1: { enabled: true, selector: 'I', parameterRange: '4-20mA' },
        AO0: { enabled: false },
        AO1: { enabled: false },
      },
    });
    const document = workshop([dc, voltageSource, currentSource, xbf], [
      wire('supply-positive', 'dc', '+', 'analog', '+24V'),
      wire('supply-return', 'analog', '0V', 'dc', '-'),
      wire('voltage-positive', 'sim-v', '+', 'analog', 'I0+'),
      wire('voltage-return', 'analog', 'I0-', 'sim-v', '-'),
      wire('current-positive', 'sim-i', '+', 'analog', 'I1+'),
      wire('current-return', 'analog', 'I1-', 'sim-i', '-'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);
    const analogElements = built.document.elements
      .filter((element) => element.kind === 'analog-port')
      .map((element) => element.id)
      .sort();

    expect(analogElements).toEqual(['analog#AI0', 'analog#AI1', 'sim-i', 'sim-v']);
    expect(Object.values(result.solution.analogPorts).every((port) => port.connected)).toBe(true);
    expect(result.issues.map((issue) => issue.code)).not.toContain('ANALOG_SOURCE_PATH_OPEN');
    expect(result.issues.map((issue) => issue.code)).not.toContain('ANALOG_RETURN_PATH_OPEN');
    expect(built.document.branches
      .filter((branch) => branch.id.startsWith('voltage-') || branch.id.startsWith('current-'))
      .every((branch) => branch.conductor === 'signal')).toBe(true);
  });

  it.each([
    { profileId: 'generic:prox-npn-3wire', comTerminal: '+', label: 'NPN' },
    { profileId: 'generic:prox-pnp-3wire', comTerminal: '-', label: 'PNP' },
  ])('maps a powered $label sensor BK output into the XBC COM source/sink input loop', async ({
    profileId,
    comTerminal,
  }) => {
    const dc = device('dc', 'boundary:dc-supply');
    const sensor = device('sensor', profileId);
    const plc = device('plc', 'ls-electric:xbc-dr32h', { orderCode: 'XBC-DR32H' });
    const document = workshop([dc, sensor, plc], [
      wire('sensor-bn', 'dc', '+', 'sensor', 'BN'),
      wire('sensor-bu', 'sensor', 'BU', 'dc', '-'),
      wire('sensor-bk', 'sensor', 'BK', 'plc', 'P00'),
      wire('plc-com', 'dc', comTerminal, 'plc', 'COMI'),
    ]);
    document.settings.v3Workflow = {
      ...(document.settings.v3Workflow as Record<string, unknown>),
      deviceSettings: { sensor: { sensorDetected: true } },
    };

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const simulation = simulateScenario(built.document, { id: 'detect' });
    const overriddenOff = simulateScenario(built.document, {
      id: 'not-detected',
      contactStates: { 'sensor:detect': false },
    });

    expect(simulation.solution.loads['sensor#supply']).toMatchObject({ energized: true, state: 'ON' });
    expect(simulation.solution.elements['sensor#output']).toMatchObject({ state: 'OUTPUT_ON' });
    expect(simulation.solution.loads['plc#P00']).toMatchObject({ energized: true, state: 'ON' });
    expect(overriddenOff.solution.loads['plc#P00'].energized).toBe(false);
    expect(built.issues.filter((entry) =>
      entry.refs[0] === 'sensor-bk' && entry.code.startsWith('TERMINAL_'))).toEqual([]);
  });

  it('does not let BK energize an XBC input when a three-wire sensor has no BN source path', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const sensor = device('sensor', 'generic:prox-npn-3wire');
    const plc = device('plc', 'ls-electric:xbc-dr32h', { orderCode: 'XBC-DR32H' });
    const document = workshop([dc, sensor, plc], [
      wire('sensor-bu', 'sensor', 'BU', 'dc', '-'),
      wire('sensor-bk', 'sensor', 'BK', 'plc', 'P00'),
      wire('plc-com', 'dc', '+', 'plc', 'COMI'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const simulation = simulateScenario(built.document, {
      id: 'detect-unpowered',
      contactStates: { 'sensor:detect': true },
    });

    expect(simulation.solution.loads['plc#P00'].energized).toBe(false);
    expect(simulation.solution.elements['sensor#output'].state).toBe('OUTPUT_UNPOWERED');
    expect(simulation.solution.issues.map((entry) => entry.code)).toContain('TRANSISTOR_OUTPUT_UNPOWERED');
  });

  it('maps a loop-powered 2-wire boundary through an XBF 250Ω current input to the same 0V', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const transmitter = device('tx', 'boundary:two-wire-current-transmitter');
    const xbf = device('analog', 'ls-electric:xbf-ah04a', {
      orderCode: 'XBF-AH04A',
      xbfChannels: {
        AI0: { enabled: true, selector: 'I', parameterRange: '4-20mA' },
        AI1: { enabled: false },
        AO0: { enabled: false },
        AO1: { enabled: false },
      },
    });
    const document = workshop([dc, transmitter, xbf], [
      wire('module-positive', 'dc', '+', 'analog', '+24V'),
      wire('module-return', 'analog', '0V', 'dc', '-'),
      wire('loop-source', 'dc', '+', 'tx', '+'),
      wire('loop-signal', 'tx', '-', 'analog', 'I0+'),
      wire('loop-return', 'analog', 'I0-', 'dc', '-'),
    ]);
    document.settings.v3Workflow = {
      ...(document.settings.v3Workflow as Record<string, unknown>),
      deviceSettings: { tx: { currentMilliamp: 15 } },
    };

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);

    expect(result.solution.currentLoops.tx).toMatchObject({
      active: true,
      state: 'COMPLETE',
      currentA: 0.015,
      receiverVoltageV: 3.75,
      transmitterVoltageV: 20.25,
      receiverId: 'analog#AI0',
    });
    expect(result.solution.analogPorts['analog#AI0']).toMatchObject({
      connected: true,
      state: 'CONNECTED',
      peerId: 'tx',
    });
    expect(result.issues.map((entry) => entry.code)).not.toContain('ANALOG_SOURCE_PATH_OPEN');
    expect(result.issues.map((entry) => entry.code)).not.toContain('CURRENT_LOOP_RETURN_PATH_OPEN');

    const unpoweredModule = workshop([dc, transmitter, xbf], [
      wire('loop-source', 'dc', '+', 'tx', '+'),
      wire('loop-signal', 'tx', '-', 'analog', 'I0+'),
      wire('loop-return', 'analog', 'I0-', 'dc', '-'),
    ]);
    const unpoweredBuilt = await buildPrewireCircuitV3(
      unpoweredModule,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    const unpowered = validatePrewireDocumentV3(unpoweredBuilt);
    expect(unpowered.solution.currentLoops.tx.state).toBe('RECEIVER_UNPOWERED');
    expect(unpowered.issues.map((entry) => entry.code)).toContain('CURRENT_LOOP_RECEIVER_UNPOWERED');
  });

  it('blocks prewire when a saved device profile version no longer matches the active catalog', async () => {
    const mdr = device('ps1', 'mean-well:mdr-100-24', { orderCode: 'MDR-100-24' });
    mdr.profileVersion = 'stale-profile-version';
    const built = await buildPrewireCircuitV3(workshop([mdr], []), DEVICE_PROFILES, DEVICE_PROFILES_V3);

    expect(validatePrewireDocumentV3(built).issues.map((entry) => entry.code)).toContain('PROFILE_VERSION_MISMATCH');
  });

  it('prefers persisted source-protection workflow inputs over boundary-device fallbacks', async () => {
    const ac = device('ac', 'boundary:ac-supply', { prospectiveShortCircuitCurrentA: 1, protectiveDeviceCurve: 'fallback' });
    const document = workshop([ac], []);
    document.settings.v3Workflow = {
      ...(document.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-3ph-400v', label: 'AC 3 phase 400 V' },
      sourceProtection: { phaseSequence: 'L1-L3-L2', prospectiveShortCircuitCurrentA: 1250, protectiveDeviceCurve: 'C16' },
    };

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    expect(built.document.sources).toContainEqual(expect.objectContaining({
      id: 'ac', kind: 'ac-three-phase', declaredPhaseSequence: 'L1-L3-L2',
      protectionCoordination: { prospectiveShortCircuitCurrentA: 1250, protectiveDeviceCurve: 'C16' },
    }));
  });

  it('keeps electrically valid installed equipment diagnostic-only until its geometry asset is approved', async () => {
    const ac = device('ac', 'boundary:ac-supply');
    const mdr = device('ps1', 'mean-well:mdr-100-24', { orderCode: 'MDR-100-24' });
    const load = device('lamp', 'boundary:load');
    const document = workshop([ac, mdr, load], [
      wire('ac-l', 'ac', 'L1', 'ps1', 'L'),
      wire('ac-n', 'ac', 'N', 'ps1', 'N'),
      wire('ac-pe', 'ac', 'PE', 'ps1', 'PE'),
      wire('dc+', 'ps1', 'V+1', 'lamp', '+'),
      wire('dc-', 'lamp', '-', 'ps1', 'V-1'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);

    expect(result.solution.acLoads['ps1#ac-input']).toMatchObject({ energized: true, state: 'ON', sourceId: 'ac' });
    expect(result.solution.loads.lamp.energized).toBe(true);
    expect(result.status).toBe('BLOCKED');
    expect(result.issues.map((issue) => issue.code)).toContain('ASSET_GEOMETRY_UNAPPROVED');
    expect(result.canIssueVerifiedPrewire).toBe(false);
  });

  it('blocks prewire when the renderer snapshot has missing, extra, invisible, or unapproved terminal geometry', async () => {
    const ac = device('ac', 'boundary:ac-supply');
    const mdr = device('ps1', 'mean-well:mdr-100-24', {
      orderCode: 'MDR-100-24', assetId: 'approved-mdr', geometryHash: 'B'.repeat(64),
    });
    const document = workshop([ac, mdr], [
      wire('line', 'ac', 'L1', 'ps1', 'L'),
      wire('neutral', 'ac', 'N', 'ps1', 'N'),
      wire('earth', 'ac', 'PE', 'ps1', 'PE'),
    ]);
    document.settings.v3Workflow = {
      ...(document.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-1ph-230v', label: 'AC 1 phase 230 V' },
    };
    const profile = DEVICE_PROFILES_V3['mean-well:mdr-100-24'];
    const assets = approvedAssetAllowlist([{
      assetId: 'approved-mdr', model: 'MDR-100-24', view: 'front', path: 'assets/test/mdr.png', sha256: 'A'.repeat(64),
      pixelDimensions: { width: 100, height: 100 }, physicalDimensionsMm: { width: 1, height: 1, depth: 1 },
      prompt: 'test asset', generatedAt: '2026-07-09T00:00:00.000Z',
      approval: { status: 'approved', reviewer: 'test', approvedAt: '2026-07-10' }, geometryHash: 'B'.repeat(64),
      terminalCenterCalibration: {
        basis: 'manual-overlay', measuredAt: '2026-08-09T00:00:00.000Z', method: 'fixture',
        referenceDocumentId: 'manual.pdf', referencePages: [1], requiredTerminalCount: 1, sampleCount: 1,
        rmsErrorPx: 0, maxErrorPx: 0, thresholds: { rmsPx: 3, maxPx: 5 }, result: 'pass', note: 'fixture',
      },
    }]);
    const geometry = {
      snapshots: [{
        deviceId: 'ps1', profileId: profile.profileId, assetId: 'approved-mdr', geometryHash: 'B'.repeat(64),
        terminals: [
          ...profile.terminals.filter((terminal) => terminal.id !== 'L').map((terminal, index) => ({ terminalId: terminal.id, anchor: { x: index, y: index }, visible: terminal.id !== 'N' })),
          { terminalId: 'extra-terminal', anchor: { x: 99, y: 99 }, visible: true },
        ],
      }],
    };

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3, assets, geometry);
    const result = validatePrewireDocumentV3(built);

    const mismatch = result.issues.find((entry) => entry.code === 'TERMINAL_GEOMETRY_MISMATCH');
    expect(result.status).toBe('BLOCKED');
    expect(mismatch?.refs).toEqual(expect.arrayContaining(['missing:L', 'invisible:N', 'extra:extra-terminal']));
  });

  it('uses an approved renderer snapshot asset pair when legacy device configuration has no hidden asset fields', async () => {
    const mdr = device('ps1', 'mean-well:mdr-100-24', { orderCode: 'MDR-100-24' });
    const document = workshop([mdr], []);
    const profile = DEVICE_PROFILES_V3['mean-well:mdr-100-24'];
    const assets = approvedAssetAllowlist([{
      assetId: 'approved-mdr', model: 'MDR-100-24', view: 'front', path: 'assets/test/mdr.png', sha256: 'A'.repeat(64),
      pixelDimensions: { width: 100, height: 100 }, physicalDimensionsMm: { width: 1, height: 1, depth: 1 },
      prompt: 'test asset', generatedAt: '2026-07-09T00:00:00.000Z',
      approval: { status: 'approved', reviewer: 'test', approvedAt: '2026-07-10' }, geometryHash: 'B'.repeat(64),
      terminalCenterCalibration: {
        basis: 'manual-overlay', measuredAt: '2026-08-09T00:00:00.000Z', method: 'fixture',
        referenceDocumentId: 'manual.pdf', referencePages: [1], requiredTerminalCount: 1, sampleCount: 1,
        rmsErrorPx: 0, maxErrorPx: 0, thresholds: { rmsPx: 3, maxPx: 5 }, result: 'pass', note: 'fixture',
      },
    }]);
    const geometry = {
      snapshots: [{
        deviceId: 'ps1', profileId: profile.profileId, assetId: 'approved-mdr', geometryHash: 'B'.repeat(64),
        terminals: profile.terminals.map((terminal, index) => ({ terminalId: terminal.id, anchor: { x: index, y: index }, visible: true })),
      }],
    };

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3, assets, geometry);

    expect(built.issues.map((entry) => entry.code)).not.toContain('ASSET_GEOMETRY_UNAPPROVED');
    expect(built.issues.map((entry) => entry.code)).not.toContain('TERMINAL_GEOMETRY_MISMATCH');
  });

  it('maps a declared three-phase boundary without inventing protection-coordination inputs', async () => {
    const ac = device('ac', 'boundary:ac-supply', { phaseSequence: 'L1-L2-L3' });
    const document = workshop([ac], []);
    document.settings.v3Workflow = {
      ...(document.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-3ph-400v', label: 'AC 3 phase 400 V' },
    };

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);
    const result = validatePrewireDocumentV3(built);

    expect(built.document.sources).toContainEqual(expect.objectContaining({
      kind: 'ac-three-phase',
      id: 'ac',
      phaseTerminals: { L1: 'L1', L2: 'L2', L3: 'L3' },
      neutralTerminal: 'N',
      peTerminal: 'PE',
      declaredPhaseSequence: 'L1-L2-L3',
    }));
    expect(result.issues.map((entry) => entry.code)).toContain('PROTECTION_COORDINATION_BLOCKED');
  });

  it('marks only a selected mission bound load as scenario-controlled for forced-output verification', async () => {
    const source = device('dc', 'boundary:dc-supply');
    const plc = device('plc', 'ls-electric:xbc-dr32h', { orderCode: 'XBC-DR32H' });
    const load = device('load', 'boundary:load');
    const document = workshop([source, plc, load], []);
    document.settings.missionId = 'xbc-forced-relay-output';
    document.settings.roleBindings = { acSupply: 'missing-ac', dcSupply: 'dc', plc: 'plc', load: 'load' };

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);

    expect(built.document.elements.find((element) => element.id === 'load')).toMatchObject({ kind: 'load', required: 'scenario' });
  });

  it('maps the exact MC-22b coil plus three main, a-contact, and b-contact elements', async () => {
    const mc = device('km1', 'ls-electric:mc-22b-dc24-1a1b', {
      orderCode: 'MC-22b / DC24 / 1a1b',
    });
    const built = await buildPrewireCircuitV3(workshop([mc], []), DEVICE_PROFILES, DEVICE_PROFILES_V3);

    expect(built.document.elements.find((element) => element.id === 'km1#coil')).toMatchObject({
      kind: 'load', role: 'coil', positiveTerminal: 'A1', returnTerminal: 'A2', required: 'scenario',
    });
    expect(built.document.elements.filter((element) => element.kind === 'contact' && element.id.startsWith('km1#contact:')))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ stateKey: 'km1:main-L1', normally: 'open' }),
        expect.objectContaining({
          stateKey: 'km1:main-L2', normally: 'open',
          drivenBy: { elementId: 'km1#coil', mode: 'closed-when-energized' },
        }),
        expect.objectContaining({
          stateKey: 'km1:main-L3', normally: 'open',
          drivenBy: { elementId: 'km1#coil', mode: 'closed-when-energized' },
        }),
        expect.objectContaining({
          stateKey: 'km1:aux-NO', normally: 'open',
          drivenBy: { elementId: 'km1#coil', mode: 'closed-when-energized' },
        }),
        expect.objectContaining({
          stateKey: 'km1:aux-NC', normally: 'closed',
          drivenBy: { elementId: 'km1#coil', mode: 'closed-when-deenergized' },
        }),
      ]));
    expect(built.document.branches
      .filter((branch) => branch.id.startsWith('contact:km1#contact:'))
      .every((branch) => branch.conductor === 'internal')).toBe(true);
    expect(built.document.deviceInstances?.find((entry) => entry.id === 'km1')?.layoutMm).toMatchObject({
      width: 45, height: 73.5, depth: 103.6,
    });
  });

  it('energizes MY2N-D2 only through 14(+)-13(-) and transfers both changeover poles', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const relay = device('ry1', 'omron:my2n-d2-dc24', { orderCode: 'MY2N-D2 DC24V' });
    const load = device('lamp', 'boundary:load');
    const energizedDocument = workshop([dc, relay, load], [
      wire('coil-positive', 'dc', '+', 'ry1', '14'),
      wire('coil-return', 'ry1', '13', 'dc', '-'),
      wire('contact-feed', 'dc', '+', 'ry1', '9'),
      wire('no-to-load', 'ry1', '5', 'lamp', '+'),
      wire('load-return', 'lamp', '-', 'dc', '-'),
    ]);
    const energizedBuild = await buildPrewireCircuitV3(
      energizedDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    const energized = simulateScenario(energizedBuild.document, { id: 'coil-on' });

    expect(energized.converged).toBe(true);
    expect(energized.solution.loads['ry1#coil']).toMatchObject({
      energized: true,
      state: 'ON',
      voltageV: 24,
    });
    expect(energized.solution.loads['ry1#coil'].currentA).toBeCloseTo(24 / 662, 6);
    expect(energized.solution.loads.lamp.energized).toBe(true);
    expect(energized.contactStates).toMatchObject({
      'ry1:pole-1:9-1': false,
      'ry1:pole-1:9-5': true,
      'ry1:pole-2:12-4': false,
      'ry1:pole-2:12-8': true,
    });

    const deenergizedDocument = workshop([dc, relay, load], [
      wire('contact-feed', 'dc', '+', 'ry1', '9'),
      wire('nc-to-load', 'ry1', '1', 'lamp', '+'),
      wire('load-return', 'lamp', '-', 'dc', '-'),
    ]);
    const deenergizedBuild = await buildPrewireCircuitV3(
      deenergizedDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    const deenergized = simulateScenario(deenergizedBuild.document, { id: 'coil-off' });

    expect(deenergized.converged).toBe(true);
    expect(deenergized.solution.loads['ry1#coil'].energized).toBe(false);
    expect(deenergized.solution.loads.lamp.energized).toBe(true);
    expect(deenergized.contactStates).toMatchObject({
      'ry1:pole-1:9-1': true,
      'ry1:pole-1:9-5': false,
    });
  });

  it('rejects reversing the MY2N-D2 built-in diode coil', async () => {
    const dc = device('dc', 'boundary:dc-supply');
    const relay = device('ry1', 'omron:my2n-d2-dc24', { orderCode: 'MY2N-D2 DC24V' });
    const document = workshop([dc, relay], [
      wire('reversed-positive', 'dc', '+', 'ry1', '13'),
      wire('reversed-return', 'ry1', '14', 'dc', '-'),
    ]);

    const built = await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3);

    expect(built.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DC_POLARITY_MISMATCH', refs: expect.arrayContaining(['reversed-positive']) }),
      expect.objectContaining({ code: 'DC_POLARITY_MISMATCH', refs: expect.arrayContaining(['reversed-return']) }),
    ]));
  });

  it('requires EOCR fail-safe selection and maps the exact commercial reference as an AC load', async () => {
    const unresolved = device('fr1', 'schneider:eocr3de-05duh', { orderCode: 'EOCR3DE-05DUH' });
    const unresolvedDocument = workshop([unresolved], []);
    unresolvedDocument.settings.v3Workflow = {
      ...(unresolvedDocument.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-1ph-230v', label: 'AC 1 phase 230 V' },
    };
    const unresolvedBuild = await buildPrewireCircuitV3(
      unresolvedDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );
    expect(unresolvedBuild.issues.map((entry) => entry.code)).toContain('EOCR_CONFIGURATION_INCOMPLETE');

    const configured = device('fr1', 'schneider:eocr3de-05duh', {
      orderCode: 'EOCR3DE-05DUH',
      failSafeMode: true,
    });
    const configuredDocument = workshop([configured], []);
    configuredDocument.settings.v3Workflow = {
      ...(configuredDocument.settings.v3Workflow as Record<string, unknown>),
      sourceSystem: { id: 'ac-1ph-230v', label: 'AC 1 phase 230 V' },
    };
    const configuredBuild = await buildPrewireCircuitV3(
      configuredDocument,
      DEVICE_PROFILES,
      DEVICE_PROFILES_V3,
    );

    expect(configuredBuild.issues.map((entry) => entry.code)).not.toContain('EOCR_CONFIGURATION_INCOMPLETE');
    expect(configuredBuild.document.elements.find((element) => element.id === 'fr1#control-supply')).toMatchObject({
      kind: 'ac-load', lineTerminal: 'A1', neutralTerminal: 'A2',
    });
    expect(configuredBuild.document.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'contact', stateKey: 'fr1:ol-95-96', normally: 'open' }),
      expect.objectContaining({ kind: 'contact', stateKey: 'fr1:ol-97-98', normally: 'closed' }),
    ]));
  });

  it('keeps a fuse terminal as a normally closed dynamic element instead of a permanent jumper', async () => {
    const fuse = device('xf1', 'phoenix-contact:ut-4-hesi-3046032', {
      orderCode: '3046032',
      fuseLinkOrderCode: 'TEST-5X20-2A',
    });
    const built = await buildPrewireCircuitV3(workshop([fuse], []), DEVICE_PROFILES, DEVICE_PROFILES_V3);

    expect(built.issues.map((entry) => entry.code)).not.toContain('FUSE_LINK_REQUIRED');
    expect(built.issues.map((entry) => entry.code)).toContain('FUSE_LINK_PROFILE_UNVERIFIED');
    expect(built.document.elements).toContainEqual(expect.objectContaining({
      kind: 'contact', stateKey: 'xf1:fuse', normally: 'closed',
    }));
    expect(built.document.branches.some((branch) => branch.id === 'internal:xf1:1:2')).toBe(false);
    expect(built.document.terminalAssemblies?.find((entry) => entry.deviceId === 'xf1')).toMatchObject({
      manufacturer: 'Phoenix Contact',
      orderCode: '3046032',
      terminalType: 'fused',
      maximumConductorsPerTerminal: 1,
      accessories: ['fuse-link:TEST-5X20-2A'],
    });
  });

  it('blocks a 3046032 fuse terminal until the actually installed fuse link is identified', async () => {
    const fuse = device('xf1', 'phoenix-contact:ut-4-hesi-3046032', { orderCode: '3046032' });
    const built = await buildPrewireCircuitV3(workshop([fuse], []), DEVICE_PROFILES, DEVICE_PROFILES_V3);

    expect(built.issues.map((entry) => entry.code)).toContain('FUSE_LINK_REQUIRED');
    expect(built.issues.map((entry) => entry.code)).not.toContain('FUSE_LINK_PROFILE_UNVERIFIED');
  });
});
