# PLC 결선 트레이너 v3 - XG-SIM 및 매뉴얼 기반 장비 동작 구현 계획

## 문서 상태

- 상태: 구현 전 승인 계획
- 작성일: 2026-08-02
- 대상 작업 폴더: `C:\Users\bark\Downloads\plc-wiring-trainer\.worktrees\reliability-prewire`
- 기준 애플리케이션: 결선 작업장 v3.0.4
- 기준 XG5000: 로컬 설치본 4.78.2.0
- 최초 범위: 로컬 XG-SIM을 이용한 소프트웨어 인더루프(SIL) 기능시험
- 제외: 실제 PLC 다운로드, RUN/STOP 변경, 강제 출력, 온라인 쓰기, 실제 설비 제어

이 문서는 이후 Codex 목표 작업에서 구현 범위와 완료 조건을 잃지 않도록 사용하는 기준 지침이다. 구현 중 판단이 충돌하면 안전, 공식 제조사 근거, 기존 사용자 작업 보존, 결정적 검증 순으로 우선한다.

## 1. 목표

현재 결선 트레이너의 v3 전기 회로 엔진과 실제 XG5000 래더 시뮬레이션을 연결한다.

최종적으로 다음 흐름이 성립해야 한다.

1. 사용자가 트레이너 화면의 푸시버튼이나 센서를 조작한다.
2. v3 회로 엔진이 전원, 귀로, COM, 극성, 접점 및 보호기기 상태를 계산한다.
3. 정상적으로 통전된 PLC 입력만 XG-SIM 입력 이미지에 기록한다.
4. XG-SIM이 사용자가 작성한 실제 XG5000 래더를 스캔한다.
5. 트레이너가 XG-SIM 출력을 읽는다.
6. PLC 출력과 실제 결선 조건이 모두 충족될 때만 접촉기, 릴레이, 표시등, EOCR, 모터 등이 동작한다.
7. 입력, 출력, 전류 경로, 장비 상태와 오류 원인을 시간순으로 기록한다.

이 기능은 현장 통전 승인이나 안전 인증이 아니다. 입력된 범위에서 결선과 PLC 로직을 함께 확인하는 오프라인 기능시험이다.

## 2. 확정된 구조 원칙

### 2.1 단일 책임

- XG-SIM: PLC 메모리와 래더 실행의 권위자
- v3 회로 엔진: 전원, 귀로, 전압, 전류, 단락, 접점 통전의 권위자
- 장비 동작 엔진: 장비 내부 상태, 지연, 고장과 접점 전환의 권위자
- 런타임 브리지: 상태를 운반하되 전기 또는 장비 판단을 하지 않음
- SVG UI: 조작과 상태 표시만 담당

### 2.2 두 시뮬레이터의 역할을 섞지 않음

XG-SIM 출력이 ON이라는 이유만으로 부하를 켜지 않는다. 다음 조건을 v3 회로 엔진이 별도로 확인해야 한다.

- PLC와 출력 회로의 전원이 정상인지
- 릴레이 또는 트랜지스터 출력 COM이 올바른지
- 부하의 공급 경로와 0V/N 귀로가 모두 완성됐는지
- EOCR, MCCB, 퓨즈, 인터록과 비상정지 조건이 정상인지
- 극성, 전압, 전류 및 장비 설정이 허용 범위인지

### 2.3 임의 스크립트 금지

장비 동작에는 `eval`, `new Function`, 외부 JavaScript 파일 또는 사용자가 입력한 코드를 실행하지 않는다. 매뉴얼 근거를 가진 선언형 `DeviceBehaviorProfile`을 Zod로 검증한 뒤 제한된 상태 머신으로 실행한다.

### 2.4 기존 자산과 작업 보존

- 기존 장비 이미지를 교체하지 않는다.
- 기존 단자 보정과 사용자 변경을 되돌리지 않는다.
- 구현 중 자동 커밋, 푸시, Drive 업로드를 하지 않는다.
- 기존 실행 파일은 출시 게이트를 통과하기 전에 교체하지 않는다.
- 검증은 매 편집마다 실행하지 않고 단계 구현을 모은 뒤 마지막에 2-3회 수행한다.

