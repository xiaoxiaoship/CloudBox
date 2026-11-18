import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

describe('security mode', () => {
  let t: TestServer | null = null;
  afterEach(async () => { await t?.close(); t = null; });

  it('仅允许读取、预览和下载，拒绝上传与其他写操作', async () => {
    t = await createTestServer();
    t.services.users.setSecurityMode(t.user.id, true, Date.now());
    const list = await t.client.request('/api/files');
    assert.equal(list.status, 200);
    const upload = await t.client.upload('blocked.txt', Buffer.from('no'));
    assert.equal(upload.status, 403);
    const folder = await t.client.request('/api/files/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '', name: 'blocked' }),
    });
    assert.equal(folder.status, 403);
    t.services.users.setSecurityMode(t.user.id, false, Date.now());
    const allowed = await t.client.upload('allowed.txt', Buffer.from('ok'));
    assert.equal(allowed.status, 201);
  });
});
