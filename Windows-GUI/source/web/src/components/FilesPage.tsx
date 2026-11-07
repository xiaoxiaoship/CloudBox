import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  downloadUrl,
  type FileEntry,
  type PublicSettings,
  type BackgroundTask,
  type HostingSettings,
  api,
} from '../api/client.ts';
import { useAppStore } from '../store/useAppStore.ts';
import { Breadcrumbs } from './Breadcrumbs.tsx';
import { AiAssistant } from './AiAssistant.tsx';
import { ConfirmDialog, PromptDialog } from './Dialog.tsx';
import { FileTable } from './FileTable.tsx';
import { Header } from './Header.tsx';
import {
  AlertIcon,
  DownloadIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  ShareIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from './Icons.tsx';
import { isAudioName, isImageName, isPdfName, isVideoName } from '../lib/format.ts';
import { PreviewModal } from './PreviewModal.tsx';
import { QuotaBar } from './QuotaBar.tsx';
import { ShareDialog } from './ShareDialog.tsx';
import { UploadPanel } from './UploadPanel.tsx';

type DialogState =
  | { kind: 'folder' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'delete'; entries: FileEntry[] }
  | { kind: 'share'; entry: FileEntry }
  | null;

const PRIMARY_BUTTON =
  'inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BUTTON =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';
const DANGER_BUTTON =
  'inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40';

export function FilesPage() {
  const { t } = useTranslation();
  const user = useAppStore((state) => state.user);
  const usage = useAppStore((state) => state.usage);
  const entries = useAppStore((state) => state.entries);
  const currentPath = useAppStore((state) => state.currentPath);
  const selected = useAppStore((state) => state.selected);
  const listingLoading = useAppStore((state) => state.listingLoading);
  const truncated = useAppStore((state) => state.truncated);
  const error = useAppStore((state) => state.error);

  const navigate = useAppStore((state) => state.navigate);
  const refresh = useAppStore((state) => state.refresh);
  const createFolder = useAppStore((state) => state.createFolder);
  const rename = useAppStore((state) => state.rename);
  const remove = useAppStore((state) => state.remove);
  const playAudio = useAppStore((state) => state.playAudio);
  const uploadFiles = useAppStore((state) => state.uploadFiles);
  const toggleSelected = useAppStore((state) => state.toggleSelected);
  const setSelected = useAppStore((state) => state.setSelected);
  const dismissError = useAppStore((state) => state.dismissError);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());
  const [actionNotice, setActionNotice] = useState<{
    kind: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [scanAlert, setScanAlert] = useState<{ name: string } | null>(null);
  const [hosting, setHosting] = useState<HostingSettings | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .publicSettings()
      .then((settings) => {
        if (active) {
          setPublicSettings(settings);
          if (settings.hosting_enabled) {
            void api.hostingSettings().then(setHosting).catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const permissions = publicSettings?.permissions;
  const allowImagePreview = permissions?.allow_user_preview_image ?? true;
  const allowVideoPreview = permissions?.allow_user_preview_video ?? true;
  const allowPdfPreview = permissions?.allow_user_preview_pdf ?? true;
  const allowExtract = permissions?.allow_user_extract ?? false;
  const allowScan = Boolean(permissions?.allow_user_scan && publicSettings?.scan_enabled);

  const canPreview = (entry: FileEntry): boolean => {
    if (entry.type !== 'file') return false;
    if (isImageName(entry.name)) return allowImagePreview;
    if (isVideoName(entry.name)) return allowVideoPreview;
    if (isPdfName(entry.name)) return allowPdfPreview;
    if (isAudioName(entry.name)) return true;
    return true;
  };

  const openPreview = (entry: FileEntry): void => {
    if (isAudioName(entry.name)) {
      const queue = entries.filter((item) => item.type === 'file' && isAudioName(item.name));
      playAudio(entry, queue);
      return;
    }
    setPreviewEntry(entry);
  };

  const markBusy = (path: string, busy: boolean): void => {
    setBusyPaths((current) => {
      const next = new Set(current);
      if (busy) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const waitForTask = async (taskId: string): Promise<BackgroundTask> => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const task = await api.task(taskId);
      if (['completed', 'clean', 'infected', 'failed'].includes(task.status)) {
        return task;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    throw new Error('任务执行超时，请稍后刷新查看');
  };

  const extractEntry = async (entry: FileEntry): Promise<void> => {
    markBusy(entry.path, true);
    setActionNotice({ kind: 'info', text: `正在解压 ${entry.name}…` });
    try {
      const { taskId } = await api.extract(entry.path, currentPath);
      const task = await waitForTask(taskId);
      if (task.status === 'completed') {
        setActionNotice({ kind: 'success', text: `${entry.name} 已解压` });
        await refresh();
      } else {
        setActionNotice({
          kind: 'error',
          text: task.error ?? '解压失败，请检查压缩包是否损坏',
        });
      }
    } catch (cause) {
      setActionNotice({
        kind: 'error',
        text: cause instanceof Error ? cause.message : '解压失败',
      });
    } finally {
      markBusy(entry.path, false);
    }
  };

  const scanEntry = async (entry: FileEntry): Promise<void> => {
    markBusy(entry.path, true);
    setScanAlert(null);
    setActionNotice({ kind: 'info', text: `正在查杀 ${entry.name}…` });
    try {
      const { taskId } = await api.scan(entry.path);
      const task = await waitForTask(taskId);
      if (task.status === 'infected') {
        setScanAlert({ name: entry.name });
        setActionNotice(null);
      } else if (task.status === 'clean') {
        setActionNotice({ kind: 'success', text: `${entry.name} 未发现威胁` });
      } else {
        setActionNotice({
          kind: 'error',
          text: task.error ?? '查杀失败，请检查查杀引擎配置',
        });
      }
    } catch (cause) {
      setActionNotice({
        kind: 'error',
        text: cause instanceof Error ? cause.message : '查杀失败',
      });
    } finally {
      markBusy(entry.path, false);
    }
  };


  const selectedEntries = useMemo(
    () => entries.filter((entry) => selected.includes(entry.path)),
    [entries, selected],
  );
  const singleSelected = selectedEntries.length === 1 ? selectedEntries[0]! : null;
  const canDownload = singleSelected?.type === 'file';

  const deploySelectedFolder = async (): Promise<void> => {
    if (!singleSelected || singleSelected.type !== 'dir') return;
    try {
      const current = hosting ?? (await api.hostingSettings());
      const result = await api.saveHosting({
        rootPath: singleSelected.path,
        enabled: true,
        visibility: current.visibility,
      });
      setHosting(result);
      setActionNotice({ kind: 'success', text: `部署成功：${result.url}` });
    } catch (cause) {
      setActionNotice({ kind: 'error', text: cause instanceof Error ? cause.message : '部署失败' });
    }
  };

  const download = (entry: FileEntry): void => {
    const anchor = document.createElement('a');
    anchor.href = downloadUrl(entry.path);
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void uploadFiles(files);
  };

  const handleFileInput = (files: File[]): void => {
    if (files.length > 0) void uploadFiles(files);
  };

  return (
    <div
      className="min-h-screen bg-slate-50 dark:bg-slate-950"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Header />

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pb-24">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {t('files.title')}
            </h1>
            <div className="mt-1.5">
              <Breadcrumbs path={currentPath} disabled={listingLoading} onNavigate={(path) => void navigate(path)} />
            </div>
          </div>
          <QuotaBar usage={usage} />
        </div>

        {error ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={dismissError}
              className="rounded p-0.5 text-rose-400 transition hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-200"
              aria-label="关闭错误提示"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {hosting?.enabled && hosting.rootPath === currentPath ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
            <span>{t('files.currentHosting', { url: hosting.url })}</span>
            <button type="button" onClick={() => void api.disableHosting().then(setHosting).catch(() => {})} className="rounded-lg border border-indigo-300 px-3 py-1 text-xs hover:bg-indigo-100 dark:border-indigo-800 dark:hover:bg-indigo-950">
              {t('common.cancelDeploy')}
            </button>
          </div>
        ) : null}

        {scanAlert ? (          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">发现病毒：{scanAlert.name}</p>
              <p className="mt-0.5 text-xs">
                该文件已被标记为 infected，下载、分享和解压均会被服务端强制拦截。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScanAlert(null)}
              className="rounded p-0.5 text-rose-400 transition hover:text-rose-600"
              aria-label="关闭病毒警告"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {actionNotice ? (
          <div
            className={`mb-4 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm ${
              actionNotice.kind === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                : actionNotice.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300'
            }`}
          >
            <span className="flex-1">{actionNotice.text}</span>
            {busyPaths.size > 0 || actionNotice.kind !== 'info' ? (
              <button
                type="button"
                onClick={() => setActionNotice(null)}
                className="rounded p-0.5 opacity-70 transition hover:opacity-100"
                aria-label="关闭操作提示"
              >
                <XIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}

        <section
          aria-busy={listingLoading}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={PRIMARY_BUTTON}
              >
                <UploadIcon className="h-4 w-4" />
                {t('common.upload')}
              </button>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'folder' })}
                className={SECONDARY_BUTTON}
              >
                <PlusIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.newFolder')}</span>
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={listingLoading}
                className={SECONDARY_BUTTON}
                title={t('common.refresh')}
              >
                <RefreshIcon className={`h-4 w-4 ${listingLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{t('common.refresh')}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selected.length > 0 ? (
                <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">
                   {t('files.selected', { count: selected.length })}
                </span>
              ) : null}

              <button
                type="button"
                disabled={!canDownload}
                onClick={() => singleSelected && download(singleSelected)}
                className={SECONDARY_BUTTON}
                title={t('files.downloadSelected')}
              >
                <DownloadIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.download')}</span>
              </button>

              <button
                type="button"
                disabled={!publicSettings?.hosting_enabled || singleSelected?.type !== 'dir'}
                onClick={() => void deploySelectedFolder()}
                className={SECONDARY_BUTTON}
                title={t('files.deploySite')}
              >
                <FolderIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('files.deploySite')}</span>
              </button>

              <button
                type="button"
                disabled={!canDownload}
                onClick={() => singleSelected && setDialog({ kind: 'share', entry: singleSelected })}
                className={SECONDARY_BUTTON}
                title={t('common.share')}
              >
                <ShareIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.share')}</span>
              </button>

              <button
                type="button"
                disabled={!singleSelected}
                onClick={() => singleSelected && setDialog({ kind: 'rename', entry: singleSelected })}
                className={SECONDARY_BUTTON}
                title={t('common.rename')}
              >
                <PencilIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.rename')}</span>
              </button>

              <button
                type="button"
                disabled={selectedEntries.length === 0}
                onClick={() => setDialog({ kind: 'delete', entries: selectedEntries })}
                className={DANGER_BUTTON}
                title={t('files.deleteSelected')}
              >
                <TrashIcon className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.delete')}</span>
              </button>
            </div>
          </div>

          <FileTable
            entries={entries}
            loading={listingLoading}
            selected={selected}
            truncated={truncated}
            onNavigate={(path) => void navigate(path)}
            onPreview={openPreview}
            onDownload={download}
            onShare={(entry) => setDialog({ kind: 'share', entry })}
            onExtract={(entry) => void extractEntry(entry)}
            onScan={(entry) => void scanEntry(entry)}
            canPreview={canPreview}
            allowExtract={allowExtract}
            allowScan={allowScan}
            busyPaths={busyPaths}
            onRename={(entry) => setDialog({ kind: 'rename', entry })}
            onDelete={(entry) => setDialog({ kind: 'delete', entries: [entry] })}
            onToggleSelected={toggleSelected}
            onSelectAll={setSelected}
          />
        </section>

        <p className="mt-4 text-center text-[11px] text-slate-400 dark:text-slate-500">
          {t('files.footer', { username: user?.displayName || user?.username })}
        </p>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          event.target.value = '';
          handleFileInput(files);
        }}
      />

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-indigo-600/10 p-6 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-indigo-400 bg-white/95 px-8 py-7 text-center shadow-2xl dark:bg-slate-900/95">
            <UploadIcon className="mx-auto h-9 w-9 text-indigo-500 dark:text-indigo-400" />
            <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">
              释放鼠标即可上传
            </p>
            <p className="mt-1 max-w-[16rem] truncate text-xs text-slate-500 dark:text-slate-400">
              目标目录：{currentPath || '根目录'}
            </p>
          </div>
        </div>
      ) : null}

      {dialog?.kind === 'folder' ? (
        <PromptDialog
          title="新建文件夹"
          description={`将在「${currentPath || '根目录'}」下创建`}
          label="文件夹名称"
          placeholder="例如：照片"
          confirmLabel="创建"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await createFolder(name);
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === 'rename' ? (
        <PromptDialog
          title="重命名"
          description={dialog.entry.type === 'dir' ? '文件夹重命名后路径会同步变化' : '请输入新的文件名'}
          label="新名称"
          initialValue={dialog.entry.name}
          confirmLabel="保存"
          onClose={() => setDialog(null)}
          onSubmit={async (newName) => {
            await rename(dialog.entry.path, newName);
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title="确认删除"
          description={
            <>
              <p>
                即将永久删除
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {' '}
                  {dialog.entries
                    .slice(0, 3)
                    .map((entry) => entry.name)
                    .join('、')}
                  {dialog.entries.length > 3 ? ` 等 ${dialog.entries.length} 项` : ''}
                </span>
                。
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                文件夹会连同其中的所有内容一起删除，且无法恢复。
              </p>
            </>
          }
          confirmLabel="永久删除"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await remove(dialog.entries.map((entry) => entry.path));
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === 'share' ? (
        <ShareDialog entry={dialog.entry} onClose={() => setDialog(null)} />
      ) : null}

      {previewEntry ? (
        <PreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />
      ) : null}

      <UploadPanel />
      <AiAssistant enabled={publicSettings?.ai_enabled ?? false} />
    </div>
  );
}
