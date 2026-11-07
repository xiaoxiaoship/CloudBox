import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';
import { PathSecurityError } from '../core/security/safePath.ts';
import { ADMIN_ERROR, AdminError, type ManagedUser } from '../core/services/adminUserService.ts';
import { AUTH_ERROR, AuthError } from '../core/services/authService.ts';
import { FileServiceError } from '../core/services/fileService.ts';
import { toPublicUser, toSessionUser, type PublicUser } from '../core/types/models.ts';
import {
  IPC,
  type AdminStatus,
  type AdminSettings,
  type FrpConfig,
  type FrpStatus,
  type Result,
  type ServerStatus,
} from '../shared/ipcTypes.ts';
import type { MainContext } from './context.ts';
import { CA_ERROR, CaError } from './caManager.ts';
import { changeDirectory } from './directoryMigration.ts';
import { FRP_ERROR, FrpError } from './frpService.ts';
import { SERVER_ERROR, ServerError, isPortAvailable } from './serverController.ts';
import { TLS_ERROR, TlsError } from './tlsManager.ts';

export interface IpcContext extends MainContext {
  getWindow: () => BrowserWindow | null;
}

type Handler<TInput, TOutput> = (
  input: TInput,
  context: IpcContext,
) => Promise<TOutput> | TOutput;

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1_024),
});

const setupSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
});

const createUserSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
  quotaBytes: z
    .number()
    .int()
    .min(0)
    .max(1024 ** 5)
    .nullable(),
});

const userIdSchema = z.object({ userId: z.number().int().positive() });

const setQuotaSchema = z.object({
  userId: z.number().int().positive(),
  quotaBytes: z
    .number()
    .int()
    .min(0)
    .max(1024 ** 5)
    .nullable(),
});

const resetPasswordSchema = z.object({
  userId: z.number().int().positive(),
  newPassword: z.string().min(8).max(128),
});

const setStatusSchema = z.object({
  userId: z.number().int().positive(),
  status: z.enum(['active', 'disabled']),
});

const removeUserSchema = z.object({
  userId: z.number().int().positive(),
  deleteFiles: z.boolean(),
});

const onlineSchema = z.object({ enabled: z.boolean() });
const portSchema = z.object({ port: z.number().int().min(1024).max(65_535) });
const applyNetworkSchema = z.object({
  protocol: z.enum(['http', 'https']),
  port: z.number().int().min(1024).max(65_535),
  mtlsEnabled: z.boolean().optional(),
});
const certificateKindSchema = z.object({ kind: z.enum(['cert', 'key']) });
const directoryKindSchema = z.object({ kind: z.enum(['data', 'storage', 'plugins']) });
const changeDirectorySchema = z.object({
  kind: z.enum(['data', 'storage', 'plugins']),
  targetPath: z.string().min(1),
  migrate: z.boolean(),
});
const publicRegistrationSchema = z.object({ enabled: z.boolean() });
const featurePermissionsSchema = z.object({
  allowUserPreviewImage: z.boolean(),
  allowUserPreviewVideo: z.boolean(),
  allowUserPreviewPdf: z.boolean(),
  allowUserExtract: z.boolean(),
  allowUserScan: z.boolean(),
});
const scanConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['api', 'local']),
  apiKey: z.string().max(256),
  localPath: z.string().max(500),
});
const aiConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['admin', 'user']),
  baseUrl: z.string().max(500),
  apiKey: z.string().max(2000).optional(),
  model: z.string().max(200),
  dailyLimit: z.number().int().min(1).max(10_000),
  mcpEnabled: z.boolean(),
  mcpToken: z.string().max(256).optional(),
});
const mailConfigSchema = z.object({
  enabled: z.boolean(),
  host: z.string().max(255),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  user: z.string().max(255),
  pass: z.string().max(2000).optional(),
  from: z.string().max(255),
  to: z.string().max(500),
  eventUserRegistered: z.boolean(),
  eventSecurityAlert: z.boolean(),
  eventSystemError: z.boolean(),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1_024),
  newPassword: z.string().min(8).max(128),
});
const frpConfigSchema = z.object({
  serverAddr: z.string().max(255),
  serverPort: z.number().int().min(1).max(65_535),
  remotePort: z.number().int().min(0).max(65_535),
  token: z.string().max(255),
  user: z.string().max(255),
  proxyName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  tunnelType: z.enum(['tcp', 'http', 'https']),
  customDomain: z.string().max(253),
  proxyProtocol: z.boolean(),
});

