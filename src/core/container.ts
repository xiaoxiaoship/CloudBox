import path from 'node:path';
import os from 'node:os';
import type { Db } from './db/connection.ts';
import { AuditRepository } from './db/repositories/auditRepo.ts';
import { AnnouncementRepository } from './db/repositories/announcementRepo.ts';
import { AiRepository } from './db/repositories/aiRepo.ts';
import { HostingRepository } from './db/repositories/hostingRepo.ts';
import { PluginRepository } from './db/repositories/pluginRepo.ts';
import { QuotaRepository } from './db/repositories/quotaRepo.ts';
import { ScanRepository } from './db/repositories/scanRepo.ts';
import { SessionRepository } from './db/repositories/sessionRepo.ts';
import { ShareRepository } from './db/repositories/shareRepo.ts';
import { SettingsRepository } from './db/repositories/settingsRepo.ts';
import { UserRepository } from './db/repositories/userRepo.ts';
import { UserIpRepository } from './db/repositories/userIpRepo.ts';
import { AuthService } from './services/authService.ts';
import { AuditService } from './services/auditService.ts';
import { AiService, type AiChatClient } from './services/aiService.ts';
import { ExtractionService } from './services/extractionService.ts';
import { CompressionService } from './services/compressionService.ts';
import { AnnouncementService } from './services/announcementService.ts';
import { EventBus } from './services/eventBus.ts';
import { FileService } from './services/fileService.ts';
import { GuestLinkService } from './services/guestLinkService.ts';
import { HostingService } from './services/hostingService.ts';
import { MailService, type MailTransport } from './services/mailService.ts';
import { PluginService } from './services/pluginService.ts';
import { RegistrationService } from './services/registrationService.ts';
import {
  ScanService,
  type LocalScanner,
  type VirusTotalClient,
} from './services/scanService.ts';
import { ShareService } from './services/shareService.ts';
import { SettingsService } from './services/settingsService.ts';
import { SecurityPolicyService } from './services/securityPolicyService.ts';
import { TaskService } from './services/taskService.ts';
import type { RequestContext } from './services/fileService.ts';
import { toPublicUser, toSessionUser } from './types/models.ts';
import { UpdateService } from './services/updateService.ts';
import { SecretBox } from './security/secretBox.ts';

export interface CoreServices {
  db: Db;
  users: UserRepository;
  quotas: QuotaRepository;
  sessions: SessionRepository;
  loginIps: UserIpRepository;
  scans: ScanRepository;
  settings: SettingsService;
  securityPolicy: SecurityPolicyService;
  audit: AuditService;
  auth: AuthService;
  files: FileService;
  shares: ShareService;
  guestLinks: GuestLinkService;
  registration: RegistrationService;
  tasks: TaskService;
  scan: ScanService;
  extraction: ExtractionService;
  compression: CompressionService;
  announcements: AnnouncementService;
  events: EventBus;
  plugins: PluginService;
  ai: AiService;
  hosting: HostingService;
  mail: MailService;
  update: UpdateService;
}

export interface CreateCoreServicesOptions {
  db: Db;
  storageRoot: string;
  tempDir: string;
  now?: () => number;
  virusTotalClient?: VirusTotalClient;
  localScanner?: LocalScanner;
  sevenZipBinary?: string;
  pluginRoot?: string;
  pluginChildScript?: string;
  pluginExecPath?: string;
  secretPath?: string;
  secretLegacyPath?: string;
  aiClient?: AiChatClient;
  mailTransport?: MailTransport;
}

/**
 * 组装领域服务（不依赖 HTTP / Electron）。
 * 服务端、测试、以及后续 Electron 主进程共用同一套装配逻辑。
 */
