# 매뉴얼 기반 장비 확장 및 배선·시뮬레이션 개선 기록

작성일: 2026-08-05
대상 버전: v2.2.0

## 1. 작업 목적

제어반 편집기에 장비 그림만 추가하는 것이 아니라 다음 정보를 한 묶음으로 구현했다.

- 실제 단자 수와 단자명
- 입력/출력 공통 방식
- 외부 DC24V 전원 필요 여부
- 릴레이·싱크·소스 출력 동작 방식
- RS-485 A/B 극성
- 아날로그 채널 +/- 완전성
- RTD 3선식 A/B/b 완전성
- 시뮬레이션 전원 활성 조건
- 이전 프로젝트 JSON 호환

단자 표기는 생성 이미지에 직접 굽지 않고 코드 오버레이로 표시한다. 생성 이미지의 글자 오차가 결선 ID에 영향을 주지 않게 하기 위한 구조다.

## 2. 참고한 프로젝트 내 매뉴얼

| 구분 | 파일 | 주요 확인 위치 |
|---|---|---|
| XGB 디지털 증설 | `pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf` | XBE-DC32A, RY16A, TN16A, TP16A, DR16A 외부 결선도 |
| XGB 아날로그·온도 | `pdf/03_LS_XGB_Analog_Manual_KR.pdf` | AD04A 2장, DV/DC04A 3장, RD04A 4장, TC04S 5장, AD08A 7장 |
| MDR 전원 | `pdf/01_MDR-100-24_MeanWell_SPEC.pdf` | AC 입력, 24V/4A 출력, 복수 +V/-V 단자 |
| XBC 본체 | `pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf` | 본체 L/N과 입력부 24V/24G 구분, RS-485 단자 |
| XY-MD02 | `pdf/06_XY-MD02_TempHumidity_Modbus_Manual.pdf` | V+/V-, A+/B- |

## 3. 추가 장비

### 3.1 디지털 증설 모듈

| 장비 | 구현 단자 | 기능 메타데이터 |
|---|---|---|
| `XBE-DC32A` | 입력 `00~1F`, COM 4핀 | 32점 DC24V 입력, 32점/COM, 40핀 커넥터 |
| `XBE-RY16A` | 출력 `0~F`, COM 2개 | 릴레이 16점, 8점/COM 2그룹 |
| `XBE-TN16A` | 출력 `0~F`, `DC12/24V`, `COM/0V` | 싱크 출력, ON 시 출력점을 COM으로 연결 |
| `XBE-TP16A` | 출력 `0~F`, `COM/+24V`, `0V` | 소스 출력, ON 시 +공통을 출력점으로 연결 |
| `XBE-DR16A` | 입력 8점/COM, 릴레이 출력 8점/COM | 입력과 출력 공통을 별도 그룹으로 검사 |

시뮬레이션 중 출력 단자를 클릭하면 해당 출력이 강제 ON/OFF 된다. 릴레이 출력은 해당 그룹 COM과 내부 접점이 닫히고, 트랜지스터 출력은 외부전원이 유효할 때만 동작한다.

### 3.2 아날로그 및 온도 모듈

| 장비 | 단자 구성 | 구현 범위 |
|---|---|---|
| `XBF-AD04A` | CH0~CH3 +/- + DC24V +/- | 전압/전류 입력 4채널 |
| `XBF-DV04A` | CH0~CH3 +/- + DC24V +/- | 전압 출력 4채널 |
| `XBF-DC04A` | CH0~CH3 +/- + DC24V +/- | 전류 출력 4채널 |
| `XBF-RD04A` | CH0~CH3 A/B/b + 24V/24G/PE | PT100/JPT100 3선식 4채널, 총 15점 |
| `XBF-TC04S` | CH0~CH3 +/- + NC + DC24V +/- | K/J/T/R 열전대 4채널 |
| `XBF-AD08A` | CH0~CH7 +/- + DC24V +/- | 전압/전류 입력 8채널 |

추가 현장 센서:

- `PT100-3W`: A/B/b 세 선
- `TC-K`: 열전대 +/-와 차폐선

## 4. GPT 이미지 자산

신규 장비 외형은 GPT 생성 이미지를 사용했다.

- 디지털 모듈 및 2P MCCB: `assets/devices/gpt-expansion/`
- 아날로그·온도 모듈: `assets/devices/gpt/xbf-*-gpt.png`
- 센서: `assets/devices/gpt-expansion/pt100-3wire-gpt.png`, `thermocouple-k-gpt.png`
- 원본 생성 시트: `assets/devices/gpt-expansion/plc-device-family-source-gpt.png`
- 전체 미리보기: `docs/manual-device-expansion-preview.png`

이미지는 외형만 담당하고, 단자 원과 단자명은 `index.html`의 장비 정의에서 렌더링한다.

## 5. 전원·배선 개선

### 5.1 단상 SMPS 차단기 교정

기존 미션은 3P MCCB의 `T1/T2`를 L/N처럼 사용해 AC-L과 AC-N 단락 판정이 발생할 수 있었다. 단상 회로에는 `MCCB1P`를 공개하고 다음처럼 변경했다.

```text
MCCB L  → L' → 퓨즈 L-IN  → L-OUT → MDR L
MCCB N  → N' → 퓨즈 N-IN  → N-OUT → MDR N
```

`g1`, `g12`, `g14` 및 현장 표준 결선의 전원 경로를 이 구조에 맞췄다.

