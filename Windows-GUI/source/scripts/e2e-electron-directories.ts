#!/usr/bin/env node
/**
 * 目录迁移 E2E：
 *  1. 网盘文件目录：迁移数据（复制 storage、更新 paths 配置）
 *  2. 系统数据目录：仅改路径（更新 paths 配置、不复制数据库）
 *
 * 为避免测试触发真实退出，在渲染前 stub app.relaunch/app.exit，仅验证配置与文件结果。
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const ARTIFACTS = path.resolve('artifacts');
const ADMIN = { username: 'admin', password: 'Passw0rd!' };

async function launch(profile: string, pathsFile: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLOUDBOX_DATA_DIR;
  delete env.CLOUDBOX_STORAGE_DIR;
  env.CLOUDBOX_PATHS_FILE = pathsFile;

  const packagedExe = process.env.E2E_ELECTRON_EXE;
  const executablePath = packagedExe
    ? path.resolve(packagedExe)
    : path.resolve('node_modules/electron/dist/electron.exe');

  const app = await electron.launch({
    args: [`--user-data-dir=${profile}`, ...(packagedExe ? [] : ['.'])],
    cwd: process.cwd(),
    executablePath,
    env,
    timeout: 30_000,
  });

  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForTimeout(600);
  return { app, win };
}

async function setupOrLogin(win: Awaited<ReturnType<typeof launch>>['win']): Promise<void> {
  const setupVisible = await win
    .getByText('欢迎使用 CloudBox')
    .isVisible()
    .catch(() => false);

  if (setupVisible) {
    await win.getByLabel('管理员用户名').fill(ADMIN.username);
    await win.getByLabel('管理员密码', { exact: true }).fill(ADMIN.password);
    await win.getByLabel('确认密码', { exact: true }).fill(ADMIN.password);
    await win.getByRole('button', { name: '创建管理员并进入' }).click();
  } else {
    await win.getByLabel('用户名', { exact: true }).fill(ADMIN.username);
    await win.getByLabel('密码', { exact: true }).fill(ADMIN.password);
    await win.getByRole('button', { name: '登录', exact: true }).click();
  }

  await win.getByRole('heading', { name: '服务概览' }).waitFor({ timeout: 20_000 });
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-dir-e2e-'));
  const dataDir = path.join(root, 'data');
  const initialStorage = path.join(root, 'storage-initial');
  const migratedStorage = path.join(root, 'storage-migrated');
  const initialPlugins = path.join(root, 'plugins-initial');
  const migratedPlugins = path.join(root, 'plugins-migrated');
  const newDataDir = path.join(root, 'data-migrated');
  const pathsFile = path.join(root, 'paths.json');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(initialStorage, { recursive: true });
  mkdirSync(initialPlugins, { recursive: true });
  writeFileSync(path.join(initialStorage, 'marker.txt'), 'directory-migration-marker');
  writeFileSync(path.join(initialPlugins, 'plugin-marker.txt'), 'plugin-migration-marker');
  writeFileSync(
    pathsFile,
    JSON.stringify(
      { dataDir, storageDir: initialStorage, pluginsDir: initialPlugins },
      null,
      2,
    ),
    'utf8',
  );

  let firstApp: Awaited<ReturnType<typeof launch>> | null = null;
  let secondApp: Awaited<ReturnType<typeof launch>> | null = null;
  let thirdApp: Awaited<ReturnType<typeof launch>> | null = null;

  try {
    firstApp = await launch(path.join(root, 'profile-1'), pathsFile);
    const { app, win } = firstApp;
    await setupOrLogin(win);

    await app.evaluate(({ app: electronApp }) => {
      electronApp.relaunch = () => {};
      electronApp.exit = () => {};
    });

    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, migratedStorage);

    await win.getByRole('button', { name: '系统设置' }).click();
    const storageSection = win.locator('section').filter({ hasText: '网盘文件目录' }).first();
    await storageSection.getByRole('button', { name: '更改目录' }).click();
    await win.getByText('迁移数据（推荐）').click();
    await win.screenshot({ path: path.join(ARTIFACTS, 'electron-directory-dialog.png') });
    await win.getByRole('button', { name: '确认并重启' }).click();
    try {
      await win.getByText(/目录配置已更新/).waitFor({ timeout: 5_000 });
    } catch (error) {
      const dialogText = await win
        .getByRole('dialog')
        .textContent()
        .catch(() => '(no dialog)');
      await win.screenshot({ path: path.join(ARTIFACTS, 'electron-directory-error.png') });
      console.error('DIALOG:', dialogText);
      throw error;
    }
    await win.waitForTimeout(1_200);

    const pathsAfterStorage = JSON.parse(readFileSync(pathsFile, 'utf8')) as {
      dataDir: string;
      storageDir: string;
      pluginsDir: string;
    };
    assert.equal(pathsAfterStorage.dataDir, dataDir);
    assert.equal(pathsAfterStorage.storageDir, migratedStorage);
    assert.equal(pathsAfterStorage.pluginsDir, initialPlugins);
    assert.equal(
      readFileSync(path.join(migratedStorage, 'marker.txt'), 'utf8'),
      'directory-migration-marker',
    );
    console.log('1. 网盘文件目录迁移数据成功，路径配置已更新');

    await firstApp.app.close().catch(() => {});
    firstApp = null;

    secondApp = await launch(path.join(root, 'profile-2'), pathsFile);
    await setupOrLogin(secondApp.win);

    await secondApp.app.evaluate(({ app: electronApp }) => {
      electronApp.relaunch = () => {};
      electronApp.exit = () => {};
    });
    await secondApp.app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, newDataDir);

    await secondApp.win.getByRole('button', { name: '系统设置' }).click();
    const dataSection = secondApp.win
      .locator('section')
      .filter({ hasText: '系统数据目录' })
      .first();
    await dataSection.getByRole('button', { name: '更改目录' }).click();
    await secondApp.win.getByText('仅改路径（不迁移数据）').click();
    await secondApp.win.getByRole('button', { name: '确认并重启' }).click();
    await secondApp.win.getByText(/目录配置已更新/).waitFor({ timeout: 15_000 });
    await secondApp.win.waitForTimeout(1_200);

    const pathsAfterData = JSON.parse(readFileSync(pathsFile, 'utf8')) as {
      dataDir: string;
      storageDir: string;
      pluginsDir: string;
    };
    assert.equal(pathsAfterData.dataDir, newDataDir);
    assert.equal(pathsAfterData.storageDir, migratedStorage);
    assert.equal(pathsAfterData.pluginsDir, initialPlugins);
    assert.ok(
      !existsSync(path.join(newDataDir, 'cloudbox.db')),
      '“仅改路径”不应把数据库复制到新目录',
    );
    console.log('2. 系统数据目录“仅改路径”成功，未复制数据库');

    await secondApp.win.screenshot({ path: path.join(ARTIFACTS, 'electron-directory-settings.png') });
    await secondApp.app.close().catch(() => {});
    secondApp = null;

    thirdApp = await launch(path.join(root, 'profile-3'), pathsFile);
    await setupOrLogin(thirdApp.win);
    await thirdApp.app.evaluate(({ app: electronApp }) => {
      electronApp.relaunch = () => {};
      electronApp.exit = () => {};
    });
    await thirdApp.app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, migratedPlugins);
    await thirdApp.win.getByRole('button', { name: '系统设置' }).click();
    const pluginSection = thirdApp.win.locator('section').filter({ hasText: '插件目录' }).first();
    await pluginSection.getByRole('button', { name: '更改目录' }).click();
    await thirdApp.win.getByText('迁移数据（推荐）').click();
    await thirdApp.win.getByRole('button', { name: '确认并重启' }).click();
    await thirdApp.win.getByText(/目录配置已更新/).waitFor({ timeout: 15_000 });
    await thirdApp.win.waitForTimeout(1_200);

    const pathsAfterPlugins = JSON.parse(readFileSync(pathsFile, 'utf8')) as {
      dataDir: string;
      storageDir: string;
      pluginsDir: string;
    };
    assert.equal(pathsAfterPlugins.pluginsDir, migratedPlugins);
    assert.equal(pathsAfterPlugins.storageDir, migratedStorage);
    assert.equal(
      readFileSync(path.join(migratedPlugins, 'plugin-marker.txt'), 'utf8'),
      'plugin-migration-marker',
    );
    console.log('3. 插件目录迁移数据成功，路径配置已更新');
    console.log('\n✔ 目录迁移 E2E 全部通过');
  } finally {
    await firstApp?.app.close().catch(() => {});
    await secondApp?.app.close().catch(() => {});
    await thirdApp?.app.close().catch(() => {});
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error: unknown) => {
  console.error('\n✖ 目录迁移 E2E 失败：', error);
  process.exitCode = 1;
});
