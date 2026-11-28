import { useEffect, useMemo, useState } from 'react';
import { api, type BackgroundTask } from '../api/client.ts';
import { useAppStore } from '../store/useAppStore.ts';
import { formatBytes } from '../lib/format.ts';
import { CheckIcon, Spinner, UploadIcon, XIcon } from './Icons.tsx';

const LABELS: Record<string, string> = { upload: '上传', extract: '解压', compress: '压缩', scan: '查杀' };
const STATUS: Record<string, string> = { running: '进行中', scanning: '查杀中', queued: '排队中', pending: '等待', paused: '已暂停', cancelled: '已取消', completed: '已完成', clean: '安全', infected: '有风险', failed: '失败', skipped: '跳过' };

function payloadOf(task: BackgroundTask): Record<string, unknown> {
  return (task as unknown as { payload?: Record<string, unknown> }).payload ?? {};
}

function taskName(task: BackgroundTask): string {
  const payload = payloadOf(task);
  if (task.type === 'upload') return String(payload.name ?? '上传文件');
  if (task.type === 'compress') return String(payload.archiveName ?? '压缩任务');
  if (task.type === 'extract') return String(payload.filePath ?? '解压任务').split('/').pop() ?? '解压任务';
  return String(payload.path ?? '查杀任务').split('/').pop() ?? '查杀任务';
}

function progressOf(task: BackgroundTask, localProgress?: number): number {
  if (localProgress !== undefined) return localProgress;
  const recorded = (task as unknown as { progress?: number }).progress;
  if (typeof recorded === 'number') return recorded;
  return task.status === 'completed' || task.status === 'clean' ? 1 : 0;
}

export function TaskQueuePanel() {
  const uploads = useAppStore((state) => state.uploads);
  const cancelUpload = useAppStore((state) => state.cancelUpload);
  const clearFinishedUploads = useAppStore((state) => state.clearFinishedUploads);
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [expanded, setExpanded] = useState(true);

  const load = async (): Promise<void> => {
    try { setTasks(await api.tasks()); } catch { /* ignore */ }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    const onChange = (): void => { void load(); };
    window.addEventListener('cloudbox:tasks-changed', onChange);
    return () => { window.clearInterval(timer); window.removeEventListener('cloudbox:tasks-changed', onChange); };
  }, []);

  const localByTask = useMemo(() => new Map(uploads.filter((item) => item.taskId).map((item) => [item.taskId!, item])), [uploads]);
  const serverIds = new Set(tasks.map((task) => task.id));
  const pendingLocal = uploads.filter((item) => !item.taskId || !serverIds.has(item.taskId));
  const total = tasks.length + pendingLocal.length;

  if (total === 0) return null;

  const clearAll = async (): Promise<void> => {
    await api.clearTasks().catch(() => {});
    clearFinishedUploads();
    setTasks([]);
  };

  return (
    <section aria-label="任务队列" className="fixed inset-x-3 bottom-3 z-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <button type="button" onClick={() => setExpanded((value) => !value)} className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <UploadIcon className="h-4 w-4 text-indigo-500" />
          任务队列
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{total}</span>
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void clearAll()} className="text-xs text-slate-400 hover:text-slate-600">清除列表</button>
          <button type="button" onClick={() => setExpanded((value) => !value)} className="text-slate-400" aria-label="折叠任务队列">{expanded ? '−' : '+'}</button>
        </div>
      </div>

      {expanded ? (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {tasks.map((task) => {
            const local = localByTask.get(task.id);
            const progress = progressOf(task, local?.progress);
            const done = task.status === 'completed' || task.status === 'clean';
            const failed = task.status === 'failed' || task.status === 'infected' || task.status === 'cancelled';
            return (
              <li key={task.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="shrink-0">{task.status === 'running' || task.status === 'scanning' ? <Spinner className="h-4 w-4 text-indigo-500" /> : done ? <CheckIcon className="h-4 w-4 text-emerald-500" /> : failed ? <XIcon className="h-4 w-4 text-rose-400" /> : null}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={taskName(task)}>{taskName(task)}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">{LABELS[task.type] ?? task.type} · {STATUS[task.status] ?? task.status}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={`h-full rounded-full ${failed ? 'bg-rose-400' : done ? 'bg-emerald-400' : 'bg-indigo-500'}`} style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                    <div className="mt-0.5 flex justify-between text-[10px] text-slate-400"><span>{task.error ?? ''}</span><span>{task.status === 'queued' || task.status === 'pending' ? `排队中${typeof task.queuePosition === 'number' ? `（前方还有 ${task.queuePosition} 个任务）` : ''}` : `${Math.round(progress * 100)}%`}</span></div>
                  </div>
                  {task.type !== 'upload' && (task.status === 'paused' || task.status === 'cancelled' || task.status === 'failed') ? <button type="button" onClick={() => void api.restartTask(task.id).then(load)} className="text-[11px] text-indigo-500">重开</button> : null}
                  {task.status === 'running' || task.status === 'scanning' ? <button type="button" onClick={() => void api.cancelTask(task.id).then(load)} className="text-[11px] text-rose-500">取消</button> : null}
                  {task.status === 'queued' || task.status === 'pending' ? <button type="button" onClick={() => void api.pauseTask(task.id).then(load)} className="text-[11px] text-slate-400">暂停</button> : null}
                </div>
              </li>
            );
          })}
          {pendingLocal.map((item) => {
            const done = item.status === 'success';
            const failed = item.status === 'error' || item.status === 'canceled';
            return (
            <li key={item.id} className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                {item.status === 'uploading' ? <Spinner className="h-4 w-4 text-indigo-500" /> : done ? <CheckIcon className="h-4 w-4 text-emerald-500" /> : <XIcon className="h-4 w-4 text-rose-400" />}
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-xs"><span className="truncate">{item.name}</span><span className={`text-[11px] ${failed ? 'text-rose-400' : 'text-slate-400'}`}>上传 · {done ? '已完成' : item.status === 'canceled' ? '已取消' : item.status === 'error' ? '失败' : '进行中'}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>
                  <div className="mt-0.5 flex justify-between text-[10px] text-slate-400"><span>{done ? '已完成' : failed ? item.error ?? '上传失败' : `${Math.round(item.progress * 100)}%`}</span><span>{item.status === 'uploading' ? `${formatBytes(item.speed)}/s` : `${formatBytes(item.size)}`}</span></div>
                </div>
                {item.status === 'uploading' ? <button type="button" onClick={() => cancelUpload(item.id)} className="text-[11px] text-rose-500">取消</button> : null}
              </div>
            </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
