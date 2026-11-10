#!/usr/bin/env node
/**
 * 权限 / 安全解压 / 查杀 Web E2E。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createTestServer } from '../tests/helpers/testServer.ts';
import { makeZip } from '../tests/helpers/zip.ts';

const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const localScanner = {
  async scan(filePath: string) {
    const content = readFileSync(filePath).toString('utf8');
    return { infected: content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') };
  },
};

async function main(): Promise<void> {
  const t = await createTestServer({ scanEnabled: true, localScanner });
  t.services.settings.set('scan.local_path', 'C:\\FakeClamAV', null);

  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(t.client.baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('用户名', { exact: true }).fill('alice');
    await page.getByLabel('密码', { exact: true }).fill('Passw0rd!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '我的文件' }).waitFor();

    const normalZip = await makeZip({ 'folder/hello.txt': 'hello extract' });
    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'bundle.zip',
      mimeType: 'application/zip',
      buffer: normalZip,
    });
    await page.getByRole('button', { name: 'bundle.zip', exact: true }).waitFor();
    await page.getByLabel('解压 bundle.zip').click();
    await page.getByText('bundle.zip 已解压').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'folder', exact: true }).waitFor();

    const evilZip = await makeZip({ '../../evil.txt': 'evil' });
    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'evil.zip',
      mimeType: 'application/zip',
      buffer: evilZip,
    });
    await page.getByRole('button', { name: 'evil.zip', exact: true }).waitFor();
    await page.getByLabel('解压 evil.zip').click();
    await page.getByText(/路径|解压|evil/).last().waitFor({ timeout: 10_000 });
    await page.screenshot({ path: path.resolve('artifacts/e2e-extract-slip.png') });

    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'eicar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(EICAR),
    });
    await page.getByRole('button', { name: 'eicar.txt', exact: true }).waitFor();
    await page.getByLabel('查杀 eicar.txt').click();
    await page.getByText(/发现病毒/).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.resolve('artifacts/e2e-scan-infected.png') });

    // 关闭权限后，前端隐藏解压/查杀入口
    t.services.settings.set('allow_user_extract', false, null);
    t.services.settings.set('allow_user_scan', false, null);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '我的文件' }).waitFor();
    assert.equal(await page.getByLabel('解压 bundle.zip').count(), 0);
    assert.equal(await page.getByLabel('查杀 eicar.txt').count(), 0);

    const download = await t.client.request('/api/files/download?path=eicar.txt');
    assert.equal(download.status, 403);
    console.log('✔ 权限 / 解压 / 查杀 Web E2E 通过');
  } finally {
    await browser.close();
    await t.close();
  }
}

main().catch((error: unknown) => {
  console.error('✖ 安全功能 Web E2E 失败：', error);
  process.exitCode = 1;
});
