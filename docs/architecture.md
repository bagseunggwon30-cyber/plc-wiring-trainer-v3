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

이미지, 카탈로그 항목, 전기 프로필은 별도입니다. 내부 브라우저로 측정한 레거시 정본은 장비 100종, 사용 가능 팔레트 68종, 단자 657점, 고유 이미지 64개입니다. 최신 램프 3종과 NPN/PNP v2 자산은 별도 정본으로 유지합니다.

정확 품번 매뉴얼 16종, 계열 매뉴얼 17종, 교육용/미확정 67종의 배지는 독립적으로 표시합니다. NPN/PNP sourcing/sinking 판단은 이미지가 아니라 형식화된 단자 역할과 결선망으로 계산합니다.

## 결선 편집

`WireDraftMachine`은 클릭→클릭과 드래그→놓기를 같은 비영속 상태로 관리합니다. 빈 캔버스 경로점, `Backspace`, `Esc`, 끝단자 재연결은 결선 완료 전 revision을 소비하지 않습니다. `DeviceTransform`은 렌더링, hit-test, 단자 좌표, 문제 이동에서 같은 회전·배율 계산을 사용합니다.

## 레거시 이후 단계의 경계

- JSON 및 CSV 보고서는 HTML 중간 문서 없이 생성하고 spreadsheet formula injection을 차단합니다.
- XG-SIM 계약은 64 KiB JSONL, timeout, fail-safe reset, 프로젝트 신원 fail-closed를 요구합니다. LS DLL과 실제 호스트는 검증 전 배포하지 않습니다.
- `ISceneRenderer`는 2D와 같은 문서 ID/terminal ID를 받습니다. Direct3D 11 렌더러가 검증되기 전에는 3D 완료로 표시하지 않습니다.
