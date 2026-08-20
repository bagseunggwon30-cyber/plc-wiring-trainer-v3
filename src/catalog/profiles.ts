import type {
  DeviceProfile,
  ElectricalDomain,
  ElectricalPotential,
  TerminalPolarity,
  TerminalRole,
  TerminalSpec,
} from '../domain/types';

const reviewed = { reviewer: 'project-manual-review', reviewedAt: '2026-07-10' };
const reviewedExact = { reviewer: 'project-manual-review', reviewedAt: '2026-07-29' };
const ut25ConnectionFacts = {
  // One terminal ID represents one physical connection point. The product
  // allows two conductors only for explicitly documented equal-section
  // combinations retained in behavior. Until conductor construction and
  // ferrule type are stored, the editor enforces the fail-closed value of one.
  maxConductors: 1,
  conductorRangeMm2: { min: 0.14, max: 4 },
  tighteningTorqueNm: { min: 0.5, max: 0.6 },
  strippingLengthMm: 9,
} satisfies Partial<TerminalSpec>;
const ut4HesiConnectionFacts = {
  maxConductors: 1,
  conductorRangeMm2: { min: 0.14, max: 6 },
  tighteningTorqueNm: { min: 0.6, max: 0.8 },
  strippingLengthMm: 9,
} satisfies Partial<TerminalSpec>;

function inferredPolarity(
  domain: ElectricalDomain,
  potential: ElectricalPotential,
  role: TerminalRole,
): TerminalPolarity {
  if (role === 'not-connected') return 'none';
  if (role === 'protective-earth' || potential === 'PE') return 'protective-earth';
  if (potential === 'L1' || potential === 'L2' || potential === 'L3') return 'line';
  if (potential === 'N') return 'neutral';
  if (potential === '+24V') return 'positive';
  if (potential === '0V') return 'return';
  if (role === 'dry-contact') return 'nonpolar';
  if (domain === 'signal' && role === 'common') return 'signal-return';
  if (domain === 'signal' && (role === 'input' || role === 'output')) return 'signal-positive';
  if (domain === 'communication' && role === 'common') return 'reference';
  return 'none';
}

function terminal(
  id: string,
  label: string,
  domain: ElectricalDomain,
  potential: ElectricalPotential,
  role: TerminalRole,
  extra: Partial<TerminalSpec> = {},
): TerminalSpec {
  return { id, label, domain, potential, role, polarity: inferredPolarity(domain, potential, role), ...extra };
}

function commonDistributionProfile(
  profileId: string,
  model: string,
  domain: ElectricalDomain,
  potential: ElectricalPotential,
): DeviceProfile {
  const terminals = Array.from({ length: 10 }, (_, index) => {
    const marker = String(index + 1);
    return [
      terminal(marker, marker, domain, potential, 'common', {
        marker, connectionPoint: 'A', channel: 'distribution', maxConductors: 1,
      }),
      terminal(`${marker}'`, marker, domain, potential, 'common', {
        marker, connectionPoint: 'B', channel: 'distribution', maxConductors: 1,
      }),
    ];
  }).flat();
  return {
    profileId,
    version: '0.1.0',
    manufacturer: 'Generic educational model',
    model,
    evidence: {
      level: 'educational',
      documents: [],
      note: 'Generic all-common distribution strip. Exact manufacturer, order code and current rating are required for prewire review.',
    },
    boundary: false,
    includeInBom: true,
    terminals,
    internalLinks: terminals.slice(1).map((entry) => ({ from: terminals[0].id, to: entry.id, kind: 'conductive' as const })),
    behavior: { kind: 'distribution-terminal-strip', potential, positions: 10, exactProductRequiredForPrewire: true },
  };
}

const xbcInputs = Array.from({ length: 16 }, (_, index) => {
  const id = `P0${index.toString(16).toUpperCase()}`;
  return terminal(id, id, 'signal', 'signal', 'input', {
    polarity: 'signal-positive',
    comGroup: 'COMI',
    channel: id,
    ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
  });
});

const xbcOutputs = Array.from({ length: 16 }, (_, index) => {
  const id = `P2${index.toString(16).toUpperCase()}`;
  return terminal(id, id, 'floating', 'floating', 'output', {
    polarity: 'nonpolar',
    commonType: 'dry-contact',
    comGroup: `COM${Math.floor(index / 4)}`,
    channel: id,
  });
});

const pd02PinRows = [
  ['B20', 'MPG A+', 'input', 'MPG-A+', 'signal-positive'], ['A20', 'MPG A-', 'input', 'MPG-A-', 'signal-return'],
  ['B19', 'MPG B+', 'input', 'MPG-B+', 'signal-positive'], ['A19', 'MPG B-', 'input', 'MPG-B-', 'signal-return'],
  ['B18', 'Y FP+', 'output', 'Y-FP+', 'signal-positive'], ['A18', 'X FP+', 'output', 'X-FP+', 'signal-positive'],
  ['B17', 'Y FP-', 'output', 'Y-FP-', 'signal-return'], ['A17', 'X FP-', 'output', 'X-FP-', 'signal-return'],
  ['B16', 'Y RP+', 'output', 'Y-RP+', 'signal-positive'], ['A16', 'X RP+', 'output', 'X-RP+', 'signal-positive'],
  ['B15', 'Y RP-', 'output', 'Y-RP-', 'signal-return'], ['A15', 'X RP-', 'output', 'X-RP-', 'signal-return'],
  ['B14', 'Y OV+', 'input', 'Y-OV+', 'signal-positive'], ['A14', 'X OV+', 'input', 'X-OV+', 'signal-positive'],
  ['B13', 'Y OV-', 'input', 'Y-OV-', 'signal-positive'], ['A13', 'X OV-', 'input', 'X-OV-', 'signal-positive'],
  ['B12', 'Y DOG', 'input', 'Y-DOG', 'signal-positive'], ['A12', 'X DOG', 'input', 'X-DOG', 'signal-positive'],
  ['B11', 'NC', 'not-connected', 'Y-NC1', 'none'], ['A11', 'NC', 'not-connected', 'X-NC1', 'none'],
  ['B10', 'NC', 'not-connected', 'Y-NC2', 'none'], ['A10', 'NC', 'not-connected', 'X-NC2', 'none'],
  ['B09', 'Y COM', 'common', 'Y-COM', 'signal-return'], ['A09', 'X COM', 'common', 'X-COM', 'signal-return'],
  ['B08', 'NC', 'not-connected', 'Y-NC3', 'none'], ['A08', 'NC', 'not-connected', 'X-NC3', 'none'],
  ['B07', 'Y INP', 'input', 'Y-INP', 'signal-positive'], ['A07', 'X INP', 'input', 'X-INP', 'signal-positive'],
  ['B06', 'Y INP COM', 'common', 'Y-INP-COM', 'signal-return'], ['A06', 'X INP COM', 'common', 'X-INP-COM', 'signal-return'],
  ['B05', 'Y CLR', 'output', 'Y-CLR', 'signal-positive'], ['A05', 'X CLR', 'output', 'X-CLR', 'signal-positive'],
  ['B04', 'Y CLR COM', 'common', 'Y-CLR-COM', 'signal-return'], ['A04', 'X CLR COM', 'common', 'X-CLR-COM', 'signal-return'],
  ['B03', 'Y HOME +5V', 'input', 'Y-HOME', 'signal-positive'], ['A03', 'X HOME +5V', 'input', 'X-HOME', 'signal-positive'],
  ['B02', 'Y HOME COM', 'common', 'Y-HOME-COM', 'signal-return'], ['A02', 'X HOME COM', 'common', 'X-HOME-COM', 'signal-return'],
  ['B01', 'NC', 'not-connected', 'Y-NC4', 'none'], ['A01', 'NC', 'not-connected', 'X-NC4', 'none'],
] as const satisfies readonly (readonly [string, string, TerminalRole, string, TerminalPolarity])[];

const pd02Terminals = pd02PinRows.map(([id, label, role, channel, polarity]) => role === 'not-connected'
  ? terminal(id, `${id} ${label}`, 'floating', 'floating', role)
  : terminal(id, `${id} ${label}`, 'signal', 'signal', role, {
      channel,
      polarity,
      ...(id === 'B03' || id === 'A03' ? { ratedVoltage: { min: 5, max: 5, unit: 'VDC' as const } } : {}),
    }));

function boundaryProfile(
  profileId: string,
  model: string,
  terminals: TerminalSpec[],
  behavior?: Record<string, unknown>,
  version = '1.0.0',
): DeviceProfile {
  return {
    profileId,
    version,
    manufacturer: 'Test boundary',
    model,
    evidence: { level: 'educational', documents: [], note: 'Logical test boundary; not installed equipment.' },
    boundary: true,
    includeInBom: false,
    terminals,
    internalLinks: [],
    ...(behavior === undefined ? {} : { behavior }),
  };
}

type XbcUOutputMode = 'sinking-transistor' | 'sourcing-transistor';

const xbcUDigitalInputs = Array.from({ length: 16 }, (_, index) => {
  const id = `P0${index.toString(16).toUpperCase()}`;
  return terminal(id, id, 'signal', 'signal', 'input', {
    polarity: 'signal-positive',
    comGroup: 'COMI',
    channel: id,
    ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
  });
});

