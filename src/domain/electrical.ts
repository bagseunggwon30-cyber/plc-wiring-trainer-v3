import type { DeviceProfile, ElectricalPotential, WorkshopDocumentV2 } from './types';
import type { CircuitGraph, PowerResolution, PowerToken, ValidationIssue } from './engine-types';
import { terminalKey } from './graph';

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string): void { if (!this.parent.has(value)) this.parent.set(value, value); }
  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent) throw new Error(`Unknown union-find node ${value}`);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }
  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

function uniqueTokens(tokens: PowerToken[]): PowerToken[] {
  return [...new Map(tokens.map((token) => [`${token.potential}:${token.sourceId}`, token])).values()];
}

export function resolvePower(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  graph: CircuitGraph,
): PowerResolution {
  const union = new UnionFind();
  for (const key of graph.nodes.keys()) union.add(key);
  for (const edge of graph.edges) if (edge.active) union.union(edge.from, edge.to);

  const componentOf = new Map<string, string>();
  for (const key of graph.nodes.keys()) componentOf.set(key, union.find(key));
  const componentTokens = new Map<string, PowerToken[]>();
  const addToken = (key: string, token: PowerToken): boolean => {
    const component = componentOf.get(key);
    if (!component) return false;
    const existing = componentTokens.get(component) ?? [];
    if (existing.some((item) => item.potential === token.potential && item.sourceId === token.sourceId)) return false;
    componentTokens.set(component, [...existing, token]);
    return true;
  };

  for (const instance of document.devices) {
    const profile = catalog[instance.profileId];
    if (!profile?.boundary) continue;
    for (const terminal of profile.terminals) {
      if (terminal.role === 'source' && !['floating', 'signal'].includes(terminal.potential)) {
        addToken(terminalKey(instance.id, terminal.id), { potential: terminal.potential, sourceId: instance.id });
      }
    }
  }

  const activeDevices = new Set<string>();
  const componentPotentials = (key: string): Set<ElectricalPotential> => {
    const component = componentOf.get(key);
    return new Set((component ? componentTokens.get(component) : [])?.map((token) => token.potential) ?? []);
  };

  let changed = true;
  for (let pass = 0; pass < document.devices.length + 1 && changed; pass += 1) {
    changed = false;
    for (const instance of document.devices) {
      const profile = catalog[instance.profileId];
      const behavior = profile?.behavior?.kind;
      if (behavior !== 'ac-dc-power-supply' && behavior !== 'plc-relay') continue;
      const line = componentPotentials(terminalKey(instance.id, 'L'));
      const neutral = componentPotentials(terminalKey(instance.id, 'N'));
      const hasLine = ['L1', 'L2', 'L3'].some((potential) => line.has(potential as ElectricalPotential));
      if (!hasLine || !neutral.has('N')) continue;
      activeDevices.add(instance.id);
      const sourcePairs = behavior === 'ac-dc-power-supply'
        ? [['V+1', '+24V'], ['V+2', '+24V'], ['V-1', '0V'], ['V-2', '0V']] as const
        : [['24V', '+24V'], ['24G', '0V']] as const;
      for (const [terminalId, potential] of sourcePairs) {
        changed = addToken(terminalKey(instance.id, terminalId), { potential, sourceId: instance.id }) || changed;
      }
    }
  }

  for (const [component, tokens] of componentTokens) componentTokens.set(component, uniqueTokens(tokens));
  const energizedTerminals = new Set<string>();
  for (const [key, component] of componentOf) if ((componentTokens.get(component)?.length ?? 0) > 0) energizedTerminals.add(key);
  return { componentOf, componentTokens, activeDevices, energizedTerminals };
}

function issue(code: string, message: string, refs: string[]): ValidationIssue {
  return { code, severity: 'danger', blocking: true, message, refs };
}

export function validateElectrical(graph: CircuitGraph, power: PowerResolution): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodesByComponent = new Map<string, string[]>();
  for (const [key, component] of power.componentOf) nodesByComponent.set(component, [...(nodesByComponent.get(component) ?? []), key]);

  for (const [component, refs] of nodesByComponent) {
    const tokens = power.componentTokens.get(component) ?? [];
    const potentials = new Set(tokens.map((token) => token.potential));
    const phases = ['L1', 'L2', 'L3'].filter((potential) => potentials.has(potential as ElectricalPotential));
    if (phases.length && potentials.has('N')) issues.push(issue('AC_PHASE_NEUTRAL_SHORT', 'AC phase and neutral are shorted.', refs));
    if (phases.length > 1) issues.push(issue('AC_PHASE_CONFLICT', 'Multiple AC phases share one net.', refs));
    if (potentials.has('+24V') && potentials.has('0V')) issues.push(issue('DC_SHORT', 'DC +24V and 0V are shorted.', refs));
    if (potentials.has('PE') && [...potentials].some((potential) => potential !== 'PE')) issues.push(issue('PE_MIXED', 'Protective earth is mixed with an energized conductor.', refs));

    const byPotential = new Map<ElectricalPotential, Set<string>>();
    for (const token of tokens) {
      const sources = byPotential.get(token.potential) ?? new Set<string>();
      sources.add(token.sourceId);
      byPotential.set(token.potential, sources);
    }
    for (const [potential, sources] of byPotential) {
      if (sources.size > 1) issues.push(issue('PARALLEL_SOURCE', `Independent ${potential} sources are paralleled.`, refs));
    }

    const protocols = new Set(
      refs.map((key) => graph.nodes.get(key)?.terminal.protocol).filter((protocol): protocol is NonNullable<typeof protocol> => Boolean(protocol)),
    );
    if (protocols.has('analog-current') && protocols.has('analog-voltage')) {
      issues.push(issue('ANALOG_MODE_MISMATCH', 'Analog voltage and current terminals share one net.', refs));
    }
    const rs485Channels = new Set(
      refs
        .map((key) => graph.nodes.get(key)?.terminal)
        .filter((terminal) => terminal?.protocol === 'RS485')
        .map((terminal) => terminal?.channel)
        .filter(Boolean),
    );
    if (rs485Channels.has('A') && rs485Channels.has('B')) issues.push(issue('RS485_POLARITY_MISMATCH', 'RS485 A and B are crossed.', refs));

    for (const key of refs) {
      const terminal = graph.nodes.get(key)?.terminal;
      if (!terminal || ['floating', 'signal'].includes(terminal.potential) || terminal.role === 'source') continue;
      if (tokens.length && !potentials.has(terminal.potential)) {
        issues.push(issue('TERMINAL_POTENTIAL_MISMATCH', `${key} expects ${terminal.potential}.`, [key, ...refs]));
      }
    }
  }

  return [...new Map(issues.map((entry) => [`${entry.code}:${[...entry.refs].sort().join('|')}`, entry])).values()];
}

export function terminalPotentials(key: string, power: PowerResolution): Set<ElectricalPotential> {
  const component = power.componentOf.get(key);
  return new Set((component ? power.componentTokens.get(component) : [])?.map((token) => token.potential) ?? []);
}

