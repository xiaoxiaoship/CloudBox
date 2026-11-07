#!/usr/bin/env node
/**
 * 插件 GUI / iframe / CSS 注入 E2E（开发版 Electron）。
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, chromium } from 'playwright-core';

const PORT = 18_800 + Math.floor(Math.random() * 80);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-plugin-e2e-'));
  const pluginRoot = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-plugin-root-'));
  cpSync('resources/plugins/ai-summary', path.join(pluginRoot, 'ai-summary'), { recursive: true });
  cpSync('resources/plugins/dark-neon-theme', path.join(pluginRoot, 'dark-neon-theme'), {
    recursive: true,
  });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.CLOUDBOX_DATA_DIR = dataDir;
  env.CLOUDBOX_PLUGINS_DIR = pluginRoot;

  const packagedExe = process.env.E2E_ELECTRON_EXE;
  const app = await electron.launch({
    args: [
      `--user-data-dir=${path.join(dataDir, 'electron-profile')}`,
      ...(packagedExe ? [] : ['.']),
    ],
    cwd: process.cwd(),
    executablePath: packagedExe ? path.resolve(packagedExe) : path.resolve('node_modules/electron/dist/electron.exe'),
    env,
    timeout: 30_000,
  });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    const win = await app.firstWindow({ timeout: 30_000 });
    await win.waitForLoadState('domcontentloaded');
    await win.getByText('欢迎使用 CloudBox').waitFor();
    await win.getByLabel('管理员用户名').fill('admin');
    await win.getByLabel('管理员密码', { exact: true }).fill('Passw0rd!');
    await win.getByLabel('确认密码', { exact: true }).fill('Passw0rd!');
    await win.getByRole('button', { name: '创建管理员并进入' }).click();
    await win.getByRole('heading', { name: '服务概览' }).waitFor();

    await win.getByRole('button', { name: '插件', exact: true }).click();
    await win.getByText('ai-summary', { exact: true }).waitFor();
    await win.getByText('dark-neon-theme', { exact: true }).waitFor();

    const aiSwitch = win.getByRole('switch', { name: '启用 ai-summary' });
    await aiSwitch.click();
    await win.getByText('插件 ai-summary 已启用').waitFor();
    await win.getByText('运行中', { exact: true }).waitFor();

    await win.getByRole('button', { name: '配置界面' }).click();
    const frame = win.frameLocator('iframe[title="ai-summary 插件配置"]');
    await frame.getByText('AI Summary 插件配置').waitFor({ timeout: 10_000 });
    await win.screenshot({ path: 'artifacts/e2e-plugin-admin-iframe.png' });
    await win.getByText('关闭', { exact: true }).last().click();

    const themeSwitch = win.getByRole('switch', { name: '启用 dark-neon-theme' });
    await themeSwitch.click();
    await win.getByText('插件 dark-neon-theme 已启用').waitFor();

    await win.getByRole('button', { name: '服务概览' }).click();
    await win.locator('#server-port').fill(String(PORT));
    await win.getByRole('button', { name: '保存端口' }).click();
    const online = win.getByRole('switch', { name: '在线模式' });
    if ((await online.getAttribute('aria-checked')) !== 'true') await online.click();
    await win.getByText('运行中', { exact: true }).waitFor({ timeout: 15_000 });

    browser = await chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage();
    const html = await page.request.get(`http://127.0.0.1:${PORT}/`);
    const htmlText = await html.text();
    assert.match(htmlText, /plugin-theme\.css/);
    const css = await page.request.get(`http://127.0.0.1:${PORT}/api/public/plugin-theme.css`);
    assert.match(await css.text(), /--plugin-neon/);
    console.log('PLUGIN_CSS_INJECTION_OK');
    console.log('PLUGIN_E2E_OK', { port: PORT });
  } finally {
    await browser?.close();
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(pluginRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error('PLUGIN_E2E_FAILED', error);
  process.exitCode = 1;
});
