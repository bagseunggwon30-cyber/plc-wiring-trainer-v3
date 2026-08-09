import type {
  AcLoadElement,
  AcLoadSolutionV3,
  AcTerminalPotentialV3,
  AcSinglePhaseSourceSystem,
  AcThreePhaseSourceSystem,
  AnalogPortElement,
  AnalogPortSolutionV3,
  BranchCurrentSolutionV3,
  CircuitPathV3,
  CircuitIssueV3,
  CircuitModel,
  CircuitSolution,
  ContactElement,
  ContactRuleV3,
  CurrentLoopSolutionV3,
  DcSourceSystem,
  ElementElectricalSolutionV3,
  LoadElement,
  PhaseSequenceV3,
  ScenarioSimulationV3,
  SimulationScenarioV3,
  SourceSystem,
  TerminalElectricalSolutionV3,
  TerminalReferenceV3,
  TransistorOutputElement,
  TwoWireCurrentTransmitterElement,
  ValidationResultV3,
  VirtualMultimeterV3,
  WorkshopDocumentV3,
} from './contracts';

const terminalKey = (elementId: string, terminalId: string): string => `${elementId}:${terminalId}`;

class UnionFind {
  private readonly parents = new Map<string, string>();

  add(value: string): void {
    if (!this.parents.has(value)) this.parents.set(value, value);
  }

  find(value: string): string {
    const parent = this.parents.get(value);
    if (!parent) throw new Error(`Unknown v3 terminal ${value}`);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parents.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents.set(rightRoot, leftRoot);
  }
}

function issue(code: CircuitIssueV3['code'], message: string, refs: readonly string[], blocking = true): CircuitIssueV3 {
  return { code, message, refs, blocking };
}

function elementTerminals(element: WorkshopDocumentV3['elements'][number]): readonly string[] {
  switch (element.kind) {
    case 'load': return [element.positiveTerminal, element.returnTerminal];
    case 'ac-load': return [element.lineTerminal, element.neutralTerminal, ...(element.peTerminal ? [element.peTerminal] : [])];
    case 'three-phase-load': return [
      element.phaseTerminals.L1,
      element.phaseTerminals.L2,
      element.phaseTerminals.L3,
      ...(element.neutralTerminal ? [element.neutralTerminal] : []),
      ...(element.peTerminal ? [element.peTerminal] : []),
    ];
    case 'contact': return [element.terminalA, element.terminalB];
    case 'analog-port': return [element.positiveTerminal, element.returnTerminal];
    case 'transistor-output': return [
      element.supplyPositiveTerminal,
      element.supplyReturnTerminal,
      element.outputTerminal,
    ];
    case 'two-wire-current-transmitter': return [element.positiveTerminal, element.negativeTerminal];
    case 'device': return element.terminals;
  }
}

function isDcSource(source: SourceSystem): source is DcSourceSystem {
  return source.kind === undefined || source.kind === 'dc';
}

function isAcSource(source: SourceSystem): source is AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem {
  return source.kind === 'ac-single-phase' || source.kind === 'ac-three-phase';
}

function sourceTerminals(source: SourceSystem): readonly string[] {
  if (isDcSource(source)) return [source.positiveTerminal, source.returnTerminal];
  if (source.kind === 'ac-single-phase') return [source.lineTerminal, source.neutralTerminal, source.peTerminal];
  return [
    source.phaseTerminals.L1,
    source.phaseTerminals.L2,
    source.phaseTerminals.L3,
    ...(source.neutralTerminal ? [source.neutralTerminal] : []),
    source.peTerminal,
  ];
}

function isContactClosed(contact: ContactElement, states: Readonly<Record<string, boolean>>): boolean {
  return states[contact.stateKey] ?? contact.normally === 'closed';
}

export function buildCircuitModel(
  document: WorkshopDocumentV3,
  contactStates: Readonly<Record<string, boolean>> = {},
): CircuitModel {
  const union = new UnionFind();
  const peUnion = new UnionFind();
  const nodes = new Set<string>();
  const issues: CircuitIssueV3[] = [];
  const ids = new Set<string>();
  const addNode = (elementId: string, terminalId: string): void => {
    const key = terminalKey(elementId, terminalId);
    nodes.add(key);
    union.add(key);
    peUnion.add(key);
  };
  const addId = (id: string): void => {
    if (ids.has(id)) issues.push(issue('DUPLICATE_ELEMENT_ID', `Duplicate v3 element id ${id}.`, [id]));
    ids.add(id);
  };

  for (const source of document.sources) {
    addId(source.id);
    for (const terminal of sourceTerminals(source)) addNode(source.id, terminal);
  }
  for (const element of document.elements) {
    addId(element.id);
    for (const terminal of elementTerminals(element)) addNode(element.id, terminal);
  }

  for (const branch of document.branches) {
    const from = terminalKey(branch.from.elementId, branch.from.terminalId);
    const to = terminalKey(branch.to.elementId, branch.to.terminalId);
    if (!nodes.has(from) || !nodes.has(to)) {
      issues.push(issue('UNKNOWN_TERMINAL', `Branch ${branch.id} references an unknown terminal.`, [branch.id, from, to]));
      continue;
    }
    if (branch.conductor === 'pe') peUnion.union(from, to);
    else union.union(from, to);
  }
  for (const contact of document.elements.filter((element): element is ContactElement => element.kind === 'contact')) {
    if (isContactClosed(contact, contactStates)) {
      union.union(terminalKey(contact.id, contact.terminalA), terminalKey(contact.id, contact.terminalB));
    }
  }
  const acControlPowerComplete = (elementId: string): boolean => {
    const control = document.elements.find((element) => element.id === elementId);
    if (control?.kind !== 'ac-load') return false;
    const lineRoot = union.find(terminalKey(control.id, control.lineTerminal));
    const neutralRoot = union.find(terminalKey(control.id, control.neutralTerminal));
    if (lineRoot === neutralRoot) return false;
    const peRoot = control.peTerminal === undefined
      ? null
      : peUnion.find(terminalKey(control.id, control.peTerminal));
    return document.sources.filter(isAcSource).some((source) => {
      const sourceLines = source.kind === 'ac-single-phase'
        ? [source.lineTerminal]
        : Object.values(source.phaseTerminals);
      const lineConnected = sourceLines.some((terminal) =>
        union.find(terminalKey(source.id, terminal)) === lineRoot);
      const neutralConnected = source.neutralTerminal !== undefined
        && union.find(terminalKey(source.id, source.neutralTerminal)) === neutralRoot;
      const peConnected = peRoot === null
        || peUnion.find(terminalKey(source.id, source.peTerminal)) === peRoot;
      return lineConnected && neutralConnected && peConnected;
    });
  };
  const activeTransistorStates: Record<string, boolean> = {};
  for (const output of document.elements
    .filter((element): element is TransistorOutputElement => element.kind === 'transistor-output')
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const positive = terminalKey(output.id, output.supplyPositiveTerminal);
    const returned = terminalKey(output.id, output.supplyReturnTerminal);
    const powerPairComplete = document.sources.filter(isDcSource).some((source) =>
      union.find(terminalKey(source.id, source.positiveTerminal)) === union.find(positive)
      && union.find(terminalKey(source.id, source.returnTerminal)) === union.find(returned));
    const controlPowerComplete = output.controlPowerElementId === undefined
      || acControlPowerComplete(output.controlPowerElementId);
    const requested = contactStates[output.stateKey] ?? output.defaultState ?? false;
    const active = requested && powerPairComplete && controlPowerComplete;
    activeTransistorStates[output.id] = active;
    if (active) {
      union.union(
        terminalKey(output.id, output.outputTerminal),
        output.mode === 'sinking' ? returned : positive,
      );
    }
  }

  const nodesByRoot = new Map<string, string[]>();
  for (const node of nodes) {
    const root = union.find(node);
    nodesByRoot.set(root, [...(nodesByRoot.get(root) ?? []), node]);
  }
  const stableComponentByRoot = new Map(
    [...nodesByRoot].map(([root, members]) => [root, [...members].sort()[0]]),
  );
  const componentOf = new Map<string, string>();
  for (const node of [...nodes].sort()) componentOf.set(node, stableComponentByRoot.get(union.find(node)) ?? node);
  return {
    document,
    netGraph: { nodes, branches: document.branches, componentOf },
    activeContactStates: { ...contactStates },
    activeTransistorStates,
    issues,
  };
}

function sameComponent(model: CircuitModel, left: string, right: string): boolean {
  const leftComponent = model.netGraph.componentOf.get(left);
  return leftComponent !== undefined && leftComponent === model.netGraph.componentOf.get(right);
}

function pushUniqueIssue(issues: CircuitIssueV3[], next: CircuitIssueV3): void {
  if (!issues.some((entry) => entry.code === next.code && entry.refs.join('|') === next.refs.join('|'))) issues.push(next);
}

interface ActivePathEdge {
  id: string;
  left: string;
  right: string;
}

function activePathEdges(model: CircuitModel): ActivePathEdge[] {
  const edges: ActivePathEdge[] = model.document.branches
    .filter((branch) => branch.conductor !== 'pe')
    .flatMap((branch) => {
      const left = terminalKey(branch.from.elementId, branch.from.terminalId);
      const right = terminalKey(branch.to.elementId, branch.to.terminalId);
      return model.netGraph.nodes.has(left) && model.netGraph.nodes.has(right)
        ? [{ id: branch.id, left, right }]
        : [];
    });
  for (const contact of model.document.elements.filter((element): element is ContactElement => element.kind === 'contact')) {
    if (!isContactClosed(contact, model.activeContactStates)) continue;
    edges.push({
      id: `contact:${contact.id}`,
      left: terminalKey(contact.id, contact.terminalA),
      right: terminalKey(contact.id, contact.terminalB),
    });
  }
  for (const output of model.document.elements
    .filter((element): element is TransistorOutputElement => element.kind === 'transistor-output')) {
    if (model.activeTransistorStates[output.id] !== true) continue;
    edges.push({
      id: `transistor:${output.id}`,
      left: terminalKey(output.id, output.outputTerminal),
      right: terminalKey(
        output.id,
        output.mode === 'sinking' ? output.supplyReturnTerminal : output.supplyPositiveTerminal,
      ),
    });
  }
  return edges.sort((left, right) => left.id.localeCompare(right.id)
    || left.left.localeCompare(right.left)
    || left.right.localeCompare(right.right));
}

