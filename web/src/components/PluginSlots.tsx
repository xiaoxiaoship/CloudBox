import { useEffect, useRef, useState } from 'react';
import { api, type PluginSlot } from '../api/client.ts';
import { useAppStore } from '../store/useAppStore.ts';

export function PluginSlots() {
  const user = useAppStore((state) => state.user);
  const [slots, setSlots] = useState<PluginSlot[]>([]);
  const [active, setActive] = useState<PluginSlot | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api.pluginSlots().then((value) => { if (!cancelled) setSlots(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (active === null || iframeRef.current === null) return;
    const frame = iframeRef.current;
    const send = (): void => frame.contentWindow?.postMessage({
      type: 'cloudbox:init',
      token: active.token,
      user: user === null ? null : { id: user.id, username: user.username, role: user.role },
    }, '*');
    frame.addEventListener('load', send);
    if (frame.contentWindow !== null) send();
    return () => frame.removeEventListener('load', send);
  }, [active, user]);

  if (slots.length === 0) return null;
  return (
    <>
      {slots.map((slot) => (
        <button
          key={`${slot.plugin}:${slot.id}`}
          type="button"
          onClick={() => setActive(slot)}
          className={`fixed z-40 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-lg backdrop-blur transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 ${slot.position === 'bottom-left' ? 'bottom-5 left-5' : slot.position === 'sidebar' ? 'right-4 top-20' : 'bottom-5 right-5'}`}
          title={slot.title}
          aria-label={slot.title}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500">✦</span>
          {slot.title}
        </button>
      ))}
      {active !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setActive(null)}>
          <div className="flex h-[min(78vh,680px)] w-[min(92vw,860px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{active.title}<span className="ml-2 text-[10px] font-normal text-slate-400">{active.plugin}</span></div>
              <button type="button" onClick={() => setActive(null)} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="关闭插件">✕</button>
            </div>
            <iframe
              ref={iframeRef}
              title={active.title}
              src={active.iframeUrl}
              sandbox="allow-scripts allow-forms"
              className="min-h-0 flex-1 border-0 bg-white"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
