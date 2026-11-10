#!/usr/bin/env node
/**
 * Web 功能 E2E：视频预览 + 分享直链 UI（独立临时服务器，使用已构建的 dist/web）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createTestServer } from '../tests/helpers/testServer.ts';

const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MP4 = readFileSync('tests/fixtures/sample.mp4');

async function main(): Promise<void> {
  const t = await createTestServer();
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(t.client.baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('用户名', { exact: true }).fill('alice');
    await page.getByLabel('密码', { exact: true }).fill('Passw0rd!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '我的文件' }).waitFor();

    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      buffer: MP4,
    });
    await page.getByRole('button', { name: 'clip.mp4', exact: true }).waitFor();

    await page.getByRole('button', { name: 'clip.mp4', exact: true }).click();
    const preview = page.getByRole('dialog', { name: '预览 clip.mp4' });
    await preview.waitFor();
    const video = preview.locator('video');
    await video.waitFor();
    assert.equal(await video.getAttribute('controls'), '', 'video 缺少 controls');
    assert.equal(await video.getAttribute('preload'), 'metadata', 'video preload 非 metadata');
    const videoClass = (await video.getAttribute('class')) ?? '';
    assert.match(videoClass, /max-h-\[80vh\]/, 'video 缺少最大高度限制');
    assert.match(videoClass, /max-w-full/, 'video 缺少最大宽度限制');
    await page.screenshot({ path: path.resolve('artifacts/e2e-video-preview.png') });
    await page.getByLabel('关闭预览').click();

    await page.getByLabel('分享 clip.mp4').click();
    const shareDialog = page.getByRole('dialog', { name: '分享直链' });
    await shareDialog.waitFor();
    await shareDialog.getByLabel('链接有效期').selectOption('300');
    assert.ok(
      (await shareDialog.innerText()).includes('链接将在 5 分钟后自动失效'),
      '缺少 5 分钟失效警告',
    );
    await shareDialog.getByRole('button', { name: '生成直链' }).click();
    const urlInput = shareDialog.locator('#share-url');
    await urlInput.waitFor({ timeout: 10_000 });
    const shareUrl = await urlInput.inputValue();
    assert.match(shareUrl, /\/api\/public\/s\/[A-Za-z0-9_-]+$/);
    assert.equal(await shareDialog.getByRole('button', { name: '一键复制' }).isVisible(), true);
    await page.screenshot({ path: path.resolve('artifacts/e2e-share.png') });

    const download = await fetch(shareUrl, { headers: { range: 'bytes=0-9' } });
    assert.equal(download.status, 206);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/);
    console.log('✔ 视频预览与分享直链 Web E2E 通过');
  } finally {
    await browser.close();
    await t.close();
  }
}

main().catch((error: unknown) => {
  console.error('✖ Web 功能 E2E 失败：', error);
  process.exitCode = 1;
});
