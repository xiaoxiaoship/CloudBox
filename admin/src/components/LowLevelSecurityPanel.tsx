import { useMemo, useState } from 'react';
import type { LowLevelSecurity } from '../../../src/shared/lowLevelSecurity.ts';
import { DEFAULT_LOW_LEVEL_SECURITY } from '../../../src/shared/lowLevelSecurity.ts';
import { parsePolicy } from './SecurityPolicyPanel.tsx';
import { ConfirmDialog, Modal } from './Dialog.tsx';
import { SettingsIcon } from './Icons.tsx';

type NumericKey = {
  [K in keyof LowLevelSecurity]: LowLevelSecurity[K] extends number ? K : never;
}[keyof LowLevelSecurity];

interface Props {
  value: LowLevelSecurity;
  policyRaw: string;
  onChange: (value: LowLevelSecurity) => void;
}

const SECTIONS: Array<{
  title: string;
  hint: string;
  fields: Array<{ key: NumericKey; label: string; unit?: string; step?: number }>;
}> = [
  {
    title: '基础防护',
    hint: '这些限制在 WAF 策略之前执行；数值过小会先于策略拦截正常请求。',
    fields: [
      { key: 'apiRateLimit', label: '全局 API 限流', unit: '次/分钟' },
      { key: 'uploadRateLimit', label: '上传限流', unit: '次/分钟' },
      { key: 'shareRateLimit', label: '分享创建限流', unit: '次/分钟' },
      { key: 'shareDownloadRateLimit', label: '分享下载限流', unit: '次/分钟' },
      { key: 'extractRateLimit', label: '解压限流', unit: '次/分钟' },
      { key: 'scanRateLimit', label: '查杀限流', unit: '次/分钟' },
      { key: 'registrationLimit', label: 'IP 注册限制', unit: '次/小时' },
    ],
  },
  {
    title: 'IO 与资源',
    hint: '文件、预览、队列和查杀引擎的硬边界。修改后新请求立即生效。',
    fields: [
      { key: 'maxFileBytes', label: '单文件上传上限', unit: '字节' },
      { key: 'maxListEntries', label: '文件列表上限', unit: '项' },
      { key: 'maxBatchPaths', label: '批量操作上限', unit: '个' },
      { key: 'maxTextPreviewBytes', label: '文本预览上限', unit: '字节' },
      { key: 'maxConcurrentExtractions', label: '解压并发', unit: '个' },
      { key: 'maxConcurrentScans', label: '查杀并发', unit: '个' },
      { key: 'clamavMaxBytes', label: '本地 ClamAV 大小上限', unit: '字节' },
      { key: 'clamavTimeoutSeconds', label: '本地 ClamAV 超时', unit: '秒' },
      { key: 'uploadQueueConcurrency', label: '前端并发上传数', unit: '个' },
      { key: 'uploadDrainBytes', label: '上传排水上限', unit: '字节' },
      { key: 'shareMaxSeconds', label: '分享有效期上限', unit: '秒' },
    ],
  },
  {
    title: '生命周期与网络',
    hint: '部分网络参数在下次启动服务时生效；TLS 最低版本只允许 TLS 1.2/1.3。',
    fields: [
      { key: 'sessionTtlHours', label: 'Session 有效期', unit: '小时' },
      { key: 'onlineWindowSeconds', label: '在线判定窗口', unit: '秒' },
      { key: 'proxyTimeoutMs', label: 'PROXY 等待超时', unit: '毫秒' },
      { key: 'frpHealthTimeoutSeconds', label: 'frp 健康检查超时', unit: '秒' },
      { key: 'frpHealthIntervalSeconds', label: 'frp 健康检查间隔', unit: '秒' },
      { key: 'headersTimeoutMs', label: 'HTTP headers 超时', unit: '毫秒' },
      { key: 'requestTimeoutMs', label: 'HTTP request 超时', unit: '毫秒' },
    ],
  },
  {
    title: '插件与 IPC',
    hint: '插件进程超时；不会放宽插件沙箱边界。',
    fields: [
      { key: 'pluginStartTimeoutMs', label: '插件启动超时', unit: '毫秒' },
      { key: 'pluginRequestTimeoutMs', label: '插件请求超时', unit: '毫秒' },
    ],
  },
];

const RED_LINES = [
  'safePath 路径安全与符号链接/Junction 拒绝',
  'CSRF 双提交校验',
  '密码策略与 scrypt 参数',
  '解压文件数/总大小/5 分钟超时基础阈值',
  'JSON 请求体 1MB 上限',
  'Cookie HttpOnly 与 HTTPS Secure',
];

