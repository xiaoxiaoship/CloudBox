import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { RequestContext } from '../../src/core/services/fileService.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

const ctx: RequestContext = { ip: '127.0.0.1', userAgent: 'host-test', requestId: null };

describe('static hosting', () => {
  let t: TestServer | null = null;

  afterEach(async () => {
    await t?.close();
    t = null;
  });

  it('基础访问、Content-Type、SPA 回退与路径穿越拦截', async () => {
    t = await createTestServer();
    t.services.settings.set('hosting.enabled', true, null);
    t.services.settings.set('hosting.base_url', 'https://pan.example.com', null);
    await t.client.request('/api/files/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '', name: 'public' }),
    });
    await t.client.upload('index.html', Buffer.from('<!doctype html><html><body>HOST_INDEX</body></html>'), { path: 'public' });
    await t.client.upload('app.js', Buffer.from('console.log("host");'), { path: 'public' });
    await t.client.upload('about.html', Buffer.from('ABOUT'), { path: 'public' });

    const saved = await t.services.hosting.save(
      t.user,
      { rootPath: 'public', enabled: true, visibility: 'public' },
      ctx,
    );
    assert.equal(saved.url, 'https://pan.example.com/host/alice/');

    const index = await t.client.request('/host/alice/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await index.text(), /HOST_INDEX/);
    assert.match(index.headers.get('content-security-policy') ?? '', /sandbox/);

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

  it('私有模式未登录返回 403，登录后允许', async () => {
    t = await createTestServer();
    t.services.settings.set('hosting.enabled', true, null);
    await t.client.request('/api/files/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '', name: 'private' }),
    });
    await t.client.upload('index.html', Buffer.from('<!doctype html><html><body>PRIVATE_INDEX</body></html>'), { path: 'private' });
    await t.services.hosting.save(
      t.user,
      { rootPath: 'private', enabled: true, visibility: 'private' },
      ctx,
    );

    const anonymous = await fetch(`${t.client.baseUrl}/host/alice/`);
    assert.equal(anonymous.status, 403);
    const loggedIn = await t.client.request('/host/alice/');
    assert.equal(loggedIn.status, 200);
    assert.match(await loggedIn.text(), /PRIVATE_INDEX/);
  });
});