## 3. 현재 환경에서 확인된 기술 조건

- Electron 패키지는 Windows x64 대상이다.
- 로컬 `C:\XG5000\XG-SIM\XG-SIM.exe`는 x86이다.
- 로컬 `C:\XG5000\XG-SIM\XGSimulator.dll`도 x86이다.
- DLL에는 `ReadDevice`와 `WriteDevice` 이름의 C++ 내보내기가 존재하지만, 이것만으로 공개되고 안정적인 API라고 판단하지 않는다.
- XG-SIM 설치본에는 XGB 계열 CPU 이미지와 I/O 모듈 시뮬레이터가 포함돼 있다.
- 공식 XG-SIM Interface 기술자료, 헤더, 샘플, 재배포 조건은 구현 전에 별도로 확보해야 한다.

따라서 x64 Electron 프로세스가 x86 DLL을 직접 로드하지 않는다. 공식 API를 사용하는 별도의 32비트 호스트 프로세스를 둔다.

## 4. 목표 아키텍처

```text
SVG 제어반 UI
    |
    v
SimulationRuntimeCoordinator
    |-- v3 CircuitGraph / solveCircuit()
    |-- DeviceBehaviorRuntime
    |-- I/O Binding Resolver
    |
    v
Electron preload의 타입 지정 IPC
    |
    v
Electron Main의 XgSimSessionService
    |
    v
로컬 Named Pipe 또는 stdin/stdout
    |
    v
xgsim-host-x86.exe
    |
    v
공식 XG-SIM Interface API
    |
    v
XG-SIM - 실제 XG5000 래더 실행
```

브라우저 renderer나 Web Worker에서 DLL 또는 자식 프로세스에 직접 접근하지 않는다. 기존 `contextIsolation: true`, `nodeIntegration: false`를 유지한다.

## 5. 공개 계약

### 5.1 `PlcRuntimeAdapter`

PLC 실행기의 공급자를 추상화한다.

- `probe()` - 버전과 지원 기능 확인
- `connect()` - 지정된 로컬 시뮬레이터 세션 연결
- `readSnapshot()` - 허용된 주소를 한 프레임으로 읽기
- `writeInputImage()` - 허용된 입력 및 요청 영역만 기록
- `getStatus()` - 연결, 실행, 일시정지, 고장 상태 확인
- `disconnect()` - 세션 정리

구현체는 우선 두 개만 둔다.

- `MockPlcRuntimeAdapter` - 단위 및 Electron E2E용
- `XgSimRuntimeAdapter` - x86 호스트를 통한 실제 XG-SIM용

실제 PLC 어댑터는 첫 출시 범위에서 제외한다.

### 5.2 `IoBindingV1`

제어반 단자와 XG5000 주소를 명시적으로 연결한다.

필수 필드:

- 바인딩 ID
- 장비 인스턴스와 단자 ID
- XG5000 CPU와 프로젝트 식별자
- 심볼명과 실제 주소
- `input`, `output`, `internal-request`, `parameter`, `monitor` 방향
- BOOL, WORD, DWORD, REAL 자료형
- 논리 반전 여부
- 정상 및 통신 두절 시 안전 상태
- 읽기/쓰기 권한
- 근거 프로젝트 파일 해시

타입의 첫 장비나 표시 이름을 추측해 연결하지 않는다. 사용자가 배치한 정확한 장비 인스턴스와 저장된 역할 바인딩을 사용한다.

### 5.3 `DeviceBehaviorProfile`

정확한 품번의 매뉴얼 기반 동작을 정의한다.

- 프로필 ID와 버전
- 제조사와 전체 주문코드
- 입력 단자와 전기 조건
- 내부 상태와 초기 상태
- 상태 전환 조건
- 동작 및 복귀 시간
- 출력 접점과 출력 상태
- 고장, 트립 및 리셋 조건
- 정격과 허용 범위
- 지원하지 않는 동작
- 매뉴얼 ID, 페이지, 파일 SHA-256

