import { validateDomainV3, type SerializableV3ValidationRequest } from './domain-validation-core';

interface WorkerRequest {
  requestId: number;
  request: SerializableV3ValidationRequest;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(value: unknown): void;
};

scope.onmessage = (event) => {
  void validateDomainV3(event.data.request).then(
    (result) => scope.postMessage({ requestId: event.data.requestId, ok: true, result }),
    (error: unknown) => scope.postMessage({
      requestId: event.data.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
};
