import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type {
  CaInfo,
  CertificateInfo,
  FrpConfig,
  FrpStatus,
  ServerStatus,
} from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import type { ToastState } from './Dialog.tsx';
import {
  AlertIcon,
  HardDriveIcon,
  RefreshIcon,
  ServerIcon,
  ShieldIcon,
  Spinner,
  WifiIcon,
} from './Icons.tsx';

interface NetworkPageProps {
  server: ServerStatus | null;
  refreshServer: () => Promise<void>;
  notify: (kind: ToastState['kind'], message: string) => void;
}

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-950';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50';

const SECONDARY_BUTTON =
  'inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50';

export function NetworkPage({ server, refreshServer, notify }: NetworkPageProps) {
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [portInput, setPortInput] = useState('');
  const [applying, setApplying] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [certPending, setCertPending] = useState<'cert' | 'key' | null>(null);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [qrData, setQrData] = useState<string | null>(null);

  const [ca, setCa] = useState<CaInfo | null>(null);
  const [caOpen, setCaOpen] = useState(false);
  const [caPending, setCaPending] = useState<string | null>(null);
  const [mtls, setMtls] = useState(false);
  const [trustProxy, setTrustProxy] = useState(false);
  const [trustProxyPending, setTrustProxyPending] = useState(false);

  const [frp, setFrp] = useState<FrpStatus | null>(null);
  const [frpConfig, setFrpConfig] = useState<FrpConfig>({
    serverAddr: '',
    serverPort: 7000,
    remotePort: 0,
    token: '',
    user: '',
    proxyName: 'cloudbox',
    tunnelType: 'tcp',
    customDomain: '',
    proxyProtocol: false,
  });
  const [frpPending, setFrpPending] = useState<string | null>(null);
  const frpLoaded = useRef(false);

  useEffect(() => {
    if (!server) return;
    setProtocol(server.httpsEnabled ? 'https' : 'http');
    setPortInput(String(server.port));
    setMtls(server.mtlsEnabled);
  }, [server?.port, server?.httpsEnabled, server?.mtlsEnabled]);

  const refreshCa = useCallback(async (): Promise<void> => {
    try {
      setCa(await call(api.ca.info()));
    } catch {
      // 保持最后一次状态
    }
  }, []);

  useEffect(() => {
    void refreshCa();
  }, [refreshCa]);

  useEffect(() => {
    let active = true;
    void call(api.settings.get())
      .then((settings) => {
        if (active) setTrustProxy(settings.trustProxy);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const toggleTrustProxy = async (enabled: boolean): Promise<void> => {
    setTrustProxyPending(true);
    try {
      const settings = await call(api.settings.setTrustProxy({ enabled }));
      setTrustProxy(settings.trustProxy);
      notify(
        'success',
        enabled
          ? '已开启信任反向代理真实 IP'
          : '已关闭信任反向代理真实 IP',
      );
      await refreshServer();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setTrustProxyPending(false);
    }
  };

  const refreshFrp = useCallback(async (): Promise<void> => {
    try {
      const status = await call(api.frp.status());
      setFrp(status);
      if (!frpLoaded.current) {
        frpLoaded.current = true;
        setFrpConfig(status.config);
      }
    } catch {
      // 轮询失败保持最后一次状态
    }
  }, []);

  useEffect(() => {
    void refreshFrp();
    const timer = window.setInterval(() => {
      void refreshFrp();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshFrp]);

  const urls = server?.running
    ? [
        `${server.protocol}://127.0.0.1:${server.port}`,
        ...server.urls.filter((url) => !url.includes('127.0.0.1')),
      ]
    : [];

  useEffect(() => {
    if (urls.length === 0) {
      setSelectedUrl('');
      return;
    }
    if (!urls.includes(selectedUrl)) {
      // 优先选择局域网地址，二维码才能被手机扫描访问
      const preferred = server?.urls.find((url) => !url.includes('127.0.0.1')) ?? urls[0]!;
      setSelectedUrl(preferred);
    }
  }, [server?.protocol, server?.port, server?.running, selectedUrl, urls]);

  useEffect(() => {
    let active = true;
    if (!selectedUrl) {
      setQrData(null);
      return;
    }

    void QRCode.toDataURL(selectedUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (active) setQrData(dataUrl);
      })
      .catch(() => {
        if (active) setQrData(null);
      });

    return () => {
      active = false;
    };
  }, [selectedUrl]);

  const toggleOnline = async (): Promise<void> => {
    if (!server) return;
    setToggling(true);
    try {
      const updated = await call(api.server.setOnline({ enabled: !server.running }));
      notify('success', updated.running ? '在线模式已开启' : '在线模式已关闭');
      await refreshServer();
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshServer();
    } finally {
      setToggling(false);
    }
  };

  const applyNetwork = async (override?: {
    protocol?: 'http' | 'https';
    mtls?: boolean;
  }): Promise<void> => {
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
      notify('error', '端口必须是 1024-65535 之间的整数');
      return;
    }

    const nextProtocol = override?.protocol ?? protocol;
    const nextMtls = nextProtocol === 'https' ? (override?.mtls ?? mtls) : false;

    setApplying(true);
    try {
      const updated = await call(
        api.server.applyNetwork({
          protocol: nextProtocol,
          port,
          mtlsEnabled: nextMtls,
        }),
      );
      notify(
        'success',
        updated.running
          ? `网络设置已应用，服务已重启在 ${updated.port}`
          : `网络设置已保存（${updated.protocol.toUpperCase()} ${updated.port}）`,
      );
      await refreshServer();
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshServer();
    } finally {
      setApplying(false);
    }
  };

  const importCertificate = async (kind: 'cert' | 'key'): Promise<void> => {
    setCertPending(kind);
    try {
      const result = await call(api.server.importCertificate({ kind }));
      if (!result.imported) return;
      // 单独导入证书或私钥时可能暂时不匹配；文件已写入，卡片会展示校验错误。
      notify('success', kind === 'cert' ? '证书已导入' : '私钥已导入');
      await refreshServer();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setCertPending(null);
    }
  };

  const createCA = async (): Promise<void> => {
    setCaPending('create');
    try {
      const info = await call(api.ca.create());
      setCa(info);
      notify('success', '私有 CA 已生成并安装到系统信任库');
      await refreshCa();
      await refreshServer();
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshCa();
    } finally {
      setCaPending(null);
    }
  };

  const installCA = async (): Promise<void> => {
    setCaPending('install');
    try {
      const info = await call(api.ca.install());
      setCa(info);
      notify('success', '私有 CA 已安装到系统信任库');
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshCa();
    } finally {
      setCaPending(null);
    }
  };

  const uninstallCA = async (): Promise<void> => {
    setCaPending('uninstall');
    try {
      const info = await call(api.ca.uninstall());
      setCa(info);
      notify('success', '已卸载，浏览器将不再信任该 CA');
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshCa();
    } finally {
      setCaPending(null);
    }
  };

  const issueServerCert = async (): Promise<void> => {
    setCaPending('issue');
    try {
      await call(api.ca.issueServerCert());
      setProtocol('https');
      await refreshCa();
      notify('success', '服务端证书已签发，正在应用 HTTPS 配置');
      await applyNetwork({ protocol: 'https' });
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshCa();
    } finally {
      setCaPending(null);
    }
  };

  const exportClientCert = async (): Promise<void> => {
    setCaPending('client');
    try {
      const result = await call(api.ca.exportClientCert());
      if (result.saved) {
        notify(
          'success',
          result.password
            ? `客户端证书已导出：${result.fileName}（PKCS#12 密码：${result.password}）`
            : `客户端证书已导出：${result.fileName}`,
        );
      }
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setCaPending(null);
    }
  };

  const updateFrpConfig = <K extends keyof FrpConfig>(key: K, value: FrpConfig[K]): void => {
    setFrpConfig((current) => ({ ...current, [key]: value }));
  };

  const saveFrp = async (): Promise<void> => {
    setFrpPending('save');
    try {
      const status = await call(api.frp.saveConfig(frpConfig));
      setFrp(status);
      notify('success', status.running ? 'frp 配置已保存并热重载' : 'frp 配置已保存');
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setFrpPending(null);
      await refreshFrp();
    }
  };

  const controlFrp = async (action: 'start' | 'stop' | 'restart'): Promise<void> => {
    setFrpPending(action);
    try {
      const status = await call(api.frp[action]());
      setFrp(status);
      notify('success', action === 'stop' ? 'frp 已停止' : 'frp 已启动');
      if (status.running && action !== 'stop') {
        setFrpConfig(status.config);
      }
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshFrp();
    } finally {
      setFrpPending(null);
    }
  };

  const certificate: CertificateInfo | null = server?.certificate ?? null;
  const httpsSelected = protocol === 'https';

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                server?.running
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <ServerIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">本地 Web 服务</h2>
              <p className="mt-1 text-xs text-slate-500">
                {server?.running
                  ? `运行中 · ${server.protocol.toUpperCase()} · 0.0.0.0:${server.port}`
                  : '离线模式：不监听端口，仅本机管理'}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={server?.running ?? false}
            aria-label="在线模式"
            disabled={toggling || !server}
            onClick={() => void toggleOnline()}
            className={`relative h-7 w-12 rounded-full transition ${
              server?.running ? 'bg-emerald-500' : 'bg-slate-700'
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                server?.running ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        {server?.error ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {server.error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              传输协议
            </p>
            <div className="mt-2 inline-flex rounded-xl border border-slate-700 bg-slate-950 p-1">
              {(['http', 'https'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setProtocol(value)}
                  className={`rounded-lg px-4 py-1.5 text-xs font-medium transition ${
                    protocol === value
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {httpsSelected
                ? 'HTTPS 使用内置证书，frp 将以 TCP 方式透传 TLS 流量。'
                : 'HTTP 仅建议在可信局域网使用。'}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              监听端口
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1024}
                max={65535}
                value={portInput}
                onChange={(event) => setPortInput(event.target.value)}
                className={`${INPUT_CLASS} mt-0 flex-1`}
                aria-label="监听端口"
              />
              <button
                type="button"
                onClick={() => void applyNetwork()}
                disabled={applying}
                className={`${PRIMARY_BUTTON} shrink-0`}
              >
                {applying ? <Spinner className="h-4 w-4" /> : null}
                应用并重启
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-slate-800 pt-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-slate-200">
                信任反向代理的真实 IP
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  trustProxy
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {trustProxy ? '已开启' : '已关闭'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              开启后限流将基于 X-Forwarded-For 头，适用于挂载了 frp 或 Nginx 的场景。
              注意：如果直连暴露端口，请保持关闭，防止伪造 IP 头绕过限流。
            </p>
            <p className="mt-1 text-[11px] text-slate-600">
              修改后如果服务正在运行，会自动重启 HTTP 服务以生效。
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={trustProxy}
            aria-label="信任反向代理的真实 IP"
            disabled={trustProxyPending}
            onClick={() => void toggleTrustProxy(!trustProxy)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${
              trustProxy ? 'bg-emerald-500' : 'bg-slate-700'
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                trustProxy ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        {httpsSelected ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] leading-5 text-amber-300">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            局域网自签证书会导致浏览器警告，公网请使用正式证书。启用 HTTPS 前需要同时导入证书与私钥。
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <ShieldIcon className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-100">TLS 证书</h2>
          {certificate?.configured ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
              已配置
            </span>
          ) : (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
              未配置
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          证书保存在数据目录 <code className="text-slate-400">config/ssl/server.crt</code> 与{' '}
          <code className="text-slate-400">server.key</code>。导入后需点击上方“应用并重启”生效。
          也可以手动导入已有证书，与一键生成互不冲突。
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            {certificate?.configured ? (
              <div className="space-y-1 text-[11px] text-slate-400">
                <p>
                  <span className="text-slate-500">主题：</span>
                  {certificate.subject ?? '—'}
                </p>
                <p>
                  <span className="text-slate-500">有效期至：</span>
                  {certificate.validTo
                    ? new Date(certificate.validTo).toLocaleString('zh-CN')
                    : '—'}
                </p>
                <p className="truncate">
                  <span className="text-slate-500">指纹：</span>
                  {certificate.fingerprint ?? '—'}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                尚未同时导入证书与私钥。支持 .crt / .pem / .cer 与 .key。
              </p>
            )}
            {certificate?.error ? (
              <p className="mt-2 text-[11px] text-rose-400">{certificate.error}</p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void importCertificate('cert')}
              disabled={certPending !== null}
              className={SECONDARY_BUTTON}
            >
              {certPending === 'cert' ? <Spinner className="h-3.5 w-3.5" /> : null}
              导入证书
            </button>
            <button
              type="button"
              onClick={() => void importCertificate('key')}
              disabled={certPending !== null}
              className={SECONDARY_BUTTON}
            >
              {certPending === 'key' ? <Spinner className="h-3.5 w-3.5" /> : null}
              导入私钥
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <button
          type="button"
          onClick={() => setCaOpen((open) => !open)}
          aria-expanded={caOpen}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <ShieldIcon className="h-4 w-4 text-indigo-400" />
            <span className="text-sm font-semibold text-slate-100">私有 CA 证书生成</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                ca?.exists
                  ? 'bg-indigo-500/15 text-indigo-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {ca?.exists ? '已生成' : '未生成'}
            </span>
            {ca?.exists ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  ca.installed
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {ca.installed ? '已安装信任' : '未安装信任'}
              </span>
            ) : null}
          </span>
          <span className="text-xs text-slate-500">{caOpen ? '收起' : '展开'}</span>
        </button>

        {caOpen ? (
          <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
            <p className="text-xs leading-5 text-slate-500">
              一键创建独立私有 CA，并用它签发本机服务端证书。生成、安装、卸载会修改系统信任库，
              可能需要管理员权限；若浏览器不信任该 CA，请重新执行“安装 CA”。
            </p>

            {ca?.exists ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px] text-slate-400">
                <p>
                  <span className="text-slate-500">CA 主题：</span>
                  {ca.subject ?? '—'}
                </p>
                <p className="mt-1">
                  <span className="text-slate-500">有效期至：</span>
                  {ca.validTo ? new Date(ca.validTo).toLocaleString('zh-CN') : '—'}
                </p>
                <p className="mt-1 break-all">
                  <span className="text-slate-500">SHA-256：</span>
                  {ca.fingerprint ?? '—'}
                </p>
                {ca.error ? <p className="mt-2 text-rose-400">{ca.error}</p> : null}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                尚未生成 CA。生成后会自动安装到系统信任库，并显示指纹与有效期。
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {!ca?.exists ? (
                <button
                  type="button"
                  onClick={() => void createCA()}
                  disabled={caPending !== null}
                  className={PRIMARY_BUTTON}
                >
                  {caPending === 'create' ? <Spinner className="h-4 w-4" /> : null}
                  一键生成私有 CA
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void issueServerCert()}
                    disabled={caPending !== null}
                    className={PRIMARY_BUTTON}
                  >
                    {caPending === 'issue' ? <Spinner className="h-4 w-4" /> : null}
                    签发服务端证书
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportClientCert()}
                    disabled={caPending !== null}
                    className={SECONDARY_BUTTON}
                  >
                    {caPending === 'client' ? <Spinner className="h-3.5 w-3.5" /> : null}
                    导出客户端证书
                  </button>
                  {!ca.installed ? (
                    <button
                      type="button"
                      onClick={() => void installCA()}
                      disabled={caPending !== null}
                      className={SECONDARY_BUTTON}
                    >
                      {caPending === 'install' ? <Spinner className="h-3.5 w-3.5" /> : null}
                      安装 CA
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void uninstallCA()}
                      disabled={caPending !== null}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-900/60 px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-950/30 disabled:opacity-50"
                    >
                      {caPending === 'uninstall' ? <Spinner className="h-3.5 w-3.5" /> : null}
                      卸载私有 CA
                    </button>
                  )}
                </>
              )}
            </div>

            {ca?.exists ? (
              <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px] leading-5 text-slate-400">
                <input
                  type="checkbox"
                  checked={mtls}
                  onChange={(event) => setMtls(event.target.checked)}
                  disabled={caPending !== null}
                  aria-label="要求客户端证书（mTLS）"
                  className="mt-0.5 h-4 w-4 accent-indigo-500"
                />
                <span>
                  <strong className="text-slate-200">要求客户端证书（mTLS）</strong>
                  <br />
                  开启后浏览器必须导入“导出客户端证书”生成的 PKCS#12 文件；密码为{' '}
                  <code className="text-slate-300">changeit</code>。修改后点击上方“应用并重启”。
                </span>
              </label>
            ) : null}

            <p className="text-[11px] text-slate-500">
              卸载只从系统信任库移除，CA 与服务端证书文件仍保留在数据目录，可随时重新安装。
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <WifiIcon className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-100">访问地址与二维码</h2>
        </div>

        {server?.running && urls.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="space-y-2">
              {urls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setSelectedUrl(url)}
                  className={`block w-full truncate rounded-lg px-3 py-2 text-left text-xs transition ${
                    selectedUrl === url
                      ? 'border border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
                      : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {url}
                </button>
              ))}
              <p className="text-[11px] text-slate-500">
                手机与电脑需处于同一局域网；公网访问请配置下方 frp。
              </p>
            </div>

            <div className="flex flex-col items-center gap-2">
              {qrData ? (
                <img
                  src={qrData}
                  alt={`扫码访问 ${selectedUrl}`}
                  className="h-[180px] w-[180px] rounded-xl bg-white p-2 shadow"
                />
              ) : (
                <div className="flex h-[180px] w-[180px] items-center justify-center rounded-xl bg-slate-950 text-slate-600">
                  <HardDriveIcon className="h-8 w-8" />
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">开启在线模式后生成访问地址与二维码。</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <WifiIcon className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-slate-100">frp 内网穿透</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  frp?.running
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {frp?.running ? `运行中 · PID ${frp.pid}` : '未运行'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {frpConfig.tunnelType === 'tcp'
                ? `当前使用 TCP 隧道指向本地 ${server?.protocol.toUpperCase() ?? 'HTTP'} 端口；TCP 本身不携带 X-Forwarded-For。`
                : `当前使用 ${frpConfig.tunnelType.toUpperCase()} 隧道，frps 会注入 X-Forwarded-For，请同时开启“信任反向代理的真实 IP”。`}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-amber-300">
              静态托管统一挂载在 <code>/host/</code>，frp 必须选择 HTTP 或 HTTPS，并使用 locations
              <code> ["/", "/host"] </code>（或通配域名）复用同一端口；不要为托管单独开 TCP 端口。
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void controlFrp('start')}
              disabled={!frp?.available || frp?.running || frpPending !== null}
              className={SECONDARY_BUTTON}
            >
              {frpPending === 'start' ? <Spinner className="h-3.5 w-3.5" /> : null}
              启动
            </button>
            <button
              type="button"
              onClick={() => void controlFrp('stop')}
              disabled={!frp?.running || frpPending !== null}
              className={SECONDARY_BUTTON}
            >
              {frpPending === 'stop' ? <Spinner className="h-3.5 w-3.5" /> : null}
              停止
            </button>
            <button
              type="button"
              onClick={() => void controlFrp('restart')}
              disabled={!frp?.running || frpPending !== null}
              className={SECONDARY_BUTTON}
            >
              {frpPending === 'restart' ? <Spinner className="h-3.5 w-3.5" /> : null}
              重启
            </button>
          </div>
        </div>

        {!frp?.available ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] leading-5 text-amber-300">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            未找到 frpc.exe。请将 frpc.exe 放入项目的 resources/bin/ 目录后重新运行
            npm run build:desktop 与 dist:win；打包版会从 resources/bin 读取。
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="frp-server">
              frps 地址
            </label>
            <input
              id="frp-server"
              value={frpConfig.serverAddr}
              onChange={(event) => updateFrpConfig('serverAddr', event.target.value)}
              className={INPUT_CLASS}
              placeholder="例如：frp.example.com"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="frp-server-port">
              frps 端口
            </label>
            <input
              id="frp-server-port"
              type="number"
              value={frpConfig.serverPort}
              onChange={(event) => updateFrpConfig('serverPort', Number(event.target.value))}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="frp-type">
              隧道类型
            </label>
            <select
              id="frp-type"
              value={frpConfig.tunnelType}
              onChange={(event) =>
                updateFrpConfig(
                  'tunnelType',
                  event.target.value as FrpConfig['tunnelType'],
                )
              }
              className={INPUT_CLASS}
            >
              <option value="http">HTTP（推荐，自动带 X-Forwarded-For）</option>
              <option value="https">HTTPS（frps 终止 TLS）</option>
              <option value="tcp">TCP（原始端口，需 PROXY protocol 才能识别 IP）</option>
            </select>
          </div>
          {frpConfig.tunnelType === 'tcp' ? (
            <div>
              <label className="text-[11px] text-slate-500" htmlFor="frp-remote-port">
                公网映射端口
              </label>
              <input
                id="frp-remote-port"
                type="number"
                value={frpConfig.remotePort}
                onChange={(event) => updateFrpConfig('remotePort', Number(event.target.value))}
                className={INPUT_CLASS}
              />
            </div>
          ) : (
            <div>
              <label className="text-[11px] text-slate-500" htmlFor="frp-domain">
                自定义域名
              </label>
              <input
                id="frp-domain"
                value={frpConfig.customDomain}
                onChange={(event) => updateFrpConfig('customDomain', event.target.value)}
                className={INPUT_CLASS}
                placeholder="例如：cloud.example.com"
              />
            </div>
          )}
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="frp-token">
              token（可选）
            </label>
            <input
              id="frp-token"
              type="password"
              value={frpConfig.token}
              onChange={(event) => updateFrpConfig('token', event.target.value)}
              className={INPUT_CLASS}
              placeholder="与 frps 的 auth.token 一致"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="frp-user">
              用户令牌 user
            </label>
            <input
              id="frp-user"
              type="password"
              value={frpConfig.user}
              onChange={(event) => updateFrpConfig('user', event.target.value)}
              className={INPUT_CLASS}
              placeholder="面板配置中的顶层 user 字段"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="frp-name">
              代理名称
            </label>
            <input
              id="frp-name"
              value={frpConfig.proxyName}
              onChange={(event) => updateFrpConfig('proxyName', event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void saveFrp()}
              disabled={frpPending !== null}
              className={`${PRIMARY_BUTTON} w-full`}
            >
              {frpPending === 'save' ? <Spinner className="h-4 w-4" /> : null}
              保存配置{frp?.running ? '并热重载' : ''}
            </button>
          </div>
        </div>

        {frpConfig.tunnelType === 'tcp' ? (
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] leading-5 text-slate-400">
            <input
              type="checkbox"
              checked={frpConfig.proxyProtocol}
              onChange={(event) =>
                updateFrpConfig('proxyProtocol', event.target.checked)
              }
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500"
            />
            <span>
              TCP 隧道启用 PROXY protocol v2（仅当本地服务支持时开启；Express 默认不解析该协议，推荐使用 HTTP 隧道）。
            </span>
          </label>
        ) : null}

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              frpc 日志
            </p>
            <button
              type="button"
              onClick={() => void refreshFrp()}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition hover:text-slate-300"
            >
              <RefreshIcon className="h-3 w-3" />
              刷新
            </button>
          </div>
          <pre className="mt-2 max-h-52 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-400">
            {frp?.logs.length ? frp.logs.join('\n') : '暂无日志'}
          </pre>
          <p className="mt-1 text-[10px] text-slate-600">配置：{frp?.configPath ?? '—'}</p>
        </div>
      </section>
    </div>
  );
}