const fileListSchema = z.object({
  userId: z.number().int().positive(),
  path: z.string().max(900).default(''),
});

const fileDownloadSchema = z.object({
  userId: z.number().int().positive(),
  path: z.string().min(1).max(900),
});

function toAdminUser(user: PublicUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    avatarDataUrl: user.avatarDataUrl ?? null,
    createdAt: user.createdAt,
  };
}

function serverStatus(context: IpcContext): ServerStatus {
  return {
    ...context.server.getStatus(),
    certificate: context.tls.getInfo(),
  };
}

function failure(error: unknown): Result<never> {
  if (error instanceof AuthError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof AdminError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof ServerError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof TlsError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof FrpError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof CaError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof FileServiceError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof PathSecurityError) {
    return { ok: false, code: error.code, message: error.message };
  }

  console.error('[ipc] 未处理错误', error);
  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : '操作失败，请查看日志',
  };
}

function isTrustedSender(event: IpcMainInvokeEvent, context: IpcContext): boolean {
  const window = context.getWindow();
  if (window === null || window.isDestroyed()) return false;
  if (event.sender.id !== window.webContents.id) return false;

  const frame = event.senderFrame;
  if (frame === null) return false;

  const url = frame.url.replaceAll('\\', '/');
  return url.startsWith('file://') && url.includes('/dist/admin/');
}

function register<TInput, TOutput>(
  channel: string,
  schema: z.ZodType<TInput>,
  handler: Handler<TInput, TOutput>,
  options: { requireAdmin?: boolean } = {},
): void {
  const requireAdmin = options.requireAdmin ?? true;

  ipcMain.handle(channel, async (event, rawInput: unknown) => {
    const context = IPC_CONTEXT;
    if (context === null) {
      return { ok: false, code: 'NOT_READY', message: '应用尚未完成初始化' } satisfies Result<never>;
    }

    if (!isTrustedSender(event, context)) {
      console.warn('[ipc] 拒绝不可信来源', channel, event.senderFrame?.url);
      return { ok: false, code: 'IPC_UNTRUSTED', message: '非法请求来源' } satisfies Result<never>;
    }

    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? '参数不合法',
      } satisfies Result<never>;
    }

    try {
      if (requireAdmin) context.session.require();
      const data = await handler(parsed.data, context);
      return { ok: true, data } satisfies Result<TOutput>;
    } catch (error) {
      return failure(error);
    }
  });
}

let IPC_CONTEXT: IpcContext | null = null;

