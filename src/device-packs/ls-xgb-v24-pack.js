(function (root) {
  'use strict';
  const registry = root.PLCDevicePacks;
  if (!registry) throw new Error('PLCDevicePacks registry must be loaded first');

  const IMG = 'assets/devices/gpt-v24/';
  const terminal = (id, x, y, side, label, pol, extra = {}) => ({ id, x, y, side, label, pol, forceLabel: true, ...extra });

  const pdPinRows = [
    ['B20','MPG-A+','MPG A+','DI', 'A20','MPG-A-','MPG A-','DI'],
    ['B19','MPG-B+','MPG B+','DI', 'A19','MPG-B-','MPG B-','DI'],
    ['B18','Y-FP+','Y FP+','DO',   'A18','X-FP+','X FP+','DO'],
    ['B17','Y-FP-','Y FP-','DO',   'A17','X-FP-','X FP-','DO'],
    ['B16','Y-RP+','Y RP+','DO',   'A16','X-RP+','X RP+','DO'],
    ['B15','Y-RP-','Y RP-','DO',   'A15','X-RP-','X RP-','DO'],
    ['B14','Y-OV+','Y +LIMIT','DI','A14','X-OV+','X +LIMIT','DI'],
    ['B13','Y-OV-','Y -LIMIT','DI','A13','X-OV-','X -LIMIT','DI'],
    ['B12','Y-DOG','Y DOG','DI',   'A12','X-DOG','X DOG','DI'],
    ['B11','Y-NC1','Y NC','NEUTRAL','A11','X-NC1','X NC','NEUTRAL'],
    ['B10','Y-NC2','Y NC','NEUTRAL','A10','X-NC2','X NC','NEUTRAL'],
    ['B09','Y-COM','Y COM','IO-COM','A09','X-COM','X COM','IO-COM'],
    ['B08','Y-NC3','Y NC','NEUTRAL','A08','X-NC3','X NC','NEUTRAL'],
    ['B07','Y-INP','Y IN-POS','DI','A07','X-INP','X IN-POS','DI'],
    ['B06','Y-INP-COM','Y INP COM','IO-COM','A06','X-INP-COM','X INP COM','IO-COM'],
    ['B05','Y-CLR','Y CLR','DO',   'A05','X-CLR','X CLR','DO'],
    ['B04','Y-CLR-COM','Y CLR COM','IO-COM','A04','X-CLR-COM','X CLR COM','IO-COM'],
    ['B03','Y-HOME','Y HOME +5V','DI','A03','X-HOME','X HOME +5V','DI'],
    ['B02','Y-HOME-COM','Y HOME COM','IO-COM','A02','X-HOME-COM','X HOME COM','IO-COM'],
    ['B01','Y-NC4','Y NC','NEUTRAL','A01','X-NC4','X NC','NEUTRAL']
  ];
  function pdTerminals() {
    const top = 92, bottom = 584, step = (bottom - top) / (pdPinRows.length - 1);
    const terms = [];
    pdPinRows.forEach((row, index) => {
      const y = +(top + index * step).toFixed(1);
      terms.push(terminal(row[1], 18, y, 'L', row[2], row[3], { pin: row[0] }));
      terms.push(terminal(row[5], 222, y, 'R', row[6], row[7], { pin: row[4] }));
    });
    return terms;
  }

  const devices = {
    'XBL-C41A': {
      cat: 'plc', label: 'XBL-C41A', sub: 'Cnet RS-422/485 1채널 통신 모듈',
      w: 170, h: 500, color: '#e7e8ea', image: IMG + 'xbl-c41a-gpt.png', imageBox: { x: 0, y: 0, w: 170, h: 500 }, imageHasLabels: false,
      overlayLabel: true,
      terminals: [
        terminal('TX+', 18, 292, 'L', '1 TX+', 'RS485+', { pin: '1' }),
        terminal('TX-', 18, 342, 'L', '2 TX-', 'RS485-', { pin: '2' }),
        terminal('RX+', 152, 292, 'R', '3 RX+', 'RS485+', { pin: '3' }),
        terminal('RX-', 152, 342, 'R', '4 RX-', 'RS485-', { pin: '4' }),
        terminal('SG', 85, 402, 'B', '5 SG', 'COMM', { pin: '5' })
      ],
      rs485Pairs: [['TX+', 'TX-'], ['RX+', 'RX-']],
      rs485BusPorts: [{ id: 'CNET', plus: ['TX+', 'RX+'], minus: ['TX-', 'RX-'], requireBridgeIn2Wire: true }],
      communicationModule: { protocol: 'Cnet', interfaces: ['RS-422', 'RS-485'], channels: 1, terminationOhm: 120 },
      modbusDefaults: { enabled: true, role: 'master', address: 1, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, mode: '2wire' },
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'communication', occupiedPoints: 64, specialBase: true },
      rackModule: { family: 'LS-XGB', moduleClass: 'communication', occupiedPoints: 64 },
      manualSource: 'pdf/09_LS_XGB_Cnet_XBL-C41A_Manual_KR.pdf', manualVerified: true,
      generatedFromGptBase: true,
      notes: '공식 Cnet 매뉴얼 12.5.3 기준 5핀: TX+, TX-, RX+, RX-, SG. RS-485 2선식은 TX+/RX+와 TX-/RX-를 각각 브리지한다.'
    },
    'XBF-PD02A': {
      cat: 'plc', label: 'XBF-PD02A', sub: '2축 라인드라이브 위치결정 · 최대 2Mpps · 40핀',
      w: 240, h: 620, color: '#e7e8ea', image: IMG + 'xbf-pd02a-gpt.png', imageBox: { x: 0, y: 0, w: 240, h: 620 }, imageHasLabels: false,
      overlayLabel: true, terminals: pdTerminals(),
      positioning: {
        axes: 2, pulseType: 'line-driver', maxPulsePps: 2000000, connector: '40-pin', occupiedPoints: 64,
        axisMap: {
          X: { pulseForward: ['X-FP+','X-FP-'], pulseReverse: ['X-RP+','X-RP-'], highLimit: 'X-OV+', lowLimit: 'X-OV-', dog: 'X-DOG', common: 'X-COM', inPosition: 'X-INP', clear: 'X-CLR', home: 'X-HOME' },
          Y: { pulseForward: ['Y-FP+','Y-FP-'], pulseReverse: ['Y-RP+','Y-RP-'], highLimit: 'Y-OV+', lowLimit: 'Y-OV-', dog: 'Y-DOG', common: 'Y-COM', inPosition: 'Y-INP', clear: 'Y-CLR', home: 'Y-HOME' }
        }
      },
      rack: { role: 'module', family: 'LS-XGB', moduleClass: 'highSpeed', occupiedPoints: 64, specialBase: true },
      rackModule: { family: 'LS-XGB', moduleClass: 'highSpeed', occupiedPoints: 64 },
      manualSource: 'pdf/08_LS_XBF-PD02A_Positioning_Manual_KR.pdf', manualVerified: true,
      generatedFromGptBase: true,
      notes: '공식 매뉴얼 2.3.3의 A01~A20/B01~B20 핀 배열을 그대로 ID에 매핑했다. B열은 Y축, A열은 X축이며 MPG A/B는 공통 입력이다.'
    },
    'SIGNAL-GEN-VI': {
      cat: 'sensor', label: 'V/I 신호 발생기', sub: '0~10V · 0/4~20mA 교정 신호',
      w: 270, h: 210, color: '#2f3947', image: IMG + 'signal-generator-gpt.png', imageBox: { x: 0, y: 0, w: 270, h: 210 }, imageHasLabels: false,
      overlayLabel: true,
      terminals: [terminal('OUT+', 245, 145, 'R', 'OUT +', 'AO'), terminal('OUT-', 245, 180, 'R', 'OUT -', 'AO-COM')],
      analogChannels: [{ channel: 0, pos: 'OUT+', neg: 'OUT-', direction: 'source', ranges: ['0~10V', '0~20mA', '4~20mA'], dataType: '0~4000' }],
      analogSource: { defaultRange: '0~10V', defaultEngineeringValue: 50, engineeringMin: 0, engineeringMax: 100, unit: '%' },
      generatedFromGptBase: true,
      notes: '교육용 교정 신호원. 장비 설정에서 출력 범위와 공학값을 변경한다.'
    },
    'PRESSURE-TX-420': {
      cat: 'sensor', label: '압력 트랜스미터 4~20mA', sub: 'DC24V · 0~10bar · 3선식 교육 모델',
      w: 300, h: 190, color: '#526678', image: IMG + 'pressure-transmitter-gpt.png', imageBox: { x: 0, y: 0, w: 300, h: 190 }, imageHasLabels: false,
      overlayLabel: true,
      terminals: [
        terminal('PWR+', 18, 120, 'L', '+24V', 'DC+'), terminal('PWR-', 18, 158, 'L', '0V', 'DC-'),
        terminal('SIG+', 282, 120, 'R', '4~20mA +', 'AO'), terminal('SIG-', 282, 158, 'R', '4~20mA -', 'AO-COM')
      ],
      powerPairs: [{ pos: 'PWR+', neg: 'PWR-', kind: 'DC24' }], polarityCritical: [['PWR+', 'PWR-']],
      analogChannels: [{ channel: 0, pos: 'SIG+', neg: 'SIG-', direction: 'sensor', ranges: ['4~20mA'], dataType: '0~4000' }],
      analogSource: { defaultRange: '4~20mA', defaultEngineeringValue: 5, engineeringMin: 0, engineeringMax: 10, unit: 'bar' },
      sensorKind: 'PRESSURE', generatedFromGptBase: true,
      notes: '교육용 3선식 압력 트랜스미터. 전원이 유효할 때 0~10bar를 4~20mA로 변환한다.'
    }
  };

  registry.register({ id: 'ls-xgb-v24', version: '2.4.0', title: 'LS XGB communication, positioning and analog field devices', devices });
})(typeof globalThis !== 'undefined' ? globalThis : this);
