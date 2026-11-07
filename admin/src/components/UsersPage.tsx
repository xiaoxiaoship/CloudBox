import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { UserSummary, UserStatus } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import { ConfirmDialog, Modal, type ToastState } from './Dialog.tsx';
import {
  HardDriveIcon,
  KeyIcon,
  PlusIcon,
  PowerIcon,
  RefreshIcon,
  Spinner,
  TrashIcon,
  UnlockIcon,
  UsersIcon,
} from './Icons.tsx';
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
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

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
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">用户账户</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            创建普通用户、分配配额、重置密码或禁用账户
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'create' })}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-indigo-500"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            新建用户
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/40 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">配额</th>
                <th className="px-4 py-3 font-medium">已用</th>
                <th className="px-4 py-3 font-medium">最近登录</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500">
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
                users.map((user) => {
                  const locked = user.lockedUntil !== null && user.lockedUntil > Date.now();

                  return (
                  <tr key={user.id} className="transition hover:bg-slate-800/30">
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
                          <p className="text-[11px] text-slate-500">ID {user.id}</p>
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
                      {locked ? (
                        <span
                          className="inline-flex items-center gap-1.5 text-xs text-amber-300"
                          title={`锁定至 ${formatDate(user.lockedUntil)}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          已锁定
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs ${
                            user.status === 'active' ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              user.status === 'active' ? 'bg-emerald-400' : 'bg-slate-600'
                            }`}
                          />
                          {user.status === 'active' ? '正常' : '已禁用'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {user.quotaBytes === null ? '不限量' : formatBytes(user.quotaBytes)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {formatBytes(user.usedBytes)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {formatDate(user.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3">
                      {user.role === 'admin' ? (
                        <p className="text-right text-[11px] text-slate-600">当前账户</p>
                      ) : (
                        <div className="flex justify-end gap-0.5">
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
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await call(api.users.remove({ userId: user.id, deleteFiles }));
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
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
            onClick={() => void submit()}
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
  );
}
