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
  -> revision/hash 일치 결과만 CURRENT 반영
```

늦게 끝난 이전 revision의 결과는 취소 여부와 무관하게 폐기합니다.

## 문제 위치 이동

`IssueNavigator`는 `ValidationIssueV4.Targets`를 다음 순서로 풉니다.

1. 존재하는 conductor
2. terminal에 닿은 conductor, 없으면 terminal의 device
3. device

해결된 범위는 캔버스 중심으로 이동·확대하고 실제 전선을 선택합니다. 선택 정보는 속성 탭과 동일한 상태를 사용합니다.

## 전기 근거 경계

이미지와 전기 프로필은 별도입니다. 램프와 센서 이미지는 현재 사용자가 선택한 자산으로 해시 고정하지만 근거 등급은 `educational`입니다. NPN/PNP sourcing/sinking 판단은 이미지가 아니라 형식화된 단자 역할과 결선망으로 계산합니다.
