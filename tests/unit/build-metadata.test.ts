import { describe, expect, it } from 'vitest';
import { buildMetadata } from '../../src/renderer/build-metadata';

describe('buildMetadata', () => {
  it('uses the package version for every renderer surface', () => {
    expect(buildMetadata('2.2.0')).toEqual({
      version: '2.2.0',
      displayVersion: 'v2.2.0',
      title: '박승권의 결선 작업장 v2.2.0',
    });
  });

  it('rejects an empty version', () => {
    expect(() => buildMetadata('')).toThrow('App version is required');
  });
});

