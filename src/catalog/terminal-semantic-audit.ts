import type { DeviceProfile, TerminalSpec } from '../domain/types';

export interface TerminalSemanticAuditIssue {
  readonly profileId: string;
  readonly terminalId: string;
  readonly code:
    | 'DUPLICATE_TERMINAL_ID'
    | 'AMBIGUOUS_TERMINAL_ROLE'
    | 'INTERNAL_LINK_TERMINAL_UNKNOWN'
    | 'DYNAMIC_CONTACT_ROLE_MISMATCH'
    | 'CHANGEOVER_CONTACT_MISMATCH';
  readonly message: string;
}

function matches(
  terminal: TerminalSpec,
  expected: Partial<TerminalSpec>,
): boolean {
  return Object.entries(expected).every(([key, value]) =>
    terminal[key as keyof TerminalSpec] === value);
}

function ambiguousRoleExpectation(terminal: TerminalSpec): Partial<TerminalSpec> | null {
  const id = terminal.id.trim().toUpperCase();
  if (id === '24G') {
    return { domain: 'dc', potential: '0V', polarity: 'return' };
  }
  if (id === 'COMI') {
    return { role: 'common', polarity: 'configurable', commonType: 'configurable-dc' };
  }
  if (/^COM\d+$/.test(id)) {
    if (terminal.outputMode === 'sinking-transistor') {
      return {
        domain: 'dc', potential: '0V', role: 'common', polarity: 'return',
        commonType: 'dc-output-common',
      };
    }
    return { role: 'common', polarity: 'nonpolar', commonType: 'dry-contact' };
  }
  if (/^CM\d*$/.test(id)) {
    return {
      domain: 'dc',
      potential: '0V',
      role: 'common',
      polarity: 'return',
      commonType: 'dc-control-common',
    };
  }
  if (id === 'MG') {
    return {
      domain: 'dc',
      potential: '0V',
      role: 'common',
      polarity: 'return',
      commonType: 'dc-output-common',
    };
  }
  if (id === 'SG') {
    return {
      domain: 'communication',
      role: 'common',
      polarity: 'reference',
      commonType: 'communication-reference',
    };
  }
  if (id === 'V') {
    return { domain: 'ac', polarity: 'line', phase: 'V' };
  }
  if (id === 'V1') {
    return { domain: 'signal', role: 'input', protocol: 'analog-voltage' };
  }
  if (id === 'VR') {
    return { domain: 'signal', role: 'source', protocol: 'analog-voltage' };
  }
  if (/^V\+/.test(id)) {
    return { domain: 'dc', potential: '+24V', polarity: 'positive' };
  }
  if (/^V-/.test(id)) {
    return { domain: 'dc', potential: '0V', polarity: 'return' };
  }
  if (id === 'PE' || id === 'FG') {
    return { domain: 'pe', potential: 'PE', polarity: 'protective-earth' };
  }
  return null;
}

function fixedPotentialExpectation(terminal: TerminalSpec): Partial<TerminalSpec> | null {
  if (terminal.potential === 'L1' || terminal.potential === 'L2' || terminal.potential === 'L3') {
    return { domain: 'ac', polarity: 'line', phase: terminal.potential };
  }
  if (terminal.potential === 'N') {
    return { domain: 'ac', polarity: 'neutral', phase: 'N' };
  }
  if (terminal.potential === '+24V') {
    return { domain: 'dc', polarity: 'positive' };
  }
  if (terminal.potential === '0V') {
    return { domain: 'dc', polarity: 'return' };
  }
  if (terminal.potential === 'PE') {
    return { domain: 'pe', polarity: 'protective-earth' };
  }
  if (terminal.phase === 'U' || terminal.phase === 'V' || terminal.phase === 'W') {
    return { domain: 'ac', potential: 'floating', polarity: 'line' };
  }
  return null;
}

/**
 * Guards labels that are routinely overloaded in control panels.
 *
 * It does not promote a profile from its label. Instead, it verifies that
 * explicit catalog potentials and overloaded labels agree with the exact role
 * that the renderer and circuit engine will use.
 */
