import type { PlcRuntimeConfigurationV1 } from '../plc-runtime/io-binding';

export interface TerminalReferenceV3 {
  elementId: string;
  terminalId: string;
}

export interface ProtectionCoordinationInputsV3 {
  prospectiveShortCircuitCurrentA: number | null;
  protectiveDeviceCurve: string | null;
}

/** The optional discriminator keeps historical DC fixtures source-compatible. */
export interface DcSourceSystem {
  kind?: 'dc';
  id: string;
  positiveTerminal: string;
  returnTerminal: string;
  voltage: number;
  /** Converter outputs remain electrically inactive until this input element is valid. */
  enabledByElementId?: string;
}

export interface AcSinglePhaseSourceSystem {
  kind: 'ac-single-phase';
  id: string;
  lineTerminal: string;
  neutralTerminal: string;
  peTerminal: string;
  lineToNeutralVoltage: number;
  protectionCoordination?: ProtectionCoordinationInputsV3;
}

export type PhaseSequenceV3 = 'L1-L2-L3' | 'L1-L3-L2';

export interface AcThreePhaseSourceSystem {
  kind: 'ac-three-phase';
  id: string;
  phaseTerminals: Readonly<{ L1: string; L2: string; L3: string }>;
  neutralTerminal?: string;
  peTerminal: string;
  lineToLineVoltage: number;
  lineToNeutralVoltage?: number;
  declaredPhaseSequence?: PhaseSequenceV3;
  protectionCoordination?: ProtectionCoordinationInputsV3;
}

export type SourceSystem = DcSourceSystem | AcSinglePhaseSourceSystem | AcThreePhaseSourceSystem;

export type WorkshopModeV3 = 'practice' | 'prewire';
export type CompletenessV3 = 'complete' | 'incomplete';
export type Earthing0vPePolicyV3 =
  | 'PE_SEPARATE_0V_FLOATING'
  | 'PE_0V_SINGLE_POINT_BOND'
  | 'SITE_DEFINED_BONDING';
export type SupplyKindV3 = 'ac-single-phase' | 'ac-three-phase' | 'dc';

/** Explicit power-system metadata. It is deliberately separate from the solver's terminal-level sources. */
export interface SourceSystemDefinitionV3 {
  id: string | null;
  label: string | null;
  supply: {
    status: CompletenessV3;
    kind: SupplyKindV3 | null;
    nominalVoltage: number | null;
    conductors: readonly string[];
    positivePotential: '+24V' | null;
    returnPotential: '0V' | null;
  };
  earthing: {
    status: CompletenessV3;
    policy: Earthing0vPePolicyV3 | null;
  };
}

/**
 * Legacy SVG coordinates are arbitrary canvas units, not millimetres.
 * A migrated document may use its physical coordinates only after the user
 * records the project conversion factor. Native V3 writers can use 1 unit/mm.
 */
export interface PhysicalLayoutDefinitionV3 {
  status: CompletenessV3;
  sourceUnit: 'canvas-unit' | 'millimeter';
  canvasUnitsPerMm: number | null;
}

export interface DeviceLayoutMmV3 {
  x: number;
  y: number;
  rotation: number;
  width?: number;
  height?: number;
  depth?: number;
}

/**
 * Persisted device identity is intentionally more specific than a catalog profile.
 * Legacy imports use null for information that was never recorded; they never infer it.
 */
export interface DeviceInstanceV3 {
  id: string;
  profileId: string;
  profileVersion: string;
  assetVersion: string | null;
  exactOrderCode: string | null;
  designation: string | null;
  configuration: Readonly<Record<string, unknown>>;
  layoutMm: DeviceLayoutMmV3;
  verification: 'unverified' | 'legacy-unverified';
}

