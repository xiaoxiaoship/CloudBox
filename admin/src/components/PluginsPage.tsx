import { useEffect, useState } from 'react';
import type { PluginInfo } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import { Modal, type ToastState } from './Dialog.tsx';
import { AlertIcon, PlugIcon, Spinner, TrashIcon } from './Icons.tsx';

interface PluginsPageProps {
  notify: (kind: ToastState['kind'], message: string) => void;
}

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900/60 p-4';

export function PluginsPage({ notify }: PluginsPageProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [uninstallName, setUninstallName] = useState<string | null>(null);
  const [overrideName, setOverrideName] = useState<string | null>(null);
  const [previewPlugin, setPreviewPlugin] = useState<PluginInfo | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setPlugins(await call(api.plugins.list()));
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const importPlugin = async (): Promise<void> => {
    setPending('import');
    try {
      const result = await call(api.plugins.import());
      if (result !== null) {
        setPlugins(result);
        notify('success', '插件已导入，默认处于禁用状态');
      }
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const setEnabled = async (plugin: PluginInfo, enabled: boolean): Promise<void> => {
    setPending(`toggle:${plugin.name}`);
    try {
      setPlugins(await call(api.plugins.setEnabled({ name: plugin.name, enabled })));
      notify('success', enabled ? `插件 ${plugin.name} 已启用` : `插件 ${plugin.name} 已禁用`);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const setWebOverride = async (name: string, allowed: boolean): Promise<void> => {
    setPending(`override:${name}`);
    try {
      setPlugins(await call(api.plugins.setAllowWebOverride({ name, allowed })));
      notify('success', allowed ? 'Web 接管已开启' : 'Web 接管已关闭');
      setOverrideName(null);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const uninstall = async (): Promise<void> => {
    if (uninstallName === null) return;
    setPending(`remove:${uninstallName}`);
    try {
      setPlugins(await call(api.plugins.remove({ name: uninstallName })));
      notify('success', '插件已卸载');
      setUninstallName(null);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <PlugIcon className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-slate-100">插件平台</h2>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                {plugins.length} 个已安装
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              插件在独立子进程中运行；配置界面通过沙箱 iframe 加载。启用/禁用会即时启动或终止子进程。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void importPlugin()}
            disabled={pending !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending === 'import' ? <Spinner className="h-4 w-4" /> : null}
            导入插件
          </button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 px-2 py-8 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          正在读取插件…
        </div>
      ) : plugins.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 px-6 py-12 text-center text-sm text-slate-500">
          暂无插件。导入 zip 或包含 manifest.json 的文件夹。
        </div>
      ) : (
        <div className="space-y-3">
          {plugins.map((plugin) => (
            <section key={plugin.name} className={CARD}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-100">{plugin.name}</h3>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      v{plugin.version}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        plugin.running
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {plugin.running ? '运行中' : plugin.enabled ? '已启用' : '已禁用'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{plugin.description || '无描述'}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-slate-600">
                    {plugin.directory}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {plugin.hasAdminUi ? (
                    <button
                      type="button"
                      onClick={() => setPreviewPlugin(plugin)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
                    >
                      配置界面
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setUninstallName(plugin.name)}
                    disabled={pending !== null}
                    className="rounded-lg border border-rose-900/60 p-1.5 text-rose-400 transition hover:bg-rose-950/40 disabled:opacity-50"
                    aria-label={`卸载 ${plugin.name}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={plugin.enabled}
                    aria-label={`启用 ${plugin.name}`}
                    disabled={pending !== null}
                    onClick={() => void setEnabled(plugin, !plugin.enabled)}
                    className={`relative h-7 w-12 rounded-full transition ${
                      plugin.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        plugin.enabled ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {plugin.hasWebOverride ? (
                <label className="mt-3 flex items-start gap-2 rounded-lg border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-[11px] leading-5 text-rose-200">
                  <input
                    type="checkbox"
                    checked={plugin.allowWebOverride}
                    disabled={pending !== null || !plugin.enabled}
                    onChange={(event) => {
                      if (event.target.checked) setOverrideName(plugin.name);
                      else void setWebOverride(plugin.name, false);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 accent-rose-500"
                    aria-label={`允许 ${plugin.name} 接管 Web 界面`}
                  />
                  <span>
                    <strong>允许此插件接管 Web 界面</strong>
                    <br />
                    高危：普通用户访问 `/` 时将由插件完全接管页面。仅安装可信插件后开启。
                  </span>
                </label>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {previewPlugin?.adminUiUrl ? (
        <Modal
          title={`${previewPlugin.name} 配置界面`}
          description="插件专属 admin-ui/index.html，通过沙箱 iframe 加载。"
          onClose={() => setPreviewPlugin(null)}
          width="lg"
          footer={
            <button
              type="button"
              onClick={() => setPreviewPlugin(null)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              关闭
            </button>
          }
        >
          <iframe
            title={`${previewPlugin.name} 插件配置`}
            src={previewPlugin.adminUiUrl}
            sandbox="allow-scripts allow-forms"
            className="h-[55vh] w-full rounded-lg border border-slate-800 bg-slate-950"
          />
        </Modal>
      ) : null}

      {uninstallName ? (
        <Modal
          title="卸载插件"
          description={`确定卸载 ${uninstallName}？插件目录会被删除，插件专属 storage 保留。`}
          onClose={() => setUninstallName(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setUninstallName(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void uninstall()}
                disabled={pending !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60"
              >
                {pending !== null ? <Spinner className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
                确认卸载
              </button>
            </>
          }
        >
          <div className="flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            正在运行的插件进程会先被终止；此操作不可撤销。
          </div>
        </Modal>
      ) : null}

      {overrideName ? (
        <Modal
          title="高危：允许插件接管 Web 界面"
          description={`插件 ${overrideName} 将替换普通用户访问 / 时看到的整个页面。`}
          onClose={() => setOverrideName(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setOverrideName(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void setWebOverride(overrideName, true)}
                disabled={pending !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60"
              >
                我了解风险，仍然开启
              </button>
            </>
          }
        >
          <div className="space-y-2 rounded-lg border border-rose-700 bg-rose-950/50 px-4 py-3 text-sm leading-6 text-rose-100">
            <p className="flex items-center gap-2 font-semibold">
              <AlertIcon className="h-5 w-5" />
              此开关会把普通用户 Web 入口交给插件 HTML。
            </p>
            <p className="text-xs">
              插件只能通过标准 `/api/*` 接口通信，仍需 Session 与 CSRF；但恶意插件可以伪造登录页、钓鱼或窃取用户输入。仅对完全可信的插件开启。
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
