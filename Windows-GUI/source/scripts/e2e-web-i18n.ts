#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createTestServer } from '../tests/helpers/testServer.ts';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  const t = await createTestServer();
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(t.client.baseUrl, { waitUntil: 'networkidle' });
    const language = page.locator('select[aria-label="语言"]');
    await language.selectOption('en-US');
    await page.getByRole('button', { name: 'Sign in' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('cloudbox.language')), 'en-US');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('select[aria-label="Language"]').inputValue(), 'en-US');
    assert.equal(await page.getByRole('button', { name: 'Sign in' }).count(), 1);
    await page.locator('select[aria-label="Language"]').selectOption('zh-CN');
    await page.getByRole('button', { name: '登录' }).waitFor();
    console.log('I18N_WEB_E2E_OK');
  } finally {
    await browser.close();
    await t.close();
  }
}

main().catch((error: unknown) => {
  console.error('I18N_WEB_E2E_FAILED', error);
  process.exitCode = 1;
});