export interface ConductorV3 {
  id: string;
  cableAssemblyId: string;
  core: string;
  color: string | null;
  gauge: string | null;
  wireNumber: string | null;
  crossSectionMm2: number | null;
  awg: string | null;
  lengthMm: number | null;
  pairId: string | null;
  shielded: boolean;
  drain: boolean;
  ferruleFrom: string | null;
  ferruleTo: string | null;
  lugFrom: string | null;
  lugTo: string | null;
}

export interface CableAssemblyV3 {
  id: string;
  designation: string | null;
  conductorIds: readonly string[];
  cableType: string | null;
  lengthMm: number | null;
  shielded: boolean;
  drainConductorId: string | null;
  routeMm: readonly { x: number; y: number }[];
}

export interface TerminalAssemblyV3 {
  id: string;
  deviceId: string;
  terminalIds: readonly string[];
  manufacturer: string | null;
  orderCode: string | null;
  designation: string | null;
  terminalType: 'through' | 'pe' | 'fused' | 'disconnect' | 'device' | null;
  marker: string | null;
  maximumConductorsPerTerminal: number | null;
  bridges: readonly string[];
  accessories: readonly string[];
}

export interface ConductorBranchV3 {
  id: string;
  conductorId: string;
  from: TerminalReferenceV3;
  to: TerminalReferenceV3;
  waypointsMm: readonly { x: number; y: number }[];
}

export interface LoadElement {
  kind: 'load';
  id: string;
  positiveTerminal: string;
  returnTerminal: string;
  role?: 'load' | 'digital-input' | 'coil' | 'module-supply';
  parentDeviceId?: string;
  polarity?: 'positive-return' | 'either';
  required?: 'always' | 'scenario';
  resistanceOhms?: number;
  onThresholdVoltage?: number;
  onThresholdCurrentA?: number;
  /** Used when a manual requires an external supply instead of a device's auxiliary rail. */
  forbiddenSourceIds?: readonly string[];
}

export interface AcLoadElement {
  kind: 'ac-load';
  id: string;
  lineTerminal: string;
  neutralTerminal: string;
  peTerminal?: string;
  parentDeviceId?: string;
  required?: 'always' | 'scenario';
}

export interface ThreePhaseLoadElement {
  kind: 'three-phase-load';
  id: string;
  phaseTerminals: Readonly<{ L1: string; L2: string; L3: string }>;
  neutralTerminal?: string;
  peTerminal?: string;
  expectedPhaseSequence?: PhaseSequenceV3;
  parentDeviceId?: string;
  required?: 'always' | 'scenario';
}

export interface ContactElement {
  kind: 'contact';
  id: string;
  terminalA: string;
  terminalB: string;
  stateKey: string;
  normally: 'open' | 'closed';
  /**
   * A built-in electromechanical relationship. When present, scenarios may set
   * the initial state but cannot detach the physical contact from its coil/load.
   */
  drivenBy?: {
    elementId: string;
    mode: 'closed-when-energized' | 'closed-when-deenergized';
  };
}

export interface AnalogPortElement {
  kind: 'analog-port';
  id: string;
  positiveTerminal: string;
  returnTerminal: string;
  protocol: 'analog-voltage' | 'analog-current';
  direction: 'source' | 'sink';
  parentDeviceId?: string;
  supplyElementId?: string;
  required?: 'always' | 'scenario';
  /** Manual-backed receiver burden used when this port is part of a powered current loop. */
  inputResistanceOhms?: number;
  /** Absolute input limit. Exceeding it is a wiring/range failure, not a simulated valid value. */
  maximumCurrentA?: number;
}

/**
 * A transistor output is a controlled semiconductor path, not a voltage
 * source. A sinking output joins OUT to the device return; a sourcing output
 * joins OUT to the device positive rail. The path may close only while the
 * device supply is a complete pair.
 */
export interface TransistorOutputElement {
  kind: 'transistor-output';
  id: string;
  supplyPositiveTerminal: string;
  supplyReturnTerminal: string;
  outputTerminal: string;
  mode: 'sinking' | 'sourcing';
  stateKey: string;
  defaultState?: boolean;
  supplyElementId?: string;
  parentDeviceId?: string;
  required?: 'always' | 'scenario';
}