export function registerIpc(context: IpcContext): void {
  IPC_CONTEXT = context;

  register(
    IPC.authStatus,
    z.undefined(),
    (): AdminStatus => {
      const user = context.session.current();
      return {
        needsSetup: context.services.users.findAdmin() === null,
        authenticated: user !== null,
        user: user === null ? null : toAdminUser(user),
        version: context.version,
        dataDir: context.dataDir,
        storageDir: context.storageRoot,
        pluginsDir: context.pluginsDir,
      };
    },
    { requireAdmin: false },
  );

  register(
    IPC.authSetup,
    setupSchema,
    async (input) => {
      if (context.services.users.findAdmin() !== null) {
        throw new AdminError(ADMIN_ERROR.ADMIN_EXISTS, '管理员已存在，无法重复初始化');
      }
      const created = await context.adminUsers.createAdmin({
        username: input.username,
        password: input.password,
      });
      await context.session.login(created.username, input.password);
      return toAdminUser(created);
    },
    { requireAdmin: false },
  );

  register(
    IPC.authLogin,
    loginSchema,
    async (input) => {
      const user = await context.session.login(input.username, input.password);
      return toAdminUser(user);
    },
    { requireAdmin: false },
  );

  register(
    IPC.authLogout,
    z.undefined(),
    () => {
      context.session.logout();
      return null;
    },
    { requireAdmin: false },
  );

  register(IPC.authChangePassword, changePasswordSchema, async (input) => {
    const admin = context.session.require();
    await context.services.auth.changePassword({
      userId: admin.id,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
    context.session.logout();
    return null;
  });

  const actor = (): { id: number; username: string } => {
    const user = context.session.require();
    return { id: user.id, username: user.username };
  };

  register(IPC.usersList, z.undefined(), (): ManagedUser[] => context.adminUsers.list());

  register(IPC.usersCreate, createUserSchema, async (input) => {
    return context.adminUsers.createUser(input, actor());
  });

  register(IPC.usersSetQuota, setQuotaSchema, (input) => {
    context.adminUsers.setQuota(input.userId, input.quotaBytes, actor());
    return null;
  });

  register(IPC.usersResetPassword, resetPasswordSchema, async (input) => {
    await context.adminUsers.resetPassword(input.userId, input.newPassword, actor());
    return null;
  });

  register(IPC.usersUnlock, z.object({ userId: z.number().int().positive() }), (input) => {
    context.adminUsers.unlockUser(input.userId, actor());
    return null;
  });

  register(IPC.usersSetStatus, setStatusSchema, (input) => {
    context.adminUsers.setStatus(input.userId, input.status, actor());
    return null;
  });

  register(IPC.usersRemove, removeUserSchema, async (input) => {
    await context.adminUsers.remove(input.userId, input.deleteFiles, actor());
    return null;
  });

  register(IPC.serverStatus, z.undefined(), (): ServerStatus => serverStatus(context));

  register(IPC.serverSetOnline, onlineSchema, async (input): Promise<ServerStatus> => {
    const admin = actor();
    const settings = context.services.settings;

    if (input.enabled) {
      const port = context.server.getStatus().port;
      try {
        await context.server.start(port);
      } catch (error) {
        settings.set('server.online', false, admin.id);
        context.services.audit.record({
          actorType: 'admin',
          actorId: admin.id,
          action: 'server.online.start',
          result: 'error',
          targetType: 'server',
          targetId: String(port),
          detail: { message: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }

      settings.set('server.online', true, admin.id);
      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'server.online.start',
        result: 'success',
        targetType: 'server',
        targetId: String(port),
        detail: { port },
      });
    } else {
      await context.server.stop();
      await context.frp.stop().catch(() => {});
      settings.set('server.online', false, admin.id);
      settings.set('frp.enabled', false, admin.id);
      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'server.online.stop',
        result: 'success',
        targetType: 'server',
        detail: {},
      });
    }

    return serverStatus(context);
  });

  register(IPC.serverSetPort, portSchema, async (input): Promise<ServerStatus> => {
    const admin = actor();
    const settings = context.services.settings;
    const status = context.server.getStatus();
    const oldPort = status.port;

    if (input.port === oldPort) {
      return serverStatus(context);
    }

    if (!(await isPortAvailable(input.port))) {
      throw new ServerError(
        SERVER_ERROR.PORT_IN_USE,
        `端口 ${input.port} 已被占用，请换一个端口`,
      );
    }

    if (status.running) {
      await context.server.stop();
      try {
        await context.server.start(input.port);
      } catch (error) {
        // 启动新端口失败时回滚到旧端口，尽量保持在线模式可用
        try {
          await context.server.start(oldPort);
        } catch {
          settings.set('server.online', false, admin.id);
        }
        throw error;
      }
    } else {
      context.server.setConfiguredPort(input.port);
    }

    settings.set('server.port', input.port, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'server.port.update',
      result: 'success',
      targetType: 'server',
      detail: { from: oldPort, to: input.port, wasRunning: status.running },
    });

    try {
      await context.frp.restartIfRunning();
    } catch (error) {
      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'frp.restart',
        result: 'error',
        targetType: 'frp',
        detail: { message: error instanceof Error ? error.message : String(error) },
      });
    }

    return serverStatus(context);
  });

  register(IPC.serverApplyNetwork, applyNetworkSchema, async (input): Promise<ServerStatus> => {
    const admin = actor();
    const settings = context.services.settings;
    const current = context.server.getStatus();
    const nextHttps = input.protocol === 'https';
    const nextMtls = nextHttps ? (input.mtlsEnabled ?? current.mtlsEnabled) : false;

    if (nextHttps) {
      context.tls.validate();
    }

    if (nextHttps && nextMtls) {
      if (!context.ca.getCAInfo().exists || context.ca.getCACertBuffer() === null) {
        throw new ServerError(
          SERVER_ERROR.TLS_NOT_CONFIGURED,
          '启用双向认证前需要先生成私有 CA',
        );
      }
    }

    const sameTarget =
      current.port === input.port &&
      current.httpsEnabled === nextHttps &&
      current.mtlsEnabled === nextMtls;
    if (sameTarget) {
      return serverStatus(context);
    }

    if (current.running) {
      if (current.port !== input.port && !(await isPortAvailable(input.port))) {
        throw new ServerError(
          SERVER_ERROR.PORT_IN_USE,
          `端口 ${input.port} 已被占用，请换一个端口`,
        );
      }
    } else if (!(await isPortAvailable(input.port))) {
      throw new ServerError(
        SERVER_ERROR.PORT_IN_USE,
        `端口 ${input.port} 已被占用，请换一个端口`,
      );
    }

    const wasRunning = current.running;
    const oldHttps = current.httpsEnabled;
    const oldMtls = current.mtlsEnabled;

    if (wasRunning) {
      await context.server.stop();
    }

    context.server.configureHttps(nextHttps);
    context.server.configureMtls(nextMtls);

    try {
      if (wasRunning) {
        await context.server.start(input.port);
      } else {
        context.server.setConfiguredPort(input.port);
      }
    } catch (error) {
      // 回滚协议、端口与 mTLS，尽量恢复原服务
      context.server.configureHttps(oldHttps);
      context.server.configureMtls(oldMtls);
      if (wasRunning) {
        try {
          await context.server.start(current.port);
        } catch {
          settings.set('server.online', false, admin.id);
        }
      }
      throw error;
    }

    settings.set('server.httpsEnabled', nextHttps, admin.id);
    settings.set('server.mtlsEnabled', nextMtls, admin.id);
    settings.set('server.port', input.port, admin.id);

    try {
      await context.frp.restartIfRunning();
    } catch (error) {
      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'frp.restart',
        result: 'error',
        targetType: 'frp',
        detail: { message: error instanceof Error ? error.message : String(error) },
      });
    }

    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'server.network.update',
      result: 'success',
      targetType: 'server',
      detail: {
        from: {
          protocol: oldHttps ? 'https' : 'http',
          port: current.port,
          mtls: oldMtls,
        },
        to: { protocol: input.protocol, port: input.port, mtls: nextMtls },
      },
    });

    return serverStatus(context);
  });

  register(IPC.serverCertificate, z.undefined(), () => context.tls.getInfo());

  register(IPC.serverImportCertificate, certificateKindSchema, async (input) => {
    const window = context.getWindow();
    if (window === null) throw new Error('主窗口不可用');

    const admin = actor();
    const isCert = input.kind === 'cert';
    const selection = await dialog.showOpenDialog(window, {
      title: isCert ? '选择证书文件' : '选择私钥文件',
      properties: ['openFile'],
      filters: isCert
        ? [{ name: '证书文件', extensions: ['crt', 'pem', 'cer'] }]
        : [{ name: '私钥文件', extensions: ['key', 'pem'] }],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { imported: false, certificate: context.tls.getInfo() };
    }

    const certificate = await context.tls.importFile(selection.filePaths[0]!, input.kind);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'server.tls.import',
      result: 'success',
      targetType: 'server',
      targetId: input.kind,
      detail: { fileName: path.basename(selection.filePaths[0]!) },
    });

    return { imported: true, certificate };
  });

  const adminSettings = () => {
    const aiAdmin = context.services.ai.adminSettings() as {
      enabled: boolean;
      mode: 'admin' | 'user';
      baseUrl: string;
      model: string;
      hasApiKey: boolean;
      apiKeyMasked: string;
      dailyLimit: number;
      mcp: {
        enabled: boolean;
        token: string;
        boundUserId: number;
        configTemplate: unknown;
      };
    };
    return {
      allowPublicRegistration: context.services.settings.get('allow_public_registration'),
      trustProxy: context.services.settings.get('network.trustProxy'),
      permissions: {
        allowUserPreviewImage: context.services.settings.get('allow_user_preview_image'),
        allowUserPreviewVideo: context.services.settings.get('allow_user_preview_video'),
        allowUserPreviewPdf: context.services.settings.get('allow_user_preview_pdf'),
        allowUserExtract: context.services.settings.get('allow_user_extract'),
        allowUserScan: context.services.settings.get('allow_user_scan'),
      },
      scan: {
        enabled: context.services.settings.get('scan.enabled'),
        mode: context.services.settings.get('scan.mode'),
        apiKey: context.services.settings.get('scan.api_key'),
        localPath: context.services.settings.get('scan.local_path'),
      },
      ai: {
        enabled: aiAdmin.enabled,
        mode: aiAdmin.mode,
        baseUrl: aiAdmin.baseUrl,
        model: aiAdmin.model,
        hasApiKey: aiAdmin.hasApiKey,
        apiKeyMasked: aiAdmin.apiKeyMasked,
        dailyLimit: aiAdmin.dailyLimit,
      },
      mcp: aiAdmin.mcp,
      hosting: {
        enabled: context.services.settings.get('hosting.enabled'),
        baseUrl: context.services.settings.get('hosting.base_url'),
      },
      mail: context.services.mail.adminSettings() as AdminSettings['mail'],
    };
  };

  register(IPC.settingsGet, z.undefined(), () => adminSettings());

  register(IPC.settingsSetPublicRegistration, publicRegistrationSchema, (input) => {
    const admin = actor();
    context.services.settings.set('allow_public_registration', input.enabled, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'settings.public-registration',
      result: 'success',
      targetType: 'settings',
      detail: { enabled: input.enabled },
    });
    return adminSettings();
  });

  register(
    IPC.settingsSetTrustProxy,
    z.object({ enabled: z.boolean() }),
    async (input) => {
      const admin = actor();
      const settings = context.services.settings;
      const status = context.server.getStatus();
      const previous = settings.get('network.trustProxy');

      settings.set('network.trustProxy', input.enabled, admin.id);

      if (status.running) {
        try {
          await context.server.stop();
          await context.server.start(status.port);
        } catch (error) {
          settings.set('network.trustProxy', previous, admin.id);
          try {
            await context.server.start(status.port);
          } catch {
            settings.set('server.online', false, admin.id);
          }
          throw error;
        }
      }

      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'settings.trust-proxy',
        result: 'success',
        targetType: 'settings',
        detail: { enabled: input.enabled, restarted: status.running },
      });

      return adminSettings();
    },
  );

  register(IPC.settingsSetPermissions, featurePermissionsSchema, (input) => {
    const admin = actor();
    const settings = context.services.settings;
    settings.set('allow_user_preview_image', input.allowUserPreviewImage, admin.id);
    settings.set('allow_user_preview_video', input.allowUserPreviewVideo, admin.id);
    settings.set('allow_user_preview_pdf', input.allowUserPreviewPdf, admin.id);
    settings.set('allow_user_extract', input.allowUserExtract, admin.id);
    settings.set('allow_user_scan', input.allowUserScan, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'settings.permissions',
      result: 'success',
      targetType: 'settings',
      detail: input,
    });
    return adminSettings();
  });

  register(IPC.settingsSetScan, scanConfigSchema, (input) => {
    const admin = actor();
    const settings = context.services.settings;
    settings.set('scan.enabled', input.enabled, admin.id);
    settings.set('scan.mode', input.mode, admin.id);
    settings.set('scan.api_key', input.apiKey, admin.id);
    settings.set('scan.local_path', input.localPath, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'settings.scan',
      result: 'success',
      targetType: 'settings',
      detail: {
        enabled: input.enabled,
        mode: input.mode,
        hasApiKey: input.apiKey.length > 0,
        localPath: input.localPath,
      },
    });
    return adminSettings();
  });

  register(IPC.settingsSetAi, aiConfigSchema, (input) => {
    const admin = actor();
    context.services.ai.saveAdmin(input);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'settings.ai',
      result: 'success',
      targetType: 'settings',
      detail: {
        enabled: input.enabled,
        mode: input.mode,
        mcpEnabled: input.mcpEnabled,
        hasApiKey: Boolean(input.apiKey && !input.apiKey.includes('***')),
      },
    });
    return adminSettings();
  });

  register(IPC.settingsGenerateMcpToken, z.undefined(), () => {
    const admin = actor();
    const token = context.services.ai.generateMcpToken();
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'settings.mcp-token',
      result: 'success',
      targetType: 'settings',
      detail: { generated: true },
    });
    return { ...adminSettings(), generatedToken: token };
  });

  register(
    IPC.settingsSetHosting,
    z.object({ enabled: z.boolean(), baseUrl: z.string().max(500) }),
    (input) => {
      const admin = actor();
      context.services.settings.set('hosting.enabled', input.enabled, admin.id);
      context.services.settings.set('hosting.base_url', input.baseUrl.trim(), admin.id);
      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'settings.hosting',
        result: 'success',
        targetType: 'settings',
        detail: { enabled: input.enabled, baseUrl: input.baseUrl },
      });
      return adminSettings();
    },
  );

  register(IPC.settingsSetMail, mailConfigSchema, (input) => {
    const admin = actor();
    context.services.mail.save(input);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'settings.mail',
      result: 'success',
      targetType: 'settings',
      detail: {
        enabled: input.enabled,
        host: input.host,
        hasPass: Boolean(input.pass && !input.pass.includes('***')),
      },
    });
    return adminSettings();
  });

  register(IPC.settingsTestMail, z.undefined(), () => context.services.mail.sendTest());

  register(IPC.caInfo, z.undefined(), () => context.ca.getCAInfo());
  register(IPC.caCreate, z.undefined(), async () => {
    const admin = actor();
    const info = await context.ca.createPrivateCA();
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'ca.create',
      result: 'success',
      targetType: 'ca',
      detail: { fingerprint: info.fingerprint },
    });
    return info;
  });

  register(IPC.caInstall, z.undefined(), async () => {
    const admin = actor();
    const info = await context.ca.installCA();
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'ca.install',
      result: 'success',
      targetType: 'ca',
      detail: { fingerprint: info.fingerprint },
    });
    return info;
  });

  register(IPC.caUninstall, z.undefined(), async () => {
    const admin = actor();
    const info = await context.ca.uninstallCA();
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'ca.uninstall',
      result: 'success',
      targetType: 'ca',
      detail: { fingerprint: info.fingerprint },
    });
    return info;
  });

  register(IPC.caIssueServerCert, z.undefined(), async () => {
    const admin = actor();
    const certificate = await context.ca.issueServerCert();
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'ca.issue-server-cert',
      result: 'success',
      targetType: 'server',
      detail: { subject: certificate.subject, fingerprint: certificate.fingerprint },
    });
    return certificate;
  });

  register(IPC.caExportClientCert, z.undefined(), async () => {
    const window = context.getWindow();
    if (window === null) throw new Error('主窗口不可用');

    const admin = actor();
    const selection = await dialog.showSaveDialog(window, {
      title: '导出客户端证书',
      defaultPath: path.join(app.getPath('documents'), 'cloudbox-client.p12'),
      buttonLabel: '导出',
      filters: [
        { name: 'PKCS#12 证书', extensions: ['p12', 'pfx'] },
        { name: 'PEM 证书', extensions: ['pem'] },
      ],
    });

    if (selection.canceled || !selection.filePath) {
      return { saved: false };
    }

    let target = selection.filePath;
    if (!/\.(p12|pfx|pem)$/i.test(target)) {
      target = `${target}.p12`;
    }

    const result = await context.ca.issueClientCert(target);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'ca.export-client-cert',
      result: 'success',
      targetType: 'ca',
      detail: { fileName: result.fileName },
    });
    return result;
  });

  register(IPC.frpStatus, z.undefined(), () => context.frp.getStatus());

  register(IPC.frpSaveConfig, frpConfigSchema, async (input): Promise<FrpStatus> => {
    const admin = actor();
    const status = await context.frp.setConfig(input);
    context.services.settings.set('frp.serverAddr', input.serverAddr, admin.id);
    context.services.settings.set('frp.serverPort', input.serverPort, admin.id);
    context.services.settings.set('frp.remotePort', input.remotePort, admin.id);
    context.services.settings.set('frp.token', input.token, admin.id);
    context.services.settings.set('frp.user', input.user, admin.id);
    context.services.settings.set('frp.proxyName', input.proxyName, admin.id);
    context.services.settings.set('frp.tunnelType', input.tunnelType, admin.id);
    context.services.settings.set('frp.customDomain', input.customDomain, admin.id);
    context.services.settings.set('frp.proxyProtocol', input.proxyProtocol, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'frp.config.update',
      result: 'success',
      targetType: 'frp',
      detail: {
        serverAddr: input.serverAddr,
        serverPort: input.serverPort,
        remotePort: input.remotePort,
        proxyName: input.proxyName,
      },
    });
    return status;
  });

  register(IPC.frpStart, z.undefined(), async () => {
    const admin = actor();
    const status = await context.frp.start();
    context.services.settings.set('frp.enabled', true, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'frp.start',
      result: 'success',
      targetType: 'frp',
    });
    return status;
  });

  register(IPC.frpStop, z.undefined(), async () => {
    const admin = actor();
    const status = await context.frp.stop();
    context.services.settings.set('frp.enabled', false, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'frp.stop',
      result: 'success',
      targetType: 'frp',
    });
    return status;
  });

  register(IPC.frpRestart, z.undefined(), async () => {
    const admin = actor();
    const status = await context.frp.restart();
    context.services.settings.set('frp.enabled', true, admin.id);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'frp.restart',
      result: 'success',
      targetType: 'frp',
    });
    return status;
  });

  const resolveUser = (userId: number) => {
    const record = context.services.users.findById(userId);
    if (record === null) {
      throw new AdminError(ADMIN_ERROR.USER_NOT_FOUND, '用户不存在');
    }
    return toSessionUser(record);
  };

  const adminFileContext = () => {
    const admin = context.session.require();
    return {
      userAgent: 'cloudbox-desktop',
      ip: 'desktop',
      actor: { type: 'admin' as const, id: admin.id },
    };
  };

  register(IPC.filesList, fileListSchema, async (input) => {
    return context.services.files.list(resolveUser(input.userId), input.path, adminFileContext());
  });

  register(IPC.filesDownload, fileDownloadSchema, async (input) => {
    const window = context.getWindow();
    if (window === null) {
      throw new Error('主窗口不可用');
    }

    const target = await context.services.files.openDownload(
      resolveUser(input.userId),
      input.path,
      adminFileContext(),
    );

    const selection = await dialog.showSaveDialog(window, {
      title: '保存文件',
      defaultPath: path.join(app.getPath('downloads'), target.name),
      buttonLabel: '保存',
    });

    if (selection.canceled || !selection.filePath) {
      return { saved: false };
    }

    try {
      await pipeline(
        createReadStream(target.absolutePath),
        createWriteStream(selection.filePath),
      );
    } catch (error) {
      await rm(selection.filePath, { force: true }).catch(() => {});
      throw error;
    }

    return { saved: true, fileName: path.basename(selection.filePath) };
  });

  register(IPC.appInfo, z.undefined(), () => ({
    version: context.version,
    dataDir: context.dataDir,
    storageDir: context.storageRoot,
    pluginsDir: context.pluginsDir,
  }));

  register(IPC.appOpenDataDir, z.undefined(), async () => {
    const error = await shell.openPath(context.dataDir);
    if (error) throw new Error(error);
    return null;
  });

  register(IPC.appOpenStorageDir, z.undefined(), async () => {
    const error = await shell.openPath(context.storageRoot);
    if (error) throw new Error(error);
    return null;
  });

  register(IPC.appOpenPluginsDir, z.undefined(), async () => {
    const error = await shell.openPath(context.pluginsDir);
    if (error) throw new Error(error);
    return null;
  });

  register(IPC.appChooseDirectory, directoryKindSchema, async (input) => {
    const window = context.getWindow();
    if (window === null) throw new Error('主窗口不可用');

    const selection = await dialog.showOpenDialog(window, {
      title:
        input.kind === 'data'
          ? '选择系统数据目录'
          : input.kind === 'storage'
            ? '选择网盘文件目录'
            : '选择插件目录',
      defaultPath:
        input.kind === 'data'
          ? context.dataDir
          : input.kind === 'storage'
            ? context.storageRoot
            : context.pluginsDir,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '选择此目录',
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { selected: false };
    }

    return { selected: true, path: selection.filePaths[0]! };
  });

  register(IPC.appChangeDirectory, changeDirectorySchema, async (input) => {
    await changeDirectory(context, input);
    return { restarting: true };
  });

  register(IPC.appBackupDatabase, z.undefined(), async () => {
    const window = context.getWindow();
    if (window === null) throw new Error('主窗口不可用');

    const admin = actor();
    const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
    const selection = await dialog.showSaveDialog(window, {
      title: '备份数据库',
      defaultPath: path.join(app.getPath('documents'), `cloudbox-backup-${stamp}.db`),
      buttonLabel: '保存备份',
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    });

    if (selection.canceled || !selection.filePath) {
      return { saved: false };
    }

    await context.services.db.backup(selection.filePath);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'database.backup',
      result: 'success',
      targetType: 'database',
      detail: { fileName: path.basename(selection.filePath) },
    });

    return { saved: true, fileName: path.basename(selection.filePath) };
  });

  register(IPC.pluginsList, z.undefined(), () => context.services.plugins.list());

  register(IPC.pluginsImport, z.undefined(), async () => {
    const window = context.getWindow();
    if (window === null) throw new Error('主窗口不可用');
    const selection = await dialog.showOpenDialog(window, {
      title: '导入插件（zip 或文件夹）',
      properties: ['openFile', 'openDirectory'],
      buttonLabel: '导入插件',
      filters: [{ name: '插件压缩包', extensions: ['zip'] }],
    });
    if (selection.canceled || selection.filePaths.length === 0) return null;
    const source = selection.filePaths[0]!;
    const admin = actor();
    const info = await stat(source);
    const result = info.isDirectory()
      ? await context.services.plugins.importFolder(source)
      : await context.services.plugins.importZip(source);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'plugin.import',
      result: 'success',
      targetType: 'plugin',
      targetPath: source,
    });
    return result;
  });

  register(
    IPC.pluginsSetEnabled,
    z.object({ name: z.string().min(1), enabled: z.boolean() }),
    async (input) => {
      const admin = actor();
      await context.services.plugins.setEnabled(input.name, input.enabled);
      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'plugin.toggle',
        result: 'success',
        targetType: 'plugin',
        targetId: input.name,
        detail: { enabled: input.enabled },
      });
      return context.services.plugins.list();
    },
  );

  register(
    IPC.pluginsSetAllowWebOverride,
    z.object({ name: z.string().min(1), allowed: z.boolean() }),
    (input) => {
      const admin = actor();
      context.services.plugins.setAllowWebOverride(input.name, input.allowed);
      context.services.audit.record({
        actorType: 'admin',
        actorId: admin.id,
        action: 'plugin.web-override',
        result: 'success',
        targetType: 'plugin',
        targetId: input.name,
        detail: { allowed: input.allowed },
      });
      return context.services.plugins.list();
    },
  );

  register(IPC.pluginsRemove, z.object({ name: z.string().min(1) }), async (input) => {
    const admin = actor();
    const result = await context.services.plugins.uninstall(input.name);
    context.services.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'plugin.uninstall',
      result: 'success',
      targetType: 'plugin',
      targetId: input.name,
    });
    return result;
  });
}