### 5.4 `RuntimeFrame`

한 번의 동기화 결과를 불변 스냅샷으로 보관한다.

- 프레임 번호와 시간
- Workshop revision/hash
- XG-SIM 세션과 프로젝트 해시
- PLC 입력 및 출력 이미지
- 전기 회로 해답
- 장비 상태
- 경고와 차단 오류
- 처리 시간과 재시도 정보

### 5.5 `FunctionalSimulationResult`

전기 검증과 PLC 기능시험을 구분한다.

- `PREWIRE_PASS`
- `PLC_SIM_PASS`
- `DEVICE_SIM_PASS`
- `SIL_PASS`
- `FAIL`
- `BLOCKED`
- `STALE`

`SIL_PASS`는 사전 기능시험 통과이지 통전 승인이나 안전 인증이 아니다.

## 6. 구현 단계와 게이트

## 단계 A - 공식 XG-SIM API PoC

이 단계는 전체 구현의 강제 선행 조건이다.

작업:

1. LS의 XG5000 Simulator Interface 기술자료, SDK, 헤더와 샘플을 확보한다.
2. API 사용 및 앱과 함께 배포할 수 있는지 확인한다.
3. 현재 XG5000 4.78.2.0 및 XG-SIM과 API 버전을 대조한다.
4. XBC-DR32H 프로젝트가 지원되는 CPU 이미지와 일치하는지 확인한다.
5. 별도 시험 프로그램에서 지정 입력 1점을 기록한다.
6. XG-SIM에서 실제 래더가 입력을 처리하게 한다.
7. 지정 출력 1점을 다시 읽는다.
8. XG-SIM 종료, 재시작, 프로젝트 변경을 감지한다.

완료 기준:

- 입력 1점 -> 래더 -> 출력 1점 왕복 증거
- 주소, 자료형, 오류코드와 세션 수명주기 문서화
- XG-SIM 및 시험 프로젝트 해시 기록
- 비정상 종료 후 안전한 연결 해제 확인

중단 조건:

- 공식 SDK 또는 문서화된 API가 없음
- XBC 대상 CPU를 시뮬레이션할 수 없음
- 재배포 또는 사용 조건이 불명확함
- 주소를 안정적으로 읽거나 쓸 수 없음

중단 조건에 해당하면 DLL 역공학으로 우회하지 않고 `BLOCKED`로 보고한다. 공식 OPC 또는 공개 인터페이스가 실제로 문서화돼 있는 경우에만 대안 PoC를 진행한다.

## 단계 B - 타입, 스키마와 Mock 런타임

예상 파일:

- `src/domain/plc-runtime/contracts.ts`
- `src/domain/plc-runtime/io-binding.ts`
- `src/domain/plc-runtime/runtime-coordinator.ts`
- `src/domain/plc-runtime/mock-adapter.ts`
- `src/domain/device-runtime/contracts.ts`
- `src/domain/device-runtime/behavior-runtime.ts`
- `src/domain/device-runtime/schema.ts`

작업:

- `WorkshopDocumentV3`에 선택적인 PLC 런타임 바인딩 추가
- 기존 v3 저장문서의 결정적 마이그레이션
- 프로젝트, CPU, 주소와 자료형 검증
- 출력 주소에 대한 쓰기 요청 차단
- Mock 어댑터로 전체 프레임 실행
- 런타임 상태와 설계 문서의 영속성 분리

완료 기준:

- 동일 입력에 동일한 프레임 결과
- 저장/불러오기 round-trip
- 기존 문서는 내용 손실 없이 마이그레이션
- 잘못된 주소, 중복 바인딩, 방향 오류를 `BLOCKED`

## 단계 C - x86 XG-SIM 호스트와 Electron IPC

예상 구조:

- `native/xgsim-host/`
- `src/main/xgsim-session-service.*` 또는 동등한 main-process 모듈
- `src/shared/xgsim-host-protocol.ts`
- `preload.js`의 최소 노출 API

호스트 조건:

