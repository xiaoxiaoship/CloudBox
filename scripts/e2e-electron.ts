#!/usr/bin/env node
/**
 * Electron 管理端 E2E（Playwright _electron + 本机 Edge 内核）。
 *
 * 前置：npm run build:desktop
 * 运行：npm run e2e:electron
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const ARTIFACTS = path.resolve('artifacts');
const PORT = 18_000 + Math.floor(Math.random() * 800);

function shot(name: string): string {
  return path.join(ARTIFACTS, name);
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-electron-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.CLOUDBOX_DATA_DIR = dataDir;

  const electronApp = await electron.launch({
    args: [`--user-data-dir=${path.join(dataDir, 'electron-profile')}`, '.'],
    cwd: process.cwd(),
    executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
    env,
    timeout: 30_000,
  });

  try {
    const win = await electronApp.firstWindow({ timeout: 30_000 });
    win.on('pageerror', (error) => console.log('[pageerror]', error.message));
    win.on('console', (message) => {
      if (message.type() === 'error') console.log('[renderer console]', message.text());
    });

    await win.waitForLoadState('domcontentloaded');
    await win.getByText('欢迎使用 CloudBox').waitFor();
    console.log('1. 首次运行向导已显示');
    await win.screenshot({ path: shot('electron-setup.png') });

    const security = (await win.evaluate(`(() => ({
      requireType: typeof window.require,
      processType: typeof window.process,
      electronType: typeof window.electron,
      cloudboxType: typeof window.cloudbox,
      apiKeys: Object.keys(window.cloudbox || {})
    }))()`)) as {
      requireType: string;
      processType: string;
      electronType: string;
      cloudboxType: string;
      apiKeys: string[];
    };
    assert.equal(security.requireType, 'undefined', 'window.require 必须不可用');
    assert.equal(security.processType, 'undefined', 'window.process 必须不可用');
    assert.equal(security.electronType, 'undefined', 'window.electron 必须不可用');
    assert.equal(security.cloudboxType, 'object', 'preload 白名单 API 缺失');
    assert.deepEqual(
      [...security.apiKeys].sort(),
      ['app', 'auth', 'ca', 'files', 'frp', 'plugins', 'server', 'settings', 'users'],
      'preload 暴露的 API 超出白名单',
    );
    console.log('2. 渲染层安全隔离通过', security.apiKeys);

    await win.getByLabel('管理员用户名').fill('admin');
    await win.getByLabel('管理员密码', { exact: true }).fill('Passw0rd!');
    await win.getByLabel('确认密码', { exact: true }).fill('Passw0rd!');
    await win.getByRole('button', { name: '创建管理员并进入' }).click();
    await win.getByRole('heading', { name: '服务概览' }).waitFor();
    console.log('3. 管理员创建并登录成功');
    await win.screenshot({ path: shot('electron-dashboard-offline.png') });

    await win.locator('#server-port').fill(String(PORT));
    await win.getByRole('button', { name: '保存端口' }).click();
    await win.waitForTimeout(300);

    const toggle = win.getByRole('switch', { name: '在线模式' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'false', '默认必须处于离线模式');
    console.log('4. 默认离线模式确认，端口已保存为', PORT);

    await toggle.click();
    await win.getByText('运行中', { exact: true }).waitFor({ timeout: 15_000 });
    await win.waitForTimeout(500);
    console.log('5. 在线模式启动');

    const health = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(health.status, 200, '局域网 HTTP 健康检查失败');
    const index = await fetch(`http://127.0.0.1:${PORT}/`);
    assert.equal(index.status, 200, '用户 Web 端未由 Express 托管');
    await win.screenshot({ path: shot('electron-dashboard-online.png') });
    console.log('6. HTTP 服务与用户 Web 端可访问');

    // 在线状态下切换 trust proxy，验证 HTTP 服务自动重启后仍可用
    await win.getByRole('button', { name: '网络设置' }).click();
    const onlineTrustProxy = win.getByRole('switch', {
      name: '信任反向代理的真实 IP',
    });
    await onlineTrustProxy.waitFor();
    await onlineTrustProxy.click();
    await win.getByText('已开启信任反向代理真实 IP').waitFor();
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/health`)).status, 200);
    await onlineTrustProxy.click();
    await win.getByText('已关闭信任反向代理真实 IP').waitFor();
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/health`)).status, 200);

    // 创建普通用户
    await win.getByRole('button', { name: '用户管理' }).click();
    await win.getByRole('button', { name: '新建用户' }).click();
    await win.locator('#new-username').fill('e2euser');
    await win.locator('#new-password').fill('Passw0rd!');
    await win.getByRole('button', { name: '创建用户' }).click();
    await win.getByRole('cell', { name: /e2euser/ }).waitFor();
    console.log('7. 普通用户创建成功');
    await win.screenshot({ path: shot('electron-users.png') });

    // 用普通用户通过 HTTP 上传文件
    const loginResponse = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'e2euser', password: 'Passw0rd!' }),
    });
    assert.equal(loginResponse.status, 200, '普通用户 HTTP 登录失败');
    const loginBody = (await loginResponse.json()) as { csrfToken: string };
    const cookies = loginResponse.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');

    const form = new FormData();
    form.append('file', new Blob(['hello from electron e2e']), 'hello.txt');
    const upload = await fetch(`http://127.0.0.1:${PORT}/api/files/upload?path=`, {
      method: 'POST',
      headers: { cookie: cookies, 'x-csrf-token': loginBody.csrfToken },
      body: form,
    });
    assert.equal(upload.status, 201, '普通用户上传失败');
    console.log('8. 普通用户通过 HTTP 上传成功');

    // 连续错误密码触发账户锁定，随后在管理员 GUI 中纯净解锁
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'e2euser', password: 'Wrong-password-1' }),
      });
    }

    // 关闭在线模式，验证离线浏览
    await win.getByRole('button', { name: '服务概览' }).click();
    await win.getByRole('switch', { name: '在线模式' }).click();
    await win.getByText('已停止', { exact: true }).waitFor({ timeout: 15_000 });
    await win.waitForTimeout(400);

    await assert.rejects(async () => {
      await fetch(`http://127.0.0.1:${PORT}/health`);
    });
    console.log('9. 在线模式已关闭，端口停止监听');

    await win.getByRole('button', { name: '用户管理' }).click();
    const lockedRow = win.locator('tr').filter({ hasText: 'e2euser' });
    await lockedRow.getByText('已锁定').waitFor({ timeout: 10_000 });
    const unlockButton = lockedRow.getByLabel('解除锁定');
    assert.equal(await unlockButton.isEnabled(), true);
    await win.screenshot({ path: shot('electron-user-locked.png') });
    await unlockButton.click();
    await win.getByText('账号已解锁').waitFor();
    await lockedRow.getByText('正常').waitFor();
    assert.equal(await unlockButton.isEnabled(), false);
    console.log('9.1 管理员解锁账号且未重置密码');

    await win.getByRole('button', { name: '文件浏览' }).click();
    await win.getByLabel('选择用户').selectOption({ label: 'e2euser' });
    await win.getByRole('button', { name: 'hello.txt', exact: true }).waitFor();
    console.log('10. 离线文件浏览成功');
    await win.screenshot({ path: shot('electron-files.png') });

    // 离线下载：用主进程 dialog stub 避免原生保存对话框阻塞自动化
    const downloadPath = path.join(dataDir, 'downloaded-hello.txt');
    await electronApp.evaluate(({ dialog }, targetPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetPath });
    }, downloadPath);
    await win.getByLabel('下载 hello.txt').click();
    await win.getByText('已保存：downloaded-hello.txt').waitFor({ timeout: 10_000 });
    assert.equal(readFileSync(downloadPath, 'utf8'), 'hello from electron e2e');
    console.log('10.1 离线下载成功');

    console.log('10.2 管理员网页注册开关');
    await win.getByRole('button', { name: '系统设置' }).click();
    const registrationSwitch = win.getByRole('switch', {
      name: '允许用户通过网页自助注册',
    });
    await registrationSwitch.waitFor();
    assert.equal(await registrationSwitch.getAttribute('aria-checked'), 'false');
    await registrationSwitch.click();
    await win.getByText('已开启用户网页自助注册').waitFor();
    assert.equal(await registrationSwitch.getAttribute('aria-checked'), 'true');

    const enabledSettings = await win.evaluate(async () =>
      (globalThis as unknown as {
        cloudbox: { settings: { get: () => Promise<{ ok: boolean; data: { allowPublicRegistration: boolean } }> } };
      }).cloudbox.settings.get(),
    );
    assert.equal(enabledSettings.ok, true);
    assert.equal(enabledSettings.data.allowPublicRegistration, true);

    await win.screenshot({ path: shot('electron-settings-registration.png') });
    await registrationSwitch.click();
    await win.getByText('已关闭用户网页自助注册').waitFor();
    assert.equal(await registrationSwitch.getAttribute('aria-checked'), 'false');

    console.log('10.3 信任代理与 frp 配置生成');
    await win.getByRole('button', { name: '网络设置' }).click();
    const trustProxySwitch = win.getByRole('switch', {
      name: '信任反向代理的真实 IP',
    });
    await trustProxySwitch.waitFor();
    await trustProxySwitch.click();
    await win.getByText('已开启信任反向代理真实 IP').waitFor();
    assert.equal(await trustProxySwitch.getAttribute('aria-checked'), 'true');

    const settingsWithProxy = await win.evaluate(async () =>
      (globalThis as unknown as {
        cloudbox: {
          settings: {
            get: () => Promise<{
              ok: boolean;
              data: { trustProxy: boolean; allowPublicRegistration: boolean };
            }>;
          };
        };
      }).cloudbox.settings.get(),
    );
    assert.equal(settingsWithProxy.ok, true);
    assert.equal(settingsWithProxy.data.trustProxy, true);
    await win.screenshot({ path: shot('electron-trust-proxy.png') });
    await trustProxySwitch.click();
    await win.getByText('已关闭信任反向代理真实 IP').waitFor();

    await win.locator('#frp-server').fill('127.0.0.1');
    await win.locator('#frp-type').selectOption('http');
    await win.locator('#frp-domain').fill('cloud.example.com');
    await win.getByRole('button', { name: '保存配置' }).click();
    await win.getByText('frp 配置已保存').waitFor();
    const httpToml = readFileSync(path.join(dataDir, 'config', 'frpc.toml'), 'utf8');
    assert.match(httpToml, /type = "http"/);
    assert.match(httpToml, /customDomains = \["cloud\.example\.com"\]/);
    assert.match(httpToml, /locations = \["\/", "\/host"\]/);

    await win.locator('#frp-type').selectOption('tcp');
    await win.locator('#frp-remote-port').fill('6001');
    await win
      .locator('label')
      .filter({ hasText: 'PROXY protocol v2' })
      .locator('input')
      .check();
    await win.getByRole('button', { name: '保存配置' }).click();
    await win.getByText('frp 配置已保存').waitFor();
    const tcpToml = readFileSync(path.join(dataDir, 'config', 'frpc.toml'), 'utf8');
    assert.match(tcpToml, /type = "tcp"/);
    assert.match(tcpToml, /transport\.proxyProtocolVersion = "v2"/);

    console.log('10.4 功能权限与查杀设置');
    await win.getByRole('button', { name: '系统设置' }).click();
    const imagePermission = win.getByRole('switch', { name: '图片在线预览' });
    await imagePermission.waitFor();
    assert.equal(await imagePermission.getAttribute('aria-checked'), 'true');
    await imagePermission.click();
    await win.getByText('功能权限已更新').waitFor();
    assert.equal(await imagePermission.getAttribute('aria-checked'), 'false');
    await imagePermission.click();
    await win.getByText('功能权限已更新').waitFor();

    const scanSwitch = win.getByRole('switch', { name: '安全查杀总开关' });
    assert.equal(await scanSwitch.getAttribute('aria-checked'), 'false');
    await scanSwitch.click();
    await win.locator('#scan-mode').selectOption('api');
    await win.locator('#scan-api-key').fill('e2e-api-key');
    await win.getByRole('button', { name: '保存查杀设置' }).click();
    await win.getByText('安全查杀设置已保存').waitFor();

    const securitySettings = await win.evaluate(async () =>
      (globalThis as unknown as {
        cloudbox: {
          settings: {
            get: () => Promise<{
              ok: boolean;
              data: {
                permissions: { allowUserPreviewImage: boolean };
                scan: { enabled: boolean; mode: string; apiKey: string };
              };
            }>;
          };
        };
      }).cloudbox.settings.get(),
    );
    assert.equal(securitySettings.ok, true);
    assert.equal(securitySettings.data.permissions.allowUserPreviewImage, true);
    assert.equal(securitySettings.data.scan.enabled, true);
    assert.equal(securitySettings.data.scan.mode, 'api');
    assert.equal(securitySettings.data.scan.apiKey, 'e2e-api-key');

    console.log('10.5 AI 双模式与 MCP Token');
    const aiSwitch = win.getByRole('switch', { name: 'AI 总开关' });
    if ((await aiSwitch.getAttribute('aria-checked')) !== 'true') await aiSwitch.click();
    await win.locator('#ai-mode').selectOption('user');
    await win.getByRole('button', { name: '保存 AI 与 MCP 设置' }).click();
    await win.getByText('AI 与 MCP 设置已保存').waitFor();
    const aiUserSettings = await win.evaluate(async () =>
      (globalThis as unknown as {
        cloudbox: {
          settings: {
            get: () => Promise<{
              ok: boolean;
              data: { ai: { enabled: boolean; mode: string }; mcp: { token: string } };
            }>;
          };
        };
      }).cloudbox.settings.get(),
    );
    assert.equal(aiUserSettings.data.ai.enabled, true);
    assert.equal(aiUserSettings.data.ai.mode, 'user');

    await win.locator('#ai-mode').selectOption('admin');
    await win.locator('#ai-base-url').fill('https://example.invalid/v1');
    await win.locator('#ai-model').fill('test-model');
    await win.locator('#ai-admin-key').fill('sk-e2e-admin-secret');
    await win.getByRole('button', { name: '保存 AI 与 MCP 设置' }).click();
    await win.getByText('AI 与 MCP 设置已保存').waitFor();
    const aiAdminSettings = await win.evaluate(async () =>
      (globalThis as unknown as {
        cloudbox: {
          settings: {
            get: () => Promise<{
              ok: boolean;
              data: {
                ai: { enabled: boolean; mode: string; apiKeyMasked: string };
                mcp: { token: string };
              };
            }>;
          };
        };
      }).cloudbox.settings.get(),
    );
    assert.equal(aiAdminSettings.data.ai.mode, 'admin');
    assert.match(aiAdminSettings.data.ai.apiKeyMasked, /^sk-\*\*\*/);

    await win.getByRole('button', { name: '生成随机 Token' }).click();
    await win.getByText('MCP Token 已重新生成').waitFor();
    assert.ok((await win.locator('#mcp-token').inputValue()).length > 10);

    console.log('10.6 内嵌静态托管总控');
    const hostingSwitch = win.getByRole('switch', { name: '静态托管总开关' });
    if ((await hostingSwitch.getAttribute('aria-checked')) !== 'true') await hostingSwitch.click();
    await win.locator('#hosting-base-url').fill('https://pan.example.com');
    await win.getByRole('button', { name: '保存托管设置' }).click();
    await win.getByText('静态托管设置已保存').waitFor();
    const hostingSettings = await win.evaluate(async () =>
      (globalThis as unknown as {
        cloudbox: {
          settings: {
            get: () => Promise<{
              ok: boolean;
              data: { hosting: { enabled: boolean; baseUrl: string } };
            }>;
          };
        };
      }).cloudbox.settings.get(),
    );
    assert.equal(hostingSettings.data.hosting.enabled, true);
    assert.equal(hostingSettings.data.hosting.baseUrl, 'https://pan.example.com');

    // 关闭窗口应最小化到托盘，而不是退出
    const trayState = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.close();
      return {
        windowCount: BrowserWindow.getAllWindows().length,
        visible: window?.isVisible() ?? null,
      };
    });
    assert.equal(trayState.windowCount, 1, '关闭窗口后进程不应退出');
    assert.equal(trayState.visible, false, '关闭窗口后应隐藏到托盘');
    console.log('11. 关闭窗口后最小化到托盘');

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.show();
    });
    await win.waitForTimeout(300);

    console.log('12. 准备退出');
    await win.screenshot({ path: shot('electron-dashboard-final.png') });
    await electronApp.close();
    console.log('\n✔ Electron E2E 全部通过');
  } finally {
    try {
      await electronApp.close();
    } catch {
      // 已退出
    }
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error: unknown) => {
  console.error('\n✖ Electron E2E 失败：', error);
  process.exitCode = 1;
});
