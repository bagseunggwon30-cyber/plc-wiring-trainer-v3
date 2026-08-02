import { describe, expect, it } from 'vitest';
import { buildMetadata } from '../../src/renderer/build-metadata';

describe('buildMetadata', () => {
  it('uses the package version for every renderer surface', () => {
    expect(buildMetadata('3.0.0')).toEqual({
      version: '3.0.0',
      displayVersion: 'v3.0.0',
      title: '박승권의 결선 작업장 v3.0.0',
    });
  });

  it('rejects an empty version', () => {
    expect(() => buildMetadata('')).toThrow('App version is required');
  });
});