export function createCoreServices(options: CreateCoreServicesOptions): CoreServices {
  const { db, storageRoot, tempDir, now } = options;

  const users = new UserRepository(db);
  const quotas = new QuotaRepository(db);
  const sessions = new SessionRepository(db);
  const loginIps = new UserIpRepository(db);
  const scans = new ScanRepository(db);
  const audit = new AuditService(new AuditRepository(db), now);
  const settings = new SettingsService(new SettingsRepository(db), now, audit);
  const events = new EventBus();
  const securityPolicy = new SecurityPolicyService(db, settings, now);
  securityPolicy.onBan = (ban) => events.emit('security.banned', { ...ban });
  const tasks = new TaskService({ now, storeFile: path.join(storageRoot, '.tasks.json') });
  const pluginRoot = options.pluginRoot ?? path.join(storageRoot, '.plugins');
  const plugins = new PluginService({
    plugins: new PluginRepository(db),
    events,
    pluginRoot,
    childScript: options.pluginChildScript,
    execPath: options.pluginExecPath,
    startTimeoutMs: settings.getLowLevel().pluginStartTimeoutMs,
    requestTimeoutMs: settings.getLowLevel().pluginRequestTimeoutMs,
    settings,
  });
  const auth = new AuthService({ users, sessions, settings, audit, loginIps, securityPolicy, now });
  const files = new FileService({
    db,
    storageRoot,
    tempDir,
    quotas,
    scans,
    settings,
    audit,
    events,
    now,
  });
  const shares = new ShareService({
    shares: new ShareRepository(db),
    users,
    files,
    audit,
    now,
  });
  const guestLinks = new GuestLinkService({ users, settings, storageRoot, now });
  const registration = new RegistrationService({
    db,
    users,
    quotas,
    settings,
    audit,
    storageRoot,
    events,
    now,
  });
  const scan = new ScanService({
    files,
    scans,
    settings,
    tasks,
    audit,
    virusTotal: options.virusTotalClient,
    localScanner: options.localScanner,
    now,
  });
  const extraction = new ExtractionService({
    files,
    storageRoot,
    quotas,
    tasks,
    audit,
    settings,
    sevenZipBinary: options.sevenZipBinary,
    now,
  });
  const compression = new CompressionService({
    files,
    storageRoot,
    settings,
    tasks,
    quotas,
    audit,
  });
  const announcements = new AnnouncementService({ repo: new AnnouncementRepository(db), users, now });
  const secrets = new SecretBox(
    options.secretPath ?? path.join(storageRoot, '.ai-secret'),
    options.secretLegacyPath,
  );
  const ai = new AiService({
    files,
    users,
    ai: new AiRepository(db),
    settings,
    audit,
    secrets,
    client: options.aiClient,
    now,
  });
  ai.setPluginBridge({
    tools: () => plugins.getAiTools().map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
    prompts: () => plugins.getPromptInjections(),
    call: (name, args) => plugins.callAiTool(name, args),
  });

  const hosting = new HostingService({
    repo: new HostingRepository(db),
    users,
    files,
    settings,
    storageRoot,
    now,
  });
  const update = new UpdateService({ settings, now });
  const mail = new MailService({
    settings,
    secrets,
    events,
    transport: options.mailTransport,
    now,
  });

  const pluginCtx = (): RequestContext => ({ ip: null, userAgent: 'cloudbox-plugin', requestId: `plugin-${Date.now()}` });

  plugins.setHost({
    getSystemStats: () => ({
      cpu: os.loadavg(),
      memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() },
      processMemory: process.memoryUsage(),
      onlineUsers: sessions.countOnline(now?.() ?? Date.now()),
      uptimeSeconds: Math.round(process.uptime()),
      platform: process.platform,
    }),
    getBannedList: () => securityPolicy.listActive().map((ban) => ({ ...ban })),
    getUser: (userId) => {
      const user = users.findById(userId);
      return user === null ? null : toPublicUser(user);
    },
    updateQuota: (userId, quotaBytes) => {
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('userId 非法');
      const value = quotaBytes === null ? null : Number(quotaBytes);
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error('配额非法');
      if (!quotas.setQuota(userId, value, now?.() ?? Date.now())) throw new Error('用户配额不存在');
      return { userId, quotaBytes: value };
    },
    getMeta: (userId, key) => {
      const row = db.prepare('SELECT meta_value FROM plugin_user_meta WHERE user_id = ? AND meta_key = ?').get(userId, key) as { meta_value: string } | undefined;
      return row ? JSON.parse(row.meta_value) : null;
    },
    setMeta: (userId, key, value) => {
      if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[a-zA-Z0-9._-]{1,100}$/.test(key)) throw new Error('用户元数据键非法');
      const text = JSON.stringify(value);
      if (text.length > 64 * 1024) throw new Error('用户元数据超过 64KB');
      db.prepare('INSERT INTO plugin_user_meta (user_id, meta_key, meta_value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = excluded.meta_value, updated_at = excluded.updated_at').run(userId, key, text, now?.() ?? Date.now());
      return true;
    },
    fileRead: async (userId, filePath) => {
      const user = users.findById(userId); if (user === null) throw new Error('用户不存在');
      return files.readText(toSessionUser(user), filePath, pluginCtx());
    },
    fileWrite: async (userId, filePath, content) => {
      const user = users.findById(userId); if (user === null) throw new Error('用户不存在');
      if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) throw new Error('写入内容过大');
      return files.writeText(toSessionUser(user), filePath, content, true, pluginCtx());
    },
    fileList: async (userId, dir) => {
      const user = users.findById(userId); if (user === null) throw new Error('用户不存在');
      return files.list(toSessionUser(user), dir, pluginCtx());
    },
    fileGetUrl: async (userId, filePath) => {
      const user = users.findById(userId); if (user === null) throw new Error('用户不存在');
      const created = await shares.create(toSessionUser(user), filePath, 3_600, pluginCtx());
      return { token: created.token, url: `/api/public/s/${created.token}`, expiresAt: created.expiresAt };
    },
  });

  return {
    db,
    users,
    quotas,
    sessions,
    loginIps,
    scans,
    settings,
    securityPolicy,
    audit,
    auth,
    files,
    shares,
    guestLinks,
    registration,
    tasks,
    scan,
    extraction,
    compression,
    announcements,
    events,
    plugins,
    ai,
    hosting,
    mail,
    update,
  };
}
