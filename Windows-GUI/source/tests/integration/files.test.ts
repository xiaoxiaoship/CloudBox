import assert from 'node:assert/strict';
import { readdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createTestServer, TestClient, waitFor, type TestServer } from '../helpers/testServer.ts';

const KB = 1024;

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('files API', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await createTestServer();
  });

  afterEach(async () => {
    await t.close();
  });

  it('未登录访问文件接口返回 401', async () => {
    const anonymous = new TestClient(t.client.baseUrl);
    const response = await anonymous.request('/api/files');

    assert.equal(response.status, 401);
    const body = await readJson<{ code: string }>(response);
    assert.equal(body.code, 'AUTH_SESSION_INVALID');
  });

  it('缺少 CSRF 头的写操作被拒绝并写审计', async () => {
    const response = await fetch(`${t.client.baseUrl}/api/files/folder`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: t.client.cookieHeader(),
      },
      body: JSON.stringify({ name: 'csrf-folder' }),
    });

    assert.equal(response.status, 403);
    const body = await readJson<{ code: string }>(response);
    assert.equal(body.code, 'CSRF_INVALID');

    const audits = t.services.audit.list({ limit: 10 });
    assert.ok(
      audits.some((entry) => entry.action === 'security.csrf.reject' && entry.result === 'denied'),
    );
  });

  it('目录创建 / 上传 / 列表 / 重命名 / 删除完整闭环', async () => {
    const folder = await t.client.request('/api/files/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'docs' }),
    });
    assert.equal(folder.status, 201);

    const upload = await t.client.upload('hello.txt', Buffer.from('hello world'), {
      path: 'docs',
    });
    assert.equal(upload.status, 201);
    const uploaded = await readJson<{ file: { path: string; size: number } }>(upload);
    assert.equal(uploaded.file.path, 'docs/hello.txt');
    assert.equal(uploaded.file.size, 11);

    const listing = await t.client.request('/api/files?path=docs');
    assert.equal(listing.status, 200);
    const listBody = await readJson<{
      path: string;
      entries: Array<{ name: string; type: string; size: number | null }>;
    }>(listing);
    assert.equal(listBody.path, 'docs');
    assert.deepEqual(
      listBody.entries.map((entry) => entry.name),
      ['hello.txt'],
    );
    assert.equal(listBody.entries[0]?.size, 11);

    const rename = await t.client.request('/api/files', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'docs/hello.txt', newName: 'hi.txt' }),
    });
    assert.equal(rename.status, 200);
    const renamed = await readJson<{ entry: { path: string } }>(rename);
    assert.equal(renamed.entry.path, 'docs/hi.txt');

    const deletion = await t.client.request('/api/files', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['docs/hi.txt'] }),
    });
    assert.equal(deletion.status, 200);
    const deleted = await readJson<{ freedBytes: number; usage: { usedBytes: number } }>(deletion);
    assert.equal(deleted.freedBytes, 11);
    assert.equal(deleted.usage.usedBytes, 0);

    const auditActions = t.services.audit
      .list({ limit: 30 })
      .map((entry) => entry.action);
    for (const action of ['file.mkdir', 'file.upload', 'file.rename', 'file.delete']) {
      assert.ok(auditActions.includes(action), `缺少审计动作 ${action}`);
    }
  });

  it('下载支持 Range、强制 attachment，并返回正确字节', async () => {
    const content = Buffer.from('0123456789');
    const upload = await t.client.upload('data.bin', content);
    assert.equal(upload.status, 201);

    const full = await t.client.request('/api/files/download?path=data.bin');
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-length'), '10');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.match(full.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), content);

    const ranged = await t.client.request('/api/files/download?path=data.bin', {
      headers: { range: 'bytes=2-5' },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(ranged.headers.get('content-length'), '4');
    assert.equal(await ranged.text(), '2345');

    const suffix = await t.client.request('/api/files/download?path=data.bin', {
      headers: { range: 'bytes=-3' },
    });
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), '789');

    const invalid = await t.client.request('/api/files/download?path=data.bin', {
      headers: { range: 'bytes=99-' },
    });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), 'bytes */10');

    const usage = await t.client.request('/api/files/usage');
    const usageBody = await readJson<{ usedBytes: number; quotaBytes: number | null }>(usage);
    assert.equal(usageBody.usedBytes, 10);
  });

  it('路径穿越被拦截，并记录 denied 审计', async () => {
    writeFileSync(path.join(t.dataDir, 'secret.txt'), 'top-secret');

    const list = await t.client.request(`/api/files?path=${encodeURIComponent('../..')}`);
    assert.equal(list.status, 400);
    assert.equal((await readJson<{ code: string }>(list)).code, 'PATH_TRAVERSAL');

    const download = await t.client.request(
      `/api/files/download?path=${encodeURIComponent('../secret.txt')}`,
    );
    assert.equal(download.status, 400);

    const upload = await t.client.upload('evil.txt', Buffer.from('x'), { path: '..' });
    assert.equal(upload.status, 400);

    const rename = await t.client.request('/api/files', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'a.txt', newName: '../escape.txt' }),
    });
    assert.equal(rename.status, 400);

    const denied = t.services.audit.list({ limit: 50 }).filter((entry) => entry.result === 'denied');
    for (const action of ['file.list', 'file.download', 'file.upload', 'file.rename']) {
      assert.ok(
        denied.some((entry) => entry.action === action),
        `缺少 ${action} 的 denied 审计`,
      );
    }

    const rootEntries = readdirSync(path.join(t.storageRoot, t.user.storageKey));
    assert.deepEqual(rootEntries, []);
  });

  it('配额不足时边写边断流：无文件、无残留、不记用量', async () => {
    t.services.quotas.setQuota(t.user.id, 100, Date.now());

    const response = await t.client.upload('big.bin', Buffer.alloc(1_000, 1));
    assert.equal(response.status, 413);
    const body = await readJson<{ code: string }>(response);
    assert.equal(body.code, 'UPLOAD_QUOTA_EXCEEDED');

    const usage = t.services.files.getUsage(t.user);
    assert.equal(usage.usedBytes, 0);
    assert.deepEqual(readdirSync(t.tempDir), []);
    assert.deepEqual(readdirSync(path.join(t.storageRoot, t.user.storageKey)), []);

    const denied = t.services.audit.list({ limit: 10 })[0]!;
    assert.equal(denied.action, 'file.upload');
    assert.equal(denied.result, 'denied');
    assert.equal(JSON.parse(denied.detail!).code, 'UPLOAD_QUOTA_EXCEEDED');
  });

  it('并发上传争抢配额：只有一个成功，用量不超卖', async () => {
    t.services.quotas.setQuota(t.user.id, 1 * 1024 * 1024, Date.now());
    const content = Buffer.alloc(700 * KB, 7);

    const [first, second] = await Promise.all([
      t.client.upload('first.bin', content),
      t.client.upload('second.bin', content),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 413]);

    const usage = t.services.files.getUsage(t.user);
    assert.equal(usage.usedBytes, 700 * KB);

    const listing = await t.client.request('/api/files');
    const listBody = await readJson<{ entries: Array<{ name: string }> }>(listing);
    assert.equal(listBody.entries.length, 1);
    assert.ok(['first.bin', 'second.bin'].includes(listBody.entries[0]!.name));

    const denied = t.services.audit
      .list({ limit: 10 })
      .filter((entry) => entry.action === 'file.upload' && entry.result === 'denied');
    assert.equal(denied.length, 1);
  });

  it('大文件上传中途断开：临时文件清理，配额不变', async () => {
    const boundary = `----cloudbox${Date.now()}`;
    const head = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="partial.bin"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    const declaredSize = 5 * 1024 * 1024;
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

    await new Promise<void>((resolve) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: t.port,
        path: '/api/files/upload?path=',
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(head.length + declaredSize + tail.length),
          cookie: t.client.cookieHeader(),
          'x-csrf-token': t.client.csrf,
        },
      });

      req.on('error', () => resolve());
      req.write(head);
      req.write(Buffer.alloc(512 * KB, 3));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 100);
    });

    await waitFor(() => readdirSync(t.tempDir).length === 0);
    assert.equal(t.services.files.getUsage(t.user).usedBytes, 0);
    assert.deepEqual(readdirSync(path.join(t.storageRoot, t.user.storageKey)), []);

    await waitFor(() =>
      t.services.audit
        .list({ limit: 10 })
        .some(
          (entry) =>
            entry.action === 'file.upload' &&
            entry.result === 'denied' &&
            JSON.parse(entry.detail ?? '{}').code === 'UPLOAD_ABORTED',
        ),
    );
  });

  it('覆盖上传按差量更新配额，未带 overwrite 时返回 409', async () => {
    const first = await t.client.upload('replace.txt', Buffer.alloc(100, 1));
    assert.equal(first.status, 201);
    assert.equal(t.services.files.getUsage(t.user).usedBytes, 100);

    const conflict = await t.client.upload('replace.txt', Buffer.alloc(40, 2));
    assert.equal(conflict.status, 409);
    assert.equal((await readJson<{ code: string }>(conflict)).code, 'FILE_EXISTS');
    assert.equal(t.services.files.getUsage(t.user).usedBytes, 100);

    const overwritten = await t.client.upload('replace.txt', Buffer.alloc(40, 2), {
      overwrite: true,
    });
    assert.equal(overwritten.status, 200);
    assert.equal(t.services.files.getUsage(t.user).usedBytes, 40);
  });

  it('中文文件名上传/下载头保持 UTF-8', async () => {
    const filename = '测试 文档.txt';
    const upload = await t.client.upload(filename, Buffer.from('你好，CloudBox'));
    assert.equal(upload.status, 201);

    const listing = await t.client.request('/api/files');
    const listBody = await readJson<{ entries: Array<{ name: string; size: number }> }>(listing);
    assert.equal(listBody.entries[0]?.name, filename);

    const download = await t.client.request(
      `/api/files/download?path=${encodeURIComponent(filename)}`,
    );
    assert.equal(download.status, 200);
    assert.equal(await download.text(), '你好，CloudBox');

    const disposition = download.headers.get('content-disposition') ?? '';
    assert.match(disposition, /filename\*=UTF-8''/);
    assert.ok(disposition.includes(encodeURIComponent(filename)));
  });

  it('删除目录递归释放配额', async () => {
    await t.client.request('/api/files/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nested' }),
    });
    await t.client.upload('a.bin', Buffer.alloc(300, 1), { path: 'nested' });
    await t.client.upload('b.bin', Buffer.alloc(200, 1), { path: 'nested' });

    assert.equal(t.services.files.getUsage(t.user).usedBytes, 500);

    const deletion = await t.client.request('/api/files', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['nested'] }),
    });
    assert.equal(deletion.status, 200);
    const body = await readJson<{ freedBytes: number; usage: { usedBytes: number } }>(deletion);
    assert.equal(body.freedBytes, 500);
    assert.equal(body.usage.usedBytes, 0);

    const listing = await t.client.request('/api/files');
    const listBody = await readJson<{ entries: unknown[] }>(listing);
    assert.equal(listBody.entries.length, 0);
  });

  it('用户之间目录隔离：不可见、不可下载、不可穿越', async () => {
    await t.client.upload('mine.txt', Buffer.from('mine'));
    const bob = await t.addUser('bob');

    const bobList = await bob.client.request('/api/files');
    const bobBody = await readJson<{ entries: unknown[] }>(bobList);
    assert.equal(bobBody.entries.length, 0);

    const bobDownload = await bob.client.request('/api/files/download?path=mine.txt');
    assert.equal(bobDownload.status, 404);
    assert.equal((await readJson<{ code: string }>(bobDownload)).code, 'PATH_NOT_FOUND');

    const escape = await bob.client.request(
      `/api/files?path=${encodeURIComponent(`../${t.user.storageKey}`)}`,
    );
    assert.equal(escape.status, 400);
    assert.equal((await readJson<{ code: string }>(escape)).code, 'PATH_TRAVERSAL');

    // 同名文件在各自根目录下互不影响
    const bobUpload = await bob.client.upload('mine.txt', Buffer.from('bob'));
    assert.equal(bobUpload.status, 201);

    const bobListAgain = await bob.client.request('/api/files');
    const bobBodyAgain = await readJson<{ entries: Array<{ name: string; size: number }> }>(
      bobListAgain,
    );
    assert.equal(bobBodyAgain.entries[0]?.size, 3);
  });

  it('缺少文件字段返回 400，且不产生临时文件', async () => {
    const form = new FormData();
    form.append('note', 'no file here');

    const response = await t.client.request('/api/files/upload?path=', {
      method: 'POST',
      body: form,
    });

    assert.equal(response.status, 400);
    assert.equal((await readJson<{ code: string }>(response)).code, 'UPLOAD_NO_FILE');
    assert.deepEqual(readdirSync(t.tempDir), []);
  });
});