function deterministicPath(
  model: CircuitModel,
  from: string,
  to: string,
  sourceId: string,
): CircuitPathV3 | null {
  if (!model.netGraph.nodes.has(from) || !model.netGraph.nodes.has(to)) return null;
  if (!sameComponent(model, from, to)) return null;
  if (from === to) return { sourceId, terminalKeys: [from], branchIds: [] };

  const adjacency = new Map<string, Array<{ node: string; edge: ActivePathEdge }>>();
  for (const edge of activePathEdges(model)) {
    adjacency.set(edge.left, [...(adjacency.get(edge.left) ?? []), { node: edge.right, edge }]);
    adjacency.set(edge.right, [...(adjacency.get(edge.right) ?? []), { node: edge.left, edge }]);
  }
  for (const entries of adjacency.values()) {
    entries.sort((left, right) => left.edge.id.localeCompare(right.edge.id) || left.node.localeCompare(right.node));
  }

  const queue = [from];
  const previous = new Map<string, { node: string; edge: ActivePathEdge }>();
  const visited = new Set([from]);
  while (queue.length) {
    const node = queue.shift() as string;
    for (const candidate of adjacency.get(node) ?? []) {
      if (visited.has(candidate.node)) continue;
      visited.add(candidate.node);
      previous.set(candidate.node, { node, edge: candidate.edge });
      if (candidate.node === to) {
        queue.length = 0;
        break;
      }
      queue.push(candidate.node);
    }
  }
  if (!previous.has(to)) return null;

  const terminalKeys = [to];
  const branchIds: string[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = previous.get(cursor);
    if (!step) return null;
    branchIds.push(step.edge.id);
    terminalKeys.push(step.node);
    cursor = step.node;
  }
  terminalKeys.reverse();
  branchIds.reverse();
  return { sourceId, terminalKeys, branchIds };
}

function terminalElectricalSolutions(
  model: CircuitModel,
  continuityGroups: Readonly<Record<string, string>>,
  activeDcSources: readonly DcSourceSystem[],
  activeAcSources: readonly (AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem)[],
  physicalGroups: Readonly<Record<string, string>>,
): { terminals: Record<string, TerminalElectricalSolutionV3>; acTerminalPotentials: Record<string, AcTerminalPotentialV3> } {
  const componentPotentials = new Map<string, { positiveVoltages: Set<number>; hasReturn: boolean }>();
  for (const source of activeDcSources) {
    const positiveComponent = continuityGroups[terminalKey(source.id, source.positiveTerminal)];
    const returnComponent = continuityGroups[terminalKey(source.id, source.returnTerminal)];
    if (positiveComponent) {
      const entry = componentPotentials.get(positiveComponent) ?? { positiveVoltages: new Set<number>(), hasReturn: false };
      entry.positiveVoltages.add(source.voltage);
      componentPotentials.set(positiveComponent, entry);
    }
    if (returnComponent) {
      const entry = componentPotentials.get(returnComponent) ?? { positiveVoltages: new Set<number>(), hasReturn: false };
      entry.hasReturn = true;
      componentPotentials.set(returnComponent, entry);
    }
  }

  const terminals: Record<string, TerminalElectricalSolutionV3> = Object.fromEntries([...model.netGraph.nodes].sort().map((node) => {
    const component = continuityGroups[node];
    const potentials = component ? componentPotentials.get(component) : undefined;
    if (!potentials || (!potentials.hasReturn && potentials.positiveVoltages.size === 0)) {
      return [node, { state: 'floating', voltageV: null } satisfies TerminalElectricalSolutionV3];
    }
    if (potentials.hasReturn && potentials.positiveVoltages.size > 0) {
      return [node, { state: 'conflict', voltageV: null } satisfies TerminalElectricalSolutionV3];
    }
    if (potentials.positiveVoltages.size === 1) {
      return [node, { state: 'positive', voltageV: [...potentials.positiveVoltages][0] } satisfies TerminalElectricalSolutionV3];
    }
    if (potentials.positiveVoltages.size > 1) {
      return [node, { state: 'conflict', voltageV: null } satisfies TerminalElectricalSolutionV3];
    }
    return [node, { state: 'return', voltageV: 0 } satisfies TerminalElectricalSolutionV3];
  }));
  const acTerminalPotentials: Record<string, AcTerminalPotentialV3> = {};
  const applyAcPotential = (
    node: string,
    source: AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem,
    conductor: AcTerminalPotentialV3['conductor'],
  ): void => {
    const voltageV = conductor === 'N' || conductor === 'PE'
      ? 0
      : source.kind === 'ac-single-phase'
        ? source.lineToNeutralVoltage
        : source.lineToNeutralVoltage ?? Math.round(source.lineToLineVoltage / Math.sqrt(3));
    const existing = terminals[node];
    if (!existing) return;
    if (existing.state === 'floating') {
      terminals[node] = { state: conductor === 'N' || conductor === 'PE' ? 'return' : 'positive', voltageV };
    } else if (existing.voltageV !== voltageV) {
      terminals[node] = { state: 'conflict', voltageV: null };
      return;
    }
    const potential: AcTerminalPotentialV3 = {
      sourceId: source.id,
      conductor,
      lineToNeutralVoltage: source.kind === 'ac-single-phase'
        ? source.lineToNeutralVoltage
        : source.lineToNeutralVoltage ?? Math.round(source.lineToLineVoltage / Math.sqrt(3)),
      lineToLineVoltage: source.kind === 'ac-single-phase' ? null : source.lineToLineVoltage,
    };
    const previous = acTerminalPotentials[node];
    if (previous === undefined || (previous.sourceId === potential.sourceId && previous.conductor === potential.conductor)) {
      acTerminalPotentials[node] = potential;
    } else {
      delete acTerminalPotentials[node];
    }
  };
  for (const source of activeAcSources) {
    for (const phase of acPhaseTerminals(source)) {
      const sourceNode = terminalKey(source.id, phase.terminal);
      const component = model.netGraph.componentOf.get(sourceNode);
      for (const node of model.netGraph.nodes) {
        if (component !== undefined && model.netGraph.componentOf.get(node) === component) applyAcPotential(node, source, phase.phase);
      }
    }
    const neutral = acNeutralTerminal(source);
    if (neutral !== undefined) {
      const sourceNode = terminalKey(source.id, neutral);
      const component = model.netGraph.componentOf.get(sourceNode);
      for (const node of model.netGraph.nodes) {
        if (component !== undefined && model.netGraph.componentOf.get(node) === component) applyAcPotential(node, source, 'N');
      }
    }
    const sourcePe = terminalKey(source.id, source.peTerminal);
    const peGroup = physicalGroups[sourcePe];
    for (const node of model.netGraph.nodes) {
      if (peGroup !== undefined && physicalGroups[node] === peGroup) applyAcPotential(node, source, 'PE');
    }
  }
  return { terminals, acTerminalPotentials };
}

function physicalContinuityGroups(model: CircuitModel): Record<string, string> {
  const union = new UnionFind();
  for (const node of model.netGraph.nodes) union.add(node);
  for (const branch of model.document.branches) {
    const left = terminalKey(branch.from.elementId, branch.from.terminalId);
    const right = terminalKey(branch.to.elementId, branch.to.terminalId);
    if (model.netGraph.nodes.has(left) && model.netGraph.nodes.has(right)) union.union(left, right);
  }
  for (const contact of model.document.elements.filter((element): element is ContactElement => element.kind === 'contact')) {
    if (!isContactClosed(contact, model.activeContactStates)) continue;
    union.union(terminalKey(contact.id, contact.terminalA), terminalKey(contact.id, contact.terminalB));
  }
  for (const output of model.document.elements
    .filter((element): element is TransistorOutputElement => element.kind === 'transistor-output')) {
    if (model.activeTransistorStates[output.id] !== true) continue;
    union.union(
      terminalKey(output.id, output.outputTerminal),
      terminalKey(
        output.id,
        output.mode === 'sinking' ? output.supplyReturnTerminal : output.supplyPositiveTerminal,
      ),
    );
  }
  const membersByRoot = new Map<string, string[]>();
  for (const node of model.netGraph.nodes) {
    const root = union.find(node);
    membersByRoot.set(root, [...(membersByRoot.get(root) ?? []), node]);
  }
  const stableRoot = new Map([...membersByRoot].map(([root, members]) => [root, [...members].sort()[0]]));
  return Object.fromEntries([...model.netGraph.nodes].sort().map((node) => [node, stableRoot.get(union.find(node)) ?? node]));
}

function terminalsFor(
  terminalIds: readonly string[],
  elementId: string,
  terminals: Readonly<Record<string, TerminalElectricalSolutionV3>>,
): Record<string, TerminalElectricalSolutionV3> {
  return Object.fromEntries([...terminalIds].sort().map((terminalId) => [terminalId, terminals[terminalKey(elementId, terminalId)]]));
}

function voltageBetween(
  terminals: Readonly<Record<string, TerminalElectricalSolutionV3>>,
  continuityGroups: Readonly<Record<string, string>>,
  positive: string,
  negative: string,
): number | null {
  if (continuityGroups[positive] === continuityGroups[negative]) return 0;
  const positiveVoltage = terminals[positive]?.voltageV;
  const negativeVoltage = terminals[negative]?.voltageV;
  return positiveVoltage === null || positiveVoltage === undefined || negativeVoltage === null || negativeVoltage === undefined
    ? null
    : positiveVoltage - negativeVoltage;
}

function resistiveCurrent(load: LoadElement, state: CircuitSolution['loads'][string]['state'], voltageV: number | null): number | null {
  if (state === 'SHORTED') return null;
  if (state !== 'ON') return 0;
  if (load.resistanceOhms === undefined || !Number.isFinite(load.resistanceOhms) || load.resistanceOhms <= 0 || voltageV === null) return null;
  return Math.abs(voltageV) / load.resistanceOhms;
}

type PhaseNameV3 = 'L1' | 'L2' | 'L3';

interface AcSolveResultV3 {
  acLoads: Record<string, AcLoadSolutionV3>;
  shortedSourceIds: Set<string>;
}

function acPhaseTerminals(source: AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem): readonly { phase: PhaseNameV3; terminal: string }[] {
  if (source.kind === 'ac-single-phase') return [{ phase: 'L1', terminal: source.lineTerminal }];
  return [
    { phase: 'L1', terminal: source.phaseTerminals.L1 },
    { phase: 'L2', terminal: source.phaseTerminals.L2 },
    { phase: 'L3', terminal: source.phaseTerminals.L3 },
  ];
}

function acNeutralTerminal(source: AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem): string | undefined {
  return source.kind === 'ac-single-phase' ? source.neutralTerminal : source.neutralTerminal;
}

function protectionInputsComplete(source: AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem): boolean {
  const inputs = source.protectionCoordination;
  return inputs !== undefined
    && inputs.prospectiveShortCircuitCurrentA !== null
    && Number.isFinite(inputs.prospectiveShortCircuitCurrentA)
    && inputs.prospectiveShortCircuitCurrentA > 0
    && inputs.protectiveDeviceCurve !== null
    && inputs.protectiveDeviceCurve.trim().length > 0;
}

