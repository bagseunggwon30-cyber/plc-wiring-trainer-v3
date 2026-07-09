# 제어반 결선 실습 HTML 고도화 계획서  
## DIN 레일 배치 · 배전 모드 · 단자대 정확도 · GitHub 오픈소스 활용안

> 목적: 지금 만든 `결선 작업장 v2`를 실제 제어반 실습에 더 가깝게 만들기 위한 구현 계획서다.  
> 핵심은 **아무 곳에 장비를 놓는 자유 배치**가 아니라, 첨부 이미지처럼 **제어반 프레임 → DIN 레일 → 단자대/부품 → 배선덕트 → 도어 조작판** 순서로 제약을 걸어 현장 결선 연습을 하게 만드는 것이다.  
> 이 문서는 Codex에게 바로 넘겨서 작업시킬 수 있도록 “기능 명세 + 데이터 구조 + 구현 단계 + 오픈소스 후보” 형태로 작성했다.

---

## 0. 현재 HTML에서 유지해야 할 장점

현재 `index.html`은 이미 다음 기반이 있으므로 버리지 말고 **additive update**로 확장하는 것이 맞다.

- SVG 기반 캔버스, 줌/팬, 드래그 배치
- 장비 라이브러리 `LIB`
- 장비별 단자 좌표 `terminals`
- 단자 타입 `pol`
- `netHints`, `polarityCritical`
- 결선 검증
- 직각 라우팅 `routeOrtho`
- 미션 `GOALS`
- 저장/불러오기 JSON
- PNG 내보내기
- 교육용 시뮬레이션

따라서 전체를 React로 갈아엎기보다, **1차 목표는 현재 단일 HTML/SVG 구조에 레일·덕트·배전 모드를 추가**하는 것이다. 이후 코드가 커지면 React/TypeScript로 분리한다.

---

## 1. 최종 목표 화면

첨부 이미지와 같은 제어반 레이아웃을 목표로 한다.

### 1-1. 좌측 제어반 내부

1. 외곽 프레임  
   - 회색 제어반 프레임
   - 내부 설치 가능 영역
   - 문/도어 영역과 내부 판넬 영역 구분

2. 상단 DIN 레일  
   - MAIN MCCB
   - EL MCCB
   - 퓨즈홀더
   - 노이즈 필터
   - 콘센트 CD1/CD2
   - SMPS
   - 소형 분배 단자대

3. 중단 DIN 레일  
   - XBC-DR32H 또는 Mitsubishi/LS PLC
   - I/O 모듈
   - XBF-AH04A
   - 통신/확장 모듈

4. 하단 DIN 레일  
   - MC
   - EOCR
   - 릴레이
   - 단자대 스트립
   - PE/N/+24/0V 분배 단자

5. 배선덕트  
   - 상단/중단/하단 레일 사이 배선이 지나가는 통로
   - 와이어가 장비 몸체를 통과하지 않고 덕트 중심선을 따라가도록 제한

### 1-2. 우측 도어/조작판

- 비상정지
- 녹색 PB
- 적색 PB
- 황색 램프
- 셀렉터 스위치
- 키 스위치
- 도어에 설치되는 부품은 DIN 레일에 장착하지 않는다.
- 도어 앞면 이미지는 보이고, 결선은 후면 단자 좌표로 연결한다.

---

## 2. 핵심 기능 정의

## 2-1. 패널 레이아웃 모드

새 모드 이름은 다음 중 하나로 한다.

```js
S.boardMode = 'free' | 'panel-layout' | 'distribution' | 'door-panel';
```

- `free`: 기존처럼 아무 곳에 배치 가능
- `panel-layout`: DIN 레일/도어/단자대 규칙 적용
- `distribution`: 전원 분배 연습용 모드
- `door-panel`: 조작판 전용 배치 모드

처음에는 `panel-layout`을 기본값으로 두고, 실습자가 필요하면 `free`로 바꿀 수 있게 한다.

---

## 2-2. DIN 레일 객체 추가

현재는 장비만 있고 레일이 없다. 제어반 모드에서는 레일이 먼저 있어야 한다.

```js
S.rails = {
  r1: {
    id: 'r1',
    type: 'DIN35',
    label: '상단 DIN 레일',
    x: 90,
    y: 90,
    w: 1250,
    h: 32,
    locked: true,
    mountTags: ['din'],
    z: 1
  },
  r2: {
    id: 'r2',
    type: 'DIN35',
    label: 'PLC DIN 레일',
    x: 90,
    y: 380,
    w: 1250,
    h: 32,
    locked: true,
    mountTags: ['din', 'plc']
  },
  r3: {
    id: 'r3',
    type: 'DIN35',
    label: '하단 단자대 레일',
    x: 90,
    y: 690,
    w: 1250,
    h: 32,
    locked: true,
    mountTags: ['din', 'terminal']
  }
};
```

### 레일 타입

