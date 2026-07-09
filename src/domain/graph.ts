import type { DeviceProfile, WorkshopDocumentV2 } from './types';
import type { CircuitEdge, CircuitGraph, CircuitNode, RuntimeState, ValidationIssue } from './engine-types';

export const terminalKey = (deviceId: string, terminalId: string): string => `${deviceId}:${terminalId}`;

function blockedIssue(code: string, message: string, refs: string[]): ValidationIssue {
  return { code, severity: 'blocked', blocking: true, message, refs };
}

export function buildCircuitGraph(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  runtime: RuntimeState = {},
): CircuitGraph {
  const nodes = new Map<string, CircuitNode>();
  const edges: CircuitEdge[] = [];
  const issues: ValidationIssue[] = [];

  for (const instance of document.devices) {
    const profile = catalog[instance.profileId];
    if (!profile || instance.missingProfile) {
      issues.push(blockedIssue('MISSING_PROFILE', `Profile ${instance.profileId} is unavailable.`, [instance.id]));
      continue;
    }
    for (const terminal of profile.terminals) {
      const key = terminalKey(instance.id, terminal.id);
      nodes.set(key, { key, deviceId: instance.id, terminalId: terminal.id, terminal, profile });
    }
  }

  const addEdge = (edge: CircuitEdge): void => {
    const missing = [edge.from, edge.to].filter((key) => !nodes.has(key));
    if (missing.length) {
      issues.push(blockedIssue('UNKNOWN_TERMINAL', `Connection references unknown terminal(s): ${missing.join(', ')}`, missing));
      return;
    }
    edges.push(edge);
  };

  for (const wire of document.wires) {
    addEdge({
      id: wire.id,
      kind: 'wire',
      from: terminalKey(wire.from.deviceId, wire.from.terminalId),
      to: terminalKey(wire.to.deviceId, wire.to.terminalId),
      active: true,
    });
  }

  for (const jumper of document.jumpers) {
    const [first, ...rest] = jumper.terminalIds;
    for (const terminalId of rest) {
      addEdge({
        id: `${jumper.id}:${terminalId}`,
        kind: 'jumper',
        from: terminalKey(jumper.deviceId, first),
        to: terminalKey(jumper.deviceId, terminalId),
        active: true,
      });
    }
  }

  for (const instance of document.devices) {
    const profile = catalog[instance.profileId];
    if (!profile) continue;
    for (const [index, link] of profile.internalLinks.entries()) {
      const stateKey = `${instance.id}:${link.stateKey ?? ''}`;
      addEdge({
        id: `${instance.id}:internal:${index}`,
        kind: link.kind === 'conductive' ? 'internal' : 'dynamic-contact',
        from: terminalKey(instance.id, link.from),
        to: terminalKey(instance.id, link.to),
        active: link.kind === 'conductive' || runtime.contactStates?.[stateKey] === true,
      });
    }

    if (profile.behavior?.kind === 'plc-relay') {
      for (const outputId of runtime.forcedOutputs?.[instance.id] ?? []) {
        const output = profile.terminals.find((terminal) => terminal.id === outputId && terminal.role === 'output');
        if (!output?.comGroup) {
          issues.push(blockedIssue('UNKNOWN_FORCED_OUTPUT', `Cannot force unknown relay output ${outputId}.`, [instance.id, outputId]));
          continue;
        }
        addEdge({
          id: `${instance.id}:forced:${outputId}`,
          kind: 'dynamic-contact',
          from: terminalKey(instance.id, output.comGroup),
          to: terminalKey(instance.id, outputId),
          active: true,
        });
      }
    }
  }

  return { nodes, edges, issues };
}
