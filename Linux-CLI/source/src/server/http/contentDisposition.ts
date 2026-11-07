/**
 * 生成 Content-Disposition。
 * 同时提供 ASCII 回退名与 RFC 5987 的 UTF-8 文件名，兼容中文文件名。
 */
export function buildContentDisposition(
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 200);

  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function buildAttachmentDisposition(filename: string): string {
  return buildContentDisposition(filename, 'attachment');
}

export function buildInlineDisposition(filename: string): string {
  return buildContentDisposition(filename, 'inline');
}
