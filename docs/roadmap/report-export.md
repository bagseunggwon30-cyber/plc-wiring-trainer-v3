# 보고서 출력 재도입 조건

현재 제품은 canonical JSON, pin-to-pin CSV, cable/core CSV, 단자 계획 CSV, BOM CSV를 네이티브 메뉴에서 제공합니다. HTML 중간 문서를 사용하지 않으며 CSV formula injection을 차단합니다.

PDF/XPS와 캔버스 PNG를 추가할 때는 다음 정보를 고정해야 합니다.

- 문서 ID, revision, content hash
- 검증 시나리오와 각 문제의 typed target
- 활성 장비 프로필 버전과 근거 등급
- 사용한 매뉴얼 ID·쪽·SHA-256
- 교육용 자산과 manual-verified 자산의 명확한 구분

검증 결과가 `STALE`이거나 차단 오류가 있으면 승인 보고서를 발급할 수 없습니다.
