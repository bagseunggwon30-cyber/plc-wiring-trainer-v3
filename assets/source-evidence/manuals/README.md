# 장비 매뉴얼 PDF (이 폴더에 파일로 저장됨)

위치: `plc-wiring-trainer\assets\source-evidence\manuals\`

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
| `08_LS_XBF-PD02A_Positioning_Manual_KR.pdf` | XBF-PD02A 2축 위치결정 모듈 · A/B 40핀 |
| `08_LS_Metasol_MC_Contactor_Catalog.pdf` | Metasol MC 전자접촉기 |
| `09_LS_XGB_Cnet_XBL-C41A_Manual_KR.pdf` | XBL-C41A Cnet · TX/RX/SG 5핀과 RS422/485 배선 |
| `10_LS_XBC_U_Installation_Guide_KR_EN.pdf` | XBC-DN32UP / XBC-DP32UP UP 섀시 · 전면 구조·전원·입출력 커넥터·외형치수 |
| `10_LS_XBC_U_User_Manual_EN.pdf` | XBC-DN32UP / XBC-DP32UP · 입력·NPN/PNP 출력·Cnet·4축 위치결정 40핀 |

현재 코드가 직접 참조하는 iG5A 근거는 `pdf/official/LS_SV-iG5A_User_Manual_EN_V2.4.pdf`의 PDF 21쪽(제어 I/O 단자), 26쪽(제어단자 정격), 27쪽(S8 NPN/PNP 선택)입니다. 이 자료로 `CM`, `MG`, `MO`, `24`, `VR`, `V1`, `I`, `AM`, `3A/3B/3C`, `S+/S-` 의미를 구분하고, NPN의 내부 24V→입력회로→P→접점→CM 경로와 PNP의 외부 +24V→접점→P→입력회로→CM→외부 0V 경로를 별도로 풉니다. 전체 주문코드와 전원 등급이 확정되지 않아 프로필 등급은 계속 `educational`입니다.

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

## 정확 품번 공식 근거 (`assets/source-evidence/manuals/official`, 개발 전용)

| 파일명 | 정확 품번 | 확인 항목 |
|--------|-----------|-----------|
| `LS_XGT_Panel_eXP2_HW_Manual_EN_V1.5.pdf` | `eXP2-0700D` | DC24V/FG 전원, 포트 배치, COM1·COM2·COM3 핀, 배선 굵기·토크 |
| `LS_XP_Communication_Manual_EN_V2.2.pdf` | `eXP2-0700D` 통신 근거 | XGT Panel↔XGB RS485 결선, 종단·실드 지침 |
| `LS_eXP2_Series_Installation_Guide_V1.1.pdf` | `eXP2-07□□D` 참고 | 외형·패널 컷·전원 배선 보조자료. 정확 프로필 근거 해시에는 사용하지 않음 |
| `LS_SV-iG5A_User_Manual_EN_V2.4.pdf` | `SV-iG5A` 계열 참고 | 제어 I/O 단자, 전력 단자, NPN/PNP S8 선택. 전체 주문코드 미확정으로 연습 전용 |
| `LS_XBC_SU_User_Manual_EN_V2.2_202406.pdf` | `XBC-DN60SU` | PDF 135쪽 DI36/COM, 155쪽 NPN 싱크 DO24·COM0~7·24V/24G |
| `LS_XBF_AD04A_AD08A_Installation_Guide_V4.6.pdf` | `XBF-AD04A`, `XBF-AD08A` | 채널별 ± 입력, 전압/전류 선택, 외부 DC24V, 결선 예 |
| `LS_XBF_DV04A_DC04A_DC04B_Installation_Guide_V4.9.pdf` | `XBF-DV04A`, `XBF-DC04A` | 채널별 ± 출력, 전압/전류 범위, 외부 DC24V, 실드 배선 |
| `LS_XBF_RD01A_RD04A_Installation_Guide_V4.4.pdf` | `XBF-RD04A` | PT100/JPT100 A/B/b 2·3·4선식과 DC24V 결선 |
| `LS_XBF_TC04S_Installation_Guide_V4.6.pdf` | `XBF-TC04S` | K/J/T/R 열전대 채널 ±, 보상도선, DC24V 결선 |
| `Schneider_EOCR_Digital_E_Instruction_2023.pdf` | `EOCR3DE-05DUH` | AC100–240V 제어전원, 95–96 b접, 97–98 a접, 07–08 경보 a접, fail-safe 동작 |

이 PDF들은 프로필 근거 해시 검증을 위한 개발 자료이며 Electron 출시 파일에는 포함하지 않습니다. 앱 리포트에는 문서 ID·쪽·SHA-256만 기록합니다.

`XBC-DN32UP`/`XBC-DP32UP`은 185×90×64 mm UP 섀시, 전원 N/L/PE/24V/24G, DI16, 모델별 NPN 싱크/PNP 소스 DO16, 내장 Cnet 5핀과 4축 위치결정 40핀×2를 공식 자료로 분리했습니다. 생성 이미지는 외형 스킨일 뿐이며 단자 ID·클릭 좌표·전기 의미는 SVG 오버레이와 프로필이 담당합니다. 포인터 교정 승인이 끝나기 전에는 `profile-only`로 차단합니다.

현재 생성 스킨의 I/O 구멍 수는 공식 8+10 배열과 달라 승인 대상이 아닙니다. 앱은 잘못된 구멍을 그대로 클릭 대상으로 쓰지 않고 매뉴얼 기반 SVG 커넥터로 덮으며, 126개 가시 중심과 히트 중심의 브라우저 RMS/최대오차를 별도로 기록합니다. 외형 자산과 전기 geometry 승인은 서로 독립입니다.

`XBL-C41A`는 5핀·RS485 브리지·20×90×60 mm 외형까지, `XBF-PD02A`는 500 mA·65 g 사양과 40핀·내부 회로까지 확인했습니다. PD02A의 정확 외형 치수, 두 장비의 승인된 화면 geometry와 전체 동작 모델은 아직 없으므로 검토 모드에서는 `profile-only`로 차단합니다. 매뉴얼 보유가 곧 통과 자격을 뜻하지 않습니다.

팔레트 전체의 공식 문서 보유·품번 미확정 상태는 `assets/source-evidence/official-manual-inventory.md`에 기록합니다. 전체 품번이 없는 일반 장비에는 비슷한 제품의 매뉴얼을 임의 연결하지 않습니다.

---

저작권은 각 제조사에 있습니다. 교육·결선 참고용.
