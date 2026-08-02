import { describe, expect, it, vi } from 'vitest';
import { createDomainV3ValidationPort } from '../../src/renderer/v3/domain-validation-port';
import { createV3WorkflowState } from '../../src/renderer/v3/workflow-state';
import type { WorkshopDocumentV2 } from '../../src/domain/types';
import type { V3ValidationResult } from '../../src/renderer/v3/validation-port';

function document(): WorkshopDocumentV2 {
  return {
    schemaVersion: 2,
    mode: 'prewire',
    revision: 2,
    name: 'domain port fixture',
    source: { kind: 'native-v2', hash: '0'.repeat(64) },
    devices: [
      {
        id: 'dc', profileId: 'boundary:dc-supply', profileVersion: '1.0.0', evidenceLevel: 'educational',
        missingProfile: false, x: 0, y: 0, rotation: 0, configuration: {},
      },
      {
        id: 'lamp', profileId: 'boundary:load', profileVersion: '1.0.0', evidenceLevel: 'educational',
        missingProfile: false, x: 0, y: 0, rotation: 0, configuration: {},
      },
    ],
    wires: [{ id: 'positive-only', from: { deviceId: 'dc', terminalId: '+' }, to: { deviceId: 'lamp', terminalId: '+' } }],
    jumpers: [], layout: {}, settings: {}, extensions: { legacy: {} },
  };
}

class FakeValidationWorker {
  messageListener: ((event: MessageEvent<{ requestId: number; ok: boolean; result?: V3ValidationResult }>) => void) | null = null;
  errorListener: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly respond: boolean) {}

  addEventListener(type: 'message' | 'error', listener: ((event: MessageEvent<{ requestId: number; ok: boolean; result?: V3ValidationResult }>) => void) | ((event: ErrorEvent) => void)): void {
    if (type === 'message') this.messageListener = listener as typeof this.messageListener;
    else this.errorListener = listener as typeof this.errorListener;
  }

  postMessage(message: { requestId: number }): void {
    if (!this.respond) return;
    this.messageListener?.({ data: {
      requestId: message.requestId,
      ok: true,
      result: {
        classification: 'DIAGNOSTIC',
        validation: { status: 'PASS', issues: [], documentRevision: 2, documentHash: '0'.repeat(64), checkedAt: 'now' },
      },
    } } as unknown as MessageEvent<{ requestId: number; ok: boolean; result: V3ValidationResult }>);
  }

  terminate(): void { this.terminated = true; }
  fail(message: string): void { this.errorListener?.({ message } as ErrorEvent); }
}

describe('concrete renderer v3 validation port', () => {
  it('uses the closed-loop domain engine and never delegates electrical truth to v2', async () => {
    const legacy = vi.fn(async () => { throw new Error('legacy validator must not run'); });
    const workflow = createV3WorkflowState({
      sourceSystem: { id: 'dc-24v-isolated', label: 'DC 24 V isolated source' },
      earthingPolicy: 'PE_SEPARATE_0V_FLOATING',
      reviewScope: { templateId: 'control-panel-prewire', deviceIds: ['dc', 'lamp'] },
    });
    const source = document();
    source.settings.v3Workflow = workflow;

    const result = await createDomainV3ValidationPort().validate({
      document: source,
      mode: 'prewire',
      workflow,
      validateLegacy: legacy,
    });

    expect(legacy).not.toHaveBeenCalled();
    expect(result.validation.status).toBe('FAIL');
    expect(result.validation.issues.map((entry) => entry.code)).toContain('OPEN_RETURN_PATH');
    expect(result.classification).toBe('DIAGNOSTIC');
    expect(result.circuitSolution?.loads.lamp.energized).toBe(false);
  });

  it('terminates and replaces a failed Worker before the next validation request', async () => {
    const workers: FakeValidationWorker[] = [];
    const port = createDomainV3ValidationPort({
      createWorker: () => {
        const worker = new FakeValidationWorker(workers.length > 0);
        workers.push(worker);
        return worker;
      },
    });
    const request = { document: document(), mode: 'prewire' as const, workflow: createV3WorkflowState({}), validateLegacy: async () => { throw new Error('unused'); } };

    const first = port.validate(request);
    workers[0].fail('crashed');
    await expect(first).resolves.toMatchObject({ validation: { status: 'BLOCKED' } });
    expect(workers[0].terminated).toBe(true);
    await expect(port.validate(request)).resolves.toMatchObject({ validation: { status: 'PASS' } });
    expect(workers).toHaveLength(2);
  });

  it('terminates a timed-out Worker so a later request can restart cleanly', async () => {
    const workers: FakeValidationWorker[] = [];
    const port = createDomainV3ValidationPort({
      timeoutMs: 1,
      createWorker: () => {
        const worker = new FakeValidationWorker(workers.length > 0);
        workers.push(worker);
        return worker;
      },
    });
    const request = { document: document(), mode: 'prewire' as const, workflow: createV3WorkflowState({}), validateLegacy: async () => { throw new Error('unused'); } };

    await expect(port.validate(request)).resolves.toMatchObject({ validation: { status: 'BLOCKED' } });
    expect(workers[0].terminated).toBe(true);
    await expect(port.validate(request)).resolves.toMatchObject({ validation: { status: 'PASS' } });
    expect(workers).toHaveLength(2);
  });
});
