import { z } from 'zod';
import type { SettingsRepository } from '../db/repositories/settingsRepo.ts';

interface SettingDefinitions {
  'server.online': { schema: z.ZodType<boolean>; fallback: boolean };
  'server.httpsEnabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'server.mtlsEnabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'server.port': { schema: z.ZodType<number>; fallback: number };
  'server.bind': { schema: z.ZodType<string>; fallback: string };
  'security.sessionTtlHours': { schema: z.ZodType<number>; fallback: number };
  'security.maxLoginFailures': { schema: z.ZodType<number>; fallback: number };
  'upload.maxFileBytes': { schema: z.ZodType<number>; fallback: number };
  'frp.enabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'frp.serverAddr': { schema: z.ZodType<string>; fallback: string };
  'frp.serverPort': { schema: z.ZodType<number>; fallback: number };
  'frp.remotePort': { schema: z.ZodType<number>; fallback: number };
  'frp.token': { schema: z.ZodType<string>; fallback: string };
  'frp.user': { schema: z.ZodType<string>; fallback: string };
  'frp.proxyName': { schema: z.ZodType<string>; fallback: string };
  'frp.tunnelType': { schema: z.ZodType<'tcp' | 'http' | 'https'>; fallback: 'tcp' };
  'frp.customDomain': { schema: z.ZodType<string>; fallback: string };
  'frp.proxyProtocol': { schema: z.ZodType<boolean>; fallback: boolean };
  'ca.installed': { schema: z.ZodType<boolean>; fallback: boolean };
  allow_public_registration: { schema: z.ZodType<boolean>; fallback: boolean };
  'network.trustProxy': { schema: z.ZodType<boolean>; fallback: boolean };
  allow_user_preview_image: { schema: z.ZodType<boolean>; fallback: boolean };
  allow_user_preview_video: { schema: z.ZodType<boolean>; fallback: boolean };
  allow_user_preview_pdf: { schema: z.ZodType<boolean>; fallback: boolean };
  allow_user_extract: { schema: z.ZodType<boolean>; fallback: boolean };
  allow_user_scan: { schema: z.ZodType<boolean>; fallback: boolean };
  'scan.enabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'scan.mode': { schema: z.ZodType<'api' | 'local'>; fallback: 'api' | 'local' };
  'scan.api_key': { schema: z.ZodType<string>; fallback: string };
  'scan.local_path': { schema: z.ZodType<string>; fallback: string };
  'ai.enabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'ai.mode': { schema: z.ZodType<'admin' | 'user'>; fallback: 'admin' | 'user' };
  'ai.admin_base_url': { schema: z.ZodType<string>; fallback: string };
  'ai.admin_api_key': { schema: z.ZodType<string>; fallback: string };
  'ai.admin_model': { schema: z.ZodType<string>; fallback: string };
  'ai.user_daily_limit': { schema: z.ZodType<number>; fallback: number };
  'mcp.enabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'mcp.token': { schema: z.ZodType<string>; fallback: string };
  'mcp.bound_user_id': { schema: z.ZodType<number>; fallback: number };
  'hosting.enabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'hosting.base_url': { schema: z.ZodType<string>; fallback: string };
  'mail.enabled': { schema: z.ZodType<boolean>; fallback: boolean };
  'mail.host': { schema: z.ZodType<string>; fallback: string };
  'mail.port': { schema: z.ZodType<number>; fallback: number };
  'mail.secure': { schema: z.ZodType<boolean>; fallback: boolean };
  'mail.user': { schema: z.ZodType<string>; fallback: string };
  'mail.pass': { schema: z.ZodType<string>; fallback: string };
  'mail.from': { schema: z.ZodType<string>; fallback: string };
  'mail.to': { schema: z.ZodType<string>; fallback: string };
  'mail.eventUserRegistered': { schema: z.ZodType<boolean>; fallback: boolean };
  'mail.eventSecurityAlert': { schema: z.ZodType<boolean>; fallback: boolean };
  'mail.eventSystemError': { schema: z.ZodType<boolean>; fallback: boolean };
}

