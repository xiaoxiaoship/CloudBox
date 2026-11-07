export interface ByteRange {
  start: number;
  end: number;
}

export type RangeParseResult =
  | { type: 'none' }
  | { type: 'range'; range: ByteRange }
  | { type: 'invalid' };

/**
 * 解析单段 Range 头（仅支持 `bytes=` 的 start-end / start- / -suffix）。
 * 多段 Range 返回 invalid，由调用方回复 416（避免实现 multipart/byteranges 的复杂度）。
 */
export function parseRangeHeader(header: string | undefined, size: number): RangeParseResult {
  if (!header) return { type: 'none' };
  if (size <= 0) return { type: 'invalid' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { type: 'invalid' };

  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (startRaw === '' && endRaw === '') return { type: 'invalid' };

  let start: number;
  let end: number;

  if (startRaw === '') {
    // bytes=-N：最后 N 个字节
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { type: 'invalid' };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startRaw);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return { type: 'invalid' };

    if (endRaw === '') {
      end = size - 1;
    } else {
      end = Number(endRaw);
      if (!Number.isSafeInteger(end) || end < start) return { type: 'invalid' };
      end = Math.min(end, size - 1);
    }
  }

  return { type: 'range', range: { start, end } };
}