function xbcUPositioningTerminal(column: 'A' | 'B' | 'C' | 'D', pin: number): TerminalSpec {
  const id = `${column}${String(pin).padStart(2, '0')}`;
  const axis = ({ A: 'AX1', B: 'AX2', C: 'AX3', D: 'AX4' } as const)[column];
  const nc = (): TerminalSpec => terminal(id, `${pin}${column} NC`, 'floating', 'floating', 'not-connected');

  if (pin === 20 || pin === 19) {
    if (column === 'C' || column === 'D') return nc();
    const phase = pin === 20 ? 'A' : 'B';
    const polarity = column === 'A' ? 'signal-positive' : 'signal-return';
    return terminal(id, `${pin}${column} MPG ${phase}${column === 'A' ? '+' : '-'}`, 'signal', 'signal', 'input', {
      polarity,
      channel: `MPG-${phase}`,
    });
  }

  const definitions: Readonly<Record<number, {
    label: string;
    role: TerminalRole;
    polarity: TerminalPolarity;
    group?: string;
    outputMode?: XbcUOutputMode;
  }>> = {
    18: { label: 'FP+', role: 'output', polarity: 'signal-positive' },
    17: { label: 'FP-', role: 'output', polarity: 'signal-return' },
    16: { label: 'RP+', role: 'output', polarity: 'signal-positive' },
    15: { label: 'RP-', role: 'output', polarity: 'signal-return' },
    14: { label: 'OV+', role: 'input', polarity: 'signal-positive', group: `${axis}-COM1` },
    13: { label: 'OV-', role: 'input', polarity: 'signal-positive', group: `${axis}-COM1` },
    12: { label: 'DOG', role: 'input', polarity: 'signal-positive', group: `${axis}-COM1` },
    11: { label: 'EMG/STOP', role: 'input', polarity: 'signal-positive', group: `${axis}-COM1` },
    10: { label: 'COM1', role: 'common', polarity: 'signal-return', group: `${axis}-COM1` },
    9: { label: 'DR', role: 'input', polarity: 'signal-positive', group: `${axis}-DR` },
    8: { label: 'DR COM', role: 'common', polarity: 'signal-return', group: `${axis}-DR` },
    7: { label: 'SVON', role: 'output', polarity: 'signal-return', group: `${axis}-SV`, outputMode: 'sinking-transistor' },
    6: { label: 'ARMRST', role: 'output', polarity: 'signal-return', group: `${axis}-SV`, outputMode: 'sinking-transistor' },
    5: { label: 'SVON/RST COM', role: 'common', polarity: 'signal-return', group: `${axis}-SV` },
    4: { label: 'HOME +5V', role: 'input', polarity: 'signal-positive', group: `${axis}-HOME` },
    3: { label: 'HOME COM', role: 'common', polarity: 'signal-return', group: `${axis}-HOME` },
  };
  const definition = definitions[pin];
  if (definition === undefined) return nc();
  return terminal(id, `${pin}${column} ${axis} ${definition.label}`, 'signal', 'signal', definition.role, {
    polarity: definition.polarity,
    channel: `${axis}-${definition.label}`,
    ...(definition.group === undefined ? {} : { comGroup: definition.group }),
    ...(definition.outputMode === undefined ? {} : { outputMode: definition.outputMode }),
    ...(pin === 4 ? { ratedVoltage: { min: 5, max: 5, unit: 'VDC' as const } } : {}),
  });
}

const xbcUPositioningTerminals = (['A', 'B', 'C', 'D'] as const).flatMap((column) =>
  Array.from({ length: 20 }, (_, index) => xbcUPositioningTerminal(column, 20 - index)));

