import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import iconv from 'iconv-lite';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('preview API', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await createTestServer();
  });

  afterEach(async () => {
    await t.close();
  });

  it('PNG：魔数 + 扩展名匹配时以 image/png 内联流式返回', async () => {
    await t.client.upload('pixel.png', PNG_1X1);

    const info = await t.client.request('/api/files/preview/info?path=pixel.png');
    assert.equal(info.status, 200);
    const infoBody = await readJson<{ kind: string; mime: string }>(info);
    assert.equal(infoBody.kind, 'image');
    assert.equal(infoBody.mime, 'image/png');

    const content = await t.client.request('/api/files/preview/content?path=pixel.png');
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), 'image/png');
    assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
    assert.match(content.headers.get('content-disposition') ?? '', /^inline;/);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), PNG_1X1);
  });

  it('伪装成 PNG 的文本：魔数不匹配，拒绝预览', async () => {
    await t.client.upload('fake.png', Buffer.from('not really a png'));

    const info = await t.client.request('/api/files/preview/info?path=fake.png');
    assert.equal(info.status, 200);
    assert.equal((await readJson<{ kind: string }>(info)).kind, 'none');

    const content = await t.client.request('/api/files/preview/content?path=fake.png');
    assert.equal(content.status, 415);
    assert.equal((await readJson<{ code: string }>(content)).code, 'PREVIEW_UNSUPPORTED');
  });

  it('HTML 与 SVG 强制下载，不进入文本/图片预览', async () => {
    await t.client.upload('page.html', Buffer.from('<script>alert(1)</script>'));
    await t.client.upload('icon.svg', Buffer.from('<svg onload="alert(1)"></svg>'));

    for (const file of ['page.html', 'icon.svg']) {
      const info = await t.client.request(`/api/files/preview/info?path=${file}`);
      assert.equal((await readJson<{ kind: string }>(info)).kind, 'none', file);

      const content = await t.client.request(`/api/files/preview/content?path=${file}`);
      assert.equal(content.status, 415, file);
      assert.notEqual(content.headers.get('content-type'), 'text/html');
    }
  });

  it('文本以 JSON 返回，HTML 标签保持字面量，前端只需 <pre> 渲染', async () => {
    const raw = '<script>alert(1)</script>\n中文内容';
    await t.client.upload('note.txt', Buffer.from(raw, 'utf8'));

    const content = await t.client.request('/api/files/preview/content?path=note.txt');
    assert.equal(content.status, 200);
    assert.match(content.headers.get('content-type') ?? '', /^application\/json/);

    const body = await readJson<{ kind: string; text: string; truncated: boolean }>(content);
    assert.equal(body.kind, 'text');
    assert.equal(body.text, raw);
    assert.equal(body.truncated, false);
  });

  it('GBK 文本自动识别编码并转 UTF-8', async () => {
    const gbkText = '这是一个用于测试编码识别的较长中文句子，包含标点符号。';
    await t.client.upload('gbk.txt', iconv.encode(gbkText, 'gbk'));

    const content = await t.client.request('/api/files/preview/content?path=gbk.txt');
    const body = await readJson<{ text: string; encoding: string }>(content);
    assert.equal(body.text, gbkText);
    assert.ok(body.encoding.length > 0);
  });

  it('大文本截断到 512KB 并标记 truncated', async () => {
    await t.client.upload('big.txt', Buffer.alloc(600 * 1024, 0x61));

    const content = await t.client.request('/api/files/preview/content?path=big.txt');
    const body = await readJson<{ text: string; truncated: boolean; size: number }>(content);
    assert.equal(body.truncated, true);
    assert.equal(body.size, 600 * 1024);
    assert.equal(body.text.length, 512 * 1024);
  });

  it('PDF 以 application/pdf + inline + CSP sandbox 返回', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    await t.client.upload('doc.pdf', pdf);

    const info = await t.client.request('/api/files/preview/info?path=doc.pdf');
    assert.equal((await readJson<{ kind: string }>(info)).kind, 'pdf');

    const content = await t.client.request('/api/files/preview/content?path=doc.pdf');
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), 'application/pdf');
    assert.match(content.headers.get('content-disposition') ?? '', /^inline;/);
    assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
    assert.match(content.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), pdf);
  });

  it('MP4 视频预览：video/mp4 + inline + Range 206', async () => {
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftyp', 'latin1'),
      Buffer.from('mp42', 'latin1'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('mp42isom', 'latin1'),
      Buffer.alloc(16, 0),
    ]);
    await t.client.upload('clip.mp4', mp4);

    const info = await t.client.request('/api/files/preview/info?path=clip.mp4');
    assert.equal(info.status, 200);
    const body = await readJson<{ kind: string; mime: string }>(info);
    assert.equal(body.kind, 'video');
    assert.equal(body.mime, 'video/mp4');

    const content = await t.client.request('/api/files/preview/content?path=clip.mp4', {
      headers: { range: 'bytes=0-7' },
    });
    assert.equal(content.status, 206);
    assert.equal(content.headers.get('content-type'), 'video/mp4');
    assert.equal(content.headers.get('accept-ranges'), 'bytes');
    assert.equal(content.headers.get('content-range'), `bytes 0-7/${mp4.length}`);
    assert.match(content.headers.get('content-disposition') ?? '', /^inline;/);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), mp4.subarray(0, 8));
  });

  it('WebM / Ogg 视频白名单识别', async () => {
    const webm = Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01,
      0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65,
      0x62, 0x6d,
    ]);
    const ogg = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(24, 0)]);
    await t.client.upload('clip.webm', webm);
    await t.client.upload('clip.ogg', ogg);

    for (const [file, mime] of [
      ['clip.webm', 'video/webm'],
      ['clip.ogg', 'video/ogg'],
    ] as const) {
      const info = await t.client.request(`/api/files/preview/info?path=${file}`);
      const body = await readJson<{ kind: string; mime: string }>(info);
      assert.equal(body.kind, 'video', file);
      assert.equal(body.mime, mime, file);

      const content = await t.client.request(`/api/files/preview/content?path=${file}`);
      assert.equal(content.status, 200, file);
      assert.equal(content.headers.get('content-type'), mime, file);
    }
  });

  it('伪装成 MP4 的文本不会被内联为视频', async () => {
    await t.client.upload('fake.mp4', Buffer.from('this is not a video'));

    const info = await t.client.request('/api/files/preview/info?path=fake.mp4');
    assert.equal((await readJson<{ kind: string }>(info)).kind, 'none');

    const content = await t.client.request('/api/files/preview/content?path=fake.mp4');
    assert.equal(content.status, 415);
  });

  it('预览路径穿越被拦截并写 denied 审计', async () => {
    const info = await t.client.request(
      `/api/files/preview/info?path=${encodeURIComponent('../secret.txt')}`,
    );
    assert.equal(info.status, 400);

    const content = await t.client.request(
      `/api/files/preview/content?path=${encodeURIComponent('../secret.txt')}`,
    );
    assert.equal(content.status, 400);

    const denied = t.services.audit
      .list({ limit: 20 })
      .filter((entry) => entry.action === 'file.preview' && entry.result === 'denied');
    assert.equal(denied.length, 2);
  });
});