```js
const RAIL_TYPES = {
  DIN35: {
    label: '35mm DIN Rail',
    mountable: true,
    routeOnly: false,
    snapY: 'center',
    color: '#b8b8b8'
  },
  WIRE_DUCT_H: {
    label: '가로 배선덕트',
    mountable: false,
    routeOnly: true,
    channelAxis: 'x',
    color: '#e8e8e8'
  },
  WIRE_DUCT_V: {
    label: '세로 배선덕트',
    mountable: false,
    routeOnly: true,
    channelAxis: 'y',
    color: '#e8e8e8'
  },
  DOOR_PANEL: {
    label: '도어 조작판',
    mountable: true,
    routeOnly: false,
    mountTags: ['door'],
    color: '#f6f6f6'
  },
  BACK_PLATE: {
    label: '백판',
    mountable: true,
    mountTags: ['panel-screw'],
    color: '#fafafa'
  }
};
```

---

## 2-3. 장비별 장착 규칙

각 장비에 `mount` 속성을 추가한다.

```js
LIB['XBC-DR32H'].mount = {
  tags: ['din', 'plc'],
  preferredRailType: 'DIN35',
  railOffsetY: -260,
  minClearance: { left: 20, right: 20, top: 40, bottom: 60 },
  allowRotate: false
};

LIB['MDR-100'].mount = {
  tags: ['din', 'power'],
  preferredRailType: 'DIN35',
  railOffsetY: -120,
  minClearance: { left: 10, right: 10, top: 20, bottom: 40 }
};

LIB['TB10'].mount = {
  tags: ['din', 'terminal'],
  preferredRailType: 'DIN35',
  railOffsetY: -42,
  terminalStrip: true,
  allowRepeat: true
};

LIB['PB-1C'].mount = {
  tags: ['door'],
  preferredRailType: 'DOOR_PANEL',
  railOffsetY: -85,
  allowRotate: false
};
```

### 의미

- `tags`: 이 장비가 설치될 수 있는 영역
- `preferredRailType`: 기본 설치 위치
- `railOffsetY`: 레일 중심선 기준 장비 y 위치 보정
- `minClearance`: 좌우/상하 여유 공간
- `terminalStrip`: 단자대 전용 기능 사용
- `allowRepeat`: 같은 타입 여러 개 연속 배치 가능

---

## 2-4. 레일에만 배치되도록 제한

기존 `dropPaletteDevice(e)`는 캔버스 좌표에 바로 장비를 놓는다. 제어반 모드에서는 다음 흐름으로 바꾼다.

```js
function dropPaletteDevice(e) {
  const type = paletteDragTypeFromEvent(e);
  const def = LIB[type];
  if (!def) return false;

  const pt = svgPt(e);

  if (S.boardMode === 'panel-layout' || S.boardMode === 'door-panel') {
    const placement = getPlacementOnAllowedRail(type, pt);

    if (!placement.ok) {
      status(`배치 불가: ${def.label}은 ${placement.reason}`);
      flashInvalidDrop(pt);
      return false;
    }

    snapshot();
    const id = addDevice(type, placement.x, placement.y);
    S.devices[id].railId = placement.railId;
    S.devices[id].slotX = placement.slotX;
    setSingleDeviceSelection(id);
    render();
    status(`레일 배치: ${def.label} → ${placement.railLabel}`);
    return true;
  }

  // 기존 free 모드
  const x = Math.round((pt.x - def.w / 2) / 10) * 10;
  const y = Math.round((pt.y - def.h / 2) / 10) * 10;
  snapshot();
  const id = addDevice(type, x, y);
  setSingleDeviceSelection(id);
  render();
  return true;
}
```

---

## 2-5. 레일 스냅 함수

```js
function getPlacementOnAllowedRail(type, pt) {
  const def = LIB[type];
  const mount = def.mount || { tags: ['free'] };

  const candidates = Object.values(S.rails)
    .filter(rail => canMountOnRail(mount, rail))
    .map(rail => {
      const dx = clamp(pt.x, rail.x, rail.x + rail.w);
      const distY = Math.abs(pt.y - rail.y);
      return { rail, dx, distY };
    })
    .sort((a, b) => a.distY - b.distY);

  const best = candidates[0];

  if (!best || best.distY > 80) {
    return {
      ok: false,
      reason: '허용된 DIN 레일 또는 도어 영역 위에 놓아야 합니다.'
    };
  }

  const snapX = Math.round(best.dx / 10) * 10;
  const snapY = best.rail.y + (mount.railOffsetY || -def.h / 2);

  const bbox = {
    x: snapX,
    y: snapY,
    w: def.w,
    h: def.h
  };

  if (isRailOccupied(best.rail.id, bbox, type)) {
    return {
      ok: false,
      reason: '같은 레일 위의 다른 장비와 겹칩니다.'
    };
  }

  return {
    ok: true,
    railId: best.rail.id,
    railLabel: best.rail.label,
    x: snapX,
    y: snapY,
    slotX: snapX - best.rail.x
  };
}

function canMountOnRail(mount, rail) {
  const railType = RAIL_TYPES[rail.type];
  if (!railType || !railType.mountable) return false;

  const railTags = new Set([...(rail.mountTags || []), ...(railType.mountTags || [])]);
  return (mount.tags || []).some(tag => railTags.has(tag));
}
```

