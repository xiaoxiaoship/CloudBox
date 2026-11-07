import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

describe('audio preview', () => {
  let t: TestServer | null = null;

  afterEach(async () => {
    await t?.close();
    t = null;
  });

  it('MP3 识别、Content-Type 与 Range 206', async () => {
    t = await createTestServer();
    const mp3 = Buffer.concat([
      Buffer.from('ID3', 'latin1'),
      Buffer.alloc(128, 0),
      Buffer.from([0xff, 0xfb, 0x90, 0x64]),
      Buffer.alloc(512, 0),
    ]);
    await t.client.upload('song.mp3', mp3);

    const info = await t.client.request('/api/files/preview/info?path=song.mp3');
    const body = (await info.json()) as { kind: string; mime: string };
    assert.equal(body.kind, 'audio');
    assert.equal(body.mime, 'audio/mpeg');

    const range = await t.client.request('/api/files/preview/content?path=song.mp3', {
      headers: { Range: 'bytes=0-99' },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-type'), 'audio/mpeg');
    assert.equal(range.headers.get('accept-ranges'), 'bytes');
    assert.match(range.headers.get('content-range') ?? '', /^bytes 0-99\//);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
  });
});
