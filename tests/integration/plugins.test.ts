import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';
import { makeZip } from '../helpers/zip.ts';

describe('plugin runtime and web extensions', () => {
  let t: TestServer | null = null;

  afterEach(async () => {
    await t?.close();
    t = null;
  });

  it('导入示例插件、启用并调用 API；禁用后 404 且子进程停止', async () => {
    t = await createTestServer();
    await t.services.plugins.importFolder(path.resolve('resources/plugins/ai-summary'));
    const imported = t.services.plugins.list().find((plugin) => plugin.name === 'ai-summary');
    assert.ok(imported);
    assert.equal(imported.enabled, false);
    assert.equal(imported.hasAdminUi, true);

    const zipDirectory = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-plugin-zip-'));
    const zipPath = path.join(zipDirectory, 'zip-demo.zip');
    writeFileSync(
      zipPath,
      await makeZip({
        'manifest.json': JSON.stringify({ name: 'zip-demo', version: '1.0.0' }),
        'index.js': 'module.exports = async function activate() {};',
      }),
    );
    const zipped = await t.services.plugins.importZip(zipPath);
    assert.ok(zipped.some((plugin) => plugin.name === 'zip-demo'));

    await t.services.plugins.setEnabled('ai-summary', true);
    const running = t.services.plugins.list().find((plugin) => plugin.name === 'ai-summary');
    assert.equal(running?.running, true);

    const response = await t.client.request('/api/plugins/ai-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'CloudBox plugin runtime test' }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = (await response.json()) as { demo: boolean; summary: string };
    assert.equal(body.demo, true);
    assert.match(body.summary, /CloudBox/);

    await t.services.plugins.setEnabled('ai-summary', false);
    const stopped = t.services.plugins.list().find((plugin) => plugin.name === 'ai-summary');
    assert.equal(stopped?.running, false);
    const denied = await t.client.request('/api/plugins/ai-summary/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'after disable' }),
    });
    assert.equal(denied.status, 404);
  });

  it('CSS 主题注入和 Web 接管', async () => {
    t = await createTestServer();
    await t.services.plugins.importFolder(path.resolve('resources/plugins/dark-neon-theme'));
    await t.services.plugins.setEnabled('dark-neon-theme', true);
    const css = await t.client.request('/api/public/plugin-theme.css');
    assert.equal(css.status, 200);
    assert.match(await css.text(), /plugin-neon/);

    const html = await t.client.request('/', { headers: { accept: 'text/html' } });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /plugin-theme\.css/);

    const overrideDirectory = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-plugin-override-'));
    mkdirSync(path.join(overrideDirectory, 'web-override'), { recursive: true });
    writeFileSync(
      path.join(overrideDirectory, 'manifest.json'),
      JSON.stringify({ name: 'override-demo', version: '1.0.0' }),
    );
    writeFileSync(
      path.join(overrideDirectory, 'index.js'),
      'module.exports = async function activate() {};\n',
    );
    writeFileSync(
      path.join(overrideDirectory, 'web-override', 'index.html'),
      '<!doctype html><html><body>OVERRIDE_BY_PLUGIN</body></html>',
    );
    writeFileSync(
      path.join(overrideDirectory, 'web-override', 'asset.js'),
      'window.__override = true;',
    );

    await t.services.plugins.importFolder(overrideDirectory);
    await t.services.plugins.setEnabled('override-demo', true);
    t.services.plugins.setAllowWebOverride('override-demo', true);
    const page = await t.client.request('/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /OVERRIDE_BY_PLUGIN/);

    const asset = await t.client.request('/plugin-web/override-demo/asset.js');
    assert.equal(asset.status, 200, await asset.clone().text());
    assert.match(await asset.text(), /__override/);
  });
});
