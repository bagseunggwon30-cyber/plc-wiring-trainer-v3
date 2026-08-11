(function (root) {
  'use strict';
  const registry = root.PLCDevicePacks;
  if (!registry) throw new Error('PLCDevicePacks registry must be loaded first');

  const terminal = (id, x, y, side, label, pol, extra = {}) => ({ id, x, y, side, label, pol, forceLabel: true, ...extra });
  const sideRows = (rows, width, top = 52, step = 27) => rows.map((row, index) => {
    const right = row.side === 'R';
    return terminal(row.id, right ? width - 14 : 14, top + index * step, row.side, row.label, row.pol, row.extra);
  });

  const LS_SOURCES = {
    pd02a: 'https://sol.ls-electric.com/uploads/document/17422644544600/XBF-PD02A_Manual_V2.0_202503_EN.pdf',
    l7s: 'https://www.ls-electric.com/upload/customer/download/d462ae5d-d496-439e-b71e-ad374d8a843c/Manual_XDL-L7S_200V_V2.4.pdf',
    servo: 'https://www.ls-electric.com/upload/customer/download/d9a0371f-d3c8-41b9-b6e8-7c6e04b8919d/XGT%20Servo%20XDL%20XML%20Series_Eng_160901.pdf'
  };
  const MELSEC_SOURCES = {
    qd75: 'https://dl.mitsubishielectric.com/dl/fa/document/manual/plc/sh080058/sh080058v.pdf',
    qd77ms: 'https://www.mitsubishielectric.com/fa/products/faspec/download.page?category=ex&formNm=SSC_DG_SMM_3_QD77MS4_16&id=spec&kisyu=%2Fssc&lang=2&popup=1&sub=manual',
    mrj4: 'https://dl.mitsubishielectric.com/dl/fa/document/manual/servo/sh030107/sh030107v.pdf',
    mrj4b: 'https://dl.mitsubishielectric.com/dl/fa/document/manual/servo/sh030106/sh030106t.pdf',
    motor: 'https://www.mitsubishielectric.com/fa/products/faspec/detail.page?category=ex&formNm=HG-KR3_HG-KR43_6577&id=spec&kisyu=%2Fservo&lang=2'
  };

  const devices = {
    'LS-L7S-400W': {
      cat: 'motion', label: 'LS XDL-L7SA004A', sub: 'L7S 200V · 400W · 펄스 입력 서보 앰프',
      w: 250, h: 405, color: '#233f66', icon: 'drive', overlayLabel: true,
      terminals: [
        ...sideRows([
          { id: 'L1', label: 'L1 AC200V', pol: 'AC-L', side: 'L' },
          { id: 'L2', label: 'L2 AC200V', pol: 'AC-G', side: 'L' },
          { id: 'L3', label: 'L3 AC200V', pol: 'AC-L', side: 'L' },
          { id: 'C1', label: 'C1 CONTROL', pol: 'AC-L', side: 'L' },
          { id: 'C2', label: 'C2 CONTROL', pol: 'AC-N', side: 'L' },
          { id: 'PE', label: 'PE', pol: 'PE', side: 'L' },
          { id: '24VIN', label: 'CN1-50 +24VIN', pol: 'DC+', side: 'L', extra: { pin: 'CN1-50' } },
          { id: 'GND24', label: 'CN1-24/25 GND24', pol: 'DC-', side: 'L', extra: { pin: 'CN1-24/25' } },
          { id: 'SVON', label: 'CN1-47 SVON', pol: 'DI', side: 'L', extra: { pin: 'CN1-47' } },
          { id: 'EMG', label: 'CN1-18 EMG', pol: 'DI', side: 'L', extra: { pin: 'CN1-18', safety: true } },
          { id: 'ALMRST', label: 'CN1-17 ALMRST', pol: 'DI', side: 'L', extra: { pin: 'CN1-17' } }
        ], 250, 54, 28),
        ...sideRows([
          { id: 'U', label: 'U MOTOR', pol: 'AC-G', side: 'R' },
          { id: 'V', label: 'V MOTOR', pol: 'AC-G', side: 'R' },
          { id: 'W', label: 'W MOTOR', pol: 'AC-G', side: 'R' },
          { id: 'PF+', label: 'CN1-9 PF+', pol: 'DI', side: 'R', extra: { pin: 'CN1-9', signalClass: 'line-driver+' } },
          { id: 'PF-', label: 'CN1-10 PF−', pol: 'DI', side: 'R', extra: { pin: 'CN1-10', signalClass: 'line-driver-' } },
          { id: 'PR+', label: 'CN1-11 PR+', pol: 'DI', side: 'R', extra: { pin: 'CN1-11', signalClass: 'line-driver+' } },
          { id: 'PR-', label: 'CN1-12 PR−', pol: 'DI', side: 'R', extra: { pin: 'CN1-12', signalClass: 'line-driver-' } },
          { id: 'INPOS', label: 'CN1-45 INPOS', pol: 'DO', side: 'R', extra: { pin: 'CN1-45' } },
          { id: 'READY+', label: 'CN1-40 READY+', pol: 'DO', side: 'R', extra: { pin: 'CN1-40' } },
          { id: 'READY-', label: 'CN1-41 READY−', pol: 'IO-COM', side: 'R', extra: { pin: 'CN1-41' } },
          { id: 'ALARM+', label: 'CN1-38 ALARM+', pol: 'DO', side: 'R', extra: { pin: 'CN1-38' } }
        ], 250, 54, 28)
      ],
      powerDomains: ['3-phase AC200-230V main', 'single-phase AC200-230V control', 'DC24V I/O'],
      servoAmplifier: { vendor: 'LS ELECTRIC', family: 'L7S', model: 'XDL-L7SA004A', ratedPowerKw: 0.4, axes: 1, command: 'differential-pulse', maximumLineDriverInputPps: 1000000, maximumCommandCableM: 10, shieldedTwistedPairRequired: true },
      manualSource: LS_SOURCES.l7s, manualVerified: true,
      notes: '교육용 공개 단자 의미 모델. XBF-PD02A의 FP±/RP±와 CN1 PF±/PR±를 축별로 연결한다. XBF 출력 한계와 별개로 L7S 라인드라이버 수신 한계는 1 Mpps다.'
    },
    'LS-XML-SB04A': {
      cat: 'motion', label: 'LS XML-SB04A', sub: '400W · 3000rpm · 1.27N·m 서보 모터',
      w: 250, h: 210, color: '#30485d', icon: 'motor',
      terminals: [
        terminal('U', 14, 66, 'L', 'U', 'AC-G'), terminal('V', 14, 104, 'L', 'V', 'AC-G'), terminal('W', 14, 142, 'L', 'W', 'AC-G'), terminal('PE', 14, 180, 'L', 'PE', 'PE'),
        terminal('ENC', 236, 72, 'R', 'ENCODER', 'COMM'), terminal('BRK+', 236, 122, 'R', 'BRAKE +', 'DC+'), terminal('BRK-', 236, 164, 'R', 'BRAKE −', 'DC-')
      ],
      servoMotor: { vendor: 'LS ELECTRIC', family: 'XML-SB', modelFamily: 'XML-SB04A', ratedPowerKw: 0.4, ratedRpm: 3000, maxRpm: 5000, ratedTorqueNm: 1.27, maxTorqueNm: 3.82 },
      variants: { encoderBrakeShaft: 'order suffix dependent' }, manualSource: LS_SOURCES.servo, manualVerified: true
    },
    'MELSEC-QD75D2N-RACK': {
      cat: 'plc', label: 'Q03UDVCPU + QD75D2N', sub: 'Q61P 전원 · 2축 차동 위치결정 · 4Mpps',
      w: 330, h: 450, color: '#8c6d4d', icon: 'plc', overlayLabel: true,
      modelAsset: 'mitsubishi-q-plc-module.glb',
      terminals: [
        terminal('L', 14, 55, 'L', 'Q61P L', 'AC-L'), terminal('N', 14, 88, 'L', 'Q61P N', 'AC-N'), terminal('FG', 14, 121, 'L', 'Q61P FG', 'PE'),
        ...['AX1','AX2'].flatMap((axis, axisIndex) => {
          const side = axisIndex ? 'R' : 'L', x = axisIndex ? 316 : 14, y0 = 160, contact = axisIndex ? '1B' : '1A';
          const entries = [
            ['FLS','FLS','DI'],['RLS','RLS','DI'],['DOG','DOG','DI'],['STOP','STOP','DI'],['READY','READY','DI'],
            ['PF+',`${contact}15 PULSE F+`,'DO'],['PF-',`${contact}16 PULSE F−`,'DO'],['PR+',`${contact}17 PULSE R+`,'DO'],['PR-',`${contact}18 PULSE R−`,'DO'],['CLEAR','CLEAR','DO'],['PG0','PG0','DI'],['COM','COM','IO-COM']
          ];
          return entries.map((entry, index) => terminal(`${axis}-${entry[0]}`, x, y0 + index * 23, side, `${axis} ${entry[1]}`, entry[2], { axis: axisIndex + 1 }));
        })
      ],
      positioning: { vendor: 'Mitsubishi Electric', cpu: 'Q03UDVCPU', power: 'Q61P', model: 'QD75D2N', axes: 2, pulseType: 'differential-line-driver', maxPulsePps: 4000000, maxCableM: 10, positionDataPerAxis: 600 },
      addressProfile: { device: 'MELSEC-Q', moduleReady: 'Xn0', axisBusy: ['XnC','XnD'], start: ['Yn10','Yn11'], monitorBuffer: [[800,899],[900,999]] },
      manualSource: MELSEC_SOURCES.qd75, manualVerified: true,
      notes: 'Q61P/Q03UDVCPU/QD75D2N을 교육용 한 장비로 표시한다. 모듈 축 오류와 서보 ALM은 서로 다른 상태로 모델링한다. 서보 SON/ALM/EM2는 QD75 전용 단자가 아니라 일반 PLC I/O·안전회로로 별도 결선한다.'
    },
    'MR-J4-40A': {
      cat: 'motion', label: 'Mitsubishi MR-J4-40A', sub: '200V · 400W · 위치제어 서보 앰프',
      w: 250, h: 405, color: '#4c3b2f', icon: 'drive', modelAsset: 'servo-amplifier.glb',
      terminals: [
        ...sideRows([
          { id: 'L1', label: 'L1', pol: 'AC-L', side: 'L' }, { id: 'L2', label: 'L2', pol: 'AC-G', side: 'L' }, { id: 'L3', label: 'L3', pol: 'AC-L', side: 'L' },
          { id: 'L11', label: 'L11 CONTROL', pol: 'AC-L', side: 'L' }, { id: 'L21', label: 'L21 CONTROL', pol: 'AC-N', side: 'L' }, { id: 'PE', label: 'PE', pol: 'PE', side: 'L' },
          { id: 'DICOM', label: 'CN1-8/9 DICOM', pol: 'IO-COM', side: 'L' }, { id: 'SON', label: 'CN1-15 SON', pol: 'DI', side: 'L' },
          { id: 'RES', label: 'CN1-19 RES', pol: 'DI', side: 'L' }, { id: 'EM2', label: 'CN1-42 EM2', pol: 'DI', side: 'L', extra: { safety: true } },
          { id: 'LSP', label: 'CN1-43 LSP', pol: 'DI', side: 'L' }, { id: 'LSN', label: 'CN1-44 LSN', pol: 'DI', side: 'L' }
        ], 250, 50, 27),
        ...sideRows([
          { id: 'U', label: 'U MOTOR', pol: 'AC-G', side: 'R' }, { id: 'V', label: 'V MOTOR', pol: 'AC-G', side: 'R' }, { id: 'W', label: 'W MOTOR', pol: 'AC-G', side: 'R' },
          { id: 'PP', label: 'CN1-10 PP · QD75 F+', pol: 'DI', side: 'R', extra: { signalClass: 'line-driver+' } },
          { id: 'PG', label: 'CN1-11 PG · QD75 R+', pol: 'DI', side: 'R', extra: { signalClass: 'line-driver+' } },
          { id: 'NP', label: 'CN1-35 NP · QD75 F−', pol: 'DI', side: 'R', extra: { signalClass: 'line-driver-' } },
          { id: 'NG', label: 'CN1-36 NG · QD75 R−', pol: 'DI', side: 'R', extra: { signalClass: 'line-driver-' } },
          { id: 'INP', label: 'CN1 INP', pol: 'DO', side: 'R', extra: { assignable: true } },
          { id: 'OP', label: 'CN1-33 OP(Z)', pol: 'DO', side: 'R' }, { id: 'ALM', label: 'CN1-48 ALM', pol: 'DO', side: 'R' },
          { id: 'RD', label: 'CN1-49 RD', pol: 'DO', side: 'R' }, { id: 'DOCOM', label: 'CN1-46/47 DOCOM', pol: 'IO-COM', side: 'R' }
        ], 250, 50, 27)
      ],
      servoAmplifier: { vendor: 'Mitsubishi Electric', family: 'MR-J4-A', model: 'MR-J4-40A', ratedPowerKw: 0.4, axes: 1, command: 'differential-pulse', maxPulsePps: 4000000 },
      manualSource: MELSEC_SOURCES.mrj4, manualVerified: true,
      notes: 'QD75D 직접 결선은 F+→PP(10), F−→NP(35), R+→PG(11), R−→NG(36)이다. INP를 포함한 일부 CN1 기능은 파라미터 할당에 따라 핀이 달라질 수 있어 assignable 메타데이터로 표시한다.'
    },
    'MELSEC-QD77MS2-RACK': {
      cat: 'plc', label: 'Q03UDVCPU + QD77MS2', sub: '2축 Simple Motion · SSCNET III/H',
      w: 330, h: 450, color: '#75533f', icon: 'plc', overlayLabel: true,
      modelAsset: 'mitsubishi-q-plc-module.glb',
      terminals: [
        terminal('L', 14, 55, 'L', 'Q61P L', 'AC-L'), terminal('N', 14, 88, 'L', 'Q61P N', 'AC-N'), terminal('FG', 14, 121, 'L', 'Q61P FG', 'PE'),
        terminal('SSCNET', 316, 178, 'R', 'SSCNET III/H', 'COMM', { protocol: 'SSCNET III/H', medium: 'optical', direction: 'controller-out' })
      ],
      motionNetwork: { vendor: 'Mitsubishi Electric', controller: 'QD77MS2', axes: 2, protocol: 'SSCNET III/H', topology: 'controller-to-CN1A-daisy-chain' },
      manualSource: MELSEC_SOURCES.qd77ms, manualVerified: true,
      assetEvidence: { status: 'BLOCKED', code: 'ASSET_MODEL_UNVERIFIED', reason: '가져온 Q PLC GLB가 QD77MS2의 정확한 외형·커넥터를 증명하지 않음' },
      notes: 'QD75D2N 펄스열 프로필과 분리된 SSCNET III/H 교육 프로필이다. 선택한 프로필 밖의 주소와 광링크는 활성화하지 않는다.'
    },
    'MR-J4-40B': {
      cat: 'motion', label: 'Mitsubishi MR-J4-40B', sub: '200V · 400W · SSCNET III/H 서보 앰프',
      w: 250, h: 405, color: '#49372e', icon: 'drive', modelAsset: 'servo-amplifier.glb',
      terminals: [
        ...sideRows([
          { id: 'L1', label: 'L1', pol: 'AC-L', side: 'L' }, { id: 'L2', label: 'L2', pol: 'AC-G', side: 'L' }, { id: 'L3', label: 'L3', pol: 'AC-L', side: 'L' },
          { id: 'L11', label: 'L11 CONTROL', pol: 'AC-L', side: 'L' }, { id: 'L21', label: 'L21 CONTROL', pol: 'AC-N', side: 'L' }, { id: 'PE', label: 'PE', pol: 'PE', side: 'L' },
          { id: 'CN1A', label: 'CN1A PREVIOUS/CONTROLLER', pol: 'COMM', side: 'L', extra: { protocol: 'SSCNET III/H', medium: 'optical', direction: 'in' } },
          { id: 'CN1B', label: 'CN1B NEXT/CAP', pol: 'COMM', side: 'L', extra: { protocol: 'SSCNET III/H', medium: 'optical', direction: 'out', finalRequirement: 'PROTECTIVE_CAP' } }
        ], 250, 54, 32),
        ...sideRows([
          { id: 'U', label: 'U MOTOR', pol: 'AC-G', side: 'R' }, { id: 'V', label: 'V MOTOR', pol: 'AC-G', side: 'R' }, { id: 'W', label: 'W MOTOR', pol: 'AC-G', side: 'R' },
          { id: 'CN2', label: 'CN2 MOTOR ENCODER', pol: 'COMM', side: 'R' }, { id: 'CN8', label: 'CN8 STO', pol: 'DI', side: 'R', extra: { safety: true } },
          { id: 'DICOM', label: 'CN3-5/10 DICOM', pol: 'IO-COM', side: 'R' }, { id: 'EM2', label: 'CN3-20 EM2', pol: 'DI', side: 'R', extra: { safety: true } },
          { id: 'ALM', label: 'CN3-15 ALM', pol: 'DO', side: 'R' }, { id: 'DOCOM', label: 'CN3-3 DOCOM', pol: 'IO-COM', side: 'R' }
        ], 250, 54, 32)
      ],
      servoAmplifier: { vendor: 'Mitsubishi Electric', family: 'MR-J4-B', model: 'MR-J4-40B', ratedPowerKw: 0.4, axes: 1, command: 'SSCNET III/H' },
      manualSource: MELSEC_SOURCES.mrj4b, manualVerified: true,
      assetEvidence: { status: 'BLOCKED', code: 'ASSET_MODEL_UNVERIFIED', reason: '가져온 서보 앰프·SSCNET 헤드 GLB의 정확 품번과 커넥터 치수가 확인되지 않음' },
      notes: '컨트롤러에서 첫 축 CN1A, 이전 축 CN1B에서 다음 축 CN1A로 연결한다. 마지막 CN1B에는 종단저항이 아니라 먼지 보호용 캡을 장착한다.'
    },
    'HG-KR43': {
      cat: 'motion', label: 'Mitsubishi HG-KR43', sub: '400W · 3000rpm · 22-bit 엔코더',
      w: 250, h: 210, color: '#3c454e', icon: 'motor',
      terminals: [
        terminal('U', 14, 66, 'L', 'U', 'AC-G'), terminal('V', 14, 104, 'L', 'V', 'AC-G'), terminal('W', 14, 142, 'L', 'W', 'AC-G'), terminal('PE', 14, 180, 'L', 'PE', 'PE'),
        terminal('ENC', 236, 78, 'R', '22-bit ENCODER', 'COMM'), terminal('BRK+', 236, 128, 'R', 'BRAKE +', 'DC+'), terminal('BRK-', 236, 170, 'R', 'BRAKE −', 'DC-')
      ],
      servoMotor: { vendor: 'Mitsubishi Electric', family: 'HG-KR', model: 'HG-KR43', ratedPowerKw: 0.4, ratedRpm: 3000, maxRpm: 6000, encoderPulsesPerRev: 4194304 },
      variants: { brake: 'HG-KR43B' }, manualSource: MELSEC_SOURCES.motor, manualVerified: true
    },
    'MPS-CONVEYOR-STATION': {
      cat: 'actuator', label: 'MPS 컨베이어 스테이션', sub: '작업물 감지·금속 판별·정지·배출 실습',
      w: 390, h: 190, color: '#42697b', icon: 'motor', modelAsset: 'mps-complete-station.glb',
      terminals: [
        terminal('P24', 18, 55, 'L', '+24V', 'DC+'), terminal('N24', 18, 92, 'L', '0V', 'DC-'),
        terminal('MOTOR', 18, 143, 'L', 'CONVEYOR', 'DI'), terminal('STOPPER', 372, 55, 'R', 'STOPPER', 'DI'),
        terminal('ENTRY', 372, 86, 'R', 'ENTRY SENSOR', 'DO'), terminal('POSITION', 372, 117, 'R', 'POSITION SENSOR', 'DO'),
        terminal('METAL', 372, 148, 'R', 'METAL SENSOR', 'DO'), terminal('EXIT', 372, 177, 'R', 'EXIT SENSOR', 'DO')
      ],
      powerPairs: [{ pos: 'P24', neg: 'N24', kind: 'DC24' }], modelKind: 'MPS', importedAsset: true
    },
    'PNEU-SERVICE-UNIT': {
      cat: 'pneumatic', label: '공압 서비스·분배 유닛', sub: '공급압력·레귤레이터·다분기 포트',
      w: 250, h: 180, color: '#377a83', icon: 'sensor', modelAsset: 'service-unit.glb',
      terminals: [
        terminal('AIR-IN', 14, 78, 'L', 'AIR IN', 'NEUTRAL', { medium: 'air' }), terminal('AIR-OUT', 236, 78, 'R', 'REG OUT', 'NEUTRAL', { medium: 'air' }),
        terminal('P1', 236, 118, 'R', 'BRANCH 1', 'NEUTRAL', { medium: 'air' }), terminal('P2', 236, 153, 'R', 'BRANCH 2', 'NEUTRAL', { medium: 'air' })
      ],
      pneumatic: { role: 'source', maxBar: 8, regulatedBar: 5 }, importedAsset: true
    }
  };

  registry.register({ id: 'automation-equipment-v27', version: '2.7.0', title: 'LS/Mitsubishi servo, positioning, MPS and pneumatic training equipment', devices });
})(typeof globalThis !== 'undefined' ? globalThis : this);
