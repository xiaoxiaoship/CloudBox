#!/usr/bin/env node
/** 原生 AI 悬浮球 / 流式对话 / 写文件 / 确认卡片 / 5 秒防误触 E2E。 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createTestServer } from '../tests/helpers/testServer.ts';
import type { AiChatClient } from '../src/core/services/aiService.ts';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  let call = 0;
  const aiClient: AiChatClient = {
    async chat() {
      call += 1;
      if (call === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'write_text_file',
              arguments: { path: 'ai-e2e.txt', content: 'created by ai' },
            },
          ],
        };
      }
      if (call === 2) return { content: '已写入 ai-e2e.txt', toolCalls: [] };
      if (call === 3) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'tool-2',
              name: 'write_text_file',
              arguments: { path: 'ai-e2e.txt', content: 'overwritten by ai' },
            },
          ],
        };
      }
      return { content: '完成', toolCalls: [] };
    },
  };

  const t = await createTestServer({ aiClient });
  t.services.ai.saveAdmin({
    enabled: true,
    mode: 'admin',
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'sk-e2e-secret-123',
    model: 'test-model',
    dailyLimit: 50,
    mcpEnabled: false,
  });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(t.client.baseUrl, { waitUntil: 'networkidle' });
    await page.getByLabel('用户名', { exact: true }).fill('alice');
    await page.getByLabel('密码', { exact: true }).fill('Passw0rd!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '我的文件' }).waitFor();

    assert.equal(await page.getByLabel('打开 AI 助手').count(), 1);
    await page.getByLabel('打开 AI 助手').click();
    await page.getByPlaceholder('输入指令，例如：读取 src/main.py 并解释').fill('创建一个文件');
    await page.getByRole('button', { name: '发送' }).click();
    await page.getByText('已写入 ai-e2e.txt').waitFor({ timeout: 15_000 });
    const listing = await t.client.request('/api/files?path=');
    assert.match(await listing.text(), /ai-e2e\.txt/);

    await page.getByPlaceholder('输入指令，例如：读取 src/main.py 并解释').fill('覆盖文件');
    await page.getByRole('button', { name: '发送' }).click();
    await page.getByText('高危操作待确认').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '确认执行' }).click();
    await page.getByText('已执行 write_text_file。').waitFor({ timeout: 10_000 });
    const read = await t.services.files.readText(t.user, 'ai-e2e.txt', {
      ip: '127.0.0.1',
      userAgent: 'e2e',
      requestId: null,
    });
    assert.equal(read.content, 'overwritten by ai');
    await page.screenshot({ path: 'artifacts/e2e-ai-chat.png' });

    await page.getByLabel('AI 个人设置').click();
    await page.getByText('全盘操作（高危）').click();
    const acknowledge = page.getByRole('button', { name: /我已知晓风险/ });
    await acknowledge.waitFor();
    assert.equal(await acknowledge.isDisabled(), true);
    await page.waitForTimeout(5_400);
    assert.equal(await acknowledge.isDisabled(), false);
    await page.getByRole('button', { name: '我已知晓风险' }).click();
    await page.screenshot({ path: 'artifacts/e2e-ai-scope-warning.png' });
    console.log('AI_E2E_OK');
  } finally {
    await browser.close();
    await t.close();
  }
}

main().catch((error: unknown) => {
  console.error('AI_E2E_FAILED', error);
  process.exitCode = 1;
});