/**
 * A loop-powered 2-wire transmitter is a series current-regulating branch.
 * Its negative terminal must feed an analog-current receiver before the same
 * source system is reached at 0 V.
 */
export interface TwoWireCurrentTransmitterElement {
  kind: 'two-wire-current-transmitter';
  id: string;
  positiveTerminal: string;
  negativeTerminal: string;
  currentA: number;
  minimumOperatingVoltageV: number;
  maximumLoopVoltageV?: number;
  parentDeviceId?: string;
  required?: 'always' | 'scenario';
}

/** A device is intentionally passive until a specialized v3 element model is supplied. */
export interface DeviceElement {
  kind: 'device';
  id: string;
  terminals: readonly string[];
}

export type ElectricalElement =
  | LoadElement
  | AcLoadElement
  | ThreePhaseLoadElement
  | ContactElement
  | AnalogPortElement
  | TransistorOutputElement
  | TwoWireCurrentTransmitterElement
  | DeviceElement;

export interface ElectricalBranch {
  id: string;
  from: TerminalReferenceV3;
  to: TerminalReferenceV3;
  /**
   * PE branches are represented for continuity but never conduct a working
   * return path. Internal aliases attach profile terminals to modeled elements
   * without falsely declaring a floating dry contact to be AC or DC.
   */
  conductor: 'dc' | 'ac' | 'pe' | 'signal' | 'internal';
}

export interface ReviewScopeV3 {
  elementIds: readonly string[];
  templateId?: string | null;
  deviceIds?: readonly string[];
  status?: CompletenessV3;
}

/** The intentionally small persisted v3 document boundary used by the closed-loop solver. */
export interface WorkshopDocumentV3 {
  schemaVersion: 3;
  revision: number;
  hash: string;
  sources: readonly SourceSystem[];
  elements: readonly ElectricalElement[];
  branches: readonly ElectricalBranch[];
  reviewScope: ReviewScopeV3;
  /** Optional only for the solver's small historical fixture contract. Persisted migrations always provide these. */
  mode?: WorkshopModeV3;
  profileVersions?: Readonly<Record<string, string>>;
  assetVersions?: Readonly<Record<string, string>>;
  sourceSystem?: SourceSystemDefinitionV3;
  physicalLayout?: PhysicalLayoutDefinitionV3;
  deviceInstances?: readonly DeviceInstanceV3[];
  cableAssemblies?: readonly CableAssemblyV3[];
  conductors?: readonly ConductorV3[];
  terminalAssemblies?: readonly TerminalAssemblyV3[];
  conductorBranches?: readonly ConductorBranchV3[];
  scenarios?: readonly SimulationScenarioV3[];
  settings?: Readonly<Record<string, unknown>>;
  layout?: Readonly<Record<string, unknown>>;
  extensions?: {
    legacy: Readonly<Record<string, unknown>>;
  };
  /** Design-time bindings only. Live session state is never persisted in the workshop document. */
  plcRuntime?: PlcRuntimeConfigurationV1;
}

export interface NetGraph {
  nodes: ReadonlySet<string>;
  branches: readonly ElectricalBranch[];
  componentOf: ReadonlyMap<string, string>;
}

