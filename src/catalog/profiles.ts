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

const profiles: DeviceProfile[] = [
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
          pages: [43, 125, 130, 253],
          sha256: '4C1BBB7C60CC2DC80221B67CFE7AD11CA360C9DB12B7F1B36171CF12C8BF18AA',
          notes: 'PDF pages 43, 125, 130 and 253: AC supply/internal 24V, source-sink inputs, relay outputs, and XBC-DR32H 114×100×64 mm dimensions.',
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
        polarity: 'none', commonType: 'power-pass-through', channel: 'through',
        ...ut25ConnectionFacts,
      }),
      terminal('2', '2', 'floating', 'floating', 'common', {
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
      terminal('1', 'PE 1', 'pe', 'PE', 'protective-earth', { channel: 'PE', ...ut25ConnectionFacts }),
      terminal('2', 'PE 2', 'pe', 'PE', 'protective-earth', { channel: 'PE', ...ut25ConnectionFacts }),
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
      terminal('1', 'IN', 'floating', 'floating', 'common', {
        polarity: 'none', commonType: 'fused-power', channel: 'fuse',
        ...ut4HesiConnectionFacts,
      }),
      terminal('2', 'OUT', 'floating', 'floating', 'common', {
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
        documentId: '04_LS_SV-iG5A_User_Manual.pdf',
        revision: '9th Edition (2009-07)',
        pages: [19, 24, 25],
        sha256: '2800AD2B47AA3E5058C49ED1684839EC644F2E0E1CB7F91542C453E2458A500E',
        notes: 'PDF pages 19, 24 and 25 define control terminals, ratings and NPN/PNP input selection. The exact order code and supply class remain unspecified.',
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
    profileId: 'educational:terminal-block-4', version: '0.1.0', manufacturer: 'Generic', model: '4-position terminal block',
    evidence: { level: 'educational', documents: [], note: 'Generic practice terminal block; exact product is not fixed.' },
    boundary: false, includeInBom: true,
    terminals: Array.from({ length: 4 }, (_, index) => {
      const id = String(index + 1);
      return [
        terminal(id, id, 'floating', 'floating', 'common', { channel: id }),
        terminal(`${id}'`, `${id}'`, 'floating', 'floating', 'common', { channel: id }),
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
        terminal(id, id, 'floating', 'floating', 'common', { channel: id }),
        terminal(`${id}'`, `${id}'`, 'floating', 'floating', 'common', { channel: id }),
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
  ], undefined, '1.1.0'),
];

const dryContact = profiles.find((profile) => profile.profileId === 'boundary:dry-contact');
if (dryContact) dryContact.internalLinks.push({ from: 'A', to: 'B', kind: 'dynamic-contact', stateKey: 'contact' });

export const DEVICE_PROFILES: Readonly<Record<string, DeviceProfile>> = Object.freeze(
  Object.fromEntries(profiles.map((profile) => [profile.profileId, profile])),
);

export function verifiedProfiles(): DeviceProfile[] {
  return Object.values(DEVICE_PROFILES).filter((profile) => profile.evidence.level !== 'educational' && !profile.boundary);
}
