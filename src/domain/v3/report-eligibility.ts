import { isValidationCurrent } from './circuit';
import type { ScenarioSimulationV3, ValidationResultV3, WorkshopDocumentV3 } from './contracts';

export interface VerifiedReportRequirementsV3 {
  profilesEligible: boolean;
  assetsEligible: boolean;
  geometryEligible: boolean;
  physicalReviewPassed: boolean;
  requiredScenarioIds: readonly string[];
}

export interface VerifiedReportEligibilityV3 {
  eligible: boolean;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'STALE';
  reason: string | null;
}

/** Single fail-closed authority for VERIFIED_PREWIRE eligibility. */
export function canIssueVerifiedReportV3(
  document: WorkshopDocumentV3,
  validation: ValidationResultV3,
  simulations: readonly ScenarioSimulationV3[],
  requirements: VerifiedReportRequirementsV3,
): VerifiedReportEligibilityV3 {
  if (!isValidationCurrent(validation, document)) {
    return { eligible: false, status: 'STALE', reason: 'The document revision or hash changed after validation.' };
  }
  if (document.mode !== 'prewire') {
    return { eligible: false, status: 'BLOCKED', reason: 'VERIFIED_PREWIRE is available only in prewire mode.' };
  }
  if (validation.status !== 'PASS') {
    return { eligible: false, status: validation.status, reason: 'The current v3 validation result is not PASS.' };
  }
  if (!requirements.profilesEligible || !requirements.assetsEligible || !requirements.geometryEligible) {
    return { eligible: false, status: 'BLOCKED', reason: 'Exact profiles and approved asset/terminal geometry are required.' };
  }
  if (!requirements.physicalReviewPassed) {
    return { eligible: false, status: 'BLOCKED', reason: 'The physical placement and conductor review is incomplete.' };
  }
  const requiredScenarioIds = [...requirements.requiredScenarioIds].sort();
  if (new Set(requiredScenarioIds).size !== requiredScenarioIds.length) {
    return { eligible: false, status: 'BLOCKED', reason: 'Required scenario IDs must be unique.' };
  }
  const simulationById = new Map<string, ScenarioSimulationV3>();
  for (const simulation of simulations) {
    if (simulationById.has(simulation.scenarioId)) {
      return { eligible: false, status: 'BLOCKED', reason: `Scenario ${simulation.scenarioId} was reported more than once.` };
    }
    if (!isValidationCurrent(simulation.validation, document)) {
      return { eligible: false, status: 'STALE', reason: `Scenario ${simulation.scenarioId} was validated against a different revision or hash.` };
    }
    simulationById.set(simulation.scenarioId, simulation);
  }
  for (const scenarioId of requiredScenarioIds) {
    const simulation = simulationById.get(scenarioId);
    if (!simulation || !simulation.converged || simulation.validation.status !== 'PASS') {
      return { eligible: false, status: simulation?.validation.status ?? 'BLOCKED', reason: `Required scenario ${scenarioId} is missing or did not pass.` };
    }
  }
  return { eligible: true, status: 'PASS', reason: null };
}
