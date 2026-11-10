'use strict';

module.exports = async function activate(ctx) {
  const router = ctx.createRouter();

  router.get('/preview', async (req) => {
    const path = typeof req.query?.path === 'string' ? req.query.path : '';
    if (!path) {
      return { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<h1>缺少 path</h1>' };
    }
    if (typeof req.fileContent !== 'string') {
      return { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<h1>文件内容不可用</h1>' };
    }

    let data;
    try {
      data = JSON.parse(req.fileContent);
    } catch (error) {
      return {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: `<h1>JSON 解析失败</h1><pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>`,
      };
    }

    const serialized = JSON.stringify(data)
      .replaceAll('<', '\\u003c')
      .replaceAll('>', '\\u003e')
      .replaceAll('&', '\\u0026');
    const title = escapeHtml(path);
    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
      body: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - JSON Explorer</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #0b1120; color: #cbd5e1; font: 13px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
  header { position: sticky; top: 0; z-index: 1; padding: 12px 16px; background: rgba(15,23,42,.94); border-bottom: 1px solid #1e293b; color: #e2e8f0; }
  header strong { color: #7dd3fc; }
  main { padding: 16px 20px 40px; }
  .node { padding-left: 18px; border-left: 1px solid #1e293b; }
  .root { border-left: 0; padding-left: 0; }
  .row { display: flex; align-items: baseline; gap: 7px; border-radius: 4px; padding: 1px 4px; }
  .row:hover { background: #172033; }
  .toggle { width: 14px; color: #94a3b8; cursor: pointer; user-select: none; }
  .key { color: #7dd3fc; cursor: pointer; }
  .key:hover { text-decoration: underline; }
  .string { color: #86efac; word-break: break-all; }
  .number { color: #fdba74; }
  .boolean { color: #c4b5fd; }
  .null { color: #94a3b8; font-style: italic; }
  .punctuation { color: #64748b; }
  .children.hidden { display: none; }
  .empty { color: #64748b; }
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; }
    body { background: #f8fafc; color: #334155; }
    header { background: rgba(255,255,255,.94); border-color: #e2e8f0; color: #0f172a; }
    header strong { color: #0369a1; }
    .node { border-color: #e2e8f0; }
    .row:hover { background: #e2e8f0; }
    .key { color: #0369a1; }
    .string { color: #15803d; }
    .number { color: #c2410c; }
    .boolean { color: #6d28d9; }
  }
</style>
</head>
<body>
<header>JSON Explorer · <strong>${title}</strong></header>
<main><div id="tree" class="root"></div></main>
<script id="json-data" type="application/json">${serialized}</script>
<script>
(() => {
  const tree = document.getElementById('tree');
  const data = JSON.parse(document.getElementById('json-data').textContent);

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function typeName(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function valueSpan(value) {
    const span = document.createElement('span');
    const type = typeName(value);
    span.className = type;
    if (type === 'string') span.textContent = '"' + String(value) + '"';
    else if (type === 'null') span.textContent = 'null';
    else span.textContent = String(value);
    return span;
  }

  function node(value, key, depth) {
    const type = typeName(value);
    const child = document.createElement('div');
    child.className = 'node' + (depth === 0 ? ' root' : '');
    const row = document.createElement('div');
    row.className = 'row';

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    row.appendChild(toggle);

    if (key !== undefined) {
      const keySpan = document.createElement('span');
      keySpan.className = 'key';
      keySpan.textContent = Array.isArray(value) ? '[' + key + ']' : '"' + String(key) + '"';
      row.appendChild(keySpan);
      const colon = document.createElement('span');
      colon.className = 'punctuation';
      colon.textContent = ':';
      row.appendChild(colon);
    }

    const isContainer = type === 'object' || type === 'array';
    if (!isContainer) {
      row.appendChild(valueSpan(value));
      child.appendChild(row);
      return child;
    }

    const open = type === 'array' ? '[' : '{';
    const close = type === 'array' ? ']' : '}';
    row.appendChild(Object.assign(document.createElement('span'), { className: 'punctuation', textContent: open }));
    const summary = document.createElement('span');
    summary.className = 'empty';
    summary.textContent = Array.isArray(value)
      ? value.length + ' 项'
      : Object.keys(value).length + ' 个字段';
    row.appendChild(summary);
    child.appendChild(row);

    const children = document.createElement('div');
    children.className = 'children';
    const entries = Array.isArray(value)
      ? value.map((item, index) => [index, item])
      : Object.entries(value);
    for (const [entryKey, entryValue] of entries) {
      children.appendChild(node(entryValue, entryKey, depth + 1));
    }
    child.appendChild(children);

    const closeSpan = document.createElement('span');
    closeSpan.className = 'punctuation';
    closeSpan.textContent = close;
    child.appendChild(closeSpan);

    toggle.textContent = '▾';
    const toggleNode = () => {
      const hidden = children.classList.toggle('hidden');
      toggle.textContent = hidden ? '▸' : '▾';
    };
    toggle.addEventListener('click', toggleNode);
    const keySpan = row.querySelector('.key');
    if (keySpan) keySpan.addEventListener('click', toggleNode);
    return child;
  }

  tree.appendChild(node(data, undefined, 0));
})();
</script>
</body>
</html>`,
    };
  });

  ctx.registerRouter('', router);
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}