---

## 2-6. 같은 레일 충돌 검사

```js
function isRailOccupied(railId, bbox, type) {
  const gap = 8;

  for (const [id, dev] of Object.entries(S.devices)) {
    if (dev.railId !== railId) continue;

    const def = LIB[dev.type];
    const wh = deviceWH(dev);

    const other = {
      x: dev.x - gap,
      y: dev.y - gap,
      w: wh.w + gap * 2,
      h: wh.h + gap * 2
    };

    if (rectOverlap(bbox, other)) return true;
  }

  return false;
}

function rectOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
```

---

## 3. 배전 모드

## 3-1. 배전 모드의 목적

배전 모드는 실습자가 다음을 연습하게 만든다.

- AC 입력: L1/L2/L3/N/PE
- MCCB 이후 분기
- 퓨즈 이후 SMPS 입력
- SMPS 출력 +24V/0V
- 단자대 스트립 분배
- PE 부스바 분배
- 조작판/PLC/센서로 분기

일반 결선 모드가 “단자 대 단자 연결”이라면, 배전 모드는 **전위/potential 중심**이다.

예:

- `+24V_BUS` 선택
- 단자대 1, 3, 5, 7번에 점퍼 생성
- PLC `24V`, 센서 `V+`, 램프 `+`에 자동 색상 빨강 결선
- `0V_BUS` 선택
- PLC `COMI`, 센서 `V-`, 램프 `-`에 파랑 결선
- `PE_BUS` 선택
- SMPS FG, 접지바, 도어 FG에 녹/황선 결선

---

## 3-2. 배전 버스 데이터 구조

```js
S.distribution = {
  activeBus: null,
  buses: {
    'AC-L1': {
      label: 'AC L1',
      color: '#7a3b1a',
      pol: 'AC-L',
      sourceTerms: [
        { type: 'MCCB', term: 'T1' }
      ]
    },
    'AC-N': {
      label: 'AC N',
      color: '#2365c9',
      pol: 'AC-N',
      sourceTerms: [
        { type: 'MCCB1P', term: "N'" }
      ]
    },
    '+24V': {
      label: '+24V',
      color: '#d33',
      pol: 'DC+',
      sourceTerms: [
        { type: 'MDR-100', term: 'V+1' },
        { type: 'MDR-100', term: 'V+2' }
      ]
    },
    '0V': {
      label: '0V',
      color: '#36c',
      pol: 'DC-',
      sourceTerms: [
        { type: 'MDR-100', term: 'V-1' },
        { type: 'MDR-100', term: 'V-2' }
      ]
    },
    'PE': {
      label: 'PE',
      color: '#6b3',
      pol: 'PE',
      sourceTerms: [
        { type: 'GND-BAR', term: 'PE1' }
      ]
    }
  }
};
```

---

## 3-3. 배전 모드 UI

상단 툴바에 추가한다.

```html
<button id="m-distribution">🔌 배전</button>
<button id="bus-acl">AC-L</button>
<button id="bus-acn">AC-N</button>
<button id="bus-dcp">+24V</button>
<button id="bus-dcn">0V</button>
<button id="bus-pe">PE</button>
<button id="b-auto-jumper">점퍼 자동</button>
```

동작:

1. 사용자가 `+24V` 버튼 클릭
2. 단자대 또는 장비 단자 위에 마우스 오버
3. 같은 `pol` 또는 허용 타입이면 초록색 하이라이트
4. 클릭하면 현재 버스의 대표 단자에서 대상 단자로 결선
5. 단자대 여러 칸 선택 후 `점퍼 자동` 클릭 시 내부 bridge 생성

---

## 3-4. 단자대 점퍼 모델

단자대는 단순한 `netHints`만으로 부족하다. 점퍼는 사용자가 끼우고 빼는 부품처럼 관리되어야 한다.

```js
S.jumpers = [
  {
    id: 'j1',
    type: 'terminal-bridge',
    deviceId: 'd_tb_01',
    terms: ['1', '2', '3', '4'],
    pol: 'DC+',
    color: '#d33',
    removable: true
  }
];
```

`buildNets()`에서 와이어뿐 아니라 `S.jumpers`도 union 처리한다.

```js
for (const j of S.jumpers) {
  const base = key(j.deviceId, j.terms[0]);
  for (const term of j.terms.slice(1)) {
    union(base, key(j.deviceId, term));
  }
}
```

---

## 4. 단자대 정확도 강화

