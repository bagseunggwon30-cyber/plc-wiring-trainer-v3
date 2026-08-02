# 장비 매뉴얼 PDF (이 폴더에 파일로 저장됨)

위치: `plc-wiring-trainer\pdf\`

아래 파일들은 **링크로만 적어 둔 것이 아니라**, 이 폴더에 **실제 PDF 파일**로 받아 둔 것입니다.  
탐색기에서 더블클릭하면 바로 열립니다.

---

## LS ELECTRIC (공식 사이트에서 다운로드한 파일)

| 파일명 | 장비 |
|--------|------|
| `02_LS_XBC_XGB_Economic_Standard_Manual_EN.pdf` | XBC-DR32H / XGB PLC 본체 |
| `02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf` | XGB 하드웨어·배선 (DR32H 포함) |
| `02_LS_XGB_Series_Catalog_EN.pdf` | XGB 시리즈 카탈로그 |
| `03_LS_XBF-AH04A_Installation_Guide.pdf` | XBF-AH04A 설치 가이드 |
| `03_LS_XGB_Analog_Manual_KR.pdf` | XGB 아날로그 모듈 (AH04A 등) |
| `04_LS_SV-iG5A_User_Manual.pdf` | SV-iG5A 인버터 |
| `04b_LS_iG5A_Troubleshooting.pdf` | iG5A 트러블슈팅 |
| `08_LS_Metasol_MC_Contactor_Catalog.pdf` | Metasol MC 전자접촉기 |

현재 코드가 직접 참조하는 iG5A 근거는 PDF 19쪽(제어 I/O 단자 역할), 24쪽(단자 배열·정격), 25쪽(S8 NPN/PNP 입력 선택)입니다. 이 자료로 `CM`, `MG`, `MO`, `24`, `VR`, `V1`, `I`, `AM`, `3A/3B/3C`, `S+/S-` 의미를 구분하고, NPN의 내부 24V→입력회로→P→접점→CM 경로와 PNP의 외부 +24V→접점→P→입력회로→CM→외부 0V 경로를 별도로 풉니다. 전체 주문코드와 전원 등급이 확정되지 않아 프로필 등급은 계속 `educational`입니다.

## 기타 제조사 (파일로 저장됨)

| 파일명 | 장비 |
|--------|------|
| `01_MDR-100-24_MeanWell_SPEC.pdf` | Mean Well MDR-100-24 |
| `01_MDR_DIN_rail_Install.pdf` | MDR DIN 레일 설치 |
| `05_Mitsubishi_MR-J4-B_RJ_Servo_Manual.pdf` | 미쓰비시 MR-J4 서보 |
| `06_XY-MD02_TempHumidity_Modbus_Manual.pdf` | XY-MD02 온습도 |
| `06_XY-MD02_Manual_alt.pdf` | XY-MD02 (대체본) |
| `07_Schneider_EOCR_User_Manual.pdf` | EOCR 사용자 매뉴얼 |
| `07_EOCR-3DE_FDE_Datasheet.pdf` | EOCR-3DE/FDE 데이터시트 |

## 정확 품번 공식 근거 (`pdf/official`, 개발 전용)

| 파일명 | 정확 품번 | 확인 항목 |
|--------|-----------|-----------|
| `Omron_MY_Series_J219-E1.pdf` | `MY2N-D2 DC24V` | 14(+)/13(-) 다이오드 코일, 9-1·12-4 b접, 9-5·12-8 a접, 코일·접점 정격 |
| `Schneider_EOCR_Digital_E_Instruction_2023.pdf` | `EOCR3DE-05DUH` | AC100–240V 제어전원, 95–96 b접, 97–98 a접, 07–08 경보 a접, fail-safe 동작 |
| `Phoenix_UT-2.5_3044076.pdf` | `3044076` | 관통 연결, 1000V/24A, 도체·토크·치수 |
| `Phoenix_UT-2.5-PE_3044092.pdf` | `3044092` | PE 관통 연결과 DIN 레일 보호결합, 도체·토크·치수 |
| `Phoenix_UT-4-HESI-5x20_3046032.pdf` | `3046032` | 5×20 퓨즈형, 500V/6.3A, 퓨즈 링크 별도, 도체·토크·치수 |

이 PDF들은 프로필 근거 해시 검증을 위한 개발 자료이며 Electron 출시 파일에는 포함하지 않습니다. 앱 리포트에는 문서 ID·쪽·SHA-256만 기록합니다.

---

저작권은 각 제조사에 있습니다. 교육·결선 참고용.
