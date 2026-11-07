#!/usr/bin/env node
/**
 * 公开注册 Web E2E：关闭时隐藏入口；开启后注册、切回登录、登录并上传。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createTestServer } from '../tests/helpers/testServer.ts';

const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  const t = await createTestServer();
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  try {
    await page.goto(t.client.baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '登录', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '点击注册' }).count(), 0);

    t.services.settings.set('allow_public_registration', true, null);
    await page.reload({ waitUntil: 'networkidle' });
    const registerLink = page.getByRole('button', { name: '点击注册' });
    await registerLink.waitFor();

    await registerLink.click();
    const dialog = page.getByRole('dialog', { name: '注册账号' });
    await dialog.waitFor();
    await page.screenshot({ path: path.resolve('artifacts/e2e-register-dialog.png') });

    await page.getByLabel('用户名', { exact: true }).last().fill('webuser');
    await page.getByLabel('密码', { exact: true }).last().fill('Passw0rd!');
    await page.getByLabel('确认密码', { exact: true }).fill('Passw0rd!');
    await dialog.getByRole('button', { name: '注册' }).click();

    await page.getByText('注册成功，请登录').waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.resolve('artifacts/e2e-register-success.png') });
    assert.equal(await page.getByLabel('用户名', { exact: true }).inputValue(), 'webuser');

    await page.getByLabel('密码', { exact: true }).fill('Passw0rd!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '我的文件' }).waitFor();

    await page.setInputFiles('input[type=file]', {
      name: 'registered-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('registered user can upload'),
    });
    await page.getByRole('button', { name: 'registered-upload.txt', exact: true }).waitFor();
    console.log('✔ 公开注册 Web E2E 通过');
  } finally {
    await browser.close();
    await t.close();
  }
}

main().catch((error: unknown) => {
  console.error('✖ 公开注册 Web E2E 失败：', error);
  process.exitCode = 1;
});