## 4-1. 단자대는 이미지 하나로 처리하지 말고 생성형으로 만든다

현재 `TB10`처럼 이미지를 하나 박아두면 10P, 20P, 30P, PE/N 분리형을 만들 때 계속 이미지가 필요하다. 단자대는 SVG 생성형이 더 정확하다.

```js
function createTerminalStrip({
  id,
  count,
  startNo = 1,
  pitch = 26,
  rows = 2,
  labelPrefix = '',
  pol = 'NEUTRAL',
  bridgeable = true
}) {
  const terminals = [];

  for (let i = 0; i < count; i++) {
    const n = startNo + i;
    const x = 20 + i * pitch;

    terminals.push({
      id: `${n}`,
      x,
      y: 18,
      side: 'T',
      label: `${labelPrefix}${n}`,
      pol
    });

    terminals.push({
      id: `${n}'`,
      x,
      y: 62,
      side: 'B',
      label: `${labelPrefix}${n}'`,
      pol
    });
  }

  return {
    cat: 'wiring',
    label: `${count}P 단자대`,
    sub: '생성형 관통 단자대',
    w: 40 + (count - 1) * pitch,
    h: 82,
    color: '#666',
    icon: 'tb',
    generatedTerminalStrip: true,
    terminals,
    netHints: Array.from({ length: count }, (_, i) => {
      const n = startNo + i;
      return [`${n}`, `${n}'`];
    })
  };
}
```

---

## 4-2. 단자대 종류

필수로 추가할 단자대:

- 일반 관통 단자대 4P / 8P / 10P / 20P / 30P
- PE 전용 단자대
- N 전용 단자대
- +24V 분배 단자대
- 0V 분배 단자대
- 3상 R/S/T/N/PE 입력 단자대
- 센서 입력 단자대
- 도어 조작판 연결 단자대

---

## 4-3. 단자 위치는 “보이는 그림”보다 “나사 중심 좌표”가 우선

장비 이미지는 예쁘게 보여주는 용도이고, 실제 클릭 판정은 다음 데이터가 기준이다.

```js
{
  id: 'P00',
  x: 193,
  y: 141,
  side: 'T',
  label: 'P00',
  pol: 'DI',
  screwLayer: 2,
  terminalBlock: 'INPUT_LOWER',
  manualRef: 'XBC-DR32H terminal map',
  verified: true
}
```

필수 필드:

- `id`: 코드상 고유 단자명
- `label`: 화면 표시
- `x`, `y`: 나사 중심 좌표
- `pol`: 전기적 타입
- `side`: 라벨/와이어 lead-out 방향
- `terminalBlock`: 같은 단자대 묶음
- `manualRef`: 근거 문서
- `verified`: 수동 검수 여부
- `layer`: 1층/2층/앞/뒤 등 다층 단자일 때

---

## 5. 배선덕트 기반 라우팅

## 5-1. 현재 문제

지금은 직각선이 장비 사이를 가로질러 지나갈 수 있다. 첨부 이미지처럼 만들려면 배선은 다음 경로를 따라야 한다.

1. 단자에서 짧게 빠져나옴
2. 가장 가까운 배선덕트 중심선으로 진입
3. 배선덕트 내부를 따라 이동
4. 대상 장비 근처 덕트에서 빠져나옴
5. 대상 단자로 진입

---

## 5-2. 배선덕트 객체

```js
S.ducts = {
  duct_top: {
    id: 'duct_top',
    type: 'WIRE_DUCT_H',
    x: 80,
    y: 250,
    w: 1300,
    h: 55,
    channelY: 277,
    color: '#eeeeee'
  },
  duct_mid: {
    id: 'duct_mid',
    type: 'WIRE_DUCT_H',
    x: 80,
    y: 565,
    w: 1300,
    h: 55,
    channelY: 592
  },
  duct_left: {
    id: 'duct_left',
    type: 'WIRE_DUCT_V',
    x: 55,
    y: 70,
    w: 45,
    h: 830,
    channelX: 78
  },
  duct_right: {
    id: 'duct_right',
    type: 'WIRE_DUCT_V',
    x: 1380,
    y: 70,
    w: 45,
    h: 830,
    channelX: 1402
  }
};
```

---

## 5-3. 덕트 라우팅 함수

기존 `routeOrtho()`는 유지하되, 제어반 모드에서는 별도 함수를 먼저 시도한다.

```js
function routePanelWire(p1, p2, wire) {
  const entry1 = nearestDuctEntry(p1);
  const entry2 = nearestDuctEntry(p2);

  if (!entry1 || !entry2) {
    return routeOrtho(p1, p2, 20, 20, wire.waypoints, [wire.from.dev, wire.to.dev]);
  }

  const ductPath = findDuctPath(entry1, entry2);

  return pointsToSvgPath([
    p1,
    leadOutPoint(p1),
    entry1.point,
    ...ductPath,
    entry2.point,
    leadInPoint(p2),
    p2
  ]);
}
```

---

## 5-4. A* 라우팅

복잡해지면 배선덕트를 그리드로 만들고 A*를 사용한다.

추천 후보:

- `bgrins/javascript-astar`  
  - 단순 MIT A* 구현
  - 직접 수정하기 쉬움
- `PathFinding.js`  
  - 기능은 많지만 라이선스/관리 상태를 먼저 확인해야 함

그리드 규칙:

```js
const gridCell = 10;

