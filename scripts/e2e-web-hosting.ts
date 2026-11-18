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
    Buffer.from('<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><h1>WEB_HOST_OK</h1><img id="logo" src="./logo.svg"></body></html>'),
    { path: 'public' },
  );
  await t.client.upload('style.css', Buffer.from('body{background:rgb(1,2,3)}'), { path: 'public' });
  await t.client.upload(
    'logo.svg',
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'),
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

    await page.goto(`${t.client.baseUrl}/host/alice/`, { waitUntil: 'networkidle' });
    await page.locator('#logo').waitFor();
    assert.equal(await page.locator('body').evaluate((node) => (globalThis as unknown as { getComputedStyle: (element: unknown) => { backgroundColor: string } }).getComputedStyle(node).backgroundColor), 'rgb(1, 2, 3)');
    const cssResponse = await page.request.get(`${t.client.baseUrl}/host/alice/style.css`);
    assert.equal(cssResponse.status(), 200);
    assert.match(cssResponse.headers()['content-type'] ?? '', /text\/css/);
    const svgResponse = await page.request.get(`${t.client.baseUrl}/host/alice/logo.svg`);
    assert.equal(svgResponse.status(), 200);
    assert.match(svgResponse.headers()['content-type'] ?? '', /image\/svg/);

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
