# 4.3 독립 감사 조치 상태

기준 감사 HEAD `898971834d62eb19bc8f6fe3c2243becf2599604`에서 보고된 병합 차단 항목을 추적한다.

## 구현 및 headless 검증 대상

- autosave single writer, revision 역전 방지, 수동 저장 후 복구본 정리
- native v5 content hash 강제 검증과 손상 autosave 격리
- 잠긴 내부 경로의 장애물 재검사와 장비 후보 편집 원자적 차단
- 신규 결선·재결선의 자동 색상 및 고장 주입 override 저장 경로 통합
- terminal alias의 전체 validator 정규화
- 중복 persistent ID와 직접 중복 결선의 blocking issue 변환
- V3 cable/core/shield/drain/ferrule/lug 활성 필드 이식과 loss guard
- schema v5 점퍼 초안·취소·확정 UI와 AutomationId
- validator 예외 시 최신 문서를 `Running`에 남기지 않는 실패 상태
- exact portable artifact handoff, manifest 전수 검사, skipped 불허 release gate

## 격리 환경에서만 검증할 대상

- 우클릭 검색 배치, 클릭/드래그 결선, waypoint, 재결선, 점퍼, route lock, 검증 이동·강조
- 강제 종료 후 자동복구와 손상 복구본 표시/격리
- 1920×1080 100% 전체 흐름 10회 및 나머지 5개 해상도/DPI 조합
- 바탕화면 바로가기 실행, 종료 후 잔류 프로세스 0건
- 깨끗한 Windows snapshot에서 SDK/Node 없이 동일 ZIP 실행 및 외부 데이터 오염 0건

두 번째 묶음의 artifact가 없으면 상태는 `BLOCKED`이며 `main` 병합과 `RELEASE_READY` 판정을 하지 않는다. 사용자의 현재 데스크톱에서는 실제 UI 입력을 실행하지 않는다.
