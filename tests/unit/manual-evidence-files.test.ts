import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES, verifiedProfiles } from '../../src/catalog/profiles';

const EVIDENCE_PATHS: Readonly<Record<string, string>> = {
  '02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf': 'pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf',
  'LS_XGT_Panel_eXP2_HW_Manual_EN_V1.5.pdf': 'pdf/official/LS_XGT_Panel_eXP2_HW_Manual_EN_V1.5.pdf',
  'LS_XP_Communication_Manual_EN_V2.2.pdf': 'pdf/official/LS_XP_Communication_Manual_EN_V2.2.pdf',
  '03_LS_XBF-AH04A_Installation_Guide.pdf': 'pdf/03_LS_XBF-AH04A_Installation_Guide.pdf',
  '03_LS_XGB_Analog_Manual_KR.pdf': 'pdf/03_LS_XGB_Analog_Manual_KR.pdf',
  '01_MDR-100-24_MeanWell_SPEC.pdf': 'pdf/01_MDR-100-24_MeanWell_SPEC.pdf',
  '08_LS_Metasol_MC_Contactor_Catalog.pdf': 'pdf/08_LS_Metasol_MC_Contactor_Catalog.pdf',
  'Omron_MY_Series_J219-E1.pdf': 'pdf/official/Omron_MY_Series_J219-E1.pdf',
  'Schneider_EOCR_Digital_E_Instruction_2023.pdf': 'pdf/official/Schneider_EOCR_Digital_E_Instruction_2023.pdf',
  'Phoenix_UT-2.5_3044076.pdf': 'pdf/official/Phoenix_UT-2.5_3044076.pdf',
  'Phoenix_UT-2.5-PE_3044092.pdf': 'pdf/official/Phoenix_UT-2.5-PE_3044092.pdf',
  'Phoenix_UT-4-HESI-5x20_3046032.pdf': 'pdf/official/Phoenix_UT-4-HESI-5x20_3046032.pdf',
};

const FAMILY_REFERENCE_HASHES: Readonly<Record<string, string>> = {
  'pdf/04_LS_SV-iG5A_User_Manual.pdf': '2800AD2B47AA3E5058C49ED1684839EC644F2E0E1CB7F91542C453E2458A500E',
  'pdf/official/LS_SV-iG5A_User_Manual_EN_V2.4.pdf': '974654E65A7D0B61476CA64FD180BC3E0C96DE0407A2080012DFE879A2F7A950',
  'pdf/04b_LS_iG5A_Troubleshooting.pdf': '2FFB686764BAA9046BEF156EAB39F2D2CA52A4D52025AECFBE927681497BA7B5',
  'pdf/05_Mitsubishi_MR-J4-B_RJ_Servo_Manual.pdf': '243D8A7DCAE1D6E7F922E71F4B65D94EC31BC3F50F245AD487976FF646F0E6E4',
  'pdf/07_Schneider_EOCR_User_Manual.pdf': '60BB28F38DC45ACD162638EDB5691707CB3BA28DE2E116894CB827E2200519E0',
  'pdf/07_EOCR-3DE_FDE_Datasheet.pdf': 'C5CB4AD2B207FC7110A5356135E2A7244A408506A5BFCAB84B3BD2ECADFCC764',
};

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

describe('retained official manual evidence', () => {
  it('keeps every manual-verified document byte-for-byte aligned with its catalog hash', () => {
    const documents = verifiedProfiles().flatMap((profile) => profile.evidence.documents);
    expect(new Set(documents.map((document) => document.documentId)))
      .toEqual(new Set(Object.keys(EVIDENCE_PATHS)));

    for (const document of documents) {
      const relativePath = EVIDENCE_PATHS[document.documentId];
      expect(relativePath, document.documentId).toBeTruthy();
      expect(sha256(resolve(process.cwd(), relativePath)), document.documentId).toBe(document.sha256);
    }
  });

  it('retains the official iG5A family manual used by the educational terminal semantics', () => {
    const profile = DEVICE_PROFILES['ls-electric:sv-ig5a'];
    const document = profile.evidence.documents.find((entry) => entry.documentId === 'LS_SV-iG5A_User_Manual_EN_V2.4.pdf');

    expect(profile.evidence.level).toBe('educational');
    expect(document).toMatchObject({ pages: [21, 26, 27] });
    expect(sha256(resolve(process.cwd(), 'pdf/official/LS_SV-iG5A_User_Manual_EN_V2.4.pdf'))).toBe(document?.sha256);
  });

  it('retains official family references without promoting an unspecified order code', () => {
    for (const [relativePath, expectedHash] of Object.entries(FAMILY_REFERENCE_HASHES)) {
      expect(sha256(resolve(process.cwd(), relativePath)), relativePath).toBe(expectedHash);
    }

    expect(DEVICE_PROFILES['ls-electric:sv-ig5a'].evidence.level).toBe('educational');
  });
});