function samePhysicalComponent(groups: Readonly<Record<string, string>>, left: string, right: string): boolean {
  return groups[left] !== undefined && groups[left] === groups[right];
}

function validateAcSourceSafety(
  model: CircuitModel,
  acSources: readonly (AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem)[],
  physicalGroups: Readonly<Record<string, string>>,
  issues: CircuitIssueV3[],
  shortedSourceIds: Set<string>,
): void {
  const peTerminals = [
    ...acSources.map((source) => terminalKey(source.id, source.peTerminal)),
    ...model.document.branches.filter((branch) => branch.conductor === 'pe').flatMap((branch) => [
      terminalKey(branch.from.elementId, branch.from.terminalId),
      terminalKey(branch.to.elementId, branch.to.terminalId),
    ]),
    ...model.document.elements.flatMap((element) => element.kind === 'ac-load' && element.peTerminal
      ? [terminalKey(element.id, element.peTerminal)]
      : element.kind === 'three-phase-load' && element.peTerminal
        ? [terminalKey(element.id, element.peTerminal)]
        : []),
  ].sort();
  for (const source of acSources) {
    for (const phase of acPhaseTerminals(source)) {
      const live = terminalKey(source.id, phase.terminal);
      const faultedPe = peTerminals.find((pe) => pe !== live && samePhysicalComponent(physicalGroups, live, pe));
      if (faultedPe) {
        pushUniqueIssue(issues, issue('AC_PHASE_PE_FAULT', `AC source ${source.id} ${phase.phase} is faulted to protective earth.`, [live, faultedPe]));
        shortedSourceIds.add(source.id);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < acSources.length; leftIndex += 1) {
    const left = acSources[leftIndex];
    for (const right of acSources.slice(leftIndex + 1)) {
      const leftPotentials = [
        ...acPhaseTerminals(left).map((entry) => ({ potential: entry.phase, terminal: terminalKey(left.id, entry.terminal) })),
        ...(acNeutralTerminal(left) === undefined ? [] : [{ potential: 'N', terminal: terminalKey(left.id, acNeutralTerminal(left) as string) }]),
      ];
      const rightByPotential = new Map<PhaseNameV3 | 'N', string>([
        ...acPhaseTerminals(right).map((entry) => [entry.phase, terminalKey(right.id, entry.terminal)] as const),
        ...(acNeutralTerminal(right) === undefined ? [] : [['N', terminalKey(right.id, acNeutralTerminal(right) as string)] as const]),
      ]);
      const shared = leftPotentials.filter((entry) => {
        const counterpart = rightByPotential.get(entry.potential as PhaseNameV3 | 'N');
        return counterpart !== undefined && sameComponent(model, entry.terminal, counterpart);
      });
      if (shared.length >= 2) {
        pushUniqueIssue(issues, issue(
          'PARALLEL_SOURCE',
          `Independent AC sources ${left.id} and ${right.id} are connected in parallel on matching potentials.`,
          [left.id, right.id],
        ));
      }
    }
  }
}

function validateEarthingBondPolicy(
  model: CircuitModel,
  physicalGroups: Readonly<Record<string, string>>,
  issues: CircuitIssueV3[],
): void {
  const policy = model.document.sourceSystem?.earthing;
  if (policy?.status !== 'complete' || policy.policy === null || policy.policy === 'SITE_DEFINED_BONDING') return;
  const returnComponents = new Set(model.document.sources.filter(isDcSource)
    .map((source) => model.netGraph.componentOf.get(terminalKey(source.id, source.returnTerminal)))
    .filter((component): component is string => component !== undefined));
  const peGroups = new Set([
    ...model.document.sources.filter(isAcSource).map((source) => physicalGroups[terminalKey(source.id, source.peTerminal)]),
    ...model.document.elements.flatMap((element) => element.kind === 'ac-load' && element.peTerminal
      ? [physicalGroups[terminalKey(element.id, element.peTerminal)]
      ] : element.kind === 'three-phase-load' && element.peTerminal
        ? [physicalGroups[terminalKey(element.id, element.peTerminal)]] : []),
  ].filter((group): group is string => group !== undefined));
  const bondIds = model.document.branches.filter((branch) => {
    const left = terminalKey(branch.from.elementId, branch.from.terminalId);
    const right = terminalKey(branch.to.elementId, branch.to.terminalId);
    return (returnComponents.has(model.netGraph.componentOf.get(left) ?? '') && peGroups.has(physicalGroups[right] ?? ''))
      || (returnComponents.has(model.netGraph.componentOf.get(right) ?? '') && peGroups.has(physicalGroups[left] ?? ''));
  }).map((branch) => branch.id).sort();
  const expected = policy.policy === 'PE_SEPARATE_0V_FLOATING' ? 0 : 1;
  if (bondIds.length !== expected) {
    pushUniqueIssue(issues, issue(
      'EARTHING_POLICY_BOND_COUNT',
      `${policy.policy} requires exactly ${expected} observed 0V-PE bond(s); found ${bondIds.length}.`,
      bondIds.length ? bondIds : ['0V-PE:missing'],
    ));
  }
}

function observedPhaseSequence(phases: readonly PhaseNameV3[]): PhaseSequenceV3 | null {
  const value = phases.join('-');
  if (value === 'L1-L2-L3' || value === 'L2-L3-L1' || value === 'L3-L1-L2') return 'L1-L2-L3';
  if (value === 'L1-L3-L2' || value === 'L3-L2-L1' || value === 'L2-L1-L3') return 'L1-L3-L2';
  return null;
}

function pushAcLoadIssue(
  issues: CircuitIssueV3[],
  element: AcLoadElement | Extract<WorkshopDocumentV3['elements'][number], { kind: 'three-phase-load' }>,
  state: AcLoadSolutionV3['state'],
): void {
  if (state === 'OPEN_LINE_PATH') {
    pushUniqueIssue(issues, issue('OPEN_SOURCE_PATH', `AC load ${element.id} has no line source path.`, [terminalKey(element.id, element.kind === 'ac-load' ? element.lineTerminal : element.phaseTerminals.L1)]));
  } else if (state === 'OPEN_NEUTRAL_PATH') {
    const neutral = element.neutralTerminal;
    pushUniqueIssue(issues, issue('OPEN_RETURN_PATH', `AC load ${element.id} has no neutral return path.`, neutral ? [terminalKey(element.id, neutral)] : [element.id]));
  } else if (state === 'MISSING_PHASE') {
    pushUniqueIssue(issues, issue('MISSING_PHASE', `Three-phase load ${element.id} does not have three distinct phase paths.`, [element.id]));
  } else if (state === 'WRONG_PHASE_SEQUENCE') {
    pushUniqueIssue(issues, issue('WRONG_PHASE_SEQUENCE', `Three-phase load ${element.id} does not match the declared phase sequence.`, [element.id]));
  } else if (state === 'PE_AS_WORKING_RETURN') {
    pushUniqueIssue(issues, issue('PE_AS_WORKING_RETURN', `Load ${element.id} uses protective earth as a working-current return.`, [element.id]));
  }
}

function solveAcLoads(
  model: CircuitModel,
  physicalGroups: Readonly<Record<string, string>>,
  issues: CircuitIssueV3[],
): AcSolveResultV3 {
  const acSources = model.document.sources.filter(isAcSource).sort((left, right) => left.id.localeCompare(right.id));
  const shortedSourceIds = new Set<string>();
  const potentialsByComponent = new Map<string, {
    phases: Array<{ phase: PhaseNameV3; sourceId: string; terminal: string }>;
    neutrals: Array<{ sourceId: string; terminal: string }>;
  }>();
  for (const source of acSources) {
    if (!protectionInputsComplete(source)) {
      pushUniqueIssue(issues, issue(
        'PROTECTION_COORDINATION_BLOCKED',
        `Source ${source.id} needs prospective short-circuit current and protective-device curve inputs; coordination is not estimated.`,
        [source.id],
      ));
    }
    for (const phase of acPhaseTerminals(source)) {
      const key = terminalKey(source.id, phase.terminal);
      const component = model.netGraph.componentOf.get(key);
      if (!component) continue;
      const value = potentialsByComponent.get(component) ?? { phases: [], neutrals: [] };
      value.phases.push({ phase: phase.phase, sourceId: source.id, terminal: key });
      potentialsByComponent.set(component, value);
    }
    const neutralTerminal = acNeutralTerminal(source);
    if (neutralTerminal) {
      const key = terminalKey(source.id, neutralTerminal);
      const component = model.netGraph.componentOf.get(key);
      if (component) {
        const value = potentialsByComponent.get(component) ?? { phases: [], neutrals: [] };
        value.neutrals.push({ sourceId: source.id, terminal: key });
        potentialsByComponent.set(component, value);
      }
    }
  }
  for (const value of potentialsByComponent.values()) {
    const refs = [...value.phases.map((entry) => entry.terminal), ...value.neutrals.map((entry) => entry.terminal)].sort();
    if (value.phases.length && value.neutrals.length) {
      pushUniqueIssue(issues, issue('AC_PHASE_NEUTRAL_SHORT', 'An AC phase and neutral share one working conductor net.', refs));
      for (const sourceId of [...value.phases, ...value.neutrals].map((entry) => entry.sourceId)) shortedSourceIds.add(sourceId);
    }
    if (new Set(value.phases.map((entry) => entry.phase)).size > 1) {
      pushUniqueIssue(issues, issue('AC_PHASE_PHASE_SHORT', 'Distinct AC phases share one working conductor net.', refs));
      for (const sourceId of value.phases.map((entry) => entry.sourceId)) shortedSourceIds.add(sourceId);
    }
  }
  validateAcSourceSafety(model, acSources, physicalGroups, issues, shortedSourceIds);

  const acLoads: Record<string, AcLoadSolutionV3> = {};
  for (const element of [...model.document.elements].sort((left, right) => left.id.localeCompare(right.id))) {
    if (element.kind === 'ac-load') {
      const line = terminalKey(element.id, element.lineTerminal);
      const neutral = terminalKey(element.id, element.neutralTerminal);
      const pe = element.peTerminal ? terminalKey(element.id, element.peTerminal) : undefined;
      const candidates = acSources.map((source) => {
        const matchedPhase = acPhaseTerminals(source).find((phase) => sameComponent(model, line, terminalKey(source.id, phase.terminal)));
        const sourceNeutral = acNeutralTerminal(source);
        const neutralConnected = sourceNeutral !== undefined && sameComponent(model, neutral, terminalKey(source.id, sourceNeutral));
        const peConnected = pe === undefined || samePhysicalComponent(physicalGroups, pe, terminalKey(source.id, source.peTerminal));
        const peAsReturn = !neutralConnected && samePhysicalComponent(physicalGroups, neutral, terminalKey(source.id, source.peTerminal));
        return { source, matchedPhase, neutralConnected, peConnected, peAsReturn, score: (matchedPhase ? 4 : 0) + (neutralConnected ? 2 : 0) + (peConnected ? 1 : 0) };
      }).sort((left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id));
      const candidate = candidates[0];
      const peMissing = pe !== undefined && candidate?.peConnected !== true;
      if (peMissing) pushUniqueIssue(issues, issue('PE_MISSING', `${element.id} protective earth is not connected to its AC source PE.`, [element.id, pe]));
      const state: AcLoadSolutionV3['state'] = candidate?.peAsReturn
        ? 'PE_AS_WORKING_RETURN'
        : candidate?.matchedPhase && candidate.neutralConnected && shortedSourceIds.has(candidate.source.id)
          ? 'SHORTED'
          : !candidate?.matchedPhase
            ? 'OPEN_LINE_PATH'
            : !candidate.neutralConnected
              ? 'OPEN_NEUTRAL_PATH'
              : peMissing
                ? 'PE_MISSING'
                : 'ON';
      acLoads[element.id] = {
        energized: state === 'ON',
        state,
        ...(candidate ? { sourceId: candidate.source.id } : {}),
        connectedPhases: candidate?.matchedPhase ? [candidate.matchedPhase.phase] : [],
      };
      pushAcLoadIssue(issues, element, state);
    } else if (element.kind === 'three-phase-load') {
      const candidates = acSources.filter((source): source is AcThreePhaseSourceSystem => source.kind === 'ac-three-phase').map((source) => {
        const mapping = (['L1', 'L2', 'L3'] as const).map((loadPhase) => {
          const loadTerminal = terminalKey(element.id, element.phaseTerminals[loadPhase]);
          return acPhaseTerminals(source).find((sourcePhase) => sameComponent(model, loadTerminal, terminalKey(source.id, sourcePhase.terminal)))?.phase;
        });
        const neutralConnected = element.neutralTerminal === undefined || (source.neutralTerminal !== undefined
          && sameComponent(model, terminalKey(element.id, element.neutralTerminal), terminalKey(source.id, source.neutralTerminal)));
        const peConnected = element.peTerminal === undefined
          || samePhysicalComponent(physicalGroups, terminalKey(element.id, element.peTerminal), terminalKey(source.id, source.peTerminal));
        const peAsReturn = element.neutralTerminal !== undefined && !neutralConnected
          && samePhysicalComponent(physicalGroups, terminalKey(element.id, element.neutralTerminal), terminalKey(source.id, source.peTerminal));
        return { source, mapping, neutralConnected, peConnected, peAsReturn, score: mapping.filter(Boolean).length * 2 + (neutralConnected ? 1 : 0) + (peConnected ? 1 : 0) };
      }).sort((left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id));
      const candidate = candidates[0];
      const connectedPhases = (candidate?.mapping.filter((phase): phase is PhaseNameV3 => phase !== undefined) ?? []);
      const allPhases = connectedPhases.length === 3 && new Set(connectedPhases).size === 3;
      const expectedSequence = element.expectedPhaseSequence ?? candidate?.source.declaredPhaseSequence;
      const wrongSequence = allPhases && expectedSequence !== undefined && observedPhaseSequence(connectedPhases) !== expectedSequence;
      const peMissing = element.peTerminal !== undefined && candidate?.peConnected !== true;
      if (peMissing) pushUniqueIssue(issues, issue('PE_MISSING', `${element.id} protective earth is not connected to its three-phase source PE.`, [element.id, terminalKey(element.id, element.peTerminal as string)]));
      const state: AcLoadSolutionV3['state'] = candidate?.peAsReturn
        ? 'PE_AS_WORKING_RETURN'
        : candidate && allPhases && candidate.neutralConnected && shortedSourceIds.has(candidate.source.id)
          ? 'SHORTED'
          : !allPhases
            ? 'MISSING_PHASE'
            : wrongSequence
              ? 'WRONG_PHASE_SEQUENCE'
              : !candidate?.neutralConnected
                ? 'OPEN_NEUTRAL_PATH'
                : peMissing
                  ? 'PE_MISSING'
                  : 'ON';
      acLoads[element.id] = {
        energized: state === 'ON',
        state,
        ...(candidate ? { sourceId: candidate.source.id } : {}),
        connectedPhases,
      };
      pushAcLoadIssue(issues, element, state);
    }
  }
  return { acLoads, shortedSourceIds };
}

function solveAnalogPorts(
  model: CircuitModel,
  issues: CircuitIssueV3[],
  currentLoops: Readonly<Record<string, CurrentLoopSolutionV3>> = {},
): Record<string, AnalogPortSolutionV3> {
  const ports = model.document.elements
    .filter((element): element is AnalogPortElement => element.kind === 'analog-port')
    .sort((left, right) => left.id.localeCompare(right.id));
  const solutions: Record<string, AnalogPortSolutionV3> = {};
  const claimedCurrentInputs = new Map<string, CurrentLoopSolutionV3>();
  for (const loop of Object.values(currentLoops).sort((left, right) =>
    left.transmitterId.localeCompare(right.transmitterId))) {
    if (loop.receiverId && !claimedCurrentInputs.has(loop.receiverId)) {
      claimedCurrentInputs.set(loop.receiverId, loop);
    }
  }

  for (const port of ports) {
    const positive = terminalKey(port.id, port.positiveTerminal);
    const returned = terminalKey(port.id, port.returnTerminal);
    const required = port.required !== 'scenario';
    const peers = ports.filter((candidate) => candidate.id !== port.id);
    const sortedRefs = (peer?: AnalogPortElement): string[] =>
      peer ? [port.id, peer.id].sort() : [port.id];
    const save = (
      state: AnalogPortSolutionV3['state'],
      peer?: AnalogPortElement,
    ): void => {
      const source = peer
        ? port.direction === 'source' ? port : peer.direction === 'source' ? peer : undefined
        : undefined;
      const sink = peer
        ? port.direction === 'sink' ? port : peer.direction === 'sink' ? peer : undefined
        : undefined;
      solutions[port.id] = {
        connected: state === 'CONNECTED',
        state,
        ...(peer === undefined ? {} : { peerId: peer.id }),
        ...(source === undefined ? {} : { sourceId: source.id }),
        sourcePath: source && sink
          ? deterministicPath(
              model,
              terminalKey(source.id, source.positiveTerminal),
              terminalKey(sink.id, sink.positiveTerminal),
              source.id,
            )
          : null,
        returnPath: source && sink
          ? deterministicPath(
              model,
              terminalKey(sink.id, sink.returnTerminal),
              terminalKey(source.id, source.returnTerminal),
              source.id,
            )
          : null,
      };
    };

    const poweredLoop = claimedCurrentInputs.get(port.id);
    if (poweredLoop) {
      const state: AnalogPortSolutionV3['state'] = poweredLoop.state === 'POLARITY_REVERSED'
        ? 'POLARITY_REVERSED'
        : poweredLoop.state === 'RECEIVER_UNPOWERED'
          ? 'RECEIVER_UNPOWERED'
        : poweredLoop.state === 'OPEN_RETURN_PATH'
          ? 'OPEN_RETURN_PATH'
          : poweredLoop.state === 'OPEN_SOURCE_PATH' || poweredLoop.state === 'OPEN_SIGNAL_PATH'
            ? 'OPEN_SOURCE_PATH'
            : 'CONNECTED';
      solutions[port.id] = {
        connected: state === 'CONNECTED',
        state,
        peerId: poweredLoop.transmitterId,
        ...(poweredLoop.sourceId === undefined ? {} : { sourceId: poweredLoop.sourceId }),
        sourcePath: poweredLoop.signalPath,
        returnPath: poweredLoop.returnPath,
      };
      continue;
    }

    if (sameComponent(model, positive, returned)) {
      save('SHORTED');
      if (required) {
        pushUniqueIssue(issues, issue(
          'ANALOG_SIGNAL_SHORT',
          `Analog port ${port.id} has its signal + and return/G conductors shorted together.`,
          [positive, returned],
        ));
      }
      continue;
    }

    const correctlyJoined = peers.find((peer) =>
      peer.protocol === port.protocol
      && peer.direction !== port.direction
      && sameComponent(model, positive, terminalKey(peer.id, peer.positiveTerminal))
      && sameComponent(model, returned, terminalKey(peer.id, peer.returnTerminal)));
    if (correctlyJoined) {
      save('CONNECTED', correctlyJoined);
      continue;
    }

    const reversed = peers.find((peer) =>
      peer.protocol === port.protocol
      && peer.direction !== port.direction
      && sameComponent(model, positive, terminalKey(peer.id, peer.returnTerminal))
      && sameComponent(model, returned, terminalKey(peer.id, peer.positiveTerminal)));
    if (reversed) {
      save('POLARITY_REVERSED', reversed);
      if (required) {
        pushUniqueIssue(issues, issue(
          'ANALOG_POLARITY_REVERSED',
          `Analog pair ${port.id} ↔ ${reversed.id} has signal + and return/G reversed.`,
          sortedRefs(reversed),
        ));
      }
      continue;
    }

    const fullyJoined = peers.filter((peer) =>
      sameComponent(model, positive, terminalKey(peer.id, peer.positiveTerminal))
      && sameComponent(model, returned, terminalKey(peer.id, peer.returnTerminal)));
    const wrongMode = fullyJoined.find((peer) => peer.protocol !== port.protocol);
    if (wrongMode) {
      save('MODE_MISMATCH', wrongMode);
      if (required) {
        pushUniqueIssue(issues, issue(
          'ANALOG_MODE_MISMATCH',
          `Analog pair ${port.id} ↔ ${wrongMode.id} mixes ${port.protocol} and ${wrongMode.protocol}.`,
          sortedRefs(wrongMode),
        ));
      }
      continue;
    }
    const wrongDirection = fullyJoined.find((peer) => peer.direction === port.direction);
    if (wrongDirection) {
      save('DIRECTION_MISMATCH', wrongDirection);
      if (required) {
        pushUniqueIssue(issues, issue(
          'ANALOG_DIRECTION_MISMATCH',
          `Analog pair ${port.id} ↔ ${wrongDirection.id} connects two ${port.direction} ports.`,
          sortedRefs(wrongDirection),
        ));
      }
      continue;
    }

    const eligiblePeers = peers.filter((peer) =>
      peer.protocol === port.protocol && peer.direction !== port.direction);
    const positivePeer = eligiblePeers.find((peer) =>
      sameComponent(model, positive, terminalKey(peer.id, peer.positiveTerminal)));
    const returnPeer = eligiblePeers.find((peer) =>
      sameComponent(model, returned, terminalKey(peer.id, peer.returnTerminal)));
    if (positivePeer && !returnPeer) {
      save('OPEN_RETURN_PATH', positivePeer);
      if (required) {
        pushUniqueIssue(issues, issue(
          'ANALOG_RETURN_PATH_OPEN',
          `Analog pair ${port.id} ↔ ${positivePeer.id} has signal + continuity but no return/G path.`,
          sortedRefs(positivePeer),
        ));
      }
      continue;
    }
    if (returnPeer && !positivePeer) {
      save('OPEN_SOURCE_PATH', returnPeer);
      if (required) {
        pushUniqueIssue(issues, issue(
          'ANALOG_SOURCE_PATH_OPEN',
          `Analog pair ${port.id} ↔ ${returnPeer.id} has return/G continuity but no signal + path.`,
          sortedRefs(returnPeer),
        ));
      }
      continue;
    }

    save('OPEN_SOURCE_PATH');
    if (required) {
      pushUniqueIssue(issues, issue(
        'ANALOG_SOURCE_PATH_OPEN',
        `Analog port ${port.id} has no compatible signal + source/receiver path.`,
        [port.id, positive],
      ));
      pushUniqueIssue(issues, issue(
        'ANALOG_RETURN_PATH_OPEN',
        `Analog port ${port.id} has no compatible return/G path.`,
        [port.id, returned],
      ));
    }
  }

  return solutions;
}

interface CurrentLoopSolveResultV3 {
  currentLoops: Record<string, CurrentLoopSolutionV3>;
}

/**
 * Solves the manual wiring form used by a loop-powered transmitter:
 * source + → TX+ → TX− → receiver I+ → receiver I− → the same source 0 V.
 * The transmitter and receiver are electrical branches, so neither is merged
 * into a net as if it were a jumper.
 */
function solveTwoWireCurrentLoops(
  model: CircuitModel,
  sources: readonly DcSourceSystem[],
  issues: CircuitIssueV3[],
): CurrentLoopSolveResultV3 {
  const transmitters = model.document.elements
    .filter((element): element is TwoWireCurrentTransmitterElement =>
      element.kind === 'two-wire-current-transmitter')
    .sort((left, right) => left.id.localeCompare(right.id));
  const receivers = model.document.elements
    .filter((element): element is AnalogPortElement =>
      element.kind === 'analog-port'
      && element.protocol === 'analog-current'
      && element.direction === 'sink')
    .sort((left, right) => left.id.localeCompare(right.id));
  const currentLoops: Record<string, CurrentLoopSolutionV3> = {};
  const claimedReceivers = new Set<string>();

  const save = (
    transmitter: TwoWireCurrentTransmitterElement,
    state: CurrentLoopSolutionV3['state'],
    source?: DcSourceSystem,
    receiver?: AnalogPortElement,
  ): void => {
    const sourcePath = source
      ? deterministicPath(
          model,
          terminalKey(source.id, source.positiveTerminal),
          terminalKey(transmitter.id, transmitter.positiveTerminal),
          source.id,
        )
      : null;
    const signalPath = receiver
      ? deterministicPath(
          model,
          terminalKey(transmitter.id, transmitter.negativeTerminal),
          terminalKey(receiver.id, receiver.positiveTerminal),
          source?.id ?? transmitter.id,
        )
      : null;
    const returnPath = source && receiver
      ? deterministicPath(
          model,
          terminalKey(receiver.id, receiver.returnTerminal),
          terminalKey(source.id, source.returnTerminal),
          source.id,
        )
      : null;
    const receiverVoltageV = receiver?.inputResistanceOhms === undefined
      ? null
      : transmitter.currentA * receiver.inputResistanceOhms;
    const transmitterVoltageV = source === undefined || receiverVoltageV === null
      ? null
      : source.voltage - receiverVoltageV;
    currentLoops[transmitter.id] = {
      active: state === 'COMPLETE',
      state,
      transmitterId: transmitter.id,
      ...(receiver === undefined ? {} : { receiverId: receiver.id }),
      ...(source === undefined ? {} : { sourceId: source.id }),
      currentA: transmitter.currentA,
      receiverVoltageV,
      transmitterVoltageV,
      sourcePath,
      signalPath,
      returnPath,
    };
    if (receiver) claimedReceivers.add(receiver.id);
  };

  for (const transmitter of transmitters) {
    const txPositive = terminalKey(transmitter.id, transmitter.positiveTerminal);
    const txNegative = terminalKey(transmitter.id, transmitter.negativeTerminal);
    const required = transmitter.required !== 'scenario';
    const availableReceivers = receivers.filter((receiver) => !claimedReceivers.has(receiver.id));
    const source = sources.find((candidate) =>
      sameComponent(model, terminalKey(candidate.id, candidate.positiveTerminal), txPositive));
    const reversedSource = sources.find((candidate) =>
      sameComponent(model, terminalKey(candidate.id, candidate.positiveTerminal), txNegative)
      || sameComponent(model, terminalKey(candidate.id, candidate.returnTerminal), txPositive));
    const receiver = availableReceivers.find((candidate) =>
      sameComponent(model, txNegative, terminalKey(candidate.id, candidate.positiveTerminal)));
    const reversedReceiver = availableReceivers.find((candidate) =>
      sameComponent(model, txNegative, terminalKey(candidate.id, candidate.returnTerminal))
      || (source !== undefined
        && sameComponent(
          model,
          terminalKey(candidate.id, candidate.positiveTerminal),
          terminalKey(source.id, source.returnTerminal),
        )));

    if (reversedSource || reversedReceiver) {
      const candidateSource = source ?? reversedSource;
      const candidateReceiver = receiver ?? reversedReceiver;
      save(transmitter, 'POLARITY_REVERSED', candidateSource, candidateReceiver);
      if (required) {
        pushUniqueIssue(issues, issue(
          'CURRENT_LOOP_POLARITY_REVERSED',
          `Two-wire current loop ${transmitter.id} has TX +/− or receiver I+/I− reversed.`,
          [transmitter.id, ...(candidateReceiver ? [candidateReceiver.id] : [])],
        ));
      }
      continue;
    }

    if (!source) {
      save(transmitter, 'OPEN_SOURCE_PATH', undefined, receiver);
      if (required) {
        pushUniqueIssue(issues, issue(
          'CURRENT_LOOP_SOURCE_PATH_OPEN',
          `Two-wire transmitter ${transmitter.id} has no +24 V source path to its positive terminal.`,
          [transmitter.id, txPositive],
        ));
      }
      continue;
    }

    if (!receiver) {
      const soleReceiver = availableReceivers.length === 1 ? availableReceivers[0] : undefined;
      save(transmitter, 'OPEN_SIGNAL_PATH', source, soleReceiver);
      if (required) {
        pushUniqueIssue(issues, issue(
          'CURRENT_LOOP_SIGNAL_PATH_OPEN',
          `Two-wire transmitter ${transmitter.id} has no series path from TX− to an analog-current I+ terminal.`,
          [transmitter.id, txNegative, ...(soleReceiver ? [soleReceiver.id] : [])],
        ));
      }
      continue;
    }

    const receiverReturn = terminalKey(receiver.id, receiver.returnTerminal);
    const sourceReturn = terminalKey(source.id, source.returnTerminal);
    if (!sameComponent(model, receiverReturn, sourceReturn)) {
      save(transmitter, 'OPEN_RETURN_PATH', source, receiver);
      if (required) {
        pushUniqueIssue(issues, issue(
          'CURRENT_LOOP_RETURN_PATH_OPEN',
          `Two-wire current loop ${transmitter.id} reaches ${receiver.id} but its I− return does not reach the same source 0 V.`,
          [transmitter.id, receiver.id, receiverReturn],
        ));
      }
      continue;
    }

    if (receiver.supplyElementId) {
      const receiverSupply = model.document.elements.find((element): element is LoadElement =>
        element.kind === 'load' && element.id === receiver.supplyElementId);
      const receiverPowered = receiverSupply !== undefined && sources.some((candidate) =>
        sameComponent(
          model,
          terminalKey(candidate.id, candidate.positiveTerminal),
          terminalKey(receiverSupply.id, receiverSupply.positiveTerminal),
        )
        && sameComponent(
          model,
          terminalKey(candidate.id, candidate.returnTerminal),
          terminalKey(receiverSupply.id, receiverSupply.returnTerminal),
        )
        && (receiverSupply.onThresholdVoltage === undefined
          || candidate.voltage >= receiverSupply.onThresholdVoltage));
      if (!receiverPowered) {
        save(transmitter, 'RECEIVER_UNPOWERED', source, receiver);
        if (required) {
          pushUniqueIssue(issues, issue(
            'CURRENT_LOOP_RECEIVER_UNPOWERED',
            `Current receiver ${receiver.id} has a complete signal loop but its module supply is not powered.`,
            [transmitter.id, receiver.id, receiver.supplyElementId],
          ));
        }
        continue;
      }
    }

    const receiverVoltageV = receiver.inputResistanceOhms === undefined
      ? null
      : transmitter.currentA * receiver.inputResistanceOhms;
    const transmitterVoltageV = receiverVoltageV === null ? null : source.voltage - receiverVoltageV;
    if (
      receiver.maximumCurrentA !== undefined
      && transmitter.currentA > receiver.maximumCurrentA
    ) {
      save(transmitter, 'OVER_RANGE', source, receiver);
      if (required) {
        pushUniqueIssue(issues, issue(
          'CURRENT_LOOP_OVER_RANGE',
          `Two-wire current ${transmitter.currentA * 1000} mA exceeds ${receiver.id} limit ${receiver.maximumCurrentA * 1000} mA.`,
          [transmitter.id, receiver.id],
        ));
      }
      continue;
    }
    if (
      transmitterVoltageV === null
      || transmitterVoltageV < transmitter.minimumOperatingVoltageV
      || (transmitter.maximumLoopVoltageV !== undefined && source.voltage > transmitter.maximumLoopVoltageV)
    ) {
      save(transmitter, 'COMPLIANCE_INSUFFICIENT', source, receiver);
      if (required) {
        pushUniqueIssue(issues, issue(
          'CURRENT_LOOP_COMPLIANCE_INSUFFICIENT',
          `Two-wire current loop ${transmitter.id} lacks verified voltage headroom after receiver burden.`,
          [transmitter.id, receiver.id, source.id],
        ));
      }
      continue;
    }

    save(transmitter, 'COMPLETE', source, receiver);
  }

  return { currentLoops };
}

export function solveCircuit(model: CircuitModel): CircuitSolution {
  const issues = [...model.issues];
  const continuityGroups = physicalContinuityGroups(model);
  const { acLoads, shortedSourceIds: acSourceShorted } = solveAcLoads(model, continuityGroups, issues);
  validateEarthingBondPolicy(model, continuityGroups, issues);
  const allDcSources = model.document.sources.filter(isDcSource).sort((left, right) => left.id.localeCompare(right.id));
  const activeDcSources = allDcSources.filter((source) => source.enabledByElementId === undefined || acLoads[source.enabledByElementId]?.energized === true);
  for (const source of allDcSources.filter((candidate) => !activeDcSources.includes(candidate))) {
    pushUniqueIssue(issues, issue(
      'SOURCE_CONDITION_UNMET',
      `Source ${source.id} remains inactive until AC input ${source.enabledByElementId} is valid.`,
      [source.id, source.enabledByElementId as string],
    ));
  }
  const sourceShorted = new Set<string>();
  for (const source of activeDcSources) {
    const positive = terminalKey(source.id, source.positiveTerminal);
    const returned = terminalKey(source.id, source.returnTerminal);
    if (sameComponent(model, positive, returned)) {
      sourceShorted.add(source.id);
      pushUniqueIssue(issues, issue('DC_SHORT', `Source ${source.id} has a conductive +24 V to 0 V bypass.`, [positive, returned]));
    }
  }
  for (let leftIndex = 0; leftIndex < activeDcSources.length; leftIndex += 1) {
    const left = activeDcSources[leftIndex];
    for (const right of activeDcSources.slice(leftIndex + 1)) {
      const positivesJoined = sameComponent(
        model,
        terminalKey(left.id, left.positiveTerminal),
        terminalKey(right.id, right.positiveTerminal),
      );
      const returnsJoined = sameComponent(
        model,
        terminalKey(left.id, left.returnTerminal),
        terminalKey(right.id, right.returnTerminal),
      );
      if (positivesJoined && returnsJoined) {
        pushUniqueIssue(issues, issue(
          'PARALLEL_SOURCE',
          `Independent sources ${left.id} and ${right.id} are connected in parallel.`,
          [left.id, right.id],
        ));
      }
    }
  }

  const { terminals, acTerminalPotentials } = terminalElectricalSolutions(
    model,
    continuityGroups,
    activeDcSources,
    model.document.sources.filter(isAcSource),
    continuityGroups,
  );
  const { currentLoops } = solveTwoWireCurrentLoops(model, activeDcSources, issues);
  for (const loop of Object.values(currentLoops)) {
    if (!loop.receiverId || loop.receiverVoltageV === null || loop.sourceId === undefined) continue;
    const transmitter = model.document.elements.find((element): element is TwoWireCurrentTransmitterElement =>
      element.kind === 'two-wire-current-transmitter' && element.id === loop.transmitterId);
    const receiver = model.document.elements.find((element): element is AnalogPortElement =>
      element.kind === 'analog-port' && element.id === loop.receiverId);
    if (!transmitter || !receiver) continue;
    const intermediate = terminalKey(transmitter.id, transmitter.negativeTerminal);
    const intermediateGroup = continuityGroups[intermediate];
    for (const [node, group] of Object.entries(continuityGroups)) {
      if (intermediateGroup !== undefined && group === intermediateGroup) {
        terminals[node] = { state: 'positive', voltageV: loop.receiverVoltageV };
      }
    }
  }
  const analogPorts = solveAnalogPorts(model, issues, currentLoops);
  const sources = activeDcSources;
  const loads: Record<string, CircuitSolution['loads'][string]> = {};
  const energized = new Set<string>();
  for (const element of [...model.document.elements].sort((left, right) => left.id.localeCompare(right.id))) {
    if (element.kind !== 'load') continue;
    const positive = terminalKey(element.id, element.positiveTerminal);
    const returned = terminalKey(element.id, element.returnTerminal);
    const voltageV = voltageBetween(terminals, continuityGroups, positive, returned);
    const reversedSources = element.polarity === 'either' ? [] : sources.filter((source) => sameComponent(model, terminalKey(source.id, source.positiveTerminal), returned)
      && sameComponent(model, terminalKey(source.id, source.returnTerminal), positive));
    if (reversedSources.length) {
      loads[element.id] = {
        energized: false,
        state: 'REVERSED',
        sourceId: reversedSources[0].id,
        voltageV,
        currentA: 0,
        sourcePath: null,
        returnPath: null,
      };
      pushUniqueIssue(issues, issue('LOAD_REVERSED', `Load ${element.id} has +24 V and 0 V reversed.`, [positive, returned]));
      continue;
    }

    const normalSourcePaths = sources.filter((source) =>
      sameComponent(model, terminalKey(source.id, source.positiveTerminal), positive));
    const normalReturnPaths = sources.filter((source) =>
      sameComponent(model, terminalKey(source.id, source.returnTerminal), returned));
    const normalSource = normalSourcePaths.find((source) =>
      normalReturnPaths.some((returnedSource) => returnedSource.id === source.id));
    const reversedSourcePaths = element.polarity === 'either'
      ? sources.filter((source) => sameComponent(model, terminalKey(source.id, source.positiveTerminal), returned))
      : [];
    const reversedReturnPaths = element.polarity === 'either'
      ? sources.filter((source) => sameComponent(model, terminalKey(source.id, source.returnTerminal), positive))
      : [];
    const reversedSource = reversedSourcePaths.find((source) =>
      reversedReturnPaths.some((returnedSource) => returnedSource.id === source.id));
    const completedSource = normalSource ?? reversedSource;
    const completedInReverse = normalSource === undefined && reversedSource !== undefined;
    const sourcePaths = [...normalSourcePaths, ...reversedSourcePaths];
    const returnPaths = [...normalReturnPaths, ...reversedReturnPaths];
    const highTerminal = completedInReverse ? returned : positive;
    const lowTerminal = completedInReverse ? positive : returned;
    if (!sourcePaths.length) {
      const returnSource = returnPaths[0];
      const connectedLowTerminal = returnSource && normalReturnPaths.includes(returnSource) ? returned : positive;
      const missingHighTerminal = connectedLowTerminal === returned ? positive : returned;
      loads[element.id] = {
        energized: false,
        state: 'OPEN_SOURCE_PATH',
        voltageV,
        currentA: 0,
        sourcePath: null,
        returnPath: returnSource
          ? deterministicPath(model, connectedLowTerminal, terminalKey(returnSource.id, returnSource.returnTerminal), returnSource.id)
          : null,
      };
      pushUniqueIssue(issues, issue('OPEN_SOURCE_PATH', `Load ${element.id} has no +24 V source path.`, [missingHighTerminal]));
    } else if (!completedSource) {
      const source = sourcePaths[0];
      const connectedHighTerminal = normalSourcePaths.includes(source) ? positive : returned;
      const missingLowTerminal = connectedHighTerminal === positive ? returned : positive;
      loads[element.id] = {
        energized: false,
        state: 'OPEN_RETURN_PATH',
        voltageV,
        currentA: 0,
        sourcePath: deterministicPath(model, terminalKey(source.id, source.positiveTerminal), connectedHighTerminal, source.id),
        returnPath: null,
      };
      pushUniqueIssue(issues, issue('OPEN_RETURN_PATH', `Load ${element.id} has no 0 V return path.`, [missingLowTerminal]));
    } else if (element.forbiddenSourceIds?.includes(completedSource.id)) {
      loads[element.id] = {
        energized: false,
        state: 'WRONG_SOURCE',
        sourceId: completedSource.id,
        voltageV,
        currentA: 0,
        sourcePath: deterministicPath(
          model,
          terminalKey(completedSource.id, completedSource.positiveTerminal),
          highTerminal,
          completedSource.id,
        ),
        returnPath: deterministicPath(
          model,
          lowTerminal,
          terminalKey(completedSource.id, completedSource.returnTerminal),
          completedSource.id,
        ),
      };
      pushUniqueIssue(issues, issue(
        'INPUT_SOURCE_MISMATCH',
        `Digital input ${element.id} is powered from forbidden source ${completedSource.id}; use the manual-required external source pair.`,
        [element.id, completedSource.id, positive, returned],
      ));
    } else if (sourceShorted.has(completedSource.id)) {
      loads[element.id] = {
        energized: false,
        state: 'SHORTED',
        sourceId: completedSource.id,
        voltageV,
        currentA: null,
        sourcePath: deterministicPath(model, terminalKey(completedSource.id, completedSource.positiveTerminal), highTerminal, completedSource.id),
        returnPath: deterministicPath(model, lowTerminal, terminalKey(completedSource.id, completedSource.returnTerminal), completedSource.id),
      };
    } else {
      const sourcePath = deterministicPath(model, terminalKey(completedSource.id, completedSource.positiveTerminal), highTerminal, completedSource.id);
      const returnPath = deterministicPath(model, lowTerminal, terminalKey(completedSource.id, completedSource.returnTerminal), completedSource.id);
      const currentA = resistiveCurrent(element, 'ON', voltageV);
      const voltageBelowThreshold = element.onThresholdVoltage !== undefined
        && (voltageV === null || Math.abs(voltageV) < element.onThresholdVoltage);
      const currentBelowThreshold = element.onThresholdCurrentA !== undefined
        && (currentA === null || currentA < element.onThresholdCurrentA);
      const belowThreshold = voltageBelowThreshold || currentBelowThreshold;
      const state = belowThreshold
        ? element.role === 'digital-input' ? 'BELOW_THRESHOLD' as const : 'INACTIVE' as const
        : 'ON' as const;
      loads[element.id] = {
        energized: !belowThreshold,
        state,
        sourceId: completedSource.id,
        voltageV,
        currentA,
        sourcePath,
        returnPath,
      };
      if (belowThreshold) {
        const code = element.role === 'digital-input'
          ? 'INPUT_CURRENT_BELOW_THRESHOLD'
          : 'LOAD_INACTIVE';
        pushUniqueIssue(issues, issue(
          code,
          element.role === 'digital-input'
            ? `Digital input ${element.id} is fully wired but below its ON voltage/current threshold.`
            : `Load ${element.id} is fully wired but below its pickup/operating threshold.`,
          [positive, returned],
        ));
      } else {
        energized.add(positive);
        energized.add(returned);
      }
    }
  }
  for (const source of activeDcSources) {
    const positive = terminalKey(source.id, source.positiveTerminal);
    if (!sourceShorted.has(source.id)) {
      for (const [node, component] of model.netGraph.componentOf) {
        if (component === model.netGraph.componentOf.get(positive)) energized.add(node);
      }
    }
  }

  const mutableBranchCurrents = new Map<string, { currentA: number | null; loadIds: Set<string> }>();
  for (const branch of [...model.document.branches].sort((left, right) => left.id.localeCompare(right.id))) {
    mutableBranchCurrents.set(branch.id, { currentA: branch.conductor === 'dc' ? 0 : null, loadIds: new Set() });
  }
  for (const [loadId, loadSolution] of Object.entries(loads).sort(([left], [right]) => left.localeCompare(right))) {
    if (!['ON', 'INACTIVE', 'BELOW_THRESHOLD'].includes(loadSolution.state)) continue;
    const pathBranchIds = new Set([
      ...(loadSolution.sourcePath?.branchIds ?? []),
      ...(loadSolution.returnPath?.branchIds ?? []),
    ]);
    for (const branchId of pathBranchIds) {
      const branch = mutableBranchCurrents.get(branchId);
      if (!branch) continue;
      branch.loadIds.add(loadId);
      branch.currentA = branch.currentA === null || loadSolution.currentA === null
        ? null
        : branch.currentA + loadSolution.currentA;
    }
  }
  for (const loop of Object.values(currentLoops).sort((left, right) =>
    left.transmitterId.localeCompare(right.transmitterId))) {
    if (loop.state !== 'COMPLETE' && loop.state !== 'OVER_RANGE') continue;
    const pathBranchIds = new Set([
      ...(loop.sourcePath?.branchIds ?? []),
      ...(loop.signalPath?.branchIds ?? []),
      ...(loop.returnPath?.branchIds ?? []),
    ]);
    for (const branchId of pathBranchIds) {
      const branch = mutableBranchCurrents.get(branchId);
      if (!branch) continue;
      branch.loadIds.add(loop.transmitterId);
      branch.currentA = branch.currentA === null ? loop.currentA : branch.currentA + loop.currentA;
    }
  }
  const branchCurrents: Record<string, BranchCurrentSolutionV3> = Object.fromEntries(
    [...mutableBranchCurrents].map(([branchId, value]) => [branchId, {
      currentA: value.currentA,
      loadIds: [...value.loadIds].sort(),
    }]),
  );

  const elements: Record<string, ElementElectricalSolutionV3> = {};
  for (const source of [...model.document.sources].sort((left, right) => left.id.localeCompare(right.id))) {
    if (isDcSource(source)) {
      const active = activeDcSources.includes(source);
      const positive = terminalKey(source.id, source.positiveTerminal);
      const returned = terminalKey(source.id, source.returnTerminal);
      const sourceLoadEntries = Object.entries(loads).filter(([, loadSolution]) =>
        ['ON', 'INACTIVE', 'BELOW_THRESHOLD'].includes(loadSolution.state)
        && loadSolution.sourceId === source.id);
      const sourceLoads = sourceLoadEntries.map(([, loadSolution]) => loadSolution);
      const sourceLoops = Object.values(currentLoops).filter((loop) =>
        (loop.state === 'COMPLETE' || loop.state === 'OVER_RANGE')
        && loop.sourceId === source.id);
      const sourceCurrent = !active
        ? 0
        : sourceShorted.has(source.id) || sourceLoads.some((loadSolution) => loadSolution.currentA === null)
          ? null
          : sourceLoads.reduce((sum, loadSolution) => sum + (loadSolution.currentA ?? 0), 0)
            + sourceLoops.reduce((sum, loop) => sum + loop.currentA, 0);
      if (active && !sourceShorted.has(source.id) && source.maximumCurrentA !== undefined) {
        if (sourceCurrent === null) {
          pushUniqueIssue(issues, issue(
            'SOURCE_CAPACITY_BLOCKED',
            `Source ${source.id} capacity cannot be checked because at least one active load current is unknown.`,
            [source.id, ...sourceLoadEntries.filter(([, loadSolution]) => loadSolution.currentA === null).map(([elementId]) => elementId)],
          ));
        } else if (sourceCurrent > source.maximumCurrentA) {
          pushUniqueIssue(issues, issue(
            'SOURCE_CURRENT_EXCEEDED',
            `Source ${source.id} current ${sourceCurrent.toFixed(4)} A exceeds its ${source.maximumCurrentA.toFixed(4)} A continuous rating.`,
            [source.id, ...sourceLoadEntries.map(([elementId]) => elementId)],
          ));
        }
      }
      elements[source.id] = {
        kind: 'source',
        state: !active ? 'SOURCE_INACTIVE' : sourceShorted.has(source.id) ? 'SOURCE_SHORTED' : 'SOURCE_ACTIVE',
        terminals: terminalsFor(sourceTerminals(source), source.id, terminals),
        voltageV: active ? voltageBetween(terminals, continuityGroups, positive, returned) : null,
        currentA: sourceCurrent,
        sourceId: source.id,
        sourcePath: null,
        returnPath: null,
      };
    } else {
      elements[source.id] = {
        kind: 'source',
        state: acSourceShorted.has(source.id) ? 'SOURCE_SHORTED' : 'SOURCE_ACTIVE',
        terminals: terminalsFor(sourceTerminals(source), source.id, terminals),
        voltageV: source.kind === 'ac-single-phase' ? source.lineToNeutralVoltage : source.lineToLineVoltage,
        currentA: null,
        sourceId: source.id,
        sourcePath: null,
        returnPath: null,
      };
    }
  }
  for (const element of [...model.document.elements].sort((left, right) => left.id.localeCompare(right.id))) {
    if (element.kind === 'load') {
      const loadSolution = loads[element.id];
      elements[element.id] = {
        kind: 'load',
        state: loadSolution.state,
        terminals: terminalsFor([element.positiveTerminal, element.returnTerminal], element.id, terminals),
        voltageV: loadSolution.voltageV,
        currentA: loadSolution.currentA,
        ...(loadSolution.sourceId === undefined ? {} : { sourceId: loadSolution.sourceId }),
        sourcePath: loadSolution.sourcePath,
        returnPath: loadSolution.returnPath,
      };
    } else if (element.kind === 'ac-load' || element.kind === 'three-phase-load') {
      const loadSolution = acLoads[element.id];
      elements[element.id] = {
        kind: element.kind,
        state: loadSolution.state,
        terminals: terminalsFor(elementTerminals(element), element.id, terminals),
        voltageV: null,
        currentA: null,
        ...(loadSolution.sourceId === undefined ? {} : { sourceId: loadSolution.sourceId }),
        sourcePath: null,
        returnPath: null,
      };
    } else if (element.kind === 'analog-port') {
      const portSolution = analogPorts[element.id];
      elements[element.id] = {
        kind: 'analog-port',
        state: portSolution.state,
        terminals: terminalsFor(
          [element.positiveTerminal, element.returnTerminal],
          element.id,
          terminals,
        ),
        voltageV: null,
        currentA: null,
        ...(portSolution.sourceId === undefined ? {} : { sourceId: portSolution.sourceId }),
        sourcePath: portSolution.sourcePath,
        returnPath: portSolution.returnPath,
      };
    } else if (element.kind === 'transistor-output') {
      const requested = model.activeContactStates[element.stateKey] ?? element.defaultState ?? false;
      const supplyPowered = element.supplyElementId === undefined
        ? model.activeTransistorStates[element.id] === true
        : loads[element.supplyElementId]?.energized === true;
      const controlPowered = element.controlPowerElementId === undefined
        || acLoads[element.controlPowerElementId]?.energized === true;
      const state = !requested
        ? 'OUTPUT_OFF' as const
        : supplyPowered && controlPowered && model.activeTransistorStates[element.id] === true
          ? 'OUTPUT_ON' as const
          : 'OUTPUT_UNPOWERED' as const;
      if (state === 'OUTPUT_UNPOWERED') {
        pushUniqueIssue(issues, issue(
          'TRANSISTOR_OUTPUT_UNPOWERED',
          `Transistor output ${element.id} was commanded ON without complete output and CPU power.`,
          [element.id, element.controlPowerElementId ?? element.supplyElementId ?? element.parentDeviceId ?? element.id],
        ));
      }
      const output = terminalKey(element.id, element.outputTerminal);
      const switchedRail = terminalKey(
        element.id,
        element.mode === 'sinking' ? element.supplyReturnTerminal : element.supplyPositiveTerminal,
      );
      elements[element.id] = {
        kind: 'transistor-output',
        state,
        terminals: terminalsFor(elementTerminals(element), element.id, terminals),
        voltageV: voltageBetween(terminals, continuityGroups, output, switchedRail),
        currentA: null,
        sourcePath: null,
        returnPath: null,
      };
    } else if (element.kind === 'two-wire-current-transmitter') {
      const loop = currentLoops[element.id];
      elements[element.id] = {
        kind: 'two-wire-current-transmitter',
        state: loop.state,
        terminals: terminalsFor(elementTerminals(element), element.id, terminals),
        voltageV: loop.transmitterVoltageV,
        currentA: loop.state === 'COMPLETE' || loop.state === 'OVER_RANGE' ? loop.currentA : 0,
        ...(loop.sourceId === undefined ? {} : { sourceId: loop.sourceId }),
        sourcePath: loop.sourcePath,
        returnPath: loop.returnPath,
      };
    } else if (element.kind === 'contact') {
      const left = terminalKey(element.id, element.terminalA);
      const right = terminalKey(element.id, element.terminalB);
      elements[element.id] = {
        kind: 'contact',
        state: isContactClosed(element, model.activeContactStates) ? 'CLOSED' : 'OPEN',
        terminals: terminalsFor([element.terminalA, element.terminalB], element.id, terminals),
        voltageV: voltageBetween(terminals, continuityGroups, left, right),
        currentA: null,
        sourcePath: null,
        returnPath: null,
      };
    } else {
      elements[element.id] = {
        kind: 'device',
        state: 'PASSIVE',
        terminals: terminalsFor(element.terminals, element.id, terminals),
        voltageV: null,
        currentA: null,
        sourcePath: null,
        returnPath: null,
      };
    }
  }

  return {
    loads,
    acLoads,
    analogPorts,
    currentLoops,
    elements,
    terminals,
    acTerminalPotentials,
    continuityGroups,
    branchCurrents,
    energizedTerminals: [...energized].sort(),
    issues,
  };
}

/** Creates a read-only meter over one immutable solver snapshot; it never changes circuit state. */
export function createVirtualMultimeter(solution: CircuitSolution): VirtualMultimeterV3 {
  const probeKey = (probe: TerminalReferenceV3): string => terminalKey(probe.elementId, probe.terminalId);
  return Object.freeze({
    voltage(positiveProbe: TerminalReferenceV3, negativeProbe: TerminalReferenceV3) {
      const positive = probeKey(positiveProbe);
      const negative = probeKey(negativeProbe);
      const positiveTerminal = solution.terminals[positive];
      const negativeTerminal = solution.terminals[negative];
      if (!positiveTerminal || !negativeTerminal) return { status: 'unknown-terminal' as const, voltageV: null };
      if (solution.continuityGroups[positive] === solution.continuityGroups[negative]) {
        return { status: 'measured' as const, voltageV: 0 };
      }
      const positiveAc = solution.acTerminalPotentials[positive];
      const negativeAc = solution.acTerminalPotentials[negative];
      if (positiveAc && negativeAc && positiveAc.sourceId === negativeAc.sourceId) {
        if (positiveAc.conductor === negativeAc.conductor) return { status: 'measured' as const, voltageV: 0 };
        const lineToNeutral = positiveAc.lineToNeutralVoltage;
        const lineToLine = positiveAc.lineToLineVoltage;
        if ((positiveAc.conductor === 'L1' || positiveAc.conductor === 'L2' || positiveAc.conductor === 'L3')
          && (negativeAc.conductor === 'N' || negativeAc.conductor === 'PE')) {
          return lineToNeutral === null ? { status: 'indeterminate' as const, voltageV: null } : { status: 'measured' as const, voltageV: lineToNeutral };
        }
        if ((negativeAc.conductor === 'L1' || negativeAc.conductor === 'L2' || negativeAc.conductor === 'L3')
          && (positiveAc.conductor === 'N' || positiveAc.conductor === 'PE')) {
          return lineToNeutral === null ? { status: 'indeterminate' as const, voltageV: null } : { status: 'measured' as const, voltageV: -lineToNeutral };
        }
        if (lineToLine !== null) return { status: 'measured' as const, voltageV: lineToLine };
      }
      if (positiveTerminal.voltageV === null || negativeTerminal.voltageV === null) {
        return { status: 'indeterminate' as const, voltageV: null };
      }
      return { status: 'measured' as const, voltageV: positiveTerminal.voltageV - negativeTerminal.voltageV };
    },
    continuity(leftProbe: TerminalReferenceV3, rightProbe: TerminalReferenceV3) {
      const left = probeKey(leftProbe);
      const right = probeKey(rightProbe);
      if (!solution.terminals[left] || !solution.terminals[right]) {
        return { status: 'unknown-terminal' as const, continuous: null };
      }
      return {
        status: 'measured' as const,
        continuous: solution.continuityGroups[left] === solution.continuityGroups[right],
      };
    },
    branchCurrent(branchId: string) {
      const branch = solution.branchCurrents[branchId];
      if (!branch) return { status: 'unknown-branch' as const, currentA: null, loadIds: [] as const };
      if (branch.currentA === null) {
        return { status: 'indeterminate' as const, currentA: null, loadIds: [...branch.loadIds] };
      }
      return { status: 'measured' as const, currentA: branch.currentA, loadIds: [...branch.loadIds] };
    },
  });
}

function scopeIssues(document: WorkshopDocumentV3): CircuitIssueV3[] {
  const scoped = new Set(document.reviewScope.elementIds);
  const unscoped = document.elements.filter((element) => !scoped.has(element.id));
  return unscoped.length
    ? [issue('REVIEW_SCOPE_INCOMPLETE', 'Every v3 electrical element must be in the review scope.', unscoped.map((element) => element.id))]
    : [];
}

function validationStatus(issues: readonly CircuitIssueV3[]): Exclude<ValidationResultV3['status'], 'STALE'> {
  if (issues.some((entry) => entry.code === 'AC_PHASE_PE_FAULT'
    || entry.code === 'PARALLEL_SOURCE'
    || entry.code === 'EARTHING_POLICY_BOND_COUNT')) return 'FAIL';
  if (issues.some((entry) => entry.code === 'REVIEW_SCOPE_INCOMPLETE'
    || entry.code === 'UNKNOWN_TERMINAL'
    || entry.code === 'DUPLICATE_ELEMENT_ID'
    || entry.code === 'INVALID_CONTACT_RULE'
    || entry.code === 'NON_CONVERGENT_SIMULATION'
    || entry.code === 'PROTECTION_COORDINATION_BLOCKED'
    || entry.code === 'SOURCE_CAPACITY_BLOCKED')) return 'BLOCKED';
  return issues.some((entry) => entry.blocking) ? 'FAIL' : 'PASS';
}

function validationFromSolution(document: WorkshopDocumentV3, solution: CircuitSolution): ValidationResultV3 {
  const scenarioControlled = new Set(document.elements
    .filter((element) => (element.kind === 'load' || element.kind === 'ac-load' || element.kind === 'three-phase-load') && element.required === 'scenario')
    .map((element) => element.id));
  const issues = [
    ...solution.issues.filter((entry) => !(
      (entry.code === 'OPEN_SOURCE_PATH' || entry.code === 'OPEN_RETURN_PATH')
      && entry.refs.some((ref) => scenarioControlled.has(ref.slice(0, ref.indexOf(':'))))
    )),
    ...scopeIssues(document),
  ];
  return { status: validationStatus(issues), issues, documentRevision: document.revision, documentHash: document.hash };
}

export function validateWorkshopV3(document: WorkshopDocumentV3): ValidationResultV3 {
  // The baseline is a real deterministic scenario as well. This keeps static
  // validation and I/O simulation on the same fixed-point path for
  // coil-driven contacts, converter status contacts, and future dynamic
  // elements instead of validating only their nominal NO/NC state.
  return simulateScenario(document, { id: 'baseline' }).validation;
}

export function isValidationCurrent(validation: ValidationResultV3, document: WorkshopDocumentV3): boolean {
  return validation.documentRevision === document.revision && validation.documentHash === document.hash;
}

function stateSnapshot(states: Readonly<Record<string, boolean>>): string {
  return Object.entries(states).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}:${value}`).join('|');
}

function resolvedContactRules(
  document: WorkshopDocumentV3,
  scenario: SimulationScenarioV3,
): { rules: readonly ContactRuleV3[]; issue: CircuitIssueV3 | null } {
  const rulesByStateKey = new Map<string, ContactRuleV3>();
  for (const contact of document.elements.filter((element): element is ContactElement => element.kind === 'contact')) {
    if (!contact.drivenBy) continue;
    rulesByStateKey.set(contact.stateKey, {
      stateKey: contact.stateKey,
      senseElementId: contact.drivenBy.elementId,
      mode: contact.drivenBy.mode,
    });
  }
  for (const rule of scenario.contactRules ?? []) {
    const builtIn = rulesByStateKey.get(rule.stateKey);
    if (builtIn && (
      builtIn.senseElementId !== (rule.senseElementId ?? rule.sense?.elementId)
      || builtIn.mode !== rule.mode
    )) {
      return {
        rules: [...rulesByStateKey.values()],
        issue: issue(
          'INVALID_CONTACT_RULE',
          `Contact rule ${rule.stateKey} cannot override the contact's built-in electromechanical drive.`,
          [scenario.id, rule.stateKey, builtIn.senseElementId ?? 'sense:missing'],
        ),
      };
    }
    rulesByStateKey.set(rule.stateKey, rule);
  }
  return { rules: [...rulesByStateKey.values()], issue: null };
}

