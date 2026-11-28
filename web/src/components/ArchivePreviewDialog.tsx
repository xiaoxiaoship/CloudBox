import { useEffect, useState } from 'react';
import { api, type FileEntry } from '../api/client.ts';
import { DialogShell } from './Dialog.tsx';
import { formatBytes } from '../lib/format.ts';

interface ArchiveRow { path: string; size: number; isDirectory: boolean }

export function ArchivePreviewDialog({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const [rows, setRows] = useState<ArchiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.archiveEntries(entry.path)
      .then((value) => { if (active) setRows(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '无法读取压缩包'); });
    return () => { active = false; };
  }, [entry.path]);

  return (
    <DialogShell
      title={`预览 ${entry.name}`}
      description="仅读取压缩包目录，不解压到磁盘。"
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">关闭</button>}
    >
      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      {!rows && !error ? <p className="text-sm text-slate-500">读取中…</p> : null}
      {rows ? (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-auto text-xs dark:divide-slate-800">
          {rows.map((row) => (
            <li key={row.path} className="flex items-center justify-between gap-2 py-1.5">
              <span className="truncate">{row.path}</span>
              <span className="shrink-0 text-slate-400">{row.isDirectory ? '目录' : formatBytes(row.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </DialogShell>
  );
}
