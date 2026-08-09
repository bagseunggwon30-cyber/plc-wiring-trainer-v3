import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES } from '../../src/catalog/profiles';
import { DEVICE_PROFILES_V3 } from '../../src/catalog/v3-profiles';
import {
  createXbcDr32hSelfHoldSliceDefinition,
  createXbcDr32hSelfHoldWorkshopV2,
} from '../../src/domain/device-runtime';
import {
  MockPlcRuntimeAdapter,
  XbcClosedLoopSessionController,
  createXbcDr32hSelfHoldManifest,
  type PlcInputImage,
  type PlcInputWriteResult,
  type PlcRuntimeAdapter,
  type PlcRuntimeConnectRequest,
  type PlcRuntimeConnection,
  type PlcRuntimeStatus,
  type XgSimLocalProjectRefV1,
} from '../../src/domain/plc-runtime';
import { buildPrewireCircuitV3 } from '../../src/domain/v3';

const projectSha256 = 'a'.repeat(64);
const manifest = createXbcDr32hSelfHoldManifest({
  projectSha256,
  checkedAt: '2026-08-09T00:00:00.000Z',
  xg5000Version: 'fixture',
  xgSimVersion: 'fixture',
});
const projectReference: XgSimLocalProjectRefV1 = {
  schemaVersion: 1,
  absolutePath: 'C:\\Users\\bark\\Desktop\\4층_GEMINI\\4층_GEMINI.xgwx',
  fileName: '4층_GEMINI.xgwx',
  sizeBytes: 1024,
  modifiedAt: '2026-08-09T00:00:00.000Z',
  sha256: projectSha256,
};

class RecordingUnverifiedAdapter implements PlcRuntimeAdapter {
  readonly writes: PlcInputImage[] = [];
  readonly inner: MockPlcRuntimeAdapter;

  constructor() {
    let run = false;
    this.inner = new MockPlcRuntimeAdapter(({ inputs }) => {
      const stopPressed = inputs['stop-input'] === true;
      const start = inputs['start-input'] === true;
      run = stopPressed ? false : start || run;
      return { 'run-output': run };
    });
  }

  probe: PlcRuntimeAdapter['probe'] = (request) => this.inner.probe(request);

  async connect(request: PlcRuntimeConnectRequest): Promise<PlcRuntimeConnection> {
    const connection = await this.inner.connect(request);
    return { ...connection, projectIdentityVerified: false };
  }

  readSnapshot: PlcRuntimeAdapter['readSnapshot'] = () => this.inner.readSnapshot();

  async writeInputImage(image: PlcInputImage): Promise<PlcInputWriteResult> {
    this.writes.push(structuredClone(image));
    return this.inner.writeInputImage(image);
  }

  async getStatus(): Promise<PlcRuntimeStatus> {
    const status = await this.inner.getStatus();
    return { ...status, projectIdentityVerified: false };
  }

  disconnect: PlcRuntimeAdapter['disconnect'] = () => this.inner.disconnect();
}

async function workshop(options: { openCoilReturn?: boolean } = {}) {
  const document = createXbcDr32hSelfHoldWorkshopV2();
  if (options.openCoilReturn) {
    document.wires = document.wires.filter((wire) => wire.id !== 'sh-w13');
  }
  return (await buildPrewireCircuitV3(document, DEVICE_PROFILES, DEVICE_PROFILES_V3)).document;
}

function controller(adapter: PlcRuntimeAdapter, selectedManifest = manifest) {
  let now = 0;
  return new XbcClosedLoopSessionController({
    adapter,
    manifest: selectedManifest,
    definition: createXbcDr32hSelfHoldSliceDefinition(),
    stableSnapshotClock: {
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
    },
    sessionNonce: () => '1'.repeat(32),
    timestamp: () => '2026-08-09T00:00:00.000Z',
  });
}

describe('XBC-DR32H XG-SIM closed-loop session', () => {
  it('blocks runtime preflight while the exact project Program Check is still pending', async () => {
    const pendingManifest = createXbcDr32hSelfHoldManifest({
      projectSha256,
      programCheckStatus: 'PENDING',
      checkedAt: null,
      xg5000Version: 'fixture',
      xgSimVersion: 'fixture',
    });
    const session = controller(new RecordingUnverifiedAdapter(), pendingManifest);
    const result = await session.preflight({
      workshop: await workshop(),
      projectReference,
      userConfirmedProjectLoaded: true,
    });
    expect(result.ready).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('PROGRAM_CHECK_REQUIRED');
  });

  it('runs idle, start, hold, stop, release and safe-stop while retaining the identity block', async () => {
    const adapter = new RecordingUnverifiedAdapter();
    const session = controller(adapter);
    const document = await workshop();

    const preflight = await session.preflight({
      workshop: document,
      projectReference,
      userConfirmedProjectLoaded: true,
    });
    expect(preflight.ready).toBe(true);
    expect(session.snapshot.state).toBe('ready');
    await session.connect(document);
    const result = await session.runAutomaticTest(document);

    expect(result.outcome).toBe('ROUNDTRIP_PASS');
    expect(result.steps.map((step) => [step.id, step.frame.plcInputs, step.frame.plcOutputs['run-output']])).toEqual([
      ['initial', { 'start-input': false, 'stop-input': false }, false],
      ['start-pressed', { 'start-input': true, 'stop-input': false }, true],
      ['start-released', { 'start-input': false, 'stop-input': false }, true],
      ['stop-pressed', { 'start-input': false, 'stop-input': true }, false],
      ['stop-released', { 'start-input': false, 'stop-input': false }, false],
    ]);
    expect(result.assessment?.status).toBe('BLOCKED');
    expect(result.assessment?.issueCodes).toContain('PROJECT_IDENTITY_UNVERIFIED');
    expect(result.safeStop).toMatchObject({
      allInputsForcedOff: true,
      runOutputObservedOff: true,
      disconnected: true,
      safeInputValues: { 'start-input': false, 'stop-input': true },
    });
    expect(adapter.writes.at(-1)?.values).toEqual({ 'start-input': false, 'stop-input': true });
    expect(session.snapshot.state).toBe('safe-stopped');
  });

  it('records ROUNDTRIP_FAIL instead of energizing a relay with an open coil return', async () => {
    const adapter = new RecordingUnverifiedAdapter();
    const session = controller(adapter);
    const document = await workshop({ openCoilReturn: true });
    await session.preflight({ workshop: document, projectReference, userConfirmedProjectLoaded: true });
    await session.connect(document);

    const result = await session.runAutomaticTest(document);

    expect(result.outcome).toBe('ROUNDTRIP_FAIL');
    expect(result.issueCodes).toContain('PLC_OUTPUT_LOAD_INACTIVE');
    expect(result.safeStop.disconnected).toBe(true);
  });

  it('marks document changes stale and immediately clears every writable simulator input', async () => {
    const adapter = new RecordingUnverifiedAdapter();
    const session = controller(adapter);
    const document = await workshop();
    await session.preflight({ workshop: document, projectReference, userConfirmedProjectLoaded: true });
    await session.connect(document);

    await session.markStale('document-changed');

    expect(session.snapshot).toMatchObject({ state: 'stale', outcome: 'INTERRUPTED' });
    expect(adapter.writes.at(-1)?.values).toEqual({ 'start-input': false, 'stop-input': true });
    expect((await adapter.getStatus()).state).toBe('disconnected');
  });
});