// 통과 가능
// - 배선덕트 내부
// - 단자 lead-out 구간
// - 빈 공간 중 허용된 channel

// 통과 불가
// - 장비 bbox
// - 제어반 프레임
// - 다른 레일 위 장비 영역
// - 도어 외부
```

---

## 6. 제어반 템플릿

## 6-1. 템플릿 데이터

```js
const PANEL_TEMPLATES = {
  basic_3rail_door: {
    label: '기본 3단 레일 + 도어 조작판',
    cabinet: { x: 40, y: 40, w: 1450, h: 900 },
    rails: [
      { id: 'rail_top', type: 'DIN35', label: '상단 전원 레일', x: 110, y: 130, w: 1180, h: 32, mountTags: ['din', 'power'] },
      { id: 'rail_mid', type: 'DIN35', label: '중단 PLC 레일', x: 110, y: 430, w: 1180, h: 32, mountTags: ['din', 'plc'] },
      { id: 'rail_bottom', type: 'DIN35', label: '하단 단자대 레일', x: 110, y: 735, w: 1180, h: 32, mountTags: ['din', 'terminal'] }
    ],
    ducts: [
      { id: 'duct_top', type: 'WIRE_DUCT_H', x: 95, y: 285, w: 1210, h: 55 },
      { id: 'duct_mid', type: 'WIRE_DUCT_H', x: 95, y: 590, w: 1210, h: 55 },
      { id: 'duct_left', type: 'WIRE_DUCT_V', x: 70, y: 90, w: 45, h: 760 },
      { id: 'duct_right', type: 'WIRE_DUCT_V', x: 1290, y: 90, w: 45, h: 760 }
    ],
    doorPanel: {
      id: 'door_right',
      type: 'DOOR_PANEL',
      label: '우측 조작판',
      x: 1540,
      y: 150,
      w: 210,
      h: 650,
      mountTags: ['door']
    }
  }
};
```

---

## 6-2. 템플릿 적용 버튼

```html
<button id="tpl-basic-panel">📦 기본 제어반</button>
<button id="tpl-power-plc-door">⚡ 전원+PLC+도어</button>
<button id="tpl-clear-wires">와이어만 삭제</button>
```

```js
function applyPanelTemplate(templateId) {
  const tpl = PANEL_TEMPLATES[templateId];
  if (!tpl) return;

  snapshot();
  S.cabinet = structuredClone(tpl.cabinet);
  S.rails = Object.fromEntries(tpl.rails.map(r => [r.id, structuredClone(r)]));
  S.ducts = Object.fromEntries(tpl.ducts.map(d => [d.id, structuredClone(d)]));
  S.doorPanel = structuredClone(tpl.doorPanel);
  S.boardMode = 'panel-layout';

  render();
  zoomFit();
}
```

---

## 7. 장비별 추가/수정 우선순위

## 7-1. 전원/보호

- MAIN MCCB 3P
- EL MCCB 2P 또는 4P
- 퓨즈홀더 2P
- 노이즈 필터 NF
- SMPS MDR-100
- AC 230V 콘센트 CD1/CD2
- PE 부스바
- N 부스바
- DC +24V / 0V 분배 단자대

## 7-2. PLC/I-O

- LS XBC-DR32H
- XBF-AH04A
- XBF-DV04A 또는 DI/DO 확장 모듈
- Mitsubishi FX/MTBUBISHI 타입 베이스는 별도 장비군으로
- 통신 모듈 RS-485/RS-232

## 7-3. 구동/부하

- MC-22b AC/DC 코일 버전 분리
- EOCR 슈나이더/LS 버전 분리
- iG5A 인버터
- 3상 모터
- 서보 드라이브
- 브레이크 서보모터
- 솔레노이드 밸브

## 7-4. 조작판

- 녹색 PB
- 적색 PB
- 황색 PB
- 비상정지
- 2단 셀렉터
- 3단 셀렉터
- 키 스위치
- 램프 녹/적/황/백
- 부저

## 7-5. 단자대

- 관통 단자대
- PE 단자대
- N 단자대
- 퓨즈 단자대
- 센서 단자대
- 도어 입출력 단자대
- 점퍼바
- 엔드 스토퍼
- 마킹 태그

---

## 8. 오픈소스 후보

## 8-1. 현재 단일 HTML/SVG 구조 유지 시 추천

| 오픈소스 | 용도 | 추천도 | 라이선스 메모 | 링크 |
|---|---:|---:|---|---|
| interact.js | 드래그, 스냅, restriction, dropzone | 최우선 | MIT | https://github.com/taye/interact.js |
| SVG.js | SVG 조작/그룹/애니메이션 정리 | 높음 | MIT | https://github.com/svgdotjs/svg.js |
| bgrins/javascript-astar | 배선덕트 A* 라우팅 | 중간 | MIT | https://github.com/bgrins/javascript-astar |
| RBush | 충돌/근접 검색 최적화 | 중간 | MIT | https://github.com/mourner/rbush |
| SAT.js | 복잡한 충돌 판정 | 낮음~중간 | MIT | https://github.com/jriecken/sat-js |
| dagre | 자동 배치/정렬 참고 | 낮음 | MIT | https://github.com/dagrejs/dagre |

### 결론

현재 HTML에는 직접 SVG와 이벤트 코드가 이미 있으므로, 가장 실용적인 조합은 다음이다.

```txt
현재 SVG 코드 유지
+ interact.js: 레일 dropzone, snap, restriction
+ RBush: 장비 bbox 충돌 빠른 검색
+ bgrins/javascript-astar: 덕트 기반 배선 경로 찾기
+ SVG.js: 렌더 코드가 너무 커질 때만 점진 도입
```

---

## 8-2. React/TypeScript로 재구축할 때 추천

| 오픈소스 | 용도 | 추천도 | 라이선스 메모 | 링크 |
|---|---:|---:|---|---|
| xyflow / React Flow | 노드 기반 UI, 포트/엣지, 미니맵 | 높음 | MIT | https://github.com/xyflow/xyflow |
| diagram-js | BPMN식 다이어그램 편집기 기반 | 높음 | MIT | https://github.com/bpmn-io/diagram-js |
| JointJS | 고급 다이어그램/포트 모델 | 중간 | MPL-2.0 | https://github.com/clientio/joint |
| Konva | Canvas 기반 고성능 에디터 | 중간 | MIT 계열로 알려짐, 확인 필요 | https://github.com/konvajs/konva |
| Fabric.js | 객체 기반 Canvas 에디터 | 중간 | MIT 계열로 알려짐, 확인 필요 | https://github.com/fabricjs/fabric.js |
| ELK.js | 포트 기반 자동 레이아웃 | 중간 | EPL-2.0 | https://github.com/kieler/elkjs |

### 결론

React Flow는 노드/엣지에는 좋지만, **실물 제어반의 레일 제약·배선덕트·단자 나사 좌표**까지 가려면 커스텀이 많다.  
따라서 2단계 개편에서는 `diagram-js` 또는 `React Flow + 커스텀 SVG 레이어`가 현실적이다.

---

## 8-3. 전기 도면/PLC 참고용 오픈소스

| 오픈소스 | 용도 | 주의 | 링크 |
|---|---|---|---|
| QElectroTech | 산업 전기 도면 심볼/구성 참고 | GPL. 코드 복붙 주의 | https://github.com/qelectrotech/qelectrotech-source-mirror |
| OpenPLC Editor | IEC 61131-3/래더/PLC 구조 참고 | GPL 계열. 코드 복붙 주의 | https://github.com/thiagoralves/OpenPLC_Editor |
| KiCad | 회로/넷리스트/심볼 관리 개념 참고 | GPL. 구조 참고 중심 | https://gitlab.com/kicad/code/kicad |
| ladder-logic-editor | 웹 기반 래더 UI 참고 | 라이선스 확인 후 사용 | https://github.com/cdilga/ladder-logic-editor |

### 결론

위 프로젝트들은 직접 가져다 붙이는 용도보다, **심볼 관리 방식, 넷리스트 구조, 도면 검증 방식**을 참고하는 용도가 맞다. 특히 GPL 계열 코드를 현재 HTML에 그대로 복사하면 배포 조건이 복잡해질 수 있으므로 주의한다.

---

## 9. 구현 단계

## Phase 1. 제어반 프레임/레일/덕트 렌더링

목표:

- 첨부 이미지처럼 제어반 외곽 프레임 생성
- 상/중/하 DIN 레일 생성
- 가로/세로 배선덕트 생성
- 우측 도어 조작판 영역 생성
- 저장/불러오기 JSON에 `cabinet`, `rails`, `ducts`, `doorPanel` 포함

작업 파일:

- 현재 단일 HTML이면 `index.html` 안에 추가
- 분리한다면 `src/panel-layout.js`

체크리스트:

- [ ] `S.rails` 추가
- [ ] `S.ducts` 추가
- [ ] `S.cabinet` 추가
- [ ] `renderCabinet()`
- [ ] `renderRails()`
- [ ] `renderDucts()`
- [ ] `renderDoorPanel()`
- [ ] 저장/불러오기 반영

---

## Phase 2. 레일 배치 제한

목표:

- DIN 레일 장비는 DIN 레일 위에만 배치
- 도어 부품은 도어 영역에만 배치
- 배선덕트에는 장비 배치 불가
- 같은 레일에서 장비끼리 겹치면 배치 불가
- 드래그 이동 중에도 레일에 스냅

체크리스트:

- [ ] 장비별 `mount` 추가
- [ ] `canMountOnRail()`
- [ ] `getPlacementOnAllowedRail()`
- [ ] `isRailOccupied()`
- [ ] `dropPaletteDevice()` 수정
- [ ] `draggingDev` 이동 로직 수정
- [ ] 유효 위치 초록 하이라이트
- [ ] 무효 위치 빨간 하이라이트

---

## Phase 3. 생성형 단자대

목표:

- 4P/10P 이미지 고정 방식에서 벗어나 생성형 단자대 도입
- 20P/30P/PE/N/+24/0V 단자대 쉽게 추가
- 점퍼바 삽입 가능
- 단자 번호/나사 위치 정확히 표현

체크리스트:

- [ ] `createTerminalStrip()`
- [ ] `LIB['TB20']`, `LIB['TB30']`
- [ ] `LIB['TB-PE-10']`
- [ ] `LIB['TB-24V-10']`
- [ ] `LIB['TB-0V-10']`
- [ ] `S.jumpers`
- [ ] `renderJumpers()`
- [ ] `buildNets()`에 점퍼 union 추가
- [ ] 단자대 번호 자동 라벨

---

## Phase 4. 배전 모드

목표:

- `+24V`, `0V`, `PE`, `AC-L`, `AC-N` 버스 선택
- 선택한 버스와 호환되는 단자만 하이라이트
- 단자대 여러 칸에 점퍼 자동 생성
- 버스별 와이어 색 자동 적용
- 배전 실습 미션 추가

체크리스트:

- [ ] `S.distribution`
- [ ] `setActiveBus(busId)`
- [ ] `canConnectBusToTerm(busId, dev, term)`
- [ ] `connectBusToTerm(busId, dev, term)`
- [ ] `autoJumperTerminalStrip(deviceId, terms, busId)`
- [ ] UI 버튼 추가
- [ ] 미션 `전원 배전`, `PLC 24V 배전`, `도어 조작판 배전`

---

## Phase 5. 배선덕트 라우팅

목표:

- 와이어가 장비 몸체를 통과하지 않음
- 가능한 덕트 중심선을 따라 라우팅
- 와이어 클릭 시 경로 수동 보정 가능
- 배선 색/굵기/라벨 적용

체크리스트:

- [ ] `nearestDuctEntry()`
- [ ] `findDuctPath()`
- [ ] `routePanelWire()`
- [ ] `renderWireLabels()`
- [ ] `wire.crossSection`
- [ ] `wire.label`
- [ ] `wire.bundleId`
- [ ] 와이어 덕트 외부 이탈 품질 경고

---

## Phase 6. 검증 강화

목표:

- 위험 오결선
- 기능 오결선
- 품질 경고
- 배치 오류
- 단자대 점퍼 오류
- 도어/내부 연결 누락
- 배선덕트 외부 라우팅 경고

검증 항목:

```js
const PANEL_VALIDATION_RULES = [
  {
    id: 'device_must_be_on_allowed_rail',
    severity: 'function',
    message: '장비가 허용된 레일/도어 영역에 설치되지 않았습니다.'
  },
  {
    id: 'device_overlap_on_same_rail',
    severity: 'quality',
    message: '같은 DIN 레일 위 장비가 겹칩니다.'
  },
  {
    id: 'wire_outside_duct',
    severity: 'quality',
    message: '와이어가 배선덕트 외부를 길게 지나갑니다.'
  },
  {
    id: 'terminal_strip_missing_label',
    severity: 'quality',
    message: '단자대 번호 또는 와이어 넘버가 누락되었습니다.'
  },
  {
    id: 'door_device_without_terminal_strip',
    severity: 'function',
    message: '도어 조작판 부품이 내부 단자대 경유 없이 직접 배선되었습니다.'
  }
];
```

---

## Phase 7. 실습 미션

새로운 미션 예시:

### 미션 A. 기본 제어반 배치

- MCCB는 상단 전원 레일
- SMPS는 상단 전원 레일
- PLC는 중단 PLC 레일
- 단자대는 하단 단자대 레일
- PB/램프는 도어 조작판

### 미션 B. AC → SMPS → DC24V 배전

- MCCB T1 → 퓨즈 L-IN
- 퓨즈 L-OUT → SMPS L
- MCCB T2/N → 퓨즈 N-IN
- 퓨즈 N-OUT → SMPS N
- SMPS FG → PE 부스바
- SMPS +V → +24V 단자대
- SMPS -V → 0V 단자대

### 미션 C. PLC 입력 배선

- +24V 단자대 → PB NO 11
- PB NO 12 → 하단 단자대 X0
- 하단 단자대 X0' → PLC P00
- 0V 단자대 → PLC COMI

### 미션 D. 도어 조작판 경유 배선

- 도어 PB를 PLC에 직접 연결하지 않고 하단 단자대를 경유
- 도어 램프도 하단 단자대를 경유
- 도어-내부 케이블은 다심 케이블처럼 묶어서 표현

---

## 10. Codex에게 줄 작업 지시문

아래 내용을 그대로 Codex에게 붙여 넣으면 된다.

```txt
현재 프로젝트는 단일 HTML 기반의 제어반 결선 교육 시뮬레이터다.
기존 index.html의 LIB, terminals, GOALS, routeOrtho, buildNets, validate, save/load 구조는 버리지 말고 additive update로 확장한다.

