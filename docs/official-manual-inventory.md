# 공식 매뉴얼 보유·미확정 장비 감사

감사 기준일: 2026-08-05

이 문서는 팔레트의 모든 장비를 다음 세 상태로 구분한다.

- `exact-manual`: 전체 주문코드와 공식 제조사 문서가 일치하고 로컬 PDF의 SHA-256을 검증한다.
- `family-only`: 공식 계열 문서는 있지만 전원·출력·코일·커넥터 suffix가 확정되지 않아 연습용으로만 쓴다.
- `order-code-required`: 제조사와 전체 품번이 없으므로 비슷한 제품의 매뉴얼을 임의로 붙이지 않는다. 검토 모드에서는 `BLOCKED`다.

PDF는 개발 근거이며 Electron 배포 파일에는 포함하지 않는다.

## exact-manual

| 프로필 / 정확 품번 | 로컬 공식 문서 | SHA-256 |
|---|---|---|
| LS ELECTRIC `XBC-DR32H` | `pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf` | `4C1BBB7C60CC2DC80221B67CFE7AD11CA360C9DB12B7F1B36171CF12C8BF18AA` |
| LS ELECTRIC `eXP2-0700D` | `pdf/official/LS_XGT_Panel_eXP2_HW_Manual_EN_V1.5.pdf` | `7B24C37B791224FC7744413589C853A348065C0746ED9AEE258070F99A4EBBF9` |
| LS ELECTRIC `eXP2-0700D` 통신 | `pdf/official/LS_XP_Communication_Manual_EN_V2.2.pdf` | `DAFD6867E240989A98EF6C5D3184ACEBD5947A3EB23E39150F05FD97C2399F34` |
| LS ELECTRIC `XBF-AH04A` | `pdf/03_LS_XBF-AH04A_Installation_Guide.pdf` | `36ABFD5C521E01DCB35D4032C230D4B486B4A3D447C4E8E40417D3A908E8F2E8` |
| LS ELECTRIC `XBF-AH04A` 아날로그 상세 | `pdf/03_LS_XGB_Analog_Manual_KR.pdf` | `92BF211773DD2FA2D5C11469546C74E148059F55E53866E05022D229CF9A58AF` |
| MEAN WELL `MDR-100-24` | `pdf/01_MDR-100-24_MeanWell_SPEC.pdf` | `9DE6ABE926DF1D33974544D82989964E828C079F7E8B8E0448AE7667ED16E896` |
| LS ELECTRIC `MC-22b / DC24 / 1a1b` | `pdf/08_LS_Metasol_MC_Contactor_Catalog.pdf` | `BE22BB71FD62046ED15BAE2CC377F3991016C3FF032ADB7AD441F76417136662` |
| OMRON `MY2N-D2 DC24V` | `pdf/official/Omron_MY_Series_J219-E1.pdf` | `2C422A3BA468E3140CE4D3D8D716F6C11AD11A842CA1999F5E7339847170242D` |
| Schneider Electric `EOCR3DE-05DUH` | `pdf/official/Schneider_EOCR_Digital_E_Instruction_2023.pdf` | `B7EFD3B57ACC65EA89656A202E1A30CE01718912FE7115FB2DBFC414507975F3` |
| Phoenix Contact `UT 2,5 / 3044076` | `pdf/official/Phoenix_UT-2.5_3044076.pdf` | `E3D2C7E436C3F7CB39ABC567050C4D5F1B20F41390B3F7525FAF0C3EDA240EA9` |
| Phoenix Contact `UT 2,5-PE / 3044092` | `pdf/official/Phoenix_UT-2.5-PE_3044092.pdf` | `829FB44CB8003DEF4D86B1491D332A3F075DA938C1D705F0050B9A2BB896C09B` |
| Phoenix Contact `UT 4-HESI (5X20) / 3046032` | `pdf/official/Phoenix_UT-4-HESI-5x20_3046032.pdf` | `82AF911117F69DDEB1232BBA5F029E237DEB4BD891FA54DBEA5043FCB734A1F5` |

이번 감사에서 빠져 있던 eXP2 두 문서를 LS ELECTRIC 공식 서버에서 내려받았다. 설치 가이드도 보조 자료로 보존하지만, 정확 프로필의 전기 근거에는 포함하지 않는다.

- 하드웨어 V1.5: `https://sol.ls-electric.com/uploads/document/17216272742650/XGT%20Panel%20HW%20Manual_eXP2_eng_V1.5.pdf`
- XGT Panel 통신 V2.2: `https://sol.ls-electric.com/uploads/document/16407609055050/XP%20Communication_Eng_V2.2.pdf?type=attachment`
- 설치 가이드 V1.1: `https://ssq.ls-electric.com/uploads/document/16825019630460/HMI-7_XGT%2BPanel%2BeXP2_Series_Installation%2BGuide_V1.1.pdf`

## family-only