export interface CircuitIssueV3 {
  code:
    | 'DC_SHORT'
    | 'AC_PHASE_NEUTRAL_SHORT'
    | 'AC_PHASE_PHASE_SHORT'
    | 'AC_PHASE_PE_FAULT'
    | 'MISSING_PHASE'
    | 'WRONG_PHASE_SEQUENCE'
    | 'PE_AS_WORKING_RETURN'
    | 'PROTECTION_COORDINATION_BLOCKED'
    | 'LOAD_REVERSED'
    | 'LOAD_INACTIVE'
    | 'INPUT_CURRENT_BELOW_THRESHOLD'
    | 'INPUT_SOURCE_MISMATCH'
    | 'OPEN_RETURN_PATH'
    | 'OPEN_SOURCE_PATH'
    | 'REVIEW_SCOPE_INCOMPLETE'
    | 'SOURCE_SYSTEM_REQUIRED'
    | 'EARTHING_POLICY_REQUIRED'
    | 'EARTHING_POLICY_BOND_COUNT'
    | 'SOURCE_CONDITION_UNMET'
    | 'PARALLEL_SOURCE'
    | 'PE_MISSING'
    | 'ORDER_CODE_REQUIRED'
    | 'ORDER_CODE_MISMATCH'
    | 'PROFILE_EVIDENCE_INELIGIBLE'
    | 'PROFILE_NOT_V3'
    | 'PROFILE_VERSION_MISMATCH'
    | 'ASSET_GEOMETRY_UNAPPROVED'
    | 'TERMINAL_GEOMETRY_MISMATCH'
    | 'XBF_CONFIGURATION_INCOMPLETE'
    | 'XBF_SELECTOR_RANGE_MISMATCH'
    | 'IG5A_INPUT_LOGIC_REQUIRED'
    | 'IG5A_CONTROL_POWER_STATE_REQUIRED'
    | 'EOCR_CONFIGURATION_INCOMPLETE'
    | 'FUSE_LINK_REQUIRED'
    | 'FUSE_LINK_PROFILE_UNVERIFIED'
    | 'NO_INSTALLED_EQUIPMENT'
    | 'DESIGNATION_REQUIRED'
    | 'CONDUCTOR_IDENTIFICATION_REQUIRED'
    | 'CONDUCTOR_SIZE_REQUIRED'
    | 'TERMINAL_ASSEMBLY_DATA_INCOMPLETE'
    | 'TERMINAL_NOT_CONNECTED'
    | 'TERMINAL_DOMAIN_MISMATCH'
    | 'TERMINAL_POLARITY_MISMATCH'
    | 'AC_LINE_NEUTRAL_MISMATCH'
    | 'AC_PHASE_MISMATCH'
    | 'AC_MAINS_DRIVE_OUTPUT_CONFLICT'
    | 'DC_POLARITY_MISMATCH'
    | 'PE_TERMINAL_MISUSE'
    | 'COMMON_ROLE_MISMATCH'
    | 'ANALOG_REFERENCE_MISMATCH'
    | 'COMMUNICATION_REFERENCE_MISMATCH'
    | 'COMMUNICATION_POLARITY_MISMATCH'
    | 'TERMINAL_PROTOCOL_MISMATCH'
    | 'SIGNAL_DIRECTION_MISMATCH'
    | 'TERMINAL_SOURCE_CONFLICT'
    | 'INPUT_LOGIC_MODE_REQUIRED'
    | 'INPUT_LOGIC_POLARITY_MISMATCH'
    | 'ANALOG_SIGNAL_SHORT'
    | 'ANALOG_POLARITY_REVERSED'
    | 'ANALOG_MODE_MISMATCH'
    | 'ANALOG_DIRECTION_MISMATCH'
    | 'ANALOG_SOURCE_PATH_OPEN'
    | 'ANALOG_RETURN_PATH_OPEN'
    | 'TRANSISTOR_OUTPUT_UNPOWERED'
    | 'CURRENT_LOOP_SOURCE_PATH_OPEN'
    | 'CURRENT_LOOP_SIGNAL_PATH_OPEN'
    | 'CURRENT_LOOP_RETURN_PATH_OPEN'
    | 'CURRENT_LOOP_POLARITY_REVERSED'
    | 'CURRENT_LOOP_RECEIVER_UNPOWERED'
    | 'CURRENT_LOOP_COMPLIANCE_INSUFFICIENT'
    | 'CURRENT_LOOP_OVER_RANGE'
    | 'UNKNOWN_TERMINAL'
    | 'DUPLICATE_ELEMENT_ID'
    | 'INVALID_CONTACT_RULE'
    | 'NON_CONVERGENT_SIMULATION';
  message: string;
  refs: readonly string[];
  blocking: boolean;
}

