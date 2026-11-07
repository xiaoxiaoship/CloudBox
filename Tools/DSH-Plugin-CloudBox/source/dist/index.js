import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Agent, fetch as undiciFetch } from 'undici';
export const name = 'cloudbox';
/** DSH/Cordis 插件注入：等待 tools 服务可用后再 apply。 */
export const inject = ['tools'];
const SYSTEM_PROMPT = [
    '你当前接入的是一个远程网盘系统（CloudBox）。',
    '所有文件工具的 `path` 参数必须是网盘内部的相对路径（如 `src/main.py`），绝对不能传入你本地宿主机的绝对路径（如 `C:\\` 或 `/Users/`）。',
    '如果想操作本地文件，请使用你自带的本地工具。',
].join(' ');
function normalizeEndpoint(base) {
    const trimmed = base.replace(/\/+$/, '');
    return trimmed.endsWith('/api/mcp') ? trimmed : `${trimmed}/api/mcp`;
}
const TOOL_OUTPUT = {
    schema: { type: 'object' },
    render: (_args, value) => [
        {
            type: 'text',
            text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
    ],
};
/**
 * DSH 插件入口。通过 Cordis 的 tools 服务注册 MCP 工具；
 * 同时把网盘路径约束注入 System Prompt。
 */
export async function apply(ctx, config) {
    const cloudboxUrl = config?.cloudboxUrl?.trim() || process.env.CLOUDBOX_URL?.trim() || 'http://127.0.0.1:8686';
    const mcpToken = config?.mcpToken?.trim() || process.env.CLOUDBOX_MCP_TOKEN?.trim() || '';
    if (!mcpToken) {
        ctx.logger?.info?.('[cloudbox] 未配置 mcpToken；请在 DSH 插件配置中填入 CloudBox MCP Token，或设置 CLOUDBOX_MCP_TOKEN。');
        return;
    }
    const caPath = config?.caCertPath?.trim() || path.join(process.env.APPDATA ?? '', 'cloudbox', 'config', 'ssl', 'ca', 'rootCA.pem');
    const ca = caPath && existsSync(caPath) ? readFileSync(caPath) : null;
    const dispatcher = ca ? new Agent({ connect: { ca } }) : undefined;
    const customFetch = dispatcher
        ? ((input, init) => undiciFetch(input, { ...init, dispatcher }))
        : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(normalizeEndpoint(cloudboxUrl)), {
        requestInit: {
            headers: { Authorization: `Bearer ${mcpToken}` },
        },
        ...(customFetch ? { fetch: customFetch } : {}),
    });
    const client = new Client({ name: 'dsh-cloudbox', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    const register = ctx.tools?.register?.bind(ctx.tools) ??
        (ctx.tools?.add ? (tool) => ctx.tools.add(tool) : undefined);
    if (typeof register !== 'function') {
        throw new Error('DSH tools 服务不可用，无法注册 CloudBox 工具');
    }
    ctx.tools?.setSystemPrompt?.(SYSTEM_PROMPT);
    const systemPrompt = ctx.get?.('systemPrompt');
    systemPrompt?.push?.(SYSTEM_PROMPT);
    systemPrompt?.prepend?.(SYSTEM_PROMPT);
    for (const tool of tools.tools) {
        register({
            name: `cloudbox_${tool.name}`,
            description: `[CloudBox 网盘] ${tool.description ?? tool.name}。path 必须是网盘内 POSIX 相对路径。`,
            inputSchema: tool.inputSchema,
            output: TOOL_OUTPUT,
            execute: async (args) => client.callTool({ name: tool.name, arguments: (args ?? {}) }),
        });
    }
    ctx.logger?.info?.(`[cloudbox] 已注册 ${tools.tools.length} 个网盘工具`);
    ctx.effect?.(() => {
        void client.close().catch(() => { });
    });
}
export default { name, inject, apply };
