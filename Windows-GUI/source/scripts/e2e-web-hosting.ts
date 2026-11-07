#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createTestServer } from '../tests/helpers/testServer.ts';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  const t = await createTestServer();
  t.services.settings.set('hosting.enabled', true, null);
  await t.client.request('/api/files/folder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '', name: 'public' }),
  });
  await t.client.upload(
    'index.html',
    Buffer.from('<!doctype html><html><body>WEB_HOST_OK</body></html>'),
    { path: 'public' },
  );

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(t.client.baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('用户名', { exact: true }).fill('alice');
    await page.getByLabel('密码', { exact: true }).fill('Passw0rd!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '我的文件' }).waitFor();

    await page.getByLabel('选择 public').check();
    await page.getByRole('button', { name: '部署为网站' }).click();
    await page.getByText(/部署成功/).waitFor({ timeout: 10_000 });
    const hostResponse = await page.request.get(`${t.client.baseUrl}/host/alice/`);
    assert.equal(hostResponse.status(), 200);
    assert.match(await hostResponse.text(), /WEB_HOST_OK/);

    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();
    const denied = await anonymousPage.request.get(`${t.client.baseUrl}/host/alice/`);
    assert.equal(denied.status(), 403);
    await anonymous.close();
    console.log('HOSTING_WEB_E2E_OK');
  } finally {
    await browser.close();
    await t.close();
  }
}

main().catch((error: unknown) => {
  console.error('HOSTING_WEB_E2E_FAILED', error);
  process.exitCode = 1;
});
