# Wiring Trainer Upgrade Research

조사일: 2026-07-08

업데이트: 2026-07-09

## 2026-07-29 MY2N-D2 공식 근거 반영

아래의 과거 제거 목록 중 `MY2N`은 OMRON 공식 `J219-E1-22`의 PDF 8, 10, 20쪽을 대조해 정확 프로필로 복구했다. 기존 `my2n-flat.png` 자산은 교체하지 않고, SVG 단자 오버레이와 회로 엔진만 공식 bottom-view에 맞췄다.

- 코일: `14=+24V`, `13=0V` (D2 내장 다이오드로 역극성 금지)
- 무여자 b접(NC): `9-1`, `12-4`
- 여자 a접(NO): `9-5`, `12-8`
- 코일: DC24V, 36.3mA, 662Ω, 동작전압 80% 이하
- 접점: 2c(DPDT), 저항부하 5A(220VAC/24VDC)
- 근거 파일: `pdf/official/Omron_MY_Series_J219-E1.pdf`
- SHA-256: `2C422A3BA468E3140CE4D3D8D716F6C11AD11A842CA1999F5E7339847170242D`

자산/단자 클릭 승인이 끝날 때까지 자산 매니페스트 상태는 `pending`이며, 사전 결선 검토 리포트는 fail-closed로 유지한다.

## 제거 대상 처리

아래 목록은 2026-07-08 당시의 제거 대상이다. 기존 저장 파일 호환을 위해 `LIB` 정의 자체는 남겼으며, 위 업데이트처럼 공식 근거가 확보된 장비는 이후 개별적으로 복구한다.

- MCCB 2P (`MCCB1P`)
- 단일 퓨즈홀더 (`FUSE-1`)
- MY2N-D2 (`MY2N`, 2026-07-29 공식 프로필로 복구)
- 푸시버튼 NO (`PB-NO`)
- 푸시버튼 NC (`PB-NC`)
- 비상정지 (`EMSTOP`)
- 리미트 스위치 (`LIMIT`)
- 광전센서 (`PHOTO`)
- PT100 RTD (`PT100`)
- 접지 부스바 (`GND-BAR`)

## 2026-07-09 이미지/단자 업데이트

새 GPT/Codex 생성 이미지는 `assets/devices/codex/`에 저장했다. 모든 보이는 장비는 신규 작업 기준으로 `/codex/` 자산을 사용하며, AI 이미지 안의 작은 글자는 신뢰하지 않고 HTML 단자 라벨을 별도로 렌더링한다.

주요 생성 파일:

- `codex-device-sheet.png`: MCCB, 퓨즈홀더, MDR-100, XBC-DR32H, XBF-AH04A, iG5A, EXP2-700, MC, EOCR, PB-1C, 셀렉터, TB10 원본 시트
- `codex-motion-sensor-sheet.png`: 위치결정 모듈, 서보 드라이브/모터, 리니어 레일, PSU24, 타이머/카운터/플리커, 솔레노이드, 실린더, 모터, 근접센서, 엔코더, 램프, 버저 원본 시트
- `*-codex.png`: 위 시트에서 개별 컷아웃 후 투명 배경 처리한 장비 이미지
- `lamp-*-codex-clean.png`, `buzzer-codex-clean.png`, `md02-codex.png`: 색/단자 정확도가 필요한 소형 부품은 Codex/PIL로 직접 생성

검증 결과:

- 보이는 장비 36개 모두 이미지 있음
- 보이는 장비 36개 모두 `/assets/devices/codex/` 이미지 사용
- 제거 대상 10개는 팔레트/검색/미션 자동배치에서 숨김 유지
- g11 서보 미션 자동결선 후 위험/기능/품질 오류 0개
- 자동배치는 기존 장비와 겹치지 않도록 현재 장비 아래 빈 영역부터 배치

## GitHub 오픈소스 후보

| 후보 | 용도 | 판단 |
| --- | --- | --- |
| xyflow / React Flow | 부품을 노드, 단자를 handle, 배선을 edge로 관리 | 전체 React 전환 시 가장 강력한 후보. 멀티 단자/선택/미니맵/줌에 강함. 현재 단일 HTML 구조에는 이식 비용 큼. |
| jsPlumb Community Edition | HTML 요소 사이 endpoint/connector 구현 | 현재 단일 HTML을 유지하면서 결선 UX만 교체할 때 현실적. 단, 저장소가 더 이상 업데이트되지 않는다고 명시됨. |
| elkjs | 단자/부품 자동정렬, 미션 자동배치 보강 | 렌더링 엔진이 아니라 레이아웃 계산 전용. 현재 SVG 렌더러와 같이 쓰기 좋음. |
| diagram-js | 웹 diagram editor 기반 구조 | 커스텀 산업용 다이어그램 에디터로 키울 때 참고 가치 있음. 현재 앱에 바로 끼우기엔 구조 변경 큼. |
| draw.io | 클라이언트 사이드 다이어그램/스텐실/내보내기 참고 | 시뮬레이터 엔진보다는 대형 다이어그램 편집 UX 참고용. |
| OpenCircuits / CircuitSim-Web | 회로 편집/시뮬레이션 참고 | 전기 회로 시뮬레이션 아이디어 참고용. 산업 제어반 단자 연습에는 직접 적용 범위 제한적. |

추천 순서:

1. 현 구조 유지: `elkjs`로 자동정렬 보강 + 현재 SVG 배선 엔진 개선.
2. 배선 UX만 대폭 개선: `jsPlumb`를 별도 실험 브랜치에서 endpoint/connector 엔진으로 검증.
3. 장기 리빌드: `React Flow` 기반으로 `devices`, `terminals`, `wires`, `mission JSON`을 타입화해서 재구성.

