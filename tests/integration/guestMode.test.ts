import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GuestLinkService } from '../../src/core/services/guestLinkService.ts';
import { DEFAULT_LOW_LEVEL_SECURITY } from '../../src/shared/lowLevelSecurity.ts';
import { createTestServer, TestClient, type TestServer } from '../helpers/testServer.ts';

interface GuestLinkResponse {
  token: string;
  url: string;
  hasPassword: boolean;
  expiresAt: number;
}

interface GuestStatusResponse {
  enabled: boolean;
  link: (GuestLinkResponse & { token: string }) | null;
}

interface GuestPublicInfo {
  ownerUsername: string;
  hasPassword: boolean;
  expiresAt: number;
}

interface GuestListing {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string; type: 'file' | 'dir'; size: number | null; modifiedAt: number }>;
  truncated: boolean;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('guest mode (独立 GuestSession)', () => {
  let t: TestServer;
  let now: number;
  let guest: TestClient;

  beforeEach(async () => {
    now = Date.now();
    t = await createTestServer({ now: () => now });
    t.services.settings.set('allow_guest_mode', true, null);
    await t.client.upload('hello.txt', Buffer.from('guest readable content'));
    guest = new TestClient(t.client.baseUrl);
  });

  afterEach(async () => {
    await t.close();
  });

  async function createLink(password?: string): Promise<GuestLinkResponse> {
    const response = await t.client.request('/api/guest/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(password === undefined ? {} : { password }),
    });
    assert.equal(response.status, 201);
    return readJson<GuestLinkResponse>(response);
  }

  async function unlock(token: string, password: string, client: TestClient = guest): Promise<Response> {
    return client.request(`/api/public/guest/${token}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  }

  it('管理员关闭访客模式时，公开访客接口全部 403', async () => {
    const link = await createLink();
    t.services.settings.set('allow_guest_mode', false, null);

    const info = await guest.request(`/api/public/guest/${link.token}`);
    assert.equal(info.status, 403);
    assert.equal((await readJson<{ code: string }>(info)).code, 'GUEST_DISABLED');

    const unlocked = await unlock(link.token, '');
    assert.equal(unlocked.status, 403);
    assert.equal((await readJson<{ code: string }>(unlocked)).code, 'GUEST_DISABLED');

    // 用户侧也不能再创建新链接
    const create = await t.client.request('/api/guest/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(create.status, 403);

    const status = await t.client.request('/api/guest/status');
    assert.equal(status.status, 200);
    const payload = await readJson<GuestStatusResponse>(status);
    assert.equal(payload.enabled, false);
  });

  it('guestLinkTtlHours=0 时创建永久有效链接', async () => {
    t.services.settings.set(
      'security.lowLevel',
      JSON.stringify({ ...t.services.settings.getLowLevel(), guestLinkTtlHours: 0 }),
      null,
    );
    const link = await createLink();
    assert.equal(link.expiresAt, 0);
    now += 10 * 365 * 24 * 3_600_000;
    const info = await guest.request(`/api/public/guest/${link.token}`);
    assert.equal(info.status, 200);
    assert.equal((await readJson<{ expiresAt: number }>(info)).expiresAt, 0);
  });

  it('创建链接：token 为 64 位 hex、返回 /guest/<token> URL，重复创建覆盖旧链接', async () => {
    const first = await createLink();
    assert.match(first.token, /^[a-f0-9]{64}$/);
    assert.equal(first.url, `http://127.0.0.1:${t.port}/guest/${first.token}`);
    assert.equal(first.hasPassword, false);
    assert.equal(first.expiresAt, now + 24 * 3_600_000);

    const status = await t.client.request('/api/guest/status');
    const statusBody = await readJson<GuestStatusResponse>(status);
    assert.equal(statusBody.enabled, true);
    assert.equal(statusBody.link?.token, first.token);

    const second = await createLink('P@ssw0rd');
    assert.notEqual(second.token, first.token);
    assert.equal(second.hasPassword, true);

    // 旧 token 立即失效
    const oldInfo = await guest.request(`/api/public/guest/${first.token}`);
    assert.equal(oldInfo.status, 404);

    const publicInfo = await guest.request(`/api/public/guest/${second.token}`);
    assert.equal(publicInfo.status, 200);
    const info = await readJson<GuestPublicInfo>(publicInfo);
    assert.equal(info.ownerUsername, t.user.username);
    assert.equal(info.hasPassword, true);
    assert.equal(info.expiresAt, second.expiresAt);

    const listing = await t.client.request('/api/guest/status');
    const listingBody = await readJson<GuestStatusResponse>(listing);
    assert.equal(listingBody.link?.hasPassword, true);
  });

  it('用户接口需要登录与 CSRF', async () => {
    const anonymous = new TestClient(t.client.baseUrl).request('/api/guest/status');
    assert.equal((await anonymous).status, 401);

    const noCsrf = await t.client.request(
      '/api/guest/link',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { csrf: false },
    );
    assert.equal(noCsrf.status, 403);
    assert.equal((await readJson<{ code: string }>(noCsrf)).code, 'CSRF_INVALID');
  });

  it('密码解锁：错误密码 429 且不影响 owner 登录失败计数，成功后签发独立 cb_guest cookie', async () => {
    const link = await createLink('Pa55word');

    const wrong = await unlock(link.token, 'wrong-password');
    assert.equal(wrong.status, 429);
    assert.equal((await readJson<{ code: string }>(wrong)).code, 'GUEST_PASSWORD_INVALID');

    // guest 密码失败绝不能累加 owner 账户的 failed_attempts
    const owner = t.services.users.findById(t.user.id);
    assert.equal(owner?.failedAttempts, 0);

    const ok = await unlock(link.token, 'Pa55word');
    assert.equal(ok.status, 200);
    const body = await readJson<{ unlocked: boolean; expiresAt: number }>(ok);
    assert.equal(body.unlocked, true);
    assert.equal(body.expiresAt, now + 30 * 60_000);
    assert.ok(guest.cookieHeader().includes('cb_guest='));
    assert.ok(!guest.cookieHeader().includes('cloudbox_session='));

    // 携带访客 cookie 可以使用访客文件接口
    const files = await guest.request(`/api/public/guest/${link.token}/files?path=`);
    assert.equal(files.status, 200);

    // 但访客 cookie 不被普通用户接口接受
    const normal = await guest.request('/api/files?path=');
    assert.equal(normal.status, 401);
  });

  it('无密码链接自动 unlock，可只读列出并下载 owner 文件', async () => {
    const link = await createLink();
    const unlocked = await unlock(link.token, '');
    assert.equal(unlocked.status, 200);

    const files = await guest.request(`/api/public/guest/${link.token}/files?path=`);
    assert.equal(files.status, 200);
    const listing = await readJson<GuestListing>(files);
    const entry = listing.entries.find((item) => item.name === 'hello.txt');
    assert.ok(entry, '应列出 owner 上传的文件');
    assert.equal(entry.type, 'file');
    assert.equal(entry.size, 'guest readable content'.length);
    assert.equal(typeof entry.modifiedAt, 'number');

    const download = await guest.request(
      `/api/public/guest/${link.token}/download?path=hello.txt`,
    );
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'guest readable content');
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/);

    // 目录进入 + 面包屑所需字段
    const dirResponse = await t.client.request('/api/files/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '', name: 'docs' }),
    });
    assert.equal(dirResponse.status, 201);

    const root = await readJson<GuestListing>(await guest.request(`/api/public/guest/${link.token}/files?path=`));
    const dir = root.entries.find((item) => item.name === 'docs');
    assert.ok(dir);
    assert.equal(dir.type, 'dir');

    const inner = await readJson<GuestListing>(
      await guest.request(`/api/public/guest/${link.token}/files?path=docs`),
    );
    assert.equal(inner.path, 'docs');
    assert.equal(inner.parent, '');
  });

  it('未解锁、路径穿越、绝对路径与写入接口都被拒绝', async () => {
    const link = await createLink();
    const noSession = await guest.request(`/api/public/guest/${link.token}/files?path=`);
    assert.equal(noSession.status, 401);

    const noSessionDownload = await guest.request(
      `/api/public/guest/${link.token}/download?path=hello.txt`,
    );
    assert.equal(noSessionDownload.status, 401);

    assert.equal((await unlock(link.token, '')).status, 200);

    const traversal = await guest.request(`/api/public/guest/${link.token}/files?path=..%2F..%2Fetc`);
    assert.equal(traversal.status, 400);

    const absolute = await guest.request(
      `/api/public/guest/${link.token}/download?path=${encodeURIComponent('/etc/passwd')}`,
    );
    assert.equal(absolute.status, 400);

    const missing = await guest.request(`/api/public/guest/${link.token}/files?path=missing`);
    assert.equal(missing.status, 404);

    // 没有任何写入口：上传/删除/改名/分享都不存在
    const upload = await guest.request(`/api/public/guest/${link.token}/upload`, { method: 'POST' });
    assert.equal(upload.status, 404);
    const remove = await guest.request(`/api/public/guest/${link.token}/files?path=hello.txt`, {
      method: 'DELETE',
    });
    assert.equal(remove.status, 404);
    const share = await guest.request(`/api/public/guest/${link.token}/share`, { method: 'POST' });
    assert.equal(share.status, 404);
  });

  it('撤销链接后旧访客会话立即失效', async () => {
    const link = await createLink();
    assert.equal((await unlock(link.token, '')).status, 200);

    const before = await guest.request(`/api/public/guest/${link.token}/files?path=`);
    assert.equal(before.status, 200);

    const revoke = await t.client.request('/api/guest/link', { method: 'DELETE' });
    assert.equal(revoke.status, 204);

    const after = await guest.request(`/api/public/guest/${link.token}/files?path=`);
    assert.equal(after.status, 401);

    const info = await guest.request(`/api/public/guest/${link.token}`);
    assert.equal(info.status, 404);

    const status = await readJson<GuestStatusResponse>(await t.client.request('/api/guest/status'));
    assert.equal(status.link, null);
  });

  it('链接过期与访客会话 TTL 过期都会失效', async () => {
    const link = await createLink();
    assert.equal((await unlock(link.token, '')).status, 200);
    assert.equal((await guest.request(`/api/public/guest/${link.token}/files?path=`)).status, 200);

    // 30 分钟会话 TTL 到期
    now += 30 * 60_000 + 1;
    assert.equal((await guest.request(`/api/public/guest/${link.token}/files?path=`)).status, 401);

    // 重新解锁后链接仍在有效期内
    now = link.expiresAt - 1_000;
    assert.equal((await unlock(link.token, '')).status, 200);

    // 链接到期
    now = link.expiresAt + 1;
    const info = await guest.request(`/api/public/guest/${link.token}`);
    assert.equal(info.status, 410);
    assert.equal((await readJson<{ code: string }>(info)).code, 'GUEST_LINK_EXPIRED');

    // 首次发现过期后链接即被清理，后续访问统一 404
    const expiredUnlock = await unlock(link.token, '');
    assert.equal(expiredUnlock.status, 404);

    assert.equal((await guest.request(`/api/public/guest/${link.token}/files?path=`)).status, 401);

    const status = await readJson<GuestStatusResponse>(await t.client.request('/api/guest/status'));
    assert.equal(status.link, null);
  });

  it('链接持久化在 storageRoot/.guest-links.json，新实例可重新加载', async () => {
    const link = await createLink('P@ssw0rd');

    const storePath = path.join(t.storageRoot, '.guest-links.json');
    assert.equal(existsSync(storePath), true);
    const rows = JSON.parse(readFileSync(storePath, 'utf8')) as Array<{
      userId: number;
      token: string;
      passwordHash: string | null;
      expiresAt: number;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, t.user.id);
    assert.equal(rows[0]?.token, link.token);
    assert.ok(rows[0]?.passwordHash);
    assert.equal(rows[0]?.expiresAt, link.expiresAt);

    // 用同一 storageRoot 新建实例，模拟进程重启后的读取
    const reloaded = new GuestLinkService({
      users: t.services.users,
      settings: t.services.settings,
      storageRoot: t.storageRoot,
      now: () => now,
    });
    const info = reloaded.info(link.token);
    assert.equal(info.ownerUsername, t.user.username);
    assert.equal(info.hasPassword, true);
    assert.equal(info.expiresAt, link.expiresAt);
  });

  it('活跃访客会话数超过 guestMaxConcurrent 时返回 429', async () => {
    t.services.settings.set(
      'security.lowLevel',
      JSON.stringify({ ...DEFAULT_LOW_LEVEL_SECURITY, guestMaxConcurrent: 2 }),
      null,
    );

    const link = await createLink();
    const first = new TestClient(t.client.baseUrl);
    const second = new TestClient(t.client.baseUrl);
    const third = new TestClient(t.client.baseUrl);

    assert.equal((await unlock(link.token, '', first)).status, 200);
    assert.equal((await unlock(link.token, '', second)).status, 200);

    const limited = await unlock(link.token, '', third);
    assert.equal(limited.status, 429);
    assert.equal((await readJson<{ code: string }>(limited)).code, 'GUEST_TOO_MANY_SESSIONS');

    // 已有会话不受并发上限影响
    assert.equal((await first.request(`/api/public/guest/${link.token}/files?path=`)).status, 200);
  });
});
