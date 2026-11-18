import { useEffect, useState } from 'react';
import { api, call, errorMessage } from '../api/ipc.ts';
import { Modal } from './Dialog.tsx';

interface CountEntry {
  scope: 'ip' | 'account' | 'global';
  target: string;
  feature: string;
  count: number;
  updatedAt: number;
}

export function SecurityCountsDialog({ onClose, notify }: { onClose: () => void; notify: (kind: 'success' | 'error', message: string) => void }) {
  const [counts, setCounts] = useState<CountEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async (): Promise<void> => {
    setLoading(true);
    try { setCounts(await call(api.system.securityCounts())); }
    catch (cause) { notify('error', errorMessage(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 2_000);
    return () => window.clearInterval(timer);
  }, []);
  const clear = async (entry: CountEntry): Promise<void> => {
    try { await call(api.system.clearSecurityCount({ scope: entry.scope, target: entry.target, feature: entry.feature })); await load(); }
    catch (cause) { notify('error', errorMessage(cause)); }
  };
  const clearAll = async (): Promise<void> => {
    try { await call(api.system.clearAllSecurityCounts()); await load(); notify('success', '所有计数已清除'); }
    catch (cause) { notify('error', errorMessage(cause)); }
  };
  return (
    <Modal title="当前计数" description="选项卡触发、API 泛洪和全局策略计数；可逐项清除。" onClose={onClose} width="lg"
      footer={<><button type="button" onClick={() => void clearAll()} className="rounded-lg border border-rose-900/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">全部清除</button><button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">关闭</button></>}>
      {loading ? <p className="py-6 text-center text-xs text-slate-500">加载中…</p> : counts.length === 0 ? <p className="py-6 text-center text-xs text-slate-600">暂无计数</p> : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-[10px] text-slate-500"><tr><th className="px-3 py-2">层级</th><th className="px-3 py-2">目标</th><th className="px-3 py-2">来源</th><th className="px-3 py-2 text-center">计数</th><th className="px-3 py-2 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {counts.map((entry) => (
                <tr key={`${entry.scope}:${entry.target}:${entry.feature}`}>
                  <td className="px-3 py-2 text-slate-400">{entry.scope === 'ip' ? 'IP' : entry.scope === 'account' ? '账户' : '全局'}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{entry.target}</td>
                  <td className="px-3 py-2 text-slate-400">{entry.feature}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-200">{entry.count}</td>
                  <td className="px-3 py-2 text-right"><button type="button" onClick={() => void clear(entry)} className="rounded border border-rose-900/60 bg-rose-950/20 px-2 py-1 text-[10px] text-rose-300">清除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
