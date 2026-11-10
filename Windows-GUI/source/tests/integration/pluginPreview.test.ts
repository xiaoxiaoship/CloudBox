import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

describe('plugin preview extension', () => {
  let t: TestServer | null = null;
  const pluginRoot = path.join(os.tmpdir(), 'cloudbox-plugin-preview-' + process.pid + '-' + Date.now());

  afterEach(async () => {
    await t?.close();
    t = null;
    await rm(pluginRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('启用 json-explorer 后映射 .json 并通过插件 iframe API 渲染', async () => {
    t = await createTestServer({ pluginRoot });
    await t.services.plugins.importFolder(path.resolve('resources/plugins/json-explorer'));
    await t.services.plugins.setEnabled('json-explorer', true);
    await t.client.upload(
      'test.json',
      Buffer.from(JSON.stringify({ name: 'demo', nested: { count: 3, ok: true }, items: [1, 'two'] })),
      { path: '' },
    );

    const mapping = await t.client.request('/api/plugins/previewers');
    assert.equal(mapping.status, 200);
    assert.deepEqual(await mapping.json(), { '.json': 'json-explorer' });

    const preview = await t.client.request('/api/plugins/json-explorer/preview?path=test.json');
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type') ?? '', /text\/html/);
    const html = await preview.text();
    assert.match(html, /JSON Explorer/);
    assert.match(html, /demo/);
    assert.match(html, /nested/);

    const traversal = await t.client.request('/api/plugins/json-explorer/preview?path=../test.json');
    assert.equal(traversal.status, 400);
  });
});
