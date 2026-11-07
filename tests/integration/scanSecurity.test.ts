import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import type { LocalScanner, VirusTotalClient } from '../../src/core/services/scanService.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';
import { makeZip } from '../helpers/zip.ts';

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const EICAR_HASH = createHash('sha256').update(EICAR).digest('hex');

async function waitForTask(t: TestServer, taskId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await t.client.request(`/api/tasks/${taskId}`);
    assert.equal(response.status, 200);
    const task = (await response.json()) as { status: string; error: string | null };
    if (['clean', 'infected', 'failed'].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('scan task timeout');
}

function apiScanner(infectedHashes: Set<string>): VirusTotalClient {
  return {
    async lookup(hash) {
      return { positives: infectedHashes.has(hash) ? 1 : 0, details: {} };
    },
  };
}

const localScanner: LocalScanner = {
  async scan(filePath) {
    const content = readFileSync(filePath).toString('utf8');
    return { infected: content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') };
  },
};

describe('dual-mode scan + infected enforcement', () => {
  let t: TestServer | null = null;

  afterEach(async () => {
    await t?.close();
    t = null;
  });

  it('API 模式：EICAR 识别为 infected，下载/分享/解压被拦截', async () => {
    const zip = await makeZip({ 'safe.txt': 'archive content' });
    const zipHash = createHash('sha256').update(zip).digest('hex');
    t = await createTestServer({
      scanEnabled: true,
      scanMode: 'api',
      virusTotalClient: apiScanner(new Set([EICAR_HASH, zipHash])),
    });
    t.services.settings.set('scan.api_key', 'test-api-key', null);

    await t.client.upload('eicar.txt', Buffer.from(EICAR));
    const scan = await t.client.request('/api/files/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'eicar.txt' }),
    });
    assert.equal(scan.status, 202);
    const { taskId } = (await scan.json()) as { taskId: string };
    const task = await waitForTask(t, taskId);
    assert.equal(task.status, 'infected');

    const download = await t.client.request('/api/files/download?path=eicar.txt');
    assert.equal(download.status, 403);
    assert.equal((await download.json() as { code: string }).code, 'FILE_INFECTED');

    const share = await t.client.request('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_path: 'eicar.txt', duration_seconds: 300 }),
    });
    assert.equal(share.status, 403);

    await t.client.upload('infected.zip', zip);
    const zipScan = await t.client.request('/api/files/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'infected.zip' }),
    });
    const zipTaskId = (await zipScan.json() as { taskId: string }).taskId;
    assert.equal((await waitForTask(t, zipTaskId)).status, 'infected');

    const extract = await t.client.request('/api/files/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_path: 'infected.zip', target_dir: '' }),
    });
    assert.equal(extract.status, 403);
    assert.equal((await extract.json() as { code: string }).code, 'FILE_INFECTED');
  });

  it('本地模式：EICAR 识别为 infected，干净文件为 clean', async () => {
    t = await createTestServer({
      scanEnabled: true,
      scanMode: 'local',
      localScanner,
    });
    t.services.settings.set('scan.local_path', 'C:\\FakeClamAV', null);

    await t.client.upload('eicar.txt', Buffer.from(EICAR));
    await t.client.upload('clean.txt', Buffer.from('clean content'));

    const infectedScan = await t.client.request('/api/files/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'eicar.txt' }),
    });
    const infectedTask = await waitForTask(
      t,
      (await infectedScan.json() as { taskId: string }).taskId,
    );
    assert.equal(infectedTask.status, 'infected');
    assert.equal(
      (await t.client.request('/api/files/download?path=eicar.txt')).status,
      403,
    );

    const cleanScan = await t.client.request('/api/files/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'clean.txt' }),
    });
    const cleanTask = await waitForTask(
      t,
      (await cleanScan.json() as { taskId: string }).taskId,
    );
    assert.equal(cleanTask.status, 'clean');
    assert.equal(
      (await t.client.request('/api/files/download?path=clean.txt')).status,
      200,
    );
  });

  it('总开关关闭时拒绝发起查杀', async () => {
    t = await createTestServer({ scanEnabled: false });
    await t.client.upload('clean.txt', Buffer.from('clean'));
    const response = await t.client.request('/api/files/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'clean.txt' }),
    });
    assert.equal(response.status, 403);
  });

  it('API 模式拒绝超过 32MB 的文件，不调用外部 API', async () => {
    let called = false;
    t = await createTestServer({
      scanEnabled: true,
      scanMode: 'api',
      quotaBytes: 64 * 1024 * 1024,
      virusTotalClient: {
        async lookup() {
          called = true;
          return { positives: 0 };
        },
      },
    });
    t.services.settings.set('scan.api_key', 'test-api-key', null);

    await t.client.upload('large.bin', Buffer.alloc(32 * 1024 * 1024 + 1, 1));
    const response = await t.client.request('/api/files/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'large.bin' }),
    });
    assert.equal(response.status, 413);
    assert.equal(called, false);
  });
});
