import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

interface ShareResponse {
  token: string;
  path: string;
  url: string;
  file_path: string;
  expires_at: number;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('share links API', () => {
  let t: TestServer;
  let now: number;

  beforeEach(async () => {
    now = Date.now();
    t = await createTestServer({ now: () => now });
    await t.client.upload('shared.txt', Buffer.from('hello shared file'));
  });

  afterEach(async () => {
    await t.close();
  });

  async function createShare(durationSeconds = 300, filePath = 'shared.txt') {
    return t.client.request('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, duration_seconds: durationSeconds }),
    });
  }

  it('创建分享返回完整 URL，公开 Range 下载无需登录', async () => {
    const response = await createShare(300);
    assert.equal(response.status, 201);

    const created = await readJson<ShareResponse>(response);
    assert.ok(created.token.length >= 43);
    assert.match(created.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/public\/s\//);
    assert.equal(created.path, `/api/public/s/${created.token}`);
    assert.equal(created.file_path, 'shared.txt');
    assert.equal(created.expires_at, now + 300_000);

    const row = t.services.db
      .prepare('SELECT user_id, storage_key, file_path, expires_at FROM shares WHERE token = ?')
      .get(created.token) as {
      user_id: number;
      storage_key: string;
      file_path: string;
      expires_at: number;
    };
    assert.equal(row.user_id, t.user.id);
    assert.equal(row.storage_key, t.user.storageKey);
    assert.equal(row.file_path, 'shared.txt');

    // 不带 Cookie / CSRF，证明公开接口无需登录
    const download = await fetch(created.url, { headers: { range: 'bytes=0-4' } });
    assert.equal(download.status, 206);
    assert.equal(download.headers.get('content-range'), 'bytes 0-4/17');
    assert.equal(download.headers.get('accept-ranges'), 'bytes');
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.equal(Buffer.from(await download.arrayBuffer()).toString('utf8'), 'hello');
  });

  it('public 模式优先使用 hosting.base_url 生成分享地址', async () => {
    t.services.settings.set('hosting.mode', 'public', null);
    t.services.settings.set('hosting.base_url', 'https://pan.example.com/', null);

    const response = await createShare(300);
    assert.equal(response.status, 201);
    const created = await readJson<ShareResponse>(response);

    assert.equal(created.path, `/api/public/s/${created.token}`);
    assert.equal(created.url, `https://pan.example.com/api/public/s/${created.token}`);
  });

  it('public 模式未配置 base_url 时回退到当前请求协议 + Host', async () => {
    t.services.settings.set('hosting.mode', 'public', null);
    t.services.settings.set('hosting.base_url', '', null);

    const response = await createShare(300);
    const created = await readJson<ShareResponse>(response);
    assert.match(created.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/public\/s\//);
  });

  it('auto 模式忽略已配置的 base_url，使用当前请求地址', async () => {
    t.services.settings.set('hosting.mode', 'auto', null);
    t.services.settings.set('hosting.base_url', 'https://pan.example.com', null);

    const response = await createShare(300);
    const created = await readJson<ShareResponse>(response);
    assert.equal(created.url, `${t.client.baseUrl}/api/public/s/${created.token}`);
  });

  it('30 秒边界：到期时刻仍可下载，超过 1ms 返回 410', async () => {
    const response = await createShare(30);
    const created = await readJson<ShareResponse>(response);
    assert.equal(created.expires_at, now + 30_000);

    now += 30_000;
    const atExpiry = await fetch(created.url);
    assert.equal(atExpiry.status, 200);
    assert.equal(await atExpiry.text(), 'hello shared file');

    now += 1;
    const expired = await fetch(created.url);
    assert.equal(expired.status, 410);
    const body = await readJson<{ code: string }>(expired);
    assert.equal(body.code, 'SHARE_EXPIRED');
  });

  it('2 小时边界可创建，到期后返回 410', async () => {
    const base = now;
    const response = await createShare(7_200);
    assert.equal(response.status, 201);
    const created = await readJson<ShareResponse>(response);
    assert.equal(created.expires_at, base + 7_200_000);

    now = base + 7_200_000;
    assert.equal((await fetch(created.url)).status, 200);

    now += 1;
    assert.equal((await fetch(created.url)).status, 410);
  });

  it('用户可以列出并删除自己的分享记录', async () => {
    const createdResponse = await createShare(300);
    assert.equal(createdResponse.status, 201);
    const created = await readJson<ShareResponse>(createdResponse);

    const list = await t.client.request('/api/shares');
    assert.equal(list.status, 200);
    const rows = await readJson<Array<{ id: number; token: string; expired: boolean }>>(list);
    const row = rows.find((item) => item.token === created.token);
    assert.ok(row);
    assert.equal(row.expired, false);

    const removed = await t.client.request(`/api/shares/${row.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);
    assert.equal((await (await t.client.request('/api/shares')).json() as unknown[]).length, 0);
    assert.equal((await fetch(created.url)).status, 404);
  });

  it('duration_seconds 严格限制在 30–7200 秒', async () => {
    for (const duration of [29, 7_201, 0, -1]) {
      const response = await createShare(duration);
      assert.equal(response.status, 400, `duration=${duration}`);
    }
  });

  it('路径穿越/不存在文件被 safePath 拦截', async () => {
    const traversal = await createShare(300, '../outside.txt');
    assert.equal(traversal.status, 400);

    const missing = await createShare(300, 'not-exists.txt');
    assert.equal(missing.status, 404);
  });

  it('无效 token 返回 404', async () => {
    const response = await fetch(
      `${t.client.baseUrl}/api/public/s/${'a'.repeat(43)}`,
    );
    assert.equal(response.status, 404);
    const body = await readJson<{ code: string }>(response);
    assert.equal(body.code, 'SHARE_NOT_FOUND');
  });

  it('同一用户每分钟最多创建 10 个分享', async () => {
    // 该用例只验证分享频率限制，关闭默认启用的 Cap，避免默认 WAF 规则先触发。
    t.services.settings.set('security.capEnabled', false, null);
    for (let index = 0; index < 10; index += 1) {
      const response = await createShare(300);
      assert.equal(response.status, 201, `第 ${index + 1} 个分享应成功`);
    }

    const limited = await createShare(300);
    assert.equal(limited.status, 429);
    assert.equal((await readJson<{ code: string }>(limited)).code, 'RATE_LIMITED');
  });
});