### 5.2 SMPS 출력 활성 조건

이전에는 MDR의 V+/- 단자가 net에 존재하기만 해도 DC 전원으로 취급했다. 현재는 다음 조건을 모두 만족해야 출력이 활성화된다.

```text
MCCB 투입
+ 퓨즈 정상
+ MDR L net에 AC-L 존재
+ MDR N net에 AC-N 존재
+ L/N이 서로 다른 net
= MDR V+/- 활성
```

`PSU24`도 같은 규칙을 사용한다.

### 5.3 차단기·퓨즈 개폐

시뮬레이션 중 MCCB 또는 퓨즈 장비를 클릭하면 투입/개방 상태가 바뀐다. 개방되면 내부 `netHints` 대신 동적 접점이 끊어져 하류 전원이 제거된다.

## 6. 기능 검증 개선

다음 항목을 장비별로 검사한다.

- DC 전원 장비의 +/0V 한쪽만 연결
- 아날로그 모듈 외부 DC24V 미공급
- 디지털 입력 사용 중 입력 COM 미연결
- 출력 사용 중 해당 출력 그룹 COM 미연결
- RS-485 +/- 중 한 가닥만 연결
- RS-485 A/+와 B/-가 같은 net
- 아날로그 채널 +/- 한쪽만 연결
- RTD A/B/b 세 선 중 일부만 연결
- 본체 AC L/N과 입력부 24V/24G 혼동

검사 결과는 `danger`, `function`, `quality`로 구분한다.

## 7. 통신 및 신호 상태

시뮬레이션 상태에 다음 맵을 추가했다.

- `SIM.commState`: RS-485 장비별 전원, 두 선의 상대 장비 연결, 통신 준비 여부
- `SIM.signalState`: 아날로그 및 RTD 채널별 전원, 채널쌍 연결, 준비 여부
- `SIM.ioState`: 디지털 입력·출력 ON 상태
- `SIM.devicePower`: 장비별 유효 전원 상태

현재 단계는 물리적 전원·배선 준비 상태까지 계산한다. Modbus 주소, 보드레이트, 패리티, XG5000/GX Works 태그 교환은 다음 통신 Bridge 단계에서 추가한다.

## 8. 저장 호환

프로젝트 스키마를 `4`로 올렸다.

- `MY-MD02` → `XY-MD02`
- 아날로그 모듈 `P24` → `+24V`
- 아날로그 모듈 `P0V` → `0V`
- 와이어 endpoint, 점퍼, 단자 보정 데이터에 같은 alias 적용

이전 JSON을 불러올 때 장비와 단자 ID가 자동 변환된다.

## 9. 테스트

`npm test`에서 29개 테스트를 실행하며 다음을 확인한다.

- 매뉴얼 장비 정의 및 이미지 존재
- 단자 그룹과 외부전원 메타데이터
- 미션의 2P MCCB 사용
- RS-485 극성 분리
- SMPS AC 입력 의존성
- 차단기 개방 시 하류 전원 제거
- PLC 출력 강제와 램프 통전
- XBE 입력 COM과 실제 입력 ON 판정
- 이전 장비명/단자명 마이그레이션
- GPT 기반 신규 장비 이미지 파일 존재와 최소 크기
- XBF-TC04S/AD08A 및 PT100/K형 열전대 단자 수
- HMI↔XBC RS-485 물리 준비 상태
- 열전대·PT100 채널 전원 및 완전 결선 상태
- danger/function 오류가 남아 있을 때 미션 성공 차단

현재 결과: **29/29 통과**.

## 10. 추가 미션

| 미션 | 내용 |
|---|---|
| `g15` | XBF-DV04A CH0 출력 → XBF-AD04A CH0 입력 아날로그 루프 |
| `g16` | PT100 3선 A/B/b → XBF-RD04A CH0 |
| `g17` | K형 열전대 +/- → XBF-TC04S CH0, 차폐 → PE 단자대 |
| `g18` | 실제 학원 결선: MDR 두 출력쌍을 HMI/XY-MD02에 분배하고 HMI RS-485를 XBC에 연결 |
| `g19` | XBE-DC32A 입력 COM/PB 입력과 XBE-RY16A 릴레이 출력 COM/램프 점검 |

현장 표준 미션에는 XBC 본체 `L/N` 전원과 출력 `COM0` 공급을 추가했다. HMI RS-232 미션에는 통신선과 별도의 HMI DC24V 전원 단계를 추가했다.

## 11. 배포·자산 정리

- 외부 RBush CDN을 제거하고 내장 공간 인덱스 fallback으로 오프라인 실행 가능
- GPT 제어반 콘셉트 이미지로 `icon.ico` 생성
- 누락되어 있던 `assets/devices/gpt-expansion/` 장비 이미지 세트를 실제 파일로 추가
- 신규 단자 ID 마이그레이션을 포함해 프로젝트 스키마를 `4`로 갱신

## 12. 후속 권장 작업

1. XBL-C41A/EMTA 통신 모듈과 EtherNet/IP·Modbus TCP 장비팩
2. XBF-PD02A, XBF-PN04B/PN08B 위치결정 모듈
3. 장비별 XG5000 주소 매핑 UI
4. XP-Builder 태그 CSV 가져오기
5. XG-SIM 또는 실제 XBC와 연결하는 Windows Bridge
6. 인버터·서보의 레지스터 및 공정 동작 모델