const DEFINITIONS: SettingDefinitions = {
  'server.online': { schema: z.boolean(), fallback: false },
  'server.httpsEnabled': { schema: z.boolean(), fallback: false },
  'server.mtlsEnabled': { schema: z.boolean(), fallback: false },
  'server.port': { schema: z.number().int().min(1024).max(65_535), fallback: 8686 },
  'server.bind': { schema: z.string().min(1), fallback: '0.0.0.0' },
  'security.sessionTtlHours': { schema: z.number().int().min(1).max(8760), fallback: 168 },
  'security.maxLoginFailures': { schema: z.number().int().min(3).max(50), fallback: 5 },
  'upload.maxFileBytes': { schema: z.number().int().min(1), fallback: 2 * 1024 ** 3 },
  'frp.enabled': { schema: z.boolean(), fallback: false },
  'frp.serverAddr': { schema: z.string().max(255), fallback: '' },
  'frp.serverPort': { schema: z.number().int().min(1).max(65_535), fallback: 7000 },
  'frp.remotePort': { schema: z.number().int().min(0).max(65_535), fallback: 0 },
  'frp.token': { schema: z.string().max(255), fallback: '' },
  'frp.user': { schema: z.string().max(255), fallback: '' },
  'frp.proxyName': { schema: z.string().max(64), fallback: 'cloudbox' },
  'frp.tunnelType': { schema: z.enum(['tcp', 'http', 'https']), fallback: 'tcp' },
  'frp.customDomain': { schema: z.string().max(253), fallback: '' },
  'frp.proxyProtocol': { schema: z.boolean(), fallback: false },
  'ca.installed': { schema: z.boolean(), fallback: false },
  allow_public_registration: { schema: z.boolean(), fallback: false },
  'network.trustProxy': { schema: z.boolean(), fallback: false },
  allow_user_preview_image: { schema: z.boolean(), fallback: true },
  allow_user_preview_video: { schema: z.boolean(), fallback: true },
  allow_user_preview_pdf: { schema: z.boolean(), fallback: true },
  allow_user_extract: { schema: z.boolean(), fallback: true },
  allow_user_scan: { schema: z.boolean(), fallback: true },
  'scan.enabled': { schema: z.boolean(), fallback: false },
  'scan.mode': { schema: z.enum(['api', 'local']), fallback: 'local' },
  'scan.api_key': { schema: z.string().max(256), fallback: '' },
  'scan.local_path': { schema: z.string().max(500), fallback: '' },
  'ai.enabled': { schema: z.boolean(), fallback: false },
  'ai.mode': { schema: z.enum(['admin', 'user']), fallback: 'admin' },
  'ai.admin_base_url': { schema: z.string().max(500), fallback: '' },
  'ai.admin_api_key': { schema: z.string().max(2000), fallback: '' },
  'ai.admin_model': { schema: z.string().max(200), fallback: 'gpt-4o-mini' },
  'ai.user_daily_limit': { schema: z.number().int().min(1).max(10_000), fallback: 50 },
  'mcp.enabled': { schema: z.boolean(), fallback: false },
  'mcp.token': { schema: z.string().max(256), fallback: '' },
  'mcp.bound_user_id': { schema: z.number().int().min(0), fallback: 0 },
  'hosting.enabled': { schema: z.boolean(), fallback: false },
  'hosting.base_url': { schema: z.string().max(500), fallback: '' },
  'mail.enabled': { schema: z.boolean(), fallback: false },
  'mail.host': { schema: z.string().max(255), fallback: '' },
  'mail.port': { schema: z.number().int().min(1).max(65_535), fallback: 587 },
  'mail.secure': { schema: z.boolean(), fallback: false },
  'mail.user': { schema: z.string().max(255), fallback: '' },
  'mail.pass': { schema: z.string().max(2000), fallback: '' },
  'mail.from': { schema: z.string().max(255), fallback: '' },
  'mail.to': { schema: z.string().max(500), fallback: '' },
  'mail.eventUserRegistered': { schema: z.boolean(), fallback: true },
  'mail.eventSecurityAlert': { schema: z.boolean(), fallback: true },
  'mail.eventSystemError': { schema: z.boolean(), fallback: true },
};

export type SettingKey = keyof SettingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<SettingDefinitions[K]['schema']>;

/**
 * 设置读写统一入口：每个 key 自带 zod 校验与默认值。
 * 数据库里的值损坏时回退默认值而不是让服务崩溃。
 */
export class SettingsService {
  private readonly repo: SettingsRepository;
  private readonly now: () => number;

  constructor(repo: SettingsRepository, now: () => number = Date.now) {
    this.repo = repo;
    this.now = now;
  }

  get<K extends SettingKey>(key: K): SettingValue<K> {
    const definition = DEFINITIONS[key];
    const raw = this.repo.get(key);
    if (raw === null) return definition.fallback as SettingValue<K>;

    try {
      const parsed = definition.schema.safeParse(JSON.parse(raw));
      return (parsed.success ? parsed.data : definition.fallback) as SettingValue<K>;
    } catch {
      return definition.fallback as SettingValue<K>;
    }
  }

  set<K extends SettingKey>(key: K, value: SettingValue<K>, updatedBy: number | null = null): void {
    const parsed = DEFINITIONS[key].schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`设置项 ${key} 的值非法：${parsed.error.issues[0]?.message ?? '未知错误'}`);
    }
    this.repo.set(key, JSON.stringify(parsed.data), updatedBy, this.now());
  }

  /** 供管理端展示全部设置（原始值） */
  list(): Array<{ key: string; value: unknown; updatedAt: number; updatedBy: number | null }> {
    return this.repo.getAll().map((entry) => {
      let value: unknown = entry.value;
      try {
        value = JSON.parse(entry.value);
      } catch {
        // 保留原始字符串，管理端可看到损坏值
      }
      return { key: entry.key, value, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy };
    });
  }
}
