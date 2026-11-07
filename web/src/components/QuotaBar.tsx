import type { UsageInfo } from '../api/client.ts';
import { formatBytes, quotaPercent } from '../lib/format.ts';

export function QuotaBar({ usage }: { usage: UsageInfo | null }) {
  if (!usage) {
    return (
      <div className="w-full animate-pulse sm:w-64">
        <div className="h-3 w-40 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  const unlimited = usage.quotaBytes === null;
  const percent = quotaPercent(usage.usedBytes, usage.quotaBytes);
  const barColor =
    percent >= 90 ? 'bg-rose-500' : percent >= 70 ? 'bg-amber-500' : 'bg-indigo-500';

  return (
    <div className="w-full sm:w-64">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">存储空间</span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">
          {formatBytes(usage.usedBytes)}
          {unlimited ? ' · 不限量' : ` / ${formatBytes(usage.quotaBytes)}`}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={unlimited ? undefined : usage.quotaBytes ?? 0}
        aria-valuenow={usage.usedBytes}
        aria-label="存储空间使用情况"
      >
        {unlimited ? (
          <div className="h-full w-full bg-gradient-to-r from-indigo-200 to-sky-200 dark:from-indigo-500/40 dark:to-sky-500/40" />
        ) : (
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      {!unlimited && percent >= 90 ? (
        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
          空间即将用尽，请清理文件或联系管理员扩容
        </p>
      ) : null}
    </div>
  );
}
