import type { ValidationResult } from '../../domain/engine-types';
import type {
  CircuitSolution,
  PrewireTerminalGeometryInputV3,
  ScenarioSimulationV3,
} from '../../domain/v3';
import type { WorkshopDocumentV2, WorkshopMode } from '../../domain/types';
import {
  type V3ReportClassification,
  type V3WorkflowState,
  validateV3WorkflowState,
} from './workflow-state';

export interface V3ValidationRequest {
  document: WorkshopDocumentV2;
  mode: WorkshopMode;
  workflow: V3WorkflowState;
  terminalGeometry?: PrewireTerminalGeometryInputV3;
  /** Compatibility hook while the v3 domain engine is being introduced. */
  validateLegacy: () => Promise<ValidationResult>;
}

export interface V3ValidationResult {
  validation: ValidationResult;
  classification: V3ReportClassification;
  circuitSolution?: CircuitSolution;
  scenarioSimulations?: readonly ScenarioSimulationV3[];
}

export interface V3ValidationPort {
  validate(request: V3ValidationRequest): Promise<V3ValidationResult>;
}

/**
 * Wraps either the arriving v3 engine or the v2 compatibility validator behind
 * one result shape. Both practice and review callers therefore receive the same
 * status, issues, and report-class semantics.
 */
export function createV3ValidationPort(injected?: V3ValidationPort): V3ValidationPort {
  return {
    async validate(request): Promise<V3ValidationResult> {
      const preflight = validateV3WorkflowState(request.workflow);
      const result = injected
        ? await injected.validate(request)
        : { validation: await request.validateLegacy(), classification: 'LEGACY_DIAGNOSTIC' as const };
      const issues = preflight.map((issue) => ({
        ...issue,
        severity: 'blocked' as const,
        blocking: true,
        refs: [],
      }));
      const validation: ValidationResult = issues.length
        ? { ...result.validation, status: 'BLOCKED', issues: [...issues, ...result.validation.issues] }
        : result.validation;
      return {
        ...result,
        validation,
        classification: !injected || request.mode === 'practice'
          ? 'LEGACY_DIAGNOSTIC'
          : preflight.length || validation.status !== 'PASS'
            ? 'DIAGNOSTIC'
            : result.classification === 'VERIFIED_PREWIRE'
              ? 'VERIFIED_PREWIRE'
              : result.classification,
      };
    },
  };
}
