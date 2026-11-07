import { useEffect, useMemo, useState } from 'react';
import { api, type AiSettings, type AiStreamEvent } from '../api/client.ts';
import { useTranslation } from 'react-i18next';
import { DialogShell } from './Dialog.tsx';
import { AlertIcon, SparklesIcon, Spinner, XIcon } from './Icons.tsx';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/```([\s\S]*?)```/g, '<pre class="my-2 overflow-x-auto rounded bg-slate-950 p-2 text-[11px]">$1</pre>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-800 px-1">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<p class="mt-2 font-semibold">$1</p>')
    .replace(/^## (.+)$/gm, '<p class="mt-2 text-base font-semibold">$1</p>')
    .replace(/\n/g, '<br />');
}

interface AiAssistantProps {
  enabled: boolean;
}

export function AiAssistant({ enabled }: AiAssistantProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    actionId: string;
    tool: string;
    args: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    void api.aiSettings().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'AI 配置不可用');
    });
  }, [open]);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || streaming) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setStreaming(true);
    setError(null);
    setPending(null);
    let assistant = '';
    try {
      await api.aiChat(
        next.map(({ role, content }) => ({ role, content })),
        (event: AiStreamEvent) => {
          if (event.type === 'content') {
            assistant += event.text ?? '';
            setMessages((current) => {
              const copy = [...current];
              const last = copy[copy.length - 1];
              if (last?.role === 'assistant') copy[copy.length - 1] = { role: 'assistant', content: assistant };
              else copy.push({ role: 'assistant', content: assistant });
              return copy;
            });
          } else if (event.type === 'confirmation') {
            setPending({
              actionId: event.actionId ?? '',
              tool: event.tool ?? '',
              args: event.args ?? {},
            });
          } else if (event.type === 'error') {
            setError(event.message ?? 'AI 请求失败');
          }
        },
        i18n.language,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 请求失败');
    } finally {
      setStreaming(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    try {
      const result = await api.confirmAiAction(pending.actionId);
      if (result.ok) {
        setMessages((current) => [...current, { role: 'assistant', content: `已执行 ${pending.tool}。` }]);
        setPending(null);
      } else {
        setError(result.error ?? '操作未执行');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '确认失败');
    }
  };

  const html = useMemo(() => messages.map((message) => ({ ...message, html: renderMarkdown(message.content) })), [messages]);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-950/30 transition hover:scale-105 hover:bg-indigo-500"
        aria-label="打开 AI 助手"
        title="CloudBox AI 助手"
      >
        <SparklesIcon className="h-6 w-6" />
      </button>

      {open ? (
        <div className="fixed bottom-24 right-5 z-40 flex h-[min(620px,75vh)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">{t('ai.assistant')}</p>
              <p className="text-[10px] text-slate-500">网盘相对路径 · 工具调用</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-800" aria-label="关闭 AI 助手">
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <p className="rounded-xl bg-slate-950/60 p-3 text-xs leading-5 text-slate-400">
                可以让我列出文件、读取代码、写入 `src/main.py` 或追加内容。删除/覆盖会先请求你的确认。
              </p>
            ) : null}
            {html.map((message, index) => (
              <div key={index} className={`rounded-xl px-3 py-2 text-xs leading-5 ${message.role === 'user' ? 'ml-8 bg-indigo-600 text-white' : 'mr-4 bg-slate-800 text-slate-200'}`}>
                <div dangerouslySetInnerHTML={{ __html: message.html }} />
              </div>
            ))}
            {pending ? (
              <div className="rounded-xl border border-rose-700 bg-rose-950/50 p-3 text-xs text-rose-100">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertIcon className="h-4 w-4" />
                  高危操作待确认
                </p>
                <p className="mt-1 text-[11px]">工具：{pending.tool}</p>
                <p className="break-all text-[11px] text-rose-200">{JSON.stringify(pending.args)}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => void confirm()} className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-500">
                    确认执行
                  </button>
                  <button type="button" onClick={() => setPending(null)} className="rounded-lg border border-rose-800 px-3 py-1.5 text-rose-200 hover:bg-rose-950">
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            {error ? <p className="rounded-lg bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{error}</p> : null}
          </div>

          <div className="border-t border-slate-800 p-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="输入指令，例如：读取 src/main.py 并解释"
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
            />
            <button type="button" onClick={() => void send()} disabled={streaming || input.trim() === ''} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2 text-xs font-medium text-white disabled:opacity-50">
              {streaming ? <Spinner className="h-3.5 w-3.5" /> : null}
              {streaming ? '生成中…' : '发送'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.aiSettings().then(setSettings).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '加载失败'));
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => value - 1), 1_000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  if (!settings) {
    return (
      <DialogShell title="AI 个人设置" onClose={onClose} footer={<button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">关闭</button>}>
        {error ? <p className="text-sm text-rose-300">{error}</p> : <Spinner className="h-5 w-5" />}
      </DialogShell>
    );
  }

  const update = (patch: Partial<AiSettings>) => setSettings((current) => (current ? { ...current, ...patch } : current));

  const requestAllScope = () => {
    update({ workScope: 'all' });
    setWarning(true);
    setCountdown(5);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.saveAiSettings({
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: apiKey || undefined,
        dailyLimit: settings.dailyLimit,
        workScope: settings.workScope,
        workDir: settings.workDir,
      });
      setSettings(next);
      setApiKey('');
      setWarning(false);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title="AI 个人设置"
      description={settings.mode === 'admin' ? '管理员已配置共享 AI 服务。' : '请填写自己的 OpenAI 兼容 API 配置。'}
      onClose={onClose}
      footer={
        <button type="button" onClick={() => void save()} disabled={saving || (settings.workScope === 'all' && countdown > 0)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? '保存中…' : '保存设置'}
        </button>
      }
    >
      <div className="space-y-3">
        {settings.mode === 'user' ? (
          <>
            <label className="block text-xs text-slate-400">API Key（当前：{settings.maskedApiKey || '未配置'})
              <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder={settings.hasApiKey ? '留空保持现状' : 'sk-...'} />
            </label>
            <label className="block text-xs text-slate-400">Base URL
              <input value={settings.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </label>
            <label className="block text-xs text-slate-400">Model
              <input value={settings.model} onChange={(event) => update({ model: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </label>
          </>
        ) : null}
        <label className="block text-xs text-slate-400">每日用量限制（自我约束）
          <input type="number" min={1} max={10000} value={settings.dailyLimit} onChange={(event) => update({ dailyLimit: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        </label>
        <div>
          <p className="text-xs text-slate-400">工作目录权限</p>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="radio" checked={settings.workScope === 'folder'} onChange={() => update({ workScope: 'folder' })} className="accent-indigo-500" />
              仅限特定文件夹
            </label>
            <input value={settings.workDir} onChange={(event) => update({ workDir: event.target.value })} placeholder="相对路径，例如 projects/my-app" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200" />
            <label className="flex items-center gap-2 text-xs text-rose-300">
              <input type="radio" checked={settings.workScope === 'all'} onChange={requestAllScope} className="accent-rose-500" />
              全盘操作（高危）
            </label>
          </div>
        </div>
        {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      </div>

      {warning ? (
        <div className="mt-4 rounded-xl border border-rose-700 bg-rose-950/50 p-4 text-rose-100">
          <p className="flex items-center gap-2 text-sm font-semibold"><AlertIcon className="h-5 w-5" /> 高危：AI 可操作整个网盘</p>
          <p className="mt-1 text-xs leading-5">AI 将能够读取、写入、删除你网盘根目录下的任意文件。请确认你理解风险。</p>
          <button type="button" disabled={countdown > 0} onClick={() => setWarning(false)} className="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-700 disabled:text-slate-400">
            {countdown > 0 ? `我已知晓风险（${countdown}s）` : '我已知晓风险'}
          </button>
        </div>
      ) : null}
    </DialogShell>
  );
}
