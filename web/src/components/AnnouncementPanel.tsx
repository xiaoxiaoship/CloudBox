import { useEffect, useRef } from 'react';
import type { AnnouncementView } from '../api/client.ts';
import { BellIcon, XIcon } from './Icons.tsx';

const CATEGORY = {
  critical: { label: '关键', className: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200' },
  warning: { label: '警告', className: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' },
  info: { label: '消息', className: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200' },
} as const;

export function AnnouncementPanel({ items, onClose }: { items: AnnouncementView[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointer = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [onClose]);

  return (
    <div ref={ref} role="dialog" aria-label="公告" className="fixed right-3 top-16 z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:right-6">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100"><BellIcon className="h-4 w-4 text-indigo-500" />公告</div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label="关闭公告"><XIcon className="h-4 w-4" /></button>
      </div>
      <ul className="max-h-96 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
        {items.length === 0 ? <li className="px-4 py-8 text-center text-xs text-slate-500">暂无公告</li> : null}
        {items.map((item) => {
          const category = CATEGORY[item.category];
          return (
            <li key={item.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${category.className}`}>{category.label}</span>
                <span className="text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">{item.body}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
