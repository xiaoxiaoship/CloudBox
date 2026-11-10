import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UpdateService } from '../../src/core/services/updateService.ts';
import type { SettingsService } from '../../src/core/services/settingsService.ts';
import { createTestServer, TEST_PASSWORD } from '../helpers/testServer.ts';

function service(fetchImpl: typeof fetch, now = () => Date.now()): UpdateService {
  const settings = { get: () => 'owner/repo' } as unknown as SettingsService;
  return new UpdateService({ settings, fetchImpl, now });
}

describe('update service', () => {
  it('解析 GitHub Release 并比对版本，带 User-Agent 和缓存', async () => {
    let calls = 0;
    let userAgent = '';
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls += 1;
      userAgent = String(new Headers(init?.headers).get('user-agent'));
      return new Response(JSON.stringify({
        tag_name: 'v1.2.0',
        body: 'release notes',
        html_url: 'https://github.com/owner/repo/releases/tag/v1.2.0',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const update = service(fetchImpl);
    const first = await update.check('1.1.0');
    assert.equal(first.hasUpdate, true);
    assert.equal(first.latestVersion, '1.2.0');
    assert.equal(first.releaseNotes, 'release notes');
    assert.match(first.downloadUrl, /releases\/tag\/v1\.2\.0/);
    assert.match(userAgent, /CloudBox/);

    await update.check('1.1.0');
    assert.equal(calls, 1, '12 小时缓存不应重复请求 GitHub');
  });

  it('相同或更低版本不提示更新', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      tag_name: 'v1.0.0',
      body: '',
      html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
    }), { status: 200 })) as typeof fetch;
    const result = await service(fetchImpl).check('1.0.0');
    assert.equal(result.hasUpdate, false);
  });
});


describe('system update route', () => {
  it('普通用户 GET /api/system/check-update 被拒绝', async () => {
    const t = await createTestServer();
    t.services.update.check = async () => ({
      hasUpdate: true,
      currentVersion: '0.1.0',
      latestVersion: '9.9.9',
      releaseNotes: 'mock release',
      downloadUrl: 'https://github.com/xiaoxiaoship/CloudBox/releases/tag/v9.9.9',
    });
    try {
      await t.client.login(t.user.username, TEST_PASSWORD);
      const response = await t.client.request('/api/system/check-update');
      assert.equal(response.status, 403);
    } finally {
      await t.close();
    }
  });
});
