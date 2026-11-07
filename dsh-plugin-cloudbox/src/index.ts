import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const name = 'cloudbox';
/** DSH/Cordis 插件注入：等待 tools 服务可用后再 apply。 */
export const inject = ['tools'];

export interface CloudBoxPluginConfig {
  cloudboxUrl: string;
  mcpToken: string;
}

const SYSTEM_PROMPT = [
  '你当前接入的是一个远程网盘系统（CloudBox）。',
  '所有文件工具的 `path` 参数必须是网盘内部的相对路径（如 `src/main.py`），绝对不能传入你本地宿主机的绝对路径（如 `C:\\` 或 `/Users/`）。',
  '如果想操作本地文件，请使用你自带的本地工具。',
].join(' ');

function normalizeEndpoint(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/api/mcp') ? trimmed : `${trimmed}/api/mcp`;
}

/**
 * DSH 插件入口。通过 Cordis 的 tools 服务注册 MCP 工具；
 * 同时把网盘路径约束注入 System Prompt。
 */
export async function apply(
  ctx: {
    tools?: {
      register?: (tool: {
        name: string;
        description: string;
        inputSchema: unknown;
        execute: (args: unknown) => Promise<unknown>;
      }) => void;
      add?: (tool: unknown) => void;
      setSystemPrompt?: (prompt: string) => void;
    };
    systemPrompt?: { push?: (prompt: string) => void; prepend?: (prompt: string) => void };
    logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
    effect?: (dispose: () => void) => void;
  },
  config: CloudBoxPluginConfig,
): Promise<void> {
  if (!config?.cloudboxUrl || !config?.mcpToken) {
    throw new Error('dsh-plugin-cloudbox 需要配置 cloudboxUrl 与 mcpToken');
  }

  const transport = new StreamableHTTPClientTransport(new URL(normalizeEndpoint(config.cloudboxUrl)), {
    requestInit: {
      headers: { Authorization: `Bearer ${config.mcpToken}` },
    },
  });
  const client = new Client({ name: 'dsh-cloudbox', version: '1.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  const register =
    ctx.tools?.register?.bind(ctx.tools) ??
    (ctx.tools?.add ? (tool: unknown) => ctx.tools!.add!(tool) : undefined);
  if (typeof register !== 'function') {
    throw new Error('DSH tools 服务不可用，无法注册 CloudBox 工具');
  }

  ctx.tools?.setSystemPrompt?.(SYSTEM_PROMPT);
  ctx.systemPrompt?.push?.(SYSTEM_PROMPT);
  ctx.systemPrompt?.prepend?.(SYSTEM_PROMPT);

  for (const tool of tools.tools) {
    register({
      name: `cloudbox_${tool.name}`,
      description: `[CloudBox 网盘] ${tool.description ?? tool.name}。path 必须是网盘内 POSIX 相对路径。`,
      inputSchema: tool.inputSchema,
      execute: async (args: unknown) =>
        client.callTool({ name: tool.name, arguments: (args ?? {}) as Record<string, unknown> }),
    });
  }

  ctx.logger?.info?.(`[cloudbox] 已注册 ${tools.tools.length} 个网盘工具`);
  ctx.effect?.(() => {
    void client.close().catch(() => {});
  });
}

export default { name, inject, apply };