export interface CircuitModel {
  document: WorkshopDocumentV3;
  netGraph: NetGraph;
  activeContactStates: Readonly<Record<string, boolean>>;
  activeTransistorStates: Readonly<Record<string, boolean>>;
  issues: readonly CircuitIssueV3[];
}

export type LoadState =
  | 'ON'
  | 'INACTIVE'
  | 'BELOW_THRESHOLD'
  | 'OPEN_SOURCE_PATH'
  | 'OPEN_RETURN_PATH'
  | 'REVERSED'
  | 'WRONG_SOURCE'
  | 'SHORTED';

export type AcLoadStateV3 =
  | 'ON'
  | 'OPEN_LINE_PATH'
  | 'OPEN_NEUTRAL_PATH'
  | 'MISSING_PHASE'
  | 'WRONG_PHASE_SEQUENCE'
  | 'PE_MISSING'
  | 'PE_AS_WORKING_RETURN'
  | 'SHORTED';

export interface AcLoadSolutionV3 {
  energized: boolean;
  state: AcLoadStateV3;
  sourceId?: string;
  connectedPhases: readonly ('L1' | 'L2' | 'L3')[];
}

export interface LoadSolution {
  energized: boolean;
  state: LoadState;
  sourceId?: string;
  voltageV: number | null;
  currentA: number | null;
  sourcePath: CircuitPathV3 | null;
  returnPath: CircuitPathV3 | null;
}

export type AnalogPortStateV3 =
  | 'CONNECTED'
  | 'OPEN_SOURCE_PATH'
  | 'OPEN_RETURN_PATH'
  | 'POLARITY_REVERSED'
  | 'RECEIVER_UNPOWERED'
  | 'MODE_MISMATCH'
  | 'DIRECTION_MISMATCH'
  | 'SHORTED';

export interface AnalogPortSolutionV3 {
  connected: boolean;
  state: AnalogPortStateV3;
  peerId?: string;
  sourceId?: string;
  sourcePath: CircuitPathV3 | null;
  returnPath: CircuitPathV3 | null;
}

export type CurrentLoopStateV3 =
  | 'COMPLETE'
  | 'OPEN_SOURCE_PATH'
  | 'OPEN_SIGNAL_PATH'
  | 'OPEN_RETURN_PATH'
  | 'POLARITY_REVERSED'
  | 'RECEIVER_UNPOWERED'
  | 'COMPLIANCE_INSUFFICIENT'
  | 'OVER_RANGE';

export interface CurrentLoopSolutionV3 {
  active: boolean;
  state: CurrentLoopStateV3;
  transmitterId: string;
  receiverId?: string;
  sourceId?: string;
  currentA: number;
  receiverVoltageV: number | null;
  transmitterVoltageV: number | null;
  sourcePath: CircuitPathV3 | null;
  signalPath: CircuitPathV3 | null;
  returnPath: CircuitPathV3 | null;
}

export type TerminalVoltageStateV3 = 'positive' | 'return' | 'floating' | 'conflict';

export interface TerminalElectricalSolutionV3 {
  state: TerminalVoltageStateV3;
  voltageV: number | null;
}

/** AC phase identity is retained separately because scalar terminal voltages cannot represent phase angles. */
export interface AcTerminalPotentialV3 {
  sourceId: string;
  conductor: 'L1' | 'L2' | 'L3' | 'N' | 'PE';
  lineToNeutralVoltage: number | null;
  lineToLineVoltage: number | null;
}

export interface CircuitPathV3 {
  sourceId: string;
  terminalKeys: readonly string[];
  branchIds: readonly string[];
}