function invalidContactRuleIssue(
  document: WorkshopDocumentV3,
  scenario: SimulationScenarioV3,
  rules: readonly ContactRuleV3[],
): CircuitIssueV3 | null {
  for (const rule of rules) {
    const targets = document.elements.filter((element): element is ContactElement => element.kind === 'contact' && element.stateKey === rule.stateKey);
    if (targets.length !== 1) {
      return issue('INVALID_CONTACT_RULE', `Contact rule ${rule.stateKey} must target exactly one contact state key.`, [scenario.id, rule.stateKey]);
    }
    const sensedElementId = rule.senseElementId ?? rule.sense?.elementId;
    const sensed = sensedElementId === undefined
      ? undefined
      : document.elements.find((element) => element.id === sensedElementId);
    if (sensed?.kind !== 'load' && sensed?.kind !== 'ac-load' && sensed?.kind !== 'three-phase-load') {
      return issue('INVALID_CONTACT_RULE', `Contact rule ${rule.stateKey} must sense a solved load, coil, or control-supply element.`, [scenario.id, rule.stateKey, sensedElementId ?? 'sense:missing']);
    }
    const sensedTerminals = elementTerminals(sensed);
    if (rule.sense && (rule.sense.elementId !== sensed.id || !sensedTerminals.includes(rule.sense.terminalId))) {
      return issue('INVALID_CONTACT_RULE', `Contact rule ${rule.stateKey} has an invalid sensed terminal mapping.`, [scenario.id, rule.stateKey, `${rule.sense.elementId}:${rule.sense.terminalId}`]);
    }
  }
  return null;
}

