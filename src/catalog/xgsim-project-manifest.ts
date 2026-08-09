import { createXbcDr32hSelfHoldManifest } from '../domain/plc-runtime';

/**
 * Checked local diagnostic project identity. This value is replaced only after
 * XG5000 Program Check succeeds and the saved .xgwx SHA-256 is recorded.
 * XG-SIM still cannot prove that this exact file is the project currently open,
 * so a successful round trip remains formally BLOCKED.
 */
export const XGSIM_CLOSED_LOOP_MANIFEST = createXbcDr32hSelfHoldManifest({
  projectId: '4f-gemini-xbc-self-hold-diagnostic-v1',
  projectFileName: '4층_GEMINI.xgwx',
  projectSha256: '883a5c1f24820a1a45938dc338fd52650b875876b14620ef375055be1ab7da04',
  programCheckStatus: 'PASS',
  checkedAt: '2026-08-09T03:16:58.738Z',
  xg5000Version: '4.78.2.0',
  xgSimVersion: '1.0.0.1',
  warnings: 82,
});