export function LowLevelSecurityPanel({ value, policyRaw, onChange }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<LowLevelSecurity>(value);

  const conflict = useMemo(() => {
    const policy = parsePolicy(policyRaw);
    const apiRule = policy.rules.find((rule) => rule.feature === 'apiFlood');
    const registrationRule = policy.rules.find((rule) => rule.feature === 'registrationLimit');
    const messages: string[] = [];
    if (apiRule && Number(apiRule.config.threshold ?? 0) > draft.apiRateLimit) {
      messages.push(`API 泛洪阈值 ${apiRule.config.threshold} 次/分钟高于底层 ${draft.apiRateLimit} 次/分钟，底层会先返回 429。`);
    }
    if (registrationRule && Number(registrationRule.config.threshold ?? 0) > draft.registrationLimit) {
      messages.push(`注册策略阈值高于底层 IP 注册限制，底层会先拦截。`);
    }
    return messages;
  }, [draft, policyRaw]);

  const openEditor = (): void => {
    setDraft(value);
    setConfirmOpen(false);
    setEditorOpen(true);
  };

  const update = (key: NumericKey, raw: string): void => {
    const parsed = Number(raw);
    setDraft((current) => ({ ...current, [key]: Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : current[key] }));
  };

  return (
    <>
      <div className="rounded-2xl border border-rose-900/60 bg-rose-950/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <SettingsIcon className="mt-0.5 h-5 w-5 text-rose-400" />
            <div>
              <h2 className="text-sm font-semibold text-rose-200">底层安全控制</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-rose-300/80">
                这些是独立于 WAF 策略引擎的物理限制。默认全开，不建议修改；改小可能让底层限制先于策略拦截合法请求。
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setConfirmOpen(true)} className="rounded-xl border border-rose-700 bg-rose-600/20 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-600/30">
            查看并调整
          </button>
        </div>
        {conflict.length > 0 ? (
          <div className="mt-3 rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-200">
            {conflict.map((message) => <p key={message}>{message}</p>)}
          </div>
        ) : null}
      </div>

      {confirmOpen ? (
        <ConfirmDialog
          title="确认进入底层安全控制？"
          description={<div className="space-y-2"><p>底层限制先于 WAF 策略执行，修改后可能导致正常用户被限流、上传失败或插件无法启动。</p><p className="font-semibold text-rose-300">除非明确知道影响，否则请保持默认值。</p></div>}
          confirmLabel="我已了解，继续"
          danger
          onClose={() => setConfirmOpen(false)}
          onConfirm={async () => { openEditor(); }}
        />
      ) : null}

      {editorOpen ? (
        <Modal
          title="底层安全控制"
          description="修改后需要点击“保存网络安全”生效；网络与插件超时在下次服务/插件启动时完全生效。"
          width="lg"
          onClose={() => setEditorOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setDraft({ ...DEFAULT_LOW_LEVEL_SECURITY })} className="rounded-lg border border-amber-700 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-950/40">恢复底层默认</button>
              <button type="button" onClick={() => setEditorOpen(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800">取消</button>
              <button type="button" onClick={() => { onChange(draft); setEditorOpen(false); }} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500">应用到底层设置</button>
            </>
          }
        >
          <div className="mb-4 rounded-xl border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs leading-5 text-rose-200">
            红色警告：这些参数没有 WAF 的策略预览、计数或自动恢复能力。请逐项确认后再保存。
          </div>
          <div className="space-y-6">
            {SECTIONS.map((section) => (
              <section key={section.title}>
                <h3 className="text-sm font-semibold text-slate-100">{section.title}</h3>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">{section.hint}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <label key={field.key} className="text-[11px] text-slate-400">
                      {field.label}{field.unit ? <span className="ml-1 text-slate-600">（{field.unit}）</span> : null}
                      <input type="number" min={1} step={field.step ?? 1} value={draft[field.key]} onChange={(event) => update(field.key, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500" />
                    </label>
                  ))}
                  {section.title === '生命周期与网络' ? (
                    <label className="text-[11px] text-slate-400">
                      TLS 最低版本
                      <select value={draft.tlsMinVersion} onChange={(event) => setDraft((current) => ({ ...current, tlsMinVersion: event.target.value as LowLevelSecurity['tlsMinVersion'] }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500">
                        <option value="TLSv1.2">TLS 1.2</option>
                        <option value="TLSv1.3">TLS 1.3</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              </section>
            ))}
          </div>

          <section className="mt-6 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">死守红线（仅展示，不可调整）</h3>
            <ul className="mt-2 grid gap-1 text-[11px] leading-5 text-slate-500 sm:grid-cols-2">
              {RED_LINES.map((line) => <li key={line}>• {line}</li>)}
            </ul>
          </section>
        </Modal>
      ) : null}
    </>
  );
}
