import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UpdateService } from '../../src/core/services/updateService.ts';
import { UpdateManager } from '../../src/core/services/updateManager.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
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

  it('selects the matching Setup or Server asset and drives update status', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      tag_name: 'v1.3.0',
      body: 'notes',
      html_url: 'https://github.com/owner/repo/releases/tag/v1.3.0',
      assets: [
        { name: 'CloudBox-Setup-1.3.0-x64.exe', browser_download_url: 'https://example.test/setup.exe', size: 10, digest: 'sha256:abc' },
        { name: 'CloudBox-Server-1.3.0-x64.exe', browser_download_url: 'https://example.test/server.exe', size: 20, digest: 'sha256:def' },
      ],
    }), { status: 200 })) as typeof fetch;
    const update = new UpdateService({ settings: { get: () => 'owner/repo' } as unknown as SettingsService, fetchImpl });
    const gui = await update.check('1.2.0', 'gui');
    assert.equal(gui.assetName, 'CloudBox-Setup-1.3.0-x64.exe');
    const server = await new UpdateService({ settings: { get: () => 'owner/repo' } as unknown as SettingsService, fetchImpl }).check('1.2.0', 'server');
    assert.equal(server.assetName, 'CloudBox-Server-1.3.0-x64.exe');

    const dir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-update-test-'));
    try {
      const manager = new UpdateManager({
        update: {
          check: async () => ({ ...gui, hasUpdate: true }),
          downloadAsset: async (_asset: unknown, destination: string, progress: (done: number, total: number | null) => void) => {
            progress(5, 10);
            progress(10, 10);
            await import('node:fs/promises').then(({ writeFile }) => writeFile(destination, 'binary'));
          },
        } as unknown as UpdateService,
        currentVersion: '1.2.0',
        mode: 'gui',
        downloadDir: dir,
        install: async () => {},
      });
      await manager.check();
      await manager.download();
      assert.equal(manager.status().phase, 'downloaded');
      assert.equal(manager.status().progress, 100);
      await manager.install();
      assert.equal(manager.status().phase, 'restarting');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('downloads an installer locally with progress and verifies SHA-256', async () => {
    const payload = Buffer.from('cloudbox-update-payload');
    const digest = 'sha256:' + createHash('sha256').update(payload).digest('hex');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length });
      res.end(payload);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-download-test-'));
    try {
      const update = new UpdateService({ settings: { get: () => 'owner/repo' } as unknown as SettingsService });
      const destination = path.join(dir, 'setup.exe');
      let last = 0;
      await update.downloadAsset(
        { url: `http://127.0.0.1:${port}/setup.exe`, size: payload.length, digest },
        destination,
        (done) => { last = done; },
      );
      assert.equal(last, payload.length);
      assert.deepEqual(readFileSync(destination), payload);
      await assert.rejects(
        () => update.downloadAsset(
          { url: `http://127.0.0.1:${port}/setup.exe`, size: payload.length, digest: 'sha256:' + '0'.repeat(64) },
          path.join(dir, 'bad.exe'), () => {},
        ),
        /SHA-256/,
      );
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
