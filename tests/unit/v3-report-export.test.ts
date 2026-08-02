import { describe, expect, it } from 'vitest';
import {
  bomCsv,
  cableCoreScheduleCsv,
  htmlReport,
  jsonReport,
  pinToPinCsv,
  terminalPlanCsv,
  type V3ExportReport,
} from '../../src/renderer/v3/report-export';

const closedLoopReport: V3ExportReport = {
  // Compatibility input only. Exporters must derive the output class from eligibility.
  classification: 'LEGACY_DIAGNOSTIC',
  title: 'MCC <Panel>',
  eligibility: {
    engine: 'v3-closed-loop',
    eligible: true,
    status: 'PASS',
    reason: null,
  },
  sourceAssumptions: {
    sourceSystem: 'PS1 DC 24 V',
    supply: 'isolated +24V / 0V',
    earthing: 'PE_SEPARATE_0V_FLOATING',
    canvasUnitsPerMm: 2,
  },
  sourceProtection: { phaseSequence: 'L1-L2-L3', prospectiveShortCircuitCurrentA: 6000, protectiveDeviceCurve: 'C16' },
  checks: {
    supported: ['closed-loop DC path', 'PE separation'],
    unsupported: ['mains fault-current calculation'],
  },
  closedLoopPaths: [{ scenarioId: 'normal-run', sourceId: 'PS1', loadId: 'K1', status: 'ON', terminals: ['PS1:+24V', 'K1:A1', 'K1:A2', 'PS1:0V'] }],
  hashes: { document: 'doc-sha', validation: 'validation-sha', profiles: 'profiles-sha' },
  deviceSettings: [{ designation: 'PS1', profileId: 'mean-well:mdr-100-24', orderCode: 'MDR-100-24', settings: { output: '24V' } }],
  pinToPin: [{
    from: 'PS1:+24V', fromRole: 'DC + 전원', to: 'K1:A1', toRole: '코일 +',
    conductorRole: 'DC + 전원', cableId: 'CBL-01', conductorId: 'cbl-01-1', wireNumber: 'W-101', core: '1', color: 'Brown',
    crossSectionMm2: 0.75, awg: '18 AWG', lengthMm: 1200, shielded: true, drain: true, ferruleFrom: 'E7508', ferruleTo: 'E7508', lugFrom: null, lugTo: 'R1.25-4',
  }],
  cables: [{
    cableId: 'CBL-01', from: 'PS1', to: 'K1', cores: 2, cableType: 'LIYY', lengthMm: 1200, shielded: true, drainConductorId: 'cbl-01-drain', conductorIds: ['cbl-01-1', 'cbl-01-2'], description: 'Control cable',
  }],
  bom: [{ designation: 'PS1', partNumber: 'MDR-100-24', description: '24 VDC power supply', quantity: 1, manufacturer: 'Mean Well' }],
  terminals: [{ designation: 'XT1', terminal: '1', signal: '+24V', destination: 'K1:A1', terminalType: 'through', marker: '24V', accessories: ['end plate'] }],
};

describe('v3 report exports', () => {
  it('derives VERIFIED_PREWIRE from closed-loop eligibility instead of the caller classification', () => {
    const exported = JSON.parse(jsonReport(closedLoopReport));

    expect(exported.classification).toBe('VERIFIED_PREWIRE');
    expect(exported.classification).not.toBe(closedLoopReport.classification);
  });

  it('never accepts a caller-provided VERIFIED_PREWIRE without closed-loop eligibility', () => {
    const exported = JSON.parse(jsonReport({ ...closedLoopReport, classification: 'VERIFIED_PREWIRE', eligibility: undefined }));

    expect(exported.classification).toBe('LEGACY_DIAGNOSTIC');
  });

  it('emits DIAGNOSTIC for an ineligible closed-loop v3 result', () => {
    const exported = JSON.parse(jsonReport({
      ...closedLoopReport,
      classification: 'VERIFIED_PREWIRE',
      eligibility: { engine: 'v3-closed-loop', eligible: false, status: 'BLOCKED', reason: 'scope incomplete' },
    }));

    expect(exported.classification).toBe('DIAGNOSTIC');
  });

  it('includes manufacturing conductor data, assumptions, checks, paths, settings, hashes, BOM, and terminal plan in exports', () => {
    const pinToPin = pinToPinCsv(closedLoopReport);
    expect(pinToPin).toContain('From,From electrical role,To,To electrical role,Conductor electrical role,Cable');
    expect(pinToPin).toContain('PS1:+24V,DC + 전원,K1:A1,코일 +,DC + 전원,CBL-01,cbl-01-1,W-101,1,Brown,,0.75,18 AWG,1200,Yes,Yes,E7508,E7508,,R1.25-4');
    expect(cableCoreScheduleCsv(closedLoopReport)).toContain('Cable type,Length mm,Shielded,Drain conductor,Conductors');
    expect(bomCsv(closedLoopReport)).toContain('Designation,Part number,Description,Quantity,Manufacturer');
    expect(terminalPlanCsv(closedLoopReport)).toContain('Terminal type,Marker,Accessories');

    const html = htmlReport(closedLoopReport);
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
    expect(html).toContain('MCC &lt;Panel&gt;');
    expect(html).toContain('Source and earthing assumptions');
    expect(html).toContain('Closed-loop paths');
    expect(html).toContain('Supported checks');
    expect(html).toContain('Unsupported checks');
    expect(html).toContain('BOM');
    expect(html).toContain('Document hash');
    expect(html).toContain('AC protection inputs');
    expect(html).toContain('Canvas units/mm');
    expect(html).toContain('6000');
    expect(html).toContain('From electrical role');
    expect(html).toContain('Conductor electrical role');
  });

  it('neutralizes spreadsheet formulas without changing ordinary numeric negative values', () => {
    expect(pinToPinCsv({ ...closedLoopReport, pinToPin: [{ from: '=HYPERLINK("bad")', to: '+SUM(A1:A2)' }] }))
      .toContain("'=HYPERLINK");
    expect(bomCsv({ ...closedLoopReport, bom: [{ partNumber: '@cmd', description: '-formula', quantity: -1 }] }))
      .toContain("'@cmd,'-formula,-1");
  });
});
