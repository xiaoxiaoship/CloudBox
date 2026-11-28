import { useEffect, useMemo, useState } from 'react';
import { api, type FileEntry } from '../api/client.ts';
import { ArchiveIcon, FileIcon, FolderIcon, Spinner } from './Icons.tsx';
import { formatBytes } from '../lib/format.ts';

interface Row { path: string; size: number; isDirectory: boolean }

export function ArchiveBrowser({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [innerPath, setInnerPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    void api.archiveEntries(entry.path)
      .then((value) => { if (active) setRows(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '无法读取压缩包'); });
    return () => { active = false; };
  }, [entry.path]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const prefix = innerPath ? `${innerPath}/` : '';
    const dirs = new Set<string>();
    const files: Row[] = [];
    for (const row of rows) {
      if (!row.path.startsWith(prefix)) continue;
      const rest = row.path.slice(prefix.length);
      if (!rest) continue;
      if (rest.includes('/')) dirs.add(rest.split('/')[0]!);
      else files.push(row);
    }
    return [
      ...[...dirs].sort().map((name) => ({ path: name, size: 0, isDirectory: true })),
      ...files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN')),
    ];
  }, [rows, innerPath]);

  const crumbs = innerPath.split('/').filter(Boolean);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">退出压缩包</button>
          <ArchiveIcon className="h-4 w-4 shrink-0 text-amber-500" />
          <button type="button" onClick={() => setInnerPath('')} className="truncate font-medium text-slate-800 hover:text-indigo-600 dark:text-slate-100">{entry.name}</button>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1">
              <span className="text-slate-300">/</span>
              <button type="button" onClick={() => setInnerPath(crumbs.slice(0, index + 1).join('/'))} className="truncate text-slate-500 hover:text-indigo-600">{crumb}</button>
            </span>
          ))}
        </div>
        <span className="text-[11px] text-slate-400">只读目录预览</span>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-500">{error}</p> : null}
      {!rows && !error ? <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Spinner className="h-4 w-4" /> 读取压缩包…</p> : null}
      {rows ? (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {visible.length === 0 ? <li className="py-6 text-center text-xs text-slate-400">此目录为空</li> : null}
          {visible.map((row) => (
            <li key={row.path}>
              <button type="button" onClick={() => { if (row.isDirectory) { const next = innerPath ? `${innerPath}/${row.path}` : row.path; setInnerPath(next); } }} className={`flex w-full items-center gap-3 px-2 py-2.5 text-left text-sm ${row.isDirectory ? 'hover:bg-slate-50 dark:hover:bg-slate-800/60' : 'cursor-default'}`}>
                {row.isDirectory ? <FolderIcon className="h-4 w-4 text-amber-500" /> : <FileIcon className="h-4 w-4 text-slate-400" />}
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{row.path}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{row.isDirectory ? '目录' : formatBytes(row.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
