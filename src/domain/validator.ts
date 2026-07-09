import type { DeviceProfile, WorkshopDocumentV2 } from './types';
import type { RuntimeState, ValidationIssue, ValidationResult } from './engine-types';
import { resolvePower, validateElectrical } from './electrical';
import { buildCircuitGraph } from './graph';
import { sha256 } from './migration';

export interface ValidationOptions {
  runtime?: RuntimeState;
  scenarioId?: string;
}

export async function validateWorkshop(
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const graph = buildCircuitGraph(document, catalog, options.runtime);
  const power = resolvePower(document, catalog, graph);
  const issues: ValidationIssue[] = [...graph.issues, ...validateElectrical(graph, power)];

  for (const instance of document.devices) {
    const profile = catalog[instance.profileId];
    if (!profile || instance.missingProfile) continue;
    if (profile.version !== instance.profileVersion) {
      issues.push({
        code: 'PROFILE_VERSION_MISMATCH', severity: 'blocked', blocking: true,
        message: `${instance.id} uses ${instance.profileVersion}, catalog has ${profile.version}.`, refs: [instance.id],
      });
    }
    if (document.mode === 'prewire' && !profile.boundary && profile.evidence.level === 'educational') {
      issues.push({
        code: 'UNVERIFIED_PROFILE', severity: 'blocked', blocking: true,
        message: `${profile.model} is not eligible for prewire verification.`, refs: [instance.id],
      });
    }
    if (document.mode === 'prewire' && !profile.boundary && instance.evidenceLevel === 'educational') {
      issues.push({
        code: 'INSTANCE_EVIDENCE_DOWNGRADED', severity: 'blocked', blocking: true,
        message: `${instance.id} has a local electrical override and is educational only.`, refs: [instance.id],
      });
    }
  }

  if (options.scenarioId) for (const entry of issues) entry.scenarioId = options.scenarioId;
  const status = issues.some((entry) => entry.severity === 'blocked')
    ? 'BLOCKED'
    : issues.some((entry) => entry.blocking)
      ? 'FAIL'
      : 'PASS';
  return {
    status,
    issues,
    documentRevision: document.revision,
    documentHash: await sha256(document),
    checkedAt: new Date().toISOString(),
  };
}
