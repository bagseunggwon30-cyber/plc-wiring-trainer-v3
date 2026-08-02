import { describe, expect, it } from 'vitest';
import {
  XGSIM_HOST_PROTOCOL_VERSION,
  XgSimHostRequestSchema,
  createXgSimHostRequest,
} from '../../src/shared/xgsim-host-protocol';

describe('XG-SIM host protocol', () => {
  it('requires a versioned request id and 128-bit session nonce', () => {
    const request = createXgSimHostRequest('probe', '0123456789abcdef0123456789abcdef', {
      base: 0,
      slot: 0,
    });
    expect(request.protocolVersion).toBe(XGSIM_HOST_PROTOCOL_VERSION);
    expect(XgSimHostRequestSchema.parse(request)).toEqual(request);
    expect(() => XgSimHostRequestSchema.parse({ ...request, nonce: 'short' })).toThrow();
  });

  it('rejects output-channel writes and oversized input frames', () => {
    const nonce = '0123456789abcdef0123456789abcdef';
    const outputWrite = createXgSimHostRequest('writeInputImage', nonce, {
      values: { 'B0S00.OUT01': true },
    });
    expect(() => XgSimHostRequestSchema.parse(outputWrite)).toThrow();

    const values = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `B0S00.IN${String(index).padStart(2, '0')}`,
      false,
    ]));
    const oversized = createXgSimHostRequest('writeInputImage', nonce, { values });
    expect(() => XgSimHostRequestSchema.parse(oversized)).toThrow();
  });
});
