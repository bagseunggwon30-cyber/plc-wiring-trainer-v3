# 소스 근거 보존 영역

이 디렉터리는 런타임 자산이 아니라 전기 프로필과 과거 단자 보정의 감사 근거입니다. 포터블 publish에는 포함하지 않습니다.

- `manuals/`: 제조사 매뉴얼 원본 30개
- `official-manual-inventory.md`: 품번 일치 상태, 페이지, SHA-256 감사표
- `terminal-calibration/`: 4.0 이전 단자 보정 JSON 원본 2개
- `legacy-3d-evidence-manifest.json`: 제거된 3D 모델이 어떤 매뉴얼·페이지·해시를 사용했는지 남긴 감사 기록

`legacy-3d-evidence-manifest.json`의 GLB/Blend 경로는 역사적 증거이며 활성 파일을 뜻하지 않습니다. 4.0 활성 이미지와 해시는 `native/PlcWiringTrainer.App/Assets/device-assets.v4.json`만 권위 있는 매니페스트로 사용합니다.
