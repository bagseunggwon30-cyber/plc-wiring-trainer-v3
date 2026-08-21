# `.plcw` v4와 레거시 가져오기

`WorkshopDocumentV4`는 UTF-8 JSON이며 `schemaVersion: 4`, 단조 증가 revision, SHA-256 content hash를 가집니다. 해시는 `contentHash` 필드 자체를 비운 정규 JSON에서 계산합니다.

## 가져오기

- v1/v2/v3는 장비와 전선을 가능한 범위에서 v4로 변환합니다.
- 변환 전 전체 JSON은 `extensions.legacy.originalDocument`에 그대로 보존합니다.
- 알 수 없는 v4 루트 필드는 다시 저장해도 유지합니다.
- 모든 가져오기 원본은 `%LOCALAPPDATA%\PLC Wiring Trainer\Import Backups`에 내용 해시 이름으로 복사합니다.
- JSON 손상이나 지원하지 않는 스키마는 `%LOCALAPPDATA%\PLC Wiring Trainer\Quarantine`에 복사하고 원본을 삭제하지 않습니다.

## 저장과 자동 복구

수동 저장은 대상과 같은 디렉터리의 임시 파일에 먼저 쓴 뒤 원자적으로 교체합니다. 자동 복구본은 `%LOCALAPPDATA%\PLC Wiring Trainer\Autosave`에 문서 ID별 `.plcw`로 저장합니다.

4.0에서 공개 계약이 아닌 `window.*`, `LegacyTrainerBridge`, localStorage 키는 읽거나 생성하지 않습니다. Electron 사용자 데이터의 마지막 로컬 백업은 앱 데이터 아래 `Legacy Backups`에 별도로 남겨 두었습니다.
