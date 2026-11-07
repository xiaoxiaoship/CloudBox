import path from 'node:path';
import type { Db } from './db/connection.ts';
import { AuditRepository } from './db/repositories/auditRepo.ts';
import { AiRepository } from './db/repositories/aiRepo.ts';
import { HostingRepository } from './db/repositories/hostingRepo.ts';
import { PluginRepository } from './db/repositories/pluginRepo.ts';
import { QuotaRepository } from './db/repositories/quotaRepo.ts';
import { ScanRepository } from './db/repositories/scanRepo.ts';
import { SessionRepository } from './db/repositories/sessionRepo.ts';
import { ShareRepository } from './db/repositories/shareRepo.ts';
import { SettingsRepository } from './db/repositories/settingsRepo.ts';
import { UserRepository } from './db/repositories/userRepo.ts';
import { AuthService } from './services/authService.ts';
import { AuditService } from './services/auditService.ts';
import { AiService, type AiChatClient } from './services/aiService.ts';
import { ExtractionService } from './services/extractionService.ts';
import { EventBus } from './services/eventBus.ts';
import { FileService } from './services/fileService.ts';
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
import { TaskService } from './services/taskService.ts';
import { SecretBox } from './security/secretBox.ts';

export interface CoreServices {
  db: Db;
  users: UserRepository;
  quotas: QuotaRepository;
  sessions: SessionRepository;
  scans: ScanRepository;
  settings: SettingsService;
  audit: AuditService;
  auth: AuthService;
  files: FileService;
  shares: ShareService;
  registration: RegistrationService;
  tasks: TaskService;
  scan: ScanService;
  extraction: ExtractionService;
  events: EventBus;
  plugins: PluginService;
  ai: AiService;
  hosting: HostingService;
  mail: MailService;
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
  const scans = new ScanRepository(db);
  const settings = new SettingsService(new SettingsRepository(db), now);
  const audit = new AuditService(new AuditRepository(db), now);
  const tasks = new TaskService({ now });
  const events = new EventBus();
  const pluginRoot = options.pluginRoot ?? path.join(storageRoot, '.plugins');
  const plugins = new PluginService({
    plugins: new PluginRepository(db),
    events,
    pluginRoot,
    childScript: options.pluginChildScript,
    execPath: options.pluginExecPath,
  });
  const auth = new AuthService({ users, sessions, settings, audit, now });
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
  const hosting = new HostingService({
    repo: new HostingRepository(db),
    users,
    files,
    settings,
    storageRoot,
    now,
  });
  const mail = new MailService({
    settings,
    secrets,
    events,
    transport: options.mailTransport,
    now,
  });

  return {
    db,
    users,
    quotas,
    sessions,
    scans,
    settings,
    audit,
    auth,
    files,
    shares,
    registration,
    tasks,
    scan,
    extraction,
    events,
    plugins,
    ai,
    hosting,
    mail,
  };
}
