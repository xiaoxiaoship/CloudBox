import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createTestServer, TestClient, type TestServer } from '../helpers/testServer.ts';
import { makeZip } from '../helpers/zip.ts';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function waitForTask(client: TestClient, taskId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await client.request(`/api/tasks/${taskId}`);
    assert.equal(response.status, 200);
    const task = (await response.json()) as { status: string; error: string | null };
    if (['completed', 'clean', 'infected', 'failed'].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('task timeout');
}

describe('feature permissions and safe extraction', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await createTestServer();
  });

  afterEach(async () => {
    await t.close();
  });

  it('关闭所有功能权限：公开配置为 false，预览/解压/查杀返回 403', async () => {
    t.services.settings.set('allow_user_preview_image', false, null);
    t.services.settings.set('allow_user_preview_video', false, null);
    t.services.settings.set('allow_user_preview_pdf', false, null);
    t.services.settings.set('allow_user_extract', false, null);
    t.services.settings.set('allow_user_scan', false, null);

    const settings = await t.client.request('/api/public/settings');
    const body = (await settings.json()) as {
      permissions: Record<string, boolean>;
      scan_enabled: boolean;
    };
    assert.equal(body.permissions.allow_user_preview_image, false);
    assert.equal(body.permissions.allow_user_preview_video, false);
    assert.equal(body.permissions.allow_user_preview_pdf, false);
    assert.equal(body.permissions.allow_user_extract, false);
    assert.equal(body.permissions.allow_user_scan, false);

    await t.client.upload('pixel.png', PNG_1X1);
    await t.client.upload('clip.mp4', Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]));
    await t.client.upload('doc.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'));

    for (const file of ['pixel.png', 'clip.mp4', 'doc.pdf']) {
      const response = await t.client.request(
        `/api/files/preview/info?path=${encodeURIComponent(file)}`,
      );
      assert.equal(response.status, 403, file);
      assert.equal((await response.json() as { code: string }).code, 'FEATURE_DISABLED');
    }

    const zip = await makeZip({ 'ok.txt': 'ok' });
    await t.client.upload('blocked.zip', zip);
    const extract = await t.client.request('/api/files/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_path: 'blocked.zip', target_dir: '' }),
    });
    assert.equal(extract.status, 403);

    const scan = await t.client.request('/api/files/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'blocked.zip' }),
    });
    assert.equal(scan.status, 403);
  });

  it('正常 zip 解压到当前目录并异步完成任务', async () => {
    const zip = await makeZip({ 'folder/hello.txt': 'hello extract' });
    await t.client.upload('bundle.zip', zip);

    const response = await t.client.request('/api/files/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_path: 'bundle.zip', target_dir: '' }),
    });
    if (response.status !== 202) {
      console.log('EXTRACT_RESPONSE', response.status, await response.clone().text());
    }
    assert.equal(response.status, 202, await response.clone().text());
    const { taskId } = (await response.json()) as { taskId: string };
    const task = await waitForTask(t.client, taskId);
    assert.equal(task.status, 'completed');

    const listing = await t.client.request('/api/files?path=');
    const body = (await listing.json()) as { entries: Array<{ name: string; type: string }> };
    assert.ok(body.entries.some((entry) => entry.name === 'folder' && entry.type === 'dir'));
  });

  it('包含 ../../evil.txt 的恶意 zip 被 safePath 拦截，且不会写出文件', async () => {
    const zip = await makeZip({ '../../evil.txt': 'evil', 'safe/ok.txt': 'ok' });
    await t.client.upload('evil.zip', zip);

    const response = await t.client.request('/api/files/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_path: 'evil.zip', target_dir: '' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, 'PATH_TRAVERSAL');

    const outside = path.join(t.storageRoot, '..', '..', 'evil.txt');
    assert.equal(existsSync(outside), false);
  });
});
