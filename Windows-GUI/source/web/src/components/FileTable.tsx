import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileEntry } from '../api/client.ts';
import {
  fileExtension,
  formatBytes,
  formatDate,
  isArchiveName,
  isImageName,
  isPdfName,
  isVideoName,
} from '../lib/format.ts';
import {
  AlertIcon,
  ArchiveIcon,
  DownloadIcon,
  ExcelIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  PdfIcon,
  PencilIcon,
  PptIcon,
  ScanIcon,
  ShareIcon,
  TrashIcon,
  TextIcon,
  UploadIcon,
  VideoIcon,
  WordIcon,
} from './Icons.tsx';

interface FileTableProps {
  entries: FileEntry[];
  loading: boolean;
  selected: string[];
  truncated: boolean;
  onNavigate: (path: string) => void;
  onPreview: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onShare: (entry: FileEntry) => void;
  onExtract: (entry: FileEntry) => void;
  onScan: (entry: FileEntry) => void;
  canPreview: (entry: FileEntry) => boolean;
  allowExtract: boolean;
  allowScan: boolean;
  busyPaths: Set<string>;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onToggleSelected: (path: string) => void;
  onSelectAll: (paths: string[]) => void;
}

function EntryIcon({ entry, previewable }: { entry: FileEntry; previewable: boolean }) {
  if (entry.type === 'dir') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-500 dark:bg-amber-950/30 dark:text-amber-400">
        <FolderIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  if (isImageName(entry.name)) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-500 dark:bg-sky-950/30 dark:text-sky-400">
        <ImageIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  if (isPdfName(entry.name)) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500 dark:bg-rose-950/30 dark:text-rose-400">
        <PdfIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  const extension = fileExtension(entry.name);
  if (extension === 'docx') {
    return (
      <span title={previewable ? '可在线预览' : undefined} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
        <WordIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  if (extension === 'xlsx') {
    return (
      <span title={previewable ? '可在线预览' : undefined} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
        <ExcelIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  if (extension === 'pptx') {
    return (
      <span title={previewable ? '可在线预览' : undefined} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400">
        <PptIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  if (extension === 'txt') {
    return (
      <span title={previewable ? '可在线预览' : undefined} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <TextIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  if (isVideoName(entry.name)) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500 dark:bg-violet-950/30 dark:text-violet-400">
        <VideoIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  if (isArchiveName(entry.name)) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
        <ArchiveIcon className="h-4.5 w-4.5" />
      </span>
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
      <FileIcon className="h-4.5 w-4.5" />
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-slate-50 dark:divide-slate-800/70">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <div className="h-4 w-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

export function FileTable({
  entries,
  loading,
  selected,
  truncated,
  onNavigate,
  onPreview,
  onDownload,
  onShare,
  onExtract,
  onScan,
  canPreview,
  allowExtract,
  allowScan,
  busyPaths,
  onRename,
  onDelete,
  onToggleSelected,
  onSelectAll,
}: FileTableProps) {
  const { t } = useTranslation();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = entries.length > 0 && entries.every((entry) => selected.includes(entry.path));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.length > 0 && !allSelected;
    }
  }, [selected, allSelected]);

  if (loading && entries.length === 0) {
    return <SkeletonRows />;
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          <UploadIcon className="h-6 w-6" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('files.empty')}
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {t('files.emptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="hidden grid-cols-[2rem_1fr_7rem_10rem_11rem] items-center gap-3 border-b border-slate-100 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500 sm:grid">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allSelected}
          onChange={() => onSelectAll(allSelected ? [] : entries.map((entry) => entry.path))}
          aria-label="全选当前目录"
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:focus:ring-indigo-400"
        />
        <span>{t('files.name')}</span>
        <span className="text-right">{t('files.size')}</span>
        <span className="text-right">{t('files.modified')}</span>
        <span className="text-right">{t('files.actions')}</span>
      </div>

      <ul className="divide-y divide-slate-50 dark:divide-slate-800/70">
        {entries.map((entry) => {
          const checked = selected.includes(entry.path);

          return (
            <li
              key={entry.path}
              className={`grid grid-cols-[2rem_1fr_auto] items-center gap-2 px-4 py-2.5 transition sm:grid-cols-[2rem_1fr_7rem_10rem_11rem] sm:gap-3 ${
                checked
                  ? 'bg-indigo-50/40 dark:bg-indigo-950/30'
                  : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleSelected(entry.path)}
                aria-label={`选择 ${entry.name}`}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:focus:ring-indigo-400"
              />

              <div className="flex min-w-0 items-center gap-2.5">
                <EntryIcon entry={entry} previewable={canPreview(entry)} />
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      entry.type === 'dir'
                        ? onNavigate(entry.path)
                        : canPreview(entry)
                          ? onPreview(entry)
                          : onDownload(entry)
                    }
                    className="block max-w-full truncate text-left text-sm font-medium text-slate-800 transition hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                    title={entry.name}
                  >
                    {entry.name}
                  </button>
                  <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500 sm:hidden">
                    {entry.type === 'dir' ? '文件夹' : formatBytes(entry.size)}
                    {' · '}
                    {formatDate(entry.modifiedAt)}
                    {entry.type === 'file' && fileExtension(entry.name)
                      ? ` · ${fileExtension(entry.name).toUpperCase()}`
                      : ''}
                  </p>
                </div>
              </div>

              <span className="hidden text-right text-xs tabular-nums text-slate-500 dark:text-slate-400 sm:block">
                {entry.type === 'dir' ? '—' : formatBytes(entry.size)}
              </span>

              <span className="hidden text-right text-xs text-slate-500 dark:text-slate-400 sm:block">
                {formatDate(entry.modifiedAt)}
              </span>

              <div className="flex items-center justify-end gap-0.5">
                {entry.type === 'file' && allowExtract && isArchiveName(entry.name) ? (
                  <button
                    type="button"
                    onClick={() => onExtract(entry)}
                    disabled={busyPaths.has(entry.path)}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
                    aria-label={`解压 ${entry.name}`}
                    title="解压到当前目录"
                  >
                    <ArchiveIcon className="h-4 w-4" />
                  </button>
                ) : null}
                {entry.type === 'file' && allowScan ? (
                  <button
                    type="button"
                    onClick={() => onScan(entry)}
                    disabled={busyPaths.has(entry.path)}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
                    aria-label={`查杀 ${entry.name}`}
                    title="安全查杀"
                  >
                    <ScanIcon className="h-4 w-4" />
                  </button>
                ) : null}
                {entry.type === 'file' ? (
                  <button
                    type="button"
                    onClick={() => onShare(entry)}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300"
                    aria-label={`分享 ${entry.name}`}
                    title={t('common.share')}
                  >
                    <ShareIcon className="h-4 w-4" />
                  </button>
                ) : null}
                {entry.type === 'file' ? (
                  <button
                    type="button"
                    onClick={() => onDownload(entry)}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label={`下载 ${entry.name}`}
                    title={t('common.download')}
                  >
                    <DownloadIcon className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRename(entry)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label={`重命名 ${entry.name}`}
                  title={t('common.rename')}
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(entry)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  aria-label={`删除 ${entry.name}`}
                  title={t('common.delete')}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {truncated ? (
        <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          当前目录文件过多，仅显示前 5000 项，请使用子目录整理。
        </div>
      ) : null}
    </div>
  );
}
