import { describe, expect, it } from 'vitest';
import {
  buildCircuitModel,
  createVirtualMultimeter,
  solveCircuit,
  validateWorkshopV3,
  type AcSinglePhaseSourceSystem,
  type AcThreePhaseSourceSystem,
  type ElectricalBranch,
  type WorkshopDocumentV3,
} from '../../src/domain/v3';

const branch = (
  id: string,
  fromElement: string,
  fromTerminal: string,
  toElement: string,
  toTerminal: string,
  conductor: ElectricalBranch['conductor'] = 'ac',
): ElectricalBranch => ({
  id,
  from: { elementId: fromElement, terminalId: fromTerminal },
  to: { elementId: toElement, terminalId: toTerminal },
  conductor,
});

function document(
  sources: WorkshopDocumentV3['sources'],
  elements: WorkshopDocumentV3['elements'],
  branches: WorkshopDocumentV3['branches'],
): WorkshopDocumentV3 {
  return {
    schemaVersion: 3,
    revision: 1,
    hash: 'ac-v3-fixture',
    sources,
    elements,
    branches,
    reviewScope: { elementIds: elements.map((element) => element.id) },
  };
}

const singlePhaseSource: AcSinglePhaseSourceSystem = {
  kind: 'ac-single-phase',
  id: 'mains',
  lineTerminal: 'L',
  neutralTerminal: 'N',
  peTerminal: 'PE',
  lineToNeutralVoltage: 230,
};

const threePhaseSource: AcThreePhaseSourceSystem = {
  kind: 'ac-three-phase',
  id: 'mains-3ph',
  phaseTerminals: { L1: 'L1', L2: 'L2', L3: 'L3' },
  peTerminal: 'PE',
  lineToLineVoltage: 400,
  declaredPhaseSequence: 'L1-L2-L3',
};

