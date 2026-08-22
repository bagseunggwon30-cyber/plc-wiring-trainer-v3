# PLC Wiring Trainer 4.2

Windows 전용 네이티브 PLC 결선 교육 도구입니다. UI와 실행 환경은 `WinUI 3 + C# + XAML + Win2D`로 구성하며 HTML, Electron, Chromium, WebView, Three.js를 사용하지 않습니다.

## 4.2 범위

- `패널 배치 / 결선 / 검증` 작업공간과 하나의 문서 세션
- 기본 접힘 장비 팔레트와 빈 캔버스 우클릭 빠른 장비 검색
- 단자 우선 선택, 직교 배선, waypoint, 팬·줌, 경로 잠금과 끝단자 재연결
- 장비/전선 속성 편집과 undo/redo
- DC, AC, NPN sinking, PNP sourcing, 2선식 4–20 mA, 물리 결선 검증
- 검증 문제 클릭 시 문제 전선 선택·중앙 이동·확대·강조
- `.plcw` schema v5 저장, 원자적 교체, 자동 복구본
- compact/v1/v2/V3/flat/v4 JSON 가져오기, 원본/알 수 없는 필드 보존, 손상 문서 격리
- canonical JSON과 pin-to-pin, cable/core, 단자 계획, BOM CSV 보고서

자동화 실습, 미션 실행기, XG-SIM과 3D 렌더러는 4.2.0 실행 코드에 포함하지 않습니다. 기존 v5 문서 필드는 호환을 위해 보존하며 재도입 조건은 [roadmap](docs/roadmap/README.md)에만 기록합니다.

## 빌드와 테스트

요구 환경은 Windows 10 2004 이상, .NET 10 SDK, Visual Studio의 WinUI/C# 데스크톱 구성요소입니다.

```powershell
dotnet restore PlcWiringTrainer.slnx
dotnet test native\PlcWiringTrainer.Core.Tests\PlcWiringTrainer.Core.Tests.csproj
dotnet build native\PlcWiringTrainer.App\PlcWiringTrainer.App.csproj -c Release -p:Platform=x64
dotnet test native\PlcWiringTrainer.UiTests\PlcWiringTrainer.UiTests.csproj -c Debug -p:Platform=x64
dotnet format PlcWiringTrainer.slnx --verify-no-changes --no-restore
```

UI 테스트는 실제 `PlcWiringTrainer.exe`를 실행해 접근성 ID, 검증 항목 클릭, 문제 전선 이동과 속성 반영을 확인합니다. 포인터 입력을 쓰는 빠른 장비 삽입 테스트는 사용자의 데스크톱과 분리된 Windows UI 세션에서만 실행합니다.

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
