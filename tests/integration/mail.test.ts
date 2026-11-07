import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { MailTransport } from '../../src/core/services/mailService.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

describe('mail alerts', () => {
  let t: TestServer | null = null;

  afterEach(async () => {
    await t?.close();
    t = null;
  });

  it('SMTP 密码加密存储、脱敏展示，5 次同告警只发 1 封', async () => {
    let sent = 0;
    const transport: MailTransport = {
      async send() {
        sent += 1;
      },
    };
    t = await createTestServer({ mailTransport: transport });
    t.services.mail.save({
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'alert@example.com',
      pass: 'smtp-secret-123',
      from: 'CloudBox <alert@example.com>',
      to: 'admin@example.com',
      eventUserRegistered: true,
      eventSecurityAlert: true,
      eventSystemError: true,
    });

    const row = t.services.db
      .prepare("SELECT value FROM settings WHERE key = 'mail.pass'")
      .get() as { value: string };
    assert.match(row.value, /^"enc:v1:/);
    assert.ok(!row.value.includes('smtp-secret-123'));
    const settings = t.services.mail.adminSettings() as { passMasked: string };
    assert.match(settings.passMasked, /^\w{2}\*\*\*\w{3}$/);

    for (let i = 0; i < 5; i += 1) {
      t.services.mail.notify('security.alert', { ip: '1.2.3.4', endpoint: '/api/auth/login' });
    }
    await t.services.mail.drain();
    assert.equal(sent, 1);

    // 不同 IP 独立冷却，允许再次发送
    t.services.mail.notify('security.alert', { ip: '5.6.7.8', endpoint: '/api/auth/login' });
    await t.services.mail.drain();
    assert.equal(sent, 2);
  });
});