목표:
1. 첨부 이미지처럼 제어반 내부에 DIN 레일과 배선덕트를 만들고,
2. 장비는 허용된 레일/도어 영역에만 배치되게 하며,
3. 배전 모드(+24V, 0V, PE, AC-L, AC-N)를 추가하고,
4. 단자대는 생성형 terminal strip으로 만들며,
5. 와이어는 가능한 배선덕트 중심선을 따라 라우팅되도록 한다.

필수 제약:
- 기존 장비 단자 좌표와 검증 로직을 삭제하지 말 것.
- 실제 PLC 제어 기능은 추가하지 말 것.
- 교육용 시뮬레이터 문구는 유지할 것.
- 외부 라이브러리를 추가하더라도 우선은 CDN 없이 현재 코드만으로 동작하게 만들 것.
- 라이브러리 도입은 interact.js/RBush/A* 정도를 선택 옵션으로 남기고, 첫 패치는 순수 JS로 작성할 것.
- 저장 JSON에 cabinet, rails, ducts, doorPanel, jumpers, boardMode를 포함할 것.
- 기존 저장 파일이 깨지지 않도록 기본값을 자동 생성할 것.
- 긴 테스트 금지. 브라우저 로딩, 배치, 저장/불러오기, 기본 미션 검증까지만 빠르게 확인할 것.

