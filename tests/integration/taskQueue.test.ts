import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

async function waitTask(client: TestServer['client'], id: string) {
  for (let i = 0; i < 100; i += 1) {
    const response = await client.request(`/api/tasks/${id}`);
    const task = (await response.json()) as { status: string };
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('task timeout');
}

describe('task queue routes and quota accounting', () => {
  let t: TestServer;
  beforeEach(async () => { t = await createTestServer(); });
  afterEach(async () => { await t.close(); });

  it('lists tasks, exposes stats, and cancel-all hides them', async () => {
    await t.client.upload('a.txt', Buffer.from('hello'));
    const created = await t.client.request('/api/files/compress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['a.txt'], target_dir: '', archive_name: 'a.zip', level: 6 }),
    });
    assert.equal(created.status, 202);
    const { taskId } = (await created.json()) as { taskId: string };
    await waitTask(t.client, taskId);

    const list = await t.client.request('/api/tasks');
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as unknown[]).length, 1);
    const stats = await t.client.request('/api/tasks/stats');
    assert.equal(stats.status, 200);

    const cleared = await t.client.request('/api/tasks/cancel-all', { method: 'POST' });
    assert.equal(cleared.status, 200);
    const after = await t.client.request('/api/tasks');
    assert.deepEqual(await after.json(), []);
  });

  it('overwriting the same archive does not double-count quota', async () => {
    await t.client.upload('b.txt', Buffer.from('hello quota'));
    const compress = async () => {
      const response = await t.client.request('/api/files/compress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths: ['b.txt'], target_dir: '', archive_name: 'b.zip', level: 6 }),
      });
      const { taskId } = (await response.json()) as { taskId: string };
      await waitTask(t.client, taskId);
    };
    await compress();
    const first = (await (await t.client.request('/api/files/usage')).json()) as { usedBytes: number };
    await compress();
    const second = (await (await t.client.request('/api/files/usage')).json()) as { usedBytes: number };
    assert.equal(second.usedBytes, first.usedBytes);
  });
});