describe('v3 AC and three-phase circuit safety', () => {
  it('powers a complete L-N-PE load but blocks protection coordination without declared fault-current and curve inputs', () => {
    const doc = document(
      [singlePhaseSource],
      [{ kind: 'ac-load', id: 'control', lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE' }],
      [
        branch('line', 'mains', 'L', 'control', 'L'),
        branch('neutral', 'mains', 'N', 'control', 'N'),
        branch('earth', 'mains', 'PE', 'control', 'PE', 'pe'),
      ],
    );

    const solution = solveCircuit(buildCircuitModel(doc));
    const validation = validateWorkshopV3(doc);

    expect(solution.acLoads.control).toMatchObject({ energized: true, state: 'ON', sourceId: 'mains' });
    expect(validation.status).toBe('BLOCKED');
    expect(validation.issues.map((entry) => entry.code)).toContain('PROTECTION_COORDINATION_BLOCKED');
  });

  it('detects phase-neutral and phase-phase shorts as distinct hazards', () => {
    const phaseNeutral = document([singlePhaseSource], [], [branch('short', 'mains', 'L', 'mains', 'N')]);
    const phasePhase = document([threePhaseSource], [], [branch('short', 'mains-3ph', 'L1', 'mains-3ph', 'L2')]);

    expect(solveCircuit(buildCircuitModel(phaseNeutral)).issues.map((entry) => entry.code))
      .toContain('AC_PHASE_NEUTRAL_SHORT');
    expect(solveCircuit(buildCircuitModel(phasePhase)).issues.map((entry) => entry.code))
      .toContain('AC_PHASE_PHASE_SHORT');
  });

  it('fails a live-to-PE fault without treating PE as a working conductor', () => {
    const protectedSource = { ...singlePhaseSource, protectionCoordination: { prospectiveShortCircuitCurrentA: 1000, protectiveDeviceCurve: 'C10' } };
    const doc = document(
      [protectedSource],
      [{ kind: 'device', id: 'chassis', terminals: ['PE'] }],
      [branch('live-earth-fault', 'mains', 'L', 'chassis', 'PE', 'pe')],
    );

    const solution = solveCircuit(buildCircuitModel(doc));
    expect(solution.issues.map((entry) => entry.code)).toContain('AC_PHASE_PE_FAULT');
    expect(validateWorkshopV3(doc).status).toBe('FAIL');
  });

  it('fails independently sourced AC rails tied on all matching potentials', () => {
    const protectedSource = { ...singlePhaseSource, protectionCoordination: { prospectiveShortCircuitCurrentA: 1000, protectiveDeviceCurve: 'C10' } };
    const doc = document([protectedSource, { ...protectedSource, id: 'mains-2' }], [], [
      branch('line-parallel', 'mains', 'L', 'mains-2', 'L'),
      branch('neutral-parallel', 'mains', 'N', 'mains-2', 'N'),
    ]);

    const result = validateWorkshopV3(doc);
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((entry) => entry.code)).toContain('PARALLEL_SOURCE');
  });

  it('fails a partial three-phase parallel connection once two source potentials are tied', () => {
    const protectedSource = { ...threePhaseSource, protectionCoordination: { prospectiveShortCircuitCurrentA: 1000, protectiveDeviceCurve: 'C10' } };
    const doc = document([protectedSource, { ...protectedSource, id: 'mains-3ph-2' }], [], [
      branch('l1-parallel', 'mains-3ph', 'L1', 'mains-3ph-2', 'L1'),
      branch('l2-parallel', 'mains-3ph', 'L2', 'mains-3ph-2', 'L2'),
    ]);

    const result = validateWorkshopV3(doc);
    expect(result.status).toBe('FAIL');
    expect(result.issues.map((entry) => entry.code)).toContain('PARALLEL_SOURCE');
  });

  it('measures AC L-N and three-phase L-L voltages from phase-aware terminal metadata', () => {
    const single = document([singlePhaseSource], [{ kind: 'device', id: 'load', terminals: ['L', 'N'] }], [
      branch('single-line', 'mains', 'L', 'load', 'L'),
      branch('single-neutral', 'mains', 'N', 'load', 'N'),
    ]);
    const three = document([{ ...threePhaseSource, neutralTerminal: 'N', lineToNeutralVoltage: 230 }], [{ kind: 'device', id: 'motor', terminals: ['U', 'V', 'N'] }], [
      branch('phase-u', 'mains-3ph', 'L1', 'motor', 'U'),
      branch('phase-v', 'mains-3ph', 'L2', 'motor', 'V'),
      branch('neutral', 'mains-3ph', 'N', 'motor', 'N'),
    ]);

    const singleMeter = createVirtualMultimeter(solveCircuit(buildCircuitModel(single)));
    const threeMeter = createVirtualMultimeter(solveCircuit(buildCircuitModel(three)));
    expect(singleMeter.voltage({ elementId: 'load', terminalId: 'L' }, { elementId: 'load', terminalId: 'N' }))
      .toEqual({ status: 'measured', voltageV: 230 });
    expect(threeMeter.voltage({ elementId: 'motor', terminalId: 'U' }, { elementId: 'motor', terminalId: 'V' }))
      .toEqual({ status: 'measured', voltageV: 400 });
    expect(threeMeter.voltage({ elementId: 'motor', terminalId: 'U' }, { elementId: 'motor', terminalId: 'N' }))
      .toEqual({ status: 'measured', voltageV: 230 });
  });

  it('enforces declared 0V-PE bonding counts when the document has explicit terminals', () => {
    const dc = { id: 'dc', positiveTerminal: '+', returnTerminal: '-', voltage: 24 as const };
    const policy = { supply: { status: 'complete' as const, kind: 'dc' as const, nominalVoltage: 24, conductors: ['+24V', '0V'], positivePotential: '+24V' as const, returnPotential: '0V' as const }, earthing: { status: 'complete' as const, policy: 'PE_0V_SINGLE_POINT_BOND' as const }, id: 'dc-24v-isolated', label: 'DC 24V' };
    const missing = document([singlePhaseSource, dc], [], []);
    missing.sourceSystem = policy;
    const bonded = document([singlePhaseSource, dc], [], [branch('single-bond', 'dc', '-', 'mains', 'PE', 'pe')]);
    bonded.sourceSystem = policy;

    expect(validateWorkshopV3(missing).issues.map((entry) => entry.code)).toContain('EARTHING_POLICY_BOND_COUNT');
    expect(validateWorkshopV3(bonded).issues.map((entry) => entry.code)).not.toContain('EARTHING_POLICY_BOND_COUNT');
  });

  it('rejects protective earth as the working neutral return', () => {
    const doc = document(
      [singlePhaseSource],
      [{ kind: 'ac-load', id: 'control', lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE' }],
      [
        branch('line', 'mains', 'L', 'control', 'L'),
        branch('wrong-return', 'mains', 'PE', 'control', 'N', 'pe'),
        branch('earth', 'mains', 'PE', 'control', 'PE', 'pe'),
      ],
    );

    const solution = solveCircuit(buildCircuitModel(doc));

    expect(solution.acLoads.control).toMatchObject({ energized: false, state: 'PE_AS_WORKING_RETURN' });
    expect(solution.issues.map((entry) => entry.code)).toContain('PE_AS_WORKING_RETURN');
  });

  it('distinguishes a missing three-phase conductor from a declared sequence mismatch', () => {
    const motor = {
      kind: 'three-phase-load' as const,
      id: 'motor',
      phaseTerminals: { L1: 'U', L2: 'V', L3: 'W' },
      peTerminal: 'PE',
    };
    const common = [
      branch('phase-1', 'mains-3ph', 'L1', 'motor', 'U'),
      branch('phase-3', 'mains-3ph', 'L3', 'motor', 'W'),
      branch('earth', 'mains-3ph', 'PE', 'motor', 'PE', 'pe'),
    ];
    const missing = document([threePhaseSource], [motor], common);
    const swapped = document([threePhaseSource], [motor], [
      common[0],
      branch('phase-2-swapped', 'mains-3ph', 'L3', 'motor', 'V'),
      branch('phase-3-swapped', 'mains-3ph', 'L2', 'motor', 'W'),
      common[2],
    ]);

    expect(solveCircuit(buildCircuitModel(missing)).acLoads.motor.state).toBe('MISSING_PHASE');
    const swappedSolution = solveCircuit(buildCircuitModel(swapped));
    expect(swappedSolution.acLoads.motor.state).toBe('WRONG_PHASE_SEQUENCE');
    expect(swappedSolution.issues.map((entry) => entry.code)).toContain('WRONG_PHASE_SEQUENCE');
  });

  it('activates a conditioned 24 V converter output only after its AC input load is valid', () => {
    const converterInput = { kind: 'ac-load' as const, id: 'converter#ac-input', lineTerminal: 'L', neutralTerminal: 'N', peTerminal: 'PE' };
    const lamp = { kind: 'load' as const, id: 'lamp', positiveTerminal: '+', returnTerminal: '-' };
    const converterOutput = {
      kind: 'dc' as const,
      id: 'converter#24v',
      positiveTerminal: '+24V',
      returnTerminal: '0V',
      voltage: 24 as const,
      enabledByElementId: converterInput.id,
    };
    const wiring = [
      branch('ac-line', 'mains', 'L', converterInput.id, 'L'),
      branch('ac-earth', 'mains', 'PE', converterInput.id, 'PE', 'pe'),
      branch('dc-positive', converterOutput.id, '+24V', lamp.id, '+', 'dc'),
      branch('dc-return', lamp.id, '-', converterOutput.id, '0V', 'dc'),
    ];
    const openInput = document([singlePhaseSource, converterOutput], [converterInput, lamp], wiring);
    const closedInput = document([singlePhaseSource, converterOutput], [converterInput, lamp], [
      ...wiring,
      branch('ac-neutral', 'mains', 'N', converterInput.id, 'N'),
    ]);

    const openSolution = solveCircuit(buildCircuitModel(openInput));
    const closedSolution = solveCircuit(buildCircuitModel(closedInput));

    expect(openSolution.elements[converterOutput.id].state).toBe('SOURCE_INACTIVE');
    expect(openSolution.loads.lamp.energized).toBe(false);
    expect(openSolution.issues.map((entry) => entry.code)).toContain('SOURCE_CONDITION_UNMET');
    expect(closedSolution.elements[converterOutput.id].state).toBe('SOURCE_ACTIVE');
    expect(closedSolution.loads.lamp.energized).toBe(true);
  });
});