function xbcUTransistorProfile(
  profileId: string,
  model: 'XBC-DN32UP' | 'XBC-DP32UP',
  outputMode: XbcUOutputMode,
): DeviceProfile {
  const isSink = outputMode === 'sinking-transistor';
  const outputs = Array.from({ length: 16 }, (_, index) => {
    const id = `P2${index.toString(16).toUpperCase()}`;
    return terminal(id, id, 'signal', 'signal', 'output', {
      polarity: isSink ? 'signal-return' : 'signal-positive',
      outputMode,
      comGroup: 'COMO',
      channel: id,
      ratedVoltage: { min: 10.2, max: 26.4, unit: 'VDC' },
    });
  });
  const outputSupply = isSink
    ? [
        terminal('VOUT', 'DC12/24V', 'dc', '+24V', 'supply-input', { ratedVoltage: { min: 10.8, max: 26.4, unit: 'VDC' } }),
        terminal('COMO', 'COM', 'dc', '0V', 'common', { polarity: 'return', comGroup: 'COMO' }),
      ]
    : [
        terminal('COMO', 'COM', 'dc', '+24V', 'common', { polarity: 'positive', comGroup: 'COMO', ratedVoltage: { min: 10.8, max: 26.4, unit: 'VDC' } }),
        terminal('0VOUT', '0V', 'dc', '0V', 'supply-input', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      ];
  return {
    profileId,
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model,
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: '10_LS_XBC_U_Installation_Guide_KR_EN.pdf',
          revision: 'C/N 10310001354 V4.5 (2024.6)',
          pages: [1],
          sha256: '1745BCB9E8FD5701FFE24D5ED61FD2E1FE2A038FF1D2224A3BCBE93842A603C4',
          notes: 'PDF page 1: 185 x 90 x 64 mm UP chassis, five power terminals, 8+10 input/output connectors, dual Ethernet and two 40-pin positioning connectors.',
        },
        {
          documentId: '10_LS_XBC_U_User_Manual_EN.pdf',
          revision: 'C/N 10310001374 V1.2 (2019.08)',
          pages: [33, 36, 48, 173, 174, 175, 392, 393, 394, 1187],
          sha256: '2928E058FD1027F936CCFD5EA949F422C90118B6FCA4CE423FF71B03B9D494D0',
          notes: 'Product classification, positioning-type front parts, 16-point input, NPN/PNP output circuits, 4-axis 40-pin connector assignment and built-in Cnet five-pin assignment.',
        },
      ],
      ...reviewedExact,
      note: 'Manual-backed terminal contract. The generated skin is not electrical evidence and remains pending pointer calibration.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('N', 'N', 'ac', 'N', 'supply-input', { phase: 'N', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('L', 'L', 'ac', 'L1', 'supply-input', { phase: 'L1', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('PE', 'PE', 'pe', 'PE', 'protective-earth'),
      terminal('24V', '24V', 'dc', '+24V', 'source', { ratedVoltage: { min: 24, max: 24, unit: 'VDC' } }),
      terminal('24G', '24G', 'dc', '0V', 'source', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('485-', '1 485-', 'communication', 'signal', 'communication', { polarity: 'data-negative', protocol: 'RS485', channel: 'B' }),
      terminal('485+', '2 485+', 'communication', 'signal', 'communication', { polarity: 'data-positive', protocol: 'RS485', channel: 'A' }),
      terminal('SG', '3 SG', 'communication', 'signal', 'common', { polarity: 'reference', commonType: 'communication-reference', protocol: 'RS485', channel: 'SG' }),
      terminal('TX', '4 TX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'TX' }),
      terminal('RX', '5 RX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'RX' }),
      ...xbcUDigitalInputs,
      terminal('COMI-A', 'COM', 'floating', 'floating', 'common', { polarity: 'configurable', commonType: 'configurable-dc', comGroup: 'COMI' }),
      terminal('COMI-B', 'COM', 'floating', 'floating', 'common', { polarity: 'configurable', commonType: 'configurable-dc', comGroup: 'COMI' }),
      ...outputs,
      ...outputSupply,
      ...xbcUPositioningTerminals,
    ],
    internalLinks: [{ from: 'COMI-A', to: 'COMI-B', kind: 'conductive' }],
    behavior: {
      kind: 'plc-transistor',
      outputMode,
      internal24VCurrentA: 0.4,
      inputComTerminals: ['COMI-A', 'COMI-B'],
      outputSupplyTerminals: isSink
        ? { positive: 'VOUT', return: 'COMO' }
        : { positive: 'COMO', return: '0VOUT' },
      inputRatings: { onVoltageV: 19, onCurrentA: 0.003, offVoltageV: 6, offCurrentA: 0.001 },
      outputRatings: { pointCurrentA: 0.5, commonCurrentA: 2, offLeakageCurrentA: 0.0001, onVoltageDropV: 0.4 },
      dimensionsMm: { width: 185, height: 90, depth: 64 },
      positioning: { axes: 4, connectorCount: 2, pinsPerConnector: 40, pulseOutput: 'differential-line-driver', maxPulseRatePps: 2_000_000 },
      communicationPorts: [{ id: 'CNET', protocol: 'RS485', positiveTerminal: '485+', negativeTerminal: '485-', terminationSetting: 'termination', defaultTermination: false }],
    },
  };
}

const xbcDn60SuOutputCommon = (index: number): string => {
  if (index < 3) return `COM${index}`;
  if (index <= 7) return 'COM3';
  return `COM${4 + Math.floor((index - 8) / 4)}`;
};

function xbcDn60SuProfile(): DeviceProfile {
  const inputs = Array.from({ length: 36 }, (_, index) => {
    const id = `P${index.toString(16).padStart(2, '0').toUpperCase()}`;
    return terminal(id, id, 'signal', 'signal', 'input', {
      polarity: 'signal-positive', comGroup: 'COM', channel: id,
      ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
    });
  });
  const outputs = Array.from({ length: 24 }, (_, index) => {
    const id = `P${(0x40 + index).toString(16).toUpperCase()}`;
    const comGroup = xbcDn60SuOutputCommon(index);
    return terminal(id, id, 'signal', 'signal', 'output', {
      polarity: 'signal-return', outputMode: 'sinking-transistor', comGroup, channel: id,
      ratedVoltage: { min: 10.2, max: 26.4, unit: 'VDC' },
    });
  });
  const outputCommons = Array.from({ length: 8 }, (_, index) => terminal(
    `COM${index}`, `COM${index}`, 'dc', '0V', 'common',
    {
      polarity: 'return', commonType: 'dc-output-common',
      outputMode: 'sinking-transistor', comGroup: `COM${index}`,
    },
  ));
  const ncTerminals = [17, 23, 29, 35].map((tb) => terminal(
    `NC-TB${tb}`, `TB${tb} NC`, 'floating', 'floating', 'not-connected', { polarity: 'none' },
  ));
  return {
    profileId: 'ls-electric:xbc-dn60su',
    version: '1.0.1',
    manufacturer: 'LS ELECTRIC',
    model: 'XBC-DN60SU',
    evidence: {
      level: 'manual-verified',
      documents: [{
        documentId: 'Manual_XBC-DN(R)xxE(SU)_10310001091_Eng_V1.7_150720.pdf',
        revision: 'C/N 10310001091 V1.7 (2015.07)',
        pages: [18, 126, 146, 314],
        sha256: '6F9EFB1193CD6EAE4F5B6C9F6A085838A3DC7D294D1D7BEEF89A5AA281C35251',
        notes: 'PDF pages 18, 126, 146 and 314: 210x90x64 mm chassis, two staggered 42-point terminal blocks, 36-point source/sink input block, 24-point sinking-transistor output block and output common groups.',
      }],
      ...reviewedExact,
      note: 'Exact terminal IDs and ratings come from the official SU manual. The generated raster is appearance-only and remains pending pointer calibration.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('L', 'AC L', 'ac', 'L1', 'supply-input', { phase: 'L1', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('N', 'AC N', 'ac', 'N', 'supply-input', { phase: 'N', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('PE', 'PE', 'pe', 'PE', 'protective-earth'),
      terminal('24V', '24V', 'dc', '+24V', 'supply-input', { ratedVoltage: { min: 10.8, max: 26.4, unit: 'VDC' } }),
      terminal('24G', '24G', 'dc', '0V', 'supply-input'),
      terminal('P', 'P (DC12/24V)', 'dc', '+24V', 'supply-input', {
        polarity: 'positive',
        ratedVoltage: { min: 10.2, max: 26.4, unit: 'VDC' },
      }),
      terminal('RX', 'RX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'RX' }),
      terminal('TX', 'TX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'TX' }),
      terminal('SG', 'SG', 'communication', 'signal', 'common', { polarity: 'reference', commonType: 'communication-reference', protocol: 'RS485', channel: 'SG' }),
      terminal('485+', '485+', 'communication', 'signal', 'communication', { polarity: 'data-positive', protocol: 'RS485', channel: 'A' }),
      terminal('485-', '485-', 'communication', 'signal', 'communication', { polarity: 'data-negative', protocol: 'RS485', channel: 'B' }),
      ...inputs,
      terminal('COM', 'INPUT COM', 'floating', 'floating', 'common', { polarity: 'configurable', commonType: 'configurable-dc', comGroup: 'COM' }),
      ...outputs,
      ...outputCommons,
      ...ncTerminals,
    ],
    internalLinks: [],
    behavior: {
      kind: 'plc-transistor', outputMode: 'sinking-transistor', inputComTerminals: ['COM'],
      outputSupplyTerminals: { positive: '24V', return: '24G' },
      outputCommonGroups: Object.fromEntries(outputs.map((entry) => [entry.id, entry.comGroup])),
      inputRatings: { onVoltageV: 19, onCurrentA: 0.003, offVoltageV: 6, offCurrentA: 0.001 },
      outputRatings: { pointCurrentA: 0.5, lowCurrentPointIds: ['P40', 'P41'], lowCurrentPointA: 0.1, commonCurrentA: 2, offLeakageCurrentA: 0.0001, onVoltageDropV: 0.4 },
      dimensionsMm: { width: 210, height: 90, depth: 64 },
      communicationPorts: [{ id: 'CNET', protocol: 'RS485', positiveTerminal: '485+', negativeTerminal: '485-', terminationSetting: 'termination', defaultTermination: false }],
    },
  };
}

function xbcDn32hProfile(): DeviceProfile {
  const inputs = Array.from({ length: 16 }, (_, index) => {
    const id = `P0${index.toString(16).toUpperCase()}`;
    return terminal(id, id, 'signal', 'signal', 'input', {
      polarity: 'signal-positive', comGroup: 'COMI', channel: id,
      ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
    });
  });
  const outputs = Array.from({ length: 16 }, (_, index) => {
    const id = `P2${index.toString(16).toUpperCase()}`;
    return terminal(id, id, 'signal', 'signal', 'output', {
      polarity: 'signal-return', outputMode: 'sinking-transistor',
      comGroup: `COM${Math.floor(index / 4)}`, channel: id,
      ratedVoltage: { min: 10.2, max: 26.4, unit: 'VDC' },
    });
  });
  const outputCommons = Array.from({ length: 4 }, (_, index) => terminal(
    `COM${index}`,
    `COM${index}`,
    'dc',
    '0V',
    'common',
    {
      polarity: 'return', commonType: 'dc-output-common',
      outputMode: 'sinking-transistor', comGroup: `COM${index}`,
    },
  ));
  return {
    profileId: 'ls-electric:xbc-dn32h',
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model: 'XBC-DN32H',
    evidence: {
      level: 'manual-verified',
      documents: [{
        documentId: '02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf',
        revision: 'XGB High-end type hardware manual repository copy',
        pages: [28, 125, 134, 135, 253],
        sha256: '4C1BBB7C60CC2DC80221B67CFE7AD11CA360C9DB12B7F1B36171CF12C8BF18AA',
        notes: 'PDF pages 28, 125, 134-135 and 253: exact DN32H classification, 16-point source/sink input block, 16-point NPN sink output block, TB1-TB24 assignment and 114x100x64 mm envelope.',
      }],
      ...reviewedExact,
      note: 'The retained official H-type manual covers both XBC-DR32H and XBC-DN32H. Output semantics intentionally differ: DN32H is four-group NPN sinking transistor output.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('L', 'L', 'ac', 'L1', 'supply-input', { phase: 'L1', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('N', 'N', 'ac', 'N', 'supply-input', { phase: 'N', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('PE', 'PE', 'pe', 'PE', 'protective-earth'),
      terminal('P', 'P DC12/24V', 'dc', '+24V', 'supply-input', { ratedVoltage: { min: 10.8, max: 26.4, unit: 'VDC' } }),
      terminal('24V', '24V', 'dc', '+24V', 'source', { ratedVoltage: { min: 24, max: 24, unit: 'VDC' } }),
      terminal('24G', '24G', 'dc', '0V', 'source', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('COMI', 'COM', 'floating', 'floating', 'common', {
        polarity: 'configurable', commonType: 'configurable-dc', comGroup: 'COMI',
      }),
      ...inputs,
      ...outputs,
      ...outputCommons,
      terminal('RX', 'RX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'RX' }),
      terminal('TX', 'TX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'TX' }),
      terminal('SG', 'SG', 'communication', 'signal', 'common', {
        polarity: 'reference', commonType: 'communication-reference', protocol: 'RS232', channel: 'SG',
      }),
      terminal('485+', '485+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'A',
      }),
      terminal('485-', '485-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'B',
      }),
    ],
    internalLinks: [],
    behavior: {
      kind: 'plc-transistor', outputMode: 'sinking-transistor', internal24VCurrentA: 0.4,
      inputComTerminals: ['COMI'],
      outputSupplyTerminals: { positive: 'P', returns: ['COM0', 'COM1', 'COM2', 'COM3'] },
      inputRatings: { onVoltageV: 19, onCurrentA: 0.003, offVoltageV: 6, offCurrentA: 0.001 },
      outputRatings: {
        generalPointCurrentA: 0.5, positioningPointCurrentA: 0.1,
        commonCurrentA: 2, offLeakageCurrentA: 0.0001, onVoltageDropV: 0.4,
      },
      dimensionsMm: { width: 114, height: 100, depth: 64 },
    },
  };
}

const profiles: DeviceProfile[] = [
  xbcUTransistorProfile('ls-electric:xbc-dn32up', 'XBC-DN32UP', 'sinking-transistor'),
  xbcUTransistorProfile('ls-electric:xbc-dp32up', 'XBC-DP32UP', 'sourcing-transistor'),
  xbcDn60SuProfile(),
  xbcDn32hProfile(),
  {
    profileId: 'ls-electric:xbc-dr32h',
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model: 'XBC-DR32H',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: '02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf',
          revision: 'repository-copy-sha256',
          pages: [39, 43, 95, 96, 125, 130, 253],
          sha256: '4C1BBB7C60CC2DC80221B67CFE7AD11CA360C9DB12B7F1B36171CF12C8BF18AA',
          notes: 'PDF pages 39, 43, 95-96, 125, 130 and 253: expansion stages, 64-point slot allocation, AC supply/internal 24V, source-sink inputs, relay outputs, and XBC-DR32H 114×100×64 mm dimensions.',
        },
      ],
      ...reviewed,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('L', 'L', 'ac', 'L1', 'supply-input', { phase: 'L1', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('N', 'N', 'ac', 'N', 'supply-input', { phase: 'N', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('PE', 'PE', 'pe', 'PE', 'protective-earth'),
      terminal('NC', 'NC', 'floating', 'floating', 'not-connected'),
      terminal('24V', '24V', 'dc', '+24V', 'source', { ratedVoltage: { min: 24, max: 24, unit: 'VDC' } }),
      terminal('24G', '24G', 'dc', '0V', 'source', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('COMI', 'COM', 'floating', 'floating', 'common', {
        polarity: 'configurable',
        commonType: 'configurable-dc',
        comGroup: 'COMI',
      }),
      ...xbcInputs,
      ...xbcOutputs,
      ...Array.from({ length: 4 }, (_, index) => terminal(
        `COM${index}`,
        `COM${index}`,
        'floating',
        'floating',
        'common',
        { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: `COM${index}` },
      )),
      terminal('RX', 'RX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'RX' }),
      terminal('TX', 'TX', 'communication', 'signal', 'communication', { protocol: 'RS232', channel: 'TX' }),
      terminal('SG', 'SG', 'communication', 'signal', 'common', {
        polarity: 'reference',
        commonType: 'communication-reference',
        protocol: 'RS232',
        channel: 'SG',
      }),
      terminal('485+', '485+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'A',
      }),
      terminal('485-', '485-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'B',
      }),
    ],
    internalLinks: [],
    behavior: {
      kind: 'plc-relay',
      internal24VCurrentA: 0.4,
      inputComGroup: 'COMI',
      outputGroupSize: 4,
      dimensionsMm: { width: 114, height: 100, depth: 64 },
    },
  },
  {
    profileId: 'ls-electric:xbl-c41a',
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model: 'XBL-C41A',
    evidence: {
      level: 'manual-verified',
      documents: [{
        documentId: '09_LS_XGB_Cnet_XBL-C41A_Manual_KR.pdf',
        revision: 'repository-copy-sha256',
        pages: [195, 196, 217],
        sha256: 'D0D9A6C360004550A4936EBA34B8165DE6445E4812E532A41BC71886682D7F16',
        notes: 'PDF pages 195-196 and 217: exact 5-pin TX+/TX-/RX+/RX-/SG assignment, RS-422/RS-485 wiring, and 20 x 90 x 60 mm dimensions.',
      }],
      ...reviewedExact,
      note: 'Terminal contract is manual-verified. Verified prewire remains blocked until rack-power behavior and approved terminal geometry are completed.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('TX+', '1 TX+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'TX+',
      }),
      terminal('TX-', '2 TX-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'TX-',
      }),
      terminal('RX+', '3 RX+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'RX+',
      }),
      terminal('RX-', '4 RX-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'RX-',
      }),
      terminal('SG', '5 SG', 'communication', 'signal', 'common', {
        polarity: 'reference', commonType: 'communication-reference', protocol: 'RS485', channel: 'SG',
      }),
    ],
    internalLinks: [],
    behavior: {
      kind: 'rack-communication-module',
      communicationPorts: [{
        id: 'CNET', protocol: 'RS485',
        positiveTerminal: 'TX+', negativeTerminal: 'TX-',
        receivePositiveTerminal: 'RX+', receiveNegativeTerminal: 'RX-',
        requiresTwoWireBridge: true,
        terminationSetting: 'termination', defaultTermination: false,
      }],
    },
  },
  {
    profileId: 'ls-electric:xbf-pd02a',
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model: 'XBF-PD02A',
    evidence: {
      level: 'manual-verified',
      documents: [{
        documentId: '08_LS_XBF-PD02A_Positioning_Manual_KR.pdf',
        revision: 'repository-copy-sha256',
        pages: [26, 29, 30],
        sha256: 'AEEDDA2002AB616A5A02B25224B3AA462A128375AF1C41392502386FA44ED3F7',
        notes: 'PDF pages 26 and 29-30: 500 mA/65 g specification, exact A01-A20/B01-B20 assignment, unused pins, differential pulse outputs, limits, DOG, INP, CLR and HOME circuits.',
      }],
      ...reviewedExact,
      note: 'The 40-pin connector is manual-verified. Motion behavior and approved connector geometry are not yet prewire-eligible.',
    },
    boundary: false,
    includeInBom: true,
    terminals: pd02Terminals,
    internalLinks: [],
    behavior: {
      kind: 'positioning-module-profile',
      axes: 2,
      pulseOutput: 'differential-line-driver',
      connector: '40-pin',
      internalCurrentMa: 500,
      weightG: 65,
      axisPins: {
        X: { forward: ['A18', 'A17'], reverse: ['A16', 'A15'], highLimit: 'A14', lowLimit: 'A13', dog: 'A12', common: 'A09', inPosition: ['A07', 'A06'], clear: ['A05', 'A04'], home: ['A03', 'A02'] },
        Y: { forward: ['B18', 'B17'], reverse: ['B16', 'B15'], highLimit: 'B14', lowLimit: 'B13', dog: 'B12', common: 'B09', inPosition: ['B07', 'B06'], clear: ['B05', 'B04'], home: ['B03', 'B02'] },
      },
    },
  },
  {
    profileId: 'ls-electric:exp2-0700d',
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model: 'eXP2-0700D',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: 'LS_XGT_Panel_eXP2_HW_Manual_EN_V1.5.pdf',
          revision: 'V1.5',
          pages: [14, 20, 21, 28, 55, 88, 89],
          sha256: '7B24C37B791224FC7744413589C853A348065C0746ED9AEE258070F99A4EBBF9',
          notes: 'Exact eXP2-0700D order code, rear connectors, DC24V/FG terminal, 7-inch electrical rating, COM1 RS485 loopback pin polarity, and power wiring requirements.',
        },
        {
          documentId: 'LS_XP_Communication_Manual_EN_V2.2.pdf',
          revision: 'V2.2',
          pages: [59, 102, 103],
          sha256: 'DAFD6867E240989A98EF6C5D3184ACEBD5947A3EB23E39150F05FD97C2399F34',
          notes: 'XGT Panel to XGB built-in Cnet RS485 wiring, two-wire TX/RX pairing, termination and shield guidance.',
        },
      ],
      ...reviewedExact,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('DC24V', 'DC24V +', 'dc', '+24V', 'supply-input', {
        ratedVoltage: { min: 19.2, max: 28.8, unit: 'VDC' },
        maxConductors: 1,
        conductorRangeMm2: { min: 1.5, max: 2.5 },
        tighteningTorqueNm: { min: 0.51, max: 0.51 },
      }),
      terminal('DC0V', 'DC24V 0V', 'dc', '0V', 'supply-input', {
        ratedVoltage: { min: 0, max: 0, unit: 'VDC' },
        maxConductors: 1,
        conductorRangeMm2: { min: 1.5, max: 2.5 },
        tighteningTorqueNm: { min: 0.51, max: 0.51 },
      }),
      // The current v2 schema has no FE discriminator. Keep the manual label
      // and record the functional/frame-ground meaning in behavior instead of
      // inventing a normal working-current return.
      terminal('FG', 'FG', 'pe', 'PE', 'protective-earth', {
        maxConductors: 1,
        conductorRangeMm2: { min: 1.5, max: 2.5 },
        tighteningTorqueNm: { min: 0.51, max: 0.51 },
      }),
      // Hardware manual PDF p55: COM1 RS485 pin 6 is the positive line and
      // pin 1 is the negative line. The former renderer had these reversed.
      terminal('COM1-1', 'COM1 pin 1 / RS485-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'B',
      }),
      terminal('COM1-6', 'COM1 pin 6 / RS485+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'A',
      }),
      terminal('COM2-2', 'COM2 pin 2 / RXD', 'communication', 'signal', 'communication', {
        polarity: 'none', protocol: 'RS232', channel: 'RX',
      }),
      terminal('COM2-3', 'COM2 pin 3 / TXD', 'communication', 'signal', 'communication', {
        polarity: 'none', protocol: 'RS232', channel: 'TX',
      }),
      terminal('COM2-5', 'COM2 pin 5 / SG', 'communication', 'signal', 'common', {
        polarity: 'reference', commonType: 'communication-reference', protocol: 'RS232', channel: 'SG',
      }),
      terminal('COM3-TX+', 'COM3 TX+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'A',
      }),
      terminal('COM3-TX-', 'COM3 TX-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'B',
      }),
      terminal('COM3-RX+', 'COM3 RX+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'A',
      }),
      terminal('COM3-RX-', 'COM3 RX-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'B',
      }),
      terminal('COM3-SG', 'COM3 SG', 'communication', 'signal', 'common', {
        polarity: 'reference', commonType: 'communication-reference', protocol: 'RS485', channel: 'SG',
      }),
      terminal('COM3-FG', 'COM3 FG', 'pe', 'PE', 'protective-earth'),
    ],
    internalLinks: [],
    behavior: {
      kind: 'dc-load-practice',
      positiveTerminal: 'DC24V',
      returnTerminal: 'DC0V',
      resistanceOhms: 96,
      onThresholdVoltage: 19.2,
      groundTerminal: { terminal: 'FG', kind: 'functional-frame-ground', notWorkingReturn: true },
      communicationPorts: [
        {
          id: 'COM1', protocol: 'RS485', positiveTerminal: 'COM1-6', negativeTerminal: 'COM1-1',
          terminationSetting: 'com1Termination', defaultTermination: true,
        },
        {
          id: 'COM3', protocol: 'RS485', positiveTerminal: 'COM3-TX+', negativeTerminal: 'COM3-TX-',
          receivePositiveTerminal: 'COM3-RX+', receiveNegativeTerminal: 'COM3-RX-',
          terminationSetting: 'com3Termination', defaultTermination: true,
        },
      ],
    },
  },
  {
    profileId: 'ls-electric:xbf-ah04a',
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model: 'XBF-AH04A',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: '03_LS_XBF-AH04A_Installation_Guide.pdf',
          revision: 'V4.4 (2022.9)',
          pages: [2],
          sha256: '36ABFD5C521E01DCB35D4032C230D4B486B4A3D447C4E8E40417D3A908E8F2E8',
          notes: 'PDF page 2: external 24V, terminal arrangement, voltage/current selection and wiring examples.',
        },
        {
          documentId: '03_LS_XGB_Analog_Manual_KR.pdf',
          revision: 'repository-copy-sha256',
          pages: [24, 33, 34, 202, 203, 204, 235, 236],
          sha256: '92BF211773DD2FA2D5C11469546C74E148059F55E53866E05022D229CF9A58AF',
          notes: 'PDF pages 24, 33-34, 202-204 and 235-236: 2AI+2AO channel wiring, voltage/current selectors, ranges, external 24 V and channel parameters.',
        },
      ],
      ...reviewed,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('NC', 'NC', 'floating', 'floating', 'not-connected'),
      terminal('+24V', '+24V', 'dc', '+24V', 'supply-input', { ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' } }),
      terminal('0V', '0V', 'dc', '0V', 'supply-input', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('I0+', 'CH0+ IN', 'signal', 'signal', 'input', { channel: 'AI0' }),
      terminal('I0-', 'CH0- IN', 'signal', 'signal', 'common', {
        polarity: 'signal-return', commonType: 'analog-reference', channel: 'AI0',
      }),
      terminal('I1+', 'CH1+ IN', 'signal', 'signal', 'input', { channel: 'AI1' }),
      terminal('I1-', 'CH1- IN', 'signal', 'signal', 'common', {
        polarity: 'signal-return', commonType: 'analog-reference', channel: 'AI1',
      }),
      terminal('O0+', 'CH0+ OUT', 'signal', 'signal', 'output', { channel: 'AO0' }),
      terminal('O0-', 'CH0- OUT', 'signal', 'signal', 'common', {
        polarity: 'signal-return', commonType: 'analog-reference', channel: 'AO0',
      }),
      terminal('O1+', 'CH1+ OUT', 'signal', 'signal', 'output', { channel: 'AO1' }),
      terminal('O1-', 'CH1- OUT', 'signal', 'signal', 'common', {
        polarity: 'signal-return', commonType: 'analog-reference', channel: 'AO1',
      }),
    ],
    internalLinks: [],
    behavior: {
      kind: 'analog-io',
      inputChannels: 2,
      outputChannels: 2,
      dimensionsMm: { width: 20, height: 90, depth: 63 },
    },
  },
  {
    profileId: 'mean-well:mdr-100-24',
    version: '1.0.0',
    manufacturer: 'MEAN WELL',
    model: 'MDR-100-24',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: '01_MDR-100-24_MeanWell_SPEC.pdf',
          revision: '2025-12-12',
          pages: [1, 2],
          sha256: '9DE6ABE926DF1D33974544D82989964E828C079F7E8B8E0448AE7667ED16E896',
          notes: 'PDF pages 1-2: input/output ratings and terminal arrangement; DC OK relay contact closes when the PSU is on/DC OK, opens on DC fail, and is rated max. 30VDC/1A resistive.',
        },
      ],
      ...reviewed,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('L', 'L', 'ac', 'L1', 'supply-input', { phase: 'L1', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('N', 'N', 'ac', 'N', 'supply-input', { phase: 'N', ratedVoltage: { min: 85, max: 264, unit: 'VAC' } }),
      terminal('PE', 'FG', 'pe', 'PE', 'protective-earth'),
      terminal('V+1', '+V', 'dc', '+24V', 'source', { ratedVoltage: { min: 24, max: 24, unit: 'VDC' } }),
      terminal('V+2', '+V', 'dc', '+24V', 'source', { ratedVoltage: { min: 24, max: 24, unit: 'VDC' } }),
      terminal('V-1', '-V', 'dc', '0V', 'source', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('V-2', '-V', 'dc', '0V', 'source', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('DCOK-A', 'DC OK', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'DCOK',
      }),
      terminal('DCOK-B', 'DC OK', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'DCOK',
      }),
    ],
    internalLinks: [
      { from: 'V+1', to: 'V+2', kind: 'conductive' },
      { from: 'V-1', to: 'V-2', kind: 'conductive' },
      { from: 'DCOK-A', to: 'DCOK-B', kind: 'dynamic-contact', stateKey: 'powered', normally: 'open' },
    ],
    behavior: {
      kind: 'ac-dc-power-supply',
      nominalOutputVdc: 24,
      dimensionsMm: { width: 55, height: 90, depth: 100 },
      dcOkContact: {
        terminals: ['DCOK-A', 'DCOK-B'],
        state: 'closed-when-dc-ok',
        maximumRating: { voltageVdc: 30, currentA: 1, load: 'resistive' },
      },
    },
  },
  {
    profileId: 'ls-electric:mc-22b-dc24-1a1b',
    version: '1.0.0',
    manufacturer: 'LS ELECTRIC',
    model: 'MC-22b',
    variant: 'DC24 coil / built-in 1a1b',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: '08_LS_Metasol_MC_Contactor_Catalog.pdf',
          revision: 'repository-copy-sha256',
          pages: [10, 18, 22, 75, 125],
          sha256: 'BE22BB71FD62046ED15BAE2CC377F3991016C3FF032ADB7AD441F76417136662',
          notes: 'PDF pages 10, 18, 22, 75 and 125: MC-22b 22AF, DC24 coil availability, A1/A2 coil terminals, built-in 1a1b, IEC NO/NC numbering, and DC 1a1b 45×73.5×103.6 mm dimensions.',
        },
      ],
      ...reviewedExact,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('1L1', '1L1', 'ac', 'floating', 'dry-contact', {
        phase: 'L1', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'main-L1',
      }),
      terminal('2T1', '2T1', 'ac', 'floating', 'dry-contact', {
        phase: 'L1', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'main-L1',
      }),
      terminal('3L2', '3L2', 'ac', 'floating', 'dry-contact', {
        phase: 'L2', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'main-L2',
      }),
      terminal('4T2', '4T2', 'ac', 'floating', 'dry-contact', {
        phase: 'L2', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'main-L2',
      }),
      terminal('5L3', '5L3', 'ac', 'floating', 'dry-contact', {
        phase: 'L3', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'main-L3',
      }),
      terminal('6T3', '6T3', 'ac', 'floating', 'dry-contact', {
        phase: 'L3', polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'main-L3',
      }),
      terminal('13', '13 (NO)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'aux-NO',
      }),
      terminal('14', '14 (NO)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'aux-NO',
      }),
      terminal('21', '21 (NC)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'aux-NC',
      }),
      terminal('22', '22 (NC)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'aux-NC',
      }),
      terminal('A1', 'A1 (+24V)', 'dc', '+24V', 'supply-input', {
        ratedVoltage: { min: 24, max: 24, unit: 'VDC' },
      }),
      terminal('A2', 'A2 (0V)', 'dc', '0V', 'common', {
        ratedVoltage: { min: 0, max: 0, unit: 'VDC' },
      }),
    ],
    internalLinks: [
      { from: '1L1', to: '2T1', kind: 'dynamic-contact', stateKey: 'main-L1', normally: 'open' },
      { from: '3L2', to: '4T2', kind: 'dynamic-contact', stateKey: 'main-L2', normally: 'open' },
      { from: '5L3', to: '6T3', kind: 'dynamic-contact', stateKey: 'main-L3', normally: 'open' },
      { from: '13', to: '14', kind: 'dynamic-contact', stateKey: 'aux-NO', normally: 'open' },
      { from: '21', to: '22', kind: 'dynamic-contact', stateKey: 'aux-NC', normally: 'closed' },
    ],
    behavior: {
      kind: 'contactor',
      coil: { positiveTerminal: 'A1', returnTerminal: 'A2', nominalVoltageVdc: 24 },
      contactStateSource: 'coil',
      frameCurrentA: 22,
      dimensionsMm: { width: 45, height: 73.5, depth: 103.6 },
    },
  },
  {
    profileId: 'omron:my2n-d2-dc24',
    version: '1.0.0',
    manufacturer: 'OMRON',
    model: 'MY2N-D2',
    variant: 'DC24V coil / built-in diode and operation indicator / DPDT',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: 'Omron_MY_Series_J219-E1.pdf',
          revision: 'J219-E1-22 0525 (0618)',
          pages: [8, 10, 20],
          sha256: '2C422A3BA468E3140CE4D3D8D716F6C11AD11A842CA1999F5E7339847170242D',
          notes: 'Official pages 8, 10 and 20: DC24V coil data, DPDT contact ratings, bottom-view pin arrangement, 13(-)/14(+) diode polarity, and de-energized contact state.',
        },
      ],
      ...reviewedExact,
      note: 'The built-in diode makes coil polarity safety-critical. Terminal 14 is +24V and terminal 13 is 0V.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('1', '1 (NC1)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'pole-1',
      }),
      terminal('5', '5 (NO1)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'pole-1',
      }),
      terminal('9', '9 (COM1)', 'floating', 'floating', 'common', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'pole-1',
      }),
      terminal('4', '4 (NC2)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'pole-2',
      }),
      terminal('8', '8 (NO2)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'pole-2',
      }),
      terminal('12', '12 (COM2)', 'floating', 'floating', 'common', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'pole-2',
      }),
      terminal('13', '13 (- / 0V)', 'dc', '0V', 'common', {
        ratedVoltage: { min: 0, max: 0, unit: 'VDC' },
      }),
      terminal('14', '14 (+24V)', 'dc', '+24V', 'supply-input', {
        ratedVoltage: { min: 24, max: 24, unit: 'VDC' },
      }),
    ],
    internalLinks: [
      { from: '9', to: '1', kind: 'dynamic-contact', stateKey: 'pole-1', normally: 'closed' },
      { from: '9', to: '5', kind: 'dynamic-contact', stateKey: 'pole-1', normally: 'open' },
      { from: '12', to: '4', kind: 'dynamic-contact', stateKey: 'pole-2', normally: 'closed' },
      { from: '12', to: '8', kind: 'dynamic-contact', stateKey: 'pole-2', normally: 'open' },
    ],
    behavior: {
      kind: 'dc-relay',
      exactOrderCode: 'MY2N-D2 DC24V',
      contactStateSource: 'coil',
      coil: {
        positiveTerminal: '14',
        returnTerminal: '13',
        nominalVoltageVdc: 24,
        mustOperateVoltageVdc: 19.2,
        maximumVoltageVdc: 26.4,
        ratedCurrentA: 0.0363,
        resistanceOhms: 662,
        powerConsumptionW: 0.9,
      },
      contacts: {
        form: 'DPDT',
        deenergizedClosed: [['9', '1'], ['12', '4']],
        energizedClosed: [['9', '5'], ['12', '8']],
        resistiveRating: { currentA: 5, voltageVac: 220, voltageVdc: 24 },
        inductiveRating: { currentA: 2, voltageVac: 220, voltageVdc: 24 },
      },
      dimensionsMm: { width: 21.5, height: 36, depth: 28 },
    },
  },
  {
    profileId: 'schneider:eocr3de-05duh',
    version: '1.0.0',
    manufacturer: 'Schneider Electric',
    model: 'EOCR3DE-05DUH',
    variant: '0.5-7A / OL+AL / AC100-240V / through bottom-hole',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: 'Schneider_EOCR_Digital_E_Instruction_2023.pdf',
          revision: 'RD22-03-001_R2_2023.01 / official download',
          pages: [1, 2],
          sha256: 'B7EFD3B57ACC65EA89656A202E1A30CE01718912FE7115FB2DBFC414507975F3',
          notes: 'Official 2023 instruction: EOCR3DE-05DUH ordering code, 0.5-7A range, D contact set (95-96 b, 97-98 a, 07-08 AL a), U AC100-240V control, H through-hole construction, terminals, wiring and dimensions.',
        },
      ],
      ...reviewedExact,
      note: 'failSafeMode must be explicitly selected because energizing the internal output relay changes the healthy 95-96/97-98 state.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('L1-IN', 'L1 CT IN', 'ac', 'L1', 'common', { phase: 'L1', polarity: 'line', channel: 'CT-L1' }),
      terminal('L1-OUT', 'L1 CT OUT', 'ac', 'L1', 'common', { phase: 'L1', polarity: 'line', channel: 'CT-L1' }),
      terminal('L2-IN', 'L2 CT IN', 'ac', 'L2', 'common', { phase: 'L2', polarity: 'line', channel: 'CT-L2' }),
      terminal('L2-OUT', 'L2 CT OUT', 'ac', 'L2', 'common', { phase: 'L2', polarity: 'line', channel: 'CT-L2' }),
      terminal('L3-IN', 'L3 CT IN', 'ac', 'L3', 'common', { phase: 'L3', polarity: 'line', channel: 'CT-L3' }),
      terminal('L3-OUT', 'L3 CT OUT', 'ac', 'L3', 'common', { phase: 'L3', polarity: 'line', channel: 'CT-L3' }),
      terminal('A1', 'A1 (AC L)', 'ac', 'L1', 'supply-input', {
        phase: 'L1', ratedVoltage: { min: 100, max: 240, unit: 'VAC' },
      }),
      terminal('A2', 'A2 (AC N)', 'ac', 'N', 'supply-input', {
        phase: 'N', ratedVoltage: { min: 100, max: 240, unit: 'VAC' },
      }),
      terminal('95', '95 (OL)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'OL-NC',
      }),
      terminal('96', '96 (OL)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'OL-NC',
      }),
      terminal('97', '97 (OL)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'OL-NO',
      }),
      terminal('98', '98 (OL)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'OL-NO',
      }),
      terminal('07', '07 (AL)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'AL',
      }),
      terminal('08', '08 (AL)', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'AL',
      }),
    ],
    internalLinks: [
      { from: 'L1-IN', to: 'L1-OUT', kind: 'conductive' },
      { from: 'L2-IN', to: 'L2-OUT', kind: 'conductive' },
      { from: 'L3-IN', to: 'L3-OUT', kind: 'conductive' },
      { from: '95', to: '96', kind: 'dynamic-contact', stateKey: 'ol-95-96', normally: 'closed' },
      { from: '97', to: '98', kind: 'dynamic-contact', stateKey: 'ol-97-98', normally: 'open' },
      { from: '07', to: '08', kind: 'dynamic-contact', stateKey: 'alert-07-08', normally: 'open' },
    ],
    behavior: {
      kind: 'electronic-overcurrent-relay',
      exactOrderCode: 'EOCR3DE-05DUH',
      currentSettingRangeA: [0.5, 7],
      controlSupply: { lineTerminal: 'A1', neutralTerminal: 'A2', voltageVac: [100, 240] },
      failSafeModeRequired: true,
      healthyFailSafeContacts: { '95-96': 'open', '97-98': 'closed' },
      healthyNonFailSafeContacts: { '95-96': 'closed', '97-98': 'open' },
      construction: 'through-bottom-hole',
      dimensionsMm: { width: 70, height: 70, depth: 106 },
    },
  },
  {
    profileId: 'phoenix-contact:ut-2.5-3044076',
    version: '1.0.0',
    manufacturer: 'Phoenix Contact',
    model: 'UT 2,5',
    variant: 'Feed-through terminal block / item 3044076',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: 'Phoenix_UT-2.5_3044076.pdf',
          revision: 'official-online-catalog-export',
          pages: [1, 2, 3, 4, 7],
          sha256: 'E3D2C7E436C3F7CB39ABC567050C4D5F1B20F41390B3F7525FAF0C3EDA240EA9',
          notes: 'Official item 3044076 data: two screw connections, one feed-through potential, 1000V/24A, conductor and torque limits, dimensions and circuit diagram.',
        },
      ],
      ...reviewedExact,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('1', '1', 'floating', 'floating', 'common', {
        marker: '1', connectionPoint: 'A',
        polarity: 'none', commonType: 'power-pass-through', channel: 'through',
        ...ut25ConnectionFacts,
      }),
      terminal('2', '1', 'floating', 'floating', 'common', {
        marker: '1', connectionPoint: 'B',
        polarity: 'none', commonType: 'power-pass-through', channel: 'through',
        ...ut25ConnectionFacts,
      }),
    ],
    internalLinks: [{ from: '1', to: '2', kind: 'conductive' }],
    behavior: {
      kind: 'terminal-block',
      terminalType: 'through',
      itemNumber: '3044076',
      nominalVoltageV: 1000,
      nominalCurrentA: 24,
      ratedCrossSectionMm2: 2.5,
      conductorRangeMm2: [0.14, 4],
      tighteningTorqueNm: [0.5, 0.6],
      strippingLengthMm: 9,
      maximumConductorsPerConnection: 1,
      conditionalTwoConductorRule: {
        sameCrossSectionRequired: true,
        rigidOrFlexibleRangeMm2: [0.14, 1.5],
        flexibleFerruleWithoutSleeveRangeMm2: [0.14, 1.5],
        twinFerruleWithSleeveRangeMm2: [0.5, 1.5],
        status: 'not-automatically-applied-without-conductor-construction-and-ferrule-type',
      },
      dimensionsMm: { width: 5.2, height: 47.7, depth: 46.9 },
    },
  },
  {
    profileId: 'phoenix-contact:ut-2.5-pe-3044092',
    version: '1.0.0',
    manufacturer: 'Phoenix Contact',
    model: 'UT 2,5-PE',
    variant: 'Protective conductor terminal block / item 3044092',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: 'Phoenix_UT-2.5-PE_3044092.pdf',
          revision: 'official-online-catalog-export',
          pages: [1, 2, 3, 5],
          sha256: '829FB44CB8003DEF4D86B1491D332A3F075DA938C1D705F0050B9A2BB896C09B',
          notes: 'Official item 3044092 data: two PE screw connections, DIN-rail protective bond, conductor and torque limits, dimensions and circuit diagram.',
        },
      ],
      ...reviewedExact,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('1', 'PE 1', 'pe', 'PE', 'protective-earth', {
        marker: 'PE 1', connectionPoint: 'A', channel: 'PE', ...ut25ConnectionFacts,
      }),
      terminal('2', 'PE 1', 'pe', 'PE', 'protective-earth', {
        marker: 'PE 1', connectionPoint: 'B', channel: 'PE', ...ut25ConnectionFacts,
      }),
    ],
    internalLinks: [{ from: '1', to: '2', kind: 'conductive' }],
    behavior: {
      kind: 'terminal-block',
      terminalType: 'pe',
      bondToDinRail: true,
      itemNumber: '3044092',
      ratedCrossSectionMm2: 2.5,
      conductorRangeMm2: [0.14, 4],
      tighteningTorqueNm: [0.5, 0.6],
      strippingLengthMm: 9,
      maximumConductorsPerConnection: 1,
      conditionalTwoConductorRule: null,
      dimensionsMm: { width: 5.2, height: 47.7, depth: 46.9 },
    },
  },
  {
    profileId: 'phoenix-contact:ut-4-hesi-3046032',
    version: '1.0.0',
    manufacturer: 'Phoenix Contact',
    model: 'UT 4-HESI (5X20)',
    variant: 'Fuse terminal block / item 3046032',
    evidence: {
      level: 'manual-verified',
      documents: [
        {
          documentId: 'Phoenix_UT-4-HESI-5x20_3046032.pdf',
          revision: 'official-online-catalog-export',
          pages: [1, 2, 3, 8],
          sha256: '82AF911117F69DDEB1232BBA5F029E237DEB4BD891FA54DBEA5043FCB734A1F5',
          notes: 'Official item 3046032 data: two screw connections, series 5x20 fuse, 500V/6.3A, conductor and torque limits, dimensions and circuit diagram; fuse-link is not supplied.',
        },
      ],
      ...reviewedExact,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('1', '1', 'floating', 'floating', 'common', {
        marker: '1', connectionPoint: 'A',
        polarity: 'none', commonType: 'fused-power', channel: 'fuse',
        ...ut4HesiConnectionFacts,
      }),
      terminal('2', '1', 'floating', 'floating', 'common', {
        marker: '1', connectionPoint: 'B',
        polarity: 'none', commonType: 'fused-power', channel: 'fuse',
        ...ut4HesiConnectionFacts,
      }),
    ],
    internalLinks: [
      { from: '1', to: '2', kind: 'dynamic-contact', stateKey: 'fuse', normally: 'closed' },
    ],
    behavior: {
      kind: 'protection',
      protectionType: 'fuse-terminal',
      terminalType: 'fused',
      itemNumber: '3046032',
      fuseType: 'G 5x20',
      fuseSupplied: false,
      nominalVoltageV: 500,
      maximumCurrentA: 6.3,
      ratedCrossSectionMm2: 4,
      conductorRangeMm2: [0.14, 6],
      tighteningTorqueNm: [0.6, 0.8],
      strippingLengthMm: 9,
      maximumConductorsPerConnection: 1,
      conditionalTwoConductorRule: {
        sameCrossSectionRequired: true,
        rigidOrFlexibleRangeMm2: [0.14, 1.5],
        flexibleFerruleWithoutSleeveRangeMm2: [0.14, 1.5],
        twinFerruleWithSleeveRangeMm2: [0.5, 1.5],
        status: 'not-automatically-applied-without-conductor-construction-and-ferrule-type',
      },
      dimensionsMm: { width: 6.2, height: 57.8, depth: 75.6 },
    },
  },
  {
    profileId: 'ls-electric:sv-ig5a', version: '0.4.0', manufacturer: 'LS ELECTRIC', model: 'SV-iG5A family',
    evidence: {
      level: 'educational',
      documents: [{
        documentId: 'LS_SV-iG5A_User_Manual_EN_V2.4.pdf',
        revision: 'V2.4 (official LS ELECTRIC download)',
        pages: [21, 26, 27],
        sha256: '974654E65A7D0B61476CA64FD180BC3E0C96DE0407A2080012DFE879A2F7A950',
        notes: 'PDF pages 21, 26 and 27 define control terminals, ratings and NPN/PNP input selection. The exact order code and supply class remain unspecified.',
      }],
      note: 'Manual-backed family semantics only. Full order code, input voltage class and motor rating are not fixed.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('R', 'R/L1', 'ac', 'L1', 'supply-input', { phase: 'L1' }),
      terminal('S', 'S/L2', 'ac', 'L2', 'supply-input', { phase: 'L2' }),
      terminal('T', 'T/L3', 'ac', 'L3', 'supply-input', { phase: 'L3' }),
      terminal('GMAIN', 'PE', 'pe', 'PE', 'protective-earth'),
      terminal('U', 'U/T1', 'ac', 'floating', 'output', { polarity: 'line', phase: 'U', channel: 'motor-output' }),
      terminal('V', 'V/T2', 'ac', 'floating', 'output', { polarity: 'line', phase: 'V', channel: 'motor-output' }),
      terminal('W', 'W/T3', 'ac', 'floating', 'output', { polarity: 'line', phase: 'W', channel: 'motor-output' }),
      terminal('GMOT', 'PE', 'pe', 'PE', 'protective-earth'),
      terminal('MO', 'MO open collector', 'signal', 'signal', 'output', {
        polarity: 'signal-return',
        channel: 'multi-function-output',
        outputMode: 'sinking-transistor',
        ratedVoltage: { min: 0, max: 26, unit: 'VDC' },
      }),
      terminal('MG', 'MG output common', 'dc', '0V', 'common', {
        commonType: 'dc-output-common',
        comGroup: 'open-collector-output',
      }),
      terminal('24', '24V output', 'dc', '+24V', 'source', {
        ratedVoltage: { min: 24, max: 24, unit: 'VDC' },
      }),
      ...Array.from({ length: 8 }, (_, index) => {
        const terminalId = `P${index + 1}`;
        const labels = ['FX', 'RX', 'BX', 'RST', 'JOG', 'Speed-L', 'Speed-M', 'Speed-H'];
        return terminal(terminalId, `${terminalId} / ${labels[index]}`, 'signal', 'signal', 'input', {
          channel: terminalId,
          comGroup: 'digital-input',
          inputLogicMode: 'configurable',
          ratedVoltage: { min: 12, max: 24, unit: 'VDC' },
        });
      }),
      terminal('CM', 'CM input/analog common', 'dc', '0V', 'common', {
        commonType: 'dc-control-common',
        comGroup: 'digital-input',
      }),
      terminal('CM2', 'CM input/analog common', 'dc', '0V', 'common', {
        commonType: 'dc-control-common',
        comGroup: 'digital-input',
      }),
      terminal('3A', '3A fault NO', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'fault-relay',
      }),
      terminal('3B', '3B fault NC', 'floating', 'floating', 'dry-contact', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'fault-relay',
      }),
      terminal('3C', '3C relay common', 'floating', 'floating', 'common', {
        polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'fault-relay',
      }),
      terminal('VR', 'VR potentiometer supply', 'signal', 'signal', 'source', {
        polarity: 'signal-positive',
        channel: 'analog-reference-supply',
        protocol: 'analog-voltage',
        ratedVoltage: { min: 12, max: 12, unit: 'VDC' },
      }),
      terminal('V1', 'V1 voltage input', 'signal', 'signal', 'input', {
        channel: 'analog-voltage-input',
        protocol: 'analog-voltage',
        ratedVoltage: { min: -10, max: 10, unit: 'VDC' },
      }),
      terminal('I', 'I current input', 'signal', 'signal', 'input', {
        channel: 'analog-current-input', protocol: 'analog-current',
      }),
      terminal('AM', 'AM analog output', 'signal', 'signal', 'output', {
        channel: 'analog-monitor-output', protocol: 'analog-voltage',
      }),
      terminal('S+', 'S+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'A',
      }),
      terminal('S-', 'S-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'B',
      }),
    ],
    internalLinks: [
      { from: 'CM', to: 'CM2', kind: 'conductive' },
      { from: '3C', to: '3A', kind: 'dynamic-contact', stateKey: 'fault', normally: 'open' },
      { from: '3C', to: '3B', kind: 'dynamic-contact', stateKey: 'fault', normally: 'closed' },
    ],
    behavior: {
      kind: 'vfd-practice',
      inputSelection: 'NPN/PNP switch S8',
      openCollector: { output: 'MO', common: 'MG', mode: 'sinking-transistor' },
      controlCommon: {
        terminals: ['CM', 'CM2'],
        potential: '0V',
        functions: ['multi-function-input-common', 'analog-reference'],
      },
      analogReferenceTerminal: 'CM',
      analogReferenceSupply: { terminal: 'VR', voltageVdc: 12, requiresPotentiometerOrRatedReceiver: true },
      motorOutput: { phases: { U: 'U', V: 'V', W: 'W' }, mustRemainSeparateFromInput: ['R', 'S', 'T'] },
      exactOrderCodeRequiredForPrewire: true,
    },
  },
  {
    profileId: 'generic:xy-md02', version: '0.1.0', manufacturer: 'Unverified', model: 'XY-MD02',
    evidence: { level: 'educational', documents: [], note: 'No official manufacturer evidence is recorded.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('V+', 'V+', 'dc', '+24V', 'supply-input'),
      terminal('V-', 'V-', 'dc', '0V', 'supply-input'),
      terminal('A+', 'A+', 'communication', 'signal', 'communication', {
        polarity: 'data-positive', protocol: 'RS485', channel: 'A',
      }),
      terminal('B-', 'B-', 'communication', 'signal', 'communication', {
        polarity: 'data-negative', protocol: 'RS485', channel: 'B',
      }),
    ],
    internalLinks: [],
    behavior: {
      kind: 'modbus-practice',
      positiveTerminal: 'V+',
      returnTerminal: 'V-',
      // Educational assumption only. The product identity and official manual
      // remain unknown, so this never qualifies for verified prewire review.
      onThresholdVoltage: 5,
      assumedCurrentA: 0.02,
      communicationPorts: [
        { id: 'RS485', protocol: 'RS485', positiveTerminal: 'A+', negativeTerminal: 'B-' },
      ],
    },
  },
  {
    profileId: 'generic:prox-npn-3wire',
    version: '0.1.0',
    manufacturer: 'Generic educational model',
    model: '3-wire proximity sensor (NPN NO)',
    evidence: {
      level: 'educational',
      documents: [],
      note: 'Generic IEC-style BN/BU/BK training model. Select an exact manufacturer and order code before prewire use.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('BN', 'BN brown +24V', 'dc', '+24V', 'supply-input', {
        ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
      }),
      terminal('BU', 'BU blue 0V', 'dc', '0V', 'supply-input', {
        ratedVoltage: { min: 0, max: 0, unit: 'VDC' },
      }),
      terminal('BK', 'BK black NPN output', 'signal', 'signal', 'output', {
        polarity: 'signal-return',
        channel: 'OUT',
        outputMode: 'sinking-transistor',
        ratedVoltage: { min: 0, max: 30, unit: 'VDC' },
      }),
    ],
    internalLinks: [],
    behavior: {
      kind: 'three-wire-sensor',
      outputMode: 'sinking-transistor',
      supplyPositiveTerminal: 'BN',
      supplyReturnTerminal: 'BU',
      outputTerminal: 'BK',
      stateKey: 'detect',
      assumedSupplyCurrentA: 0.01,
    },
  },
  {
    profileId: 'generic:prox-pnp-3wire',
    version: '0.1.0',
    manufacturer: 'Generic educational model',
    model: '3-wire proximity sensor (PNP NO)',
    evidence: {
      level: 'educational',
      documents: [],
      note: 'Generic IEC-style BN/BU/BK training model. Select an exact manufacturer and order code before prewire use.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('BN', 'BN brown +24V', 'dc', '+24V', 'supply-input', {
        ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' },
      }),
      terminal('BU', 'BU blue 0V', 'dc', '0V', 'supply-input', {
        ratedVoltage: { min: 0, max: 0, unit: 'VDC' },
      }),
      terminal('BK', 'BK black PNP output', 'signal', 'signal', 'output', {
        polarity: 'signal-positive',
        channel: 'OUT',
        outputMode: 'sourcing-transistor',
        ratedVoltage: { min: 0, max: 30, unit: 'VDC' },
      }),
    ],
    internalLinks: [],
    behavior: {
      kind: 'three-wire-sensor',
      outputMode: 'sourcing-transistor',
      supplyPositiveTerminal: 'BN',
      supplyReturnTerminal: 'BU',
      outputTerminal: 'BK',
      stateKey: 'detect',
      assumedSupplyCurrentA: 0.01,
    },
  },
  {
    profileId: 'educational:dc24-source-box',
    version: '0.2.0',
    manufacturer: 'Generic educational model',
    model: 'DC 24 V source box',
    evidence: {
      level: 'educational',
      documents: [],
      note: 'Generic drawing source with no exact manufacturer, input circuit, rating or protection data. Practice use only.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('L', 'AC L input', 'ac', 'L1', 'supply-input', { phase: 'L1' }),
      terminal('N', 'AC N input', 'ac', 'N', 'supply-input', { phase: 'N' }),
      terminal('V+', '+24V output', 'dc', '+24V', 'source'),
      terminal('V-', '0V return', 'dc', '0V', 'source'),
      terminal('PE', 'PE', 'pe', 'PE', 'protective-earth'),
    ],
    internalLinks: [],
    behavior: {
      kind: 'ac-dc-power-supply-practice',
      voltageVdc: 24,
      lineTerminal: 'L',
      neutralTerminal: 'N',
      peTerminal: 'PE',
      positiveTerminal: 'V+',
      returnTerminal: 'V-',
      exactProductRequiredForPrewire: true,
    },
  },
  {
    profileId: 'educational:three-phase-motor',
    version: '0.1.0',
    manufacturer: 'Generic educational model',
    model: 'Three-phase induction motor',
    evidence: {
      level: 'educational',
      documents: [],
      note: 'Generic U/V/W/PE motor boundary. Nameplate voltage, current, winding and exact order code are required for prewire use.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('U', 'U', 'ac', 'floating', 'input', {
        polarity: 'line', phase: 'U', channel: 'motor-input',
      }),
      terminal('V', 'V', 'ac', 'floating', 'input', {
        polarity: 'line', phase: 'V', channel: 'motor-input',
      }),
      terminal('W', 'W', 'ac', 'floating', 'input', {
        polarity: 'line', phase: 'W', channel: 'motor-input',
      }),
      terminal('PE', 'PE', 'pe', 'PE', 'protective-earth'),
    ],
    internalLinks: [],
    behavior: {
      kind: 'three-phase-motor-practice',
      phaseTerminals: { L1: 'U', L2: 'V', L3: 'W' },
      peTerminal: 'PE',
      exactProductRequiredForPrewire: true,
    },
  },
  {
    profileId: 'educational:dc24-load',
    version: '0.1.0',
    manufacturer: 'Generic educational model',
    model: 'DC 24 V polarity-sensitive load',
    evidence: {
      level: 'educational',
      documents: [],
      note: 'Generic lamp/buzzer practice load. Exact voltage, current, suppression and order code are not fixed.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('+', '+24V load input', 'dc', '+24V', 'input'),
      terminal('-', '0V load return', 'dc', '0V', 'common'),
    ],
    internalLinks: [],
    behavior: {
      kind: 'dc-load-practice',
      positiveTerminal: '+',
      returnTerminal: '-',
      onThresholdVoltage: 20.4,
      exactProductRequiredForPrewire: true,
    },
  },
  {
    profileId: 'educational:dc24-solenoid',
    version: '0.1.0',
    manufacturer: 'Generic educational model',
    model: 'DC 24 V solenoid coil',
    evidence: {
      level: 'educational',
      documents: [],
      note: 'Generic polarity-sensitive solenoid practice coil. Exact coil suffix, current and suppression device are not fixed.',
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('A1', 'A1 +24V', 'dc', '+24V', 'input'),
      terminal('A2', 'A2 0V', 'dc', '0V', 'common'),
    ],
    internalLinks: [],
    behavior: {
      kind: 'dc-load-practice',
      positiveTerminal: 'A1',
      returnTerminal: 'A2',
      onThresholdVoltage: 20.4,
      exactProductRequiredForPrewire: true,
    },
  },
  {
    profileId: 'educational:mccb-2p', version: '0.1.0', manufacturer: 'Generic educational model', model: 'MCCB 2P L/N',
    evidence: { level: 'educational', documents: [], note: 'Generic 2-pole breaker model. Exact manufacturer, order code, rating and trip curve are required for prewire review.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('L', 'L line', 'ac', 'L1', 'supply-input', { phase: 'L1' }),
      terminal('N', 'N line', 'ac', 'N', 'supply-input', { phase: 'N' }),
      terminal("L'", 'L load', 'ac', 'L1', 'output', { phase: 'L1' }),
      terminal("N'", 'N load', 'ac', 'N', 'output', { phase: 'N' }),
    ],
    internalLinks: [
      { from: 'L', to: "L'", kind: 'dynamic-contact', stateKey: 'closed', normally: 'closed' },
      { from: 'N', to: "N'", kind: 'dynamic-contact', stateKey: 'closed', normally: 'closed' },
    ],
    behavior: { kind: 'protection', protectionType: 'mccb-2p', poles: 2, exactProductRequiredForPrewire: true },
  },
  {
    profileId: 'educational:mccb-3p', version: '0.1.0', manufacturer: 'Generic educational model', model: 'MCCB 3P',
    evidence: { level: 'educational', documents: [], note: 'Generic 3-pole breaker model. Exact manufacturer, order code, rating and trip curve are required for prewire review.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('L1', 'L1 line', 'ac', 'L1', 'supply-input', { phase: 'L1' }),
      terminal('L2', 'L2 line', 'ac', 'L2', 'supply-input', { phase: 'L2' }),
      terminal('L3', 'L3 line', 'ac', 'L3', 'supply-input', { phase: 'L3' }),
      terminal('T1', 'T1 load', 'ac', 'L1', 'output', { phase: 'L1' }),
      terminal('T2', 'T2 load', 'ac', 'L2', 'output', { phase: 'L2' }),
      terminal('T3', 'T3 load', 'ac', 'L3', 'output', { phase: 'L3' }),
    ],
    internalLinks: [
      { from: 'L1', to: 'T1', kind: 'dynamic-contact', stateKey: 'closed', normally: 'closed' },
      { from: 'L2', to: 'T2', kind: 'dynamic-contact', stateKey: 'closed', normally: 'closed' },
      { from: 'L3', to: 'T3', kind: 'dynamic-contact', stateKey: 'closed', normally: 'closed' },
    ],
    behavior: { kind: 'protection', protectionType: 'mccb-3p', poles: 3, exactProductRequiredForPrewire: true },
  },
  {
    profileId: 'educational:pushbutton-no', version: '0.1.0', manufacturer: 'Generic educational model', model: 'Pushbutton NO',
    evidence: { level: 'educational', documents: [], note: 'Generic a-contact pushbutton. Exact operator and contact-block order codes are required for prewire review.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('13', '13', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'contact' }),
      terminal('14', '14', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'contact' }),
    ],
    internalLinks: [{ from: '13', to: '14', kind: 'dynamic-contact', stateKey: 'contact', normally: 'open' }],
    behavior: { kind: 'manual-contact', contactType: 'NO', stateKey: 'contact', exactProductRequiredForPrewire: true },
  },
  {
    profileId: 'educational:pushbutton-nc', version: '0.1.0', manufacturer: 'Generic educational model', model: 'Pushbutton NC',
    evidence: { level: 'educational', documents: [], note: 'Generic b-contact pushbutton. Exact operator and contact-block order codes are required for prewire review.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('21', '21', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'contact' }),
      terminal('22', '22', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'contact' }),
    ],
    internalLinks: [{ from: '21', to: '22', kind: 'dynamic-contact', stateKey: 'contact', normally: 'closed' }],
    behavior: { kind: 'manual-contact', contactType: 'NC', stateKey: 'contact', exactProductRequiredForPrewire: true },
  },
  {
    profileId: 'educational:emergency-stop-nc2', version: '0.1.0', manufacturer: 'Generic educational model', model: 'Emergency stop NC x2',
    evidence: { level: 'educational', documents: [], note: 'Generic dual-NC emergency-stop model. Safety category, positive-opening contact block and exact order codes are not verified.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('11', '11', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'NC1' }),
      terminal('12', '12', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'NC1' }),
      terminal('21', '21', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'NC2' }),
      terminal('22', '22', 'floating', 'floating', 'dry-contact', { polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'NC2' }),
    ],
    internalLinks: [
      { from: '11', to: '12', kind: 'dynamic-contact', stateKey: 'contact-1', normally: 'closed' },
      { from: '21', to: '22', kind: 'dynamic-contact', stateKey: 'contact-2', normally: 'closed' },
    ],
    behavior: { kind: 'manual-contact', contactType: 'NC2', stateKeys: ['contact-1', 'contact-2'], exactProductRequiredForPrewire: true },
  },
  commonDistributionProfile('educational:distribution-24v-10', '+24V distribution 10P', 'dc', '+24V'),
  commonDistributionProfile('educational:distribution-0v-10', '0V distribution 10P', 'dc', '0V'),
  commonDistributionProfile('educational:distribution-pe-10', 'PE distribution 10P', 'pe', 'PE'),
  {
    profileId: 'educational:terminal-block-4', version: '0.1.0', manufacturer: 'Generic', model: '4-position terminal block',
    evidence: { level: 'educational', documents: [], note: 'Generic practice terminal block; exact product is not fixed.' },
    boundary: false, includeInBom: true,
    terminals: Array.from({ length: 4 }, (_, index) => {
      const id = String(index + 1);
      return [
        terminal(id, id, 'floating', 'floating', 'common', {
          marker: id, connectionPoint: 'A', channel: id,
        }),
        terminal(`${id}'`, id, 'floating', 'floating', 'common', {
          marker: id, connectionPoint: 'B', channel: id,
        }),
      ];
    }).flat(),
    internalLinks: Array.from({ length: 4 }, (_, index) => {
      const id = String(index + 1);
      return { from: id, to: `${id}'`, kind: 'conductive' as const };
    }),
  },
  {
    profileId: 'educational:terminal-block-10', version: '0.1.0', manufacturer: 'Generic', model: '10-position terminal block',
    evidence: { level: 'educational', documents: [], note: 'Generic practice terminal block; exact product is not fixed.' },
    boundary: false, includeInBom: true,
    terminals: Array.from({ length: 10 }, (_, index) => {
      const id = String(index + 1);
      return [
        terminal(id, id, 'floating', 'floating', 'common', {
          marker: id, connectionPoint: 'A', channel: id,
        }),
        terminal(`${id}'`, id, 'floating', 'floating', 'common', {
          marker: id, connectionPoint: 'B', channel: id,
        }),
      ];
    }).flat(),
    internalLinks: Array.from({ length: 10 }, (_, index) => {
      const id = String(index + 1);
      return { from: id, to: `${id}'`, kind: 'conductive' as const };
    }),
  },
  boundaryProfile('boundary:ac-supply', 'AC supply', [
    terminal('L1', 'L1', 'ac', 'L1', 'source', { phase: 'L1' }),
    terminal('L2', 'L2', 'ac', 'L2', 'source', { phase: 'L2' }),
    terminal('L3', 'L3', 'ac', 'L3', 'source', { phase: 'L3' }),
    terminal('N', 'N', 'ac', 'N', 'source', { phase: 'N' }),
    terminal('PE', 'PE', 'pe', 'PE', 'source'),
  ]),
  boundaryProfile('boundary:dc-supply', 'DC supply', [
    terminal('+', '+V', 'dc', '+24V', 'source'),
    terminal('-', '0V', 'dc', '0V', 'source'),
  ]),
  boundaryProfile('boundary:dry-contact', 'Dry contact', [
    terminal('A', 'A', 'floating', 'floating', 'dry-contact', {
      polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'contact',
    }),
    terminal('B', 'B', 'floating', 'floating', 'dry-contact', {
      polarity: 'nonpolar', commonType: 'dry-contact', comGroup: 'contact',
    }),
  ]),
  boundaryProfile('boundary:load', 'Load', [
    terminal('+', '+', 'floating', 'floating', 'input', { polarity: 'positive' }),
    terminal('-', '-', 'floating', 'floating', 'common', { polarity: 'return' }),
  ]),
  boundaryProfile('boundary:analog-voltage-source', 'Analog voltage source', [
    terminal('+', 'V+', 'signal', 'signal', 'output', {
      polarity: 'signal-positive', protocol: 'analog-voltage', channel: 'SOURCE',
    }),
    terminal('-', 'V−/G', 'signal', 'signal', 'common', {
      polarity: 'signal-return', commonType: 'analog-reference',
      protocol: 'analog-voltage', channel: 'SOURCE',
    }),
  ], { kind: 'analog-boundary', protocol: 'analog-voltage', direction: 'source' }),
  boundaryProfile('boundary:analog-current-source', 'Analog current source', [
    terminal('+', 'I+', 'signal', 'signal', 'output', {
      polarity: 'signal-positive', protocol: 'analog-current', channel: 'SOURCE',
    }),
    terminal('-', 'I−/G', 'signal', 'signal', 'common', {
      polarity: 'signal-return', commonType: 'analog-reference',
      protocol: 'analog-current', channel: 'SOURCE',
    }),
  ], { kind: 'analog-boundary', protocol: 'analog-current', direction: 'source' }),
  boundaryProfile('boundary:analog-voltage-input', 'Analog voltage receiver', [
    terminal('+', 'V+', 'signal', 'signal', 'input', {
      polarity: 'signal-positive', protocol: 'analog-voltage', channel: 'RECEIVER',
    }),
    terminal('-', 'V−/G', 'signal', 'signal', 'common', {
      polarity: 'signal-return', commonType: 'analog-reference',
      protocol: 'analog-voltage', channel: 'RECEIVER',
    }),
  ], { kind: 'analog-boundary', protocol: 'analog-voltage', direction: 'sink' }),
  boundaryProfile('boundary:analog-current-input', 'Analog current receiver', [
    terminal('+', 'I+', 'signal', 'signal', 'input', {
      polarity: 'signal-positive', protocol: 'analog-current', channel: 'RECEIVER',
    }),
    terminal('-', 'I−/G', 'signal', 'signal', 'common', {
      polarity: 'signal-return', commonType: 'analog-reference',
      protocol: 'analog-current', channel: 'RECEIVER',
    }),
  ], { kind: 'analog-boundary', protocol: 'analog-current', direction: 'sink' }),
  boundaryProfile('boundary:two-wire-current-transmitter', 'Loop-powered 2-wire current transmitter', [
    terminal('+', 'TX+ / +24V', 'dc', '+24V', 'supply-input', {
      ratedVoltage: { min: 12, max: 30, unit: 'VDC' },
    }),
    terminal('-', 'TX− / 4–20mA OUT', 'signal', 'signal', 'output', {
      polarity: 'signal-positive', protocol: 'analog-current', channel: 'LOOP',
    }),
  ], {
    kind: 'two-wire-current-transmitter',
    currentA: 0.012,
    minimumOperatingVoltageV: 12,
    maximumLoopVoltageV: 30,
  }),
  boundaryProfile('boundary:communication-peer', 'Communication peer', [
    terminal('A', 'A/+', 'communication', 'signal', 'communication', {
      polarity: 'data-positive', protocol: 'RS485', channel: 'A',
    }),
    terminal('B', 'B/-', 'communication', 'signal', 'communication', {
      polarity: 'data-negative', protocol: 'RS485', channel: 'B',
    }),
    terminal('SG', 'SG', 'communication', 'signal', 'common', {
      polarity: 'reference', commonType: 'communication-reference', protocol: 'RS485',
    }),
  ], {
    kind: 'communication-boundary',
    communicationPorts: [{
      id: 'RS485', protocol: 'RS485', positiveTerminal: 'A', negativeTerminal: 'B',
      terminationSetting: 'termination', defaultTermination: false,
    }],
  }, '1.2.0'),
];

const dryContact = profiles.find((profile) => profile.profileId === 'boundary:dry-contact');
if (dryContact) dryContact.internalLinks.push({ from: 'A', to: 'B', kind: 'dynamic-contact', stateKey: 'contact' });

export const DEVICE_PROFILES: Readonly<Record<string, DeviceProfile>> = Object.freeze(
  Object.fromEntries(profiles.map((profile) => [profile.profileId, profile])),
);

export function verifiedProfiles(): DeviceProfile[] {
  return Object.values(DEVICE_PROFILES).filter((profile) => profile.evidence.level !== 'educational' && !profile.boundary);
}
