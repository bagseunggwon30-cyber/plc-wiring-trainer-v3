# 네이티브 아키텍처

## 프로젝트 경계

- `PlcWiringTrainer.App`: WinUI 창, Win2D 캔버스, 파일 선택기, 속성/검증 패널
- `PlcWiringTrainer.Core`: UI 비종속 문서, 마이그레이션, 저장, 검증, 탐색, 작업 상태
- `PlcWiringTrainer.Core.Tests`: 전기 규칙과 영속 계약 단위 테스트
- `PlcWiringTrainer.UiTests`: 실제 EXE를 실행하는 Windows UI Automation 테스트

`Core`는 WinUI를 참조하지 않습니다. 문서와 검증 결과는 직렬화 가능한 C# 계약으로만 App에 전달됩니다.

## 편집과 검증 흐름

```text
사용자 입력
  -> WorkbenchStore 명령
  -> revision 증가 + SHA-256 재계산
  -> undo/redo 스냅샷
  -> 검증 상태 STALE
  -> 300 ms debounce
  -> 백그라운드 IValidationService
  -> revision/hash 일치 결과만 PASS/FAIL/BLOCKED 반영
```

늦게 끝난 이전 revision의 결과는 취소 여부와 무관하게 폐기합니다.

## 문제 위치 이동

`IssueNavigator`는 `ValidationIssueV5.Targets`를 다음 순서로 풉니다.

1. 존재하는 conductor
2. terminal에 닿은 conductor, 없으면 terminal의 device
3. device

해결된 범위는 캔버스 중심으로 이동·확대하고 실제 전선을 선택합니다. 선택 정보는 속성 탭과 동일한 상태를 사용합니다.

## 전기 근거 경계

이미지, 카탈로그 항목, 전기 프로필은 별도입니다. 현재 네이티브 manifest 기준으로 분류 장비 80종, 배치 가능 팔레트 48종, 배치 가능 단자 482점, 활성 고유 이미지 46개입니다. 최신 램프 3종과 NPN/PNP v2 자산은 별도 정본으로 유지합니다.

정확 품번 프로필 18종을 포함해 검증 결선 13종, 연습 전용 35종, 준비 중 5종을 구분합니다. 근거 배지는 이미지와 독립적으로 표시하며, NPN/PNP sourcing/sinking 판단은 형식화된 단자 역할과 결선망으로 계산합니다.

## 결선 편집

`WireDraftMachine`은 클릭→클릭과 드래그→놓기를 같은 비영속 상태로 관리합니다. 빈 캔버스 경로점, `Backspace`, `Esc`, 끝단자 재연결은 결선 완료 전 revision을 소비하지 않습니다. `DeviceTransform`은 렌더링, hit-test, 단자 좌표, 문제 이동에서 같은 회전·배율 계산을 사용합니다.

완성 후보가 장애물과 금지 영역을 피하는 직교 경로를 만들지 못하면 `ROUTE_NOT_FOUND`로 초안을 유지하고 문서에는 추가하지 않습니다. 잠긴 경로는 내부 world waypoint를 고정하며, 장비 이동·크기·회전 후보가 그 경로와 충돌하면 `ROUTE_LOCK_CONFLICT`로 revision/hash/undo 변경 전에 거부합니다.

## 4.3 작업공간과 모듈 경계

- `WorkbenchShell`은 `패널 배치 / 결선 / 검증` 작업공간을 전환하지만 문서, 선택, viewport와 undo 기록은 하나만 유지합니다.
- `PaletteController`는 접힘 상태, 검색, 숨김 목록과 빠른 장비 삽입 후보를 관리합니다. 빈 캔버스 우클릭 메뉴를 탐색하는 동안에는 revision을 변경하지 않습니다.
- `WorkbenchCommandDispatcher`만 문서 변경 명령을 `WorkbenchStore`에 전달합니다. 캔버스는 선택과 편집 의도를 이벤트로 보고합니다.
- `CanvasViewport`와 Core의 `DeviceTransform`은 화면 배율과 장비 회전 계산의 책임을 분리합니다.
- `CanvasAssetCache`는 Win2D PNG/SVG 수명을, `CanvasHitTester`는 단자→전선→장비 hit-test를 담당합니다. UIA overlay는 같은 변환으로 장비·단자·전선 ID와 화면 bounds를 노출합니다.
- `ConnectionAssessmentService`와 `WorkbenchStore`는 신규 결선, 재결선과 점퍼에 동일한 단자 alias, 수용량, 굵기와 전기 안전 정책을 적용합니다. 차단된 후보는 revision이나 undo를 소비하지 않습니다.
- 점퍼 도구는 두 개 이상의 단자를 비영속 초안으로 선택하고 `Enter`로 한 번에 확정합니다. 같은 단자 중복, 기존 전선·점퍼와의 직접 중복, 모든 단자 쌍의 전기 위험을 확정 전에 검사합니다.
- `WireNumber`는 검증·속성·보고서가 공유하는 실제 선번이며 `Label`은 표시명으로만 사용합니다.
- 잠근 전선은 당시 렌더링된 내부 경로를 waypoint로 저장하고, 자동 라우터는 전체 장애물을 다시 검사합니다.
- `PLCW_DATA_ROOT`를 지정한 테스트는 palette, autosave, import backup과 quarantine를 모두 해당 임시 루트 안에 격리합니다.
- 문서별 autosave writer는 revision 순서를 직렬화하며, 수동 저장은 예약된 autosave를 종료한 뒤 정상 파일을 저장하고 이전 복구본을 삭제합니다. v5 hash 불일치 복구본은 Autosave 밖에 격리되어 다시 제시되지 않습니다.

## 제거된 실행 기능의 경계

- JSON 및 CSV 보고서는 HTML 중간 문서 없이 생성하고 spreadsheet formula injection을 차단합니다.
- 자동화, XG-SIM, 3D 및 빈 미션 실행 계약은 4.2 컴파일 대상에서 제거했습니다. v5 문서의 mission state, scenario, view layout 필드는 이전 문서 무손실 로드를 위해 유지합니다.
- 재도입은 별도 프로세스 격리, 실제 설치 환경, GPU와 전기 동등성 검증을 충족한 뒤에만 진행합니다.
