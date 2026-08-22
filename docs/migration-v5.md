# `.plcw` v5와 레거시 가져오기

`WorkshopDocumentV5`는 UTF-8 JSON, `schemaVersion: 5`, 단조 증가 revision, canonical SHA-256 content hash를 사용합니다. v5를 v4로 손실 저장하는 기능은 제공하지 않습니다.

## 구조 감지와 무손실 경계

- 무스키마 `{d,w,n,...}`, v1/v2, 실제 V3 `deviceInstances/conductors/conductorBranches`, 레거시 `schemaVersion: 7`, 네이티브 v4를 구조별 reader로 가져옵니다.
- 변환 전 원본의 SHA-256 백업과 전체 JSON은 `extensions.legacy`에 보존합니다.
- 카탈로그의 100개 legacy type alias와 단자 alias를 적용하고 `catalogEntryId`에 원래 장비 type을 남깁니다.
- 원본에 장비·전선·branch·cable assembly·terminal assembly가 있는데 변환 결과 개수가 줄거나 0개가 되면 성공으로 처리하지 않고 격리합니다.
- V3 conductor metadata의 cable/core, gauge/AWG, 길이, pair, shield/drain, 양 끝 ferrule/lug를 활성 v5 필드로 결합합니다. 명시적 cable assembly가 없고 conductor metadata에 assembly ID가 있으면 소속 전선과 drain을 포함한 assembly를 합성합니다.
- 해시가 있는 완전한 V3와 모든 네이티브 v5 문서는 canonical 해시가 일치해야 합니다. 손상되거나 지원하지 않는 문서는 `%LOCALAPPDATA%\PLC Wiring Trainer\Quarantine`에 증거를 남기며, 손상 autosave 원본은 복구 목록에서 제거합니다.

## 저장과 자동 복구

수동 저장은 대상과 같은 디렉터리의 임시 파일에 먼저 쓰고 디스크 flush 후 원자적으로 교체합니다. 자동 복구본은 `%LOCALAPPDATA%\PLC Wiring Trainer\Autosave`에 문서 ID별 `.plcw`로 저장하며 문서별 single writer와 revision 비교로 오래된 작업의 역전 덮어쓰기를 차단합니다. 정상 수동 저장이 끝나면 해당 문서의 autosave를 삭제합니다.

`window.*`, `LegacyTrainerBridge`, localStorage 키는 공개 계약에 포함되지 않습니다.