- 32비트 빌드
- 공식 SDK만 사용
- 외부 TCP 포트를 열지 않음
- 로컬 Named Pipe 또는 stdin/stdout 사용
- 프로토콜 버전 및 세션 nonce 확인
- 주소 허용목록 적용
- 요청 크기와 처리 시간 제한
- 비정상 종료 및 재연결 처리

renderer에 노출할 API:

- 설치 및 호환성 확인
- 로컬 XG-SIM 연결과 연결 해제
- 허용된 입력 프레임 제출
- 출력 스냅샷 구독
- 상태와 오류 조회

renderer에는 파일 경로, 임의 프로세스 실행, 임의 주소 쓰기 기능을 노출하지 않는다.

완료 기준:

- x64 Electron과 x86 호스트 통신 성공
- 호스트 중단 시 renderer가 멈추지 않음
- watchdog 만료 시 모든 가상 액추에이터가 안전 상태
- 실제 PLC 네트워크나 외부 인터넷 요청 0건

## 단계 D - 실시간 폐루프 코디네이터

한 프레임의 순서를 고정한다.

1. 이전 PLC 출력 이미지를 읽는다.
2. 릴레이와 트랜지스터 출력 상태를 v3 회로 모델에 적용한다.
3. `solveCircuit()`로 전원, 귀로, 전압, 전류와 접점 상태를 계산한다.
4. 장비 상태 머신을 한 주기 실행한다.
5. 실제 통전 조건을 만족한 PLC 입력만 계산한다.
6. 계산된 입력 이미지를 XG-SIM에 기록한다.
7. XG-SIM의 다음 안정 출력 스냅샷을 읽는다.
8. 새 `RuntimeFrame`을 발행한다.

API가 래더 스캔 완료 이벤트를 제공하면 이를 사용한다. 제공하지 않으면 공식 문서가 허용하는 읽기 방식과 변경 카운터를 사용하고, 임의 시간 지연만으로 동기화했다고 주장하지 않는다.

문서, 프로필, 바인딩 또는 XG5000 프로젝트가 바뀌면 실행 결과를 `STALE`로 만든다.

## 단계 E - 첫 수직 시제품

장비 범위:

- XBC-DR32H
- 검증된 DC24V 전원 또는 시험 경계 전원
- 시작 PB NO
- 정지 PB NC
- XBC 입력 2점
- XBC 릴레이 출력 P20
- MY2N 또는 MC 코일
- 운전 표시등

필수 흐름:

1. XG5000에서 자기유지 래더를 연다.
2. Program Check 결과를 기록한다.
3. XG-SIM을 시작한다.
4. 트레이너에서 시작 PB를 누른다.
5. 정상 결선일 때만 입력이 XG-SIM에 전달된다.
6. 래더 출력 P20이 ON된다.
7. 출력 COM과 코일 전원 및 귀로가 정상일 때만 코일과 표시등이 작동한다.
8. 정지 PB를 누르면 자기유지가 해제된다.

대표 오결선:

- 입력 COM 반전
- 시작 PB 공급 경로 단선
- 코일 0V 귀로 단선
- 출력 COM 미결선
- PLC 무전원
- P20 출력 접점 우회

오결선 상태에서는 XG-SIM 출력과 실제 부하 상태가 다를 수 있으며, UI가 그 이유를 정확한 단자와 경로로 설명해야 한다.

## 단계 F - 장비 동작 프로필

도입 순서:

1. 표시등과 버저
2. MY2N-D2 릴레이
3. 정확한 코일전압의 MC-22b
4. 정확한 EOCR-3DE/FDE 변형
5. PNP/NPN 3선식 및 2선식 센서
6. 3상 유도전동기
7. XBF-AH04A
8. 전체 주문코드가 확정된 G100 또는 iG5A
9. 공식 제조사 근거가 확보된 RS485 장비
10. 위치결정 및 서보

프로필별 예시 동작:

