import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LOW_LEVEL_SECURITY,
  clampLowLevelSecurity,
  parseLowLevelSecurity,
} from '../../src/shared/lowLevelSecurity.ts';

describe('low-level security defaults', () => {
  it('merges partial stored values with safe defaults', () => {
    const parsed = parseLowLevelSecurity(JSON.stringify({ apiRateLimit: 42, tlsMinVersion: 'TLSv1.3' }));
    assert.equal(parsed.apiRateLimit, 42);
    assert.equal(parsed.uploadRateLimit, DEFAULT_LOW_LEVEL_SECURITY.uploadRateLimit);
    assert.equal(parsed.tlsMinVersion, 'TLSv1.3');
  });

  it('ignores malformed stored JSON', () => {
    assert.deepEqual(parseLowLevelSecurity('{not-json'), DEFAULT_LOW_LEVEL_SECURITY);
  });

  it('clamps invalid numeric values in IPC input', () => {
    const clamped = clampLowLevelSecurity({ apiRateLimit: -1, uploadRateLimit: Number.NaN, maxListEntries: 321 });
    assert.equal(clamped.apiRateLimit, DEFAULT_LOW_LEVEL_SECURITY.apiRateLimit);
    assert.equal(clamped.uploadRateLimit, DEFAULT_LOW_LEVEL_SECURITY.uploadRateLimit);
    assert.equal(clamped.maxListEntries, 321);
  });
});