export function simulateScenario(document: WorkshopDocumentV3, scenario: SimulationScenarioV3): ScenarioSimulationV3 {
  let states: Record<string, boolean> = { ...scenario.contactStates };
  const seen = new Set<string>();
  let model = buildCircuitModel(document, states);
  let solution = solveCircuit(model);
  const resolvedRules = resolvedContactRules(document, scenario);
  const invalidRule = resolvedRules.issue ?? invalidContactRuleIssue(document, scenario, resolvedRules.rules);
  if (invalidRule) {
    const validationIssues = [...solution.issues, ...scopeIssues(document), invalidRule];
    return {
      scenarioId: scenario.id,
      converged: false,
      iterations: 0,
      contactStates: states,
      solution: { ...solution, issues: validationIssues },
      validation: { status: 'BLOCKED', issues: validationIssues, documentRevision: document.revision, documentHash: document.hash },
    };
  }
  for (let iteration = 1; iteration <= 32; iteration += 1) {
    const snapshot = stateSnapshot(states);
    if (seen.has(snapshot)) {
      const nonConvergent = issue('NON_CONVERGENT_SIMULATION', 'Contact states did not converge within the deterministic solve.', [scenario.id]);
      const validationIssues = [...solution.issues, ...scopeIssues(document), nonConvergent];
      return {
        scenarioId: scenario.id, converged: false, iterations: iteration - 1, contactStates: states, solution: { ...solution, issues: validationIssues },
        validation: { status: 'BLOCKED', issues: validationIssues, documentRevision: document.revision, documentHash: document.hash },
      };
    }
    seen.add(snapshot);
    const next = { ...states };
    for (const rule of resolvedRules.rules) {
      const sensedElementId = rule.senseElementId ?? rule.sense?.elementId;
      const sensed = solution.loads[sensedElementId as string]?.energized === true
        || solution.acLoads[sensedElementId as string]?.energized === true;
      next[rule.stateKey] = rule.mode === 'closed-when-energized' ? sensed : !sensed;
    }
    if (stateSnapshot(next) === snapshot) {
      const validation = validationFromSolution(document, solution);
      return { scenarioId: scenario.id, converged: true, iterations: iteration, contactStates: states, solution, validation };
    }
    states = next;
    model = buildCircuitModel(document, states);
    solution = solveCircuit(model);
  }
  const nonConvergent = issue('NON_CONVERGENT_SIMULATION', 'Contact states exceeded 32 fixed-point iterations.', [scenario.id]);
  const validationIssues = [...solution.issues, ...scopeIssues(document), nonConvergent];
  return {
    scenarioId: scenario.id, converged: false, iterations: 32, contactStates: states, solution: { ...solution, issues: validationIssues },
    validation: { status: 'BLOCKED', issues: validationIssues, documentRevision: document.revision, documentHash: document.hash },
  };
}
