#!/usr/bin/env node
/**
 * 真实浏览器 E2E（Playwright Core + 本机 Edge，不下载 Chromium）。
 *
 * 前置条件：
 *   1. 后端：npm run dev:server  （http://127.0.0.1:8686）
 *   2. 前端：npm run dev:web     （http://localhost:5173，或使用生产构建 8686）
 *
 * 运行：npm run e2e:web
 * 可用环境变量覆盖：WEB_URL / EDGE_PATH / E2E_USERNAME / E2E_PASSWORD
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, type Page } from 'playwright-core';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USERNAME = process.env.E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Passw0rd!';

const ARTIFACTS = path.resolve('artifacts');
mkdirSync(ARTIFACTS, { recursive: true });
const shot = (name: string): string => path.join(ARTIFACTS, name);

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const checksum = crc32(Buffer.concat([typeBuffer, data])) >>> 0;
  const result = Buffer.alloc(8 + data.length + 4);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(checksum, 8 + data.length);
  return result;
}

/** 生成 96×96 渐变 PNG，用于验证图片预览确实由浏览器解码显示 */
function buildPng(width = 96, height = 96): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // truecolor RGB

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      raw[offset] = Math.round(79 + (x / width) * 120);
      raw[offset + 1] = Math.round(70 + (y / height) * 120);
      raw[offset + 2] = 229;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 生成结构合法的最小 PDF（含正确 xref 偏移），用于验证 pdfjs 真机渲染 */
function buildPdf(): Buffer {
  const stream = 'BT /F1 18 Tf 40 100 Td (Hello CloudBox) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function watchPage(page: Page): void {
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('[browser console]', message.text());
  });
}