export type ElementElectricalStateV3 =
  | LoadState
  | AcLoadStateV3
  | AnalogPortStateV3
  | 'OPEN'
  | 'CLOSED'
  | 'PASSIVE'
  | 'SOURCE_ACTIVE'
  | 'SOURCE_INACTIVE'
  | 'SOURCE_SHORTED'
  | 'OUTPUT_ON'
  | 'OUTPUT_OFF'
  | 'OUTPUT_UNPOWERED'
  | CurrentLoopStateV3;

export interface ElementElectricalSolutionV3 {
  kind: ElectricalElement['kind'] | 'source';
  state: ElementElectricalStateV3;
  terminals: Readonly<Record<string, TerminalElectricalSolutionV3>>;
  voltageV: number | null;
  currentA: number | null;
  sourceId?: string;
  sourcePath: CircuitPathV3 | null;
  returnPath: CircuitPathV3 | null;
}

export interface BranchCurrentSolutionV3 {
  currentA: number | null;
  loadIds: readonly string[];
}

export interface CircuitSolution {
  loads: Readonly<Record<string, LoadSolution>>;
  acLoads: Readonly<Record<string, AcLoadSolutionV3>>;
  analogPorts: Readonly<Record<string, AnalogPortSolutionV3>>;
  currentLoops: Readonly<Record<string, CurrentLoopSolutionV3>>;
  elements: Readonly<Record<string, ElementElectricalSolutionV3>>;
  terminals: Readonly<Record<string, TerminalElectricalSolutionV3>>;
  /** Additive metadata used by the meter for AC L-N/L-L measurements. */
  acTerminalPotentials: Readonly<Record<string, AcTerminalPotentialV3>>;
  continuityGroups: Readonly<Record<string, string>>;
  branchCurrents: Readonly<Record<string, BranchCurrentSolutionV3>>;
  energizedTerminals: readonly string[];
  issues: readonly CircuitIssueV3[];
}

export type VoltageMeasurementV3 =
  | { status: 'measured'; voltageV: number }
  | { status: 'indeterminate' | 'unknown-terminal'; voltageV: null };

export type ContinuityMeasurementV3 =
  | { status: 'measured'; continuous: boolean }
  | { status: 'unknown-terminal'; continuous: null };

export type BranchCurrentMeasurementV3 =
  | { status: 'measured'; currentA: number; loadIds: readonly string[] }
  | { status: 'indeterminate'; currentA: null; loadIds: readonly string[] }
  | { status: 'unknown-branch'; currentA: null; loadIds: readonly [] };

export interface VirtualMultimeterV3 {
  voltage(positiveProbe: TerminalReferenceV3, negativeProbe: TerminalReferenceV3): VoltageMeasurementV3;
  continuity(leftProbe: TerminalReferenceV3, rightProbe: TerminalReferenceV3): ContinuityMeasurementV3;
  branchCurrent(branchId: string): BranchCurrentMeasurementV3;
}

/** STALE is reserved for freshness/report gates; circuit solves emit only PASS, FAIL, or BLOCKED. */
export type ValidationStatusV3 = 'PASS' | 'FAIL' | 'BLOCKED' | 'STALE';

export interface ValidationResultV3 {
  status: ValidationStatusV3;
  issues: readonly CircuitIssueV3[];
  documentRevision: number;
  documentHash: string;
}

export interface ContactRuleV3 {
  stateKey: string;
  /** Contacts may only be driven by a solved load branch such as a coil or AC control supply. */
  senseElementId?: string;
  /** Deprecated compatibility field; it is accepted only when it names a compatible load terminal. */
  sense?: TerminalReferenceV3;
  mode: 'closed-when-energized' | 'closed-when-deenergized';
}

export interface SimulationScenarioV3 {
  id: string;
  contactStates?: Readonly<Record<string, boolean>>;
  contactRules?: readonly ContactRuleV3[];
}

export interface ScenarioSimulationV3 {
  scenarioId: string;
  converged: boolean;
  iterations: number;
  contactStates: Readonly<Record<string, boolean>>;
  solution: CircuitSolution;
  validation: ValidationResultV3;
}
