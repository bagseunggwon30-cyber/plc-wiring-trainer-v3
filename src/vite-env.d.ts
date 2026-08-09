/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
  APP_VERSION: string;
  WorkshopDesktop?: {
    saveReportPdf(html: string, filename: string): Promise<{ saved: boolean; filePath?: string }>;
    xgSim: {
      selectProject(): Promise<{
        selected: boolean;
        reference?: {
          schemaVersion: 1;
          absolutePath: string;
          fileName: string;
          sizeBytes: number;
          modifiedAt: string;
          sha256: string;
        };
      }>;
      probe(payload: { base: number; slot: number }): Promise<Record<string, unknown>>;
      connect(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
      readSnapshot(): Promise<Record<string, unknown>>;
      writeInputImage(payload: { values: Record<string, boolean> }): Promise<Record<string, unknown>>;
      getStatus(): Promise<Record<string, unknown>>;
      disconnect(): Promise<Record<string, unknown>>;
    };
  };
}
