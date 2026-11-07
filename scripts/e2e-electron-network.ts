#!/usr/bin/env node
/**
 * 阶段 5 E2E：HTTPS 证书导入与切换、二维码、frp 子进程、管理员改密、数据库备份。
 *
 * 前置：npm run build:desktop
 * 运行：npm run e2e:electron:network
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { generate } from 'selfsigned';
import { chromium, _electron as electron } from 'playwright-core';

const ARTIFACTS = path.resolve('artifacts');
const shot = (name: string): string => path.join(ARTIFACTS, name);

function httpsHealth(port: number): Promise<number> {
  return healthRequest({ host: '127.0.0.1', port, path: '/health', rejectUnauthorized: false });
}

function httpsHealthWithPfx(port: number, pfxPath: string): Promise<number> {
  return healthRequest({
    host: '127.0.0.1',
    port,
    path: '/health',
    rejectUnauthorized: false,
    pfx: readFileSync(pfxPath),
    passphrase: 'changeit',
  });
}

function healthRequest(options: https.RequestOptions): Promise<number> {
  return new Promise<number>((resolve) => {
    const request = https.get(
      { ...options, timeout: 5_000 },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', () => resolve(0));
    request.on('timeout', () => {
      request.destroy();
      resolve(0);
    });
  });
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-phase5-'));
  const certPath = path.join(dataDir, 'e2e-cert.crt');
  const keyPath = path.join(dataDir, 'e2e-key.key');
  const backupPath = path.join(dataDir, 'backup-e2e.db');
  const clientP12 = path.join(dataDir, 'client-e2e.p12');
  const caCertPath = path.join(dataDir, 'config', 'ssl', 'ca', 'rootCA.pem');

  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    notAfterDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000),
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });
  writeFileSync(certPath, pems.cert);
  writeFileSync(keyPath, pems.private);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.CLOUDBOX_DATA_DIR = dataDir;

  const port = 19_000 + Math.floor(Math.random() * 500);
  const profileDir = path.join(dataDir, 'electron-profile');
  const packagedExe = process.env.E2E_ELECTRON_EXE;
  const executablePath = packagedExe
    ? path.resolve(packagedExe)
    : path.resolve('node_modules/electron/dist/electron.exe');
  const app = await electron.launch({
    args: [`--user-data-dir=${profileDir}`, ...(packagedExe ? [] : ['.'])],
    cwd: process.cwd(),
    executablePath,
    env,
    timeout: 30_000,
  });

  try {
    const win = await app.firstWindow({ timeout: 30_000 });
    win.on('pageerror', (error) => console.log('[pageerror]', error.message));

    await win.getByText('欢迎使用 CloudBox').waitFor();
    await win.getByLabel('管理员用户名').fill('admin');
    await win.getByLabel('管理员密码', { exact: true }).fill('Passw0rd!');
    await win.getByLabel('确认密码', { exact: true }).fill('Passw0rd!');
    await win.getByRole('button', { name: '创建管理员并进入' }).click();
    await win.getByRole('heading', { name: '服务概览' }).waitFor();
    console.log('1. 管理员就绪');

    await win.getByRole('button', { name: '网络设置' }).click();
    await win.getByLabel('监听端口').fill(String(port));

    // 一键生成私有 CA（自动安装）→ 用 CA 签发服务端证书
    await win.getByRole('button', { name: /私有 CA 证书生成/ }).click();
    await win.getByRole('button', { name: '一键生成私有 CA' }).click();
    try {
      await win.getByText('已安装信任', { exact: true }).waitFor({ timeout: 30_000 });
    } catch (error) {
      console.log('CA_TEXT:', (await win.locator('body').innerText()).slice(-1_500));
      const caResult = await win.evaluate(async () =>
        (globalThis as unknown as {
          cloudbox: { ca: { info: () => Promise<unknown>; create: () => Promise<unknown> } };
        }).cloudbox.ca.info(),
      ).catch((cause: unknown) => ({ evaluateError: String(cause) }));
      console.log('CA_INFO:', JSON.stringify(caResult));
      await win.screenshot({ path: shot('electron-ca-error.png') });
      throw error;
    }
    const duplicate = await win.evaluate(async () =>
      (globalThis as unknown as {
        cloudbox: { ca: { create: () => Promise<{ ok: boolean; code?: string }> } };
      }).cloudbox.ca.create(),
    );
    assert.equal(duplicate.ok, false, '已存在的 CA 不应被覆盖');
    assert.equal(duplicate.code, 'CA_ALREADY_EXISTS');
    console.log('2. 私有 CA 生成并安装到系统信任库（重复生成被拒绝）');

    await win.getByRole('button', { name: '签发服务端证书' }).click();
    await win.getByText(/网络设置已保存（HTTPS/).waitFor({ timeout: 15_000 });
    await win.getByRole('switch', { name: '在线模式' }).click();
    await win.getByText(new RegExp(`运行中 · HTTPS · 0\\.0\\.0\\.0:${port}`)).waitFor({
      timeout: 15_000,
    });
    await win.waitForTimeout(500);

    assert.equal(await httpsHealth(port), 200, 'CA 签发的 HTTPS /health 不可访问');
    console.log('3. CA 签发服务端证书，HTTPS 启动并返回 200');

    // 普通用户登录页：根证书下载入口与下载响应
    const edgePath =
      process.env.EDGE_PATH ??
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const browser = await chromium.launch({ executablePath: edgePath, headless: true });
    try {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
      });
      const page = await context.newPage();
      await page.goto(`https://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
      const caLink = page.getByRole('link', { name: /首次访问遇到安全警告/ });
      await caLink.waitFor({ timeout: 15_000 });
      await page.screenshot({ path: shot('electron-login-ca.png') });
      const downloadPromise = page.waitForEvent('download');
      await caLink.click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'root-ca.crt');
      const downloadPath = await download.path();
      assert.ok(downloadPath);
      const downloaded = readFileSync(downloadPath, 'utf8');
      assert.match(downloaded, /BEGIN CERTIFICATE/);
      console.log('3.1 登录页根证书下载入口可见且下载成功');
    } finally {
      await browser.close();
    }

    // 导出客户端证书
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, clientP12);
    await win.getByRole('button', { name: '导出客户端证书' }).click();
    await win.getByText(/客户端证书已导出/).waitFor({ timeout: 15_000 });
    assert.ok(statSync(clientP12).size > 0, '客户端 PKCS#12 文件为空');
    console.log('4. 客户端证书导出成功');

    // 开启 mTLS：无客户端证书失败，带 p12 成功
    await win.getByLabel('要求客户端证书（mTLS）').check();
    await win.getByRole('button', { name: '应用并重启' }).click();
    await win.waitForTimeout(900);
    assert.equal(await httpsHealth(port), 0, 'mTLS 开启后无客户端证书仍可访问');
    assert.equal(
      await httpsHealthWithPfx(port, clientP12),
      200,
      '携带客户端证书仍无法访问 mTLS 服务',
    );
    await win.getByLabel('要求客户端证书（mTLS）').scrollIntoViewIfNeeded();
    await win.screenshot({ path: shot('electron-private-ca.png') });
    console.log('5. 双向认证验证通过（无证书拒绝，p12 可访问）');

    await win.getByLabel('要求客户端证书（mTLS）').uncheck();
    await win.getByRole('button', { name: '应用并重启' }).click();
    await win.waitForTimeout(900);
    assert.equal(await httpsHealth(port), 200, '关闭 mTLS 后 HTTPS 不可访问');

    // 卸载 CA（保留文件）
    await win.getByRole('button', { name: '卸载私有 CA' }).click();
    await win.getByText('已卸载，浏览器将不再信任该 CA').waitFor({ timeout: 15_000 });
    await win.getByText('未安装信任', { exact: true }).waitFor();
    assert.ok(existsSync(caCertPath), '卸载 CA 不应删除本地文件');
    console.log('6. CA 已从系统信任库卸载，文件保留');

    // 手动导入仍可用
    await app.evaluate(({ dialog }, paths) => {
      let index = 0;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths[Math.min(index++, paths.length - 1)] ?? paths[0] ?? ''],
      });
    }, [certPath, keyPath]);

    await win.getByRole('button', { name: '导入证书' }).click();
    await win.getByText('证书已导入').waitFor({ timeout: 10_000 });
    await win.getByRole('button', { name: '导入私钥' }).click();
    await win.getByText('私钥已导入').waitFor({ timeout: 10_000 });
    await win.getByRole('button', { name: '应用并重启' }).click();
    await win.waitForTimeout(900);
    assert.equal(await httpsHealth(port), 200, '手动导入证书后 HTTPS 不可访问');
    console.log('7. 手动导入证书仍可用');

    const qr = win.getByRole('img', { name: /扫码访问/ });
    await qr.waitFor({ timeout: 10_000 });
    const qrSrc = await qr.getAttribute('src');
    assert.ok(qrSrc?.startsWith('data:image/png'), '二维码未生成');
    await win.screenshot({ path: shot('electron-network-https.png') });
    console.log('8. HTTPS 访问地址与二维码生成成功');

    // frp：填写配置、启动子进程、停止
    await win.locator('#frp-server').fill('127.0.0.1');
    await win.locator('#frp-server-port').fill('1');
    await win.locator('#frp-remote-port').fill('6001');
    await win.getByRole('button', { name: '保存配置' }).click();
    await win.getByText('frp 配置已保存').waitFor({ timeout: 10_000 });
    await win.getByRole('button', { name: '启动', exact: true }).click();
    await win.getByText(/运行中 · PID/).waitFor({ timeout: 15_000 });
    console.log('5. frpc 子进程启动成功');
    await win.waitForTimeout(800);
    await win.screenshot({ path: shot('electron-frp.png') });

    await win.locator('#frp-remote-port').fill('6002');
    await win.getByRole('button', { name: '保存配置并热重载' }).click();
    await win.getByText('frp 配置已保存并热重载').waitFor({ timeout: 15_000 });
    await win.getByText(/运行中 · PID/).waitFor({ timeout: 15_000 });
    console.log('5.1 frp 配置热重载成功');

    await win.getByRole('button', { name: '停止', exact: true }).click();
    await win.getByText('未运行', { exact: true }).waitFor({ timeout: 15_000 });
    console.log('6. frpc 已停止');

    // 关闭 HTTPS 服务
    await win.getByRole('switch', { name: '在线模式' }).click();
    await win.getByText('离线模式：不监听端口，仅本机管理').waitFor({ timeout: 15_000 });
    console.log('7. HTTPS 服务已停止');

    // 管理员改密
    await win.getByRole('button', { name: '系统设置' }).click();

    const registrationSwitch = win.getByRole('switch', {
      name: '允许用户通过网页自助注册',
    });
    await registrationSwitch.waitFor();
    assert.equal(await registrationSwitch.getAttribute('aria-checked'), 'false');
    await registrationSwitch.click();
    await win.getByText('已开启用户网页自助注册').waitFor();
    assert.equal(await registrationSwitch.getAttribute('aria-checked'), 'true');
    await win.screenshot({ path: shot('electron-settings-registration.png') });
    await registrationSwitch.click();
    await win.getByText('已关闭用户网页自助注册').waitFor();
    assert.equal(await registrationSwitch.getAttribute('aria-checked'), 'false');

    await win.getByLabel('当前密码').fill('Passw0rd!');
    await win.getByLabel('新密码', { exact: true }).fill('NewPassw0rd!');
    await win.getByLabel('确认新密码').fill('NewPassw0rd!');
    await win.getByRole('button', { name: '修改密码' }).click();
    await win.getByRole('heading', { name: '管理员登录' }).waitFor({ timeout: 15_000 });
    console.log('8. 管理员改密后会话失效，回到登录页');

    await win.getByLabel('用户名', { exact: true }).fill('admin');
    await win.getByLabel('密码', { exact: true }).fill('NewPassw0rd!');
    await win.getByRole('button', { name: '登录', exact: true }).click();
    await win.getByRole('heading', { name: '服务概览' }).waitFor();
    console.log('9. 新密码登录成功');

    // 数据库备份：stub 原生保存对话框
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, backupPath);

    await win.getByRole('button', { name: '系统设置' }).click();
    await win.getByRole('button', { name: '选择位置并备份' }).click();
    await win.getByText(/数据库已备份/).waitFor({ timeout: 15_000 });
    const backupSize = statSync(backupPath).size;
    assert.ok(backupSize > 0, '数据库备份文件为空');

    const backupDb = new Database(backupPath, { readonly: true });
    try {
      const adminCount = backupDb
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
        .get() as { n: number };
      assert.equal(adminCount.n, 1, '备份数据库缺少管理员账户');
    } finally {
      backupDb.close();
    }
    console.log('10. 数据库备份成功且可读取，大小', backupSize, 'bytes');
    await win.screenshot({ path: shot('electron-settings.png') });

    await app.close();
    console.log('\n✔ 阶段 5 E2E 全部通过');
  } finally {
    try {
      await app.close();
    } catch {
      // 已退出
    }

    // 测试失败时也尽量清理当前用户信任库中的测试 CA
    try {
      execFileSync(path.resolve('resources/bin/mkcert.exe'), ['-uninstall'], {
        env: { ...process.env, CAROOT: path.join(dataDir, 'config', 'ssl', 'ca') },
        stdio: 'ignore',
      });
    } catch {
      // CA 不存在或已卸载
    }

    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error: unknown) => {
  console.error('\n✖ 阶段 5 E2E 失败：', error);
  process.exitCode = 1;
});
