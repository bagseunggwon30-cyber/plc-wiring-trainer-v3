# PLC Wiring Trainer 4.3

Windows 전용 네이티브 PLC 결선 교육 도구입니다. UI와 실행 환경은 `WinUI 3 + C# + XAML + Win2D`로 구성하며 HTML, Electron, Chromium, WebView, Three.js를 사용하지 않습니다.

## 4.3 범위

- `패널 배치 / 결선 / 검증` 작업공간과 하나의 문서 세션
- 기본 접힘 장비 팔레트와 빈 캔버스 우클릭 빠른 장비 검색
- 단자 우선 선택, 다중 장애물 직교 배선, waypoint, 팬·줌, 경로 고정과 안전 판정을 거치는 끝단자 재연결
- `J` 또는 상단 점퍼 도구로 여러 단자를 선택하고 `Enter`로 확정하는 schema v5 점퍼 편집
- 장비/전선 속성 편집과 undo/redo
- DC, AC, NPN sinking, PNP sourcing, 2선식 4–20 mA, 물리 결선 검증
- 검증 문제 클릭 시 문제 전선 선택·중앙 이동·확대·강조
- `.plcw` schema v5 저장, 원자적 교체, 격리 가능한 자동 복구본과 시작 시 복구 선택
- compact/v1/v2/V3/flat/v4 JSON 가져오기, 원본/알 수 없는 필드 보존, 손상 문서 격리
- canonical JSON과 pin-to-pin, cable/core, 단자 계획, BOM CSV 보고서

자동화 실습, 미션 실행기, XG-SIM과 3D 렌더러는 4.3.0 실행 코드에 포함하지 않습니다. 기존 v5 문서 필드는 호환을 위해 보존하며 재도입 조건은 [roadmap](docs/roadmap/README.md)에만 기록합니다.

새 결선, 재결선과 점퍼는 같은 단자 해석·수용량·전기 안전 판정을 사용합니다. 전선 교차는 도통을 만들지 않으며 분기는 실제 단자, 점퍼 또는 분배 장비에서만 구성합니다.

## 빌드와 테스트

요구 환경은 Windows 10 2004 이상, .NET 10 SDK, Visual Studio의 WinUI/C# 데스크톱 구성요소입니다.

```powershell
dotnet restore PlcWiringTrainer.slnx
dotnet test native\PlcWiringTrainer.Core.Tests\PlcWiringTrainer.Core.Tests.csproj
dotnet build native\PlcWiringTrainer.App\PlcWiringTrainer.App.csproj -c Release -p:Platform=x64
dotnet test native\PlcWiringTrainer.UiTests\PlcWiringTrainer.UiTests.csproj -c Debug -p:Platform=x64
dotnet format PlcWiringTrainer.slnx --verify-no-changes --no-restore
```

UI 테스트는 일반 CI가 만든 동일한 포터블 ZIP을 내려받아 내부 SHA-256 manifest를 검증한 뒤 실제 `PlcWiringTrainer.exe`를 실행합니다. `release-gate`는 격리된 interactive Windows runner의 10회 기준 흐름과 6개 해상도/DPI 조합이 모두 성공해야 통과하며 skipped 결과는 허용하지 않습니다. 포인터 입력은 사용자의 데스크톱과 분리된 Hyper-V 세션에서만 실행합니다.

현재 로컬에서는 Core·빌드·정적 배포 검증까지만 수행합니다. 격리 UI와 깨끗한 Windows 포터블 증거가 없는 커밋은 `main` 병합 또는 `RELEASE_READY`로 간주하지 않습니다.

## 포터블 배포

```powershell
dotnet publish native\PlcWiringTrainer.App\PlcWiringTrainer.App.csproj `
  -c Release -p:Platform=x64 -r win-x64 --self-contained true `
  -o artifacts\publish\win-x64
```

`PublishSingleFile`은 사용하지 않습니다. 결과 폴더의 `PlcWiringTrainer.exe`, 네이티브 DLL, 장비 자산을 함께 배포해야 합니다.

## 문서와 근거

- [아키텍처](docs/architecture.md)
- [v5 문서/마이그레이션](docs/migration-v5.md)
- [활성 장비 카탈로그](native/PlcWiringTrainer.Core/Catalog/legacy-device-catalog.v5.json)
- [매뉴얼·단자 보정 원본](assets/source-evidence/README.md)

4.0 이전 Electron 기준선은 Git 태그 `legacy-electron-final-2026-08-22`로만 보존합니다.
