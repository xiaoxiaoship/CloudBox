import nodemailer from 'nodemailer';
import type { EventBus } from './eventBus.ts';
import type { SettingsService } from './settingsService.ts';
import { maskSecret, type SecretBox } from '../security/secretBox.ts';
import { logger } from '../../shared/logger.ts';

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export interface MailSettingsInput {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  from: string;
  to: string;
  eventUserRegistered: boolean;
  eventSecurityAlert: boolean;
  eventSystemError: boolean;
}

const SUBJECTS: Record<string, string> = {
  'user.registered': 'CloudBox：新用户注册',
  'security.alert': 'CloudBox：安全告警',
  'system.error': 'CloudBox：系统严重错误',
};

export class MailService {
  private readonly settings: SettingsService;
  private readonly secrets: SecretBox;
  private readonly events: EventBus;
  private readonly transport: MailTransport | null;
  private readonly cooldowns = new Map<string, number>();
  private readonly queue = new Set<Promise<void>>();
  private readonly now: () => number;

  constructor(options: {
    settings: SettingsService;
    secrets: SecretBox;
    events: EventBus;
    transport?: MailTransport;
    now?: () => number;
  }) {
    this.settings = options.settings;
    this.secrets = options.secrets;
    this.events = options.events;
    this.transport = options.transport ?? null;
    this.now = options.now ?? Date.now;

    this.events.on('user.registered', (payload) => this.notify('user.registered', payload));
    this.events.on('security.alert', (payload) => this.notify('security.alert', payload));
    this.events.on('system.error', (payload) => this.notify('system.error', payload));
  }

  private createTransport(): MailTransport {
    return {
      async send() {
        throw new Error('SMTP transport not initialized');
      },
    };
  }

  private transportForConfig(): MailTransport {
    if (this.transport !== null) return this.transport;
    const pass = this.secrets.decrypt(this.settings.get('mail.pass'));
    const user = this.settings.get('mail.user');
    const transport = nodemailer.createTransport({
      host: this.settings.get('mail.host'),
      port: this.settings.get('mail.port'),
      secure: this.settings.get('mail.secure'),
      ...(user ? { auth: { user, pass } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return {
      async send(message) {
        await transport.sendMail(message);
      },
    };
  }

  adminSettings(): Record<string, unknown> {
    const pass = this.secrets.decrypt(this.settings.get('mail.pass'));
    return {
      enabled: this.settings.get('mail.enabled'),
      host: this.settings.get('mail.host'),
      port: this.settings.get('mail.port'),
      secure: this.settings.get('mail.secure'),
      user: this.settings.get('mail.user'),
      from: this.settings.get('mail.from'),
      to: this.settings.get('mail.to'),
      hasPass: pass !== '',
      passMasked: maskSecret(pass),
      events: {
        userRegistered: this.settings.get('mail.eventUserRegistered'),
        securityAlert: this.settings.get('mail.eventSecurityAlert'),
        systemError: this.settings.get('mail.eventSystemError'),
      },
    };
  }

  save(input: MailSettingsInput): Record<string, unknown> {
    this.settings.set('mail.enabled', input.enabled, null);
    this.settings.set('mail.host', input.host.trim(), null);
    this.settings.set('mail.port', input.port, null);
    this.settings.set('mail.secure', input.secure, null);
    this.settings.set('mail.user', input.user.trim(), null);
    if (input.pass && !input.pass.includes('***')) {
      this.settings.set('mail.pass', this.secrets.encrypt(input.pass.trim()), null);
    }
    this.settings.set('mail.from', input.from.trim(), null);
    this.settings.set('mail.to', input.to.trim(), null);
    this.settings.set('mail.eventUserRegistered', input.eventUserRegistered, null);
    this.settings.set('mail.eventSecurityAlert', input.eventSecurityAlert, null);
    this.settings.set('mail.eventSystemError', input.eventSystemError, null);
    return this.adminSettings();
  }

  private enabledFor(event: string): boolean {
    if (!this.settings.get('mail.enabled')) return false;
    if (event === 'user.registered') return this.settings.get('mail.eventUserRegistered');
    if (event === 'security.alert') return this.settings.get('mail.eventSecurityAlert');
    if (event === 'system.error') return this.settings.get('mail.eventSystemError');
    return false;
  }

  private cooldownKey(event: string, payload: Record<string, unknown>): string {
    if (event === 'security.alert') {
      return `${event}:${String(payload.ip ?? '')}:${String(payload.endpoint ?? '')}`;
    }
    if (event === 'user.registered') return `${event}:${String(payload.username ?? '')}`;
    return `${event}:${String(payload.message ?? '')}`;
  }

  notify(event: string, payload: Record<string, unknown>): void {
    if (!this.enabledFor(event)) return;
    const key = this.cooldownKey(event, payload);
    const now = this.now();
    const last = this.cooldowns.get(key) ?? 0;
    if (now - last < 60_000) return;
    this.cooldowns.set(key, now);

    const promise = this.deliver(event, payload).catch((error: unknown) => {
      logger.warn('邮件发送失败（已降级）', {
        event,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    this.queue.add(promise);
    void promise.finally(() => this.queue.delete(promise));
  }

  private async deliver(event: string, payload: Record<string, unknown>): Promise<void> {
    const to = this.settings.get('mail.to').trim();
    if (!to) return;
    const from = this.settings.get('mail.from').trim() || this.settings.get('mail.user').trim();
    if (!from) return;
    const text = [
      `事件：${event}`,
      `时间：${new Date(this.now()).toISOString()}`,
      ...Object.entries(payload).map(([key, value]) => `${key}: ${String(value)}`),
    ].join('\n');
    await this.transportForConfig().send({
      to,
      from,
      subject: SUBJECTS[event] ?? 'CloudBox 通知',
      text,
    });
    logger.info('系统邮件已发送', { event });
  }

  async sendTest(): Promise<{ ok: boolean; message: string }> {
    try {
      const to = this.settings.get('mail.to').trim();
      const from = this.settings.get('mail.from').trim() || this.settings.get('mail.user').trim();
      if (!to || !from) return { ok: false, message: '请先填写发件人与收件人' };
      await this.transportForConfig().send({
        to,
        from,
        subject: 'CloudBox SMTP 测试',
        text: `CloudBox SMTP 测试成功。\n时间：${new Date(this.now()).toISOString()}`,
      });
      return { ok: true, message: '测试邮件已发送' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async drain(): Promise<void> {
    await Promise.all([...this.queue]);
  }
}