- 접촉기: A1-A2 전압, 여자/복귀 지연, 주접점, a/b 보조접점
- EOCR: 설정전류, 결상, 역상, 트립 지연, 95-96/97-98, 리셋
- 센서: 전원, 감지 대상, NPN/PNP 출력과 누설 조건
- 모터: 3상, 상순서, EOCR, 회전 방향, 단순 가감속
- XBF: V/I 선택 스위치, 범위, 원시값 변환, 입력저항과 부하
- 인버터: 주전원, STO, 단자 운전, 정/역, 주파수, 가감속, 알람

정확한 주문코드, 매뉴얼 또는 정격 데이터가 부족하면 교육용 상태를 유지하고 SIL 통과 대상에서 제외한다.

## 단계 G - 사용자 화면

상단 상태:

- XG-SIM 미연결
- 연결 중
- 동기화됨
- 일시정지
- 프로젝트 불일치
- 호스트 오류

추가 패널:

- PLC I/O 바인딩 편집기
- 입력 및 출력 LED 모니터
- 현재 XG-SIM 프로젝트와 CPU 정보
- PLC 출력과 실제 부하 상태 비교
- 장비 내부 상태
- 프레임별 이벤트 추적
- 오프라인 고장 삽입

예시 표시:

```text
P0020 출력: ON
PLC1:P20 접점: CLOSED
K1 코일 전압: 23.8 V
K1 상태: ENERGIZED
M1 모터 상태: OFF
원인: EOCR 95-96 접점 OPEN
```

버튼, 센서 및 HMI 조작은 물리 입력이나 내부 요청 비트만 변경한다. PLC 물리 출력을 직접 켜는 UI는 제공하지 않는다.

## 단계 H - 리포트와 출시

리포트 항목:

- XG5000/XG-SIM 버전
- CPU 모델과 프로젝트 파일 해시
- Workshop revision/hash
- I/O 바인딩표
- 장비 프로필, 매뉴얼 페이지와 해시
- 프레임별 입력, 출력과 장비 상태
- 전체 전류 경로
- 필수 시나리오 결과
- 미지원 기능
- 호스트 연결, 중단과 재연결 이력

`PREWIRE_PASS`, `PLC_SIM_PASS`, `DEVICE_SIM_PASS`를 각각 기록한다. 모두 최신 상태이고 요구 시나리오가 통과한 경우에만 `SIL_PASS`를 표시한다.

첫 출시에는 실제 PLC 연결 기능을 포함하지 않는다.

## 7. 시험 계획

### 7.1 단위 테스트

- XG5000 주소와 자료형 파서
- 중복 또는 방향 오류 바인딩
- 출력 주소 쓰기 거부
- Mock PLC 런타임
- 상태 머신의 결정성
- 코일 동작 및 복귀
- EOCR 트립과 리셋
- 인버터 상태 전환
- 프로필 스키마와 매뉴얼 근거
- 런타임 프레임의 STALE 판정

### 7.2 통합 테스트

- x64 Electron과 x86 호스트 왕복
- 호스트 비정상 종료
- XG-SIM 미실행
- 프로젝트 및 CPU 불일치
- 응답 지연과 watchdog
- 일부 주소 읽기 또는 쓰기 실패
- renderer에서 직접 DLL이나 프로세스 접근 불가
- 외부 네트워크 요청 0건

### 7.3 필수 기능 시나리오

- 시작, 정지와 자기유지
- 입력 COM 소스/싱크 오류
- PLC 무전원
- 출력 OFF/ON
- 코일 공급 또는 귀로 단선
- NO/NC 접점 전환
- EOCR 트립 및 리셋
- 정/역 접촉기 동시여자 금지
- 3상 결상과 역상
- 아날로그 스위치와 파라미터 범위 불일치
- XG-SIM 종료 시 안전 상태

### 7.4 실제 프로그램 검증

- 결선 트레이너 웹 UI: Codex 내부 브라우저의 실제 포인터로 확인
- XG5000/XG-SIM Windows UI: 공식 Codex Computer Use로 확인
- XG5000 Program Check 오류 및 경고 수 기록
- 프로젝트 저장 및 다시 열기 확인
- 실제 PLC 다운로드, RUN/STOP, 강제 출력 및 온라인 쓰기는 수행하지 않음

### 7.5 검증 실행 시점

