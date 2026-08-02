export type DeviceBehaviorInputValue = boolean | number;
export type DeviceBehaviorOutputValue = boolean | number;

export type DeviceBehaviorCondition =
  | { readonly kind: 'boolean-input'; readonly inputId: string; readonly equals: boolean }
  | { readonly kind: 'number-compare'; readonly inputId: string; readonly operator: 'lt' | 'lte' | 'eq' | 'gte' | 'gt'; readonly value: number }
  | { readonly kind: 'all'; readonly conditions: readonly DeviceBehaviorCondition[] }
  | { readonly kind: 'any'; readonly conditions: readonly DeviceBehaviorCondition[] }
  | { readonly kind: 'not'; readonly condition: DeviceBehaviorCondition };

export interface DeviceBehaviorManualEvidence {
  readonly manualId: string;
  readonly pages: readonly number[];
  readonly sha256: string;
  readonly note: string;
}

export interface DeviceBehaviorInputDefinition {
  readonly id: string;
  readonly dataType: 'boolean' | 'number';
  readonly source: 'circuit-element-energized' | 'circuit-measurement' | 'plc-output' | 'operator-control';
  readonly terminalIds: readonly string[];
  readonly unit?: string;
}

export interface DeviceBehaviorTransition {
  readonly to: string;
  readonly when: DeviceBehaviorCondition;
  readonly delayMs: number;
}

export interface DeviceBehaviorStateDefinition {
  readonly id: string;
  readonly outputs: Readonly<Record<string, DeviceBehaviorOutputValue>>;
  readonly transitions: readonly DeviceBehaviorTransition[];
}

export interface DeviceBehaviorFaultDefinition {
  readonly id: string;
  readonly when: DeviceBehaviorCondition;
  readonly latching: boolean;
  readonly resetWhen?: DeviceBehaviorCondition;
}

export interface DeviceBehaviorProfile {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly manufacturer: string;
  readonly fullOrderCode: string;
  readonly initialState: string;
  readonly inputs: readonly DeviceBehaviorInputDefinition[];
  readonly states: readonly DeviceBehaviorStateDefinition[];
  readonly faults: readonly DeviceBehaviorFaultDefinition[];
  readonly ratings: Readonly<Record<string, string | number>>;
  readonly unsupportedBehaviors: readonly string[];
  readonly manualEvidence: readonly DeviceBehaviorManualEvidence[];
}

export interface DeviceBehaviorSnapshot {
  readonly state: string;
  readonly stateElapsedMs: number;
  readonly outputs: Readonly<Record<string, DeviceBehaviorOutputValue>>;
  readonly activeFaultIds: readonly string[];
}
