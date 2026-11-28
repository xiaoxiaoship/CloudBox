import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { RequestContext } from '../../src/core/services/fileService.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

const ctx: RequestContext = { ip: '127.0.0.1', userAgent: 'host-test', requestId: null };

async function deploySite(
  t: TestServer,
  options: { root?: string; visibility?: 'public' | 'private'; enabled?: boolean } = {},
): Promise<{ root: string }> {
  const root = options.root ?? 'public';
  const enabled = options.enabled ?? true;
  await t.client.request('/api/files/folder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '', name: root }),
  });
  if (enabled) {
    await t.client.upload(
      'index.html',
      Buffer.from('<!doctype html><html><body>HOST_INDEX</body></html>'),
      { path: root },
    );
  }
  await t.services.hosting.save(
    t.user,
    { rootPath: root, enabled, visibility: options.visibility ?? 'public' },
    ctx,
  );
  return { root };
}

describe('static hosting', () => {
  let t: TestServer | null = null;

  afterEach(async () => {
    await t?.close();
    t = null;
  });

  it('基础访问、安全响应头、SPA 回退与路径穿越拦截', async () => {
    t = await createTestServer();
    t.services.settings.set('hosting.enabled', true, null);
    t.services.settings.set('hosting.mode', 'public', null);
    t.services.settings.set('hosting.base_url', 'https://pan.example.com', null);
    await deploySite(t);
    await t.client.upload('app.js', Buffer.from('console.log("host");'), { path: 'public' });
    await t.client.upload('about.html', Buffer.from('ABOUT'), { path: 'public' });

    const saved = t.services.hosting.get(t.user, { protocol: 'http', host: '127.0.0.1:8686' });
    assert.equal(saved.url, 'https://pan.example.com/host/alice/');

    const index = await t.client.request('/host/alice/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await index.text(), /HOST_INDEX/);
    assert.match(index.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(index.headers.get('x-frame-options'), 'DENY');
    assert.equal(index.headers.get('referrer-policy'), 'no-referrer');
    assert.match(index.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    // HTTP 响应不应下发 HSTS，避免污染浏览器缓存
    assert.equal(index.headers.get('strict-transport-security'), null);

    const js = await t.client.request('/host/alice/app.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);

    const spa = await t.client.request('/host/alice/some/route');
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /HOST_INDEX/);

    const missingAsset = await t.client.request('/host/alice/missing.js');
    assert.equal(missingAsset.status, 403);

    const traversal = await t.client.request('/host/alice/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    assert.equal(traversal.status, 403);
  });

  it('auto 模式按当前请求协议 + Host 生成绝对地址（空 base_url 不产生 undefined）', async () => {
    t = await createTestServer();
    t.services.settings.set('hosting.enabled', true, null);
    t.services.settings.set('hosting.mode', 'auto', null);
    t.services.settings.set('hosting.base_url', '', null);
    await deploySite(t);

    // 服务层按调用方传入的请求上下文生成绝对地址
    const withOrigin = t.services.hosting.get(t.user, {
      protocol: 'http',
      host: 'cloudbox.internal:8686',
    });
    assert.equal(withOrigin.mode, 'auto');
    assert.equal(withOrigin.url, 'http://cloudbox.internal:8686/host/alice/');

    // 没有请求上下文时仍是以 / 开头的路径，而不是 "undefined/host/..."
    assert.equal(t.services.hosting.urlFor(t.user), '/host/alice/');

    // 真实接口使用当前请求的协议 + Host（端口来自 Host 头，不硬编码）
    const response = await t.client.request('/api/hosting/settings');
    assert.equal(response.status, 200);
    const body = (await response.json()) as { url: string; mode: string; baseUrl: string };
    assert.equal(body.mode, 'auto');
    assert.equal(body.baseUrl, '');
    assert.equal(body.url, `${t.client.baseUrl}/host/alice/`);
    assert.ok(!body.url.includes('undefined'));
  });

  it('public 模式优先使用配置的 hosting.base_url', async () => {
    t = await createTestServer();
    t.services.settings.set('hosting.enabled', true, null);
    t.services.settings.set('hosting.mode', 'public', null);
    t.services.settings.set('hosting.base_url', 'https://pan.example.com/', null);
    await deploySite(t);

    const saved = t.services.hosting.get(t.user, { protocol: 'http', host: '127.0.0.1:9999' });
    assert.equal(saved.url, 'https://pan.example.com/host/alice/');
    // 原始 base_url 保留，便于管理端回显
    assert.equal(saved.baseUrl, 'https://pan.example.com/');

    const response = await t.client.request('/api/hosting/settings');
    const body = (await response.json()) as { url: string };
    assert.equal(body.url, 'https://pan.example.com/host/alice/');
  });

  it('public 模式未配置 base_url 时回退到当前请求地址', async () => {
    t = await createTestServer();
    t.services.settings.set('hosting.enabled', true, null);
    t.services.settings.set('hosting.mode', 'public', null);
    t.services.settings.set('hosting.base_url', '', null);
    await deploySite(t);

    const response = await t.client.request('/api/hosting/settings');
    const body = (await response.json()) as { url: string };
    assert.equal(body.url, `${t.client.baseUrl}/host/alice/`);
  });

  it('HTTPS 请求补齐 HSTS', async () => {
    t = await createTestServer({ trustProxy: true });
    t.services.settings.set('hosting.enabled', true, null);
    await deploySite(t);

    const response = await fetch(`${t.client.baseUrl}/host/alice/`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox/);
  });

  it('私有模式未登录返回 403，登录后允许', async () => {
    t = await createTestServer();
    t.services.settings.set('hosting.enabled', true, null);
    await deploySite(t, { root: 'private', visibility: 'private' });

    const anonymous = await fetch(`${t.client.baseUrl}/host/alice/`);
    assert.equal(anonymous.status, 403);
    const loggedIn = await t.client.request('/host/alice/');
    assert.equal(loggedIn.status, 200);
    assert.match(await loggedIn.text(), /HOST_INDEX/);
  });
});
