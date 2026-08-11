(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const Three = window.THREE;
  const Servo = window.PLCTrainerServo2Runtime;
  const MPS = window.PLCTrainerMPSRuntime;
  const Pneumatic = window.PLCTrainerPneumaticRuntime;
  const Discrete = window.PLCTrainerDiscreteIoRuntime;
  const CameraNavigation = window.PLCTrainerCameraNavigation;
  if (!Servo || !MPS || !Pneumatic || !Discrete || !CameraNavigation) {
    console.error('Automation lab runtimes or camera navigation are missing');
    return;
  }

  const LABS = ['palletizer3d', 'servo2', 'mps', 'pneumatic', 'discrete', 'equipment3d'];
  const EQUIPMENT_LABELS = Object.freeze({
    'mitsubishi-q-plc-module.glb': 'Mitsubishi Q PLC 모듈',
    'servo-amplifier.glb': '서보 앰프',
    'relay-module.glb': '8핀 릴레이 모듈',
    'timer-box.glb': '디지털 타이머 박스',
    'counter-unit.glb': '디지털 카운터',
    'counter-box.glb': '디지털 카운터 전체 박스',
    'sscnetiii-amp-head.glb': 'SSCNET III 앰프 헤드',
    'ruler.glb': '작업물 치수 눈금자',
    'banana-plug-black.glb': '바나나 플러그 · BPlugBlack',
    'workblock-steel-blue.glb': '청색 강재 블록',
    'workblock-plastic-orange.glb': '주황 수지 블록',
    'smps.glb': 'DC 전원공급기(SMPS)',
    'switch-box.glb': '3버튼 스위치 박스',
    'buzzer-lamp.glb': '버저·표시등 박스',
    'tower-lamp.glb': '3단 타워 램프',
    'photo-sensor-npn.glb': '광전 센서 NPN',
    'photo-sensor-pnp.glb': '광전 센서 PNP',
    'inductive-sensor-npn.glb': '유도형 근접 센서 NPN',
    'inductive-sensor-pnp.glb': '유도형 근접 센서 PNP',
    'capacitive-sensor-npn.glb': '정전용량 센서 NPN',
    'capacitive-sensor-pnp.glb': '정전용량 센서 PNP',
    'limit-switch-left.glb': '리미트 스위치 좌형',
    'limit-switch-right.glb': '리미트 스위치 우형',
    'double-acting-cylinder.glb': '복동 실린더',
    'valve-5-2-single.glb': '5/2 단솔 밸브',
    'valve-5-2-double.glb': '5/2 복솔 밸브',
    'service-unit.glb': '공압 서비스 유닛',
    'air-distributor.glb': '에어 분배기',
    'speed-controller.glb': '스피드 컨트롤러',
    'mps-complete-station.glb': 'MPS 통합 스테이션',
    'servo2-workshop.glb': '2축 서보 워크숍',
    'workpiece-steel.glb': '강재 워크',
    'workpiece-plastic.glb': '수지 워크'
  });
  const EQUIPMENT_GROUPS = Object.freeze([
    ['control', '제어·전원', /(?:plc|servo-amplifier|sscnet|relay|timer|counter|smps|switch-box|buzzer|tower)/],
    ['sensor', '센서·스위치', /(?:sensor|limit-switch)/],
    ['pneumatic', '공압 장비', /(?:cylinder|valve|service-unit|air-distributor|speed-controller)/],
    ['accessory', '결선·계측 부속', /(?:banana-plug|ruler)/],
    ['plant', '설비·워크', /(?:mps|servo2-workshop|workpiece|workblock)/]
  ]);
  const CAMERA_DISTANCE = 16.17;
  const CAMERA_PRESETS = Object.freeze({
    // Keep the audited default direction and focus, but frame the equipment
    // instead of the classroom scenery that has intentionally been removed.
    default: Object.freeze({ focus: [-2.8e-8, .882998, .0190001], pitch: 10.67, yaw: 360, scale: .9 }),
    space: Object.freeze({ focus: [0, .82, 0], pitch: 90, yaw: 0, scale: 1 }),
    f1: Object.freeze({ focus: [5.72e-6, .819996, 0], pitch: 24.9, yaw: 20.2, scale: .9 }),
    f2: Object.freeze({ focus: [0, .87, 0], pitch: 27.33, yaw: 332.5, scale: .76 })
  });
  const MPS_OUTPUT_LABELS = Object.freeze([
    '공급 F', '공급 R', '드릴 승강', '분배 F', '분배 R', '배출 F', '배출 R',
    '리프트 F', '리프트 R', '진공', '언로딩 F', '언로딩 R', '스토퍼',
    '드릴 모터', '컨베이어', '적색등', '황색등', '녹색등'
  ]);
  const MPS_INPUT_LABELS = Object.freeze([
    '공급 FLS', '공급 RLS', '드릴 FLS', '드릴 RLS', '분배 FLS', '분배 RLS',
    '배출 FLS', '배출 RLS', '스토퍼 FLS', '스토퍼 RLS', '리프트 FLS',
    '리프트 RLS', '언로딩 FLS', '언로딩 RLS', '공급 감지', '분배 감지',
    '금속 감지', '정전용량', '종단 감지', '진공 확인', '미사용', '미사용',
    '미사용', '미사용', '서보 RLS(NC)', '서보 DOG', '서보 FLS(NC)'
  ]);
  const DISCRETE_INPUTS = Object.freeze([
    ['switchGreen', 'START 녹색 PB'], ['switchBlue', 'RESET 청색 PB'], ['switchRed', 'STOP 적색 PB'],
    ['photoNpn', '광전 NPN'], ['photoPnp', '광전 PNP'], ['inductiveNpn', '유도 NPN'],
    ['inductivePnp', '유도 PNP'], ['capacitiveNpn', '정전용량 NPN'], ['capacitivePnp', '정전용량 PNP'],
    ['limitLeft', '좌 리미트'], ['limitRight', '우 리미트']
  ]);
  const DISCRETE_OUTPUTS = Object.freeze([
    ['relay1', 'RY1'], ['relay2', 'RY2'], ['relay3', 'RY3'], ['timer', 'TIMER IN'], ['counter', 'COUNTER PULSE'],
    ['lampGreen', '녹색 램프'], ['lampYellow', '황색 램프'], ['lampRed', '적색 램프'], ['lampWhite', '백색 램프'],
    ['buzzer', '버저'], ['towerGreen', '타워 녹색'], ['towerYellow', '타워 황색'], ['towerRed', '타워 적색']
  ]);
  const A = {
    host: null, hub: null, content: null, activeLab: 'servo2', visible: false, initialized: false,
    state: null, renderer: null, canvasHost: null, raf: 0, lastTime: 0, lastUi: 0, lastSave: 0,
    scenes: {}, editors: {}, editorMarkers: {}, drag: null, editorDrag: null,
    resizeObserver: null, importedLoaded: false, equipmentCatalog: [], equipmentLoadToken: 0
  };
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrapDegrees = value => ((value % 360) + 360) % 360;
  const normalizeMpsWorkpieceStyle = value => value === 'block' ? 'block' : 'compact';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function loadSaved() {
    let saved = null;
    try { if (typeof S !== 'undefined') saved = S.automationLab || null; } catch (_) { /* standalone */ }
    const activeLab = LABS.includes(saved?.activeLab) ? saved.activeLab : 'servo2';
    return {
      schemaVersion: 4,
      activeLab,
      cameraNavigationPreset: CameraNavigation.normalizePreset(saved?.cameraNavigationPreset),
      labs: {
        servo2: Servo.createState({ saved: saved?.labs?.servo2 }),
        mps: MPS.createState({ saved: saved?.labs?.mps }),
        pneumatic: Pneumatic.createState({ saved: saved?.labs?.pneumatic }),
        discrete: Discrete.createState({ saved: saved?.labs?.discrete })
      },
      editor: saved?.editor || null,
      equipment: { selected: typeof saved?.equipment?.selected === 'string' ? saved.equipment.selected : 'relay-module.glb' },
      appearance: { mpsWorkpieceStyle: normalizeMpsWorkpieceStyle(saved?.appearance?.mpsWorkpieceStyle) }
    };
  }

  function exportState() {
    if (!A.state) return null;
    return {
      schemaVersion: 4,
      activeLab: A.activeLab,
      cameraNavigationPreset: CameraNavigation.normalizePreset(A.state.cameraNavigationPreset),
      labs: {
        servo2: Servo.exportState(A.state.labs.servo2),
        mps: MPS.exportState(A.state.labs.mps),
        pneumatic: Pneumatic.exportState(A.state.labs.pneumatic),
        discrete: Discrete.exportState(A.state.labs.discrete)
      },
      editor: Object.fromEntries(Object.entries(A.editors).map(([lab, editor]) => [lab, editor.serialize()])),
      equipment: { selected: A.state.equipment?.selected || 'relay-module.glb' },
      appearance: { mpsWorkpieceStyle: normalizeMpsWorkpieceStyle(A.state.appearance?.mpsWorkpieceStyle) }
    };
  }

  function persist(force = false) {
    const now = performance.now();
    if (!force && now - A.lastSave < 700) return;
    A.lastSave = now;
    const value = exportState();
    try { if (typeof S !== 'undefined') S.automationLab = value; } catch (_) { /* standalone */ }
  }

  function injectCss() {
    if (q('#al-style')) return;
    const style = document.createElement('style');
    style.id = 'al-style';
    style.textContent = `
      #al-hub{position:absolute;inset:0;display:grid;grid-template-rows:43px minmax(0,1fr);background:#091119;color:#dce8ef;font-family:'Malgun Gothic',sans-serif}
      #al-tabs{position:relative;z-index:20;display:flex;align-items:center;gap:5px;padding:5px 9px;border-bottom:1px solid #2a4456;background:#101c25;box-shadow:0 3px 12px rgba(0,0,0,.24)}
      #al-tabs b{margin-right:7px;color:#b7d3e3;font-size:11px;white-space:nowrap}#al-tabs small{margin-left:auto;color:#68889b;font:9px Consolas,monospace;white-space:nowrap}
      .al-tab{height:31px;padding:0 11px;border:1px solid #3b5667;border-radius:4px;background:#1c2c37;color:#b9cbd5;cursor:pointer;font-size:10px}.al-tab:hover{background:#284457;color:#fff}.al-tab.active{border-color:#4ba8d9;background:#176b9b;color:#fff;box-shadow:0 0 0 1px rgba(75,168,217,.2) inset}
      .al-camera-navigation{display:flex;align-items:center;gap:4px;margin-left:auto;color:#7f9aab;font-size:8px;white-space:nowrap}.al-camera-navigation select{height:27px;border:1px solid #3b5667;border-radius:4px;background:#0b1720;color:#dce9ef;padding:0 5px;font:9px Consolas,monospace}.al-camera-navigation select:focus-visible{border-color:#7dc5ed;outline:1px solid #7dc5ed}
      #al-content{position:relative;min-height:0}.al-pane{display:none;position:absolute;inset:0;min-height:0}.al-pane.active{display:block}.al-pane-grid{display:grid;grid-template-columns:minmax(0,1fr) 350px;height:100%;min-height:0;background:#091119}
      .al-scene{position:relative;min-width:0;min-height:0;overflow:hidden;background:radial-gradient(circle at 45% 35%,#243746,#071018 72%)}.al-scene canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}
      .al-scene-title{position:absolute;z-index:4;left:14px;top:12px;display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #35566c;border-radius:5px;background:rgba(5,13,19,.84);pointer-events:none}.al-scene-title b{font-size:12px;color:#fff}.al-scene-title span{font:9px Consolas;color:#7fb5d2}
      .al-camera-presets{position:absolute;z-index:6;right:14px;top:12px;display:flex;gap:4px}.al-camera-preset{height:28px;padding:0 8px;border:1px solid #567184;border-radius:4px;background:rgba(13,27,36,.9);color:#d9e8ef;cursor:pointer;font:9px Consolas}.al-camera-preset:hover,.al-camera-preset:focus-visible{border-color:#7dc5ed;background:#28536c;color:#fff;outline:none}
      .al-editor-tools{position:absolute;z-index:7;left:14px;top:53px;display:flex;gap:3px;padding:4px;border:1px solid #526b7a;border-radius:4px;background:rgba(17,25,30,.9)}.al-editor-mode{height:26px;padding:0 7px;border:1px solid #4b5d67;border-radius:3px;background:#313b40;color:#d9e3e8;cursor:pointer;font-size:8px}.al-editor-mode.active{border-color:#8f83ff;background:#514a91;color:#fff}.al-editor-mode:disabled{opacity:.28;cursor:not-allowed}.al-editor-mode:not(:disabled):hover{background:#485861}.al-editor-mode kbd{font:7px Consolas;color:#9fb4c0}
      .al-scene-hint{position:absolute;z-index:4;left:14px;bottom:12px;padding:5px 8px;border-radius:4px;background:rgba(5,13,19,.75);color:#8da5b4;font-size:9px;pointer-events:none}
      .al-side{overflow:auto;border-left:1px solid #263f50;background:#101b23;padding:11px 11px 24px;scrollbar-color:#496271 #101b23}.al-section{margin:0 0 9px;padding:9px;border:1px solid #2a4353;border-radius:6px;background:#14232d}.al-section h3{margin:0 0 7px;color:#a9cede;font-size:10px;letter-spacing:.04em}.al-section small{color:#7796a8;font-size:8px}
      .al-status{display:flex;justify-content:space-between;gap:8px;margin-bottom:7px;padding:7px;border-radius:4px;background:#0b151c}.al-status b{font-size:11px;color:#fff}.al-status span{font:9px Consolas;color:#75c9ef;text-align:right}.al-status.fault b,.al-status.fault span{color:#ff8077}
      .al-actions{display:grid;grid-template-columns:repeat(2,1fr);gap:5px}.al-actions.three{grid-template-columns:repeat(3,1fr)}.al-btn{min-height:29px;border:1px solid #456174;border-radius:4px;background:#253946;color:#e9f3f8;padding:6px 4px;cursor:pointer;font-size:9px}.al-btn:hover{background:#31556b;border-color:#64a1c5}.al-btn.run{background:#17623f;border-color:#2e9668}.al-btn.stop{background:#74332e;border-color:#aa554d}.al-btn.on{color:#8cf3b6;border-color:#43ae70;background:#174b35}
      .al-profile{display:grid;grid-template-columns:88px 1fr;gap:6px;align-items:center;margin-bottom:7px;color:#8ba7b7;font-size:9px}.al-profile select,.al-field input,.al-field select{width:100%;box-sizing:border-box;border:1px solid #3a5364;border-radius:3px;background:#071118;color:#e0edf4;padding:5px;font:9px Consolas}
      .al-axis{display:grid;grid-template-columns:22px 1fr 62px;gap:6px;align-items:center;margin:5px 0;padding:6px;border-radius:4px;background:#0c171e}.al-axis>strong{font:700 13px Consolas;color:#68c9f3}.al-axis-value{font:700 11px Consolas;color:#fff}.al-axis-flags{margin-top:2px;color:#7895a5;font:8px Consolas;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.al-jog{display:grid;grid-template-columns:1fr 1fr;gap:3px}.al-jog button{height:27px;border:1px solid #405b6c;border-radius:3px;background:#21333f;color:#fff;cursor:pointer}.al-axis-target{display:grid;grid-template-columns:1fr 37px;gap:3px;margin-top:3px}.al-axis-target input{min-width:0;border:1px solid #385160;border-radius:3px;background:#061017;color:#dcecf4;padding:4px;font:9px Consolas}.al-axis-target button{border:1px solid #49677a;border-radius:3px;background:#29485c;color:#fff;font-size:8px;cursor:pointer}
      .al-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.al-field{display:block;color:#819cac;font-size:8px}.al-field input,.al-field select{display:block;margin-top:3px}.al-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.al-indicator{padding:5px 3px;border:1px solid #2f4654;border-radius:3px;background:#0b151b;text-align:center;color:#657d8c;font:8px Consolas}.al-indicator.on{border-color:#2fa765;color:#88f0b3;background:#123828}.al-indicator.metal.on{border-color:#e0a72e;color:#ffd779;background:#4c3712}
      .al-checks{display:grid;grid-template-columns:1fr 1fr;gap:5px}.al-check{display:flex;align-items:center;gap:5px;padding:6px;border:1px solid #2e4654;border-radius:3px;background:#0c171e;color:#a8bdc8;font-size:9px}.al-check input{accent-color:#20a3e0}.al-counters{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.al-counter{padding:6px 3px;border-radius:3px;background:#0b151c;text-align:center}.al-counter b{display:block;color:#fff;font:700 13px Consolas}.al-counter span{color:#7591a2;font-size:7px}
      .al-log{max-height:72px;overflow:auto;color:#82a0b0;font:8px Consolas}.al-log div{padding:2px 0;border-bottom:1px dotted #29414f}.al-log .fault{color:#ff8077}.al-memory{width:100%;border-collapse:collapse;font:8px Consolas}.al-memory td{border:1px solid #29414f;padding:3px}.al-memory td:last-child{text-align:right;color:#fff}
      .al-io-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px}.al-io{min-width:0;padding:4px 3px;border:1px solid #2d4553;border-radius:3px;background:#0b151b;color:#6f8795;font:7px Consolas;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.al-io.on{border-color:#2fa765;background:#123828;color:#8af0b4}.al-io.reserved{opacity:.42}.al-output-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}.al-output{display:flex;align-items:center;gap:4px;min-width:0;padding:4px;border:1px solid #304957;border-radius:3px;background:#0c171e;color:#a8bdc8;font-size:8px}.al-output input{margin:0;accent-color:#20a3e0}.al-output span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.al-servo-slide{display:grid;grid-template-columns:70px 1fr 38px;gap:5px;align-items:center;color:#8ca6b5;font-size:8px}.al-servo-slide input{width:100%;accent-color:#20a3e0}.al-servo-slide output{text-align:right;color:#fff;font:8px Consolas}
      .al-pressure{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.al-gauge{padding:7px 3px;border-radius:4px;background:#0a151c;text-align:center}.al-gauge b{display:block;color:#75d0f4;font:700 14px Consolas}.al-gauge span{color:#7894a4;font-size:7px}.al-stroke{height:9px;overflow:hidden;border-radius:7px;background:#071017}.al-stroke i{display:block;height:100%;width:0;background:linear-gradient(90deg,#1b7eae,#5de2ff);transition:width .08s linear}
      .al-asset-note{margin:6px 0 0;padding:6px;border-left:3px solid #587a8e;background:#0b161d;color:#809bab;font-size:8px;line-height:1.45}
      .al-equipment-select{width:100%;min-height:310px;box-sizing:border-box;border:1px solid #38586b;border-radius:5px;background:#08131a;color:#dbeaf1;padding:4px;font:9px 'Malgun Gothic',sans-serif}.al-equipment-select option{padding:5px}.al-equipment-select optgroup{color:#78b9d8;font-weight:700}.al-equipment-meta{display:grid;grid-template-columns:80px minmax(0,1fr);gap:5px;margin-top:8px;font:8px Consolas;color:#89a5b5}.al-equipment-meta dt{color:#638092}.al-equipment-meta dd{margin:0;color:#d8e8ef;overflow-wrap:anywhere}.al-equipment-loading{color:#78cff3}.al-equipment-error{color:#ff8077}
      @media(max-width:960px){.al-pane-grid{grid-template-columns:minmax(0,1fr) 300px}#al-tabs small,.al-camera-navigation span{display:none}.al-tab{padding:0 7px}.al-side{padding:8px}.al-camera-presets{top:48px}}
    `;
    document.head.appendChild(style);
  }

  function cameraPresetButtons() {
    return `<div class="al-camera-presets" aria-label="카메라 프리셋"><button class="al-camera-preset" data-camera-preset="space" title="상단 보기 (Space)">SPACE 상단</button><button class="al-camera-preset" data-camera-preset="f1" title="프리셋 1 (F1)">F1</button><button class="al-camera-preset" data-camera-preset="f2" title="프리셋 2 (F2)">F2</button></div>`;
  }

  function cameraHintElement(extra = '', legacyHint = '우클릭: 회전 · 가운데 드래그: 이동 · 휠: 확대/축소') {
    const preset = A.state?.cameraNavigationPreset || '3ds-max';
    return `<div class="al-scene-hint" data-camera-hint data-camera-extra="${esc(extra)}" data-camera-legacy="${esc(legacyHint)}">${esc(CameraNavigation.hint(preset, legacyHint) + extra)}</div>`;
  }

  function editorToolbar(lab) {
    const modes = [['CONTROL', '제어', '1'], ['MOVE', '이동', '2'], ['DELETE_MODULE', '장비삭제', '3'], ['WIRE', '결선', '4'], ['AIR', '튜브', '5'], ['DELETE_WIRE', '선삭제', '6']];
    const allowed = lab === 'pneumatic'
      ? new Set(modes.map(item => item[0]))
      : lab === 'discrete'
        ? new Set(['CONTROL', 'MOVE', 'DELETE_MODULE', 'WIRE', 'DELETE_WIRE'])
        : new Set(['CONTROL', 'WIRE', 'DELETE_WIRE']);
    return `<div class="al-editor-tools" data-editor-tools="${lab}" aria-label="SoV 편집 모드">${modes.map(([mode, label, key]) => `<button class="al-editor-mode" data-editor-mode="${mode}"${allowed.has(mode) ? '' : ' disabled'} title="${label} (${key})">${label} <kbd>${key}</kbd></button>`).join('')}</div>`;
  }

  function servoPane() {
    return `<div class="al-pane-grid"><div class="al-scene" data-scene="servo2"><div class="al-scene-title"><b>2축 서보 제어 실습실</b><span>XBF-PD02A / QD75D2N</span></div>${cameraPresetButtons()}${editorToolbar('servo2')}${cameraHintElement(' · SPACE/F1/F2 시점')}</div><aside class="al-side">
      <section class="al-section"><div class="al-status" id="al-servo-status"><b>대기</b><span>IDLE</span></div><label class="al-profile">장비 프로필<select id="al-servo-profile"><option value="ls">LS XBF-PD02A + L7S</option><option value="mitsubishi">Mitsubishi QD75 + MR-J4</option></select></label><div class="al-actions three"><button class="al-btn run" data-servo-action="servo">SERVO ON</button><button class="al-btn" data-servo-action="home">전축 원점</button><button class="al-btn stop" data-servo-action="stop">전축 정지</button></div></section>
      <section class="al-section"><h3>축 수동 운전 <small>누르는 동안 JOG</small></h3>${['X', 'Y'].map(axis => `<div class="al-axis"><strong>${axis}</strong><div><div class="al-axis-value" data-servo-pos="${axis}">0.00 mm</div><div class="al-axis-flags" data-servo-flags="${axis}">SERVO OFF</div><div class="al-axis-target"><input data-servo-target="${axis}" type="number" step="1" value="${axis === 'X' ? 320 : 240}"><button data-servo-move="${axis}">ABS</button></div></div><div class="al-jog"><button data-servo-jog="${axis},-1">−</button><button data-servo-jog="${axis},1">＋</button></div></div>`).join('')}</section>
      <section class="al-section"><h3>2축 직선 보간</h3><div class="al-fields"><label class="al-field">X 목표<input id="al-linear-x" type="number" value="380"></label><label class="al-field">Y 목표<input id="al-linear-y" type="number" value="300"></label><label class="al-field">속도<input id="al-linear-speed" type="number" value="140"></label></div><button class="al-btn" data-servo-action="linear" style="width:100%;margin-top:6px">X/Y 동시 직선 보간</button></section>
      <section class="al-section"><h3>내부 PLC 주소 이미지 <small>실제 PLC 전송 없음</small></h3><table class="al-memory" id="al-servo-memory"></table><div class="al-asset-note">LS L7S/XML 및 Mitsubishi Q/MR-J4 공개 단자 의미를 분리했습니다. 모듈 오류와 서보 ALM은 서로 다른 상태입니다.</div></section>
    </aside></div>`;
  }

  function mpsPane() {
    return `<div class="al-pane-grid"><div class="al-scene" data-scene="mps"><div class="al-scene-title"><b>MPS 제어 실습실</b><span>CONVEYOR · PROCESSING · TRANSFER</span></div>${cameraPresetButtons()}${editorToolbar('mps')}${cameraHintElement(' · SPACE/F1/F2 시점')}</div><aside class="al-side">
      <section class="al-section"><div class="al-status" id="al-mps-status"><b>PLC 출력 대기</b><span>18 OUT · 27 IN</span></div><label class="al-profile">PLC 주소 프로필<select id="al-mps-profile"><option value="ls">LS XGB / XG5000</option><option value="mitsubishi">Mitsubishi QnU</option></select></label><label class="al-profile">워크 3D 형상<select id="al-mps-workpiece-style"><option value="compact">기존 소형 워크 · 28 mm</option><option value="block">SoV 재질 블록 · 60×80×40 mm</option></select></label><div class="al-actions"><button class="al-btn run" data-mps-action="auto">▶ PLC 제어</button><button class="al-btn stop" data-mps-action="outputs-off">출력 전체 OFF</button><button class="al-btn" data-mps-action="steel">＋ 강재 워크</button><button class="al-btn" data-mps-action="plastic">＋ PP 워크</button><button class="al-btn" data-mps-action="reset">↺ 설비 리셋</button><button class="al-btn" data-mps-action="clear">워크 비우기</button></div></section>
      <section class="al-section"><h3>리프트 서보 <small id="al-mps-lift-addresses">선택 PLC RLS · DOG · FLS</small></h3><label class="al-servo-slide"><span id="al-mps-lift-target-label">위치 명령</span><input id="al-mps-lift" type="range" min="0" max="100" value="0"><output id="al-mps-lift-value">0%</output></label></section>
      <section class="al-section"><h3>선택 PLC 출력 18점 <small>한 제조사 주소만 활성</small></h3><div class="al-output-grid">${MPS_OUTPUT_LABELS.map((label, index) => `<label class="al-output" title="O${index} ${label}"><input type="checkbox" data-mps-output-index="${index}"><span data-mps-output-label="${index}">O${index} ${label}</span></label>`).join('')}</div></section>
      <section class="al-section"><h3>선택 PLC 입력 27점</h3><div class="al-io-grid">${MPS_INPUT_LABELS.map((label, index) => `<div class="al-io${index >= 20 && index <= 23 ? ' reserved' : ''}" data-mps-input-index="${index}" title="I${index} ${label}"><span data-mps-input-label="${index}">I${index} ${label}</span></div>`).join('')}</div></section>
      <section class="al-section"><h3>이벤트</h3><div class="al-log" id="al-mps-log"></div><div class="al-asset-note">강재/PP 분류 순서는 내장하지 않습니다. XG5000 또는 수동 O0–O17 출력으로 원본 설비를 직접 구동합니다.</div></section>
    </aside></div>`;
  }

  function pneumaticPane() {
    return `<div class="al-pane-grid"><div class="al-scene" data-scene="pneumatic"><div class="al-scene-title"><b>공압 제어 실습실</b><span>5/2 VALVE · D/A CYLINDER · VACUUM</span></div>${cameraPresetButtons()}${editorToolbar('pneumatic')}${cameraHintElement(' · SPACE/F1/F2 시점')}</div><aside class="al-side">
      <section class="al-section"><div class="al-status" id="al-pneu-status"><b>대기</b><span>IDLE</span></div><label class="al-profile">PLC 주소 프로필<select id="al-pneu-profile"><option value="ls">LS XGB / XG5000</option><option value="mitsubishi">Mitsubishi QnU</option></select></label><div class="al-actions"><button class="al-btn" data-pneu-action="supply">AIR ON</button><button class="al-btn run" data-pneu-action="auto">▶ 자동 1사이클</button><button class="al-btn stop" data-pneu-action="stop">■ 정지</button><button class="al-btn" data-pneu-action="reset">↺ 고장 리셋</button></div></section>
      <section class="al-section"><h3>압력·스트로크</h3><div class="al-pressure"><div class="al-gauge"><b data-pneu-gauge="input">0.0</b><span>IN bar</span></div><div class="al-gauge"><b data-pneu-gauge="output">0.0</b><span>REG bar</span></div><div class="al-gauge"><b data-pneu-gauge="vacuum">0.0</b><span>VAC bar</span></div></div><div class="al-stroke" style="margin-top:7px"><i id="al-pneu-stroke"></i></div></section>
      <section class="al-section"><h3>밸브·유량 설정</h3><div class="al-fields"><label class="al-field">밸브<select id="al-pneu-valve"><option value="single">5/2 단솔</option><option value="double">5/2 복솔</option></select></label><label class="al-field">설정압 bar<input id="al-pneu-reg" type="number" min="0" max="8" step=".5" value="5"></label><label class="al-field">전진 유량<input id="al-pneu-throttle" type="number" min=".05" max="1" step=".05" value="1"></label></div><div class="al-checks" style="margin-top:6px"><label class="al-check"><input type="checkbox" data-pneu-coil="A">SOL A 전진</label><label class="al-check"><input type="checkbox" data-pneu-coil="B">SOL B 후진</label><label class="al-check"><input type="checkbox" id="al-pneu-vacuum">진공 흡착</label><label class="al-check"><input type="checkbox" id="al-pneu-part" checked>제품 감지</label></div></section>
      <section class="al-section"><h3>고장 삽입</h3><label class="al-field">T03 공급호스 누설 <span id="al-pneu-leak-label">0%</span><input id="al-pneu-leak" type="range" min="0" max="1" step=".05" value="0"></label><div class="al-grid4" style="margin-top:7px"><div class="al-indicator" data-pneu-sensor="retracted">RET</div><div class="al-indicator" data-pneu-sensor="extended">EXT</div><div class="al-indicator" data-pneu-sensor="vacuum">VAC</div><div class="al-indicator" data-pneu-sensor="fault">FAULT</div></div></section>
      <section class="al-section"><h3>선택 PLC 주소 이미지 <small>실제 PLC 전송 없음</small></h3><table class="al-memory" id="al-pneu-memory"></table></section>
      <section class="al-section"><h3>이벤트</h3><div class="al-log" id="al-pneu-log"></div><div class="al-asset-note">압축성·힘 해석이 아닌 교육용 기능 모델입니다. 실제 안전밸브·잔압배기·압력정격을 대신하지 않습니다.</div></section>
    </aside></div>`;
  }

  function discretePane() {
    return `<div class="al-pane-grid"><div class="al-scene" data-scene="discrete"><div class="al-scene-title"><b>24V 이산 I/O 결선 실습대</b><span>실제 결선 토폴로지 · 선택 PLC만 활성</span></div>${cameraPresetButtons()}${editorToolbar('discrete')}${cameraHintElement(' · 4=결선 · 2=장비 이동 · 연결선이 전기 판정에 반영됨')}</div><aside class="al-side">
      <section class="al-section"><div class="al-status" id="al-discrete-status"><b>기준 결선 필요</b><span>POWER OFF</span></div><label class="al-profile">PLC 제조사 선택<select id="al-discrete-profile" data-discrete-profile><option value="ls">LS XGB / XG5000</option><option value="mitsubishi">Mitsubishi QnU / MELSOFT</option></select></label><label class="al-profile">입력 공통 방식<select id="al-discrete-input-mode"><option value="sink">싱크 COM · PNP 입력</option><option value="source">소스 COM · NPN 입력</option></select></label><div class="al-actions"><button class="al-btn run" data-discrete-action="power">DC 24V ON</button><button class="al-btn" data-discrete-action="reference">기준 결선</button><button class="al-btn stop" data-discrete-action="outputs-off">출력 전체 OFF</button><button class="al-btn" data-discrete-action="clear">결선 지우기</button></div></section>
      <section class="al-section"><h3>현장 입력 11점 <small>버튼·센서·리미트</small></h3><div class="al-checks">${DISCRETE_INPUTS.map(([key, label]) => `<label class="al-check"><input type="checkbox" data-discrete-input="${key}"><span data-discrete-input-label="${key}">${esc(label)}</span></label>`).join('')}</div></section>
      <section class="al-section"><h3>선택 PLC 출력 13점 <small>다른 제조사 주소 거부</small></h3><div class="al-output-grid">${DISCRETE_OUTPUTS.map(([key, label]) => `<label class="al-output"><input type="checkbox" data-discrete-output="${key}"><span data-discrete-output-label="${key}">${esc(label)}</span></label>`).join('')}</div></section>
      <section class="al-section"><h3>타이머·카운터 <small>3D FND 런타임 오버레이</small></h3><div class="al-fields"><label class="al-field">타이머 설정 s<input id="al-discrete-timer-preset" type="number" min=".1" max="99.9" step=".1" value="3"></label><label class="al-field">카운터 설정<input id="al-discrete-counter-preset" type="number" min="1" max="999" step="1" value="5"></label><button class="al-btn" data-discrete-action="counter-reset">카운터 RESET</button></div><div class="al-counters" style="margin-top:6px"><div class="al-counter"><b id="al-discrete-timer-value">0.0</b><span>TIMER s</span></div><div class="al-counter"><b id="al-discrete-counter-value">0</b><span>COUNT</span></div><div class="al-counter"><b id="al-discrete-wire-count">0</b><span>WIRES</span></div></div></section>
      <section class="al-section"><h3>가상 멀티미터 <small>3D 적·흑 프로브</small></h3><label class="al-profile">측정 모드<select id="al-discrete-meter-mode"><option value="voltage">DC 전압</option><option value="continuity">연속성 · 전원 OFF</option></select></label><button class="al-btn" data-discrete-action="probe-reference" style="width:100%">프로브를 +24V / 24G에 시험 연결</button><div class="al-status" id="al-discrete-meter" style="margin-top:7px"><b>프로브 미연결</b><span>BLOCKED</span></div><div class="al-asset-note">프로브 TIP을 원하는 단자에 결선하면 실제 결선 그래프를 따라 측정합니다. 연속성 모드는 통전 중 자동 차단됩니다.</div></section>
      <section class="al-section"><h3>전기 토폴로지 진단</h3><div class="al-log" id="al-discrete-issues"></div><table class="al-memory" id="al-discrete-memory"></table><div class="al-asset-note">SoV 3D 외형은 교육용입니다. 화면의 Mitsubishi 모듈 외형을 LS 장비로 오인하지 않도록, 선택 제조사 주소표와 세션만 바뀝니다. 정확한 검토 통과는 별도 매뉴얼 기반 장비 프로필이 필요합니다.</div></section>
    </aside></div>`;
  }

  function equipmentPane() {
    return `<div class="al-pane-grid"><div class="al-scene" data-scene="equipment3d"><div class="al-scene-title"><b>3D 장비 검사실</b><span>SELECTIVE ASSETS · LAZY LOAD</span></div>${cameraPresetButtons()}${cameraHintElement(' · 장비는 한 번에 1개만 표시')}</div><aside class="al-side">
      <section class="al-section"><div class="al-status" id="al-equipment-status"><b>장비 목록 준비</b><span>LOCAL</span></div><select class="al-equipment-select" id="al-equipment-select" size="14" aria-label="3D 장비 선택"><option>자산 매니페스트 읽는 중…</option></select><dl class="al-equipment-meta"><dt>모델</dt><dd id="al-equipment-root">—</dd><dt>메시</dt><dd id="al-equipment-mesh">—</dd><dt>파일</dt><dd id="al-equipment-file">—</dd><dt>검토 등급</dt><dd>교육용 3D 외형</dd></dl><div class="al-asset-note">이 화면은 실제 3D 외형을 관찰하는 교육용 자산 검사실입니다. 단자 ID·전기 정격·검토 통과 근거는 제조사 매뉴얼 기반 프로필과 SVG 오버레이만 사용합니다.</div></section>
    </aside></div>`;
  }

  function injectUi() {
    A.host = q('#mv-palletizer');
    const oldRoot = q('#p3-root', A.host);
    if (!A.host || !oldRoot) return false;
    A.host.innerHTML = '';
    A.hub = document.createElement('div');
    A.hub.id = 'al-hub';
    A.hub.innerHTML = `<nav id="al-tabs"><b>🏭 자동화 실습실</b>${[
      ['palletizer3d', '3축 팔레타이징'], ['servo2', '2축 서보'], ['mps', 'MPS 제어'], ['pneumatic', '공압 제어'], ['discrete', '24V I/O 결선'], ['equipment3d', '3D 장비']
    ].map(([key, label]) => `<button class="al-tab" data-lab="${key}">${label}</button>`).join('')}<label class="al-camera-navigation"><span>카메라</span><select id="al-camera-navigation" aria-label="3D 카메라 조작 방식"><option value="3ds-max">3ds Max</option><option value="legacy">기존 조작</option></select></label><small>OFFLINE</small></nav><div id="al-content"></div>`;
    A.host.appendChild(A.hub);
    A.content = q('#al-content', A.hub);
    const p3Pane = document.createElement('section'); p3Pane.className = 'al-pane'; p3Pane.dataset.labPane = 'palletizer3d'; p3Pane.appendChild(oldRoot); A.content.appendChild(p3Pane);
    for (const [key, html] of [['servo2', servoPane()], ['mps', mpsPane()], ['pneumatic', pneumaticPane()], ['discrete', discretePane()], ['equipment3d', equipmentPane()]]) {
      const pane = document.createElement('section'); pane.className = 'al-pane'; pane.dataset.labPane = key; pane.innerHTML = html; A.content.appendChild(pane);
    }
    qa('.al-tab', A.hub).forEach(button => button.onclick = () => setLab(button.dataset.lab));
    return true;
  }

  function material(color, metalness = .3, roughness = .6, extra = {}) { return new Three.MeshStandardMaterial({ color, metalness, roughness, ...extra }); }
  function box(parent, size, position, mat, name) {
    const mesh = new Three.Mesh(new Three.BoxGeometry(...size), mat); mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; if (name) mesh.name = name; parent.add(mesh); return mesh;
  }
  function cylinder(parent, radius, length, position, mat, axis = 'y') {
    const mesh = new Three.Mesh(new Three.CylinderGeometry(radius, radius, length, 20), mat); mesh.position.set(...position); if (axis === 'x') mesh.rotation.z = Math.PI / 2; if (axis === 'z') mesh.rotation.x = Math.PI / 2; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function led(parent, position, color = 0x35f287) {
    const mat = material(0x203039, .05, .4, { emissive: 0x000000 }); const mesh = new Three.Mesh(new Three.SphereGeometry(.09, 14, 10), mat); mesh.position.set(...position); mesh.userData.onColor = color; parent.add(mesh); return mesh;
  }
  function setLed(mesh, on, color) { if (!mesh) return; const value = color || mesh.userData.onColor || 0x35f287; mesh.material.color.setHex(on ? value : 0x203039); mesh.material.emissive.setHex(on ? value : 0x000000); mesh.material.emissiveIntensity = on ? 1.5 : 0; }
  function setImportedLamp(node, on, color = 0x35f287) {
    node?.traverse?.(object => {
      if (!object.isMesh || !object.material) return;
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        if (mat.emissive?.setHex) mat.emissive.setHex(on ? color : 0x000000);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = on ? 2.2 : 0;
        mat.needsUpdate = true;
      }
    });
  }

  function baseScene(name) {
    const preset = CAMERA_PRESETS.default;
    const scene = new Three.Scene(); scene.background = new Three.Color(0x3a4757);
    const camera = new Three.OrthographicCamera(-3.5, 3.5, 3.5, -3.5, .01, 100);
    scene.add(new Three.HemisphereLight(0xc6ebff, 0x26342c, 1.35));
    const sun = new Three.DirectionalLight(0xffffff, 1.35); sun.position.set(-5, 10, 7); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
    const root = new Three.Group(); root.name = `${name}-lab`; scene.add(root);
    const proxyRoot = new Three.Group(); proxyRoot.name = `${name}-functional-proxy`; root.add(proxyRoot);
    const dynamicRoot = new Three.Group(); dynamicRoot.name = `${name}-dynamic`; root.add(dynamicRoot);
    return { scene, camera, root, proxyRoot, dynamicRoot, parts: {}, orbit: { yaw: preset.yaw, pitch: preset.pitch, scale: preset.scale }, target: new Three.Vector3(...preset.focus), aspect: 1 };
  }

  function createServoScene() {
    const data = baseScene('servo2'), root = data.proxyRoot;
    const frame = material(0x77848b, .72, .3), rail = material(0xc5d0d6, .85, .18), blue = material(0x1b75a7, .4, .35), dark = material(0x1a252c, .5, .45);
    box(root, [10, .32, 6.2], [0, .3, 0], dark); for (const x of [-4.6, 4.6]) for (const z of [-2.6, 2.6]) box(root, [.25, 1.1, .25], [x, -.25, z], frame);
    box(root, [8.8, .22, .4], [0, 1.03, 1.2], frame); box(root, [8.5, .1, .2], [0, 1.2, 1.2], rail);
    const xCarriage = new Three.Group(); root.add(xCarriage); box(xCarriage, [.72, .5, .72], [0, 1.25, 1.2], blue); box(xCarriage, [.34, .22, 5.1], [0, 1.08, -1.05], frame); box(xCarriage, [.16, .12, 4.7], [0, 1.23, -1.05], rail);
    const yCarriage = new Three.Group(); xCarriage.add(yCarriage); box(yCarriage, [.72, .42, .72], [0, 1.3, 0], blue); box(yCarriage, [.34, 1.3, .34], [0, .48, 0], dark);
    const marker = cylinder(yCarriage, .23, .08, [0, -.2, 0], material(0xffbd31, .25, .5), 'y');
    data.parts.xCarriage = xCarriage; data.parts.yCarriage = yCarriage; data.parts.marker = marker;
    data.parts.leds = { X0: led(root, [-4.1, 1.2, .85]), X1: led(root, [4.1, 1.2, .85], 0xff5348), Y0: led(xCarriage, [.4, 1.25, 1.1]), Y1: led(xCarriage, [.4, 1.25, -3.15], 0xff5348) };
    for (const x of [-4.2, -3.55]) { box(root, [.5, 1.45, 1.05], [x, 1.08, -2.05], material(0x31434f, .45, .35)); led(root, [x, 1.55, -1.49]); }
    return data;
  }

  function createMpsScene() {
    const data = baseScene('mps'), root = data.proxyRoot;
    const frame = material(0x66767f, .68, .34), belt = material(0x172129, .2, .75), blue = material(0x2c7197, .35, .45);
    box(root, [10.2, .28, 3.7], [0, .3, 0], material(0x1a252c, .5, .5));
    box(root, [8.8, .24, 1.45], [0, 1.2, 0], frame); box(root, [8.4, .1, 1.13], [0, 1.39, 0], belt);
    for (const x of [-4.15, -2, 0, 2, 4.15]) cylinder(root, .15, 1.05, [x, 1.42, 0], frame, 'z');
    for (const x of [-4.1, 4.1]) for (const z of [-.55, .55]) box(root, [.2, 1.6, .2], [x, .3, z], frame);
    data.parts.workpieces = new Three.Group(); data.dynamicRoot.add(data.parts.workpieces); data.parts.workpieceModels = new Map();
    data.parts.stopper = box(root, [.16, .75, .9], [-.15, 1.78, 0], material(0xe3b542, .25, .45));
    data.parts.pusher = box(root, [.95, .35, .45], [-.15, 1.58, -1.05], blue); data.parts.pusherHome = data.parts.pusher.position.z;
    data.parts.picker = box(root, [.75, .7, .75], [.65, 2.35, 0], material(0x7a8b95, .5, .35));
    data.parts.leds = {};
    const sensorX = { entrance: -3.45, position: -.32, metal: -.12, exit: 3.42 };
    for (const [key, x] of Object.entries(sensorX)) { box(root, [.18, .38, .36], [x, 1.68, .78], material(0x222b31, .45, .42)); data.parts.leds[key] = led(root, [x, 1.93, .78], key === 'metal' ? 0xffc83d : 0x43ef88); }
    return data;
  }

  function createPneumaticScene() {
    const data = baseScene('pneumatic'), root = data.proxyRoot;
    box(root, [10.5, .3, 6], [0, .3, 0], material(0x1a252c, .5, .5));
    const panel = box(root, [9.4, 3.6, .22], [0, 2.5, 2.15], material(0x52626c, .55, .5)); panel.receiveShadow = true;
    const service = new Three.Group(); service.position.set(-3.6, 2.55, 1.85); root.add(service); cylinder(service, .45, 1.3, [0, 0, 0], material(0xa9bdc8, .5, .35)); cylinder(service, .28, .6, [0, -.8, 0], material(0x4c8ba6, .25, .45)); data.parts.service = service;
    const valve = new Three.Group(); valve.position.set(-.7, 2.55, 1.85); root.add(valve); box(valve, [1.55, .72, .55], [0, 0, 0], material(0x303b43, .55, .38)); box(valve, [.38, .56, .6], [-.96, 0, 0], material(0x296e9a, .35, .4)); box(valve, [.38, .56, .6], [.96, 0, 0], material(0x296e9a, .35, .4)); data.parts.valve = valve; data.parts.coilLeds = [led(valve, [-.96, .4, 0]), led(valve, [.96, .4, 0])];
    const cyl = new Three.Group(); cyl.position.set(2.65, 2.55, 1.85); root.add(cyl); cylinder(cyl, .48, 2.1, [0, 0, 0], material(0xc0cbd0, .78, .22), 'x'); box(cyl, [.18, 1.18, .75], [-1.08, 0, 0], material(0x586871, .65, .32)); data.parts.rod = cylinder(cyl, .15, 1.8, [1.85, 0, 0], material(0xd9e2e6, .9, .15), 'x'); data.parts.rodBaseX = .95; data.parts.cylinder = cyl;
    data.parts.tubes = [];
    for (const spec of [[-3, 2.6, -.9, 2.6, 0x3faee1], [.15, 2.7, 1.55, 2.72, 0x3faee1], [.15, 2.38, 1.55, 2.38, 0xf0b73c]]) {
      const [x1, y1, x2, y2, color] = spec, length = Math.hypot(x2 - x1, y2 - y1); const mesh = cylinder(root, .055, length, [(x1 + x2) / 2, (y1 + y2) / 2, 1.55], material(color, .08, .5, { transparent: true, opacity: .82 }), 'x'); mesh.rotation.z = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2; data.parts.tubes.push(mesh);
    }
    data.parts.gauge = led(root, [-3.6, 3.35, 1.45], 0x4ad7ff); data.parts.vacuum = led(root, [3.9, 1.25, .3], 0x7bf2c3);
    data.parts.importedValves = { single: null, double: null };
    data.parts.proxyEquipment = [service, valve, cyl];
    return data;
  }

  function createFndOverlay(label, color = '#ff4d35') {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
    const texture = new Three.CanvasTexture(canvas); texture.minFilter = Three.LinearFilter;
    const sprite = new Three.Sprite(new Three.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(.46, .17, 1); sprite.renderOrder = 15;
    sprite.userData.fnd = { canvas, texture, label, color, value: null };
    return sprite;
  }

  function updateFndOverlay(sprite, value) {
    const fnd = sprite?.userData?.fnd; if (!fnd || fnd.value === String(value)) return;
    fnd.value = String(value); const context = fnd.canvas.getContext('2d');
    context.clearRect(0, 0, fnd.canvas.width, fnd.canvas.height); context.fillStyle = 'rgba(10,15,18,.92)'; context.fillRect(0, 0, 256, 96);
    context.strokeStyle = '#40505a'; context.lineWidth = 4; context.strokeRect(2, 2, 252, 92);
    context.fillStyle = '#91a5b1'; context.font = '16px Consolas'; context.fillText(fnd.label, 12, 22);
    context.fillStyle = fnd.color; context.font = 'bold 52px Consolas'; context.textAlign = 'right'; context.fillText(fnd.value, 244, 75);
    fnd.texture.needsUpdate = true;
  }

  function createDiscreteScene() {
    const data = baseScene('discrete'), root = data.proxyRoot;
    data.orbit = { yaw: 18, pitch: 32, scale: .88 }; data.target.set(0, .86, 0);
    box(root, [10.8, .22, 6.3], [0, .18, 0], material(0x202a31, .55, .62));
    box(root, [10.2, .10, 5.7], [0, .34, 0], material(0x8f9aa0, .55, .55));
    for (const z of [-1.85, 0, 1.85]) box(root, [9.7, .08, .10], [0, .42, z], material(0xbec9ce, .82, .22));
    data.parts.fnd = {};
    data.parts.imported = {};
    return data;
  }

  function createEquipmentScene() {
    const data = baseScene('equipment3d');
    data.proxyRoot.visible = false;
    data.orbit = { yaw: 25, pitch: 18, scale: 1.05 };
    data.target.set(0, .34, 0);
    const pedestal = box(data.root, [1.15, .035, .78], [0, -.035, 0], material(0x233541, .25, .82));
    pedestal.receiveShadow = true;
    data.parts.modelRoot = new Three.Group();
    data.parts.modelRoot.name = 'equipment3d-selected-model';
    data.root.add(data.parts.modelRoot);
    return data;
  }

  function createEditors() {
    const engine = window.PLCTrainerSovEditorEngine;
    if (!engine?.create) return;
    A.editorMarkers = { servo2: [], mps: [], pneumatic: [], discrete: [] };
    A.editorModules = { servo2: new Map(), mps: new Map(), pneumatic: new Map(), discrete: new Map() };
    for (const lab of ['servo2', 'mps', 'pneumatic', 'discrete']) {
      const editor = engine.create({ three: Three, lab, scene: A.scenes[lab].scene, gridSize: .025, tubeRadius: .003 });
      editor.on('change', () => { if (lab === 'discrete') syncDiscreteTopology(); schedule(); persist(); });
      editor.on('modechange', () => { updateEditorUi(); schedule(); persist(); });
      A.editors[lab] = editor;
    }
  }

  function registerEditorModule(lab, id, object, anchorSpecs, movable = false) {
    const editor = A.editors[lab];
    if (!editor || editor.modules.has(id) || !object) return;
    const markerGeometry = new Three.SphereGeometry(.006, 8, 6);
    const anchors = anchorSpecs.map((spec, index) => {
      const marker = new Three.Mesh(markerGeometry, new Three.MeshBasicMaterial({ color: spec.kind === 'air' ? 0xff5252 : 0x4fc7ff, transparent: true, opacity: .92, depthTest: false }));
      marker.name = `${id}-${spec.tag || index}`; marker.position.fromArray(spec.position); marker.visible = false; marker.renderOrder = 20;
      marker.userData.sovAnchor = { moduleId: id, anchorId: spec.id || String(index), kind: spec.kind };
      object.add(marker); A.editorMarkers[lab].push(marker);
      return { id: spec.id || String(index), kind: spec.kind, object: marker, localPosition: [0, 0, 0], tag: spec.tag || spec.id || String(index) };
    });
    object.traverse?.(child => { if (child.isMesh && !child.userData.sovAnchor) child.userData.sovEditorModuleId = id; });
    editor.registerModule({ id, lab, object, movable, removeObjectOnDelete: movable, anchors });
    A.editorModules[lab].set(id, object); updateEditorUi();
    const saved = A.state?.editor?.[lab];
    if (saved) { try { editor.importState(saved, { strict: false }); } catch (_) { /* retry as later modules register */ } }
  }

  function rowAnchors(prefix, count, y, z, startX, endX, kind = 'electric') {
    return Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, tag: `${prefix}${index}`, kind, position: [startX + (endX - startX) * (count === 1 ? 0 : index / (count - 1)), y, z] }));
  }

  function syncDiscreteTopology() {
    const editor = A.editors.discrete, state = A.state?.labs?.discrete;
    if (!editor || !state) return null;
    Discrete.setConnections(state, editor.serialize().connections);
    return Discrete.evaluateTopology(state);
  }

  function applyDiscreteConnections(connections) {
    const editor = A.editors.discrete; if (!editor) return false;
    editor.cancel('replace-topology'); editor.clearConnections({ emit: false });
    try {
      for (const item of connections || []) editor.connect(item.from, item.to, { id: item.id, enforceMode: false, emit: false });
      editor.updateConnections(); syncDiscreteTopology(); updateEditorUi(); schedule(); persist(true); return true;
    } catch (error) {
      editor.clearConnections({ emit: false }); syncDiscreteTopology();
      console.warn('Discrete reference wiring could not be applied', error); return false;
    }
  }

  function applyProbeReferenceConnections() {
    const editor = A.editors.discrete;
    if (!editor || !['probe-red', 'probe-black', 'power'].every(id => editor.modules.has(id))) return false;
    const connections = editor.serialize().connections.filter(connection =>
      !['probe-red', 'probe-black'].includes(connection.from.moduleId)
      && !['probe-red', 'probe-black'].includes(connection.to.moduleId)
    );
    connections.push(
      { id: 'meter-probe-red', kind: 'electric', from: { moduleId: 'probe-red', anchorId: 'TIP' }, to: { moduleId: 'power', anchorId: 'P24-19' } },
      { id: 'meter-probe-black', kind: 'electric', from: { moduleId: 'probe-black', anchorId: 'TIP' }, to: { moduleId: 'power', anchorId: 'N24-19' } }
    );
    return applyDiscreteConnections(connections);
  }

  function installEditorControls() {
    const canvas = A.renderer.domElement, raycaster = new Three.Raycaster(), pointer = new Three.Vector2(); raycaster.params.Line.threshold = .012;
    const rayFromEvent = event => {
      const scene = A.scenes[A.activeLab], rect = canvas.getBoundingClientRect();
      if (!scene || !rect.width || !rect.height) return null;
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, scene.camera); return raycaster.ray;
    };
    const activeEditor = () => A.editors[A.activeLab];
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || A.activeLab === 'palletizer3d') return;
      const editor = activeEditor(), ray = rayFromEvent(event); if (!editor || !ray) return;
      if (editor.mode === 'WIRE' || editor.mode === 'AIR') {
        const hits = raycaster.intersectObjects(A.editorMarkers[A.activeLab].filter(marker => marker.visible), false), ref = hits[0]?.object?.userData?.sovAnchor;
        if (!ref) return;
        event.preventDefault(); if (editor.pendingConnection) editor.completeConnection(ref); else editor.beginConnection(ref); schedule(); updateEditorUi(); persist(); return;
      }
      if (editor.mode === 'DELETE_WIRE') {
        const visuals = [...editor.connections.values()].map(connection => connection.visual), hit = raycaster.intersectObjects(visuals, true)[0];
        if (hit?.object?.userData?.connectionId) { event.preventDefault(); editor.deleteLink(hit.object.userData.connectionId); schedule(); persist(true); } return;
      }
      if (editor.mode === 'MOVE' || editor.mode === 'DELETE_MODULE') {
        const objects = [...A.editorModules[A.activeLab].values()], hit = raycaster.intersectObjects(objects, true)[0]; let picked = hit?.object;
        while (picked && !picked.userData?.sovEditorModuleId) picked = picked.parent;
        const moduleId = picked?.userData?.sovEditorModuleId; if (!moduleId) return;
        event.preventDefault();
        if (editor.mode === 'DELETE_MODULE') { editor.deleteModule(moduleId); A.editorModules[A.activeLab].delete(moduleId); updateEditorUi(); schedule(); persist(true); return; }
        if (editor.beginMove(moduleId, ray, { grid: .025 })) { A.editorDrag = { editor, pointerId: event.pointerId }; canvas.setPointerCapture?.(event.pointerId); }
      }
    });
    canvas.addEventListener('pointermove', event => {
      const editor = activeEditor(), ray = rayFromEvent(event); if (!editor || !ray) return;
      if (A.editorDrag?.editor === editor) { editor.updateMove(ray); schedule(); return; }
      if (editor.pendingConnection) { const plane = new Three.Plane(new Three.Vector3(0, 1, 0), -.9), hit = ray.intersectPlane(plane, new Three.Vector3()); if (hit) { editor.updateConnectionPreview(hit); schedule(); } }
    });
    const endMove = event => { if (!A.editorDrag || (event.pointerId != null && event.pointerId !== A.editorDrag.pointerId)) return; A.editorDrag.editor.endMove(); A.editorDrag = null; schedule(); persist(true); };
    canvas.addEventListener('pointerup', endMove); canvas.addEventListener('pointercancel', endMove); canvas.addEventListener('lostpointercapture', endMove);
  }

  function updateEditorUi() {
    for (const lab of ['servo2', 'mps', 'pneumatic', 'discrete']) {
      const editor = A.editors[lab]; if (!editor) continue;
      qa(`[data-editor-tools="${lab}"] [data-editor-mode]`, A.hub).forEach(button => button.classList.toggle('active', button.dataset.editorMode === editor.mode));
      for (const marker of A.editorMarkers[lab] || []) marker.visible = (editor.mode === 'WIRE' && marker.userData.sovAnchor.kind === 'electric') || (editor.mode === 'AIR' && marker.userData.sovAnchor.kind === 'air');
      editor.connectionRoot.visible = editor.mode !== 'CONTROL';
    }
  }

  function createRenderer() {
    if (!Three) return false;
    A.renderer = new Three.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    A.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6)); A.renderer.shadowMap.enabled = true; A.renderer.shadowMap.type = Three.PCFSoftShadowMap; A.renderer.outputEncoding = Three.sRGBEncoding;
    A.renderer.domElement.tabIndex = 0; installCameraControls();
    A.scenes.servo2 = createServoScene(); A.scenes.mps = createMpsScene(); A.scenes.pneumatic = createPneumaticScene(); A.scenes.discrete = createDiscreteScene(); A.scenes.equipment3d = createEquipmentScene();
    createEditors(); installEditorControls();
    loadImportedAssets();
    return true;
  }

  function findImportedNode(model, pattern) {
    let found = null;
    model?.traverse?.(object => { if (!found && pattern.test(object.name || '')) found = object; });
    return found;
  }

  function bindMpsImportedPlant(model) {
    const byId = id => findImportedNode(model, new RegExp(`__go${id}$`));
    const bind = (id, axis, start, end) => {
      const node = byId(id);
      return node ? { node, axis, start, end, basePosition: node.position.clone(), baseRotation: node.rotation.clone() } : null;
    };
    const plant = {
      supply: bind(2149, 'z', -.0394, -.1063),
      drill: bind(1733, 'z', .232, .2018),
      distribution: bind(2147, 'z', -.1492002, -.2666),
      emission: bind(2041, 'z', -.011, .0553),
      stopper: bind(1657, 'y', .1475, .1254),
      liftPneumatic: bind(2045, 'z', .1015, .19942),
      unloading: bind(2100, 'x', -.035, -.0803),
      liftServo: bind(1189, 'y', .1188, .3348),
      drillRotor: bind(1539, null, 0, 0),
      belt: byId(1560),
      drillAngle: 0,
      lastElapsed: 0,
      lamps: [2033, 2035, 2036, 2031, 2024, 2023, 2032, 2029, 2025, 2026, 2022, 2030, 2069, 214, 1167, 220].map(byId),
      beltMaps: []
    };
    for (const node of plant.lamps) node?.traverse?.(object => {
      if (!object.isMesh || !object.material) return;
      object.material = Array.isArray(object.material) ? object.material.map(mat => mat.clone()) : object.material.clone();
    });
    plant.belt?.traverse?.(object => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material.map(mat => mat.clone()) : [object.material.clone()];
      object.material = Array.isArray(object.material) ? materials : materials[0];
      for (const mat of materials) if (mat.map) { mat.map = mat.map.clone(); mat.map.wrapS = Three.RepeatWrapping; mat.map.needsUpdate = true; plant.beltMaps.push(mat.map); }
    });
    return plant;
  }

  async function addImported(lab, filename, targetSize, position, rotation = [0, 0, 0], opacity = 1, onLoaded = null, options = {}) {
    try {
      const loader = window.PLCTrainerImportedModels;
      if (!loader || A.scenes[lab]?.parts?.[`asset-${filename}`]) return;
      const model = await loader.loadModel(filename, { name: filename });
      const wrapper = new Three.Group(); model.rotation.set(...rotation); wrapper.add(model); model.updateMatrixWorld(true);
      let bounds = new Three.Box3().setFromObject(model), scale = 1, center = new Three.Vector3();
      if (!options.authoredCoordinates) {
        const size = new Three.Vector3(); bounds.getSize(size); const max = Math.max(size.x, size.y, size.z) || 1; scale = targetSize / max; model.scale.multiplyScalar(scale); model.updateMatrixWorld(true);
        bounds = new Three.Box3().setFromObject(model); bounds.getCenter(center); model.position.sub(center);
      }
      wrapper.position.set(...position);
      model.traverse?.(object => { if (!object.isMesh) return; object.castShadow = true; object.receiveShadow = true; if (opacity < 1 && object.material) { for (const mat of Array.isArray(object.material) ? object.material : [object.material]) { mat.transparent = true; mat.opacity = opacity; mat.depthWrite = opacity > .6; } } });
      A.scenes[lab].root.add(wrapper); A.scenes[lab].parts[`asset-${filename}`] = wrapper; schedule();
      onLoaded?.({ wrapper, model, scale, center });
      return wrapper;
    } catch (error) { console.warn(`Imported model ${filename} could not be loaded`, error); }
  }

  async function loadWorkpieceTemplates() {
    try {
      const loader = window.PLCTrainerImportedModels, parts = A.scenes.mps.parts;
      const [compactSteel, compactPlastic, blockSteel, blockPlastic] = await Promise.all([
        loader.loadModel('workpiece-steel.glb'), loader.loadModel('workpiece-plastic.glb'),
        loader.loadModel('workblock-steel-blue.glb'), loader.loadModel('workblock-plastic-orange.glb')
      ]);
      parts.workpieceTemplates = {
        compact: { steel: compactSteel, plastic: compactPlastic },
        block: { steel: blockSteel, plastic: blockPlastic }
      };
      schedule();
    } catch (error) { console.warn('Imported workpieces could not be loaded', error); }
  }

  function equipmentGroup(filename) {
    return EQUIPMENT_GROUPS.find(([, , pattern]) => pattern.test(filename)) || ['other', '기타 장비', /.*/];
  }

  function updateEquipmentDetails(entry) {
    if (!entry || !A.hub) return;
    q('#al-equipment-root', A.hub).textContent = entry.root || '—';
    q('#al-equipment-mesh', A.hub).textContent = `${Number(entry.nodeCount || 0).toLocaleString()} nodes · ${Number(entry.triangleCount || 0).toLocaleString()} triangles`;
    q('#al-equipment-file', A.hub).textContent = `${entry.file} · ${(Number(entry.bytes || 0) / 1024).toFixed(1)} KiB`;
  }

  async function showEquipmentModel(filename) {
    const entry = A.equipmentCatalog.find(item => item.file === filename);
    const scene = A.scenes.equipment3d, statusBox = q('#al-equipment-status', A.hub);
    if (!entry || !scene || !statusBox || !window.PLCTrainerImportedModels) return;
    const token = ++A.equipmentLoadToken;
    q('b', statusBox).textContent = '3D 장비 불러오는 중'; q('span', statusBox).textContent = EQUIPMENT_LABELS[filename] || filename; statusBox.classList.remove('fault');
    try {
      const model = await window.PLCTrainerImportedModels.loadModel(filename, { name: `equipment-gallery:${filename}` });
      if (token !== A.equipmentLoadToken) return;
      const modelRoot = scene.parts.modelRoot;
      while (modelRoot.children.length) {
        const previous = modelRoot.children[0]; modelRoot.remove(previous);
        previous?.traverse?.(object => {
          if (!object.isMesh || !object.material) return;
          for (const mat of Array.isArray(object.material) ? object.material : [object.material]) mat.dispose?.();
        });
      }
      model.rotation.set(0, 0, 0); model.scale.setScalar(1); model.position.set(0, 0, 0); model.updateMatrixWorld(true);
      let bounds = new Three.Box3().setFromObject(model), size = new Three.Vector3(); bounds.getSize(size);
      const maxDimension = Math.max(size.x, size.y, size.z) || 1;
      model.scale.multiplyScalar(.76 / maxDimension); model.updateMatrixWorld(true);
      bounds = new Three.Box3().setFromObject(model); const center = new Three.Vector3(); bounds.getCenter(center); bounds.getSize(size);
      model.position.set(-center.x, -bounds.min.y, -center.z); model.updateMatrixWorld(true);
      modelRoot.add(model);
      scene.parts.selectedModel = model;
      scene.parts.selectedEntry = entry;
      scene.target.set(0, Math.max(.18, size.y / 2), 0);
      scene.orbit.scale = Math.max(.9, Math.max(size.x, size.y, size.z) * 1.24);
      updateCamera(scene); updateEquipmentDetails(entry);
      A.state.equipment.selected = filename;
      const select = q('#al-equipment-select', A.hub); if (select) select.value = filename;
      q('b', statusBox).textContent = EQUIPMENT_LABELS[filename] || filename; q('span', statusBox).textContent = '교육용 3D 외형';
      schedule(); persist(true);
    } catch (error) {
      if (token !== A.equipmentLoadToken) return;
      statusBox.classList.add('fault'); q('b', statusBox).textContent = '3D 장비 로드 실패'; q('span', statusBox).textContent = filename;
      console.warn(`Equipment gallery model ${filename} could not be loaded`, error);
    }
  }

  async function loadEquipmentCatalog() {
    try {
      const manifest = await window.PLCTrainerImportedModels.loadManifest();
      A.equipmentCatalog = Array.isArray(manifest.models) ? manifest.models.filter(item => typeof item?.file === 'string') : [];
      const select = q('#al-equipment-select', A.hub), statusBox = q('#al-equipment-status', A.hub);
      if (!select || !statusBox || !A.equipmentCatalog.length) throw new Error('선택 가능한 3D 장비가 없습니다.');
      select.replaceChildren();
      for (const [groupId, groupLabel] of EQUIPMENT_GROUPS) {
        const entries = A.equipmentCatalog.filter(item => equipmentGroup(item.file)[0] === groupId);
        if (!entries.length) continue;
        const group = document.createElement('optgroup'); group.label = `${groupLabel} (${entries.length})`;
        for (const entry of entries) group.appendChild(new Option(EQUIPMENT_LABELS[entry.file] || entry.file.replace(/\.glb$/i, ''), entry.file));
        select.appendChild(group);
      }
      const selected = A.equipmentCatalog.some(item => item.file === A.state.equipment.selected)
        ? A.state.equipment.selected
        : A.equipmentCatalog[0].file;
      select.value = selected;
      const equipmentTab = q('[data-lab="equipment3d"]', A.hub);
      if (equipmentTab) equipmentTab.textContent = `3D 장비 ${A.equipmentCatalog.length}종`;
      q('b', statusBox).textContent = `3D 장비 ${A.equipmentCatalog.length}종 준비`; q('span', statusBox).textContent = '선택 로드';
      updateEquipmentDetails(A.equipmentCatalog.find(item => item.file === selected));
      if (A.activeLab === 'equipment3d') await showEquipmentModel(selected);
    } catch (error) {
      const statusBox = q('#al-equipment-status', A.hub);
      if (statusBox) { statusBox.classList.add('fault'); q('b', statusBox).textContent = '3D 자산 목록 실패'; q('span', statusBox).textContent = String(error?.message || error); }
      console.warn('Equipment gallery manifest could not be loaded', error);
    }
  }

  async function loadDiscreteAssets() {
    const electric = (id, position, tag = id) => ({ id, tag, kind: 'electric', position });
    const sensorAnchors = [electric('P24', [-.16, .16, .08]), electric('N24', [0, .16, .08]), electric('OUT', [.16, .16, .08])];
    const sensorSpecs = [
      ['photo-npn', 'photo-sensor-npn.glb', [-3.7, .88, -.15]], ['photo-pnp', 'photo-sensor-pnp.glb', [-2.7, .88, -.15]],
      ['inductive-npn', 'inductive-sensor-npn.glb', [-1.7, .88, -.15]], ['inductive-pnp', 'inductive-sensor-pnp.glb', [-.7, .88, -.15]],
      ['capacitive-npn', 'capacitive-sensor-npn.glb', [.3, .88, -.15]], ['capacitive-pnp', 'capacitive-sensor-pnp.glb', [1.3, .88, -.15]]
    ];
    const parts = A.scenes.discrete.parts, tasks = [];
    const add = (id, filename, size, position, anchors, onLoaded = null) => {
      tasks.push(addImported('discrete', filename, size, position, [0, 0, 0], 1, payload => {
        parts.imported[id] = payload; registerEditorModule('discrete', id, payload.wrapper, anchors, true); onLoaded?.(payload);
      }));
    };

    add('source', 'smps.glb', 1.35, [-4.15, .92, 1.65], [electric('P24', [-.18, .22, .15]), electric('N24', [.18, .22, .15])]);
    const power = new Three.Group(); power.name = '24V-distribution-terminal'; power.position.set(0, .55, .72); A.scenes.discrete.root.add(power);
    box(power, [8.15, .08, .38], [0, 0, 0], material(0x303b42, .5, .45));
    for (let index = 0; index < 20; index += 1) {
      const x = -3.8 + 7.6 * index / 19;
      cylinder(power, .045, .025, [x, .07, -.09], material(0xc78c2b, .7, .28), 'y');
      cylinder(power, .045, .025, [x, .07, .09], material(0x365f9b, .7, .28), 'y');
    }
    registerEditorModule('discrete', 'power', power, [
      ...rowAnchors('P24-', 20, .10, -.09, -3.8, 3.8), ...rowAnchors('N24-', 20, .10, .09, -3.8, 3.8)
    ], true);
    add('plc', 'mitsubishi-q-plc-module.glb', 1.65, [-2.25, 1.03, 1.65], [
      electric('P24', [-.68, .38, .16]), electric('N24', [-.52, .38, .16]), electric('COM', [-.36, .38, .16]),
      ...rowAnchors('I', 11, .20, .16, -.68, .68), ...rowAnchors('O', 13, .02, .16, -.68, .68)
    ]);
    add('switch', 'switch-box.glb', 1.25, [.05, .93, 1.65], [
      electric('S1-IN', [-.48, .18, .14]), electric('S1-OUT', [-.32, .18, .14]),
      electric('S2-IN', [-.08, .18, .14]), electric('S2-OUT', [.08, .18, .14]),
      electric('S3-IN', [.32, .18, .14]), electric('S3-OUT', [.48, .18, .14])
    ]);
    add('relay', 'relay-module.glb', 1.25, [1.65, .93, 1.65], [
      electric('RY1+', [-.42, .19, .14]), electric('RY1-', [-.28, .19, .14]), electric('RY2+', [-.07, .19, .14]),
      electric('RY2-', [.07, .19, .14]), electric('RY3+', [.28, .19, .14]), electric('RY3-', [.42, .19, .14])
    ]);
    add('timer', 'timer-box.glb', 1.2, [3.05, .92, 1.65], [
      electric('P24', [-.38, .17, .14]), electric('N24', [-.13, .17, .14]), electric('IN', [.13, .17, .14]), electric('DONE', [.38, .17, .14])
    ], ({ wrapper }) => { const overlay = createFndOverlay('TIMER'); overlay.position.set(0, .53, .03); wrapper.add(overlay); parts.fnd.timer = overlay; });
    add('counter', 'counter-box.glb', 1.2, [4.25, .92, 1.65], [
      electric('P24', [-.45, .17, .14]), electric('N24', [-.23, .17, .14]), electric('PULSE', [0, .17, .14]), electric('RESET', [.23, .17, .14]), electric('DONE', [.45, .17, .14])
    ], ({ wrapper }) => { const overlay = createFndOverlay('COUNT', '#ff9e43'); overlay.position.set(0, .53, .03); wrapper.add(overlay); parts.fnd.counter = overlay; });
    add('counter-unit', 'counter-unit.glb', .82, [4.25, .91, .55], [electric('P24', [-.18, .15, .12]), electric('N24', [.18, .15, .12])], ({ wrapper }) => { const overlay = createFndOverlay('PV', '#ff9e43'); overlay.position.set(0, .4, .02); overlay.scale.multiplyScalar(.72); wrapper.add(overlay); parts.fnd.counterUnit = overlay; });

    for (const [id, filename, position] of sensorSpecs) add(id, filename, .82, position, sensorAnchors.map(item => ({ ...item, position: [...item.position] })));
    add('limit-left', 'limit-switch-left.glb', .8, [2.3, .88, -.15], [electric('COM', [-.28, .16, .1]), electric('NO', [0, .16, .1]), electric('NC', [.28, .16, .1])]);
    add('limit-right', 'limit-switch-right.glb', .8, [3.3, .88, -.15], [electric('COM', [-.28, .16, .1]), electric('NO', [0, .16, .1]), electric('NC', [.28, .16, .1])]);
    add('buzzer-lamp', 'buzzer-lamp.glb', 1.15, [-1.35, .9, -1.7], [
      electric('G+', [-.5, .18, .14]), electric('Y+', [-.3, .18, .14]), electric('R+', [-.1, .18, .14]), electric('W+', [.1, .18, .14]), electric('BZ+', [.3, .18, .14]), electric('COM', [.5, .18, .14])
    ]);
    add('tower', 'tower-lamp.glb', 1.45, [.55, 1.02, -1.7], [electric('G+', [-.32, .12, .12]), electric('Y+', [-.1, .12, .12]), electric('R+', [.12, .12, .12]), electric('COM', [.34, .12, .12])]);
    add('probe-black', 'banana-plug-black.glb', .48, [-3.25, .68, -1.68], [electric('TIP', [0, .1, .18])], ({ model }) => {
      const redModel = model.clone(true), redWrapper = new Three.Group();
      redModel.traverse?.(object => {
        if (!object.isMesh || !object.material) return;
        const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(source => {
          const next = source.clone(); next.color?.setHex?.(0xa3262b); next.needsUpdate = true; return next;
        });
        object.material = Array.isArray(object.material) ? materials : materials[0];
      });
      redWrapper.name = 'multimeter-probe-red'; redWrapper.position.set(-3.9, .68, -1.68); redWrapper.add(redModel);
      A.scenes.discrete.root.add(redWrapper); parts.imported['probe-red'] = { wrapper: redWrapper, model: redModel };
      registerEditorModule('discrete', 'probe-red', redWrapper, [electric('TIP', [0, .1, .18])], true);
    });
    add('ruler', 'ruler.glb', 1.5, [3.55, .64, -1.72], []);

    await Promise.all(tasks);
    const saved = A.state?.editor?.discrete;
    if (saved) { try { A.editors.discrete.importState(saved, { strict: false }); } catch (error) { console.warn('Discrete editor state could not be restored', error); } }
    syncDiscreteTopology(); updateDiscreteScene(); updateUi(true); schedule();
  }

  function loadImportedAssets() {
    if (A.importedLoaded) return;
    if (!window.PLCTrainerImportedModels) { window.addEventListener('plc-trainer-imported-models-ready', loadImportedAssets, { once: true }); return; }
    A.importedLoaded = true;
    void loadEquipmentCatalog();
    void loadDiscreteAssets();
    // The imported GLBs contain equipment only.  Their Unity root transform is
    // restored here so the original orthographic camera presets remain valid,
    // without packaging the classroom, desks, chairs or other scenery.
    addImported('servo2', 'servo2-workshop.glb', null, [0, .8, -.1548], [0, 0, 0], 1, ({ model, wrapper }) => {
      const parts = A.scenes.servo2.parts, axis1 = findImportedNode(model, /Axis1_Move__go608/i), axis2 = findImportedNode(model, /Axis2_Move__go1188/i);
      parts.importedAxes = { axis1, axis2, axis1Base: axis1?.position.clone(), axis2Base: axis2?.position.clone() };
      registerEditorModule('servo2', 'servo-motion-kit', wrapper, [
        ...rowAnchors('INPUT/', 26, .04, .286, -.25, .25),
        ...rowAnchors('OUTPUT/', 10, .072, .286, -.18, .18),
        ...rowAnchors('P24/', 2, .104, .286, -.05, -.025),
        ...rowAnchors('N24/', 2, .104, .286, .025, .05)
      ], false);
      A.scenes.servo2.proxyRoot.visible = false;
    }, { authoredCoordinates: true });
    addImported('mps', 'mps-complete-station.glb', null, [-.106, .79, -.102], [0, 0, 0], 1, ({ model }) => {
      A.scenes.mps.parts.importedPlant = bindMpsImportedPlant(model);
      const wrapper = model.parent;
      registerEditorModule('mps', 'mps-station', wrapper, [
        ...rowAnchors('INPUT/', 27, .045, .255, -.30, .30),
        ...rowAnchors('OUTPUT/', 18, .078, .255, -.25, .25),
        { id: 'P24', tag: 'P24', kind: 'electric', position: [-.025, .11, .255] },
        { id: 'N24', tag: 'N24', kind: 'electric', position: [.025, .11, .255] }
      ], false);
      A.scenes.mps.proxyRoot.visible = false;
    }, { authoredCoordinates: true });
    loadWorkpieceTemplates();

    // PneumaticWorld only contains an empty table and classroom scenery.  The
    // useful equipment is authored as prefabs, so load those pieces directly.
    A.scenes.pneumatic.proxyRoot.visible = false;
    addImported('pneumatic', 'service-unit.glb', null, [-.48, .84, .08], [0, 0, 0], 1, ({ wrapper }) => registerEditorModule('pneumatic', 'service-unit', wrapper, [{ id: 'OUT', tag: 'Out', kind: 'air', position: [.072, .125, 0] }], true), { authoredCoordinates: true });
    addImported('pneumatic', 'air-distributor.glb', null, [-.26, .84, .08], [0, 0, 0], 1, ({ wrapper }) => registerEditorModule('pneumatic', 'air-distributor', wrapper, [
      { id: 'IN', tag: 'IN/PP', kind: 'air', position: [-.05, .035, 0] },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `P${index + 1}`, tag: `OUT/P${index + 1}`, kind: 'air', position: [.05, .015 + (index % 2) * .025, -.035 + Math.floor(index / 2) * .023] }))
    ], true), { authoredCoordinates: true });
    addImported('pneumatic', 'valve-5-2-single.glb', null, [-.08, .84, .08], [0, 0, 0], 1, ({ wrapper }) => {
      A.scenes.pneumatic.parts.importedValves.single = wrapper;
      registerEditorModule('pneumatic', 'valve-single', wrapper, [
        { id: 'PP', tag: 'PP', kind: 'air', position: [0, .085, .033] }, { id: 'PA', tag: 'PA', kind: 'air', position: [-.04, .085, -.033] }, { id: 'PB', tag: 'PB', kind: 'air', position: [.04, .085, -.033] },
        { id: 'A-P24', tag: 'PA/P24', kind: 'electric', position: [-.073, .05, .02] }, { id: 'A-N24', tag: 'PA/N24', kind: 'electric', position: [-.073, .025, .02] }
      ], true);
      syncPneumaticValveVisual();
    }, { authoredCoordinates: true });
    addImported('pneumatic', 'valve-5-2-double.glb', null, [-.08, .84, .08], [0, 0, 0], 1, ({ wrapper }) => {
      A.scenes.pneumatic.parts.importedValves.double = wrapper;
      registerEditorModule('pneumatic', 'valve-double', wrapper, [
        { id: 'PP', tag: 'PP', kind: 'air', position: [0, .085, .033] }, { id: 'PA', tag: 'PA', kind: 'air', position: [-.04, .085, -.033] }, { id: 'PB', tag: 'PB', kind: 'air', position: [.04, .085, -.033] },
        { id: 'A-P24', tag: 'PA/P24', kind: 'electric', position: [-.073, .05, .02] }, { id: 'A-N24', tag: 'PA/N24', kind: 'electric', position: [-.073, .025, .02] },
        { id: 'B-P24', tag: 'PB/P24', kind: 'electric', position: [.073, .05, .02] }, { id: 'B-N24', tag: 'PB/N24', kind: 'electric', position: [.073, .025, .02] }
      ], true);
      syncPneumaticValveVisual();
    }, { authoredCoordinates: true });
    addImported('pneumatic', 'speed-controller.glb', null, [.12, .84, .08], [0, 0, 0], 1, ({ wrapper }) => registerEditorModule('pneumatic', 'speed-controller', wrapper, [{ id: 'IN', tag: 'IN', kind: 'air', position: [-.045, .04, 0] }, { id: 'OUT', tag: 'OUT', kind: 'air', position: [.045, .04, 0] }], true), { authoredCoordinates: true });
    addImported('pneumatic', 'double-acting-cylinder.glb', null, [.4, .84, .08], [0, 0, 0], 1, ({ model, wrapper }) => {
      const rod = findImportedNode(model, /(?:Rod|Piston|Shaft).*__go/i);
      A.scenes.pneumatic.parts.importedCylinder = { wrapper, rod, base: rod?.position.clone() };
      registerEditorModule('pneumatic', 'double-cylinder', wrapper, [{ id: 'PA', tag: 'PA', kind: 'air', position: [-.14, .045, .035] }, { id: 'PB', tag: 'PB', kind: 'air', position: [.085, .045, .035] }], true);
    }, { authoredCoordinates: true });
  }

  function installCameraControls() {
    const canvas = A.renderer.domElement;
    const raycaster = new Three.Raycaster(), pointer = new Three.Vector2();
    const cameraScene = () => A.activeLab === 'palletizer3d' ? null : A.scenes[A.activeLab];
    const pointerOnPlane = (event, scene, plane) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, scene.camera);
      return raycaster.ray.intersectPlane(plane, new Three.Vector3());
    };
    canvas.addEventListener('pointerdown', event => {
      const scene = cameraScene();
      const mode = scene ? CameraNavigation.resolvePointerAction(event, A.state.cameraNavigationPreset, { orbitButtons: [2], panButtons: [1] }) : null;
      if (!scene || !mode) return;
      event.preventDefault();
      if (mode === 'orbit') {
        A.drag = { mode: 'orbit', pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: scene.orbit.yaw, pitch: scene.orbit.pitch };
      } else {
        scene.camera.updateMatrixWorld(true);
        const forward = new Three.Vector3(); scene.camera.getWorldDirection(forward);
        const planePoint = scene.camera.position.clone().addScaledVector(forward, 20);
        const plane = new Three.Plane().setFromNormalAndCoplanarPoint(forward.clone().negate(), planePoint);
        const hit = pointerOnPlane(event, scene, plane);
        if (!hit) return;
        A.drag = { mode: 'pan', pointerId: event.pointerId, plane, hit, target: scene.target.clone() };
      }
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      const scene = cameraScene();
      if (!A.drag || !scene || A.drag.pointerId !== event.pointerId) return;
      if (A.drag.mode === 'orbit') {
        const next = CameraNavigation.orbitFromDrag(A.state.cameraNavigationPreset, { yaw: A.drag.yaw, pitch: A.drag.pitch }, { x: event.clientX - A.drag.x, y: event.clientY - A.drag.y }, { yaw: .1, pitch: .1, legacyYawSign: 1, legacyPitchSign: -1 });
        scene.orbit.yaw = wrapDegrees(next.yaw);
        scene.orbit.pitch = clamp(next.pitch, -20, 89.999);
      } else {
        const hit = pointerOnPlane(event, scene, A.drag.plane);
        if (!hit) return;
        scene.target.copy(A.drag.target).add(A.drag.hit).sub(hit);
      }
      updateCamera(scene); schedule();
    });
    const end = event => { if (!A.drag || event.pointerId === A.drag.pointerId) A.drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end);
    canvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
      const scene = cameraScene();
      if (!scene || isCameraUiTarget(event.target) || event.deltaY === 0) return;
      event.preventDefault();
      const step = event.deltaY < 0 ? 1 : -1;
      const scaleCurve = Math.max(.0339661, .0339661 + (scene.orbit.scale - .450001) * .104327);
      scene.orbit.scale = clamp(scene.orbit.scale - scaleCurve * step, .1, 7);
      updateCameraProjection(scene); schedule();
    }, { passive: false });
    document.addEventListener('keydown', event => {
      if (!A.visible || A.activeLab === 'palletizer3d' || isEditableTarget(event.target)) return;
      const preset = event.code === 'Space' ? 'space' : event.key === 'F1' ? 'f1' : event.key === 'F2' ? 'f2' : null;
      if (!preset) return;
      event.preventDefault(); applyCameraPreset(A.scenes[A.activeLab], preset); schedule();
    });
  }

  function isEditableTarget(target) { return !!target?.closest?.('input,textarea,select,button,[contenteditable]:not([contenteditable="false"])'); }
  function isCameraUiTarget(target) { return isEditableTarget(target) || !!target?.closest?.('.al-side,.al-camera-presets'); }
  function updateCameraNavigationUi() {
    const preset = CameraNavigation.normalizePreset(A.state?.cameraNavigationPreset);
    const select = q('#al-camera-navigation', A.hub); if (select) select.value = preset;
    qa('[data-camera-hint]', A.hub).forEach(element => {
      element.textContent = CameraNavigation.hint(preset, element.dataset.cameraLegacy) + (element.dataset.cameraExtra || '');
    });
  }
  function setCameraNavigationPreset(value, options = {}) {
    if (!A.state) return '3ds-max';
    const preset = CameraNavigation.normalizePreset(value);
    A.state.cameraNavigationPreset = preset; A.drag = null;
    window.PLCTrainerPalletizer3D?.setCameraNavigationPreset?.(preset);
    updateCameraNavigationUi(); if (A.initialized) schedule();
    if (options.persist !== false) persist(true);
    return preset;
  }
  function applyCameraPreset(scene, name) {
    const preset = CAMERA_PRESETS[name];
    if (!scene || !preset) return;
    scene.target.set(...preset.focus); scene.orbit.pitch = preset.pitch; scene.orbit.yaw = preset.yaw; scene.orbit.scale = preset.scale;
    updateCamera(scene);
  }
  function updateCameraProjection(scene) {
    const size = scene.orbit.scale * .5, aspect = scene.aspect || 1, camera = scene.camera;
    camera.left = -size * aspect; camera.right = size * aspect; camera.top = size; camera.bottom = -size; camera.updateProjectionMatrix();
  }
  function updateCamera(scene) {
    const o = scene.orbit, t = scene.target, pitch = o.pitch * Math.PI / 180, yaw = o.yaw * Math.PI / 180;
    const sp = Math.sin(pitch), cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    const forward = new Three.Vector3(sy * cp, -sp, cy * cp);
    scene.camera.position.copy(t).addScaledVector(forward, -CAMERA_DISTANCE);
    scene.camera.up.set(sy * sp, cp, cy * sp); scene.camera.lookAt(t); updateCameraProjection(scene);
  }

  function bindUi() {
    qa('[data-camera-preset]', A.hub).forEach(button => button.onclick = () => { applyCameraPreset(A.scenes[A.activeLab], button.dataset.cameraPreset); schedule(); });
    q('#al-camera-navigation', A.hub).onchange = event => setCameraNavigationPreset(event.target.value);
    qa('[data-editor-mode]', A.hub).forEach(button => button.onclick = () => {
      const lab = button.closest('[data-editor-tools]')?.dataset.editorTools, editor = A.editors[lab];
      if (editor?.setMode(button.dataset.editorMode)) { updateEditorUi(); schedule(); persist(true); }
    });
    document.addEventListener('keydown', event => {
      if (!A.visible || A.activeLab === 'palletizer3d') return;
      const editor = A.editors[A.activeLab]; if (editor?.handleHotkey(event)) { updateEditorUi(); schedule(); persist(true); }
    });
    q('#al-servo-profile', A.hub).onchange = event => { Servo.setProfile(A.state.labs.servo2, event.target.value); schedule(); updateUi(true); persist(true); };
    qa('[data-servo-action]', A.hub).forEach(button => button.onclick = () => {
      const state = A.state.labs.servo2, profile = Servo.getProfile(state), action = button.dataset.servoAction;
      if (action === 'servo') { const on = !Object.values(state.axes).every(axis => axis.servoOn); for (const axis of ['X', 'Y']) Servo.writeDevice(state, profile.commands.servoOn[axis], on); }
      if (action === 'home') { for (const axis of ['X', 'Y']) { Servo.writeDevice(state, profile.commands.servoOn[axis], true); Servo.writeDevice(state, profile.commands.home[axis], true); } }
      if (action === 'stop') Servo.writeDevice(state, profile.commands.stopAll, true);
      if (action === 'linear') { Servo.writeDevice(state, profile.commands.servoOn.X, true); Servo.writeDevice(state, profile.commands.servoOn.Y, true); Servo.writeDevice(state, profile.data.target.X, q('#al-linear-x', A.hub).value); Servo.writeDevice(state, profile.data.target.Y, q('#al-linear-y', A.hub).value); Servo.writeDevice(state, profile.data.speed, q('#al-linear-speed', A.hub).value); Servo.writeDevice(state, profile.commands.linear, true); }
      schedule(); updateUi(true); persist(true);
    });
    qa('[data-servo-move]', A.hub).forEach(button => button.onclick = () => { const state = A.state.labs.servo2, profile = Servo.getProfile(state), axis = button.dataset.servoMove; Servo.writeDevice(state, profile.commands.servoOn[axis], true); Servo.writeDevice(state, profile.data.target[axis], q(`[data-servo-target="${axis}"]`, A.hub).value); Servo.writeDevice(state, profile.data.speed, 140); Servo.writeDevice(state, profile.commands.move[axis], true); schedule(); updateUi(true); });
    qa('[data-servo-jog]', A.hub).forEach(button => {
      const [axis, direction] = button.dataset.servoJog.split(',');
      button.addEventListener('pointerdown', event => { event.preventDefault(); const state = A.state.labs.servo2, profile = Servo.getProfile(state), command = Number(direction) > 0 ? profile.commands.jogForward[axis] : profile.commands.jogReverse[axis]; Servo.writeDevice(state, profile.commands.servoOn[axis], true); Servo.writeDevice(state, profile.data.speed, 90); Servo.writeDevice(state, command, true); button.setPointerCapture?.(event.pointerId); schedule(); });
      const stop = () => { const state = A.state.labs.servo2, profile = Servo.getProfile(state), command = Number(direction) > 0 ? profile.commands.jogForward[axis] : profile.commands.jogReverse[axis]; Servo.writeDevice(state, command, false); updateUi(true); persist(true); };
      button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); button.addEventListener('lostpointercapture', stop);
    });

    q('#al-mps-profile', A.hub).onchange = event => { MPS.setProfile(A.state.labs.mps, event.target.value); schedule(); updateUi(true); persist(true); };
    q('#al-mps-workpiece-style', A.hub).onchange = event => {
      const state = A.state.labs.mps, style = normalizeMpsWorkpieceStyle(event.target.value), profile = MPS.getProfile(state);
      MPS.writeDevice(state, profile.commands.autoStop, true);
      A.state.appearance.mpsWorkpieceStyle = style;
      MPS.setWorkpieceLength(state, style === 'block' ? 0.06 : 0.028, { updateExisting: true });
      const parts = A.scenes.mps.parts;
      for (const model of parts.workpieceModels.values()) parts.workpieces.remove(model);
      parts.workpieceModels.clear();
      schedule(); updateUi(true); persist(true);
    };
    qa('[data-mps-action]', A.hub).forEach(button => button.onclick = () => {
      const state = A.state.labs.mps, profile = MPS.getProfile(state), action = button.dataset.mpsAction;
      if (action === 'auto') MPS.writeDevice(state, profile.commands.autoStart, true);
      if (action === 'outputs-off') MPS.writeDevice(state, profile.commands.autoStop, true);
      if (action === 'steel' || action === 'plastic') MPS.addWorkpiece(state, action, { length: A.state.appearance.mpsWorkpieceStyle === 'block' ? 0.06 : 0.028 });
      if (action === 'reset') MPS.resetCell(state, { clearCounters: false });
      if (action === 'clear') { for (const item of [...state.workpieces]) MPS.removeWorkpiece(state, item.id); }
      schedule(); updateUi(true); persist(true);
    });
    qa('[data-mps-output-index]', A.hub).forEach(input => input.onchange = () => { const state = A.state.labs.mps, definition = MPS.OUTPUT_DEFINITIONS[Number(input.dataset.mpsOutputIndex)], mapped = MPS.getProfile(state).outputs[definition.key]; MPS.writeDevice(state, mapped, input.checked); schedule(); updateUi(true); persist(); });
    q('#al-mps-lift', A.hub).oninput = event => { const state = A.state.labs.mps, profile = MPS.getProfile(state); MPS.writeDevice(state, profile.data.liftTarget, Number(event.target.value) / 100); schedule(); updateUi(true); };

    q('#al-pneu-profile', A.hub).onchange = event => { Pneumatic.setProfile(A.state.labs.pneumatic, event.target.value); schedule(); updateUi(true); persist(true); };
    qa('[data-pneu-action]', A.hub).forEach(button => button.onclick = () => { const state = A.state.labs.pneumatic, profile = Pneumatic.getProfile(state), action = button.dataset.pneuAction; if (action === 'supply') Pneumatic.writeDevice(state, profile.commands.supply, !state.source.on); if (action === 'auto') Pneumatic.writeDevice(state, profile.commands.auto, true); if (action === 'stop') Pneumatic.writeDevice(state, profile.commands.stop, true); if (action === 'reset') Pneumatic.writeDevice(state, profile.commands.reset, true); Pneumatic.tick(state, 0); schedule(); updateUi(true); persist(true); });
    q('#al-pneu-valve', A.hub).onchange = event => { Pneumatic.setValveType(A.state.labs.pneumatic, event.target.value); syncPneumaticValveVisual(); schedule(); updateUi(true); persist(true); };
    q('#al-pneu-reg', A.hub).onchange = event => { Pneumatic.setRegulator(A.state.labs.pneumatic, event.target.value); Pneumatic.tick(A.state.labs.pneumatic, 0); updateUi(true); };
    q('#al-pneu-throttle', A.hub).onchange = event => { Pneumatic.setThrottle(A.state.labs.pneumatic, 'extend', event.target.value); };
    qa('[data-pneu-coil]', A.hub).forEach(input => input.onchange = () => {
      const state = A.state.labs.pneumatic, profile = Pneumatic.getProfile(state);
      if (input.dataset.pneuCoil === 'B' && state.valve.type !== 'double') {
        input.checked = false; Pneumatic.writeDevice(state, profile.commands.coilB, false); Pneumatic.tick(state, 0); syncPneumaticValveVisual(); schedule(); updateUi(true); return;
      }
      const command = input.dataset.pneuCoil === 'B' ? profile.commands.coilB : profile.commands.coilA;
      Pneumatic.writeDevice(state, command, input.checked); Pneumatic.tick(state, 0); schedule(); updateUi(true);
    });
    q('#al-pneu-vacuum', A.hub).onchange = event => { const state = A.state.labs.pneumatic; Pneumatic.writeDevice(state, Pneumatic.getProfile(state).commands.vacuum, event.target.checked); Pneumatic.tick(state, 0); updateUi(true); };
    q('#al-pneu-part', A.hub).onchange = event => { A.state.labs.pneumatic.vacuum.partPresent = event.target.checked; Pneumatic.tick(A.state.labs.pneumatic, 0); updateUi(true); };
    q('#al-pneu-leak', A.hub).oninput = event => { Pneumatic.setTubeLeak(A.state.labs.pneumatic, 'T03', event.target.value); Pneumatic.tick(A.state.labs.pneumatic, 0); updateUi(true); schedule(); };

    q('#al-discrete-profile', A.hub).onchange = event => { const state = A.state.labs.discrete; Discrete.setProfile(state, event.target.value); Discrete.tick(state, 0); updateUi(true); schedule(); persist(true); };
    q('#al-discrete-input-mode', A.hub).onchange = event => { const state = A.state.labs.discrete; Discrete.setInputMode(state, event.target.value); Discrete.tick(state, 0); updateUi(true); schedule(); persist(true); };
    q('#al-discrete-meter-mode', A.hub).onchange = event => { Discrete.setMeterMode(A.state.labs.discrete, event.target.value); updateUi(true); persist(true); };
    qa('[data-discrete-action]', A.hub).forEach(button => button.onclick = () => {
      const state = A.state.labs.discrete, profile = Discrete.getProfile(state), action = button.dataset.discreteAction;
      if (action === 'power') Discrete.setPower(state, !state.power.on);
      if (action === 'reference') applyDiscreteConnections(Discrete.referenceConnections(state.inputMode));
      if (action === 'probe-reference') applyProbeReferenceConnections();
      if (action === 'outputs-off') for (const address of Object.values(profile.outputs)) Discrete.writeDevice(state, address, false);
      if (action === 'clear') applyDiscreteConnections([]);
      if (action === 'counter-reset') Discrete.writeDevice(state, profile.commands.counterReset, true);
      Discrete.tick(state, 0); updateUi(true); schedule(); persist(true);
    });
    qa('[data-discrete-input]', A.hub).forEach(input => input.onchange = () => { const state = A.state.labs.discrete; Discrete.setPhysicalInput(state, input.dataset.discreteInput, input.checked); Discrete.tick(state, 0); updateUi(true); schedule(); persist(); });
    qa('[data-discrete-output]', A.hub).forEach(input => input.onchange = () => { const state = A.state.labs.discrete, profile = Discrete.getProfile(state); Discrete.writeDevice(state, profile.outputs[input.dataset.discreteOutput], input.checked); Discrete.tick(state, 0); updateUi(true); schedule(); persist(); });
    q('#al-discrete-timer-preset', A.hub).onchange = event => { const state = A.state.labs.discrete, profile = Discrete.getProfile(state); Discrete.writeDevice(state, profile.data.timerPreset, event.target.value); updateUi(true); persist(true); };
    q('#al-discrete-counter-preset', A.hub).onchange = event => { const state = A.state.labs.discrete, profile = Discrete.getProfile(state); Discrete.writeDevice(state, profile.data.counterPreset, event.target.value); updateUi(true); persist(true); };
    q('#al-equipment-select', A.hub).onchange = event => { void showEquipmentModel(event.target.value); };
  }

  function setLab(lab) {
    if (!LABS.includes(lab)) lab = 'servo2';
    A.activeLab = lab; A.state.activeLab = lab;
    qa('.al-tab', A.hub).forEach(button => button.classList.toggle('active', button.dataset.lab === lab));
    qa('.al-pane', A.hub).forEach(pane => pane.classList.toggle('active', pane.dataset.labPane === lab));
    window.PLCTrainerPalletizer3D?.setVisible?.(A.visible && lab === 'palletizer3d');
    A.host?.classList.toggle('show', A.visible);
    if (lab !== 'palletizer3d' && A.renderer) {
      const host = q(`[data-scene="${lab}"]`, A.hub); if (host && A.renderer.domElement.parentNode !== host) host.insertBefore(A.renderer.domElement, q('.al-scene-hint', host)); A.canvasHost = host; updateCamera(A.scenes[lab]); resize(); schedule();
    }
    if (lab === 'equipment3d' && A.equipmentCatalog.length && !A.scenes.equipment3d.parts.selectedModel) void showEquipmentModel(A.state.equipment.selected);
    updateEditorUi(); updateUi(true); persist(true);
  }

  function updateServoScene() {
    const state = A.state.labs.servo2, parts = A.scenes.servo2.parts;
    parts.xCarriage.position.x = -4.05 + state.axes.X.current / 500 * 8.1; parts.yCarriage.position.z = 2.05 - state.axes.Y.current / 400 * 4.1;
    const imported = parts.importedAxes;
    if (imported?.axis1 && imported.axis1Base) {
      const ratio = (state.axes.X.current - state.axes.X.min) / (state.axes.X.max - state.axes.X.min);
      imported.axis1.position.x = imported.axis1Base.x - .21 + ratio * .345;
    }
    if (imported?.axis2 && imported.axis2Base) {
      const ratio = (state.axes.Y.current - state.axes.Y.min) / (state.axes.Y.max - state.axes.Y.min);
      imported.axis2.position.z = imported.axis2Base.z + .055 + ratio * .151;
    }
    setLed(parts.leds.X0, state.axes.X.reverseLimit); setLed(parts.leds.X1, state.axes.X.forwardLimit, 0xff5348); setLed(parts.leds.Y0, state.axes.Y.reverseLimit); setLed(parts.leds.Y1, state.axes.Y.forwardLimit, 0xff5348);
  }

  function clearDynamic(group) { while (group.children.length) { const item = group.children.pop(); item.geometry?.dispose?.(); item.material?.dispose?.(); } }
  function updateMpsScene() {
    const state = A.state.labs.mps, parts = A.scenes.mps.parts, group = parts.workpieces;
    if (parts.workpieceTemplates) {
      const style = normalizeMpsWorkpieceStyle(A.state.appearance?.mpsWorkpieceStyle);
      const templates = parts.workpieceTemplates[style] || parts.workpieceTemplates.compact;
      const live = new Set();
      for (const item of state.workpieces) {
        live.add(item.id); let model = parts.workpieceModels.get(item.id);
        if (!model) { model = templates[item.material === 'steel' ? 'steel' : 'plastic'].clone(true); model.userData.mpsWorkpieceStyle = style; group.add(model); parts.workpieceModels.set(item.id, model); }
        if (item.heldByVacuum) {
          model.position.set(-.2807 - state.actuators.unloading.position * .0453, .8874 + state.liftServo.position * .216, -.09);
        } else {
          model.position.set(-.055 - item.x / state.config.conveyor.length * .31, style === 'block' ? .915 : .925, -.09);
        }
        model.rotation.set(0, style === 'block' ? 0 : Math.PI / 2, 0);
      }
      for (const [id, model] of parts.workpieceModels) if (!live.has(id)) { group.remove(model); parts.workpieceModels.delete(id); }
    } else {
      clearDynamic(group);
      for (const item of state.workpieces) { const x = -.055 - item.x / state.config.conveyor.length * .31, mat = material(item.material === 'steel' ? 0x9da9af : 0xf19a3d, item.material === 'steel' ? .75 : .05, .42); const mesh = cylinder(group, .0145, .02, [x, .925, -.09], mat, 'y'); mesh.scale.z = .9; }
    }
    const plant = parts.importedPlant;
    if (plant) {
      const setStroke = (binding, value) => { if (binding?.node) binding.node.position[binding.axis] = binding.start + (binding.end - binding.start) * value; };
      setStroke(plant.supply, state.actuators.supply.position);
      setStroke(plant.drill, state.actuators.drill.position);
      setStroke(plant.distribution, state.actuators.distribution.position);
      setStroke(plant.emission, state.actuators.emission.position);
      setStroke(plant.stopper, state.actuators.stopper.position);
      setStroke(plant.liftPneumatic, state.actuators.liftPneumatic.position);
      setStroke(plant.unloading, state.actuators.unloading.position);
      setStroke(plant.liftServo, state.liftServo.position);
      const elapsedDelta = Math.max(0, state.elapsed - plant.lastElapsed); plant.lastElapsed = state.elapsed;
      if (state.outputBits[13] && plant.drillRotor?.node) plant.drillAngle = (plant.drillAngle + elapsedDelta * Math.PI * 2) % (Math.PI * 2);
      if (plant.drillRotor?.node) plant.drillRotor.node.rotation.z = plant.drillRotor.baseRotation.z - plant.drillAngle;
      if (state.outputBits[14]) plant.beltOffset = ((plant.beltOffset || 0) + elapsedDelta) % 1;
      for (const map of plant.beltMaps) map.offset.x = -(plant.beltOffset || 0);
      for (let index = 0; index < 13; index += 1) setImportedLamp(plant.lamps[index], state.outputBits[index]);
      setImportedLamp(plant.lamps[13], state.outputBits[15], 0xff382f);
      setImportedLamp(plant.lamps[14], state.outputBits[16], 0xffc72f);
      setImportedLamp(plant.lamps[15], state.outputBits[17], 0x36e978);
    }
  }

  function syncPneumaticValveVisual() {
    const state = A.state?.labs?.pneumatic, parts = A.scenes.pneumatic?.parts;
    if (!state || !parts) return;
    if (state.valve.type !== 'double' && state.valve.coilB) {
      Pneumatic.writeDevice(state, Pneumatic.getProfile(state).commands.coilB, false);
    }
    const single = parts.importedValves?.single, double = parts.importedValves?.double;
    if (single) single.visible = state.valve.type === 'single';
    if (double) double.visible = state.valve.type === 'double';
    const coilB = A.hub ? q('[data-pneu-coil="B"]', A.hub) : null;
    if (coilB) {
      coilB.disabled = state.valve.type !== 'double';
      if (coilB.disabled) coilB.checked = false;
      coilB.closest('label')?.classList.toggle('disabled', coilB.disabled);
      coilB.title = coilB.disabled ? '5/2 단솔 밸브에는 SOL B 코일이 없습니다.' : '5/2 복솔 밸브 SOL B 후진 코일';
    }
  }

  function updatePneumaticScene() {
    const state = A.state.labs.pneumatic, parts = A.scenes.pneumatic.parts; syncPneumaticValveVisual(); parts.rod.position.x = parts.rodBaseX + state.cylinder.position * 1.4; setLed(parts.coilLeds[0], state.valve.coilA); setLed(parts.coilLeds[1], state.valve.type === 'double' && state.valve.coilB, 0xffb637); setLed(parts.gauge, state.service.outputBar >= 3, 0x4ad7ff); setLed(parts.vacuum, state.vacuum.holding, 0x7bf2c3);
    if (parts.importedCylinder?.rod && parts.importedCylinder.base) parts.importedCylinder.rod.position.x = parts.importedCylinder.base.x + state.cylinder.position * .18;
    const leak = state.tubes.find(tube => tube.id === 'T03')?.leak || 0; parts.tubes.forEach((tube, index) => { tube.material.opacity = index === 0 ? .82 : .82 * (1 - leak * .7); });
  }

  function setNamedMaterialLamp(model, pattern, on, color) {
    model?.traverse?.(object => {
      if (!object.isMesh || !object.material) return;
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!pattern.test(`${object.name || ''} ${mat.name || ''}`)) continue;
        if (mat.emissive?.setHex) mat.emissive.setHex(on ? color : 0x000000);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = on ? 2.1 : 0;
        mat.needsUpdate = true;
      }
    });
  }

  function updateDiscreteScene() {
    const state = A.state?.labs?.discrete, parts = A.scenes.discrete?.parts; if (!state || !parts) return;
    const output = key => !!(state.outputs?.[key] ?? state.effectiveOutputs?.[key]);
    const input = key => !!(state.inputs?.[key] ?? state.effectiveInputs?.[key] ?? state.physicalInputs?.[key]);
    const imported = parts.imported || {}, node = (id, pattern) => findImportedNode(imported[id]?.model, pattern);
    for (const [index, key] of ['relay1', 'relay2', 'relay3'].entries()) setImportedLamp(node('relay', new RegExp(`RY${index + 1}`, 'i')), output(key));
    setImportedLamp(node('timer', /(?:OUT|RUN).*LED|LED.*(?:OUT|RUN)/i), output('timer'));
    setImportedLamp(node('counter', /(?:Signal Input|Include).*LED/i), output('counter'), 0xff9e43);
    const sensorMap = [['photo-npn', 'photoNpn'], ['photo-pnp', 'photoPnp'], ['inductive-npn', 'inductiveNpn'], ['inductive-pnp', 'inductivePnp'], ['capacitive-npn', 'capacitiveNpn'], ['capacitive-pnp', 'capacitivePnp']];
    for (const [id, key] of sensorMap) { setImportedLamp(node(id, /Power.*Led/i), !!state.power?.on, 0x35f287); setImportedLamp(node(id, /Out.*Led/i), input(key), 0xffa72e); }
    setNamedMaterialLamp(imported['buzzer-lamp']?.model, /GREEN/i, output('lampGreen'), 0x34e878);
    setNamedMaterialLamp(imported['buzzer-lamp']?.model, /YELLOW/i, output('lampYellow'), 0xffca37);
    setNamedMaterialLamp(imported['buzzer-lamp']?.model, /RED/i, output('lampRed'), 0xff3c35);
    setNamedMaterialLamp(imported['buzzer-lamp']?.model, /WHITE/i, output('lampWhite'), 0xf4f4e9);
    setImportedLamp(node('tower', /Green/i), output('towerGreen'), 0x35ed78);
    setImportedLamp(node('tower', /Yellow/i), output('towerYellow'), 0xffc831);
    setImportedLamp(node('tower', /Red/i), output('towerRed'), 0xff3c35);
    const plc = imported.plc?.model;
    DISCRETE_OUTPUTS.slice(0, 8).forEach(([key], index) => setImportedLamp(findImportedNode(plc, new RegExp(`LED_${index + 1}(?:__|$)`, 'i')), output(key), 0xffa93b));
    updateFndOverlay(parts.fnd.timer, Number(state.timer?.value || 0).toFixed(1));
    updateFndOverlay(parts.fnd.counter, Math.trunc(state.counter?.value || 0));
    updateFndOverlay(parts.fnd.counterUnit, Math.trunc(state.counter?.preset || 0));
  }

  function updateScenes() { updateServoScene(); updateMpsScene(); updatePneumaticScene(); updateDiscreteScene(); }

  function updateUi(force = false) {
    if (!A.hub) return; const now = performance.now(); if (!force && now - A.lastUi < 90) return; A.lastUi = now;
    const servo = A.state.labs.servo2, servoBusy = Object.values(servo.axes).some(axis => axis.busy), servoFault = Object.values(servo.axes).some(axis => axis.alarm); const servoStatus = q('#al-servo-status', A.hub); q('b', servoStatus).textContent = servoFault ? '서보 알람' : servoBusy ? '위치결정 운전' : '서보 대기'; q('span', servoStatus).textContent = servo.linear.active ? 'LINEAR' : servoFault ? 'FAULT' : servoBusy ? 'BUSY' : 'READY'; servoStatus.classList.toggle('fault', servoFault); q('#al-servo-profile', A.hub).value = servo.profileId;
    for (const name of ['X', 'Y']) { const axis = servo.axes[name]; q(`[data-servo-pos="${name}"]`, A.hub).textContent = `${axis.current.toFixed(2)} mm`; q(`[data-servo-flags="${name}"]`, A.hub).textContent = axis.alarm ? axis.alarm.code : [axis.servoOn ? 'SV ON' : 'SV OFF', axis.homed ? 'HOME' : 'NO HOME', axis.busy ? 'BUSY' : 'READY', axis.dog ? 'DOG' : ''].filter(Boolean).join(' · '); }
    const allServo = Object.values(servo.axes).every(axis => axis.servoOn), servoButton = q('[data-servo-action="servo"]', A.hub); servoButton.textContent = allServo ? 'SERVO OFF' : 'SERVO ON'; servoButton.classList.toggle('on', allServo);
    const sp = Servo.getProfile(servo), memoryRows = [['ON X', sp.commands.servoOn.X, Servo.readDevice(servo, sp.status.servoReady.X)], ['ON Y', sp.commands.servoOn.Y, Servo.readDevice(servo, sp.status.servoReady.Y)], ['X 목표', sp.data.target.X, Servo.readDevice(servo, sp.data.target.X)], ['Y 목표', sp.data.target.Y, Servo.readDevice(servo, sp.data.target.Y)], ['직선보간', sp.commands.linear, Servo.readDevice(servo, sp.status.linearBusy)]]; q('#al-servo-memory', A.hub).innerHTML = memoryRows.map(row => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${row[2] === true ? 'ON' : row[2] === false ? 'OFF' : Number(row[2] || 0).toFixed(1)}</td></tr>`).join('');

    const mps = A.state.labs.mps; MPS.updateInputs(mps); const mp = MPS.getProfile(mps), mpsStatus = q('#al-mps-status', A.hub), activeOutputs = mps.outputBits.filter(Boolean).length, activeInputs = mps.inputBits.filter(Boolean).length; q('b', mpsStatus).textContent = mps.auto.running ? '외부 PLC 출력 제어' : 'PLC 출력 대기'; q('span', mpsStatus).textContent = `${mp.id === 'ls' ? 'LS' : 'MELSEC'} · ${activeOutputs} OUT · ${activeInputs} IN · ${mps.workpieces.length} EA`; mpsStatus.classList.toggle('fault', !!mps.fault); q('#al-mps-profile', A.hub).value = mps.profileId; const workpieceStyle = q('#al-mps-workpiece-style', A.hub); workpieceStyle.value = normalizeMpsWorkpieceStyle(A.state.appearance?.mpsWorkpieceStyle); workpieceStyle.disabled = mps.workpieces.length > 0; workpieceStyle.title = workpieceStyle.disabled ? '워크를 비운 뒤 형상을 변경하세요' : '3D 형상과 센서 판정 길이를 함께 변경합니다';
    qa('[data-mps-output-index]', A.hub).forEach(input => { const index = Number(input.dataset.mpsOutputIndex), definition = MPS.OUTPUT_DEFINITIONS[index], mapped = mp.outputs[definition.key], label = q(`[data-mps-output-label="${index}"]`, A.hub); input.checked = !!mps.outputBits[index]; if (label) label.textContent = `${mapped} ${MPS_OUTPUT_LABELS[index]}`; input.parentElement.title = `${mp.vendor} ${mapped} · 물리 O${index} ${MPS_OUTPUT_LABELS[index]}`; });
    qa('[data-mps-input-index]', A.hub).forEach(item => { const index = Number(item.dataset.mpsInputIndex), definition = MPS.INPUT_DEFINITIONS[index], mapped = mp.inputs[definition.key], label = q(`[data-mps-input-label="${index}"]`, item); item.classList.toggle('on', !!mps.inputBits[index]); if (label) label.textContent = `${mapped} ${MPS_INPUT_LABELS[index]}`; item.title = `${mp.vendor} ${mapped} · 물리 I${index} ${MPS_INPUT_LABELS[index]}`; });
    q('#al-mps-lift-addresses', A.hub).textContent = `${mp.inputs[MPS.INPUT_DEFINITIONS[24].key]} RLS · ${mp.inputs[MPS.INPUT_DEFINITIONS[25].key]} DOG · ${mp.inputs[MPS.INPUT_DEFINITIONS[26].key]} FLS`;
    q('#al-mps-lift-target-label', A.hub).textContent = `${mp.data.liftTarget} 위치 명령`;
    const liftValue = Math.round(mps.liftServo.target * 100); q('#al-mps-lift', A.hub).value = liftValue; q('#al-mps-lift-value', A.hub).textContent = `${Math.round(mps.liftServo.position * 100)}%`;
    q('#al-mps-log', A.hub).innerHTML = mps.events.slice(-7).reverse().map(event => `<div class="${event.type === 'alarm' ? 'fault' : ''}">${event.time.toFixed(1)}s · ${esc(event.message)}</div>`).join('');

    const pneu = A.state.labs.pneumatic, pp = Pneumatic.getProfile(pneu), pneuStatus = q('#al-pneu-status', A.hub); syncPneumaticValveVisual(); q('b', pneuStatus).textContent = pneu.faults[0]?.message || pneu.auto.message; q('span', pneuStatus).textContent = `${pp.id === 'ls' ? 'LS' : 'MELSEC'} · ${pneu.auto.state} · ${pneu.valve.spool.toUpperCase()}`; pneuStatus.classList.toggle('fault', !!pneu.faults.length); q('#al-pneu-profile', A.hub).value = pneu.profileId; q('#al-pneu-valve', A.hub).value = pneu.valve.type; q('#al-pneu-reg', A.hub).value = pneu.service.regulatorBar; q('#al-pneu-throttle', A.hub).value = pneu.cylinder.throttleExtend;
    q('#al-pneu-memory', A.hub).innerHTML = [['AIR', pp.commands.supply, pneu.source.on], ['SOL A', pp.commands.coilA, pneu.valve.coilA], ['SOL B', pp.commands.coilB, pneu.valve.type === 'double' && pneu.valve.coilB], ['READY', pp.status.ready, Pneumatic.readDevice(pneu, pp.status.ready)], ['EXT', pp.status.extended, pneu.cylinder.extended], ['RET', pp.status.retracted, pneu.cylinder.retracted]].map(row => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${row[2] ? 'ON' : 'OFF'}</td></tr>`).join('');
    const airButton = q('[data-pneu-action="supply"]', A.hub); airButton.textContent = pneu.source.on ? 'AIR OFF' : 'AIR ON'; airButton.classList.toggle('on', pneu.source.on); qa('[data-pneu-coil]', A.hub).forEach(input => { const unavailable = input.dataset.pneuCoil === 'B' && pneu.valve.type !== 'double'; input.disabled = unavailable; input.checked = unavailable ? false : !!pneu.valve[`coil${input.dataset.pneuCoil}`]; }); q('#al-pneu-vacuum', A.hub).checked = pneu.vacuum.command; q('#al-pneu-part', A.hub).checked = pneu.vacuum.partPresent;
    q('[data-pneu-gauge="input"]', A.hub).textContent = pneu.service.inputBar.toFixed(1); q('[data-pneu-gauge="output"]', A.hub).textContent = pneu.service.outputBar.toFixed(1); q('[data-pneu-gauge="vacuum"]', A.hub).textContent = pneu.vacuum.pressureBar.toFixed(1); q('#al-pneu-stroke', A.hub).style.width = `${pneu.cylinder.position * 100}%`;
    const leak = pneu.tubes.find(tube => tube.id === 'T03')?.leak || 0; q('#al-pneu-leak', A.hub).value = leak; q('#al-pneu-leak-label', A.hub).textContent = `${Math.round(leak * 100)}%`; const pneuSensors = { retracted: pneu.cylinder.retracted, extended: pneu.cylinder.extended, vacuum: pneu.vacuum.holding, fault: !!pneu.faults.length }; qa('[data-pneu-sensor]', A.hub).forEach(item => item.classList.toggle('on', !!pneuSensors[item.dataset.pneuSensor])); q('#al-pneu-log', A.hub).innerHTML = pneu.events.slice(-7).reverse().map(event => `<div class="${event.type === 'alarm' ? 'fault' : ''}">${event.time.toFixed(1)}s · ${esc(event.message)}</div>`).join('');

    const discrete = A.state.labs.discrete, dp = Discrete.getProfile(discrete), solution = Discrete.evaluateTopology(discrete), discreteStatus = q('#al-discrete-status', A.hub);
    q('b', discreteStatus).textContent = solution.ready ? '폐회로 결선 정상' : solution.issues[0]?.message || '기준 결선 필요';
    q('span', discreteStatus).textContent = `${dp.id === 'ls' ? 'LS' : 'MELSEC'} · ${discrete.power.on ? '24V ON' : 'POWER OFF'} · ${solution.issues.length} ISSUE`;
    discreteStatus.classList.toggle('fault', solution.issues.length > 0); q('#al-discrete-profile', A.hub).value = discrete.profileId; q('#al-discrete-input-mode', A.hub).value = discrete.inputMode; q('#al-discrete-meter-mode', A.hub).value = discrete.meterMode;
    const powerButton = q('[data-discrete-action="power"]', A.hub); powerButton.textContent = discrete.power.on ? 'DC 24V OFF' : 'DC 24V ON'; powerButton.classList.toggle('on', discrete.power.on);
    qa('[data-discrete-input]', A.hub).forEach(inputBox => { const key = inputBox.dataset.discreteInput, address = dp.inputs[key]; inputBox.checked = !!discrete.physicalInputs[key]; const label = q(`[data-discrete-input-label="${key}"]`, A.hub), name = DISCRETE_INPUTS.find(item => item[0] === key)?.[1] || key; if (label) label.textContent = `${address} ${name}`; inputBox.parentElement.classList.toggle('on', !!discrete.inputs[key]); inputBox.parentElement.title = `${dp.vendor} ${address} · 물리 입력 ${key}`; });
    qa('[data-discrete-output]', A.hub).forEach(outputBox => { const key = outputBox.dataset.discreteOutput, address = dp.outputs[key]; outputBox.checked = !!discrete.commandOutputs[key]; const label = q(`[data-discrete-output-label="${key}"]`, A.hub), name = DISCRETE_OUTPUTS.find(item => item[0] === key)?.[1] || key; if (label) label.textContent = `${address} ${name}`; outputBox.parentElement.classList.toggle('on', !!discrete.effectiveOutputs[key]); outputBox.parentElement.title = `${dp.vendor} ${address} · 명령 ${discrete.commandOutputs[key] ? 'ON' : 'OFF'} · 실제 부하 ${discrete.effectiveOutputs[key] ? 'ON' : 'OFF'}`; });
    q('#al-discrete-timer-preset', A.hub).value = discrete.timer.preset; q('#al-discrete-counter-preset', A.hub).value = discrete.counter.preset; q('#al-discrete-timer-value', A.hub).textContent = discrete.timer.value.toFixed(1); q('#al-discrete-counter-value', A.hub).textContent = String(discrete.counter.value); q('#al-discrete-wire-count', A.hub).textContent = String(discrete.connections.length);
    const measurement = Discrete.measureBetween(discrete, 'probe-red.TIP', 'probe-black.TIP'), meter = q('#al-discrete-meter', A.hub), meterOk = measurement.status === 'OK';
    q('b', meter).textContent = measurement.mode === 'voltage' && meterOk ? `${measurement.volts >= 0 ? '+' : ''}${measurement.volts.toFixed(1)} V DC` : measurement.mode === 'continuity' && meterOk ? measurement.continuity ? '0 Ω · 연속' : 'OL · 단선' : measurement.message || '프로브 미연결';
    q('span', meter).textContent = meterOk ? measurement.mode.toUpperCase() : measurement.code || 'BLOCKED'; meter.classList.toggle('fault', !meterOk);
    q('#al-discrete-issues', A.hub).innerHTML = solution.issues.length ? solution.issues.slice(0, 10).map(issue => `<div class="fault"><b>${esc(issue.code)}</b> · ${esc(issue.message)}</div>`).join('') : '<div>전원·입력 COM·출력 귀로가 모두 완성되었습니다.</div>';
    q('#al-discrete-memory', A.hub).innerHTML = [['PLC', dp.vendor, dp.family], ['전원 준비', dp.status.powerReady, solution.powerReady], ['입력 COM', dp.status.inputCommonReady, solution.inputCommonReady], ['타이머 완료', dp.status.timerDone, discrete.timer.done], ['카운터 완료', dp.status.counterDone, discrete.counter.done]].map(row => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${typeof row[2] === 'boolean' ? row[2] ? 'ON' : 'OFF' : esc(row[2])}</td></tr>`).join('');
  }

  function mpsPlantMoving(mps) {
    if (mps.outputBits[13] || mps.outputBits[14] || mps.liftServo.moving) return true;
    return Object.values(mps.actuators).some(axis => (axis.lastDirection > 0 && axis.position < 1) || (axis.lastDirection < 0 && axis.position > 0));
  }
  function hasMotion() { const servo = A.state.labs.servo2, mps = A.state.labs.mps, pneu = A.state.labs.pneumatic, discrete = A.state.labs.discrete; return Object.values(servo.axes).some(axis => axis.busy) || servo.linear.active || mpsPlantMoving(mps) || pneu.auto.running || (pneu.source.on && (pneu.valve.coilA || pneu.valve.coilB || !pneu.cylinder.retracted)) || discrete.timer.active; }
  function animate(timestamp) {
    A.raf = 0; if (!A.initialized) return; if (!A.lastTime) A.lastTime = timestamp; const dt = Math.min(.05, Math.max(0, (timestamp - A.lastTime) / 1000)); A.lastTime = timestamp;
    const servo = A.state.labs.servo2, mps = A.state.labs.mps, pneu = A.state.labs.pneumatic, discrete = A.state.labs.discrete; if (Object.values(servo.axes).some(axis => axis.busy) || servo.linear.active) Servo.tick(servo, dt); if (mpsPlantMoving(mps) || mps.auto.running) MPS.tick(mps, dt); if (pneu.auto.running || pneu.source.on) Pneumatic.tick(pneu, dt); if (discrete.timer.active || discrete.effectiveOutputs.timer) Discrete.tick(discrete, dt);
    updateScenes(); updateUi(); persist(); if (A.visible && A.activeLab !== 'palletizer3d' && A.renderer) { const scene = A.scenes[A.activeLab]; A.renderer.render(scene.scene, scene.camera); }
    if (hasMotion()) schedule();
  }
  function schedule() { if (!A.raf) A.raf = requestAnimationFrame(animate); }
  function resize() { if (!A.renderer || !A.canvasHost) return; const rect = A.canvasHost.getBoundingClientRect(); if (rect.width < 20 || rect.height < 20) return; A.renderer.setSize(rect.width, rect.height, false); const scene = A.scenes[A.activeLab]; if (scene) { scene.aspect = rect.width / rect.height; updateCameraProjection(scene); } }
  function setVisible(visible) { A.visible = !!visible; if (!A.initialized) return; A.lastTime = 0; A.host?.classList.toggle('show', A.visible); window.PLCTrainerPalletizer3D?.setVisible?.(A.visible && A.activeLab === 'palletizer3d'); if (A.visible) { setLab(A.activeLab); resize(); schedule(); } else persist(true); }
  function renderActive() { if (!A.initialized) return; updateScenes(); updateUi(true); if (A.visible) schedule(); }
  function syncMpsWorkpiecePhysicalSize() {
    const style = normalizeMpsWorkpieceStyle(A.state?.appearance?.mpsWorkpieceStyle);
    return MPS.setWorkpieceLength(A.state.labs.mps, style === 'block' ? 0.06 : 0.028, { updateExisting: true, emit: false });
  }
  function getEditor(lab = A.activeLab) { return A.editors[lab] || null; }
  function getSceneDiagnostics() {
    const plant = A.scenes.mps?.parts?.importedPlant;
    return {
      activeLab: A.activeLab,
      cameraNavigationPreset: A.state?.cameraNavigationPreset || '3ds-max',
      editors: Object.fromEntries(Object.entries(A.editors).map(([lab, editor]) => [lab, { mode: editor.mode, modules: editor.modules.size, connections: editor.connections.size }])),
      mps: plant ? {
        supplyZ: plant.supply?.node?.position.z,
        drillZ: plant.drill?.node?.position.z,
        distributionZ: plant.distribution?.node?.position.z,
        stopperY: plant.stopper?.node?.position.y,
        liftY: plant.liftServo?.node?.position.y,
        unloadingX: plant.unloading?.node?.position.x
      } : null,
      discrete: A.state?.labs?.discrete ? {
        profileId: A.state.labs.discrete.profileId,
        inputMode: A.state.labs.discrete.inputMode,
        powerOn: A.state.labs.discrete.power.on,
        ready: A.state.labs.discrete.solution.ready,
        measurement: Discrete.measureBetween(A.state.labs.discrete, 'probe-red.TIP', 'probe-black.TIP'),
        issueCodes: A.state.labs.discrete.solution.issues.map(issue => issue.code),
        importedAssets: Object.keys(A.scenes.discrete?.parts?.imported || {}).sort(),
        runtimeDisplays: Object.keys(A.scenes.discrete?.parts?.fnd || {}).sort()
      } : null,
      equipment3d: {
        catalogCount: A.equipmentCatalog.length,
        selected: A.scenes.equipment3d?.parts?.selectedEntry?.file || A.state?.equipment?.selected || null,
        loaded: A.scenes.equipment3d?.parts?.selectedModel?.name || null
      }
    };
  }

  function importState(saved) {
    if (!saved || typeof saved !== 'object') return;
    A.state = { schemaVersion: 4, activeLab: LABS.includes(saved.activeLab) ? saved.activeLab : 'servo2', cameraNavigationPreset: CameraNavigation.normalizePreset(saved.cameraNavigationPreset), labs: { servo2: Servo.createState({ saved: saved.labs?.servo2 }), mps: MPS.createState({ saved: saved.labs?.mps }), pneumatic: Pneumatic.createState({ saved: saved.labs?.pneumatic }), discrete: Discrete.createState({ saved: saved.labs?.discrete }) }, editor: saved.editor || null, equipment: { selected: typeof saved.equipment?.selected === 'string' ? saved.equipment.selected : 'relay-module.glb' }, appearance: { mpsWorkpieceStyle: normalizeMpsWorkpieceStyle(saved.appearance?.mpsWorkpieceStyle) } };
    syncMpsWorkpiecePhysicalSize();
    for (const [lab, editor] of Object.entries(A.editors)) if (saved.editor?.[lab]) { try { editor.importState(saved.editor[lab], { strict: false }); } catch (error) { console.warn(`Editor state for ${lab} could not be restored`, error); } }
    A.activeLab = A.state.activeLab; setCameraNavigationPreset(A.state.cameraNavigationPreset, { persist: false }); setLab(A.activeLab); updateScenes(); updateUi(true); if (A.equipmentCatalog.length) void showEquipmentModel(A.state.equipment.selected); persist(true);
  }

  function init() {
    injectCss(); A.state = loadSaved(); syncMpsWorkpiecePhysicalSize(); A.activeLab = A.state.activeLab; if (!injectUi()) return; bindUi(); setCameraNavigationPreset(A.state.cameraNavigationPreset, { persist: false }); A.initialized = createRenderer(); if (!A.initialized) return; A.resizeObserver = new ResizeObserver(() => { if (A.visible) resize(); }); A.resizeObserver.observe(A.content); setLab(A.activeLab); updateScenes(); updateUi(true); persist(true);
  }

  window.PLCTrainerAutomationLabs = { version: '2.12.0', setVisible, setLab, renderActive, resize, exportState, importState, setCameraNavigationPreset, getEditor, getSceneDiagnostics, get activeLab() { return A.activeLab; }, get state() { return A.state; } };
  init();
})();
