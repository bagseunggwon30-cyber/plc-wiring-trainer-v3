import { validateDomainV3, type SerializableV3ValidationRequest } from './domain-validation-core';
import type { V3ValidationPort, V3ValidationRequest, V3ValidationResult } from './validation-port';

interface WorkerResponse {
  requestId: number;
  ok: boolean;
  result?: V3ValidationResult;
  error?: string;
}

interface ValidationWorker {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface DomainV3ValidationPortOptions {
  createWorker?: () => ValidationWorker;
  timeoutMs?: number;
}

function blockedWorkerResult(request: V3ValidationRequest, message: string): V3ValidationResult {
  return {
    validation: {
      status: 'BLOCKED',
      issues: [{ code: 'V3_WORKER_ERROR', severity: 'blocked', blocking: true, message, refs: [] }],
      documentRevision: request.document.revision,
      documentHash: request.document.source.hash,
      checkedAt: new Date().toISOString(),
    },
    classification: request.mode === 'practice' ? 'LEGACY_DIAGNOSTIC' : 'DIAGNOSTIC',
  };
}

/** Runs production validation off the renderer thread; Node-only tests use the same pure core directly. */
export function createDomainV3ValidationPort(options: DomainV3ValidationPortOptions = {}): V3ValidationPort {
  let worker: ValidationWorker | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, {
    resolve(result: V3ValidationResult): void;
    timer: ReturnType<typeof setTimeout>;
    request: V3ValidationRequest;
  }>();

  const resetWorker = (message: string): void => {
    const activeWorker = worker;
    worker = null;
    activeWorker?.terminate();
    for (const [requestId, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(blockedWorkerResult(entry.request, message));
    }
  };

  const ensureWorker = (): ValidationWorker | null => {
    if (worker) return worker;
    if (options.createWorker) worker = options.createWorker();
    else {
      if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
      worker = new Worker(new URL('./validation-worker.ts', import.meta.url), { type: 'module', name: 'plc-v3-validation' });
    }
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const entry = pending.get(event.data.requestId);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(event.data.requestId);
      if (event.data.ok && event.data.result) entry.resolve(event.data.result);
      else entry.resolve(blockedWorkerResult(entry.request, event.data.error ?? 'v3 validation Worker failed.'));
    });
    worker.addEventListener('error', (event) => resetWorker(`v3 validation Worker error: ${event.message}`));
    return worker;
  };

  return {
    async validate(request) {
      if (typeof window === 'undefined' && !options.createWorker) {
        const { validateLegacy: _compatibilityOnly, ...serializable } = request;
        return validateDomainV3(serializable);
      }
      let activeWorker: ValidationWorker | null;
      try { activeWorker = ensureWorker(); } catch (error) {
        return blockedWorkerResult(request, `v3 validation Worker could not start: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!activeWorker) return blockedWorkerResult(request, 'v3 validation Worker is unavailable.');
      const requestId = nextRequestId++;
      const { validateLegacy: _compatibilityOnly, ...serializable } = request;
      return new Promise<V3ValidationResult>((resolve) => {
        const timer = setTimeout(() => {
          if (!pending.has(requestId)) return;
          resetWorker(`v3 validation Worker exceeded the ${options.timeoutMs ?? 30_000} ms safety timeout.`);
        }, options.timeoutMs ?? 30_000);
        pending.set(requestId, { resolve, timer, request });
        try {
          activeWorker.postMessage({ requestId, request: serializable satisfies SerializableV3ValidationRequest });
        } catch (error) {
          clearTimeout(timer); pending.delete(requestId);
          resolve(blockedWorkerResult(request, `v3 validation Worker request failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    },
  };
}
