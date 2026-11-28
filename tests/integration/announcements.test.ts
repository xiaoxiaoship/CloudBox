import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

describe('announcements', () => {
  let t: TestServer;
  beforeEach(async () => { t = await createTestServer(); });
  afterEach(async () => { await t.close(); });

  it('lists target announcements, reports unread, and marks all read', async () => {
    t.services.announcements.create(t.user.id, {
      category: 'info',
      audience: 'all',
      body: 'hello all',
    });
    t.services.announcements.create(t.user.id, {
      category: 'warning',
      audience: 'user',
      targetUserId: t.user.id,
      body: 'hello user',
    });

    const list = await t.client.request('/api/announcements');
    assert.equal(list.status, 200);
    const payload = (await list.json()) as { items: Array<{ body: string; read: boolean }>; unread: number };
    assert.equal(payload.items.length, 2);
    assert.equal(payload.unread, 2);
    assert.deepEqual(payload.items.map((item) => item.body).sort(), ['hello all', 'hello user']);

    const read = await t.client.request('/api/announcements/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(read.status, 204);

    const after = (await (await t.client.request('/api/announcements')).json()) as { unread: number };
    assert.equal(after.unread, 0);
  });
});
