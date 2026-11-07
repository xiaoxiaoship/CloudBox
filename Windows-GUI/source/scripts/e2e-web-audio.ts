#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createTestServer } from '../tests/helpers/testServer.ts';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  const t = await createTestServer();
  const mp3 = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.alloc(128, 0),
    Buffer.from([0xff, 0xfb, 0x90, 0x64]),
    Buffer.alloc(1024, 0),
  ]);
  await t.client.upload('song-one.mp3', mp3);
  await t.client.upload('song-two.mp3', mp3);

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(t.client.baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('用户名', { exact: true }).fill('alice');
    await page.getByLabel('密码', { exact: true }).fill('Passw0rd!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '我的文件' }).waitFor();
    await page.getByRole('button', { name: 'song-one.mp3', exact: true }).click();
    await page.getByRole('button', { name: '查看播放列表' }).waitFor();
    await page.getByRole('button', { name: '查看播放列表' }).click();
    await page.getByText('2 首').waitFor();
    await page.getByRole('button', { name: '下一首' }).click();
    await page.getByText('song-two', { exact: true }).waitFor();
    await page.screenshot({ path: 'artifacts/e2e-audio-player.png' });
    console.log('AUDIO_WEB_E2E_OK');
  } finally {
    await browser.close();
    await t.close();
  }
}

main().catch((error: unknown) => {
  console.error('AUDIO_WEB_E2E_FAILED', error);
  process.exitCode = 1;
});
