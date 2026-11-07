import path from 'node:path';
import { normalizeRelativePath } from '../security/safePath.ts';
import type { SessionUser } from '../types/models.ts';
import type { FileService, RequestContext } from './fileService.ts';

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecution {
  ok: boolean;
  data?: unknown;
  error?: string;
}

const pathSchema = {
  type: 'string',
  description: '相对于网盘用户根目录的 POSIX 路径，例如 src/main.py。禁止使用宿主机绝对路径。',
};

export const AGENT_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出网盘目录中的文件与子目录。path 为相对网盘根目录的 POSIX 路径，空字符串表示根目录。',
      parameters: {
        type: 'object',
        properties: { path: { ...pathSchema, default: '' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_text_file',
      description: '读取网盘中的 UTF-8 文本文件内容（最多 256KB）。',
      parameters: { type: 'object', properties: { path: pathSchema }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: '在网盘中创建目录。',
      parameters: { type: 'object', properties: { path: pathSchema }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_file',
      description: '重命名网盘中的文件或目录。',
      parameters: {
        type: 'object',
        properties: { path: pathSchema, new_name: { type: 'string' } },
        required: ['path', 'new_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除网盘文件或目录（高危，需要用户二次确认）。',
      parameters: { type: 'object', properties: { path: pathSchema }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_text_file',
      description:
        '创建或覆盖网盘中的文本/代码文件。若文件已存在，必须先取得用户二次确认。',
      parameters: {
        type: 'object',
        properties: {
          path: pathSchema,
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_text_file',
      description: '向网盘文本文件追加内容；文件不存在时创建。',
      parameters: {
        type: 'object',
        properties: {
          path: pathSchema,
          content: { type: 'string', description: '追加内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

function safeScopePath(raw: unknown, workScope: 'folder' | 'all', workDir: string): string {
  if (typeof raw !== 'string') throw new Error('path 必须是字符串');
  const normalized = normalizeRelativePath(raw.trim());
  if (workScope === 'folder' && workDir.trim() !== '') {
    const root = normalizeRelativePath(workDir.trim());
    if (root !== '' && normalized !== root && !normalized.startsWith(`${root}/`)) {
      throw new Error(`路径超出工作目录：${root}`);
    }
  }
  return normalized;
}

export class AiToolService {
  private readonly files: FileService;

  constructor(files: FileService) {
    this.files = files;
  }

  async execute(
    user: SessionUser,
    name: string,
    args: Record<string, unknown>,
    ctx: RequestContext,
    options: { workScope: 'folder' | 'all'; workDir: string; allowDestructive?: boolean },
  ): Promise<ToolExecution> {
    try {
      const pathArg = args.path;
      switch (name) {
        case 'list_files': {
          const target = safeScopePath(pathArg ?? '', options.workScope, options.workDir);
          const listing = await this.files.list(user, target, ctx);
          return { ok: true, data: listing };
        }
        case 'read_text_file': {
          const target = safeScopePath(pathArg, options.workScope, options.workDir);
          const result = await this.files.readText(user, target, ctx);
          return { ok: true, data: result };
        }
        case 'create_folder': {
          const target = safeScopePath(pathArg, options.workScope, options.workDir);
          if (target === '') throw new Error('不能创建根目录');
          const parent = path.posix.dirname(target);
          const name = path.posix.basename(target);
          const entry = await this.files.createFolder(user, parent === '.' ? '' : parent, name, ctx);
          return { ok: true, data: entry };
        }
        case 'rename_file': {
          const target = safeScopePath(pathArg, options.workScope, options.workDir);
          const newName = typeof args.new_name === 'string' ? args.new_name : '';
          const entry = await this.files.rename(user, target, newName, ctx);
          return { ok: true, data: entry };
        }
        case 'delete_file': {
          const target = safeScopePath(pathArg, options.workScope, options.workDir);
          if (!options.allowDestructive) throw new Error('高危操作必须先确认');
          const result = await this.files.remove(user, [target], ctx);
          return { ok: true, data: result };
        }
        case 'write_text_file': {
          const target = safeScopePath(pathArg, options.workScope, options.workDir);
          const content = typeof args.content === 'string' ? args.content : '';
          const entry = await this.files.writeText(
            user,
            target,
            content,
            options.allowDestructive === true,
            ctx,
          );
          return { ok: true, data: entry };
        }
        case 'append_text_file': {
          const target = safeScopePath(pathArg, options.workScope, options.workDir);
          const content = typeof args.content === 'string' ? args.content : '';
          if (!options.allowDestructive) {
            // 追加视为普通写入，但已存在文件时需要显式允许
            try {
              await this.files.inspectFile(user, target, ctx, 'file.ai-append');
              throw new Error('文件已存在，追加需要用户确认');
            } catch (error) {
              if (error instanceof Error && error.message.includes('需要用户确认')) throw error;
            }
          }
          const entry = await this.files.appendText(user, target, content, ctx);
          return { ok: true, data: entry };
        }
        default:
          return { ok: false, error: `未知工具：${name}` };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async exists(
    user: SessionUser,
    rawPath: unknown,
    ctx: RequestContext,
    options: { workScope: 'folder' | 'all'; workDir: string },
  ): Promise<boolean> {
    try {
      const target = safeScopePath(rawPath, options.workScope, options.workDir);
      await this.files.inspectFile(user, target, ctx, 'file.ai-check');
      return true;
    } catch {
      return false;
    }
  }
}
