import type { SimulationScenario, ValidationIssue } from './engine-types';
import type { DeviceProfile, VerificationStatus, WorkshopDocumentV2, WorkshopMode } from './types';

export type MissionHintLevel = 'concept' | 'device' | 'terminal' | 'answer';

export interface MissionRoleDefinition {
  id: string;
  label: string;
  allowedProfileIds: readonly string[];
}

export interface MissionTerminalRef {
  role: string;
  terminalId: string;
}

export interface MissionConnection {
  from: MissionTerminalRef;
  to: MissionTerminalRef;
  label: string;
}

export interface MissionConnectionSet {
  id: string;
  label: string;
  connections: readonly MissionConnection[];
}

export interface MissionExpectedState {
  scenarioId: string;
  target: MissionTerminalRef;
  kind: 'energized' | 'input' | 'output' | 'contact' | 'protocol' | 'operating-mode';
  expected: boolean | string;
}

export interface MissionForbiddenState {
  code: string;
  description: string;
  refs?: readonly MissionTerminalRef[];
}

export interface MissionHint {
  level: MissionHintLevel;
  text: string;
  oneStep?: true;
}

export interface MissionContactState {
  role: string;
  stateKey: string;
  closed: boolean;
}

export interface MissionForcedOutput {
  role: string;
  terminalIds: readonly string[];
}

export interface MissionContactRule {
  state: { role: string; stateKey: string };
  sense: MissionTerminalRef;
  mode: 'closed-when-energized' | 'closed-when-deenergized';
}

export interface MissionRuntimeTemplate {
  contactStates?: readonly MissionContactState[];
  forcedOutputs?: readonly MissionForcedOutput[];
}

export interface MissionScenarioDefinition extends MissionRuntimeTemplate {
  id: string;
  contactRules?: readonly MissionContactRule[];
}

export interface MissionAction {
  id: string;
  label: string;
  kind: 'connect' | 'toggle-contact' | 'force-output' | 'configure' | 'observe';
  target?: MissionTerminalRef;
}

export interface MissionDefinitionV2 {
  schemaVersion: 2;
  id: string;
  title: string;
  description: string;
  eligibleModes: readonly WorkshopMode[];
  roles: readonly MissionRoleDefinition[];
  initialState: MissionRuntimeTemplate;
  actions: readonly MissionAction[];
  scenarios: readonly MissionScenarioDefinition[];
  connectionPolicy: 'all-sets' | 'one-of';
  expectedConnections: readonly MissionConnectionSet[];
  expectedStates: readonly MissionExpectedState[];
  forbiddenStates: readonly MissionForbiddenState[];
  hints: readonly MissionHint[];
}

export interface RoleBinding {
  role: string;
  deviceId: string;
}

export interface MissionPreparationResult {
  status: Extract<VerificationStatus, 'PASS' | 'BLOCKED'>;
  issues: ValidationIssue[];
  bindings: Record<string, string>;
  scenarios: SimulationScenario[];
}

const terminal = (role: string, terminalId: string): MissionTerminalRef => ({ role, terminalId });

const connection = (
  fromRole: string,
  fromTerminal: string,
  toRole: string,
  toTerminal: string,
  label: string,
): MissionConnection => ({
  from: terminal(fromRole, fromTerminal),
  to: terminal(toRole, toTerminal),
  label,
});

const hints = (concept: string, device: string, terminalHint: string, answer: string): readonly MissionHint[] => [
  { level: 'concept', text: concept },
  { level: 'device', text: device },
  { level: 'terminal', text: terminalHint },
  { level: 'answer', text: answer, oneStep: true },
];

