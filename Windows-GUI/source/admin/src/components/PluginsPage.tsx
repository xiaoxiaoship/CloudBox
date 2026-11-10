import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginInfo } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import { Modal, type ToastState } from './Dialog.tsx';
import { AlertIcon, PlugIcon, Spinner, TrashIcon } from './Icons.tsx';

interface PluginsPageProps {
  notify: (kind: ToastState['kind'], message: string) => void;
}

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900/60 p-4';

export function PluginsPage({ notify }: PluginsPageProps) {
  const { t } = useTranslation();
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
        notify('success', t('admin.pluginsPage.imported'));
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
      notify('success', enabled
        ? t('admin.pluginsPage.enabledToast', { name: plugin.name })
        : t('admin.pluginsPage.disabledToast', { name: plugin.name }));
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
      notify('success', allowed ? t('admin.pluginsPage.overrideOn') : t('admin.pluginsPage.overrideOff'));
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
      notify('success', t('admin.pluginsPage.uninstalled'));
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
              <h2 className="text-sm font-semibold text-slate-100">{t('admin.pluginsPage.title')}</h2>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                {t('admin.pluginsPage.installed', { count: plugins.length })}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t('admin.pluginsPage.intro')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void importPlugin()}
            disabled={pending !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending === 'import' ? <Spinner className="h-4 w-4" /> : null}
            {t('admin.pluginsPage.import')}
          </button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 px-2 py-8 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          {t('admin.pluginsPage.reading')}
        </div>
      ) : plugins.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 px-6 py-12 text-center text-sm text-slate-500">
          {t('admin.pluginsPage.empty')}
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
                      {plugin.running ? t('admin.pluginsPage.running') : plugin.enabled ? t('admin.pluginsPage.enabled') : t('admin.pluginsPage.disabled')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{plugin.description || t('admin.pluginsPage.noDescription')}</p>
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
                      {t('admin.pluginsPage.configure')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setUninstallName(plugin.name)}
                    disabled={pending !== null}
                    className="rounded-lg border border-rose-900/60 p-1.5 text-rose-400 transition hover:bg-rose-950/40 disabled:opacity-50"
                    aria-label={`${t('admin.pluginsPage.uninstall')} ${plugin.name}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={plugin.enabled}
                    aria-label={t('admin.pluginsPage.enable', { name: plugin.name })}
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
                    aria-label={t('admin.pluginsPage.allowOverride', { name: plugin.name })}
                  />
                  <span>
                    <strong>{t('admin.pluginsPage.overrideTitle')}</strong>
                    <br />
                    {t('admin.pluginsPage.overrideWarning')}
                  </span>
                </label>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {previewPlugin?.adminUiUrl ? (
        <Modal
          title={t('admin.pluginsPage.configTitle', { name: previewPlugin.name })}
          description={t('admin.pluginsPage.configDescription')}
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
            title={t('admin.pluginsPage.config', { name: previewPlugin.name })}
            src={previewPlugin.adminUiUrl}
            sandbox="allow-scripts allow-forms"
            className="h-[55vh] w-full rounded-lg border border-slate-800 bg-slate-950"
          />
        </Modal>
      ) : null}

      {uninstallName ? (
        <Modal
          title={t('admin.pluginsPage.uninstallTitle')}
          description={t('admin.pluginsPage.uninstallDescription', { name: uninstallName })}
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
            {t('admin.pluginsPage.uninstallHint')}
          </div>
        </Modal>
      ) : null}

      {overrideName ? (
        <Modal
          title={t('admin.pluginsPage.overrideConfirmTitle')}
          description={t('admin.pluginsPage.overrideConfirmDescription', { name: overrideName })}
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
                {t('admin.pluginsPage.riskConfirm')}
              </button>
            </>
          }
        >
          <div className="space-y-2 rounded-lg border border-rose-700 bg-rose-950/50 px-4 py-3 text-sm leading-6 text-rose-100">
            <p className="flex items-center gap-2 font-semibold">
              <AlertIcon className="h-5 w-5" />
              {t('admin.pluginsPage.overrideHint')}
            </p>
            <p className="text-xs">
              {t('admin.pluginsPage.overrideDetail')}
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
