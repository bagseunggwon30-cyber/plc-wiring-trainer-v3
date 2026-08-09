import { describe, expect, it } from 'vitest';
import {
  applyV3WorkflowState,
  createV3WorkflowState,
  reportClassLabel,
  validateV3WorkflowState,
  type V3WorkflowState,
} from '../../src/renderer/v3/workflow-state';
import {
  cableCoreScheduleCsv,
  htmlReport,
  jsonReport,
  pinToPinCsv,
  terminalPlanCsv,
} from '../../src/renderer/v3/report-export';
import { createV3ValidationPort } from '../../src/renderer/v3/validation-port';

describe('v3 workflow state', () => {
  it('requires an explicit source system and populated review scope before validation', () => {
    const state = createV3WorkflowState({});

    expect(validateV3WorkflowState(state).map((issue) => issue.code)).toEqual([
      'SOURCE_SYSTEM_REQUIRED',
      'EARTHING_POLICY_REQUIRED',
      'REVIEW_TEMPLATE_REQUIRED',
      'REVIEW_SCOPE_REQUIRED',
    ]);
  });

  it('persists only safe designations and explicit review decisions in the v3 settings namespace', () => {
    const state: V3WorkflowState = {
      sourceSystem: { id: 'ac-1ph-220v', label: 'AC 1Φ 220 V' },
      earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
      canvasUnitsPerMm: 2,
      sourceProtection: { phaseSequence: 'L1-L2-L3', prospectiveShortCircuitCurrentA: 6000, protectiveDeviceCurve: 'C16' },
      reviewScope: { templateId: 'control-panel-prewire', deviceIds: ['psu', 'plc'] },
      designations: { psu: 'PS1', plc: ' PLC-1 ', ignored: '  ' },
      deviceSettings: { psu: { orderCode: ' MDR-100-24 ' } },
      conductorSettings: {
        w1: {
          cableId: ' C-01 ', core: ' 1 ', wireNumber: ' W-001 ', gauge: ' 0.75 mm² ', color: null,
          lengthMm: 1200, ferruleFrom: null, ferruleTo: null, lugFrom: null, lugTo: null,
          shielded: true, drain: false,
        },
      },
      plcRuntime: null,
    };
    const document = { settings: { goal: 'legacy' } };

    expect(applyV3WorkflowState(document, state)).toEqual({
      settings: {
        goal: 'legacy',
        v3Workflow: {
          sourceSystem: { id: 'ac-1ph-220v', label: 'AC 1Φ 220 V' },
          earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
          canvasUnitsPerMm: 2,
          sourceProtection: { phaseSequence: 'L1-L2-L3', prospectiveShortCircuitCurrentA: 6000, protectiveDeviceCurve: 'C16' },
          reviewScope: { templateId: 'control-panel-prewire', deviceIds: ['plc', 'psu'] },
          designations: { plc: 'PLC-1', psu: 'PS1' },
          deviceSettings: { psu: { orderCode: 'MDR-100-24' } },
          conductorSettings: {
            w1: {
              cableId: 'C-01', core: '1', wireNumber: 'W-001', gauge: '0.75 mm²', color: null,
              lengthMm: 1200, ferruleFrom: null, ferruleTo: null, lugFrom: null, lugTo: null,
              shielded: true, drain: false,
            },
          },
          plcRuntime: null,
        },
      },
    });
  });

  it('uses v3 report class wording rather than the legacy VERIFIED label', () => {
    expect(reportClassLabel('LEGACY_DIAGNOSTIC')).toBe('LEGACY_DIAGNOSTIC');
    expect(reportClassLabel('DIAGNOSTIC')).toBe('DIAGNOSTIC');
    expect(reportClassLabel('VERIFIED_PREWIRE')).toBe('VERIFIED_PREWIRE');
  });

  it('preserves only schema-valid PLC runtime bindings and never persists a live session', () => {
    const runtime = {
      schemaVersion: 1 as const,
      adapter: 'xgsim' as const,
      pollIntervalMs: 20,
      bindings: [{
        schemaVersion: 1 as const,
        id: 'start-input', deviceInstanceId: 'plc1', terminalId: 'P03', cpuModel: 'XGB-XBCH',
        projectId: 'fixture', symbolName: 'START', address: 'B0S00.IN03', direction: 'input' as const,
        dataType: 'BOOL' as const, inverted: false, normalState: false, communicationLossState: false,
        access: { read: true, write: true }, projectSha256: 'e'.repeat(64),
      }],
    };
    expect(createV3WorkflowState({ plcRuntime: runtime }).plcRuntime).toEqual(runtime);
    expect(createV3WorkflowState({ plcRuntime: { ...runtime, bindings: [{ ...runtime.bindings[0], address: 'B0S00.OUT00' }] } }).plcRuntime).toBeNull();
    expect(createV3WorkflowState({ plcRuntime: { ...runtime, sessionId: 'must-not-persist' } }).plcRuntime).toBeNull();
  });

  it('preserves explicit sensor test state and 2-wire loop current without inventing missing values', () => {
    const state = createV3WorkflowState({
      deviceSettings: {
        npn: { sensorDetected: false },
        pnp: { sensorDetected: true },
        tx: { currentMilliamp: 15.5 },
        invalid: { currentMilliamp: -1 },
      },
    });

    expect(state.deviceSettings).toEqual({
      npn: { orderCode: null, sensorDetected: false },
      pnp: { orderCode: null, sensorDetected: true },
      tx: { orderCode: null, currentMilliamp: 15.5 },
    });
  });

  it('persists only documented iG5A S8 selections and explicit control-power states', () => {
    const state = createV3WorkflowState({
      deviceSettings: {
        driveNpn: { ig5aInputLogic: 'NPN_INTERNAL_24V', ig5aControlPowerState: 'POWERED' },
        drivePnp: { ig5aInputLogic: 'PNP_EXTERNAL_24V', ig5aControlPowerState: 'UNPOWERED' },
        invalid: { ig5aInputLogic: 'AUTO', ig5aControlPowerState: 'UNKNOWN' },
      },
    });

    expect(state.deviceSettings).toEqual({
      driveNpn: {
        orderCode: null,
        ig5aInputLogic: 'NPN_INTERNAL_24V',
        ig5aControlPowerState: 'POWERED',
      },
      drivePnp: {
        orderCode: null,
        ig5aInputLogic: 'PNP_EXTERNAL_24V',
        ig5aControlPowerState: 'UNPOWERED',
      },
    });
  });

  it('preserves explicit XGB rack placement and complete RS485 review settings', () => {
    const state = createV3WorkflowState({
      deviceSettings: {
        cnet: {
          orderCode: ' XBL-C41A ', rackHostId: ' plc-1 ', rackSlot: 3,
          rs485: {
            port: 'CNET', protocol: 'MODBUS_RTU_MASTER', baudRate: 19200, dataBits: 8,
            parity: 'EVEN', stopBits: 1, stationId: null, mode: '2WIRE', termination: true,
          },
        },
        invalid: { rackHostId: ' ', rackSlot: 0 },
      },
    });

    expect(state.deviceSettings).toEqual({
      cnet: {
        orderCode: 'XBL-C41A', rackHostId: 'plc-1', rackSlot: 3,
        rs485: {
          port: 'CNET', protocol: 'MODBUS_RTU_MASTER', baudRate: 19200, dataBits: 8,
          parity: 'EVEN', stopBits: 1, stationId: null, mode: '2WIRE', termination: true,
        },
      },
    });
  });

  it('uses one injected validation result shape and blocks it on missing mandatory workflow choices', async () => {
    let legacyCalls = 0;
    const port = createV3ValidationPort({
      validate: async () => ({
        classification: 'VERIFIED_PREWIRE',
        validation: { status: 'PASS', issues: [], documentRevision: 3, documentHash: 'a', checkedAt: 'now' },
      }),
    });
    const result = await port.validate({
      document: {} as never,
      mode: 'practice',
      workflow: createV3WorkflowState({}),
      validateLegacy: async () => {
        legacyCalls += 1;
        throw new Error('injected engine must not use legacy validation');
      },
    });

    expect(legacyCalls).toBe(0);
    expect(result.classification).toBe('LEGACY_DIAGNOSTIC');
    expect(result.validation.status).toBe('BLOCKED');
    expect(result.validation.issues.map((issue) => issue.code)).toContain('SOURCE_SYSTEM_REQUIRED');
  });

  it('never upgrades the compatibility validator to VERIFIED_PREWIRE, even for a PASS prewire result', async () => {
    const result = await createV3ValidationPort().validate({
      document: {} as never,
      mode: 'prewire',
      workflow: createV3WorkflowState({
        sourceSystem: { id: 'dc-24v-isolated', label: 'DC 24 V isolated source' },
        earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
        reviewScope: { templateId: 'control-panel-prewire', deviceIds: ['ps1'] },
      }),
      validateLegacy: async () => ({ status: 'PASS', issues: [], documentRevision: 3, documentHash: 'a', checkedAt: 'now' }),
    });

    expect(result.validation.status).toBe('PASS');
    expect(result.classification).toBe('LEGACY_DIAGNOSTIC');
  });

  it('allows VERIFIED_PREWIRE only from a passing injected prewire validator with complete workflow state', async () => {
    const workflow = createV3WorkflowState({
      sourceSystem: { id: 'dc-24v-isolated', label: 'DC 24 V isolated source' },
      earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
      reviewScope: { templateId: 'control-panel-prewire', deviceIds: ['ps1'] },
    });
    const injected = createV3ValidationPort({
      validate: async () => ({
        classification: 'VERIFIED_PREWIRE',
        validation: { status: 'PASS', issues: [], documentRevision: 3, documentHash: 'a', checkedAt: 'now' },
      }),
    });

    await expect(injected.validate({ document: {} as never, mode: 'prewire', workflow, validateLegacy: async () => { throw new Error('unused'); } }))
      .resolves.toMatchObject({ classification: 'VERIFIED_PREWIRE', validation: { status: 'PASS' } });
    await expect(injected.validate({ document: {} as never, mode: 'practice', workflow, validateLegacy: async () => { throw new Error('unused'); } }))
      .resolves.toMatchObject({ classification: 'LEGACY_DIAGNOSTIC' });
    await expect(injected.validate({ document: {} as never, mode: 'prewire', workflow: createV3WorkflowState({}), validateLegacy: async () => { throw new Error('unused'); } }))
      .resolves.toMatchObject({ classification: 'DIAGNOSTIC', validation: { status: 'BLOCKED' } });
  });
});

describe('v3 report exports', () => {
  const report = {
    classification: 'VERIFIED_PREWIRE' as const,
    title: 'Panel <review>',
    eligibility: { engine: 'v3-closed-loop' as const, eligible: true, status: 'PASS' as const, reason: null },
    pinToPin: [{ from: 'PS1:L', to: 'PLC1:L', cableId: 'W-1', core: '1', color: 'Brown' }],
    cables: [{ cableId: 'W-1', from: 'PS1', to: 'PLC1', cores: 1, description: 'Supply, "24V"' }],
    terminals: [{ designation: 'XT1', terminal: '1', signal: '+24V', destination: 'PLC1:L' }],
  };

  it('exports HTML, CSV schedules, and JSON with stable headings and escaped values', () => {
    expect(htmlReport(report)).toContain('Panel &lt;review&gt;');
    expect(pinToPinCsv(report)).toContain('From,From electrical role,To,To electrical role,Conductor electrical role,Cable');
    expect(cableCoreScheduleCsv(report)).toContain('"Supply, ""24V"""');
    expect(terminalPlanCsv(report)).toContain('Designation,Terminal,Signal,Destination');
    expect(JSON.parse(jsonReport(report)).classification).toBe('VERIFIED_PREWIRE');
  });
});
