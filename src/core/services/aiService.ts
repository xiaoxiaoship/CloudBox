import { randomUUID } from 'node:crypto';
import type { AiRepository } from '../db/repositories/aiRepo.ts';
import type { UserRepository } from '../db/repositories/userRepo.ts';
import type { SessionUser } from '../types/models.ts';
import { toSessionUser } from '../types/models.ts';
import { maskSecret, type SecretBox } from '../security/secretBox.ts';
import type { AuditService } from './auditService.ts';
import { AGENT_TOOLS, AiToolService, type ToolExecution } from './aiToolService.ts';
import type { FileService, RequestContext } from './fileService.ts';
import type { SettingsService } from './settingsService.ts';

export interface AiMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiChatResult {
  content: string;
  toolCalls: AiToolCall[];
}

export interface AiChatClient {
  chat(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: AiMessage[];
    tools: typeof AGENT_TOOLS;
  }): Promise<AiChatResult>;
}

const defaultAiClient: AiChatClient = {
  async chat(input) {
    const base = input.baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`AI API 返回 HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };
    const message = body.choices?.[0]?.message;
    return {
      content: message?.content ?? '',
      toolCalls: (message?.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments || '{}') as Record<string, unknown>,
      })),
    };
  },
};

interface PendingAction {
  id: string;
  userId: number;
  tool: string;
  args: Record<string, unknown>;
  workScope: 'folder' | 'all';
  workDir: string;
  createdAt: number;
}

export type AiEvent =
  | { type: 'content'; text: string }
  | { type: 'tool'; name: string; result: unknown }
  | { type: 'confirmation'; actionId: string; tool: string; args: Record<string, unknown> }
  | { type: 'done'; usage: { used: number; limit: number } }
  | { type: 'error'; message: string };

export class AiService {
  private readonly files: FileService;
  private readonly users: UserRepository;
  private readonly ai: AiRepository;
  private readonly settings: SettingsService;
  private readonly audit: AuditService;
  private readonly secrets: SecretBox;
  private readonly tools: AiToolService;
  private readonly client: AiChatClient;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingAction>();

  constructor(options: {
    files: FileService;
    users: UserRepository;
    ai: AiRepository;
    settings: SettingsService;
    audit: AuditService;
    secrets: SecretBox;
    client?: AiChatClient;
    now?: () => number;
  }) {
    this.files = options.files;
    this.users = options.users;
    this.ai = options.ai;
    this.settings = options.settings;
    this.audit = options.audit;
    this.secrets = options.secrets;
    this.tools = new AiToolService(options.files);
    this.client = options.client ?? defaultAiClient;
    this.now = options.now ?? Date.now;
  }

  isEnabled(): boolean {
    return this.settings.get('ai.enabled');
  }

  adminSettings(): Record<string, unknown> {
    const adminKey = this.secrets.decrypt(this.settings.get('ai.admin_api_key'));
    return {
      enabled: this.settings.get('ai.enabled'),
      mode: this.settings.get('ai.mode'),
      baseUrl: this.settings.get('ai.admin_base_url'),
      model: this.settings.get('ai.admin_model'),
      hasApiKey: adminKey !== '',
      apiKeyMasked: maskSecret(adminKey),
      dailyLimit: this.settings.get('ai.user_daily_limit'),
    };
  }

  saveAdmin(input: {
    enabled: boolean;
    mode: 'admin' | 'user';
    baseUrl: string;
    apiKey?: string;
    model: string;
    dailyLimit: number;
  }): Record<string, unknown> {
    this.settings.set('ai.enabled', input.enabled, null);
    this.settings.set('ai.mode', input.mode, null);
    this.settings.set('ai.admin_base_url', input.baseUrl.trim(), null);
    this.settings.set('ai.admin_model', input.model.trim(), null);
    this.settings.set('ai.user_daily_limit', input.dailyLimit, null);
    if (input.apiKey && !input.apiKey.includes('***')) {
      this.settings.set('ai.admin_api_key', this.secrets.encrypt(input.apiKey.trim()), null);
    }
    return this.adminSettings();
  }

  publicSettings(user: SessionUser): Record<string, unknown> {
    const record = this.ai.get(user.id);
    const mode = this.settings.get('ai.mode');
    const hasKey = mode === 'admin' ? this.settings.get('ai.admin_api_key') !== '' : Boolean(record?.apiKeyEnc);
    return {
      enabled: this.isEnabled(),
      mode,
      hasApiKey: hasKey,
      maskedApiKey:
        mode === 'admin'
          ? maskSecret(this.secrets.decrypt(this.settings.get('ai.admin_api_key')))
          : maskSecret(this.secrets.decrypt(record?.apiKeyEnc ?? '')),
      baseUrl: mode === 'admin' ? this.settings.get('ai.admin_base_url') : (record?.baseUrl ?? ''),
      model: mode === 'admin' ? this.settings.get('ai.admin_model') : (record?.model ?? ''),
      dailyLimit:
        mode === 'admin' ? this.settings.get('ai.user_daily_limit') : (record?.dailyLimit ?? 50),
      workScope: record?.workScope ?? 'folder',
      workDir: record?.workDir ?? '',
      usedToday: record?.usedDate === this.today() ? record.usedCount : 0,
    };
  }

  saveUserSettings(
    user: SessionUser,
    input: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      dailyLimit?: number;
      workScope?: 'folder' | 'all';
      workDir?: string;
    },
  ): Record<string, unknown> {
    const existing = this.ai.get(user.id);
    const apiKey = input.apiKey?.trim();
    this.ai.upsert({
      userId: user.id,
      baseUrl: input.baseUrl?.trim() ?? existing?.baseUrl ?? '',
      model: input.model?.trim() ?? existing?.model ?? '',
      apiKeyEnc:
        apiKey && !apiKey.includes('***')
          ? this.secrets.encrypt(apiKey)
          : (existing?.apiKeyEnc ?? ''),
      dailyLimit: input.dailyLimit ?? existing?.dailyLimit ?? 50,
      workScope: input.workScope ?? existing?.workScope ?? 'folder',
      workDir: input.workDir?.trim() ?? existing?.workDir ?? '',
      updatedAt: this.now(),
    });
    return this.publicSettings(user);
  }

  async *chat(
    user: SessionUser,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    ctx: RequestContext,
    locale = 'zh-CN',
  ): AsyncGenerator<AiEvent> {
    if (!this.isEnabled()) {
      yield { type: 'error', message: 'AI 总开关未开启' };
      return;
    }
    const mode = this.settings.get('ai.mode');
    const record = this.ai.get(user.id);
    const baseUrl =
      mode === 'admin' ? this.settings.get('ai.admin_base_url') : (record?.baseUrl ?? '');
    const model =
      mode === 'admin' ? this.settings.get('ai.admin_model') : (record?.model ?? '');
    const apiKey =
      mode === 'admin'
        ? this.secrets.decrypt(this.settings.get('ai.admin_api_key'))
        : this.secrets.decrypt(record?.apiKeyEnc ?? '');
    const limit =
      mode === 'admin' ? this.settings.get('ai.user_daily_limit') : (record?.dailyLimit ?? 50);
    const used = record?.usedDate === this.today() ? record.usedCount : 0;

    if (!baseUrl || !model || !apiKey) {
      yield {
        type: 'error',
        message: mode === 'user' ? '请先在个人设置中配置 API Key、Base URL 和 Model' : '管理员尚未配置 AI 服务',
      };
      return;
    }
    if (used >= limit) {
      yield { type: 'error', message: `今日 AI 用量已达上限（${limit} 次）` };
      return;
    }

    const workScope = record?.workScope ?? 'folder';
    const workDir = record?.workDir ?? '';
    const conversation: AiMessage[] = [
      {
        role: 'assistant',
        content:
          '你是 CloudBox 网盘原生 AI 助手。所有文件工具 path 必须使用网盘内相对 POSIX 路径；绝不能使用宿主机绝对路径。' +
          (locale.toLowerCase().startsWith('en') ? ' Please reply to the user in English.' : ''),
      },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ];

    try {
      for (let step = 0; step < 5; step += 1) {
        const result = await this.client.chat({
          baseUrl,
          apiKey,
          model,
          messages: conversation,
          tools: AGENT_TOOLS,
        });

        if (result.toolCalls.length === 0) {
          const text = result.content ?? '';
          for (let i = 0; i < text.length; i += 12) {
            yield { type: 'content', text: text.slice(i, i + 12) };
            await new Promise((resolve) => setTimeout(resolve, 8));
          }
          this.ai.incrementUsage(user.id, this.today(), this.now());
          yield { type: 'done', usage: { used: used + 1, limit } };
          return;
        }

        conversation.push({
          role: 'assistant',
          content: result.content ?? '',
          tool_calls: result.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        });

        for (const call of result.toolCalls) {
          const highRisk =
            call.name === 'delete_file' ||
            (call.name === 'write_text_file' &&
              (await this.tools.exists(user, call.arguments.path, ctx, { workScope, workDir }))) ||
            (call.name === 'append_text_file' &&
              (await this.tools.exists(user, call.arguments.path, ctx, { workScope, workDir })));

          if (highRisk) {
            const actionId = randomUUID();
            this.pending.set(actionId, {
              id: actionId,
              userId: user.id,
              tool: call.name,
              args: call.arguments,
              workScope,
              workDir,
              createdAt: this.now(),
            });
            yield { type: 'confirmation', actionId, tool: call.name, args: call.arguments };
            return;
          }

          const execution = await this.tools.execute(user, call.name, call.arguments, ctx, {
            workScope,
            workDir,
            allowDestructive: false,
          });
          yield { type: 'tool', name: call.name, result: execution };
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(execution),
          });
        }
      }
      yield { type: 'error', message: 'AI 工具调用次数过多，已停止' };
    } catch (error) {
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async confirm(
    user: SessionUser,
    actionId: string,
    ctx: RequestContext,
  ): Promise<ToolExecution> {
    const action = this.pending.get(actionId);
    if (!action || action.userId !== user.id) throw new Error('确认操作不存在或已过期');
    this.pending.delete(actionId);
    const result = await this.tools.execute(user, action.tool, action.args, ctx, {
      workScope: action.workScope,
      workDir: action.workDir,
      allowDestructive: true,
    });
    this.audit.record({
      actorType: 'user',
      actorId: user.id,
      action: 'ai.action.confirm',
      result: result.ok ? 'success' : 'error',
      targetType: 'file',
      targetPath: typeof action.args.path === 'string' ? action.args.path : null,
      ip: ctx.ip ?? null,
      requestId: ctx.requestId ?? null,
      detail: { tool: action.tool },
    });
    return result;
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  findUser(userId: number): SessionUser | null {
    const user = this.users.findById(userId);
    return user ? toSessionUser(user) : null;
  }
}
