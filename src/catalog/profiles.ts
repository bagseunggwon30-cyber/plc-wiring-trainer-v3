import type { DeviceProfile, ElectricalDomain, ElectricalPotential, TerminalRole, TerminalSpec } from '../domain/types';

const reviewed = { reviewer: 'project-manual-review', reviewedAt: '2026-07-10' };

function terminal(
  id: string,
  label: string,
  domain: ElectricalDomain,
  potential: ElectricalPotential,
  role: TerminalRole,
  extra: Partial<TerminalSpec> = {},
): TerminalSpec {
  return { id, label, domain, potential, role, ...extra };
}

const xbcInputs = Array.from({ length: 16 }, (_, index) => {
  const id = `P0${index.toString(16).toUpperCase()}`;
  return terminal(id, id, 'signal', 'signal', 'input', { comGroup: 'COMI', channel: id, ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' } });
});

const xbcOutputs = Array.from({ length: 16 }, (_, index) => {
  const id = `P2${index.toString(16).toUpperCase()}`;
  return terminal(id, id, 'floating', 'floating', 'output', { comGroup: `COM${Math.floor(index / 4)}`, channel: id });
});

function boundaryProfile(profileId: string, model: string, terminals: TerminalSpec[]): DeviceProfile {
  return {
    profileId,
    version: '1.0.0',
    manufacturer: 'Test boundary',
    model,
    evidence: { level: 'educational', documents: [], note: 'Logical test boundary; not installed equipment.' },
    boundary: true,
    includeInBom: false,
    terminals,
    internalLinks: [],
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
          pages: [43, 125, 130],
          sha256: '4C1BBB7C60CC2DC80221B67CFE7AD11CA360C9DB12B7F1B36171CF12C8BF18AA',
          notes: 'PDF pages 43, 125 and 130: AC supply/internal 24V, source-sink inputs and relay outputs.',
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
      terminal('24V', '24V', 'dc', '+24V', 'source', { ratedVoltage: { min: 24, max: 24, unit: 'VDC' } }),
      terminal('24G', '24G', 'dc', '0V', 'source', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('COMI', 'COM', 'floating', 'floating', 'common', { comGroup: 'COMI' }),
      ...xbcInputs,
      ...xbcOutputs,
      ...Array.from({ length: 4 }, (_, index) => terminal(`COM${index}`, `COM${index}`, 'floating', 'floating', 'common', { comGroup: `COM${index}` })),
      terminal('RX', 'RX', 'communication', 'signal', 'communication', { protocol: 'RS232' }),
      terminal('TX', 'TX', 'communication', 'signal', 'communication', { protocol: 'RS232' }),
      terminal('SG', 'SG', 'communication', 'signal', 'common', { protocol: 'RS232' }),
      terminal('485+', '485+', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'A' }),
      terminal('485-', '485-', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'B' }),
    ],
    internalLinks: [],
    behavior: { kind: 'plc-relay', internal24VCurrentA: 0.4, inputComGroup: 'COMI', outputGroupSize: 4 },
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
      ],
      ...reviewed,
    },
    boundary: false,
    includeInBom: true,
    terminals: [
      terminal('NC', 'NC', 'floating', 'floating', 'not-connected'),
      terminal('+24V', '+24V', 'dc', '+24V', 'supply-input', { ratedVoltage: { min: 20.4, max: 28.8, unit: 'VDC' } }),
      terminal('0V', '0V', 'dc', '0V', 'supply-input', { ratedVoltage: { min: 0, max: 0, unit: 'VDC' } }),
      terminal('I0+', 'CH0+ IN', 'signal', 'signal', 'input', { channel: 'AI0', protocol: 'analog-voltage' }),
      terminal('I0-', 'CH0- IN', 'signal', 'signal', 'common', { channel: 'AI0' }),
      terminal('I1+', 'CH1+ IN', 'signal', 'signal', 'input', { channel: 'AI1', protocol: 'analog-current' }),
      terminal('I1-', 'CH1- IN', 'signal', 'signal', 'common', { channel: 'AI1' }),
      terminal('O0+', 'CH0+ OUT', 'signal', 'signal', 'output', { channel: 'AO0', protocol: 'analog-voltage' }),
      terminal('O0-', 'CH0- OUT', 'signal', 'signal', 'common', { channel: 'AO0' }),
      terminal('O1+', 'CH1+ OUT', 'signal', 'signal', 'output', { channel: 'AO1', protocol: 'analog-current' }),
      terminal('O1-', 'CH1- OUT', 'signal', 'signal', 'common', { channel: 'AO1' }),
    ],
    internalLinks: [],
    behavior: { kind: 'analog-io', inputChannels: 2, outputChannels: 2 },
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
          notes: 'PDF pages 1-2: input/output ratings, terminal arrangement, block diagram and DC OK contact.',
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
      terminal('DCOK-A', 'DC OK', 'floating', 'floating', 'dry-contact', { comGroup: 'DCOK' }),
      terminal('DCOK-B', 'DC OK', 'floating', 'floating', 'dry-contact', { comGroup: 'DCOK' }),
    ],
    internalLinks: [
      { from: 'V+1', to: 'V+2', kind: 'conductive' },
      { from: 'V-1', to: 'V-2', kind: 'conductive' },
      { from: 'DCOK-A', to: 'DCOK-B', kind: 'dynamic-contact', stateKey: 'powered' },
    ],
    behavior: { kind: 'ac-dc-power-supply', nominalOutputVdc: 24 },
  },
  {
    profileId: 'ls-electric:sv-ig5a', version: '0.1.0', manufacturer: 'LS ELECTRIC', model: 'SV-iG5A family',
    evidence: { level: 'educational', documents: [], note: 'Full order code and supply variant are not fixed.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('24', '24', 'dc', '+24V', 'source'),
      terminal('CM', 'CM', 'floating', 'floating', 'common', { comGroup: 'digital-input' }),
      terminal('P1', 'P1 / FX', 'signal', 'signal', 'input', { channel: 'forward' }),
      terminal('P2', 'P2 / RX', 'signal', 'signal', 'input', { channel: 'reverse' }),
      terminal('S+', 'S+', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'A' }),
      terminal('S-', 'S-', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'B' }),
    ],
    internalLinks: [], behavior: { kind: 'vfd-practice' },
  },
  {
    profileId: 'generic:xy-md02', version: '0.1.0', manufacturer: 'Unverified', model: 'XY-MD02',
    evidence: { level: 'educational', documents: [], note: 'No official manufacturer evidence is recorded.' },
    boundary: false, includeInBom: true,
    terminals: [
      terminal('V+', 'V+', 'dc', '+24V', 'supply-input'),
      terminal('V-', 'V-', 'dc', '0V', 'supply-input'),
      terminal('A+', 'A+', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'A' }),
      terminal('B-', 'B-', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'B' }),
    ],
    internalLinks: [], behavior: { kind: 'modbus-practice' },
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
    terminal('A', 'A', 'floating', 'floating', 'dry-contact', { comGroup: 'contact' }),
    terminal('B', 'B', 'floating', 'floating', 'dry-contact', { comGroup: 'contact' }),
  ]),
  boundaryProfile('boundary:load', 'Load', [
    terminal('+', '+', 'floating', 'floating', 'input'),
    terminal('-', '-', 'floating', 'floating', 'common'),
  ]),
  boundaryProfile('boundary:communication-peer', 'Communication peer', [
    terminal('A', 'A/+', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'A' }),
    terminal('B', 'B/-', 'communication', 'signal', 'communication', { protocol: 'RS485', channel: 'B' }),
    terminal('SG', 'SG', 'communication', 'signal', 'common'),
  ]),
];

const dryContact = profiles.find((profile) => profile.profileId === 'boundary:dry-contact');
if (dryContact) dryContact.internalLinks.push({ from: 'A', to: 'B', kind: 'dynamic-contact', stateKey: 'contact' });

export const DEVICE_PROFILES: Readonly<Record<string, DeviceProfile>> = Object.freeze(
  Object.fromEntries(profiles.map((profile) => [profile.profileId, profile])),
);

export function verifiedProfiles(): DeviceProfile[] {
  return Object.values(DEVICE_PROFILES).filter((profile) => profile.evidence.level !== 'educational' && !profile.boundary);
}
