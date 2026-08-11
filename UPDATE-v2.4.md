# PLC Wiring Trainer v2.4.0 업데이트

## 적용 방법

1. 기존 프로젝트를 별도 폴더에 백업한다.
2. 업데이트 전용 ZIP의 내용을 기존 v2.3 프로젝트 루트에 덮어쓴다.
3. 브라우저 실행은 `index.html`을 열거나 로컬 HTTP 서버를 사용한다.
4. Electron 실행 환경에서는 정상 npm registry에서 `npm install` 후 `npm start`를 실행한다.

## 주요 변경

- 장비팩·랙·아날로그·Modbus·드라이브 코드를 `src/` 외부 모듈로 분리
- XBC-DR32H와 XBE/XBF/XBL 증설 모듈의 슬롯 배정 및 XG5000 P 주소 미리보기
- `XBL-C41A`, `XBF-PD02A`, V/I 신호 발생기, 4~20mA 압력 트랜스미터 추가
- 아날로그 전압·전류·RAW·공학값 계산
- PT100·K형 열전대 값과 단선 상태 계산
- XY-MD02 Modbus RTU 버스·국번·통신 형식·레지스터 모델
- iG5A 목표 주파수·가감속·rpm·전류 모델
- 통합 장비 설정 창
- 신규 미션 `g21`~`g23`
- 프로젝트 스키마 6

## 호환성

v2.3의 `analogConfig`, `modbus`, `driveConfig`, `MY-MD02` 저장 데이터를 계속 읽는다. 랙 주소는 프로젝트를 불러온 뒤 현재 장비 배치와 고정 슬롯 설정을 기준으로 다시 계산한다.

## 검증

```text
npm test: 61/61 통과
장비 타입: 71종
메뉴 노출 장비: 61종
단자: 804개
미션: 24개
```

## 아직 포함되지 않은 기능

- XG-SIM·XP-Builder 실제 Bridge
- XBF-PD02A 축 궤적·원점복귀
- 실제 Modbus RTU 프레임·CRC
- Windows EXE 빌드 결과