export function auditProfileTerminalSemantics(
  profile: DeviceProfile,
): readonly TerminalSemanticAuditIssue[] {
  const issues: TerminalSemanticAuditIssue[] = [];
  const seen = new Set<string>();
  for (const terminal of profile.terminals) {
    if (seen.has(terminal.id)) {
      issues.push({
        profileId: profile.profileId,
        terminalId: terminal.id,
        code: 'DUPLICATE_TERMINAL_ID',
        message: `${profile.profileId}.${terminal.id} terminal ID is duplicated.`,
      });
      continue;
    }
    seen.add(terminal.id);
    const expectations = [
      ambiguousRoleExpectation(terminal),
      fixedPotentialExpectation(terminal),
    ].filter((expected): expected is Partial<TerminalSpec> => expected !== null);
    if (expectations.some((expected) => !matches(terminal, expected))) {
      issues.push({
        profileId: profile.profileId,
        terminalId: terminal.id,
        code: 'AMBIGUOUS_TERMINAL_ROLE',
        message: `${profile.profileId}.${terminal.id} does not explicitly match its L/N, +/0V, COM/G/V, or PE electrical role.`,
      });
    }
    if (
      terminal.id.trim().toUpperCase() === 'SG'
      && terminal.protocol !== 'RS232'
      && terminal.protocol !== 'RS485'
    ) {
      issues.push({
        profileId: profile.profileId,
        terminalId: terminal.id,
        code: 'AMBIGUOUS_TERMINAL_ROLE',
        message: `${profile.profileId}.${terminal.id} must identify its RS232 or RS485 reference domain.`,
      });
    }
    if (
      profile.profileId === 'ls-electric:sv-ig5a'
      && /^P[1-8]$/.test(terminal.id)
      && terminal.inputLogicMode !== 'configurable'
    ) {
      issues.push({
        profileId: profile.profileId,
        terminalId: terminal.id,
        code: 'AMBIGUOUS_TERMINAL_ROLE',
        message: `${profile.profileId}.${terminal.id} must remain configurable until the physical S8 NPN/PNP position is recorded.`,
      });
    }
  }

  const terminalsById = new Map(profile.terminals.map((terminal) => [terminal.id, terminal]));
  const changeoverLinks = new Map<string, typeof profile.internalLinks>();
  const isMultipoleProtection = profile.behavior?.kind === 'protection';
  for (const link of profile.internalLinks) {
    const from = terminalsById.get(link.from);
    const to = terminalsById.get(link.to);
    if (!from || !to) {
      issues.push({
        profileId: profile.profileId,
        terminalId: !from ? link.from : link.to,
        code: 'INTERNAL_LINK_TERMINAL_UNKNOWN',
        message: `${profile.profileId} internal ${link.kind} link references a terminal that is not declared.`,
      });
      continue;
    }
    if (link.kind !== 'dynamic-contact') continue;
    const switchingTerminal = (terminal: TerminalSpec) =>
      terminal.role === 'dry-contact'
      || terminal.commonType === 'dry-contact'
      || terminal.commonType === 'fused-power'
      || (isMultipoleProtection && (terminal.role === 'supply-input' || terminal.role === 'output'))
      || profile.boundary;
    if (!switchingTerminal(from) || !switchingTerminal(to)) {
      issues.push({
        profileId: profile.profileId,
        terminalId: `${link.from}-${link.to}`,
        code: 'DYNAMIC_CONTACT_ROLE_MISMATCH',
        message: `${profile.profileId}.${link.from}-${link.to} is dynamic but its terminals are not declared as a dry/fused contact.`,
      });
    }
    if (from.comGroup && to.comGroup && from.comGroup !== to.comGroup) {
      issues.push({
        profileId: profile.profileId,
        terminalId: `${link.from}-${link.to}`,
        code: 'DYNAMIC_CONTACT_ROLE_MISMATCH',
        message: `${profile.profileId}.${link.from}-${link.to} crosses two different contact groups.`,
      });
    }
    if (link.stateKey && !isMultipoleProtection) {
      changeoverLinks.set(link.stateKey, [...(changeoverLinks.get(link.stateKey) ?? []), link]);
    }
  }
  for (const [stateKey, links] of changeoverLinks) {
    if (links.length <= 1) continue;
    const states = new Set(links.map((link) => link.normally));
    const endpointSets = links.map((link) => new Set([link.from, link.to]));
    const sharedEndpoint = [...endpointSets[0]].find((terminalId) =>
      endpointSets.slice(1).every((endpoints) => endpoints.has(terminalId)));
    if (
      links.length !== 2
      || !states.has('open')
      || !states.has('closed')
      || !sharedEndpoint
    ) {
      issues.push({
        profileId: profile.profileId,
        terminalId: stateKey,
        code: 'CHANGEOVER_CONTACT_MISMATCH',
        message: `${profile.profileId}.${stateKey} must be one shared COM with exactly one de-energized closed (b/NC) and one open (a/NO) path.`,
      });
    }
  }
  return issues;
}
