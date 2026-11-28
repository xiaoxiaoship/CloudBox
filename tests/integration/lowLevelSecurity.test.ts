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
    assert.equal(clampLowLevelSecurity({ guestLinkTtlHours: 0 }).guestLinkTtlHours, 0);
  });

  it('provides defaults for avatar, plugin, extraction and admin lifetime settings', () => {
    const parsed = parseLowLevelSecurity(null);
    assert.equal(parsed.maxAvatarBytes, 900_000);
    assert.equal(parsed.pluginPackageBytes, 20 * 1024 * 1024);
    assert.equal(parsed.pluginPackageEntries, 2_000);
    assert.equal(parsed.pluginUncompressedBytes, 64 * 1024 * 1024);
    assert.equal(parsed.pluginEntryBytes, 16 * 1024 * 1024);
    assert.equal(parsed.pluginCompressionRatio, 100);
    assert.equal(parsed.extractMaxFiles, 10_000);
    assert.equal(parsed.extractTotalBytes, 50 * 1024 ** 3);
    assert.equal(parsed.extractTimeoutSeconds, 300);
    assert.equal(parsed.adminSessionTtlHours, 4);
    assert.equal(parsed.adminInitTokenTtlHours, 24);
  });

  it('bounds admin lifetimes and resource limits', () => {
    const clamped = clampLowLevelSecurity({
      maxAvatarBytes: 10,
      pluginPackageBytes: 200 * 1024 * 1024,
      pluginPackageEntries: 0,
      extractTimeoutSeconds: 1,
      adminSessionTtlHours: 999,
      adminInitTokenTtlHours: 999,
    });
    assert.equal(clamped.maxAvatarBytes, 1_024);
    assert.equal(clamped.pluginPackageBytes, 100 * 1024 * 1024);
    assert.equal(clamped.pluginPackageEntries, DEFAULT_LOW_LEVEL_SECURITY.pluginPackageEntries);
    assert.equal(clamped.extractTimeoutSeconds, 10);
    assert.equal(clamped.adminSessionTtlHours, 168);
    assert.equal(clamped.adminInitTokenTtlHours, 168);
  });
});