export const PUBLIC_MISSIONS: readonly MissionDefinitionV2[] = Object.freeze([
  {
    schemaVersion: 2,
    id: 'mdr-ac-dc-distribution',
    title: 'MDR AC 입력과 DC24V 배전',
    description: '검증된 AC 경계 전원을 MDR-100-24에 공급하고 DC24V 부하 경계까지 배전한다.',
    eligibleModes: ['practice', 'prewire'],
    roles: [
      { id: 'acSupply', label: 'AC 공급원', allowedProfileIds: ['boundary:ac-supply'] },
      { id: 'powerSupply', label: 'MDR 전원공급장치', allowedProfileIds: ['mean-well:mdr-100-24'] },
      { id: 'dcLoad', label: 'DC 부하 경계', allowedProfileIds: ['boundary:load'] },
    ],
    initialState: {},
    actions: [
      { id: 'connect-ac', label: 'AC L/N/PE를 연결한다.', kind: 'connect', target: terminal('powerSupply', 'L') },
      { id: 'observe-dc', label: '정상 입력 후 DC 출력을 확인한다.', kind: 'observe', target: terminal('powerSupply', 'V+1') },
    ],
    scenarios: [
      { id: 'ac-input-valid' },
      { id: 'dc-output-loaded' },
    ],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'required-distribution',
        label: 'AC 입력 및 DC 출력',
        connections: [
          connection('acSupply', 'L1', 'powerSupply', 'L', 'L1 → L'),
          connection('acSupply', 'N', 'powerSupply', 'N', 'N → N'),
          connection('acSupply', 'PE', 'powerSupply', 'PE', 'PE → FG'),
          connection('powerSupply', 'V+1', 'dcLoad', '+', '+24V → 부하 +'),
          connection('powerSupply', 'V-1', 'dcLoad', '-', '0V → 부하 -'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'ac-input-valid', target: terminal('powerSupply', 'V+1'), kind: 'energized', expected: true },
      { scenarioId: 'dc-output-loaded', target: terminal('dcLoad', '+'), kind: 'energized', expected: true },
    ],
    forbiddenStates: [
      { code: 'AC_PHASE_NEUTRAL_SHORT', description: '상과 N을 같은 연결 성분에 묶으면 안 된다.' },
      { code: 'PE_MIXED', description: 'PE는 전원 도체와 분리해야 한다.' },
      { code: 'UNPOWERED_SOURCE_OUTPUT', description: '정상 L/N 입력 없이 MDR 출력을 유효 전원으로 취급하면 안 된다.' },
    ],
    hints: hints(
      'AC 입력이 정상일 때만 DC 출력이 생긴다.',
      'AC 공급원, MDR-100-24, DC 부하 경계를 찾는다.',
      'L1-L, N-N, PE-PE와 V+/V- 극성을 확인한다.',
      '첫 단계로 AC 공급원의 L1을 MDR의 L 단자에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'xbc-source-sink-input',
    title: 'XBC 입력의 소스/싱크 결선',
    description: 'XBC-DR32H의 입력 COM을 기준으로 소스형과 싱크형 입력 회로를 각각 시험한다.',
    eligibleModes: ['practice', 'prewire'],
    roles: [
      { id: 'acSupply', label: 'PLC AC 공급원', allowedProfileIds: ['boundary:ac-supply'] },
      { id: 'dcSupply', label: 'DC 공급원', allowedProfileIds: ['boundary:dc-supply'] },
      { id: 'plc', label: 'XBC PLC', allowedProfileIds: ['ls-electric:xbc-dr32h'] },
      { id: 'inputContact', label: '입력 건접점', allowedProfileIds: ['boundary:dry-contact'] },
    ],
    initialState: { contactStates: [{ role: 'inputContact', stateKey: 'contact', closed: false }] },
    actions: [
      { id: 'toggle-input', label: '입력 건접점을 열고 닫는다.', kind: 'toggle-contact', target: terminal('inputContact', 'A') },
      { id: 'observe-p00', label: 'P00 입력 상태를 확인한다.', kind: 'observe', target: terminal('plc', 'P00') },
    ],
    scenarios: [
      { id: 'contact-open' },
      { id: 'contact-closed', contactStates: [{ role: 'inputContact', stateKey: 'contact', closed: true }] },
    ],
    connectionPolicy: 'one-of',
    expectedConnections: [
      {
        id: 'source-input',
        label: '소스 입력 회로',
        connections: [
          connection('acSupply', 'L1', 'plc', 'L', 'L1 → PLC L'),
          connection('acSupply', 'N', 'plc', 'N', 'N → PLC N'),
          connection('acSupply', 'PE', 'plc', 'PE', 'PE → PLC PE'),
          connection('dcSupply', '+', 'inputContact', 'A', '+24V → 접점'),
          connection('inputContact', 'B', 'plc', 'P00', '접점 → P00'),
          connection('dcSupply', '-', 'plc', 'COMI', '0V → 입력 COM'),
        ],
      },
      {
        id: 'sink-input',
        label: '싱크 입력 회로',
        connections: [
          connection('acSupply', 'L1', 'plc', 'L', 'L1 → PLC L'),
          connection('acSupply', 'N', 'plc', 'N', 'N → PLC N'),
          connection('acSupply', 'PE', 'plc', 'PE', 'PE → PLC PE'),
          connection('dcSupply', '-', 'inputContact', 'A', '0V → 접점'),
          connection('inputContact', 'B', 'plc', 'P00', '접점 → P00'),
          connection('dcSupply', '+', 'plc', 'COMI', '+24V → 입력 COM'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'contact-open', target: terminal('plc', 'P00'), kind: 'input', expected: false },
      { scenarioId: 'contact-closed', target: terminal('plc', 'P00'), kind: 'input', expected: true },
    ],
    forbiddenStates: [
      { code: 'DC_SHORT', description: '+24V와 0V를 직접 연결하면 안 된다.' },
      { code: 'PARALLEL_SOURCE', description: 'PLC 내부 24V와 외부 공급원을 병렬 연결하면 안 된다.' },
      { code: 'INPUT_COMMON_POLARITY', description: 'P00 신호와 COMI가 같은 전위가 되면 입력 시험이 성립하지 않는다.' },
    ],
    hints: hints(
      '입력은 신호 단자와 COM 사이의 전위차로 판단한다.',
      'DC 공급원, 건접점, XBC-DR32H를 사용한다.',
      'P00과 COMI가 서로 반대 전위를 보도록 결선한다.',
      '소스형 첫 단계로 DC +를 건접점 A에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'xbc-forced-relay-output',
    title: 'XBC 릴레이 출력 강제 시험',
    description: '래더를 실행하지 않고 P20 릴레이 출력을 OFF/ON 강제해 부하 경계의 통전을 확인한다.',
    eligibleModes: ['practice', 'prewire'],
    roles: [
      { id: 'acSupply', label: 'PLC AC 공급원', allowedProfileIds: ['boundary:ac-supply'] },
      { id: 'dcSupply', label: 'DC 공급원', allowedProfileIds: ['boundary:dc-supply'] },
      { id: 'plc', label: 'XBC PLC', allowedProfileIds: ['ls-electric:xbc-dr32h'] },
      { id: 'load', label: '시험 부하', allowedProfileIds: ['boundary:load'] },
    ],
    initialState: { forcedOutputs: [{ role: 'plc', terminalIds: [] }] },
    actions: [
      { id: 'force-p20', label: 'P20을 강제 OFF/ON한다.', kind: 'force-output', target: terminal('plc', 'P20') },
      { id: 'observe-load', label: '부하 + 단자의 통전을 확인한다.', kind: 'observe', target: terminal('load', '+') },
    ],
    scenarios: [
      { id: 'relay-off' },
      { id: 'relay-on', forcedOutputs: [{ role: 'plc', terminalIds: ['P20'] }] },
    ],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'p20-load-test',
        label: 'P20 그룹 릴레이 부하 시험',
        connections: [
          connection('acSupply', 'L1', 'plc', 'L', 'L1 → PLC L'),
          connection('acSupply', 'N', 'plc', 'N', 'N → PLC N'),
          connection('acSupply', 'PE', 'plc', 'PE', 'PE → PLC PE'),
          connection('dcSupply', '+', 'plc', 'COM0', '+24V → COM0'),
          connection('plc', 'P20', 'load', '+', 'P20 → 부하 +'),
          connection('load', '-', 'dcSupply', '-', '부하 - → 0V'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'relay-off', target: terminal('plc', 'P20'), kind: 'output', expected: false },
      { scenarioId: 'relay-on', target: terminal('plc', 'P20'), kind: 'output', expected: true },
      { scenarioId: 'relay-on', target: terminal('load', '+'), kind: 'energized', expected: true },
    ],
    forbiddenStates: [
      { code: 'DC_SHORT', description: '강제 ON 시 COM0 경로가 단락을 만들면 안 된다.' },
      { code: 'UNKNOWN_FORCED_OUTPUT', description: '프로필에 없는 출력을 강제하면 안 된다.' },
      { code: 'OUTPUT_ON_WHEN_OFF', description: '강제 OFF 상태에서 부하가 통전되면 안 된다.' },
    ],
    hints: hints(
      '릴레이 출력은 P20과 같은 그룹 COM 사이의 접점이다.',
      'DC 공급원, XBC-DR32H, 시험 부하를 사용한다.',
      'P20은 COM0 그룹이므로 COM0에 공급 전위를 넣는다.',
      '첫 단계로 DC +를 PLC COM0에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'xbf-analog-voltage-current',
    title: 'XBF-AH04A 전압·전류 채널 결선',
    description: 'XBF-AH04A 외부 24V, 0–10V 채널과 +24V→2선식 송신기→AI→0V 직렬 4–20mA 루프를 함께 검토한다.',
    eligibleModes: ['practice', 'prewire'],
    roles: [
      { id: 'dcSupply', label: 'DC 공급원', allowedProfileIds: ['boundary:dc-supply'] },
      { id: 'analogModule', label: 'XBF 아날로그 모듈', allowedProfileIds: ['ls-electric:xbf-ah04a'] },
      { id: 'voltagePeer', label: '전압 신호원 경계', allowedProfileIds: ['boundary:analog-voltage-source'] },
      { id: 'currentPeer', label: '2선식 4–20mA 송신기 경계', allowedProfileIds: ['boundary:two-wire-current-transmitter'] },
    ],
    initialState: {},
    actions: [
      { id: 'configure-ai0', label: 'AI0 사용, 물리 스위치 V, 파라미터 0–10V를 설정한다.', kind: 'configure', target: terminal('analogModule', 'I0+') },
      { id: 'configure-ai1', label: 'AI1 사용, 물리 스위치 I, 파라미터 4–20mA를 설정한다.', kind: 'configure', target: terminal('analogModule', 'I1+') },
    ],
    scenarios: [
      { id: 'voltage-channel' },
      { id: 'current-channel' },
    ],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'power-and-signals',
        label: '모듈 전원과 분리된 신호 채널',
        connections: [
          connection('dcSupply', '+', 'analogModule', '+24V', '+24V 모듈 전원'),
          connection('dcSupply', '-', 'analogModule', '0V', '0V 모듈 전원'),
          connection('voltagePeer', '+', 'analogModule', 'I0+', '전압 신호 + → AI0+'),
          connection('voltagePeer', '-', 'analogModule', 'I0-', '전압 신호 - → AI0-'),
          connection('dcSupply', '+', 'currentPeer', '+', '+24V → 2선식 송신기 TX+'),
          connection('currentPeer', '-', 'analogModule', 'I1+', '송신기 TX− → AI1+'),
          connection('analogModule', 'I1-', 'dcSupply', '-', 'AI1− → 같은 0V'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'voltage-channel', target: terminal('analogModule', 'I0+'), kind: 'protocol', expected: 'analog-voltage' },
      { scenarioId: 'current-channel', target: terminal('analogModule', 'I1+'), kind: 'protocol', expected: 'analog-current' },
    ],
    forbiddenStates: [
      { code: 'ANALOG_MODE_MISMATCH', description: '전압 채널과 전류 채널을 같은 신호 성분에 혼합하면 안 된다.' },
      { code: 'CURRENT_LOOP_POLARITY_REVERSED', description: '2선식 루프는 +24V→TX+→TX−→I+→I−→0V 순서를 지켜야 한다.' },
      { code: 'CURRENT_LOOP_RETURN_PATH_OPEN', description: 'AI1− 귀로가 같은 0V까지 이어져야 한다.' },
      { code: 'DC_SHORT', description: '모듈 외부전원 +24V와 0V를 단락하면 안 된다.' },
      { code: 'NC_TERMINAL_USED', description: 'NC 단자는 결선에 사용하면 안 된다.', refs: [terminal('analogModule', 'NC')] },
    ],
    hints: hints(
      'XBF 채널 형식은 고정값이 아니라 사용 여부, 물리 V/I 스위치와 파라미터 범위의 조합으로 결정된다.',
      'DC 공급원, XBF-AH04A, 전압 신호원과 2선식 전류 송신기 경계를 찾는다.',
      'AI0=V/0–10V, AI1=I/4–20mA로 설정하고 전류 루프는 +24V→TX+→TX−→I1+→I1−→0V 순서로 완성한다.',
      '첫 단계로 DC +를 모듈 +24V 단자에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'ig5a-terminal-control-practice',
    title: 'iG5A 단자 제어 연습',
    description: '정확한 전체 품번 확정 전 교육용 프로필로 정·역회전 단자 제어 개념만 연습한다.',
    eligibleModes: ['practice'],
    roles: [
      { id: 'drive', label: 'iG5A 교육용 인버터', allowedProfileIds: ['ls-electric:sv-ig5a'] },
      { id: 'forwardPb', label: '정회전 건접점', allowedProfileIds: ['boundary:dry-contact'] },
      { id: 'reversePb', label: '역회전 건접점', allowedProfileIds: ['boundary:dry-contact'] },
    ],
    initialState: {
      contactStates: [
        { role: 'forwardPb', stateKey: 'contact', closed: false },
        { role: 'reversePb', stateKey: 'contact', closed: false },
      ],
    },
    actions: [
      { id: 'press-forward', label: '정회전 접점을 닫는다.', kind: 'toggle-contact', target: terminal('forwardPb', 'A') },
      { id: 'press-reverse', label: '역회전 접점을 닫는다.', kind: 'toggle-contact', target: terminal('reversePb', 'A') },
    ],
    scenarios: [
      { id: 'drive-stopped' },
      { id: 'forward-command', contactStates: [{ role: 'forwardPb', stateKey: 'contact', closed: true }] },
      { id: 'reverse-command', contactStates: [{ role: 'reversePb', stateKey: 'contact', closed: true }] },
    ],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'terminal-commands',
        label: '정·역회전 단자 접점',
        connections: [
          connection('drive', 'CM', 'forwardPb', 'A', 'CM → 정회전 접점'),
          connection('forwardPb', 'B', 'drive', 'P1', '정회전 접점 → P1'),
          connection('drive', 'CM', 'reversePb', 'A', 'CM → 역회전 접점'),
          connection('reversePb', 'B', 'drive', 'P2', '역회전 접점 → P2'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'drive-stopped', target: terminal('drive', 'P1'), kind: 'operating-mode', expected: 'stopped' },
      { scenarioId: 'forward-command', target: terminal('drive', 'P1'), kind: 'operating-mode', expected: 'forward-command' },
      { scenarioId: 'reverse-command', target: terminal('drive', 'P2'), kind: 'operating-mode', expected: 'reverse-command' },
    ],
    forbiddenStates: [
      { code: 'FORWARD_REVERSE_SIMULTANEOUS', description: '정회전과 역회전 명령을 동시에 닫으면 안 된다.' },
      { code: 'EXTERNAL_SUPPLY_VARIANT_UNKNOWN', description: '전원 변형이 확정되지 않은 프로필을 사전 검토에 사용하면 안 된다.' },
    ],
    hints: hints(
      '인버터 디지털 입력은 지정된 공통과 명령 단자 사이 접점으로 제어한다.',
      '교육용 iG5A와 정·역회전용 건접점 두 개를 사용한다.',
      '정회전은 P1, 역회전은 P2, 공통은 CM으로 연습한다.',
      '첫 단계로 CM을 정회전 건접점 A에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'exp2-power-practice',
    title: 'eXP2-0700D DC24V 전원',
    description: '학원 제어반과 같이 MDR 첫 번째 출력쌍으로 HMI의 DC24V와 0V 귀로를 완성한다.',
    eligibleModes: ['practice'],
    roles: [
      { id: 'acSupply', label: 'AC 공급원', allowedProfileIds: ['boundary:ac-supply'] },
      { id: 'powerSupply', label: 'MDR-100-24', allowedProfileIds: ['mean-well:mdr-100-24'] },
      { id: 'hmi', label: 'eXP2-0700D HMI', allowedProfileIds: ['ls-electric:exp2-0700d'] },
    ],
    initialState: {},
    actions: [
      { id: 'connect-hmi-power', label: 'MDR +24V와 0V를 HMI 전원 단자에 연결한다.', kind: 'connect', target: terminal('hmi', 'DC24V') },
      { id: 'measure-hmi-power', label: 'HMI DC24V-DC0V 전압과 귀로를 확인한다.', kind: 'observe', target: terminal('hmi', 'DC0V') },
    ],
    scenarios: [{ id: 'hmi-powered' }],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'mdr-input-and-hmi-output',
        label: 'MDR 입력 및 HMI 전원 폐회로',
        connections: [
          connection('acSupply', 'L1', 'powerSupply', 'L', 'AC L → MDR L'),
          connection('acSupply', 'N', 'powerSupply', 'N', 'AC N → MDR N'),
          connection('acSupply', 'PE', 'powerSupply', 'PE', 'PE → MDR FG'),
          connection('powerSupply', 'V+1', 'hmi', 'DC24V', 'MDR +V1 → HMI DC24V'),
          connection('powerSupply', 'V-1', 'hmi', 'DC0V', 'MDR -V1 → HMI 0V'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'hmi-powered', target: terminal('hmi', 'DC24V'), kind: 'energized', expected: true },
    ],
    forbiddenStates: [
      { code: 'OPEN_RETURN_PATH', description: 'HMI 0V 귀로가 없으면 전원이 켜진 것으로 판정하지 않는다.' },
      { code: 'LOAD_REVERSED', description: 'HMI DC24V와 0V를 반대로 연결하면 안 된다.' },
      { code: 'DC_SHORT', description: 'HMI 전원 +와 0V를 같은 net으로 만들면 안 된다.' },
    ],
    hints: hints(
      'HMI는 +24V 전위만 도달해서는 켜지지 않고 0V 귀로까지 필요하다.',
      'MDR-100-24와 eXP2-0700D를 사용한다.',
      'MDR V+1/V-1을 HMI DC24V/DC0V에 각각 연결한다.',
      '첫 단계로 MDR V+1을 HMI DC24V에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'exp2-xbc-rs485-practice',
    title: 'eXP2-0700D ↔ XBC RS485',
    description: '공식 DB9 핀맵에 따라 eXP2 COM1 pin 6(+)과 pin 1(-)을 XBC 485+/485-에 연결한다.',
    eligibleModes: ['practice'],
    roles: [
      { id: 'hmi', label: 'eXP2-0700D HMI', allowedProfileIds: ['ls-electric:exp2-0700d'] },
      { id: 'plc', label: 'XBC-DR32H PLC', allowedProfileIds: ['ls-electric:xbc-dr32h'] },
    ],
    initialState: {},
    actions: [
      { id: 'configure-cnet', label: '양쪽 baud/parity/stop bit를 같은 값으로 설정한다.', kind: 'configure', target: terminal('hmi', 'COM1-6') },
      { id: 'observe-cnet', label: 'COM1 종단저항과 RS485 극성을 확인한다.', kind: 'observe', target: terminal('hmi', 'COM1-1') },
    ],
    scenarios: [{ id: 'cnet-idle' }],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'exp2-xbc-cnet',
        label: 'eXP2 COM1 DB9 ↔ XBC 내장 Cnet',
        connections: [
          connection('hmi', 'COM1-6', 'plc', '485+', 'COM1 pin 6(+) → XBC 485+'),
          connection('hmi', 'COM1-1', 'plc', '485-', 'COM1 pin 1(-) → XBC 485-'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'cnet-idle', target: terminal('hmi', 'COM1-6'), kind: 'protocol', expected: 'RS485-A' },
      { scenarioId: 'cnet-idle', target: terminal('hmi', 'COM1-1'), kind: 'protocol', expected: 'RS485-B' },
    ],
    forbiddenStates: [
      { code: 'RS485_POLARITY_MISMATCH', description: 'DB9 pin 6과 pin 1을 반대로 연결하면 안 된다.' },
      { code: 'COMMUNICATION_POLARITY_MISMATCH', description: 'RS485 +와 -의 기능이 교차되면 안 된다.' },
    ],
    hints: hints(
      'eXP2 COM1은 나사단자 두 개가 아니라 DB9 핀을 사용하는 RS485 포트다.',
      'eXP2-0700D와 XBC-DR32H를 사용한다.',
      '공식 매뉴얼 기준 COM1 pin 6은 +, pin 1은 -다.',
      '첫 단계로 COM1 pin 6을 XBC 485+에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'md02-power-practice',
    title: 'XY-MD02 전원만 연결',
    description: '학원 제어반처럼 MDR 두 번째 출력쌍으로 MD02 전원 폐회로만 완성하고 통신은 미구성 상태로 둔다.',
    eligibleModes: ['practice'],
    roles: [
      { id: 'acSupply', label: 'AC 공급원', allowedProfileIds: ['boundary:ac-supply'] },
      { id: 'powerSupply', label: 'MDR-100-24', allowedProfileIds: ['mean-well:mdr-100-24'] },
      { id: 'sensor', label: 'MD02 교육용 센서', allowedProfileIds: ['generic:xy-md02'] },
    ],
    initialState: {},
    actions: [
      { id: 'connect-md02-power', label: 'MDR V+2/V-2를 MD02 V+/V-에 연결한다.', kind: 'connect', target: terminal('sensor', 'V+') },
      { id: 'observe-md02-power', label: '전원 정상/통신 미구성 상태를 확인한다.', kind: 'observe', target: terminal('sensor', 'V-') },
    ],
    scenarios: [{ id: 'md02-powered-only' }],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'md02-power',
        label: 'MDR 입력 및 MD02 전원 폐회로',
        connections: [
          connection('acSupply', 'L1', 'powerSupply', 'L', 'AC L → MDR L'),
          connection('acSupply', 'N', 'powerSupply', 'N', 'AC N → MDR N'),
          connection('acSupply', 'PE', 'powerSupply', 'PE', 'PE → MDR FG'),
          connection('powerSupply', 'V+2', 'sensor', 'V+', 'MDR +V2 → MD02 V+'),
          connection('powerSupply', 'V-2', 'sensor', 'V-', 'MDR -V2 → MD02 V-'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'md02-powered-only', target: terminal('sensor', 'V+'), kind: 'energized', expected: true },
    ],
    forbiddenStates: [
      { code: 'OPEN_RETURN_PATH', description: 'MD02 V- 귀로가 없으면 전원 정상으로 판정하지 않는다.' },
      { code: 'LOAD_REVERSED', description: 'MD02 V+와 V-를 반대로 연결하면 안 된다.' },
      { code: 'UNVERIFIED_PROFILE', description: 'MD02 교육용 프로필로 통과 리포트를 발급하면 안 된다.' },
    ],
    hints: hints(
      'MD02 전원 상태와 Modbus 통신 상태는 서로 다르다.',
      'MDR-100-24와 MD02 교육용 프로필을 사용한다.',
      'MDR V+2/V-2를 MD02 V+/V-에 각각 연결한다.',
      '첫 단계로 MDR V+2를 MD02 V+에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'md02-rs485-practice',
    title: 'XY-MD02 Modbus RTU 통신',
    description: '전원 미션과 분리하여 통신 마스터, A/B, 국번과 직렬 통신 설정만 연습한다.',
    eligibleModes: ['practice'],
    roles: [
      { id: 'sensor', label: 'MD02 교육용 센서', allowedProfileIds: ['generic:xy-md02'] },
      { id: 'communicationPeer', label: 'RS485 통신 상대', allowedProfileIds: ['boundary:communication-peer'] },
    ],
    initialState: {},
    actions: [
      { id: 'configure-modbus', label: '국번, baud rate, parity와 stop bit를 설정한다.', kind: 'configure', target: terminal('sensor', 'A+') },
      { id: 'observe-bus', label: 'RS485 A/B 대응을 확인한다.', kind: 'observe', target: terminal('sensor', 'A+') },
    ],
    scenarios: [{ id: 'rs485-idle' }],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'modbus-bus',
        label: 'MD02 RS485 A/B',
        connections: [
          connection('communicationPeer', 'A', 'sensor', 'A+', 'A → A+'),
          connection('communicationPeer', 'B', 'sensor', 'B-', 'B → B-'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'rs485-idle', target: terminal('sensor', 'A+'), kind: 'protocol', expected: 'RS485-A' },
      { scenarioId: 'rs485-idle', target: terminal('sensor', 'B-'), kind: 'protocol', expected: 'RS485-B' },
    ],
    forbiddenStates: [
      { code: 'RS485_POLARITY_MISMATCH', description: 'A와 B를 반대로 연결하면 안 된다.' },
      { code: 'UNVERIFIED_PROFILE', description: 'MD02 교육용 프로필로 통과 리포트를 발급하면 안 된다.' },
    ],
    hints: hints(
      'RS485는 같은 이름의 차동선끼리 1:1로 연결한다.',
      'MD02 교육용 센서와 RS485 상대 경계를 사용한다.',
      'A는 A+, B는 B-에 대응하고 양쪽 직렬 설정도 같아야 한다.',
      '첫 단계로 통신 상대 A를 MD02 A+에 연결한다.',
    ),
  },
  {
    schemaVersion: 2,
    id: 'door-terminal-block-routing',
    title: '도어 기기와 내부 단자대 경유 배선',
    description: '도어 푸시버튼과 표시 부하를 PLC에 직접 연결하지 않고 내부 단자대를 경유한다.',
    eligibleModes: ['practice'],
    roles: [
      { id: 'acSupply', label: 'PLC AC 공급원', allowedProfileIds: ['boundary:ac-supply'] },
      { id: 'dcSupply', label: 'DC 공급원', allowedProfileIds: ['boundary:dc-supply'] },
      { id: 'plc', label: 'XBC PLC', allowedProfileIds: ['ls-electric:xbc-dr32h'] },
      { id: 'startPb', label: '도어 운전 접점', allowedProfileIds: ['boundary:dry-contact'] },
      { id: 'stopPb', label: '도어 정지 접점', allowedProfileIds: ['boundary:dry-contact'] },
      { id: 'terminalBlock', label: '내부 단자대', allowedProfileIds: ['educational:terminal-block-10'] },
      { id: 'doorLamp', label: '도어 표시 부하', allowedProfileIds: ['boundary:load'] },
    ],
    initialState: {
      contactStates: [
        { role: 'startPb', stateKey: 'contact', closed: false },
        { role: 'stopPb', stateKey: 'contact', closed: true },
      ],
      forcedOutputs: [{ role: 'plc', terminalIds: [] }],
    },
    actions: [
      { id: 'press-start', label: '도어 운전 접점을 닫는다.', kind: 'toggle-contact', target: terminal('startPb', 'A') },
      { id: 'force-lamp', label: 'P20 출력을 강제한다.', kind: 'force-output', target: terminal('plc', 'P20') },
    ],
    scenarios: [
      { id: 'door-idle' },
      { id: 'start-pressed', contactStates: [{ role: 'startPb', stateKey: 'contact', closed: true }] },
      { id: 'lamp-on', forcedOutputs: [{ role: 'plc', terminalIds: ['P20'] }] },
    ],
    connectionPolicy: 'all-sets',
    expectedConnections: [
      {
        id: 'plc-ac-supply',
        label: 'PLC AC 전원',
        connections: [
          connection('acSupply', 'L1', 'plc', 'L', 'L1 → PLC L'),
          connection('acSupply', 'N', 'plc', 'N', 'N → PLC N'),
          connection('acSupply', 'PE', 'plc', 'PE', 'PE → PLC PE'),
        ],
      },
      {
        id: 'door-input-via-terminal-block',
        label: '도어 입력 단자대 경유',
        connections: [
          connection('dcSupply', '+', 'stopPb', 'A', '+24V → 정지 접점'),
          connection('stopPb', 'B', 'terminalBlock', '1', '정지 접점 → TB1'),
          connection('terminalBlock', "1'", 'startPb', 'A', "TB1' → 운전 접점"),
          connection('startPb', 'B', 'terminalBlock', '2', '운전 접점 → TB2'),
          connection('terminalBlock', "2'", 'plc', 'P00', "TB2' → P00"),
          connection('dcSupply', '-', 'plc', 'COMI', '0V → 입력 COM'),
        ],
      },
      {
        id: 'door-output-via-terminal-block',
        label: '도어 출력 단자대 경유',
        connections: [
          connection('dcSupply', '+', 'plc', 'COM0', '+24V → COM0'),
          connection('plc', 'P20', 'terminalBlock', '3', 'P20 → TB3'),
          connection('terminalBlock', "3'", 'doorLamp', '+', "TB3' → 도어 표시 +"),
          connection('doorLamp', '-', 'dcSupply', '-', '도어 표시 - → 0V'),
        ],
      },
    ],
    expectedStates: [
      { scenarioId: 'door-idle', target: terminal('plc', 'P00'), kind: 'input', expected: false },
      { scenarioId: 'start-pressed', target: terminal('plc', 'P00'), kind: 'input', expected: true },
      { scenarioId: 'lamp-on', target: terminal('doorLamp', '+'), kind: 'energized', expected: true },
    ],
    forbiddenStates: [
      { code: 'BYPASSED_TERMINAL_BLOCK', description: '도어 기기를 PLC에 직접 연결해 단자대를 우회하면 안 된다.' },
      { code: 'STOP_CONTACT_BYPASSED', description: '정지 접점을 운전 입력 경로에서 우회하면 안 된다.' },
      { code: 'DC_SHORT', description: '도어 회로에서 +24V와 0V 단락을 만들면 안 된다.' },
    ],
    hints: hints(
      '도어와 내부 제어반 사이 배선은 유지보수를 위해 단자대를 경유한다.',
      'DC 공급원, PLC, 운전/정지 접점, 내부 단자대, 표시 부하를 역할별로 지정한다.',
      '입력은 P00/COMI, 출력은 P20/COM0이며 각 도어 선로 사이에 TB 단자를 둔다.',
      '첫 단계로 DC +를 도어 정지 접점 A에 연결한다.',
    ),
  },
]);

function blockedIssue(code: string, message: string, refs: string[]): ValidationIssue {
  return { code, severity: 'blocked', blocking: true, message, refs };
}

function resolveScenario(
  definition: MissionDefinitionV2,
  scenario: MissionScenarioDefinition,
  roleBindings: Readonly<Record<string, string>>,
): SimulationScenario {
  const contactStates = new Map<string, boolean>();
  for (const state of [...(definition.initialState.contactStates ?? []), ...(scenario.contactStates ?? [])]) {
    contactStates.set(`${roleBindings[state.role]}:${state.stateKey}`, state.closed);
  }

  const forcedOutputs = new Map<string, string[]>();
  for (const output of [...(definition.initialState.forcedOutputs ?? []), ...(scenario.forcedOutputs ?? [])]) {
    forcedOutputs.set(roleBindings[output.role], [...output.terminalIds]);
  }

  const resolved: SimulationScenario = { id: scenario.id };
  if (contactStates.size) resolved.contactStates = Object.fromEntries(contactStates);
  if (forcedOutputs.size) resolved.forcedOutputs = Object.fromEntries(forcedOutputs);
  if (scenario.contactRules?.length) {
    resolved.contactRules = scenario.contactRules.map((rule) => ({
      stateKey: `${roleBindings[rule.state.role]}:${rule.state.stateKey}`,
      sense: { deviceId: roleBindings[rule.sense.role], terminalId: rule.sense.terminalId },
      mode: rule.mode,
    }));
  }
  return resolved;
}

/**
 * Resolve only caller-supplied role bindings. This deliberately never scans for
 * the first matching device, so multiple same-model instances stay unambiguous.
 */
export function prepareMissionEvaluation(
  definition: MissionDefinitionV2,
  document: WorkshopDocumentV2,
  catalog: Readonly<Record<string, DeviceProfile>>,
  suppliedBindings: readonly RoleBinding[],
): MissionPreparationResult {
  const issues: ValidationIssue[] = [];
  const declaredRoles = new Map(definition.roles.map((role) => [role.id, role]));
  const roleBindings = new Map<string, string>();
  const deviceBindings = new Map<string, string>();

  if (!definition.eligibleModes.includes(document.mode)) {
    issues.push(blockedIssue(
      'MISSION_MODE_NOT_ELIGIBLE',
      `${definition.id} is not eligible for ${document.mode} mode.`,
      [definition.id, document.mode],
    ));
  }

  for (const binding of suppliedBindings) {
    if (!declaredRoles.has(binding.role)) {
      issues.push(blockedIssue('UNKNOWN_MISSION_ROLE', `Role ${binding.role} is not declared by ${definition.id}.`, [binding.role]));
      continue;
    }
    if (roleBindings.has(binding.role)) {
      issues.push(blockedIssue('DUPLICATE_ROLE_BINDING', `Role ${binding.role} is bound more than once.`, [binding.role]));
      continue;
    }
    const existingRole = deviceBindings.get(binding.deviceId);
    if (existingRole) {
      issues.push(blockedIssue(
        'DUPLICATE_DEVICE_BINDING',
        `Device ${binding.deviceId} is already bound to ${existingRole}.`,
        [binding.deviceId, existingRole, binding.role],
      ));
    } else {
      deviceBindings.set(binding.deviceId, binding.role);
    }
    roleBindings.set(binding.role, binding.deviceId);
  }

  for (const role of definition.roles) {
    if (!roleBindings.has(role.id)) {
      issues.push(blockedIssue('MISSING_ROLE_BINDING', `Required role ${role.id} has no explicit binding.`, [role.id]));
    }
  }

  for (const [roleId, deviceId] of roleBindings) {
    const role = declaredRoles.get(roleId);
    const instance = document.devices.find((device) => device.id === deviceId);
    if (!role || !instance) {
      if (!instance) issues.push(blockedIssue('BOUND_DEVICE_NOT_FOUND', `Bound device ${deviceId} does not exist.`, [roleId, deviceId]));
      continue;
    }
    if (!role.allowedProfileIds.includes(instance.profileId)) {
      issues.push(blockedIssue(
        'ROLE_PROFILE_MISMATCH',
        `${instance.profileId} cannot fill role ${roleId}.`,
        [roleId, deviceId, instance.profileId],
      ));
      continue;
    }

    if (document.mode === 'prewire') {
      const profile = catalog[instance.profileId];
      const evidenceQualified = profile && (profile.boundary || profile.evidence.level !== 'educational');
      const instanceQualified = profile?.boundary || instance.evidenceLevel !== 'educational';
      if (!evidenceQualified || !instanceQualified || instance.missingProfile) {
        issues.push(blockedIssue(
          'ROLE_PROFILE_NOT_VERIFIED',
          `${deviceId} is not evidence-qualified for prewire evaluation.`,
          [roleId, deviceId, instance.profileId],
        ));
      }
    }
  }

  const resolvedBindings = Object.fromEntries(roleBindings);
  if (issues.length) return { status: 'BLOCKED', issues, bindings: resolvedBindings, scenarios: [] };

  return {
    status: 'PASS',
    issues: [],
    bindings: resolvedBindings,
    scenarios: definition.scenarios.map((scenario) => resolveScenario(definition, scenario, resolvedBindings)),
  };
}
