import { useEffect, useState } from 'react';
import { api, type BackgroundTask } from '../api/client.ts';
import { useAppStore } from '../store/useAppStore.ts';
import { DialogShell } from './Dialog.tsx';

const LABELS: Record<string, string> = {
  extract: '解压',
  scan: '查杀',
  compress: '压缩',
  upload: '上传',
};

export function TaskQueueDialog({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [pending, setPending] = useState(false);
  const uploads = useAppStore((state) => state.uploads);
  const cancelUpload = useAppStore((state) => state.cancelUpload);
  const clearFinishedUploads = useAppStore((state) => state.clearFinishedUploads);
  const [stats, setStats] = useState({ running: 0, queued: 0, paused: 0 });
  const [usage, setUsage] = useState<Record<string, { users: number; running: number; queued: number; paused: number }>>({});

  const load = async (): Promise<void> => {
    try { setTasks(await api.tasks()); setStats(await api.taskStats()); setUsage(await api.taskUsage()); } catch { /* ignore */ }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const clear = async (): Promise<void> => {
    setPending(true);
    try { await api.clearTasks(); setTasks([]); } finally { setPending(false); }
  };

  return (
    <DialogShell
      title="任务队列"
      description="最近 20 条任务；运行中的任务可取消，排队任务可暂停。"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={() => void clear()} disabled={pending || tasks.length === 0} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">清除列表</button>
          <button type="button" onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">关闭</button>
        </>
      )}
    >
      <p className="mb-2 text-xs text-slate-500">运行 {stats.running + uploads.filter((item) => item.status === 'uploading').length} · 排队 {stats.queued} · 暂停 {stats.paused} · 上传 {uploads.length}</p>
      {uploads.length ? (
        <div className="mb-3 space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
          <div className="flex items-center justify-between text-[11px] text-slate-500"><span>上传任务</span><button type="button" onClick={clearFinishedUploads} className="underline">清除已完成</button></div>
          {uploads.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 text-[11px]"><span className="truncate">{item.name}</span><span>{Math.round(item.progress * 100)}% · {item.status}</span>{item.status === 'uploading' ? <button type="button" onClick={() => cancelUpload(item.id)} className="text-rose-500">取消</button> : null}</div>)}
        </div>
      ) : null}
      <div className="mb-2 grid grid-cols-3 gap-1 text-[11px] text-slate-500">
        {(['extract', 'compress', 'scan'] as const).map((key) => <span key={key}>{LABELS[key]} 用户{usage[key]?.users ?? 0} 运行{usage[key]?.running ?? 0}/排队{usage[key]?.queued ?? 0}</span>)}
      </div>
      {tasks.length === 0 ? <p className="text-sm text-slate-500">暂无任务</p> : (
        <ul className="max-h-80 space-y-2 overflow-auto">
          {tasks.map((task) => (
            <li key={task.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{LABELS[task.type] ?? task.type}</span>
                <span className="text-slate-500">{task.status}</span>
              </div>
              <div className="mt-2 flex gap-2">
                {(task.status === 'queued' || task.status === 'pending') ? <button type="button" onClick={() => void api.pauseTask(task.id).then(load)} className="rounded border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-700">暂停</button> : null}
                {(task.type !== 'upload' && (task.status === 'paused' || task.status === 'cancelled' || task.status === 'failed')) ? <button type="button" onClick={() => void api.restartTask(task.id).then(load)} className="rounded border border-indigo-300 px-2 py-1 text-[11px] text-indigo-500">从头开始</button> : null}
                {(task.status === 'running' || task.status === 'scanning') ? <button type="button" onClick={() => void api.cancelTask(task.id).then(load)} className="rounded border border-rose-300 px-2 py-1 text-[11px] text-rose-500">取消</button> : null}
              </div>
              {task.error ? <p className="mt-1 text-rose-500">{task.error}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </DialogShell>
  );
}
