import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type GuestLinkView } from '../api/client.ts';
import { useAppStore } from '../store/useAppStore.ts';
import { DialogShell } from './Dialog.tsx';

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy failed');
}

export function UserSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const user = useAppStore((state) => state.user);
  const renameAccount = useAppStore((state) => state.renameAccount);
  const uploadAvatar = useAppStore((state) => state.uploadAvatar);
  const [username, setUsername] = useState(user?.username ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [guestEnabled, setGuestEnabled] = useState(false);
  const [guestAddressMode, setGuestAddressMode] = useState<'auto' | 'public'>('auto');
  const [allowDirectShare, setAllowDirectShare] = useState(false);
  const [shares, setShares] = useState<Array<{ id: number; token: string; path: string; url: string; file_path: string; expires_at: number; created_at: number; expired: boolean }>>([]);
  const [sharesPending, setSharesPending] = useState(false);
  const [guestLink, setGuestLink] = useState<GuestLinkView | null>(null);
  const [guestPassword, setGuestPassword] = useState('');
  const [guestPending, setGuestPending] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestNotice, setGuestNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await api.publicSettings();
        if (cancelled) return;
        const enabled = settings.permissions.allow_guest_mode === true;
        setGuestEnabled(enabled);
        setGuestAddressMode(settings.guest_address_mode);
        const directShareEnabled = settings.permissions.allow_user_direct_share === true;
        setAllowDirectShare(directShareEnabled);
        if (directShareEnabled) {
          setShares(await api.listShares());
        }
        if (!enabled) return;
        const status = await api.guestStatus();
        if (cancelled) return;
        setGuestLink(status.link);
      } catch {
        // 公开设置/访客状态读取失败时静默隐藏区块
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveName = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try { await renameAccount(username.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : '改名失败'); } finally { setPending(false); }
  };

  const changeAvatar = async (file: File): Promise<void> => {
    setPending(true);
    setError(null);
    try { await uploadAvatar(file); } catch (cause) { setError(cause instanceof Error ? cause.message : '头像上传失败'); } finally { setPending(false); }
  };

  const createGuestLink = async (password: string): Promise<void> => {
    setGuestPending(true);
    setGuestError(null);
    setGuestNotice(null);
    try {
      const link = await api.createGuestLink(password);
      setGuestLink(link);
      setGuestPassword('');
      setGuestNotice('访客链接已生成，旧链接已失效');
    } catch (cause) {
      setGuestError(cause instanceof Error ? cause.message : '生成访客链接失败');
    } finally {
      setGuestPending(false);
    }
  };

  const revokeShare = async (id: number): Promise<void> => {
    setSharesPending(true);
    try { await api.revokeShare(id); setShares((current) => current.filter((share) => share.id !== id)); }
    catch (cause) { setGuestError(cause instanceof Error ? cause.message : '删除分享失败'); }
    finally { setSharesPending(false); }
  };

  const revokeGuestLink = async (): Promise<void> => {
    setGuestPending(true);
    setGuestError(null);
    setGuestNotice(null);
    try {
      await api.revokeGuestLink();
      setGuestLink(null);
      setGuestNotice('访客链接已撤销，所有访客会话立即失效');
    } catch (cause) {
      setGuestError(cause instanceof Error ? cause.message : '撤销访客链接失败');
    } finally {
      setGuestPending(false);
    }
  };

  const copyGuestLink = async (): Promise<void> => {
    if (guestLink === null) return;
    try {
      await copyText(guestLink.url);
      setGuestNotice('链接已复制到剪贴板');
    } catch {
      setGuestError('复制失败，请手动选择链接复制');
    }
  };

  return (
    <DialogShell
      title="用户设置"
      description="账号信息、头像与个人显示设置。"
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">关闭</button>}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void changeAvatar(file); }} />
          <button type="button" onClick={() => fileInput.current?.click()} className="h-14 w-14 overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 text-lg font-semibold text-white" title="更换头像">
            {user?.avatarDataUrl ? <img src={user.avatarDataUrl} alt="" className="h-full w-full object-cover" /> : (user?.displayName || user?.username || 'U').slice(0, 1).toUpperCase()}
          </button>
          <div className="text-xs text-slate-500">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{user?.displayName || user?.username}</p>
            <p>{user?.role === 'admin' ? '管理员' : '普通用户'}</p>
          </div>
        </div>
        <label className="block text-xs text-slate-500">用户名
          <div className="mt-1 flex gap-2">
            <input value={username} onChange={(event) => setUsername(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <button type="button" onClick={() => void saveName()} disabled={pending || !username.trim()} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-50">保存</button>
          </div>
        </label>
        {error ? <p className="text-xs text-rose-500">{error}</p> : null}

        {guestEnabled ? (
          <section className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700" aria-label="访客模式">
            <div>
              <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100">访客模式</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                生成只读访客链接，访客只能预览与下载，不能上传、删除、改名或分享。链接有效期由管理员设置。
              </p>
            </div>

            {guestLink !== null ? (
              <div className="space-y-2">
                <div>
                  <p className="mb-1 text-[11px] text-slate-500">{guestAddressMode === 'public' ? '公网地址（固定 IP/域名）' : '自动地址（当前 IP/域名）'}</p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={guestLink.url}
                      onFocus={(event) => event.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                      aria-label="访客链接"
                    />
                    <button type="button" onClick={() => void copyGuestLink()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">复制</button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {guestLink.expiresAt === 0 ? '永久有效' : `有效期至 ${new Date(guestLink.expiresAt).toLocaleString('zh-CN')}`}
                  {guestLink.hasPassword ? ' · 已设置访问密码' : ' · 无访问密码'}
                </p>
                <label className="block text-xs text-slate-500">访问密码
                  <div className="mt-1 flex gap-2">
                    <input
                      type="password"
                      value={guestPassword}
                      onChange={(event) => setGuestPassword(event.target.value)}
                      maxLength={128}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      placeholder={guestLink.hasPassword ? '输入新密码以更新' : '留空则保持无密码，或输入密码'}
                    />
                    <button type="button" onClick={() => void createGuestLink(guestPassword)} disabled={guestPending || (guestLink.hasPassword && guestPassword === '')} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-50">
                      {guestLink.hasPassword ? '更新密码' : '设置密码'}
                    </button>
                  </div>
                </label>
                <div className="flex flex-wrap gap-2">
                  {guestLink.hasPassword ? (
                    <button type="button" onClick={() => void createGuestLink('')} disabled={guestPending} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">清除密码</button>
                  ) : null}
                  <button type="button" onClick={() => void revokeGuestLink()} disabled={guestPending} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-600 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400">撤销链接</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs text-slate-500">访问密码（可选，留空表示无密码）
                  <input
                    type="password"
                    value={guestPassword}
                    onChange={(event) => setGuestPassword(event.target.value)}
                    maxLength={128}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    placeholder="留空则任何人凭链接直接访问"
                  />
                </label>
                <button type="button" onClick={() => void createGuestLink(guestPassword)} disabled={guestPending} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-50">生成访客链接</button>
              </div>
            )}

            {guestLink === null && guestPassword !== '' ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">留空密码并点击生成，即可创建无密码链接。</p>
            ) : null}

            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              访客只能预览与下载。重新生成或撤销后，旧链接以及所有已解锁的访客会话都会立即失效。
            </p>

            {guestNotice ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{guestNotice}</p> : null}
            {guestError ? <p className="text-xs text-rose-500">{guestError}</p> : null}
          </section>
        ) : null}

        {allowDirectShare ? (
          <section className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700" aria-label={t('userSettings.myShares')}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('userSettings.myShares')}</h3>
              <span className="text-[11px] text-slate-500">{t('userSettings.shareCount', { count: shares.length })}</span>
            </div>
            {shares.length === 0 ? <p className="text-xs text-slate-500">{t('userSettings.noShares')}</p> : (
              <ul className="max-h-72 space-y-2 overflow-auto">
                {shares.map((share) => (
                  <li key={share.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={share.file_path}>{share.file_path}</p>
                      <button type="button" disabled={sharesPending} onClick={() => void revokeShare(share.id)} className="shrink-0 text-[11px] text-rose-500 disabled:opacity-50">删除</button>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <input readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950" />
                      <button type="button" onClick={() => void copyText(share.url).then(() => setGuestNotice('分享链接已复制到剪贴板')).catch(() => setGuestError('复制失败，请手动选择链接复制'))} className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500 dark:border-slate-600">复制</button>
                    </div>
                    <p className={`mt-1 text-[11px] ${share.expired ? 'text-amber-500' : 'text-slate-500'}`}>{share.expired ? '已过期' : `有效期至 ${new Date(share.expires_at).toLocaleString('zh-CN')}`}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </DialogShell>
  );
}
