import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAttachmentDisposition } from '../../src/server/http/contentDisposition.ts';
import { parseRangeHeader } from '../../src/server/http/range.ts';

describe('parseRangeHeader', () => {
  it('无 Range 头返回 none', () => {
    assert.deepEqual(parseRangeHeader(undefined, 10), { type: 'none' });
    assert.deepEqual(parseRangeHeader('', 10), { type: 'none' });
  });

  it('支持 start-end / start- / -suffix', () => {
    assert.deepEqual(parseRangeHeader('bytes=2-5', 10), {
      type: 'range',
      range: { start: 2, end: 5 },
    });
    assert.deepEqual(parseRangeHeader('bytes=5-', 10), {
      type: 'range',
      range: { start: 5, end: 9 },
    });
    assert.deepEqual(parseRangeHeader('bytes=-3', 10), {
      type: 'range',
      range: { start: 7, end: 9 },
    });
  });

  it('end 超出文件大小时自动截断', () => {
    assert.deepEqual(parseRangeHeader('bytes=0-99', 10), {
      type: 'range',
      range: { start: 0, end: 9 },
    });
  });

  it('拒绝越界、倒序、多段与非法单位', () => {
    for (const header of [
      'bytes=10-',
      'bytes=5-4',
      'bytes=0-1,3-4',
      'bytes=abc',
      'items=0-1',
      'bytes=-0',
      'bytes=-',
    ]) {
      assert.deepEqual(parseRangeHeader(header, 10), { type: 'invalid' }, header);
    }
  });

  it('空文件上的 Range 一律 invalid', () => {
    assert.deepEqual(parseRangeHeader('bytes=0-0', 0), { type: 'invalid' });
  });
});

describe('buildAttachmentDisposition', () => {
  it('ASCII 文件名同时给出 fallback 与 filename*', () => {
    const header = buildAttachmentDisposition('report.pdf');
    assert.equal(header, `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  });

  it('中文文件名按 RFC 5987 编码，fallback 只保留 ASCII', () => {
    const header = buildAttachmentDisposition('测试 文档.txt');
    assert.match(header, /^attachment; filename="[^"]*\.txt"/);
    assert.ok(header.includes("filename*=UTF-8''"));
    assert.ok(header.includes(encodeURIComponent('测试 文档.txt')));
  });

  it('引号与反斜杠不会破坏响应头', () => {
    const header = buildAttachmentDisposition('a"b\\c.txt');
    assert.ok(header.includes('filename="a_b_c.txt"'));
    assert.ok(header.includes('filename*=UTF-8'));
  });
});
