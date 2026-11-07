import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { AiToolService } from '../../core/services/aiToolService.ts';
import type { RequestContext } from '../../core/services/fileService.ts';

function tokenMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createMcpRouter(services: CoreServices) {
  return async (req: import('express').Request, res: import('express').Response): Promise<void> => {
    if (
      !services.settings.get('mcp.enabled') ||
      !services.settings.get('ai.enabled') ||
      !services.settings.get('mcp.token')
    ) {
      res.status(404).json({ code: 'MCP_DISABLED', message: 'MCP 服务未启用或未对接 AI' });
      return;
    }
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tokenMatches(token, services.settings.get('mcp.token'))) {
      res.status(401).json({ code: 'MCP_UNAUTHORIZED', message: 'MCP Token 无效' });
      return;
    }

    const boundId = services.settings.get('mcp.bound_user_id');
    const user =
      services.ai.findUser(boundId) ??
      services.ai.findUser(services.users.findAdmin()?.id ?? 0);
    if (!user) {
      res.status(403).json({ code: 'MCP_NO_USER', message: '未绑定有效的网盘用户' });
      return;
    }
    const aiStatus = services.ai.publicSettings(user) as { hasApiKey: boolean };
    if (!aiStatus.hasApiKey) {
      res.status(404).json({ code: 'MCP_AI_NOT_CONFIGURED', message: 'MCP 尚未正确对接 AI Agent' });
      return;
    }

    const ctx: RequestContext = {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: (req as { requestId?: string }).requestId ?? null,
    };
    const tools = new AiToolService(services.files);
    const work = { workScope: 'all' as const, workDir: '' };

    const server = new McpServer({ name: 'cloudbox', version: '1.0.0' });
    const tool = (
      name: string,
      description: string,
      inputSchema: Record<string, z.ZodType>,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      server.registerTool(name, { description, inputSchema }, async (args: any) => {
        const result = await handler(args);
        if (name === 'delete_file' || name === 'write_text_file') {
          services.audit.record({
            actorType: 'system',
            actorId: null,
            action: 'mcp.tool',
            result: 'success',
            targetType: 'file',
            targetPath: typeof args.path === 'string' ? args.path : null,
            detail: { tool: name, userId: user.id },
          });
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      });
    };

    tool('list_files', '列出网盘目录。path 必须是相对网盘根的 POSIX 路径。', {
      path: z.string().optional(),
    }, async (args) => tools.execute(user, 'list_files', args, ctx, { ...work, allowDestructive: true }));
    tool('read_text_file', '读取网盘 UTF-8 文本文件。', { path: z.string() }, async (args) =>
      tools.execute(user, 'read_text_file', args, ctx, { ...work, allowDestructive: true }));
    tool('create_folder', '创建网盘目录。', { path: z.string() }, async (args) =>
      tools.execute(user, 'create_folder', args, ctx, { ...work, allowDestructive: true }));
    tool('rename_file', '重命名网盘文件或目录。', {
      path: z.string(),
      new_name: z.string(),
    }, async (args) => tools.execute(user, 'rename_file', args, ctx, { ...work, allowDestructive: true }));
    tool('delete_file', '删除网盘文件或目录（高危，写入审计）。', { path: z.string() }, async (args) =>
      tools.execute(user, 'delete_file', args, ctx, { ...work, allowDestructive: true }));
    tool('write_text_file', '创建或覆盖网盘文本/代码文件。', {
      path: z.string(),
      content: z.string(),
    }, async (args) => tools.execute(user, 'write_text_file', args, ctx, { ...work, allowDestructive: true }));
    tool('append_text_file', '追加网盘文本文件。', {
      path: z.string(),
      content: z.string(),
    }, async (args) => tools.execute(user, 'append_text_file', args, ctx, { ...work, allowDestructive: true }));

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}