각 파일 편집마다 전체 검증하지 않는다.

1. 단계별 좁은 테스트는 필요한 경우에만 실행한다.
2. 구현을 충분히 모은 뒤 단위 테스트, 타입 검사와 빌드를 한 번 실행한다.
3. 최종 수정 후 전체 검증을 두 번째로 실행한다.
4. 큰 수정이 추가된 경우에만 세 번째 최종 검증을 실행한다.

## 8. 출시 게이트

다음을 모두 충족하기 전에는 실사용 가능 또는 완료로 표시하지 않는다.

- 공식 XG-SIM API 근거 확보
- XG-SIM 입출력 왕복 PoC 성공
- 첫 수직 시제품의 정상 및 대표 오결선 통과
- 출력 주소 쓰기 방지 시험 통과
- XG-SIM 중단 시 안전 상태 확인
- 기존 v3 결선 회귀 테스트 통과
- 단위 테스트, 타입 검사와 빌드 통과
- Codex 내부 브라우저 UI 흐름 통과
- 공식 Computer Use 기반 XG5000/XG-SIM 증거 확보
- 외부 네트워크 요청 0건
- 기존 이미지 변경 없음
- 기존 저장문서 마이그레이션과 원본 보존
- 미지원 특수 모듈과 실제 PLC 기능 명시

## 9. 실제 PLC 연동의 후속 범위

실제 PLC 연결은 XG-SIM 구현과 별도 프로젝트 단계로 다룬다.

- XGT 전용 프로토콜 또는 Modbus TCP 어댑터
- 최초 버전은 읽기 전용
- 실습용 24V 패널과 명시적인 연결 대상에서만 시험
- 물리 출력 쓰기와 강제 출력은 기본 차단
- 사용자의 별도 명시적 승인과 산업 안전 게이트 없이는 활성화하지 않음

관련 공식 근거:

- LS Solution Square XG5000/XG-SIM 검색: <https://sol.ls-electric.com/ww/en/newSearch?searchInput=xg5000>
- LS PLC 제품 및 시뮬레이터 안내: <https://www.ls-electric.com/products/category/Smart_Automation_Solution/PLC>
- XGT FEnet 공식 매뉴얼: <https://www.ls-electric.com/upload/customer/download/1601/XGT%20FEnet_English%20Manual_V1.7.pdf>

## 10. 권장 목표 명령

아래 내용을 새 메시지에서 `/goal`과 함께 사용한다.

```text
/goal

C:\Users\bark\Downloads\plc-wiring-trainer\.worktrees\reliability-prewire에서
docs/xgsim-device-runtime-implementation-plan.md를 기준 지침으로 사용하여
XG-SIM 연동 및 매뉴얼 기반 장비 동작 구현을 단계 A부터 진행해.

공식 XG-SIM API PoC가 통과하기 전에는 대규모 장비 동작 구현으로 넘어가지 마.
기존 이미지와 사용자 변경을 보존하고, 실제 PLC 다운로드·RUN/STOP·강제 출력·온라인 쓰기는 하지 마.
검증은 마지막 단계에서 2-3회 수행하고, UI는 Codex 내부 브라우저,
XG5000/XG-SIM은 공식 Computer Use로 증거를 남겨.
정말 외부 자료나 사용자 결정 없이는 진행할 수 없을 때만 질문하고,
각 단계의 완료 조건을 만족할 때까지 계속 진행해.
```

## 11. 구현 시작 시 첫 체크리스트

- [ ] 현재 브랜치, 기준 커밋과 dirty worktree 확인
- [ ] 기존 이미지와 사용자 변경 목록 기록
- [ ] XG5000, XG-SIM 및 CPU 버전 기록
- [ ] 공식 XG-SIM Interface 문서와 SDK 확보
- [ ] API 배포 및 사용 조건 확인
- [ ] XBC-DR32H CPU 지원 확인
- [ ] 입력 1점 -> 래더 -> 출력 1점 PoC 설계
- [ ] 실제 PLC 동작 금지 안전 게이트 확인
- [ ] PoC 성공 전 장비 프로필 대량 구현 금지