## 남은 장비별 매뉴얼/참고자료

| 앱 장비 | 기준 자료 | 이미지/단자 보정 메모 |
| --- | --- | --- |
| XBC-DR32H | LS ELECTRIC XBC H, XBM-S Type User Manual / XBC-XEC H-Type product page | 전면 단자대는 XBC-DR32H 전용 도면을 기준으로 24V/24G, PE, P00~P0F, P20~2F, P30~3F 재확인 필요. |
| XBF-AH04A | LS ELECTRIC XGB Analog Module User Manual / XBF-AH04A Data Sheet / Installation Guide | 2AI+2AO, 외부 24V, 전압/전류 선택 스위치, 11점 단자대 위치를 기준으로 전면 이미지 재작업. |
| SV-iG5A | LS ELECTRIC iG5A Series User Manual / product page | P1~P8, CM, 24, VR/V1/I/AM, MO/MG, 3A/3B/3C, R/S/T, U/V/W, B1/B2 위치 기준으로 보정. |
| MDR-100-24 | MEAN WELL MDR-100 datasheet / DIN rail installation manual | L/N/FG, +V/-V, DC OK relay 접점과 DIN rail 전면 비율을 기준으로 이미지/단자 좌표 보정. |
| EXP2-700 | LS ELECTRIC eXP2 Series User Manual / eXP2 product page | 앱의 `CIMON Xpanel Hybrid` 표기와 `eXP2-0700D` 계열이 섞여 있음. 실제 장비가 LS eXP2-0700D면 LS 자료를 기준으로 재명명 필요. 실제 CIMON Hybrid Xpanel이면 CIMON Hybrid Xpanel manual을 따로 기준화. |
| Schneider EOCR-SS | Schneider EOCRSS product page / EOCR-SS manual or datasheet | A1/A2, 95/96/97/98, reset/test, 관통 CT 방향과 전면 노브 위치 보정. |
| LS MC 전자접촉기 | LS Contactors and Overload Relays catalog / technical manual | 1L1-2T1, 3L2-4T2, 5L3-6T3, A1/A2, 13/14, 21/22 위치 보정. |
| MCCB 3P | LS Susol MCCB catalog / product page | 실제 모델이 미정이라 3P MCCB 일반형으로만 가능. 정확한 LS/Schneider/현대 모델명을 정하면 전면 비율과 단자 구멍 위치를 더 정확히 잡을 수 있음. |
| 1축 위치결정 모듈 | LS XBF-PD02A positioning module manual / product page | 현재 앱은 교육용 1축으로 단순화됨. 실제 XBF-PD02A는 2축 40핀 계열이므로 실제 단자대/링크보드 모델을 확정해야 함. |
| 서보 드라이브/서보모터 | LS L7/L7NH/L7S servo manuals | 앱 모델은 교육용 일반 모델. 실제 드라이브 모델을 정해야 CN1/CN2/CN3, STO, 엔코더, 브레이크 단자 좌표를 확정 가능. |
| TB4/TB10, 퓨즈홀더, 램프/버저, 셀렉터/PB-1C, 근접센서, 실린더, 모터, 타이머/카운터, MD02 | 제조사/모델 미지정 | 실제와 똑같은 이미지 제작을 하려면 각 부품의 제조사와 모델명을 먼저 정해야 함. 현재는 교육용 일반 형상 기준으로만 정확도를 높일 수 있음. |

## 확인된 기준 링크

- https://github.com/xyflow/xyflow
- https://github.com/jsplumb/community-edition
- https://github.com/kieler/elkjs
- https://github.com/bpmn-io/diagram-js
- https://github.com/jgraph/drawio
- https://github.com/OpenCircuits/OpenCircuits
- https://github.com/jananour00/CircuitSim-Web
- https://www.ls-electric.com/products/view/Smart_Automation_Solution/PLC/XGB_Series/XBC_XEC_H-Type
- https://sol.ls-electric.com/ww/en/product/document/2939
- https://sol.ls-electric.com/product/document/3015
- https://sol.ls-electric.com/ww/en/product/document/2428
- https://www.ls-electric.com/products/view/Smart_Automation_Solution/AC_Drive_-*VFD*-/Low_Voltage_VFD/iG5A
- https://ssq.ls-electric.com/ww/en/product/document/2514
- https://www.meanwell.com/Upload/PDF/MDR-100/MDR-100-SPEC.PDF
- https://www.meanwell.com/Upload/PDF/MDR%20DIN%20rail.pdf
- https://sol.ls-electric.com/ww/en/product/document/2990
- https://www.lselectricamerica.com/all-products/automation-4/exp-series-2/
- https://www.cimon.com/resources
- https://s3.amazonaws.com/cimon-wp/wp-content/uploads/2017/12/02045554/Hybrid_Xpanel_Usermanual.pdf
- https://www.se.com/eg/en/product/EOCRSS-05S/electronic-overcurrent-relay-0-5-6-a-220-v-ac/
- https://www.ls-electric.com/upload/customer/download/1450/MC.pdf
- https://www.ls-electric.com/products/view/Smart_Power_Solution/Low_Voltage/MCCB_%26_ELCB/Susol_MCCB
- https://www.ls-electric.com/products/view/Smart_Automation_Solution/PLC/XGB_Series/XGB_Motion_%26_Positioning_module
- https://sol.ls-electric.com/uploads/document/16411761232600/XBF-PD02A_Manual_V1.6_202012_EN.pdf
- https://www.ls-electric.com/products/category/Smart_Automation_Solution/Servo%21Motion/Servo_Drive
