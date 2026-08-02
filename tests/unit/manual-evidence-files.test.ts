import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES, verifiedProfiles } from '../../src/catalog/profiles';

const EVIDENCE_PATHS: Readonly<Record<string, string>> = {
  '02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf': 'pdf/02_LS_XGB_Hardware_XBC-DR32H_Manual_EN.pdf',
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
    const document = profile.evidence.documents.find((entry) => entry.documentId === '04_LS_SV-iG5A_User_Manual.pdf');

    expect(profile.evidence.level).toBe('educational');
    expect(document).toMatchObject({ pages: [19, 24, 25] });
    expect(sha256(resolve(process.cwd(), 'pdf/04_LS_SV-iG5A_User_Manual.pdf'))).toBe(document?.sha256);
  });
});
