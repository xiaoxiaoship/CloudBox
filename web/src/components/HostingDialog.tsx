import { useEffect, useState } from 'react';
import { api, type HostingSettings } from '../api/client.ts';
import { DialogShell } from './Dialog.tsx';
import { Spinner } from './Icons.tsx';

export function HostingDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<HostingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api.hostingSettings().then(setSettings).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : '加载失败'),
    );
  }, []);

  const save = async (): Promise<void> => {
    if (!settings) return;
    setPending(true);
    setError(null);
    try {
      setSettings(
        await api.saveHosting({
          rootPath: settings.rootPath,
          enabled: settings.enabled,
          visibility: settings.visibility,
        }),
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setPending(false);
    }
  };

  const disable = async (): Promise<void> => {
    setPending(true);
    try {
      setSettings(await api.disableHosting());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消失败');
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogShell
      title="站点托管"
      description="选择一个包含 index.html 的网盘文件夹作为静态站点根目录。"
      onClose={onClose}
      footer={
        <button type="button" onClick={() => void save()} disabled={pending || !settings} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? '保存中…' : '保存并部署'}
        </button>
      }
    >
      {!settings ? (
        error ? <p className="text-sm text-rose-300">{error}</p> : <Spinner className="h-5 w-5" />
      ) : (
        <div className="space-y-3">
          <label className="block text-xs text-slate-400">站点根目录（相对网盘路径）
            <input value={settings.rootPath} onChange={(event) => setSettings({ ...settings, rootPath: event.target.value })} placeholder="例如 public 或 dist" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
          <div>
            <p className="text-xs text-slate-400">访问权限</p>
            <div className="mt-2 space-y-2 text-xs text-slate-300">
              <label className="flex items-center gap-2"><input type="radio" checked={settings.visibility === 'public'} onChange={() => setSettings({ ...settings, visibility: 'public' })} className="accent-indigo-500" />公开访问（任何人）</label>
              <label className="flex items-center gap-2"><input type="radio" checked={settings.visibility === 'private'} onChange={() => setSettings({ ...settings, visibility: 'private' })} className="accent-indigo-500" />私有访问（必须登录网盘）</label>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="accent-indigo-500" />
            开启托管
          </label>
          {settings.rootPath ? (
            <p className="break-all rounded-lg bg-slate-950 px-3 py-2 text-[11px] text-indigo-300">
              访问地址：<a href={settings.url} target="_blank" rel="noreferrer" className="underline">{settings.url}</a>
            </p>
          ) : null}
          {settings.enabled ? (
            <button type="button" onClick={() => void disable()} disabled={pending} className="text-xs text-rose-300 underline">取消部署</button>
          ) : null}
          {error ? <p className="text-xs text-rose-300">{error}</p> : null}
        </div>
      )}
    </DialogShell>
  );
}
