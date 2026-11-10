import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import {
  api,
  downloadUrl,
  previewContentUrl,
  type FileEntry,
  type PreviewInfo,
  type TextPreview,
} from '../api/client.ts';
import { formatBytes } from '../lib/format.ts';
import { useEscapeKey, useLockBodyScroll } from '../lib/useModal.ts';
import {
  AlertIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  Spinner,
  XIcon,
} from './Icons.tsx';

interface PreviewModalProps {
  entry: FileEntry;
  onClose: () => void;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : '加载失败，请稍后重试';
}

export function PreviewModal({ entry, onClose }: PreviewModalProps) {
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [text, setText] = useState<TextPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pluginPreviewer, setPluginPreviewer] = useState<string | null>(null);

  useLockBodyScroll();
  useEscapeKey(onClose);

  useEffect(() => {
    let cancelled = false;

    setInfo(null);
    setText(null);
    setError(null);
    setLoading(true);
    setPluginPreviewer(null);

    void (async () => {
      try {
        const extension = entry.name.includes('.') ? `.${entry.name.split('.').pop()!.toLowerCase()}` : '';
        const previewers: Record<string, string> = await api.pluginPreviewers().catch(() => ({}));
        if (cancelled) return;
        const plugin = extension ? previewers[extension] : undefined;
        if (plugin) {
          setPluginPreviewer(plugin);
          setLoading(false);
          return;
        }

        const detected = await api.previewInfo(entry.path);
        if (cancelled) return;
        setInfo(detected);

        if (detected.kind === 'text') {
          const content = await api.previewText(entry.path);
          if (!cancelled) setText(content);
        }
      } catch (cause) {
        if (!cancelled) setError(errorText(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  const closeOnBackdrop = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/60 backdrop-blur-sm dark:bg-slate-950/80 sm:items-center sm:p-4"
      onMouseDown={closeOnBackdrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`预览 ${entry.name}`}
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 dark:ring-1 dark:ring-slate-800 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl"
      >
        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <FileIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
              title={entry.name}
            >
              {entry.name}
            </h2>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {formatBytes(info?.size ?? entry.size)}
              {info?.mime ? ` · ${info.mime}` : ''}
            </p>
          </div>

          <a
            href={downloadUrl(entry.path)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="下载文件"
          >
            <DownloadIcon className="h-4 w-4" />
            <span className="hidden sm:inline">下载</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label="关闭预览"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-auto bg-slate-50 p-3 dark:bg-slate-950 sm:p-6">
          {pluginPreviewer ? (
            <iframe
              title={`${entry.name} 插件预览`}
              src={`/api/plugins/${encodeURIComponent(pluginPreviewer)}/preview?path=${encodeURIComponent(entry.path)}`}
              sandbox="allow-scripts allow-same-origin"
              className="h-[70vh] w-full rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800"
            />
          ) : loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
              <Spinner className="h-7 w-7 text-indigo-500 dark:text-indigo-400" />
              <p className="text-sm">正在准备预览…</p>
            </div>
          ) : error ? (
            <div className="mx-auto mt-10 max-w-md rounded-xl border border-rose-100 bg-white p-6 text-center dark:border-rose-900/60 dark:bg-slate-900">
              <AlertIcon className="mx-auto h-8 w-8 text-rose-500 dark:text-rose-400" />
              <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                预览失败
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{error}</p>
            </div>
          ) : info?.kind === 'none' ? (
            <div className="mx-auto mt-4 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:mt-10">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                <FileIcon className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-800 dark:text-slate-100">
                该格式不支持在线预览
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                为防范 XSS，SVG、HTML 等主动内容以及未列入白名单的格式一律只允许下载。
              </p>
              <a
                href={downloadUrl(entry.path)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500"
              >
                <DownloadIcon className="h-4 w-4" />
                下载文件
              </a>
            </div>
          ) : info?.kind === 'image' ? (
            <div className="flex min-h-64 items-center justify-center">
              <img
                src={previewContentUrl(entry.path)}
                alt={entry.name}
                className="max-h-[70vh] max-w-full rounded-lg bg-white object-contain shadow-sm dark:bg-slate-800"
                onError={() => setError('图片加载失败，文件可能已损坏')}
              />
            </div>
          ) : info?.kind === 'text' ? (
            <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-200">
                {text?.text ?? ''}
              </pre>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <span>编码：{text?.encoding ?? 'UTF-8'}</span>
                {text?.truncated ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    文件较大，仅预览前 512KB
                  </span>
                ) : null}
              </div>
            </div>
          ) : info?.kind === 'video' ? (
            <div className="flex min-h-64 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-950/90">
              <video
                src={previewContentUrl(entry.path)}
                controls
                preload="metadata"
                playsInline
                className="max-h-[80vh] max-w-full rounded-lg bg-black shadow-sm"
                onError={() => setError('视频加载失败，文件可能已损坏或编码不受支持')}
              >
                您的浏览器不支持视频播放。
              </video>
            </div>
          ) : info?.kind === 'pdf' ? (
            <PdfViewer url={previewContentUrl(entry.path)} />
          ) : info?.kind === 'office' ? (
            <OfficeViewer
              url={previewContentUrl(entry.path)}
              name={entry.name}
              mime={info.mime ?? ''}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PdfViewer({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setLoading(true);
    setError(null);
    setPdf(null);
    setPage(1);

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) {
          throw new Error(`加载 PDF 失败（HTTP ${response.status}）`);
        }

        const data = await response.arrayBuffer();
        loadingTask = pdfjs.getDocument({ data });
        const document = await loadingTask.promise;

        if (cancelled) {
          void loadingTask.destroy();
          return;
        }

        setPdf(document);
        setNumPages(document.numPages);
      } catch (cause) {
        if (!cancelled) setError(errorText(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!pdf) return;

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    void (async () => {
      const pdfPage = await pdf.getPage(page);
      if (cancelled) return;

      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const availableWidth = Math.max(
        280,
        Math.min(containerRef.current?.clientWidth ?? 900, 1_000) - 8,
      );
      const scale = Math.max(0.5, Math.min(2, availableWidth / baseViewport.width));
      const viewport = pdfPage.getViewport({ scale });

      const canvas = canvasRef.current;
      if (!canvas) return;

      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const context = canvas.getContext('2d');
      if (!context) return;

      const task = pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      renderTask = task;
      await task.promise;
    })().catch((cause: unknown) => {
      const name = (cause as { name?: string } | null)?.name;
      if (!cancelled && name !== 'RenderingCancelledException') {
        setError(errorText(cause));
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, page]);

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
        <Spinner className="h-7 w-7 text-indigo-500 dark:text-indigo-400" />
        <p className="text-sm">正在解析 PDF…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-xl border border-rose-100 bg-white p-6 text-center dark:border-rose-900/60 dark:bg-slate-900">
        <AlertIcon className="mx-auto h-8 w-8 text-rose-500 dark:text-rose-400" />
        <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">
          PDF 加载失败
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-4xl">
      <div className="flex justify-center overflow-auto rounded-xl bg-slate-200/50 p-2 dark:bg-slate-800/60">
        <canvas ref={canvasRef} className="rounded bg-white shadow-sm" />
      </div>

      {numPages > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="上一页"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {page} / {numPages}
          </span>
          <button
            type="button"
            disabled={page >= numPages}
            onClick={() => setPage((current) => Math.min(numPages, current + 1))}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="下一页"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}


function OfficeViewer({ url, name }: { url: string; name: string; mime: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetRows, setSheetRows] = useState<unknown[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSheetRows(null);
    const container = containerRef.current;
    if (container) container.innerHTML = '';

    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('加载 Office 文件失败（HTTP ' + response.status + '）');
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const ext = name.split('.').pop()?.toLowerCase();

        if (ext === 'docx') {
          const { renderAsync } = await import('docx-preview');
          if (!container) throw new Error('预览容器不可用');
          await renderAsync(buffer, container, undefined, {
            inWrapper: true,
            breakPages: true,
            ignoreWidth: false,
            ignoreHeight: false,
            renderHeaders: true,
            renderFooters: true,
          });
        } else if (ext === 'xlsx') {
          const ExcelJS = await import('exceljs');
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer as never);
          const worksheet = workbook.worksheets[0];
          if (!worksheet) throw new Error('工作簿没有工作表');
          const rows: unknown[][] = [];
          worksheet.eachRow({ includeEmpty: true }, (row) => {
            rows.push((row.values as unknown[]).slice(1));
          });
          if (!cancelled) setSheetRows(rows);
        } else if (ext === 'pptx') {
          const { init } = await import('pptx-preview');
          if (!container) throw new Error('预览容器不可用');
          const viewer = init(container, { width: 960, height: 540, mode: 'list' });
          await viewer.preview(buffer);
        } else {
          throw new Error('不支持的 Office 格式');
        }
      } catch (cause) {
        if (!cancelled) setError(errorText(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (container) container.innerHTML = '';
    };
  }, [url, name]);

  return (
    <div className="mx-auto max-w-full">
      {loading ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500">
          <Spinner className="h-7 w-7 text-indigo-500 dark:text-indigo-400" />
          <p className="text-sm">正在解析 Office 文件…</p>
        </div>
      ) : null}
      {error ? (
        <div className="mx-auto mt-10 max-w-md rounded-xl border border-rose-100 bg-white p-6 text-center dark:border-rose-900/60 dark:bg-slate-900">
          <AlertIcon className="mx-auto h-8 w-8 text-rose-500 dark:text-rose-400" />
          <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">Office 预览失败</p>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{error}</p>
        </div>
      ) : null}
      {sheetRows ? (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800">
          <table className="min-w-full border-collapse text-xs">
            <tbody>
              {sheetRows.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex === 0 ? 'bg-slate-100 font-medium dark:bg-slate-800' : ''}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border border-slate-200 px-2 py-1 align-top text-slate-700 dark:border-slate-700 dark:text-slate-200">
                      {String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={containerRef} className="office-preview max-h-[70vh] overflow-auto rounded-xl bg-white p-2 shadow-sm dark:bg-slate-900" />
      )}
    </div>
  );
}
