import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AnnouncementView, FrpStatus, UserIpHistoryEntry, UserSummary, UserStatus } from '../../../src/shared/ipcTypes.ts';
import { call, errorMessage } from '../api/ipc.ts';
import { useAdminApi } from '../api/AdminApiContext.tsx';
import { ConfirmDialog, Modal, type ToastState } from './Dialog.tsx';
import {
  HardDriveIcon,
  KeyIcon,
  PlusIcon,
  PowerIcon,
  ShieldIcon,
  RefreshIcon,
  Spinner,
  TrashIcon,
  UnlockIcon,
  UsersIcon,
} from './Icons.tsx';
import { autoT as t } from '../i18n.ts';
import { bytesToInput, formatBytes, formatDate, quotaToBytes } from '../lib/format.ts';

type DialogState =
  | { kind: 'create' }
  | { kind: 'quota'; user: UserSummary }
  | { kind: 'reset'; user: UserSummary }
  | { kind: 'status'; user: UserSummary }
  | { kind: 'delete'; user: UserSummary }
  | null;

interface UsersPageProps {
  notify: (kind: ToastState['kind'], message: string) => void;
}

export function UsersPage({ notify }: UsersPageProps) {
  const api = useAdminApi();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [query, setQuery] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortKey, setSortKey] = useState<'username' | 'status' | 'clients' | 'lastLogin' | 'ip' | 'quota' | 'used'>('username');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [securityPending, setSecurityPending] = useState<number | null>(null);
  const [batchPending, setBatchPending] = useState(false);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [ipUser, setIpUser] = useState<UserSummary | null>(null);
  const [ipHistory, setIpHistory] = useState<UserIpHistoryEntry[]>([]);
  const [ipHistoryLoading, setIpHistoryLoading] = useState(false);
  const [frpStatus, setFrpStatus] = useState<FrpStatus | null>(null);
  const [annCategory, setAnnCategory] = useState<'critical' | 'warning' | 'info'>('info');
  const [annAudience, setAnnAudience] = useState<'all' | 'user'>('all');
  const [annTarget, setAnnTarget] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPending, setAnnPending] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementView[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await call(api.users.list()));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void api.frp.status().then((value) => { if (value.ok) setFrpStatus(value.data); }).catch(() => {});
  }, []);

  const loadAnnouncements = useCallback(async (): Promise<void> => {
    try { setAnnouncements(await call(api.announcements.list())); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const ipVisible = !(frpStatus?.running && frpStatus.config.tunnelType !== 'http' && !frpStatus.config.proxyProtocol);
  const visibleUsers = [...users]
    .filter((user) => {
      const q = query.trim().toLowerCase();
      if (!ipVisible && /^[0-9a-f:.]+$/i.test(q)) return false;
      return !q || user.username.toLowerCase().includes(q) || String(user.id).includes(q) || user.displayName.toLowerCase().includes(q) || (user.ipAddresses ?? []).some((ip) => ip.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'username') return a.username.localeCompare(b.username) * dir;
      if (sortKey === 'lastLogin') return ((a.lastLoginAt ?? 0) - (b.lastLoginAt ?? 0)) * dir;
      if (sortKey === 'clients') return ((a.activeSessions ?? 0) - (b.activeSessions ?? 0)) * dir;
      if (sortKey === 'ip') return (a.onlineIp ?? a.lastIp ?? '').localeCompare(b.onlineIp ?? b.lastIp ?? '') * dir;
      if (sortKey === 'quota') return ((a.quotaBytes ?? Number.MAX_SAFE_INTEGER) - (b.quotaBytes ?? Number.MAX_SAFE_INTEGER)) * dir;
      if (sortKey === 'used') return (a.usedBytes - b.usedBytes) * dir;
      const rank = (u: UserSummary): number => (u.status === 'disabled' ? 2 : u.lockedUntil && u.lockedUntil > Date.now() ? 1 : 0);
      return (rank(a) - rank(b)) * dir;
    });
  const onlineCount = users.filter((user) => user.online).length;
  const abnormalCount = users.filter((user) => user.status === 'disabled' || (user.lockedUntil !== null && user.lockedUntil > Date.now())).length;
  const selectable = visibleUsers.filter((user) => user.role !== 'admin');
  const allSelected = selectable.length > 0 && selectable.every((user) => selected.includes(user.id));
  const toggleSort = (key: 'username' | 'status' | 'clients' | 'lastLogin' | 'ip' | 'quota' | 'used'): void => {
    if (sortKey === key) setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const openIpHistory = async (user: UserSummary): Promise<void> => {
    setIpUser(user);
    setIpHistory([]);
    setIpHistoryLoading(true);
    try { setIpHistory(await call(api.users.ipHistory({ userId: user.id }))); }
    catch (cause) { notify('error', errorMessage(cause)); }
    finally { setIpHistoryLoading(false); }
  };

  const toggleSecurity = async (user: UserSummary): Promise<void> => {
    setSecurityPending(user.id);
    try {
      await call(api.users.setSecurityMode({ userId: user.id, enabled: !user.securityMode }));
      notify('success', user.securityMode ? '已关闭安全模式' : '已开启安全模式');
      await refresh();
    } catch (cause) { notify('error', errorMessage(cause)); }
    finally { setSecurityPending(null); }
  };
  const applyBatch = async (action: 'enable' | 'disable' | 'delete'): Promise<void> => {
    if (selected.length === 0) return;
    setBatchPending(true);
    try {
      for (const id of selected) {
        const user = users.find((item) => item.id === id);
        if (!user || user.role === 'admin') continue;
        if (action === 'delete') await call(api.users.remove({ userId: id, deleteFiles: false }));
        else await call(api.users.setStatus({ userId: id, status: action === 'enable' ? 'active' : 'disabled' }));
      }
      notify('success', `已处理 ${selected.length} 个账户`);
      setSelected([]);
      await refresh();
    } catch (cause) { notify('error', errorMessage(cause)); }
    finally { setBatchPending(false); }
  };

  const publishAnnouncement = async (): Promise<void> => {
    setAnnPending(true);
    try {
      await call(api.announcements.create({
        category: annCategory,
        audience: annAudience,
        targetUserId: annAudience === 'user' ? Number(annTarget) : null,
        body: annBody,
      }));
      setAnnBody('');
      notify('success', '公告已发布');
      await loadAnnouncements();
    } catch (cause) { notify('error', errorMessage(cause)); }
    finally { setAnnPending(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-100">发布公告</h2>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-[11px] text-slate-500">类别
            <select value={annCategory} onChange={(event) => setAnnCategory(event.target.value as typeof annCategory)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="critical">关键</option><option value="warning">警告</option><option value="info">消息</option>
            </select>
          </label>
          <label className="text-[11px] text-slate-500">范围
            <select value={annAudience} onChange={(event) => setAnnAudience(event.target.value as typeof annAudience)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="all">全部公开</option><option value="user">指定用户</option>
            </select>
          </label>
          <label className="text-[11px] text-slate-500">目标用户
            <select value={annTarget} disabled={annAudience !== 'user'} onChange={(event) => setAnnTarget(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
              <option value="">请选择</option>
              {users.filter((user) => user.role !== 'admin').map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
            </select>
          </label>
        </div>
        <textarea value={annBody} onChange={(event) => setAnnBody(event.target.value)} rows={3} maxLength={5000} placeholder="公告内容" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => void publishAnnouncement()} disabled={annPending || annBody.trim() === '' || (annAudience === 'user' && !annTarget)} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{annPending ? '发布中…' : '发布公告'}</button>
        </div>
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="mb-2 text-[11px] font-medium text-slate-400">历史公告</p>
          {announcements.length === 0 ? <p className="text-xs text-slate-500">暂无历史公告</p> : (
            <ul className="max-h-72 space-y-2 overflow-auto">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={announcement.category === 'critical' ? 'text-rose-300' : announcement.category === 'warning' ? 'text-amber-300' : 'text-sky-300'}>{announcement.category === 'critical' ? '关键' : announcement.category === 'warning' ? '警告' : '消息'}</span>
                      <span className="text-slate-500">{announcement.audience === 'all' ? '全部公开' : `指定：${announcement.targetUsername ?? announcement.targetUserId ?? ''}`}</span>
                      <span className="text-slate-600">{formatDate(announcement.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-300">{announcement.body}</p>
                  </div>
                  <button type="button" onClick={() => void (async () => { try { await call(api.announcements.delete(announcement.id)); await loadAnnouncements(); notify('success', '公告已删除'); } catch (cause) { notify('error', errorMessage(cause)); } })()} className="shrink-0 text-[11px] text-rose-400 hover:text-rose-300">删除</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">用户账户</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            创建普通用户、分配配额、重置密码或禁用账户
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50">
            <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button type="button" onClick={() => setDialog({ kind: 'create' })} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-indigo-500">
            <PlusIcon className="h-3.5 w-3.5" />
            新建用户
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"><p className="text-[11px] text-slate-500">{t('注册账户')}</p><p className="mt-1 text-lg font-semibold text-slate-100">{users.length}</p></div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"><p className="text-[11px] text-slate-500">{t('当前在线')}</p><p className="mt-1 text-lg font-semibold text-emerald-300">{onlineCount}</p></div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"><p className="text-[11px] text-slate-500">{t('异常账户')}</p><p className="mt-1 text-lg font-semibold text-amber-300">{abnormalCount}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('搜索用户名或 ID')} placeholder={t('搜索用户名或 ID')} className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500" />
        <button type="button" onClick={() => { setBatchMode((value) => !value); setSelected([]); }} className={`rounded-lg border px-3 py-2 text-xs ${batchMode ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
          {batchMode ? t('退出批量处理') : t('批量处理')}
        </button>
        {batchMode ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-900/60 bg-indigo-950/20 px-2 py-1">
            <span className="px-2 text-xs text-indigo-300">{t('已选 {{count}} 人', { count: selected.length })}</span>
            <button type="button" disabled={batchPending} onClick={() => void applyBatch('enable')} className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50">{t('启用')}</button>
            <button type="button" disabled={batchPending} onClick={() => void applyBatch('disable')} className="rounded-md border border-amber-800 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-950/40 disabled:opacity-50">{t('禁用')}</button>
            <button type="button" disabled={batchPending} onClick={() => setBatchDeleteConfirm(true)} className="rounded-md border border-rose-800 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40 disabled:opacity-50">{t('删除')}</button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/40 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {batchMode ? <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="全选" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? selectable.map((user) => user.id) : [])} className="h-4 w-4 accent-indigo-500" /></th> : null}
                <th className="px-4 py-3 font-medium"><button type="button" onClick={() => toggleSort('username')} className="hover:text-slate-200">用户 {sortKey === 'username' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium"><button type="button" onClick={() => toggleSort('status')} className="hover:text-slate-200">状态 {sortKey === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th className="px-4 py-3 font-medium"><button type="button" onClick={() => toggleSort('clients')} className="hover:text-slate-200">连接客户端 {sortKey === 'clients' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th className="px-4 py-3 font-medium"><button type="button" onClick={() => toggleSort('quota')} className="hover:text-slate-200">配额 {sortKey === 'quota' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th className="px-4 py-3 font-medium"><button type="button" onClick={() => toggleSort('used')} className="hover:text-slate-200">已用 {sortKey === 'used' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                <th className="px-4 py-3 font-medium"><button type="button" onClick={() => toggleSort('lastLogin')} className="hover:text-slate-200">最近登录 {sortKey === 'lastLogin' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
                {ipVisible ? <th className="px-4 py-3 font-medium"><button type="button" onClick={() => toggleSort('ip')} className="hover:text-slate-200">登录 IP {sortKey === 'ip' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th> : null}
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loading && visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={ipVisible ? 10 : 9} className="px-4 py-10 text-center text-xs text-slate-500">
                    <Spinner className="mx-auto mb-2 h-5 w-5 text-indigo-400" />
                    正在加载用户…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <UsersIcon className="mx-auto h-8 w-8 text-slate-700" />
                    <p className="mt-2 text-xs text-slate-500">还没有普通用户</p>
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => {
                  const locked = user.lockedUntil !== null && user.lockedUntil > Date.now();

                  return (
                  <tr key={user.id} className="transition hover:bg-slate-800/30">
                    {batchMode ? <td className="px-3 py-3"><input type="checkbox" aria-label={`选择 ${user.username}`} checked={selected.includes(user.id)} disabled={user.role === 'admin'} onChange={(event) => setSelected((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} className="h-4 w-4 accent-indigo-500" /></td> : null}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-xs font-medium text-slate-300">
                          {user.avatarDataUrl ? (
                            <img
                              src={user.avatarDataUrl}
                              alt={user.displayName || user.username}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (user.displayName || user.username).slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-slate-200">{user.username}</p>
                          <p className="text-[11px] text-slate-500">ID {user.id}{user.securityMode ? ' · 安全模式' : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          user.role === 'admin'
                            ? 'bg-indigo-500/15 text-indigo-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {user.role === 'admin' ? '管理员' : '普通用户'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {user.status === 'disabled' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-rose-400"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" />已禁用</span>
                      ) : locked ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-300" title={`锁定至 ${formatDate(user.lockedUntil)}`}><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />锁定 {Math.max(1, Math.ceil(((user.lockedUntil ?? Date.now()) - Date.now()) / 60000))} 分钟</span>
                      ) : user.online ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />在线</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-600" />离线</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">{user.activeSessions ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {user.quotaBytes === null ? '不限量' : formatBytes(user.quotaBytes)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {formatBytes(user.usedBytes)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {formatDate(user.lastLoginAt)}
                    </td>
                    {ipVisible ? <td className="px-4 py-3 text-xs">
                      <button type="button" onClick={() => void openIpHistory(user)} className="rounded px-1.5 py-0.5 font-mono text-[11px] text-indigo-300 hover:bg-indigo-950/40" title="查看全部登录 IP">
                        {user.online ? user.onlineIp ?? user.lastIp ?? '—' : user.lastIp ?? '—'}
                      </button>
                    </td> : null}
                    <td className="px-4 py-3">
                      {user.role === 'admin' ? (
                        <p className="text-right text-[11px] text-slate-600">当前账户</p>
                      ) : (
                        <div className={`flex justify-end gap-0.5 ${batchMode ? 'invisible' : ''}`}>
                          <IconButton
                            label="分配配额"
                            onClick={() => setDialog({ kind: 'quota', user })}
                          >
                            <HardDriveIcon className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label="重置密码"
                            onClick={() => setDialog({ kind: 'reset', user })}
                          >
                            <KeyIcon className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label="解除锁定"
                            disabled={!locked}
                            active={locked}
                            onClick={() => {
                              void (async () => {
                                try {
                                  await call(api.users.unlock({ userId: user.id }));
                                  notify('success', '账号已解锁');
                                  await refresh();
                                } catch (cause) {
                                  notify('error', errorMessage(cause));
                                }
                              })();
                            }}
                          >
                            <UnlockIcon className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={user.status === 'active' ? '禁用账户' : '启用账户'}
                            onClick={() => setDialog({ kind: 'status', user })}
                          >
                            <PowerIcon className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={user.securityMode ? '关闭安全模式' : '开启安全模式'}
                            disabled={securityPending === user.id}
                            active={user.securityMode}
                            onClick={() => void toggleSecurity(user)}
                          >
                            <ShieldIcon className="h-4 w-4" />
                          </IconButton>

                          <IconButton
                            label="删除用户"
                            danger
                            onClick={() => setDialog({ kind: 'delete', user })}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dialog?.kind === 'create' ? (
        <CreateUserDialog
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            notify('success', '用户已创建');
            await refresh();
          }}
        />
      ) : null}

      {dialog?.kind === 'quota' ? (
        <QuotaDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            notify('success', '配额已更新');
            await refresh();
          }}
        />
      ) : null}

      {dialog?.kind === 'reset' ? (
        <ResetPasswordDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            notify('success', '密码已重置，该用户所有会话已下线');
            await refresh();
          }}
        />
      ) : null}

      {ipUser !== null ? (
        <Modal
          title={`登录 IP 记录 · ${ipUser.username}`}
          description="在线时显示当前 IP；离线时显示最近一次登录 IP。"
          onClose={() => setIpUser(null)}
          width="lg"
          footer={<button type="button" onClick={() => setIpUser(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">关闭</button>}
        >
          {ipHistoryLoading ? <p className="text-xs text-slate-500">加载中…</p> : ipHistory.length === 0 ? <p className="text-xs text-slate-500">暂无 IP 记录</p> : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2">IP</th><th className="px-3 py-2">首次登录</th><th className="px-3 py-2">最近登录</th><th className="px-3 py-2 text-right">次数</th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {ipHistory.map((entry) => <tr key={entry.ip}><td className="px-3 py-2 font-mono text-slate-300">{entry.ip}</td><td className="px-3 py-2 text-slate-400">{formatDate(entry.firstSeenAt)}</td><td className="px-3 py-2 text-slate-400">{formatDate(entry.lastSeenAt)}</td><td className="px-3 py-2 text-right text-slate-400">{entry.loginCount}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      ) : null}

      {dialog?.kind === 'status' ? (
        <ConfirmDialog
          title={dialog.user.status === 'active' ? '禁用账户' : '启用账户'}
          description={
            dialog.user.status === 'active'
              ? `禁用后「${dialog.user.username}」将立即被强制下线，且无法再登录。`
              : `启用后「${dialog.user.username}」可以重新登录。`
          }
          confirmLabel={dialog.user.status === 'active' ? '禁用' : '启用'}
          danger={dialog.user.status === 'active'}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await call(
              api.users.setStatus({
                userId: dialog.user.id,
                status: dialog.user.status === 'active' ? 'disabled' : 'active',
              }),
            );
            setDialog(null);
            notify('success', '账户状态已更新');
            await refresh();
          }}
        />
      ) : null}

      {batchDeleteConfirm ? (
        <ConfirmDialog
          title="再次确认批量删除"
          description={`确定删除选中的 ${selected.length} 个账户吗？账户记录会被删除，此操作不可恢复。`}
          confirmLabel="确认永久删除"
          danger
          onClose={() => setBatchDeleteConfirm(false)}
          onConfirm={async () => { setBatchDeleteConfirm(false); await applyBatch('delete'); }}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <DeleteUserDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            notify('success', '用户已删除');
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  danger = false,
  disabled = false,
  active = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded-lg p-1.5 transition ${
        disabled
          ? 'cursor-not-allowed text-slate-700'
          : active
            ? 'text-amber-300 hover:bg-amber-950/40 hover:text-amber-200'
            : danger
              ? 'text-slate-500 hover:bg-rose-950/40 hover:text-rose-300'
              : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-950';

const LABEL_CLASS = 'block text-xs text-slate-400';

const SECONDARY_BUTTON =
  'rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50';

const PRIMARY_BUTTON =
  'inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60';

function CreateUserDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const api = useAdminApi();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [unlimited, setUnlimited] = useState(false);
  const [quotaValue, setQuotaValue] = useState('5');
  const [unit, setUnit] = useState<'MB' | 'GB'>('GB');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const quotaBytes = unlimited ? null : quotaToBytes(Number(quotaValue), unit);
      if (!unlimited && (!Number.isFinite(Number(quotaValue)) || Number(quotaValue) < 0)) {
        throw new Error('请输入有效的配额数值');
      }
      await call(api.users.create({ username: username.trim(), password, quotaBytes }));
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="新建普通用户"
      description="用户可通过浏览器登录并管理自己的文件"
      onClose={pending ? () => {} : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={SECONDARY_BUTTON}>
            取消
          </button>
          <button type="submit" form="create-user-form" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? <Spinner className="h-4 w-4" /> : null}
            创建用户
          </button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={(event) => void submit(event)} className="space-y-4">
        <div>
          <label className={LABEL_CLASS} htmlFor="new-username">
            用户名
          </label>
          <input
            id="new-username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={INPUT_CLASS}
            placeholder="例如：alice"
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="new-password">
            初始密码
          </label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={INPUT_CLASS}
            placeholder="至少 8 位，含字母和数字"
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>容量配额</label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="number"
              min={0}
              step="any"
              disabled={unlimited}
              value={quotaValue}
              onChange={(event) => setQuotaValue(event.target.value)}
              className={`${INPUT_CLASS} mt-0 flex-1 disabled:opacity-40`}
            />
            <select
              value={unit}
              disabled={unlimited}
              onChange={(event) => setUnit(event.target.value as 'MB' | 'GB')}
              className="h-9 rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 outline-none disabled:opacity-40"
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(event) => setUnlimited(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500"
            />
            不限量
          </label>
        </div>

        {error ? (
          <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
        ) : null}
      </form>
    </Modal>
  );
}

function QuotaDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserSummary;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const api = useAdminApi();
  const initial = bytesToInput(user.quotaBytes);
  const [unlimited, setUnlimited] = useState(user.quotaBytes === null);
  const [value, setValue] = useState(initial.value || '5');
  const [unit, setUnit] = useState<'MB' | 'GB'>(initial.unit);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const quotaBytes = unlimited ? null : quotaToBytes(Number(value), unit);
      if (!unlimited && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        throw new Error('请输入有效的配额数值');
      }
      await call(api.users.setQuota({ userId: user.id, quotaBytes }));
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={`调整配额 · ${user.username}`}
      description={`当前已用 ${formatBytes(user.usedBytes)}`}
      onClose={pending ? () => {} : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={SECONDARY_BUTTON}>
            取消
          </button>
          <button type="submit" form="quota-form" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? <Spinner className="h-4 w-4" /> : null}
            保存
          </button>
        </>
      }
    >
      <form id="quota-form" onSubmit={(event) => void submit(event)}>
        <label className={LABEL_CLASS}>容量上限</label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="number"
            min={0}
            step="any"
            disabled={unlimited}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={`${INPUT_CLASS} mt-0 flex-1 disabled:opacity-40`}
          />
          <select
            value={unit}
            disabled={unlimited}
            onChange={(event) => setUnit(event.target.value as 'MB' | 'GB')}
            className="h-9 rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 outline-none disabled:opacity-40"
          >
            <option value="MB">MB</option>
            <option value="GB">GB</option>
          </select>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(event) => setUnlimited(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500"
          />
          不限量
        </label>

        {!unlimited && Number(value) * (unit === 'GB' ? 1024 ** 3 : 1024 ** 2) < user.usedBytes ? (
          <p className="mt-2 rounded-lg bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            新配额低于已用空间，用户将无法继续上传，但现有文件不会被删除。
          </p>
        ) : null}

        {error ? (
          <p className="mt-2 rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
        ) : null}
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserSummary;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const api = useAdminApi();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await call(api.users.resetPassword({ userId: user.id, newPassword: password }));
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={`重置密码 · ${user.username}`}
      description="重置后该用户所有会话将立即失效，下次登录需使用新密码。"
      onClose={pending ? () => {} : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={SECONDARY_BUTTON}>
            取消
          </button>
          <button type="submit" form="reset-form" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? <Spinner className="h-4 w-4" /> : null}
            重置密码
          </button>
        </>
      }
    >
      <form id="reset-form" onSubmit={(event) => void submit(event)} className="space-y-4">
        <div>
          <label className={LABEL_CLASS} htmlFor="reset-password">
            新密码
          </label>
          <input
            id="reset-password"
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={INPUT_CLASS}
            placeholder="至少 8 位，含字母和数字"
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="reset-confirm">
            确认密码
          </label>
          <input
            id="reset-confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        {error ? (
          <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
        ) : null}
      </form>
    </Modal>
  );
}

function DeleteUserDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserSummary;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const api = useAdminApi();
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doDelete = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await call(api.users.remove({ userId: user.id, deleteFiles }));
      await onDone();
    } catch (cause) {
      setConfirming(false);
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
    <Modal
      title={`删除用户 · ${user.username}`}
      description="此操作不可撤销，请确认。"
      onClose={pending ? () => {} : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={SECONDARY_BUTTON}>
            取消
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
          >
            {pending ? <Spinner className="h-4 w-4" /> : null}
            永久删除
          </button>
        </>
      }
    >
      <label className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={deleteFiles}
          onChange={(event) => setDeleteFiles(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-rose-500"
        />
        同时删除该用户的全部文件（{formatBytes(user.usedBytes)}）
      </label>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        若取消勾选，仅删除账户记录，用户目录会保留在磁盘上，后续可由管理员手动清理。
      </p>
      {error ? (
        <p className="mt-3 rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}
    </Modal>
    {confirming ? (
      <ConfirmDialog
        title={t('\u518d\u6b21\u786e\u8ba4\u5220\u9664')}
        description={t('\u786e\u5b9a\u8981\u5220\u9664\u8d26\u6237\u300c{{name}}\u300d\u5417\uff1f{{files}}\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002', { name: user.username, files: deleteFiles ? '\u8be5\u7528\u6237\u7684\u5168\u90e8\u6587\u4ef6\u4e5f\u4f1a\u88ab\u5220\u9664\uff0c' : '' })}
        confirmLabel={t('\u786e\u8ba4\u6c38\u4e45\u5220\u9664')}
        danger
        onClose={() => setConfirming(false)}
        onConfirm={doDelete}
      />
    ) : null}
    </>
  );
}
