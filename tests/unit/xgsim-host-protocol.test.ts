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

  it('allows only IN channels and explicit M devices in writable frames', () => {
    const nonce = '0123456789abcdef0123456789abcdef';
    const outputWrite = createXgSimHostRequest('writeInputImage', nonce, {
      values: { 'B0S00.OUT01': true },
    });
    expect(() => XgSimHostRequestSchema.parse(outputWrite)).toThrow();
    expect(XgSimHostRequestSchema.parse(createXgSimHostRequest('writeInputImage', nonce, {
      values: { M00001: true, M00002: false, M0000A: true },
    }))).toBeTruthy();
    expect(() => XgSimHostRequestSchema.parse(createXgSimHostRequest('writeInputImage', nonce, {
      values: { M00A01: true },
    }))).toThrow();

    const values = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `B0S00.IN${String(index).padStart(2, '0')}`,
      false,
    ]));
    const oversized = createXgSimHostRequest('writeInputImage', nonce, { values });
    expect(() => XgSimHostRequestSchema.parse(oversized)).toThrow();
  });

  it('requires separate device read/write allowlists and fail-safe values', () => {
    const request = createXgSimHostRequest('connect', '0123456789abcdef0123456789abcdef', {
      base: 0,
      slot: 0,
      cpuModel: 'XGB-XBCH',
      projectId: '4f-gemini',
      projectSha256: 'a'.repeat(64),
      allowedInputs: [],
      allowedOutputs: [],
      allowedDeviceWrites: ['M00001', 'M00002'],
      allowedDeviceReads: ['M00100'],
      deviceFailSafeValues: { M00001: false, M00002: true },
    });
    expect(XgSimHostRequestSchema.parse(request)).toEqual(request);
  });
});