| 팔레트 타입 | 보유 문서 | 차단 이유 |
|---|---|---|
| `IG5A` | `pdf/official/LS_SV-iG5A_User_Manual_EN_V2.4.pdf` | 전체 인버터 주문코드와 입력 전원 변형 미확정 |
| `SERVO-DRV` | `pdf/05_Mitsubishi_MR-J4-B_RJ_Servo_Manual.pdf` | 드라이브·모터·브레이크·CN1 케이블 세트의 전체 주문코드 미확정 |
| `MC` | `pdf/08_LS_Metasol_MC_Contactor_Catalog.pdf` | GMC-9~22 범위 표기이며 코일 suffix와 보조접점 블록 미확정 |
| `EOCR` | `pdf/07_Schneider_EOCR_User_Manual.pdf`, `pdf/07_EOCR-3DE_FDE_Datasheet.pdf` | `EOCR-SS`의 정확 변형·전원·출력형 미확정 |
| `MY-MD02` | `pdf/06_XY-MD02_TempHumidity_Modbus_Manual.pdf`, `pdf/06_XY-MD02_Manual_alt.pdf` | 공식 제조사 신원과 공식 배포 출처 미확인. 교육용 유지 |

공식 계열 참고문서도 파일 교체나 누락을 감지할 수 있도록 다음 해시를 고정한다. 이 표는 정확 품번 검증으로의 승격을 뜻하지 않는다.

| 로컬 문서 | SHA-256 | 공식 출처 |
|---|---|---|
| `pdf/official/LS_SV-iG5A_User_Manual_EN_V2.4.pdf` | `974654E65A7D0B61476CA64FD180BC3E0C96DE0407A2080012DFE879A2F7A950` | `https://www.ls-electric.com/upload/customer/download/68575ea6-a4ba-4117-8db1-ce531392ffed/iG5A_manual_V2.4_%20110131.pdf` |
| `pdf/04b_LS_iG5A_Troubleshooting.pdf` | `2FFB686764BAA9046BEF156EAB39F2D2CA52A4D52025AECFBE927681497BA7B5` | LS ELECTRIC iG5A 제품 자료실 |
| `pdf/05_Mitsubishi_MR-J4-B_RJ_Servo_Manual.pdf` | `243D8A7DCAE1D6E7F922E71F4B65D94EC31BC3F50F245AD487976FF646F0E6E4` | `https://www.mitsubishielectric.com/fa/products/faspec/download.page?category=ex&formNm=J4B-RJ_MR-J4-10B-RJ_6480&id=spec&kisyu=%2Fservo&lang=2&word=Servo+amplifiers` |
| `pdf/07_Schneider_EOCR_User_Manual.pdf` | `60BB28F38DC45ACD162638EDB5691707CB3BA28DE2E116894CB827E2200519E0` | Schneider Electric EOCR 제품 자료실 |
| `pdf/07_EOCR-3DE_FDE_Datasheet.pdf` | `C5CB4AD2B207FC7110A5356135E2A7244A408506A5BFCAB84B3BD2ECADFCC764` | Schneider Electric EOCR 제품 자료실 |

## order-code-required

아래 타입은 공식 문서가 “없는 것”이 아니라, 어느 제조사의 어떤 제품인지 아직 정하지 않은 교육용 개념 장비다. 정확한 회사 BOM 품번을 받기 전에는 공식 매뉴얼을 임의 선택하지 않는다.

| 범주 | 팔레트 타입 |
|---|---|
| 전원·보호 | `MCCB`, `MCCB1P`, `FUSE`, `FUSE-1`, `PSU24` |
| 모션·기구 | `POS-MOD`, `SERVO-MOTOR`, `LINEAR-RAIL`, `CYL-SA`, `CYL-DA`, `CYL-DA53` |
| 릴레이·조작기기 | `TIMER`, `FLICKER`, `COUNTER`, `PB-1C`, `PB-NO`, `PB-NC`, `EMSTOP`, `SEL-2P`, `SEL-3P` |
| 센서 | `LIMIT`, `ENCODER`, `PROX-NPN`, `PROX-PNP`, `PHOTO`, `PT100` |
| 부하 | `SOL-Y`, `LAMP-G`, `LAMP-Y`, `LAMP-W`, `LAMP`, `BUZZER`, `MOTOR-3P` |
| 일반 단자·분배 | `TB4`, `TB8`, `TB10`, `TB20`, `TB30`, `TB-PE-10`, `TB-N-10`, `TB-24V-10`, `TB-0V-10`, `GND-BAR` |

`BOUNDARY-AC`, `BOUNDARY-DC`, `BOUNDARY-CONTACT`, `BOUNDARY-LOAD`, `BOUNDARY-ANALOG-V`, `BOUNDARY-ANALOG-I`, `BOUNDARY-ANALOG-V-IN`, `BOUNDARY-ANALOG-I-IN`, `BOUNDARY-2W-I`, `BOUNDARY-RS485`는 시험 경계 노드이며 설치 장비나 BOM 품목이 아니므로 제품 매뉴얼 대상에서 제외한다.

## 단자대 해석 원칙

- 일반 관통 단자대의 `1`과 기존 호환 ID `1'`은 서로 다른 단자 번호가 아니라 같은 마커 `1`의 A/B 접속점이다.
- Phoenix Contact `3044076`은 한 potential의 두 나사 접속점이 내부 도통한다.
- `3044092`는 두 PE 접속점과 DIN 레일 보호결합을 갖는다.
- `3046032`는 두 접속점 사이에 5×20 퓨즈가 직렬로 들어가며, 두 접속점을 점퍼로 우회하면 안 된다.
- 제조사 문서가 접속점 번호를 부여하지 않은 경우 앱이 제조사 번호를 발명하지 않는다. 프로젝트 마커와 A/B 접속점을 분리해 표시한다.