1차 구현 범위:
- S.boardMode 추가
- S.cabinet, S.rails, S.ducts, S.doorPanel 추가
- renderCabinet, renderRails, renderDucts, renderDoorPanel 추가
- 장비 mount 메타데이터 추가
- getPlacementOnAllowedRail, canMountOnRail, isRailOccupied 추가
- dropPaletteDevice와 draggingDev 이동 로직에 레일 스냅 적용
- 기본 템플릿 basic_3rail_door 추가
- 툴바에 “제어반 모드 / 자유 모드 / 기본 제어반” 버튼 추가
- 배치 오류를 validation에 표시

2차 구현 범위:
- 생성형 단자대 createTerminalStrip 추가
- TB20, TB30, TB-PE, TB-24V, TB-0V 추가
- S.jumpers 추가
- 단자대 점퍼 렌더링 및 net union 추가

3차 구현 범위:
- distribution mode 추가
- +24V/0V/PE/AC-L/AC-N 버스 선택 UI
- 호환 단자 하이라이트
- 버스 연결/점퍼 자동 생성
- 배전 미션 추가

4차 구현 범위:
- 배선덕트 기반 routePanelWire 추가
- 장비 bbox obstacle 회피
- 덕트 외부 장거리 배선 품질 경고
```

---

## 11. 구현 우선순위 결론

가장 먼저 할 일은 이미지 퀄리티를 더 올리는 것이 아니라 **배치 규칙과 단자 데이터 구조**를 고치는 것이다.

우선순위:

1. **DIN 레일/도어 영역 제약**
2. **장비 mount 메타데이터**
3. **생성형 단자대**
4. **배전 모드**
5. **배선덕트 라우팅**
6. **미션/검증 강화**
7. **장비 이미지 고도화**

이미지는 단자 좌표를 대체하면 안 된다. 이미지는 “보기 좋게 보여주는 스킨”이고, 실제 결선 정확도는 `terminals[]`, `netHints`, `jumpers`, `validation rules`가 책임져야 한다.

---

## 12. 추천 기술 선택

### 지금 바로 가는 선택

```txt
현재 index.html 유지
+ 순수 JS로 S.rails/S.ducts/S.jumpers/S.distribution 추가
+ 필요한 경우 interact.js만 추가
```

이게 가장 안전하다.

### 나중에 큰 프로젝트가 되면

```txt
React + TypeScript
+ React Flow 또는 diagram-js
+ 커스텀 SVG/Canvas overlay
+ JSON 장비 데이터 분리
+ missions/*.json 분리
```

하지만 지금 단계에서 React로 갈아엎으면 기존 단자 좌표와 검증 로직을 다시 옮기느라 시간이 많이 든다. 우선은 현재 HTML을 살려서 “현장 실습감”을 만드는 쪽이 맞다.
