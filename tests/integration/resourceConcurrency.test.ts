import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestServer } from '../helpers/testServer.ts';
import { ConcurrencyGate } from '../../src/server/concurrency.ts';

describe('resource concurrency', () => {
  it('信号量限制 5 个任务最多同时执行 2 个，其余排队', async () => {
    const gate = new ConcurrencyGate();
    let active = 0;
    let peak = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 5 }, () => gate.run(2, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      completed += 1;
    })));
    assert.equal(peak, 2);
    assert.equal(completed, 5);
  });

  it('等待超时返回 concurrency_timeout', async () => {
    const gate = new ConcurrencyGate();
    let release!: () => void;
    const first = gate.run(1, () => new Promise<void>((resolve) => { release = resolve; }));
    await assert.rejects(gate.run(1, async () => {}, 20), /concurrency_timeout/);
    release();
    await first;
  });

  it('10 个 PDF 预览在重度并发为 1 时返回 429，普通图片全部成功', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('maxConcurrentHeavyPreviews', 1, null);
      server.services.settings.set('maxConcurrentPreviewsPerUser', 20, null);
      const original = server.services.files.openPreview.bind(server.services.files);
      Object.assign(server.services.files, {
        openPreview: async (...args: Parameters<typeof original>) => {
          await new Promise((resolve) => setTimeout(resolve, String(args[1]).toLowerCase().endsWith('.pdf') ? 4_000 : 20));
          return original(...args);
        },
      });

      const pdfUpload = await server.client.upload('sample.pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'));
      assert.equal(pdfUpload.status, 201);
      const pdfBody = await pdfUpload.json() as { file?: { path?: string } };
      const pdfPath = pdfBody.file?.path;
      assert.ok(pdfPath);
      const pdfResults = await Promise.all(Array.from({ length: 10 }, () => server.client.request(`/api/files/preview/content?path=${encodeURIComponent(pdfPath)}`)));
      assert.equal(pdfResults.filter((response) => response.status === 200).length, 1);
      assert.equal(pdfResults.filter((response) => response.status === 429).length, 9);

      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=', 'base64');
      const imageUpload = await server.client.upload('sample.png', png);
      assert.equal(imageUpload.status, 201);
      const imageBody = await imageUpload.json() as { file?: { path?: string } };
      const imagePath = imageBody.file?.path;
      assert.ok(imagePath);
      const imageResults = await Promise.all(Array.from({ length: 10 }, () => server.client.request(`/api/files/preview/content?path=${encodeURIComponent(imagePath)}`)));
      assert.equal(imageResults.every((response) => response.status === 200), true);
    } finally {
      await server.close();
    }
  });
});