async function setTheme(page: Page, label: '浅色' | '深色' | '跟随系统'): Promise<void> {
  await page.getByLabel(label).click();
  if (label === '深色') await page.locator('html.dark').waitFor();
  if (label === '浅色') await page.locator('html:not(.dark)').waitFor();
  // 主题色有 150ms transition，等待过渡结束再截图/断言
  await page.waitForTimeout(300);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    acceptDownloads: true,
  });

  const page = await context.newPage();
  watchPage(page);
  const folderName = `e2e-测试-${Date.now().toString(36)}`;

  try {
    console.log(`1. 打开 ${WEB_URL}`);
    await page.goto(WEB_URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '登录', exact: true }).waitFor();
    await page.screenshot({ path: shot('e2e-login.png') });

    console.log('2. 深色登录页 + localStorage 持久化');
    await setTheme(page, '深色');
    const storedTheme = await page.evaluate('localStorage.getItem("cloudbox-theme")');
    assert.equal(storedTheme, 'dark', '主题偏好未写入 localStorage');
    await page.screenshot({ path: shot('e2e-dark-login.png') });

    // 刷新后应由 theme-init.js 在首屏前恢复深色，而不是闪一下浅色再切换
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('html.dark').waitFor();
    await page.getByRole('button', { name: '登录', exact: true }).waitFor();
    await setTheme(page, '浅色');

    console.log('3. 登录');
    await page.getByLabel('用户名', { exact: true }).fill(USERNAME);
    await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '我的文件' }).waitFor();

    console.log('4. 新建文件夹并进入');
    await page.getByRole('button', { name: '新建文件夹' }).click();
    await page.locator('#prompt-dialog-input').fill(folderName);
    await page.getByRole('button', { name: '创建' }).click();
    await page.getByRole('button', { name: folderName, exact: true }).click();
    await page
      .getByRole('navigation', { name: '路径导航' })
      .getByRole('button', { name: folderName })
      .waitFor();

    console.log('5. 上传文本并验证安全文本预览');
    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('你好 CloudBox\n<script>alert(1)</script>\n', 'utf8'),
    });
    await page.getByRole('button', { name: 'note.txt', exact: true }).waitFor();
    await page.getByRole('button', { name: 'note.txt', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: '预览 note.txt' });
    await dialog.waitFor();
    const previewText = await dialog.locator('pre').innerText();
    assert.ok(previewText.includes('你好 CloudBox'), '文本预览缺少中文内容');
    assert.ok(
      previewText.includes('<script>alert(1)</script>'),
      'HTML 标签应以字面量显示，而不是被解析',
    );
    await page.screenshot({ path: shot('e2e-preview-text.png') });
    await page.getByLabel('关闭预览').click();

    console.log('6. 上传图片并验证白名单图片预览');
    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'gradient.png',
      mimeType: 'image/png',
      buffer: buildPng(),
    });
    await page.getByRole('button', { name: 'gradient.png', exact: true }).waitFor();
    await page.getByRole('button', { name: 'gradient.png', exact: true }).click();

    const imageDialog = page.getByRole('dialog', { name: '预览 gradient.png' });
    await imageDialog.waitFor();
    const image = imageDialog.locator('img');
    await image.waitFor();
    const naturalWidth = await image.evaluate(
      (element) => (element as unknown as { naturalWidth: number }).naturalWidth,
    );
    assert.equal(naturalWidth, 96, '图片未成功解码');
    await page.screenshot({ path: shot('e2e-preview-image.png') });
    await page.getByLabel('关闭预览').click();

    console.log('7. 上传 PDF 并验证 pdfjs Canvas 渲染');
    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      buffer: buildPdf(),
    });
    await page.getByRole('button', { name: 'doc.pdf', exact: true }).waitFor();
    await page.getByRole('button', { name: 'doc.pdf', exact: true }).click();

    const pdfDialog = page.getByRole('dialog', { name: '预览 doc.pdf' });
    await pdfDialog.waitFor();
    await pdfDialog.locator('canvas').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    const canvasWidth = await pdfDialog
      .locator('canvas')
      .evaluate((element) => (element as unknown as { width: number }).width);
    assert.ok(canvasWidth > 0, 'PDF Canvas 未完成渲染');
    await page.screenshot({ path: shot('e2e-preview-pdf.png') });
    await page.getByLabel('关闭预览').click();

    console.log('8. 清理上传面板并截图浅色桌面');
    const clearButton = page.getByRole('button', { name: '清除已完成' });
    if (await clearButton.isVisible().catch(() => false)) {
      await clearButton.click();
    }
    await page.screenshot({ path: shot('e2e-desktop.png'), fullPage: true });

    console.log('9. 深色模式：列表 + 弹窗 + 文本/PDF 预览');
    await setTheme(page, '深色');
    await page.screenshot({ path: shot('e2e-dark-desktop.png'), fullPage: true });

    await page.getByLabel('重命名 note.txt').click();
    await page.getByRole('dialog', { name: '重命名' }).waitFor();
    await page.screenshot({ path: shot('e2e-dark-dialog.png') });
    await page.getByRole('button', { name: '取消' }).click();

    await page.locator('input[type=file]').last().setInputFiles( {
      name: 'dark-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('dark upload panel'),
    });
    await page.getByRole('button', { name: 'dark-upload.txt', exact: true }).waitFor();
    const uploadPanel = page.locator('section[aria-label="上传任务"]');
    await uploadPanel.getByText('完成', { exact: true }).waitFor();
    // 进度条有 200ms 宽度过渡，等动画结束再截图
    await page.waitForTimeout(350);
    await page.screenshot({ path: shot('e2e-dark-upload.png') });
    const clearDarkUploads = page.getByRole('button', { name: '清除已完成' });
    if (await clearDarkUploads.isVisible().catch(() => false)) {
      await clearDarkUploads.click();
    }

    await page.getByRole('button', { name: 'note.txt', exact: true }).click();
    await page.getByRole('dialog', { name: '预览 note.txt' }).locator('pre').waitFor();
    await page.screenshot({ path: shot('e2e-dark-preview-text.png') });
    await page.getByLabel('关闭预览').click();

    await page.getByRole('button', { name: 'doc.pdf', exact: true }).click();
    const darkPdf = page.getByRole('dialog', { name: '预览 doc.pdf' });
    await darkPdf.waitFor();
    await darkPdf.locator('canvas').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot('e2e-dark-preview-pdf.png') });
    await page.getByLabel('关闭预览').click();

    await setTheme(page, '浅色');

    console.log('10. 重命名');
    await page.getByLabel('重命名 note.txt').click();
    await page.locator('#prompt-dialog-input').fill('renamed.txt');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByRole('button', { name: 'renamed.txt', exact: true }).waitFor();

    console.log('11. 删除文件');
    await page.getByLabel('删除 renamed.txt').click();
    await page.getByRole('button', { name: '永久删除' }).click();
    await page
      .getByRole('button', { name: 'renamed.txt', exact: true })
      .waitFor({ state: 'hidden' });

    console.log('12. 跟随系统：监听 prefers-color-scheme 变化');
    await setTheme(page, '跟随系统');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('html.dark').waitFor();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('html:not(.dark)').waitFor();

    console.log('13. 移动端深色截图');
    await setTheme(page, '深色');
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    watchPage(mobile);
    await mobile.goto(WEB_URL, { waitUntil: 'networkidle' });
    await mobile.getByRole('heading', { name: '我的文件' }).waitFor();
    await mobile.screenshot({ path: shot('e2e-dark-mobile.png'), fullPage: true });
    await mobile.close();
    await setTheme(page, '浅色');

    console.log('14. 返回根目录并递归删除测试文件夹');
    await page
      .getByRole('navigation', { name: '路径导航' })
      .getByRole('button', { name: '根目录' })
      .click();
    await page.getByLabel(`删除 ${folderName}`).click();
    await page.getByRole('button', { name: '永久删除' }).click();
    await page
      .getByRole('button', { name: folderName, exact: true })
      .waitFor({ state: 'hidden' });

    console.log('\n✔ E2E 全部通过');
    console.log(`截图目录：${ARTIFACTS}`);
  } catch (error) {
    await page.screenshot({ path: shot('e2e-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('\n✖ E2E 失败：', error);
  process.exitCode = 1;
});
