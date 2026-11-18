
interface SimpleSecurityValue {
  enabled: boolean;
  maxLoginFailures: number;
  lockBaseMinutes: number;
  lockMaxMinutes: number;
  ipLoginLimit: number;
  ipWindowMinutes: number;
  ipLockMinutes: number;
  simpleRegisterLimit: number;
  renameEnabled: boolean;
  renameLimit: number;
  renameWindowHours: number;
  renameLockHours: number;
}

interface SimpleSecurityPanelProps {
  value: SimpleSecurityValue;
  onChange: (patch: Partial<SimpleSecurityValue>) => void;
  accounts: Array<{ id: number; username: string; status: string; lockedUntil: number | null; renameLimitedUntil: number | null }>;
  rateLimits: Array<{ ip: string; until: number; endpoint: string }>;
  onUnlock: (userId: number) => void;
  onClearRename: (userId: number) => void;
  onEnable: (userId: number) => void;
  onClearIp: (ip: string) => void;
}

const INPUT = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500';

function Field({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-[11px] text-slate-500">{label}
      <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className={INPUT} />
    </label>
  );
}

export function SimpleSecurityPanel({ value, onChange, accounts, rateLimits, onUnlock, onClearRename, onEnable, onClearIp }: SimpleSecurityPanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="mb-3 text-xs font-medium text-slate-300">账号锁定</p>
          <div className="space-y-3">
            <Field label="账号失败次数阈值" value={value.maxLoginFailures} min={3} max={50} onChange={(next) => onChange({ maxLoginFailures: next })} />
            <Field label="首次锁定分钟" value={value.lockBaseMinutes} min={1} max={1440} onChange={(next) => onChange({ lockBaseMinutes: next })} />
            <Field label="最长锁定分钟" value={value.lockMaxMinutes} min={1} max={10080} onChange={(next) => onChange({ lockMaxMinutes: next })} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="mb-3 text-xs font-medium text-slate-300">IP 限流</p>
          <div className="space-y-3">
            <Field label="IP 登录请求上限" value={value.ipLoginLimit} min={1} max={10000} onChange={(next) => onChange({ ipLoginLimit: next })} />
            <Field label="IP 统计窗口（分钟）" value={value.ipWindowMinutes} min={1} max={1440} onChange={(next) => onChange({ ipWindowMinutes: next })} />
            <Field label="IP 锁定时间（分钟）" value={value.ipLockMinutes} min={1} max={1440} onChange={(next) => onChange({ ipLockMinutes: next })} />
            <Field label="每 IP 每小时注册上限" value={value.simpleRegisterLimit} min={1} max={1000} onChange={(next) => onChange({ simpleRegisterLimit: next })} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="mb-3 text-xs font-medium text-slate-300">改名限制</p>
          <div className="space-y-3">
            <Field label="用户改名次数上限" value={value.renameLimit} min={1} max={100} onChange={(next) => onChange({ renameLimit: next })} />
            <Field label="改名统计窗口（小时）" value={value.renameWindowHours} min={1} max={8760} onChange={(next) => onChange({ renameWindowHours: next })} />
            <Field label="改名锁定时间（小时）" value={value.renameLockHours} min={1} max={8760} onChange={(next) => onChange({ renameLockHours: next })} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
        <p className="mb-1"><span className="text-slate-500">注册限流：</span>每 IP 每小时最多 {value.simpleRegisterLimit} 次</p>
        <span className="text-slate-500">当前限制：</span>{' '}
        {rateLimits.length === 0 && !accounts.some((user) => user.status === 'disabled' || (user.lockedUntil !== null && user.lockedUntil > Date.now()) || (user.renameLimitedUntil !== null && user.renameLimitedUntil > Date.now()))
          ? '无'
          : null}
        {accounts.filter((user) => user.status === 'disabled' || (user.lockedUntil !== null && user.lockedUntil > Date.now()) || (user.renameLimitedUntil !== null && user.renameLimitedUntil > Date.now())).map((user) => (
          <span key={user.id} className="mr-3 inline-flex items-center gap-1">
            <span className="text-slate-300">{user.username}</span>
            <span className="text-amber-400">{user.status === 'disabled' ? '已禁用' : user.renameLimitedUntil !== null && user.renameLimitedUntil > Date.now() ? '改名限制' : '登录锁定'}</span>
            <button type="button" onClick={() => void (user.renameLimitedUntil !== null && user.renameLimitedUntil > Date.now() ? onClearRename(user.id) : user.status === 'disabled' ? onEnable(user.id) : onUnlock(user.id))} className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800">解除</button>
          </span>
        ))}
        {rateLimits.map((entry) => (
          <span key={entry.ip} className="mr-3 inline-flex items-center gap-1">
            <span>{entry.ip}</span><span className="text-amber-400">IP 限流</span>
            <button type="button" onClick={() => onClearIp(entry.ip)} className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800">解除</button>
          </span>
        ))}
      </div>
    </div>
  );
}
